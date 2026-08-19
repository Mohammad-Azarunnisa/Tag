// The group's preferred display order for organizations.
//
// Alphabetical is the wrong default here: it opened every list with EduCare and
// buried NCET, which is neither how the group is structured nor how anyone looks
// for a college. This is the one place that order is defined — it used to be a
// private list inside AnalyticsOverview, which is why the grid there and every
// other picker disagreed.
//
// Names are matched case-insensitively and trimmed. Anything not listed lands
// after the known colleges, alphabetically among itself, so adding a college
// never hides it — it simply sorts at the end until it is named here.
const ORG_ORDER = [
  'ncet',
  'ncms',
  'ndc',
  'npuc cbpur',
  'npuc yelahanka',
  'technical hub',
  'toriiminds',
  'educare',
];

const key = (name) => String(name || '').trim().toLowerCase();

/** Position in the preferred order; unlisted names sort after every listed one. */
export const orgRank = (name) => {
  const i = ORG_ORDER.indexOf(key(name));
  return i === -1 ? ORG_ORDER.length : i;
};

/** Compare two organization *names* by preferred order, then alphabetically. */
export const compareOrgNames = (a, b) =>
  orgRank(a) - orgRank(b) || String(a || '').localeCompare(String(b || ''));

/**
 * Sort a list of organizations (or anything with a name) into the preferred
 * order. Returns a new array — callers often hold react-query data, which must
 * not be mutated in place.
 *
 * `pick` reads the name off each item, for lists that nest it (e.g. a row shaped
 * { org: { name } } or { organization: { name } }).
 */
export const sortOrganizations = (list, pick = (o) => o?.name) =>
  [...(list || [])].sort((a, b) => compareOrgNames(pick(a), pick(b)));
