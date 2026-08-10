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
const { default: WorkAssignment } = await import('../models/WorkAssignment.js');
const { default: InstitutionRequest } = await import('../models/InstitutionRequest.js');
const { default: Notification } = await import('../models/Notification.js');
const { generateToken } = await import('../utils/token.js');
const { ROLES, USER_TYPES } = await import('../config/constants.js');

let mongod;
let server;
let origin;
let orgId;
let ids = {};
let superTok;

before(async () => {
  mongod = await MongoMemoryServer.create();
  await mongoose.connect(mongod.getUri());
  const org = await Organization.create({ name: 'Test College', slug: 'test-college' });
  orgId = org._id;

  const [su, designer, coordinator, handler, stranger] = await User.create([
    { name: 'Super', email: 'su@t.com', password: 'Passw0rd!', role: ROLES.ADMIN, isSuperAdmin: true },
    { name: 'Dee', email: 'dee@t.com', password: 'Passw0rd!', role: ROLES.USER, userType: USER_TYPES.DESIGNER, organization: org._id },
    { name: 'Coco', email: 'coco@t.com', password: 'Passw0rd!', role: ROLES.USER, userType: USER_TYPES.COORDINATOR, organization: org._id },
    {
      name: 'Hana', email: 'hana@t.com', password: 'Passw0rd!', role: ROLES.USER, userType: USER_TYPES.SOCIAL_HANDLER,
      organization: org._id, handles: [{ organization: org._id, platforms: ['LinkedIn'] }],
    },
    // Mapped to the college, but not to LinkedIn.
    {
      name: 'Otto', email: 'otto@t.com', password: 'Passw0rd!', role: ROLES.USER, userType: USER_TYPES.SOCIAL_HANDLER,
      organization: org._id, handles: [{ organization: org._id, platforms: ['Instagram'] }],
    },
  ]);
  ids = {
    su: su._id, designer: designer._id, coordinator: coordinator._id, handler: handler._id, stranger: stranger._id,
  };
  superTok = generateToken(su._id);

  server = app.listen(0);
  await new Promise((r) => server.once('listening', r));
  origin = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  server?.close();
  await mongoose.disconnect();
  await mongod?.stop();
});

// A finished piece of designer work, optionally traceable back to the college
// request that asked for it.
const doneWork = async ({ withRequest = false, status = 'DONE' } = {}) => {
  let sourceRequest = null;
  if (withRequest) {
    const r = await InstitutionRequest.create({
      organization: orgId, title: 'Need a placement banner', status: 'GETTING_ALLOCATED', raisedBy: ids.coordinator,
      details: 'A2 portrait, campus colours, due before the fair',
      workType: 'PRINT_MEDIA', workCategory: 'Placement', workItem: 'Banner', department: 'T&P',
    });
    sourceRequest = r._id;
  }
  return WorkAssignment.create({
    organization: orgId, title: 'Placement banner', description: 'A3, campus colours',
    assignee: ids.designer, assigneeType: USER_TYPES.DESIGNER, createdBy: ids.su,
    status, completionNote: 'Exported the final artwork', sourceRequest,
  });
};

const handoff = (id, body, token = superTok) =>
  fetch(`${origin}/api/work-assignments/${id}/handoff`, {
    method: 'PUT',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }).then(async (r) => ({ status: r.status, body: await r.json() }));

test('finished work can be handed back to the coordinator who raised the request', async () => {
  const work = await doneWork({ withRequest: true });
  const { status, body } = await handoff(work._id, { target: 'COORDINATOR', note: 'Files are in the drive' });

  assert.equal(status, 200);
  assert.equal(body.assignment.handoff, 'COORDINATOR');
  assert.equal(String(body.assignment.deliveredTo._id), String(ids.coordinator), 'it goes to whoever raised the request');

  const note = await Notification.findOne({ recipient: ids.coordinator, relatedRequest: work._id });
  assert.ok(note, 'the coordinator is told their work is ready');
  assert.match(note.message, /Files are in the drive/);
});

