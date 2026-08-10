// Shared enums / constants used across models, controllers and seed data.

export const ROLES = {
  ADMIN: 'ADMIN',
  CEO: 'CEO',
  USER: 'USER',
};

export const USER_TYPES = {
  DESIGNER: 'DESIGNER',
  SOCIAL_HANDLER: 'SOCIAL_HANDLER',
  // Per-organization persona who raises design briefs for their college and
  // picks the designer. The finished design is either posted by a social
  // handler or delivered back to this coordinator.
  COORDINATOR: 'COORDINATOR',
};

export const PLATFORMS = ['LinkedIn', 'Instagram', 'YouTube', 'Facebook'];

// The social-handlers directory also tracks X (Twitter) accounts, which the
// analytics/competitor features (core 4 platforms) don't.
export const SOCIAL_PLATFORMS = [...PLATFORMS, 'X (Twitter)'];

/**
 * Which requested work actually ends up on a social page.
 *
 * Only this work reaches the coordinator's "where should this be posted?" step
 * and, from there, the To Be Posted board. Being digital is not enough: an LED
 * screen design, a website slider or an email banner is digital and has no page
 * to go on, so asking the college to pick Instagram for it is meaningless and
 * would raise posting work no handler can honestly close.
 *
 * Matched on what the coordinator chose in the request form — the work category
 * first, then a short list of items filed under another category that are still
 * social posts in practice.
 */
export const SOCIAL_POST_WORK_CATEGORIES = ['Social Media'];
export const SOCIAL_POST_WORK_ITEMS = ['Animated Social Media Posts'];

// What a rejection feedback point asks the submitter to change. "Reject" means
// the content is not salvageable rather than a specific fix.
export const FEEDBACK_CATEGORIES = ['Image', 'Content', 'Other', 'Reject'];

export const APPROVAL_STATUS = {
  // A DESIGN brief that a coordinator has raised and handed to a designer, who
  // is still working on it (no finished design submitted for approval yet).
  IN_DESIGN: 'IN_DESIGN',
  PENDING: 'PENDING',
  APPROVED: 'APPROVED',
  REJECTED: 'REJECTED',
  RESUBMITTED: 'RESUBMITTED',
  POSTED: 'POSTED',
  // Terminal state for an approved design that does NOT need posting: the final
  // file has been delivered back to the coordinator who raised the brief.
  DELIVERED: 'DELIVERED',
};

// What an approval request is about.
//   DESIGN = a brief a COORDINATOR raises for their org. They pick a DESIGNER,
//     who does the work and submits it; a super admin approves; then it is
//     either allocated to a SOCIAL_HANDLER to post, or delivered back to the
//     coordinator.
//   POST = standalone ready-to-publish content submitted for approval directly.
export const APPROVAL_TYPES = {
  POST: 'POST',
  DESIGN: 'DESIGN',
};

export const TEMPLATE_CATEGORIES = [
  'Placement',
  'Admissions',
  'Workshops',
  'Events',
  'Certifications',
  'Recruitment',
  'Social Media Campaigns',
];

export const ASSET_CATEGORIES = [
  'Logos',
  'Favicons',
  'PNG Files',
  'Backgrounds',
  'Icons',
  'Illustrations',
  'Brand Assets',
  'Center of Excellence',
];

