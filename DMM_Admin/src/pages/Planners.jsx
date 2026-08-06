import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import {
  ClipboardList, CalendarRange, CalendarDays, CheckCircle2, XCircle, X, Trash2, Building2,
  Linkedin, Instagram, Youtube, Facebook, MessageSquareWarning,
} from 'lucide-react';
import { planApi, organizationApi } from '../api/endpoints.js';
import { useAuthStore } from '../store/authStore.js';
import PageHeader from '../components/layout/PageHeader.jsx';
import { Button } from '../components/ui/Button.jsx';
import { Card, Skeleton, EmptyState } from '../components/ui/primitives.jsx';
import ViewToggle, { useViewMode } from '../components/ui/ViewToggle.jsx';
import PlanSchedule from '../components/PlanSchedule.jsx';
import PlanCalendar from '../components/PlanCalendar.jsx';
import { cn, formatDate, platformsOf } from '../lib/utils.js';

const PLATFORM_ICON = { LinkedIn: Linkedin, Instagram: Instagram, YouTube: Youtube, Facebook: Facebook };
const PLATFORM_COLOR = { LinkedIn: '#0A66C2', Instagram: '#E1306C', YouTube: '#FF0000', Facebook: '#1877F2' };

const STATUS_META = {
  PENDING: { label: 'Awaiting review', cls: 'bg-amber-50 text-amber-600 dark:bg-amber-500/10 dark:text-amber-400' },
  RESUBMITTED: { label: 'Resubmitted', cls: 'bg-sky-50 text-sky-600 dark:bg-sky-500/10 dark:text-sky-400' },
  APPROVED: { label: 'Approved', cls: 'bg-emerald-50 text-emerald-600 dark:bg-emerald-500/10 dark:text-emerald-400' },
  REJECTED: { label: 'Rejected', cls: 'bg-rose-50 text-rose-600 dark:bg-rose-500/10 dark:text-rose-400' },
};
const StatusChip = ({ status }) => {
  const m = STATUS_META[status] || STATUS_META.PENDING;
  return <span className={cn('rounded-full px-2.5 py-1 text-[11px] font-bold', m.cls)}>{m.label}</span>;
};

const FILTERS = [
  { key: 'REVIEW', label: 'Awaiting review' },
  { key: 'APPROVED', label: 'Approved' },
  { key: 'REJECTED', label: 'Rejected' },
  { key: 'All', label: 'All' },
];

