import asyncHandler from 'express-async-handler';
import ExcelJS from 'exceljs';
import PDFDocument from 'pdfkit';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { buildPeriodReport, lastCompleteMonth } from '../services/periodReport.js';
import { accessibleOrgIds, canAccessOrg } from '../utils/org.js';
import { PLATFORMS } from '../config/constants.js';
import Organization from '../models/Organization.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Named windows, so the common asks are one click rather than two date pickers.
const PRESETS = {
  'this-month': () => {
    const now = new Date();
    return {
      from: new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)),
      to: now,
    };
  },
  'last-month': () => lastCompleteMonth(),
  'this-fortnight': () => {
    const now = new Date();
    const day = now.getUTCDate();
    const start = day <= 15 ? 1 : 16;
    return { from: new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), start)), to: now };
  },
  'last-fortnight': () => {
    const now = new Date();
    const day = now.getUTCDate();
    if (day <= 15) {
      // The second half of the previous month.
      const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 0, 23, 59, 59, 999));
      return { from: new Date(Date.UTC(end.getUTCFullYear(), end.getUTCMonth(), 16)), to: end };
    }
    return {
      from: new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)),
      to: new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 15, 23, 59, 59, 999)),
    };
  },
  'this-quarter': () => {
    const now = new Date();
    const q = Math.floor(now.getUTCMonth() / 3) * 3;
    return { from: new Date(Date.UTC(now.getUTCFullYear(), q, 1)), to: now };
  },
};

// Resolve the window from either a preset or explicit dates.
const resolveWindow = (req, res) => {
  const { preset, from, to } = req.query;
  if (preset) {
    const build = PRESETS[preset];
    if (!build) {
      res.status(400);
      throw new Error(`preset must be one of ${Object.keys(PRESETS).join(', ')}`);
    }
    return build();
  }
  const isDay = (s) => /^\d{4}-\d{2}-\d{2}$/.test(s || '');
  if (!isDay(from) || !isDay(to)) {
    res.status(400);
    throw new Error('Provide ?preset=, or ?from=YYYY-MM-DD&to=YYYY-MM-DD');
  }
  const start = new Date(`${from}T00:00:00.000Z`);
  const end = new Date(`${to}T23:59:59.999Z`);
  if (end < start) { res.status(400); throw new Error('The "to" date cannot be before the "from" date'); }
  return { from: start, to: end };
};

// @route GET /api/reports/period?preset=last-month  (or ?from=&to=)
// The whole Branding & Marketing report for a window. An Admin gets it for the
// institutions they hold; the super admin for every college.
export const getPeriodReport = asyncHandler(async (req, res) => {
  const { from, to } = resolveWindow(req, res);
  const allowed = accessibleOrgIds(req.user);
  const report = await buildPeriodReport({
    from,
    to,
    orgIds: allowed === null ? undefined : allowed,
  });
  res.json({ success: true, presets: Object.keys(PRESETS), ...report });
});

// One sheet per part, so the workbook mirrors the report rather than flattening it.
const addSheet = (wb, title, columns, rows, totalRow) => {
  const ws = wb.addWorksheet(title);
  ws.addRow(columns).font = { bold: true };
  rows.forEach((r) => ws.addRow(r));
  if (totalRow) ws.addRow(totalRow).font = { bold: true };
  ws.columns.forEach((c, i) => {
    const width = Math.max(String(columns[i] || '').length + 2, 14);
    c.width = i === 0 ? Math.max(width, 26) : width;
  });
  return ws;
};

const dash = (v) => (v == null ? '—' : v);

// @route GET /api/reports/period/export?preset=last-month — the same report as .xlsx
export const exportPeriodReport = asyncHandler(async (req, res) => {
  const { from, to } = resolveWindow(req, res);
  const allowed = accessibleOrgIds(req.user);
  const r = await buildPeriodReport({ from, to, orgIds: allowed === null ? undefined : allowed });

  const wb = new ExcelJS.Workbook();
  wb.creator = 'Branding & Marketing';

  // Overview
  const overview = wb.addWorksheet('Overview');
  overview.addRow(['Branding & Marketing Report']).font = { bold: true, size: 14 };
  overview.addRow([`${r.period.from} to ${r.period.to} (${r.period.days} days)`]);
  overview.addRow([]);
  overview.addRow(['Metric', 'Value']).font = { bold: true };
  const h = r.headline;
  [
    ['Designs delivered', `${h.designsDelivered.value} / ${h.designsDelivered.of}`],
    ['Delivered on time', h.deliveredOnTimeRate == null ? '—' : `${h.deliveredOnTimeRate}%`],
    ['Web tasks done', `${h.webTasksDone.value} / ${h.webTasksDone.of}`],
    ['Posts published', h.postsPublished],
    ['Likes', h.likes],
    ['Ad spend', h.adSpend],
    ['Design pending', h.designPending],
    ['Design cancelled', h.designCancelled],
    ['Designs completed', h.designsCompleted],
    ['First-pass approval', h.firstPassRate == null ? '—' : `${h.firstPassRate}%`],
    ['Avg revision rounds', dash(h.avgRevisionRounds)],
    ['Organic reach', h.organicReach],
    ['Follower growth', h.followerGrowth],
    ['Paid reach', h.paidReach],
    ['Leads from ads', h.leadsFromAds],
    ['Cost per lead', dash(h.costPerLead)],
    ['Team tasks done', `${h.teamTasksDone.value} / ${h.teamTasksDone.of}`],
  ].forEach((row) => overview.addRow(row));
  overview.columns[0].width = 28;
  overview.columns[1].width = 20;

  if (r.gaps.length) {
    overview.addRow([]);
    overview.addRow(['What these numbers cannot tell you yet']).font = { bold: true };
    r.gaps.forEach((g) => overview.addRow([g]));
  }

  // Part 1
  addSheet(wb, '1 Design output',
    ['Institution', 'Requests received', 'Completed', 'Pending', 'Cancelled', 'Delivered on time', 'On-time rate %',
      'Approved first pass', 'First-pass rate %', 'Avg revision rounds'],
    r.design.rows.map((x) => [x.organization.name, x.requestsReceived, x.completed, x.pending, x.cancelled,
      dash(x.deliveredOnTime), dash(x.onTimeRate), x.approvedFirstPass, dash(x.firstPassRate),
      dash(x.avgRevisionRounds)]),
    ['ALL INSTITUTIONS', r.design.totals.requestsReceived, r.design.totals.completed, r.design.totals.pending,
      r.design.totals.cancelled, dash(r.design.totals.deliveredOnTime), dash(r.design.totals.onTimeRate),
      r.design.totals.approvedFirstPass, dash(r.design.totals.firstPassRate),
      dash(r.design.totals.avgRevisionRounds)]);

  if (r.design.mix.length) {
    addSheet(wb, '1b What designs were', ['Type', 'Count', 'Share %'],
      r.design.mix.map((m) => [m.label, m.count, dash(m.share)]));
  }

  // Part 2
  addSheet(wb, '2 Web development',
    ['Institution', 'Tasks received', 'Completed', 'Pending', 'Delivered on time', 'On-time rate %', 'Avg turnaround (d)'],
    r.web.rows.map((x) => [x.organization.name, x.tasksReceived, x.completed, x.pending,
      dash(x.deliveredOnTime), dash(x.onTimeRate), dash(x.avgTurnaroundDays)]),
    ['ALL INSTITUTIONS', r.web.totals.tasksReceived, r.web.totals.completed, r.web.totals.pending,
      dash(r.web.totals.deliveredOnTime), dash(r.web.totals.onTimeRate), dash(r.web.totals.avgTurnaroundDays)]);

  // Part 3
  addSheet(wb, '3 Social organic',
    ['Account', 'Posts', 'Reach', 'Impressions', 'Likes', 'Comments', 'Shares', 'Interactions',
      'Followers', 'Follower growth'],
    r.social.rows.map((x) => [x.organization.name, x.posts, x.reach, x.impressions, x.likes, x.comments,
      x.shares, x.interactions, x.followers, x.followerGrowth]),
    ['ALL ACCOUNTS', r.social.totals.posts, r.social.totals.reach, r.social.totals.impressions,
      r.social.totals.likes, r.social.totals.comments, r.social.totals.shares, r.social.totals.interactions,
      r.social.totals.followers, r.social.totals.followerGrowth]);

  if (r.social.leaderboard.length) {
    addSheet(wb, '3b Leaderboard', ['Rank', 'Account', 'Posts', 'Reach', 'Likes', 'Followers', 'Growth'],
      r.social.leaderboard.map((x) => [x.rank, x.organization.name, x.posts, x.reach, x.likes, x.followers, x.followerGrowth]));
  }
  if (r.social.topPosts.length) {
    addSheet(wb, '3c Best posts', ['Account', 'Platform', 'Post', 'Audience', 'Measured as', 'Likes'],
      r.social.topPosts.map((x) => [x.organization?.name || '—', x.platform, x.title, x.audienceCount, x.audienceLabel, x.likes]));
  }

  // Part 4
  addSheet(wb, '4 Paid ads',
    ['Account', 'Spend', 'Reach', 'Impressions', 'Frequency', 'Clicks', 'CTR %', 'CPM', 'CPC', 'Leads', 'Cost per lead'],
    r.ads.rows.map((x) => [x.organization.name, x.spend, x.reach, x.impressions, dash(x.frequency), x.clicks,
      dash(x.ctr), dash(x.cpm), dash(x.cpc), x.leads, dash(x.costPerLead)]),
    ['ALL ACCOUNTS', r.ads.totals.spend, r.ads.totals.reach, r.ads.totals.impressions, dash(r.ads.totals.frequency),
      r.ads.totals.clicks, dash(r.ads.totals.ctr), dash(r.ads.totals.cpm), dash(r.ads.totals.cpc),
      r.ads.totals.leads, dash(r.ads.totals.costPerLead)]);

  if (r.ads.topCampaigns.length) {
    addSheet(wb, '4b Top campaigns', ['Account', 'Campaign', 'Objective', 'Spend', 'Leads', 'Cost per lead'],
      r.ads.topCampaigns.map((x) => [x.organization?.name || '—', x.name, x.objective, x.spend, x.leads,
        x.costPerLead == null ? x.note || '—' : x.costPerLead]));
  }

  // Part 5
  addSheet(wb, '5 Team output',
    ['Person', 'Role', 'Tasks assigned', 'Completed', 'Pending', 'Design tasks', 'Social creatives',
      'Web tasks', 'Delivered on time', 'On-time rate %', 'Avg turnaround (d)'],
    r.team.rows.map((x) => [x.person.name, x.person.role, x.tasksAssigned, x.completed, x.pending,
      x.designTasks, x.socialCreatives, x.webTasks, dash(x.deliveredOnTime), dash(x.onTimeRate),
      dash(x.avgTurnaroundDays)]),
    ['TEAM TOTAL', `${r.team.totals.people} people`, r.team.totals.tasksAssigned, r.team.totals.completed,
      r.team.totals.pending, r.team.totals.designTasks, r.team.totals.socialCreatives, r.team.totals.webTasks,
      dash(r.team.totals.deliveredOnTime), dash(r.team.totals.onTimeRate), dash(r.team.totals.avgTurnaroundDays)]);

  const filename = `branding-report-${r.period.from}-to-${r.period.to}.xlsx`;
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  await wb.xlsx.write(res);
  res.end();
});

// ---------------------------------------------------------------------------
// PDF export — a dedicated, purpose-built renderer over the same buildPeriodReport()
// data used above; it never converts the Excel workbook, and it accepts its own
// organization/platform filters independent of whatever the report page has open.

const LOGO_DIR = path.join(__dirname, '..', 'assets', 'logos');
const LETTERHEAD_LOGO_PATH = path.join(LOGO_DIR, 'ngi.png');

const NAVY = '#0f1f3d';
const ORANGE = '#f5822a';
const GREY = '#5b6472';
const HEADER_FILL = '#eef1f8';
const RULE = '#d8dce6';
// Bar/column charts alternate orange and blue per bar rather than filling
// every single one the same colour, so a multi-bar chart reads as distinct
// items at a glance instead of one solid block. The blue is #267ad9 — the
// exact brand navy the portal team supplied (#011e40) shares this hue
// (~212°) but is itself unusable as a fill: it fails the palette validator
// outright (OKLCH L 0.237, C 0.074 — both well under the light-surface floor,
// same failure NAVY/#0f1f3d hit earlier), so on a white page it renders as
// near-black rather than a recognisable blue, indistinguishable from ORANGE's
// own dark outline and from plain text. #267ad9 keeps that same hue and lifts
// only the lightness/chroma enough to clear the floor — the brand blue, made
// visible, not a different blue.
const BAR_COLORS = [ORANGE, '#267ad9'];

const PAGE_MARGIN = 40;
const FOOTER_RESERVE = 34;
const ROW_H = 15;
// Where content starts on a fresh page, right under the repeated letterhead
// (logo + "Toriiminds LLP"/"Generated on…" block + the orange rule) — used to
// work out whether a whole table would fit on a clean page of its own.
const FRESH_PAGE_CONTENT_TOP = 130;

// Logos are optional until the real assets are supplied — the header simply
// omits whichever one is missing rather than failing the whole report.
const drawLogo = (doc, imgPath, x, boxW, boxH, align) => {
  if (!fs.existsSync(imgPath)) return;
  try {
    doc.image(imgPath, x, PAGE_MARGIN, { fit: [boxW, boxH], align, valign: 'top' });
  } catch {
    // Corrupt/unsupported image file — skip it rather than fail the report.
  }
};

// "29 Sep 2026" — matches the "Generated on …" wording the ToriiMinds LLP
// letterhead already uses on its other generated reports.
const formatGeneratedDate = (d = new Date()) => {
  const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
};

// Same letterhead layout as every other ToriiMinds LLP report this product
// suite generates: the ToriiMinds logo + company name top-left, the
// generation/confidentiality note top-right, repeated on every page.
const makeHeaderDrawer = (generatedLabel) => (doc) => {
  const logoBoxW = 72;
  const logoBoxH = 72;
  const top = PAGE_MARGIN;
  const textY = top + 52;
  const rightBlockW = 220;
  const rightBlockX = doc.page.width - PAGE_MARGIN - rightBlockW;

  drawLogo(doc, LETTERHEAD_LOGO_PATH, PAGE_MARGIN, logoBoxW, logoBoxH, 'left');

  doc.fontSize(8.5).font('Helvetica').fillColor(GREY);
  doc.text(`Generated on ${generatedLabel}`, rightBlockX, textY, { width: rightBlockW, align: 'right' });
  doc.text('Confidential — for institutional use', rightBlockX, doc.y, { width: rightBlockW, align: 'right' });

  doc.y = Math.max(doc.y, textY + 14) + 8;
  doc.moveTo(PAGE_MARGIN, doc.y).lineTo(doc.page.width - PAGE_MARGIN, doc.y).lineWidth(2).strokeColor(ORANGE).stroke();
  doc.moveDown(0.5);
};

// Centred, regular weight with generous letter-spacing rather than a heavy
// bold block — reads as a report title, not a banner — finished with a short
// orange rule so it still carries the brand accent.
const drawTitleBlock = (doc, title) => {
  const width = doc.page.width - PAGE_MARGIN * 2;
  doc.moveDown(0.3);
  doc.fontSize(19).font('Helvetica').fillColor(NAVY)
    .text(title, PAGE_MARGIN, doc.y, { width, align: 'center', characterSpacing: 2.2 });
  const ruleY = doc.y + 5;
  const ruleW = 56;
  doc.moveTo((doc.page.width - ruleW) / 2, ruleY).lineTo((doc.page.width + ruleW) / 2, ruleY)
    .lineWidth(2).strokeColor(ORANGE).stroke();
  doc.y = ruleY + 14;
};

// Returns whether it had to start a new page, so a table mid-break can repeat
// its header row on the new page instead of leaving a headerless orphan.
const ensureSpace = (doc, needed) => {
  if (doc.y + needed > doc.page.height - PAGE_MARGIN - FOOTER_RESERVE) { doc.addPage(); return true; }
  return false;
};

