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
const { generateToken } = await import('../utils/token.js');
const { ROLES, USER_TYPES, PHOTOGRAPHERS_ENABLED } = await import('../config/constants.js');

let mongod; let server; let origin; let su; let org;

before(async () => {
  mongod = await MongoMemoryServer.create();
  await mongoose.connect(mongod.getUri());
  org = await Organization.create({ name: 'NCET', slug: 'ncet' });
  const a = await User.create({ name: 'Super', email: 'su@t.com', password: 'Passw0rd!', role: ROLES.ADMIN, isSuperAdmin: true });
  await User.create({ name: 'Cam', email: 'cam@t.com', password: 'Passw0rd!', role: ROLES.USER, userType: USER_TYPES.PHOTOGRAPHER });
  await User.create({ name: 'Dee', email: 'dee@t.com', password: 'Passw0rd!', role: ROLES.USER, userType: USER_TYPES.DESIGNER, organization: org._id });
  su = generateToken(a._id);
  server = app.listen(0);
  await new Promise((r) => server.once('listening', r));
  origin = `http://127.0.0.1:${server.address().port}`;
});
after(async () => { server?.close(); await mongoose.disconnect(); await mongod?.stop(); });

const call = async (path, { method = 'GET', token, body } = {}) => {
  const r = await fetch(`${origin}${path}`, {
    method,
    headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(body ? { 'Content-Type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: r.status, json: await r.json().catch(() => ({})) };
};

// While photographers are on hold (PHOTOGRAPHERS_ENABLED = false).
test('photographers are switched off: no sign-in, no booking API, not in user lists', { skip: PHOTOGRAPHERS_ENABLED }, async () => {
  const login = await call('/api/auth/login', { method: 'POST', body: { email: 'cam@t.com', password: 'Passw0rd!' } });
  assert.equal(login.status, 403);
  assert.match(login.json.message, /switched off/i);

  const ok = await call('/api/auth/login', { method: 'POST', body: { email: 'dee@t.com', password: 'Passw0rd!' } });
  assert.equal(ok.status, 200);

  const booking = await call('/api/photographers', { token: su });
  assert.equal(booking.status, 404);

  const users = await call('/api/users', { token: su });
  assert.equal(users.status, 200);
  assert.ok(!users.json.users.some((u) => u.userType === 'PHOTOGRAPHER'));

  const create = await call('/api/users', { method: 'POST', token: su, body: { name: 'New Cam', email: 'new@t.com', password: 'Passw0rd!', role: 'USER', userType: 'PHOTOGRAPHER' } });
  assert.equal(create.status, 400);
});
