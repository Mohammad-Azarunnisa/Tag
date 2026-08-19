// Load environment variables before any other module is evaluated, so config
// read at import time (e.g. CORS allowlist) sees the correct values.
import 'dotenv/config';

import mongoose from 'mongoose';
import app from './app.js';
import connectDB from './config/db.js';
import { seedSuperAdmin } from './config/seedSuperAdmin.js';
import { ensureStorageReady } from './config/storage.js';
import { startDailyAnalyticsScheduler, catchUpIfMissed } from './services/dailyAnalyticsRefresh.js';
import { startScheduledPostWatcher } from './services/scheduledPosts.js';
import { provider as aiProvider, modelName as aiModel } from './services/aiService.js';
import { startMonthlyReportScheduler } from './services/monthlyReport.js';

const PORT = process.env.PORT || 5000;

const start = async () => {
  await connectDB();
  await seedSuperAdmin();
  const storage = ensureStorageReady();
  const server = app.listen(PORT, () => {
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
    // The scheduler is a timer in this process, so a day when the server was
    // down or mid-deploy at that minute is simply skipped — and those readings
    // cannot be fetched afterwards, because the platform APIs only report
    // current totals. Asking on every boot whether today has run yet, and
    // running it when it has not, is what keeps the history free of holes.
    // Deliberately not awaited: a slow platform API must not hold up the server.
    catchUpIfMissed();
  }

  // Let in-flight requests finish and close the DB connection cleanly on
  // deploy/restart, instead of the process being killed mid-request.
  const shutdown = (signal) => {
    console.log(`\n${signal} received: closing server...`);
    server.close(async () => {
      await mongoose.connection.close();
      console.log('Server and MongoDB connection closed.');
      process.exit(0);
    });
    // Force-exit if something keeps a connection open past a reasonable window.
    setTimeout(() => process.exit(1), 10_000).unref();
  };
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
};

// A failure anywhere in start() — after connectDB's own process.exit(1) guard,
// this covers seeding, storage setup, and the schedulers — must be logged
// loudly and exit, not disappear as a silent unhandled rejection.
start().catch((err) => {
  console.error('❌ Failed to start server:', err);
  process.exit(1);
});
