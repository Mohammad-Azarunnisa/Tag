import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import {
  CalendarDays, CalendarRange, TriangleAlert, Users, ClipboardList, Building2, Trash2,
  Linkedin, Instagram, Youtube, Facebook,
} from 'lucide-react';
import { planApi, organizationApi } from '../api/endpoints.js';
import { useAuthStore } from '../store/authStore.js';
import { Card, Input, Select, Skeleton, EmptyState } from './ui/primitives.jsx';
import { cn, formatDate, canDeleteContent } from '../lib/utils.js';

const PLATFORMS = ['LinkedIn', 'Instagram', 'YouTube', 'Facebook'];
const PLATFORM_ICON = { LinkedIn: Linkedin, Instagram: Instagram, YouTube: Youtube, Facebook: Facebook };
const PLATFORM_COLOR = { LinkedIn: '#0A66C2', Instagram: '#E1306C', YouTube: '#FF0000', Facebook: '#1877F2' };

const PLAN_STATUS = {
  PENDING: { label: 'Awaiting approval', cls: 'bg-amber-50 text-amber-600 dark:bg-amber-500/10 dark:text-amber-400' },
  RESUBMITTED: { label: 'Resubmitted', cls: 'bg-sky-50 text-sky-600 dark:bg-sky-500/10 dark:text-sky-400' },
  APPROVED: { label: 'Approved', cls: 'bg-emerald-50 text-emerald-600 dark:bg-emerald-500/10 dark:text-emerald-400' },
};

// Dates are built from local parts rather than toISOString(), which would shift
// the day for anyone east or west of UTC.
const pad = (n) => String(n).padStart(2, '0');
const iso = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const todayStr = () => iso(new Date());
const plusDays = (dateStr, n) => {
  const [y, m, d] = dateStr.split('-').map(Number);
  const dt = new Date(y, m - 1, d);
  dt.setDate(dt.getDate() + n);
  return iso(dt);
};

/**
 * "What is already planned for this date?" — planned posts pulled out of every
 * plan you can see, grouped by day and segregated by platform, so two people
 * don't unknowingly book the same platform on the same date. Single day or a
 * date range, and filterable by platform and by college.
 *
 * The college filter only ever narrows what the viewer may already see; the
 * backend enforces that.
 */
