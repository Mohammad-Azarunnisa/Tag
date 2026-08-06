import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  Upload, FileImage, Send, CheckCircle2, XCircle, RefreshCw, UserPlus, UserCog, UserX, BarChart3, Activity, MessageSquare, ShoppingBag,
} from 'lucide-react';
import { activityApi } from '../api/endpoints.js';
import PageHeader from '../components/layout/PageHeader.jsx';
import { Card, Select, Avatar, Skeleton, EmptyState, Badge } from '../components/ui/primitives.jsx';
import { formatDateTime } from '../lib/utils.js';

// Plain-language label + verb so anyone (not just developers) can read the log.
// Colour is kept minimal: green for positive, red for removals/changes, neutral otherwise.
const TONES = {
  good: 'text-emerald-600 bg-emerald-50 dark:bg-emerald-500/10',
  bad: 'text-rose-600 bg-rose-50 dark:bg-rose-500/10',
  neutral: 'text-slate-500 bg-slate-100 dark:bg-slate-800',
};
const META = {
  TEMPLATE_UPLOAD: { icon: FileImage, label: 'Template added', verb: 'uploaded a template', tone: 'neutral' },
  ASSET_UPLOAD: { icon: Upload, label: 'Asset added', verb: 'uploaded an asset', tone: 'neutral' },
  APPROVAL_SUBMISSION: { icon: Send, label: 'Sent for approval', verb: 'sent content for approval', tone: 'neutral' },
  APPROVAL_APPROVED: { icon: CheckCircle2, label: 'Approved', verb: 'approved content', tone: 'good' },
  APPROVAL_REJECTED: { icon: MessageSquare, label: 'Changes requested', verb: 'requested changes', tone: 'bad' },
  APPROVAL_RESUBMITTED: { icon: RefreshCw, label: 'Resubmitted', verb: 'resubmitted content', tone: 'neutral' },
  POST_COMPLETION: { icon: CheckCircle2, label: 'Posted', verb: 'marked content as posted', tone: 'good' },
  USER_CREATED: { icon: UserPlus, label: 'Member added', verb: 'added a team member', tone: 'good' },
  USER_UPDATED: { icon: UserCog, label: 'Member updated', verb: 'updated a team member', tone: 'neutral' },
  USER_DEACTIVATED: { icon: UserX, label: 'Member removed', verb: 'removed a team member', tone: 'bad' },
  ANALYTICS_UPDATED: { icon: BarChart3, label: 'Analytics updated', verb: 'updated analytics', tone: 'neutral' },
  COMPETITOR_UPDATED: { icon: BarChart3, label: 'Competitors updated', verb: 'updated competitors', tone: 'neutral' },
};

export default function ActivityLogs() {
  const [action, setAction] = useState('All');
  const [page, setPage] = useState(1);
  const { data, isLoading } = useQuery({ queryKey: ['activity', { action, page }], queryFn: () => activityApi.list({ action, page, limit: 25 }) });
  const logs = data?.logs || [];

  return (
    <div>
      <PageHeader title="Activity Logs" subtitle="System-wide audit trail of every key action." />

      <div className="mb-5 flex justify-end">
        <Select className="w-56" value={action} onChange={(e) => { setAction(e.target.value); setPage(1); }}>
          <option value="All">All actions</option>
          {Object.entries(META).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
        </Select>
      </div>

      {isLoading ? (
        <div className="space-y-2">{Array.from({ length: 8 }).map((_, i) => <Skeleton key={i} className="h-16" />)}</div>
      ) : logs.length === 0 ? (
        <EmptyState icon={Activity} title="No activity found" description="Try a different filter." />
      ) : (
        <>
          <Card className="divide-y divide-slate-50 dark:divide-slate-800/50">
            {logs.map((log) => {
              const m = META[log.action] || { icon: Activity, label: 'Activity', verb: 'made an update', tone: 'neutral' };
              const Icon = m.icon;
              return (
                <div key={log._id} className="flex items-center gap-4 p-4">
                  <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full ${TONES[m.tone]}`}><Icon className="h-5 w-5" /></div>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm text-slate-700 dark:text-slate-200"><span className="font-semibold">{log.user?.name || 'Someone'}</span> {m.verb}</p>
                    {log.description && <p className="truncate text-xs text-slate-400">{log.description}</p>}
                    <span className="text-[11px] text-slate-400">{formatDateTime(log.createdAt)}</span>
                  </div>
                  <Badge className="hidden sm:inline-flex">{m.label}</Badge>
                </div>
              );
            })}
          </Card>

          {data?.pages > 1 && (
            <div className="mt-4 flex items-center justify-center gap-2">
              <button disabled={page <= 1} onClick={() => setPage((p) => p - 1)} className="rounded-lg border border-slate-200 dark:border-slate-700 px-3 py-1.5 text-sm disabled:opacity-40">Prev</button>
              <span className="text-sm text-slate-400">Page {data.page} of {data.pages}</span>
              <button disabled={page >= data.pages} onClick={() => setPage((p) => p + 1)} className="rounded-lg border border-slate-200 dark:border-slate-700 px-3 py-1.5 text-sm disabled:opacity-40">Next</button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
