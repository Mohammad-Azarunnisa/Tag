import asyncHandler from 'express-async-handler';
import InstitutionRequest, {
  INSTITUTION_REQUEST_CATEGORIES as CATEGORIES,
  INSTITUTION_REQUEST_PRIORITY as PRIORITIES,
} from '../models/InstitutionRequest.js';
import ApprovalRequest from '../models/ApprovalRequest.js';
import Organization from '../models/Organization.js';
import User from '../models/User.js';
import ApprovalImage from '../models/ApprovalImage.js';
import { createNotification } from '../utils/notify.js';
import { logActivity } from '../utils/logActivity.js';
import { accessibleOrgIds, canAccessOrg, resolveOrgId } from '../utils/org.js';
import { ROLES, USER_TYPES, ACTIVITY_ACTIONS, NOTIFICATION_TYPES, APPROVAL_STATUS, APPROVAL_TYPES } from '../config/constants.js';
import { uploadBuffer } from '../config/storage.js';

const isCoordinator = (user) => user?.role === ROLES.USER && user?.userType === USER_TYPES.COORDINATOR;

const populate = (query) =>
  query
    .populate('organization', 'name color logo')
    .populate('raisedBy', 'name avatar email jobTitle')
    .populate('reviewedBy', 'name avatar');

// Everyone who can act on a college's request: every super admin, plus the
// Admin(s) over that college — including one holding it as a granted institution.
const notifyDeciders = async ({ request, type, title, message }) => {
  const orgId = request.organization?._id || request.organization;
  const recipients = await User.find({
    isActive: true,
    $or: [
      { isSuperAdmin: true },
      { role: ROLES.CEO, $or: [{ organization: orgId }, { managedOrganizations: orgId }] },
    ],
  }).select('_id');

  const seen = new Set();
  await Promise.all(
    recipients
      .filter((u) => { const k = String(u._id); if (seen.has(k)) return false; seen.add(k); return true; })
      .map((u) => createNotification({
        recipient: u._id,
        organization: orgId,
        type,
        title,
        message,
        link: `/requests?request=${request._id}`,
        relatedRequest: request._id,
      }))
  );
};

const summarizeRequest = (request) => {
  const parts = [];
  if (request.workType) parts.push(request.workType === 'DIGITAL_MEDIA' ? 'Digital media' : 'Print media');
  if (request.workCategory) parts.push(request.workCategory);
  if (request.workItem) parts.push(request.workItem);
  if (request.event) parts.push('Event work');
  return parts.filter(Boolean).join(' · ');
};

const buildApprovalDescription = (request) => {
  const lines = [];
  if (request.details) lines.push(request.details);
  if (request.department) lines.push(`Department: ${request.department}`);
  if (request.event) {
    lines.push(`Event: ${request.eventName || '—'}`);
    if (request.eventDate) lines.push(`Event date: ${new Date(request.eventDate).toISOString().slice(0, 10)}`);
    if (request.place) lines.push(`Place: ${request.place}`);
    if (request.eventCoordinatorName) lines.push(`Event coordinator: ${request.eventCoordinatorName}`);
  }
  return lines.filter(Boolean).join('\n');
};

const copyAttachmentsToApproval = async (approvalId, attachments = []) => {
  if (!attachments.length) return;
  const docs = attachments
    .filter((a) => a?.url)
    .map((a, i) => ({
      request: approvalId,
      url: a.url,
      publicId: a.publicId || '',
      mediaType: a.mediaType || 'document',
      name: a.name || `attachment-${i + 1}`,
      fileSize: a.fileSize || 0,
      kind: 'reference',
      order: i,
    }));
  if (docs.length) await ApprovalImage.insertMany(docs);
};

