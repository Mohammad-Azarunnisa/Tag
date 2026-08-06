import express from 'express';
import {
  listSocialAccounts,
  createSocialAccount,
  updateSocialAccount,
  deleteSocialAccount,
  importSocialAccounts,
  socialAccountTemplate,
} from '../controllers/socialAccountController.js';
import { protect, authorize } from '../middleware/auth.js';
import upload from '../middleware/upload.js';
import { ROLES } from '../config/constants.js';

const router = express.Router();
router.use(protect);

router.get('/', authorize(ROLES.ADMIN, ROLES.CEO), listSocialAccounts); // CEO + Admin only
router.get('/template', authorize(ROLES.ADMIN, ROLES.CEO), socialAccountTemplate);
router.post('/import', authorize(ROLES.ADMIN), upload.single('file'), importSocialAccounts);
router.post('/', authorize(ROLES.ADMIN), createSocialAccount);
router.put('/:id', authorize(ROLES.ADMIN), updateSocialAccount);
router.delete('/:id', authorize(ROLES.ADMIN), deleteSocialAccount);

export default router;
