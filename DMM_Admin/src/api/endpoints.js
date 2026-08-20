import api from './client.js';

export const authApi = {
  setupStatus: () => api.get('/auth/setup-status').then((r) => r.data),
  // `portal` tells the API this sign-in is for the console, so a non-admin
  // account is refused there and pointed at the product app instead.
  login: (data) => api.post('/auth/login', { ...data, portal: 'admin' }).then((r) => r.data),
  me: () => api.get('/auth/me').then((r) => r.data),
};

export const organizationApi = {
  list: (params) => api.get('/organizations', { params }).then((r) => r.data),
  // `{ scope: 'mine' }` narrows to the institutions the caller may actually act
  // in — their own, plus anything granted to an Admin. Use it wherever offering
  // a college they cannot touch would just produce an empty view or a refusal.
  options: (params) => api.get('/organizations/options', { params }).then((r) => r.data),
  get: (id) => api.get(`/organizations/${id}`).then((r) => r.data),
  create: (formData) =>
    api.post('/organizations', formData, { headers: { 'Content-Type': 'multipart/form-data' } }).then((r) => r.data),
  update: (id, formData) =>
    api.put(`/organizations/${id}`, formData, { headers: { 'Content-Type': 'multipart/form-data' } }).then((r) => r.data),
  remove: (id) => api.delete(`/organizations/${id}`).then((r) => r.data),
};

// Growth goals — one goal per organization + platform for a chosen period.
export const goalApi = {
  list: (organizationId) => api.get('/goals', { params: { organizationId } }).then((r) => r.data),
  set: (data) => api.post('/goals', data).then((r) => r.data),
  remove: (id) => api.delete(`/goals/${id}`).then((r) => r.data),
};

// Post plans — users plan their upcoming posts and submit the plan for approval.
export const planApi = {
  list: (params) => api.get('/plans', { params }).then((r) => r.data),
  get: (id) => api.get(`/plans/${id}`).then((r) => r.data),
  // Planned posts grouped by day: ?date=YYYY-MM-DD or ?from=&to=
  schedule: (params) => api.get('/plans/schedule', { params }).then((r) => r.data),
  approve: (id) => api.put(`/plans/${id}/approve`).then((r) => r.data),
  reject: (id, feedback) => api.put(`/plans/${id}/reject`, { feedback }).then((r) => r.data),
  remove: (id) => api.delete(`/plans/${id}`).then((r) => r.data),
  // Remove ONE planned post from a plan (super admin only).
  removeItem: (planId, itemId) => api.delete(`/plans/${planId}/items/${itemId}`).then((r) => r.data),
};

// The instance defaults to JSON, so a FormData body has to say so explicitly —
// axios then fills in the multipart boundary. Create/update take either shape:
// FormData when a profile picture is attached, plain JSON when it isn't.
const multipart = (data) =>
  (typeof FormData !== 'undefined' && data instanceof FormData)
    ? { headers: { 'Content-Type': 'multipart/form-data' } }
    : undefined;

export const userApi = {
  list: (params) => api.get('/users', { params }).then((r) => r.data),
  get: (id) => api.get(`/users/${id}`).then((r) => r.data),
  create: (data) => api.post('/users', data, multipart(data)).then((r) => r.data),
  update: (id, data) => api.put(`/users/${id}`, data, multipart(data)).then((r) => r.data),
  remove: (id) => api.delete(`/users/${id}`).then((r) => r.data),
  resetPassword: (id, password) => api.put(`/users/${id}/reset-password`, { password }).then((r) => r.data),
  updateProfile: (formData) =>
    api.put('/users/profile', formData, { headers: { 'Content-Type': 'multipart/form-data' } }).then((r) => r.data),
  changePassword: (data) => api.put('/users/password', data).then((r) => r.data),
  // Profile update review queue (skills/tools/handles changes await approval).
  profileRequests: (params) => api.get('/users/profile-requests', { params }).then((r) => r.data),
  reviewProfileRequest: (id, action, note) => api.put(`/users/profile-requests/${id}`, { action, note }).then((r) => r.data),
};

