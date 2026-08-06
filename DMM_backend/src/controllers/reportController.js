import asyncHandler from 'express-async-handler';
import mongoose from 'mongoose';
import ExcelJS from 'exceljs';
import PDFDocument from 'pdfkit';
import ApprovalRequest from '../models/ApprovalRequest.js';
import Template from '../models/Template.js';
import Asset from '../models/Asset.js';
import ActivityLog from '../models/ActivityLog.js';
import { requireOrgId } from '../utils/org.js';
import { ROLES } from '../config/constants.js';

// Build the row data for a given report type. `scope` always includes organization
// (and createdBy for non-privileged users); `orgId` scopes library reports.
const buildRows = async (type, scope, orgId) => {
  switch (type) {
    case 'approval': {
      const docs = await ApprovalRequest.find(scope).populate('createdBy', 'name').sort({ createdAt: -1 });
      return {
        columns: ['Title', 'Platform', 'Status', 'Created By', 'Created', 'Posted'],
        rows: docs.map((d) => [
          d.title, d.platform, d.status, d.createdBy?.name || '-',
          d.createdAt.toISOString().slice(0, 10),
          d.postedAt ? d.postedAt.toISOString().slice(0, 10) : '-',
        ]),
      };
    }
    case 'posting': {
      const docs = await ApprovalRequest.find({ ...scope, status: 'POSTED' }).populate('postedBy', 'name').sort({ postedAt: -1 });
      return {
        columns: ['Title', 'Platform', 'Posted By', 'Posted Date'],
        rows: docs.map((d) => [d.title, d.platform, d.postedBy?.name || '-', d.postedAt?.toISOString().slice(0, 10) || '-']),
      };
    }
    case 'template': {
      const docs = await Template.find({ organization: orgId }).populate('uploadedBy', 'name').sort({ createdAt: -1 });
      return {
        columns: ['Name', 'Category', 'Type', 'Downloads', 'Uploaded By', 'Created'],
        rows: docs.map((d) => [d.name, d.category, d.fileType, d.downloads, d.uploadedBy?.name || '-', d.createdAt.toISOString().slice(0, 10)]),
      };
    }
    case 'asset': {
      const docs = await Asset.find({ organization: orgId }).populate('uploadedBy', 'name').sort({ createdAt: -1 });
      return {
        columns: ['Name', 'Category', 'Type', 'Downloads', 'Uploaded By', 'Created'],
        rows: docs.map((d) => [d.name, d.category, d.fileType, d.downloads, d.uploadedBy?.name || '-', d.createdAt.toISOString().slice(0, 10)]),
      };
    }
    case 'activity': {
      const actQuery = { organization: orgId, ...(scope.createdBy ? { user: scope.createdBy } : {}) };
      const docs = await ActivityLog.find(actQuery).populate('user', 'name').sort({ createdAt: -1 }).limit(500);
      return {
        columns: ['User', 'Action', 'Description', 'Timestamp'],
        rows: docs.map((d) => [d.user?.name || '-', d.action, d.description, d.createdAt.toISOString().slice(0, 16).replace('T', ' ')]),
      };
    }
    default:
      throw new Error('Unknown report type');
  }
};

const titleFor = {
  approval: 'Approval Report',
  posting: 'Posting Report',
  template: 'Template Report',
  asset: 'Asset Report',
  activity: 'User Activity Report',
};

