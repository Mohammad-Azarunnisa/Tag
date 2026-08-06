import express from 'express';
import {
  listLocations,
  createLocation,
  updateLocation,
  deleteLocation,
  listBanners,
  createBanner,
  updateBanner,
  removeBanner,
  deleteBanner,
} from '../controllers/signageController.js';
import { protect } from '../middleware/auth.js';
import upload from '../middleware/upload.js';

const router = express.Router();
router.use(protect);

// Any authenticated user can view and add signage (shared workspace). Editing
// and deleting are restricted to the creator or an Admin/CEO (in the controller).

// Locations — the fixed stands.
router.get('/locations', listLocations);
router.post('/locations', upload.single('photo'), createLocation);
router.put('/locations/:id', upload.single('photo'), updateLocation);
router.delete('/locations/:id', deleteLocation);

// Banners — three optional file slots: preview (image shown in the UI),
// source (print-ready PSD/PDF/AI) and photo (banner installed at the spot).
const bannerFiles = upload.fields([
  { name: 'preview', maxCount: 1 },
  { name: 'source', maxCount: 1 },
  { name: 'photo', maxCount: 1 },
]);
router.get('/banners', listBanners);
router.post('/banners', bannerFiles, createBanner);
router.put('/banners/:id', bannerFiles, updateBanner);
router.put('/banners/:id/remove', removeBanner);
router.delete('/banners/:id', deleteBanner);

export default router;
