import { useState, useEffect, useRef } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { Linkedin, Instagram, Youtube, Facebook, Save, BarChart3, PenLine, Trophy, Users, Upload, Download, FileSpreadsheet, Trash2, LayoutGrid, Zap, BadgeIndianRupee } from 'lucide-react';
import { analyticsApi } from '../api/endpoints.js';
import { downloadBlob } from '../lib/utils.js';
import { useOrgStore } from '../store/orgStore.js';
import { useAuthStore } from '../store/authStore.js';
import PageHeader from '../components/layout/PageHeader.jsx';
import OrgPicker from '../components/OrgPicker.jsx';
import AnalyticsReport from '../components/AnalyticsReport.jsx';
import LinkedInView from '../components/LinkedInView.jsx';
import SocialPostsTable from '../components/SocialPostsTable.jsx';
import SocialPostSummary from '../components/SocialPostSummary.jsx';
import CompetitorManager from '../components/CompetitorManager.jsx';
import OrgCompare from '../components/OrgCompare.jsx';
import AnalyticsOverview from '../components/AnalyticsOverview.jsx';
import MetaSync from '../components/MetaSync.jsx';
import YoutubeSync from '../components/YoutubeSync.jsx';
import PaidPromotionPanel from '../components/PaidPromotionPanel.jsx';
import { Button } from '../components/ui/Button.jsx';
import { Card, Input } from '../components/ui/primitives.jsx';
import { cn } from '../lib/utils.js';

const PLATFORMS = [
  { key: 'LinkedIn', icon: Linkedin, color: '#0A66C2' },
  { key: 'Instagram', icon: Instagram, color: '#E1306C' },
  { key: 'YouTube', icon: Youtube, color: '#FF0000' },
  { key: 'Facebook', icon: Facebook, color: '#1877F2' },
];

export default function Analytics() {
  const [tab, setTab] = useState('overview');
  const [pendingPlatform, setPendingPlatform] = useState(null);
  const { setSelectedOrg } = useOrgStore();
  const { user } = useAuthStore();

  // From the overview grid: jump straight to one org + platform's analytics.
  const openOrgPlatform = (orgId, platform) => {
    setSelectedOrg(orgId);
    setPendingPlatform(platform);
    setTab('org');
  };

  return (
    <div>
      <PageHeader title="Social Media Analytics" subtitle="See every organization's platforms at a glance, track week-over-week changes, and compare organizations." />
      <div className="mb-5 inline-flex flex-wrap rounded-xl bg-slate-100 dark:bg-slate-800 p-1">
        <TabBtn active={tab === 'overview'} onClick={() => setTab('overview')} icon={LayoutGrid}>Overview grid</TabBtn>
        <TabBtn active={tab === 'org'} onClick={() => setTab('org')} icon={BarChart3}>Per organization</TabBtn>
        <TabBtn active={tab === 'compare'} onClick={() => setTab('compare')} icon={Trophy}>Compare organizations</TabBtn>
        {user?.isSuperAdmin && <TabBtn active={tab === 'paid'} onClick={() => setTab('paid')} icon={BadgeIndianRupee}>Paid promotion</TabBtn>}
      </div>
      {tab === 'overview' && <AnalyticsOverview onOpen={openOrgPlatform} />}
      {tab === 'org' && <OrgPicker>{(orgId) => <OrgAnalytics orgId={orgId} initialPlatform={pendingPlatform} />}</OrgPicker>}
      {tab === 'compare' && <OrgCompare />}
      {tab === 'paid' && user?.isSuperAdmin && <OrgPicker>{(orgId) => <PaidPromotionPanel orgId={orgId} />}</OrgPicker>}
    </div>
  );
}

const TabBtn = ({ active, onClick, icon: Icon, children }) => (
  <button onClick={onClick} className={cn('flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-semibold transition', active ? 'bg-white dark:bg-slate-900 text-brand-700 dark:text-brand-300 shadow-soft' : 'text-slate-500 hover:text-slate-700 dark:hover:text-slate-300')}>
    <Icon className="h-4 w-4" /> {children}
  </button>
);

const RANGES = [
  { value: 7, label: 'Past 7 days' },
  { value: 14, label: 'Past 14 days' },
  { value: 28, label: 'Past 28 days' },
  { value: 30, label: 'Past 30 days' },
  { value: 90, label: 'Past 90 days' },
  { value: 180, label: 'Past 180 days' },
  { value: 365, label: 'Past 365 days' },
];

