import express from 'express';
import {
  getOrganizations,
  getOrganization,
  getOrganizationGoal,
  listOrgOptions,
  createOrganization,
  updateOrganization,
  deleteOrganization,
} from '../controllers/organizationController.js';
import { protect, authorize, requireSuperAdmin } from '../middleware/auth.js';
import upload from '../middleware/upload.js';
import { ROLES } from '../config/constants.js';

const router = express.Router();
router.use(protect);

// Org options for pickers — any authenticated user (id + name only).
router.get('/options', listOrgOptions);

// Goal + progress: any authenticated user (controller restricts CEO/USER to own org).
router.get('/:id/goal', getOrganizationGoal);

// Admins can VIEW organizations; only the super admin can create / edit / delete.
router.route('/')
  .get(authorize(ROLES.ADMIN), getOrganizations)
  .post(requireSuperAdmin, upload.single('logo'), createOrganization);
router.route('/:id')
  .get(authorize(ROLES.ADMIN), getOrganization)
  .put(requireSuperAdmin, upload.single('logo'), updateOrganization)
  .delete(requireSuperAdmin, deleteOrganization);

export default router;
