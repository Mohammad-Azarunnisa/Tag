import { ROLES } from '../config/constants.js';
import { canAccessOrg } from './org.js';

/**
 * Who may destroy things.
 *
 * Deleting is the one action with no undo. The files leave storage, the rows
 * leave the database, and a posted design that took a week to get through the
 * pipeline cannot be brought back — nor can the analytics history that hung off
 * it. So it is an administrator's act.
 *
 * The part worth spelling out is what this replaces. Most delete handlers used
 * to read "the creator, or an administrator", which meant a designer could
 * delete their own published design and a handler could delete a post that had
 * already gone out. Ownership is now irrelevant to deleting: only the role
 * decides, so the answer is the same on every screen and cannot drift as
 * handlers are added.
 *
 * ROLES.ADMIN is the platform administrator (the super admin account, which
 * holds no institution of its own). ROLES.CEO is an institution's Admin — both
 * are labelled "Admin" in the UI, which is why the two are read together
 * everywhere rather than either alone.
 */
export const isAdministrator = (user) => user?.role === ROLES.ADMIN || user?.role === ROLES.CEO;

/**
 * The same question for something that belongs to an institution.
 *
 * An institution's Admin is confined to the institutions they hold, or one of
 * them could clear out another college's library. Material shared across every
 * institution (organization: null — the platform-wide templates, assets and
 * brand items) belongs to the platform rather than to any one college, so
 * removing it stays with the platform administrator who curates it.
 */
export const canDeleteOrgItem = (user, orgId) => {
  if (user?.role === ROLES.ADMIN) return true;
  if (user?.role !== ROLES.CEO) return false;
  return Boolean(orgId) && canAccessOrg(user, orgId);
};

// The 403 itself, worded the same way wherever it is raised. Status goes on the
// response before throwing because that is what middleware/error.js reads.
export const assertIsAdministrator = (req, res, what = 'this') => {
  if (isAdministrator(req.user)) return;
  res.status(403);
  throw new Error(`Only an admin or the super admin can delete ${what}`);
};

export const assertCanDeleteOrgItem = (req, res, orgId, what = 'this') => {
  if (canDeleteOrgItem(req.user, orgId)) return;
  res.status(403);
  throw new Error(isAdministrator(req.user)
    // An admin who is refused is being told about scope, not about rank — saying
    // "only an admin can" to an admin reads as a bug.
    ? `This ${what} is shared across institutions — only the super admin can delete it`
    : `Only an admin or the super admin can delete ${what}`);
};
