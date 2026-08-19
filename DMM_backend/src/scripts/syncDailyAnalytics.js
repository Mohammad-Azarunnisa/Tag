import 'dotenv/config';
import mongoose from 'mongoose';
import connectDB from '../config/db.js';
import { runRecordedSync } from '../services/dailyAnalyticsRefresh.js';

async function run() {
  await connectDB();
  // Goes through the recorded path, not refreshDailyAnalytics() directly, so a
  // hand-run sync lands in the SyncRun log like the scheduled one — otherwise the
  // history would show a gap on a day that was actually synced by hand. `force`
  // because someone running this deliberately means it.
  const result = await runRecordedSync({ trigger: 'manual', force: true });
  console.log(JSON.stringify(result, null, 2));
  await mongoose.disconnect();
}

run().catch(async (err) => {
  console.error(err);
  await mongoose.disconnect();
  process.exit(1);
});
