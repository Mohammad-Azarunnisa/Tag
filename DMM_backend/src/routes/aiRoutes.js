import express from 'express';
import { aiStatus, aiChat, aiDraft, aiInsights, aiReview, aiGoalSuggestion } from '../controllers/aiController.js';
import { protect, authorize } from '../middleware/auth.js';
import { ROLES } from '../config/constants.js';
import { aiChatLimiter } from '../middleware/rateLimit.js';

const router = express.Router();
router.use(protect);

// Any authenticated user can chat — tools scope personal data by role.
router.get('/status', aiStatus);
router.post('/chat', aiChatLimiter, aiChat);
// Draft on-brand post copy from a short brief (used by the approval composer).
router.post('/draft', aiDraft);
// Plain-English read-out of an organization's live analytics (cached 6h).
router.post('/insights', aiInsights);
// Pre-approval quality review of a post's copy (approvers only).
router.post('/review', aiReview);
// A growth target for a chosen period, projected from the organization's own
// history. Only the console sets goals, so only the console asks for one.
router.post('/goal-suggestion', authorize(ROLES.ADMIN), aiGoalSuggestion);

export default router;
