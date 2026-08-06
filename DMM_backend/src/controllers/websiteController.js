import asyncHandler from 'express-async-handler';
import ExcelJS from 'exceljs';
import Website from '../models/Website.js';
import { logActivity } from '../utils/logActivity.js';
import { cellText, cellHyperlink, loadGrid, findColumns, resolveOrganization, escapeRegex } from '../utils/sheet.js';
import { accessibleOrgIds } from '../utils/org.js';
import { ROLES, ACTIVITY_ACTIONS } from '../config/constants.js';

const FIELDS = ['institution', 'domain', 'siteType', 'hosting', 'builtWith', 'notes'];

const apply = (doc, body) => {
  FIELDS.forEach((f) => { if (body[f] !== undefined) doc[f] = String(body[f] ?? '').trim(); });
  if (body.organization !== undefined) doc.organization = body.organization || null;
};

// @route GET /api/websites — ADMIN sees all (or one org via filter); CEO sees the
// websites linked to their org or whose institution name matches their org.
export const listWebsites = asyncHandler(async (req, res) => {
  const and = []; // combined with $and so scope + search both apply
  const allowed = accessibleOrgIds(req.user);

  if (req.user.role === ROLES.ADMIN) {
    if (req.query.organizationId) and.push({ organization: req.query.organizationId });
  } else {
    const orgId = req.user.organization?._id || req.user.organization;
    const orgName = req.user.organization?.name;
    const scope = [{ organization: orgId }];
    if (orgName) scope.push({ institution: new RegExp(escapeRegex(orgName), 'i') });
    if (req.query.organizationId) {
      if (allowed !== null && !allowed.includes(String(req.query.organizationId))) { res.status(403); throw new Error('Not allowed'); }
      and.push({ organization: req.query.organizationId });
    } else if (allowed !== null) {
      and.push({ $or: [{ organization: { $in: allowed } }, { institution: new RegExp(escapeRegex(orgName || ''), 'i') }] });
    } else {
      and.push({ $or: scope });
    }
  }

  if (req.query.search) {
    const rx = { $regex: req.query.search, $options: 'i' };
    and.push({ $or: [{ institution: rx }, { domain: rx }, { hosting: rx }, { builtWith: rx }, { siteType: rx }] });
  }

  const query = and.length ? { $and: and } : {};
  const websites = await Website.find(query).populate('organization', 'name color').sort({ institution: 1 }).lean();
  res.json({ success: true, websites });
});

// @route POST /api/websites  (ADMIN)
export const createWebsite = asyncHandler(async (req, res) => {
  if (!String(req.body.institution || '').trim()) { res.status(400); throw new Error('Institution name is required'); }
  const doc = new Website();
  apply(doc, req.body);
  await doc.save();
  logActivity({ user: req.user._id, organization: doc.organization, action: ACTIVITY_ACTIONS.WEBSITE_UPDATED, description: `Added website ${doc.institution}`, entityType: 'Website', entityId: doc._id });
  res.status(201).json({ success: true, website: doc });
});

// @route PUT /api/websites/:id  (ADMIN)
export const updateWebsite = asyncHandler(async (req, res) => {
  const doc = await Website.findById(req.params.id);
  if (!doc) { res.status(404); throw new Error('Website not found'); }
  apply(doc, req.body);
  await doc.save();
  logActivity({ user: req.user._id, organization: doc.organization, action: ACTIVITY_ACTIONS.WEBSITE_UPDATED, description: `Updated website ${doc.institution}`, entityType: 'Website', entityId: doc._id });
  res.json({ success: true, website: doc });
});

// @route DELETE /api/websites/:id  (ADMIN)
export const deleteWebsite = asyncHandler(async (req, res) => {
  const doc = await Website.findByIdAndDelete(req.params.id);
  if (!doc) { res.status(404); throw new Error('Website not found'); }
  res.json({ success: true, id: req.params.id });
});

