import express from 'express';
import {
  listAdCampaigns, createAdCampaign, updateAdCampaign, deleteAdCampaign,
} from '../controllers/adCampaignController.js';
import { protect, authorize } from '../middleware/auth.js';
import { ROLES } from '../config/constants.js';

const router = express.Router();
router.use(protect);

// Spend and leads are entered by whoever runs the ads — the console or an
// institution's Admin. Which colleges they may touch is checked in the controller.
router.route('/').get(listAdCampaigns).post(authorize(ROLES.ADMIN, ROLES.CEO), createAdCampaign);
router.route('/:id')
  .put(authorize(ROLES.ADMIN, ROLES.CEO), updateAdCampaign)
  .delete(authorize(ROLES.ADMIN, ROLES.CEO), deleteAdCampaign);

export default router;