export const workAssignmentApi = {
  list: (params) => api.get('/work-assignments', { params }).then((r) => r.data),
  create: (data) => api.post('/work-assignments', data).then((r) => r.data),
  // Sign off a completion request ('approve' marks the work DONE) or send it back.
  review: (id, action, note) => api.put(`/work-assignments/${id}/review`, { action, note }).then((r) => r.data),
  // Move unfinished work to someone else (super admin).
  reassign: (id, assigneeId) => api.put(`/work-assignments/${id}/reassign`, { assigneeId }).then((r) => r.data),
  // Where signed-off work goes: a social handler posts it, or it goes back to
  // the coordinator who raised the request.
  handoff: (id, data) => api.put(`/work-assignments/${id}/handoff`, data).then((r) => r.data),
};

// What the colleges have asked the admin for, and the decisions on them.
export const institutionRequestApi = {
  list: (params) => api.get('/requests', { params }).then((r) => r.data),
  create: (data) => (
    data instanceof FormData
      ? api.post('/requests', data, { headers: { 'Content-Type': 'multipart/form-data' } }).then((r) => r.data)
      : api.post('/requests', data).then((r) => r.data)
  ),
  remove: (id) => api.delete(`/requests/${id}`).then((r) => r.data),
};

// The Branding & Marketing period report: five parts, computed live for any
// window. `export` returns an .xlsx blob.
export const periodReportApi = {
  get: (params) => api.get('/reports/period', { params }).then((r) => r.data),
  export: (params) => api.get('/reports/period/export', { params, responseType: 'blob' }).then((r) => r.data),
  exportPlatformAnalytics: (params) => api.get('/reports/platform-export', { params, responseType: 'blob' }).then((r) => r.data),
};

// Website work, tracked apart from design so it doesn't distort turnaround.
export const webTaskApi = {
  list: (params) => api.get('/web-tasks', { params }).then((r) => r.data),
  create: (data) => api.post('/web-tasks', data).then((r) => r.data),
  update: (id, data) => api.put(`/web-tasks/${id}`, data).then((r) => r.data),
  remove: (id) => api.delete(`/web-tasks/${id}`).then((r) => r.data),
};

// Paid campaigns: the five Ads Manager figures plus leads.
export const adCampaignApi = {
  list: (params) => api.get('/ad-campaigns', { params }).then((r) => r.data),
  create: (data) => api.post('/ad-campaigns', data).then((r) => r.data),
  update: (id, data) => api.put(`/ad-campaigns/${id}`, data).then((r) => r.data),
  remove: (id) => api.delete(`/ad-campaigns/${id}`).then((r) => r.data),
};

export const brandingRegisterApi = {
  list: (params) => api.get('/branding-register', { params }).then((r) => r.data),
  create: (data) => api.post('/branding-register', data).then((r) => r.data),
  update: (id, data) => api.put(`/branding-register/${id}`, data).then((r) => r.data),
  remove: (id) => api.delete(`/branding-register/${id}`).then((r) => r.data),
  seed: () => api.post('/branding-register/seed').then((r) => r.data),
};

// Org-scoped calls — the active org is attached as x-organization-id by the client.
export const analyticsApi = {
  get: (organizationId) => api.get('/analytics', { params: { organizationId } }).then((r) => r.data),
  report: (platform, organizationId, range, anchor, from, to) => api.get(`/analytics/${platform}/report`, { params: { organizationId, range, anchor, from, to } }).then((r) => r.data),
  compare: (platform, metric) => api.get('/analytics/compare', { params: { platform, metric } }).then((r) => r.data),
  overview: () => api.get('/analytics/overview').then((r) => r.data),
  // Headline numbers per organization for one platform (defaults to LinkedIn).
  pulse: (platform) => api.get('/analytics/pulse', { params: { platform } }).then((r) => r.data),
  record: (data) => api.post('/analytics', data).then((r) => r.data),
  clear: (platform, organizationId) => api.delete('/analytics', { params: { platform, organizationId } }).then((r) => r.data),
  import: (formData) => api.post('/analytics/import', formData, { headers: { 'Content-Type': 'multipart/form-data' } }).then((r) => r.data),
  template: () => api.get('/analytics/template', { responseType: 'blob' }).then((r) => r.data),
};

