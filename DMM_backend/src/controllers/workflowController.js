import mongoose from 'mongoose';
import asyncHandler from 'express-async-handler';
import InstitutionRequest, { DESIGN_STAGES, POST_STAGES } from '../models/InstitutionRequest.js';
import ApprovalRequest from '../models/ApprovalRequest.js';
import ApprovalImage from '../models/ApprovalImage.js';
import ApprovalComment from '../models/ApprovalComment.js';
import User from '../models/User.js';
import { uploadBuffer } from '../config/storage.js';
import { createNotification } from '../utils/notify.js';
import { logActivity } from '../utils/logActivity.js';
import { resolvePostedAt } from '../utils/postedAt.js';
import { canAccessOrg, accessibleOrgIds } from '../utils/org.js';
import { platformsForOrganization } from '../utils/platforms.js';
import {
  ROLES, USER_TYPES, APPROVAL_STATUS, APPROVAL_TYPES,
  ACTIVITY_ACTIONS, NOTIFICATION_TYPES, FEEDBACK_CATEGORIES,
  SOCIAL_POST_WORK_CATEGORIES, SOCIAL_POST_WORK_ITEMS,
} from '../config/constants.js';

/**
 * The design → post pipeline that a college's ask travels through.
 *
 * The ask itself (InstitutionRequest) is the spine: it is never copied, and its
 * `workflowStage` is the single answer to "where is this?". The artwork and the
 * post written around it are ordinary ApprovalRequests hanging off it, so the
 * media, the feedback rounds and the resubmissions all reuse machinery that
 * already exists rather than a second approval system.
 *
 * Two boards read off the same records:
 *   Designs to be Done — designers + admins, DESIGN_* stages
 *   To Be Posted       — social handlers + admins, POST_* / POSTED stages
 */

const idOf = (v) => String(v?._id || v || '');
const isDesigner = (u) => u?.role === ROLES.USER && u?.userType === USER_TYPES.DESIGNER;
const isHandler = (u) => u?.role === ROLES.USER && u?.userType === USER_TYPES.SOCIAL_HANDLER;
const isAdministrator = (u) => u?.role === ROLES.ADMIN || u?.role === ROLES.CEO;
/**
 * Does this ask carry on to a social post once the design is accepted?
 *
 * Only social media work does. Print has nothing to publish, and plenty of
 * digital work has nowhere to publish it either — an LED screen design, a website
 * slider, an email banner. Those finish at the coordinator's acceptance like
 * print does, so they never ask the college for pages and never raise posting
 * work for a handler.
 */
const needsPosting = (reqDoc) => reqDoc.workType === 'DIGITAL_MEDIA'
  && (SOCIAL_POST_WORK_CATEGORIES.includes(reqDoc.workCategory)
    || SOCIAL_POST_WORK_ITEMS.includes(reqDoc.workItem));

const populateRequest = (q) => q
  .populate('organization', 'name color')
  .populate('raisedBy', 'name avatar email userType')
  .populate('designer', 'name avatar email')
  .populate('handler', 'name avatar email')
  // Also who cancelled it, if it was — the only other thing this field is set
  // for now that nobody actually reviews a request any more (see cancelWorkflowItem).
  .populate('reviewedBy', 'name avatar')
  .populate('designAcceptedBy', 'name avatar')
  .populate('postAcceptedBy', 'name avatar')
  // Who signed each half off, so the trail names the admin rather than just the time.
  .populate('designApprovedBy', 'name avatar')
  .populate('postApprovedBy', 'name avatar');

// The channels this college runs, for the coordinator to choose from — resolved
// by the shared helper so the workflow board, the approval form and the college
// picker can never disagree about what a college has.
const availablePlatformsFor = (organizationId) => platformsForOrganization(organizationId);

/**
 * The pages a handler runs for one college, from their `handles` mapping.
 * A handler may cover several colleges, and different pages in each.
 */
const pagesHandledFor = (user, organizationId) => (Array.isArray(user?.handles) ? user.handles : [])
  .filter((h) => idOf(h.organization) === idOf(organizationId))
  .flatMap((h) => h.platforms || []);

/**
 * Does this handler run any of the pages the coordinator chose for this item?
 *
 * The coordinator names the pages when they accept the design, so posting work
 * belongs to whoever actually runs those pages — not to every handler on the
 * platform. An item with no pages recorded (raised before the coordinator was
 * asked) stays open to any handler for that college rather than becoming
 * unclaimable.
 */
const handlesPagesFor = (user, item) => {
  const mine = pagesHandledFor(user, item.organization);
  if (!mine.length) return false;
  const wanted = item.postPlatforms || [];
  return wanted.length ? wanted.some((p) => mine.includes(p)) : true;
};

/**
 * Mongo scope for "posting work on the pages I run".
 *
 * One clause per college the handler covers, because the pages differ per
 * college: a handler on NCET/Instagram must not be shown NGI/Instagram work.
 * Anything they already hold stays visible whatever their mapping says now —
 * losing sight of work in your own hands because an admin edited your pages
 * would be worse than showing one extra row.
 */
const postBoardScopeFor = (user) => {
  const byOrg = new Map();
  for (const h of Array.isArray(user.handles) ? user.handles : []) {
    const org = idOf(h.organization);
    if (!org) continue;
    const list = byOrg.get(org) || new Set();
    (h.platforms || []).forEach((p) => list.add(p));
    byOrg.set(org, list);
  }
  const clauses = [...byOrg.entries()].map(([org, pages]) => ({
    organization: new mongoose.Types.ObjectId(org),
    // Items with no pages recorded predate the coordinator's choice — leave them
    // visible to the college's handlers instead of stranding them.
    $or: [{ postPlatforms: { $in: [...pages] } }, { postPlatforms: { $size: 0 } }],
  }));
  return [...clauses, { handler: user._id }];
};

/** Colleges this caller may see workflow items for. `null` means every one. */
const scopeToOrgs = (user) => {
  const allowed = accessibleOrgIds(user);
  return allowed === null ? null : allowed;
};

/**
 * Load one item and prove the caller is allowed near it.
 *
 * Designers and handlers work across the shared workspace, so they are not
 * clamped to a single college — the boards are open pools by design. Admins get
 * the colleges they hold; the coordinator gets the asks they raised.
 */
