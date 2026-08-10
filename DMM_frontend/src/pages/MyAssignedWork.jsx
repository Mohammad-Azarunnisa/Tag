import { useMemo, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate, useSearchParams } from 'react-router-dom';
import toast from 'react-hot-toast';
import {
  BriefcaseBusiness, CheckCircle2, Circle, Search, Clock3, Send, MessageSquareWarning, ThumbsUp, Flame, Eye, X,
  Paperclip, ExternalLink, FileImage, CalendarClock, ClipboardList,
} from 'lucide-react';
import { workAssignmentApi, workflowApi } from '../api/endpoints.js';
import PageHeader from '../components/layout/PageHeader.jsx';
import { Modal } from '../components/ui/Modal.jsx';
import { Button } from '../components/ui/Button.jsx';
import { Card, EmptyState, Input, Select, Skeleton } from '../components/ui/primitives.jsx';
import FileDropzone from '../components/ui/FileDropzone.jsx';
import { cn, formatDate, timeAgo } from '../lib/utils.js';

const STATUS_OPTIONS = ['All', 'OPEN', 'ACKNOWLEDGED', 'SUBMITTED', 'DONE'];

// Workflow work this person has acknowledged, as it reads on their own list: the
// stage, and plainly whose move it is. The actions themselves stay on the
// workflow item, so there is one place where each transition is implemented.
const WORKFLOW_STAGE_META = {
  DESIGN_IN_PROGRESS: { label: 'Your move', hint: 'Make the design and send it for approval.', cls: 'bg-sky-100 text-sky-700 dark:bg-sky-500/15 dark:text-sky-300' },
  DESIGN_ADMIN_REVIEW: { label: 'With the Admin', hint: 'Waiting on approval.', cls: 'bg-violet-100 text-violet-700 dark:bg-violet-500/15 dark:text-violet-300' },
  DESIGN_COORDINATOR_REVIEW: { label: 'With the coordinator', hint: 'Approved — the college is confirming it.', cls: 'bg-indigo-100 text-indigo-700 dark:bg-indigo-500/15 dark:text-indigo-300' },
  POST_OPEN: { label: 'Design done', hint: 'Confirmed — waiting for a handler to take the post.', cls: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-400' },
  POST_IN_PROGRESS: { label: 'Your move', hint: 'Write the post content and send it for approval.', cls: 'bg-sky-100 text-sky-700 dark:bg-sky-500/15 dark:text-sky-300' },
  POST_ADMIN_REVIEW: { label: 'With the Admin', hint: 'Waiting on approval.', cls: 'bg-violet-100 text-violet-700 dark:bg-violet-500/15 dark:text-violet-300' },
  POST_COORDINATOR_REVIEW: { label: 'With the coordinator', hint: 'Approved — the college is confirming it.', cls: 'bg-indigo-100 text-indigo-700 dark:bg-indigo-500/15 dark:text-indigo-300' },
  POST_APPROVED: { label: 'Your move', hint: 'Approved — publish or schedule it, then mark it as posted.', cls: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-400' },
  POSTED: { label: 'Posted', hint: '', cls: 'bg-teal-100 text-teal-700 dark:bg-teal-500/15 dark:text-teal-300' },
  COMPLETED: { label: 'Completed', hint: '', cls: 'bg-teal-100 text-teal-700 dark:bg-teal-500/15 dark:text-teal-300' },
};
// Stages where the ball is in this person's court, so they sort to the top.
const WORKFLOW_MY_MOVE = ['DESIGN_IN_PROGRESS', 'POST_IN_PROGRESS', 'POST_APPROVED'];

const STATUS_META = {
  OPEN: { label: 'Open', icon: Circle, cls: 'bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-400' },
  ACKNOWLEDGED: { label: 'In progress', icon: Clock3, cls: 'bg-sky-100 text-sky-700 dark:bg-sky-500/15 dark:text-sky-300' },
  SUBMITTED: { label: 'Awaiting approval', icon: Send, cls: 'bg-violet-100 text-violet-700 dark:bg-violet-500/15 dark:text-violet-300' },
  DONE: { label: 'Completed', icon: CheckCircle2, cls: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-400' },
};

// What to pick up first. NORMAL is the default, so it carries no badge - only
// the ones that change your order are called out.
const URGENCY_META = {
  URGENT: { label: 'Urgent', rank: 0, cls: 'bg-rose-100 text-rose-700 dark:bg-rose-500/15 dark:text-rose-400' },
  HIGH: { label: 'High priority', rank: 1, cls: 'bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-400' },
  NORMAL: { label: 'Normal', rank: 2, cls: '' },
  LOW: { label: 'Low', rank: 3, cls: 'bg-slate-100 text-slate-500 dark:bg-slate-700/50 dark:text-slate-300' },
};

function platformPill(platform) {
  if (!platform) return 'General';
  return platform;
}

// Work raised to PUBLISH something already finished sits in the same OPEN state
// as everything else — the handler still just does it and completes it — but
// calling that "open" hides what is actually being waited on.
const isPostingWork = (a) => !!(a.postingFor || a.sourceApproval);

const statusMetaFor = (a) => {
  // Booked to go out — it closes itself at that time, so it is neither "open"
  // nor waiting on anybody.
  if (a.status !== 'DONE' && a.scheduledAt) {
    return { label: 'Scheduled', icon: Clock3, cls: 'bg-brand-100 text-brand-700 dark:bg-brand-500/15 dark:text-brand-300' };
  }
  if (a.status === 'OPEN' && isPostingWork(a)) {
    return { label: 'Awaiting posting', icon: Send, cls: 'bg-indigo-100 text-indigo-700 dark:bg-indigo-500/15 dark:text-indigo-300' };
  }
  return STATUS_META[a.status] || STATUS_META.OPEN;
};

const attachmentsOf = (r) => (Array.isArray(r?.attachments) ? r.attachments : []);
const isImageAttachment = (a) =>
  a?.mediaType === 'image' || /\.(png|jpe?g|webp|gif|svg|avif)$/i.test(a?.url || a?.name || '');

// Files attached to something, previewed when they are images and listed as
// openable tiles when they are not.
function FileList({ files, label }) {
  const list = Array.isArray(files) ? files : [];
  if (!list.length) return null;
  const images = list.filter(isImageAttachment);
  const others = list.filter((a) => !isImageAttachment(a));
  return (
    <div className="mt-3">
      <p className="mb-2 flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wide text-slate-400">
        <Paperclip className="h-3.5 w-3.5" /> {label} · {list.length}
      </p>
      {images.length > 0 && (
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          {images.map((a, i) => (
            <a key={a.url || i} href={a.url} target="_blank" rel="noreferrer" title={a.name || 'Open full size'}
              className="group relative block overflow-hidden rounded-lg border border-slate-200 dark:border-slate-700">
              <img src={a.url} alt={a.name || `File ${i + 1}`} className="aspect-video w-full object-cover transition-transform group-hover:scale-105" />
            </a>
          ))}
        </div>
      )}
      {others.map((a, i) => (
        <a key={a.url || i} href={a.url} target="_blank" rel="noreferrer"
          className="mt-2 flex items-center gap-2 rounded-lg border border-slate-200 px-3 py-2 text-sm font-medium text-slate-600 transition-colors hover:border-brand-300 hover:bg-brand-50/50 dark:border-slate-700 dark:text-slate-300">
          <FileImage className="h-4 w-4 shrink-0 text-slate-400" />
          <span className="min-w-0 flex-1 truncate">{a.name || 'Attachment'}</span>
          <ExternalLink className="h-3.5 w-3.5 shrink-0 text-slate-400" />
        </a>
      ))}
    </div>
  );
}

const Detail = ({ label, children }) => (
  <div>
    <p className="text-[11px] font-bold uppercase tracking-wide text-slate-400">{label}</p>
    <p className="mt-0.5 text-sm text-slate-700 dark:text-slate-200">{children}</p>
  </div>
);

/**
 * What the college actually asked for, shown to whoever is doing the work.
 *
 * The assignment title is a one-line summary of a request that may carry an
 * event, a deadline and reference files. A handler publishing the result needs
 * the same context the designer had — otherwise they are posting from a headline.
 */
function RequestBrief({ request: r }) {
  const files = attachmentsOf(r);
  const images = files.filter(isImageAttachment);
  const others = files.filter((a) => !isImageAttachment(a));
  const brief = [r.workType === 'DIGITAL_MEDIA' ? 'Digital media' : 'Print media', r.workCategory, r.workItem]
    .filter(Boolean).join(' · ');

  return (
    <div className="rounded-xl border border-brand-100 bg-brand-50/40 p-3 dark:border-brand-500/20 dark:bg-brand-500/[0.07]">
      <p className="mb-2 flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wide text-brand-700 dark:text-brand-300">
        <ClipboardList className="h-3.5 w-3.5" /> The request this came from
      </p>

      <p className="text-sm font-bold text-slate-800 dark:text-white">{r.title}</p>
      <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
        Raised by {r.raisedBy?.name || 'the coordinator'}
        {r.raisedBy?.jobTitle ? ` · ${r.raisedBy.jobTitle}` : ''}
        {r.createdAt ? ` · ${timeAgo(r.createdAt)}` : ''}
      </p>

      {r.details && <p className="mt-2 whitespace-pre-wrap text-sm text-slate-700 dark:text-slate-200">{r.details}</p>}

      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        {brief && <Detail label="Work">{brief}</Detail>}
        {r.department && <Detail label="Department">{r.department}</Detail>}
        {r.priority && r.priority !== 'NORMAL' && (
          <Detail label="Priority">{r.priority.charAt(0) + r.priority.slice(1).toLowerCase()}</Detail>
        )}
        {r.neededBy && <Detail label="Needed by">{formatDate(r.neededBy)}</Detail>}
      </div>

      {r.event && (
        <div className="mt-3 rounded-lg border border-slate-200 p-3 dark:border-slate-700">
          <p className="mb-2 flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wide text-slate-400">
            <CalendarClock className="h-3.5 w-3.5" /> Event
          </p>
          <div className="grid gap-2 sm:grid-cols-2">
            <Detail label="Name">{r.eventName || 'Unnamed event'}</Detail>
            {r.eventDate && <Detail label="Date">{formatDate(r.eventDate)}</Detail>}
            {r.place && <Detail label="Place">{r.place}</Detail>}
            {r.eventCoordinatorName && <Detail label="Coordinator">{r.eventCoordinatorName}</Detail>}
          </div>
        </div>
      )}

      {files.length > 0 && (
        <div className="mt-3">
          <p className="mb-2 flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wide text-slate-400">
            <Paperclip className="h-3.5 w-3.5" /> Reference files · {files.length}
          </p>
          {images.length > 0 && (
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
              {images.map((a, i) => (
                <a key={a.url || i} href={a.url} target="_blank" rel="noreferrer" title={a.name || 'Open full size'}
                  className="group relative block overflow-hidden rounded-lg border border-slate-200 dark:border-slate-700">
                  <img src={a.url} alt={a.name || `Reference ${i + 1}`} className="aspect-video w-full object-cover transition-transform group-hover:scale-105" />
                </a>
              ))}
            </div>
          )}
          {others.map((a, i) => (
            <a key={a.url || i} href={a.url} target="_blank" rel="noreferrer"
              className="mt-2 flex items-center gap-2 rounded-lg border border-slate-200 px-3 py-2 text-sm font-medium text-slate-600 transition-colors hover:border-brand-300 hover:bg-brand-50/50 dark:border-slate-700 dark:text-slate-300">
              <FileImage className="h-4 w-4 shrink-0 text-slate-400" />
              <span className="min-w-0 flex-1 truncate">{a.name || 'Attachment'}</span>
              <ExternalLink className="h-3.5 w-3.5 shrink-0 text-slate-400" />
            </a>
          ))}
        </div>
      )}
    </div>
  );
}

export default function MyAssignedWork() {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  // "Another designer already acknowledged this" links here with ?assignment=<id>,
  // so the card it is talking about is the one that stands out.
  const highlightId = params.get('assignment') || '';
  const [filters, setFilters] = useState({ status: 'All', search: '' });
  // The assignment whose completion request is being written.
  const [requesting, setRequesting] = useState(null);
  const [viewing, setViewing] = useState(null);
  // Publishing work is closed here rather than through a completion request.
  const [posting, setPosting] = useState(null);

  // The whole list comes down once and the status picker narrows it here — the
  // tiles count out of this response, so filtering it server-side would leave
  // every tile but the chosen one reading zero.
  const { data, isLoading } = useQuery({
    queryKey: ['my-assigned-work'],
    queryFn: () => workAssignmentApi.list(),
  });

  // Design and posting work this person has acknowledged in the Workflow boards.
  // It is the same college request all the way through, shown here rather than
  // copied into a second record — so this list can never drift from the board.
  const { data: workflowData } = useQuery({
    queryKey: ['my-workflow-work'],
    queryFn: () => workflowApi.list({ mine: 1 }),
  });
  const workflowItems = workflowData?.items || [];

  const assignments = data?.assignments || [];
  const refresh = () => {
    qc.invalidateQueries({ queryKey: ['my-assigned-work'] });
    qc.invalidateQueries({ queryKey: ['my-workflow-work'] });
    qc.invalidateQueries({ queryKey: ['notifications'] });
  };

  const ackMut = useMutation({
    mutationFn: (id) => workAssignmentApi.acknowledge(id),
    onSuccess: () => { toast.success('Acknowledged — you can send a completion request when you’re done'); refresh(); },
    onError: (e) => toast.error(e.response?.data?.message || 'Could not acknowledge this work'),
  });

  const filtered = useMemo(() => {
    const q = filters.search.trim().toLowerCase();
    const byStatus = filters.status === 'All'
      ? assignments
      : assignments.filter((a) => a.status === filters.status);
    const rows = !q ? [...byStatus] : byStatus.filter((a) => {
      const org = a.organization?.name || '';
      return [a.title, a.description, a.platform, org].some((v) => String(v || '').toLowerCase().includes(q));
    });
    // Urgent work first, then newest - so the order on screen is the order to
    // work in. Anything already completed drops to the bottom, and whatever a
    // notification sent you here to look at comes first of all.
    const rank = (a) => (String(a._id) === highlightId ? -1 : a.status === 'DONE' ? 9 : (URGENCY_META[a.urgency]?.rank ?? 2));
    return rows.sort((x, y) => rank(x) - rank(y) || new Date(y.createdAt) - new Date(x.createdAt));
  }, [assignments, filters.search, filters.status, highlightId]);

  const statusCounts = useMemo(() => {
    const counts = { OPEN: 0, ACKNOWLEDGED: 0, SUBMITTED: 0, DONE: 0 };
    assignments.forEach((a) => {
      if (counts[a.status] !== undefined) counts[a.status] += 1;
    });
    return counts;
  }, [assignments]);

  const tiles = [
    { key: 'OPEN', label: 'Open' },
    { key: 'ACKNOWLEDGED', label: 'In progress' },
    { key: 'SUBMITTED', label: 'Awaiting approval' },
    { key: 'DONE', label: 'Completed' },
  ];

  // The same search box narrows both lists, so one term does not filter half the page.
  const workflowShown = useMemo(() => {
    const q = filters.search.trim().toLowerCase();
    if (!q) return workflowItems;
    return workflowItems.filter((i) => [i.title, i.details, i.organization?.name, i.workCategory]
      .some((v) => String(v || '').toLowerCase().includes(q)));
  }, [workflowItems, filters.search]);

  return (
    <div>
      <PageHeader
        title="My Assigned Work"
        subtitle="Open what you've been given, then either acknowledge it or complete it. Designers acknowledge first; social handlers go straight to completion. Urgent work is listed first."
      />

      <div className="mb-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {tiles.map((t) => (
          <Card key={t.key} className="p-4">
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">{t.label}</p>
            <p className="mt-1 text-2xl font-extrabold text-slate-800 dark:text-white">{statusCounts[t.key]}</p>
          </Card>
        ))}
      </div>

      <div className="mb-5 flex flex-col gap-3 sm:flex-row">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <Input
            placeholder="Search title, organization, platform..."
            className="pl-9"
            value={filters.search}
            onChange={(e) => setFilters((prev) => ({ ...prev, search: e.target.value }))}
          />
        </div>
        <Select
          className="sm:w-52"
          value={filters.status}
          onChange={(e) => setFilters((prev) => ({ ...prev, status: e.target.value }))}
        >
          {STATUS_OPTIONS.map((status) => (
            <option key={status} value={status}>{status === 'All' ? 'All status' : (STATUS_META[status]?.label || status)}</option>
          ))}
        </Select>
      </div>

      {highlightId && (
        <div className="mb-4 flex items-center gap-2 rounded-xl border border-brand-200 bg-brand-50/70 px-3 py-2 text-sm text-brand-800 dark:border-brand-500/30 dark:bg-brand-500/10 dark:text-brand-300">
          Showing the work from your notification.
          <button onClick={() => setParams({}, { replace: true })} className="ml-auto rounded-lg p-1 hover:bg-brand-100 dark:hover:bg-brand-500/20" aria-label="Clear highlight">
            <X className="h-4 w-4" />
          </button>
        </div>
      )}

      {/* Design and posting work picked up in the Workflow boards. It lives on the
          college request itself, so this is the same record the board shows — not
          a copy that could fall out of step with it. */}
      {workflowShown.length > 0 && (
        <div className="mb-6">
          <p className="mb-2 text-[11px] font-bold uppercase tracking-wide text-slate-400">
            Workflow · {workflowShown.length} {workflowShown.length === 1 ? 'item' : 'items'} you acknowledged
          </p>
          <div className="space-y-2">
            {[...workflowShown]
              .sort((a, b) => {
                const mine = (i) => (WORKFLOW_MY_MOVE.includes(i.workflowStage) ? 0 : ['POSTED', 'COMPLETED'].includes(i.workflowStage) ? 2 : 1);
                return mine(a) - mine(b) || new Date(b.updatedAt) - new Date(a.updatedAt);
              })
              .map((i) => {
                const meta = WORKFLOW_STAGE_META[i.workflowStage] || { label: i.workflowStage, hint: '', cls: 'bg-slate-100 text-slate-600' };
                return (
                  <Card key={i._id} className="p-4">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <p className="font-bold text-slate-800 dark:text-white">{i.title}</p>
                          <span className={cn('inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-bold', meta.cls)}>
                            {meta.label}
                          </span>
                          <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-bold text-slate-500 dark:bg-slate-800 dark:text-slate-400">
                            {i.myRole === 'DESIGNER' ? 'Design' : 'Post'}
                          </span>
                        </div>
                        <p className="mt-1 text-xs text-slate-400">
                          <span className="font-semibold text-slate-500 dark:text-slate-300">{i.organization?.name || 'Unknown college'}</span>
                          {i.workCategory ? ` · ${i.workCategory}` : ''}
                          {i.raisedBy?.name ? ` · asked for by ${i.raisedBy.name}` : ''}
                          {` · updated ${timeAgo(i.updatedAt)}`}
                        </p>
                        {meta.hint && <p className="mt-1.5 text-sm text-slate-600 dark:text-slate-300">{meta.hint}</p>}
                      </div>
                      <div className="flex shrink-0 items-center gap-2">
                        {i.neededBy && (
                          <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-slate-500 dark:text-slate-400">
                            <CalendarClock className="h-3.5 w-3.5" /> {formatDate(i.neededBy)}
                          </span>
                        )}
                        <Button size="sm" variant={WORKFLOW_MY_MOVE.includes(i.workflowStage) ? 'primary' : 'outline'}
                          onClick={() => navigate(`/workflow/${i._id}`)}>
                          <Eye className="h-4 w-4" /> Open
                        </Button>
                      </div>
                    </div>
                  </Card>
                );
              })}
          </div>
        </div>
      )}

      {isLoading ? (
        <div className="space-y-2">
          {Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-24" />)}
        </div>
      ) : filtered.length === 0 && workflowShown.length === 0 ? (
        <EmptyState
          icon={BriefcaseBusiness}
          title="No assigned work"
          description="New tasks assigned by admin will appear here."
        />
      ) : (
        <div className="space-y-3">
          {filtered.map((a) => {
            const meta = statusMetaFor(a);
            const StatusIcon = meta.icon;
            return (
              <Card key={a._id} className={cn('p-4', String(a._id) === highlightId && 'ring-2 ring-brand-500/50')}>
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-base font-bold text-slate-800 dark:text-white">{a.title}</p>
                    <p className="mt-1 text-xs text-slate-400">
                      {a.organization?.name || 'Organization not set'}
                      {' · '}
                      Assigned {timeAgo(a.createdAt)}
                      {a.createdBy?.name ? ` by ${a.createdBy.name}` : ''}
                    </p>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    {URGENCY_META[a.urgency]?.cls && (
                      <span className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-bold ${URGENCY_META[a.urgency].cls}`}>
                        {a.urgency === 'URGENT' && <Flame className="h-3.5 w-3.5" />}
                        {URGENCY_META[a.urgency].label}
                      </span>
                    )}
                    <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-semibold text-slate-600 dark:bg-slate-800 dark:text-slate-300">
                      {platformPill(a.platform)}
                    </span>
                    <span className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-semibold ${meta.cls}`}>
                      <StatusIcon className="h-3.5 w-3.5" />
                      {meta.label}
                    </span>
                  </div>
                </div>

                {a.description && (
                  <p className="mt-3 rounded-xl border border-slate-100 bg-slate-50 px-3 py-2 text-sm text-slate-600 dark:border-slate-800 dark:bg-slate-900/60 dark:text-slate-300">
                    {a.description}
                  </p>
                )}

                {/* Publishing work: what the designer actually produced, so the
                    handler knows what they are putting out. */}
                {isPostingWork(a) && (
                  <p className="mt-3 rounded-xl border border-indigo-100 bg-indigo-50/60 px-3 py-2 text-xs text-indigo-700 dark:border-indigo-500/20 dark:bg-indigo-500/10 dark:text-indigo-300">
                    <span className="font-semibold">Ready to post:</span>{' '}
                    {a.sourceApproval?.caption || a.postingFor?.completionNote || a.sourceApproval?.title || a.postingFor?.title || 'The approved design'}
                    {a.sourceApproval && (
                      <a href={`/approvals/${a.sourceApproval._id}`} className="ml-1 font-semibold underline">
                        View the approved design
                      </a>
                    )}
                  </p>
                )}

                {a.sourceRequest?.title && (
                  <p className="mt-3 rounded-xl border border-brand-100 bg-brand-50/60 px-3 py-2 text-xs text-brand-700 dark:border-brand-500/20 dark:bg-brand-500/10 dark:text-brand-300">
                    Requested by {a.sourceRequest.raisedBy?.name || 'the coordinator'}: {a.sourceRequest.title}
                    <span className="ml-1 font-semibold">· Open work to read it</span>
                  </p>
                )}

                {a.acknowledgeLockedBy && a.status === 'OPEN' && (
                  <p className="mt-3 flex items-start gap-2 rounded-xl bg-amber-50 p-3 text-sm text-amber-700 dark:bg-amber-500/10 dark:text-amber-300">
                    <MessageSquareWarning className="mt-0.5 h-4 w-4 shrink-0" />
                    <span><span className="font-bold">Already picked up:</span> {a.acknowledgeLockedBy.name || 'Another designer'} has already acknowledged this work.</span>
                  </p>
                )}

                {/* Sent back by the reviewer — what still needs doing. */}
                {a.reviewNote && a.status !== 'DONE' && (
                  <p className="mt-3 flex items-start gap-2 rounded-xl bg-rose-50 p-3 text-sm text-rose-600 dark:bg-rose-500/10 dark:text-rose-400">
                    <MessageSquareWarning className="mt-0.5 h-4 w-4 shrink-0" />
                    <span><span className="font-bold">Sent back:</span> {a.reviewNote}</span>
                  </p>
                )}

                {/* What was submitted for sign-off. */}
                {a.completionNote && ['SUBMITTED', 'DONE'].includes(a.status) && (
                  <>
                    <p className="mt-3 rounded-xl border border-slate-100 px-3 py-2 text-xs text-slate-500 dark:border-slate-800 dark:text-slate-400">
                      <span className="font-semibold">Your request:</span> {a.completionNote}
                      {a.submittedAt ? ` · sent ${timeAgo(a.submittedAt)}` : ''}
                    </p>
                    <FileList files={a.completionAttachments} label="You attached" />
                  </>
                )}

                <div className="mt-3 flex flex-wrap items-center gap-2">
                  <Button size="sm" variant="outline" onClick={() => setViewing(a)}>
                    <Eye className="h-4 w-4" /> Open work
                  </Button>
                  {a.status === 'OPEN' && !a.acknowledgeLockedBy && a.assigneeType !== 'SOCIAL_HANDLER' && (
                    <Button size="sm" loading={ackMut.isPending && ackMut.variables === a._id} onClick={() => ackMut.mutate(a._id)}>
                      <ThumbsUp className="h-4 w-4" /> Acknowledge
                    </Button>
                  )}
                  {/* Shared designer work: whoever got there first owns it, so the
                      button stays visible but shut for everyone else. */}
                  {a.status === 'OPEN' && !!a.acknowledgeLockedBy && a.assigneeType !== 'SOCIAL_HANDLER' && (
                    <Button size="sm" disabled title={`${a.acknowledgeLockedBy.name || 'Another designer'} already acknowledged this work`}>
                      <ThumbsUp className="h-4 w-4" /> Acknowledge
                    </Button>
                  )}
                  {/* Publishing is done when the handler says it is out — the
                      content was approved before it reached them, so there is no
                      note to write and nobody left to sign it off. */}
                  {a.status !== 'DONE' && isPostingWork(a) && (
                    <Button size="sm" onClick={() => setPosting(a)}>
                      <Send className="h-4 w-4" /> {a.scheduledAt ? 'Change the time' : 'Mark as posted'}
                    </Button>
                  )}
                  {a.status === 'OPEN' && a.assigneeType === 'SOCIAL_HANDLER' && !isPostingWork(a) && (
                    <Button size="sm" onClick={() => setRequesting(a)}>
                      <Send className="h-4 w-4" /> Complete work
                    </Button>
                  )}
                  {a.status === 'ACKNOWLEDGED' && (
                    <Button size="sm" onClick={() => setRequesting(a)}>
                      <Send className="h-4 w-4" /> Send completion request
                    </Button>
                  )}
                  {a.status === 'SUBMITTED' && (
                    <>
                      <span className="text-xs text-slate-400">Waiting for the super admin to approve — it will be marked complete automatically.</span>
                      <Button size="sm" variant="outline" onClick={() => setRequesting(a)}>Edit request</Button>
                    </>
                  )}
                  {a.status === 'DONE' && (
                    <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-emerald-600 dark:text-emerald-400">
                      <CheckCircle2 className="h-4 w-4" />
                      Approved{a.reviewedBy?.name ? ` by ${a.reviewedBy.name}` : ''}
                      {a.completedAt ? ` · ${timeAgo(a.completedAt)}` : ''}
                    </span>
                  )}
                </div>
              </Card>
            );
          })}
        </div>
      )}

      {requesting && (
        <CompletionRequestModal
          assignment={requesting}
          onClose={() => setRequesting(null)}
          onSaved={() => { setRequesting(null); refresh(); }}
        />
      )}
      {posting && (
        <MarkPostedModal
          assignment={posting}
          onClose={() => setPosting(null)}
          onSaved={() => { setPosting(null); refresh(); }}
        />
      )}
      {viewing && (
        <AssignmentDetailModal
          assignment={viewing}
          acknowledging={ackMut.isPending}
          onClose={() => setViewing(null)}
          onAcknowledge={() => { setViewing(null); ackMut.mutate(viewing._id); }}
          onComplete={() => { setViewing(null); setRequesting(viewing); }}
        />
      )}
    </div>
  );
}

// Opening the work is how an assignee reads the brief before committing to it.
// A designer can accept it from here; a social handler has nothing to accept, so
// their only route out is completing it.
function AssignmentDetailModal({ assignment, acknowledging, onClose, onAcknowledge, onComplete }) {
  const isDesigner = assignment.assigneeType !== 'SOCIAL_HANDLER';
  const takenBy = assignment.acknowledgeLockedBy?.name;
  return (
    <Modal open onClose={onClose} title="Assigned work">
      <div className="space-y-4">
        <div className="rounded-xl border border-slate-100 bg-slate-50 p-3 dark:border-slate-800 dark:bg-slate-900/60">
          <p className="text-sm font-bold text-slate-800 dark:text-white">{assignment.title}</p>
          <p className="mt-0.5 text-xs text-slate-400">
            {assignment.organization?.name || 'Organization not set'}
            {assignment.platform ? ` · ${assignment.platform}` : ''}
            {assignment.createdBy?.name ? ` · assigned by ${assignment.createdBy.name}` : ''}
          </p>
        </div>

        {isPostingWork(assignment) && (
          <div className="rounded-xl border border-indigo-100 bg-indigo-50/50 p-3 dark:border-indigo-500/20 dark:bg-indigo-500/[0.07]">
            <p className="mb-1 text-[11px] font-bold uppercase tracking-wide text-indigo-700 dark:text-indigo-300">Approved and ready to post</p>
            {assignment.sourceApproval?.title && (
              <p className="text-sm font-semibold text-slate-800 dark:text-white">{assignment.sourceApproval.title}</p>
            )}
            <p className="text-sm text-slate-700 dark:text-slate-200">
              {assignment.sourceApproval?.caption
                || assignment.postingFor?.completionNote
                || assignment.postingFor?.title
                || 'The approved design is ready for you to publish.'}
            </p>
            {/* The files themselves — what actually gets published. */}
            <FileList files={assignment.postingFor?.completionAttachments} label="Files to post" />

            {/* When the design came through an approval, the artwork lives
                there, so that is where they go to get it. */}
            {assignment.sourceApproval && (
              <a href={`/approvals/${assignment.sourceApproval._id}`}
                className="mt-2 inline-flex items-center gap-1.5 text-sm font-semibold text-brand-600 hover:underline dark:text-brand-400">
                <ExternalLink className="h-3.5 w-3.5" /> Open the approved design and its files
              </a>
            )}

            {!assignment.sourceApproval && !(assignment.postingFor?.completionAttachments || []).length && (
              <p className="mt-2 text-xs text-amber-600 dark:text-amber-400">
                No files were attached to this work — ask the admin for the artwork before posting.
              </p>
            )}
          </div>
        )}

        <div>
          <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-slate-400">Instructions</p>
          <p className="whitespace-pre-wrap text-sm text-slate-700 dark:text-slate-200">{assignment.description || 'No extra instructions were added.'}</p>
        </div>

        {assignment.sourceRequest?.title && <RequestBrief request={assignment.sourceRequest} />}

        {isDesigner && assignment.status === 'OPEN' && takenBy && (
          <p className="flex items-start gap-2 rounded-xl bg-amber-50 p-3 text-sm text-amber-700 dark:bg-amber-500/10 dark:text-amber-300">
            <MessageSquareWarning className="mt-0.5 h-4 w-4 shrink-0" />
            <span><span className="font-bold">Already picked up:</span> {takenBy} has acknowledged this work, so it is no longer yours to accept.</span>
          </p>
        )}

        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={onClose}>Close</Button>
          {!isDesigner && assignment.status === 'OPEN' && !isPostingWork(assignment) && (
            <Button onClick={onComplete}><Send className="h-4 w-4" /> Complete work</Button>
          )}
          {isDesigner && assignment.status === 'OPEN' && (
            <Button onClick={onAcknowledge} loading={acknowledging} disabled={!!takenBy}
              title={takenBy ? `${takenBy} already acknowledged this work` : undefined}>
              <ThumbsUp className="h-4 w-4" /> Acknowledge
            </Button>
          )}
          {isDesigner && assignment.status === 'ACKNOWLEDGED' && (
            <Button onClick={onComplete}><Send className="h-4 w-4" /> Send completion request</Button>
          )}
        </div>
      </div>
    </Modal>
  );
}

/**
 * Closing a posting job — "when did/does this go out?".
 *
 * Two answers, and neither involves anyone else. It is already out, so it closes
 * now. Or it goes out at a time you set, and the server's sweep closes it then.
 * There is no completion note and no sign-off: the content was approved before
 * it was ever handed over, so the only fact left is when it went live.
 */
function MarkPostedModal({ assignment, onClose, onSaved }) {
  const toLocalInput = (d) => {
    const dt = d ? new Date(d) : new Date(Date.now() + 60 * 60 * 1000);
    const pad = (n) => String(n).padStart(2, '0');
    return `${dt.getFullYear()}-${pad(dt.getMonth() + 1)}-${pad(dt.getDate())}T${pad(dt.getHours())}:${pad(dt.getMinutes())}`;
  };
  const [mode, setMode] = useState(assignment.scheduledAt ? 'later' : 'now');
  const [when, setWhen] = useState(toLocalInput(assignment.scheduledAt));

  const mut = useMutation({
    mutationFn: () => workAssignmentApi.markPosted(
      assignment._id,
      mode === 'later' ? new Date(when).toISOString() : undefined
    ),
    onSuccess: () => {
      toast.success(mode === 'later' ? 'Booked in — it closes itself at that time' : 'Marked as posted');
      onSaved();
    },
    onError: (e) => toast.error(e.response?.data?.message || 'Could not save that'),
  });

  const OPTIONS = [
    { key: 'now', label: 'It is already posted', hint: 'Close it now, with this moment as the time it went out.' },
    { key: 'later', label: 'It goes out at a set time', hint: 'Pick the time — it is marked posted then, on its own.' },
  ];

  return (
    <Modal open onClose={onClose} title={assignment.scheduledAt ? 'Change the go-live time' : 'Mark as posted'}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (mode === 'later' && !when) { toast.error('Pick the date and time'); return; }
          mut.mutate();
        }}
        className="space-y-4"
      >
        <div className="rounded-xl border border-slate-100 bg-slate-50 p-3 dark:border-slate-800 dark:bg-slate-900/60">
          <p className="text-sm font-bold text-slate-800 dark:text-white">{assignment.title}</p>
          <p className="mt-0.5 text-xs text-slate-400">
            {assignment.organization?.name || 'Organization not set'}
            {assignment.platform ? ` · ${assignment.platform}` : ''}
          </p>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          {OPTIONS.map((o) => (
            <button key={o.key} type="button" onClick={() => setMode(o.key)}
              className={cn('rounded-2xl border-2 p-3 text-left transition',
                mode === o.key
                  ? 'border-brand-500 bg-brand-50/60 dark:bg-brand-500/10'
                  : 'border-slate-200 hover:border-brand-300 dark:border-slate-700')}>
              <p className="text-sm font-bold text-slate-800 dark:text-white">{o.label}</p>
              <p className="mt-0.5 text-xs text-slate-400">{o.hint}</p>
            </button>
          ))}
        </div>

        {mode === 'later' && (
          <label className="block">
            <span className="mb-1.5 block text-sm font-medium text-slate-600 dark:text-slate-300">Goes live on</span>
            <input type="datetime-local" className="input-base" value={when} min={toLocalInput(new Date())}
              onChange={(e) => setWhen(e.target.value)} />
          </label>
        )}

        <div className="flex justify-end gap-2">
          <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
          <Button type="submit" loading={mut.isPending}>
            <Send className="h-4 w-4" /> {mode === 'now' ? 'Mark as posted' : 'Set the time'}
          </Button>
        </div>
      </form>
    </Modal>
  );
}

