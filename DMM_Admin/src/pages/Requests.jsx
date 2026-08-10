import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useSearchParams } from 'react-router-dom';
import {
  MessageSquarePlus, Search, Clock3, Eye, CheckCircle2, XCircle, Flame, X, BriefcaseBusiness,
  IndianRupee, Users, FileImage, ShieldCheck, KeyRound, CircleHelp, CalendarClock,
  Paperclip, ExternalLink, Send,
} from 'lucide-react';
import { institutionRequestApi, organizationApi } from '../api/endpoints.js';
import PageHeader from '../components/layout/PageHeader.jsx';
import { Modal } from '../components/ui/Modal.jsx';
import { Button } from '../components/ui/Button.jsx';
import { Card, Input, Select, Skeleton, EmptyState, Avatar } from '../components/ui/primitives.jsx';
import { cn, formatDate, formatDateTime, timeAgo } from '../lib/utils.js';

// The tiles read left to right as the journey: raised → with the handler → done.
// IN_REVIEW and GETTING_ALLOCATED can no longer be reached (nothing approves a
// request now — it goes straight to the designers), so they are kept only so
// older requests still render a correct chip, and are left off the tiles.
const STATUS_META = {
  OPEN: { label: 'With the designers', icon: Clock3, cls: 'bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-400' },
  WITH_SOCIAL_HANDLER: { label: 'With the social handler', icon: Send, cls: 'bg-violet-100 text-violet-700 dark:bg-violet-500/15 dark:text-violet-300' },
  APPROVED: { label: 'Done', icon: CheckCircle2, cls: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-400' },
  DECLINED: { label: 'Declined', icon: XCircle, cls: 'bg-rose-100 text-rose-700 dark:bg-rose-500/15 dark:text-rose-400' },
};
// Still moving: raised, or handed to a handler to publish. Used for "sort the
// live ones by urgency" and for flagging a missed `neededBy` date — work sitting
// with a handler is still late if it has not gone out.
const IN_FLIGHT = ['OPEN', 'IN_REVIEW', 'GETTING_ALLOCATED', 'WITH_SOCIAL_HANDLER'];
const inFlight = (status) => IN_FLIGHT.includes(status);

// Chips only — statuses the old flow could set, which no new request reaches.
const LEGACY_STATUS_META = {
  IN_REVIEW: { label: 'Being looked at', icon: Eye, cls: 'bg-sky-100 text-sky-700 dark:bg-sky-500/15 dark:text-sky-300' },
  GETTING_ALLOCATED: { label: 'Getting allocated', icon: BriefcaseBusiness, cls: 'bg-violet-100 text-violet-700 dark:bg-violet-500/15 dark:text-violet-300' },
};
const StatusChip = ({ status }) => {
  const m = STATUS_META[status] || LEGACY_STATUS_META[status] || STATUS_META.OPEN;
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

const PRIORITY_CLS = {
  LOW: 'bg-slate-100 text-slate-500 dark:bg-slate-700/50 dark:text-slate-300',
  NORMAL: null,
  HIGH: 'bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-400',
  URGENT: 'bg-rose-100 text-rose-700 dark:bg-rose-500/15 dark:text-rose-400',
};
// Urgent first, then by how long it has been sitting there.
const PRIORITY_RANK = { URGENT: 0, HIGH: 1, NORMAL: 2, LOW: 3 };

/**
 * What the colleges have asked for. Read-only for everyone who can reach it: a
 * request goes straight to the designers when it is raised, so neither an Admin
 * nor the super admin approves, declines or replies to one — the server has no
 * endpoint for it. A super admin sees every college; an Admin only the
 * institutions they hold, decided server-side, so this page renders what it is
 * given.
 */
export default function Requests() {
  const [params, setParams] = useSearchParams();
  // A notification links here with ?request=<id> so the row it refers to stands out.
  const highlightId = params.get('request') || '';

  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('All');
  const [orgFilter, setOrgFilter] = useState('');
  // When the request was raised. Either end works on its own.
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [viewing, setViewing] = useState(null);

  // Only the colleges this admin actually holds — offering the rest would filter
  // to an empty list and imply access they do not have.
  const { data: orgData } = useQuery({
    queryKey: ['org-options', 'mine'],
    queryFn: () => organizationApi.options({ scope: 'mine' }),
  });
  const orgs = orgData?.organizations || [];

  const { data, isLoading } = useQuery({
    queryKey: ['institution-requests', { search, status, orgFilter, from, to }],
    queryFn: () => institutionRequestApi.list({
      search: search || undefined,
      status: status === 'All' ? undefined : status,
      organizationId: orgFilter || undefined,
      from: from || undefined,
      to: to || undefined,
    }),
  });
  const counts = data?.counts || {};

  const requests = useMemo(() => {
    const rows = [...(data?.requests || [])];
    // Anything still open is sorted by urgency; decided items keep date order.
    return rows.sort((a, b) => {
      const aOpen = inFlight(a.status);
      const bOpen = inFlight(b.status);
      if (aOpen !== bOpen) return aOpen ? -1 : 1;
      if (aOpen) {
        const r = (PRIORITY_RANK[a.priority] ?? 2) - (PRIORITY_RANK[b.priority] ?? 2);
        if (r) return r;
      }
      return new Date(b.createdAt) - new Date(a.createdAt);
    });
  }, [data]);

  const filtering = !!search.trim() || !!orgFilter || status !== 'All' || !!from || !!to;

  return (
    <div>
      <PageHeader
        title="College Requests"
        subtitle="What the colleges have asked for. Each one goes straight to the designers on Designs to be Done — this is the record of what was asked, not something to approve."
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
        {/* Raised between — same From/To pair the approvals list uses. */}
        <Input type="date" className="lg:w-40" title="Raised from" aria-label="Raised from"
          value={from} onChange={(e) => setFrom(e.target.value)} />
        <Input type="date" className="lg:w-40" title="Raised up to" aria-label="Raised up to"
          value={to} onChange={(e) => setTo(e.target.value)} />
        {(from || to) && (
          <button type="button" onClick={() => { setFrom(''); setTo(''); }} title="Clear dates" aria-label="Clear dates"
            className="self-start rounded-lg p-2 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-600 dark:hover:bg-slate-800 dark:hover:text-slate-200">
            <X className="h-4 w-4" />
          </button>
        )}
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
            ? 'Try another college or a wider date range — or clear the search.'
            : 'When a college raises a request, it will appear here.'} />
      ) : (
        <div className="space-y-3">
          {requests.map((r) => {
            const Icon = CATEGORY_ICON[r.category] || CircleHelp;
            const open = inFlight(r.status);
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
                      {assignedUsersOf(r).length > 0 && (
                        <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                          Assigned to: {assignedUsersOf(r).map((u) => u.name).join(', ')}
                        </p>
                      )}
                      {attachmentsOf(r).length > 0 && (
                        <button type="button" onClick={() => setViewing(r)}
                          className="mt-1 inline-flex items-center gap-1 text-xs font-semibold text-brand-600 hover:underline dark:text-brand-400">
                          <Paperclip className="h-3 w-3" />
                          {attachmentsOf(r).length} attached reference file{attachmentsOf(r).length === 1 ? '' : 's'} — view
                        </button>
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

                <div className="mt-3 flex flex-wrap gap-2">
                  {/* Always available, decided or not — the full ask, the event
                      details and everything the college attached. */}
                  <Button size="sm" variant="outline" onClick={() => setViewing(r)}>
                    <Eye className="h-4 w-4" /> Open request
                  </Button>
                </div>

              </Card>
            );
          })}
        </div>
      )}

      {viewing && <RequestDetailModal request={viewing} onClose={() => setViewing(null)} />}
    </div>
  );
}

