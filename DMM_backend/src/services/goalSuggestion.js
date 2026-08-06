import Analytics from '../models/Analytics.js';
import ApprovalRequest from '../models/ApprovalRequest.js';
import { audienceField } from '../controllers/goalController.js';
import { APPROVAL_STATUS } from '../config/constants.js';

// How far back to look for a growth trend. Long enough to smooth out a good or
// bad week, short enough that a rebrand two years ago doesn't set the target.
const LOOKBACK_DAYS = 180;
// The recent window used to spot acceleration against the longer average.
const RECENT_DAYS = 30;
const DAY_MS = 24 * 60 * 60 * 1000;

// A goal has to be reachable to be worth anything, so a suggestion is only ever
// allowed to land within this band of the measured trend. The AI proposes inside
// it; anything outside is clamped (see reconcile below). Without this, one
// hallucinated number would go straight into the form as a year's target.
const MIN_FACTOR = 0.5;
const MAX_FACTOR = 2.5;

// With no history at all there is no trend to project, so fall back to a modest
// percentage of the current audience per month. Deliberately conservative — it
// is a starting point for a human, not a forecast.
const COLD_START_MONTHLY_PCT = 0.03;

const round = (n, step) => Math.max(0, Math.round(n / step) * step);

// Targets read as goals, not as calculations: round to something a person would
// actually write down, scaled to the size of the number.
//
// Only ever applied to the GAIN. The total is then derived as current + gain, so
// the two figures always agree - rounding both independently produced
// "+1,800 followers -> 14,000 total" when the current count was 12,400.
const humanRound = (n) => {
  if (n >= 100000) return round(n, 1000);
  if (n >= 10000) return round(n, 500);
  if (n >= 1000) return round(n, 100);
  if (n >= 100) return round(n, 50);
  return round(n, 10);
};

/**
 * What the numbers actually say about this organization's growth on one
 * platform. Pure arithmetic over the stored snapshots — no AI involved, so the
 * figures a suggestion rests on are always real and always reproducible.
 */
export const readHistory = async (organizationId, platform) => {
  const field = audienceField(platform);
  const since = new Date(Date.now() - LOOKBACK_DAYS * DAY_MS);

  // Content-only days store a 0 audience and would drag the trend to nonsense.
  const snaps = await Analytics.find({
    organization: organizationId,
    platform,
    [field]: { $gt: 0 },
    date: { $gte: since },
  }).select(`date ${field} postsPublished engagementRate`).sort({ date: 1 }).lean();

  const latest = await Analytics.findOne({
    organization: organizationId, platform, [field]: { $gt: 0 },
  }).sort({ date: -1 }).select(`date ${field} engagementRate`).lean();

  const currentAudience = latest?.[field] || 0;

  // One reading (or none) cannot describe a rate of change.
  if (snaps.length < 2) {
    return {
      platform,
      audienceField: field,
      currentAudience,
      snapshotCount: snaps.length,
      hasTrend: false,
      engagementRate: latest?.engagementRate || 0,
      lastEntry: latest?.date || null,
    };
  }

  const first = snaps[0];
  const last = snaps[snaps.length - 1];
  const spanDays = Math.max(1, Math.round((new Date(last.date) - new Date(first.date)) / DAY_MS));
  const gained = Math.max(0, (last[field] || 0) - (first[field] || 0));
  const dailyRate = gained / spanDays;

  // The recent window, so a suggestion can follow where growth is heading rather
  // than where it has been on average.
  const recentCutoff = new Date(new Date(last.date).getTime() - RECENT_DAYS * DAY_MS);
  const recent = snaps.filter((s) => new Date(s.date) >= recentCutoff);
  let recentDailyRate = null;
  if (recent.length >= 2) {
    const rFirst = recent[0];
    const rLast = recent[recent.length - 1];
    const rDays = Math.max(1, Math.round((new Date(rLast.date) - new Date(rFirst.date)) / DAY_MS));
    recentDailyRate = Math.max(0, (rLast[field] || 0) - (rFirst[field] || 0)) / rDays;
  }

  return {
    platform,
    audienceField: field,
    currentAudience,
    snapshotCount: snaps.length,
    hasTrend: true,
    sampleFrom: new Date(first.date).toISOString().slice(0, 10),
    sampleTo: new Date(last.date).toISOString().slice(0, 10),
    sampleDays: spanDays,
    gainedInSample: gained,
    dailyRate,
    monthlyRate: dailyRate * 30,
    recentDailyRate,
    recentMonthlyRate: recentDailyRate === null ? null : recentDailyRate * 30,
    // Positive means growth has picked up recently.
    trendDirection: recentDailyRate === null ? 'unknown'
      : recentDailyRate > dailyRate * 1.15 ? 'accelerating'
        : recentDailyRate < dailyRate * 0.85 ? 'slowing'
          : 'steady',
    engagementRate: latest?.engagementRate || 0,
    lastEntry: latest?.date || null,
  };
};

