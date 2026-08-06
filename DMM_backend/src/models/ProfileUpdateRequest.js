import mongoose from 'mongoose';

// After the first profile completion, changes to a user's skills / tools /
// handled pages must be approved by an Admin. The proposed values live here
// until reviewed; on approval they replace the user's current ones.
// One PENDING request per user — a new submission replaces the previous one.
const profileUpdateRequestSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    changes: {
      skills: [{ type: String, trim: true }],
      tools: [{ type: String, trim: true }],
      handles: [
        {
          organization: { type: mongoose.Schema.Types.ObjectId, ref: 'Organization' },
          platforms: [{ type: String, trim: true }],
          _id: false,
        },
      ],
    },
    note: { type: String, default: '' }, // the user's message to the reviewer
    status: { type: String, enum: ['PENDING', 'APPROVED', 'REJECTED'], default: 'PENDING', index: true },
    reviewedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    reviewedAt: { type: Date },
    reviewNote: { type: String, default: '' }, // why it was rejected
  },
  { timestamps: true }
);

const ProfileUpdateRequest = mongoose.model('ProfileUpdateRequest', profileUpdateRequestSchema);
export default ProfileUpdateRequest;
