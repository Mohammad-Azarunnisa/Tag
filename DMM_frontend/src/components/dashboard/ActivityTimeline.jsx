import {
  Upload, CheckCircle2, XCircle, Send, RefreshCw, FileImage, Activity, MessageSquare, UserCog, BarChart3, BriefcaseBusiness,
} from 'lucide-react';
import { Card, Avatar, EmptyState } from '../ui/primitives.jsx';
import { timeAgo } from '../../lib/utils.js';

// Plain-language phrasing so non-developers understand each entry at a glance.
// `tone`: 'good' | 'bad' | 'neutral' keeps colour use minimal and consistent.
const META = {
  TEMPLATE_UPLOAD: { icon: FileImage, verb: 'uploaded a template', tone: 'neutral' },
  ASSET_UPLOAD: { icon: Upload, verb: 'uploaded an asset', tone: 'neutral' },
  APPROVAL_SUBMISSION: { icon: Send, verb: 'sent content for approval', tone: 'neutral' },
  APPROVAL_APPROVED: { icon: CheckCircle2, verb: 'approved content', tone: 'good' },
  APPROVAL_REJECTED: { icon: MessageSquare, verb: 'requested changes', tone: 'bad' },
  APPROVAL_RESUBMITTED: { icon: RefreshCw, verb: 'resubmitted content', tone: 'neutral' },
  WORK_ASSIGNED: { icon: BriefcaseBusiness, verb: 'assigned work', tone: 'neutral' },
  POST_COMPLETION: { icon: CheckCircle2, verb: 'marked content as posted', tone: 'good' },
  USER_CREATED: { icon: UserCog, verb: 'added a team member', tone: 'neutral' },
  USER_UPDATED: { icon: UserCog, verb: 'updated a team member', tone: 'neutral' },
  USER_DEACTIVATED: { icon: XCircle, verb: 'removed a team member', tone: 'bad' },
  ANALYTICS_UPDATED: { icon: BarChart3, verb: 'updated analytics', tone: 'neutral' },
  COMPETITOR_UPDATED: { icon: BarChart3, verb: 'updated competitors', tone: 'neutral' },
};
const TONES = {
  good: 'text-emerald-600 bg-emerald-50 dark:bg-emerald-500/10',
  bad: 'text-rose-600 bg-rose-50 dark:bg-rose-500/10',
  neutral: 'text-slate-500 bg-slate-100 dark:bg-slate-800',
};

export default function ActivityTimeline({ activity }) {
  return (
    <Card className="p-5">
      <h3 className="mb-4 font-semibold text-slate-800 dark:text-white">Recent activity</h3>
      {!activity?.length ? (
        <EmptyState icon={Activity} title="No activity yet" description="Actions across the platform will appear here." />
      ) : (
        <div className="space-y-0.5">
          {activity.map((log) => {
            const m = META[log.action] || { icon: Activity, verb: 'made an update', tone: 'neutral' };
            const Icon = m.icon;
            return (
              <div key={log._id} className="flex items-center gap-3 rounded-xl px-2 py-2.5 hover:bg-slate-50 dark:hover:bg-slate-800/50">
                <div className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full ${TONES[m.tone]}`}>
                  <Icon className="h-4 w-4" />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm text-slate-700 dark:text-slate-200">
                    <span className="font-semibold">{log.user?.name || 'Someone'}</span> {m.verb}
                  </p>
                  {log.description && <p className="truncate text-xs text-slate-400">{log.description}</p>}
                </div>
                <span className="shrink-0 text-[11px] text-slate-400">{timeAgo(log.createdAt)}</span>
              </div>
            );
          })}
        </div>
      )}
    </Card>
  );
}