const loadItem = async (req, res, { populate = true } = {}) => {
  if (!mongoose.isValidObjectId(req.params.id)) { res.status(400); throw new Error('Invalid workflow item'); }
  const query = InstitutionRequest.findById(req.params.id);
  const item = await (populate ? populateRequest(query) : query);
  if (!item) { res.status(404); throw new Error('Workflow item not found'); }

  const orgId = idOf(item.organization);
  const me = String(req.user._id);
  const mine = idOf(item.raisedBy) === me || idOf(item.designer) === me || idOf(item.handler) === me;
  if (isAdministrator(req.user)) {
    if (!canAccessOrg(req.user, orgId)) { res.status(404); throw new Error('Workflow item not found'); }
  } else if (!mine && !isDesigner(req.user) && !isHandler(req.user)) {
    res.status(403); throw new Error('This is not yours to work on');
  }
  return item;
};

/** The approval that carries the current half of the work. */
const approvalIdFor = (item, half) => (half === 'POST' ? item.postApproval : item.designApproval);

const attachMedia = async (approvalId) => {
  if (!approvalId) return { images: [], comments: [] };
  const [images, comments] = await Promise.all([
    ApprovalImage.find({ request: approvalId }).sort({ order: 1 }).lean(),
    ApprovalComment.find({ request: approvalId }).populate('author', 'name avatar').sort({ createdAt: 1, _id: 1 }).lean(),
  ]);
  return { images, comments };
};

const notifyAdmins = async (item, { type, title, message }) => {
  const orgId = idOf(item.organization);
  const admins = await User.find({
    isActive: true,
    $or: [
      { isSuperAdmin: true },
      { role: ROLES.CEO, $or: [{ organization: orgId }, { managedOrganizations: orgId }] },
    ],
  }).select('_id');
  const seen = new Set();
  await Promise.all(admins
    .filter((u) => { const k = String(u._id); if (seen.has(k)) return false; seen.add(k); return true; })
    .map((u) => createNotification({
      recipient: u._id, organization: orgId, type, title, message,
      link: `/workflow/${item._id}`, relatedRequest: item._id,
    })));
};

const notifyUser = (recipient, item, { type, title, message }) => {
  if (!recipient) return Promise.resolve();
  return createNotification({
    recipient, organization: idOf(item.organization), type, title, message,
    link: `/workflow/${item._id}`, relatedRequest: item._id,
  });
};

/** Normalize the changes an admin or coordinator asked for into feedback points. */
const readFeedback = (raw, res) => {
  const points = (Array.isArray(raw) ? raw : [raw])
    .map((p) => {
      const text = String(typeof p === 'string' ? p : p?.text || '').trim();
      const category = FEEDBACK_CATEGORIES.includes(p?.category) ? p.category : 'Other';
      return { text, category };
    })
    .filter((p) => p.text);
  if (!points.length) { res.status(400); throw new Error('Say what needs changing'); }
  return points;
};

/**
 * Record a round of requested changes on the approval that carries this half.
 *
 * Reuses the existing history wholesale: a review round on the approval, an event
 * row, and one feedback row per point. Nothing is overwritten — every round the
 * work has been through stays readable, which is what the designer needs to see
 * and what the admins audit.
 */
const recordChanges = async (approvalId, actor, points) => {
  if (!approvalId) return;
  const approval = await ApprovalRequest.findById(approvalId);
  if (!approval) return;
  const reviewRound = approval.reviews.length + 1;
  approval.reviews.push({ reviewedBy: actor._id, feedbackPoints: points });
  approval.status = APPROVAL_STATUS.REJECTED;
  approval.rejectedAt = new Date();
  await approval.save();
  await ApprovalComment.insertMany([
    { request: approvalId, kind: 'event', author: actor._id, text: 'requested changes', reviewRound },
    ...points.map((p) => ({
      request: approvalId, kind: 'feedback', author: actor._id,
      text: p.text, category: p.category, reviewRound,
    })),
  ]);
};

/**
 * Move a workflow item to admin review because its work was handed in elsewhere.
 *
 * The designer hands their artwork in through the approvals composer — the form
 * that already exists for a designer submitting finished work — so the approval is
 * created there. This is the other half of that: the pipeline has to advance, or
 * the item would sit in DESIGN_IN_PROGRESS with a submitted design nobody is
 * waiting on.
 *
 * Exported so approvalController can call it after it creates or resubmits the
 * approval. Best-effort on notifications, never on the stage: the stage is the
 * whole point.
 */
export const advanceWorkflowForApproval = async ({ approvalId, actor, linkAs }) => {
  const approval = await ApprovalRequest.findById(approvalId).select('sourceRequest title');
  if (!approval?.sourceRequest) return null;
  const item = await InstitutionRequest.findById(approval.sourceRequest);
  if (!item) return null;

  // `linkAs` is only supplied on a first hand-in, where the approval is not yet
  // attached to the item. A resubmission is already attached and must stay so —
  // relinking would orphan the feedback rounds recorded against it.
  if (linkAs === 'DESIGN' && !item.designApproval) item.designApproval = approvalId;
  if (linkAs === 'POST' && !item.postApproval) item.postApproval = approvalId;

  const isDesignHalf = String(item.designApproval) === String(approvalId);
  const isPostHalf = String(item.postApproval) === String(approvalId);
  if (!isDesignHalf && !isPostHalf) return null;

  // Only work actually sitting with its maker moves; anything else is already
  // further along and must not be dragged backwards.
  const expected = isDesignHalf ? 'DESIGN_IN_PROGRESS' : 'POST_IN_PROGRESS';
  if (item.workflowStage !== expected) {
    if (linkAs) await item.save();
    return item;
  }

  item.workflowStage = isDesignHalf ? 'DESIGN_ADMIN_REVIEW' : 'POST_ADMIN_REVIEW';
  await item.save();

  try {
    await logActivity({
      user: actor._id, organization: idOf(item.organization),
      action: isDesignHalf ? ACTIVITY_ACTIONS.DESIGN_SUBMITTED : ACTIVITY_ACTIONS.APPROVAL_SUBMISSION,
      description: `Sent ${isDesignHalf ? 'design' : 'post content'} for approval: "${item.title}"`,
      entityType: 'InstitutionRequest', entityId: item._id,
    });
    await notifyAdmins(item, {
      type: isDesignHalf ? NOTIFICATION_TYPES.DESIGN_SUBMITTED : NOTIFICATION_TYPES.NEW_REQUEST,
      title: isDesignHalf ? 'Design ready for approval' : 'Post content ready for approval',
      message: `${actor.name} sent "${item.title}" for approval`,
    });
  } catch (err) {
    console.error('failed to announce a workflow hand-in:', err.message);
  }
  return item;
};

