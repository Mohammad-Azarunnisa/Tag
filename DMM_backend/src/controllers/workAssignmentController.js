import asyncHandler from 'express-async-handler';
import mongoose from 'mongoose';
import WorkAssignment from '../models/WorkAssignment.js';
import User from '../models/User.js';
import Organization from '../models/Organization.js';
import InstitutionRequest from '../models/InstitutionRequest.js';
import ApprovalRequest from '../models/ApprovalRequest.js';
import { ROLES, USER_TYPES, PLATFORMS, ACTIVITY_ACTIONS, NOTIFICATION_TYPES, APPROVAL_STATUS } from '../config/constants.js';
import { logActivity } from '../utils/logActivity.js';
import { resolvePostedAt } from '../utils/postedAt.js';
import { createNotification } from '../utils/notify.js';
import { accessibleOrgIds, canAccessOrg } from '../utils/org.js';
import { uploadBuffer } from '../config/storage.js';

// A coordinator hands work to their own college's people, so they are a creator
// here even though they are a USER. Everyone else in the USER role is an
// assignee, never an assigner.
const isCoordinator = (user) => user?.role === ROLES.USER && user?.userType === USER_TYPES.COORDINATOR;

const populateAssignment = (query) =>
  query
    .populate('organization', 'name color')
    .populate('assignee', 'name avatar email role userType handles organization')
    .populate('createdBy', 'name avatar email')
    .populate('acknowledgeLockedBy', 'name avatar')
    // The whole ask, not just its title: whoever ends up doing the work — the
    // designer making it or the handler publishing it — needs what the college
    // actually wrote and attached, or they are working from a headline.
    .populate({
      path: 'sourceRequest',
      select: 'title details status organization raisedBy category priority neededBy workType workCategory workItem department event eventName eventDate place eventCoordinatorName attachments createdAt',
      populate: { path: 'raisedBy', select: 'name avatar email jobTitle' },
    })
    .populate('handoffBy', 'name avatar')
    .populate('deliveredTo', 'name avatar email')
    .populate('handoffAssignments', 'title assignee assigneeType platform status')
    // completionAttachments is the whole point for a handler: the finished files
    // they are being asked to publish.
    .populate('postingFor', 'title completionNote completionAttachments assignee assigneeType')
    .populate('sourceApproval', 'title caption description type status platforms');

export const listWorkAssignments = asyncHandler(async (req, res) => {
  const { organization, assignee, status, search, from, to } = req.query;
  const query = {};
  if (isCoordinator(req.user)) {
    // What they handed out, plus anything else booked in their college - they
    // run the college, so its workload is theirs to see.
    query.organization = req.user.organization?._id || req.user.organization || null;
  } else if (req.user.role === ROLES.USER) {
    query.assignee = req.user._id;
    // A shared brief goes out as one row per designer and the first to acknowledge
    // owns it; the rest are locked (claimAssignmentForDesigner). A locked copy is
    // somebody else's work now, so it leaves this list rather than sitting on it
    // un-actionable. Admins still see every copy for oversight.
    query.$and = [{
      $or: [
        { acknowledgeLockedBy: null },
        { acknowledgeLockedBy: { $exists: false } },
        { acknowledgeLockedBy: req.user._id },
      ],
    }];
  } else if (req.user.role === ROLES.CEO) {
    // An Admin may hold several institutions - show all of them by default.
    query.organization = { $in: accessibleOrgIds(req.user) };
  }

  // Narrowing is available to whoever can see more than one college. An Admin
  // asking for an institution that isn't theirs gets nothing rather than an
  // error, because the filter is a view preference, not an assertion.
  // Narrowing is for whoever can see more than one college; a coordinator only
  // ever has one, so their scope above already is the filter.
  const canNarrow = [ROLES.ADMIN, ROLES.CEO].includes(req.user.role);
  if (organization && organization !== 'All' && canNarrow) {
    query.organization = canAccessOrg(req.user, organization) ? organization : null;
  }
  if (assignee && assignee !== 'All' && canNarrow) query.assignee = assignee;
  if (status && status !== 'All') query.status = status;
  if (req.query.urgency && req.query.urgency !== 'All') query.urgency = req.query.urgency;
  if (search) {
    const rx = { $regex: String(search), $options: 'i' };
    query.$or = [{ title: rx }, { description: rx }, { completionNote: rx }];
  }
  // Date window on when the work was assigned. Both ends are inclusive; `to`
  // covers the whole day.
  const isDay = (s) => /^\d{4}-\d{2}-\d{2}$/.test(s || '');
  if (isDay(from) || isDay(to)) {
    query.createdAt = {};
    if (isDay(from)) query.createdAt.$gte = new Date(`${from}T00:00:00.000Z`);
    if (isDay(to)) query.createdAt.$lte = new Date(`${to}T23:59:59.999Z`);
  }

  const assignments = await populateAssignment(WorkAssignment.find(query).sort({ createdAt: -1 })).lean();
  res.json({ success: true, assignments });
});

// Notify everyone who can act on an assignment event - every super admin plus
// the Admin(s) over its institution - with a link that opens the assigned-work
// page on exactly which assignment it refers to.
const notifySuperAdmins = async ({ type, title, message, assignment }) => {
  const orgId = assignment.organization?._id || assignment.organization || null;
  const admins = await User.find({
    isActive: true,
    $or: [
      { isSuperAdmin: true },
      ...(orgId
        ? [{ role: ROLES.CEO, $or: [{ organization: orgId }, { managedOrganizations: orgId }] }]
        : []),
    ],
  }).select('_id');
  await Promise.all(admins.map((a) => createNotification({
    recipient: a._id,
    organization: assignment.organization,
    type,
    title,
    message,
    link: `/assigned-work?assignment=${assignment._id}`,
    relatedRequest: assignment._id,
  })));
};

