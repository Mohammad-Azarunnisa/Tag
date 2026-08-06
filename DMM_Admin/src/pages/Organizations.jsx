import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import {
  Building2, Plus, Search, Pencil, Trash2, Users as UsersIcon, Send, Globe, Power, MoreVertical,
} from 'lucide-react';
import { motion } from 'framer-motion';
import { organizationApi } from '../api/endpoints.js';
import { useAuthStore } from '../store/authStore.js';
import PageHeader from '../components/layout/PageHeader.jsx';
import { Button } from '../components/ui/Button.jsx';
import { Card, Input, Skeleton, EmptyState } from '../components/ui/primitives.jsx';
import { Modal } from '../components/ui/Modal.jsx';
import { formatDate } from '../lib/utils.js';

export default function Organizations() {
  const qc = useQueryClient();
  const { user: me } = useAuthStore();
  const canManage = !!me?.isSuperAdmin; // only the super admin manages organizations
  const [search, setSearch] = useState('');
  const [modal, setModal] = useState(null);
  const [menuFor, setMenuFor] = useState(null);

  const { data, isLoading } = useQuery({ queryKey: ['organizations', search], queryFn: () => organizationApi.list({ search }) });
  const orgs = data?.organizations || [];

  const removeMut = useMutation({
    mutationFn: (id) => organizationApi.remove(id),
    onSuccess: () => { toast.success('Organization deleted'); qc.invalidateQueries({ queryKey: ['organizations'] }); },
    onError: (e) => toast.error(e.response?.data?.message || 'Delete failed'),
  });
  const toggleMut = useMutation({
    mutationFn: ({ id, isActive }) => { const fd = new FormData(); fd.append('isActive', isActive); return organizationApi.update(id, fd); },
    onSuccess: () => { toast.success('Organization updated'); qc.invalidateQueries({ queryKey: ['organizations'] }); },
    onError: (e) => toast.error(e.response?.data?.message || 'Update failed'),
  });

  const totalMembers = orgs.reduce((a, o) => a + (o.memberCount || 0), 0);
  const totalPosts = orgs.reduce((a, o) => a + (o.postCount || 0), 0);

  return (
    <div>
      <PageHeader title="Organizations" subtitle={canManage ? 'Each organization is an isolated workspace with its own users, content and analytics.' : 'View organizations. Only the super admin can create or edit them.'}
        actions={canManage && <Button onClick={() => setModal({ type: 'create' })}><Plus className="h-4 w-4" /> New Organization</Button>} />

      <div className="mb-6 grid grid-cols-3 gap-4">
        <Stat icon={Building2} label="Organizations" value={orgs.length} cls="text-brand-600 bg-brand-50 dark:bg-brand-500/10" />
        <Stat icon={UsersIcon} label="Total Members" value={totalMembers} cls="text-sky-600 bg-sky-50 dark:bg-sky-500/10" />
        <Stat icon={Send} label="Total Posts" value={totalPosts} cls="text-emerald-600 bg-emerald-50 dark:bg-emerald-500/10" />
      </div>

      <div className="mb-5 relative max-w-md">
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
        <Input placeholder="Search organizations..." className="pl-9" value={search} onChange={(e) => setSearch(e.target.value)} />
      </div>

      {isLoading ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">{Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-48" />)}</div>
      ) : orgs.length === 0 ? (
        <EmptyState icon={Building2} title="No organizations yet" description={canManage ? 'Create your first organization to start onboarding teams.' : 'No organizations to show.'}
          action={canManage && <Button onClick={() => setModal({ type: 'create' })}><Plus className="h-4 w-4" /> New Organization</Button>} />
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {orgs.map((o, i) => (
            <motion.div key={o._id} initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.04 }}>
              <Card className="p-5">
                <div className="flex items-start justify-between">
                  <div className="flex items-center gap-3">
                    {o.logo ? (
                      <img src={o.logo} alt={o.name} className="h-12 w-12 rounded-xl object-cover" />
                    ) : (
                      <div className="flex h-12 w-12 items-center justify-center rounded-xl text-lg font-extrabold text-white" style={{ background: o.color || '#6366f1' }}>
                        {o.name[0]?.toUpperCase()}
                      </div>
                    )}
                    <div>
                      <p className="font-bold text-slate-800 dark:text-white">{o.name}</p>
                      <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-semibold ${o.isActive ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-400' : 'bg-slate-100 text-slate-500 dark:bg-slate-800'}`}>
                        {o.isActive ? 'Active' : 'Inactive'}
                      </span>
                    </div>
                  </div>
                  {canManage && (
                  <div className="relative">
                    <button onClick={() => setMenuFor(menuFor === o._id ? null : o._id)} className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800"><MoreVertical className="h-4 w-4" /></button>
                    {menuFor === o._id && (
                      <>
                        <div className="fixed inset-0 z-10" onClick={() => setMenuFor(null)} />
                        <div className="absolute right-0 top-9 z-20 w-44 rounded-xl border border-slate-100 dark:border-slate-800 bg-white dark:bg-slate-900 p-1.5 shadow-card">
                          <MenuItem icon={Pencil} label="Edit" onClick={() => { setMenuFor(null); setModal({ type: 'edit', org: o }); }} />
                          <MenuItem icon={Power} label={o.isActive ? 'Deactivate' : 'Activate'} onClick={() => { setMenuFor(null); toggleMut.mutate({ id: o._id, isActive: !o.isActive }); }} />
                          <MenuItem icon={Trash2} label="Delete" danger onClick={() => { setMenuFor(null); window.confirm(`Delete ${o.name}? This is only allowed if it has no members.`) && removeMut.mutate(o._id); }} />
                        </div>
                      </>
                    )}
                  </div>
                  )}
                </div>

                {o.description && <p className="mt-3 line-clamp-2 text-sm text-slate-400">{o.description}</p>}

                <div className="mt-4 flex items-center gap-4 border-t border-slate-100 dark:border-slate-800 pt-3 text-sm">
                  <span className="flex items-center gap-1.5 text-slate-500 dark:text-slate-400"><UsersIcon className="h-4 w-4" /> {o.memberCount} members</span>
                  <span className="flex items-center gap-1.5 text-slate-500 dark:text-slate-400"><Send className="h-4 w-4" /> {o.postCount} posts</span>
                </div>
                <p className="mt-2 text-[11px] text-slate-400">Created {formatDate(o.createdAt)}</p>
              </Card>
            </motion.div>
          ))}
        </div>
      )}

      {modal && <OrgFormModal org={modal.type === 'edit' ? modal.org : null} onClose={() => setModal(null)} onSaved={() => { setModal(null); qc.invalidateQueries({ queryKey: ['organizations'] }); }} />}
    </div>
  );
}

