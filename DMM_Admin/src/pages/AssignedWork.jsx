import { Fragment, useMemo, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useSearchParams } from 'react-router-dom';
import toast from 'react-hot-toast';
import {
  BriefcaseBusiness, Search, Circle, Clock3, Send, CheckCircle2, MessageSquareWarning, ThumbsUp, X,
  UserRoundCog, Flame, Share2, UserRound,
} from 'lucide-react';
import { workAssignmentApi, organizationApi, userApi, institutionRequestApi } from '../api/endpoints.js';
import PageHeader from '../components/layout/PageHeader.jsx';
import WorkAssignmentModal from '../components/approvals/WorkAssignmentModal.jsx';
import { Modal } from '../components/ui/Modal.jsx';
import { Button } from '../components/ui/Button.jsx';
import { Card, Input, Select, Skeleton, EmptyState, Avatar } from '../components/ui/primitives.jsx';
import ViewToggle, { useViewMode } from '../components/ui/ViewToggle.jsx';
import { cn, formatDate, timeAgo } from '../lib/utils.js';
import { useAuthStore } from '../store/authStore.js';

const STATUS_META = {
  OPEN: { label: 'Open', icon: Circle, cls: 'bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-400' },
  ACKNOWLEDGED: { label: 'In progress', icon: Clock3, cls: 'bg-sky-100 text-sky-700 dark:bg-sky-500/15 dark:text-sky-300' },
  SUBMITTED: { label: 'Awaiting approval', icon: Send, cls: 'bg-violet-100 text-violet-700 dark:bg-violet-500/15 dark:text-violet-300' },
  DONE: { label: 'Completed', icon: CheckCircle2, cls: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-400' },
};

// How the assignee should prioritise this. NORMAL is the default and stays
// unlabelled so the badges that matter stand out.
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

// Work raised to PUBLISH something already approved is still OPEN underneath —
// the handler does it and completes it like anything else — but "open" hides
// what is actually being waited on, so it is named for what it is.
const AWAITING_POSTING = {
  label: 'Awaiting posting', icon: Send,
  cls: 'bg-indigo-100 text-indigo-700 dark:bg-indigo-500/15 dark:text-indigo-300',
};

// Where finished work can still go. A designer's output is raw material: it gets
// published or handed back to whoever asked for it. A social handler's output IS
// the publishing, so approving it is the end — there is nowhere further to send
// it, and offering to route it again is a decision with no answer.
const canHandOff = (a) => a?.status === 'DONE' && !a?.handoff && a?.assigneeType !== 'SOCIAL_HANDLER';

const StatusChip = ({ status, posting = false }) => {
  const m = (posting && status === 'OPEN') ? AWAITING_POSTING : (STATUS_META[status] || STATUS_META.OPEN);
  const Icon = m.icon;
  return (
    <span className={cn('inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2.5 py-1 text-xs font-semibold', m.cls)}>
      <Icon className="h-3.5 w-3.5" /> {m.label}
    </span>
  );
};

/**
 * Every piece of work ever assigned, with its status and any pending completion
 * request. Filters mirror the Brand Library row: search, college, and — in place
 * of categories — the person it's assigned to.
 */
export default function AssignedWork() {
  const qc = useQueryClient();
  const me = useAuthStore((s) => s.user);
  const canReview = !me?.viewOnly;
  const [params, setParams] = useSearchParams();
  // A WORK_SUBMITTED notification links here with ?assignment=<id> so the row it
  // refers to can be highlighted.
  const highlightId = params.get('assignment') || '';

  const [search, setSearch] = useState('');
  const [orgFilter, setOrgFilter] = useState('');
  // Date window on when the work was assigned; both blank = everything to date.
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [userFilter, setUserFilter] = useState('');
  const [urgencyFilter, setUrgencyFilter] = useState('');
  const [status, setStatus] = useState('All');
  const [view, setView] = useViewMode('assigned-work');
  const [reviewing, setReviewing] = useState(null);
  const [reassigning, setReassigning] = useState(null);
  const [allocating, setAllocating] = useState(false);
  const [handingOff, setHandingOff] = useState(null);

  const { data: orgData } = useQuery({
    queryKey: ['org-options', 'mine'],
    queryFn: () => organizationApi.options({ scope: 'mine' }),
  });
  const orgs = orgData?.organizations || [];

  // Requests the Admin or super admin approved are parked in GETTING_ALLOCATED
  // until someone hands the work out. The count sits on the button so the queue
  // is visible without opening it.
  const { data: pendingAllocation } = useQuery({
    queryKey: ['requests-awaiting-allocation'],
    queryFn: () => institutionRequestApi.list({ status: 'GETTING_ALLOCATED' }),
  });
  const awaitingAllocation = pendingAllocation?.requests?.length || 0;

  // The status tile is deliberately NOT sent to the server: the tiles count out
  // of this response, so asking the server for one status would leave the other
  // three tiles reading zero. Status is applied below, after the counts.
  const { data, isLoading } = useQuery({
    queryKey: ['assigned-work', { search, orgFilter, from, to, urgencyFilter }],
    queryFn: () => workAssignmentApi.list({
      search: search || undefined,
      organization: orgFilter || undefined,
      urgency: urgencyFilter || undefined,
      from: from || undefined,
      to: to || undefined,
    }),
  });
  const all = data?.assignments || [];

  // The people dropdown is built from who actually has work in the current
  // college/search view, so it never offers a name with nothing behind it.
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

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ['assigned-work'] });
    qc.invalidateQueries({ queryKey: ['notifications'] });
    qc.invalidateQueries({ queryKey: ['requests-awaiting-allocation'] });
  };
  const filtering = !!search.trim() || !!orgFilter || !!userFilter || !!urgencyFilter || status !== 'All' || !!from || !!to;

  // Segregate by the day the work was assigned, newest day first.
  const byDate = useMemo(() => {
    const map = new Map();
    assignments.forEach((a) => {
      const day = String(a.createdAt || '').slice(0, 10);
      if (!map.has(day)) map.set(day, []);
      map.get(day).push(a);
    });
    return [...map.entries()].sort((x, y) => (x[0] < y[0] ? 1 : -1));
  }, [assignments]);

  return (
    <div>
      <PageHeader
        title="Assigned Work"
        subtitle="Every task assigned to date, its status, and the completion requests waiting on your approval."
        actions={canReview && (
          <Button onClick={() => setAllocating(true)}>
            <BriefcaseBusiness className="h-4 w-4" /> Work Allocation
            {awaitingAllocation > 0 && (
              <span className="ml-1 rounded-full bg-white/25 px-1.5 py-0.5 text-[11px] font-bold">{awaitingAllocation}</span>
            )}
          </Button>
        )}
      />

      {/* Status summary — click a tile to filter by it */}
      <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
        {Object.entries(STATUS_META).map(([key, m]) => (
          <Card key={key} role="button" tabIndex={0}
            onClick={() => setStatus(status === key ? 'All' : key)}
            onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setStatus(status === key ? 'All' : key); } }}
            className={cn('cursor-pointer p-4 transition hover:-translate-y-0.5 hover:shadow-glow', status === key && 'ring-2 ring-brand-500/40')}>
            <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">{m.label}</p>
            <p className="mt-1 text-3xl font-extrabold text-slate-800 dark:text-white">{counts[key]}</p>
          </Card>
        ))}
      </div>

      {/* Filters + view toggle — same row as the Brand Library */}
      <div className="mb-5 flex flex-col gap-3 lg:flex-row">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 z-10 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <Input placeholder="Search work title, brief or request note…" className="pl-9" value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
        <Select className="lg:w-52" value={orgFilter} onChange={(e) => { setOrgFilter(e.target.value); setUserFilter(''); }} title="Filter by college">
          <option value="">All colleges</option>
          {orgs.map((o) => <option key={o._id} value={o._id}>{o.name}</option>)}
        </Select>
        <Select className="lg:w-52" value={userFilter} onChange={(e) => setUserFilter(e.target.value)} title="Filter by user">
          <option value="">All users</option>
          {people.map((p) => <option key={p._id} value={p._id}>{p.name}</option>)}
        </Select>
        <Select className="lg:w-44" value={urgencyFilter} onChange={(e) => setUrgencyFilter(e.target.value)} title="Filter by urgency">
          <option value="">All urgencies</option>
          {['URGENT', 'HIGH', 'NORMAL', 'LOW'].map((u) => <option key={u} value={u}>{u.charAt(0) + u.slice(1).toLowerCase()}</option>)}
        </Select>
        <ViewToggle view={view} onChange={setView} />
      </div>

      {/* Date segregation — the window in which the work was assigned */}
      <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-end">
        <Input label="Assigned from" type="date" className="sm:w-auto" value={from} onChange={(e) => setFrom(e.target.value)} />
        <Input label="Assigned to" type="date" className="sm:w-auto" min={from || undefined} value={to} onChange={(e) => setTo(e.target.value)} />
        <div className="flex gap-2">
          {[{ label: 'Last 7 days', days: 6 }, { label: 'Last 30 days', days: 29 }].map((p) => (
            <button key={p.label} type="button"
              onClick={() => {
                const end = new Date();
                const start = new Date(end.getTime() - p.days * 86400000);
                setFrom(start.toISOString().slice(0, 10));
                setTo(end.toISOString().slice(0, 10));
              }}
              className="h-11 rounded-xl border border-slate-200 px-3 text-sm font-semibold text-slate-600 transition-colors hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800">
              {p.label}
            </button>
          ))}
          {(from || to) && (
            <button type="button" onClick={() => { setFrom(''); setTo(''); }}
              className="h-11 rounded-xl border border-slate-200 px-3 text-sm font-semibold text-slate-500 transition-colors hover:bg-slate-50 dark:border-slate-700 dark:hover:bg-slate-800">
              All dates
            </button>
          )}
        </div>
      </div>

      {highlightId && (
        <div className="mb-4 flex items-center gap-2 rounded-xl border border-brand-200 bg-brand-50/70 px-3 py-2 text-sm text-brand-800 dark:border-brand-500/30 dark:bg-brand-500/10 dark:text-brand-300">
          Showing the assignment from your notification.
          <button onClick={() => setParams({}, { replace: true })} className="ml-auto rounded-lg p-1 hover:bg-brand-100 dark:hover:bg-brand-500/20" aria-label="Clear highlight">
            <X className="h-4 w-4" />
          </button>
        </div>
      )}

      {isLoading ? (
        view === 'grid' ? (
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">{Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-40" />)}</div>
        ) : (
          <div className="space-y-2">{Array.from({ length: 8 }).map((_, i) => <Skeleton key={i} className="h-14" />)}</div>
        )
      ) : assignments.length === 0 ? (
        <EmptyState icon={BriefcaseBusiness}
          title={filtering ? 'No work matches these filters' : 'No work assigned yet'}
          description={filtering ? 'Try another college, user or status — or clear the search.' : 'Use Work Allocation above to hand out an approved request, and it will appear here.'} />
      ) : view === 'grid' ? (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {assignments.map((a) => (
            <Card key={a._id} className={cn('p-5', String(a._id) === highlightId && 'ring-2 ring-brand-500/50')}>
              <div className="mb-2 flex items-start justify-between gap-2">
                <h3 className="font-bold leading-snug text-slate-800 dark:text-white">{a.title}</h3>
                <span className="flex shrink-0 flex-col items-end gap-1">
                  <StatusChip status={a.status} posting={!!(a.postingFor || a.sourceApproval)} />
                  <UrgencyChip urgency={a.urgency} />
                </span>
              </div>
              <div className="flex items-center gap-2 text-xs text-slate-400">
                <Avatar src={a.assignee?.avatar} name={a.assignee?.name} size="sm" />
                <span className="min-w-0 truncate">
                  {a.assignee?.name}
                  {a.organization?.name ? ` · ${a.organization.name}` : ''}
                  {a.platform ? ` · ${a.platform}` : ''}
                </span>
              </div>
              <p className="mt-2 text-xs text-slate-400">Assigned {timeAgo(a.createdAt)}{a.createdBy?.name ? ` by ${a.createdBy.name}` : ''}</p>
              {a.reassignedAt && <p className="text-xs text-slate-400">Reassigned {timeAgo(a.reassignedAt)}</p>}
              {a.completionNote && ['SUBMITTED', 'DONE'].includes(a.status) && (
                <p className="mt-3 rounded-xl border border-slate-100 px-3 py-2 text-xs text-slate-500 dark:border-slate-800 dark:text-slate-400">
                  <span className="font-semibold">Request:</span> {a.completionNote}
                </p>
              )}
              {a.handoff && <HandoffNote assignment={a} />}

              {canReview && (
                <div className="mt-3 flex flex-wrap gap-2">
                  {a.status === 'SUBMITTED' && (
                    <Button size="sm" onClick={() => setReviewing(a)}><ThumbsUp className="h-4 w-4" /> Review request</Button>
                  )}
                  {a.status !== 'DONE' && me?.isSuperAdmin && (
                    <Button size="sm" variant="outline" onClick={() => setReassigning(a)}>
                      <UserRoundCog className="h-4 w-4" /> Reassign
                    </Button>
                  )}
                  {/* A designer's approved work still has to go somewhere:
                      published, or back to whoever asked for it. */}
                  {canHandOff(a) && (
                    <Button size="sm" onClick={() => setHandingOff(a)}>
                      <Share2 className="h-4 w-4" /> Send onward
                    </Button>
                  )}
                </div>
              )}
            </Card>
          ))}
        </div>
      ) : (
        <Card className="overflow-x-auto">
          <table className="w-full min-w-[960px] text-sm">
            <thead>
              <tr className="border-b border-slate-100 text-left text-xs font-bold uppercase tracking-wide text-slate-400 dark:border-slate-800">
                <th className="px-4 py-3">Work</th>
                <th className="px-3 py-3">Assigned to</th>
                <th className="px-3 py-3">College</th>
                <th className="px-3 py-3">Platform</th>
                <th className="px-3 py-3">Assigned</th>
                <th className="px-3 py-3">Urgency</th>
                <th className="px-3 py-3">Status</th>
                <th className="px-3 py-3 text-right">Action</th>
              </tr>
            </thead>
            <tbody>
              {byDate.map(([day, rows]) => (
                <Fragment key={day}>
                  {/* One header per day the work was assigned */}
                  <tr className="border-b border-slate-100 bg-slate-50/80 dark:border-slate-800 dark:bg-slate-800/40">
                    <td colSpan={8} className="px-4 py-2 text-xs font-bold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                      {day ? formatDate(day) : 'Date unknown'}
                      <span className="ml-2 font-semibold normal-case text-slate-400">
                        {rows.length} {rows.length === 1 ? 'task' : 'tasks'}
                      </span>
                    </td>
                  </tr>
                  {rows.map((a) => (
                <tr key={a._id} className={cn('border-b border-slate-100 last:border-0 hover:bg-slate-50 dark:border-slate-800 dark:hover:bg-slate-800/50',
                  String(a._id) === highlightId && 'bg-brand-50/60 dark:bg-brand-500/10')}>
                  <td className="px-4 py-2.5">
                    <p className="max-w-[300px] truncate font-semibold text-slate-800 dark:text-white">{a.title}</p>
                    {a.completionNote && ['SUBMITTED', 'DONE'].includes(a.status) && (
                      <p className="max-w-[300px] truncate text-xs text-slate-400">Request: {a.completionNote}</p>
                    )}
                    {a.reviewNote && a.status !== 'DONE' && (
                      <p className="max-w-[300px] truncate text-xs text-rose-500">Sent back: {a.reviewNote}</p>
                    )}
                  </td>
                  <td className="px-3 py-2.5">
                    <span className="flex items-center gap-2">
                      <Avatar src={a.assignee?.avatar} name={a.assignee?.name} size="sm" />
                      <span className="min-w-0">
                        <span className="block truncate text-xs font-semibold text-slate-700 dark:text-slate-200">{a.assignee?.name || '—'}</span>
                        <span className="block truncate text-[11px] text-slate-400">{a.assigneeType === 'SOCIAL_HANDLER' ? 'Social Handler' : 'Designer'}</span>
                      </span>
                    </span>
                  </td>
                  <td className="px-3 py-2.5 text-xs text-slate-500 dark:text-slate-400">{a.organization?.name || '—'}</td>
                  <td className="px-3 py-2.5 text-xs text-slate-500 dark:text-slate-400">{a.platform || 'General'}</td>
                  <td className="whitespace-nowrap px-3 py-2.5 text-xs text-slate-500 dark:text-slate-400">{formatDate(a.createdAt)}</td>
                  <td className="px-3 py-2.5">
                    <UrgencyChip urgency={a.urgency} />
                    {!URGENCY_META[a.urgency] && <span className="text-xs text-slate-400">Normal</span>}
                  </td>
                  <td className="px-3 py-2.5"><StatusChip status={a.status} posting={!!(a.postingFor || a.sourceApproval)} /></td>
                  <td className="px-3 py-2.5 text-right">
                    <span className="inline-flex items-center justify-end gap-2">
                      {a.status !== 'DONE' && canReview && me?.isSuperAdmin && (
                        <Button size="sm" variant="outline" onClick={() => setReassigning(a)} title="Move this work to someone else">
                          <UserRoundCog className="h-4 w-4" /> Reassign
                        </Button>
                      )}
                    {a.status === 'SUBMITTED' && canReview ? (
                      <Button size="sm" onClick={() => setReviewing(a)}><ThumbsUp className="h-4 w-4" /> Review</Button>
                    ) : a.status === 'DONE' ? (
                      canReview && canHandOff(a) ? (
                        <Button size="sm" onClick={() => setHandingOff(a)} title="Send it to a handler to post, or back to the coordinator">
                          <Share2 className="h-4 w-4" /> Send onward
                        </Button>
                      ) : (
                        <span className="text-xs text-slate-400">
                          {a.handoff === 'COORDINATOR' ? `Delivered to ${a.deliveredTo?.name || 'coordinator'}`
                            : a.handoff === 'SOCIAL_HANDLER' ? 'Sent to post'
                              : a.assigneeType === 'SOCIAL_HANDLER' ? 'Published'
                                : a.completedAt ? formatDate(a.completedAt) : '—'}
                        </span>
                      )
                    ) : null}
                    </span>
                  </td>
                </tr>
                  ))}
                </Fragment>
              ))}
            </tbody>
          </table>
        </Card>
      )}

      {reviewing && (
        <ReviewModal
          assignment={reviewing}
          onClose={() => setReviewing(null)}
          // For a designer's work, approving is the moment the question "so where
          // does this go?" comes up, so the routing step follows straight on.
          // A social handler's work is the last step — they publish it — so
          // approving it finishes the job and asking where to send it next would
          // just be a second decision with no answer.
          onSaved={(action) => {
            const approved = reviewing;
            setReviewing(null);
            refresh();
            if (action === 'approve' && canHandOff(approved)) setHandingOff(approved);
          }}
        />
      )}
      {reassigning && (
        <ReassignModal assignment={reassigning} onClose={() => setReassigning(null)} onSaved={() => { setReassigning(null); refresh(); }} />
      )}
      {allocating && (
        <WorkAssignmentModal onClose={() => setAllocating(false)} onSaved={() => { setAllocating(false); refresh(); }} />
      )}
      {handingOff && (
        <HandoffModal assignment={handingOff} onClose={() => setHandingOff(null)} onSaved={() => { setHandingOff(null); refresh(); }} />
      )}
    </div>
  );
}

