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
const { default: Notification } = await import('../models/Notification.js');
const { generateToken } = await import('../utils/token.js');
const { ROLES, USER_TYPES } = await import('../config/constants.js');

let mongod; let server; let origin;
const tok = {}; const ids = {};

before(async () => {
  mongod = await MongoMemoryServer.create();
  await mongoose.connect(mongod.getUri());
  const org = await Organization.create({ name: 'Test College', slug: 'test-college' });
  const [su, admin, coord, designer] = await User.create([
    { name: 'Super', email: 'su@t.com', password: 'Passw0rd!', role: ROLES.ADMIN, isSuperAdmin: true },
    { name: 'Ada', email: 'ada@t.com', password: 'Passw0rd!', role: ROLES.CEO, organization: org._id },
    { name: 'Coco', email: 'coco@t.com', password: 'Passw0rd!', role: ROLES.USER, userType: USER_TYPES.COORDINATOR, organization: org._id },
    { name: 'Dee', email: 'dee@t.com', password: 'Passw0rd!', role: ROLES.USER, userType: USER_TYPES.DESIGNER, organization: org._id },
  ]);
  Object.assign(ids, { su: su._id, admin: admin._id, coord: coord._id });
  Object.assign(tok, { su: generateToken(su._id), admin: generateToken(admin._id), coord: generateToken(coord._id), designer: generateToken(designer._id) });
  server = app.listen(0);
  await new Promise((r) => server.once('listening', r));
  origin = `http://127.0.0.1:${server.address().port}`;
});
after(async () => { server?.close(); await mongoose.disconnect(); await mongod?.stop(); });

