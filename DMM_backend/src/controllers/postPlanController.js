import asyncHandler from 'express-async-handler';
import PostPlan from '../models/PostPlan.js';
import User from '../models/User.js';
import { createNotification } from '../utils/notify.js';
import { logActivity } from '../utils/logActivity.js';
import { requireOrgId, resolveOrgId, accessibleOrgIds, canAccessOrg } from '../utils/org.js';
import { APPROVAL_STATUS, ACTIVITY_ACTIONS, NOTIFICATION_TYPES, ROLES, PLATFORMS } from '../config/constants.js';

// Same recipients as content approvals: the target org's Admin(s) (role CEO)
// plus every Super Admin, de-duplicated.
const notifyReviewers = async (type, title, message, plan) => {
  const recipients = await User.find({
    isActive: true,
    $or: [{ role: ROLES.CEO, organization: plan.organization }, { isSuperAdmin: true }],
  }).select('_id');
  const seen = new Set();
  await Promise.all(
    recipients
      .filter((u) => { const k = String(u._id); if (seen.has(k)) return false; seen.add(k); return true; })
      .map((u) => createNotification({ recipient: u._id, organization: plan.organization, type, title, message, link: '/planner' }))
  );
};

// Every channel a planned post targets, tolerating legacy single-platform items.
const itemPlatforms = (item) =>
  (item?.platforms?.length ? item.platforms : (item?.platform ? [item.platform] : []));

// Validate and normalise the submitted items list; also derive the plan window.
const parseItems = (raw, res) => {
  const items = Array.isArray(raw) ? raw : [];
  if (!items.length) { res.status(400); throw new Error('Add at least one planned post'); }
  const clean = items.map((it, i) => {
    const date = new Date(it.date);
    if (Number.isNaN(date.getTime())) { res.status(400); throw new Error(`Post ${i + 1}: a valid date is required`); }
    // One planned post may go out on several channels; `platform` (legacy) or a
    // single-item list both still work.
    const chosen = [...new Set(
      (Array.isArray(it.platforms) ? it.platforms : String(it.platforms ?? it.platform ?? '').split(','))
        .map((p) => String(p).trim()).filter(Boolean)
    )];
    if (!chosen.length) { res.status(400); throw new Error(`Post ${i + 1}: pick at least one platform`); }
    const bad = chosen.filter((p) => !PLATFORMS.includes(p));
    if (bad.length) { res.status(400); throw new Error(`Post ${i + 1}: platform must be one of ${PLATFORMS.join(', ')}`); }
    if (!it.title || !String(it.title).trim()) { res.status(400); throw new Error(`Post ${i + 1}: a title is required`); }
    return {
      date,
      platform: chosen[0],
      platforms: chosen,
      title: String(it.title).trim(),
      notes: it.notes ? String(it.notes) : '',
    };
  }).sort((a, b) => a.date - b.date);
  return { items: clean, startDate: clean[0].date, endDate: clean[clean.length - 1].date };
};

// Reviewer guard: Super Admin console (ADMIN) reviews any org; a CEO reviews
// plans that target their own organization.
const assertCanReview = (req, res, plan) => {
  if (req.user.role === ROLES.ADMIN) return;
  const orgId = resolveOrgId(req);
  if (req.user.role === ROLES.CEO && orgId && String(plan.organization) === String(orgId)) return;
  res.status(403); throw new Error('Only the organization Admin or Super Admin can review plans');
};

