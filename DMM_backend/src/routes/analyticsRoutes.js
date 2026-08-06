import express from 'express';
import {
  getAnalytics,
  getAnalyticsPulse,
  getPlatformReport,
  getPlatformHistory,
  getPlatformHeatmap,
  compareOrganizations,
  getAnalyticsOverview,
  recordAnalytics,
  clearAnalytics,
  importAnalytics,
  analyticsTemplate,
} from '../controllers/analyticsController.js';
import { protect, authorize } from '../middleware/auth.js';
import upload from '../middleware/upload.js';
import { ROLES } from '../config/constants.js';

const router = express.Router();
router.use(protect);

router.get('/', getAnalytics);
router.get('/template', analyticsTemplate); // before /:platform
router.get('/compare', authorize(ROLES.ADMIN), compareOrganizations); // before /:platform
router.get('/overview', authorize(ROLES.ADMIN), getAnalyticsOverview); // before /:platform
router.get('/pulse', getAnalyticsPulse); // any authenticated user; before /:platform
router.post('/', authorize(ROLES.ADMIN, ROLES.CEO), recordAnalytics);
router.delete('/', authorize(ROLES.ADMIN, ROLES.CEO), clearAnalytics);
router.post('/import', authorize(ROLES.ADMIN, ROLES.CEO), upload.single('file'), importAnalytics);
router.get('/:platform/report', getPlatformReport);
router.get('/:platform/history', getPlatformHistory);
router.get('/:platform/heatmap', getPlatformHeatmap);

export default router;
