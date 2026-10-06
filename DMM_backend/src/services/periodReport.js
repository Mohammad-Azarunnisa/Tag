import mongoose from 'mongoose';
import Organization from '../models/Organization.js';
import InstitutionRequest, { POST_STAGES } from '../models/InstitutionRequest.js';
import ApprovalRequest from '../models/ApprovalRequest.js';
import WebTask from '../models/WebTask.js';
import WorkAssignment from '../models/WorkAssignment.js';
import AdCampaign from '../models/AdCampaign.js';
import Analytics from '../models/Analytics.js';
import SocialPost from '../models/SocialPost.js';
import LinkedInPost from '../models/LinkedInPost.js';
import Goal from '../models/Goal.js';
import User from '../models/User.js';
import { APPROVAL_TYPES, PLATFORMS, ROLES } from '../config/constants.js';

/**
 * The Branding & Marketing period report, assembled from live data.
 *
 * Five parts, matching how the team already reports upward:
 *   1 design output      2 web development   3 social organic
 *   4 paid ads           5 team output
 *
 * Everything here is measured, never estimated. Where the data to answer a column
 * genuinely isn't there, the figure comes back null and `gaps` says why.
 *
 * "Delivered on time" only ever penalises a due date that was actually missed.
 * A coordinator who never set one gave nobody a deadline to miss, so a finished
 * item counts as on time by default rather than being left out of the rate.
 *
 * Design output is measured off InstitutionRequest — the ask itself — rather
 * than the ApprovalRequest it carries, and only counts a design "delivered"
 * once BOTH gates it needs have been passed: the Admin approved the artwork,
 * AND the coordinator who asked for it confirmed it (`designAcceptedAt`,
 * which the workflow never sets on just the Admin's say-so). An Admin
 * approving alone flips the linked ApprovalRequest to APPROVED while the
 * request still sits on "Designs to be Done" waiting on the coordinator —
 * counting that as delivered would make the report disagree with the board
 * it is supposed to describe. Once both gates pass, the design counts as
 * delivered regardless of what happens next — whether it goes on to be
 * posted is a separate deliverable, tracked separately (see the Approvals
 * page's Posted tile), not a reason to hold the design itself back.
 */

const DAY = 86400000;
const round = (n, dp = 1) => (Number.isFinite(n) ? Math.round(n * 10 ** dp) / 10 ** dp : null);
const pct = (part, whole) => (whole ? round((part / whole) * 100) : null);
const sum = (rows, key) => rows.reduce((t, r) => t + (Number(r[key]) || 0), 0);

// A weighted mean, so the "all institutions" row reflects volume rather than
// treating a college with 3 designs the same as one with 40.
const weightedMean = (rows, valueKey, weightKey) => {
  const weight = sum(rows.filter((r) => r[valueKey] != null), weightKey);
  if (!weight) return null;
  const total = rows.reduce((t, r) => (r[valueKey] == null ? t : t + r[valueKey] * (Number(r[weightKey]) || 0)), 0);
  return round(total / weight);
};

const inWindow = (from, to) => ({ $gte: from, $lte: to });

