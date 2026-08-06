// YouTube Data API v3 service.
//
// SECURITY: the API key is read ONLY from the environment (YOUTUBE_API_KEY). It
// is never stored in the database, returned to the client, or logged. All calls
// happen server-side. The key grants access to PUBLIC channel data only (no
// OAuth) — subscribers, total views, video count, and recent-video engagement.

const API = 'https://www.googleapis.com/youtube/v3';

export const hasKey = () => !!process.env.YOUTUBE_API_KEY;
const key = () => process.env.YOUTUBE_API_KEY;

const call = async (path, params = {}) => {
  if (!hasKey()) {
    const e = new Error('YouTube is not connected. Set YOUTUBE_API_KEY in the backend .env file.');
    e.notConfigured = true;
    throw e;
  }
  const url = new URL(`${API}/${path}`);
  for (const [k, v] of Object.entries(params)) if (v != null) url.searchParams.set(k, v);
  url.searchParams.set('key', key());

  let res, data;
  try {
    res = await fetch(url);
    data = await res.json().catch(() => ({}));
  } catch (netErr) {
    const e = new Error(`Could not reach the YouTube API: ${netErr.message}`);
    e.network = true;
    throw e;
  }
  if (!res.ok || data.error) {
    const m = data.error?.errors?.[0] || data.error || {};
    const e = new Error(m.message || `YouTube API error (HTTP ${res.status})`);
    e.reason = m.reason;
    e.status = res.status;
    throw e;
  }
  return data;
};

const mapChannel = (ch) => ({
  id: ch.id,
  title: ch.snippet?.title || '',
  customUrl: ch.snippet?.customUrl || '',
  thumbnail: ch.snippet?.thumbnails?.default?.url || '',
  uploads: ch.contentDetails?.relatedPlaylists?.uploads || '',
  subscribers: Number(ch.statistics?.subscriberCount || 0),
  views: Number(ch.statistics?.viewCount || 0),
  videoCount: Number(ch.statistics?.videoCount || 0),
});

// Resolve a channel from a handle (@name), channel id (UC…), a channel/user URL,
// or a plain name (falls back to search).
export const resolveChannel = async (input) => {
  const raw = String(input || '').trim();
  if (!raw) return null;
  const part = 'snippet,statistics,contentDetails';
  const s = raw.replace(/^https?:\/\/(www\.)?youtube\.com\//i, '').replace(/^\/+/, '');

  let data = null;
  if (/^UC[\w-]{20,}$/.test(raw)) data = await call('channels', { part, id: raw });
  else if (/^channel\/(UC[\w-]{20,})/i.test(s)) data = await call('channels', { part, id: s.match(/^channel\/(UC[\w-]{20,})/i)[1] });
  else if (/^user\/([\w-]+)/i.test(s)) data = await call('channels', { part, forUsername: s.match(/^user\/([\w-]+)/i)[1] });
  else {
    const handle = s.replace(/^c\//i, '').replace(/^@/, '').split(/[/?#]/)[0];
    if (handle) data = await call('channels', { part, forHandle: `@${handle}` });
  }
  let ch = data?.items?.[0];

  if (!ch) {
    const sr = await call('search', { part: 'snippet', q: raw.replace(/^@/, ''), type: 'channel', maxResults: 1 });
    const cid = sr?.items?.[0]?.id?.channelId;
    if (cid) ch = (await call('channels', { part, id: cid }))?.items?.[0];
  }
  return ch ? mapChannel(ch) : null;
};

export const getChannelById = async (channelId) => {
  const data = await call('channels', { part: 'snippet,statistics,contentDetails', id: channelId });
  const ch = data?.items?.[0];
  return ch ? mapChannel(ch) : null;
};

// Engagement over the channel's most recent uploads.
export const getRecentEngagement = async (uploadsPlaylistId, n = 20) => {
  if (!uploadsPlaylistId) return null;
  const pl = await call('playlistItems', { part: 'contentDetails', playlistId: uploadsPlaylistId, maxResults: n });
  const ids = (pl.items || []).map((i) => i.contentDetails?.videoId).filter(Boolean);
  if (!ids.length) return { likes: 0, comments: 0, views: 0, videos: 0 };
  const vids = await call('videos', { part: 'statistics', id: ids.join(',') });
  let likes = 0, comments = 0, views = 0;
  for (const v of vids.items || []) {
    likes += Number(v.statistics?.likeCount || 0);
    comments += Number(v.statistics?.commentCount || 0);
    views += Number(v.statistics?.viewCount || 0);
  }
  return { likes, comments, views, videos: (vids.items || []).length };
};

// Channel metrics mapped to our Analytics fields.
export const getYoutubeMetrics = async (channelId) => {
  const ch = await getChannelById(channelId);
  if (!ch) return {};
  const out = { subscribers: ch.subscribers, views: ch.views, videoCount: ch.videoCount };
  try {
    const eng = await getRecentEngagement(ch.uploads);
    if (eng) {
      out.comments = eng.comments;
      if (eng.views > 0) out.engagementRate = +(((eng.likes + eng.comments) / eng.views) * 100).toFixed(2);
    }
  } catch { /* engagement is best-effort */ }
  return out;
};

// Per-video history — the YouTube equivalent of LinkedIn's post table. Uses the
// public Data API: views, likes, comments + the watch link. Impressions/reach
// are NOT available here (they require the YouTube Analytics API with channel-
// owner OAuth) and are left at 0.
export const getYoutubePosts = async (channelId, { limit = 50 } = {}) => {
  const ch = await getChannelById(channelId);
  if (!ch?.uploads) return [];
  const ids = [];
  let pageTok;
  do {
    const pl = await call('playlistItems', { part: 'contentDetails', playlistId: ch.uploads, maxResults: 50, pageToken: pageTok });
    for (const i of pl.items || []) { const vid = i.contentDetails?.videoId; if (vid) ids.push(vid); }
    pageTok = pl.nextPageToken;
  } while (pageTok && ids.length < limit);

  const posts = [];
  for (let i = 0; i < ids.length && posts.length < limit; i += 50) {
    const batch = ids.slice(i, i + 50);
    const vids = await call('videos', { part: 'snippet,statistics', id: batch.join(',') });
    for (const v of vids.items || []) {
      posts.push({
        postId: v.id,
        url: `https://www.youtube.com/watch?v=${v.id}`,
        caption: v.snippet?.title || '',
        mediaType: 'video',
        thumbnail: v.snippet?.thumbnails?.medium?.url || v.snippet?.thumbnails?.default?.url || '',
        publishedAt: v.snippet?.publishedAt ? new Date(v.snippet.publishedAt) : undefined,
        views: Number(v.statistics?.viewCount || 0),
        likes: Number(v.statistics?.likeCount || 0),
        comments: Number(v.statistics?.commentCount || 0),
        impressions: 0, reach: 0, shares: 0, saved: 0,
      });
    }
  }
  return posts.slice(0, limit);
};

// Cheap validity probe (1 quota unit): look up YouTube's own channel.
export const probe = async () => {
  const data = await call('channels', { part: 'snippet', id: 'UCBR8-60-B28hp2BmDPdntcQ' });
  return { ok: Array.isArray(data.items) };
};
