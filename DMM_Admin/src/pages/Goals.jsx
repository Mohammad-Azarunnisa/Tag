import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import {
  Linkedin, Instagram, Youtube, Facebook, Target, Save, Users, Send, Trash2, PenLine, CalendarRange, X,
  Sparkles, TrendingUp, Info,
} from 'lucide-react';
import { goalApi, aiApi } from '../api/endpoints.js';
import PageHeader from '../components/layout/PageHeader.jsx';
import OrgPicker from '../components/OrgPicker.jsx';
import { Button } from '../components/ui/Button.jsx';
import { Card, Input, Skeleton } from '../components/ui/primitives.jsx';
import { cn, formatNumber, formatDate } from '../lib/utils.js';

const PLATFORMS = [
  { key: 'LinkedIn', icon: Linkedin, color: '#0A66C2', audience: 'followers' },
  { key: 'Instagram', icon: Instagram, color: '#E1306C', audience: 'followers' },
  { key: 'YouTube', icon: Youtube, color: '#FF0000', audience: 'subscribers' },
  { key: 'Facebook', icon: Facebook, color: '#1877F2', audience: 'followers' },
];

const DURATIONS = [
  { months: 3, label: '3 months' },
  { months: 4, label: '4 months' },
  { months: 6, label: '6 months' },
  { months: 12, label: '1 year' },
  { months: 0, label: 'Custom' },
];

const todayStr = () => new Date().toISOString().slice(0, 10);
const addMonths = (dateStr, months) => {
  const d = new Date(dateStr);
  d.setMonth(d.getMonth() + months);
  return d.toISOString().slice(0, 10);
};

export default function Goals() {
  return (
    <div>
      <PageHeader title="Growth Goals" subtitle="Set a target per platform for each organization — pick the period (3 months, 6 months, a year…) and track live progress toward it." />
      <OrgPicker>{(orgId) => <Inner orgId={orgId} />}</OrgPicker>
    </div>
  );
}

