// Meta (Facebook + Instagram) Graph API service.
//
// SECURITY: the master/system access token is read ONLY from the environment
// (META_SYSTEM_TOKEN) at request time. It is never stored in the database, never
// returned to the client, and never logged. All Graph calls happen server-side.
//
// Meta deprecates metrics frequently (e.g. Instagram `impressions` -> `views` in
// 2025, and many page_* metrics in 2024), so every insight fetch is defensive:
// a failing metric is skipped rather than failing the whole sync, and only the
// fields that actually come back are returned.

import crypto from 'crypto';

const GRAPH = 'https://graph.facebook.com';
const VERSION = process.env.META_API_VERSION || 'v21.0';

export const hasToken = () => !!process.env.META_SYSTEM_TOKEN;
const token = () => process.env.META_SYSTEM_TOKEN;

// appsecret_proof = HMAC-SHA256(access_token) keyed with the app secret. Required
// when the Meta app has "Require app secret proof for server API calls" enabled.
// Computed for whichever token a given call uses (user token or page token).
const appSecretProof = (tok) => {
  const secret = process.env.META_APP_SECRET;
  if (!secret) return null;
  return crypto.createHmac('sha256', secret).update(tok).digest('hex');
};

// Low-level Graph GET. Throws an Error enriched with Meta's error fields.
// `tok` overrides the token (e.g. a Page Access Token for page/IG insights);
// defaults to the system/user token from the environment.
const call = async (path, params = {}, tok) => {
  if (!hasToken()) {
    const e = new Error('Meta is not connected. Set META_SYSTEM_TOKEN in the backend .env file.');
    e.notConfigured = true;
    throw e;
  }
  const useTok = tok || token();
  const url = new URL(`${GRAPH}/${VERSION}/${path}`);
  for (const [k, v] of Object.entries(params)) if (v != null) url.searchParams.set(k, v);
  url.searchParams.set('access_token', useTok);
  const proof = appSecretProof(useTok);
  if (proof) url.searchParams.set('appsecret_proof', proof);

  let res, data;
  try {
    res = await fetch(url);
    data = await res.json().catch(() => ({}));
  } catch (netErr) {
    const e = new Error(`Could not reach the Meta Graph API: ${netErr.message}`);
    e.network = true;
    throw e;
  }
  if (!res.ok || data.error) {
    const me = data.error || {};
    const e = new Error(me.message || `Meta API error (HTTP ${res.status})`);
    e.metaCode = me.code;
    e.metaSubcode = me.error_subcode;
    e.metaType = me.type;
    e.status = res.status;
    throw e;
  }
  return data;
};

// Follow Graph pagination via the absolute `paging.next` URL (which already
// carries the token + cursor).
const fetchNext = async (nextUrl) => {
  const u = new URL(nextUrl);
  // The cursor URL carries whichever access_token the original call used — often
  // a Page Access Token, not the system token. Compute the app-secret proof for
  // THAT token (overwriting any stale one), or Meta rejects paginated page/IG
  // calls with "Invalid appsecret_proof".
  const tokInUrl = u.searchParams.get('access_token') || token();
  const proof = appSecretProof(tokInUrl);
  if (proof) u.searchParams.set('appsecret_proof', proof);
  const res = await fetch(u);
  const data = await res.json().catch(() => ({}));
  if (data.error) throw Object.assign(new Error(data.error.message), { metaCode: data.error.code });
  return data;
};

// Latest value from a time-series insight metric object ({ values: [{value,end_time}] }).
const latestTs = (metricObj) => {
  const vals = metricObj?.values || [];
  if (!vals.length) return undefined;
  const last = vals[vals.length - 1];
  return typeof last?.value === 'number' ? last.value : undefined;
};

const latestValue = (metricObj) => {
  const vals = metricObj?.values || [];
  if (!vals.length) return undefined;
  return vals[vals.length - 1]?.value;
};

const toNumber = (value) => {
  const n = Number(value);
  return Number.isFinite(n) ? n : undefined;
};

const sumObjectValues = (value) => {
  if (!value || typeof value !== 'object') return undefined;
  const total = Object.values(value).reduce((sum, entry) => {
    const n = Number(entry);
    return Number.isFinite(n) ? sum + n : sum;
  }, 0);
  return total > 0 ? total : undefined;
};

