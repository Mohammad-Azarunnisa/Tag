import mongoose from 'mongoose';

/**
 * One Firebase registration token, belonging to one user's install of the app.
 *
 * This is what makes a notification reach a person rather than a broadcast: the
 * platform already decides *who* each notification is for (`Notification.recipient`),
 * and this collection answers "which devices is that person currently holding".
 *
 * A person can have several — phone and tablet, or a reinstall that produced a new
 * token — so the relationship is one user to many tokens.
 *
 * The token is the unique key rather than (user, device): the same physical device
 * signed in as somebody else gets the *same* FCM token, and whoever signed in last
 * owns it. Keying on the token and reassigning `user` on registration is what stops
 * a shared or handed-over phone from receiving the previous user's notifications.
 */
const deviceTokenSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },

    // The FCM registration token.
    token: { type: String, required: true, unique: true, index: true },

    platform: { type: String, enum: ['android', 'ios', 'web'], default: 'android' },

    // Free-text, for support: "Pixel 7a, Android 15".
    deviceLabel: { type: String, default: '' },

    // Bumped on every registration. FCM tokens go stale rather than expiring on a
    // schedule, so this is what a future cleanup job would prune on.
    lastSeenAt: { type: Date, default: Date.now },
  },
  { timestamps: true }
);

const DeviceToken = mongoose.model('DeviceToken', deviceTokenSchema);
export default DeviceToken;
