import express from 'express';
import {
  youtubeStatus,
  getYoutubeChannel,
  resolveYoutubeChannel,
  mapYoutubeChannel,
  syncYoutube,
} from '../controllers/youtubeController.js';
import { protect, authorize, requireSuperAdmin } from '../middleware/auth.js';
import { ROLES } from '../config/constants.js';

const router = express.Router();
router.use(protect);

router.get('/status', youtubeStatus);
router.get('/channel', getYoutubeChannel);
router.get('/resolve', authorize(ROLES.ADMIN), resolveYoutubeChannel);
router.post('/map', requireSuperAdmin, mapYoutubeChannel);
router.post('/sync', authorize(ROLES.ADMIN, ROLES.CEO), syncYoutube);

export default router;