// @route GET /api/requests — scoped by who is asking.
// A coordinator sees their own college's requests; an Admin sees the
// institutions they hold; the super admin sees everything.
export const listInstitutionRequests = asyncHandler(async (req, res) => {
  const { status, category, priority, search, organizationId } = req.query;
  const query = {};

  const allowed = accessibleOrgIds(req.user);
  if (allowed !== null) {
    // A coordinator arrives already pinned to their own college by the auth
    // middleware, but scope is enforced here too — this endpoint must be safe on
    // its own terms.
    query.organization = { $in: allowed };
  } else if (organizationId && organizationId !== 'All') {
    query.organization = organizationId;
  }

  if (status && status !== 'All') query.status = status;
  if (category && category !== 'All') query.category = category;
  if (priority && priority !== 'All') query.priority = priority;
  if (search) {
    const rx = { $regex: String(search), $options: 'i' };
    query.$or = [{ title: rx }, { details: rx }, { response: rx }];
  }

  const requests = await populate(InstitutionRequest.find(query).sort({ createdAt: -1 })).lean();
  const counts = { OPEN: 0, IN_REVIEW: 0, APPROVED: 0, DECLINED: 0 };
  requests.forEach((r) => { if (counts[r.status] !== undefined) counts[r.status] += 1; });

  res.json({ success: true, counts, categories: CATEGORIES, requests });
});

