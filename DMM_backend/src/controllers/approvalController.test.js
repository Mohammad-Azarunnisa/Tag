import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';

process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret';
// Keep uploads out of the configured storage volume — this suite writes files.
process.env.STORAGE_DRIVER = 'local';
process.env.LOCAL_STORAGE_ROOT = '';

const { default: app } = await import('../app.js');
const { default: User } = await import('../models/User.js');
const { default: Organization } = await import('../models/Organization.js');
const { default: ApprovalImage } = await import('../models/ApprovalImage.js');
const { generateToken } = await import('../utils/token.js');
const { ROLES, USER_TYPES, APPROVAL_STATUS, APPROVAL_TYPES } = await import('../config/constants.js');

let mongod;
let server;
let origin;
const tok = {};
let orgId;

before(async () => {
  mongod = await MongoMemoryServer.create();
  await mongoose.connect(mongod.getUri());
  const org = await Organization.create({ name: 'Test College', slug: 'test-college' });
  orgId = String(org._id);
  const [su, designer, coordinator] = await User.create([
    { name: 'Super', email: 'super@t.com', password: 'Passw0rd!', role: ROLES.ADMIN, isSuperAdmin: true },
    { name: 'Dee', email: 'dee@t.com', password: 'Passw0rd!', role: ROLES.USER, userType: USER_TYPES.DESIGNER, organization: org._id },
    { name: 'Coco', email: 'coco@t.com', password: 'Passw0rd!', role: ROLES.USER, userType: USER_TYPES.COORDINATOR, organization: org._id },
  ]);
  Object.assign(tok, {
    super: generateToken(su._id),
    designer: generateToken(designer._id),
    coordinator: generateToken(coordinator._id),
    designerId: String(designer._id),
  });
  server = app.listen(0);
  await new Promise((r) => server.once('listening', r));
  origin = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  server?.close();
  await mongoose.disconnect();
  await mongod?.stop();
});

const create = (token, fields, withFile = true) => {
  const fd = new FormData();
  Object.entries(fields).forEach(([k, v]) => fd.append(k, v));
  if (withFile) fd.append('images', new Blob([Buffer.from('fake-png')], { type: 'image/png' }), 'artwork.png');
  return fetch(`${origin}/api/approvals`, { method: 'POST', headers: { Authorization: `Bearer ${token}` }, body: fd })
    .then(async (r) => ({ status: r.status, body: await r.json() }));
};

const list = (token, params) =>
  fetch(`${origin}/api/approvals?${new URLSearchParams(params)}`, { headers: { Authorization: `Bearer ${token}` } })
    .then(async (r) => ({ status: r.status, body: await r.json() }));

test("a designer's own submission is a DESIGN approval, pending review", async () => {
  const { status, body } = await create(tok.designer, {
    title: 'Placement poster', type: APPROVAL_TYPES.DESIGN, organization: orgId,
  });
  assert.equal(status, 201);
  const r = body.request;
  assert.equal(r.type, APPROVAL_TYPES.DESIGN, 'must not land in the POST pipeline');
  assert.equal(r.status, APPROVAL_STATUS.PENDING, 'it is finished work, not a brief awaiting a designer');
  assert.equal(String(r.designer), tok.designerId, 'the submitter is the designer');
  const media = await ApprovalImage.find({ request: r._id }).lean();
  assert.equal(media.length, 1);
  assert.equal(media[0].kind, 'final', 'the artwork is the design, not reference material');
});

test('that submission shows under Design approvals and not under Post approvals', async () => {
  const design = await list(tok.super, { type: 'DESIGN' });
  const post = await list(tok.super, { type: 'POST' });
  const titles = (r) => r.body.requests.map((x) => x.title);
  assert.ok(titles(design).includes('Placement poster'), 'missing from Design approvals');
  assert.ok(!titles(post).includes('Placement poster'), 'leaked into Post approvals');
  assert.equal(design.body.typeCounts.DESIGN, 1);
  assert.equal(design.body.typeCounts.POST, 0);
  assert.equal(design.body.counts.PENDING, 1, 'counts feed the Pending tile');
});

