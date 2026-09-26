import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import {
  ArrowLeft, Check, X, Plus, Trash2, Hash, Play, Send, Paperclip, Inbox,
  CheckCircle2, RefreshCw, MessageSquareWarning, FileText, Rocket, Images as ImagesIcon,
  UserCheck, Palette, Truck, Route, Sparkles, Globe, Printer, CalendarClock,
  Users, Megaphone, Download,
} from 'lucide-react';
import { approvalApi, organizationApi } from '../api/endpoints.js';
import { useAuthStore } from '../store/authStore.js';
import PageHeader from '../components/layout/PageHeader.jsx';
import { Button } from '../components/ui/Button.jsx';
import { Card, Input, Avatar, Skeleton, EmptyState } from '../components/ui/primitives.jsx';
import { Modal } from '../components/ui/Modal.jsx';
import { formatDate, formatDateTime, timeAgo, cn, isVideo, isDoc, fileLabel, platformsOf, downloadAllAttachments, canNavigateBack } from '../lib/utils.js';
import { StatusPill, FeedbackCategoryTag, FEEDBACK_CATEGORIES } from './Approvals.jsx';
import ReviewAssist from '../components/ReviewAssist.jsx';

export default function ApprovalDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { user } = useAuthStore();
  const [rejectOpen, setRejectOpen] = useState(false);
  const [approveRouteOpen, setApproveRouteOpen] = useState(false);
  const [approveWorkflowOpen, setApproveWorkflowOpen] = useState(false);

  // Live-chat feel: poll every 3s while the page is open (paused when the tab
  // is in the background), so a reviewer sees the submitter's replies and
  // status changes without refreshing.
  const { data, isLoading, isError } = useQuery({
    queryKey: ['admin-approval', id],
    queryFn: () => approvalApi.get(id),
    refetchInterval: 3000,
    refetchIntervalInBackground: false,
  });
  const r = data?.request;

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['admin-approval', id] });
    qc.invalidateQueries({ queryKey: ['admin-approvals'] });
  };
  const approveMut = useMutation({
    mutationFn: (routingData) => approvalApi.approve(id, routingData),
    onSuccess: () => { toast.success('Content approved'); setApproveRouteOpen(false); invalidate(); },
    onError: (e) => toast.error(e.response?.data?.message || 'Failed'),
  });
  const [scheduleOpen, setScheduleOpen] = useState(false);
  const [postedOpen, setPostedOpen] = useState(false);
  const postedMut = useMutation({
    // The moment it went out, which is not always this moment — see MarkPostedModal.
    mutationFn: (postedAt) => approvalApi.markPosted(id, postedAt),
    onSuccess: () => { toast.success('Marked as posted — the request is now closed'); setPostedOpen(false); invalidate(); },
    onError: (e) => toast.error(e.response?.data?.message || 'Failed'),
  });
  // Separate module from "Mark as posted" above — this actually publishes to
  // a connected Facebook/Instagram account instead of just recording a
  // claim. Dormant until a Meta token with publish scopes + a linked
  // Page/Instagram account exist (DMM_backend/src/services/socialPublish.js);
  // until then the backend reports there's nothing to post directly.
  const publishNowMut = useMutation({
    mutationFn: () => approvalApi.publishNow(id),
    onSuccess: (res) => {
      const live = (res?.request?.metaPublishResults || []).filter((p) => p.status === 'success' && p.postUrl);
      toast.success(live.length ? `Published live: ${live.map((p) => p.platform).join(', ')}` : 'Posted');
      invalidate();
    },
    onError: (e) => toast.error(e.response?.data?.message || 'Could not post this directly', { duration: e.response?.status === 502 ? 8000 : 4000 }),
  });
  const deleteMut = useMutation({
    mutationFn: () => approvalApi.remove(id),
    onSuccess: () => {
      toast.success('Request deleted');
      qc.invalidateQueries({ queryKey: ['admin-approvals'] });
      navigate('/approvals');
    },
    onError: (e) => toast.error(e.response?.data?.message || 'Failed'),
  });

  if (isLoading) {
    return (
      <div>
        <Skeleton className="mb-6 h-9 w-72" />
        <div className="grid gap-5 lg:grid-cols-3">
          <div className="space-y-5 lg:col-span-2"><Skeleton className="h-44" /><Skeleton className="h-64" /><Skeleton className="h-80" /></div>
          <Skeleton className="h-[70vh]" />
        </div>
      </div>
    );
  }
  if (isError || !r) {
    return (
      <div>
        <PageHeader title="Approvals" />
        <EmptyState icon={Inbox} title="Request not found"
          description="This approval request may have been deleted."
          action={<Button variant="outline" onClick={() => navigate('/approvals')}><ArrowLeft className="h-4 w-4" /> Back to approvals</Button>} />
      </div>
    );
  }

  const isViewer = !!user?.viewOnly; // Chairman: sees everything, changes nothing
  // Both administrators decide on content: the super admin anywhere, an Admin
  // (CEO) inside the institutions they hold. The server settles which — its
  // canDecideOn is exactly this pair, and a request they cannot access never
  // reaches this page in the first place. Gating on isSuperAdmin alone meant an
  // Admin could open a design submitted to them and find nothing to press.
  const isAdministrator = !!user?.isSuperAdmin || user?.role === 'CEO';
  const canDecide = isAdministrator && !isViewer && (r.status === 'PENDING' || r.status === 'RESUBMITTED');
  // A workflow submission is not routed from here: approving it hands it to the
  // coordinator who asked for the work, and they choose the pages. Asking "who
  // should handle this?" would fork the pipeline and strand the request.
  const wf = r.workflow || null;
  // An APPROVED request stays open and workable until someone marks it posted.
  // For a design that means after it has been allocated to a handler.
  //
  // Posting stays with the handler it was allocated to, or the super admin —
  // that is what the server allows (markPosted), so it is not offered wider.
  const canMarkPosted = !!user?.isSuperAdmin && !isViewer && r.status === 'APPROVED'
    && (r.type !== 'DESIGN' || !!r.assignedTo);
  // Only meaningful when the request actually targets a platform this module
  // knows how to post to directly — everything else still goes through
  // "Mark as Posted" above, unchanged.
  const canPublishNow = canMarkPosted && platformsOf(r).some((p) => p === 'Facebook' || p === 'Instagram');
  // Once a post is approved it needs a go-live time, so the system can mark it
  // posted on its own. A design has nothing to publish until it is allocated.
  const canSchedule = isAdministrator && !isViewer && r.status === 'APPROVED' && r.type !== 'DESIGN';
  const needsSchedule = canSchedule && !r.scheduledAt;

  return (
    <div>
      <button
        onClick={() => (canNavigateBack() ? navigate(-1) : navigate('/approvals'))}
        className="mb-4 inline-flex items-center gap-1.5 text-sm font-medium text-slate-400 transition-colors hover:text-slate-600 dark:hover:text-slate-200">
        <ArrowLeft className="h-4 w-4" /> Back
      </button>

      {/* Header: title, status + reviewer actions */}
      <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2.5">
            <h1 className="text-2xl font-extrabold tracking-tight text-slate-800 dark:text-white">{r.title}</h1>
            <span className={cn('inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-bold uppercase tracking-wide',
              r.type === 'DESIGN'
                ? 'bg-violet-100 text-violet-700 dark:bg-violet-500/15 dark:text-violet-300'
                : 'bg-sky-100 text-sky-700 dark:bg-sky-500/15 dark:text-sky-300')}>
              {r.type === 'DESIGN' ? <><Palette className="h-3 w-3" /> Design</> : <><Send className="h-3 w-3" /> Post</>}
            </span>
            <StatusPill status={r.status} />
          </div>
          <p className="mt-1 text-sm text-slate-400">Request #{String(r._id).slice(-6).toUpperCase()} · Updated {formatDateTime(r.updatedAt)}</p>
        </div>
        <div className="flex shrink-0 flex-wrap items-center gap-2">
          {canDecide && (
            <>
              {/* A DESIGN is raw material — approving it raises the question of
                  who publishes it, so that is asked. A POST is finished content
                  whose author is the one who will put it out, so approving it is
                  the whole decision and nothing further is asked. */}
              <Button variant="success" loading={approveMut.isPending}
                onClick={() => (wf ? setApproveWorkflowOpen(true)
                  : r.type === 'DESIGN' ? setApproveRouteOpen(true)
                    : approveMut.mutate({}))}>
                <Check className="h-4 w-4" /> Approve
              </Button>
              <Button variant="danger" onClick={() => setRejectOpen(true)}><X className="h-4 w-4" /> Request changes</Button>
            </>
          )}
          {canSchedule && (
            <Button variant={needsSchedule ? 'default' : 'outline'} onClick={() => setScheduleOpen(true)}>
              <CalendarClock className="h-4 w-4" /> {r.scheduledAt ? 'Reschedule' : 'Schedule post'}
            </Button>
          )}
          {/* Separate from "Mark as Posted" below — this one actually posts
              live to a connected Facebook/Instagram account. Only shown when
              there's a real platform for it to do that to. */}
          {canPublishNow && (
            <Button variant="success" loading={publishNowMut.isPending} onClick={() => publishNowMut.mutate()}>
              <Send className="h-4 w-4" /> Post now
            </Button>
          )}
          {canMarkPosted && (
            <Button variant={needsSchedule ? 'outline' : 'default'} loading={postedMut.isPending} onClick={() => setPostedOpen(true)}>
              <Send className="h-4 w-4" /> {r.scheduledAt ? 'Already posted' : 'Mark as Posted'}
            </Button>
          )}
          {!isViewer && (
            <Button variant="outline" loading={deleteMut.isPending}
              className="text-rose-600 hover:bg-rose-50 dark:text-rose-400 dark:hover:bg-rose-500/10"
              onClick={() => { if (window.confirm('Delete this request and all its media? This cannot be undone.')) deleteMut.mutate(); }}>
              <Trash2 className="h-4 w-4" /> Delete
            </Button>
          )}
        </div>
      </div>

      {needsSchedule && (
        <div className="mb-5 flex flex-wrap items-center gap-3 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-300">
          <CalendarClock className="h-4 w-4 shrink-0" />
          <span className="min-w-0">
            This post is approved but has no go-live time yet. Set one and it is marked as posted automatically when it goes out.
          </span>
          <Button size="sm" className="ml-auto" onClick={() => setScheduleOpen(true)}>Set the time</Button>
        </div>
      )}
      {r.scheduledAt && r.status === 'APPROVED' && (
        <div className="mb-5 flex flex-wrap items-center gap-3 rounded-2xl border border-sky-200 bg-sky-50 px-4 py-3 text-sm text-sky-800 dark:border-sky-500/30 dark:bg-sky-500/10 dark:text-sky-300">
          <CalendarClock className="h-4 w-4 shrink-0" />
          <span>Goes live {formatDateTime(r.scheduledAt)} — it will be marked as posted then, without anyone doing anything.</span>
        </div>
      )}

      <div className="grid gap-5 lg:grid-cols-3">
        <div className="space-y-5 lg:col-span-2">
          <LifecycleCard r={r} />
          {r.type === 'DESIGN' && <RoutingCard r={r} user={user} onChanged={invalidate} />}
          {/* Pre-approval AI quality check — posts awaiting a decision only */}
          {r.type !== 'DESIGN' && canDecide && <ReviewAssist approvalId={id} />}
          <DetailsCard r={r} />
          <GalleryCard r={r} />
        </div>
        <ActivityCard r={r} />
      </div>

      {rejectOpen && <RejectModal id={id} onClose={() => setRejectOpen(false)} onDone={() => { setRejectOpen(false); invalidate(); }} />}

      {approveWorkflowOpen && (
        <Modal open onClose={() => setApproveWorkflowOpen(false)} title="Approve and send to the coordinator?">
          <div className="space-y-4">
            <p className="flex items-start gap-2.5 rounded-xl border border-indigo-200 bg-indigo-50/70 p-3 text-sm text-indigo-900 dark:border-indigo-500/30 dark:bg-indigo-500/10 dark:text-indigo-200">
              <UserCheck className="mt-0.5 h-4 w-4 shrink-0" />
              <span>
                Approving this will directly share the approval with
                {' '}<span className="font-bold">{wf?.coordinatorName || 'the coordinator'}</span>, who asked for it.
                They decide whether it is done or still needs changes
                {wf?.half === 'DESIGN' ? ', and choose which pages it goes out on.' : '.'}
              </span>
            </p>
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setApproveWorkflowOpen(false)}>Cancel</Button>
              <Button variant="success" loading={approveMut.isPending}
                onClick={() => { setApproveWorkflowOpen(false); approveMut.mutate({}); }}>
                <Check className="h-4 w-4" /> Approve and share
              </Button>
            </div>
          </div>
        </Modal>
      )}
      {approveRouteOpen && <ApproveRoutingModal request={r} onClose={() => setApproveRouteOpen(false)} onApprove={(data) => approveMut.mutate(data)} saving={approveMut.isPending} />}

      {scheduleOpen && <ScheduleModal request={r} onClose={() => setScheduleOpen(false)} onDone={() => { setScheduleOpen(false); invalidate(); }} />}
      {postedOpen && (
        <MarkPostedModal request={r} saving={postedMut.isPending}
          onClose={() => setPostedOpen(false)} onSubmit={(postedAt) => postedMut.mutate(postedAt)} />
      )}
    </div>
  );
}

