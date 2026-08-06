import express from 'express';
import {
  getPlans, getPlan, getPlanSchedule, createPlan, updatePlan, approvePlan, rejectPlan, deletePlan, deletePlanItem,
} from '../controllers/postPlanController.js';
import { protect, requireSuperAdmin } from '../middleware/auth.js';

const router = express.Router();
router.use(protect);

// Role scoping lives in the controller (ADMIN all orgs, CEO own org, USER own plans).
router.route('/').get(getPlans).post(createPlan);
// Must be declared before '/:id', or 'schedule' is read as a plan id.
router.get('/schedule', getPlanSchedule);
router.route('/:id').get(getPlan).put(updatePlan).delete(deletePlan);
// Removing a single planned post is a super-admin-only correction.
router.delete('/:id/items/:itemId', requireSuperAdmin, deletePlanItem);
router.put('/:id/approve', approvePlan);
router.put('/:id/reject', rejectPlan);

export default router;
