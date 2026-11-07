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
const { default: SocialPost } = await import('../models/SocialPost.js');
const { default: SavedReport } = await import('../models/SavedReport.js');
const { ensureRecentMonthlyReports } = await import('./periodReportController.js');
const { generateToken } = await import('../utils/token.js');
const { ROLES } = await import('../config/constants.js');

// The most recent finished month, worked out from the clock so the test never goes stale.
const now = new Date();
const ym = (y, m) => `${y}-${String(m).padStart(2, '0')}`;
const prev = (back) => { const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - back, 1)); return { y: d.getUTCFullYear(), m: d.getUTCMonth() + 1 }; };
const LATEST = ym(prev(1).y, prev(1).m);
const EMPTY = ym(prev(2).y, prev(2).m); // a finished month with nothing in it
const THIS_MONTH = ym(now.getUTCFullYear(), now.getUTCMonth() + 1);

let mongod; let server; let origin; let suTok; let adminTok; let ceoTok;

before(async () => {
  mongod = await MongoMemoryServer.create();
  await mongoose.connect(mongod.getUri());
  const org = await Organization.create({ name: 'Test College', slug: 'test-college' });
  const [su, admin, ceo] = await User.create([
    { name: 'Super', email: 'su@t.com', password: 'Passw0rd!', role: ROLES.ADMIN, isSuperAdmin: true },
    { name: 'Plain Admin', email: 'ad@t.com', password: 'Passw0rd!', role: ROLES.ADMIN },
    { name: 'Chief', email: 'ceo@t.com', password: 'Passw0rd!', role: ROLES.CEO, organization: org._id },
  ]);
  suTok = generateToken(su._id); adminTok = generateToken(admin._id); ceoTok = generateToken(ceo._id);
  const p = prev(1);
  await SocialPost.create({ organization: org._id, platform: 'Instagram', postId: 'm1', caption: 'Admissions open', publishedAt: new Date(Date.UTC(p.y, p.m - 1, 15, 6)), likes: 40, reach: 900 });
  server = app.listen(0);
  await new Promise((r) => server.once('listening', r));
  origin = `http://127.0.0.1:${server.address().port}`;
});
after(async () => { server?.close(); await mongoose.disconnect(); await mongod?.stop(); });

const get = (token, path) => fetch(`${origin}${path}`, { headers: { Authorization: `Bearer ${token}` } })
  .then(async (r) => ({ status: r.status, headers: r.headers, buf: Buffer.from(await r.arrayBuffer()) }));
const asJson = (r) => JSON.parse(r.buf.toString());

test('the archive lists the last twelve finished months, newest first, none stored yet', async () => {
  const r = await get(adminTok, '/api/reports/monthly');
  assert.equal(r.status, 200);
  const { months } = asJson(r);
  assert.equal(months.length, 12);
  assert.equal(months[0].month, LATEST);
  assert.ok(months.every((m, i) => i === 0 || months[i - 1].month > m.month), 'newest first');
  assert.ok(months.every((m) => m.stored === false));
  assert.ok(!months.some((m) => m.month === THIS_MONTH), 'a month still running is not archived');
});

test('a month is built once and every admin who opens it gets that same stored file', async () => {
  // two people open the same month at the same moment
  const [a, b] = await Promise.all([get(adminTok, `/api/reports/monthly/${LATEST}`), get(suTok, `/api/reports/monthly/${LATEST}`)]);
  assert.equal(a.status, 200); assert.equal(b.status, 200);
  assert.equal(a.buf.subarray(0, 4).toString(), '%PDF');
  assert.deepEqual(a.buf, b.buf, 'both got the same file');
  assert.equal(await SavedReport.countDocuments(), 1, 'it was built once, not twice');

  const later = await get(adminTok, `/api/reports/monthly/${LATEST}?download=1`);
  assert.match(later.headers.get('content-disposition'), /^attachment;/);
  assert.deepEqual(later.buf, a.buf);
  assert.equal(await SavedReport.countDocuments(), 1);

  const { months } = asJson(await get(adminTok, '/api/reports/monthly'));
  const m = months.find((x) => x.month === LATEST);
  assert.equal(m.stored, true);
  assert.ok(m.size > 1000);
});

test('the Previous Month download opens the very same stored copy', async () => {
  const r = await get(suTok, '/api/reports/period/export-pdf?preset=last-month');
  assert.equal(r.status, 200);
  assert.equal(r.headers.get('x-report-reused'), '1');
  assert.equal(await SavedReport.countDocuments(), 1);
});

test('a month with nothing in it, a month still running, and a bad month are refused', async () => {
  assert.equal((await get(adminTok, `/api/reports/monthly/${EMPTY}`)).status, 404);
  assert.equal(await SavedReport.countDocuments(), 1, 'nothing was stored for it');
  assert.equal((await get(adminTok, `/api/reports/monthly/${THIS_MONTH}`)).status, 400);
  assert.equal((await get(adminTok, '/api/reports/monthly/2026-13')).status, 400);
  assert.equal((await get(adminTok, '/api/reports/monthly/abc')).status, 400);
});

test('only Admins can reach the archive', async () => {
  assert.equal((await get(ceoTok, '/api/reports/monthly')).status, 403);
  assert.equal((await get(ceoTok, `/api/reports/monthly/${LATEST}`)).status, 403);
  const anon = await fetch(`${origin}/api/reports/monthly`);
  assert.equal(anon.status, 401);
});

test('the start-up catch-up stores nothing twice and tolerates empty months', async () => {
  const before = await SavedReport.countDocuments();
  const made = await ensureRecentMonthlyReports(3);
  assert.deepEqual(made, [], 'the month that has data is already stored; the others had nothing');
  assert.equal(await SavedReport.countDocuments(), before);
});
