import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ArrowUp, ArrowDown, CalendarRange } from 'lucide-react';
import { socialPostApi } from '../api/endpoints.js';
import { Card, Skeleton } from './ui/primitives.jsx';
import { formatNumber, formatDate, cn } from '../lib/utils.js';

const RANGES = [
  { v: 7, label: '7 days' }, { v: 15, label: '15 days' }, { v: 30, label: '30 days' },
  { v: 90, label: '90 days' }, { v: 365, label: '1 year' },
];

// Which totals to show per platform (from what the API actually returns).
const TILES = {
  Instagram: [['posts', 'Posts'], ['reach', 'Reach'], ['likes', 'Likes'], ['comments', 'Comments'], ['shares', 'Shares'], ['saved', 'Saved']],
  Facebook: [['posts', 'Posts'], ['likes', 'Likes'], ['comments', 'Comments'], ['shares', 'Shares'], ['engagement', 'Engagement']],
  YouTube: [['posts', 'Videos'], ['views', 'Views'], ['likes', 'Likes'], ['comments', 'Comments']],
};

function Delta({ cur, prev }) {
  if (prev > 0) {
    const pct = Math.round(((cur - prev) / prev) * 100);
    if (pct === 0) return <span className="text-[11px] font-medium text-slate-400">no change</span>;
    const up = pct > 0;
    return (
      <span className={cn('inline-flex items-center gap-0.5 text-[11px] font-bold', up ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-500')}>
        {up ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" />}{Math.abs(pct)}%
      </span>
    );
  }
  if (cur > 0) return <span className="text-[11px] font-bold text-emerald-600 dark:text-emerald-400">new</span>;
  return <span className="text-[11px] text-slate-300 dark:text-slate-600">—</span>;
}

export default function SocialPostSummary({ orgId, platform }) {
  const [range, setRange] = useState(30);
  const tiles = TILES[platform] || TILES.Instagram;

  const { data, isLoading } = useQuery({
    queryKey: ['social-summary', platform, orgId, range],
    queryFn: () => socialPostApi.summary(platform, orgId, range),
    enabled: !!orgId && !!platform,
  });
  const cur = data?.current || {};
  const prev = data?.previous || {};
  const cov = data?.coverage;

  return (
    <Card className="overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 px-5 py-4 dark:border-slate-800">
        <div>
          <h3 className="font-bold text-slate-800 dark:text-white">{platform} performance — last {range === 365 ? '1 year' : `${range} days`}</h3>
          <p className="mt-0.5 flex items-center gap-1.5 text-xs text-slate-400">
            <CalendarRange className="h-3 w-3" />
            {cov?.total
              ? `${formatNumber(cov.total)} posts · ${cov.days} days of records${cov.oldest ? ` (${formatDate(cov.oldest)} → ${formatDate(cov.newest)})` : ''}`
              : 'No posts synced yet — use “Sync now” on the table below'}
          </p>
        </div>
        <div className="inline-flex flex-wrap rounded-xl bg-slate-100 p-1 dark:bg-slate-800">
          {RANGES.map((r) => (
            <button key={r.v} onClick={() => setRange(r.v)}
              className={cn('rounded-lg px-2.5 py-1.5 text-xs font-semibold transition',
                range === r.v ? 'bg-white text-brand-700 shadow-soft dark:bg-slate-900 dark:text-brand-300' : 'text-slate-500 hover:text-slate-700 dark:hover:text-slate-300')}>
              {r.label}
            </button>
          ))}
        </div>
      </div>

      {isLoading ? (
        <div className="grid grid-cols-2 gap-3 p-5 sm:grid-cols-3 lg:grid-cols-6">
          {tiles.map((_, i) => <Skeleton key={i} className="h-20" />)}
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-3 p-5 sm:grid-cols-3 lg:grid-cols-6">
          {tiles.map(([key, label]) => (
            <div key={key} className="rounded-xl border border-slate-100 bg-slate-50/60 p-3 dark:border-slate-800 dark:bg-slate-800/40">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">{label}</p>
              <p className="mt-1 text-xl font-extrabold tabular-nums text-slate-800 dark:text-white">{formatNumber(cur[key] || 0)}</p>
              <p className="mt-0.5 flex items-center gap-1 text-[11px] text-slate-400">
                <Delta cur={cur[key] || 0} prev={prev[key] || 0} /> <span>vs prev {range}d</span>
              </p>
            </div>
          ))}
        </div>
      )}
      <p className="border-t border-slate-100 px-5 py-2.5 text-[11px] text-slate-400 dark:border-slate-800">
        Totals are the posts published in each window, compared with the previous window of the same length. Auto-synced daily.
      </p>
    </Card>
  );
}