const api = (token, path, { method = 'GET', body } = {}) => fetch(`${origin}${path}`, {
  method,
  headers: { Authorization: `Bearer ${token}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
  ...(body ? { body: JSON.stringify(body) } : {}),
}).then(async (r) => ({ status: r.status, body: await r.json() }));

// a working day well ahead (never a Sunday)
const workingDay = (plusDays) => {
  const d = new Date(Date.now() + plusDays * 86400000);
  if (d.getUTCDay() === 0) d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
};

const raise = async (title) => {
  await InstitutionRequest.updateMany({ raisedBy: ids.coord, workflowStage: { $in: ['DESIGN_COORDINATOR_REVIEW'] } }, { $set: { workflowStage: 'COMPLETED' } });
  const fd = new FormData();
  Object.entries({ title, details: 'Original notes', workType: 'PRINT_MEDIA', category: 'Content', workCategory: 'Print', workItem: 'Posters', department: 'CSE', neededBy: workingDay(60) })
    .forEach(([k, v]) => fd.append(k, v));
  const res = await fetch(`${origin}/api/requests`, { method: 'POST', headers: { Authorization: `Bearer ${tok.coord}` }, body: fd });
  const body = await res.json();
  assert.equal(res.status, 201, JSON.stringify(body));
  return body.request;
};
const changes = (extra = {}) => ({ title: 'Changed title', details: 'New notes', ...extra });

test('a coordinator can ask to change a request nobody has taken, and the admins are told', async () => {
  const r = await raise('First');
  const ask = await api(tok.coord, `/api/workflow/${r._id}/edit-request`, { method: 'POST', body: { reason: 'Wrong department details', changes: changes() } });
  assert.equal(ask.status, 201);
  assert.equal(ask.body.item.editRequest.status, 'PENDING');
  assert.equal(ask.body.item.title, 'First', 'nothing changes until it is approved');
  const toSuper = await Notification.find({ recipient: ids.su, type: 'EDIT_REQUESTED' });
  const toAdmin = await Notification.find({ recipient: ids.admin, type: 'EDIT_REQUESTED' });
  assert.equal(toSuper.length, 1); assert.equal(toAdmin.length, 1);
});

test('while a change is waiting, a designer cannot acknowledge the request', async () => {
  const r = await raise('Locked');
  await api(tok.coord, `/api/workflow/${r._id}/edit-request`, { method: 'POST', body: { reason: 'Need a fix', changes: changes() } });
  const view = await api(tok.designer, `/api/workflow/${r._id}`);
  assert.equal(view.body.item.can.acknowledgeDesign, false);
  const ack = await api(tok.designer, `/api/workflow/${r._id}/acknowledge`, { method: 'PUT' });
  assert.equal(ack.status, 409);
  assert.match(ack.body.message, /asked to change/i);
  assert.equal((await InstitutionRequest.findById(r._id)).designer, null);
  // and a second ask cannot pile on
  const again = await api(tok.coord, `/api/workflow/${r._id}/edit-request`, { method: 'POST', body: { reason: 'Again', changes: changes({ title: 'Other' }) } });
  assert.equal(again.status, 409);
});

test('approving applies the change and frees the request for the designer', async () => {
  const r = await raise('To approve');
  await api(tok.coord, `/api/workflow/${r._id}/edit-request`, { method: 'POST', body: { reason: 'Better wording', changes: changes() } });
  const decide = await api(tok.admin, `/api/workflow/${r._id}/edit-request/decide`, { method: 'PUT', body: { action: 'APPROVE' } });
  assert.equal(decide.status, 200);
  assert.equal(decide.body.item.title, 'Changed title');
  assert.equal(decide.body.item.details, 'New notes');
  assert.equal(decide.body.item.editRequest.status, 'APPROVED');
  assert.equal((await Notification.find({ recipient: ids.coord, type: 'EDIT_DECIDED' })).length >= 1, true);
  const ack = await api(tok.designer, `/api/workflow/${r._id}/acknowledge`, { method: 'PUT' });
  assert.equal(ack.status, 200);
});

test('rejecting needs a reason, leaves the request as it was, and frees it for the designer', async () => {
  const r = await raise('To reject');
  await api(tok.coord, `/api/workflow/${r._id}/edit-request`, { method: 'POST', body: { reason: 'Change please', changes: changes() } });
  const noNote = await api(tok.su, `/api/workflow/${r._id}/edit-request/decide`, { method: 'PUT', body: { action: 'REJECT' } });
  assert.equal(noNote.status, 400);
  const rej = await api(tok.su, `/api/workflow/${r._id}/edit-request/decide`, { method: 'PUT', body: { action: 'REJECT', note: 'The brief is fine as it is' } });
  assert.equal(rej.status, 200);
  assert.equal(rej.body.item.title, 'To reject');
  assert.equal(rej.body.item.editRequest.status, 'REJECTED');
  const ack = await api(tok.designer, `/api/workflow/${r._id}/acknowledge`, { method: 'PUT' });
  assert.equal(ack.status, 200);
});

test('once a designer has taken it, the coordinator can no longer ask to change it', async () => {
  const r = await raise('Taken');
  await api(tok.designer, `/api/workflow/${r._id}/acknowledge`, { method: 'PUT' });
  const ask = await api(tok.coord, `/api/workflow/${r._id}/edit-request`, { method: 'POST', body: { reason: 'Too late', changes: changes() } });
  assert.equal(ask.status, 409);
});

test('only the coordinator who raised it can ask, and only admins can decide', async () => {
  const r = await raise('Rules');
  const byDesigner = await api(tok.designer, `/api/workflow/${r._id}/edit-request`, { method: 'POST', body: { reason: 'Hmm', changes: changes() } });
  assert.equal(byDesigner.status, 403);
  await api(tok.coord, `/api/workflow/${r._id}/edit-request`, { method: 'POST', body: { reason: 'Real', changes: changes() } });
  const byCoord = await api(tok.coord, `/api/workflow/${r._id}/edit-request/decide`, { method: 'PUT', body: { action: 'APPROVE' } });
  assert.equal(byCoord.status, 403);
});

test('the proposed date follows the same rules as raising a request', async () => {
  const r = await raise('Dates');
  let sunday = new Date(Date.now() + 70 * 86400000); while (sunday.getUTCDay() !== 0) sunday = new Date(sunday.getTime() + 86400000);
  const bad = await api(tok.coord, `/api/workflow/${r._id}/edit-request`, { method: 'POST', body: { reason: 'Move it', changes: { neededBy: sunday.toISOString().slice(0, 10) } } });
  assert.equal(bad.status, 400);
  assert.match(bad.body.message, /sunday or a holiday/i);
  const none = await api(tok.coord, `/api/workflow/${r._id}/edit-request`, { method: 'POST', body: { reason: 'Nothing', changes: {} } });
  assert.equal(none.status, 400);
});

test('the coordinator can take a pending change back, which frees the request', async () => {
  const r = await raise('Withdraw');
  await api(tok.coord, `/api/workflow/${r._id}/edit-request`, { method: 'POST', body: { reason: 'Oops', changes: changes() } });
  const back = await api(tok.coord, `/api/workflow/${r._id}/edit-request`, { method: 'DELETE' });
  assert.equal(back.status, 200);
  const ack = await api(tok.designer, `/api/workflow/${r._id}/acknowledge`, { method: 'PUT' });
  assert.equal(ack.status, 200);
});
