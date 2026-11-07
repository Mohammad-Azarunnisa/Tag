import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';

process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret';
process.env.STORAGE_DRIVER = 'local';
process.env.LOCAL_STORAGE_ROOT = '';
process.env.AUTO_ACCEPT_FROM = '2026-10-01T00:00:00+05:30';

const { default: User } = await import('../models/User.js');
const { default: Organization } = await import('../models/Organization.js');
const { default: InstitutionRequest } = await import('../models/InstitutionRequest.js');
const { default: Holiday } = await import('../models/Holiday.js');
const { default: Notification } = await import('../models/Notification.js');
const { ROLES, USER_TYPES } = await import('../config/constants.js');
const { acceptOverdueDesigns, acceptDeadline } = await import('./autoAcceptDesigns.js');

let mongod; let org; let coord; let designer; let handler;
before(async () => {
  mongod = await MongoMemoryServer.create();
  await mongoose.connect(mongod.getUri());
  org = await Organization.create({ name: 'Test College', slug: 'test-college' });
  [coord, designer, handler] = await User.create([
    { name: 'Coco', email: 'coco@t.com', password: 'Passw0rd!', role: ROLES.USER, userType: USER_TYPES.COORDINATOR, organization: org._id },
    { name: 'Dee', email: 'dee@t.com', password: 'Passw0rd!', role: ROLES.USER, userType: USER_TYPES.DESIGNER, organization: org._id },
    { name: 'Hana', email: 'hana@t.com', password: 'Passw0rd!', role: ROLES.USER, userType: USER_TYPES.SOCIAL_HANDLER, organization: org._id, handles: [{ organization: org._id, platforms: ['Instagram'] }] },
  ]);
});
after(async () => { await mongoose.disconnect(); await mongod?.stop(); });

const base = () => ({ organization: org._id, raisedBy: coord._id, designer: designer._id, category: 'Content', department: 'CSE', workflowStage: 'DESIGN_COORDINATOR_REVIEW', status: 'OPEN' });
const at = (iso) => new Date(iso);

test('the deadline is two working days on, at the same time of day, skipping Sundays and holidays', () => {
  // Friday 10:00 IST -> Saturday (1), Monday (2): Monday 10:00 IST
  assert.equal(acceptDeadline(at('2026-10-09T04:30:00Z'), new Set()).toISOString(), '2026-10-12T04:30:00.000Z');
  // with Monday a holiday it slides to Tuesday
  assert.equal(acceptDeadline(at('2026-10-09T04:30:00Z'), new Set(['2026-10-12'])).toISOString(), '2026-10-13T04:30:00.000Z');
  // Monday -> Wednesday
  assert.equal(acceptDeadline(at('2026-10-05T04:30:00Z'), new Set()).toISOString(), '2026-10-07T04:30:00.000Z');
});

test('a design left with the coordinator for 2 working days is accepted for them; a fresh one is not', async () => {
  const old = await InstitutionRequest.create({ ...base(), title: 'Overdue print', workType: 'PRINT_MEDIA', workCategory: 'Print Media', workItem: 'Posters', designApprovedAt: at('2026-10-05T04:30:00Z') });
  const social = await InstitutionRequest.create({ ...base(), title: 'Overdue social', workType: 'DIGITAL_MEDIA', workCategory: 'Social Media', workItem: 'Social Media Posts', postPlatforms: ['Instagram'], designApprovedAt: at('2026-10-05T04:30:00Z') });
  const fresh = await InstitutionRequest.create({ ...base(), title: 'Fresh', workType: 'PRINT_MEDIA', workCategory: 'Print Media', workItem: 'Posters', designApprovedAt: at('2026-10-08T04:30:00Z') });

  // Wednesday 7 Oct 2026 at 11:00 IST: two working days have passed for the first two, not for the third
  const done = await acceptOverdueDesigns(at('2026-10-07T05:30:00Z'));
  assert.deepEqual(done.sort(), [String(old._id), String(social._id)].sort());

  const p = await InstitutionRequest.findById(old._id).lean();
  assert.equal(p.workflowStage, 'COMPLETED'); assert.equal(p.status, 'APPROVED');
  assert.equal(p.designAutoAccepted, true); assert.ok(p.designAcceptedAt); assert.equal(p.designAcceptedBy, undefined);

  const s = await InstitutionRequest.findById(social._id).lean();
  assert.equal(s.workflowStage, 'POST_OPEN'); assert.equal(s.status, 'WITH_SOCIAL_HANDLER'); assert.deepEqual(s.postPlatforms, ['Instagram']);

  assert.equal((await InstitutionRequest.findById(fresh._id).lean()).workflowStage, 'DESIGN_COORDINATOR_REVIEW');

  assert.equal((await Notification.find({ recipient: coord._id, title: /approved automatically/i })).length, 2);
  assert.equal((await Notification.find({ recipient: handler._id, title: /New work to post/i })).length, 1, 'only the handler of the chosen page');
  assert.equal((await Notification.find({ recipient: designer._id })).length >= 2, true);
});

test('holidays and Sundays do not count against the coordinator', async () => {
  await InstitutionRequest.deleteMany({});
  await Holiday.create({ date: '2026-11-03', name: 'Test holiday' });
  const r = await InstitutionRequest.create({ ...base(), title: 'Holiday gap', workType: 'PRINT_MEDIA', workCategory: 'Print Media', workItem: 'Posters', designApprovedAt: at('2026-11-02T04:30:00Z') });
  // Mon 2 Nov: Tue 3 is a holiday, so Wed 4 (1) and Thu 5 (2) -> deadline Thu 5 Nov 10:00 IST
  assert.deepEqual(await acceptOverdueDesigns(at('2026-11-05T04:00:00Z')), [], 'not yet — the holiday did not count');
  assert.deepEqual(await acceptOverdueDesigns(at('2026-11-05T05:00:00Z')), [String(r._id)]);
});

test('a design the coordinator already answered is left alone', async () => {
  const r = await InstitutionRequest.create({ ...base(), title: 'Answered', workflowStage: 'COMPLETED', workType: 'PRINT_MEDIA', workCategory: 'Print Media', workItem: 'Posters', designApprovedAt: at('2026-10-05T04:30:00Z') });
  assert.equal((await acceptOverdueDesigns(at('2026-12-01T00:00:00Z'))).includes(String(r._id)), false);
});

test('designs that were already waiting before the start date are left alone', async () => {
  await InstitutionRequest.deleteMany({});
  const before = await InstitutionRequest.create({ ...base(), title: 'Waiting since September', workType: 'PRINT_MEDIA', workCategory: 'Print Media', workItem: 'Posters', designApprovedAt: at('2026-09-07T04:30:00Z') });
  assert.deepEqual(await acceptOverdueDesigns(at('2026-12-01T00:00:00Z')), []);
  assert.equal((await InstitutionRequest.findById(before._id).lean()).workflowStage, 'DESIGN_COORDINATOR_REVIEW');
});
