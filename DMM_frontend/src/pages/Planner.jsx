import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import {
  ClipboardList, Plus, Trash2, Pencil, CalendarRange, CalendarDays, CheckCircle2, XCircle,
  MessageSquareWarning, Building2, Linkedin, Instagram, Youtube, Facebook, Send,
} from 'lucide-react';

import { planApi, organizationApi } from '../api/endpoints.js';
import { useAuthStore } from '../store/authStore.js';
import PageHeader from '../components/layout/PageHeader.jsx';
import { Modal } from '../components/ui/Modal.jsx';
import { Button } from '../components/ui/Button.jsx';
import { Input, Select, Card, Skeleton, EmptyState } from '../components/ui/primitives.jsx';
import ViewToggle, { useViewMode } from '../components/ui/ViewToggle.jsx';
import PlanSchedule from '../components/PlanSchedule.jsx';
import PlanCalendar from '../components/PlanCalendar.jsx';
import { cn, formatDate, platformsOf, isCoordinatorUser } from '../lib/utils.js';

const PLATFORMS = ['LinkedIn', 'Instagram', 'YouTube', 'Facebook'];
const PLATFORM_ICON = { LinkedIn: Linkedin, Instagram: Instagram, YouTube: Youtube, Facebook: Facebook };
const PLATFORM_COLOR = { LinkedIn: '#0A66C2', Instagram: '#E1306C', YouTube: '#FF0000', Facebook: '#1877F2' };

const STATUS_META = {
  PENDING: { label: 'Awaiting approval', cls: 'bg-amber-50 text-amber-600 dark:bg-amber-500/10 dark:text-amber-400' },
  RESUBMITTED: { label: 'Resubmitted', cls: 'bg-sky-50 text-sky-600 dark:bg-sky-500/10 dark:text-sky-400' },
  APPROVED: { label: 'Approved — go ahead', cls: 'bg-emerald-50 text-emerald-600 dark:bg-emerald-500/10 dark:text-emerald-400' },
  REJECTED: { label: 'Needs changes', cls: 'bg-rose-50 text-rose-600 dark:bg-rose-500/10 dark:text-rose-400' },
};
const StatusChip = ({ status }) => {
  const m = STATUS_META[status] || STATUS_META.PENDING;
  return <span className={cn('whitespace-nowrap rounded-full px-2.5 py-1 text-[11px] font-bold', m.cls)}>{m.label}</span>;
};

const todayStr = () => new Date().toISOString().slice(0, 10);
// Nothing preselected — the platforms are an explicit choice per post.
const blankItem = () => ({ date: todayStr(), platforms: [], title: '', notes: '' });

const FILTERS = [
  { key: 'All', label: 'All' },
  { key: 'REVIEW', label: 'Awaiting' },
  { key: 'APPROVED', label: 'Approved' },
  { key: 'REJECTED', label: 'Rejected' },
];

