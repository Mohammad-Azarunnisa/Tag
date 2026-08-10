import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import {
  Palette, Send, Search, Eye, Clock3, CheckCircle2, Circle, UserCheck, Flame, CalendarClock,
} from 'lucide-react';
import { workflowApi } from '../api/endpoints.js';
import PageHeader from '../components/layout/PageHeader.jsx';
import { Button } from '../components/ui/Button.jsx';
import { Card, EmptyState, Input, Select, Skeleton, Avatar } from '../components/ui/primitives.jsx';
import { cn, formatDate, timeAgo } from '../lib/utils.js';

// The console's job on these boards is oversight plus the two approval gates —
// everything that moves the work is done by the people doing it.
const STAGE_META = {
  DESIGN_OPEN: { label: 'Waiting for a designer', icon: Circle, cls: 'bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-400' },
  DESIGN_IN_PROGRESS: { label: 'Being designed', icon: Clock3, cls: 'bg-sky-100 text-sky-700 dark:bg-sky-500/15 dark:text-sky-300' },
  DESIGN_ADMIN_REVIEW: { label: 'Waiting on you', icon: Send, cls: 'bg-violet-100 text-violet-700 dark:bg-violet-500/15 dark:text-violet-300' },
  DESIGN_COORDINATOR_REVIEW: { label: 'With the coordinator', icon: UserCheck, cls: 'bg-indigo-100 text-indigo-700 dark:bg-indigo-500/15 dark:text-indigo-300' },
  POST_OPEN: { label: 'Waiting for a handler', icon: Circle, cls: 'bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-400' },
  POST_IN_PROGRESS: { label: 'Content being written', icon: Clock3, cls: 'bg-sky-100 text-sky-700 dark:bg-sky-500/15 dark:text-sky-300' },
  POST_ADMIN_REVIEW: { label: 'Waiting on you', icon: Send, cls: 'bg-violet-100 text-violet-700 dark:bg-violet-500/15 dark:text-violet-300' },
  POST_COORDINATOR_REVIEW: { label: 'With the coordinator', icon: UserCheck, cls: 'bg-indigo-100 text-indigo-700 dark:bg-indigo-500/15 dark:text-indigo-300' },
  POST_APPROVED: { label: 'Ready to post', icon: CheckCircle2, cls: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-400' },
  POSTED: { label: 'Posted', icon: CheckCircle2, cls: 'bg-teal-100 text-teal-700 dark:bg-teal-500/15 dark:text-teal-300' },
};

const BOARDS = {
  DESIGN: {
    title: 'Designs to be Done',
    subtitle: 'Every college request on its way through design. Approve what the designers send you, or say what needs changing.',
    icon: Palette,
    stages: ['DESIGN_OPEN', 'DESIGN_IN_PROGRESS', 'DESIGN_ADMIN_REVIEW', 'DESIGN_COORDINATOR_REVIEW'],
    empty: 'Nothing is in the design pipeline.',
  },
  POST: {
    title: 'To Be Posted',
    subtitle: 'Approved designs on their way to being published. Approve the content the handlers write, or send it back.',
    icon: Send,
    stages: ['POST_OPEN', 'POST_IN_PROGRESS', 'POST_ADMIN_REVIEW', 'POST_COORDINATOR_REVIEW', 'POST_APPROVED', 'POSTED'],
    empty: 'Nothing is waiting to be posted.',
  },
};

export default function Workflow({ board = 'DESIGN' }) {
  const cfg = BOARDS[board];
  const navigate = useNavigate();
  const [filters, setFilters] = useState({ stage: 'All', search: '' });

  const { data, isLoading } = useQuery({
    queryKey: ['admin-workflow', board],
    queryFn: () => workflowApi.list({ board }),
  });
  const items = data?.items || [];
  const counts = data?.counts || {};

  const shown = useMemo(() => {
    const needle = filters.search.trim().toLowerCase();
    return items.filter((i) => {
      if (filters.stage !== 'All' && i.workflowStage !== filters.stage) return false;
      if (!needle) return true;
      return [i.title, i.organization?.name, i.designer?.name, i.handler?.name, i.raisedBy?.name]
        .some((f) => String(f || '').toLowerCase().includes(needle));
    });
  }, [items, filters]);

  const waiting = counts[board === 'DESIGN' ? 'DESIGN_ADMIN_REVIEW' : 'POST_ADMIN_REVIEW'] ?? 0;

  return (
    <div>
      <PageHeader title={cfg.title} subtitle={cfg.subtitle} />

      {waiting > 0 && (
        <div className="mb-4 rounded-xl border border-violet-200 bg-violet-50/70 px-4 py-2.5 text-sm font-semibold text-violet-800 dark:border-violet-500/30 dark:bg-violet-500/10 dark:text-violet-300">
          {waiting} {waiting === 1 ? 'item is' : 'items are'} waiting on your approval.
        </div>
      )}

      <div className="mb-5 grid gap-3 sm:grid-cols-3 lg:grid-cols-6">
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
            <Input className="pl-9" placeholder="Search by title, college or person..."
              value={filters.search} onChange={(e) => setFilters((f) => ({ ...f, search: e.target.value }))} />
          </div>
          <Select className="w-full sm:w-60" value={filters.stage}
            onChange={(e) => setFilters((f) => ({ ...f, stage: e.target.value }))}>
            <option value="All">Every stage</option>
            {cfg.stages.map((s) => <option key={s} value={s}>{STAGE_META[s].label}</option>)}
          </Select>
        </div>
      </Card>

      {isLoading ? (
        <div className="space-y-3">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-24" />)}</div>
      ) : shown.length === 0 ? (
        <EmptyState icon={cfg.icon} title={cfg.empty}
          description="College requests enter the design board as soon as they are raised." />
      ) : (
        <div className="space-y-3">
          {shown.map((i) => {
            const meta = STAGE_META[i.workflowStage] || STAGE_META.DESIGN_OPEN;
            const StageIcon = meta.icon;
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
                      {['URGENT', 'HIGH'].includes(i.priority) && (
                        <span className="inline-flex items-center gap-1 rounded-full bg-rose-100 px-2 py-0.5 text-[11px] font-bold text-rose-700 dark:bg-rose-500/15 dark:text-rose-400">
                          <Flame className="h-3 w-3" /> {i.priority === 'URGENT' ? 'Urgent' : 'High'}
                        </span>
                      )}
                    </div>
                    <p className="mt-1 text-xs text-slate-400">
                      <span className="font-semibold text-slate-500 dark:text-slate-300">{i.organization?.name || 'Unknown college'}</span>
                      {' · '}{i.workType === 'DIGITAL_MEDIA' ? 'Digital' : 'Print'}
                      {i.workCategory ? ` · ${i.workCategory}` : ''}
                      {' · raised '}{timeAgo(i.createdAt)}{i.raisedBy?.name ? ` by ${i.raisedBy.name}` : ''}
                    </p>
                    {/* Who holds each half, so the console can see where it sits. */}
                    {(i.postPlatforms?.length || 0) > 0 && (
                      <p className="mt-1 text-xs font-semibold text-brand-600 dark:text-brand-400">
                        Pages: {i.postPlatforms.join(', ')}
                      </p>
                    )}
                    <div className="mt-1.5 flex flex-wrap gap-3">
                      {i.designer?.name && (
                        <span className="inline-flex items-center gap-1.5 text-xs text-slate-600 dark:text-slate-300">
                          <Avatar src={i.designer.avatar} name={i.designer.name} size="sm" className="h-4 w-4 ring-0" />
                          Designer: <span className="font-semibold">{i.designer.name}</span>
                        </span>
                      )}
                      {i.handler?.name && (
                        <span className="inline-flex items-center gap-1.5 text-xs text-slate-600 dark:text-slate-300">
                          <Avatar src={i.handler.avatar} name={i.handler.name} size="sm" className="h-4 w-4 ring-0" />
                          Handler: <span className="font-semibold">{i.handler.name}</span>
                        </span>
                      )}
                    </div>
                  </div>
                  <div className="flex shrink-0 flex-col items-end gap-2">
                    {i.neededBy && (
                      <p className={cn('inline-flex items-center gap-1.5 text-xs font-semibold',
                        overdue ? 'text-rose-600 dark:text-rose-400' : 'text-slate-500 dark:text-slate-400')}>
                        <CalendarClock className="h-3.5 w-3.5" />
                        {formatDate(i.neededBy)}{overdue ? ' — passed' : ''}
                      </p>
                    )}
                    <Button size="sm" variant="outline" onClick={() => navigate(`/workflow/${i._id}`)}>
                      <Eye className="h-4 w-4" /> Open
                    </Button>
                  </div>
                </div>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