// @route POST /api/websites/import  (ADMIN) — bulk import the domain inventory.
// Columns (Institution, Domain, Site Type, Hosting, Built With) auto-detected.
// Each institution is best-effort matched to an existing organization (not
// created, since some rows are landing pages / sub-apps). Upserts by domain
// (falling back to institution) so re-importing updates instead of duplicating.
export const importWebsites = asyncHandler(async (req, res) => {
  if (!req.file) { res.status(400); throw new Error('No Excel file uploaded'); }

  let grid;
  try { grid = await loadGrid(req.file); }
  catch { res.status(400); throw new Error('Could not read the file. Please upload a valid .xlsx Excel file.'); }

  const matchers = [
    { field: 'institution', test: (h) => /institut|college|organi|company|brand|school|name/.test(h) },
    { field: 'domain', test: (h) => /domain|url|link|weburl/.test(h) },
    { field: 'siteType', test: (h) => /sitetype|type/.test(h) },
    { field: 'hosting', test: (h) => /hosting|host|provider|server$/.test(h) },
    { field: 'builtWith', test: (h) => /builtwith|built|stack|framework|technolog|tech|cms/.test(h) },
    { field: 'notes', test: (h) => /note|remark|comment|description/.test(h) },
  ];
  const { headerRow, map } = findColumns(grid, matchers, 'institution');
  if (!map) {
    res.status(400);
    throw new Error('Could not find an Institution column. Add a header row with an "Institution" or "College" column.');
  }

  const orgCache = new Map();
  let created = 0;
  let updated = 0;
  let count = 0;

  for (let i = headerRow + 1; i < grid.length; i++) {
    const row = grid[i] || [];
    const institution = cellText(row[map.institution]).trim();
    if (!institution) continue;

    const domain = (map.domain != null && (cellHyperlink(row[map.domain]) || cellText(row[map.domain]).trim())) || '';
    const record = {
      institution,
      domain,
      siteType: map.siteType != null ? cellText(row[map.siteType]).trim() : '',
      hosting: map.hosting != null ? cellText(row[map.hosting]).trim() : '',
      builtWith: map.builtWith != null ? cellText(row[map.builtWith]).trim() : '',
      notes: map.notes != null ? cellText(row[map.notes]).trim() : '',
    };

    const resolved = await resolveOrganization(institution, { create: false, cache: orgCache });
    const organization = resolved ? resolved.org._id : null;

    // Upsert: same institution + same domain = the same website.
    const q = { institution: new RegExp(`^${escapeRegex(institution)}$`, 'i') };
    if (domain) q.domain = new RegExp(`^${escapeRegex(domain)}$`, 'i');
    let doc = await Website.findOne(q);
    if (doc) {
      Object.assign(doc, record, { organization: organization || doc.organization });
      await doc.save();
      updated += 1;
    } else {
      await Website.create({ ...record, organization });
      created += 1;
    }
    count += 1;
  }

  if (count === 0) { res.status(400); throw new Error('No website rows found under the header.'); }

  logActivity({ user: req.user._id, action: ACTIVITY_ACTIONS.WEBSITE_UPDATED, description: `Imported ${count} websites from Excel (${created} new, ${updated} updated)`, entityType: 'Website' });
  res.json({ success: true, imported: count, created, updated });
});

// @route GET /api/websites/template — download a ready-to-fill template.
export const websiteTemplate = asyncHandler(async (req, res) => {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Websites');
  ws.columns = [
    { header: 'Institution', key: 'institution', width: 26 },
    { header: 'Domain', key: 'domain', width: 42 },
    { header: 'Site Type', key: 'siteType', width: 16 },
    { header: 'Hosting', key: 'hosting', width: 16 },
    { header: 'Built With', key: 'builtWith', width: 28 },
  ];
  const head = ws.getRow(1);
  head.font = { bold: true, color: { argb: 'FFFFFFFF' } };
  head.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF0B2350' } };
  head.height = 22;
  ws.addRow({ institution: 'NCET', domain: 'https://ncet.co.in', siteType: 'Hybrid', hosting: 'CloudFlare', builtWith: 'AstroJS' });
  ws.addRow({ institution: 'NCMS', domain: 'https://ncms.co.in/', siteType: 'Server', hosting: 'AWS', builtWith: 'NextJS With Strapi CMS' });

  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', 'attachment; filename="websites-template.xlsx"');
  await wb.xlsx.write(res);
  res.end();
});
