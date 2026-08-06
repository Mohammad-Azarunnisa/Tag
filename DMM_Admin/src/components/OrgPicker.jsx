import { useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Building2 } from 'lucide-react';
import { organizationApi } from '../api/endpoints.js';
import { useOrgStore } from '../store/orgStore.js';
import { Card } from './ui/primitives.jsx';

// Lets the admin choose which organization the org-scoped page operates on.
// Selection is stored globally so it persists across Analytics/Calendar.
export default function OrgPicker({ children }) {
  const { selectedOrgId, setSelectedOrg } = useOrgStore();
  const { data, isLoading } = useQuery({ queryKey: ['organizations', 'picker'], queryFn: () => organizationApi.list() });
  const orgs = data?.organizations || [];

  // Auto-select the first org if none chosen yet (or the chosen one disappeared).
  useEffect(() => {
    if (isLoading || !orgs.length) return;
    if (!selectedOrgId || !orgs.find((o) => o._id === selectedOrgId)) setSelectedOrg(orgs[0]._id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isLoading, orgs.length]);

  const active = orgs.find((o) => o._id === selectedOrgId);

  if (!isLoading && orgs.length === 0) {
    return (
      <Card className="p-8 text-center">
        <Building2 className="mx-auto mb-3 h-8 w-8 text-slate-300" />
        <p className="font-semibold text-slate-700 dark:text-slate-200">No organizations yet</p>
        <p className="mt-1 text-sm text-slate-400">Create an organization first, then manage its data here.</p>
      </Card>
    );
  }

  return (
    <div className="space-y-5">
      <div className="flex items-center gap-3 rounded-2xl border border-slate-200/70 dark:border-slate-800 bg-white dark:bg-slate-900 p-3">
        <div className="flex items-center gap-2 pl-1 text-sm font-medium text-slate-500"><Building2 className="h-4 w-4" /> Organization</div>
        <select
          className="input-base max-w-xs cursor-pointer"
          value={selectedOrgId}
          onChange={(e) => setSelectedOrg(e.target.value)}
        >
          {orgs.map((o) => <option key={o._id} value={o._id}>{o.name}</option>)}
        </select>
        {active && <span className="ml-auto text-xs text-slate-400">{active.memberCount} members · {active.postCount} posts</span>}
      </div>
      {selectedOrgId && children(selectedOrgId, active)}
    </div>
  );
}