// The filters this specific PDF was generated against, as a row of letterhead-
// style boxes (matching how every other ToriiMinds LLP report states its scope
// up front) rather than a line of prose — the first thing a reader's eye should
// land on to know exactly what they're looking at.
const drawMetaBar = (doc, items) => {
  const gap = 8;
  const usableW = doc.page.width - PAGE_MARGIN * 2;
  const boxW = (usableW - gap * (items.length - 1)) / items.length;
  // The value can be a full date range or "All Social Media Accounts" — long
  // enough to need two lines sometimes, so it wraps rather than ellipsising
  // away information the reader explicitly chose as a filter.
  const boxH = 42;
  ensureSpace(doc, boxH + 12);
  const y = doc.y;
  items.forEach((it, i) => {
    const x = PAGE_MARGIN + i * (boxW + gap);
    doc.roundedRect(x, y, boxW, boxH, 4).fillAndStroke(HEADER_FILL, RULE);
    doc.fontSize(6.5).font('Helvetica-Bold').fillColor(GREY)
      .text(it.label.toUpperCase(), x + 8, y + 6, { width: boxW - 16, height: 9, ellipsis: true });
    doc.fontSize(9).font('Helvetica-Bold').fillColor(NAVY)
      .text(sanitizeForPdf(it.value), x + 8, y + 17, { width: boxW - 16, height: 24 });
  });
  doc.y = y + boxH;
  doc.moveDown(0.7);
};

// Keeps a heading on the same page as what immediately follows it (its table,
// chart, or a few legend rows) whenever that combination can reasonably fit
// on one page — the same "move the whole thing to a fresh page rather than
// split it" rule as drawTable, just applied to "heading + its content" as the
// unit instead of "table" as the unit. Without this, a
// heading could pass its own small ensureSpace check, get drawn at the very
// bottom of a page, and leave its actual table to start completely fresh on
// the next page — which reads exactly like the table having been split, even
// though technically only the heading stayed behind. `ownHeight` is the
// heading's own footprint; `followingHeight` is the caller's best estimate of
// what it's about to draw right after (e.g. a table's header+rows+total).
const keepWithNext = (doc, ownHeight, followingHeight) => {
  const combined = ownHeight + followingHeight;
  const remaining = doc.page.height - PAGE_MARGIN - FOOTER_RESERVE - doc.y;
  if (combined <= remaining) return;
  const maxOnFreshPage = doc.page.height - FRESH_PAGE_CONTENT_TOP - PAGE_MARGIN - FOOTER_RESERVE;
  if (combined <= maxOnFreshPage) { doc.addPage(); return; }
  // The content itself is taller than a whole page and will have to split
  // regardless — just make sure the heading itself isn't cut off.
  ensureSpace(doc, ownHeight);
};

// A small coloured accent bar ahead of the heading, so each part reads as its
// own report card rather than another row in one long table.
const sectionTitle = (doc, text, followingHeight = 0) => {
  keepWithNext(doc, 34, followingHeight);
  doc.moveDown(0.4);
  const y = doc.y;
  doc.rect(PAGE_MARGIN, y + 1, 3, 12).fill(ORANGE);
  doc.fontSize(11.5).font('Helvetica-Bold').fillColor(NAVY)
    .text(text, PAGE_MARGIN + 9, y, { width: doc.page.width - PAGE_MARGIN * 2 - 9 });
  doc.moveDown(0.2);
};

// The one-line "what this part adds up to" — the same summary already shown
// on screen next to each part's table (PeriodReport.jsx), so the PDF states
// the headline before the reader has to read the table to find it themselves.
const sectionSubtitle = (doc, text) => {
  if (!text) return;
  doc.fontSize(8).font('Helvetica-Oblique').fillColor(GREY)
    .text(text, PAGE_MARGIN + 9, doc.y, { width: doc.page.width - PAGE_MARGIN * 2 - 9 });
  doc.moveDown(0.3);
};

const subheading = (doc, text, followingHeight = 0) => {
  keepWithNext(doc, 22, followingHeight);
  doc.moveDown(0.2);
  doc.fontSize(9.5).font('Helvetica-Bold').fillColor(NAVY)
    .text(text, PAGE_MARGIN, doc.y, { width: doc.page.width - PAGE_MARGIN * 2 });
  doc.moveDown(0.15);
};

// Matches drawTable's own header+rows(+total) height formula, so a caller can
// tell sectionTitle/subheading how tall the table right after it will be.
const tableHeightOf = (rows, hasTotal = true) => 24 + rows.length * ROW_H + (hasTotal ? ROW_H : 0);

// Matches drawCardGrid's own row-wrapping formula.
const CARD_H = 34;
const CARD_GAP = 6;
const CARDS_PER_ROW = 4;
const cardGridHeightOf = (count) => Math.ceil(count / CARDS_PER_ROW) * (CARD_H + CARD_GAP);

// Matches drawStackedBar's/drawBarChart's/drawGroupedBarChart's own height formulas.
const stackedBarHeightOf = (items) => 22 + 10 + items.length * 14;
const barChartHeightOf = () => 90 + 34;
const GROUPS_PER_CHART = 8;
const groupedChartHeightOf = (groupCount) => Math.max(1, Math.ceil(groupCount / GROUPS_PER_CHART)) * (14 + 110 + 30);

// The headline KPIs as compact stat cards (mirroring the on-screen dashboard
// tiles), four to a row so the whole overview fits in a few lines rather than
// dominating the first page.
const drawCardGrid = (doc, cards) => {
  const usableW = doc.page.width - PAGE_MARGIN * 2;
  const cardW = (usableW - CARD_GAP * (CARDS_PER_ROW - 1)) / CARDS_PER_ROW;
  for (let i = 0; i < cards.length; i += CARDS_PER_ROW) {
    ensureSpace(doc, CARD_H + CARD_GAP);
    const y = doc.y;
    cards.slice(i, i + CARDS_PER_ROW).forEach((c, j) => {
      const x = PAGE_MARGIN + j * (cardW + CARD_GAP);
      doc.roundedRect(x, y, cardW, CARD_H, 4).fillAndStroke('#ffffff', RULE);
      doc.rect(x, y, 3, CARD_H).fill(c.color);
      doc.fontSize(11.5).font('Helvetica-Bold').fillColor(NAVY)
        .text(String(c.value), x + 9, y + 6, { width: cardW - 14, height: 14, ellipsis: true });
      doc.fontSize(6).font('Helvetica-Bold').fillColor(GREY)
        .text(c.label.toUpperCase(), x + 9, y + 22, { width: cardW - 14, height: 8, ellipsis: true });
    });
    doc.y = y + CARD_H + CARD_GAP;
  }
  doc.moveDown(0.2);
};

// Three colour-coded read-outs (green/amber/red) generated straight off this
// same report's own totals — never fabricated copy — so the reader knows what
// to act on before they reach a single table. Thresholds are conservative and
// only ever fire off a real, measured number (never an estimate).
const INSIGHT_STYLES = {
  strength: { title: 'Positives', color: '#059669', bg: '#ecfdf5', empty: 'No standout positives this period.' },
  watch: { title: 'Improvements', color: '#d97706', bg: '#fffbeb', empty: 'Nothing to improve on here this period.' },
  critical: { title: 'Critical', color: '#e11d48', bg: '#fff1f2', empty: 'Nothing critical this period.' },
};

const drawInsightCards = (doc, buckets, { heading } = {}) => {
  const gap = 8;
  const usableW = doc.page.width - PAGE_MARGIN * 2;
  const boxW = (usableW - gap * 2) / 3;
  const textW = boxW - 16;
  const keys = ['strength', 'watch', 'critical'];
  const lists = keys.map((k) => (buckets[k].length ? buckets[k] : [INSIGHT_STYLES[k].empty]).map(sanitizeForPdf));

  doc.fontSize(7.2).font('Helvetica');
  const colHeights = lists.map((items) => items.reduce((sum, t) => sum + doc.heightOfString(`• ${t}`, { width: textW }) + 5, 0));
  const boxH = Math.max(...colHeights) + 30;

  if (heading) subheading(doc, heading, boxH + 10);
  ensureSpace(doc, boxH + 10);
  const y = doc.y;
  keys.forEach((key, i) => {
    const style = INSIGHT_STYLES[key];
    const x = PAGE_MARGIN + i * (boxW + gap);
    doc.roundedRect(x, y, boxW, boxH, 5).fillAndStroke(style.bg, style.color);
    doc.fontSize(8.5).font('Helvetica-Bold').fillColor(style.color)
      .text(style.title, x + 8, y + 8, { width: textW });
    let ty = y + 24;
    lists[i].forEach((t) => {
      doc.fontSize(7.2).font('Helvetica').fillColor('#334155');
      doc.text(`• ${t}`, x + 8, ty, { width: textW });
      ty = doc.y + 5;
    });
  });
  doc.y = y + boxH;
  doc.moveDown(0.6);
};

// The categorical palette for "parts of a whole" charts — brand orange and
// blue anchor the first two slots (the two colours this portal is built on;
// see BAR_COLORS above for why the blue is #267ad9 and not the exact, too-dark
// #011e40 brand hex), extended with four more hues chosen and ordered so
// every adjacent pair stays distinguishable under colour-blindness simulation
// (validated with dataviz's validate_palette.js: lightness band, chroma
// floor, CVD separation and normal-vision separation all pass in this exact
// order — reordering or swapping a slot needs re-validating, not eyeballing).
// Fixed order, never cycled arbitrarily: item 1 always gets slot 1, etc.
const CATEGORICAL_COLORS = [ORANGE, '#267ad9', '#059669', '#7c3aed', '#d97706', '#e11d48'];

// "Part-to-whole" data reads better as a single segmented bar than a pie —
// a pie's thin slices are hard to compare or label once there's more than a
// couple of categories, while a stacked bar keeps every segment's length
// (and the legend's exact count/share) equally easy to read. Used for design/
// web type mix, where a pending design is stuck, platform split, ad channel
// split — anything ≤ CATEGORICAL_COLORS.length wide (see drawBreakdownChart).
const drawStackedBar = (doc, items) => {
  if (!items?.length) return;
  const usableW = doc.page.width - PAGE_MARGIN * 2;
  const barH = 22;
  const segGap = 2; // the surface-colour gap that separates segments, not a stroke
  const rowH = 14;
  const chartHeight = barH + 10 + items.length * rowH;

  // Same "don't split what can stay together" rule as drawTable.
  const remaining = doc.page.height - PAGE_MARGIN - FOOTER_RESERVE - doc.y;
  const maxOnFreshPage = doc.page.height - FRESH_PAGE_CONTENT_TOP - PAGE_MARGIN - FOOTER_RESERVE;
  if (chartHeight > remaining && chartHeight <= maxOnFreshPage) doc.addPage();

  const top = doc.y;
  const total = items.reduce((s, i) => s + (i.count ?? i.amount ?? 0), 0) || 1;
  let x = PAGE_MARGIN;
  items.forEach((it, idx) => {
    const value = it.count ?? it.amount ?? 0;
    const rawW = (value / total) * usableW;
    const isLast = idx === items.length - 1;
    const fillW = Math.max(0, rawW - (isLast ? 0 : segGap));
    if (fillW > 0) doc.rect(x, top, fillW, barH).fill(it.color || CATEGORICAL_COLORS[idx % CATEGORICAL_COLORS.length]);
    x += rawW;
  });

  let ly = top + barH + 10;
  const labelW = usableW * 0.55;
  const valueW = usableW * 0.2;
  const shareW = usableW - labelW - valueW;
  items.forEach((it, idx) => {
    const value = it.count ?? it.amount ?? 0;
    doc.rect(PAGE_MARGIN, ly + 1, 7, 7).fill(it.color || CATEGORICAL_COLORS[idx % CATEGORICAL_COLORS.length]);
    doc.fontSize(7.5).font('Helvetica-Bold').fillColor('#334155')
      .text(sanitizeForPdf(it.label), PAGE_MARGIN + 12, ly, { width: labelW - 12, height: 10, ellipsis: true });
    doc.font('Helvetica-Bold').fillColor(NAVY)
      .text(fmt(value), PAGE_MARGIN + labelW, ly, { width: valueW, height: 10, align: 'right', ellipsis: true });
    doc.font('Helvetica').fillColor(GREY)
      .text(it.share == null ? '—' : `${it.share}%`, PAGE_MARGIN + labelW + valueW, ly, { width: shareW, height: 10, align: 'right', ellipsis: true });
    ly += rowH;
  });

  doc.y = top + chartHeight;
  doc.moveDown(0.5);
};

// The bar-chart alternative to a pie: a full-width horizontal bar per item,
// with its exact count and share alongside. A pie reads well up to a handful
// of slices, but once a breakdown has many categories (e.g. ten-plus design
// types) the slices get too thin to tell apart or label — a bar list stays
// legible at any length, since each item gets its own row instead of a sliver
// of shared circumference.
const drawHorizontalBars = (doc, items) => {
  if (!items?.length) return;
  const usableW = doc.page.width - PAGE_MARGIN * 2;
  const labelW = 150;
  const valueW = 60;
  const shareW = 42;
  const barW = usableW - labelW - valueW - shareW;
  const barX = PAGE_MARGIN + labelW;
  const rowH = 15;
  const max = Math.max(...items.map((i) => i.count ?? i.amount ?? 0), 1);

  const blockHeight = items.length * rowH;
  const remaining = doc.page.height - PAGE_MARGIN - FOOTER_RESERVE - doc.y;
  const maxOnFreshPage = doc.page.height - FRESH_PAGE_CONTENT_TOP - PAGE_MARGIN - FOOTER_RESERVE;
  if (blockHeight > remaining && blockHeight <= maxOnFreshPage) doc.addPage();

  items.forEach((it, idx) => {
    ensureSpace(doc, rowH + 2);
    const y = doc.y;
    const value = it.count ?? it.amount ?? 0;
    doc.fontSize(7.5).font('Helvetica-Bold').fillColor('#334155')
      .text(sanitizeForPdf(it.label), PAGE_MARGIN, y + 3, { width: labelW - 6, height: 10, ellipsis: true });
    doc.roundedRect(barX, y + 4, barW, 6, 3).fill('#eef1f8');
    const w = Math.max(4, (value / max) * barW);
    doc.roundedRect(barX, y + 4, w, 6, 3).fill(BAR_COLORS[idx % BAR_COLORS.length]);
    doc.fontSize(7.5).font('Helvetica-Bold').fillColor(NAVY)
      .text(fmt(value), barX + barW + 4, y + 2, { width: valueW - 4, height: 10, align: 'right', ellipsis: true });
    doc.fontSize(7).font('Helvetica').fillColor(GREY)
      .text(it.share == null ? '—' : `${it.share}%`, barX + barW + valueW, y + 2, { width: shareW, height: 10, align: 'right', ellipsis: true });
    doc.y = y + rowH;
  });
  doc.moveDown(0.4);
};

// Picks the chart type per breakdown instead of using one shape everywhere —
// a stacked bar for a short list (where every segment stays legible and
// CATEGORICAL_COLORS has a validated slot for it), a plain bar list once
// there are more categories than the validated palette covers.
const STACKED_BAR_MAX_ITEMS = CATEGORICAL_COLORS.length;
const drawBreakdownChart = (doc, items) => {
  if (!items?.length) return;
  if (items.length > STACKED_BAR_MAX_ITEMS) drawHorizontalBars(doc, items);
  else drawStackedBar(doc, items);
};
const breakdownHeightOf = (items) => (items.length > STACKED_BAR_MAX_ITEMS ? items.length * 15 : stackedBarHeightOf(items));

