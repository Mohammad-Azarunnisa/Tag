import mongoose from 'mongoose';

const CATEGORY_VALUES = ['FRAME', 'BANNER_BOARD', 'EQUIPMENT'];

const brandingRegisterItemSchema = new mongoose.Schema(
  {
    category: { type: String, enum: CATEGORY_VALUES, required: true, index: true },
    title: { type: String, required: true, trim: true },
    size: { type: String, default: '', trim: true },
    quantity: { type: Number, default: 1, min: 0 },
    location: { type: String, default: '', trim: true },
    signageLocation: { type: mongoose.Schema.Types.ObjectId, ref: 'SignageLocation', index: true },
    organizationName: { type: String, default: '', trim: true },
    serialCodes: { type: String, default: '', trim: true },
    assignedTo: { type: String, default: '', trim: true },
    deviceType: { type: String, default: '', trim: true },
    specs: { type: String, default: '', trim: true },
    renewalDate: { type: Date },
    annualCost: { type: Number, default: 0, min: 0 },
    notes: { type: String, default: '', trim: true },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true }
);

brandingRegisterItemSchema.index({ category: 1, title: 1, location: 1 });

const BrandingRegisterItem = mongoose.model('BrandingRegisterItem', brandingRegisterItemSchema);

export { CATEGORY_VALUES };
export default BrandingRegisterItem;
