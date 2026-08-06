// Shared social-post sync logic used by both the manual endpoint and the daily
// auto-sync job. FULL fetches ~a year (backfill); RECENT fetches the last several
// weeks (fast daily refresh that catches new posts + updates recent metrics).
import SocialPost from '../models/SocialPost.js';
import { hasToken as hasMeta, getPageToken, getInstagramPosts, getFacebookPosts } from './metaService.js';
import { hasKey as hasYt, getYoutubePosts } from './youtubeService.js';

export const SOCIAL_PLATFORMS = ['Instagram', 'Facebook', 'YouTube'];

const LIMITS = {
  full: { sinceDays: 365, Instagram: 200, Facebook: 200, YouTube: 300 },
  recent: { sinceDays: 45, Instagram: 60, Facebook: 60, YouTube: 80 },
};

const engagementRate = (p) => {
  const eng = (p.likes || 0) + (p.comments || 0) + (p.shares || 0) + (p.saved || 0);
  const base = p.impressions || p.reach || p.views || 0;
  return base > 0 ? +((eng / base) * 100).toFixed(2) : 0;
};

// Does this org have the mapping + is the platform connected?
export const orgSupports = (org, platform) => {
  if (platform === 'Instagram') return hasMeta() && !!org.metaInstagramId;
  if (platform === 'Facebook') return hasMeta() && !!org.metaPageId;
  if (platform === 'YouTube') return hasYt() && !!org.youtubeChannelId;
  return false;
};

const fetchPosts = async (org, platform, full) => {
  const cfg = full ? LIMITS.full : LIMITS.recent;
  if (platform === 'Instagram') {
    const pageToken = await getPageToken(org.metaPageId);
    return getInstagramPosts(org.metaInstagramId, pageToken, { limit: cfg.Instagram, sinceDays: cfg.sinceDays });
  }
  if (platform === 'Facebook') {
    return getFacebookPosts(org.metaPageId, null, { limit: cfg.Facebook, sinceDays: cfg.sinceDays });
  }
  if (platform === 'YouTube') {
    return getYoutubePosts(org.youtubeChannelId, { limit: cfg.YouTube });
  }
  return [];
};

export const upsertPosts = async (orgId, platform, posts) => {
  const now = new Date();
  let n = 0;
  for (const p of posts) {
    if (!p.postId) continue;
    await SocialPost.findOneAndUpdate(
      { organization: orgId, platform, postId: p.postId },
      { ...p, organization: orgId, platform, engagementRate: engagementRate(p), lastSyncedAt: now },
      { upsert: true, setDefaultsOnInsert: true }
    );
    n += 1;
  }
  return n;
};

// Sync one org + platform. Returns { synced } or { skipped:true }. The daily
// backfill/refresh loop over all orgs lives in services/dailyAnalyticsRefresh.js,
// which calls syncOrgPlatform per org alongside the account-metric snapshot.
export const syncOrgPlatform = async (org, platform, { full = false } = {}) => {
  if (!orgSupports(org, platform)) return { skipped: true, synced: 0 };
  const posts = await fetchPosts(org, platform, full);
  return { synced: await upsertPosts(org._id, platform, posts), full };
};
