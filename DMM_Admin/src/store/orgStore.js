import { create } from 'zustand';

// Tracks which organization the admin is currently viewing for org-scoped pages
// (Analytics, Calendar). Mirrored into a plain localStorage key so the axios
// client can attach it as the x-organization-id header automatically.
const KEY = 'dmm_admin_selected_org';

export const useOrgStore = create((set) => ({
  selectedOrgId: localStorage.getItem(KEY) || '',
  setSelectedOrg: (id) => {
    if (id) localStorage.setItem(KEY, id);
    else localStorage.removeItem(KEY);
    set({ selectedOrgId: id || '' });
  },
}));
