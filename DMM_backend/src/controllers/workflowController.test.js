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
const { default: ApprovalRequest } = await import('../models/ApprovalRequest.js');
const { default: ApprovalComment } = await import('../models/ApprovalComment.js');
const { default: Notification } = await import('../models/Notification.js');
const { generateToken } = await import('../utils/token.js');
const { ROLES, USER_TYPES, SOCIAL_PLATFORMS } = await import('../config/constants.js');

let mongod, server, origin, orgId;
const tok = {};
const ids = {};

before(async () => {
  mongod = await MongoMemoryServer.create();
  await mongoose.connect(mongod.getUri());
  const org = await Organization.create({ name: 'Test College', slug: 'test-college' });
  orgId = String(org._id);

  const [su, admin, coordinator, designer, designer2, handler, handler2] = await User.create([
    { name: 'Super', email: 'su@t.com', password: 'Passw0rd!', role: ROLES.ADMIN, isSuperAdmin: true },
    { name: 'Ada', email: 'ada@t.com', password: 'Passw0rd!', role: ROLES.CEO, organization: org._id },
    { name: 'Coco', email: 'coco@t.com', password: 'Passw0rd!', role: ROLES.USER, userType: USER_TYPES.COORDINATOR, organization: org._id },
    { name: 'Dee', email: 'dee@t.com', password: 'Passw0rd!', role: ROLES.USER, userType: USER_TYPES.DESIGNER, organization: org._id },
    { name: 'Dot', email: 'dot@t.com', password: 'Passw0rd!', role: ROLES.USER, userType: USER_TYPES.DESIGNER, organization: org._id },
    // Posting work is scoped to the pages a handler actually runs, so a handler
    // with no `handles` mapping runs nothing and would see an empty board. Both of
    // these cover every channel, which keeps the exclusivity tests below about the
    // race for the work rather than about who is mapped to what.
    //
    // Note a handler's mapping is also one of the three sources for "which
    // channels does this college run", so the tests that assert an exact channel
    // list clear every mapping first rather than only Hana's.
    {
      name: 'Hana', email: 'hana@t.com', password: 'Passw0rd!', role: ROLES.USER,
      userType: USER_TYPES.SOCIAL_HANDLER, organization: org._id,
      handles: [{ organization: org._id, platforms: [...SOCIAL_PLATFORMS] }],
    },
    {
      name: 'Hugo', email: 'hugo@t.com', password: 'Passw0rd!', role: ROLES.USER,
      userType: USER_TYPES.SOCIAL_HANDLER, organization: org._id,
      handles: [{ organization: org._id, platforms: [...SOCIAL_PLATFORMS] }],
    },
  ]);
  Object.assign(ids, {
    su: su._id, admin: admin._id, coordinator: coordinator._id,
    designer: designer._id, designer2: designer2._id, handler: handler._id, handler2: handler2._id,
  });
  Object.assign(tok, {
    su: generateToken(su._id), admin: generateToken(admin._id), coordinator: generateToken(coordinator._id),
    designer: generateToken(designer._id), designer2: generateToken(designer2._id),
    handler: generateToken(handler._id), handler2: generateToken(handler2._id),
  });

  server = app.listen(0);
  await new Promise((r) => server.once('listening', r));
  origin = `http://127.0.0.1:${server.address().port}`;
});

after(async () => { server?.close(); await mongoose.disconnect(); await mongod?.stop(); });

// --- helpers -----------------------------------------------------------------

