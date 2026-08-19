import {
  Activity, BarChart3, BriefcaseBusiness, CalendarDays, CheckCircle2, FileImage, Globe, Inbox,
  Megaphone, MessageSquare, Palette, Presentation, RefreshCw, Send, Share2, Target, Upload,
  UserCog, UserPlus, UserX,
} from 'lucide-react';

// What each logged action means in plain language.
//
// Every ActivityLog row already carries a `description` written where the action
// happened — 'Submitted design "Freshers poster" for approval', 'Approved
// "Placement banner"'. That is the exact thing the person did, so it is what the
// feed should show. This map is the fallback for rows written before a
// description was recorded, and it covers every action in the backend's
// ACTIVITY_ACTIONS (config/constants.js) so nothing can fall through to a vague
// "did something" again. Keep the two in step when an action is added.
export const ACTIVITY_VERBS = {
  TEMPLATE_UPLOAD: 'uploaded a template',
  ASSET_UPLOAD: 'uploaded an asset',
  APPROVAL_SUBMISSION: 'submitted a request for approval',
  APPROVAL_APPROVED: 'approved content',
  APPROVAL_REJECTED: 'requested changes on content',
  APPROVAL_RESUBMITTED: 'resubmitted content after changes',
  WORK_ASSIGNED: 'assigned work to someone',
  DESIGN_ASSIGNED: 'took on design work',
  POST_COMPLETION: 'marked content as posted',
  USER_CREATED: 'added a team member',
  USER_UPDATED: 'updated a team member',
  USER_DEACTIVATED: 'removed a team member',
  REQUEST_RAISED: 'raised a request',
  REQUEST_REVIEWED: 'answered a college request',
  WEB_TASK_UPDATED: 'updated a website task',
  AD_CAMPAIGN_UPDATED: 'updated a paid campaign',
  REPORT_GENERATED: 'generated a report',
  ANALYTICS_UPDATED: 'updated analytics',
  PLAN_SUBMITTED: 'submitted a post plan',
  PLAN_REVIEWED: 'reviewed a post plan',
  GOAL_UPDATED: 'updated a growth goal',
  COMPETITOR_UPDATED: 'updated competitors',
  SOCIAL_ACCOUNT_UPDATED: 'updated a social account',
  WEBSITE_UPDATED: 'updated a website',
  EVENT_UPDATED: 'updated an event',
  SIGNAGE_UPDATED: 'updated campus signage',
  PROFILE_UPDATED: 'updated their profile',
  DESIGN_FORWARDED: 'forwarded a design to handlers',
  DESIGN_REQUESTED: 'raised a design brief',
  DESIGN_SUBMITTED: 'submitted a design for approval',
  DESIGN_DELIVERED: 'delivered an approved design',
  WORK_SUBMITTED: 'asked for their work to be signed off',
  WORK_COMPLETED: 'signed off completed work',
};

// Descriptions are written as standalone sentences ('Approved "Placement
// banner"'), but the feed reads them straight after a name, so the leading
// capital has to go. Only when it is a plain capitalised word — a description
// opening on "LinkedIn" or an acronym keeps its case.
const followName = (text) =>
  (/^[A-Z][a-z]/.test(text) ? text[0].toLowerCase() + text.slice(1) : text);

// The sentence shown after the person's name. Prefers what was actually
// recorded; falls back to the action's verb, then to a neutral catch-all.
export const activityText = (log) => {
  const described = log?.description?.trim();
  if (described) return followName(described);
  return ACTIVITY_VERBS[log?.action] || 'recorded an activity';
};

// ---------------------------------------------------------------------------
// How an action is presented: its icon, its short label, and its tone.
//
// This lived as a private copy inside ActivityLogs, the Overview feed and the
// heatmap card, which is why the three drifted apart — each covered a different
// subset of actions and labelled them differently. One map, imported by all of
// them, is what keeps the audit trail reading the same wherever it appears.
// `tone`: 'good' for a positive outcome, 'bad' for a removal or rejection,
// 'neutral' otherwise — colour stays sparing so it means something.
export const ACTION_TONES = {
  good: 'text-emerald-600 bg-emerald-50 dark:bg-emerald-500/10',
  bad: 'text-rose-600 bg-rose-50 dark:bg-rose-500/10',
  neutral: 'text-slate-500 bg-slate-100 dark:bg-slate-800',
};

