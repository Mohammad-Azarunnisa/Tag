import mongoose from 'mongoose';

// One demographic row from a LinkedIn Followers/Visitors export (e.g. Location
// "Bengaluru" → 4,120 followers). Each import REPLACES the rows for that
// organization + audience + category, so the app always mirrors the latest
// export — exactly what the LinkedIn analytics page shows.
const audienceDemographicSchema = new mongoose.Schema(
  {
    organization: { type: mongoose.Schema.Types.ObjectId, ref: 'Organization', required: true, index: true },
    platform: { type: String, default: 'LinkedIn' },
    audience: { type: String, enum: ['followers', 'visitors'], required: true },
    category: { type: String, required: true }, // Location | Job function | Seniority | Industry | Company size
    label: { type: String, required: true },
    value: { type: Number, default: 0 }, // follower count, or views/percentage for visitors
    isPercent: { type: Boolean, default: false },
  },
  { timestamps: true }
);

audienceDemographicSchema.index({ organization: 1, audience: 1, category: 1, value: -1 });

const AudienceDemographic = mongoose.model('AudienceDemographic', audienceDemographicSchema);
export default AudienceDemographic;
