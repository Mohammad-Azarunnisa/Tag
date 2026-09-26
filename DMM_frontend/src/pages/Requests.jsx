import { useEffect, useMemo, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import {
  MessageSquarePlus, Plus, Clock3, Eye, CheckCircle2, XCircle, Trash2, Flame, BriefcaseBusiness,
  IndianRupee, Users, FileImage, ShieldCheck, KeyRound, CircleHelp, CalendarClock,
  Paperclip, ExternalLink, List, LayoutGrid, Send, Palette, Sparkles, Download, AlertTriangle,
} from 'lucide-react';
import { institutionRequestApi, organizationApi } from '../api/endpoints.js';
import { useAuthStore } from '../store/authStore.js';
import PageHeader from '../components/layout/PageHeader.jsx';
import { Modal } from '../components/ui/Modal.jsx';
import { Button } from '../components/ui/Button.jsx';
import { Card, Input, Select, Skeleton, EmptyState, Avatar } from '../components/ui/primitives.jsx';
import { cn, formatBytes, formatDate, formatDateTime, timeAgo, downloadAllAttachments, isCoordinatorUser } from '../lib/utils.js';

// The tiles read left to right as the journey: raised → with the handler → done.
// IN_REVIEW and GETTING_ALLOCATED can no longer be reached (nothing approves a
// request now — it goes straight to the designers), so they are kept only so
// older requests still render a correct chip, and are left off the tiles.
const STATUS_META = {
  OPEN: { label: 'With the designers', icon: Clock3, cls: 'bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-400' },
  WITH_SOCIAL_HANDLER: { label: 'With the social handler', icon: Send, cls: 'bg-violet-100 text-violet-700 dark:bg-violet-500/15 dark:text-violet-300' },
  APPROVED: { label: 'Done', icon: CheckCircle2, cls: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-400' },
  DECLINED: { label: 'Declined', icon: XCircle, cls: 'bg-rose-100 text-rose-700 dark:bg-rose-500/15 dark:text-rose-400' },
};
// Still moving: raised, or handed to a handler to publish. Work sitting with a
// handler is still late if it has not gone out, so it counts as in flight.
const inFlight = (status) => ['OPEN', 'IN_REVIEW', 'GETTING_ALLOCATED', 'WITH_SOCIAL_HANDLER'].includes(status);
// Kept in sync with the backend's own cap (institutionRequestController.js).
const DETAILS_MAX_LENGTH = 400;

// Chips only — statuses the old flow could set, which no new request reaches.
const LEGACY_STATUS_META = {
  IN_REVIEW: { label: 'Being looked at', icon: Eye, cls: 'bg-sky-100 text-sky-700 dark:bg-sky-500/15 dark:text-sky-300' },
  GETTING_ALLOCATED: { label: 'Getting allocated', icon: BriefcaseBusiness, cls: 'bg-violet-100 text-violet-700 dark:bg-violet-500/15 dark:text-violet-300' },
};
const StatusChip = ({ status }) => {
  const m = STATUS_META[status] || LEGACY_STATUS_META[status] || STATUS_META.OPEN;
  const Icon = m.icon;
  return (
    <span className={cn('inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2.5 py-1 text-xs font-semibold', m.cls)}>
      <Icon className="h-3.5 w-3.5" /> {m.label}
    </span>
  );
};

// Flags a Social Media Posting request — the college already had the
// creative and only asked for it to be posted, so it skipped design entirely.
const PostOnlyBadge = () => (
  <span className="inline-flex items-center gap-1 whitespace-nowrap rounded-full bg-teal-100 px-2.5 py-1 text-xs font-semibold text-teal-700 dark:bg-teal-500/15 dark:text-teal-300">
    <Sparkles className="h-3.5 w-3.5" /> Social Media Posting
  </span>
);

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

// A Social Media Posting request means "I already have the creative, just
// publish it" — unlike a Design Request, there's nothing to design, so this
// is always a ready-made social post. Deliberately not the fuller
// DIGITAL_MEDIA_OPTIONS['Social Media'] list (WhatsApp Creatives, Story
// Designs, etc.) — those are things to ask a designer to *create*, not what
// a college already has in hand.
const POST_ONLY_ITEM = 'Social Media Posts';

const DEFAULT_BRIEF = {
  // 'DESIGN' goes to Designs to be Done, like every request always has.
  // 'POST_ONLY' is for a creative the college already has — nothing to design,
  // it should just go straight to a social media handler to publish.
  requestKind: 'DESIGN',
  title: '',
  workType: 'PRINT_MEDIA',
  workCategory: 'Print Media',
  workItem: PRINT_MEDIA_OPTIONS[0],
  postItem: POST_ONLY_ITEM,
  platforms: [],
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
 * What this college has asked for, and what came back. A request goes straight
 * to the designers on "Designs to be Done" — there is no admin sign-off in front
 * of it. Separate from content approvals on purpose: that flow is about a post
 * on its way out, this one is about something the college needs done.
 */
export default function Requests() {
  const qc = useQueryClient();
  const { user } = useAuthStore();
  const canRaise = !user?.viewOnly;

  const [status, setStatus] = useState('All');
  const [asking, setAsking] = useState(false);
  const [viewMode, setViewMode] = useState('cards');
  const [listDate, setListDate] = useState('');
  const [listFrom, setListFrom] = useState('');
  const [listTo, setListTo] = useState('');
  // The card is a summary; this is the whole brief as it was sent, including the
  // reference files, which the list has no room for.
  const [viewing, setViewing] = useState(null);

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

  // Everything still moving, whichever hands it is in.
  const waiting = useMemo(
    () => (counts.OPEN || 0) + (counts.IN_REVIEW || 0) + (counts.GETTING_ALLOCATED || 0) + (counts.WITH_SOCIAL_HANDLER || 0),
    [counts]
  );
  const filteredRequests = useMemo(() => {
    // Built from local date parts (same convention as PlanCalendar's isoOf/pad)
    // rather than toISOString()/`new Date("YYYY-MM-DD")`, both of which read as
    // UTC and can land a request a calendar day off from what the date input
    // (a local calendar date) and the viewer's own clock show.
    const toDayStart = (s) => {
      const [y, mo, da] = s.split('-').map(Number);
      return new Date(y, mo - 1, da);
    };
    const dayOnly = (d) => {
      const x = new Date(d);
      return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`;
    };

    return requests.filter((r) => {
      const created = new Date(r.createdAt);
      if (Number.isNaN(created.getTime())) return false;

      if (listDate) {
        return dayOnly(created) === listDate;
      }

      if (listFrom) {
        const fromStart = toDayStart(listFrom);
        if (created < fromStart) return false;
      }
      if (listTo) {
        const toEnd = new Date(`${listTo}T23:59:59.999`);
        if (created > toEnd) return false;
      }
      return true;
    });
  }, [requests, listDate, listFrom, listTo]);

  return (
    <div>
      <PageHeader
        title="Raise a Request"
        subtitle={`Ask for what ${user?.organization?.name || 'your college'} needs — raise a Design Request for something to be made, or a Social Media Posting request for a creative you already have. You will be notified as it moves.`}
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

      <div className="mb-4 flex items-center justify-end">
        <div className="inline-flex rounded-xl border border-slate-200 bg-white p-1 dark:border-slate-700 dark:bg-slate-900">
          <button
            type="button"
            onClick={() => setViewMode('cards')}
            className={cn(
              'inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold transition',
              viewMode === 'cards'
                ? 'bg-brand-600 text-white'
                : 'text-slate-500 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800'
            )}
          >
            <LayoutGrid className="h-3.5 w-3.5" /> Cards
          </button>
          <button
            type="button"
            onClick={() => setViewMode('list')}
            className={cn(
              'inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold transition',
              viewMode === 'list'
                ? 'bg-brand-600 text-white'
                : 'text-slate-500 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800'
            )}
          >
            <List className="h-3.5 w-3.5" /> List
          </button>
        </div>
      </div>

      <div className="mb-4 grid gap-3 sm:grid-cols-3">
        <Input
          label="Date"
          type="date"
          value={listDate}
          onChange={(e) => {
            setListDate(e.target.value);
            if (e.target.value) { setListFrom(''); setListTo(''); }
          }}
        />
        <Input
          label="From"
          type="date"
          value={listFrom}
          onChange={(e) => {
            setListFrom(e.target.value);
            if (e.target.value) setListDate('');
          }}
        />
        <Input
          label="To"
          type="date"
          value={listTo}
          onChange={(e) => {
            setListTo(e.target.value);
            if (e.target.value) setListDate('');
          }}
        />
      </div>

      {isLoading ? (
        <div className="space-y-3">{Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-28" />)}</div>
      ) : requests.length === 0 ? (
        <EmptyState icon={MessageSquarePlus}
          title={status === 'All' ? 'Nothing asked for yet' : `Nothing ${STATUS_META[status]?.label.toLowerCase()}`}
          description="Raise a request when the college needs something made — it goes straight to the designers."
          action={canRaise && status === 'All' && <Button onClick={() => setAsking(true)}><Plus className="h-4 w-4" /> New request</Button>} />
      ) : viewMode === 'list' ? (
        <Card className="overflow-hidden p-0">
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-slate-200 dark:divide-slate-800">
              <thead className="bg-slate-50 dark:bg-slate-900/60">
                <tr>
                  <th className="px-4 py-3 text-left text-[11px] font-bold uppercase tracking-wide text-slate-500">Title</th>
                  <th className="px-4 py-3 text-left text-[11px] font-bold uppercase tracking-wide text-slate-500">Date</th>
                  <th className="px-4 py-3 text-left text-[11px] font-bold uppercase tracking-wide text-slate-500">Status</th>
                  <th className="px-4 py-3 text-left text-[11px] font-bold uppercase tracking-wide text-slate-500">Priority</th>
                  <th className="px-4 py-3 text-right text-[11px] font-bold uppercase tracking-wide text-slate-500">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {filteredRequests.map((r) => {
                  const canWithdraw = canRaise && stillOpen(r) && String(r.raisedBy?._id) === String(user?._id);
                  return (
                    <tr key={r._id} className="hover:bg-slate-50/70 dark:hover:bg-slate-900/40">
                      <td className="px-4 py-3">
                        <button
                          type="button"
                          onClick={() => setViewing(r)}
                          className="max-w-[320px] truncate text-left font-semibold text-slate-800 hover:text-brand-600 dark:text-slate-100 dark:hover:text-brand-300"
                          title={r.title}
                        >
                          {r.title}
                        </button>
                      </td>
                      <td className="whitespace-nowrap px-4 py-3 text-sm text-slate-500 dark:text-slate-400">
                        {formatDate(r.createdAt)}
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex flex-wrap items-center gap-1.5">
                          <StatusChip status={r.status} />
                          {r.postOnly && <PostOnlyBadge />}
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        {PRIORITY_CLS[r.priority] ? (
                          <span className={cn('inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-bold', PRIORITY_CLS[r.priority])}>
                            {r.priority === 'URGENT' && <Flame className="h-3 w-3" />} {r.priority.charAt(0) + r.priority.slice(1).toLowerCase()}
                          </span>
                        ) : (
                          <span className="text-xs font-semibold text-slate-500 dark:text-slate-400">Normal</span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-right">
                        <div className="inline-flex items-center gap-2">
                          <Button size="sm" variant="outline" onClick={() => setViewing(r)}>
                            <Eye className="h-4 w-4" /> Open
                          </Button>
                          {canWithdraw && (
                            <button
                              type="button"
                              disabled={withdrawMut.isPending}
                              onClick={() => { if (window.confirm(`Withdraw "${r.title}"?`)) withdrawMut.mutate(r._id); }}
                              className="inline-flex items-center gap-1.5 text-xs font-semibold text-slate-400 transition-colors hover:text-rose-600 disabled:opacity-40"
                            >
                              <Trash2 className="h-3.5 w-3.5" /> Withdraw
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
                {filteredRequests.length === 0 && (
                  <tr>
                    <td colSpan={5} className="px-4 py-8 text-center text-sm text-slate-500 dark:text-slate-400">
                      No requests match this filter.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </Card>
      ) : filteredRequests.length === 0 ? (
        <Card className="p-8 text-center">
          <p className="text-sm font-semibold text-slate-700 dark:text-slate-200">No requests in this date filter.</p>
          <p className="mt-1 text-xs text-slate-400">Try another date or clear the range.</p>
        </Card>
      ) : (
        <div className="space-y-3">
          {filteredRequests.map((r) => {
            const Icon = categoryIcon(r.category);
            const overdue = r.neededBy && new Date(r.neededBy) < new Date() && inFlight(r.status);
            const canWithdraw = canRaise && stillOpen(r) && String(r.raisedBy?._id) === String(user?._id);
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
                      {assignedUsersOf(r).length > 0 && (
                        <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                          Assigned to: {assignedUsersOf(r).map((u) => u.name).join(', ')}
                        </p>
                      )}
                      {attachmentsOf(r).length > 0 && (
                        <button type="button" onClick={() => setViewing(r)}
                          className="mt-1 inline-flex items-center gap-1 text-xs font-semibold text-brand-600 hover:underline dark:text-brand-400">
                          <Paperclip className="h-3 w-3" />
                          {attachmentsOf(r).length} attached file{attachmentsOf(r).length === 1 ? '' : 's'} — view
                        </button>
                      )}
                    </div>
                  </div>
                  <div className="flex shrink-0 flex-wrap items-center gap-2">
                    {PRIORITY_CLS[r.priority] && (
                      <span className={cn('inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-bold', PRIORITY_CLS[r.priority])}>
                        {r.priority === 'URGENT' && <Flame className="h-3 w-3" />} {r.priority.charAt(0) + r.priority.slice(1).toLowerCase()}
                      </span>
                    )}
                    <StatusChip status={r.status} />
                    {r.postOnly && <PostOnlyBadge />}
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

                {/* A written reply, where one exists. Requires the text: nobody
                    replies to a request any more, and `reviewedBy` is now set by
                    the coordinator's own confirmation, so keying off that alone
                    would show a name above an empty box. */}
                {r.response && (
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

                <div className="mt-3 flex flex-wrap items-center gap-3">
                  <Button size="sm" variant="outline" onClick={() => setViewing(r)}>
                    <Eye className="h-4 w-4" /> Open request
                  </Button>
                  {canWithdraw && (
                    <button type="button" disabled={withdrawMut.isPending}
                      onClick={() => { if (window.confirm(`Withdraw "${r.title}"?`)) withdrawMut.mutate(r._id); }}
                      className="inline-flex items-center gap-1.5 text-xs font-semibold text-slate-400 transition-colors hover:text-rose-600 disabled:opacity-40">
                      <Trash2 className="h-3.5 w-3.5" /> Withdraw
                    </button>
                  )}
                </div>
              </Card>
            );
          })}
        </div>
      )}

      {viewing && (
        <RequestDetailModal
          request={viewing}
          canWithdraw={canRaise && stillOpen(viewing) && String(viewing.raisedBy?._id) === String(user?._id)}
          withdrawing={withdrawMut.isPending}
          onWithdraw={() => {
            if (!window.confirm(`Withdraw "${viewing.title}"?`)) return;
            withdrawMut.mutate(viewing._id);
            setViewing(null);
          }}
          onClose={() => setViewing(null)}
        />
      )}

      {asking && <AskModal onClose={() => setAsking(false)} onSaved={() => { setAsking(false); refresh(); }} />}
    </div>
  );
}

// Whatever was attached when the request was raised. A helper because the field
// is left undefined rather than empty when nothing was uploaded.
const attachmentsOf = (r) => (Array.isArray(r?.attachments) ? r.attachments : []);
const assignedUsersOf = (r) => (Array.isArray(r?.assignedUsers) ? r.assignedUsers : []);
// Still withdrawable — nobody has picked it up yet. A postOnly request starts
// at status WITH_SOCIAL_HANDLER (it has no design half to sit OPEN through), so
// its equivalent of "still open" is workflowStage POST_OPEN. Mirrors the same
// check the server makes before it allows a withdrawal.
const stillOpen = (r) => r.status === 'OPEN' || (r.postOnly && r.workflowStage === 'POST_OPEN');

// An attachment previews inline when it is an image; anything else (a PDF, a
// spreadsheet) gets a labelled tile that opens in a new tab.
const isImageAttachment = (a) =>
  a?.mediaType === 'image' || /\.(png|jpe?g|webp|gif|svg|avif)$/i.test(a?.url || a?.name || '');

const Detail = ({ label, children }) => (
  <div>
    <p className="text-[11px] font-bold uppercase tracking-wide text-slate-400">{label}</p>
    <p className="mt-0.5 text-sm text-slate-700 dark:text-slate-200">{children}</p>
  </div>
);

/**
 * The whole request as it was sent. The list is a status view — it shows only
 * enough to tell where something stands — so this is where the full brief lives:
 * the work asked for, the event behind it, the reference files, and the admin's
 * reply once it comes. Read-only apart from withdrawing, which is the only thing
 * the person who raised it can still change while it is open.
 */
function RequestDetailModal({ request: r, canWithdraw, withdrawing, onWithdraw, onClose }) {
  const files = attachmentsOf(r);
  const images = files.filter(isImageAttachment);
  const others = files.filter((a) => !isImageAttachment(a));
  const brief = [r.workType === 'DIGITAL_MEDIA' ? 'Digital media' : 'Print media', r.workCategory, r.workItem].filter(Boolean).join(' · ');
  // Only a written reply is worth a block — see the list view for why.
  const decided = !!r.response;

  return (
    <Modal open onClose={onClose} title={r.title} size="lg">
      <div className="space-y-5">
        <div className="flex flex-wrap items-center gap-2">
          <StatusChip status={r.status} />
          {r.postOnly && <PostOnlyBadge />}
          {PRIORITY_CLS[r.priority] && (
            <span className={cn('inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-bold', PRIORITY_CLS[r.priority])}>
              {r.priority === 'URGENT' && <Flame className="h-3 w-3" />} {r.priority.charAt(0) + r.priority.slice(1).toLowerCase()}
            </span>
          )}
          {/* The exact moment, not only how long ago — this is the figure people
              quote when they ask why something took as long as it did. */}
          <span className="text-xs text-slate-400">Raised {formatDateTime(r.createdAt)} · {timeAgo(r.createdAt)}</span>
        </div>

        <div className="grid gap-4 rounded-xl bg-slate-50 p-4 dark:bg-slate-800/50 sm:grid-cols-2">
          <Detail label="Raised on">{formatDateTime(r.createdAt)}</Detail>
          <Detail label="Raised by">
            <span className="inline-flex items-center gap-1.5">
              {r.raisedBy?.name ? <Avatar src={r.raisedBy.avatar} name={r.raisedBy.name} size="sm" className="h-5 w-5 ring-0" /> : null}
              {r.raisedBy?.name || '—'}
            </span>
          </Detail>
          <Detail label="Kind">{r.category}</Detail>
          {brief && <Detail label="Work">{brief}</Detail>}
          {r.department && <Detail label="Department">{r.department}</Detail>}
          {r.neededBy && <Detail label="Needed by">{formatDate(r.neededBy)}</Detail>}
          {(r.postPlatforms?.length || 0) > 0 && <Detail label="Pages to post on">{r.postPlatforms.join(', ')}</Detail>}
          {assignedUsersOf(r).length > 0 && <Detail label="Assigned to">{assignedUsersOf(r).map((u) => u.name).join(', ')}</Detail>}
        </div>

        {r.event && (
          <div className="rounded-xl border border-slate-200 p-4 dark:border-slate-700">
            <p className="mb-2 flex items-center gap-1.5 text-xs font-bold uppercase tracking-wide text-slate-400">
              <CalendarClock className="h-3.5 w-3.5" /> Event
            </p>
            <div className="grid gap-3 sm:grid-cols-2">
              <Detail label="Name">{r.eventName || 'Unnamed event'}</Detail>
              {r.eventDate && <Detail label="Date">{formatDate(r.eventDate)}</Detail>}
              {r.place && <Detail label="Place">{r.place}</Detail>}
              {r.eventCoordinatorName && <Detail label="Coordinator">{r.eventCoordinatorName}</Detail>}
            </div>
          </div>
        )}

        {r.details && (
          <div>
            <p className="mb-1.5 text-[11px] font-bold uppercase tracking-wide text-slate-400">What you asked for</p>
            <p className="whitespace-pre-wrap text-sm text-slate-700 dark:text-slate-200">{r.details}</p>
          </div>
        )}

        <div>
          <div className="mb-2 flex items-center justify-between gap-2">
            <p className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wide text-slate-400">
              <Paperclip className="h-3.5 w-3.5" /> Reference files{files.length > 0 ? ` · ${files.length}` : ''}
            </p>
            {files.length > 1 && (
              <button type="button" onClick={() => downloadAllAttachments(files)}
                className="inline-flex shrink-0 items-center gap-1 text-[11px] font-semibold text-slate-500 transition hover:text-brand-600 dark:text-slate-400 dark:hover:text-brand-400">
                <Download className="h-3 w-3" /> Download all ({files.length})
              </button>
            )}
          </div>
          {files.length === 0 ? (
            <p className="text-sm text-slate-400">Nothing was attached to this request.</p>
          ) : (
            <div className="space-y-3">
              {images.length > 0 && (
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                  {images.map((a, i) => (
                    <a key={a.url || i} href={a.url} target="_blank" rel="noreferrer" download={a.name || true}
                      title={a.name || 'Open full size'}
                      className="group relative block overflow-hidden rounded-xl border border-slate-200 dark:border-slate-700">
                      <img src={a.url} alt={a.name || `Reference ${i + 1}`} className="aspect-video w-full object-cover transition-transform group-hover:scale-105" />
                      <span className="absolute inset-x-0 bottom-0 truncate bg-slate-900/70 px-2 py-1 text-[11px] text-white opacity-0 transition-opacity group-hover:opacity-100">
                        {a.name || 'Open full size'}
                      </span>
                    </a>
                  ))}
                </div>
              )}
              {others.map((a, i) => (
                <a key={a.url || i} href={a.url} target="_blank" rel="noreferrer" download={a.name || true}
                  className="flex items-center gap-2 rounded-xl border border-slate-200 px-3 py-2 text-sm font-medium text-slate-600 transition-colors hover:border-brand-300 hover:bg-brand-50/50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-brand-500/5">
                  <FileImage className="h-4 w-4 shrink-0 text-slate-400" />
                  <span className="min-w-0 flex-1 truncate">{a.name || 'Attachment'}</span>
                  <ExternalLink className="h-3.5 w-3.5 shrink-0 text-slate-400" />
                </a>
              ))}
            </div>
          )}
        </div>

        {decided && (
          <div className={cn('rounded-xl border p-3',
            r.status === 'DECLINED'
              ? 'border-rose-200 bg-rose-50/60 dark:border-rose-500/25 dark:bg-rose-500/[0.07]'
              : 'border-emerald-200 bg-emerald-50/60 dark:border-emerald-500/25 dark:bg-emerald-500/[0.07]')}>
            <div className="flex items-center gap-2">
              <Avatar src={r.reviewedBy?.avatar} name={r.reviewedBy?.name} size="sm" />
              <p className="text-xs font-semibold text-slate-700 dark:text-slate-200">
                {r.reviewedBy?.name || 'Admin'}
                <span className="font-normal text-slate-400">{' · '}{r.reviewedAt ? timeAgo(r.reviewedAt) : ''}</span>
              </p>
            </div>
            {r.response && <p className="mt-1.5 whitespace-pre-wrap text-sm text-slate-700 dark:text-slate-200">{r.response}</p>}
          </div>
        )}

        <div className="flex flex-wrap justify-end gap-2 border-t border-slate-100 pt-4 dark:border-slate-800">
          {canWithdraw && (
            <Button type="button" variant="ghost" disabled={withdrawing} onClick={onWithdraw}>
              <Trash2 className="h-4 w-4 text-rose-500" /> Withdraw
            </Button>
          )}
          <Button type="button" variant="outline" onClick={onClose}>Close</Button>
        </div>
      </div>
    </Modal>
  );
}

// The college is implicit — the server stamps the requester's own, so there is
// nothing to choose and nothing to get wrong.
function AskModal({ onClose, onSaved }) {
  const { user } = useAuthStore();
  // A coordinator asks a designer to make something — "Social Media Posting"
  // skips design entirely and hands ready-made creative straight to a social
  // handler, which is not a coordinator's call to make on their own. Hidden
  // for them below rather than just left off the form, so it reads as a rule
  // rather than a missing option; the server enforces the same rule.
  const coordinatorOnlyDesign = isCoordinatorUser(user);
  // Coordinators keep bundling several posts' worth of instructions into one
  // request instead of raising one per post — the placeholder text alone
  // wasn't enough to stop it, so this says it again, louder, the moment the
  // form opens.
  useEffect(() => {
    if (coordinatorOnlyDesign) {
      toast('One request = one design or post. If you need several, please raise a separate request for each one.', { icon: '📌', duration: 6000 });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const maxAttachments = 20;
  const [form, setForm] = useState(DEFAULT_BRIEF);
  const selectedDigitalItems = DIGITAL_MEDIA_OPTIONS[form.workCategory] || DIGITAL_MEDIA_OPTIONS['Social Media'];
  const selectedDigitalItem = selectedDigitalItems.includes(form.workItem) ? form.workItem : selectedDigitalItems[0];
  const postOnly = !coordinatorOnlyDesign && form.requestKind === 'POST_ONLY';
  // Mirrors the backend's SOCIAL_POST_WORK_CATEGORIES/SOCIAL_POST_WORK_ITEMS
  // (config/constants.js) — a Design Request that will end up needing a page
  // to post to, same as a Social Media Posting request already requires.
  const isSocialDesign = !postOnly && (form.workCategory === 'Social Media' || form.workItem === 'Animated Social Media Posts');

  // The pages this college actually runs, for "where should this go?" —
  // needed for a postOnly request (no design-acceptance step to ask at
  // later) and for a Social Media design request (asked up front so a
  // designer/handler never starts on work with nowhere to publish it).
  const { data: orgOptions } = useQuery({
    queryKey: ['org-options-mine'],
    queryFn: () => organizationApi.myOptions(),
    enabled: postOnly || isSocialDesign,
    staleTime: 5 * 60 * 1000,
  });
  const availablePlatforms = orgOptions?.organizations?.[0]?.platforms || [];

  const setRequestKind = (requestKind) => setForm((current) => ({ ...current, requestKind, platforms: [] }));
  const togglePlatform = (p) => setForm((current) => ({
    ...current,
    platforms: current.platforms.includes(p) ? current.platforms.filter((x) => x !== p) : [...current.platforms, p],
  }));

  const addAttachments = (fileList) => {
    const incoming = Array.from(fileList || []);
    if (!incoming.length) return;
    setForm((current) => {
      const available = maxAttachments - current.attachments.length;
      if (available <= 0) {
        toast.error(`A brief can include up to ${maxAttachments} reference files`);
        return current;
      }
      if (incoming.length > available) toast.error(`Only ${available} more reference file${available === 1 ? '' : 's'} can be added`);
      return { ...current, attachments: [...current.attachments, ...incoming.slice(0, available)] };
    });
  };

  const removeAttachmentAt = (idx) => {
    setForm((current) => ({
      ...current,
      attachments: current.attachments.filter((_, i) => i !== idx),
    }));
  };

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
      payload.append('title', form.title.trim());
      if (postOnly) {
        // Forced to digital/Social Media server-side too — sent here only so the
        // brief preview and any validation error read consistently before that.
        payload.append('postOnly', 'true');
        payload.append('workType', 'DIGITAL_MEDIA');
        payload.append('workCategory', 'Social Media');
        payload.append('workItem', form.postItem);
        form.platforms.forEach((p) => payload.append('platforms', p));
      } else {
        payload.append('workType', form.workType);
        payload.append('workCategory', form.workCategory);
        payload.append('workItem', form.workItem);
        if (isSocialDesign) form.platforms.forEach((p) => payload.append('platforms', p));
      }
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
    onSuccess: () => { toast.success(postOnly ? 'Sent to To Be Posted' : 'Sent to Designs to be Done'); onSaved(); },
    onError: (e) => toast.error(e.response?.data?.message || 'Could not send that'),
  });

  const summary = postOnly
    ? `Social Media Posting · ${form.postItem}`
    : form.workType === 'PRINT_MEDIA'
      ? `Print media · ${form.workItem}`
      : `Digital media · ${form.workCategory} · ${selectedDigitalItem}`;

  const submit = (e) => {
    e.preventDefault();
    if (!form.title.trim()) { toast.error('Add a title for this request'); return; }
    if (!form.department.trim()) { toast.error('Add the department that needs this'); return; }
    if (form.event && (!form.eventName.trim() || !form.eventDate || !form.place.trim() || !form.eventCoordinatorName.trim())) {
      toast.error('Fill in the event details');
      return;
    }
    if (postOnly) {
      if (!form.attachments.length) { toast.error('Attach the ready-to-post file(s)'); return; }
      if (!form.platforms.length) { toast.error('Pick at least one page to post it on'); return; }
    }
    if (isSocialDesign && !form.platforms.length) { toast.error('Pick at least one page this should be posted on'); return; }
    mutation.mutate();
  };

  return (
    <Modal open onClose={onClose} title="Raise a request" size="lg">
      <form onSubmit={submit} className="space-y-4">
        {coordinatorOnlyDesign && (
          <div className="flex items-start gap-2.5 rounded-xl border border-amber-200 bg-amber-50/70 p-3 text-sm text-amber-800 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-300">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
            <span>
              <span className="font-bold">One request = one design or post.</span> If you need several, raise a
              separate request for each one — don't list multiple posts in a single request.
            </span>
          </div>
        )}
        <div className={cn('grid gap-3', coordinatorOnlyDesign ? 'sm:grid-cols-1' : 'sm:grid-cols-2')}>
          <button type="button" onClick={() => setRequestKind('DESIGN')}
            className={cn('rounded-2xl border-2 p-3 text-left transition',
              !postOnly ? 'border-brand-500 bg-brand-50/60 dark:bg-brand-500/10' : 'border-slate-200 hover:border-brand-300 dark:border-slate-700')}>
            <p className="inline-flex items-center gap-1.5 text-sm font-bold text-slate-800 dark:text-white">
              <Palette className="h-4 w-4" /> Design Request
            </p>
            <p className="mt-0.5 text-xs text-slate-400">Goes to Designs to be Done for a designer to make.</p>
          </button>
          {/* Skips design and goes straight to a social handler — a coordinator
              always raises through a designer first, so this choice is not
              offered to them at all. */}
          {!coordinatorOnlyDesign && (
            <button type="button" onClick={() => setRequestKind('POST_ONLY')}
              className={cn('rounded-2xl border-2 p-3 text-left transition',
                postOnly ? 'border-brand-500 bg-brand-50/60 dark:bg-brand-500/10' : 'border-slate-200 hover:border-brand-300 dark:border-slate-700')}>
              <p className="inline-flex items-center gap-1.5 text-sm font-bold text-slate-800 dark:text-white">
                <Sparkles className="h-4 w-4" /> Social Media Posting
              </p>
              <p className="mt-0.5 text-xs text-slate-400">Already have the creative? Skips design, straight to a social media handler.</p>
            </button>
          )}
        </div>

        {postOnly ? (
          <>
            {/* Not a real choice — Social Media Posting only ever means a
                ready-made social post, so this just states that rather than
                asking the coordinator to pick from a dropdown of one. */}
            <div>
              <span className="mb-1.5 block text-sm font-medium text-slate-600 dark:text-slate-300">What kind of post is it?</span>
              <div className="input-base flex items-center gap-1.5 text-slate-700 dark:text-slate-200">
                <Sparkles className="h-3.5 w-3.5 text-brand-500" /> {POST_ONLY_ITEM}
              </div>
            </div>
            <div>
              <label className="mb-1.5 block text-sm font-medium text-slate-600 dark:text-slate-300">Which pages should this go out on?</label>
              {availablePlatforms.length === 0 ? (
                <p className="rounded-xl border border-amber-200 bg-amber-50/70 p-3 text-sm text-amber-800 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-300">
                  Your college has no social pages set up yet — ask the admin to add them before sending this.
                </p>
              ) : (
                <div className="flex flex-wrap gap-2">
                  {availablePlatforms.map((p) => {
                    const on = form.platforms.includes(p);
                    return (
                      <button key={p} type="button" onClick={() => togglePlatform(p)}
                        className={cn('inline-flex items-center gap-1.5 rounded-xl border-2 px-3 py-2 text-sm font-semibold transition',
                          on ? 'border-brand-500 bg-brand-50/60 text-brand-700 dark:bg-brand-500/10 dark:text-brand-300'
                            : 'border-slate-200 text-slate-600 hover:border-brand-300 dark:border-slate-700 dark:text-slate-300')}>
                        {p}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          </>
        ) : (
          <>
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

            {isSocialDesign && (
              <div>
                <label className="mb-1.5 block text-sm font-medium text-slate-600 dark:text-slate-300">Which pages should this go out on?</label>
                {availablePlatforms.length === 0 ? (
                  <p className="rounded-xl border border-amber-200 bg-amber-50/70 p-3 text-sm text-amber-800 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-300">
                    Your college has no social pages set up yet — ask the admin to add them before sending this.
                  </p>
                ) : (
                  <div className="flex flex-wrap gap-2">
                    {availablePlatforms.map((p) => {
                      const on = form.platforms.includes(p);
                      return (
                        <button key={p} type="button" onClick={() => togglePlatform(p)}
                          className={cn('inline-flex items-center gap-1.5 rounded-xl border-2 px-3 py-2 text-sm font-semibold transition',
                            on ? 'border-brand-500 bg-brand-50/60 text-brand-700 dark:bg-brand-500/10 dark:text-brand-300'
                              : 'border-slate-200 text-slate-600 hover:border-brand-300 dark:border-slate-700 dark:text-slate-300')}>
                          {p}
                        </button>
                      );
                    })}
                  </div>
                )}
                <p className="mt-1.5 text-xs text-slate-400">
                  You'll get a chance to change this again once the design is ready.
                </p>
              </div>
            )}
          </>
        )}

        <div className="grid gap-3 sm:grid-cols-2">
          <Input label="Title" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })}
            placeholder="e.g. Independence Day Banner & Reels Pack" />
          <Input label="Department" value={form.department} onChange={(e) => setForm({ ...form, department: e.target.value })}
            placeholder="e.g. Admissions, Events, Principal's office" />
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <Input label="Needed by (optional)" type="date" value={form.neededBy}
            min={new Date().toISOString().slice(0, 10)}
            onChange={(e) => setForm({ ...form, neededBy: e.target.value })} />
          <div />
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
            {postOnly ? 'Notes for the handler' : 'Notes for the designer'} <span className="font-normal text-slate-400">· optional</span>
          </label>
          <textarea className="input-base min-h-[110px]" value={form.details} maxLength={DETAILS_MAX_LENGTH}
            onChange={(e) => setForm({ ...form, details: e.target.value })}
            placeholder={postOnly
              ? 'One request per post — describe a single post only. Add anything the handler should know: a caption idea, hashtags, timing.'
              : 'One request per post — describe a single post only. Add anything that matters to the brief: quantities, audience, branding notes, deadlines.'} />
          <p className="mt-1 text-right text-xs text-slate-400">{form.details.length}/{DETAILS_MAX_LENGTH}</p>
        </div>

        <div>
          <label className="mb-1.5 block text-sm font-medium text-slate-600 dark:text-slate-300">
            {postOnly ? 'Attach the ready-to-post file(s)' : 'Attach reference files'}{' '}
            <span className="font-normal text-slate-400">{postOnly ? '· required' : '· optional'}</span>
          </label>
          <input
            type="file"
            multiple
            accept="image/*,video/*,.pdf,.doc,.docx,.ppt,.pptx,.xls,.xlsx,.csv,.txt,.psd,.ai,.zip"
            onChange={(e) => {
              addAttachments(e.target.files);
              // Allow choosing the same file again after removing it.
              e.target.value = '';
            }}
            className="block w-full rounded-xl border border-dashed border-slate-200 bg-white px-3 py-2 text-sm text-slate-600 file:mr-3 file:rounded-lg file:border-0 file:bg-brand-50 file:px-3 file:py-2 file:text-sm file:font-semibold file:text-brand-700 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300 dark:file:bg-brand-500/10 dark:file:text-brand-300"
          />
          <p className="mt-1.5 text-xs text-slate-400">
            {postOnly
              ? `Up to ${maxAttachments} files — this is exactly what goes out, so send the finished creative.`
              : `Up to ${maxAttachments} images, videos, PDFs, ZIP archives, or office files.`}
          </p>
          {form.attachments.length > 0 && (
            <div className="mt-2 space-y-2">
              <div className="flex items-center justify-between">
                <p className="text-xs text-slate-400">{form.attachments.length} file{form.attachments.length === 1 ? '' : 's'} selected</p>
                <button
                  type="button"
                  onClick={() => setForm((current) => ({ ...current, attachments: [] }))}
                  className="text-xs font-semibold text-slate-500 hover:text-rose-600 dark:text-slate-400 dark:hover:text-rose-400"
                >
                  Clear all
                </button>
              </div>
              <div className="space-y-1.5">
                {form.attachments.map((file, idx) => (
                  <div key={`${file.name}-${file.size}-${idx}`} className="flex items-center justify-between rounded-lg bg-slate-50 px-2.5 py-2 text-xs dark:bg-slate-800/70">
                    <div className="min-w-0">
                      <p className="truncate font-medium text-slate-700 dark:text-slate-200">{file.name}</p>
                      <p className="text-slate-400">{formatBytes(file.size)}</p>
                    </div>
                    <button
                      type="button"
                      onClick={() => removeAttachmentAt(idx)}
                      className="ml-3 shrink-0 rounded px-2 py-1 font-semibold text-slate-500 hover:bg-slate-200 hover:text-slate-700 dark:text-slate-300 dark:hover:bg-slate-700"
                    >
                      Remove
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        <div className="rounded-xl border border-slate-200 bg-slate-50 p-3 text-sm text-slate-600 dark:border-slate-700 dark:bg-slate-900/50 dark:text-slate-300">
          <p className="font-semibold text-slate-800 dark:text-white">Brief preview</p>
          <p className="mt-1 text-xs text-slate-400">Title</p>
          <p className="font-medium text-slate-700 dark:text-slate-200">{form.title.trim() || '—'}</p>
          <p className="mt-1">{summary}</p>
          <p className="mt-1 text-xs text-slate-400">{form.event ? 'Event details are required before you send this.' : 'Event details are optional for this brief.'}</p>
        </div>

        <p className="text-xs text-slate-400">
          {postOnly
            ? 'This goes straight to a social media handler for the pages you picked — no design step in between. You will get a notification as it moves.'
            : 'This goes straight onto Designs to be Done for a designer to pick up. You will get a notification as it moves.'}
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
