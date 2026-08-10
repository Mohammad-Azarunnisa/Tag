// The modular entry points, not the `firebase-admin` default export. This backend
// is ESM ("type": "module"), where the default export does not carry `credential`
// — `admin.credential.cert(...)` throws "cannot read properties of undefined".
import { applicationDefault, cert, initializeApp } from 'firebase-admin/app';

/**
 * Firebase Admin, initialised once and lazily.
 *
 * Push is optional infrastructure: the platform's notifications live in Mongo and
 * are read over `/api/notifications`, and push only mirrors them to devices. So a
 * missing or malformed service account must never stop the server booting or break
 * the request that triggered a notification — every path here degrades to "no push"
 * and says so once.
 *
 * Credentials come from the environment rather than a file in the repo, because a
 * service account is a private key that grants send rights on the whole Firebase
 * project. Two forms are accepted:
 *
 *   FIREBASE_SERVICE_ACCOUNT       the service-account JSON itself, as one line
 *                                  (what Render and similar hosts make easy)
 *   GOOGLE_APPLICATION_CREDENTIALS a path to that JSON on disk, read by the SDK
 *                                  itself via applicationDefault()
 */

let app;
let state = 'unknown'; // 'unknown' | 'ready' | 'disabled'

const disable = (reason) => {
  if (state !== 'disabled') {
    console.warn(`[push] disabled: ${reason}`);
  }
  state = 'disabled';
  return null;
};

/**
 * The initialised Firebase app, or null when push is not configured.
 * Callers must treat null as "skip push", not as an error.
 */
export const getFirebaseApp = () => {
  if (state === 'ready') return app;
  if (state === 'disabled') return null;

  const inline = process.env.FIREBASE_SERVICE_ACCOUNT;
  const path = process.env.GOOGLE_APPLICATION_CREDENTIALS;

  if (!inline && !path) {
    return disable('set FIREBASE_SERVICE_ACCOUNT or GOOGLE_APPLICATION_CREDENTIALS to enable');
  }

  try {
    let credential;

    if (inline) {
      const parsed = JSON.parse(inline);
      // Hosts that store the key in a dashboard field often turn the JSON's "\n"
      // escapes into literal backslash-n, which makes the PEM unparseable. Undo
      // that here rather than making whoever deploys it notice.
      if (typeof parsed.private_key === 'string') {
        parsed.private_key = parsed.private_key.replace(/\\n/g, '\n');
      }
      credential = cert(parsed);
    } else {
      credential = applicationDefault();
    }

    app = initializeApp({ credential }, 'push');
    state = 'ready';
    console.log('[push] Firebase Admin ready');
    return app;
  } catch (err) {
    return disable(`could not initialise Firebase Admin (${err.message})`);
  }
};

/** Whether push is configured. Cheap to call; does not initialise. */
export const isPushConfigured = () => state === 'ready';
