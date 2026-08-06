import express from 'express';
import { importLinkedIn, linkedinDashboard, setFollowersBaseline } from '../controllers/linkedinController.js';
import { protect, authorize } from '../middleware/auth.js';
import upload from '../middleware/upload.js';
import { ROLES } from '../config/constants.js';

const router = express.Router();
router.use(protect);

// Viewing the LinkedIn dashboard is open to every authenticated user (shared
// workspace); uploading exports is for admins (Super Admin / org Admin).
router.get('/dashboard', linkedinDashboard);
router.post('/import', authorize(ROLES.ADMIN, ROLES.CEO), upload.single('file'), importLinkedIn);
router.post('/followers-baseline', authorize(ROLES.ADMIN, ROLES.CEO), setFollowersBaseline);

export default router;
