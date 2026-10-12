import express from 'express';
import { getCalendarMonth, getCalendarDay, addDesignerNote, updateDesignerNote, deleteDesignerNote } from '../controllers/calendarController.js';
import { protect } from '../middleware/auth.js';

const router = express.Router();
router.use(protect);

router.get('/', getCalendarMonth);
router.get('/day', getCalendarDay);
router.post('/notes', addDesignerNote);
router.put('/notes/:id', updateDesignerNote);
router.delete('/notes/:id', deleteDesignerNote);

export default router;
