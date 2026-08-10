import DeviceToken from './DeviceToken.js';
import { getMessaging } from 'firebase-admin/messaging';

import { getFirebaseApp } from './firebaseApp.js';

/**
 * Sends a notification to every device belonging to one user.
 *
 * Person-to-person by construction: the caller passes the recipient's id, and the
 * only tokens ever loaded are that user's. There is no topic and no broadcast in
 * this module, so a message cannot reach anyone it was not addressed to.
 *
 * Never throws and never rejects. It is called from the tail of actions that have
 * already succeeded — an approval was decided, a request was submitted — and a
 * failure to deliver a push must not fail that action or roll anything back. The
 * notification is already in Mongo either way, so the app still shows it on next
 * load; push is the courtesy, not the record.
 *
 * @param {string} userId       recipient
 * @param {object} notification { title, body, link, type, requestId }
 */
export const sendPushToUser = async (userId, { title, body, link, type, requestId } = {}) => {
  try {
    if (!userId || !title) return { sent: 0, skipped: true };
    if (!getFirebaseApp()) return { sent: 0, skipped: true };

    const devices = await DeviceToken.find({ user: userId }).select('token').lean();
    if (!devices.length) return { sent: 0, skipped: true };

    const tokens = devices.map((d) => d.token);

    // Every value in `data` must be a string — FCM rejects the message otherwise,
    // and an ObjectId or a null would slip through untyped JavaScript to fail at
    // send time rather than here.
    const data = {
      link: String(link || ''),
      type: String(type || ''),
      requestId: String(requestId || ''),
    };

    const response = await getMessaging(getFirebaseApp()).sendEachForMulticast({
      tokens,
      notification: { title, body: body || '' },
      data,
      android: {
        // `high` so the notification wakes a dozing device. These are things a
        // person is being asked to act on, not background sync.
        priority: 'high',
        notification: {
          channelId: 'tag_approvals',
          // Collapsing on the request means a burst of updates about one approval
          // replaces itself in the tray instead of stacking up.
          tag: requestId ? `request-${requestId}` : undefined,
        },
      },
      apns: {
        payload: { aps: { sound: 'default' } },
      },
    });

    await pruneDeadTokens(tokens, response);

    return { sent: response.successCount, failed: response.failureCount };
  } catch (err) {
    console.error('[push] sendPushToUser error:', err.message);
    return { sent: 0, error: err.message };
  }
};

/**
 * Deletes tokens Firebase has told us are dead — app uninstalled, or the token was
 * replaced. Left alone they accumulate forever and every send does more work for a
 * device that will never receive anything.
 *
 * Only the two unambiguous "this token is gone" codes are pruned. A transient
 * failure (`messaging/internal-error`, quota) must not delete a live device.
 */
const pruneDeadTokens = async (tokens, response) => {
  const dead = [];

  response.responses.forEach((result, i) => {
    const code = result.error?.code;
    if (
      code === 'messaging/registration-token-not-registered' ||
      code === 'messaging/invalid-registration-token' ||
      code === 'messaging/invalid-argument'
    ) {
      dead.push(tokens[i]);
    }
  });

  if (!dead.length) return;

  try {
    await DeviceToken.deleteMany({ token: { $in: dead } });
    console.log(`[push] pruned ${dead.length} dead token(s)`);
  } catch (err) {
    console.error('[push] prune error:', err.message);
  }
};
