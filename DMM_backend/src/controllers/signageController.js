import asyncHandler from 'express-async-handler';
import SignageLocation from '../models/SignageLocation.js';
import SignageBanner from '../models/SignageBanner.js';
import Organization from '../models/Organization.js';
import Event from '../models/Event.js';
import { uploadBuffer, deleteFile } from '../config/storage.js';
import { logActivity } from '../utils/logActivity.js';
import { accessibleOrgIds, canAccessOrg } from '../utils/org.js';
import { ACTIVITY_ACTIONS, ROLES, SIGNAGE_TYPES, SIGNAGE_LOCATION_STATUS } from '../config/constants.js';

// May this user edit/delete? The creator, any Admin or the org CEO — same
// shared-workspace rule as Events.
const canManage = (user, doc) =>
  String(doc.createdBy) === String(user._id) ||
  user.role === ROLES.ADMIN ||
  user.role === ROLES.CEO;

const num = (v) => { const n = Number(v); return Number.isFinite(n) && n >= 0 ? n : 0; };
const UNITS = ['ft', 'in', 'cm', 'm'];

// Resolve an optional organization id from the form to a verified id (or null).
const resolveOrg = async (organization) => {
  if (!organization) return null;
  const org = await Organization.findById(organization).select('_id');
  return org ? org._id : null;
};

// ---------------------------------------------------------------------------
// Locations — the fixed stands
// ---------------------------------------------------------------------------

// @route GET /api/signage/locations — all stands with their current active
// banner attached + summary counts for the header tiles.
export const listLocations = asyncHandler(async (req, res) => {
  const { search, standType, status, organizationId } = req.query;
  const query = {};
  const allowed = accessibleOrgIds(req.user);
  if (organizationId) {
    if (allowed !== null && !allowed.includes(String(organizationId))) { res.status(403); throw new Error('Not allowed'); }
    query.organization = organizationId;
  } else if (allowed !== null) {
    query.organization = { $in: allowed };
  }
  if (standType && standType !== 'All') query.standType = standType;
  if (status && status !== 'All') query.status = status;
  if (search) query.$or = [
    { code: { $regex: search, $options: 'i' } },
    { place: { $regex: search, $options: 'i' } },
  ];

  const [locations, all] = await Promise.all([
    SignageLocation.find(query)
      .populate('createdBy', 'name avatar')
      .populate('organization', 'name color')
      .sort({ code: 1 })
      .lean(),
    SignageLocation.find(organizationId ? { organization: organizationId } : (allowed !== null ? { organization: { $in: allowed } } : {})).select('status').lean(),
  ]);

  // Attach each stand's current banner (visual + event shown on the card).
  const active = await SignageBanner.find({ location: { $in: locations.map((l) => l._id) }, status: 'ACTIVE' })
    .sort({ installedAt: -1 })
    .lean();
  const byLoc = {};
  for (const b of active) if (!byLoc[b.location]) byLoc[b.location] = b;

  const counts = {
    total: all.length,
    occupied: all.filter((l) => l.status === SIGNAGE_LOCATION_STATUS.OCCUPIED).length,
    empty: all.filter((l) => l.status === SIGNAGE_LOCATION_STATUS.EMPTY).length,
    attention: all.filter((l) => [SIGNAGE_LOCATION_STATUS.NEEDS_REPLACEMENT, SIGNAGE_LOCATION_STATUS.DAMAGED].includes(l.status)).length,
  };

  res.json({
    success: true,
    counts,
    standTypes: SIGNAGE_TYPES,
    locations: locations.map((l) => ({ ...l, currentBanner: byLoc[l._id] || null })),
  });
});

