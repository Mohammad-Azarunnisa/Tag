import asyncHandler from 'express-async-handler';
import mongoose from 'mongoose';
import InstitutionRequest, {
  INSTITUTION_REQUEST_CATEGORIES as CATEGORIES,
  INSTITUTION_REQUEST_PRIORITY as PRIORITIES,
} from '../models/InstitutionRequest.js';
import Organization from '../models/Organization.js';
import User from '../models/User.js';
import WorkAssignment from '../models/WorkAssignment.js';
import { createNotification } from '../utils/notify.js';
import { logActivity } from '../utils/logActivity.js';
import { accessibleOrgIds, canAccessOrg, resolveOrgId } from '../utils/org.js';
import { ROLES, USER_TYPES, ACTIVITY_ACTIONS, NOTIFICATION_TYPES } from '../config/constants.js';
import { uploadBuffer } from '../config/storage.js';
import { platformsForOrganization } from '../utils/platforms.js';

const isCoordinator = (user) => user?.role === ROLES.USER && user?.userType === USER_TYPES.COORDINATOR;

// find() casts id strings against the schema; an aggregate's $match does not, so
// the org filter has to be cast by hand or the counts pipeline silently matches
// nothing. The filter is either a single id or { $in: [...] } for an Admin
// holding several institutions.
const toObjectId = (v) => (mongoose.isValidObjectId(v) ? new mongoose.Types.ObjectId(String(v)) : v);
const castOrgFilter = (v) => (v && typeof v === 'object' && Array.isArray(v.$in)
  ? { $in: v.$in.map(toObjectId) }
  : toObjectId(v));

const populate = (query) =>
  query
    .populate('organization', 'name color logo')
    .populate('raisedBy', 'name avatar email jobTitle')
    .populate('reviewedBy', 'name avatar');

const attachAssignedUsers = async (requests) => {
  if (!requests.length) return requests;
  const requestIds = requests.map((request) => request._id);
  const assignments = await WorkAssignment.find({ sourceRequest: { $in: requestIds } })
    .select('sourceRequest assignee assigneeType status platform createdAt')
    .populate('assignee', 'name avatar')
    .sort({ createdAt: 1 })
    .lean();

  const byRequest = new Map();
  for (const assignment of assignments) {
    const key = String(assignment.sourceRequest);
    if (!byRequest.has(key)) byRequest.set(key, []);
    const seen = byRequest.get(key);
    const assigneeId = String(assignment.assignee?._id || assignment.assignee || '');
    if (!assigneeId || seen.some((row) => String(row._id) === assigneeId)) continue;
    seen.push({
      _id: assignment.assignee?._id || assignment.assignee,
      name: assignment.assignee?.name || 'Unknown user',
      avatar: assignment.assignee?.avatar || '',
      userType: assignment.assigneeType,
      status: assignment.status,
      platform: assignment.platform || '',
    });
  }

  return requests.map((request) => ({
    ...request,
    assignedUsers: byRequest.get(String(request._id)) || [],
  }));
};

// A new ask goes straight to the people who can start it. There is no admin or
// super-admin step in front of the work: the request lands on "Designs to be
// Done" the moment it is raised (workflowStage defaults to DESIGN_OPEN), so the
// designers are told, and they are told to look at that board.
//
// Every active designer hears about it, not just this college's — the design
// board is an open pool across all colleges (workflowController.listWorkflow
// puts no organization filter on a designer), so narrowing the notification
// would hide work they can actually pick up.
const notifyDesignPool = async ({ request, orgName, raisedBy }) => {
  const orgId = request.organization?._id || request.organization;
  const designers = await User.find({
    isActive: true, role: ROLES.USER, userType: USER_TYPES.DESIGNER,
  }).select('_id');

  const rushed = request.priority === 'URGENT' || request.priority === 'HIGH';
  await Promise.all(designers.map((d) => createNotification({
    recipient: d._id,
    organization: orgId,
    type: NOTIFICATION_TYPES.DESIGN_REQUESTED,
    title: rushed
      ? `Designs to be Done — ${request.priority.toLowerCase()}-priority work from ${orgName}`
      : 'New work on Designs to be Done',
    message: `${raisedBy.name} raised "${request.title}" for ${orgName} — open it to take it on`,
    link: '/workflow/designs',
    relatedRequest: request._id,
  })));
};

