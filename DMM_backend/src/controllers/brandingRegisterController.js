import asyncHandler from 'express-async-handler';
import BrandingRegisterItem, { CATEGORY_VALUES } from '../models/BrandingRegisterItem.js';
import SignageLocation from '../models/SignageLocation.js';

const clean = (v) => String(v || '').trim();
const toNumber = (v, fallback = 0) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
};

const DEFAULT_SEED_ROWS = [
  { category: 'BANNER_BOARD', title: 'Board', size: "5 x 8", location: 'Auditorium', organizationName: 'NCET', serialCodes: '001', quantity: 1 },
  { category: 'BANNER_BOARD', title: 'Board', size: "5 x 8", location: 'Library', organizationName: 'NCET', serialCodes: '002', quantity: 1 },
  { category: 'BANNER_BOARD', title: 'Board', size: "5 x 8", location: 'Canteen', organizationName: 'NCET', serialCodes: '003', quantity: 1 },
  { category: 'BANNER_BOARD', title: 'Board', size: "5 x 8", location: 'Civil Block', organizationName: 'NCET', serialCodes: '004', quantity: 1 },
  { category: 'BANNER_BOARD', title: 'Board', size: "5 x 8", location: 'Sports block', organizationName: 'NCET', serialCodes: '05,06,07,08', quantity: 4 },
  { category: 'BANNER_BOARD', title: 'Board', size: "5 x 8", location: 'Canteen', organizationName: 'NCMS', serialCodes: '001', quantity: 1 },
  { category: 'BANNER_BOARD', title: 'Board', size: "5 x 8", location: 'Check post', organizationName: 'NCMS', serialCodes: '002', quantity: 1 },
  { category: 'BANNER_BOARD', title: 'Board', size: "5 x 8", location: 'Parking Area', organizationName: 'NCMS', serialCodes: '003', quantity: 1 },
  { category: 'BANNER_BOARD', title: 'Board', size: "12 x 6", location: 'Infront of NCMS block', organizationName: 'NCMS', serialCodes: '004', quantity: 1 },
  { category: 'BANNER_BOARD', title: 'Board', size: "5 x 8", location: 'Infront of NPUC block', organizationName: 'NPUC', serialCodes: '001', quantity: 1 },
  { category: 'BANNER_BOARD', title: 'Board', size: "5 x 8", location: 'Check Post', organizationName: 'NPUC', serialCodes: '002,003', quantity: 2 },

  { category: 'FRAME', title: 'Arch Beam', size: '15 x 12', quantity: 1 },
  { category: 'FRAME', title: 'Arch Pillar', size: '10 x 2', quantity: 2 },
  { category: 'FRAME', title: 'Frame', size: '8 x 16', quantity: 4 },
  { category: 'FRAME', title: 'Frame', size: '8 x 10', quantity: 2 },
  { category: 'FRAME', title: 'Selfie booth', size: '8 x 6', quantity: 1 },
  { category: 'FRAME', title: 'Selfie booth', size: '8 x 4', quantity: 1 },
  { category: 'FRAME', title: 'Frame', size: '8 x 12', quantity: 1 },

  {
    category: 'EQUIPMENT',
    title: 'HP Z1 G9 Tower Desktop PC',
    assignedTo: 'Dileep',
    deviceType: 'Desktop',
    quantity: 1,
    specs: 'Intel Core i7-14700, 16 GB RAM, RTX 3060 12GB, 2.29 TB storage, Windows 11',
    notes: 'Serial: 1N145109TH | Device: DESKTOP-9PHNRUK',
  },
  {
    category: 'EQUIPMENT',
    title: 'HP Z1 G9 Tower Desktop PC',
    assignedTo: 'Asha',
    deviceType: 'Desktop',
    quantity: 1,
    specs: 'Intel Core i7-14700, 16 GB RAM, RTX 3060 12GB, 2.29 TB storage, Windows 11',
    notes: 'Serial: 1N145109TJ | Device: DESKTOP-0GUPAQR',
  },
  {
    category: 'EQUIPMENT',
    title: 'Dell Latitude 3450',
    assignedTo: 'Shishira Rao',
    deviceType: 'Laptop',
    quantity: 1,
    specs: '13th Gen Intel Core i7-1355U, 16 GB RAM, Intel UHD Graphics, Windows 11 Pro',
    notes: 'Computer name: SHISHIRA | Serial/service tag to be captured',
  },
  {
    category: 'EQUIPMENT',
    title: 'Custom-build Desktop (MSI MS-7D48)',
    assignedTo: 'Sathish',
    deviceType: 'Desktop',
    quantity: 1,
    specs: '12th Gen Intel Core i7-12700F, 32 GB RAM, discrete GPU installed, Windows 11 Pro',
    notes: 'GPU model and chassis serial to be captured',
  },
  {
    category: 'EQUIPMENT',
    title: 'HP Ink Tank 410 WiFi Colour Printer',
    assignedTo: 'Branding Team',
    deviceType: 'Peripheral',
    quantity: 1,
    specs: 'Print, Scan, Copy',
  },
  {
    category: 'EQUIPMENT',
    title: 'External Monitor',
    assignedTo: 'Branding Team',
    deviceType: 'Peripheral',
    quantity: 1,
    specs: 'Secondary display running on Intel UHD Graphics',
    notes: 'Make/model and host machine pending',
  },
  {
    category: 'EQUIPMENT',
    title: 'Adobe Creative Cloud Pro - Licence 1',
    assignedTo: 'To be assigned',
    deviceType: 'Software Licence',
    quantity: 1,
    annualCost: 30656.4,
    renewalDate: new Date('2027-06-17'),
    specs: 'Product #30004845 | Invoice 3491984898 | Service term 18-Jun-2026 to 17-Jun-2027',
  },
  {
    category: 'EQUIPMENT',
    title: 'Adobe Creative Cloud Pro - Licence 2',
    assignedTo: 'To be assigned',
    deviceType: 'Software Licence',
    quantity: 1,
    annualCost: 30656.4,
    renewalDate: new Date('2027-06-17'),
    specs: 'Product #30004845 | Invoice 3492450784 | Service term 18-Jun-2026 to 17-Jun-2027',
  },
  {
    category: 'EQUIPMENT',
    title: 'Magnific Premium+',
    assignedTo: 'To be assigned',
    deviceType: 'Software Licence',
    quantity: 1,
    annualCost: 27000,
    renewalDate: new Date('2026-10-27'),
    specs: 'Annual Premium+ plan',
  },
];

