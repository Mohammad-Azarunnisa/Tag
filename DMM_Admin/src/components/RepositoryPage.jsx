import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { Plus, Search, Download, Trash2, Pencil, FileImage, Eye, FolderOpen, Globe } from 'lucide-react';
import PageHeader from './layout/PageHeader.jsx';
import { Button } from './ui/Button.jsx';
import { Card, Input, Select, Badge, Avatar, Skeleton, EmptyState } from './ui/primitives.jsx';
import ViewToggle, { useViewMode } from './ui/ViewToggle.jsx';
import { Modal } from './ui/Modal.jsx';
import { organizationApi } from '../api/endpoints.js';
import { useAuthStore } from '../store/authStore.js';
import { formatDate, formatBytes, cn } from '../lib/utils.js';

// Static /uploads are proxied through the same origin as the API (see vite.config.js / nginx).
const fileUrl = (u) => u;

/**
 * Templates / Assets manager for the admin portal. Anyone signed in can upload;
 * only the super admin may edit or remove (mirrors the backend rule). `cfg`
 * supplies the API, labels, categories and thumbnail field names per repo.
 */
export default function RepositoryPage({ cfg }) {
  const qc = useQueryClient();
  const { user } = useAuthStore();
  const canManage = user?.role === 'ADMIN' && !!user?.isSuperAdmin; // super admin only
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState('All');
  const [orgFilter, setOrgFilter] = useState('');
  // Grid vs list, remembered per repository so Templates and Assets keep their own.
  const [view, setView] = useViewMode(cfg.key);
  const [modalOpen, setModalOpen] = useState(false);
  const [editItem, setEditItem] = useState(null);
  const [preview, setPreview] = useState(null);

  const { data: orgData } = useQuery({ queryKey: ['org-options'], queryFn: organizationApi.options });
  const orgs = orgData?.organizations || [];

  const { data, isLoading } = useQuery({
    queryKey: [cfg.key, { search, category, orgFilter }],
    queryFn: () => cfg.api.list({ search, category, organizationId: orgFilter || undefined, limit: 48 }),
  });
  const items = data?.[cfg.listField] || [];

  const removeMut = useMutation({
    mutationFn: (id) => cfg.api.remove(id),
    onSuccess: () => { toast.success(`${cfg.singular} deleted`); qc.invalidateQueries({ queryKey: [cfg.key] }); },
    onError: (e) => toast.error(e.response?.data?.message || 'Delete failed'),
  });

  const handleDownload = async (item) => {
    try {
      await cfg.api.download(item._id);
      window.open(fileUrl(item.fileUrl), '_blank');
      qc.invalidateQueries({ queryKey: [cfg.key] });
    } catch { toast.error('Download failed'); }
  };
  const openEdit = (item) => { setEditItem(item); setModalOpen(true); };
  const confirmDelete = (item) => window.confirm(`Delete "${item.name}"?`) && removeMut.mutate(item._id);

  return (
    <div>
      <PageHeader
        title={cfg.title}
        subtitle={cfg.subtitle}
        actions={<Button onClick={() => { setEditItem(null); setModalOpen(true); }}><Plus className="h-4 w-4" /> Upload {cfg.singular}</Button>}
      />

      {/* Filters */}
      <div className="mb-5 flex flex-col gap-3 lg:flex-row">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 z-10 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <Input placeholder={`Search ${cfg.plural.toLowerCase()}...`} className="pl-9" value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
        <Select className="lg:w-56" value={orgFilter} onChange={(e) => setOrgFilter(e.target.value)} title="Filter by college">
          <option value="">All colleges</option>
          <option value="shared">Shared (all colleges) only</option>
          {orgs.map((o) => <option key={o._id} value={o._id}>{o.name}</option>)}
        </Select>
        <Select className="lg:w-56" value={category} onChange={(e) => setCategory(e.target.value)}>
          <option value="All">All Categories</option>
          {cfg.categories.map((c) => <option key={c} value={c}>{c}</option>)}
        </Select>
        <ViewToggle view={view} onChange={setView} />
      </div>

      {isLoading ? (
        view === 'grid' ? (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {Array.from({ length: 8 }).map((_, i) => <Skeleton key={i} className="h-64" />)}
          </div>
        ) : (
          <div className="space-y-2">{Array.from({ length: 8 }).map((_, i) => <Skeleton key={i} className="h-16" />)}</div>
        )
      ) : items.length === 0 ? (
        <EmptyState icon={FolderOpen} title={`No ${cfg.plural.toLowerCase()} found`}
          description="Try adjusting filters or upload a new one."
          action={<Button onClick={() => setModalOpen(true)}><Plus className="h-4 w-4" /> Upload {cfg.singular}</Button>} />
      ) : view === 'list' ? (
        /* List view — compact rows for large repositories */
        <Card className="overflow-x-auto">
          <table className="w-full min-w-[880px] text-sm">
            <thead>
              <tr className="border-b border-slate-100 text-left text-xs font-bold uppercase tracking-wide text-slate-400 dark:border-slate-800">
                <th className="px-4 py-3">{cfg.singular}</th>
                <th className="px-3 py-3">College</th>
                <th className="px-3 py-3">Category</th>
                <th className="px-3 py-3">Type</th>
                <th className="px-3 py-3">Size</th>
                <th className="px-3 py-3 text-right">Downloads</th>
                <th className="px-3 py-3">Uploaded</th>
                <th className="px-3 py-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {items.map((item) => {
                const thumb = fileUrl(item[cfg.thumbField]);
                return (
                  <tr key={item._id} className="border-b border-slate-100 last:border-0 hover:bg-slate-50 dark:border-slate-800 dark:hover:bg-slate-800/50">
                    <td className="px-4 py-2.5">
                      <button onClick={() => setPreview(item)} className="flex w-full items-center gap-3 text-left" title="Preview">
                        <span className="flex h-10 w-14 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-slate-100 dark:bg-slate-800">
                          {thumb ? <img src={thumb} alt="" className="h-full w-full object-cover" /> : <FileImage className="h-4 w-4 text-slate-300" />}
                        </span>
                        <span className="min-w-0">
                          <span className="block truncate font-semibold text-slate-800 dark:text-white">{item.name}</span>
                          {item.description && <span className="block max-w-[260px] truncate text-xs text-slate-400">{item.description}</span>}
                        </span>
                      </button>
                    </td>
                    <td className="px-3 py-2.5"><OrgChip organization={item.organization} /></td>
                    <td className="px-3 py-2.5 text-xs text-slate-500 dark:text-slate-400">{item.category}</td>
                    <td className="px-3 py-2.5"><Badge>{item.fileType || '—'}</Badge></td>
                    <td className="px-3 py-2.5 text-xs text-slate-500 dark:text-slate-400">{item.fileSize ? formatBytes(item.fileSize) : '—'}</td>
                    <td className="px-3 py-2.5 text-right text-xs font-semibold text-slate-600 dark:text-slate-300">{item.downloads || 0}</td>
                    <td className="px-3 py-2.5">
                      <span className="flex items-center gap-2">
                        <Avatar src={item.uploadedBy?.avatar} name={item.uploadedBy?.name} size="sm" />
                        <span className="text-xs text-slate-400">{formatDate(item.createdAt)}</span>
                      </span>
                    </td>
                    <td className="px-3 py-2.5">
                      <span className="flex justify-end gap-1">
                        <button onClick={() => handleDownload(item)} className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-600 dark:hover:bg-slate-800" title="Download"><Download className="h-4 w-4" /></button>
                        {canManage && (
                          <>
                            <button onClick={() => openEdit(item)} className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800" title="Edit"><Pencil className="h-4 w-4" /></button>
                            <button onClick={() => confirmDelete(item)} className="rounded-lg p-1.5 text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-500/10" title="Delete"><Trash2 className="h-4 w-4" /></button>
                          </>
                        )}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </Card>
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {items.map((item) => {
            const thumb = fileUrl(item[cfg.thumbField]);
            return (
              <Card key={item._id} className="group overflow-hidden">
                <div className="relative aspect-[4/3] overflow-hidden bg-slate-100 dark:bg-slate-800">
                  {thumb ? (
                    <img src={thumb} alt={item.name} className="h-full w-full object-cover transition group-hover:scale-105" />
                  ) : (
                    <div className="flex h-full items-center justify-center"><FileImage className="h-10 w-10 text-slate-300" /></div>
                  )}
                  <div className="absolute inset-0 flex items-center justify-center gap-2 bg-slate-900/40 opacity-0 transition group-hover:opacity-100">
                    <button onClick={() => setPreview(item)} className="rounded-lg bg-white/90 p-2 text-slate-700 hover:bg-white" title="Preview"><Eye className="h-4 w-4" /></button>
                    <button onClick={() => handleDownload(item)} className="rounded-lg bg-white/90 p-2 text-slate-700 hover:bg-white" title="Download"><Download className="h-4 w-4" /></button>
                  </div>
                  <Badge className="absolute left-2 top-2 bg-white/90 dark:bg-slate-900/90">{item.fileType}</Badge>
                  <span className="absolute bottom-2 left-2"><OrgChip organization={item.organization} /></span>
                </div>
                <div className="p-4">
                  <p className="truncate font-semibold text-slate-800 dark:text-white">{item.name}</p>
                  <p className="mt-0.5 text-xs text-slate-400">{item.category}</p>
                  <div className="mt-3 flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <Avatar src={item.uploadedBy?.avatar} name={item.uploadedBy?.name} size="sm" />
                      <span className="text-xs text-slate-400">{formatDate(item.createdAt)}</span>
                    </div>
                    {canManage && (
                      <div className="flex gap-1">
                        <button onClick={() => openEdit(item)} className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800"><Pencil className="h-4 w-4" /></button>
                        <button onClick={() => confirmDelete(item)} className="rounded-lg p-1.5 text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-500/10"><Trash2 className="h-4 w-4" /></button>
                      </div>
                    )}
                  </div>
                </div>
              </Card>
            );
          })}
        </div>
      )}

      {modalOpen && (
        <UploadModal cfg={cfg} editItem={editItem} orgs={orgs} user={user} onClose={() => setModalOpen(false)}
          onSaved={() => { setModalOpen(false); qc.invalidateQueries({ queryKey: [cfg.key] }); }} />
      )}

      <Modal open={!!preview} onClose={() => setPreview(null)} title={preview?.name} size="lg">
        {preview && (
          <div>
            <div className="overflow-hidden rounded-xl bg-slate-100 dark:bg-slate-800">
              {fileUrl(preview[cfg.thumbField]) ? (
                <img src={fileUrl(preview[cfg.thumbField])} alt={preview.name} className="max-h-[60vh] w-full object-contain" />
              ) : (
                <div className="flex h-64 items-center justify-center"><FileImage className="h-16 w-16 text-slate-300" /></div>
              )}
            </div>
            <div className="mt-4 grid grid-cols-2 gap-4 text-sm">
              <div><p className="text-slate-400">College</p><p className="font-medium">{preview.organization?.name || 'Shared — all colleges'}</p></div>
              <div><p className="text-slate-400">Category</p><p className="font-medium">{preview.category}</p></div>
              <div><p className="text-slate-400">Type</p><p className="font-medium">{preview.fileType}</p></div>
              <div><p className="text-slate-400">Size</p><p className="font-medium">{formatBytes(preview.fileSize)}</p></div>
              <div><p className="text-slate-400">Downloads</p><p className="font-medium">{preview.downloads}</p></div>
            </div>
            {preview.description && <p className="mt-4 text-sm text-slate-500">{preview.description}</p>}
            <Button className="mt-5 w-full" onClick={() => handleDownload(preview)}><Download className="h-4 w-4" /> Download</Button>
          </div>
        )}
      </Modal>
    </div>
  );
}

function OrgChip({ organization }) {
  if (!organization) {
    return (
      <span className="inline-flex items-center gap-1 rounded-md bg-slate-900/70 px-2 py-0.5 text-[11px] font-semibold text-white">
        <Globe className="h-3 w-3" /> Shared
      </span>
    );
  }
  return (
    <span className="inline-flex max-w-[160px] items-center gap-1.5 rounded-md bg-slate-900/70 px-2 py-0.5 text-[11px] font-semibold text-white">
      <span className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: organization.color || '#f15d27' }} />
      <span className="truncate">{organization.name}</span>
    </span>
  );
}

