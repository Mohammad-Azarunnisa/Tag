import asyncHandler from 'express-async-handler';
import Organization from '../models/Organization.js';
import Analytics from '../models/Analytics.js';
import MetaAdSnapshot from '../models/MetaAdSnapshot.js';
import { logActivity } from '../utils/logActivity.js';
import { requireOrgId } from '../utils/org.js';
import { ACTIVITY_ACTIONS } from '../config/constants.js';
import {
  hasToken, listAccounts, probe, REQUIRED_SCOPES, getPageToken,
  getInstagramMetrics, getFacebookMetrics, listAdAccounts, getAdInsights,
} from '../services/metaService.js';

// Never expose page access tokens to the client.
const publicAccount = ({ pageToken, ...rest }) => rest;

// Normalize a name for fuzzy matching org <-> Meta account.
const norm = (s = '') => String(s).toLowerCase().replace(/[^a-z0-9]/g, '');

// Friendly, user-facing message for a Meta error.
const explain = (e) => {
  if (e.notConfigured) return 'No Meta token is configured. Add META_SYSTEM_TOKEN to the backend .env file.';
  if (e.metaCode === 100 && /appsecret_proof/i.test(e.message || '')) return 'Your Meta app requires an app-secret proof. Add META_APP_SECRET (Meta app → Settings → Basic → App Secret) to the backend .env and restart.';
  if (e.metaCode === 190) return 'The Meta token is invalid or expired. Generate a fresh System User token and update META_SYSTEM_TOKEN.';
  if (e.metaCode === 10 || e.metaCode === 200) return 'The token is missing required permissions. It needs instagram_basic, instagram_manage_insights, pages_read_engagement and pages_read_user_content.';
  if (e.metaCode === 4 || e.metaCode === 17 || e.metaCode === 32 || e.metaCode === 613) return 'Meta rate limit reached. Please wait a few minutes and try again.';
  return e.message || 'Meta request failed.';
};

const upsertDay = async (orgId, platform, metrics) => {
  const now = new Date();
  const day = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const dayEnd = new Date(day.getTime() + 86400000);
  let snap = await Analytics.findOne({ organization: orgId, platform, date: { $gte: day, $lt: dayEnd } });
  if (!snap) snap = new Analytics({ organization: orgId, platform, date: day });
  for (const [field, raw] of Object.entries(metrics)) {
    const val = Number(raw);
    if (Number.isFinite(val) && val >= 0) snap[field] = val;
  }
  await snap.save();
  return { date: day, snapshot: snap };
};

// @route GET /api/meta/status — is Meta connected? what does the token see?
export const metaStatus = asyncHandler(async (req, res) => {
  if (!hasToken()) {
    return res.json({ configured: false, connected: false, message: 'No Meta token configured. Add META_SYSTEM_TOKEN to the backend .env to enable automatic sync.' });
  }
  try {
    const [identity, accounts] = [await probe(), await listAccounts()];
    const missingScopes = identity.scopes.length ? REQUIRED_SCOPES.filter((s) => !identity.scopes.includes(s)) : [];
    res.json({
      configured: true,
      connected: true,
      identity: { name: identity.name },
      pages: accounts.length,
      instagram: accounts.filter((a) => a.instagramId).length,
      missingScopes,
      requiredScopes: REQUIRED_SCOPES,
    });
  } catch (e) {
    res.json({ configured: true, connected: false, message: explain(e), code: e.metaCode });
  }
});

// @route GET /api/meta/accounts — discovered Meta accounts + current org mappings,
// with a suggested auto-match by name.
export const metaAccountsList = asyncHandler(async (req, res) => {
  if (!hasToken()) { res.status(400); throw new Error('No Meta token configured. Add META_SYSTEM_TOKEN to the backend .env.'); }
  let accounts;
  try { accounts = await listAccounts(); }
  catch (e) { res.status(400); throw new Error(explain(e)); }

  const orgs = await Organization.find({ isActive: true }).select('name metaPageId metaPageName metaInstagramId metaInstagramUsername').lean();
  // Suggest a match for orgs that aren't mapped yet.
  const suggestions = {};
  for (const org of orgs) {
    if (org.metaPageId) continue;
    const hit = accounts.find((a) => norm(a.pageName) === norm(org.name) || (a.instagramUsername && norm(a.instagramUsername) === norm(org.name)));
    if (hit) suggestions[org._id] = hit.pageId;
  }
  res.json({ success: true, accounts: accounts.map(publicAccount), organizations: orgs, suggestions });
});

