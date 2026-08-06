import express from 'express';
import { exportReport, approvalAnalytics } from '../controllers/reportController.js';
import { getPeriodReport, exportPeriodReport } from '../controllers/periodReportController.js';
import { protect } from '../middleware/auth.js';

const router = express.Router();
router.use(protect);

router.get('/summary/approval-analytics', approvalAnalytics);

// The Branding & Marketing period report. Registered before '/:type' so the
// path isn't swallowed by the export catch-all below.
router.get('/period/export', exportPeriodReport);
router.get('/period', getPeriodReport);
router.get('/:type', exportReport); // type: approval | posting | template | asset | activity

export default router;
