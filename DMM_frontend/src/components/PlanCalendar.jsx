import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  CalendarDays, ChevronLeft, ChevronRight, TriangleAlert, ClipboardList, Building2, Users,
  Linkedin, Instagram, Youtube, Facebook,
} from 'lucide-react';
import { planApi } from '../api/endpoints.js';
import { useAuthStore } from '../store/authStore.js';
import { Card, Select, Skeleton, EmptyState } from './ui/primitives.jsx';
import { Modal } from './ui/Modal.jsx';
import { cn, formatDate } from '../lib/utils.js';

const PLATFORMS = ['LinkedIn', 'Instagram', 'YouTube', 'Facebook'];
const PLATFORM_ICON = { LinkedIn: Linkedin, Instagram: Instagram, YouTube: Youtube, Facebook: Facebook };
const PLATFORM_COLOR = { LinkedIn: '#0A66C2', Instagram: '#E1306C', YouTube: '#FF0000', Facebook: '#1877F2' };
const OTHER_COLOR = '#64748B';
const colorOf = (platform) => PLATFORM_COLOR[platform] || OTHER_COLOR;

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'];
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

// Dates are built from local parts rather than toISOString(), which would shift
// the day for anyone east or west of UTC.
const pad = (n) => String(n).padStart(2, '0');
const isoOf = (y, m, d) => `${y}-${pad(m + 1)}-${pad(d)}`;
const daysInMonth = (y, m) => new Date(y, m + 1, 0).getDate();
const firstWeekday = (y, m) => new Date(y, m, 1).getDay();

// How many entries fit in a cell before it collapses into "+N more".
const MAX_PER_CELL = 3;

/**
 * The approved plan, as a month calendar. Only APPROVED plans appear — a plan
 * still awaiting sign-off is not a commitment, so it has no place on the board
 * everyone works from.
 *
 * This is your college's calendar: the backend scopes planned posts to the
 * organization you belong to, so there is nothing to choose between.
 */
