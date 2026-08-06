import asyncHandler from 'express-async-handler';
import AdCampaign, { CAMPAIGN_OBJECTIVES, CAMPAIGN_CHANNELS } from '../models/AdCampaign.js';
import Organization from '../models/Organization.js';
import { logActivity } from '../utils/logActivity.js';
import { accessibleOrgIds, canAccessOrg, resolveOrgId } from '../utils/org.js';
import { ACTIVITY_ACTIONS } from '../config/constants.js';

const populate = (q) => q.populate('organization', 'name color code').populate('createdBy', 'name');

// The five figures taken off Ads Manager, plus leads. Anything else on the model
// is derived, so it is never accepted from the client.
const ENTERED = ['spend', 'reach', 'impressions', 'clicks', 'leads'];
const readFigures = (body) => {
  const out = {};
  for (const key of ENTERED) {
    if (body[key] === undefined) continue;
    const n = Number(body[key]);
    out[key] = Number.isFinite(n) && n >= 0 ? n : 0;
  }
  return out;
};

// @route GET /api/ad-campaigns?from=&to=&organizationId=
export const listAdCampaigns = asyncHandler(async (req, res) => {
  const { organizationId, objective, from, to, search } = req.query;
  const query = {};

  const allowed = accessibleOrgIds(req.user);
  if (allowed !== null) query.organization = { $in: allowed };
  if (organizationId && organizationId !== 'All') {
    query.organization = canAccessOrg(req.user, organizationId) ? organizationId : null;
  }
  if (objective && objective !== 'All') query.objective = objective;
  if (search) query.name = { $regex: String(search), $options: 'i' };

  // A campaign belongs to a window if it overlaps it — a month-long campaign
  // shows up in a fortnight that falls inside it.
  const isDay = (s) => /^\d{4}-\d{2}-\d{2}$/.test(s || '');
  if (isDay(from)) query.endDate = { $gte: new Date(`${from}T00:00:00.000Z`) };
  if (isDay(to)) query.startDate = { $lte: new Date(`${to}T23:59:59.999Z`) };

  const campaigns = await populate(AdCampaign.find(query).sort({ startDate: -1 })).lean({ virtuals: true });
  const totals = campaigns.reduce((t, c) => ({
    spend: t.spend + (c.spend || 0),
    reach: t.reach + (c.reach || 0),
    impressions: t.impressions + (c.impressions || 0),
    clicks: t.clicks + (c.clicks || 0),
    leads: t.leads + (c.leads || 0),
  }), { spend: 0, reach: 0, impressions: 0, clicks: 0, leads: 0 });

  res.json({
    success: true,
    objectives: CAMPAIGN_OBJECTIVES,
    channels: CAMPAIGN_CHANNELS,
    totals: {
      ...totals,
      costPerLead: totals.leads ? Math.round(totals.spend / totals.leads) : null,
    },
    campaigns,
  });
});

