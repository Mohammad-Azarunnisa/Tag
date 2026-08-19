import Organization from '../models/Organization.js';
import SocialPost from '../models/SocialPost.js';
import SyncRun from '../models/SyncRun.js';
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

// The UTC date key a run belongs to. UTC, not local time, so the identity of
// "today" cannot shift under a server in a different timezone.
export const utcDayKey = (date = new Date()) => date.toISOString().slice(0, 10);

// Run the sync and record it. Everything the platforms hand back is upserted, so
// running twice for the same day is safe — it refreshes that day's row rather
// than duplicating it — which is what lets the catch-up below be unconditional.
const IN_FLIGHT_MS = 30 * 60 * 1000; // a run younger than this is assumed alive

export async function runRecordedSync({ trigger = 'schedule', force = false } = {}) {
  const day = utcDayKey();
  const startedAt = new Date();

  // Don't pile a second run on top of one already under way. The upserts make
  // concurrent runs harmless to the data, but they double the calls to Meta and
  // YouTube, which are rate limited. A 'running' row older than IN_FLIGHT_MS is
  // treated as abandoned — its process died — so a genuinely stuck day is still
  // retried rather than blocking forever.
  if (!force) {
    const existing = await SyncRun.findOne({ day }).select('status startedAt').lean();
    if (existing?.status === 'running' && Date.now() - new Date(existing.startedAt).getTime() < IN_FLIGHT_MS) {
      return { day, trigger, status: 'already-running', snapshotsWritten: 0, postsSynced: 0, errors: [] };
    }
  }

  // One row per day, claimed up front, so a second caller joins the same record
  // instead of creating a rival one.
  await SyncRun.findOneAndUpdate(
    { day },
    { $set: { trigger, status: 'running', startedAt }, $setOnInsert: { day } },
    { upsert: true, setDefaultsOnInsert: true }
  );

  try {
    const result = await refreshDailyAnalytics();
    const results = result.results || [];
    const errors = results.flatMap((r) => (r.errors || []).map((e) => `${r.organization?.name || '?'}: ${e}`));
    // Count what actually landed, so the record says more than "it ran".
    const snapshotsWritten = results.reduce(
      (n, r) => n + (r.synced || []).filter((x) => !String(x).includes('posts')).length, 0);
    const postsSynced = results.reduce((n, r) => n + (r.synced || [])
      .map((x) => String(x).match(/posts \((\d+)\)/))
      .reduce((m, hit) => m + (hit ? Number(hit[1]) : 0), 0), 0);

    const finishedAt = new Date();
    await SyncRun.updateOne({ day }, {
      $set: {
        status: errors.length ? 'partial' : 'success',
        finishedAt,
        durationMs: finishedAt - startedAt,
        organizationsProcessed: result.totalOrganizations || 0,
        snapshotsWritten,
        postsSynced,
        results,
        errorMessages: errors,
      },
    });
    return { day, trigger, status: errors.length ? 'partial' : 'success', snapshotsWritten, postsSynced, errors };
  } catch (err) {
    const finishedAt = new Date();
    await SyncRun.updateOne({ day }, {
      $set: { status: 'failed', finishedAt, durationMs: finishedAt - startedAt, errorMessages: [err.message] },
    });
    throw err;
  }
}

// Whether today's sync still needs doing. A run left 'running' by a process that
// died counts as unfinished, so it will be retried rather than assumed done.
export async function todayNeedsSync() {
  const row = await SyncRun.findOne({ day: utcDayKey() }).select('status').lean();
  return !row || !['success', 'partial'].includes(row.status);
}

// The scheduler is a timer inside this process, so it only fires if the process
// happens to be alive at the appointed minute. A deploy, a crash or a machine
// that was off overnight silently skips a day — and that day's readings cannot
// be fetched later, because the platform APIs return current totals only. So on
// every boot we ask whether today has been done, and do it if not. That is what
// turns "a sync that usually runs" into a history without holes.
export async function catchUpIfMissed() {
  try {
    if (!(await todayNeedsSync())) return { skipped: true, reason: 'already synced today' };
    console.log('[analytics-refresh] today has not been synced yet — catching up now');
    const out = await runRecordedSync({ trigger: 'catch-up' });
    if (out.status === 'already-running') {
      console.log('[analytics-refresh] another run is already in progress — leaving it to finish');
      return { skipped: true, reason: 'already running' };
    }
    console.log(`[analytics-refresh] catch-up ${out.status}: ${out.snapshotsWritten} snapshot(s), ${out.postsSynced} post(s)`);
    return out;
  } catch (err) {
    console.error('[analytics-refresh] catch-up failed:', err.message);
    return { failed: true, error: err.message };
  }
}

export function startDailyAnalyticsScheduler({ time = process.env.DAILY_ANALYTICS_REFRESH_TIME || DEFAULT_TIME } = {}) {
  let stopped = false;
  let timer = null;

  const scheduleNext = () => {
    if (stopped) return;
    const delay = msUntilNextRun(time);
    timer = setTimeout(async () => {
      try {
        const out = await runRecordedSync({ trigger: 'schedule' });
        console.log(`[analytics-refresh] ${out.status}: ${out.snapshotsWritten} snapshot(s), ${out.postsSynced} post(s)`
          + (out.errors.length ? ` — ${out.errors.length} error(s)` : ''));
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
