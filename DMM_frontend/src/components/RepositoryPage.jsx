import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import {
  Plus, Search, Download, Trash2, Pencil, FileImage, Eye, FolderOpen, LayoutGrid, List, Globe,
} from 'lucide-react';
import { motion } from 'framer-motion';
import PageHeader from './layout/PageHeader.jsx';
import { Button } from './ui/Button.jsx';
import { Card, Input, Select, Badge, Avatar, Skeleton, EmptyState } from './ui/primitives.jsx';
import { Modal } from './ui/Modal.jsx';
import FileDropzone from './ui/FileDropzone.jsx';
import { formatDate, formatBytes, cn, isCoordinatorUser, canDeleteOrgItem, triggerDownload } from '../lib/utils.js';
import { useAuthStore } from '../store/authStore.js';
import { organizationApi } from '../api/endpoints.js';

/**
 * Generic repository page for Templates and Assets (near-identical CRUD UIs).
 * `cfg` supplies the API, labels, categories and field names that differ.
 *
 * Items belong to one college (organization) or are shared across all of them
 * (organization: null). Filtering by a college shows its items + the shared ones.
 */
export default function RepositoryPage({ cfg }) {
  const qc = useQueryClient();
  const { user } = useAuthStore();
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState('All');
  const [orgFilter, setOrgFilter] = useState(''); // '' = all, 'shared', or an org id
  const [modalOpen, setModalOpen] = useState(false);
  const [editItem, setEditItem] = useState(null);
  const [preview, setPreview] = useState(null);
  // Grid vs list — remembered per page so big libraries stay scannable.
  const [view, setViewState] = useState(() => localStorage.getItem(`repoview:${cfg.key}`) || 'grid');
  const setView = (v) => { setViewState(v); localStorage.setItem(`repoview:${cfg.key}`, v); };

  // One college means nothing to filter by and nothing to choose.
  const oneCollege = isCoordinatorUser(user);
  const { data: orgData } = useQuery({
    queryKey: ['org-options'], queryFn: organizationApi.options, enabled: !oneCollege,
  });
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
      // The counter bump answers with the url and filename to use, so the server
      // stays the authority on both rather than the row this page happens to hold.
      const res = await cfg.api.download(item._id);
      triggerDownload(res?.url || item.fileUrl, res?.fileName || item.fileName || item.name);
      qc.invalidateQueries({ queryKey: [cfg.key] });
    } catch { toast.error('Download failed'); }
  };

  // Editing an item — retitling it, recategorising it, swapping the file — is
  // curation, and stays with the super admin.
  const canManage = () => user?.role === 'ADMIN' && !!user?.isSuperAdmin;
  // Removing one is a separate question with a wider answer: an institution's
  // Admin may clear out their own college's items too. Shared items (no
  // organization) belong to the platform, so those stay with the super admin —
  // which is why this is asked per item rather than once for the page.
  const canRemove = (item) => canDeleteOrgItem(user, item.organization);

  const openEdit = (item) => { setEditItem(item); setModalOpen(true); };
  const confirmDelete = (item) => window.confirm(`Delete "${item.name}"?`) && removeMut.mutate(item._id);

  return (
    <div>
      <PageHeader
        title={cfg.title}
        subtitle={cfg.subtitle}
        actions={<Button onClick={() => { setEditItem(null); setModalOpen(true); }}><Plus className="h-4 w-4" /> Upload {cfg.singular}</Button>}
      />

      {/* Filters + view toggle */}
      <div className="mb-5 flex flex-col gap-3 lg:flex-row">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 z-10 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <Input placeholder={`Search ${cfg.plural.toLowerCase()}...`} className="pl-9" value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
        {!oneCollege && (
        <Select className="lg:w-56" value={orgFilter} onChange={(e) => setOrgFilter(e.target.value)} title="Filter by college">
          <option value="">All colleges</option>
          <option value="shared">Shared (all colleges) only</option>
          {orgs.map((o) => <option key={o._id} value={o._id}>{o.name}</option>)}
        </Select>
        )}
        <Select className="lg:w-56" value={category} onChange={(e) => setCategory(e.target.value)}>
          <option value="All">All Categories</option>
          {cfg.categories.map((c) => <option key={c} value={c}>{c}</option>)}
        </Select>
        <div className="inline-flex shrink-0 self-start rounded-xl bg-slate-100 p-1 dark:bg-slate-800">
          <button onClick={() => setView('grid')} title="Grid view" aria-label="Grid view"
            className={cn('rounded-lg px-2.5 py-2', view === 'grid' ? 'bg-white text-brand-700 shadow-soft dark:bg-slate-900 dark:text-brand-300' : 'text-slate-500 hover:text-slate-700 dark:hover:text-slate-300')}>
            <LayoutGrid className="h-4 w-4" />
          </button>
          <button onClick={() => setView('list')} title="List view" aria-label="List view"
            className={cn('rounded-lg px-2.5 py-2', view === 'list' ? 'bg-white text-brand-700 shadow-soft dark:bg-slate-900 dark:text-brand-300' : 'text-slate-500 hover:text-slate-700 dark:hover:text-slate-300')}>
            <List className="h-4 w-4" />
          </button>
        </div>
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
      ) : view === 'grid' ? (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {items.map((item, i) => {
            const thumb = item[cfg.thumbField];
            return (
              <motion.div key={item._id} initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.02 }}>
                <Card className="group overflow-hidden">
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
                      {(canManage() || canRemove(item)) && (
                        <div className="flex gap-1">
                          {canManage() && (
                            <button onClick={() => openEdit(item)} className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800"><Pencil className="h-4 w-4" /></button>
                          )}
                          {canRemove(item) && (
                            <button onClick={() => confirmDelete(item)} className="rounded-lg p-1.5 text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-500/10"><Trash2 className="h-4 w-4" /></button>
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                </Card>
              </motion.div>
            );
          })}
        </div>
      ) : (
        /* List view — compact rows for large libraries */
        <Card className="overflow-x-auto">
          <table className="w-full min-w-[760px] text-sm">
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
                const thumb = item[cfg.thumbField];
                return (
                  <tr key={item._id} className="border-b border-slate-100 last:border-0 hover:bg-slate-50 dark:border-slate-800 dark:hover:bg-slate-800/50">
                    <td className="px-4 py-2.5">
                      <button onClick={() => setPreview(item)} className="flex w-full items-center gap-3 text-left" title="Preview">
                        <span className="flex h-10 w-14 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-slate-100 dark:bg-slate-800">
                          {thumb ? <img src={thumb} alt={item.name} className="h-full w-full object-cover" /> : <FileImage className="h-4 w-4 text-slate-300" />}
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
                        {canManage() && (
                          <button onClick={() => openEdit(item)} className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800" title="Edit"><Pencil className="h-4 w-4" /></button>
                        )}
                        {canRemove(item) && (
                          <button onClick={() => confirmDelete(item)} className="rounded-lg p-1.5 text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-500/10" title="Delete"><Trash2 className="h-4 w-4" /></button>
                        )}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </Card>
      )}

      {modalOpen && (
        <UploadModal cfg={cfg} editItem={editItem} orgs={orgs} user={user} oneCollege={oneCollege} onClose={() => setModalOpen(false)}
          onSaved={() => {
            setModalOpen(false);
            qc.invalidateQueries({ queryKey: [cfg.key] });
            qc.invalidateQueries({ queryKey: ['activity-heatmap'] });
            qc.invalidateQueries({ queryKey: ['activity-day'] });
            qc.invalidateQueries({ queryKey: ['dashboard', 'activity'] });
          }} />
      )}

      {/* Preview modal */}
      <Modal open={!!preview} onClose={() => setPreview(null)} title={preview?.name} size="lg">
        {preview && (
          <div>
            <div className="overflow-hidden rounded-xl bg-slate-100 dark:bg-slate-800">
              {preview[cfg.thumbField] ? (
                <img src={preview[cfg.thumbField]} alt={preview.name} className="max-h-[60vh] w-full object-contain" />
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

// Which college an item belongs to — or "Shared" when it applies to all of them.
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

function UploadModal({ cfg, editItem, orgs, user, oneCollege, onClose, onSaved }) {
  const ownOrgId = user?.organization?._id || user?.organization || '';
  const [form, setForm] = useState({
    name: editItem?.name || '', description: editItem?.description || '',
    category: editItem?.category || cfg.categories[0],
    // '' = shared across all colleges. New uploads default to the uploader's own college.
    organization: editItem ? (editItem.organization?._id || '') : ownOrgId,
  });
  const [file, setFile] = useState([]);
  const [thumb, setThumb] = useState([]);
  const [loading, setLoading] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    if (!editItem && file.length === 0) { toast.error('Please select a file'); return; }
    setLoading(true);
    try {
      const fd = new FormData();
      fd.append('name', form.name);
      fd.append('description', form.description);
      fd.append('category', form.category);
      fd.append('organization', form.organization); // '' → shared
      if (file[0]) fd.append('file', file[0]);
      if (thumb[0]) fd.append(cfg.thumbFieldName, thumb[0]);
      if (editItem) await cfg.api.update(editItem._id, fd);
      else await cfg.api.create(fd);
      toast.success(`${cfg.singular} ${editItem ? 'updated' : 'uploaded'}`);
      onSaved();
    } catch (err) {
      toast.error(err.response?.data?.message || 'Save failed');
    } finally { setLoading(false); }
  };

  return (
    <Modal open onClose={onClose} title={`${editItem ? 'Edit' : 'Upload'} ${cfg.singular}`}>
      <form onSubmit={submit} className="space-y-4">
        <Input label="Name" required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder={`${cfg.singular} name`} />
        <div className="grid gap-4 sm:grid-cols-2">
          {oneCollege ? (
            <p className="rounded-xl bg-slate-50 px-3.5 py-2.5 text-sm text-slate-500 dark:bg-slate-800/50 dark:text-slate-400">
              Uploading to <span className="font-bold text-slate-700 dark:text-white">{user?.organization?.name || "your college"}</span>.
            </p>
          ) : (
          <Select label="For which college?" value={form.organization} onChange={(e) => setForm({ ...form, organization: e.target.value })}>
            <option value="">Shared — all colleges</option>
            {orgs.map((o) => <option key={o._id} value={o._id}>{o.name}</option>)}
          </Select>
          )}
          <Select label="Category" value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })}>
            {cfg.categories.map((c) => <option key={c} value={c}>{c}</option>)}
          </Select>
        </div>
        <div>
          <span className="mb-1.5 block text-sm font-medium text-slate-600 dark:text-slate-300">File {editItem && '(leave empty to keep current)'}</span>
          <FileDropzone accept={cfg.accept} files={file} onChange={setFile} label="Drop file or click to browse" />
        </div>
        <div>
          <span className="mb-1.5 block text-sm font-medium text-slate-600 dark:text-slate-300">{cfg.thumbLabel} (optional)</span>
          <FileDropzone accept="image/*" files={thumb} onChange={setThumb} label="Add a preview image" />
        </div>
        <textarea className="input-base min-h-[80px]" placeholder="Description" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
        <div className="flex justify-end gap-2 pt-2">
          <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
          <Button type="submit" loading={loading}>{editItem ? 'Save changes' : 'Upload'}</Button>
        </div>
      </form>
    </Modal>
  );
}
