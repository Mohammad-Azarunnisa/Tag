// Read-only data tools the AI assistant can call. Each tool queries the live
// database and returns compact JSON for the model to reason over. Tools never
// mutate anything, and results are scoped by the calling user's role where the
// data is personal (approvals, plans).

import Organization from '../models/Organization.js';
import Analytics from '../models/Analytics.js';
import Goal from '../models/Goal.js';
import ApprovalRequest from '../models/ApprovalRequest.js';
import PostPlan from '../models/PostPlan.js';
import Template from '../models/Template.js';
import Asset from '../models/Asset.js';
import BrandAsset from '../models/BrandAsset.js';
import Event from '../models/Event.js';
import SignageLocation from '../models/SignageLocation.js';
import SignageBanner from '../models/SignageBanner.js';
import User from '../models/User.js';
import Website from '../models/Website.js';
import Purchase from '../models/Purchase.js';
import ActivityLog from '../models/ActivityLog.js';
import { computeProgress } from '../controllers/goalController.js';
import { PLATFORMS, ROLES, APPROVAL_STATUS } from '../config/constants.js';

// Metrics that are lifetime totals (report end-of-period value, not a sum).
const STOCK_FIELDS = new Set(['followers', 'subscribers', 'engagementRate', 'clickThroughRate', 'leadConversionRate', 'profilesManaged', 'followersLast30Days']);
const YT_STOCK = new Set(['views', 'videoCount', 'comments', 'watchHours']);
// Period fields worth summing for a window summary.
const PERIOD_FIELDS = [
  'newFollowers', 'impressions', 'uniqueImpressions', 'reach', 'searchAppearances', 'views', 'watchHours',
  'postsPublished', 'clicks', 'reactions', 'comments', 'reposts', 'interactions',
  'pageViews', 'uniqueVisitors', 'visits', 'linkClicks', 'leads',
];

const escapeRegex = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const iso = (d) => (d ? new Date(d).toISOString().slice(0, 10) : null);

// Resolve an organization by (partial) name so the model can say "NCET".
const resolveOrg = async (name) => {
  if (!name) return null;
  const exact = await Organization.findOne({ name: new RegExp(`^${escapeRegex(name)}$`, 'i') }).lean();
  if (exact) return exact;
  return Organization.findOne({ name: new RegExp(escapeRegex(name), 'i') }).lean();
};

