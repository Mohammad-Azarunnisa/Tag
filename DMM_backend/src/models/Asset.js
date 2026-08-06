import mongoose from 'mongoose';
import { ASSET_CATEGORIES } from '../config/constants.js';

const assetSchema = new mongoose.Schema(
  {
    // Which college the asset belongs to. null = shared across ALL colleges.
    organization: { type: mongoose.Schema.Types.ObjectId, ref: 'Organization', default: null, index: true },
    name: { type: String, required: true, trim: true },
    description: { type: String, default: '' },
    category: { type: String, enum: ASSET_CATEGORIES, required: true },
    previewImage: { type: String, default: '' },
    previewPublicId: { type: String, default: '' },
    fileUrl: { type: String, required: true },
    filePublicId: { type: String, default: '' },
    fileName: { type: String, default: '' },
    fileType: { type: String, default: '' },
    fileSize: { type: Number, default: 0 },
    uploadedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    downloads: { type: Number, default: 0 },
  },
  { timestamps: true }
);

assetSchema.index({ name: 'text', description: 'text' });

const Asset = mongoose.model('Asset', assetSchema);
export default Asset;
