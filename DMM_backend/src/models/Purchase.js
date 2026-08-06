import mongoose from 'mongoose';

// Premium packs / tools / subscriptions the marketing team has purchased, so the
// org can track what was bought, when, and when it expires. Org-scoped.
const purchaseSchema = new mongoose.Schema(
  {
    organization: { type: mongoose.Schema.Types.ObjectId, ref: 'Organization', required: true, index: true },
    name: { type: String, required: true, trim: true }, // e.g. "Envato Elements", "Canva Pro"
    vendor: { type: String, default: '' },
    category: { type: String, default: 'Other' }, // Design | Stock | Video | Font | Tool | Other
    seats: { type: Number, default: 1 }, // how many people / licenses
    cost: { type: Number, default: 0 },
    currency: { type: String, default: 'INR' },
    purchaseDate: { type: Date },
    expiryDate: { type: Date }, // when it ends
    notes: { type: String, default: '' },
  },
  { timestamps: true }
);

purchaseSchema.index({ organization: 1, expiryDate: 1 });

const Purchase = mongoose.model('Purchase', purchaseSchema);
export default Purchase;
