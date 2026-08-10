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
