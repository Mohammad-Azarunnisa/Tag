import { useMemo, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import {
  MessageSquarePlus, Plus, Clock3, Eye, CheckCircle2, XCircle, Trash2, Flame,
  IndianRupee, Users, FileImage, ShieldCheck, KeyRound, CircleHelp, CalendarClock,
} from 'lucide-react';
import { institutionRequestApi } from '../api/endpoints.js';
import { useAuthStore } from '../store/authStore.js';
import PageHeader from '../components/layout/PageHeader.jsx';
import { Modal } from '../components/ui/Modal.jsx';
import { Button } from '../components/ui/Button.jsx';
import { Card, Input, Select, Skeleton, EmptyState, Avatar } from '../components/ui/primitives.jsx';
import { cn, formatDate, timeAgo } from '../lib/utils.js';

const STATUS_META = {
  OPEN: { label: 'Waiting', icon: Clock3, cls: 'bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-400' },
  IN_REVIEW: { label: 'Being looked at', icon: Eye, cls: 'bg-sky-100 text-sky-700 dark:bg-sky-500/15 dark:text-sky-300' },
  APPROVED: { label: 'Approved', icon: CheckCircle2, cls: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-400' },
  DECLINED: { label: 'Declined', icon: XCircle, cls: 'bg-rose-100 text-rose-700 dark:bg-rose-500/15 dark:text-rose-400' },
};
const StatusChip = ({ status }) => {
  const m = STATUS_META[status] || STATUS_META.OPEN;
  const Icon = m.icon;
  return (
    <span className={cn('inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2.5 py-1 text-xs font-semibold', m.cls)}>
      <Icon className="h-3.5 w-3.5" /> {m.label}
    </span>
  );
};

// What the college is asking for. The icon does the explaining, so the form stays short.
const CATEGORIES = [
  { key: 'Budget', label: 'Budget', icon: IndianRupee, hint: 'Money to spend' },
  { key: 'People', label: 'People', icon: Users, hint: 'Someone\'s time' },
  { key: 'Content', label: 'Content', icon: FileImage, hint: 'Something made for us' },
  { key: 'Permission', label: 'Permission', icon: ShieldCheck, hint: 'Approval to go ahead' },
  { key: 'Access', label: 'Access', icon: KeyRound, hint: 'An account or a login' },
  { key: 'Other', label: 'Other', icon: CircleHelp, hint: 'Anything else' },
];
const categoryIcon = (key) => (CATEGORIES.find((c) => c.key === key) || CATEGORIES[5]).icon;

const PRIORITIES = [
  { key: 'LOW', label: 'Low' },
  { key: 'NORMAL', label: 'Normal' },
  { key: 'HIGH', label: 'High' },
  { key: 'URGENT', label: 'Urgent' },
];
const PRIORITY_CLS = {
  LOW: 'bg-slate-100 text-slate-500 dark:bg-slate-700/50 dark:text-slate-300',
  NORMAL: null,
  HIGH: 'bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-400',
  URGENT: 'bg-rose-100 text-rose-700 dark:bg-rose-500/15 dark:text-rose-400',
};

const PRINT_MEDIA_OPTIONS = [
  'Banners (Indoor & Outdoor)',
  'Standees',
  'Flex Designs',
  'Posters',
  'Flyers',
  'Brochures',
  'Certificates',
  'Notice Boards',
  'Invitations',
  'Event Passes',
  'Tickets',
  'Business Cards',
  'Magazine Layouts',
  'Newsletters',
  'Department Handbooks',
  'Student Diaries',
  'Signage & Direction Boards',
  'Name Boards',
  'Stage Backdrops',
  'Photo Booth Backdrops',
  'LED Screen Designs (Events)',
  'Roll-up Banners',
];

const DIGITAL_MEDIA_OPTIONS = {
  'Social Media': [
    'Social Media Posts',
    'WhatsApp Creatives',
    'Story Designs',
    'Reels Covers',
    'YouTube Thumbnails',
    'YouTube Community Posts',
  ],
  'Promotional Content': [
    'Digital Posters',
    'Digital Flyers',
    'Digital Brochures',
    'Web Banners',
    'Website Sliders/Hero Banners',
    'Email Banners',
    'Email Newsletter Designs',
  ],
  'Event Media': [
    'LED Screen Content',
    'Event Countdown Screens',
    'Digital Invitations',
    'Event Schedules',
    'Speaker Introduction Slides',
    'Sponsor Slides',
    'Welcome Screens',
    'Thank You Screens',
    'Academic Content',
    'Internship Announcements',
    'Examination Notifications',
    'Results Announcements',
    'Club Activity Promotions',
  ],
  'Marketing & Admissions': [
    'Admission Campaign Creatives',
    'Scholarship Promotions',
    'Fee Reminder Creatives',
    'Open House Promotions',
    'Campus Tour Graphics',
    'Student Achievement Posts',
    'Faculty Achievement Posts',
    'Alumni Success Stories',
    'Placement Success Creatives',
    'Ranking & Accreditation Posts',
  ],
  'Motion Graphics': [
    'Animated Social Media Posts',
    'Event Promo Videos',
    'Motion Posters',
    'LED Animations',
    'Intro & Outro Videos',
    'Lower Third Graphics',
    'GIF Animations',
  ],
};

const DEFAULT_BRIEF = {
  workType: 'PRINT_MEDIA',
  workCategory: 'Print Media',
  workItem: PRINT_MEDIA_OPTIONS[0],
  department: '',
  details: '',
  event: false,
  eventName: '',
  eventDate: '',
  place: '',
  eventCoordinatorName: '',
  priority: 'NORMAL',
  neededBy: '',
  attachments: [],
};

/**
 * What this college has asked the admin for, and what came back. Separate from
 * content approvals on purpose: that flow is about a post on its way out, this
 * one is about something the college needs in order to do the work.
 */
export default function Requests() {
  const qc = useQueryClient();
  const { user } = useAuthStore();
  const canRaise = !user?.viewOnly;

  const [status, setStatus] = useState('All');
  const [asking, setAsking] = useState(false);

  const { data, isLoading } = useQuery({
    queryKey: ['institution-requests', status],
    queryFn: () => institutionRequestApi.list({ status: status === 'All' ? undefined : status }),
  });
  const requests = data?.requests || [];
  const counts = data?.counts || {};
  const refresh = () => {
    qc.invalidateQueries({ queryKey: ['institution-requests'] });
    qc.invalidateQueries({ queryKey: ['notifications'] });
  };

  const withdrawMut = useMutation({
    mutationFn: (id) => institutionRequestApi.remove(id),
    onSuccess: () => { toast.success('Request withdrawn'); refresh(); },
    onError: (e) => toast.error(e.response?.data?.message || 'Could not withdraw that'),
  });

  const waiting = useMemo(() => (counts.OPEN || 0) + (counts.IN_REVIEW || 0), [counts]);

  return (
    <div>
      <PageHeader
        title="Requests to Admin"
        subtitle={`Ask the admin or super admin for what ${user?.organization?.name || 'your college'} needs — budget, someone's time, permission, an account. You will be notified when they decide.`}
        actions={canRaise && <Button onClick={() => setAsking(true)}><Plus className="h-4 w-4" /> New request</Button>}
      />

      <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
        {Object.entries(STATUS_META).map(([key, m]) => (
          <Card key={key} role="button" tabIndex={0}
            onClick={() => setStatus(status === key ? 'All' : key)}
            onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setStatus(status === key ? 'All' : key); } }}
            className={cn('cursor-pointer p-4 transition hover:-translate-y-0.5', status === key && 'ring-2 ring-brand-500/40')}>
            <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">{m.label}</p>
            <p className="mt-1 text-3xl font-extrabold text-slate-800 dark:text-white">{counts[key] || 0}</p>
          </Card>
        ))}
      </div>

      {waiting > 0 && status === 'All' && (
        <p className="mb-4 text-sm text-slate-500 dark:text-slate-400">
          <span className="font-bold text-slate-700 dark:text-slate-200">{waiting}</span> still waiting on a decision.
        </p>
      )}

      {isLoading ? (
        <div className="space-y-3">{Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-28" />)}</div>
      ) : requests.length === 0 ? (
        <EmptyState icon={MessageSquarePlus}
          title={status === 'All' ? 'Nothing asked for yet' : `No ${STATUS_META[status]?.label.toLowerCase()} requests`}
          description="Raise a request when you need something from the admin to get the college's work done."
          action={canRaise && status === 'All' && <Button onClick={() => setAsking(true)}><Plus className="h-4 w-4" /> New request</Button>} />
      ) : (
        <div className="space-y-3">
          {requests.map((r) => {
            const Icon = categoryIcon(r.category);
            const overdue = r.neededBy && new Date(r.neededBy) < new Date() && ['OPEN', 'IN_REVIEW'].includes(r.status);
            const canWithdraw = canRaise && r.status === 'OPEN' && String(r.raisedBy?._id) === String(user?._id);
            return (
              <Card key={r._id} className="p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="flex min-w-0 gap-3">
                    <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400">
                      <Icon className="h-4.5 w-4.5" />
                    </span>
                    <div className="min-w-0">
                      <p className="font-bold text-slate-800 dark:text-white">{r.title}</p>
                      <p className="mt-0.5 text-xs text-slate-400">
                        {r.category} · raised {timeAgo(r.createdAt)}
                        {r.raisedBy?.name ? ` by ${r.raisedBy.name}` : ''}
                      </p>
                    </div>
                  </div>
                  <div className="flex shrink-0 flex-wrap items-center gap-2">
                    {PRIORITY_CLS[r.priority] && (
                      <span className={cn('inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-bold', PRIORITY_CLS[r.priority])}>
                        {r.priority === 'URGENT' && <Flame className="h-3 w-3" />} {r.priority.charAt(0) + r.priority.slice(1).toLowerCase()}
                      </span>
                    )}
                    <StatusChip status={r.status} />
                  </div>
                </div>

                {r.details && <p className="mt-3 whitespace-pre-wrap text-sm text-slate-600 dark:text-slate-300">{r.details}</p>}

                {r.neededBy && (
                  <p className={cn('mt-2 inline-flex items-center gap-1.5 text-xs font-semibold',
                    overdue ? 'text-rose-600 dark:text-rose-400' : 'text-slate-500 dark:text-slate-400')}>
                    <CalendarClock className="h-3.5 w-3.5" />
                    Needed by {formatDate(r.neededBy)}{overdue ? ' — that date has passed' : ''}
                  </p>
                )}

                {/* The decision, once it comes */}
                {['APPROVED', 'DECLINED', 'IN_REVIEW'].includes(r.status) && (r.response || r.reviewedBy) && (
                  <div className={cn('mt-3 rounded-xl border p-3',
                    r.status === 'DECLINED'
                      ? 'border-rose-200 bg-rose-50/60 dark:border-rose-500/25 dark:bg-rose-500/[0.07]'
                      : 'border-emerald-200 bg-emerald-50/60 dark:border-emerald-500/25 dark:bg-emerald-500/[0.07]')}>
                    <div className="flex items-center gap-2">
                      <Avatar src={r.reviewedBy?.avatar} name={r.reviewedBy?.name} size="sm" />
                      <p className="text-xs font-semibold text-slate-700 dark:text-slate-200">
                        {r.reviewedBy?.name || 'Admin'}
                        <span className="font-normal text-slate-400">
                          {' · '}{r.reviewedAt ? timeAgo(r.reviewedAt) : ''}
                        </span>
                      </p>
                    </div>
                    {r.response && <p className="mt-1.5 text-sm text-slate-700 dark:text-slate-200">{r.response}</p>}
                  </div>
                )}

                {canWithdraw && (
                  <button type="button" disabled={withdrawMut.isPending}
                    onClick={() => { if (window.confirm(`Withdraw "${r.title}"?`)) withdrawMut.mutate(r._id); }}
                    className="mt-3 inline-flex items-center gap-1.5 text-xs font-semibold text-slate-400 transition-colors hover:text-rose-600 disabled:opacity-40">
                    <Trash2 className="h-3.5 w-3.5" /> Withdraw
                  </button>
                )}
              </Card>
            );
          })}
        </div>
      )}

      {asking && <AskModal onClose={() => setAsking(false)} onSaved={() => { setAsking(false); refresh(); }} />}
    </div>
  );
}

