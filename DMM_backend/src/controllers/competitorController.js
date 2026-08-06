import asyncHandler from 'express-async-handler';
import Competitor from '../models/Competitor.js';
import Analytics from '../models/Analytics.js';
import Organization from '../models/Organization.js';
import { logActivity } from '../utils/logActivity.js';
import { requireOrgId } from '../utils/org.js';
import { loadAllGrids } from '../utils/sheet.js';
import { ACTIVITY_ACTIONS, PLATFORMS } from '../config/constants.js';

// Editable numeric metrics for a competitor, with labels for the UI.
// The order here drives the table columns, the add/edit form and what `sanitize`
// accepts, so a new metric only has to be added once. Comments and reactions come
// from LinkedIn's own competitor export, which reports raw counts for a date
// range rather than a rate.
export const COMPETITOR_FIELDS = [
  'followers', 'newFollowers', 'postsLast30Days', 'engagementRate',
  'reactions', 'comments', 'commentsPerDay',
];
export const COMPETITOR_LABELS = {
  followers: 'Followers',
  newFollowers: 'New Followers',
  postsLast30Days: 'Posts',
  engagementRate: 'Engagement Rate',
  reactions: 'Reactions',
  comments: 'Comments',
  commentsPerDay: 'Comments / day',
};
export const COMPETITOR_PERCENT_FIELDS = ['engagementRate'];

const sanitize = (body) => {
  const out = {};
  for (const f of COMPETITOR_FIELDS) {
    const val = Number(body[f]);
    out[f] = Number.isFinite(val) && val >= 0 ? val : 0;
  }
  return out;
};

// @route GET /api/competitors?platform=LinkedIn — competitors for one org/platform,
// plus the org's own latest snapshot (so the UI can rank "You" against them).
export const listCompetitors = asyncHandler(async (req, res) => {
  const orgId = requireOrgId(req, res);
  const platform = req.query.platform || 'LinkedIn';
  if (!PLATFORMS.includes(platform)) { res.status(400); throw new Error('Invalid platform'); }

  const competitors = await Competitor.find({ organization: orgId, platform }).sort({ followers: -1 }).lean();
  const org = await Organization.findById(orgId).select('name color').lean();
  const ownSnap = await Analytics.findOne({ organization: orgId, platform }).sort({ date: -1 }).lean();

  const own = {
    name: org?.name || 'Your organization',
    color: org?.color || '#7c3aed',
    isSelf: true,
    followers: ownSnap?.followers || 0,
    newFollowers: ownSnap?.newFollowers || 0,
    postsLast30Days: ownSnap?.postsPublished || 0,
    engagementRate: ownSnap?.engagementRate || 0,
  };

  res.json({
    success: true,
    platform,
    fields: COMPETITOR_FIELDS,
    labels: COMPETITOR_LABELS,
    percentFields: COMPETITOR_PERCENT_FIELDS,
    own,
    competitors,
  });
});

// @route POST /api/competitors  (ADMIN) — add a competitor
export const createCompetitor = asyncHandler(async (req, res) => {
  const orgId = requireOrgId(req, res);
  const platform = req.body.platform || 'LinkedIn';
  if (!PLATFORMS.includes(platform)) { res.status(400); throw new Error('Invalid platform'); }
  const name = (req.body.name || '').trim();
  if (!name) { res.status(400); throw new Error('Competitor name is required'); }

  const competitor = await Competitor.create({
    organization: orgId,
    platform,
    name,
    handle: (req.body.handle || '').trim(),
    ...sanitize(req.body),
  });

  logActivity({ user: req.user._id, organization: orgId, action: ACTIVITY_ACTIONS.COMPETITOR_UPDATED, description: `Added competitor ${name} (${platform})`, entityType: 'Competitor', entityId: competitor._id });
  res.status(201).json({ success: true, competitor });
});

// @route PUT /api/competitors/:id  (ADMIN) — update a competitor
export const updateCompetitor = asyncHandler(async (req, res) => {
  const orgId = requireOrgId(req, res);
  const competitor = await Competitor.findOne({ _id: req.params.id, organization: orgId });
  if (!competitor) { res.status(404); throw new Error('Competitor not found'); }

  if (req.body.name !== undefined) {
    const name = (req.body.name || '').trim();
    if (!name) { res.status(400); throw new Error('Competitor name is required'); }
    competitor.name = name;
  }
  if (req.body.handle !== undefined) competitor.handle = (req.body.handle || '').trim();
  Object.assign(competitor, sanitize(req.body));
  await competitor.save();

  logActivity({ user: req.user._id, organization: orgId, action: ACTIVITY_ACTIONS.COMPETITOR_UPDATED, description: `Updated competitor ${competitor.name}`, entityType: 'Competitor', entityId: competitor._id });
  res.json({ success: true, competitor });
});