// @route POST /api/meta/map — link an org to a Meta page/IG account.
export const mapMetaAccount = asyncHandler(async (req, res) => {
  const { organizationId, pageId } = req.body;
  const org = await Organization.findById(organizationId);
  if (!org) { res.status(404); throw new Error('Organization not found'); }

  if (!pageId) {
    // Unlink
    org.metaPageId = ''; org.metaPageName = ''; org.metaInstagramId = ''; org.metaInstagramUsername = '';
  } else {
    let accounts;
    try { accounts = await listAccounts(); }
    catch (e) { res.status(400); throw new Error(explain(e)); }
    const acct = accounts.find((a) => a.pageId === String(pageId));
    if (!acct) { res.status(400); throw new Error('That Meta page is not visible to the current token.'); }
    org.metaPageId = acct.pageId;
    org.metaPageName = acct.pageName;
    org.metaInstagramId = acct.instagramId || '';
    org.metaInstagramUsername = acct.instagramUsername || '';
  }
  await org.save();
  logActivity({ user: req.user._id, organization: org._id, action: ACTIVITY_ACTIONS.ANALYTICS_UPDATED, description: `Linked "${org.name}" to Meta page ${org.metaPageName || '(none)'}`, entityType: 'Organization', entityId: org._id });
  res.json({ success: true, organization: { _id: org._id, name: org.name, metaPageId: org.metaPageId, metaPageName: org.metaPageName, metaInstagramId: org.metaInstagramId, metaInstagramUsername: org.metaInstagramUsername } });
});

// @route POST /api/meta/automap — auto-link every unmapped org by name match.
export const autoMapMeta = asyncHandler(async (req, res) => {
  if (!hasToken()) { res.status(400); throw new Error('No Meta token configured.'); }
  let accounts;
  try { accounts = await listAccounts(); }
  catch (e) { res.status(400); throw new Error(explain(e)); }
  const orgs = await Organization.find({ isActive: true });
  const mapped = [];
  for (const org of orgs) {
    if (org.metaPageId) continue;
    const hit = accounts.find((a) => norm(a.pageName) === norm(org.name) || (a.instagramUsername && norm(a.instagramUsername) === norm(org.name)));
    if (!hit) continue;
    org.metaPageId = hit.pageId; org.metaPageName = hit.pageName;
    org.metaInstagramId = hit.instagramId || ''; org.metaInstagramUsername = hit.instagramUsername || '';
    await org.save();
    mapped.push({ organization: org.name, page: hit.pageName });
  }
  res.json({ success: true, mapped, count: mapped.length });
});

// @route POST /api/meta/sync?platform= — pull live metrics for one org and write
// today's snapshot. Without ?platform, syncs both Instagram and Facebook.
export const syncMeta = asyncHandler(async (req, res) => {
  if (!hasToken()) { res.status(400); throw new Error('Meta is not connected. Add META_SYSTEM_TOKEN to the backend .env.'); }
  const orgId = requireOrgId(req, res);
  const org = await Organization.findById(orgId);
  if (!org) { res.status(404); throw new Error('Organization not found'); }

  const only = req.query.platform || req.body?.platform;
  const targets = only ? [only] : ['Instagram', 'Facebook'];
  const written = [];
  const skipped = [];

  // Page Access Token powers both Facebook page insights and the linked
  // Instagram account's insights. Fetched once per sync.
  const pageToken = org.metaPageId ? await getPageToken(org.metaPageId) : null;

  for (const platform of targets) {
    try {
      let metrics = null;
      if (platform === 'Instagram') {
        if (!org.metaInstagramId) { skipped.push({ platform, reason: 'No Instagram account linked to this organization.' }); continue; }
        metrics = await getInstagramMetrics(org.metaInstagramId, pageToken);
      } else if (platform === 'Facebook') {
        if (!org.metaPageId) { skipped.push({ platform, reason: 'No Facebook page linked to this organization.' }); continue; }
        metrics = await getFacebookMetrics(org.metaPageId, pageToken);
      } else {
        skipped.push({ platform, reason: 'Only Instagram and Facebook can sync from Meta.' }); continue;
      }
      if (!metrics || !Object.keys(metrics).length) { skipped.push({ platform, reason: 'Meta returned no metrics for this account (check permissions or that the account has data).' }); continue; }
      const { date } = await upsertDay(orgId, platform, metrics);
      written.push({ platform, date, fields: Object.keys(metrics), metrics });
    } catch (e) {
      skipped.push({ platform, reason: explain(e) });
    }
  }

  if (written.length) {
    logActivity({ user: req.user._id, organization: orgId, action: ACTIVITY_ACTIONS.ANALYTICS_UPDATED, description: `Synced ${written.map((w) => w.platform).join(' + ')} from Meta`, entityType: 'Analytics' });
  }
  res.json({ success: written.length > 0, written, skipped });
});

