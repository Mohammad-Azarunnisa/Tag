import { useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import {
  ArrowLeft, Check, X, Send, ThumbsUp, Upload, Plus, Trash2, MessageSquareWarning,
  CheckCircle2, UserCheck, CalendarClock, FileText, Paperclip, Clock3,
} from 'lucide-react';
import { workflowApi } from '../api/endpoints.js';
import { Button } from '../components/ui/Button.jsx';
import { Card, Badge, Avatar, Skeleton, Input, Textarea } from '../components/ui/primitives.jsx';
import { Modal } from '../components/ui/Modal.jsx';
import FileDropzone from '../components/ui/FileDropzone.jsx';
import { UPLOAD_ACCEPT } from '../lib/uploads.js';
import { cn, formatDate, formatDateTime, timeAgo, isVideo } from '../lib/utils.js';

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
  DESIGN_ADMIN_REVIEW: 'With the Admin for approval',
  DESIGN_COORDINATOR_REVIEW: 'With the coordinator to confirm',
  POST_OPEN: 'Waiting for a social media handler',
  POST_IN_PROGRESS: 'Content being written',
  POST_ADMIN_REVIEW: 'With the Admin for approval',
  POST_COORDINATOR_REVIEW: 'With the coordinator to confirm',
  POST_APPROVED: 'Approved — ready to post',
  POSTED: 'Posted',
  COMPLETED: 'Completed',
  CANCELLED: 'Cancelled',
};

