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
const { default: LinkedInPost } = await import('../models/LinkedInPost.js');
const { generateToken } = await import('../utils/token.js');
const { ROLES, USER_TYPES } = await import('../config/constants.js');

let mongod; let server; let origin; let suTok; let coordTok; let orgId; let otherId;

before(async () => {
  mongod = await MongoMemoryServer.create();
  await mongoose.connect(mongod.getUri());
  const org = await Organization.create({ name: 'Test College', slug: 'test-college' });
  const other = await Organization.create({ name: 'Other College', slug: 'other-college' });
  orgId = String(org._id); otherId = String(other._id);
  const [su, coord] = await User.create([
    { name: 'Super', email: 'su@t.com', password: 'Passw0rd!', role: ROLES.ADMIN, isSuperAdmin: true },
    { name: 'Coco', email: 'coco@t.com', password: 'Passw0rd!', role: ROLES.USER, userType: USER_TYPES.COORDINATOR, organization: org._id },
  ]);
  suTok = generateToken(su._id); coordTok = generateToken(coord._id);
  await SocialPost.create([
    // 11:30pm IST on 14 Oct is 18:00 UTC on 14 Oct; 00:30 IST on 15 Oct is 19:00 UTC on 14 Oct — a different IST day
    { organization: org._id, platform: 'Instagram', postId: 'i1', caption: 'Admissions open', publishedAt: new Date('2026-10-14T05:00:00Z'), likes: 40, reach: 900, impressions: 1200, comments: 3, url: 'https://instagram.com/p/i1' },
    { organization: org._id, platform: 'Facebook', postId: 'f1', caption: 'Admissions open', publishedAt: new Date('2026-10-14T05:30:00Z'), likes: 12, reach: 300 },
    { organization: org._id, platform: 'YouTube', postId: 'y1', caption: 'Campus tour', publishedAt: new Date('2026-10-14T19:00:00Z'), views: 700, likes: 20 },
    { organization: other._id, platform: 'Instagram', postId: 'x1', caption: 'Other college', publishedAt: new Date('2026-10-14T05:00:00Z'), likes: 99 },
  ]);
  await LinkedInPost.create({ organization: org._id, title: 'Placement drive', createdDate: new Date('2026-10-14T00:00:00Z'), impressions: 5000, reactions: 77, comments: 4, reposts: 2, clicks: 90, url: 'https://linkedin.com/x' });
  server = app.listen(0);
  await new Promise((r) => server.once('listening', r));
  origin = `http://127.0.0.1:${server.address().port}`;
});
after(async () => { server?.close(); await mongoose.disconnect(); await mongod?.stop(); });

const get = (token, path) => fetch(`${origin}${path}`, { headers: { Authorization: `Bearer ${token}` } }).then(async (r) => ({ status: r.status, body: await r.json() }));

test('the month view counts what the platforms and the LinkedIn export report, per day and per platform', async () => {
  const r = await get(suTok, `/api/calendar?organizationId=${orgId}&month=2026-10`);
  assert.equal(r.status, 200);
  const d14 = r.body.days.find((d) => d.date === '2026-10-14');
  const d15 = r.body.days.find((d) => d.date === '2026-10-15');
  assert.equal(d14.count, 3, 'Instagram + Facebook + LinkedIn on the 14th');
  assert.deepEqual(d14.byPlatform, { Instagram: 1, Facebook: 1, LinkedIn: 1 });
  assert.equal(d15.count, 1, 'the YouTube video went out after midnight IST, so it is the 15th');
  assert.equal(r.body.total, 4);
  assert.equal(r.body.totalLikes, 40 + 12 + 20 + 77);
  assert.deepEqual(r.body.byPlatform, { Instagram: 1, Facebook: 1, YouTube: 1, LinkedIn: 1 });
});

test('the day view lists each post with the numbers its platform reports', async () => {
  const r = await get(suTok, `/api/calendar/day?organizationId=${orgId}&date=2026-10-14`);
  assert.equal(r.body.count, 3);
  const ig = r.body.posts.find((p) => p.platform === 'Instagram');
  assert.equal(ig.title, 'Admissions open');
  assert.equal(ig.url, 'https://instagram.com/p/i1');
  assert.equal(ig.metrics.likes, 40); assert.equal(ig.metrics.reach, 900); assert.equal(ig.metrics.impressions, 1200);
  const li = r.body.posts.find((p) => p.platform === 'LinkedIn');
  assert.equal(li.timeKnown, false, 'LinkedIn reports only a date');
  assert.equal(ig.timeKnown, true);
  assert.equal(r.body.posts[r.body.posts.length - 1].platform, 'LinkedIn', 'posts with no time of day are listed last');
  assert.equal(li.title, 'Placement drive'); assert.equal(li.metrics.likes, 77); assert.equal(li.metrics.clicks, 90); assert.equal(li.metrics.shares, 2);
  assert.equal(r.body.totals.likes, 40 + 12 + 77);
  assert.ok(!r.body.posts.some((p) => p.title === 'Other college'), 'another college\'s post is never shown');
});

test('a coordinator sees their own college only', async () => {
  const month = await get(coordTok, '/api/calendar?month=2026-10');
  assert.equal(month.body.total, 4);
  const spoof = await get(coordTok, `/api/calendar/day?organizationId=${otherId}&date=2026-10-14`);
  assert.ok(!spoof.body.posts.some((p) => p.title === 'Other college'));
});
