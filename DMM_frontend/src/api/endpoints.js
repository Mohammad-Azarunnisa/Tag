import api from './client.js';

// ---- Auth ----
export const authApi = {
  setupStatus: () => api.get('/auth/setup-status').then((r) => r.data),
  emailStatus: () => api.get('/auth/email-status').then((r) => r.data),
  // `portal` tells the API which product this sign-in is for, so an Admin
  // account is refused here and pointed at the admin console instead.
  login: (data) => api.post('/auth/login', { ...data, portal: 'user' }).then((r) => r.data),
  me: () => api.get('/auth/me').then((r) => r.data),
  forgot: (email) => api.post('/auth/forgot-password', { email }).then((r) => r.data),
  reset: (token, password) => api.post(`/auth/reset-password/${token}`, { password }).then((r) => r.data),
};

// ---- Users (self + admin management) ----
export const userApi = {
  // self
  updateProfile: (formData) =>
    api.put('/users/profile', formData, { headers: { 'Content-Type': 'multipart/form-data' } }).then((r) => r.data),
  completeProfile: (data) => api.put('/users/profile/complete', data).then((r) => r.data),
  myUpdateRequest: () => api.get('/users/profile/update-request').then((r) => r.data),
  requestUpdate: (data) => api.post('/users/profile/update-request', data).then((r) => r.data),
  changePassword: (data) => api.put('/users/password', data).then((r) => r.data),
  updateSettings: (data) => api.put('/users/settings', data).then((r) => r.data),
  // Who you work with and how to reach them. Scoped server-side to the people
  // the caller actually works alongside.
  directory: (params) => api.get('/users/directory', { params }).then((r) => r.data),
  // admin
  list: (params) => api.get('/users', { params }).then((r) => r.data),
  get: (id) => api.get(`/users/${id}`).then((r) => r.data),
  create: (data) => api.post('/users', data).then((r) => r.data),
  update: (id, data) => api.put(`/users/${id}`, data).then((r) => r.data),
  remove: (id) => api.delete(`/users/${id}`).then((r) => r.data),
  resetPassword: (id, password) => api.put(`/users/${id}/reset-password`, { password }).then((r) => r.data),
};

// ---- Analytics (social metrics management) ----
// Social analytics — auto-scoped to the logged-in user's organization.
export const analyticsApi = {
  get: (organizationId) => api.get('/analytics', { params: { organizationId } }).then((r) => r.data),
  report: (platform, organizationId, range, anchor, from, to) => api.get(`/analytics/${platform}/report`, { params: { organizationId, range, anchor, from, to } }).then((r) => r.data),
  history: (platform, organizationId) => api.get(`/analytics/${platform}/history`, { params: { organizationId } }).then((r) => r.data),
  heatmap: (platform, organizationId, metric) => api.get(`/analytics/${platform}/heatmap`, { params: { organizationId, metric } }).then((r) => r.data),
  pulse: () => api.get('/analytics/pulse').then((r) => r.data),
};

// Per-post history (Instagram / Facebook / YouTube) — the API equivalent of the
// LinkedIn post table. View for everyone; sync (pull from the platform) for admins.
export const socialPostApi = {
  list: (platform, organizationId, days) => api.get('/social-posts', { params: { platform, organizationId, days } }).then((r) => r.data),
  summary: (platform, organizationId, range) => api.get('/social-posts/summary', { params: { platform, organizationId, range } }).then((r) => r.data),
  sync: (platform, organizationId) => api.post('/social-posts/sync', { platform, organizationId }).then((r) => r.data),
};

// LinkedIn export hub — dashboard for everyone; uploads for CEO/Admin.
export const linkedinApi = {
  dashboard: (organizationId, days) => api.get('/linkedin/dashboard', { params: { organizationId, days } }).then((r) => r.data),
  followersBaseline: (organizationId, total) => api.post('/linkedin/followers-baseline', { total }, { params: { organizationId } }).then((r) => r.data),
  import: (organizationId, file) => {
    const fd = new FormData();
    fd.append('file', file);
    return api.post('/linkedin/import', fd, { params: { organizationId }, headers: { 'Content-Type': 'multipart/form-data' } }).then((r) => r.data);
  },
};

// ---- Global search (approvals/templates/assets/users, org-scoped) ----
export const searchApi = {
  query: (q) => api.get('/search', { params: { q } }).then((r) => r.data),
};

// ---- Organizations (options for pickers — any authenticated user) ----
export const organizationApi = {
  options: () => api.get('/organizations/options').then((r) => r.data),
  // Only the institutions the caller may act in — their own college, plus
  // anything an Admin was granted.
  myOptions: () => api.get('/organizations/options', { params: { scope: 'mine' } }).then((r) => r.data),
};