// A postOnly ask has nothing for a designer to do — it starts life already on
// "To Be Posted" — so it is the handlers who need telling, and only the ones who
// actually run the pages the coordinator picked. Mirrors the scoping
// workflowController uses when a design is accepted and handed to posting.
const notifyPostPool = async ({ request, orgName, raisedBy }) => {
  const orgId = request.organization?._id || request.organization;
  const handlers = await User.find({
    isActive: true,
    role: ROLES.USER,
    userType: USER_TYPES.SOCIAL_HANDLER,
    handles: { $elemMatch: { organization: orgId, platforms: { $in: request.postPlatforms } } },
  }).select('_id');

  const pages = (request.postPlatforms || []).join(', ');
  const rushed = request.priority === 'URGENT' || request.priority === 'HIGH';
  await Promise.all(handlers.map((h) => createNotification({
    recipient: h._id,
    organization: orgId,
    type: NOTIFICATION_TYPES.WORK_ASSIGNED,
    title: rushed
      ? `New work to post on ${pages} — ${request.priority.toLowerCase()}-priority`
      : `New work to post on ${pages}`,
    message: `${raisedBy.name} raised a ready-to-post request for ${orgName}: "${request.title}"`,
    link: '/workflow/to-be-posted',
    relatedRequest: request._id,
  })));
};

// @route GET /api/requests — scoped by who is asking.
// A coordinator sees their own college's requests; an Admin sees the
// institutions they hold; the super admin sees everything.
export const listInstitutionRequests = asyncHandler(async (req, res) => {
  const { status, category, priority, search, organizationId, from, to } = req.query;
  const query = {};

  const allowed = accessibleOrgIds(req.user);
  const asked = organizationId && organizationId !== 'All' ? organizationId : null;
  if (allowed !== null) {
    // A coordinator arrives already pinned to their own college by the auth
    // middleware, but scope is enforced here too — this endpoint must be safe on
    // its own terms.
    //
    // An Admin may hold several institutions, so their college filter has to
    // work. Narrowing is a view preference and never a way to widen: asking for
    // one they cannot access matches nothing rather than erroring, exactly as
    // the approvals and assigned-work lists behave.
    query.organization = asked
      ? (canAccessOrg(req.user, asked) ? asked : null)
      : { $in: allowed };
  } else if (asked) {
    query.organization = asked;
  }

  if (category && category !== 'All') query.category = category;
  if (priority && priority !== 'All') query.priority = priority;
  if (search) {
    const rx = { $regex: String(search), $options: 'i' };
    query.$or = [{ title: rx }, { details: rx }, { response: rx }];
  }
  // When the request was raised. Either bound works on its own; `to` covers the
  // whole of that day. Same shape as the approvals list so the two pages filter
  // by date identically.
  if (from || to) {
    query.createdAt = {};
    if (from) query.createdAt.$gte = new Date(from);
    if (to) query.createdAt.$lte = new Date(`${to}T23:59:59.999Z`);
  }

  // The list honours the status tab; the tile counts deliberately do not, so the
  // four numbers stay put while the user moves between tabs.
  const listQuery = (status && status !== 'All') ? { ...query, status } : query;
  const countsQuery = { ...query };
  if (countsQuery.organization) countsQuery.organization = castOrgFilter(countsQuery.organization);

  const [rawRequests, statusCounts] = await Promise.all([
    populate(InstitutionRequest.find(listQuery).sort({ createdAt: -1 })).lean(),
    InstitutionRequest.aggregate([
      { $match: countsQuery },
      { $group: { _id: '$status', count: { $sum: 1 } } },
    ]),
  ]);
  const requests = await attachAssignedUsers(rawRequests);

  const counts = {
    OPEN: 0, IN_REVIEW: 0, GETTING_ALLOCATED: 0, WITH_SOCIAL_HANDLER: 0, APPROVED: 0, DECLINED: 0,
  };
  statusCounts.forEach(({ _id, count }) => { if (counts[_id] !== undefined) counts[_id] = count; });

  res.json({ success: true, counts, categories: CATEGORIES, requests });
});

