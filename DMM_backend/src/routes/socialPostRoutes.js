import express from 'express';
import { syncSocialPosts, getSocialPosts, getSocialPostSummary } from '../controllers/socialPostController.js';
import { protect, authorize } from '../middleware/auth.js';
import { ROLES } from '../config/constants.js';

const router = express.Router();
router.use(protect);

// Any authenticated user can view the post table (shared workspace).
router.get('/', getSocialPosts);
// Period metrics (7 / 15 / 30 / 90 / 365-day) derived from the stored posts.
router.get('/summary', getSocialPostSummary);
// Pulling from the platform API is an admin/org-head action.
router.post('/sync', authorize(ROLES.ADMIN, ROLES.CEO), syncSocialPosts);

export default router;