const api = (token, path, { method = 'GET', body } = {}) =>
  fetch(`${origin}${path}`, {
    method,
    headers: { Authorization: `Bearer ${token}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
  }).then(async (r) => ({ status: r.status, body: await r.json() }));

/** The coordinator's existing design request — raised through the existing route. */
const raiseRequest = async ({
  title,
  workType = 'DIGITAL_MEDIA',
  // Social media work by default, because that is the path with a posting half.
  // Override both to exercise digital work that has no page to go on.
  workCategory = 'Social Media',
  workItem = 'Social Media Posts',
  // A Social Media design request now has to name its pages at raise time
  // too (mirrors the mandatory-platforms rule in institutionRequestController.js)
  // — LinkedIn is always available to the default seeded org, so this is a
  // safe default; pass [] to exercise the "no platforms picked" validation
  // itself, or a narrower list for a test that cares which ones.
  platforms = ['LinkedIn'],
}) => {
  const fd = new FormData();
  fd.append('title', title);
  fd.append('details', `Please make ${title}`);
  fd.append('workType', workType);
  fd.append('category', 'Content');
  // The existing form requires these — supplying them is the point: this goes
  // through the real request route, not a shortcut around it.
  fd.append('workCategory', workCategory);
  fd.append('workItem', workItem);
  fd.append('department', 'CSE');
  const isSocial = workType === 'DIGITAL_MEDIA' && (workCategory === 'Social Media' || workItem === 'Animated Social Media Posts');
  if (isSocial) platforms.forEach((p) => fd.append('platforms', p));
  const res = await fetch(`${origin}/api/requests`, {
    method: 'POST', headers: { Authorization: `Bearer ${tok.coordinator}` }, body: fd,
  });
  const body = await res.json();
  assert.equal(res.status, 201, `raising the request failed: ${JSON.stringify(body)}`);
  return body.request;
};

/** Send work for approval, with a file when the design half needs artwork. */
const submit = async (token, id, { withFile = true, caption, note } = {}) => {
  const fd = new FormData();
  if (withFile) fd.append('files', new Blob([Buffer.from('art')], { type: 'image/png' }), 'design.png');
  if (caption !== undefined) fd.append('caption', caption);
  if (note !== undefined) fd.append('note', note);
  const res = await fetch(`${origin}/api/workflow/${id}/submit`, {
    method: 'PUT', headers: { Authorization: `Bearer ${token}` }, body: fd,
  });
  return { status: res.status, body: await res.json() };
};

const stageOf = async (id) => (await InstitutionRequest.findById(id).lean()).workflowStage;

/**
 * Put the seeded handler mappings back.
 *
 * Posting work is scoped to the pages a handler runs, so a test that narrows
 * those mappings to assert an exact channel list has to restore them or every
 * post-half test afterwards is left with a handler who runs nothing.
 */
const restoreHandlerPages = () => User.updateMany(
  { _id: { $in: [ids.handler, ids.handler2] } },
  { handles: [{ organization: orgId, platforms: [...SOCIAL_PLATFORMS] }] }
);

// --- the boards --------------------------------------------------------------

test('a raised request appears in Designs to be Done straight away', async () => {
  const reqDoc = await raiseRequest({ title: 'Placement poster' });
  assert.equal(reqDoc.workflowStage, 'DESIGN_OPEN', 'it enters the board on being raised');

  const board = await api(tok.designer, '/api/workflow?board=DESIGN');
  assert.equal(board.status, 200);
  assert.ok(board.body.items.some((i) => i._id === reqDoc._id), 'the designer sees it waiting');
  assert.equal(board.body.counts.DESIGN_OPEN >= 1, true, 'and it counts toward the board tile');
});

test('the designer sees the details the coordinator already gave, not a new form', async () => {
  const reqDoc = await raiseRequest({ title: 'Open day banner' });
  const { status, body } = await api(tok.designer, `/api/workflow/${reqDoc._id}`);
  assert.equal(status, 200);
  assert.equal(body.item.title, 'Open day banner');
  assert.equal(body.item.details, 'Please make Open day banner');
  assert.equal(body.item.category, 'Content');
  assert.equal(body.item.raisedBy.name, 'Coco', 'and who asked for it');
  assert.equal(body.item.can.acknowledgeDesign, true);
});

test('a social media handler cannot reach the design board, and vice versa', async () => {
  assert.equal((await api(tok.handler, '/api/workflow?board=DESIGN')).status, 403);
  assert.equal((await api(tok.designer, '/api/workflow?board=POST')).status, 403);
  // Admins monitor both.
  assert.equal((await api(tok.admin, '/api/workflow?board=DESIGN')).status, 200);
  assert.equal((await api(tok.admin, '/api/workflow?board=POST')).status, 200);
});

// --- acknowledge -------------------------------------------------------------

test('acknowledging assigns the work and shuts every other designer out', async () => {
  const reqDoc = await raiseRequest({ title: 'Fest poster' });

  const mine = await api(tok.designer, `/api/workflow/${reqDoc._id}/acknowledge`, { method: 'PUT' });
  assert.equal(mine.status, 200);
  assert.equal(mine.body.item.workflowStage, 'DESIGN_IN_PROGRESS');
  assert.equal(mine.body.item.designer.name, 'Dee', 'the board shows who took it');

  const theirs = await api(tok.designer2, `/api/workflow/${reqDoc._id}/acknowledge`, { method: 'PUT' });
  assert.equal(theirs.status, 409, 'a second designer cannot take the same work');
  assert.match(theirs.body.message, /Dee/, 'and is told who has it');

  // The admin can still watch it.
  const seen = await api(tok.admin, `/api/workflow/${reqDoc._id}`);
  assert.equal(seen.status, 200);
  assert.equal(seen.body.item.designer.name, 'Dee');

  // The coordinator hears that somebody picked it up.
  const told = await Notification.find({ recipient: ids.coordinator, relatedRequest: reqDoc._id }).lean();
  assert.ok(told.length >= 1);
});

test('only a designer may take design work', async () => {
  const reqDoc = await raiseRequest({ title: 'Not for handlers' });
  const res = await api(tok.handler, `/api/workflow/${reqDoc._id}/acknowledge`, { method: 'PUT' });
  assert.equal(res.status, 403);
});

// --- design submission and admin review --------------------------------------

test('the designer must attach the finished design to send it for approval', async () => {
  const reqDoc = await raiseRequest({ title: 'Needs artwork' });
  await api(tok.designer, `/api/workflow/${reqDoc._id}/acknowledge`, { method: 'PUT' });
  const empty = await submit(tok.designer, reqDoc._id, { withFile: false });
  assert.equal(empty.status, 400);
  assert.match(empty.body.message, /Attach the finished design/i);
  assert.equal(await stageOf(reqDoc._id), 'DESIGN_IN_PROGRESS', 'and it stays with the designer');
});

test('the design goes to the admins, carrying the artwork and the original ask', async () => {
  const reqDoc = await raiseRequest({ title: 'Goes to admin' });
  await api(tok.designer, `/api/workflow/${reqDoc._id}/acknowledge`, { method: 'PUT' });
  const sent = await submit(tok.designer, reqDoc._id, { note: 'first cut' });
  assert.equal(sent.status, 200);
  assert.equal(sent.body.item.workflowStage, 'DESIGN_ADMIN_REVIEW');

  const detail = await api(tok.admin, `/api/workflow/${reqDoc._id}`);
  assert.equal(detail.body.item.design.images.length, 1, 'the approval carries the artwork');
  assert.equal(detail.body.item.title, 'Goes to admin', 'and the original request details ride along');
  assert.equal(detail.body.item.can.reviewDesign, true);

  // One approval, pointed back at the ask — not a copy of it.
  const approvals = await ApprovalRequest.find({ sourceRequest: reqDoc._id }).lean();
  assert.equal(approvals.length, 1);
  assert.equal(approvals[0].type, 'DESIGN');

  const told = await Notification.find({ recipient: ids.su, relatedRequest: reqDoc._id }).lean();
  assert.ok(told.length >= 1, 'the super admin is told');
});

/**
 * A rejected design and the one that replaces it must be tellable apart.
 *
 * Files are appended, never replaced — the earlier version is what a reviewer
 * compares against. Each round is stamped with its revision, so a reader can show
 * the current work on its own instead of one undivided pile.
 */
test('each round of a design is stamped, so the replacement is not mixed with what was rejected', async () => {
  const { default: ApprovalImage } = await import('../models/ApprovalImage.js');
  const reqDoc = await raiseRequest({ title: 'Two goes at it' });
  await api(tok.designer, `/api/workflow/${reqDoc._id}/acknowledge`, { method: 'PUT' });

  await submit(tok.designer, reqDoc._id);
  const approvalId = (await InstitutionRequest.findById(reqDoc._id).lean()).designApproval;
  const roundsOf = async () => (await ApprovalImage.find({ request: approvalId, kind: 'final' })
    .sort({ order: 1 }).lean()).map((m) => m.revision || 0);
  assert.deepEqual(await roundsOf(), [0], 'the first attempt is round 0');

  // Sent back, then answered with new artwork.
  await api(tok.su, `/api/workflow/${reqDoc._id}/review`, {
    method: 'PUT', body: { action: 'CHANGES', feedbackPoints: [{ text: 'Wrong logo' }] },
  });
  await submit(tok.designer, reqDoc._id);
  assert.deepEqual(await roundsOf(), [0, 1], 'the replacement is its own round, and the old one is kept');

  // A second round of changes keeps going up, so "latest" is never ambiguous.
  await api(tok.su, `/api/workflow/${reqDoc._id}/review`, {
    method: 'PUT', body: { action: 'CHANGES', feedbackPoints: [{ text: 'Still wrong' }] },
  });
  await submit(tok.designer, reqDoc._id);
  const rounds = await roundsOf();
  assert.deepEqual(rounds, [0, 1, 2]);

  // What a reviewer is served: everything, with the round on each file, so the
  // current work can be shown by itself.
  const detail = await api(tok.su, `/api/workflow/${reqDoc._id}`);
  const media = detail.body.item.design.images;
  assert.equal(media.length, 3, 'the trail is intact — nothing is destroyed');
  assert.ok(media.every((m) => Number.isInteger(m.revision)), 'and every file says which round it is');
  const current = media.filter((m) => m.revision === Math.max(...media.map((x) => x.revision)));
  assert.equal(current.length, 1, 'exactly one file is the current design');
});

// The handler publishes what was signed off, not the versions that were rejected.
test('only the approved round of artwork is carried onto the post content', async () => {
  const { default: ApprovalImage } = await import('../models/ApprovalImage.js');
  const reqDoc = await raiseRequest({ title: 'Carried clean' });
  await api(tok.designer, `/api/workflow/${reqDoc._id}/acknowledge`, { method: 'PUT' });
  await submit(tok.designer, reqDoc._id);
  await api(tok.su, `/api/workflow/${reqDoc._id}/review`, {
    method: 'PUT', body: { action: 'CHANGES', feedbackPoints: [{ text: 'Redo it' }] },
  });
  await submit(tok.designer, reqDoc._id);
  await api(tok.su, `/api/workflow/${reqDoc._id}/review`, { method: 'PUT', body: { action: 'APPROVE' } });
  await api(tok.coordinator, `/api/workflow/${reqDoc._id}/confirm`, {
    method: 'PUT', body: { action: 'DONE', platforms: ['LinkedIn'] },
  });
  await api(tok.handler, `/api/workflow/${reqDoc._id}/acknowledge`, { method: 'PUT' });

  const created = await handInPostViaApprovals(tok.handler, {
    workflowItem: reqDoc._id, title: 'Carried clean', org: orgId, caption: 'Out it goes',
  });
  assert.equal(created.status, 201);

  const postApproval = (await InstitutionRequest.findById(reqDoc._id).lean()).postApproval;
  const carried = await ApprovalImage.find({ request: postApproval, kind: 'final' }).lean();
  // Two design rounds existed; only the approved one travels, plus the handler's own file.
  const fromDesign = carried.filter((m) => !m.publicId);
  assert.equal(fromDesign.length, 1, 'the rejected artwork is not handed to the handler');
});

test('a designer cannot send in work assigned to somebody else', async () => {
  const reqDoc = await raiseRequest({ title: 'Not yours to submit' });
  await api(tok.designer, `/api/workflow/${reqDoc._id}/acknowledge`, { method: 'PUT' });
  const res = await submit(tok.designer2, reqDoc._id);
  assert.equal(res.status, 403);
});

test('admin changes go back to the designer, and every round is kept', async () => {
  const reqDoc = await raiseRequest({ title: 'Two rounds' });
  await api(tok.designer, `/api/workflow/${reqDoc._id}/acknowledge`, { method: 'PUT' });
  await submit(tok.designer, reqDoc._id);

  const back = await api(tok.admin, `/api/workflow/${reqDoc._id}/review`, {
    method: 'PUT', body: { action: 'CHANGES', feedbackPoints: [{ text: 'Logo too small', category: 'Image' }] },
  });
  assert.equal(back.status, 200);
  assert.equal(back.body.item.workflowStage, 'DESIGN_IN_PROGRESS', 'it returns to the designer');

  const seen = await api(tok.designer, `/api/workflow/${reqDoc._id}`);
  assert.equal(seen.body.item.design.reviews.length, 1);
  assert.equal(seen.body.item.design.reviews[0].feedbackPoints[0].text, 'Logo too small',
    'the designer can read what to change');

  // Round two: resubmit, more changes, then approve. Nothing is overwritten.
  await submit(tok.designer, reqDoc._id);
  await api(tok.admin, `/api/workflow/${reqDoc._id}/review`, {
    method: 'PUT', body: { action: 'CHANGES', feedbackPoints: [{ text: 'Wrong shade of red', category: 'Image' }] },
  });
  const after = await api(tok.designer, `/api/workflow/${reqDoc._id}`);
  assert.equal(after.body.item.design.reviews.length, 2, 'both rounds are on the record');
  const feedback = await ApprovalComment.find({ request: after.body.item.design._id, kind: 'feedback' }).lean();
  assert.equal(feedback.length, 2, 'and the history keeps each point');
  assert.deepEqual(feedback.map((f) => f.reviewRound), [1, 2]);
});

test('changes must say what to change', async () => {
  const reqDoc = await raiseRequest({ title: 'Empty feedback' });
  await api(tok.designer, `/api/workflow/${reqDoc._id}/acknowledge`, { method: 'PUT' });
  await submit(tok.designer, reqDoc._id);
  const res = await api(tok.admin, `/api/workflow/${reqDoc._id}/review`, {
    method: 'PUT', body: { action: 'CHANGES', feedbackPoints: [] },
  });
  assert.equal(res.status, 400);
});

test('a designer cannot approve their own design', async () => {
  const reqDoc = await raiseRequest({ title: 'No self approval' });
  await api(tok.designer, `/api/workflow/${reqDoc._id}/acknowledge`, { method: 'PUT' });
  await submit(tok.designer, reqDoc._id);
  const res = await api(tok.designer, `/api/workflow/${reqDoc._id}/review`, {
    method: 'PUT', body: { action: 'APPROVE' },
  });
  assert.equal(res.status, 403);
});

// --- coordinator design review ----------------------------------------------

test('an approved design goes back to the coordinator who raised it', async () => {
  const reqDoc = await raiseRequest({ title: 'Back to Coco' });
  await api(tok.designer, `/api/workflow/${reqDoc._id}/acknowledge`, { method: 'PUT' });
  await submit(tok.designer, reqDoc._id);
  const ok = await api(tok.su, `/api/workflow/${reqDoc._id}/review`, { method: 'PUT', body: { action: 'APPROVE' } });
  assert.equal(ok.status, 200);
  assert.equal(ok.body.item.workflowStage, 'DESIGN_COORDINATOR_REVIEW');

  const theirs = await api(tok.coordinator, `/api/workflow/${reqDoc._id}`);
  assert.equal(theirs.status, 200);
  assert.equal(theirs.body.item.can.acceptDesign, true, 'they get the Done / Changes decision');
  assert.equal(theirs.body.item.design.images.length, 1, 'with the finished design');
  assert.equal(theirs.body.item.details, 'Please make Back to Coco', 'and their original message');
});

test('another coordinator cannot confirm somebody else’s request', async () => {
  const other = await User.create({
    name: 'Nosy', email: 'nosy@t.com', password: 'Passw0rd!',
    role: ROLES.USER, userType: USER_TYPES.COORDINATOR, organization: new mongoose.Types.ObjectId(),
  });
  const reqDoc = await raiseRequest({ title: 'Mine alone' });
  await api(tok.designer, `/api/workflow/${reqDoc._id}/acknowledge`, { method: 'PUT' });
  await submit(tok.designer, reqDoc._id);
  await api(tok.su, `/api/workflow/${reqDoc._id}/review`, { method: 'PUT', body: { action: 'APPROVE' } });

  const res = await api(generateToken(other._id), `/api/workflow/${reqDoc._id}/confirm`, {
    method: 'PUT', body: { action: 'DONE' },
  });
  assert.ok([403, 404].includes(res.status), `expected a refusal, got ${res.status}`);
});

test('coordinator changes send it back through the designer AND the admins again', async () => {
  const reqDoc = await raiseRequest({ title: 'Coordinator loop' });
  await api(tok.designer, `/api/workflow/${reqDoc._id}/acknowledge`, { method: 'PUT' });
  await submit(tok.designer, reqDoc._id);
  await api(tok.su, `/api/workflow/${reqDoc._id}/review`, { method: 'PUT', body: { action: 'APPROVE' } });

  const back = await api(tok.coordinator, `/api/workflow/${reqDoc._id}/confirm`, {
    method: 'PUT', body: { action: 'CHANGES', feedbackPoints: [{ text: 'Use the new tagline', category: 'Content' }] },
  });
  assert.equal(back.status, 200);
  assert.equal(back.body.item.workflowStage, 'DESIGN_IN_PROGRESS', 'the designer picks it up again');

  // The admins see the coordinator's notes too — they own the gate it returns through.
  const adminTold = await Notification.find({ recipient: ids.su, relatedRequest: reqDoc._id }).lean();
  assert.ok(adminTold.some((n) => /changes/i.test(n.title)), 'the admins are told about the feedback');

  // Round trip: resubmit → admin approve → back to the coordinator.
  await submit(tok.designer, reqDoc._id);
  assert.equal(await stageOf(reqDoc._id), 'DESIGN_ADMIN_REVIEW', 'admin review is not skipped');
  await api(tok.su, `/api/workflow/${reqDoc._id}/review`, { method: 'PUT', body: { action: 'APPROVE' } });
  assert.equal(await stageOf(reqDoc._id), 'DESIGN_COORDINATOR_REVIEW');
});

/**
 * Accepting a digital design is also where the college says where it goes.
 *
 * The handler picking the work up should not have to guess the channels, and the
 * admin should not be choosing them on the college's behalf — so the pages are
 * asked for at the moment the coordinator accepts, and required.
 */
test('the coordinator must choose the pages when accepting a digital design', async () => {
  const reqDoc = await raiseRequest({ title: 'Needs pages' });
  await api(tok.designer, `/api/workflow/${reqDoc._id}/acknowledge`, { method: 'PUT' });
  await submit(tok.designer, reqDoc._id);
  await api(tok.su, `/api/workflow/${reqDoc._id}/review`, { method: 'PUT', body: { action: 'APPROVE' } });

  // Deliberately no pages: accepting without saying where it goes must be refused.
  const none = await api(tok.coordinator, `/api/workflow/${reqDoc._id}/confirm`, { method: 'PUT', body: { action: 'DONE' } });
  assert.equal(none.status, 400);
  assert.match(none.body.message, /at least one page/i);
  assert.equal(await stageOf(reqDoc._id), 'DESIGN_COORDINATOR_REVIEW', 'and it stays with them');

  const bogus = await api(tok.coordinator, `/api/workflow/${reqDoc._id}/confirm`, {
    method: 'PUT', body: { action: 'DONE', platforms: ['MySpace'] },
  });
  assert.equal(bogus.status, 400, 'a channel the college does not run is refused');

  const ok = await api(tok.coordinator, `/api/workflow/${reqDoc._id}/confirm`, {
    method: 'PUT', body: { action: 'DONE', platforms: ['LinkedIn', 'Instagram'] },
  });
  assert.equal(ok.status, 200);
  assert.deepEqual(ok.body.item.postPlatforms, ['LinkedIn', 'Instagram']);
  assert.equal(ok.body.item.workflowStage, 'POST_OPEN');
});

/**
 * A college's channels are recorded in three places, and the picker needs all of
 * them. Reading only the accounts register offered ToriiMinds two channels when a
 * handler was assigned to a third and the college had it connected.
 */
test('the pages offered are every channel the college runs, from all three sources', async () => {
  const { default: SocialAccount } = await import('../models/SocialAccount.js');
  const { default: Organization } = await import('../models/Organization.js');
  await SocialAccount.deleteMany({ organization: orgId });

  // 1. the accounts register
  await SocialAccount.create([{ organization: orgId, platform: 'LinkedIn' }]);
  // 2. a channel connected on the organization itself
  await Organization.findByIdAndUpdate(orgId, { youtubeChannelId: 'UC-test-channel' });
  // 3. a handler mapped to something neither of those mentions. Every other
  // mapping is cleared first, or the seeded handlers would supply the rest.
  await User.updateMany({ userType: USER_TYPES.SOCIAL_HANDLER }, { handles: [] });
  await User.findByIdAndUpdate(ids.handler, {
    handles: [{ organization: orgId, platforms: ['Instagram'] }],
  });

  const reqDoc = await raiseRequest({ title: 'Every channel' });
  await api(tok.designer, `/api/workflow/${reqDoc._id}/acknowledge`, { method: 'PUT' });
  await submit(tok.designer, reqDoc._id);
  await api(tok.su, `/api/workflow/${reqDoc._id}/review`, { method: 'PUT', body: { action: 'APPROVE' } });

  const detail = await api(tok.coordinator, `/api/workflow/${reqDoc._id}`);
  assert.deepEqual(detail.body.item.availablePlatforms, ['LinkedIn', 'Instagram', 'YouTube'],
    'all three sources, in the platform list’s own order');

  // Every one of them is accepted, not just the registered one.
  const ok = await api(tok.coordinator, `/api/workflow/${reqDoc._id}/confirm`, {
    method: 'PUT', body: { action: 'DONE', platforms: ['YouTube', 'Instagram'] },
  });
  assert.equal(ok.status, 200);
  assert.deepEqual(ok.body.item.postPlatforms, ['YouTube', 'Instagram']);
});

test('a channel the college does not run at all is still refused', async () => {
  const { default: SocialAccount } = await import('../models/SocialAccount.js');
  const { default: Organization } = await import('../models/Organization.js');
  await SocialAccount.deleteMany({ organization: orgId });
  await SocialAccount.create([{ organization: orgId, platform: 'LinkedIn' }]);
  await Organization.findByIdAndUpdate(orgId, { youtubeChannelId: '' });
  // One handler, one channel — so LinkedIn is the only thing this college runs.
  // The post-half tests below inherit this mapping and post on LinkedIn.
  await User.updateMany({ userType: USER_TYPES.SOCIAL_HANDLER }, { handles: [] });
  await User.findByIdAndUpdate(ids.handler, { handles: [{ organization: orgId, platforms: ['LinkedIn'] }] });

  const reqDoc = await raiseRequest({ title: 'LinkedIn only' });
  await api(tok.designer, `/api/workflow/${reqDoc._id}/acknowledge`, { method: 'PUT' });
  await submit(tok.designer, reqDoc._id);
  await api(tok.su, `/api/workflow/${reqDoc._id}/review`, { method: 'PUT', body: { action: 'APPROVE' } });

  const detail = await api(tok.coordinator, `/api/workflow/${reqDoc._id}`);
  assert.deepEqual(detail.body.item.availablePlatforms, ['LinkedIn']);
  const refused = await api(tok.coordinator, `/api/workflow/${reqDoc._id}/confirm`, {
    method: 'PUT', body: { action: 'DONE', platforms: ['Facebook'] },
  });
  assert.equal(refused.status, 400);
  assert.match(refused.body.message, /does not have Facebook/i);

  await SocialAccount.deleteMany({ organization: orgId });
  await restoreHandlerPages();
});

test('print work needs no pages — there is nothing to post', async () => {
  const reqDoc = await raiseRequest({ title: 'Print needs none', workType: 'PRINT_MEDIA' });
  await api(tok.designer, `/api/workflow/${reqDoc._id}/acknowledge`, { method: 'PUT' });
  await submit(tok.designer, reqDoc._id);
  await api(tok.su, `/api/workflow/${reqDoc._id}/review`, { method: 'PUT', body: { action: 'APPROVE' } });
  const done = await api(tok.coordinator, `/api/workflow/${reqDoc._id}/confirm`, { method: 'PUT', body: { action: 'DONE', platforms: ['LinkedIn'] } });
  assert.equal(done.status, 200, 'no pages are asked for');
  assert.equal(done.body.item.workflowStage, 'COMPLETED');
  assert.deepEqual(done.body.item.postPlatforms, []);
});

test('To Be Posted carries the ask, the design, the coordinator’s acceptance and the pages', async () => {
  const reqDoc = await raiseRequest({ title: 'Everything travels' });
  await api(tok.designer, `/api/workflow/${reqDoc._id}/acknowledge`, { method: 'PUT' });
  await submit(tok.designer, reqDoc._id);
  await api(tok.su, `/api/workflow/${reqDoc._id}/review`, { method: 'PUT', body: { action: 'APPROVE' } });
  await api(tok.coordinator, `/api/workflow/${reqDoc._id}/confirm`, {
    method: 'PUT', body: { action: 'DONE', platforms: ['LinkedIn'] },
  });

  // What the handler opens off the To Be Posted board.
  const board = await api(tok.handler, '/api/workflow?board=POST');
  const row = board.body.items.find((i) => i._id === reqDoc._id);
  assert.ok(row, 'it is on the board');
  assert.deepEqual(row.postPlatforms, ['LinkedIn'], 'with the pages on the row itself');

  const detail = await api(tok.handler, `/api/workflow/${reqDoc._id}`);
  const it = detail.body.item;
  assert.equal(it.details, 'Please make Everything travels', 'the coordinator’s original message');
  assert.equal(it.workCategory, 'Social Media', 'and what they asked for');
  assert.equal(it.design.images.length, 1, 'the approved design');
  assert.ok(it.designAcceptedAt, 'the coordinator’s acceptance');
  assert.equal(it.designAcceptedBy.name, 'Coco', 'and who gave it');
  assert.deepEqual(it.postPlatforms, ['LinkedIn'], 'and where it goes');
});

test('Done on a digital design opens the To Be Posted board', async () => {
  const reqDoc = await raiseRequest({ title: 'Digital goes on' });
  await api(tok.designer, `/api/workflow/${reqDoc._id}/acknowledge`, { method: 'PUT' });
  await submit(tok.designer, reqDoc._id);
  await api(tok.su, `/api/workflow/${reqDoc._id}/review`, { method: 'PUT', body: { action: 'APPROVE' } });
  const done = await api(tok.coordinator, `/api/workflow/${reqDoc._id}/confirm`, {
    method: 'PUT', body: { action: 'DONE', platforms: ['LinkedIn'] },
  });
  assert.equal(done.status, 200);
  assert.equal(done.body.item.workflowStage, 'POST_OPEN');

  const board = await api(tok.handler, '/api/workflow?board=POST');
  assert.ok(board.body.items.some((i) => i._id === reqDoc._id), 'the handler now sees it');

  // No second request record was made anywhere along the way.
  assert.equal(await InstitutionRequest.countDocuments({ title: 'Digital goes on' }), 1);
});

test('print work finishes at the coordinator — there is nothing to post', async () => {
  const reqDoc = await raiseRequest({ title: 'Print brochure', workType: 'PRINT_MEDIA' });
  await api(tok.designer, `/api/workflow/${reqDoc._id}/acknowledge`, { method: 'PUT' });
  await submit(tok.designer, reqDoc._id);
  await api(tok.su, `/api/workflow/${reqDoc._id}/review`, { method: 'PUT', body: { action: 'APPROVE' } });
  const done = await api(tok.coordinator, `/api/workflow/${reqDoc._id}/confirm`, { method: 'PUT', body: { action: 'DONE', platforms: ['LinkedIn'] } });
  assert.equal(done.body.item.workflowStage, 'COMPLETED');

  const board = await api(tok.handler, '/api/workflow?board=POST');
  assert.ok(!board.body.items.some((i) => i._id === reqDoc._id), 'print work never reaches the posting board');
});

// The posting half is for social media work, not for everything digital. An LED
// screen design has no page to go on, so the college is never asked to pick one
// and no handler is given posting work that cannot honestly be closed.
test('digital work that is not a social post also finishes at the coordinator', async () => {
  const reqDoc = await raiseRequest({
    title: 'Auditorium LED loop', workCategory: 'Event Media', workItem: 'LED Screen Content',
  });
  await api(tok.designer, `/api/workflow/${reqDoc._id}/acknowledge`, { method: 'PUT' });
  await submit(tok.designer, reqDoc._id);
  await api(tok.su, `/api/workflow/${reqDoc._id}/review`, { method: 'PUT', body: { action: 'APPROVE' } });

  // No pages are offered, and none are demanded: confirming with nothing set works.
  const detail = await api(tok.coordinator, `/api/workflow/${reqDoc._id}`);
  assert.equal(detail.body.item.needsPosting, false, 'the coordinator is not asked where to post it');
  assert.deepEqual(detail.body.item.availablePlatforms, []);

  const done = await api(tok.coordinator, `/api/workflow/${reqDoc._id}/confirm`, {
    method: 'PUT', body: { action: 'DONE' },
  });
  assert.equal(done.status, 200);
  assert.equal(done.body.item.workflowStage, 'COMPLETED');
  assert.deepEqual(done.body.item.postPlatforms, [], 'and no pages are recorded against it');

  const board = await api(tok.handler, '/api/workflow?board=POST');
  assert.ok(!board.body.items.some((i) => i._id === String(reqDoc._id)), 'it never reaches the posting board');
});

// A social post filed under another category is still a social post, and must
// still ask the college where it goes.
test('an animated social post is asked for pages even though it is motion graphics', async () => {
  const reqDoc = await raiseRequest({
    title: 'Animated results reel', workCategory: 'Motion Graphics', workItem: 'Animated Social Media Posts',
  });
  await api(tok.designer, `/api/workflow/${reqDoc._id}/acknowledge`, { method: 'PUT' });
  await submit(tok.designer, reqDoc._id);
  await api(tok.su, `/api/workflow/${reqDoc._id}/review`, { method: 'PUT', body: { action: 'APPROVE' } });

  const detail = await api(tok.coordinator, `/api/workflow/${reqDoc._id}`);
  assert.equal(detail.body.item.needsPosting, true);

  const bare = await api(tok.coordinator, `/api/workflow/${reqDoc._id}/confirm`, {
    method: 'PUT', body: { action: 'DONE' },
  });
  assert.equal(bare.status, 400, 'a social post cannot be accepted without saying where it goes');

  const done = await api(tok.coordinator, `/api/workflow/${reqDoc._id}/confirm`, {
    method: 'PUT', body: { action: 'DONE', platforms: ['LinkedIn'] },
  });
  assert.equal(done.body.item.workflowStage, 'POST_OPEN');
  assert.deepEqual(done.body.item.postPlatforms, ['LinkedIn']);
});

// --- the post half -----------------------------------------------------------

/** Walk an item to POST_OPEN so the posting half can be exercised. */
const readyToPost = async (title) => {
  const reqDoc = await raiseRequest({ title });
  await api(tok.designer, `/api/workflow/${reqDoc._id}/acknowledge`, { method: 'PUT' });
  await submit(tok.designer, reqDoc._id);
  await api(tok.su, `/api/workflow/${reqDoc._id}/review`, { method: 'PUT', body: { action: 'APPROVE' } });
  await api(tok.coordinator, `/api/workflow/${reqDoc._id}/confirm`, { method: 'PUT', body: { action: 'DONE', platforms: ['LinkedIn'] } });
  return reqDoc;
};

/**
 * The status has to say who is holding it.
 *
 * Both gates pass — the admins approve the design, the coordinator confirms it —
 * and social media work then belongs to a handler. Before this the request read
 * "Approved" for the whole of the posting half, which told the college the design
 * had passed review but not that anybody was publishing it.
 */
test('the status moves to the social handler once both gates pass, and closes when it is out', async () => {
  const reqDoc = await raiseRequest({ title: 'Status follows the work' });
  const statusOf = async () => (await InstitutionRequest.findById(reqDoc._id).lean()).status;
  assert.equal(await statusOf(), 'OPEN', 'raised: with the designers');

  await api(tok.designer, `/api/workflow/${reqDoc._id}/acknowledge`, { method: 'PUT' });
  await submit(tok.designer, reqDoc._id);
  assert.equal(await statusOf(), 'OPEN', 'a design in review is still not the handler’s problem');

  // The admins' approval alone is not the handover — the college has the last word.
  await api(tok.su, `/api/workflow/${reqDoc._id}/review`, { method: 'PUT', body: { action: 'APPROVE' } });
  assert.equal(await statusOf(), 'OPEN', 'approved by the admins, still waiting on the college');

  await api(tok.coordinator, `/api/workflow/${reqDoc._id}/confirm`, {
    method: 'PUT', body: { action: 'DONE', platforms: ['LinkedIn'] },
  });
  assert.equal(await statusOf(), 'WITH_SOCIAL_HANDLER', 'both gates passed: it is the handler’s now');
  assert.equal(await stageOf(reqDoc._id), 'POST_OPEN');

  // Published is the end of the road, not still "with the handler".
  await api(tok.handler, `/api/workflow/${reqDoc._id}/acknowledge`, { method: 'PUT' });
  await submit(tok.handler, reqDoc._id, { withFile: false, caption: 'Out it goes' });
  await api(tok.su, `/api/workflow/${reqDoc._id}/review`, { method: 'PUT', body: { action: 'APPROVE' } });
  await api(tok.coordinator, `/api/workflow/${reqDoc._id}/confirm`, { method: 'PUT', body: { action: 'DONE' } });
  assert.equal(await statusOf(), 'WITH_SOCIAL_HANDLER', 'released, but not out yet');

  await api(tok.handler, `/api/workflow/${reqDoc._id}/posted`, { method: 'PUT', body: {} });
  assert.equal(await statusOf(), 'APPROVED', 'posted: done');
});

test('work with no page to go on never passes to a handler', async () => {
  const reqDoc = await raiseRequest({ title: 'Nothing to publish', workType: 'PRINT_MEDIA' });
  await api(tok.designer, `/api/workflow/${reqDoc._id}/acknowledge`, { method: 'PUT' });
  await submit(tok.designer, reqDoc._id);
  await api(tok.su, `/api/workflow/${reqDoc._id}/review`, { method: 'PUT', body: { action: 'APPROVE' } });
  await api(tok.coordinator, `/api/workflow/${reqDoc._id}/confirm`, { method: 'PUT', body: { action: 'DONE' } });

  const after = await InstitutionRequest.findById(reqDoc._id).lean();
  assert.equal(after.workflowStage, 'COMPLETED');
  assert.equal(after.status, 'APPROVED', 'it is finished, not waiting on a handler');
});

/**
 * The pages the coordinator chose decide whose work this is.
 *
 * To Be Posted is not one shared pool: a handler is shown the work for the pages
 * they run, and the claim is refused for anyone else — including a handler who
 * runs the same channel for a different college.
 */
test('posting work reaches only the handlers of the pages the coordinator chose', async () => {
  const otherOrg = await Organization.create({ name: 'Far College', slug: 'far-college' });
  const [fbOnly, farLinkedIn] = await User.create([
    // Same college, a channel the coordinator did not choose.
    {
      name: 'Fay', email: 'fay@t.com', password: 'Passw0rd!', role: ROLES.USER,
      userType: USER_TYPES.SOCIAL_HANDLER, organization: orgId,
      handles: [{ organization: orgId, platforms: ['Facebook'] }],
    },
    // The right channel, the wrong college.
    {
      name: 'Fram', email: 'fram@t.com', password: 'Passw0rd!', role: ROLES.USER,
      userType: USER_TYPES.SOCIAL_HANDLER, organization: otherOrg._id,
      handles: [{ organization: otherOrg._id, platforms: ['LinkedIn'] }],
    },
  ]);

  const reqDoc = await readyToPost('Only for LinkedIn');
  const boardOf = async (token) => {
    const res = await api(token, '/api/workflow?board=POST');
    assert.equal(res.status, 200);
    return res.body.items.map((i) => i._id);
  };

  assert.ok((await boardOf(tok.handler)).includes(String(reqDoc._id)), 'the LinkedIn handler sees it');
  assert.ok(!(await boardOf(generateToken(fbOnly._id))).includes(String(reqDoc._id)), 'the Facebook handler does not');
  assert.ok(!(await boardOf(generateToken(farLinkedIn._id))).includes(String(reqDoc._id)), 'nor another college’s LinkedIn handler');
  // Oversight is unchanged — the admins still see the whole pipeline.
  assert.ok((await boardOf(tok.su)).includes(String(reqDoc._id)), 'the super admin still sees everything');

  // Hiding it on the board is not the enforcement; the claim itself is refused.
  const poached = await api(generateToken(fbOnly._id), `/api/workflow/${reqDoc._id}/acknowledge`, { method: 'PUT' });
  assert.equal(poached.status, 403);
  assert.match(poached.body.message, /LinkedIn/, 'and they are told which pages it is for');
  assert.equal(await stageOf(reqDoc._id), 'POST_OPEN', 'so it stays open for whoever does run it');

  // The detail page agrees with the board rather than offering a button that fails.
  const asFacebook = await api(generateToken(fbOnly._id), `/api/workflow/${reqDoc._id}`);
  assert.equal(asFacebook.body.item.can.acknowledgePost, false);
  const asLinkedIn = await api(tok.handler, `/api/workflow/${reqDoc._id}`);
  assert.equal(asLinkedIn.body.item.can.acknowledgePost, true);
});

test('only the handlers of the chosen pages are notified about new posting work', async () => {
  const otherPage = await User.create({
    name: 'Fenn', email: 'fenn@t.com', password: 'Passw0rd!', role: ROLES.USER,
    userType: USER_TYPES.SOCIAL_HANDLER, organization: orgId,
    handles: [{ organization: orgId, platforms: ['Facebook'] }],
  });

  const reqDoc = await readyToPost('Notify the right pages');
  const told = async (userId) => Notification.countDocuments({ recipient: userId, relatedRequest: reqDoc._id });

  assert.ok(await told(ids.handler) > 0, 'the LinkedIn handler hears about it');
  assert.equal(await told(otherPage._id), 0, 'the Facebook-only handler is not pestered');
});

test('the handler acknowledges exclusively, and sees the approved design', async () => {
  const reqDoc = await readyToPost('Handler takes it');

  const mine = await api(tok.handler, `/api/workflow/${reqDoc._id}/acknowledge`, { method: 'PUT' });
  assert.equal(mine.status, 200);
  assert.equal(mine.body.item.workflowStage, 'POST_IN_PROGRESS');
  assert.equal(mine.body.item.handler.name, 'Hana');

  const theirs = await api(tok.handler2, `/api/workflow/${reqDoc._id}/acknowledge`, { method: 'PUT' });
  assert.equal(theirs.status, 409, 'a second handler is shut out');

  const detail = await api(tok.handler, `/api/workflow/${reqDoc._id}`);
  assert.equal(detail.body.item.design.images.length, 1, 'they get the approved design');
  assert.equal(detail.body.item.details, 'Please make Handler takes it', 'and the original message');
  assert.equal(detail.body.item.can.submitPost, true);
});

test('post content goes to the admins, then the coordinator, then is released', async () => {
  const reqDoc = await readyToPost('Full post run');
  await api(tok.handler, `/api/workflow/${reqDoc._id}/acknowledge`, { method: 'PUT' });

  const sent = await submit(tok.handler, reqDoc._id, { withFile: false, caption: 'Proud to share our results!' });
  assert.equal(sent.status, 200);
  assert.equal(sent.body.item.workflowStage, 'POST_ADMIN_REVIEW');

  // A post approval alongside the design one, both pointed at the same ask.
  const approvals = await ApprovalRequest.find({ sourceRequest: reqDoc._id }).lean();
  assert.equal(approvals.length, 2);
  assert.deepEqual(approvals.map((a) => a.type).sort(), ['DESIGN', 'POST']);

  // Admin asks for changes first.
  await api(tok.admin, `/api/workflow/${reqDoc._id}/review`, {
    method: 'PUT', body: { action: 'CHANGES', feedbackPoints: [{ text: 'Add the hashtag', category: 'Content' }] },
  });
  assert.equal(await stageOf(reqDoc._id), 'POST_IN_PROGRESS');

  await submit(tok.handler, reqDoc._id, { withFile: false, caption: 'Proud to share our results! #placements' });
  await api(tok.admin, `/api/workflow/${reqDoc._id}/review`, { method: 'PUT', body: { action: 'APPROVE' } });
  assert.equal(await stageOf(reqDoc._id), 'POST_COORDINATOR_REVIEW');

  // The coordinator sees design + content + their own message before deciding.
  const theirs = await api(tok.coordinator, `/api/workflow/${reqDoc._id}`);
  assert.equal(theirs.body.item.can.acceptPost, true);
  assert.equal(theirs.body.item.design.images.length, 1);
  assert.equal(theirs.body.item.post.caption, 'Proud to share our results! #placements');
  assert.equal(theirs.body.item.details, 'Please make Full post run');

  // Coordinator loop once, then Done.
  await api(tok.coordinator, `/api/workflow/${reqDoc._id}/confirm`, {
    method: 'PUT', body: { action: 'CHANGES', feedbackPoints: [{ text: 'Mention the department', category: 'Content' }] },
  });
  assert.equal(await stageOf(reqDoc._id), 'POST_IN_PROGRESS');
  await submit(tok.handler, reqDoc._id, { withFile: false, caption: 'CSE placements!' });
  assert.equal(await stageOf(reqDoc._id), 'POST_ADMIN_REVIEW', 'admin approval is required again');
  await api(tok.admin, `/api/workflow/${reqDoc._id}/review`, { method: 'PUT', body: { action: 'APPROVE' } });
  const released = await api(tok.coordinator, `/api/workflow/${reqDoc._id}/confirm`, { method: 'PUT', body: { action: 'DONE', platforms: ['LinkedIn'] } });
  assert.equal(released.body.item.workflowStage, 'POST_APPROVED');

  const handlerTold = await Notification.find({ recipient: ids.handler, relatedRequest: reqDoc._id }).lean();
  assert.ok(handlerTold.some((n) => /ready to post/i.test(n.title)), 'the handler is told it can go out');
});

// --- mark as posted ----------------------------------------------------------

test('the handler cannot mark it posted before the coordinator releases it', async () => {
  const reqDoc = await readyToPost('Too early');
  await api(tok.handler, `/api/workflow/${reqDoc._id}/acknowledge`, { method: 'PUT' });
  await submit(tok.handler, reqDoc._id, { withFile: false, caption: 'x' });
  const res = await api(tok.handler, `/api/workflow/${reqDoc._id}/posted`, { method: 'PUT', body: {} });
  assert.equal(res.status, 409);
  assert.match(res.body.message, /not released/i);
});

/** Walk an item all the way to POST_APPROVED. */
const readyToPublish = async (title) => {
  const reqDoc = await readyToPost(title);
  await api(tok.handler, `/api/workflow/${reqDoc._id}/acknowledge`, { method: 'PUT' });
  await submit(tok.handler, reqDoc._id, { withFile: false, caption: 'Copy' });
  await api(tok.admin, `/api/workflow/${reqDoc._id}/review`, { method: 'PUT', body: { action: 'APPROVE' } });
  await api(tok.coordinator, `/api/workflow/${reqDoc._id}/confirm`, { method: 'PUT', body: { action: 'DONE', platforms: ['LinkedIn'] } });
  return reqDoc;
};

test('marking it posted now records the moment and ends the workflow', async () => {
  const reqDoc = await readyToPublish('Out now');
  const res = await api(tok.handler, `/api/workflow/${reqDoc._id}/posted`, { method: 'PUT', body: {} });
  assert.equal(res.status, 200);
  assert.equal(res.body.item.workflowStage, 'POSTED');

  const saved = await InstitutionRequest.findById(reqDoc._id).lean();
  assert.ok(saved.postedAt, 'the posted moment is stored');
  assert.equal(saved.scheduledFor, undefined, 'and it is not a schedule');

  const told = await Notification.find({ recipient: ids.coordinator, relatedRequest: reqDoc._id }).lean();
  assert.ok(told.some((n) => /live/i.test(n.title)), 'the coordinator hears it went out');
});

test('scheduling keeps the date and time it was booked for', async () => {
  const reqDoc = await readyToPublish('Out Friday');
  const when = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000);
  const res = await api(tok.handler, `/api/workflow/${reqDoc._id}/posted`, {
    method: 'PUT', body: { scheduledFor: when.toISOString() },
  });
  assert.equal(res.status, 200);

  const saved = await InstitutionRequest.findById(reqDoc._id).lean();
  assert.equal(saved.workflowStage, 'POSTED');
  assert.equal(new Date(saved.scheduledFor).toISOString(), when.toISOString(), 'the booked time is kept');
  assert.equal(saved.postedAt, undefined, 'a booking is not a posting');
});

test('only the handler who took it on can mark it posted', async () => {
  const reqDoc = await readyToPublish('Not yours to post');
  assert.equal((await api(tok.handler2, `/api/workflow/${reqDoc._id}/posted`, { method: 'PUT', body: {} })).status, 403);
  assert.equal((await api(tok.coordinator, `/api/workflow/${reqDoc._id}/posted`, { method: 'PUT', body: {} })).status, 403);
});

// --- handing the design in through the approvals composer -------------------

/** What the approvals composer posts when a designer hands work in from a board. */
const handInViaApprovals = (token, { workflowItem, title, org, withFile = true }) => {
  const fd = new FormData();
  fd.append('title', title);
  fd.append('type', 'DESIGN');
  fd.append('organization', org);
  if (workflowItem) fd.append('workflowItem', workflowItem);
  if (withFile) fd.append('images', new Blob([Buffer.from('art')], { type: 'image/png' }), 'design.png');
  return fetch(`${origin}/api/approvals`, {
    method: 'POST', headers: { Authorization: `Bearer ${token}` }, body: fd,
  }).then(async (r) => ({ status: r.status, body: await r.json() }));
};

test('handing the design in through the approvals form moves the item to admin review', async () => {
  const reqDoc = await raiseRequest({ title: 'Composer hand-in' });
  await api(tok.designer, `/api/workflow/${reqDoc._id}/acknowledge`, { method: 'PUT' });

  const created = await handInViaApprovals(tok.designer, {
    workflowItem: reqDoc._id, title: 'Composer hand-in', org: orgId,
  });
  assert.equal(created.status, 201);
  assert.equal(created.body.request.type, 'DESIGN');

  // The pipeline moved, and the approval is the item's design half.
  const item = await InstitutionRequest.findById(reqDoc._id).lean();
  assert.equal(item.workflowStage, 'DESIGN_ADMIN_REVIEW', 'it is with the admins now');
  assert.equal(String(item.designApproval), String(created.body.request._id));

  // The workflow detail serves it as the design, artwork and all.
  const detail = await api(tok.admin, `/api/workflow/${reqDoc._id}`);
  assert.equal(detail.body.item.design.images.length, 1);
  assert.equal(detail.body.item.can.reviewDesign, true);

  // Still one request record — the approval points at it rather than copying it.
  assert.equal(await InstitutionRequest.countDocuments({ title: 'Composer hand-in' }), 1);
});

test('a designer cannot hand work in against somebody else’s item', async () => {
  const reqDoc = await raiseRequest({ title: 'Not your hand-in' });
  await api(tok.designer, `/api/workflow/${reqDoc._id}/acknowledge`, { method: 'PUT' });

  const res = await handInViaApprovals(tok.designer2, {
    workflowItem: reqDoc._id, title: 'Not your hand-in', org: orgId,
  });
  assert.equal(res.status, 403);
  assert.equal(await stageOf(reqDoc._id), 'DESIGN_IN_PROGRESS', 'and nothing moved');
});

test('a second hand-in is refused — resubmission goes through the approval', async () => {
  const reqDoc = await raiseRequest({ title: 'One approval only' });
  await api(tok.designer, `/api/workflow/${reqDoc._id}/acknowledge`, { method: 'PUT' });
  await handInViaApprovals(tok.designer, { workflowItem: reqDoc._id, title: 'One approval only', org: orgId });
  await api(tok.admin, `/api/workflow/${reqDoc._id}/review`, {
    method: 'PUT', body: { action: 'CHANGES', feedbackPoints: [{ text: 'Redo the header' }] },
  });
  assert.equal(await stageOf(reqDoc._id), 'DESIGN_IN_PROGRESS');

  const again = await handInViaApprovals(tok.designer, {
    workflowItem: reqDoc._id, title: 'One approval only', org: orgId,
  });
  assert.equal(again.status, 409, 'a second approval would orphan the feedback');
  assert.equal(await ApprovalRequest.countDocuments({ sourceRequest: reqDoc._id }), 1);
});

test('resubmitting the approval sends the item back to the admins, keeping the history', async () => {
  const reqDoc = await raiseRequest({ title: 'Resubmit via approval' });
  await api(tok.designer, `/api/workflow/${reqDoc._id}/acknowledge`, { method: 'PUT' });
  const created = await handInViaApprovals(tok.designer, {
    workflowItem: reqDoc._id, title: 'Resubmit via approval', org: orgId,
  });
  const approvalId = created.body.request._id;

  await api(tok.admin, `/api/workflow/${reqDoc._id}/review`, {
    method: 'PUT', body: { action: 'CHANGES', feedbackPoints: [{ text: 'Bigger logo', category: 'Image' }] },
  });

  // The designer resubmits on the approval — the existing route for exactly this.
  const fd = new FormData();
  fd.append('images', new Blob([Buffer.from('art2')], { type: 'image/png' }), 'v2.png');
  const res = await fetch(`${origin}/api/approvals/${approvalId}/resubmit`, {
    method: 'PUT', headers: { Authorization: `Bearer ${tok.designer}` }, body: fd,
  });
  assert.equal(res.status, 200);

  assert.equal(await stageOf(reqDoc._id), 'DESIGN_ADMIN_REVIEW', 'the item is back with the admins');
  const approval = await ApprovalRequest.findById(approvalId).lean();
  assert.equal(approval.reviews.length, 1, 'the round of changes is still on the record');
  assert.equal(approval.reviews[0].feedbackPoints[0].text, 'Bigger logo');

  // And the whole flow still completes from here.
  await api(tok.admin, `/api/workflow/${reqDoc._id}/review`, { method: 'PUT', body: { action: 'APPROVE' } });
  const done = await api(tok.coordinator, `/api/workflow/${reqDoc._id}/confirm`, { method: 'PUT', body: { action: 'DONE', platforms: ['LinkedIn'] } });
  assert.equal(done.body.item.workflowStage, 'POST_OPEN');
});

test('an approval raised with no workflow item behind it is untouched by any of this', async () => {
  const created = await handInViaApprovals(tok.designer, { title: 'Standalone', org: orgId });
  assert.equal(created.status, 201);
  const approval = await ApprovalRequest.findById(created.body.request._id).lean();
  assert.equal(approval.sourceRequest, null, 'nothing is linked that was never asked for');
});

/** What the approvals composer posts when a handler hands post content in. */
const handInPostViaApprovals = (token, {
  workflowItem, title, org, platforms = ['LinkedIn'], caption = 'Copy', platformContent,
}) => {
  const fd = new FormData();
  fd.append('title', title);
  fd.append('type', 'POST');
  fd.append('organization', org);
  platforms.forEach((p) => fd.append('platforms', p));
  fd.append('caption', caption);
  // A post going to several pages carries a pair per page.
  if (platformContent) fd.append('platformContent', JSON.stringify(platformContent));
  if (workflowItem) fd.append('workflowItem', workflowItem);
  fd.append('images', new Blob([Buffer.from('img')], { type: 'image/png' }), 'post.png');
  return fetch(`${origin}/api/approvals`, {
    method: 'POST', headers: { Authorization: `Bearer ${token}` }, body: fd,
  }).then(async (r) => ({ status: r.status, body: await r.json() }));
};

/** Walk an item to POST_IN_PROGRESS, ready for the handler to write the copy. */
const readyForContent = async (title) => {
  const reqDoc = await readyToPost(title);
  await api(tok.handler, `/api/workflow/${reqDoc._id}/acknowledge`, { method: 'PUT' });
  return reqDoc;
};

/**
 * Every page's copy has to reach the people approving it.
 *
 * `caption`/`description` on the approval are the PRIMARY channel's pair only —
 * kept so search, reports and the posting helpers can read one caption. The admin
 * and the coordinator are signing off ALL of it, so the whole `platformContent`
 * set has to come back on the workflow item, or they approve LinkedIn's copy and
 * never see what goes out on Instagram.
 */
test('post content for several pages comes back in full, not just the primary page', async () => {
  const reqDoc = await raiseRequest({ title: 'Two pages, two voices' });
  await api(tok.designer, `/api/workflow/${reqDoc._id}/acknowledge`, { method: 'PUT' });
  await submit(tok.designer, reqDoc._id);
  await api(tok.su, `/api/workflow/${reqDoc._id}/review`, { method: 'PUT', body: { action: 'APPROVE' } });
  await api(tok.coordinator, `/api/workflow/${reqDoc._id}/confirm`, {
    method: 'PUT', body: { action: 'DONE', platforms: ['LinkedIn', 'Instagram'] },
  });
  await api(tok.handler, `/api/workflow/${reqDoc._id}/acknowledge`, { method: 'PUT' });

  const created = await handInPostViaApprovals(tok.handler, {
    workflowItem: reqDoc._id,
    title: 'Two pages, two voices',
    org: orgId,
    platforms: ['LinkedIn', 'Instagram'],
    platformContent: [
      { platform: 'LinkedIn', caption: 'A considered write-up for LinkedIn', description: 'Long form' },
      { platform: 'Instagram', caption: 'Short and punchy 🎉', description: 'Reel caption' },
    ],
  });
  assert.equal(created.status, 201);

  // The admin reviews it next, then the coordinator. Both read the same payload.
  for (const [who, token] of [['the admin', tok.su], ['the coordinator', tok.coordinator]]) {
    const detail = await api(token, `/api/workflow/${reqDoc._id}`);
    assert.equal(detail.status, 200);
    const rows = detail.body.item.post.platformContent;
    assert.ok(Array.isArray(rows), `${who} must get the per-page copy`);
    assert.deepEqual(rows.map((r) => r.platform), ['LinkedIn', 'Instagram'],
      `${who} sees every page, in the order the college chose`);
    assert.equal(rows[1].caption, 'Short and punchy 🎉', `${who} sees the Instagram copy, not only LinkedIn's`);
    // And the pages themselves, so a page with no copy against it is noticeable.
    assert.deepEqual(detail.body.item.postPlatforms, ['LinkedIn', 'Instagram']);
  }

  // The primary pair is still mirrored, so everything reading one caption works.
  const approval = await ApprovalRequest.findById((await InstitutionRequest.findById(reqDoc._id).lean()).postApproval).lean();
  assert.equal(approval.caption, 'A considered write-up for LinkedIn');
});

