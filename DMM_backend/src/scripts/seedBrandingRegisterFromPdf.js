import dotenv from 'dotenv';
import mongoose from 'mongoose';
import BrandingRegisterItem from '../models/BrandingRegisterItem.js';

dotenv.config();

const MONGO_URI = process.env.MONGO_URI || 'mongodb://localhost:27017/dmm_platform';

const ROWS = [
  { category: 'BANNER_BOARD', title: 'Board', size: '5 x 8', location: 'Auditorium', organizationName: 'NCET', serialCodes: '001', quantity: 1 },
  { category: 'BANNER_BOARD', title: 'Board', size: '5 x 8', location: 'Library', organizationName: 'NCET', serialCodes: '002', quantity: 1 },
  { category: 'BANNER_BOARD', title: 'Board', size: '5 x 8', location: 'Canteen', organizationName: 'NCET', serialCodes: '003', quantity: 1 },
  { category: 'BANNER_BOARD', title: 'Board', size: '5 x 8', location: 'Civil Block', organizationName: 'NCET', serialCodes: '004', quantity: 1 },
  { category: 'BANNER_BOARD', title: 'Board', size: '5 x 8', location: 'Sports block', organizationName: 'NCET', serialCodes: '05,06,07,08', quantity: 4 },
  { category: 'BANNER_BOARD', title: 'Board', size: '5 x 8', location: 'Canteen', organizationName: 'NCMS', serialCodes: '001', quantity: 1 },
  { category: 'BANNER_BOARD', title: 'Board', size: '5 x 8', location: 'Check post', organizationName: 'NCMS', serialCodes: '002', quantity: 1 },
  { category: 'BANNER_BOARD', title: 'Board', size: '5 x 8', location: 'Parking Area', organizationName: 'NCMS', serialCodes: '003', quantity: 1 },
  { category: 'BANNER_BOARD', title: 'Board', size: '12 x 6', location: 'Infront of NCMS block', organizationName: 'NCMS', serialCodes: '004', quantity: 1 },
  { category: 'BANNER_BOARD', title: 'Board', size: '5 x 8', location: 'Infront of NPUC block', organizationName: 'NPUC', serialCodes: '001', quantity: 1 },
  { category: 'BANNER_BOARD', title: 'Board', size: '5 x 8', location: 'Check Post', organizationName: 'NPUC', serialCodes: '002,003', quantity: 2 },

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

const keyOf = (r) => [
  r.category,
  r.title || '',
  r.size || '',
  r.location || '',
  r.organizationName || '',
  r.assignedTo || '',
  r.deviceType || '',
  r.serialCodes || '',
].join('|');

async function run() {
  await mongoose.connect(MONGO_URI);

  let inserted = 0;
  let skipped = 0;

  for (const row of ROWS) {
    const exists = await BrandingRegisterItem.findOne({
      category: row.category,
      title: row.title,
      size: row.size || '',
      location: row.location || '',
      organizationName: row.organizationName || '',
      assignedTo: row.assignedTo || '',
      deviceType: row.deviceType || '',
      serialCodes: row.serialCodes || '',
    }).select('_id');

    if (exists) {
      skipped += 1;
      continue;
    }

    await BrandingRegisterItem.create(row);
    inserted += 1;
  }

  const docs = await BrandingRegisterItem.find({
    category: { $in: ['FRAME', 'BANNER_BOARD', 'EQUIPMENT'] },
  }).lean();

  const unique = new Set(docs.map(keyOf));
  const counts = {
    frames: docs.filter((d) => d.category === 'FRAME').reduce((s, d) => s + (d.quantity || 0), 0),
    boards: docs.filter((d) => d.category === 'BANNER_BOARD').reduce((s, d) => s + (d.quantity || 0), 0),
    equipment: docs.filter((d) => d.category === 'EQUIPMENT').reduce((s, d) => s + (d.quantity || 0), 0),
  };

  console.log(JSON.stringify({ inserted, skipped, uniqueRows: unique.size, counts }, null, 2));
  await mongoose.disconnect();
}

run().catch(async (err) => {
  console.error(err);
  await mongoose.disconnect();
  process.exit(1);
});
