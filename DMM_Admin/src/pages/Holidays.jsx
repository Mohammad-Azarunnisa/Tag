import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { ChevronLeft, ChevronRight, Plus, Trash2, CalendarOff, ListPlus } from 'lucide-react';
import { holidayApi } from '../api/endpoints.js';
import { useAuthStore } from '../store/authStore.js';
import PageHeader from '../components/layout/PageHeader.jsx';
import { Button } from '../components/ui/Button.jsx';
import { Card, Input, Skeleton, EmptyState } from '../components/ui/primitives.jsx';
import { cn } from '../lib/utils.js';

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const pad = (n) => String(n).padStart(2, '0');

// Read one line of pasted text into { date, name }. Dates may be written
// 2026-11-01, 01-11-2026, 01/11/2026 or 1.11.2026 (day first, the way they are
// written here); the name is whatever follows, after a comma, tab, dash or space.
const parseLine = (line) => {
  const m = line.trim().match(/^(\d{4}-\d{1,2}-\d{1,2}|\d{1,2}[-/.]\d{1,2}[-/.]\d{4})\s*[,\t:–—-]?\s*(.*)$/);
  if (!m) return { raw: line, error: 'Start the line with a date' };
  const raw = m[1];
  let y; let mo; let d;
  if (/^\d{4}/.test(raw)) [y, mo, d] = raw.split('-').map(Number);
  else [d, mo, y] = raw.split(/[-/.]/).map(Number);
  const key = `${y}-${pad(mo)}-${pad(d)}`;
  const dt = new Date(`${key}T00:00:00Z`);
  const ok = !Number.isNaN(dt.getTime()) && dt.toISOString().slice(0, 10) === key;
  if (!ok) return { raw: line, error: `"${raw}" is not a real date` };
  if (!m[2].trim()) return { raw: line, date: key, error: 'Add a name after the date' };
  return { raw: line, date: key, name: m[2].trim() };
};
const keysBetween = (from, to) => {
  const out = [];
  for (let t = new Date(`${from}T00:00:00Z`).getTime(), end = new Date(`${to}T00:00:00Z`).getTime(); t <= end && out.length < 400; t += 86400000) out.push(new Date(t).toISOString().slice(0, 10));
  return out;
};