test('the designer can see their own submission', async () => {
  const { body } = await list(tok.designer, { type: 'DESIGN' });
  assert.equal(body.requests.length, 1);
});

test('a designer must attach the finished design', async () => {
  const { status, body } = await create(tok.designer, {
    title: 'Nothing attached', type: APPROVAL_TYPES.DESIGN, organization: orgId,
  }, false);
  assert.equal(status, 400);
  assert.match(body.message, /Upload the finished design/);
});

// A coordinator has exactly one intake: a request to the admin. That request is
// approved and allocated, and only the finished work enters this pipeline.
// Raising approvals as well gave the college a second route that bypassed both.
//
// The middleware now refuses the whole approvals API for them, so these never
// reach the controller — its own guard stays as a second line, for anywhere the
// path list is ever loosened.
test('a coordinator cannot raise a design brief — they raise a request instead', async () => {
  const { status } = await create(tok.coordinator, {
    title: 'Need a banner', type: APPROVAL_TYPES.DESIGN, organization: orgId, designer: tok.designerId,
  });
  assert.equal(status, 403);
});

test('a coordinator cannot raise a post approval either', async () => {
  const { status } = await create(tok.coordinator, {
    title: 'A post', type: APPROVAL_TYPES.POST, organization: orgId, platforms: 'LinkedIn',
  });
  assert.equal(status, 403, 'the rule is about the coordinator, not the approval type');
});

// An Admin still raises briefs, and still has to name who is doing the work.
test('a brief raised for nobody is still rejected', async () => {
  const { status, body } = await create(tok.super, {
    title: 'Unassigned brief', type: APPROVAL_TYPES.DESIGN, organization: orgId,
  });
  assert.equal(status, 400);
  assert.match(body.message, /choose a designer/);
});

test('an Admin can still raise a brief for a designer', async () => {
  const { status, body } = await create(tok.super, {
    title: 'Admin brief', type: APPROVAL_TYPES.DESIGN, organization: orgId, designer: tok.designerId,
  });
  assert.equal(status, 201);
  assert.equal(body.request.status, APPROVAL_STATUS.IN_DESIGN);
  assert.equal(String(body.request.designer), tok.designerId);
  const media = await ApprovalImage.find({ request: body.request._id }).lean();
  assert.equal(media[0].kind, 'reference');
});

test('a designer raising a POST still gets a POST (the compose-from-design route)', async () => {
  const { status, body } = await create(tok.designer, {
    title: 'A real post', type: APPROVAL_TYPES.POST, organization: orgId, platforms: 'LinkedIn',
  });
  assert.equal(status, 201);
  assert.equal(body.request.type, APPROVAL_TYPES.POST);
  assert.equal(body.request.status, APPROVAL_STATUS.PENDING);
});

// Routing work to the designer pool notifies EVERY designer, whichever college
// they sit in. Opening it used to be scoped to the request's own college, so
// most of the people who had just been told about it got "Request not found"
// when they clicked the notification.
test('a designer from another college can open work routed to the designer pool', async () => {
  const { default: ApprovalRequest } = await import('../models/ApprovalRequest.js');
  const other = await Organization.create({ name: 'Other College', slug: 'other-college' });
  const outsider = await User.create({
    name: 'Far', email: 'far@t.com', password: 'Passw0rd!',
    role: ROLES.USER, userType: USER_TYPES.DESIGNER, organization: other._id,
  });
  const outsiderTok = generateToken(outsider._id);

  const pooled = await ApprovalRequest.create({
    title: 'Open to the pool', type: APPROVAL_TYPES.POST, organization: orgId,
    status: APPROVAL_STATUS.APPROVED, openForDesigners: true, createdBy: tok.designerId,
  });
  const claimed = await ApprovalRequest.create({
    title: 'Already taken', type: APPROVAL_TYPES.POST, organization: orgId,
    status: APPROVAL_STATUS.APPROVED, openForDesigners: true,
    designer: tok.designerId, createdBy: tok.designerId,
  });

  const open = (id, token) => fetch(`${origin}/api/approvals/${id}`, {
    headers: { Authorization: `Bearer ${token}` },
  }).then(async (r) => ({ status: r.status, body: await r.json() }));

  const invited = await open(pooled._id, outsiderTok);
  assert.equal(invited.status, 200, 'an invited designer must be able to read what they were offered');
  assert.equal(invited.body.request.title, 'Open to the pool');

  // Once somebody claims it the offer is over, and the college scoping applies
  // again — an outsider has no business reading another college's work.
  const taken = await open(claimed._id, outsiderTok);
  assert.equal(taken.status, 404, 'claimed work must not stay open to every designer');
});