function OrgAnalytics({ orgId, initialPlatform }) {
  const qc = useQueryClient();
  const [platform, setPlatform] = useState(initialPlatform || 'LinkedIn');
  // LinkedIn opens in the LinkedIn-mirror view (fed by LinkedIn's own exports);
  // every other platform opens in the standard report.
  const [mode, setMode] = useState((initialPlatform || 'LinkedIn') === 'LinkedIn' ? 'linkedin' : 'report');
  const [range, setRange] = useState(7);
  const fileRef = useRef(null);
  const { data: report, isLoading } = useQuery({ queryKey: ['report', orgId, platform, range], queryFn: () => analyticsApi.report(platform, orgId, range) });

  // Competitor tracking is only offered for LinkedIn — fall back to the report
  // if the admin switches to a platform that doesn't have it.
  const showCompetitors = platform === 'LinkedIn';
  const selectPlatform = (key) => {
    setPlatform(key);
    if (key === 'LinkedIn') setMode('linkedin');
    else if (mode === 'competitors' || mode === 'linkedin') setMode('report');
  };

  const importMut = useMutation({
    mutationFn: (file) => { const fd = new FormData(); fd.append('platform', platform); fd.append('organization', orgId); fd.append('file', file); return analyticsApi.import(fd); },
    onSuccess: (res) => {
      toast.success(`Imported ${res.days} days of ${platform} (${res.from} → ${res.to})`);
      qc.invalidateQueries({ queryKey: ['report', orgId, platform] });
    },
    onError: (e) => toast.error(e.response?.data?.message || 'Import failed'),
  });
  const onPickFile = (e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) importMut.mutate(f); };
  const downloadTemplate = async () => {
    try { downloadBlob(await analyticsApi.template(), 'analytics-template.xlsx'); }
    catch { toast.error('Could not download template'); }
  };

  return (
    <div className="space-y-5">
      <input ref={fileRef} type="file" accept=".xlsx,.xls,.csv" className="hidden" onChange={onPickFile} />
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap gap-2">
          {PLATFORMS.map(({ key, icon: Icon, color }) => (
            <button key={key} onClick={() => selectPlatform(key)}
              className={cn('flex items-center gap-2 rounded-xl border px-3.5 py-2 text-sm font-semibold transition',
                platform === key ? 'border-transparent text-white shadow-soft' : 'border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:border-brand-300')}
              style={platform === key ? { background: color } : undefined}>
              <Icon className="h-4 w-4" /> {key}
            </button>
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {mode === 'report' && (
            <select value={range} onChange={(e) => setRange(Number(e.target.value))}
              className="input-base h-9 w-auto py-1 text-sm font-semibold" title="Match this to the range shown on LinkedIn">
              {RANGES.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
            </select>
          )}
          {mode !== 'linkedin' && (
            <>
              <Button size="sm" variant="outline" onClick={downloadTemplate}><Download className="h-4 w-4" /> Template</Button>
              <Button size="sm" variant="outline" onClick={() => fileRef.current?.click()} loading={importMut.isPending}><Upload className="h-4 w-4" /> Import Excel</Button>
            </>
          )}
          <div className="inline-flex rounded-xl bg-slate-100 dark:bg-slate-800 p-1">
            {platform === 'LinkedIn' && <TabBtn active={mode === 'linkedin'} onClick={() => setMode('linkedin')} icon={Linkedin}>LinkedIn view</TabBtn>}
            <TabBtn active={mode === 'report'} onClick={() => setMode('report')} icon={BarChart3}>Report</TabBtn>
            <TabBtn active={mode === 'enter'} onClick={() => setMode('enter')} icon={PenLine}>Enter metrics</TabBtn>
            {showCompetitors && <TabBtn active={mode === 'competitors'} onClick={() => setMode('competitors')} icon={Users}>Competitors</TabBtn>}
          </div>
        </div>
      </div>

      {mode !== 'linkedin' && (
        <div className="flex items-start gap-2.5 rounded-xl border border-slate-200/70 bg-slate-50 px-4 py-3 text-xs text-slate-500 dark:border-slate-800 dark:bg-slate-800/40 dark:text-slate-400">
          <FileSpreadsheet className="mt-0.5 h-4 w-4 shrink-0 text-brand-500" />
          <span>
            <span className="font-semibold text-slate-600 dark:text-slate-300">Weekly Excel import:</span> download your {platform} export
            (Impressions, Clicks, Reactions, Comments, Reposts, Engagement rate, Followers…) and drop it here. Columns and dates are
            detected automatically, each day is stored as a snapshot, and re-uploading the same dates updates them — your past data is never removed.
          </span>
        </div>
      )}

      {mode === 'report' && (platform === 'Instagram' || platform === 'Facebook') && (
        <MetaSync orgId={orgId} platform={platform} report={report} onSynced={() => qc.invalidateQueries({ queryKey: ['report', orgId, platform] })} />
      )}
      {mode === 'report' && platform === 'YouTube' && (
        <YoutubeSync orgId={orgId} report={report} onSynced={() => qc.invalidateQueries({ queryKey: ['report', orgId, platform] })} />
      )}

      {mode === 'linkedin' && <LinkedInView orgId={orgId} />}
      {mode === 'report' && <AnalyticsReport report={report} isLoading={isLoading} />}
      {/* Period metrics + per-post table — Instagram / Facebook / YouTube (LinkedIn uses its own view). */}
      {mode === 'report' && platform !== 'LinkedIn' && <SocialPostSummary orgId={orgId} platform={platform} />}
      {mode === 'report' && platform !== 'LinkedIn' && <SocialPostsTable orgId={orgId} platform={platform} />}
      {mode === 'enter' && <MetricEntry orgId={orgId} platform={platform} report={report} />}
      {mode === 'competitors' && <CompetitorManager orgId={orgId} platform={platform} />}
    </div>
  );
}

const todayStr = () => new Date().toISOString().slice(0, 10);

function MetricEntry({ orgId, platform, report }) {
  const qc = useQueryClient();
  const groups = report?.groups || {};
  const labels = report?.labels || {};
  const pct = new Set(report?.percentFields || []);
  // Plain-language explanation per field + which fields the platform's one-click
  // auto-sync fills (older cached payloads may lack both — degrade gracefully).
  const help = report?.help || {};
  const sync = report?.sync || { provider: null, fields: [] };
  const autoFields = new Set(sync.provider ? sync.fields || [] : []);
  const series = report?.series || [];
  const allFields = Object.values(groups).flat();
  const [date, setDate] = useState(todayStr());
  const [values, setValues] = useState({});

  // Pre-fill the form with whatever is already stored for the chosen date
  // (including values imported from Excel), so editing one date never wipes
  // the rest. A date with no data starts blank.
  useEffect(() => {
    const existing = series.find((s) => String(s.date).slice(0, 10) === date);
    const init = {};
    allFields.forEach((f) => { init[f] = existing && existing[f] != null ? existing[f] : ''; });
    setValues(init);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [date, platform, report?.latest]);

  const saveMut = useMutation({
    mutationFn: () => analyticsApi.record({ platform, organization: orgId, date, ...values }),
    onSuccess: () => { toast.success(`${platform} metrics saved for ${date}`); qc.invalidateQueries({ queryKey: ['report', orgId, platform] }); },
    onError: (e) => toast.error(e.response?.data?.message || 'Save failed'),
  });
  const clearMut = useMutation({
    mutationFn: () => analyticsApi.clear(platform, orgId),
    onSuccess: (res) => {
      toast.success(`Cleared ${platform} metrics${res.deleted ? ` (${res.deleted} entries)` : ''}`);
      const blank = {}; allFields.forEach((f) => { blank[f] = ''; }); setValues(blank);
      qc.invalidateQueries({ queryKey: ['report', orgId, platform] });
    },
    onError: (e) => toast.error(e.response?.data?.message || 'Clear failed'),
  });
  const clearMetrics = () => {
    if (window.confirm(`Clear ALL stored ${platform} metrics for this organization? This deletes every saved/imported entry so you can start fresh. This cannot be undone.`)) clearMut.mutate();
  };
  const editingExisting = series.some((s) => String(s.date).slice(0, 10) === date);

  return (
    <form onSubmit={(e) => { e.preventDefault(); saveMut.mutate(); }} className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="max-w-lg">
          <label className="mb-1 block text-sm font-medium text-slate-600 dark:text-slate-300">Date these numbers are for</label>
          <input type="date" value={date} max={todayStr()} onChange={(e) => setDate(e.target.value)} className="input-base h-10 w-48" />
          <p className="mt-1.5 text-xs text-slate-400">
            Pick the day the metrics belong to — for a weekly total, use the last day of that week. Saving updates only this date and keeps anything already imported for it. {editingExisting ? 'This date already has data, so the fields below are pre-filled.' : 'This date has no data yet — fields start blank.'}
          </p>
        </div>
        {report?.hasData && (
          <Button type="button" variant="outline" loading={clearMut.isPending} onClick={clearMetrics}
            className="border-rose-200 text-rose-600 hover:bg-rose-50 dark:border-rose-500/30 dark:text-rose-400 dark:hover:bg-rose-500/10">
            <Trash2 className="h-4 w-4" /> Clear {platform} metrics
          </Button>
        )}
      </div>
      {Object.entries(groups).map(([group, fields]) => (
        <Card key={group} className="p-5">
          <h3 className="mb-4 font-bold text-slate-800 dark:text-white">{group}</h3>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-4">
            {fields.map((f) => {
              // One-line hint under each input: what the metric means, and a ⚡
              // marker on fields the auto-sync fills so admins skip hand-typing them.
              const auto = autoFields.has(f);
              const hint = auto ? `auto-syncs from ${sync.provider}${help[f] ? ` — ${help[f]}` : ''}` : help[f];
              return (
                <div key={f} className="min-w-0">
                  <Input label={labels[f]} type="number" min="0" step={pct.has(f) ? '0.1' : '1'}
                    value={values[f] ?? ''} onChange={(e) => setValues({ ...values, [f]: e.target.value })} placeholder="0" />
                  {hint && (
                    <p className="mt-1 flex items-center gap-1 text-[11px] text-slate-400" title={help[f] || hint}>
                      {auto && <Zap className="h-3 w-3 shrink-0 text-amber-500" />}
                      <span className="truncate">{hint}</span>
                    </p>
                  )}
                </div>
              );
            })}
          </div>
        </Card>
      ))}
      <Button type="submit" loading={saveMut.isPending}><Save className="h-4 w-4" /> Save {platform} metrics for {date}</Button>
    </form>
  );
}
