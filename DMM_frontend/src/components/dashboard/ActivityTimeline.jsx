import {
  Upload, CheckCircle2, XCircle, Send, RefreshCw, FileImage, Activity, MessageSquare, UserCog, BarChart3, BriefcaseBusiness,
} from 'lucide-react';
import { Card, Avatar, EmptyState } from '../ui/primitives.jsx';
import { cn, timeAgo } from '../../lib/utils.js';

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

// An enum turned into words, so an action without a bespoke entry above still
// reads as English rather than as a raw constant.
const prettify = (action) => String(action || '').toLowerCase().replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase());

export default function ActivityTimeline({ activity }) {
  return (
    <Card className="overflow-hidden">
      <div className="border-b border-slate-100 px-5 py-4 dark:border-slate-800">
        <h3 className="font-semibold text-slate-800 dark:text-white">Recent activity</h3>
      </div>
      {!activity?.length ? (
        <div className="p-5">
          <EmptyState icon={Activity} title="No activity yet" description="Actions across the platform will appear here." />
        </div>
      ) : (
        /* Same table treatment as the console's Activity Logs page — three
           columns rather than four, because this card sits in a half-width
           dashboard column. */
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-100 dark:border-slate-800 text-left text-xs uppercase text-slate-400">
                <th className="px-5 py-3 font-semibold">Who</th>
                <th className="px-5 py-3 font-semibold">Activity</th>
                <th className="px-5 py-3 text-right font-semibold">When</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-50 dark:divide-slate-800/50">
              {activity.map((log) => {
                const m = META[log.action] || { icon: Activity, verb: prettify(log.action) || 'made an update', tone: 'neutral' };
                const Icon = m.icon;
                return (
                  <tr key={log._id} className="hover:bg-slate-50/50 dark:hover:bg-slate-800/30">
                    <td className="px-5 py-3 align-top">
                      <span className="flex items-center gap-2.5">
                        <Avatar src={log.user?.avatar} name={log.user?.name} size="sm" />
                        <span className="min-w-0 truncate font-semibold text-slate-700 dark:text-slate-200">{log.user?.name || 'Someone'}</span>
                      </span>
                    </td>
                    <td className="px-5 py-3 align-top">
                      <span className="flex items-start gap-2.5">
                        <span className={cn('mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg', TONES[m.tone])}>
                          <Icon className="h-4 w-4" />
                        </span>
                        <span className="min-w-0">
                          <span className="block text-slate-700 dark:text-slate-200">{m.verb}</span>
                          {log.description && <span className="block truncate text-xs text-slate-400">{log.description}</span>}
                        </span>
                      </span>
                    </td>
                    <td className="whitespace-nowrap px-5 py-3 text-right align-top text-xs text-slate-400">{timeAgo(log.createdAt)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}