// The holiday list behind every design delivery date. Sundays are never working
// days; anything added here is skipped as well. Kept by the super admin, shared
// by every college.
export default function Holidays() {
  const { user } = useAuthStore();
  const qc = useQueryClient();
  const canEdit = !!user?.isSuperAdmin && !user?.viewOnly;
  const now = new Date();
  const [view, setView] = useState({ year: now.getFullYear(), month: now.getMonth() });
  const [date, setDate] = useState('');
  const [name, setName] = useState('');
  const [mode, setMode] = useState('one'); // 'one' | 'many'
  const [bulkText, setBulkText] = useState('');
  const [rangeFrom, setRangeFrom] = useState('');
  const [rangeTo, setRangeTo] = useState('');
  const [rangeName, setRangeName] = useState('');

  const monthKey = `${view.year}-${pad(view.month + 1)}`;
  const { data, isLoading } = useQuery({ queryKey: ['holidays', monthKey], queryFn: () => holidayApi.list({ month: monthKey }) });
  const holidays = data?.holidays || [];
  const byDate = Object.fromEntries(holidays.map((h) => [h.date, h]));
  const refresh = () => qc.invalidateQueries({ queryKey: ['holidays'] });

  const addMut = useMutation({
    mutationFn: () => holidayApi.add({ date, name: name.trim() }),
    onSuccess: () => { toast.success('Holiday added'); setName(''); refresh(); },
    onError: (e) => toast.error(e.response?.data?.message || 'Could not add that'),
  });
  const parsed = bulkText.split('\n').filter((l) => l.trim()).map(parseLine);
  const rangeKeys = rangeFrom && rangeTo && rangeTo >= rangeFrom ? keysBetween(rangeFrom, rangeTo) : [];
  const rows = [
    ...parsed.filter((p) => !p.error).map((p) => ({ date: p.date, name: p.name })),
    ...(rangeName.trim() ? rangeKeys.map((d) => ({ date: d, name: rangeName.trim() })) : []),
  ];
  const problems = parsed.filter((p) => p.error);
  const bulkMut = useMutation({
    mutationFn: () => holidayApi.add({ holidays: rows }),
    onSuccess: (r) => {
      toast.success(`${r.added} added${r.updated ? `, ${r.updated} updated` : ''}`);
      setBulkText(''); setRangeFrom(''); setRangeTo(''); setRangeName('');
      if (rows[0]) { const [y, m] = rows[0].date.split('-').map(Number); setView({ year: y, month: m - 1 }); }
      refresh();
    },
    onError: (e) => toast.error(e.response?.data?.message || 'Could not add those'),
  });
  const submitMany = (e) => {
    e.preventDefault();
    if (problems.length) return toast.error('Fix the lines marked in red first');
    if (!rows.length) return toast.error('Add at least one holiday');
    bulkMut.mutate();
  };

  const delMut = useMutation({
    mutationFn: (id) => holidayApi.remove(id),
    onSuccess: () => { toast.success('Removed'); refresh(); },
    onError: (e) => toast.error(e.response?.data?.message || 'Could not remove that'),
  });

  const shift = (d) => setView((v) => { const x = new Date(v.year, v.month + d, 1); return { year: x.getFullYear(), month: x.getMonth() }; });
  const first = new Date(view.year, view.month, 1).getDay();
  const days = new Date(view.year, view.month + 1, 0).getDate();
  const cells = [...Array(first).fill(null), ...Array.from({ length: days }, (_, i) => i + 1)];

  const submit = (e) => {
    e.preventDefault();
    if (!date) return toast.error('Pick the date');
    if (!name.trim()) return toast.error('Give the holiday a name');
    addMut.mutate();
  };

  return (
    <div>
      <PageHeader title="Holidays" subtitle="Days nobody works. Design delivery dates skip Sundays and every holiday listed here — for all colleges." />

      <div className="grid gap-5 lg:grid-cols-3">
        <Card className="p-5 lg:col-span-2">
          <div className="mb-4 flex items-center justify-between">
            <h3 className="text-lg font-bold text-slate-800 dark:text-white">{MONTHS[view.month]} {view.year}</h3>
            <div className="flex items-center gap-1">
              <button onClick={() => shift(-1)} aria-label="Previous month" className="rounded-lg p-2 text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800"><ChevronLeft className="h-4 w-4" /></button>
              <button onClick={() => setView({ year: now.getFullYear(), month: now.getMonth() })} className="rounded-lg px-3 py-1.5 text-xs font-semibold text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800">Today</button>
              <button onClick={() => shift(1)} aria-label="Next month" className="rounded-lg p-2 text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800"><ChevronRight className="h-4 w-4" /></button>
            </div>
          </div>
          <div className="mb-1 grid grid-cols-7 gap-1.5 text-center text-[11px] font-semibold uppercase text-slate-400">{WEEKDAYS.map((d) => <div key={d} className="py-1">{d}</div>)}</div>
          {isLoading ? <Skeleton className="h-64 w-full" /> : (
            <div className="grid grid-cols-7 gap-1.5">
              {cells.map((day, i) => {
                if (!day) return <div key={`b-${i}`} />;
                const key = `${monthKey}-${pad(day)}`;
                const h = byDate[key];
                const sunday = new Date(view.year, view.month, day).getDay() === 0;
                return (
                  <button key={key} type="button" onClick={() => canEdit && setDate(key)} title={h?.name || (sunday ? 'Sunday' : '')}
                    className={cn('flex aspect-square flex-col items-center justify-start rounded-xl border p-1.5 text-sm transition',
                      h ? 'border-rose-200 bg-rose-50 font-bold text-rose-700 dark:border-rose-500/30 dark:bg-rose-500/10 dark:text-rose-300'
                        : sunday ? 'border-transparent bg-slate-50 text-slate-400 dark:bg-slate-800/40' : 'border-transparent text-slate-600 dark:text-slate-300',
                      date === key && 'ring-2 ring-brand-500', canEdit && 'hover:border-brand-300')}>
                    <span>{day}</span>
                    {h && <span className="mt-0.5 line-clamp-2 text-center text-[9px] font-semibold leading-tight">{h.name}</span>}
                  </button>
                );
              })}
            </div>
          )}
          <div className="mt-4 flex flex-wrap items-center gap-4 border-t border-slate-100 pt-3 text-xs text-slate-400 dark:border-slate-800">
            <span className="flex items-center gap-1.5"><i className="h-3 w-3 rounded bg-rose-200" /> Holiday</span>
            <span className="flex items-center gap-1.5"><i className="h-3 w-3 rounded bg-slate-200" /> Sunday (always off)</span>
            <span>Monday to Saturday are working days.</span>
          </div>
        </Card>

        <div className="space-y-5">
          {canEdit && (
            <Card className="p-5">
              <div className="mb-3 inline-flex rounded-xl bg-slate-100 p-1 text-sm font-semibold dark:bg-slate-800">
                {[['one', 'One holiday'], ['many', 'Several at once']].map(([k, label]) => (
                  <button key={k} type="button" onClick={() => setMode(k)}
                    className={cn('rounded-lg px-3 py-1.5 transition-colors', mode === k ? 'bg-white text-brand-600 shadow-sm dark:bg-slate-900 dark:text-brand-400' : 'text-slate-500')}>{label}</button>
                ))}
              </div>
              {mode === 'one' ? (
                <>
                  <form onSubmit={submit} className="space-y-3">
                    <Input label="Date" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
                    <Input label="Name" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Diwali" />
                    <Button type="submit" loading={addMut.isPending} className="w-full"><Plus className="h-4 w-4" /> Add holiday</Button>
                  </form>
                  <p className="mt-2 text-xs text-slate-400">Tip: click a day on the calendar to fill in the date.</p>
                </>
              ) : (
                <form onSubmit={submitMany} className="space-y-4">
                  <label className="block">
                    <span className="mb-1.5 block text-sm font-medium text-slate-600 dark:text-slate-300">Paste a list — one holiday per line</span>
                    <textarea className="input-base min-h-[130px] font-mono text-xs" value={bulkText} onChange={(e) => setBulkText(e.target.value)}
                      placeholder={'2026-11-01, Kannada Rajyotsava\n12-11-2026, Diwali\n25/12/2026 Christmas'} />
                    <span className="mt-1 block text-xs text-slate-400">Date first, then the name. 2026-11-01, 01-11-2026 and 01/11/2026 all work. You can paste straight from Excel.</span>
                  </label>
                  {parsed.length > 0 && (
                    <ul className="max-h-40 space-y-1 overflow-auto rounded-xl border border-slate-100 p-2 text-xs dark:border-slate-800">
                      {parsed.map((p, i) => (
                        <li key={i} className={cn('flex items-start justify-between gap-2 rounded-lg px-2 py-1', p.error ? 'bg-rose-50 text-rose-700 dark:bg-rose-500/10 dark:text-rose-300' : 'text-slate-600 dark:text-slate-300')}>
                          <span className="truncate">{p.error ? p.raw : `${p.date} · ${p.name}`}</span>
                          {p.error && <span className="shrink-0 font-semibold">{p.error}</span>}
                        </li>
                      ))}
                    </ul>
                  )}
                  <div className="rounded-xl border border-dashed border-slate-200 p-3 dark:border-slate-700">
                    <p className="mb-2 text-sm font-medium text-slate-600 dark:text-slate-300">Or a run of days <span className="font-normal text-slate-400">· e.g. Dasara break</span></p>
                    <div className="grid grid-cols-2 gap-2">
                      <Input label="From" type="date" value={rangeFrom} onChange={(e) => setRangeFrom(e.target.value)} />
                      <Input label="To" type="date" min={rangeFrom || undefined} value={rangeTo} onChange={(e) => setRangeTo(e.target.value)} />
                    </div>
                    <Input className="mt-2" label="Name" value={rangeName} onChange={(e) => setRangeName(e.target.value)} placeholder="e.g. Dasara holidays" />
                    {rangeKeys.length > 0 && rangeName.trim() && <p className="mt-1 text-xs text-slate-400">{rangeKeys.length} day{rangeKeys.length > 1 ? 's' : ''} will be marked.</p>}
                  </div>
                  <Button type="submit" loading={bulkMut.isPending} className="w-full" disabled={!rows.length || problems.length > 0}>
                    <ListPlus className="h-4 w-4" /> Add {rows.length || ''} holiday{rows.length === 1 ? '' : 's'}
                  </Button>
                  <p className="text-xs text-slate-400">A date already on the list just gets its name updated.</p>
                </form>
              )}
            </Card>
          )}
          <Card className="p-5">
            <h3 className="mb-3 font-bold text-slate-800 dark:text-white">{MONTHS[view.month]} holidays</h3>
            {holidays.length === 0 ? (
              <EmptyState icon={CalendarOff} title="None this month" description="Every Monday to Saturday counts as a working day." />
            ) : (
              <ul className="space-y-2">
                {holidays.map((h) => (
                  <li key={h._id} className="flex items-center justify-between gap-2 rounded-xl border border-slate-100 px-3 py-2 text-sm dark:border-slate-800">
                    <div>
                      <p className="font-semibold text-slate-700 dark:text-slate-200">{h.name}</p>
                      <p className="text-xs text-slate-400">{new Date(`${h.date}T00:00:00`).toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long' })}</p>
                    </div>
                    {canEdit && (
                      <button onClick={() => { if (window.confirm(`Remove ${h.name}?`)) delMut.mutate(h._id); }} aria-label={`Remove ${h.name}`}
                        className="rounded-lg p-1.5 text-slate-400 hover:bg-rose-50 hover:text-rose-600"><Trash2 className="h-4 w-4" /></button>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>
      </div>
    </div>
  );
}
