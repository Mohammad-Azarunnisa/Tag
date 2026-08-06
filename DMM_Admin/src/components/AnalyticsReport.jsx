import { useState } from 'react';
import {
  ResponsiveContainer, AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, LabelList,
} from 'recharts';
import { ArrowUp, ArrowDown, Minus, TrendingUp, Zap } from 'lucide-react';
import { Card, Skeleton, EmptyState, InfoTip } from './ui/primitives.jsx';
import { cn, formatNumber } from '../lib/utils.js';

// `interactions` sits high (right after the audience total) because on some
// platforms — Facebook via Meta especially — it's the main engagement signal we
// actually receive, while reach/views are Instagram-only and stay 0 for Facebook.
const HIGHLIGHT_PRIORITY = ['followers', 'interactions', 'visits', 'subscribers', 'impressions', 'engagementRate', 'newFollowers', 'reach', 'views', 'videoCount', 'pageViews'];
const fmt = (v, isPct) => (isPct ? `${Number(v || 0).toFixed(2)}%` : formatNumber(v || 0));
const fmtDate = (d) => new Date(d).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });

// Platform-aware guidance for the empty state — each platform has a different
// fastest path to its first data point.
const EMPTY_HINTS = {
  Instagram: 'Use the "Sync from Meta" button for a one-click pull, or import an Excel export / enter metrics manually.',
  Facebook: 'Use the "Sync from Meta" button for a one-click pull, or import an Excel export / enter metrics manually.',
  YouTube: 'Use the "Sync from YouTube" button for a one-click pull, or import an Excel export / enter metrics manually.',
  LinkedIn: 'Import your LinkedIn export or enter metrics to see the report and week-over-week changes.',
};

export function DeltaBadge({ delta, isPct, size = 'sm' }) {
  if (!delta) return null;
  const { change, changePct, previous } = delta;
  const isNew = (!previous || previous === 0) && delta.current > 0;
  const up = change > 0, down = change < 0;
  const Icon = up ? ArrowUp : down ? ArrowDown : Minus;
  const cls = up ? 'text-emerald-600 bg-emerald-50 dark:bg-emerald-500/10'
    : down ? 'text-rose-600 bg-rose-50 dark:bg-rose-500/10'
    : 'text-slate-400 bg-slate-100 dark:bg-slate-800';
  const changeText = isPct ? `${change > 0 ? '+' : ''}${change.toFixed(1)} pts` : `${change > 0 ? '+' : ''}${formatNumber(change)}`;
  return (
    <span className={cn('inline-flex items-center gap-1 rounded-full font-semibold', cls, size === 'sm' ? 'px-1.5 py-0.5 text-[11px]' : 'px-2 py-1 text-xs')}>
      <Icon className="h-3 w-3" />
      {isNew ? 'New' : changeText}
      {!isNew && changePct != null && <span className="opacity-70">({changePct > 0 ? '+' : ''}{changePct}%)</span>}
    </span>
  );
}

