import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import {
  Bell, CheckCheck, Check, XCircle, RefreshCw, Send, FileText, Trash2, ClipboardList, UserCog,
  MessageSquare, Palette, PackageCheck, Forward,
} from 'lucide-react';
import { notificationApi } from '../api/endpoints.js';
import { useAuthStore } from '../store/authStore.js';
import PageHeader from '../components/layout/PageHeader.jsx';
import { Button } from '../components/ui/Button.jsx';
import { Card, EmptyState, Skeleton } from '../components/ui/primitives.jsx';
import { cn, timeAgo } from '../lib/utils.js';

const ICONS = {
  CONTENT_APPROVED: { icon: Check, color: 'text-emerald-600 bg-emerald-50 dark:bg-emerald-500/10' },
  CONTENT_REJECTED: { icon: XCircle, color: 'text-rose-600 bg-rose-50 dark:bg-rose-500/10' },
  RESUBMISSION_REQUIRED: { icon: RefreshCw, color: 'text-amber-600 bg-amber-50 dark:bg-amber-500/10' },
  CONTENT_POSTED: { icon: Send, color: 'text-violet-600 bg-violet-50 dark:bg-violet-500/10' },
  NEW_REQUEST: { icon: FileText, color: 'text-brand-600 bg-brand-50 dark:bg-brand-500/10' },
  WORK_ASSIGNED: { icon: UserCog, color: 'text-violet-600 bg-violet-50 dark:bg-violet-500/10' },
  CONTENT_RESUBMITTED: { icon: RefreshCw, color: 'text-sky-600 bg-sky-50 dark:bg-sky-500/10' },
  APPROVAL_COMMENT: { icon: MessageSquare, color: 'text-slate-600 bg-slate-100 dark:bg-slate-800' },
  DESIGN_REQUESTED: { icon: Palette, color: 'text-brand-600 bg-brand-50 dark:bg-brand-500/10' },
  DESIGN_ASSIGNED: { icon: UserCog, color: 'text-violet-600 bg-violet-50 dark:bg-violet-500/10' },
  DESIGN_SUBMITTED: { icon: Palette, color: 'text-sky-600 bg-sky-50 dark:bg-sky-500/10' },
  CONTENT_DELIVERED: { icon: PackageCheck, color: 'text-emerald-600 bg-emerald-50 dark:bg-emerald-500/10' },
  CONTENT_FORWARDED: { icon: Forward, color: 'text-sky-600 bg-sky-50 dark:bg-sky-500/10' },
  PROFILE_UPDATE_SUBMITTED: { icon: UserCog, color: 'text-amber-600 bg-amber-50 dark:bg-amber-500/10' },
  PROFILE_UPDATE_REVIEWED: { icon: UserCog, color: 'text-emerald-600 bg-emerald-50 dark:bg-emerald-500/10' },
  PLAN_SUBMITTED: { icon: ClipboardList, color: 'text-brand-600 bg-brand-50 dark:bg-brand-500/10' },
  PLAN_APPROVED: { icon: Check, color: 'text-emerald-600 bg-emerald-50 dark:bg-emerald-500/10' },
  PLAN_REJECTED: { icon: XCircle, color: 'text-rose-600 bg-rose-50 dark:bg-rose-500/10' },
  PLAN_RESUBMITTED: { icon: RefreshCw, color: 'text-sky-600 bg-sky-50 dark:bg-sky-500/10' },
  WORK_SUBMITTED: { icon: Send, color: 'text-violet-600 bg-violet-50 dark:bg-violet-500/10' },
  WORK_APPROVED: { icon: Check, color: 'text-emerald-600 bg-emerald-50 dark:bg-emerald-500/10' },
  WORK_REJECTED: { icon: XCircle, color: 'text-rose-600 bg-rose-50 dark:bg-rose-500/10' },
};

// Notification links are written for the product app's routes. Translate the
// ones that live under a different path here, and don't navigate at all for a
// target this console doesn't have (the catch-all would bounce to /dashboard).
const ROUTE_ALIASES = { '/planner': '/planners', '/profile': '/settings' };
const KNOWN_PREFIXES = ['/approvals', '/planners', '/users', '/notifications', '/settings', '/calendar', '/analytics', '/assigned-work', '/requests', '/reports'];

