import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ChevronLeft, ChevronRight, CalendarDays, X } from 'lucide-react';
import { calendarApi } from '../api/endpoints.js';
import { Card, Badge, Avatar, Skeleton, EmptyState } from './ui/primitives.jsx';
import { cn } from '../lib/utils.js';

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const PLATFORM_COLOR = { LinkedIn: '#0A66C2', Instagram: '#E1306C', YouTube: '#FF0000', Facebook: '#1877F2' };
const pad = (n) => String(n).padStart(2, '0');

// Posting calendar for one organization. `orgId` is passed by the parent.
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

        <div className="mt-4 flex items-center gap-4 border-t border-slate-100 dark:border-slate-800 pt-3 text-xs text-slate-400">
          <span>Total this month: <b className="text-slate-600 dark:text-slate-300">{monthData?.total || 0}</b> posts</span>
          <div className="ml-auto flex items-center gap-3">
            {Object.entries(PLATFORM_COLOR).map(([p, c]) => (
              <span key={p} className="flex items-center gap-1"><span className="h-2 w-2 rounded-full" style={{ background: c }} />{p}</span>
            ))}
          </div>
        </div>
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
          <p className="text-sm font-semibold text-slate-600 dark:text-slate-300">{posts.length} post{posts.length > 1 ? 's' : ''}</p>
          {posts.map((p) => (
            <div key={p._id} className="flex gap-3 rounded-xl border border-slate-100 dark:border-slate-800 p-2.5">
              {p.cover ? <img src={p.cover} alt="" className="h-12 w-12 shrink-0 rounded-lg object-cover" /> : <div className="h-12 w-12 shrink-0 rounded-lg bg-slate-100 dark:bg-slate-800" />}
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-semibold text-slate-700 dark:text-slate-200">{p.title}</p>
                <div className="mt-1 flex items-center gap-2">
                  <Badge className="text-white" >{p.platform}</Badge>
                  <span className="flex items-center gap-1 text-xs text-slate-400"><Avatar src={p.createdBy?.avatar} name={p.createdBy?.name} size="sm" className="!h-4 !w-4 !text-[8px]" /> {p.createdBy?.name}</span>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}