export const NOTIFICATION_TYPES = {
  CONTENT_APPROVED: 'CONTENT_APPROVED',
  CONTENT_REJECTED: 'CONTENT_REJECTED',
  RESUBMISSION_REQUIRED: 'RESUBMISSION_REQUIRED',
  CONTENT_POSTED: 'CONTENT_POSTED',
  NEW_REQUEST: 'NEW_REQUEST',
  WORK_ASSIGNED: 'WORK_ASSIGNED',
  CONTENT_RESUBMITTED: 'CONTENT_RESUBMITTED',
  APPROVAL_COMMENT: 'APPROVAL_COMMENT',
  DESIGN_ASSIGNED: 'DESIGN_ASSIGNED',
  DESIGN_REQUESTED: 'DESIGN_REQUESTED', // coordinator → designer: new brief to work on
  DESIGN_IN_PROGRESS: 'DESIGN_IN_PROGRESS', // a designer claimed the work and is now handling it
  DESIGN_SUBMITTED: 'DESIGN_SUBMITTED', // designer → approvers: finished design ready
  CONTENT_DELIVERED: 'CONTENT_DELIVERED', // approver → coordinator: final design delivered
  PROFILE_UPDATE_SUBMITTED: 'PROFILE_UPDATE_SUBMITTED',
  PROFILE_UPDATE_REVIEWED: 'PROFILE_UPDATE_REVIEWED',
  PLAN_SUBMITTED: 'PLAN_SUBMITTED',
  PLAN_APPROVED: 'PLAN_APPROVED',
  PLAN_REJECTED: 'PLAN_REJECTED',
  PLAN_RESUBMITTED: 'PLAN_RESUBMITTED',
  CONTENT_FORWARDED: 'CONTENT_FORWARDED',
  // Assigned-work lifecycle: the assignee raises a completion request, the
  // super admin approves it (marking the work done) or sends it back.
  WORK_SUBMITTED: 'WORK_SUBMITTED',
  WORK_APPROVED: 'WORK_APPROVED',
  WORK_REJECTED: 'WORK_REJECTED',
  WORK_ACKNOWLEDGED_ELSEWHERE: 'WORK_ACKNOWLEDGED_ELSEWHERE',
  // Approved content given a go-live time, and the reminder when it lands.
  POST_SCHEDULED: 'POST_SCHEDULED',
  // A college asking the admin for something, and the decision that comes back.
  INSTITUTION_REQUEST: 'INSTITUTION_REQUEST',
  REQUEST_APPROVED: 'REQUEST_APPROVED',
  REQUEST_DECLINED: 'REQUEST_DECLINED',
  // The monthly Branding & Marketing report landing for the super admin.
  MONTHLY_REPORT: 'MONTHLY_REPORT',
};

export const ACTIVITY_ACTIONS = {
  TEMPLATE_UPLOAD: 'TEMPLATE_UPLOAD',
  ASSET_UPLOAD: 'ASSET_UPLOAD',
  APPROVAL_SUBMISSION: 'APPROVAL_SUBMISSION',
  APPROVAL_APPROVED: 'APPROVAL_APPROVED',
  APPROVAL_REJECTED: 'APPROVAL_REJECTED',
  APPROVAL_RESUBMITTED: 'APPROVAL_RESUBMITTED',
  WORK_ASSIGNED: 'WORK_ASSIGNED',
  DESIGN_ASSIGNED: 'DESIGN_ASSIGNED',
  POST_COMPLETION: 'POST_COMPLETION',
  USER_CREATED: 'USER_CREATED',
  USER_UPDATED: 'USER_UPDATED',
  REQUEST_RAISED: 'REQUEST_RAISED',
  WEB_TASK_UPDATED: 'WEB_TASK_UPDATED',
  AD_CAMPAIGN_UPDATED: 'AD_CAMPAIGN_UPDATED',
  REPORT_GENERATED: 'REPORT_GENERATED',
  REQUEST_REVIEWED: 'REQUEST_REVIEWED',
  USER_DEACTIVATED: 'USER_DEACTIVATED',
  ANALYTICS_UPDATED: 'ANALYTICS_UPDATED',
  PLAN_SUBMITTED: 'PLAN_SUBMITTED',
  PLAN_REVIEWED: 'PLAN_REVIEWED',
  GOAL_UPDATED: 'GOAL_UPDATED',
  COMPETITOR_UPDATED: 'COMPETITOR_UPDATED',
  SOCIAL_ACCOUNT_UPDATED: 'SOCIAL_ACCOUNT_UPDATED',
  WEBSITE_UPDATED: 'WEBSITE_UPDATED',
  EVENT_UPDATED: 'EVENT_UPDATED',
  SIGNAGE_UPDATED: 'SIGNAGE_UPDATED',
  PROFILE_UPDATED: 'PROFILE_UPDATED',
  DESIGN_FORWARDED: 'DESIGN_FORWARDED',
  DESIGN_REQUESTED: 'DESIGN_REQUESTED', // coordinator raised a brief for a designer
  DESIGN_SUBMITTED: 'DESIGN_SUBMITTED', // designer submitted finished work for approval
  DESIGN_DELIVERED: 'DESIGN_DELIVERED', // approved design delivered to the coordinator
  WORK_SUBMITTED: 'WORK_SUBMITTED',   // assignee asked for their work to be signed off
  WORK_COMPLETED: 'WORK_COMPLETED',   // sign-off granted; the assignment is done
};

// Physical signage (campus banner stands). A location is the fixed stand/frame;
// a banner is what's mounted on it for a given event, forming a change history.
export const SIGNAGE_TYPES = ['Arch banner', 'Foam board', 'Standee', 'Normal banner', 'Other'];

export const SIGNAGE_LOCATION_STATUS = {
  EMPTY: 'EMPTY',
  OCCUPIED: 'OCCUPIED',
  NEEDS_REPLACEMENT: 'NEEDS_REPLACEMENT',
  DAMAGED: 'DAMAGED',
};