test('finished work can be sent to a social handler, who gets their own assignment', async () => {
  const work = await doneWork({ withRequest: true });
  const { status, body } = await handoff(work._id, {
    target: 'SOCIAL_HANDLER', platform: 'LinkedIn', assigneeIds: [String(ids.handler)],
  });

  assert.equal(status, 200);
  assert.equal(body.assignment.handoff, 'SOCIAL_HANDLER');
  assert.equal(body.assignment.handoffAssignments.length, 1);

  const posting = await WorkAssignment.findById(body.assignment.handoffAssignments[0]._id);
  assert.equal(String(posting.assignee), String(ids.handler));
  assert.equal(posting.assigneeType, USER_TYPES.SOCIAL_HANDLER);
  assert.equal(posting.platform, 'LinkedIn');
  assert.equal(posting.status, 'OPEN', 'the handler still has to do and complete it');
  assert.equal(String(posting.postingFor), String(work._id), 'it is marked as publishing work, not a fresh brief');
  assert.equal(String(posting.sourceRequest), String(work.sourceRequest), 'the college request follows the chain');
  assert.match(posting.description, /Exported the final artwork/, 'what was produced travels with it');
});

test("the handler's own list carries the coordinator's request and what to post", async () => {
  const work = await doneWork({ withRequest: true });
  await handoff(work._id, { target: 'SOCIAL_HANDLER', platform: 'LinkedIn', assigneeIds: [String(ids.handler)] });

  const { status, body } = await fetch(`${origin}/api/work-assignments`, {
    headers: { Authorization: `Bearer ${generateToken(ids.handler)}` },
  }).then(async (r) => ({ status: r.status, body: await r.json() }));

  assert.equal(status, 200);
  const posting = body.assignments.find((a) => a.postingFor);
  assert.ok(posting, 'the posting job is in the handler’s own assigned work');
  assert.equal(posting.status, 'OPEN', 'shown as awaiting posting, still OPEN underneath');
  // The whole ask, not just its headline — the handler is publishing something
  // they did not make.
  assert.equal(posting.sourceRequest.title, 'Need a placement banner');
  assert.equal(posting.sourceRequest.details, 'A2 portrait, campus colours, due before the fair');
  assert.equal(posting.sourceRequest.raisedBy.name, 'Coco', 'they can see which coordinator asked');
  assert.equal(posting.postingFor.completionNote, 'Exported the final artwork');
});

test('a handler who does not cover that platform is refused', async () => {
  const work = await doneWork();
  const { status, body } = await handoff(work._id, {
    target: 'SOCIAL_HANDLER', platform: 'LinkedIn', assigneeIds: [String(ids.stranger)],
  });
  assert.equal(status, 400);
  assert.match(body.message, /not mapped/);
  // Nothing half-created: the refusal has to leave the work untouched.
  const after = await WorkAssignment.findById(work._id);
  assert.equal(after.handoff, '');
});

test('work that is not signed off yet cannot be sent anywhere', async () => {
  const work = await doneWork({ status: 'SUBMITTED' });
  const { status, body } = await handoff(work._id, { target: 'COORDINATOR' });
  assert.equal(status, 400);
  assert.match(body.message, /Approve the completion request/);
});

test('work is not sent onward twice', async () => {
  const work = await doneWork({ withRequest: true });
  assert.equal((await handoff(work._id, { target: 'COORDINATOR' })).status, 200);
  const second = await handoff(work._id, { target: 'SOCIAL_HANDLER', platform: 'LinkedIn', assigneeIds: [String(ids.handler)] });
  assert.equal(second.status, 400);
  assert.match(second.body.message, /already been delivered/);
});

