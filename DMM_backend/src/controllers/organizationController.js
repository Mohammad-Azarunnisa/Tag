import asyncHandler from 'express-async-handler';
import Organization, { slugify } from '../models/Organization.js';
import User from '../models/User.js';
import Template from '../models/Template.js';
import Asset from '../models/Asset.js';
import ApprovalRequest from '../models/ApprovalRequest.js';
import Analytics from '../models/Analytics.js';
import { uploadBuffer, deleteFile } from '../config/storage.js';
import { APPROVAL_STATUS, PLATFORMS, ROLES } from '../config/constants.js';
import { accessibleOrgIds, canAccessOrg } from '../utils/org.js';
import { platformsByOrganization } from '../utils/platforms.js';

// @route GET /api/organizations/options — minimal active-org list for pickers
// (approval target, analytics view). Available to ANY authenticated user so the
// shared workspace can offer every organization to choose from.
//
// ?scope=mine narrows it to the institutions the caller may actually act in -
// their own college, plus anything granted to an Admin. Used where offering a
// college they cannot use would just produce a rejected save.
export const listOrgOptions = asyncHandler(async (req, res) => {
  const query = { isActive: true };
  if (req.query.scope === 'mine') {
    const allowed = accessibleOrgIds(req.user);
    if (allowed !== null) query._id = { $in: allowed };
  }
  const orgs = await Organization.find(query).select('name color logo').sort({ name: 1 }).lean();
  // Each college's own channels ride along, so a form asking "which platforms?"
  // can offer only the ones that college actually runs instead of the full list.
  const byOrg = await platformsByOrganization(orgs.map((o) => o._id));
  res.json({
    success: true,
    organizations: orgs.map((o) => ({ ...o, platforms: byOrg[String(o._id)] || [] })),
  });
});

// @route GET /api/organizations  — list all (ADMIN). Includes quick member/post counts.
export const getOrganizations = asyncHandler(async (req, res) => {
  const { search } = req.query;
  const query = {};
  if (search) query.name = { $regex: search, $options: 'i' };
  // The super admin sees every college; an Admin sees the ones they hold, and
  // reads them only — creating and changing a college stays super-admin-only,
  // enforced by requireSuperAdmin on those routes.
  const allowed = accessibleOrgIds(req.user);
  if (allowed !== null) query._id = { $in: allowed };
  const orgs = await Organization.find(query).sort({ createdAt: -1 }).lean();

  // Attach lightweight stats per org
  const withStats = await Promise.all(
    orgs.map(async (o) => {
      const [members, posts] = await Promise.all([
        User.countDocuments({ organization: o._id }),
        ApprovalRequest.countDocuments({ organization: o._id, status: APPROVAL_STATUS.POSTED }),
      ]);
      return { ...o, memberCount: members, postCount: posts };
    })
  );
  res.json({ success: true, count: withStats.length, organizations: withStats });
});

// @route GET /api/organizations/:id
export const getOrganization = asyncHandler(async (req, res) => {
  const org = await Organization.findById(req.params.id).lean();
  if (!org) { res.status(404); throw new Error('Organization not found'); }
  // Opening one by id must respect the same scope as listing them, or the list
  // filter would be the only thing standing between an Admin and another
  // college's figures.
  if (!canAccessOrg(req.user, org._id)) { res.status(404); throw new Error('Organization not found'); }
  const [members, templates, assets, posts] = await Promise.all([
    User.countDocuments({ organization: org._id }),
    Template.countDocuments({ organization: org._id }),
    Asset.countDocuments({ organization: org._id }),
    ApprovalRequest.countDocuments({ organization: org._id, status: APPROVAL_STATUS.POSTED }),
  ]);
  res.json({ success: true, organization: { ...org, stats: { members, templates, assets, posts } } });
});