test('the handler hands post content in through the approvals form', async () => {
  const reqDoc = await readyForContent('Handler via approvals');

  const created = await handInPostViaApprovals(tok.handler, {
    workflowItem: reqDoc._id, title: 'Handler via approvals', org: orgId, caption: 'Welcome, first years!',
  });
  assert.equal(created.status, 201);
  assert.equal(created.body.request.type, 'POST');

  const item = await InstitutionRequest.findById(reqDoc._id).lean();
  assert.equal(item.workflowStage, 'POST_ADMIN_REVIEW', 'it goes to the admins');
  assert.equal(String(item.postApproval), String(created.body.request._id), 'linked as the post half');

  // Both halves hang off the one request; still no duplicate request record.
  assert.equal(await ApprovalRequest.countDocuments({ sourceRequest: reqDoc._id }), 2);
  assert.equal(await InstitutionRequest.countDocuments({ title: 'Handler via approvals' }), 1);

  const detail = await api(tok.admin, `/api/workflow/${reqDoc._id}`);
  assert.equal(detail.body.item.post.caption, 'Welcome, first years!');
  assert.equal(detail.body.item.can.reviewPost, true);
});

/**
 * The design travels with the post the handler writes around it.
 *
 * The approval an admin opens used to hold the caption and nothing to look at,
 * and the handler had to re-upload artwork the designer had already delivered.
 */
