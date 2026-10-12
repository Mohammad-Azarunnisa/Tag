import express from 'express';
import { listHolidays, addHolidays, removeHoliday, getPlan } from '../controllers/holidayController.js';
import { protect, requireSuperAdmin } from '../middleware/auth.js';

const router = express.Router();
router.use(protect);

router.get('/plan', getPlan); // /api/turnaround/plan
router.get('/', listHolidays);
router.post('/', requireSuperAdmin, addHolidays);
router.delete('/:id', requireSuperAdmin, removeHoliday);

export default router;
