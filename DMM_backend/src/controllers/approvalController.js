import mongoose from 'mongoose';
import asyncHandler from 'express-async-handler';
import ApprovalRequest from '../models/ApprovalRequest.js';
import ApprovalImage from '../models/ApprovalImage.js';
import ApprovalComment from '../models/ApprovalComment.js';
import { uploadBuffer, deleteFile } from '../config/storage.js';
import { logActivity } from '../utils/logActivity.js';
import { createNotification } from '../utils/notify.js';
import User from '../models/User.js';
import Organization from '../models/Organization.js';
import WorkAssignment from '../models/WorkAssignment.js';
import { requireOrgId, resolveOrgId, canAccessOrg, accessibleOrgIds } from '../utils/org.js';
import {
  APPROVAL_STATUS,
  APPROVAL_TYPES,
  ACTIVITY_ACTIONS,
  NOTIFICATION_TYPES,
  ROLES,
  USER_TYPES,
  PLATFORMS,
  FEEDBACK_CATEGORIES,
} from '../config/constants.js';

// Legacy requests predate the type field — anything without one is a POST.
const typeFilter = (type) =>
  type === APPROVAL_TYPES.DESIGN ? APPROVAL_TYPES.DESIGN : { $in: [APPROVAL_TYPES.POST, null] };