test('the designer’s artwork is carried onto the post approval automatically', async () => {
  const { default: ApprovalImage } = await import('../models/ApprovalImage.js');
  const reqDoc = await readyForContent('Artwork travels');

  const item = await InstitutionRequest.findById(reqDoc._id).lean();
  const designMedia = await ApprovalImage.find({ request: item.designApproval }).lean();
  assert.equal(designMedia.length, 1, 'the designer delivered one file');

  const created = await handInPostViaApprovals(tok.handler, {
    workflowItem: reqDoc._id, title: 'Artwork travels', org: orgId,
  });
  assert.equal(created.status, 201);

  const postMedia = await ApprovalImage.find({ request: created.body.request._id }).sort({ order: 1 }).lean();
  assert.equal(postMedia.length, 2, 'the design came across, plus the handler’s own upload');
  assert.equal(postMedia[0].url, designMedia[0].url, 'the artwork leads the gallery');
  assert.equal(postMedia[0].kind, 'final');

  // The copy must not own the stored file: deletion cleans up by publicId, so a
  // shared one would let removing the post erase the designer's original.
  assert.equal(postMedia[0].publicId, '', 'the carried row does not own the file');
  assert.ok(postMedia[1].publicId, 'the handler’s own upload still does');

  // The design approval keeps its media untouched.
  const after = await ApprovalImage.find({ request: item.designApproval }).lean();
  assert.equal(after.length, 1);
  assert.equal(after[0].publicId, designMedia[0].publicId);
});

