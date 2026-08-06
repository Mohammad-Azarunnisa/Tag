import 'dotenv/config';
import mongoose from 'mongoose';
import connectDB from '../config/db.js';
import { refreshDailyAnalytics } from '../services/dailyAnalyticsRefresh.js';

async function run() {
  await connectDB();
  const result = await refreshDailyAnalytics();
  console.log(JSON.stringify(result, null, 2));
  await mongoose.disconnect();
}

run().catch(async (err) => {
  console.error(err);
  await mongoose.disconnect();
  process.exit(1);
});