// A vertical column chart ranking entities on one numeric metric — used where
// "who leads/lags" matters more than "what's the split", e.g. institutions by
// designs completed, or accounts by engagement rate. Caps at 8 columns so
// labels never have to squeeze past readable width.
const drawBarChart = (doc, items, valueKey, { max: maxOverride, suffix = '', prefix = '' } = {}) => {
  const data = items.filter((d) => d[valueKey] != null).slice(0, 8);
  if (!data.length) return;
  const usableW = doc.page.width - PAGE_MARGIN * 2;
  const plotH = 90;
  const gap = 10;
  const barW = Math.min(50, (usableW - gap * (data.length - 1)) / data.length);
  const totalW = barW * data.length + gap * (data.length - 1);
  const startX = PAGE_MARGIN + (usableW - totalW) / 2;
  const max = maxOverride || Math.max(...data.map((d) => d[valueKey] || 0), 1);
  const blockHeight = plotH + 34;

  const remaining = doc.page.height - PAGE_MARGIN - FOOTER_RESERVE - doc.y;
  const maxOnFreshPage = doc.page.height - FRESH_PAGE_CONTENT_TOP - PAGE_MARGIN - FOOTER_RESERVE;
  if (blockHeight > remaining && blockHeight <= maxOnFreshPage) doc.addPage();

  const top = doc.y + 14;
  const baseline = top + plotH;
  doc.moveTo(PAGE_MARGIN, baseline).lineTo(doc.page.width - PAGE_MARGIN, baseline).lineWidth(1).strokeColor(RULE).stroke();

  data.forEach((d, i) => {
    const x = startX + i * (barW + gap);
    const value = d[valueKey] || 0;
    const h = Math.max(2, (value / max) * (plotH - 16));
    doc.rect(x, baseline - h, barW, h).fill(d.color || BAR_COLORS[i % BAR_COLORS.length]);
    doc.fontSize(7.5).font('Helvetica-Bold').fillColor(NAVY)
      .text(`${prefix}${fmt(value)}${suffix}`, x - 4, baseline - h - 12, { width: barW + 8, height: 10, align: 'center', ellipsis: true });
    doc.fontSize(6.5).font('Helvetica').fillColor(GREY)
      .text(sanitizeForPdf(d.label), x - 4, baseline + 4, { width: barW + 8, height: 18, align: 'center', ellipsis: true });
  });

  doc.y = baseline + 24;
  doc.moveDown(0.3);
};

// Whether a chart would have anything to draw — an all-zero bar chart is just
// a baseline with "0" labels floating on it, so callers skip it instead.
const anyPositive = (items, key) => items.some((d) => (d[key] || 0) > 0);

// Every platform keeps one colour across the whole report (a platform is
// never coloured by its rank in a particular chart), and that colour is the
// platform's own logo colour. Instagram takes the magenta from its logo
// gradient rather than the pink, which is too close to YouTube red to tell
// apart. Facebook and LinkedIn blue are close to each other too, so every
// platform chart names its platforms and never relies on colour alone.
const PLATFORM_COLORS = {
  LinkedIn: '#0A66C2',
  Instagram: '#C13584',
  YouTube: '#FF0000',
  Facebook: '#1877F2',
  Twitter: '#1DA1F2',
  'X (Twitter)': '#1DA1F2',
};

// Several measures per entity side by side — e.g. each institution's
// received / completed / pending / cancelled design requests — as clustered
// columns on one shared axis, with a legend for the series. Past
// GROUPS_PER_CHART entities it continues onto a second chart rather than
// squeezing bars thinner than their labels.
//   groups: [{ label, values: [n, n, ...] }]   series: [{ name, color }]
const drawGroupedBarChart = (doc, groups, series) => {
  if (!groups.length) return;
  const usableW = doc.page.width - PAGE_MARGIN * 2;
  const legendH = 14;
  const plotH = 110;
  const maxOnFreshPage = doc.page.height - FRESH_PAGE_CONTENT_TOP - PAGE_MARGIN - FOOTER_RESERVE;
  const max = Math.max(1, ...groups.flatMap((g) => g.values));

  for (let start = 0; start < groups.length; start += GROUPS_PER_CHART) {
    const chunk = groups.slice(start, start + GROUPS_PER_CHART);
    const blockH = legendH + plotH + 30;
    const remaining = doc.page.height - PAGE_MARGIN - FOOTER_RESERVE - doc.y;
    if (blockH > remaining && blockH <= maxOnFreshPage) doc.addPage();

    // Legend first — with more than one series, identity is never colour alone.
    let lx = PAGE_MARGIN;
    const ly = doc.y;
    doc.fontSize(7).font('Helvetica-Bold');
    series.forEach((s) => {
      doc.rect(lx, ly + 1, 7, 7).fill(s.color);
      doc.fillColor('#334155').text(s.name, lx + 10, ly, { lineBreak: false });
      lx += 10 + doc.widthOfString(s.name) + 14;
    });

    const top = ly + legendH;
    const baseline = top + plotH;
    doc.moveTo(PAGE_MARGIN, baseline).lineTo(doc.page.width - PAGE_MARGIN, baseline).lineWidth(1).strokeColor(RULE).stroke();

    const groupW = usableW / chunk.length;
    const barGap = 2;
    const barW = Math.min(16, (groupW - 12 - barGap * (series.length - 1)) / series.length);
    const clusterW = barW * series.length + barGap * (series.length - 1);

    chunk.forEach((g, gi) => {
      const gx = PAGE_MARGIN + gi * groupW + (groupW - clusterW) / 2;
      g.values.forEach((v, si) => {
        const x = gx + si * (barW + barGap);
        const h = v > 0 ? Math.max(2, (v / max) * (plotH - 14)) : 0;
        if (h) doc.rect(x, baseline - h, barW, h).fill(series[si].color);
        doc.fontSize(6).font('Helvetica-Bold').fillColor(NAVY)
          .text(fmt(v), x - 5, baseline - h - 9, { width: barW + 10, height: 8, align: 'center', lineBreak: false });
      });
      doc.fontSize(6.5).font('Helvetica').fillColor(GREY)
        .text(sanitizeForPdf(g.label), PAGE_MARGIN + gi * groupW + 2, baseline + 4, { width: groupW - 4, height: 18, align: 'center', ellipsis: true });
    });

    doc.y = baseline + 24;
    doc.moveDown(0.3);
  }
};

// One institution's channels, one row per platform: its colour, a bar for
// that platform's share of the institution's impressions, and the figures a
// reader actually asks about — posts, impressions, likes, audience.
const ORG_BLOCK_ROW_H = 15;
const orgPlatformBlockHeightOf = (row) => 18 + row.platforms.length * ORG_BLOCK_ROW_H + 8;
const drawOrgPlatformBlock = (doc, row) => {
  const usableW = doc.page.width - PAGE_MARGIN * 2;
  const blockH = orgPlatformBlockHeightOf(row);
  const remaining = doc.page.height - PAGE_MARGIN - FOOTER_RESERVE - doc.y;
  const maxOnFreshPage = doc.page.height - FRESH_PAGE_CONTENT_TOP - PAGE_MARGIN - FOOTER_RESERVE;
  if (blockH > remaining && blockH <= maxOnFreshPage) doc.addPage();

  const top = doc.y;
  doc.roundedRect(PAGE_MARGIN, top, usableW, blockH - 4, 4).fillAndStroke('#ffffff', RULE);
  doc.fontSize(8.5).font('Helvetica-Bold').fillColor(NAVY)
    .text(sanitizeForPdf(row.organization.name), PAGE_MARGIN + 8, top + 5, { width: usableW * 0.45, height: 11, ellipsis: true });
  doc.fontSize(7).font('Helvetica').fillColor(GREY)
    .text(`${fmt(row.posts)} post(s) · ${fmt(row.impressions)} impressions · ${fmt(row.likes)} likes · ${fmt(row.followers)} followers`,
      PAGE_MARGIN + usableW * 0.45, top + 6, { width: usableW * 0.55 - 8, height: 10, align: 'right', ellipsis: true });

  const nameW = 62;
  const statsW = 230;
  const barX = PAGE_MARGIN + 8 + nameW;
  const barW = usableW - 16 - nameW - statsW;
  const maxImpr = Math.max(1, ...row.platforms.map((p) => p.impressions));
  let y = top + 20;
  for (const p of row.platforms) {
    const color = PLATFORM_COLORS[p.platform] || ORANGE;
    doc.rect(PAGE_MARGIN + 8, y + 2, 6, 6).fill(color);
    doc.fontSize(7).font('Helvetica-Bold').fillColor('#334155')
      .text(p.platform, PAGE_MARGIN + 18, y + 1, { width: nameW - 10, height: 9, ellipsis: true });
    doc.roundedRect(barX, y + 3, barW, 5, 2.5).fill('#eef1f8');
    if (p.impressions > 0) doc.roundedRect(barX, y + 3, Math.max(4, (p.impressions / maxImpr) * barW), 5, 2.5).fill(color);
    doc.fontSize(6.8).font('Helvetica').fillColor(NAVY)
      .text(`${fmt(p.posts)} posts · ${fmt(p.impressions)} impr. · ${fmt(p.likes)} likes · ${fmt(p.followers)} fol. (+${fmt(p.followerGrowth)})`,
        barX + barW + 6, y + 1, { width: statsW - 6, height: 9, align: 'right', ellipsis: true });
    y += ORG_BLOCK_ROW_H;
  }
  doc.y = top + blockH;
};

// A round axis maximum (1, 2, 5 × 10ⁿ) so gridline values read cleanly.
const niceMax = (v) => {
  if (v <= 0) return 1;
  const mag = 10 ** Math.floor(Math.log10(v));
  return [1, 2, 2.5, 5, 10].map((m) => m * mag).find((c) => c >= v);
};

// Trend over the period: one 2px line per series across the timeline's
// buckets, markers ringed in white so crossing lines stay legible, three
// recessive gridlines with their values, and a legend. A printed report has
// no hover, so each point carries its value — nudged apart where two series
// land close together at the same date.
//   labels: ['01–07 Sep', ...]   series: [{ name, color, values: [n, ...] }]
const lineChartHeightOf = (plotH = 110) => 20 + plotH + 22;
const LINE_CHART_H = lineChartHeightOf();
const drawLineChart = (doc, labels, series, { plotH = 110, labelZeros = true } = {}) => {
  if (!labels.length) return;
  const usableW = doc.page.width - PAGE_MARGIN * 2;
  const blockH = lineChartHeightOf(plotH);
  const remaining = doc.page.height - PAGE_MARGIN - FOOTER_RESERVE - doc.y;
  const maxOnFreshPage = doc.page.height - FRESH_PAGE_CONTENT_TOP - PAGE_MARGIN - FOOTER_RESERVE;
  if (blockH > remaining && blockH <= maxOnFreshPage) doc.addPage();

  let lx = PAGE_MARGIN;
  const ly = doc.y;
  doc.fontSize(7).font('Helvetica-Bold');
  series.forEach((s) => {
    doc.rect(lx, ly + 3, 10, 2).fill(s.color);
    doc.fillColor('#334155').text(s.name, lx + 14, ly, { lineBreak: false });
    lx += 14 + doc.widthOfString(s.name) + 16;
  });

  const axisW = 30;
  const plotX = PAGE_MARGIN + axisW;
  const plotW = usableW - axisW - 10;
  const top = ly + 20;
  const baseline = top + plotH;
  const max = niceMax(Math.max(0, ...series.flatMap((s) => s.values)));
  for (const f of [0, 0.5, 1]) {
    const gy = baseline - f * plotH;
    doc.moveTo(plotX, gy).lineTo(plotX + plotW, gy).lineWidth(f === 0 ? 1 : 0.5).strokeColor(RULE).stroke();
    doc.fontSize(6.5).font('Helvetica').fillColor(GREY)
      .text(fmt(Math.round(max * f)), PAGE_MARGIN, gy - 4, { width: axisW - 6, align: 'right', lineBreak: false });
  }

  const xAt = (i) => (labels.length === 1 ? plotX + plotW / 2 : plotX + 12 + (i * (plotW - 24)) / (labels.length - 1));
  const yAt = (v) => baseline - (v / max) * plotH;
  const spacing = labels.length > 1 ? (plotW - 24) / (labels.length - 1) : plotW;
  const labelW = Math.min(60, spacing - 2);
  const labelEvery = labelW < 26 ? 2 : 1;

  for (const s of series) {
    s.values.forEach((v, i) => (i === 0 ? doc.moveTo(xAt(i), yAt(v)) : doc.lineTo(xAt(i), yAt(v))));
    doc.lineWidth(2).lineJoin('round').lineCap('round').strokeColor(s.color).stroke();
  }
  for (const s of series) {
    s.values.forEach((v, i) => {
      doc.circle(xAt(i), yAt(v), 4.5).fill('#ffffff');
      doc.circle(xAt(i), yAt(v), 3).fill(s.color);
    });
  }
  labels.forEach((label, i) => {
    const pts = series.map((s) => ({ v: s.values[i], y: yAt(s.values[i]) }))
      .filter((p) => labelZeros || p.v !== 0)
      .sort((a, b) => a.y - b.y);
    let floor = -Infinity;
    for (const p of pts) {
      const labelY = Math.max(p.y - 13, floor);
      doc.fontSize(6.5).font('Helvetica-Bold').fillColor(NAVY)
        .text(fmt(p.v), xAt(i) + 5, labelY, { width: 40, lineBreak: false });
      floor = labelY + 8;
    }
    if (i % labelEvery === 0) {
      doc.fontSize(6.5).font('Helvetica').fillColor(GREY)
        .text(label, xAt(i) - labelW / 2, baseline + 6, { width: labelW, align: 'center', lineBreak: false });
    }
  });

  doc.y = baseline + 22;
  doc.moveDown(0.3);
};

// The stand-out posts, one row each: rank, the post itself (title, then the
// account and platform it went out on), a bar for its likes in its
// platform's colour, and its likes and reach.
const TOP_POST_ROW_H = 26;
const topPostsHeightOf = (posts) => posts.length * TOP_POST_ROW_H + 6;
// Post captions in Kannada, Hindi and other scripts can't be drawn with the
// PDF's built-in fonts; rather than a row of "?", say what it is.
const readableTitle = (title) => {
  const clean = sanitizeForPdf(title);
  const unknown = clean.split('?').length - 1;
  return unknown > clean.length * 0.3 ? '(Post written in a regional-language script)' : clean;
};

const drawTopPosts = (doc, posts) => {
  if (!posts.length) return;
  const usableW = doc.page.width - PAGE_MARGIN * 2;
  const blockH = topPostsHeightOf(posts);
  const remaining = doc.page.height - PAGE_MARGIN - FOOTER_RESERVE - doc.y;
  const maxOnFreshPage = doc.page.height - FRESH_PAGE_CONTENT_TOP - PAGE_MARGIN - FOOTER_RESERVE;
  if (blockH > remaining && blockH <= maxOnFreshPage) doc.addPage();

  const rankW = 18;
  const textW = 210;
  const valueW = 88;
  const barX = PAGE_MARGIN + rankW + textW + 8;
  const barW = usableW - rankW - textW - 8 - valueW - 8;
  const maxRate = Math.max(1, ...posts.map((p) => p.likes || 0));
  let y = doc.y;
  posts.forEach((p, i) => {
    const color = PLATFORM_COLORS[p.platform] || ORANGE;
    doc.circle(PAGE_MARGIN + 7, y + 9, 7).fill(HEADER_FILL);
    doc.fontSize(7.5).font('Helvetica-Bold').fillColor(NAVY)
      .text(String(i + 1), PAGE_MARGIN, y + 5.5, { width: 14, align: 'center', lineBreak: false });
    doc.fontSize(7.8).font('Helvetica-Bold').fillColor('#242a35')
      .text(readableTitle(p.title), PAGE_MARGIN + rankW, y + 2, { width: textW, height: 10, ellipsis: true });
    doc.rect(PAGE_MARGIN + rankW, y + 15, 5, 5).fill(color);
    doc.fontSize(6.8).font('Helvetica').fillColor(GREY)
      .text(sanitizeForPdf(`${p.organization?.name || '—'} · ${p.platform}`), PAGE_MARGIN + rankW + 8, y + 14, { width: textW - 8, height: 9, ellipsis: true });
    doc.roundedRect(barX, y + 7, barW, 7, 3.5).fill('#eef1f8');
    doc.roundedRect(barX, y + 7, Math.max(4, ((p.likes || 0) / maxRate) * barW), 7, 3.5).fill(color);
    doc.fontSize(8).font('Helvetica-Bold').fillColor(NAVY)
      .text(`${fmt(p.likes)} likes`, barX + barW + 8, y + 2, { width: valueW, align: 'right', lineBreak: false });
    doc.fontSize(6.8).font('Helvetica').fillColor(GREY)
      .text(`${fmt(p.audienceCount ?? p.reach)} ${p.audienceLabel || 'reach'}`, barX + barW + 8, y + 13, { width: valueW, align: 'right', lineBreak: false });
    y += TOP_POST_ROW_H;
  });
  doc.y = y + 6;
};