/**
 * Which workflow item an approval is a half of, if any.
 *
 * Exported so the approvals pages can tell a workflow submission apart from an
 * ordinary approval: the two are decided differently, and offering the wrong
 * controls is how work ends up stranded.
 */
export const workflowHalfForApproval = async (approvalId) => {
  if (!approvalId || !mongoose.isValidObjectId(approvalId)) return null;
  const approval = await ApprovalRequest.findById(approvalId).select('sourceRequest');
  if (!approval?.sourceRequest) return null;
  const item = await InstitutionRequest.findById(approval.sourceRequest)
    .select('title workflowStage designApproval postApproval raisedBy organization designer handler')
    .populate('raisedBy', 'name');
  if (!item) return null;
  const half = String(item.designApproval) === String(approvalId) ? 'DESIGN'
    : String(item.postApproval) === String(approvalId) ? 'POST' : null;
  if (!half) return null;
  return { item, half };
};

/**
 * Carry an admin's decision on the approval through to the workflow item.
 *
 * A designer hands their work in through the approvals composer, so the approval
 * is also where an admin naturally decides on it — from the Approvals page rather
 * than the workflow board. Without this the approval flipped to APPROVED while the
 * request stayed at admin review, and the coordinator was never asked: the work
 * looked signed off and went nowhere.
 *
 * Feedback is NOT recorded here. The caller (rejectRequest) already pushes the
 * review round onto the approval, and doing it twice would double every note.
 */
export const advanceWorkflowOnDecision = async ({ approvalId, actor, decision }) => {
  try {
    const found = await workflowHalfForApproval(approvalId);
    if (!found) return null;
    const { item, half } = found;
    const expected = half === 'DESIGN' ? 'DESIGN_ADMIN_REVIEW' : 'POST_ADMIN_REVIEW';
    if (item.workflowStage !== expected) return item; // already moved on; leave it alone

    const worker = half === 'DESIGN' ? item.designer : item.handler;
    if (decision === 'APPROVE') {
      item.workflowStage = half === 'DESIGN' ? 'DESIGN_COORDINATOR_REVIEW' : 'POST_COORDINATOR_REVIEW';
      await item.save();
      await notifyUser(item.raisedBy?._id || item.raisedBy, item, {
        type: NOTIFICATION_TYPES.CONTENT_APPROVED,
        title: half === 'DESIGN' ? 'Your design is ready to check' : 'Your post content is ready to check',
        message: `"${item.title}" was approved by ${actor.name} — confirm it or ask for changes`,
      });
      await notifyUser(worker, item, {
        type: NOTIFICATION_TYPES.CONTENT_APPROVED,
        title: 'Approved by the Admin',
        message: `"${item.title}" passed review and is with the coordinator now`,
      });
    } else {
      item.workflowStage = half === 'DESIGN' ? 'DESIGN_IN_PROGRESS' : 'POST_IN_PROGRESS';
      await item.save();
      await notifyUser(worker, item, {
        type: NOTIFICATION_TYPES.CONTENT_REJECTED,
        title: 'Changes requested',
        message: `${actor.name} asked for changes on "${item.title}"`,
      });
    }
    return item;
  } catch (err) {
    console.error('failed to carry an approval decision into the workflow:', err.message);
    return null;
  }
};

/**
 * Whether this person may hand work in against this item, and as which half.
 * Exported for the approvals composer, which has to refuse a stranger before it
 * creates anything.
 */
export const workflowHandInRole = async (itemId, user) => {
  if (!mongoose.isValidObjectId(itemId)) return null;
  const item = await InstitutionRequest.findById(itemId)
    .select('designer handler workflowStage designApproval postApproval title organization details workCategory workItem neededBy');
  if (!item) return null;
  const me = String(user._id);
  if (idOf(item.designer) === me && item.workflowStage === 'DESIGN_IN_PROGRESS') return { item, half: 'DESIGN' };
  if (idOf(item.handler) === me && item.workflowStage === 'POST_IN_PROGRESS') return { item, half: 'POST' };
  return null;
};

// ---------------------------------------------------------------------------
// Boards
// ---------------------------------------------------------------------------

/**
 * @route GET /api/workflow?board=DESIGN|POST
 *
 * Designers and admins read the design board; handlers and admins the post board.
 * A coordinator sees their own asks on either, because both halves come back to
 * them for review.
 */
export const listWorkflow = asyncHandler(async (req, res) => {
  /**
   * `?mine=1` is the assignee's own view of it, for My Assigned Work: everything
   * they have acknowledged, on either half, whatever stage it has reached. It
   * crosses both boards deliberately — a person owes what they owe, and splitting
   * that across two screens would hide half of it. No board rules apply, because
   * this only ever returns work already assigned to the caller.
   */
  if (req.query.mine === '1' || req.query.mine === 'true') {
    const me = String(req.user._id);
    const rows = await populateRequest(InstitutionRequest.find({
      $or: [{ designer: req.user._id }, { handler: req.user._id }],
      workflowStage: { $nin: ['CANCELLED'] },
    })).sort({ updatedAt: -1 }).limit(200).lean();

    // Once somebody else has taken the work on, it is theirs and it leaves this
    // list. For a designer that means a handler acknowledging the posting half:
    // the design is confirmed and done with, and what happens to it next is not
    // their job. Their own half never changes hands, so nothing else can take it.
    const items = rows
      .filter((i) => {
        const mineAsDesigner = idOf(i.designer) === me;
        const mineAsHandler = idOf(i.handler) === me;
        if (mineAsHandler) return true; // nothing follows the handler
        if (mineAsDesigner && i.handler && idOf(i.handler) !== me) return false;
        return true;
      })
      // Which half is theirs, so the caller does not have to work it out from ids.
      .map((i) => ({ ...i, myRole: idOf(i.designer) === me ? 'DESIGNER' : 'SOCIAL_HANDLER' }));

    res.json({ success: true, board: 'MINE', items, counts: {} });
    return;
  }

  const board = req.query.board === 'POST' ? 'POST' : 'DESIGN';
  const stages = board === 'POST' ? [...POST_STAGES, 'POSTED'] : DESIGN_STAGES;

  if (board === 'DESIGN' && !(isDesigner(req.user) || isAdministrator(req.user) || req.user.userType === USER_TYPES.COORDINATOR)) {
    res.status(403); throw new Error('Designs to be Done is for designers and admins');
  }
  if (board === 'POST' && !(isHandler(req.user) || isAdministrator(req.user) || req.user.userType === USER_TYPES.COORDINATOR)) {
    res.status(403); throw new Error('To Be Posted is for social media handlers and admins');
  }

  const query = { workflowStage: { $in: stages } };
  const orgs = scopeToOrgs(req.user);
  // A coordinator only ever sees the asks they raised; everyone else sees the pool
  // for the colleges they can reach.
  if (req.user.userType === USER_TYPES.COORDINATOR) query.raisedBy = req.user._id;
  else if (orgs && isAdministrator(req.user)) query.organization = { $in: orgs };

  // To Be Posted is not one shared pool. The coordinator named the pages when
  // they accepted the design, so a handler is shown the work for the pages they
  // actually run — their own college's Instagram, not another college's, and not
  // a channel somebody else handles. Admins still see everything for oversight.
  if (board === 'POST' && isHandler(req.user)) query.$or = postBoardScopeFor(req.user);

  if (req.query.stage && stages.includes(req.query.stage)) query.workflowStage = req.query.stage;
  if (req.query.search) query.title = { $regex: String(req.query.search), $options: 'i' };

  const items = await populateRequest(InstitutionRequest.find(query)).sort({ createdAt: -1 }).limit(200).lean();

  // Per-stage tallies for the board's tiles, over the same scope as the list.
  const tallyQuery = { ...query };
  delete tallyQuery.workflowStage;
  delete tallyQuery.title;
  const rows = await InstitutionRequest.aggregate([
    { $match: { ...tallyQuery, workflowStage: { $in: stages } } },
    { $group: { _id: '$workflowStage', n: { $sum: 1 } } },
  ]);
  const counts = stages.reduce((acc, s) => ({ ...acc, [s]: 0 }), {});
  rows.forEach((r) => { counts[r._id] = r.n; });

  res.json({ success: true, board, items, counts });
});

