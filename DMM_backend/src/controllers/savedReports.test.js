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
const { generateToken } = await import('../utils/token.js');
const { ROLES } = await import('../config/constants.js');

let mongod; let server; let origin; let suTok; let adminTok; let orgId;

before(async () => {
  mongod = await MongoMemoryServer.create();
  await mongoose.connect(mongod.getUri());
  const org = await Organization.create({ name: 'Test College', slug: 'test-college' });
  orgId = String(org._id);
  const [su, admin] = await User.create([
    { name: 'Super', email: 'su@t.com', password: 'Passw0rd!', role: ROLES.ADMIN, isSuperAdmin: true },
    { name: 'Plain Admin', email: 'ad@t.com', password: 'Passw0rd!', role: ROLES.ADMIN },
  ]);
  suTok = generateToken(su._id); adminTok = generateToken(admin._id);
  await SocialPost.create({ organization: org._id, platform: 'Instagram', postId: 'i1', caption: 'Admissions open', publishedAt: new Date('2026-10-14T05:00:00Z'), likes: 40, reach: 900 });
  server = app.listen(0);
  await new Promise((r) => server.once('listening', r));
  origin = `http://127.0.0.1:${server.address().port}`;
});
after(async () => { server?.close(); await mongoose.disconnect(); await mongod?.stop(); });

const pdf = (token, qs) => fetch(`${origin}/api/reports/period/export-pdf?${qs}`, { headers: { Authorization: `Bearer ${token}` } })
  .then(async (r) => ({ status: r.status, headers: r.headers, body: Buffer.from(await r.arrayBuffer()) }));
const json = (token, path, method = 'GET') => fetch(`${origin}${path}`, { method, headers: { Authorization: `Bearer ${token}` } })
  .then(async (r) => ({ status: r.status, body: await r.json() }));

const OCT = 'from=2026-10-01&to=2026-10-31';

test('the first request builds the report and keeps it; the same span opens the kept copy', async () => {
  const first = await pdf(suTok, OCT);
  assert.equal(first.status, 200);
  assert.equal(first.body.subarray(0, 4).toString(), '%PDF');
  assert.equal(first.headers.get('x-report-reused'), '0');
  assert.equal(await SavedReport.countDocuments(), 1);

  const again = await pdf(suTok, OCT);
  assert.equal(again.status, 200);
  assert.equal(again.headers.get('x-report-reused'), '1', 'the same span is opened, not rebuilt');
  assert.equal(again.headers.get('x-report-saved-at'), first.headers.get('x-report-saved-at'));
  assert.deepEqual(again.body, first.body, 'it is the very same file');
  assert.equal(await SavedReport.countDocuments(), 1, 'nothing new was created');
});

test('a different span, college or platform is a different report', async () => {
  const other = await pdf(suTok, `${OCT}&platform=Instagram`);
  assert.equal(other.headers.get('x-report-reused'), '0');
  const oneCollege = await pdf(suTok, `${OCT}&organizationId=${orgId}`);
  assert.equal(oneCollege.headers.get('x-report-reused'), '0');
  assert.equal(await SavedReport.countDocuments(), 3);
});

test('fresh=1 rebuilds and replaces the kept copy rather than adding another', async () => {
  const before = await SavedReport.countDocuments();
  const fresh = await pdf(suTok, `${OCT}&fresh=1`);
  assert.equal(fresh.headers.get('x-report-reused'), '0');
  assert.equal(await SavedReport.countDocuments(), before);
});

test('the super admin can list, open and delete kept reports; an ordinary admin cannot, and keeps none', async () => {
  const list = await json(suTok, '/api/reports/period/saved');
  assert.equal(list.status, 200);
  assert.ok(list.body.reports.length >= 3);
  assert.ok(!('pdf' in list.body.reports[0]), 'the file itself is not sent in the list');

  const id = list.body.reports[0]._id;
  const open = await fetch(`${origin}/api/reports/period/saved/${id}`, { headers: { Authorization: `Bearer ${suTok}` } });
  assert.equal(open.status, 200);
  assert.equal((await open.arrayBuffer()).byteLength > 1000, true);

  assert.equal((await json(adminTok, '/api/reports/period/saved')).status, 403);
  assert.equal((await json(adminTok, `/api/reports/period/saved/${id}`)).status, 403);

  const before = await SavedReport.countDocuments();
  const theirs = await pdf(adminTok, `from=2026-09-01&to=2026-09-30&platform=Instagram`);
  assert.ok([200, 404].includes(theirs.status));
  assert.equal(theirs.headers.get('x-report-saved-at'), null);
  const sameAgain = await pdf(adminTok, OCT);
  assert.equal(sameAgain.status, 200);
  assert.equal(sameAgain.headers.get('x-report-reused'), '0', 'an ordinary admin always gets a freshly built report');
  assert.equal(await SavedReport.countDocuments(), before, 'an ordinary admin\'s report is never kept or reused');

  const del = await json(suTok, `/api/reports/period/saved/${id}`, 'DELETE');
  assert.equal(del.status, 200);
  assert.equal(await SavedReport.countDocuments(), before - 1);
});
