import { useState, useEffect } from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { Youtube, RefreshCw, Plug, CheckCircle2, AlertTriangle, Link2 } from 'lucide-react';
import { youtubeApi } from '../api/endpoints.js';
import { useAuthStore } from '../store/authStore.js';
import { Button } from './ui/Button.jsx';
import { Card } from './ui/primitives.jsx';
import { cn, formatDate, formatNumber } from '../lib/utils.js';

// Labels for the fields the sync can write, used until the report payload loads.
const FALLBACK_LABELS = {
  subscribers: 'Subscribers', views: 'Views', videoCount: 'Videos',
  comments: 'Comments', engagementRate: 'Engagement Rate',
};

// Live YouTube sync panel, shown above the report on the YouTube tab. The API
// key never reaches this component — it only calls the backend.
export default function YoutubeSync({ orgId, report, onSynced }) {
  const { user: me } = useAuthStore();
  const [linking, setLinking] = useState(false);
  const [q, setQ] = useState('');
  const [lastSync, setLastSync] = useState(null);

  const { data: status, isLoading } = useQuery({ queryKey: ['yt', 'status'], queryFn: youtubeApi.status, staleTime: 60_000, retry: false });
  const { data: chData, refetch } = useQuery({ queryKey: ['yt', 'channel', orgId], queryFn: () => youtubeApi.channel(orgId), retry: false });

  const configured = status?.configured;
  const connected = status?.connected;
  const channel = chData?.channel;
  const labels = report?.labels || FALLBACK_LABELS;
  const pct = new Set(report?.percentFields || ['engagementRate']);

  // A sync result belongs to one organization — clear it when the org changes.
  useEffect(() => { setLastSync(null); }, [orgId]);

  const syncMut = useMutation({
    mutationFn: () => youtubeApi.sync(orgId),
    onSuccess: (res) => { setLastSync(res); toast.success(`Synced YouTube — ${res.fields.length} metric${res.fields.length === 1 ? '' : 's'} from ${res.channel}`); onSynced?.(); },
    onError: (e) => toast.error(e.response?.data?.message || 'YouTube sync failed'),
  });
  const mapMut = useMutation({
    mutationFn: (query) => youtubeApi.map(orgId, query),
    onSuccess: (res) => { toast.success(res.channel ? `Linked to ${res.channel.title}` : 'Channel unlinked'); setLinking(false); setQ(''); refetch(); },
    onError: (e) => toast.error(e.response?.data?.message || 'Could not link channel'),
  });

  return (
    <Card className="flex flex-wrap items-center justify-between gap-3 p-4">
      <div className="flex items-center gap-3">
        <div className={cn('flex h-10 w-10 shrink-0 items-center justify-center rounded-xl', connected ? 'bg-red-50 text-red-600 dark:bg-red-500/10' : 'bg-slate-100 text-slate-400 dark:bg-slate-800')}>
          <Youtube className="h-5 w-5" />
        </div>
        <div>
          <p className="flex items-center gap-2 text-sm font-bold text-slate-800 dark:text-white">
            YouTube auto-sync
            {!isLoading && (connected
              ? <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] font-semibold text-emerald-600 dark:bg-emerald-500/10 dark:text-emerald-400"><CheckCircle2 className="h-3 w-3" />Connected</span>
              : configured
                ? <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-2 py-0.5 text-[11px] font-semibold text-amber-600 dark:bg-amber-500/10 dark:text-amber-400"><AlertTriangle className="h-3 w-3" />Check key</span>
                : <span className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-semibold text-slate-500 dark:bg-slate-800 dark:text-slate-400"><Plug className="h-3 w-3" />Not connected</span>)}
          </p>
          <p className="mt-0.5 max-w-xl text-xs text-slate-400">
            {isLoading ? 'Checking YouTube connection…'
              : !configured ? 'Add YOUTUBE_API_KEY to the backend .env to pull channel stats automatically.'
              : !connected ? (status.message || 'Key present but not usable.')
              : channel ? <>Linked channel: <span className="font-semibold text-slate-600 dark:text-slate-300">{channel.title}</span></>
              : 'No channel linked to this organization yet.'}
          </p>
          {report?.latest?.date && (
            <p className="mt-0.5 text-[11px] text-slate-400">Data through {formatDate(report.latest.date)}</p>
          )}
        </div>
      </div>

      <div className="flex items-center gap-2">
        {connected && me?.isSuperAdmin && (
          <Button size="sm" variant="outline" onClick={() => { setLinking((v) => !v); setQ(''); }}>
            <Link2 className="h-4 w-4" /> {channel ? 'Change channel' : 'Link channel'}
          </Button>
        )}
        <Button size="sm" disabled={!connected || !channel} loading={syncMut.isPending} onClick={() => syncMut.mutate()} title={channel ? 'Pull live stats from YouTube' : 'Link a channel first'}>
          <RefreshCw className="h-4 w-4" /> Sync from YouTube
        </Button>
      </div>

      {/* What the last sync actually landed: one chip per written field. */}
      {lastSync?.fields?.length > 0 && (
        <div className="flex w-full flex-wrap items-center gap-1.5 border-t border-slate-100 pt-3 dark:border-slate-800">
          <span className="text-[11px] font-semibold text-slate-500 dark:text-slate-400">Last sync wrote:</span>
          {lastSync.fields.map((f) => (
            <span key={f} className="rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] font-semibold text-emerald-600 dark:bg-emerald-500/10 dark:text-emerald-400">
              {labels[f] || f}: {pct.has(f) ? `${lastSync.metrics?.[f]}%` : formatNumber(lastSync.metrics?.[f])}
            </span>
          ))}
        </div>
      )}

      {linking && me?.isSuperAdmin && (
        <form onSubmit={(e) => { e.preventDefault(); if (q.trim()) mapMut.mutate(q.trim()); }} className="flex w-full flex-wrap items-center gap-2 border-t border-slate-100 pt-3 dark:border-slate-800">
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Channel @handle, URL, or ID (e.g. @NCET)"
            className="input-base h-10 flex-1 min-w-[220px] text-sm" />
          <Button size="sm" type="submit" loading={mapMut.isPending} disabled={!q.trim()}>Link</Button>
          {channel && <Button size="sm" type="button" variant="outline" onClick={() => mapMut.mutate('')} className="border-rose-200 text-rose-600 hover:bg-rose-50 dark:border-rose-500/30 dark:text-rose-400">Unlink</Button>}
        </form>
      )}
    </Card>
  );
}