const pickObjectMetric = (value, keys) => {
  if (!value || typeof value !== 'object') return undefined;
  for (const key of keys) {
    const exact = toNumber(value[key]);
    if (exact != null) return exact;
    const alt = Object.entries(value).find(([name]) => String(name).toLowerCase() === String(key).toLowerCase());
    if (alt) {
      const n = toNumber(alt[1]);
      if (n != null) return n;
    }
  }
  return undefined;
};

// ---------------------------------------------------------------------------
// Discovery — list all Facebook Pages visible to the token and their linked
// Instagram business accounts. This is how we find the 7 brands automatically.
// ---------------------------------------------------------------------------
export const listAccounts = async () => {
  const out = [];
  let data = await call('me/accounts', {
    fields: 'name,id,access_token,instagram_business_account{id,username,profile_picture_url,followers_count}',
    limit: 100,
  });
  for (;;) {
    for (const pg of data.data || []) {
      out.push({
        pageId: pg.id,
        pageName: pg.name,
        // Page Access Token — REQUIRED for page/Instagram insights. Kept server-side
        // only; controllers strip this before returning accounts to the client.
        pageToken: pg.access_token || null,
        instagramId: pg.instagram_business_account?.id || null,
        instagramUsername: pg.instagram_business_account?.username || null,
        instagramFollowers: pg.instagram_business_account?.followers_count ?? null,
        instagramAvatar: pg.instagram_business_account?.profile_picture_url || null,
      });
    }
    if (!data.paging?.next) break;
    data = await fetchNext(data.paging.next);
  }
  return out;
};

// Fetch a single Page Access Token by page id (used at sync time).
export const getPageToken = async (pageId) => {
  try {
    const r = await call(pageId, { fields: 'access_token' });
    return r.access_token || null;
  } catch {
    return null;
  }
};

// Lightweight identity/health probe for a "Test connection" button.
export const probe = async () => {
  const me = await call('me', { fields: 'id,name' });
  let scopes = [];
  try {
    const perms = await call('me/permissions');
    scopes = (perms.data || []).filter((p) => p.status === 'granted').map((p) => p.permission);
  } catch {
    /* /me/permissions isn't available for some system-user tokens — non-fatal */
  }
  return { id: me.id, name: me.name, scopes };
};

// Scopes required to read Instagram + Facebook insights.
export const REQUIRED_SCOPES = [
  'instagram_basic',
  'instagram_manage_insights',
  'pages_show_list',
  'pages_read_engagement',
  'pages_read_user_content',
  'business_management',
];

// ---------------------------------------------------------------------------
// Instagram metrics -> our Analytics fields: followers, views, reach, interactions
// ---------------------------------------------------------------------------
export const getInstagramMetrics = async (igId, pageToken) => {
  const out = {};

  // Total followers — a node field, not an insight.
  try {
    const node = await call(igId, { fields: 'followers_count' }, pageToken);
    if (typeof node.followers_count === 'number') out.followers = node.followers_count;
  } catch { /* skip */ }

  // Reach — classic time-series insight (needs the page token + insights scope).
  try {
    const r = await call(`${igId}/insights`, { metric: 'reach', period: 'day' }, pageToken);
    const v = latestTs((r.data || [])[0]);
    if (v != null) out.reach = v;
  } catch { /* skip */ }

  // Views + total interactions — newer "total_value" insights (v18+). Try the
  // batched call first, then fall back to one metric at a time so a single
  // unsupported metric never blocks the other.
  const totalValue = async (metric) => {
    const r = await call(`${igId}/insights`, { metric, metric_type: 'total_value', period: 'day' }, pageToken);
    const m = (r.data || [])[0];
    return m?.total_value?.value;
  };
  try {
    const r = await call(`${igId}/insights`, { metric: 'views,total_interactions', metric_type: 'total_value', period: 'day' }, pageToken);
    for (const m of r.data || []) {
      if (m.name === 'views' && m.total_value?.value != null) out.views = m.total_value.value;
      if (m.name === 'total_interactions' && m.total_value?.value != null) out.interactions = m.total_value.value;
    }
  } catch {
    try { const v = await totalValue('views'); if (v != null) out.views = v; } catch { /* skip */ }
    try { const v = await totalValue('total_interactions'); if (v != null) out.interactions = v; } catch { /* skip */ }
  }

  const IG_TOTAL_VALUE_MAP = [
    {
      metric: 'profile_views',
      field: 'pageViews',
    },
    {
      metric: 'website_clicks',
      field: 'linkClicks',
    },
    {
      metric: 'impressions',
      field: 'impressions',
    },
  ];

  for (const { metric, field } of IG_TOTAL_VALUE_MAP) {
    try {
      const value = await totalValue(metric);
      if (value != null) out[field] = value;
    } catch { /* skip */ }
  }

  if (out.impressions == null && out.views != null) out.impressions = out.views;

  return out;
};

