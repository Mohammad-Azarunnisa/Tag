import mongoose from 'mongoose';

// Social media analytics snapshot per platform. The seed script creates a
// daily series so the dashboard can render trend charts.
const analyticsSchema = new mongoose.Schema(
  {
    organization: { type: mongoose.Schema.Types.ObjectId, ref: 'Organization', required: true, index: true },
    platform: {
      type: String,
      enum: ['LinkedIn', 'Instagram', 'YouTube', 'Facebook'],
      required: true,
    },
    date: { type: Date, required: true },

    // ---- Audience / Followers ----
    profilesManaged: { type: Number, default: 0 },
    followers: { type: Number, default: 0 }, // total followers
    newFollowers: { type: Number, default: 0 }, // gained this period
    followersLast30Days: { type: Number, default: 0 }, // gained in last 30 days
    organicFollowers: { type: Number, default: 0 }, // LinkedIn: organic follows
    sponsoredFollowers: { type: Number, default: 0 }, // LinkedIn: sponsored/paid follows
    subscribers: { type: Number, default: 0 }, // YouTube
    videoCount: { type: Number, default: 0 }, // YouTube: total public videos

    // ---- Discovery / Reach ----
    impressions: { type: Number, default: 0 }, // post impressions
    uniqueImpressions: { type: Number, default: 0 }, // LinkedIn: unique impressions
    reach: { type: Number, default: 0 },
    searchAppearances: { type: Number, default: 0 },
    views: { type: Number, default: 0 }, // YouTube
    watchHours: { type: Number, default: 0 }, // YouTube

    // ---- Content / Engagement ----
    postsPublished: { type: Number, default: 0 }, // LinkedIn: posts published in period
    clicks: { type: Number, default: 0 }, // LinkedIn: post/page clicks
    clickThroughRate: { type: Number, default: 0 }, // percentage
    engagementRate: { type: Number, default: 0 }, // percentage
    reactions: { type: Number, default: 0 },
    comments: { type: Number, default: 0 },
    reposts: { type: Number, default: 0 },
    interactions: { type: Number, default: 0 }, // Instagram: total interactions (likes + comments + saves + shares)

    // ---- Visitors ----
    pageViews: { type: Number, default: 0 },
    uniqueVisitors: { type: Number, default: 0 },
    visits: { type: Number, default: 0 }, // Facebook/Meta: page visits
    linkClicks: { type: Number, default: 0 }, // Facebook/Meta: link clicks
    desktopPageViews: { type: Number, default: 0 }, // LinkedIn: desktop page views
    mobilePageViews: { type: Number, default: 0 }, // LinkedIn: mobile page views
    customButtonClicks: { type: Number, default: 0 }, // LinkedIn: custom CTA button clicks

    // ---- Leads ----
    leads: { type: Number, default: 0 }, // LinkedIn: leads generated
    leadFormViews: { type: Number, default: 0 }, // LinkedIn: lead form opens
    leadConversionRate: { type: Number, default: 0 }, // percentage
  },
  { timestamps: true }
);

analyticsSchema.index({ organization: 1, platform: 1, date: -1 });

const Analytics = mongoose.model('Analytics', analyticsSchema);
export default Analytics;
