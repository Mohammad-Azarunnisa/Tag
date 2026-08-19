import asyncHandler from 'express-async-handler';
import Template from '../models/Template.js';
import Organization from '../models/Organization.js';
import { uploadBuffer, deleteFile } from '../config/storage.js';
import { logActivity } from '../utils/logActivity.js';
import { requireOrgId, pinnedWriteOrg, accessibleOrgIds, canAccessOrg } from '../utils/org.js';
import { escapeRegex } from '../utils/sheet.js';
import { ACTIVITY_ACTIONS, ROLES } from '../config/constants.js';

// A null organization is shared across every college and always visible; a
// real one must be one of the caller's own.
const canView = (user, tpl) => !tpl.organization || canAccessOrg(user, tpl.organization);

const extOf = (name = '') => (name.split('.').pop() || '').toUpperCase();

// Only the built-in super admin may edit or remove repository items. Everyone
// else can upload (create) and download, but not modify or delete.
const canManage = (user) => user?.role === ROLES.ADMIN && !!user?.isSuperAdmin;

// Resolve the college a repository item is for, from the upload form.
// '' / 'shared' → shared across all colleges (organization: null).
const resolveItemOrg = async (organization, req, res) => {
  // A coordinator uploads for their own college, whatever the form says - the
  // picker is hidden for them precisely because there is nothing to choose.
  const pinned = pinnedWriteOrg(req.user);
  if (pinned) return pinned;
  if (organization === undefined) return requireOrgId(req, res); // legacy clients
  if (!organization || organization === 'shared') return null;
  if (!canAccessOrg(req.user, organization)) { res.status(403); throw new Error('Not allowed'); }
  const org = await Organization.findById(organization).select('_id');
  if (!org) { res.status(400); throw new Error('Selected organization does not exist'); }
  return org._id;
};

// @route GET /api/templates  — search + filter + paginate (org-scoped)
export const getTemplates = asyncHandler(async (req, res) => {
  const { search, category, page = 1, limit = 12 } = req.query;
  // College filter: a specific org shows that college's items PLUS the shared
  // ones (shared templates apply to every college); 'shared' shows only shared.
  const query = {};
  const ands = [];
  const allowed = accessibleOrgIds(req.user);
  if (req.query.organizationId === 'shared') query.organization = null;
  else if (req.query.organizationId) {
    if (allowed !== null && !allowed.includes(String(req.query.organizationId))) { res.status(403); throw new Error('Not allowed'); }
    ands.push({ $or: [{ organization: req.query.organizationId }, { organization: null }] });
  } else if (allowed !== null) {
    ands.push({ $or: [{ organization: { $in: allowed } }, { organization: null }] });
  }
  if (category && category !== 'All') query.category = category;
  if (search) ands.push({
    $or: [
      { name: { $regex: escapeRegex(search), $options: 'i' } },
      { description: { $regex: escapeRegex(search), $options: 'i' } },
    ],
  });
  if (ands.length) query.$and = ands;

  const skip = (Number(page) - 1) * Number(limit);
  const [items, total] = await Promise.all([
    Template.find(query).populate('uploadedBy', 'name avatar').populate('organization', 'name color').sort({ createdAt: -1 }).skip(skip).limit(Number(limit)),
    Template.countDocuments(query),
  ]);
  res.json({ success: true, total, page: Number(page), pages: Math.ceil(total / limit), templates: items });
});

// @route GET /api/templates/:id
export const getTemplate = asyncHandler(async (req, res) => {
  const tpl = await Template.findById(req.params.id).populate('uploadedBy', 'name avatar');
  if (!tpl || !canView(req.user, tpl)) { res.status(404); throw new Error('Template not found'); }
  res.json({ success: true, template: tpl });
});