// Per-post history (Instagram / Facebook / YouTube) — pulled from the platform API.
export const socialPostApi = {
  list: (platform, organizationId, days) => api.get('/social-posts', { params: { platform, organizationId, days } }).then((r) => r.data),
  summary: (platform, organizationId, range) => api.get('/social-posts/summary', { params: { platform, organizationId, range } }).then((r) => r.data),
  sync: (platform, organizationId) => api.post('/social-posts/sync', { platform, organizationId }).then((r) => r.data),
};

// LinkedIn export hub — upload any LinkedIn analytics download (Content,
// Visitors, Followers, Competitors); sheets are auto-detected server-side.
export const linkedinApi = {
  dashboard: (organizationId, days) => api.get('/linkedin/dashboard', { params: { organizationId, days } }).then((r) => r.data),
  followersBaseline: (organizationId, total) => api.post('/linkedin/followers-baseline', { total }, { params: { organizationId } }).then((r) => r.data),
  import: (organizationId, file) => {
    const fd = new FormData();
    fd.append('file', file);
    return api.post('/linkedin/import', fd, { params: { organizationId }, headers: { 'Content-Type': 'multipart/form-data' } }).then((r) => r.data);
  },
};

// Meta (Facebook + Instagram) live sync. The master token lives only on the
// backend (env) — these endpoints never see or carry it.
export const metaApi = {
  status: () => api.get('/meta/status').then((r) => r.data),
  accounts: () => api.get('/meta/accounts').then((r) => r.data),
  map: (organization, pageId) => api.post('/meta/map', { organizationId: organization, pageId }).then((r) => r.data),
  automap: () => api.post('/meta/automap').then((r) => r.data),
  sync: (organizationId, platform) => api.post('/meta/sync', { platform }, { params: { organizationId, platform } }).then((r) => r.data),
  adsStatus: () => api.get('/meta/ads/status').then((r) => r.data),
  adsAccounts: () => api.get('/meta/ads/accounts').then((r) => r.data),
  adsMap: (organizationId, adAccountId) => api.post('/meta/ads/map', { organizationId, adAccountId }).then((r) => r.data),
  adsSync: (organizationId, from, to) => api.post('/meta/ads/sync', { from, to }, { params: { organizationId, from, to } }).then((r) => r.data),
  adsReport: (organizationId, range) => api.get('/meta/ads/report', { params: { organizationId, range } }).then((r) => r.data),
};

// YouTube live sync (Data API v3). The API key lives only in the backend env.
export const youtubeApi = {
  status: () => api.get('/youtube/status').then((r) => r.data),
  channel: (organizationId) => api.get('/youtube/channel', { params: { organizationId } }).then((r) => r.data),
  resolve: (q) => api.get('/youtube/resolve', { params: { q } }).then((r) => r.data),
  map: (organizationId, query) => api.post('/youtube/map', { organizationId, query }).then((r) => r.data),
  sync: (organizationId) => api.post('/youtube/sync', {}, { params: { organizationId } }).then((r) => r.data),
};

// Competitor benchmark — org-scoped (active org attached as x-organization-id).
export const competitorApi = {
  list: (platform, organizationId) => api.get('/competitors', { params: { platform, organizationId } }).then((r) => r.data),
  create: (data) => api.post('/competitors', data).then((r) => r.data),
  update: (id, data) => api.put(`/competitors/${id}`, data).then((r) => r.data),
  remove: (id) => api.delete(`/competitors/${id}`).then((r) => r.data),
  import: (formData) => api.post('/competitors/import', formData, { headers: { 'Content-Type': 'multipart/form-data' } }).then((r) => r.data),
  template: () => api.get('/competitors/template', { responseType: 'blob' }).then((r) => r.data),
};

