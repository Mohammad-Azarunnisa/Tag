import asyncHandler from 'express-async-handler';
import Organization from '../models/Organization.js';
import Analytics from '../models/Analytics.js';
import { logActivity } from '../utils/logActivity.js';
import { requireOrgId, resolveViewOrgId } from '../utils/org.js';
import { ACTIVITY_ACTIONS } from '../config/constants.js';
import { hasKey, probe, resolveChannel, getYoutubeMetrics } from '../services/youtubeService.js';

const explain = (e) => {
  if (e.notConfigured) return 'No YouTube key configured. Add YOUTUBE_API_KEY to the backend .env file.';
  if (e.reason === 'keyInvalid' || e.reason === 'badRequest') return 'The YouTube API key is invalid. Check YOUTUBE_API_KEY.';
  if (e.reason === 'quotaExceeded' || e.reason === 'dailyLimitExceeded') return 'YouTube API daily quota reached. Try again tomorrow or raise the quota in Google Cloud.';
  if (e.reason === 'accessNotConfigured') return 'The YouTube Data API v3 is not enabled for this key. Enable it in Google Cloud Console.';
  return e.message || 'YouTube request failed.';
};

const upsertDay = async (orgId, metrics) => {
  const now = new Date();
  const day = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const dayEnd = new Date(day.getTime() + 86400000);
  let snap = await Analytics.findOne({ organization: orgId, platform: 'YouTube', date: { $gte: day, $lt: dayEnd } });
  if (!snap) snap = new Analytics({ organization: orgId, platform: 'YouTube', date: day });
  for (const [field, raw] of Object.entries(metrics)) {
    const val = Number(raw);
    if (Number.isFinite(val) && val >= 0) snap[field] = val;
  }
  await snap.save();
  return day;
};

// @route GET /api/youtube/status — is a YouTube key configured and valid?
export const youtubeStatus = asyncHandler(async (req, res) => {
  if (!hasKey()) return res.json({ configured: false, connected: false, message: 'No YouTube key configured. Add YOUTUBE_API_KEY to the backend .env to enable sync.' });
  try {
    await probe();
    res.json({ configured: true, connected: true });
  } catch (e) {
    res.json({ configured: true, connected: false, message: explain(e), reason: e.reason });
  }
});

// @route GET /api/youtube/channel?organizationId= — the org's linked channel (if any).
export const getYoutubeChannel = asyncHandler(async (req, res) => {
  const orgId = resolveViewOrgId(req);
  const org = await Organization.findById(orgId).select('youtubeChannelId youtubeChannelTitle').lean();
  res.json({ success: true, configured: hasKey(), channel: org?.youtubeChannelId ? { channelId: org.youtubeChannelId, title: org.youtubeChannelTitle } : null });
});

// @route GET /api/youtube/resolve?q= — preview a channel from a handle/URL/id.
export const resolveYoutubeChannel = asyncHandler(async (req, res) => {
  if (!hasKey()) { res.status(400); throw new Error('No YouTube key configured.'); }
  const q = req.query.q;
  if (!q) { res.status(400); throw new Error('Enter a channel handle, URL or ID.'); }
  let channel;
  try { channel = await resolveChannel(q); }
  catch (e) { res.status(400); throw new Error(explain(e)); }
  if (!channel) { res.status(404); throw new Error('No YouTube channel found for that handle/URL.'); }
  res.json({ success: true, channel });
});

// @route POST /api/youtube/map — link an org to a YouTube channel. Accepts a
// channelId directly or a query (@handle / URL) to resolve. Empty unlinks.
export const mapYoutubeChannel = asyncHandler(async (req, res) => {
  const { organizationId, channelId, query } = req.body;
  const org = await Organization.findById(organizationId);
  if (!org) { res.status(404); throw new Error('Organization not found'); }

  if (!channelId && !query) {
    org.youtubeChannelId = ''; org.youtubeChannelTitle = '';
  } else {
    if (!hasKey()) { res.status(400); throw new Error('No YouTube key configured.'); }
    let channel;
    try { channel = channelId ? await resolveChannel(channelId) : await resolveChannel(query); }
    catch (e) { res.status(400); throw new Error(explain(e)); }
    if (!channel) { res.status(404); throw new Error('No YouTube channel found.'); }
    org.youtubeChannelId = channel.id;
    org.youtubeChannelTitle = channel.title;
  }
  await org.save();
  logActivity({ user: req.user._id, organization: org._id, action: ACTIVITY_ACTIONS.ANALYTICS_UPDATED, description: `Linked "${org.name}" to YouTube ${org.youtubeChannelTitle || '(none)'}`, entityType: 'Organization', entityId: org._id });
  res.json({ success: true, channel: org.youtubeChannelId ? { channelId: org.youtubeChannelId, title: org.youtubeChannelTitle } : null });
});

// @route POST /api/youtube/sync?organizationId= — pull the channel's live stats
// into today's snapshot.
export const syncYoutube = asyncHandler(async (req, res) => {
  if (!hasKey()) { res.status(400); throw new Error('YouTube is not connected. Add YOUTUBE_API_KEY to the backend .env.'); }
  const orgId = requireOrgId(req, res);
  const org = await Organization.findById(orgId);
  if (!org) { res.status(404); throw new Error('Organization not found'); }
  if (!org.youtubeChannelId) { res.status(400); throw new Error('No YouTube channel linked to this organization yet.'); }

  let metrics;
  try { metrics = await getYoutubeMetrics(org.youtubeChannelId); }
  catch (e) { res.status(400); throw new Error(explain(e)); }
  if (!metrics || !Object.keys(metrics).length) { res.status(400); throw new Error('YouTube returned no data for this channel.'); }

  const date = await upsertDay(orgId, metrics);
  logActivity({ user: req.user._id, organization: orgId, action: ACTIVITY_ACTIONS.ANALYTICS_UPDATED, description: `Synced YouTube stats for "${org.youtubeChannelTitle}"`, entityType: 'Analytics' });
  res.json({ success: true, date, fields: Object.keys(metrics), metrics, channel: org.youtubeChannelTitle });
});
