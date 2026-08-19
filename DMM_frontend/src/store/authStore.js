import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import { authApi } from '../api/endpoints.js';

// The session is deliberately kept in sessionStorage, not localStorage:
// localStorage is shared by every window and tab of the browser profile, so
// opening the app in a second window silently inherited the previous login and
// never asked for credentials. sessionStorage is scoped to one window, so each
// new window starts signed out, while a refresh in the current window still
// keeps you where you were.
const sessionStore = () => sessionStorage;

// Raised when an admin account is used on the product app. The API refuses
// these sign-ins too (authController#assertPortal) — this is the second line,
// covering a session that predates the rule or a token moved by hand.
export class AdminAccountError extends Error {
  constructor() {
    super('You are trying to log in with an Admin account. Please use the Admin Portal.');
    this.name = 'AdminAccountError';
  }
}

// Both administrator roles belong in the console: the super admin (ADMIN) and an
// institution Admin (CEO) who runs the colleges they hold. Neither has anything
// to do here, so neither gets a session — on fresh login or on rehydrate.
const isAdminAccount = (user) => ['ADMIN', 'CEO'].includes(user?.role);

export const useAuthStore = create(
  persist(
    (set, get) => ({
      user: null,
      token: sessionStorage.getItem('dmm_token') || null,
      loading: false,

      login: async (email, password) => {
        const data = await authApi.login({ email, password });
        if (isAdminAccount(data.user)) throw new AdminAccountError();
        sessionStorage.setItem('dmm_token', data.token);
        set({ user: data.user, token: data.token });
        return data.user;
      },

      logout: () => {
        sessionStorage.removeItem('dmm_token');
        set({ user: null, token: null });
      },

      // Re-hydrate the user from token on app boot
      fetchMe: async () => {
        const token = sessionStorage.getItem('dmm_token');
        if (!token) return null;
        try {
          set({ loading: true });
          const data = await authApi.me();
          // Guard: an admin account has no session here — drop it rather than
          // rehydrating a portal this user isn't allowed in.
          if (isAdminAccount(data.user)) {
            sessionStorage.removeItem('dmm_token');
            set({ user: null, token: null, loading: false });
            return null;
          }
          set({ user: data.user, token, loading: false });
          return data.user;
        } catch {
          sessionStorage.removeItem('dmm_token');
          set({ user: null, token: null, loading: false });
          return null;
        }
      },

      setUser: (user) => set({ user }),
      isCEO: () => get().user?.role === 'CEO',
      isAdmin: () => get().user?.role === 'ADMIN',
      isDesigner: () => get().user?.role === 'USER' && get().user?.userType === 'DESIGNER',
      isSocialHandler: () => get().user?.role === 'USER' && get().user?.userType === 'SOCIAL_HANDLER',
      isCoordinator: () => get().user?.role === 'USER' && get().user?.userType === 'COORDINATOR',
      // View-only oversight account (e.g. the Chairman): reads everything, writes nothing.
      isViewer: () => !!get().user?.viewOnly,
      // Admin + CEO get cross-org visibility (see all content/analytics).
      isPrivileged: () => ['ADMIN', 'CEO'].includes(get().user?.role),
    }),
    {
      name: 'dmm-auth',
      storage: createJSONStorage(sessionStore),
      partialize: (s) => ({ user: s.user, token: s.token }),
    }
  )
);
