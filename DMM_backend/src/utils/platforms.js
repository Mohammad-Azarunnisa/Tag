import SocialAccount from '../models/SocialAccount.js';
import Organization from '../models/Organization.js';
import User from '../models/User.js';
import { ROLES, USER_TYPES, SOCIAL_PLATFORMS } from '../config/constants.js';

/**
 * Which social channels each college actually runs.
 *
 * A college's presence is recorded in three places and none is complete on its
 * own, so the answer is the union:
 *
 *   - `SocialAccount` rows: the accounts register (one row per channel).
 *   - The organization's own connections: a linked YouTube channel, or a Meta
 *     page / Instagram, is that college on that channel whether or not anyone
 *     wrote it into the register.
 *   - What the college's social handlers are mapped to handle: somebody is
 *     assigned to post there, so it exists.
 *
 * A college with nothing on record anywhere gets the standard set. That is "we do
 * not know", not "they have none" — the alternative is a college that can never
 * have a post raised for it because every channel was hidden.
 *
 * Batched deliberately: the organization picker asks for every college at once,
 * and three queries per college would make opening a form a page of round trips.
 */
export const platformsByOrganization = async (organizationIds = []) => {
  const ids = [...new Set(organizationIds.map((v) => String(v?._id || v || '')).filter(Boolean))];
  if (!ids.length) return {};

  const [rows, orgs, handlers] = await Promise.all([
    SocialAccount.find({ organization: { $in: ids } }).select('organization platform').lean(),
    Organization.find({ _id: { $in: ids } })
      .select('youtubeChannelId metaInstagramId metaInstagramUsername metaPageId metaPageName').lean(),
    User.find({
      isActive: true, role: ROLES.USER, userType: USER_TYPES.SOCIAL_HANDLER,
      'handles.organization': { $in: ids },
    }).select('handles').lean(),
  ]);

  const found = new Map(ids.map((id) => [id, new Set()]));
  const add = (orgId, platform) => {
    const set = found.get(String(orgId));
    if (set && platform) set.add(platform);
  };

  rows.forEach((r) => add(r.organization, r.platform));
  orgs.forEach((o) => {
    if (o.youtubeChannelId) add(o._id, 'YouTube');
    if (o.metaInstagramId || o.metaInstagramUsername) add(o._id, 'Instagram');
    if (o.metaPageId || o.metaPageName) add(o._id, 'Facebook');
  });
  handlers.forEach((h) => (h.handles || []).forEach((x) => {
    (x.platforms || []).forEach((p) => add(x.organization, p));
  }));

  // Held in the platform list's own order so every picker reads the same way,
  // rather than in whatever order the records happened to arrive.
  const out = {};
  for (const id of ids) {
    const set = found.get(id);
    const ordered = SOCIAL_PLATFORMS.filter((p) => set.has(p));
    const extras = [...set].filter((p) => !SOCIAL_PLATFORMS.includes(p));
    const all = [...ordered, ...extras];
    out[id] = all.length ? all : [...SOCIAL_PLATFORMS];
  }
  return out;
};

/** The channels one college runs. Thin wrapper over the batched form. */
export const platformsForOrganization = async (organizationId) => {
  const id = String(organizationId?._id || organizationId || '');
  if (!id) return [...SOCIAL_PLATFORMS];
  const map = await platformsByOrganization([id]);
  return map[id] || [...SOCIAL_PLATFORMS];
};