// @route POST /api/templates
export const createTemplate = asyncHandler(async (req, res) => {
  const { name, description, category, organization } = req.body;
  const orgId = await resolveItemOrg(organization, req, res);
  if (!name || !category) { res.status(400); throw new Error('Name and category are required'); }
  if (!req.files?.file?.[0]) { res.status(400); throw new Error('Template file is required'); }

  const file = req.files.file[0];
  const { url, publicId } = await uploadBuffer(file.buffer, { folder: 'templates', originalName: file.originalname });

  let thumbnail = '', thumbnailPublicId = '';
  if (req.files?.thumbnail?.[0]) {
    const t = req.files.thumbnail[0];
    const up = await uploadBuffer(t.buffer, { folder: 'templates', originalName: t.originalname });
    thumbnail = up.url; thumbnailPublicId = up.publicId;
  } else if (file.mimetype.startsWith('image/')) {
    thumbnail = url; // image templates are their own thumbnail
  }

  const tpl = await Template.create({
    organization: orgId,
    name, description, category,
    fileUrl: url, filePublicId: publicId, fileName: file.originalname,
    fileType: extOf(file.originalname), fileSize: file.size,
    thumbnail, thumbnailPublicId,
    uploadedBy: req.user._id,
  });
  logActivity({ user: req.user._id, organization: orgId, action: ACTIVITY_ACTIONS.TEMPLATE_UPLOAD, description: `Uploaded template "${name}"`, entityType: 'Template', entityId: tpl._id });
  res.status(201).json({ success: true, template: tpl });
});

// @route PUT /api/templates/:id
export const updateTemplate = asyncHandler(async (req, res) => {
  const tpl = await Template.findById(req.params.id);
  if (!tpl) { res.status(404); throw new Error('Template not found'); }
  // Only the super admin can edit repository items.
  if (!canManage(req.user)) {
    res.status(403); throw new Error('Only the super admin can edit templates');
  }
  const { name, description, category, organization } = req.body;
  if (name) tpl.name = name;
  if (description !== undefined) tpl.description = description;
  if (category) tpl.category = category;
  if (organization !== undefined) tpl.organization = await resolveItemOrg(organization, req, res);

  if (req.files?.file?.[0]) {
    if (tpl.filePublicId) await deleteFile(tpl.filePublicId);
    const file = req.files.file[0];
    const up = await uploadBuffer(file.buffer, { folder: 'templates', originalName: file.originalname });
    tpl.fileUrl = up.url; tpl.filePublicId = up.publicId; tpl.fileName = file.originalname;
    tpl.fileType = extOf(file.originalname); tpl.fileSize = file.size;
  }
  if (req.files?.thumbnail?.[0]) {
    if (tpl.thumbnailPublicId) await deleteFile(tpl.thumbnailPublicId);
    const t = req.files.thumbnail[0];
    const up = await uploadBuffer(t.buffer, { folder: 'templates', originalName: t.originalname });
    tpl.thumbnail = up.url; tpl.thumbnailPublicId = up.publicId;
  }
  await tpl.save();
  res.json({ success: true, template: tpl });
});

// @route DELETE /api/templates/:id
export const deleteTemplate = asyncHandler(async (req, res) => {
  const tpl = await Template.findById(req.params.id);
  if (!tpl) { res.status(404); throw new Error('Template not found'); }
  if (!canManage(req.user)) {
    res.status(403); throw new Error('Only the super admin can delete templates');
  }
  if (tpl.filePublicId) await deleteFile(tpl.filePublicId);
  if (tpl.thumbnailPublicId && tpl.thumbnailPublicId !== tpl.filePublicId) await deleteFile(tpl.thumbnailPublicId);
  await tpl.deleteOne();
  res.json({ success: true, message: 'Template deleted' });
});

// @route POST /api/templates/:id/download  — increments counter, returns url
export const downloadTemplate = asyncHandler(async (req, res) => {
  const existing = await Template.findById(req.params.id).select('organization');
  if (!existing || !canView(req.user, existing)) { res.status(404); throw new Error('Template not found'); }
  const tpl = await Template.findByIdAndUpdate(req.params.id, { $inc: { downloads: 1 } }, { new: true });
  res.json({ success: true, url: tpl.fileUrl, fileName: tpl.fileName });
});
