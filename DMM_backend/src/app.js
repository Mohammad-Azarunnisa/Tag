import express from 'express';
import cors from 'cors';
import morgan from 'morgan';
import path from 'path';
import { fileURLToPath } from 'url';

import { UPLOAD_ROOT } from './config/storage.js';
import { notFound, errorHandler } from './middleware/error.js';
import authRoutes from './routes/authRoutes.js';
import userRoutes from './routes/userRoutes.js';
import templateRoutes from './routes/templateRoutes.js';
import assetRoutes from './routes/assetRoutes.js';
import approvalRoutes from './routes/approvalRoutes.js';
import notificationRoutes from './routes/notificationRoutes.js';
import dashboardRoutes from './routes/dashboardRoutes.js';
import reportRoutes from './routes/reportRoutes.js';
import activityRoutes from './routes/activityRoutes.js';
import searchRoutes from './routes/searchRoutes.js';
import analyticsRoutes from './routes/analyticsRoutes.js';
import competitorRoutes from './routes/competitorRoutes.js';
import purchaseRoutes from './routes/purchaseRoutes.js';
import brandAssetRoutes from './routes/brandAssetRoutes.js';
import socialAccountRoutes from './routes/socialAccountRoutes.js';
import websiteRoutes from './routes/websiteRoutes.js';
import organizationRoutes from './routes/organizationRoutes.js';
import calendarRoutes from './routes/calendarRoutes.js';
import metaRoutes from './routes/metaRoutes.js';
import eventRoutes from './routes/eventRoutes.js';
import signageRoutes from './routes/signageRoutes.js';
import youtubeRoutes from './routes/youtubeRoutes.js';
import linkRoutes from './routes/linkRoutes.js';
import goalRoutes from './routes/goalRoutes.js';
import planRoutes from './routes/planRoutes.js';
import aiRoutes from './routes/aiRoutes.js';
import linkedinRoutes from './routes/linkedinRoutes.js';
import socialPostRoutes from './routes/socialPostRoutes.js';
import workAssignmentRoutes from './routes/workAssignmentRoutes.js';
import institutionRequestRoutes from './routes/institutionRequestRoutes.js';
import webTaskRoutes from './routes/webTaskRoutes.js';
import adCampaignRoutes from './routes/adCampaignRoutes.js';
import brandingRegisterRoutes from './routes/brandingRegisterRoutes.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const app = express();

// CORS allowlist is evaluated per-request (not at import time) so it always
// reflects the current CLIENT_URL, and echoes the specific allowed origin
// (required when credentials are enabled). If CLIENT_URL is unset, allow all.
app.use(
  cors({
    origin: (origin, cb) => {
      const allowed = (process.env.CLIENT_URL || '')
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);
      if (!origin || allowed.length === 0 || allowed.includes(origin)) return cb(null, true);
      return cb(new Error(`Origin ${origin} not allowed by CORS`));
    },
    credentials: true,
  })
);
// Generous body limits for JSON/form payloads. NOTE: file uploads do NOT flow
// through these — they are multipart/form-data handled by multer (see
// middleware/upload.js), which has no size cap. These limits only affect
// regular JSON/form request bodies (users, goals, plans, AI content, etc.).
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));
if (process.env.NODE_ENV !== 'production') app.use(morgan('dev'));

// Serve locally-stored uploads from the configured storage root (local `uploads`
// folder in dev, or the mounted volume like /mnt/tag-storage in production).
app.use('/uploads', express.static(UPLOAD_ROOT));

app.get('/api/health', (req, res) =>
  res.json({ success: true, status: 'ok', service: 'dmm-backend', time: new Date().toISOString() })
);

app.use('/api/auth', authRoutes);
app.use('/api/users', userRoutes);
app.use('/api/templates', templateRoutes);
app.use('/api/assets', assetRoutes);
app.use('/api/approvals', approvalRoutes);
app.use('/api/notifications', notificationRoutes);
app.use('/api/dashboard', dashboardRoutes);
app.use('/api/reports', reportRoutes);
app.use('/api/activity', activityRoutes);
app.use('/api/search', searchRoutes);
app.use('/api/analytics', analyticsRoutes);
app.use('/api/meta', metaRoutes);
app.use('/api/events', eventRoutes);
app.use('/api/signage', signageRoutes);
app.use('/api/youtube', youtubeRoutes);
app.use('/api/link-preview', linkRoutes);
app.use('/api/goals', goalRoutes);
app.use('/api/plans', planRoutes);
app.use('/api/ai', aiRoutes);
app.use('/api/linkedin', linkedinRoutes);
app.use('/api/social-posts', socialPostRoutes);
app.use('/api/work-assignments', workAssignmentRoutes);
app.use('/api/requests', institutionRequestRoutes);
app.use('/api/web-tasks', webTaskRoutes);
app.use('/api/ad-campaigns', adCampaignRoutes);
app.use('/api/branding-register', brandingRegisterRoutes);
app.use('/api/competitors', competitorRoutes);
app.use('/api/purchases', purchaseRoutes);
app.use('/api/brand', brandAssetRoutes);
app.use('/api/social-accounts', socialAccountRoutes);
app.use('/api/websites', websiteRoutes);
app.use('/api/organizations', organizationRoutes);
app.use('/api/calendar', calendarRoutes);

app.use(notFound);
app.use(errorHandler);

export default app;