test('an Admin over the college can approve a design, or reject it with changes', async () => {
  const { default: Notification } = await import('../models/Notification.js');
  const org = await Organization.findOne({ slug: 'test-college' });
  const admin = await User.create({
    name: 'DecideAdmin', email: 'decide-admin@t.com', password: 'Passw0rd!',
    role: ROLES.CEO, organization: org._id,
  });
  const otherOrg = await Organization.create({ name: 'Decide Other', slug: 'decide-other' });
  const outsider = await User.create({
    name: 'DecideOutsider', email: 'decide-out@t.com', password: 'Passw0rd!',
    role: ROLES.CEO, organization: otherOrg._id,
  });
  const adminTok = generateToken(admin._id);

  const submitted = await create(tok.designer, {
    title: 'Decide me', type: APPROVAL_TYPES.DESIGN, organization: orgId,
  });
  assert.equal(submitted.status, 201);
  const id = submitted.body.request._id;

  // Both deciders hear about it.
  const told = await Notification.find({ relatedRequest: id }).populate('recipient', 'name');
  const names = told.map((n) => n.recipient?.name);
  assert.ok(names.includes('DecideAdmin'), 'the Admin over the college is told');
  assert.ok(names.includes('Super'), 'the super admin is told');

  const put = (path, token, body) => fetch(`${origin}${path}`, {
    method: 'PUT',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body || {}),
  }).then(async (r) => ({ status: r.status, body: await r.json() }));

  // An Admin of another college has no say, and is not even told it exists.
  const refused = await put(`/api/approvals/${id}/reject`, generateToken(outsider._id), {
    feedbackPoints: [{ text: 'no', category: 'Content' }],
  });
  assert.equal(refused.status, 404);

  // Reject WITH the changes spelled out.
  const rejected = await put(`/api/approvals/${id}/reject`, adminTok, {
    feedbackPoints: [{ text: 'Logo too small', category: 'Image' }, { text: 'Fix the tagline', category: 'Content' }],
  });
  assert.equal(rejected.status, 200);
  assert.equal(rejected.body.request.status, APPROVAL_STATUS.REJECTED);
  const round = rejected.body.request.reviews.slice(-1)[0];
  assert.equal(round.feedbackPoints.length, 2, 'the changes are recorded against the review round');
  assert.equal(round.feedbackPoints[0].category, 'Image');
  // And the designer is told what to change.
  const backToDesigner = await Notification.findOne({ relatedRequest: id, title: /revision/i });
  assert.ok(backToDesigner, 'the designer hears that changes were asked for');
  assert.match(backToDesigner.message, /2 note/);

  // And an Admin can sign one off outright.
  const second = await create(tok.designer, {
    title: 'Approve me', type: APPROVAL_TYPES.DESIGN, organization: orgId,
  });
  const approved = await put(`/api/approvals/${second.body.request._id}/approve`, adminTok, {});
  assert.equal(approved.status, 200);
  assert.equal(approved.body.request.status, APPROVAL_STATUS.APPROVED);
});