export default function Planner() {
  const qc = useQueryClient();
  const { user } = useAuthStore();
  const [status, setStatus] = useState('All');
  const [tab, setTab] = useState('plans'); // plans | calendar | schedule
  const [view, setView] = useViewMode('planner');
  const [editing, setEditing] = useState(null); // null | {} (new) | plan (edit/resubmit)
  const [viewing, setViewing] = useState(null);

  const { data, isLoading } = useQuery({ queryKey: ['plans', status], queryFn: () => planApi.list({ status, limit: 50 }) });
  const plans = data?.plans || [];
  const refresh = () => qc.invalidateQueries({ queryKey: ['plans'] });

  return (
    <div>
      <PageHeader
        title="Post Planner"
        subtitle="Plan your upcoming posts — for the next week, 10 days, or any stretch — and submit the plan for approval before you start creating."
        actions={<Button onClick={() => setEditing({})}><Plus className="h-4 w-4" /> New plan</Button>}
      />

      {/* My plans, my college's approved calendar, and what's booked on a date */}
      <div className="mb-5 inline-flex flex-wrap rounded-xl bg-slate-100 p-1 dark:bg-slate-800">
        <button onClick={() => setTab('plans')}
          className={cn('inline-flex items-center gap-1.5 rounded-lg px-4 py-2 text-sm font-semibold transition',
            tab === 'plans' ? 'bg-white text-brand-700 shadow-soft dark:bg-slate-900 dark:text-brand-300' : 'text-slate-500 hover:text-slate-700 dark:hover:text-slate-300')}>
          <ClipboardList className="h-4 w-4" /> My plans
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

      {tab === 'calendar' ? (
        /* Approved plans for your own college, laid out as a month. */
        <PlanCalendar />
      ) : tab === 'schedule' ? (
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
        <ViewToggle view={view} onChange={setView} />
      </div>

      {isLoading ? (
        view === 'grid' ? (
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">{Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-44" />)}</div>
        ) : (
          <div className="space-y-2">{Array.from({ length: 8 }).map((_, i) => <Skeleton key={i} className="h-14" />)}</div>
        )
      ) : plans.length === 0 ? (
        <EmptyState icon={ClipboardList} title="No plans yet"
          description="Lay out the posts you intend to publish over the coming days and send the plan for approval."
          action={<Button onClick={() => setEditing({})}><Plus className="h-4 w-4" /> Create your first plan</Button>} />
      ) : view === 'grid' ? (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {plans.map((p) => <PlanCard key={p._id} plan={p} onOpen={() => setViewing(p)} />)}
        </div>
      ) : (
        /* List view — one row per plan, for comparing windows and statuses */
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
              {plans.map((p) => <PlanRow key={p._id} plan={p} onOpen={() => setViewing(p)} />)}
            </tbody>
          </table>
        </Card>
      )}
      </>
      )}

      {editing !== null && (
        <PlanEditor plan={editing?._id ? editing : null} onClose={() => setEditing(null)} onSaved={() => { refresh(); setEditing(null); }} />
      )}
      {viewing && (
        <PlanDetail planId={viewing._id} user={user} onClose={() => setViewing(null)} onChanged={refresh}
          onEdit={(plan) => { setViewing(null); setEditing(plan); }} />
      )}
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
      {plan.status === 'REJECTED' && plan.feedback && (
        <p className="mt-3 flex items-start gap-1.5 rounded-lg bg-rose-50 p-2 text-xs text-rose-600 dark:bg-rose-500/10 dark:text-rose-400">
          <MessageSquareWarning className="mt-0.5 h-3.5 w-3.5 shrink-0" /> {plan.feedback}
        </p>
      )}
    </Card>
  );
}

// Same plan, one row — opens the identical detail modal the card does.
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

