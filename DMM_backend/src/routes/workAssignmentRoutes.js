import express from 'express';
import { protect, authorize, requireSuperAdmin } from '../middleware/auth.js';
import { ROLES } from '../config/constants.js';
import {
  createWorkAssignment,
  listWorkAssignments,
  acknowledgeAssignment,
  submitAssignment,
  reviewAssignment,
  reassignAssignment,
} from '../controllers/workAssignmentController.js';

const router = express.Router();

router.use(protect);
router.use(authorize(ROLES.ADMIN, ROLES.CEO, ROLES.USER));

// Anyone may list (scoped in the controller). Handing work out is for the super
// admin, an Admin, and a college's coordinator - the controller checks which,
// and which college they may assign into. A designer or social handler receives
// work rather than giving it.
router.route('/').get(listWorkAssignments).post(createWorkAssignment);

// The assignee drives their own work forward (ownership checked in the controller).
router.put('/:id/acknowledge', acknowledgeAssignment);
router.put('/:id/submit', submitAssignment);
// Signing off a completion request is what marks the work DONE. The super admin
// can do it anywhere; an Admin within the institutions they hold.
router.put('/:id/review', authorize(ROLES.ADMIN, ROLES.CEO), reviewAssignment);
// Moving work to another person is a super-admin correction.
router.put('/:id/reassign', requireSuperAdmin, reassignAssignment);

export default router;