// Tell the coordinator who raised the request who is actually doing the work.
// `title`/`describe` let the caller say what the moment means: work put in front
// of designers has not been picked up by anyone yet, whereas an acknowledgement
// or a handler allocation names the person who now owns it.
const notifyRequestOwnerOfAssignment = async ({
  sourceRequestId, organization, assigneeNames, relatedRequest,
  title = 'Work assigned',
  describe = (list) => `Work assigned to ${list}`,
}) => {
  if (!sourceRequestId || !assigneeNames?.length) return;
  try {
    const instReq = await InstitutionRequest.findById(sourceRequestId).select('_id raisedBy organization');
    if (!instReq?.raisedBy) return;
    const names = assigneeNames.map((name) => String(name || '').trim()).filter(Boolean);
    if (!names.length) return;
    await createNotification({
      recipient: instReq.raisedBy,
      organization: organization || instReq.organization,
      type: NOTIFICATION_TYPES.WORK_ASSIGNED,
      title,
      message: describe(names.join(', ')),
      link: `/requests?request=${instReq._id}`,
      relatedRequest: relatedRequest || instReq._id,
    });
  } catch (err) {
    console.error('failed to notify the request owner about assignment:', err.message);
  }
};

// A posting job publishes an approved design. The handler does that work in
// their assigned work — the approval is no longer in their list — so signing the
// job off is what marks the design POSTED. Without this the content pipeline
// would sit at APPROVED for ever, waiting on a screen nobody visits any more.
const markSourceApprovalPosted = async (assignment, actor, at = new Date()) => {
  if (!assignment.sourceApproval) return;
  try {
    const design = await ApprovalRequest.findById(assignment.sourceApproval);
    if (!design || design.status !== APPROVAL_STATUS.APPROVED) return;
    design.status = APPROVAL_STATUS.POSTED;
    // `at` rather than now: closing back-dated posting work has to date the
    // design by when it went out, or the job and the design it published would
    // disagree about the day.
    design.postedAt = at;
    design.scheduledAt = undefined;
    design.postedBy = assignment.assignee;
    await design.save();
    await logActivity({
      user: actor._id,
      organization: assignment.organization,
      action: ACTIVITY_ACTIONS.POST_COMPLETION,
      description: `"${design.title}" published and marked posted`,
      entityType: 'ApprovalRequest',
      entityId: design._id,
    });
  } catch (err) {
    console.error('failed to mark the linked design as posted:', err.message);
  }
};

// Work created from a college request closes that request out. The moment the
// work is actually picked up — a designer acknowledging it, or a social handler's
// completion being signed off, since they have nothing to acknowledge — the
// college's ask has been answered, so the request moves on to APPROVED.
//
// `silent` is for callers that are already telling the coordinator something more
// specific about the same moment — two notifications landing together for one
// event is noise, not information.
const settleSourceRequest = async (assignment, actor, response, { silent = false } = {}) => {
  if (!assignment.sourceRequest) return;
  try {
    const instReq = await InstitutionRequest.findById(assignment.sourceRequest);
    // OPEN and DECLINED are deliberately left alone: the first was never sent
    // for allocation, the second was turned down.
    if (!instReq || !['IN_REVIEW', 'GETTING_ALLOCATED'].includes(instReq.status)) return;
    instReq.status = 'APPROVED';
    instReq.reviewedBy = actor._id;
    instReq.reviewedAt = new Date();
    // The admin's reply from the approval stands; this only fills a blank one.
    instReq.response = instReq.response || response;
    await instReq.save();
    if (!silent) {
      await createNotification({
        recipient: instReq.raisedBy,
        organization: instReq.organization,
        type: NOTIFICATION_TYPES.REQUEST_APPROVED,
        title: 'Your request was approved',
        message: response,
        link: `/requests?request=${instReq._id}`,
        relatedRequest: instReq._id,
      });
    }
  } catch (err) {
    console.error('failed to settle the linked institution request:', err.message);
  }
};

const loadOwnAssignment = async (req, res) => {
  const assignment = await WorkAssignment.findById(req.params.id);
  if (!assignment) { res.status(404); throw new Error('Assignment not found'); }
  if (String(assignment.assignee) !== String(req.user._id)) {
    res.status(403); throw new Error('This work is not assigned to you');
  }
  return assignment;
};

// @route PUT /api/work-assignments/:id/acknowledge — the assignee accepts the work.
/**
 * Take ownership of OPEN designer work: mark it acknowledged, shut the other
 * designers out of the shared brief, and tell them who took it.
 *
 * Shared by the Acknowledge button and by submitting finished work against the
 * brief — because handing in the work IS taking it, and making someone press
 * Acknowledge first just to be allowed to submit is a step that protects nothing.
 *
 * Throws a plain Error carrying `.statusCode` so both callers report the same
 * refusal for the same reason.
 */