export const listBrandingRegister = asyncHandler(async (req, res) => {
  const { category = 'All', search = '' } = req.query;
  const query = {};
  if (category !== 'All') query.category = category;
  if (search) {
    query.$or = [
      { title: { $regex: search, $options: 'i' } },
      { size: { $regex: search, $options: 'i' } },
      { location: { $regex: search, $options: 'i' } },
      { organizationName: { $regex: search, $options: 'i' } },
      { serialCodes: { $regex: search, $options: 'i' } },
      { assignedTo: { $regex: search, $options: 'i' } },
      { deviceType: { $regex: search, $options: 'i' } },
      { specs: { $regex: search, $options: 'i' } },
      { notes: { $regex: search, $options: 'i' } },
    ];
  }

  const [items, totalRows] = await Promise.all([
    BrandingRegisterItem.find(query)
      .sort({ category: 1, createdAt: -1 })
      .populate('createdBy', 'name email')
      .populate('signageLocation', 'code place standType')
      .lean(),
    BrandingRegisterItem.find({ category: { $in: CATEGORY_VALUES } }).select('category quantity').lean(),
  ]);

  const totals = {
    FRAME: totalRows.filter((x) => x.category === 'FRAME').reduce((s, x) => s + (x.quantity || 0), 0),
    BANNER_BOARD: totalRows.filter((x) => x.category === 'BANNER_BOARD').reduce((s, x) => s + (x.quantity || 0), 0),
    EQUIPMENT: totalRows.filter((x) => x.category === 'EQUIPMENT').reduce((s, x) => s + (x.quantity || 0), 0),
  };

  res.json({ success: true, categories: CATEGORY_VALUES, totals, items });
});

