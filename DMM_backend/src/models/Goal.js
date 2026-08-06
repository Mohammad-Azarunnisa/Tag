import mongoose from 'mongoose';
import { PLATFORMS } from '../config/constants.js';

// A growth goal for one organization on one platform over a chosen period
// (e.g. "grow NCET's LinkedIn to 10,000 followers in 3 months"). One active
// goal per org+platform — saving it again replaces the previous target.
// Progress is computed from analytics snapshots (followers/subscribers) and
// posted approvals within the period.
const goalSchema = new mongoose.Schema(
  {
    organization: { type: mongoose.Schema.Types.ObjectId, ref: 'Organization', required: true, index: true },
    platform: { type: String, enum: PLATFORMS, required: true },
    targetFollowers: { type: Number, default: 0 },
    targetPosts: { type: Number, default: 0 },
    startDate: { type: Date, required: true },
    endDate: { type: Date, required: true },
    note: { type: String, default: '' },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true }
);

goalSchema.index({ organization: 1, platform: 1 }, { unique: true });

const Goal = mongoose.model('Goal', goalSchema);
export default Goal;