// ---------------------------------------------------------------------------
// Part 1 — Design output
// ---------------------------------------------------------------------------
const designOutput = async (orgs, from, to) => {
  const rows = [];
  const mix = {};
  let anyCompleted = false;

  for (const org of orgs) {
    const scope = { organization: org._id };
    // "Received" counts what arrived in the window; the rest is measured on the
    // same set, so a design raised last period and finished in this one is not
    // double-counted as a new request. InstitutionRequest is the spine of the
    // whole pipeline (see its own model comment) — one row per ask, whichever
    // stage it has reached — so it is the one source of truth for this count,
    // rather than the ApprovalRequest that only exists once work starts on it.
    //
    // postOnly asks are excluded here: the creative already existed, so there
    // was never a design to deliver — they belong to the posting side of the
    // pipeline, not this one.
    const received = await InstitutionRequest.find({ ...scope, createdAt: inWindow(from, to), postOnly: { $ne: true } })
      .select('workflowStage neededBy createdAt designAcceptedAt workItem workCategory workType designApproval')
      .lean();

    // Delivered means both gates the design actually needs have been passed:
    // the Admin signed off on the artwork, AND the coordinator who asked for it
    // has confirmed it — `designAcceptedAt` is only ever set once both have
    // happened (it is the coordinator's confirmation, which the workflow
    // refuses before an Admin approval). That is the finish line for the
    // design itself, whether or not it goes on to be posted afterwards —
    // posting is a separate deliverable with its own count (see the Approvals
    // page's Posted tile), not part of whether the design was delivered.
    // A cancelled request never counts as delivered, even if it had been accepted before it was cancelled.
    const done = received.filter((r) => !!r.designAcceptedAt && r.workflowStage !== 'CANCELLED');
    const cancelled = received.filter((r) => r.workflowStage === 'CANCELLED');
    const finishedAt = (r) => r.designAcceptedAt || null;
    if (done.length) anyCompleted = true;

    // No due date isn't a missed one — if the coordinator never set one, there
    // was nothing to be late against, so a finished design counts as on time by
    // default. Only a due date that was actually missed counts against the rate.
    const onTime = done.filter((r) => !r.neededBy || (finishedAt(r) && finishedAt(r) <= new Date(r.neededBy)));

    // First-pass rate and revision rounds are tracked on the linked
    // ApprovalRequest (its resubmitCount), not on the request itself.
    const approvalIds = done.map((r) => r.designApproval).filter(Boolean);
    const approvals = approvalIds.length
      ? await ApprovalRequest.find({ _id: { $in: approvalIds } }).select('resubmitCount').lean()
      : [];
    const resubmitsById = new Map(approvals.map((a) => [String(a._id), a.resubmitCount || 0]));
    const resubmitsOf = (r) => resubmitsById.get(String(r.designApproval)) || 0;
    const firstPass = done.filter((r) => !resubmitsOf(r));

    const turnarounds = done.map((r) => (finishedAt(r) ? (new Date(finishedAt(r)) - new Date(r.createdAt)) / DAY : null))
      .filter((n) => n != null);

    const ownMix = {};
    for (const r of done) {
      const key = r.workItem || (r.workType === 'DIGITAL_MEDIA' ? 'Digital (unclassified)' : 'Print (unclassified)');
      mix[key] = (mix[key] || 0) + 1;
      ownMix[key] = (ownMix[key] || 0) + 1;
    }

    // Cancelled requests are dead, not real work — they never counted toward
    // "pending" (still in flight), and now they don't count toward the total
    // either. `cancelled` is reported on its own so it isn't just invisible.
    const requestsReceived = received.length - cancelled.length;

    // "Pending" as one number hides exactly where each one is stuck — the same
    // question the "Designs to be Done" board answers with its own stage
    // columns. Broken out here the same way, so the two never disagree.
    const stageCount = (stage) => received.filter((r) => r.workflowStage === stage).length;
    const pendingByStage = {
      waitingForDesigner: stageCount('DESIGN_OPEN'),
      beingDesigned: stageCount('DESIGN_IN_PROGRESS'),
      withAdminReview: stageCount('DESIGN_ADMIN_REVIEW'),
    };
    // A design waiting on the coordinator's own accept/decline is not the
    // design team's pending work, so it is left out of the pending count.
    const withCoordinator = stageCount('DESIGN_COORDINATOR_REVIEW');
    // Anything left over is neither delivered, cancelled, nor sitting in a
    // recognised design stage — old records from before workflowStage existed
    // (see the gaps note below), not a live backlog.
    const pending = requestsReceived - done.length - withCoordinator;
    pendingByStage.other = pending - Object.values(pendingByStage).reduce((a, b) => a + b, 0);

    rows.push({
      organization: { _id: org._id, name: org.name, code: org.code || '', color: org.color || '' },
      requestsReceived,
      completed: done.length,
      // Designers have finished these too; they are only waiting on the coordinator.
      designsCompleted: done.length + withCoordinator,
      pending,
      pendingByStage,
      cancelled: cancelled.length,
      deliveredOnTime: done.length ? onTime.length : null,
      onTimeRate: done.length ? pct(onTime.length, done.length) : null,
      approvedFirstPass: firstPass.length,
      firstPassRate: pct(firstPass.length, done.length),
      avgTurnaroundDays: turnarounds.length ? round(turnarounds.reduce((a, b) => a + b, 0) / turnarounds.length) : null,
      avgRevisionRounds: done.length ? round(done.reduce((s, r) => s + resubmitsOf(r), 0) / done.length) : null,
      mix: Object.entries(ownMix)
        .sort((a, b) => b[1] - a[1])
        .map(([label, count]) => ({ label, count, share: pct(count, done.length) })),
    });
  }

  const totals = {
    requestsReceived: sum(rows, 'requestsReceived'),
    completed: sum(rows, 'completed'),
    designsCompleted: sum(rows, 'designsCompleted'),
    pending: sum(rows, 'pending'),
    pendingByStage: {
      waitingForDesigner: sum(rows.map((r) => r.pendingByStage), 'waitingForDesigner'),
      beingDesigned: sum(rows.map((r) => r.pendingByStage), 'beingDesigned'),
      withAdminReview: sum(rows.map((r) => r.pendingByStage), 'withAdminReview'),
      other: sum(rows.map((r) => r.pendingByStage), 'other'),
    },
    cancelled: sum(rows, 'cancelled'),
    deliveredOnTime: anyCompleted ? sum(rows, 'deliveredOnTime') : null,
    onTimeRate: anyCompleted ? weightedMean(rows, 'onTimeRate', 'completed') : null,
    approvedFirstPass: sum(rows, 'approvedFirstPass'),
    firstPassRate: weightedMean(rows, 'firstPassRate', 'completed'),
    avgTurnaroundDays: weightedMean(rows, 'avgTurnaroundDays', 'completed'),
    avgRevisionRounds: weightedMean(rows, 'avgRevisionRounds', 'completed'),
  };

  const mixTotal = Object.values(mix).reduce((a, b) => a + b, 0);
  return {
    rows,
    totals,
    mix: Object.entries(mix)
      .sort((a, b) => b[1] - a[1])
      .map(([label, count]) => ({ label, count, share: pct(count, mixTotal) })),
  };
};

