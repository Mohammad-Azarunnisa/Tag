import express from 'express';
import {
  listBrandAssets,
  createBrandAsset,
  updateBrandAsset,
  deleteBrandAsset,
} from '../controllers/brandAssetController.js';
import { protect, requireSuperAdmin, authorize } from '../middleware/auth.js';
import { ROLES } from '../config/constants.js';
import upload from '../middleware/upload.js';

const router = express.Router();
router.use(protect);

router.get('/', listBrandAssets);                          // anyone signed in can view/download
router.post('/', upload.single('file'), createBrandAsset); // anyone signed in can upload
router.put('/:id', requireSuperAdmin, updateBrandAsset);   // only the super admin can edit
// Deleting is an administrator's act — see utils/permissions.js. The role gate
// lives on the route so it cannot be forgotten; the handler adds the institution
// scoping on top of it.
router.delete('/:id', authorize(ROLES.ADMIN, ROLES.CEO), deleteBrandAsset);

export default router;
