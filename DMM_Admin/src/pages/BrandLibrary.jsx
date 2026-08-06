import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { Images, Plus, Trash2, ExternalLink, Download, Film, FileText, LinkIcon, Play, Globe, Search } from 'lucide-react';
import { brandApi, linkApi, organizationApi } from '../api/endpoints.js';
import { useAuthStore } from '../store/authStore.js';
import { youtubeThumb, cn } from '../lib/utils.js';
import PageHeader from '../components/layout/PageHeader.jsx';
import { Button } from '../components/ui/Button.jsx';
import { Card, Input, Select, Skeleton, EmptyState } from '../components/ui/primitives.jsx';
import ViewToggle, { useViewMode } from '../components/ui/ViewToggle.jsx';
import { Modal } from '../components/ui/Modal.jsx';

const CATEGORIES = ['Flyer', 'Brochure', 'Branding Video', 'Image', 'Document', 'Other'];
const fileUrl = (u) => u;

export default function BrandLibrary() {
  return (
    <div>
      <PageHeader title="Brand Library" subtitle="Flyers, brochures, branding videos and marketing material per organization — upload files or link a YouTube video." />
      <Inner />
    </div>
  );
}

function Inner() {
  const qc = useQueryClient();
  const { user } = useAuthStore();
  // Only the super admin may remove items; everyone else can upload/download only.
  const canManage = user?.role === 'ADMIN' && !!user?.isSuperAdmin;
  const [search, setSearch] = useState('');
  const [orgFilter, setOrgFilter] = useState(''); // '' = all, 'shared', or an org id
  const [category, setCategory] = useState('All');
  const [view, setView] = useViewMode('brand-library');

  const { data: orgData } = useQuery({ queryKey: ['org-options'], queryFn: organizationApi.options });
  const orgs = orgData?.organizations || [];

  const { data, isLoading } = useQuery({
    queryKey: ['brand', { search, category, orgFilter }],
    queryFn: () => brandApi.list({ search, category, organizationId: orgFilter || undefined }),
  });
  const items = data?.items || [];
  const filtered = !!search.trim() || !!orgFilter || category !== 'All';
  const [showAdd, setShowAdd] = useState(false);

  const removeMut = useMutation({
    mutationFn: (id) => brandApi.remove(id),
    onSuccess: () => { toast.success('Deleted'); qc.invalidateQueries({ queryKey: ['brand'] }); },
    onError: (e) => toast.error(e.response?.data?.message || 'Failed'),
  });

  return (
    <div className="space-y-4">
      {/* Filters + view toggle — same set as the Template / Asset repositories */}
      <div className="flex flex-col gap-3 lg:flex-row">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 z-10 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <Input placeholder="Search title or description…" className="pl-9" value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
        <Select className="lg:w-52" value={orgFilter} onChange={(e) => setOrgFilter(e.target.value)} title="Filter by college">
          <option value="">All colleges</option>
          <option value="shared">Shared (all colleges) only</option>
          {orgs.map((o) => <option key={o._id} value={o._id}>{o.name}</option>)}
        </Select>
        <Select className="lg:w-52" value={category} onChange={(e) => setCategory(e.target.value)}>
          <option value="All">All Categories</option>
          {CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
        </Select>
        <div className="flex shrink-0 items-center gap-2">
          <ViewToggle view={view} onChange={setView} />
          <Button size="sm" onClick={() => setShowAdd(true)}><Plus className="h-4 w-4" /> Add item</Button>
        </div>
      </div>

      {isLoading ? (
        view === 'grid' ? (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">{Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-56" />)}</div>
        ) : (
          <div className="space-y-2">{Array.from({ length: 8 }).map((_, i) => <Skeleton key={i} className="h-14" />)}</div>
        )
      ) : items.length === 0 ? (
        filtered ? (
          <EmptyState icon={Images} title="Nothing matches these filters" description="Try another college or category, or clear the search." />
        ) : (
          <EmptyState icon={Images} title="Nothing here yet" description="Upload flyers, brochures or branding videos — or paste a YouTube link."
            action={<Button size="sm" onClick={() => setShowAdd(true)}><Plus className="h-4 w-4" /> Add item</Button>} />
        )
      ) : view === 'grid' ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {items.map((it) => <BrandCard key={it._id} item={it} canManage={canManage} onDelete={() => window.confirm(`Delete "${it.title}"?`) && removeMut.mutate(it._id)} />)}
        </div>
      ) : (
        /* List view — compact rows for scanning a big library */
        <Card className="overflow-x-auto">
          <table className="w-full min-w-[680px] text-sm">
            <thead>
              <tr className="border-b border-slate-100 text-left text-xs font-bold uppercase tracking-wide text-slate-400 dark:border-slate-800">
                <th className="px-4 py-3">Item</th>
                <th className="px-3 py-3">College</th>
                <th className="px-3 py-3">Category</th>
                <th className="px-3 py-3">Type</th>
                <th className="px-3 py-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {items.map((it) => (
                <BrandRow key={it._id} item={it} canManage={canManage}
                  onDelete={() => window.confirm(`Delete "${it.title}"?`) && removeMut.mutate(it._id)} />
              ))}
            </tbody>
          </table>
        </Card>
      )}

      {showAdd && <AddModal orgs={orgs} onClose={() => setShowAdd(false)} onSaved={() => { setShowAdd(false); qc.invalidateQueries({ queryKey: ['brand'] }); }} />}
    </div>
  );
}