// ---- Brand Library / Social Handlers / Premium Packs / Goals (read-only for product) ----
export const libraryApi = {
  brand: (params) => api.get('/brand', { params }).then((r) => r.data),
  socialAccounts: (params) => api.get('/social-accounts', { params }).then((r) => r.data),
  purchases: () => api.get('/purchases').then((r) => r.data),
};

// ---- Growth goals (per organization + platform, read-only here) ----
export const goalApi = {
  list: (organizationId) => api.get('/goals', { params: { organizationId } }).then((r) => r.data),
};

// ---- Post Planner — plan upcoming posts and submit the plan for approval ----
export const planApi = {
  list: (params) => api.get('/plans', { params }).then((r) => r.data),
  get: (id) => api.get(`/plans/${id}`).then((r) => r.data),
  // Planned posts grouped by day: ?date=YYYY-MM-DD or ?from=&to=
  schedule: (params) => api.get('/plans/schedule', { params }).then((r) => r.data),
  create: (data) => api.post('/plans', data).then((r) => r.data),
  update: (id, data) => api.put(`/plans/${id}`, data).then((r) => r.data),
  approve: (id) => api.put(`/plans/${id}/approve`).then((r) => r.data),
  reject: (id, feedback) => api.put(`/plans/${id}/reject`, { feedback }).then((r) => r.data),
  remove: (id) => api.delete(`/plans/${id}`).then((r) => r.data),
  // Remove ONE planned post from a plan (super admin only).
  removeItem: (planId, itemId) => api.delete(`/plans/${planId}/items/${itemId}`).then((r) => r.data),
};

// ---- Dashboard ----
// organizationId matters only for ADMIN accounts (they aren't tied to an org);
// CEO/USER requests are auto-scoped server-side and ignore the param.
export const dashboardApi = {
  stats: (organizationId) => api.get('/dashboard/stats', { params: { organizationId: organizationId || undefined } }).then((r) => r.data),
  charts: (organizationId) => api.get('/dashboard/charts', { params: { organizationId: organizationId || undefined } }).then((r) => r.data),
  activity: (organizationId) => api.get('/dashboard/activity', { params: { organizationId: organizationId || undefined } }).then((r) => r.data),
  topPlatform: (organizationId) => api.get('/dashboard/top-platform', { params: { organizationId: organizationId || undefined } }).then((r) => r.data),
  myUploads: () => api.get('/dashboard/my-uploads').then((r) => r.data),
};

// ---- Calendar (posting calendar — auto-scoped to the user's org) ----
export const calendarApi = {
  month: (month) => api.get('/calendar', { params: { month } }).then((r) => r.data),
  day: (date) => api.get('/calendar/day', { params: { date } }).then((r) => r.data),
};

// ---- Templates ----
export const templateApi = {
  list: (params) => api.get('/templates', { params }).then((r) => r.data),
  get: (id) => api.get(`/templates/${id}`).then((r) => r.data),
  create: (formData) =>
    api.post('/templates', formData, { headers: { 'Content-Type': 'multipart/form-data' } }).then((r) => r.data),
  update: (id, formData) =>
    api.put(`/templates/${id}`, formData, { headers: { 'Content-Type': 'multipart/form-data' } }).then((r) => r.data),
  remove: (id) => api.delete(`/templates/${id}`).then((r) => r.data),
  download: (id) => api.post(`/templates/${id}/download`).then((r) => r.data),
};

// ---- Assets ----
export const assetApi = {
  list: (params) => api.get('/assets', { params }).then((r) => r.data),
  get: (id) => api.get(`/assets/${id}`).then((r) => r.data),
  create: (formData) =>
    api.post('/assets', formData, { headers: { 'Content-Type': 'multipart/form-data' } }).then((r) => r.data),
  update: (id, formData) =>
    api.put(`/assets/${id}`, formData, { headers: { 'Content-Type': 'multipart/form-data' } }).then((r) => r.data),
  remove: (id) => api.delete(`/assets/${id}`).then((r) => r.data),
  download: (id) => api.post(`/assets/${id}/download`).then((r) => r.data),
};

