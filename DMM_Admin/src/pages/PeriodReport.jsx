import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useSearchParams } from 'react-router-dom';
import toast from 'react-hot-toast';
import {
  FileBarChart, Download, FileText, Info, TriangleAlert, RefreshCw,
} from 'lucide-react';
import { periodReportApi } from '../api/endpoints.js';
import PageHeader from '../components/layout/PageHeader.jsx';
import { Button } from '../components/ui/Button.jsx';
import { Card, Input, Select, Skeleton, EmptyState } from '../components/ui/primitives.jsx';
import { BmReportPdfModal } from '../components/reports/BmReportPdfModal.jsx';
import { cn, formatNumber } from '../lib/utils.js';
import { useAuthStore } from '../store/authStore.js';

// The windows people actually ask for, so the common case is one click.
const PRESETS = [
  { key: 'this-fortnight', label: 'This fortnight' },
  { key: 'last-fortnight', label: 'Last fortnight' },
  { key: 'this-month', label: 'This month' },
  { key: 'last-month', label: 'Last month' },
  { key: 'this-quarter', label: 'This quarter' },
];

const dash = (v, suffix = '') => (v == null ? '—' : `${formatNumber(v)}${suffix}`);
const money = (v) => (v == null ? '—' : `₹${formatNumber(v)}`);

// Same stage labels the "Designs to be Done" board uses, so "Pending" here
// never reads as one opaque number when the board right next to it already
// breaks the same requests down by exactly where each one is stuck.
const PENDING_STAGE_LABELS = {
  waitingForDesigner: 'Waiting for a designer',
  beingDesigned: 'Being designed',
  withAdminReview: 'With the Admin',
  withCoordinatorReview: 'With the coordinator',
  other: 'No stage recorded (old data)',
};
const pendingStageItems = (byStage) => {
  if (!byStage) return [];
  const total = Object.values(byStage).reduce((a, b) => a + b, 0);
  return Object.entries(byStage)
    .filter(([, count]) => count > 0)
    .map(([key, count]) => ({ label: PENDING_STAGE_LABELS[key] || key, count, share: pct(count, total) }))
    .sort((a, b) => b.count - a.count);
};
const pct = (part, whole) => (whole ? Math.round((part / whole) * 1000) / 10 : null);

// A figure with its label, in the order management reads them.
function Tile({ label, value, sub, accent }) {
  return (
    <Card className="p-4">
      <p className={cn('text-2xl font-extrabold tracking-tight', accent || 'text-slate-800 dark:text-white')}>
        {value}
        {sub && <span className="ml-0.5 text-sm font-bold text-slate-400">{sub}</span>}
      </p>
      <p className="mt-1 text-[11px] font-semibold uppercase tracking-wide text-slate-400">{label}</p>
    </Card>
  );
}