/**
 * @route GET /api/workflow/:id
 *
 * The whole item: the coordinator's original ask untouched, plus whichever
 * approvals exist for it with their media and full feedback history.
 */
export const getWorkflowItem = asyncHandler(async (req, res) => {
  const item = await loadItem(req, res);
  const me = String(req.user._id);

  const [design, post] = await Promise.all([
    item.designApproval ? ApprovalRequest.findById(item.designApproval).lean() : null,
    item.postApproval ? ApprovalRequest.findById(item.postApproval).lean() : null,
  ]);
  const [designMedia, postMedia] = await Promise.all([
    attachMedia(item.designApproval),
    attachMedia(item.postApproval),
  ]);

  const stage = item.workflowStage;
  const amCoordinator = idOf(item.raisedBy) === me;
  const amDesigner = idOf(item.designer) === me;
  const amHandler = idOf(item.handler) === me;
  const admin = isAdministrator(req.user) && !req.user.viewOnly;

  // What this viewer can actually do here, decided server-side so neither app has
  // to re-derive the pipeline rules.
  const can = {
    // The one intervention point before either half has really started: an
    // Admin can pull the request back while nobody has acknowledged it yet.
    // Once a designer or handler has it, this is gone — talk to whoever holds it.
    cancel: admin && ['DESIGN_OPEN', 'POST_OPEN'].includes(stage),
    acknowledgeDesign: !req.user.viewOnly && isDesigner(req.user) && stage === 'DESIGN_OPEN',
    submitDesign: !req.user.viewOnly && amDesigner && stage === 'DESIGN_IN_PROGRESS',
    reviewDesign: admin && stage === 'DESIGN_ADMIN_REVIEW',
    acceptDesign: !req.user.viewOnly && amCoordinator && stage === 'DESIGN_COORDINATOR_REVIEW',
    // Posting work belongs to whoever runs the pages the coordinator chose, so a
    // handler for another channel sees the item but is not offered the claim.
    acknowledgePost: !req.user.viewOnly && isHandler(req.user) && stage === 'POST_OPEN'
      && handlesPagesFor(req.user, item),
    submitPost: !req.user.viewOnly && amHandler && stage === 'POST_IN_PROGRESS',
    reviewPost: admin && stage === 'POST_ADMIN_REVIEW',
    acceptPost: !req.user.viewOnly && amCoordinator && stage === 'POST_COORDINATOR_REVIEW',
    markPosted: !req.user.viewOnly && amHandler && stage === 'POST_APPROVED',
  };

  // The channels the coordinator picks from at their Done step. Served here so the
  // picker needs no second call, and so a coordinator is never offered a page
  // their college does not run.
  const availablePlatforms = can.acceptDesign && needsPosting(item)
    ? await availablePlatformsFor(item.organization)
    : [];

  res.json({
    success: true,
    item: {
      ...item.toObject(),
      needsPosting: needsPosting(item),
      availablePlatforms,
      design: design ? { ...design, ...designMedia } : null,
      post: post ? { ...post, ...postMedia } : null,
      can,
      viewerRole: { amCoordinator, amDesigner, amHandler, amAdmin: isAdministrator(req.user) },
    },
  });
});

// ---------------------------------------------------------------------------
// Acknowledge — taking the work, exclusively
// ---------------------------------------------------------------------------

/**
 * @route PUT /api/workflow/:id/acknowledge
 *
 * Whoever gets here first owns it. The claim is a single conditional update on the
 * request, so two designers pressing at once cannot both win — the loser is told
 * who took it rather than silently sharing the job.
 */