export default function Planners() {
  const qc = useQueryClient();
  const [status, setStatus] = useState('REVIEW');
  const [orgId, setOrgId] = useState('');
  const [tab, setTab] = useState('plans'); // plans | calendar | schedule
  const [view, setView] = useViewMode('planners');
  const [openPlan, setOpenPlan] = useState(null);

  const { data: orgData } = useQuery({ queryKey: ['org-options'], queryFn: organizationApi.options });
  const { data, isLoading } = useQuery({
    queryKey: ['plans', status, orgId],
    queryFn: () => planApi.list({ status, organizationId: orgId || undefined, limit: 50 }),
  });
  const plans = data?.plans || [];
  const refresh = () => qc.invalidateQueries({ queryKey: ['plans'] });

  return (
    <div>
      <PageHeader title="Post Planners" subtitle="Review the posting plans users submit — approve a plan so the team can start creating, or send it back with feedback." />

      {/* The review queue, the approved month calendar, and what's booked on a date */}
      <div className="mb-5 flex flex-wrap items-center gap-3">
        <div className="inline-flex flex-wrap rounded-xl bg-slate-100 p-1 dark:bg-slate-800">
          <button onClick={() => setTab('plans')}
            className={cn('inline-flex items-center gap-1.5 rounded-lg px-4 py-2 text-sm font-semibold transition',
              tab === 'plans' ? 'bg-white text-brand-700 shadow-soft dark:bg-slate-900 dark:text-brand-300' : 'text-slate-500 hover:text-slate-700 dark:hover:text-slate-300')}>
            <ClipboardList className="h-4 w-4" /> Plans
          </button>
          <button onClick={() => setTab('calendar')}
            className={cn('inline-flex items-center gap-1.5 rounded-lg px-4 py-2 text-sm font-semibold transition',
              tab === 'calendar' ? 'bg-white text-brand-700 shadow-soft dark:bg-slate-900 dark:text-brand-300' : 'text-slate-500 hover:text-slate-700 dark:hover:text-slate-300')}>
            <CalendarDays className="h-4 w-4" /> Calendar
          </button>
          <button onClick={() => setTab('schedule')}
            className={cn('inline-flex items-center gap-1.5 rounded-lg px-4 py-2 text-sm font-semibold transition',
              tab === 'schedule' ? 'bg-white text-brand-700 shadow-soft dark:bg-slate-900 dark:text-brand-300' : 'text-slate-500 hover:text-slate-700 dark:hover:text-slate-300')}>
            <CalendarRange className="h-4 w-4" /> What's planned on…
          </button>
        </div>
      </div>

      {tab === 'calendar' ? (
        /* Approved plans only, laid out as a month. Super admin can switch college. */
        <PlanCalendar canPickCollege />
      ) : tab === 'schedule' ? (
        /* Owns its own platform + college filters. */
        <PlanSchedule />
      ) : (
      <>
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <div className="inline-flex flex-wrap rounded-xl bg-slate-100 p-1 dark:bg-slate-800">
          {FILTERS.map((f) => (
            <button key={f.key} onClick={() => setStatus(f.key)}
              className={cn('rounded-lg px-4 py-2 text-sm font-semibold transition',
                status === f.key ? 'bg-white text-brand-700 shadow-soft dark:bg-slate-900 dark:text-brand-300' : 'text-slate-500 hover:text-slate-700 dark:hover:text-slate-300')}>
              {f.label}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-2">
          <select value={orgId} onChange={(e) => setOrgId(e.target.value)} className="input-base h-10 w-auto max-w-[220px] cursor-pointer">
            <option value="">All colleges</option>
            {(orgData?.organizations || []).map((o) => <option key={o._id} value={o._id}>{o.name}</option>)}
          </select>
          <ViewToggle view={view} onChange={setView} />
        </div>
      </div>

      {isLoading ? (
        view === 'grid' ? (
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">{Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-44" />)}</div>
        ) : (
          <div className="space-y-2">{Array.from({ length: 8 }).map((_, i) => <Skeleton key={i} className="h-14" />)}</div>
        )
      ) : plans.length === 0 ? (
        <EmptyState icon={ClipboardList} title="No plans here" description={status === 'REVIEW' ? 'No plans are waiting for review right now.' : 'No plans match this filter yet.'} />
      ) : view === 'grid' ? (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {plans.map((p) => <PlanCard key={p._id} plan={p} onOpen={() => setOpenPlan(p)} />)}
        </div>
      ) : (
        /* List view — one row per plan, for working through a review queue */
        <Card className="overflow-x-auto">
          <table className="w-full min-w-[860px] text-sm">
            <thead>
              <tr className="border-b border-slate-100 text-left text-xs font-bold uppercase tracking-wide text-slate-400 dark:border-slate-800">
                <th className="px-4 py-3">Plan</th>
                <th className="px-3 py-3">Organization</th>
                <th className="px-3 py-3">Window</th>
                <th className="px-3 py-3 text-right">Posts</th>
                <th className="px-3 py-3">Platforms</th>
                <th className="px-3 py-3">Status</th>
              </tr>
            </thead>
            <tbody>
              {plans.map((p) => <PlanRow key={p._id} plan={p} onOpen={() => setOpenPlan(p)} />)}
            </tbody>
          </table>
        </Card>
      )}
      </>
      )}

      {openPlan && <PlanModal planId={openPlan._id} onClose={() => setOpenPlan(null)} onChanged={refresh} />}
    </div>
  );
}

function PlanCard({ plan, onOpen }) {
  const platforms = [...new Set((plan.items || []).flatMap((i) => platformsOf(i)))];
  return (
    <Card onClick={onOpen} className="cursor-pointer p-5 transition-shadow hover:shadow-lg">
      <div className="mb-2 flex items-start justify-between gap-2">
        <h3 className="font-bold leading-snug text-slate-800 dark:text-white">{plan.title}</h3>
        <StatusChip status={plan.status} />
      </div>
      <p className="mb-3 flex items-center gap-1.5 text-xs text-slate-400">
        <Building2 className="h-3.5 w-3.5" style={{ color: plan.organization?.color }} />
        {plan.organization?.name} · by {plan.createdBy?.name}
      </p>
      <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
        <span className="inline-flex items-center gap-1 rounded-lg bg-slate-50 px-2 py-1 font-semibold dark:bg-slate-800/60">
          <CalendarRange className="h-3.5 w-3.5 text-brand-500" />
          {formatDate(plan.startDate)} → {formatDate(plan.endDate)}
        </span>
        <span className="rounded-lg bg-slate-50 px-2 py-1 font-semibold dark:bg-slate-800/60">{plan.items?.length || 0} posts</span>
        <span className="flex items-center gap-1">
          {platforms.map((pl) => {
            const Icon = PLATFORM_ICON[pl];
            return Icon ? <Icon key={pl} className="h-3.5 w-3.5" style={{ color: PLATFORM_COLOR[pl] }} /> : null;
          })}
        </span>
      </div>
    </Card>
  );
}

// Same plan, one row — opens the identical review modal the card does.
function PlanRow({ plan, onOpen }) {
  const platforms = [...new Set((plan.items || []).flatMap((i) => platformsOf(i)))];
  return (
    <tr onClick={onOpen} tabIndex={0} role="button"
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onOpen(); } }}
      className="cursor-pointer border-b border-slate-100 last:border-0 hover:bg-slate-50 dark:border-slate-800 dark:hover:bg-slate-800/50">
      <td className="px-4 py-2.5">
        <p className="max-w-[280px] truncate font-semibold text-slate-800 dark:text-white">{plan.title}</p>
        <p className="text-xs text-slate-400">by {plan.createdBy?.name}</p>
        {plan.status === 'REJECTED' && plan.feedback && (
          <p className="mt-1 flex items-start gap-1 text-xs text-rose-500">
            <MessageSquareWarning className="mt-0.5 h-3 w-3 shrink-0" />
            <span className="max-w-[280px] truncate">{plan.feedback}</span>
          </p>
        )}
      </td>
      <td className="px-3 py-2.5">
        <span className="inline-flex items-center gap-1.5 text-xs text-slate-500 dark:text-slate-400">
          <Building2 className="h-3.5 w-3.5" style={{ color: plan.organization?.color }} />
          {plan.organization?.name || '—'}
        </span>
      </td>
      <td className="whitespace-nowrap px-3 py-2.5 text-xs text-slate-500 dark:text-slate-400">
        {formatDate(plan.startDate)} → {formatDate(plan.endDate)}
      </td>
      <td className="px-3 py-2.5 text-right text-xs font-semibold text-slate-600 dark:text-slate-300">{plan.items?.length || 0}</td>
      <td className="px-3 py-2.5">
        <span className="flex items-center gap-1">
          {platforms.map((pl) => {
            const Icon = PLATFORM_ICON[pl];
            return Icon ? <span key={pl} title={pl}><Icon className="h-3.5 w-3.5" style={{ color: PLATFORM_COLOR[pl] }} /></span> : null;
          })}
        </span>
      </td>
      <td className="px-3 py-2.5"><StatusChip status={plan.status} /></td>
    </tr>
  );
}

