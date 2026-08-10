import mongoose from 'mongoose';
import { PLATFORMS, USER_TYPES } from '../config/constants.js';

// What the assignee actually produced. A completion note says what was done;
// these are the files themselves, which is what anyone downstream — the approver
// signing it off, the handler publishing it — needs to see.
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

const workAssignmentSchema = new mongoose.Schema(
  {
    organization: { type: mongoose.Schema.Types.ObjectId, ref: 'Organization', required: true, index: true },
    title: { type: String, required: true, trim: true },
    description: { type: String, default: '' },
    platform: { type: String, enum: ['', ...PLATFORMS], default: '' },
    // How soon this needs doing, so the assignee knows what to pick up first.
    urgency: { type: String, enum: ['LOW', 'NORMAL', 'HIGH', 'URGENT'], default: 'NORMAL', index: true },
    // What "delivered on time" is measured against in the team report. Optional -
    // work with no promised date simply doesn't count either way.
    dueDate: { type: Date, index: true },
    assignee: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    assigneeType: { type: String, enum: Object.values(USER_TYPES), required: true, index: true },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    // OPEN         → just assigned, the assignee hasn't picked it up yet
    // ACKNOWLEDGED → the assignee accepted it and is working on it
    // SUBMITTED    → the assignee raised a completion request for sign-off
    // DONE         → the super admin approved that request
    status: { type: String, enum: ['OPEN', 'ACKNOWLEDGED', 'SUBMITTED', 'DONE'], default: 'OPEN', index: true },
    acknowledgedAt: { type: Date },
    // The assignee's note on the completion request, so the reviewer can see
    // what was done and which assignment it belongs to.
    completionNote: { type: String, default: '' },
    // The finished files. Without these a handler downstream has a description
    // of the work but nothing to actually publish.
    completionAttachments: { type: [attachmentSchema], default: undefined },
    submittedAt: { type: Date },
    // Set when a reviewer sends the request back instead of approving it.
    reviewNote: { type: String, default: '' },
    reviewedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    reviewedAt: { type: Date },
    completedAt: { type: Date },
    // When one shared designer assignment is acknowledged, sibling copies stay
    // visible but cannot be acknowledged by anyone else.
    allocationGroup: { type: mongoose.Schema.Types.ObjectId, index: true, default: null },
    acknowledgeLockedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    acknowledgeLockedAt: { type: Date },
    // Set when a super admin moves the work to someone else.
    reassignedFrom: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    reassignedAt: { type: Date },
    // Optional: the college request this work was created from (IN_REVIEW → APPROVED on acknowledge).
    sourceRequest: { type: mongoose.Schema.Types.ObjectId, ref: 'InstitutionRequest', default: null, index: true },
    // Once the work is signed off it goes one of two ways: to a social handler to
    // publish it, or back to the coordinator who asked for it. Recorded on the
    // finished assignment so the trail from "asked for" to "delivered" is one
    // chain rather than two unrelated rows.
    handoff: { type: String, enum: ['', 'SOCIAL_HANDLER', 'COORDINATOR'], default: '', index: true },
    handoffAt: { type: Date },
    handoffBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    handoffNote: { type: String, default: '' },
    // The posting assignments raised when it went to handlers.
    handoffAssignments: [{ type: mongoose.Schema.Types.ObjectId, ref: 'WorkAssignment' }],
    // The coordinator the finished work was handed back to.
    deliveredTo: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    // Set on the assignment raised for a handler to PUBLISH finished work, and
    // points back at the work being published. Publishing is not a new brief, so
    // it is shown as "awaiting posting" rather than plain open — same OPEN state
    // underneath, since the handler still just does it and completes it.
    postingFor: { type: mongoose.Schema.Types.ObjectId, ref: 'WorkAssignment', default: null, index: true },
    // The approved design this posting job publishes. A designer submits finished
    // work as an approval, so when that approval is routed to handlers this is
    // what they actually have to put out — and where the artwork lives.
    sourceApproval: { type: mongoose.Schema.Types.ObjectId, ref: 'ApprovalRequest', default: null, index: true },
    // A posting job can be closed now ("it is out") or booked for when it goes
    // out. The sweep that publishes due content closes these too, so nobody has
    // to come back at the appointed minute and click.
    scheduledAt: { type: Date, index: true },
  },
  { timestamps: true }
);

workAssignmentSchema.index({ organization: 1, assignee: 1, status: 1, createdAt: -1 });

const WorkAssignment = mongoose.model('WorkAssignment', workAssignmentSchema);
export default WorkAssignment;