// @route GET /api/organizations/:id/goal — yearly goal + live progress
// (current followers from latest analytics, posts published in the goal year).
export const getOrganizationGoal = asyncHandler(async (req, res) => {
  // CEO/USER may only read their own organization's goal.
  if (req.user.role !== ROLES.ADMIN) {
    const own = req.user.organization?._id || req.user.organization;
    if (String(own) !== String(req.params.id)) { res.status(403); throw new Error('Not allowed'); }
  }
  const org = await Organization.findById(req.params.id).lean();
  if (!org) { res.status(404); throw new Error('Organization not found'); }
  const goal = org.goal || { year: 0, targetFollowers: 0, targetPosts: 0, note: '' };
  const year = goal.year || new Date().getFullYear();

  // Current followers = sum of the latest snapshot's followers across platforms.
  let currentFollowers = 0;
  for (const platform of PLATFORMS) {
    const snap = await Analytics.findOne({ organization: org._id, platform }).sort({ date: -1 }).lean();
    currentFollowers += (snap?.followers || 0) + (snap?.subscribers || 0);
  }

  // Posts published in the goal year (posted approvals).
  const start = new Date(`${year}-01-01T00:00:00.000Z`);
  const end = new Date(`${year}-12-31T23:59:59.999Z`);
  const currentPosts = await ApprovalRequest.countDocuments({
    organization: org._id,
    status: APPROVAL_STATUS.POSTED,
    postedAt: { $gte: start, $lte: end },
  });

  res.json({ success: true, goal, year, progress: { currentFollowers, currentPosts } });
});

// @route POST /api/organizations  (ADMIN)
export const createOrganization = asyncHandler(async (req, res) => {
  const { name, description, website, color } = req.body;
  if (!name) { res.status(400); throw new Error('Organization name is required'); }

  let slug = slugify(name);
  if (!slug) { res.status(400); throw new Error('Invalid organization name'); }
  // Ensure unique slug
  if (await Organization.findOne({ slug })) slug = `${slug}-${Date.now().toString(36).slice(-4)}`;

  const exists = await Organization.findOne({ name: name.trim() });
  if (exists) { res.status(400); throw new Error('An organization with this name already exists'); }

  let logo = '', logoPublicId = '';
  if (req.file) {
    const up = await uploadBuffer(req.file.buffer, { folder: 'organizations', originalName: req.file.originalname });
    logo = up.url; logoPublicId = up.publicId;
  }

  const org = await Organization.create({
    name: name.trim(), slug, description: description || '', website: website || '',
    color: color || '#6366f1', logo, logoPublicId, createdBy: req.user._id,
  });
  res.status(201).json({ success: true, organization: org });
});

// @route PUT /api/organizations/:id  (ADMIN)
export const updateOrganization = asyncHandler(async (req, res) => {
  const org = await Organization.findById(req.params.id);
  if (!org) { res.status(404); throw new Error('Organization not found'); }

  const { name, description, website, color, isActive, goal } = req.body;
  if (name && name.trim() !== org.name) {
    const dup = await Organization.findOne({ name: name.trim(), _id: { $ne: org._id } });
    if (dup) { res.status(400); throw new Error('An organization with this name already exists'); }
    org.name = name.trim();
  }
  if (description !== undefined) org.description = description;
  if (website !== undefined) org.website = website;
  if (color) org.color = color;
  if (typeof isActive === 'boolean') org.isActive = isActive;
  if (goal && typeof goal === 'object') {
    org.goal = {
      year: Number(goal.year) || org.goal?.year || 0,
      targetFollowers: Number(goal.targetFollowers) || 0,
      targetPosts: Number(goal.targetPosts) || 0,
      note: goal.note ?? org.goal?.note ?? '',
    };
  }

  if (req.file) {
    if (org.logoPublicId) await deleteFile(org.logoPublicId);
    const up = await uploadBuffer(req.file.buffer, { folder: 'organizations', originalName: req.file.originalname });
    org.logo = up.url; org.logoPublicId = up.publicId;
  }
  await org.save();
  res.json({ success: true, organization: org });
});

// @route DELETE /api/organizations/:id  (ADMIN) — blocked if it still has members
export const deleteOrganization = asyncHandler(async (req, res) => {
  const org = await Organization.findById(req.params.id);
  if (!org) { res.status(404); throw new Error('Organization not found'); }
  const members = await User.countDocuments({ organization: org._id });
  if (members > 0) {
    res.status(400);
    throw new Error(`Cannot delete: ${members} user(s) still belong to this organization. Reassign or remove them first.`);
  }
  if (org.logoPublicId) await deleteFile(org.logoPublicId);
  await org.deleteOne();
  res.json({ success: true, message: 'Organization deleted' });
});
