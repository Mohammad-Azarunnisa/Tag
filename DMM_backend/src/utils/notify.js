import Notification from '../models/Notification.js';
import { sendPushToUser } from '../push/pushService.js';

export const createNotification = async ({ recipient, organization, type, title, message, link, relatedRequest }) => {
  try {
    const notification = await Notification.create({ recipient, organization, type, title, message, link, relatedRequest });
    // Fire-and-forget: push is a courtesy on top of the in-app notification
    // above (already saved either way), and sendPushToUser never throws or
    // rejects, so it must not be awaited here — every caller of
    // createNotification across the app would otherwise pay for a push
    // round-trip just to record a notification.
    sendPushToUser(recipient, { title, body: message, link, type, requestId: relatedRequest });
    return notification;
  } catch (err) {
    console.error('createNotification error:', err.message);
    return null;
  }
};