// The "My assigned work" picker on the new-request form offers everything except
// completed work. Asking the server for ACKNOWLEDGED only used to hide work the
// designer had already submitted once — exactly what a re-submission points at.
test('a submission can be linked to work in progress or already submitted, but not completed', async () => {
  const { default: WorkAssignment } = await import('../models/WorkAssignment.js');
  const org = await Organization.findOne({ slug: 'test-college' });
  const designer = await User.findOne({ email: 'dee@t.com' });
  const su = await User.findOne({ email: 'super@t.com' });

  const made = {};
  for (const status of ['OPEN', 'ACKNOWLEDGED', 'SUBMITTED', 'DONE']) {
    made[status] = await WorkAssignment.create({
      organization: org._id, title: `Linkable ${status}`, assignee: designer._id,
      assigneeType: USER_TYPES.DESIGNER, createdBy: su._id, status,
    });
  }

  const link = (id, title) => create(tok.designer, {
    title, type: APPROVAL_TYPES.DESIGN, organization: orgId, workAssignment: String(id),
  });

  // In progress and already-submitted both link — the second is what a
  // re-submission needs.
  assert.equal((await link(made.ACKNOWLEDGED._id, 'For in-progress')).status, 201);
  assert.equal((await link(made.SUBMITTED._id, 'For submitted')).status, 201);

  // Completed work is finished and signed off, so nothing new belongs on it —
  // and it is filtered out of the picker for the same reason.
  const done = await link(made.DONE._id, 'For done');
  assert.equal(done.status, 400);
  assert.match(done.body.message, /already complete/);

  // Handing in the work IS taking it, so OPEN work is claimed by submitting
  // rather than refused — being told to "acknowledge first" was a dead end for a
  // social handler (who has no acknowledge step) and busywork for a designer.
  const open = await link(made.OPEN._id, 'For open');
  assert.equal(open.status, 201);
  const claimed = await WorkAssignment.findById(made.OPEN._id);
  assert.equal(claimed.status, 'ACKNOWLEDGED', 'submitting against it claims it');
});

// The claim still has to shut the other designers out of a shared brief — that
// is the whole reason acknowledging exists, and routing it through submission
// must not lose it.
test('claiming a shared brief by submitting still locks the other designers out', async () => {
  const { default: WorkAssignment } = await import('../models/WorkAssignment.js');
  const org = await Organization.findOne({ slug: 'test-college' });
  const asha = await User.findOne({ email: 'dee@t.com' });
  const ravi = await User.create({
    name: 'Ravi', email: 'ravi@t.com', password: 'Passw0rd!',
    role: ROLES.USER, userType: USER_TYPES.DESIGNER, organization: org._id,
  });
  const group = new mongoose.Types.ObjectId();
  const mk = (assignee) => WorkAssignment.create({
    organization: org._id, title: 'Shared brief', assignee, assigneeType: USER_TYPES.DESIGNER,
    createdBy: asha._id, status: 'OPEN', allocationGroup: group,
  });
  const hers = await mk(asha._id);
  const his = await mk(ravi._id);

  const first = await create(tok.designer, {
    title: 'Ashas finished work', type: APPROVAL_TYPES.DESIGN, organization: orgId, workAssignment: String(hers._id),
  });
  assert.equal(first.status, 201);
  assert.equal((await WorkAssignment.findById(hers._id)).status, 'ACKNOWLEDGED');
  assert.ok((await WorkAssignment.findById(his._id)).acknowledgeLockedBy, 'the other designer is locked out');

  // And the second designer is refused, by either route.
  const second = await create(generateToken(ravi._id), {
    title: 'Ravis attempt', type: APPROVAL_TYPES.DESIGN, organization: orgId, workAssignment: String(his._id),
  });
  assert.equal(second.status, 409);
  assert.match(second.body.message, /already acknowledged/);
});

