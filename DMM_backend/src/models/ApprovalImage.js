import mongoose from 'mongoose';

// Dedicated collection for approval request media (the "approvalImages" collection).
// Each item references its parent request and carries an explicit order so the
// gallery can be reordered by the user. `mediaType` tells the UI what to render:
// an <img>, a <video>, or a download tile for documents (PDF / Office / Excel /
// PSD / AI …), which have no inline preview.
const approvalImageSchema = new mongoose.Schema(
  {
    request: { type: mongoose.Schema.Types.ObjectId, ref: 'ApprovalRequest', required: true, index: true },
    url: { type: String, required: true },
    publicId: { type: String, default: '' },
    mediaType: { type: String, enum: ['image', 'video', 'document'], default: 'image' },
    // Original filename and size — what a document tile shows instead of a preview.
    name: { type: String, default: '' },
    fileSize: { type: Number, default: 0 },
    // 'reference' = brief material a coordinator attached; 'final' = the finished
    // design/media submitted for approval. Standalone POST media is 'final'.
    kind: { type: String, enum: ['reference', 'final'], default: 'final' },
    order: { type: Number, default: 0 },
  },
  { timestamps: true }
);

const ApprovalImage = mongoose.model('ApprovalImage', approvalImageSchema);
export default ApprovalImage;