test('deleting the post approval leaves the design’s artwork intact', async () => {
  const { default: ApprovalImage } = await import('../models/ApprovalImage.js');
  const reqDoc = await readyForContent('Delete is safe');
  const item = await InstitutionRequest.findById(reqDoc._id).lean();
  const created = await handInPostViaApprovals(tok.handler, {
    workflowItem: reqDoc._id, title: 'Delete is safe', org: orgId,
  });

  const gone = await fetch(`${origin}/api/approvals/${created.body.request._id}`, {
    method: 'DELETE', headers: { Authorization: `Bearer ${tok.su}` },
  });
  assert.equal(gone.status, 200);

  const designMedia = await ApprovalImage.find({ request: item.designApproval }).lean();
  assert.equal(designMedia.length, 1, 'the design still has its artwork');
});

test('the handler need not upload anything — the design is enough', async () => {
  const { default: ApprovalImage } = await import('../models/ApprovalImage.js');
  const reqDoc = await readyForContent('No upload needed');

  // No file of their own, just the copy.
  const fd = new FormData();
  fd.append('title', 'No upload needed');
  fd.append('type', 'POST');
  fd.append('organization', orgId);
  fd.append('platforms', 'LinkedIn');
  fd.append('caption', 'Just the caption');
  fd.append('workflowItem', String(reqDoc._id));
  const res = await fetch(`${origin}/api/approvals`, {
    method: 'POST', headers: { Authorization: `Bearer ${tok.handler}` }, body: fd,
  }).then(async (r) => ({ status: r.status, body: await r.json() }));
  assert.equal(res.status, 201);

  const media = await ApprovalImage.find({ request: res.body.request._id }).lean();
  assert.equal(media.length, 1, 'the design is there even though nothing was uploaded');
  assert.equal(await stageOf(reqDoc._id), 'POST_ADMIN_REVIEW');
});

