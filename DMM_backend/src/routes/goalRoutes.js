import express from 'express';
import { getGoals, setGoal, deleteGoal } from '../controllers/goalController.js';
import { protect, authorize } from '../middleware/auth.js';
import { ROLES } from '../config/constants.js';

const router = express.Router();
router.use(protect);

// Reading goals is open to every authenticated user (shared workspace);
// only the super admin console sets or removes them.
router.get('/', getGoals);
router.post('/', authorize(ROLES.ADMIN), setGoal);
router.delete('/:id', authorize(ROLES.ADMIN), deleteGoal);

export default router;
