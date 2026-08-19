import asyncHandler from 'express-async-handler';
import mongoose from 'mongoose';
import ActivityLog from '../models/ActivityLog.js';
import { resolveOrgId, canAccessOrg, accessibleOrgIds } from '../utils/org.js';
import { ROLES } from '../config/constants.js';

const toUtcDateKey = (date) => new Date(date).toISOString().slice(0, 10);

const buildHeatmapCells = (startDate, days, counts) => {
  const cells = [];
  const cursor = new Date(startDate);
  for (let i = 0; i < days; i += 1) {
    const date = toUtcDateKey(cursor);
    cells.push({ date, value: counts.get(date) || 0 });
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return cells;
};

// find() casts a string id to an ObjectId on its own; an aggregation pipeline
// does NOT. The scope below is shared by both, so anything heading into an
// $match has to be cast explicitly - otherwise the filter silently matches
// nothing and every count comes back zero.
const castIds = (query) => {
  const out = { ...query };
  for (const key of ['organization', 'user']) {
    if (out[key] && mongoose.isValidObjectId(out[key])) {
      out[key] = new mongoose.Types.ObjectId(String(out[key]));
    }
  }
  return out;
};

const getActivityScope = (req, requestedOrganizationId) => {
  const query = {};

  // The super admin and the view-only Chairman both see platform-wide activity.
  if (req.user?.isSuperAdmin || req.user?.viewOnly) {
    if (requestedOrganizationId) query.organization = requestedOrganizationId;
    return query;
  }

  // Everyone else (CEO/USER) may only ever see organizations they actually
  // hold — an unrecognized/foreign requested org falls back to their own,
  // the same rule every other scoped endpoint in the app follows.
  const requestedIsAllowed = requestedOrganizationId && canAccessOrg(req.user, requestedOrganizationId);
  const orgId = requestedIsAllowed ? requestedOrganizationId : (req.user.organization?._id || req.user.organization);
  if (orgId) query.organization = orgId;

  if (req.user.role === ROLES.USER) {
    query.user = req.user._id;
  }

  return query;
};

// @route GET /api/activity — paginated activity logs.
// ADMIN: system-wide (all orgs), or one org if ?organizationId is given.
// CEO: all activity in their org. USER: only their own activity in their org.
export const getActivityLogs = asyncHandler(async (req, res) => {
  const { action, page = 1, limit = 20 } = req.query;
  const query = {};
  if (req.user.role === ROLES.ADMIN) {
    const orgId = resolveOrgId(req);
    if (orgId) query.organization = orgId;
  } else if (req.user.role === ROLES.CEO) {
    // A CEO may hold more than one institution (managedOrganizations) — show
    // all of them by default, or the one they asked for if it's theirs.
    const requested = req.query.organizationId;
    if (requested && canAccessOrg(req.user, requested)) {
      query.organization = requested;
    } else {
      query.organization = { $in: accessibleOrgIds(req.user) || [] };
    }
  } else {
    query.organization = req.user.organization?._id || req.user.organization;
    query.user = req.user._id;
  }
  if (action && action !== 'All') query.action = action;

  const skip = (Number(page) - 1) * Number(limit);
  const [logs, total] = await Promise.all([
    ActivityLog.find(query).populate('user', 'name avatar').populate('organization', 'name').sort({ createdAt: -1 }).skip(skip).limit(Number(limit)),
    ActivityLog.countDocuments(query),
  ]);
  res.json({ success: true, total, page: Number(page), pages: Math.ceil(total / limit), logs });
});

// Super-admin audit heatmap for the last N days. Daily cells are padded with
// zeros so the UI can render empty days instead of skipping them.
export const getActivityHeatmap = asyncHandler(async (req, res) => {
  const days = Math.max(30, Math.min(365, Number(req.query.days) || 365));
  const organizationId = req.query.organizationId;
  const end = new Date();
  const start = new Date();
  start.setUTCDate(start.getUTCDate() - (days - 1));
  start.setUTCHours(0, 0, 0, 0);

  const query = castIds({
    createdAt: { $gte: start, $lte: end },
    ...getActivityScope(req, organizationId),
  });

  const rows = await ActivityLog.aggregate([
    { $match: query },
    {
      $group: {
        _id: {
          $dateToString: { format: '%Y-%m-%d', date: '$createdAt', timezone: 'UTC' },
        },
        value: { $sum: 1 },
      },
    },
    { $sort: { _id: 1 } },
  ]);

  const counts = new Map(rows.map((row) => [row._id, row.value]));
  const cells = buildHeatmapCells(start, days, counts);
  const activeDays = cells.filter((cell) => cell.value > 0).length;
  const total = cells.reduce((sum, cell) => sum + cell.value, 0);
  const bestDay = cells.reduce((best, cell) => (cell.value > (best?.value || 0) ? cell : best), null);
  const average = Number((total / days).toFixed(1));

  res.json({
    success: true,
    days,
    cells,
    stats: {
      total,
      activeDays,
      average,
      bestDay,
    },
  });
});

// Detailed audit trail for one day. Used when a heatmap square is clicked.
export const getActivityByDate = asyncHandler(async (req, res) => {
  const { date } = req.query;
  const organizationId = req.query.organizationId;
  if (!date) {
    res.status(400);
    throw new Error('date is required');
  }

  const start = new Date(`${date}T00:00:00.000Z`);
  if (Number.isNaN(start.getTime())) {
    res.status(400);
    throw new Error('Invalid date');
  }
  const end = new Date(start);
  end.setUTCDate(end.getUTCDate() + 1);

  const query = {
    createdAt: { $gte: start, $lt: end },
    ...getActivityScope(req, organizationId),
  };

  const logs = await ActivityLog.find(query).populate('user', 'name avatar').sort({ createdAt: -1 });
  res.json({ success: true, date, total: logs.length, logs });
});
