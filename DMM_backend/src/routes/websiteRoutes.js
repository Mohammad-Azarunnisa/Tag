import express from 'express';
import {
  listWebsites,
  createWebsite,
  updateWebsite,
  deleteWebsite,
  importWebsites,
  websiteTemplate,
} from '../controllers/websiteController.js';
import { protect, authorize } from '../middleware/auth.js';
import upload from '../middleware/upload.js';
import { ROLES } from '../config/constants.js';

const router = express.Router();
router.use(protect);

router.get('/', authorize(ROLES.ADMIN, ROLES.CEO), listWebsites); // CEO + Admin only
router.get('/template', authorize(ROLES.ADMIN, ROLES.CEO), websiteTemplate);
router.post('/import', authorize(ROLES.ADMIN), upload.single('file'), importWebsites);
router.post('/', authorize(ROLES.ADMIN), createWebsite);
router.put('/:id', authorize(ROLES.ADMIN), updateWebsite);
router.delete('/:id', authorize(ROLES.ADMIN), deleteWebsite);

export default router;
