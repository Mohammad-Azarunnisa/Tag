import express from 'express';
import {
  getUsers,
  listHandlers,
  listDirectory,
  listDesigners,
  createUser,
  getUser,
  updateUser,
  deleteUser,
  adminResetPassword,
  updateProfile,
  changePassword,
  updateSettings,
  completeProfile,
  myProfileRequest,
  requestProfileUpdate,
  listProfileRequests,
  reviewProfileRequest,
} from '../controllers/userController.js';
import { protect, authorize, requireSuperAdmin, isCoordinator } from '../middleware/auth.js';
import upload from '../middleware/upload.js';
import { ROLES } from '../config/constants.js';

const router = express.Router();
router.use(protect);

// ADMIN/CEO always; a coordinator too — middleware/auth.js's COORDINATOR_ALLOWED
// already whitelists this path ("who is in their college, to assign work to"),
// and getUsers itself clamps a coordinator to their own pinned organization, so
// this only grants what that allowlist already documented as intended.
const allowUserList = (req, res, next) => {
  if ([ROLES.ADMIN, ROLES.CEO].includes(req.user.role) || isCoordinator(req.user)) return next();
  res.status(403);
  throw new Error(`Role '${req.user.role}' is not allowed to access this resource`);
};

// Self-service (any authenticated user)
router.put('/profile', upload.single('avatar'), updateProfile);
router.put('/profile/complete', completeProfile);
router.route('/profile/update-request').get(myProfileRequest).post(requestProfileUpdate);
router.put('/password', changePassword);
router.put('/settings', updateSettings);

// Social-media handlers of an org (for allocating approved designs to post).
// Registered before '/:id' so the path isn't swallowed by the param route.
// Who you work with and how to reach them. Open to any signed-in account: the
// controller decides whose details each caller may see.
router.get('/directory', listDirectory);
router.get('/handlers', authorize(ROLES.ADMIN, ROLES.CEO), listHandlers);
// Designers a coordinator can pick when raising a design brief (any authenticated
// user — coordinators are USER role). Before '/:id' for the same reason.
router.get('/designers', listDesigners);

// Profile update review queue (ADMIN). Registered before '/:id' so the path
// isn't swallowed by the param route.
router.get('/profile-requests', authorize(ROLES.ADMIN), listProfileRequests);
router.put('/profile-requests/:id', authorize(ROLES.ADMIN), reviewProfileRequest);

// Admins can VIEW users; only the super admin can create / edit / delete them.
// Create and update both accept an optional `avatar` file, so a profile picture
// can be set when the account is made instead of waiting for the user to upload
// one themselves.
router.route('/').get(allowUserList, getUsers).post(requireSuperAdmin, upload.single('avatar'), createUser);
router.put('/:id/reset-password', requireSuperAdmin, adminResetPassword);
router
  .route('/:id')
  .get(authorize(ROLES.ADMIN), getUser)
  .put(requireSuperAdmin, upload.single('avatar'), updateUser)
  .delete(requireSuperAdmin, deleteUser);

export default router;