// The college is implicit — the server stamps the requester's own, so there is
// nothing to choose and nothing to get wrong.
function AskModal({ onClose, onSaved }) {
  const [form, setForm] = useState(DEFAULT_BRIEF);
  const selectedDigitalItems = DIGITAL_MEDIA_OPTIONS[form.workCategory] || DIGITAL_MEDIA_OPTIONS['Social Media'];
  const selectedDigitalItem = selectedDigitalItems.includes(form.workItem) ? form.workItem : selectedDigitalItems[0];

  const setWorkType = (workType) => {
    if (workType === 'PRINT_MEDIA') {
      setForm((current) => ({
        ...current,
        workType,
        workCategory: 'Print Media',
        workItem: PRINT_MEDIA_OPTIONS[0],
      }));
      return;
    }
    const nextCategory = Object.keys(DIGITAL_MEDIA_OPTIONS)[0];
    setForm((current) => ({
      ...current,
      workType,
      workCategory: nextCategory,
      workItem: DIGITAL_MEDIA_OPTIONS[nextCategory][0],
    }));
  };

  const setDigitalCategory = (workCategory) => {
    const nextItems = DIGITAL_MEDIA_OPTIONS[workCategory] || DIGITAL_MEDIA_OPTIONS['Social Media'];
    setForm((current) => ({
      ...current,
      workCategory,
      workItem: nextItems[0],
    }));
  };

  const mutation = useMutation({
    mutationFn: () => {
      const payload = new FormData();
      payload.append('workType', form.workType);
      payload.append('workCategory', form.workCategory);
      payload.append('workItem', form.workItem);
      payload.append('department', form.department);
      payload.append('details', form.details);
      payload.append('event', String(form.event));
      payload.append('eventName', form.eventName);
      payload.append('eventDate', form.eventDate);
      payload.append('place', form.place);
      payload.append('eventCoordinatorName', form.eventCoordinatorName);
      payload.append('category', 'Content');
      payload.append('priority', form.priority);
      if (form.neededBy) payload.append('neededBy', form.neededBy);
      form.attachments.forEach((file) => payload.append('attachments', file));
      return institutionRequestApi.create(payload);
    },
    onSuccess: () => { toast.success('Sent to the admin and super admin'); onSaved(); },
    onError: (e) => toast.error(e.response?.data?.message || 'Could not send that'),
  });

  const summary = form.workType === 'PRINT_MEDIA'
    ? `Print media · ${form.workItem}`
    : `Digital media · ${form.workCategory} · ${selectedDigitalItem}`;

  const submit = (e) => {
    e.preventDefault();
    if (!form.department.trim()) { toast.error('Add the department that needs this'); return; }
    if (form.event && (!form.eventName.trim() || !form.eventDate || !form.place.trim() || !form.eventCoordinatorName.trim())) {
      toast.error('Fill in the event details');
      return;
    }
    mutation.mutate();
  };

  return (
    <Modal open onClose={onClose} title="Ask the admin for something" size="lg">
      <form onSubmit={submit} className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-2">
          <Select label="Work type" value={form.workType} onChange={(e) => setWorkType(e.target.value)}>
            <option value="PRINT_MEDIA">Print media</option>
            <option value="DIGITAL_MEDIA">Digital media</option>
          </Select>
          {form.workType === 'PRINT_MEDIA' ? (
            <Select label="Print media option" value={form.workItem} onChange={(e) => setForm({ ...form, workCategory: 'Print Media', workItem: e.target.value })}>
              {PRINT_MEDIA_OPTIONS.map((item) => (
                <option key={item} value={item}>{item}</option>
              ))}
            </Select>
          ) : (
            <Select label="Digital category" value={form.workCategory} onChange={(e) => setDigitalCategory(e.target.value)}>
              {Object.keys(DIGITAL_MEDIA_OPTIONS).map((category) => (
                <option key={category} value={category}>{category}</option>
              ))}
            </Select>
          )}
        </div>

        {form.workType === 'DIGITAL_MEDIA' && (
          <Select label="Digital media option" value={selectedDigitalItem} onChange={(e) => setForm({ ...form, workItem: e.target.value })}>
            {selectedDigitalItems.map((item) => (
              <option key={item} value={item}>{item}</option>
            ))}
          </Select>
        )}

        <div className="grid gap-3 sm:grid-cols-2">
          <Input label="Department" value={form.department} onChange={(e) => setForm({ ...form, department: e.target.value })}
            placeholder="e.g. Admissions, Events, Principal's office" />
          <Input label="Needed by (optional)" type="date" value={form.neededBy}
            min={new Date().toISOString().slice(0, 10)}
            onChange={(e) => setForm({ ...form, neededBy: e.target.value })} />
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <Select
            label="Is this for an event?"
            value={form.event ? 'true' : 'false'}
            onChange={(e) => setForm({ ...form, event: e.target.value === 'true', eventName: '', eventDate: '', place: '', eventCoordinatorName: '' })}
          >
            <option value="false">No</option>
            <option value="true">Yes</option>
          </Select>
          <Select label="Priority" value={form.priority} onChange={(e) => setForm({ ...form, priority: e.target.value })}>
            {PRIORITIES.map((p) => <option key={p.key} value={p.key}>{p.label}</option>)}
          </Select>
        </div>

        {form.event && (
          <div className="grid gap-3 rounded-2xl border border-amber-200 bg-amber-50/60 p-4 dark:border-amber-500/20 dark:bg-amber-500/10 sm:grid-cols-2">
            <Input label="Event name" value={form.eventName} onChange={(e) => setForm({ ...form, eventName: e.target.value })} placeholder="e.g. Freshers' Day" />
            <Input label="Event date" type="date" value={form.eventDate} onChange={(e) => setForm({ ...form, eventDate: e.target.value })} />
            <Input label="Place" value={form.place} onChange={(e) => setForm({ ...form, place: e.target.value })} placeholder="e.g. Auditorium" />
            <Input label="Event coordinator" value={form.eventCoordinatorName} onChange={(e) => setForm({ ...form, eventCoordinatorName: e.target.value })} placeholder="e.g. Prof. Suresh" />
          </div>
        )}

        <div>
          <label className="mb-1.5 block text-sm font-medium text-slate-600 dark:text-slate-300">
            Notes for the admin <span className="font-normal text-slate-400">· optional</span>
          </label>
          <textarea className="input-base min-h-[110px]" value={form.details}
            onChange={(e) => setForm({ ...form, details: e.target.value })}
            placeholder="Add anything that matters to the brief — quantities, audience, branding notes, deadlines." />
        </div>

        <div>
          <label className="mb-1.5 block text-sm font-medium text-slate-600 dark:text-slate-300">
            Attach reference files <span className="font-normal text-slate-400">· optional</span>
          </label>
          <input
            type="file"
            multiple
            accept="image/*,video/*,.pdf,.doc,.docx,.ppt,.pptx,.xls,.xlsx,.csv,.txt,.psd,.ai"
            onChange={(e) => setForm({ ...form, attachments: Array.from(e.target.files || []) })}
            className="block w-full rounded-xl border border-dashed border-slate-200 bg-white px-3 py-2 text-sm text-slate-600 file:mr-3 file:rounded-lg file:border-0 file:bg-brand-50 file:px-3 file:py-2 file:text-sm file:font-semibold file:text-brand-700 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300 dark:file:bg-brand-500/10 dark:file:text-brand-300"
          />
          {form.attachments.length > 0 && (
            <p className="mt-2 text-xs text-slate-400">{form.attachments.length} file{form.attachments.length === 1 ? '' : 's'} selected</p>
          )}
        </div>

        <div className="rounded-xl border border-slate-200 bg-slate-50 p-3 text-sm text-slate-600 dark:border-slate-700 dark:bg-slate-900/50 dark:text-slate-300">
          <p className="font-semibold text-slate-800 dark:text-white">Brief preview</p>
          <p className="mt-1">{summary}</p>
          <p className="mt-1 text-xs text-slate-400">{form.event ? 'Event details are required before you send this.' : 'Event details are optional for this brief.'}</p>
        </div>

        <p className="text-xs text-slate-400">
          This goes to your college&rsquo;s admin and every super admin. You will get a notification with their answer.
        </p>

        <div className="flex justify-end gap-2 pt-2">
          <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
          <Button type="submit" loading={mutation.isPending}>
            <MessageSquarePlus className="h-4 w-4" /> Send brief
          </Button>
        </div>
      </form>
    </Modal>
  );
}