// The pipeline as a reader sees it. Print work stops at the coordinator, so its
// track is the first half only.
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
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
      {items.map((m) => (
        <button key={m._id || m.url} type="button" onClick={() => onOpen?.(m)}
          className="overflow-hidden rounded-xl border border-slate-200 bg-slate-50 dark:border-slate-700 dark:bg-slate-800">
          {isVideo(m.url) ? (
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

/** Every round of changes ever asked for, oldest first. Nothing is overwritten. */
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
              Round {i + 1}
              {round.reviewedAt ? ` · ${timeAgo(round.reviewedAt)}` : ''}
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

/** Collects the changes an admin or coordinator wants, as feedback points. */
function ChangesModal({ title, onClose, onSubmit, saving }) {
  const [points, setPoints] = useState([{ text: '', category: 'Content' }]);
  const setAt = (i, patch) => setPoints((p) => p.map((row, j) => (j === i ? { ...row, ...patch } : row)));
  const clean = points.map((p) => ({ ...p, text: p.text.trim() })).filter((p) => p.text);

  return (
    <Modal open onClose={onClose} title={title}>
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
 * Approving is not just a tick on this screen — it hands the work straight to the
 * college to confirm, and the admin does not get it back unless the coordinator
 * sends it back. Worth one sentence of warning rather than a surprise.
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
 * The coordinator's Done, and where the work goes.
 *
 * Accepting a social media design is the moment the college says which of its
 * pages this belongs on — the handler who picks it up should not be guessing, and
 * an admin should not be deciding it for them. Anything else, print or digital,
 * has no page to go on, so it is just a confirmation. The server decides which
 * (needsPosting), so this modal only renders the answer.
 */
function DoneModal({ half, platforms = [], needsPosting, onClose, onConfirm, saving }) {
  const [picked, setPicked] = useState([]);
  const toggle = (p) => setPicked((prev) => (prev.includes(p) ? prev.filter((x) => x !== p) : [...prev, p]));
  const askPages = half === 'DESIGN' && needsPosting;

  return (
    <Modal open onClose={onClose} title={askPages ? 'Where should this be posted?' : 'Confirm this is done?'}>
      <div className="space-y-4">
        {askPages ? (
          <>
            <p className="text-sm text-slate-600 dark:text-slate-300">
              You are approving this design. Pick the pages it should go out on — the handler who
              publishes it will see exactly these.
            </p>
            {platforms.length === 0 ? (
              <p className="rounded-xl border border-amber-200 bg-amber-50/70 p-3 text-sm text-amber-800 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-300">
                Your college has no social pages set up yet — ask the admin to add them before approving.
              </p>
            ) : (
              <div className="flex flex-wrap gap-2">
                {platforms.map((p) => {
                  const on = picked.includes(p);
                  return (
                    <button key={p} type="button" onClick={() => toggle(p)}
                      className={cn('inline-flex items-center gap-1.5 rounded-xl border-2 px-3 py-2 text-sm font-semibold transition',
                        on ? 'border-brand-500 bg-brand-50/60 text-brand-700 dark:bg-brand-500/10 dark:text-brand-300'
                          : 'border-slate-200 text-slate-600 hover:border-brand-300 dark:border-slate-700 dark:text-slate-300')}>
                      {on ? <Check className="h-4 w-4" /> : <Plus className="h-4 w-4 opacity-50" />} {p}
                    </button>
                  );
                })}
              </div>
            )}
          </>
        ) : (
          <p className="text-sm text-slate-600 dark:text-slate-300">
            {half === 'DESIGN'
              ? 'This finishes the request — the work is yours to use, with no social page to publish it to.'
              : 'This releases the post. The handler will be told they can publish it.'}
          </p>
        )}
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button variant="success" loading={saving}
            onClick={() => {
              if (askPages && !picked.length) { toast.error('Pick at least one page'); return; }
              onConfirm(askPages ? picked : undefined);
            }}>
            <Check className="h-4 w-4" /> {askPages ? 'Approve and send to be posted' : 'Done'}
          </Button>
        </div>
      </div>
    </Modal>
  );
}

/**
 * The copy the handler wrote, one block per page it is going out on.
 *
 * A post going to several channels does not read the same on all of them, so the
 * handler writes a pair per channel and it is stored in `platformContent`. The
 * top-level `caption`/`description` are only the PRIMARY channel's pair, kept so
 * search, reports and the posting helpers can read one caption — which makes them
 * the wrong thing to show a coordinator who is approving all of it.
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
        <p className="text-sm font-bold text-slate-800 dark:text-white">The post content</p>
        {pages.length > 0 && (
          <p className="text-xs font-semibold text-slate-500 dark:text-slate-400">
            For {pages.join(', ')}
          </p>
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
            No copy written for {missing.join(', ')} — ask for changes if this needs to go out there too.
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

/** Posted now, or booked for a date and time. */
function MarkPostedModal({ onClose, onSubmit, saving }) {
  const [mode, setMode] = useState('now');
  const [when, setWhen] = useState('');
  return (
    <Modal open onClose={onClose} title="Mark as posted">
      <div className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-2">
          {[
            { key: 'now', label: 'It is already posted', hint: 'Records this moment as when it went out.' },
            { key: 'later', label: 'It is scheduled', hint: 'Keeps the date and time it will go out.' },
          ].map((o) => (
            <button key={o.key} type="button" onClick={() => setMode(o.key)}
              className={cn('rounded-2xl border-2 p-3 text-left transition',
                mode === o.key ? 'border-brand-500 bg-brand-50/60 dark:bg-brand-500/10'
                  : 'border-slate-200 hover:border-brand-300 dark:border-slate-700')}>
              <p className="text-sm font-bold text-slate-800 dark:text-white">{o.label}</p>
              <p className="mt-0.5 text-xs text-slate-400">{o.hint}</p>
            </button>
          ))}
        </div>
        {mode === 'later' && (
          <label className="block">
            <span className="mb-1.5 block text-sm font-medium text-slate-600 dark:text-slate-300">Goes out on</span>
            <input type="datetime-local" className="input-base" value={when} onChange={(e) => setWhen(e.target.value)} />
          </label>
        )}
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button loading={saving} onClick={() => {
            if (mode === 'later' && !when) { toast.error('Pick the date and time'); return; }
            onSubmit(mode === 'later' ? { scheduledFor: new Date(when).toISOString() } : {});
          }}>
            <CheckCircle2 className="h-4 w-4" /> {mode === 'later' ? 'Save the schedule' : 'Mark as posted'}
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
  const [changesFor, setChangesFor] = useState(null); // 'REVIEW' | 'CONFIRM'
  const [approveOpen, setApproveOpen] = useState(false);
  const [doneOpen, setDoneOpen] = useState(false);
  const [markPosted, setMarkPosted] = useState(false);
  const [lightbox, setLightbox] = useState(null);

  const { data, isLoading } = useQuery({
    queryKey: ['workflow-item', id],
    queryFn: () => workflowApi.get(id),
    refetchInterval: 5000,
    refetchIntervalInBackground: false,
  });
  const item = data?.item;

  const done = (msg) => {
    toast.success(msg);
    qc.invalidateQueries({ queryKey: ['workflow-item', id] });
    qc.invalidateQueries({ queryKey: ['workflow'] });
    qc.invalidateQueries({ queryKey: ['notifications'] });
    setChangesFor(null); setMarkPosted(false); setApproveOpen(false); setDoneOpen(false);
  };
  const fail = (e) => toast.error(e.response?.data?.message || 'That did not work');

  const ackMut = useMutation({ mutationFn: () => workflowApi.acknowledge(id), onSuccess: () => done('Acknowledged — it is yours now'), onError: fail });
  const submitMut = useMutation({ mutationFn: (payload) => workflowApi.submit(id, payload), onSuccess: () => done('Sent for approval'), onError: fail });
  const reviewMut = useMutation({ mutationFn: ({ action, feedbackPoints }) => workflowApi.review(id, action, feedbackPoints), onSuccess: () => done('Saved'), onError: fail });
  const confirmMut = useMutation({
    mutationFn: ({ action, feedbackPoints, platforms }) => workflowApi.confirm(id, action, feedbackPoints, platforms),
    onSuccess: () => done('Saved'), onError: fail,
  });
  const postedMut = useMutation({ mutationFn: (payload) => workflowApi.markPosted(id, payload), onSuccess: () => done('Recorded'), onError: fail });

  if (isLoading) return <div className="space-y-4"><Skeleton className="h-8 w-40" /><Skeleton className="h-96" /></div>;
  if (!item) return <p className="text-slate-400">This workflow item was not found.</p>;

  const can = item.can || {};
  const stage = item.workflowStage;
  const onPostHalf = POST_TRACK.includes(stage) || stage === 'POSTED';
  const track = onPostHalf ? POST_TRACK : DESIGN_TRACK;
  const trackIndex = track.indexOf(stage);
  // Which half a "changes" round belongs to, for the history heading.
  const designApproval = item.design;
  const postApproval = item.post;

  return (
    <div>
      <button onClick={() => navigate(onPostHalf ? '/workflow/to-be-posted' : '/workflow/designs')}
        className="mb-4 inline-flex items-center gap-1.5 text-sm font-medium text-slate-500 hover:text-slate-700 dark:hover:text-slate-300">
        <ArrowLeft className="h-4 w-4" /> Back to {onPostHalf ? 'To Be Posted' : 'Designs to be Done'}
      </button>

      <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2.5">
            <h1 className="text-2xl font-extrabold tracking-tight text-slate-800 dark:text-white">{item.title}</h1>
            <Badge className="bg-violet-100 text-violet-700 dark:bg-violet-500/15 dark:text-violet-300">
              {item.workType === 'DIGITAL_MEDIA' ? 'Digital' : 'Print'}
            </Badge>
            <Badge className="bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300">{STAGE_LABEL[stage] || stage}</Badge>
          </div>
          <p className="mt-1 text-sm text-slate-400">
            Raised {timeAgo(item.createdAt)}{item.raisedBy?.name ? ` by ${item.raisedBy.name}` : ''} · Updated {formatDateTime(item.updatedAt)}
          </p>
        </div>

        {/* Whatever this viewer's move is, at this stage. The server decides. */}
        <div className="flex flex-wrap items-center gap-2">
          {(can.acknowledgeDesign || can.acknowledgePost) && (
            <Button loading={ackMut.isPending} onClick={() => ackMut.mutate()}>
              <ThumbsUp className="h-4 w-4" /> Acknowledge
            </Button>
          )}
          {/* Handing the design in happens on the approvals side, using the form
              that already exists for a designer submitting finished work — the
              title comes across prefilled. A resubmission goes to the approval
              itself instead: that is where the feedback rounds are, and raising a
              second approval would orphan them. Either way the server moves the
              item on to admin review. */}
          {can.submitDesign && (
            <Button onClick={() => navigate(designApproval
              ? `/approvals/${designApproval._id}`
              : `/approvals?workflow=${item._id}&title=${encodeURIComponent(item.title)}`)}>
              <Upload className="h-4 w-4" />
              {designApproval ? 'Resubmit the design' : 'Send for approval'}
            </Button>
          )}
          {/* The post content is handed in on the approvals side too — the same
              form that already exists for raising a post, with the title and the
              pages the coordinator chose carried across. A resubmission goes to
              the approval itself, where the feedback rounds live. */}
          {can.submitPost && (
            <Button onClick={() => navigate(postApproval
              ? `/approvals/${postApproval._id}`
              : `/approvals?workflow=${item._id}&title=${encodeURIComponent(item.title)}`)}>
              <Send className="h-4 w-4" />
              {postApproval ? 'Resubmit the content' : 'Send for approval'}
            </Button>
          )}
          {(can.reviewDesign || can.reviewPost) && (
            <>
              <Button variant="success" loading={reviewMut.isPending && reviewMut.variables?.action === 'APPROVE'}
                onClick={() => setApproveOpen(true)}>
                <Check className="h-4 w-4" /> Approve
              </Button>
              <Button variant="danger" onClick={() => setChangesFor('REVIEW')}>
                <X className="h-4 w-4" /> Request changes
              </Button>
            </>
          )}
          {(can.acceptDesign || can.acceptPost) && (
            <>
              <Button variant="success" loading={confirmMut.isPending && confirmMut.variables?.action === 'DONE'}
                onClick={() => setDoneOpen(true)}>
                <Check className="h-4 w-4" /> Done
              </Button>
              <Button variant="danger" onClick={() => setChangesFor('CONFIRM')}>
                <X className="h-4 w-4" /> Changes required
              </Button>
            </>
          )}
          {can.markPosted && (
            <Button onClick={() => setMarkPosted(true)}>
              <CheckCircle2 className="h-4 w-4" /> Mark as posted
            </Button>
          )}
        </div>
      </div>

      {/* The question the coordinator is actually being asked. */}
      {(can.acceptDesign || can.acceptPost) && (
        <div className="mb-5 rounded-xl border border-indigo-200 bg-indigo-50/70 px-4 py-3 text-sm text-indigo-800 dark:border-indigo-500/30 dark:bg-indigo-500/10 dark:text-indigo-300">
          <p className="font-bold">Is everything correct, or are changes required?</p>
          <p className="mt-0.5">
            {can.acceptDesign
              ? 'The Admin has approved this design. Confirm it and it moves on, or say what still needs changing.'
              : 'The Admin has approved this content. Confirm it and the handler can publish, or say what still needs changing.'}
          </p>
        </div>
      )}

      {stage === 'POST_APPROVED' && can.markPosted && (
        <div className="mb-5 rounded-xl border border-emerald-200 bg-emerald-50/70 px-4 py-3 text-sm text-emerald-800 dark:border-emerald-500/30 dark:bg-emerald-500/10 dark:text-emerald-400">
          <p className="font-bold">Post approved — ready to post</p>
          <p className="mt-0.5">Publish or schedule it, then mark it as posted with the date and time.</p>
        </div>
      )}

      {stage === 'POSTED' && (
        <div className="mb-5 rounded-xl border border-teal-200 bg-teal-50/70 px-4 py-3 text-sm text-teal-800 dark:border-teal-500/30 dark:bg-teal-500/10 dark:text-teal-300">
          <CheckCircle2 className="mr-1.5 inline h-4 w-4" />
          {item.postedAt ? `Posted on ${formatDateTime(item.postedAt)}` : `Scheduled for ${formatDateTime(item.scheduledFor)}`}
        </div>
      )}

      {/* Where it is, on the track it is actually on. */}
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
        {/* Only social media work carries on to a post. Print, and digital work
            with no page to go on (LED screens, web banners, email art), finish
            when the coordinator accepts the design. */}
        {!onPostHalf && !item.needsPosting && (
          <p className="mt-2 text-xs text-slate-400">
            This is not social media work — it finishes when the coordinator confirms the design, with nothing to post.
          </p>
        )}
      </Card>

      <div className="grid gap-5 lg:grid-cols-3">
        <div className="space-y-5 lg:col-span-2">
          {/* The coordinator's original ask, exactly as they raised it. */}
          <Card className="p-4">
            <p className="mb-3 text-sm font-bold text-slate-800 dark:text-white">What was asked for</p>
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
              {item.designer?.name && <Detail label="Designer">{item.designer.name}</Detail>}
              {item.handler?.name && <Detail label="Social media handler">{item.handler.name}</Detail>}
              {item.neededBy && <Detail label="Needed by">{formatDate(item.neededBy)}</Detail>}
              {/* Where the college said it goes — chosen when they accepted the design. */}
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

          {/* The design itself, once there is one. */}
          {designApproval && (
            <Card className="p-4">
              <p className="mb-3 text-sm font-bold text-slate-800 dark:text-white">
                The design {designApproval.resubmitCount ? `· revision ${designApproval.resubmitCount + 1}` : ''}
              </p>
              {/* Only the latest round by default — the rejected version stays
                  available for comparison, but never mixed in with it. */}
              <Revisions items={designApproval.images || []} onOpen={setLightbox} />
            </Card>
          )}

          {/* The post written around it — every page's copy, not just the first.
              `caption`/`description` hold the PRIMARY channel's pair only, so
              rendering those alone showed the coordinator one channel (LinkedIn,
              being first in the platform list) and silently hid the rest. */}
          {postApproval && (
            <PostContent
              approval={postApproval}
              pages={item.postPlatforms || []}
              onOpenMedia={setLightbox}
            />
          )}
        </div>

        <div className="space-y-5">
          <FeedbackHistory approval={designApproval} title="Changes asked for on the design" />
          <FeedbackHistory approval={postApproval} title="Changes asked for on the content" />

          {/* Who has done what and when, from the request's own trail. */}
          <ProgressTrail item={item} />
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
      {doneOpen && (
        <DoneModal
          half={can.acceptDesign ? 'DESIGN' : 'POST'}
          needsPosting={!!item.needsPosting}
          platforms={item.availablePlatforms || []}
          saving={confirmMut.isPending}
          onClose={() => setDoneOpen(false)}
          onConfirm={(platforms) => confirmMut.mutate({ action: 'DONE', platforms })}
        />
      )}
      {changesFor && (
        <ChangesModal
          title={changesFor === 'REVIEW' ? 'What needs changing?' : 'What still needs changing?'}
          saving={reviewMut.isPending || confirmMut.isPending}
          onClose={() => setChangesFor(null)}
          onSubmit={(points) => (changesFor === 'REVIEW'
            ? reviewMut.mutate({ action: 'CHANGES', feedbackPoints: points })
            : confirmMut.mutate({ action: 'CHANGES', feedbackPoints: points }))}
        />
      )}
      {markPosted && (
        <MarkPostedModal saving={postedMut.isPending} onClose={() => setMarkPosted(false)}
          onSubmit={(payload) => postedMut.mutate(payload)} />
      )}

      {lightbox && (
        <Modal open onClose={() => setLightbox(null)} title={lightbox.name || 'Preview'} size="lg">
          {isVideo(lightbox.url)
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
