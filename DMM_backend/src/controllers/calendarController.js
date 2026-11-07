import asyncHandler from 'express-async-handler';
import mongoose from 'mongoose';
import ApprovalImage from '../models/ApprovalImage.js';
import InstitutionRequest from '../models/InstitutionRequest.js';
import DesignerNote from '../models/DesignerNote.js';
import Organization from '../models/Organization.js';
import SocialPost from '../models/SocialPost.js';
import LinkedInPost from '../models/LinkedInPost.js';
import { requireOrgId } from '../utils/org.js';
import { ROLES, USER_TYPES } from '../config/constants.js';

// A designer's calendar is their finished work, not the posting schedule: every
// design of theirs that has been approved (accepted by the coordinator) sits on the
// day it was approved. Computed from the requests themselves, so everything
// approved to date is already there. Not limited to one college — a designer
// works across them — but only ever their own designs. Days are IST days.
const isDesignerUser = (u) => u?.role === ROLES.USER && u?.userType === USER_TYPES.DESIGNER;
const IST = '+05:30';
const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;
const designerDesigns = (user) => ({
  designer: user._id,
  designAcceptedAt: { $ne: null },
  workflowStage: { $ne: 'CANCELLED' },
});

const designerMonth = async (req, res, y, m, monthStr) => {
  const start = new Date(Date.UTC(y, m - 1, 1) - IST_OFFSET_MS);
  const end = new Date(Date.UTC(y, m, 1) - IST_OFFSET_MS);
  const agg = await InstitutionRequest.aggregate([
    { $match: { ...designerDesigns(req.user), designAcceptedAt: { $gte: start, $lt: end } } },
    { $group: { _id: { $dateToString: { format: '%Y-%m-%d', date: '$designAcceptedAt', timezone: IST } }, count: { $sum: 1 } } },
    { $sort: { _id: 1 } },
  ]);
  const noteAgg = await DesignerNote.aggregate([
    { $match: { designer: req.user._id, date: { $gte: `${monthStr}-01`, $lte: `${monthStr}-31` } } },
    { $group: { _id: '$date', n: { $sum: 1 } } },
  ]);
  const byDate = new Map(agg.map((d) => [d._id, { date: d._id, count: d.count, notes: 0, platforms: [] }]));
  noteAgg.forEach((n) => {
    const row = byDate.get(n._id) || { date: n._id, count: 0, notes: 0, platforms: [] };
    row.notes = n.n; byDate.set(n._id, row);
  });
  const days = [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date));
  res.json({
    success: true, kind: 'designs', month: monthStr,
    total: days.reduce((a, d) => a + d.count, 0), notesTotal: days.reduce((a, d) => a + d.notes, 0), days,
  });
};

const designerDay = async (req, res, dateStr) => {
  const start = new Date(new Date(`${dateStr}T00:00:00.000Z`).getTime() - IST_OFFSET_MS);
  const end = new Date(start.getTime() + 24 * 60 * 60 * 1000);
  const designs = await InstitutionRequest.find({ ...designerDesigns(req.user), designAcceptedAt: { $gte: start, $lt: end } })
    .populate('organization', 'name color')
    .populate('raisedBy', 'name')
    .sort({ designAcceptedAt: 1 })
    .select('title organization raisedBy workCategory workItem priority designAcceptedAt designApproval')
    .lean();
  const approvalIds = designs.map((d) => d.designApproval).filter(Boolean);
  const covers = approvalIds.length ? await ApprovalImage.find({ request: { $in: approvalIds } }).sort({ order: 1 }).lean() : [];
  const coverByApproval = covers.reduce((acc, img) => { if (!acc[img.request]) acc[img.request] = img.url; return acc; }, {});
  const notes = await DesignerNote.find({ designer: req.user._id, date: dateStr }).populate('organization', 'name').sort({ createdAt: 1 }).lean();
  res.json({
    success: true, kind: 'designs', date: dateStr, count: designs.length,
    designs: designs.map((d) => ({ ...d, cover: coverByApproval[d.designApproval] || null })),
    notes,
  });
};

