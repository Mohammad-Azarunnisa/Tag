import mongoose from 'mongoose';
import { TEMPLATE_CATEGORIES } from '../config/constants.js';

const templateSchema = new mongoose.Schema(
  {
    // Which college the template belongs to. null = shared across ALL colleges.
    organization: { type: mongoose.Schema.Types.ObjectId, ref: 'Organization', default: null, index: true },
    name: { type: String, required: true, trim: true },
    description: { type: String, default: '' },
    category: { type: String, enum: TEMPLATE_CATEGORIES, required: true },
    thumbnail: { type: String, default: '' },
    thumbnailPublicId: { type: String, default: '' },
    fileUrl: { type: String, required: true },
    filePublicId: { type: String, default: '' },
    fileName: { type: String, default: '' },
    fileType: { type: String, default: '' }, // PNG, PDF, PPTX...
    fileSize: { type: Number, default: 0 },
    uploadedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    downloads: { type: Number, default: 0 },
  },
  { timestamps: true }
);

templateSchema.index({ name: 'text', description: 'text' });

const Template = mongoose.model('Template', templateSchema);
export default Template;