export default function PlanCalendar() {
  const user = useAuthStore((s) => s.user);
  const today = new Date();
  const [cursor, setCursor] = useState({ y: today.getFullYear(), m: today.getMonth() });
  const [platform, setPlatform] = useState('All');
  const [openDay, setOpenDay] = useState(null);

  const { y, m } = cursor;
  const total = daysInMonth(y, m);
  const from = isoOf(y, m, 1);
  const to = isoOf(y, m, total);

  const { data, isLoading, isError, error } = useQuery({
    queryKey: ['plan-calendar', from, to, platform],
    queryFn: () => planApi.schedule({
      from,
      to,
      status: 'APPROVED',
      platform: platform === 'All' ? undefined : platform,
    }),
  });

  const days = data?.days || [];
  const byDate = useMemo(() => new Map(days.map((d) => [d.date, d])), [days]);

  // Leading blanks so the 1st lands under the right weekday, then trailing
  // blanks to square off the last row.
  const cells = useMemo(() => {
    const lead = firstWeekday(y, m);
    const out = Array.from({ length: lead }, () => null);
    for (let d = 1; d <= total; d += 1) out.push(d);
    while (out.length % 7 !== 0) out.push(null);
    return out;
  }, [y, m, total]);

  const todayIso = isoOf(today.getFullYear(), today.getMonth(), today.getDate());
  const step = (delta) => setCursor(({ y: cy, m: cm }) => {
    const next = new Date(cy, cm + delta, 1);
    return { y: next.getFullYear(), m: next.getMonth() };
  });

  const stats = [
    { value: data?.totalPosts ?? 0, label: 'Approved posts' },
    { value: days.length, label: days.length === 1 ? 'Day booked' : 'Days booked' },
    { value: (data?.byPlatform || []).length, label: 'Platforms covered' },
    { value: (data?.byCollege || []).length, label: 'Colleges posting' },
  ];

  return (
    <div className="space-y-4">
      <Card className="space-y-3 p-4">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
          <div className="flex items-center gap-2">
            <button type="button" onClick={() => step(-1)} aria-label="Previous month"
              className="rounded-xl border border-slate-200 p-2.5 text-slate-500 transition-colors hover:bg-slate-50 dark:border-slate-700 dark:hover:bg-slate-800">
              <ChevronLeft className="h-4 w-4" />
            </button>
            <p className="min-w-[190px] text-center text-lg font-extrabold tracking-tight text-slate-800 dark:text-white">
              {MONTHS[m]} <span className="font-bold text-brand-500">{y}</span>
            </p>
            <button type="button" onClick={() => step(1)} aria-label="Next month"
              className="rounded-xl border border-slate-200 p-2.5 text-slate-500 transition-colors hover:bg-slate-50 dark:border-slate-700 dark:hover:bg-slate-800">
              <ChevronRight className="h-4 w-4" />
            </button>
            <button type="button" onClick={() => setCursor({ y: today.getFullYear(), m: today.getMonth() })}
              className="ml-1 h-10 rounded-xl border border-slate-200 px-3 text-sm font-semibold text-slate-600 transition-colors hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800">
              This month
            </button>
          </div>

          <div className="grid flex-1 gap-3 sm:grid-cols-2 lg:ml-auto lg:max-w-lg">
            <Select value={platform} onChange={(e) => setPlatform(e.target.value)} title="Filter by platform">
              <option value="All">All platforms</option>
              {PLATFORMS.map((p) => <option key={p} value={p}>{p}</option>)}
            </Select>
            {/* Your college, fixed — this calendar never shows another one. */}
            <div className="flex h-11 items-center gap-2 rounded-xl border border-slate-200 px-3 text-sm text-slate-500 dark:border-slate-700 dark:text-slate-400">
              <Building2 className="h-4 w-4 shrink-0 text-slate-400" />
              <span className="truncate">{user?.organization?.name || 'Your college'}</span>
            </div>
          </div>
        </div>
      </Card>

      {/* The month in numbers */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {stats.map((s) => (
          <Card key={s.label} className="p-4">
            <p className="text-3xl font-extrabold text-slate-800 dark:text-white">{s.value}</p>
            <p className="mt-1 text-xs font-semibold text-slate-400">{s.label}</p>
          </Card>
        ))}
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <h3 className="text-lg font-extrabold tracking-tight text-slate-800 dark:text-white">
          {MONTHS[m]} at a glance
        </h3>
        <div className="flex flex-wrap items-center gap-3">
          {PLATFORMS.map((p) => (
            <span key={p} className="inline-flex items-center gap-1.5 text-xs font-semibold text-slate-500 dark:text-slate-400">
              <span className="h-2.5 w-2.5 rounded-full" style={{ background: PLATFORM_COLOR[p] }} /> {p}
            </span>
          ))}
        </div>
      </div>

      {isError ? (
        <EmptyState icon={TriangleAlert} title="Couldn't load the calendar"
          description={error?.response?.data?.message || 'Something went wrong fetching approved plans.'} />
      ) : isLoading ? (
        <Skeleton className="h-[520px]" />
      ) : (
        <>
          <Card className="overflow-hidden p-0">
            <div className="overflow-x-auto">
              <div className="min-w-[860px]">
                <div className="grid grid-cols-7 bg-slate-800 dark:bg-slate-900">
                  {WEEKDAYS.map((d) => (
                    <div key={d} className="px-3 py-3 text-center text-[11px] font-bold uppercase tracking-[0.15em] text-white/80">
                      {d}
                    </div>
                  ))}
                </div>

                <div className="grid grid-cols-7">
                  {cells.map((day, i) => {
                    if (day === null) {
                      return <div key={`blank-${i}`} className="min-h-[104px] border-b border-r border-slate-100 bg-slate-50/40 dark:border-slate-800 dark:bg-slate-900/30" />;
                    }
                    const dateIso = isoOf(y, m, day);
                    const entry = byDate.get(dateIso);
                    const posts = entry?.posts || [];
                    const isToday = dateIso === todayIso;
                    const shown = posts.slice(0, MAX_PER_CELL);
                    const extra = posts.length - shown.length;

                    return (
                      <div
                        key={dateIso}
                        role={posts.length ? 'button' : undefined}
                        tabIndex={posts.length ? 0 : undefined}
                        onClick={posts.length ? () => setOpenDay(entry) : undefined}
                        onKeyDown={posts.length ? (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setOpenDay(entry); } } : undefined}
                        className={cn(
                          'min-h-[104px] border-b border-r border-slate-100 p-2 transition-colors dark:border-slate-800',
                          posts.length && 'cursor-pointer hover:bg-brand-50/50 dark:hover:bg-brand-500/[0.07]',
                          isToday && 'bg-brand-50/60 dark:bg-brand-500/10'
                        )}
                      >
                        <div className="mb-1 flex items-center justify-between">
                          <span className={cn('text-sm font-bold',
                            isToday ? 'inline-flex h-6 w-6 items-center justify-center rounded-full bg-brand-600 text-white' : 'text-slate-700 dark:text-slate-200')}>
                            {day}
                          </span>
                          {entry?.clashes?.length > 0 && (
                            <TriangleAlert className="h-3.5 w-3.5 text-amber-500" title={`More than one ${entry.clashes.join(' / ')} post booked`} />
                          )}
                        </div>

                        <ul className="space-y-1">
                          {shown.map((p) => (
                            <li key={p._id} className="flex items-start gap-1.5">
                              <span className="mt-[5px] h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: colorOf(p.platform) }} />
                              <span className="min-w-0 flex-1 truncate text-[11px] font-semibold leading-tight"
                                style={{ color: colorOf(p.platform) }} title={p.title}>
                                {p.title}
                              </span>
                            </li>
                          ))}
                          {extra > 0 && (
                            <li className="pl-3 text-[11px] font-bold text-slate-400">+{extra} more</li>
                          )}
                        </ul>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          </Card>

          {days.length === 0 && (
            <EmptyState icon={ClipboardList} title={`Nothing approved for ${MONTHS[m]}`}
              description={platform === 'All'
                ? 'Once your plan is approved, every post in it lands on this calendar.'
                : `No approved ${platform} posts this month. Try another platform.`} />
          )}
        </>
      )}

      {openDay && <DayModal day={openDay} onClose={() => setOpenDay(null)} />}
    </div>
  );
}

// Everything booked on one date, with who planned it and which plan it came from.
function DayModal({ day, onClose }) {
  return (
    <Modal open onClose={onClose} title={formatDate(day.date)} size="lg">
      <div className="space-y-3">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 text-sm text-slate-500 dark:text-slate-400">
          <span className="inline-flex items-center gap-1.5 font-semibold text-slate-700 dark:text-slate-200">
            <CalendarDays className="h-4 w-4 text-slate-400" /> {day.count} approved {day.count === 1 ? 'post' : 'posts'}
          </span>
          {day.contributors?.length > 0 && (
            <span className="inline-flex items-center gap-1.5 text-xs">
              <Users className="h-3.5 w-3.5 text-slate-400" /> {day.contributors.join(', ')}
            </span>
          )}
          {day.clashes?.length > 0 && (
            <span className="inline-flex items-center gap-1.5 rounded-lg bg-amber-50 px-2.5 py-1 text-xs font-semibold text-amber-700 dark:bg-amber-500/10 dark:text-amber-400">
              <TriangleAlert className="h-3.5 w-3.5" /> More than one {day.clashes.join(' / ')} post booked
            </span>
          )}
        </div>

        <ul className="divide-y divide-slate-100 dark:divide-slate-800">
          {(day.posts || []).map((p) => {
            const channels = p.platforms?.length ? p.platforms : [p.platform].filter(Boolean);
            return (
              <li key={p._id} className="py-3">
                <p className="font-semibold text-slate-800 dark:text-white">{p.title}</p>
                <div className="mt-1 flex flex-wrap items-center gap-1.5">
                  {channels.map((c) => {
                    const Icon = PLATFORM_ICON[c];
                    return (
                      <span key={c} className="inline-flex items-center gap-1 rounded-lg bg-slate-100 px-2 py-0.5 text-[11px] font-bold text-slate-600 dark:bg-slate-800 dark:text-slate-300">
                        {Icon && <Icon className="h-3 w-3" style={{ color: colorOf(c) }} />} {c}
                      </span>
                    );
                  })}
                </div>
                <p className="mt-1 text-xs text-slate-400">
                  {p.createdBy?.name || 'Unknown'}
                  {p.organization?.name ? ` · ${p.organization.name}` : ''}
                  {p.plan?.title ? ` · in “${p.plan.title}”` : ''}
                </p>
                {p.notes && <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">{p.notes}</p>}
              </li>
            );
          })}
        </ul>
      </div>
    </Modal>
  );
}
