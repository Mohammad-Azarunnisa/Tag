import { Fragment, useMemo, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import {
  BriefcaseBusiness, Search, Circle, Clock3, Send, CheckCircle2, ThumbsUp, Plus, Flame,
  Palette, MessageSquareWarning,
} from 'lucide-react';
import { workAssignmentApi, userApi, organizationApi } from '../api/endpoints.js';
import { useAuthStore } from '../store/authStore.js';
import PageHeader from '../components/layout/PageHeader.jsx';
import { Modal } from '../components/ui/Modal.jsx';
import { Button } from '../components/ui/Button.jsx';
import { Card, Input, Select, Skeleton, EmptyState, Avatar } from '../components/ui/primitives.jsx';
import { cn, formatDate, timeAgo } from '../lib/utils.js';

const STATUS_META = {
  OPEN: { label: 'Open', icon: Circle, cls: 'bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-400' },
  ACKNOWLEDGED: { label: 'In progress', icon: Clock3, cls: 'bg-sky-100 text-sky-700 dark:bg-sky-500/15 dark:text-sky-300' },
  SUBMITTED: { label: 'Awaiting approval', icon: Send, cls: 'bg-violet-100 text-violet-700 dark:bg-violet-500/15 dark:text-violet-300' },
  DONE: { label: 'Completed', icon: CheckCircle2, cls: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-400' },
};
const StatusChip = ({ status }) => {
  const m = STATUS_META[status] || STATUS_META.OPEN;
  const Icon = m.icon;
  return (
    <span className={cn('inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2.5 py-1 text-xs font-semibold', m.cls)}>
      <Icon className="h-3.5 w-3.5" /> {m.label}
    </span>
  );
};

// NORMAL is the default and carries no badge, so the ones that change someone's
// order of work are the ones that stand out.
const URGENCY_META = {
  LOW: { label: 'Low', cls: 'bg-slate-100 text-slate-500 dark:bg-slate-700/50 dark:text-slate-300' },
  NORMAL: null,
  HIGH: { label: 'High', cls: 'bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-400' },
  URGENT: { label: 'Urgent', cls: 'bg-rose-100 text-rose-700 dark:bg-rose-500/15 dark:text-rose-400' },
};
const UrgencyChip = ({ urgency }) => {
  const m = URGENCY_META[urgency];
  if (!m) return null;
  return (
    <span className={cn('inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-bold', m.cls)}>
      {urgency === 'URGENT' && <Flame className="h-3 w-3" />} {m.label}
    </span>
  );
};

const URGENCIES = [
  { key: 'LOW', label: 'Low' },
  { key: 'NORMAL', label: 'Normal' },
  { key: 'HIGH', label: 'High' },
  { key: 'URGENT', label: 'Urgent' },
];
const PLATFORMS = ['LinkedIn', 'Instagram', 'YouTube', 'Facebook'];

/**
 * An Admin's view of the work they have handed out. Scope comes from the server:
 * every institution the super admin put under them, and nothing else — so this
 * page never needs to know which colleges those are.
 */
export default function TeamWork() {
  const qc = useQueryClient();
  const { user } = useAuthStore();
  const canWrite = !user?.viewOnly;
  // Handing work out and signing off a completion request both belong to the
  // admin, matching what the server allows. A coordinator never reaches this
  // page — they raise a request and the admin allocates it.
  const canReview = canWrite && user?.role === 'CEO';

  const [search, setSearch] = useState('');
  const [orgFilter, setOrgFilter] = useState('');
  const [userFilter, setUserFilter] = useState('');
  const [urgencyFilter, setUrgencyFilter] = useState('');
  const [status, setStatus] = useState('All');
  const [assigning, setAssigning] = useState(false);
  const [reviewing, setReviewing] = useState(null);

  // Only the institutions this Admin holds — offering any other college would
  // just produce a save the server refuses.
  const { data: orgData } = useQuery({
    queryKey: ['my-org-options'], queryFn: organizationApi.myOptions,
  });
  const orgs = orgData?.organizations || [];

  // The status tile is deliberately NOT sent to the server: the tiles count out
  // of this response, so asking the server for one status would leave the other
  // three tiles reading zero. Status is applied below, after the counts.
  const { data, isLoading } = useQuery({
    queryKey: ['team-work', { search, orgFilter, urgencyFilter }],
    queryFn: () => workAssignmentApi.list({
      search: search || undefined,
      organization: orgFilter || undefined,
      urgency: urgencyFilter || undefined,
    }),
  });
  const all = data?.assignments || [];

  // Built from who actually has work in view, so the list never offers a name
  // with nothing behind it.
  const people = useMemo(() => {
    const seen = new Map();
    all.forEach((a) => { if (a.assignee?._id) seen.set(a.assignee._id, a.assignee); });
    return [...seen.values()].sort((x, y) => String(x.name || '').localeCompare(String(y.name || '')));
  }, [all]);

  // Everything in view before the status tile is applied — the tiles count out
  // of this, so picking one never zeroes the other three.
  const scoped = useMemo(
    () => (userFilter ? all.filter((a) => String(a.assignee?._id) === String(userFilter)) : all),
    [all, userFilter]
  );

  const counts = useMemo(() => {
    const c = { OPEN: 0, ACKNOWLEDGED: 0, SUBMITTED: 0, DONE: 0 };
    scoped.forEach((a) => { if (c[a.status] !== undefined) c[a.status] += 1; });
    return c;
  }, [scoped]);

  const assignments = useMemo(
    () => (status === 'All' ? scoped : scoped.filter((a) => a.status === status)),
    [scoped, status]
  );

  // Grouped by the day the work was assigned, newest day first.
  const byDate = useMemo(() => {
    const map = new Map();
    assignments.forEach((a) => {
      const day = String(a.createdAt || '').slice(0, 10);
      if (!map.has(day)) map.set(day, []);
      map.get(day).push(a);
    });
    return [...map.entries()].sort((x, y) => (x[0] < y[0] ? 1 : -1));
  }, [assignments]);

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ['team-work'] });
    qc.invalidateQueries({ queryKey: ['notifications'] });
  };
  const filtering = !!search.trim() || !!orgFilter || !!userFilter || !!urgencyFilter || status !== 'All';

  return (
    <div>
      <PageHeader
        title="Team Work"
        subtitle="Work you've handed out across your institutions, and the completion requests waiting on your approval."
        actions={canWrite && <Button onClick={() => setAssigning(true)}><Plus className="h-4 w-4" /> Assign work</Button>}
      />

      {/* Click a tile to filter by that status */}
      <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
        {Object.entries(STATUS_META).map(([key, m]) => (
          <Card key={key} role="button" tabIndex={0}
            onClick={() => setStatus(status === key ? 'All' : key)}
            onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setStatus(status === key ? 'All' : key); } }}
            className={cn('cursor-pointer p-4 transition hover:-translate-y-0.5', status === key && 'ring-2 ring-brand-500/40')}>
            <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">{m.label}</p>
            <p className="mt-1 text-3xl font-extrabold text-slate-800 dark:text-white">{counts[key]}</p>
          </Card>
        ))}
      </div>

      <div className="mb-5 flex flex-col gap-3 lg:flex-row">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 z-10 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <Input placeholder="Search work title, brief or request note…" className="pl-9" value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
        <Select className="lg:w-52" value={orgFilter} onChange={(e) => { setOrgFilter(e.target.value); setUserFilter(''); }} title="Filter by college">
          <option value="">All my colleges</option>
          {orgs.map((o) => <option key={o._id} value={o._id}>{o.name}</option>)}
        </Select>
        <Select className="lg:w-48" value={userFilter} onChange={(e) => setUserFilter(e.target.value)} title="Filter by user">
          <option value="">All users</option>
          {people.map((p) => <option key={p._id} value={p._id}>{p.name}</option>)}
        </Select>
        <Select className="lg:w-40" value={urgencyFilter} onChange={(e) => setUrgencyFilter(e.target.value)} title="Filter by urgency">
          <option value="">All urgencies</option>
          {URGENCIES.map((u) => <option key={u.key} value={u.key}>{u.label}</option>)}
        </Select>
      </div>

      {isLoading ? (
        <div className="space-y-2">{Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-14" />)}</div>
      ) : assignments.length === 0 ? (
        <EmptyState icon={BriefcaseBusiness}
          title={filtering ? 'No work matches these filters' : 'No work assigned yet'}
          description={filtering
            ? 'Try another college, user or status — or clear the search.'
            : 'Assign work to a designer or social handler and it will appear here.'}
          action={canWrite && !filtering && <Button onClick={() => setAssigning(true)}><Plus className="h-4 w-4" /> Assign work</Button>} />
      ) : (
        <Card className="overflow-x-auto">
          <table className="w-full min-w-[900px] text-sm">
            <thead>
              <tr className="border-b border-slate-100 text-left text-xs font-bold uppercase tracking-wide text-slate-400 dark:border-slate-800">
                <th className="px-4 py-3">Work</th>
                <th className="px-3 py-3">Assigned to</th>
                <th className="px-3 py-3">College</th>
                <th className="px-3 py-3">Urgency</th>
                <th className="px-3 py-3">Status</th>
                <th className="px-3 py-3 text-right">Action</th>
              </tr>
            </thead>
            <tbody>
              {byDate.map(([day, rows]) => (
                <Fragment key={day}>
                  <tr className="border-b border-slate-100 bg-slate-50/80 dark:border-slate-800 dark:bg-slate-800/40">
                    <td colSpan={6} className="px-4 py-2 text-xs font-bold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                      {day ? formatDate(day) : 'Date unknown'}
                      <span className="ml-2 font-semibold normal-case text-slate-400">
                        {rows.length} {rows.length === 1 ? 'task' : 'tasks'}
                      </span>
                    </td>
                  </tr>
                  {rows.map((a) => (
                    <tr key={a._id} className="border-b border-slate-100 last:border-0 hover:bg-slate-50 dark:border-slate-800 dark:hover:bg-slate-800/50">
                      <td className="px-4 py-2.5">
                        <p className="max-w-[280px] truncate font-semibold text-slate-800 dark:text-white">{a.title}</p>
                        {a.completionNote && ['SUBMITTED', 'DONE'].includes(a.status) && (
                          <p className="max-w-[280px] truncate text-xs text-slate-400">Request: {a.completionNote}</p>
                        )}
                        {a.reviewNote && a.status !== 'DONE' && (
                          <p className="max-w-[280px] truncate text-xs text-rose-500">Sent back: {a.reviewNote}</p>
                        )}
                      </td>
                      <td className="px-3 py-2.5">
                        <span className="flex items-center gap-2">
                          <Avatar src={a.assignee?.avatar} name={a.assignee?.name} size="sm" />
                          <span className="min-w-0">
                            <span className="block truncate text-xs font-semibold text-slate-700 dark:text-slate-200">{a.assignee?.name || '—'}</span>
                            <span className="block truncate text-[11px] text-slate-400">
                              {a.assigneeType === 'SOCIAL_HANDLER' ? `Social Handler${a.platform ? ` · ${a.platform}` : ''}` : 'Designer'}
                            </span>
                          </span>
                        </span>
                      </td>
                      <td className="px-3 py-2.5 text-xs text-slate-500 dark:text-slate-400">{a.organization?.name || '—'}</td>
                      <td className="px-3 py-2.5">
                        <UrgencyChip urgency={a.urgency} />
                        {!URGENCY_META[a.urgency] && <span className="text-xs text-slate-400">Normal</span>}
                      </td>
                      <td className="px-3 py-2.5"><StatusChip status={a.status} /></td>
                      <td className="px-3 py-2.5 text-right">
                        {a.status === 'SUBMITTED' && canReview ? (
                          <Button size="sm" onClick={() => setReviewing(a)}><ThumbsUp className="h-4 w-4" /> Review</Button>
                        ) : a.status === 'SUBMITTED' ? (
                          <span className="text-xs text-slate-400">With the admin</span>
                        ) : a.status === 'DONE' ? (
                          <span className="text-xs text-slate-400">{a.completedAt ? formatDate(a.completedAt) : '—'}</span>
                        ) : (
                          <span className="text-xs text-slate-400">{timeAgo(a.createdAt)}</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </Fragment>
              ))}
            </tbody>
          </table>
        </Card>
      )}

      {assigning && <AssignModal orgs={orgs} onClose={() => setAssigning(false)} onSaved={() => { setAssigning(false); refresh(); }} />}
      {reviewing && <ReviewModal assignment={reviewing} onClose={() => setReviewing(null)} onSaved={() => { setReviewing(null); refresh(); }} />}
    </div>
  );
}

// The college list here is already limited to the Admin's institutions, and the
// server refuses anything outside them regardless of what is sent.
function AssignModal({ orgs, onClose, onSaved }) {
  const [form, setForm] = useState({
    organization: orgs.length === 1 ? String(orgs[0]._id) : '',
    assigneeType: 'DESIGNER', assigneeIds: [], platform: '', urgency: 'NORMAL', title: '', description: '',
  });
  const [loading, setLoading] = useState(false);

  const { data: usersData } = useQuery({
    queryKey: ['assignable-users', form.organization, form.assigneeType],
    queryFn: () => userApi.list({ role: 'USER' }),
    enabled: !!form.organization,
  });
  const users = usersData?.users || [];

  const candidates = useMemo(() => {
    const list = users.filter((u) => u.role === 'USER' && u.userType === form.assigneeType);
    if (form.assigneeType === 'SOCIAL_HANDLER') {
      // A handler has to be mapped to this college, and to the platform when the
      // work names one — the same rule the server applies.
      return list.filter((u) => (u.handles || []).some((h) => String(h.organization?._id || h.organization) === String(form.organization)
        && (!form.platform || (h.platforms || []).includes(form.platform))));
    }
    return list.filter((u) => String(u.organization?._id || u.organization || '') === String(form.organization));
  }, [users, form.organization, form.assigneeType, form.platform]);

  const submit = async () => {
    if (!form.organization) { toast.error('Choose the college this is for'); return; }
    if (!form.assigneeIds.length) { toast.error('Choose at least one person'); return; }
    if (!form.title.trim()) { toast.error('Add a title'); return; }
    if (form.assigneeType === 'SOCIAL_HANDLER' && !form.platform) { toast.error('Choose a platform for social-handler work'); return; }
    setLoading(true);
    try {
      await workAssignmentApi.create({
        organization: form.organization,
        assigneeIds: form.assigneeIds,
        urgency: form.urgency,
        platform: form.platform,
        title: form.title,
        description: form.description,
      });
      toast.success(form.assigneeIds.length > 1 ? `Work assigned to ${form.assigneeIds.length} people` : 'Work assigned');
      onSaved();
    } catch (err) {
      toast.error(err.response?.data?.message || 'Could not assign that work');
    } finally { setLoading(false); }
  };

  return (
    <Modal open onClose={onClose} title="Assign work" size="lg">
      <div className="space-y-4">
        <Select label="College" value={form.organization}
          onChange={(e) => setForm({ ...form, organization: e.target.value, assigneeIds: [] })}>
          <option value="">— Select college —</option>
          {orgs.map((o) => <option key={o._id} value={o._id}>{o.name}</option>)}
        </Select>

        <div>
          <span className="mb-1.5 block text-sm font-medium text-slate-600 dark:text-slate-300">Assign to</span>
          <div className="grid gap-3 sm:grid-cols-2">
            {[
              { key: 'DESIGNER', label: 'Designer', icon: Palette, hint: 'Creative and production work' },
              { key: 'SOCIAL_HANDLER', label: 'Social Handler', icon: Send, hint: 'Platform-specific publishing' },
            ].map((t) => {
              const Icon = t.icon;
              const active = form.assigneeType === t.key;
              return (
                <button key={t.key} type="button"
                  onClick={() => setForm({ ...form, assigneeType: t.key, assigneeIds: [], platform: '' })}
                  className={cn('rounded-2xl border-2 p-4 text-left transition',
                    active ? 'border-brand-500 bg-brand-50/60 dark:bg-brand-500/10' : 'border-slate-200 hover:border-brand-300 dark:border-slate-700')}>
                  <Icon className={cn('h-5 w-5', active ? 'text-brand-600 dark:text-brand-400' : 'text-slate-400')} />
                  <p className="mt-2 text-sm font-bold text-slate-800 dark:text-white">{t.label}</p>
                  <p className="mt-0.5 text-xs text-slate-400">{t.hint}</p>
                </button>
              );
            })}
          </div>
        </div>

        {form.assigneeType === 'SOCIAL_HANDLER' && (
          <Select label="Platform" value={form.platform}
            onChange={(e) => setForm({ ...form, platform: e.target.value, assigneeIds: [] })}>
            <option value="">— Select the platform —</option>
            {PLATFORMS.map((p) => <option key={p} value={p}>{p}</option>)}
          </Select>
        )}

        <div>
          <div className="mb-1.5 flex items-end justify-between gap-3">
            <span className="text-sm font-medium text-slate-600 dark:text-slate-300">
              {form.assigneeType === 'SOCIAL_HANDLER' ? 'Social handlers' : 'Designers'}
              <span className="font-normal text-slate-400"> · pick one or more</span>
            </span>
            {candidates.length > 0 && (
              <button type="button"
                onClick={() => setForm((f) => ({
                  ...f,
                  assigneeIds: f.assigneeIds.length === candidates.length ? [] : candidates.map((c) => c._id),
                }))}
                className="text-xs font-semibold text-brand-600 hover:underline dark:text-brand-400">
                {form.assigneeIds.length === candidates.length ? 'Clear all' : 'Select all'}
              </button>
            )}
          </div>
          {!form.organization ? (
            <p className="rounded-xl border border-dashed border-slate-200 p-4 text-sm text-slate-400 dark:border-slate-700">
              Choose a college first to see who you can assign.
            </p>
          ) : candidates.length === 0 ? (
            <p className="rounded-xl border border-dashed border-slate-200 p-4 text-sm text-slate-400 dark:border-slate-700">
              {form.assigneeType === 'SOCIAL_HANDLER'
                ? 'No social handlers are mapped to this college and platform.'
                : 'No designers belong to this college yet.'}
            </p>
          ) : (
            <div className="max-h-52 space-y-1 overflow-y-auto rounded-xl border border-slate-200 p-1.5 dark:border-slate-700">
              {candidates.map((u) => {
                const checked = form.assigneeIds.includes(u._id);
                return (
                  <label key={u._id}
                    className={cn('flex cursor-pointer items-center gap-3 rounded-lg px-2.5 py-2 transition-colors',
                      checked ? 'bg-brand-50 dark:bg-brand-500/10' : 'hover:bg-slate-50 dark:hover:bg-slate-800')}>
                    <input type="checkbox" checked={checked} className="h-4 w-4 shrink-0 cursor-pointer accent-brand-600"
                      onChange={() => setForm((f) => ({
                        ...f,
                        assigneeIds: checked ? f.assigneeIds.filter((id) => id !== u._id) : [...f.assigneeIds, u._id],
                      }))} />
                    <span className="min-w-0">
                      <span className="block truncate text-sm font-semibold text-slate-700 dark:text-slate-200">{u.name}</span>
                      <span className="block truncate text-xs text-slate-400">{u.jobTitle || u.email}</span>
                    </span>
                  </label>
                );
              })}
            </div>
          )}
        </div>

        <div>
          <span className="mb-1.5 block text-sm font-medium text-slate-600 dark:text-slate-300">Urgency</span>
          <div className="flex flex-wrap gap-2">
            {URGENCIES.map((u) => (
              <button key={u.key} type="button" onClick={() => setForm({ ...form, urgency: u.key })}
                className={cn('rounded-xl border-2 px-3 py-2 text-sm font-semibold transition',
                  form.urgency === u.key
                    ? 'border-brand-500 bg-brand-50/60 text-brand-700 dark:bg-brand-500/10 dark:text-brand-300'
                    : 'border-slate-200 text-slate-500 hover:bg-slate-50 dark:border-slate-700 dark:hover:bg-slate-800')}>
                {u.label}
              </button>
            ))}
          </div>
          <p className="mt-1.5 text-xs text-slate-400">Shown to the assignee so they know what to pick up first.</p>
        </div>

        <Input label="Work title" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })}
          placeholder="e.g. Create placement story carousel" />
        <textarea className="input-base min-h-[90px]" placeholder="A short brief for whoever picks this up"
          value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />

        <div className="flex items-center justify-end gap-2 pt-2">
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button loading={loading} onClick={submit}><BriefcaseBusiness className="h-4 w-4" /> Assign work</Button>
        </div>
      </div>
    </Modal>
  );
}

// Approving is what marks the work complete; sending it back returns it to the
// assignee with a reason.
function ReviewModal({ assignment, onClose, onSaved }) {
  const [mode, setMode] = useState(null); // null | 'reject'
  const [note, setNote] = useState('');
  const mutation = useMutation({
    mutationFn: (action) => workAssignmentApi.review(assignment._id, action, note),
    onSuccess: (_d, action) => { toast.success(action === 'approve' ? 'Work marked complete' : 'Sent back to the assignee'); onSaved(); },
    onError: (e) => toast.error(e.response?.data?.message || 'Could not save that'),
  });

  return (
    <Modal open onClose={onClose} title="Completion request" size="md">
      <div className="space-y-4">
        <div className="rounded-xl bg-slate-50 p-3 dark:bg-slate-800/60">
          <p className="font-semibold text-slate-800 dark:text-white">{assignment.title}</p>
          <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
            {assignment.assignee?.name}
            {assignment.organization?.name ? ` · ${assignment.organization.name}` : ''}
            {assignment.submittedAt ? ` · asked ${timeAgo(assignment.submittedAt)}` : ''}
          </p>
        </div>
        {assignment.completionNote && (
          <p className="rounded-xl border border-slate-200 p-3 text-sm text-slate-600 dark:border-slate-700 dark:text-slate-300">
            {assignment.completionNote}
          </p>
        )}

        {mode === 'reject' ? (
          <div>
            <label className="mb-1.5 flex items-center gap-1.5 text-sm font-medium text-slate-600 dark:text-slate-300">
              <MessageSquareWarning className="h-4 w-4 text-rose-500" /> What still needs doing?
            </label>
            <textarea className="input-base min-h-[90px]" value={note} onChange={(e) => setNote(e.target.value)}
              placeholder="They see this, so be specific" />
          </div>
        ) : (
          <p className="text-xs text-slate-400">
            Approving marks this work completed and tells the assignee. Sending it back reopens it with your note.
          </p>
        )}

        <div className="flex items-center justify-end gap-2 pt-2">
          <Button variant="outline" onClick={mode === 'reject' ? () => setMode(null) : onClose}>
            {mode === 'reject' ? 'Back' : 'Cancel'}
          </Button>
          {mode === 'reject' ? (
            <Button variant="danger" loading={mutation.isPending}
              onClick={() => { if (!note.trim()) { toast.error('Add a note so they know what to change'); return; } mutation.mutate('reject'); }}>
              Send back
            </Button>
          ) : (
            <>
              <Button variant="outline" onClick={() => setMode('reject')}>Send back</Button>
              <Button loading={mutation.isPending} onClick={() => mutation.mutate('approve')}>
                <ThumbsUp className="h-4 w-4" /> Approve &amp; mark complete
              </Button>
            </>
          )}
        </div>
      </div>
    </Modal>
  );
}