const parseHashtags = (raw) => {
  if (!raw) return [];
  if (Array.isArray(raw)) return raw;
  return String(raw)
    .split(/[,\s]+/)
    .map((h) => h.replace(/^#/, '').trim())
    .filter(Boolean);
};

// Notify everyone who can act on this request: every super admin, plus the
// Admin(s) over the college it belongs to - which includes an Admin holding it
// as one of several granted institutions.
const notifyApprovers = async (type, title, message, request) => {
  const orgId = request.organization?._id || request.organization || null;
  const recipients = await User.find({
    isActive: true,
    $or: [
      { isSuperAdmin: true },
      ...(orgId
        ? [{ role: ROLES.CEO, $or: [{ organization: orgId }, { managedOrganizations: orgId }] }]
        : []),
    ],
  }).select('_id');
  const seen = new Set();
  await Promise.all(
    recipients
      .filter((u) => { const k = String(u._id); if (seen.has(k)) return false; seen.add(k); return true; })
      .map((c) =>
        createNotification({
          recipient: c._id, organization: request.organization, type, title, message,
          link: `/approvals/${request._id}`, relatedRequest: request._id,
        })
      )
  );
};

const isSuperApprover = (user) => user?.role === ROLES.ADMIN && !!user?.isSuperAdmin;

// Who may sign a request off: the super admin anywhere, or an Admin (role CEO)
// inside one of the institutions they hold. Both decide on the same request, so
// this takes the request rather than just the user.
const canDecideOn = (user, request) =>
  isSuperApprover(user)
  || (user?.role === ROLES.CEO && canAccessOrg(user, request?.organization));

// The channels one request targets, from `platforms` (array / repeated form
// field / comma-separated) or the legacy single `platform`. Order is preserved
// (first = primary) and duplicates dropped.
const normalizePlatforms = (raw, res, { required = true } = {}) => {
  const list = (Array.isArray(raw) ? raw : String(raw ?? '').split(','))
    .map((p) => String(p).trim())
    .filter(Boolean);
  const unique = [...new Set(list)];
  if (!unique.length) {
    if (!required) return [];
    res.status(400); throw new Error('Pick at least one platform');
  }
  const bad = unique.filter((p) => !PLATFORMS.includes(p));
  if (bad.length) { res.status(400); throw new Error(`Unknown platform: ${bad.join(', ')}`); }
  return unique;
};

// An optional link to one of the submitter's own assigned tasks. Only work they
// have accepted (ACKNOWLEDGED) or already asked to be signed off (SUBMITTED) can
// be attached — never someone else's, and never a finished task.
const resolveWorkAssignment = async (raw, req, res) => {
  if (!raw) return null;
  if (!mongoose.isValidObjectId(raw)) { res.status(400); throw new Error('Invalid assigned work'); }
  const assignment = await WorkAssignment.findById(raw).select('assignee status title');
  if (!assignment) { res.status(400); throw new Error('That assigned work no longer exists'); }
  if (String(assignment.assignee) !== String(req.user._id)) {
    res.status(403); throw new Error('That work is not assigned to you');
  }
  if (!['ACKNOWLEDGED', 'SUBMITTED'].includes(assignment.status)) {
    res.status(400);
    throw new Error(assignment.status === 'OPEN'
      ? 'Acknowledge that assigned work before linking it to a request'
      : 'That assigned work is already complete');
  }
  return assignment._id;
};

// What kind of file this is, so the UI knows whether to render an <img>, a
// <video>, or a download tile. Anything that isn't an image or video (PDF,
// Office, Excel, CSV, PSD, AI …) is a document — it has no inline preview.
const DOC_EXTENSIONS = /\.(pdf|docx?|xlsx?|xls|csv|pptx?|ppt|psd|ai|eps|zip|rar|txt)$/i;
const mediaTypeOf = (file) => {
  const mime = file?.mimetype || '';
  if (mime.startsWith('video/')) return 'video';
  // PSD/AI often arrive as image/* or octet-stream — trust the extension first.
  if (DOC_EXTENSIONS.test(file?.originalname || '')) return 'document';
  if (mime.startsWith('image/')) return 'image';
  return 'document';
};

// The sizes a piece of work is needed in. Free-form strings (e.g. "1:1", "9:16")
// so a new ratio doesn't need a code change.
const normalizeRatios = (raw) => [...new Set(
  (Array.isArray(raw) ? raw : String(raw ?? '').split(','))
    .map((r) => String(r).trim()).filter(Boolean)
)];

// Every channel a request targets, tolerating legacy single-platform documents.
const platformsOf = (doc) => (doc?.platforms?.length ? doc.platforms : (doc?.platform ? [doc.platform] : []));
// " on LinkedIn, Instagram" — or nothing at all for a brief with no channel yet.
const onChannels = (doc) => {
  const list = platformsOf(doc);
  return list.length ? ` on ${list.join(', ')}` : '';
};
const isCoordinator = (user) => user?.role === ROLES.USER && user?.userType === USER_TYPES.COORDINATOR;

const isForwardedHandler = (request, userId) =>
  Array.isArray(request.forwardedHandlers) && request.forwardedHandlers.some((id) => String(id) === String(userId));

// Access guard for a single request:
//  - ADMIN / Super Admin: any organization (global).
//  - The request's creator (the coordinator, for a design brief): their own
//    request, in ANY organization (users work across the shared workspace).
//  - The designer assigned to a design brief.
//  - The social handler allocated/forwarded an approved design (may sit in another org).
//  - CEO ("Admin" of an org): requests targeting their own organization.
const assertOrgAccess = (req, res, request) => {
  // Callers pass either a raw doc or one with populated refs, so compare ids
  // rather than whatever shape the field happens to be in.
  const idOf = (v) => String(v?._id || v || '');
  const me = String(req.user._id);
  if (req.user.role === ROLES.ADMIN) return;
  if (idOf(request.createdBy) === me) return;
  if (request.designer && idOf(request.designer) === me) return;
  if (request.assignedTo && idOf(request.assignedTo) === me) return;
  if (isForwardedHandler(request, req.user._id)) return;
  // An Admin may hold several institutions, so membership is checked against all
  // of them - resolveOrgId would only ever name one. A request with no college
  // can't match this way; the checks above are what grant access to it.
  if (request.organization && canAccessOrg(req.user, request.organization)) return;
  res.status(404); throw new Error('Request not found');
};

// Aggregation pipelines don't auto-cast strings to ObjectIds the way find()
// does, so id filters coming from query params need an explicit cast.
const toObjectId = (v) => (mongoose.isValidObjectId(v) ? new mongoose.Types.ObjectId(String(v)) : v);

// The organization filter is either a single id or { $in: [...] } when an Admin
// holds several institutions. An aggregate matches neither as raw strings, so
// both shapes have to be cast.
const castOrgFilter = (v) => (v && typeof v === 'object' && Array.isArray(v.$in)
  ? { $in: v.$in.map(toObjectId) }
  : toObjectId(v));

// Attach images (from approvalImages collection) to a list of plain request objects.
const attachImages = async (requests) => {
  if (!requests.length) return requests;
  const ids = requests.map((r) => r._id);
  const images = await ApprovalImage.find({ request: { $in: ids } }).sort({ order: 1 }).lean();
  const byReq = images.reduce((acc, img) => {
    (acc[img.request] = acc[img.request] || []).push(img);
    return acc;
  }, {});
  return requests.map((r) => ({ ...r, images: byReq[r._id] || [] }));
};

// Best-effort activity-feed write. The status transition is already persisted
// when these run, so a failed feed row must never fail the whole request.
const recordFeed = async (docs) => {
  try { await ApprovalComment.insertMany(Array.isArray(docs) ? docs : [docs]); }
  catch (err) { console.error('approval feed error:', err.message); }
};

// @route GET /api/approvals  — CEO sees their org, USER sees own, ADMIN sees
// ALL organizations (head of all orgs). Supports filters.
export const getApprovals = asyncHandler(async (req, res) => {
  const { status, type, platform, search, user, from, to, page = 1, limit = 12 } = req.query;
  const query = {};
  const and = [];
  // ADMIN / Super Admin span every organization (optional ?organizationId narrows).
  // CEO ("Admin") sees every request targeting their own organization.
  // USER sees their own requests across ALL organizations they submitted to,
  // PLUS any approved designs assigned to them for publishing.
  if (req.user.role === ROLES.ADMIN) {
    if (req.query.organizationId) query.organization = req.query.organizationId;
    if (user) query.createdBy = user;
  } else if (req.user.role === ROLES.CEO) {
    // An Admin may hold several institutions - show all of them together by
    // default, and honour ?organizationId when they narrow to one of theirs.
    // Asking for a college that isn't theirs returns nothing rather than
    // quietly falling back to everything, which would look like the filter had
    // been ignored.
    const allowed = accessibleOrgIds(req.user);
    const asked = req.query.organizationId;
    if (asked) query.organization = canAccessOrg(req.user, asked) ? asked : null;
    else query.organization = { $in: allowed };
    if (user) query.createdBy = user;
  } else {
    and.push({ $or: [{ createdBy: req.user._id }, { designer: req.user._id }, { assignedTo: req.user._id }, { forwardedHandlers: req.user._id }] });
    if (req.query.organizationId) query.organization = req.query.organizationId;
  }

  // Match multi-platform requests as well as legacy single-platform ones.
  if (platform && platform !== 'All') and.push({ $or: [{ platforms: platform }, { platform }] });
  if (search) and.push({
    $or: [
      { title: { $regex: search, $options: 'i' } },
      { caption: { $regex: search, $options: 'i' } },
    ],
  });
  if (from || to) {
    query.createdAt = {};
    if (from) query.createdAt.$gte = new Date(from);
    if (to) query.createdAt.$lte = new Date(`${to}T23:59:59.999Z`);
  }
  if (and.length) query.$and = and;

  // Per-status tab counts use the SAME scope minus the status filter, so the
  // numbers stay stable while the user switches tabs. Ids must be cast for
  // the aggregate (see toObjectId).
  const countsQuery = { ...query };
  if (countsQuery.organization) countsQuery.organization = castOrgFilter(countsQuery.organization);
  if (countsQuery.createdBy) countsQuery.createdBy = toObjectId(countsQuery.createdBy);

  // "REVIEW" is a convenience filter for everything awaiting a decision.
  if (status === 'REVIEW') query.status = { $in: [APPROVAL_STATUS.PENDING, APPROVAL_STATUS.RESUBMITTED] };
  else if (status && status !== 'All') query.status = status;
  if (type) query.type = typeFilter(type);

  const skip = (Number(page) - 1) * Number(limit);
  const [items, total, statusCounts, typeCountsAgg] = await Promise.all([
    ApprovalRequest.find(query)
      .populate('createdBy', 'name avatar email')
      .populate('assignedTo', 'name avatar')
      .populate('organization', 'name color')
      .sort({ createdAt: -1 }).skip(skip).limit(Number(limit)).lean(),
    ApprovalRequest.countDocuments(query),
    // Status tab counts, scoped to the current type view when one is selected.
    ApprovalRequest.aggregate([
      { $match: type ? { ...countsQuery, type: typeFilter(type) } : countsQuery },
      { $group: { _id: '$status', count: { $sum: 1 } } },
    ]),
    // Post/Design sub-tab badges: same scope, ignoring both status and type.
    ApprovalRequest.aggregate([
      { $match: countsQuery },
      { $group: { _id: { $ifNull: ['$type', APPROVAL_TYPES.POST] }, count: { $sum: 1 } } },
    ]),
  ]);
  const counts = { ALL: 0 };
  Object.values(APPROVAL_STATUS).forEach((s) => { counts[s] = 0; });
  statusCounts.forEach(({ _id, count }) => {
    if (counts[_id] !== undefined) counts[_id] = count;
    counts.ALL += count;
  });
  const typeCounts = { [APPROVAL_TYPES.POST]: 0, [APPROVAL_TYPES.DESIGN]: 0 };
  typeCountsAgg.forEach(({ _id, count }) => { if (typeCounts[_id] !== undefined) typeCounts[_id] += count; });
  const withImages = await attachImages(items);
  res.json({ success: true, total, page: Number(page), pages: Math.ceil(total / limit), counts, typeCounts, requests: withImages });
});

// @route GET /api/approvals/:id
export const getApproval = asyncHandler(async (req, res) => {
  const reqDoc = await ApprovalRequest.findById(req.params.id)
    .populate('createdBy', 'name avatar email')
    .populate('designer', 'name avatar email')
    .populate('approvedBy', 'name')
    .populate('postedBy', 'name')
    .populate('deliveredBy', 'name')
    .populate('assignedTo', 'name avatar email')
    .populate('assignedBy', 'name')
    .populate('forwardedBy', 'name')
    .populate('forwardedTargets.organization', 'name color')
    .populate('forwardedTargets.handlers', 'name avatar email')
    .populate('linkedPost', 'title status type')
    .populate({ path: 'workAssignment', select: 'title status platform organization createdBy completionNote', populate: [{ path: 'organization', select: 'name color' }, { path: 'createdBy', select: 'name' }] })
    .populate('sourceDesign', 'title status type')
    .populate('organization', 'name color')
    .populate('reviews.reviewedBy', 'name avatar')
    .lean();
  if (!reqDoc) { res.status(404); throw new Error('Request not found'); }
  assertOrgAccess(req, res, {
    ...reqDoc,
    organization: reqDoc.organization?._id || reqDoc.organization,
    designer: reqDoc.designer?._id || reqDoc.designer,
    assignedTo: reqDoc.assignedTo?._id || reqDoc.assignedTo,
  });
  const privileged = [ROLES.ADMIN, ROLES.CEO].includes(req.user.role);
  const isAssignee = reqDoc.assignedTo && String(reqDoc.assignedTo._id || reqDoc.assignedTo) === String(req.user._id);
  const isDesigner = reqDoc.designer && String(reqDoc.designer._id || reqDoc.designer) === String(req.user._id);
  const isFwd = isForwardedHandler({ forwardedHandlers: reqDoc.forwardedHandlers }, req.user._id);
  if (!privileged && !isAssignee && !isDesigner && !isFwd && String(reqDoc.createdBy._id) !== String(req.user._id)) {
    res.status(403); throw new Error('Not allowed to view this request');
  }
  const [images, comments] = await Promise.all([
    ApprovalImage.find({ request: reqDoc._id }).sort({ order: 1 }).lean(),
    // _id tiebreaker keeps same-millisecond rows (reject event + its feedback batch) in insert order.
    ApprovalComment.find({ request: reqDoc._id }).populate('author', 'name avatar').sort({ createdAt: 1, _id: 1 }).lean(),
  ]);
  res.json({ success: true, request: { ...reqDoc, images, comments } });
});

// @route PUT /api/approvals/:id/claim  (designer)
// The first designer to accept a pending design takes ownership; everyone else
// sees it as in progress and gets a notification that it is already claimed.
export const claimDesignRequest = asyncHandler(async (req, res) => {
  const request = await ApprovalRequest.findById(req.params.id);
  if (!request) { res.status(404); throw new Error('Request not found'); }
  assertOrgAccess(req, res, request);
  const isDesignType = request.type === APPROVAL_TYPES.DESIGN;
  const isOpenPost = request.openForDesigners && request.status === APPROVAL_STATUS.APPROVED;
  if (!isDesignType && !isOpenPost) { res.status(400); throw new Error('Only design requests can be claimed'); }
  if (isDesignType && request.status !== APPROVAL_STATUS.PENDING) { res.status(400); throw new Error('This work is no longer available to claim'); }
  if (!isOpenPost && request.designer) { res.status(409); throw new Error('This work has already been claimed'); }
  if (isOpenPost && request.designer) { res.status(409); throw new Error('Another designer has already accepted this work'); }
  if (req.user.role !== ROLES.USER || req.user.userType !== USER_TYPES.DESIGNER) {
    res.status(403); throw new Error('Only designers can claim design work');
  }

  request.designer = req.user._id;
  request.claimedAt = new Date();
  // Design briefs move to IN_DESIGN; open-for-designer POST requests stay APPROVED.
  if (isDesignType) request.status = APPROVAL_STATUS.IN_DESIGN;
  await request.save();

  const designers = await User.find({
    isActive: true,
    role: ROLES.USER,
    userType: USER_TYPES.DESIGNER,
    organization: request.organization,
  }).select('_id');
  const others = designers.filter((d) => String(d._id) !== String(req.user._id));

  await Promise.all(others.map((d) => createNotification({
    recipient: d._id,
    organization: request.organization,
    type: NOTIFICATION_TYPES.DESIGN_IN_PROGRESS,
    title: 'Work already in progress',
    message: `${req.user.name} accepted "${request.title}"`,
    link: `/approvals/${request._id}`,
    relatedRequest: request._id,
  })));

  await createNotification({
    recipient: request.createdBy,
    organization: request.organization,
    type: NOTIFICATION_TYPES.DESIGN_IN_PROGRESS,
    title: 'Your work is in progress',
    message: `${req.user.name} accepted "${request.title}"`,
    link: `/approvals/${request._id}`,
    relatedRequest: request._id,
  });

  logActivity({ user: req.user._id, organization: request.organization, action: ACTIVITY_ACTIONS.DESIGN_ASSIGNED, description: `Claimed design work "${request.title}"`, entityType: 'ApprovalRequest', entityId: request._id });
  res.json({ success: true, request });
});

// @route POST /api/approvals
// DESIGN → a coordinator raises a brief and picks the designer (status IN_DESIGN).
// POST   → standalone ready-to-publish content submitted for approval (status PENDING).
export const createApproval = asyncHandler(async (req, res) => {
  const { title, caption, description, hashtags, order, aspectRatio, organization, type, sourceDesign, designer, deliveryMode } = req.body;
  // One post can target several channels. Accepts `platforms` as a repeated
  // form field, an array, or a comma-separated string; falls back to the legacy
  // single `platform`. The first one chosen becomes the primary.
  const reqType = type === APPROVAL_TYPES.DESIGN ? APPROVAL_TYPES.DESIGN : APPROVAL_TYPES.POST;
  // A design brief carries no channel and no post copy — the publisher decides
  // those on the POST raised from the approved design. A designer submitting
  // artwork is in the same position, so they aren't asked for a channel either.
  const isBrief = reqType === APPROVAL_TYPES.DESIGN;
  const submitterIsDesigner = req.user.role === ROLES.USER && req.user.userType === USER_TYPES.DESIGNER;
  const artworkOnly = isBrief || submitterIsDesigner;
  const platforms = normalizePlatforms(req.body.platforms ?? req.body.platform, res, { required: !artworkOnly });
  const platform = platforms[0];
  const ratios = normalizeRatios(req.body.aspectRatios ?? req.body.aspectRatio);
  const workAssignment = await resolveWorkAssignment(req.body.workAssignment, req, res);
  if (!title) { res.status(400); throw new Error(artworkOnly ? 'Title is required' : 'Title and platform are required'); }

  // Anyone can submit a request for ANY organization: the target comes from the
  // form, falling back to the submitter's own college when they leave it blank.
  // Every request must belong to a college — only the CHANNEL is optional for
  // a designer, because whoever publishes the work decides that.
  // A coordinator works for one college, so a request they raise is always for
  // it - the form's value is ignored rather than trusted.
  const orgId = isCoordinator(req.user) ? resolveOrgId(req) : (organization || resolveOrgId(req));
  if (!orgId) { res.status(400); throw new Error('Please choose the organization this is for'); }
  const org = await Organization.findById(orgId).select('_id isActive');
  if (!org || !org.isActive) { res.status(400); throw new Error('Selected organization does not exist'); }

  // ---------- DESIGN brief: coordinator raises it and picks the designer ----------
  if (reqType === APPROVAL_TYPES.DESIGN) {
    const canRaise = isCoordinator(req.user) || [ROLES.ADMIN, ROLES.CEO].includes(req.user.role);
    if (!canRaise) { res.status(403); throw new Error('Only coordinators can raise design requests'); }

    const chosen = await User.findOne({ _id: designer, isActive: true, role: ROLES.USER, userType: USER_TYPES.DESIGNER }).select('name');
    if (!chosen) { res.status(400); throw new Error('Please choose a designer to work on this brief'); }

    const request = await ApprovalRequest.create({
      organization: orgId,
      title, workAssignment,
      // No channel, caption or hashtags on a brief — those belong to the post.
      platform: platform || undefined,
      platforms: platforms.length ? platforms : undefined,
      description,
      type: APPROVAL_TYPES.DESIGN,
      aspectRatio: ratios[0] || '',
      aspectRatios: ratios.length ? ratios : undefined,
      hashtags: [],
      deliveryMode: deliveryMode === 'PRINT' ? 'PRINT' : 'DIGITAL',
      designer: chosen._id,
      status: APPROVAL_STATUS.IN_DESIGN,
      createdBy: req.user._id,
    });

    // Anything the coordinator attaches is reference material for the designer.
    const refFiles = req.files || [];
    const refDocs = [];
    for (let i = 0; i < refFiles.length; i++) {
      const f = refFiles[i];
      const up = await uploadBuffer(f.buffer, { folder: 'approvals', originalName: f.originalname });
      const mediaType = mediaTypeOf(f);
      refDocs.push({ request: request._id, url: up.url, publicId: up.publicId, mediaType, name: f.originalname, fileSize: f.size, kind: 'reference', order: i });
    }
    if (refDocs.length) await ApprovalImage.insertMany(refDocs);
    request.imageCount = refDocs.length;
    await request.save();

    logActivity({ user: req.user._id, organization: orgId, action: ACTIVITY_ACTIONS.DESIGN_REQUESTED, description: `Raised design brief "${title}" for ${chosen.name}`, entityType: 'ApprovalRequest', entityId: request._id });
    await recordFeed({ request: request._id, kind: 'event', author: req.user._id, text: `raised this design brief and assigned it to ${chosen.name}` });
    await createNotification({
      recipient: chosen._id, organization: orgId, type: NOTIFICATION_TYPES.DESIGN_REQUESTED,
      title: 'New design brief assigned to you', message: `${req.user.name} asked you to design "${title}"${platforms.length ? ` for ${platforms.join(", ")}` : ''}`,
      link: `/approvals/${request._id}`, relatedRequest: request._id,
    });
    // The people who will sign it off hear about it now, not only once the
    // designer submits - a coordinator raises the brief for them.
    await notifyApprovers(
      NOTIFICATION_TYPES.DESIGN_REQUESTED,
      'New design brief raised',
      `${req.user.name} raised "${title}" for ${chosen.name}`,
      request
    );

    const images = await ApprovalImage.find({ request: request._id }).sort({ order: 1 }).lean();
    res.status(201).json({ success: true, request: { ...request.toObject(), images } });
    return;
  }

  // ---------- POST: standalone content (optionally raised from an approved design) ----------
  // A POST raised from an approved design: verify the link and the assignee.
  let design = null;
  if (reqType === APPROVAL_TYPES.POST && sourceDesign) {
    design = await ApprovalRequest.findById(sourceDesign);
    if (!design || design.type !== APPROVAL_TYPES.DESIGN) { res.status(400); throw new Error('Source design not found'); }
    if (design.status !== APPROVAL_STATUS.APPROVED) { res.status(400); throw new Error('The source design is not approved yet'); }
    if (design.linkedPost) { res.status(400); throw new Error('A post request already exists for this design'); }
    const isAssignee = design.assignedTo && String(design.assignedTo) === String(req.user._id);
    const isForwarded = isForwardedHandler(design, req.user._id);
    if (!isAssignee && !isForwarded && ![ROLES.ADMIN, ROLES.CEO].includes(req.user.role)) {
      res.status(403); throw new Error('This design is not assigned to you');
    }

    // Social handlers can only raise posts for org/platform pairs forwarded to
    // them — and must be assigned EVERY platform they picked, not just one.
    if (req.user.role === ROLES.USER && req.user.userType === USER_TYPES.SOCIAL_HANDLER && Array.isArray(design.forwardedTargets)) {
      const missing = platforms.filter((p) => !design.forwardedTargets.some((t) =>
        String(t.organization) === String(orgId)
        && t.platform === p
        && (t.handlers || []).some((h) => String(h) === String(req.user._id))
      ));
      if (missing.length) {
        res.status(403);
        throw new Error(`You are not assigned to publish this design on ${missing.join(', ')} for the selected organization`);
      }
    }
  }

  const request = await ApprovalRequest.create({
    title, caption, description, workAssignment,
    organization: orgId || undefined,
    platform: platform || undefined,
    platforms: platforms.length ? platforms : undefined,
    type: reqType,
    sourceDesign: design ? design._id : null,
    aspectRatio: ratios[0] || '',
    aspectRatios: ratios.length ? ratios : undefined,
    hashtags: parseHashtags(hashtags),
    status: APPROVAL_STATUS.PENDING,
    createdBy: req.user._id,
  });

  if (design) {
    design.linkedPost = request._id;
    await design.save();
    await recordFeed({ request: design._id, kind: 'event', author: req.user._id, text: `created the post request "${title}" from this design` });
  }

  // `order` (optional) is a parallel array of indices matching the uploaded files,
  // letting the client control gallery order. Falls back to upload order.
  const orderArr = Array.isArray(order) ? order.map(Number) : null;
  const files = req.files || [];
  const imageDocs = [];
  for (let i = 0; i < files.length; i++) {
    const f = files[i];
    const up = await uploadBuffer(f.buffer, { folder: 'approvals', originalName: f.originalname });
    const mediaType = mediaTypeOf(f);
    imageDocs.push({ request: request._id, url: up.url, publicId: up.publicId, mediaType, name: f.originalname, fileSize: f.size, order: orderArr?.[i] ?? i });
  }
  if (imageDocs.length) await ApprovalImage.insertMany(imageDocs);
  request.imageCount = imageDocs.length;
  await request.save();

  const kindLabel = reqType === APPROVAL_TYPES.DESIGN ? 'design' : 'post';
  logActivity({ user: req.user._id, organization: orgId, action: ACTIVITY_ACTIONS.APPROVAL_SUBMISSION, description: `Submitted ${kindLabel} approval request "${title}"`, entityType: 'ApprovalRequest', entityId: request._id });
  await notifyApprovers(NOTIFICATION_TYPES.NEW_REQUEST, `New ${kindLabel} approval request`, `${req.user.name} submitted "${title}"`, request);

  const images = await ApprovalImage.find({ request: request._id }).sort({ order: 1 }).lean();
  res.status(201).json({ success: true, request: { ...request.toObject(), images } });
});

// @route PUT /api/approvals/:id/submit-design  (assigned designer)
// The designer uploads the finished design and submits the brief for approval
// (status IN_DESIGN → PENDING).
export const submitDesign = asyncHandler(async (req, res) => {
  const request = await ApprovalRequest.findById(req.params.id);
  if (!request) { res.status(404); throw new Error('Request not found'); }
  assertOrgAccess(req, res, request);
  if (request.type !== APPROVAL_TYPES.DESIGN) { res.status(400); throw new Error('Only design briefs are submitted this way'); }
  if (!request.designer || String(request.designer) !== String(req.user._id)) {
    res.status(403); throw new Error('This brief is not assigned to you');
  }
  if (request.status !== APPROVAL_STATUS.IN_DESIGN) {
    res.status(400); throw new Error('This brief is not awaiting a first submission');
  }

  const { caption, description, hashtags, aspectRatio, order } = req.body;
  if (caption !== undefined) request.caption = caption;
  if (description !== undefined) request.description = description;
  if (hashtags !== undefined) request.hashtags = parseHashtags(hashtags);
  if (req.body.aspectRatios !== undefined || aspectRatio !== undefined) {
    const ratios = normalizeRatios(req.body.aspectRatios ?? aspectRatio);
    request.aspectRatios = ratios.length ? ratios : undefined;
    request.aspectRatio = ratios[0] || '';
  }

  // Append the finished design as 'final' media (reference material is untouched).
  const existingFinal = await ApprovalImage.countDocuments({ request: request._id, kind: 'final' });
  const orderArr = Array.isArray(order) ? order.map(Number) : null;
  const files = req.files || [];
  const docs = [];
  for (let i = 0; i < files.length; i++) {
    const f = files[i];
    const up = await uploadBuffer(f.buffer, { folder: 'approvals', originalName: f.originalname });
    const mediaType = mediaTypeOf(f);
    docs.push({ request: request._id, url: up.url, publicId: up.publicId, mediaType, name: f.originalname, fileSize: f.size, kind: 'final', order: orderArr?.[i] ?? existingFinal + i });
  }
  if (docs.length) await ApprovalImage.insertMany(docs);
  const finalCount = await ApprovalImage.countDocuments({ request: request._id, kind: 'final' });
  if (finalCount === 0) { res.status(400); throw new Error('Upload the finished design before submitting'); }

  request.imageCount = await ApprovalImage.countDocuments({ request: request._id });
  request.status = APPROVAL_STATUS.PENDING;
  request.submittedAt = new Date();
  await request.save();

  await recordFeed({ request: request._id, kind: 'event', author: req.user._id, text: 'submitted the finished design for approval' });
  logActivity({ user: req.user._id, organization: request.organization, action: ACTIVITY_ACTIONS.DESIGN_SUBMITTED, description: `Submitted design "${request.title}" for approval`, entityType: 'ApprovalRequest', entityId: request._id });
  await notifyApprovers(NOTIFICATION_TYPES.DESIGN_SUBMITTED, 'Design ready for approval', `${req.user.name} submitted "${request.title}"`, request);
  // Keep the coordinator in the loop that their brief has been worked on.
  await createNotification({
    recipient: request.createdBy, organization: request.organization, type: NOTIFICATION_TYPES.DESIGN_SUBMITTED,
    title: 'Your design is in review', message: `${req.user.name} submitted the design for "${request.title}"`,
    link: `/approvals/${request._id}`, relatedRequest: request._id,
  });

  const images = await ApprovalImage.find({ request: request._id }).sort({ order: 1 }).lean();
  res.json({ success: true, request: { ...request.toObject(), images } });
});

// @route PUT /api/approvals/:id/approve  (super admin)
export const approveRequest = asyncHandler(async (req, res) => {
  const request = await ApprovalRequest.findById(req.params.id);
  if (!request) { res.status(404); throw new Error('Request not found'); }
  assertOrgAccess(req, res, request);
  if (!canDecideOn(req.user, request)) {
    res.status(403); throw new Error('Only the super admin or the Admin over this institution can approve requests');
  }

  const { routeTo, targetOrganizationId, targetPlatforms } = req.body;

  if (routeTo === 'DESIGNER') {
    request.openForDesigners = true;
  } else if (routeTo === 'SOCIAL_HANDLER') {
    if (!targetOrganizationId) { res.status(400); throw new Error('Select an organization for social handler routing'); }
    const platforms = Array.isArray(targetPlatforms) ? targetPlatforms : (targetPlatforms ? String(targetPlatforms).split(',').map((s) => s.trim()) : []);
    if (!platforms.length) { res.status(400); throw new Error('Select at least one platform for social handler routing'); }
    const bad = platforms.filter((p) => !PLATFORMS.includes(p));
    if (bad.length) { res.status(400); throw new Error(`Unknown platform: ${bad.join(', ')}`); }
    const org = await Organization.findOne({ _id: targetOrganizationId, isActive: true }).select('_id name');
    if (!org) { res.status(400); throw new Error('Selected organization not found'); }

    // Find every handler who covers this org, then partition per platform in JS.
    const handlerDocs = await User.find({
      isActive: true, role: ROLES.USER, userType: USER_TYPES.SOCIAL_HANDLER,
      handles: { $elemMatch: { organization: org._id } },
    }).select('_id handles');

    const normalized = [];
    const uniqueHandlers = new Set();
    for (const platform of platforms) {
      const pHandlers = handlerDocs.filter((h) =>
        (h.handles || []).some((hnd) =>
          String(hnd.organization) === String(org._id) &&
          (Array.isArray(hnd.platforms) ? hnd.platforms.includes(platform) : hnd.platforms === platform)
        )
      );
      pHandlers.forEach((h) => uniqueHandlers.add(String(h._id)));
      normalized.push({ organization: org._id, platform, handlers: pHandlers.map((h) => h._id) });
    }

    request.forwardedTargets = normalized;
    request.forwardedHandlers = Array.from(uniqueHandlers);
    request.forwardedBy = req.user._id;
    request.forwardedAt = new Date();
  }

  request.status = APPROVAL_STATUS.APPROVED;
  request.approvedAt = new Date();
  request.approvedBy = req.user._id;
  await request.save();

  await recordFeed({ request: request._id, kind: 'event', author: req.user._id, text: 'approved this request' });

  logActivity({ user: req.user._id, organization: request.organization, action: ACTIVITY_ACTIONS.APPROVAL_APPROVED, description: `Approved "${request.title}"`, entityType: 'ApprovalRequest', entityId: request._id });
  await createNotification({
    recipient: request.createdBy, organization: request.organization, type: NOTIFICATION_TYPES.CONTENT_APPROVED,
    title: 'Content approved', message: `Your request "${request.title}" was approved`,
    link: `/approvals/${request._id}`, relatedRequest: request._id,
  });
  if (request.type === APPROVAL_TYPES.DESIGN && request.designer && String(request.designer) !== String(request.createdBy)) {
    await createNotification({
      recipient: request.designer, organization: request.organization, type: NOTIFICATION_TYPES.CONTENT_APPROVED,
      title: 'Your design was approved', message: `"${request.title}" was approved`,
      link: `/approvals/${request._id}`, relatedRequest: request._id,
    });
  }

  // Notify all active designers when the admin routes the work to the designer pool.
  if (routeTo === 'DESIGNER') {
    const designers = await User.find({ isActive: true, role: ROLES.USER, userType: USER_TYPES.DESIGNER }).select('_id');
    await Promise.all(designers.map((d) =>
      createNotification({
        recipient: d._id, organization: request.organization, type: NOTIFICATION_TYPES.DESIGN_REQUESTED,
        title: 'New design work available', message: `"${request.title}" is open — accept it to start working`,
        link: `/approvals/${request._id}`, relatedRequest: request._id,
      })
    ));
  }

  // Notify all social handlers when the admin routes the work to them.
  if (routeTo === 'SOCIAL_HANDLER' && request.forwardedHandlers?.length) {
    await Promise.all(request.forwardedHandlers.map((id) =>
      createNotification({
        recipient: id, organization: request.organization, type: NOTIFICATION_TYPES.CONTENT_FORWARDED,
        title: 'Approved work routed to you', message: `${req.user.name} routed "${request.title}" for publishing`,
        link: `/approvals/${request._id}`, relatedRequest: request._id,
      })
    ));
  }

  await completeLinkedAssignment(request, req.user);

  res.json({ success: true, request });
});

// Approving a request that was submitted against an assigned task marks the task
// complete. Best-effort: the approval itself is already saved, so a failure here
// must never fail the response.
const completeLinkedAssignment = async (request, approver) => {
  if (!request.workAssignment) return;
  try {
    const assignment = await WorkAssignment.findById(request.workAssignment);
    if (!assignment || assignment.status === 'DONE') return; // nothing to do / already closed

    assignment.status = 'DONE';
    assignment.completedAt = new Date();
    assignment.reviewedBy = approver._id;
    assignment.reviewedAt = new Date();
    assignment.reviewNote = '';
    await assignment.save();

    await logActivity({
      user: approver._id,
      organization: assignment.organization,
      action: ACTIVITY_ACTIONS.WORK_COMPLETED,
      description: `Approved "${request.title}" — marked the linked assigned work "${assignment.title}" complete`,
      entityType: 'WorkAssignment',
      entityId: assignment._id,
    });
    await createNotification({
      recipient: assignment.assignee,
      organization: assignment.organization,
      type: NOTIFICATION_TYPES.WORK_APPROVED,
      title: 'Assigned work marked complete 🎉',
      message: `${approver.name} approved "${request.title}", so "${assignment.title}" is now complete.`,
      link: '/my-assigned-work',
      relatedRequest: assignment._id,
    });
  } catch (err) {
    console.error('completeLinkedAssignment error:', err.message);
  }
};

// @route PUT /api/approvals/:id/reject  (CEO) — body: { feedbackPoints: [] }
export const rejectRequest = asyncHandler(async (req, res) => {
  const request = await ApprovalRequest.findById(req.params.id);
  if (!request) { res.status(404); throw new Error('Request not found'); }
  assertOrgAccess(req, res, request);
  if (!canDecideOn(req.user, request)) {
    res.status(403); throw new Error('Only the super admin or the Admin over this institution can request changes');
  }

  // Each feedback point can be a plain string (legacy) or { text, category },
  // where category says what to change: Image | Content | Other | Reject.
  const feedbackPoints = (req.body.feedbackPoints || [])
    .map((p) => {
      const text = String(typeof p === 'string' ? p : p?.text || '').trim();
      const category = FEEDBACK_CATEGORIES.includes(p?.category) ? p.category : 'Other';
      return { text, category };
    })
    .filter((p) => p.text);
  if (feedbackPoints.length === 0) { res.status(400); throw new Error('At least one feedback point is required'); }

  const reviewRound = request.reviews.length + 1;
  request.status = APPROVAL_STATUS.REJECTED;
  request.rejectedAt = new Date();
  request.reviews.push({ reviewedBy: req.user._id, feedbackPoints });
  await request.save();

  // Durable status-change marker, then each feedback point, into the
  // approvalComments collection (the event precedes its feedback rows).
  await recordFeed({ request: request._id, kind: 'event', author: req.user._id, text: 'requested changes', reviewRound });
  await recordFeed(
    feedbackPoints.map((p) => ({ request: request._id, kind: 'feedback', text: p.text, category: p.category, author: req.user._id, reviewRound }))
  );

  logActivity({ user: req.user._id, organization: request.organization, action: ACTIVITY_ACTIONS.APPROVAL_REJECTED, description: `Rejected "${request.title}"`, entityType: 'ApprovalRequest', entityId: request._id });
  await createNotification({
    recipient: request.createdBy, organization: request.organization, type: NOTIFICATION_TYPES.CONTENT_REJECTED,
    title: 'Content needs revision', message: `Your request "${request.title}" was rejected with ${feedbackPoints.length} note(s)`,
    link: `/approvals/${request._id}`, relatedRequest: request._id,
  });
  res.json({ success: true, request });
});

// @route PUT /api/approvals/:id/resubmit  (owner) — update content + images, status RESUBMITTED
export const resubmitRequest = asyncHandler(async (req, res) => {
  const request = await ApprovalRequest.findById(req.params.id);
  if (!request) { res.status(404); throw new Error('Request not found'); }
  assertOrgAccess(req, res, request);
  // A rejected DESIGN is fixed by its assigned designer; a rejected POST by its owner.
  const canResubmit = request.type === APPROVAL_TYPES.DESIGN
    ? (request.designer && String(request.designer) === String(req.user._id))
    : String(request.createdBy) === String(req.user._id);
  if (!canResubmit) { res.status(403); throw new Error('Not allowed'); }
  if (request.status !== APPROVAL_STATUS.REJECTED) { res.status(400); throw new Error('Only rejected requests can be resubmitted'); }

  const { title, caption, description, hashtags, keepImageIds, order } = req.body;
  if (title) request.title = title;
  if (caption !== undefined) request.caption = caption;
  if (description !== undefined) request.description = description;
  if (hashtags !== undefined) request.hashtags = parseHashtags(hashtags);

  // Remove dropped images on resubmit — but never the coordinator's reference material.
  if (keepImageIds !== undefined) {
    const keep = Array.isArray(keepImageIds) ? keepImageIds : keepImageIds ? [keepImageIds] : [];
    const removed = await ApprovalImage.find({ request: request._id, kind: { $ne: 'reference' }, _id: { $nin: keep } });
    await Promise.all(removed.map((img) => deleteFile(img.publicId)));
    await ApprovalImage.deleteMany({ request: request._id, kind: { $ne: 'reference' }, _id: { $nin: keep } });
    // Re-apply order to kept images (preserves drag order from the client)
    const keepOrder = Array.isArray(order) ? order : null;
    if (keepOrder) {
      await Promise.all(keep.map((id, i) => ApprovalImage.updateOne({ _id: id }, { order: Number(keepOrder[i] ?? i) })));
    }
  }
  // Append any newly uploaded images after the kept ones
  const existingCount = await ApprovalImage.countDocuments({ request: request._id });
  const files = req.files || [];
  const newDocs = [];
  for (let i = 0; i < files.length; i++) {
    const f = files[i];
    const up = await uploadBuffer(f.buffer, { folder: 'approvals', originalName: f.originalname });
    const mediaType = mediaTypeOf(f);
    newDocs.push({ request: request._id, url: up.url, publicId: up.publicId, mediaType, name: f.originalname, fileSize: f.size, order: existingCount + i });
  }
  if (newDocs.length) await ApprovalImage.insertMany(newDocs);

  request.imageCount = await ApprovalImage.countDocuments({ request: request._id });
  request.status = APPROVAL_STATUS.RESUBMITTED;
  request.resubmittedAt = new Date();
  request.resubmitCount += 1;
  await request.save();

  // Durable status-change marker in the request's activity feed.
  await recordFeed({ request: request._id, kind: 'event', author: req.user._id, text: 'resubmitted with updates' });

  logActivity({ user: req.user._id, organization: request.organization, action: ACTIVITY_ACTIONS.APPROVAL_RESUBMITTED, description: `Resubmitted "${request.title}"`, entityType: 'ApprovalRequest', entityId: request._id });
  await notifyApprovers(NOTIFICATION_TYPES.CONTENT_RESUBMITTED, 'Content resubmitted', `${req.user.name} resubmitted "${request.title}"`, request);

  res.json({ success: true, request });
});

// @route PUT /api/approvals/:id/schedule  - body: { scheduledAt }
// Once content is approved the publisher says WHEN it goes out. A sweep flips it
// to POSTED at that moment (services/scheduledPosts.js), so nobody has to be at
// their desk for it.
export const scheduleRequest = asyncHandler(async (req, res) => {
  const request = await ApprovalRequest.findById(req.params.id);
  if (!request) { res.status(404); throw new Error('Request not found'); }
  assertOrgAccess(req, res, request);

  const isOwner = String(request.createdBy) === String(req.user._id);
  const isHandler = request.assignedTo && String(request.assignedTo) === String(req.user._id);
  // Whoever can approve can also set the go-live time - otherwise an Admin who
  // signed a post off would have to hand it back for scheduling.
  if (!isOwner && !isHandler && !canDecideOn(req.user, request)) {
    res.status(403); throw new Error('Not allowed to schedule this post');
  }
  if (request.status !== APPROVAL_STATUS.APPROVED) {
    res.status(400); throw new Error('Only approved content can be scheduled');
  }

  const raw = req.body.scheduledAt;
  if (!raw) { res.status(400); throw new Error('Pick the date and time this goes live'); }
  const when = new Date(raw);
  if (Number.isNaN(when.getTime())) { res.status(400); throw new Error('That is not a valid date and time'); }
  if (when.getTime() < Date.now() - 60_000) {
    res.status(400); throw new Error('Pick a time in the future');
  }

  request.scheduledAt = when;
  request.scheduledBy = req.user._id;
  await request.save();

  await recordFeed({
    request: request._id, kind: 'event', author: req.user._id,
    text: `scheduled this to go live on ${when.toISOString().slice(0, 16).replace('T', ' ')} UTC${onChannels(request)}`,
  });

  // Tell the people who care that it is booked in.
  const recipients = new Set([String(request.createdBy)]);
  if (request.assignedTo) recipients.add(String(request.assignedTo));
  recipients.delete(String(req.user._id));
  await Promise.all([...recipients].map((id) => createNotification({
    recipient: id, organization: request.organization,
    type: NOTIFICATION_TYPES.POST_SCHEDULED,
    title: 'Post scheduled',
    message: `${req.user.name} scheduled "${request.title}" for ${when.toISOString().slice(0, 16).replace('T', ' ')} UTC${onChannels(request)}`,
    link: `/approvals/${request._id}`, relatedRequest: request._id,
  })));

  res.json({ success: true, request });
});

// @route PUT /api/approvals/:id/posted  (owner) — mark as posted
export const markPosted = asyncHandler(async (req, res) => {
  const request = await ApprovalRequest.findById(req.params.id);
  if (!request) { res.status(404); throw new Error('Request not found'); }
  assertOrgAccess(req, res, request);
  // A DESIGN is posted by the social handler it was allocated to (or a super
  // admin); a standalone POST is marked posted by its owner.
  const isOwner = String(request.createdBy) === String(req.user._id);
  const isHandler = request.assignedTo && String(request.assignedTo) === String(req.user._id);
  if (request.type === APPROVAL_TYPES.DESIGN) {
    if (!isHandler && !isSuperApprover(req.user)) { res.status(403); throw new Error('Only the allocated social handler can mark this design as posted'); }
  } else if (!isOwner && !isSuperApprover(req.user)) {
    // The owner normally closes their own post, but the super admin can too —
    // approving does not close a request, marking it posted does.
    res.status(403); throw new Error('Not allowed');
  }
  if (request.status !== APPROVAL_STATUS.APPROVED) { res.status(400); throw new Error('Only approved content can be marked as posted'); }

  request.status = APPROVAL_STATUS.POSTED;
  request.postedAt = new Date();
  request.postedBy = req.user._id;
  await request.save();

  // Durable status-change marker in the request's activity feed.
  await recordFeed({ request: request._id, kind: 'event', author: req.user._id, text: `marked as posted on ${platformsOf(request).join(", ")}` });

  // Publishing the post completes its source design's lifecycle too.
  if (request.sourceDesign) {
    const design = await ApprovalRequest.findById(request.sourceDesign);
    if (design && design.status !== APPROVAL_STATUS.POSTED) {
      design.status = APPROVAL_STATUS.POSTED;
      design.postedAt = request.postedAt;
      design.postedBy = req.user._id;
      await design.save();
      await recordFeed({ request: design._id, kind: 'event', author: req.user._id, text: `the linked post went live on ${platformsOf(request).join(", ")}` });
    }
  }

  logActivity({ user: req.user._id, organization: request.organization, action: ACTIVITY_ACTIONS.POST_COMPLETION, description: `Marked "${request.title}" as posted`, entityType: 'ApprovalRequest', entityId: request._id });
  await notifyApprovers(NOTIFICATION_TYPES.CONTENT_POSTED, 'Content posted', `${req.user.name} posted "${request.title}" on ${platformsOf(request).join(", ")}`, request);
  // Tell the coordinator who raised the brief that their design is now live.
  if (request.type === APPROVAL_TYPES.DESIGN && String(request.createdBy) !== String(req.user._id)) {
    await createNotification({
      recipient: request.createdBy, organization: request.organization, type: NOTIFICATION_TYPES.CONTENT_POSTED,
      title: 'Your design is live', message: `"${request.title}" was posted on ${platformsOf(request).join(", ")}`,
      link: `/approvals/${request._id}`, relatedRequest: request._id,
    });
  }

  res.json({ success: true, request });
});

// @route PUT /api/approvals/:id/assign  (super admin) — POST ROUTE.
// Allocate an approved design to a social-media handler who will post it.
// Body: { userId }. Re-allocation is allowed until the design is posted.
export const assignRequest = asyncHandler(async (req, res) => {
  if (!isSuperApprover(req.user)) { res.status(403); throw new Error('Only super admin can allocate designs'); }
  const request = await ApprovalRequest.findById(req.params.id);
  if (!request) { res.status(404); throw new Error('Request not found'); }
  assertOrgAccess(req, res, request);
  if (request.type !== APPROVAL_TYPES.DESIGN) { res.status(400); throw new Error('Only design requests can be allocated'); }
  if (request.status !== APPROVAL_STATUS.APPROVED) { res.status(400); throw new Error('Approve the design before allocating it'); }

  const assignee = await User.findOne({ _id: req.body.userId, isActive: true, role: ROLES.USER, userType: USER_TYPES.SOCIAL_HANDLER }).select('name');
  if (!assignee) { res.status(400); throw new Error('Choose an active social-media handler'); }

  request.assignedTo = assignee._id;
  request.assignedBy = req.user._id;
  request.assignedAt = new Date();
  request.deliveryMode = 'DIGITAL'; // allocated for posting
  await request.save();

  await recordFeed({ request: request._id, kind: 'event', author: req.user._id, text: `allocated this design to ${assignee.name} to publish${onChannels(request)}` });
  logActivity({ user: req.user._id, organization: request.organization, action: ACTIVITY_ACTIONS.DESIGN_ASSIGNED, description: `Allocated design "${request.title}" to ${assignee.name}`, entityType: 'ApprovalRequest', entityId: request._id });
  await createNotification({
    recipient: assignee._id, organization: request.organization, type: NOTIFICATION_TYPES.DESIGN_ASSIGNED,
    title: 'Design allocated to you to post', message: `${req.user.name} allocated "${request.title}" — publish it${onChannels(request)} and mark it posted`,
    link: `/approvals/${request._id}`, relatedRequest: request._id,
  });

  const populated = await ApprovalRequest.findById(request._id)
    .populate('assignedTo', 'name avatar email')
    .populate('assignedBy', 'name')
    .lean();
  res.json({ success: true, request: populated });
});

// @route PUT /api/approvals/:id/deliver  (super admin) — DELIVER ROUTE.
// Deliver an approved design back to the coordinator who raised the brief
// (no social posting needed). Terminal state DELIVERED.
export const deliverToCoordinator = asyncHandler(async (req, res) => {
  if (!isSuperApprover(req.user)) { res.status(403); throw new Error('Only super admin can deliver designs'); }
  const request = await ApprovalRequest.findById(req.params.id);
  if (!request) { res.status(404); throw new Error('Request not found'); }
  assertOrgAccess(req, res, request);
  if (request.type !== APPROVAL_TYPES.DESIGN) { res.status(400); throw new Error('Only design requests can be delivered'); }
  if (request.status !== APPROVAL_STATUS.APPROVED) { res.status(400); throw new Error('Approve the design before delivering it'); }

  request.status = APPROVAL_STATUS.DELIVERED;
  request.deliveredAt = new Date();
  request.deliveredBy = req.user._id;
  request.deliveryMode = 'PRINT'; // delivered as a copy, not posted
  // Delivery is the non-post route — clear any prior handler allocation.
  request.assignedTo = null;
  request.assignedBy = null;
  request.assignedAt = undefined;
  await request.save();

  await recordFeed({ request: request._id, kind: 'event', author: req.user._id, text: 'delivered the final design to the coordinator' });
  logActivity({ user: req.user._id, organization: request.organization, action: ACTIVITY_ACTIONS.DESIGN_DELIVERED, description: `Delivered design "${request.title}" to the coordinator`, entityType: 'ApprovalRequest', entityId: request._id });
  await createNotification({
    recipient: request.createdBy, organization: request.organization, type: NOTIFICATION_TYPES.CONTENT_DELIVERED,
    title: 'Your design is ready', message: `"${request.title}" has been approved and delivered — you can download it now`,
    link: `/approvals/${request._id}`, relatedRequest: request._id,
  });
  res.json({ success: true, request });
});

// @route PUT /api/approvals/:id/forward  (super admin)
// Body: { targets: [{ organization, platform, handlerIds: [] }] }
export const forwardRequest = asyncHandler(async (req, res) => {
  if (!isSuperApprover(req.user)) { res.status(403); throw new Error('Only super admin can forward approved designs'); }

  const request = await ApprovalRequest.findById(req.params.id);
  if (!request) { res.status(404); throw new Error('Request not found'); }
  assertOrgAccess(req, res, request);
  if (request.type !== APPROVAL_TYPES.DESIGN) { res.status(400); throw new Error('Only design requests can be forwarded'); }
  if (request.status !== APPROVAL_STATUS.APPROVED) { res.status(400); throw new Error('Approve the design before forwarding'); }

  const rawTargets = Array.isArray(req.body.targets) ? req.body.targets : [];
  if (!rawTargets.length) { res.status(400); throw new Error('At least one target organization/platform is required'); }

  const normalized = [];
  const uniqueHandlers = new Set();
  for (const t of rawTargets) {
    if (!t?.organization || !t?.platform || !PLATFORMS.includes(t.platform)) {
      res.status(400);
      throw new Error('Each target requires a valid organization and platform');
    }
    const org = await Organization.findOne({ _id: t.organization, isActive: true }).select('_id');
    if (!org) { res.status(400); throw new Error('One or more selected organizations are invalid'); }

    const handlerIds = Array.isArray(t.handlerIds) ? [...new Set(t.handlerIds.map(String))] : [];
    if (!handlerIds.length) { res.status(400); throw new Error('Each target must include at least one social handler'); }

    const handlers = await User.find({
      _id: { $in: handlerIds },
      isActive: true,
      role: ROLES.USER,
      userType: USER_TYPES.SOCIAL_HANDLER,
      handles: { $elemMatch: { organization: org._id, platforms: t.platform } },
    }).select('_id name');
    if (handlers.length !== handlerIds.length) {
      res.status(400);
      throw new Error('Some selected handlers are not mapped to the target organization/platform');
    }

    handlers.forEach((h) => uniqueHandlers.add(String(h._id)));
    normalized.push({ organization: org._id, platform: t.platform, handlers: handlers.map((h) => h._id) });
  }

  request.deliveryMode = 'DIGITAL';
  request.forwardedTargets = normalized;
  request.forwardedHandlers = Array.from(uniqueHandlers);
  request.forwardedBy = req.user._id;
  request.forwardedAt = new Date();
  await request.save();

  await recordFeed({ request: request._id, kind: 'event', author: req.user._id, text: `forwarded this approved design to ${uniqueHandlers.size} social handler(s)` });
  logActivity({
    user: req.user._id,
    organization: request.organization,
    action: ACTIVITY_ACTIONS.DESIGN_FORWARDED,
    description: `Forwarded design "${request.title}" to social handlers`,
    entityType: 'ApprovalRequest',
    entityId: request._id,
  });

  await Promise.all(
    Array.from(uniqueHandlers).map((id) =>
      createNotification({
        recipient: id,
        organization: request.organization,
        type: NOTIFICATION_TYPES.CONTENT_FORWARDED,
        title: 'Approved design forwarded to you',
        message: `${req.user.name} forwarded "${request.title}" for publishing preparation`,
        link: `/approvals/${request._id}`,
        relatedRequest: request._id,
      })
    )
  );

  const populated = await ApprovalRequest.findById(request._id)
    .populate('forwardedTargets.organization', 'name color')
    .populate('forwardedTargets.handlers', 'name avatar email')
    .lean();
  res.json({ success: true, request: populated });
});

// @route POST /api/approvals/:id/comments  — chat message on the request's
// activity feed, with optional image/video attachments (multipart 'files').
// Visible-to = can-comment: the request owner, ADMIN, or the org's CEO.
export const addComment = asyncHandler(async (req, res) => {
  const request = await ApprovalRequest.findById(req.params.id);
  if (!request) { res.status(404); throw new Error('Request not found'); }
  assertOrgAccess(req, res, request);
  const privileged = [ROLES.ADMIN, ROLES.CEO].includes(req.user.role);
  const isOwner = String(request.createdBy) === String(req.user._id);
  const isForwarded = isForwardedHandler(request, req.user._id);
  const isDesigner = request.designer && String(request.designer) === String(req.user._id);
  const isHandler = request.assignedTo && String(request.assignedTo) === String(req.user._id);
  if (!privileged && !isOwner && !isForwarded && !isDesigner && !isHandler) { res.status(403); throw new Error('Not allowed to comment on this request'); }

  const text = String(req.body.text || '').trim();
  const files = req.files || [];
  if (!text && files.length === 0) { res.status(400); throw new Error('Write a message or attach a file'); }
  // The shared upload middleware also allows docs/sheets — chat renders media only.
  if (files.some((f) => !/^(image|video)\//.test(f.mimetype || ''))) {
    res.status(400); throw new Error('Only image and video attachments are allowed');
  }

  const attachments = [];
  try {
    for (const f of files) {
      const up = await uploadBuffer(f.buffer, { folder: 'approvals', originalName: f.originalname });
      const mediaType = mediaTypeOf(f);
      attachments.push({ url: up.url, publicId: up.publicId, mediaType, name: f.originalname });
    }
  } catch (err) {
    // A mid-loop failure must not orphan the files that already reached storage.
    await Promise.all(attachments.map((a) => deleteFile(a.publicId).catch(() => {})));
    throw err;
  }

  const created = await ApprovalComment.create({
    request: request._id, kind: 'message', text, attachments, author: req.user._id,
  });

  // Owner's messages go to the approvers; a reviewer's message goes to the owner.
  if (isOwner) {
    await notifyApprovers(NOTIFICATION_TYPES.APPROVAL_COMMENT, 'New comment', `${req.user.name} commented on "${request.title}"`, request);
  } else {
    await createNotification({
      recipient: request.createdBy, organization: request.organization, type: NOTIFICATION_TYPES.APPROVAL_COMMENT,
      title: 'New comment', message: `${req.user.name} commented on "${request.title}"`,
      link: `/approvals/${request._id}`, relatedRequest: request._id,
    });
  }

  const comment = await ApprovalComment.findById(created._id).populate('author', 'name avatar').lean();
  res.status(201).json({ success: true, comment });
});

// @route DELETE /api/approvals/:id  (owner or CEO)
export const deleteApproval = asyncHandler(async (req, res) => {
  const request = await ApprovalRequest.findById(req.params.id);
  if (!request) { res.status(404); throw new Error('Request not found'); }
  assertOrgAccess(req, res, request);
  if (String(request.createdBy) !== String(req.user._id) && ![ROLES.CEO, ROLES.ADMIN].includes(req.user.role)) {
    res.status(403); throw new Error('Not allowed');
  }
  const images = await ApprovalImage.find({ request: request._id });
  await Promise.all(images.map((img) => deleteFile(img.publicId)));
  // Chat attachments live on comment rows — remove their files from storage too.
  const comments = await ApprovalComment.find({ request: request._id }).select('attachments').lean();
  await Promise.all(comments.flatMap((c) => (c.attachments || []).map((a) => deleteFile(a.publicId))));
  await ApprovalImage.deleteMany({ request: request._id });
  await ApprovalComment.deleteMany({ request: request._id });
  await request.deleteOne();
  res.json({ success: true, message: 'Request deleted' });
});