// Create a new plan, or edit + resubmit a rejected one.
function PlanEditor({ plan, onClose, onSaved }) {
  const { user } = useAuthStore();
  // One college: the plan is for it, so the picker is replaced by its name.
  const oneCollege = isCoordinatorUser(user);
  const { data: orgData } = useQuery({ queryKey: ['org-options'], queryFn: organizationApi.options });
  const orgs = orgData?.organizations || [];
  const [form, setForm] = useState({
    organization: plan?.organization?._id || plan?.organization || user?.organization?._id || '',
    title: plan?.title || '',
    description: plan?.description || '',
  });
  const [items, setItems] = useState(
    plan?.items?.length
      ? plan.items.map((i) => ({ date: String(i.date).slice(0, 10), platforms: platformsOf(i), title: i.title, notes: i.notes || '' }))
      : [blankItem()]
  );

  const setItem = (idx, patch) => setItems((list) => list.map((it, i) => (i === idx ? { ...it, ...patch } : it)));
  const addItem = () => setItems((list) => [...list, { ...blankItem(), date: list[list.length - 1]?.date || todayStr() }]);
  const removeItem = (idx) => setItems((list) => list.filter((_, i) => i !== idx));

  const saveMut = useMutation({
    mutationFn: () => {
      const payload = { ...form, items };
      return plan?._id ? planApi.update(plan._id, payload) : planApi.create(payload);
    },
    // Guarded in submit() below, but keep the server's message if it disagrees.
    onSuccess: () => {
      toast.success(plan?._id
        ? (plan.status === 'REJECTED' ? 'Plan resubmitted for approval' : 'Plan updated')
        : 'Plan submitted for approval');
      onSaved();
    },
    onError: (e) => toast.error(e.response?.data?.message || 'Could not save the plan'),
  });

  return (
    <Modal open onClose={onClose} size="lg"
      title={plan?._id ? (plan.status === 'REJECTED' ? 'Fix & resubmit plan' : 'Edit plan') : 'New post plan'}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          const missing = items.findIndex((it) => !(it.platforms || []).length);
          if (missing !== -1) { toast.error(`Post ${missing + 1}: pick at least one platform`); return; }
          saveMut.mutate();
        }}
        className="space-y-4"
      >
        {plan?.status === 'APPROVED' && (
          <div className="flex items-start gap-2 rounded-xl bg-amber-50 p-3 text-sm text-amber-700 dark:bg-amber-500/10 dark:text-amber-400">
            <MessageSquareWarning className="mt-0.5 h-4 w-4 shrink-0" />
            <span>This plan is already approved. Saving changes sends it back to the admin for approval again.</span>
          </div>
        )}
        {plan?.status === 'REJECTED' && plan.feedback && (
          <div className="flex items-start gap-2 rounded-xl bg-rose-50 p-3 text-sm text-rose-600 dark:bg-rose-500/10 dark:text-rose-400">
            <MessageSquareWarning className="mt-0.5 h-4 w-4 shrink-0" />
            <span><span className="font-bold">Reviewer feedback:</span> {plan.feedback}</span>
          </div>
        )}

        <div className="grid gap-3 sm:grid-cols-2">
          <Input label="Plan title" required value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })}
            placeholder="e.g. NCET — next 10 days content plan" />
          {/* A coordinator plans for their own college, so there is nothing to
              pick — the name is shown instead of a one-option list. */}
          {oneCollege ? (
            <div>
              <span className="mb-1.5 block text-sm font-medium text-slate-600 dark:text-slate-300">Organization</span>
              <p className="flex h-11 items-center gap-2 rounded-xl border border-slate-200 px-3 text-sm text-slate-600 dark:border-slate-700 dark:text-slate-300">
                <Building2 className="h-4 w-4 shrink-0 text-slate-400" />
                <span className="truncate">{user?.organization?.name || 'Your college'}</span>
              </p>
            </div>
          ) : (
            <Select label="Organization" required value={form.organization} disabled={!!plan?._id}
              onChange={(e) => setForm({ ...form, organization: e.target.value })}>
              <option value="" disabled>Select organization…</option>
              {orgs.map((o) => <option key={o._id} value={o._id}>{o.name}</option>)}
            </Select>
          )}
        </div>
        <textarea className="input-base min-h-[52px]" placeholder="What is this plan about? (optional)"
          value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />

        <div>
          <div className="mb-2 flex items-center justify-between">
            <span className="text-sm font-semibold text-slate-700 dark:text-slate-200">Planned posts ({items.length})</span>
            <Button type="button" size="sm" variant="outline" onClick={addItem}><Plus className="h-4 w-4" /> Add post</Button>
          </div>
          <div className="space-y-2.5">
            {items.map((it, idx) => (
              <div key={idx} className="rounded-xl border border-slate-100 p-3 dark:border-slate-800">
                <div className="grid gap-2.5 sm:grid-cols-[140px_1fr_auto]">
                  <Input type="date" value={it.date} onChange={(e) => setItem(idx, { date: e.target.value })} />
                  <Input required placeholder={`Post ${idx + 1} — what will you post?`} value={it.title}
                    onChange={(e) => setItem(idx, { title: e.target.value })} />
                  <button type="button" onClick={() => removeItem(idx)} disabled={items.length === 1}
                    title="Remove this post"
                    className="flex h-11 w-11 items-center justify-center rounded-xl text-slate-400 transition-colors hover:bg-rose-50 hover:text-rose-500 disabled:opacity-30 dark:hover:bg-rose-500/10">
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>

                {/* The same planned post can go out on several channels */}
                <div className="mt-2 flex flex-wrap items-center gap-1.5">
                  <span className="mr-0.5 text-xs font-medium text-slate-400">Platforms:</span>
                  {PLATFORMS.map((p) => {
                    const on = (it.platforms || []).includes(p);
                    const Icon = PLATFORM_ICON[p];
                    return (
                      <button
                        key={p} type="button" aria-pressed={on}
                        onClick={() => setItem(idx, {
                          platforms: on
                            ? (it.platforms || []).filter((x) => x !== p)
                            : [...(it.platforms || []), p],
                        })}
                        className={cn('inline-flex items-center gap-1 rounded-lg border px-2 py-1 text-xs font-semibold transition',
                          on
                            ? 'border-brand-500 bg-brand-50 text-brand-700 dark:border-brand-500/60 dark:bg-brand-500/10 dark:text-brand-300'
                            : 'border-slate-200 text-slate-500 hover:bg-slate-50 dark:border-slate-700 dark:hover:bg-slate-800')}
                      >
                        {Icon && <Icon className="h-3.5 w-3.5" style={on ? { color: PLATFORM_COLOR[p] } : undefined} />}
                        {p}
                      </button>
                    );
                  })}
                  {!(it.platforms || []).length && (
                    <span className="text-xs font-semibold text-rose-500">pick at least one</span>
                  )}
                </div>
                <input className="input-base mt-2 h-9 text-xs" placeholder="Notes for this post (optional) — caption idea, asset to use…"
                  value={it.notes} onChange={(e) => setItem(idx, { notes: e.target.value })} />
              </div>
            ))}
          </div>
        </div>

        <div className="flex items-center justify-end gap-2 pt-1">
          <Button type="button" variant="ghost" onClick={onClose}>Cancel</Button>
          <Button type="submit" loading={saveMut.isPending}>
            <Send className="h-4 w-4" />
            {plan?._id ? (plan.status === 'REJECTED' ? 'Resubmit for approval' : plan.status === 'APPROVED' ? 'Save & send for approval' : 'Save changes') : 'Submit for approval'}
          </Button>
        </div>
      </form>
    </Modal>
  );
}

