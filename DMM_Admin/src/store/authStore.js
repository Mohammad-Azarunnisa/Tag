import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { authApi } from '../api/endpoints.js';
import { TOKEN_KEY } from '../api/client.js';

// Raised when a non-admin tries to sign in to the admin portal.
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
      token: localStorage.getItem(TOKEN_KEY) || null,

      login: async (email, password) => {
        const data = await authApi.login({ email, password });
        if (data.user.role !== 'ADMIN') throw new NotAdminError();
        localStorage.setItem(TOKEN_KEY, data.token);
        set({ user: data.user, token: data.token });
        return data.user;
      },

      logout: () => {
        localStorage.removeItem(TOKEN_KEY);
        set({ user: null, token: null });
      },

      fetchMe: async () => {
        const token = localStorage.getItem(TOKEN_KEY);
        if (!token) return null;
        try {
          const data = await authApi.me();
          // Guard: if this account is no longer an admin, drop the session.
          if (data.user.role !== 'ADMIN') {
            localStorage.removeItem(TOKEN_KEY);
            set({ user: null, token: null });
            return null;
          }
          set({ user: data.user, token });
          return data.user;
        } catch {
          localStorage.removeItem(TOKEN_KEY);
          set({ user: null, token: null });
          return null;
        }
      },

      setUser: (user) => set({ user }),
    }),
    {
      name: 'dmm-admin-auth',
      partialize: (s) => ({ user: s.user, token: s.token }),
    }
  )
);