// Approvals — ADMIN is the global head of all organizations and can review,
// approve or reject content for any org. The list spans all orgs unless an
// organizationId is passed; single-item ops are not org-scoped for admins.
export const approvalApi = {
  list: (params) => api.get('/approvals', { params }).then((r) => r.data),
  get: (id) => api.get(`/approvals/${id}`).then((r) => r.data),
  claim: (id) => api.put(`/approvals/${id}/claim`).then((r) => r.data),
  approve: (id, routingData) => api.put(`/approvals/${id}/approve`, routingData || {}).then((r) => r.data),
  reject: (id, feedbackPoints) => api.put(`/approvals/${id}/reject`, { feedbackPoints }).then((r) => r.data),
  // Design routing (super admin, status APPROVED): allocate an approved design
  // to a social handler who will post it.
  assign: (id, userId) => api.put(`/approvals/${id}/assign`, { userId }).then((r) => r.data),
  // Design routing (super admin, status APPROVED): deliver the approved design
  // back to the coordinator who raised it (terminal).
  deliver: (id) => api.put(`/approvals/${id}/deliver`).then((r) => r.data),
  forward: (id, targets) => api.put(`/approvals/${id}/forward`, { targets }).then((r) => r.data),
  // Approving does not close a request — marking it posted does.
  // `postedAt` is when it actually went out. Left off it means now; a past moment
  // is how posts that went live before anyone logged them land on the right day.
  markPosted: (id, postedAt) =>
    api.put(`/approvals/${id}/posted`, postedAt ? { postedAt } : {}).then((r) => r.data),
  schedule: (id, scheduledAt) => api.put(`/approvals/${id}/schedule`, { scheduledAt }).then((r) => r.data),
  handlers: (organizationId, platform) => api.get('/users/handlers', { params: { organizationId, platform } }).then((r) => r.data),
  comment: (id, formData) =>
    api.post(`/approvals/${id}/comments`, formData, { headers: { 'Content-Type': 'multipart/form-data' } }).then((r) => r.data),
  remove: (id) => api.delete(`/approvals/${id}`).then((r) => r.data),
};

// AI assistant — the API key lives only on the backend; the browser only
// ever sends chat messages and receives the reply.
export const aiApi = {
  status: () => api.get('/ai/status').then((r) => r.data),
  chat: (messages) => api.post('/ai/chat', { messages }).then((r) => r.data),
  // Generate on-brand caption/hashtags/description from a short brief.
  draft: (payload) => api.post('/ai/draft', payload).then((r) => r.data),
  // Plain-English read-out of an organization's analytics (server-cached 6h).
  insights: (organization, refresh = false) => api.post('/ai/insights', { organization, refresh }).then((r) => r.data),
  // Pre-approval quality review of a post's copy (approvers only).
  review: (approvalId) => api.post('/ai/review', { approvalId }).then((r) => r.data),
  // A growth target for the chosen period, projected from the organization's own
  // history and explained.
  goalSuggestion: (payload) => api.post('/ai/goal-suggestion', payload).then((r) => r.data),
};

// Open-Graph link preview (thumbnail/title) for external links.
export const linkApi = {
  preview: (url) => api.get('/link-preview', { params: { url } }).then((r) => r.data),
};

// Events — Zolo event photos, stored in a Drive folder auto-created per event.
export const eventApi = {
  list: (params) => api.get('/events', { params }).then((r) => r.data),
  create: (formData) => api.post('/events', formData, { headers: { 'Content-Type': 'multipart/form-data' } }).then((r) => r.data),
  // FormData when a cover image is attached, plain JSON when it isn't.
  update: (id, payload) => api.put(`/events/${id}`, payload, multipart(payload)).then((r) => r.data),
  addFiles: (id, formData) => api.post(`/events/${id}/files`, formData, { headers: { 'Content-Type': 'multipart/form-data' } }).then((r) => r.data),
  remove: (id) => api.delete(`/events/${id}`).then((r) => r.data),
};

// Signage — campus banner stands + their banner change history.
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

// Premium packs / purchases — org-scoped (active org via header).
export const purchaseApi = {
  // Pass { organizationId: 'all' } for the cross-college roll-up. Sending it as a
  // param also stops the client interceptor pinning the request to the currently
  // selected college via the x-organization-id header.
  list: (params) => api.get('/purchases', { params }).then((r) => r.data),
  create: (data) => api.post('/purchases', data).then((r) => r.data),
  update: (id, data) => api.put(`/purchases/${id}`, data).then((r) => r.data),
  remove: (id) => api.delete(`/purchases/${id}`).then((r) => r.data),
};

// Brand Library — flyers / brochures / branding videos (file or link).
export const brandApi = {
  list: (params) => api.get('/brand', { params }).then((r) => r.data),
  create: (formData) => api.post('/brand', formData, { headers: { 'Content-Type': 'multipart/form-data' } }).then((r) => r.data),
  update: (id, data) => api.put(`/brand/${id}`, data).then((r) => r.data),
  remove: (id) => api.delete(`/brand/${id}`).then((r) => r.data),
};

