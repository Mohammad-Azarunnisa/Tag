import mongoose from 'mongoose';

// Brand Library item: flyers, brochures, branding videos and other marketing
// material, per organization. Each item is EITHER an uploaded file OR an
// external link (e.g. a YouTube branding video) so it can be shared directly.
const brandAssetSchema = new mongoose.Schema(
  {
    // Which college the item belongs to. null = shared across ALL colleges
    // (same convention as templates/assets).
    organization: { type: mongoose.Schema.Types.ObjectId, ref: 'Organization', default: null, index: true },
    title: { type: String, required: true, trim: true },
    category: { type: String, default: 'Other' }, // Flyer | Brochure | Branding Video | Image | Document | Other
    kind: { type: String, enum: ['file', 'link'], default: 'file' },
    mediaType: { type: String, default: 'image' }, // image | video | document | link
    url: { type: String, required: true }, // uploaded file URL or external link
    publicId: { type: String, default: '' }, // set for uploaded files
    description: { type: String, default: '' },
    uploadedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true }
);

brandAssetSchema.index({ organization: 1, category: 1, createdAt: -1 });

const BrandAsset = mongoose.model('BrandAsset', brandAssetSchema);
export default BrandAsset;
