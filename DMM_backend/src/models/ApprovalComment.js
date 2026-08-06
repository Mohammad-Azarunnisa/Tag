import mongoose from 'mongoose';

// Dedicated collection for the conversation on a request (the "approvalComments"
// collection). Each row references its parent request and (optionally) the
// review round it belongs to. `kind` says what the row is:
//  - message:  a chat message from the submitter or a reviewer (may carry files)
//  - feedback: a structured rejection feedback point (text + category)
//  - event:    a durable status-change marker ("approved this request", ...)
const attachmentSchema = new mongoose.Schema(
  {
    url: { type: String, default: '' },
    publicId: { type: String, default: '' },
    mediaType: { type: String, enum: ['image', 'video', 'document'], default: 'image' },
    name: { type: String, default: '' },
  },
  { _id: false }
);

const approvalCommentSchema = new mongoose.Schema(
  {
    request: { type: mongoose.Schema.Types.ObjectId, ref: 'ApprovalRequest', required: true, index: true },
    kind: { type: String, enum: ['message', 'feedback', 'event'], default: 'message' },
    text: { type: String, default: '' },
    attachments: { type: [attachmentSchema], default: [] },
    category: { type: String, default: 'Other' }, // Image | Content | Other | Reject
    author: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    reviewRound: { type: Number, default: 1 },
  },
  { timestamps: true }
);

const ApprovalComment = mongoose.model('ApprovalComment', approvalCommentSchema);
export default ApprovalComment;