// @route POST /api/requests — a college asks for something. It is not sent to
// anyone for approval first: workflowStage defaults to DESIGN_OPEN, so it is on
// "Designs to be Done" as soon as it is saved and a designer can take it.
//
// A `postOnly` ask is the exception: the creative already exists — the college
// just needs it published — so there is nothing for a designer to do. It skips
// DESIGN_OPEN entirely and is saved straight onto "To Be Posted" instead.
export const createInstitutionRequest = asyncHandler(async (req, res) => {
  const { title, details, category = 'Other', priority = 'NORMAL', neededBy, postOnly, platforms } = req.body;
  const { workType = 'PRINT_MEDIA', workCategory = '', workItem = '', event = 'false', department = '', eventName = '', eventDate = '', place = '', eventCoordinatorName = '' } = req.body;
  const isPostOnly = postOnly === true || postOnly === 'true';
  // Ready-to-post content is always digital and always "Social Media" — that is
  // what makes needsPosting() (elsewhere in the pipeline) agree that this is
  // social work, and it is the only kind of ask with nothing left to design.
  const finalWorkType = isPostOnly ? 'DIGITAL_MEDIA' : (workType === 'DIGITAL_MEDIA' ? 'DIGITAL_MEDIA' : 'PRINT_MEDIA');
  const finalWorkCategory = isPostOnly ? 'Social Media' : workCategory;
  if (!finalWorkCategory || !workItem) { res.status(400); throw new Error('Pick the work category and specific work item'); }
  if (!department) { res.status(400); throw new Error('Department is required'); }
  const hasEvent = event === true || event === 'true';
  if (hasEvent) {
    if (!eventName || !place || !eventCoordinatorName || !eventDate) { res.status(400); throw new Error('Fill in the event details'); }
  }
  const finalTitle = String(title || `${finalWorkType === 'DIGITAL_MEDIA' ? 'Digital' : 'Print'} · ${finalWorkCategory} · ${workItem}`).trim();
  if (!CATEGORIES.includes(category)) { res.status(400); throw new Error(`category must be one of ${CATEGORIES.join(', ')}`); }
  if (!PRIORITIES.includes(priority)) { res.status(400); throw new Error(`priority must be one of ${PRIORITIES.join(', ')}`); }

  // There is no design step to produce the file here, so the coordinator has to
  // bring it, and has to say where it goes — a handler picking this up needs
  // both before there is anything for them to do.
  let chosenPlatforms = [];
  if (isPostOnly) {
    const attachmentCount = Array.isArray(req.files) ? req.files.length : 0;
    if (!attachmentCount) { res.status(400); throw new Error('Attach the ready-to-post file(s) before sending this to a handler'); }
    chosenPlatforms = [...new Set(
      (Array.isArray(platforms) ? platforms : String(platforms ?? '').split(','))
        .map((p) => String(p).trim())
        .filter(Boolean)
    )];
    if (!chosenPlatforms.length) { res.status(400); throw new Error('Choose at least one page for this to be posted on'); }
  }

  // A request is raised on behalf of a college, so it is always the requester's
  // own — resolveOrgId gives a USER their organization and cannot be overridden.
  const orgId = resolveOrgId(req);
  if (!orgId) { res.status(400); throw new Error('Your account is not attached to a college'); }
  if (!canAccessOrg(req.user, orgId)) { res.status(403); throw new Error('You cannot raise a request for that college'); }
  const org = await Organization.findById(orgId).select('_id name isActive');
  if (!org || !org.isActive) { res.status(400); throw new Error('That college does not exist'); }

  if (isPostOnly) {
    const available = await platformsForOrganization(org._id);
    const unknown = chosenPlatforms.filter((p) => !available.includes(p));
    if (unknown.length) { res.status(400); throw new Error(`Your college does not have ${unknown.join(', ')} set up`); }
  }

  let due;
  if (neededBy) {
    due = new Date(neededBy);
    if (Number.isNaN(due.getTime())) { res.status(400); throw new Error('That "needed by" date is not valid'); }
  }

  const created = await InstitutionRequest.create({
    organization: org._id,
    title: finalTitle,
    details: String(details || '').trim(),
    workType: finalWorkType,
    workCategory: String(finalWorkCategory).trim(),
    workItem: String(workItem).trim(),
    event: hasEvent,
    department: String(department).trim(),
    eventName: String(eventName || '').trim(),
    eventDate: hasEvent ? new Date(eventDate) : undefined,
    place: String(place || '').trim(),
    eventCoordinatorName: String(eventCoordinatorName || '').trim(),
    category,
    priority,
    neededBy: due,
    raisedBy: req.user._id,
    postOnly: isPostOnly,
    // Everything else starts on Designs to be Done, untouched. A postOnly ask
    // skips straight to the post half — the same stage and status a design
    // reaches once its coordinator has accepted it and handed it to posting.
    workflowStage: isPostOnly ? 'POST_OPEN' : 'DESIGN_OPEN',
    status: isPostOnly ? 'WITH_SOCIAL_HANDLER' : 'OPEN',
    postPlatforms: isPostOnly ? chosenPlatforms : [],
  });

  const attachments = Array.isArray(req.files) ? req.files : [];
  if (attachments.length) {
    const docs = [];
    for (const file of attachments) {
      const up = await uploadBuffer(file.buffer, { folder: 'requests', originalName: file.originalname });
      docs.push({
        url: up.url,
        publicId: up.publicId,
        name: file.originalname,
        fileSize: file.size,
        mediaType: file.mimetype?.startsWith('image/') ? 'image' : file.mimetype?.startsWith('video/') ? 'video' : 'document',
      });
    }
    created.attachments = docs;
    await created.save();
  }

  await logActivity({
    user: req.user._id, organization: org._id, action: ACTIVITY_ACTIONS.REQUEST_RAISED,
    description: `Raised a ${category.toLowerCase()} request: "${created.title}"`,
    entityType: 'InstitutionRequest', entityId: created._id,
  });
  if (isPostOnly) {
    await notifyPostPool({ request: created, orgName: org.name, raisedBy: req.user });
  } else {
    await notifyDesignPool({ request: created, orgName: org.name, raisedBy: req.user });
  }

  const [request] = await attachAssignedUsers([await populate(InstitutionRequest.findById(created._id)).lean()]);
  res.status(201).json({ success: true, request });
});