export const acknowledgeWorkflowItem = asyncHandler(async (req, res) => {
  const item = await loadItem(req, res, { populate: false });
  const designHalf = item.workflowStage === 'DESIGN_OPEN';
  const postHalf = item.workflowStage === 'POST_OPEN';

  if (!designHalf && !postHalf) {
    res.status(409);
    const holder = await User.findById(item.designer || item.handler).select('name');
    throw new Error(holder
      ? `${holder.name} has already taken this on`
      : 'This is not waiting to be picked up');
  }
  if (designHalf && !isDesigner(req.user)) { res.status(403); throw new Error('Only a designer can take design work'); }
  if (postHalf && !isHandler(req.user)) { res.status(403); throw new Error('Only a social media handler can take posting work'); }
  // The board already hides other people's pages; this is the same rule enforced
  // on the action, so a stale board or a hand-made request cannot get round it.
  if (postHalf && !handlesPagesFor(req.user, item)) {
    res.status(403);
    const wanted = (item.postPlatforms || []).join(', ');
    throw new Error(wanted
      ? `This is for the college's ${wanted} page(s), which you do not handle`
      : 'You do not handle any pages for that college');
  }

  const claim = designHalf
    ? { workflowStage: 'DESIGN_IN_PROGRESS', designer: req.user._id, designerAcknowledgedAt: new Date() }
    : { workflowStage: 'POST_IN_PROGRESS', handler: req.user._id, handlerAcknowledgedAt: new Date() };

  // The stage in the filter is the lock: whoever loses the race matches nothing.
  const won = await InstitutionRequest.findOneAndUpdate(
    { _id: item._id, workflowStage: designHalf ? 'DESIGN_OPEN' : 'POST_OPEN' },
    { $set: claim },
    { new: true }
  );
  if (!won) {
    const holder = await InstitutionRequest.findById(item._id).populate('designer handler', 'name').lean();
    const name = (designHalf ? holder?.designer?.name : holder?.handler?.name) || 'Someone else';
    res.status(409); throw new Error(`${name} acknowledged this first`);
  }

  await logActivity({
    user: req.user._id, organization: idOf(won.organization), action: ACTIVITY_ACTIONS.WORK_ASSIGNED,
    description: `Acknowledged ${designHalf ? 'design' : 'posting'} work for "${won.title}"`,
    entityType: 'InstitutionRequest', entityId: won._id,
  });
  await notifyUser(won.raisedBy, won, {
    type: NOTIFICATION_TYPES.WORK_ASSIGNED,
    title: designHalf ? 'A designer has taken your request' : 'A handler has taken your post',
    message: `${req.user.name} is working on "${won.title}"`,
  });
  await notifyAdmins(won, {
    type: NOTIFICATION_TYPES.WORK_ASSIGNED,
    title: designHalf ? 'Design work acknowledged' : 'Posting work acknowledged',
    message: `${req.user.name} acknowledged "${won.title}"`,
  });

  const fresh = await populateRequest(InstitutionRequest.findById(won._id)).lean();
  res.json({ success: true, item: fresh });
});

// ---------------------------------------------------------------------------
// Submit — the designer's artwork, or the handler's copy
// ---------------------------------------------------------------------------

/**
 * @route PUT /api/workflow/:id/submit
 *
 * Send the work for approval. First time round this raises the approval that
 * carries this half; afterwards it is a resubmission against the same one, so the
 * feedback rounds already on it stay intact and readable.
 *
 * Design half: files are the artwork. Post half: caption/description/hashtags,
 * with any extra media appended.
 */
export const submitWorkflowWork = asyncHandler(async (req, res) => {
  const item = await loadItem(req, res, { populate: false });
  const me = String(req.user._id);
  const designHalf = ['DESIGN_IN_PROGRESS', 'DESIGN_ADMIN_REVIEW'].includes(item.workflowStage);
  const postHalf = ['POST_IN_PROGRESS', 'POST_ADMIN_REVIEW'].includes(item.workflowStage);

  if (!designHalf && !postHalf) { res.status(409); throw new Error('This is not waiting on work from you'); }
  if (designHalf && idOf(item.designer) !== me) { res.status(403); throw new Error('This design is not assigned to you'); }
  if (postHalf && idOf(item.handler) !== me) { res.status(403); throw new Error('This post is not assigned to you'); }
  // Sending it again while the admins still hold it would queue two rounds at once.
  if (item.workflowStage === 'DESIGN_ADMIN_REVIEW' || item.workflowStage === 'POST_ADMIN_REVIEW') {
    res.status(409); throw new Error('This is already with the Admin for approval');
  }

  const half = designHalf ? 'DESIGN' : 'POST';
  const files = req.files || [];
  let approvalId = approvalIdFor(item, half);
  // Which round these files belong to. The first hand-in is round 0; each round of
  // changes appends its replacement under the next number, so a reviewer can tell
  // the work they asked to be changed from the work that answers them.
  let revision = 0;

  if (!approvalId) {
    // The approval inherits the ask: same college, same title, and pointed back at
    // the request so nothing about it has to be retyped or duplicated.
    const created = await ApprovalRequest.create({
      organization: item.organization,
      title: item.title,
      description: designHalf ? item.details : String(req.body.description || ''),
      caption: designHalf ? '' : String(req.body.caption || ''),
      hashtags: designHalf ? [] : String(req.body.hashtags || '').split(/[\s,]+/).filter(Boolean),
      type: designHalf ? APPROVAL_TYPES.DESIGN : APPROVAL_TYPES.POST,
      status: APPROVAL_STATUS.PENDING,
      submittedAt: new Date(),
      createdBy: req.user._id,
      designer: designHalf ? req.user._id : undefined,
      assignedTo: postHalf ? req.user._id : undefined,
      sourceRequest: item._id,
      workCategory: item.workCategory,
      workItem: item.workItem,
      dueDate: item.neededBy,
    });
    approvalId = created._id;
    if (designHalf) item.designApproval = approvalId; else item.postApproval = approvalId;
  } else {
    const approval = await ApprovalRequest.findById(approvalId);
    revision = (approval.resubmitCount || 0) + 1;
    if (postHalf) {
      if (req.body.caption !== undefined) approval.caption = String(req.body.caption);
      if (req.body.description !== undefined) approval.description = String(req.body.description);
      if (req.body.hashtags !== undefined) {
        approval.hashtags = String(req.body.hashtags).split(/[\s,]+/).filter(Boolean);
      }
    }
    // A second pass is a resubmission of the same piece of work — the review rounds
    // already recorded on it are the history, and are left alone.
    approval.status = APPROVAL_STATUS.RESUBMITTED;
    approval.resubmittedAt = new Date();
    approval.resubmitCount = (approval.resubmitCount || 0) + 1;
    await approval.save();
  }

  if (files.length) {
    const existing = await ApprovalImage.countDocuments({ request: approvalId });
    const docs = [];
    for (let i = 0; i < files.length; i++) {
      const f = files[i];
      const up = await uploadBuffer(f.buffer, { folder: 'approvals', originalName: f.originalname });
      const mime = f.mimetype || '';
      const mediaType = mime.startsWith('video/') ? 'video' : (mime.startsWith('image/') ? 'image' : 'document');
      docs.push({
        request: approvalId, url: up.url, publicId: up.publicId, mediaType,
        name: f.originalname, fileSize: f.size, kind: 'final', order: existing + i, revision,
      });
    }
    await ApprovalImage.insertMany(docs);
    await ApprovalRequest.findByIdAndUpdate(approvalId, {
      imageCount: await ApprovalImage.countDocuments({ request: approvalId }),
    });
  }

  // The artwork is the design — without a file there is nothing to approve.
  if (designHalf) {
    const finals = await ApprovalImage.countDocuments({ request: approvalId });
    if (!finals) { res.status(400); throw new Error('Attach the finished design before sending it for approval'); }
  }

  const note = String(req.body.note || '').trim();
  await ApprovalComment.create({
    request: approvalId, kind: 'event', author: req.user._id,
    text: note ? `sent for approval: ${note}` : 'sent for approval',
  });

  item.workflowStage = designHalf ? 'DESIGN_ADMIN_REVIEW' : 'POST_ADMIN_REVIEW';
  // When the work was finished and handed in. Overwritten on a resubmission on
  // purpose: what matters here is when the version now under review was sent.
  const submittedAt = new Date();
  if (designHalf) item.designSubmittedAt = submittedAt; else item.postSubmittedAt = submittedAt;
  await item.save();

  await logActivity({
    user: req.user._id, organization: idOf(item.organization),
    action: designHalf ? ACTIVITY_ACTIONS.DESIGN_SUBMITTED : ACTIVITY_ACTIONS.APPROVAL_SUBMISSION,
    description: `Sent ${designHalf ? 'design' : 'post content'} for approval: "${item.title}"`,
    entityType: 'InstitutionRequest', entityId: item._id,
  });
  await notifyAdmins(item, {
    type: designHalf ? NOTIFICATION_TYPES.DESIGN_SUBMITTED : NOTIFICATION_TYPES.NEW_REQUEST,
    title: designHalf ? 'Design ready for approval' : 'Post content ready for approval',
    message: `${req.user.name} sent "${item.title}" for approval`,
  });

  const fresh = await populateRequest(InstitutionRequest.findById(item._id)).lean();
  res.json({ success: true, item: fresh });
});