// @route GET /api/meta/ads/status — token health for Ads/Marketing API.
export const metaAdsStatus = asyncHandler(async (req, res) => {
  if (!hasToken()) {
    return res.json({ configured: false, connected: false, message: 'No Meta token configured. Add META_SYSTEM_TOKEN to the backend .env.' });
  }
  try {
    const [identity, accounts] = await Promise.all([probe(), listAdAccounts()]);
    const required = ['ads_read', 'business_management'];
    const missingScopes = identity.scopes.length ? required.filter((s) => !identity.scopes.includes(s)) : [];
    res.json({
      configured: true,
      connected: true,
      identity: { name: identity.name },
      adAccounts: accounts.length,
      missingScopes,
      requiredScopes: required,
    });
  } catch (e) {
    res.json({ configured: true, connected: false, message: explain(e), code: e.metaCode });
  }
});

// @route GET /api/meta/ads/accounts — visible ad accounts + org mappings.
export const metaAdsAccountsList = asyncHandler(async (req, res) => {
  if (!hasToken()) { res.status(400); throw new Error('No Meta token configured. Add META_SYSTEM_TOKEN to the backend .env.'); }
  let accounts;
  try { accounts = await listAdAccounts(); }
  catch (e) { res.status(400); throw new Error(explain(e)); }

  const orgs = await Organization.find({ isActive: true })
    .select('name metaAdAccountId metaAdAccountName metaAdCurrency')
    .sort({ name: 1 })
    .lean();
  res.json({ success: true, accounts, organizations: orgs });
});

// @route POST /api/meta/ads/map — link an org to a Meta ad account.
export const mapMetaAdAccount = asyncHandler(async (req, res) => {
  const { organizationId, adAccountId } = req.body;
  const org = await Organization.findById(organizationId);
  if (!org) { res.status(404); throw new Error('Organization not found'); }

  if (!adAccountId) {
    org.metaAdAccountId = '';
    org.metaAdAccountName = '';
    org.metaAdCurrency = '';
  } else {
    let accounts;
    try { accounts = await listAdAccounts(); }
    catch (e) { res.status(400); throw new Error(explain(e)); }
    const cleanId = String(adAccountId).replace(/^act_/i, '').trim();
    const account = accounts.find((a) => String(a.accountId) === cleanId);
    if (!account) { res.status(400); throw new Error('That ad account is not visible to the current token.'); }
    org.metaAdAccountId = account.accountId;
    org.metaAdAccountName = account.name;
    org.metaAdCurrency = account.currency || '';
  }

  await org.save();
  logActivity({
    user: req.user._id,
    organization: org._id,
    action: ACTIVITY_ACTIONS.ANALYTICS_UPDATED,
    description: `Linked "${org.name}" to Meta ad account ${org.metaAdAccountName || '(none)'}`,
    entityType: 'Organization',
    entityId: org._id,
  });
  res.json({
    success: true,
    organization: {
      _id: org._id,
      name: org.name,
      metaAdAccountId: org.metaAdAccountId,
      metaAdAccountName: org.metaAdAccountName,
      metaAdCurrency: org.metaAdCurrency,
    },
  });
});