// Template Repository — reusable marketing templates (upload for all; remove/edit super admin only).
export const templateApi = {
  list: (params) => api.get('/templates', { params }).then((r) => r.data),
  get: (id) => api.get(`/templates/${id}`).then((r) => r.data),
  create: (formData) => api.post('/templates', formData, { headers: { 'Content-Type': 'multipart/form-data' } }).then((r) => r.data),
  update: (id, formData) => api.put(`/templates/${id}`, formData, { headers: { 'Content-Type': 'multipart/form-data' } }).then((r) => r.data),
  remove: (id) => api.delete(`/templates/${id}`).then((r) => r.data),
  download: (id) => api.post(`/templates/${id}/download`).then((r) => r.data),
};

// Asset Library — reusable branding assets (upload for all; remove/edit super admin only).
export const assetApi = {
  list: (params) => api.get('/assets', { params }).then((r) => r.data),
  get: (id) => api.get(`/assets/${id}`).then((r) => r.data),
  create: (formData) => api.post('/assets', formData, { headers: { 'Content-Type': 'multipart/form-data' } }).then((r) => r.data),
  update: (id, formData) => api.put(`/assets/${id}`, formData, { headers: { 'Content-Type': 'multipart/form-data' } }).then((r) => r.data),
  remove: (id) => api.delete(`/assets/${id}`).then((r) => r.data),
  download: (id) => api.post(`/assets/${id}/download`).then((r) => r.data),
};


// Social media accounts / handlers directory.
export const socialAccountApi = {
  list: (params) => api.get('/social-accounts', { params }).then((r) => r.data),
  create: (data) => api.post('/social-accounts', data).then((r) => r.data),
  update: (id, data) => api.put(`/social-accounts/${id}`, data).then((r) => r.data),
  remove: (id) => api.delete(`/social-accounts/${id}`).then((r) => r.data),
  import: (formData) => api.post('/social-accounts/import', formData, { headers: { 'Content-Type': 'multipart/form-data' } }).then((r) => r.data),
  template: () => api.get('/social-accounts/template', { responseType: 'blob' }).then((r) => r.data),
};

// Websites / domains inventory directory.
export const websiteApi = {
  list: (params) => api.get('/websites', { params }).then((r) => r.data),
  create: (data) => api.post('/websites', data).then((r) => r.data),
  update: (id, data) => api.put(`/websites/${id}`, data).then((r) => r.data),
  remove: (id) => api.delete(`/websites/${id}`).then((r) => r.data),
  import: (formData) => api.post('/websites/import', formData, { headers: { 'Content-Type': 'multipart/form-data' } }).then((r) => r.data),
  template: () => api.get('/websites/template', { responseType: 'blob' }).then((r) => r.data),
};

export const calendarApi = {
  month: (organizationId, month) => api.get('/calendar', { params: { organizationId, month } }).then((r) => r.data),
  day: (organizationId, date) => api.get('/calendar/day', { params: { organizationId, date } }).then((r) => r.data),
};

export const activityApi = {
  list: (params) => api.get('/activity', { params }).then((r) => r.data),
  heatmap: (params) => api.get('/activity/heatmap', { params }).then((r) => r.data),
  day: (date, organizationId) => api.get('/activity/day', { params: { date, organizationId } }).then((r) => r.data),
};

// Per-recipient notifications. The backend already targets super admins for
// approvals, plan reviews and profile-update requests — this reads that inbox.
export const notificationApi = {
  list: (params) => api.get('/notifications', { params }).then((r) => r.data),
  markRead: (id) => api.put(`/notifications/${id}/read`).then((r) => r.data),
  markAllRead: () => api.put('/notifications/read-all').then((r) => r.data),
  remove: (id) => api.delete(`/notifications/${id}`).then((r) => r.data),
};

// ---- Workflow: the design → post pipeline, for monitoring and for the admin's
// own review at the two approval gates. Same endpoints the product app uses.
export const workflowApi = {
  list: (params) => api.get('/workflow', { params }).then((r) => r.data),
  get: (id) => api.get(`/workflow/${id}`).then((r) => r.data),
  review: (id, action, feedbackPoints) => api.put(`/workflow/${id}/review`, { action, feedbackPoints }).then((r) => r.data),
};