// ---------------------------------------------------------------------------
// Admin / Super Admin review
// ---------------------------------------------------------------------------

/**
 * @route PUT /api/workflow/:id/review   body: { action: 'APPROVE' | 'CHANGES', feedbackPoints? }
 *
 * Approving hands the work to the coordinator who asked for it. Asking for changes
 * sends it back to the person who submitted, with the notes attached to the
 * approval's history so every round stays visible to them and to the admins.
 */
export const reviewWorkflowItem = asyncHandler(async (req, res) => {
  const item = await loadItem(req, res, { populate: false });
  if (!isAdministrator(req.user)) { res.status(403); throw new Error('Only an Admin or the super admin can review this'); }
  if (!canAccessOrg(req.user, idOf(item.organization))) { res.status(404); throw new Error('Workflow item not found'); }

  const designHalf = item.workflowStage === 'DESIGN_ADMIN_REVIEW';
  const postHalf = item.workflowStage === 'POST_ADMIN_REVIEW';
  if (!designHalf && !postHalf) { res.status(409); throw new Error('This is not waiting on your review'); }

  const half = designHalf ? 'DESIGN' : 'POST';
  const approvalId = approvalIdFor(item, half);
  const action = String(req.body.action || '').toUpperCase();

  if (action === 'CHANGES') {
    const points = readFeedback(req.body.feedbackPoints, res);
    await recordChanges(approvalId, req.user, points);
    item.workflowStage = designHalf ? 'DESIGN_IN_PROGRESS' : 'POST_IN_PROGRESS';
    await item.save();

    await notifyUser(designHalf ? item.designer : item.handler, item, {
      type: NOTIFICATION_TYPES.CONTENT_REJECTED,
      title: 'Changes requested',
      message: `${req.user.name} asked for changes on "${item.title}" — ${points.length} note(s)`,
    });
    await logActivity({
      user: req.user._id, organization: idOf(item.organization), action: ACTIVITY_ACTIONS.APPROVAL_REJECTED,
      description: `Requested changes on ${designHalf ? 'design' : 'post content'} for "${item.title}"`,
      entityType: 'InstitutionRequest', entityId: item._id,
    });
  } else if (action === 'APPROVE') {
    if (approvalId) {
      await ApprovalRequest.findByIdAndUpdate(approvalId, {
        status: APPROVAL_STATUS.APPROVED, approvedAt: new Date(), approvedBy: req.user._id,
      });
      await ApprovalComment.create({
        request: approvalId, kind: 'event', author: req.user._id, text: 'approved — sent to the coordinator to confirm',
      });
    }
    item.workflowStage = designHalf ? 'DESIGN_COORDINATOR_REVIEW' : 'POST_COORDINATOR_REVIEW';
    // The admins' sign-off, recorded separately from the coordinator's acceptance
    // that follows it — they are two different gates.
    const approvedAt = new Date();
    if (designHalf) {
      item.designApprovedAt = approvedAt;
      item.designApprovedBy = req.user._id;
    } else {
      item.postApprovedAt = approvedAt;
      item.postApprovedBy = req.user._id;
    }
    await item.save();

    await notifyUser(item.raisedBy, item, {
      type: NOTIFICATION_TYPES.CONTENT_APPROVED,
      title: designHalf ? 'Your design is ready to check' : 'Your post content is ready to check',
      message: `"${item.title}" was approved by ${req.user.name} — confirm it or ask for changes`,
    });
    await notifyUser(designHalf ? item.designer : item.handler, item, {
      type: NOTIFICATION_TYPES.CONTENT_APPROVED,
      title: 'Approved by the Admin',
      message: `"${item.title}" passed review and is with the coordinator now`,
    });
    await logActivity({
      user: req.user._id, organization: idOf(item.organization), action: ACTIVITY_ACTIONS.APPROVAL_APPROVED,
      description: `Approved ${designHalf ? 'design' : 'post content'} for "${item.title}"`,
      entityType: 'InstitutionRequest', entityId: item._id,
    });
  } else {
    res.status(400); throw new Error('Say whether you approve it or want changes');
  }

  const fresh = await populateRequest(InstitutionRequest.findById(item._id)).lean();
  res.json({ success: true, item: fresh });
});

// ---------------------------------------------------------------------------
// Coordinator review — "is everything correct, or are changes required?"
// ---------------------------------------------------------------------------

/**
 * @route PUT /api/workflow/:id/confirm   body: { action: 'DONE' | 'CHANGES', feedbackPoints? }
 *
 * The last word belongs to whoever asked for the work. Done on the design opens
 * the posting half (or finishes print work outright); Done on the post content
 * releases it to be published. Changes send it back to the designer or handler and
 * round it goes again — admin review included, because the admins own that gate.
 */
