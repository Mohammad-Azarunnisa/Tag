import mongoose from 'mongoose';

// An ask raised by a college to the people above it — budget for banners, a
// designer's time, permission to run a campaign, an account they need created.
//
// Deliberately NOT an ApprovalRequest: that models a piece of content moving
// toward publication, with media, captions and a posting lifecycle. This is a
// conversation about something the college needs, and it ends in a decision and
// a reply rather than a post.
const REQUEST_CATEGORIES = ['Budget', 'People', 'Content', 'Permission', 'Access', 'Other'];
/**
 * The headline state of the ask, as the college reads it on their Requests page.
 *
 * `WITH_SOCIAL_HANDLER` is the answer to "the design is signed off — now what?":
 * once the admins have approved it and the coordinator has confirmed it, social
 * media work is handed to the handlers who run the chosen pages, and this says so.
 * Without it the request read "Approved" for the whole of the posting half, which
 * told the college a design had passed review but not that anybody was publishing
 * it. `APPROVED` is now the end of the road — posted, or print work delivered.
 *
 * IN_REVIEW and GETTING_ALLOCATED are no longer reachable: nobody approves a
 * request any more, it goes straight to the designers. They stay in the enum so
 * requests decided under the old flow still load and render their history.
 */
const REQUEST_STATUS = ['OPEN', 'IN_REVIEW', 'GETTING_ALLOCATED', 'WITH_SOCIAL_HANDLER', 'APPROVED', 'DECLINED'];
const REQUEST_PRIORITY = ['LOW', 'NORMAL', 'HIGH', 'URGENT'];

/**
 * Where the ask has got to on its way from "we need this" to "it is out".
 *
 * The request itself is the spine of the whole pipeline — the design and the post
 * that answer it are approvals hanging off it, never copies of it — so the stage
 * lives here rather than being inferred from three other collections.
 *
 * Design half: it lands in "Designs to be Done" the moment it is raised, a
 * designer takes it, the admins sign the design off, and the coordinator who
 * asked says whether it is what they wanted.
 *
 * Post half: only social media work carries on (SOCIAL_POST_WORK_CATEGORIES /
 * _ITEMS). Print, and digital work with no page to go on — LED screens, web
 * banners, email art — are finished when the coordinator accepts the design, so
 * they end at COMPLETED.
 *
 * `postOnly` requests (see below) skip the design half entirely: the creative
 * already exists, so there is nothing for a designer to make. They land straight
 * on POST_OPEN and carry on through the same post half as everything else.
 */
const WORKFLOW_STAGES = [
  'DESIGN_OPEN',                // waiting for a designer to acknowledge
  'DESIGN_IN_PROGRESS',         // acknowledged, being worked on
  'DESIGN_ADMIN_REVIEW',        // sent for approval: Admin / Super Admin
  'DESIGN_COORDINATOR_REVIEW',  // admins approved: back to the coordinator who asked
  'POST_OPEN',                  // coordinator accepted: waiting for a social handler
  'POST_IN_PROGRESS',           // handler acknowledged, writing the content
  'POST_ADMIN_REVIEW',          // content sent for approval
  'POST_COORDINATOR_REVIEW',    // admins approved the content: back to the coordinator
  'POST_APPROVED',              // coordinator accepted: ready to publish
  'POSTED',                     // published or scheduled, and marked so
  'COMPLETED',                  // print work: accepted by the coordinator, nothing to post
  'CANCELLED',                  // the ask was declined or withdrawn
];

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
    // Content that is already designed and only needs to be posted — a college
    // asking for its own ready-made creative to go out, not for one to be made.
    // Set at creation and never changed afterwards: it decides whether the
    // request starts on "Designs to be Done" or straight on "To Be Posted".
    postOnly: { type: Boolean, default: false, index: true },
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

    // ---- Workflow: the design/post pipeline this ask travels through.
    workflowStage: { type: String, enum: WORKFLOW_STAGES, default: 'DESIGN_OPEN', index: true },
    // Whoever acknowledged each half. Held on the request itself, which is what
    // makes taking it exclusive: one field, claimed by one conditional update, so
    // a second designer racing for the same work loses rather than both getting it.
    designer: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null, index: true },
    designerAcknowledgedAt: { type: Date },
    handler: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null, index: true },
    handlerAcknowledgedAt: { type: Date },

    /**
     * When each step actually happened, kept on the request because the request is
     * the spine — one row answers "how long did this take, and who was holding it
     * when?" without joining two approvals and their comment threads.
     *
     * `*SubmittedAt` is the LATEST hand-in, so after a changes round it reads as
     * when the work was finished rather than when it was first attempted; the round
     * count and every earlier round live on the approval. `*ApprovedAt` is the
     * admins' sign-off, which is distinct from the coordinator's acceptance
     * (`design/postAcceptedAt`) — two different gates, and the gap between them is
     * how long the college sat on it.
     */
    designSubmittedAt: { type: Date },
    designApprovedAt: { type: Date },
    designApprovedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    postSubmittedAt: { type: Date },
    postApprovedAt: { type: Date },
    postApprovedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    // The two approvals that answer this ask: the artwork, then the post written
    // around it. Both are ordinary ApprovalRequests — the media, the feedback
    // rounds and the resubmissions all live there, already built.
    designApproval: { type: mongoose.Schema.Types.ObjectId, ref: 'ApprovalRequest', default: null, index: true },
    postApproval: { type: mongoose.Schema.Types.ObjectId, ref: 'ApprovalRequest', default: null, index: true },
    // When the coordinator accepted each half, so the trail shows who released it.
    designAcceptedAt: { type: Date },
    designAcceptedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    postAcceptedAt: { type: Date },
    postAcceptedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    // Where the college wants it published, chosen by the coordinator at the moment
    // they accept the design. Stored as channel names rather than ids: the colleges'
    // social accounts are one row per channel with no page name on them, so the
    // channel IS the page, and the handler picking the work up needs to read it
    // without another lookup.
    postPlatforms: { type: [String], default: [] },
    // Publication. `scheduledFor` is set when the handler booked it for later
    // rather than putting it out there and then.
    postedAt: { type: Date },
    scheduledFor: { type: Date },
  },
  { timestamps: true }
);

institutionRequestSchema.index({ organization: 1, status: 1, createdAt: -1 });
// The two workflow boards read by stage, newest first.
institutionRequestSchema.index({ workflowStage: 1, createdAt: -1 });

export const INSTITUTION_REQUEST_CATEGORIES = REQUEST_CATEGORIES;
export const INSTITUTION_REQUEST_STATUS = REQUEST_STATUS;
export const INSTITUTION_REQUEST_PRIORITY = REQUEST_PRIORITY;
export const WORKFLOW_STAGE = WORKFLOW_STAGES.reduce((acc, s) => ({ ...acc, [s]: s }), {});
export const WORKFLOW_STAGES_LIST = WORKFLOW_STAGES;
// Which board a stage belongs to. "Designs to be Done" runs to the coordinator's
// acceptance; "To Be Posted" picks it up from there.
export const DESIGN_STAGES = ['DESIGN_OPEN', 'DESIGN_IN_PROGRESS', 'DESIGN_ADMIN_REVIEW', 'DESIGN_COORDINATOR_REVIEW'];
export const POST_STAGES = ['POST_OPEN', 'POST_IN_PROGRESS', 'POST_ADMIN_REVIEW', 'POST_COORDINATOR_REVIEW', 'POST_APPROVED'];

const InstitutionRequest = mongoose.model('InstitutionRequest', institutionRequestSchema);
export default InstitutionRequest;
