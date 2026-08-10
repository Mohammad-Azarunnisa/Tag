import express from 'express';

import { protect } from '../middleware/auth.js';
import { registerDevice, unregisterDevice } from './pushController.js';

const router = express.Router();

// Both routes are about the caller's own device, so they need an identity but no
// particular role: every account that can sign in can be notified.
//
// Note `protect` also blocks non-GET requests for view-only accounts (the
// Chairman), which means those accounts cannot register a device and will not
// receive push. That follows from the existing global rule rather than being a
// decision made here — worth knowing if someone asks why their tablet is quiet.
router.use(protect);

router.post('/devices', registerDevice);
router.delete('/devices/:token', unregisterDevice);

export default router;
