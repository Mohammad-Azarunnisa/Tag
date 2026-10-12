import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';

process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret';
process.env.STORAGE_DRIVER = 'local';
process.env.LOCAL_STORAGE_ROOT = '';

const { default: app } = await import('../app.js');
const { default: User } = await import('../models/User.js');
const { default: Organization } = await import('../models/Organization.js');
const { default: InstitutionRequest } = await import('../models/InstitutionRequest.js');
const { generateToken } = await import('../utils/token.js');
const { ROLES, USER_TYPES } = await import('../config/constants.js');

let mongod; let server; let origin; let tok; let tokOther;

// 12:00 IST on a fixed day, and 00:30 IST the next day (still the 20th in UTC)
const d1 = new Date('2026-09-10T06:30:00.000Z');
const lateNight = new Date('2026-09-19T19:00:00.000Z'); // 00:30 IST on 20 Sep

before(async () => {
  mongod = await MongoMemoryServer.create();
  await mongoose.connect(mongod.getUri());
  const ncet = await Organization.create({ name: 'NCET', slug: 'ncet' });
  const ncms = await Organization.create({ name: 'NCMS', slug: 'ncms' });
  const coord = await User.create({ name: 'Coco', email: 'coco@t.com', password: 'Passw0rd!', role: ROLES.USER, userType: USER_TYPES.COORDINATOR, organization: ncet._id });
  const dee = await User.create({ name: 'Dee', email: 'dee@t.com', password: 'Passw0rd!', role: ROLES.USER, userType: USER_TYPES.DESIGNER, organization: ncet._id });
  const dot = await User.create({ name: 'Dot', email: 'dot@t.com', password: 'Passw0rd!', role: ROLES.USER, userType: USER_TYPES.DESIGNER, organization: ncet._id });
  tok = generateToken(dee._id); tokOther = generateToken(dot._id);

  const mk = (extra) => InstitutionRequest.create({ raisedBy: coord._id, workType: 'DIGITAL_MEDIA', ...extra });
  await mk({ organization: ncet._id, title: 'Poster A', designer: dee._id, designAcceptedAt: d1, workflowStage: 'COMPLETED' });
  await mk({ organization: ncms._id, title: 'Banner B', designer: dee._id, designAcceptedAt: d1, workflowStage: 'POST_OPEN' }); // another college — still hers
  await mk({ organization: ncet._id, title: 'Late night', designer: dee._id, designAcceptedAt: lateNight, workflowStage: 'POSTED' });
  await mk({ organization: ncet._id, title: 'Not approved yet', designer: dee._id, workflowStage: 'DESIGN_COORDINATOR_REVIEW' });
  await mk({ organization: ncet._id, title: 'Cancelled', designer: dee._id, designAcceptedAt: d1, workflowStage: 'CANCELLED' });
  await mk({ organization: ncet._id, title: 'Dot work', designer: dot._id, designAcceptedAt: d1, workflowStage: 'COMPLETED' });

  server = app.listen(0);
  await new Promise((r) => server.once('listening', r));
  origin = `http://127.0.0.1:${server.address().port}`;
});

after(async () => { server?.close(); await mongoose.disconnect(); await mongod?.stop(); });

const get = async (token, p) => { const r = await fetch(`${origin}${p}`, { headers: { Authorization: `Bearer ${token}` } }); return { status: r.status, json: await r.json() }; };

test('a designer\'s calendar lists only their own approved designs, on the day they were approved (IST)', async () => {
  const m = await get(tok, '/api/calendar?month=2026-09');
  assert.equal(m.status, 200);
  assert.equal(m.json.kind, 'designs');
  assert.equal(m.json.total, 3); // not the unapproved one, not the cancelled one, not Dot's
  const byDate = Object.fromEntries(m.json.days.map((d) => [d.date, d.count]));
  assert.equal(byDate['2026-09-10'], 2); // across both colleges
  assert.equal(byDate['2026-09-20'], 1); // 00:30 IST counts on the 20th, not the 19th

  const day = await get(tok, '/api/calendar/day?date=2026-09-10');
  assert.equal(day.json.kind, 'designs');
  assert.deepEqual(day.json.designs.map((d) => d.title).sort(), ['Banner B', 'Poster A']);
  assert.ok(day.json.designs.every((d) => d.organization?.name));
});

test('another designer sees only theirs', async () => {
  const m = await get(tokOther, '/api/calendar?month=2026-09');
  assert.equal(m.json.total, 1);
});

const send = async (token, p, method, body) => {
  const r = await fetch(`${origin}${p}`, { method, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  return { status: r.status, json: await r.json() };
};

test('a designer can add, change and remove their own notes, kept apart from approved designs', async () => {
  const add = await send(tok, '/api/calendar/notes', 'POST', { date: '2026-09-12', title: 'Printed banner on the spot', details: 'Asked in person' });
  assert.equal(add.status, 201);
  const id = add.json.note._id;

  const month = await get(tok, '/api/calendar?month=2026-09');
  const day12 = month.json.days.find((d) => d.date === '2026-09-12');
  assert.equal(day12.notes, 1);
  assert.equal(day12.count, 0); // a note is not an approved design
  assert.equal(month.json.total, 3); // approved-design total is unchanged
  assert.equal(month.json.notesTotal, 1);

  const day = await get(tok, '/api/calendar/day?date=2026-09-12');
  assert.equal(day.json.designs.length, 0);
  assert.equal(day.json.notes[0].title, 'Printed banner on the spot');

  const edit = await send(tok, `/api/calendar/notes/${id}`, 'PUT', { title: 'Banner printed', details: '' });
  assert.equal(edit.json.note.title, 'Banner printed');

  // nobody else can touch it
  const other = await send(tokOther, `/api/calendar/notes/${id}`, 'DELETE');
  assert.equal(other.status, 404);
  const otherDay = await get(tokOther, '/api/calendar/day?date=2026-09-12');
  assert.equal(otherDay.json.notes.length, 0);

  const del = await send(tok, `/api/calendar/notes/${id}`, 'DELETE');
  assert.equal(del.status, 200);
});

test('a note needs a title and a valid date, and only designers can add them', async () => {
  assert.equal((await send(tok, '/api/calendar/notes', 'POST', { date: '2026-09-12', title: '  ' })).status, 400);
  assert.equal((await send(tok, '/api/calendar/notes', 'POST', { date: 'tomorrow', title: 'x' })).status, 400);
  const { default: User } = await import('../models/User.js');
  const { generateToken } = await import('../utils/token.js');
  const coord = await User.findOne({ email: 'coco@t.com' });
  assert.equal((await send(generateToken(coord._id), '/api/calendar/notes', 'POST', { date: '2026-09-12', title: 'x' })).status, 403);
});