// One post going to several channels does not read the same on all of them, so
// the submitter writes a description and caption per channel and the reviewer
// sees each under the channel it belongs to.
test('a post to several channels carries copy per channel', async () => {
  const handler = await User.create({
    name: 'Handler', email: 'handler@t.com', password: 'Passw0rd!',
    role: ROLES.USER, userType: USER_TYPES.SOCIAL_HANDLER,
    organization: (await Organization.findOne({ slug: 'test-college' }))._id,
  });
  const handlerTok = generateToken(handler._id);

  const send = (platforms, platformContent) => {
    const fd = new FormData();
    fd.append('title', 'Placement results');
    fd.append('type', APPROVAL_TYPES.POST);
    fd.append('organization', orgId);
    platforms.forEach((p) => fd.append('platforms', p));
    fd.append('caption', 'shared fallback');
    fd.append('description', 'shared fallback desc');
    if (platformContent) fd.append('platformContent', JSON.stringify(platformContent));
    fd.append('images', new Blob([Buffer.from('png')], { type: 'image/png' }), 'a.png');
    return fetch(`${origin}/api/approvals`, {
      method: 'POST', headers: { Authorization: `Bearer ${handlerTok}` }, body: fd,
    }).then(async (r) => ({ status: r.status, body: await r.json() }));
  };

  const multi = await send(['LinkedIn', 'Instagram', 'Facebook'], [
    { platform: 'LinkedIn', caption: 'Proud to announce', description: 'Long-form write-up' },
    { platform: 'Instagram', caption: '100% placed', description: 'Short blurb' },
    { platform: 'Facebook', caption: 'Congratulations', description: 'FB version' },
  ]);
  assert.equal(multi.status, 201);
  const rows = multi.body.request.platformContent;
  assert.equal(rows.length, 3);
  // Kept in the order the channels were chosen, so the primary reads first.
  assert.deepEqual(rows.map((r) => r.platform), ['LinkedIn', 'Instagram', 'Facebook']);
  assert.equal(rows[1].caption, '100% placed');
  // The primary channel's pair is mirrored, so everything reading one caption
  // (search, reports, the posting helpers) still gets the right words.
  assert.equal(multi.body.request.caption, 'Proud to announce');
  assert.equal(multi.body.request.description, 'Long-form write-up');

  // One channel needs no per-channel split — the plain pair says it all.
  const single = await send(['LinkedIn'], null);
  assert.equal(single.body.request.platformContent, undefined);
  assert.equal(single.body.request.caption, 'shared fallback');

  // A channel that was not chosen cannot smuggle copy in, and a blank pair is
  // dropped rather than stored as an empty shell.
  const filtered = await send(['LinkedIn', 'Instagram'], [
    { platform: 'LinkedIn', caption: 'ok', description: '' },
    { platform: 'YouTube', caption: 'not chosen', description: 'x' },
    { platform: 'Instagram', caption: '', description: '' },
  ]);
  assert.deepEqual(filtered.body.request.platformContent.map((r) => r.platform), ['LinkedIn']);
});