// ---------------------------------------------------------------------------
// Facebook Page metrics -> our Analytics fields. Page insights availability
// varies a lot post-2024 deprecations, so we map whatever returns.
// ---------------------------------------------------------------------------
export const getFacebookMetrics = async (pageId, pageTokenIn) => {
  const out = {};
  // Page insights REQUIRE a Page Access Token (not the user/system token).
  const pageToken = pageTokenIn || (await getPageToken(pageId));

  // Node fields are the ONLY Facebook signals the standard scopes still expose
  // reliably. Meta retired almost every page_* time-series insight (they now
  // return empty even on large pages), and reading post-level engagement needs
  // the extra `pages_read_user_content` permission. So we lead with node fields:
  //   • followers_count / fan_count → the audience total
  //   • talking_about_count → Facebook's "People talking about this" (PTAT): a
  //     rolling 7-day engagement count (likes, comments, shares, mentions,
  //     check-ins). Mapped to `interactions` as our engagement signal.
  try {
    const node = await call(pageId, { fields: 'followers_count,fan_count,talking_about_count' }, pageToken);
    const f = node.followers_count ?? node.fan_count;
    if (typeof f === 'number') out.followers = f;
    if (typeof node.talking_about_count === 'number') out.interactions = node.talking_about_count;
  } catch { /* skip */ }

  // Insights are attempted defensively as a bonus: when a page DOES still return
  // them, page_post_engagements (real, per-period engagement) overrides the PTAT
  // proxy above, and follows/visits fill in. Each is fetched individually so a
  // single unsupported/empty metric never drops the rest, and empty results are
  // skipped (leaving the node-field values in place).
  const MAP = {
    page_post_engagements: 'interactions',
    page_daily_follows_unique: 'newFollowers',
    page_views_total: 'visits',
  };
  for (const [metric, field] of Object.entries(MAP)) {
    try {
      const r = await call(`${pageId}/insights`, { metric, period: 'days_28' }, pageToken);
      const v = latestTs((r.data || [])[0]);
      if (v != null) out[field] = v;
    } catch { /* skip */ }
  }

  const EXTRA_METRICS = [
    {
      metric: 'page_impressions',
      assign: (value) => {
        const n = toNumber(value);
        if (n != null) out.views = n;
      },
    },
    {
      metric: 'page_impressions_unique',
      assign: (value) => {
        const n = toNumber(value);
        if (n != null) out.reach = n;
      },
    },
    {
      metric: 'page_consumptions_by_consumption_type',
      assign: (value) => {
        const clicks = pickObjectMetric(value, ['link clicks', 'link_clicks']) ?? sumObjectValues(value);
        if (clicks != null) out.linkClicks = clicks;
      },
    },
  ];

  for (const { metric, assign } of EXTRA_METRICS) {
    try {
      const r = await call(`${pageId}/insights`, { metric, period: 'days_28' }, pageToken);
      const value = latestValue((r.data || [])[0]);
      if (value != null) assign(value);
    } catch { /* skip */ }
  }

  const needsPostFallback = out.reach == null || out.views == null || out.linkClicks == null || out.interactions == null;
  if (!needsPostFallback) return out;

  try {
    // Some pages have sparse recent activity; scan a larger recent window so we
    // can still derive reach/views/clicks from post insights when page-level
    // insights are unavailable.
    const since = new Date(Date.now() - 120 * 86400000).toISOString();
    const postList = [];
    let posts = await call(`${pageId}/posts`, { fields: 'id', limit: 25, since }, pageToken);
    for (;;) {
      for (const row of posts.data || []) {
        if (row?.id) postList.push(row);
        if (postList.length >= 75) break;
      }
      if (postList.length >= 75 || !posts.paging?.next) break;
      posts = await fetchNext(posts.paging.next);
    }
    if (!postList.length) return out;

    const totals = { views: 0, reach: 0, linkClicks: 0, interactions: 0 };
    for (const post of postList) {
      try {
        const metrics = await call(
          `${post.id}/insights`,
          { metric: 'post_impressions,post_impressions_unique,post_clicks,post_clicks_by_type,post_engaged_users' },
          pageToken
        );
        for (const metric of metrics.data || []) {
          const value = latestValue(metric);
          if (metric.name === 'post_clicks_by_type') {
            const clicks = pickObjectMetric(value, ['link clicks', 'link_clicks']);
            if (clicks != null) totals.linkClicks += clicks;
            continue;
          }
          const n = toNumber(value);
          if (n == null) continue;
          if (metric.name === 'post_impressions') totals.views += n;
          if (metric.name === 'post_impressions_unique') totals.reach += n;
          if (metric.name === 'post_clicks') totals.linkClicks += n;
          if (metric.name === 'post_engaged_users') totals.interactions += n;
        }
      } catch { /* skip one post */ }
    }

    if (out.views == null && totals.views > 0) out.views = totals.views;
    if (out.reach == null && totals.reach > 0) out.reach = totals.reach;
    if (out.linkClicks == null && totals.linkClicks > 0) out.linkClicks = totals.linkClicks;
    if (out.interactions == null && totals.interactions > 0) out.interactions = totals.interactions;
  } catch { /* skip fallback */ }

  // Keep cards useful even when Meta withholds one of the two exposure metrics.
  if (out.views == null && out.reach != null) out.views = out.reach;
  if (out.reach == null && out.views != null) out.reach = out.views;

  return out;
};

