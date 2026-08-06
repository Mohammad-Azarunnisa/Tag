import express from 'express';
import {
  getAssets,
  getAsset,
  createAsset,
  updateAsset,
  deleteAsset,
  downloadAsset,
} from '../controllers/assetController.js';
import { protect } from '../middleware/auth.js';
import upload from '../middleware/upload.js';

const router = express.Router();
router.use(protect);

const uploadFields = upload.fields([
  { name: 'file', maxCount: 1 },
  { name: 'preview', maxCount: 1 },
]);

router.route('/').get(getAssets).post(uploadFields, createAsset);
router.post('/:id/download', downloadAsset);
router.route('/:id').get(getAsset).put(uploadFields, updateAsset).delete(deleteAsset);

export default router;
