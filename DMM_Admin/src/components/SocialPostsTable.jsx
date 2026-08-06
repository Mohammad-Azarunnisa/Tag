import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { ExternalLink, RefreshCw, Image as ImageIcon, Clock } from 'lucide-react';
import { socialPostApi } from '../api/endpoints.js';
import { useAuthStore } from '../store/authStore.js';
import { Card, Badge, Skeleton, EmptyState } from './ui/primitives.jsx';
import { Button } from './ui/Button.jsx';
import { formatNumber, formatDate, timeAgo, cn } from '../lib/utils.js';

// Metric columns per platform — Instagram richest; Facebook has no reliable
// impressions (Meta deprecated them); YouTube has views but no impressions.
const METRIC_COLS = {
  Instagram: [['reach', 'Reach'], ['likes', 'Likes'], ['comments', 'Comments'], ['shares', 'Shares'], ['saved', 'Saved'], ['engagementRate', 'Eng %', true]],
  Facebook: [['impressions', 'Impressions'], ['likes', 'Likes'], ['comments', 'Comments'], ['shares', 'Shares'], ['engagementRate', 'Eng %', true]],
  YouTube: [['views', 'Views'], ['likes', 'Likes'], ['comments', 'Comments'], ['engagementRate', 'Eng %', true]],
};

export default function SocialPostsTable({ orgId, platform }) {
  const qc = useQueryClient();
  const { user } = useAuthStore();
  const canSync = ['ADMIN', 'CEO'].includes(user?.role);
  const cols = METRIC_COLS[platform] || METRIC_COLS.Instagram;

  const { data, isLoading } = useQuery({
    queryKey: ['social-posts', platform, orgId],
    queryFn: () => socialPostApi.list(platform, orgId),
    enabled: !!orgId && !!platform,
  });
  const posts = data?.posts || [];
  const cov = data?.coverage;

  const syncMut = useMutation({
    mutationFn: () => socialPostApi.sync(platform, orgId),
    onSuccess: (r) => {
      toast.success(r.message || 'Sync started', { duration: 6000 });
      // The sync runs in the background and posts upsert as they load, so refresh
      // the table a few times over the next couple of minutes to show progress.
      [12000, 40000, 80000, 140000].forEach((ms) => setTimeout(() => qc.invalidateQueries({ queryKey: ['social-posts', platform, orgId] }), ms));
    },
    onError: (e) => toast.error(e.response?.data?.message || 'Sync failed'),
  });

  const SyncBtn = canSync ? (
    <Button size="sm" variant="outline" loading={syncMut.isPending} onClick={() => syncMut.mutate()}>
      <RefreshCw className={cn('h-4 w-4', syncMut.isPending && 'animate-spin')} /> Sync now
    </Button>
  ) : null;

  return (
    <Card className="overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 px-5 py-4 dark:border-slate-800">
        <div>
          <h3 className="font-bold text-slate-800 dark:text-white">{platform} post performance</h3>
          <p className="mt-0.5 flex items-center gap-1.5 text-xs text-slate-400">
            {cov?.total ? (
              <><Clock className="h-3 w-3" /> {cov.total} posts stored · last synced {cov.lastSync ? timeAgo(cov.lastSync) : '—'}</>
            ) : `Click a post to open it on ${platform}`}
          </p>
        </div>
        {SyncBtn}
      </div>

      {isLoading ? (
        <div className="space-y-2 p-5">{Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-14" />)}</div>
      ) : posts.length === 0 ? (
        <div className="p-5">
          <EmptyState icon={ImageIcon} title={`No ${platform} posts yet`}
            description={canSync ? `Click "Sync now" to pull this organization's ${platform} posts.` : 'An admin needs to sync this platform first.'}
            action={SyncBtn} />
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[720px] text-sm">
            <thead>
              <tr className="border-b border-slate-100 text-left text-xs font-bold uppercase tracking-wide text-slate-400 dark:border-slate-800">
                <th className="px-5 py-3">Post</th>
                <th className="px-3 py-3">Date</th>
                {cols.map(([, label]) => <th key={label} className="px-3 py-3 text-right">{label}</th>)}
                <th className="px-3 py-3 text-right">Open</th>
              </tr>
            </thead>
            <tbody>
              {posts.map((p) => (
                <tr key={p._id} className="border-b border-slate-100 last:border-0 hover:bg-slate-50 dark:border-slate-800 dark:hover:bg-slate-800/40">
                  <td className="px-5 py-2.5">
                    <a href={p.url || '#'} target="_blank" rel="noreferrer" className="group flex items-center gap-3 text-left">
                      <span className="flex h-11 w-11 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-slate-100 dark:bg-slate-800">
                        {p.thumbnail
                          ? <img src={p.thumbnail} alt="" className="h-full w-full object-cover" onError={(e) => { e.currentTarget.style.display = 'none'; }} />
                          : <ImageIcon className="h-4 w-4 text-slate-300" />}
                      </span>
                      <span className="min-w-0">
                        <span className="line-clamp-2 max-w-[320px] font-medium text-slate-700 group-hover:text-brand-600 dark:text-slate-200">{p.caption || '(no caption)'}</span>
                        {p.mediaType && <Badge className="mt-1">{p.mediaType}</Badge>}
                      </span>
                    </a>
                  </td>
                  <td className="whitespace-nowrap px-3 py-2.5 text-xs text-slate-400">{p.publishedAt ? formatDate(p.publishedAt) : '—'}</td>
                  {cols.map(([key, label, pct]) => (
                    <td key={label} className="px-3 py-2.5 text-right tabular-nums text-slate-600 dark:text-slate-300">
                      {pct ? `${(p[key] || 0).toFixed(1)}%` : formatNumber(p[key] || 0)}
                    </td>
                  ))}
                  <td className="px-3 py-2.5 text-right">
                    <a href={p.url || '#'} target="_blank" rel="noreferrer" title={`Open on ${platform}`}
                      className="inline-flex rounded-lg p-1.5 text-slate-400 transition-colors hover:bg-slate-100 hover:text-brand-600 dark:hover:bg-slate-800">
                      <ExternalLink className="h-4 w-4" />
                    </a>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {platform === 'YouTube' && posts.length > 0 && (
        <p className="border-t border-slate-100 px-5 py-2.5 text-[11px] text-slate-400 dark:border-slate-800">
          Views, likes and comments come from the YouTube Data API. Impressions require the YouTube Analytics API (channel-owner sign-in) — a future upgrade.
        </p>
      )}
      {platform === 'Facebook' && posts.length > 0 && (
        <p className="border-t border-slate-100 px-5 py-2.5 text-[11px] text-slate-400 dark:border-slate-800">
          Reactions, comments and shares are live. Facebook post impressions/reach are limited by Meta’s API and may show 0.
        </p>
      )}
    </Card>
  );
}
