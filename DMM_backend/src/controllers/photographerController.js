import asyncHandler from 'express-async-handler';
import User from '../models/User.js';
import Organization from '../models/Organization.js';
import PhotographerSlot from '../models/PhotographerSlot.js';
import PhotographerPlan from '../models/PhotographerPlan.js';
import { logActivity } from '../utils/logActivity.js';
import { createNotification } from '../utils/notify.js';
import { canAccessOrg, requireOrgId, pinnedWriteOrg } from '../utils/org.js';
import { ROLES, USER_TYPES, PHOTOGRAPHER_SLOTS, ACTIVITY_ACTIONS, NOTIFICATION_TYPES } from '../config/constants.js';

const isAdministrator = (user) => user?.role === ROLES.ADMIN || user?.role === ROLES.CEO;
const isPhotographer = (user) => user?.role === ROLES.USER && user?.userType === USER_TYPES.PHOTOGRAPHER;

// A photographer is booked out for the whole day, or for one of the three
// blocks — either way, nothing else can be booked alongside it that day.
const conflictsWith = (existingSlot, wantedSlot) =>
  existingSlot === 'FULL_DAY' || wantedSlot === 'FULL_DAY' || existingSlot === wantedSlot;

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

// @route GET /api/photographers — the bookable pool. Shared across every
// college (see model comments) — anyone signed in may see who's available to
// book, same as the People directory.
export const listPhotographers = asyncHandler(async (req, res) => {
  const photographers = await User.find({ role: ROLES.USER, userType: USER_TYPES.PHOTOGRAPHER, isActive: true })
    .select('name avatar jobTitle phone email')
    .sort({ name: 1 })
    .lean();
  res.json({ success: true, photographers });
});

// @route GET /api/photographers/slots?from&to&photographerId
// Every booking in the window — used both to render the shared booking
// calendar (so anyone can see who's free) and a single photographer's own
// calendar (?photographerId narrows to just them).
export const listSlots = asyncHandler(async (req, res) => {
  const { from, to, photographerId } = req.query;
  if (!from || !to || !DATE_RE.test(from) || !DATE_RE.test(to)) {
    res.status(400); throw new Error('from and to are required, as YYYY-MM-DD');
  }
  const query = { date: { $gte: from, $lte: to } };
  if (photographerId) query.photographer = photographerId;

  const slots = await PhotographerSlot.find(query)
    .populate('photographer', 'name avatar')
    .populate('organization', 'name color')
    .populate('bookedBy', 'name')
    .sort({ date: 1 })
    .lean();
  res.json({ success: true, slots });
});

// @route POST /api/photographers/slots
// body: { photographer, date, slot, eventName, notes?, organization? }
//
// Anyone signed in (not view-only) may book a photographer, for their own
// college — a coordinator is always pinned to their own (mirrors
// pinnedWriteOrg elsewhere); an Admin/CEO must hold the college they name; the
// super admin may name any college, since they aren't tied to a single one the
// way a coordinator is. A photographer may never book themselves (below).
export const bookSlot = asyncHandler(async (req, res) => {
  const { photographer: photographerId, date, slot, eventName } = req.body;
  const notes = String(req.body.notes || '').trim();

  if (!photographerId) { res.status(400); throw new Error('Choose a photographer'); }
  if (!date || !DATE_RE.test(date)) { res.status(400); throw new Error('date must be YYYY-MM-DD'); }
  if (!PHOTOGRAPHER_SLOTS.includes(slot)) { res.status(400); throw new Error(`slot must be one of ${PHOTOGRAPHER_SLOTS.join(', ')}`); }
  if (!String(eventName || '').trim()) { res.status(400); throw new Error('Event name is required'); }

  const photographer = await User.findOne({ _id: photographerId, role: ROLES.USER, userType: USER_TYPES.PHOTOGRAPHER, isActive: true });
  if (!photographer) { res.status(404); throw new Error('Photographer not found'); }
  // A photographer updates their own day-to-day plan (upsertPlan below), but
  // does not book their own formal slots — that stays a coordinator's or an
  // administrator's call, the same way a designer doesn't assign their own brief.
  if (String(photographer._id) === String(req.user._id)) {
    res.status(403); throw new Error('A photographer\'s slots are booked by a coordinator or admin, not the photographer themselves');
  }

  const pinned = pinnedWriteOrg(req.user);
  let orgId;
  if (pinned) {
    orgId = pinned;
  } else if (req.body.organization) {
    // The super admin and a photographer booking themselves aren't tied to one
    // college, so either may name any of them; a CEO must actually hold it.
    const openBooking = req.user.role === ROLES.ADMIN || isPhotographer(req.user);
    if (!openBooking && !canAccessOrg(req.user, req.body.organization)) {
      res.status(403); throw new Error('Not allowed to book on behalf of that college');
    }
    orgId = req.body.organization;
  } else {
    orgId = requireOrgId(req, res);
  }
  const org = await Organization.findById(orgId).select('_id name');
  if (!org) { res.status(400); throw new Error('That college does not exist'); }

  // Optimistic-lock style check: read then write, same window a genuine
  // double-click race would need — acceptable here since a clash simply means
  // "try a different slot", not lost work.
  const sameDay = await PhotographerSlot.find({ photographer: photographerId, date }).lean();
  const clash = sameDay.find((s) => conflictsWith(s.slot, slot));
  if (clash) {
    const clashOrg = await Organization.findById(clash.organization).select('name').lean();
    res.status(409);
    throw new Error(`${photographer.name} is already booked ${clash.slot === 'FULL_DAY' ? 'for the full day' : `for ${clash.slot.toLowerCase()}`} on ${date} — ${clashOrg?.name || 'another college'}, "${clash.eventName}"`);
  }

  const created = await PhotographerSlot.create({
    photographer: photographerId,
    date,
    slot,
    organization: org._id,
    eventName: eventName.trim(),
    notes,
    bookedBy: req.user._id,
  });

  logActivity({
    user: req.user._id, organization: org._id, action: ACTIVITY_ACTIONS.PHOTOGRAPHER_SLOT_BOOKED,
    description: `Booked ${photographer.name} (${slot.toLowerCase()}) on ${date} for "${eventName.trim()}"`,
    entityType: 'PhotographerSlot', entityId: created._id,
  });
  if (String(photographer._id) !== String(req.user._id)) {
    await createNotification({
      recipient: photographer._id, organization: org._id, type: NOTIFICATION_TYPES.PHOTOGRAPHER_BOOKED,
      title: 'You have been booked',
      message: `${req.user.name} booked you for "${eventName.trim()}" (${org.name}) on ${date}, ${slot.toLowerCase().replace('_', ' ')}`,
      link: '/photographers',
    });
  }

  const populated = await PhotographerSlot.findById(created._id)
    .populate('photographer', 'name avatar')
    .populate('organization', 'name color')
    .populate('bookedBy', 'name')
    .lean();
  res.status(201).json({ success: true, slot: populated });
});

