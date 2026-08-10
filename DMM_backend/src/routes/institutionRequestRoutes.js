import express from 'express';
import {
  listInstitutionRequests,
  createInstitutionRequest,
  deleteInstitutionRequest,
} from '../controllers/institutionRequestController.js';
import { protect } from '../middleware/auth.js';
import upload from '../middleware/upload.js';

const router = express.Router();
router.use(protect);

// Listing is scoped in the controller: a college sees its own requests, an Admin
// the institutions they hold, the super admin all of them.
//
// There is deliberately no decision endpoint. A request is not approved by
// anyone: it goes straight to the designers on "Designs to be Done" when it is
// raised, and the Admin and super admin only read it.
router.route('/').get(listInstitutionRequests).post(upload.array('attachments', 6), createInstitutionRequest);

// Withdrawing: the person who raised it, while it is still open.
router.delete('/:id', deleteInstitutionRequest);

export default router;