// @route POST /api/signage/locations — add a stand (any authenticated user).
export const createLocation = asyncHandler(async (req, res) => {
  const { code, place, standType, width, height, sizeUnit, notes, organization } = req.body;
  if (!code?.trim()) { res.status(400); throw new Error('A location code is required (e.g. MG-01)'); }
  if (!place?.trim()) { res.status(400); throw new Error('The place is required (e.g. Main Gate)'); }
  if (!SIGNAGE_TYPES.includes(standType)) { res.status(400); throw new Error('Choose a valid stand type'); }

  const clash = await SignageLocation.findOne({ code: new RegExp(`^${code.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i') });
  if (clash) { res.status(400); throw new Error(`Location code "${code.trim()}" already exists (${clash.place})`); }

  const doc = {
    code: code.trim(),
    place: place.trim(),
    standType,
    width: num(width),
    height: num(height),
    sizeUnit: UNITS.includes(sizeUnit) ? sizeUnit : 'ft',
    notes: notes || '',
    organization: await resolveOrg(organization),
    createdBy: req.user._id,
  };

  if (req.file) {
    const up = await uploadBuffer(req.file.buffer, { folder: 'signage', originalName: req.file.originalname });
    doc.photo = up.url;
    doc.photoPublicId = up.publicId;
  }

  const location = await SignageLocation.create(doc);
  logActivity({ user: req.user._id, organization: doc.organization, action: ACTIVITY_ACTIONS.SIGNAGE_UPDATED, description: `Added signage location ${location.code} (${location.place})`, entityType: 'SignageLocation', entityId: location._id });
  const populated = await SignageLocation.findById(location._id).populate('createdBy', 'name avatar').populate('organization', 'name color').lean();
  res.status(201).json({ success: true, location: populated });
});

// @route PUT /api/signage/locations/:id — edit a stand (creator / Admin / CEO).
export const updateLocation = asyncHandler(async (req, res) => {
  const location = await SignageLocation.findById(req.params.id);
  if (!location) { res.status(404); throw new Error('Location not found'); }
  if (!canManage(req.user, location)) { res.status(403); throw new Error('Not allowed to edit this location'); }

  const { code, place, standType, width, height, sizeUnit, notes, organization, status } = req.body;
  if (code !== undefined) {
    if (!code.trim()) { res.status(400); throw new Error('A location code is required'); }
    const clash = await SignageLocation.findOne({ _id: { $ne: location._id }, code: new RegExp(`^${code.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i') });
    if (clash) { res.status(400); throw new Error(`Location code "${code.trim()}" already exists (${clash.place})`); }
    location.code = code.trim();
  }
  if (place !== undefined) { if (!place.trim()) { res.status(400); throw new Error('The place is required'); } location.place = place.trim(); }
  if (standType !== undefined) { if (!SIGNAGE_TYPES.includes(standType)) { res.status(400); throw new Error('Choose a valid stand type'); } location.standType = standType; }
  if (width !== undefined) location.width = num(width);
  if (height !== undefined) location.height = num(height);
  if (sizeUnit !== undefined && UNITS.includes(sizeUnit)) location.sizeUnit = sizeUnit;
  if (notes !== undefined) location.notes = notes;
  if (organization !== undefined) location.organization = await resolveOrg(organization);
  // Manual status flags (NEEDS_REPLACEMENT / DAMAGED) — or back to the automatic
  // OCCUPIED/EMPTY, recomputed from whether an active banner is mounted.
  if (status !== undefined && Object.values(SIGNAGE_LOCATION_STATUS).includes(status)) {
    if (status === SIGNAGE_LOCATION_STATUS.OCCUPIED || status === SIGNAGE_LOCATION_STATUS.EMPTY) {
      const hasActive = await SignageBanner.exists({ location: location._id, status: 'ACTIVE' });
      location.status = hasActive ? SIGNAGE_LOCATION_STATUS.OCCUPIED : SIGNAGE_LOCATION_STATUS.EMPTY;
    } else {
      location.status = status;
    }
  }

  if (req.file) {
    if (location.photoPublicId) await deleteFile(location.photoPublicId);
    const up = await uploadBuffer(req.file.buffer, { folder: 'signage', originalName: req.file.originalname });
    location.photo = up.url;
    location.photoPublicId = up.publicId;
  }

  await location.save();
  const populated = await SignageLocation.findById(location._id).populate('createdBy', 'name avatar').populate('organization', 'name color').lean();
  res.json({ success: true, location: populated });
});

// @route DELETE /api/signage/locations/:id — remove a stand AND its banner history.
export const deleteLocation = asyncHandler(async (req, res) => {
  const location = await SignageLocation.findById(req.params.id);
  if (!location) { res.status(404); throw new Error('Location not found'); }
  if (!canManage(req.user, location)) { res.status(403); throw new Error('Not allowed to delete this location'); }

  const banners = await SignageBanner.find({ location: location._id }).lean();
  const files = [location.photoPublicId];
  for (const b of banners) files.push(b.previewPublicId, b.sourcePublicId, b.photoPublicId);
  await Promise.all(files.filter(Boolean).map((id) => deleteFile(id)));
  await SignageBanner.deleteMany({ location: location._id });
  await location.deleteOne();

  logActivity({ user: req.user._id, organization: location.organization, action: ACTIVITY_ACTIONS.SIGNAGE_UPDATED, description: `Deleted signage location ${location.code} and ${banners.length} banner record(s)`, entityType: 'SignageLocation', entityId: location._id });
  res.json({ success: true, id: req.params.id });
});

// ---------------------------------------------------------------------------
// Banners — what's mounted on a stand (history included)
// ---------------------------------------------------------------------------

// Read the three optional upload slots from upload.fields().
const filesOf = (req, name) => (req.files && req.files[name]) || [];

// Preview/photo must be images the browser can render; source may be PSD/PDF/AI/image.
const IMAGE_ONLY = /^image\/(png|jpe?g|webp|gif|svg\+xml)$/i;

const uploadSlot = async (file, doc, urlKey, idKey) => {
  const up = await uploadBuffer(file.buffer, { folder: 'signage', originalName: file.originalname });
  doc[urlKey] = up.url;
  doc[idKey] = up.publicId;
};

// @route GET /api/signage/banners — history list. ?locationId gives one stand's
// timeline (newest first); ?search/?status/?eventName filter across all stands.
export const listBanners = asyncHandler(async (req, res) => {
  const { locationId, search, status } = req.query;
  const query = {};
  if (locationId) query.location = locationId;
  if (status && status !== 'All') query.status = status;
  if (search) query.$or = [
    { title: { $regex: search, $options: 'i' } },
    { eventName: { $regex: search, $options: 'i' } },
  ];
  const banners = await SignageBanner.find(query)
    .populate('location', 'code place standType width height sizeUnit')
    .populate('createdBy', 'name avatar')
    .sort({ installedAt: -1, createdAt: -1 })
    .lean();
  res.json({ success: true, count: banners.length, banners });
});

// @route POST /api/signage/banners — mount a banner on a stand. If the stand is
// occupied, the current banner is auto-retired (that's the change history).
export const createBanner = asyncHandler(async (req, res) => {
  const { location: locationId, title, eventName, event, width, height, sizeUnit, installedAt, notes } = req.body;
  if (!title?.trim()) { res.status(400); throw new Error('A banner title is required'); }
  const location = await SignageLocation.findById(locationId);
  if (!location) { res.status(400); throw new Error('Choose the stand this banner goes on'); }

  const preview = filesOf(req, 'preview')[0];
  const source = filesOf(req, 'source')[0];
  const photo = filesOf(req, 'photo')[0];
  if (preview && !IMAGE_ONLY.test(preview.mimetype)) { res.status(400); throw new Error('The preview must be an image (JPG/PNG) — put the PSD/PDF in the design file slot'); }
  if (photo && !IMAGE_ONLY.test(photo.mimetype)) { res.status(400); throw new Error('The installed photo must be an image (JPG/PNG)'); }

  const doc = {
    location: location._id,
    title: title.trim(),
    eventName: (eventName || '').trim(),
    // Size defaults to the stand's fixed frame.
    width: width !== undefined && width !== '' ? num(width) : location.width,
    height: height !== undefined && height !== '' ? num(height) : location.height,
    sizeUnit: UNITS.includes(sizeUnit) ? sizeUnit : location.sizeUnit,
    installedAt: installedAt ? new Date(installedAt) : new Date(),
    notes: notes || '',
    createdBy: req.user._id,
  };
  if (event) {
    const ev = await Event.findById(event).select('_id name');
    if (ev) { doc.event = ev._id; if (!doc.eventName) doc.eventName = ev.name; }
  }

  if (preview) await uploadSlot(preview, doc, 'preview', 'previewPublicId');
  if (source) { await uploadSlot(source, doc, 'source', 'sourcePublicId'); doc.sourceName = source.originalname; }
  if (photo) await uploadSlot(photo, doc, 'photo', 'photoPublicId');

  // Retire whatever is currently on the stand — this is what builds the history.
  await SignageBanner.updateMany(
    { location: location._id, status: 'ACTIVE' },
    { $set: { status: 'REMOVED', removedAt: doc.installedAt } }
  );

  const banner = await SignageBanner.create(doc);
  // Manual damage flags survive a banner change only if the admin re-flags;
  // a fresh banner means the spot is occupied again.
  location.status = SIGNAGE_LOCATION_STATUS.OCCUPIED;
  await location.save();

  logActivity({ user: req.user._id, organization: location.organization, action: ACTIVITY_ACTIONS.SIGNAGE_UPDATED, description: `Placed banner "${banner.title}" on ${location.code} (${location.place})${banner.eventName ? ` for ${banner.eventName}` : ''}`, entityType: 'SignageBanner', entityId: banner._id });
  const populated = await SignageBanner.findById(banner._id).populate('location', 'code place standType').populate('createdBy', 'name avatar').lean();
  res.status(201).json({ success: true, banner: populated });
});

// @route PUT /api/signage/banners/:id — edit a banner record (creator / Admin / CEO).
export const updateBanner = asyncHandler(async (req, res) => {
  const banner = await SignageBanner.findById(req.params.id);
  if (!banner) { res.status(404); throw new Error('Banner not found'); }
  if (!canManage(req.user, banner)) { res.status(403); throw new Error('Not allowed to edit this banner'); }

  const { title, eventName, event, width, height, sizeUnit, installedAt, notes } = req.body;
  if (title !== undefined) { if (!title.trim()) { res.status(400); throw new Error('A banner title is required'); } banner.title = title.trim(); }
  if (eventName !== undefined) banner.eventName = eventName.trim();
  if (event !== undefined) {
    if (!event) banner.event = null;
    else { const ev = await Event.findById(event).select('_id name'); if (ev) { banner.event = ev._id; if (!banner.eventName) banner.eventName = ev.name; } }
  }
  if (width !== undefined) banner.width = num(width);
  if (height !== undefined) banner.height = num(height);
  if (sizeUnit !== undefined && UNITS.includes(sizeUnit)) banner.sizeUnit = sizeUnit;
  if (installedAt !== undefined && installedAt) banner.installedAt = new Date(installedAt);
  if (notes !== undefined) banner.notes = notes;

  const preview = filesOf(req, 'preview')[0];
  const source = filesOf(req, 'source')[0];
  const photo = filesOf(req, 'photo')[0];
  if (preview && !IMAGE_ONLY.test(preview.mimetype)) { res.status(400); throw new Error('The preview must be an image (JPG/PNG)'); }
  if (photo && !IMAGE_ONLY.test(photo.mimetype)) { res.status(400); throw new Error('The installed photo must be an image (JPG/PNG)'); }
  if (preview) { if (banner.previewPublicId) await deleteFile(banner.previewPublicId); await uploadSlot(preview, banner, 'preview', 'previewPublicId'); }
  if (source) { if (banner.sourcePublicId) await deleteFile(banner.sourcePublicId); await uploadSlot(source, banner, 'source', 'sourcePublicId'); banner.sourceName = source.originalname; }
  if (photo) { if (banner.photoPublicId) await deleteFile(banner.photoPublicId); await uploadSlot(photo, banner, 'photo', 'photoPublicId'); }

  await banner.save();
  const populated = await SignageBanner.findById(banner._id).populate('location', 'code place standType').populate('createdBy', 'name avatar').lean();
  res.json({ success: true, banner: populated });
});

// @route PUT /api/signage/banners/:id/remove — the banner came down (no replacement).
export const removeBanner = asyncHandler(async (req, res) => {
  const banner = await SignageBanner.findById(req.params.id);
  if (!banner) { res.status(404); throw new Error('Banner not found'); }
  if (!canManage(req.user, banner)) { res.status(403); throw new Error('Not allowed to update this banner'); }
  if (banner.status !== 'ACTIVE') { res.status(400); throw new Error('This banner is already removed'); }

  banner.status = 'REMOVED';
  banner.removedAt = new Date();
  await banner.save();

  // The stand is empty now unless another active banner exists (shouldn't, but stay safe).
  const location = await SignageLocation.findById(banner.location);
  if (location) {
    const hasActive = await SignageBanner.exists({ location: location._id, status: 'ACTIVE' });
    if (!hasActive && location.status === SIGNAGE_LOCATION_STATUS.OCCUPIED) {
      location.status = SIGNAGE_LOCATION_STATUS.EMPTY;
      await location.save();
    }
    logActivity({ user: req.user._id, organization: location.organization, action: ACTIVITY_ACTIONS.SIGNAGE_UPDATED, description: `Removed banner "${banner.title}" from ${location.code} (${location.place})`, entityType: 'SignageBanner', entityId: banner._id });
  }
  res.json({ success: true, banner });
});

// @route DELETE /api/signage/banners/:id — erase a banner record + its files.
export const deleteBanner = asyncHandler(async (req, res) => {
  const banner = await SignageBanner.findById(req.params.id);
  if (!banner) { res.status(404); throw new Error('Banner not found'); }
  if (!canManage(req.user, banner)) { res.status(403); throw new Error('Not allowed to delete this banner'); }

  await Promise.all([banner.previewPublicId, banner.sourcePublicId, banner.photoPublicId].filter(Boolean).map((id) => deleteFile(id)));
  const wasActive = banner.status === 'ACTIVE';
  await banner.deleteOne();

  if (wasActive) {
    const location = await SignageLocation.findById(banner.location);
    if (location && location.status === SIGNAGE_LOCATION_STATUS.OCCUPIED) {
      const hasActive = await SignageBanner.exists({ location: location._id, status: 'ACTIVE' });
      if (!hasActive) { location.status = SIGNAGE_LOCATION_STATUS.EMPTY; await location.save(); }
    }
  }
  res.json({ success: true, id: req.params.id });
});
