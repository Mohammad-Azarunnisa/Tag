import mongoose from 'mongoose';
import { ACTIVITY_ACTIONS } from '../config/constants.js';

const activityLogSchema = new mongoose.Schema(
  {
    organization: { type: mongoose.Schema.Types.ObjectId, ref: 'Organization', index: true },
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    action: { type: String, enum: Object.values(ACTIVITY_ACTIONS), required: true },
    description: { type: String, default: '' },
    entityType: { type: String, default: '' }, // Template | Asset | ApprovalRequest
    entityId: { type: mongoose.Schema.Types.ObjectId },
    meta: { type: mongoose.Schema.Types.Mixed },
  },
  { timestamps: true }
);

activityLogSchema.index({ createdAt: -1 });

const ActivityLog = mongoose.model('ActivityLog', activityLogSchema);
export default ActivityLog;