// Whatever the college attached. Kept as a helper because the field is left
// undefined rather than empty when nothing was uploaded.
const attachmentsOf = (r) => (Array.isArray(r?.attachments) ? r.attachments : []);
const assignedUsersOf = (r) => (Array.isArray(r?.assignedUsers) ? r.assignedUsers : []);

// An attachment is previewable when it is an image; anything else (a PDF, a
// brief, a spreadsheet) gets a labelled tile that opens in a new tab.
const isImageAttachment = (a) =>
  a?.mediaType === 'image' || /\.(png|jpe?g|webp|gif|svg|avif)$/i.test(a?.url || a?.name || '');

const Detail = ({ label, children }) => (
  <div>
    <p className="text-[11px] font-bold uppercase tracking-wide text-slate-400">{label}</p>
    <p className="mt-0.5 text-sm text-slate-700 dark:text-slate-200">{children}</p>
  </div>
);

/**
 * The whole request, opened. The list is a triage view — it deliberately shows
 * only enough to sort by — so this is where everything the college actually sent
 * lives, the reference photos above all. Read-only, and that is the whole page:
 * a request goes straight to the designers, so there is nothing here to decide.
 */
function RequestDetailModal({ request: r, onClose }) {
  const files = attachmentsOf(r);
  const images = files.filter(isImageAttachment);
  const others = files.filter((a) => !isImageAttachment(a));
  const brief = [r.workType === 'DIGITAL_MEDIA' ? 'Digital media' : 'Print media', r.workCategory, r.workItem].filter(Boolean).join(' · ');

  return (
    <Modal open onClose={onClose} title={r.title} size="lg">
      <div className="space-y-5">
        <div className="flex flex-wrap items-center gap-2">
          <StatusChip status={r.status} />
          {PRIORITY_CLS[r.priority] && (
            <span className={cn('inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-bold', PRIORITY_CLS[r.priority])}>
              {r.priority === 'URGENT' && <Flame className="h-3 w-3" />} {r.priority.charAt(0) + r.priority.slice(1).toLowerCase()}
            </span>
          )}
          {/* The exact moment, not only how long ago — this is the figure people
              quote when they ask why something took as long as it did. */}
          <span className="text-xs text-slate-400">Raised {formatDateTime(r.createdAt)} · {timeAgo(r.createdAt)}</span>
        </div>

        <div className="grid gap-4 rounded-xl bg-slate-50 p-4 dark:bg-slate-800/50 sm:grid-cols-2">
          <Detail label="College">{r.organization?.name || '—'}</Detail>
          <Detail label="Raised on">{formatDateTime(r.createdAt)}</Detail>
          <Detail label="Raised by">
            <span className="inline-flex items-center gap-1.5">
              {r.raisedBy?.name ? <Avatar src={r.raisedBy.avatar} name={r.raisedBy.name} size="sm" className="h-5 w-5 ring-0" /> : null}
              {r.raisedBy?.name || '—'}
            </span>
          </Detail>
          <Detail label="Kind">{r.category}</Detail>
          {brief && <Detail label="Work">{brief}</Detail>}
          {r.department && <Detail label="Department">{r.department}</Detail>}
          {r.neededBy && <Detail label="Needed by">{formatDate(r.neededBy)}</Detail>}
          {assignedUsersOf(r).length > 0 && <Detail label="Assigned to">{assignedUsersOf(r).map((u) => u.name).join(', ')}</Detail>}
        </div>

        {r.event && (
          <div className="rounded-xl border border-slate-200 p-4 dark:border-slate-700">
            <p className="mb-2 flex items-center gap-1.5 text-xs font-bold uppercase tracking-wide text-slate-400">
              <CalendarClock className="h-3.5 w-3.5" /> Event
            </p>
            <div className="grid gap-3 sm:grid-cols-2">
              <Detail label="Name">{r.eventName || 'Unnamed event'}</Detail>
              {r.eventDate && <Detail label="Date">{formatDate(r.eventDate)}</Detail>}
              {r.place && <Detail label="Place">{r.place}</Detail>}
              {r.eventCoordinatorName && <Detail label="Coordinator">{r.eventCoordinatorName}</Detail>}
            </div>
          </div>
        )}

        {r.details && (
          <div>
            <p className="mb-1.5 text-[11px] font-bold uppercase tracking-wide text-slate-400">What they asked for</p>
            <p className="whitespace-pre-wrap text-sm text-slate-700 dark:text-slate-200">{r.details}</p>
          </div>
        )}

        {/* The reference material — the reason this view exists. */}
        <div>
          <p className="mb-2 flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wide text-slate-400">
            <Paperclip className="h-3.5 w-3.5" /> Reference files{files.length > 0 ? ` · ${files.length}` : ''}
          </p>
          {files.length === 0 ? (
            <p className="text-sm text-slate-400">Nothing was attached to this request.</p>
          ) : (
            <div className="space-y-3">
              {images.length > 0 && (
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                  {images.map((a, i) => (
                    <a key={a.url || i} href={a.url} target="_blank" rel="noreferrer"
                      title={a.name || 'Open full size'}
                      className="group relative block overflow-hidden rounded-xl border border-slate-200 dark:border-slate-700">
                      <img src={a.url} alt={a.name || `Reference ${i + 1}`} className="aspect-video w-full object-cover transition-transform group-hover:scale-105" />
                      <span className="absolute inset-x-0 bottom-0 truncate bg-slate-900/70 px-2 py-1 text-[11px] text-white opacity-0 transition-opacity group-hover:opacity-100">
                        {a.name || 'Open full size'}
                      </span>
                    </a>
                  ))}
                </div>
              )}
              {others.map((a, i) => (
                <a key={a.url || i} href={a.url} target="_blank" rel="noreferrer"
                  className="flex items-center gap-2 rounded-xl border border-slate-200 px-3 py-2 text-sm font-medium text-slate-600 transition-colors hover:border-brand-300 hover:bg-brand-50/50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-brand-500/5">
                  <FileImage className="h-4 w-4 shrink-0 text-slate-400" />
                  <span className="min-w-0 flex-1 truncate">{a.name || 'Attachment'}</span>
                  <ExternalLink className="h-3.5 w-3.5 shrink-0 text-slate-400" />
                </a>
              ))}
            </div>
          )}
        </div>

        {r.response && (
          <div className="rounded-xl border border-slate-100 bg-slate-50/70 p-3 dark:border-slate-800 dark:bg-slate-800/40">
            <p className="text-xs font-semibold text-slate-500 dark:text-slate-400">
              {r.reviewedBy?.name || 'Reply'}{r.reviewedAt ? ` · ${timeAgo(r.reviewedAt)}` : ''}
            </p>
            <p className="mt-1 whitespace-pre-wrap text-sm text-slate-700 dark:text-slate-200">{r.response}</p>
          </div>
        )}

        <div className="flex flex-wrap justify-end gap-2 border-t border-slate-100 pt-4 dark:border-slate-800">
          <Button type="button" variant="outline" onClick={onClose}>Close</Button>
        </div>
      </div>
    </Modal>
  );
}
