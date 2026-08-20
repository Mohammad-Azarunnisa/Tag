import express from 'express';
import {
  getPlans, getPlan, getPlanSchedule, createPlan, updatePlan, approvePlan, rejectPlan, deletePlan, deletePlanItem,
} from '../controllers/postPlanController.js';
import { protect, authorize } from '../middleware/auth.js';
import { ROLES } from '../config/constants.js';

const router = express.Router();
router.use(protect);

// Role scoping lives in the controller (ADMIN all orgs, CEO own org, USER own plans).
router.route('/').get(getPlans).post(createPlan);
// Must be declared before '/:id', or 'schedule' is read as a plan id.
router.get('/schedule', getPlanSchedule);
// Deleting is an administrator's act — see utils/permissions.js. The role gate
// lives on the route so it cannot be forgotten; the handler adds the institution
// scoping on top of it.
router.route('/:id').get(getPlan).put(updatePlan).delete(authorize(ROLES.ADMIN, ROLES.CEO), deletePlan);
// Removing a single planned post is a super-admin-only correction.
router.delete('/:id/items/:itemId', authorize(ROLES.ADMIN, ROLES.CEO), deletePlanItem);
router.put('/:id/approve', approvePlan);
router.put('/:id/reject', rejectPlan);

export default router;
