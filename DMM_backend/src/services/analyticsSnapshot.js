import Analytics from '../models/Analytics.js';

export function startOfUtcDay(date = new Date()) {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

export function endOfUtcDay(date = new Date()) {
  return new Date(startOfUtcDay(date).getTime() + 86400000);
}

// Upsert a single daily snapshot. Existing values for the same day are merged
// into the same row so repeated refreshes update the day's record instead of
// creating duplicates. Uses an atomic findOneAndUpdate (not a
// read-then-conditionally-insert) so two callers racing for the same
// organization/platform/day — the nightly cron, a manual sync, a standalone
// script — can never both insert and double that day's numbers.
export async function upsertDailySnapshot(orgId, platform, metrics, date = new Date()) {
  const day = startOfUtcDay(date);
  const set = {};
  for (const [field, raw] of Object.entries(metrics || {})) {
    const val = Number(raw);
    if (Number.isFinite(val) && val >= 0) set[field] = val;
  }
  return Analytics.findOneAndUpdate(
    { organization: orgId, platform, date: day },
    { $set: set, $setOnInsert: { organization: orgId, platform, date: day } },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  );
}
