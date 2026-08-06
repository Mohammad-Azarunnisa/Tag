import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { motion } from 'framer-motion';
import {
  Linkedin, Instagram, Youtube, Facebook, Twitter, Globe, Check, ExternalLink,
  Search, ArrowUpDown, ChevronLeft, ChevronRight, Building2, Users, Link2, Trophy, TrendingUp,
} from 'lucide-react';
import { analyticsApi } from '../api/endpoints.js';
import { Card, Skeleton, EmptyState } from './ui/primitives.jsx';
import CountUp from './CountUp.jsx';
import { formatNumber, formatDate, cn } from '../lib/utils.js';

const ICON = { LinkedIn: Linkedin, Instagram: Instagram, YouTube: Youtube, Facebook: Facebook, 'X (Twitter)': Twitter, Website: Globe };
const COLOR = { LinkedIn: '#0A66C2', Instagram: '#E1306C', YouTube: '#FF0000', Facebook: '#1877F2', 'X (Twitter)': '#0f172a', Website: '#0ea5e9' };
const PAGE = 12;

// The group's preferred display order (grid default; column sorts override).
// Anything not listed lands at the end, alphabetically.
const ORG_ORDER = ['ncet', 'ncms', 'ndc', 'toriiminds', 'npuc cbpur', 'npuc yelahanka', 'educare', 'technical hub'];
const orgRank = (name = '') => {
  const n = name.toLowerCase();
  const i = ORG_ORDER.findIndex((k) => n.includes(k));
  return i === -1 ? ORG_ORDER.length : i;
};