// @route POST /api/meta/ads/sync?organizationId=&from=&to= — pull paid metrics.
export const syncMetaAds = asyncHandler(async (req, res) => {
  if (!hasToken()) { res.status(400); throw new Error('Meta is not connected. Add META_SYSTEM_TOKEN to the backend .env.'); }
  const orgId = requireOrgId(req, res);
  const org = await Organization.findById(orgId);
  if (!org) { res.status(404); throw new Error('Organization not found'); }
  if (!org.metaAdAccountId) { res.status(400); throw new Error('No Meta ad account linked for this organization.'); }

  const today = new Date().toISOString().slice(0, 10);
  const from = String(req.query.from || req.body?.from || today).slice(0, 10);
  const to = String(req.query.to || req.body?.to || today).slice(0, 10);

  let rows;
  try { rows = await getAdInsights(org.metaAdAccountId, { since: from, until: to }); }
  catch (e) { res.status(400); throw new Error(explain(e)); }

  let written = 0;
  for (const row of rows) {
    const dateStart = new Date(`${row.dateStart}T00:00:00.000Z`);
    const dateStop = new Date(`${row.dateStop}T00:00:00.000Z`);
    await MetaAdSnapshot.findOneAndUpdate(
      { organization: org._id, adAccountId: row.accountId, dateStart },
      {
        organization: org._id,
        adAccountId: row.accountId,
        adAccountName: row.accountName || org.metaAdAccountName || '',
        currency: org.metaAdCurrency || '',
        dateStart,
        dateStop,
        spend: row.spend,
        impressions: row.impressions,
        reach: row.reach,
        clicks: row.clicks,
        ctr: row.ctr,
        cpc: row.cpc,
        cpm: row.cpm,
        raw: row.raw,
        syncedBy: req.user._id,
      },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );
    written += 1;
  }

  logActivity({
    user: req.user._id,
    organization: org._id,
    action: ACTIVITY_ACTIONS.ANALYTICS_UPDATED,
    description: `Synced Meta paid metrics (${from} to ${to}) for ${org.name}`,
    entityType: 'MetaAdSnapshot',
  });

  res.json({ success: true, from, to, written });
});

// @route GET /api/meta/ads/report?organizationId=&range=
export const getMetaAdsReport = asyncHandler(async (req, res) => {
  const orgId = requireOrgId(req, res);
  const range = Math.max(1, Math.min(365, Number(req.query.range || 30)));
  const since = new Date(Date.now() - (range - 1) * 86400000);
  since.setUTCHours(0, 0, 0, 0);

  const rows = await MetaAdSnapshot.find({ organization: orgId, dateStart: { $gte: since } })
    .sort({ dateStart: 1 })
    .lean();

  const totals = rows.reduce((acc, row) => {
    acc.spend += row.spend || 0;
    acc.impressions += row.impressions || 0;
    acc.reach += row.reach || 0;
    acc.clicks += row.clicks || 0;
    return acc;
  }, { spend: 0, impressions: 0, reach: 0, clicks: 0 });

  const ctr = totals.impressions > 0 ? (totals.clicks / totals.impressions) * 100 : 0;
  const cpc = totals.clicks > 0 ? totals.spend / totals.clicks : 0;
  const cpm = totals.impressions > 0 ? (totals.spend / totals.impressions) * 1000 : 0;
  const latest = rows.length ? rows[rows.length - 1] : null;

  res.json({
    success: true,
    range,
    latest,
    totals: {
      spend: Number(totals.spend.toFixed(2)),
      impressions: totals.impressions,
      reach: totals.reach,
      clicks: totals.clicks,
      ctr: Number(ctr.toFixed(2)),
      cpc: Number(cpc.toFixed(2)),
      cpm: Number(cpm.toFixed(2)),
      currency: latest?.currency || '',
    },
    series: rows.map((r) => ({
      date: r.dateStart,
      spend: r.spend,
      impressions: r.impressions,
      reach: r.reach,
      clicks: r.clicks,
      ctr: r.ctr,
      cpc: r.cpc,
      cpm: r.cpm,
    })),
  });
});
