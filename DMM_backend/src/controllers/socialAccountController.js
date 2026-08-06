import asyncHandler from 'express-async-handler';
import ExcelJS from 'exceljs';
import SocialAccount from '../models/SocialAccount.js';
import { logActivity } from '../utils/logActivity.js';
import { requireOrgId, resolveOrgId, accessibleOrgIds, canAccessOrg } from '../utils/org.js';
import { cellText, cellHyperlink, loadGrid, findColumns, resolveOrganization } from '../utils/sheet.js';
import { ROLES, SOCIAL_PLATFORMS, ACTIVITY_ACTIONS } from '../config/constants.js';

const cleanHandlers = (raw) => {
  let arr = raw;
  if (typeof raw === 'string') { try { arr = JSON.parse(raw); } catch { arr = []; } }
  if (!Array.isArray(arr)) return [];
  return arr
    .map((h) => ({
      // Accept a linked user id (from the user picker) or null for manual entry.
      user: /^[0-9a-fA-F]{24}$/.test(String(h.user?._id || h.user || '')) ? String(h.user?._id || h.user) : null,
      name: (h.name || '').trim(),
      email: (h.email || '').trim(),
      phone: (h.phone || '').trim(),
      role: (h.role || '').trim(),
    }))
    .filter((h) => h.user || h.name || h.email || h.phone);
};
const cleanEmails = (raw) => {
  const arr = Array.isArray(raw) ? raw : String(raw || '').split(/[,\n]/);
  return arr.map((e) => String(e).trim()).filter(Boolean);
};

const apply = (doc, body) => {
  ['platform', 'accountName', 'profileUrl', 'ownerName', 'ownerEmail', 'notes'].forEach((f) => {
    if (body[f] !== undefined) doc[f] = body[f];
  });
  if (body.accessCount !== undefined) doc.accessCount = Math.max(0, Number(body.accessCount) || 0);
  if (body.linkedEmails !== undefined) doc.linkedEmails = cleanEmails(body.linkedEmails);
  if (body.handlers !== undefined) doc.handlers = cleanHandlers(body.handlers);
};

// @route GET /api/social-accounts — ADMIN sees all orgs (so they can find any
// org's handler contacts); CEO/USER see only their own org. Optional filters.
export const listSocialAccounts = asyncHandler(async (req, res) => {
  const query = {};
  if (req.user.role === ROLES.ADMIN) {
    const id = resolveOrgId(req);
    if (req.query.organizationId) query.organization = req.query.organizationId;
    else if (id && req.query.scope !== 'all') query.organization = id;
    // scope=all (or no active org) → every organization
  } else {
    const allowed = accessibleOrgIds(req.user);
    if (req.query.organizationId) {
      if (allowed !== null && !allowed.includes(String(req.query.organizationId))) { res.status(403); throw new Error('Not allowed'); }
      query.organization = req.query.organizationId;
    } else if (allowed !== null) {
      query.organization = { $in: allowed };
    } else {
      query.organization = requireOrgId(req, res);
    }
  }
  if (req.query.platform && req.query.platform !== 'All') query.platform = req.query.platform;
  if (req.query.search) {
    const rx = { $regex: req.query.search, $options: 'i' };
    query.$or = [{ accountName: rx }, { ownerName: rx }, { ownerEmail: rx }, { 'handlers.name': rx }, { 'handlers.email': rx }];
  }
  const accounts = await SocialAccount.find(query)
    .populate('organization', 'name color')
    .populate('handlers.user', 'name email phone linkedinUrl avatar jobTitle role isSuperAdmin isActive')
    .sort({ platform: 1 })
    .lean();

  // Handlers linked to a real user account show that user's LIVE details —
  // name/email/phone/LinkedIn come from User Management so they never go stale.
  for (const a of accounts) {
    a.handlers = (a.handlers || []).map((h) => {
      const u = h.user && typeof h.user === 'object' ? h.user : null;
      return {
        ...h,
        name: u?.name || h.name,
        email: u?.email || h.email,
        phone: u?.phone || h.phone,
        linkedinUrl: u?.linkedinUrl || '',
        avatar: u?.avatar || '',
        jobTitle: u?.jobTitle || '',
        linked: !!u,
      };
    });
  }
  res.json({ success: true, accounts });
});

// @route POST /api/social-accounts  (ADMIN)
export const createSocialAccount = asyncHandler(async (req, res) => {
  const orgId = requireOrgId(req, res);
  if (!SOCIAL_PLATFORMS.includes(req.body.platform)) { res.status(400); throw new Error('Valid platform is required'); }
  const doc = new SocialAccount({ organization: orgId });
  apply(doc, req.body);
  await doc.save();
  res.status(201).json({ success: true, account: doc });
});

