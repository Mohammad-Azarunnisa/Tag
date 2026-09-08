import express from 'express';
import {
  listWorkflow,
  getWorkflowItem,
  acknowledgeWorkflowItem,
  submitWorkflowWork,
  reviewWorkflowItem,
  confirmWorkflowItem,
  markWorkflowPosted,
  cancelWorkflowItem,
} from '../controllers/workflowController.js';
import { protect } from '../middleware/auth.js';
import upload from '../middleware/upload.js';

const router = express.Router();
router.use(protect);

// The two boards read the same collection, narrowed by ?board=DESIGN|POST. Who may
// see which, and who may act at each stage, is settled in the controller against
// the item's own stage and the caller's part in it — a role gate here could only
// say "designers and handlers and admins and coordinators", which is everyone.
router.get('/', listWorkflow);
router.get('/:id', getWorkflowItem);

// Taking the work. Exclusive: the first to press it owns it.
router.put('/:id/acknowledge', acknowledgeWorkflowItem);

// Sending it for approval — the artwork, or the post written around it. Files are
// the finished design on the design half, extra media on the post half.
router.put('/:id/submit', upload.array('files', 10), submitWorkflowWork);

// Admin / Super Admin: approve, or say what needs changing.
router.put('/:id/review', reviewWorkflowItem);

// The coordinator who raised it: "Done" or "Changes required".
router.put('/:id/confirm', confirmWorkflowItem);

// The handler, once the coordinator has released it: posted now, or booked.
router.put('/:id/posted', markWorkflowPosted);

// Admin / Super Admin: pull the request back, but only before a designer or
// handler has acknowledged it — see cancelWorkflowItem for the stage guard.
router.put('/:id/cancel', cancelWorkflowItem);

export default router;
