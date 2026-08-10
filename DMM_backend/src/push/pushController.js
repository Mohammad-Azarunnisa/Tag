import asyncHandler from 'express-async-handler';

import DeviceToken from './DeviceToken.js';
import { isPushConfigured, getFirebaseApp } from './firebaseApp.js';

/**
 * @route POST /api/push/devices
 * Registers the caller's device for push, or moves an existing token to them.
 *
 * Idempotent: the app calls this on every sign-in and whenever Firebase rotates the
 * token, so the same token arriving twice must be an update rather than a duplicate
 * or an error.
 *
 * The upsert deliberately reassigns `user`. The same physical device signed in as
 * somebody else keeps the same FCM token, so without this the previous user would
 * keep receiving notifications on a phone they no longer hold.
 */
export const registerDevice = asyncHandler(async (req, res) => {
  const { token, platform, deviceLabel } = req.body;

  if (!token || typeof token !== 'string' || token.trim().length < 20) {
    res.status(400);
    throw new Error('A valid device token is required');
  }

  const device = await DeviceToken.findOneAndUpdate(
    { token: token.trim() },
    {
      token: token.trim(),
      user: req.user._id,
      platform: ['android', 'ios', 'web'].includes(platform) ? platform : 'android',
      deviceLabel: typeof deviceLabel === 'string' ? deviceLabel.slice(0, 120) : '',
      lastSeenAt: new Date(),
    },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  );

  res.status(201).json({
    success: true,
    // Tells the client whether pushes will actually arrive. The app can register a
    // token against a server with no Firebase credentials, and it should be able to
    // say so rather than waiting silently for notifications that cannot come.
    pushEnabled: isPushConfigured() || Boolean(getFirebaseApp()),
    device: { id: device._id, platform: device.platform },
  });
});

/**
 * @route DELETE /api/push/devices/:token
 * Unregisters a device — called on sign-out, so notifications stop reaching a phone
 * whose user has left.
 *
 * Scoped to the caller: a token can only be removed by the user it currently
 * belongs to, so knowing somebody else's token is not enough to silence them.
 *
 * Succeeds whether or not a row was deleted. Sign-out must not fail because the
 * token was already gone, and reporting "not found" would only tell a caller
 * something about a token they already hold.
 */
export const unregisterDevice = asyncHandler(async (req, res) => {
  const token = req.params.token;

  if (token) {
    await DeviceToken.deleteOne({ token, user: req.user._id });
  }

  res.json({ success: true });
});