// ---- Tool definitions (Anthropic tool schema) ----
export const TOOL_DEFINITIONS = [
  {
    name: 'list_organizations',
    description: 'List every organization on the platform with its website and brand color. Use this first when you are unsure of exact organization names.',
    input_schema: { type: 'object', properties: {}, required: [] },
  },
  {
    name: 'social_media_overview',
    description: 'Latest audience size (followers/subscribers) for EVERY organization on EVERY platform in one call, with the date of the last data entry. Best for comparisons and "which org is biggest/growing" questions.',
    input_schema: { type: 'object', properties: {}, required: [] },
  },
  {
    name: 'platform_metrics',
    description: 'Detailed metrics for one organization on one platform over a recent window: latest audience, growth vs the start of the window, and totals for period metrics (impressions, reach, interactions, clicks…).',
    input_schema: {
      type: 'object',
      properties: {
        organization: { type: 'string', description: 'Organization name, e.g. "NCET"' },
        platform: { type: 'string', enum: PLATFORMS },
        days: { type: 'number', description: 'Window length in days (default 28, max 365)' },
      },
      required: ['organization', 'platform'],
    },
  },
  {
    name: 'growth_goals',
    description: "An organization's growth goals per platform with live progress: target vs current followers, followers gained since the goal started, posts published in the period, and time remaining.",
    input_schema: {
      type: 'object',
      properties: { organization: { type: 'string', description: 'Organization name' } },
      required: ['organization'],
    },
  },
  {
    name: 'approvals_summary',
    description: 'Content approval requests: counts by status and platform plus the most recent requests. Optionally filter to one organization and/or a recent window.',
    input_schema: {
      type: 'object',
      properties: {
        organization: { type: 'string', description: 'Organization name (optional)' },
        days: { type: 'number', description: 'Only requests created in the last N days (optional)' },
      },
      required: [],
    },
  },
  {
    name: 'post_plans',
    description: 'Post planner submissions: upcoming posting plans and their approval status, window and post counts. Optionally filter by organization or status.',
    input_schema: {
      type: 'object',
      properties: {
        organization: { type: 'string', description: 'Organization name (optional)' },
        status: { type: 'string', enum: ['PENDING', 'APPROVED', 'REJECTED', 'RESUBMITTED'] },
      },
      required: [],
    },
  },
  {
    name: 'templates_and_assets',
    description: 'The Template Repository and Asset Library: total counts, breakdown by category and by college (items can belong to one college or be shared across all), download counts, and the most recent uploads. Optionally search by name or filter to one organization.',
    input_schema: {
      type: 'object',
      properties: {
        organization: { type: 'string', description: 'Organization name (optional) — also returns shared items' },
        search: { type: 'string', description: 'Match against item names (optional)' },
      },
      required: [],
    },
  },
  {
    name: 'brand_library',
    description: 'Brand Library material per organization: flyers, brochures, branding videos, images and external links. Counts by category plus recent items.',
    input_schema: {
      type: 'object',
      properties: { organization: { type: 'string', description: 'Organization name (optional)' } },
      required: [],
    },
  },
  {
    name: 'events_list',
    description: 'College/marketing events captured by the team, each with its date, location, related organization and photo-folder link. Optionally search by name.',
    input_schema: {
      type: 'object',
      properties: { search: { type: 'string', description: 'Match against event names (optional)' } },
      required: [],
    },
  },
  {
    name: 'signage_overview',
    description: 'Physical campus signage: banner stands (code, place, type, fixed size, status occupied/empty/needs replacement/damaged), what banner is currently mounted on each and for which event, plus per-stand banner history counts.',
    input_schema: { type: 'object', properties: {}, required: [] },
  },
  {
    name: 'team_members',
    description: 'People on the platform: counts by role (Super Admin / org Admin / User) and the member list with role and organization.',
    input_schema: { type: 'object', properties: {}, required: [] },
  },
  {
    name: 'websites_list',
    description: "The group's website inventory: each institution's domain, site type, hosting provider and tech stack.",
    input_schema: { type: 'object', properties: {}, required: [] },
  },
  {
    name: 'premium_purchases',
    description: 'Premium packs / tools / subscriptions purchased (Canva Pro, Envato…): vendor, seats, cost, purchase and expiry dates — including what expires soon. Admin/org-head data.',
    input_schema: {
      type: 'object',
      properties: { organization: { type: 'string', description: 'Organization name (optional)' } },
      required: [],
    },
  },
  {
    name: 'social_handlers',
    description: 'Who manages each social media account per organization: account name, platform, owner and the coordinators handling it. Admin/org-head data.',
    input_schema: {
      type: 'object',
      properties: { organization: { type: 'string', description: 'Organization name (optional)' } },
      required: [],
    },
  },
  {
    name: 'recent_activity',
    description: 'The platform activity log: who did what recently (uploads, approvals, analytics imports, goal changes…). Optionally filter to the last N days.',
    input_schema: {
      type: 'object',
      properties: { days: { type: 'number', description: 'Only activity from the last N days (default 7, max 90)' } },
      required: [],
    },
  },
];

