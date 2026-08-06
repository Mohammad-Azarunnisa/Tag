import mongoose from 'mongoose';
import { PLATFORMS, APPROVAL_STATUS } from '../config/constants.js';

// One planned post inside a plan: what goes out, where, and when.
// The same post can be planned for several channels — `platforms` is the full
// list, `platform` stays as the primary (first chosen) one so older documents
// and anything keyed on a single platform keep working.
const planItemSchema = new mongoose.Schema(
  {
    date: { type: Date, required: true },
    platform: { type: String, enum: PLATFORMS, required: true },
    platforms: { type: [{ type: String, enum: PLATFORMS }], default: undefined },
    title: { type: String, required: true, trim: true },
    notes: { type: String, default: '' },
  },
  { _id: true }
);

// A posting plan: a user lays out the posts they intend to publish over the
// coming days/weeks (e.g. "next 10 days"), submits it, and the org's Admin /
// Super Admin approves or rejects the plan as a whole before work starts.
// Reuses the approval lifecycle: PENDING → APPROVED / REJECTED → RESUBMITTED.
const postPlanSchema = new mongoose.Schema(
  {
    organization: { type: mongoose.Schema.Types.ObjectId, ref: 'Organization', required: true, index: true },
    title: { type: String, required: true, trim: true },
    description: { type: String, default: '' },
    items: { type: [planItemSchema], default: [] },
    // Derived from the items so lists can show the covered window cheaply.
    startDate: { type: Date },
    endDate: { type: Date },
    status: {
      type: String,
      enum: [APPROVAL_STATUS.PENDING, APPROVAL_STATUS.APPROVED, APPROVAL_STATUS.REJECTED, APPROVAL_STATUS.RESUBMITTED],
      default: APPROVAL_STATUS.PENDING,
    },
    feedback: { type: String, default: '' }, // reviewer's note on rejection
    reviewedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    reviewedAt: { type: Date },
    resubmitCount: { type: Number, default: 0 },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  },
  { timestamps: true }
);

postPlanSchema.index({ status: 1, createdAt: -1 });

const PostPlan = mongoose.model('PostPlan', postPlanSchema);
export default PostPlan;
