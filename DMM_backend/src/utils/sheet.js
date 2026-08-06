import { Readable } from 'stream';
import ExcelJS from 'exceljs';
import * as XLSX from 'xlsx';
import Organization, { slugify } from '../models/Organization.js';

// ----------------------------------------------------------------------------
// Cell readers — exceljs cell values may be strings, numbers, rich text,
// hyperlink objects ({ text, hyperlink }) or formula results ({ result }).
// ----------------------------------------------------------------------------
export const cellText = (v) => {
  if (v == null) return '';
  if (typeof v === 'object') {
    if (Array.isArray(v.richText)) return v.richText.map((t) => t.text).join('');
    if (v.text != null) return String(v.text);
    if (v.result != null) return String(v.result);
    if (v.hyperlink != null) return String(v.hyperlink);
    return '';
  }
  return String(v);
};

// The URL behind a hyperlinked cell (e.g. a "LinkedIn" label linking to a page).
export const cellHyperlink = (v) => {
  if (v && typeof v === 'object' && v.hyperlink) return String(v.hyperlink);
  return '';
};

// Parse a number, tolerating "12,500", "4.2%", "₹1,200".
export const cellNumber = (v) => {
  const n = parseFloat(cellText(v).replace(/[^0-9.\-]/g, ''));
  return Number.isFinite(n) && n >= 0 ? n : 0;
};

// Normalize a header for comparison: lowercase, alphanumerics only.
export const normHeader = (s) => cellText(s).toLowerCase().replace(/[^a-z0-9]/g, '');

export const escapeRegex = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// Load the first worksheet of an uploaded file into 1-indexed value arrays
// (index 0 of each row is empty — exceljs convention).
export const loadGrid = async (file) => {
  const grids = await loadAllGrids(file);
  return grids[0].grid;
};

// XLSX files are zip archives ("PK…"); legacy .xls files are OLE compound
// documents (D0 CF 11 E0). LinkedIn still exports the legacy format.
const isZipFile = (buf) => buf && buf.length > 3 && buf[0] === 0x50 && buf[1] === 0x4b;

// SheetJS fallback: reads legacy .xls (BIFF), HTML-table exports and other
// spreadsheet formats ExcelJS can't open. Converted to the same grid shape.
const loadGridsWithSheetJS = (buffer) => {
  const wb = XLSX.read(buffer, { type: 'buffer', cellDates: true });
  if (!wb.SheetNames.length) throw new Error('The file has no sheets.');
  return wb.SheetNames.map((name) => {
    const rows = XLSX.utils.sheet_to_json(wb.Sheets[name], { header: 1, raw: true, defval: null });
    // Match the exceljs convention: 1-indexed rows (index 0 unused), skip empties.
    const grid = rows
      .filter((r) => Array.isArray(r) && r.some((v) => v !== null && v !== ''))
      .map((r) => [undefined, ...r]);
    return { name, grid };
  });
};

// Load EVERY worksheet of an uploaded file: [{ name, grid }] in sheet order.
// LinkedIn's analytics exports are multi-sheet (e.g. "Metrics" + "All posts",
// or "New followers" + demographic breakdowns), so imports must see them all.
// Modern .xlsx goes through ExcelJS; legacy .xls (what LinkedIn actually
// downloads) and anything else goes through SheetJS.
export const loadAllGrids = async (file) => {
  const isCsv = /\.csv$/i.test(file.originalname || '') || file.mimetype === 'text/csv';
  if (isCsv) {
    const wb = new ExcelJS.Workbook();
    await wb.csv.read(Readable.from(file.buffer));
    return wb.worksheets.map((ws) => {
      const grid = [];
      ws.eachRow({ includeEmpty: false }, (row) => { grid.push(row.values); });
      return { name: ws.name || '', grid };
    });
  }
  if (isZipFile(file.buffer)) {
    try {
      const wb = new ExcelJS.Workbook();
      await wb.xlsx.load(file.buffer);
      if (!wb.worksheets.length) throw new Error('The file has no sheets.');
      return wb.worksheets.map((ws) => {
        const grid = [];
        ws.eachRow({ includeEmpty: false }, (row) => { grid.push(row.values); });
        return { name: ws.name || '', grid };
      });
    } catch {
      // fall through — some tools produce zips ExcelJS chokes on
    }
  }
  return loadGridsWithSheetJS(file.buffer);
};

// Find the header row and a { field: columnIndex } map. `matchers` is an ordered
// list of { field, test(normalizedHeader) }; the first matcher to claim a column
// wins, and each field is assigned at most once. The first row that contains
// `requiredField` is treated as the header row.
export const findColumns = (grid, matchers, requiredField) => {
  for (let i = 0; i < grid.length; i++) {
    const map = {};
    (grid[i] || []).forEach((v, col) => {
      if (col === 0) return;
      const h = normHeader(v);
      if (!h) return;
      for (const m of matchers) {
        if (map[m.field] != null) continue;
        if (m.test(h)) { map[m.field] = col; break; }
      }
    });
    if (map[requiredField] != null) return { headerRow: i, map };
  }
  return { headerRow: -1, map: null };
};

// Resolve an organization by display name (case-insensitive name or slug match).
// When `create` is true, a missing org is created with just a name + slug.
// Returns { org, created } or null when the name is blank. Uses `cache` (a Map)
// to avoid repeat lookups within a single import.
export const resolveOrganization = async (name, { create = false, cache, createdBy } = {}) => {
  const clean = String(name || '').trim();
  if (!clean) return null;
  const key = clean.toLowerCase();
  if (cache && cache.has(key)) return cache.get(key);

  let org = await Organization.findOne({ name: new RegExp(`^${escapeRegex(clean)}$`, 'i') });
  if (!org) {
    const slug = slugify(clean);
    if (slug) org = await Organization.findOne({ slug });
  }
  let created = false;
  if (!org && create) {
    let slug = slugify(clean) || `org-${Date.now().toString(36)}`;
    if (await Organization.findOne({ slug })) slug = `${slug}-${Date.now().toString(36).slice(-4)}`;
    org = await Organization.create({ name: clean, slug, createdBy });
    created = true;
  }
  const result = org ? { org, created } : null;
  if (cache) cache.set(key, result);
  return result;
};
