import express from 'express';
import {
  listPurchases,
  createPurchase,
  updatePurchase,
  deletePurchase,
} from '../controllers/purchaseController.js';
import { protect, authorize, requireSuperAdmin } from '../middleware/auth.js';
import { ROLES } from '../config/constants.js';

const router = express.Router();
router.use(protect);

router.get('/', authorize(ROLES.ADMIN, ROLES.CEO), listPurchases); // CEO + Admin only
// Writes are the super admin's alone, same as Users/Organizations — an ADMIN-role
// account that is neither the super admin nor view-only (nothing currently
// prevents creating one) must not get unrestricted write access across every
// organization's purchases just by holding the ADMIN role.
router.post('/', requireSuperAdmin, createPurchase);
router.put('/:id', requireSuperAdmin, updatePurchase);
router.delete('/:id', requireSuperAdmin, deletePurchase);

export default router;
