import { useEffect, useMemo, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { ChevronLeft, ChevronRight, CalendarDays, X, Camera, Ban, CheckCircle2, NotebookPen } from 'lucide-react';
import { photographerApi, organizationApi } from '../api/endpoints.js';
import { useAuthStore } from '../store/authStore.js';
import PageHeader from '../components/layout/PageHeader.jsx';
import { Modal } from '../components/ui/Modal.jsx';
import { Button } from '../components/ui/Button.jsx';
import { Card, Badge, Select, Input, Skeleton, EmptyState } from '../components/ui/primitives.jsx';
import { cn, useSessionState, isCoordinatorUser, isPhotographerUser, photographerSlotLabel } from '../lib/utils.js';

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const SLOTS = ['MORNING', 'AFTERNOON', 'EVENING', 'FULL_DAY'];
const pad = (n) => String(n).padStart(2, '0');
const dateKey = (y, m, d) => `${y}-${pad(m + 1)}-${pad(d)}`;

// A FULL_DAY booking blocks the other three, and any of the other three
// blocks FULL_DAY — mirrors photographerController.js#conflictsWith exactly,
// so the UI never offers a slot the server would refuse anyway.
const blockedBy = (bookedSlots, slot) => bookedSlots.some((s) => s === 'FULL_DAY' || slot === 'FULL_DAY' || s === slot);

export default function Photographers() {
  const { user } = useAuthStore();
  const isCoordinator = isCoordinatorUser(user);
  const isPhotographer = isPhotographerUser(user);
  // Booking stays a coordinator's (here) or an admin's (console) call — a
  // photographer updates their own day-to-day plan instead (see canEditPlan
  // below), and everyone else is just looking, not booking.
  const canBook = isCoordinator;
  const qc = useQueryClient();
  const today = new Date();

  const { data: todayData } = useQuery({ queryKey: ['photographer-today'], queryFn: () => photographerApi.today() });
  const todayStatuses = (todayData?.photographers || []).filter((p) => p.note?.trim());

  const [view, setView] = useSessionState('photographer-calendar-view', { year: today.getFullYear(), month: today.getMonth() });
  const [selectedDate, setSelectedDate] = useSessionState('photographer-calendar-selected', null);
  const [photographerId, setPhotographerId] = useSessionState('photographer-calendar-who', isPhotographer ? user._id : '');
  const [bookSlot, setBookSlot] = useState(null); // { date, slot }

  const { data: peopleData, isLoading: peopleLoading } = useQuery({
    queryKey: ['photographers'],
    queryFn: () => photographerApi.list(),
  });
  const photographers = peopleData?.photographers || [];

  // Default to the first available photographer once the list loads, unless
  // this viewer already has an obvious one of their own (themselves).
  useEffect(() => {
    if (!photographerId && photographers.length) setPhotographerId(photographers[0]._id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [photographers.length]);

  const monthStart = dateKey(view.year, view.month, 1);
  const daysInMonth = new Date(view.year, view.month + 1, 0).getDate();
  const monthEnd = dateKey(view.year, view.month, daysInMonth);

  const { data: slotsData, isLoading: slotsLoading } = useQuery({
    queryKey: ['photographer-slots', monthStart, monthEnd, photographerId],
    queryFn: () => photographerApi.slots({ from: monthStart, to: monthEnd, photographerId }),
    enabled: !!photographerId,
  });
  const slots = slotsData?.slots || [];
  const slotsByDate = useMemo(() => {
    const map = {};
    for (const s of slots) (map[s.date] ||= []).push(s);
    return map;
  }, [slots]);

  const viewingOwnCalendar = isPhotographer && photographerId === user._id;
  const { data: plansData } = useQuery({
    queryKey: ['photographer-plans', monthStart, monthEnd, photographerId],
    queryFn: () => photographerApi.plans(photographerId, { from: monthStart, to: monthEnd }),
    enabled: viewingOwnCalendar,
  });
  const plansByDate = useMemo(() => {
    const map = {};
    for (const p of (plansData?.plans || [])) map[p.date] = p.note;
    return map;
  }, [plansData]);

  const firstWeekday = new Date(view.year, view.month, 1).getDay();
  const cells = [...Array(firstWeekday).fill(null), ...Array.from({ length: daysInMonth }, (_, i) => i + 1)];
  const todayStr = dateKey(today.getFullYear(), today.getMonth(), today.getDate());

  const shiftMonth = (delta) => {
    setSelectedDate(null);
    setView((v) => { const d = new Date(v.year, v.month + delta, 1); return { year: d.getFullYear(), month: d.getMonth() }; });
  };

  const cancelMut = useMutation({
    mutationFn: (id) => photographerApi.cancelSlot(id),
    onSuccess: () => { toast.success('Booking cancelled'); qc.invalidateQueries({ queryKey: ['photographer-slots'] }); },
    onError: (e) => toast.error(e.response?.data?.message || 'Could not cancel that'),
  });

  const selectedPhotographer = photographers.find((p) => p._id === photographerId);

  return (
    <div>
      <PageHeader
        title="Photographers"
        subtitle={isPhotographer
          ? 'Your bookings, your plan for the day, and the work you post.'
          : canBook
            ? 'See who is free and book a photographer for your college.'
            : 'See who is free and what each photographer has planned.'}
      />

      {todayStatuses.length > 0 && (
        <Card className="mb-5 p-4">
          <p className="mb-2.5 flex items-center gap-1.5 text-xs font-bold uppercase tracking-wide text-slate-400">
            <NotebookPen className="h-3.5 w-3.5" /> On today
          </p>
          <div className="space-y-2">
            {todayStatuses.map((p) => (
              <div key={p._id} className="flex items-start gap-2.5 text-sm">
                <span className="font-semibold text-slate-700 dark:text-slate-200">{p.name}:</span>
                <span className="min-w-0 flex-1 text-slate-600 dark:text-slate-300">{p.note}</span>
              </div>
            ))}
          </div>
        </Card>
      )}

      <div className="mb-5 grid gap-3 sm:grid-cols-2 sm:max-w-md">
        <Select label="Photographer" value={photographerId} onChange={(e) => { setPhotographerId(e.target.value); setSelectedDate(null); }}>
          {peopleLoading && <option>Loading…</option>}
          {!peopleLoading && photographers.length === 0 && <option value="">No photographers yet</option>}
          {photographers.map((p) => (
            <option key={p._id} value={p._id}>{p.name}{p._id === user?._id ? ' (you)' : ''}</option>
          ))}
        </Select>
      </div>

      {!peopleLoading && photographers.length === 0 ? (
        <EmptyState icon={Camera} title="No photographers yet" description="Ask the super admin to add a Photographer account before you can book one." />
      ) : (
        <div className="grid gap-5 lg:grid-cols-3">
          <Card className="p-5 lg:col-span-2">
            <div className="mb-4 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <CalendarDays className="h-5 w-5 text-brand-600" />
                <h3 className="text-lg font-bold text-slate-800 dark:text-white">{MONTHS[view.month]} {view.year}</h3>
              </div>
              <div className="flex items-center gap-1">
                <button onClick={() => shiftMonth(-1)} className="rounded-lg p-2 text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800"><ChevronLeft className="h-4 w-4" /></button>
                <button onClick={() => { setSelectedDate(null); setView({ year: today.getFullYear(), month: today.getMonth() }); }} className="rounded-lg px-3 py-1.5 text-xs font-semibold text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800">Today</button>
                <button onClick={() => shiftMonth(1)} className="rounded-lg p-2 text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800"><ChevronRight className="h-4 w-4" /></button>
              </div>
            </div>

            <div className="mb-1 grid grid-cols-7 gap-1.5 text-center text-[11px] font-semibold uppercase text-slate-400">
              {WEEKDAYS.map((d) => <div key={d} className="py-1">{d}</div>)}
            </div>

            {slotsLoading ? <Skeleton className="h-72 w-full" /> : (
              <div className="grid grid-cols-7 gap-1.5">
                {cells.map((day, i) => {
                  if (!day) return <div key={`b-${i}`} />;
                  const dStr = dateKey(view.year, view.month, day);
                  const dayBookings = slotsByDate[dStr] || [];
                  const bookedSlots = dayBookings.map((b) => b.slot);
                  const fullDay = bookedSlots.includes('FULL_DAY');
                  const hasPlan = !!plansByDate[dStr];
                  const isToday = dStr === todayStr;
                  const isSel = dStr === selectedDate;
                  return (
                    <button key={dStr} onClick={() => setSelectedDate(dStr)}
                      className={cn('relative flex aspect-square flex-col items-center justify-start rounded-xl border p-1.5 text-sm transition',
                        fullDay ? 'border-rose-200 bg-rose-50/70 dark:border-rose-500/30 dark:bg-rose-500/10'
                          : bookedSlots.length ? 'border-amber-200 bg-amber-50/60 dark:border-amber-500/20 dark:bg-amber-500/10'
                          : 'border-transparent hover:border-slate-200 dark:hover:border-slate-700',
                        isSel && 'ring-2 ring-brand-500', isToday && 'font-extrabold text-brand-600')}>
                      <span>{day}</span>
                      <span className="mt-1 flex gap-0.5">
                        {!fullDay && SLOTS.slice(0, 3).map((s) => (
                          <span key={s} className={cn('h-1.5 w-1.5 rounded-full', bookedSlots.includes(s) ? 'bg-amber-500' : 'bg-slate-200 dark:bg-slate-700')} />
                        ))}
                        {fullDay && <span className="rounded-full bg-rose-500 px-1.5 text-[9px] font-bold text-white">Full</span>}
                      </span>
                      {hasPlan && <NotebookPen className="absolute right-1 top-1 h-3 w-3 text-sky-500" />}
                    </button>
                  );
                })}
              </div>
            )}

            <div className="mt-4 flex flex-wrap items-center gap-3 border-t border-slate-100 pt-3 text-xs text-slate-400 dark:border-slate-800">
              <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-slate-200 dark:bg-slate-700" /> Free</span>
              <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-amber-500" /> Partly booked</span>
              <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-rose-500" /> Full day</span>
              {isPhotographer && <span className="ml-auto flex items-center gap-1"><NotebookPen className="h-3 w-3 text-sky-500" /> Plan noted</span>}
            </div>
          </Card>

          <DayPanel
            date={selectedDate}
            photographer={selectedPhotographer}
            bookings={selectedDate ? (slotsByDate[selectedDate] || []) : []}
            plan={selectedDate ? plansByDate[selectedDate] : ''}
            canEditPlan={viewingOwnCalendar}
            canBook={canBook}
            canCancel={(b) => user?.isSuperAdmin || b.bookedBy?._id === user?._id || b.photographer?._id === user?._id}
            onClose={() => setSelectedDate(null)}
            onBook={(slot) => setBookSlot({ date: selectedDate, slot })}
            onCancel={(id) => cancelMut.mutate(id)}
            cancelling={cancelMut.isPending}
          />
        </div>
      )}

      {bookSlot && selectedPhotographer && (
        <BookModal
          photographer={selectedPhotographer}
          date={bookSlot.date}
          slot={bookSlot.slot}
          isCoordinator={isCoordinator}
          userOrgName={user?.organization?.name}
          onClose={() => setBookSlot(null)}
          onBooked={() => { setBookSlot(null); qc.invalidateQueries({ queryKey: ['photographer-slots'] }); }}
        />
      )}
    </div>
  );
}

function DayPanel({ date, photographer, bookings, plan, canEditPlan, canBook, canCancel, onClose, onBook, onCancel, cancelling }) {
  const qc = useQueryClient();
  const [note, setNote] = useState(plan || '');
  useEffect(() => setNote(plan || ''), [plan, date]);

  const saveMut = useMutation({
    mutationFn: () => photographerApi.savePlan(date, note),
    onSuccess: () => { toast.success('Plan saved'); qc.invalidateQueries({ queryKey: ['photographer-plans'] }); },
    onError: (e) => toast.error(e.response?.data?.message || 'Could not save that'),
  });

  if (!date) {
    return <Card className="p-5"><EmptyState icon={CalendarDays} title="Select a date" description="Click a day to see or book that photographer's slots." /></Card>;
  }
  const pretty = new Date(`${date}T00:00:00`).toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  const bookedSlots = bookings.map((b) => b.slot);

  return (
    <Card className="p-5">
      <div className="mb-4 flex items-start justify-between">
        <div><p className="text-xs font-semibold uppercase text-slate-400">{photographer?.name}</p><h3 className="font-bold text-slate-800 dark:text-white">{pretty}</h3></div>
        <button onClick={onClose} className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800"><X className="h-4 w-4" /></button>
      </div>

      <div className="space-y-2">
        {SLOTS.map((s) => {
          const booking = bookings.find((b) => b.slot === s);
          const blocked = !booking && blockedBy(bookedSlots, s);
          // Who is in the way, so "blocked" is never unexplained.
          const blocker = blocked ? bookings.find((b) => b.slot === 'FULL_DAY' || s === 'FULL_DAY') : null;
          return (
            <div key={s} className={cn('rounded-xl border p-3', booking ? 'border-rose-200 bg-rose-50/60 dark:border-rose-500/20 dark:bg-rose-500/10'
              : blocked ? 'border-slate-100 bg-slate-50 dark:border-slate-800 dark:bg-slate-900/50' : 'border-slate-100 dark:border-slate-800')}>
              <div className="flex items-center justify-between gap-3">
                <p className="text-sm font-bold text-slate-700 dark:text-slate-200">{photographerSlotLabel(s)}</p>
                {booking ? (
                  <span className="inline-flex items-center gap-1 text-xs font-bold text-rose-600 dark:text-rose-400">
                    <Ban className="h-4 w-4 shrink-0" /> Booked
                  </span>
                ) : blocked ? (
                  <span className="text-xs font-semibold text-rose-500">Not available</span>
                ) : canBook ? (
                  <Button size="sm" variant="outline" onClick={() => onBook(s)}><CheckCircle2 className="h-3.5 w-3.5" /> Book</Button>
                ) : (
                  <span className="text-xs text-emerald-600 dark:text-emerald-400">Free</span>
                )}
              </div>
              {blocker && (
                <p className="mt-1.5 text-xs text-slate-500 dark:text-slate-400">
                  {photographer?.name} is already booked for {photographerSlotLabel(blocker.slot).toLowerCase()} on this day —{' '}
                  <span className="font-semibold">{blocker.organization?.name || 'another college'}</span>, {blocker.eventName}
                  {blocker.bookedBy?.name ? ` (booked by ${blocker.bookedBy.name})` : ''}.
                </p>
              )}
              {booking && (
                <div className="mt-1.5 text-sm text-slate-600 dark:text-slate-300">
                  <p className="text-xs font-semibold text-rose-600 dark:text-rose-400">{photographer?.name} is booked {s === 'FULL_DAY' ? 'for the full day' : `in the ${photographerSlotLabel(s).toLowerCase()}`}</p>
                  <p className="mt-0.5"><span className="font-semibold">{booking.organization?.name || 'A college'}</span> · {booking.eventName}</p>
                  <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">Coordinator: {booking.bookedBy?.name || 'someone'}{booking.notes ? ` · ${booking.notes}` : ''}</p>
                  {canCancel(booking) && (
                    <button onClick={() => onCancel(booking._id)} disabled={cancelling}
                      className="mt-1.5 text-xs font-semibold text-rose-600 hover:underline disabled:opacity-50">
                      Cancel this booking
                    </button>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {canEditPlan && (
        <div className="mt-4 border-t border-slate-100 pt-4 dark:border-slate-800">
          <label className="mb-1.5 block text-sm font-medium text-slate-600 dark:text-slate-300">Your plan for this day</label>
          <textarea className="input-base min-h-[80px]" value={note} onChange={(e) => setNote(e.target.value)}
            placeholder="What are you doing today — a shoot, editing, off-site, etc." />
          <div className="mt-2 flex justify-end">
            <Button size="sm" loading={saveMut.isPending} onClick={() => saveMut.mutate()}>Save plan</Button>
          </div>
        </div>
      )}
    </Card>
  );
}

function BookModal({ photographer, date, slot, isCoordinator, userOrgName, onClose, onBooked }) {
  const [eventName, setEventName] = useState('');
  const [notes, setNotes] = useState('');
  const [organization, setOrganization] = useState('');
  const needsOrgPicker = !isCoordinator;

  const { data: orgData } = useQuery({
    queryKey: ['organization-options'],
    queryFn: () => organizationApi.options(),
    enabled: needsOrgPicker,
  });
  const orgs = orgData?.organizations || [];

  const bookMut = useMutation({
    mutationFn: () => photographerApi.book({ photographer: photographer._id, date, slot, eventName: eventName.trim(), notes, organization: organization || undefined }),
    onSuccess: () => { toast.success(`${photographer.name} booked for ${date}`); onBooked(); },
    onError: (e) => toast.error(e.response?.data?.message || 'Could not book that slot'),
  });

  const submit = (e) => {
    e.preventDefault();
    if (!eventName.trim()) { toast.error('Add the event name'); return; }
    if (needsOrgPicker && !organization) { toast.error('Choose which college this is for'); return; }
    bookMut.mutate();
  };

  return (
    <Modal open onClose={onClose} title={`Book ${photographer.name}`} size="sm">
      <form onSubmit={submit} className="space-y-4">
        <p className="rounded-xl bg-slate-50 px-3 py-2 text-sm text-slate-600 dark:bg-slate-800/60 dark:text-slate-300">
          {photographerSlotLabel(slot)} · {new Date(`${date}T00:00:00`).toLocaleDateString(undefined, { day: 'numeric', month: 'long', year: 'numeric' })}
        </p>
        {needsOrgPicker ? (
          <Select label="Which college is this for?" value={organization} onChange={(e) => setOrganization(e.target.value)}>
            <option value="">Select a college…</option>
            {orgs.map((o) => <option key={o._id} value={o._id}>{o.name}</option>)}
          </Select>
        ) : (
          <p className="text-xs text-slate-400">Booking for {userOrgName || 'your college'}.</p>
        )}
        <Input label="Event name" required value={eventName} onChange={(e) => setEventName(e.target.value)} placeholder="e.g. Freshers' Day" />
        <label className="block">
          <span className="mb-1.5 block text-sm font-medium text-slate-600 dark:text-slate-300">Notes <span className="font-normal text-slate-400">· optional</span></span>
          <textarea className="input-base min-h-[70px]" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Location, timing, anything they should know" />
        </label>
        <div className="flex justify-end gap-2 pt-2">
          <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
          <Button type="submit" loading={bookMut.isPending}>Book this slot</Button>
        </div>
      </form>
    </Modal>
  );
}
