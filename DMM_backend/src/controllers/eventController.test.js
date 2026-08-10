import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';

process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret';
process.env.STORAGE_DRIVER = 'local';
process.env.LOCAL_STORAGE_ROOT = '';
// No Drive credentials in tests, which is the point: a linked event must not need them.
process.env.GOOGLE_DRIVE_CREDENTIALS_PATH = './does-not-exist.json';
process.env.GOOGLE_DRIVE_TOKEN_PATH = './does-not-exist.json';

const { default: app } = await import('../app.js');
const { default: User } = await import('../models/User.js');
const { default: Organization } = await import('../models/Organization.js');
const { generateToken } = await import('../utils/token.js');
const { ROLES } = await import('../config/constants.js');

let mongod;
let server;
let origin;
let token;
let orgId;

before(async () => {
  mongod = await MongoMemoryServer.create();
  await mongoose.connect(mongod.getUri());
  const org = await Organization.create({ name: 'Test College', slug: 'test-college' });
  orgId = String(org._id);
  const su = await User.create({ name: 'Super', email: 's@t.com', password: 'Passw0rd!', role: ROLES.ADMIN, isSuperAdmin: true });
  token = generateToken(su._id);
  server = app.listen(0);
  await new Promise((r) => server.once('listening', r));
  origin = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  server?.close();
  await mongoose.disconnect();
  await mongod?.stop();
});

const png = () => new Blob([Buffer.from('fake-png')], { type: 'image/png' });

const send = (method, path, fields, cover) => {
  const fd = new FormData();
  Object.entries(fields).forEach(([k, v]) => fd.append(k, v));
  if (cover) fd.append('coverImage', png(), 'cover.png');
  return fetch(`${origin}${path}`, { method, headers: { Authorization: `Bearer ${token}` }, body: fd })
    .then(async (r) => ({ status: r.status, body: await r.json() }));
};

test('an event with a photos link is created without Drive being connected', async () => {
  const { status, body } = await send('POST', '/api/events', {
    name: 'Tech Fest', organization: orgId, link: 'https://drive.google.com/drive/folders/abc',
  });
  assert.equal(status, 201, JSON.stringify(body));
  assert.equal(body.event.link, 'https://drive.google.com/drive/folders/abc');
  assert.equal(body.event.driveFolderId, '', 'no folder should be created when a link is given');
});

test('the cover image is optional and stored by the app, not Drive', async () => {
  const { status, body } = await send('POST', '/api/events', {
    name: 'With cover', organization: orgId, link: 'https://example.com/album',
  }, true);
  assert.equal(status, 201);
  assert.match(body.event.coverImage, /^\/uploads\/events\//, 'cover goes to the app storage driver');
  assert.ok(body.event.coverImagePublicId);
});

test('without a link, Drive is still required — the original behaviour', async () => {
  const { status, body } = await send('POST', '/api/events', { name: 'No link', organization: orgId });
  assert.equal(status, 503);
  assert.match(body.message, /Google Drive/);
});

test('a malformed link is refused rather than saved', async () => {
  const { status, body } = await send('POST', '/api/events', { name: 'Bad', organization: orgId, link: 'drive.google.com/x' });
  assert.equal(status, 400);
  assert.match(body.message, /http/);
});

test('the link can be edited, and a cover added later', async () => {
  const created = await send('POST', '/api/events', { name: 'Editable', organization: orgId, link: 'https://example.com/a' });
  const id = created.body.event._id;
  const { status, body } = await send('PUT', `/api/events/${id}`, { link: 'https://example.com/b' }, true);
  assert.equal(status, 200);
  assert.equal(body.event.link, 'https://example.com/b');
  assert.match(body.event.coverImage, /^\/uploads\/events\//);
});

test('the link cannot be cleared when there is no Drive folder to fall back on', async () => {
  const created = await send('POST', '/api/events', { name: 'Link only', organization: orgId, link: 'https://example.com/c' });
  const id = created.body.event._id;
  const { status, body } = await send('PUT', `/api/events/${id}`, { link: '' });
  assert.equal(status, 400, 'otherwise "Open in Drive" would lead nowhere');
  assert.match(body.message, /needs a photos link/);
});