// ---- Approvals ----
export const approvalApi = {
  list: (params) => api.get('/approvals', { params }).then((r) => r.data),
  get: (id) => api.get(`/approvals/${id}`).then((r) => r.data),
  create: (formData) =>
    api.post('/approvals', formData, { headers: { 'Content-Type': 'multipart/form-data' } }).then((r) => r.data),
  claim: (id) => api.put(`/approvals/${id}/claim`).then((r) => r.data),
  // Designer uploads the finished design for their assigned brief (IN_DESIGN → PENDING).
  submitDesign: (id, formData) =>
    api.put(`/approvals/${id}/submit-design`, formData, { headers: { 'Content-Type': 'multipart/form-data' } }).then((r) => r.data),
  approve: (id) => api.put(`/approvals/${id}/approve`).then((r) => r.data),
  reject: (id, feedbackPoints) => api.put(`/approvals/${id}/reject`, { feedbackPoints }).then((r) => r.data),
  resubmit: (id, formData) =>
    api.put(`/approvals/${id}/resubmit`, formData, { headers: { 'Content-Type': 'multipart/form-data' } }).then((r) => r.data),
  markPosted: (id) => api.put(`/approvals/${id}/posted`).then((r) => r.data),
  // Approved content: book the go-live moment; a server sweep posts it then.
  schedule: (id, scheduledAt) => api.put(`/approvals/${id}/schedule`, { scheduledAt }).then((r) => r.data),
  // Post route: allocate an approved design to a social handler who will post it.
  assign: (id, userId) => api.put(`/approvals/${id}/assign`, { userId }).then((r) => r.data),
  // Deliver route: hand an approved design back to the coordinator (no posting).
  deliver: (id) => api.put(`/approvals/${id}/deliver`).then((r) => r.data),
  forward: (id, targets) => api.put(`/approvals/${id}/forward`, { targets }).then((r) => r.data),
  handlers: (organizationId, platform) => api.get('/users/handlers', { params: { organizationId, platform } }).then((r) => r.data),
  designers: () => api.get('/users/designers').then((r) => r.data),
  comment: (id, formData) =>
    api.post(`/approvals/${id}/comments`, formData, { headers: { 'Content-Type': 'multipart/form-data' } }).then((r) => r.data),
  remove: (id) => api.delete(`/approvals/${id}`).then((r) => r.data),
};

// ---- AI assistant (key lives only on the backend) ----
export const aiApi = {
  status: () => api.get('/ai/status').then((r) => r.data),
  chat: (messages) => api.post('/ai/chat', { messages }).then((r) => r.data),
  // Generate on-brand caption/hashtags/description from a short brief.
  draft: (payload) => api.post('/ai/draft', payload).then((r) => r.data),
  // Plain-English read-out of an organization's analytics (server-cached 6h).
  insights: (organization, refresh = false) => api.post('/ai/insights', { organization, refresh }).then((r) => r.data),
  // Pre-approval quality review of a post's copy (approvers only).
  review: (approvalId) => api.post('/ai/review', { approvalId }).then((r) => r.data),
};

// ---- Link preview (Open-Graph thumbnail/title) ----
export const linkApi = {
  preview: (url) => api.get('/link-preview', { params: { url } }).then((r) => r.data),
};

// ---- Events (Zolo event photos, stored in a Drive folder per event) ----
export const eventApi = {
  list: (params) => api.get('/events', { params }).then((r) => r.data),
  create: (formData) => api.post('/events', formData, { headers: { 'Content-Type': 'multipart/form-data' } }).then((r) => r.data),
  // FormData when a cover image is attached, plain JSON when it isn't.
  update: (id, payload) => api.put(`/events/${id}`, payload, payload instanceof FormData
    ? { headers: { 'Content-Type': 'multipart/form-data' } } : undefined).then((r) => r.data),
  addFiles: (id, formData) => api.post(`/events/${id}/files`, formData, { headers: { 'Content-Type': 'multipart/form-data' } }).then((r) => r.data),
  remove: (id) => api.delete(`/events/${id}`).then((r) => r.data),
};

// ---- Signage (campus banner stands + their banner change history) ----
const mpHeaders = { headers: { 'Content-Type': 'multipart/form-data' } };
export const signageApi = {
  locations: (params) => api.get('/signage/locations', { params }).then((r) => r.data),
  createLocation: (formData) => api.post('/signage/locations', formData, mpHeaders).then((r) => r.data),
  updateLocation: (id, formData) => api.put(`/signage/locations/${id}`, formData, mpHeaders).then((r) => r.data),
  removeLocation: (id) => api.delete(`/signage/locations/${id}`).then((r) => r.data),
  banners: (params) => api.get('/signage/banners', { params }).then((r) => r.data),
  placeBanner: (formData) => api.post('/signage/banners', formData, mpHeaders).then((r) => r.data),
  updateBanner: (id, formData) => api.put(`/signage/banners/${id}`, formData, mpHeaders).then((r) => r.data),
  markRemoved: (id) => api.put(`/signage/banners/${id}/remove`).then((r) => r.data),
  removeBanner: (id) => api.delete(`/signage/banners/${id}`).then((r) => r.data),
};