// @route GET /api/plans — ADMIN sees all orgs, CEO their org, USER their own plans.
export const getPlans = asyncHandler(async (req, res) => {
  const { status, organizationId, page = 1, limit = 12 } = req.query;
  const query = {};
  if (req.user.role === ROLES.ADMIN) {
    if (organizationId) query.organization = organizationId;
  } else if (req.user.role === ROLES.CEO) {
    const allowed = accessibleOrgIds(req.user);
    if (organizationId) {
      if (allowed !== null && !allowed.includes(String(organizationId))) { res.status(403); throw new Error('Not allowed'); }
      query.organization = organizationId;
    } else if (allowed !== null) {
      query.organization = { $in: allowed };
    }
    query.$or = query.organization ? [{ organization: query.organization }, { createdBy: req.user._id }] : [{ createdBy: req.user._id }];
  } else {
    query.createdBy = req.user._id;
  }
  if (status === 'REVIEW') query.status = { $in: [APPROVAL_STATUS.PENDING, APPROVAL_STATUS.RESUBMITTED] };
  else if (status && status !== 'All') query.status = status;

  const skip = (Number(page) - 1) * Number(limit);
  const [plans, total] = await Promise.all([
    PostPlan.find(query)
      .populate('createdBy', 'name avatar email')
      .populate('organization', 'name color logo')
      .populate('reviewedBy', 'name')
      .sort({ createdAt: -1 }).skip(skip).limit(Number(limit)).lean(),
    PostPlan.countDocuments(query),
  ]);
  res.json({ success: true, total, page: Number(page), pages: Math.ceil(total / limit), plans });
});

// Which plans a viewer may see on the shared planning calendar. Note this is
// deliberately WIDER than getPlans for a USER: the whole point of the schedule
// is spotting that a colleague already planned something for the same day, so a
// USER sees their own organization's plans, not only their own.
const scheduleScope = (req) => {
  // A college filter narrows what the viewer may already see — it can never
  // widen it, so it is intersected with the role scope below. Note this reads
  // ?organizationId directly and deliberately NOT resolveOrgId, because the
  // admin console attaches a sticky x-organization-id header that would
  // silently scope "All colleges".
  const narrow = req.query.organizationId ? { organization: req.query.organizationId } : null;

  let allowed;
  if (req.user.role === ROLES.ADMIN) {
    allowed = null; // every college
  } else {
    const own = req.user.organization?._id || req.user.organization;
    allowed = own ? { $or: [{ organization: own }, { createdBy: req.user._id }] } : { createdBy: req.user._id };
  }

  if (allowed && narrow) return { $and: [allowed, narrow] };
  return narrow || allowed || {};
};