export const claimAssignmentForDesigner = async (assignment, user) => {
  const refuse = (code, message) => {
    const err = new Error(message);
    err.statusCode = code;
    throw err;
  };

  if (assignment.status !== 'OPEN') refuse(400, `This work is already ${assignment.status.toLowerCase()}`);
  if (assignment.acknowledgeLockedBy) {
    const blocker = await User.findById(assignment.acknowledgeLockedBy).select('name');
    refuse(409, `${blocker?.name || 'Another designer'} already acknowledged this work`);
  }
  if (assignment.allocationGroup) {
    const existingOwner = await WorkAssignment.findOne({
      allocationGroup: assignment.allocationGroup,
      _id: { $ne: assignment._id },
      assigneeType: USER_TYPES.DESIGNER,
      status: { $in: ['ACKNOWLEDGED', 'SUBMITTED', 'DONE'] },
    }).populate('assignee', 'name');
    if (existingOwner) {
      refuse(409, `${existingOwner.assignee?.name || 'Another designer'} already acknowledged this work`);
    }
  }

  assignment.status = 'ACKNOWLEDGED';
  assignment.acknowledgedAt = new Date();
  await assignment.save();

  if (assignment.allocationGroup) {
    const siblings = await WorkAssignment.find({
      allocationGroup: assignment.allocationGroup,
      _id: { $ne: assignment._id },
      assigneeType: USER_TYPES.DESIGNER,
      status: 'OPEN',
    }).select('_id assignee organization');

    if (siblings.length) {
      await WorkAssignment.updateMany(
        { _id: { $in: siblings.map((row) => row._id) } },
        { $set: { acknowledgeLockedBy: user._id, acknowledgeLockedAt: assignment.acknowledgedAt } }
      );
      await Promise.all(siblings.map((row) => createNotification({
        recipient: row.assignee,
        organization: row.organization,
        type: NOTIFICATION_TYPES.WORK_ACKNOWLEDGED_ELSEWHERE,
        title: 'Work already acknowledged',
        message: `${user.name} already acknowledged "${assignment.title}"`,
        link: `/my-assigned-work?assignment=${row._id}`,
        relatedRequest: row._id,
      })));
    }
  }

  await settleSourceRequest(
    assignment, user,
    `${user.name} accepted the work for "${assignment.title}"`,
    { silent: true }
  );
  await notifyRequestOwnerOfAssignment({
    sourceRequestId: assignment.sourceRequest,
    organization: assignment.organization,
    assigneeNames: [user.name],
    relatedRequest: assignment._id,
  });
  return assignment;
};

export const acknowledgeAssignment = asyncHandler(async (req, res) => {
  const assignment = await loadOwnAssignment(req, res);
  if (assignment.assigneeType === USER_TYPES.SOCIAL_HANDLER) {
    res.status(400); throw new Error('Social-handler work goes straight to completion — there is nothing to acknowledge');
  }
  try {
    await claimAssignmentForDesigner(assignment, req.user);
  } catch (err) {
    res.status(err.statusCode || 400);
    throw err;
  }

  // Claiming it settles the college request and tells the coordinator who now
  // has their work — see claimAssignmentForDesigner.
  const populated = await populateAssignment(WorkAssignment.findById(assignment._id)).lean();
  res.json({ success: true, assignment: populated });
});

// @route PUT /api/work-assignments/:id/submit — the assignee raises a completion
// request for the super admin to sign off. Body: { note }
export const submitAssignment = asyncHandler(async (req, res) => {
  const assignment = await loadOwnAssignment(req, res);
  const canSubmitDirectly = assignment.assigneeType === USER_TYPES.SOCIAL_HANDLER && assignment.status === 'OPEN';
  if (!canSubmitDirectly && !['ACKNOWLEDGED', 'SUBMITTED'].includes(assignment.status)) {
    res.status(400);
    throw new Error(assignment.status === 'OPEN'
      ? 'Acknowledge the work before sending a completion request'
      : 'This work is already marked done');
  }
  const note = String(req.body.note || '').trim();
  if (!note) { res.status(400); throw new Error('Add a short note describing the work you completed'); }

  const resubmitting = assignment.status === 'SUBMITTED';
  assignment.status = 'SUBMITTED';
  assignment.completionNote = note;
  assignment.submittedAt = new Date();
  assignment.reviewNote = '';

  // The finished files travel with the work. Re-submitting replaces them, so a
  // correction does not leave the old version sitting alongside the new one.
  const files = Array.isArray(req.files) ? req.files : [];
  if (files.length) {
    const docs = [];
    for (const file of files) {
      const up = await uploadBuffer(file.buffer, { folder: 'assigned-work', originalName: file.originalname });
      docs.push({
        url: up.url,
        publicId: up.publicId,
        name: file.originalname,
        fileSize: file.size,
        mediaType: file.mimetype?.startsWith('image/') ? 'image' : file.mimetype?.startsWith('video/') ? 'video' : 'document',
      });
    }
    assignment.completionAttachments = docs;
  }
  await assignment.save();

  await logActivity({
    user: req.user._id,
    organization: assignment.organization,
    action: ACTIVITY_ACTIONS.WORK_SUBMITTED,
    description: `Raised a completion request for "${assignment.title}"`,
    entityType: 'WorkAssignment',
    entityId: assignment._id,
  });
  await notifySuperAdmins({
    type: NOTIFICATION_TYPES.WORK_SUBMITTED,
    title: resubmitting ? 'Completion request updated' : 'Completion request for assigned work',
    message: `${req.user.name} finished "${assignment.title}" and asked for your approval — ${note}`,
    assignment,
  });

  const populated = await populateAssignment(WorkAssignment.findById(assignment._id)).lean();
  res.json({ success: true, assignment: populated });
});

