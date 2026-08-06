import express from 'express';
import {
  metaStatus,
  metaAccountsList,
  mapMetaAccount,
  autoMapMeta,
  syncMeta,
  metaAdsStatus,
  metaAdsAccountsList,
  mapMetaAdAccount,
  syncMetaAds,
  getMetaAdsReport,
} from '../controllers/metaController.js';
import { protect, authorize, requireSuperAdmin } from '../middleware/auth.js';
import { ROLES } from '../config/constants.js';

const router = express.Router();
router.use(protect);

// Connection health + discovery (read-only).
router.get('/status', metaStatus);
router.get('/accounts', authorize(ROLES.ADMIN), metaAccountsList);

// Mapping orgs <-> Meta accounts is a cross-tenant admin action.
router.post('/map', requireSuperAdmin, mapMetaAccount);
router.post('/automap', requireSuperAdmin, autoMapMeta);

// Pull live metrics into the org's snapshots (admin or org head).
router.post('/sync', authorize(ROLES.ADMIN, ROLES.CEO), syncMeta);

// Meta Ads / paid promotion (super admin only).
router.get('/ads/status', requireSuperAdmin, metaAdsStatus);
router.get('/ads/accounts', requireSuperAdmin, metaAdsAccountsList);
router.post('/ads/map', requireSuperAdmin, mapMetaAdAccount);
router.post('/ads/sync', requireSuperAdmin, syncMetaAds);
router.get('/ads/report', requireSuperAdmin, getMetaAdsReport);

export default router;
