import express from 'express';
import {
  listPhotographers,
  listSlots,
  bookSlot,
  cancelSlot,
  listPlans,
  listTodayStatus,
  upsertPlan,
} from '../controllers/photographerController.js';
import { protect } from '../middleware/auth.js';

const router = express.Router();
router.use(protect);

// Shared pool + shared booking calendar — any signed-in, non-view-only account
// may see and book a photographer (view-only is already blocked from every
// write by the `protect` middleware itself).
router.get('/', listPhotographers);
router.get('/today', listTodayStatus);
router.get('/slots', listSlots);
router.post('/slots', bookSlot);
router.delete('/slots/:id', cancelSlot);
router.get('/:id/plans', listPlans);
router.put('/plans/:date', upsertPlan);

export default router;
