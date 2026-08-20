import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import {
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
} from 'recharts';
import { FileText, Clock, CheckCircle2, XCircle, RefreshCw, Send, TrendingUp } from 'lucide-react';
import { reportApi } from '../api/endpoints.js';
import PageHeader from '../components/layout/PageHeader.jsx';
import { Card, Badge, Avatar, Skeleton } from '../components/ui/primitives.jsx';
import StatCard from '../components/dashboard/StatCard.jsx';
import { formatDate } from '../lib/utils.js';

export default function ApprovalAnalytics() {
  const { data, isLoading } = useQuery({ queryKey: ['approval-analytics'], queryFn: reportApi.analytics });
  const k = data?.kpis || {};
  const tables = data?.tables || {};

  const kpis = [
    { label: 'Total Requests', value: k.total, icon: FileText, tone: 'brand' },
    { label: 'Pending', value: k.pending, icon: Clock, tone: 'amber' },
    { label: 'Approved', value: k.approved, icon: CheckCircle2, tone: 'emerald' },
    { label: 'Rejected', value: k.rejected, icon: XCircle, tone: 'rose' },
    { label: 'Resubmitted', value: k.resubmitted, icon: RefreshCw, tone: 'sky' },
    { label: 'Posted', value: k.posted, icon: Send, tone: 'violet' },
  ];
  const userPerformance = (data?.userPerformance || []).map((user) => ({
    ...user,
    completed: user.approved,
    remaining: Math.max(0, user.total - user.approved),
  }));

  if (isLoading) return <div className="space-y-4"><Skeleton className="h-10 w-48" /><div className="grid grid-cols-2 gap-4 lg:grid-cols-6">{Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-28" />)}</div></div>;

  return (
    <div className="space-y-6">
      <PageHeader title="Approval Analytics" subtitle="Performance and trends across the approval workflow." />

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-6">
        {kpis.map((kpi, i) => <StatCard key={kpi.label} {...kpi} delay={i * 0.04} />)}
      </div>

      {/* Success rate + user performance */}
      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="flex flex-col items-center justify-center bg-gradient-to-br from-emerald-500 to-emerald-700 p-6 text-white">
          <TrendingUp className="mb-2 h-8 w-8" />
          <p className="text-5xl font-extrabold">{k.successRate ?? 0}%</p>
          <p className="mt-1 text-sm text-emerald-100">Success Rate</p>
          <p className="mt-1 text-xs text-emerald-200">Approved + Posted vs total</p>
        </Card>

        <Card className="p-5 lg:col-span-2">
          <div className="mb-5 flex items-start justify-between gap-4">
            <div>
              <h3 className="font-bold text-slate-800 dark:text-white">User Performance</h3>
              <p className="mt-1 text-xs text-slate-400">Completed requests compared with total submitted</p>
            </div>
            <div className="flex shrink-0 items-center gap-3 text-[11px] font-medium text-slate-500 dark:text-slate-400">
              <span className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-emerald-500" />Completed</span>
              <span className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-slate-200 dark:bg-slate-700" />Remaining</span>
            </div>
          </div>
          {userPerformance.length ? (
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={userPerformance} layout="vertical" margin={{ left: 12, right: 28, top: 4, bottom: 4 }} barCategoryGap="28%">
                <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" vertical={false} />
                <XAxis type="number" tick={{ fontSize: 11, fill: '#94a3b8' }} axisLine={false} tickLine={false} allowDecimals={false} />
                <YAxis type="category" dataKey="name" width={88} tick={{ fontSize: 12, fill: '#64748b' }} axisLine={false} tickLine={false} />
                <Tooltip
                  contentStyle={{ borderRadius: 10, border: '1px solid #e2e8f0', fontSize: 13, boxShadow: '0 8px 24px -8px rgba(15,23,42,0.2)' }}
                  cursor={{ fill: 'rgba(16,185,129,0.06)' }}
                  formatter={(value, name) => [value, name === 'completed' ? 'Completed' : 'Remaining']}
                />
                <Bar dataKey="completed" stackId="requests" fill="#10b981" radius={[0, 5, 5, 0]} name="Completed" />
                <Bar dataKey="remaining" stackId="requests" fill="#e2e8f0" radius={[0, 5, 5, 0]} name="Remaining" />
              </BarChart>
            </ResponsiveContainer>
          ) : <p className="text-sm text-slate-400">No data yet.</p>}
        </Card>
      </div>

      {/* Tables */}
      <div className="grid gap-4 lg:grid-cols-3">
        <RequestTable title="Recent Requests" rows={tables.recentRequests} />
        <RequestTable title="Recent Rejections" rows={tables.recentRejections} dateField="rejectedAt" />
        <RequestTable title="Recently Posted" rows={tables.recentPosted} dateField="postedAt" />
      </div>
    </div>
  );
}

function RequestTable({ title, rows = [], dateField = 'createdAt' }) {
  return (
    <Card className="p-5">
      <h3 className="mb-4 font-bold text-slate-800 dark:text-white">{title}</h3>
      {rows.length === 0 ? (
        <p className="text-sm text-slate-400">No records.</p>
      ) : (
        <div className="space-y-2">
          {rows.map((r) => (
            <Link key={r._id} to={`/approvals/${r._id}`} className="flex items-center gap-3 rounded-xl p-2 hover:bg-slate-50 dark:hover:bg-slate-800/50">
              <Avatar src={r.createdBy?.avatar} name={r.createdBy?.name} size="sm" />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium text-slate-700 dark:text-slate-200">{r.title}</p>
                <p className="text-[11px] text-slate-400">{formatDate(r[dateField])}</p>
              </div>
              <Badge status={r.status}>{r.status}</Badge>
            </Link>
          ))}
        </div>
      )}
    </Card>
  );
}
