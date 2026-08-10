import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';

process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret';

const { default: app } = await import('../app.js');
const { default: User } = await import('../models/User.js');
const { default: Organization } = await import('../models/Organization.js');
const { ROLES, USER_TYPES } = await import('../config/constants.js');

let mongod;
let server;
let base;

const PASSWORD = 'Passw0rd!';

before(async () => {
  mongod = await MongoMemoryServer.create();
  await mongoose.connect(mongod.getUri());
  const org = await Organization.create({ name: 'Test College', slug: 'test-college' });
  await User.create([
    { name: 'Super', email: 'super@test.com', password: PASSWORD, role: ROLES.ADMIN, isSuperAdmin: true },
    { name: 'Head', email: 'head@test.com', password: PASSWORD, role: ROLES.CEO, organization: org._id },
    { name: 'Dee', email: 'designer@test.com', password: PASSWORD, role: ROLES.USER, userType: USER_TYPES.DESIGNER, organization: org._id },
  ]);
  server = app.listen(0);
  await new Promise((r) => server.once('listening', r));
  base = `http://127.0.0.1:${server.address().port}/api/auth/login`;
});

after(async () => {
  server?.close();
  await mongoose.disconnect();
  await mongod?.stop();
});

const login = async (email, portal) => {
  const res = await fetch(base, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(portal === undefined ? { email, password: PASSWORD } : { email, password: PASSWORD, portal }),
  });
  return { status: res.status, body: await res.json() };
};

test('an admin account is refused by the product app and pointed at the console', async () => {
  const { status, body } = await login('super@test.com', 'user');
  assert.equal(status, 403);
  assert.match(body.message, /Admin account.*Admin Portal/);
});

test('a request that names no portal is treated as the product app', async () => {
  const { status } = await login('super@test.com', undefined);
  assert.equal(status, 403, 'the default must be the closed side, not an open door');
});

test('an admin account signs in through the console', async () => {
  const { status, body } = await login('super@test.com', 'admin');
  assert.equal(status, 200);
  assert.ok(body.token);
  assert.equal(body.user.role, ROLES.ADMIN);
});

// An Admin heading institutions (role CEO) administers them — sees their users,
// assigns work, approves content, answers requests — and every one of those
// screens lives in the console. Refusing them there left them with nowhere to do
// the job, so the console now admits them alongside the super admin.
test('an institution Admin reaches the console', async () => {
  const { status, body } = await login('head@test.com', 'admin');
  assert.equal(status, 200);
  assert.ok(body.token);
  assert.equal(body.user.role, ROLES.CEO);
  assert.equal(body.user.isSuperAdmin, false, 'without becoming the super admin');
  assert.equal(body.user.viewOnly, false, 'the console gates its actions on this, so it must be sent');
});

test('a college account is still refused by the console and pointed at the product app', async () => {
  const { status, body } = await login('designer@test.com', 'admin');
  assert.equal(status, 403, 'a designer must not reach the console');
  assert.match(body.message, /User account.*User Portal/);
});

test('college accounts still sign in to the product app', async () => {
  const { status, body } = await login('designer@test.com', 'user');
  assert.equal(status, 200, 'a designer must keep its access');
  assert.ok(body.token);
});

// The console is an administrator's only door. Letting them into the product app
// as well just showed them a college's screens with none of their own work on
// them, which is what sent an Admin hunting for a Requests page that only ever
// existed in the console.
test('an institution Admin is refused by the product app and pointed at the console', async () => {
  const { status, body } = await login('head@test.com', 'user');
  assert.equal(status, 403);
  assert.match(body.message, /Admin account.*Admin Portal/);
});

// An Admin's institutions can come entirely from grants, so requiring a home
// organization would lock out an admin who heads no single college.
test('an Admin holding only granted institutions can still sign in', async () => {
  const extra = await Organization.create({ name: 'Granted College', slug: 'granted' });
  await User.create({
    name: 'GrantsOnly', email: 'grants@test.com', password: PASSWORD,
    role: ROLES.CEO, organization: null, managedOrganizations: [extra._id],
  });
  const { status, body } = await login('grants@test.com', 'admin');
  assert.equal(status, 200, 'grants alone are a real working set');
  assert.ok(body.token);
});

test('an Admin assigned no institution at all is refused', async () => {
  await User.create({
    name: 'Nowhere', email: 'nowhere@test.com', password: PASSWORD,
    role: ROLES.CEO, organization: null, managedOrganizations: [],
  });
  const { status, body } = await login('nowhere@test.com', 'admin');
  assert.equal(status, 403);
  assert.match(body.message, /not assigned to any institution/);
});

test('wrong credentials are still a 401, whichever portal asked', async () => {
  const res = await fetch(base, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'super@test.com', password: 'wrong', portal: 'user' }),
  });
  assert.equal(res.status, 401, 'the portal check must not leak which accounts exist');
});