test('a post with no workflow behind it carries nothing extra', async () => {
  const { default: ApprovalImage } = await import('../models/ApprovalImage.js');
  const created = await handInPostViaApprovals(tok.handler, { title: 'Standalone post', org: orgId });
  assert.equal(created.status, 201);
  const media = await ApprovalImage.find({ request: created.body.request._id }).lean();
  assert.equal(media.length, 1, 'only what was uploaded with it');
});

test('a handler cannot hand content in against somebody else’s item', async () => {
  const reqDoc = await readyForContent('Not your content');
  const res = await handInPostViaApprovals(tok.handler2, {
    workflowItem: reqDoc._id, title: 'Not your content', org: orgId,
  });
  assert.equal(res.status, 403);
  assert.equal(await stageOf(reqDoc._id), 'POST_IN_PROGRESS', 'and nothing moved');
});

test('a designer cannot hand post content in as if it were theirs', async () => {
  const reqDoc = await readyForContent('Wrong half');
  const res = await handInPostViaApprovals(tok.designer, {
    workflowItem: reqDoc._id, title: 'Wrong half', org: orgId,
  });
  assert.equal(res.status, 403, 'the posting half belongs to the handler who took it');
});

test('a second content hand-in is refused — resubmission goes through the approval', async () => {
  const reqDoc = await readyForContent('One post approval');
  await handInPostViaApprovals(tok.handler, { workflowItem: reqDoc._id, title: 'One post approval', org: orgId });
  await api(tok.admin, `/api/workflow/${reqDoc._id}/review`, {
    method: 'PUT', body: { action: 'CHANGES', feedbackPoints: [{ text: 'Shorter caption' }] },
  });
  assert.equal(await stageOf(reqDoc._id), 'POST_IN_PROGRESS');

  const again = await handInPostViaApprovals(tok.handler, {
    workflowItem: reqDoc._id, title: 'One post approval', org: orgId,
  });
  assert.equal(again.status, 409);
  assert.equal(await ApprovalRequest.countDocuments({ sourceRequest: reqDoc._id }), 2, 'design + one post, no more');
});

