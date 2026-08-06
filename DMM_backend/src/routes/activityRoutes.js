import express from 'express';
import { getActivityLogs, getActivityHeatmap, getActivityByDate } from '../controllers/activityController.js';
import { protect } from '../middleware/auth.js';

const router = express.Router();
router.use(protect);
router.get('/', getActivityLogs);
router.get('/heatmap', getActivityHeatmap);
router.get('/day', getActivityByDate);

export default router;
