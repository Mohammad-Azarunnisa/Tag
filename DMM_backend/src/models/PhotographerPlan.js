import mongoose from 'mongoose';

// A photographer's own day-to-day note for their calendar — what they're
// planning or updating for that date, separate from the fixed slot bookings
// (which are about being occupied for a specific college/event, not a free-
// text plan). One note per photographer per day, upserted from the calendar UI.
const photographerPlanSchema = new mongoose.Schema(
  {
    photographer: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    date: { type: String, required: true },
    note: { type: String, default: '' },
  },
  { timestamps: true }
);

photographerPlanSchema.index({ photographer: 1, date: 1 }, { unique: true });

const PhotographerPlan = mongoose.model('PhotographerPlan', photographerPlanSchema);
export default PhotographerPlan;
