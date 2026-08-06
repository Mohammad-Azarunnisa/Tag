import asyncHandler from 'express-async-handler';
import mongoose from 'mongoose';
import ApprovalRequest from '../models/ApprovalRequest.js';
import ApprovalImage from '../models/ApprovalImage.js';
import { requireOrgId } from '../utils/org.js';
import { ROLES, APPROVAL_STATUS } from '../config/constants.js';

// CEO/ADMIN see the whole org's posting calendar; a USER sees only their own posts.
const calendarScope = (req, orgId) => {
  const privileged = [ROLES.ADMIN, ROLES.CEO].includes(req.user.role);
  const scope = { organization: new mongoose.Types.ObjectId(orgId), status: APPROVAL_STATUS.POSTED };
  if (!privileged) scope.createdBy = new mongoose.Types.ObjectId(req.user._id);
  return scope;
};

// @route GET /api/calendar?month=YYYY-MM  — posted-content counts per day for the month
export const getCalendarMonth = asyncHandler(async (req, res) => {
  const orgId = requireOrgId(req, res);
  const monthStr = req.query.month || new Date().toISOString().slice(0, 7);
  const [y, m] = monthStr.split('-').map(Number);
  if (!y || !m || m < 1 || m > 12) { res.status(400); throw new Error('Invalid month (expected YYYY-MM)'); }

  const start = new Date(Date.UTC(y, m - 1, 1));
  const end = new Date(Date.UTC(y, m, 1));

  const agg = await ApprovalRequest.aggregate([
    { $match: { ...calendarScope(req, orgId), postedAt: { $gte: start, $lt: end } } },
    {
      $group: {
        _id: { $dateToString: { format: '%Y-%m-%d', date: '$postedAt', timezone: 'UTC' } },
        count: { $sum: 1 },
        platforms: { $addToSet: '$platform' },
      },
    },
    { $sort: { _id: 1 } },
  ]);

  const days = agg.map((d) => ({ date: d._id, count: d.count, platforms: d.platforms }));
  const total = days.reduce((a, d) => a + d.count, 0);
  res.json({ success: true, month: monthStr, total, days });
});

// @route GET /api/calendar/day?date=YYYY-MM-DD  — the posts published on a specific day
export const getCalendarDay = asyncHandler(async (req, res) => {
  const orgId = requireOrgId(req, res);
  const dateStr = req.query.date;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr || '')) { res.status(400); throw new Error('Invalid date (expected YYYY-MM-DD)'); }
  const start = new Date(`${dateStr}T00:00:00.000Z`);
  const end = new Date(start.getTime() + 24 * 60 * 60 * 1000);

  const privileged = [ROLES.ADMIN, ROLES.CEO].includes(req.user.role);
  const query = { organization: orgId, status: APPROVAL_STATUS.POSTED, postedAt: { $gte: start, $lt: end } };
  if (!privileged) query.createdBy = req.user._id;

  const posts = await ApprovalRequest.find(query)
    .populate('createdBy', 'name avatar')
    .populate('postedBy', 'name avatar')
    .sort({ postedAt: 1 })
    .lean();

  // Attach a cover image for each post
  const ids = posts.map((p) => p._id);
  const covers = await ApprovalImage.find({ request: { $in: ids } }).sort({ order: 1 }).lean();
  const coverByReq = covers.reduce((acc, img) => { if (!acc[img.request]) acc[img.request] = img.url; return acc; }, {});
  const withCover = posts.map((p) => ({ ...p, cover: coverByReq[p._id] || null }));

  res.json({ success: true, date: dateStr, count: withCover.length, posts: withCover });
});