// ---------------------------------------------------------------------------
// Part 2 — Web development
// ---------------------------------------------------------------------------
const webDevelopment = async (orgs, from, to) => {
  const rows = [];
  const mix = {};
  let anyCompleted = false;

  for (const org of orgs) {
    const received = await WebTask.find({ organization: org._id, createdAt: inWindow(from, to) })
      .select('status createdAt completedAt dueDate taskType').lean();
    const done = received.filter((t) => t.status === 'COMPLETED' && t.completedAt);
    if (done.length) anyCompleted = true;

    // No due date isn't a missed one — see designOutput above for why a
    // finished task with nothing set counts as on time by default.
    const onTime = done.filter((t) => !t.dueDate || new Date(t.completedAt) <= new Date(t.dueDate));

    const turnarounds = done.map((t) => (new Date(t.completedAt) - new Date(t.createdAt)) / DAY);
    for (const t of done) mix[t.taskType || 'Other'] = (mix[t.taskType || 'Other'] || 0) + 1;

    rows.push({
      organization: { _id: org._id, name: org.name, code: org.code || '', color: org.color || '' },
      tasksReceived: received.length,
      completed: done.length,
      pending: received.length - done.length,
      deliveredOnTime: done.length ? onTime.length : null,
      onTimeRate: done.length ? pct(onTime.length, done.length) : null,
      avgTurnaroundDays: turnarounds.length ? round(turnarounds.reduce((a, b) => a + b, 0) / turnarounds.length) : null,
    });
  }

  const mixTotal = Object.values(mix).reduce((a, b) => a + b, 0);
  return {
    rows,
    totals: {
      tasksReceived: sum(rows, 'tasksReceived'),
      completed: sum(rows, 'completed'),
      pending: sum(rows, 'pending'),
      deliveredOnTime: anyCompleted ? sum(rows, 'deliveredOnTime') : null,
      onTimeRate: anyCompleted ? weightedMean(rows, 'onTimeRate', 'completed') : null,
      avgTurnaroundDays: weightedMean(rows, 'avgTurnaroundDays', 'completed'),
    },
    mix: Object.entries(mix).sort((a, b) => b[1] - a[1])
      .map(([label, count]) => ({ label, count, share: pct(count, mixTotal) })),
  };
};

