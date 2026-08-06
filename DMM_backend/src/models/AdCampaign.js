import mongoose from 'mongoose';

// A paid campaign as the team runs it: what was spent, what came back, and what
// it was trying to do.
//
// MetaAdSnapshot already stores what the Meta API returns per ad account
// (spend / reach / impressions / clicks), but the API does not give us the number
// that management actually asks about — enquiries. Leads are counted in the CRM or
// on the form, so they are entered here, which is also what makes cost per lead
// and the top-campaigns table possible.
export const CAMPAIGN_OBJECTIVES = [
  'Lead generation',
  'Reach / awareness',
  'Traffic',
  'Engagement',
  'Video views',
  'Other',
];

export const CAMPAIGN_CHANNELS = [
  'Meta — Instagram',
  'Meta — Facebook',
  'Google Search',
  'YouTube',
  'WhatsApp / other',
];

const adCampaignSchema = new mongoose.Schema(
  {
    organization: { type: mongoose.Schema.Types.ObjectId, ref: 'Organization', required: true, index: true },
    name: { type: String, required: true, trim: true },
    objective: { type: String, enum: CAMPAIGN_OBJECTIVES, default: 'Lead generation', index: true },
    channel: { type: String, enum: CAMPAIGN_CHANNELS, default: 'Meta — Instagram', index: true },

    // The window the figures cover, so a campaign lands in the right report.
    startDate: { type: Date, required: true, index: true },
    endDate: { type: Date, required: true, index: true },

    // The five figures taken off Meta Ads Manager, plus leads from the form/CRM.
    spend: { type: Number, default: 0 },
    reach: { type: Number, default: 0 },
    impressions: { type: Number, default: 0 },
    clicks: { type: Number, default: 0 },
    leads: { type: Number, default: 0 },

    notes: { type: String, default: '' },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true }
);

adCampaignSchema.index({ organization: 1, startDate: -1 });

// Everything below is arithmetic on the five entered figures — derived rather
// than stored, so a corrected spend can never leave a stale cost behind.
const round = (n, dp = 2) => Math.round(n * 10 ** dp) / 10 ** dp;

adCampaignSchema.virtual('frequency').get(function () {
  return this.reach ? round(this.impressions / this.reach) : 0;
});
adCampaignSchema.virtual('ctr').get(function () {
  return this.impressions ? round((this.clicks / this.impressions) * 100) : 0;
});
adCampaignSchema.virtual('cpm').get(function () {
  return this.impressions ? round((this.spend / this.impressions) * 1000) : 0;
});
adCampaignSchema.virtual('cpc').get(function () {
  return this.clicks ? round(this.spend / this.clicks) : 0;
});
// An awareness campaign has no leads by design, so this stays null rather than
// reporting an infinite or zero cost per lead.
adCampaignSchema.virtual('costPerLead').get(function () {
  return this.leads ? round(this.spend / this.leads) : null;
});

adCampaignSchema.set('toJSON', { virtuals: true });
adCampaignSchema.set('toObject', { virtuals: true });

const AdCampaign = mongoose.model('AdCampaign', adCampaignSchema);
export default AdCampaign;