// Type → colour + icon for the placeholder shown when there's no real preview.
const TYPE_META = {
  Video: { tone: 'from-red-500/20 to-rose-500/5 text-red-500', icon: Film },
  PDF: { tone: 'from-rose-500/20 to-orange-500/5 text-rose-500', icon: FileText },
  Document: { tone: 'from-indigo-500/20 to-blue-500/5 text-indigo-500', icon: FileText },
  Link: { tone: 'from-brand-500/20 to-amber-500/5 text-brand-500', icon: Globe },
  Image: { tone: 'from-emerald-500/20 to-teal-500/5 text-emerald-500', icon: Images },
};
const itemType = (item) => {
  if (item.mediaType === 'image') return 'Image';
  if (item.mediaType === 'video') return 'Video';
  if (item.kind === 'link') return 'Link';
  return (item.url || '').toLowerCase().endsWith('.pdf') ? 'PDF' : 'Document';
};

function Placeholder({ type, label }) {
  const meta = TYPE_META[type] || TYPE_META.Document;
  const Icon = meta.icon;
  return (
    <div className={cn('flex h-full w-full flex-col items-center justify-center gap-2 bg-gradient-to-br px-4 text-center', meta.tone)}>
      <Icon className="h-10 w-10" />
      {label && <span className="max-w-full truncate text-xs font-semibold opacity-80">{label}</span>}
    </div>
  );
}

// Which college an item belongs to — same chip the Template/Asset repositories use.
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

// External (non-YouTube) link: pull the Open-Graph preview image if there is one.
function LinkThumb({ url }) {
  const { data, isLoading } = useQuery({ queryKey: ['link-preview', url], queryFn: () => linkApi.preview(url), staleTime: Infinity, retry: false });
  if (data?.image) {
    return (
      <>
        <img src={data.image} alt="" className="h-full w-full object-cover" onError={(e) => { e.currentTarget.style.visibility = 'hidden'; }} />
        <span className="absolute bottom-2 right-2 inline-flex items-center gap-1 rounded-md bg-slate-900/70 px-1.5 py-0.5 text-[10px] font-semibold text-white"><ExternalLink className="h-3 w-3" />{data.siteName}</span>
      </>
    );
  }
  return <Placeholder type="Link" label={isLoading ? 'Loading preview…' : (data?.siteName || 'External link')} />;
}