// ---------------------------------------------------------------------------
// Part 3 — Social media, organic
// ---------------------------------------------------------------------------
// Engagement rate is normalised the same way for every account —
// (likes + comments + shares) / impressions — so the comparison is fair even
// though each platform reports its own version of the number.
const socialOrganic = async (orgs, from, to, platformFilter) => {
  const rows = [];
  const platformCounts = {};
  // A single-platform filter narrows every figure in this section to just that
  // platform (used by the PDF export's "Social Media" filter — see
  // periodReportController.js#exportPeriodReportPdf). LinkedIn lives in its own
  // collection (LinkedInPost) rather than tagged rows in SocialPost, so it only
  // ever enters the totals when there's no filter, or the filter IS LinkedIn.
  const includeLinkedIn = !platformFilter || platformFilter === 'LinkedIn';

  for (const org of orgs) {
    const postQuery = { organization: org._id, publishedAt: inWindow(from, to) };
    if (platformFilter) postQuery.platform = platformFilter;
    const posts = await SocialPost.find(postQuery)
      .select('platform reach impressions likes comments shares saved views').lean();
    const liPosts = includeLinkedIn
      ? await LinkedInPost.find({ organization: org._id, createdDate: inWindow(from, to) })
          .select('impressions reactions comments reposts clicks').lean()
      : [];

    for (const p of posts) platformCounts[p.platform] = (platformCounts[p.platform] || 0) + 1;
    if (liPosts.length) platformCounts.LinkedIn = (platformCounts.LinkedIn || 0) + liPosts.length;

    // LinkedIn's post export carries no reach column; its reach is the page's
    // daily "unique impressions" (the export's Metrics sheet), summed over the
    // window — added up day by day, the same way Instagram reach is added up
    // post by post.
    const liReach = includeLinkedIn
      ? sum(await Analytics.find({ organization: org._id, platform: 'LinkedIn', date: inWindow(from, to) })
          .select('uniqueImpressions').lean(), 'uniqueImpressions')
      : 0;
    const reach = sum(posts, 'reach') + liReach;
    const impressions = sum(posts, 'impressions') + sum(liPosts, 'impressions');
    const likes = sum(posts, 'likes') + sum(liPosts, 'reactions');
    const comments = sum(posts, 'comments') + sum(liPosts, 'comments');
    const shares = sum(posts, 'shares') + sum(liPosts, 'reposts');
    const interactions = likes + comments + shares;

    // Followers: where the audience stood at the end of the window, and how much
    // of that was added inside it.
    const audience = {};
    const audiencePlatforms = platformFilter ? [platformFilter] : PLATFORMS;
    for (const platform of audiencePlatforms) {
      const field = platform === 'YouTube' ? 'subscribers' : 'followers';
      const [last, first] = await Promise.all([
        Analytics.findOne({ organization: org._id, platform, [field]: { $gt: 0 }, date: { $lte: to } })
          .sort({ date: -1 }).select(field).lean(),
        Analytics.findOne({ organization: org._id, platform, [field]: { $gt: 0 }, date: { $lte: from } })
          .sort({ date: -1 }).select(field).lean(),
      ]);
      audience[platform] = { end: last?.[field] || 0, start: first?.[field] || 0 };
    }
    const followers = Object.values(audience).reduce((t, a) => t + a.end, 0);
    const followerGrowth = Object.values(audience)
      .reduce((t, a) => t + Math.max(0, a.end - (a.start || a.end)), 0);

    // The same figures split per platform, so a reader can see how this one
    // college is doing on each of its channels rather than only in aggregate.
    // A platform is listed when it had posts in the window or an audience.
    const platforms = [];
    for (const platform of (platformFilter ? [platformFilter] : PLATFORMS)) {
      const isLi = platform === 'LinkedIn';
      const pPosts = isLi ? liPosts : posts.filter((p) => p.platform === platform);
      const pImpr = sum(pPosts, 'impressions');
      const pLikes = isLi ? sum(pPosts, 'reactions') : sum(pPosts, 'likes');
      const pInter = isLi
        ? sum(pPosts, 'reactions') + sum(pPosts, 'comments') + sum(pPosts, 'reposts')
        : sum(pPosts, 'likes') + sum(pPosts, 'comments') + sum(pPosts, 'shares');
      const aud = audience[platform] || { end: 0, start: 0 };
      if (!pPosts.length && !aud.end && !(isLi && liReach)) continue;
      platforms.push({
        platform,
        posts: pPosts.length,
        reach: isLi ? liReach : sum(pPosts, 'reach'),
        impressions: pImpr,
        likes: pLikes,
        interactions: pInter,
        engagementRate: pImpr ? round((pInter / pImpr) * 100, 2) : null,
        followers: aud.end,
        followerGrowth: Math.max(0, aud.end - (aud.start || aud.end)),
      });
    }

    rows.push({
      platforms,
      organization: { _id: org._id, name: org.name, code: org.code || '', color: org.color || '' },
      posts: posts.length + liPosts.length,
      reach,
      impressions,
      likes,
      comments,
      shares,
      interactions,
      engagementRate: impressions ? round((interactions / impressions) * 100, 2) : null,
      followers,
      followerGrowth,
    });
  }

  const totalImpressions = sum(rows, 'impressions');
  const totalInteractions = sum(rows, 'interactions');
  const postsTotal = sum(rows, 'posts');

  // Ranked by likes received in the period.
  const leaderboard = rows
    .filter((r) => r.posts > 0 || r.likes > 0)
    .sort((a, b) => b.likes - a.likes)
    .map((r, i) => ({
      rank: i + 1,
      organization: r.organization,
      posts: r.posts,
      reach: r.reach,
      likes: r.likes,
      engagementRate: r.engagementRate,
      followers: r.followers,
      followerGrowth: r.followerGrowth,
    }));

  // The stand-out posts of the period, by their own engagement rate.
  const orgIds = orgs.map((o) => o._id);
  // Cut by character, not UTF-16 unit, so a styled or emoji character is never
  // split in half at the 90-character mark.
  const shortTitle = (t) => Array.from(t || 'Untitled post').slice(0, 90).join('');
  // Rated against impressions, except YouTube, which reports views instead;
  // `audienceCount`/`audienceLabel` say which audience figure each post shows.
  const topQuery = {
    organization: { $in: orgIds },
    publishedAt: inWindow(from, to),
    $or: [{ likes: { $gt: 0 } }, { impressions: { $gt: 0 } }, { platform: 'YouTube', views: { $gt: 0 } }],
  };
  if (platformFilter) topQuery.platform = platformFilter;
  const topRaw = await SocialPost.find(topQuery)
    .select('organization platform caption message title reach impressions views likes comments shares publishedAt')
    .populate('organization', 'name code').lean();
  const fromSynced = topRaw.map((p) => {
    const inter = (p.likes || 0) + (p.comments || 0) + (p.shares || 0);
    const byViews = !(p.impressions > 0);
    return {
      organization: p.organization,
      platform: p.platform,
      title: shortTitle(p.title || p.caption || p.message),
      reach: p.reach || 0,
      likes: p.likes || 0,
      audienceCount: byViews ? p.views : (p.reach || p.impressions),
      audienceLabel: byViews ? 'views' : (p.reach ? 'reach' : 'impressions'),
      engagementRate: (byViews ? p.views : p.impressions) ? round((inter / (byViews ? p.views : p.impressions)) * 100, 2) : null,
      publishedAt: p.publishedAt,
    };
  });
  const liTop = includeLinkedIn
    ? await LinkedInPost.find({ organization: { $in: orgIds }, createdDate: inWindow(from, to), impressions: { $gt: 0 } })
        .select('organization title impressions reactions comments reposts createdDate')
        .populate('organization', 'name code').lean()
    : [];
  const fromLinkedIn = liTop.map((p) => ({
    organization: p.organization,
    platform: 'LinkedIn',
    title: shortTitle(p.title),
    reach: 0,
    audienceCount: p.impressions,
    audienceLabel: 'impressions',
    likes: p.reactions || 0,
    engagementRate: round((((p.reactions || 0) + (p.comments || 0) + (p.reposts || 0)) / p.impressions) * 100, 2),
    publishedAt: p.createdDate,
  }));
  const rankedPosts = [...fromSynced, ...fromLinkedIn].sort((a, b) => (b.likes - a.likes) || ((b.engagementRate || 0) - (a.engagementRate || 0)));
  const topPosts = rankedPosts.slice(0, 5);
  // Each college's best post on each platform it used, for its page in the
  // PDF — one ranking across platforms would hand every slot to whichever
  // platform runs the highest rates (usually Instagram).
  const topPostsByOrg = {};
  for (const p of rankedPosts) {
    const key = String(p.organization?._id || p.organization);
    const list = topPostsByOrg[key] || (topPostsByOrg[key] = []);
    if (!list.some((q) => q.platform === p.platform)) list.push(p);
  }

  return {
    rows,
    totals: {
      posts: postsTotal,
      reach: sum(rows, 'reach'),
      impressions: totalImpressions,
      likes: sum(rows, 'likes'),
      comments: sum(rows, 'comments'),
      shares: sum(rows, 'shares'),
      interactions: totalInteractions,
      engagementRate: totalImpressions ? round((totalInteractions / totalImpressions) * 100, 2) : null,
      followers: sum(rows, 'followers'),
      followerGrowth: sum(rows, 'followerGrowth'),
    },
    byPlatform: Object.entries(platformCounts).sort((a, b) => b[1] - a[1])
      .map(([label, count]) => ({ label, count, share: pct(count, postsTotal) })),
    // Every organisation's per-platform figures summed, so "how is each
    // platform doing across all colleges" has its own answer.
    platformTotals: (() => {
      const acc = {};
      for (const r of rows) {
        for (const p of r.platforms) {
          const a = acc[p.platform] || (acc[p.platform] = {
            platform: p.platform, posts: 0, reach: 0, impressions: 0, likes: 0, interactions: 0, followers: 0, followerGrowth: 0,
          });
          a.likes += p.likes || 0;
          a.posts += p.posts; a.reach += p.reach; a.impressions += p.impressions;
          a.interactions += p.interactions; a.followers += p.followers; a.followerGrowth += p.followerGrowth;
        }
      }
      return PLATFORMS.filter((p) => acc[p]).map((p) => ({
        ...acc[p],
        engagementRate: acc[p].impressions ? round((acc[p].interactions / acc[p].impressions) * 100, 2) : null,
      }));
    })(),
    leaderboard,
    topPosts,
    topPostsByOrg,
  };
};