// `report` is the payload from /api/analytics/:platform/report
export default function AnalyticsReport({ report, isLoading }) {
  const [metric, setMetric] = useState(null);
  const [view, setView] = useState('weekly');

  if (isLoading) {
    return (
      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">{Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-28" />)}</div>
        <Skeleton className="h-72" />
      </div>
    );
  }
  if (!report?.hasData) {
    return (
      <EmptyState icon={TrendingUp} title="No data yet"
        description={EMPTY_HINTS[report?.platform] || "Enter this platform's metrics to see the analytics report and week-over-week changes."} />
    );
  }

  const { latest, previous, deltas, groups, labels, percentFields, series } = report;
  const pct = new Set(percentFields || []);
  const fields = Object.values(groups || {}).flat();

  // New payload keys — read defensively so older cached payloads still render.
  const help = report.help || {};
  // Stock fields (audience totals, cumulative counts, Facebook's rolling
  // interactions) carry the end-of-period value in weekly view, not a sum.
  const stock = new Set(report.stockFields || []);
  const sync = report.sync || { provider: null, fields: [] };
  const syncSet = new Set(sync.fields || []);
  const isSynced = (f) => !!(sync.provider && syncSet.has(f));
  // Tooltip text: the plain-language definition plus how the field gets filled,
  // so e.g. Facebook's Reach/Views explain that Meta's API doesn't provide them.
  const tipFor = (f) => {
    const suffix = !sync.provider ? ''
      : syncSet.has(f) ? ` Auto-synced from ${sync.provider}.`
      : ` Not filled by ${sync.provider} auto-sync — add it via the weekly Excel import or Enter metrics.`;
    return `${help[f] || ''}${suffix}`.trim();
  };

  // Period (merged range totals, matching LinkedIn) vs daily.
  const weekly = report.weekly;
  const canWeekly = !!(weekly && weekly.series && weekly.series.length);
  const useWeekly = view === 'weekly' && canWeekly;
  const rangeDays = weekly?.rangeDays || 7;
  const periodLabel = `Past ${rangeDays} days`;
  const current = (useWeekly ? weekly?.current : latest) || {};
  const cmpDeltas = (useWeekly ? weekly?.deltas : deltas) || {};
  // The backend compares vs the closest snapshot at least a week older, but
  // falls back to the immediately previous entry on young datasets — only
  // claim "a week earlier" when the gap really is one.
  const prevGapDays = latest && previous ? Math.round((new Date(latest.date) - new Date(previous.date)) / 86400000) : 0;
  const weekApart = prevGapDays >= 7;
  const deltaTitle = useWeekly ? `vs previous ${rangeDays} days` : (weekApart ? 'vs a week earlier' : 'vs the previous entry');
  const wkLabel = (s) => `${fmtDate(s.from)} – ${fmtDate(s.to)}`;
  const chartData = ((useWeekly ? weekly?.series : series) || []).map((s) => ({ ...s, x: useWeekly ? wkLabel(s) : fmtDate(s.date) }));

  // Headline picker: priority fields that actually have data (this period or
  // the one before) rank ahead of the all-zero ones — priority order kept
  // within each bucket — so Facebook leads with Followers / Interactions
  // instead of Reach 0 / Views 0.
  const hasSignal = (f) => (Number(current?.[f]) || 0) > 0 || (Number(cmpDeltas?.[f]?.previous) || 0) > 0;
  const candidates = HIGHLIGHT_PRIORITY.filter((f) => fields.includes(f));
  const highlights = [...candidates.filter(hasSignal), ...candidates.filter((f) => !hasSignal(f))].slice(0, 4);

  // One metric drives the main trend chart — the headline cards and the
  // grouped chips below both select into it.
  const selected = metric && fields.includes(metric) ? metric : (highlights[0] || fields[0]);
  const selPct = pct.has(selected);
  const selectMetric = (f) => setMetric(f);

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        {useWeekly ? (
          weekly.currentRange && (
            <p className="text-xs text-slate-400">
              This period ({fmtDate(weekly.currentRange.from)} – {fmtDate(weekly.currentRange.to)}, {weekly.currentRange.days} days){' '}
              {weekly.hasPrevious
                ? <>vs the previous {rangeDays} days ({fmtDate(weekly.previousRange.from)} – {fmtDate(weekly.previousRange.to)})</>
                : <span>— no previous period to compare yet</span>}
            </p>
          )
        ) : (
          previous && (
            <p className="text-xs text-slate-400">Comparing {fmtDate(latest.date)} with {weekApart ? 'a week earlier' : 'the previous entry'} ({fmtDate(previous.date)})</p>
          )
        )}
        {canWeekly && (
          <div className="inline-flex rounded-lg bg-slate-100 dark:bg-slate-800 p-1 text-xs font-semibold">
            <button onClick={() => setView('weekly')} className={cn('rounded-md px-3 py-1', useWeekly ? 'bg-white dark:bg-slate-900 text-brand-700 dark:text-brand-300 shadow-soft' : 'text-slate-500')}>{periodLabel}</button>
            <button onClick={() => setView('daily')} className={cn('rounded-md px-3 py-1', !useWeekly ? 'bg-white dark:bg-slate-900 text-brand-700 dark:text-brand-300 shadow-soft' : 'text-slate-500')}>Daily</button>
          </div>
        )}
      </div>

      {/* Highlight cards — click (or Enter/Space) to chart that metric below */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        {highlights.map((f) => (
          <Card key={f} role="button" tabIndex={0} aria-pressed={selected === f}
            onClick={() => selectMetric(f)}
            onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); selectMetric(f); } }}
            className={cn('cursor-pointer p-5 outline-none transition hover:shadow-glow focus-visible:ring-2 focus-visible:ring-brand-500/60',
              selected === f && 'ring-2 ring-brand-500/40')}>
            <div className="flex items-start justify-between gap-2">
              <p className="flex items-center gap-1.5 text-sm font-medium text-slate-400">
                {labels?.[f] || f}{useWeekly && !pct.has(f) && !stock.has(f) ? ` (${rangeDays}d)` : ''}
                <InfoTip text={tipFor(f)} />
              </p>
              {isSynced(f) && (
                <span title={`Auto-synced from ${sync.provider}`}
                  className="rounded-full bg-emerald-50 p-1 text-emerald-500 dark:bg-emerald-500/10 dark:text-emerald-400">
                  <Zap className="h-3 w-3" />
                </span>
              )}
            </div>
            <p className="mt-2 text-3xl font-extrabold tracking-tight text-slate-800 dark:text-white">{fmt(current?.[f], pct.has(f))}</p>
            <div className="mt-2"><span title={deltaTitle}><DeltaBadge delta={cmpDeltas?.[f]} isPct={pct.has(f)} /></span></div>
            {/* Mini sparkline — only when there's an actual trend to show */}
            {chartData.length >= 2 && (
              <div className="-mx-1 mt-2">
                <ResponsiveContainer width="100%" height={40}>
                  <AreaChart data={chartData} margin={{ top: 2, right: 0, bottom: 0, left: 0 }}>
                    <defs>
                      <linearGradient id={`spark-${f}`} x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#f97316" stopOpacity={0.25} />
                        <stop offset="95%" stopColor="#f97316" stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <Area type="monotone" dataKey={f} stroke="#f97316" strokeWidth={2} fill={`url(#spark-${f})`} isAnimationActive={false} />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            )}
          </Card>
        ))}
      </div>

      {/* Main trend chart — one selected metric, pickable from any group */}
      <Card className="p-5">
        <h3 className="mb-1 font-bold text-slate-800 dark:text-white">{useWeekly ? 'Per period' : 'Daily'} {labels?.[selected] || selected}</h3>
        <p className="mb-4 text-xs text-slate-400">{useWeekly ? `Each point is one ${rangeDays}-day period` : 'Across recent entries'} — click a card above or pick any metric below.</p>
        <div className="mb-4 space-y-1.5">
          {Object.entries(groups || {}).map(([group, groupFields]) => (
            <div key={group} className="flex flex-wrap items-center gap-1.5">
              {Object.keys(groups).length > 1 && (
                <span className="mr-1 text-[11px] font-semibold uppercase tracking-wide text-slate-400">{group}</span>
              )}
              {groupFields.map((f) => (
                <button key={f} type="button" onClick={() => selectMetric(f)} title={tipFor(f) || undefined}
                  className={cn('rounded-full border px-2.5 py-1 text-xs font-semibold transition',
                    selected === f
                      ? 'border-transparent bg-brand-500 text-white shadow-soft'
                      : 'border-slate-200 text-slate-500 hover:border-brand-400 hover:text-brand-600 dark:border-slate-700 dark:text-slate-300')}>
                  {labels?.[f] || f}
                </button>
              ))}
            </div>
          ))}
        </div>
        <ResponsiveContainer width="100%" height={280}>
          <AreaChart data={chartData} margin={{ left: -12, right: 8, top: 20 }}>
            <defs>
              <linearGradient id="trend" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="#7c3aed" stopOpacity={0.35} />
                <stop offset="95%" stopColor="#7c3aed" stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" vertical={false} />
            <XAxis dataKey="x" tick={{ fontSize: 11, fill: '#94a3b8' }} axisLine={false} tickLine={false} minTickGap={20} />
            <YAxis tick={{ fontSize: 12, fill: '#94a3b8' }} axisLine={false} tickLine={false} tickFormatter={(v) => (selPct ? `${v}%` : formatNumber(v))} />
            <Tooltip contentStyle={{ borderRadius: 12, fontSize: 13 }} formatter={(v) => fmt(v, selPct)} />
            <Area type="monotone" dataKey={selected} stroke="#7c3aed" strokeWidth={2.5} fill="url(#trend)" name={labels?.[selected] || selected}>
              {/* Per-point counts only while they stay readable — dense series rely on the tooltip. */}
              {chartData.length <= 45 && (
                <LabelList dataKey={selected} position="top" formatter={(v) => (v ? fmt(v, selPct) : '')}
                  style={{ fontSize: 10, fontWeight: 600, fill: '#64748b' }} />
              )}
            </Area>
          </AreaChart>
        </ResponsiveContainer>
      </Card>

      {/* Sectioned metrics with deltas */}
      <div className="space-y-4">
        {Object.entries(groups || {}).map(([group, groupFields]) => (
          <Card key={group} className="p-5">
            <h3 className="mb-4 font-bold text-slate-800 dark:text-white">{group}</h3>
            <div className="grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-4">
              {groupFields.map((f) => (
                // All-zero fields dim so real data stands out; hover/focus undims
                // so the InfoTip inside (which inherits the opacity) stays readable.
                // The z bump keeps the tooltip above later siblings — a dimmed
                // (opacity < 1) box is its own stacking context.
                <div key={f} className={cn('relative rounded-xl border border-slate-100 dark:border-slate-800 p-3 hover:z-10 focus-within:z-10', !hasSignal(f) && 'opacity-60 transition hover:opacity-100 focus-within:opacity-100')}>
                  <div className="flex items-center gap-1">
                    <p className="flex items-center gap-1 text-xs text-slate-400">{labels?.[f] || f}<InfoTip text={tipFor(f)} /></p>
                    {isSynced(f) && (
                      <span title={`Auto-synced from ${sync.provider}`} className="ml-auto text-emerald-500 dark:text-emerald-400"><Zap className="h-3 w-3" /></span>
                    )}
                  </div>
                  <p className="mt-1 text-xl font-extrabold text-slate-800 dark:text-white">{fmt(current?.[f], pct.has(f))}</p>
                  <div className="mt-1.5"><span title={deltaTitle}><DeltaBadge delta={cmpDeltas?.[f]} isPct={pct.has(f)} /></span></div>
                </div>
              ))}
            </div>
          </Card>
        ))}
      </div>
    </div>
  );
}
