import Organization from '../models/Organization.js';
import SocialPost from '../models/SocialPost.js';
import { getPageToken, getInstagramMetrics, getFacebookMetrics } from './metaService.js';
import { getYoutubeMetrics } from './youtubeService.js';
import { upsertDailySnapshot } from './analyticsSnapshot.js';
import { syncOrgPlatform, orgSupports, SOCIAL_PLATFORMS } from './socialSync.js';

const DEFAULT_TIME = '02:00';

function parseTime(value) {
  const m = String(value || DEFAULT_TIME).trim().match(/^([01]?\d|2[0-3]):([0-5]\d)$/);
  const hour = m ? Number(m[1]) : 2;
  const minute = m ? Number(m[2]) : 0;
  return { hour, minute };
}

function msUntilNextRun(timeStr) {
  const { hour, minute } = parseTime(timeStr);
  const now = new Date();
  const next = new Date(now);
  next.setUTCHours(hour, minute, 0, 0);
  if (next <= now) next.setUTCDate(next.getUTCDate() + 1);
  return next.getTime() - now.getTime();
}

async function refreshOrganization(org) {
  const report = {
    organization: { _id: org._id, name: org.name },
    synced: [],
    skipped: [],
    errors: [],
  };

  let pageToken = null;
  if (org.metaPageId) {
    try {
      pageToken = await getPageToken(org.metaPageId);
    } catch (err) {
      report.errors.push(`Meta page token: ${err.message}`);
    }
  }

  if (org.metaInstagramId) {
    try {
      const metrics = await getInstagramMetrics(org.metaInstagramId, pageToken);
      if (Object.keys(metrics).length) {
        await upsertDailySnapshot(org._id, 'Instagram', metrics);
        report.synced.push('Instagram');
      } else {
        report.skipped.push('Instagram (no metrics returned)');
      }
    } catch (err) {
      report.errors.push(`Instagram: ${err.message}`);
    }
  }

  if (org.metaPageId) {
    try {
      const metrics = await getFacebookMetrics(org.metaPageId, pageToken);
      if (Object.keys(metrics).length) {
        await upsertDailySnapshot(org._id, 'Facebook', metrics);
        report.synced.push('Facebook');
      } else {
        report.skipped.push('Facebook (no metrics returned)');
      }
    } catch (err) {
      report.errors.push(`Facebook: ${err.message}`);
    }
  }

  if (org.youtubeChannelId) {
    try {
      const metrics = await getYoutubeMetrics(org.youtubeChannelId);
      if (Object.keys(metrics).length) {
        await upsertDailySnapshot(org._id, 'YouTube', metrics);
        report.synced.push('YouTube');
      } else {
        report.skipped.push('YouTube (no metrics returned)');
      }
    } catch (err) {
      report.errors.push(`YouTube: ${err.message}`);
    }
  }

  // Per-post history (Instagram / Facebook / YouTube). First run for an
  // org/platform with no stored posts does a full-year backfill; after that it
  // is a fast recent refresh that catches new posts and updates recent metrics.
  for (const platform of SOCIAL_PLATFORMS) {
    if (!orgSupports(org, platform)) continue;
    try {
      const existing = await SocialPost.countDocuments({ organization: org._id, platform });
      const { synced } = await syncOrgPlatform(org, platform, { full: existing === 0 });
      report.synced.push(`${platform} posts (${synced})`);
    } catch (err) {
      report.errors.push(`${platform} posts: ${err.message}`);
    }
  }

  return report;
}

export async function refreshDailyAnalytics() {
  const orgs = await Organization.find({
    isActive: true,
    $or: [
      { metaInstagramId: { $ne: '' } },
      { metaPageId: { $ne: '' } },
      { youtubeChannelId: { $ne: '' } },
    ],
  })
    .select('name metaPageId metaInstagramId youtubeChannelId')
    .lean();

  const results = [];
  for (const org of orgs) {
    results.push(await refreshOrganization(org));
  }
  return { totalOrganizations: orgs.length, results };
}

export function startDailyAnalyticsScheduler({ time = process.env.DAILY_ANALYTICS_REFRESH_TIME || DEFAULT_TIME } = {}) {
  let stopped = false;
  let timer = null;

  const scheduleNext = () => {
    if (stopped) return;
    const delay = msUntilNextRun(time);
    timer = setTimeout(async () => {
      try {
        const result = await refreshDailyAnalytics();
        console.log(`[analytics-refresh] completed for ${result.totalOrganizations} organization(s)`);
      } catch (err) {
        console.error('[analytics-refresh] failed:', err.message);
      } finally {
        scheduleNext();
      }
    }, Math.max(1000, delay));
  };

  scheduleNext();

  return {
    stop: () => {
      stopped = true;
      if (timer) clearTimeout(timer);
    },
  };
}