function PlanDetail({ planId, user, onClose, onChanged, onEdit }) {
  const { data, isLoading } = useQuery({ queryKey: ['plan', planId], queryFn: () => planApi.get(planId) });
  const plan = data?.plan;
  const [rejecting, setRejecting] = useState(false);
  const [feedback, setFeedback] = useState('');

  const done = (msg) => { toast.success(msg); onChanged(); onClose(); };
  const approveMut = useMutation({
    mutationFn: () => planApi.approve(planId),
    onSuccess: () => done('Plan approved'),
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

  const isOwner = plan && String(plan.createdBy?._id) === String(user?._id);
  const canReview = plan && ['PENDING', 'RESUBMITTED'].includes(plan.status) && !isOwner &&
    (user?.role === 'ADMIN' || (user?.role === 'CEO' && String(plan.organization?._id) === String(user?.organization?._id)));
  // An approved plan can still be changed - it just has to be approved again.
  const canEdit = plan && isOwner && ['PENDING', 'REJECTED', 'APPROVED', 'RESUBMITTED'].includes(plan.status);

  return (
    <Modal open onClose={onClose} size="lg" title={plan?.title || 'Plan'}>
      {isLoading || !plan ? (
        <Skeleton className="h-64" />
      ) : (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center gap-2 text-xs text-slate-400">
            <StatusChip status={plan.status} />
            <span>{plan.organization?.name} · by {plan.createdBy?.name}</span>
            <span>· {formatDate(plan.startDate)} → {formatDate(plan.endDate)} · {plan.items.length} posts</span>
            {plan.resubmitCount > 0 && <span>· resubmitted {plan.resubmitCount}×</span>}
          </div>

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
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {plan.reviewedBy && <p className="text-xs text-slate-400">Reviewed by {plan.reviewedBy.name} on {formatDate(plan.reviewedAt)}</p>}

          {rejecting ? (
            <div className="space-y-3 rounded-xl border border-rose-200 p-4 dark:border-rose-500/30">
              <label className="block text-sm font-semibold text-slate-700 dark:text-slate-200">What should change?</label>
              <textarea autoFocus className="input-base min-h-[70px]" value={feedback} onChange={(e) => setFeedback(e.target.value)}
                placeholder="Tell the creator what to adjust before resubmitting…" />
              <div className="flex gap-2">
                <Button variant="danger" loading={rejectMut.isPending} disabled={!feedback.trim()} onClick={() => rejectMut.mutate()}>
                  <XCircle className="h-4 w-4" /> Send rejection
                </Button>
                <Button variant="ghost" onClick={() => setRejecting(false)}>Cancel</Button>
              </div>
            </div>
          ) : (
            <div className="flex flex-wrap items-center gap-2">
              {canReview && (
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
              {canEdit && (
                <Button variant="outline" onClick={() => onEdit(plan)}>
                  <Pencil className="h-4 w-4" /> {plan.status === 'REJECTED' ? 'Fix & resubmit' : plan.status === 'APPROVED' ? 'Change plan' : 'Edit plan'}
                </Button>
              )}
              {(isOwner || user?.role === 'ADMIN') && (
                <Button variant="ghost" onClick={() => window.confirm('Delete this plan permanently?') && removeMut.mutate()}
                  className="ml-auto text-rose-500 hover:bg-rose-50 dark:hover:bg-rose-500/10">
                  <Trash2 className="h-4 w-4" /> Delete
                </Button>
              )}
            </div>
          )}
        </div>
      )}
    </Modal>
  );
}
