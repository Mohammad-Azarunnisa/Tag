import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { useNavigate } from 'react-router-dom';
import { ChevronLeft, ChevronRight, CalendarDays, X, StickyNote, Plus, Pencil, Trash2 } from 'lucide-react';
import { calendarApi, organizationApi } from '../api/endpoints.js';
import PageHeader from '../components/layout/PageHeader.jsx';
import { Card, Badge, Avatar, Skeleton, EmptyState, Input, Select } from '../components/ui/primitives.jsx';
import { Button } from '../components/ui/Button.jsx';
import { useAuthStore } from '../store/authStore.js';
import { cn, useSessionState } from '../lib/utils.js';

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const PLATFORM_COLOR = { LinkedIn: '#0A66C2', Instagram: '#E1306C', YouTube: '#FF0000', Facebook: '#1877F2' };
const pad = (n) => String(n).padStart(2, '0');

export default function Calendar() {
  const { user } = useAuthStore();
  // A designer's calendar is their approved designs, not the posting schedule.
  const designs = user?.role === 'USER' && user?.userType === 'DESIGNER';
  const today = new Date();
  const [view, setView] = useSessionState('calendar-view', { year: today.getFullYear(), month: today.getMonth() });
  const [selected, setSelected] = useSessionState('calendar-selected', null);

  const monthStr = `${view.year}-${pad(view.month + 1)}`;
  const { data: monthData, isLoading } = useQuery({ queryKey: ['calendar', monthStr], queryFn: () => calendarApi.month(monthStr) });
  const counts = (monthData?.days || []).reduce((acc, d) => { acc[d.date] = d; return acc; }, {});

  const firstWeekday = new Date(view.year, view.month, 1).getDay();
  const daysInMonth = new Date(view.year, view.month + 1, 0).getDate();
  const cells = [...Array(firstWeekday).fill(null), ...Array.from({ length: daysInMonth }, (_, i) => i + 1)];
  const todayStr = `${today.getFullYear()}-${pad(today.getMonth() + 1)}-${pad(today.getDate())}`;

  const shiftMonth = (delta) => {
    setSelected(null);
    setView((v) => { const d = new Date(v.year, v.month + delta, 1); return { year: d.getFullYear(), month: d.getMonth() }; });
  };

  return (
    <div>
      <PageHeader title={designs ? 'Design Calendar' : 'Posting Calendar'} subtitle={designs ? 'Every design of yours that has been approved, on the day it was approved.' : 'A day-by-day view of your published content.'} />
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

          {isLoading ? <Skeleton className="h-72 w-full" /> : (
            <div className="grid grid-cols-7 gap-1.5">
              {cells.map((day, i) => {
                if (!day) return <div key={`b-${i}`} />;
                const dateStr = `${view.year}-${pad(view.month + 1)}-${pad(day)}`;
                const info = counts[dateStr];
                const has = !!info?.count;
                const hasNotes = !!info?.notes;
                const isToday = dateStr === todayStr;
                const isSel = dateStr === selected;
                return (
                  <button key={dateStr} onClick={() => (has || designs) && setSelected(dateStr)}
                    className={cn('relative flex aspect-square flex-col items-center justify-start rounded-xl border p-1.5 text-sm transition',
                      has ? 'cursor-pointer border-brand-200 dark:border-brand-500/30 bg-brand-50/60 dark:bg-brand-500/10 hover:border-brand-400' : 'border-transparent',
                      designs && !has && 'cursor-pointer hover:border-slate-200 dark:hover:border-slate-700',
                      !has && 'text-slate-400', isSel && 'ring-2 ring-brand-500', isToday && 'font-extrabold text-brand-600')}>
                    <span>{day}</span>
                    {has && <span className="mt-1 inline-flex items-center justify-center rounded-full bg-brand-600 px-1.5 text-[10px] font-bold text-white">{info.count}</span>}
                    {hasNotes && <span title="Your notes" className="mt-1 inline-flex items-center gap-0.5 rounded-md border border-dashed border-violet-300 bg-violet-50 px-1 text-[10px] font-bold text-violet-700 dark:border-violet-500/40 dark:bg-violet-500/10 dark:text-violet-300"><StickyNote className="h-2.5 w-2.5" />{info.notes}</span>}
                    {has && !designs && <span className="absolute bottom-1 flex gap-0.5">{info.platforms?.slice(0, 4).map((p) => <span key={p} className="h-1.5 w-1.5 rounded-full" style={{ background: PLATFORM_COLOR[p] || '#94a3b8' }} />)}</span>}
                  </button>
                );
              })}
            </div>
          )}

          <div className="mt-4 flex items-center gap-4 border-t border-slate-100 dark:border-slate-800 pt-3 text-xs text-slate-400">
            <span>Total this month: <b className="text-slate-600 dark:text-slate-300">{monthData?.total || 0}</b> {designs ? 'designs approved' : 'posts'}</span>
            {designs && <span className="inline-flex items-center gap-1"><StickyNote className="h-3.5 w-3.5 text-violet-500" /> Your notes: <b className="text-slate-600 dark:text-slate-300">{monthData?.notesTotal || 0}</b></span>}
            {!designs && (
              <div className="ml-auto flex items-center gap-3">
                {Object.entries(PLATFORM_COLOR).map(([p, c]) => <span key={p} className="flex items-center gap-1"><span className="h-2 w-2 rounded-full" style={{ background: c }} />{p}</span>)}
              </div>
            )}
          </div>
        </Card>

        <DayPanel date={selected} designs={designs} onClose={() => setSelected(null)} />
      </div>
    </div>
  );
}

