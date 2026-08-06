import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { UserCheck, Check, X, Sparkles, Wrench, Share2 } from 'lucide-react';
import { userApi } from '../api/endpoints.js';
import { Card, Avatar, Badge } from './ui/primitives.jsx';
import { Button } from './ui/Button.jsx';
import { formatDate, cn } from '../lib/utils.js';

// Diff a list: what the request adds (emerald) and removes (rose) vs current.
const diff = (current = [], requested = []) => {
  const cur = new Set(current.map((s) => s.toLowerCase()));
  const req = new Set(requested.map((s) => s.toLowerCase()));
  return {
    added: requested.filter((s) => !cur.has(s.toLowerCase())),
    removed: current.filter((s) => !req.has(s.toLowerCase())),
    kept: requested.filter((s) => cur.has(s.toLowerCase())),
  };
};

const DiffChips = ({ icon: Icon, label, current, requested }) => {
  const d = diff(current, requested);
  if (!d.added.length && !d.removed.length) {
    return (
      <div className="flex flex-wrap items-center gap-1.5 text-xs">
        <span className="inline-flex items-center gap-1 font-bold uppercase tracking-wide text-slate-400"><Icon className="h-3.5 w-3.5" /> {label}:</span>
        <span className="text-slate-400">no change</span>
      </div>
    );
  }
  return (
    <div className="flex flex-wrap items-center gap-1.5 text-xs">
      <span className="inline-flex items-center gap-1 font-bold uppercase tracking-wide text-slate-400"><Icon className="h-3.5 w-3.5" /> {label}:</span>
      {d.added.map((s) => (
        <span key={`a-${s}`} className="rounded-lg bg-emerald-50 px-2 py-0.5 font-semibold text-emerald-600 dark:bg-emerald-500/10">+ {s}</span>
      ))}
      {d.removed.map((s) => (
        <span key={`r-${s}`} className="rounded-lg bg-rose-50 px-2 py-0.5 font-semibold text-rose-500 line-through dark:bg-rose-500/10">− {s}</span>
      ))}
      {d.kept.length > 0 && <span className="text-slate-400">(+{d.kept.length} unchanged)</span>}
    </div>
  );
};

const handleLabel = (h) => {
  const org = h.organization?.name || 'Organization';
  return `${org}: ${(h.platforms || []).join(', ')}`;
};

// Pending skill/tool/handle changes users submitted for review. Rendered at the
// top of User Management so approvals are one click away.
export default function ProfileReviews() {
  const qc = useQueryClient();
  const [rejecting, setRejecting] = useState(null); // request being rejected (note prompt)
  const [note, setNote] = useState('');

  const { data, isLoading } = useQuery({
    queryKey: ['profile-requests'],
    queryFn: () => userApi.profileRequests({ status: 'PENDING' }),
    refetchInterval: 15000,
    refetchIntervalInBackground: false,
  });
  const requests = data?.requests || [];

  const reviewMut = useMutation({
    mutationFn: ({ id, action, note: n }) => userApi.reviewProfileRequest(id, action, n),
    onSuccess: (_res, vars) => {
      toast.success(vars.action === 'approve' ? 'Profile update approved' : 'Profile update rejected');
      setRejecting(null); setNote('');
      qc.invalidateQueries({ queryKey: ['profile-requests'] });
      qc.invalidateQueries({ queryKey: ['users'] });
    },
    onError: (e) => toast.error(e.response?.data?.message || 'Review failed'),
  });

  if (isLoading || !requests.length) return null;

  return (
    <Card className="mb-6 overflow-hidden border-amber-200/70 dark:border-amber-500/20">
      <div className="flex items-center gap-2 border-b border-slate-100 bg-amber-50/60 px-5 py-3 dark:border-slate-800 dark:bg-amber-500/5">
        <UserCheck className="h-4 w-4 text-amber-500" />
        <h3 className="font-bold text-slate-800 dark:text-white">Profile updates waiting for review</h3>
        <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-bold text-amber-700 dark:bg-amber-500/15 dark:text-amber-300">{requests.length}</span>
      </div>
      <div className="divide-y divide-slate-100 dark:divide-slate-800">
        {requests.map((r) => (
          <div key={r._id} className="px-5 py-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="flex items-center gap-3">
                <Avatar src={r.user?.avatar} name={r.user?.name} size="md" />
                <div>
                  <p className="font-semibold text-slate-800 dark:text-white">{r.user?.name}</p>
                  <p className="text-xs text-slate-400">
                    {r.user?.email}{r.user?.organization?.name ? ` · ${r.user.organization.name}` : ''} · submitted {formatDate(r.createdAt)}
                  </p>
                </div>
              </div>
              <div className="flex gap-2">
                <Button size="sm" variant="outline" loading={reviewMut.isPending}
                  className="border-rose-200 text-rose-600 hover:bg-rose-50 dark:border-rose-500/30 dark:text-rose-400 dark:hover:bg-rose-500/10"
                  onClick={() => { setRejecting(rejecting === r._id ? null : r._id); setNote(''); }}>
                  <X className="h-3.5 w-3.5" /> Reject
                </Button>
                <Button size="sm" loading={reviewMut.isPending}
                  onClick={() => reviewMut.mutate({ id: r._id, action: 'approve' })}>
                  <Check className="h-3.5 w-3.5" /> Approve
                </Button>
              </div>
            </div>

            <div className="mt-3 space-y-1.5">
              <DiffChips icon={Sparkles} label="Skills" current={r.user?.skills} requested={r.changes?.skills} />
              <DiffChips icon={Wrench} label="Tools" current={r.user?.tools} requested={r.changes?.tools} />
              <div className="flex flex-wrap items-center gap-1.5 text-xs">
                <span className="inline-flex items-center gap-1 font-bold uppercase tracking-wide text-slate-400"><Share2 className="h-3.5 w-3.5" /> Pages:</span>
                {(r.changes?.handles || []).length
                  ? r.changes.handles.map((h, i) => <Badge key={i}>{handleLabel(h)}</Badge>)
                  : <span className="text-slate-400">none</span>}
              </div>
              {r.note && <p className="text-xs italic text-slate-500 dark:text-slate-400">“{r.note}”</p>}
            </div>

            {rejecting === r._id && (
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Why is this rejected? (sent to the user)"
                  className="input-base h-9 flex-1 text-sm" />
                <Button size="sm" loading={reviewMut.isPending}
                  className={cn('bg-rose-600 hover:bg-rose-700')}
                  onClick={() => reviewMut.mutate({ id: r._id, action: 'reject', note })}>
                  Confirm reject
                </Button>
              </div>
            )}
          </div>
        ))}
      </div>
    </Card>
  );
}
