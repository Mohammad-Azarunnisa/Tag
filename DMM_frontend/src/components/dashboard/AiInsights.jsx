import { useQuery } from '@tanstack/react-query';
import { motion } from 'framer-motion';
import {
  Sparkles, TrendingUp, Lightbulb, ArrowRight, RefreshCw, Loader2,
  ArrowUp, ArrowDown, Trophy, Users, Linkedin, Instagram, Youtube, Facebook,
} from 'lucide-react';
import { aiApi } from '../../api/endpoints.js';
import { Card } from '../ui/primitives.jsx';
import { cn, formatNumber, PLATFORM_STYLES } from '../../lib/utils.js';
import CountUp from './CountUp.jsx';

const PLATFORM_ICON = { LinkedIn: Linkedin, Instagram, YouTube: Youtube, Facebook };
const audienceLabel = (p) => (p === 'YouTube' ? 'subscribers' : 'followers');

// The 28-day change chip next to each bar — green up, rose down, quiet dash.
function DeltaChip({ value }) {
  if (value == null) return <span className="text-[11px] font-medium text-slate-300 dark:text-slate-600">no trend yet</span>;
  if (value === 0) return <span className="text-[11px] font-medium text-slate-400">no change</span>;
  const up = value > 0;
  return (
    <span className={cn('inline-flex items-center gap-0.5 rounded-full px-1.5 py-0.5 text-[11px] font-bold',
      up ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300'
         : 'bg-rose-100 text-rose-600 dark:bg-rose-500/15 dark:text-rose-300')}>
      {up ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" />}
      {up ? '+' : ''}{formatNumber(value)}
    </span>
  );
}

// A single platform footprint bar, animated to its share of the biggest audience.
function PlatformBar({ p, max, delay }) {
  const Icon = PLATFORM_ICON[p.platform] || Users;
  const color = PLATFORM_STYLES[p.platform]?.color || '#6366f1';
  const pct = max > 0 ? Math.max(4, Math.round((p.audience / max) * 100)) : 4;
  return (
    <div>
      <div className="mb-1 flex items-center justify-between gap-2">
        <span className="flex items-center gap-1.5 text-sm font-semibold text-slate-700 dark:text-slate-200">
          <span className="flex h-5 w-5 items-center justify-center rounded-md" style={{ backgroundColor: `${color}1a`, color }}>
            <Icon className="h-3.5 w-3.5" />
          </span>
          {p.platform}
        </span>
        <span className="flex items-center gap-2">
          <span className="tabular-nums text-sm font-extrabold text-slate-800 dark:text-white">{formatNumber(p.audience)}</span>
          <DeltaChip value={p.gained28d} />
        </span>
      </div>
      <div className="h-2.5 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800">
        <motion.div
          className="h-full rounded-full"
          style={{ backgroundColor: color }}
          initial={{ width: 0 }} animate={{ width: `${pct}%` }}
          transition={{ duration: 0.9, delay, ease: [0.22, 1, 0.36, 1] }}
        />
      </div>
      <p className="mt-1 text-[11px] text-slate-400">
        {audienceLabel(p.platform)}{p.engagementPct > 0 ? ` · ${p.engagementPct.toFixed(1)}% engagement` : ''}
      </p>
    </div>
  );
}

// "Explain these numbers" — Tago reads the org's live analytics and presents a
// visual, encouraging read-out. Cached on the server for 6 hours, so a dashboard
// view costs nothing unless the cache is cold or the user refreshes.
export default function AiInsights({ orgId }) {
  const { data: status } = useQuery({ queryKey: ['ai-status'], queryFn: aiApi.status, staleTime: 5 * 60 * 1000 });
  const ready = !!status?.configured;

  const { data, isLoading, isFetching, isError, refetch } = useQuery({
    queryKey: ['ai-insights', orgId],
    queryFn: () => aiApi.insights(orgId),
    enabled: ready && !!orgId,
    staleTime: 30 * 60 * 1000,
    retry: false,
  });

  if (!ready || !orgId) return null;

  const regenerate = () => aiApi.insights(orgId, true).then(() => refetch());
  const m = data?.metrics;
  const platforms = m?.platforms || [];
  const maxAudience = platforms.reduce((mx, p) => Math.max(mx, p.audience || 0), 0);
  const topPlatform = m?.topPlatform;

  return (
    <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.45, ease: [0.22, 1, 0.36, 1] }}>
      <Card className="overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between gap-3 border-b border-slate-100 bg-gradient-to-r from-brand-50/70 to-transparent px-5 py-4 dark:border-slate-800 dark:from-brand-500/10">
          <div className="flex items-center gap-2.5">
            <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-brand-500 to-amber-500 text-white shadow-sm">
              <Sparkles className="h-5 w-5" />
            </span>
            <div>
              <p className="text-sm font-bold text-slate-800 dark:text-white">Tago’s read on your numbers</p>
              <p className="text-xs text-slate-400">AI insight from your live analytics</p>
            </div>
          </div>
          <button
            type="button" onClick={regenerate} disabled={isFetching}
            className="inline-flex items-center gap-1.5 rounded-full border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-500 transition hover:border-brand-300 hover:text-brand-600 disabled:opacity-50 dark:border-slate-700 dark:text-slate-400"
          >
            <RefreshCw className={cn('h-3.5 w-3.5', isFetching && 'animate-spin')} /> Refresh
          </button>
        </div>

        <div className="p-5">
          {isLoading ? (
            <div className="flex items-center gap-2.5 text-sm text-slate-400">
              <Loader2 className="h-4 w-4 animate-spin text-brand-500" /> Tago is reading the latest numbers…
            </div>
          ) : isError ? (
            <p className="text-sm text-slate-400">Couldn’t generate insights right now. <button onClick={() => refetch()} className="font-semibold text-brand-600 hover:underline">Try again</button>.</p>
          ) : data?.empty ? (
            <p className="text-sm text-slate-400">{data.message || 'No analytics recorded yet for this organization.'}</p>
          ) : (
            <div className="space-y-6">
              {/* Hero: total reach + net growth, with the AI headline.
                  Falls back to the headline alone if metrics aren't present. */}
              {!m && data?.headline && (
                <p className="text-lg font-bold leading-snug text-slate-800 dark:text-white">{data.headline}</p>
              )}
              {m && (
              <div className="grid gap-5 md:grid-cols-5">
                <div className="md:col-span-2">
                  <div className="rounded-2xl bg-gradient-to-br from-[#0b2350] via-[#0a1f44] to-[#07152e] p-5 text-white">
                    <p className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.15em] text-brand-300/90">
                      <Users className="h-3.5 w-3.5" /> Total reach
                    </p>
                    <p className="mt-1 text-4xl font-extrabold tabular-nums">
                      <CountUp value={m?.totalAudience || 0} />
                    </p>
                    <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-white/70">
                      <span>across {m?.platformCount || 0} platform{(m?.platformCount || 0) === 1 ? '' : 's'}</span>
                      {m?.gained28d != null && m.gained28d !== 0 && (
                        <span className={cn('inline-flex items-center gap-0.5 font-bold', m.gained28d > 0 ? 'text-emerald-300' : 'text-rose-300')}>
                          {m.gained28d > 0 ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" />}
                          {m.gained28d > 0 ? '+' : ''}{formatNumber(m.gained28d)} in 28 days
                        </span>
                      )}
                    </div>
                    {topPlatform && (
                      <p className="mt-3 inline-flex items-center gap-1.5 rounded-full bg-white/10 px-2.5 py-1 text-[11px] font-semibold text-amber-200">
                        <Trophy className="h-3.5 w-3.5" /> Leading on {topPlatform}
                      </p>
                    )}
                  </div>
                </div>
                <div className="flex items-center md:col-span-3">
                  {data?.headline && (
                    <p className="text-lg font-bold leading-snug text-slate-800 dark:text-white">{data.headline}</p>
                  )}
                </div>
              </div>
              )}

              {/* Platform footprint bar chart */}
              {platforms.length > 0 && (
                <div>
                  <p className="mb-3 text-xs font-bold uppercase tracking-wide text-slate-400">Audience by platform</p>
                  <div className="space-y-3.5">
                    {platforms.map((p, i) => <PlatformBar key={p.platform} p={p} max={maxAudience} delay={0.1 + i * 0.08} />)}
                  </div>
                </div>
              )}

              {/* Wins + Opportunities */}
              <div className="grid gap-5 md:grid-cols-2">
                {data?.highlights?.length > 0 && (
                  <div>
                    <p className="mb-2 flex items-center gap-1.5 text-xs font-bold uppercase tracking-wide text-emerald-600 dark:text-emerald-400">
                      <TrendingUp className="h-3.5 w-3.5" /> What’s working
                    </p>
                    <ul className="space-y-2.5">
                      {data.highlights.map((h, i) => (
                        <li key={i} className="rounded-xl border border-emerald-100 bg-emerald-50/50 p-2.5 dark:border-emerald-500/20 dark:bg-emerald-500/5">
                          <p className="text-sm font-semibold text-slate-700 dark:text-slate-200">{h.title}</p>
                          <p className="mt-0.5 text-xs leading-relaxed text-slate-500 dark:text-slate-400">{h.detail}</p>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
                {data?.watchOuts?.length > 0 && (
                  <div>
                    <p className="mb-2 flex items-center gap-1.5 text-xs font-bold uppercase tracking-wide text-indigo-600 dark:text-indigo-400">
                      <Lightbulb className="h-3.5 w-3.5" /> Opportunities
                    </p>
                    <ul className="space-y-2.5">
                      {data.watchOuts.map((w, i) => (
                        <li key={i} className="rounded-xl border border-indigo-100 bg-indigo-50/50 p-2.5 dark:border-indigo-500/20 dark:bg-indigo-500/5">
                          <p className="text-sm font-semibold text-slate-700 dark:text-slate-200">{w.title}</p>
                          <p className="mt-0.5 text-xs leading-relaxed text-slate-500 dark:text-slate-400">{w.detail}</p>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>

              {/* Recommendations */}
              {data?.recommendations?.length > 0 && (
                <div className="rounded-xl bg-slate-50 p-4 dark:bg-slate-800/50">
                  <p className="mb-2 text-xs font-bold uppercase tracking-wide text-brand-600 dark:text-brand-400">Recommended next steps</p>
                  <ul className="space-y-1.5">
                    {data.recommendations.map((r, i) => (
                      <li key={i} className="flex items-start gap-2 text-sm text-slate-600 dark:text-slate-300">
                        <ArrowRight className="mt-0.5 h-4 w-4 shrink-0 text-brand-500" /> <span>{r}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              <p className="text-[11px] text-slate-300 dark:text-slate-600">
                Generated by Tago AI from your recorded analytics · always double-check before acting.
              </p>
            </div>
          )}
        </div>
      </Card>
    </motion.div>
  );
}