test('the whole post half runs through the approvals form, end to end', async () => {
  const reqDoc = await readyForContent('Post half via approvals');
  const created = await handInPostViaApprovals(tok.handler, {
    workflowItem: reqDoc._id, title: 'Post half via approvals', org: orgId,
  });
  const approvalId = created.body.request._id;

  // Admin decides on the Approvals page; the workflow follows.
  await decideOnApproval(tok.su, approvalId, 'CHANGES', [{ text: 'Add the hashtag', category: 'Content' }]);
  assert.equal(await stageOf(reqDoc._id), 'POST_IN_PROGRESS');

  const fd = new FormData();
  fd.append('caption', 'Welcome! #firstyear');
  await fetch(`${origin}/api/approvals/${approvalId}/resubmit`, {
    method: 'PUT', headers: { Authorization: `Bearer ${tok.handler}` }, body: fd,
  });
  assert.equal(await stageOf(reqDoc._id), 'POST_ADMIN_REVIEW', 'resubmitting returns it to the admins');

  await decideOnApproval(tok.su, approvalId, 'APPROVE');
  assert.equal(await stageOf(reqDoc._id), 'POST_COORDINATOR_REVIEW');
  await api(tok.coordinator, `/api/workflow/${reqDoc._id}/confirm`, { method: 'PUT', body: { action: 'DONE' } });
  assert.equal(await stageOf(reqDoc._id), 'POST_APPROVED');
  await api(tok.handler, `/api/workflow/${reqDoc._id}/posted`, { method: 'PUT', body: {} });
  assert.equal(await stageOf(reqDoc._id), 'POSTED');
});

/**
 * Deciding from the Approvals page must move the workflow too.
 *
 * The designer hands in through the approvals composer, so the admin's natural
 * next click is Approve on the Approvals page — not the workflow board. That path
 * used to flip the approval to APPROVED and leave the request at admin review, so
 * the work looked signed off and the coordinator was never asked.
 */
const decideOnApproval = (token, approvalId, action, feedbackPoints) => fetch(
  `${origin}/api/approvals/${approvalId}/${action === 'APPROVE' ? 'approve' : 'reject'}`,
  {
    method: 'PUT',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(action === 'APPROVE' ? {} : { feedbackPoints }),
  }
).then(async (r) => ({ status: r.status, body: await r.json() }));

test('approving on the Approvals page hands the work to the coordinator', async () => {
  const reqDoc = await raiseRequest({ title: 'Approved from approvals' });
  await api(tok.designer, `/api/workflow/${reqDoc._id}/acknowledge`, { method: 'PUT' });
  const created = await handInViaApprovals(tok.designer, {
    workflowItem: reqDoc._id, title: 'Approved from approvals', org: orgId,
  });
  const approvalId = created.body.request._id;
  assert.equal(await stageOf(reqDoc._id), 'DESIGN_ADMIN_REVIEW');

  const ok = await decideOnApproval(tok.su, approvalId, 'APPROVE');
  assert.equal(ok.status, 200);
  assert.equal(await stageOf(reqDoc._id), 'DESIGN_COORDINATOR_REVIEW', 'the coordinator is asked');

  // And the coordinator can finish it from there, pages and all.
  const done = await api(tok.coordinator, `/api/workflow/${reqDoc._id}/confirm`, {
    method: 'PUT', body: { action: 'DONE', platforms: ['LinkedIn'] },
  });
  assert.equal(done.status, 200);
  assert.equal(done.body.item.workflowStage, 'POST_OPEN');
});

test('requesting changes on the Approvals page sends it back to the designer', async () => {
  const reqDoc = await raiseRequest({ title: 'Changes from approvals' });
  await api(tok.designer, `/api/workflow/${reqDoc._id}/acknowledge`, { method: 'PUT' });
  const created = await handInViaApprovals(tok.designer, {
    workflowItem: reqDoc._id, title: 'Changes from approvals', org: orgId,
  });
  const approvalId = created.body.request._id;

  const back = await decideOnApproval(tok.su, approvalId, 'CHANGES', [{ text: 'Fix the crest', category: 'Image' }]);
  assert.equal(back.status, 200);
  assert.equal(await stageOf(reqDoc._id), 'DESIGN_IN_PROGRESS', 'it returns to the designer');

  // The note is on the record once, not twice.
  const approval = await ApprovalRequest.findById(approvalId).lean();
  assert.equal(approval.reviews.length, 1);
  const feedback = await ApprovalComment.find({ request: approvalId, kind: 'feedback' }).lean();
  assert.equal(feedback.length, 1, 'the feedback must not be recorded twice');
  assert.equal(feedback[0].text, 'Fix the crest');
});

test('routing workflow work from the Approvals page is refused', async () => {
  const reqDoc = await raiseRequest({ title: 'No routing from approvals' });
  await api(tok.designer, `/api/workflow/${reqDoc._id}/acknowledge`, { method: 'PUT' });
  const created = await handInViaApprovals(tok.designer, {
    workflowItem: reqDoc._id, title: 'No routing from approvals', org: orgId,
  });

  const routed = await fetch(`${origin}/api/approvals/${created.body.request._id}/approve`, {
    method: 'PUT',
    headers: { Authorization: `Bearer ${tok.su}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ routeTo: 'DESIGNER' }),
  }).then(async (r) => ({ status: r.status, body: await r.json() }));
  assert.equal(routed.status, 409, 'the coordinator decides where workflow work goes');
  assert.match(routed.body.message, /workflow work/i);
  assert.equal(await stageOf(reqDoc._id), 'DESIGN_ADMIN_REVIEW', 'and the refusal changes nothing');
});

test('the approval says it belongs to a workflow, and who is waiting', async () => {
  const reqDoc = await raiseRequest({ title: 'Knows its workflow' });
  await api(tok.designer, `/api/workflow/${reqDoc._id}/acknowledge`, { method: 'PUT' });
  const created = await handInViaApprovals(tok.designer, {
    workflowItem: reqDoc._id, title: 'Knows its workflow', org: orgId,
  });

  const detail = await fetch(`${origin}/api/approvals/${created.body.request._id}`, {
    headers: { Authorization: `Bearer ${tok.su}` },
  }).then(async (r) => (await r.json()));
  assert.equal(detail.request.workflow.half, 'DESIGN');
  assert.equal(detail.request.workflow.stage, 'DESIGN_ADMIN_REVIEW');
  assert.equal(detail.request.workflow.coordinatorName, 'Coco', 'so the popup can name them');
  assert.equal(String(detail.request.workflow.item), String(reqDoc._id));
});

test('an ordinary approval reports no workflow, and still routes as before', async () => {
  const created = await handInViaApprovals(tok.designer, { title: 'Ordinary approval', org: orgId });
  const detail = await fetch(`${origin}/api/approvals/${created.body.request._id}`, {
    headers: { Authorization: `Bearer ${tok.su}` },
  }).then(async (r) => (await r.json()));
  assert.equal(detail.request.workflow, null);

  // Routing still works for approvals that are not workflow halves.
  const routed = await fetch(`${origin}/api/approvals/${created.body.request._id}/approve`, {
    method: 'PUT',
    headers: { Authorization: `Bearer ${tok.su}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ routeTo: 'DESIGNER' }),
  });
  assert.equal(routed.status, 200, 'the old pipeline is untouched');
});

// --- My Assigned Work -------------------------------------------------------

/**
 * Acknowledging puts the work on the person's own list.
 *
 * `?mine=1` is what My Assigned Work reads. It is the same request record the
 * board shows — nothing is copied into a second row — so the two can never drift.
 */
test('acknowledged work lands on the designer’s own list, and nobody else’s', async () => {
  const reqDoc = await raiseRequest({ title: 'Mine to design' });

  const before = await api(tok.designer, '/api/workflow?mine=1');
  assert.equal(before.status, 200);
  assert.ok(!before.body.items.some((i) => i._id === reqDoc._id), 'unclaimed work is on nobody’s list');

  await api(tok.designer, `/api/workflow/${reqDoc._id}/acknowledge`, { method: 'PUT' });

  const mine = await api(tok.designer, '/api/workflow?mine=1');
  const row = mine.body.items.find((i) => i._id === reqDoc._id);
  assert.ok(row, 'it is on their list the moment they acknowledge it');
  assert.equal(row.myRole, 'DESIGNER', 'and says which half is theirs');
  assert.equal(row.title, 'Mine to design');

  const other = await api(tok.designer2, '/api/workflow?mine=1');
  assert.ok(!other.body.items.some((i) => i._id === reqDoc._id), 'it is not on another designer’s list');
});

test('a handler’s acknowledged post lands on their list too', async () => {
  const reqDoc = await readyToPost('Mine to post');
  await api(tok.handler, `/api/workflow/${reqDoc._id}/acknowledge`, { method: 'PUT' });

  const mine = await api(tok.handler, '/api/workflow?mine=1');
  const row = mine.body.items.find((i) => i._id === reqDoc._id);
  assert.ok(row);
  assert.equal(row.myRole, 'SOCIAL_HANDLER');
});

/**
 * Work somebody else has taken on leaves your list.
 *
 * The designer's half is finished and confirmed by the time a handler picks the
 * posting up, so from that moment it is the handler's work and not theirs.
 */
test('once a handler takes the post, it leaves the designer’s list', async () => {
  const reqDoc = await readyToPost('Handed over');

  const before = await api(tok.designer, '/api/workflow?mine=1');
  assert.ok(before.body.items.some((i) => i._id === reqDoc._id),
    'while it is still waiting for a handler it is on the designer’s list');

  await api(tok.handler, `/api/workflow/${reqDoc._id}/acknowledge`, { method: 'PUT' });

  const after = await api(tok.designer, '/api/workflow?mine=1');
  assert.ok(!after.body.items.some((i) => i._id === reqDoc._id),
    'once the handler owns it, it is off the designer’s list');

  // And it is on the handler's, so it has not simply vanished.
  const theirs = await api(tok.handler, '/api/workflow?mine=1');
  assert.ok(theirs.body.items.some((i) => i._id === reqDoc._id));
});

test('a designer who never got the work never sees it, whoever holds it', async () => {
  const reqDoc = await raiseRequest({ title: 'Taken by Dee' });
  await api(tok.designer, `/api/workflow/${reqDoc._id}/acknowledge`, { method: 'PUT' });

  for (const [who, token] of [['the other designer', tok.designer2], ['a handler', tok.handler]]) {
    const list = await api(token, '/api/workflow?mine=1');
    assert.ok(!list.body.items.some((i) => i._id === reqDoc._id),
      `${who} must not have it on their list`);
  }
});

