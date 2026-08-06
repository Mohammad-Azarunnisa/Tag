import { useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  BriefcaseBusiness, Inbox, Search, Images as ImagesIcon, Clock, Play, RefreshCw, CheckCircle2, Send, X,
  Palette, UserCheck, FileText,
} from 'lucide-react';
import { approvalApi, organizationApi } from '../api/endpoints.js';
import PageHeader from '../components/layout/PageHeader.jsx';
import { Button } from '../components/ui/Button.jsx';
import { Card, Input, Select, Avatar, Badge, Skeleton, EmptyState } from '../components/ui/primitives.jsx';
import WorkAssignmentModal from '../components/approvals/WorkAssignmentModal.jsx';
import { formatDate, cn, isVideo, isDoc, platformsOf } from '../lib/utils.js';

export const STATUS_STYLES = {
  IN_DESIGN: 'bg-indigo-100 text-indigo-700 dark:bg-indigo-500/15 dark:text-indigo-300',
  PENDING: 'bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300',
  RESUBMITTED: 'bg-sky-100 text-sky-700 dark:bg-sky-500/15 dark:text-sky-300',
  APPROVED: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300',
  REJECTED: 'bg-rose-100 text-rose-700 dark:bg-rose-500/15 dark:text-rose-300',
  POSTED: 'bg-teal-100 text-teal-700 dark:bg-teal-500/15 dark:text-teal-300',
  DELIVERED: 'bg-green-100 text-green-700 dark:bg-green-500/15 dark:text-green-300',
};
// Human labels for each status (falls back to the raw code for anything unmapped).
export const STATUS_LABELS = {
  IN_DESIGN: 'In design',
  PENDING: 'Pending review',
  RESUBMITTED: 'Resubmitted',
  APPROVED: 'Approved',
  REJECTED: 'Needs changes',
  POSTED: 'Posted',
  DELIVERED: 'Delivered',
};
export const StatusPill = ({ status, className }) => (
  <span className={cn('inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-bold uppercase tracking-wide', STATUS_STYLES[status] || 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300', className)}>{STATUS_LABELS[status] || status}</span>
);

// What a rejection feedback point asks the submitter to change.
export const FEEDBACK_CATEGORIES = ['Image', 'Content', 'Other', 'Reject'];
const FEEDBACK_CATEGORY_STYLES = {
  Image: 'bg-sky-100 text-sky-700 dark:bg-sky-500/15 dark:text-sky-300',
  Content: 'bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300',
  Other: 'bg-slate-100 text-slate-600 dark:bg-slate-700 dark:text-slate-300',
  Reject: 'bg-rose-100 text-rose-700 dark:bg-rose-500/15 dark:text-rose-300',
};
export function FeedbackCategoryTag({ category }) {
  if (!category) return null;
  return (
    <span className={cn('inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide', FEEDBACK_CATEGORY_STYLES[category] || FEEDBACK_CATEGORY_STYLES.Other)}>
      {category === 'Reject' ? 'Not usable' : category}
    </span>
  );
}

const PLATFORMS = ['All', 'LinkedIn', 'Instagram', 'YouTube', 'Facebook'];

// The two approval pipelines. POST = ready-to-publish content. DESIGN =
// creative work that, once approved, is assigned to a platform handler who
// then raises the linked post request.
const TYPE_TABS = [
  { key: 'POST', label: 'Post approvals', icon: Send },
  { key: 'DESIGN', label: 'Design approvals', icon: Palette },
];

const TABS = [
  { value: 'All', label: 'All' },
  // REVIEW is the backend's combined PENDING + RESUBMITTED triage queue.
  { value: 'REVIEW', label: 'Needs review' },
  // IN_DESIGN / DELIVERED only exist in the design pipeline, so they show only
  // when the Design tab is active.
  { value: 'IN_DESIGN', label: 'In design', design: true },
  { value: 'PENDING', label: 'Pending' },
  { value: 'RESUBMITTED', label: 'Resubmitted' },
  { value: 'APPROVED', label: 'Approved' },
  { value: 'REJECTED', label: 'Rejected' },
  { value: 'POSTED', label: 'Posted' },
  { value: 'DELIVERED', label: 'Delivered', design: true },
];

// Stat tiles double as shortcuts to their status tab (Total -> All).
const TILES = [
  { key: 'ALL', tab: 'All', label: 'Total', icon: Inbox, tone: 'text-slate-400' },
  { key: 'PENDING', tab: 'PENDING', label: 'Pending', icon: Clock, tone: 'text-amber-500' },
  { key: 'RESUBMITTED', tab: 'RESUBMITTED', label: 'Resubmitted', icon: RefreshCw, tone: 'text-sky-500' },
  { key: 'APPROVED', tab: 'APPROVED', label: 'Approved', icon: CheckCircle2, tone: 'text-emerald-500' },
  { key: 'POSTED', tab: 'POSTED', label: 'Posted', icon: Send, tone: 'text-violet-500' },
];

const EMPTY_COPY = {
  All: 'No approval requests yet. Content submitted by any organization will appear here.',
  REVIEW: 'Nothing is awaiting a decision right now.',
  IN_DESIGN: 'No designs are in progress with a designer right now.',
  PENDING: 'Nothing is awaiting review right now.',
  RESUBMITTED: 'No resubmissions are waiting for a second look.',
  APPROVED: 'No approved content yet.',
  REJECTED: 'Nothing is currently sent back for changes.',
  POSTED: 'Nothing has been marked as posted yet.',
  DELIVERED: 'No approved designs have been delivered to a coordinator yet.',
};

// First media item of a request as a small table thumbnail.
function Thumb({ media }) {
  if (!media) {
    return (
      <div className="flex h-10 w-14 shrink-0 items-center justify-center rounded-lg bg-slate-100 dark:bg-slate-800">
        <ImagesIcon className="h-4 w-4 text-slate-300 dark:text-slate-600" />
      </div>
    );
  }
  return (
    <div className="relative h-10 w-14 shrink-0 overflow-hidden rounded-lg bg-slate-100 dark:bg-slate-800">
      {isVideo(media) ? (
        <>
          <video src={media.url} className="h-full w-full object-cover" muted />
          <span className="absolute inset-0 flex items-center justify-center bg-black/25"><Play className="h-3.5 w-3.5 text-white" /></span>
        </>
      ) : isDoc(media) ? (
        <span className="flex h-full items-center justify-center"><FileText className="h-4 w-4 text-slate-400" /></span>
      ) : (
        <img src={media.url} alt="" className="h-full w-full object-cover" />
      )}
    </div>
  );
}

export default function Approvals() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [searchParams] = useSearchParams();
  const urlStatus = searchParams.get('status');
  const [showAssign, setShowAssign] = useState(false);
  const [filters, setFilters] = useState({
    search: '',
    status: TABS.some((t) => t.value === urlStatus) ? urlStatus : 'All',
    type: searchParams.get('type') === 'DESIGN' ? 'DESIGN' : 'POST',
    platform: 'All',
    organizationId: '',
    from: '',
    to: '',
  });
  const [page, setPage] = useState(1);
  const [limit, setLimit] = useState(10);

  // Any filter change restarts from page 1 so pagination never points past the results.
  const setFilter = (patch) => { setFilters((f) => ({ ...f, ...patch })); setPage(1); };

  const { data: orgData } = useQuery({ queryKey: ['organizations', 'picker'], queryFn: () => organizationApi.list() });
  const orgs = orgData?.organizations || [];

  // Strip empty filters so they aren't sent as params (keeps "all orgs" behaviour).
  const params = { ...filters, page, limit };
  Object.keys(params).forEach((k) => { if (params[k] === '' || params[k] === 'All') delete params[k]; });

  const { data, isLoading } = useQuery({
    queryKey: ['admin-approvals', filters, page, limit],
    queryFn: () => approvalApi.list(params),
    placeholderData: (prev) => prev,
    // Keep tiles/statuses current while the page is open (no manual refresh).
    refetchInterval: 10000,
    refetchIntervalInBackground: false,
  });
  const requests = data?.requests || [];
  const counts = data?.counts || {};
  const typeCounts = data?.typeCounts || {};
  const total = data?.total || 0;
  const pages = data?.pages || 1;
  const firstRow = total === 0 ? 0 : (page - 1) * limit + 1;
  const lastRow = Math.min(page * limit, total);

  return (
    <div>
      <PageHeader
        title="Approvals"
        subtitle="As the head of all organizations, review approvals or assign work to designers and social handlers."
        actions={<Button onClick={() => setShowAssign(true)}><BriefcaseBusiness className="h-4 w-4" /> Assign Work</Button>}
      />

      {/* Pipeline switch: post approvals vs design approvals */}
      <div className="mb-5 inline-flex rounded-2xl border border-slate-200 bg-white p-1.5 shadow-soft dark:border-slate-800 dark:bg-slate-900">
        {TYPE_TABS.map((t) => (
          <button
            key={t.key} type="button"
            onClick={() => setFilter({ type: t.key, status: 'All' })}
            className={cn(
              'flex items-center gap-2 rounded-xl px-4 py-2 text-sm font-semibold transition',
              filters.type === t.key
                ? 'bg-gradient-to-b from-brand-500 to-brand-600 text-white shadow-soft'
                : 'text-slate-500 hover:text-slate-700 dark:hover:text-slate-300'
            )}
          >
            <t.icon className="h-4 w-4" /> {t.label}
            <span className={cn('rounded-full px-2 py-0.5 text-xs font-bold', filters.type === t.key ? 'bg-white/20 text-white' : 'bg-slate-100 text-slate-500 dark:bg-slate-800')}>
              {typeCounts[t.key] ?? 0}
            </span>
          </button>
        ))}
      </div>

      {/* Stat tiles — click to jump to that status tab */}
      <div className="mb-5 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        {TILES.map((t) => {
          const Icon = t.icon;
          const active = filters.status === t.tab;
          return (
            <Card key={t.key} role="button" tabIndex={0} onClick={() => setFilter({ status: t.tab })}
              onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setFilter({ status: t.tab }); } }}
              className={cn('cursor-pointer p-4 transition hover:shadow-glow', active && 'ring-2 ring-brand-500/40')}>
              <div className="flex items-center justify-between">
                <p className="text-[11px] font-bold uppercase tracking-wide text-slate-400">{t.label}</p>
                <Icon className={cn('h-4 w-4', t.tone)} />
              </div>
              <p className="mt-2 text-3xl font-extrabold text-slate-800 dark:text-white">{counts[t.key] ?? 0}</p>
            </Card>
          );
        })}
      </div>

      {/* Status tabs + filters */}
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <div className="flex flex-wrap items-center gap-1 rounded-xl bg-slate-100 p-1 dark:bg-slate-800">
          {TABS.filter((t) => !t.design || filters.type === 'DESIGN').map((t) => (
            <button key={t.value} type="button" onClick={() => setFilter({ status: t.value })}
              className={cn('rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors',
                filters.status === t.value
                  ? 'bg-white text-brand-700 shadow-soft dark:bg-slate-900 dark:text-brand-300'
                  : 'text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200')}>
              {t.label}
            </button>
          ))}
        </div>
        <div className="ml-auto flex flex-wrap items-center gap-2">
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 z-10 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <Input placeholder="Search title or caption..." className="w-52 pl-9" value={filters.search} onChange={(e) => setFilter({ search: e.target.value })} />
          </div>
          <Select className="w-44" value={filters.organizationId} onChange={(e) => setFilter({ organizationId: e.target.value })}>
            <option value="">All colleges</option>
            {orgs.map((o) => <option key={o._id} value={o._id}>{o.name}</option>)}
          </Select>
          <Select className="w-36" value={filters.platform} onChange={(e) => setFilter({ platform: e.target.value })}>
            {PLATFORMS.map((p) => <option key={p} value={p}>{p === 'All' ? 'All platforms' : p}</option>)}
          </Select>
          <Input type="date" className="w-36" title="From date" value={filters.from} onChange={(e) => setFilter({ from: e.target.value })} />
          <Input type="date" className="w-36" title="To date" value={filters.to} onChange={(e) => setFilter({ to: e.target.value })} />
          {(filters.from || filters.to) && (
            <button type="button" onClick={() => setFilter({ from: '', to: '' })} title="Clear dates"
              className="rounded-lg p-2 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-600 dark:hover:bg-slate-800 dark:hover:text-slate-200">
              <X className="h-4 w-4" />
            </button>
          )}
        </div>
      </div>

      {!isLoading && requests.length === 0 ? (
        <EmptyState
          icon={Inbox}
          title="Nothing to show"
          description={EMPTY_COPY[filters.status] || EMPTY_COPY.All}
          action={<Button onClick={() => setShowAssign(true)}><BriefcaseBusiness className="h-4 w-4" /> Assign Work</Button>}
        />
      ) : (
        <Card className="overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-100 text-left text-xs font-bold uppercase tracking-wide text-slate-400 dark:border-slate-800">
                  <th className="px-4 py-3">Post</th>
                  <th className="px-4 py-3">Platform</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3">Submitted</th>
                  <th className="px-4 py-3">Updated</th>
                  <th className="px-4 py-3">By</th>
                </tr>
              </thead>
              <tbody>
                {isLoading
                  ? Array.from({ length: 8 }).map((_, i) => (
                      <tr key={i} className="border-b border-slate-100 last:border-0 dark:border-slate-800">
                        <td colSpan={6} className="px-4 py-3"><Skeleton className="h-10" /></td>
                      </tr>
                    ))
                  : requests.map((r) => (
                      <tr key={r._id} onClick={() => navigate(`/approvals/${r._id}`)}
                        className="cursor-pointer border-b border-slate-100 transition-colors last:border-0 hover:bg-slate-50 dark:border-slate-800 dark:hover:bg-slate-800/50">
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-3">
                            <Thumb media={r.images?.[0]} />
                            <div className="min-w-0">
                              <p className="max-w-[260px] truncate font-semibold text-slate-800 dark:text-white">{r.title}</p>
                              <p className="flex items-center gap-1.5 text-xs text-slate-400">
                                <span className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: r.organization?.color || '#7c3aed' }} />
                                <span className="max-w-[220px] truncate">{r.organization?.name || '—'}</span>
                              </p>
                              {r.type === 'DESIGN' && r.designer && (
                                <p className="mt-0.5 flex items-center gap-1 text-[11px] font-medium text-indigo-500">
                                  <Palette className="h-3 w-3" /> {r.designer?.name}
                                </p>
                              )}
                              {r.type === 'DESIGN' && r.assignedTo && (
                                <p className="mt-0.5 flex items-center gap-1 text-[11px] font-medium text-violet-500">
                                  <UserCheck className="h-3 w-3" /> {r.assignedTo?.name}
                                </p>
                              )}
                            </div>
                          </div>
                        </td>
                        <td className="px-4 py-3"><span className="flex flex-wrap gap-1">{platformsOf(r).map((p) => <Badge key={p}>{p}</Badge>)}</span></td>
                        <td className="px-4 py-3"><StatusPill status={r.status} /></td>
                        <td className="whitespace-nowrap px-4 py-3 text-slate-500 dark:text-slate-400">{formatDate(r.createdAt)}</td>
                        <td className="whitespace-nowrap px-4 py-3 text-slate-500 dark:text-slate-400">{formatDate(r.updatedAt)}</td>
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-2">
                            <Avatar src={r.createdBy?.avatar} name={r.createdBy?.name} size="sm" />
                            <span className="whitespace-nowrap font-medium text-slate-600 dark:text-slate-300">{r.createdBy?.name || '—'}</span>
                          </div>
                        </td>
                      </tr>
                    ))}
              </tbody>
            </table>
          </div>

          {/* Footer: range + pagination + page size */}
          <div className="flex flex-wrap items-center gap-3 border-t border-slate-100 px-4 py-3 dark:border-slate-800">
            <p className="text-xs text-slate-400">Viewing {firstRow}–{lastRow} of {total}</p>
            <div className="ml-auto flex items-center gap-2">
              <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>Previous</Button>
              <span className="whitespace-nowrap text-xs font-medium text-slate-500 dark:text-slate-400">Page {data?.page || page} of {pages}</span>
              <Button variant="outline" size="sm" disabled={page >= pages} onClick={() => setPage((p) => p + 1)}>Next</Button>
            </div>
            <label className="flex items-center gap-2 text-xs text-slate-400">
              Rows per page
              <select className="input-base h-9 w-auto cursor-pointer py-0 text-xs" value={limit}
                onChange={(e) => { setLimit(Number(e.target.value)); setPage(1); }}>
                {[10, 25, 50].map((n) => <option key={n} value={n}>{n}</option>)}
              </select>
            </label>
          </div>
        </Card>
      )}

      {showAssign && (
        <WorkAssignmentModal
          onClose={() => setShowAssign(false)}
          onSaved={() => setShowAssign(false)}
        />
      )}
    </div>
  );
}
