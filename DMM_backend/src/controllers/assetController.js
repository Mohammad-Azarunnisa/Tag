import asyncHandler from 'express-async-handler';
import Asset from '../models/Asset.js';
import Organization from '../models/Organization.js';
import { uploadBuffer, deleteFile } from '../config/storage.js';
import { logActivity } from '../utils/logActivity.js';
import { requireOrgId, pinnedWriteOrg, accessibleOrgIds, canAccessOrg } from '../utils/org.js';
import { assertCanDeleteOrgItem } from '../utils/permissions.js';
import { escapeRegex } from '../utils/sheet.js';
import { ACTIVITY_ACTIONS, ROLES } from '../config/constants.js';

// A null organization is shared across every college and always visible; a
// real one must be one of the caller's own.
const canView = (user, asset) => !asset.organization || canAccessOrg(user, asset.organization);

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

// @route GET /api/assets (org-scoped)
export const getAssets = asyncHandler(async (req, res) => {
  const { search, category, page = 1, limit = 12 } = req.query;
  // College filter: a specific org shows that college's items PLUS the shared
  // ones (shared assets apply to every college); 'shared' shows only shared.
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
    Asset.find(query).populate('uploadedBy', 'name avatar').populate('organization', 'name color').sort({ createdAt: -1 }).skip(skip).limit(Number(limit)),
    Asset.countDocuments(query),
  ]);
  res.json({ success: true, total, page: Number(page), pages: Math.ceil(total / limit), assets: items });
});

// @route GET /api/assets/:id
export const getAsset = asyncHandler(async (req, res) => {
  const asset = await Asset.findById(req.params.id).populate('uploadedBy', 'name avatar');
  if (!asset || !canView(req.user, asset)) { res.status(404); throw new Error('Asset not found'); }
  res.json({ success: true, asset });
});

// @route POST /api/assets
export const createAsset = asyncHandler(async (req, res) => {
  const { name, description, category, organization } = req.body;
  const orgId = await resolveItemOrg(organization, req, res);
  if (!name || !category) { res.status(400); throw new Error('Name and category are required'); }
  if (!req.files?.file?.[0]) { res.status(400); throw new Error('Asset file is required'); }

  const file = req.files.file[0];
  const { url, publicId } = await uploadBuffer(file.buffer, { folder: 'assets', originalName: file.originalname });

  let previewImage = '', previewPublicId = '';
  if (req.files?.preview?.[0]) {
    const p = req.files.preview[0];
    const up = await uploadBuffer(p.buffer, { folder: 'assets', originalName: p.originalname });
    previewImage = up.url; previewPublicId = up.publicId;
  } else if (file.mimetype.startsWith('image/')) {
    previewImage = url;
  }

  const asset = await Asset.create({
    organization: orgId,
    name, description, category,
    fileUrl: url, filePublicId: publicId, fileName: file.originalname,
    fileType: extOf(file.originalname), fileSize: file.size,
    previewImage, previewPublicId,
    uploadedBy: req.user._id,
  });
  logActivity({ user: req.user._id, organization: orgId, action: ACTIVITY_ACTIONS.ASSET_UPLOAD, description: `Uploaded asset "${name}"`, entityType: 'Asset', entityId: asset._id });
  res.status(201).json({ success: true, asset });
});

// @route PUT /api/assets/:id
export const updateAsset = asyncHandler(async (req, res) => {
  const asset = await Asset.findById(req.params.id);
  if (!asset) { res.status(404); throw new Error('Asset not found'); }
  // Only the super admin can edit repository items.
  if (!canManage(req.user)) {
    res.status(403); throw new Error('Only the super admin can edit assets');
  }
  const { name, description, category, organization } = req.body;
  if (name) asset.name = name;
  if (description !== undefined) asset.description = description;
  if (category) asset.category = category;
  if (organization !== undefined) asset.organization = await resolveItemOrg(organization, req, res);

  if (req.files?.file?.[0]) {
    if (asset.filePublicId) await deleteFile(asset.filePublicId);
    const file = req.files.file[0];
    const up = await uploadBuffer(file.buffer, { folder: 'assets', originalName: file.originalname });
    asset.fileUrl = up.url; asset.filePublicId = up.publicId; asset.fileName = file.originalname;
    asset.fileType = extOf(file.originalname); asset.fileSize = file.size;
  }
  if (req.files?.preview?.[0]) {
    if (asset.previewPublicId) await deleteFile(asset.previewPublicId);
    const p = req.files.preview[0];
    const up = await uploadBuffer(p.buffer, { folder: 'assets', originalName: p.originalname });
    asset.previewImage = up.url; asset.previewPublicId = up.publicId;
  }
  await asset.save();
  res.json({ success: true, asset });
});

// @route DELETE /api/assets/:id
export const deleteAsset = asyncHandler(async (req, res) => {
  const asset = await Asset.findById(req.params.id);
  if (!asset) { res.status(404); throw new Error('Asset not found'); }
  // As with templates: an institution's Admin may clear out their own college's
  // assets, the super admin curates the ones shared across all of them, and
  // editing stays with the curator (canManage).
  assertCanDeleteOrgItem(req, res, asset.organization, 'an asset');
  if (asset.filePublicId) await deleteFile(asset.filePublicId);
  if (asset.previewPublicId && asset.previewPublicId !== asset.filePublicId) await deleteFile(asset.previewPublicId);
  await asset.deleteOne();
  res.json({ success: true, message: 'Asset deleted' });
});

// @route POST /api/assets/:id/download
export const downloadAsset = asyncHandler(async (req, res) => {
  const existing = await Asset.findById(req.params.id).select('organization');
  if (!existing || !canView(req.user, existing)) { res.status(404); throw new Error('Asset not found'); }
  const asset = await Asset.findByIdAndUpdate(req.params.id, { $inc: { downloads: 1 } }, { new: true });
  res.json({ success: true, url: asset.fileUrl, fileName: asset.fileName });
});
