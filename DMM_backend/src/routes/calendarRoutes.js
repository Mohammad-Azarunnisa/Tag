import express from 'express';
import { getCalendarMonth, getCalendarDay } from '../controllers/calendarController.js';
import { protect } from '../middleware/auth.js';

const router = express.Router();
router.use(protect);

router.get('/', getCalendarMonth);
router.get('/day', getCalendarDay);

export default router;
