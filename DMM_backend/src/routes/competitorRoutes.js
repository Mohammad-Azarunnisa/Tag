import express from 'express';
import {
  listCompetitors,
  createCompetitor,
  updateCompetitor,
  deleteCompetitor,
  importCompetitors,
  competitorTemplate,
} from '../controllers/competitorController.js';
import { protect, authorize } from '../middleware/auth.js';
import upload from '../middleware/upload.js';
import { ROLES } from '../config/constants.js';

const router = express.Router();
router.use(protect);

// CEO/USER can view their org's competitor benchmark; only ADMIN edits.
router.get('/', listCompetitors);
router.get('/template', competitorTemplate); // blank Excel to fill in
router.post('/import', authorize(ROLES.ADMIN), upload.single('file'), importCompetitors);
router.post('/', authorize(ROLES.ADMIN), createCompetitor);
router.put('/:id', authorize(ROLES.ADMIN), updateCompetitor);
router.delete('/:id', authorize(ROLES.ADMIN), deleteCompetitor);

export default router;