// The designer submits finished work as an APPROVAL linked to their assignment,
// so routing that approval to a handler is the real "go and post this" moment.
// It has to land in their assigned work, not only on the approval.
test('routing an approved design to a handler raises posting work, not just an approval', async () => {
  const { default: ApprovalRequest } = await import('../models/ApprovalRequest.js');
  const work = await doneWork({ withRequest: true });
  const design = await ApprovalRequest.create({
    title: 'Placement banner', type: 'DESIGN', status: 'APPROVED', organization: orgId,
    createdBy: ids.coordinator, designer: ids.designer, workAssignment: work._id,
    caption: 'Admissions open — apply now', platforms: ['LinkedIn'],
  });

  const routed = await fetch(`${origin}/api/approvals/${design._id}/assign`, {
    method: 'PUT',
    headers: { Authorization: `Bearer ${superTok}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ userId: String(ids.handler) }),
  }).then(async (r) => ({ status: r.status, body: await r.json() }));
  assert.equal(routed.status, 200);

  const { body } = await fetch(`${origin}/api/work-assignments`, {
    headers: { Authorization: `Bearer ${generateToken(ids.handler)}` },
  }).then(async (r) => r.json().then((b) => ({ body: b })));

  const posting = body.assignments.find((a) => String(a.sourceApproval?._id) === String(design._id));
  assert.ok(posting, 'the posting job must be in the handler’s assigned work');
  assert.equal(posting.status, 'OPEN', 'shown as awaiting posting');
  assert.equal(posting.platform, 'LinkedIn', 'on the channel the design was for');
  assert.equal(posting.sourceApproval.caption, 'Admissions open — apply now');
  // The whole point of the complaint: the coordinator's ask has to survive the
  // hop through the approval.
  assert.equal(posting.sourceRequest.title, 'Need a placement banner');
  assert.equal(posting.sourceRequest.details, 'A2 portrait, campus colours, due before the fair');
  assert.equal(posting.sourceRequest.raisedBy.name, 'Coco');
});

test('re-routing the same design does not pile up duplicate posting jobs', async () => {
  const { default: ApprovalRequest } = await import('../models/ApprovalRequest.js');
  const design = await ApprovalRequest.create({
    title: 'Repeat routing', type: 'DESIGN', status: 'APPROVED', organization: orgId,
    createdBy: ids.coordinator, designer: ids.designer, platforms: ['LinkedIn'],
  });
  const assign = () => fetch(`${origin}/api/approvals/${design._id}/assign`, {
    method: 'PUT',
    headers: { Authorization: `Bearer ${superTok}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ userId: String(ids.handler) }),
  }).then((r) => r.status);

  assert.equal(await assign(), 200);
  assert.equal(await assign(), 200);
  const jobs = await WorkAssignment.find({ sourceApproval: design._id, assignee: ids.handler });
  assert.equal(jobs.length, 1, 'one live posting job per handler per design');
});

// The exact failure reported: work allocated without picking a request off the
// queue reaches the handler with no idea what the college asked for.
test('a missing request link can be attached at handoff, and reaches the handler', async () => {
  const work = await doneWork(); // deliberately NOT linked to a request
  const orphanReq = await InstitutionRequest.create({
    organization: orgId, title: 'Fresher induction poster', status: 'GETTING_ALLOCATED', raisedBy: ids.coordinator,
    details: 'Portrait, hall A, include the schedule', workCategory: 'Events', workItem: 'Poster', department: 'Admissions',
  });

  const { status } = await handoff(work._id, {
    target: 'SOCIAL_HANDLER', platform: 'LinkedIn', assigneeIds: [String(ids.handler)],
    sourceRequest: String(orphanReq._id),
  });
  assert.equal(status, 200);

  const { body } = await fetch(`${origin}/api/work-assignments`, {
    headers: { Authorization: `Bearer ${generateToken(ids.handler)}` },
  }).then((r) => r.json()).then((b) => ({ body: b }));

  const posting = body.assignments.find((a) => String(a.sourceRequest?._id) === String(orphanReq._id));
  assert.ok(posting, 'the repaired link must reach the posting job');
  assert.equal(posting.sourceRequest.details, 'Portrait, hall A, include the schedule');
  // And it is backfilled onto the finished work, so the chain is whole.
  const repaired = await WorkAssignment.findById(work._id);
  assert.equal(String(repaired.sourceRequest), String(orphanReq._id));
});

