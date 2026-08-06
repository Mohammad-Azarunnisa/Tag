import asyncHandler from 'express-async-handler';
import Goal from '../models/Goal.js';
import Analytics from '../models/Analytics.js';
import ApprovalRequest from '../models/ApprovalRequest.js';
import { logActivity } from '../utils/logActivity.js';
import { accessibleOrgIds, canAccessOrg } from '../utils/org.js';
import { APPROVAL_STATUS, ACTIVITY_ACTIONS, PLATFORMS } from '../config/constants.js';

// YouTube audiences are "subscribers"; every other platform is "followers".
// Exported because the AI goal suggestion reads the same series.
export const audienceField = (platform) => (platform === 'YouTube' ? 'subscribers' : 'followers');

// Live progress for one goal:
//  - baselineFollowers: audience at (or just before) the period start
//  - currentFollowers:  audience from the latest snapshot
//  - gainedFollowers:   growth achieved during the period so far
//  - postsPublished:    approvals POSTED for this org+platform inside the period
export const computeProgress = async (goal) => {
  const field = audienceField(goal.platform);
  // Only snapshots that actually carry audience data — content-only days
  // store 0 followers and would corrupt the baseline/current readings.
  const [latest, baselineSnap, postsPublished] = await Promise.all([
    Analytics.findOne({ organization: goal.organization, platform: goal.platform, [field]: { $gt: 0 } }).sort({ date: -1 }).lean(),
    Analytics.findOne({ organization: goal.organization, platform: goal.platform, [field]: { $gt: 0 }, date: { $lte: goal.startDate } }).sort({ date: -1 }).lean(),
    ApprovalRequest.countDocuments({
      organization: goal.organization,
      platform: goal.platform,
      status: APPROVAL_STATUS.POSTED,
      postedAt: { $gte: goal.startDate, $lte: goal.endDate },
    }),
  ]);
  const currentFollowers = latest?.[field] || 0;
  const baselineFollowers = baselineSnap?.[field] || 0;
  return {
    currentFollowers,
    baselineFollowers,
    gainedFollowers: Math.max(0, currentFollowers - baselineFollowers),
    postsPublished,
    lastEntry: latest?.date || null,
  };
};

// @route GET /api/goals?organizationId=...  — all goals for one organization,
// each with live progress, plus each platform's CURRENT audience so the goal
// form can show "currently 11,172 → target 13,000 means +1,828".
// Shared workspace: any authenticated user can view.
export const getGoals = asyncHandler(async (req, res) => {
  const { organizationId } = req.query;
  if (!organizationId) { res.status(400); throw new Error('organizationId is required'); }
  const allowed = accessibleOrgIds(req.user);
  if (allowed !== null && !allowed.includes(String(organizationId))) { res.status(403); throw new Error('Not allowed'); }
  const goals = await Goal.find({ organization: organizationId }).sort({ platform: 1 }).lean();
  const withProgress = await Promise.all(goals.map(async (g) => ({ ...g, progress: await computeProgress(g) })));

  const audiences = {};
  await Promise.all(PLATFORMS.map(async (p) => {
    const field = audienceField(p);
    const snap = await Analytics.findOne({ organization: organizationId, platform: p, [field]: { $gt: 0 } }).sort({ date: -1 }).lean();
    audiences[p] = snap?.[field] || 0;
  }));

  res.json({ success: true, platforms: PLATFORMS, audiences, goals: withProgress });
});

// @route POST /api/goals  (ADMIN) — create or replace the goal for org+platform.
export const setGoal = asyncHandler(async (req, res) => {
  const { organization, platform, targetFollowers, targetPosts, startDate, endDate, note } = req.body;
  if (!organization || !platform) { res.status(400); throw new Error('organization and platform are required'); }
  if (!canAccessOrg(req.user, organization)) { res.status(403); throw new Error('Not allowed'); }
  if (!PLATFORMS.includes(platform)) { res.status(400); throw new Error(`platform must be one of: ${PLATFORMS.join(', ')}`); }
  const start = new Date(startDate);
  const end = new Date(endDate);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) { res.status(400); throw new Error('Valid startDate and endDate are required'); }
  if (end <= start) { res.status(400); throw new Error('endDate must be after startDate'); }
  if (!Number(targetFollowers) && !Number(targetPosts)) { res.status(400); throw new Error('Set at least one target (followers or posts)'); }

  const goal = await Goal.findOneAndUpdate(
    { organization, platform },
    {
      organization, platform,
      targetFollowers: Number(targetFollowers) || 0,
      targetPosts: Number(targetPosts) || 0,
      startDate: start, endDate: end,
      note: note || '',
      createdBy: req.user._id,
    },
    { new: true, upsert: true, setDefaultsOnInsert: true }
  ).lean();

  await logActivity({
    user: req.user._id, organization, action: ACTIVITY_ACTIONS.GOAL_UPDATED,
    description: `Set ${platform} goal (${Number(targetFollowers) || 0} followers / ${Number(targetPosts) || 0} posts by ${end.toISOString().slice(0, 10)})`,
  });
  res.status(201).json({ success: true, goal: { ...goal, progress: await computeProgress(goal) } });
});

// @route DELETE /api/goals/:id  (ADMIN)
export const deleteGoal = asyncHandler(async (req, res) => {
  const goal = await Goal.findById(req.params.id);
  if (!goal) { res.status(404); throw new Error('Goal not found'); }
  await goal.deleteOne();
  res.json({ success: true, message: 'Goal removed' });
});
