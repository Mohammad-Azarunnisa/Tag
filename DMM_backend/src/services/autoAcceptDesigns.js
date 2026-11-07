import InstitutionRequest from '../models/InstitutionRequest.js';
import { autoAcceptDesign } from '../controllers/workflowController.js';
import { holidaySet } from '../controllers/holidayController.js';
import { addWorkingDays, istDateKey } from '../utils/turnaround.js';

// When a designer's work has been approved by the Admin it waits for the coordinator
// who asked for it to accept or send it back. If they do nothing for 2 working days
// (Monday to Saturday, holidays skipped — the same days the rest of the portal counts),
// it is accepted for them, so one silent coordinator cannot hold up the whole pipeline.
//
// Like the scheduled-post watcher this is a sweep on an interval rather than a timer
// per request: timers die with the process, a sweep picks up whatever is overdue,
// including anything that fell due while the server was down.

export const AUTO_ACCEPT_WORKING_DAYS = Number(process.env.AUTO_ACCEPT_WORKING_DAYS || 2);
const CHECK_INTERVAL_MS = Number(process.env.AUTO_ACCEPT_CHECK_MS || 15 * 60_000);
// Only designs that reached the coordinator on or after this moment are ever accepted
// automatically. Anything already waiting before the feature existed is left exactly as
// it is — the coordinator can still answer it, and nothing is accepted behind their back.
export const AUTO_ACCEPT_FROM = new Date(process.env.AUTO_ACCEPT_FROM || '2026-11-02T00:00:00+05:30');
const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;
const DAY = 86400000;

// The moment the coordinator's time runs out: the same time of day, N working days on.
export const acceptDeadline = (since, holidays, days = AUTO_ACCEPT_WORKING_DAYS) => {
  const start = new Date(since);
  const startKey = istDateKey(start);
  const timeOfDay = (start.getTime() + IST_OFFSET_MS) % DAY;
  const dueKey = addWorkingDays(startKey, days, holidays);
  return new Date(new Date(`${dueKey}T00:00:00.000Z`).getTime() - IST_OFFSET_MS + timeOfDay);
};

export const acceptOverdueDesigns = async (now = new Date()) => {
  const cutoff = new Date(now.getTime() - AUTO_ACCEPT_WORKING_DAYS * DAY);
  const candidates = await InstitutionRequest.find({
    workflowStage: 'DESIGN_COORDINATOR_REVIEW',
    // at least this many calendar days — the exact working-day deadline is checked below
    $or: [
      { designApprovedAt: { $gte: AUTO_ACCEPT_FROM, $lte: cutoff } },
      { designApprovedAt: { $in: [null, undefined] }, updatedAt: { $gte: AUTO_ACCEPT_FROM, $lte: cutoff } },
    ],
  }).limit(200);
  if (!candidates.length) return [];
  const holidays = await holidaySet();
  const accepted = [];
  for (const item of candidates) {
    try {
      const since = item.designApprovedAt || item.updatedAt;
      if (now < acceptDeadline(since, holidays)) continue;
      const done = await autoAcceptDesign(item, {
        waitedLabel: `${AUTO_ACCEPT_WORKING_DAYS} working days`,
      });
      if (done) accepted.push(String(done._id));
    } catch (err) {
      console.error(`auto-accept failed for ${item._id}:`, err.message);
    }
  }
  return accepted;
};

export const startAutoAcceptWatcher = () => {
  const tick = () => {
    acceptOverdueDesigns().then((ids) => {
      if (ids.length) console.log(`   Auto-accepted ${ids.length} design(s) with no coordinator response`);
    }).catch((err) => console.error('auto-accept sweep failed:', err.message));
  };
  tick();
  const timer = setInterval(tick, CHECK_INTERVAL_MS);
  timer.unref?.();
  return timer;
};