// Shared eligibility rules: a designer must belong to the college; a social
// handler must be mapped to that college AND the channel.
const assertAssignable = (assignee, org, platform, res) => {
  if (assignee.userType !== USER_TYPES.SOCIAL_HANDLER
      && String(assignee.organization || '') && String(assignee.organization) !== String(org._id)) {
    res.status(400); throw new Error(`${assignee.name} does not belong to ${org.name}`);
  }
  if (assignee.userType === USER_TYPES.SOCIAL_HANDLER) {
    if (!platform) {
      res.status(400);
      throw new Error(`Choose the platform this is for - ${assignee.name} is a social handler`);
    }
    const ok = Array.isArray(assignee.handles)
      && assignee.handles.some((h) => String(h.organization) === String(org._id)
        && (h.platforms || []).includes(platform));
    if (!ok) { res.status(400); throw new Error(`${assignee.name} is not mapped to ${org.name} / ${platform}`); }
  }
};

// @route PUT /api/work-assignments/:id/reassign  (super admin)
// Moves unfinished work to someone else - e.g. the original assignee left, is
// away, or the task belongs with another person. Body: { assigneeId }
export const reassignAssignment = asyncHandler(async (req, res) => {
  const assignment = await WorkAssignment.findById(req.params.id);
  if (!assignment) { res.status(404); throw new Error('Assignment not found'); }
  if (!canAccessOrg(req.user, assignment.organization)) {
    res.status(403); throw new Error('This work belongs to an institution you do not have access to');
  }
  if (assignment.status === 'DONE') {
    res.status(400); throw new Error('This work is already complete - reassigning it would lose that record');
  }
  const { assigneeId } = req.body;
  if (!assigneeId || !mongoose.isValidObjectId(assigneeId)) { res.status(400); throw new Error('Choose who to reassign this to'); }
  if (String(assigneeId) === String(assignment.assignee)) {
    res.status(400); throw new Error('That is already the current assignee');
  }

  const org = await Organization.findById(assignment.organization).select('_id name isActive');
  if (!org) { res.status(400); throw new Error('The college on this assignment no longer exists'); }

  const next = await User.findOne({
    _id: assigneeId, isActive: true, role: ROLES.USER,
    userType: { $in: [USER_TYPES.DESIGNER, USER_TYPES.SOCIAL_HANDLER] },
  }).select('name avatar email role userType handles organization');
  if (!next) { res.status(400); throw new Error('Selected assignee not found'); }
  assertAssignable(next, org, assignment.platform, res);

  // The previous person may already be deleted - that is a common reason to
  // reassign, so a missing record must not block it.
  const previous = await User.findById(assignment.assignee).select('name');

  assignment.reassignedFrom = assignment.assignee;
  assignment.reassignedAt = new Date();
  assignment.assignee = next._id;
  assignment.assigneeType = next.userType;
  // The new person starts fresh: they have not accepted it yet.
  assignment.status = 'OPEN';
  assignment.acknowledgedAt = undefined;
  assignment.submittedAt = undefined;
  assignment.completionNote = '';
  assignment.reviewNote = '';
  await assignment.save();

  await logActivity({
    user: req.user._id, organization: assignment.organization,
    action: ACTIVITY_ACTIONS.WORK_ASSIGNED,
    description: `Reassigned "${assignment.title}" from ${previous?.name || 'a removed user'} to ${next.name}`,
    entityType: 'WorkAssignment', entityId: assignment._id,
  });
  await createNotification({
    recipient: next._id, organization: assignment.organization,
    type: NOTIFICATION_TYPES.WORK_ASSIGNED,
    title: 'Work reassigned to you',
    message: `${req.user.name} moved "${assignment.title}" to you${assignment.platform ? ` for ${assignment.platform}` : ''}`,
    link: '/my-assigned-work', relatedRequest: assignment._id,
  });
  if (previous) {
    await createNotification({
      recipient: previous._id, organization: assignment.organization,
      type: NOTIFICATION_TYPES.WORK_REJECTED,
      title: 'Work moved to someone else',
      message: `${req.user.name} reassigned "${assignment.title}" to ${next.name}.`,
      link: '/my-assigned-work', relatedRequest: assignment._id,
    });
  }

  const populated = await populateAssignment(WorkAssignment.findById(assignment._id)).lean();
  res.json({ success: true, assignment: populated });
});