// @route GET /api/plans/schedule?date=YYYY-MM-DD  (single day)
//        GET /api/plans/schedule?from=YYYY-MM-DD&to=YYYY-MM-DD  (range)
//        &status=APPROVED narrows it to plans that have been signed off — the
//        calendar uses that, because only an approved plan is a commitment.
// Planned posts pulled out of every visible plan and grouped by day, so you can
// see what is already booked for a date before planning against it. Rejected
// plans are left out — they are not going ahead.
export const getPlanSchedule = asyncHandler(async (req, res) => {
  const { date, from, to, platform, status } = req.query;
  if (platform && platform !== 'All' && !PLATFORMS.includes(platform)) {
    res.status(400); throw new Error(`platform must be one of ${PLATFORMS.join(', ')}`);
  }
  const wantPlatform = platform && platform !== 'All' ? platform : null;
  // Default: everything still in play. A rejected plan is never going ahead, so
  // it stays off the schedule however this is called.
  const VIEWABLE = [APPROVAL_STATUS.PENDING, APPROVAL_STATUS.RESUBMITTED, APPROVAL_STATUS.APPROVED];
  if (status && status !== 'All' && !VIEWABLE.includes(status)) {
    res.status(400); throw new Error(`status must be one of ${VIEWABLE.join(', ')}`);
  }
  const statusFilter = status && status !== 'All'
    ? { status }
    : { status: { $ne: APPROVAL_STATUS.REJECTED } };
  const isDay = (s) => /^\d{4}-\d{2}-\d{2}$/.test(s || '');
  const startStr = isDay(date) ? date : from;
  const endStr = isDay(date) ? date : to;
  if (!isDay(startStr) || !isDay(endStr)) {
    res.status(400); throw new Error('Provide ?date=YYYY-MM-DD, or ?from=YYYY-MM-DD&to=YYYY-MM-DD');
  }
  const start = new Date(`${startStr}T00:00:00.000Z`);
  const end = new Date(`${endStr}T00:00:00.000Z`);
  if (end < start) { res.status(400); throw new Error('The "to" date cannot be before the "from" date'); }
  // Inclusive of the whole end day.
  const endExclusive = new Date(end.getTime() + 24 * 60 * 60 * 1000);

  const plans = await PostPlan.find({
    ...scheduleScope(req),
    ...statusFilter,
    startDate: { $lt: endExclusive },
    endDate: { $gte: start },
  })
    .populate('createdBy', 'name avatar')
    .populate('organization', 'name color')
    .select('title status items organization createdBy')
    .lean();

  // Flatten to one row per planned post that falls inside the window.
  const rows = [];
  for (const plan of plans) {
    for (const item of plan.items || []) {
      const when = new Date(item.date);
      if (when < start || when >= endExclusive) continue;
      const channels = itemPlatforms(item);
      if (wantPlatform && !channels.includes(wantPlatform)) continue;
      rows.push({
        _id: String(item._id),
        date: when.toISOString().slice(0, 10),
        platform: item.platform,
        // Every channel this one planned post goes out on.
        platforms: channels,
        title: item.title,
        notes: item.notes || '',
        plan: { _id: plan._id, title: plan.title, status: plan.status },
        organization: plan.organization || null,
        createdBy: plan.createdBy || null,
      });
    }
  }

  // Group by day, newest platform clashes surfaced per day for the UI.
  const byDate = new Map();
  for (const r of rows) {
    if (!byDate.has(r.date)) byDate.set(r.date, []);
    byDate.get(r.date).push(r);
  }
  const days = [...byDate.entries()]
    .sort((a, b) => (a[0] < b[0] ? -1 : 1))
    .map(([day, posts]) => {
      posts.sort((a, b) => a.platform.localeCompare(b.platform) || a.title.localeCompare(b.title));
      // A post planned for LinkedIn AND Instagram occupies a slot on BOTH, so it
      // appears in both groups — while still counting once in the day's total.
      // When a platform filter is on, only that channel is grouped.
      const channelsOf = (p) => (wantPlatform ? [wantPlatform] : p.platforms || [p.platform]);
      const perPlatform = {};
      for (const p of posts) for (const c of channelsOf(p)) perPlatform[c] = (perPlatform[c] || 0) + 1;
      // Segregated by platform within the day, so two LinkedIn posts sit
      // together rather than being scattered among other platforms.
      const groups = Object.keys(perPlatform).sort().map((p) => {
        const inGroup = posts.filter((x) => channelsOf(x).includes(p));
        return {
          platform: p,
          count: inGroup.length,
          clash: inGroup.length > 1,
          colleges: [...new Set(inGroup.map((x) => x.organization?.name).filter(Boolean))].sort(),
          posts: inGroup,
        };
      });
      return {
        date: day,
        count: posts.length,
        platforms: Object.keys(perPlatform).sort(),
        // Platforms with more than one post booked that day — the clashes
        // worth a second look.
        clashes: Object.entries(perPlatform).filter(([, n]) => n > 1).map(([p]) => p),
        contributors: [...new Set(posts.map((p) => p.createdBy?.name).filter(Boolean))],
        colleges: [...new Set(posts.map((p) => p.organization?.name).filter(Boolean))].sort(),
        groups,
        posts,
      };
    });

  // Totals across the whole window, broken down both ways. A post on several
  // channels counts once per channel in byPlatform (it is a slot on each), but
  // only once in totalPosts.
  const tally = (keysOf) => Object.entries(
    rows.reduce((acc, r) => { for (const k of keysOf(r)) if (k) acc[k] = (acc[k] || 0) + 1; return acc; }, {})
  ).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([name, count]) => ({ name, count }));

  res.json({
    success: true,
    from: startStr,
    to: endStr,
    platform: wantPlatform || 'All',
    status: status || 'All',
    organizationId: req.query.organizationId || null,
    totalPosts: rows.length,
    byPlatform: tally((r) => (wantPlatform ? [wantPlatform] : (r.platforms || [r.platform]))),
    byCollege: tally((r) => [r.organization?.name]),
    days,
  });
});