// Asks the super admin to sign the work off. The note travels with the
// assignment so the reviewer sees exactly which task the request is about.
function CompletionRequestModal({ assignment, onClose, onSaved }) {
  const [note, setNote] = useState(assignment.completionNote || '');
  const [files, setFiles] = useState([]);
  const already = Array.isArray(assignment.completionAttachments) ? assignment.completionAttachments : [];

  const mut = useMutation({
    mutationFn: () => workAssignmentApi.submit(assignment._id, note, files),
    onSuccess: () => { toast.success('Request sent to the super admin'); onSaved(); },
    onError: (e) => toast.error(e.response?.data?.message || 'Could not send the request'),
  });

  return (
    <Modal open onClose={onClose} title="Send completion request">
      <form onSubmit={(e) => { e.preventDefault(); if (!note.trim()) { toast.error('Add a short note about what you completed'); return; } mut.mutate(); }} className="space-y-4">
        <div className="rounded-xl border border-slate-100 bg-slate-50 p-3 dark:border-slate-800 dark:bg-slate-900/60">
          <p className="text-sm font-bold text-slate-800 dark:text-white">{assignment.title}</p>
          <p className="mt-0.5 text-xs text-slate-400">
            {assignment.organization?.name || 'Organization not set'}
            {assignment.platform ? ` · ${assignment.platform}` : ''}
            {assignment.createdBy?.name ? ` · assigned by ${assignment.createdBy.name}` : ''}
          </p>
        </div>

        <label className="block">
          <span className="mb-1.5 block text-sm font-medium text-slate-600 dark:text-slate-300">What did you complete?</span>
          <textarea
            autoFocus className="input-base min-h-[110px]" value={note} onChange={(e) => setNote(e.target.value)}
            placeholder="e.g. Designed the 5-slide placement carousel and uploaded the final files to the shared drive"
          />
        </label>
        {/* The note describes the work; these are the work. Whoever publishes it
            next has nothing to post without them. */}
        <div>
          <span className="mb-1.5 block text-sm font-medium text-slate-600 dark:text-slate-300">
            The finished files <span className="font-normal text-slate-400">· attach what you produced</span>
          </span>
          <FileDropzone multiple files={files} onChange={setFiles} label="Drop the finished work here or click to browse" />
          {already.length > 0 && files.length === 0 && (
            <p className="mt-1.5 text-xs text-slate-400">
              {already.length} file{already.length === 1 ? '' : 's'} already attached — adding new ones replaces them.
            </p>
          )}
        </div>

        <p className="-mt-2 text-xs text-slate-400">
          The super admin sees this next to the assignment, and approving it marks the work complete. If it then goes to a
          social handler to publish, these files are what they post.
        </p>

        <div className="flex justify-end gap-2">
          <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
          <Button type="submit" loading={mut.isPending}><Send className="h-4 w-4" /> Send request</Button>
        </div>
      </form>
    </Modal>
  );
}