export const ACTION_META = {
  TEMPLATE_UPLOAD: { icon: FileImage, label: 'Template added', tone: 'neutral' },
  ASSET_UPLOAD: { icon: Upload, label: 'Asset added', tone: 'neutral' },
  APPROVAL_SUBMISSION: { icon: Send, label: 'Sent for approval', tone: 'neutral' },
  APPROVAL_APPROVED: { icon: CheckCircle2, label: 'Approved', tone: 'good' },
  APPROVAL_REJECTED: { icon: MessageSquare, label: 'Changes requested', tone: 'bad' },
  APPROVAL_RESUBMITTED: { icon: RefreshCw, label: 'Resubmitted', tone: 'neutral' },
  POST_COMPLETION: { icon: CheckCircle2, label: 'Posted', tone: 'good' },
  USER_CREATED: { icon: UserPlus, label: 'Member added', tone: 'good' },
  USER_UPDATED: { icon: UserCog, label: 'Member updated', tone: 'neutral' },
  USER_DEACTIVATED: { icon: UserX, label: 'Member removed', tone: 'bad' },
  ANALYTICS_UPDATED: { icon: BarChart3, label: 'Analytics updated', tone: 'neutral' },
  COMPETITOR_UPDATED: { icon: BarChart3, label: 'Competitors updated', tone: 'neutral' },
  REPORT_GENERATED: { icon: BarChart3, label: 'Report generated', tone: 'neutral' },
  WORK_ASSIGNED: { icon: BriefcaseBusiness, label: 'Work assigned', tone: 'neutral' },
  WORK_SUBMITTED: { icon: Send, label: 'Work submitted', tone: 'neutral' },
  WORK_COMPLETED: { icon: CheckCircle2, label: 'Work signed off', tone: 'good' },
  DESIGN_ASSIGNED: { icon: Palette, label: 'Design taken on', tone: 'neutral' },
  DESIGN_REQUESTED: { icon: Palette, label: 'Design brief raised', tone: 'neutral' },
  DESIGN_SUBMITTED: { icon: Palette, label: 'Design submitted', tone: 'neutral' },
  DESIGN_FORWARDED: { icon: Palette, label: 'Design forwarded', tone: 'neutral' },
  DESIGN_DELIVERED: { icon: Palette, label: 'Design delivered', tone: 'good' },
  REQUEST_RAISED: { icon: Inbox, label: 'Request raised', tone: 'neutral' },
  REQUEST_REVIEWED: { icon: Inbox, label: 'Request answered', tone: 'good' },
  PLAN_SUBMITTED: { icon: CalendarDays, label: 'Plan submitted', tone: 'neutral' },
  PLAN_REVIEWED: { icon: CalendarDays, label: 'Plan reviewed', tone: 'good' },
  GOAL_UPDATED: { icon: Target, label: 'Goal updated', tone: 'neutral' },
  PROFILE_UPDATED: { icon: UserCog, label: 'Profile updated', tone: 'neutral' },
  SOCIAL_ACCOUNT_UPDATED: { icon: Share2, label: 'Social account updated', tone: 'neutral' },
  WEBSITE_UPDATED: { icon: Globe, label: 'Website updated', tone: 'neutral' },
  WEB_TASK_UPDATED: { icon: Globe, label: 'Website task updated', tone: 'neutral' },
  EVENT_UPDATED: { icon: CalendarDays, label: 'Event updated', tone: 'neutral' },
  SIGNAGE_UPDATED: { icon: Presentation, label: 'Signage updated', tone: 'neutral' },
  AD_CAMPAIGN_UPDATED: { icon: Megaphone, label: 'Campaign updated', tone: 'neutral' },
};

// An action with no bespoke entry still reads as English, not as a raw constant.
const prettify = (action) => String(action || '')
  .toLowerCase().replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase());

export const actionLabel = (action) => ACTION_META[action]?.label || prettify(action) || 'Activity';
export const actionIcon = (action) => ACTION_META[action]?.icon || Activity;
export const actionTone = (action) => ACTION_TONES[ACTION_META[action]?.tone || 'neutral'];

// Every action the backend can log, as { value, label } sorted for a filter.
export const ACTION_OPTIONS = Array.from(
  new Set([...Object.keys(ACTION_META), ...Object.keys(ACTIVITY_VERBS)])
)
  .map((value) => ({ value, label: actionLabel(value) }))
  .sort((a, b) => a.label.localeCompare(b.label));

// A row's own recorded description is the truest account of what happened, so it
// is shown as written. The action's verb covers rows logged before descriptions
// were kept.
export const activityDetail = (log) => log?.description?.trim() || ACTIVITY_VERBS[log?.action] || '—';