// @route GET /api/plans/:id
export const getPlan = asyncHandler(async (req, res) => {
  const plan = await PostPlan.findById(req.params.id)
    .populate('createdBy', 'name avatar email')
    .populate('organization', 'name color logo')
    .populate('reviewedBy', 'name')
    .lean();
  if (!plan) { res.status(404); throw new Error('Plan not found'); }
  const isOwner = String(plan.createdBy?._id) === String(req.user._id);
  const orgId = resolveOrgId(req);
  const sameOrg = orgId && String(plan.organization?._id) === String(orgId);
  if (req.user.role !== ROLES.ADMIN && !isOwner && !(req.user.role === ROLES.CEO && sameOrg)) {
    res.status(404); throw new Error('Plan not found');
  }
  res.json({ success: true, plan });
});

// @route POST /api/plans — any user, for any organization (shared workspace).
export const createPlan = asyncHandler(async (req, res) => {
  const { organization, title, description } = req.body;
  if (!organization) { res.status(400); throw new Error('organization is required'); }
  if (!title || !title.trim()) { res.status(400); throw new Error('Give the plan a title'); }
  const { items, startDate, endDate } = parseItems(req.body.items, res);

  const plan = await PostPlan.create({
    organization, title: title.trim(), description: description || '',
    items, startDate, endDate, createdBy: req.user._id,
  });

  await notifyReviewers(
    NOTIFICATION_TYPES.PLAN_SUBMITTED,
    'New post plan awaiting approval',
    `${req.user.name} submitted "${plan.title}" (${items.length} posts, ${startDate.toISOString().slice(0, 10)} → ${endDate.toISOString().slice(0, 10)})`,
    plan
  );
  await logActivity({
    user: req.user._id, organization, action: ACTIVITY_ACTIONS.PLAN_SUBMITTED,
    description: `Submitted post plan "${plan.title}" (${items.length} posts)`,
  });
  res.status(201).json({ success: true, plan });
});

// @route PUT /api/plans/:id — creator edits while PENDING, or fixes and
// resubmits after a rejection.
export const updatePlan = asyncHandler(async (req, res) => {
  const plan = await PostPlan.findById(req.params.id);
  if (!plan) { res.status(404); throw new Error('Plan not found'); }
  if (String(plan.createdBy) !== String(req.user._id)) { res.status(403); throw new Error('Only the plan creator can edit it'); }

  // Plans change - a shoot slips, a campaign moves. An APPROVED plan can still
  // be edited, but the edit is not self-approving: it goes back to the
  // reviewer, because the approval they gave was for the old version.
  const wasApproved = plan.status === APPROVAL_STATUS.APPROVED;
  const wasRejected = plan.status === APPROVAL_STATUS.REJECTED;
  if (req.body.title !== undefined) {
    if (!String(req.body.title).trim()) { res.status(400); throw new Error('Give the plan a title'); }
    plan.title = String(req.body.title).trim();
  }
  if (req.body.description !== undefined) plan.description = req.body.description;
  if (req.body.items !== undefined) {
    const { items, startDate, endDate } = parseItems(req.body.items, res);
    plan.items = items; plan.startDate = startDate; plan.endDate = endDate;
  }
  if (wasRejected || wasApproved) {
    plan.status = APPROVAL_STATUS.RESUBMITTED;
    plan.resubmitCount += 1;
    plan.feedback = '';
    plan.reviewedBy = undefined;
    plan.reviewedAt = undefined;
  }
  await plan.save();

  if (wasRejected || wasApproved) {
    await notifyReviewers(
      NOTIFICATION_TYPES.PLAN_RESUBMITTED,
      wasApproved ? 'Approved plan was changed' : 'Post plan resubmitted',
      wasApproved
        ? `${req.user.name} changed the approved plan "${plan.title}" - it needs approving again`
        : `${req.user.name} updated and resubmitted "${plan.title}"`,
      plan
    );
  }
  res.json({ success: true, plan });
});

