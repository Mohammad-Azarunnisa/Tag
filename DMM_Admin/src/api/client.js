import axios from 'axios';
import toast from 'react-hot-toast';

// Admin portal uses its own token storage key so it never clashes with the
// main product app's session.
export const TOKEN_KEY = 'dmm_admin_token';

// In dev, '/api' is proxied to the backend by Vite (see vite.config.js).
// In production, set VITE_API_URL to the deployed backend, e.g.
// https://your-backend.onrender.com/api
const api = axios.create({
  baseURL: import.meta.env.VITE_API_URL || '/api',
  headers: { 'Content-Type': 'application/json' },
});

// A session used to live in localStorage, which is shared by every window of the
// browser profile — so a second window inherited the last login instead of
// asking for it. Sessions are per-window now (see store/authStore.js), which
// leaves any pre-existing localStorage copy as dead data that could still let
// someone back into an account the user believes is closed. Clear it once, on
// first load after the change.
try {
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem('dmm-admin-auth');
} catch {
  // Storage can be unavailable (private mode / blocked cookies) — nothing to clean.
}

api.interceptors.request.use((config) => {
  const token = sessionStorage.getItem(TOKEN_KEY);
  if (token) config.headers.Authorization = `Bearer ${token}`;
  // Attach the admin's currently-selected organization for org-scoped endpoints,
  // unless the call already specifies one explicitly.
  const orgId = localStorage.getItem('dmm_admin_selected_org');
  if (orgId && !config.params?.organizationId) {
    config.headers['x-organization-id'] = orgId;
  }
  return config;
});

// The console is served under a base path (see `base` in vite.config.js), so the
// login URL has to carry it — a bare '/login' is outside the app and 404s.
const LOGIN_PATH = `${import.meta.env.BASE_URL}login`;

api.interceptors.response.use(
  (res) => res,
  (err) => {
    const status = err.response?.status;
    if (status === 401 && !err.config?.url?.includes('/auth/login')) {
      sessionStorage.removeItem(TOKEN_KEY);
      // Drop the zustand-persisted session too, so a reload can't rehydrate a
      // stale user + token behind an invalid session.
      sessionStorage.removeItem('dmm-admin-auth');
      if (window.location.pathname !== LOGIN_PATH) window.location.href = LOGIN_PATH;
    }
    // View-only (Chairman) accounts are hard-blocked from any write on the
    // backend, which replies 403 with a "view-only" message. Surface it so the
    // UI explains why nothing changed.
    if (status === 403) {
      const msg = err.response?.data?.message || '';
      if (msg.toLowerCase().includes('view-only')) toast.error(msg);
    }
    return Promise.reject(err);
  }
);

export default api;
