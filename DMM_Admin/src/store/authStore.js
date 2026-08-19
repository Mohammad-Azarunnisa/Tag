import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import { authApi } from '../api/endpoints.js';
import { TOKEN_KEY } from '../api/client.js';
import { useOrgStore } from './orgStore.js';

// Raised when a non-admin tries to sign in to the admin portal.
// The session is deliberately kept in sessionStorage, not localStorage:
// localStorage is shared by every window and tab of the browser profile, so
// opening the console in a second window silently inherited the previous login
// and never asked for credentials. sessionStorage is scoped to one window, so
// each new window starts signed out, while a refresh in the current window
// still keeps you where you were.
const sessionStore = () => sessionStorage;

export class NotAdminError extends Error {
  constructor() {
    super('This portal is for administrators only.');
    this.name = 'NotAdminError';
  }
}

export const useAuthStore = create(
  persist(
    (set, get) => ({
      user: null,
      token: sessionStorage.getItem(TOKEN_KEY) || null,

      login: async (email, password) => {
        const data = await authApi.login({ email, password });
        // The super admin and institution Admins (role CEO) both belong here.
        if (!['ADMIN', 'CEO'].includes(data.user.role)) throw new NotAdminError();
        sessionStorage.setItem(TOKEN_KEY, data.token);
        set({ user: data.user, token: data.token });
        return data.user;
      },

      logout: () => {
        sessionStorage.removeItem(TOKEN_KEY);
        set({ user: null, token: null });
        // Don't let the next person on this machine inherit the previous
        // admin's selected organization.
        useOrgStore.getState().setSelectedOrg('');
      },

      fetchMe: async () => {
        const token = sessionStorage.getItem(TOKEN_KEY);
        if (!token) return null;
        try {
          const data = await authApi.me();
          // Guard: if this account no longer administers anything, drop the session.
          if (!['ADMIN', 'CEO'].includes(data.user.role)) {
            sessionStorage.removeItem(TOKEN_KEY);
            set({ user: null, token: null });
            return null;
          }
          set({ user: data.user, token });
          return data.user;
        } catch {
          sessionStorage.removeItem(TOKEN_KEY);
          set({ user: null, token: null });
          return null;
        }
      },

      setUser: (user) => set({ user }),
    }),
    {
      name: 'dmm-admin-auth',
      storage: createJSONStorage(sessionStore),
      partialize: (s) => ({ user: s.user, token: s.token }),
    }
  )
);
