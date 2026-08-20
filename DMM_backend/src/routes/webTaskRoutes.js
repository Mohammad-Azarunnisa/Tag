import express from 'express';
import {
  listWebTasks, createWebTask, updateWebTask, deleteWebTask,
} from '../controllers/webTaskController.js';
import { protect, authorize } from '../middleware/auth.js';
import { ROLES } from '../config/constants.js';

const router = express.Router();
router.use(protect);

// Website work is raised and tracked by the console and by an institution's
// Admin; scope is enforced in the controller.
router.route('/').get(listWebTasks).post(authorize(ROLES.ADMIN, ROLES.CEO), createWebTask);
router.route('/:id')
  .put(authorize(ROLES.ADMIN, ROLES.CEO), updateWebTask)
  .delete(authorize(ROLES.ADMIN, ROLES.CEO), deleteWebTask);

export default router;