// Cross-organization grid: one row per org, one column per platform. Each cell
// shows the audience count with a strength bar (share of the column's leader),
// the per-platform leader gets a crown, and a totals row closes the table.
export default function AnalyticsOverview({ onOpen }) {
  const { data, isLoading } = useQuery({ queryKey: ['analytics-overview'], queryFn: analyticsApi.overview });
  // X (Twitter) is tracked in the social-handlers directory but not shown here.
  const platforms = (data?.platforms || []).filter((p) => p.key !== 'X (Twitter)');
  const orgs = data?.organizations || [];
  const [search, setSearch] = useState('');
  const [sort, setSort] = useState({ key: null, dir: 'desc' });
  const [page, setPage] = useState(1);

  // Column stats over ALL orgs (stable regardless of search/pagination):
  // max → strength bars + crown, total → footer row and the headline tiles.
  const stats = useMemo(() => {
    const colMax = {}; const colTotal = {}; const colLinked = {};
    let linked = 0; let audience = 0;
    platforms.forEach((p) => { colMax[p.key] = 0; colTotal[p.key] = 0; colLinked[p.key] = 0; });
    const orgTotals = orgs.map((o) => {
      let t = 0;
      platforms.forEach((p) => {
        const c = o.cells[p.key];
        if (!c?.exists) return;
        linked += 1; colLinked[p.key] += 1;
        if (p.kind === 'analytics' && c.metric != null) {
          t += c.metric; colTotal[p.key] += c.metric;
          if (c.metric > colMax[p.key]) colMax[p.key] = c.metric;
        }
      });
      return { org: o, total: t };
    });
    audience = orgTotals.reduce((a, x) => a + x.total, 0);
    const topOrg = orgTotals.reduce((best, x) => (x.total > (best?.total ?? -1) ? x : best), null);
    const bestPlatform = platforms
      .filter((p) => p.kind === 'analytics')
      .reduce((best, p) => (colTotal[p.key] > (best ? colTotal[best.key] : -1) ? p : best), null);
    return { colMax, colTotal, colLinked, linked, audience, topOrg, bestPlatform, possible: orgs.length * platforms.length };
  }, [orgs, platforms]);

  const filtered = useMemo(() => {
    let list = orgs.filter((o) => o.name.toLowerCase().includes(search.toLowerCase()));
    if (sort.key) {
      list = [...list].sort((a, b) => {
        const av = a.cells[sort.key]?.metric ?? -1;
        const bv = b.cells[sort.key]?.metric ?? -1;
        return sort.dir === 'desc' ? bv - av : av - bv;
      });
    } else {
      list = [...list].sort((a, b) => orgRank(a.name) - orgRank(b.name) || a.name.localeCompare(b.name));
    }
    return list;
  }, [orgs, search, sort]);

  const pages = Math.max(1, Math.ceil(filtered.length / PAGE));
  const current = Math.min(page, pages);
  const rows = filtered.slice((current - 1) * PAGE, current * PAGE);

  const toggleSort = (key, sortable) => {
    if (!sortable) return;
    setPage(1);
    setSort((s) => (s.key === key ? { key, dir: s.dir === 'desc' ? 'asc' : 'desc' } : { key, dir: 'desc' }));
  };

  if (isLoading) {
    return (
      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">{Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-24" />)}</div>
        <Card className="p-4"><div className="space-y-2">{Array.from({ length: 8 }).map((_, i) => <Skeleton key={i} className="h-12" />)}</div></Card>
      </div>
    );
  }
  if (!orgs.length) {
    return <EmptyState icon={Building2} title="No organizations yet" description="Create organizations and add their social accounts to see the overview grid." />;
  }

  const headBg = 'bg-white dark:bg-slate-900';
  const BestIcon = stats.bestPlatform ? ICON[stats.bestPlatform.key] || Globe : TrendingUp;

  return (
    <div className="space-y-4">
      {/* Headline: what the whole group adds up to */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <HeadTile delay={0} icon={Users} label="Total audience"
          value={<CountUp value={stats.audience} />} sub="followers & subscribers across the group" />
        <HeadTile delay={0.05} icon={Link2} label="Accounts linked"
          value={<><CountUp value={stats.linked} /><span className="text-base font-bold text-slate-400"> / {stats.possible}</span></>}
          sub={<ProgressBar pct={stats.possible ? (stats.linked / stats.possible) * 100 : 0} />} />
        <HeadTile delay={0.1} icon={Trophy} label="Top organization"
          value={<span className="truncate">{stats.topOrg?.org?.name || '—'}</span>}
          sub={stats.topOrg ? `${formatNumber(stats.topOrg.total)} total audience` : 'no data yet'} amber />
        <HeadTile delay={0.15} icon={BestIcon} label="Leading platform"
          value={<span className="truncate">{stats.bestPlatform?.key || '—'}</span>}
          sub={stats.bestPlatform ? `${formatNumber(stats.colTotal[stats.bestPlatform.key])} combined audience` : 'no data yet'}
          iconColor={stats.bestPlatform ? COLOR[stats.bestPlatform.key] : undefined} />
      </div>

      <Card className="overflow-hidden p-0">
        {/* Toolbar */}
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 p-4 dark:border-slate-800">
          <div className="relative w-full max-w-xs">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <input value={search} onChange={(e) => { setSearch(e.target.value); setPage(1); }} placeholder="Search organizations…" className="input-base h-10 pl-9" />
          </div>
          <p className="text-xs text-slate-400">
            {filtered.length} organization{filtered.length === 1 ? '' : 's'} · bars show each college's share of the platform leader ·
            <Trophy className="mx-1 inline h-3 w-3 text-amber-500" />= leads the platform · click a count for its analytics
          </p>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full min-w-[860px] border-collapse text-sm">
            <thead className="sticky top-0 z-20">
              <tr className={cn('border-b border-slate-100 dark:border-slate-800', headBg)}>
                <th className={cn('sticky left-0 z-30 px-4 py-3 text-left text-xs font-bold uppercase tracking-wide text-slate-500', headBg)}>Organization</th>
                {platforms.map((p) => {
                  const Icon = ICON[p.key] || Globe;
                  const sortable = p.kind === 'analytics';
                  const activeSort = sort.key === p.key;
                  return (
                    <th key={p.key} onClick={() => toggleSort(p.key, sortable)}
                      className={cn('px-3 py-3 text-center', sortable && 'cursor-pointer select-none hover:bg-slate-50 dark:hover:bg-slate-800')}
                      title={sortable ? 'Sort by this platform' : undefined}>
                      <div className="flex flex-col items-center gap-1">
                        <span className="flex h-7 w-7 items-center justify-center rounded-lg text-white shadow-sm" style={{ background: COLOR[p.key] || '#64748b' }}><Icon className="h-4 w-4" /></span>
                        <span className="flex items-center gap-1 text-[11px] font-semibold text-slate-600 dark:text-slate-300">
                          {p.key}
                          {sortable && <ArrowUpDown className={cn('h-3 w-3', activeSort ? 'text-brand-600' : 'text-slate-300')} />}
                        </span>
                        <span className="text-[10px] font-medium tabular-nums text-slate-400">
                          {p.kind === 'analytics' ? formatNumber(stats.colTotal[p.key]) : `${stats.colLinked[p.key]}/${orgs.length}`}
                        </span>
                      </div>
                    </th>
                  );
                })}
              </tr>
            </thead>
            <tbody>
              {rows.map((o, i) => (
                <motion.tr
                  key={o._id}
                  initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.03, duration: 0.35, ease: [0.22, 1, 0.36, 1] }}
                  className={cn('border-b border-slate-50 transition-colors last:border-0 dark:border-slate-800/60', i % 2 ? 'bg-slate-50/40 dark:bg-slate-800/20' : 'bg-white dark:bg-slate-900', 'hover:bg-brand-50/50 dark:hover:bg-brand-500/5')}
                >
                  <td className={cn('sticky left-0 z-10 px-4 py-2.5', i % 2 ? 'bg-slate-50 dark:bg-slate-900' : 'bg-white dark:bg-slate-900')}>
                    <span className="flex items-center gap-2.5">
                      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-xs font-bold text-white shadow-sm"
                        style={{ background: o.color || '#94a3b8' }}>
                        {o.name?.[0]?.toUpperCase()}
                      </span>
                      <span className="min-w-0">
                        <span className="block truncate font-semibold text-slate-800 dark:text-white">{o.name}</span>
                        <span className="block text-[11px] tabular-nums text-slate-400">
                          {formatNumber(platforms.reduce((a, p) => a + (p.kind === 'analytics' ? (o.cells[p.key]?.metric || 0) : 0), 0))} total audience
                        </span>
                      </span>
                    </span>
                  </td>
                  {platforms.map((p) => (
                    <OverviewCell key={p.key} org={o} platform={p} onOpen={onOpen}
                      colMax={stats.colMax[p.key]} leader={p.kind === 'analytics' && stats.colMax[p.key] > 0 && (o.cells[p.key]?.metric ?? -1) === stats.colMax[p.key]} />
                  ))}
                </motion.tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="border-t-2 border-slate-100 bg-slate-50/70 dark:border-slate-800 dark:bg-slate-800/40">
                <td className="sticky left-0 z-10 bg-slate-50 px-4 py-3 text-xs font-bold uppercase tracking-wide text-slate-500 dark:bg-slate-900">All organizations</td>
                {platforms.map((p) => (
                  <td key={p.key} className="px-3 py-3 text-center">
                    {p.kind === 'analytics' ? (
                      <span className="font-extrabold tabular-nums text-slate-800 dark:text-white">{formatNumber(stats.colTotal[p.key])}</span>
                    ) : (
                      <span className="text-xs font-semibold text-slate-500 dark:text-slate-400">{stats.colLinked[p.key]} of {orgs.length} linked</span>
                    )}
                  </td>
                ))}
              </tr>
            </tfoot>
          </table>
        </div>

        {pages > 1 && (
          <div className="flex items-center justify-between border-t border-slate-100 p-3 dark:border-slate-800">
            <button disabled={current === 1} onClick={() => setPage(current - 1)} className="inline-flex items-center gap-1 rounded-lg px-3 py-1.5 text-sm font-semibold text-slate-600 hover:bg-slate-100 disabled:opacity-40 dark:text-slate-300 dark:hover:bg-slate-800"><ChevronLeft className="h-4 w-4" /> Prev</button>
            <span className="text-xs text-slate-400">Page {current} of {pages}</span>
            <button disabled={current === pages} onClick={() => setPage(current + 1)} className="inline-flex items-center gap-1 rounded-lg px-3 py-1.5 text-sm font-semibold text-slate-600 hover:bg-slate-100 disabled:opacity-40 dark:text-slate-300 dark:hover:bg-slate-800">Next <ChevronRight className="h-4 w-4" /></button>
          </div>
        )}
      </Card>
    </div>
  );
}

// Headline tile above the grid.
function HeadTile({ icon: Icon, label, value, sub, delay = 0, amber = false, iconColor }) {
  return (
    <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay, duration: 0.4, ease: [0.22, 1, 0.36, 1] }} className="card p-4">
      <div className="flex items-center justify-between">
        <p className="text-[11px] font-bold uppercase tracking-wide text-slate-400">{label}</p>
        <span className={cn('flex h-8 w-8 items-center justify-center rounded-xl', amber ? 'bg-amber-50 text-amber-500 dark:bg-amber-500/10' : 'bg-brand-50 text-brand-600 dark:bg-brand-500/10')}
          style={iconColor ? { color: iconColor } : undefined}>
          <Icon className="h-4 w-4" />
        </span>
      </div>
      <p className="mt-1.5 truncate text-2xl font-extrabold tabular-nums tracking-tight text-slate-800 dark:text-white">{value}</p>
      <div className="mt-1 text-[11px] text-slate-400">{sub}</div>
    </motion.div>
  );
}