test('the files the designer submitted reach the handler who has to post them', async () => {
  const work = await WorkAssignment.create({
    organization: orgId, title: 'Carousel', assignee: ids.designer, assigneeType: USER_TYPES.DESIGNER,
    createdBy: ids.su, status: 'DONE', completionNote: 'Five slides exported',
    completionAttachments: [{ url: 'https://files.test/slide1.png', name: 'slide1.png', mediaType: 'image' }],
  });

  await handoff(work._id, { target: 'SOCIAL_HANDLER', platform: 'LinkedIn', assigneeIds: [String(ids.handler)] });

  const { body } = await fetch(`${origin}/api/work-assignments`, {
    headers: { Authorization: `Bearer ${generateToken(ids.handler)}` },
  }).then((r) => r.json()).then((b) => ({ body: b }));

  const posting = body.assignments.find((a) => String(a.postingFor?._id) === String(work._id));
  assert.ok(posting, 'the posting job exists');
  assert.equal(posting.postingFor.completionAttachments.length, 1, 'the handler can reach the artwork');
  assert.equal(posting.postingFor.completionAttachments[0].url, 'https://files.test/slide1.png');
});

// An Admin (role CEO) heading the institution is not the super admin, but the
// routing endpoints used to be super-admin-only — so their allocation 403'd and
// nothing was ever raised for the handler.
test('an Admin over the institution can allocate a design to a handler', async () => {
  const { default: ApprovalRequest } = await import('../models/ApprovalRequest.js');
  const ceo = await User.create({
    name: 'Cee', email: 'cee@t.com', password: 'Passw0rd!', role: ROLES.CEO, organization: orgId,
  });
  const design = await ApprovalRequest.create({
    title: 'Admin-routed banner', type: 'DESIGN', status: 'APPROVED', organization: orgId,
    createdBy: ids.coordinator, designer: ids.designer, platforms: ['LinkedIn'],
  });

  const { status } = await fetch(`${origin}/api/approvals/${design._id}/assign`, {
    method: 'PUT',
    headers: { Authorization: `Bearer ${generateToken(ceo._id)}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ userId: String(ids.handler) }),
  }).then(async (r) => ({ status: r.status }));
  assert.equal(status, 200, 'an Admin over this college may route its work');

  const jobs = await WorkAssignment.find({ sourceApproval: design._id, assignee: ids.handler });
  assert.equal(jobs.length, 1, 'the handler actually gets the posting work');
});

test('a designer cannot decide where the work goes', async () => {
  const work = await doneWork();
  const { status } = await handoff(work._id, { target: 'COORDINATOR' }, generateToken(ids.designer));
  assert.equal(status, 403);
});

// Once a designer submits, the completion request is for the super admin AND the
// Admin over that college to decide — and for nobody else.
test('a submitted completion request can be approved or rejected by the org Admin', async () => {
  const admin = await User.create({
    name: 'RevAdmin', email: 'rev-admin@t.com', password: 'Passw0rd!', role: ROLES.CEO, organization: orgId,
  });
  const otherOrg = await Organization.create({ name: 'Rev Other', slug: 'rev-other' });
  const outsider = await User.create({
    name: 'RevOutsider', email: 'rev-out@t.com', password: 'Passw0rd!', role: ROLES.CEO, organization: otherOrg._id,
  });
  const work = await WorkAssignment.create({
    organization: orgId, title: 'Review me', assignee: ids.designer, assigneeType: USER_TYPES.DESIGNER,
    createdBy: ids.su, status: 'ACKNOWLEDGED',
  });

  const submitted = await fetch(`${origin}/api/work-assignments/${work._id}/submit`, {
    method: 'PUT',
    headers: { Authorization: `Bearer ${generateToken(ids.designer)}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ note: 'Finished' }),
  }).then(async (r) => ({ status: r.status, body: await r.json() }));
  assert.equal(submitted.status, 200);
  assert.equal(submitted.body.assignment.status, 'SUBMITTED');

  // Both deciders are told, and both can see it.
  const told = await Notification.find({ relatedRequest: work._id }).select('recipient');
  const toldIds = told.map((n) => String(n.recipient));
  assert.ok(toldIds.includes(String(ids.su)), 'the super admin is told');
  assert.ok(toldIds.includes(String(admin._id)), 'the Admin over the college is told');

  const review = (token, body) => fetch(`${origin}/api/work-assignments/${work._id}/review`, {
    method: 'PUT',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }).then(async (r) => ({ status: r.status, body: await r.json() }));

  assert.equal((await review(generateToken(outsider._id), { action: 'approve' })).status, 403,
    'an Admin of another college has no say');

  const rejected = await review(generateToken(admin._id), { action: 'reject', note: 'redo the header' });
  assert.equal(rejected.status, 200);
  assert.equal(rejected.body.assignment.status, 'ACKNOWLEDGED', 'rejecting sends it back to the designer');

  await fetch(`${origin}/api/work-assignments/${work._id}/submit`, {
    method: 'PUT',
    headers: { Authorization: `Bearer ${generateToken(ids.designer)}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ note: 'Fixed' }),
  });
  const approved = await review(generateToken(admin._id), { action: 'approve' });
  assert.equal(approved.body.assignment.status, 'DONE', 'and the Admin can sign it off');
});

// The coordinator is told who actually has their work — and told it once per
// event, not the same sentence twice.
test('the coordinator hears who the work went to, without duplicates', async () => {
  const req = await InstitutionRequest.create({
    organization: orgId, title: 'Notify me', status: 'GETTING_ALLOCATED', raisedBy: ids.coordinator, category: 'Content',
  });
  const inbox = () => Notification.find({ recipient: ids.coordinator, organization: orgId })
    .sort({ createdAt: 1 }).select('title message');

  const before = (await inbox()).length;
  const alloc = await fetch(`${origin}/api/work-assignments`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${superTok}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ title: 'Notify me', assigneeIds: [String(ids.designer)], sourceRequest: String(req._id) }),
  }).then((r) => r.json());
  const waId = alloc.assignments[0]._id;

  // Nobody owns designer work until it is acknowledged, so this must not claim
  // it is assigned to anyone yet.
  const afterAlloc = (await inbox()).slice(before);
  assert.equal(afterAlloc.length, 1);
  assert.match(afterAlloc[0].message, /Sent to Dee to pick up/);

  await fetch(`${origin}/api/work-assignments/${waId}/acknowledge`, {
    method: 'PUT', headers: { Authorization: `Bearer ${generateToken(ids.designer)}` },
  });

  const afterAck = (await inbox()).slice(before + 1);
  assert.equal(afterAck.length, 1, 'one notification for the acknowledgement, not two');
  assert.equal(afterAck[0].title, 'Work assigned');
  assert.equal(afterAck[0].message, 'Work assigned to Dee');
});

// Routing an approved design to a handler moves the task INTO their assigned
// work and OUT of their approvals — one place to act, not two. They keep read
// access to the design itself, because that is where the artwork lives.
test('a routed design becomes assigned work and leaves the handler’s approvals', async () => {
  const { default: ApprovalRequest } = await import('../models/ApprovalRequest.js');
  const design = await ApprovalRequest.create({
    title: 'Route me', type: 'DESIGN', status: 'APPROVED', organization: orgId,
    createdBy: ids.designer, designer: ids.designer, platforms: ['LinkedIn'],
  });

  const routed = await fetch(`${origin}/api/approvals/${design._id}/assign`, {
    method: 'PUT',
    headers: { Authorization: `Bearer ${superTok}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ userId: String(ids.handler) }),
  });
  assert.equal(routed.status, 200);

  const handlerTok = generateToken(ids.handler);
  const asHandler = (path) => fetch(`${origin}${path}`, { headers: { Authorization: `Bearer ${handlerTok}` } })
    .then(async (r) => ({ status: r.status, body: await r.json() }));

  const approvals = await asHandler('/api/approvals');
  assert.ok(!approvals.body.requests.some((r) => String(r._id) === String(design._id)),
    'the design must not sit in their approvals as well');

  const work = await asHandler('/api/work-assignments');
  const job = work.body.assignments.find((a) => String(a.sourceApproval?._id) === String(design._id));
  assert.ok(job, 'the posting job is in their assigned work');
  assert.equal(job.status, 'OPEN');

  // Still openable — the assigned-work row links here for the files.
  assert.equal((await asHandler(`/api/approvals/${design._id}`)).status, 200);

  // Signing the posting job off is what marks the design published, since the
  // handler no longer works from the approvals screen at all.
  await fetch(`${origin}/api/work-assignments/${job._id}/submit`, {
    method: 'PUT',
    headers: { Authorization: `Bearer ${handlerTok}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ note: 'Posted on LinkedIn' }),
  });
  await fetch(`${origin}/api/work-assignments/${job._id}/review`, {
    method: 'PUT',
    headers: { Authorization: `Bearer ${superTok}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'approve' }),
  });
  const after = await ApprovalRequest.findById(design._id);
  assert.equal(after.status, 'POSTED', 'the content pipeline must not stall at APPROVED');
  assert.equal(String(after.postedBy), String(ids.handler), 'credited to whoever actually posted it');
});