// ---------------------------------------------------------------------------
// Part 4 — Paid ads
// ---------------------------------------------------------------------------
const paidAds = async (orgs, from, to) => {
  const rows = [];
  const byChannel = {};

  for (const org of orgs) {
    // A campaign belongs to the period if it overlaps it at all.
    const campaigns = await AdCampaign.find({
      organization: org._id, startDate: { $lte: to }, endDate: { $gte: from },
    }).lean();

    const spend = sum(campaigns, 'spend');
    const reach = sum(campaigns, 'reach');
    const impressions = sum(campaigns, 'impressions');
    const clicks = sum(campaigns, 'clicks');
    const leads = sum(campaigns, 'leads');
    for (const c of campaigns) byChannel[c.channel] = (byChannel[c.channel] || 0) + (Number(c.spend) || 0);

    rows.push({
      organization: { _id: org._id, name: org.name, code: org.code || '', color: org.color || '' },
      spend, reach, impressions, clicks, leads,
      frequency: reach ? round(impressions / reach, 2) : null,
      ctr: impressions ? round((clicks / impressions) * 100, 2) : null,
      cpm: impressions ? round((spend / impressions) * 1000, 0) : null,
      cpc: clicks ? round(spend / clicks, 2) : null,
      // Whole rupees: nobody quotes a cost per lead to a decimal place.
      costPerLead: leads ? round(spend / leads, 0) : null,
    });
  }

  const spend = sum(rows, 'spend');
  const reach = sum(rows, 'reach');
  const impressions = sum(rows, 'impressions');
  const clicks = sum(rows, 'clicks');
  const leads = sum(rows, 'leads');

  const orgIds = orgs.map((o) => o._id);
  const top = await AdCampaign.find({
    organization: { $in: orgIds }, startDate: { $lte: to }, endDate: { $gte: from },
  }).sort({ spend: -1 }).limit(5).populate('organization', 'name code').lean();

  const channelTotal = Object.values(byChannel).reduce((a, b) => a + b, 0);
  return {
    rows,
    totals: {
      spend, reach, impressions, clicks, leads,
      frequency: reach ? round(impressions / reach, 2) : null,
      ctr: impressions ? round((clicks / impressions) * 100, 2) : null,
      cpm: impressions ? round((spend / impressions) * 1000, 0) : null,
      cpc: clicks ? round(spend / clicks, 2) : null,
      costPerLead: leads ? round(spend / leads, 0) : null,
    },
    byChannel: Object.entries(byChannel).sort((a, b) => b[1] - a[1])
      .map(([label, amount]) => ({ label, amount, share: pct(amount, channelTotal) })),
    topCampaigns: top.map((c) => ({
      organization: c.organization,
      name: c.name,
      objective: c.objective,
      spend: c.spend,
      leads: c.leads,
      // An awareness campaign has no leads by design — say so rather than
      // printing a cost per lead of zero.
      costPerLead: c.leads ? round(c.spend / c.leads, 0) : null,
      note: c.leads ? '' : 'awareness — no leads',
    })),
  };
};