function ProgressBar({ pct }) {
  return (
    <span className="mt-1 flex items-center gap-2">
      <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800">
        <motion.span initial={{ scaleX: 0 }} animate={{ scaleX: Math.min(1, pct / 100) }} transition={{ delay: 0.4, duration: 0.8, ease: 'easeOut' }}
          className="block h-full w-full origin-left rounded-full bg-gradient-to-r from-brand-500 to-brand-300" />
      </span>
      <span className="text-[11px] font-bold tabular-nums text-brand-600 dark:text-brand-400">{Math.round(pct)}%</span>
    </span>
  );
}

function OverviewCell({ org, platform, onOpen, colMax = 0, leader = false }) {
  const c = org.cells[platform.key] || { exists: false };
  if (!c.exists) {
    return (
      <td className="px-3 py-2.5 text-center">
        <span className="inline-flex items-center rounded-md border border-dashed border-slate-200 px-2 py-1 text-[11px] font-medium text-slate-400 dark:border-slate-700 dark:text-slate-500">
          Not linked
        </span>
      </td>
    );
  }
  const tip = [
    c.username && (platform.key === 'Website' ? c.username : `@${c.username}`),
    c.metric != null && `${formatNumber(c.metric)} ${c.label}`,
    c.lastUpdated && `Updated ${formatDate(c.lastUpdated)}`,
    leader && 'Leads this platform',
  ].filter(Boolean).join(' · ');
  const big = c.metric != null ? formatNumber(c.metric) : 'Yes';
  const sub = c.metric != null ? c.label : (c.username || (platform.kind === 'website' ? 'Live site' : 'Linked'));
  // Strength bar: this org's share of the platform leader — makes the whole
  // column scannable like a heatmap.
  const pct = platform.kind === 'analytics' && c.metric != null && colMax > 0 ? Math.max(2, (c.metric / colMax) * 100) : null;

  const inner = (
    <span className="inline-flex w-[92px] flex-col items-center leading-tight">
      <span className="inline-flex items-center gap-1 font-bold tabular-nums text-slate-800 dark:text-white">
        {leader ? <Trophy className="h-3.5 w-3.5 text-amber-500" /> : <Check className="h-3.5 w-3.5 text-emerald-500" />}
        {big}
      </span>
      {pct != null ? (
        <span className="mt-1 h-1 w-full overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800">
          <span className="block h-full rounded-full" style={{ width: `${pct}%`, background: COLOR[platform.key] || '#64748b', opacity: 0.75 }} />
        </span>
      ) : null}
      <span className="mt-0.5 max-w-[92px] truncate text-[11px] text-slate-400">{sub}</span>
    </span>
  );

  if (platform.kind === 'analytics') {
    return (
      <td className="px-3 py-2.5 text-center">
        <button title={tip} onClick={() => onOpen(org._id, platform.key)} className="rounded-lg px-2 py-1 transition hover:-translate-y-0.5 hover:bg-slate-50 hover:shadow-soft dark:hover:bg-slate-800/60">{inner}</button>
      </td>
    );
  }
  if (c.url) {
    const href = /^https?:\/\//i.test(c.url) ? c.url : `https://${c.url}`;
    return (
      <td className="px-3 py-2.5 text-center">
        <a href={href} target="_blank" rel="noreferrer" title={tip} className="inline-flex items-center gap-1 rounded-lg px-2 py-1 transition hover:-translate-y-0.5 hover:bg-slate-50 hover:shadow-soft dark:hover:bg-slate-800/60">{inner}<ExternalLink className="h-3 w-3 text-slate-400" /></a>
      </td>
    );
  }
  return <td className="px-3 py-2.5 text-center" title={tip}>{inner}</td>;
}
