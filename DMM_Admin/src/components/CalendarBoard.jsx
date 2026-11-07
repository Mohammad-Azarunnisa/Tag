import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ChevronLeft, ChevronRight, CalendarDays, X, Clock3 } from 'lucide-react';
import { calendarApi } from '../api/endpoints.js';
import { Card, Skeleton, EmptyState } from './ui/primitives.jsx';
import { cn } from '../lib/utils.js';

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const PLATFORM_COLOR = { LinkedIn: '#0A66C2', Instagram: '#E1306C', YouTube: '#FF0000', Facebook: '#1877F2' };
const pad = (n) => String(n).padStart(2, '0');

const nf = (n) => Number(n || 0).toLocaleString('en-IN');
const timeOf = (iso) => new Date(iso).toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit', hour12: true, timeZone: 'Asia/Kolkata' });

// One post exactly as the platform reports it: when it went out, what it was, and how it did.
function PlatformPost({ p }) {
  const [thumbOk, setThumbOk] = useState(true);
  const m = p.metrics || {};
  const chips = [
    ['Likes', m.likes], ['Comments', m.comments], ['Shares', m.shares],
    [p.platform === 'YouTube' ? 'Views' : 'Reach', p.platform === 'YouTube' ? m.views : (m.reach || 0)],
    ['Impressions', m.impressions], ['Clicks', m.clicks],
  ].filter(([, v]) => v);
  const Wrapper = p.url ? 'a' : 'div';
  return (
    <Wrapper {...(p.url ? { href: p.url, target: '_blank', rel: 'noreferrer' } : {})}
      className="block rounded-xl border border-slate-100 p-2.5 transition hover:border-brand-300 dark:border-slate-800">
      <div className="flex gap-3">
        {p.thumbnail && thumbOk
          ? <img src={p.thumbnail} alt="" onError={() => setThumbOk(false)} className="h-12 w-12 shrink-0 rounded-lg object-cover" />
          : <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-lg text-[10px] font-bold text-white" style={{ background: PLATFORM_COLOR[p.platform] || '#94a3b8' }}>{p.platform.slice(0, 2).toUpperCase()}</div>}
        <div className="min-w-0 flex-1">
          <p className="line-clamp-2 text-sm font-semibold text-slate-700 dark:text-slate-200">{p.title}</p>
          <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-slate-400">
            <span className="inline-flex items-center gap-1 font-semibold" style={{ color: PLATFORM_COLOR[p.platform] }}>
              <span className="h-2 w-2 rounded-full" style={{ background: PLATFORM_COLOR[p.platform] }} />{p.platform}
            </span>
            {p.timeKnown
              ? <span className="inline-flex items-center gap-1 font-semibold text-slate-600 dark:text-slate-300"><Clock3 className="h-3 w-3" />Posted at {timeOf(p.publishedAt)}</span>
              : <span className="inline-flex items-center gap-1 italic"><Clock3 className="h-3 w-3" />Time not reported by LinkedIn</span>}
            {p.mediaType && <span className="uppercase tracking-wide">{String(p.mediaType).replace(/_/g, ' ').toLowerCase()}</span>}
          </div>
        </div>
      </div>
      {chips.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {chips.map(([label, v]) => (
            <span key={label} className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-semibold text-slate-600 dark:bg-slate-800 dark:text-slate-300">
              {label} <b className="text-slate-800 dark:text-white">{nf(v)}</b>
            </span>
          ))}
        </div>
      )}
    </Wrapper>
  );
}