// @route PUT /api/plans/:id/approve — ADMIN, or the org's CEO.
export const approvePlan = asyncHandler(async (req, res) => {
  const plan = await PostPlan.findById(req.params.id);
  if (!plan) { res.status(404); throw new Error('Plan not found'); }
  assertCanReview(req, res, plan);
  if (![APPROVAL_STATUS.PENDING, APPROVAL_STATUS.RESUBMITTED].includes(plan.status)) {
    res.status(400); throw new Error('This plan has already been reviewed');
  }
  plan.status = APPROVAL_STATUS.APPROVED;
  plan.reviewedBy = req.user._id;
  plan.reviewedAt = new Date();
  plan.feedback = '';
  await plan.save();

  await createNotification({
    recipient: plan.createdBy, organization: plan.organization,
    type: NOTIFICATION_TYPES.PLAN_APPROVED,
    title: 'Post plan approved 🎉',
    message: `"${plan.title}" was approved — you can start creating the posts.`,
    link: '/planner',
  });
  await logActivity({
    user: req.user._id, organization: plan.organization, action: ACTIVITY_ACTIONS.PLAN_REVIEWED,
    description: `Approved post plan "${plan.title}"`,
  });
  res.json({ success: true, plan });
});

// @route PUT /api/plans/:id/reject — ADMIN, or the org's CEO. Feedback required
// so the creator knows what to fix.
export const rejectPlan = asyncHandler(async (req, res) => {
  const plan = await PostPlan.findById(req.params.id);
  if (!plan) { res.status(404); throw new Error('Plan not found'); }
  assertCanReview(req, res, plan);
  if (![APPROVAL_STATUS.PENDING, APPROVAL_STATUS.RESUBMITTED].includes(plan.status)) {
    res.status(400); throw new Error('This plan has already been reviewed');
  }
  const feedback = String(req.body.feedback || '').trim();
  if (!feedback) { res.status(400); throw new Error('Tell the creator what to change (feedback is required)'); }
  plan.status = APPROVAL_STATUS.REJECTED;
  plan.feedback = feedback;
  plan.reviewedBy = req.user._id;
  plan.reviewedAt = new Date();
  await plan.save();

  await createNotification({
    recipient: plan.createdBy, organization: plan.organization,
    type: NOTIFICATION_TYPES.PLAN_REJECTED,
    title: 'Post plan needs changes',
    message: `"${plan.title}" was rejected: ${feedback}`,
    link: '/planner',
  });
  await logActivity({
    user: req.user._id, organization: plan.organization, action: ACTIVITY_ACTIONS.PLAN_REVIEWED,
    description: `Rejected post plan "${plan.title}"`,
  });
  res.json({ success: true, plan });
});

// @route DELETE /api/plans/:id/items/:itemId — super admin only (enforced by the
// route). Removes ONE planned post, e.g. to clear a same-day clash, leaving the
// rest of the plan and its approval status untouched.
export const deletePlanItem = asyncHandler(async (req, res) => {
  const plan = await PostPlan.findById(req.params.id);
  if (!plan) { res.status(404); throw new Error('Plan not found'); }
  const item = plan.items.id(req.params.itemId);
  if (!item) { res.status(404); throw new Error('Planned post not found in this plan'); }
  // A plan must keep at least one post — emptying it should be an explicit
  // "delete the plan" decision, not a side effect of removing the last row.
  if (plan.items.length === 1) {
    res.status(400);
    throw new Error('This is the only post in the plan — delete the whole plan instead');
  }

  const removed = { title: item.title, date: item.date, platforms: itemPlatforms(item) };
  plan.items.pull(item._id);
  // Keep the plan's window in step with what is left.
  const dates = plan.items.map((i) => new Date(i.date)).sort((a, b) => a - b);
  plan.startDate = dates[0];
  plan.endDate = dates[dates.length - 1];
  await plan.save();

  await logActivity({
    user: req.user._id,
    organization: plan.organization,
    action: ACTIVITY_ACTIONS.PLAN_REVIEWED,
    description: `Removed planned post "${removed.title}" (${removed.platforms.join(', ')}) from plan "${plan.title}"`,
  });
  res.json({ success: true, plan, removed });
});

// @route DELETE /api/plans/:id — creator or ADMIN.
export const deletePlan = asyncHandler(async (req, res) => {
  const plan = await PostPlan.findById(req.params.id);
  if (!plan) { res.status(404); throw new Error('Plan not found'); }
  if (req.user.role !== ROLES.ADMIN && String(plan.createdBy) !== String(req.user._id)) {
    res.status(403); throw new Error('Only the plan creator or an admin can delete it');
  }
  await plan.deleteOne();
  res.json({ success: true, message: 'Plan deleted' });
});
