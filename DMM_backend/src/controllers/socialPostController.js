import asyncHandler from 'express-async-handler';
import mongoose from 'mongoose';
import Organization from '../models/Organization.js';
import SocialPost from '../models/SocialPost.js';
import { hasToken as hasMetaToken } from '../services/metaService.js';
import { hasKey as hasYtKey } from '../services/youtubeService.js';
import { syncOrgPlatform, SOCIAL_PLATFORMS as PLATFORMS } from '../services/socialSync.js';
import { logActivity } from '../utils/logActivity.js';
import { resolveViewOrgId } from '../utils/org.js';
import { ACTIVITY_ACTIONS } from '../config/constants.js';

// Guards against a second sync for the same org+platform running concurrently.
const inFlight = new Set();

// @route POST /api/social-posts/sync  (ADMIN/CEO) — pull this organization's
// posts for a platform and upsert them. A full-year backfill can take a few
// minutes (hundreds of per-post insight calls), so the sync runs in the
// BACKGROUND: we validate, kick it off, and return immediately. Posts are
// upserted as they load, so the table fills in on refresh. Pass full:false for
// a quick recent-only refresh.
export const syncSocialPosts = asyncHandler(async (req, res) => {
  const { organizationId, platform } = req.body;
  const full = req.body.full !== false;
  if (!PLATFORMS.includes(platform)) { res.status(400); throw new Error('platform must be Instagram, Facebook or YouTube'); }
  if (!organizationId) { res.status(400); throw new Error('organizationId is required'); }
  const org = await Organization.findById(organizationId).select('name metaPageId metaInstagramId youtubeChannelId');
  if (!org) { res.status(404); throw new Error('Organization not found'); }

  // Clear, specific errors before attempting the pull.
  if (platform === 'Instagram' || platform === 'Facebook') {
    if (!hasMetaToken()) { res.status(503); throw new Error('Meta is not connected — set META_SYSTEM_TOKEN in the backend .env'); }
  } else if (!hasYtKey()) { res.status(503); throw new Error('YouTube is not connected — set YOUTUBE_API_KEY in the backend .env'); }
  const mapMsg = { Instagram: 'has no Instagram account mapped (Admin → map Meta accounts)', Facebook: 'has no Facebook page mapped', YouTube: 'has no YouTube channel mapped' };
  const mapped = platform === 'Instagram' ? org.metaInstagramId : platform === 'Facebook' ? org.metaPageId : org.youtubeChannelId;
  if (!mapped) { res.status(400); throw new Error(`${org.name} ${mapMsg[platform]}`); }

  const key = `${org._id}:${platform}`;
  if (inFlight.has(key)) {
    res.status(202).json({ success: true, started: true, alreadyRunning: true, platform, organization: org.name, message: `A ${platform} sync for ${org.name} is already running — refresh in a moment.` });
    return;
  }
  inFlight.add(key);
  // Fire-and-forget: runs after the response is sent. Posts upsert as they load.
  syncOrgPlatform(org, platform, { full })
    .then(({ synced }) => {
      logActivity({
        user: req.user._id, organization: org._id, action: ACTIVITY_ACTIONS.ANALYTICS_UPDATED,
        description: `Synced ${synced} ${platform} post${synced === 1 ? '' : 's'} for ${org.name}${full ? ' (full year)' : ''}`,
        entityType: 'SocialPost',
      });
    })
    .catch((err) => console.error(`[social-sync] ${platform} / ${org.name}: ${err.message}`))
    .finally(() => inFlight.delete(key));

  res.status(202).json({
    success: true, started: true, platform, organization: org.name, full,
    message: full
      ? 'Full-year sync started — the table fills in automatically over the next few minutes.'
      : 'Sync started — refresh in a moment.',
  });
});

// @route GET /api/social-posts/summary?organizationId=&platform=&range=  — period
// metrics from the stored posts: totals for the last `range` days vs the prior
// `range` days (so we can show 7 / 15 / 30 / 90 / 365-day comparisons), plus how
// many days of records we actually hold. Computed on the fly from SocialPost.
export const getSocialPostSummary = asyncHandler(async (req, res) => {
  const orgId = resolveViewOrgId(req); // any user may view any org
  const { platform } = req.query;
  if (!PLATFORMS.includes(platform)) { res.status(400); throw new Error('platform must be Instagram, Facebook or YouTube'); }
  const range = Math.min(Math.max(Number(req.query.range) || 30, 1), 365);
  const dayMs = 86400000;
  const now = Date.now();
  const orgMatch = { organization: new mongoose.Types.ObjectId(String(orgId)), platform };

  const SUM = {
    posts: { $sum: 1 }, reach: { $sum: '$reach' }, impressions: { $sum: '$impressions' },
    views: { $sum: '$views' }, likes: { $sum: '$likes' }, comments: { $sum: '$comments' },
    shares: { $sum: '$shares' }, saved: { $sum: '$saved' },
  };
  const window = async (gte, lt) => {
    const r = await SocialPost.aggregate([
      { $match: { ...orgMatch, publishedAt: { $gte: gte, $lt: lt } } },
      { $group: { _id: null, ...SUM } },
    ]);
    const o = r[0] || {};
    const out = { posts: 0, reach: 0, impressions: 0, views: 0, likes: 0, comments: 0, shares: 0, saved: 0, ...o };
    delete out._id;
    out.engagement = out.likes + out.comments + out.shares + out.saved;
    return out;
  };

  const [current, previous, cov] = await Promise.all([
    window(new Date(now - range * dayMs), new Date(now)),
    window(new Date(now - 2 * range * dayMs), new Date(now - range * dayMs)),
    SocialPost.aggregate([
      { $match: orgMatch },
      { $group: { _id: null, total: { $sum: 1 }, oldest: { $min: '$publishedAt' }, newest: { $max: '$publishedAt' }, lastSync: { $max: '$lastSyncedAt' } } },
    ]),
  ]);

  const c = cov[0];
  const coverage = c
    ? { total: c.total, oldest: c.oldest, newest: c.newest, lastSync: c.lastSync, days: (c.oldest && c.newest) ? Math.round((c.newest - c.oldest) / dayMs) + 1 : 0 }
    : { total: 0, days: 0 };

  res.json({ success: true, platform, range, coverage, current, previous });
});

// @route GET /api/social-posts?organizationId=&platform=&days=  — the post table.
export const getSocialPosts = asyncHandler(async (req, res) => {
  const orgId = resolveViewOrgId(req); // any user may view any org
  const { platform } = req.query;
  if (!PLATFORMS.includes(platform)) { res.status(400); throw new Error('platform must be Instagram, Facebook or YouTube'); }
  const days = Math.min(Math.max(Number(req.query.days) || 365, 7), 730);
  const since = new Date(Date.now() - days * 86400000);

  const [posts, coverage] = await Promise.all([
    SocialPost.find({ organization: orgId, platform, $or: [{ publishedAt: { $gte: since } }, { publishedAt: null }] })
      .sort({ publishedAt: -1 }).limit(200).lean(),
    SocialPost.aggregate([
      { $match: { organization: new mongoose.Types.ObjectId(String(orgId)), platform } },
      { $group: { _id: null, total: { $sum: 1 }, lastSync: { $max: '$lastSyncedAt' }, newest: { $max: '$publishedAt' }, oldest: { $min: '$publishedAt' } } },
    ]),
  ]);
  const cov = coverage[0]
    ? { total: coverage[0].total, lastSync: coverage[0].lastSync, newest: coverage[0].newest, oldest: coverage[0].oldest }
    : null;
  res.json({ success: true, platform, days, posts, coverage: cov });
});