// Posting calendar for one organization, built from what the platforms report. `orgId` is passed by the parent.
export default function CalendarBoard({ orgId }) {
  const today = new Date();
  const [view, setView] = useState({ year: today.getFullYear(), month: today.getMonth() }); // month 0-indexed
  const [selected, setSelected] = useState(null); // 'YYYY-MM-DD'

  const monthStr = `${view.year}-${pad(view.month + 1)}`;
  const { data: monthData, isLoading } = useQuery({
    queryKey: ['calendar', orgId, monthStr],
    queryFn: () => calendarApi.month(orgId, monthStr),
  });
  const counts = (monthData?.days || []).reduce((acc, d) => { acc[d.date] = d; return acc; }, {});
  const byPlatform = monthData?.byPlatform || {};

  const firstWeekday = new Date(view.year, view.month, 1).getDay();
  const daysInMonth = new Date(view.year, view.month + 1, 0).getDate();
  const cells = [...Array(firstWeekday).fill(null), ...Array.from({ length: daysInMonth }, (_, i) => i + 1)];
  const todayStr = `${today.getFullYear()}-${pad(today.getMonth() + 1)}-${pad(today.getDate())}`;

  const shiftMonth = (delta) => {
    setSelected(null);
    setView((v) => {
      const d = new Date(v.year, v.month + delta, 1);
      return { year: d.getFullYear(), month: d.getMonth() };
    });
  };

  return (
    <div className="grid gap-5 lg:grid-cols-3">
      <Card className="p-5 lg:col-span-2">
        <div className="mb-4 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <CalendarDays className="h-5 w-5 text-brand-600" />
            <h3 className="text-lg font-bold text-slate-800 dark:text-white">{MONTHS[view.month]} {view.year}</h3>
          </div>
          <div className="flex items-center gap-1">
            <button onClick={() => shiftMonth(-1)} className="rounded-lg p-2 text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800"><ChevronLeft className="h-4 w-4" /></button>
            <button onClick={() => { setSelected(null); setView({ year: today.getFullYear(), month: today.getMonth() }); }} className="rounded-lg px-3 py-1.5 text-xs font-semibold text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800">Today</button>
            <button onClick={() => shiftMonth(1)} className="rounded-lg p-2 text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800"><ChevronRight className="h-4 w-4" /></button>
          </div>
        </div>

        <div className="mb-1 grid grid-cols-7 gap-1.5 text-center text-[11px] font-semibold uppercase text-slate-400">
          {WEEKDAYS.map((d) => <div key={d} className="py-1">{d}</div>)}
        </div>

        {isLoading ? (
          <Skeleton className="h-72 w-full" />
        ) : (
          <div className="grid grid-cols-7 gap-1.5">
            {cells.map((day, i) => {
              if (!day) return <div key={`b-${i}`} />;
              const dateStr = `${view.year}-${pad(view.month + 1)}-${pad(day)}`;
              const info = counts[dateStr];
              const has = !!info?.count;
              const isToday = dateStr === todayStr;
              const isSel = dateStr === selected;
              return (
                <button
                  key={dateStr}
                  onClick={() => has && setSelected(dateStr)}
                  className={cn(
                    'relative flex aspect-square flex-col items-center justify-start rounded-xl border p-1.5 text-sm transition',
                    has ? 'cursor-pointer border-brand-200 dark:border-brand-500/30 bg-brand-50/60 dark:bg-brand-500/10 hover:border-brand-400' : 'border-transparent',
                    !has && 'text-slate-400',
                    isSel && 'ring-2 ring-brand-500',
                    isToday && 'font-extrabold text-brand-600'
                  )}
                >
                  <span>{day}</span>
                  {has && (
                    <span className="mt-1 inline-flex items-center justify-center rounded-full bg-brand-600 px-1.5 text-[10px] font-bold text-white">{info.count}</span>
                  )}
                  {has && (
                    <span className="absolute bottom-1 flex gap-0.5">
                      {info.platforms?.slice(0, 4).map((p) => <span key={p} className="h-1.5 w-1.5 rounded-full" style={{ background: PLATFORM_COLOR[p] || '#94a3b8' }} />)}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        )}

        <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-slate-100 dark:border-slate-800 pt-3 text-xs text-slate-400">
          <span>Total this month: <b className="text-slate-600 dark:text-slate-300">{monthData?.total || 0}</b> posts</span>
          {!!monthData?.totalLikes && <span>Likes: <b className="text-slate-600 dark:text-slate-300">{nf(monthData.totalLikes)}</b></span>}
          <div className="ml-auto flex flex-wrap items-center gap-3">
            {Object.entries(PLATFORM_COLOR).map(([p, c]) => (
              <span key={p} className="flex items-center gap-1"><span className="h-2 w-2 rounded-full" style={{ background: c }} />{p}{byPlatform[p] ? <b className="text-slate-600 dark:text-slate-300"> {byPlatform[p]}</b> : null}</span>
            ))}
          </div>
        </div>
        <p className="mt-2 text-[11px] text-slate-400">From the numbers Instagram, Facebook, YouTube and the LinkedIn export report — {monthData?.lastSyncedAt ? `last synced ${new Date(monthData.lastSyncedAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}` : 'the same data as Social Analytics'}.</p>
      </Card>

      <DayPanel orgId={orgId} date={selected} onClose={() => setSelected(null)} />
    </div>
  );
}

function DayPanel({ orgId, date, onClose }) {
  const { data, isLoading } = useQuery({
    queryKey: ['calendar-day', orgId, date],
    queryFn: () => calendarApi.day(orgId, date),
    enabled: !!date,
  });
  const posts = data?.posts || [];
  const totals = data?.totals || {};

  if (!date) {
    return (
      <Card className="p-5">
        <EmptyState icon={CalendarDays} title="Select a date" description="Click a highlighted day to see the posts published that day." />
      </Card>
    );
  }

  const pretty = new Date(`${date}T00:00:00`).toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });

  return (
    <Card className="p-5">
      <div className="mb-4 flex items-start justify-between">
        <div>
          <p className="text-xs font-semibold uppercase text-slate-400">Posts on</p>
          <h3 className="font-bold text-slate-800 dark:text-white">{pretty}</h3>
        </div>
        <button onClick={onClose} className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800"><X className="h-4 w-4" /></button>
      </div>
      {isLoading ? (
        <div className="space-y-2">{Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-16" />)}</div>
      ) : posts.length === 0 ? (
        <p className="text-sm text-slate-400">No posts on this day.</p>
      ) : (
        <div className="space-y-3">
          <p className="text-sm font-semibold text-slate-600 dark:text-slate-300">
            {posts.length} post{posts.length > 1 ? 's' : ''}
            {totals.likes ? <span className="font-normal text-slate-400"> · {nf(totals.likes)} likes</span> : null}
          </p>
          {posts.map((p) => <PlatformPost key={p.id} p={p} />)}
        </div>
      )}
    </Card>
  );
}
