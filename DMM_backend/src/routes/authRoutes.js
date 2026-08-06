import express from 'express';
import {
  setupStatus,
  login,
  getMe,
  logout,
  forgotPassword,
  resetPassword,
  emailStatus,
} from '../controllers/authController.js';
import { protect } from '../middleware/auth.js';

const router = express.Router();

// The first admin is no longer created here — a built-in super admin is seeded
// on startup. setup-status is kept (always "configured") for the clients.
router.get('/setup-status', setupStatus);
router.get('/email-status', emailStatus);
router.post('/login', login);
router.post('/logout', logout);
router.post('/forgot-password', forgotPassword);
router.post('/reset-password/:token', resetPassword);
router.get('/me', protect, getMe);

export default router;
