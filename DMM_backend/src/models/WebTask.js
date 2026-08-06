import mongoose from 'mongoose';

// Website work for an institution. Tracked separately from design approvals on
// purpose: web work runs on a longer cycle, so folding it into the design
// turnaround averages would distort both.
export const WEB_TASK_TYPES = [
  'Content / page updates',
  'New page build',
  'Landing page (campaign)',
  'Bug fix / broken link',
  'SEO / performance',
  'Form / integration',
  'Other',
];

export const WEB_TASK_STATUS = ['OPEN', 'IN_PROGRESS', 'BLOCKED', 'COMPLETED'];

const webTaskSchema = new mongoose.Schema(
  {
    organization: { type: mongoose.Schema.Types.ObjectId, ref: 'Organization', required: true, index: true },
    title: { type: String, required: true, trim: true },
    taskType: { type: String, enum: WEB_TASK_TYPES, default: 'Content / page updates', index: true },
    details: { type: String, default: '' },
    // Which site it is on, when the inventory has it.
    website: { type: mongoose.Schema.Types.ObjectId, ref: 'Website', default: null },
    url: { type: String, default: '', trim: true },

    status: { type: String, enum: WEB_TASK_STATUS, default: 'OPEN', index: true },
    assignee: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null, index: true },
    requestedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },

    // What "delivered on time" is measured against. Without it an on-time rate is
    // guesswork, which is why the report could not report one before.
    dueDate: { type: Date, index: true },
    completedAt: { type: Date, index: true },
    notes: { type: String, default: '' },
  },
  { timestamps: true }
);

webTaskSchema.index({ organization: 1, status: 1, createdAt: -1 });

// Turnaround in days, to one decimal — the unit the report uses.
webTaskSchema.virtual('turnaroundDays').get(function () {
  if (!this.completedAt) return null;
  return Math.round(((this.completedAt - this.createdAt) / 86400000) * 10) / 10;
});

// Delivered on or before the date it was promised for. No due date means it
// cannot count against the on-time rate either way.
webTaskSchema.virtual('onTime').get(function () {
  if (!this.completedAt || !this.dueDate) return null;
  return this.completedAt <= this.dueDate;
});

webTaskSchema.set('toJSON', { virtuals: true });
webTaskSchema.set('toObject', { virtuals: true });

const WebTask = mongoose.model('WebTask', webTaskSchema);
export default WebTask;
