import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';

process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret';

const { default: app } = await import('../app.js');
const { default: User } = await import('../models/User.js');
const { default: Organization } = await import('../models/Organization.js');
const { default: InstitutionRequest } = await import('../models/InstitutionRequest.js');
const { default: WorkAssignment } = await import('../models/WorkAssignment.js');
const { default: Analytics } = await import('../models/Analytics.js');
const { generateToken } = await import('../utils/token.js');
const { ROLES, USER_TYPES } = await import('../config/constants.js');

let mongod;
let server;
let origin;
let token;

before(async () => {
  mongod = await MongoMemoryServer.create();
  await mongoose.connect(mongod.getUri());
  const org = await Organization.create({ name: 'Test College', slug: 'test-college' });
  const su = await User.create({ name: 'Super', email: 's@t.com', password: 'Passw0rd!', role: ROLES.ADMIN, isSuperAdmin: true });
  token = generateToken(su._id);

  const raise = (title, when) => InstitutionRequest.create({
    organization: org._id, raisedBy: su._id, title, details: 'x',
    category: 'Budget', status: 'OPEN', createdAt: new Date(when),
  });
  // createdAt is managed by timestamps, so set it explicitly afterwards.
  for (const [title, when] of [['Old ask', '2026-01-10'], ['Mid ask', '2026-03-15'], ['New ask', '2026-06-20']]) {
    const doc = await raise(title, when);
    await InstitutionRequest.updateOne({ _id: doc._id }, { $set: { createdAt: new Date(when) } }, { timestamps: false });
  }

  // Two platforms of analytics so the pulse filter has something to switch between.
  await Analytics.create([
    { organization: org._id, platform: 'LinkedIn', date: new Date('2026-06-20'), impressions: 1000, reactions: 50, followers: 900, newFollowers: 10 },
    { organization: org._id, platform: 'YouTube', date: new Date('2026-06-20'), views: 4000, comments: 20, reactions: 80, subscribers: 1200, newFollowers: 5 },
  ]);

  server = app.listen(0);
  await new Promise((r) => server.once('listening', r));
  origin = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  server?.close();
  await mongoose.disconnect();
  await mongod?.stop();
});

const get = (path) =>
  fetch(`${origin}${path}`, { headers: { Authorization: `Bearer ${token}` } }).then(async (r) => ({ status: r.status, body: await r.json() }));

const titles = (body) => body.requests.map((r) => r.title).sort();

test('college requests: no date filter returns everything', async () => {
  const { status, body } = await get('/api/requests');
  assert.equal(status, 200);
  assert.deepEqual(titles(body), ['Mid ask', 'New ask', 'Old ask']);
});

test('college requests: `from` keeps only what was raised on or after it', async () => {
  const { body } = await get('/api/requests?from=2026-03-01');
  assert.deepEqual(titles(body), ['Mid ask', 'New ask']);
});

test('college requests: `to` includes the whole of that day', async () => {
  const { body } = await get('/api/requests?to=2026-03-15');
  assert.deepEqual(titles(body), ['Mid ask', 'Old ask'], 'a request raised on the `to` date must be included');
});

test('college requests: both bounds narrow to the window', async () => {
  const { body } = await get('/api/requests?from=2026-02-01&to=2026-05-01');
  assert.deepEqual(titles(body), ['Mid ask']);
});

// The tiles on the requests page are a map of the whole workload, and each one
// doubles as the filter for its status. Counting out of the filtered list made
// every other tile read zero the moment one was clicked. Every status is counted,
// including the two the old approve/decline flow could set — a request decided
// back then must still be counted somewhere.
test('college requests: the tile counts ignore the status filter', async () => {
  const one = await InstitutionRequest.findOne({ title: 'Old ask' });
  await InstitutionRequest.updateOne({ _id: one._id }, { $set: { status: 'APPROVED' } });

  const unfiltered = await get('/api/requests');
  assert.deepEqual(unfiltered.body.counts, { OPEN: 2, IN_REVIEW: 0, GETTING_ALLOCATED: 0, WITH_SOCIAL_HANDLER: 0, APPROVED: 1, DECLINED: 0 });

  const filtered = await get('/api/requests?status=OPEN');
  assert.deepEqual(titles(filtered.body), ['Mid ask', 'New ask'], 'the list still narrows to the status');
  assert.deepEqual(filtered.body.counts, unfiltered.body.counts, 'the other tiles must not drop to zero');
});