// @route POST /api/requests — a college asks for something.
export const createInstitutionRequest = asyncHandler(async (req, res) => {
  const { title, details, category = 'Other', priority = 'NORMAL', neededBy } = req.body;
  const { workType = 'PRINT_MEDIA', workCategory = '', workItem = '', event = 'false', department = '', eventName = '', eventDate = '', place = '', eventCoordinatorName = '' } = req.body;
  if (!workCategory || !workItem) { res.status(400); throw new Error('Pick the work category and specific work item'); }
  if (!department) { res.status(400); throw new Error('Department is required'); }
  const hasEvent = event === true || event === 'true';
  if (hasEvent) {
    if (!eventName || !place || !eventCoordinatorName || !eventDate) { res.status(400); throw new Error('Fill in the event details'); }
  }
  const finalTitle = String(title || `${workType === 'DIGITAL_MEDIA' ? 'Digital' : 'Print'} · ${workCategory} · ${workItem}`).trim();
  if (!CATEGORIES.includes(category)) { res.status(400); throw new Error(`category must be one of ${CATEGORIES.join(', ')}`); }
  if (!PRIORITIES.includes(priority)) { res.status(400); throw new Error(`priority must be one of ${PRIORITIES.join(', ')}`); }

  // A request is raised on behalf of a college, so it is always the requester's
  // own — resolveOrgId gives a USER their organization and cannot be overridden.
  const orgId = resolveOrgId(req);
  if (!orgId) { res.status(400); throw new Error('Your account is not attached to a college'); }
  if (!canAccessOrg(req.user, orgId)) { res.status(403); throw new Error('You cannot raise a request for that college'); }
  const org = await Organization.findById(orgId).select('_id name isActive');
  if (!org || !org.isActive) { res.status(400); throw new Error('That college does not exist'); }

  let due;
  if (neededBy) {
    due = new Date(neededBy);
    if (Number.isNaN(due.getTime())) { res.status(400); throw new Error('That "needed by" date is not valid'); }
  }

  const created = await InstitutionRequest.create({
    organization: org._id,
    title: finalTitle,
    details: String(details || '').trim(),
    workType: workType === 'DIGITAL_MEDIA' ? 'DIGITAL_MEDIA' : 'PRINT_MEDIA',
    workCategory: String(workCategory).trim(),
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
  await notifyDeciders({
    request: created,
    type: NOTIFICATION_TYPES.INSTITUTION_REQUEST,
    title: priority === 'URGENT' || priority === 'HIGH'
      ? `${org.name} raised a ${priority.toLowerCase()}-priority request`
      : `${org.name} raised a request`,
    message: `${req.user.name}: "${created.title}"`,
  });

  const request = await populate(InstitutionRequest.findById(created._id)).lean();
  res.status(201).json({ success: true, request });
});

// @route PUT /api/requests/:id/respond — the decision and the reply.
// Super admin anywhere; an Admin within the institutions they hold.
export const respondToInstitutionRequest = asyncHandler(async (req, res) => {
  const request = await InstitutionRequest.findById(req.params.id);
  if (!request) { res.status(404); throw new Error('Request not found'); }
  if (!canAccessOrg(req.user, request.organization)) {
    res.status(403); throw new Error('That request belongs to a college you do not have access to');
  }

  const action = String(req.body.action || '').toLowerCase();
  const response = String(req.body.response || '').trim();
  const NEXT = { approve: 'APPROVED', decline: 'DECLINED', review: 'IN_REVIEW' };
  const status = NEXT[action];
  if (!status) { res.status(400); throw new Error('action must be approve, decline or review'); }
  // Turning something down without saying why leaves the college with nothing to
  // act on, so a reason is required for a decline.
  if (status === 'DECLINED' && !response) {
    res.status(400); throw new Error('Tell them why it is being declined');
  }

  request.status = status;
  request.response = response;
  request.reviewedBy = req.user._id;
  request.reviewedAt = new Date();
  await request.save();

  let linkedApproval = null;
  if (status === 'APPROVED' && !request.linkedApproval) {
    linkedApproval = await ApprovalRequest.create({
      organization: request.organization,
      title: request.title,
      type: APPROVAL_TYPES.DESIGN,
      description: buildApprovalDescription(request),
      caption: '',
      platforms: undefined,
      platform: undefined,
      status: APPROVAL_STATUS.PENDING,
      createdBy: request.raisedBy,
      sourceRequest: request._id,
      designer: null,
    });
    request.linkedApproval = linkedApproval._id;
    await request.save();
    await copyAttachmentsToApproval(linkedApproval._id, request.attachments || []);

    const designers = await User.find({
      isActive: true,
      role: ROLES.USER,
      userType: USER_TYPES.DESIGNER,
      organization: request.organization,
    }).select('_id name');
    await Promise.all(designers.map((d) => createNotification({
      recipient: d._id,
      organization: request.organization,
      type: NOTIFICATION_TYPES.DESIGN_REQUESTED,
      title: 'New work is pending for designers',
      message: `${request.title} is ready to claim`,
      link: `/approvals/${linkedApproval._id}`,
      relatedRequest: linkedApproval._id,
    })));
  }

  const verb = status === 'APPROVED' ? 'approved' : status === 'DECLINED' ? 'declined' : 'is looking at';
  await logActivity({
    user: req.user._id, organization: request.organization, action: ACTIVITY_ACTIONS.REQUEST_REVIEWED,
    description: `${status === 'IN_REVIEW' ? 'Picked up' : status.toLowerCase()} the request "${request.title}"`,
    entityType: 'InstitutionRequest', entityId: request._id,
  });
  await createNotification({
    recipient: request.raisedBy,
    organization: request.organization,
    type: status === 'DECLINED' ? NOTIFICATION_TYPES.REQUEST_DECLINED : NOTIFICATION_TYPES.REQUEST_APPROVED,
    title: status === 'APPROVED' ? 'Your request was approved'
      : status === 'DECLINED' ? 'Your request was declined'
        : 'Your request is being looked at',
    message: `${req.user.name} ${verb} "${request.title}"${response ? `: ${response}` : ''}`,
    link: `/requests?request=${request._id}`,
    relatedRequest: request._id,
  });

  const populated = await populate(InstitutionRequest.findById(request._id)).lean();
  res.json({ success: true, request: populated });
});

// @route DELETE /api/requests/:id — the person who raised it can withdraw it
// while it is still open; a super admin can remove any.
export const deleteInstitutionRequest = asyncHandler(async (req, res) => {
  const request = await InstitutionRequest.findById(req.params.id);
  if (!request) { res.status(404); throw new Error('Request not found'); }

  const mine = String(request.raisedBy) === String(req.user._id);
  if (!req.user.isSuperAdmin && !mine) {
    res.status(403); throw new Error('Only the person who raised this can withdraw it');
  }
  if (mine && !req.user.isSuperAdmin && request.status !== 'OPEN') {
    res.status(400); throw new Error('It has already been picked up — talk to the admin instead of withdrawing it');
  }
  await request.deleteOne();
  res.json({ success: true, message: 'Request withdrawn' });
});
