import { useMemo, useRef, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import {
  ResponsiveContainer, AreaChart, Area, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, LabelList,
} from 'recharts';
import {
  Linkedin, Upload, FileSpreadsheet, Newspaper, Users, Eye, Trophy, SearchCheck, Magnet,
  ExternalLink, ArrowUpDown, Search, X, CheckCircle2,
} from 'lucide-react';
import { analyticsApi, linkedinApi } from '../api/endpoints.js';
import { DeltaBadge } from './AnalyticsReport.jsx';
import { Button } from './ui/Button.jsx';
import { Card, Skeleton, EmptyState } from './ui/primitives.jsx';
import { cn, formatNumber, formatDate } from '../lib/utils.js';

const LI_BLUE = '#0A66C2';

const TABS = [
  { key: 'content', label: 'Content', icon: Newspaper },
  { key: 'visitors', label: 'Visitors', icon: Eye },
  { key: 'followers', label: 'Followers', icon: Users },
  { key: 'competitors', label: 'Competitors', icon: Trophy },
  { key: 'search', label: 'Search appearances', icon: SearchCheck },
  { key: 'leads', label: 'Leads', icon: Magnet },
];

// Same presets as LinkedIn's own range picker.
const RANGES = [
  { value: 15, label: 'Last 15 days' },
  { value: 30, label: 'Last 30 days' },
  { value: 90, label: 'Last 90 days' },
  { value: 365, label: 'Last 365 days' },
  { value: 'custom', label: 'Custom' },
];

const fmtDate = (d) => new Date(d).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
const fmt = (v, isPct) => (isPct ? `${Number(v || 0).toFixed(2)}%` : formatNumber(v || 0));

// LinkedIn-style analytics for one organization: fed by uploading LinkedIn's
// own export files (Content / Visitors / Followers / Competitors) and laid out
// to mirror the sections of LinkedIn page analytics.
// LinkedIn's exports end on different dates per tab (visitor data lags content
// by a day or two), so each tab's window is anchored on its own headline metric
// — same as LinkedIn's UI — to make the totals match exactly.
const TAB_ANCHOR = {
  content: 'impressions',
  visitors: 'pageViews',
  followers: 'followers',
  competitors: 'followers',
  search: 'searchAppearances',
  leads: 'leads',
};

export default function LinkedInView({ orgId, canUpload = true }) {
  const qc = useQueryClient();
  const [tab, setTab] = useState('content');
  const [preset, setPreset] = useState(15); // 15 | 30 | 90 | 365 | 'custom' — LinkedIn's default
  const [custom, setCustom] = useState({ from: '', to: '' });

  const isCustom = preset === 'custom';
  // Must be a real boolean — react-query's `enabled` throws on anything else.
  const customReady = !!(isCustom && custom.from && custom.to && custom.from <= custom.to);
  const anchor = TAB_ANCHOR[tab] || 'impressions';
  const { data: report, isLoading: repLoading } = useQuery({
    queryKey: ['report', orgId, 'LinkedIn', preset, anchor, customReady ? custom.from : '', customReady ? custom.to : ''],
    queryFn: () => analyticsApi.report(
      'LinkedIn', orgId,
      isCustom ? undefined : preset,
      anchor,
      customReady ? custom.from : undefined,
      customReady ? custom.to : undefined
    ),
    enabled: !isCustom || customReady, // wait until both custom dates are picked
  });
  // Days covered by the active window (custom spans included) — used for the
  // "· Nd" suffix on cards and for clipping the charts.
  const range = report?.weekly?.rangeDays || (isCustom ? 0 : preset);
  const { data: dash, isLoading: dashLoading } = useQuery({
    queryKey: ['linkedin-dash', orgId],
    queryFn: () => linkedinApi.dashboard(orgId),
  });

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ['report', orgId, 'LinkedIn'] });
    qc.invalidateQueries({ queryKey: ['linkedin-dash', orgId] });
  };

  // Daily series clipped to the selected window, ending at the tab's anchor
  // date so charts cover exactly the same days as the totals above them.
  const series = useMemo(() => {
    const all = report?.series || [];
    if (!all.length) return [];
    const end = new Date(report?.weekly?.anchorDate || all[all.length - 1].date).getTime();
    const cutoff = end - range * 86400000;
    return all
      .filter((s) => { const t = new Date(s.date).getTime(); return t > cutoff && t <= end; })
      .map((s) => ({ ...s, x: fmtDate(s.date) }));
  }, [report, range]);

  const totals = report?.weekly?.current || {};
  const deltas = report?.weekly?.deltas || {};
  const latest = report?.latest || {};
  const isLoading = repLoading || dashLoading;

  return (
    <div className="space-y-5">
      {/* LinkedIn-style header bar */}
      <Card className="flex flex-wrap items-center justify-between gap-3 p-3">
        <div className="flex items-center gap-2 pl-1">
          <span className="flex h-8 w-8 items-center justify-center rounded-lg text-white" style={{ background: LI_BLUE }}><Linkedin className="h-4.5 w-4.5" /></span>
          <span className="text-sm font-bold text-slate-700 dark:text-slate-200">LinkedIn analytics</span>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {isCustom && (
            <div className="flex items-center gap-1.5">
              <input type="date" value={custom.from} max={custom.to || undefined}
                onChange={(e) => setCustom((c) => ({ ...c, from: e.target.value }))}
                className="input-base h-9 w-auto py-1 text-sm" title="Start date" />
              <span className="text-xs font-semibold text-slate-400">→</span>
              <input type="date" value={custom.to} min={custom.from || undefined}
                onChange={(e) => setCustom((c) => ({ ...c, to: e.target.value }))}
                className="input-base h-9 w-auto py-1 text-sm" title="End date" />
            </div>
          )}
          <select value={preset}
            onChange={(e) => setPreset(e.target.value === 'custom' ? 'custom' : Number(e.target.value))}
            className="input-base h-9 w-auto py-1 text-sm font-semibold">
            {RANGES.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
          </select>
        </div>
      </Card>

      {isCustom && !customReady && (
        <p className="rounded-xl bg-slate-50 px-4 py-2.5 text-sm text-slate-400 dark:bg-slate-800/40">
          Pick a start and end date above to load the custom range.
        </p>
      )}

      {canUpload && <UploadZone orgId={orgId} onDone={refresh} dash={dash} report={report} />}

      {/* Section tabs — mirrors LinkedIn's analytics nav */}
      <div className="flex flex-wrap gap-1.5">
        {TABS.map(({ key, label, icon: Icon }) => (
          <button key={key} onClick={() => setTab(key)}
            className={cn('flex items-center gap-1.5 rounded-full border px-3.5 py-1.5 text-sm font-semibold transition',
              tab === key
                ? 'border-transparent text-white shadow-soft'
                : 'border-slate-200 text-slate-600 hover:border-[#0A66C2]/40 hover:text-[#0A66C2] dark:border-slate-700 dark:text-slate-300')}
            style={tab === key ? { background: LI_BLUE } : undefined}>
            <Icon className="h-4 w-4" /> {label}
          </button>
        ))}
      </div>

      {isCustom && !customReady ? null : isLoading ? (
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">{Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-28" />)}</div>
          <Skeleton className="h-80" />
        </div>
      ) : (
        <>
          {tab === 'content' && <ContentTab totals={totals} deltas={deltas} series={series} posts={dash?.posts || []} range={range} hasData={report?.hasData} />}
          {tab === 'visitors' && <VisitorsTab totals={totals} deltas={deltas} series={series} demographics={dash?.demographics?.visitors || {}} range={range} />}
          {tab === 'followers' && <FollowersTab totals={totals} deltas={deltas} latest={latest} series={series} demographics={dash?.demographics?.followers || {}} range={range} orgId={orgId} canUpload={canUpload} onSynced={refresh} />}
          {tab === 'competitors' && <CompetitorsTab competitors={dash?.competitors || []} latest={{ ...latest, ...totals }} />}
          {tab === 'search' && <SimpleMetricTab title="Search appearances" description="How often the page appeared in LinkedIn search results." field="searchAppearances" totals={totals} deltas={deltas} series={series} range={range} />}
          {tab === 'leads' && <LeadsTab totals={totals} deltas={deltas} series={series} range={range} />}
        </>
      )}
    </div>
  );
}