// An Admin is scoped to their institutions, which reaches the counts as a list of
// id strings. An aggregate does not cast those the way find() does, so without an
// explicit cast every tile read zero for them.
test('college requests: an org-scoped Admin gets real counts, not zeros', async () => {
  const org = await Organization.findOne({ slug: 'test-college' });
  const ceo = await User.create({
    name: 'Admin', email: 'ceo@t.com', password: 'Passw0rd!', role: ROLES.CEO, organization: org._id,
  });
  const res = await fetch(`${origin}/api/requests?status=OPEN`, {
    headers: { Authorization: `Bearer ${generateToken(ceo._id)}` },
  });
  const body = await res.json();
  assert.equal(res.status, 200);
  assert.deepEqual(body.counts, { OPEN: 2, IN_REVIEW: 0, GETTING_ALLOCATED: 0, WITH_SOCIAL_HANDLER: 0, APPROVED: 1, DECLINED: 0 });
});

test('college requests: assigned users are included once work is allocated', async () => {
  const org = await Organization.findOne({ slug: 'test-college' });
  const coordinator = await User.create({
    name: 'Coco', email: 'coco-requests@t.com', password: 'Passw0rd!', role: ROLES.USER, userType: USER_TYPES.COORDINATOR, organization: org._id,
  });
  const designer = await User.create({
    name: 'Dee', email: 'dee-requests@t.com', password: 'Passw0rd!', role: ROLES.USER, userType: USER_TYPES.DESIGNER, organization: org._id,
  });
  const request = await InstitutionRequest.create({
    organization: org._id,
    raisedBy: coordinator._id,
    title: 'Placement creative',
    details: 'Need artwork for the campus fair',
    category: 'Content',
    status: 'GETTING_ALLOCATED',
  });
  await WorkAssignment.create({
    organization: org._id,
    title: 'Placement creative',
    assignee: designer._id,
    assigneeType: USER_TYPES.DESIGNER,
    createdBy: coordinator._id,
    sourceRequest: request._id,
  });

  const { body } = await get('/api/requests');
  const found = body.requests.find((row) => row.title === 'Placement creative');
  assert.ok(found, 'the request should still be listed');
  assert.equal(found.assignedUsers?.length, 1);
  assert.equal(found.assignedUsers[0].name, 'Dee');
});

test('pulse: defaults to LinkedIn, so existing callers are unaffected', async () => {
  const { status, body } = await get('/api/analytics/pulse');
  assert.equal(status, 200);
  assert.equal(body.platform, 'LinkedIn');
  assert.equal(body.labels.reach, 'Impressions');
  assert.equal(body.labels.audience, 'Total followers');
  const row = body.organizations.find((o) => o.hasData);
  assert.equal(row.impressions, 1000);
  assert.equal(row.followers, 900);
});

test('pulse: YouTube reads views and subscribers, and says so', async () => {
  const { body } = await get('/api/analytics/pulse?platform=YouTube');
  assert.equal(body.platform, 'YouTube');
  assert.equal(body.labels.reach, 'Views');
  assert.equal(body.labels.audience, 'Subscribers');
  const row = body.organizations.find((o) => o.hasData);
  assert.equal(row.impressions, 4000, 'reach comes from views on YouTube');
  assert.equal(row.followers, 1200, 'audience comes from subscribers on YouTube');
  assert.equal(row.engagementRate, +(((80 + 20) / 4000) * 100).toFixed(2));
});

test('pulse: a platform with no data reports hasData=false rather than failing', async () => {
  const { status, body } = await get('/api/analytics/pulse?platform=Instagram');
  assert.equal(status, 200);
  assert.equal(body.platform, 'Instagram');
  assert.ok(body.organizations.every((o) => !o.hasData));
});

test('pulse: an unknown platform falls back to LinkedIn instead of erroring', async () => {
  const { status, body } = await get('/api/analytics/pulse?platform=Threads');
  assert.equal(status, 200);
  assert.equal(body.platform, 'LinkedIn');
});

