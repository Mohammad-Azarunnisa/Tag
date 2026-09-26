import express from 'express';
import {
  getApprovals,
  getApproval,
  createApproval,
  submitDesign,
  approveRequest,
  rejectRequest,
  resubmitRequest,
  markPosted,
  publishNow,
  scheduleRequest,
  claimDesignRequest,
  assignRequest,
  deliverToCoordinator,
  forwardRequest,
  addComment,
  deleteApproval,
} from '../controllers/approvalController.js';
import { protect, authorize } from '../middleware/auth.js';
import upload from '../middleware/upload.js';
import { ROLES } from '../config/constants.js';

const router = express.Router();
router.use(protect);

router.route('/').get(getApprovals).post(upload.array('images', 10), createApproval);
// Deleting is an administrator's act — see utils/permissions.js. The role gate
// lives on the route so it cannot be forgotten; the handler adds the institution
// scoping on top of it.
router.route('/:id').get(getApproval).delete(authorize(ROLES.ADMIN, ROLES.CEO), deleteApproval);

// The designer submits the finished design for their assigned brief.
router.put('/:id/submit-design', upload.array('images', 10), submitDesign);
router.put('/:id/claim', claimDesignRequest);
// The super admin approves for every college; an Admin (CEO) approves inside the
// institutions the super admin put under them. Which of the two is deciding is
// checked against the request's own college in the controller.
router.put('/:id/approve', authorize(ROLES.ADMIN, ROLES.CEO), approveRequest);
router.put('/:id/reject', authorize(ROLES.ADMIN, ROLES.CEO), rejectRequest);
// After approval, the design is routed: allocated to a social handler to post,
// or delivered back to the coordinator. Whoever could approve it decides — the
// super admin anywhere, an Admin within the institutions they hold, which the
// controllers check per request.
router.put('/:id/assign', authorize(ROLES.ADMIN, ROLES.CEO), assignRequest);
router.put('/:id/deliver', authorize(ROLES.ADMIN, ROLES.CEO), deliverToCoordinator);
router.put('/:id/forward', authorize(ROLES.ADMIN, ROLES.CEO), forwardRequest);
router.put('/:id/resubmit', upload.array('images', 10), resubmitRequest);
router.put('/:id/schedule', scheduleRequest);
router.put('/:id/posted', markPosted);
// Separate from /posted above — this one actually publishes to a connected
// Facebook/Instagram account instead of just recording that it was posted.
// See publishNow in approvalController.js for exactly when it does something
// vs. when it reports there's nothing it can post directly yet.
router.put('/:id/publish-now', publishNow);

// Conversation thread on a request (owner / ADMIN / org CEO — enforced in the
// controller). Messages may carry up to 6 image/video attachments.
router.post('/:id/comments', upload.array('files', 6), addComment);

export default router;