// @route PUT /api/social-accounts/:id  (ADMIN)
export const updateSocialAccount = asyncHandler(async (req, res) => {
  const doc = await SocialAccount.findById(req.params.id);
  if (!doc) { res.status(404); throw new Error('Account not found'); }
  if (req.body.organization && !canAccessOrg(req.user, req.body.organization)) { res.status(403); throw new Error('Not allowed'); }
  apply(doc, req.body);
  await doc.save();
  res.json({ success: true, account: doc });
});

// @route DELETE /api/social-accounts/:id  (ADMIN)
export const deleteSocialAccount = asyncHandler(async (req, res) => {
  const doc = await SocialAccount.findByIdAndDelete(req.params.id);
  if (!doc) { res.status(404); throw new Error('Account not found'); }
  res.json({ success: true, id: req.params.id });
});

// ----------------------------------------------------------------------------
// Excel import
// ----------------------------------------------------------------------------

// Map a free-text platform cell ("X (Twitter)", "Insta", "you tube") to a canonical name.
const normPlatform = (raw) => {
  const h = cellText(raw).toLowerCase();
  if (h.includes('linkedin')) return 'LinkedIn';
  if (h.includes('insta')) return 'Instagram';
  if (h.includes('youtube') || h.includes('you tube')) return 'YouTube';
  if (h.includes('facebook') || h.includes('fb')) return 'Facebook';
  if (h.includes('twitter') || /(^|[^a-z])x([^a-z]|$)/.test(h)) return 'X (Twitter)';
  return '';
};

const isBlankName = (t) => !t || /^n\.?\/?a\.?$/i.test(t.trim()) || /^-+$/.test(t.trim());

// Split a cell like "Shibu, Shishira, Sowmya Shree (HR)" into people, separating
// out anything that looks like an email.
const parsePeople = (text) => {
  const out = { names: [], emails: [], portfolio: false };
  const t = String(text || '').trim();
  if (isBlankName(t)) return out;
  if (/under\s+business\s+portfolio/i.test(t)) { out.portfolio = true; return out; }
  for (const piece of t.split(/[,/;]|\sand\s/i)) {
    const p = piece.trim();
    if (!p) continue;
    if (p.includes('@')) out.emails.push(p);
    else out.names.push(p);
  }
  return out;
};

// Pull names out of a note like "Portfolio Admins: Shishira, Babji, Branding".
const portfolioNamesFromNote = (note) => {
  const m = String(note || '').match(/portfolio\s+admins?\s*:?\s*(.+)/i);
  if (!m) return [];
  return m[1].split(/[,/;]|\sand\s/i).map((s) => s.trim()).filter(Boolean);
};

