import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { motion } from 'framer-motion';
import {
  Plus, Search, Inbox, Images as ImagesIcon, Play, Layers, Clock, RefreshCw,
  CheckCircle2, Send, ChevronLeft, ChevronRight, Palette, UserCheck, FileText, MessageSquarePlus, AlertTriangle,
  PackageCheck,
} from 'lucide-react';
import { approvalApi } from '../api/endpoints.js';
import { useAuthStore } from '../store/authStore.js';
import PageHeader from '../components/layout/PageHeader.jsx';
import { Button } from '../components/ui/Button.jsx';
import { Card, Input, Select, Badge, Avatar, Skeleton, EmptyState } from '../components/ui/primitives.jsx';
import CreateApprovalModal from '../components/approvals/CreateApprovalModal.jsx';
import { cn, formatDate, isVideo, isDoc, platformsOf } from '../lib/utils.js';

// Design briefs move through an extra IN_DESIGN stage and can end DELIVERED;
// standalone posts don't, so each pipeline shows its own status tabs.
const STATUSES_POST = ['All', 'PENDING', 'RESUBMITTED', 'APPROVED', 'REJECTED', 'POSTED'];
const STATUSES_DESIGN = ['All', 'IN_DESIGN', 'PENDING', 'RESUBMITTED', 'APPROVED', 'REJECTED', 'POSTED', 'DELIVERED'];
// Neither of these is a designer's business. IN_DESIGN is a brief nobody has
// submitted yet, and DELIVERED is what happens to finished artwork after it
// leaves them — both are stages they can never move a request into or out of, so
// the tabs only ever came up empty for them.
const STATUSES_DESIGN_FOR_DESIGNER = STATUSES_DESIGN.filter((s) => !['IN_DESIGN', 'DELIVERED'].includes(s));
const ALL_STATUSES = [...new Set([...STATUSES_POST, ...STATUSES_DESIGN])];
const PLATFORMS = ['All', 'LinkedIn', 'Instagram', 'YouTube', 'Facebook'];

// The two approval pipelines. POST = ready-to-publish content. DESIGN = a brief
// a coordinator raises; a designer creates it, a super admin approves, then it
// is either posted by a social handler or delivered back to the coordinator.
const TYPE_TABS = [
  { key: 'POST', label: 'Post approvals', icon: Send },
  { key: 'DESIGN', label: 'Design approvals', icon: Palette },
];

const STATUS_LABELS = { All: 'All', IN_DESIGN: 'In design', PENDING: 'Pending', RESUBMITTED: 'Resubmitted', APPROVED: 'Approved', REJECTED: 'Rejected', POSTED: 'Posted', DELIVERED: 'Delivered' };

// Stat tiles across the top — each doubles as a shortcut to its status tab.
// Posted counts how many have gone out on either pipeline (a straight answer
// to "how many social media posts have we posted so far"); Delivered is the
// design pipeline's own finish line — a design with nothing to post, handed
// straight back to the coordinator — so it only makes sense while looking at
// Design approvals, same as the Delivered status tab itself.
const TILES = [
  { key: 'All', label: 'Total', countKey: 'ALL', icon: Layers, tone: 'text-slate-400' },
  { key: 'PENDING', label: 'Pending', countKey: 'PENDING', icon: Clock, tone: 'text-amber-500' },
  { key: 'RESUBMITTED', label: 'Resubmitted', countKey: 'RESUBMITTED', icon: RefreshCw, tone: 'text-sky-500' },
  { key: 'APPROVED', label: 'Approved', countKey: 'APPROVED', icon: CheckCircle2, tone: 'text-emerald-500' },
  { key: 'POSTED', label: 'Posted', countKey: 'POSTED', icon: Send, tone: 'text-violet-500' },
  { key: 'DELIVERED', label: 'Delivered', countKey: 'DELIVERED', icon: PackageCheck, tone: 'text-teal-500', design: true },
];

const EMPTY_COPY = {
  All: 'Create a new approval request to get started.',
  PENDING: 'No requests are waiting for review right now.',
  RESUBMITTED: 'No resubmitted requests are back in review.',
  APPROVED: 'Nothing is approved and waiting to be posted.',
  REJECTED: 'No requests currently need changes.',
  POSTED: 'Nothing has been marked as posted yet.',
  DELIVERED: 'No approved designs have been delivered to a coordinator yet.',
};