// ---- Notifications ----
export const notificationApi = {
  list: (params) => api.get('/notifications', { params }).then((r) => r.data),
  markRead: (id) => api.put(`/notifications/${id}/read`).then((r) => r.data),
  markAllRead: () => api.put('/notifications/read-all').then((r) => r.data),
  remove: (id) => api.delete(`/notifications/${id}`).then((r) => r.data),
};

export const workAssignmentApi = {
  list: (params) => api.get('/work-assignments', { params }).then((r) => r.data),
  // Assignee moves their own work along: accept it, then ask for sign-off.
  acknowledge: (id) => api.put(`/work-assignments/${id}/acknowledge`).then((r) => r.data),
  // Publishing work closes itself: no note, no second sign-off. Pass a time and
  // it closes at that moment instead of now.
  markPosted: (id, scheduledAt) =>
    api.put(`/work-assignments/${id}/posted`, scheduledAt ? { scheduledAt } : {}).then((r) => r.data),
  // The finished files go up with the note — whoever signs it off and whoever
  // publishes it both need the actual work, not a description of it.
  submit: (id, note, files = []) => {
    if (!files.length) return api.put(`/work-assignments/${id}/submit`, { note }).then((r) => r.data);
    const fd = new FormData();
    fd.append('note', note);
    files.forEach((f) => fd.append('files', f));
    return api.put(`/work-assignments/${id}/submit`, fd, {
      headers: { 'Content-Type': 'multipart/form-data' },
    }).then((r) => r.data);
  },
  // An Admin hands work out inside their own institutions and signs it off.
  create: (data) => api.post('/work-assignments', data).then((r) => r.data),
  review: (id, action, note) => api.put(`/work-assignments/${id}/review`, { action, note }).then((r) => r.data),
};

// ---- Institutional requests: what a college asks the admin for ----
export const institutionRequestApi = {
  list: (params) => api.get('/requests', { params }).then((r) => r.data),
  create: (data) => (
    data instanceof FormData
      ? api.post('/requests', data, { headers: { 'Content-Type': 'multipart/form-data' } }).then((r) => r.data)
      : api.post('/requests', data).then((r) => r.data)
  ),
  remove: (id) => api.delete(`/requests/${id}`).then((r) => r.data),
};

// ---- Activity ----
export const activityApi = {
  list: (params) => api.get('/activity', { params }).then((r) => r.data),
  heatmap: (params) => api.get('/activity/heatmap', { params }).then((r) => r.data),
  day: (params) => api.get('/activity/day', { params }).then((r) => r.data),
};

// ---- Reports / Analytics ----
export const reportApi = {
  analytics: () => api.get('/reports/summary/approval-analytics').then((r) => r.data),
  downloadUrl: (type, format) => `/api/reports/${type}?format=${format}`,
};

// ---- Workflow: the design → post pipeline a college request travels through.
// One record all the way (the request itself); the artwork and the post written
// around it are approvals hanging off it, which the detail response inlines.
export const workflowApi = {
  list: (params) => api.get('/workflow', { params }).then((r) => r.data),
  get: (id) => api.get(`/workflow/${id}`).then((r) => r.data),
  acknowledge: (id) => api.put(`/workflow/${id}/acknowledge`).then((r) => r.data),
  // Files are the finished design on the design half, extra media on the post half.
  submit: (id, { files = [], caption, description, hashtags, note } = {}) => {
    const fd = new FormData();
    files.forEach((f) => fd.append('files', f));
    if (caption !== undefined) fd.append('caption', caption);
    if (description !== undefined) fd.append('description', description);
    if (hashtags !== undefined) fd.append('hashtags', hashtags);
    if (note !== undefined) fd.append('note', note);
    return api.put(`/workflow/${id}/submit`, fd, { headers: { 'Content-Type': 'multipart/form-data' } }).then((r) => r.data);
  },
  review: (id, action, feedbackPoints) => api.put(`/workflow/${id}/review`, { action, feedbackPoints }).then((r) => r.data),
  // `platforms` is the coordinator's page choice on a design Done — dropping it
  // here made the server refuse the very selection they had just made.
  confirm: (id, action, feedbackPoints, platforms) =>
    api.put(`/workflow/${id}/confirm`, { action, feedbackPoints, platforms }).then((r) => r.data),
  markPosted: (id, { postedAt, scheduledFor } = {}) =>
    api.put(`/workflow/${id}/posted`, { postedAt, scheduledFor }).then((r) => r.data),
};
