import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { motion } from 'framer-motion';
import {
  FileText, CheckCircle2, Clock, XCircle, Send, Image as ImageIcon,
  FileImage, Layers, TrendingUp, Award,
} from 'lucide-react';
import { dashboardApi, organizationApi } from '../api/endpoints.js';
import { useAuthStore } from '../store/authStore.js';
import StatCard from '../components/dashboard/StatCard.jsx';
import SocialCards from '../components/dashboard/SocialCards.jsx';
import AiInsights from '../components/dashboard/AiInsights.jsx';
import GoalCard from '../components/dashboard/GoalCard.jsx';
import ActivityHeatmapCard from '../components/dashboard/ActivityHeatmapCard.jsx';
import ActivityTimeline from '../components/dashboard/ActivityTimeline.jsx';
import MyUploads from '../components/dashboard/MyUploads.jsx';
import { MonthlyTrendChart, FollowerTrendChart, PlatformBarChart, StatusPieChart } from '../components/dashboard/Charts.jsx';
import { Card, Skeleton } from '../components/ui/primitives.jsx';

export default function Dashboard() {
  const { user } = useAuthStore();
  // Admin + CEO get the org-wide dashboard; regular users get their personal view.
  const isCEO = ['ADMIN', 'CEO'].includes(user?.role);
  const isAdmin = user?.role === 'ADMIN';

  // Admins aren't tied to an organization, so the dashboard needs an org picker
  // for them (last choice remembered). CEO/USER are locked to their own org.
  const ownOrgId = user?.organization?._id || user?.organization || '';
  const [orgId, setOrgId] = useState(() => ownOrgId || (isAdmin ? localStorage.getItem('tag-dashboard-org') || '' : ''));
  const { data: orgData } = useQuery({ queryKey: ['org-options'], queryFn: organizationApi.options, enabled: isAdmin });
  const orgs = orgData?.organizations || [];
  useEffect(() => {
    if (!isAdmin || !orgs.length) return;
    if (!orgId || !orgs.some((o) => o._id === orgId)) setOrgId(orgs[0]._id);
  }, [isAdmin, orgId, orgs]);
  useEffect(() => {
    if (isAdmin && orgId) localStorage.setItem('tag-dashboard-org', orgId);
  }, [isAdmin, orgId]);

  const { data: statsData, isLoading: loadingStats } = useQuery({ queryKey: ['dashboard', 'stats', orgId], queryFn: () => dashboardApi.stats(orgId), enabled: !!orgId });
  const { data: chartsData, isLoading: loadingCharts } = useQuery({ queryKey: ['dashboard', 'charts', orgId], queryFn: () => dashboardApi.charts(orgId), enabled: !!orgId });
  const { data: activityData } = useQuery({ queryKey: ['dashboard', 'activity', orgId], queryFn: () => dashboardApi.activity(orgId), enabled: !!orgId });
  const { data: topData } = useQuery({ queryKey: ['dashboard', 'top-platform', orgId], queryFn: () => dashboardApi.topPlatform(orgId), enabled: !!orgId });

  const stats = statsData?.stats || {};
  const charts = chartsData?.charts || {};

  // Role-specific KPI selection
  const kpis = isCEO
    ? [
        { label: 'Pending Approvals', value: stats.pending, icon: Clock, tone: 'amber', to: '/approvals?status=PENDING' },
        { label: 'Approved Content', value: stats.approved, icon: CheckCircle2, tone: 'emerald', to: '/approvals?status=APPROVED' },
        { label: 'Rejected Content', value: stats.rejected, icon: XCircle, tone: 'rose', to: '/approvals?status=REJECTED' },
        { label: 'Posted Content', value: stats.posted, icon: Send, tone: 'violet', to: '/approvals?status=POSTED' },
      ]
    : [
        { label: 'My Pending Requests', value: stats.pending, icon: Clock, tone: 'amber', to: '/approvals?status=PENDING' },
        { label: 'My Approved', value: stats.approved, icon: CheckCircle2, tone: 'emerald', to: '/approvals?status=APPROVED' },
        { label: 'My Rejected', value: stats.rejected, icon: XCircle, tone: 'rose', to: '/approvals?status=REJECTED' },
        { label: 'My Posted', value: stats.posted, icon: Send, tone: 'violet', to: '/approvals?status=POSTED' },
      ];

  const overall = [
    { label: 'Total Requests', value: stats.totalRequests, icon: FileText, tone: 'brand', to: '/approvals' },
    { label: 'Total Posts', value: stats.totalPosts, icon: Send, tone: 'violet', to: '/approvals?status=POSTED' },
    { label: 'Templates', value: stats.totalTemplates, icon: FileImage, tone: 'sky', to: '/templates' },
    { label: 'Assets', value: stats.totalAssets, icon: Layers, tone: 'emerald', to: '/assets' },
  ];

  return (
    <div className="space-y-6">
      {/* Welcome hero — the login's navy identity carried into the product */}
      <motion.div
        initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
        className="relative isolate overflow-hidden rounded-3xl bg-gradient-to-br from-[#0b2350] via-[#0a1f44] to-[#07152e] p-6 text-white sm:p-8"
      >
        <div aria-hidden className="pointer-events-none absolute -right-20 -top-24 h-72 w-72 rounded-full bg-brand-500/25 blur-3xl" />
        <div aria-hidden className="pointer-events-none absolute -bottom-28 -left-16 h-80 w-80 rounded-full bg-brand-400/15 blur-3xl" />
        <div aria-hidden className="login-noise absolute inset-0" />
        <div className="relative z-10 flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-brand-300/90">
              {new Date().toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long' })}
            </p>
            <h1 className="mt-1 text-2xl font-extrabold tracking-tight sm:text-3xl">
              {(() => { const h = new Date().getHours(); return h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening'; })()}, {user?.name?.split(' ')[0]} 👋
            </h1>
            <p className="mt-1.5 text-sm text-white/65">
              {isCEO ? 'Here is what is happening across your marketing operations.' : 'Track your content and stay on top of approvals.'}
            </p>
          </div>
          {isAdmin && orgs.length > 0 && (
            <select aria-label="Organization"
              className="h-10 w-auto cursor-pointer rounded-xl border border-white/15 bg-white/10 px-3 text-sm font-semibold text-white outline-none backdrop-blur transition hover:bg-white/15 focus:ring-4 focus:ring-brand-500/30 [&>option]:text-slate-800"
              value={orgId} onChange={(e) => setOrgId(e.target.value)}>
              {orgs.map((o) => <option key={o._id} value={o._id}>{o.name}</option>)}
            </select>
          )}
        </div>
      </motion.div>

      {/* Yearly goal progress (only shows when a goal is set) */}
      {orgId && <GoalCard orgId={orgId} />}

      {/* Tago's AI read-out of the live numbers */}
      <AiInsights orgId={orgId} />

      {/* Social analytics */}
      <SocialCards social={statsData?.social} orgId={orgId} />

      {/* Activity heatmap — role-aware view of a full year */}
      <ActivityHeatmapCard organizationId={isAdmin ? orgId : ownOrgId} />

      {/* Role KPIs */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        {loadingStats
          ? Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-28" />)
          : kpis.map((k, i) => <StatCard key={k.label} {...k} delay={i * 0.05} />)}
      </div>

      {/* Overall stats */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        {overall.map((k, i) => <StatCard key={k.label} {...k} delay={i * 0.05} />)}
      </div>

      {/* Top platform highlight (CEO) */}
      {isCEO && topData?.topPlatform && (
        <Card className="flex items-center justify-between p-6">
          <div className="flex items-center gap-4">
            <div className="rounded-2xl bg-brand-50 p-3 text-brand-600 dark:bg-brand-500/10"><Award className="h-7 w-7" /></div>
            <div>
              <p className="text-sm text-slate-400">Top performing platform</p>
              <p className="text-2xl font-extrabold text-slate-800 dark:text-white">{topData.topPlatform.platform}</p>
            </div>
          </div>
          <div className="hidden gap-8 text-right sm:flex">
            <div><p className="text-2xl font-bold text-slate-800 dark:text-white">{topData.topPlatform.engagementRate?.toFixed(1)}%</p><p className="text-xs text-slate-400">Engagement</p></div>
            <div className="flex items-center"><TrendingUp className="h-8 w-8 text-brand-300" /></div>
          </div>
        </Card>
      )}

      {/* Charts */}
      {loadingCharts ? (
        <div className="grid gap-4 lg:grid-cols-2">
          <Skeleton className="h-80" /><Skeleton className="h-80" />
        </div>
      ) : (
        <>
          <div className="grid gap-4 lg:grid-cols-2">
            <MonthlyTrendChart data={charts.monthlyTrend} />
            <FollowerTrendChart data={charts.followerSeries} />
          </div>
          <div className="grid gap-4 lg:grid-cols-2">
            <PlatformBarChart data={charts.platformDistribution} />
            <StatusPieChart data={charts.statusDistribution} />
          </div>
        </>
      )}

      {/* Activity timeline + (for users) recent uploads */}
      {isCEO ? (
        <ActivityTimeline activity={activityData?.activity} />
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          <ActivityTimeline activity={activityData?.activity} />
          <MyUploads />
        </div>
      )}
    </div>
  );
}
