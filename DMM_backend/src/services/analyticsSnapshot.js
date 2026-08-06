import Analytics from '../models/Analytics.js';

export function startOfUtcDay(date = new Date()) {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

export function endOfUtcDay(date = new Date()) {
  return new Date(startOfUtcDay(date).getTime() + 86400000);
}

// Upsert a single daily snapshot. Existing values for the same day are merged
// into the same row so repeated refreshes update the day's record instead of
// creating duplicates.
export async function upsertDailySnapshot(orgId, platform, metrics, date = new Date()) {
  const day = startOfUtcDay(date);
  const dayEnd = endOfUtcDay(date);
  let snap = await Analytics.findOne({ organization: orgId, platform, date: { $gte: day, $lt: dayEnd } });
  if (!snap) snap = new Analytics({ organization: orgId, platform, date: day });

  for (const [field, raw] of Object.entries(metrics || {})) {
    const val = Number(raw);
    if (Number.isFinite(val) && val >= 0) snap[field] = val;
  }

  await snap.save();
  return snap;
}