// @route DELETE /api/competitors/:id  (ADMIN) — remove a competitor
export const deleteCompetitor = asyncHandler(async (req, res) => {
  const orgId = requireOrgId(req, res);
  const competitor = await Competitor.findOneAndDelete({ _id: req.params.id, organization: orgId });
  if (!competitor) { res.status(404); throw new Error('Competitor not found'); }

  logActivity({ user: req.user._id, organization: orgId, action: ACTIVITY_ACTIONS.COMPETITOR_UPDATED, description: `Removed competitor ${competitor.name}`, entityType: 'Competitor', entityId: competitor._id });
  res.json({ success: true, id: req.params.id });
});

// ----------------------------------------------------------------------------
// Excel import
// ----------------------------------------------------------------------------

// Normalize a header label to a comparable key: lowercase, alphanumerics only.
const normHeader = (s) => cellText(s).toLowerCase().replace(/[^a-z0-9]/g, '');

// Pull plain text out of any exceljs cell value (string, number, rich text,
// hyperlink or formula result).
function cellText(v) {
  if (v == null) return '';
  if (typeof v === 'object') {
    if (Array.isArray(v.richText)) return v.richText.map((t) => t.text).join('');
    if (v.text != null) return String(v.text);
    if (v.result != null) return String(v.result);
    if (v.hyperlink != null) return String(v.hyperlink);
    return '';
  }
  return String(v);
}

// Parse a number out of a cell, tolerating "12,500", "4.2%", "₹1,200" etc.
const cellNumber = (v) => {
  const n = parseFloat(cellText(v).replace(/[^0-9.\-]/g, ''));
  return Number.isFinite(n) && n >= 0 ? n : 0;
};

// Map a header cell to one of our fields.
const HEADER_MATCHERS = [
  { field: 'newFollowers', test: (h) => /newfollow|followersgain|followergain|gained|growth|monthlygrowth/.test(h) },
  { field: 'followers', test: (h) => /totalfollower|^followers?$|audience|subscriber|fans|pagelikes|totallikes/.test(h) },
  { field: 'commentsPerDay', test: (h) => /commentsperday|commentsday|percomment/.test(h) },
  { field: 'comments', test: (h) => /comment/.test(h) },
  { field: 'reactions', test: (h) => /reaction|^likes?$/.test(h) },
  { field: 'engagementRate', test: (h) => /engage|interaction/.test(h) },
  { field: 'postsLast30Days', test: (h) => /post|content|frequency|upload|publish/.test(h) },
  // Name before handle: LinkedIn's competitor export calls the company column
  // "Page", which the handle pattern would otherwise swallow, leaving the sheet
  // with no name column and the whole import refused. A bare "Page" is the
  // name; "Page URL" / "Page Link" still read as the handle.
  { field: 'name', test: (h) => /^page$/.test(h) || /name|college|competitor|company|institut|school|university|brand|organi/.test(h) },
  { field: 'handle', test: (h) => /handle|page|url|link|profile|account|website/.test(h) },
];

// Build { field: columnIndex } from a candidate header row (1-indexed values array).
const buildColumnMap = (rowValues) => {
  const map = {};
  rowValues.forEach((v, col) => {
    if (col === 0) return; // exceljs row.values is 1-indexed; [0] is empty
    const h = normHeader(v);
    if (!h) return;
    for (const m of HEADER_MATCHERS) {
      if (map[m.field] != null) continue;
      if (m.test(h)) { map[m.field] = col; break; }
    }
  });
  return map;
};

