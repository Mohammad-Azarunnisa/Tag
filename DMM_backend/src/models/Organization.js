import mongoose from 'mongoose';

// A tenant. Every CEO/User belongs to one organization, and all org-scoped data
// (approvals, templates, assets, analytics, notifications, activity) references it.
const organizationSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true, unique: true },
    slug: { type: String, required: true, unique: true, lowercase: true, trim: true },
    description: { type: String, default: '' },
    logo: { type: String, default: '' },
    logoPublicId: { type: String, default: '' },
    website: { type: String, default: '' },
    // Visual accent for the org (used in product app branding)
    color: { type: String, default: '#6366f1' },
    // Yearly goal: targets to reach by the end of `year`. Progress is computed
    // from analytics (followers) and posted approvals (posts).
    goal: {
      year: { type: Number, default: 0 },
      targetFollowers: { type: Number, default: 0 },
      targetPosts: { type: Number, default: 0 },
      note: { type: String, default: '' },
    },
    // Meta (Facebook/Instagram) account mapping — links this org to its Meta
    // assets so analytics can be pulled automatically via the Graph API. The
    // master token itself is NEVER stored here; it lives only in the backend
    // environment (META_SYSTEM_TOKEN).
    metaPageId: { type: String, default: '' },
    metaPageName: { type: String, default: '' },
    metaInstagramId: { type: String, default: '' },
    metaInstagramUsername: { type: String, default: '' },
    metaAdAccountId: { type: String, default: '' },
    metaAdAccountName: { type: String, default: '' },
    metaAdCurrency: { type: String, default: '' },

    // YouTube channel mapping — the API key lives only in the backend env
    // (YOUTUBE_API_KEY); we store just the channel id/title to pull public stats.
    youtubeChannelId: { type: String, default: '' },
    youtubeChannelTitle: { type: String, default: '' },

    isActive: { type: Boolean, default: true },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true }
);

export const slugify = (name = '') =>
  name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

const Organization = mongoose.model('Organization', organizationSchema);
export default Organization;
