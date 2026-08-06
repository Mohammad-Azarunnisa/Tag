import dotenv from 'dotenv';
import mongoose from 'mongoose';
import Organization from '../models/Organization.js';
import { getPageToken, getInstagramMetrics, getFacebookMetrics } from '../services/metaService.js';
import { upsertDailySnapshot } from '../services/analyticsSnapshot.js';

dotenv.config();

const MONGO_URI = process.env.MONGO_URI || 'mongodb://localhost:27017/dmm_platform';

async function run() {
  await mongoose.connect(MONGO_URI);
  const orgs = await Organization.find({ isActive: true, $or: [{ metaPageId: { $ne: '' } }, { metaInstagramId: { $ne: '' } }] })
    .select('name metaPageId metaInstagramId')
    .lean();

  const results = [];
  for (const org of orgs) {
    const item = { organization: org.name, instagram: null, facebook: null, errors: [] };
    const pageToken = org.metaPageId ? await getPageToken(org.metaPageId) : null;

    if (org.metaInstagramId) {
      try {
        const metrics = await getInstagramMetrics(org.metaInstagramId, pageToken);
        if (Object.keys(metrics).length) {
          await upsertDailySnapshot(org._id, 'Instagram', metrics);
          item.instagram = Object.keys(metrics);
        }
      } catch (err) {
        item.errors.push(`instagram: ${err.message}`);
      }
    }

    if (org.metaPageId) {
      try {
        const metrics = await getFacebookMetrics(org.metaPageId, pageToken);
        if (Object.keys(metrics).length) {
          await upsertDailySnapshot(org._id, 'Facebook', metrics);
          item.facebook = Object.keys(metrics);
        }
      } catch (err) {
        item.errors.push(`facebook: ${err.message}`);
      }
    }

    results.push(item);
  }

  console.log(JSON.stringify(results, null, 2));
  await mongoose.disconnect();
}

run().catch(async (err) => {
  console.error(err);
  await mongoose.disconnect();
  process.exit(1);
});