// ---- Upload — one labelled slot per LinkedIn download, all in one place.
// Sheets are still auto-detected server-side, so a file dropped on the "wrong"
// slot imports correctly anyway; the slot is a guide + status indicator.
const UPLOAD_SLOTS = [
  {
    key: 'content', label: 'Content', icon: Newspaper,
    hint: 'Analytics → Content → Export',
    detects: (s) => s.kind === 'posts' || (s.kind === 'daily metrics' && (s.fields || []).includes('impressions')),
  },
  {
    key: 'followers', label: 'Followers', icon: Users,
    hint: 'Analytics → Followers → Export',
    detects: (s) => s.kind.startsWith('followers demographics') || (s.kind === 'daily metrics' && (s.fields || []).some((f) => ['followers', 'organicFollowers', 'sponsoredFollowers', 'newFollowers'].includes(f))),
  },
  {
    key: 'visitors', label: 'Visitors', icon: Eye,
    hint: 'Analytics → Visitors → Export',
    detects: (s) => s.kind.startsWith('visitors demographics') || (s.kind === 'daily metrics' && (s.fields || []).some((f) => ['pageViews', 'uniqueVisitors', 'desktopPageViews', 'mobilePageViews'].includes(f))),
  },
  {
    key: 'competitors', label: 'Competitors', icon: Trophy,
    hint: 'Analytics → Competitors → Export',
    detects: (s) => s.kind === 'competitors',
  },
];

