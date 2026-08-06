import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Cell, LabelList } from 'recharts';
import { Trophy } from 'lucide-react';
import { analyticsApi } from '../api/endpoints.js';
import { Card, Skeleton, EmptyState } from './ui/primitives.jsx';
import { DeltaBadge } from './AnalyticsReport.jsx';
import { formatNumber } from '../lib/utils.js';

const PLATFORMS = ['LinkedIn', 'Instagram', 'YouTube', 'Facebook'];
// Metrics that make sense to compare across organizations, per platform.
const METRICS = {
  LinkedIn: ['followers', 'newFollowers', 'impressions', 'clicks', 'engagementRate', 'searchAppearances', 'pageViews', 'postsPublished', 'leads'],
  Instagram: ['followers', 'newFollowers', 'reach', 'impressions', 'engagementRate'],
  YouTube: ['subscribers', 'views', 'watchHours', 'engagementRate'],
  Facebook: ['followers', 'newFollowers', 'interactions', 'visits'],
};
const LABELS = {
  followers: 'Total Followers', newFollowers: 'New Followers', impressions: 'Post Impressions',
  engagementRate: 'Engagement Rate', searchAppearances: 'Search Appearances', pageViews: 'Page Views',
  reach: 'Reach', subscribers: 'Subscribers', views: 'Views', watchHours: 'Watch Hours',
  interactions: 'Interactions', visits: 'Visits',
  clicks: 'Clicks', postsPublished: 'Posts Published', leads: 'Leads',
};
const COLORS = ['#7c3aed', '#0ea5e9', '#10b981', '#f59e0b', '#ef4444', '#ec4899', '#06b6d4', '#8b5cf6'];

export default function OrgCompare() {
  const [platform, setPlatform] = useState('LinkedIn');
  const [metric, setMetric] = useState('followers');
  const isPct = metric === 'engagementRate';

  const { data, isLoading } = useQuery({
    queryKey: ['compare', platform, metric],
    queryFn: () => analyticsApi.compare(platform, metric),
  });
  const rows = (data?.organizations || []).filter((r) => r.hasData);
  const chartData = rows.map((r) => ({ name: r.organization.name, value: r.current, color: r.organization.color }));

  return (
    <div className="space-y-5">
      <Card className="flex flex-wrap items-center gap-3 p-3">
        <div className="flex items-center gap-2 pl-1 text-sm font-medium text-slate-500"><Trophy className="h-4 w-4" /> Compare</div>
        <select className="input-base max-w-[180px] cursor-pointer" value={platform} onChange={(e) => { setPlatform(e.target.value); setMetric(METRICS[e.target.value][0]); }}>
          {PLATFORMS.map((p) => <option key={p} value={p}>{p}</option>)}
        </select>
        <select className="input-base max-w-[220px] cursor-pointer" value={metric} onChange={(e) => setMetric(e.target.value)}>
          {METRICS[platform].map((m) => <option key={m} value={m}>{LABELS[m]}</option>)}
        </select>
      </Card>

      {isLoading ? (
        <Skeleton className="h-80" />
      ) : rows.length === 0 ? (
        <EmptyState icon={Trophy} title="No data to compare" description="Enter this platform's metrics for at least one organization." />
      ) : (
        <>
          <Card className="p-5">
            <h3 className="mb-4 font-bold text-slate-800 dark:text-white">{LABELS[metric]} by organization — {platform}</h3>
            <ResponsiveContainer width="100%" height={Math.max(220, chartData.length * 48)}>
              <BarChart data={chartData} layout="vertical" margin={{ left: 20, right: 72 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" horizontal={false} />
                <XAxis type="number" tick={{ fontSize: 12, fill: '#94a3b8' }} axisLine={false} tickLine={false} tickFormatter={(v) => (isPct ? `${v}%` : formatNumber(v))} />
                <YAxis type="category" dataKey="name" width={110} tick={{ fontSize: 12, fill: '#64748b' }} axisLine={false} tickLine={false} />
                <Tooltip contentStyle={{ borderRadius: 12, fontSize: 13 }} formatter={(v) => (isPct ? `${v}%` : formatNumber(v))} cursor={{ fill: 'rgba(124,58,237,0.06)' }} />
                <Bar dataKey="value" radius={[0, 6, 6, 0]} name={LABELS[metric]}>
                  {chartData.map((d, i) => <Cell key={i} fill={d.color || COLORS[i % COLORS.length]} />)}
                  <LabelList dataKey="value" position="right" formatter={(v) => (isPct ? `${Number(v).toFixed(1)}%` : formatNumber(v))}
                    style={{ fontSize: 12, fontWeight: 700, fill: '#475569' }} />
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </Card>

          <Card className="overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-100 dark:border-slate-800 text-left text-xs uppercase text-slate-400">
                  <th className="px-5 py-3 font-semibold">#</th>
                  <th className="px-5 py-3 font-semibold">Organization</th>
                  <th className="px-5 py-3 font-semibold">{LABELS[metric]}</th>
                  <th className="px-5 py-3 font-semibold">Change vs last entry</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-50 dark:divide-slate-800/50">
                {rows.map((r, i) => (
                  <tr key={r.organization._id} className="hover:bg-slate-50/50 dark:hover:bg-slate-800/30">
                    <td className="px-5 py-3 font-bold text-slate-400">{i + 1}</td>
                    <td className="px-5 py-3">
                      <span className="inline-flex items-center gap-2 font-semibold text-slate-700 dark:text-slate-200">
                        <span className="h-2.5 w-2.5 rounded-full" style={{ background: r.organization.color || '#7c3aed' }} />
                        {r.organization.name}
                      </span>
                    </td>
                    <td className="px-5 py-3 font-extrabold text-slate-800 dark:text-white">{isPct ? `${r.current.toFixed(1)}%` : formatNumber(r.current)}</td>
                    <td className="px-5 py-3"><DeltaBadge delta={r} isPct={isPct} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
        </>
      )}
    </div>
  );
}
