import mongoose from 'mongoose';

// A tracked competitor company for an organization, per platform (LinkedIn-style
// "Competitors" view). Unlike Analytics, a competitor holds its latest values
// only — the admin edits the numbers in place rather than building a time series.
const competitorSchema = new mongoose.Schema(
  {
    organization: { type: mongoose.Schema.Types.ObjectId, ref: 'Organization', required: true, index: true },
    platform: {
      type: String,
      enum: ['LinkedIn', 'Instagram', 'YouTube', 'Facebook'],
      default: 'LinkedIn',
    },
    name: { type: String, required: true, trim: true }, // competitor company name
    handle: { type: String, trim: true, default: '' }, // optional @handle / page URL

    followers: { type: Number, default: 0 }, // total followers
    newFollowers: { type: Number, default: 0 }, // gained in the period
    postsLast30Days: { type: Number, default: 0 }, // posting frequency
    engagementRate: { type: Number, default: 0 }, // percentage
    // LinkedIn's own "Competitors" export reports engagement as raw counts
    // rather than a rate, so those columns are kept as they come instead of
    // being thrown away on import.
    comments: { type: Number, default: 0 },
    commentsPerDay: { type: Number, default: 0 },
    reactions: { type: Number, default: 0 },
  },
  { timestamps: true }
);

competitorSchema.index({ organization: 1, platform: 1, followers: -1 });

const Competitor = mongoose.model('Competitor', competitorSchema);
export default Competitor;
