import express from 'express';
import {
  listPurchases,
  createPurchase,
  updatePurchase,
  deletePurchase,
} from '../controllers/purchaseController.js';
import { protect, authorize } from '../middleware/auth.js';
import { ROLES } from '../config/constants.js';

const router = express.Router();
router.use(protect);

router.get('/', authorize(ROLES.ADMIN, ROLES.CEO), listPurchases); // CEO + Admin only
router.post('/', authorize(ROLES.ADMIN), createPurchase);       // admin manages
router.put('/:id', authorize(ROLES.ADMIN), updatePurchase);
router.delete('/:id', authorize(ROLES.ADMIN), deletePurchase);

export default router;