// @route PUT /api/work-assignments/:id/review — ADMIN signs off (or sends back) a
// completion request. Body: { action: 'approve' | 'reject', note }
// Approving is what marks the assignment DONE.
export const reviewAssignment = asyncHandler(async (req, res) => {
  const assignment = await WorkAssignment.findById(req.params.id);
  if (!assignment) { res.status(404); throw new Error('Assignment not found'); }
  // An Admin signs off work inside their own institutions only.
  if (!canAccessOrg(req.user, assignment.organization)) {
    res.status(403); throw new Error('This work belongs to an institution you do not have access to');
  }
  if (assignment.status !== 'SUBMITTED') {
    res.status(400); throw new Error('There is no completion request awaiting review on this work');
  }
  const action = req.body.action === 'reject' ? 'reject' : 'approve';
  const note = String(req.body.note || '').trim();
  if (action === 'reject' && !note) {
    res.status(400); throw new Error('Tell the assignee what still needs doing');
  }

  const assignee = await User.findById(assignment.assignee).select('name');
  assignment.reviewedBy = req.user._id;
  assignment.reviewedAt = new Date();
  assignment.reviewNote = action === 'reject' ? note : '';

  if (action === 'approve') {
    assignment.status = 'DONE';
    assignment.completedAt = new Date();
  } else {
    // Back to the assignee to finish off; their note is kept for context.
    assignment.status = 'ACKNOWLEDGED';
    assignment.submittedAt = undefined;
  }
  await assignment.save();

  await logActivity({
    user: req.user._id,
    organization: assignment.organization,
    action: action === 'approve' ? ACTIVITY_ACTIONS.WORK_COMPLETED : ACTIVITY_ACTIONS.WORK_SUBMITTED,
    description: action === 'approve'
      ? `Approved "${assignment.title}" — marked complete${assignee ? ` for ${assignee.name}` : ''}`
      : `Sent "${assignment.title}" back to ${assignee?.name || 'the assignee'}`,
    entityType: 'WorkAssignment',
    entityId: assignment._id,
  });

  // A social handler never acknowledges, so their linked request is still
  // waiting for allocation at this point — signing the work off answers it.
  if (action === 'approve') {
    await settleSourceRequest(assignment, req.user, `The work for "${assignment.title}" is complete`);
    await markSourceApprovalPosted(assignment, req.user);
  }

  await createNotification({
    recipient: assignment.assignee,
    organization: assignment.organization,
    type: action === 'approve' ? NOTIFICATION_TYPES.WORK_APPROVED : NOTIFICATION_TYPES.WORK_REJECTED,
    title: action === 'approve' ? 'Work approved and marked complete 🎉' : 'Assigned work sent back',
    message: action === 'approve'
      ? `${req.user.name} approved "${assignment.title}" — it's now marked as completed.`
      : `${req.user.name} sent "${assignment.title}" back: ${note}`,
    link: '/my-assigned-work',
    relatedRequest: assignment._id,
  });

  const populated = await populateAssignment(WorkAssignment.findById(assignment._id)).lean();
  res.json({ success: true, assignment: populated });
});

// Publishing is done the moment the handler says it is out. There is no note to
// write and nothing for an admin to sign off — the content was approved before
// it ever reached them, and asking "did you post it?" to be reviewed by someone
// else is a second opinion on a fact.
export const completePostingWork = async (assignment, actor, at = new Date()) => {
  assignment.status = 'DONE';
  assignment.completionNote = assignment.completionNote || 'Posted';
  assignment.submittedAt = assignment.submittedAt || at;
  assignment.reviewedBy = actor._id;
  assignment.reviewedAt = at;
  assignment.completedAt = at;
  assignment.scheduledAt = undefined;
  await assignment.save();

  await markSourceApprovalPosted(assignment, actor, at);
  await settleSourceRequest(assignment, actor, `"${assignment.title}" has been posted`);
  await logActivity({
    user: actor._id,
    organization: assignment.organization,
    action: ACTIVITY_ACTIONS.POST_COMPLETION,
    description: `Posted "${assignment.title}"${assignment.platform ? ` on ${assignment.platform}` : ''}`,
    entityType: 'WorkAssignment',
    entityId: assignment._id,
  });
  return assignment;
};

/**
 * The content going live closes the job that existed to publish it.
 *
 * Whichever side the click came from — the approval's own "mark as posted", or
 * the sweep publishing it at its scheduled minute — the posting job in the
 * handler's assigned work is the same piece of work, and leaving it open means
 * their list disagrees with the board about something already done.
 */
export const closePostingWorkForApproval = async (approvalId, actor, at = new Date()) => {
  if (!approvalId) return [];
  const closed = [];
  try {
    const jobs = await WorkAssignment.find({ sourceApproval: approvalId, status: { $ne: 'DONE' } });
    for (const job of jobs) {
      const owner = actor || await User.findById(job.assignee).select('name');
      await completePostingWork(job, owner || { _id: job.assignee, name: 'the assignee' }, at);
      closed.push(job._id);
    }
  } catch (err) {
    console.error('failed to close the posting work for a published approval:', err.message);
  }
  return closed;
};

// @route PUT /api/work-assignments/:id/posted — the handler says it is out, or
// says when it will be. Body: { scheduledAt?, postedAt? }
//
// `scheduledAt` books a future go-live. `postedAt` is the opposite end: work that
// is already out, closed against the moment it actually went out rather than the
// moment the handler got round to saying so.
export const markAssignmentPosted = asyncHandler(async (req, res) => {
  const assignment = await loadOwnAssignment(req, res);
  if (!assignment.postingFor && !assignment.sourceApproval) {
    res.status(400);
    throw new Error('This is not publishing work — send a completion request instead');
  }
  if (assignment.status === 'DONE') { res.status(400); throw new Error('This work is already complete'); }

  const raw = req.body.scheduledAt;
  if (raw) {
    const when = new Date(raw);
    if (Number.isNaN(when.getTime())) { res.status(400); throw new Error('That is not a valid date and time'); }
    if (when.getTime() < Date.now() - 60_000) { res.status(400); throw new Error('Pick a time in the future'); }
    assignment.scheduledAt = when;
    await assignment.save();
    // The content itself carries the same time, so the approval board and the
    // assignment close together rather than drifting apart.
    if (assignment.sourceApproval) {
      try {
        const design = await ApprovalRequest.findById(assignment.sourceApproval);
        if (design && design.status === APPROVAL_STATUS.APPROVED) {
          design.scheduledAt = when;
          design.scheduledBy = req.user._id;
          await design.save();
        }
      } catch (err) {
        console.error('failed to carry the go-live time onto the approval:', err.message);
      }
    }
  } else {
    const { when, error } = resolvePostedAt(req.body.postedAt);
    if (error) { res.status(400); throw new Error(error); }
    await completePostingWork(assignment, req.user, when);
  }

  const populated = await populateAssignment(WorkAssignment.findById(assignment._id)).lean();
  res.json({ success: true, assignment: populated });
});

