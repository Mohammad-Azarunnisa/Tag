import express from 'express';
import {
  getDashboardStats,
  getDashboardCharts,
  getRecentActivity,
  getTopPlatform,
  getMyUploads,
} from '../controllers/dashboardController.js';
import { protect } from '../middleware/auth.js';

const router = express.Router();
router.use(protect);

router.get('/stats', getDashboardStats);
router.get('/charts', getDashboardCharts);
router.get('/activity', getRecentActivity);
router.get('/top-platform', getTopPlatform);
router.get('/my-uploads', getMyUploads);

export default router;