export const confirmWorkflowItem = asyncHandler(async (req, res) => {
  const item = await loadItem(req, res, { populate: false });
  if (idOf(item.raisedBy) !== String(req.user._id)) {
    res.status(403); throw new Error('Only the coordinator who raised this request can confirm it');
  }

  const designHalf = item.workflowStage === 'DESIGN_COORDINATOR_REVIEW';
  const postHalf = item.workflowStage === 'POST_COORDINATOR_REVIEW';
  if (!designHalf && !postHalf) { res.status(409); throw new Error('This is not waiting on your confirmation'); }

  const half = designHalf ? 'DESIGN' : 'POST';
  const approvalId = approvalIdFor(item, half);
  const action = String(req.body.action || '').toUpperCase();
  const worker = designHalf ? item.designer : item.handler;

  if (action === 'CHANGES') {
    const points = readFeedback(req.body.feedbackPoints, res);
    await recordChanges(approvalId, req.user, points);
    item.workflowStage = designHalf ? 'DESIGN_IN_PROGRESS' : 'POST_IN_PROGRESS';
    await item.save();

    await notifyUser(worker, item, {
      type: NOTIFICATION_TYPES.CONTENT_REJECTED,
      title: 'The coordinator asked for changes',
      message: `${req.user.name} asked for changes on "${item.title}" — ${points.length} note(s)`,
    });
    // The admins own the gate this will come back through, so they see the notes too.
    await notifyAdmins(item, {
      type: NOTIFICATION_TYPES.CONTENT_REJECTED,
      title: 'Coordinator requested changes',
      message: `${req.user.name} asked for changes on "${item.title}"`,
    });
  } else if (action === 'DONE') {
    if (approvalId) {
      await ApprovalComment.create({
        request: approvalId, kind: 'event', author: req.user._id,
        text: designHalf ? 'confirmed the design — this is what was wanted' : 'confirmed the post content',
      });
    }
    if (designHalf) {
      // Accepting the design is also when the college says where it goes. Asking
      // now — rather than leaving the handler to guess, or the admin to decide for
      // them — is the whole point: the coordinator owns their channels.
      if (needsPosting(item)) {
        const available = await availablePlatformsFor(item.organization);
        const chosen = [...new Set(
          (Array.isArray(req.body.platforms) ? req.body.platforms : String(req.body.platforms ?? '').split(','))
            .map((p) => String(p).trim())
            .filter(Boolean)
        )];
        if (!chosen.length) {
          res.status(400);
          throw new Error('Choose at least one page for this to be posted on');
        }
        const unknown = chosen.filter((p) => !available.includes(p));
        if (unknown.length) {
          res.status(400);
          throw new Error(`Your college does not have ${unknown.join(', ')} set up`);
        }
        item.postPlatforms = chosen;
      }
      item.designAcceptedAt = new Date();
      item.designAcceptedBy = req.user._id;
      // Digital work goes on to be posted; print is done here, because there is
      // nothing to publish.
      item.workflowStage = needsPosting(item) ? 'POST_OPEN' : 'COMPLETED';
      // Both gates are now behind it — the admins approved the design and the
      // college confirmed it. Social media work passes to the handlers who run the
      // chosen pages, and the status says that rather than a bare "Approved" that
      // would leave the college wondering whether anyone is publishing it.
      // Anything with no page to go on is finished here.
      item.status = needsPosting(item) ? 'WITH_SOCIAL_HANDLER' : 'APPROVED';
      item.reviewedBy = req.user._id;
      item.reviewedAt = new Date();
      await item.save();

      if (needsPosting(item)) {
        // Only the handlers who run the pages the college just chose. Telling
        // every handler on the platform about work they cannot see on their board
        // — and could not claim if they tried — is noise, not cover.
        const handlers = await User.find({
          isActive: true,
          role: ROLES.USER,
          userType: USER_TYPES.SOCIAL_HANDLER,
          handles: { $elemMatch: { organization: item.organization, platforms: { $in: item.postPlatforms } } },
        }).select('_id');
        const pages = item.postPlatforms.join(', ');
        await Promise.all(handlers.map((h) => notifyUser(h._id, item, {
          type: NOTIFICATION_TYPES.WORK_ASSIGNED,
          title: `New work to post on ${pages}`,
          message: `"${item.title}" is approved and waiting on your ${pages} page(s)`,
        })));
      }
      await notifyUser(worker, item, {
        type: NOTIFICATION_TYPES.CONTENT_APPROVED,
        title: 'Your design was accepted',
        message: `${req.user.name} confirmed "${item.title}"`,
      });
    } else {
      item.postAcceptedAt = new Date();
      item.postAcceptedBy = req.user._id;
      item.workflowStage = 'POST_APPROVED';
      await item.save();
      if (approvalId) {
        await ApprovalRequest.findByIdAndUpdate(approvalId, {
          status: APPROVAL_STATUS.APPROVED, approvedAt: new Date(), approvedBy: req.user._id,
        });
      }
      await notifyUser(worker, item, {
        type: NOTIFICATION_TYPES.CONTENT_APPROVED,
        title: 'Post approved — ready to post',
        message: `${req.user.name} confirmed "${item.title}" — publish or schedule it, then mark it as posted`,
      });
    }
    await notifyAdmins(item, {
      type: NOTIFICATION_TYPES.CONTENT_APPROVED,
      title: designHalf ? 'Design confirmed by the coordinator' : 'Post content confirmed by the coordinator',
      message: `${req.user.name} confirmed "${item.title}"`,
    });
    await logActivity({
      user: req.user._id, organization: idOf(item.organization), action: ACTIVITY_ACTIONS.APPROVAL_APPROVED,
      description: `Confirmed ${designHalf ? 'design' : 'post content'} for "${item.title}"`,
      entityType: 'InstitutionRequest', entityId: item._id,
    });
  } else {
    res.status(400); throw new Error('Say whether it is done or needs changes');
  }

  const fresh = await populateRequest(InstitutionRequest.findById(item._id)).lean();
  res.json({ success: true, item: fresh });
});

// ---------------------------------------------------------------------------
// Mark as posted
// ---------------------------------------------------------------------------

/**
 * @route PUT /api/workflow/:id/posted   body: { postedAt?, scheduledFor? }
 *
 * The handler says it is out, or booked. A scheduled time is kept as such so the
 * calendar and the reports can tell "goes out on Friday" from "went out today".
 *
 * `postedAt` may be in the past — that is how a handler records posts that went
 * out before anyone logged them, against the day they actually went out.
 */
