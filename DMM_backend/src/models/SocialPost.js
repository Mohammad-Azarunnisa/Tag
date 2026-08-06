import mongoose from 'mongoose';

// One published post/media/video pulled from the platform API, with its
// engagement metrics — the Instagram/Facebook/YouTube equivalent of the
// LinkedInPost table. Re-syncing upserts by (organization, platform, postId)
// so numbers stay current and the click-through link is preserved.
const socialPostSchema = new mongoose.Schema(
  {
    organization: { type: mongoose.Schema.Types.ObjectId, ref: 'Organization', required: true, index: true },
    platform: { type: String, enum: ['Instagram', 'Facebook', 'YouTube'], required: true, index: true },
    postId: { type: String, required: true }, // platform-native id (media/post/video id)
    url: { type: String, default: '' }, // permalink / watch URL — the clickable link
    caption: { type: String, default: '' }, // caption / message / title
    mediaType: { type: String, default: '' }, // IMAGE | VIDEO | CAROUSEL_ALBUM | REEL | video …
    thumbnail: { type: String, default: '' },
    publishedAt: { type: Date, index: true },

    // Engagement metrics (whatever the platform exposes; 0 when unavailable).
    impressions: { type: Number, default: 0 },
    reach: { type: Number, default: 0 },
    views: { type: Number, default: 0 },
    likes: { type: Number, default: 0 },
    comments: { type: Number, default: 0 },
    shares: { type: Number, default: 0 },
    saved: { type: Number, default: 0 },
    engagementRate: { type: Number, default: 0 }, // percentage

    lastSyncedAt: { type: Date, default: Date.now },
  },
  { timestamps: true }
);

// One row per post per org+platform; re-sync updates it in place.
socialPostSchema.index({ organization: 1, platform: 1, postId: 1 }, { unique: true });
socialPostSchema.index({ organization: 1, platform: 1, publishedAt: -1 });

const SocialPost = mongoose.model('SocialPost', socialPostSchema);
export default SocialPost;
