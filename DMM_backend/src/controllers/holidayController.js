import asyncHandler from 'express-async-handler';
import Holiday from '../models/Holiday.js';
import { planDesign } from '../utils/turnaround.js';

const KEY_RE = /^\d{4}-\d{2}-\d{2}$/;
const validKey = (k) => KEY_RE.test(k || '') && !Number.isNaN(new Date(`${k}T00:00:00.000Z`).getTime())
  && new Date(`${k}T00:00:00.000Z`).toISOString().slice(0, 10) === k;

export const holidaySet = async () => new Set((await Holiday.find().select('date').lean()).map((h) => h.date));

// @route GET /api/holidays?month=YYYY-MM  (or ?from&to) — any signed-in user.
export const listHolidays = asyncHandler(async (req, res) => {
  const { month, from, to } = req.query;
  const q = {};
  if (month) {
    if (!/^\d{4}-\d{2}$/.test(month)) { res.status(400); throw new Error('month must be YYYY-MM'); }
    q.date = { $gte: `${month}-01`, $lte: `${month}-31` };
  } else if (from && to) {
    q.date = { $gte: from, $lte: to };
  }
  const holidays = await Holiday.find(q).sort({ date: 1 }).lean();
  res.json({ success: true, holidays });
});

// @route POST /api/holidays  { date, name } or { holidays: [{ date, name }] }  — super admin
export const addHolidays = asyncHandler(async (req, res) => {
  const rows = Array.isArray(req.body.holidays) ? req.body.holidays : [{ date: req.body.date, name: req.body.name }];
  if (!rows.length) { res.status(400); throw new Error('Add at least one holiday'); }
  if (rows.length > 400) { res.status(400); throw new Error('That is too many at once — add up to 400 holidays per go'); }
  // Check every row before saving any, so a typo on the last line cannot leave
  // half the list saved.
  const clean = rows.map((r, i) => {
    const date = String(r.date || '').trim();
    const name = String(r.name || '').trim();
    if (!validKey(date)) { res.status(400); throw new Error(`Row ${i + 1}: "${date}" is not a valid date (use YYYY-MM-DD)`); }
    if (!name) { res.status(400); throw new Error(`Row ${i + 1} (${date}): give the holiday a name`); }
    return { date, name };
  });
  const existing = new Set((await Holiday.find({ date: { $in: clean.map((c) => c.date) } }).select('date').lean()).map((h) => h.date));
  await Holiday.bulkWrite(clean.map((c) => ({
    updateOne: { filter: { date: c.date }, update: { $set: { name: c.name }, $setOnInsert: { createdBy: req.user._id } }, upsert: true },
  })));
  const unique = new Set(clean.map((c) => c.date));
  const updated = [...unique].filter((d) => existing.has(d)).length;
  res.status(201).json({ success: true, added: unique.size - updated, updated, holidays: await Holiday.find({ date: { $in: [...unique] } }).sort({ date: 1 }).lean() });
});

// @route DELETE /api/holidays/:id  — super admin
export const removeHoliday = asyncHandler(async (req, res) => {
  const doc = await Holiday.findByIdAndDelete(req.params.id);
  if (!doc) { res.status(404); throw new Error('Holiday not found'); }
  res.json({ success: true, id: req.params.id });
});

// @route GET /api/turnaround/plan?workItem&workCategory[&from=YYYY-MM-DD]
// The class, design time and earliest delivery date for a design type — what the
// request form shows as the coordinator picks one.
export const getPlan = asyncHandler(async (req, res) => {
  const { workItem = '', workCategory = '' } = req.query;
  const holidays = await holidaySet();
  res.json({ success: true, plan: planDesign({ workItem, workCategory, raisedAt: new Date(), holidays }) });
});