// "01 Sep" / "01–07 Sep" / "29 Sep–05 Oct" for a timeline bucket.
const MONTHS_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const bucketLabel = (b) => {
  const [, fm, fd] = b.from.split('-').map(Number);
  const [, tm, td] = b.to.split('-').map(Number);
  if (b.from === b.to) return `${String(fd).padStart(2, '0')} ${MONTHS_SHORT[fm - 1]}`;
  return fm === tm
    ? `${String(fd).padStart(2, '0')}–${String(td).padStart(2, '0')} ${MONTHS_SHORT[fm - 1]}`
    : `${String(fd).padStart(2, '0')} ${MONTHS_SHORT[fm - 1]}–${String(td).padStart(2, '0')} ${MONTHS_SHORT[tm - 1]}`;
};

// The report timeline as three side-by-side panels, one measure each: its
// total in large type, then one column per stretch of the period with its
// value on top. Each panel has its own scale, so a quiet measure is not
// flattened by a busy one, and nothing is read off colour alone.
const TIMELINE_PANEL_H = 150;
const drawTimelinePanels = (doc, labels, series) => {
  const L = PAGE_MARGIN; const W = doc.page.width - PAGE_MARGIN * 2; const G = 10;
  const remaining = doc.page.height - PAGE_MARGIN - FOOTER_RESERVE - doc.y;
  const maxOnFreshPage = doc.page.height - FRESH_PAGE_CONTENT_TOP - PAGE_MARGIN - FOOTER_RESERVE;
  if (TIMELINE_PANEL_H > remaining && TIMELINE_PANEL_H <= maxOnFreshPage) doc.addPage();
  const y = doc.y;
  const pw = (W - G * (series.length - 1)) / series.length;

  series.forEach((s, si) => {
    const x = L + si * (pw + G);
    doc.lineWidth(0.8).roundedRect(x, y, pw, TIMELINE_PANEL_H, 7).fillAndStroke('#ffffff', RULE);
    doc.rect(x, y + 8, 3, 26).fill(s.color);

    const total = s.values.reduce((a, b) => a + b, 0);
    doc.fontSize(7).font('Helvetica-Bold').fillColor(GREY)
      .text(s.name.toUpperCase(), x + 12, y + 9, { width: pw - 20, lineBreak: false });
    doc.fontSize(20).font('Helvetica-Bold').fillColor(NAVY)
      .text(fmt(total), x + 12, y + 19, { lineBreak: false });
    const tw = doc.widthOfString(fmt(total));
    doc.fontSize(7).font('Helvetica').fillColor(GREY)
      .text('in this period', x + 12 + tw + 5, y + 31, { lineBreak: false });

    const plotX = x + 12; const plotW = pw - 24;
    const baseline = y + TIMELINE_PANEL_H - 22;
    const top = y + 62;
    const plotH = baseline - top;
    const max = Math.max(1, ...s.values);
    const n = s.values.length;
    const slot = plotW / n;
    const bw = Math.min(26, slot * 0.62);
    const peak = s.values.indexOf(Math.max(...s.values));
    // "01–07 Sep" splits into a range line and a month line so every column
    // keeps its own label; labels that don't split (a range across two months)
    // fall back to being thinned out.
    const split = labels.map((l) => /^(\S+) (\w{3})$/.exec(l));
    const splittable = split.every(Boolean);
    const every = splittable ? (slot < 12 ? Math.ceil(12 / slot) : 1) : (slot < 34 ? Math.ceil(34 / slot) : 1);

    doc.moveTo(plotX, baseline).lineTo(plotX + plotW, baseline).lineWidth(0.8).strokeColor(RULE).stroke();
    s.values.forEach((v, i) => {
      const cx = plotX + slot * (i + 0.5);
      const bh = v ? Math.max(3, (v / max) * plotH) : 0;
      // The busiest stretch is drawn in the full colour, the rest in a lighter tint of it.
      if (bh) {
        doc.save().fillOpacity(i === peak ? 1 : 0.45);
        doc.roundedRect(cx - bw / 2, baseline - bh, bw, bh, 2.5).fill(s.color);
        doc.restore();
      }
      if (n <= 16 || v === s.values[peak]) {
        doc.fontSize(n > 8 ? 6.3 : 7.5).font('Helvetica-Bold').fillColor(NAVY)
          .text(fmt(v), cx - slot / 2, baseline - bh - (n > 8 ? 8 : 10), { width: slot, align: 'center', lineBreak: false });
      }
      if (i % every === 0) {
        doc.fontSize(6.2).font('Helvetica').fillColor(GREY);
        if (splittable) {
          const [, range, month] = split[i];
          doc.text(range, cx - slot * every / 2, baseline + 4, { width: slot * every, align: 'center', lineBreak: false });
          // The month goes under the first column and wherever it changes.
          if (i === 0 || split[i - 1][2] !== month) {
            doc.font('Helvetica-Bold').text(month, cx - slot * every / 2, baseline + 12, { width: slot * every, align: 'center', lineBreak: false });
          }
        } else {
          doc.text(labels[i], cx - slot * every / 2, baseline + 5, { width: slot * every, align: 'center', lineBreak: false });
        }
      }
    });
  });
  doc.y = y + TIMELINE_PANEL_H + 8;
};

// Mirrors PeriodReport.jsx's own PENDING_STAGE_LABELS/pendingStageItems, so the
// PDF's "where the pending ones are stuck" breakdown reads exactly like the
// one on screen.
const PENDING_STAGE_LABELS = {
  waitingForDesigner: 'Waiting for a designer',
  beingDesigned: 'Being designed',
  withAdminReview: 'With the Admin',
  withCoordinatorReview: 'With the coordinator',
  other: 'No stage recorded (old data)',
};
const pendingStageItems = (byStage) => {
  if (!byStage) return [];
  const total = Object.values(byStage).reduce((a, b) => a + b, 0);
  return Object.entries(byStage)
    .filter(([, count]) => count > 0)
    .map(([key, count]) => ({ label: PENDING_STAGE_LABELS[key] || key, count, share: total ? Math.round((count / total) * 1000) / 10 : null }))
    .sort((a, b) => b.count - a.count);
};

// Turns a set of [label, count] pairs already sitting in a report's totals
// into a drawBreakdownChart-ready composition — on-time vs late, first-pass
// vs needing revision, likes vs comments vs shares. Genuinely new analysis
// (not just the same table re-drawn), but never invented: every count here
// already exists on `r`, this only works out each one's share of the whole.
const compositionOf = (pairs) => {
  const total = pairs.reduce((s, [, count]) => s + count, 0);
  if (!total) return [];
  return pairs
    .filter(([, count]) => count > 0)
    .map(([label, count]) => ({ label, count, share: Math.round((count / total) * 1000) / 10 }));
};

// A minimal grid renderer: one header row (shaded, allowed to wrap onto two
// lines since header text is often longer than any value under it) and the
// data rows (always a single ellipsised line — `height` is what actually
// makes pdfkit truncate instead of wrapping; without it, ellipsis does
// nothing and a name like "North Campus" or "ALL INSTITUTIONS" would wrap
// across two lines and collide with the row underneath). The first column
// gets a wider, guaranteed-minimum share of the row, since it always carries
// the institution/account/person name — the one thing that must stay readable
// — while the remaining, mostly-numeric columns split what's left evenly.
const drawTable = (doc, columns, rows, { totalRow } = {}) => {
  const usableW = doc.page.width - PAGE_MARGIN * 2;
  const equalW = usableW / columns.length;
  const col0W = columns.length > 1 ? Math.min(usableW * 0.32, Math.max(equalW, 105)) : equalW;
  const restW = columns.length > 1 ? (usableW - col0W) / (columns.length - 1) : equalW;
  const widths = columns.map((_, i) => (i === 0 ? col0W : restW));
  const fontSize = columns.length > 8 ? 7 : 8;
  const headerRowH = 24;

  // Keep the table in one piece whenever it can be — move the whole thing to
  // a fresh page rather than starting it here and splitting it a few rows in,
  // exactly like the reference report's tables never break across a page. A
  // table taller than one whole page can't avoid splitting regardless (in
  // which case drawDataRow's own per-row page-break still repeats the header).
  const tableHeight = headerRowH + rows.length * ROW_H + (totalRow ? ROW_H : 0);
  const remaining = doc.page.height - PAGE_MARGIN - FOOTER_RESERVE - doc.y;
  const maxOnFreshPage = doc.page.height - FRESH_PAGE_CONTENT_TOP - PAGE_MARGIN - FOOTER_RESERVE;
  if (tableHeight > remaining && tableHeight <= maxOnFreshPage) doc.addPage();

  const drawHeaderRow = (cells) => {
    ensureSpace(doc, headerRowH + 3);
    const yStart = doc.y;
    doc.rect(PAGE_MARGIN, yStart - 2, usableW, headerRowH + 1).fill(HEADER_FILL);
    doc.fontSize(fontSize).font('Helvetica-Bold').fillColor(NAVY);
    let x = PAGE_MARGIN;
    cells.forEach((c, i) => {
      doc.text(String(c ?? ''), x + 3, yStart, { width: widths[i] - 6 });
      x += widths[i];
    });
    doc.y = yStart + headerRowH;
  };

  const drawDataRow = (cells, { bold = false, shade = null } = {}) => {
    // If this row just forced a page break, the reader would otherwise land on
    // a table row with no header above it — repeat the header on the new page
    // first, exactly like the on-screen table's sticky header would.
    if (ensureSpace(doc, ROW_H + 3)) drawHeaderRow(columns);
    const yStart = doc.y;
    if (shade) doc.rect(PAGE_MARGIN, yStart - 2, usableW, ROW_H + 3).fill(shade);
    doc.fontSize(fontSize).font(bold ? 'Helvetica-Bold' : 'Helvetica').fillColor(bold ? NAVY : '#242a35');
    let x = PAGE_MARGIN;
    cells.forEach((c, i) => {
      doc.text(sanitizeForPdf(c ?? ''), x + 3, yStart, { width: widths[i] - 6, height: fontSize + 3, ellipsis: true });
      x += widths[i];
    });
    doc.y = yStart + ROW_H;
  };

  drawHeaderRow(columns);
  rows.forEach((r) => drawDataRow(r));
  if (totalRow) drawDataRow(totalRow, { bold: true, shade: '#f5f6fa' });
  doc.moveDown(0.6);
};

const dashOrText = (v) => (v == null ? '—' : v);

// pdfkit's built-in fonts (Helvetica etc.) are base-14 PDF fonts limited to
// the WinAnsi character set — basic ASCII, Latin-1 accented letters, and a
// handful of typographic extras (smart quotes, dashes, bullet, ellipsis,
// trademark). Free text that came from a real user — a post caption, a
// campaign name — can contain anything: Arabic/Devanagari/CJK script, emoji,
// even an embedded line break. Rendered as-is, an unsupported character comes
// out as the wrong glyph with the wrong advance width, which is exactly what
// was throwing a "Best-performing post" row's text past its column and into
// the next one. Replacing anything unsupported with "?" keeps every cell's
// width calculation (and therefore the whole table's layout) correct; folding
// all whitespace to single spaces stops an embedded newline from forcing a
// second physical line inside what is meant to be a fixed one-line cell.
const WINANSI_EXTRA_CODEPOINTS = new Set([
  0x2018, 0x2019, 0x201A, 0x201C, 0x201D, 0x201E, 0x2020, 0x2021, 0x2022,
  0x2013, 0x2014, 0x02DC, 0x2122, 0x0160, 0x2039, 0x0152, 0x017D, 0x0161,
  0x203A, 0x0153, 0x017E, 0x0178, 0x20AC, 0x0192, 0x2026,
]);
const isWinAnsiSafe = (code) => (code >= 0x20 && code <= 0x7E) || (code >= 0xA0 && code <= 0xFF) || WINANSI_EXTRA_CODEPOINTS.has(code);
// NFKC turns the "styled" Unicode letters captions use for fake bold/italic
// (𝐄𝐦𝐩𝐨𝐰𝐞𝐫 → Empower) back into plain letters; emoji and their joiners are
// dropped rather than printed as "?". Anything still unsupported (e.g. a
// Kannada caption) becomes "?", which readableTitle() picks up.
const EMOJI_RE = /[\p{Extended_Pictographic}\u{FE0F}\u{FE0E}\u{200D}\u{20E3}\u{1F3FB}-\u{1F3FF}]/gu;
const sanitizeForPdf = (s) => {
  if (s == null) return '';
  return Array.from(String(s).normalize('NFKC').replace(EMOJI_RE, '').replace(/\s+/g, ' ').trim())
    .map((ch) => (isWinAnsiSafe(ch.codePointAt(0)) ? ch : '?'))
    .join('');
};

// en-US thousands grouping, matching formatNumber() in the frontend's own
// lib/utils.js, so the PDF's figures read the same way the on-screen report
// already does. "Rs" rather than "₹" — pdfkit's built-in Helvetica is a
// base-14 PDF font limited to the WinAnsi character set, which has no rupee
// glyph; a real font would need to be embedded to use the symbol safely.
const fmt = (n) => (n == null ? '—' : Number(n).toLocaleString('en-US'));
const rupee = (n) => (n == null ? '—' : `Rs ${fmt(n)}`);

// The colour a stat card's left accent takes — the same palette as the
// on-screen dashboard tiles (PeriodReport.jsx's Tile `accent` classes).
const ACCENT = {
  orange: '#de4813', emerald: '#059669', sky: '#0284c7', rose: '#e11d48',
  indigo: '#4f46e5', amber: '#d97706', slate: '#94a3b8', navy: NAVY,
};

// Three colour-coded takeaways, generated from this report's own numbers —
// never invented copy. Thresholds only ever fire off a rate that was actually
// measured (an all-null totals section contributes nothing here).
const buildInsights = (r) => {
  const strength = [];
  const watch = [];
  const critical = [];
  const d = r.design.totals;
  const w = r.web.totals;
  const s = r.social.totals;
  const a = r.ads.totals;
  const sharePct = (part, whole) => (whole ? Math.round((part / whole) * 1000) / 10 : null);

  if (d.onTimeRate != null) {
    if (d.onTimeRate >= 80) strength.push(`${d.onTimeRate}% of designs delivered on time.`);
    else if (d.onTimeRate < 50) critical.push(`Only ${d.onTimeRate}% of designs were delivered on time.`);
    else watch.push(`${d.onTimeRate}% on-time delivery for designs — room to improve.`);
  }
  if (d.firstPassRate != null) {
    if (d.firstPassRate >= 70) strength.push(`${d.firstPassRate}% of designs cleared on the first pass.`);
    else if (d.firstPassRate < 40) critical.push(`Just ${d.firstPassRate}% of designs cleared on the first pass.`);
  }
  if (d.requestsReceived > 0 && d.pending > 0) {
    const share = sharePct(d.pending, d.requestsReceived);
    const line = `${d.pending} design request(s) (${share}%) still pending.`;
    if (share >= 30) critical.push(line); else watch.push(line);
  }
  if (d.avgRevisionRounds != null && d.avgRevisionRounds > 2) {
    watch.push(`Designs are averaging ${d.avgRevisionRounds} revision rounds.`);
  }
  if (w.tasksReceived > 0 && w.onTimeRate != null) {
    if (w.onTimeRate >= 80) strength.push(`${w.onTimeRate}% of web tasks delivered on time.`);
    else if (w.onTimeRate < 50) critical.push(`Only ${w.onTimeRate}% of web tasks were delivered on time.`);
  }
  if (s.posts > 0 && s.likes > 0) strength.push(`${fmt(s.likes)} likes across ${fmt(s.posts)} organic posts.`);
  if (s.posts > 0) {
    if (s.followerGrowth > 0) strength.push(`+${fmt(s.followerGrowth)} net new followers this period.`);
    else if (s.followerGrowth === 0) watch.push('No net follower growth despite active posting.');
  }
  if (a.spend > 0 && a.leads === 0) watch.push('Ad spend recorded with no leads yet.');
  if (a.costPerLead != null) strength.push(`Cost per lead is holding at ${rupee(a.costPerLead)}.`);

  const p = r.publishing.totals;
  if (p.posted > 0 && p.avgDaysToPost != null) {
    if (p.avgDaysToPost <= 3) strength.push(`Approved work reaches publish in ${p.avgDaysToPost} day(s) on average.`);
    else if (p.avgDaysToPost > 10) critical.push(`Approved work is taking ${p.avgDaysToPost} day(s) on average to publish.`);
  }

  // Fold in the honest "we don't have enough data" gaps already computed
  // alongside the headline, so the same facts aren't stated twice over.
  r.gaps.forEach((g) => {
    if (/no ad campaigns|no web tasks/i.test(g)) critical.push(g);
    else watch.push(g);
  });

  const dedupe = (arr) => [...new Set(arr)].slice(0, 3);
  return { strength: dedupe(strength), watch: dedupe(watch), critical: dedupe(critical) };
};