// ---------------------------------------------------------------------------
// Per-post history — the Instagram/Facebook equivalent of LinkedIn's post table.
// Returns normalized post objects (permalink + engagement) for the SocialPost
// store. Insights are best-effort: Meta deprecates post metrics often, so a
// failing insight is skipped and the node-field counts (likes/comments/shares)
// are kept.
// ---------------------------------------------------------------------------
export const getInstagramPosts = async (igId, pageToken, { limit = 60, sinceDays = 365 } = {}) => {
  if (!pageToken) throw new Error('A page access token is required for Instagram posts');
  const cutoff = Date.now() - sinceDays * 86400000;
  const media = [];
  let data = await call(`${igId}/media`, {
    fields: 'id,permalink,caption,media_type,media_product_type,thumbnail_url,media_url,timestamp,like_count,comments_count',
    limit: 50,
  }, pageToken);
  outer: for (;;) {
    for (const m of data.data || []) {
      if (m.timestamp && new Date(m.timestamp).getTime() < cutoff) break outer;
      media.push(m);
      if (media.length >= limit) break outer;
    }
    if (!data.paging?.next) break;
    data = await fetchNext(data.paging.next);
  }

  const posts = [];
  for (const m of media) {
    const post = {
      postId: m.id,
      url: m.permalink || '',
      caption: m.caption || '',
      mediaType: m.media_product_type === 'REELS' ? 'REEL' : (m.media_type || ''),
      thumbnail: m.thumbnail_url || m.media_url || '',
      publishedAt: m.timestamp ? new Date(m.timestamp) : undefined,
      likes: toNumber(m.like_count) || 0,
      comments: toNumber(m.comments_count) || 0,
      reach: 0, saved: 0, shares: 0, views: 0, impressions: 0,
    };
    try {
      const r = await call(`${m.id}/insights`, { metric: 'reach,saved,shares' }, pageToken);
      for (const x of r.data || []) {
        const v = x.values?.[0]?.value;
        if (typeof v === 'number') { if (x.name === 'reach') post.reach = v; else if (x.name === 'saved') post.saved = v; else if (x.name === 'shares') post.shares = v; }
      }
    } catch { /* insights unavailable for this media */ }
    try {
      const r = await call(`${m.id}/insights`, { metric: 'views', metric_type: 'total_value' }, pageToken);
      const v = r.data?.[0]?.total_value?.value;
      if (typeof v === 'number') post.views = v;
    } catch { /* skip */ }
    // Use views as the impressions proxy, then reach, so the column is never blank.
    post.impressions = post.views || post.reach || 0;
    posts.push(post);
  }
  return posts;
};

