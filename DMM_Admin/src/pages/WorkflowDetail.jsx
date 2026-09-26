import { useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import {
  ArrowLeft, Check, X, Send, Plus, Trash2, MessageSquareWarning, CheckCircle2,
  UserCheck, ThumbsUp, CalendarClock, FileText, Paperclip, Clock3, Palette, Upload, Ban, Download,
} from 'lucide-react';
import { workflowApi, institutionRequestApi } from '../api/endpoints.js';
import { useAuthStore } from '../store/authStore.js';
import { Button } from '../components/ui/Button.jsx';
import { Modal } from '../components/ui/Modal.jsx';
import { Card, Badge, Avatar, Skeleton, Input } from '../components/ui/primitives.jsx';
import { cn, formatDate, formatDateTime, timeAgo, isVideo, downloadAllAttachments, canNavigateBack } from '../lib/utils.js';

/**
 * Every step this ask has been through, with the exact moment it happened.
 *
 * Built off the request's own stamps rather than the approval threads, so one
 * card answers "when was this raised, taken, finished, signed off and released,
 * and by whom?". Steps with no stamp yet are dropped, which makes the list read
 * as the trail so far rather than a checklist of what has not happened.
 *
 * Both the exact date and time and the relative age are shown: the timestamp is
 * what gets quoted in a conversation, the relative age is what makes a stalled
 * step obvious at a glance.
 */
const progressSteps = (item) => [
  { at: item.createdAt, label: 'Request raised', who: item.raisedBy?.name, icon: UserCheck, tone: 'text-slate-400' },
  { at: item.designerAcknowledgedAt, label: 'Design work accepted', who: item.designer?.name, icon: ThumbsUp, tone: 'text-slate-400' },
  { at: item.designSubmittedAt, label: 'Design completed and sent for approval', who: item.designer?.name, icon: Upload, tone: 'text-sky-500' },
  { at: item.designApprovedAt, label: 'Design approved by the Admin', who: item.designApprovedBy?.name, icon: CheckCircle2, tone: 'text-emerald-500' },
  { at: item.designAcceptedAt, label: 'Design confirmed by the college', who: item.designAcceptedBy?.name, icon: Check, tone: 'text-emerald-500' },
  { at: item.handlerAcknowledgedAt, label: 'Posting work accepted', who: item.handler?.name, icon: ThumbsUp, tone: 'text-slate-400' },
  { at: item.postSubmittedAt, label: 'Post content completed and sent for approval', who: item.handler?.name, icon: Upload, tone: 'text-sky-500' },
  { at: item.postApprovedAt, label: 'Post content approved by the Admin', who: item.postApprovedBy?.name, icon: CheckCircle2, tone: 'text-emerald-500' },
  { at: item.postAcceptedAt, label: 'Content released by the college', who: item.postAcceptedBy?.name, icon: Check, tone: 'text-emerald-500' },
  {
    at: item.postedAt || item.scheduledFor,
    label: item.postedAt ? 'Published' : 'Scheduled to go out',
    who: item.handler?.name,
    icon: CalendarClock,
    tone: 'text-teal-500',
  },
].filter((s) => !!s.at);

function ProgressTrail({ item }) {
  const steps = progressSteps(item);
  return (
    <Card className="p-4">
      <p className="mb-3 text-sm font-bold text-slate-800 dark:text-white">Progress</p>
      <ol className="space-y-3 text-sm">
        {steps.map((s, i) => {
          const Icon = s.icon;
          return (
            <li key={`${s.label}-${i}`} className="flex gap-2.5">
              <Icon className={cn('mt-0.5 h-4 w-4 shrink-0', s.tone)} />
              <div className="min-w-0">
                <p className="font-medium text-slate-700 dark:text-slate-200">{s.label}</p>
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  {formatDateTime(s.at)} · {timeAgo(s.at)}
                  {s.who ? ` · ${s.who}` : ''}
                </p>
              </div>
            </li>
          );
        })}
      </ol>
    </Card>
  );
}

const STAGE_LABEL = {
  DESIGN_OPEN: 'Waiting for a designer',
  DESIGN_IN_PROGRESS: 'Being designed',
  DESIGN_ADMIN_REVIEW: 'Waiting on your approval',
  DESIGN_COORDINATOR_REVIEW: 'With the coordinator to confirm',
  POST_OPEN: 'Waiting for a social media handler',
  POST_IN_PROGRESS: 'Content being written',
  POST_ADMIN_REVIEW: 'Waiting on your approval',
  POST_COORDINATOR_REVIEW: 'With the coordinator to confirm',
  POST_APPROVED: 'Approved — ready to post',
  POSTED: 'Posted',
  COMPLETED: 'Completed',
  CANCELLED: 'Cancelled',
};

const DESIGN_TRACK = ['DESIGN_OPEN', 'DESIGN_IN_PROGRESS', 'DESIGN_ADMIN_REVIEW', 'DESIGN_COORDINATOR_REVIEW'];
const POST_TRACK = ['POST_OPEN', 'POST_IN_PROGRESS', 'POST_ADMIN_REVIEW', 'POST_COORDINATOR_REVIEW', 'POST_APPROVED', 'POSTED'];

function Detail({ label, children }) {
  return (
    <div>
      <p className="text-[11px] font-bold uppercase tracking-wide text-slate-400">{label}</p>
      <p className="mt-0.5 text-sm text-slate-700 dark:text-slate-200">{children}</p>
    </div>
  );
}

function Media({ items = [], onOpen }) {
  if (!items.length) return null;
  return (
    <div>
      {items.length > 1 && (
        <button type="button" onClick={() => downloadAllAttachments(items)}
          className="mb-2 inline-flex items-center gap-1 text-[11px] font-semibold text-slate-500 transition hover:text-brand-600 dark:text-slate-400 dark:hover:text-brand-400">
          <Download className="h-3 w-3" /> Download all ({items.length})
        </button>
      )}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        {items.map((m) => (
          <button key={m._id || m.url} type="button" onClick={() => onOpen?.(m)}
            className="overflow-hidden rounded-xl border border-slate-200 bg-slate-50 dark:border-slate-700 dark:bg-slate-800">
            {isVideo(m) ? (
              <video src={m.url} className="h-32 w-full object-cover" muted />
            ) : m.mediaType === 'document' ? (
              <span className="flex h-32 w-full flex-col items-center justify-center gap-1 text-slate-400">
                <FileText className="h-8 w-8" />
                <span className="max-w-full truncate px-2 text-[11px] font-semibold">{m.name || 'Document'}</span>
              </span>
            ) : (
              <img src={m.url} alt={m.name || ''} className="h-32 w-full object-cover" />
            )}
          </button>
        ))}
      </div>
    </div>
  );
}

/**
 * The work, newest round first — with the earlier rounds kept but out of the way.
 *
 * Every submission APPENDS its files (the previous version is what a reviewer
 * compares against, so deleting it would lose the trail), which meant a rejected
 * design and the one that replaced it sat in the same undivided grid. Whoever was
 * approving had no way to tell which image they were being asked to sign off.
 *
 * So: the highest `revision` present is the current work and is the only thing
 * shown by default. Anything older is behind a disclosure, labelled with its round.
 * Files written before revisions existed all read as round 0, which collapses to a
 * single group — the old undivided view, never a wrong label.
 */
function Revisions({ items = [], onOpen, emptyText = 'Nothing attached yet.' }) {
  const [showOld, setShowOld] = useState(false);
  if (!items.length) return <p className="text-sm text-slate-400">{emptyText}</p>;

  const byRevision = new Map();
  for (const m of items) {
    const r = m.revision || 0;
    if (!byRevision.has(r)) byRevision.set(r, []);
    byRevision.get(r).push(m);
  }
  // Newest first, so [current, ...older].
  const rounds = [...byRevision.entries()].sort((a, b) => b[0] - a[0]);
  const [currentRound, current] = rounds[0];
  const older = rounds.slice(1);

  return (
    <div className="space-y-3">
      <div>
        {rounds.length > 1 && (
          <p className="mb-2 inline-flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wide text-emerald-600 dark:text-emerald-400">
            <Check className="h-3.5 w-3.5" />
            Current · revision {currentRound + 1}
          </p>
        )}
        <Media items={current} onOpen={onOpen} />
      </div>

      {older.length > 0 && (
        <div className="rounded-xl border border-slate-100 dark:border-slate-800">
          <button type="button" onClick={() => setShowOld((v) => !v)}
            className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-xs font-semibold text-slate-500 transition-colors hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200">
            <span>
              {showOld ? 'Hide' : 'Show'} earlier {older.length === 1 ? 'version' : `versions (${older.length})`}
              {' — '}what was asked to be changed
            </span>
            <span aria-hidden>{showOld ? '−' : '+'}</span>
          </button>
          {showOld && (
            <div className="space-y-3 border-t border-slate-100 p-3 dark:border-slate-800">
              {older.map(([round, media]) => (
                <div key={round}>
                  <p className="mb-2 text-[11px] font-bold uppercase tracking-wide text-slate-400">
                    Superseded · revision {round + 1}
                  </p>
                  {/* Dimmed so an old version can never be mistaken for the live one. */}
                  <div className="opacity-60">
                    <Media items={media} onOpen={onOpen} />
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * The copy the handler wrote, one block per page it is going out on.
 *
 * A post going to several channels does not read the same on all of them, so the
 * handler writes a pair per channel and it is stored in `platformContent`. The
 * top-level `caption`/`description` are only the PRIMARY channel's pair, kept so
 * search, reports and the posting helpers can read one caption — which makes them
 * the wrong thing to show anybody approving all of it.
 *
 * A single-channel post has no `platformContent` at all, and its plain pair says
 * everything, so that case falls through to the simple layout.
 */
function PostContent({ approval, pages = [], onOpenMedia }) {
  const perPage = approval.platformContent || [];
  const written = new Set(perPage.map((row) => row.platform));
  // Pages the college asked for that have no copy against them. Worth saying out
  // loud: silently showing three blocks for four chosen pages reads as complete.
  const missing = pages.filter((p) => perPage.length > 0 && !written.has(p));

  return (
    <Card className="p-4">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <p className="inline-flex items-center gap-1.5 text-sm font-bold text-slate-800 dark:text-white">
          <Send className="h-4 w-4 text-sky-500" /> The post content
        </p>
        {pages.length > 0 && (
          <p className="text-xs font-semibold text-slate-500 dark:text-slate-400">For {pages.join(', ')}</p>
        )}
      </div>

      <div className="space-y-3">
        {perPage.length > 0 ? (
          perPage.map((row, i) => (
            <div key={row.platform} className="rounded-xl border border-slate-100 p-3 dark:border-slate-800">
              <p className="mb-2 flex items-center gap-2 text-sm font-bold text-slate-700 dark:text-slate-200">
                {row.platform}
                {i === 0 && (
                  <span className="rounded-full bg-brand-50 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-brand-600 dark:bg-brand-500/10 dark:text-brand-300">
                    Primary
                  </span>
                )}
              </p>
              {row.caption && (
                <div className="mb-2">
                  <p className="text-[11px] font-bold uppercase tracking-wide text-slate-400">Caption</p>
                  <p className="mt-0.5 whitespace-pre-wrap text-sm text-slate-700 dark:text-slate-200">{row.caption}</p>
                </div>
              )}
              {row.description && (
                <div>
                  <p className="text-[11px] font-bold uppercase tracking-wide text-slate-400">Description</p>
                  <p className="mt-0.5 whitespace-pre-wrap text-sm text-slate-700 dark:text-slate-200">{row.description}</p>
                </div>
              )}
              {!row.caption && !row.description && (
                <p className="text-sm text-slate-400">Nothing written for this page yet.</p>
              )}
            </div>
          ))
        ) : (
          <>
            {approval.caption && (
              <div>
                <p className="text-[11px] font-bold uppercase tracking-wide text-slate-400">Caption</p>
                <p className="mt-0.5 whitespace-pre-wrap text-sm text-slate-700 dark:text-slate-200">{approval.caption}</p>
              </div>
            )}
            {approval.description && (
              <div>
                <p className="text-[11px] font-bold uppercase tracking-wide text-slate-400">Description</p>
                <p className="mt-0.5 whitespace-pre-wrap text-sm text-slate-700 dark:text-slate-200">{approval.description}</p>
              </div>
            )}
          </>
        )}

        {missing.length > 0 && (
          <p className="rounded-xl border border-amber-200 bg-amber-50/70 p-3 text-xs font-semibold text-amber-800 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-300">
            No copy written for {missing.join(', ')} — request changes if it needs to go out there too.
          </p>
        )}

        {(approval.hashtags || []).length > 0 && (
          <p className="text-sm font-semibold text-brand-600 dark:text-brand-400">
            {approval.hashtags.map((h) => (h.startsWith('#') ? h : `#${h}`)).join(' ')}
          </p>
        )}
        <Revisions items={approval.images || []} onOpen={onOpenMedia} emptyText="No media attached." />
      </div>
    </Card>
  );
}

/** Every round of changes, whoever asked for them. Nothing is overwritten. */
function FeedbackHistory({ approval, title }) {
  const rounds = approval?.reviews || [];
  if (!rounds.length) return null;
  return (
    <Card className="p-4">
      <p className="mb-3 text-sm font-bold text-slate-800 dark:text-white">{title}</p>
      <div className="space-y-3">
        {rounds.map((round, i) => (
          <div key={round._id || i} className="rounded-xl border border-slate-100 bg-slate-50/70 p-3 dark:border-slate-800 dark:bg-slate-800/40">
            <p className="text-xs font-semibold text-slate-500 dark:text-slate-400">
              Round {i + 1}{round.reviewedAt ? ` · ${timeAgo(round.reviewedAt)}` : ''}
            </p>
            <ul className="mt-1.5 space-y-1">
              {(round.feedbackPoints || []).map((p, j) => (
                <li key={j} className="flex items-start gap-2 text-sm text-slate-700 dark:text-slate-200">
                  <MessageSquareWarning className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-500" />
                  <span><span className="font-semibold">{p.category}:</span> {p.text}</span>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </Card>
  );
}

function ChangesModal({ onClose, onSubmit, saving }) {
  const [points, setPoints] = useState([{ text: '', category: 'Content' }]);
  const setAt = (i, patch) => setPoints((p) => p.map((row, j) => (j === i ? { ...row, ...patch } : row)));
  const clean = points.map((p) => ({ ...p, text: p.text.trim() })).filter((p) => p.text);
  return (
    <Modal open onClose={onClose} title="What needs changing?">
      <div className="space-y-3">
        {points.map((p, i) => (
          <div key={i} className="flex gap-2">
            <select className="input-base w-32 shrink-0" value={p.category}
              onChange={(e) => setAt(i, { category: e.target.value })}>
              {['Image', 'Content', 'Other'].map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
            <Input className="flex-1" placeholder="What needs changing?"
              value={p.text} onChange={(e) => setAt(i, { text: e.target.value })} />
            {points.length > 1 && (
              <Button variant="ghost" size="icon" onClick={() => setPoints((prev) => prev.filter((_, j) => j !== i))}>
                <Trash2 className="h-4 w-4" />
              </Button>
            )}
          </div>
        ))}
        <Button variant="outline" size="sm" onClick={() => setPoints((p) => [...p, { text: '', category: 'Content' }])}>
          <Plus className="h-4 w-4" /> Add another
        </Button>
        <div className="flex justify-end gap-2 pt-2">
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button variant="danger" loading={saving}
            onClick={() => (clean.length ? onSubmit(clean) : toast.error('Say what needs changing'))}>
            <X className="h-4 w-4" /> Send back
          </Button>
        </div>
      </div>
    </Modal>
  );
}

/**
 * Says out loud what approving does, before it happens.
 *
 * Approving hands the work straight to the college to confirm — it does not come
 * back to the console unless the coordinator sends it back. Worth one sentence of
 * warning rather than a surprise.
 */
function ApproveConfirmModal({ half, coordinatorName, onClose, onConfirm, saving }) {
  return (
    <Modal open onClose={onClose} title="Approve and send to the coordinator?">
      <div className="space-y-4">
        <p className="flex items-start gap-2.5 rounded-xl border border-indigo-200 bg-indigo-50/70 p-3 text-sm text-indigo-900 dark:border-indigo-500/30 dark:bg-indigo-500/10 dark:text-indigo-200">
          <UserCheck className="mt-0.5 h-4 w-4 shrink-0" />
          <span>
            Approving this will directly share the approval with
            {' '}<span className="font-bold">{coordinatorName || 'the coordinator'}</span>, who asked for it.
            They decide whether it is done or still needs changes
            {half === 'DESIGN' ? ', and choose which pages it goes out on.' : '.'}
          </span>
        </p>
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button variant="success" loading={saving} onClick={onConfirm}>
            <Check className="h-4 w-4" /> Approve and share
          </Button>
        </div>
      </div>
    </Modal>
  );
}

/**
 * Says out loud what cancelling does, before it happens.
 *
 * Only offered before anyone has acknowledged either half, so this never pulls
 * someone off work they have already started — it means telling the
 * coordinator their ask is not going ahead, not stopping a job mid-way.
 */
function CancelConfirmModal({ coordinatorName, onClose, onConfirm, saving }) {
  const [reason, setReason] = useState('');
  return (
    <Modal open onClose={onClose} title="Cancel this request?">
      <div className="space-y-4">
        <p className="flex items-start gap-2.5 rounded-xl border border-rose-200 bg-rose-50/70 p-3 text-sm text-rose-900 dark:border-rose-500/30 dark:bg-rose-500/10 dark:text-rose-200">
          <Ban className="mt-0.5 h-4 w-4 shrink-0" />
          <span>
            Nobody has taken this on yet. Cancelling tells{' '}
            <span className="font-bold">{coordinatorName || 'the coordinator'}</span> it will not be going
            ahead, and takes it off both boards.
          </span>
        </p>
        <label className="block">
          <span className="mb-1.5 block text-sm font-medium text-slate-600 dark:text-slate-300">
            Reason <span className="font-normal text-slate-400">· optional, shown to the coordinator</span>
          </span>
          <textarea className="input-base min-h-[90px]" value={reason} onChange={(e) => setReason(e.target.value)}
            placeholder="e.g. Not in our scope of work, not relevant to the Branding/Social Media Team, duplicate request" />
        </label>
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={onClose}>Keep it</Button>
          <Button variant="danger" loading={saving} onClick={() => onConfirm(reason.trim())}>
            <Ban className="h-4 w-4" /> Cancel the request
          </Button>
        </div>
      </div>
    </Modal>
  );
}

/**
 * Super admin only, and only once a designer or handler has already taken this
 * on — before that, Cancel above is the right tool. This is a hard delete: the
 * request, its approvals and any work assignments built on it are gone for
 * good, which is why it asks twice as loudly as Cancel does.
 */
function DeleteConfirmModal({ onClose, onConfirm, saving }) {
  return (
    <Modal open onClose={onClose} title="Delete this request?">
      <div className="space-y-4">
        <p className="flex items-start gap-2.5 rounded-xl border border-rose-200 bg-rose-50/70 p-3 text-sm text-rose-900 dark:border-rose-500/30 dark:bg-rose-500/10 dark:text-rose-200">
          <Trash2 className="mt-0.5 h-4 w-4 shrink-0" />
          <span>
            This permanently removes the request, along with any design/post approvals and work
            assignments built on it. This cannot be undone.
          </span>
        </p>
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={onClose}>Keep it</Button>
          <Button variant="danger" loading={saving} onClick={onConfirm}>
            <Trash2 className="h-4 w-4" /> Delete permanently
          </Button>
        </div>
      </div>
    </Modal>
  );
}

export default function WorkflowDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { user } = useAuthStore();
  const [changesOpen, setChangesOpen] = useState(false);
  const [approveOpen, setApproveOpen] = useState(false);
  const [cancelOpen, setCancelOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [lightbox, setLightbox] = useState(null);

  const { data, isLoading } = useQuery({
    queryKey: ['admin-workflow-item', id],
    queryFn: () => workflowApi.get(id),
    refetchInterval: 5000,
    refetchIntervalInBackground: false,
  });
  const item = data?.item;

  const done = (msg) => {
    toast.success(msg);
    qc.invalidateQueries({ queryKey: ['admin-workflow-item', id] });
    qc.invalidateQueries({ queryKey: ['admin-workflow'] });
    setChangesOpen(false);
    setApproveOpen(false);
    setCancelOpen(false);
  };
  const reviewMut = useMutation({
    mutationFn: ({ action, feedbackPoints }) => workflowApi.review(id, action, feedbackPoints),
    onSuccess: (_r, vars) => done(vars.action === 'APPROVE' ? 'Approved — sent to the coordinator' : 'Sent back with your notes'),
    onError: (e) => toast.error(e.response?.data?.message || 'That did not work'),
  });
  const cancelMut = useMutation({
    mutationFn: (reason) => workflowApi.cancel(id, reason),
    onSuccess: () => done('Request cancelled'),
    onError: (e) => toast.error(e.response?.data?.message || 'That did not work'),
  });
  const deleteMut = useMutation({
    mutationFn: () => institutionRequestApi.remove(id),
    onSuccess: () => {
      toast.success('Request deleted');
      qc.invalidateQueries({ queryKey: ['admin-workflow'] });
      const stage = data?.item?.workflowStage;
      navigate(POST_TRACK.includes(stage) ? '/workflow/to-be-posted' : '/workflow/designs');
    },
    onError: (e) => toast.error(e.response?.data?.message || 'That did not work'),
  });

  if (isLoading) return <div className="space-y-4"><Skeleton className="h-8 w-40" /><Skeleton className="h-96" /></div>;
  if (!item) return <p className="text-slate-400">This workflow item was not found.</p>;

  const can = item.can || {};
  const stage = item.workflowStage;
  const onPostHalf = POST_TRACK.includes(stage) || stage === 'POSTED';
  const track = onPostHalf ? POST_TRACK : DESIGN_TRACK;
  const trackIndex = track.indexOf(stage);
  const canReview = (can.reviewDesign || can.reviewPost) && !user?.viewOnly;
  const canCancel = can.cancel && !user?.viewOnly;
  // Cancel (above) only ever applies before anyone has picked this up — this is
  // its complement: once a designer or handler has acknowledged it, only the
  // super admin gets a way to remove it, right up to it being posted/completed.
  const canDelete = !!user?.isSuperAdmin && !user?.viewOnly
    && !['DESIGN_OPEN', 'POST_OPEN', 'POSTED', 'COMPLETED', 'CANCELLED'].includes(stage);

  return (
    <div>
      <button
        onClick={() => (canNavigateBack()
          ? navigate(-1)
          : navigate(onPostHalf ? '/workflow/to-be-posted' : '/workflow/designs'))}
        className="mb-4 inline-flex items-center gap-1.5 text-sm font-medium text-slate-400 transition-colors hover:text-slate-600 dark:hover:text-slate-200">
        <ArrowLeft className="h-4 w-4" /> Back
      </button>

      <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2.5">
            <h1 className="text-2xl font-extrabold tracking-tight text-slate-800 dark:text-white">{item.title}</h1>
            <Badge className="bg-violet-100 text-violet-700 dark:bg-violet-500/15 dark:text-violet-300">
              {item.workType === 'DIGITAL_MEDIA' ? 'Digital' : 'Print'}
            </Badge>
            <Badge className="bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300">{STAGE_LABEL[stage] || stage}</Badge>
          </div>
          <p className="mt-1 text-sm text-slate-400">
            {item.organization?.name || 'Unknown college'} · raised {timeAgo(item.createdAt)}
            {item.raisedBy?.name ? ` by ${item.raisedBy.name}` : ''}
          </p>
        </div>
        {(canReview || canCancel || canDelete) && (
          <div className="flex shrink-0 flex-wrap items-center gap-2">
            {canReview && (
              <>
                <Button variant="success" loading={reviewMut.isPending && reviewMut.variables?.action === 'APPROVE'}
                  onClick={() => setApproveOpen(true)}>
                  <Check className="h-4 w-4" /> Approve
                </Button>
                <Button variant="danger" onClick={() => setChangesOpen(true)}>
                  <X className="h-4 w-4" /> Request changes
                </Button>
              </>
            )}
            {canCancel && (
              <Button variant="danger" onClick={() => setCancelOpen(true)}>
                <Ban className="h-4 w-4" /> Cancel request
              </Button>
            )}
            {canDelete && (
              <Button variant="danger" onClick={() => setDeleteOpen(true)}>
                <Trash2 className="h-4 w-4" /> Delete request
              </Button>
            )}
          </div>
        )}
      </div>

      {canReview && (
        <div className="mb-5 rounded-xl border border-violet-200 bg-violet-50/70 px-4 py-3 text-sm text-violet-800 dark:border-violet-500/30 dark:bg-violet-500/10 dark:text-violet-300">
          <p className="font-bold">This is waiting on you.</p>
          <p className="mt-0.5">
            Approving sends it to {item.raisedBy?.name || 'the coordinator'} to confirm.
            Requesting changes sends it back to {(onPostHalf ? item.handler?.name : item.designer?.name) || 'whoever is working on it'}.
          </p>
        </div>
      )}

      {canCancel && (
        <div className="mb-5 rounded-xl border border-rose-200 bg-rose-50/70 px-4 py-3 text-sm text-rose-800 dark:border-rose-500/30 dark:bg-rose-500/10 dark:text-rose-300">
          <p className="font-bold">Nobody has taken this on yet.</p>
          <p className="mt-0.5">You can cancel it before a {onPostHalf ? 'social media handler' : 'designer'} acknowledges it.</p>
        </div>
      )}

      {/* Where it is on its track. */}
      <Card className="mb-5 p-4">
        <div className="flex flex-wrap items-center gap-2">
          {track.map((s, i) => (
            <div key={s} className="flex items-center gap-2">
              <span className={cn('inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-bold',
                i < trackIndex ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-400'
                  : i === trackIndex ? 'bg-brand-500 text-white'
                    : 'bg-slate-100 text-slate-400 dark:bg-slate-800')}>
                {i < trackIndex ? <Check className="h-3 w-3" /> : <Clock3 className="h-3 w-3" />}
                {STAGE_LABEL[s]}
              </span>
              {i < track.length - 1 && <span className="text-slate-300">→</span>}
            </div>
          ))}
        </div>
        {stage === 'COMPLETED' && (
          <p className="mt-2 text-xs text-slate-400">
            Not social media work — finished when the coordinator confirmed the design, with nothing to post.
          </p>
        )}
        {stage === 'CANCELLED' && (
          <p className="mt-2 text-xs text-slate-400">Cancelled before anyone took it on.</p>
        )}
      </Card>

      <div className="grid gap-5 lg:grid-cols-3">
        <div className="space-y-5 lg:col-span-2">
          <Card className="p-4">
            <p className="mb-3 text-sm font-bold text-slate-800 dark:text-white">What the college asked for</p>
            <div className="grid gap-4 rounded-xl bg-slate-50 p-4 dark:bg-slate-800/50 sm:grid-cols-2">
              <Detail label="College">{item.organization?.name || '—'}</Detail>
              <Detail label="Raised by">
                <span className="inline-flex items-center gap-1.5">
                  {item.raisedBy?.name ? <Avatar src={item.raisedBy.avatar} name={item.raisedBy.name} size="sm" className="h-5 w-5 ring-0" /> : null}
                  {item.raisedBy?.name || '—'}
                </span>
              </Detail>
              <Detail label="Work">
                {[item.workType === 'DIGITAL_MEDIA' ? 'Digital media' : 'Print media', item.workCategory, item.workItem].filter(Boolean).join(' · ') || '—'}
              </Detail>
              <Detail label="Department">{item.department || '—'}</Detail>
              <Detail label="Designer">{item.designer?.name || 'Not taken yet'}</Detail>
              <Detail label="Social media handler">{item.handler?.name || (onPostHalf ? 'Not taken yet' : '—')}</Detail>
              {item.neededBy && <Detail label="Needed by">{formatDate(item.neededBy)}</Detail>}
              {(item.postPlatforms?.length || 0) > 0 && (
                <Detail label="Pages to post on">{item.postPlatforms.join(', ')}</Detail>
              )}
              {item.designAcceptedBy?.name && (
                <Detail label="Design approved by">
                  {item.designAcceptedBy.name}{item.designAcceptedAt ? ` · ${formatDate(item.designAcceptedAt)}` : ''}
                </Detail>
              )}
              {item.event && <Detail label="Event">{[item.eventName, item.place, item.eventDate && formatDate(item.eventDate)].filter(Boolean).join(' · ')}</Detail>}
            </div>
            {item.details && (
              <div className="mt-3">
                <p className="text-[11px] font-bold uppercase tracking-wide text-slate-400">Their message</p>
                <p className="mt-1 whitespace-pre-wrap text-sm text-slate-700 dark:text-slate-200">{item.details}</p>
              </div>
            )}
            {(item.attachments?.length || 0) > 0 && (
              <div className="mt-4">
                <p className="mb-2 inline-flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wide text-slate-400">
                  <Paperclip className="h-3.5 w-3.5" /> Reference files · {item.attachments.length}
                </p>
                <Media items={item.attachments} onOpen={setLightbox} />
              </div>
            )}
          </Card>

          {stage === 'CANCELLED' && (
            <Card className="border-rose-200 p-4 dark:border-rose-500/30">
              <p className="mb-1.5 inline-flex items-center gap-1.5 text-sm font-bold text-rose-700 dark:text-rose-300">
                <Ban className="h-4 w-4" /> Cancelled
                {item.reviewedBy?.name ? ` by ${item.reviewedBy.name}` : ''}
                {item.reviewedAt ? ` · ${timeAgo(item.reviewedAt)}` : ''}
              </p>
              {item.response && <p className="whitespace-pre-wrap text-sm text-slate-700 dark:text-slate-200">{item.response}</p>}
            </Card>
          )}

          {item.design && (
            <Card className="p-4">
              <p className="mb-3 inline-flex items-center gap-1.5 text-sm font-bold text-slate-800 dark:text-white">
                <Palette className="h-4 w-4 text-violet-500" />
                The design{item.design.resubmitCount ? ` · revision ${item.design.resubmitCount + 1}` : ''}
              </p>
              {/* Only the latest round by default — the version you sent back stays
                  available for comparison, but never mixed in with its replacement. */}
              <Revisions items={item.design.images || []} onOpen={setLightbox} />
            </Card>
          )}

          {/* Every page's copy, not just the first. `caption`/`description` hold
              the PRIMARY channel's pair only, so rendering those alone showed one
              channel (LinkedIn, being first in the platform list) and silently hid
              the rest — including from the admin approving it. */}
          {item.post && (
            <PostContent approval={item.post} pages={item.postPlatforms || []} onOpenMedia={setLightbox} />
          )}
        </div>

        <div className="space-y-5">
          <FeedbackHistory approval={item.design} title="Changes asked for on the design" />
          <FeedbackHistory approval={item.post} title="Changes asked for on the content" />

          <div className="space-y-2">
            <ProgressTrail item={item} />
            {stage === 'POSTED' && (
              <p className="flex items-center gap-2 px-4 text-sm font-semibold text-teal-600 dark:text-teal-400">
                <CheckCircle2 className="h-4 w-4" /> Workflow complete
              </p>
            )}
          </div>
        </div>
      </div>

      {approveOpen && (
        <ApproveConfirmModal
          half={can.reviewDesign ? 'DESIGN' : 'POST'}
          coordinatorName={item.raisedBy?.name}
          saving={reviewMut.isPending}
          onClose={() => setApproveOpen(false)}
          onConfirm={() => reviewMut.mutate({ action: 'APPROVE' })}
        />
      )}
      {changesOpen && (
        <ChangesModal saving={reviewMut.isPending} onClose={() => setChangesOpen(false)}
          onSubmit={(points) => reviewMut.mutate({ action: 'CHANGES', feedbackPoints: points })} />
      )}
      {cancelOpen && (
        <CancelConfirmModal
          coordinatorName={item.raisedBy?.name}
          saving={cancelMut.isPending}
          onClose={() => setCancelOpen(false)}
          onConfirm={(reason) => cancelMut.mutate(reason)}
        />
      )}
      {deleteOpen && (
        <DeleteConfirmModal
          saving={deleteMut.isPending}
          onClose={() => setDeleteOpen(false)}
          onConfirm={() => deleteMut.mutate()}
        />
      )}

      {lightbox && (
        <Modal open onClose={() => setLightbox(null)} title={lightbox.name || 'Preview'} size="lg">
          {isVideo(lightbox)
            ? <video src={lightbox.url} controls className="max-h-[70vh] w-full rounded-xl" />
            : <img src={lightbox.url} alt={lightbox.name || ''} className="max-h-[70vh] w-full rounded-xl object-contain" />}
          <div className="mt-3 flex justify-end">
            <a href={lightbox.url} target="_blank" rel="noreferrer" download
              className="text-sm font-semibold text-brand-600 hover:underline dark:text-brand-400">Open the original</a>
          </div>
        </Modal>
      )}
    </div>
  );
}