// Positives / improvements / critical points for one section, worked out from
// that section's own numbers only, with the same "measured, never guessed"
// rule as buildInsights.
const pctOf = (part, whole) => (whole ? Math.round((part / whole) * 1000) / 10 : null);
const namesOf = (rows, max = 3) => {
  const names = rows.map((x) => x.organization?.name || x.person?.name).filter(Boolean);
  return names.length > max ? `${names.slice(0, max).join(', ')} and ${names.length - max} more` : names.join(', ');
};
const bucketsOf = (strength, watch, critical) => {
  const dedupe = (arr) => [...new Set(arr)].slice(0, 4);
  return { strength: dedupe(strength), watch: dedupe(watch), critical: dedupe(critical) };
};

const designInsights = (r, perCollege = false) => {
  const strength = []; const watch = []; const critical = [];
  const d = r.design.totals;
  if (!d.requestsReceived) return bucketsOf(strength, ['No design requests were raised this period.'], critical);

  const doneShare = pctOf(d.completed, d.requestsReceived);
  if (doneShare >= 70) strength.push(`${doneShare}% of requests received were completed.`);
  else if (doneShare < 40) critical.push(`Only ${doneShare}% of requests received were completed.`);
  else watch.push(`${doneShare}% of requests received were completed — push the rest through.`);

  if (d.onTimeRate != null) {
    if (d.onTimeRate >= 80) strength.push(`${d.onTimeRate}% of designs delivered on time.`);
    else if (d.onTimeRate < 50) critical.push(`Only ${d.onTimeRate}% of designs were delivered on time.`);
    else watch.push(`${d.onTimeRate}% on-time delivery — aim for 80% or more.`);
  }
  if (d.firstPassRate != null) {
    if (d.firstPassRate >= 70) strength.push(`${d.firstPassRate}% approved on the first pass.`);
    else if (d.firstPassRate < 40) critical.push(`Just ${d.firstPassRate}% approved on the first pass — briefs may need to be clearer.`);
    else watch.push(`${d.firstPassRate}% first-pass approval — clearer briefs would cut revisions.`);
  }
  if (d.avgRevisionRounds != null && d.avgRevisionRounds > 1) {
    (d.avgRevisionRounds > 2 ? critical : watch).push(`Designs average ${d.avgRevisionRounds} revision rounds.`);
  }

  if (d.pending > 0) {
    const share = pctOf(d.pending, d.requestsReceived);
    (share >= 30 ? critical : watch).push(`${d.pending} request(s) (${share}%) are still pending.`);
    const topStage = pendingStageItems(d.pendingByStage)[0];
    if (topStage) watch.push(`Most pending work is at "${topStage.label}" (${topStage.count}).`);
    const worst = [...r.design.rows].sort((a, b) => b.pending - a.pending)[0];
    if (r.design.rows.length > 1 && worst?.pending > 0) watch.push(`${worst.organization.name} has the most design requests still pending (${worst.pending}).`);
  } else {
    strength.push('Nothing is left pending.');
  }

  if (d.cancelled > 0) {
    const share = pctOf(d.cancelled, d.requestsReceived);
    (share >= 20 ? critical : watch).push(`${d.cancelled} request(s) (${share}%) were cancelled.`);
  }
  const idle = r.design.rows.filter((x) => !x.requestsReceived && !x.completed && !x.pending);
  if (idle.length && r.design.rows.length > 1) watch.push(`No design requests from ${namesOf(idle)}.`);
  return bucketsOf(strength, watch, critical);
};

const publishingInsights = (r) => {
  const strength = []; const watch = []; const critical = [];
  const p = r.publishing.totals;
  if (p.posted > 0) strength.push(`${fmt(p.posted)} post(s) published this period.`);
  if (p.avgDaysToPost != null) {
    if (p.avgDaysToPost <= 3) strength.push(`Accepted work goes live in ${p.avgDaysToPost} day(s) on average.`);
    else if (p.avgDaysToPost > 10) critical.push(`Accepted work takes ${p.avgDaysToPost} days on average to go live.`);
    else watch.push(`Accepted work takes ${p.avgDaysToPost} days on average to go live — aim for 3 or fewer.`);
  }
  if (p.scheduled > 0) strength.push(`${p.scheduled} item(s) are already scheduled ahead.`);

  const timed = r.publishing.rows.filter((x) => x.avgDaysToPost != null).sort((a, b) => b.avgDaysToPost - a.avgDaysToPost);
  if (timed.length > 1 && p.avgDaysToPost != null && timed[0].avgDaysToPost > p.avgDaysToPost) {
    watch.push(`${timed[0].organization.name} is the slowest to publish (${timed[0].avgDaysToPost} d vs ${p.avgDaysToPost} d overall).`);
  }
  return bucketsOf(strength, watch, critical);
};

const webInsights = (r) => {
  const strength = []; const watch = []; const critical = [];
  const w = r.web.totals;
  const doneShare = pctOf(w.completed, w.tasksReceived);
  if (doneShare >= 70) strength.push(`${doneShare}% of web tasks completed.`);
  else if (doneShare < 40) critical.push(`Only ${doneShare}% of web tasks completed.`);
  else watch.push(`${doneShare}% of web tasks completed.`);
  if (w.onTimeRate != null) {
    if (w.onTimeRate >= 80) strength.push(`${w.onTimeRate}% of web tasks delivered on time.`);
    else if (w.onTimeRate < 50) critical.push(`Only ${w.onTimeRate}% of web tasks delivered on time.`);
    else watch.push(`${w.onTimeRate}% of web tasks delivered on time.`);
  }
  if (w.pending > 0) watch.push(`${w.pending} web task(s) still pending.`);
  if (w.avgTurnaroundDays != null && w.avgTurnaroundDays > 10) critical.push(`Web tasks take ${w.avgTurnaroundDays} days on average.`);
  return bucketsOf(strength, watch, critical);
};

const socialInsights = (r) => {
  const strength = []; const watch = []; const critical = [];
  const s = r.social.totals;
  if (!s.posts) return bucketsOf(strength, watch, ['No organic posts were published this period.']);

  if (s.likes > 0) strength.push(`${fmt(s.likes)} likes on ${fmt(s.posts)} posts (about ${Math.round(s.likes / s.posts)} per post).`);
  else watch.push('No likes were recorded on this period posts.');
  if (s.followerGrowth > 0) strength.push(`+${fmt(s.followerGrowth)} net new followers.`);
  else if (s.followerGrowth < 0) critical.push(`Lost ${fmt(-s.followerGrowth)} followers overall this period.`);
  else watch.push('No net follower growth despite active posting.');

  const liked = r.social.platformTotals.filter((p) => p.likes > 0).sort((a, b) => b.likes - a.likes);
  if (liked.length > 1) strength.push(`${liked[0].platform} earns the most likes (${fmt(liked[0].likes)}).`);
  if (r.social.leaderboard.length > 1 && r.social.leaderboard[0].likes > 0) {
    strength.push(`${r.social.leaderboard[0].organization.name} leads on likes (${fmt(r.social.leaderboard[0].likes)}).`);
  }

  if (s.interactions > 0) {
    const commentShare = pctOf(s.comments, s.interactions);
    if (commentShare < 5) watch.push(`Comments are only ${commentShare}% of interactions — add prompts that invite replies.`);
  }

  // Accounts with an audience but no posts this period — followers who saw nothing.
  const silent = {};
  r.social.rows.forEach((row) => row.platforms.forEach((p) => {
    if (!p.posts && p.followers > 0) (silent[p.platform] ||= []).push(row);
  }));
  Object.entries(silent).slice(0, 2).forEach(([platform, rows]) => {
    watch.push(`No ${platform} posts from ${namesOf(rows)} despite existing followers.`);
  });

  const lost = r.social.rows.filter((x) => x.followerGrowth < 0);
  if (lost.length && r.social.rows.length > 1) critical.push(`Follower loss at ${namesOf(lost)}.`);
  const quiet = r.social.rows.filter((x) => !x.posts);
  if (quiet.length && r.social.rows.length > 1) critical.push(`No organic posts at all from ${namesOf(quiet)}.`);
  return bucketsOf(strength, watch, critical);
};

const adsInsights = (r, adsEmpty) => {
  const strength = []; const watch = []; const critical = [];
  const a = r.ads.totals;
  if (adsEmpty) return bucketsOf(strength, ['No paid campaigns ran, so all reach this period was organic.'], critical);
  if (a.leads > 0) strength.push(`${fmt(a.leads)} lead(s) generated from ads.`);
  if (a.costPerLead != null) strength.push(`Cost per lead is ${rupee(a.costPerLead)}.`);
  if (a.ctr != null) {
    if (a.ctr >= 1) strength.push(`${a.ctr}% click-through rate — above the 1% benchmark.`);
    else watch.push(`${a.ctr}% click-through rate — below 1%, so test new creative.`);
  }
  if (a.frequency != null && a.frequency > 3) watch.push(`Frequency of ${a.frequency} — the same people are seeing ads often; refresh creative.`);
  if (a.spend > 0 && !a.leads) critical.push(`${rupee(a.spend)} spent with no leads yet.`);
  const noLead = r.ads.rows.filter((x) => x.spend > 0 && !x.leads);
  if (noLead.length && a.leads > 0) critical.push(`Spend with no leads at ${namesOf(noLead)}.`);
  return bucketsOf(strength, watch, critical);
};

const teamInsights = (r) => {
  const strength = []; const watch = []; const critical = [];
  const t = r.team.totals;
  const doneShare = pctOf(t.completed, t.tasksAssigned);
  if (doneShare != null) {
    if (doneShare >= 70) strength.push(`${doneShare}% of assigned tasks completed.`);
    else if (doneShare < 40) critical.push(`Only ${doneShare}% of assigned tasks completed.`);
    else watch.push(`${doneShare}% of assigned tasks completed.`);
  }
  if (t.onTimeRate != null) {
    if (t.onTimeRate >= 80) strength.push(`${t.onTimeRate}% of team tasks on time.`);
    else if (t.onTimeRate < 50) critical.push(`Only ${t.onTimeRate}% of team tasks on time.`);
    else watch.push(`${t.onTimeRate}% of team tasks on time.`);
  }
  const top = [...r.team.rows].sort((a, b) => b.completed - a.completed)[0];
  if (r.team.rows.length > 1 && top?.completed > 0) strength.push(`${top.person.name} completed the most tasks (${top.completed}).`);
  const idle = r.team.rows.filter((x) => x.tasksAssigned > 0 && !x.completed);
  if (idle.length) watch.push(`No completed tasks yet from ${namesOf(idle)}.`);
  if (t.pending > 0) watch.push(`${t.pending} team task(s) still pending.`);
  return bucketsOf(strength, watch, critical);
};

// A goal is judged against how far through its own run it is, not against
// 100% — a goal a quarter of the way through at 30% is on track.
const goalInsights = (r, asOf) => {
  const strength = []; const watch = []; const critical = [];
  r.goals.rows.forEach((g) => {
    const start = new Date(g.startDate).getTime();
    const end = new Date(g.endDate).getTime();
    const elapsed = end > start ? Math.min(100, Math.max(0, ((asOf.getTime() - start) / (end - start)) * 100)) : 100;
    const label = `${g.organization.name} ${g.platform}`;
    [['follower', g.followerProgress], ['post', g.postProgress]].forEach(([kind, progress]) => {
      if (progress == null) return;
      if (progress >= 100) strength.push(`${label} ${kind} goal met (${progress}%).`);
      else if (progress >= elapsed) strength.push(`${label} ${kind} goal on track (${progress}% with ${Math.round(elapsed)}% of time used).`);
      else if (progress >= elapsed - 25) watch.push(`${label} ${kind} goal slightly behind (${progress}% vs ${Math.round(elapsed)}% of time used).`);
      else critical.push(`${label} ${kind} goal well behind (${progress}% vs ${Math.round(elapsed)}% of time used).`);
    });
  });
  return bucketsOf(strength, watch, critical);
};

const SECTION_NOTES_HEADING = 'Positives, improvements and critical points';

// A college's page opens with its name on a navy band, and the line under it
// says where it stands; on a page it runs onto, a slimmer "(continued)" band.
const drawOrgBanner = (doc, name, sub, { continued = false } = {}) => {
  const usableW = doc.page.width - PAGE_MARGIN * 2;
  const h = continued ? 22 : 40;
  const y = doc.y;
  doc.roundedRect(PAGE_MARGIN, y, usableW, h, 5).fill(NAVY);
  doc.rect(PAGE_MARGIN, y, 4, h).fill(ORANGE);
  doc.fontSize(continued ? 10 : 16).font('Helvetica-Bold').fillColor('#ffffff')
    .text(sanitizeForPdf(continued ? `${name} (continued)` : name), PAGE_MARGIN + 14, y + (continued ? 6 : 12),
      { width: usableW * 0.6, height: continued ? 12 : 20, ellipsis: true, lineBreak: false });
  if (sub) {
    doc.fontSize(8.5).font('Helvetica-Bold').fillColor('#f7b37a')
      .text(sanitizeForPdf(sub), PAGE_MARGIN + usableW * 0.6, y + 16, { width: usableW * 0.4 - 14, align: 'right', lineBreak: false });
  }
  doc.y = y + h + 8;
};

// "Label: one line of fact", for the parts of a college's page that are a
// sentence rather than a chart.
const factLine = (doc, label, text) => {
  const width = doc.page.width - PAGE_MARGIN * 2;
  ensureSpace(doc, 24);
  doc.moveDown(0.3);
  doc.fontSize(8.5).font('Helvetica-Bold').fillColor(NAVY)
    .text(`${label}: `, PAGE_MARGIN, doc.y, { width, continued: true })
    .font('Helvetica').fillColor('#334155').text(sanitizeForPdf(text));
  doc.moveDown(0.2);
};

// Several sections' positives / improvements / critical points as one box.
const mergeBuckets = (list, exclude = new Set(), max = 5) => {
  const pick = (key) => [...new Set(list.flatMap((b) => b[key]))].filter((t) => !exclude.has(t)).slice(0, max);
  return { strength: pick('strength'), watch: pick('watch'), critical: pick('critical') };
};

// ---------------------------------------------------------------------------
// College page: a fixed grid of cards, identical on every college's page.
// Every card always draws; where a college has nothing for it this period the
// card says so in place of its figures, so the pages line up one to one.
// ---------------------------------------------------------------------------
const PANEL_FILL = '#f4f6fb';
const INK = '#334155';
const ICON_TINTS = {
  default: { fill: '#fdeee2', stroke: ORANGE },
  positive: { fill: '#ffffff', stroke: INSIGHT_STYLES.strength.color },
  improve: { fill: '#ffffff', stroke: INSIGHT_STYLES.watch.color },
  critical: { fill: '#ffffff', stroke: INSIGHT_STYLES.critical.color },
};

const panel = (doc, x, y, w, h) => { doc.roundedRect(x, y, w, h, 9).fill(PANEL_FILL); };