function PlanModal({ planId, onClose, onChanged }) {
  const qc = useQueryClient();
  const me = useAuthStore((s) => s.user);
  // Removing one planned post is a super-admin correction (backend enforces it).
  const canRemovePost = !!me?.isSuperAdmin && !me?.viewOnly;
  const { data, isLoading } = useQuery({ queryKey: ['plan', planId], queryFn: () => planApi.get(planId) });
  const plan = data?.plan;
  const [rejecting, setRejecting] = useState(false);
  const [feedback, setFeedback] = useState('');

  const done = (msg) => { toast.success(msg); onChanged(); onClose(); };

  // Unlike the others this keeps the modal open — you may be clearing several.
  const removeItemMut = useMutation({
    mutationFn: (itemId) => planApi.removeItem(planId, itemId),
    onSuccess: () => {
      toast.success('Planned post removed');
      qc.invalidateQueries({ queryKey: ['plan', planId] });
      qc.invalidateQueries({ queryKey: ['plan-schedule'] });
      onChanged();
    },
    onError: (e) => toast.error(e.response?.data?.message || 'Could not remove that post'),
  });
  const approveMut = useMutation({
    mutationFn: () => planApi.approve(planId),
    onSuccess: () => done('Plan approved — the creator has been notified'),
    onError: (e) => toast.error(e.response?.data?.message || 'Failed'),
  });
  const rejectMut = useMutation({
    mutationFn: () => planApi.reject(planId, feedback),
    onSuccess: () => done('Plan rejected with feedback'),
    onError: (e) => toast.error(e.response?.data?.message || 'Failed'),
  });
  const removeMut = useMutation({
    mutationFn: () => planApi.remove(planId),
    onSuccess: () => done('Plan deleted'),
    onError: (e) => toast.error(e.response?.data?.message || 'Failed'),
  });

  const reviewable = plan && ['PENDING', 'RESUBMITTED'].includes(plan.status);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4 backdrop-blur-sm" onClick={onClose}>
      <div className="max-h-[88vh] w-full max-w-2xl overflow-y-auto rounded-2xl bg-white shadow-2xl dark:bg-slate-900" onClick={(e) => e.stopPropagation()}>
        {isLoading || !plan ? (
          <div className="p-6"><Skeleton className="h-64" /></div>
        ) : (
          <>
            <div className="sticky top-0 flex items-start justify-between gap-3 border-b border-slate-100 bg-white px-6 py-4 dark:border-slate-800 dark:bg-slate-900">
              <div>
                <div className="flex items-center gap-2">
                  <h2 className="text-lg font-bold text-slate-800 dark:text-white">{plan.title}</h2>
                  <StatusChip status={plan.status} />
                </div>
                <p className="mt-0.5 text-xs text-slate-400">
                  {plan.organization?.name} · by {plan.createdBy?.name} · {formatDate(plan.startDate)} → {formatDate(plan.endDate)} · {plan.items.length} posts
                  {plan.resubmitCount > 0 && ` · resubmitted ${plan.resubmitCount}×`}
                </p>
              </div>
              <button onClick={onClose} className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800"><X className="h-5 w-5" /></button>
            </div>

            <div className="space-y-4 px-6 py-4">
              {plan.description && <p className="rounded-xl bg-slate-50 p-3 text-sm text-slate-600 dark:bg-slate-800/50 dark:text-slate-300">{plan.description}</p>}

              {plan.status === 'REJECTED' && plan.feedback && (
                <div className="flex items-start gap-2 rounded-xl bg-rose-50 p-3 text-sm text-rose-600 dark:bg-rose-500/10 dark:text-rose-400">
                  <MessageSquareWarning className="mt-0.5 h-4 w-4 shrink-0" />
                  <span><span className="font-bold">Feedback:</span> {plan.feedback}</span>
                </div>
              )}

              <div className="overflow-x-auto rounded-xl border border-slate-100 dark:border-slate-800">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-slate-100 text-left text-[11px] uppercase tracking-wide text-slate-400 dark:border-slate-800">
                      <th className="px-4 py-2.5 font-bold">Date</th>
                      <th className="px-4 py-2.5 font-bold">Platform</th>
                      <th className="px-4 py-2.5 font-bold">Post</th>
                      {canRemovePost && <th className="px-4 py-2.5" />}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-50 dark:divide-slate-800/60">
                    {plan.items.map((it) => {
                      return (
                        <tr key={it._id}>
                          <td className="whitespace-nowrap px-4 py-2.5 font-semibold text-slate-600 dark:text-slate-300">{formatDate(it.date)}</td>
                          <td className="px-4 py-2.5">
                            <span className="flex flex-wrap items-center gap-x-3 gap-y-1 font-semibold text-slate-600 dark:text-slate-300">
                          {platformsOf(it).map((pl) => {
                            const Icon = PLATFORM_ICON[pl];
                            return (
                              <span key={pl} className="inline-flex items-center gap-1.5">
                                {Icon && <Icon className="h-4 w-4" style={{ color: PLATFORM_COLOR[pl] }} />}
                                {pl}
                              </span>
                            );
                          })}
                            </span>
                          </td>
                          <td className="px-4 py-2.5">
                            <p className="font-semibold text-slate-800 dark:text-white">{it.title}</p>
                            {it.notes && <p className="text-xs text-slate-400">{it.notes}</p>}
                          </td>
                          {canRemovePost && (
                            <td className="px-4 py-2.5 text-right">
                              <button
                                type="button" aria-label={`Remove ${it.title}`} title="Remove this planned post"
                                disabled={removeItemMut.isPending || plan.items.length === 1}
                                onClick={() => {
                                  if (plan.items.length === 1) return;
                                  const where = platformsOf(it).join(', ');
                                  if (window.confirm(`Remove "${it.title}" (${where}) on ${formatDate(it.date)} from this plan?\n\nThe rest of the plan is untouched. This cannot be undone.`)) {
                                    removeItemMut.mutate(it._id);
                                  }
                                }}
                                className="rounded-lg p-1.5 text-slate-400 transition-colors hover:bg-rose-50 hover:text-rose-600 disabled:cursor-not-allowed disabled:opacity-30 dark:hover:bg-rose-500/10"
                              >
                                <Trash2 className="h-4 w-4" />
                              </button>
                            </td>
                          )}
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              {plan.reviewedBy && (
                <p className="text-xs text-slate-400">Reviewed by {plan.reviewedBy.name} on {formatDate(plan.reviewedAt)}</p>
              )}

              {rejecting ? (
                <div className="space-y-3 rounded-xl border border-rose-200 p-4 dark:border-rose-500/30">
                  <label className="block text-sm font-semibold text-slate-700 dark:text-slate-200">What should the creator change?</label>
                  <textarea autoFocus className="input-base min-h-[70px]" placeholder="e.g. Spread the Instagram posts out — 3 on the same day is too many…"
                    value={feedback} onChange={(e) => setFeedback(e.target.value)} />
                  <div className="flex gap-2">
                    <Button variant="danger" loading={rejectMut.isPending} disabled={!feedback.trim()} onClick={() => rejectMut.mutate()}>
                      <XCircle className="h-4 w-4" /> Send rejection
                    </Button>
                    <Button variant="ghost" onClick={() => setRejecting(false)}>Cancel</Button>
                  </div>
                </div>
              ) : (
                <div className="flex flex-wrap items-center gap-2 pb-2">
                  {reviewable && (
                    <>
                      <Button variant="success" loading={approveMut.isPending} onClick={() => approveMut.mutate()}>
                        <CheckCircle2 className="h-4 w-4" /> Approve plan
                      </Button>
                      <Button variant="outline" onClick={() => setRejecting(true)}
                        className="border-rose-200 text-rose-600 hover:bg-rose-50 dark:border-rose-500/30 dark:text-rose-400 dark:hover:bg-rose-500/10">
                        <XCircle className="h-4 w-4" /> Reject with feedback
                      </Button>
                    </>
                  )}
                  <Button variant="ghost" onClick={() => window.confirm('Delete this plan permanently?') && removeMut.mutate()}
                    className="ml-auto text-rose-500 hover:bg-rose-50 dark:hover:bg-rose-500/10">
                    <Trash2 className="h-4 w-4" /> Delete
                  </Button>
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
