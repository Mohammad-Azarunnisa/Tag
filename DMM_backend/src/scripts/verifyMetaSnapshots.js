import dotenv from 'dotenv';
import mongoose from 'mongoose';
import Analytics from '../models/Analytics.js';
import Organization from '../models/Organization.js';

dotenv.config();

const MONGO_URI = process.env.MONGO_URI || 'mongodb://localhost:27017/dmm_platform';

async function run() {
  await mongoose.connect(MONGO_URI);
  const orgs = await Organization.find({ isActive: true }).select('name').lean();
  const report = [];
  for (const org of orgs) {
    const [facebook, instagram] = await Promise.all([
      Analytics.findOne({ organization: org._id, platform: 'Facebook' }).sort({ date: -1 }).lean(),
      Analytics.findOne({ organization: org._id, platform: 'Instagram' }).sort({ date: -1 }).lean(),
    ]);
    if (!facebook && !instagram) continue;
    report.push({
      organization: org.name,
      facebook: facebook ? {
        date: facebook.date,
        followers: facebook.followers,
        interactions: facebook.interactions,
        newFollowers: facebook.newFollowers,
        visits: facebook.visits,
        reach: facebook.reach,
        views: facebook.views,
        linkClicks: facebook.linkClicks,
      } : null,
      instagram: instagram ? {
        date: instagram.date,
        followers: instagram.followers,
        reach: instagram.reach,
        views: instagram.views,
        interactions: instagram.interactions,
        impressions: instagram.impressions,
        pageViews: instagram.pageViews,
        linkClicks: instagram.linkClicks,
      } : null,
    });
  }
  console.log(JSON.stringify(report, null, 2));
  await mongoose.disconnect();
}

run().catch(async (err) => {
  console.error(err);
  await mongoose.disconnect();
  process.exit(1);
});
