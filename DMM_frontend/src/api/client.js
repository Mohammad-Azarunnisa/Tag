import axios from 'axios';
import toast from 'react-hot-toast';

// In dev, '/api' is proxied to the backend by Vite (see vite.config.js).
// In production, set VITE_API_URL to the deployed backend, e.g.
// https://your-backend.onrender.com/api
const api = axios.create({
  baseURL: import.meta.env.VITE_API_URL || '/api',
  headers: { 'Content-Type': 'application/json' },
});

// Attach JWT from localStorage on every request
api.interceptors.request.use((config) => {
  const token = localStorage.getItem('dmm_token');
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

// Global 401 handling — drop session and bounce to login
api.interceptors.response.use(
  (res) => res,
  (err) => {
    if (err.response?.status === 401 && !err.config?.url?.includes('/auth/login')) {
      localStorage.removeItem('dmm_token');
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