function Inner({ orgId }) {
  const key = ['org-goals', orgId];
  const { data, isLoading } = useQuery({ queryKey: key, queryFn: () => goalApi.list(orgId) });
  const [editing, setEditing] = useState(null); // platform key being edited

  if (isLoading) {
    return <div className="grid gap-5 md:grid-cols-2">{Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-64" />)}</div>;
  }
  const goals = data?.goals || [];
  const audiences = data?.audiences || {};
  const byPlatform = Object.fromEntries(goals.map((g) => [g.platform, g]));

  return (
    <div className="grid gap-5 md:grid-cols-2">
      {PLATFORMS.map((p) => (
        <PlatformGoalCard
          key={p.key} orgId={orgId} platform={p} goal={byPlatform[p.key]}
          audience={audiences[p.key] || 0}
          editing={editing === p.key}
          onEdit={() => setEditing(p.key)}
          onClose={() => setEditing(null)}
          queryKey={key}
        />
      ))}
    </div>
  );
}

function PlatformGoalCard({ orgId, platform, goal, audience, editing, onEdit, onClose, queryKey }) {
  const { key, icon: Icon, color, audience: audienceWord } = platform; // 'followers' | 'subscribers'
  const qc = useQueryClient();

  const removeMut = useMutation({
    mutationFn: () => goalApi.remove(goal._id),
    onSuccess: () => { toast.success(`${key} goal removed`); qc.invalidateQueries({ queryKey }); },
    onError: (e) => toast.error(e.response?.data?.message || 'Failed'),
  });

  return (
    <Card className="overflow-hidden p-0">
      <div className="flex items-center justify-between border-b border-slate-100 px-5 py-3.5 dark:border-slate-800">
        <span className="flex items-center gap-2.5 font-bold text-slate-800 dark:text-white">
          <span className="flex h-8 w-8 items-center justify-center rounded-lg text-white" style={{ background: color }}><Icon className="h-4.5 w-4.5" /></span>
          {key}
        </span>
        {goal && !editing && (
          <span className="flex items-center gap-1">
            <button onClick={onEdit} title="Edit goal" className="rounded-lg p-1.5 text-slate-400 transition-colors hover:bg-slate-100 hover:text-brand-600 dark:hover:bg-slate-800"><PenLine className="h-4 w-4" /></button>
            <button onClick={() => window.confirm(`Remove the ${key} goal?`) && removeMut.mutate()} title="Remove goal" className="rounded-lg p-1.5 text-slate-400 transition-colors hover:bg-rose-50 hover:text-rose-500 dark:hover:bg-rose-500/10"><Trash2 className="h-4 w-4" /></button>
          </span>
        )}
      </div>

      <div className="p-5">
        {editing ? (
          <GoalForm orgId={orgId} platformKey={key} audienceLabel={audienceWord} currentAudience={audience} goal={goal} onClose={onClose} queryKey={queryKey} />
        ) : goal ? (
          <GoalProgress goal={goal} color={color} audienceLabel={audienceWord} />
        ) : (
          <div className="flex flex-col items-center gap-3 py-6 text-center">
            <Target className="h-8 w-8 text-slate-300 dark:text-slate-600" />
            <p className="text-sm text-slate-400">
              No {key} goal yet{audience > 0 ? <> — currently <span className="font-bold text-slate-600 dark:text-slate-300">{formatNumber(audience)}</span> {audienceWord}</> : ''}.
            </p>
            <Button size="sm" onClick={onEdit}><Target className="h-4 w-4" /> Set a goal</Button>
          </div>
        )}
      </div>
    </Card>
  );
}

// Pace verdict: goal progress compared with how much of the period has passed.
const paceOf = (goalPct, timePct, done) => {
  if (done) return { label: 'Goal reached 🎉', cls: 'bg-emerald-50 text-emerald-600 dark:bg-emerald-500/10 dark:text-emerald-400' };
  if (goalPct >= timePct) return { label: 'On track', cls: 'bg-emerald-50 text-emerald-600 dark:bg-emerald-500/10 dark:text-emerald-400' };
  if (goalPct >= timePct - 15) return { label: 'Slightly behind', cls: 'bg-amber-50 text-amber-600 dark:bg-amber-500/10 dark:text-amber-400' };
  return { label: 'Behind pace', cls: 'bg-rose-50 text-rose-600 dark:bg-rose-500/10 dark:text-rose-400' };
};

function GoalProgress({ goal, color, audienceLabel }) {
  const p = goal.progress || {};
  const now = Date.now();
  const start = new Date(goal.startDate).getTime();
  const end = new Date(goal.endDate).getTime();
  const daysLeft = Math.max(0, Math.ceil((end - now) / 86400000));
  const timePct = Math.min(100, Math.max(0, Math.round(((now - start) / (end - start)) * 100)));
  const over = now > end;

  // Growth is measured from where you STARTED, not from zero: with 11,172
  // followers and a 13,000 target, the goal is the +1,828 gap.
  const target = goal.targetFollowers || 0;
  const baseline = p.baselineFollowers || 0;
  const current = p.currentFollowers || 0;
  const needed = Math.max(0, target - baseline);
  const gained = Math.max(0, current - baseline);
  const toGo = Math.max(0, target - current);
  const goalPct = target > 0
    ? (needed > 0 ? Math.min(100, Math.round((gained / needed) * 100)) : (current >= target ? 100 : 0))
    : 0;
  const pace = paceOf(goalPct, timePct, current >= target && target > 0);

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-slate-50 px-3.5 py-2.5 text-xs dark:bg-slate-800/50">
        <span className="inline-flex items-center gap-1.5 font-semibold text-slate-600 dark:text-slate-300">
          <CalendarRange className="h-3.5 w-3.5 text-brand-500" />
          {formatDate(goal.startDate)} → {formatDate(goal.endDate)}
        </span>
        <span className={cn('font-bold', over ? 'text-rose-500' : 'text-slate-500 dark:text-slate-400')}>
          {over ? 'Period ended' : `${daysLeft} days left`} · {timePct}% of time used
        </span>
      </div>

      {target > 0 && (
        <div>
          {/* Started → Now → Goal */}
          <div className="mb-3 grid grid-cols-3 gap-2 text-center">
            <div className="rounded-xl bg-slate-50 py-2.5 dark:bg-slate-800/50">
              <p className="text-lg font-extrabold text-slate-500 dark:text-slate-400">{formatNumber(baseline)}</p>
              <p className="text-[11px] font-medium text-slate-400">Started with</p>
            </div>
            <div className="rounded-xl py-2.5" style={{ background: `${color}12` }}>
              <p className="text-lg font-extrabold" style={{ color }}>{formatNumber(current)}</p>
              <p className="text-[11px] font-medium text-slate-400">Now</p>
            </div>
            <div className="rounded-xl bg-slate-50 py-2.5 dark:bg-slate-800/50">
              <p className="text-lg font-extrabold text-slate-800 dark:text-white">{formatNumber(target)}</p>
              <p className="text-[11px] font-medium text-slate-400">Goal</p>
            </div>
          </div>

          <div className="mb-1.5 flex items-center justify-between text-sm">
            <span className="inline-flex items-center gap-1.5 font-medium text-slate-600 dark:text-slate-300">
              <Users className="h-4 w-4" /> Goal progress
            </span>
            <span className={cn('rounded-full px-2 py-0.5 text-[11px] font-bold', pace.cls)}>{pace.label}</span>
          </div>
          <div className="relative h-3.5 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800">
            <div className="h-full rounded-full transition-all" style={{ width: `${goalPct}%`, background: color }} />
            {/* time marker: where you SHOULD be if growth were perfectly even */}
            {!over && timePct > 2 && timePct < 98 && (
              <div className="absolute top-0 h-full w-0.5 bg-slate-400/70 dark:bg-slate-500" style={{ left: `${timePct}%` }} title={`${timePct}% of time used`} />
            )}
          </div>
          <div className="mt-1.5 flex items-center justify-between text-xs text-slate-400">
            <span>
              <span className="font-bold text-emerald-600 dark:text-emerald-400">+{formatNumber(gained)}</span> gained of{' '}
              <span className="font-semibold text-slate-500 dark:text-slate-300">{formatNumber(needed)}</span> needed
              {toGo > 0 && <> · <span className="font-semibold">{formatNumber(toGo)}</span> {audienceLabel} to go</>}
            </span>
            <span className="font-bold text-slate-600 dark:text-slate-300">{goalPct}%</span>
          </div>
        </div>
      )}

      {goal.targetPosts > 0 && (
        <PostsBar current={p.postsPublished || 0} target={goal.targetPosts} />
      )}
      {goal.note && <p className="rounded-xl bg-slate-50 p-3 text-sm text-slate-500 dark:bg-slate-800/50">{goal.note}</p>}
      {!p.lastEntry && target > 0 && (
        <p className="text-xs text-amber-600 dark:text-amber-400">No analytics entries yet for this platform — progress will appear once metrics are synced or imported.</p>
      )}
    </div>
  );
}