// ---------------------------------------------------------------------------
// Part 5 — Team output
// ---------------------------------------------------------------------------
const teamOutput = async (orgs, from, to) => {
  // Scoped to the same organizations as the other four sections — without
  // this, the section leaked every college's staff performance data to
  // whoever called the report, regardless of which orgs they were allowed.
  const orgIds = orgs.map((o) => o._id);
  const people = await User.find({
    isActive: true,
    organization: { $in: orgIds },
    $or: [
      { role: ROLES.USER, userType: { $in: ['DESIGNER', 'SOCIAL_HANDLER'] } },
      { role: ROLES.CEO },
    ],
  }).select('name jobTitle role userType').lean();

  const rows = [];
  let anyCompleted = false;

  for (const person of people) {
    const assigned = await WorkAssignment.find({ assignee: person._id, organization: { $in: orgIds }, createdAt: inWindow(from, to) })
      .select('status createdAt completedAt dueDate assigneeType platform').lean();
    if (!assigned.length) continue;

    const done = assigned.filter((a) => a.status === 'DONE' && a.completedAt);
    if (done.length) anyCompleted = true;
    // No due date isn't a missed one — see designOutput above for why a
    // finished assignment with nothing set counts as on time by default.
    const onTime = done.filter((a) => !a.dueDate || new Date(a.completedAt) <= new Date(a.dueDate));
    const turnarounds = done.map((a) => (new Date(a.completedAt) - new Date(a.createdAt)) / DAY);

    // What they produced, split the way the report splits it.
    const designTasks = await ApprovalRequest.countDocuments({
      designer: person._id, organization: { $in: orgIds }, type: APPROVAL_TYPES.DESIGN, createdAt: inWindow(from, to),
    });
    const socialCreatives = await ApprovalRequest.countDocuments({
      createdBy: person._id, organization: { $in: orgIds }, type: APPROVAL_TYPES.POST, createdAt: inWindow(from, to),
    });
    const webTasks = await WebTask.countDocuments({ assignee: person._id, organization: { $in: orgIds }, createdAt: inWindow(from, to) });

    rows.push({
      person: { _id: person._id, name: person.name, role: person.jobTitle || person.userType || person.role },
      tasksAssigned: assigned.length,
      completed: done.length,
      pending: assigned.length - done.length,
      designTasks,
      socialCreatives,
      webTasks,
      deliveredOnTime: done.length ? onTime.length : null,
      onTimeRate: done.length ? pct(onTime.length, done.length) : null,
      avgTurnaroundDays: turnarounds.length ? round(turnarounds.reduce((a, b) => a + b, 0) / turnarounds.length) : null,
    });
  }

  rows.sort((a, b) => b.tasksAssigned - a.tasksAssigned);
  return {
    rows,
    totals: {
      people: rows.length,
      tasksAssigned: sum(rows, 'tasksAssigned'),
      completed: sum(rows, 'completed'),
      pending: sum(rows, 'pending'),
      designTasks: sum(rows, 'designTasks'),
      socialCreatives: sum(rows, 'socialCreatives'),
      webTasks: sum(rows, 'webTasks'),
      deliveredOnTime: anyCompleted ? sum(rows, 'deliveredOnTime') : null,
      onTimeRate: anyCompleted ? weightedMean(rows, 'onTimeRate', 'completed') : null,
      avgTurnaroundDays: weightedMean(rows, 'avgTurnaroundDays', 'completed'),
    },
  };
};

// ---------------------------------------------------------------------------
// Part 6 — Publishing pipeline
// ---------------------------------------------------------------------------
// Design Output stops the moment the coordinator accepts the artwork — it
// never says whether that design actually went out. This part picks up
// exactly there: how much work entered the posting half this period, how
// much of it was actually published, how long that took, and what's still
// sitting in the queue. `postOnly` asks (a ready-made creative that only
// needs posting, never a design) skip the design half entirely, so they
// "enter" the posting half the moment they're raised rather than the moment
// a design is accepted.
const publishingPipeline = async (orgs, from, to) => {
  const rows = [];
  const platformMix = {};
  let postOnlyPosted = 0;

  for (const org of orgs) {
    const scope = { organization: org._id };

    const entered = await InstitutionRequest.countDocuments({
      ...scope,
      $or: [
        { postOnly: { $ne: true }, designAcceptedAt: inWindow(from, to) },
        { postOnly: true, createdAt: inWindow(from, to) },
      ],
    });

    // Posting is done by hand outside t@g, so work sitting in "To Be Posted"
    // counts as posted, dated from the day it entered that board; anything the
    // handler did mark posted keeps its own posted date.
    const enteredWindow = [
      { postOnly: { $ne: true }, designAcceptedAt: inWindow(from, to) },
      { postOnly: true, createdAt: inWindow(from, to) },
    ];
    const posted = await InstitutionRequest.find({
      ...scope,
      $or: [
        { postedAt: inWindow(from, to) },
        { workflowStage: { $in: POST_STAGES }, $or: enteredWindow },
      ],
    }).select('postedAt designAcceptedAt createdAt postOnly postPlatforms workflowStage').lean();

    const scheduled = await InstitutionRequest.countDocuments({ ...scope, scheduledFor: { $ne: null }, postedAt: null });
    // A live snapshot, not period-bound — the same convention designOutput's
    // pendingByStage uses for "where is the backlog right now".
    const backlog = await InstitutionRequest.countDocuments({ ...scope, workflowStage: { $in: POST_STAGES } });

    const turnarounds = posted
      .map((p) => {
        if (POST_STAGES.includes(p.workflowStage)) return 0;
        const start = p.postOnly ? p.createdAt : p.designAcceptedAt;
        return start ? (new Date(p.postedAt) - new Date(start)) / DAY : null;
      })
      .filter((n) => n != null);

    posted.forEach((p) => {
      if (p.postOnly) postOnlyPosted += 1;
      for (const platform of p.postPlatforms || []) platformMix[platform] = (platformMix[platform] || 0) + 1;
    });

    rows.push({
      organization: { _id: org._id, name: org.name, code: org.code || '', color: org.color || '' },
      entered,
      posted: posted.length,
      scheduled,
      backlog,
      avgDaysToPost: turnarounds.length ? round(turnarounds.reduce((a, b) => a + b, 0) / turnarounds.length) : null,
    });
  }

  const postedTotal = sum(rows, 'posted');
  const platformTotal = Object.values(platformMix).reduce((a, b) => a + b, 0);
  return {
    rows,
    totals: {
      entered: sum(rows, 'entered'),
      posted: postedTotal,
      scheduled: sum(rows, 'scheduled'),
      backlog: sum(rows, 'backlog'),
      avgDaysToPost: weightedMean(rows, 'avgDaysToPost', 'posted'),
      postOnlyShare: postedTotal ? pct(postOnlyPosted, postedTotal) : null,
    },
    byPlatform: Object.entries(platformMix).sort((a, b) => b[1] - a[1])
      .map(([label, count]) => ({ label, count, share: pct(count, platformTotal) })),
  };
};

