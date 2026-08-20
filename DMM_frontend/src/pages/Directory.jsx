import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Users as UsersIcon, Search, Mail, Phone, Crown, Palette, Send, ClipboardList } from 'lucide-react';
import { userApi } from '../api/endpoints.js';
import PageHeader from '../components/layout/PageHeader.jsx';
import { Card, Input, Select, Skeleton, EmptyState, Avatar } from '../components/ui/primitives.jsx';
import { useAuthStore } from '../store/authStore.js';
import { cn } from '../lib/utils.js';

// What someone is, in the words this product uses everywhere else. An Admin is
// role CEO; the three USER personas are told apart by userType.
const ROLE_META = {
  CEO: { label: 'Admin', icon: Crown, cls: 'bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-400' },
  COORDINATOR: { label: 'Coordinator', icon: ClipboardList, cls: 'bg-brand-100 text-brand-700 dark:bg-brand-500/15 dark:text-brand-300' },
  DESIGNER: { label: 'Designer', icon: Palette, cls: 'bg-violet-100 text-violet-700 dark:bg-violet-500/15 dark:text-violet-300' },
  SOCIAL_HANDLER: { label: 'Social Handler', icon: Send, cls: 'bg-sky-100 text-sky-700 dark:bg-sky-500/15 dark:text-sky-300' },
};

const keyOf = (p) => (p.role === 'CEO' ? 'CEO' : p.userType || 'USER');
const metaOf = (p) => ROLE_META[keyOf(p)] || { label: 'User', icon: UsersIcon, cls: 'bg-slate-100 text-slate-600 dark:bg-slate-700/50 dark:text-slate-300' };

// A social handler can serve colleges they do not belong to. Their own college
// comes first, then anything they handle on top of it.
const collegesOf = (p) => {
  const names = [p.organization?.name].filter(Boolean);
  (p.handles || []).forEach((h) => {
    const n = h.organization?.name;
    if (n && !names.includes(n)) names.push(n);
  });
  return names;
};

/**
 * The people you work with, and how to reach them.
 *
 * Scope is decided by the server: everyone gets their own college, and a
 * designer — who takes briefs from any college — also gets every coordinator
 * plus the Admins over their college.
 */
export default function Directory() {
  const me = useAuthStore((s) => s.user);
  const [search, setSearch] = useState('');
  const [role, setRole] = useState('All');

  const { data, isLoading } = useQuery({
    queryKey: ['directory'],
    queryFn: () => userApi.directory(),
  });
  const all = data?.people || [];

  // Filtering happens here rather than on the server so the role counts stay
  // put while you type.
  const people = useMemo(() => {
    const q = search.trim().toLowerCase();
    return all
      .filter((p) => role === 'All' || keyOf(p) === role)
      .filter((p) => !q || [p.name, p.email, p.phone, p.jobTitle, ...collegesOf(p)]
        .some((v) => String(v || '').toLowerCase().includes(q)));
  }, [all, search, role]);

  const counts = useMemo(() => all.reduce((acc, p) => {
    const k = keyOf(p);
    acc[k] = (acc[k] || 0) + 1;
    return acc;
  }, {}), [all]);

  const isDesigner = me?.role === 'USER' && me?.userType === 'DESIGNER';

  return (
    <div>
      <PageHeader
        title="People"
        subtitle={isDesigner
          ? 'Everyone in your college, every coordinator who can send you a brief, and the admins over your college.'
          : 'Everyone you work with in your college — their role, college and how to reach them.'}
      />

      <div className="mb-5 flex flex-col gap-3 sm:flex-row">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 z-10 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <Input className="pl-9" placeholder="Search name, college, email or number…"
            value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
        <Select className="sm:w-56" value={role} onChange={(e) => setRole(e.target.value)}>
          <option value="All">All roles ({all.length})</option>
          {Object.entries(ROLE_META)
            .filter(([k]) => counts[k])
            .map(([k, m]) => <option key={k} value={k}>{m.label} ({counts[k]})</option>)}
        </Select>
      </div>

      {isLoading ? (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-48" />)}
        </div>
      ) : people.length === 0 ? (
        <EmptyState icon={UsersIcon}
          title={all.length ? 'Nobody matches that' : 'No people to show yet'}
          description={all.length
            ? 'Try another name, college or role — or clear the search.'
            : 'Once your college has other accounts, they will appear here.'} />
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {people.map((p) => {
            const m = metaOf(p);
            const RoleIcon = m.icon;
            const colleges = collegesOf(p);
            const isMe = String(p._id) === String(me?._id);
            return (
              <Card key={p._id} className={cn('p-5', isMe && 'ring-2 ring-brand-500/40')}>
                <div className="flex items-start gap-4">
                  {/* Bigger than the app-wide 'lg' avatar — on this page the face
                      is the thing you scan for, so it leads the card. */}
                  <Avatar src={p.avatar} name={p.name} size="lg" className="h-20 w-20 shrink-0 text-xl" />
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-bold text-slate-800 dark:text-white">
                      {p.name}{isMe && <span className="ml-1.5 text-xs font-semibold text-brand-600 dark:text-brand-400">You</span>}
                    </p>
                    {p.jobTitle && <p className="truncate text-xs text-slate-400">{p.jobTitle}</p>}
                    <span className={cn('mt-1.5 inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-bold', m.cls)}>
                      <RoleIcon className="h-3 w-3" /> {m.label}
                    </span>
                  </div>
                </div>

                <p className="mt-3 text-xs text-slate-500 dark:text-slate-400">
                  <span className="font-semibold text-slate-600 dark:text-slate-300">
                    {colleges.length > 1 ? 'Colleges' : 'College'}:
                  </span>{' '}
                  {colleges.length ? colleges.join(', ') : 'Not attached to a college'}
                </p>

                {/* Real links, so a number can be dialled and an address opened
                    straight from here rather than copied out by hand. */}
                <div className="mt-3 space-y-1.5 border-t border-slate-100 pt-3 dark:border-slate-800">
                  {p.email ? (
                    <a href={`mailto:${p.email}`} className="flex items-center gap-2 text-xs text-slate-600 hover:text-brand-600 dark:text-slate-300 dark:hover:text-brand-400">
                      <Mail className="h-3.5 w-3.5 shrink-0 text-slate-400" />
                      <span className="min-w-0 truncate">{p.email}</span>
                    </a>
                  ) : (
                    <p className="flex items-center gap-2 text-xs text-slate-400"><Mail className="h-3.5 w-3.5 shrink-0" /> No email on file</p>
                  )}
                  {p.phone ? (
                    <a href={`tel:${p.phone}`} className="flex items-center gap-2 text-xs text-slate-600 hover:text-brand-600 dark:text-slate-300 dark:hover:text-brand-400">
                      <Phone className="h-3.5 w-3.5 shrink-0 text-slate-400" />
                      <span className="min-w-0 truncate">{p.phone}</span>
                    </a>
                  ) : (
                    <p className="flex items-center gap-2 text-xs text-slate-400"><Phone className="h-3.5 w-3.5 shrink-0" /> No number on file</p>
                  )}
                </div>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
