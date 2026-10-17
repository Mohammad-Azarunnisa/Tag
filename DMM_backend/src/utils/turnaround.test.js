import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';

process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret';
process.env.STORAGE_DRIVER = 'local';
process.env.LOCAL_STORAGE_ROOT = '';

const { classifyDesign, addWorkingDays, planDesign, workingDaysBetween } = await import('./turnaround.js');

// 2026-10-05 is a Monday.
test('two working days from a Monday is Wednesday', () => {
  assert.equal(addWorkingDays('2026-10-05', 2), '2026-10-07');
});

test('Sundays are skipped, Saturdays are working days', () => {
  assert.equal(addWorkingDays('2026-10-09', 2), '2026-10-11' === '' ? '' : '2026-10-12'); // Fri → Sat (1) → Mon (2); Sun skipped
  assert.equal(addWorkingDays('2026-10-10', 2), '2026-10-13'); // Sat → Mon (1) → Tue (2)
});

test('a holiday inside the window is skipped', () => {
  const holidays = new Set(['2026-10-06']); // Tuesday off
  assert.equal(addWorkingDays('2026-10-05', 2, holidays), '2026-10-08'); // Wed (1), Thu (2)
  assert.equal(workingDaysBetween('2026-10-05', '2026-10-08', holidays), 2);
});

test('a request raised on a Sunday or holiday still waits two working days', () => {
  const holidays = new Set(['2026-10-12']); // Monday off
  assert.equal(addWorkingDays('2026-10-11', 2, holidays), '2026-10-14'); // Sun → Tue (1) → Wed (2)
});

test('design types are classified Basic, Medium and Heavy', () => {
  assert.equal(classifyDesign({ workItem: 'Posters' }).key, 'BASIC');
  assert.equal(classifyDesign({ workItem: 'Social Media Posts' }).key, 'BASIC');
  assert.equal(classifyDesign({ workItem: 'Flyers' }).key, 'MEDIUM');
  assert.equal(classifyDesign({ workItem: 'Brochures' }).key, 'HEAVY');
  assert.equal(classifyDesign({ workItem: 'Digital Brochures' }).key, 'HEAVY');
  assert.equal(classifyDesign({ workItem: 'Something New', workCategory: 'Motion Graphics' }).key, 'HEAVY');
  assert.equal(classifyDesign({ workItem: 'Something New' }).key, 'MEDIUM');
  assert.equal(classifyDesign({ workItem: 'Posters' }).time, '1–1.5 hrs');
  assert.equal(classifyDesign({ workItem: 'Brochures' }).time, '1–2 full working days');
});

test('a plan carries the class, design time and earliest delivery date', () => {
  const plan = planDesign({ workItem: 'Brochures', raisedAt: new Date('2026-10-05T06:00:00Z'), holidays: new Set() });
  assert.equal(plan.tier, 'HEAVY');
  assert.equal(plan.earliestDelivery, '2026-10-07');
});

// ---- through the API ----
const { default: app } = await import('../app.js');
const { default: User } = await import('../models/User.js');
const { default: Organization } = await import('../models/Organization.js');
const { generateToken } = await import('./token.js');
const { ROLES, USER_TYPES } = await import('../config/constants.js');

let mongod; let server; let origin; let su; let coord; let org;

before(async () => {
  mongod = await MongoMemoryServer.create();
  await mongoose.connect(mongod.getUri());
  org = await Organization.create({ name: 'NCET', slug: 'ncet' });
  const a = await User.create({ name: 'Super', email: 'su@t.com', password: 'Passw0rd!', role: ROLES.ADMIN, isSuperAdmin: true });
  const c = await User.create({ name: 'Coco', email: 'coco@t.com', password: 'Passw0rd!', role: ROLES.USER, userType: USER_TYPES.COORDINATOR, organization: org._id });
  su = generateToken(a._id); coord = generateToken(c._id);
  server = app.listen(0);
  await new Promise((r) => server.once('listening', r));
  origin = `http://127.0.0.1:${server.address().port}`;
});
after(async () => { server?.close(); await mongoose.disconnect(); await mongod?.stop(); });

