import asyncHandler from 'express-async-handler';
import BrandAsset from '../models/BrandAsset.js';
import Organization from '../models/Organization.js';
import { uploadBuffer, deleteFile } from '../config/storage.js';
import { assertCanDeleteOrgItem } from '../utils/permissions.js';
import { requireOrgId, pinnedWriteOrg, accessibleOrgIds, canAccessOrg } from '../utils/org.js';
import { escapeRegex } from '../utils/sheet.js';

export const BRAND_CATEGORIES = ['Flyer', 'Brochure', 'Branding Video', 'Image', 'Document', 'Other'];

// Resolve the college a brand item is for, from the upload form.
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

const mediaTypeFromMime = (mime = '') => {
  if (mime.startsWith('video/')) return 'video';
  if (mime.startsWith('image/')) return 'image';
  return 'document';
};

// @route GET /api/brand — list brand library items
export const listBrandAssets = asyncHandler(async (req, res) => {
  // Shared workspace: brand assets from every organization are visible.
  // College filter, same convention as templates/assets: a specific college
  // shows that college's items PLUS the shared ones; 'shared' shows only shared.
  const { category, search } = req.query;
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
      { title: { $regex: escapeRegex(search), $options: 'i' } },
      { description: { $regex: escapeRegex(search), $options: 'i' } },
    ],
  });
  if (ands.length) query.$and = ands;
  const items = await BrandAsset.find(query).populate('uploadedBy', 'name').populate('organization', 'name color').sort({ createdAt: -1 }).lean();
  res.json({ success: true, categories: BRAND_CATEGORIES, items });
});

// @route POST /api/brand  (ADMIN) — upload a file OR save an external link
export const createBrandAsset = asyncHandler(async (req, res) => {
  const { title, category, description, link, organization } = req.body;
  const orgId = await resolveItemOrg(organization, req, res);
  if (!title?.trim()) { res.status(400); throw new Error('A title is required'); }

  let doc = { organization: orgId, title: title.trim(), category: category || 'Other', description: description || '', uploadedBy: req.user._id };

  if (req.file) {
    const up = await uploadBuffer(req.file.buffer, { folder: 'brand', originalName: req.file.originalname });
    doc = { ...doc, kind: 'file', url: up.url, publicId: up.publicId, mediaType: mediaTypeFromMime(req.file.mimetype) };
  } else if (link?.trim()) {
    doc = { ...doc, kind: 'link', url: link.trim(), mediaType: 'link' };
  } else {
    res.status(400); throw new Error('Provide a file to upload or an external link');
  }

  const asset = await BrandAsset.create(doc);
  res.status(201).json({ success: true, asset });
});

// @route PUT /api/brand/:id  (super admin) — edit metadata (title/category/description)
export const updateBrandAsset = asyncHandler(async (req, res) => {
  const asset = await BrandAsset.findById(req.params.id);
  if (!asset) { res.status(404); throw new Error('Item not found'); }
  const { title, category, description } = req.body;
  if (title !== undefined) asset.title = title;
  if (category !== undefined) asset.category = category;
  if (description !== undefined) asset.description = description;
  await asset.save();
  res.json({ success: true, asset });
});

// @route DELETE /api/brand/:id  (admin or super admin)
//
// An institution's Admin may now clear out their own college's brand items, not
// only the super admin — but an item shared across every institution is the
// platform's, so that one stays with the super admin.
export const deleteBrandAsset = asyncHandler(async (req, res) => {
  const asset = await BrandAsset.findById(req.params.id);
  if (!asset) { res.status(404); throw new Error('Item not found'); }
  assertCanDeleteOrgItem(req, res, asset.organization, 'a brand item');
  if (asset.kind === 'file' && asset.publicId) await deleteFile(asset.publicId);
  await asset.deleteOne();
  res.json({ success: true, id: req.params.id });
});