// Where finished work ended up. Completion is not the end of the story — the
// point of the work was either to publish it or to give it to the person who
// asked, so the row says which happened.
// The finished files, previewed when they are images and listed as openable
// tiles when they are not.
function AttachmentList({ files, label }) {
  const list = Array.isArray(files) ? files : [];
  if (!list.length) return null;
  const isImage = (a) => a?.mediaType === 'image' || /\.(png|jpe?g|webp|gif|svg|avif)$/i.test(a?.url || a?.name || '');
  const images = list.filter(isImage);
  const others = list.filter((a) => !isImage(a));
  return (
    <div>
      <p className="mb-2 text-[11px] font-bold uppercase tracking-wide text-slate-400">{label} · {list.length}</p>
      {images.length > 0 && (
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          {images.map((a, i) => (
            <a key={a.url || i} href={a.url} target="_blank" rel="noreferrer" title={a.name || 'Open full size'}
              className="group block overflow-hidden rounded-lg border border-slate-200 dark:border-slate-700">
              <img src={a.url} alt={a.name || `File ${i + 1}`} className="aspect-video w-full object-cover transition-transform group-hover:scale-105" />
            </a>
          ))}
        </div>
      )}
      {others.map((a, i) => (
        <a key={a.url || i} href={a.url} target="_blank" rel="noreferrer"
          className="mt-2 flex items-center gap-2 rounded-lg border border-slate-200 px-3 py-2 text-sm font-medium text-slate-600 hover:border-brand-300 dark:border-slate-700 dark:text-slate-300">
          <span className="min-w-0 flex-1 truncate">{a.name || 'Attachment'}</span>
        </a>
      ))}
    </div>
  );
}

