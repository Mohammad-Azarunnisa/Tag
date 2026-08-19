import axios from 'axios';
import toast from 'react-hot-toast';

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
  localStorage.removeItem('dmm_token');
  localStorage.removeItem('dmm-auth');
} catch {
  // Storage can be unavailable (private mode / blocked cookies) — nothing to clean.
}

// Attach JWT from the current window's session on every request
api.interceptors.request.use((config) => {
  const token = sessionStorage.getItem('dmm_token');
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

// Global 401 handling — drop session and bounce to login
api.interceptors.response.use(
  (res) => res,
  (err) => {
    if (err.response?.status === 401 && !err.config?.url?.includes('/auth/login')) {
      sessionStorage.removeItem('dmm_token');
      // Also drop the zustand-persisted session (store/authStore.js persist name
      // 'dmm-auth') so a reload can't rehydrate a stale/invalid user + token.
      // Cleared by key directly, not by importing useAuthStore, which would
      // create an import cycle (authStore.js -> api/endpoints.js -> this file).
      sessionStorage.removeItem('dmm-auth');
      if (!window.location.pathname.startsWith('/login')) window.location.href = '/login';
    }
    // View-only (Chairman) accounts are blocked from writes server-side — surface
    // a friendly message instead of a raw error if a control slips through.
    const msg = err.response?.data?.message || '';
    if (err.response?.status === 403 && /view-only/i.test(msg)) toast.error(msg);
    return Promise.reject(err);
  }
);

export default api;