export const createBrandingRegisterItem = asyncHandler(async (req, res) => {
  let signageLocation = null;
  if (req.body.signageLocation) {
    const loc = await SignageLocation.findById(req.body.signageLocation).select('_id');
    if (!loc) {
      res.status(400);
      throw new Error('Invalid signage location');
    }
    signageLocation = loc._id;
  }

  const payload = {
    category: clean(req.body.category),
    title: clean(req.body.title),
    size: clean(req.body.size),
    quantity: toNumber(req.body.quantity, 1),
    location: clean(req.body.location),
    signageLocation,
    organizationName: clean(req.body.organizationName),
    serialCodes: clean(req.body.serialCodes),
    assignedTo: clean(req.body.assignedTo),
    deviceType: clean(req.body.deviceType),
    specs: clean(req.body.specs),
    annualCost: toNumber(req.body.annualCost, 0),
    notes: clean(req.body.notes),
    createdBy: req.user._id,
  };

  if (!CATEGORY_VALUES.includes(payload.category)) {
    res.status(400);
    throw new Error('Invalid category');
  }
  if (!payload.title) {
    res.status(400);
    throw new Error('Title is required');
  }

  if (req.body.renewalDate) {
    const date = new Date(req.body.renewalDate);
    if (!Number.isNaN(date.getTime())) payload.renewalDate = date;
  }

  const item = await BrandingRegisterItem.create(payload);
  res.status(201).json({ success: true, item });
});

export const updateBrandingRegisterItem = asyncHandler(async (req, res) => {
  const item = await BrandingRegisterItem.findById(req.params.id);
  if (!item) {
    res.status(404);
    throw new Error('Item not found');
  }

  const payload = {
    category: clean(req.body.category || item.category),
    title: clean(req.body.title),
    size: clean(req.body.size),
    quantity: toNumber(req.body.quantity, 1),
    location: clean(req.body.location),
    organizationName: clean(req.body.organizationName),
    serialCodes: clean(req.body.serialCodes),
    assignedTo: clean(req.body.assignedTo),
    deviceType: clean(req.body.deviceType),
    specs: clean(req.body.specs),
    annualCost: toNumber(req.body.annualCost, 0),
    notes: clean(req.body.notes),
  };

  if (!CATEGORY_VALUES.includes(payload.category)) {
    res.status(400);
    throw new Error('Invalid category');
  }
  if (!payload.title) {
    res.status(400);
    throw new Error('Title is required');
  }

  let signageLocation = null;
  if (req.body.signageLocation) {
    const loc = await SignageLocation.findById(req.body.signageLocation).select('_id');
    if (!loc) {
      res.status(400);
      throw new Error('Invalid signage location');
    }
    signageLocation = loc._id;
  }

  payload.renewalDate = undefined;
  if (req.body.renewalDate) {
    const date = new Date(req.body.renewalDate);
    if (!Number.isNaN(date.getTime())) payload.renewalDate = date;
  }

  item.category = payload.category;
  item.title = payload.title;
  item.size = payload.size;
  item.quantity = payload.quantity;
  item.location = payload.location;
  item.signageLocation = signageLocation;
  item.organizationName = payload.organizationName;
  item.serialCodes = payload.serialCodes;
  item.assignedTo = payload.assignedTo;
  item.deviceType = payload.deviceType;
  item.specs = payload.specs;
  item.annualCost = payload.annualCost;
  item.notes = payload.notes;
  item.renewalDate = payload.renewalDate;

  await item.save();
  const populated = await BrandingRegisterItem.findById(item._id)
    .populate('createdBy', 'name email')
    .populate('signageLocation', 'code place standType')
    .lean();
  res.json({ success: true, item: populated });
});

export const deleteBrandingRegisterItem = asyncHandler(async (req, res) => {
  const item = await BrandingRegisterItem.findById(req.params.id);
  if (!item) {
    res.status(404);
    throw new Error('Item not found');
  }
  await item.deleteOne();
  res.json({ success: true, id: req.params.id });
});

export const seedBrandingRegister = asyncHandler(async (req, res) => {
  let inserted = 0;
  for (const row of DEFAULT_SEED_ROWS) {
    const exists = await BrandingRegisterItem.exists({
      category: row.category,
      title: row.title,
      size: row.size || '',
      location: row.location || '',
      organizationName: row.organizationName || '',
      assignedTo: row.assignedTo || '',
      deviceType: row.deviceType || '',
    });
    if (exists) continue;
    await BrandingRegisterItem.create({ ...row, createdBy: req.user._id });
    inserted += 1;
  }
  res.json({ success: true, inserted });
});
