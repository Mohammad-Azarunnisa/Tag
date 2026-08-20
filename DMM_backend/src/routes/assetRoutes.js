import express from 'express';
import {
  getAssets,
  getAsset,
  createAsset,
  updateAsset,
  deleteAsset,
  downloadAsset,
} from '../controllers/assetController.js';
import { protect, authorize } from '../middleware/auth.js';
import { ROLES } from '../config/constants.js';
import upload from '../middleware/upload.js';

const router = express.Router();
router.use(protect);

const uploadFields = upload.fields([
  { name: 'file', maxCount: 1 },
  { name: 'preview', maxCount: 1 },
]);

router.route('/').get(getAssets).post(uploadFields, createAsset);
router.post('/:id/download', downloadAsset);
// Deleting is an administrator's act — see utils/permissions.js. The role gate
// lives on the route so it cannot be forgotten; the handler adds the institution
// scoping on top of it.
router.route('/:id').get(getAsset).put(uploadFields, updateAsset).delete(authorize(ROLES.ADMIN, ROLES.CEO), deleteAsset);

export default router;