/* ---------------------------------- Lifecycle --------------------------------- */

const STEP_CIRCLE = {
  done: 'bg-emerald-500 text-white',
  warn: 'bg-amber-500 text-white',
  current: 'bg-brand-600 text-white',
  upcoming: 'border-2 border-slate-200 bg-transparent text-slate-400 dark:border-slate-700',
};

function LifecycleCard({ r }) {
  const isDesign = r.type === 'DESIGN';
  const resubmits = r.resubmitCount || 0;
  const terminal = r.status === 'POSTED' || r.status === 'DELIVERED';

  // Furthest stage reached (1-based). DESIGN opens with an "In design" stage
  // (coordinator raised, designer working) and ends when the approved design is
  // either delivered to the coordinator or posted by a handler. POST starts at
  // review and ends at posted.
  // 1-based furthest stage on a shared scale: 1 in-design (design only) ·
  // 2 review · 3 approved · 4 terminal (delivered / posted). POST skips stage 1
  // because a submitted post is already in review.
  const stageIdx = isDesign
    ? (terminal ? 4 : r.status === 'APPROVED' ? 3 : r.status === 'IN_DESIGN' ? 1 : 2)
    : (terminal ? 4 : r.status === 'APPROVED' ? 3 : 2);

  const reviewStep = r.status === 'REJECTED'
    ? { label: 'Changes requested', sub: `${resubmits} resubmission${resubmits === 1 ? '' : 's'} so far`, state: 'warn' }
    : r.status === 'RESUBMITTED'
      ? { label: 'Back in review', sub: formatDate(r.resubmittedAt), state: 'current' }
      : stageIdx > 2
        ? { label: 'In review', sub: 'Review complete', state: 'done' }
        : stageIdx === 2
          ? { label: 'In review', sub: 'Awaiting decision', state: 'current' }
          : { label: 'In review', sub: '—', state: 'upcoming' };

  const approvedStep = stageIdx >= 3
    ? { label: 'Approved', sub: formatDate(r.approvedAt), state: stageIdx === 3 ? 'current' : 'done' }
    : { label: 'Approved', sub: '—', state: 'upcoming' };

  // DESIGN closes on a single routing step whose label reflects the outcome.
  const routeStep = r.status === 'DELIVERED'
    ? { label: 'Delivered', sub: `${r.createdBy?.name || 'Coordinator'} · ${formatDate(r.deliveredAt)}`, state: 'done' }
    : r.status === 'POSTED'
      ? { label: 'Posted', sub: `${r.assignedTo?.name ? `${r.assignedTo.name} · ` : ''}${formatDate(r.postedAt)}`, state: 'done' }
      : r.assignedTo
        ? { label: 'Allocated', sub: `${r.assignedTo?.name} · awaiting post`, state: 'current' }
        : { label: 'Delivered / Posted', sub: '—', state: 'upcoming' };

  const steps = isDesign
    ? [
        { label: 'In design', sub: `Raised ${formatDate(r.createdAt)}`, state: stageIdx > 1 ? 'done' : 'current' },
        reviewStep,
        approvedStep,
        routeStep,
      ]
    : [
        { label: 'Submitted', sub: formatDate(r.createdAt), state: 'done' },
        reviewStep,
        approvedStep,
        stageIdx === 4
          ? { label: 'Posted', sub: formatDate(r.postedAt), state: 'done' }
          : { label: 'Posted', sub: '—', state: 'upcoming' },
      ];
  const percent = Math.round((stageIdx / steps.length) * 100);

  return (
    <Card className="p-5">
      <div className="mb-4 flex items-center justify-between">
        <h3 className="font-bold text-slate-800 dark:text-white">Approval lifecycle</h3>
        <span className="text-sm font-bold text-brand-600 dark:text-brand-400">{percent}% complete</span>
      </div>
      <div className="mb-5 h-1.5 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800">
        <div className="h-full rounded-full bg-brand-500 transition-all duration-500" style={{ width: `${percent}%` }} />
      </div>
      <div className={cn('grid grid-cols-2 gap-4', steps.length === 5 ? 'sm:grid-cols-5' : 'sm:grid-cols-4')}>
        {steps.map((s, i) => (
          <div key={i} className="text-center">
            <span className={cn('mx-auto flex h-8 w-8 items-center justify-center rounded-full text-xs font-bold', STEP_CIRCLE[s.state])}>
              {s.state === 'done' ? <Check className="h-4 w-4" /> : s.state === 'warn' ? <MessageSquareWarning className="h-4 w-4" /> : i + 1}
            </span>
            <p className={cn('mt-2 text-xs font-bold', s.state === 'upcoming' ? 'text-slate-400' : s.state === 'warn' ? 'text-amber-600 dark:text-amber-400' : 'text-slate-700 dark:text-slate-200')}>{s.label}</p>
            <p className="mt-0.5 text-[11px] text-slate-400">{s.sub}</p>
          </div>
        ))}
      </div>
    </Card>
  );
}