// @route POST /api/ad-campaigns
export const createAdCampaign = asyncHandler(async (req, res) => {
  const { name, objective, channel, startDate, endDate, notes } = req.body;
  if (!name || !String(name).trim()) { res.status(400); throw new Error('Give the campaign a name'); }
  if (objective && !CAMPAIGN_OBJECTIVES.includes(objective)) {
    res.status(400); throw new Error(`objective must be one of ${CAMPAIGN_OBJECTIVES.join(', ')}`);
  }
  if (channel && !CAMPAIGN_CHANNELS.includes(channel)) {
    res.status(400); throw new Error(`channel must be one of ${CAMPAIGN_CHANNELS.join(', ')}`);
  }

  const start = new Date(startDate);
  const end = new Date(endDate);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
    res.status(400); throw new Error('Valid start and end dates are required');
  }
  if (end < start) { res.status(400); throw new Error('The end date cannot be before the start date'); }

  const orgId = req.body.organization || resolveOrgId(req);
  if (!orgId) { res.status(400); throw new Error('Choose the college this campaign ran for'); }
  if (!canAccessOrg(req.user, orgId)) { res.status(403); throw new Error('You do not have access to that college'); }
  const org = await Organization.findById(orgId).select('_id name isActive');
  if (!org || !org.isActive) { res.status(400); throw new Error('That college does not exist'); }

  const campaign = await AdCampaign.create({
    organization: org._id,
    name: String(name).trim(),
    objective: objective || 'Lead generation',
    channel: channel || 'Meta — Instagram',
    startDate: start,
    endDate: end,
    notes: String(notes || '').trim(),
    createdBy: req.user._id,
    ...readFigures(req.body),
  });

  await logActivity({
    user: req.user._id, organization: org._id, action: ACTIVITY_ACTIONS.AD_CAMPAIGN_UPDATED,
    description: `Recorded campaign "${campaign.name}" (₹${campaign.spend} spend, ${campaign.leads} leads)`,
    entityType: 'AdCampaign', entityId: campaign._id,
  });

  const created = await populate(AdCampaign.findById(campaign._id)).lean({ virtuals: true });
  res.status(201).json({ success: true, campaign: created });
});

// @route PUT /api/ad-campaigns/:id
export const updateAdCampaign = asyncHandler(async (req, res) => {
  const campaign = await AdCampaign.findById(req.params.id);
  if (!campaign) { res.status(404); throw new Error('Campaign not found'); }
  if (!canAccessOrg(req.user, campaign.organization)) {
    res.status(403); throw new Error('That campaign belongs to a college you do not have access to');
  }

  const { name, objective, channel, startDate, endDate, notes } = req.body;
  if (name !== undefined) {
    if (!String(name).trim()) { res.status(400); throw new Error('Give the campaign a name'); }
    campaign.name = String(name).trim();
  }
  if (objective !== undefined) {
    if (!CAMPAIGN_OBJECTIVES.includes(objective)) { res.status(400); throw new Error('Invalid objective'); }
    campaign.objective = objective;
  }
  if (channel !== undefined) {
    if (!CAMPAIGN_CHANNELS.includes(channel)) { res.status(400); throw new Error('Invalid channel'); }
    campaign.channel = channel;
  }
  if (startDate !== undefined) {
    const d = new Date(startDate);
    if (Number.isNaN(d.getTime())) { res.status(400); throw new Error('Invalid start date'); }
    campaign.startDate = d;
  }
  if (endDate !== undefined) {
    const d = new Date(endDate);
    if (Number.isNaN(d.getTime())) { res.status(400); throw new Error('Invalid end date'); }
    campaign.endDate = d;
  }
  if (campaign.endDate < campaign.startDate) {
    res.status(400); throw new Error('The end date cannot be before the start date');
  }
  if (notes !== undefined) campaign.notes = String(notes).trim();
  Object.assign(campaign, readFigures(req.body));

  await campaign.save();
  await logActivity({
    user: req.user._id, organization: campaign.organization, action: ACTIVITY_ACTIONS.AD_CAMPAIGN_UPDATED,
    description: `Updated campaign "${campaign.name}"`,
    entityType: 'AdCampaign', entityId: campaign._id,
  });

  const updated = await populate(AdCampaign.findById(campaign._id)).lean({ virtuals: true });
  res.json({ success: true, campaign: updated });
});

// @route DELETE /api/ad-campaigns/:id
export const deleteAdCampaign = asyncHandler(async (req, res) => {
  const campaign = await AdCampaign.findById(req.params.id);
  if (!campaign) { res.status(404); throw new Error('Campaign not found'); }
  if (!canAccessOrg(req.user, campaign.organization)) {
    res.status(403); throw new Error('That campaign belongs to a college you do not have access to');
  }
  await campaign.deleteOne();
  res.json({ success: true, message: 'Campaign removed' });
});
