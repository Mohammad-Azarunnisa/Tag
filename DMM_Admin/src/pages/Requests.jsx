import { useMemo, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useSearchParams } from 'react-router-dom';
import toast from 'react-hot-toast';
import {
  MessageSquarePlus, Search, Clock3, Eye, CheckCircle2, XCircle, Flame, X,
  IndianRupee, Users, FileImage, ShieldCheck, KeyRound, CircleHelp, CalendarClock,
} from 'lucide-react';
import { institutionRequestApi, organizationApi } from '../api/endpoints.js';
import { useAuthStore } from '../store/authStore.js';
import PageHeader from '../components/layout/PageHeader.jsx';
import { Modal } from '../components/ui/Modal.jsx';
import { Button } from '../components/ui/Button.jsx';
import { Card, Input, Select, Skeleton, EmptyState, Avatar } from '../components/ui/primitives.jsx';
import { cn, formatDate, timeAgo } from '../lib/utils.js';

const STATUS_META = {
  OPEN: { label: 'Waiting on you', icon: Clock3, cls: 'bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-400' },
  IN_REVIEW: { label: 'Being looked at', icon: Eye, cls: 'bg-sky-100 text-sky-700 dark:bg-sky-500/15 dark:text-sky-300' },
  APPROVED: { label: 'Approved', icon: CheckCircle2, cls: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-400' },
  DECLINED: { label: 'Declined', icon: XCircle, cls: 'bg-rose-100 text-rose-700 dark:bg-rose-500/15 dark:text-rose-400' },
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

const CATEGORY_ICON = {
  Budget: IndianRupee, People: Users, Content: FileImage,
  Permission: ShieldCheck, Access: KeyRound, Other: CircleHelp,
};
const CATEGORIES = ['Budget', 'People', 'Content', 'Permission', 'Access', 'Other'];

const PRIORITY_CLS = {
  LOW: 'bg-slate-100 text-slate-500 dark:bg-slate-700/50 dark:text-slate-300',
  NORMAL: null,
  HIGH: 'bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-400',
  URGENT: 'bg-rose-100 text-rose-700 dark:bg-rose-500/15 dark:text-rose-400',
};
// Urgent first, then by how long it has been sitting there.
const PRIORITY_RANK = { URGENT: 0, HIGH: 1, NORMAL: 2, LOW: 3 };

/**
 * What the colleges have asked for, and what still needs an answer. A super admin
 * sees every college; an Admin only the institutions they hold — the server
 * decides which, so this page just renders what it is given.
 */
export default function Requests() {
  const qc = useQueryClient();
  const me = useAuthStore((s) => s.user);
  const canDecide = !me?.viewOnly;
  const [params, setParams] = useSearchParams();
  // A notification links here with ?request=<id> so the row it refers to stands out.
  const highlightId = params.get('request') || '';

  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('All');
  const [category, setCategory] = useState('');
  const [orgFilter, setOrgFilter] = useState('');
  const [deciding, setDeciding] = useState(null);

  const { data: orgData } = useQuery({ queryKey: ['org-options'], queryFn: organizationApi.options });
  const orgs = orgData?.organizations || [];

  const { data, isLoading } = useQuery({
    queryKey: ['institution-requests', { search, status, category, orgFilter }],
    queryFn: () => institutionRequestApi.list({
      search: search || undefined,
      status: status === 'All' ? undefined : status,
      category: category || undefined,
      organizationId: orgFilter || undefined,
    }),
  });
  const counts = data?.counts || {};

  const requests = useMemo(() => {
    const rows = [...(data?.requests || [])];
    // Anything still open is sorted by urgency; decided items keep date order.
    return rows.sort((a, b) => {
      const aOpen = ['OPEN', 'IN_REVIEW'].includes(a.status);
      const bOpen = ['OPEN', 'IN_REVIEW'].includes(b.status);
      if (aOpen !== bOpen) return aOpen ? -1 : 1;
      if (aOpen) {
        const r = (PRIORITY_RANK[a.priority] ?? 2) - (PRIORITY_RANK[b.priority] ?? 2);
        if (r) return r;
      }
      return new Date(b.createdAt) - new Date(a.createdAt);
    });
  }, [data]);

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ['institution-requests'] });
    qc.invalidateQueries({ queryKey: ['notifications'] });
  };
  const filtering = !!search.trim() || !!category || !!orgFilter || status !== 'All';

  return (
    <div>
      <PageHeader
        title="College Requests"
        subtitle="What the colleges have asked for — budget, people, permission, access. Approve or decline with a reply they can act on."
      />

      <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
        {Object.entries(STATUS_META).map(([key, m]) => (
          <Card key={key} role="button" tabIndex={0}
            onClick={() => setStatus(status === key ? 'All' : key)}
            onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setStatus(status === key ? 'All' : key); } }}
            className={cn('cursor-pointer p-4 transition hover:-translate-y-0.5 hover:shadow-glow', status === key && 'ring-2 ring-brand-500/40')}>
            <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">{m.label}</p>
            <p className="mt-1 text-3xl font-extrabold text-slate-800 dark:text-white">{counts[key] || 0}</p>
          </Card>
        ))}
      </div>

      <div className="mb-5 flex flex-col gap-3 lg:flex-row">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 z-10 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <Input placeholder="Search what was asked for…" className="pl-9" value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
        <Select className="lg:w-52" value={orgFilter} onChange={(e) => setOrgFilter(e.target.value)} title="Filter by college">
          <option value="">All colleges</option>
          {orgs.map((o) => <option key={o._id} value={o._id}>{o.name}</option>)}
        </Select>
        <Select className="lg:w-44" value={category} onChange={(e) => setCategory(e.target.value)} title="Filter by kind">
          <option value="">All kinds</option>
          {CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
        </Select>
      </div>

      {highlightId && (
        <div className="mb-4 flex items-center gap-2 rounded-xl border border-brand-200 bg-brand-50/70 px-3 py-2 text-sm text-brand-800 dark:border-brand-500/30 dark:bg-brand-500/10 dark:text-brand-300">
          Showing the request from your notification.
          <button onClick={() => setParams({}, { replace: true })} className="ml-auto rounded-lg p-1 hover:bg-brand-100 dark:hover:bg-brand-500/20" aria-label="Clear highlight">
            <X className="h-4 w-4" />
          </button>
        </div>
      )}

      {isLoading ? (
        <div className="space-y-3">{Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-32" />)}</div>
      ) : requests.length === 0 ? (
        <EmptyState icon={MessageSquarePlus}
          title={filtering ? 'Nothing matches these filters' : 'No requests yet'}
          description={filtering
            ? 'Try another college or kind — or clear the search.'
            : 'When a college needs something from you, it will appear here.'} />
      ) : (
        <div className="space-y-3">
          {requests.map((r) => {
            const Icon = CATEGORY_ICON[r.category] || CircleHelp;
            const open = ['OPEN', 'IN_REVIEW'].includes(r.status);
            const overdue = r.neededBy && new Date(r.neededBy) < new Date() && open;
            const brief = [r.workType === 'DIGITAL_MEDIA' ? 'Digital media' : 'Print media', r.workCategory, r.workItem].filter(Boolean).join(' · ');
            return (
              <Card key={r._id} className={cn('p-4', String(r._id) === highlightId && 'ring-2 ring-brand-500/50')}>
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="flex min-w-0 gap-3">
                    <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400">
                      <Icon className="h-4 w-4" />
                    </span>
                    <div className="min-w-0">
                      <p className="font-bold text-slate-800 dark:text-white">{r.title}</p>
                      <p className="mt-0.5 flex flex-wrap items-center gap-x-1.5 text-xs text-slate-400">
                        <span className="font-semibold text-slate-500 dark:text-slate-300">{r.organization?.name || 'Unknown college'}</span>
                        · {r.category} · {timeAgo(r.createdAt)}
                        {r.raisedBy?.name ? <> · <Avatar src={r.raisedBy.avatar} name={r.raisedBy.name} size="sm" className="h-4 w-4 ring-0" /> {r.raisedBy.name}</> : null}
                      </p>
                      {brief && <p className="mt-1 text-xs font-semibold text-brand-600 dark:text-brand-300">{brief}</p>}
                      {r.event && (
                        <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                          Event: {r.eventName || 'Unnamed event'}{r.eventDate ? ` · ${formatDate(r.eventDate)}` : ''}{r.place ? ` · ${r.place}` : ''}
                        </p>
                      )}
                      {r.department && <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">Department: {r.department}</p>}
                      {Array.isArray(r.attachments) && r.attachments.length > 0 && (
                        <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">{r.attachments.length} attached reference file{r.attachments.length === 1 ? '' : 's'}</p>
                      )}
                    </div>
                  </div>
                  <div className="flex shrink-0 flex-wrap items-center gap-2">
                    {PRIORITY_CLS[r.priority] && (
                      <span className={cn('inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-bold', PRIORITY_CLS[r.priority])}>
                        {r.priority === 'URGENT' && <Flame className="h-3 w-3" />} {r.priority.charAt(0) + r.priority.slice(1).toLowerCase()}
                      </span>
                    )}
                    <StatusChip status={r.status} />
                  </div>
                </div>

                {r.details && <p className="mt-3 whitespace-pre-wrap text-sm text-slate-600 dark:text-slate-300">{r.details}</p>}

                {r.neededBy && (
                  <p className={cn('mt-2 inline-flex items-center gap-1.5 text-xs font-semibold',
                    overdue ? 'text-rose-600 dark:text-rose-400' : 'text-slate-500 dark:text-slate-400')}>
                    <CalendarClock className="h-3.5 w-3.5" />
                    Needed by {formatDate(r.neededBy)}{overdue ? ' — that date has passed' : ''}
                  </p>
                )}

                {r.response && (
                  <div className="mt-3 rounded-xl border border-slate-100 bg-slate-50/70 p-3 dark:border-slate-800 dark:bg-slate-800/40">
                    <p className="text-xs font-semibold text-slate-500 dark:text-slate-400">
                      {r.reviewedBy?.name || 'Reply'}{r.reviewedAt ? ` · ${timeAgo(r.reviewedAt)}` : ''}
                    </p>
                    <p className="mt-1 text-sm text-slate-700 dark:text-slate-200">{r.response}</p>
                  </div>
                )}

                {canDecide && open && (
                  <div className="mt-3 flex flex-wrap gap-2">
                    <Button size="sm" onClick={() => setDeciding({ request: r, mode: 'approve' })}>
                      <CheckCircle2 className="h-4 w-4" /> Approve
                    </Button>
                    <Button size="sm" variant="outline" onClick={() => setDeciding({ request: r, mode: 'decline' })}>
                      <XCircle className="h-4 w-4 text-rose-500" /> Decline
                    </Button>
                    {r.status === 'OPEN' && (
                      <Button size="sm" variant="ghost" onClick={() => setDeciding({ request: r, mode: 'review' })}>
                        <Eye className="h-4 w-4" /> Mark as looking at it
                      </Button>
                    )}
                  </div>
                )}
              </Card>
            );
          })}
        </div>
      )}

      {deciding && (
        <DecideModal {...deciding} onClose={() => setDeciding(null)} onSaved={() => { setDeciding(null); refresh(); }} />
      )}
    </div>
  );
}

// The reply matters more than the verdict: it is what the college acts on, which
// is why declining without one is refused.
function DecideModal({ request, mode, onClose, onSaved }) {
  const [response, setResponse] = useState('');
  const mutation = useMutation({
    mutationFn: () => institutionRequestApi.respond(request._id, mode, response),
    onSuccess: () => {
      toast.success(mode === 'approve' ? 'Approved — they have been told'
        : mode === 'decline' ? 'Declined — they have your reason'
          : 'Marked as being looked at');
      onSaved();
    },
    onError: (e) => toast.error(e.response?.data?.message || 'Could not save that'),
  });

  const TITLES = { approve: 'Approve this request', decline: 'Decline this request', review: 'Mark as being looked at' };
  const required = mode === 'decline';

  return (
    <Modal open onClose={onClose} title={TITLES[mode]} size="md">
      <form onSubmit={(e) => {
        e.preventDefault();
        if (required && !response.trim()) { toast.error('Tell them why, so they know what to do next'); return; }
        mutation.mutate();
      }} className="space-y-4">
        <div className="rounded-xl bg-slate-50 p-3 dark:bg-slate-800/60">
          <p className="font-semibold text-slate-800 dark:text-white">{request.title}</p>
          <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
            {request.organization?.name}
            {request.raisedBy?.name ? ` · ${request.raisedBy.name}` : ''}
            {` · ${request.category}`}
          </p>
        </div>

        <div>
          <label className="mb-1.5 block text-sm font-medium text-slate-600 dark:text-slate-300">
            Your reply {required ? '' : <span className="font-normal text-slate-400">· optional</span>}
          </label>
          <textarea className="input-base min-h-[110px]" value={response} onChange={(e) => setResponse(e.target.value)}
            placeholder={mode === 'approve'
              ? 'e.g. Approved up to ₹15,000 — raise the bill through accounts.'
              : mode === 'decline'
                ? 'Say why, and what they could do instead.'
                : 'e.g. Checking with the chairman this week.'} />
        </div>

        <p className="text-xs text-slate-400">The person who raised it gets a notification with your reply.</p>

        <div className="flex justify-end gap-2 pt-2">
          <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
          <Button type="submit" variant={mode === 'decline' ? 'danger' : 'default'} loading={mutation.isPending}>
            {mode === 'approve' ? 'Approve' : mode === 'decline' ? 'Decline' : 'Save'}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
