import mongoose from 'mongoose';
import { PLATFORMS, USER_TYPES } from '../config/constants.js';

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
    submittedAt: { type: Date },
    // Set when a reviewer sends the request back instead of approving it.
    reviewNote: { type: String, default: '' },
    reviewedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    reviewedAt: { type: Date },
    completedAt: { type: Date },
    // Set when a super admin moves the work to someone else.
    reassignedFrom: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    reassignedAt: { type: Date },
    // Optional: the college request this work was created from (IN_REVIEW → APPROVED on acknowledge).
    sourceRequest: { type: mongoose.Schema.Types.ObjectId, ref: 'InstitutionRequest', default: null, index: true },
  },
  { timestamps: true }
);

workAssignmentSchema.index({ organization: 1, assignee: 1, status: 1, createdAt: -1 });

const WorkAssignment = mongoose.model('WorkAssignment', workAssignmentSchema);
export default WorkAssignment;