const call = async (token, p, { method = 'GET', body } = {}) => {
  const r = await fetch(`${origin}${p}`, { method, headers: { Authorization: `Bearer ${token}`, ...(body ? { 'Content-Type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined });
  return { status: r.status, json: await r.json().catch(() => ({})) };
};

test('only the super admin keeps the holiday list; everyone can read it', async () => {
  const denied = await call(coord, '/api/holidays', { method: 'POST', body: { date: '2026-10-20', name: 'Test' } });
  assert.equal(denied.status, 403);
  const ok = await call(su, '/api/holidays', { method: 'POST', body: { date: '2026-10-20', name: 'Diwali' } });
  assert.equal(ok.status, 201);
  const bad = await call(su, '/api/holidays', { method: 'POST', body: { date: '2026-13-40', name: 'Nope' } });
  assert.equal(bad.status, 400);
  const list = await call(coord, '/api/holidays?month=2026-10');
  assert.equal(list.status, 200);
  assert.deepEqual(list.json.holidays.map((h) => h.date), ['2026-10-20']);
});

test('the plan endpoint reports class, design time and earliest date', async () => {
  const r = await call(coord, '/api/turnaround/plan?workItem=Brochures&workCategory=');
  assert.equal(r.status, 200);
  assert.equal(r.json.plan.tier, 'HEAVY');
  assert.equal(r.json.plan.designTime, '1–2 full working days');
  assert.ok(/^\d{4}-\d{2}-\d{2}$/.test(r.json.plan.earliestDelivery));
});

test('a design request cannot be needed earlier than its earliest delivery date', async () => {
  const plan = (await call(coord, '/api/turnaround/plan?workItem=Posters')).json.plan;
  const tomorrow = new Date(Date.now() + 86400000).toISOString().slice(0, 10);
  const mk = (neededBy) => {
    const f = new FormData();
    Object.entries({ workType: 'PRINT_MEDIA', workCategory: 'Print', workItem: 'Posters', title: 'P', department: 'X', neededBy }).forEach(([k, v]) => f.append(k, v));
    return fetch(`${origin}/api/requests`, { method: 'POST', headers: { Authorization: `Bearer ${coord}` }, body: f }).then(async (r) => ({ status: r.status, json: await r.json() }));
  };
  if (tomorrow < plan.earliestDelivery) {
    const early = await mk(tomorrow);
    assert.equal(early.status, 400);
    assert.match(early.json.message, /too soon|sunday or a holiday/i);
    assert.doesNotMatch(early.json.message, /\d{4}-\d{2}-\d{2}|working days|hrs/i);
  }
  const fine = await mk(plan.earliestDelivery);
  assert.equal(fine.status, 201);
  assert.equal(fine.json.request?.designTier || fine.json.item?.designTier, 'BASIC');
});

test('several holidays can be added in one go, all-or-nothing, and re-adding a date renames it', async () => {
  const bulk = await call(su, '/api/holidays', { method: 'POST', body: { holidays: [
    { date: '2026-11-01', name: 'Rajyotsava' }, { date: '2026-11-02', name: 'Day after' }, { date: '2026-11-03', name: 'Another' },
  ] } });
  assert.equal(bulk.status, 201);
  assert.equal(bulk.json.added, 3);
  assert.equal(bulk.json.updated, 0);

  const again = await call(su, '/api/holidays', { method: 'POST', body: { holidays: [{ date: '2026-11-01', name: 'Kannada Rajyotsava' }, { date: '2026-11-04', name: 'New' }] } });
  assert.equal(again.json.added, 1);
  assert.equal(again.json.updated, 1);

  // one bad row means nothing from that request is saved
  const bad = await call(su, '/api/holidays', { method: 'POST', body: { holidays: [{ date: '2026-12-01', name: 'Good' }, { date: '2026-12-40', name: 'Bad' }] } });
  assert.equal(bad.status, 400);
  assert.match(bad.json.message, /Row 2/);
  const dec = await call(su, '/api/holidays?month=2026-12');
  assert.equal(dec.json.holidays.length, 0);

  const nov = await call(coord, '/api/holidays?month=2026-11');
  assert.equal(nov.json.holidays.find((h) => h.date === '2026-11-01').name, 'Kannada Rajyotsava');
  assert.equal((await call(coord, '/api/holidays', { method: 'POST', body: { holidays: [{ date: '2026-12-05', name: 'x' }] } })).status, 403);
});

test('"Needed by" is required on every request', async () => {
  const f = new FormData();
  Object.entries({ workType: 'PRINT_MEDIA', workCategory: 'Print', workItem: 'Posters', title: 'No date', department: 'X' }).forEach(([k, v]) => f.append(k, v));
  const r = await fetch(`${origin}/api/requests`, { method: 'POST', headers: { Authorization: `Bearer ${coord}` }, body: f });
  assert.equal(r.status, 400);
  assert.match((await r.json()).message, /date you need this by/i);
});

test('"Needed by" cannot be a Sunday or a holiday', async () => {
  const mk = (neededBy) => {
    const f = new FormData();
    Object.entries({ workType: 'PRINT_MEDIA', workCategory: 'Print', workItem: 'Posters', title: 'Dates', department: 'X', neededBy }).forEach(([k, v]) => f.append(k, v));
    return fetch(`${origin}/api/requests`, { method: 'POST', headers: { Authorization: `Bearer ${coord}` }, body: f }).then(async (r) => ({ status: r.status, json: await r.json() }));
  };
  // a Sunday well in the future (2030-01-06 is a Sunday)
  const sunday = await mk('2030-01-06');
  assert.equal(sunday.status, 400);
  assert.match(sunday.json.message, /sunday or a holiday/i);
  // a holiday set by the super admin
  await call(su, '/api/holidays', { method: 'POST', body: { date: '2030-02-05', name: 'Test holiday' } });
  const hol = await mk('2030-02-05');
  assert.equal(hol.status, 400);
  assert.match(hol.json.message, /sunday or a holiday/i);
  // an ordinary working day is fine
  const ok = await mk('2030-02-06');
  assert.equal(ok.status, 201);
});

test('raised on a Sunday before a holiday run, the two design days only start on the next working day', () => {
  // Sunday 18 Oct 2026, Dussehra 19–21: Thursday 22 is the first working day, so
  // Thursday and Friday are the two days to design and Saturday 24 is the earliest.
  const holidays = new Set(['2026-10-19', '2026-10-20', '2026-10-21']);
  const plan = planDesign({ workItem: 'Banners (Indoor & Outdoor)', raisedAt: new Date('2026-10-18T05:00:00Z'), holidays });
  assert.equal(plan.earliestDelivery, '2026-10-24');
  // Raised on an ordinary Monday it is still Wednesday.
  assert.equal(planDesign({ workItem: 'Posters', raisedAt: new Date('2026-10-05T06:00:00Z'), holidays: new Set() }).earliestDelivery, '2026-10-07');
  // Raised on a plain Sunday with no holidays: Monday is day zero, Wednesday the earliest.
  assert.equal(planDesign({ workItem: 'Posters', raisedAt: new Date('2026-10-11T06:00:00Z'), holidays: new Set() }).earliestDelivery, '2026-10-14');
});
