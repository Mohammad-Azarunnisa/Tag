import express from 'express';
import {
  listBrandingRegister,
  createBrandingRegisterItem,
  updateBrandingRegisterItem,
  deleteBrandingRegisterItem,
  seedBrandingRegister,
} from '../controllers/brandingRegisterController.js';
import { protect, requireSuperAdmin } from '../middleware/auth.js';

const router = express.Router();

router.use(protect);
router.use(requireSuperAdmin);

router.get('/', listBrandingRegister);
router.post('/', createBrandingRegisterItem);
router.post('/seed', seedBrandingRegister);
router.put('/:id', updateBrandingRegisterItem);
router.delete('/:id', deleteBrandingRegisterItem);

export default router;