// Small line icons, drawn rather than loaded so the PDF needs no icon font.
const drawIcon = (doc, kind, x, y, tint = 'default') => {
  const s = 18;
  const { fill, stroke } = ICON_TINTS[tint] || ICON_TINTS.default;
  doc.roundedRect(x, y, s, s, 5).fill(fill);
  const cx = x + s / 2; const cy = y + s / 2;
  doc.save().lineWidth(1.2).lineCap('round').lineJoin('round').strokeColor(stroke).fillColor(stroke);
  switch (kind) {
    case 'people':
      doc.circle(cx - 2, cy - 2.2, 2.2).stroke();
      doc.moveTo(cx - 6, cy + 5).bezierCurveTo(cx - 6, cy + 0.5, cx + 2, cy + 0.5, cx + 2, cy + 5).stroke();
      doc.circle(cx + 3.6, cy - 1.4, 1.6).stroke();
      break;
    case 'palette':
      doc.circle(cx, cy, 5.5).stroke();
      [[-2, -2], [2, -2], [-2.6, 1.6]].forEach(([dx, dy]) => doc.circle(cx + dx, cy + dy, 0.9).fill());
      break;
    case 'pulse':
      doc.moveTo(cx - 6, cy).lineTo(cx - 3, cy).lineTo(cx - 1, cy - 4).lineTo(cx + 1.5, cy + 4).lineTo(cx + 3, cy).lineTo(cx + 6, cy).stroke();
      break;
    case 'star': {
      const pts = [];
      for (let i = 0; i < 10; i++) {
        const rr = i % 2 ? 2.6 : 6; const ang = -Math.PI / 2 + (i * Math.PI) / 5;
        pts.push([cx + rr * Math.cos(ang), cy + rr * Math.sin(ang)]);
      }
      doc.polygon(...pts).stroke();
      break;
    }
    case 'layers':
      doc.polygon([cx, cy - 5], [cx + 6, cy - 2], [cx, cy + 1], [cx - 6, cy - 2]).stroke();
      doc.moveTo(cx - 6, cy + 1.5).lineTo(cx, cy + 4.5).lineTo(cx + 6, cy + 1.5).stroke();
      break;
    case 'share':
      doc.circle(cx - 4, cy, 1.6).stroke(); doc.circle(cx + 4, cy - 4, 1.6).stroke(); doc.circle(cx + 4, cy + 4, 1.6).stroke();
      doc.moveTo(cx - 2.6, cy - 0.8).lineTo(cx + 2.6, cy - 3.2).stroke();
      doc.moveTo(cx - 2.6, cy + 0.8).lineTo(cx + 2.6, cy + 3.2).stroke();
      break;
    case 'positive':
      doc.moveTo(cx - 4.5, cy).lineTo(cx - 1.5, cy + 3.5).lineTo(cx + 5, cy - 4).stroke();
      break;
    case 'improve':
      doc.circle(cx, cy - 1.5, 3.8).stroke();
      doc.moveTo(cx - 1.8, cy + 4.2).lineTo(cx + 1.8, cy + 4.2).stroke();
      break;
    case 'critical':
      doc.polygon([cx, cy - 5.5], [cx + 6, cy + 4.5], [cx - 6, cy + 4.5]).stroke();
      doc.moveTo(cx, cy - 1.8).lineTo(cx, cy + 1.2).stroke();
      doc.circle(cx, cy + 3, 0.5).fill();
      break;
    default: break;
  }
  doc.restore();
};

const panelHeader = (doc, x, y, kind, title, tint, titleColor = NAVY) => {
  drawIcon(doc, kind, x + 12, y + 11, tint);
  doc.fontSize(10).font('Helvetica-Bold').fillColor(titleColor)
    .text(title, x + 38, y + 15, { width: 400, lineBreak: false });
};

const emptyNote = (doc, x, y, w, h, text) => {
  doc.fontSize(8).font('Helvetica-Oblique').fillColor(GREY)
    .text(text, x, y + h / 2 - 5, { width: w, align: 'center', lineBreak: false });
};

// A row of figures split by hairlines: { value, unit?, label, accent? }.
const metricRow = (doc, x, y, w, items, size = 15) => {
  const colW = w / items.length;
  items.forEach((it, i) => {
    const cx = x + i * colW + (i ? 8 : 0);
    if (i) doc.moveTo(x + i * colW, y + 1).lineTo(x + i * colW, y + 30).lineWidth(0.6).strokeColor(RULE).stroke();
    const value = String(it.value);
    doc.fontSize(size).font('Helvetica-Bold').fillColor(it.accent ? ORANGE : NAVY)
      .text(value, cx, y, { lineBreak: false });
    if (it.unit) {
      const vw = doc.widthOfString(value);
      doc.fontSize(size * 0.62).font('Helvetica-Bold').fillColor(GREY)
        .text(it.unit, cx + vw + 1.5, y + size * 0.32, { lineBreak: false });
    }
    doc.fontSize(7).font('Helvetica').fillColor(GREY)
      .text(it.label, cx, y + size + 3, { width: colW - 10, height: 18, lineBreak: true });
  });
};

const platformBadge = (doc, platform, x, y) => {
  const short = { LinkedIn: 'in', Instagram: 'IG', YouTube: 'YT', Facebook: 'f', Twitter: 'X', 'X (Twitter)': 'X' }[platform] || platform[0];
  doc.roundedRect(x, y, 10, 10, 2.5).fill(PLATFORM_COLORS[platform] || ORANGE);
  doc.fontSize(5.2).font('Helvetica-Bold').fillColor('#ffffff')
    .text(short, x, y + 3, { width: 10, align: 'center', lineBreak: false });
};

// Bars for design requests raised and designs delivered, a line (with a soft
// wash under it) for posts published, per bucket of the period.
const drawComboChart = (doc, x, y, w, h, labels, series) => {
  const [req, del, posts] = series;
  // legend
  let lx = x;
  doc.fontSize(7).font('Helvetica');
  doc.moveTo(lx, y + 4).lineTo(lx + 10, y + 4).lineWidth(1.8).strokeColor(posts.color).stroke();
  doc.circle(lx + 5, y + 4, 2).fill(posts.color);
  doc.fillColor(INK).text(posts.name, lx + 14, y, { lineBreak: false });
  lx += 14 + doc.widthOfString(posts.name) + 12;
  for (const s of [req, del]) {
    doc.roundedRect(lx, y + 1, 7, 7, 1.5).fill(s.color);
    doc.fillColor(INK).text(s.name, lx + 10, y, { lineBreak: false });
    lx += 10 + doc.widthOfString(s.name) + 12;
  }

  const axisW = 18;
  const plotX = x + axisW;
  const plotW = w - axisW;
  const top = y + 22;
  const baseline = y + h - 14;
  const plotH = baseline - top;
  const max = niceMax(Math.max(1, ...series.flatMap((s) => s.values)) * 1.25);
  for (const f of [0, 0.5, 1]) {
    const gy = baseline - f * plotH;
    doc.moveTo(plotX, gy).lineTo(plotX + plotW, gy).lineWidth(f === 0 ? 0.8 : 0.4).strokeColor(RULE).stroke();
    doc.fontSize(6).font('Helvetica').fillColor(GREY)
      .text(fmt(Math.round(max * f)), x, gy - 3, { width: axisW - 4, align: 'right', lineBreak: false });
  }
  const n = labels.length;
  const slot = plotW / n;
  const xAt = (i) => plotX + slot * (i + 0.5);
  const yAt = (v) => baseline - (v / max) * plotH;
  const bw = Math.min(9, slot * 0.2);

  // bars
  const barLabelTop = labels.map(() => Infinity);
  labels.forEach((_, i) => {
    [[req, -bw - 1], [del, 1]].forEach(([s, dx]) => {
      const v = s.values[i] || 0;
      const bh = Math.max(v ? 2 : 0, (v / max) * plotH);
      if (bh) doc.roundedRect(xAt(i) + dx, baseline - bh, bw, bh, 1.5).fill(s.color);
      if (v) {
        const ly = baseline - bh - 8;
        barLabelTop[i] = Math.min(barLabelTop[i], ly);
        doc.fontSize(6).font('Helvetica-Bold').fillColor(NAVY)
          .text(fmt(v), xAt(i) + dx - 6, ly, { width: bw + 12, align: 'center', lineBreak: false });
      }
    });
  });

  // line with its wash
  const pts = posts.values.map((v, i) => [xAt(i), yAt(v || 0)]);
  if (pts.length > 1) {
    doc.save().fillOpacity(0.12);
    doc.polygon([pts[0][0], baseline], ...pts, [pts[pts.length - 1][0], baseline]).fill(posts.color);
    doc.restore();
    pts.forEach(([px, py], i) => (i ? doc.lineTo(px, py) : doc.moveTo(px, py)));
    doc.lineWidth(1.8).strokeColor(posts.color).stroke();
  }
  pts.forEach(([px, py], i) => {
    doc.circle(px, py, 2.4).fill(posts.color);
    const v = posts.values[i] || 0;
    if (!v) return;
    const t = fmt(v);
    doc.fontSize(6.5).font('Helvetica-Bold');
    const tw = doc.widthOfString(t) + 8;
    // Sit above the point, and above this bucket's bar labels if they'd meet.
    let pillY = py - 15;
    if (pillY + 10 > barLabelTop[i] - 1 && pillY < barLabelTop[i] + 8) pillY = barLabelTop[i] - 12;
    pillY = Math.max(top - 6, pillY);
    doc.roundedRect(px - tw / 2, pillY, tw, 10, 5).fill(posts.color);
    doc.fillColor('#ffffff').text(t, px - tw / 2, pillY + 2.5, { width: tw, align: 'center', lineBreak: false });
  });

  labels.forEach((label, i) => {
    doc.fontSize(6.3).font('Helvetica').fillColor(GREY)
      .text(label, xAt(i) - slot / 2, baseline + 4, { width: slot, align: 'center', lineBreak: false });
  });
};

const drawBestPostRows = (doc, x, y, w, h, posts) => {
  const rowH = Math.min(46, h / Math.max(posts.length, 1));
  const valueW = 56;
  posts.forEach((p, i) => {
    const ry = y + i * rowH;
    if (i) doc.moveTo(x, ry - 3).lineTo(x + w, ry - 3).lineWidth(0.5).strokeColor(RULE).stroke();
    doc.roundedRect(x, ry, 13, 13, 3).fill('#e6e9f2');
    doc.fontSize(7).font('Helvetica-Bold').fillColor(NAVY).text(String(i + 1), x, ry + 3.5, { width: 13, align: 'center', lineBreak: false });
    const tw = w - 18 - valueW - 4;
    doc.fontSize(7.6).font('Helvetica-Bold').fillColor(NAVY)
      .text(readableTitle(p.title), x + 18, ry, { width: tw, height: 19, ellipsis: true });
    doc.rect(x + 18, ry + 22.5, 5, 5).fill(PLATFORM_COLORS[p.platform] || ORANGE);
    doc.fontSize(6.6).font('Helvetica').fillColor(GREY)
      .text(sanitizeForPdf(`${p.organization?.name || ''}, ${p.platform}`), x + 26, ry + 21.5, { width: tw - 8, height: 9, ellipsis: true, lineBreak: false });
    doc.fontSize(11).font('Helvetica-Bold').fillColor(ORANGE)
      .text(fmt(p.likes), x + w - valueW, ry, { width: valueW, align: 'right', lineBreak: false });
    doc.fontSize(6.3).font('Helvetica').fillColor(GREY)
      .text('likes', x + w - valueW, ry + 12, { width: valueW, align: 'right', lineBreak: false });
    doc.fontSize(6.6).font('Helvetica-Bold').fillColor(NAVY)
      .text(`${fmt(p.audienceCount ?? p.reach)} ${p.audienceLabel || 'reach'}`, x + w - valueW - 10, ry + 21.5, { width: valueW + 10, align: 'right', lineBreak: false });
  });
};

