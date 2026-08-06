import Notification from '../models/Notification.js';

export const createNotification = async ({ recipient, organization, type, title, message, link, relatedRequest }) => {
  try {
    return await Notification.create({ recipient, organization, type, title, message, link, relatedRequest });
  } catch (err) {
    console.error('createNotification error:', err.message);
    return null;
  }
};
