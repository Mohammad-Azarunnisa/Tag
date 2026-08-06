import mongoose from 'mongoose';

const metaAdSnapshotSchema = new mongoose.Schema(
  {
    organization: { type: mongoose.Schema.Types.ObjectId, ref: 'Organization', required: true, index: true },
    adAccountId: { type: String, required: true, index: true },
    adAccountName: { type: String, default: '' },
    currency: { type: String, default: '' },
    dateStart: { type: Date, required: true, index: true },
    dateStop: { type: Date, required: true },
    spend: { type: Number, default: 0 },
    impressions: { type: Number, default: 0 },
    reach: { type: Number, default: 0 },
    clicks: { type: Number, default: 0 },
    ctr: { type: Number, default: 0 },
    cpc: { type: Number, default: 0 },
    cpm: { type: Number, default: 0 },
    raw: { type: mongoose.Schema.Types.Mixed },
    syncedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true }
);

metaAdSnapshotSchema.index({ organization: 1, adAccountId: 1, dateStart: 1 }, { unique: true });

const MetaAdSnapshot = mongoose.model('MetaAdSnapshot', metaAdSnapshotSchema);
export default MetaAdSnapshot;
