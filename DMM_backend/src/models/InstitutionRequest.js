import mongoose from 'mongoose';

// An ask raised by a college to the people above it — budget for banners, a
// designer's time, permission to run a campaign, an account they need created.
//
// Deliberately NOT an ApprovalRequest: that models a piece of content moving
// toward publication, with media, captions and a posting lifecycle. This is a
// conversation about something the college needs, and it ends in a decision and
// a reply rather than a post.
const REQUEST_CATEGORIES = ['Budget', 'People', 'Content', 'Permission', 'Access', 'Other'];
const REQUEST_STATUS = ['OPEN', 'IN_REVIEW', 'APPROVED', 'DECLINED'];
const REQUEST_PRIORITY = ['LOW', 'NORMAL', 'HIGH', 'URGENT'];

const attachmentSchema = new mongoose.Schema(
  {
    url: { type: String, required: true },
    publicId: { type: String, default: '' },
    name: { type: String, default: '' },
    fileSize: { type: Number, default: 0 },
    mediaType: { type: String, default: 'document' },
  },
  { _id: false }
);

const institutionRequestSchema = new mongoose.Schema(
  {
    organization: { type: mongoose.Schema.Types.ObjectId, ref: 'Organization', required: true, index: true },
    title: { type: String, required: true, trim: true },
    details: { type: String, default: '' },
    workType: { type: String, enum: ['PRINT_MEDIA', 'DIGITAL_MEDIA'], default: 'PRINT_MEDIA', index: true },
    workCategory: { type: String, default: '', trim: true },
    workItem: { type: String, default: '', trim: true },
    event: { type: Boolean, default: false, index: true },
    department: { type: String, default: '', trim: true },
    eventName: { type: String, default: '', trim: true },
    eventDate: { type: Date },
    place: { type: String, default: '', trim: true },
    eventCoordinatorName: { type: String, default: '', trim: true },
    attachments: { type: [attachmentSchema], default: undefined },
    category: { type: String, enum: REQUEST_CATEGORIES, default: 'Other', index: true },
    priority: { type: String, enum: REQUEST_PRIORITY, default: 'NORMAL', index: true },
    // What the college needs by, when that matters.
    neededBy: { type: Date },
    status: { type: String, enum: REQUEST_STATUS, default: 'OPEN', index: true },
    raisedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    linkedApproval: { type: mongoose.Schema.Types.ObjectId, ref: 'ApprovalRequest', default: null, index: true },
    // The decision: who made it, when, and what they said back.
    reviewedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    reviewedAt: { type: Date },
    response: { type: String, default: '' },
  },
  { timestamps: true }
);

institutionRequestSchema.index({ organization: 1, status: 1, createdAt: -1 });

export const INSTITUTION_REQUEST_CATEGORIES = REQUEST_CATEGORIES;
export const INSTITUTION_REQUEST_STATUS = REQUEST_STATUS;
export const INSTITUTION_REQUEST_PRIORITY = REQUEST_PRIORITY;

const InstitutionRequest = mongoose.model('InstitutionRequest', institutionRequestSchema);
export default InstitutionRequest;