/* ---------------------- Design routing: allocate or deliver ---------------------- */

// After a design is APPROVED, a super admin routes it: either allocate it to a
// social handler who will post it, or deliver it back to the coordinator who
// raised the brief. Both paths are always available; the coordinator's
// `deliveryMode` (DIGITAL = post to channels, PRINT = keep a copy) only decides
// which one we visually lead with.
function RoutingCard({ r, user, onChanged }) {
  // Whoever could approve it decides where it goes — the server's assign,
  // deliver and forward routes all accept an Admin over the institution, so
  // hiding this from them left approved work with nowhere to go.
  const isSuperAdmin = !!user?.isSuperAdmin || user?.role === 'CEO';
  const isViewer = !!user?.viewOnly;
  const [allocateOpen, setAllocateOpen] = useState(false);
  const [delivering, setDelivering] = useState(false);

  const isDigital = r.deliveryMode === 'DIGITAL';
  const delivered = r.status === 'DELIVERED';
  const allocated = !!r.assignedTo; // allocated (APPROVED + handler) or already POSTED
  const canRoute = isSuperAdmin && !isViewer && r.status === 'APPROVED' && !allocated && !delivered;

  // Nothing to route until the design is approved (or already routed).
  if (!canRoute && !allocated && !delivered) return null;

  const deliver = async () => {
    if (!window.confirm(`Deliver this approved design to ${r.createdBy?.name || 'the coordinator'}? This marks the request complete.`)) return;
    setDelivering(true);
    try {
      await approvalApi.deliver(r._id);
      toast.success('Design delivered to the coordinator');
      onChanged();
    } catch (e) {
      toast.error(e.response?.data?.message || 'Delivery failed');
    } finally {
      setDelivering(false);
    }
  };

  return (
    <Card className="p-5">
      <div className="mb-4 flex items-center justify-between gap-3">
        <h3 className="flex items-center gap-2 font-bold text-slate-800 dark:text-white">
          <Route className="h-4 w-4 text-violet-500" /> Route this design
        </h3>
        {canRoute && (
          <span className="inline-flex items-center gap-1 rounded-full bg-brand-50 px-2.5 py-0.5 text-xs font-semibold text-brand-700 dark:bg-brand-500/10 dark:text-brand-300">
            <Sparkles className="h-3 w-3" />
            {isDigital ? 'Coordinator wants: Digital (post to channels)' : 'Coordinator wants: Print (keep a copy)'}
          </span>
        )}
      </div>

      {/* Delivered — terminal */}
      {delivered && (
        <div className="flex flex-wrap items-center gap-3 rounded-xl border border-green-200 bg-green-50 p-4 dark:border-green-500/20 dark:bg-green-500/10">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-green-100 text-green-600 dark:bg-green-500/20 dark:text-green-300">
            <Truck className="h-5 w-5" />
          </span>
          <div>
            <p className="text-sm font-semibold text-slate-800 dark:text-white">Delivered to {r.createdBy?.name || 'coordinator'}</p>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              {formatDate(r.deliveredAt)}{r.deliveredBy?.name ? ` · by ${r.deliveredBy.name}` : ''}
            </p>
          </div>
        </div>
      )}

      {/* Allocated to a social handler (awaiting post, or already posted) */}
      {!delivered && allocated && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-violet-200 bg-violet-50 p-4 dark:border-violet-500/20 dark:bg-violet-500/10">
          <div className="flex items-center gap-3">
            <Avatar src={r.assignedTo?.avatar} name={r.assignedTo?.name} size="md" />
            <div>
              <p className="text-sm font-semibold text-slate-800 dark:text-white">Allocated to {r.assignedTo?.name}</p>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                {r.status === 'POSTED' ? `Posted ${formatDate(r.postedAt)}` : 'Awaiting post'}
                {r.assignedBy?.name ? ` · by ${r.assignedBy.name}` : ''}
              </p>
            </div>
          </div>
          <StatusPill status={r.status} />
        </div>
      )}

      {/* Approved & unrouted — the super admin picks a path */}
      {canRoute && (
        <>
          <p className="mb-4 text-sm text-slate-500 dark:text-slate-400">
            This design is approved. Send it to a social handler to post, or deliver it back to {r.createdBy?.name || 'the coordinator'}.
          </p>
          <div className="grid gap-3 sm:grid-cols-2">
            <RouteOption
              icon={Send}
              title="Allocate to a social handler"
              desc="Hand the design to a handler who will publish it."
              cta="Choose handler"
              primary={isDigital}
              onClick={() => setAllocateOpen(true)}
            />
            <RouteOption
              icon={Truck}
              title="Deliver to coordinator"
              desc={`Return the design to ${r.createdBy?.name || 'the coordinator'} — no posting needed.`}
              cta="Deliver"
              primary={!isDigital}
              loading={delivering}
              onClick={deliver}
            />
          </div>
        </>
      )}

      {allocateOpen && (
        <AllocateModal request={r} onClose={() => setAllocateOpen(false)} onDone={() => { setAllocateOpen(false); onChanged(); }} />
      )}
    </Card>
  );
}