function DayPanel({ date, designs: designMode, onClose }) {
  const navigate = useNavigate();
  const { data, isLoading } = useQuery({ queryKey: ['calendar-day', date], queryFn: () => calendarApi.day(date), enabled: !!date });
  const posts = data?.posts || [];
  const designList = data?.designs || [];
  const noteList = data?.notes || [];

  if (!date) {
    return <Card className="p-5"><EmptyState icon={CalendarDays} title="Select a date" description={designMode ? 'Click any day to see the designs approved that day, or to add a note.' : 'Click a highlighted day to see what was posted.'} /></Card>;
  }
  const pretty = new Date(`${date}T00:00:00`).toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });

  return (
    <Card className="p-5">
      <div className="mb-4 flex items-start justify-between">
        <div><p className="text-xs font-semibold uppercase text-slate-400">{designMode ? 'Designs approved on' : 'Posts on'}</p><h3 className="font-bold text-slate-800 dark:text-white">{pretty}</h3></div>
        <button onClick={onClose} className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800"><X className="h-4 w-4" /></button>
      </div>
      {isLoading ? (
        <div className="space-y-2">{Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-16" />)}</div>
      ) : designMode ? (
        <div className="space-y-5">
        {designList.length === 0 ? (
          <p className="text-sm text-slate-400">No designs were approved on this day.</p>
        ) : (
          <div className="space-y-3">
            <p className="text-sm font-semibold text-slate-600 dark:text-slate-300">{designList.length} design{designList.length > 1 ? 's' : ''}</p>
            {designList.map((d) => (
              <button key={d._id} onClick={() => navigate(`/workflow/${d._id}`)} className="flex w-full gap-3 rounded-xl border border-slate-100 p-2.5 text-left hover:border-brand-300 dark:border-slate-800">
                {d.cover ? <img src={d.cover} alt="" className="h-12 w-12 shrink-0 rounded-lg object-cover" /> : <div className="h-12 w-12 shrink-0 rounded-lg bg-slate-100 dark:bg-slate-800" />}
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold text-slate-700 dark:text-slate-200">{d.title}</p>
                  <div className="mt-1 flex flex-wrap items-center gap-2">
                    <Badge>{d.organization?.name || 'College'}</Badge>
                    <span className="text-xs text-slate-400">{[d.workItem || d.workCategory, d.raisedBy?.name && `for ${d.raisedBy.name}`].filter(Boolean).join(' · ')}</span>
                  </div>
                </div>
              </button>
            ))}
          </div>
        )}
        <NotesBlock date={date} notes={noteList} />
        </div>
      ) : posts.length === 0 ? (
        <p className="text-sm text-slate-400">No posts on this day.</p>
      ) : (
        <div className="space-y-3">
          <p className="text-sm font-semibold text-slate-600 dark:text-slate-300">{posts.length} post{posts.length > 1 ? 's' : ''}</p>
          {posts.map((p) => (
            <button key={p._id} onClick={() => navigate(`/approvals/${p._id}`)} className="flex w-full gap-3 rounded-xl border border-slate-100 dark:border-slate-800 p-2.5 text-left hover:border-brand-300">
              {p.cover ? <img src={p.cover} alt="" className="h-12 w-12 shrink-0 rounded-lg object-cover" /> : <div className="h-12 w-12 shrink-0 rounded-lg bg-slate-100 dark:bg-slate-800" />}
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-semibold text-slate-700 dark:text-slate-200">{p.title}</p>
                <div className="mt-1 flex items-center gap-2">
                  <Badge>{p.platform}</Badge>
                  <span className="flex items-center gap-1 text-xs text-slate-400"><Avatar src={p.createdBy?.avatar} name={p.createdBy?.name} size="sm" className="!h-4 !w-4 !text-[8px]" /> {p.createdBy?.name}</span>
                </div>
              </div>
            </button>
          ))}
        </div>
      )}
    </Card>
  );
}