export const markWorkflowPosted = asyncHandler(async (req, res) => {
  const item = await loadItem(req, res, { populate: false });
  if (idOf(item.handler) !== String(req.user._id)) {
    res.status(403); throw new Error('Only the handler who took this on can mark it posted');
  }
  if (item.workflowStage !== 'POST_APPROVED') {
    res.status(409);
    throw new Error(item.workflowStage === 'POSTED'
      ? 'This is already marked as posted'
      : 'The coordinator has not released this for posting yet');
  }

  // A booking is only a booking while it is still ahead of us; a `scheduledFor`
  // that has already passed describes something that went out, so it falls
  // through to the posted branch and is validated as a back-date.
  const rawScheduled = req.body.scheduledFor;
  const scheduledMs = rawScheduled ? new Date(rawScheduled).getTime() : NaN;
  const scheduled = !Number.isNaN(scheduledMs) && scheduledMs > Date.now();

  let when;
  const backdated = !scheduled && Boolean(rawScheduled || req.body.postedAt);
  if (scheduled) {
    when = new Date(scheduledMs);
  } else {
    const { when: postedAt, error } = resolvePostedAt(rawScheduled || req.body.postedAt);
    if (error) { res.status(400); throw new Error(error); }
    when = postedAt;
  }

  item.workflowStage = 'POSTED';
  item.postedAt = scheduled ? undefined : when;
  item.scheduledFor = scheduled ? when : undefined;
  // It is no longer with the handler — it is out, or booked to go out. Closing the
  // status here is what stops a published ask reading as still waiting on somebody.
  item.status = 'APPROVED';
  await item.save();

  if (item.postApproval) {
    await ApprovalRequest.findByIdAndUpdate(item.postApproval, scheduled
      ? { $set: { scheduledAt: when, scheduledBy: req.user._id } }
      // Out means out: a go-live time left behind from an earlier plan would keep
      // reading as "due on" a date the post has already passed.
      : { $set: { status: APPROVAL_STATUS.POSTED, postedAt: when, postedBy: req.user._id },
          $unset: { scheduledAt: '' } });
    await ApprovalComment.create({
      request: item.postApproval, kind: 'event', author: req.user._id,
      text: scheduled
        ? `scheduled to go out on ${when.toISOString()}`
        : `marked as posted${backdated ? ` — it went out on ${when.toISOString().slice(0, 16).replace('T', ' ')} UTC` : ''}`,
    });
  }

  await logActivity({
    user: req.user._id, organization: idOf(item.organization), action: ACTIVITY_ACTIONS.POST_COMPLETION,
    description: scheduled ? `Scheduled "${item.title}"` : `Posted "${item.title}"`,
    entityType: 'InstitutionRequest', entityId: item._id,
  });
  await notifyUser(item.raisedBy, item, {
    type: NOTIFICATION_TYPES.CONTENT_POSTED,
    title: scheduled ? 'Your post is scheduled' : 'Your post is live',
    message: `${req.user.name} ${scheduled ? 'scheduled' : 'posted'} "${item.title}"`,
  });
  await notifyAdmins(item, {
    type: NOTIFICATION_TYPES.CONTENT_POSTED,
    title: scheduled ? 'Content scheduled' : 'Content posted',
    message: `${req.user.name} ${scheduled ? 'scheduled' : 'posted'} "${item.title}"`,
  });

  const fresh = await populateRequest(InstitutionRequest.findById(item._id)).lean();
  res.json({ success: true, item: fresh });
});

// ---------------------------------------------------------------------------
// Cancel — the Admin's one intervention point, before anyone has taken it on
// ---------------------------------------------------------------------------

/**
 * @route PUT /api/workflow/:id/cancel   body: { reason? }
 *
 * An Admin (or the super admin) can pull a request back, but only while it is
 * still unclaimed — DESIGN_OPEN or POST_OPEN, with nobody acknowledged. Once a
 * designer or handler has taken it on, this is gone; from there it is a
 * conversation with whoever is holding it, not something to be cancelled out
 * from under them.
 *
 * Reuses the `status`/`response`/`reviewedBy`/`reviewedAt` fields the old
 * pre-designer-review flow left on the model, so to the coordinator this reads
 * exactly like any other declined request, with the reason (if one was given)
 * in the reply — no new UI needed on their side.
 */
export const cancelWorkflowItem = asyncHandler(async (req, res) => {
  const item = await loadItem(req, res, { populate: false });
  if (!isAdministrator(req.user)) { res.status(403); throw new Error('Only an Admin or the super admin can cancel this'); }
  if (!canAccessOrg(req.user, idOf(item.organization))) { res.status(404); throw new Error('Workflow item not found'); }
  if (!['DESIGN_OPEN', 'POST_OPEN'].includes(item.workflowStage)) {
    res.status(409); throw new Error('This has already been picked up and can no longer be cancelled');
  }

  const reason = String(req.body.reason || '').trim();
  // Same optimistic lock acknowledgeWorkflowItem races against: the stage plus a
  // clear designer/handler, so a designer or handler claiming this at the same
  // instant cannot be silently overridden by a cancel that started a moment earlier.
  const won = await InstitutionRequest.findOneAndUpdate(
    { _id: item._id, workflowStage: item.workflowStage, designer: null, handler: null },
    { $set: {
      workflowStage: 'CANCELLED',
      status: 'DECLINED',
      response: reason || 'Cancelled before it was picked up.',
      reviewedBy: req.user._id,
      reviewedAt: new Date(),
    } },
    { new: true }
  );
  if (!won) { res.status(409); throw new Error('Someone has already acknowledged this — it can no longer be cancelled'); }

  await logActivity({
    user: req.user._id, organization: idOf(won.organization), action: ACTIVITY_ACTIONS.REQUEST_REVIEWED,
    description: `Cancelled "${won.title}"${reason ? `: ${reason}` : ''}`,
    entityType: 'InstitutionRequest', entityId: won._id,
  });
  await notifyUser(won.raisedBy, won, {
    type: NOTIFICATION_TYPES.REQUEST_DECLINED,
    title: 'Your request was cancelled',
    message: `${req.user.name} cancelled "${won.title}"${reason ? ` — ${reason}` : ''}`,
  });

  const fresh = await populateRequest(InstitutionRequest.findById(won._id)).lean();
  res.json({ success: true, item: fresh });
});