function HandoffNote({ assignment: a }) {
  const posted = a.handoff === 'SOCIAL_HANDLER';
  const count = a.handoffAssignments?.length || 0;
  return (
    <p className="mt-3 rounded-xl border border-emerald-100 bg-emerald-50/60 px-3 py-2 text-xs text-emerald-700 dark:border-emerald-500/20 dark:bg-emerald-500/10 dark:text-emerald-300">
      {posted
        ? `Sent to ${count || 'a'} social handler${count === 1 ? '' : 's'} to post`
        : `Delivered to ${a.deliveredTo?.name || 'the coordinator who raised it'}`}
      {a.handoffBy?.name ? ` by ${a.handoffBy.name}` : ''}
      {a.handoffAt ? ` · ${timeAgo(a.handoffAt)}` : ''}
      {a.handoffNote ? ` — ${a.handoffNote}` : ''}
    </p>
  );
}

// Signed-off work goes one of two ways. Posting it is new work for a handler, so
// it becomes their own assignment; handing it back to the coordinator ends the
// chain there and then.
function HandoffModal({ assignment, onClose, onSaved }) {
  const [target, setTarget] = useState('');
  const [platform, setPlatform] = useState(assignment.platform || '');
  const [handlerIds, setHandlerIds] = useState([]);
  const [note, setNote] = useState('');
  const [linkRequest, setLinkRequest] = useState('');
  const orgId = assignment.organization?._id || assignment.organization;

  const { data, isLoading } = useQuery({
    queryKey: ['handoff-handlers', orgId],
    queryFn: () => userApi.list({ role: 'USER' }),
    enabled: target === 'SOCIAL_HANDLER',
  });

  // Work allocated without picking a request off the queue carries no idea which
  // college ask it serves, so nobody downstream can see what was wanted. It can
  // be attached here instead of stranding whoever receives it.
  const needsRequestLink = !assignment.sourceRequest;
  const { data: reqData } = useQuery({
    queryKey: ['handoff-linkable-requests', orgId],
    queryFn: () => institutionRequestApi.list({ organizationId: orgId }),
    enabled: needsRequestLink,
  });
  const linkable = (reqData?.requests || []).filter((r) => ['GETTING_ALLOCATED', 'APPROVED', 'IN_REVIEW'].includes(r.status));

  // A handler publishes to one channel for one college, so both have to match —
  // the same rule the server enforces.
  const handlers = useMemo(() => (data?.users || []).filter((u) => u.role === 'USER'
    && u.userType === 'SOCIAL_HANDLER'
    && (u.handles || []).some((h) => String(h.organization?._id || h.organization) === String(orgId)
      && (!platform || (h.platforms || []).includes(platform)))), [data, orgId, platform]);

  const mutation = useMutation({
    mutationFn: () => workAssignmentApi.handoff(assignment._id, {
      target,
      note,
      ...(linkRequest ? { sourceRequest: linkRequest } : {}),
      ...(target === 'SOCIAL_HANDLER' ? { platform, assigneeIds: handlerIds } : {}),
    }),
    onSuccess: () => {
      toast.success(target === 'SOCIAL_HANDLER' ? 'Sent to the handler(s) to post' : 'Delivered to the coordinator');
      onSaved();
    },
    onError: (e) => toast.error(e.response?.data?.message || 'Could not send this on'),
  });

  const ready = target === 'COORDINATOR' || (target === 'SOCIAL_HANDLER' && platform && handlerIds.length > 0);

  const OPTIONS = [
    { key: 'SOCIAL_HANDLER', label: 'A social handler', icon: Send, hint: 'They publish it on the channel you choose' },
    { key: 'COORDINATOR', label: 'Back to the coordinator', icon: UserRound, hint: 'Hand the finished work to whoever raised the request' },
  ];

  return (
    <Modal open onClose={onClose} title="Where does this work go?" size="lg">
      <div className="space-y-4">
        <div className="rounded-xl bg-slate-50 p-3 text-sm dark:bg-slate-800/60">
          <p className="font-semibold text-slate-800 dark:text-white">{assignment.title}</p>
          <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
            Completed by {assignment.assignee?.name || 'the assignee'}
            {assignment.organization?.name ? ` · ${assignment.organization.name}` : ''}
          </p>
          {assignment.completionNote && (
            <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">
              <span className="font-semibold">They said:</span> {assignment.completionNote}
            </p>
          )}
          <AttachmentList files={assignment.completionAttachments} label="Files that will travel with it" />
        </div>

        {/* Without this link, whoever receives the work cannot see what the
            college actually asked for. */}
        {needsRequestLink && (
          <div className="rounded-xl border border-amber-200 bg-amber-50/70 p-3 dark:border-amber-500/30 dark:bg-amber-500/10">
            <p className="text-sm font-semibold text-amber-800 dark:text-amber-300">
              This work is not linked to a college request
            </p>
            <p className="mt-0.5 text-xs text-amber-700 dark:text-amber-400">
              It was allocated without picking one off the queue, so whoever receives it cannot see what was asked for.
              Attach it now and the full brief travels with the work.
            </p>
            <Select className="mt-2" value={linkRequest} onChange={(e) => setLinkRequest(e.target.value)}>
              <option value="">— No request —</option>
              {linkable.map((r) => (
                <option key={r._id} value={r._id}>{r.title}{r.raisedBy?.name ? ` · ${r.raisedBy.name}` : ''}</option>
              ))}
            </Select>
            {linkable.length === 0 && (
              <p className="mt-1.5 text-xs text-amber-700 dark:text-amber-400">
                No open requests for this college to attach.
              </p>
            )}
          </div>
        )}

        <div className="grid gap-3 sm:grid-cols-2">
          {OPTIONS.map((o) => {
            const Icon = o.icon;
            const active = target === o.key;
            return (
              <button key={o.key} type="button"
                onClick={() => { setTarget(o.key); setHandlerIds([]); }}
                className={cn('rounded-2xl border-2 p-4 text-left transition',
                  active ? 'border-brand-500 bg-brand-50/60 dark:bg-brand-500/10' : 'border-slate-200 hover:border-brand-300 dark:border-slate-700')}>
                <Icon className={cn('h-5 w-5', active ? 'text-brand-600 dark:text-brand-400' : 'text-slate-400')} />
                <p className="mt-2 text-sm font-bold text-slate-800 dark:text-white">{o.label}</p>
                <p className="mt-0.5 text-xs text-slate-400">{o.hint}</p>
              </button>
            );
          })}
        </div>

        {target === 'SOCIAL_HANDLER' && (
          <>
            <Select label="Platform" value={platform} onChange={(e) => { setPlatform(e.target.value); setHandlerIds([]); }}>
              <option value="">— Select the platform —</option>
              {['LinkedIn', 'Instagram', 'YouTube', 'Facebook'].map((p) => <option key={p} value={p}>{p}</option>)}
            </Select>

            <div>
              <span className="mb-1.5 block text-sm font-medium text-slate-600 dark:text-slate-300">
                Social handlers <span className="font-normal text-slate-400">· pick one or more</span>
              </span>
              {!platform ? (
                <p className="rounded-xl border border-dashed border-slate-200 p-4 text-sm text-slate-400 dark:border-slate-700">
                  Choose the platform first to see who can post it.
                </p>
              ) : isLoading ? (
                <Skeleton className="h-20" />
              ) : handlers.length === 0 ? (
                <p className="rounded-xl border border-dashed border-slate-200 p-4 text-sm text-slate-400 dark:border-slate-700">
                  Nobody is mapped to {assignment.organization?.name || 'this college'} for {platform}.
                </p>
              ) : (
                <div className="max-h-48 space-y-1 overflow-y-auto rounded-xl border border-slate-200 p-1.5 dark:border-slate-700">
                  {handlers.map((u) => {
                    const checked = handlerIds.includes(u._id);
                    return (
                      <label key={u._id}
                        className={cn('flex cursor-pointer items-center gap-3 rounded-lg px-2.5 py-2 transition-colors',
                          checked ? 'bg-brand-50 dark:bg-brand-500/10' : 'hover:bg-slate-50 dark:hover:bg-slate-800')}>
                        <input type="checkbox" checked={checked} className="h-4 w-4 shrink-0 cursor-pointer accent-brand-600"
                          onChange={() => setHandlerIds((ids) => checked ? ids.filter((id) => id !== u._id) : [...ids, u._id])} />
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
          </>
        )}

        {target && (
          <label className="block">
            <span className="mb-1.5 block text-sm font-medium text-slate-600 dark:text-slate-300">
              Note <span className="font-normal text-slate-400">· optional</span>
            </span>
            <textarea className="input-base min-h-[80px]" value={note} onChange={(e) => setNote(e.target.value)}
              placeholder={target === 'SOCIAL_HANDLER'
                ? 'e.g. Post it Friday morning, tag the placement cell'
                : 'e.g. Final files are in the shared drive under Placements/2026'} />
          </label>
        )}

        <p className="text-xs text-slate-400">
          {target === 'SOCIAL_HANDLER'
            ? 'Each handler gets their own assignment to complete, carrying what the assignee said they produced.'
            : target === 'COORDINATOR'
              ? 'The coordinator who raised the request is notified that the work is ready.'
              : 'This work is approved and complete — choose what happens to it next.'}
        </p>

        <div className="flex items-center justify-end gap-2 pt-2">
          <Button variant="outline" onClick={onClose}>Not now</Button>
          <Button loading={mutation.isPending} disabled={!ready} onClick={() => mutation.mutate()}>
            <Share2 className="h-4 w-4" /> {target === 'COORDINATOR' ? 'Deliver' : 'Send to post'}
          </Button>
        </div>
      </div>
    </Modal>
  );
}

// Approving is what marks the assignment complete; sending it back returns it to
// the assignee with a reason.
function ReviewModal({ assignment, onClose, onSaved }) {
  const [mode, setMode] = useState(null); // null | 'reject'
  const [note, setNote] = useState('');

  const mut = useMutation({
    mutationFn: (action) => workAssignmentApi.review(assignment._id, action, note),
    onSuccess: (_d, action) => {
      toast.success(action === 'approve' ? 'Approved — the work is marked complete' : 'Sent back to the assignee');
      onSaved(action);
    },
    onError: (e) => toast.error(e.response?.data?.message || 'Could not save that'),
  });

  return (
    <Modal open onClose={onClose} title="Completion request" size="lg">
      <div className="space-y-4">
        <div className="rounded-xl border border-slate-100 bg-slate-50 p-3 dark:border-slate-800 dark:bg-slate-900/60">
          <p className="text-sm font-bold text-slate-800 dark:text-white">{assignment.title}</p>
          <p className="mt-0.5 text-xs text-slate-400">
            {assignment.assignee?.name}
            {assignment.organization?.name ? ` · ${assignment.organization.name}` : ''}
            {assignment.platform ? ` · ${assignment.platform}` : ''}
            {assignment.submittedAt ? ` · requested ${timeAgo(assignment.submittedAt)}` : ''}
          </p>
          {assignment.description && <p className="mt-2 text-sm text-slate-600 dark:text-slate-300">{assignment.description}</p>}
        </div>

        <div>
          <p className="mb-1.5 text-sm font-medium text-slate-600 dark:text-slate-300">What they said they completed</p>
          <p className="rounded-xl border border-slate-100 px-3 py-2.5 text-sm text-slate-700 dark:border-slate-800 dark:text-slate-200">
            {assignment.completionNote || '— no note —'}
          </p>
        </div>

        {/* The files are what is actually being approved, and what a handler
            would go on to publish. */}
        <AttachmentList files={assignment.completionAttachments} label="What they submitted" />
        {!(assignment.completionAttachments || []).length && (
          <p className="text-xs text-amber-600 dark:text-amber-400">
            No files were attached. If this then goes to a social handler, they will have nothing to post.
          </p>
        )}

        {mode === 'reject' ? (
          <div className="space-y-3 rounded-xl border border-rose-200 p-4 dark:border-rose-500/30">
            <label className="block text-sm font-semibold text-slate-700 dark:text-slate-200">What still needs doing?</label>
            <textarea autoFocus className="input-base min-h-[80px]" value={note} onChange={(e) => setNote(e.target.value)}
              placeholder="e.g. The carousel is the wrong size — please export at 1080×1350" />
            <div className="flex gap-2">
              <Button variant="danger" loading={mut.isPending} disabled={!note.trim()} onClick={() => mut.mutate('reject')}>
                <MessageSquareWarning className="h-4 w-4" /> Send back
              </Button>
              <Button variant="ghost" onClick={() => setMode(null)}>Cancel</Button>
            </div>
          </div>
        ) : (
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="success" loading={mut.isPending} onClick={() => mut.mutate('approve')}>
              <CheckCircle2 className="h-4 w-4" /> Approve &amp; mark complete
            </Button>
            <Button variant="outline" onClick={() => setMode('reject')}
              className="border-rose-200 text-rose-600 hover:bg-rose-50 dark:border-rose-500/30 dark:text-rose-400 dark:hover:bg-rose-500/10">
              <MessageSquareWarning className="h-4 w-4" /> Send back
            </Button>
            <Button variant="ghost" className="ml-auto" onClick={onClose}>Close</Button>
          </div>
        )}
      </div>
    </Modal>
  );
}

// Work that has stalled - someone left, went on leave, or is overloaded - moves
// to another person of the same type in the same college. The new person starts
// at OPEN, so they acknowledge it themselves.
function ReassignModal({ assignment, onClose, onSaved }) {
  const [assigneeId, setAssigneeId] = useState('');
  const orgId = assignment.organization?._id || assignment.organization;

  const { data, isLoading } = useQuery({
    queryKey: ['reassign-candidates', orgId, assignment.assigneeType],
    queryFn: () => userApi.list(assignment.assigneeType === 'SOCIAL_HANDLER' ? { role: 'USER' } : { role: 'USER', organization: orgId }),
  });

  const candidates = useMemo(() => {
    const list = (data?.users || []).filter((u) => u.role === 'USER'
      && u.userType === assignment.assigneeType
      && String(u._id) !== String(assignment.assignee?._id || assignment.assignee));
    if (assignment.assigneeType === 'SOCIAL_HANDLER') {
      // A handler must be mapped to this college, and to the platform if the
      // work names one - the same rule the server enforces.
      return list.filter((u) => (u.handles || []).some((h) => String(h.organization?._id || h.organization) === String(orgId)
        && (!assignment.platform || (h.platforms || []).includes(assignment.platform))));
    }
    return list.filter((u) => String(u.organization?._id || u.organization || '') === String(orgId));
  }, [data, assignment, orgId]);

  const mutation = useMutation({
    mutationFn: () => workAssignmentApi.reassign(assignment._id, assigneeId),
    onSuccess: () => { toast.success('Work reassigned'); onSaved(); },
    onError: (e) => toast.error(e.response?.data?.message || 'Could not reassign this work'),
  });

  return (
    <Modal open onClose={onClose} title="Reassign work" size="md">
      <div className="space-y-4">
        <div className="rounded-xl bg-slate-50 p-3 text-sm dark:bg-slate-800/60">
          <p className="font-semibold text-slate-800 dark:text-white">{assignment.title}</p>
          <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
            Currently with {assignment.assignee?.name || 'a removed user'}
            {assignment.organization?.name ? ` · ${assignment.organization.name}` : ''}
            {assignment.platform ? ` · ${assignment.platform}` : ''}
          </p>
        </div>

        <Select label="Move it to" value={assigneeId} onChange={(e) => setAssigneeId(e.target.value)} disabled={isLoading}>
          <option value="">{isLoading ? 'Loading people…' : '— Select a person —'}</option>
          {candidates.map((u) => (
            <option key={u._id} value={u._id}>{u.name}{u.jobTitle ? ` · ${u.jobTitle}` : ''}</option>
          ))}
        </Select>
        {!isLoading && candidates.length === 0 && (
          <p className="text-xs text-slate-400">
            Nobody else in this college matches {assignment.assigneeType === 'SOCIAL_HANDLER' ? 'this platform' : 'this role'}.
          </p>
        )}
        <p className="text-xs text-slate-400">
          Both people are notified. Any progress note is cleared and the work returns to Open for the new assignee to acknowledge.
        </p>

        <div className="flex items-center justify-end gap-2 pt-2">
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button loading={mutation.isPending} disabled={!assigneeId} onClick={() => mutation.mutate()}>
            <UserRoundCog className="h-4 w-4" /> Reassign
          </Button>
        </div>
      </div>
    </Modal>
  );
}