function BrandCard({ item, canManage, onDelete }) {
  const url = fileUrl(item.url);
  const ytThumb = item.kind === 'link' ? youtubeThumb(item.url) : null;
  const isLink = item.kind === 'link';
  const type = ytThumb ? 'Video' : itemType(item);
  return (
    <Card className="group overflow-hidden">
      <div className="relative flex aspect-video items-center justify-center overflow-hidden bg-slate-100 dark:bg-slate-800">
        {item.mediaType === 'image' ? (
          <img src={url} alt={item.title} className="h-full w-full object-cover" />
        ) : ytThumb ? (
          <a href={url} target="_blank" rel="noreferrer" className="group/thumb block h-full w-full">
            <img src={ytThumb} alt={item.title} className="h-full w-full object-cover" />
            <span className="absolute inset-0 flex items-center justify-center bg-black/10 transition-colors group-hover/thumb:bg-black/25">
              <span className="flex h-12 w-12 items-center justify-center rounded-full bg-red-600 text-white shadow-lg"><Play className="h-6 w-6 translate-x-0.5 fill-white" /></span>
            </span>
          </a>
        ) : item.mediaType === 'video' ? (
          <video src={url} className="h-full w-full object-cover" muted />
        ) : isLink ? (
          <LinkThumb url={item.url} />
        ) : (
          <Placeholder type={type} label={type} />
        )}
        <span className="absolute left-2 top-2 rounded-md bg-slate-900/70 px-2 py-0.5 text-[11px] font-semibold text-white backdrop-blur-sm">{item.category}</span>
        <span className="absolute right-2 top-2 rounded-md bg-white/85 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-slate-600 backdrop-blur-sm dark:bg-slate-900/80 dark:text-slate-300">{type}</span>
        <span className="absolute bottom-2 left-2"><OrgChip organization={item.organization} /></span>
      </div>
      <div className="p-4">
        <p className="truncate font-semibold text-slate-800 dark:text-white">{item.title}</p>
        {item.description && <p className="mt-1 line-clamp-2 text-xs text-slate-400">{item.description}</p>}
        <div className="mt-3 flex items-center gap-2">
          <a href={url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 rounded-lg bg-slate-100 px-2.5 py-1.5 text-xs font-semibold text-slate-600 transition-colors hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-300">
            {isLink ? <><ExternalLink className="h-3.5 w-3.5" /> Open link</> : <><Download className="h-3.5 w-3.5" /> View / download</>}
          </a>
          {canManage && (
            <button onClick={onDelete} className="ml-auto rounded-lg p-1.5 text-slate-400 transition-colors hover:bg-rose-50 hover:text-rose-600 dark:hover:bg-rose-500/10"><Trash2 className="h-4 w-4" /></button>
          )}
        </div>
      </div>
    </Card>
  );
}

// Compact thumbnail for list rows. Deliberately does NOT fetch Open-Graph
// previews the way LinkThumb does — one request per row would be wasteful, so a
// plain link shows its type icon instead.
function RowThumb({ item, type }) {
  const ytThumb = item.kind === 'link' ? youtubeThumb(item.url) : null;
  const src = item.mediaType === 'image' ? fileUrl(item.url) : ytThumb;
  const Icon = (TYPE_META[type] || TYPE_META.Document).icon;
  return (
    <span className="flex h-10 w-14 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-slate-100 dark:bg-slate-800">
      {src ? <img src={src} alt="" className="h-full w-full object-cover" /> : <Icon className="h-4 w-4 text-slate-400" />}
    </span>
  );
}

function BrandRow({ item, canManage, onDelete }) {
  const url = fileUrl(item.url);
  const isLink = item.kind === 'link';
  const ytThumb = isLink ? youtubeThumb(item.url) : null;
  const type = ytThumb ? 'Video' : itemType(item);
  return (
    <tr className="border-b border-slate-100 last:border-0 hover:bg-slate-50 dark:border-slate-800 dark:hover:bg-slate-800/50">
      <td className="px-4 py-2.5">
        <a href={url} target="_blank" rel="noreferrer" className="flex items-center gap-3">
          <RowThumb item={item} type={type} />
          <span className="min-w-0">
            <span className="block truncate font-semibold text-slate-800 dark:text-white">{item.title}</span>
            {item.description && <span className="block max-w-[320px] truncate text-xs text-slate-400">{item.description}</span>}
          </span>
        </a>
      </td>
      <td className="px-3 py-2.5"><OrgChip organization={item.organization} /></td>
      <td className="px-3 py-2.5 text-xs text-slate-500 dark:text-slate-400">{item.category}</td>
      <td className="px-3 py-2.5">
        <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-slate-500 dark:bg-slate-800 dark:text-slate-400">{type}</span>
      </td>
      <td className="px-3 py-2.5">
        <span className="flex items-center justify-end gap-1">
          <a href={url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 rounded-lg bg-slate-100 px-2.5 py-1.5 text-xs font-semibold text-slate-600 transition-colors hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-300">
            {isLink ? <><ExternalLink className="h-3.5 w-3.5" /> Open</> : <><Download className="h-3.5 w-3.5" /> View</>}
          </a>
          {canManage && (
            <button onClick={onDelete} aria-label={`Delete ${item.title}`} className="rounded-lg p-1.5 text-slate-400 transition-colors hover:bg-rose-50 hover:text-rose-600 dark:hover:bg-rose-500/10"><Trash2 className="h-4 w-4" /></button>
          )}
        </span>
      </td>
    </tr>
  );
}

function AddModal({ orgs = [], onClose, onSaved }) {
  const [mode, setMode] = useState('file'); // file | link
  // 'shared' = all colleges, matching the Template / Asset upload forms.
  const [form, setForm] = useState({ title: '', category: 'Flyer', description: '', link: '', organization: 'shared' });
  const [file, setFile] = useState(null);
  const [loading, setLoading] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    if (!form.title.trim()) { toast.error('Title is required'); return; }
    if (mode === 'file' && !file) { toast.error('Choose a file to upload'); return; }
    if (mode === 'link' && !form.link.trim()) { toast.error('Paste a link'); return; }
    setLoading(true);
    try {
      const fd = new FormData();
      fd.append('title', form.title);
      fd.append('category', form.category);
      fd.append('description', form.description);
      // 'shared' → the backend stores organization: null (all colleges).
      fd.append('organization', form.organization);
      if (mode === 'file') fd.append('file', file);
      else fd.append('link', form.link);
      await brandApi.create(fd);
      toast.success('Added'); onSaved();
    } catch (err) { toast.error(err.response?.data?.message || 'Failed'); }
    finally { setLoading(false); }
  };

  return (
    <Modal open onClose={onClose} title="Add to Brand Library">
      <form onSubmit={submit} className="space-y-4">
        <div className="inline-flex rounded-xl bg-slate-100 p-1 dark:bg-slate-800">
          <button type="button" onClick={() => setMode('file')} className={`rounded-lg px-3 py-1.5 text-sm font-semibold ${mode === 'file' ? 'bg-white text-brand-700 shadow-soft dark:bg-slate-900 dark:text-brand-300' : 'text-slate-500'}`}>Upload file</button>
          <button type="button" onClick={() => setMode('link')} className={`rounded-lg px-3 py-1.5 text-sm font-semibold ${mode === 'link' ? 'bg-white text-brand-700 shadow-soft dark:bg-slate-900 dark:text-brand-300' : 'text-slate-500'}`}>YouTube / link</button>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Input label="Title" required value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder="e.g. Admissions Flyer 2026" />
          <Select label="Category" value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })}>
            {CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
          </Select>
        </div>
        <Select label="College" value={form.organization} onChange={(e) => setForm({ ...form, organization: e.target.value })}>
          <option value="shared">Shared (all colleges)</option>
          {orgs.map((o) => <option key={o._id} value={o._id}>{o.name}</option>)}
        </Select>
        {mode === 'file' ? (
          <label className="block">
            <span className="mb-1.5 block text-sm font-medium text-slate-600 dark:text-slate-300">File (image, video or PDF)</span>
            <input type="file" accept="image/*,video/*,application/pdf" onChange={(e) => setFile(e.target.files?.[0] || null)} className="block w-full text-sm text-slate-500 file:mr-3 file:rounded-lg file:border-0 file:bg-brand-50 file:px-3 file:py-2 file:text-sm file:font-semibold file:text-brand-700 dark:file:bg-brand-500/10 dark:file:text-brand-300" />
          </label>
        ) : (
          <Input label="YouTube / external link" value={form.link} onChange={(e) => setForm({ ...form, link: e.target.value })} placeholder="https://youtube.com/watch?v=…" />
        )}
        <textarea className="input-base min-h-[60px]" placeholder="Description (optional)" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
        <div className="flex justify-end gap-2"><Button type="button" variant="outline" onClick={onClose}>Cancel</Button><Button type="submit" loading={loading}>Add</Button></div>
      </form>
    </Modal>
  );
}
