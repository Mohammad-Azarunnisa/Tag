import express from 'express';
import {
  getTemplates,
  getTemplate,
  createTemplate,
  updateTemplate,
  deleteTemplate,
  downloadTemplate,
} from '../controllers/templateController.js';
import { protect, authorize } from '../middleware/auth.js';
import { ROLES } from '../config/constants.js';
import upload from '../middleware/upload.js';

const router = express.Router();
router.use(protect);

const uploadFields = upload.fields([
  { name: 'file', maxCount: 1 },
  { name: 'thumbnail', maxCount: 1 },
]);

router.route('/').get(getTemplates).post(uploadFields, createTemplate);
router.post('/:id/download', downloadTemplate);
// Deleting is an administrator's act — see utils/permissions.js. The role gate
// lives on the route so it cannot be forgotten; the handler adds the institution
// scoping on top of it.
router.route('/:id').get(getTemplate).put(uploadFields, updateTemplate).delete(authorize(ROLES.ADMIN, ROLES.CEO), deleteTemplate);

export default router;