// A social handler publishes — that is the last step. Once their completion is
// approved the job is finished, so nothing asks where to send it next. Only a
// designer's output still has somewhere to go.
test('a handler’s approved work is final — it cannot be sent onward again', async () => {
  const posted = await WorkAssignment.create({
    organization: orgId, title: 'Post: something', assignee: ids.handler,
    assigneeType: USER_TYPES.SOCIAL_HANDLER, platform: 'LinkedIn',
    createdBy: ids.su, status: 'DONE', completionNote: 'Published',
  });
  const { status, body } = await handoff(posted._id, { target: 'COORDINATOR' });
  assert.equal(status, 400);
  assert.match(body.message, /nothing further to send it to/);

  // The designer equivalent still routes, so this is the handler rule and not a
  // blanket block on handing work on.
  const designed = await doneWork();
  assert.equal((await handoff(designed._id, { target: 'COORDINATOR' })).status, 200);
});

// Publishing is a fact, not a request. The content was approved before it ever
// reached the handler, so saying "it is out" closes the job then and there — no
// completion note, no second sign-off from anyone.
test('a handler closes their own posting job, now or at a set time', async () => {
  const { default: ApprovalRequest } = await import('../models/ApprovalRequest.js');
  const { publishDueScheduledPosts } = await import('../services/scheduledPosts.js');
  const handlerTok = generateToken(ids.handler);

  const postingJob = async () => {
    const design = await ApprovalRequest.create({
      title: 'Banner', type: 'DESIGN', status: 'APPROVED', organization: orgId,
      createdBy: ids.su, platforms: ['LinkedIn'],
    });
    return WorkAssignment.create({
      organization: orgId, title: 'Post: Banner', assignee: ids.handler,
      assigneeType: USER_TYPES.SOCIAL_HANDLER, platform: 'LinkedIn',
      createdBy: ids.su, status: 'OPEN', sourceApproval: design._id,
    });
  };
  const posted = (id, body) => fetch(`${origin}/api/work-assignments/${id}/posted`, {
    method: 'PUT',
    headers: { Authorization: `Bearer ${handlerTok}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body || {}),
  }).then(async (r) => ({ status: r.status, body: await r.json() }));

  // Already out: one click, straight to done, and the content shows posted.
  const a = await postingJob();
  const now = await posted(a._id);
  assert.equal(now.status, 200);
  assert.equal(now.body.assignment.status, 'DONE');
  assert.equal((await ApprovalRequest.findById(a.sourceApproval)).status, 'POSTED');

  // Going out later: booked, and it closes itself when the moment arrives.
  const b = await postingJob();
  const soon = new Date(Date.now() + 90_000);
  assert.equal((await posted(b._id, { scheduledAt: soon.toISOString() })).status, 200);
  assert.equal((await WorkAssignment.findById(b._id)).status, 'OPEN', 'not closed before its time');
  assert.ok((await ApprovalRequest.findById(b.sourceApproval)).scheduledAt, 'the content carries the same time');

  assert.equal((await publishDueScheduledPosts(new Date())).length, 0, 'nothing due yet');
  await publishDueScheduledPosts(new Date(Date.now() + 120_000));
  assert.equal((await WorkAssignment.findById(b._id)).status, 'DONE');
  assert.equal((await ApprovalRequest.findById(b.sourceApproval)).status, 'POSTED');

  // Work that is not publishing still goes through the completion request, so
  // this shortcut cannot be used to skip a real review.
  const plain = await WorkAssignment.create({
    organization: orgId, title: 'Run a poll', assignee: ids.handler,
    assigneeType: USER_TYPES.SOCIAL_HANDLER, createdBy: ids.su, status: 'OPEN',
  });
  const refused = await posted(plain._id);
  assert.equal(refused.status, 400);
  assert.match(refused.body.message, /not publishing work/);
});

// Marking posted closes BOTH sides, whichever side the click came from. The
// approval and the posting job are the same piece of work, and a row left open
// after the thing is out has the handler's list contradicting the board.
test('publishing an approval closes the posting job behind it', async () => {
  const { default: ApprovalRequest } = await import('../models/ApprovalRequest.js');
  const { publishDueScheduledPosts } = await import('../services/scheduledPosts.js');
  const handlerTok = generateToken(ids.handler);

  const pair = async () => {
    const design = await ApprovalRequest.create({
      title: 'Banner', type: 'DESIGN', status: 'APPROVED', organization: orgId,
      createdBy: ids.su, designer: ids.su, assignedTo: ids.handler, platforms: ['LinkedIn'],
    });
    const job = await WorkAssignment.create({
      organization: orgId, title: 'Post: Banner', assignee: ids.handler,
      assigneeType: USER_TYPES.SOCIAL_HANDLER, platform: 'LinkedIn',
      createdBy: ids.su, status: 'OPEN', sourceApproval: design._id,
    });
    return { design, job };
  };
  const put = (path, body) => fetch(`${origin}${path}`, {
    method: 'PUT',
    headers: { Authorization: `Bearer ${handlerTok}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body || {}),
  }).then(async (r) => ({ status: r.status, body: await r.json() }));

  // Marked posted from the approvals side.
  const one = await pair();
  assert.equal((await put(`/api/approvals/${one.design._id}/posted`)).status, 200);
  assert.equal((await WorkAssignment.findById(one.job._id)).status, 'DONE',
    'the job that existed to publish it is finished too');

  // And when the scheduled sweep publishes it rather than a person.
  const two = await pair();
  await put(`/api/approvals/${two.design._id}/schedule`, { scheduledAt: new Date(Date.now() + 60_000).toISOString() });
  await publishDueScheduledPosts(new Date(Date.now() + 90_000));
  assert.equal((await ApprovalRequest.findById(two.design._id)).status, 'POSTED');
  assert.equal((await WorkAssignment.findById(two.job._id)).status, 'DONE');
});