// ---- Tool handlers ----
const handlers = {
  async list_organizations() {
    const orgs = await Organization.find({ isActive: true }).select('name description website color').sort({ name: 1 }).lean();
    return orgs.map((o) => ({ name: o.name, website: o.website || null, color: o.color, description: o.description || undefined }));
  },

  async social_media_overview() {
    const [orgs, latest] = await Promise.all([
      Organization.find({ isActive: true }).select('name').lean(),
      Analytics.aggregate([
        { $sort: { date: -1 } },
        {
          $group: {
            _id: { org: '$organization', platform: '$platform' },
            followers: { $first: '$followers' },
            subscribers: { $first: '$subscribers' },
            engagementRate: { $first: '$engagementRate' },
            date: { $first: '$date' },
          },
        },
      ]),
    ]);
    const nameById = Object.fromEntries(orgs.map((o) => [String(o._id), o.name]));
    return latest
      .filter((r) => nameById[String(r._id.org)])
      .map((r) => ({
        organization: nameById[String(r._id.org)],
        platform: r._id.platform,
        audience: r._id.platform === 'YouTube' ? r.subscribers : r.followers,
        engagementRate: r.engagementRate || undefined,
        lastEntry: iso(r.date),
      }));
  },

  async platform_metrics({ organization, platform, days = 28 }) {
    const org = await resolveOrg(organization);
    if (!org) return { error: `No organization matching "${organization}" — call list_organizations for valid names.` };
    if (!PLATFORMS.includes(platform)) return { error: `platform must be one of ${PLATFORMS.join(', ')}` };
    const windowDays = Math.min(Math.max(Number(days) || 28, 1), 365);
    const since = new Date(Date.now() - windowDays * 86400000);

    const [latest, baseline, snaps] = await Promise.all([
      Analytics.findOne({ organization: org._id, platform }).sort({ date: -1 }).lean(),
      Analytics.findOne({ organization: org._id, platform, date: { $lte: since } }).sort({ date: -1 }).lean(),
      Analytics.find({ organization: org._id, platform, date: { $gt: since } }).sort({ date: 1 }).lean(),
    ]);
    if (!latest) return { organization: org.name, platform, note: 'No analytics data recorded yet for this platform.' };

    const audienceField = platform === 'YouTube' ? 'subscribers' : 'followers';
    const isStock = (f) => STOCK_FIELDS.has(f) || (platform === 'YouTube' && YT_STOCK.has(f));
    const totals = {};
    for (const f of PERIOD_FIELDS) {
      if (isStock(f)) continue;
      const sum = snaps.reduce((a, s) => a + (s[f] || 0), 0);
      if (sum > 0) totals[f] = sum;
    }
    // For lifetime counters report the end-of-window value instead of a sum.
    const stocks = {};
    for (const f of ['views', 'videoCount', 'comments', 'watchHours']) {
      if (isStock(f) && latest[f]) stocks[f] = latest[f];
    }
    return {
      organization: org.name,
      platform,
      windowDays,
      dataPointsInWindow: snaps.length,
      latestEntry: iso(latest.date),
      audience: { field: audienceField, current: latest[audienceField] || 0, atWindowStart: baseline?.[audienceField] ?? null, gained: baseline ? (latest[audienceField] || 0) - (baseline[audienceField] || 0) : null },
      engagementRatePct: latest.engagementRate || 0,
      periodTotals: totals,
      lifetimeTotals: Object.keys(stocks).length ? stocks : undefined,
    };
  },

  async growth_goals({ organization }) {
    const org = await resolveOrg(organization);
    if (!org) return { error: `No organization matching "${organization}" — call list_organizations for valid names.` };
    const goals = await Goal.find({ organization: org._id }).lean();
    if (!goals.length) return { organization: org.name, note: 'No growth goals set yet for this organization.' };
    return Promise.all(goals.map(async (g) => {
      const p = await computeProgress(g);
      const daysLeft = Math.max(0, Math.ceil((new Date(g.endDate) - Date.now()) / 86400000));
      const needed = Math.max(0, (g.targetFollowers || 0) - (p.baselineFollowers || 0));
      return {
        organization: org.name,
        platform: g.platform,
        period: `${iso(g.startDate)} to ${iso(g.endDate)}`,
        daysLeft,
        targetFollowers: g.targetFollowers || undefined,
        startedAt: p.baselineFollowers || undefined,
        currentFollowers: p.currentFollowers,
        gainedSinceStart: p.gainedFollowers,
        stillNeeded: g.targetFollowers ? Math.max(0, g.targetFollowers - p.currentFollowers) : undefined,
        progressPct: g.targetFollowers ? (needed > 0 ? Math.min(100, Math.round((p.gainedFollowers / needed) * 100)) : 100) : undefined,
        targetPosts: g.targetPosts || undefined,
        postsPublished: p.postsPublished,
        note: g.note || undefined,
      };
    }));
  },

  async approvals_summary({ organization, days } = {}, user) {
    const query = {};
    // Regular users only see their own requests — same rule as the approvals page.
    if (user.role === ROLES.USER) query.createdBy = user._id;
    else if (user.role === ROLES.CEO) query.organization = user.organization?._id || user.organization;
    if (organization) {
      const org = await resolveOrg(organization);
      if (!org) return { error: `No organization matching "${organization}".` };
      query.organization = org._id;
    }
    if (days) query.createdAt = { $gte: new Date(Date.now() - Math.min(Number(days) || 30, 365) * 86400000) };

    const [byStatus, byPlatform, recent] = await Promise.all([
      ApprovalRequest.aggregate([{ $match: query }, { $group: { _id: '$status', n: { $sum: 1 } } }]),
      ApprovalRequest.aggregate([{ $match: query }, { $group: { _id: '$platform', n: { $sum: 1 } } }]),
      ApprovalRequest.find(query).populate('organization', 'name').populate('createdBy', 'name').sort({ createdAt: -1 }).limit(10).lean(),
    ]);
    return {
      counts: Object.fromEntries(byStatus.map((s) => [s._id, s.n])),
      byPlatform: Object.fromEntries(byPlatform.map((p) => [p._id, p.n])),
      recent: recent.map((r) => ({
        title: r.title, status: r.status, platform: r.platform,
        organization: r.organization?.name, by: r.createdBy?.name,
        created: iso(r.createdAt),
      })),
    };
  },

  async post_plans({ organization, status } = {}, user) {
    const query = {};
    if (user.role === ROLES.USER) query.createdBy = user._id;
    else if (user.role === ROLES.CEO) query.organization = user.organization?._id || user.organization;
    if (organization) {
      const org = await resolveOrg(organization);
      if (!org) return { error: `No organization matching "${organization}".` };
      query.organization = org._id;
    }
    if (status && Object.values(APPROVAL_STATUS).includes(status)) query.status = status;

    const plans = await PostPlan.find(query).populate('organization', 'name').populate('createdBy', 'name').sort({ createdAt: -1 }).limit(15).lean();
    if (!plans.length) return { note: 'No post plans found for this filter.' };
    return plans.map((p) => ({
      title: p.title, status: p.status,
      organization: p.organization?.name, by: p.createdBy?.name,
      window: `${iso(p.startDate)} to ${iso(p.endDate)}`,
      posts: p.items?.length || 0,
      platforms: [...new Set((p.items || []).map((i) => i.platform))],
      feedback: p.status === 'REJECTED' ? p.feedback : undefined,
    }));
  },

  async templates_and_assets({ organization, search } = {}) {
    // organization: null on an item means it is shared across every college.
    const base = {};
    if (organization) {
      const org = await resolveOrg(organization);
      if (!org) return { error: `No organization matching "${organization}".` };
      base.$or = [{ organization: org._id }, { organization: null }];
    }
    if (search) base.name = { $regex: escapeRegex(search), $options: 'i' };

    const summarize = async (Model) => {
      const [total, byCategory, byOrg, recent] = await Promise.all([
        Model.countDocuments(base),
        Model.aggregate([{ $match: base }, { $group: { _id: '$category', n: { $sum: 1 } } }]),
        Model.aggregate([{ $match: base }, { $group: { _id: '$organization', n: { $sum: 1 } } }]),
        Model.find(base).populate('organization', 'name').populate('uploadedBy', 'name').sort({ createdAt: -1 }).limit(8).lean(),
      ]);
      const orgIds = byOrg.map((o) => o._id).filter(Boolean);
      const orgs = await Organization.find({ _id: { $in: orgIds } }).select('name').lean();
      const nameById = Object.fromEntries(orgs.map((o) => [String(o._id), o.name]));
      return {
        total,
        byCategory: Object.fromEntries(byCategory.map((c) => [c._id, c.n])),
        byCollege: Object.fromEntries(byOrg.map((o) => [o._id ? (nameById[String(o._id)] || 'Unknown') : 'Shared (all colleges)', o.n])),
        recent: recent.map((t) => ({
          name: t.name, category: t.category, type: t.fileType,
          college: t.organization?.name || 'Shared', downloads: t.downloads || 0,
          by: t.uploadedBy?.name, uploaded: iso(t.createdAt),
        })),
      };
    };

    const [templates, assets] = await Promise.all([summarize(Template), summarize(Asset)]);
    return { totalCombined: templates.total + assets.total, templates, assets };
  },

  async brand_library({ organization } = {}) {
    const query = {};
    if (organization) {
      const org = await resolveOrg(organization);
      if (!org) return { error: `No organization matching "${organization}".` };
      query.organization = org._id;
    }
    const [total, byCategory, byOrg, recent] = await Promise.all([
      BrandAsset.countDocuments(query),
      BrandAsset.aggregate([{ $match: query }, { $group: { _id: '$category', n: { $sum: 1 } } }]),
      BrandAsset.aggregate([{ $match: query }, { $group: { _id: '$organization', n: { $sum: 1 } } }]),
      BrandAsset.find(query).populate('organization', 'name').sort({ createdAt: -1 }).limit(8).lean(),
    ]);
    const orgs = await Organization.find({ _id: { $in: byOrg.map((o) => o._id).filter(Boolean) } }).select('name').lean();
    const nameById = Object.fromEntries(orgs.map((o) => [String(o._id), o.name]));
    return {
      total,
      byCategory: Object.fromEntries(byCategory.map((c) => [c._id, c.n])),
      byOrganization: Object.fromEntries(byOrg.map((o) => [nameById[String(o._id)] || 'Unknown', o.n])),
      recent: recent.map((b) => ({ title: b.title, category: b.category, kind: b.kind, organization: b.organization?.name, added: iso(b.createdAt) })),
    };
  },

  async events_list({ search } = {}) {
    const query = {};
    if (search) query.name = { $regex: escapeRegex(search), $options: 'i' };
    const events = await Event.find(query).populate('organization', 'name').sort({ eventDate: -1, createdAt: -1 }).limit(25).lean();
    if (!events.length) return { note: 'No events recorded yet.' };
    return { total: events.length, events: events.map((e) => ({
      name: e.name, date: iso(e.eventDate), location: e.location || undefined,
      organization: e.organization?.name || 'College-wide', photoFolder: e.folderLink,
      description: e.description || undefined,
    })) };
  },

  async signage_overview() {
    const [locations, active, historyByLoc] = await Promise.all([
      SignageLocation.find({}).populate('organization', 'name').sort({ code: 1 }).lean(),
      SignageBanner.find({ status: 'ACTIVE' }).sort({ installedAt: -1 }).lean(),
      SignageBanner.aggregate([{ $group: { _id: '$location', n: { $sum: 1 } } }]),
    ]);
    if (!locations.length) return { note: 'No signage locations set up yet.' };
    const activeByLoc = {};
    for (const b of active) if (!activeByLoc[b.location]) activeByLoc[b.location] = b;
    const histById = Object.fromEntries(historyByLoc.map((h) => [String(h._id), h.n]));
    return {
      totalStands: locations.length,
      byStatus: locations.reduce((acc, l) => { acc[l.status] = (acc[l.status] || 0) + 1; return acc; }, {}),
      stands: locations.map((l) => {
        const cur = activeByLoc[l._id];
        return {
          code: l.code, place: l.place, type: l.standType,
          size: l.width || l.height ? `${l.width} x ${l.height} ${l.sizeUnit}` : undefined,
          status: l.status, organization: l.organization?.name || undefined,
          currentBanner: cur ? { title: cur.title, event: cur.eventName || undefined, since: iso(cur.installedAt) } : null,
          bannersEverMounted: histById[String(l._id)] || 0,
        };
      }),
    };
  },

  async team_members(_input, user) {
    const users = await User.find({}).populate('organization', 'name').populate('handles.organization', 'name').select('name role organization isActive jobTitle email skills tools handles').sort({ role: 1, name: 1 }).lean();
    const privileged = [ROLES.ADMIN, ROLES.CEO].includes(user.role);
    return {
      total: users.length,
      active: users.filter((u) => u.isActive).length,
      byRole: users.reduce((acc, u) => { acc[u.role] = (acc[u.role] || 0) + 1; return acc; }, {}),
      members: users.map((u) => ({
        name: u.name, role: u.role, jobTitle: u.jobTitle || undefined,
        organization: u.organization?.name || undefined, active: u.isActive,
        skills: u.skills?.length ? u.skills : undefined,
        tools: u.tools?.length ? u.tools : undefined,
        handles: u.handles?.length ? u.handles.map((h) => `${h.organization?.name || 'org'}: ${(h.platforms || []).join('/')}`) : undefined,
        // Contact details only for admins/org heads.
        email: privileged ? u.email : undefined,
      })),
    };
  },

  async websites_list() {
    const sites = await Website.find({}).populate('organization', 'name').sort({ institution: 1 }).lean();
    if (!sites.length) return { note: 'No websites recorded yet.' };
    return { total: sites.length, websites: sites.map((w) => ({
      institution: w.institution, domain: w.domain || undefined, type: w.siteType || undefined,
      hosting: w.hosting || undefined, builtWith: w.builtWith || undefined,
      organization: w.organization?.name || undefined,
    })) };
  },

  async premium_purchases({ organization } = {}, user) {
    // Purchases are management data — hidden from regular users in the app too.
    if (![ROLES.ADMIN, ROLES.CEO].includes(user.role)) return { note: 'Premium pack purchases are only visible to Admins and organization heads.' };
    const query = {};
    if (user.role === ROLES.CEO) query.organization = user.organization?._id || user.organization;
    if (organization) {
      const org = await resolveOrg(organization);
      if (!org) return { error: `No organization matching "${organization}".` };
      query.organization = org._id;
    }
    const items = await Purchase.find(query).populate('organization', 'name').sort({ expiryDate: 1 }).lean();
    if (!items.length) return { note: 'No purchases recorded for this filter.' };
    const now = Date.now();
    return { total: items.length, purchases: items.map((p) => ({
      name: p.name, vendor: p.vendor || undefined, category: p.category,
      organization: p.organization?.name, seats: p.seats, cost: p.cost, currency: p.currency,
      purchased: iso(p.purchaseDate), expires: iso(p.expiryDate),
      daysToExpiry: p.expiryDate ? Math.ceil((new Date(p.expiryDate) - now) / 86400000) : undefined,
    })) };
  },

  async social_handlers({ organization } = {}, user) {
    if (![ROLES.ADMIN, ROLES.CEO].includes(user.role)) return { note: 'The social handlers directory is only visible to Admins and organization heads.' };
    const { default: SocialAccount } = await import('../models/SocialAccount.js');
    const query = {};
    if (user.role === ROLES.CEO) query.organization = user.organization?._id || user.organization;
    if (organization) {
      const org = await resolveOrg(organization);
      if (!org) return { error: `No organization matching "${organization}".` };
      query.organization = org._id;
    }
    const accounts = await SocialAccount.find(query).populate('organization', 'name').lean();
    if (!accounts.length) return { note: 'No social accounts recorded for this filter.' };
    return accounts.map((a) => ({
      organization: a.organization?.name, platform: a.platform,
      accountName: a.accountName || undefined, owner: a.ownerName || undefined,
      handlers: (a.handlers || []).map((h) => h.name).filter(Boolean),
      peopleWithAccess: a.accessCount || undefined,
    }));
  },

  async recent_activity({ days = 7 } = {}, user) {
    const query = { createdAt: { $gte: new Date(Date.now() - Math.min(Math.max(Number(days) || 7, 1), 90) * 86400000) } };
    // Users see their own trail; org heads their org's; admins everything.
    if (user.role === ROLES.USER) query.user = user._id;
    else if (user.role === ROLES.CEO) query.organization = user.organization?._id || user.organization;
    const logs = await ActivityLog.find(query).populate('user', 'name').populate('organization', 'name').sort({ createdAt: -1 }).limit(30).lean();
    if (!logs.length) return { note: 'No activity in this window.' };
    return logs.map((l) => ({
      when: new Date(l.createdAt).toISOString().slice(0, 16).replace('T', ' '),
      who: l.user?.name, organization: l.organization?.name || undefined,
      action: l.action, description: l.description,
    }));
  },
};

// Execute one tool call. Errors become readable strings so the model can recover.
export const runTool = async (name, input, user) => {
  const handler = handlers[name];
  if (!handler) return { error: `Unknown tool: ${name}` };
  try {
    return await handler(input || {}, user);
  } catch (err) {
    console.error(`AI tool ${name} failed:`, err.message);
    return { error: `Tool failed: ${err.message}` };
  }
};