// One table per part. Columns are declared so the header, the body and the total
// row can never drift apart.
function PartTable({ title, note, columns, rows, totals, right }) {
  if (!rows.length) {
    return (
      <Card className="p-5">
        <div className="mb-1 flex flex-wrap items-baseline justify-between gap-2">
          <h3 className="font-bold text-slate-800 dark:text-white">{title}</h3>
          {right && <span className="text-sm text-slate-400">{right}</span>}
        </div>
        <p className="text-sm text-slate-400">Nothing recorded for this period.</p>
      </Card>
    );
  }
  return (
    <Card className="overflow-hidden">
      <div className="flex flex-wrap items-baseline justify-between gap-2 px-5 pt-5">
        <h3 className="font-bold text-slate-800 dark:text-white">{title}</h3>
        {right && <span className="text-sm text-slate-400">{right}</span>}
      </div>
      {note && <p className="px-5 pt-1 text-xs text-slate-400">{note}</p>}
      <div className="mt-3 overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-y border-slate-100 bg-slate-50/70 text-left text-[11px] font-bold uppercase tracking-wide text-slate-500 dark:border-slate-800 dark:bg-slate-800/40 dark:text-slate-400">
              {columns.map((c) => (
                <th key={c.key} className={cn('px-4 py-2.5', c.align === 'right' && 'text-right')}>{c.label}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, i) => (
              <tr key={i} className="border-b border-slate-50 last:border-0 dark:border-slate-800/60">
                {columns.map((c) => (
                  <td key={c.key} className={cn('px-4 py-2.5', c.align === 'right' && 'text-right tabular-nums',
                    c.key === columns[0].key && 'font-semibold text-slate-800 dark:text-white')}>
                    {c.render(row)}
                  </td>
                ))}
              </tr>
            ))}
            {totals && (
              <tr className="bg-slate-800 text-white dark:bg-slate-900">
                {columns.map((c) => (
                  <td key={c.key} className={cn('px-4 py-2.5 font-bold', c.align === 'right' && 'text-right tabular-nums')}>
                    {c.total ? c.total(totals) : ''}
                  </td>
                ))}
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

// A share-of-total breakdown, as a labelled bar list.
function MixList({ title, items, format = (n) => formatNumber(n) }) {
  if (!items?.length) return null;
  const max = Math.max(...items.map((i) => i.count ?? i.amount ?? 0), 1);
  return (
    <Card className="p-5">
      <h3 className="mb-3 text-sm font-bold uppercase tracking-wide text-slate-500 dark:text-slate-400">{title}</h3>
      <div className="space-y-2">
        {items.map((i) => {
          const value = i.count ?? i.amount ?? 0;
          return (
            <div key={i.label} className="flex items-center gap-3">
              <span className="w-56 shrink-0 truncate text-sm font-semibold text-slate-700 dark:text-slate-200">{i.label}</span>
              <span className="h-2 flex-1 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800">
                <span className="block h-full rounded-full bg-brand-500" style={{ width: `${(value / max) * 100}%` }} />
              </span>
              <span className="w-16 shrink-0 text-right text-sm font-bold tabular-nums text-slate-700 dark:text-slate-200">{format(value)}</span>
              <span className="w-14 shrink-0 text-right text-xs font-semibold tabular-nums text-slate-400">
                {i.share == null ? '—' : `${i.share}%`}
              </span>
            </div>
          );
        })}
      </div>
    </Card>
  );
}

/**
 * The Branding & Marketing report for any window — the same five parts the team
 * reports upward, computed live rather than typed up by hand. The monthly run
 * links here with ?from&?to so the notification opens exactly what it summarised.
 */
export default function PeriodReport() {
  const user = useAuthStore((state) => state.user);
  const [params, setParams] = useSearchParams();
  const [preset, setPreset] = useState(params.get('from') ? '' : 'last-fortnight');
  const [from, setFrom] = useState(params.get('from') || '');
  const [to, setTo] = useState(params.get('to') || '');
  const [downloading, setDownloading] = useState(false);
  const [platform, setPlatform] = useState('LinkedIn');
  const [platformDownloading, setPlatformDownloading] = useState(false);
  const [pdfModalOpen, setPdfModalOpen] = useState(false);

  const query = preset ? { preset } : { from, to };
  const ready = !!preset || (!!from && !!to);

  const { data, isLoading, isError, error, refetch, isFetching } = useQuery({
    queryKey: ['period-report', query],
    queryFn: () => periodReportApi.get(query),
    enabled: ready,
  });

  const pickPreset = (key) => {
    setPreset(key);
    setFrom(''); setTo('');
    setParams({}, { replace: true });
  };
  const pickDates = (nextFrom, nextTo) => {
    setFrom(nextFrom); setTo(nextTo);
    if (nextFrom && nextTo) setPreset('');
  };

  const download = async () => {
    setDownloading(true);
    try {
      const blob = await periodReportApi.export(query);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `branding-report-${data?.period?.from || 'period'}-to-${data?.period?.to || ''}.xlsx`;
      a.click();
      URL.revokeObjectURL(url);
    } catch {
      toast.error('Could not build the workbook');
    } finally { setDownloading(false); }
  };

  const downloadPlatformAnalytics = async () => {
    if (!data?.period) return;
    setPlatformDownloading(true);
    try {
      const blob = await periodReportApi.exportPlatformAnalytics({ platform, from: data.period.from, to: data.period.to });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${platform.toLowerCase()}-analytics-${data.period.from}-to-${data.period.to}.xlsx`;
      a.click();
      URL.revokeObjectURL(url);
      toast.success(`${platform} analytics downloaded`);
    } catch (error) {
      toast.error(error?.response?.data?.message || 'Could not build the analytics export');
    } finally { setPlatformDownloading(false); }
  };

  const h = data?.headline;

  return (
    <div>
      <PageHeader
        title="Branding & Marketing Report"
        subtitle="Design output, web development, organic social, paid ads and team output for any period — computed from live data. The super admin also gets this by email and notification every month."
        actions={data && (
          <div className="flex gap-2">
            <Button variant="outline" loading={isFetching} onClick={() => refetch()}>
              <RefreshCw className="h-4 w-4" /> Refresh
            </Button>
            <Button loading={downloading} onClick={download}>
              <Download className="h-4 w-4" /> Download Excel
            </Button>
            <Button variant="outline" onClick={() => setPdfModalOpen(true)}>
              <FileText className="h-4 w-4" /> Download PDF
            </Button>
          </div>
        )}
      />

      <BmReportPdfModal open={pdfModalOpen} onClose={() => setPdfModalOpen(false)} />

      {/* Window picker */}
      <Card className="mb-5 space-y-3 p-4">
        <div className="flex flex-wrap gap-1.5">
          {PRESETS.map((p) => (
            <button key={p.key} type="button" onClick={() => pickPreset(p.key)}
              className={cn('rounded-lg border px-3 py-1.5 text-xs font-semibold transition',
                preset === p.key
                  ? 'border-transparent bg-brand-600 text-white shadow-soft'
                  : 'border-slate-200 text-slate-500 hover:border-brand-300 dark:border-slate-700 dark:text-slate-300')}>
              {p.label}
            </button>
          ))}
        </div>
        <div className="flex flex-wrap items-end gap-3 border-t border-slate-100 pt-3 dark:border-slate-800">
          <Input label="From" type="date" className="sm:w-auto" value={from} onChange={(e) => pickDates(e.target.value, to)} />
          <Input label="To" type="date" className="sm:w-auto" min={from || undefined} value={to} onChange={(e) => pickDates(from, e.target.value)} />
          {data && (
            <p className="pb-2 text-sm text-slate-400">
              Showing <span className="font-bold text-slate-600 dark:text-slate-300">{data.period.from} → {data.period.to}</span>
              {' '}({data.period.days} days, {data.organizations.length} institutions)
            </p>
          )}
        </div>
      </Card>

      {user?.isSuperAdmin && data?.period && (
        <Card className="mb-5 flex flex-wrap items-end justify-between gap-4 p-4">
          <div>
            <h2 className="font-bold text-slate-800 dark:text-white">Platform Analytics Export</h2>
            <p className="mt-1 text-sm text-slate-400">Daily account metrics and individual post performance for every active institution in this report period.</p>
          </div>
          <div className="flex flex-wrap items-end gap-2">
            <Select label="Platform" value={platform} onChange={(event) => setPlatform(event.target.value)} className="min-w-36">
              <option value="LinkedIn">LinkedIn</option>
              <option value="Instagram">Instagram</option>
              <option value="Facebook">Facebook</option>
              <option value="YouTube">YouTube</option>
            </Select>
            <Button loading={platformDownloading} onClick={downloadPlatformAnalytics}>
              <Download className="h-4 w-4" /> Download data
            </Button>
          </div>
        </Card>
      )}

      {!ready ? (
        <EmptyState icon={FileBarChart} title="Pick a period" description="Choose a preset above, or set your own from and to dates." />
      ) : isError ? (
        <EmptyState icon={TriangleAlert} title="Couldn't build the report"
          description={error?.response?.data?.message || 'Something went wrong assembling the figures.'} />
      ) : isLoading || !data ? (
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-6">{Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-24" />)}</div>
          {Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-56" />)}
        </div>
      ) : (
        <div className="space-y-5">
          {/* Headline */}
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-6">
            <Tile label="Designs delivered" value={formatNumber(h.designsDelivered.value)} sub={`/${h.designsDelivered.of}`} accent="text-brand-600 dark:text-brand-400" />
            <Tile label="Delivered on time" value={h.deliveredOnTimeRate == null ? '—' : `${h.deliveredOnTimeRate}%`} accent="text-emerald-600 dark:text-emerald-400" />
            <Tile label="Web tasks done" value={formatNumber(h.webTasksDone.value)} sub={`/${h.webTasksDone.of}`} accent="text-sky-600 dark:text-sky-400" />
            <Tile label="Posts published" value={formatNumber(h.postsPublished)} accent="text-rose-600 dark:text-rose-400" />
            <Tile label="Likes" value={formatNumber(h.likes)} accent="text-indigo-600 dark:text-indigo-400" />
            <Tile label="Ad spend" value={money(h.adSpend)} accent="text-amber-600 dark:text-amber-400" />
          </div>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-6">
            <Tile label="Design pending" value={formatNumber(h.designPending)} />
            <Tile label="Design cancelled" value={formatNumber(h.designCancelled)} accent="text-slate-400" />
            <Tile label="Designs completed" value={formatNumber(h.designsCompleted)} />
            <Tile label="First-pass approval" value={h.firstPassRate == null ? '—' : `${h.firstPassRate}%`} />
            <Tile label="Avg revisions" value={dash(h.avgRevisionRounds)} />
            <Tile label="Organic reach" value={formatNumber(h.organicReach)} />
          </div>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
            <Tile label="Follower growth" value={`+${formatNumber(h.followerGrowth)}`} />
            <Tile label="Paid reach" value={formatNumber(h.paidReach)} />
            <Tile label="Leads from ads" value={formatNumber(h.leadsFromAds)} />
            <Tile label="Cost per lead" value={money(h.costPerLead)} />
            <Tile label="Team tasks done" value={formatNumber(h.teamTasksDone.value)} sub={`/${h.teamTasksDone.of}`} />
          </div>

          {/* Be honest about what the figures can't say */}
          {data.gaps?.length > 0 && (
            <Card className="border-amber-200 bg-amber-50/60 p-4 dark:border-amber-500/30 dark:bg-amber-500/[0.07]">
              <p className="mb-1.5 flex items-center gap-1.5 text-sm font-bold text-amber-800 dark:text-amber-300">
                <Info className="h-4 w-4" /> What these numbers cannot tell you yet
              </p>
              <ul className="space-y-1 text-sm text-amber-800/90 dark:text-amber-300/90">
                {data.gaps.map((g) => <li key={g}>· {g}</li>)}
              </ul>
            </Card>
          )}

          {/* Part 1 */}
          <PartTable
            title="Part 1 — Design output"
            right={`${data.design.totals.completed} designs delivered to ${data.organizations.length} institutions`}
            note="Revision averages on the total row are weighted by volume."
            columns={[
              { key: 'org', label: 'Institution', render: (r) => r.organization.name, total: () => 'ALL INSTITUTIONS' },
              { key: 'rec', label: 'Requests', align: 'right', render: (r) => r.requestsReceived, total: (t) => t.requestsReceived },
              { key: 'done', label: 'Completed', align: 'right', render: (r) => r.completed, total: (t) => t.completed },
              { key: 'pend', label: 'Pending', align: 'right', render: (r) => r.pending, total: (t) => t.pending },
              { key: 'cancel', label: 'Cancelled', align: 'right', render: (r) => r.cancelled, total: (t) => t.cancelled },
              { key: 'ot', label: 'On time', align: 'right', render: (r) => dash(r.deliveredOnTime), total: (t) => dash(t.deliveredOnTime) },
              { key: 'otr', label: 'On-time rate', align: 'right', render: (r) => (r.onTimeRate == null ? '—' : `${r.onTimeRate}%`), total: (t) => (t.onTimeRate == null ? '—' : `${t.onTimeRate}%`) },
              { key: 'fp', label: 'First pass', align: 'right', render: (r) => r.approvedFirstPass, total: (t) => t.approvedFirstPass },
              { key: 'fpr', label: 'First-pass rate', align: 'right', render: (r) => (r.firstPassRate == null ? '—' : `${r.firstPassRate}%`), total: (t) => (t.firstPassRate == null ? '—' : `${t.firstPassRate}%`) },
              { key: 'rev', label: 'Revisions', align: 'right', render: (r) => dash(r.avgRevisionRounds), total: (t) => dash(t.avgRevisionRounds) },
            ]}
            rows={data.design.rows}
            totals={data.design.totals}
          />
          <MixList title="What those designs were" items={data.design.mix} />
          <MixList title="Where the pending ones are stuck" items={pendingStageItems(data.design.totals.pendingByStage)} />

          {/* Part 2 */}
          <PartTable
            title="Part 2 — Web development"
            right={`${data.web.totals.completed} tasks completed`}
            note="Tracked separately from design — web work runs on a longer cycle and would otherwise distort the design turnaround figures."
            columns={[
              { key: 'org', label: 'Institution', render: (r) => r.organization.name, total: () => 'ALL INSTITUTIONS' },
              { key: 'rec', label: 'Received', align: 'right', render: (r) => r.tasksReceived, total: (t) => t.tasksReceived },
              { key: 'done', label: 'Completed', align: 'right', render: (r) => r.completed, total: (t) => t.completed },
              { key: 'pend', label: 'Pending', align: 'right', render: (r) => r.pending, total: (t) => t.pending },
              { key: 'ot', label: 'On time', align: 'right', render: (r) => dash(r.deliveredOnTime), total: (t) => dash(t.deliveredOnTime) },
              { key: 'otr', label: 'On-time rate', align: 'right', render: (r) => (r.onTimeRate == null ? '—' : `${r.onTimeRate}%`), total: (t) => (t.onTimeRate == null ? '—' : `${t.onTimeRate}%`) },
              { key: 'ta', label: 'Turnaround (d)', align: 'right', render: (r) => dash(r.avgTurnaroundDays), total: (t) => dash(t.avgTurnaroundDays) },
            ]}
            rows={data.web.rows}
            totals={data.web.totals}
          />
          <MixList title="Type of web work" items={data.web.mix} />

          {/* Part 3 */}
          <PartTable
            title="Part 3 — Social media, organic"
            right={`${formatNumber(data.social.totals.posts)} posts · ${formatNumber(data.social.totals.reach)} reach · ${formatNumber(data.social.totals.likes)} likes`}
            columns={[
              { key: 'org', label: 'Account', render: (r) => r.organization.name, total: () => 'ALL ACCOUNTS' },
              { key: 'posts', label: 'Posts', align: 'right', render: (r) => r.posts, total: (t) => t.posts },
              { key: 'reach', label: 'Reach', align: 'right', render: (r) => formatNumber(r.reach), total: (t) => formatNumber(t.reach) },
              { key: 'impr', label: 'Impressions', align: 'right', render: (r) => formatNumber(r.impressions), total: (t) => formatNumber(t.impressions) },
              { key: 'likes', label: 'Likes', align: 'right', render: (r) => formatNumber(r.likes), total: (t) => formatNumber(t.likes) },
              { key: 'comm', label: 'Comments', align: 'right', render: (r) => formatNumber(r.comments), total: (t) => formatNumber(t.comments) },
              { key: 'shares', label: 'Shares', align: 'right', render: (r) => formatNumber(r.shares), total: (t) => formatNumber(t.shares) },
              { key: 'inter', label: 'Interactions', align: 'right', render: (r) => formatNumber(r.interactions), total: (t) => formatNumber(t.interactions) },
              { key: 'fol', label: 'Followers', align: 'right', render: (r) => formatNumber(r.followers), total: (t) => formatNumber(t.followers) },
              { key: 'gro', label: 'Growth', align: 'right', render: (r) => `+${formatNumber(r.followerGrowth)}`, total: (t) => `+${formatNumber(t.followerGrowth)}` },
            ]}
            rows={data.social.rows}
            totals={data.social.totals}
          />
          <div className="grid gap-4 lg:grid-cols-2">
            <MixList title="Where we posted" items={data.social.byPlatform} />
            {data.social.leaderboard.length > 0 && (
              <Card className="overflow-hidden">
                <h3 className="px-5 pt-5 text-sm font-bold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                  Ranked by likes
                </h3>
                <table className="mt-3 w-full text-sm">
                  <tbody>
                    {data.social.leaderboard.map((l) => (
                      <tr key={l.organization._id} className="border-b border-slate-50 last:border-0 dark:border-slate-800/60">
                        <td className="px-5 py-2 text-xs font-bold text-slate-400">{l.rank}</td>
                        <td className="py-2 font-semibold text-slate-800 dark:text-white">{l.organization.name}</td>
                        <td className="py-2 text-right text-slate-500 dark:text-slate-400">{formatNumber(l.reach)}</td>
                        <td className="px-5 py-2 text-right font-bold tabular-nums text-slate-700 dark:text-slate-200">{formatNumber(l.likes)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </Card>
            )}
          </div>
          {data.social.topPosts.length > 0 && (
            <PartTable
              title="Best-performing posts this period"
              columns={[
                { key: 'org', label: 'Account', render: (r) => r.organization?.name || '—' },
                { key: 'plat', label: 'Platform', render: (r) => r.platform },
                { key: 'post', label: 'Post', render: (r) => r.title },
                { key: 'reach', label: 'Audience', align: 'right', render: (r) => `${formatNumber(r.audienceCount ?? r.reach)} ${r.audienceLabel || 'reach'}` },
                { key: 'likes', label: 'Likes', align: 'right', render: (r) => formatNumber(r.likes) },
              ]}
              rows={data.social.topPosts}
            />
          )}

          {/* Part 4 */}
          <PartTable
            title="Part 4 — Paid ads & promotion"
            right={`${money(data.ads.totals.spend)} spent · ${formatNumber(data.ads.totals.leads)} leads${data.ads.totals.costPerLead == null ? '' : ` · ${money(data.ads.totals.costPerLead)} per lead`}`}
            note="Spend, reach, impressions, clicks and leads are entered; every cost metric below is calculated from them."
            columns={[
              { key: 'org', label: 'Account', render: (r) => r.organization.name, total: () => 'ALL ACCOUNTS' },
              { key: 'spend', label: 'Spend', align: 'right', render: (r) => money(r.spend), total: (t) => money(t.spend) },
              { key: 'reach', label: 'Reach', align: 'right', render: (r) => formatNumber(r.reach), total: (t) => formatNumber(t.reach) },
              { key: 'impr', label: 'Impressions', align: 'right', render: (r) => formatNumber(r.impressions), total: (t) => formatNumber(t.impressions) },
              { key: 'freq', label: 'Frequency', align: 'right', render: (r) => dash(r.frequency), total: (t) => dash(t.frequency) },
              { key: 'clicks', label: 'Clicks', align: 'right', render: (r) => formatNumber(r.clicks), total: (t) => formatNumber(t.clicks) },
              { key: 'ctr', label: 'CTR', align: 'right', render: (r) => (r.ctr == null ? '—' : `${r.ctr}%`), total: (t) => (t.ctr == null ? '—' : `${t.ctr}%`) },
              { key: 'cpm', label: 'CPM', align: 'right', render: (r) => money(r.cpm), total: (t) => money(t.cpm) },
              { key: 'cpc', label: 'CPC', align: 'right', render: (r) => money(r.cpc), total: (t) => money(t.cpc) },
              { key: 'leads', label: 'Leads', align: 'right', render: (r) => formatNumber(r.leads), total: (t) => formatNumber(t.leads) },
              { key: 'cpl', label: 'Cost / lead', align: 'right', render: (r) => money(r.costPerLead), total: (t) => money(t.costPerLead) },
            ]}
            rows={data.ads.rows}
            totals={data.ads.totals}
          />
          <div className="grid gap-4 lg:grid-cols-2">
            <MixList title="Where the money went" items={data.ads.byChannel} format={(n) => `₹${formatNumber(n)}`} />
            {data.ads.topCampaigns.length > 0 && (
              <PartTable
                title="Top campaigns"
                columns={[
                  { key: 'org', label: 'Account', render: (r) => r.organization?.name || '—' },
                  { key: 'name', label: 'Campaign', render: (r) => r.name },
                  { key: 'obj', label: 'Objective', render: (r) => r.objective },
                  { key: 'spend', label: 'Spend', align: 'right', render: (r) => money(r.spend) },
                  { key: 'leads', label: 'Leads', align: 'right', render: (r) => formatNumber(r.leads) },
                  { key: 'cpl', label: 'Cost / lead', align: 'right', render: (r) => (r.costPerLead == null ? (r.note || '—') : money(r.costPerLead)) },
                ]}
                rows={data.ads.topCampaigns}
              />
            )}
          </div>

          {/* Part 5 */}
          <PartTable
            title="Part 5 — Team output"
            right={`${data.team.totals.completed} of ${data.team.totals.tasksAssigned} tasks completed`}
            note="The design, social and web columns break down production output, so together they match the work delivered above."
            columns={[
              { key: 'person', label: 'Person', render: (r) => r.person.name, total: () => 'TEAM TOTAL' },
              { key: 'role', label: 'Role', render: (r) => r.person.role, total: (t) => `${t.people} people` },
              { key: 'ass', label: 'Assigned', align: 'right', render: (r) => r.tasksAssigned, total: (t) => t.tasksAssigned },
              { key: 'done', label: 'Completed', align: 'right', render: (r) => r.completed, total: (t) => t.completed },
              { key: 'pend', label: 'Pending', align: 'right', render: (r) => r.pending, total: (t) => t.pending },
              { key: 'des', label: 'Design', align: 'right', render: (r) => r.designTasks, total: (t) => t.designTasks },
              { key: 'soc', label: 'Social', align: 'right', render: (r) => r.socialCreatives, total: (t) => t.socialCreatives },
              { key: 'web', label: 'Web', align: 'right', render: (r) => r.webTasks, total: (t) => t.webTasks },
              { key: 'otr', label: 'On-time rate', align: 'right', render: (r) => (r.onTimeRate == null ? '—' : `${r.onTimeRate}%`), total: (t) => (t.onTimeRate == null ? '—' : `${t.onTimeRate}%`) },
              { key: 'ta', label: 'Turnaround (d)', align: 'right', render: (r) => dash(r.avgTurnaroundDays), total: (t) => dash(t.avgTurnaroundDays) },
            ]}
            rows={data.team.rows}
            totals={data.team.totals}
          />

          <p className="pb-4 text-center text-xs text-slate-400">
            Generated {new Date(data.generatedAt).toLocaleString()} · figures are recomputed live, so corrections show up here immediately.
          </p>
        </div>
      )}
    </div>
  );
}
