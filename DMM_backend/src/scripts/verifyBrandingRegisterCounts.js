import dotenv from 'dotenv';
import mongoose from 'mongoose';
import BrandingRegisterItem from '../models/BrandingRegisterItem.js';

dotenv.config();

const MONGO_URI = process.env.MONGO_URI || 'mongodb://localhost:27017/dmm_platform';

async function run() {
  await mongoose.connect(MONGO_URI);

  const docs = await BrandingRegisterItem.find({
    category: { $in: ['FRAME', 'BANNER_BOARD', 'EQUIPMENT'] },
  }).lean();

  const counts = {
    rows: docs.length,
    frames: docs.filter((d) => d.category === 'FRAME').reduce((s, d) => s + (d.quantity || 0), 0),
    boards: docs.filter((d) => d.category === 'BANNER_BOARD').reduce((s, d) => s + (d.quantity || 0), 0),
    equipment: docs.filter((d) => d.category === 'EQUIPMENT').reduce((s, d) => s + (d.quantity || 0), 0),
  };

  console.log(JSON.stringify(counts, null, 2));
  await mongoose.disconnect();
}

run().catch(async (err) => {
  console.error(err);
  await mongoose.disconnect();
  process.exit(1);
});