// An Admin (role CEO) decides on the colleges they hold, exactly as the super
// admin does everywhere — and their college filter has to actually narrow, which
// it silently did not: it returned every college they held whatever was picked.
test('an Admin decides on their own colleges, and their college filter narrows', async () => {
  const [alpha, beta, gamma] = await Organization.create([
    { name: 'Alpha College', slug: 'alpha' },
    { name: 'Beta College', slug: 'beta' },
    { name: 'Gamma College', slug: 'gamma' },
  ]);
  // Heads Alpha, granted Gamma, nothing to do with Beta.
  const admin = await User.create({
    name: 'AdminA', email: 'admin-a@t.com', password: 'Passw0rd!',
    role: ROLES.CEO, organization: alpha._id, managedOrganizations: [gamma._id],
  });
  const adminTok = generateToken(admin._id);

  const ask = (org, title) => InstitutionRequest.create({
    organization: org._id, raisedBy: admin._id, title, status: 'OPEN', category: 'Budget',
  });
  const aReq = await ask(alpha, 'Alpha ask');
  const bReq = await ask(beta, 'Beta ask');
  await ask(gamma, 'Gamma ask');

  const as = (path, init) => fetch(`${origin}${path}`, {
    headers: { Authorization: `Bearer ${adminTok}`, ...(init?.body ? { 'Content-Type': 'application/json' } : {}) },
    ...init,
  }).then(async (r) => ({ status: r.status, body: await r.json() }));

  const all = await as('/api/requests');
  const titles = all.body.requests.map((r) => r.title);
  assert.ok(titles.includes('Alpha ask') && titles.includes('Gamma ask'));
  assert.ok(!titles.includes('Beta ask'), 'a college they do not hold must not appear');

  // Reading is all they get. A request goes straight to the designers, so there
  // is nothing for an Admin or a super admin to approve or decline — the
  // endpoint that used to do it is gone rather than merely hidden in the UI.
  for (const target of [aReq, bReq]) {
    const decided = await as(`/api/requests/${target._id}/respond`, {
      method: 'PUT', body: JSON.stringify({ action: 'approve', response: 'go ahead' }),
    });
    assert.equal(decided.status, 404, 'there is no way to decide a request');
  }
  assert.equal((await InstitutionRequest.findById(aReq._id)).status, 'OPEN', 'and nothing moved');

  // The filter has to do something, and must not become a way to widen.
  const narrowed = await as(`/api/requests?organizationId=${gamma._id}`);
  assert.deepEqual(narrowed.body.requests.map((r) => r.title), ['Gamma ask']);

  const spoofed = await as(`/api/requests?organizationId=${beta._id}`);
  assert.equal(spoofed.body.requests.length, 0, 'asking for someone else’s college shows nothing');
});

// An Admin sees the institutions they hold on the Organizations screen, and only
// reads them: creating, editing and deleting a college stays platform work for
// the super admin.
test('an Admin reads their own institutions and cannot manage any', async () => {
  const [held, other] = await Organization.create([
    { name: 'Held College', slug: 'held' },
    { name: 'Someone Elses', slug: 'someone-elses' },
  ]);
  const admin = await User.create({
    name: 'OrgAdmin', email: 'org-admin@t.com', password: 'Passw0rd!',
    role: ROLES.CEO, organization: held._id,
  });
  const tok = generateToken(admin._id);
  const as = (path, init) => fetch(`${origin}${path}`, {
    headers: { Authorization: `Bearer ${tok}`, ...(init?.body ? { 'Content-Type': 'application/json' } : {}) },
    ...init,
  }).then(async (r) => ({ status: r.status, body: await r.json() }));

  const list = await as('/api/organizations');
  assert.equal(list.status, 200);
  const names = list.body.organizations.map((o) => o.name);
  assert.ok(names.includes('Held College'));
  assert.ok(!names.includes('Someone Elses'), 'a college they do not hold must not be listed');

  assert.equal((await as(`/api/organizations/${held._id}`)).status, 200, 'they may open their own');
  assert.equal((await as(`/api/organizations/${other._id}`)).status, 404, 'opening another by id is not a way round the list');

  // Read-only means read-only, whatever the UI is showing.
  assert.equal((await as('/api/organizations', { method: 'POST', body: JSON.stringify({ name: 'New College' }) })).status, 403);
  assert.equal((await as(`/api/organizations/${held._id}`, { method: 'DELETE' })).status, 403);
});

