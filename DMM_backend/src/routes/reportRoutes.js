import express from 'express';
import { exportReport, approvalAnalytics, exportPlatformAnalytics } from '../controllers/reportController.js';
import { getPeriodReport, exportPeriodReport, exportPeriodReportPdf, listSavedReports, openSavedReport, deleteSavedReport, listMonthlyReports, downloadMonthlyReport } from '../controllers/periodReportController.js';
import { protect, authorize, requireSuperAdmin } from '../middleware/auth.js';
import { ROLES } from '../config/constants.js';

const router = express.Router();
router.use(protect);

router.get('/summary/approval-analytics', approvalAnalytics);

// The Branding & Marketing period report is a management view across an
// entire team's performance — restricted to Admin/CEO, not every signed-in
// user. Registered before '/:type' so the path isn't swallowed by the export
// catch-all below.
// The finished months' reports, built once and shared: any Admin can open the same stored file.
router.get('/monthly', authorize(ROLES.ADMIN), listMonthlyReports);
router.get('/monthly/:month', authorize(ROLES.ADMIN), downloadMonthlyReport);
router.get('/period/saved', requireSuperAdmin, listSavedReports);
router.get('/period/saved/:id', requireSuperAdmin, openSavedReport);
router.delete('/period/saved/:id', requireSuperAdmin, deleteSavedReport);
router.get('/period/export-pdf', authorize(ROLES.ADMIN, ROLES.CEO), exportPeriodReportPdf);
router.get('/period/export', authorize(ROLES.ADMIN, ROLES.CEO), exportPeriodReport);
router.get('/period', authorize(ROLES.ADMIN, ROLES.CEO), getPeriodReport);
router.get('/platform-export', requireSuperAdmin, exportPlatformAnalytics);
router.get('/:type', exportReport); // type: approval | posting | template | asset | activity

export default router;
