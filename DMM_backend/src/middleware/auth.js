import asyncHandler from 'express-async-handler';
import { verifyToken } from '../utils/token.js';
import User from '../models/User.js';
import Organization from '../models/Organization.js';
import { ROLES, USER_TYPES } from '../config/constants.js';

export const isCoordinator = (user) => user?.role === ROLES.USER && user?.userType === USER_TYPES.COORDINATOR;

// A coordinator runs one college. They work with the material that belongs to
// that college — its content library, events, signage and numbers — hand work to
// their own people, and raise requests upward. Nothing that belongs to another
// college, and nothing that governs the platform.
//
// It is enforced here rather than route by route for the same reason as the
// view-only block below: one choke point cannot be forgotten, and anything added
// later stays closed to them until it is deliberately opened.
const COORDINATOR_ALLOWED = [
  /^\/api\/auth\//, // sign in, /me, password reset
  /^\/api\/dashboard\//, // their college's statistics
  // NOTE: /api/approvals is deliberately NOT here. A coordinator's part in the
  // pipeline is the workflow module (routes/workflowRoutes.js), where they review
  // the work that answers their own request; the approvals pages are not theirs.
  /^\/api\/workflow(\/|$)/, // the design/post pipeline for their own requests
  /^\/api\/requests(\/|$)/, // ask the admin for something on the college's behalf
  /^\/api\/notifications(\/|$)/,
  /^\/api\/ai\//, // help drafting the content on a request
  /^\/api\/users\/(profile|password|settings|designers|handlers|directory)/, // own account; who can do the work; who to contact
  /^\/api\/users$/, // who is in their college, to assign work to
  /^\/api\/organizations\/options$/, // naming the college a request is for
  /^\/api\/link-preview(\/|$)/, // link cards inside a request thread
  /^\/api\/work-assignments(\/|$)/, // hand work to their own people and track it
];

// Their college's material. Uploading to the shared libraries is allowed - it
// lands on their own college, pinned server-side (utils/org.js#pinnedWriteOrg) -
// but editing and deleting stay with the super admin, who curates them.
const COORDINATOR_UPLOADS = [
  /^\/api\/templates$/,
  /^\/api\/assets$/,
  /^\/api\/brand$/,
];

// Their college's material: readable, but they do not curate the libraries.
const COORDINATOR_READABLE = [
  /^\/api\/templates(\/|$)/,
  /^\/api\/assets(\/|$)/,
  /^\/api\/brand(\/|$)/,
  /^\/api\/events(\/|$)/,
  /^\/api\/signage(\/|$)/,
  /^\/api\/analytics(\/|$)/,
  /^\/api\/social-posts(\/|$)/,
  /^\/api\/linkedin(\/|$)/,
  /^\/api\/goals(\/|$)/,
  /^\/api\/plans(\/|$)/,
  /^\/api\/calendar(\/|$)/,
  // The dashboard's activity heatmap is a per-day count of their own college's
  // activity - part of its statistics - and /day is the same figure opened up
  // for one square. Both are scoped to the caller's own actions for a USER
  // (activityController#getActivityScope), so this shows a coordinator their own
  // trail and nobody else's. The unfiltered activity LOG stays closed.
  /^\/api\/activity\/heatmap$/,
  /^\/api\/activity\/day$/,
];

const coordinatorMayCall = (req) => {
  const path = req.originalUrl.split('?')[0];
  const method = req.method.toUpperCase();
  if (COORDINATOR_ALLOWED.some((rx) => rx.test(path))) return true;
  if (method === 'POST' && COORDINATOR_UPLOADS.some((rx) => rx.test(path))) return true;
  const reading = ['GET', 'HEAD', 'OPTIONS'].includes(method);
  return reading && COORDINATOR_READABLE.some((rx) => rx.test(path));
};