// The super admin's account is private to them. Everyone else is told one
// EXISTS — so they know there is somebody to escalate to — and nothing more.
test('the super admin account is a count to everyone else, never a record', async () => {
  const org = await Organization.create({ name: 'Privacy College', slug: 'privacy' });
  const boss = await User.create({
    name: 'Secret Boss', email: 'boss@secret.example', password: 'Passw0rd!',
    role: ROLES.ADMIN, isSuperAdmin: true,
  });
  const admin = await User.create({
    name: 'PrivAdmin', email: 'priv-admin@t.com', password: 'Passw0rd!',
    role: ROLES.CEO, organization: org._id,
  });
  const tok = generateToken(admin._id);
  const as = (path) => fetch(`${origin}${path}`, { headers: { Authorization: `Bearer ${tok}` } })
    .then(async (r) => ({ status: r.status, body: await r.json() }));

  const list = await as('/api/users');
  assert.equal(list.status, 200);
  // Counted against the database rather than a literal, since this suite seeds a
  // super admin of its own.
  const actual = await User.countDocuments({ isSuperAdmin: true, isActive: true });
  assert.equal(list.body.superAdminCount, actual, 'they must be able to see that one exists');
  assert.ok(actual >= 1);
  assert.ok(!list.body.users.some((u) => u.isSuperAdmin), 'but never as a row');
  assert.ok(!JSON.stringify(list.body).includes('boss@secret.example'), 'and no detail may leak anywhere in the payload');

  // Neither the filter nor the search is a way around it.
  assert.equal((await as('/api/users?role=ADMIN')).body.users.length, 0);
  assert.equal((await as('/api/users?search=Secret')).body.users.length, 0);
  // Nor is guessing the id.
  assert.equal((await as(`/api/users/${boss._id}`)).status, 403);

  // The super admin still sees their own account normally.
  const own = await fetch(`${origin}/api/users`, { headers: { Authorization: `Bearer ${generateToken(boss._id)}` } })
    .then((r) => r.json());
  assert.ok(own.users.some((u) => u.isSuperAdmin), 'the super admin sees themselves');
});

// The people directory: everyone gets their own college; a designer also gets
// every coordinator (any of them can send a brief) and the Admins over their
// college. The super admin and global oversight accounts never appear.
test('the directory shows each role the people they actually work with', async () => {
  const [dirOrg, otherOrg] = await Organization.create([
    { name: 'Dir College', slug: 'dir' }, { name: 'Other College', slug: 'other' },
  ]);
  const mk = (o) => User.create({ password: 'Passw0rd!', ...o });
  await mk({ name: 'Dir Boss', email: 'dir-boss@t.com', role: ROLES.ADMIN, isSuperAdmin: true });
  await mk({ name: 'Dir Chair', email: 'dir-chair@t.com', role: ROLES.ADMIN, viewOnly: true });
  await mk({ name: 'DirAdmin', email: 'dir-admin@t.com', role: ROLES.CEO, organization: dirOrg._id });
  const designer = await mk({ name: 'DirDesigner', email: 'dir-des@t.com', role: ROLES.USER, userType: 'DESIGNER', organization: dirOrg._id, phone: '55501' });
  const handler = await mk({ name: 'DirHandler', email: 'dir-han@t.com', role: ROLES.USER, userType: 'SOCIAL_HANDLER', organization: dirOrg._id });
  await mk({ name: 'DirCoord', email: 'dir-coord@t.com', role: ROLES.USER, userType: 'COORDINATOR', organization: dirOrg._id });
  await mk({ name: 'FarCoord', email: 'far-coord@t.com', role: ROLES.USER, userType: 'COORDINATOR', organization: otherOrg._id });
  await mk({ name: 'FarDesigner', email: 'far-des@t.com', role: ROLES.USER, userType: 'DESIGNER', organization: otherOrg._id });

  const dir = (user, qs = '') => fetch(`${origin}/api/users/directory${qs}`, {
    headers: { Authorization: `Bearer ${generateToken(user._id)}` },
  }).then(async (r) => ({ status: r.status, body: await r.json() }));

  const asDesigner = await dir(designer);
  assert.equal(asDesigner.status, 200);
  const dNames = asDesigner.body.people.map((p) => p.name);
  assert.ok(dNames.includes('DirCoord') && dNames.includes('DirHandler') && dNames.includes('DirAdmin'), 'their own college');
  assert.ok(dNames.includes('FarCoord'), 'every coordinator can brief a designer, so every coordinator is reachable');
  assert.ok(!dNames.includes('FarDesigner'), 'but not another college’s designers');
  assert.ok(!dNames.includes('Dir Boss'), 'the super admin is never listed');
  assert.ok(!dNames.includes('Dir Chair'), 'nor a global oversight account');
  // Contact details are the point of the screen.
  const self = asDesigner.body.people.find((p) => p.name === 'DirDesigner');
  assert.equal(self.phone, '55501');
  assert.equal(self.email, 'dir-des@t.com');
  assert.equal(self.organization.name, 'Dir College');

  // Everyone else is their own college only — no cross-college coordinators.
  const asHandler = await dir(handler);
  const hNames = asHandler.body.people.map((p) => p.name);
  assert.ok(hNames.includes('DirCoord') && hNames.includes('DirAdmin'));
  assert.ok(!hNames.includes('FarCoord'), 'a handler has no reason to see another college’s coordinator');

  assert.deepEqual((await dir(designer, '?search=55501')).body.people.map((p) => p.name), ['DirDesigner']);
});

