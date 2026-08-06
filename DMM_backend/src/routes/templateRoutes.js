import express from 'express';
import {
  getTemplates,
  getTemplate,
  createTemplate,
  updateTemplate,
  deleteTemplate,
  downloadTemplate,
} from '../controllers/templateController.js';
import { protect } from '../middleware/auth.js';
import upload from '../middleware/upload.js';

const router = express.Router();
router.use(protect);

const uploadFields = upload.fields([
  { name: 'file', maxCount: 1 },
  { name: 'thumbnail', maxCount: 1 },
]);

router.route('/').get(getTemplates).post(uploadFields, createTemplate);
router.post('/:id/download', downloadTemplate);
router.route('/:id').get(getTemplate).put(uploadFields, updateTemplate).delete(deleteTemplate);

export default router;