// The posting calendar is built from what the platforms themselves report: every post
// the Instagram, Facebook and YouTube APIs have synced (SocialPost) and every post in the
// LinkedIn export (LinkedInPost), on the day it was published. It is the same data that
// feeds Social Analytics and the B&M report, so the three can never disagree about what
// went out. A post made through t@g that reached a platform shows up here the same way
// as one made on the platform itself, once that platform has reported it.
// Days are IST days.
const orgObjectId = (orgId) => new mongoose.Types.ObjectId(orgId);
const dayWindow = (dateStr) => {
  const start = new Date(new Date(`${dateStr}T00:00:00.000Z`).getTime() - IST_OFFSET_MS);
  return { start, end: new Date(start.getTime() + 24 * 60 * 60 * 1000) };
};
const monthWindow = (y, m) => ({
  start: new Date(Date.UTC(y, m - 1, 1) - IST_OFFSET_MS),
  end: new Date(Date.UTC(y, m, 1) - IST_OFFSET_MS),
});
const clip = (t, n = 160) => Array.from(String(t || '').replace(/\s+/g, ' ').trim()).slice(0, n).join('');

// @route GET /api/calendar?month=YYYY-MM  — posts per day for the month, from the platform metrics
export const getCalendarMonth = asyncHandler(async (req, res) => {
  const monthStr = req.query.month || new Date().toISOString().slice(0, 7);
  const [y, m] = monthStr.split('-').map(Number);
  if (!y || !m || m < 1 || m > 12) { res.status(400); throw new Error('Invalid month (expected YYYY-MM)'); }
  if (isDesignerUser(req.user)) return designerMonth(req, res, y, m, monthStr);
  const orgId = requireOrgId(req, res);
  const org = orgObjectId(orgId);
  const { start, end } = monthWindow(y, m);

  const [social, linkedin, synced] = await Promise.all([
    SocialPost.aggregate([
      { $match: { organization: org, publishedAt: { $gte: start, $lt: end } } },
      { $group: {
        _id: { day: { $dateToString: { format: '%Y-%m-%d', date: '$publishedAt', timezone: IST } }, platform: '$platform' },
        count: { $sum: 1 }, likes: { $sum: '$likes' }, reach: { $sum: '$reach' }, impressions: { $sum: '$impressions' },
      } },
    ]),
    LinkedInPost.aggregate([
      { $match: { organization: org, createdDate: { $gte: start, $lt: end } } },
      { $group: {
        _id: { day: { $dateToString: { format: '%Y-%m-%d', date: '$createdDate', timezone: IST } }, platform: 'LinkedIn' },
        count: { $sum: 1 }, likes: { $sum: '$reactions' }, reach: { $sum: 0 }, impressions: { $sum: '$impressions' },
      } },
    ]),
    SocialPost.findOne({ organization: org }).sort({ lastSyncedAt: -1 }).select('lastSyncedAt').lean(),
  ]);

  const byDate = new Map();
  const byPlatform = {};
  for (const row of [...social, ...linkedin]) {
    const { day, platform } = row._id;
    const d = byDate.get(day) || { date: day, count: 0, likes: 0, platforms: [], byPlatform: {} };
    d.count += row.count; d.likes += row.likes || 0;
    d.byPlatform[platform] = (d.byPlatform[platform] || 0) + row.count;
    if (!d.platforms.includes(platform)) d.platforms.push(platform);
    byDate.set(day, d);
    byPlatform[platform] = (byPlatform[platform] || 0) + row.count;
  }
  const days = [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date));
  res.json({
    success: true, kind: 'platform', month: monthStr,
    total: days.reduce((a, d) => a + d.count, 0),
    totalLikes: days.reduce((a, d) => a + d.likes, 0),
    byPlatform, days,
    lastSyncedAt: synced?.lastSyncedAt || null,
  });
});

