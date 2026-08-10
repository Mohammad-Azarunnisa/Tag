import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Building2 } from 'lucide-react';
import { organizationApi } from '../api/endpoints.js';
import { useOrgStore } from '../store/orgStore.js';
import { Card } from './ui/primitives.jsx';

// The value `children` receives instead of an org id when the reader has asked
// to see every college at once.
export const ALL_ORGS = 'all';

// Lets the admin choose which organization the org-scoped page operates on.
// Selection is stored globally so it persists across Analytics/Calendar.
//
// `allowAll` adds an "All organizations" entry and opens on it — a page that
// offers the roll-up wants the whole picture first, then narrowing. It is opt-in
// because most pages here are built around exactly one college.
//
// Crucially, choosing it does NOT go into the global store: that store is
// mirrored into localStorage and sent as the x-organization-id header on every
// request in the app, so parking a non-id sentinel there would follow the reader
// onto Analytics, Calendar and the rest. It stays local, and a real college is
// still resolved underneath so narrowing to one is always available.
export default function OrgPicker({ allowAll = false, children }) {
  const { selectedOrgId, setSelectedOrg } = useOrgStore();
  const [showAll, setShowAll] = useState(allowAll);
  const { data, isLoading } = useQuery({ queryKey: ['organizations', 'picker'], queryFn: () => organizationApi.list() });
  // Every college in the system, A–Z. The API returns them newest-first, which
  // in a long list reads as though colleges are missing; sorting by name is
  // what makes "is my college here?" answerable at a glance. Deactivated ones
  // are kept — their purchases and history still have to be reachable — but
  // labelled, so picking one is never a surprise.
  const orgs = [...(data?.organizations || [])].sort((a, b) =>
    a.name.localeCompare(b.name, undefined, { sensitivity: 'base' })
  );

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
          value={showAll ? ALL_ORGS : selectedOrgId}
          onChange={(e) => {
            const next = e.target.value;
            setShowAll(next === ALL_ORGS);
            if (next !== ALL_ORGS) setSelectedOrg(next);
          }}
        >
          {allowAll && <option value={ALL_ORGS}>All organizations</option>}
          {orgs.map((o) => (
            <option key={o._id} value={o._id}>{o.name}{o.isActive === false ? ' (inactive)' : ''}</option>
          ))}
        </select>
        {showAll
          ? <span className="ml-auto text-xs text-slate-400">{orgs.length} organizations</span>
          : active && <span className="ml-auto text-xs text-slate-400">{active.memberCount} members · {active.postCount} posts</span>}
      </div>
      {showAll ? children(ALL_ORGS, null) : selectedOrgId && children(selectedOrgId, active)}
    </div>
  );
}