// The designer's own notes for a day — work done outside t@g. Deliberately unlike
// an approved design: dashed violet, a note icon, and "added by you" rather than
// anything an approver signed off.
function NotesBlock({ date, notes }) {
  const qc = useQueryClient();
  const [editing, setEditing] = useState(null); // null | 'new' | note
  const [form, setForm] = useState({ title: '', details: '', organization: '' });
  const { data: orgData } = useQuery({ queryKey: ['organization-options'], queryFn: () => organizationApi.options(), enabled: !!editing });
  const orgs = orgData?.organizations || [];

  const refresh = () => { qc.invalidateQueries({ queryKey: ['calendar-day', date] }); qc.invalidateQueries({ queryKey: ['calendar'] }); };
  const open = (note) => {
    setEditing(note || 'new');
    setForm({ title: note?.title || '', details: note?.details || '', organization: note?.organization?._id || '' });
  };
  const saveMut = useMutation({
    mutationFn: () => {
      const body = { title: form.title.trim(), details: form.details, organization: form.organization || undefined };
      return editing === 'new' ? calendarApi.addNote({ ...body, date }) : calendarApi.updateNote(editing._id, body);
    },
    onSuccess: () => { toast.success('Note saved'); setEditing(null); refresh(); },
    onError: (e) => toast.error(e.response?.data?.message || 'Could not save that'),
  });
  const delMut = useMutation({
    mutationFn: (id) => calendarApi.removeNote(id),
    onSuccess: () => { toast.success('Note removed'); refresh(); },
    onError: (e) => toast.error(e.response?.data?.message || 'Could not remove that'),
  });

  return (
    <div className="rounded-2xl border border-dashed border-violet-300 bg-violet-50/50 p-3.5 dark:border-violet-500/40 dark:bg-violet-500/5">
      <div className="mb-2 flex items-center justify-between">
        <p className="flex items-center gap-1.5 text-sm font-bold text-violet-800 dark:text-violet-300"><StickyNote className="h-4 w-4" /> Your notes</p>
        {!editing && <Button size="sm" variant="outline" onClick={() => open(null)}><Plus className="h-4 w-4" /> Add a note</Button>}
      </div>
      <p className="mb-2 text-xs text-violet-700/80 dark:text-violet-300/70">Work done outside t@g. Only you see these, and no one has approved them here.</p>

      {notes.length === 0 && !editing && <p className="text-sm text-slate-400">Nothing noted for this day.</p>}
      <div className="space-y-2">
        {notes.map((n) => (
          <div key={n._id} className="rounded-xl border border-dashed border-violet-200 bg-white p-2.5 dark:border-violet-500/30 dark:bg-slate-900/60">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="text-sm font-semibold text-slate-700 dark:text-slate-200">{n.title}</p>
                {n.organization?.name && <span className="mt-0.5 inline-block rounded-full bg-violet-100 px-2 py-0.5 text-[10px] font-bold text-violet-700 dark:bg-violet-500/15 dark:text-violet-300">{n.organization.name}</span>}
                {n.details && <p className="mt-1 whitespace-pre-wrap text-xs text-slate-500 dark:text-slate-400">{n.details}</p>}
                <p className="mt-1 text-[10px] font-semibold uppercase tracking-wide text-slate-300">Added by you · not an approved design</p>
              </div>
              <div className="flex shrink-0 gap-1">
                <button onClick={() => open(n)} aria-label="Edit note" className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800"><Pencil className="h-3.5 w-3.5" /></button>
                <button onClick={() => { if (window.confirm('Remove this note?')) delMut.mutate(n._id); }} aria-label="Remove note" className="rounded-lg p-1.5 text-slate-400 hover:bg-rose-50 hover:text-rose-600"><Trash2 className="h-3.5 w-3.5" /></button>
              </div>
            </div>
          </div>
        ))}
      </div>

      {editing && (
        <form className="mt-3 space-y-2.5" onSubmit={(e) => { e.preventDefault(); if (!form.title.trim()) return toast.error('Give the note a title'); saveMut.mutate(); }}>
          <Input label="What did you work on?" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder="e.g. Printed banner for the principal's office" />
          <label className="block">
            <span className="mb-1.5 block text-sm font-medium text-slate-600 dark:text-slate-300">Details <span className="font-normal text-slate-400">· optional</span></span>
            <textarea className="input-base min-h-[70px]" value={form.details} onChange={(e) => setForm({ ...form, details: e.target.value })} />
          </label>
          <Select label="College (optional)" value={form.organization} onChange={(e) => setForm({ ...form, organization: e.target.value })}>
            <option value="">Not specific to one college</option>
            {orgs.map((o) => <option key={o._id} value={o._id}>{o.name}</option>)}
          </Select>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" size="sm" onClick={() => setEditing(null)}>Cancel</Button>
            <Button type="submit" size="sm" loading={saveMut.isPending}>Save note</Button>
          </div>
        </form>
      )}
    </div>
  );
}
