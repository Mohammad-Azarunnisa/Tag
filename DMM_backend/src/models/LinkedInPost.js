import mongoose from 'mongoose';

// One post from a LinkedIn Content export's "All posts" sheet — powers the
// post-performance table in the LinkedIn view. Re-importing upserts by post
// URL (or title+date when the export has no link), so numbers stay current.
const linkedInPostSchema = new mongoose.Schema(
  {
    organization: { type: mongoose.Schema.Types.ObjectId, ref: 'Organization', required: true, index: true },
    title: { type: String, default: '' },
    url: { type: String, default: '' },
    postType: { type: String, default: '' }, // Organic | Sponsored
    contentType: { type: String, default: '' }, // Image | Video | Article | Poll…
    postedBy: { type: String, default: '' },
    createdDate: { type: Date },

    impressions: { type: Number, default: 0 },
    views: { type: Number, default: 0 }, // video views when present
    clicks: { type: Number, default: 0 },
    clickThroughRate: { type: Number, default: 0 }, // percentage
    reactions: { type: Number, default: 0 },
    comments: { type: Number, default: 0 },
    reposts: { type: Number, default: 0 },
    follows: { type: Number, default: 0 },
    engagementRate: { type: Number, default: 0 }, // percentage
  },
  { timestamps: true }
);

linkedInPostSchema.index({ organization: 1, createdDate: -1 });

const LinkedInPost = mongoose.model('LinkedInPost', linkedInPostSchema);
export default LinkedInPost;
