import { ROLES, USER_TYPES } from '../config/constants.js';

const idOf = (v) => String(v?._id || v || '');

/**
 * Every organization a user is allowed to act in.
 *
 * Returns `null` for a super-admin-level ADMIN, meaning "no restriction" — that
 * is deliberately different from `[]`, which means "allowed nowhere". Callers
 * must check for null before using the list as a filter.
 *
 * An Admin (role CEO) heads their own `organization` and may hold extra
 * institutions the super admin granted via `managedOrganizations`. Everyone else
 * is limited to the single organization they belong to.
 */
export const accessibleOrgIds = (user) => {
  if (user?.role === ROLES.ADMIN) return null;
  // `protect` (middleware/auth.js) has already resolved which of the user's
  // organizations are still enabled. Preferring that list is what makes a
  // disabled college vanish from every org-scoped query at once, instead of each
  // controller having to remember to check.
  const live = user?.$locals?.liveOrgIds;
  if (Array.isArray(live)) return live;
  const own = idOf(user?.organization);
  const granted = (user?.managedOrganizations || []).map(idOf);
  return [...new Set([own, ...granted].filter(Boolean))];
};

/**
 * The college a coordinator's write must belong to, or `undefined` for everyone
 * else. A coordinator runs one college: anything they create is for it, never for
 * another and never for the shared/college-wide bucket, which is the super
 * admin's to curate. Because the answer is never in doubt, the form does not ask
 * — see the pickers hidden in the product app.
 */
export const pinnedWriteOrg = (user) => {
  if (user?.role !== ROLES.USER || user?.userType !== USER_TYPES.COORDINATOR) return undefined;
  return user.organization?._id || user.organization || undefined;
};

/** Whether `user` may act in `orgId`. Always true for an unrestricted ADMIN. */
export const canAccessOrg = (user, orgId) => {
  const allowed = accessibleOrgIds(user);
  if (allowed === null) return true;
  const wanted = idOf(orgId);
  return !!wanted && allowed.includes(wanted);
};

/**
 * Resolve the organization a request operates on.
 * - ADMIN: must specify via ?organizationId, body.organization, or x-organization-id header.
 * - CEO: the institution they asked for, but only one they actually hold;
 *   otherwise their own. A request can never widen their access this way.
 * - USER: always their own organization (cannot be overridden).
 * Returns the org id (string/ObjectId) or null if it cannot be resolved.
 */
export const resolveOrgId = (req) => {
  if (req.user.role === ROLES.ADMIN) {
    return (
      req.query.organizationId ||
      req.body?.organization ||
      req.headers['x-organization-id'] ||
      null
    );
  }
  // An Admin may hold several institutions, so honour the one they picked —
  // after checking it is theirs. Anything else falls through to their own.
  if (req.user.role === ROLES.CEO) {
    const asked = req.query.organizationId || req.body?.organization || req.headers['x-organization-id'];
    if (asked && canAccessOrg(req.user, asked)) return asked;
  }
  // The fallback is "their own institution" — but if that one has been disabled,
  // returning it would serve data from a college that is supposed to be hidden.
  // An Admin can hold several, so prefer their own when it is live and otherwise
  // any live one they hold. (A plain USER whose single college is disabled never
  // reaches here: `protect` turns the request away outright.)
  const org = req.user.organization;
  const own = idOf(org);
  const live = req.user?.$locals?.liveOrgIds;
  if (Array.isArray(live)) {
    if (own && live.includes(own)) return own;
    return live[0] || null;
  }
  return org?._id || org || null;
};

/** Same as resolveOrgId but throws a 400 when no org is available. */
export const requireOrgId = (req, res) => {
  const id = resolveOrgId(req);
  if (!id) {
    res.status(400);
    throw new Error('No organization selected for this request');
  }
  return id;
};

/**
 * Resolve the organization for a READ-ONLY view.
 *
 * Super-admin-level ADMIN users keep full access. Everyone else is clamped to
 * organizations they can actually access, and falls back to their own org when
 * no valid institute is requested.
 */
export const resolveViewOrgId = (req) => {
  const requested = req.query.organizationId || req.headers['x-organization-id'] || req.body?.organization || null;
  if (requested && canAccessOrg(req.user, requested)) return requested;
  return resolveOrgId(req);
};