export default function Approvals() {
  const navigate = useNavigate();
  const { user } = useAuthStore();
  const isSuperAdmin = !!user?.isSuperAdmin;
  // A coordinator asks for work by raising a REQUEST to the admin, never by
  // creating an approval — approvals hold the finished work that comes back, so
  // this page is theirs to follow rather than to add to.
  const isCoordinator = user?.role === 'USER' && user?.userType === 'COORDINATOR';
  const isDesigner = user?.role === 'USER' && user?.userType === 'DESIGNER';
  const canRaiseBrief = user?.role === 'CEO';
  const isViewer = !!user?.viewOnly;
  const canCreate = !isViewer && !isCoordinator;
  const [searchParams] = useSearchParams();
  // Allow the dashboard cards to deep-link into a pre-filtered view (?status=PENDING),
  // and design detail pages to open the composer prefilled (?compose=post&design=<id>).
  const initialStatus = ALL_STATUSES.includes(searchParams.get('status')) ? searchParams.get('status') : 'All';
  const initialType = searchParams.get('type') === 'DESIGN' ? 'DESIGN' : 'POST';
  const composeDesign = searchParams.get('design') || '';
  // "Send for approval" on a workflow item lands here (?workflow=<id>): the
  // composer opens with that request's title already in, and the submission is
  // tied back to it so the pipeline moves on.
  const composeWorkflow = searchParams.get('workflow') || '';
  const composeTitle = searchParams.get('title') || '';
  // Opening a row and its Back button coming right back here is a fresh
  // navigation, not a browser "back" — so the filters/page/row-count are
  // remembered here and restored on return. A deep link (?status=/?type=)
  // always wins over whatever was remembered, since it says exactly what view
  // the caller wanted.
  const LIST_STATE_KEY = 'approvals-list-state';
  const hasDeepLink = !!(searchParams.get('status') || searchParams.get('type'));
  const savedListState = hasDeepLink ? null : (() => {
    try { return JSON.parse(sessionStorage.getItem(LIST_STATE_KEY) || 'null'); } catch { return null; }
  })();
  const [filters, setFilters] = useState(savedListState?.filters
    || { search: '', status: initialStatus, type: initialType, platform: 'All', from: '', to: '' });
  const [page, setPage] = useState(savedListState?.page || 1);
  const [rows, setRows] = useState(savedListState?.rows || 10);
  useEffect(() => {
    try { sessionStorage.setItem(LIST_STATE_KEY, JSON.stringify({ filters, page, rows })); } catch { /* ignore */ }
  }, [filters, page, rows]);
  // A deep link must not open a composer for someone who cannot submit it.
  const [showCreate, setShowCreate] = useState(
    canCreate && (!!composeDesign || !!composeWorkflow || searchParams.get('compose') === 'post')
  );
  const hasDateFilter = filters.from || filters.to;

  const closeCreate = () => {
    setShowCreate(false);
    if (composeDesign || composeWorkflow) navigate('/approvals', { replace: true });
  };

  // Any filter/tab change restarts pagination from the first page.
  const applyFilters = (patch) => { setFilters((f) => ({ ...f, ...patch })); setPage(1); };

  // The status tabs this viewer actually gets.
  const statusTabs = filters.type === 'DESIGN'
    ? (isDesigner ? STATUSES_DESIGN_FOR_DESIGNER : STATUSES_DESIGN)
    : STATUSES_POST;
  // A tab that is not on offer must not stay selected behind the scenes — a
  // dashboard link or a switch between pipelines can land on one, and the list
  // would then be filtered by a status with no tab to show it or clear it.
  useEffect(() => {
    if (!statusTabs.includes(filters.status)) applyFilters({ status: 'All' });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filters.type, filters.status, isDesigner]);

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ['approvals', filters, page, rows],
    queryFn: () => approvalApi.list({ ...filters, page, limit: rows }),
    placeholderData: (prev) => prev,
    // Keep tiles/statuses current while the page is open (no manual refresh).
    refetchInterval: 10000,
    refetchIntervalInBackground: false,
  });
  const requests = data?.requests || [];
  const counts = data?.counts || {};
  const typeCounts = data?.typeCounts || {};
  const total = data?.total ?? 0;
  const pages = data?.pages || 1;
  const viewFrom = total === 0 ? 0 : (page - 1) * rows + 1;
  const viewTo = Math.min(page * rows, total);

  return (
    <div>
      <PageHeader
        title={isSuperAdmin ? 'Approval Panel' : isCoordinator ? 'Approvals for your college' : 'My Approval Requests'}
        subtitle={isSuperAdmin ? 'Review, approve or request changes to content.'
          : isCoordinator ? 'The work your college has in progress. To ask for something new, raise a request to the admin.'
            : 'Create and track your content approvals.'}
        actions={isCoordinator
          ? <Button variant="outline" onClick={() => navigate('/requests')}><MessageSquarePlus className="h-4 w-4" /> Raise a request</Button>
          : canCreate && <Button onClick={() => setShowCreate(true)}><Plus className="h-4 w-4" /> {canRaiseBrief ? 'Raise design brief' : 'New Request'}</Button>}
      />

      {/* Pipeline switch: post approvals vs design approvals */}
      <div className="mb-5 inline-flex rounded-2xl border border-slate-200 bg-white p-1.5 shadow-soft dark:border-slate-800 dark:bg-slate-900">
        {TYPE_TABS.map((t) => (
          <button
            key={t.key} type="button"
            onClick={() => applyFilters({ type: t.key, status: 'All' })}
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
      <div className="mb-5 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        {TILES.filter((t) => !t.design || filters.type === 'DESIGN').map((t, i) => (
          <motion.button
            key={t.key} type="button" initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.04 }}
            onClick={() => applyFilters({ status: t.key })}
            className={cn('card p-4 text-left transition hover:shadow-glow', filters.status === t.key && 'ring-2 ring-brand-500/40')}
          >
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">{t.label}</span>
              <t.icon className={cn('h-4 w-4', t.tone)} />
            </div>
            <p className="mt-2 text-3xl font-extrabold text-slate-800 dark:text-white">{counts[t.countKey] ?? 0}</p>
          </motion.button>
        ))}
      </div>

      {/* Status tabs + compact filters on one wrapping row */}
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <div className="flex flex-wrap gap-1 rounded-xl bg-slate-100 dark:bg-slate-800 p-1">
          {statusTabs.map((s) => (
            <button
              key={s} type="button" onClick={() => applyFilters({ status: s })}
              className={cn(
                'rounded-lg px-3 py-1.5 text-sm font-semibold transition',
                filters.status === s ? 'bg-white dark:bg-slate-900 text-brand-700 dark:text-brand-400 shadow-soft' : 'text-slate-500 hover:text-slate-700 dark:hover:text-slate-300'
              )}
            >
              {STATUS_LABELS[s]}
            </button>
          ))}
        </div>
        <div className="flex flex-1 flex-wrap items-center justify-end gap-2">
          <div className="relative w-full sm:w-56">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <Input placeholder="Search requests..." className="h-10 pl-9" value={filters.search} onChange={(e) => applyFilters({ search: e.target.value })} />
          </div>
          <Select className="h-10 w-40" value={filters.platform} onChange={(e) => applyFilters({ platform: e.target.value })}>
            {PLATFORMS.map((p) => <option key={p} value={p}>{p === 'All' ? 'All Platforms' : p}</option>)}
          </Select>
          <Input type="date" title="From date" className="h-10 w-36" value={filters.from} onChange={(e) => applyFilters({ from: e.target.value })} />
          <Input type="date" title="To date" className="h-10 w-36" value={filters.to} onChange={(e) => applyFilters({ to: e.target.value })} />
          {hasDateFilter && (
            <button onClick={() => applyFilters({ from: '', to: '' })} className="text-sm font-medium text-brand-600 hover:text-brand-700">
              Clear dates
            </button>
          )}
        </div>
      </div>

      {/* Requests table */}
      <Card className="overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[760px] text-sm">
            <thead>
              <tr className="border-b border-slate-100 dark:border-slate-800 text-left text-xs font-bold uppercase tracking-wide text-slate-400">
                <th className="px-4 py-3">Post</th>
                <th className="px-4 py-3">Platform</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3">Submitted</th>
                <th className="px-4 py-3">Updated</th>
                <th className="px-4 py-3">By</th>
              </tr>
            </thead>
            <tbody>
              {isLoading ? (
                Array.from({ length: 6 }).map((_, i) => (
                  <tr key={i} className="border-b border-slate-100 dark:border-slate-800">
                    <td className="px-4 py-3"><div className="flex items-center gap-3"><Skeleton className="h-10 w-14" /><Skeleton className="h-4 w-40" /></div></td>
                    {Array.from({ length: 5 }).map((_, j) => <td key={j} className="px-4 py-3"><Skeleton className="h-4 w-20" /></td>)}
                  </tr>
                ))
              ) : requests.map((r) => (
                <tr
                  key={r._id} onClick={() => navigate(`/approvals/${r._id}`)}
                  className="cursor-pointer border-b border-slate-100 dark:border-slate-800 transition hover:bg-slate-50 dark:hover:bg-slate-800/50"
                >
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-3">
                      <span className="relative h-10 w-14 shrink-0 overflow-hidden rounded-lg bg-slate-100 dark:bg-slate-800">
                        {r.images?.[0] ? (
                          isVideo(r.images[0]) ? (
                            <>
                              <video src={r.images[0].url} className="h-full w-full object-cover" muted />
                              <span className="absolute inset-0 flex items-center justify-center bg-black/25"><Play className="h-4 w-4 text-white" /></span>
                            </>
                          ) : isDoc(r.images[0]) ? (
                            <span className="flex h-full items-center justify-center"><FileText className="h-5 w-5 text-slate-400" /></span>
                          ) : (
                            <img src={r.images[0].url} alt="" className="h-full w-full object-cover" />
                          )
                        ) : (
                          <span className="flex h-full items-center justify-center"><ImagesIcon className="h-5 w-5 text-slate-300" /></span>
                        )}
                      </span>
                      <div className="min-w-0">
                        <p className="max-w-[220px] truncate font-semibold text-slate-800 dark:text-white">{r.title}</p>
                        <p className="text-xs text-slate-400">{r.organization?.name || '—'}</p>
                        {r.type === 'DESIGN' && (r.assignedTo || r.designer) && (
                          <p className="mt-0.5 flex items-center gap-1 text-[11px] font-medium text-violet-500">
                            {r.assignedTo
                              ? <><UserCheck className="h-3 w-3" /> {r.assignedTo?.name}</>
                              : <><Palette className="h-3 w-3" /> {r.designer?.name}</>}
                          </p>
                        )}
                      </div>
                    </div>
                  </td>
                  <td className="px-4 py-3"><span className="flex flex-wrap gap-1">{platformsOf(r).map((p) => <Badge key={p}>{p}</Badge>)}</span></td>
                  <td className="px-4 py-3"><Badge status={r.status}>{STATUS_LABELS[r.status] || r.status}</Badge></td>
                  <td className="px-4 py-3 text-slate-500 dark:text-slate-400">{formatDate(r.createdAt)}</td>
                  <td className="px-4 py-3 text-slate-500 dark:text-slate-400">{formatDate(r.updatedAt)}</td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      <Avatar src={r.createdBy?.avatar} name={r.createdBy?.name} size="sm" />
                      <span className="whitespace-nowrap text-slate-600 dark:text-slate-300">{r.createdBy?.name || '—'}</span>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {!isLoading && isError && (
          <div className="p-4">
            <EmptyState
              icon={AlertTriangle}
              title="Couldn't load this"
              description="There was a problem loading your approvals — check your connection and try again."
              action={<Button variant="outline" onClick={() => refetch()}>Try again</Button>}
            />
          </div>
        )}

        {!isLoading && !isError && requests.length === 0 && (
          <div className="p-4">
            <EmptyState
              icon={Inbox}
              title={filters.status === 'All' ? 'No requests found' : `No ${STATUS_LABELS[filters.status].toLowerCase()} requests`}
              description={EMPTY_COPY[filters.status] || EMPTY_COPY.All}
              action={isCoordinator
                ? <Button variant="outline" onClick={() => navigate('/requests')}><MessageSquarePlus className="h-4 w-4" /> Raise a request to the admin</Button>
                : canCreate && <Button onClick={() => setShowCreate(true)}><Plus className="h-4 w-4" /> New Request</Button>}
            />
          </div>
        )}

        {/* Pagination footer */}
        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 dark:border-slate-800 px-4 py-3 text-sm text-slate-500 dark:text-slate-400">
          <span>Viewing {viewFrom}–{viewTo} of {total}</span>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
              <ChevronLeft className="h-4 w-4" /> Previous
            </Button>
            <span className="px-1 font-medium">Page {page} of {pages}</span>
            <Button variant="outline" size="sm" disabled={page >= pages} onClick={() => setPage((p) => p + 1)}>
              Next <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
          <div className="flex items-center gap-2">
            <span className="whitespace-nowrap text-xs">Rows per page</span>
            <Select className="h-9 w-20 py-0" value={rows} onChange={(e) => { setRows(Number(e.target.value)); setPage(1); }}>
              {[10, 25, 50].map((n) => <option key={n} value={n}>{n}</option>)}
            </Select>
          </div>
        </div>
      </Card>

      {showCreate && (
        <CreateApprovalModal
          defaultType={composeDesign ? 'POST' : filters.type}
          sourceDesignId={composeDesign}
          workflowItemId={composeWorkflow}
          defaultTitle={composeTitle}
          onClose={closeCreate}
          onSaved={(submittedType) => {
            closeCreate();
            // Show the pipeline the request actually went to — a designer's
            // submission is a DESIGN approval even though the list opens on POST.
            applyFilters({ type: submittedType || filters.type, status: 'All' });
            refetch();
          }}
        />
      )}
    </div>
  );
}
