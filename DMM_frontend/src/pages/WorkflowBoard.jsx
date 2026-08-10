import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import {
  Palette, Send, Search, Eye, ThumbsUp, Clock3, CheckCircle2, Circle,
  UserCheck, Flame, CalendarClock, Paperclip,
} from 'lucide-react';
import { workflowApi } from '../api/endpoints.js';
import { useAuthStore } from '../store/authStore.js';
import PageHeader from '../components/layout/PageHeader.jsx';
import { Button } from '../components/ui/Button.jsx';
import { Card, EmptyState, Input, Select, Skeleton, Avatar } from '../components/ui/primitives.jsx';
import { cn, formatDate, timeAgo } from '../lib/utils.js';

// What each stage means to the person reading the board. Two boards, one record —
// the stage is the whole answer to "whose move is it?".
const STAGE_META = {
  DESIGN_OPEN: { label: 'Waiting for a designer', icon: Circle, cls: 'bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-400' },
  DESIGN_IN_PROGRESS: { label: 'Being designed', icon: Clock3, cls: 'bg-sky-100 text-sky-700 dark:bg-sky-500/15 dark:text-sky-300' },
  DESIGN_ADMIN_REVIEW: { label: 'With the Admin', icon: Send, cls: 'bg-violet-100 text-violet-700 dark:bg-violet-500/15 dark:text-violet-300' },
  DESIGN_COORDINATOR_REVIEW: { label: 'With the coordinator', icon: UserCheck, cls: 'bg-indigo-100 text-indigo-700 dark:bg-indigo-500/15 dark:text-indigo-300' },
  POST_OPEN: { label: 'Waiting for a handler', icon: Circle, cls: 'bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-400' },
  POST_IN_PROGRESS: { label: 'Content being written', icon: Clock3, cls: 'bg-sky-100 text-sky-700 dark:bg-sky-500/15 dark:text-sky-300' },
  POST_ADMIN_REVIEW: { label: 'With the Admin', icon: Send, cls: 'bg-violet-100 text-violet-700 dark:bg-violet-500/15 dark:text-violet-300' },
  POST_COORDINATOR_REVIEW: { label: 'With the coordinator', icon: UserCheck, cls: 'bg-indigo-100 text-indigo-700 dark:bg-indigo-500/15 dark:text-indigo-300' },
  POST_APPROVED: { label: 'Ready to post', icon: CheckCircle2, cls: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-400' },
  POSTED: { label: 'Posted', icon: CheckCircle2, cls: 'bg-teal-100 text-teal-700 dark:bg-teal-500/15 dark:text-teal-300' },
};

const URGENCY = {
  URGENT: { label: 'Urgent', cls: 'bg-rose-100 text-rose-700 dark:bg-rose-500/15 dark:text-rose-400' },
  HIGH: { label: 'High', cls: 'bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-400' },
};

const BOARDS = {
  DESIGN: {
    title: 'Designs to be Done',
    subtitle: 'What the colleges have asked to be designed. Take one on, make it, and send it for approval.',
    icon: Palette,
    stages: ['DESIGN_OPEN', 'DESIGN_IN_PROGRESS', 'DESIGN_ADMIN_REVIEW', 'DESIGN_COORDINATOR_REVIEW'],
    empty: 'Nothing is waiting to be designed.',
  },
  POST: {
    title: 'To Be Posted',
    // Scoped server-side to the pages this handler runs, so the subtitle says so
    // rather than implying one shared queue.
    subtitle: 'Designs the college has signed off, for the pages you handle. Take one on, write the post, and put it out once it is approved.',
    icon: Send,
    stages: ['POST_OPEN', 'POST_IN_PROGRESS', 'POST_ADMIN_REVIEW', 'POST_COORDINATOR_REVIEW', 'POST_APPROVED', 'POSTED'],
    empty: 'Nothing is waiting to be posted.',
  },
};

export default function WorkflowBoard({ board = 'DESIGN' }) {
  const cfg = BOARDS[board];
  const qc = useQueryClient();
  const navigate = useNavigate();
  const { user } = useAuthStore();
  const [filters, setFilters] = useState({ stage: 'All', search: '' });

  const { data, isLoading } = useQuery({
    queryKey: ['workflow', board],
    queryFn: () => workflowApi.list({ board }),
  });

  const items = data?.items || [];
  const counts = data?.counts || {};

  const ackMut = useMutation({
    mutationFn: (id) => workflowApi.acknowledge(id),
    onSuccess: () => {
      toast.success('Acknowledged — it is yours now');
      qc.invalidateQueries({ queryKey: ['workflow'] });
      qc.invalidateQueries({ queryKey: ['notifications'] });
    },
    // Losing the race is normal, not an error state: somebody got there first.
    onError: (e) => toast.error(e.response?.data?.message || 'Could not acknowledge this'),
  });

  const shown = useMemo(() => {
    const needle = filters.search.trim().toLowerCase();
    return items.filter((i) => {
      if (filters.stage !== 'All' && i.workflowStage !== filters.stage) return false;
      if (!needle) return true;
      return [i.title, i.details, i.organization?.name, i.department]
        .some((f) => String(f || '').toLowerCase().includes(needle));
    });
  }, [items, filters]);

  const canAcknowledge = (i) => i.workflowStage === (board === 'DESIGN' ? 'DESIGN_OPEN' : 'POST_OPEN')
    && !user?.viewOnly
    && user?.userType === (board === 'DESIGN' ? 'DESIGNER' : 'SOCIAL_HANDLER');

  return (
    <div>
      <PageHeader title={cfg.title} subtitle={cfg.subtitle} />

      {/* One tile per stage, so it is obvious where the queue is backing up. */}
      <div className="mb-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        {cfg.stages.map((s) => {
          const meta = STAGE_META[s];
          const active = filters.stage === s;
          return (
            <button key={s} type="button"
              onClick={() => setFilters((f) => ({ ...f, stage: active ? 'All' : s }))}
              className={cn('rounded-2xl border-2 bg-white p-3 text-left transition dark:bg-slate-900',
                active ? 'border-brand-500' : 'border-slate-100 hover:border-brand-300 dark:border-slate-800')}>
              <p className="text-[11px] font-bold uppercase tracking-wide text-slate-400">{meta.label}</p>
              <p className="mt-0.5 text-2xl font-extrabold text-slate-800 dark:text-white">{counts[s] ?? 0}</p>
            </button>
          );
        })}
      </div>

      <Card className="mb-5 p-3">
        <div className="flex flex-wrap gap-3">
          <div className="relative min-w-[220px] flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <Input className="pl-9" placeholder="Search what was asked for..."
              value={filters.search} onChange={(e) => setFilters((f) => ({ ...f, search: e.target.value }))} />
          </div>
          <Select className="w-full sm:w-56" value={filters.stage}
            onChange={(e) => setFilters((f) => ({ ...f, stage: e.target.value }))}>
            <option value="All">Every stage</option>
            {cfg.stages.map((s) => <option key={s} value={s}>{STAGE_META[s].label}</option>)}
          </Select>
        </div>
      </Card>

      {isLoading ? (
        <div className="space-y-3">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-28" />)}</div>
      ) : shown.length === 0 ? (
        <EmptyState icon={cfg.icon} title={cfg.empty}
          description="Requests appear here as soon as a college raises them." />
      ) : (
        <div className="space-y-3">
          {shown.map((i) => {
            const meta = STAGE_META[i.workflowStage] || STAGE_META.DESIGN_OPEN;
            const StageIcon = meta.icon;
            const owner = board === 'DESIGN' ? i.designer : i.handler;
            const overdue = i.neededBy && new Date(i.neededBy) < new Date() && i.workflowStage !== 'POSTED';
            return (
              <Card key={i._id} className="p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="font-bold text-slate-800 dark:text-white">{i.title}</p>
                      <span className={cn('inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-bold', meta.cls)}>
                        <StageIcon className="h-3 w-3" /> {meta.label}
                      </span>
                      {URGENCY[i.priority] && (
                        <span className={cn('inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-bold', URGENCY[i.priority].cls)}>
                          <Flame className="h-3 w-3" /> {URGENCY[i.priority].label}
                        </span>
                      )}
                    </div>
                    <p className="mt-1 flex flex-wrap items-center gap-x-1.5 text-xs text-slate-400">
                      <span className="font-semibold text-slate-500 dark:text-slate-300">{i.organization?.name || 'Unknown college'}</span>
                      · {i.workType === 'DIGITAL_MEDIA' ? 'Digital' : 'Print'}
                      {i.workCategory ? ` · ${i.workCategory}` : ''}
                      {i.workItem ? ` · ${i.workItem}` : ''}
                      · raised {timeAgo(i.createdAt)}
                      {i.raisedBy?.name ? ` by ${i.raisedBy.name}` : ''}
                    </p>
                    {i.department && <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">Department: {i.department}</p>}
                    {/* Who has it, so nobody duplicates work already taken. */}
                    {owner && (
                      <p className="mt-1 inline-flex items-center gap-1.5 text-xs font-semibold text-slate-600 dark:text-slate-300">
                        <Avatar src={owner.avatar} name={owner.name} size="sm" className="h-4 w-4 ring-0" />
                        Acknowledged by {owner.name}
                      </p>
                    )}
                    {(i.postPlatforms?.length || 0) > 0 && (
                      <p className="mt-1 text-xs font-semibold text-brand-600 dark:text-brand-400">
                        Pages: {i.postPlatforms.join(', ')}
                      </p>
                    )}
                    {(i.attachments?.length || 0) > 0 && (
                      <p className="mt-1 inline-flex items-center gap-1 text-xs font-semibold text-brand-600 dark:text-brand-400">
                        <Paperclip className="h-3 w-3" /> {i.attachments.length} reference file{i.attachments.length === 1 ? '' : 's'}
                      </p>
                    )}
                  </div>
                  {i.neededBy && (
                    <p className={cn('inline-flex shrink-0 items-center gap-1.5 text-xs font-semibold',
                      overdue ? 'text-rose-600 dark:text-rose-400' : 'text-slate-500 dark:text-slate-400')}>
                      <CalendarClock className="h-3.5 w-3.5" />
                      Needed by {formatDate(i.neededBy)}{overdue ? ' — passed' : ''}
                    </p>
                  )}
                </div>

                {i.details && (
                  <p className="mt-3 whitespace-pre-wrap text-sm text-slate-600 dark:text-slate-300">{i.details}</p>
                )}

                <div className="mt-3 flex flex-wrap items-center gap-2">
                  <Button size="sm" variant="outline" onClick={() => navigate(`/workflow/${i._id}`)}>
                    <Eye className="h-4 w-4" /> Open
                  </Button>
                  {canAcknowledge(i) && (
                    <Button size="sm" loading={ackMut.isPending && ackMut.variables === i._id}
                      onClick={() => ackMut.mutate(i._id)}>
                      <ThumbsUp className="h-4 w-4" /> Acknowledge
                    </Button>
                  )}
                  {i.workflowStage === 'POSTED' && (i.postedAt || i.scheduledFor) && (
                    <span className="text-xs font-semibold text-teal-600 dark:text-teal-400">
                      {i.postedAt ? `Posted ${formatDate(i.postedAt)}` : `Scheduled for ${formatDate(i.scheduledFor)}`}
                    </span>
                  )}
                </div>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
