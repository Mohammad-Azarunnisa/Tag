import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { authApi } from '../api/endpoints.js';

export const useAuthStore = create(
  persist(
    (set, get) => ({
      user: null,
      token: localStorage.getItem('dmm_token') || null,
      loading: false,

      login: async (email, password) => {
        const data = await authApi.login({ email, password });
        localStorage.setItem('dmm_token', data.token);
        set({ user: data.user, token: data.token });
        return data.user;
      },

      logout: () => {
        localStorage.removeItem('dmm_token');
        set({ user: null, token: null });
      },

      // Re-hydrate the user from token on app boot
      fetchMe: async () => {
        const token = localStorage.getItem('dmm_token');
        if (!token) return null;
        try {
          set({ loading: true });
          const data = await authApi.me();
          set({ user: data.user, token, loading: false });
          return data.user;
        } catch {
          localStorage.removeItem('dmm_token');
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
      partialize: (s) => ({ user: s.user, token: s.token }),
    }
  )
);