// There is no respond/decide endpoint on purpose. Nobody approves a college's
// request: it is on "Designs to be Done" from the moment it is raised, and the
// Admin and the super admin only read it. The `status`, `response`, `reviewedBy`
// and `reviewedAt` fields are kept on the model so requests decided under the
// old flow still render their history.

// @route DELETE /api/requests/:id — the person who raised it can withdraw it
// while it is still open; a super admin can remove any.
export const deleteInstitutionRequest = asyncHandler(async (req, res) => {
  const request = await InstitutionRequest.findById(req.params.id);
  if (!request) { res.status(404); throw new Error('Request not found'); }

  const mine = String(request.raisedBy) === String(req.user._id);
  if (!req.user.isSuperAdmin && !mine) {
    res.status(403); throw new Error('Only the person who raised this can withdraw it');
  }
  // A postOnly request starts at status WITH_SOCIAL_HANDLER — it has no design
  // half to sit OPEN through — so `status !== 'OPEN'` alone would block it from
  // ever being withdrawn, even the instant after it was raised. Its equivalent of
  // "still open" is workflowStage POST_OPEN: nobody has acknowledged it yet.
  const stillOpen = request.status === 'OPEN' || (request.postOnly && request.workflowStage === 'POST_OPEN');
  if (mine && !req.user.isSuperAdmin && !stillOpen) {
    res.status(400); throw new Error('It has already been picked up — talk to the admin instead of withdrawing it');
  }
  await request.deleteOne();
  res.json({ success: true, message: 'Request withdrawn' });
});