// @route PUT /api/work-assignments/:id/handoff — where finished work goes next.
// Body: { target: 'SOCIAL_HANDLER' | 'COORDINATOR', assigneeIds, platform, note }
//
// Signing work off says it is good; this says what happens to it. Either a social
// handler publishes it — which is genuinely new work, so it becomes its own
// assignment for them to complete rather than a flag on this one — or it goes
// back to the coordinator who asked for it, which ends the chain.
export const handoffAssignment = asyncHandler(async (req, res) => {
  const assignment = await WorkAssignment.findById(req.params.id);
  if (!assignment) { res.status(404); throw new Error('Assignment not found'); }
  if (!canAccessOrg(req.user, assignment.organization)) {
    res.status(403); throw new Error('This work belongs to an institution you do not have access to');
  }
  if (assignment.status !== 'DONE') {
    res.status(400); throw new Error('Approve the completion request before deciding where the work goes');
  }
  // A social handler's work IS the publishing, so approving it is the end of the
  // line. Only a designer's output still has somewhere to go.
  if (assignment.assigneeType === USER_TYPES.SOCIAL_HANDLER) {
    res.status(400);
    throw new Error('This work has been published — there is nothing further to send it to');
  }
  if (assignment.handoff) {
    res.status(400);
    throw new Error(assignment.handoff === 'COORDINATOR'
      ? 'This work has already been delivered to the coordinator'
      : 'This work has already gone to a social handler to post');
  }

  const target = ['SOCIAL_HANDLER', 'COORDINATOR'].includes(req.body.target) ? req.body.target : '';
  if (!target) {
    res.status(400); throw new Error('Choose whether this goes to a social handler or back to the coordinator');
  }
  const note = String(req.body.note || '').trim();

  const org = await Organization.findById(assignment.organization).select('_id name isActive');
  if (!org) { res.status(400); throw new Error('The college on this assignment no longer exists'); }

  // Work allocated without picking a request off the queue has no idea which
  // college ask it serves, so nobody downstream can see what was wanted. Letting
  // the link be supplied here repairs that instead of stranding the handler.
  if (!assignment.sourceRequest && req.body.sourceRequest) {
    if (!mongoose.isValidObjectId(req.body.sourceRequest)) { res.status(400); throw new Error('Invalid college request'); }
    const linked = await InstitutionRequest.findById(req.body.sourceRequest).select('_id organization');
    if (!linked) { res.status(400); throw new Error('That college request no longer exists'); }
    if (!canAccessOrg(req.user, linked.organization)) {
      res.status(403); throw new Error('That request belongs to a college you do not have access to');
    }
    assignment.sourceRequest = linked._id;
  }

  if (target === 'SOCIAL_HANDLER') {
    const platform = String(req.body.platform || '').trim();
    if (!PLATFORMS.includes(platform)) {
      res.status(400); throw new Error('Choose the platform this should be posted on');
    }
    const ids = [...new Set(
      (Array.isArray(req.body.assigneeIds) ? req.body.assigneeIds : String(req.body.assigneeIds ?? '').split(','))
        .map((s) => String(s).trim()).filter(Boolean)
    )];
    if (!ids.length) { res.status(400); throw new Error('Choose at least one social handler to post this'); }
    if (ids.some((id) => !mongoose.isValidObjectId(id))) { res.status(400); throw new Error('Invalid social handler'); }

    // Everyone is checked before anything is created, so one bad pick cannot
    // leave half the posting work raised.
    const handlers = [];
    for (const id of ids) {
      const handler = await User.findOne({
        _id: id, isActive: true, role: ROLES.USER, userType: USER_TYPES.SOCIAL_HANDLER,
      }).select('name avatar email role userType handles organization');
      if (!handler) { res.status(400); throw new Error('One of the selected social handlers was not found'); }
      assertAssignable(handler, org, platform, res);
      handlers.push(handler);
    }

    // The handler is posting something they did not make, so what the designer
    // said they produced travels with it — otherwise they are publishing blind.
    const brief = [
      assignment.description,
      assignment.completionNote && `What was produced: ${assignment.completionNote}`,
      note,
    ].map((s) => String(s || '').trim()).filter(Boolean).join('\n\n');

    const allocationGroup = handlers.length > 1 ? new mongoose.Types.ObjectId() : null;
    const created = [];
    for (const handler of handlers) {
      const posting = await WorkAssignment.create({
        organization: org._id,
        title: `Post: ${assignment.title}`,
        description: brief,
        platform,
        urgency: assignment.urgency,
        assignee: handler._id,
        assigneeType: USER_TYPES.SOCIAL_HANDLER,
        allocationGroup,
        createdBy: req.user._id,
        sourceRequest: assignment.sourceRequest || null,
        postingFor: assignment._id,
      });
      created.push(posting._id);
      await createNotification({
        recipient: handler._id,
        organization: org._id,
        type: NOTIFICATION_TYPES.WORK_ASSIGNED,
        title: 'Approved work to post',
        message: `${req.user.name} sent you "${assignment.title}" to publish on ${platform}`,
        link: '/my-assigned-work',
        relatedRequest: posting._id,
      });
    }
    await notifyRequestOwnerOfAssignment({
      sourceRequestId: assignment.sourceRequest,
      organization: org._id,
      assigneeNames: handlers.map((handler) => handler.name),
      relatedRequest: created[0] || assignment._id,
    });
    assignment.handoffAssignments = created;

    await logActivity({
      user: req.user._id,
      organization: org._id,
      action: ACTIVITY_ACTIONS.WORK_ASSIGNED,
      description: `Sent "${assignment.title}" to ${handlers.map((h) => h.name).join(', ')} to post on ${platform}`,
      entityType: 'WorkAssignment',
      entityId: assignment._id,
    });
  } else {
    // Back to whoever asked for it: the coordinator who raised the college
    // request, or — for standalone work with no request behind it — whoever
    // handed the work out in the first place.
    let recipient = null;
    let link = '/requests';
    if (assignment.sourceRequest) {
      const instReq = await InstitutionRequest.findById(assignment.sourceRequest).select('_id raisedBy');
      if (instReq?.raisedBy) {
        recipient = instReq.raisedBy;
        link = `/requests?request=${instReq._id}`;
      }
    }
    if (!recipient) recipient = assignment.createdBy;
    if (!recipient) { res.status(400); throw new Error('There is nobody to hand this work back to'); }

    assignment.deliveredTo = recipient;
    await createNotification({
      recipient,
      organization: assignment.organization,
      type: NOTIFICATION_TYPES.CONTENT_DELIVERED,
      title: 'Your requested work is ready',
      message: `${req.user.name} delivered "${assignment.title}"${note ? ` — ${note}` : ''}`,
      link,
      relatedRequest: assignment._id,
    });

    await logActivity({
      user: req.user._id,
      organization: assignment.organization,
      action: ACTIVITY_ACTIONS.DESIGN_DELIVERED,
      description: `Delivered "${assignment.title}" back to the coordinator`,
      entityType: 'WorkAssignment',
      entityId: assignment._id,
    });
  }

  assignment.handoff = target;
  assignment.handoffAt = new Date();
  assignment.handoffBy = req.user._id;
  assignment.handoffNote = note;
  await assignment.save();

  const populated = await populateAssignment(WorkAssignment.findById(assignment._id)).lean();
  res.json({ success: true, assignment: populated });
});

