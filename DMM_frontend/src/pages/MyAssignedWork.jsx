import { useMemo, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import {
  BriefcaseBusiness, CheckCircle2, Circle, Search, Clock3, Send, MessageSquareWarning, ThumbsUp, Flame,
} from 'lucide-react';
import { workAssignmentApi } from '../api/endpoints.js';
import PageHeader from '../components/layout/PageHeader.jsx';
import { Modal } from '../components/ui/Modal.jsx';
import { Button } from '../components/ui/Button.jsx';
import { Card, EmptyState, Input, Select, Skeleton } from '../components/ui/primitives.jsx';
import { timeAgo } from '../lib/utils.js';

const STATUS_OPTIONS = ['All', 'OPEN', 'ACKNOWLEDGED', 'SUBMITTED', 'DONE'];

const STATUS_META = {
  OPEN: { label: 'Open', icon: Circle, cls: 'bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-400' },
  ACKNOWLEDGED: { label: 'In progress', icon: Clock3, cls: 'bg-sky-100 text-sky-700 dark:bg-sky-500/15 dark:text-sky-300' },
  SUBMITTED: { label: 'Awaiting approval', icon: Send, cls: 'bg-violet-100 text-violet-700 dark:bg-violet-500/15 dark:text-violet-300' },
  DONE: { label: 'Completed', icon: CheckCircle2, cls: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-400' },
};

// What to pick up first. NORMAL is the default, so it carries no badge - only
// the ones that change your order are called out.
const URGENCY_META = {
  URGENT: { label: 'Urgent', rank: 0, cls: 'bg-rose-100 text-rose-700 dark:bg-rose-500/15 dark:text-rose-400' },
  HIGH: { label: 'High priority', rank: 1, cls: 'bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-400' },
  NORMAL: { label: 'Normal', rank: 2, cls: '' },
  LOW: { label: 'Low', rank: 3, cls: 'bg-slate-100 text-slate-500 dark:bg-slate-700/50 dark:text-slate-300' },
};

function platformPill(platform) {
  if (!platform) return 'General';
  return platform;
}

export default function MyAssignedWork() {
  const qc = useQueryClient();
  const [filters, setFilters] = useState({ status: 'All', search: '' });
  // The assignment whose completion request is being written.
  const [requesting, setRequesting] = useState(null);

  const { data, isLoading } = useQuery({
    queryKey: ['my-assigned-work', filters.status],
    queryFn: () => workAssignmentApi.list(filters.status === 'All' ? {} : { status: filters.status }),
  });

  const assignments = data?.assignments || [];
  const refresh = () => {
    qc.invalidateQueries({ queryKey: ['my-assigned-work'] });
    qc.invalidateQueries({ queryKey: ['notifications'] });
  };

  const ackMut = useMutation({
    mutationFn: (id) => workAssignmentApi.acknowledge(id),
    onSuccess: () => { toast.success('Acknowledged — you can send a completion request when you’re done'); refresh(); },
    onError: (e) => toast.error(e.response?.data?.message || 'Could not acknowledge this work'),
  });

  const filtered = useMemo(() => {
    const q = filters.search.trim().toLowerCase();
    const rows = !q ? [...assignments] : assignments.filter((a) => {
      const org = a.organization?.name || '';
      return [a.title, a.description, a.platform, org].some((v) => String(v || '').toLowerCase().includes(q));
    });
    // Urgent work first, then newest - so the order on screen is the order to
    // work in. Anything already completed drops to the bottom.
    const rank = (a) => (a.status === 'DONE' ? 9 : (URGENCY_META[a.urgency]?.rank ?? 2));
    return rows.sort((x, y) => rank(x) - rank(y) || new Date(y.createdAt) - new Date(x.createdAt));
  }, [assignments, filters.search]);

  const statusCounts = useMemo(() => {
    const counts = { OPEN: 0, ACKNOWLEDGED: 0, SUBMITTED: 0, DONE: 0 };
    assignments.forEach((a) => {
      if (counts[a.status] !== undefined) counts[a.status] += 1;
    });
    return counts;
  }, [assignments]);

  const tiles = [
    { key: 'OPEN', label: 'Open' },
    { key: 'ACKNOWLEDGED', label: 'In progress' },
    { key: 'SUBMITTED', label: 'Awaiting approval' },
    { key: 'DONE', label: 'Completed' },
  ];

  return (
    <div>
      <PageHeader
        title="My Assigned Work"
        subtitle="Acknowledge what you've been given, then send a completion request — the super admin's approval marks it complete. Urgent work is listed first."
      />

      <div className="mb-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {tiles.map((t) => (
          <Card key={t.key} className="p-4">
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">{t.label}</p>
            <p className="mt-1 text-2xl font-extrabold text-slate-800 dark:text-white">{statusCounts[t.key]}</p>
          </Card>
        ))}
      </div>

      <div className="mb-5 flex flex-col gap-3 sm:flex-row">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <Input
            placeholder="Search title, organization, platform..."
            className="pl-9"
            value={filters.search}
            onChange={(e) => setFilters((prev) => ({ ...prev, search: e.target.value }))}
          />
        </div>
        <Select
          className="sm:w-52"
          value={filters.status}
          onChange={(e) => setFilters((prev) => ({ ...prev, status: e.target.value }))}
        >
          {STATUS_OPTIONS.map((status) => (
            <option key={status} value={status}>{status === 'All' ? 'All status' : (STATUS_META[status]?.label || status)}</option>
          ))}
        </Select>
      </div>

      {isLoading ? (
        <div className="space-y-2">
          {Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-24" />)}
        </div>
      ) : filtered.length === 0 ? (
        <EmptyState
          icon={BriefcaseBusiness}
          title="No assigned work"
          description="New tasks assigned by admin will appear here."
        />
      ) : (
        <div className="space-y-3">
          {filtered.map((a) => {
            const meta = STATUS_META[a.status] || STATUS_META.OPEN;
            const StatusIcon = meta.icon;
            return (
              <Card key={a._id} className="p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-base font-bold text-slate-800 dark:text-white">{a.title}</p>
                    <p className="mt-1 text-xs text-slate-400">
                      {a.organization?.name || 'Organization not set'}
                      {' · '}
                      Assigned {timeAgo(a.createdAt)}
                      {a.createdBy?.name ? ` by ${a.createdBy.name}` : ''}
                    </p>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    {URGENCY_META[a.urgency]?.cls && (
                      <span className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-bold ${URGENCY_META[a.urgency].cls}`}>
                        {a.urgency === 'URGENT' && <Flame className="h-3.5 w-3.5" />}
                        {URGENCY_META[a.urgency].label}
                      </span>
                    )}
                    <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-semibold text-slate-600 dark:bg-slate-800 dark:text-slate-300">
                      {platformPill(a.platform)}
                    </span>
                    <span className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-semibold ${meta.cls}`}>
                      <StatusIcon className="h-3.5 w-3.5" />
                      {meta.label}
                    </span>
                  </div>
                </div>

                {a.description && (
                  <p className="mt-3 rounded-xl border border-slate-100 bg-slate-50 px-3 py-2 text-sm text-slate-600 dark:border-slate-800 dark:bg-slate-900/60 dark:text-slate-300">
                    {a.description}
                  </p>
                )}

                {/* Sent back by the reviewer — what still needs doing. */}
                {a.reviewNote && a.status !== 'DONE' && (
                  <p className="mt-3 flex items-start gap-2 rounded-xl bg-rose-50 p-3 text-sm text-rose-600 dark:bg-rose-500/10 dark:text-rose-400">
                    <MessageSquareWarning className="mt-0.5 h-4 w-4 shrink-0" />
                    <span><span className="font-bold">Sent back:</span> {a.reviewNote}</span>
                  </p>
                )}

                {/* What was submitted for sign-off. */}
                {a.completionNote && ['SUBMITTED', 'DONE'].includes(a.status) && (
                  <p className="mt-3 rounded-xl border border-slate-100 px-3 py-2 text-xs text-slate-500 dark:border-slate-800 dark:text-slate-400">
                    <span className="font-semibold">Your request:</span> {a.completionNote}
                    {a.submittedAt ? ` · sent ${timeAgo(a.submittedAt)}` : ''}
                  </p>
                )}

                <div className="mt-3 flex flex-wrap items-center gap-2">
                  {a.status === 'OPEN' && (
                    <Button size="sm" loading={ackMut.isPending} onClick={() => ackMut.mutate(a._id)}>
                      <ThumbsUp className="h-4 w-4" /> Acknowledge
                    </Button>
                  )}
                  {a.status === 'ACKNOWLEDGED' && (
                    <Button size="sm" onClick={() => setRequesting(a)}>
                      <Send className="h-4 w-4" /> Send completion request
                    </Button>
                  )}
                  {a.status === 'SUBMITTED' && (
                    <>
                      <span className="text-xs text-slate-400">Waiting for the super admin to approve — it will be marked complete automatically.</span>
                      <Button size="sm" variant="outline" onClick={() => setRequesting(a)}>Edit request</Button>
                    </>
                  )}
                  {a.status === 'DONE' && (
                    <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-emerald-600 dark:text-emerald-400">
                      <CheckCircle2 className="h-4 w-4" />
                      Approved{a.reviewedBy?.name ? ` by ${a.reviewedBy.name}` : ''}
                      {a.completedAt ? ` · ${timeAgo(a.completedAt)}` : ''}
                    </span>
                  )}
                </div>
              </Card>
            );
          })}
        </div>
      )}

      {requesting && (
        <CompletionRequestModal
          assignment={requesting}
          onClose={() => setRequesting(null)}
          onSaved={() => { setRequesting(null); refresh(); }}
        />
      )}
    </div>
  );
}

// Asks the super admin to sign the work off. The note travels with the
// assignment so the reviewer sees exactly which task the request is about.
function CompletionRequestModal({ assignment, onClose, onSaved }) {
  const [note, setNote] = useState(assignment.completionNote || '');

  const mut = useMutation({
    mutationFn: () => workAssignmentApi.submit(assignment._id, note),
    onSuccess: () => { toast.success('Request sent to the super admin'); onSaved(); },
    onError: (e) => toast.error(e.response?.data?.message || 'Could not send the request'),
  });

  return (
    <Modal open onClose={onClose} title="Send completion request">
      <form onSubmit={(e) => { e.preventDefault(); if (!note.trim()) { toast.error('Add a short note about what you completed'); return; } mut.mutate(); }} className="space-y-4">
        <div className="rounded-xl border border-slate-100 bg-slate-50 p-3 dark:border-slate-800 dark:bg-slate-900/60">
          <p className="text-sm font-bold text-slate-800 dark:text-white">{assignment.title}</p>
          <p className="mt-0.5 text-xs text-slate-400">
            {assignment.organization?.name || 'Organization not set'}
            {assignment.platform ? ` · ${assignment.platform}` : ''}
            {assignment.createdBy?.name ? ` · assigned by ${assignment.createdBy.name}` : ''}
          </p>
        </div>

        <label className="block">
          <span className="mb-1.5 block text-sm font-medium text-slate-600 dark:text-slate-300">What did you complete?</span>
          <textarea
            autoFocus className="input-base min-h-[110px]" value={note} onChange={(e) => setNote(e.target.value)}
            placeholder="e.g. Designed the 5-slide placement carousel and uploaded the final files to the shared drive"
          />
        </label>
        <p className="-mt-2 text-xs text-slate-400">
          The super admin sees this note next to the assignment, and approving it marks the work complete.
        </p>

        <div className="flex justify-end gap-2">
          <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
          <Button type="submit" loading={mut.isPending}><Send className="h-4 w-4" /> Send request</Button>
        </div>
      </form>
    </Modal>
  );
}
