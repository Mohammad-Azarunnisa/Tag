import ActivityLog from '../models/ActivityLog.js';

// Fire-and-forget activity logger. Never throws into the request flow.
export const logActivity = async ({ user, organization, action, description, entityType, entityId, meta }) => {
  try {
    await ActivityLog.create({ user, organization, action, description, entityType, entityId, meta });
  } catch (err) {
    console.error('logActivity error:', err.message);
  }
};
