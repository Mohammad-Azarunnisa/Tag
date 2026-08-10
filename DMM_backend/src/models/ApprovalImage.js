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
    /**
     * Which round of the work this file belongs to: 0 for the first submission, 1
     * after the first set of changes, and so on — the parent's `resubmitCount` at
     * the moment it was uploaded.
     *
     * Every round APPENDS its files rather than replacing them, because a reviewer
     * asking "what did you change?" needs the previous version to compare against
     * and deleting it would lose the trail. Without this field the gallery was one
     * undivided pile, so a rejected design and its replacement sat side by side
     * with nothing to tell them apart. Readers show the highest revision present as
     * the current work and keep the rest behind it, clearly marked.
     *
     * Rows written before this existed default to 0, which puts them all in one
     * round — the same undivided view as before, never a wrong label.
     */
    revision: { type: Number, default: 0 },
  },
  { timestamps: true }
);

// The gallery reads newest round first, then gallery order within the round.
approvalImageSchema.index({ request: 1, revision: -1, order: 1 });

const ApprovalImage = mongoose.model('ApprovalImage', approvalImageSchema);
export default ApprovalImage;
