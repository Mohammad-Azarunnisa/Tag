import express from 'express';
import { linkPreview } from '../controllers/linkPreviewController.js';
import { protect } from '../middleware/auth.js';

const router = express.Router();
router.use(protect);
router.get('/', linkPreview);

export default router;