test('work stays on the list through every stage, and after it is posted', async () => {
  const reqDoc = await raiseRequest({ title: 'Stays listed' });
  await api(tok.designer, `/api/workflow/${reqDoc._id}/acknowledge`, { method: 'PUT' });

  const onList = async () => {
    const r = await api(tok.designer, '/api/workflow?mine=1');
    return r.body.items.find((i) => i._id === reqDoc._id)?.workflowStage || null;
  };

  assert.equal(await onList(), 'DESIGN_IN_PROGRESS');
  await submit(tok.designer, reqDoc._id);
  assert.equal(await onList(), 'DESIGN_ADMIN_REVIEW', 'still listed while the admin holds it');
  await api(tok.admin, `/api/workflow/${reqDoc._id}/review`, { method: 'PUT', body: { action: 'APPROVE' } });
  assert.equal(await onList(), 'DESIGN_COORDINATOR_REVIEW');
  await api(tok.coordinator, `/api/workflow/${reqDoc._id}/confirm`, { method: 'PUT', body: { action: 'DONE', platforms: ['LinkedIn'] } });
  assert.equal(await onList(), 'POST_OPEN', 'and once the design is confirmed');
});

test('a cancelled request drops off the list', async () => {
  const reqDoc = await raiseRequest({ title: 'Cancelled work' });
  await api(tok.designer, `/api/workflow/${reqDoc._id}/acknowledge`, { method: 'PUT' });
  await InstitutionRequest.findByIdAndUpdate(reqDoc._id, { workflowStage: 'CANCELLED' });

  const mine = await api(tok.designer, '/api/workflow?mine=1');
  assert.ok(!mine.body.items.some((i) => i._id === reqDoc._id));
});

// --- the whole chain, end to end --------------------------------------------

test('the complete flow: request → design → admin → coordinator → post → admin → coordinator → posted', async () => {
  const reqDoc = await raiseRequest({ title: 'End to end' });
  const seen = [];
  const step = async (fn) => { await fn(); seen.push(await stageOf(reqDoc._id)); };

  await step(() => api(tok.designer, `/api/workflow/${reqDoc._id}/acknowledge`, { method: 'PUT' }));
  await step(() => submit(tok.designer, reqDoc._id));
  await step(() => api(tok.admin, `/api/workflow/${reqDoc._id}/review`, {
    method: 'PUT', body: { action: 'CHANGES', feedbackPoints: [{ text: 'Tighten the crop' }] },
  }));
  await step(() => submit(tok.designer, reqDoc._id));
  await step(() => api(tok.admin, `/api/workflow/${reqDoc._id}/review`, { method: 'PUT', body: { action: 'APPROVE' } }));
  await step(() => api(tok.coordinator, `/api/workflow/${reqDoc._id}/confirm`, {
    method: 'PUT', body: { action: 'CHANGES', feedbackPoints: [{ text: 'Swap the photo' }] },
  }));
  await step(() => submit(tok.designer, reqDoc._id));
  await step(() => api(tok.admin, `/api/workflow/${reqDoc._id}/review`, { method: 'PUT', body: { action: 'APPROVE' } }));
  await step(() => api(tok.coordinator, `/api/workflow/${reqDoc._id}/confirm`, { method: 'PUT', body: { action: 'DONE', platforms: ['LinkedIn'] } }));
  await step(() => api(tok.handler, `/api/workflow/${reqDoc._id}/acknowledge`, { method: 'PUT' }));
  await step(() => submit(tok.handler, reqDoc._id, { withFile: false, caption: 'Draft' }));
  await step(() => api(tok.admin, `/api/workflow/${reqDoc._id}/review`, { method: 'PUT', body: { action: 'APPROVE' } }));
  await step(() => api(tok.coordinator, `/api/workflow/${reqDoc._id}/confirm`, { method: 'PUT', body: { action: 'DONE', platforms: ['LinkedIn'] } }));
  await step(() => api(tok.handler, `/api/workflow/${reqDoc._id}/posted`, { method: 'PUT', body: {} }));

  assert.deepEqual(seen, [
    'DESIGN_IN_PROGRESS',
    'DESIGN_ADMIN_REVIEW',
    'DESIGN_IN_PROGRESS',
    'DESIGN_ADMIN_REVIEW',
    'DESIGN_COORDINATOR_REVIEW',
    'DESIGN_IN_PROGRESS',
    'DESIGN_ADMIN_REVIEW',
    'DESIGN_COORDINATOR_REVIEW',
    'POST_OPEN',
    'POST_IN_PROGRESS',
    'POST_ADMIN_REVIEW',
    'POST_COORDINATOR_REVIEW',
    'POST_APPROVED',
    'POSTED',
  ]);

  // One request, two approvals, nothing duplicated.
  assert.equal(await InstitutionRequest.countDocuments({ title: 'End to end' }), 1);
  assert.equal(await ApprovalRequest.countDocuments({ sourceRequest: reqDoc._id }), 2);
});

/**
 * Every step is stamped, and the stamps are in the order the work happened.
 *
 * "How long did this take, and who was holding it?" has to be answerable from the
 * request alone — not by reading two approvals and their comment threads.
 */
test('every step records when it happened, and who did it', async () => {
  const raised = await raiseRequest({ title: 'Stamped end to end' });

  await api(tok.designer, `/api/workflow/${raised._id}/acknowledge`, { method: 'PUT' });
  await submit(tok.designer, raised._id);
  // A changes round, so the design stamp must end up as the FINAL hand-in.
  await api(tok.admin, `/api/workflow/${raised._id}/review`, {
    method: 'PUT', body: { action: 'CHANGES', feedbackPoints: [{ text: 'Tighten the crop' }] },
  });
  const firstTry = (await InstitutionRequest.findById(raised._id).lean()).designSubmittedAt;
  assert.ok(firstTry, 'the first hand-in is stamped');

  await submit(tok.designer, raised._id);
  await api(tok.admin, `/api/workflow/${raised._id}/review`, { method: 'PUT', body: { action: 'APPROVE' } });
  await api(tok.coordinator, `/api/workflow/${raised._id}/confirm`, {
    method: 'PUT', body: { action: 'DONE', platforms: ['LinkedIn'] },
  });
  await api(tok.handler, `/api/workflow/${raised._id}/acknowledge`, { method: 'PUT' });
  await submit(tok.handler, raised._id, { withFile: false, caption: 'Draft' });
  await api(tok.admin, `/api/workflow/${raised._id}/review`, { method: 'PUT', body: { action: 'APPROVE' } });
  await api(tok.coordinator, `/api/workflow/${raised._id}/confirm`, { method: 'PUT', body: { action: 'DONE' } });
  await api(tok.handler, `/api/workflow/${raised._id}/posted`, { method: 'PUT', body: {} });

  const detail = await api(tok.coordinator, `/api/workflow/${raised._id}`);
  const it = detail.body.item;

  // Every step of the trail carries a moment.
  const trail = [
    'createdAt', 'designerAcknowledgedAt', 'designSubmittedAt', 'designApprovedAt', 'designAcceptedAt',
    'handlerAcknowledgedAt', 'postSubmittedAt', 'postApprovedAt', 'postAcceptedAt', 'postedAt',
  ];
  for (const field of trail) assert.ok(it[field], `${field} must be recorded`);

  // And they run forwards — the pipeline order is the clock order.
  const times = trail.map((f) => new Date(it[f]).getTime());
  for (let i = 1; i < times.length; i++) {
    assert.ok(times[i] >= times[i - 1], `${trail[i]} cannot precede ${trail[i - 1]}`);
  }

  // The resubmission moved the stamp on: it reads as when the work was finished,
  // not when it was first attempted.
  assert.ok(new Date(it.designSubmittedAt).getTime() > new Date(firstTry).getTime(),
    'the design stamp follows the latest hand-in');

  // Who, not just when — and the admins' sign-off is not the college's acceptance.
  assert.equal(it.designApprovedBy?.name, 'Ada', 'the admin who signed the design off');
  assert.equal(it.postApprovedBy?.name, 'Ada', 'and the content');
  assert.equal(it.designAcceptedBy?.name, 'Coco', 'the coordinator who accepted it');
  assert.ok(new Date(it.designAcceptedAt) >= new Date(it.designApprovedAt),
    'the college confirms after the admins, so the two gates stay distinguishable');
});

// Nobody stands between the college and the designers, which cuts both ways:
// there is no approval to wait for, and no decision that could pull the work
// back off the board. The Admin and the super admin read requests, nothing more.
test('a request cannot be approved or declined by anyone, super admin included', async () => {
  const reqDoc = await raiseRequest({ title: 'Straight through' });
  assert.equal(await stageOf(reqDoc._id), 'DESIGN_OPEN');

  for (const action of ['approve', 'decline', 'review']) {
    const res = await api(tok.su, `/api/requests/${reqDoc._id}/respond`, {
      method: 'PUT', body: { action, response: 'No budget this term' },
    });
    assert.equal(res.status, 404, `there is no ${action} to make`);
  }
  assert.equal(await stageOf(reqDoc._id), 'DESIGN_OPEN', 'so it stays with the designers');
});

/**
 * The college picker carries each college's own channels.
 *
 * A form asking "which platforms?" reads this, so a college with no presence on a
 * channel must not offer it — a post raised for a platform the college does not
 * run leaves the handler with nowhere to publish it.
 */
test('the organization picker reports each college’s own channels', async () => {
  const { default: SocialAccount } = await import('../models/SocialAccount.js');
  const { default: Organization } = await import('../models/Organization.js');
  await SocialAccount.deleteMany({});

  const lean = await Organization.create({ name: 'One Channel College', slug: 'one-channel' });
  const none = await Organization.create({ name: 'No Channels College', slug: 'no-channels' });
  await SocialAccount.create([
    { organization: orgId, platform: 'LinkedIn' },
    { organization: orgId, platform: 'Facebook' },
    { organization: lean._id, platform: 'Instagram' },
  ]);
  // A handler's mapping is one of the three sources, so every handler has to be
  // cleared for this to be a test of the accounts register — not just the one
  // this suite happens to have seeded.
  await User.updateMany({ userType: USER_TYPES.SOCIAL_HANDLER }, { handles: [] });
  await Organization.findByIdAndUpdate(orgId, { youtubeChannelId: '' });

  const res = await api(tok.coordinator, '/api/organizations/options');
  assert.equal(res.status, 200);
  const byName = Object.fromEntries(res.body.organizations.map((o) => [o.name, o.platforms]));

  assert.deepEqual(byName['Test College'], ['LinkedIn', 'Facebook'], 'in the platform list’s own order');
  assert.deepEqual(byName['One Channel College'], ['Instagram'], 'one channel means one option');
  // Nothing on record anywhere is "we do not know", not "they have none" — the
  // alternative is a college no post can ever be raised for.
  assert.deepEqual(byName['No Channels College'].length > 1, true,
    'a college with nothing on record falls back to the standard set');

  await SocialAccount.deleteMany({});
  await Organization.deleteMany({ _id: { $in: [lean._id, none._id] } });
});