// @route GET /api/reports/:type?format=excel|pdf
export const exportReport = asyncHandler(async (req, res) => {
  const { type } = req.params;
  const format = (req.query.format || 'excel').toLowerCase();
  const orgId = requireOrgId(req, res);
  const privileged = [ROLES.ADMIN, ROLES.CEO].includes(req.user.role);
  const scope = privileged ? { organization: orgId } : { organization: orgId, createdBy: req.user._id };
  const { columns, rows } = await buildRows(type, scope, orgId);
  const title = titleFor[type] || 'Report';

  if (format === 'pdf') {
    const doc = new PDFDocument({ margin: 40, size: 'A4', layout: 'landscape' });
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${type}-report.pdf"`);
    doc.pipe(res);

    doc.fontSize(18).fillColor('#4f46e5').text(title, { align: 'left' });
    doc.moveDown(0.3);
    doc.fontSize(9).fillColor('#666').text(`Generated: ${new Date().toUTCString()}  •  ${rows.length} records`);
    doc.moveDown(0.8);

    const startX = 40;
    const usableW = doc.page.width - 80;
    const colW = usableW / columns.length;
    let y = doc.y;

    const drawRow = (cells, { header } = {}) => {
      doc.fontSize(header ? 10 : 9).fillColor(header ? '#111' : '#333').font(header ? 'Helvetica-Bold' : 'Helvetica');
      cells.forEach((c, i) => doc.text(String(c ?? ''), startX + i * colW, y, { width: colW - 6, ellipsis: true }));
      y += 20;
      if (y > doc.page.height - 50) { doc.addPage(); y = 40; }
    };
    drawRow(columns, { header: true });
    doc.moveTo(startX, y - 4).lineTo(startX + usableW, y - 4).strokeColor('#ddd').stroke();
    rows.forEach((r) => drawRow(r));
    doc.end();
    return;
  }

  // Excel
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet(title);
  ws.columns = columns.map((c) => ({ header: c, key: c, width: Math.max(18, c.length + 4) }));
  ws.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
  ws.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF4F46E5' } };
  rows.forEach((r) => ws.addRow(r));
  ws.eachRow((row) => (row.alignment = { vertical: 'middle' }));

  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="${type}-report.xlsx"`);
  await wb.xlsx.write(res);
  res.end();
});

// @route GET /api/reports/summary/approval-analytics — KPI + chart data for analytics page
export const approvalAnalytics = asyncHandler(async (req, res) => {
  const orgId = requireOrgId(req, res);
  const privileged = [ROLES.ADMIN, ROLES.CEO].includes(req.user.role);
  // find() scope (string ok) and aggregate $match scope (needs ObjectId)
  const scope = privileged ? { organization: orgId } : { organization: orgId, createdBy: req.user._id };
  const aggScope = { ...scope, organization: new mongoose.Types.ObjectId(orgId) };
  if (scope.createdBy) aggScope.createdBy = new mongoose.Types.ObjectId(req.user._id);
  const agg = await ApprovalRequest.aggregate([
    { $match: aggScope },
    { $group: { _id: '$status', count: { $sum: 1 } } },
  ]);
  const by = (s) => agg.find((x) => x._id === s)?.count || 0;
  const total = agg.reduce((a, x) => a + x.count, 0);
  const approvedTotal = by('APPROVED') + by('POSTED');
  const successRate = total ? Math.round((approvedTotal / total) * 100) : 0;

  // Per-user performance (CEO view)
  const userPerf = await ApprovalRequest.aggregate([
    { $match: aggScope },
    { $group: { _id: '$createdBy', total: { $sum: 1 }, approved: { $sum: { $cond: [{ $in: ['$status', ['APPROVED', 'POSTED']] }, 1, 0] } } } },
    { $lookup: { from: 'users', localField: '_id', foreignField: '_id', as: 'user' } },
    { $unwind: '$user' },
    { $project: { name: '$user.name', avatar: '$user.avatar', total: 1, approved: 1 } },
    { $sort: { total: -1 } },
    { $limit: 10 },
  ]);

  const [recentRequests, recentRejections, recentPosted] = await Promise.all([
    ApprovalRequest.find(scope).populate('createdBy', 'name avatar').sort({ createdAt: -1 }).limit(8),
    ApprovalRequest.find({ ...scope, status: 'REJECTED' }).populate('createdBy', 'name avatar').sort({ rejectedAt: -1 }).limit(8),
    ApprovalRequest.find({ ...scope, status: 'POSTED' }).populate('createdBy', 'name avatar').sort({ postedAt: -1 }).limit(8),
  ]);

  res.json({
    success: true,
    kpis: {
      total, pending: by('PENDING'), approved: by('APPROVED'),
      rejected: by('REJECTED'), resubmitted: by('RESUBMITTED'), posted: by('POSTED'),
      successRate,
    },
    userPerformance: userPerf,
    tables: { recentRequests, recentRejections, recentPosted },
  });
});
