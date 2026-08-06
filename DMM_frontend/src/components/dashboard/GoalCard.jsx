import { useQuery } from '@tanstack/react-query';
import { Linkedin, Instagram, Youtube, Facebook, Target, Users, Send } from 'lucide-react';
import { goalApi } from '../../api/endpoints.js';
import { Card } from '../ui/primitives.jsx';
import { formatNumber, cn } from '../../lib/utils.js';

const PLATFORM_META = {
  LinkedIn: { icon: Linkedin, color: '#0A66C2' },
  Instagram: { icon: Instagram, color: '#E1306C' },
  YouTube: { icon: Youtube, color: '#FF0000' },
  Facebook: { icon: Facebook, color: '#1877F2' },
};
const fmtDate = (d) => new Date(d).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });

// Shows the org's growth goals — one block per platform that has a goal set.
// Renders nothing until the admin sets at least one goal.
export default function GoalCard({ orgId }) {
  const { data } = useQuery({ queryKey: ['org-goals', orgId], queryFn: () => goalApi.list(orgId), enabled: !!orgId });
  const goals = (data?.goals || []).filter((g) => g.targetFollowers > 0 || g.targetPosts > 0);
  if (!goals.length) return null;

  return (
    <Card className="p-5">
      <h3 className="mb-4 flex items-center gap-2 font-bold text-slate-800 dark:text-white">
        <Target className="h-5 w-5 text-brand-600" /> Growth goals
      </h3>
      <div className={cn('grid gap-5', goals.length > 1 && 'sm:grid-cols-2')}>
        {goals.map((g) => <PlatformGoal key={g._id} goal={g} />)}
      </div>
    </Card>
  );
}

function PlatformGoal({ goal }) {
  const meta = PLATFORM_META[goal.platform] || {};
  const Icon = meta.icon || Target;
  const p = goal.progress || {};
  const daysLeft = Math.max(0, Math.ceil((new Date(goal.endDate) - Date.now()) / 86400000));
  const audience = goal.platform === 'YouTube' ? 'subscribers' : 'followers';

  // Growth is measured from the starting point: with 11,172 followers and a
  // 13,000 target, progress tracks the +1,828 gap — not current ÷ target.
  const target = goal.targetFollowers || 0;
  const baseline = p.baselineFollowers || 0;
  const current = p.currentFollowers || 0;
  const needed = Math.max(0, target - baseline);
  const gained = Math.max(0, current - baseline);
  const pct = target > 0
    ? (needed > 0 ? Math.min(100, Math.round((gained / needed) * 100)) : (current >= target ? 100 : 0))
    : 0;

  return (
    <div className="rounded-xl border border-slate-100 p-4 dark:border-slate-800">
      <div className="mb-3 flex items-center justify-between">
        <span className="inline-flex items-center gap-2 text-sm font-bold text-slate-700 dark:text-slate-200">
          <span className="flex h-6 w-6 items-center justify-center rounded-md text-white" style={{ background: meta.color || '#64748b' }}>
            <Icon className="h-3.5 w-3.5" />
          </span>
          {goal.platform}
        </span>
        <span className="text-[11px] font-semibold text-slate-400">
          {fmtDate(goal.startDate)} → {fmtDate(goal.endDate)} · {daysLeft ? `${daysLeft}d left` : 'ended'}
        </span>
      </div>
      <div className="space-y-3">
        {target > 0 && (
          <div>
            <div className="mb-1 flex items-center justify-between text-xs">
              <span className="inline-flex items-center gap-1 font-medium text-slate-500 dark:text-slate-400">
                <Users className="h-3.5 w-3.5" /> {formatNumber(current)} of {formatNumber(target)} {audience}
              </span>
              <span className="font-semibold text-slate-600 dark:text-slate-300">
                <span className="text-emerald-600 dark:text-emerald-400">+{formatNumber(gained)}</span> / {formatNumber(needed)} <span className="text-slate-400">({pct}%)</span>
              </span>
            </div>
            <div className="h-2 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800">
              <div className="h-full rounded-full transition-all" style={{ width: `${pct}%`, background: meta.color || '#7c3aed' }} />
            </div>
          </div>
        )}
        {goal.targetPosts > 0 && (
          <div>
            <div className="mb-1 flex items-center justify-between text-xs">
              <span className="inline-flex items-center gap-1 font-medium text-slate-500 dark:text-slate-400"><Send className="h-3.5 w-3.5" /> posts</span>
              <span className="font-semibold text-slate-600 dark:text-slate-300">
                {formatNumber(p.postsPublished || 0)} / {formatNumber(goal.targetPosts)}
                <span className="text-slate-400"> ({Math.min(100, Math.round(((p.postsPublished || 0) / goal.targetPosts) * 100))}%)</span>
              </span>
            </div>
            <div className="h-2 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800">
              <div className="h-full rounded-full bg-sky-500 transition-all" style={{ width: `${Math.min(100, Math.round(((p.postsPublished || 0) / goal.targetPosts) * 100))}%` }} />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