/** How often this org actually publishes on this platform, per 30 days. */
export const readPostingRate = async (organizationId, platform) => {
  const since = new Date(Date.now() - LOOKBACK_DAYS * DAY_MS);
  const posted = await ApprovalRequest.countDocuments({
    organization: organizationId,
    platform,
    status: APPROVAL_STATUS.POSTED,
    postedAt: { $gte: since },
  });
  return { postedInLookback: posted, perMonth: posted / (LOOKBACK_DAYS / 30) };
};

/**
 * Project the measured trend across the requested period. This is the number the
 * AI has to justify itself against, and the number used verbatim if the AI is
 * unavailable — so a suggestion always exists, key or no key.
 *
 * Weighted toward the recent rate where there is one, because the last month
 * describes what this team is doing now better than a six-month average does.
 */
export const projectBaseline = (history, periodDays) => {
  if (!history.hasTrend) {
    const monthly = history.currentAudience * COLD_START_MONTHLY_PCT;
    const gain = Math.round(monthly * (periodDays / 30));
    const rounded = humanRound(gain);
    return {
      method: 'cold-start',
      dailyRate: history.currentAudience ? monthly / 30 : 0,
      projectedGain: gain,
      suggestedGain: rounded,
      suggestedTarget: history.currentAudience + rounded,
      confidence: history.currentAudience ? 'low' : 'none',
    };
  }
  // 60/40 in favour of the recent window when it exists.
  const blended = history.recentDailyRate === null
    ? history.dailyRate
    : history.recentDailyRate * 0.6 + history.dailyRate * 0.4;
  const gain = Math.round(blended * periodDays);
  const rounded = humanRound(gain);
  return {
    method: history.recentDailyRate === null ? 'trend' : 'trend-weighted-recent',
    dailyRate: blended,
    projectedGain: gain,
    suggestedGain: rounded,
    suggestedTarget: history.currentAudience + rounded,
    // A trend measured over a few days is not a trend.
    confidence: history.sampleDays >= 60 && history.snapshotCount >= 8 ? 'high'
      : history.sampleDays >= 21 ? 'medium'
        : 'low',
  };
};

/**
 * Take what the AI proposed and make it safe to put in a form: the gain has to
 * be positive and inside the band around the measured projection. Returns the
 * final numbers plus whether the AI's figure was used or overridden, so the UI
 * can be honest about which it is showing.
 */
export const reconcile = ({ history, baseline, aiGain }) => {
  const projected = baseline.projectedGain;
  const floor = Math.floor(projected * MIN_FACTOR);
  const ceiling = Math.ceil(projected * MAX_FACTOR);

  const proposed = Number(aiGain);
  if (!Number.isFinite(proposed) || proposed <= 0) {
    return { gain: baseline.suggestedGain, target: baseline.suggestedTarget, source: 'projection', clamped: false };
  }
  // With no measurable trend there is nothing to clamp against, so the AI's
  // read of a cold start is as good as the percentage fallback.
  if (!history.hasTrend) {
    const gain = humanRound(proposed);
    return { gain, target: history.currentAudience + gain, source: 'ai', clamped: false };
  }
  const bounded = Math.min(Math.max(proposed, floor), ceiling);
  const gain = humanRound(bounded);
  return {
    gain,
    target: history.currentAudience + gain,
    source: 'ai',
    clamped: bounded !== proposed,
    band: { floor: humanRound(floor), ceiling: humanRound(ceiling) },
  };
};