// A handler's finished post needs one decision, not two. They submit it, a
// decider approves it outright — no "who should handle this next?", because the
// author is the one who publishes it — and they mark it posted themselves.
test('a handler’s post is approved outright and posted by them', async () => {
  const { default: Notification } = await import('../models/Notification.js');
  const org = await Organization.findOne({ slug: 'test-college' });
  const handler = await User.create({
    name: 'Poster', email: 'poster@t.com', password: 'Passw0rd!',
    role: ROLES.USER, userType: USER_TYPES.SOCIAL_HANDLER, organization: org._id,
    handles: [{ organization: org._id, platforms: ['LinkedIn'] }],
  });
  const admin = await User.create({
    name: 'PostAdmin', email: 'post-admin@t.com', password: 'Passw0rd!',
    role: ROLES.CEO, organization: org._id,
  });
  const handlerTok = generateToken(handler._id);

  const submitted = await create(handlerTok, {
    title: 'Placement results', type: APPROVAL_TYPES.POST, organization: orgId,
    platforms: 'LinkedIn', caption: 'We did it',
  });
  assert.equal(submitted.status, 201);
  assert.equal(submitted.body.request.status, APPROVAL_STATUS.PENDING);
  const id = submitted.body.request._id;

  const put = (path, token, body) => fetch(`${origin}${path}`, {
    method: 'PUT',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body || {}),
  }).then(async (r) => ({ status: r.status, body: await r.json() }));

  // Approving with no routing payload is what the Approve button now sends for
  // a post — it must be the whole decision.
  const approved = await put(`/api/approvals/${id}/approve`, generateToken(admin._id), {});
  assert.equal(approved.status, 200);
  assert.equal(approved.body.request.status, APPROVAL_STATUS.APPROVED);

  // And the author is told to go and publish it, not merely that a status moved.
  const back = await Notification.findOne({ recipient: handler._id, relatedRequest: id }).sort({ createdAt: -1 });
  assert.match(back.title, /ready to post/i);
  assert.match(back.message, /mark it as posted/i);

  // Which they then do themselves — no second sign-off.
  const posted = await put(`/api/approvals/${id}/posted`, handlerTok, {});
  assert.equal(posted.status, 200);
  assert.equal(posted.body.request.status, APPROVAL_STATUS.POSTED);
});

// "Mark as posted" is really the question "when did/does this go out?". A handler
// can answer "at this time", and the sweep closes it then without anyone
// coming back to click.
test('a handler can set the go-live time and it closes itself when it arrives', async () => {
  const { default: ApprovalRequest } = await import('../models/ApprovalRequest.js');
  const { default: Notification } = await import('../models/Notification.js');
  const { publishDueScheduledPosts } = await import('../services/scheduledPosts.js');
  const org = await Organization.findOne({ slug: 'test-college' });
  const handler = await User.create({
    name: 'Timer', email: 'timer@t.com', password: 'Passw0rd!',
    role: ROLES.USER, userType: USER_TYPES.SOCIAL_HANDLER, organization: org._id,
    handles: [{ organization: org._id, platforms: ['LinkedIn'] }],
  });
  const handlerTok = generateToken(handler._id);

  const submitted = await create(handlerTok, {
    title: 'Timed post', type: APPROVAL_TYPES.POST, organization: orgId, platforms: 'LinkedIn', caption: 'soon',
  });
  const id = submitted.body.request._id;
  const put = (path, token, body) => fetch(`${origin}${path}`, {
    method: 'PUT',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body || {}),
  }).then(async (r) => ({ status: r.status, body: await r.json() }));
  await put(`/api/approvals/${id}/approve`, tok.super, {});

  // The handler books the time themselves — they do not need an admin for it.
  const soon = new Date(Date.now() + 90_000);
  const booked = await put(`/api/approvals/${id}/schedule`, handlerTok, { scheduledAt: soon.toISOString() });
  assert.equal(booked.status, 200);
  assert.equal((await ApprovalRequest.findById(id)).status, APPROVAL_STATUS.APPROVED, 'not posted before its time');

  // Nothing is due yet.
  assert.equal((await publishDueScheduledPosts(new Date())).length, 0);

  // The moment arrives and the sweep closes it, crediting whoever set the time.
  const published = await publishDueScheduledPosts(new Date(Date.now() + 120_000));
  assert.ok(published.map(String).includes(String(id)));
  const closed = await ApprovalRequest.findById(id);
  assert.equal(closed.status, APPROVAL_STATUS.POSTED);
  assert.equal(String(closed.postedBy), String(handler._id));
  assert.ok(closed.postedAt, 'the time it went out is recorded');

  const told = await Notification.findOne({ recipient: handler._id, relatedRequest: id, title: /live/i });
  assert.ok(told, 'they are told it went live');
});
