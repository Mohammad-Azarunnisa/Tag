import express from 'express';
import {
  listInstitutionRequests,
  createInstitutionRequest,
  respondToInstitutionRequest,
  deleteInstitutionRequest,
} from '../controllers/institutionRequestController.js';
import { protect, authorize } from '../middleware/auth.js';
import upload from '../middleware/upload.js';
import { ROLES } from '../config/constants.js';

const router = express.Router();
router.use(protect);

// Listing is scoped in the controller: a college sees its own requests, an Admin
// the institutions they hold, the super admin all of them.
router.route('/').get(listInstitutionRequests).post(upload.array('attachments', 6), createInstitutionRequest);

// Deciding is for the super admin and the college's Admin. Which of the two, and
// which colleges they may decide for, is checked in the controller.
router.put('/:id/respond', authorize(ROLES.ADMIN, ROLES.CEO), respondToInstitutionRequest);

// Withdrawing: the person who raised it, while it is still open.
router.delete('/:id', deleteInstitutionRequest);

export default router;