// The same piece of work can go to several people. Each one gets their OWN
// assignment document, because status / acknowledgedAt / completedAt are per
// person — a single row shared by many assignees could not express "Asha is done
// but Ravi hasn't started".
const URGENCIES = ['LOW', 'NORMAL', 'HIGH', 'URGENT'];

export const createWorkAssignment = asyncHandler(async (req, res) => {
  const { title, description, organization, platform = '', urgency = 'NORMAL' } = req.body;
  const sourceRequestId = req.body.sourceRequest || null;
  // Accepts `assigneeIds` (array or comma-separated) or the legacy `assigneeId`.
  const ids = [...new Set(
    (Array.isArray(req.body.assigneeIds)
      ? req.body.assigneeIds
      : String(req.body.assigneeIds ?? req.body.assigneeId ?? '').split(','))
      .map((s) => String(s).trim()).filter(Boolean)
  )];

  if (!title || !String(title).trim()) { res.status(400); throw new Error('Title is required'); }
  if (!ids.length) { res.status(400); throw new Error('Please choose at least one assignee'); }
  if (platform && !PLATFORMS.includes(platform)) { res.status(400); throw new Error('Invalid platform'); }
  if (!URGENCIES.includes(urgency)) { res.status(400); throw new Error(`urgency must be one of ${URGENCIES.join(', ')}`); }
  if (ids.some((id) => !mongoose.isValidObjectId(id))) { res.status(400); throw new Error('Invalid assignee'); }

  let requestedOrg = null;
  if (organization) {
    requestedOrg = await Organization.findById(organization).select('_id isActive name');
    if (!requestedOrg || !requestedOrg.isActive) { res.status(400); throw new Error('Selected organization does not exist'); }
    // An Admin can only assign inside the institutions they were given; a
    // coordinator only inside their own college. canAccessOrg covers both, since a
    // USER's accessible set is exactly their own organization.
    if (!canAccessOrg(req.user, requestedOrg._id)) {
      res.status(403); throw new Error(`You do not have access to ${requestedOrg.name}`);
    }
  }
  // Nobody in the USER role assigns work — that includes a coordinator, who
  // raises a college request and lets the Admin allocate it rather than handing
  // work to a designer or handler directly.
  if (req.user.role === ROLES.USER) {
    res.status(403); throw new Error('Only an Admin or the super admin can assign work');
  }

  // Validate the linked college request when provided.
  let linkedRequest = null;
  if (sourceRequestId) {
    if (!mongoose.isValidObjectId(sourceRequestId)) { res.status(400); throw new Error('Invalid college request'); }
    linkedRequest = await InstitutionRequest.findById(sourceRequestId).select('_id title status organization raisedBy');
    if (!linkedRequest) { res.status(400); throw new Error('The selected college request no longer exists'); }
    if (linkedRequest.status !== 'GETTING_ALLOCATED') { res.status(400); throw new Error('Only approved coordinator work waiting for allocation can be linked to assigned work'); }
  }

  // Validate EVERY assignee before creating anything, so one bad pick can't
  // leave half the assignments made.
  const assignees = [];
  for (const id of ids) {
    const assignee = await User.findOne({
      _id: id,
      isActive: true,
      role: ROLES.USER,
      userType: { $in: [USER_TYPES.DESIGNER, USER_TYPES.SOCIAL_HANDLER] },
    }).select('name avatar email role userType handles organization');
    if (!assignee) { res.status(400); throw new Error('One of the selected assignees was not found'); }

    let assignmentOrg = requestedOrg;
    if (assignee.userType === USER_TYPES.SOCIAL_HANDLER) {
      if (!assignmentOrg) {
        res.status(400);
        throw new Error('Organization is required when assigning work to social handlers');
      }
      // A handler publishes to a specific channel, so the platform is required.
      // (A designer produces the creative, so no channel applies to them.)
      if (!platform) {
        res.status(400);
        throw new Error(`Choose the platform this is for — ${assignee.name} is a social handler`);
      }
      const handleMatch = Array.isArray(assignee.handles)
        && assignee.handles.some((h) => String(h.organization) === String(assignmentOrg._id)
          && (h.platforms || []).includes(platform));
      if (!handleMatch) {
        res.status(400);
        throw new Error(`${assignee.name} is not mapped to ${assignmentOrg.name} / ${platform}`);
      }
    } else {
      // Designers are one shared pool: an Admin or the super admin hands a brief
      // to whoever can draw it, whichever college they sit in. A coordinator is
      // still limited to their own college's designers.
      const sharedDesignerPool = [ROLES.ADMIN, ROLES.CEO].includes(req.user.role);
      const allowCrossOrgDesignerAllocation = !!linkedRequest || sharedDesignerPool;
      // The work belongs to the college that NEEDS it — the linked request's, or
      // the one picked — not to whichever college the designer happens to sit in.
      // Their own college is only the last resort, for an assigner who has none.
      if (!assignmentOrg) {
        const ownOrgId = linkedRequest?.organization
          || (sharedDesignerPool && (req.user.organization?._id || req.user.organization))
          || assignee.organization?._id
          || assignee.organization;
        if (!ownOrgId) {
          res.status(400);
          throw new Error(`${assignee.name} is not attached to an organization`);
        }
        assignmentOrg = await Organization.findById(ownOrgId).select('_id isActive name');
        if (!assignmentOrg || !assignmentOrg.isActive) {
          res.status(400);
          throw new Error(`${assignee.name} belongs to an inactive or missing organization`);
        }
      }
      if (!allowCrossOrgDesignerAllocation
          && String(assignee.organization || '')
          && String(assignee.organization) !== String(assignmentOrg._id)) {
        res.status(400);
        throw new Error(`${assignee.name} does not belong to ${assignmentOrg.name}`);
      }
    }

    if (!canAccessOrg(req.user, assignmentOrg._id)) {
      res.status(403);
      throw new Error(`You do not have access to ${assignmentOrg.name}`);
    }
    if (linkedRequest && assignee.userType !== USER_TYPES.DESIGNER && String(linkedRequest.organization) !== String(assignmentOrg._id)) {
      res.status(400);
      throw new Error('Linked approved work belongs to a different organization');
    }
    assignees.push({ assignee, assignmentOrg });
  }

  const allocationGroup = assignees.length > 1 ? new mongoose.Types.ObjectId() : null;
  const createdIds = [];
  for (const row of assignees) {
    const { assignee, assignmentOrg } = row;
    const assignment = await WorkAssignment.create({
      organization: assignmentOrg._id,
      title: String(title).trim(),
      description: String(description || '').trim(),
      // Only a social handler's work is tied to a channel.
      platform: assignee.userType === USER_TYPES.SOCIAL_HANDLER ? platform : '',
      urgency,
      assignee: assignee._id,
      assigneeType: assignee.userType,
      allocationGroup,
      createdBy: req.user._id,
      sourceRequest: linkedRequest ? linkedRequest._id : null,
    });
    createdIds.push(assignment._id);

    await logActivity({
      user: req.user._id,
      organization: assignmentOrg._id,
      action: ACTIVITY_ACTIONS.WORK_ASSIGNED,
      description: `Assigned work "${assignment.title}" to ${assignee.name}${platform ? ` for ${platform}` : ''}`,
      entityType: 'WorkAssignment',
      entityId: assignment._id,
    });

    await createNotification({
      recipient: assignee._id,
      organization: assignmentOrg._id,
      type: NOTIFICATION_TYPES.WORK_ASSIGNED,
      title: urgency === 'URGENT' || urgency === 'HIGH' ? `Work assigned to you (${urgency.toLowerCase()})` : 'Work assigned to you',
      message: `${req.user.name} assigned "${assignment.title}"${platform ? ` for ${platform}` : ''}${urgency !== 'NORMAL' ? ` — ${urgency.toLowerCase()} priority` : ''}`,
      // Opens the recipient's assigned-work list, not the notifications page.
      link: '/my-assigned-work',
      relatedRequest: assignment._id,
    });
  }

  // Designers have to acknowledge before anyone owns the work, so at this point
  // it has only been put in front of them — saying "assigned to X" here would be
  // wrong, and would repeat itself word for word once X actually accepted it.
  // A social handler has nothing to acknowledge, so for them this IS the moment.
  const allDesigners = assignees.every(({ assignee }) => assignee.userType === USER_TYPES.DESIGNER);
  await notifyRequestOwnerOfAssignment({
    sourceRequestId: linkedRequest?._id,
    organization: linkedRequest?.organization,
    assigneeNames: assignees.map(({ assignee }) => assignee.name),
    relatedRequest: createdIds[0] || linkedRequest?._id,
    ...(allDesigners ? {
      title: 'Your request is being allocated',
      describe: (list) => `Sent to ${list} to pick up`,
    } : {}),
  });

  const assignments = await populateAssignment(WorkAssignment.find({ _id: { $in: createdIds } }).sort({ createdAt: -1 })).lean();
  // `assignment` is kept for older clients that expected a single object.
  res.status(201).json({ success: true, count: assignments.length, assignments, assignment: assignments[0] || null });
});