function PostsBar({ current, target }) {
  const pct = target > 0 ? Math.min(100, Math.round((current / target) * 100)) : 0;
  return (
    <div>
      <div className="mb-1.5 flex items-center justify-between text-sm">
        <span className="inline-flex items-center gap-1.5 font-medium text-slate-600 dark:text-slate-300"><Send className="h-4 w-4" /> Posts published in period</span>
        <span className="font-semibold text-slate-700 dark:text-slate-200">{formatNumber(current)} / {formatNumber(target)}</span>
      </div>
      <div className="h-3 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800">
        <div className="h-full rounded-full bg-sky-500 transition-all" style={{ width: `${pct}%` }} />
      </div>
      <p className="mt-1 text-right text-xs font-semibold text-slate-400">{pct}%</p>
    </div>
  );
}

function GoalForm({ orgId, platformKey, audienceLabel, currentAudience, goal, onClose, queryKey }) {
  const qc = useQueryClient();
  const initialMonths = goal ? 0 : 3; // editing an existing goal starts on its stored dates
  const [form, setForm] = useState({
    targetFollowers: goal?.targetFollowers || '',
    targetPosts: goal?.targetPosts || '',
    startDate: goal ? String(goal.startDate).slice(0, 10) : todayStr(),
    endDate: goal ? String(goal.endDate).slice(0, 10) : addMonths(todayStr(), 3),
    note: goal?.note || '',
  });
  const [months, setMonths] = useState(initialMonths);
  // What Tago last suggested for the current platform + period, kept so the
  // reasoning stays on screen after the numbers are filled in.
  const [suggestion, setSuggestion] = useState(null);

  const suggestMut = useMutation({
    mutationFn: () => aiApi.goalSuggestion({
      organization: orgId,
      platform: platformKey,
      startDate: form.startDate,
      endDate: form.endDate,
    }),
    onSuccess: (data) => {
      setSuggestion(data);
      if (!data.suggestion) {
        toast.error(data.note || 'Not enough history to suggest a target yet');
        return;
      }
      // Fill the form, but leave it editable — this is a suggestion, not a decision.
      setForm((f) => ({
        ...f,
        targetFollowers: String(data.suggestion.targetFollowers),
        targetPosts: String(data.suggestion.targetPosts),
      }));
      toast.success(data.suggestion.aiUsed ? 'Target suggested from your own numbers' : 'Target projected from your own numbers');
    },
    onError: (e) => toast.error(e.response?.data?.message || 'Could not work out a suggestion'),
  });

  // The period drives the whole calculation, so an old suggestion must not linger
  // next to new dates.
  const clearSuggestion = () => setSuggestion(null);

  const pickDuration = (m) => {
    setMonths(m);
    clearSuggestion();
    if (m > 0) setForm((f) => ({ ...f, endDate: addMonths(f.startDate, m) }));
  };
  const setStart = (v) => {
    clearSuggestion();
    setForm((f) => ({ ...f, startDate: v, endDate: months > 0 ? addMonths(v, months) : f.endDate }));
  };

  const saveMut = useMutation({
    mutationFn: () => goalApi.set({
      organization: orgId, platform: platformKey,
      targetFollowers: Number(form.targetFollowers) || 0,
      targetPosts: Number(form.targetPosts) || 0,
      startDate: form.startDate, endDate: form.endDate, note: form.note,
    }),
    onSuccess: () => { toast.success(`${platformKey} goal saved`); qc.invalidateQueries({ queryKey }); onClose(); },
    onError: (e) => toast.error(e.response?.data?.message || 'Failed to save goal'),
  });

  const target = Number(form.targetFollowers) || 0;
  const gap = target - currentAudience;
  const periodDays = Math.max(1, Math.round((new Date(form.endDate) - new Date(form.startDate)) / 86400000));
  const periodLabel = months > 0
    ? (months === 12 ? 'a year' : `${months} months`)
    : `${periodDays} days`;

  return (
    <form onSubmit={(e) => { e.preventDefault(); saveMut.mutate(); }} className="space-y-4">
      {currentAudience > 0 && (
        <p className="rounded-xl bg-slate-50 px-3.5 py-2.5 text-sm text-slate-500 dark:bg-slate-800/50 dark:text-slate-400">
          Currently <span className="font-extrabold text-slate-700 dark:text-white">{formatNumber(currentAudience)}</span> {audienceLabel}
          {target > currentAudience && (
            <> — reaching <span className="font-bold">{formatNumber(target)}</span> means gaining{' '}
            <span className="font-extrabold text-emerald-600 dark:text-emerald-400">+{formatNumber(gap)}</span> in this period.</>
          )}
          {target > 0 && target <= currentAudience && (
            <span className="font-semibold text-amber-600 dark:text-amber-400"> — the target should be higher than the current count.</span>
          )}
        </p>
      )}
      {/* Ask Tago what this period's target should be, based on real history */}
      <div className="flex flex-wrap items-center gap-2 rounded-xl border border-brand-200 bg-brand-50/50 px-3.5 py-2.5 dark:border-brand-500/25 dark:bg-brand-500/[0.07]">
        <Sparkles className="h-4 w-4 shrink-0 text-brand-600 dark:text-brand-400" />
        <span className="text-sm text-slate-600 dark:text-slate-300">
          Not sure what to aim for over {periodLabel}?
        </span>
        <Button type="button" size="sm" variant="outline" className="ml-auto"
          loading={suggestMut.isPending} onClick={() => suggestMut.mutate()}>
          <Sparkles className="h-4 w-4" /> Suggest with AI
        </Button>
      </div>

      {suggestion && <SuggestionCard data={suggestion} audienceLabel={audienceLabel} />}

      <div className="grid grid-cols-2 gap-3">
        <Input label={`Target ${audienceLabel} (total to reach)`} type="number" min="0" value={form.targetFollowers}
          onChange={(e) => setForm({ ...form, targetFollowers: e.target.value })}
          placeholder={currentAudience > 0 ? `e.g. ${formatNumber(Math.round((currentAudience * 1.15) / 100) * 100).replace(/,/g, '')}` : 'e.g. 13000'} />
        <Input label="Target posts in period" type="number" min="0" value={form.targetPosts}
          onChange={(e) => setForm({ ...form, targetPosts: e.target.value })} placeholder="e.g. 40" />
      </div>

      <div>
        <label className="mb-1.5 block text-sm font-medium text-slate-600 dark:text-slate-300">Period</label>
        <div className="flex flex-wrap gap-1.5">
          {DURATIONS.map((d) => (
            <button key={d.label} type="button" onClick={() => pickDuration(d.months)}
              className={cn('rounded-lg border px-3 py-1.5 text-xs font-semibold transition',
                months === d.months
                  ? 'border-transparent bg-brand-600 text-white shadow-soft'
                  : 'border-slate-200 text-slate-500 hover:border-brand-300 dark:border-slate-700 dark:text-slate-300')}>
              {d.label}
            </button>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <Input label="Starts" type="date" value={form.startDate} onChange={(e) => setStart(e.target.value)} />
        <Input label="Ends" type="date" value={form.endDate} min={form.startDate} disabled={months > 0}
          onChange={(e) => setForm({ ...form, endDate: e.target.value })} />
      </div>

      <textarea className="input-base min-h-[52px]" placeholder="Note (optional) — e.g. campaign focus for this period"
        value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} />

      <div className="flex items-center gap-2">
        <Button type="submit" loading={saveMut.isPending}><Save className="h-4 w-4" /> Save goal</Button>
        <Button type="button" variant="ghost" onClick={onClose}><X className="h-4 w-4" /> Cancel</Button>
      </div>
    </form>
  );
}

// What Tago suggested and — more importantly — what it worked that out from, so
// the number can be argued with rather than taken on trust.
function SuggestionCard({ data, audienceLabel }) {
  const s = data.suggestion;
  if (!s) {
    return (
      <div className="flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 px-3.5 py-2.5 text-sm text-amber-800 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-300">
        <Info className="mt-0.5 h-4 w-4 shrink-0" />
        <span>{data.note}</span>
      </div>
    );
  }

  const h = data.history || {};
  const CONFIDENCE = {
    high: { label: 'Strong history', cls: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-400' },
    medium: { label: 'Some history', cls: 'bg-sky-100 text-sky-700 dark:bg-sky-500/15 dark:text-sky-300' },
    low: { label: 'Thin history', cls: 'bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-400' },
    none: { label: 'No history', cls: 'bg-slate-100 text-slate-600 dark:bg-slate-700 dark:text-slate-300' },
  };
  const conf = CONFIDENCE[s.confidence] || CONFIDENCE.low;

  return (
    <div className="space-y-2.5 rounded-xl border border-slate-200 bg-white p-3.5 dark:border-slate-700 dark:bg-slate-900/40">
      <div className="flex flex-wrap items-center gap-2">
        <span className="inline-flex items-center gap-1.5 text-sm font-bold text-slate-800 dark:text-white">
          <TrendingUp className="h-4 w-4 text-brand-600 dark:text-brand-400" />
          +{formatNumber(s.followerGain)} {audienceLabel} over {data.period?.months} month{data.period?.months === 1 ? '' : 's'}
        </span>
        <span className="text-sm text-slate-400">
          → {formatNumber(s.targetFollowers)} total
        </span>
        <span className={cn('ml-auto rounded-full px-2 py-0.5 text-[11px] font-bold', conf.cls)}>{conf.label}</span>
      </div>

      {s.rationale && <p className="text-sm leading-relaxed text-slate-600 dark:text-slate-300">{s.rationale}</p>}

      {/* The measured facts behind it — no AI in these numbers */}
      <div className="flex flex-wrap gap-x-4 gap-y-1 border-t border-slate-100 pt-2 text-xs text-slate-500 dark:border-slate-800 dark:text-slate-400">
        <span>Now: <b className="text-slate-700 dark:text-slate-200">{formatNumber(data.currentAudience)}</b></span>
        {h.perMonth != null && (
          <span>Average: <b className="text-slate-700 dark:text-slate-200">+{formatNumber(h.perMonth)}/month</b></span>
        )}
        {h.recentPerMonth != null && (
          <span>Last 30 days: <b className="text-slate-700 dark:text-slate-200">+{formatNumber(h.recentPerMonth)}/month</b></span>
        )}
        {h.trendDirection && h.trendDirection !== 'unknown' && <span>Trend: <b className="text-slate-700 dark:text-slate-200">{h.trendDirection}</b></span>}
        {h.sampleDays > 0 && <span>From {h.sampleDays} days of data</span>}
        {h.postsPerMonth > 0 && <span>Posting: <b className="text-slate-700 dark:text-slate-200">{h.postsPerMonth}/month</b></span>}
      </div>

      {s.stretch && (
        <p className="text-xs text-slate-500 dark:text-slate-400"><b>To beat it:</b> {s.stretch}</p>
      )}

      {/* Say so when the model's figure was pulled back, rather than quietly changing it */}
      {s.clamped && (
        <p className="flex items-start gap-1.5 text-xs text-amber-700 dark:text-amber-400">
          <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          Tago proposed a figure outside what the trend supports, so it was brought back to a reachable range.
        </p>
      )}
      {!s.aiUsed && (
        <p className="flex items-start gap-1.5 text-xs text-slate-500 dark:text-slate-400">
          <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          Projected straight from your numbers{data.note ? ` — ${data.note}` : ''}.
        </p>
      )}
      <p className="text-xs text-slate-400">Edit the numbers above if you want a different target — nothing is saved until you press Save goal.</p>
    </div>
  );
}
