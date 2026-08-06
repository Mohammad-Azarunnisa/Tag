import asyncHandler from 'express-async-handler';
import Event from '../models/Event.js';
import Organization from '../models/Organization.js';
import { logActivity } from '../utils/logActivity.js';
import { ACTIVITY_ACTIONS, ROLES } from '../config/constants.js';
import { canAccessOrg, resolveViewOrgId } from '../utils/org.js';
import { createEventDriveFolder, uploadEventPhoto, deleteDriveFile, isDriveConfigured } from '../services/googleDrive.js';

// May this user edit/delete the event? The creator, any Admin (CEO) or the
// Super Admin / global Admin.
const canManage = (user, event) =>
  String(event.createdBy) === String(user._id) ||
  user.role === ROLES.ADMIN ||
  user.role === ROLES.CEO;

const requireDrive = (res) => {
  if (isDriveConfigured()) return;
  res.status(503);
  throw new Error('Google Drive isn\'t connected yet. Run "node scripts/googleDriveAuth.js" on the server, then restart the backend.');
};

const toPhoto = (file) => ({ driveFileId: file.id, name: file.name, url: file.webViewLink, thumbnailUrl: file.thumbnailLink || '' });

// @route GET /api/events — every event (shared workspace). Optional ?search, ?organizationId.
export const listEvents = asyncHandler(async (req, res) => {
  const { search, organizationId } = req.query;
  if (organizationId && organizationId !== 'shared' && !canAccessOrg(req.user, organizationId)) {
    res.status(403);
    throw new Error('Not allowed');
  }
  const resolvedOrgId = organizationId && organizationId !== 'shared' ? resolveViewOrgId(req) : null;
  // College filter, same convention as templates/assets: a specific college
  // shows its events PLUS the college-wide ones (organization: null), while
  // 'shared' shows only the college-wide ones.
  const query = {};
  const ands = [];
  if (organizationId === 'shared') query.organization = null;
  else if (resolvedOrgId) ands.push({ $or: [{ organization: resolvedOrgId }, { organization: null }] });
  if (search) ands.push({
    $or: [
      { name: { $regex: search, $options: 'i' } },
      { description: { $regex: search, $options: 'i' } },
      { location: { $regex: search, $options: 'i' } },
    ],
  });
  if (ands.length) query.$and = ands;
  const items = await Event.find(query)
    .populate('createdBy', 'name avatar')
    .populate('organization', 'name color')
    .sort({ eventDate: -1, createdAt: -1 })
    .lean();
  res.json({ success: true, count: items.length, events: items });
});

// @route POST /api/events — create an event (any authenticated user) and its
// Drive folder. Any photos attached go straight into that folder.
export const createEvent = asyncHandler(async (req, res) => {
  const { name, description, eventDate, location, organization } = req.body;
  if (!name?.trim()) { res.status(400); throw new Error('Event name is required'); }
  requireDrive(res);

  let orgId = null;
  if (organization) {
    if (!canAccessOrg(req.user, organization)) { res.status(403); throw new Error('Not allowed'); }
    const org = await Organization.findById(organization).select('_id');
    if (org) orgId = org._id;
  }

  const folder = await createEventDriveFolder(name.trim());

  const photos = [];
  for (const file of req.files || []) {
    const uploaded = await uploadEventPhoto(folder.id, file.buffer, file.originalname, file.mimetype);
    photos.push(toPhoto(uploaded));
  }

  const event = await Event.create({
    name: name.trim(),
    description: description || '',
    driveFolderId: folder.id,
    folderLink: folder.webViewLink,
    photos,
    eventDate: eventDate ? new Date(eventDate) : undefined,
    location: location || '',
    organization: orgId,
    createdBy: req.user._id,
  });

  logActivity({ user: req.user._id, organization: orgId, action: ACTIVITY_ACTIONS.EVENT_UPDATED, description: `Added event "${event.name}"`, entityType: 'Event', entityId: event._id });
  const populated = await Event.findById(event._id).populate('createdBy', 'name avatar').populate('organization', 'name color').lean();
  res.status(201).json({ success: true, event: populated });
});

// @route POST /api/events/:id/files — add more photos to an existing event's
// Drive folder (any authenticated user — shared workspace, same as create).
export const addEventFiles = asyncHandler(async (req, res) => {
  const event = await Event.findById(req.params.id);
  if (!event) { res.status(404); throw new Error('Event not found'); }
  requireDrive(res);
  if (!req.files?.length) { res.status(400); throw new Error('No files were uploaded'); }

  for (const file of req.files) {
    const uploaded = await uploadEventPhoto(event.driveFolderId, file.buffer, file.originalname, file.mimetype);
    event.photos.push(toPhoto(uploaded));
  }
  await event.save();
  const populated = await Event.findById(event._id).populate('createdBy', 'name avatar').populate('organization', 'name color').lean();
  res.json({ success: true, event: populated });
});

// @route PUT /api/events/:id — edit an event's details (creator / Admin). Photos
// are managed separately via POST /:id/files.
export const updateEvent = asyncHandler(async (req, res) => {
  const event = await Event.findById(req.params.id);
  if (!event) { res.status(404); throw new Error('Event not found'); }
  if (!canManage(req.user, event)) { res.status(403); throw new Error('Not allowed to edit this event'); }

  const { name, description, eventDate, location, organization } = req.body;
  if (name !== undefined) { if (!name.trim()) { res.status(400); throw new Error('Event name is required'); } event.name = name.trim(); }
  if (description !== undefined) event.description = description;
  if (location !== undefined) event.location = location;
  if (eventDate !== undefined) event.eventDate = eventDate ? new Date(eventDate) : undefined;
  if (organization !== undefined) {
    if (organization && !canAccessOrg(req.user, organization)) { res.status(403); throw new Error('Not allowed'); }
    if (!organization) event.organization = null;
    else { const org = await Organization.findById(organization).select('_id'); if (org) event.organization = org._id; }
  }

  await event.save();
  const populated = await Event.findById(event._id).populate('createdBy', 'name avatar').populate('organization', 'name color').lean();
  res.json({ success: true, event: populated });
});

// @route DELETE /api/events/:id — remove an event (creator / Admin), including
// its Drive folder and every photo inside it.
export const deleteEvent = asyncHandler(async (req, res) => {
  const event = await Event.findById(req.params.id);
  if (!event) { res.status(404); throw new Error('Event not found'); }
  if (!canManage(req.user, event)) { res.status(403); throw new Error('Not allowed to delete this event'); }
  if (event.driveFolderId) await deleteDriveFile(event.driveFolderId);
  await event.deleteOne();
  res.json({ success: true, id: req.params.id });
});