// @route DELETE /api/photographers/slots/:id
// The person who booked it, the photographer themselves, or an administrator.
export const cancelSlot = asyncHandler(async (req, res) => {
  const slot = await PhotographerSlot.findById(req.params.id);
  if (!slot) { res.status(404); throw new Error('Booking not found'); }
  const mine = String(slot.bookedBy) === String(req.user._id) || String(slot.photographer) === String(req.user._id);
  if (!mine && !isAdministrator(req.user)) { res.status(403); throw new Error('Not allowed to cancel this booking'); }
  await slot.deleteOne();
  res.json({ success: true, id: req.params.id });
});

// @route GET /api/photographers/:id/plans?from&to
// Day-to-day plan notes. Readable by anyone signed in (same spirit as the
// booking calendar — knowing a photographer's plan helps everyone avoid
// clashing with it), writable only by the photographer themselves (below).
export const listPlans = asyncHandler(async (req, res) => {
  const { from, to } = req.query;
  if (!from || !to || !DATE_RE.test(from) || !DATE_RE.test(to)) {
    res.status(400); throw new Error('from and to are required, as YYYY-MM-DD');
  }
  const plans = await PhotographerPlan.find({ photographer: req.params.id, date: { $gte: from, $lte: to } })
    .select('date note')
    .lean();
  res.json({ success: true, plans });
});

// @route GET /api/photographers/today
// A quick, at-a-glance broadcast of who has work on today — every
// photographer's plan note for today's date in one call, so anyone (not just
// a coordinator picking a photographer to book) can see who's busy without
// opening each photographer's calendar one at a time.
export const listTodayStatus = asyncHandler(async (req, res) => {
  const today = new Date().toISOString().slice(0, 10);
  const photographers = await User.find({ role: ROLES.USER, userType: USER_TYPES.PHOTOGRAPHER, isActive: true })
    .select('name avatar')
    .sort({ name: 1 })
    .lean();
  const plans = await PhotographerPlan.find({ date: today, photographer: { $in: photographers.map((p) => p._id) } })
    .select('photographer note')
    .lean();
  const noteById = new Map(plans.map((p) => [String(p.photographer), p.note]));
  res.json({
    success: true,
    date: today,
    photographers: photographers.map((p) => ({ _id: p._id, name: p.name, avatar: p.avatar, note: noteById.get(String(p._id)) || '' })),
  });
});

// @route PUT /api/photographers/plans/:date  body: { note }
// A photographer's own note for that day — nobody else may write it.
export const upsertPlan = asyncHandler(async (req, res) => {
  if (!isPhotographer(req.user)) { res.status(403); throw new Error('Only a photographer account has its own calendar to update'); }
  const { date } = req.params;
  if (!DATE_RE.test(date)) { res.status(400); throw new Error('date must be YYYY-MM-DD'); }
  const note = String(req.body.note || '');
  const plan = await PhotographerPlan.findOneAndUpdate(
    { photographer: req.user._id, date },
    { $set: { note } },
    { new: true, upsert: true }
  );
  res.json({ success: true, plan: { date: plan.date, note: plan.note } });
});
