// Orchestrates actually publishing an approved request to whichever of its
// target platforms are (a) a Meta platform (Facebook/Instagram — the only
// ones with a real publish API wired up, see metaService.js) and (b) have a
// connected account for the request's organization (Organization.metaPageId /
// metaInstagramId). Every other platform (LinkedIn, YouTube, or a Meta
// platform the org hasn't connected) is left to the existing manual "mark as
// posted" trust-based flow — this only ever adds automation, never removes
// the fallback.
import ApprovalImage from '../models/ApprovalImage.js';
import Organization from '../models/Organization.js';
import {
  getPageToken, publishToFacebookPage, publishToInstagram, getPermalink, hasToken,
  FACEBOOK_SCHEDULE_MIN_SECONDS, FACEBOOK_SCHEDULE_MAX_SECONDS,
} from './metaService.js';

const META_PLATFORMS = ['Facebook', 'Instagram'];
// Only Facebook has a real native "scheduled post" state in Meta's API.
// Instagram's Content Publishing API has no equivalent at all — not for us,
// not for Meta's own Business Suite, not for any third-party tool — so it is
// never in this list. See the metaPublishResults schema comment in
// ApprovalRequest.js for the full explanation.
const NATIVELY_SCHEDULABLE_PLATFORMS = ['Facebook'];