const escapeRegex = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// @route POST /api/competitors/import  (ADMIN) — bulk add/update competitors from
// an uploaded Excel/CSV sheet. Columns are auto-detected from the header row, so
// the admin can upload their existing spreadsheet as-is. Existing competitors
// (matched by name) are updated; new ones are created. Nothing is deleted.
export const importCompetitors = asyncHandler(async (req, res) => {
  const orgId = requireOrgId(req, res);
  const platform = req.body.platform || 'LinkedIn';
  if (!PLATFORMS.includes(platform)) { res.status(400); throw new Error('Invalid platform'); }
  if (!req.file) { res.status(400); throw new Error('No Excel file uploaded'); }

  let grid;
  try {
    const sheets = await loadAllGrids(req.file);
    grid = sheets[0]?.grid || [];
  } catch {
    res.status(400);
    throw new Error('Could not read the file. Please upload a valid .xlsx / .xls Excel file.');
  }

  if (!grid.length) { res.status(400); throw new Error('The file has no data.'); }

  // Find the header row.
  //
  // A row that maps ONLY a name is usually a title, not a header: an exported
  // sheet often starts with something like "Competitor benchmark - August 2026",
  // and the name matcher recognises the word "competitor" in it. Treating that as
  // the header made the real header row import as a competitor literally called
  // "Name". So prefer the first row mapping a name AND at least one other
  // column, and fall back to a name-only row for sheets that genuinely list
  // nothing but names.
  let headerRow = -1;
  let columnMap = null;
  let fallbackRow = -1;
  let fallbackMap = null;
  for (let i = 0; i < grid.length; i++) {
    const map = buildColumnMap(grid[i]);
    if (map.name == null) continue;
    if (Object.keys(map).length >= 2) { headerRow = i; columnMap = map; break; }
    if (fallbackMap == null) { fallbackRow = i; fallbackMap = map; }
  }
  if (!columnMap && fallbackMap) { headerRow = fallbackRow; columnMap = fallbackMap; }
  if (!columnMap) {
    res.status(400);
    throw new Error('Could not find a competitor name column. Add a header row with a "Name" or "College" column, or download the template.');
  }

  // Parse data rows into competitor records.
  const parsed = [];
  for (let i = headerRow + 1; i < grid.length; i++) {
    const row = grid[i] || [];
    const name = cellText(row[columnMap.name]).trim();
    if (!name) continue;
    // Only the metrics this sheet actually has. A column that isn't in the file
    // is left absent rather than sent as 0, so importing a sheet without (say) a
    // Followers column doesn't wipe a figure someone entered by hand.
    const metrics = {};
    for (const field of COMPETITOR_FIELDS) {
      if (columnMap[field] != null) metrics[field] = cellNumber(row[columnMap[field]]);
    }
    parsed.push({
      name,
      handle: columnMap.handle != null ? cellText(row[columnMap.handle]).trim() : '',
      ...metrics,
    });
  }

  if (parsed.length === 0) {
    res.status(400);
    throw new Error('No competitor rows found under the header. Make sure each row has a name.');
  }

  // Upsert by name (case-insensitive) within this org + platform.
  let created = 0;
  let updated = 0;
  for (const c of parsed) {
    const existing = await Competitor.findOne({
      organization: orgId,
      platform,
      name: new RegExp(`^${escapeRegex(c.name)}$`, 'i'),
    });
    if (existing) {
      existing.handle = c.handle || existing.handle;
      // Iterating COMPETITOR_FIELDS rather than naming them keeps this in step
      // with the model - the previous hand-written list silently dropped any
      // metric added later.
      for (const field of COMPETITOR_FIELDS) {
        if (c[field] !== undefined) existing[field] = c[field];
      }
      await existing.save();
      updated += 1;
    } else {
      await Competitor.create({ organization: orgId, platform, ...c });
      created += 1;
    }
  }

  const mappedColumns = Object.keys(columnMap).filter((f) => f !== 'name');
  logActivity({
    user: req.user._id,
    organization: orgId,
    action: ACTIVITY_ACTIONS.COMPETITOR_UPDATED,
    description: `Imported ${parsed.length} ${platform} competitors from Excel (${created} new, ${updated} updated)`,
    entityType: 'Competitor',
  });

  res.json({ success: true, imported: parsed.length, created, updated, mappedColumns });
});

// @route GET /api/competitors/template — download a ready-to-fill Excel template
// with the exact columns the importer understands.
export const competitorTemplate = asyncHandler(async (req, res) => {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Competitors');
  ws.columns = [
    { header: 'Name', key: 'name', width: 30 },
    { header: 'Handle / Page (optional)', key: 'handle', width: 34 },
    { header: 'Followers', key: 'followers', width: 14 },
    { header: 'New Followers (30d)', key: 'newFollowers', width: 20 },
    { header: 'Posts (30d)', key: 'postsLast30Days', width: 14 },
    { header: 'Engagement Rate (%)', key: 'engagementRate', width: 20 },
  ];
  const head = ws.getRow(1);
  head.font = { bold: true, color: { argb: 'FFFFFFFF' } };
  head.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF0B2350' } };
  head.alignment = { vertical: 'middle' };
  head.height = 22;
  ws.addRow({ name: 'Example College A', handle: 'linkedin.com/company/example-a', followers: 12500, newFollowers: 320, postsLast30Days: 18, engagementRate: 4.2 });
  ws.addRow({ name: 'Example College B', handle: '@example-b', followers: 9800, newFollowers: 210, postsLast30Days: 12, engagementRate: 3.1 });

  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', 'attachment; filename="competitor-template.xlsx"');
  await wb.xlsx.write(res);
  res.end();
});
