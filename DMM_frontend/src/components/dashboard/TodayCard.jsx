import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { FilePlus2, CheckCircle2, UserCheck, Palette, CalendarClock, AlertTriangle, Ban } from 'lucide-react';
import { dashboardApi } from '../../api/endpoints.js';
import { Card, Skeleton } from '../ui/primitives.jsx';
import { Button } from '../ui/Button.jsx';
import { cn } from '../../lib/utils.js';

const STAGE_LABEL = { DESIGN_COORDINATOR_REVIEW: 'Design for your approval', POST_COORDINATOR_REVIEW: 'Post for your approval' };

const Tile = ({ icon: Icon, label, value, hint, tone = 'slate', onClick }) => (
  <button type="button" onClick={onClick} disabled={!onClick}
    className={cn('rounded-2xl border p-4 text-left transition',
      tone === 'amber' ? 'border-amber-200 bg-amber-50/70 dark:border-amber-500/30 dark:bg-amber-500/10' : 'border-slate-100 bg-white dark:border-slate-800 dark:bg-slate-900/60',
      onClick && 'hover:-translate-y-0.5 hover:shadow-md')}>
    <div className="flex items-center gap-2 text-xs font-semibold text-slate-500 dark:text-slate-400">
      <Icon className={cn('h-4 w-4', tone === 'amber' ? 'text-amber-600' : 'text-brand-600')} /> {label}
    </div>
    <p className="mt-2 text-3xl font-extrabold tabular-nums text-slate-800 dark:text-white">{value}</p>
    {hint && <p className="mt-0.5 text-[11px] text-slate-400">{hint}</p>}
  </button>
);

// Seven small columns — raised (orange) beside delivered (blue) for each day.
function WeekStrip({ week }) {
  const max = Math.max(1, ...week.flatMap((d) => [d.raised, d.delivered]));
  const weekday = (key) => new Date(`${key}T00:00:00`).toLocaleDateString('en-IN', { weekday: 'short' });
  return (
    <div>
      <div className="mb-2 flex flex-wrap items-center gap-3 text-[11px] font-semibold text-slate-500">
        <span className="inline-flex items-center gap-1"><i className="h-2 w-2 rounded-sm bg-brand-500" /> Raised</span>
        <span className="inline-flex items-center gap-1"><i className="h-2 w-2 rounded-sm bg-sky-500" /> Designs delivered</span>
      </div>
      <div className="grid grid-cols-7 gap-2">
        {week.map((d, i) => (
          <div key={d.date} className="text-center">
            <div className="flex h-20 items-end justify-center gap-1">
              {[['raised', 'bg-brand-500'], ['delivered', 'bg-sky-500']].map(([k, c]) => (
                <div key={k} title={`${d[k]} ${k}`} className={cn('w-2.5 rounded-t', c)} style={{ height: `${Math.max(d[k] ? 8 : 2, (d[k] / max) * 100)}%`, opacity: d[k] ? 1 : 0.25 }} />
              ))}
            </div>
            <p className={cn('mt-1 text-[11px] font-semibold', i === 6 ? 'text-brand-600' : 'text-slate-400')}>{i === 6 ? 'Today' : weekday(d.date)}</p>
            <p className="text-[10px] tabular-nums text-slate-400">{d.raised}/{d.delivered}</p>
          </div>
        ))}
      </div>
    </div>
  );
}

export default function TodayCard({ orgId }) {
  const navigate = useNavigate();
  const { data, isLoading } = useQuery({ queryKey: ['dashboard', 'today', orgId], queryFn: () => dashboardApi.today(orgId), enabled: !!orgId, refetchInterval: 120000 });
  if (isLoading) return <Skeleton className="h-64" />;
  const t = data?.today;
  if (!t) return null;
  const waiting = t.waitingOnYou;
  const dateLabel = new Date(`${t.date}T00:00:00`).toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long' });

  return (
    <Card className="p-5">
      <div className="mb-4 flex flex-wrap items-end justify-between gap-2">
        <div>
          <h2 className="text-lg font-extrabold text-slate-800 dark:text-white">Today at a glance</h2>
          <p className="text-xs text-slate-400">{dateLabel} · your requests at a glance</p>
        </div>
        <div className="flex flex-wrap gap-2 text-xs font-semibold">
          {t.dueToday > 0 && <span className="inline-flex items-center gap-1 rounded-full bg-sky-100 px-2.5 py-1 text-sky-700"><CalendarClock className="h-3.5 w-3.5" /> {t.dueToday} due today</span>}
          {t.overdue > 0 && <span className="inline-flex items-center gap-1 rounded-full bg-rose-100 px-2.5 py-1 text-rose-700"><AlertTriangle className="h-3.5 w-3.5" /> {t.overdue} overdue</span>}
          {t.cancelled > 0 && <span className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2.5 py-1 text-slate-600"><Ban className="h-3.5 w-3.5" /> {t.cancelled} cancelled today</span>}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Tile icon={FilePlus2} label="Raised today" value={t.raised} onClick={() => navigate('/requests')} />
        <Tile icon={CheckCircle2} label="Designs delivered" value={t.delivered} hint="accepted today" onClick={() => navigate('/workflow/designs')} />
        <Tile icon={UserCheck} label="Waiting on you" value={waiting.count} tone={waiting.count ? 'amber' : 'slate'} hint="accept or decline" onClick={waiting.count ? () => navigate('/requests') : undefined} />
        <Tile icon={Palette} label="With the design team" value={t.withDesigners} hint="waiting, in progress or in review" onClick={() => navigate('/workflow/designs')} />
      </div>

      {waiting.items.length > 0 && (
        <div className="mt-4 rounded-2xl border border-amber-200 bg-amber-50/60 p-3 dark:border-amber-500/30 dark:bg-amber-500/10">
          <p className="mb-2 text-xs font-bold text-amber-800 dark:text-amber-300">Needs your decision</p>
          <div className="flex flex-wrap gap-2">
            {waiting.items.map((w) => (
              <Button key={w._id} size="sm" variant="outline" onClick={() => navigate(`/workflow/${w._id}`)}>
                {w.title.length > 36 ? `${w.title.slice(0, 36)}…` : w.title} · {STAGE_LABEL[w.stage] || 'Review'}
              </Button>
            ))}
          </div>
        </div>
      )}

      <div className="mt-5 border-t border-slate-100 pt-4 dark:border-slate-800">
        <p className="mb-2 text-sm font-bold text-slate-700 dark:text-slate-200">Last 7 days</p>
        <WeekStrip week={data.week} />
      </div>
    </Card>
  );
}
