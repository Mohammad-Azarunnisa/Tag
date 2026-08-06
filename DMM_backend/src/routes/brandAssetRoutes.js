import express from 'express';
import {
  listBrandAssets,
  createBrandAsset,
  updateBrandAsset,
  deleteBrandAsset,
} from '../controllers/brandAssetController.js';
import { protect, requireSuperAdmin } from '../middleware/auth.js';
import upload from '../middleware/upload.js';

const router = express.Router();
router.use(protect);

router.get('/', listBrandAssets);                          // anyone signed in can view/download
router.post('/', upload.single('file'), createBrandAsset); // anyone signed in can upload
router.put('/:id', requireSuperAdmin, updateBrandAsset);   // only the super admin can edit
router.delete('/:id', requireSuperAdmin, deleteBrandAsset);// only the super admin can remove

export default router;