function RouteOption({ icon: Icon, title, desc, cta, primary, loading, onClick }) {
  return (
    <div className={cn(
      'flex flex-col rounded-xl border p-4',
      primary
        ? 'border-brand-200 bg-brand-50/60 dark:border-brand-500/30 dark:bg-brand-500/10'
        : 'border-slate-200 dark:border-slate-800'
    )}>
      <span className={cn('mb-2 flex h-9 w-9 items-center justify-center rounded-lg',
        primary ? 'bg-brand-600 text-white' : 'bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-300')}>
        <Icon className="h-4 w-4" />
      </span>
      <p className="text-sm font-semibold text-slate-800 dark:text-white">{title}</p>
      <p className="mb-3 mt-0.5 flex-1 text-xs text-slate-500 dark:text-slate-400">{desc}</p>
      <Button variant={primary ? 'primary' : 'outline'} size="sm" loading={loading} onClick={onClick}>
        <Icon className="h-4 w-4" /> {cta}
      </Button>
    </div>
  );
}

// Single-select picker of the organization's social handlers for this platform.
function AllocateModal({ request, onClose, onDone }) {
  const organizationId = request.organization?._id || request.organization;
  const [selected, setSelected] = useState('');
  const [saving, setSaving] = useState(false);

  const { data, isLoading } = useQuery({
    queryKey: ['approval-handlers', organizationId, request.platform],
    queryFn: () => approvalApi.handlers(organizationId, request.platform),
    enabled: !!organizationId,
  });
  // Prefer handlers who own this org+platform; fall back to the wider list.
  const handlers = useMemo(() => {
    const merged = [...(data?.handlers || []), ...(data?.fallback || [])];
    const seen = new Set();
    return merged.filter((h) => {
      if (!h?._id || seen.has(h._id)) return false;
      seen.add(h._id);
      return true;
    });
  }, [data]);

  const submit = async () => {
    if (!selected) { toast.error('Choose a social handler'); return; }
    setSaving(true);
    try {
      await approvalApi.assign(request._id, selected);
      toast.success('Design allocated to the social handler');
      onDone();
    } catch (e) {
      toast.error(e.response?.data?.message || 'Allocation failed');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal open onClose={onClose} title="Allocate to a social handler">
      <p className="mb-4 text-sm text-slate-500 dark:text-slate-400">
        Pick the handler for <span className="font-semibold text-slate-700 dark:text-slate-200">{request.organization?.name || 'this organization'}</span>{request.platform ? <> on <span className="font-semibold text-slate-700 dark:text-slate-200">{request.platform}</span></> : ''}. They will post the approved design.
      </p>

      {isLoading ? (
        <div className="space-y-2">{Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-14" />)}</div>
      ) : handlers.length === 0 ? (
        <p className="rounded-xl border border-dashed border-slate-200 p-4 text-sm text-slate-400 dark:border-slate-700">
          No social handlers found for this organization and platform.
        </p>
      ) : (
        <div className="max-h-72 space-y-1.5 overflow-auto">
          {handlers.map((h) => (
            <button
              key={h._id}
              type="button"
              onClick={() => setSelected(h._id)}
              className={cn(
                'flex w-full items-center gap-3 rounded-xl border p-3 text-left transition',
                selected === h._id
                  ? 'border-brand-500 bg-brand-50 dark:border-brand-500/50 dark:bg-brand-500/10'
                  : 'border-slate-200 hover:border-slate-300 hover:bg-slate-50 dark:border-slate-800 dark:hover:bg-slate-800/50'
              )}
            >
              <Avatar src={h.avatar} name={h.name} size="md" />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-semibold text-slate-800 dark:text-white">{h.name}</p>
                {h.email && <p className="truncate text-xs text-slate-400">{h.email}</p>}
              </div>
              {selected === h._id && (
                <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-brand-600 text-white">
                  <Check className="h-3.5 w-3.5" />
                </span>
              )}
            </button>
          ))}
        </div>
      )}

      <div className="mt-5 flex justify-end gap-2">
        <Button variant="outline" onClick={onClose}>Cancel</Button>
        <Button loading={saving} disabled={!selected} onClick={submit}><UserCheck className="h-4 w-4" /> Allocate</Button>
      </div>
    </Modal>
  );
}

/* --------------------------------- Post details -------------------------------- */

const DetailField = ({ label, children }) => (
  <div>
    <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">{label}</p>
    <div className="mt-1 text-sm font-medium text-slate-700 dark:text-slate-200">{children || '—'}</div>
  </div>
);

const PersonInline = ({ user }) => (user?.name ? (
  <span className="inline-flex items-center gap-2">
    <Avatar src={user?.avatar} name={user?.name} size="sm" className="h-6 w-6 text-[10px]" />
    {user.name}
  </span>
) : '—');

function DetailsCard({ r }) {
  const isDesign = r.type === 'DESIGN';
  return (
    <Card className="p-5">
      <h3 className="mb-4 font-bold text-slate-800 dark:text-white">{isDesign ? 'Design details' : 'Post details'}</h3>
      <div className="grid gap-4 sm:grid-cols-2">
        {r.sourceDesign && (
          <DetailField label="Created from design">
            <Link to={`/approvals/${r.sourceDesign._id || r.sourceDesign}`}
              className="inline-flex items-center gap-1.5 font-medium text-violet-600 hover:text-violet-700 dark:text-violet-400 dark:hover:text-violet-300">
              <Palette className="h-3.5 w-3.5" /> {r.sourceDesign?.title || 'View design'}
            </Link>
          </DetailField>
        )}
        <DetailField label="Organization">
          <span className="inline-flex items-center gap-1.5">
            <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: r.organization?.color || '#7c3aed' }} />
            {r.organization?.name || '—'}
          </span>
        </DetailField>
        {platformsOf(r).length > 0 && (
          <DetailField label={platformsOf(r).length > 1 ? "Platforms" : "Platform"}>{platformsOf(r).join(", ")}</DetailField>
        )}
        {r.workAssignment && (
          <DetailField label="Assigned work this is for">
            <span className="block font-semibold text-slate-700 dark:text-slate-200">{r.workAssignment.title}</span>
            <span className="block text-xs text-slate-400">
              {r.workAssignment.organization?.name || '—'}
              {r.workAssignment.platform ? ` · ${r.workAssignment.platform}` : ''}
              {r.workAssignment.createdBy?.name ? ` · assigned by ${r.workAssignment.createdBy.name}` : ''}
              {` · ${r.workAssignment.status}`}
            </span>
            {r.workAssignment.status !== 'DONE' && (
              <span className="mt-0.5 block text-xs text-brand-600 dark:text-brand-400">
                Approving this request marks that work complete.
              </span>
            )}
          </DetailField>
        )}
        <DetailField label={(r.aspectRatios?.length || 0) > 1 ? 'Aspect ratios' : 'Aspect ratio'}>
          {(r.aspectRatios?.length ? r.aspectRatios : (r.aspectRatio ? [r.aspectRatio] : [])).join(', ') || '—'}
        </DetailField>
        {isDesign ? (
          <>
            <DetailField label="Coordinator"><PersonInline user={r.createdBy} /></DetailField>
            <DetailField label="Designer"><PersonInline user={r.designer} /></DetailField>
            <DetailField label="Delivery type">
              <span className={cn('inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-semibold',
                r.deliveryMode === 'DIGITAL'
                  ? 'bg-brand-50 text-brand-700 dark:bg-brand-500/10 dark:text-brand-300'
                  : 'bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400')}>
                {r.deliveryMode === 'DIGITAL'
                  ? <><Globe className="h-3 w-3" /> Digital</>
                  : <><Printer className="h-3 w-3" /> Print</>}
              </span>
            </DetailField>
            <DetailField label="Raised on">{formatDateTime(r.createdAt)}</DetailField>
          </>
        ) : (
          <>
            <DetailField label="Submitted by"><PersonInline user={r.createdBy} /></DetailField>
            <DetailField label="Submitted on">{formatDateTime(r.createdAt)}</DetailField>
          </>
        )}
        <DetailField label="Resubmissions">{String(r.resubmitCount || 0)}</DetailField>
        {r.approvedBy?.name && <DetailField label="Approved by">{r.approvedBy.name}</DetailField>}
        {r.approvedAt && <DetailField label="Approved on">{formatDateTime(r.approvedAt)}</DetailField>}
        {r.assignedTo?.name && <DetailField label="Allocated to"><PersonInline user={r.assignedTo} /></DetailField>}
        {r.scheduledAt && <DetailField label="Scheduled for">{formatDateTime(r.scheduledAt)}</DetailField>}
        {r.postedBy?.name && <DetailField label="Posted by">{r.postedBy.name}</DetailField>}
        {r.postedAt && <DetailField label="Posted on">{formatDateTime(r.postedAt)}</DetailField>}
        {r.deliveredBy?.name && <DetailField label="Delivered by">{r.deliveredBy.name}</DetailField>}
        {r.deliveredAt && <DetailField label="Delivered on">{formatDateTime(r.deliveredAt)}</DetailField>}
      </div>
      {/* A post going to several channels carries a pair per channel, each under
          the channel it belongs to — the reviewer is approving four different
          pieces of copy, not one. A single-channel post keeps the plain pair. */}
      {r.platformContent?.length > 0 ? (
        <div className="mt-5 space-y-3">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">
            Copy per channel · {r.platformContent.length}
          </p>
          {r.platformContent.map((row, i) => (
            <div key={row.platform} className="rounded-xl border border-slate-200 p-3 dark:border-slate-700">
              <p className="mb-2 flex items-center gap-2 text-sm font-bold text-slate-700 dark:text-slate-200">
                {row.platform}
                {i === 0 && <span className="rounded-full bg-brand-50 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-brand-600 dark:bg-brand-500/10 dark:text-brand-300">Primary</span>}
              </p>
              {row.description && (
                <>
                  <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">Description</p>
                  <p className="mb-2 mt-0.5 whitespace-pre-wrap text-sm text-slate-700 dark:text-slate-200">{row.description}</p>
                </>
              )}
              {row.caption && (
                <>
                  <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">Caption</p>
                  <p className="mt-0.5 whitespace-pre-wrap text-sm text-slate-700 dark:text-slate-200">{row.caption}</p>
                </>
              )}
            </div>
          ))}
        </div>
      ) : (
        <>
          {r.caption && (
            <div className="mt-5">
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">Caption</p>
              <p className="mt-1 whitespace-pre-wrap text-sm font-medium text-slate-700 dark:text-slate-200">{r.caption}</p>
            </div>
          )}
          {r.description && (
            <div className="mt-5">
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">Description</p>
              <p className="mt-1 whitespace-pre-wrap text-sm font-medium text-slate-700 dark:text-slate-200">{r.description}</p>
            </div>
          )}
        </>
      )}
      {r.hashtags?.length > 0 && (
        <div className="mt-5">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">Hashtags</p>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {r.hashtags.map((h, i) => (
              <span key={i} className="inline-flex items-center gap-0.5 rounded-md bg-brand-50 px-2 py-0.5 text-xs font-medium text-brand-600 dark:bg-brand-500/10"><Hash className="h-3 w-3" />{h}</span>
            ))}
          </div>
        </div>
      )}
    </Card>
  );
}

