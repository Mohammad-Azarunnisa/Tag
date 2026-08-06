import { useEffect, useMemo, useRef, useState } from 'react';
import { useQuery, keepPreviousData } from '@tanstack/react-query';
import { Activity, Flame, CalendarDays, TrendingUp, Loader2 } from 'lucide-react';
import { analyticsApi } from '../api/endpoints.js';
import { Card } from './ui/primitives.jsx';
import { cn, formatNumber, PLATFORM_STYLES } from '../lib/utils.js';

const GAP = 3;        // px between cells
const LABEL_W = 30;   // left weekday-label column
const MIN_STEP = 13;  // smallest cell+gap (below this the grid scrolls horizontally)
const MAX_STEP = 20;  // largest cell+gap, so squares never look oversized
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const LEVEL_ALPHA = [0, 0.25, 0.45, 0.68, 1]; // 0 = empty; 1..4 = intensity
const WEEKDAY_LABELS = ['', 'Mon', '', 'Wed', '', 'Fri', ''];

const prettyDate = (key) => { const [y, m, d] = key.split('-').map(Number); return `${MONTHS[m - 1]} ${d}, ${y}`; };
const hexToRgb = (hex) => { const n = parseInt(hex.slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; };

// Chunk the year's cells into GitHub-style week columns (top row = Sunday),
// padding the first week so weekdays line up.
function buildWeeks(cells) {
  if (!cells.length) return [];
  const lead = new Date(`${cells[0].date}T00:00:00Z`).getUTCDay(); // 0=Sun
  const padded = [...Array(lead).fill(null), ...cells];
  const weeks = [];
  for (let i = 0; i < padded.length; i += 7) weeks.push(padded.slice(i, i + 7));
  return weeks;
}

// Quartile thresholds over the non-zero values give a balanced 4-level scale
// even when one day spikes far above the rest.
function makeLevelFn(cells) {
  const vals = cells.map((c) => c.value).filter((v) => v > 0).sort((a, b) => a - b);
  if (!vals.length) return () => 0;
  const q = (p) => vals[Math.min(vals.length - 1, Math.floor(p * (vals.length - 1)))];
  const t1 = q(0.25), t2 = q(0.5), t3 = q(0.75);
  return (v) => (v <= 0 ? 0 : v <= t1 ? 1 : v <= t2 ? 2 : v <= t3 ? 3 : 4);
}

// Size the grid so its columns fill the available width. Because every offset in
// the grid (month labels, weekday labels, cells) is derived from STEP, sizing
// this one number keeps the whole layout perfectly aligned at any width.
function useFitStep(ref, cols) {
  const [step, setStep] = useState(16);
  useEffect(() => {
    const el = ref.current;
    if (!el || !cols) return undefined;
    const measure = () => {
      const avail = el.clientWidth - LABEL_W;
      if (avail <= 0) return;
      setStep(Math.max(MIN_STEP, Math.min(MAX_STEP, Math.floor(avail / cols))));
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [ref, cols]);
  return step;
}

export default function ActivityHeatmap({ orgId, platform }) {
  const [metric, setMetric] = useState(''); // '' → backend picks the platform default
  // Reset to the default metric whenever the platform changes.
  useEffect(() => { setMetric(''); }, [platform]);
  const scrollRef = useRef(null);

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ['heatmap', platform, orgId, metric],
    queryFn: () => analyticsApi.heatmap(platform, orgId, metric || undefined),
    enabled: !!orgId && !!platform,
    placeholderData: keepPreviousData,
    staleTime: 10 * 60 * 1000,
  });

  const cells = data?.cells || [];
  const weeks = useMemo(() => buildWeeks(cells), [cells]);
  const levelOf = useMemo(() => makeLevelFn(cells), [cells]);
  const STEP = useFitStep(scrollRef, weeks.length);
  const CELL = STEP - GAP;
  const rgb = PLATFORM_STYLES[platform]?.color || '#f15d27';
  const [r, g, b] = hexToRgb(rgb);
  const fill = (lvl) => (lvl === 0 ? undefined : `rgba(${r},${g},${b},${LEVEL_ALPHA[lvl]})`);

  // Month labels: mark the column where each new month first appears.
  const months = useMemo(() => {
    const out = []; let last = -1;
    weeks.forEach((week, ci) => {
      const firstCell = week.find(Boolean);
      if (!firstCell) return;
      const m = new Date(`${firstCell.date}T00:00:00Z`).getUTCMonth();
      if (m !== last) { out.push({ col: ci, label: MONTHS[m] }); last = m; }
    });
    return out;
  }, [weeks]);

  const stats = data?.stats;
  const gridWidth = weeks.length * STEP;

  return (
    <Card className="overflow-hidden">
      {/* Header + metric picker */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 px-5 py-4 dark:border-slate-800">
        <div className="flex items-center gap-2.5">
          <span className="flex h-9 w-9 items-center justify-center rounded-xl text-white shadow-sm" style={{ background: rgb }}>
            <Activity className="h-5 w-5" />
          </span>
          <div>
            <p className="text-sm font-bold text-slate-800 dark:text-white">Activity heatmap — last 365 days</p>
            <p className="text-xs text-slate-400">Daily {data?.label ? data.label.toLowerCase() : 'activity'} on {platform}</p>
          </div>
        </div>
        {data?.metrics?.length > 0 && (
          <label className="flex items-center gap-2 text-xs font-semibold text-slate-500 dark:text-slate-400">
            Metric
            <select
              className="input-base h-9 w-auto cursor-pointer text-sm font-semibold"
              value={data.metric || ''} onChange={(e) => setMetric(e.target.value)}
            >
              {data.metrics.map((m) => <option key={m.key} value={m.key}>{m.label}</option>)}
            </select>
          </label>
        )}
      </div>

      <div className="p-5">
        {isLoading ? (
          <div className="flex items-center gap-2.5 text-sm text-slate-400">
            <Loader2 className="h-4 w-4 animate-spin" style={{ color: rgb }} /> Loading a year of activity…
          </div>
        ) : isError ? (
          <p className="text-sm text-slate-400">Couldn’t load the heatmap. <button onClick={() => refetch()} className="font-semibold text-brand-600 hover:underline">Try again</button>.</p>
        ) : !stats || stats.activeDays === 0 ? (
          <p className="text-sm text-slate-400">No {data?.label?.toLowerCase() || 'activity'} recorded for {platform} in the last year yet.</p>
        ) : (
          <>
            {/* Stat strip */}
            <div className="mb-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
              <Stat icon={TrendingUp} label={`Total ${data.label.toLowerCase()}`} value={formatNumber(stats.total)} color={rgb} />
              <Stat icon={CalendarDays} label="Active days" value={`${stats.activeDays} / ${data.days}`} color={rgb} />
              <Stat icon={Activity} label="Daily average" value={formatNumber(stats.average)} color={rgb} />
              <Stat icon={Flame} label="Best day" value={stats.bestDay ? formatNumber(stats.bestDay.value) : '—'} sub={stats.bestDay ? prettyDate(stats.bestDay.date) : ''} color={rgb} />
            </div>

            {/* The grid — sized to fill the card width */}
            <div ref={scrollRef} className="overflow-x-auto pb-1">
              <div style={{ width: Math.max(gridWidth + LABEL_W, 0) }}>
                {/* Month labels */}
                <div className="flex">
                  <div style={{ width: LABEL_W }} />
                  <div className="relative" style={{ height: 16, width: gridWidth }}>
                    {months.map((m) => (
                      <span key={`${m.col}-${m.label}`} className="absolute top-0 text-[10px] font-medium text-slate-400" style={{ left: m.col * STEP }}>{m.label}</span>
                    ))}
                  </div>
                </div>
                {/* Weekday labels + week columns */}
                <div className="flex">
                  <div className="flex flex-col" style={{ width: LABEL_W, gap: GAP }}>
                    {WEEKDAY_LABELS.map((lbl, i) => (
                      <div key={i} className="flex items-center text-[10px] leading-none text-slate-400" style={{ height: CELL }}>{lbl}</div>
                    ))}
                  </div>
                  <div className="flex" style={{ gap: GAP }}>
                    {weeks.map((week, ci) => (
                      <div key={ci} className="flex flex-col" style={{ gap: GAP }}>
                        {week.map((cell, ri) => {
                          if (!cell) return <div key={ri} style={{ width: CELL, height: CELL }} />;
                          const lvl = levelOf(cell.value);
                          return (
                            <div
                              key={ri}
                              title={`${formatNumber(cell.value)} ${data.label.toLowerCase()} · ${prettyDate(cell.date)}`}
                              className={cn(
                                'rounded-[3px] ring-1 ring-inset transition-transform hover:scale-[1.35]',
                                lvl === 0 ? 'bg-slate-100 ring-slate-200/70 dark:bg-slate-800 dark:ring-slate-700/60' : 'ring-black/[0.06] dark:ring-white/[0.06]'
                              )}
                              style={{ width: CELL, height: CELL, backgroundColor: fill(lvl) }}
                            />
                          );
                        })}
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>

            {/* Legend */}
            <div className="mt-3 flex items-center justify-end gap-1.5 text-[11px] text-slate-400">
              Less
              {[0, 1, 2, 3, 4].map((lvl) => (
                <span key={lvl} className={cn('rounded-[3px] ring-1 ring-inset', lvl === 0 ? 'bg-slate-100 ring-slate-200/70 dark:bg-slate-800 dark:ring-slate-700/60' : 'ring-black/[0.06] dark:ring-white/[0.06]')}
                  style={{ width: 12, height: 12, backgroundColor: fill(lvl) }} />
              ))}
              More
            </div>
          </>
        )}
      </div>
    </Card>
  );
}

function Stat({ icon: Icon, label, value, sub, color }) {
  return (
    <div className="rounded-xl border border-slate-100 bg-slate-50/60 p-3 dark:border-slate-800 dark:bg-slate-800/40">
      <p className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-slate-400">
        <Icon className="h-3.5 w-3.5" style={{ color }} /> {label}
      </p>
      <p className="mt-1 text-lg font-extrabold tabular-nums text-slate-800 dark:text-white">{value}</p>
      {sub && <p className="text-[11px] text-slate-400">{sub}</p>}
    </div>
  );
}
