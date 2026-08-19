import asyncHandler from 'express-async-handler';
import mongoose from 'mongoose';
import ApprovalRequest from '../models/ApprovalRequest.js';
import Template from '../models/Template.js';
import Asset from '../models/Asset.js';
import Analytics from '../models/Analytics.js';
import ActivityLog from '../models/ActivityLog.js';
import { requireOrgId } from '../utils/org.js';
import { APPROVAL_STATUS, PLATFORMS, ROLES, USER_TYPES } from '../config/constants.js';

// Who sees the whole college rather than only what they raised themselves:
// the org head and the super admin, plus a coordinator - their job is to
// report on their college, so personal-only numbers would be meaningless.
const collegeWide = (user) => [ROLES.ADMIN, ROLES.CEO].includes(user.role)
  || (user.role === ROLES.USER && user.userType === USER_TYPES.COORDINATOR);

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

// Latest analytics snapshot per platform for one organization.
const latestSocial = async (orgId) => {
  const out = {};
  for (const platform of PLATFORMS) {
    const doc = await Analytics.findOne({ organization: orgId, platform }).sort({ date: -1 });
    out[platform] = doc || null;
  }
  return out;
};

// @route GET /api/dashboard/stats — overall counts + social + role widgets (org-scoped)
export const getDashboardStats = asyncHandler(async (req, res) => {
  const orgId = requireOrgId(req, res);
  const privileged = collegeWide(req.user);
  const base = { organization: orgId };
  const scope = privileged ? base : { ...base, createdBy: req.user._id };

  const [
    totalPosts, totalTemplates, totalAssets, totalRequests,
    approved, rejected, pending, posted, resubmitted,
  ] = await Promise.all([
    ApprovalRequest.countDocuments({ ...scope, status: APPROVAL_STATUS.POSTED }),
    Template.countDocuments(base),
    Asset.countDocuments(base),
    ApprovalRequest.countDocuments(scope),
    ApprovalRequest.countDocuments({ ...scope, status: APPROVAL_STATUS.APPROVED }),
    ApprovalRequest.countDocuments({ ...scope, status: APPROVAL_STATUS.REJECTED }),
    ApprovalRequest.countDocuments({ ...scope, status: APPROVAL_STATUS.PENDING }),
    ApprovalRequest.countDocuments({ ...scope, status: APPROVAL_STATUS.POSTED }),
    ApprovalRequest.countDocuments({ ...scope, status: APPROVAL_STATUS.RESUBMITTED }),
  ]);

  const social = await latestSocial(orgId);

  res.json({
    success: true,
    stats: { totalPosts, totalTemplates, totalAssets, totalRequests, approved, rejected, pending, posted, resubmitted },
    social,
  });
});

