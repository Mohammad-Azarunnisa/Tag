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

let mongod; let server; let origin; let coord; let other; let coordToken;

before(async () => {
  mongod = await MongoMemoryServer.create();
  await mongoose.connect(mongod.getUri());
  const ncet = await Organization.create({ name: 'NCET', slug: 'ncet' });
  const ncms = await Organization.create({ name: 'NCMS', slug: 'ncms' });
  coord = await User.create({ name: 'Coco', email: 'coco@t.com', password: 'Passw0rd!', role: ROLES.USER, userType: USER_TYPES.COORDINATOR, organization: ncet._id });
  other = await User.create({ name: 'Nia', email: 'nia@t.com', password: 'Passw0rd!', role: ROLES.USER, userType: USER_TYPES.COORDINATOR, organization: ncms._id });
  coordToken = generateToken(coord._id);

  const now = new Date();
  const longAgo = new Date(now.getTime() - 20 * 86400000);
  const mk = (extra) => InstitutionRequest.create({ organization: ncet._id, raisedBy: coord._id, title: 'Req', workType: 'DIGITAL_MEDIA', ...extra });
  await mk({ title: 'Raised today', workflowStage: 'DESIGN_OPEN' });
  await mk({ title: 'Delivered today', workflowStage: 'POST_OPEN', designAcceptedAt: now });
  await mk({ title: 'Waiting on me', workflowStage: 'DESIGN_COORDINATOR_REVIEW', createdAt: longAgo });
  await mk({ title: 'Old overdue', workflowStage: 'DESIGN_IN_PROGRESS', createdAt: longAgo, neededBy: new Date(now.getTime() - 3 * 86400000) });
  // a colleague's request in the same college is not the coordinator's own work either
  await InstitutionRequest.create({ organization: ncet._id, raisedBy: other._id, title: 'Colleague ask', workType: 'DIGITAL_MEDIA', workflowStage: 'DESIGN_OPEN' });
  await InstitutionRequest.create({ organization: ncet._id, raisedBy: other._id, title: 'Colleague waiting', workType: 'DIGITAL_MEDIA', workflowStage: 'DESIGN_COORDINATOR_REVIEW' });
  // another college's work must never show up
  await InstitutionRequest.create({ organization: ncms._id, raisedBy: other._id, title: 'Not mine', workType: 'DIGITAL_MEDIA', workflowStage: 'DESIGN_OPEN' });

  server = app.listen(0);
  await new Promise((r) => server.once('listening', r));
  origin = `http://127.0.0.1:${server.address().port}`;
});

after(async () => { server?.close(); await mongoose.disconnect(); await mongod?.stop(); });

test('the coordinator sees today\'s figures for their own college only', async () => {
  const res = await fetch(`${origin}/api/dashboard/today`, { headers: { Authorization: `Bearer ${coordToken}` } });
  assert.equal(res.status, 200);
  const { today, week } = await res.json();
  assert.equal(today.raised, 2); // 'Raised today' + 'Delivered today' were created now; NCMS's is not counted
  assert.equal(today.delivered, 1);
  assert.equal(today.waitingOnYou.count, 1);
  assert.equal(today.waitingOnYou.items[0].title, 'Waiting on me');
  assert.equal(today.withDesigners, 2); // DESIGN_OPEN + DESIGN_IN_PROGRESS
  assert.equal(today.overdue, 1);
  assert.equal(week.length, 7);
  const last = week[6];
  assert.equal(last.raised, 2);
  assert.equal(last.delivered, 1);
});