// One takeaway line with its figures in bold.
const NUMBER_RE = /(\(?[+-]?\d[\d,]*(?:\.\d+)?%?\)?)/;
const drawRichBullet = (doc, text, x, y, w, dotColor) => {
  const clean = sanitizeForPdf(text);
  doc.circle(x + 1.8, y + 4, 1.6).fill(dotColor);
  const parts = clean.split(NUMBER_RE).filter((part) => part !== '');
  parts.forEach((part, i) => {
    const isNum = /^\(?[+-]?\d/.test(part);
    doc.fontSize(7.6).font(isNum ? 'Helvetica-Bold' : 'Helvetica').fillColor(isNum ? NAVY : INK);
    const opts = { width: w - 8, continued: i < parts.length - 1, lineGap: 1 };
    if (i === 0) doc.text(part, x + 8, y, opts); else doc.text(part, opts);
  });
  return doc.y;
};

const TAKEAWAY_STYLE_KEY = { positive: 'strength', improve: 'watch', critical: 'critical' };
const drawTakeawayCard = (doc, x, y, w, h, kind, title, items, emptyText) => {
  const style = INSIGHT_STYLES[TAKEAWAY_STYLE_KEY[kind]];
  // Same box as the overall page's takeaways: 2pt coloured border, 5pt corners.
  doc.lineWidth(2).roundedRect(x, y, w, h, 5).fillAndStroke(style.bg, style.color);
  panelHeader(doc, x, y, kind, title, kind, style.color);
  const dot = INK;
  const bodyX = x + 12; const bodyW = w - 24; const bottom = y + h - 8;
  let cy = y + 38;
  const list = items.length ? items : [emptyText];
  doc.fontSize(7.6).font('Helvetica');
  for (const t of list) {
    const need = doc.heightOfString(sanitizeForPdf(t), { width: bodyW - 14, lineGap: 1 }) + 4;
    if (cy + need > bottom) break;
    cy = drawRichBullet(doc, t, bodyX, cy, bodyW, dot) + 5;
  }
};

const ORG_PAGE = { banner: 48, row1: 66, row2: 156, row3: 214, row4: 118, gap: 10 };

const drawOrgPage = (doc, ctx) => {
  const { org, rank, total, d, p, s, best, labels, series } = ctx;
  const L = PAGE_MARGIN; const W = doc.page.width - PAGE_MARGIN * 2; const G = ORG_PAGE.gap;
  let y = doc.y;

  // Banner
  doc.roundedRect(L, y, W, ORG_PAGE.banner, 10).fill(NAVY);
  doc.rect(L, y + 8, 4, ORG_PAGE.banner - 16).fill(ORANGE);
  doc.fontSize(18).font('Helvetica-Bold').fillColor('#ffffff')
    .text(sanitizeForPdf(org.name), L + 18, y + 15, { width: W * 0.55, height: 22, ellipsis: true, lineBreak: false });
  const stat = (value, label, rx) => {
    doc.fontSize(13).font('Helvetica-Bold').fillColor('#ffffff').text(value, rx - 90, y + 10, { width: 90, align: 'right', lineBreak: false });
    doc.fontSize(7).font('Helvetica').fillColor('#f7b37a').text(label, rx - 90, y + 28, { width: 90, align: 'right', lineBreak: false });
  };
  stat(fmt(s?.followers || 0), 'followers', L + W - 16);
  if (rank) stat(`#${rank} of ${total}`, 'by followers', L + W - 120);
  y += ORG_PAGE.banner + G;

  // Row 1: social media + design headline figures
  const lw = Math.round(W * 0.62); const rw = W - lw - G;
  const socialEmpty = !s || (!s.posts && !s.followers && !s.reach);
  const designEmpty = !d || !(d.requestsReceived || d.completed || d.pending || d.cancelled);
  panel(doc, L, y, lw, ORG_PAGE.row1);
  panelHeader(doc, L, y, 'people', 'Social media');
  if (socialEmpty) emptyNote(doc, L, y + 18, lw, ORG_PAGE.row1 - 18, 'No social media activity recorded this period.');
  else {
    metricRow(doc, L + 12, y + 33, lw - 24, [
      { value: fmt(s.followers), label: 'Followers' },
      { value: `${s.followerGrowth >= 0 ? '+' : ''}${fmt(s.followerGrowth)}`, label: 'Follower growth', accent: true },
      { value: fmt(s.posts), label: 'Posts published' },
      { value: fmt(s.reach), label: 'Reach' },
      { value: fmt(s.likes), label: 'Likes' },
    ], 13.5);
  }
  const rx = L + lw + G;
  panel(doc, rx, y, rw, ORG_PAGE.row1);
  panelHeader(doc, rx, y, 'palette', 'Design');
  if (designEmpty) emptyNote(doc, rx, y + 18, rw, ORG_PAGE.row1 - 18, 'No design requests this period.');
  else {
    metricRow(doc, rx + 12, y + 33, rw - 24, [
      { value: fmt(d.completed), unit: `/ ${fmt(d.requestsReceived)}`, label: 'Designs delivered' },
      { value: d.onTimeRate == null ? '—' : String(d.onTimeRate), unit: d.onTimeRate == null ? '' : '%', label: 'Delivered on time' },
      { value: fmt(d.pending), label: 'Design pending', accent: true },
    ], 13.5);
  }
  y += ORG_PAGE.row1 + G;

  // Row 2: activity chart + best posts
  panel(doc, L, y, lw, ORG_PAGE.row2);
  panelHeader(doc, L, y, 'pulse', 'Activity over the period');
  const activityEmpty = !series || !series.some((b) => b.requests || b.delivered || b.posts);
  if (activityEmpty) emptyNote(doc, L, y + 30, lw, ORG_PAGE.row2 - 30, 'No requests, deliveries or posts recorded in this period.');
  else {
    drawComboChart(doc, L + 12, y + 38, lw - 24, ORG_PAGE.row2 - 46, labels, [
      { name: 'Design requests raised', color: CATEGORICAL_COLORS[0], values: series.map((b) => b.requests) },
      { name: 'Designs delivered', color: CATEGORICAL_COLORS[1], values: series.map((b) => b.delivered) },
      { name: 'Social posts published', color: CATEGORICAL_COLORS[2], values: series.map((b) => b.posts) },
    ]);
  }
  panel(doc, rx, y, rw, ORG_PAGE.row2);
  panelHeader(doc, rx, y, 'star', 'Best posts this period');
  if (!best.length) emptyNote(doc, rx, y + 30, rw, ORG_PAGE.row2 - 30, 'No posts with likes data this period.');
  else drawBestPostRows(doc, rx + 12, y + 40, rw - 24, ORG_PAGE.row2 - 46, best.slice(0, 3));
  y += ORG_PAGE.row2 + G;

  // Row 3: design work + platform by platform
  const lw3 = Math.round((W - G) * 0.48); const rw3 = W - lw3 - G; const rx3 = L + lw3 + G;
  panel(doc, L, y, lw3, ORG_PAGE.row3);
  panelHeader(doc, L, y, 'layers', 'Design work');
  if (designEmpty) emptyNote(doc, L, y + 30, lw3, ORG_PAGE.row3 - 30, 'No design requests this period.');
  else {
    const ix = L + 12; const iw = lw3 - 24;
    metricRow(doc, ix, y + 36, iw, [
      { value: fmt(d.requestsReceived + d.cancelled), label: 'request(s) raised' },
      { value: fmt(d.designsCompleted), label: 'designs completed' },
      { value: d.firstPassRate == null ? '—' : String(d.firstPassRate), unit: d.firstPassRate == null ? '' : '%', label: 'first-pass approval' },
    ], 13);
    const whole = Math.max(d.requestsReceived + d.cancelled, 1);
    const status = [
      ['Completed', d.designsCompleted],
      ...pendingStageItems(d.pendingByStage).map((st) => [`Pending: ${st.label.toLowerCase()}`, st.count]),
      ['Cancelled', d.cancelled],
    ].filter(([, c]) => c > 0).slice(0, 6);
    let by = y + 76;
    const labelW = 112; const countW = 18; const shareW = 30; const barW = iw - labelW - countW - shareW - 6;
    status.forEach(([label, count], idx) => {
      doc.fontSize(7.3).font('Helvetica').fillColor(INK).text(label, ix, by, { width: labelW - 4, height: 9, ellipsis: true, lineBreak: false });
      doc.roundedRect(ix + labelW, by + 2.5, barW, 4.5, 2.2).fill('#e3e7f1');
      doc.roundedRect(ix + labelW, by + 2.5, Math.max(3, (count / whole) * barW), 4.5, 2.2).fill(BAR_COLORS[idx % BAR_COLORS.length]);
      doc.fontSize(7.3).font('Helvetica-Bold').fillColor(NAVY).text(fmt(count), ix + labelW + barW + 2, by, { width: countW, align: 'right', lineBreak: false });
      doc.fontSize(6.8).font('Helvetica').fillColor(GREY).text(`${Math.round((count / whole) * 1000) / 10}%`, ix + labelW + barW + countW + 4, by + 0.5, { width: shareW, align: 'right', lineBreak: false });
      by += 13.5;
    });
    const mixTop = y + 76 + 6 * 13.5 + 2;
    doc.moveTo(ix, mixTop).lineTo(ix + iw, mixTop).lineWidth(0.5).strokeColor(RULE).stroke();
    doc.fontSize(8).font('Helvetica-Bold').fillColor(NAVY).text('What was designed', ix, mixTop + 6, { lineBreak: false });
    const mix = (d.mix || []).slice(0, 6);
    if (!mix.length) {
      doc.fontSize(7.3).font('Helvetica-Oblique').fillColor(GREY).text('Nothing delivered yet this period.', ix, mixTop + 20, { lineBreak: false });
    }
    const colW = (iw - 8) / 2;
    mix.forEach((m, idx) => {
      const cx = ix + (idx % 2) * (colW + 8);
      const cy = mixTop + 20 + Math.floor(idx / 2) * 13;
      doc.fontSize(7.2).font('Helvetica').fillColor(INK).text(sanitizeForPdf(m.label), cx, cy, { width: colW - 22, height: 9, ellipsis: true, lineBreak: false });
      doc.roundedRect(cx + colW - 16, cy - 1, 16, 10, 5).fill('#e6e9f2');
      doc.fontSize(6.8).font('Helvetica-Bold').fillColor(NAVY).text(fmt(m.count), cx + colW - 16, cy + 1, { width: 16, align: 'center', lineBreak: false });
    });
  }

  panel(doc, rx3, y, rw3, ORG_PAGE.row3);
  panelHeader(doc, rx3, y, 'share', 'Social media, platform by platform');
  {
    const ix = rx3 + 12; const iw = rw3 - 24;
    const platforms = s?.platforms || [];
    if (!platforms.length) emptyNote(doc, rx3, y + 30, rw3, 120, 'No social accounts with followers or posts yet.');
    else {
      metricRow(doc, ix, y + 36, iw * 0.66, [
        { value: fmt(s.impressions), label: 'impressions' },
        { value: fmt(s.interactions), label: 'interactions' },
      ], 13);
      const cols = [['Platform', 68, 'left'], ['Posts', 24, 'right'], ['Impr.', 40, 'right'], ['Likes', 34, 'right'], ['Followers', 42, 'right'], ['Growth', iw - 208, 'right']];
      let ty = y + 74;
      let cx = ix;
      cols.forEach(([h, cw, al]) => {
        doc.fontSize(6.8).font('Helvetica-Bold').fillColor(GREY).text(h, cx, ty, { width: cw, align: al, lineBreak: false });
        cx += cw;
      });
      ty += 11;
      platforms.slice(0, 5).forEach((pl) => {
        doc.moveTo(ix, ty - 1).lineTo(ix + iw, ty - 1).lineWidth(0.5).strokeColor(RULE).stroke();
        platformBadge(doc, pl.platform, ix, ty + 2);
        const cells = [
          [pl.platform, 'left'], [fmt(pl.posts), 'right'], [fmt(pl.impressions), 'right'],
          [fmt(pl.likes), 'right'], [fmt(pl.followers), 'right'],
          [`+${fmt(pl.followerGrowth)}`, 'right'],
        ];
        let ccx = ix;
        cells.forEach(([v, al], ci) => {
          const [, cw] = cols[ci];
          const isGrowth = ci === 5 && pl.followerGrowth > 0;
          doc.fontSize(7.4).font(ci === 0 ? 'Helvetica-Bold' : 'Helvetica').fillColor(isGrowth ? ORANGE : NAVY)
            .text(v, ci === 0 ? ccx + 14 : ccx, ty + 3, { width: ci === 0 ? cw - 14 : cw, align: al, lineBreak: false });
          ccx += cw;
        });
        ty += 16;
      });
    }
    // Publishing, always in the same place at the foot of the card
    const pubY = y + ORG_PAGE.row3 - 44;
    doc.moveTo(ix, pubY - 6).lineTo(ix + iw, pubY - 6).lineWidth(0.5).strokeColor(RULE).stroke();
    doc.fontSize(8).font('Helvetica-Bold').fillColor(NAVY).text('Publishing', ix, pubY + 4, { lineBreak: false });
    if (!p || !(p.posted || p.scheduled)) {
      doc.fontSize(7.4).font('Helvetica-Oblique').fillColor(GREY).text('No posting activity this period.', ix + 70, pubY + 5, { lineBreak: false });
    } else {
      metricRow(doc, ix + 66, pubY, iw - 66, [
        { value: fmt(p.posted), label: 'published' },
        { value: fmt(p.scheduled), label: 'scheduled' },
      ], 12);
    }
  }
  y += ORG_PAGE.row3 + G;

  // Row 4: takeaways
  const cw4 = (W - 2 * G) / 3;
  const { strength, watch, critical } = ctx.insights;
  drawTakeawayCard(doc, L, y, cw4, ORG_PAGE.row4, 'positive', 'Positives', strength, 'No standout positives this period.');
  drawTakeawayCard(doc, L + cw4 + G, y, cw4, ORG_PAGE.row4, 'improve', 'Improvements', watch, 'Nothing to improve on here this period.');
  drawTakeawayCard(doc, L + 2 * (cw4 + G), y, cw4, ORG_PAGE.row4, 'critical', 'Critical', critical, 'Nothing critical this period.');
  doc.y = y + ORG_PAGE.row4;
};

// ---------------------------------------------------------------------------
// Overall-page chart forms other than bars: a heatmap, a dot plot, a waffle
// grid and a funnel. None of them is a pie.
// ---------------------------------------------------------------------------

// Rows x columns of counts as tinted cells — the darker the cell, the larger
// the number — so "who posts where" reads as a pattern, with row totals. One
// colour scale for the whole grid (platforms are identified by their header
// badge), so a shade means the same count in every column.
//   rows: ['NCET', ...]  cols: [{ name, color }]  matrix[r][c]
const heatmapHeightOf = (rowCount) => 24 + rowCount * 20 + 6;
const drawHeatmap = (doc, rows, cols, matrix) => {
  if (!rows.length) return;
  const L = PAGE_MARGIN; const W = doc.page.width - PAGE_MARGIN * 2;
  const labelW = 118; const totalW = 46;
  const cellW = (W - labelW - totalW) / cols.length;
  const rowH = 20; const headH = 24;
  const max = Math.max(1, ...matrix.flat());
  const y0 = doc.y;

  cols.forEach((c, ci) => {
    const cx = L + labelW + ci * cellW;
    doc.fontSize(7.2).font('Helvetica-Bold');
    const tw = doc.widthOfString(c.name);
    const startX = cx + (cellW - (tw + 14)) / 2;
    platformBadge(doc, c.name, startX, y0 + 6);
    doc.fillColor(NAVY).text(c.name, startX + 14, y0 + 8, { lineBreak: false });
  });
  doc.fontSize(7.2).font('Helvetica-Bold').fillColor(GREY)
    .text('Total', L + W - totalW, y0 + 7, { width: totalW - 4, align: 'right', lineBreak: false });

  rows.forEach((name, ri) => {
    const y = y0 + headH + ri * rowH;
    doc.fontSize(8).font('Helvetica-Bold').fillColor(NAVY)
      .text(sanitizeForPdf(name), L, y + 6, { width: labelW - 8, height: 10, ellipsis: true, lineBreak: false });
    matrix[ri].forEach((v, ci) => {
      const x = L + labelW + ci * cellW;
      const t = v / max;
      doc.save();
      if (v > 0) doc.fillOpacity(0.16 + 0.84 * t).roundedRect(x + 1.5, y + 1.5, cellW - 3, rowH - 3, 3).fill(ORANGE);
      else doc.roundedRect(x + 1.5, y + 1.5, cellW - 3, rowH - 3, 3).fill('#eef1f8');
      doc.restore();
      doc.fontSize(8.5).font('Helvetica-Bold').fillColor(v === 0 ? '#aab2c5' : (t > 0.62 ? '#ffffff' : NAVY))
        .text(v === 0 ? '–' : fmt(v), x, y + 5.5, { width: cellW, align: 'center', lineBreak: false });
    });
    doc.fontSize(8.5).font('Helvetica-Bold').fillColor(NAVY)
      .text(fmt(matrix[ri].reduce((a, b) => a + b, 0)), L + W - totalW, y + 5.5, { width: totalW - 4, align: 'right', lineBreak: false });
  });
  doc.y = y0 + headH + rows.length * rowH + 6;
};

// One dot per item on a shared track, with a dashed line for the overall
// figure — reads as "who is above, who is below" far faster than columns.
const dotPlotHeightOf = (count, hasReference) => count * 17 + 12 + (hasReference ? 14 : 0);
const drawDotPlot = (doc, items, { suffix = '', reference = null, referenceLabel = 'Overall' } = {}) => {
  if (!items.length) return;
  const L = PAGE_MARGIN; const W = doc.page.width - PAGE_MARGIN * 2;
  const labelW = 134; const valueW = 54;
  const trackX = L + labelW; const trackW = W - labelW - valueW;
  const rowH = 17;
  const max = niceMax(Math.max(...items.map((i) => i.value), reference || 0) * 1.08);
  const top = doc.y + (reference != null ? 14 : 4);
  const best = Math.max(...items.map((i) => i.value));

  items.forEach((it, i) => {
    const cy = top + i * rowH + rowH / 2;
    doc.fontSize(8).font('Helvetica-Bold').fillColor(NAVY)
      .text(sanitizeForPdf(it.label), L, cy - 4.5, { width: labelW - 8, height: 10, ellipsis: true, lineBreak: false });
    doc.moveTo(trackX, cy).lineTo(trackX + trackW, cy).lineWidth(1.4).strokeColor('#e3e7f1').stroke();
    const px = trackX + (it.value / max) * trackW;
    const color = it.value === best ? ORANGE : '#267ad9';
    doc.moveTo(trackX, cy).lineTo(px, cy).lineWidth(1.4).strokeColor(color).stroke();
    doc.circle(px, cy, 5.2).fill('#ffffff');
    doc.circle(px, cy, 4).fill(color);
    doc.fontSize(8.5).font('Helvetica-Bold').fillColor(NAVY)
      .text(`${it.value}${suffix}`, L + W - valueW, cy - 4.5, { width: valueW, align: 'right', lineBreak: false });
  });

  if (reference != null) {
    const rx = trackX + (reference / max) * trackW;
    doc.save().dash(3, { space: 2.5 });
    doc.moveTo(rx, top - 3).lineTo(rx, top + items.length * rowH).lineWidth(0.9).strokeColor(GREY).stroke();
    doc.undash().restore();
    doc.fontSize(6.8).font('Helvetica-Bold').fillColor(GREY)
      .text(`${referenceLabel} ${reference}${suffix}`, rx - 60, top - 14, { width: 120, align: 'center', lineBreak: false });
  }
  doc.y = top + items.length * rowH + 8;
};

// One card per part of a whole: its badge and name, the figure in large type,
// its share of the total, and a thin meter showing that share.
const SHARE_CARDS_H = 84;
const drawShareCards = (doc, items, unit = '') => {
  const total = items.reduce((sum, i) => sum + i.count, 0);
  if (!total) return;
  const L = PAGE_MARGIN; const W = doc.page.width - PAGE_MARGIN * 2; const G = 10;
  const n = Math.min(items.length, 4);
  const cw = Math.min(210, (W - G * (n - 1)) / n);
  const y0 = doc.y + 2;
  items.slice(0, n).forEach((it, i) => {
    const x = L + i * (cw + G);
    const share = Math.round((it.count / total) * 1000) / 10;
    doc.lineWidth(0.8).roundedRect(x, y0, cw, SHARE_CARDS_H - 6, 8).fillAndStroke('#ffffff', RULE);
    doc.rect(x, y0 + 10, 3, 24).fill(it.color);
    platformBadge(doc, it.label, x + 14, y0 + 11);
    doc.fontSize(9).font('Helvetica-Bold').fillColor(NAVY).text(it.label, x + 30, y0 + 12, { lineBreak: false });
    doc.fontSize(19).font('Helvetica-Bold').fillColor(NAVY).text(fmt(it.count), x + 14, y0 + 28, { lineBreak: false });
    const nw = doc.widthOfString(fmt(it.count));
    doc.fontSize(7.5).font('Helvetica').fillColor(GREY).text(unit, x + 14 + nw + 4, y0 + 40, { lineBreak: false });
    doc.fontSize(9).font('Helvetica-Bold').fillColor(it.color).text(`${share}%`, x + cw - 56, y0 + 12, { width: 44, align: 'right', lineBreak: false });
    doc.roundedRect(x + 14, y0 + 56, cw - 28, 5, 2.5).fill('#e3e7f1');
    doc.roundedRect(x + 14, y0 + 56, Math.max(5, (cw - 28) * share / 100), 5, 2.5).fill(it.color);
  });
  doc.y = y0 + SHARE_CARDS_H;
};

// Stages as centred bars that narrow with the count, with a soft tint
// joining each stage to the next. Shares are of the first stage.
const funnelHeightOf = (n) => n * 32 + 6;
const drawFunnel = (doc, steps) => {
  if (!steps.length) return;
  const L = PAGE_MARGIN; const W = doc.page.width - PAGE_MARGIN * 2;
  const labelW = 150;
  const areaX = L + labelW + 10; const areaW = W - labelW - 10;
  const cx = areaX + areaW / 2;
  const base = Math.max(1, steps[0].count, ...steps.map((s) => s.count));
  const barH = 24; const stride = 32;
  const y0 = doc.y + 2;
  const widthOf = (c) => Math.max(c ? 12 : 5, (c / base) * areaW);

  steps.forEach((s, i) => {
    const y = y0 + i * stride;
    const w = widthOf(s.count);
    if (i > 0) {
      const pw = widthOf(steps[i - 1].count);
      doc.save().fillOpacity(0.16);
      doc.polygon([cx - pw / 2, y - (stride - barH)], [cx + pw / 2, y - (stride - barH)], [cx + w / 2, y], [cx - w / 2, y]).fill(s.color);
      doc.restore();
    }
    doc.fontSize(8.5).font('Helvetica-Bold').fillColor(NAVY)
      .text(s.label, L, y + 8, { width: labelW, lineBreak: false });
    doc.roundedRect(cx - w / 2, y, w, barH, 4).fill(s.color);
    const share = `${Math.round((s.count / Math.max(1, steps[0].count)) * 1000) / 10}%`;
    if (s.count && w > 70) {
      doc.fontSize(9.5).font('Helvetica-Bold').fillColor('#ffffff')
        .text(`${fmt(s.count)}  ·  ${share}`, cx - w / 2, y + 7.5, { width: w, align: 'center', lineBreak: false });
    } else {
      doc.fontSize(9.5).font('Helvetica-Bold').fillColor(NAVY)
        .text(`${fmt(s.count)}  ·  ${share}`, cx + w / 2 + 6, y + 7.5, { lineBreak: false });
    }
  });
  doc.y = y0 + steps.length * stride + 4;
};

const sanitizeForFilename = (s) => String(s || '').trim().replace(/[^a-zA-Z0-9]+/g, '_').replace(/^_+|_+$/g, '') || 'All';

const ddmmyyyy = (isoDate) => isoDate.split('-').reverse().join('-');

// @route GET /api/reports/period/export-pdf?preset=&organizationId=&platform=
// Its own filters, independent of whatever the report page currently shows —
// "All Organisations"/"All Social Media Accounts" when the query param is
// absent or "all".
export const exportPeriodReportPdf = asyncHandler(async (req, res) => {
  const { from, to } = resolveWindow(req, res);
  const allowed = accessibleOrgIds(req.user);

  const requestedOrgId = req.query.organizationId && req.query.organizationId !== 'all' ? String(req.query.organizationId) : null;
  let orgIds = allowed === null ? undefined : allowed;
  let orgLabel = 'All Organisations';
  if (requestedOrgId) {
    if (!/^[a-f0-9]{24}$/i.test(requestedOrgId) || !canAccessOrg(req.user, requestedOrgId)) {
      res.status(403);
      throw new Error('You do not have access to that organisation');
    }
    const org = await Organization.findById(requestedOrgId).select('name').lean();
    if (!org) { res.status(404); throw new Error('Organisation not found'); }
    orgIds = [requestedOrgId];
    orgLabel = org.name;
  }

  const requestedPlatform = req.query.platform && req.query.platform !== 'all' ? String(req.query.platform) : null;
  if (requestedPlatform && !PLATFORMS.includes(requestedPlatform)) {
    res.status(400);
    throw new Error(`platform must be one of ${PLATFORMS.join(', ')}`);
  }
  const platformLabel = requestedPlatform || 'All Social Media Accounts';

  const r = await buildPeriodReport({ from, to, orgIds, platform: requestedPlatform || undefined });

  // design/web/social/ads all carry one row per organization in scope even when
  // that college recorded nothing this window, so an empty-data check has to
  // look at the actual counts rather than row/array lengths — only team output
  // omits a person entirely when they had no assignments, so it alone is safe
  // to check by row count.
  const hasData = r.design.totals.requestsReceived > 0
    || r.web.totals.tasksReceived > 0
    || r.social.totals.posts > 0
    || r.ads.totals.spend > 0 || r.ads.totals.reach > 0 || r.ads.totals.leads > 0
    || r.team.rows.length > 0;
  if (!hasData) {
    res.status(404);
    throw new Error('No B&M report data is available for the selected filters.');
  }

  const periodLabel = `${ddmmyyyy(r.period.from)} to ${ddmmyyyy(r.period.to)}`;
  const filename = `B&M_Report_${sanitizeForFilename(orgLabel)}_${sanitizeForFilename(platformLabel === 'All Social Media Accounts' ? 'All Social Media' : platformLabel)}_${ddmmyyyy(r.period.from)}_to_${ddmmyyyy(r.period.to)}.pdf`;

  const drawHeader = makeHeaderDrawer(formatGeneratedDate());
  const doc = new PDFDocument({ margin: PAGE_MARGIN, size: 'A4', bufferPages: true });
  // While a college's page runs onto a second page, that page repeats its name.
  let continuingOrg = null;
  doc.on('pageAdded', () => {
    drawHeader(doc);
    if (continuingOrg) drawOrgBanner(doc, continuingOrg, null, { continued: true });
  });
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `inline; filename="${filename}"`);
  // Scoped to this endpoint only — lets the frontend read the exact generated
  // filename off the response instead of re-deriving the date window itself.
  res.setHeader('Access-Control-Expose-Headers', 'Content-Disposition');
  doc.pipe(res);

  drawHeader(doc);
  drawTitleBlock(doc, 'BRANDING & MARKETING REPORT');
  drawMetaBar(doc, [
    { label: 'Report Period', value: periodLabel },
    { label: 'Organisation', value: orgLabel },
    { label: 'Social Media', value: platformLabel },
    { label: 'Institutions in Scope', value: r.organizations.length },
  ]);

  // Report timeline — the period this report covers, laid out day by day (up
  // to two weeks) or week by week, with what happened in each stretch.
  const tl = r.timeline;
  sectionTitle(doc, 'Report Timeline', 14 + TIMELINE_PANEL_H);
  sectionSubtitle(doc, `What happened in each ${tl.granularity === 'day' ? 'day' : 'week'} of ${periodLabel} (${r.period.days} days). Each panel has its own scale; the darkest column is the busiest ${tl.granularity === 'day' ? 'day' : 'week'}.`);
  drawTimelinePanels(doc, tl.buckets.map(bucketLabel), [
    { name: 'Design requests raised', color: CATEGORICAL_COLORS[0], values: tl.buckets.map((b) => b.requests) },
    { name: 'Designs delivered', color: CATEGORICAL_COLORS[1], values: tl.buckets.map((b) => b.delivered) },
    { name: 'Social posts published', color: CATEGORICAL_COLORS[2], values: tl.buckets.map((b) => b.posts) },
  ]);

  // No paid activity at all — spend, reach, impressions, clicks and leads all
  // zero. The Paid Ads part then collapses to a single "nothing spent" line,
  // and the Overview drops the ad cards that would only ever read 0 / —.
  const at = r.ads.totals;
  const adsEmpty = !at.spend && !at.reach && !at.impressions && !at.clicks && !at.leads && !r.ads.topCampaigns.length;

  // Overview — the same headline numbers as the Excel Overview sheet, as
  // compact stat cards. Cards for a section that recorded nothing this period
  // (no web tasks, no team assignments, no ads) are left out rather than
  // filling the grid with 0 / 0.
  const h = r.headline;
  const overviewCards = [
    { label: 'Designs delivered', value: `${h.designsDelivered.value} / ${h.designsDelivered.of}`, color: ACCENT.orange },
    { label: 'Delivered on time', value: h.deliveredOnTimeRate == null ? '—' : `${h.deliveredOnTimeRate}%`, color: ACCENT.emerald },
    { label: 'Posts published', value: fmt(h.postsPublished), color: ACCENT.rose },
    { label: 'Likes', value: fmt(h.likes), color: ACCENT.indigo },
    { label: 'Design pending', value: fmt(h.designPending), color: ACCENT.navy },
    { label: 'Design cancelled', value: fmt(h.designCancelled), color: ACCENT.slate },
    { label: 'Designs completed', value: fmt(h.designsCompleted), color: ACCENT.sky },
    { label: 'First-pass approval', value: h.firstPassRate == null ? '—' : `${h.firstPassRate}%`, color: ACCENT.emerald },
    { label: 'Avg revision rounds', value: dashOrText(h.avgRevisionRounds), color: ACCENT.amber },
    { label: 'Organic reach', value: fmt(h.organicReach), color: ACCENT.indigo },
    { label: 'Follower growth', value: `+${fmt(h.followerGrowth)}`, color: ACCENT.emerald },
    { label: 'Ad spend', value: rupee(h.adSpend), color: ACCENT.amber },
    ...(r.web.totals.tasksReceived > 0 ? [{ label: 'Web tasks done', value: `${h.webTasksDone.value} / ${h.webTasksDone.of}`, color: ACCENT.sky }] : []),
    ...(adsEmpty ? [] : [
      { label: 'Paid reach', value: fmt(h.paidReach), color: ACCENT.sky },
      { label: 'Leads from ads', value: fmt(h.leadsFromAds), color: ACCENT.rose },
      { label: 'Cost per lead', value: h.costPerLead == null ? '—' : rupee(h.costPerLead), color: ACCENT.amber },
    ]),
    ...(r.team.rows.length > 0 ? [{ label: 'Team tasks done', value: `${h.teamTasksDone.value} / ${h.teamTasksDone.of}`, color: ACCENT.orange }] : []),
  ];
  sectionTitle(doc, 'Overview', 14 + cardGridHeightOf(overviewCards.length));
  sectionSubtitle(doc, `${fmt(h.postsPublished)} post(s) published and ${h.designsDelivered.value} design(s) delivered across ${r.organizations.length} institution(s) this period.`);
  drawCardGrid(doc, overviewCards);

  const overallInsights = buildInsights(r);
  drawInsightCards(doc, overallInsights);
  const asOf = new Date(Math.min(Date.now(), new Date(to).getTime()));

  const singleOrg = r.organizations.length === 1;
  const orgKey = (o) => String(o?._id || o);
  const rowFor = (section, org) => r[section].rows.find((x) => orgKey(x.organization) === orgKey(org));
  // Colleges in order of audience, largest first: the order of their pages.
  const orderedOrgs = [...r.organizations]
    .sort((a, b) => (rowFor('social', b)?.followers || 0) - (rowFor('social', a)?.followers || 0));

  // One college's slice of the report, in the same shape the section
  // insight builders read for the whole report.
  const orgView = (org) => {
    const one = (section) => { const row = rowFor(section, org); return { totals: row || {}, rows: row ? [row] : [] }; };
    const own = rowFor('social', org);
    return {
      design: one('design'),
      publishing: one('publishing'),
      web: one('web'),
      social: { ...one('social'), platformTotals: own?.platforms || [], leaderboard: [] },
      ads: { ...one('ads'), topCampaigns: [], byChannel: [] },
      team: { rows: [], totals: {} },
      goals: { rows: r.goals.rows.filter((g) => orgKey(g.organization) === orgKey(org)) },
    };
  };

  // ---- All colleges side by side (skipped when the report is for one college)
  if (!singleOrg) {
    doc.addPage();
    sectionTitle(doc, 'All Colleges at a Glance');
    sectionSubtitle(doc, `Every college side by side for ${periodLabel}, largest audience first. Each college then has a page of its own.`);

    const followerItems = orderedOrgs.map((o) => ({ label: o.name, followers: rowFor('social', o)?.followers || 0 }));
    if (anyPositive(followerItems, 'followers')) {
      subheading(doc, 'Audience by college (followers)', barChartHeightOf());
      drawBarChart(doc, followerItems, 'followers');
    }

    const pt = r.social.platformTotals;
    const platformSeries = pt.map((p) => ({ name: p.platform, color: PLATFORM_COLORS[p.platform] }));
    const postGroups = orderedOrgs.map((o) => rowFor('social', o)).filter((x) => x && x.posts > 0).map((x) => ({
      label: x.organization.name,
      values: pt.map((p) => x.platforms.find((q) => q.platform === p.platform)?.posts || 0),
    }));
    if (postGroups.length > 1 && platformSeries.length > 1) {
      subheading(doc, 'Posts by college and platform (darker = more posts)', heatmapHeightOf(postGroups.length));
      drawHeatmap(doc, postGroups.map((g) => g.label), platformSeries, postGroups.map((g) => g.values));
    }

    if (r.social.leaderboard.length > 1) {
      subheading(doc, 'Ranked by likes', dotPlotHeightOf(r.social.leaderboard.length, false));
      drawDotPlot(doc, r.social.leaderboard.map((x) => ({ label: `#${x.rank}  ${x.organization.name}`, value: x.likes })));
    }

    const reachTotal = pt.reduce((s, p) => s + p.reach, 0);
    if (reachTotal > 0) {
      const reachByPlatform = pt.filter((p) => p.reach > 0).sort((a, b) => b.reach - a.reach)
        .map((p) => ({ label: p.platform, count: p.reach, share: Math.round((p.reach / reachTotal) * 1000) / 10, color: PLATFORM_COLORS[p.platform] }));
      subheading(doc, 'Reach by platform, all colleges (share of total reach)', SHARE_CARDS_H);
      drawShareCards(doc, reachByPlatform, 'people reached');
    }

    if (adsEmpty) {
      subheading(doc, 'Paid ads');
      doc.fontSize(8).font('Helvetica').fillColor(GREY)
        .text('Rs 0 spent · 0 reach · 0 lead(s): no paid ad activity recorded this period.', PAGE_MARGIN, doc.y, { width: doc.page.width - PAGE_MARGIN * 2 });
      doc.moveDown(0.4);
    } else {
      const spenders = r.ads.rows.filter((x) => x.spend > 0);
      if (spenders.length > 1) {
        subheading(doc, `Ad spend by college (${rupee(at.spend)} in total, ${fmt(at.leads)} lead(s))`, barChartHeightOf());
        drawBarChart(doc, spenders.map((x) => ({ label: x.organization.name, spend: x.spend })).sort((a, b) => b.spend - a.spend), 'spend', { prefix: 'Rs ' });
      }
      if (r.ads.byChannel.length) {
        subheading(doc, 'Where the ad money went', breakdownHeightOf(r.ads.byChannel));
        drawBreakdownChart(doc, r.ads.byChannel);
      }
    }
  }

  // ---- One page per college, largest audience first. Every page has the
  // same cards in the same places (see drawOrgPage).
  orderedOrgs.forEach((org, i) => {
    doc.addPage();
    const w = rowFor('web', org);
    const a = rowFor('ads', org);
    const goals = r.goals.rows.filter((g) => orgKey(g.organization) === orgKey(org));
    const view = orgView(org);
    const orgAdsActive = !!(a && (a.spend > 0 || a.reach > 0 || a.leads > 0));
    drawOrgPage(doc, {
      org,
      rank: singleOrg ? null : i + 1,
      total: orderedOrgs.length,
      d: rowFor('design', org),
      p: rowFor('publishing', org),
      s: rowFor('social', org),
      best: r.social.topPostsByOrg?.[orgKey(org)] || [],
      labels: r.timeline.buckets.map(bucketLabel),
      series: r.timeline.byOrg?.[orgKey(org)],
      insights: mergeBuckets([
        designInsights(view, true), publishingInsights(view), socialInsights(view),
        ...(orgAdsActive ? [adsInsights(view, false)] : []),
        ...(w && w.tasksReceived > 0 ? [webInsights(view)] : []),
        ...(goals.length ? [goalInsights(view, asOf)] : []),
      ], new Set(), 3),
    });
  });

  // Stamp "Page X of Y" on every buffered page now that the
  // total page count is known.
  const range = doc.bufferedPageRange();
  for (let i = range.start; i < range.start + range.count; i += 1) {
    doc.switchToPage(i);
    const pageNum = i - range.start + 1;
    const y = doc.page.height - PAGE_MARGIN - 14;
    doc.fontSize(8).font('Helvetica').fillColor(GREY);
    doc.text(`Page ${pageNum} of ${range.count}`, doc.page.width - PAGE_MARGIN - 200, y, { width: 200, align: 'right', lineBreak: false });
  }

  doc.end();
});
