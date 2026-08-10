import express from 'express';
import {
  listEvents,
  createEvent,
  addEventFiles,
  updateEvent,
  deleteEvent,
} from '../controllers/eventController.js';
import { protect } from '../middleware/auth.js';
import upload from '../middleware/upload.js';

const router = express.Router();
router.use(protect);

// Any authenticated user can view and add events (shared workspace). Editing and
// deleting are restricted to the creator or an Admin (enforced in the controller).
// `coverImage` is the event's tile picture (optional, one file, stored by the
// app); `photos` is album material for the event's Drive folder.
const eventFiles = upload.fields([{ name: 'coverImage', maxCount: 1 }, { name: 'photos', maxCount: 25 }]);

router.get('/', listEvents);
router.post('/', eventFiles, createEvent);
router.post('/:id/files', upload.array('photos', 25), addEventFiles);
router.put('/:id', eventFiles, updateEvent);
router.delete('/:id', deleteEvent);

export default router;