// @route POST /api/social-accounts/import  (ADMIN) — bulk import the social
// handlers directory from an Excel sheet. Columns (College/Institution, Platform,
// Admin Name, Admin Type, Note) are auto-detected. The hyperlink behind the
// platform label becomes the profile URL. Rows with a blank platform are treated
// as a continuation of the row above (more admins for the same account). Each
// College is matched to an organization (created if it doesn't exist yet).
export const importSocialAccounts = asyncHandler(async (req, res) => {
  if (!req.file) { res.status(400); throw new Error('No Excel file uploaded'); }

  let grid;
  try { grid = await loadGrid(req.file); }
  catch { res.status(400); throw new Error('Could not read the file. Please upload a valid .xlsx Excel file.'); }

  const matchers = [
    { field: 'college', test: (h) => /college|institut|organi|company|brand|school|account/.test(h) },
    { field: 'platform', test: (h) => /platform|channel|network|media/.test(h) },
    { field: 'adminType', test: (h) => /admintype|accesstype|level|type$|^type/.test(h) },
    { field: 'admin', test: (h) => /admin|owner|handler|handledby|incharge|manage|name/.test(h) },
    { field: 'note', test: (h) => /note|remark|comment|portfolio|description/.test(h) },
  ];
  const { headerRow, map } = findColumns(grid, matchers, 'college');
  if (!map || map.platform == null) {
    res.status(400);
    throw new Error('Could not detect the columns. The sheet needs a header row with at least "College" and "Platform" columns.');
  }

  const orgCache = new Map();
  const accounts = new Map(); // key `${orgId}|${platform}` -> { doc, existedInDb }
  const createdOrgs = new Set();
  const unresolved = new Set();
  let lastCollege = '';
  let lastPlatform = '';

  for (let i = headerRow + 1; i < grid.length; i++) {
    const row = grid[i] || [];
    const collegeRaw = cellText(row[map.college]).trim();
    const platformRaw = cellText(row[map.platform]).trim();
    const college = collegeRaw || lastCollege;
    let platform = normPlatform(platformRaw);
    if (!platform) platform = lastPlatform; // blank platform = continuation of the row above
    if (collegeRaw) lastCollege = collegeRaw;
    if (platform) lastPlatform = platform;
    if (!college || !platform) continue;

    const adminText = map.admin != null ? cellText(row[map.admin]).trim() : '';
    const adminType = map.adminType != null ? cellText(row[map.adminType]).trim() : '';
    const note = map.note != null ? cellText(row[map.note]).trim() : '';
    const profileUrl = cellHyperlink(row[map.platform]);

    // Skip rows that carry no real information (e.g. an "NA" account with no
    // link and no admins), so we don't create empty placeholder records.
    const people = parsePeople(adminText);
    const hasContent = !!profileUrl || people.portfolio || people.names.length > 0 || people.emails.length > 0;
    if (!hasContent) continue;

    // Resolve (or create) the organization for this college.
    const resolved = await resolveOrganization(college, { create: true, cache: orgCache, createdBy: req.user._id });
    if (!resolved) { unresolved.add(college); continue; }
    if (resolved.created) createdOrgs.add(String(resolved.org._id));
    const orgId = String(resolved.org._id);

    // Get or build the account record for this org + platform.
    const key = `${orgId}|${platform}`;
    let entry = accounts.get(key);
    if (!entry) {
      let doc = await SocialAccount.findOne({ organization: resolved.org._id, platform });
      const existedInDb = !!doc;
      if (!doc) doc = new SocialAccount({ organization: resolved.org._id, platform, handlers: [], linkedEmails: [] });
      entry = { doc, existedInDb };
      accounts.set(key, entry);
    }
    const { doc } = entry;

    // Profile URL from the hyperlink (don't overwrite an existing one).
    if (profileUrl && !doc.profileUrl) doc.profileUrl = profileUrl;

    // Distribute the parsed admins onto the account.
    if (people.portfolio) {
      const role = 'Portfolio Admin';
      for (const n of portfolioNamesFromNote(note)) addHandler(doc, n, role);
      if (!doc.notes && note) doc.notes = note;
    } else {
      const role = adminType || 'Admin';
      for (const n of people.names) addHandler(doc, n, role);
      for (const e of people.emails) {
        if (!doc.linkedEmails.includes(e)) doc.linkedEmails.push(e);
      }
    }
    if (note && doc.notes && doc.notes !== note && !doc.notes.includes(note)) {
      doc.notes = `${doc.notes} | ${note}`;
    } else if (note && !doc.notes) {
      doc.notes = note;
    }
  }

  if (accounts.size === 0) {
    res.status(400);
    throw new Error('No usable rows found. Make sure each row has a College and a Platform.');
  }

  let created = 0;
  let updated = 0;
  for (const { doc, existedInDb } of accounts.values()) {
    await doc.save();
    if (existedInDb) updated += 1; else created += 1;
  }

  logActivity({
    user: req.user._id,
    action: ACTIVITY_ACTIONS.SOCIAL_ACCOUNT_UPDATED,
    description: `Imported ${accounts.size} social accounts from Excel (${created} new, ${updated} updated, ${createdOrgs.size} new organizations)`,
    entityType: 'SocialAccount',
  });

  res.json({
    success: true,
    imported: accounts.size,
    created,
    updated,
    organizationsCreated: createdOrgs.size,
    unresolved: [...unresolved],
  });
});

// Add a handler (coordinator) to an account, de-duplicated by name.
function addHandler(doc, name, role) {
  const clean = String(name || '').trim();
  if (!clean) return;
  const existing = doc.handlers.find((h) => (h.name || '').toLowerCase() === clean.toLowerCase());
  if (existing) {
    if (role && !existing.role) existing.role = role;
  } else {
    doc.handlers.push({ name: clean, role: role || '' });
  }
}

// @route GET /api/social-accounts/template — download a ready-to-fill template.
export const socialAccountTemplate = asyncHandler(async (req, res) => {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Social Accounts');
  ws.columns = [
    { header: 'College', key: 'college', width: 24 },
    { header: 'Platform', key: 'platform', width: 16 },
    { header: 'Admin Name', key: 'admin', width: 40 },
    { header: 'Note', key: 'note', width: 44 },
    { header: 'Admin Type', key: 'adminType', width: 18 },
  ];
  const head = ws.getRow(1);
  head.font = { bold: true, color: { argb: 'FFFFFFFF' } };
  head.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF0B2350' } };
  head.height = 22;
  ws.addRow({ college: 'NCET', platform: 'LinkedIn', admin: 'Shibu, Shishira', note: '', adminType: 'Super Admin' });
  ws.addRow({ college: 'NCET', platform: '', admin: 'Babji, Bhargava', note: '', adminType: 'Content Admin' });
  ws.addRow({ college: 'NCET', platform: 'Instagram', admin: 'Under Business Portfolio', note: 'Portfolio Admins: Shishira, Babji, Branding', adminType: '' });
  // Make the platform cell on the LinkedIn row a hyperlink, so importers learn the URL.
  ws.getCell('B2').value = { text: 'LinkedIn', hyperlink: 'https://www.linkedin.com/company/your-college' };

  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', 'attachment; filename="social-accounts-template.xlsx"');
  await wb.xlsx.write(res);
  res.end();
});