export const getFacebookPosts = async (pageId, pageTokenIn, { limit = 50, sinceDays = 365 } = {}) => {
  const pageToken = pageTokenIn || (await getPageToken(pageId));
  const cutoff = Date.now() - sinceDays * 86400000;
  const raw = [];
  let data = await call(`${pageId}/posts`, {
    fields: 'id,permalink_url,message,created_time,full_picture,shares,reactions.summary(true).limit(0),comments.summary(true).limit(0)',
    limit: 25,
  }, pageToken);
  outer: for (;;) {
    for (const p of data.data || []) {
      if (p.created_time && new Date(p.created_time).getTime() < cutoff) break outer;
      raw.push(p);
      if (raw.length >= limit) break outer;
    }
    if (!data.paging?.next) break;
    data = await fetchNext(data.paging.next);
  }

  const posts = [];
  for (const p of raw) {
    const post = {
      postId: p.id,
      url: p.permalink_url || '',
      caption: p.message || '',
      mediaType: 'post',
      thumbnail: p.full_picture || '',
      publishedAt: p.created_time ? new Date(p.created_time) : undefined,
      likes: toNumber(p.reactions?.summary?.total_count) || 0,
      comments: toNumber(p.comments?.summary?.total_count) || 0,
      shares: toNumber(p.shares?.count) || 0,
      reach: 0, impressions: 0, views: 0, saved: 0,
    };
    // Post impressions/reach are frequently deprecated on Pages — best effort.
    try {
      const r = await call(`${p.id}/insights`, { metric: 'post_impressions,post_impressions_unique' }, pageToken);
      for (const x of r.data || []) {
        const v = x.values?.[0]?.value;
        if (typeof v === 'number') { if (x.name === 'post_impressions') post.impressions = v; else if (x.name === 'post_impressions_unique') post.reach = v; }
      }
    } catch { /* insights unavailable for this page */ }
    posts.push(post);
  }
  return posts;
};

const normalizeAdAccountId = (id = '') => String(id).replace(/^act_/i, '').trim();

export const listAdAccounts = async () => {
  const out = [];
  const seen = new Set();

  const pushAccount = (account) => {
    const accountId = normalizeAdAccountId(account.account_id || account.id);
    if (!accountId || seen.has(accountId)) return;
    seen.add(accountId);
    out.push({
      id: `act_${accountId}`,
      accountId,
      name: account.name || `act_${accountId}`,
      currency: account.currency || '',
      accountStatus: account.account_status,
    });
  };

  const collectPagedAccounts = async (path) => {
    let data = await call(path, {
      fields: 'id,account_id,name,account_status,currency',
      limit: 100,
    });
    for (;;) {
      for (const account of data.data || []) pushAccount(account);
      if (!data.paging?.next) break;
      data = await fetchNext(data.paging.next);
    }
  };

  // Directly assigned ad accounts on the identity.
  try { await collectPagedAccounts('me/adaccounts'); } catch { /* continue with business fallbacks */ }

  // Many system-user tokens don't expose accounts on /me/adaccounts even when
  // ads_read is granted; accounts are visible via business-owned/client lists.
  try {
    let businesses = await call('me/businesses', { fields: 'id,name', limit: 100 });
    for (;;) {
      for (const biz of businesses.data || []) {
        if (!biz?.id) continue;
        try { await collectPagedAccounts(`${biz.id}/owned_ad_accounts`); } catch { /* ignore one business */ }
        try { await collectPagedAccounts(`${biz.id}/client_ad_accounts`); } catch { /* ignore one business */ }
      }
      if (!businesses.paging?.next) break;
      businesses = await fetchNext(businesses.paging.next);
    }
  } catch { /* no business visibility */ }

  return out;
};

const parseNum = (v) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

export const getAdInsights = async (adAccountId, { since, until }) => {
  const norm = normalizeAdAccountId(adAccountId);
  if (!norm) return [];

  const range = {
    since: String(since).slice(0, 10),
    until: String(until).slice(0, 10),
  };

  const rows = [];
  let data = await call(`act_${norm}/insights`, {
    fields: 'account_id,account_name,date_start,date_stop,impressions,reach,clicks,spend,cpc,cpm,ctr',
    level: 'account',
    time_increment: 1,
    time_range: JSON.stringify(range),
    limit: 100,
  });

  for (;;) {
    for (const r of data.data || []) {
      rows.push({
        accountId: normalizeAdAccountId(r.account_id || norm),
        accountName: r.account_name || '',
        dateStart: r.date_start,
        dateStop: r.date_stop,
        impressions: parseNum(r.impressions),
        reach: parseNum(r.reach),
        clicks: parseNum(r.clicks),
        spend: parseNum(r.spend),
        cpc: parseNum(r.cpc),
        cpm: parseNum(r.cpm),
        ctr: parseNum(r.ctr),
        raw: r,
      });
    }
    if (!data.paging?.next) break;
    data = await fetchNext(data.paging.next);
  }

  return rows;
};
