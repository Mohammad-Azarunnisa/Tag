import mongoose from 'mongoose';
import { PLATFORMS, APPROVAL_STATUS, APPROVAL_TYPES } from '../config/constants.js';

// Images live in the `approvalImages` collection (models/ApprovalImage.js) and
// feedback points live in the `approvalComments` collection
// (models/ApprovalComment.js). Both reference this request by id. The controller
// attaches them to the response as `images` and `comments` arrays.

// A single feedback point: what to change (category) + the note itself.
const feedbackPointSchema = new mongoose.Schema(
  {
    text: { type: String, required: true },
    category: { type: String, default: 'Other' }, // Image | Content | Other | Reject
  },
  { _id: false }
);

// One review round groups the feedback points the reviewer submitted on a rejection.
const reviewSchema = new mongoose.Schema(
  {
    reviewedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    feedbackPoints: [feedbackPointSchema],
    reviewedAt: { type: Date, default: Date.now },
  },
  { _id: true }
);

const forwardTargetSchema = new mongoose.Schema(
  {
    organization: { type: mongoose.Schema.Types.ObjectId, ref: 'Organization', required: true },
    platform: { type: String, enum: PLATFORMS, required: true },
    handlers: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
  },
  { _id: false }
);

const approvalRequestSchema = new mongoose.Schema(
  {
    // Every request belongs to a college — required by createApproval for
    // everyone, designers included. Kept optional at the schema level only so
    // documents written before that rule still load.
    organization: { type: mongoose.Schema.Types.ObjectId, ref: 'Organization', index: true },
    title: { type: String, required: true, trim: true },
    // POST = ready-to-publish content; DESIGN = creative work that, once
    // approved, is assigned to a social-media handler who raises the linked
    // POST request. Legacy documents without the field are treated as POST.
    type: { type: String, enum: Object.values(APPROVAL_TYPES), default: APPROVAL_TYPES.POST, index: true },
    // The SAME content can go out on several channels. `platforms` is the full
    // list the submitter chose; `platform` stays as the primary (first chosen)
    // one, because analytics, goals and reports are keyed on a single platform
    // per request. Legacy documents have only `platform` — read helpers treat
    // that as a one-item list.
    // Optional: a DESIGN brief and a designer's artwork submission have no
    // channel — whoever publishes the approved work picks one on their POST.
    // The controller requires it for everyone else (see createApproval).
    platform: { type: String, enum: PLATFORMS },
    platforms: { type: [{ type: String, enum: PLATFORMS }], default: undefined },
    // The copy. `caption`/`description` are what a single-channel post carries,
    // and stay the primary channel's copy when there are several — everything
    // that reads one caption (search, reports, the AI helpers) keeps working.
    caption: { type: String, default: '' },
    description: { type: String, default: '' },
    // One post going to several channels does not read the same on all of them:
    // a LinkedIn write-up is not an Instagram caption. When more than one channel
    // is chosen the submitter writes a pair per channel, and this holds them —
    // empty for a single-channel post, where the two fields above say it all.
    platformContent: {
      type: [{
        platform: { type: String, enum: PLATFORMS, required: true },
        caption: { type: String, default: '' },
        description: { type: String, default: '' },
        _id: false,
      }],
      default: undefined,
    },
    sourceRequest: { type: mongoose.Schema.Types.ObjectId, ref: 'InstitutionRequest', default: null, index: true },
    // Optional: the assigned work this submission is the output of, so the
    // reviewer knows which task they are signing off against.
    workAssignment: { type: mongoose.Schema.Types.ObjectId, ref: 'WorkAssignment', default: null, index: true },
    // One piece of work can be needed in several sizes. `aspectRatios` is the
    // full list; `aspectRatio` stays as the primary (first chosen) for anything
    // that reads a single value.
    // What was promised, and what kind of thing this is. Both exist for the
    // fortnightly report: without a due date an "on-time rate" is guesswork, and
    // without a work item there is no design-mix breakdown.
    dueDate: { type: Date, index: true },
    workCategory: { type: String, default: '' }, // Print Media | Digital Media | ...
    workItem: { type: String, default: '' },     // Poster, Reel / video edit, Brochure, ...
    aspectRatio: { type: String, default: '' }, // e.g. "1:1", "4:5", "9:16", "16:9"
    aspectRatios: { type: [String], default: undefined },
    hashtags: [{ type: String }],
    reviews: [reviewSchema],
    imageCount: { type: Number, default: 0 }, // denormalized for quick list rendering
    status: {
      type: String,
      enum: Object.values(APPROVAL_STATUS),
      default: APPROVAL_STATUS.PENDING,
    },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },

    // DESIGN brief: the coordinator picks the designer who does the work and the
    // intended delivery type (see deliveryMode below). The approver still chooses
    // the final route at approval time.
    designer: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null, index: true },
    claimedAt: { type: Date },

    // lifecycle timestamps
    submittedAt: { type: Date }, // when the designer submitted finished work
    approvedAt: { type: Date },
    approvedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    rejectedAt: { type: Date },
    resubmittedAt: { type: Date },
    // Delivery of an approved design back to the coordinator (non-post route).
    deliveredAt: { type: Date },
    deliveredBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },

    // DESIGN pipeline: who the approved design was handed to for publishing…
    assignedTo: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null, index: true },
    assignedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    assignedAt: { type: Date },
    // …and the POST request the handler raised from it (back-linked both ways).
    linkedPost: { type: mongoose.Schema.Types.ObjectId, ref: 'ApprovalRequest', default: null },
    sourceDesign: { type: mongoose.Schema.Types.ObjectId, ref: 'ApprovalRequest', default: null },
    // How an approved design is delivered:
    //   DIGITAL → allocated to a social handler who posts it to channels
    //   PRINT   → delivered back to the coordinator to print / keep a copy
    // Set by the coordinator on the brief (a hint) and finalized by the approver.
    deliveryMode: { type: String, enum: ['DIGITAL', 'PRINT'], default: 'DIGITAL' },
    forwardedTargets: [forwardTargetSchema],
    forwardedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    forwardedAt: { type: Date },
    // Flattened fast-lookup list for assignee checks in query filters.
    forwardedHandlers: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User', index: true }],

    // Scheduling: once approved, the publisher says WHEN it goes out. A job
    // flips the request to POSTED when that moment arrives (see
    // services/scheduledPosts.js), so postedAt is filled either by that job or
    // by someone marking it posted by hand.
    scheduledAt: { type: Date, index: true },
    scheduledBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    // Set by the job so a post is never auto-published twice.
    autoPostedAt: { type: Date },

    // post completion
    postedAt: { type: Date },
    postedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },

    resubmitCount: { type: Number, default: 0 },
    // Set when an admin routes an approved request to the designer pool.
    openForDesigners: { type: Boolean, default: false, index: true },
  },
  { timestamps: true }
);

approvalRequestSchema.index({ title: 'text', caption: 'text', description: 'text' });

const ApprovalRequest = mongoose.model('ApprovalRequest', approvalRequestSchema);
export default ApprovalRequest;
