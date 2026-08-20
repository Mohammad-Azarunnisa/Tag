import { useRef, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { Globe, Plus, Pencil, Trash2, Upload, Download, FileSpreadsheet, ExternalLink } from 'lucide-react';
import { websiteApi, organizationApi } from '../api/endpoints.js';
import { cn, downloadBlob, formatDate } from '../lib/utils.js';
import PageHeader from '../components/layout/PageHeader.jsx';
import { Button } from '../components/ui/Button.jsx';
import { Card, Input, Select, Skeleton, EmptyState } from '../components/ui/primitives.jsx';
import { Modal } from '../components/ui/Modal.jsx';

const blank = { institution: '', organization: '', domain: '', siteType: '', hosting: '', builtWith: '', expiryDate: '', notes: '' };

// Subtle, consistent badge tones (kept in the brand/slate family — no rainbow).
const Badge = ({ children }) =>
  children ? <span className="inline-block rounded-md bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-600 dark:bg-slate-800 dark:text-slate-300">{children}</span> : <span className="text-slate-300 dark:text-slate-600">—</span>;

// <input type="date"> speaks yyyy-MM-dd only. Dates are stored at UTC midnight,
// so slicing the ISO string hands back the day that was picked.
const toDateInput = (v) => {
  if (!v) return '';
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? '' : d.toISOString().slice(0, 10);
};

// A renewal that has passed — or is about to — is the whole point of holding the
// date, so it is called out rather than left as one more grey cell.
const DAY = 24 * 60 * 60 * 1000;
const expiryTone = (v) => {
  if (!v) return null;
  const days = Math.ceil((new Date(v).getTime() - Date.now()) / DAY);
  if (Number.isNaN(days)) return null;
  if (days < 0) return { cls: 'text-rose-600 dark:text-rose-400 font-semibold', note: 'Expired' };
  if (days <= 30) return { cls: 'text-amber-600 dark:text-amber-400 font-semibold', note: days === 0 ? 'Expires today' : `${days} day${days === 1 ? '' : 's'} left` };
  return { cls: 'text-slate-600 dark:text-slate-300', note: null };
};

export default function Websites() {
  const qc = useQueryClient();
  const [filters, setFilters] = useState({ organizationId: 'all', search: '' });
  const [modal, setModal] = useState(null);
  const fileRef = useRef(null);

  const { data: orgData } = useQuery({ queryKey: ['organizations', 'picker'], queryFn: () => organizationApi.list() });
  const orgs = orgData?.organizations || [];

  const params = { search: filters.search };
  if (filters.organizationId !== 'all') params.organizationId = filters.organizationId;
  const { data, isLoading } = useQuery({ queryKey: ['websites', filters], queryFn: () => websiteApi.list(params) });
  const websites = data?.websites || [];

  const removeMut = useMutation({
    mutationFn: (id) => websiteApi.remove(id),
    onSuccess: () => { toast.success('Removed'); qc.invalidateQueries({ queryKey: ['websites'] }); },
    onError: (e) => toast.error(e.response?.data?.message || 'Failed'),
  });
  const importMut = useMutation({
    mutationFn: (file) => { const fd = new FormData(); fd.append('file', file); return websiteApi.import(fd); },
    onSuccess: (res) => { toast.success(`Imported ${res.imported} websites — ${res.created} new, ${res.updated} updated`); qc.invalidateQueries({ queryKey: ['websites'] }); },
    onError: (e) => toast.error(e.response?.data?.message || 'Import failed'),
  });

  const onPickFile = (e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) importMut.mutate(f); };
  const downloadTemplate = async () => {
    try { downloadBlob(await websiteApi.template(), 'websites-template.xlsx'); }
    catch { toast.error('Could not download template'); }
  };

  return (
    <div>
      <input ref={fileRef} type="file" accept=".xlsx,.xls,.csv" className="hidden" onChange={onPickFile} />
      <PageHeader title="Websites & Domains" subtitle="Every institution's live site — domain, site type, hosting, the stack it's built with and when it comes up for renewal."
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="outline" onClick={downloadTemplate}><Download className="h-4 w-4" /> Template</Button>
            <Button variant="outline" onClick={() => fileRef.current?.click()} loading={importMut.isPending}><Upload className="h-4 w-4" /> Import Excel</Button>
            <Button onClick={() => setModal({ type: 'create' })}><Plus className="h-4 w-4" /> Add website</Button>
          </div>
        } />

      <div className="mb-5 flex items-start gap-2.5 rounded-xl border border-slate-200/70 bg-slate-50 px-4 py-3 text-xs text-slate-500 dark:border-slate-800 dark:bg-slate-800/40 dark:text-slate-400">
        <FileSpreadsheet className="mt-0.5 h-4 w-4 shrink-0 text-brand-500" />
        <span>
          <span className="font-semibold text-slate-600 dark:text-slate-300">Excel import:</span> upload your domains sheet with
          columns like <em>Institution</em>, <em>Domain</em>, <em>Site Type</em>, <em>Hosting</em>, <em>Built With</em> and <em>Expiry Date</em>.
          Columns are detected automatically and re-importing updates existing rows instead of duplicating.
        </span>
      </div>

      <div className="mb-5 grid gap-3 sm:grid-cols-3">
        <Select value={filters.organizationId} onChange={(e) => setFilters({ ...filters, organizationId: e.target.value })}>
          <option value="all">All colleges</option>
          {orgs.map((o) => <option key={o._id} value={o._id}>{o.name}</option>)}
        </Select>
        <Input className="sm:col-span-2" placeholder="Search institution, domain, hosting or stack…" value={filters.search} onChange={(e) => setFilters({ ...filters, search: e.target.value })} />
      </div>

      {isLoading ? (
        <Skeleton className="h-80" />
      ) : websites.length === 0 ? (
        <EmptyState icon={Globe} title="No websites yet" description="Add a website or import your domains spreadsheet."
          action={<Button onClick={() => setModal({ type: 'create' })}><Plus className="h-4 w-4" /> Add website</Button>} />
      ) : (
        <Card className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-100 dark:border-slate-800 text-left text-xs uppercase text-slate-400">
                <th className="px-5 py-3 font-semibold">Institution</th>
                <th className="px-5 py-3 font-semibold">Domain</th>
                <th className="px-5 py-3 font-semibold">Site Type</th>
                <th className="px-5 py-3 font-semibold">Hosting</th>
                <th className="px-5 py-3 font-semibold">Built With</th>
                <th className="px-5 py-3 font-semibold">Expiry</th>
                <th className="px-5 py-3 font-semibold text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-50 dark:divide-slate-800/50">
              {websites.map((w) => (
                <tr key={w._id} className="hover:bg-slate-50/50 dark:hover:bg-slate-800/30">
                  <td className="px-5 py-3 font-semibold text-slate-700 dark:text-slate-200">{w.institution}</td>
                  <td className="px-5 py-3">
                    {w.domain ? (
                      <a href={w.domain} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-brand-600 hover:underline dark:text-brand-400">
                        <ExternalLink className="h-3.5 w-3.5" /> {w.domain.replace(/^https?:\/\//, '')}
                      </a>
                    ) : <span className="text-slate-300 dark:text-slate-600">—</span>}
                  </td>
                  <td className="px-5 py-3"><Badge>{w.siteType}</Badge></td>
                  <td className="px-5 py-3"><Badge>{w.hosting}</Badge></td>
                  <td className="px-5 py-3 text-slate-600 dark:text-slate-300">{w.builtWith || <span className="text-slate-300 dark:text-slate-600">—</span>}</td>
                  <td className="px-5 py-3 whitespace-nowrap">
                    {w.expiryDate ? (() => {
                      const tone = expiryTone(w.expiryDate);
                      return (
                        <span className={cn('block', tone?.cls)}>
                          {formatDate(w.expiryDate)}
                          {tone?.note && <span className="block text-[11px] font-medium">{tone.note}</span>}
                        </span>
                      );
                    })() : <span className="text-slate-300 dark:text-slate-600">—</span>}
                  </td>
                  <td className="px-5 py-3 text-right">
                    <div className="inline-flex gap-1">
                      <button onClick={() => setModal({ type: 'edit', item: w })} className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-brand-600 dark:hover:bg-slate-800" title="Edit"><Pencil className="h-4 w-4" /></button>
                      <button onClick={() => window.confirm(`Remove "${w.institution}"?`) && removeMut.mutate(w._id)} className="rounded-lg p-1.5 text-slate-400 hover:bg-rose-50 hover:text-rose-600 dark:hover:bg-rose-500/10" title="Remove"><Trash2 className="h-4 w-4" /></button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}

      {modal && <WebsiteModal item={modal.item} orgs={orgs} onClose={() => setModal(null)} onSaved={() => { setModal(null); qc.invalidateQueries({ queryKey: ['websites'] }); }} />}
    </div>
  );
}

function WebsiteModal({ item, orgs, onClose, onSaved }) {
  const [form, setForm] = useState(item
    ? { ...blank, ...item, organization: item.organization?._id || item.organization || '', expiryDate: toDateInput(item.expiryDate) }
    : blank);
  const [loading, setLoading] = useState(false);
  const set = (k, v) => setForm({ ...form, [k]: v });
  const expiry = expiryTone(form.expiryDate);

  const submit = async (e) => {
    e.preventDefault();
    if (!form.institution.trim()) { toast.error('Institution name is required'); return; }
    setLoading(true);
    try {
      if (item) await websiteApi.update(item._id, form);
      else await websiteApi.create(form);
      toast.success('Saved'); onSaved();
    } catch (err) { toast.error(err.response?.data?.message || 'Save failed'); }
    finally { setLoading(false); }
  };

  return (
    <Modal open onClose={onClose} title={item ? 'Edit website' : 'Add website'} size="lg">
      <form onSubmit={submit} className="space-y-4">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Input label="Institution" value={form.institution} onChange={(e) => set('institution', e.target.value)} placeholder="e.g. NCET" />
          <Select label="Organization (optional)" value={form.organization} onChange={(e) => set('organization', e.target.value)}>
            <option value="">Not linked</option>
            {orgs.map((o) => <option key={o._id} value={o._id}>{o.name}</option>)}
          </Select>
        </div>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          {/* The span sits on the wrapper — Input puts className on the field
              itself, not on the grid item. */}
          <div className="sm:col-span-2">
            <Input label="Domain" value={form.domain} onChange={(e) => set('domain', e.target.value)} placeholder="https://example.co.in" />
          </div>
          <Input label="Expiry date (optional)" type="date" value={form.expiryDate} onChange={(e) => set('expiryDate', e.target.value)} />
        </div>
        {expiry?.note && <p className={cn('-mt-1 text-xs', expiry.cls)}>{expiry.note} — as of today.</p>}
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <Input label="Site Type" value={form.siteType} onChange={(e) => set('siteType', e.target.value)} placeholder="Static / Server / Hybrid / Dynamic" />
          <Input label="Hosting" value={form.hosting} onChange={(e) => set('hosting', e.target.value)} placeholder="CloudFlare / AWS" />
          <Input label="Built With" value={form.builtWith} onChange={(e) => set('builtWith', e.target.value)} placeholder="AstroJS / NextJS…" />
        </div>
        <textarea className="input-base min-h-[60px]" placeholder="Notes (optional)" value={form.notes} onChange={(e) => set('notes', e.target.value)} />
        <div className="flex justify-end gap-2"><Button type="button" variant="outline" onClick={onClose}>Cancel</Button><Button type="submit" loading={loading}>Save</Button></div>
      </form>
    </Modal>
  );
}
