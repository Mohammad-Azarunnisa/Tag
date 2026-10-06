import asyncHandler from 'express-async-handler';
import Event from '../models/Event.js';
import Organization from '../models/Organization.js';
import { logActivity } from '../utils/logActivity.js';
import { ACTIVITY_ACTIONS, ROLES } from '../config/constants.js';
import { canAccessOrg, resolveViewOrgId } from '../utils/org.js';
import { assertCanDeleteOrgItem } from '../utils/permissions.js';
import { uploadBuffer, deleteFile } from '../config/storage.js';
import { createEventDriveFolder, uploadEventPhoto, deleteDriveFile, isDriveConfigured } from '../services/googleDrive.js';

// May this user edit/delete the event? The creator, the Super Admin / global
// Admin, or the CEO of the college the event belongs to (a shared/college-wide
// event has no organization, so any CEO may manage it) — a CEO must not be
// able to touch another college's event.
const canManage = (user, event) =>
  String(event.createdBy) === String(user._id) ||
  user.role === ROLES.ADMIN ||
  (user.role === ROLES.CEO && (!event.organization || canAccessOrg(user, event.organization)));

const isPhotographer = (user) => user?.role === ROLES.USER && user?.userType === USER_TYPES.PHOTOGRAPHER;
//
// A second, distinct log entry (on top of EVENT_UPDATED above) only when the
// actor is a photographer — so the super admin's photographer work heatmap
// (Photographers.jsx, filtering on this exact action) can count "posted work"
// without picking up every event anyone else adds.
const logPhotographerWork = (req, event, description) => {
  if (!isPhotographer(req.user)) return;
  logActivity({
    user: req.user._id, organization: event.organization, action: ACTIVITY_ACTIONS.PHOTOGRAPHER_WORK_POSTED,
    description, entityType: 'Event', entityId: event._id,
  });
};

const requireDrive = (res) => {
  if (isDriveConfigured()) return;
  res.status(503);
  throw new Error('Google Drive isn\'t connected yet. Run "node scripts/googleDriveAuth.js" on the server, then restart the backend.');
};

const toPhoto = (file) => ({ driveFileId: file.id, name: file.name, url: file.webViewLink, thumbnailUrl: file.thumbnailLink || '' });

// The cover image is a single file under `coverImage`; everything else is album
// material bound for Drive. Multer hands back an array from .array() and an
// object keyed by field from .fields(), so both shapes are flattened here.
const splitFiles = (files) => {
  const all = Array.isArray(files) ? files : Object.values(files || {}).flat();
  return {
    cover: all.find((f) => f.fieldname === 'coverImage') || null,
    albumFiles: all.filter((f) => f.fieldname !== 'coverImage'),
  };
};

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

// @route POST /api/events — create an event (any authenticated user).
//
// Two ways an event holds its photos:
//   LINK — the organiser pastes a folder/album link they already have. Nothing
//     touches the Drive API, so this works whether or not Drive is connected.
//   DRIVE FOLDER — no link given, so a folder is created for the event and any
//     attached photos are pushed into it. This is the original behaviour and
//     still needs Drive connected.
// A cover image (optional, single file, field `coverImage`) is stored through
// the app's own storage driver either way — it is the tile picture, not an album.
export const createEvent = asyncHandler(async (req, res) => {
  const { name, description, eventDate, location, organization } = req.body;
  if (!name?.trim()) { res.status(400); throw new Error('Event name is required'); }
  const link = String(req.body.link || '').trim();
  if (link && !/^https?:\/\//i.test(link)) { res.status(400); throw new Error('The photos link must start with http:// or https://'); }
  const useDriveFolder = !link;
  if (useDriveFolder) requireDrive(res);

  let orgId = null;
  if (organization) {
    if (!canAccessOrg(req.user, organization)) { res.status(403); throw new Error('Not allowed'); }
    const org = await Organization.findById(organization).select('_id');
    if (org) orgId = org._id;
  }

  const { cover, albumFiles } = splitFiles(req.files);
  const folder = useDriveFolder ? await createEventDriveFolder(name.trim()) : null;

  const photos = [];
  if (folder) {
    for (const file of albumFiles) {
      const uploaded = await uploadEventPhoto(folder.id, file.buffer, file.originalname, file.mimetype);
      photos.push(toPhoto(uploaded));
    }
  }
  const coverUpload = cover
    ? await uploadBuffer(cover.buffer, { folder: 'events', originalName: cover.originalname })
    : null;

  const event = await Event.create({
    name: name.trim(),
    description: description || '',
    driveFolderId: folder?.id || '',
    folderLink: folder?.webViewLink || '',
    link,
    coverImage: coverUpload?.url || '',
    coverImagePublicId: coverUpload?.publicId || '',
    photos,
    eventDate: eventDate ? new Date(eventDate) : undefined,
    location: location || '',
    organization: orgId,
    createdBy: req.user._id,
  });

  logActivity({ user: req.user._id, organization: orgId, action: ACTIVITY_ACTIONS.EVENT_UPDATED, description: `Added event "${event.name}"`, entityType: 'Event', entityId: event._id });
  logPhotographerWork(req, event, `Posted "${event.name}"${photos.length ? ` with ${photos.length} photo${photos.length === 1 ? '' : 's'}` : ''}`);
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
  // Events that point at a pasted link have no folder of ours to add to.
  if (!event.driveFolderId) {
    res.status(400);
    throw new Error('This event keeps its photos at a link, so add them there instead.');
  }

  for (const file of req.files) {
    const uploaded = await uploadEventPhoto(event.driveFolderId, file.buffer, file.originalname, file.mimetype);
    event.photos.push(toPhoto(uploaded));
  }
  await event.save();
  logPhotographerWork(req, event, `Added ${req.files.length} photo${req.files.length === 1 ? '' : 's'} to "${event.name}"`);
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
  if (req.body.link !== undefined) {
    const link = String(req.body.link).trim();
    if (link && !/^https?:\/\//i.test(link)) { res.status(400); throw new Error('The photos link must start with http:// or https://'); }
    // An event has to keep somewhere to open. Clearing the link is fine when a
    // Drive folder was created for it, and refused when it wasn't — otherwise
    // "Open in Drive" would lead nowhere.
    if (!link && !event.driveFolderId) {
      res.status(400);
      throw new Error('This event has no Drive folder, so it needs a photos link.');
    }
    event.link = link;
  }
  // A newly attached cover replaces the old one, which is then cleaned up.
  const { cover } = splitFiles(req.files);
  if (cover) {
    const up = await uploadBuffer(cover.buffer, { folder: 'events', originalName: cover.originalname });
    if (event.coverImagePublicId) await deleteFile(event.coverImagePublicId);
    event.coverImage = up.url;
    event.coverImagePublicId = up.publicId;
  }
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
  // Editing an event stays with whoever created it (canManage above); deleting
  // it — and the Drive folder and cover image that go with it — does not.
  assertCanDeleteOrgItem(req, res, event.organization, 'an event');
  if (event.driveFolderId) await deleteDriveFile(event.driveFolderId);
  if (event.coverImagePublicId) await deleteFile(event.coverImagePublicId);
  await event.deleteOne();
  res.json({ success: true, id: req.params.id });
});
