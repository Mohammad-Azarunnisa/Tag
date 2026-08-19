import mongoose from 'mongoose';

// A record of every daily analytics/post sync — what ran, when, and what came of
// it.
//
// Two reasons this is stored rather than logged. First, the sync is what builds
// the long-term history: if a day is missed the readings for that day are gone
// for good, because Meta and YouTube return current totals rather than a
// back-dated series. Knowing a run was missed is therefore the difference
// between noticing a gap and discovering one years later. Second, the outcome
// used to go to the console only, so a run that failed for every organization
// looked exactly like a run that never happened.
//
// `day` is the UTC date key ('YYYY-MM-DD') and is unique, which is what lets the
// server ask "has today already been done?" on boot and catch up when it has not.
const syncRunSchema = new mongoose.Schema(
  {
    day: { type: String, required: true, unique: true, index: true },
    // 'schedule'  — the 02:00 UTC timer fired
    // 'catch-up'  — the server started and found today had not run yet
    // 'manual'    — someone triggered it deliberately
    trigger: { type: String, enum: ['schedule', 'catch-up', 'manual'], default: 'schedule' },
    status: { type: String, enum: ['running', 'success', 'partial', 'failed'], default: 'running' },
    startedAt: { type: Date, default: Date.now },
    finishedAt: { type: Date },
    durationMs: { type: Number, default: 0 },
    organizationsProcessed: { type: Number, default: 0 },
    snapshotsWritten: { type: Number, default: 0 },
    postsSynced: { type: Number, default: 0 },
    // Per-organization detail, as returned by refreshDailyAnalytics().
    results: { type: mongoose.Schema.Types.Mixed, default: [] },
    // Named errorMessages, not errors: `errors` is reserved on a Mongoose
    // document (validation errors live there) and shadowing it is asking for
    // trouble later.
    errorMessages: { type: [String], default: [] },
  },
  { timestamps: true }
);

syncRunSchema.index({ startedAt: -1 });

const SyncRun = mongoose.model('SyncRun', syncRunSchema);
export default SyncRun;
