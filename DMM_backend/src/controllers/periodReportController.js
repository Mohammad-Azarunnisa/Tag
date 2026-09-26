import asyncHandler from 'express-async-handler';
import ExcelJS from 'exceljs';
import { buildPeriodReport, lastCompleteMonth } from '../services/periodReport.js';
import { accessibleOrgIds } from '../utils/org.js';

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
    ['Engagement rate', h.engagementRate == null ? '—' : `${h.engagementRate}%`],
    ['Ad spend', h.adSpend],
    ['Design pending', h.designPending],
    ['Design cancelled', h.designCancelled],
    ['Avg turnaround (days)', dash(h.avgTurnaroundDays)],
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
      'Approved first pass', 'First-pass rate %', 'Avg turnaround (d)', 'Avg revision rounds'],
    r.design.rows.map((x) => [x.organization.name, x.requestsReceived, x.completed, x.pending, x.cancelled,
      dash(x.deliveredOnTime), dash(x.onTimeRate), x.approvedFirstPass, dash(x.firstPassRate),
      dash(x.avgTurnaroundDays), dash(x.avgRevisionRounds)]),
    ['ALL INSTITUTIONS', r.design.totals.requestsReceived, r.design.totals.completed, r.design.totals.pending,
      r.design.totals.cancelled, dash(r.design.totals.deliveredOnTime), dash(r.design.totals.onTimeRate),
      r.design.totals.approvedFirstPass, dash(r.design.totals.firstPassRate), dash(r.design.totals.avgTurnaroundDays),
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
      'Engagement rate %', 'Followers', 'Follower growth'],
    r.social.rows.map((x) => [x.organization.name, x.posts, x.reach, x.impressions, x.likes, x.comments,
      x.shares, x.interactions, dash(x.engagementRate), x.followers, x.followerGrowth]),
    ['ALL ACCOUNTS', r.social.totals.posts, r.social.totals.reach, r.social.totals.impressions,
      r.social.totals.likes, r.social.totals.comments, r.social.totals.shares, r.social.totals.interactions,
      dash(r.social.totals.engagementRate), r.social.totals.followers, r.social.totals.followerGrowth]);

  if (r.social.leaderboard.length) {
    addSheet(wb, '3b Leaderboard', ['Rank', 'Account', 'Posts', 'Reach', 'Engagement rate %', 'Followers', 'Growth'],
      r.social.leaderboard.map((x) => [x.rank, x.organization.name, x.posts, x.reach, x.engagementRate, x.followers, x.followerGrowth]));
  }
  if (r.social.topPosts.length) {
    addSheet(wb, '3c Best posts', ['Account', 'Platform', 'Post', 'Reach', 'Engagement rate %'],
      r.social.topPosts.map((x) => [x.organization?.name || '—', x.platform, x.title, x.reach, x.engagementRate]));
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