// ---------------------------------------------------------------------------
// Part 7 — Goal attainment
// ---------------------------------------------------------------------------
// A goal runs on its own start/end dates (set whenever someone raised it),
// never on this report's window — only goals whose own window overlaps this
// report's are counted, and each one's progress is computed exactly the way
// the Goals page computes it (goalController's computeProgress), inlined
// here rather than imported so this stays a plain read like every other part.
const audienceFieldFor = (platform) => (platform === 'YouTube' ? 'subscribers' : 'followers');

const goalAttainment = async (orgs, from, to) => {
  const orgIds = orgs.map((o) => o._id);
  const goals = await Goal.find({
    organization: { $in: orgIds },
    startDate: { $lte: to },
    endDate: { $gte: from },
  }).lean();

  const orgById = new Map(orgs.map((o) => [String(o._id), o]));
  const rows = [];
  for (const goal of goals) {
    const org = orgById.get(String(goal.organization));
    if (!org) continue;
    const field = audienceFieldFor(goal.platform);
    const [latest, baselineSnap, postsPublished] = await Promise.all([
      Analytics.findOne({ organization: goal.organization, platform: goal.platform, [field]: { $gt: 0 } }).sort({ date: -1 }).lean(),
      Analytics.findOne({ organization: goal.organization, platform: goal.platform, [field]: { $gt: 0 }, date: { $lte: goal.startDate } }).sort({ date: -1 }).lean(),
      ApprovalRequest.countDocuments({
        organization: goal.organization, platform: goal.platform, status: 'POSTED',
        postedAt: { $gte: goal.startDate, $lte: goal.endDate },
      }),
    ]);
    const currentFollowers = latest?.[field] || 0;
    const baselineFollowers = baselineSnap?.[field] || 0;
    const gainedFollowers = Math.max(0, currentFollowers - baselineFollowers);

    rows.push({
      organization: { _id: org._id, name: org.name, code: org.code || '', color: org.color || '' },
      platform: goal.platform,
      targetFollowers: goal.targetFollowers,
      gainedFollowers,
      followerProgress: goal.targetFollowers ? pct(gainedFollowers, goal.targetFollowers) : null,
      targetPosts: goal.targetPosts,
      postsPublished,
      postProgress: goal.targetPosts ? pct(postsPublished, goal.targetPosts) : null,
      startDate: goal.startDate,
      endDate: goal.endDate,
    });
  }

  return {
    rows,
    totals: {
      goals: rows.length,
      targetFollowers: sum(rows, 'targetFollowers'),
      gainedFollowers: sum(rows, 'gainedFollowers'),
      targetPosts: sum(rows, 'targetPosts'),
      postsPublished: sum(rows, 'postsPublished'),
    },
  };
};

