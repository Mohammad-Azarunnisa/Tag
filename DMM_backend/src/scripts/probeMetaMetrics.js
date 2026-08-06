import dotenv from 'dotenv';
import mongoose from 'mongoose';
import Organization from '../models/Organization.js';
import { probe, listAccounts, getPageToken, getInstagramMetrics, getFacebookMetrics } from '../services/metaService.js';

dotenv.config();

const MONGO_URI = process.env.MONGO_URI || 'mongodb://localhost:27017/dmm_platform';

async function run() {
  await mongoose.connect(MONGO_URI);

  const identity = await probe();
  const accounts = await listAccounts();
  const orgs = await Organization.find({ isActive: true, $or: [{ metaPageId: { $ne: '' } }, { metaInstagramId: { $ne: '' } }] })
    .select('name metaPageId metaPageName metaInstagramId metaInstagramUsername')
    .lean();

  const out = {
    identity: { name: identity.name, scopes: identity.scopes || [] },
    accountsVisible: accounts.length,
    mappedOrganizations: [],
  };

  for (const org of orgs.slice(0, 10)) {
    const row = {
      organization: org.name,
      page: org.metaPageName || org.metaPageId || null,
      instagram: org.metaInstagramUsername || org.metaInstagramId || null,
      facebookMetrics: null,
      instagramMetrics: null,
      errors: [],
    };

    const pageToken = org.metaPageId ? await getPageToken(org.metaPageId) : null;

    if (org.metaPageId) {
      try {
        row.facebookMetrics = await getFacebookMetrics(org.metaPageId, pageToken);
      } catch (err) {
        row.errors.push(`facebook: ${err.message}`);
      }
    }

    if (org.metaInstagramId) {
      try {
        row.instagramMetrics = await getInstagramMetrics(org.metaInstagramId, pageToken);
      } catch (err) {
        row.errors.push(`instagram: ${err.message}`);
      }
    }

    out.mappedOrganizations.push(row);
  }

  console.log(JSON.stringify(out, null, 2));
  await mongoose.disconnect();
}

run().catch(async (err) => {
  console.error(err);
  await mongoose.disconnect();
  process.exit(1);
});