// ApprovalImage.url is root-relative (e.g. /uploads/approvals/xyz.jpg) for the
// local storage driver. Meta fetches media itself, server-to-server, so it
// needs an absolute, publicly reachable URL — see PUBLIC_BACKEND_URL in .env.
const absoluteUrl = (url) => {
  if (!url || /^https?:\/\//i.test(url)) return url;
  const base = (process.env.PUBLIC_BACKEND_URL || '').replace(/\/+$/, '');
  return `${base}${url.startsWith('/') ? '' : '/'}${url}`;
};

// The finished work for this request: the current revision's non-reference,
// non-document media, same filtering the approval gallery itself applies —
// what gets published is exactly what a reviewer saw and approved, never a
// superseded round or a reference-only brief image.
const finalMediaFor = async (request) => {
  const all = await ApprovalImage.find({ request: request._id, kind: { $ne: 'reference' } }).sort({ order: 1 }).lean();
  const latest = all.reduce((max, m) => Math.max(max, m.revision || 0), 0);
  return all
    .filter((m) => (m.revision || 0) === latest && m.mediaType !== 'document')
    .map((m) => ({ url: absoluteUrl(m.url), mediaType: m.mediaType }));
};

const captionFor = (request, platform) => {
  const perChannel = (request.platformContent || []).find((c) => c.platform === platform);
  return perChannel?.caption || request.caption || request.title || '';
};

const targetPlatforms = (request) =>
  (request.platforms?.length ? request.platforms : (request.platform ? [request.platform] : []))
    .filter((p) => META_PLATFORMS.includes(p));

// Facebook's own limit on how far out `scheduled_publish_time` may be — Meta
// rejects anything outside this window with an API error, so this catches it
// upfront with a clear message instead.
export const validateFacebookScheduleWindow = (when) => {
  const leadSeconds = (when.getTime() - Date.now()) / 1000;
  if (leadSeconds < FACEBOOK_SCHEDULE_MIN_SECONDS) return 'Facebook needs the scheduled time to be at least 10 minutes from now.';
  if (leadSeconds > FACEBOOK_SCHEDULE_MAX_SECONDS) return 'Facebook only allows scheduling up to 75 days ahead.';
  return null;
};

/**
 * Called the instant a handler picks "Schedule" (scheduleRequest controller).
 * For Facebook, creates the post on Meta's own side right now as a native
 * scheduled post — Facebook's own infrastructure publishes it later, and it's
 * visible as "Scheduled" in Meta Business Suite immediately. Instagram has no
 * such capability anywhere (see NATIVELY_SCHEDULABLE_PLATFORMS above), so it
 * is deliberately left untouched here; the go-live sweep
 * (services/scheduledPosts.js) publishes it for real once the time arrives.
 *
 * Returns the same shape as publishToConnectedPlatforms — attempted /
 * allSucceeded / results / skipped — so the controller can reuse the same
 * block-on-failure handling.
 */
export const scheduleOnConnectedPlatforms = async (request, when) => {
  const platforms = targetPlatforms(request);
  if (!platforms.length || !hasToken()) return { attempted: false, allSucceeded: true, results: [], skipped: [] };

  const org = await Organization.findById(request.organization).lean();
  if (!org) return { attempted: false, allSucceeded: true, results: [], skipped: [] };

  const priorResults = request.metaPublishResults || [];
  const alreadyHandled = new Set(priorResults.filter((r) => r.status === 'success' || r.status === 'scheduled').map((r) => r.platform));
  const pending = platforms.filter((p) => !alreadyHandled.has(p));

  const isConnected = (p) => (p === 'Facebook' ? !!org.metaPageId : !!org.metaInstagramId);
  const connectable = pending.filter(isConnected);
  const skipped = pending.filter((p) => !isConnected(p));
  const schedulable = connectable.filter((p) => NATIVELY_SCHEDULABLE_PLATFORMS.includes(p));

  const carried = priorResults.filter((r) => alreadyHandled.has(r.platform));
  if (!schedulable.length) {
    // Nothing to natively schedule right now (only Instagram targeted, or
    // Facebook not connected) — not a failure, just nothing to do yet; the
    // sweep still picks up whatever's pending at the due time.
    return { attempted: false, allSucceeded: true, results: carried, skipped };
  }

  const media = await finalMediaFor(request);
  const results = [...carried];
  const pageToken = org.metaPageId ? await getPageToken(org.metaPageId).catch(() => null) : null;
  const scheduledUnix = Math.floor(when.getTime() / 1000);

  for (const platform of schedulable) {
    const attemptedAt = new Date();
    try {
      if (!pageToken) throw new Error('Could not get a Page access token from Meta — check the connection in Settings.');
      const r = await publishToFacebookPage(org.metaPageId, pageToken, { message: captionFor(request, platform), media, scheduledUnix });
      results.push({ platform, status: 'scheduled', postId: r.id, attemptedAt });
    } catch (err) {
      results.push({ platform, status: 'failed', error: err.message || 'Scheduling failed', attemptedAt });
    }
  }

  const allSucceeded = schedulable.every((p) => results.find((r) => r.platform === p)?.status !== 'failed');
  return { attempted: true, allSucceeded, results, skipped };
};

/**
 * Attempt to actually publish `request` right now — used both for an instant
 * "Mark as posted" and by the go-live sweep once a scheduled moment arrives.
 *
 * A platform already 'success' is left alone. A platform already 'scheduled'
 * (Facebook, natively) is never re-published — that would double-post it —
 * it's simply confirmed and converted to 'success' with its real permalink,
 * since by the time this runs its scheduled moment has already passed and
 * Facebook has published it independently. Every other pending, connected
 * platform (Instagram, or Facebook if it was never natively scheduled) is
 * actually published here for the first time.
 */
export const publishToConnectedPlatforms = async (request) => {
  const platforms = targetPlatforms(request);
  if (!platforms.length || !hasToken()) return { attempted: false, allSucceeded: true, results: [], skipped: [] };

  const org = await Organization.findById(request.organization).lean();
  if (!org) return { attempted: false, allSucceeded: true, results: [], skipped: [] };

  const priorResults = request.metaPublishResults || [];
  const alreadySucceeded = new Set(priorResults.filter((r) => r.status === 'success').map((r) => r.platform));
  const priorScheduled = priorResults.filter((r) => r.status === 'scheduled');
  const scheduledPlatforms = new Set(priorScheduled.map((r) => r.platform));
  const pending = platforms.filter((p) => !alreadySucceeded.has(p) && !scheduledPlatforms.has(p));

  const isConnected = (p) => (p === 'Facebook' ? !!org.metaPageId : !!org.metaInstagramId);
  const connectable = pending.filter(isConnected);
  const skipped = pending.filter((p) => !isConnected(p));

  const carried = priorResults.filter((r) => alreadySucceeded.has(r.platform));
  const results = [...carried];
  let pageToken = null;
  if (org.metaPageId) pageToken = await getPageToken(org.metaPageId).catch(() => null);

  // Confirm + convert anything already natively scheduled on Facebook — the
  // publish/feed endpoint is never called again for it.
  for (const r of priorScheduled) {
    const url = pageToken ? await getPermalink(r.postId, pageToken) : null;
    results.push({ platform: r.platform, status: 'success', postUrl: url || r.postUrl || '', postId: r.postId, attemptedAt: new Date() });
  }

  if (connectable.length) {
    const media = await finalMediaFor(request);
    for (const platform of connectable) {
      const attemptedAt = new Date();
      try {
        if (!pageToken) throw new Error('Could not get a Page access token from Meta — check the connection in Settings.');
        if (platform === 'Facebook') {
          const r = await publishToFacebookPage(org.metaPageId, pageToken, { message: captionFor(request, platform), media });
          results.push({ platform, status: 'success', postUrl: r.url || '', postId: r.id, attemptedAt });
        } else {
          const r = await publishToInstagram(org.metaInstagramId, pageToken, { caption: captionFor(request, platform), media });
          results.push({ platform, status: 'success', postUrl: r.url || '', postId: r.id, attemptedAt });
        }
      } catch (err) {
        results.push({ platform, status: 'failed', error: err.message || 'Publish failed', attemptedAt });
      }
    }
  }

  const touched = [...connectable, ...priorScheduled.map((r) => r.platform)];
  const attempted = touched.length > 0;
  const allSucceeded = touched.every((p) => results.find((r) => r.platform === p)?.status === 'success');
  return { attempted, allSucceeded, results, skipped };
};
