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
const { ROLES, USER_TYPES, SOCIAL_PLATFORMS } = await import('../config/constants.js');

let mongod; let server; let origin; let handlerTok; let otherHandlerTok; let designerTok;

before(async () => {
  mongod = await MongoMemoryServer.create();
  await mongoose.connect(mongod.getUri());
  const org = await Organization.create({ name: 'Test College', slug: 'test-college' });
  const other = await Organization.create({ name: 'Other College', slug: 'other-college' });
  const [coord, handler, otherHandler, designer] = await User.create([
    { name: 'Coco', email: 'coco@t.com', password: 'Passw0rd!', role: ROLES.USER, userType: USER_TYPES.COORDINATOR, organization: org._id },
    { name: 'Hana', email: 'hana@t.com', password: 'Passw0rd!', role: ROLES.USER, userType: USER_TYPES.SOCIAL_HANDLER, organization: org._id, handles: [{ organization: org._id, platforms: [...SOCIAL_PLATFORMS] }] },
    { name: 'Olly', email: 'olly@t.com', password: 'Passw0rd!', role: ROLES.USER, userType: USER_TYPES.SOCIAL_HANDLER, organization: other._id, handles: [{ organization: other._id, platforms: [...SOCIAL_PLATFORMS] }] },
    { name: 'Dee', email: 'dee@t.com', password: 'Passw0rd!', role: ROLES.USER, userType: USER_TYPES.DESIGNER, organization: org._id },
  ]);
  handlerTok = generateToken(handler._id); otherHandlerTok = generateToken(otherHandler._id); designerTok = generateToken(designer._id);
  const base = { organization: org._id, raisedBy: coord._id, category: 'Content', department: 'CSE' };
  await InstitutionRequest.create([
    { ...base, title: 'Admission reel', workType: 'DIGITAL_MEDIA', workCategory: 'Social Media', workItem: 'Social Media Posts', postPlatforms: ['Instagram'], workflowStage: 'DESIGN_OPEN' },
    { ...base, title: 'Open day post', workType: 'DIGITAL_MEDIA', workCategory: 'Social Media', workItem: 'Social Media Posts', postPlatforms: ['Instagram'], workflowStage: 'DESIGN_IN_PROGRESS', designer: designer._id },
    { ...base, title: 'Printed banner', workType: 'PRINT_MEDIA', workCategory: 'Print Media', workItem: 'Banners (Indoor & Outdoor)', workflowStage: 'DESIGN_OPEN' },
    { ...base, title: 'Ready to post', workType: 'DIGITAL_MEDIA', workCategory: 'Social Media', workItem: 'Social Media Posts', postPlatforms: ['Instagram'], workflowStage: 'POST_OPEN' },
  ]);
  server = app.listen(0);
  await new Promise((r) => server.once('listening', r));
  origin = `http://127.0.0.1:${server.address().port}`;
});
after(async () => { server?.close(); await mongoose.disconnect(); await mongod?.stop(); });

const list = (token, qs) => fetch(`${origin}/api/workflow?${qs}`, { headers: { Authorization: `Bearer ${token}` } }).then(async (r) => ({ status: r.status, body: await r.json() }));

test('a handler can look ahead at social requests still with the designers, including unacknowledged ones', async () => {
  const r = await list(handlerTok, 'board=POST&upcoming=1');
  assert.equal(r.status, 200);
  const titles = r.body.items.map((i) => i.title).sort();
  assert.deepEqual(titles, ['Admission reel', 'Open day post'], 'only social media requests still in design');
  assert.equal(r.body.counts.DESIGN_OPEN, 1);
  assert.equal(r.body.counts.DESIGN_IN_PROGRESS, 1);
  const open = r.body.items.find((i) => i.title === 'Admission reel');
  assert.equal(open.designer, null, 'it has not been acknowledged by a designer');
});

test('the look ahead can be narrowed to what no designer has taken', async () => {
  const r = await list(handlerTok, 'board=POST&upcoming=1&stage=DESIGN_OPEN');
  assert.deepEqual(r.body.items.map((i) => i.title), ['Admission reel']);
});

test('the normal To Be Posted list is unchanged, and the look ahead is limited to the handler\'s own colleges', async () => {
  const normal = await list(handlerTok, 'board=POST');
  assert.deepEqual(normal.body.items.map((i) => i.title), ['Ready to post']);
  const other = await list(otherHandlerTok, 'board=POST&upcoming=1');
  assert.equal(other.body.items.length, 0, 'another college\'s handler does not see this college\'s requests');
});

test('only handlers and admins get the look ahead', async () => {
  const r = await list(designerTok, 'board=POST&upcoming=1');
  assert.equal(r.status, 403);
});
