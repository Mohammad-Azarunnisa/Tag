// Load environment variables before any other module is evaluated, so config
// read at import time (e.g. CORS allowlist) sees the correct values.
import 'dotenv/config';

import app from './app.js';
import connectDB from './config/db.js';
import { seedSuperAdmin } from './config/seedSuperAdmin.js';
import { ensureStorageReady } from './config/storage.js';
import { startDailyAnalyticsScheduler } from './services/dailyAnalyticsRefresh.js';
import { startScheduledPostWatcher } from './services/scheduledPosts.js';
import { provider as aiProvider, modelName as aiModel } from './services/aiService.js';
import { startMonthlyReportScheduler } from './services/monthlyReport.js';

const PORT = process.env.PORT || 5000;

const start = async () => {
  await connectDB();
  await seedSuperAdmin();
  const storage = ensureStorageReady();
  app.listen(PORT, () => {
    console.log(`🚀 DMM backend running on http://localhost:${PORT} (${process.env.NODE_ENV})`);
    console.log(`   Storage driver: ${process.env.STORAGE_DRIVER || 'local'}${storage.root ? ` · root: ${storage.root}` : ''}`);
    // Whether Tago can answer at all, visible without having to sign in.
    const ai = aiProvider();
    console.log(ai
      ? `   Tago AI: ${ai} · ${aiModel()}`
      : '   Tago AI: not configured (set OPENAI_API_KEY in .env)');
  });
  startScheduledPostWatcher();
  console.log('   Scheduled posts: sweeping for content due to go live');
  if (process.env.DISABLE_MONTHLY_REPORT !== 'true') {
    const when = startMonthlyReportScheduler();
    console.log(`   Monthly report: day ${when.day} at ${when.time} UTC, to every super admin`);
  }
  if (process.env.DISABLE_DAILY_ANALYTICS_REFRESH !== 'true') {
    startDailyAnalyticsScheduler();
    console.log(`   Daily analytics refresh scheduled at ${process.env.DAILY_ANALYTICS_REFRESH_TIME || '02:00'} UTC`);
  }
};

start();
