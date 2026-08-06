import asyncHandler from 'express-async-handler';
import Notification from '../models/Notification.js';

// @route GET /api/notifications
export const getNotifications = asyncHandler(async (req, res) => {
  const { unread } = req.query;
  const query = { recipient: req.user._id };
  if (unread === 'true') query.isRead = false;
  const [items, unreadCount] = await Promise.all([
    Notification.find(query).sort({ createdAt: -1 }).limit(50),
    Notification.countDocuments({ recipient: req.user._id, isRead: false }),
  ]);
  res.json({ success: true, unreadCount, notifications: items });
});

// @route PUT /api/notifications/:id/read
export const markRead = asyncHandler(async (req, res) => {
  const n = await Notification.findOneAndUpdate(
    { _id: req.params.id, recipient: req.user._id },
    { isRead: true },
    { new: true }
  );
  if (!n) { res.status(404); throw new Error('Notification not found'); }
  res.json({ success: true, notification: n });
});

// @route PUT /api/notifications/read-all
export const markAllRead = asyncHandler(async (req, res) => {
  await Notification.updateMany({ recipient: req.user._id, isRead: false }, { isRead: true });
  res.json({ success: true, message: 'All notifications marked read' });
});

// @route DELETE /api/notifications/:id
export const deleteNotification = asyncHandler(async (req, res) => {
  await Notification.findOneAndDelete({ _id: req.params.id, recipient: req.user._id });
  res.json({ success: true, message: 'Deleted' });
});