const Stat = ({ icon: Icon, label, value, cls }) => (
  <Card className="flex items-center gap-3 p-4">
    <div className={`rounded-xl p-2.5 ${cls}`}><Icon className="h-5 w-5" /></div>
    <div><p className="text-2xl font-extrabold text-slate-800 dark:text-white">{value}</p><p className="text-xs text-slate-400">{label}</p></div>
  </Card>
);

const MenuItem = ({ icon: Icon, label, onClick, danger }) => (
  <button onClick={onClick} className={`flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm ${danger ? 'text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-500/10' : 'text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800'}`}>
    <Icon className="h-4 w-4" /> {label}
  </button>
);

function OrgFormModal({ org, onClose, onSaved }) {
  const [form, setForm] = useState({
    name: org?.name || '', description: org?.description || '', website: org?.website || '', color: org?.color || '#6366f1',
  });
  const [logo, setLogo] = useState(null);
  const [preview, setPreview] = useState(org?.logo || '');
  const [loading, setLoading] = useState(false);

  const onLogo = (e) => { const f = e.target.files?.[0]; if (f) { setLogo(f); setPreview(URL.createObjectURL(f)); } };

  const submit = async (e) => {
    e.preventDefault();
    if (!form.name.trim()) { toast.error('Name is required'); return; }
    setLoading(true);
    try {
      const fd = new FormData();
      fd.append('name', form.name);
      fd.append('description', form.description);
      fd.append('website', form.website);
      fd.append('color', form.color);
      if (logo) fd.append('logo', logo);
      if (org) await organizationApi.update(org._id, fd);
      else await organizationApi.create(fd);
      toast.success(`Organization ${org ? 'updated' : 'created'}`);
      onSaved();
    } catch (err) { toast.error(err.response?.data?.message || 'Save failed'); }
    finally { setLoading(false); }
  };

  return (
    <Modal open onClose={onClose} title={org ? 'Edit Organization' : 'New Organization'}>
      <form onSubmit={submit} className="space-y-4">
        <div className="flex items-center gap-4">
          <div className="relative">
            {preview ? <img src={preview} alt="" className="h-16 w-16 rounded-2xl object-cover" />
              : <div className="flex h-16 w-16 items-center justify-center rounded-2xl text-2xl font-extrabold text-white" style={{ background: form.color }}>{(form.name[0] || 'O').toUpperCase()}</div>}
            <label className="absolute -bottom-1 -right-1 cursor-pointer rounded-full bg-brand-600 p-1.5 text-white hover:bg-brand-700">
              <Pencil className="h-3 w-3" />
              <input type="file" accept="image/*" className="hidden" onChange={onLogo} />
            </label>
          </div>
          <div className="flex-1">
            <Input label="Organization name" required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="e.g. NCT" />
          </div>
        </div>
        <Input label="Website" value={form.website} onChange={(e) => setForm({ ...form, website: e.target.value })} placeholder="https://..." />
        <div>
          <span className="mb-1.5 block text-sm font-medium text-slate-600 dark:text-slate-300">Brand color</span>
          <div className="flex items-center gap-3">
            <input type="color" value={form.color} onChange={(e) => setForm({ ...form, color: e.target.value })} className="h-10 w-14 cursor-pointer rounded-lg border border-slate-200 dark:border-slate-700 bg-transparent" />
            <span className="text-sm text-slate-400">{form.color}</span>
          </div>
        </div>
        <textarea className="input-base min-h-[80px]" placeholder="Description" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
        <div className="flex justify-end gap-2 pt-2">
          <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
          <Button type="submit" loading={loading}>{org ? 'Save changes' : 'Create organization'}</Button>
        </div>
      </form>
    </Modal>
  );
}
