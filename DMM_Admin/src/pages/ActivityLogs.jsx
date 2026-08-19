import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Activity, Building2 } from 'lucide-react';
import { activityApi } from '../api/endpoints.js';
import PageHeader from '../components/layout/PageHeader.jsx';
import { Card, Select, Avatar, Skeleton, EmptyState } from '../components/ui/primitives.jsx';
import { ACTION_OPTIONS, actionIcon, actionLabel, actionTone, activityDetail } from '../lib/activity.js';
import { cn, formatDateTime, timeAgo } from '../lib/utils.js';

export default function ActivityLogs() {
  const [action, setAction] = useState('All');
  const [page, setPage] = useState(1);
  const { data, isLoading } = useQuery({ queryKey: ['activity', { action, page }], queryFn: () => activityApi.list({ action, page, limit: 25 }) });
  const logs = data?.logs || [];
  // Worth a column only when the rows actually span more than one organization.
  const showOrgColumn = new Set(logs.map((l) => l.organization?._id || l.organization).filter(Boolean)).size > 1;

  return (
    <div>
      <PageHeader title="Activity Logs" subtitle="System-wide audit trail of every key action." />

      <div className="mb-5 flex justify-end">
        <Select className="w-56" value={action} onChange={(e) => { setAction(e.target.value); setPage(1); }}>
          <option value="All">All actions</option>
          {ACTION_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </Select>
      </div>

      {isLoading ? (
        <div className="space-y-2">{Array.from({ length: 8 }).map((_, i) => <Skeleton key={i} className="h-16" />)}</div>
      ) : logs.length === 0 ? (
        <EmptyState icon={Activity} title="No activity found" description="Try a different filter." />
      ) : (
        <>
          {/* An audit trail is columnar by nature — when, who, what — so it reads
              as the same kind of table as the rest of the console. */}
          <Card className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-100 dark:border-slate-800 text-left text-xs uppercase text-slate-400">
                  <th className="px-5 py-3 font-semibold">When</th>
                  <th className="px-5 py-3 font-semibold">Who</th>
                  {showOrgColumn && <th className="px-5 py-3 font-semibold">Organization</th>}
                  <th className="px-5 py-3 font-semibold">Action</th>
                  <th className="px-5 py-3 font-semibold">Details</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-50 dark:divide-slate-800/50">
                {logs.map((log) => {
                  const Icon = actionIcon(log.action);
                  return (
                    <tr key={log._id} className="hover:bg-slate-50/50 dark:hover:bg-slate-800/30">
                      <td className="whitespace-nowrap px-5 py-3 align-top">
                        <p className="font-medium text-slate-700 dark:text-slate-200">{formatDateTime(log.createdAt)}</p>
                        <p className="text-xs text-slate-400">{timeAgo(log.createdAt)}</p>
                      </td>
                      <td className="px-5 py-3 align-top">
                        <span className="flex items-center gap-2.5">
                          <Avatar src={log.user?.avatar} name={log.user?.name} size="sm" />
                          <span className="min-w-0">
                            <span className="block truncate font-semibold text-slate-700 dark:text-slate-200">{log.user?.name || 'Someone'}</span>
                            {log.user?.email && <span className="block truncate text-xs text-slate-400">{log.user.email}</span>}
                          </span>
                        </span>
                      </td>
                      {showOrgColumn && (
                        <td className="whitespace-nowrap px-5 py-3 align-top">
                          {log.organization?.name ? (
                            <span className="inline-flex items-center gap-1.5 text-slate-600 dark:text-slate-300">
                              <Building2 className="h-3.5 w-3.5 text-slate-400" /> {log.organization.name}
                            </span>
                          ) : (
                            <span className="text-slate-300 dark:text-slate-600">Platform</span>
                          )}
                        </td>
                      )}
                      <td className="whitespace-nowrap px-5 py-3 align-top">
                        <span className="inline-flex items-center gap-2">
                          <span className={cn('flex h-7 w-7 shrink-0 items-center justify-center rounded-lg', actionTone(log.action))}>
                            <Icon className="h-4 w-4" />
                          </span>
                          <span className="font-medium text-slate-600 dark:text-slate-300">{actionLabel(log.action)}</span>
                        </span>
                      </td>
                      <td className="px-5 py-3 align-top text-slate-600 dark:text-slate-300">{activityDetail(log)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
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