// @route GET /api/calendar/day?date=YYYY-MM-DD  — the posts the platforms report for that day
export const getCalendarDay = asyncHandler(async (req, res) => {
  const dateStr = req.query.date;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr || '')) { res.status(400); throw new Error('Invalid date (expected YYYY-MM-DD)'); }
  if (isDesignerUser(req.user)) return designerDay(req, res, dateStr);
  const orgId = requireOrgId(req, res);
  const org = orgObjectId(orgId);
  const { start, end } = dayWindow(dateStr);

  const [social, linkedin] = await Promise.all([
    SocialPost.find({ organization: org, publishedAt: { $gte: start, $lt: end } }).lean(),
    LinkedInPost.find({ organization: org, createdDate: { $gte: start, $lt: end } }).lean(),
  ]);

  const posts = [
    ...social.map((p) => ({
      id: String(p._id), platform: p.platform, title: clip(p.caption) || `${p.platform} post`,
      url: p.url || '', thumbnail: p.thumbnail || '', mediaType: p.mediaType || '', publishedAt: p.publishedAt, timeKnown: true,
      metrics: { impressions: p.impressions || 0, reach: p.reach || 0, views: p.views || 0, likes: p.likes || 0, comments: p.comments || 0, shares: p.shares || 0, saved: p.saved || 0 },
    })),
    ...linkedin.map((p) => ({
      id: String(p._id), platform: 'LinkedIn', title: clip(p.title) || 'LinkedIn post',
      // LinkedIn's export only carries the date, never the time of day
      url: p.url || '', thumbnail: '', mediaType: p.contentType || '', publishedAt: p.createdDate, timeKnown: false,
      metrics: { impressions: p.impressions || 0, reach: 0, views: p.views || 0, likes: p.reactions || 0, comments: p.comments || 0, shares: p.reposts || 0, clicks: p.clicks || 0 },
    })),
  ].sort((a, b) => (a.timeKnown === b.timeKnown ? new Date(a.publishedAt) - new Date(b.publishedAt) : (a.timeKnown ? -1 : 1)));

  const sum = (key) => posts.reduce((t, p) => t + (p.metrics[key] || 0), 0);
  res.json({
    success: true, kind: 'platform', date: dateStr, count: posts.length, posts,
    totals: { likes: sum('likes'), comments: sum('comments'), reach: sum('reach'), impressions: sum('impressions') },
  });
});

// ---------------------------------------------------------------------------
// A designer's own notes on the Design Calendar (work done outside t@g)
// ---------------------------------------------------------------------------
const requireDesigner = (req, res) => {
  if (!isDesignerUser(req.user)) { res.status(403); throw new Error('Notes on the Design Calendar are for designers'); }
};
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const noteFields = async (body, res) => {
  const title = String(body.title || '').trim();
  const details = String(body.details || '').trim();
  if (!title) { res.status(400); throw new Error('Give the note a title'); }
  let organization = null;
  if (body.organization) {
    organization = await Organization.findById(body.organization).select('_id').lean();
    if (!organization) { res.status(400); throw new Error('That college does not exist'); }
    organization = organization._id;
  }
  return { title, details, organization };
};

// @route POST /api/calendar/notes  { date, title, details?, organization? }
export const addDesignerNote = asyncHandler(async (req, res) => {
  requireDesigner(req, res);
  const date = String(req.body.date || '');
  if (!DATE_RE.test(date) || Number.isNaN(new Date(`${date}T00:00:00.000Z`).getTime())) { res.status(400); throw new Error('Pick a valid date'); }
  const note = await DesignerNote.create({ designer: req.user._id, date, ...(await noteFields(req.body, res)) });
  const populated = await DesignerNote.findById(note._id).populate('organization', 'name').lean();
  res.status(201).json({ success: true, note: populated });
});

const ownNote = async (req, res) => {
  const note = await DesignerNote.findById(req.params.id);
  if (!note || String(note.designer) !== String(req.user._id)) { res.status(404); throw new Error('Note not found'); }
  return note;
};

// @route PUT /api/calendar/notes/:id
export const updateDesignerNote = asyncHandler(async (req, res) => {
  requireDesigner(req, res);
  const note = await ownNote(req, res);
  Object.assign(note, await noteFields(req.body, res));
  await note.save();
  const populated = await DesignerNote.findById(note._id).populate('organization', 'name').lean();
  res.json({ success: true, note: populated });
});

// @route DELETE /api/calendar/notes/:id
export const deleteDesignerNote = asyncHandler(async (req, res) => {
  requireDesigner(req, res);
  const note = await ownNote(req, res);
  await note.deleteOne();
  res.json({ success: true, id: req.params.id });
});