/* ---------------------------------- Media gallery ------------------------------ */

function SectionHead({ icon: Icon, title, count, hint }) {
  return (
    <div className="mb-3 flex items-center justify-between gap-3">
      <h3 className="flex min-w-0 items-center gap-2 font-bold text-slate-800 dark:text-white">
        <Icon className="h-4 w-4 shrink-0 text-slate-400" /> <span className="truncate">{title}</span>
        {hint && <span className="hidden shrink-0 text-xs font-normal text-slate-400 sm:inline">· {hint}</span>}
      </h3>
      <span className="shrink-0 rounded-full bg-slate-100 px-2 py-0.5 text-xs font-semibold text-slate-500 dark:bg-slate-800 dark:text-slate-400">{count}</span>
    </div>
  );
}

// A single big preview + thumbnail strip. Reused per media group.
function MediaViewer({ items }) {
  const [active, setActive] = useState(0);
  const sorted = useMemo(() => [...items].sort((a, b) => (a.order ?? 0) - (b.order ?? 0)), [items]);
  const current = sorted[Math.min(active, Math.max(sorted.length - 1, 0))];

  return (
    <div className="overflow-hidden rounded-xl border border-slate-100 dark:border-slate-800">
      {sorted.length > 1 && (
        <div className="flex justify-end border-b border-slate-100 px-3 py-1.5 dark:border-slate-800">
          <button type="button" onClick={() => downloadAllAttachments(sorted)}
            className="inline-flex items-center gap-1 text-[11px] font-semibold text-slate-500 transition hover:text-brand-600 dark:text-slate-400 dark:hover:text-brand-400">
            <Download className="h-3 w-3" /> Download all ({sorted.length})
          </button>
        </div>
      )}
      <div className="relative flex aspect-video items-center justify-center bg-slate-100 dark:bg-slate-800">
        {current
          ? (isVideo(current)
              ? <video src={current.url} controls className="h-full w-full object-contain" />
              : isDoc(current)
                ? (
                  <a href={current.url} target="_blank" rel="noreferrer" download={current.name || true}
                    className="flex flex-col items-center gap-2 rounded-xl border border-slate-200 bg-white px-6 py-5 text-center transition hover:border-brand-400 dark:border-slate-700 dark:bg-slate-900">
                    <FileText className="h-10 w-10 text-slate-400" />
                    <span className="max-w-[220px] truncate text-xs font-semibold text-slate-600 dark:text-slate-300">{fileLabel(current)}</span>
                    <span className="text-[11px] text-brand-600 dark:text-brand-400">Open / download</span>
                  </a>
                )
                : <img src={current.url} alt="" className="h-full w-full object-contain" />)
          : <span className="inline-flex items-center gap-2 text-slate-300 dark:text-slate-600"><ImagesIcon className="h-5 w-5" /> No media</span>}
      </div>
      {sorted.length > 1 && (
        <div className="flex gap-2 overflow-x-auto p-3">
          {sorted.map((img, i) => (
            <button key={img._id || i} type="button" onClick={() => setActive(i)}
              className={cn('relative h-14 w-14 shrink-0 overflow-hidden rounded-lg ring-2 transition', i === active ? 'ring-brand-500' : 'ring-transparent opacity-70 hover:opacity-100')}>
              {isVideo(img)
                ? <><video src={img.url} className="h-full w-full object-cover" muted /><span className="absolute inset-0 flex items-center justify-center bg-black/30"><Play className="h-4 w-4 text-white" /></span></>
                : isDoc(img)
                  ? <span className="flex h-full w-full items-center justify-center bg-slate-100 dark:bg-slate-800"><FileText className="h-4 w-4 text-slate-400" /></span>
                  : <img src={img.url} alt="" className="h-full w-full object-cover" />}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function GalleryCard({ r }) {
  const images = r.images || [];
  const isDesign = r.type === 'DESIGN';
  const refs = images.filter((i) => i.kind === 'reference');
  const finals = images.filter((i) => i.kind !== 'reference'); // final + legacy/untagged

  // Posts (and legacy media without a kind) render as a single gallery.
  if (!isDesign || refs.length === 0) {
    return (
      <Card className="p-5">
        <SectionHead icon={ImagesIcon} title="Media" count={images.length} />
        <MediaViewer items={images} />
      </Card>
    );
  }

  // Designs split into the designer's final work and the coordinator's brief.
  return (
    <Card className="space-y-6 p-5">
      <div>
        <SectionHead icon={Palette} title="Final design" count={finals.length} hint="Designer's finished work" />
        {finals.length ? (
          <MediaViewer items={finals} />
        ) : (
          <p className="rounded-xl border border-dashed border-slate-200 p-4 text-sm text-slate-400 dark:border-slate-700">
            No final design uploaded yet.
          </p>
        )}
      </div>
      <div>
        <SectionHead icon={Paperclip} title="Reference" count={refs.length} hint="From the coordinator's brief" />
        <MediaViewer items={refs} />
      </div>
    </Card>
  );
}

/* ------------------------------------ Activity --------------------------------- */

// Icon for a durable status-change event line, matched on the event text.
// Order matters: 'resubmitted…' also contains 'submitted'.
const EVENT_META = [
  { match: 'resubmitted', icon: RefreshCw, cls: 'text-sky-500' },
  { match: 'requested changes', icon: MessageSquareWarning, cls: 'text-amber-500' },
  { match: 'approved', icon: CheckCircle2, cls: 'text-emerald-500' },
  { match: 'delivered', icon: Truck, cls: 'text-green-500' },
  { match: 'allocated', icon: UserCheck, cls: 'text-violet-500' },
  { match: 'posted', icon: Rocket, cls: 'text-violet-500' },
  { match: 'submitted', icon: FileText, cls: 'text-slate-400' },
];
const EVENT_DEFAULT = { icon: FileText, cls: 'text-slate-400' };

function EventLine({ item }) {
  const meta = EVENT_META.find((m) => (item.text || '').includes(m.match)) || EVENT_DEFAULT;
  const Icon = meta.icon;
  return (
    <div className="flex items-start justify-center gap-1.5 px-2 text-center text-xs text-slate-400">
      <Icon className={cn('mt-0.5 h-3.5 w-3.5 shrink-0', meta.cls)} />
      <span><span className="font-semibold text-slate-500 dark:text-slate-300">{item.author?.name || 'Someone'}</span> {item.text} · {timeAgo(item.createdAt)}</span>
    </div>
  );
}

function FeedItem({ item, own }) {
  if (item.kind === 'event') return <EventLine item={item} />;

  if (item.kind === 'feedback') {
    return (
      <div className="max-w-[90%]">
        <div className="mb-1 flex items-center gap-2">
          <span className="text-xs font-semibold text-slate-600 dark:text-slate-300">{item.author?.name || 'Reviewer'}</span>
          <span className="text-[10px] text-slate-400">{timeAgo(item.createdAt)}</span>
        </div>
        <div className="rounded-xl rounded-tl-sm border border-amber-200 bg-amber-50 p-3 dark:border-amber-500/20 dark:bg-amber-500/10">
          <div className="flex flex-wrap items-center gap-2">
            <FeedbackCategoryTag category={item.category} />
            <p className="min-w-0 break-words text-sm text-slate-700 dark:text-slate-200">{item.text}</p>
          </div>
        </div>
      </div>
    );
  }

  const attachments = item.attachments || [];
  return (
    <div className={cn('flex flex-col', own ? 'items-end' : 'items-start')}>
      <div className="mb-1 flex items-center gap-2">
        {!own && <Avatar src={item.author?.avatar} name={item.author?.name} size="sm" className="h-6 w-6 text-[10px]" />}
        <span className="text-xs font-semibold text-slate-600 dark:text-slate-300">{own ? 'You' : item.author?.name || 'Someone'}</span>
        <span className="text-[10px] text-slate-400">{timeAgo(item.createdAt)}</span>
      </div>
      <div className={cn('max-w-[90%] rounded-xl p-3', own ? 'rounded-tr-sm border border-brand-500/20 bg-brand-500/10' : 'rounded-tl-sm bg-slate-100 dark:bg-slate-800')}>
        {item.text && <p className="whitespace-pre-wrap break-words text-sm text-slate-700 dark:text-slate-200">{item.text}</p>}
        {attachments.length > 0 && (
          <div className={cn(item.text && 'mt-2')}>
            {attachments.length > 1 && (
              <button type="button" onClick={() => downloadAllAttachments(attachments)}
                className="mb-1.5 inline-flex items-center gap-1 text-[11px] font-semibold text-slate-500 transition hover:text-brand-600 dark:text-slate-400 dark:hover:text-brand-400">
                <Download className="h-3 w-3" /> Download all ({attachments.length})
              </button>
            )}
            <div className="grid grid-cols-2 gap-1.5">
            {attachments.map((a, i) =>
              a.mediaType === 'video' || isVideo(a) ? (
                <video key={i} src={a.url} controls className="h-24 w-full rounded-lg bg-black object-cover" />
              ) : isDoc(a) ? (
                <a key={i} href={a.url} target="_blank" rel="noreferrer" download={a.name || true}
                  className="flex h-24 w-full flex-col items-center justify-center gap-1 rounded-lg border border-slate-200 bg-white p-2 text-center transition hover:border-brand-400 dark:border-slate-700 dark:bg-slate-900">
                  <FileText className="h-5 w-5 text-slate-400" />
                  <span className="max-w-full truncate text-[10px] font-semibold text-slate-600 dark:text-slate-300">{fileLabel(a)}</span>
                </a>
              ) : (
                <button key={i} type="button" onClick={() => window.open(a.url, '_blank', 'noopener')} className="overflow-hidden rounded-lg">
                  <img src={a.url} alt={a.name || 'attachment'} className="h-24 w-full cursor-pointer object-cover transition hover:opacity-90" />
                </button>
              )
            )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function ActivityCard({ r }) {
  const qc = useQueryClient();
  const me = useAuthStore((s) => s.user);
  const isViewer = !!me?.viewOnly;
  const [text, setText] = useState('');
  const [files, setFiles] = useState([]);
  const fileRef = useRef(null);
  const feedRef = useRef(null);

  // Normalize the thread: synthesize the initial "submitted" event (legacy
  // requests lack event rows) and default missing kinds by shape.
  const feed = useMemo(() => {
    const submitted = { _id: `${r._id}-created`, kind: 'event', author: r.createdBy, text: 'submitted this request', createdAt: r.createdAt };
    const rows = (r.comments || []).map((c) => ({ ...c, kind: c.kind || (c.category ? 'feedback' : 'message') }));
    return [submitted, ...rows];
  }, [r]);

  // Keep the newest entry in view on load and whenever something arrives.
  useEffect(() => {
    const el = feedRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [feed.length]);

  const sendMut = useMutation({
    mutationFn: () => {
      const fd = new FormData();
      fd.append('text', text.trim());
      files.forEach((f) => fd.append('files', f));
      return approvalApi.comment(r._id, fd);
    },
    onSuccess: () => {
      setText(''); setFiles([]);
      qc.invalidateQueries({ queryKey: ['admin-approval', r._id] });
    },
    onError: (e) => toast.error(e.response?.data?.message || 'Failed to send'),
  });

  const addFiles = (list) => {
    const incoming = Array.from(list || []);
    if (files.length + incoming.length > 6) toast.error('Up to 6 attachments per message');
    setFiles([...files, ...incoming].slice(0, 6));
  };
  const canSend = (text.trim() !== '' || files.length > 0) && !sendMut.isPending;

  return (
    <Card className="flex max-h-[70vh] flex-col self-start lg:sticky lg:top-20">
      <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4 dark:border-slate-800">
        <h3 className="font-bold text-slate-800 dark:text-white">Activity</h3>
        <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-semibold text-slate-500 dark:bg-slate-800 dark:text-slate-400">{feed.length}</span>
      </div>

      <div ref={feedRef} className="min-h-0 flex-1 space-y-4 overflow-y-auto px-5 py-4">
        {feed.map((item, i) => (
          <FeedItem key={item._id || i} item={item} own={String(item.author?._id || item.author) === String(me?._id)} />
        ))}
      </div>

      {/* Composer: message the submitter, optionally with reference media.
          Hidden for view-only (Chairman) accounts — they can read the thread. */}
      {!isViewer && (
      <div className="border-t border-slate-100 p-4 dark:border-slate-800">
        {files.length > 0 && (
          <div className="mb-2 flex flex-wrap gap-1.5">
            {files.map((f, i) => (
              <span key={i} className="inline-flex max-w-[170px] items-center gap-1 rounded-full bg-slate-100 py-0.5 pl-2.5 pr-1 text-xs font-medium text-slate-600 dark:bg-slate-800 dark:text-slate-300">
                <span className="truncate">{f.name}</span>
                <button type="button" onClick={() => setFiles(files.filter((_, idx) => idx !== i))} aria-label={`Remove ${f.name}`}
                  className="rounded-full p-0.5 hover:bg-slate-200 dark:hover:bg-slate-700"><X className="h-3 w-3" /></button>
              </span>
            ))}
          </div>
        )}
        <div className="flex items-end gap-2">
          <textarea rows={2} value={text} onChange={(e) => setText(e.target.value)} placeholder="Message the submitter…"
            className="input-base flex-1 resize-none" />
          <button type="button" onClick={() => fileRef.current?.click()} title="Attach images or videos"
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-slate-200 text-slate-400 transition-colors hover:bg-slate-50 hover:text-slate-600 dark:border-slate-700 dark:hover:bg-slate-800 dark:hover:text-slate-200">
            <Paperclip className="h-4 w-4" />
          </button>
          <Button size="icon" className="h-11 w-11 shrink-0" aria-label="Send message"
            disabled={!canSend} loading={sendMut.isPending} onClick={() => sendMut.mutate()}>
            {!sendMut.isPending && <Send className="h-4 w-4" />}
          </Button>
        </div>
        <input ref={fileRef} type="file" accept="image/*,video/*" multiple className="hidden"
          onChange={(e) => { addFiles(e.target.files); e.target.value = ''; }} />
      </div>
      )}
    </Card>
  );
}

/* ---------------------------------- Reject modal ------------------------------- */

function RejectModal({ id, onClose, onDone }) {
  const [points, setPoints] = useState([{ text: '', category: 'Content' }]);
  const [loading, setLoading] = useState(false);
  const update = (i, patch) => setPoints(points.map((p, idx) => (idx === i ? { ...p, ...patch } : p)));

  const submit = async () => {
    const clean = points.map((p) => ({ text: p.text.trim(), category: p.category })).filter((p) => p.text);
    if (clean.length === 0) { toast.error('Add at least one feedback point'); return; }
    setLoading(true);
    try {
      await approvalApi.reject(id, clean);
      toast.success('Sent back with feedback');
      onDone();
    } catch (e) { toast.error(e.response?.data?.message || 'Failed'); }
    finally { setLoading(false); }
  };

  return (
    <Modal open onClose={onClose} title="Request changes / Reject">
      <p className="mb-4 text-sm text-slate-400">For each point, choose what needs changing — <span className="font-medium">Image</span> or <span className="font-medium">Content</span> — and describe it. Pick <span className="font-medium">Not usable</span> if the content can't be fixed and should be rejected outright.</p>
      <div className="space-y-2.5">
        {points.map((p, i) => (
          <div key={i} className="flex items-start gap-2">
            <span className="mt-2.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-rose-100 text-xs font-bold text-rose-600 dark:bg-rose-500/20">{i + 1}</span>
            <select className="input-base h-11 w-32 shrink-0 cursor-pointer py-0" value={p.category} onChange={(e) => update(i, { category: e.target.value })}>
              {FEEDBACK_CATEGORIES.map((c) => <option key={c} value={c}>{c === 'Reject' ? 'Not usable' : c}</option>)}
            </select>
            <Input value={p.text} onChange={(e) => update(i, { text: e.target.value })} placeholder={p.category === 'Image' ? 'What to change in the image…' : p.category === 'Reject' ? 'Why it can’t be used…' : 'What to change…'} />
            {points.length > 1 && <button onClick={() => setPoints(points.filter((_, idx) => idx !== i))} className="mt-1.5 rounded-lg p-2 text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800"><Trash2 className="h-4 w-4" /></button>}
          </div>
        ))}
      </div>
      <Button variant="ghost" size="sm" className="mt-2" onClick={() => setPoints([...points, { text: '', category: 'Content' }])}><Plus className="h-4 w-4" /> Add another point</Button>
      <div className="mt-5 flex justify-end gap-2">
        <Button variant="outline" onClick={onClose}>Cancel</Button>
        <Button variant="danger" loading={loading} onClick={submit}>Send back</Button>
      </div>
    </Modal>
  );
}

// An approved post gets a go-live time; the server marks it POSTED when that
// moment arrives, so nobody has to remember to come back and do it.
/**
 * "Mark as posted" is really the question "when did it go out?".
 *
 * It used to assume the answer was this second, which is right for something
 * just published and wrong for everything else: recording a set of posts that
 * went out last week would date every one of them to the afternoon of the data
 * entry, putting the whole set in the wrong place on the calendar and in the
 * wrong period in the reports. So it asks, prefilled with now.
 */
function MarkPostedModal({ request, onClose, onSubmit, saving }) {
  const localNow = () => {
    const d = new Date();
    const pad = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  };
  const [when, setWhen] = useState(localNow());
  const channels = request.platforms?.length ? request.platforms : (request.platform ? [request.platform] : []);

  return (
    <Modal open onClose={onClose} title="Mark as posted">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (!when) { toast.error('Pick when it went out'); return; }
          if (new Date(when).getTime() > Date.now() + 60_000) {
            toast.error('That is in the future — use Schedule post for that');
            return;
          }
          onSubmit(new Date(when).toISOString());
        }}
        className="space-y-4"
      >
        <div className="rounded-xl border border-slate-100 bg-slate-50 p-3 dark:border-slate-800 dark:bg-slate-900/60">
          <p className="text-sm font-bold text-slate-800 dark:text-white">{request.title}</p>
          <p className="mt-0.5 text-xs text-slate-400">
            {channels.join(', ') || 'No channel set'}
            {request.organization?.name ? ` · ${request.organization.name}` : ''}
          </p>
        </div>
        <label className="block">
          <span className="mb-1.5 block text-sm font-medium text-slate-600 dark:text-slate-300">It went out on</span>
          <input type="datetime-local" className="input-base" value={when}
            onChange={(e) => setWhen(e.target.value)} />
        </label>
        <p className="-mt-2 text-xs text-slate-400">
          Uses your local time, and defaults to right now. Wind it back for a post that already
          went out — that is the day it lands on in the calendar and the reports.
        </p>
        <div className="flex justify-end gap-2">
          <Button type="button" variant="outline" onClick={onClose} disabled={saving}>Cancel</Button>
          <Button type="submit" loading={saving}><Send className="h-4 w-4" /> Mark as posted</Button>
        </div>
      </form>
    </Modal>
  );
}

function ScheduleModal({ request, onClose, onDone }) {
  const toLocalInput = (d) => {
    const dt = d ? new Date(d) : new Date(Date.now() + 60 * 60 * 1000);
    const pad = (n) => String(n).padStart(2, '0');
    return `${dt.getFullYear()}-${pad(dt.getMonth() + 1)}-${pad(dt.getDate())}T${pad(dt.getHours())}:${pad(dt.getMinutes())}`;
  };
  const [when, setWhen] = useState(toLocalInput(request.scheduledAt));
  const mut = useMutation({
    mutationFn: () => approvalApi.schedule(request._id, new Date(when).toISOString()),
    onSuccess: () => { toast.success('Scheduled — it will be marked posted automatically'); onDone(); },
    onError: (e) => toast.error(e.response?.data?.message || 'Could not schedule that'),
  });
  const channels = request.platforms?.length ? request.platforms : (request.platform ? [request.platform] : []);

  return (
    <Modal open onClose={onClose} title={request.scheduledAt ? 'Reschedule post' : 'Schedule post'}>
      <form onSubmit={(e) => { e.preventDefault(); if (!when) { toast.error('Pick the date and time'); return; } mut.mutate(); }} className="space-y-4">
        <div className="rounded-xl border border-slate-100 bg-slate-50 p-3 dark:border-slate-800 dark:bg-slate-900/60">
          <p className="text-sm font-bold text-slate-800 dark:text-white">{request.title}</p>
          <p className="mt-0.5 text-xs text-slate-400">
            {channels.join(', ') || 'No channel set'}
            {request.organization?.name ? ` · ${request.organization.name}` : ''}
          </p>
        </div>
        <label className="block">
          <span className="mb-1.5 block text-sm font-medium text-slate-600 dark:text-slate-300">Goes live on</span>
          <input type="datetime-local" className="input-base" value={when} min={toLocalInput(new Date())}
            onChange={(e) => setWhen(e.target.value)} />
        </label>
        <p className="-mt-2 text-xs text-slate-400">
          Uses your local time. Everyone on the request is notified now, and again when it goes live.
        </p>
        <div className="flex justify-end gap-2">
          <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
          <Button type="submit" loading={mut.isPending}>
            <CalendarClock className="h-4 w-4" /> {request.scheduledAt ? 'Reschedule' : 'Schedule'}
          </Button>
        </div>
      </form>
    </Modal>
  );
}

/* ----------------------------- Approve routing modal --------------------------- */

const ALL_PLATFORMS = ['LinkedIn', 'Instagram', 'YouTube', 'Facebook'];

function ApproveRoutingModal({ request, onClose, onApprove, saving }) {
  const [route, setRoute] = useState(''); // 'DESIGNER' | 'SOCIAL_HANDLER'
  const [orgId, setOrgId] = useState('');
  const [platforms, setPlatforms] = useState([]);

  const { data: orgsData } = useQuery({
    queryKey: ['org-options'],
    queryFn: () => organizationApi.options(),
    enabled: route === 'SOCIAL_HANDLER',
  });
  const orgs = orgsData?.organizations || [];

  const togglePlatform = (p) =>
    setPlatforms((prev) => (prev.includes(p) ? prev.filter((x) => x !== p) : [...prev, p]));

  const submit = () => {
    if (!route) { toast.error('Choose who should handle this work'); return; }
    if (route === 'SOCIAL_HANDLER') {
      if (!orgId) { toast.error('Select an organization'); return; }
      if (!platforms.length) { toast.error('Select at least one platform'); return; }
    }
    onApprove(route === 'DESIGNER'
      ? { routeTo: 'DESIGNER' }
      : { routeTo: 'SOCIAL_HANDLER', targetOrganizationId: orgId, targetPlatforms: platforms });
  };

  return (
    <Modal open onClose={onClose} title="Approve & route work">
      <p className="mb-5 text-sm text-slate-500 dark:text-slate-400">
        Approving <span className="font-semibold text-slate-700 dark:text-slate-200">{request.title}</span>. Who should handle the work?
      </p>

      {/* Route selector */}
      <div className="mb-5 grid grid-cols-2 gap-3">
        {[
          { key: 'DESIGNER', icon: Palette, label: 'Designer', desc: 'Notify all designers — anyone can accept and start working.' },
          { key: 'SOCIAL_HANDLER', icon: Megaphone, label: 'Social Handler', desc: 'Route to social handlers for a specific org and platform(s).' },
        ].map(({ key, icon: Icon, label, desc }) => (
          <button
            key={key}
            type="button"
            onClick={() => setRoute(key)}
            className={cn(
              'flex flex-col items-start gap-2 rounded-xl border p-4 text-left transition',
              route === key
                ? 'border-brand-500 bg-brand-50 dark:border-brand-400 dark:bg-brand-500/10'
                : 'border-slate-200 hover:border-slate-300 dark:border-slate-700 dark:hover:border-slate-600'
            )}
          >
            <span className={cn('flex h-9 w-9 items-center justify-center rounded-lg',
              route === key ? 'bg-brand-600 text-white' : 'bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-300')}>
              <Icon className="h-4 w-4" />
            </span>
            <p className={cn('text-sm font-semibold', route === key ? 'text-brand-700 dark:text-brand-300' : 'text-slate-800 dark:text-white')}>{label}</p>
            <p className="text-xs text-slate-500 dark:text-slate-400">{desc}</p>
          </button>
        ))}
      </div>

      {/* Social handler sub-form */}
      {route === 'SOCIAL_HANDLER' && (
        <div className="space-y-4 rounded-xl border border-slate-200 bg-slate-50 p-4 dark:border-slate-700 dark:bg-slate-800/40">
          <div>
            <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">Organization</label>
            <select
              className="input-base w-full"
              value={orgId}
              onChange={(e) => setOrgId(e.target.value)}
            >
              <option value="">— Choose organization —</option>
              {orgs.map((o) => <option key={o._id} value={o._id}>{o.name}</option>)}
            </select>
          </div>

          <div>
            <label className="mb-2 block text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">Platform(s)</label>
            <div className="flex flex-wrap gap-2">
              {ALL_PLATFORMS.map((p) => (
                <button
                  key={p}
                  type="button"
                  onClick={() => togglePlatform(p)}
                  className={cn(
                    'rounded-full border px-3 py-1 text-xs font-semibold transition',
                    platforms.includes(p)
                      ? 'border-brand-500 bg-brand-600 text-white dark:border-brand-400'
                      : 'border-slate-300 bg-white text-slate-600 hover:border-brand-400 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-300'
                  )}
                >
                  {p}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      <div className="mt-5 flex flex-wrap items-center justify-end gap-2">
        <Button variant="outline" onClick={onClose} disabled={saving}>Cancel</Button>
        {/* Routing can wait — the approved design shows the same choice again on
            the page itself, so approving must not be held hostage to deciding it
            now. */}
        <Button variant="ghost" loading={saving} onClick={() => onApprove({})}>
          Approve, decide later
        </Button>
        <Button variant="success" loading={saving} disabled={!route} onClick={submit}>
          <Check className="h-4 w-4" /> Approve &amp; route
        </Button>
      </div>
    </Modal>
  );
}