function UploadZone({ orgId, onDone, dash, report }) {
  const [result, setResult] = useState(null);

  // What each slot already has, so the tiles show a live status tick.
  const status = {
    content: (dash?.posts?.length || 0) > 0 ? `${dash.posts.length} posts` : (report?.weekly?.current?.impressions > 0 ? 'metrics imported' : null),
    followers: Object.keys(dash?.demographics?.followers || {}).length > 0 ? 'demographics imported' : (report?.latest?.followers > 0 ? 'metrics imported' : null),
    visitors: Object.keys(dash?.demographics?.visitors || {}).length > 0 ? 'demographics imported' : (report?.weekly?.current?.pageViews > 0 ? 'metrics imported' : null),
    competitors: (dash?.competitors?.length || 0) > 0 ? `${dash.competitors.length} pages` : null,
  };

  const cov = dash?.coverage;
  return (
    <Card className="p-4">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm font-bold text-slate-800 dark:text-white">
          Upload your 4 LinkedIn exports
          {dash?.organization?.name && (
            <span className="ml-2 rounded-full px-2.5 py-0.5 text-[11px] font-bold text-white" style={{ background: dash.organization.color || LI_BLUE }}>
              → {dash.organization.name}
            </span>
          )}
        </p>
        <p className="text-xs text-slate-400">
          {cov
            ? <>Data stored: <span className="font-semibold text-slate-500 dark:text-slate-300">{formatDate(cov.from)} → {formatDate(cov.to)}</span> ({cov.days} days) · last import {formatDate(cov.lastImport)} — weekly uploads merge on top automatically.</>
            : 'Start with the last 365 days, then add each Monday’s weekly export — everything merges by date automatically.'}
        </p>
      </div>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {UPLOAD_SLOTS.map((slot) => (
          <UploadSlot key={slot.key} slot={slot} orgId={orgId} status={status[slot.key]}
            onDone={(res) => { setResult(res); onDone(); }} />
        ))}
      </div>

      {result && (
        <div className="fixed bottom-5 right-5 z-50 w-80 rounded-2xl border border-slate-200 bg-white p-4 shadow-2xl dark:border-slate-700 dark:bg-slate-900">
          <div className="mb-2 flex items-center justify-between">
            <span className="flex items-center gap-1.5 text-sm font-bold text-slate-800 dark:text-white"><CheckCircle2 className="h-4 w-4 text-emerald-500" /> Import complete</span>
            <button onClick={() => setResult(null)} className="rounded p-1 text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800"><X className="h-4 w-4" /></button>
          </div>
          <div className="max-h-48 space-y-1 overflow-y-auto text-xs text-slate-500 dark:text-slate-400">
            {result.flatMap((r) => r.sheets).map((s, i) => (
              <p key={i} className={cn('flex justify-between gap-2', s.kind === 'skipped' && 'opacity-50')}>
                <span className="truncate">{s.sheet}</span>
                <span className="shrink-0 font-semibold">{s.kind === 'skipped' ? 'skipped' : `${s.rows} · ${s.kind}`}</span>
              </p>
            ))}
          </div>
        </div>
      )}
    </Card>
  );
}