// Each tile above the user list IS its filter. Two things have to hold: the tile
// returns exactly the accounts it counted, and the counts do NOT move when one
// is picked — otherwise clicking a tile zeroes all the others.
test('the user tiles filter to their own accounts and keep their counts', async () => {
  const org = await Organization.create({ name: 'Tile College', slug: 'tile' });
  const mk = (o) => User.create({ password: 'Passw0rd!', ...o });
  const boss = await mk({ name: 'Tile Boss', email: 'tile-boss@t.com', role: ROLES.ADMIN, isSuperAdmin: true });
  await mk({ name: 'Tile Chair', email: 'tile-chair@t.com', role: ROLES.ADMIN, viewOnly: true });
  await mk({ name: 'TileAdmin', email: 'tile-admin@t.com', role: ROLES.CEO, organization: org._id });
  await mk({ name: 'TileDesigner', email: 'tile-des@t.com', role: ROLES.USER, userType: 'DESIGNER', organization: org._id });

  const asSuper = (qs = '') => fetch(`${origin}/api/users${qs}`, {
    headers: { Authorization: `Bearer ${generateToken(boss._id)}` },
  }).then((r) => r.json());

  const all = await asSuper();
  const baseline = all.roleCounts;
  assert.ok(baseline.total > 0 && baseline.SUPER >= 1);

  const supers = await asSuper('?role=SUPER');
  assert.ok(supers.users.every((u) => u.isSuperAdmin), 'the Super Admin tile opens super admins');
  assert.ok(!supers.users.some((u) => u.name === 'Tile Chair'), 'a view-only oversight account is not the super admin');
  assert.deepEqual(supers.roleCounts, baseline, 'picking a tile must not move the other tiles');

  const admins = await asSuper('?role=CEO');
  assert.ok(admins.users.every((u) => u.role === ROLES.CEO));
  assert.deepEqual(admins.roleCounts, baseline);

  const users = await asSuper('?role=USER');
  assert.ok(users.users.every((u) => u.role === ROLES.USER));
  assert.deepEqual(users.roleCounts, baseline);

  // The privacy line still holds through the filter: an Admin asking for the
  // super admin gets nothing, not everyone.
  const admin = await User.findOne({ email: 'tile-admin@t.com' });
  const asAdmin = await fetch(`${origin}/api/users?role=SUPER`, {
    headers: { Authorization: `Bearer ${generateToken(admin._id)}` },
  }).then((r) => r.json());
  assert.equal(asAdmin.users.length, 0, 'the filter must not become a way round the privacy rule');
  assert.ok(asAdmin.roleCounts.SUPER >= 1, 'they are still told one exists');
});