// Older rows stored a link back to this page, which is a dead end — fall back to
// the page the notification is actually about.
const TYPE_FALLBACK = {
  PLAN_SUBMITTED: '/planners',
  PLAN_APPROVED: '/planners',
  PLAN_REJECTED: '/planners',
  PLAN_RESUBMITTED: '/planners',
  PROFILE_UPDATE_SUBMITTED: '/users',
  WORK_SUBMITTED: '/assigned-work',
  INSTITUTION_REQUEST: '/requests',
  MONTHLY_REPORT: '/reports',
  REQUEST_APPROVED: '/requests',
  REQUEST_DECLINED: '/requests',
};

const adminRoute = (link, type) => {
  const raw = link && link !== '/notifications' ? link : '';
  const path = ROUTE_ALIASES[raw] || raw || TYPE_FALLBACK[type] || '';
  if (!path) return null;
  // Match on the pathname so a link carrying a query string (e.g.
  // /assigned-work?assignment=<id>) still resolves — and keep the query.
  const [pathname] = path.split('?');
  return KNOWN_PREFIXES.some((p) => pathname === p || pathname.startsWith(`${p}/`)) ? path : null;
};

export default function Notifications() {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const user = useAuthStore((s) => s.user);
  const isViewer = !!user?.viewOnly; // Chairman: reads the inbox, changes nothing
  const { data, isLoading } = useQuery({ queryKey: ['notifications', 'all'], queryFn: () => notificationApi.list() });
  const notifications = data?.notifications || [];

  const invalidate = () => qc.invalidateQueries({ queryKey: ['notifications'] });
  const readMut = useMutation({ mutationFn: (id) => notificationApi.markRead(id), onSuccess: invalidate });
  const readAllMut = useMutation({ mutationFn: () => notificationApi.markAllRead(), onSuccess: invalidate });
  const delMut = useMutation({ mutationFn: (id) => notificationApi.remove(id), onSuccess: invalidate });

  // Marking read is a write, which the backend refuses for view-only accounts —
  // so for them opening a notification only follows the link.
  const open = (n) => {
    if (!n.isRead && !isViewer) readMut.mutate(n._id);
    const to = adminRoute(n.link, n.type);
    if (to) navigate(to);
  };

  return (
    <div>
      <PageHeader
        title="Notifications"
        subtitle={`${data?.unreadCount || 0} unread`}
        actions={!isViewer && notifications.some((n) => !n.isRead) && <Button variant="outline" onClick={() => readAllMut.mutate()}><CheckCheck className="h-4 w-4" /> Mark all read</Button>}
      />

      {isLoading ? (
        <div className="space-y-2">{Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-20" />)}</div>
      ) : notifications.length === 0 ? (
        <EmptyState icon={Bell} title="No notifications" description="You're all caught up!" />
      ) : (
        <div className="space-y-2">
          {notifications.map((n) => {
            const cfg = ICONS[n.type] || ICONS.NEW_REQUEST;
            const Icon = cfg.icon;
            return (
              <Card key={n._id} className={cn('flex items-center gap-4 p-4 transition', !n.isRead && 'border-l-4 border-l-brand-500')}>
                <div className={cn('flex h-10 w-10 shrink-0 items-center justify-center rounded-xl', cfg.color)}><Icon className="h-5 w-5" /></div>
                <button className="min-w-0 flex-1 text-left" onClick={() => open(n)}>
                  <p className="text-sm font-semibold text-slate-700 dark:text-slate-200">{n.title}</p>
                  <p className="truncate text-sm text-slate-400">{n.message}</p>
                  <p className="mt-0.5 text-[11px] text-slate-400">{timeAgo(n.createdAt)}</p>
                </button>
                {!n.isRead && <span className="h-2.5 w-2.5 shrink-0 rounded-full bg-brand-500" />}
                {!isViewer && (
                  <button onClick={() => delMut.mutate(n._id)} aria-label="Delete notification" className="rounded-lg p-2 text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800"><Trash2 className="h-4 w-4" /></button>
                )}
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
