import { useEffect, useMemo, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Activity, CalendarDays, Flame, Loader2, ShieldCheck, Sparkles, TrendingUp } from 'lucide-react';
import { activityApi } from '../../api/endpoints.js';
import { useAuthStore } from '../../store/authStore.js';
import { Modal } from '../ui/Modal.jsx';
import { Card, Avatar, Badge, EmptyState, Skeleton } from '../ui/primitives.jsx';
import { cn, formatDateTime, formatNumber, timeAgo } from '../../lib/utils.js';

const GAP = 4;
const LABEL_W = 28;
const MIN_STEP = 15; // smallest cell+gap before the grid scrolls horizontally
const MAX_STEP = 22; // largest, so squares never look oversized on wide screens
const WEEKDAY_LABELS = ['', 'Mon', '', 'Wed', '', 'Fri', ''];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const LEVEL_ALPHA = [0, 0.22, 0.42, 0.68, 0.95];

// Size the grid so its columns fill the available width. Every offset (month +
// weekday labels, cells) derives from STEP, so this keeps the layout aligned.
function useFitStep(ref, cols) {
  const [step, setStep] = useState(20);
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

const ACTION_META = {
  TEMPLATE_UPLOAD: { tone: 'text-sky-600 bg-sky-50 dark:bg-sky-500/10', label: 'Template' },
  ASSET_UPLOAD: { tone: 'text-violet-600 bg-violet-50 dark:bg-violet-500/10', label: 'Asset' },
  APPROVAL_SUBMISSION: { tone: 'text-amber-600 bg-amber-50 dark:bg-amber-500/10', label: 'Submission' },
  APPROVAL_APPROVED: { tone: 'text-emerald-600 bg-emerald-50 dark:bg-emerald-500/10', label: 'Approved' },
  APPROVAL_REJECTED: { tone: 'text-rose-600 bg-rose-50 dark:bg-rose-500/10', label: 'Rejected' },
  APPROVAL_RESUBMITTED: { tone: 'text-slate-600 bg-slate-100 dark:bg-slate-800', label: 'Resubmitted' },
  POST_COMPLETION: { tone: 'text-emerald-600 bg-emerald-50 dark:bg-emerald-500/10', label: 'Posted' },
  USER_CREATED: { tone: 'text-emerald-600 bg-emerald-50 dark:bg-emerald-500/10', label: 'User added' },
  USER_UPDATED: { tone: 'text-sky-600 bg-sky-50 dark:bg-sky-500/10', label: 'User updated' },
  USER_DEACTIVATED: { tone: 'text-rose-600 bg-rose-50 dark:bg-rose-500/10', label: 'User removed' },
  ANALYTICS_UPDATED: { tone: 'text-cyan-600 bg-cyan-50 dark:bg-cyan-500/10', label: 'Analytics' },
  COMPETITOR_UPDATED: { tone: 'text-cyan-600 bg-cyan-50 dark:bg-cyan-500/10', label: 'Competitor' },
  SOCIAL_ACCOUNT_UPDATED: { tone: 'text-slate-600 bg-slate-100 dark:bg-slate-800', label: 'Social account' },
  WEBSITE_UPDATED: { tone: 'text-slate-600 bg-slate-100 dark:bg-slate-800', label: 'Website' },
  EVENT_UPDATED: { tone: 'text-slate-600 bg-slate-100 dark:bg-slate-800', label: 'Event' },
  SIGNAGE_UPDATED: { tone: 'text-slate-600 bg-slate-100 dark:bg-slate-800', label: 'Signage' },
  PROFILE_UPDATED: { tone: 'text-slate-600 bg-slate-100 dark:bg-slate-800', label: 'Profile' },
  WORK_ASSIGNED: { tone: 'text-brand-600 bg-brand-50 dark:bg-brand-500/10', label: 'Work assigned' },
  DESIGN_ASSIGNED: { tone: 'text-brand-600 bg-brand-50 dark:bg-brand-500/10', label: 'Design assigned' },
  DESIGN_FORWARDED: { tone: 'text-brand-600 bg-brand-50 dark:bg-brand-500/10', label: 'Forwarded' },
  PLAN_SUBMITTED: { tone: 'text-amber-600 bg-amber-50 dark:bg-amber-500/10', label: 'Plan submitted' },
  PLAN_REVIEWED: { tone: 'text-sky-600 bg-sky-50 dark:bg-sky-500/10', label: 'Plan reviewed' },
  GOAL_UPDATED: { tone: 'text-cyan-600 bg-cyan-50 dark:bg-cyan-500/10', label: 'Goal updated' },
  PROFILE_UPDATE_SUBMITTED: { tone: 'text-sky-600 bg-sky-50 dark:bg-sky-500/10', label: 'Profile request' },
  PROFILE_UPDATE_REVIEWED: { tone: 'text-sky-600 bg-sky-50 dark:bg-sky-500/10', label: 'Profile review' },
  PLAN_APPROVED: { tone: 'text-emerald-600 bg-emerald-50 dark:bg-emerald-500/10', label: 'Plan approved' },
  PLAN_REJECTED: { tone: 'text-rose-600 bg-rose-50 dark:bg-rose-500/10', label: 'Plan rejected' },
  PLAN_RESUBMITTED: { tone: 'text-slate-600 bg-slate-100 dark:bg-slate-800', label: 'Plan resubmitted' },
  CONTENT_FORWARDED: { tone: 'text-brand-600 bg-brand-50 dark:bg-brand-500/10', label: 'Content forwarded' },
};

const prettyDate = (key) => {
  const [y, m, d] = key.split('-').map(Number);
  return `${MONTHS[m - 1]} ${d}, ${y}`;
};

const hexToRgb = (hex) => {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
};

function buildWeeks(cells) {
  if (!cells.length) return [];
  const lead = new Date(`${cells[0].date}T00:00:00Z`).getUTCDay();
  const padded = [...Array(lead).fill(null), ...cells];
  const weeks = [];
  for (let i = 0; i < padded.length; i += 7) weeks.push(padded.slice(i, i + 7));
  return weeks;
}

function makeLevelFn(cells) {
  const vals = cells.map((c) => c.value).filter((v) => v > 0).sort((a, b) => a - b);
  if (!vals.length) return () => 0;
  const q = (p) => vals[Math.min(vals.length - 1, Math.floor(p * (vals.length - 1)))];
  const t1 = q(0.25), t2 = q(0.5), t3 = q(0.75);
  return (v) => (v <= 0 ? 0 : v <= t1 ? 1 : v <= t2 ? 2 : v <= t3 ? 3 : 4);
}

export default function ActivityHeatmapCard({ organizationId }) {
  const { user } = useAuthStore();
  const [selectedDate, setSelectedDate] = useState(null);

  const scopeLabel = user?.isSuperAdmin
    ? 'Platform-wide activity'
    : user?.role === 'USER'
      ? 'Your activity'
      : 'Your organization activity';

  const { data: activityData, isLoading, isError, refetch } = useQuery({
    queryKey: ['activity-logs', organizationId, user?.id || user?._id],
    queryFn: () => activityApi.list({ limit: 5000, organizationId: organizationId || undefined }),
    enabled: !!user && (user?.isSuperAdmin || user?.role !== 'ADMIN' || !!organizationId),
    staleTime: 10 * 60 * 1000,
  });

  const logs = activityData?.logs || [];
  const cells = useMemo(() => {
    const start = new Date();
    start.setUTCDate(start.getUTCDate() - 364);
    start.setUTCHours(0, 0, 0, 0);
    const counts = new Map();
    logs.forEach((log) => {
      const key = new Date(log.createdAt).toISOString().slice(0, 10);
      counts.set(key, (counts.get(key) || 0) + 1);
    });
    const out = [];
    const cursor = new Date(start);
    for (let i = 0; i < 365; i += 1) {
      const key = cursor.toISOString().slice(0, 10);
      out.push({ date: key, value: counts.get(key) || 0 });
      cursor.setUTCDate(cursor.getUTCDate() + 1);
    }
    return out;
  }, [logs]);

  const weeks = useMemo(() => buildWeeks(cells), [cells]);
  const levelOf = useMemo(() => makeLevelFn(cells), [cells]);
  const scrollRef = useRef(null);
  const STEP = useFitStep(scrollRef, weeks.length);
  const CELL = STEP - GAP;
  const gridWidth = weeks.length * STEP;
  const rgb = '#0A66C2';
  const [r, g, b] = hexToRgb(rgb);
  const fill = (lvl) => (lvl === 0 ? undefined : `rgba(${r},${g},${b},${LEVEL_ALPHA[lvl]})`);
  const months = useMemo(() => {
    const out = [];
    let last = -1;
    weeks.forEach((week, ci) => {
      const firstCell = week.find(Boolean);
      if (!firstCell) return;
      const m = new Date(`${firstCell.date}T00:00:00Z`).getUTCMonth();
      if (m !== last) {
        out.push({ col: ci, label: MONTHS[m] });
        last = m;
      }
    });
    return out;
  }, [weeks]);

  const stats = useMemo(() => {
    const total = logs.length;
    const activeDays = cells.filter((cell) => cell.value > 0).length;
    const bestDay = cells.reduce((best, cell) => (cell.value > (best?.value || 0) ? cell : best), null);
    return {
      total,
      activeDays,
      average: Number((total / 365).toFixed(1)),
      bestDay,
    };
  }, [cells, logs.length]);

  const selectedDay = useMemo(() => {
    if (!selectedDate) return [];
    return logs
      .filter((log) => new Date(log.createdAt).toISOString().slice(0, 10) === selectedDate)
      .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  }, [logs, selectedDate]);

  return (
    <Card className="overflow-hidden border border-slate-200/80 bg-white shadow-[0_12px_40px_rgba(15,23,42,0.08)] dark:border-slate-800 dark:bg-slate-950/80">
      <div className="relative border-b border-slate-100/80 bg-gradient-to-br from-[#0b2f73] via-[#0a4d9e] to-[#0a66c2] px-5 py-4 text-white dark:border-slate-800">
        <div aria-hidden className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top_right,rgba(255,255,255,0.14),transparent_36%),radial-gradient(circle_at_left_bottom,rgba(255,255,255,0.08),transparent_28%)]" />
        <div className="relative flex flex-wrap items-start justify-between gap-4">
          <div className="max-w-2xl">
            <div className="flex items-center gap-2">
              <span className="flex h-10 w-10 items-center justify-center rounded-2xl bg-white/12 text-white ring-1 ring-white/20 backdrop-blur">
                <Activity className="h-5 w-5" />
              </span>
              <div>
                <p className="text-sm font-bold text-white">Activity heatmap</p>
                <p className="text-xs text-white/80">{scopeLabel}. Click any day to inspect the exact audit trail.</p>
              </div>
            </div>
            <div className="mt-4 flex flex-wrap gap-2">
              <Badge className="bg-white/90 text-slate-800 shadow-sm backdrop-blur"><ShieldCheck className="mr-1 h-3.5 w-3.5" /> {user?.isSuperAdmin ? 'Super admin' : user?.role === 'USER' ? 'Personal scope' : 'Organization scope'}</Badge>
              <Badge className="bg-white/90 text-slate-800 shadow-sm backdrop-blur"><Sparkles className="mr-1 h-3.5 w-3.5" /> 365-day overview</Badge>
              <Badge className="bg-white/90 text-slate-800 shadow-sm backdrop-blur"><TrendingUp className="mr-1 h-3.5 w-3.5" /> Empty days stay visible</Badge>
            </div>
          </div>

          {stats && (
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              <StatChip label="Actions" value={stats.total} />
              <StatChip label="Active days" value={`${stats.activeDays}/365`} />
              <StatChip label="Daily average" value={stats.average} />
              <StatChip label="Best day" value={stats.bestDay?.value || 0} />
            </div>
          )}
        </div>
      </div>

      <div className="p-5">
        {isLoading ? (
          <div className="space-y-4">
            <div className="flex items-center gap-2 text-sm text-slate-400">
              <Loader2 className="h-4 w-4 animate-spin text-[#0A66C2]" /> Loading a year of activity…
            </div>
            <Skeleton className="h-[260px] w-full rounded-2xl" />
          </div>
        ) : isError ? (
          <div className="rounded-2xl border border-rose-200 bg-rose-50 p-5 text-sm text-rose-700 dark:border-rose-500/20 dark:bg-rose-500/10 dark:text-rose-200">
            <p className="font-semibold">Couldn’t load the activity heatmap.</p>
            <button onClick={() => refetch()} className="mt-2 font-medium underline underline-offset-2">Try again</button>
          </div>
        ) : !stats || stats.activeDays === 0 ? (
          <EmptyState
            icon={CalendarDays}
            title="No activity recorded yet"
            description="Once actions are logged, the year map will light up and every day can be opened for details."
          />
        ) : (
          <div className="space-y-5">
            <div className="rounded-2xl border border-slate-100 bg-slate-50/60 p-4 dark:border-slate-800 dark:bg-slate-900/50">
              <div className="mb-3 flex items-center justify-between gap-3 text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-400">
                <span>Activity density</span>
                <span className="hidden sm:inline">Click any square for details</span>
              </div>
              <div ref={scrollRef} className="overflow-x-auto pb-1">
                <div className="inline-block min-w-full">
                  <div className="flex">
                    <div style={{ width: LABEL_W }} />
                    <div className="relative" style={{ height: 16, width: gridWidth }}>
                      {months.map((m) => (
                        <span key={`${m.col}-${m.label}`} className="absolute top-0 text-[10px] font-medium text-slate-400" style={{ left: m.col * STEP }}>{m.label}</span>
                      ))}
                    </div>
                  </div>

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
                            const isSelected = selectedDate === cell.date;
                            return (
                              <button
                                key={ri}
                                type="button"
                                onClick={() => setSelectedDate(cell.date)}
                                title={`${formatNumber(cell.value)} actions · ${prettyDate(cell.date)}`}
                                className={cn(
                                  'group relative flex items-center justify-center rounded-[4px] outline-none transition-all duration-200 focus-visible:ring-2 focus-visible:ring-[#0A66C2]/40',
                                  lvl === 0 && 'bg-slate-100 dark:bg-slate-800',
                                  isSelected && 'ring-2 ring-[#0A66C2] ring-offset-2 ring-offset-white dark:ring-offset-slate-950'
                                )}
                                style={{ width: CELL, height: CELL, backgroundColor: fill(lvl) }}
                              >
                                <span className="sr-only">{prettyDate(cell.date)} with {cell.value} activities</span>
                                <span className="pointer-events-none absolute inset-0 rounded-[4px] bg-white/0 transition-colors group-hover:bg-white/15" />
                              </button>
                            );
                          })}
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              </div>
              <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-center gap-1.5 text-[11px] text-slate-400">
                  Less
                  {[0, 1, 2, 3, 4].map((lvl) => (
                    <span key={lvl} className={cn('rounded-[4px] border border-slate-200/70 dark:border-slate-700', lvl === 0 && 'bg-slate-100 dark:bg-slate-800')} style={{ width: 14, height: 14, backgroundColor: fill(lvl) }} />
                  ))}
                  More
                </div>
                <p className="text-xs text-slate-500 dark:text-slate-400">Empty squares mean no activity on that day.</p>
              </div>
            </div>

            <div className="grid gap-4 lg:grid-cols-[1.05fr_0.95fr]">
              <Card className="border border-slate-100 bg-white/90 p-4 dark:border-slate-800 dark:bg-slate-900/80">
                <div className="mb-3 flex items-center justify-between">
                  <div>
                    <p className="text-sm font-bold text-slate-900 dark:text-white">Selected day</p>
                    <p className="text-xs text-slate-500 dark:text-slate-400">{selectedDate ? prettyDate(selectedDate) : 'Pick a square to inspect that day.'}</p>
                  </div>
                  {selectedDate && (
                    <button type="button" onClick={() => setSelectedDate(null)} className="rounded-xl border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-500 hover:bg-slate-50 dark:border-slate-700 dark:hover:bg-slate-800">
                      Clear
                    </button>
                  )}
                </div>

                {!selectedDate ? (
                  <EmptyState icon={Activity} title="No day selected" description="Click any heatmap square to load the actions from that date." />
                ) : selectedDay.length === 0 ? (
                  <EmptyState icon={CalendarDays} title="Empty day" description="Nothing was recorded on this date." />
                ) : (
                  <div className="space-y-2">
                    {selectedDay.slice(0, 6).map((log) => {
                      const meta = ACTION_META[log.action] || { tone: 'text-slate-600 bg-slate-100 dark:bg-slate-800', label: 'Activity' };
                      return (
                        <div key={log._id} className="flex items-start gap-3 rounded-2xl border border-slate-100 bg-slate-50/80 p-3 dark:border-slate-800 dark:bg-slate-900/60">
                          <Avatar src={log.user?.avatar} name={log.user?.name} size="sm" />
                          <div className="min-w-0 flex-1">
                            <div className="flex flex-wrap items-center gap-2">
                              <p className="font-semibold text-slate-800 dark:text-slate-100">{log.user?.name || 'Someone'}</p>
                              <Badge className={meta.tone}>{meta.label}</Badge>
                            </div>
                            <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">{log.description || 'No description provided.'}</p>
                            <p className="mt-1 text-[11px] text-slate-400">{formatDateTime(log.createdAt)} · {timeAgo(log.createdAt)}</p>
                          </div>
                        </div>
                      );
                    })}
                    {selectedDay.length > 6 && (
                      <p className="text-xs text-slate-400">Showing the first 6 actions for space. Open the full activity log for the complete audit trail.</p>
                    )}
                  </div>
                )}
              </Card>

              <Card className="border border-slate-100 bg-gradient-to-br from-[#0a66c2] via-[#094f98] to-[#082c57] p-4 text-white shadow-lg shadow-[#0a66c2]/15 dark:border-slate-800">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-xs uppercase tracking-[0.2em] text-white/70">What this tells you</p>
                    <h3 className="mt-1 text-lg font-extrabold">One glance audit radar</h3>
                  </div>
                  <span className="rounded-full bg-white/10 p-2 text-white/90 backdrop-blur">
                    <Flame className="h-4 w-4" />
                  </span>
                </div>
                <div className="mt-4 space-y-3 text-sm text-white/85">
                  <InfoLine title="High activity" text="A bright cluster means a busy day, useful for spotting launches, approvals, or bursts in moderation." />
                  <InfoLine title="Empty days" text="Light squares are still visible, so gaps in platform action stand out immediately." />
                  <InfoLine title="Click to inspect" text="Selecting a day opens the exact actions and people involved, turning the heatmap into a fast audit tool." />
                </div>
              </Card>
            </div>
          </div>
        )}
      </div>

      <Modal open={!!selectedDate} onClose={() => setSelectedDate(null)} title={selectedDate ? `Activity on ${prettyDate(selectedDate)}` : 'Activity'} size="lg">
        <div className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-3">
            <SummaryTile label="Date" value={selectedDate ? prettyDate(selectedDate) : '-'} />
            <SummaryTile label="Activities" value={formatNumber(selectedDay.length)} />
            <SummaryTile label="Status" value={selectedDay.length === 0 ? 'Empty day' : 'Has activity'} />
          </div>
          {selectedDay.length === 0 ? (
            <EmptyState icon={CalendarDays} title="No actions on this day" description="This is the exact empty state you asked for: the square exists, but the audit trail is empty." />
          ) : (
            <div className="max-h-[55vh] space-y-2 overflow-y-auto pr-1">
              {selectedDay.map((log) => {
                const meta = ACTION_META[log.action] || { tone: 'text-slate-600 bg-slate-100 dark:bg-slate-800', label: 'Activity' };
                return (
                  <div key={log._id} className="flex items-start gap-3 rounded-2xl border border-slate-100 bg-slate-50/80 p-3 dark:border-slate-800 dark:bg-slate-900/60">
                    <Avatar src={log.user?.avatar} name={log.user?.name} size="sm" />
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="font-semibold text-slate-800 dark:text-white">{log.user?.name || 'Someone'}</p>
                        <Badge className={meta.tone}>{meta.label}</Badge>
                      </div>
                      <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">{log.description || 'No description provided.'}</p>
                      <p className="mt-1 text-[11px] text-slate-400">{formatDateTime(log.createdAt)} · {timeAgo(log.createdAt)}</p>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </Modal>
    </Card>
  );
}

function StatChip({ label, value }) {
  const displayValue = typeof value === 'number' ? formatNumber(value) : value;
  return (
    <div className="rounded-2xl border border-white/65 bg-white/90 px-3 py-2 text-slate-900 shadow-sm backdrop-blur">
      <p className="text-[10px] uppercase tracking-[0.18em] text-slate-500">{label}</p>
      <p className="mt-1 text-lg font-extrabold tabular-nums text-slate-900">{displayValue}</p>
    </div>
  );
}

function SummaryTile({ label, value }) {
  return (
    <div className="rounded-2xl border border-slate-100 bg-slate-50/80 p-3 dark:border-slate-800 dark:bg-slate-900/60">
      <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-400">{label}</p>
      <p className="mt-1 text-sm font-bold text-slate-800 dark:text-white">{value}</p>
    </div>
  );
}

function InfoLine({ title, text }) {
  return (
    <div className="rounded-2xl bg-white/10 p-3">
      <p className="font-semibold text-white">{title}</p>
      <p className="mt-1 text-sm text-white/75">{text}</p>
    </div>
  );
}