// ---------------------------------------------------------------------------
// Timeline — the period itself, broken into days (windows up to two weeks) or
// weeks, with how much happened in each: design requests raised, designs
// delivered (accepted by the coordinator), and social posts published. The
// totals elsewhere say how much; this says when.
// ---------------------------------------------------------------------------
const activityTimeline = async (orgs, from, to, platformFilter) => {
  const orgIds = orgs.map((o) => o._id);
  const days = Math.max(1, Math.round((to - from) / DAY) + 1);
  const step = days <= 14 ? 1 : 7;
  const span = step * DAY;
  const buckets = [];
  for (let t = from.getTime(); t <= to.getTime(); t += span) {
    buckets.push({ from: new Date(t), to: new Date(Math.min(t + span - 1, to.getTime())), requests: 0, delivered: 0, posts: 0 });
  }
  const includeLinkedIn = !platformFilter || platformFilter === 'LinkedIn';

  const [requests, delivered, posts, liPosts] = await Promise.all([
    InstitutionRequest.find({ organization: { $in: orgIds }, postOnly: { $ne: true }, createdAt: inWindow(from, to) }).select('organization createdAt').lean(),
    InstitutionRequest.find({ organization: { $in: orgIds }, designAcceptedAt: inWindow(from, to) }).select('organization designAcceptedAt').lean(),
    SocialPost.find({ organization: { $in: orgIds }, publishedAt: inWindow(from, to), ...(platformFilter ? { platform: platformFilter } : {}) }).select('organization publishedAt').lean(),
    includeLinkedIn ? LinkedInPost.find({ organization: { $in: orgIds }, createdDate: inWindow(from, to) }).select('organization createdDate').lean() : [],
  ]);
  // The same buckets per college, for each college's own page.
  const byOrg = {};
  const orgSeries = (doc) => {
    const key = String(doc.organization);
    return byOrg[key] || (byOrg[key] = buckets.map(() => ({ requests: 0, delivered: 0, posts: 0 })));
  };
  const tally = (list, dateOf, field) => {
    for (const d of list) {
      const i = Math.floor((new Date(dateOf(d)) - from) / span);
      if (!buckets[i]) continue;
      buckets[i][field] += 1;
      orgSeries(d)[i][field] += 1;
    }
  };
  tally(requests, (r) => r.createdAt, 'requests');
  tally(delivered, (r) => r.designAcceptedAt, 'delivered');
  tally(posts, (p) => p.publishedAt, 'posts');
  tally(liPosts, (p) => p.createdDate, 'posts');

  return {
    granularity: step === 1 ? 'day' : 'week',
    buckets: buckets.map((b) => ({ ...b, from: b.from.toISOString().slice(0, 10), to: b.to.toISOString().slice(0, 10) })),
    byOrg,
  };
};

/**
 * Build the whole report for a window.
 *
 * @param {Date} from   start of the period (inclusive)
 * @param {Date} to     end of the period (inclusive)
 * @param {Array} orgIds  limit to these organizations; omit for every active one
 * @param {String} platform  narrow Part 3 (Social organic) to one platform only —
 *   design/web/ads/team have no platform dimension of their own, so this only
 *   ever affects the social section (see socialOrganic above).
 */
export const buildPeriodReport = async ({ from, to, orgIds, platform } = {}) => {
  const query = { isActive: true };
  if (orgIds?.length) {
    query._id = { $in: orgIds.map((id) => new mongoose.Types.ObjectId(String(id))) };
  }
  const orgs = await Organization.find(query).select('name code color').sort({ name: 1 }).lean();

  const [design, web, social, ads, team, publishing, goals, timeline] = await Promise.all([
    designOutput(orgs, from, to),
    webDevelopment(orgs, from, to),
    socialOrganic(orgs, from, to, platform),
    paidAds(orgs, from, to),
    teamOutput(orgs, from, to),
    publishingPipeline(orgs, from, to),
    goalAttainment(orgs, from, to),
    activityTimeline(orgs, from, to, platform),
  ]);

  // The headline tiles, taken straight off the five parts so they can never
  // disagree with the tables under them.
  const headline = {
    designsDelivered: { value: design.totals.completed, of: design.totals.requestsReceived },
    deliveredOnTimeRate: design.totals.onTimeRate,
    webTasksDone: { value: web.totals.completed, of: web.totals.tasksReceived },
    postsPublished: social.totals.posts,
    engagementRate: social.totals.engagementRate,
    likes: social.totals.likes,
    adSpend: ads.totals.spend,
    designPending: design.totals.pending,
    designsCompleted: design.totals.designsCompleted,
    designCancelled: design.totals.cancelled,
    avgTurnaroundDays: design.totals.avgTurnaroundDays,
    firstPassRate: design.totals.firstPassRate,
    avgRevisionRounds: design.totals.avgRevisionRounds,
    organicReach: social.totals.reach,
    followerGrowth: social.totals.followerGrowth,
    paidReach: ads.totals.reach,
    leadsFromAds: ads.totals.leads,
    costPerLead: ads.totals.costPerLead,
    teamTasksDone: { value: team.totals.completed, of: team.totals.tasksAssigned },
  };

  // Be explicit about what the numbers cannot tell you yet, so nobody reads a
  // blank as a zero.
  const gaps = [];
  if (!web.totals.tasksReceived) gaps.push('No web tasks recorded for this period.');
  if (!ads.totals.spend) gaps.push('No ad campaigns recorded for this period, so the paid section is empty.');
  else if (!ads.totals.leads) gaps.push('Ad spend is recorded but no leads, so cost per lead cannot be worked out.');

  return {
    period: {
      from: from.toISOString().slice(0, 10),
      to: to.toISOString().slice(0, 10),
      days: Math.max(1, Math.round((to - from) / DAY) + 1),
    },
    generatedAt: new Date().toISOString(),
    organizations: orgs.map((o) => ({ _id: o._id, name: o.name, code: o.code || '', color: o.color || '' })),
    headline,
    design,
    web,
    social,
    ads,
    team,
    publishing,
    goals,
    timeline,
    gaps,
  };
};

/** The calendar month that has just finished, which is what the monthly run covers. */
export const lastCompleteMonth = (now = new Date()) => {
  const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 0, 23, 59, 59, 999));
  const start = new Date(Date.UTC(end.getUTCFullYear(), end.getUTCMonth(), 1, 0, 0, 0, 0));
  return { from: start, to: end };
};