/**
 * Pin a coordinator to their own college.
 *
 * Every list endpoint in the app reads ?organizationId and, when it is absent,
 * returns every college's data — that is the deliberate shared-workspace design
 * for the rest of the platform. A coordinator is the one role that must never
 * see across colleges, so rather than teach a dozen controllers a new rule, the
 * parameter is overwritten here before any of them run. The existing
 * "this college plus the college-wide ones" logic then does exactly the right
 * thing, using the same code path everyone else exercises.
 *
 * `shared` is left alone: it narrows to college-wide material only, which is
 * theirs to see. The sticky header is dropped so it cannot reintroduce another
 * college behind the query.
 */
const pinCoordinatorToOwnOrg = (req) => {
  const own = req.user.organization?._id || req.user.organization;
  if (!own) return; // login already refuses an org-less user; nothing to pin to
  delete req.headers['x-organization-id'];
  if (req.query.organizationId === 'shared') return;
  req.query.organizationId = String(own);
};

// Verifies JWT (Bearer header) and attaches req.user.
export const protect = asyncHandler(async (req, res, next) => {
  let token;
  const header = req.headers.authorization;
  if (header && header.startsWith('Bearer ')) {
    token = header.split(' ')[1];
  }
  if (!token) {
    res.status(401);
    throw new Error('Not authorized, no token');
  }

  let user;
  try {
    const decoded = verifyToken(token);
    user = await User.findById(decoded.id).populate('organization', 'name slug logo color isActive');
  } catch (err) {
    res.status(401);
    throw new Error('Not authorized, token failed');
  }
  if (!user || !user.isActive) {
    res.status(401);
    throw new Error('Not authorized, user not found');
  }

  // A disabled organization has to disappear for its people immediately, not at
  // their next sign-in. Login already refuses one, but a token handed out before
  // the switch was flipped stayed valid for its whole lifetime — so the check
  // belongs here, on the path every authenticated request takes.
  //
  // The super admin is exempt: they hold no organization, and theirs is the
  // account that turns one back on. An Admin (role CEO) may hold several
  // institutions, so they are only turned away when *every* one they hold is
  // disabled; otherwise they stay in and the disabled ones are dropped from
  // their scope below, which is what hides that college's data without taking
  // the live ones away too.
  if (user.role !== ROLES.ADMIN) {
    const held = [user.organization?._id || user.organization, ...(user.managedOrganizations || [])]
      .map((v) => String(v?._id || v || ''))
      .filter(Boolean);
    let live = [];
    if (held.length) {
      const rows = await Organization.find({ _id: { $in: held }, isActive: { $ne: false } }).select('_id').lean();
      live = rows.map((o) => String(o._id));
      if (!live.length) {
        res.status(403);
        throw new Error('Your organization has been disabled. Contact your administrator.');
      }
    }
    // Read by accessibleOrgIds (utils/org.js), which every org-scoped query
    // funnels through, so a disabled college drops out of reads and writes alike.
    user.$locals.liveOrgIds = live;
  }

  req.user = user;

  // View-only accounts (e.g. the Chairman) may read anything but must never
  // mutate. Blocking every write here means no individual route can forget to.
  if (user.viewOnly && !['GET', 'HEAD', 'OPTIONS'].includes(req.method.toUpperCase())) {
    res.status(403);
    throw new Error('This is a view-only account — changes are not permitted.');
  }

  if (isCoordinator(user)) {
    if (!coordinatorMayCall(req)) {
      res.status(403);
      throw new Error('A coordinator account is limited to its own college\'s work.');
    }
    pinCoordinatorToOwnOrg(req);
  }
  next();
});

// Restricts a route to one or more roles. Usage: authorize('CEO')
export const authorize = (...roles) =>
  asyncHandler(async (req, res, next) => {
    if (!roles.includes(req.user.role)) {
      res.status(403);
      throw new Error(`Role '${req.user.role}' is not allowed to access this resource`);
    }
    next();
  });

// Restricts a route to the single built-in super admin — the only account that
// may create or modify admins, users and organizations.
export const requireSuperAdmin = asyncHandler(async (req, res, next) => {
  if (!req.user?.isSuperAdmin) {
    res.status(403);
    throw new Error('Only the super admin can manage accounts and organizations');
  }
  next();
});