export default function PlanSchedule() {
  const qc = useQueryClient();
  const user = useAuthStore((s) => s.user);
  // Pulling a single booking out of someone else's plan is a super-admin
  // correction; the backend enforces this too.
  // An institution's Admin may pull a post out of their own college's plan too,
  // not only the super admin — the server decides (utils/permissions.js).
  const canRemovePost = canDeleteContent(user);
  const [mode, setMode] = useState('day'); // day | range
  const [from, setFrom] = useState(todayStr);
  const [to, setTo] = useState(() => plusDays(todayStr(), 6));
  const [platform, setPlatform] = useState('All');
  const [orgFilter, setOrgFilter] = useState(''); // '' = every college

  // A backwards range would just 400 — keep the request sane instead.
  const safeTo = to < from ? from : to;
  const params = mode === 'day' ? { date: from } : { from, to: safeTo };

  const { data: orgData } = useQuery({ queryKey: ['org-options'], queryFn: organizationApi.options });
  const orgs = orgData?.organizations || [];

  const { data, isLoading, isError, error } = useQuery({
    queryKey: ['plan-schedule', mode, from, safeTo, platform, orgFilter],
    queryFn: () => planApi.schedule({
      ...params,
      platform: platform === 'All' ? undefined : platform,
      organizationId: orgFilter || undefined,
    }),
  });
  const removeMut = useMutation({
    mutationFn: ({ planId, itemId }) => planApi.removeItem(planId, itemId),
    onSuccess: () => {
      toast.success('Planned post removed');
      qc.invalidateQueries({ queryKey: ['plan-schedule'] });
      qc.invalidateQueries({ queryKey: ['plans'] });
    },
    onError: (e) => toast.error(e.response?.data?.message || 'Could not remove that post'),
  });

  const days = data?.days || [];
  const total = data?.totalPosts || 0;
  const byPlatform = data?.byPlatform || [];
  const byCollege = data?.byCollege || [];

  const pill = (active) => cn('inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-sm font-semibold transition',
    active ? 'bg-white text-brand-700 shadow-soft dark:bg-slate-900 dark:text-brand-300' : 'text-slate-500 hover:text-slate-700 dark:hover:text-slate-300');

  return (
    <div className="space-y-4">
      <Card className="space-y-3 p-4">
        {/* Day vs range, and the dates themselves */}
        <div className="flex flex-col gap-3 lg:flex-row lg:items-end">
          <div className="inline-flex shrink-0 self-start rounded-xl bg-slate-100 p-1 dark:bg-slate-800">
            <button onClick={() => setMode('day')} className={pill(mode === 'day')}>
              <CalendarDays className="h-4 w-4" /> Single day
            </button>
            <button onClick={() => setMode('range')} className={pill(mode === 'range')}>
              <CalendarRange className="h-4 w-4" /> Date range
            </button>
          </div>

          <div className="grid flex-1 gap-3 sm:grid-cols-2 lg:max-w-md">
            <Input label={mode === 'day' ? 'Date' : 'From'} type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
            {mode === 'range' && (
              <Input label="To" type="date" value={safeTo} min={from} onChange={(e) => setTo(e.target.value)} />
            )}
          </div>

          <div className="flex shrink-0 gap-2 lg:ml-auto">
            <button onClick={() => { setFrom(todayStr()); setTo(plusDays(todayStr(), 6)); }}
              className="h-11 rounded-xl border border-slate-200 px-3 text-sm font-semibold text-slate-600 transition-colors hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800">
              Today
            </button>
            {mode === 'range' && (
              <button onClick={() => { setFrom(todayStr()); setTo(plusDays(todayStr(), 29)); }}
                className="h-11 rounded-xl border border-slate-200 px-3 text-sm font-semibold text-slate-600 transition-colors hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800">
                Next 30 days
              </button>
            )}
          </div>
        </div>

        {/* Segregate by platform and by college */}
        <div className="grid gap-3 border-t border-slate-100 pt-3 sm:grid-cols-2 lg:max-w-2xl dark:border-slate-800">
          <Select label="Platform" value={platform} onChange={(e) => setPlatform(e.target.value)}>
            <option value="All">All platforms</option>
            {PLATFORMS.map((p) => <option key={p} value={p}>{p}</option>)}
          </Select>
          <Select label="College" value={orgFilter} onChange={(e) => setOrgFilter(e.target.value)}>
            <option value="">All colleges</option>
            {orgs.map((o) => <option key={o._id} value={o._id}>{o.name}</option>)}
          </Select>
        </div>
      </Card>

      {isLoading ? (
        <div className="space-y-3">{Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-28" />)}</div>
      ) : isError ? (
        <EmptyState icon={TriangleAlert} title="Couldn't load the schedule"
          description={error?.response?.data?.message || 'Something went wrong fetching planned posts.'} />
      ) : days.length === 0 ? (
        <EmptyState icon={ClipboardList} title="Nothing planned"
          description={mode === 'day'
            ? `No ${platform === 'All' ? '' : `${platform} `}posts are planned for ${formatDate(from)}. The date is free.`
            : `No ${platform === 'All' ? '' : `${platform} `}posts are planned between ${formatDate(from)} and ${formatDate(safeTo)}.`} />
      ) : (
        <>
          {/* Totals, broken down both ways */}
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm">
            <span className="text-slate-500 dark:text-slate-400">
              <span className="font-bold text-slate-700 dark:text-slate-200">{total}</span> planned {total === 1 ? 'post' : 'posts'}
              {mode === 'range' && <> across <span className="font-bold text-slate-700 dark:text-slate-200">{days.length}</span> {days.length === 1 ? 'day' : 'days'}</>}
            </span>
            {byPlatform.length > 1 && (
              <span className="flex flex-wrap items-center gap-2">
                {byPlatform.map((p) => {
                  const Icon = PLATFORM_ICON[p.name];
                  return (
                    <span key={p.name} className="inline-flex items-center gap-1 rounded-lg bg-slate-100 px-2 py-0.5 text-xs font-semibold text-slate-600 dark:bg-slate-800 dark:text-slate-300">
                      {Icon && <Icon className="h-3.5 w-3.5" style={{ color: PLATFORM_COLOR[p.name] }} />} {p.count}
                    </span>
                  );
                })}
              </span>
            )}
            {byCollege.length > 1 && (
              <span className="flex flex-wrap items-center gap-2">
                {byCollege.map((c) => (
                  <span key={c.name} className="inline-flex items-center gap-1 rounded-lg bg-slate-100 px-2 py-0.5 text-xs font-semibold text-slate-600 dark:bg-slate-800 dark:text-slate-300">
                    <Building2 className="h-3.5 w-3.5 text-slate-400" /> {c.name} {c.count}
                  </span>
                ))}
              </span>
            )}
          </div>

          {days.map((day) => (
            <Card key={day.date} className="overflow-hidden">
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 border-b border-slate-100 px-4 py-3 dark:border-slate-800">
                <p className="font-bold text-slate-800 dark:text-white">{formatDate(day.date)}</p>
                <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-semibold text-slate-600 dark:bg-slate-800 dark:text-slate-300">
                  {day.count} {day.count === 1 ? 'post' : 'posts'}
                </span>
                {day.contributors?.length > 1 && (
                  <span className="inline-flex items-center gap-1 text-xs text-slate-400">
                    <Users className="h-3.5 w-3.5" /> {day.contributors.join(', ')}
                  </span>
                )}
                {day.clashes?.length > 0 && (
                  <span className="ml-auto inline-flex items-center gap-1.5 rounded-lg bg-amber-50 px-2.5 py-1 text-xs font-semibold text-amber-700 dark:bg-amber-500/10 dark:text-amber-400">
                    <TriangleAlert className="h-3.5 w-3.5" />
                    More than one {day.clashes.join(' / ')} post booked
                  </span>
                )}
              </div>

              {/* One block per platform, so same-platform posts sit together */}
              {(day.groups || []).map((g) => {
                const Icon = PLATFORM_ICON[g.platform];
                return (
                  <div key={g.platform} className="border-b border-slate-100 last:border-0 dark:border-slate-800">
                    <div className={cn('flex items-center gap-2 px-4 py-1.5',
                      g.clash ? 'bg-amber-50/60 dark:bg-amber-500/[0.07]' : 'bg-slate-50/70 dark:bg-slate-800/30')}>
                      {Icon && <Icon className="h-4 w-4 shrink-0" style={{ color: PLATFORM_COLOR[g.platform] }} />}
                      <span className="text-xs font-bold uppercase tracking-wide text-slate-500 dark:text-slate-400">{g.platform}</span>
                      <span className="text-xs text-slate-400">· {g.count}</span>
                      {g.colleges?.length > 0 && (
                        <span className="truncate text-xs text-slate-400">· {g.colleges.join(', ')}</span>
                      )}
                      {g.clash && (
                        <span className="ml-auto inline-flex items-center gap-1 text-[11px] font-bold text-amber-700 dark:text-amber-400">
                          <TriangleAlert className="h-3 w-3" /> overlap
                        </span>
                      )}
                    </div>
                    <ul className="divide-y divide-slate-50 dark:divide-slate-800/60">
                      {g.posts.map((p) => {
                        const st = PLAN_STATUS[p.plan?.status] || PLAN_STATUS.PENDING;
                        // The same planned post shows under each channel it targets —
                        // say so, so it doesn't read as a duplicate.
                        const alsoOn = (p.platforms || []).filter((x) => x !== g.platform);
                        return (
                          <li key={p._id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2.5 pl-10">
                            <span className="min-w-0 flex-1">
                              <span className="block truncate text-sm font-semibold text-slate-800 dark:text-white">{p.title}</span>
                              <span className="block truncate text-xs text-slate-400">
                                {p.createdBy?.name || 'Unknown'}
                                {p.organization?.name ? ` · ${p.organization.name}` : ''}
                                {p.plan?.title ? ` · in “${p.plan.title}”` : ''}
                                {alsoOn.length ? ` · also on ${alsoOn.join(', ')}` : ''}
                                {p.notes ? ` · ${p.notes}` : ''}
                              </span>
                            </span>
                            <span className={cn('shrink-0 whitespace-nowrap rounded-full px-2.5 py-1 text-[11px] font-bold', st.cls)}>{st.label}</span>
                            {canRemovePost && (
                              <button
                                type="button"
                                aria-label={`Remove planned post ${p.title}`}
                                title="Remove this planned post"
                                disabled={removeMut.isPending}
                                onClick={() => {
                                  const where = (p.platforms || [p.platform]).join(', ');
                                  const msg = `Remove "${p.title}" (${where}) on ${formatDate(p.date)} from ${p.createdBy?.name || 'this user'}'s plan “${p.plan?.title}”?\n\nThis deletes just this one planned post. It cannot be undone.`;
                                  if (window.confirm(msg)) removeMut.mutate({ planId: p.plan?._id, itemId: p._id });
                                }}
                                className="shrink-0 rounded-lg p-1.5 text-slate-400 transition-colors hover:bg-rose-50 hover:text-rose-600 disabled:opacity-40 dark:hover:bg-rose-500/10"
                              >
                                <Trash2 className="h-4 w-4" />
                              </button>
                            )}
                          </li>
                        );
                      })}
                    </ul>
                  </div>
                );
              })}
            </Card>
          ))}
        </>
      )}
    </div>
  );
}
