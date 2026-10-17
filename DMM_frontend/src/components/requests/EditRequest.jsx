import { useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { Clock3, CheckCircle2, XCircle } from 'lucide-react';
import { workflowApi, holidayApi } from '../../api/endpoints.js';
import { Modal } from '../ui/Modal.jsx';
import { Button } from '../ui/Button.jsx';
import { Input, Select, Textarea } from '../ui/primitives.jsx';
import DateCalendarPicker from '../ui/DateCalendarPicker.jsx';
import { cn, formatDate, timeAgo } from '../../lib/utils.js';

const PRIORITIES = [['LOW', 'Low'], ['NORMAL', 'Normal'], ['HIGH', 'High'], ['URGENT', 'Urgent']];
const dayKey = (d) => (d ? new Date(d).toISOString().slice(0, 10) : '');
const isSunday = (key) => new Date(`${key}T00:00:00Z`).getUTCDay() === 0;
const FIELD_LABELS = {
  title: 'Title', details: 'Notes', department: 'Department', priority: 'Priority', neededBy: 'Needed by',
  eventName: 'Event name', eventDate: 'Event date', place: 'Place', eventCoordinatorName: 'Event coordinator',
};
export const describeChange = (key, value) => {
  if (key === 'neededBy' || key === 'eventDate') return formatDate(value);
  if (key === 'priority') return String(value).charAt(0) + String(value).slice(1).toLowerCase();
  return String(value) || '—';
};

/**
 * Ask an Admin to let you change a request that no designer has picked up yet.
 * Nothing changes until they approve; until they decide, nobody can pick it up.
 */
export function EditRequestModal({ request: r, onClose, onSent }) {
  const [form, setForm] = useState({
    title: r.title || '', details: r.details || '', department: r.department || '', priority: r.priority || 'NORMAL',
    neededBy: dayKey(r.neededBy), eventName: r.eventName || '', eventDate: dayKey(r.eventDate),
    place: r.place || '', eventCoordinatorName: r.eventCoordinatorName || '',
  });
  const [reason, setReason] = useState('');

  const todayKey = new Date().toISOString().slice(0, 10);
  const { data: holidayData } = useQuery({
    queryKey: ['holidays-range', todayKey],
    queryFn: () => holidayApi.list({ from: todayKey, to: new Date(Date.now() + 400 * 86400000).toISOString().slice(0, 10) }),
    staleTime: 600000,
  });
  const holidays = holidayData?.holidays || [];
  const earliest = r.earliestDeliveryAt ? dayKey(r.earliestDeliveryAt) : null;
  const blockedReason = (key) => {
    if (isSunday(key)) return 'Sunday';
    const h = holidays.find((x) => x.date === key);
    if (h) return h.name || 'Holiday';
    if (earliest && key < earliest) return 'Too soon for this request';
    return null;
  };

  const mut = useMutation({
    mutationFn: () => {
      const changes = {
        title: form.title, details: form.details, department: form.department, priority: form.priority,
        // older requests were raised before a date was required; only send one if there is one
        ...(form.neededBy ? { neededBy: form.neededBy } : {}),
        ...(r.event ? { eventName: form.eventName, eventDate: form.eventDate, place: form.place, eventCoordinatorName: form.eventCoordinatorName } : {}),
      };
      return workflowApi.requestEdit(r._id, { reason, changes });
    },
    onSuccess: () => { toast.success('Sent to the admin — nobody can pick this up until they decide'); onSent?.(); },
    onError: (e) => toast.error(e.response?.data?.message || 'Could not send that'),
  });

  const submit = (e) => {
    e.preventDefault();
    if (!form.title.trim()) return toast.error('The title cannot be empty');
    if (!form.department.trim()) return toast.error('The department cannot be empty');
    if (!form.neededBy && r.neededBy) return toast.error('Choose the date you need this by');
    if (reason.trim().length < 3) return toast.error('Say why you want to change this');
    mut.mutate();
    return undefined;
  };
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  return (
    <Modal open onClose={onClose} title="Ask to change this request" size="lg">
      <form onSubmit={submit} className="space-y-4">
        <p className="rounded-xl bg-amber-50 p-3 text-sm text-amber-800 dark:bg-amber-500/10 dark:text-amber-300">
          Your change goes to the Admin first. Until they approve or reject it, no designer can pick this request up.
        </p>
        <div className="grid gap-3 sm:grid-cols-2">
          <Input label="Title" value={form.title} onChange={set('title')} />
          <Input label="Department" value={form.department} onChange={set('department')} />
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <DateCalendarPicker label="Needed by" value={form.neededBy} blockedReason={blockedReason}
            onChange={(key) => setForm((f) => ({ ...f, neededBy: key }))} />
          <Select label="Priority" value={form.priority} onChange={set('priority')}>
            {PRIORITIES.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
          </Select>
        </div>
        {r.event && (
          <div className="grid gap-3 rounded-xl border border-slate-200 p-3 dark:border-slate-700 sm:grid-cols-2">
            <Input label="Event name" value={form.eventName} onChange={set('eventName')} />
            <Input label="Event date" type="date" value={form.eventDate} onChange={set('eventDate')} />
            <Input label="Place" value={form.place} onChange={set('place')} />
            <Input label="Event coordinator" value={form.eventCoordinatorName} onChange={set('eventCoordinatorName')} />
          </div>
        )}
        <Textarea label="Notes for the designer" maxLength={400} value={form.details} onChange={set('details')} />
        <Textarea label="Why do you want to change it? (the Admin will read this)" className="min-h-[72px]" value={reason}
          onChange={(e) => setReason(e.target.value)} placeholder="e.g. The department name was wrong" />
        <div className="flex justify-end gap-2 border-t border-slate-100 pt-4 dark:border-slate-800">
          <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
          <Button type="submit" loading={mut.isPending}>Send to the admin</Button>
        </div>
      </form>
    </Modal>
  );
}

/** Where a change stands: waiting, approved or rejected. */
export function EditStatusBanner({ request: r, onTakeBack, taking }) {
  const e = r.editRequest;
  if (!e?.status) return null;
  const changed = Object.entries(e.changes || {});
  const tone = {
    PENDING: 'border-amber-200 bg-amber-50/70 text-amber-900 dark:border-amber-500/25 dark:bg-amber-500/[0.07] dark:text-amber-200',
    APPROVED: 'border-emerald-200 bg-emerald-50/70 text-emerald-900 dark:border-emerald-500/25 dark:bg-emerald-500/[0.07] dark:text-emerald-200',
    REJECTED: 'border-rose-200 bg-rose-50/70 text-rose-900 dark:border-rose-500/25 dark:bg-rose-500/[0.07] dark:text-rose-200',
  }[e.status];
  const Icon = { PENDING: Clock3, APPROVED: CheckCircle2, REJECTED: XCircle }[e.status];
  const title = {
    PENDING: 'Your change is waiting for an Admin — no designer can pick this up until they decide',
    APPROVED: 'Your change was approved and applied',
    REJECTED: 'Your change was rejected — the request stays as it was',
  }[e.status];
  return (
    <div className={cn('rounded-xl border p-3 text-sm', tone)}>
      <p className="flex items-center gap-2 font-semibold"><Icon className="h-4 w-4 shrink-0" /> {title}</p>
      {e.reason && <p className="mt-1.5 text-xs opacity-80">You said: {e.reason}</p>}
      {e.status === 'PENDING' && changed.length > 0 && (
        <ul className="mt-2 space-y-0.5 text-xs">
          {changed.map(([k, v]) => <li key={k}><b>{FIELD_LABELS[k] || k}:</b> {describeChange(k, v)}</li>)}
        </ul>
      )}
      {e.status !== 'PENDING' && e.decisionNote && <p className="mt-1.5 text-xs"><b>Admin:</b> {e.decisionNote}{e.decidedAt ? ` · ${timeAgo(e.decidedAt)}` : ''}</p>}
      {e.status === 'PENDING' && onTakeBack && (
        <button type="button" disabled={taking} onClick={onTakeBack}
          className="mt-2 text-xs font-semibold underline underline-offset-2 disabled:opacity-50">Take my change back</button>
      )}
    </div>
  );
}
