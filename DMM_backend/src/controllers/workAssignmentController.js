import asyncHandler from 'express-async-handler';
import mongoose from 'mongoose';
import WorkAssignment from '../models/WorkAssignment.js';
import User from '../models/User.js';
import Organization from '../models/Organization.js';
import InstitutionRequest from '../models/InstitutionRequest.js';
import { ROLES, USER_TYPES, PLATFORMS, ACTIVITY_ACTIONS, NOTIFICATION_TYPES } from '../config/constants.js';
import { logActivity } from '../utils/logActivity.js';
import { createNotification } from '../utils/notify.js';
import { accessibleOrgIds, canAccessOrg } from '../utils/org.js';

// A coordinator hands work to their own college's people, so they are a creator
// here even though they are a USER. Everyone else in the USER role is an
// assignee, never an assigner.
const isCoordinator = (user) => user?.role === ROLES.USER && user?.userType === USER_TYPES.COORDINATOR;

const populateAssignment = (query) =>
  query
    .populate('organization', 'name color')
    .populate('assignee', 'name avatar email role userType handles organization')
    .populate('createdBy', 'name avatar email')
    .populate('sourceRequest', 'title status organization');

export const listWorkAssignments = asyncHandler(async (req, res) => {
  const { organization, assignee, status, search, from, to } = req.query;
  const query = {};
  if (isCoordinator(req.user)) {
    // What they handed out, plus anything else booked in their college - they
    // run the college, so its workload is theirs to see.
    query.organization = req.user.organization?._id || req.user.organization || null;
  } else if (req.user.role === ROLES.USER) {
    query.assignee = req.user._id;
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

const loadOwnAssignment = async (req, res) => {
  const assignment = await WorkAssignment.findById(req.params.id);
  if (!assignment) { res.status(404); throw new Error('Assignment not found'); }
  if (String(assignment.assignee) !== String(req.user._id)) {
    res.status(403); throw new Error('This work is not assigned to you');
  }
  return assignment;
};

// @route PUT /api/work-assignments/:id/acknowledge — the assignee accepts the work.
export const acknowledgeAssignment = asyncHandler(async (req, res) => {
  const assignment = await loadOwnAssignment(req, res);
  if (assignment.status !== 'OPEN') {
    res.status(400); throw new Error(`This work is already ${assignment.status.toLowerCase()}`);
  }
  assignment.status = 'ACKNOWLEDGED';
  assignment.acknowledgedAt = new Date();
  await assignment.save();

  // When the work was created from an IN_REVIEW college request, accepting it
  // means the admin is handling it — auto-advance the request to APPROVED.
  if (assignment.sourceRequest) {
    try {
      const instReq = await InstitutionRequest.findById(assignment.sourceRequest);
      if (instReq && instReq.status === 'IN_REVIEW') {
        instReq.status = 'APPROVED';
        instReq.reviewedBy = req.user._id;
        instReq.reviewedAt = new Date();
        instReq.response = instReq.response || `Work accepted and assigned to ${req.user.name}`;
        await instReq.save();
        await createNotification({
          recipient: instReq.raisedBy,
          organization: instReq.organization,
          type: NOTIFICATION_TYPES.REQUEST_APPROVED,
          title: 'Your request was approved',
          message: `${req.user.name} accepted the work for "${instReq.title}"`,
          link: `/requests?request=${instReq._id}`,
          relatedRequest: instReq._id,
        });
      }
    } catch (err) {
      console.error('acknowledge: failed to update linked institution request:', err.message);
    }
  }

  const populated = await populateAssignment(WorkAssignment.findById(assignment._id)).lean();
  res.json({ success: true, assignment: populated });
});

// @route PUT /api/work-assignments/:id/submit — the assignee raises a completion
// request for the super admin to sign off. Body: { note }
export const submitAssignment = asyncHandler(async (req, res) => {
  const assignment = await loadOwnAssignment(req, res);
  if (!['ACKNOWLEDGED', 'SUBMITTED'].includes(assignment.status)) {
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
  if (!organization) { res.status(400); throw new Error('Organization is required'); }
  if (!ids.length) { res.status(400); throw new Error('Please choose at least one assignee'); }
  if (platform && !PLATFORMS.includes(platform)) { res.status(400); throw new Error('Invalid platform'); }
  if (!URGENCIES.includes(urgency)) { res.status(400); throw new Error(`urgency must be one of ${URGENCIES.join(', ')}`); }
  if (ids.some((id) => !mongoose.isValidObjectId(id))) { res.status(400); throw new Error('Invalid assignee'); }

  const org = await Organization.findById(organization).select('_id isActive name');
  if (!org || !org.isActive) { res.status(400); throw new Error('Selected organization does not exist'); }
  // An Admin can only assign inside the institutions they were given; a
  // coordinator only inside their own college. canAccessOrg covers both, since a
  // USER's accessible set is exactly their own organization.
  if (!canAccessOrg(req.user, org._id)) {
    res.status(403); throw new Error(`You do not have access to ${org.name}`);
  }
  // A coordinator hands work to their own college's people. Everyone else in the
  // USER role receives work rather than giving it.
  if (req.user.role === ROLES.USER && !isCoordinator(req.user)) {
    res.status(403); throw new Error('Only a coordinator, an Admin or the super admin can assign work');
  }

  // Validate the linked college request when provided.
  let linkedRequest = null;
  if (sourceRequestId) {
    if (!mongoose.isValidObjectId(sourceRequestId)) { res.status(400); throw new Error('Invalid college request'); }
    linkedRequest = await InstitutionRequest.findById(sourceRequestId).select('_id title status organization');
    if (!linkedRequest) { res.status(400); throw new Error('The selected college request no longer exists'); }
    if (linkedRequest.status !== 'IN_REVIEW') { res.status(400); throw new Error('Only IN_REVIEW college requests can be linked to assigned work'); }
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

    if (assignee.userType !== USER_TYPES.SOCIAL_HANDLER && String(assignee.organization || '') && String(assignee.organization) !== String(org._id)) {
      res.status(400);
      throw new Error(`${assignee.name} does not belong to ${org.name}`);
    }

    if (assignee.userType === USER_TYPES.SOCIAL_HANDLER) {
      // A handler publishes to a specific channel, so the platform is required.
      // (A designer produces the creative, so no channel applies to them.)
      if (!platform) {
        res.status(400);
        throw new Error(`Choose the platform this is for — ${assignee.name} is a social handler`);
      }
      const handleMatch = Array.isArray(assignee.handles)
        && assignee.handles.some((h) => String(h.organization) === String(org._id)
          && (h.platforms || []).includes(platform));
      if (!handleMatch) {
        res.status(400);
        throw new Error(`${assignee.name} is not mapped to ${org.name} / ${platform}`);
      }
    }
    assignees.push(assignee);
  }

  const createdIds = [];
  for (const assignee of assignees) {
    const assignment = await WorkAssignment.create({
      organization: org._id,
      title: String(title).trim(),
      description: String(description || '').trim(),
      // Only a social handler's work is tied to a channel.
      platform: assignee.userType === USER_TYPES.SOCIAL_HANDLER ? platform : '',
      urgency,
      assignee: assignee._id,
      assigneeType: assignee.userType,
      createdBy: req.user._id,
      sourceRequest: linkedRequest ? linkedRequest._id : null,
    });
    createdIds.push(assignment._id);

    await logActivity({
      user: req.user._id,
      organization: org._id,
      action: ACTIVITY_ACTIONS.WORK_ASSIGNED,
      description: `Assigned work "${assignment.title}" to ${assignee.name}${platform ? ` for ${platform}` : ''}`,
      entityType: 'WorkAssignment',
      entityId: assignment._id,
    });

    await createNotification({
      recipient: assignee._id,
      organization: org._id,
      type: NOTIFICATION_TYPES.WORK_ASSIGNED,
      title: urgency === 'URGENT' || urgency === 'HIGH' ? `Work assigned to you (${urgency.toLowerCase()})` : 'Work assigned to you',
      message: `${req.user.name} assigned "${assignment.title}"${platform ? ` for ${platform}` : ''}${urgency !== 'NORMAL' ? ` — ${urgency.toLowerCase()} priority` : ''}`,
      // Opens the recipient's assigned-work list, not the notifications page.
      link: '/my-assigned-work',
      relatedRequest: assignment._id,
    });
  }

  const assignments = await populateAssignment(WorkAssignment.find({ _id: { $in: createdIds } }).sort({ createdAt: -1 })).lean();
  // `assignment` is kept for older clients that expected a single object.
  res.status(201).json({ success: true, count: assignments.length, assignments, assignment: assignments[0] || null });
});