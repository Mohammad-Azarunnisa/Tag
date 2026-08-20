import { useEffect, useRef, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import {
  UserPlus, Search, Pencil, KeyRound, Trash2, Users as UsersIcon, ShieldCheck, Crown, User as UserIcon, MoreVertical, Power, Plus, X, Eye,
  Camera, ImageOff, LayoutGrid, List, Mail, CalendarDays,
} from 'lucide-react';
import { userApi, organizationApi } from '../api/endpoints.js';
import { useAuthStore } from '../store/authStore.js';
import PageHeader from '../components/layout/PageHeader.jsx';
import ProfileReviews from '../components/ProfileReviews.jsx';
import { Button } from '../components/ui/Button.jsx';
import { Card, Input, Select, Badge, Avatar, Skeleton, EmptyState } from '../components/ui/primitives.jsx';
import { Modal } from '../components/ui/Modal.jsx';
import { cn, formatDate, roleLabel, roleStyle, userTypeLabel } from '../lib/utils.js';

// Filter options (label → internal role or USER sub-type). 'SUPER' is the
// account flag rather than a role value — role ADMIN also covers view-only
// oversight accounts, which are not the super admin.
const ROLE_FILTERS = [
  { value: 'SUPER', label: 'Super Admin' },
  { value: 'CEO', label: 'Admin' },
  { value: 'COORDINATOR', label: 'Coordinator' },
  { value: 'DESIGNER', label: 'Designer' },
  { value: 'SOCIAL_HANDLER', label: 'Social Handler' },
];
// Roles the super admin can assign. 'SUPER' → ADMIN + isSuperAdmin (Branding
// Director). 'CHAIRMAN' → global ADMIN + viewOnly (read-only oversight).
const CREATE_ROLES = [
  { value: 'SUPER', label: 'Super Admin (Branding Director — all organizations)' },
  { value: 'CHAIRMAN', label: 'Chairman (view-only — all activity)' },
  { value: 'CEO', label: 'Admin' },
  { value: 'USER', label: 'User' },
];
const USER_TYPES = [{ value: 'DESIGNER', label: 'Designer' }, { value: 'SOCIAL_HANDLER', label: 'Social Handler' }, { value: 'COORDINATOR', label: 'Coordinator' }];
const PAGE_PLATFORMS = ['LinkedIn', 'Instagram', 'YouTube', 'Facebook', 'X (Twitter)'];
const AZAR_HANDLE_ORGS = ['Torii Minds', 'NCET', 'NCMS', 'NDC', 'Technical Hub'];
const roleIcon = (u) => (u?.isSuperAdmin ? ShieldCheck : u?.role === 'USER' ? UserIcon : Crown);
// Table or cards. Remembered per browser so the choice survives a reload and
// moving between pages, rather than resetting to list every time.
const VIEW_KEY = 'users:view';

export default function Users() {
  const qc = useQueryClient();
  const { user: me } = useAuthStore();
  const isViewer = !!me?.viewOnly; // Chairman: sees everything, changes nothing
  const canManage = !!me?.isSuperAdmin && !isViewer; // only a super admin who can write creates / edits accounts
  const [filters, setFilters] = useState({ search: '', role: 'All', organization: 'All' });
  const [modal, setModal] = useState(null);
  const [menuFor, setMenuFor] = useState(null);
  const [view, setView] = useState(() => (localStorage.getItem(VIEW_KEY) === 'grid' ? 'grid' : 'list'));

  const pickView = (next) => {
    setView(next);
    setMenuFor(null); // an open row menu belongs to the layout you just left
    localStorage.setItem(VIEW_KEY, next);
  };

  const { data, isLoading } = useQuery({ queryKey: ['users', filters], queryFn: () => userApi.list(filters) });
  const users = data?.users || [];
  const { data: orgData } = useQuery({ queryKey: ['organizations', 'all'], queryFn: () => organizationApi.list() });
  const orgs = orgData?.organizations || [];
  // Counted server-side out of everything in view except the role tile, so
  // picking one tile never drops the others to zero.
  const roleCounts = data?.roleCounts || {};

  const removeMut = useMutation({
    mutationFn: (id) => userApi.remove(id),
    onSuccess: () => { toast.success('User deleted'); qc.invalidateQueries({ queryKey: ['users'] }); },
    onError: (e) => toast.error(e.response?.data?.message || 'Delete failed'),
  });
  const toggleMut = useMutation({
    mutationFn: ({ id, isActive }) => userApi.update(id, { isActive }),
    onSuccess: () => { toast.success('User updated'); qc.invalidateQueries({ queryKey: ['users'] }); },
    onError: (e) => toast.error(e.response?.data?.message || 'Update failed'),
  });

  // Only the super admin's own login lists that account, so the tile counts from
  // the server rather than from the rows — otherwise everyone else would be told
  // there are none, when the truth is "there is one, and it is not yours to see".
  const superAdmins = data?.superAdminCount ?? users.filter((u) => u.isSuperAdmin).length;
  // Each tile IS its role filter — clicking one narrows the list, clicking it
  // again clears it. `role` is what gets sent; null means the tile is a total
  // rather than a filter.
  const stats = [
    { label: 'Total Users', value: roleCounts.total ?? users.length, icon: UsersIcon, role: 'All', cls: 'text-brand-600 bg-brand-50 dark:bg-brand-500/10' },
    {
      label: 'Super Admin',
      value: superAdmins,
      icon: ShieldCheck,
      // Only the super admin can open that account; for everyone else the tile
      // states a fact and is not a filter, since it could only ever come back
      // empty for them.
      role: me?.isSuperAdmin ? 'SUPER' : null,
      cls: 'text-violet-600 bg-violet-50 dark:bg-violet-500/10',
      note: me?.isSuperAdmin ? null : 'Account details are private',
    },
    { label: 'Admins', value: roleCounts.CEO || 0, icon: Crown, role: 'CEO', cls: 'text-amber-600 bg-amber-50 dark:bg-amber-500/10' },
    { label: 'Users', value: roleCounts.USER || 0, icon: UserIcon, role: 'USER', cls: 'text-sky-600 bg-sky-50 dark:bg-sky-500/10' },
  ];

  // 'All' is the reset tile, so it is "active" only when nothing is filtered.
  const tileActive = (s) => (s.role === 'All' ? filters.role === 'All' : filters.role === s.role);
  const pickRole = (s) => {
    if (!s.role) return;
    setFilters({ ...filters, role: s.role === 'All' || filters.role === s.role ? 'All' : s.role });
  };

  // The same row menu drives both layouts, so a card offers exactly what a table
  // row does — no second copy of the rules about who may do what.
  const actionProps = (u) => ({
    isSelf: u._id === me?._id,
    canManage,
    isActive: u.isActive,
    open: menuFor === u._id,
    onToggle: () => setMenuFor(menuFor === u._id ? null : u._id),
    onClose: () => setMenuFor(null),
    onEdit: () => { setMenuFor(null); setModal({ type: 'edit', user: u }); },
    onReset: () => { setMenuFor(null); setModal({ type: 'reset', user: u }); },
    onToggleActive: () => { setMenuFor(null); toggleMut.mutate({ id: u._id, isActive: !u.isActive }); },
    onDelete: () => { setMenuFor(null); if (window.confirm(`Delete ${u.name}?`)) removeMut.mutate(u._id); },
  });

  return (
    <div>
      <PageHeader title="User Management" subtitle={canManage ? 'Create and manage accounts, roles and access.' : 'View accounts and roles. Only the super admin can create or edit accounts.'}
        actions={canManage && <Button onClick={() => setModal({ type: 'create' })}><UserPlus className="h-4 w-4" /> Add User</Button>} />

      <ProfileReviews />

      <div className="mb-6 grid grid-cols-2 gap-4 lg:grid-cols-4">
        {stats.map((s) => (
          <Card
            key={s.label}
            {...(s.role ? {
              role: 'button',
              tabIndex: 0,
              onClick: () => pickRole(s),
              onKeyDown: (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); pickRole(s); } },
              title: s.role === 'All' ? 'Show everyone' : `Show only ${s.label}`,
            } : {})}
            className={cn('flex items-center gap-3 p-4',
              s.role && 'cursor-pointer transition hover:-translate-y-0.5 hover:shadow-glow',
              s.role && tileActive(s) && 'ring-2 ring-brand-500/40')}
          >
            <div className={`rounded-xl p-2.5 ${s.cls}`}><s.icon className="h-5 w-5" /></div>
            <div className="min-w-0">
              <p className="text-2xl font-extrabold text-slate-800 dark:text-white">{s.value}</p>
              <p className="text-xs text-slate-400">{s.label}</p>
              {s.note && <p className="mt-0.5 text-[11px] leading-tight text-slate-400">{s.note}</p>}
            </div>
          </Card>
        ))}
      </div>

      <div className="mb-5 flex flex-col gap-3 sm:flex-row">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <Input placeholder="Search by name or email..." className="pl-9" value={filters.search} onChange={(e) => setFilters({ ...filters, search: e.target.value })} />
        </div>
        <Select className="sm:w-44" value={filters.role} onChange={(e) => setFilters({ ...filters, role: e.target.value })}>
          <option value="All">All Roles</option>
          {/* Filtering to Super Admin can only ever come back empty for anyone
              but the super admin, so it is not offered to them. */}
          {ROLE_FILTERS.filter((r) => r.value !== 'SUPER' || me?.isSuperAdmin)
            .map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
        </Select>
        <Select className="sm:w-52" value={filters.organization} onChange={(e) => setFilters({ ...filters, organization: e.target.value })}>
          <option value="All">All colleges</option>
          {orgs.map((o) => <option key={o._id} value={o._id}>{o.name}</option>)}
        </Select>
        <div className="flex shrink-0 items-center gap-1 rounded-xl border border-slate-200 p-1 dark:border-slate-700">
          {[{ key: 'list', icon: List, label: 'List view' }, { key: 'grid', icon: LayoutGrid, label: 'Grid view' }].map((v) => (
            <button key={v.key} type="button" onClick={() => pickView(v.key)} title={v.label} aria-label={v.label}
              aria-pressed={view === v.key}
              className={cn('flex h-9 w-9 items-center justify-center rounded-lg transition-colors',
                view === v.key
                  ? 'bg-brand-600 text-white'
                  : 'text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800')}>
              <v.icon className="h-4 w-4" />
            </button>
          ))}
        </div>
      </div>

      {isLoading ? (
        view === 'grid' ? (
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">{Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-64" />)}</div>
        ) : (
          <div className="space-y-2">{Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-16" />)}</div>
        )
      ) : users.length === 0 ? (
        <EmptyState icon={UsersIcon} title="No users found" description={canManage ? 'Add a user to get started.' : 'No users to show.'}
          action={canManage && <Button onClick={() => setModal({ type: 'create' })}><UserPlus className="h-4 w-4" /> Add User</Button>} />
      ) : view === 'grid' ? (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {users.map((u) => <UserCard key={u._id} user={u} {...actionProps(u)} />)}
        </div>
      ) : (
        <Card className="overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-100 dark:border-slate-800 text-left text-xs uppercase text-slate-400">
                  <th className="px-5 py-3 font-semibold">User</th>
                  <th className="px-5 py-3 font-semibold">Role</th>
                  <th className="px-5 py-3 font-semibold">Organization</th>
                  <th className="px-5 py-3 font-semibold">Status</th>
                  <th className="px-5 py-3 font-semibold">Joined</th>
                  <th className="px-5 py-3 font-semibold text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-50 dark:divide-slate-800/50">
                {users.map((u) => {
                  const RoleIcon = roleIcon(u);
                  const isSelf = u._id === me?._id;
                  return (
                    <tr key={u._id} className="hover:bg-slate-50/50 dark:hover:bg-slate-800/30">
                      <td className="px-5 py-3">
                        <div className="flex items-center gap-3">
                          <Avatar src={u.avatar} name={u.name} size="sm" />
                          <div>
                            <p className="flex flex-wrap items-center gap-1.5 font-semibold text-slate-700 dark:text-slate-200">
                              {u.name} {isSelf && <span className="text-xs font-normal text-slate-400">(you)</span>}
                              {u.viewOnly && (
                                <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-semibold text-amber-700 dark:bg-amber-500/15 dark:text-amber-300">
                                  <Eye className="h-3 w-3" /> View-only
                                </span>
                              )}
                            </p>
                            <p className="text-xs text-slate-400">
                              {u.email}{u.jobTitle ? ` · ${u.jobTitle}` : ''}
                              {u.role === 'USER' && u.userType ? ` · ${userTypeLabel(u.userType)}` : ''}
                            </p>
                            {u.handles?.length > 0 && (
                              <p className="mt-1 text-[11px] text-slate-400">
                                Handles {u.handles.map((h) => `${h.organization?.name || 'Org'}: ${(h.platforms || []).join(', ')}`).join(' · ')}
                              </p>
                            )}
                            {u.skills?.length > 0 && (
                              <div className="mt-1 flex flex-wrap gap-1">
                                {u.skills.slice(0, 4).map((s, i) => (
                                  <span key={i} className="rounded-full bg-slate-100 px-1.5 py-0.5 text-[10px] font-medium text-slate-500 dark:bg-slate-800 dark:text-slate-400">{s}</span>
                                ))}
                                {u.skills.length > 4 && <span className="text-[10px] text-slate-400">+{u.skills.length - 4}</span>}
                              </div>
                            )}
                          </div>
                        </div>
                      </td>
                      <td className="px-5 py-3">
                        <span className={`inline-flex min-h-6 items-center justify-center gap-1 whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs font-semibold leading-none ${roleStyle(u)}`}><RoleIcon className="h-3 w-3" />{roleLabel(u)}</span>
                      </td>
                      <td className="px-5 py-3">
                        {u.organization ? (
                          <span className="inline-flex items-center gap-1.5 text-slate-600 dark:text-slate-300">
                            <span className="h-2 w-2 rounded-full" style={{ background: u.organization.color || '#6366f1' }} />
                            {u.organization.name}
                          </span>
                        ) : <span className="text-xs text-slate-400">— Global —</span>}
                      </td>
                      <td className="px-5 py-3">
                        <Badge className={u.isActive ? 'min-h-6 justify-center whitespace-nowrap leading-none bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-400' : 'min-h-6 justify-center whitespace-nowrap leading-none bg-slate-100 text-slate-500 dark:bg-slate-800'}>{u.isActive ? 'Active' : 'Inactive'}</Badge>
                      </td>
                      <td className="px-5 py-3 text-slate-500 dark:text-slate-400">{formatDate(u.createdAt)}</td>
                      <td className="px-5 py-3">
                        <RowActions {...actionProps(u)} />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {modal?.type === 'create' && <UserFormModal onClose={() => setModal(null)} onSaved={() => { setModal(null); qc.invalidateQueries({ queryKey: ['users'] }); }} />}
      {modal?.type === 'edit' && <UserFormModal editUser={modal.user} onClose={() => setModal(null)} onSaved={() => { setModal(null); qc.invalidateQueries({ queryKey: ['users'] }); }} />}
      {modal?.type === 'reset' && <ResetPasswordModal user={modal.user} onClose={() => setModal(null)} />}
    </div>
  );
}

const MenuItem = ({ icon: Icon, label, onClick, danger }) => (
  <button onClick={onClick} className={`flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm ${danger ? 'text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-500/10' : 'text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800'}`}>
    <Icon className="h-4 w-4" /> {label}
  </button>
);

// The row menu, shared by the table and the cards. A Chairman (view-only) gets
// a dash instead — the same "nothing to do here" the table has always shown.
function RowActions({ isSelf, canManage, isActive, open, onToggle, onClose, onEdit, onReset, onToggleActive, onDelete }) {
  if (!canManage) return <div className="flex justify-end text-xs text-slate-300 dark:text-slate-600">—</div>;
  return (
    <div className="relative flex justify-end">
      <button onClick={onToggle} aria-label="Actions" className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800"><MoreVertical className="h-4 w-4" /></button>
      {open && (
        <>
          <div className="fixed inset-0 z-10" onClick={onClose} />
          <div className="absolute right-0 top-9 z-20 w-44 rounded-xl border border-slate-100 dark:border-slate-800 bg-white dark:bg-slate-900 p-1.5 shadow-card">
            <MenuItem icon={Pencil} label="Edit" onClick={onEdit} />
            <MenuItem icon={KeyRound} label="Reset password" onClick={onReset} />
            <MenuItem icon={Power} label={isActive ? 'Deactivate' : 'Activate'} onClick={onToggleActive} />
            {!isSelf && <MenuItem icon={Trash2} label="Delete" danger onClick={onDelete} />}
          </div>
        </>
      )}
    </div>
  );
}

/**
 * One account as a card — the grid-view counterpart of a table row.
 *
 * Carries every column the table does (role, organization, status, joined) plus
 * the same handles and skills, so switching layout changes the shape of the
 * page and nothing about what you can see or do.
 */
function UserCard({ user: u, ...actions }) {
  const RoleIcon = roleIcon(u);
  return (
    <Card className={cn('flex flex-col p-5', !u.isActive && 'opacity-75')}>
      <div className="flex items-start gap-4">
        <Avatar src={u.avatar} name={u.name} size="lg" className="h-20 w-20 shrink-0 text-xl" />
        <div className="min-w-0 flex-1">
          <p className="flex flex-wrap items-center gap-1.5 font-bold text-slate-800 dark:text-white">
            <span className="truncate">{u.name}</span>
            {actions.isSelf && <span className="text-xs font-normal text-slate-400">(you)</span>}
          </p>
          {(u.jobTitle || (u.role === 'USER' && u.userType)) && (
            <p className="truncate text-xs text-slate-400">
              {[u.jobTitle, u.role === 'USER' && u.userType ? userTypeLabel(u.userType) : null].filter(Boolean).join(' · ')}
            </p>
          )}
          <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
            <span className={`inline-flex min-h-6 items-center gap-1 whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs font-semibold leading-none ${roleStyle(u)}`}>
              <RoleIcon className="h-3 w-3" />{roleLabel(u)}
            </span>
            <Badge className={u.isActive
              ? 'min-h-6 justify-center whitespace-nowrap leading-none bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-400'
              : 'min-h-6 justify-center whitespace-nowrap leading-none bg-slate-100 text-slate-500 dark:bg-slate-800'}>
              {u.isActive ? 'Active' : 'Inactive'}
            </Badge>
            {u.viewOnly && (
              <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-semibold text-amber-700 dark:bg-amber-500/15 dark:text-amber-300">
                <Eye className="h-3 w-3" /> View-only
              </span>
            )}
          </div>
        </div>
        <div className="-mr-1 -mt-1 shrink-0"><RowActions {...actions} /></div>
      </div>

      <div className="mt-4 space-y-2 border-t border-slate-100 pt-3 text-xs dark:border-slate-800">
        <a href={`mailto:${u.email}`} className="flex items-center gap-2 text-slate-600 hover:text-brand-600 dark:text-slate-300 dark:hover:text-brand-400">
          <Mail className="h-3.5 w-3.5 shrink-0 text-slate-400" />
          <span className="min-w-0 truncate">{u.email}</span>
        </a>
        <p className="flex items-center gap-2 text-slate-600 dark:text-slate-300">
          {u.organization ? (
            <>
              <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: u.organization.color || '#6366f1' }} />
              <span className="min-w-0 truncate">{u.organization.name}</span>
            </>
          ) : (
            <>
              <span className="h-2 w-2 shrink-0 rounded-full bg-slate-300 dark:bg-slate-600" />
              <span className="text-slate-400">— Global —</span>
            </>
          )}
        </p>
        <p className="flex items-center gap-2 text-slate-500 dark:text-slate-400">
          <CalendarDays className="h-3.5 w-3.5 shrink-0 text-slate-400" />
          Joined {formatDate(u.createdAt)}
        </p>
      </div>

      {u.handles?.length > 0 && (
        <p className="mt-3 text-[11px] leading-relaxed text-slate-400">
          Handles {u.handles.map((h) => `${h.organization?.name || 'Org'}: ${(h.platforms || []).join(', ')}`).join(' · ')}
        </p>
      )}
      {u.skills?.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-1">
          {u.skills.slice(0, 4).map((s, i) => (
            <span key={i} className="rounded-full bg-slate-100 px-1.5 py-0.5 text-[10px] font-medium text-slate-500 dark:bg-slate-800 dark:text-slate-400">{s}</span>
          ))}
          {u.skills.length > 4 && <span className="text-[10px] text-slate-400">+{u.skills.length - 4}</span>}
        </div>
      )}
    </Card>
  );
}

function UserFormModal({ editUser, onClose, onSaved }) {
  const [form, setForm] = useState({
    name: editUser?.name || '', email: editUser?.email || '', password: '',
    role: editUser?.isSuperAdmin ? 'SUPER' : editUser?.viewOnly ? 'CHAIRMAN' : (editUser?.role || 'USER'), jobTitle: editUser?.jobTitle || '',
    userType: editUser?.userType || 'DESIGNER',
    phone: editUser?.phone || '', linkedinUrl: editUser?.linkedinUrl || '',
    skills: (editUser?.skills || []).join(', '),
    organization: editUser?.organization?._id || editUser?.organization || '',
    // Extra institutions put under an Admin, beyond their own college.
    managedOrganizations: (editUser?.managedOrganizations || []).map((o) => String(o?._id || o)),
    handles: (editUser?.handles || []).length
      ? editUser.handles.map((h) => ({ organization: String(h.organization?._id || h.organization), platforms: h.platforms || [] }))
      : [{ organization: '', platforms: [] }],
  });
  const [loading, setLoading] = useState(false);
  // The profile picture, set at creation time. `preview` is a local blob URL
  // while a new file is chosen, or the saved avatar when editing.
  const [avatar, setAvatar] = useState(null);
  const [preview, setPreview] = useState(editUser?.avatar || '');
  // Tracks the currently-active blob URL so it can be revoked on replacement,
  // undo, or unmount instead of leaking.
  const objectUrlRef = useRef(null);
  const revokePreview = () => {
    if (objectUrlRef.current) { URL.revokeObjectURL(objectUrlRef.current); objectUrlRef.current = null; }
  };
  useEffect(() => () => revokePreview(), []);
  const { data: orgData } = useQuery({ queryKey: ['organizations', 'all'], queryFn: () => organizationApi.list() });
  const orgs = orgData?.organizations || [];
  const isSuper = form.role === 'SUPER';
  const isChairman = form.role === 'CHAIRMAN';
  const needsOrg = form.role === 'CEO' || form.role === 'USER';
  const needsUserType = form.role === 'USER';
  // Only an Admin heads institutions, so only they can be given more.
  const canHoldInstitutions = form.role === 'CEO';
  const extraOrgs = orgs.filter((o) => String(o._id) !== String(form.organization));
  // Everything this Admin will be able to reach: their own institution plus the
  // ones ticked. Shown back as names, because a count of checkboxes is not the
  // same as knowing who you just gave access to.
  const grantedNames = orgs
    .filter((o) => form.managedOrganizations.includes(String(o._id)))
    .map((o) => o.name);
  const homeName = orgs.find((o) => String(o._id) === String(form.organization))?.name;
  const accessNames = [homeName, ...grantedNames].filter(Boolean);

  const updateHandle = (index, patch) => {
    setForm((prev) => ({
      ...prev,
      handles: prev.handles.map((row, i) => (i === index ? { ...row, ...patch } : row)),
    }));
  };

  const togglePlatform = (index, platform) => {
    setForm((prev) => {
      const row = prev.handles[index];
      const platforms = row.platforms.includes(platform)
        ? row.platforms.filter((p) => p !== platform)
        : [...row.platforms, platform];
      return { ...prev, handles: prev.handles.map((item, i) => (i === index ? { ...item, platforms } : item)) };
    });
  };

  const addHandleRow = () => setForm((prev) => ({ ...prev, handles: [...prev.handles, { organization: '', platforms: [] }] }));
  const removeHandleRow = (index) => setForm((prev) => ({ ...prev, handles: prev.handles.filter((_, i) => i !== index) }));
  const cleanHandles = (rows) => rows.filter((h) => h.organization && h.platforms.length).map((h) => ({ organization: h.organization, platforms: h.platforms }));

  useEffect(() => {
    if (!editUser) return;
    if (String(editUser.name || '').trim().toLowerCase() !== 'azar') return;
    if ((editUser.handles || []).length) return;
    if (!orgs.length) return;

    const preset = AZAR_HANDLE_ORGS
      .map((name) => orgs.find((org) => org.name?.trim().toLowerCase() === name.trim().toLowerCase()))
      .filter(Boolean)
      .map((org) => ({ organization: org._id, platforms: ['LinkedIn'] }));

    if (preset.length) {
      setForm((prev) => ({ ...prev, handles: preset }));
    }
  }, [editUser, orgs]);

  // Pick a picture: images only, and never something so large it stalls the save.
  const pickAvatar = (file) => {
    if (!file) return;
    if (!file.type.startsWith('image/') || /svg/i.test(file.type)) {
      toast.error('Choose a PNG, JPG, WEBP or GIF image');
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      toast.error('That image is over 5 MB — please pick a smaller one');
      return;
    }
    revokePreview();
    const url = URL.createObjectURL(file);
    objectUrlRef.current = url;
    setAvatar(file);
    setPreview(url);
  };

  // A file forces multipart; without one the JSON path is untouched. FormData
  // stringifies everything, so nulls are dropped rather than sent as the text
  // "null" (which the server would read as a real value), while empty strings
  // ARE sent — that is how a job title or phone number gets cleared. `handles`
  // travels as JSON because form fields can't carry nested objects.
  const toFormData = (payload, file) => {
    const fd = new FormData();
    Object.entries(payload).forEach(([key, value]) => {
      if (value === null || value === undefined) return;
      const nested = key === 'handles' || key === 'managedOrganizations';
      fd.append(key, nested ? JSON.stringify(value) : String(value));
    });
    fd.append('avatar', file);
    return fd;
  };

  const submit = async (e) => {
    e.preventDefault();
    if (needsOrg && !form.organization) { toast.error('Select an organization for this user'); return; }
    setLoading(true);
    try {
      const payload = {
        name: form.name, role: (isSuper || isChairman) ? 'ADMIN' : form.role, isSuperAdmin: isSuper,
        viewOnly: isChairman,
        userType: form.role === 'USER' ? form.userType : null,
        jobTitle: form.jobTitle, phone: form.phone, linkedinUrl: form.linkedinUrl,
        skills: form.skills,
        handles: cleanHandles(form.handles),
        organization: needsOrg ? form.organization : null,
        // Sent for an Admin only; the server clears it for any other role.
        managedOrganizations: canHoldInstitutions ? form.managedOrganizations : [],
      };
      if (editUser) {
        await userApi.update(editUser._id, avatar ? toFormData(payload, avatar) : payload);
        toast.success(avatar ? 'User and profile picture updated' : 'User updated');
      } else {
        const full = { ...payload, email: form.email, password: form.password };
        await userApi.create(avatar ? toFormData(full, avatar) : full);
        toast.success('User created');
      }
      onSaved();
    } catch (err) { toast.error(err.response?.data?.message || 'Save failed'); }
    finally { setLoading(false); }
  };

  return (
    <Modal open onClose={onClose} title={editUser ? 'Edit User' : 'Add User'}>
      <form onSubmit={submit} className="space-y-4">
        {/* Profile picture — set here and it's the avatar everywhere in both apps */}
        <div className="flex items-center gap-4 rounded-2xl border border-slate-200 p-4 dark:border-slate-700">
          {preview ? (
            <img src={preview} alt="" className="h-20 w-20 shrink-0 rounded-full object-cover ring-2 ring-brand-100 dark:ring-brand-500/20" />
          ) : (
            <span className="flex h-20 w-20 shrink-0 items-center justify-center rounded-full bg-slate-100 text-slate-400 dark:bg-slate-800">
              <ImageOff className="h-7 w-7" />
            </span>
          )}
          <div className="min-w-0">
            <p className="text-sm font-bold text-slate-800 dark:text-white">Profile picture</p>
            <p className="mt-0.5 text-xs text-slate-400">
              PNG, JPG, WEBP or GIF up to 5 MB. Shown as this person's avatar across the platform.
            </p>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <label className="inline-flex cursor-pointer items-center gap-1.5 rounded-xl border border-slate-200 px-3 py-2 text-sm font-semibold text-slate-600 transition-colors hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800">
                <Camera className="h-4 w-4" />
                {preview ? 'Change photo' : 'Upload photo'}
                <input type="file" accept="image/png,image/jpeg,image/webp,image/gif" className="hidden"
                  onChange={(e) => { pickAvatar(e.target.files?.[0]); e.target.value = ''; }} />
              </label>
              {avatar && (
                <button type="button" onClick={() => { revokePreview(); setAvatar(null); setPreview(editUser?.avatar || ''); }}
                  className="rounded-xl px-2.5 py-2 text-sm font-semibold text-slate-400 transition-colors hover:text-rose-600">
                  Undo
                </button>
              )}
            </div>
          </div>
        </div>

        <Input label="Full name" required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="e.g. Jane Doe" />
        <Input label="Email" type="email" required disabled={!!editUser} value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} placeholder="user@company.com" />
        {!editUser && <Input label="Temporary password" type="password" required value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} placeholder="At least 6 characters" />}
        <div className="grid grid-cols-2 gap-4">
          <Select label="Role" value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })}>
            {CREATE_ROLES.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
          </Select>
          <Input label="Job title" value={form.jobTitle} onChange={(e) => setForm({ ...form, jobTitle: e.target.value })} placeholder="e.g. Manager" />
        </div>
        {isChairman && (
          <div className="flex items-start gap-2.5 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm dark:border-amber-500/30 dark:bg-amber-500/10">
            <Eye className="mt-0.5 h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400" />
            <span className="text-slate-600 dark:text-slate-300">A view-only oversight account (global). Sees all activity but cannot change anything.</span>
          </div>
        )}
        {needsUserType && (
          <Select label="User type" value={form.userType} onChange={(e) => setForm({ ...form, userType: e.target.value })}>
            {USER_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
          </Select>
        )}
        <div className="grid grid-cols-2 gap-3">
          <Input label="Phone / contact number" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} placeholder="+91 98765 43210" />
          <Input label="LinkedIn profile URL" value={form.linkedinUrl} onChange={(e) => setForm({ ...form, linkedinUrl: e.target.value })} placeholder="https://linkedin.com/in/…" />
        </div>
        <Input label="Skill set (comma separated)" value={form.skills} onChange={(e) => setForm({ ...form, skills: e.target.value })} placeholder="e.g. Video Editing, Photo Editing, Photography" />
        {form.skills.trim() && (
          <div className="flex flex-wrap gap-1.5">
            {form.skills.split(',').map((s) => s.trim()).filter(Boolean).map((s, i) => (
              <span key={i} className="rounded-full bg-brand-50 px-2 py-0.5 text-xs font-medium text-brand-700 dark:bg-brand-500/10 dark:text-brand-300">{s}</span>
            ))}
          </div>
        )}
        {canHoldInstitutions && (
          <div>
            <span className="mb-1.5 block text-sm font-medium text-slate-600 dark:text-slate-300">
              Which institutions can this Admin manage?
              <span className="font-normal text-slate-400"> · tick as many as apply</span>
            </span>
            <p className="mb-2 text-xs text-slate-400">
              They always manage their own institution above. Tick any others they are responsible for.
            </p>
            {!form.organization ? (
              <p className="rounded-xl border border-dashed border-slate-200 p-4 text-sm text-slate-400 dark:border-slate-700">
                Choose their own institution above first.
              </p>
            ) : extraOrgs.length === 0 ? (
              <p className="rounded-xl border border-dashed border-slate-200 p-4 text-sm text-slate-400 dark:border-slate-700">
                There are no other institutions to grant.
              </p>
            ) : (
              <>
              <div className="mb-1.5 flex items-center justify-between gap-3">
                <span className="text-xs text-slate-400">
                  {form.managedOrganizations.length
                    ? `${form.managedOrganizations.length} extra selected`
                    : 'None selected — they will manage only their own'}
                </span>
                <button type="button"
                  onClick={() => setForm((f) => ({
                    ...f,
                    managedOrganizations: f.managedOrganizations.length === extraOrgs.length
                      ? []
                      : extraOrgs.map((o) => String(o._id)),
                  }))}
                  className="text-xs font-semibold text-brand-600 hover:underline dark:text-brand-400">
                  {form.managedOrganizations.length === extraOrgs.length ? 'Clear all' : 'Select all'}
                </button>
              </div>
              <div className="max-h-48 space-y-1 overflow-y-auto rounded-xl border border-slate-200 p-1.5 dark:border-slate-700">
                {extraOrgs.map((o) => {
                  const checked = form.managedOrganizations.includes(String(o._id));
                  return (
                    <label key={o._id}
                      className={cn('flex cursor-pointer items-center gap-3 rounded-lg px-2.5 py-2 transition-colors',
                        checked ? 'bg-brand-50 dark:bg-brand-500/10' : 'hover:bg-slate-50 dark:hover:bg-slate-800')}>
                      <input type="checkbox" checked={checked} className="h-4 w-4 shrink-0 cursor-pointer accent-brand-600"
                        onChange={() => setForm((f) => ({
                          ...f,
                          managedOrganizations: checked
                            ? f.managedOrganizations.filter((id) => id !== String(o._id))
                            : [...f.managedOrganizations, String(o._id)],
                        }))} />
                      <span className="truncate text-sm font-semibold text-slate-700 dark:text-slate-200">{o.name}</span>
                    </label>
                  );
                })}
              </div>
              </>
            )}

            {/* Spell out the resulting access, by name */}
            {accessNames.length > 0 && (
              <p className="mt-2 rounded-xl bg-slate-50 px-3 py-2 text-xs text-slate-600 dark:bg-slate-800/60 dark:text-slate-300">
                This Admin will manage{' '}
                <span className="font-bold text-slate-800 dark:text-white">
                  {accessNames.length} institution{accessNames.length === 1 ? '' : 's'}
                </span>
                : {accessNames.join(', ')}. In those, and only those, they can see the users, assign work,
                approve or reject content, and answer requests.
              </p>
            )}
          </div>
        )}

        <div>
          <span className="mb-1.5 block text-sm font-medium text-slate-600 dark:text-slate-300">Pages you handle (organization + platforms)</span>
          <div className="space-y-2.5">
            {form.handles.map((row, index) => (
              <div key={index} className="rounded-xl border border-slate-200 p-3 dark:border-slate-700">
                <div className="flex items-center gap-2">
                  <Select value={row.organization} onChange={(e) => updateHandle(index, { organization: e.target.value })} className="flex-1">
                    <option value="">— Choose organization —</option>
                    {orgs.map((o) => <option key={o._id} value={o._id}>{o.name}</option>)}
                  </Select>
                  {form.handles.length > 1 && (
                    <button type="button" onClick={() => removeHandleRow(index)} aria-label="Remove row" className="rounded-lg p-2 text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-500/10">
                      <X className="h-4 w-4" />
                    </button>
                  )}
                </div>
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {PAGE_PLATFORMS.map((platform) => (
                    <button
                      key={platform}
                      type="button"
                      onClick={() => togglePlatform(index, platform)}
                      className={cn(
                        'rounded-lg border px-2.5 py-1 text-xs font-semibold transition',
                        row.platforms.includes(platform)
                          ? 'border-transparent bg-brand-600 text-white'
                          : 'border-slate-200 text-slate-500 hover:border-brand-300 dark:border-slate-700 dark:text-slate-400'
                      )}
                    >
                      {platform}
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </div>
          <button type="button" onClick={addHandleRow} className="mt-2 inline-flex items-center gap-1 text-sm font-semibold text-brand-600 hover:text-brand-700">
            <Plus className="h-4 w-4" /> Add another organization
          </button>
        </div>
        {needsOrg ? (
          <Select label="Organization" value={form.organization} onChange={(e) => setForm({ ...form, organization: e.target.value })}>
            <option value="">Select an organization…</option>
            {orgs.map((o) => <option key={o._id} value={o._id}>{o.name}</option>)}
          </Select>
        ) : (
          <p className="rounded-lg bg-violet-50 dark:bg-violet-500/10 px-3 py-2 text-xs text-violet-700 dark:text-violet-300">The Super Admin is global and not tied to a single organization.</p>
        )}
        {editUser && <p className="text-xs text-slate-400">Email can't be changed. Use "Reset password" to set a new password.</p>}
        <div className="flex justify-end gap-2 pt-2">
          <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
          <Button type="submit" loading={loading}>{editUser ? 'Save changes' : 'Create user'}</Button>
        </div>
      </form>
    </Modal>
  );
}

function ResetPasswordModal({ user, onClose }) {
  const [form, setForm] = useState({ password: '', confirm: '' });
  const [loading, setLoading] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    if (form.password !== form.confirm) { toast.error('Passwords do not match'); return; }
    if (form.password.length < 6) { toast.error('Password must be at least 6 characters'); return; }
    setLoading(true);
    try { await userApi.resetPassword(user._id, form.password); toast.success(`Password reset for ${user.name}`); onClose(); }
    catch (err) { toast.error(err.response?.data?.message || 'Reset failed'); }
    finally { setLoading(false); }
  };

  return (
    <Modal open onClose={onClose} title={`Reset password — ${user.name}`} size="sm">
      <form onSubmit={submit} className="space-y-4">
        <p className="text-sm text-slate-400">Set a new password for this user. Share it securely.</p>
        <Input label="New password" type="password" required value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} />
        <Input label="Confirm password" type="password" required value={form.confirm} onChange={(e) => setForm({ ...form, confirm: e.target.value })} />
        <div className="flex justify-end gap-2 pt-2">
          <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
          <Button type="submit" loading={loading}>Reset password</Button>
        </div>
      </form>
    </Modal>
  );
}