// @route GET /api/dashboard/charts — series for line/area/bar/pie (org-scoped)
export const getDashboardCharts = asyncHandler(async (req, res) => {
  const orgId = requireOrgId(req, res);
  const oid = new mongoose.Types.ObjectId(orgId);
  const privileged = collegeWide(req.user);
  const scope = privileged ? { organization: oid } : { organization: oid, createdBy: req.user._id };

  // Status distribution (pie)
  const statusAgg = await ApprovalRequest.aggregate([
    { $match: scope },
    { $group: { _id: '$status', count: { $sum: 1 } } },
  ]);
  const statusDistribution = Object.values(APPROVAL_STATUS).map((s) => ({
    status: s,
    count: statusAgg.find((x) => x._id === s)?.count || 0,
  }));

  // Platform-wise requests (bar)
  const platformAgg = await ApprovalRequest.aggregate([
    { $match: scope },
    { $group: { _id: '$platform', count: { $sum: 1 } } },
  ]);
  const platformDistribution = PLATFORMS.map((p) => ({
    platform: p,
    count: platformAgg.find((x) => x._id === p)?.count || 0,
  }));

  // Monthly approval trend (line/area) — last 6 months
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth() - 5, 1);
  const monthlyAgg = await ApprovalRequest.aggregate([
    { $match: { ...scope, createdAt: { $gte: start } } },
    {
      $group: {
        _id: { y: { $year: '$createdAt' }, m: { $month: '$createdAt' } },
        total: { $sum: 1 },
        approved: { $sum: { $cond: [{ $in: ['$status', ['APPROVED', 'POSTED']] }, 1, 0] } },
        rejected: { $sum: { $cond: [{ $eq: ['$status', 'REJECTED'] }, 1, 0] } },
        posted: { $sum: { $cond: [{ $eq: ['$status', 'POSTED'] }, 1, 0] } },
      },
    },
  ]);
  const monthlyTrend = [];
  for (let i = 5; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const found = monthlyAgg.find((x) => x._id.y === d.getFullYear() && x._id.m === d.getMonth() + 1);
    monthlyTrend.push({
      month: MONTHS[d.getMonth()],
      total: found?.total || 0,
      approved: found?.approved || 0,
      rejected: found?.rejected || 0,
      posted: found?.posted || 0,
    });
  }

  // Followers trend across platforms — from this org's Analytics series.
  //
  // A follower count is a running total, not a daily event: if a platform was
  // not synced on some day, the audience did not vanish, it is simply unchanged.
  // The `$cond` fallback here used to be 0, which meant every date holding only
  // (say) a LinkedIn row plotted Instagram, Facebook and YouTube at zero — and
  // because LinkedIn syncs daily while the others do not, the chart collapsed
  // into a sawtooth that crashed to the axis between every real reading.
  // Missing days now yield null from the aggregation and the last known value is
  // carried forward below, so each point reads "audience as at this date".
  const followerDays = await Analytics.aggregate([
    { $match: { organization: oid } },
    { $sort: { date: 1 } },
    {
      $group: {
        _id: { $dateToString: { format: '%Y-%m-%d', date: '$date' } },
        LinkedIn: { $max: { $cond: [{ $eq: ['$platform', 'LinkedIn'] }, '$followers', null] } },
        Instagram: { $max: { $cond: [{ $eq: ['$platform', 'Instagram'] }, '$followers', null] } },
        Facebook: { $max: { $cond: [{ $eq: ['$platform', 'Facebook'] }, '$followers', null] } },
        YouTube: { $max: { $cond: [{ $eq: ['$platform', 'YouTube'] }, '$subscribers', null] } },
      },
    },
    { $sort: { _id: 1 } },
    { $project: { _id: 0, date: '$_id', LinkedIn: 1, Instagram: 1, Facebook: 1, YouTube: 1 } },
  ]);

  // Carry the last reading forward per platform. Dates before a platform's first
  // ever snapshot stay null so the line starts where its history starts, rather
  // than inventing a flat run back to the beginning of the chart.
  const lastSeen = { LinkedIn: null, Instagram: null, Facebook: null, YouTube: null };
  const followerSeries = followerDays.map((day) => {
    const point = { date: day.date };
    for (const platform of Object.keys(lastSeen)) {
      if (day[platform] != null) lastSeen[platform] = day[platform];
      point[platform] = lastSeen[platform];
    }
    return point;
  });

  res.json({ success: true, charts: { statusDistribution, platformDistribution, monthlyTrend, followerSeries } });
});

// @route GET /api/dashboard/activity — recent activity (org-scoped; user sees own)
export const getRecentActivity = asyncHandler(async (req, res) => {
  const orgId = requireOrgId(req, res);
  const privileged = collegeWide(req.user);
  const query = privileged ? { organization: orgId } : { organization: orgId, user: req.user._id };
  const logs = await ActivityLog.find(query).populate('user', 'name avatar').sort({ createdAt: -1 }).limit(15);
  res.json({ success: true, activity: logs });
});

// @route GET /api/dashboard/my-uploads — current user's recent templates & assets (org-scoped)
export const getMyUploads = asyncHandler(async (req, res) => {
  const orgId = requireOrgId(req, res);
  const [templates, assets] = await Promise.all([
    Template.find({ organization: orgId, uploadedBy: req.user._id }).sort({ createdAt: -1 }).limit(5).lean(),
    Asset.find({ organization: orgId, uploadedBy: req.user._id }).sort({ createdAt: -1 }).limit(5).lean(),
  ]);
  const uploads = [
    ...templates.map((t) => ({ ...t, kind: 'Template', preview: t.thumbnail })),
    ...assets.map((a) => ({ ...a, kind: 'Asset', preview: a.previewImage })),
  ]
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
    .slice(0, 6);
  res.json({ success: true, uploads });
});

// @route GET /api/dashboard/top-platform — best performing platform by engagement (org-scoped)
export const getTopPlatform = asyncHandler(async (req, res) => {
  const orgId = requireOrgId(req, res);
  const social = await latestSocial(orgId);
  let top = null;
  for (const [platform, doc] of Object.entries(social)) {
    if (!doc) continue;
    const score = doc.engagementRate || 0;
    if (!top || score > top.engagementRate) top = { platform, engagementRate: score, followers: doc.followers, reach: doc.reach };
  }
  res.json({ success: true, topPlatform: top });
});