function UploadSlot({ slot, orgId, status, onDone }) {
  const fileRef = useRef(null);
  const [dragging, setDragging] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [pendingFiles, setPendingFiles] = useState([]);
  const Icon = slot.icon;

  const importMut = useMutation({
    mutationFn: async (files) => {
      const all = [];
      for (const f of files) all.push(await linkedinApi.import(orgId, f));
      return all;
    },
    onSuccess: (all) => {
      const sheets = all.flatMap((r) => r.sheets.filter((s) => s.kind !== 'skipped'));
      const rows = sheets.reduce((a, s) => a + s.rows, 0);
      toast.success(`${slot.label}: imported ${rows} rows across ${sheets.length} sheet${sheets.length === 1 ? '' : 's'}`);
      // Gentle heads-up when the file doesn't look like this slot's export —
      // the data still lands in the right place either way.
      if (sheets.length && !sheets.some(slot.detects)) {
        toast(`That file looked like a different export — no problem, every sheet was routed automatically.`, { icon: 'ℹ️' });
      }
      onDone(all);
    },
    onError: (e) => toast.error(e.response?.data?.message || `${slot.label} import failed`),
  });

  const queueFiles = (list) => {
    const files = [...(list || [])].filter((f) => /\.(xlsx?|csv)$/i.test(f.name));
    if (!files.length) { toast.error('Upload the .xls/.xlsx file exactly as LinkedIn downloaded it'); return; }
    setPendingFiles(files);
    setConfirmOpen(true);
  };

  const submitPending = () => {
    if (!pendingFiles.length || importMut.isPending) return;
    importMut.mutate(pendingFiles);
    setPendingFiles([]);
    setConfirmOpen(false);
  };

  return (
    <>
      <div
        onClick={() => fileRef.current?.click()}
        onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => { e.preventDefault(); setDragging(false); queueFiles(e.dataTransfer.files); }}
        className={cn(
          'group cursor-pointer rounded-xl border-2 border-dashed p-4 text-center transition-colors',
          dragging ? 'border-[#0A66C2] bg-[#0A66C2]/5' : 'border-slate-200 hover:border-[#0A66C2]/50 dark:border-slate-700'
        )}>
        <input ref={fileRef} type="file" accept=".xlsx,.xls,.csv" multiple className="hidden"
          onChange={(e) => { queueFiles(e.target.files); e.target.value = ''; }} />
        <span className="mx-auto mb-2 flex h-10 w-10 items-center justify-center rounded-xl text-white" style={{ background: LI_BLUE }}>
          {importMut.isPending
            ? <span className="h-4 w-4 animate-spin rounded-full border-2 border-white/40 border-t-white" />
            : <Icon className="h-5 w-5" />}
        </span>
        <p className="text-sm font-bold text-slate-800 dark:text-white">{slot.label}</p>
        <p className="mt-0.5 text-[11px] text-slate-400">{slot.hint}</p>
        {status ? (
          <p className="mt-2 inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] font-semibold text-emerald-600 dark:bg-emerald-500/10 dark:text-emerald-400">
            <CheckCircle2 className="h-3 w-3" /> {status}
          </p>
        ) : (
          <p className="mt-2 inline-flex items-center gap-1 rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-semibold text-slate-400 group-hover:bg-[#0A66C2]/10 group-hover:text-[#0A66C2] dark:bg-slate-800">
            <Upload className="h-3 w-3" /> drop file or click
          </p>
        )}
      </div>

      {confirmOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-slate-900/50" onClick={() => { setConfirmOpen(false); setPendingFiles([]); }} aria-hidden="true" />
          <div className="relative z-10 w-full max-w-md rounded-2xl border border-slate-200 bg-white p-5 shadow-2xl dark:border-slate-700 dark:bg-slate-900">
            <p className="text-base font-bold text-slate-800 dark:text-white">Submit LinkedIn data?</p>
            <p className="mt-1.5 text-sm text-slate-500 dark:text-slate-400">
              You selected {pendingFiles.length} file{pendingFiles.length === 1 ? '' : 's'} for {slot.label}. Do you want to submit now?
            </p>
            <div className="mt-2 max-h-28 space-y-1 overflow-y-auto rounded-lg bg-slate-50 p-2 text-xs text-slate-500 dark:bg-slate-800/50 dark:text-slate-300">
              {pendingFiles.map((f) => <p key={`${f.name}-${f.size}`} className="truncate">{f.name}</p>)}
            </div>
            <div className="mt-4 flex justify-end gap-2">
              <Button variant="outline" onClick={() => { setConfirmOpen(false); setPendingFiles([]); }}>Cancel</Button>
              <Button onClick={submitPending} loading={importMut.isPending}>Submit data</Button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

// ---- Shared pieces ----
// Plain-language definitions surfaced as a native title tooltip on each
// metric card label.
const TIPS = {
  impressions: 'How many times your posts were shown on screen.',
  uniqueImpressions: 'How many individual people saw your posts at least once.',
  clicks: 'Clicks on your posts, page name or logo.',
  clickThroughRate: 'Clicks divided by impressions — how often a view became a click.',
  engagementRate: 'Clicks, reactions, comments and reposts divided by impressions.',
  reactions: 'Likes and other reactions on your posts.',
  comments: 'Comments left on your posts.',
  reposts: 'Times your posts were re-shared by others.',
  pageViews: 'Total visits to your LinkedIn page.',
  uniqueVisitors: 'Individual people who visited your page.',
  desktopPageViews: 'Page views from desktop devices.',
  mobilePageViews: 'Page views from mobile devices.',
  customButtonClicks: 'Clicks on your page’s custom button (e.g. Visit website).',
  followers: 'Total audience following your page right now.',
  newFollowers: 'Followers gained during the period (organic + sponsored).',
  organicFollowers: 'Followers gained without paid promotion.',
  sponsoredFollowers: 'Followers gained from paid campaigns.',
  leads: 'Contacts collected through LinkedIn lead-gen forms.',
  leadFormViews: 'Times a LinkedIn lead-gen form was viewed.',
  leadConversionRate: 'Leads divided by lead form views.',
};

function MetricCard({ label, value, delta, isPct, suffix, field }) {
  return (
    <Card className="p-4">
      <p className="text-[13px] font-medium text-slate-400" title={TIPS[field]}>{label}{suffix ? <span className="text-slate-300"> · {suffix}</span> : null}</p>
      <p className="mt-1.5 text-[26px] font-extrabold tracking-tight text-slate-800 dark:text-white">{fmt(value, isPct)}</p>
      {delta && <div className="mt-1.5"><DeltaBadge delta={delta} isPct={isPct} /></div>}
    </Card>
  );
}

function TrendChart({ series, field, label, color = LI_BLUE, height = 260 }) {
  return (
    <ResponsiveContainer width="100%" height={height}>
      <AreaChart data={series} margin={{ left: -8, right: 8, top: 8 }}>
        <defs>
          <linearGradient id={`li-${field}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%" stopColor={color} stopOpacity={0.25} />
            <stop offset="95%" stopColor={color} stopOpacity={0} />
          </linearGradient>
        </defs>
        <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" vertical={false} />
        <XAxis dataKey="x" tick={{ fontSize: 11, fill: '#94a3b8' }} axisLine={false} tickLine={false} minTickGap={24} />
        <YAxis tick={{ fontSize: 12, fill: '#94a3b8' }} axisLine={false} tickLine={false} tickFormatter={(v) => formatNumber(v)} width={52} />
        <Tooltip contentStyle={{ borderRadius: 12, fontSize: 13 }} formatter={(v) => formatNumber(v)} />
        <Area type="monotone" dataKey={field} stroke={color} strokeWidth={2.5} fill={`url(#li-${field})`} name={label} />
      </AreaChart>
    </ResponsiveContainer>
  );
}

// Horizontal demographic bars — like LinkedIn's follower/visitor demographics.
function Demographics({ demographics, emptyHint }) {
  const categories = Object.keys(demographics);
  const [cat, setCat] = useState(categories[0]);
  if (!categories.length) {
    return <p className="rounded-xl bg-slate-50 p-4 text-sm text-slate-400 dark:bg-slate-800/40">{emptyHint}</p>;
  }
  const active = categories.includes(cat) ? cat : categories[0];
  const rows = [...(demographics[active] || [])].sort((a, b) => b.value - a.value).slice(0, 10);
  const max = rows[0]?.value || 1;
  return (
    <div>
      <div className="mb-4 flex flex-wrap gap-1.5">
        {categories.map((c) => (
          <button key={c} onClick={() => setCat(c)}
            className={cn('rounded-full border px-3 py-1 text-xs font-semibold transition',
              active === c ? 'border-transparent text-white' : 'border-slate-200 text-slate-500 dark:border-slate-700 dark:text-slate-300')}
            style={active === c ? { background: LI_BLUE } : undefined}>
            {c}
          </button>
        ))}
      </div>
      <div className="space-y-2.5">
        {rows.map((r) => (
          <div key={r.label}>
            <div className="mb-1 flex items-center justify-between text-sm">
              <span className="truncate pr-3 font-medium text-slate-600 dark:text-slate-300">{r.label}</span>
              <span className="shrink-0 font-semibold text-slate-700 dark:text-slate-200">{r.isPercent ? `${r.value}%` : formatNumber(r.value)}</span>
            </div>
            <div className="h-2.5 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800">
              <div className="h-full rounded-full" style={{ width: `${Math.max(2, (r.value / max) * 100)}%`, background: LI_BLUE }} />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ---- Content ----
const CONTENT_METRICS = [
  { field: 'impressions', label: 'Impressions' },
  { field: 'uniqueImpressions', label: 'Unique impressions' },
  { field: 'clicks', label: 'Clicks' },
  { field: 'reactions', label: 'Reactions' },
  { field: 'comments', label: 'Comments' },
  { field: 'reposts', label: 'Reposts' },
  { field: 'engagementRate', label: 'Engagement rate', pct: true },
];

function ContentTab({ totals, deltas, series, posts, range, hasData }) {
  const [chartField, setChartField] = useState('impressions');
  const active = CONTENT_METRICS.find((m) => m.field === chartField) || CONTENT_METRICS[0];

  if (!hasData && !posts.length) {
    return <EmptyState icon={FileSpreadsheet} title="No LinkedIn data yet" description='Open your LinkedIn page → Analytics → Content → Export, then click "Upload LinkedIn export" above and drop the downloaded file here.' />;
  }

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <MetricCard label="Impressions" field="impressions" suffix={`${range}d`} value={totals.impressions} delta={deltas.impressions} />
        <MetricCard label="Clicks" field="clicks" suffix={`${range}d`} value={totals.clicks} delta={deltas.clicks} />
        <MetricCard label="Reactions" field="reactions" suffix={`${range}d`} value={totals.reactions} delta={deltas.reactions} />
        <MetricCard label="Engagement rate" field="engagementRate" value={totals.engagementRate} delta={deltas.engagementRate} isPct />
      </div>

      <Card className="p-5">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
          <h3 className="font-bold text-slate-800 dark:text-white">Metrics</h3>
          <select className="input-base h-9 w-auto py-1 text-xs" value={active.field} onChange={(e) => setChartField(e.target.value)}>
            {CONTENT_METRICS.map((m) => <option key={m.field} value={m.field}>{m.label}</option>)}
          </select>
        </div>
        <TrendChart series={series} field={active.field} label={active.label} />
      </Card>

      <PostsTable posts={posts} />
    </div>
  );
}

function PostsTable({ posts }) {
  const [search, setSearch] = useState('');
  const [sort, setSort] = useState({ key: 'createdDate', dir: 'desc' });
  const rows = useMemo(() => {
    let list = posts.filter((p) => (p.title || '').toLowerCase().includes(search.toLowerCase()));
    list = [...list].sort((a, b) => {
      const av = sort.key === 'createdDate' ? new Date(a.createdDate || 0).getTime() : (a[sort.key] || 0);
      const bv = sort.key === 'createdDate' ? new Date(b.createdDate || 0).getTime() : (b[sort.key] || 0);
      return sort.dir === 'desc' ? bv - av : av - bv;
    });
    return list.slice(0, 50);
  }, [posts, search, sort]);

  const COLS = [
    { key: 'impressions', label: 'Impressions' },
    { key: 'clicks', label: 'Clicks' },
    { key: 'clickThroughRate', label: 'CTR', pct: true },
    { key: 'reactions', label: 'Reactions' },
    { key: 'comments', label: 'Comments' },
    { key: 'reposts', label: 'Reposts' },
    { key: 'engagementRate', label: 'Eng. rate', pct: true },
  ];
  const toggle = (key) => setSort((s) => (s.key === key ? { key, dir: s.dir === 'desc' ? 'asc' : 'desc' } : { key, dir: 'desc' }));

  return (
    <Card className="overflow-hidden p-0">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 p-4 dark:border-slate-800">
        <h3 className="font-bold text-slate-800 dark:text-white">Post performance <span className="text-sm font-normal text-slate-400">({posts.length} posts)</span></h3>
        <div className="relative w-full max-w-[220px]">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search posts…" className="input-base h-9 pl-9 text-sm" />
        </div>
      </div>
      {rows.length === 0 ? (
        <p className="p-6 text-sm text-slate-400">No posts yet — upload the LinkedIn <span className="font-semibold">Content</span> export (it includes the "All posts" sheet).</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[900px] text-sm">
            <thead>
              <tr className="border-b border-slate-100 text-left text-[11px] uppercase tracking-wide text-slate-400 dark:border-slate-800">
                <th className="cursor-pointer px-4 py-3 font-bold" onClick={() => toggle('createdDate')}>Post <ArrowUpDown className="ml-0.5 inline h-3 w-3" /></th>
                {COLS.map((c) => (
                  <th key={c.key} className="cursor-pointer whitespace-nowrap px-3 py-3 text-right font-bold" onClick={() => toggle(c.key)}>
                    {c.label} <ArrowUpDown className={cn('ml-0.5 inline h-3 w-3', sort.key === c.key ? 'text-[#0A66C2]' : 'text-slate-300')} />
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-50 dark:divide-slate-800/60">
              {rows.map((p) => (
                <tr key={p._id} className="hover:bg-slate-50/60 dark:hover:bg-slate-800/30">
                  <td className="max-w-[320px] px-4 py-3">
                    <div className="flex items-start gap-2">
                      <div className="min-w-0">
                        <p className="truncate font-semibold text-slate-800 dark:text-white" title={p.title}>{p.title || '(untitled post)'}</p>
                        <p className="text-xs text-slate-400">
                          {p.createdDate ? formatDate(p.createdDate) : ''}{p.contentType ? ` · ${p.contentType}` : ''}{p.postType ? ` · ${p.postType}` : ''}
                        </p>
                      </div>
                      {p.url && <a href={p.url} target="_blank" rel="noreferrer" className="mt-0.5 shrink-0 text-slate-300 hover:text-[#0A66C2]" title="Open on LinkedIn"><ExternalLink className="h-3.5 w-3.5" /></a>}
                    </div>
                  </td>
                  {COLS.map((c) => (
                    <td key={c.key} className="whitespace-nowrap px-3 py-3 text-right font-semibold text-slate-700 dark:text-slate-200">
                      {fmt(p[c.key], c.pct)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}

// ---- Visitors ----
function VisitorsTab({ totals, deltas, series, demographics, range }) {
  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <MetricCard label="Page views" field="pageViews" suffix={`${range}d`} value={totals.pageViews} delta={deltas.pageViews} />
        <MetricCard label="Unique visitors" field="uniqueVisitors" suffix={`${range}d`} value={totals.uniqueVisitors} delta={deltas.uniqueVisitors} />
        <MetricCard label="Desktop views" field="desktopPageViews" suffix={`${range}d`} value={totals.desktopPageViews} delta={deltas.desktopPageViews} />
        <MetricCard label="Custom button clicks" field="customButtonClicks" suffix={`${range}d`} value={totals.customButtonClicks} delta={deltas.customButtonClicks} />
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <Card className="p-5">
          <h3 className="mb-4 font-bold text-slate-800 dark:text-white">Page views</h3>
          <TrendChart series={series} field="pageViews" label="Page views" />
        </Card>
        <Card className="p-5">
          <h3 className="mb-4 font-bold text-slate-800 dark:text-white">Visitor demographics</h3>
          <Demographics demographics={demographics} emptyHint="Upload the LinkedIn Visitors export to see who is viewing the page (location, job function, industry…)." />
        </Card>
      </div>
    </div>
  );
}

// ---- Followers ----
function FollowersTab({ totals, deltas, latest, series, demographics, range, orgId, canUpload, onSynced }) {
  const currentTotal = totals.followers || latest.followers || 0;
  return (
    <div className="space-y-5">
      {canUpload && <BaselineSync orgId={orgId} currentTotal={currentTotal} onSynced={onSynced} />}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        {/* totals.followers is the end-of-window snapshot from the followers-
            anchored bucket — the overall latest day may not carry follower data. */}
        <MetricCard label="Total followers" field="followers" value={currentTotal} delta={deltas.followers} />
        <MetricCard label="New followers" field="newFollowers" suffix={`${range}d`} value={totals.newFollowers} delta={deltas.newFollowers} />
        <MetricCard label="Organic followers" field="organicFollowers" suffix={`${range}d`} value={totals.organicFollowers} delta={deltas.organicFollowers} />
        <MetricCard label="Sponsored followers" field="sponsoredFollowers" suffix={`${range}d`} value={totals.sponsoredFollowers} delta={deltas.sponsoredFollowers} />
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <Card className="p-5">
          <h3 className="mb-4 font-bold text-slate-800 dark:text-white">Follower gains</h3>
          <ResponsiveContainer width="100%" height={260}>
            <BarChart data={series} margin={{ left: -8, right: 8, top: 20 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" vertical={false} />
              <XAxis dataKey="x" tick={{ fontSize: 11, fill: '#94a3b8' }} axisLine={false} tickLine={false} minTickGap={24} />
              <YAxis tick={{ fontSize: 12, fill: '#94a3b8' }} axisLine={false} tickLine={false} width={40} />
              <Tooltip contentStyle={{ borderRadius: 12, fontSize: 13 }} />
              <Bar dataKey="newFollowers" radius={[5, 5, 0, 0]} fill={LI_BLUE} name="New followers">
                {/* Per-bar labels only when they stay readable — long ranges rely on the tooltip. */}
                {series.length <= 45 && (
                  <LabelList dataKey="newFollowers" position="top" formatter={(v) => (v ? formatNumber(v) : '')} style={{ fontSize: 10, fontWeight: 600, fill: '#64748b' }} />
                )}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </Card>
        <Card className="p-5">
          <h3 className="mb-4 font-bold text-slate-800 dark:text-white">Follower demographics</h3>
          <Demographics demographics={demographics} emptyHint="Upload the LinkedIn Followers export to see follower demographics (location, job function, seniority, industry, company size)." />
        </Card>
      </div>
      <Card className="p-5">
        <h3 className="mb-4 font-bold text-slate-800 dark:text-white">Total followers</h3>
        <TrendChart series={series} field="followers" label="Total followers" height={220} />
      </Card>
    </div>
  );
}

// LinkedIn's Followers export only contains daily GAINS — the page-header total
// never appears in any file. The admin types it once; the backend rebuilds the
// whole followers history backwards from the gains, and every weekly upload
// rolls it forward automatically after that.
function BaselineSync({ orgId, currentTotal, onSynced }) {
  const [value, setValue] = useState('');
  const [open, setOpen] = useState(!currentTotal);
  const syncMut = useMutation({
    mutationFn: () => linkedinApi.followersBaseline(orgId, Number(value)),
    onSuccess: (res) => {
      toast.success(`Total followers synced to ${formatNumber(res.latestTotal)} — history rebuilt (${res.updated} days)`);
      setValue(''); setOpen(false); onSynced();
    },
    onError: (e) => toast.error(e.response?.data?.message || 'Sync failed'),
  });

  if (!open) {
    return (
      <p className="text-xs text-slate-400">
        Total doesn’t match your LinkedIn page header?{' '}
        <button onClick={() => setOpen(true)} className="font-semibold text-[#0A66C2] hover:underline">Sync total followers</button>
      </p>
    );
  }
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border-2 border-dashed border-[#0A66C2]/40 bg-[#0A66C2]/5 px-5 py-4">
      <div className="min-w-0">
        <p className="text-sm font-bold text-slate-800 dark:text-white">Sync your total followers once</p>
        <p className="text-xs text-slate-500 dark:text-slate-400">
          LinkedIn’s export only contains daily gains — enter the <span className="font-semibold">Total followers</span> shown on your
          LinkedIn page header (e.g. 11,172). The history is rebuilt from the gains and weekly uploads keep it updated automatically.
        </p>
      </div>
      <form className="flex items-center gap-2" onSubmit={(e) => { e.preventDefault(); syncMut.mutate(); }}>
        <input type="number" min="1" value={value} onChange={(e) => setValue(e.target.value)}
          placeholder="e.g. 11172" className="input-base h-10 w-36" />
        <Button size="sm" type="submit" disabled={!Number(value)} loading={syncMut.isPending} style={{ background: LI_BLUE }}>
          <CheckCircle2 className="h-4 w-4" /> Sync
        </Button>
        {currentTotal > 0 && <Button size="sm" type="button" variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>}
      </form>
    </div>
  );
}

// ---- Competitors ----
function CompetitorsTab({ competitors, latest }) {
  if (!competitors.length) {
    return <EmptyState icon={Trophy} title="No competitor data yet" description='Open LinkedIn → Analytics → Competitors → Export, then upload the file with "Upload LinkedIn export".' />;
  }
  const rows = [
    { _id: 'self', name: 'This page (you)', followers: latest.followers || 0, newFollowers: latest.newFollowers || 0, postsLast30Days: latest.postsPublished || 0, engagementRate: latest.engagementRate || 0, self: true },
    ...competitors,
  ].sort((a, b) => (b.followers || 0) - (a.followers || 0));

  return (
    <Card className="overflow-hidden p-0">
      <div className="border-b border-slate-100 p-4 dark:border-slate-800">
        <h3 className="font-bold text-slate-800 dark:text-white">Competitor benchmark</h3>
        <p className="text-xs text-slate-400">From your LinkedIn competitor analytics export — ranked by followers.</p>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[640px] text-sm">
          <thead>
            <tr className="border-b border-slate-100 text-left text-[11px] uppercase tracking-wide text-slate-400 dark:border-slate-800">
              <th className="px-4 py-3 font-bold">#</th>
              <th className="px-4 py-3 font-bold">Page</th>
              <th className="px-3 py-3 text-right font-bold">Total followers</th>
              <th className="px-3 py-3 text-right font-bold">New followers</th>
              <th className="px-3 py-3 text-right font-bold">Posts</th>
              <th className="px-3 py-3 text-right font-bold">Eng. rate</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-50 dark:divide-slate-800/60">
            {rows.map((c, i) => (
              <tr key={c._id} className={cn(c.self && 'bg-[#0A66C2]/5 dark:bg-[#0A66C2]/10')}>
                <td className="px-4 py-3 font-bold text-slate-400">{i + 1}</td>
                <td className="px-4 py-3 font-semibold text-slate-800 dark:text-white">
                  {c.name} {c.self && <span className="ml-1 rounded-full bg-[#0A66C2] px-2 py-0.5 text-[10px] font-bold text-white">YOU</span>}
                </td>
                <td className="px-3 py-3 text-right font-extrabold text-slate-800 dark:text-white">{formatNumber(c.followers || 0)}</td>
                <td className="px-3 py-3 text-right font-semibold text-slate-600 dark:text-slate-300">{formatNumber(c.newFollowers || 0)}</td>
                <td className="px-3 py-3 text-right font-semibold text-slate-600 dark:text-slate-300">{formatNumber(c.postsLast30Days || 0)}</td>
                <td className="px-3 py-3 text-right font-semibold text-slate-600 dark:text-slate-300">{c.engagementRate ? `${Number(c.engagementRate).toFixed(2)}%` : '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

// ---- Search appearances / simple single-metric tabs ----
function SimpleMetricTab({ title, description, field, totals, deltas, series, range }) {
  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <MetricCard label={title} field={field} suffix={`${range}d`} value={totals[field]} delta={deltas[field]} />
      </div>
      <Card className="p-5">
        <h3 className="mb-1 font-bold text-slate-800 dark:text-white">{title}</h3>
        <p className="mb-4 text-xs text-slate-400">{description} Enter it under “Enter metrics” or include it in an import — LinkedIn shows this number on the analytics home.</p>
        <TrendChart series={series} field={field} label={title} />
      </Card>
    </div>
  );
}

// ---- Leads ----
function LeadsTab({ totals, deltas, series, range }) {
  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <MetricCard label="Leads" field="leads" suffix={`${range}d`} value={totals.leads} delta={deltas.leads} />
        <MetricCard label="Lead form views" field="leadFormViews" suffix={`${range}d`} value={totals.leadFormViews} delta={deltas.leadFormViews} />
        <MetricCard label="Lead conversion rate" field="leadConversionRate" value={totals.leadConversionRate} delta={deltas.leadConversionRate} isPct />
      </div>
      <Card className="p-5">
        <h3 className="mb-1 font-bold text-slate-800 dark:text-white">Leads</h3>
        <p className="mb-4 text-xs text-slate-400">Leads from LinkedIn lead-gen forms. Enter them under “Enter metrics” or include a Leads column in an import.</p>
        <TrendChart series={series} field="leads" label="Leads" />
      </Card>
    </div>
  );
}
