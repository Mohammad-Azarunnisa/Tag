import express from 'express';
import { protect, authorize, requireSuperAdmin } from '../middleware/auth.js';
import upload from '../middleware/upload.js';
import { ROLES } from '../config/constants.js';
import {
  createWorkAssignment,
  listWorkAssignments,
  acknowledgeAssignment,
  submitAssignment,
  reviewAssignment,
  reassignAssignment,
  handoffAssignment,
  markAssignmentPosted,
} from '../controllers/workAssignmentController.js';

const router = express.Router();

router.use(protect);
router.use(authorize(ROLES.ADMIN, ROLES.CEO, ROLES.USER));

// Anyone may list (scoped in the controller). Handing work out is for the super
// admin and an Admin only - the controller checks which institutions they may
// assign into. Everyone in the USER role, coordinators included, receives work
// or raises a request rather than giving it out.
router.route('/').get(listWorkAssignments).post(createWorkAssignment);

// The assignee drives their own work forward (ownership checked in the controller).
router.put('/:id/acknowledge', acknowledgeAssignment);
// The completion request carries the finished files, not just a note — whoever
// signs it off and whoever publishes it both need the actual work.
router.put('/:id/submit', upload.array('files', 6), submitAssignment);
// Publishing work is closed by the person who published it — no note, no second
// sign-off. An optional scheduledAt books the moment instead.
router.put('/:id/posted', markAssignmentPosted);
// Signing off a completion request is what marks the work DONE. The super admin
// can do it anywhere; an Admin within the institutions they hold.
router.put('/:id/review', authorize(ROLES.ADMIN, ROLES.CEO), reviewAssignment);
// Once it is signed off, the same people decide where it goes: to a social
// handler to publish, or back to the coordinator who asked for it.
router.put('/:id/handoff', authorize(ROLES.ADMIN, ROLES.CEO), handoffAssignment);
// Moving work to another person is a super-admin correction.
router.put('/:id/reassign', requireSuperAdmin, reassignAssignment);

export default router;