/**
 * A shared brief locked by another designer leaves your list.
 *
 * One brief goes out as a row per designer, and the first to acknowledge owns it —
 * the others are locked and can never be acted on again. Leaving them on the list
 * gave every other designer a permanent row they could only look at.
 */
test('work another designer acknowledged drops off your own list', async () => {
  const { default: WorkAssignment } = await import('../models/WorkAssignment.js');
  const other = await User.create({
    name: 'Dot', email: 'dot-lock@t.com', password: 'Passw0rd!',
    role: ROLES.USER, userType: USER_TYPES.DESIGNER, organization: orgId,
  });
  const group = new mongoose.Types.ObjectId();
  const shared = {
    organization: orgId, title: 'Shared brief', assigneeType: USER_TYPES.DESIGNER,
    createdBy: ids.su, status: 'OPEN', allocationGroup: group,
  };
  const [mine, theirs] = await WorkAssignment.create([
    { ...shared, assignee: other._id },
    { ...shared, assignee: ids.designer },
  ]);

  const listFor = async (token) => {
    const r = await fetch(`${origin}/api/work-assignments`, { headers: { Authorization: `Bearer ${token}` } });
    const body = await r.json();
    return body.assignments.map((a) => String(a._id));
  };

  const otherTok = generateToken(other._id);
  assert.ok((await listFor(otherTok)).includes(String(mine._id)), 'before anyone takes it, it is on their list');

  // Dee acknowledges, which locks every sibling copy.
  const ack = await fetch(`${origin}/api/work-assignments/${theirs._id}/acknowledge`, {
    method: 'PUT', headers: { Authorization: `Bearer ${generateToken(ids.designer)}` },
  });
  assert.equal(ack.status, 200);

  assert.ok(!(await listFor(otherTok)).includes(String(mine._id)),
    'the locked copy leaves the other designer’s list');
  assert.ok((await listFor(generateToken(ids.designer))).includes(String(theirs._id)),
    'and stays on the list of whoever actually took it');

  // The admin still sees both copies — oversight is not narrowed.
  const adminSees = await listFor(superTok);
  assert.ok(adminSees.includes(String(mine._id)) && adminSees.includes(String(theirs._id)),
    'an admin must still see every copy');
});