function UploadModal({ cfg, editItem, orgs, user, onClose, onSaved }) {
  const ownOrgId = user?.organization?._id || user?.organization || '';
  const [form, setForm] = useState({
    name: editItem?.name || '', description: editItem?.description || '',
    category: editItem?.category || cfg.categories[0],
    organization: editItem ? (editItem.organization?._id || '') : ownOrgId,
  });
  const [file, setFile] = useState(null);
  const [thumb, setThumb] = useState(null);
  const [loading, setLoading] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    if (!form.name.trim()) { toast.error('Name is required'); return; }
    if (!editItem && !file) { toast.error('Please choose a file'); return; }
    setLoading(true);
    try {
      const fd = new FormData();
      fd.append('name', form.name);
      fd.append('description', form.description);
      fd.append('category', form.category);
      fd.append('organization', form.organization); // '' → shared
      if (file) fd.append('file', file);
      if (thumb) fd.append(cfg.thumbFieldName, thumb);
      if (editItem) await cfg.api.update(editItem._id, fd);
      else await cfg.api.create(fd);
      toast.success(`${cfg.singular} ${editItem ? 'updated' : 'uploaded'}`);
      onSaved();
    } catch (err) {
      toast.error(err.response?.data?.message || 'Save failed');
    } finally { setLoading(false); }
  };

  const fileInputCls = 'block w-full text-sm text-slate-500 file:mr-3 file:rounded-lg file:border-0 file:bg-brand-50 file:px-3 file:py-2 file:text-sm file:font-semibold file:text-brand-700 dark:file:bg-brand-500/10 dark:file:text-brand-300';

  return (
    <Modal open onClose={onClose} title={`${editItem ? 'Edit' : 'Upload'} ${cfg.singular}`}>
      <form onSubmit={submit} className="space-y-4">
        <Input label="Name" required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder={`${cfg.singular} name`} />
        <div className="grid gap-4 sm:grid-cols-2">
          <Select label="For which college?" value={form.organization} onChange={(e) => setForm({ ...form, organization: e.target.value })}>
            <option value="">Shared — all colleges</option>
            {orgs.map((o) => <option key={o._id} value={o._id}>{o.name}</option>)}
          </Select>
          <Select label="Category" value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })}>
            {cfg.categories.map((c) => <option key={c} value={c}>{c}</option>)}
          </Select>
        </div>
        <label className="block">
          <span className="mb-1.5 block text-sm font-medium text-slate-600 dark:text-slate-300">File {editItem && '(leave empty to keep current)'}</span>
          <input type="file" accept={cfg.accept} onChange={(e) => setFile(e.target.files?.[0] || null)} className={fileInputCls} />
        </label>
        <label className="block">
          <span className="mb-1.5 block text-sm font-medium text-slate-600 dark:text-slate-300">{cfg.thumbLabel} (optional)</span>
          <input type="file" accept="image/*" onChange={(e) => setThumb(e.target.files?.[0] || null)} className={fileInputCls} />
        </label>
        <textarea className="input-base min-h-[80px]" placeholder="Description" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
        <div className="flex justify-end gap-2 pt-2">
          <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
          <Button type="submit" loading={loading}>{editItem ? 'Save changes' : 'Upload'}</Button>
        </div>
      </form>
    </Modal>
  );
}
