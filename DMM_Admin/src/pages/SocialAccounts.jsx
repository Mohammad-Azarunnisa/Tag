import { useMemo, useRef, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { Share2, Plus, Pencil, Trash2, Mail, Phone, Users, ExternalLink, X, Upload, Download, FileSpreadsheet, Linkedin, Instagram, Youtube, Facebook, Twitter, Building2, Link2, UserCheck, Copy } from 'lucide-react';
import { socialAccountApi, organizationApi, userApi } from '../api/endpoints.js';
import { downloadBlob } from '../lib/utils.js';
import PageHeader from '../components/layout/PageHeader.jsx';
import { Button } from '../components/ui/Button.jsx';
import { Card, Input, Select, Skeleton, EmptyState } from '../components/ui/primitives.jsx';
import { Modal } from '../components/ui/Modal.jsx';

const PLATFORMS = ['LinkedIn', 'Instagram', 'YouTube', 'Facebook', 'X (Twitter)'];
const PLATFORM_ORDER = Object.fromEntries(PLATFORMS.map((p, i) => [p, i]));

// Each platform gets its real brand colour + icon so the rows are instantly
// recognisable at a glance.
const PLATFORM_META = {
  LinkedIn: { icon: Linkedin, color: '#0A66C2' },
  Instagram: { icon: Instagram, color: '#E4405F' },
  YouTube: { icon: Youtube, color: '#FF0000' },
  Facebook: { icon: Facebook, color: '#1877F2' },
  'X (Twitter)': { icon: Twitter, color: '#0f172a' },
};

// Admin roles are colour-coded so Super Admins, Content Admins and Portfolio
// Admins are easy to tell apart.
const roleBadge = (role = '') => {
  const r = role.toLowerCase();
  if (r.includes('super')) return 'bg-amber-100 text-amber-800 dark:bg-amber-500/15 dark:text-amber-300';
  if (r.includes('content')) return 'bg-sky-100 text-sky-700 dark:bg-sky-500/15 dark:text-sky-300';
  if (r.includes('portfolio')) return 'bg-violet-100 text-violet-700 dark:bg-violet-500/15 dark:text-violet-300';
  return 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300';
};

const blankHandler = { user: null, name: '', email: '', phone: '', role: '' };
const blank = { platform: 'LinkedIn', organization: '', accountName: '', profileUrl: '', ownerName: '', ownerEmail: '', linkedEmails: '', accessCount: 0, notes: '', handlers: [{ ...blankHandler }] };

export default function SocialAccounts() {
  const qc = useQueryClient();
  const [filters, setFilters] = useState({ organizationId: 'all', platform: 'All', search: '' });
  const [modal, setModal] = useState(null);
  const [contact, setContact] = useState(null); // handler being viewed
  const fileRef = useRef(null);

  const { data: orgData } = useQuery({ queryKey: ['organizations', 'picker'], queryFn: () => organizationApi.list() });
  const orgs = orgData?.organizations || [];

  const params = { platform: filters.platform, search: filters.search };
  if (filters.organizationId === 'all') params.scope = 'all'; else params.organizationId = filters.organizationId;
  const { data, isLoading } = useQuery({ queryKey: ['social-accounts', filters], queryFn: () => socialAccountApi.list(params) });
  const accounts = data?.accounts || [];

  // Group accounts by organization, platforms in canonical order.
  const groups = useMemo(() => {
    const map = new Map();
    for (const a of accounts) {
      const key = a.organization?._id || 'unlinked';
      if (!map.has(key)) map.set(key, { org: a.organization, items: [] });
      map.get(key).items.push(a);
    }
    const arr = [...map.values()];
    arr.sort((x, y) => (x.org?.name || 'zzz').localeCompare(y.org?.name || 'zzz'));
    arr.forEach((g) => g.items.sort((a, b) => (PLATFORM_ORDER[a.platform] ?? 9) - (PLATFORM_ORDER[b.platform] ?? 9)));
    return arr;
  }, [accounts]);

  const removeMut = useMutation({
    mutationFn: (id) => socialAccountApi.remove(id),
    onSuccess: () => { toast.success('Removed'); qc.invalidateQueries({ queryKey: ['social-accounts'] }); },
    onError: (e) => toast.error(e.response?.data?.message || 'Failed'),
  });

  const importMut = useMutation({
    mutationFn: (file) => { const fd = new FormData(); fd.append('file', file); return socialAccountApi.import(fd); },
    onSuccess: (res) => {
      const orgNote = res.organizationsCreated ? `, ${res.organizationsCreated} new organizations` : '';
      toast.success(`Imported ${res.imported} accounts — ${res.created} new, ${res.updated} updated${orgNote}`);
      qc.invalidateQueries({ queryKey: ['social-accounts'] });
      qc.invalidateQueries({ queryKey: ['organizations'] });
    },
    onError: (e) => toast.error(e.response?.data?.message || 'Import failed'),
  });

  const onPickFile = (e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) importMut.mutate(f); };
  const downloadTemplate = async () => {
    try { downloadBlob(await socialAccountApi.template(), 'social-accounts-template.xlsx'); }
    catch { toast.error('Could not download template'); }
  };

  return (
    <div>
      <input ref={fileRef} type="file" accept=".xlsx,.xls,.csv" className="hidden" onChange={onPickFile} />
      <PageHeader title="Social Media Handlers" subtitle="Who runs each platform, per organization — and exactly what access they have."
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="outline" onClick={downloadTemplate}><Download className="h-4 w-4" /> Template</Button>
            <Button variant="outline" onClick={() => fileRef.current?.click()} loading={importMut.isPending}><Upload className="h-4 w-4" /> Import Excel</Button>
            <Button onClick={() => setModal({ type: 'create' })}><Plus className="h-4 w-4" /> Add account</Button>
          </div>
        } />

      {/* Role legend — so the colour coding is self-explanatory */}
      <div className="mb-5 flex flex-wrap items-center gap-x-4 gap-y-2 text-xs text-slate-500 dark:text-slate-400">
        <span className="font-semibold uppercase tracking-wide text-slate-400">Admin roles:</span>
        <Legend className={roleBadge('super')}>Super Admin — full control</Legend>
        <Legend className={roleBadge('content')}>Content Admin — posts content</Legend>
        <Legend className={roleBadge('portfolio')}>Portfolio Admin — via business portfolio</Legend>
        <Legend className={roleBadge('')}>Other</Legend>
      </div>

      <div className="mb-5 grid gap-3 sm:grid-cols-3">
        <Select value={filters.organizationId} onChange={(e) => setFilters({ ...filters, organizationId: e.target.value })}>
          <option value="all">All colleges</option>
          {orgs.map((o) => <option key={o._id} value={o._id}>{o.name}</option>)}
        </Select>
        <Select value={filters.platform} onChange={(e) => setFilters({ ...filters, platform: e.target.value })}>
          <option value="All">All platforms</option>
          {PLATFORMS.map((p) => <option key={p} value={p}>{p}</option>)}
        </Select>
        <Input placeholder="Search account, owner or handler…" value={filters.search} onChange={(e) => setFilters({ ...filters, search: e.target.value })} />
      </div>

      {isLoading ? (
        <div className="space-y-4">{Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-40" />)}</div>
      ) : accounts.length === 0 ? (
        <EmptyState icon={Share2} title="No accounts yet" description="Import your social handlers spreadsheet or add an account manually."
          action={<Button onClick={() => setModal({ type: 'create' })}><Plus className="h-4 w-4" /> Add account</Button>} />
      ) : (
        <div className="space-y-6">
          {groups.map((g) => (
            <section key={g.org?._id || 'unlinked'}>
              {/* Organization header */}
              <div className="mb-3 flex items-center gap-2.5">
                <span className="flex h-7 w-7 items-center justify-center rounded-lg text-white" style={{ background: g.org?.color || '#64748b' }}>
                  <Building2 className="h-4 w-4" />
                </span>
                <h2 className="text-base font-bold text-slate-800 dark:text-white">{g.org?.name || 'Unlinked'}</h2>
                <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-semibold text-slate-500 dark:bg-slate-800 dark:text-slate-400">{g.items.length} {g.items.length === 1 ? 'platform' : 'platforms'}</span>
              </div>

              <div className="grid gap-3 xl:grid-cols-2">
                {g.items.map((a) => <PlatformCard key={a._id} a={a} onEdit={() => setModal({ type: 'edit', item: a })} onRemove={() => window.confirm('Remove this account?') && removeMut.mutate(a._id)} onOpenContact={(h) => setContact({ handler: h, account: a })} />)}
              </div>
            </section>
          ))}
        </div>
      )}

      {modal && <AccountModal item={modal.item} orgs={orgs} onClose={() => setModal(null)} onSaved={() => { setModal(null); qc.invalidateQueries({ queryKey: ['social-accounts'] }); }} />}
      {contact && <ContactModal handler={contact.handler} account={contact.account} onClose={() => setContact(null)} />}
    </div>
  );
}

// Contact card shown when a handler's name is clicked. For linked users it shows
// their live account details; you can email, call, or open their LinkedIn directly.
function ContactModal({ handler, account, onClose }) {
  const h = handler;
  const copy = (text) => { navigator.clipboard?.writeText(text); toast.success('Copied'); };
  const Row = ({ icon: Icon, label, value, display, href, onCopy }) => value ? (
    <div className="flex items-center gap-3 rounded-xl border border-slate-100 px-3.5 py-2.5 dark:border-slate-800">
      <Icon className="h-4 w-4 shrink-0 text-slate-400" />
      <div className="min-w-0 flex-1">
        <p className="text-[11px] uppercase tracking-wide text-slate-400">{label}</p>
        {href ? <a href={href} target={href.startsWith('http') ? '_blank' : undefined} rel="noreferrer" className="block truncate font-medium text-brand-600 hover:underline dark:text-brand-400">{display || value}</a>
              : <p className="block truncate font-medium text-slate-700 dark:text-slate-200">{display || value}</p>}
      </div>
      {onCopy && <button type="button" onClick={() => copy(value)} className="shrink-0 rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-brand-600 dark:hover:bg-slate-800" title="Copy"><Copy className="h-3.5 w-3.5" /></button>}
    </div>
  ) : null;

  return (
    <Modal open onClose={onClose} title="Contact details" size="sm">
      <div className="space-y-4">
        <div className="flex items-center gap-3">
          {h.avatar ? <img src={h.avatar} alt={h.name} className="h-14 w-14 rounded-full object-cover" />
            : <div className="flex h-14 w-14 items-center justify-center rounded-full bg-brand-100 text-lg font-bold text-brand-700 dark:bg-brand-900 dark:text-brand-200">{(h.name || '?').slice(0, 1).toUpperCase()}</div>}
          <div className="min-w-0">
            <p className="flex items-center gap-1.5 text-lg font-bold text-slate-800 dark:text-white">
              {h.name || 'Unnamed'}
              {h.linked && <span title="Linked to a user account" className="text-emerald-500"><UserCheck className="h-4 w-4" /></span>}
            </p>
            <p className="text-xs text-slate-400">
              {[h.role, h.jobTitle].filter(Boolean).join(' · ')}{h.role || h.jobTitle ? ' · ' : ''}{account.platform} @ {account.organization?.name || 'Org'}
            </p>
          </div>
        </div>

        <div className="space-y-2">
          <Row icon={Mail} label="Email" value={h.email} href={h.email ? `mailto:${h.email}` : undefined} onCopy />
          <Row icon={Phone} label="Phone" value={h.phone} href={h.phone ? `tel:${h.phone}` : undefined} onCopy />
          <Row icon={Linkedin} label="LinkedIn" value={h.linkedinUrl} display={h.linkedinUrl?.replace(/^https?:\/\/(www\.)?/, '').replace(/\/$/, '')} href={h.linkedinUrl || undefined} onCopy />
        </div>

        {!h.email && !h.phone && !h.linkedinUrl && (
          <p className="rounded-xl bg-slate-50 px-3.5 py-2.5 text-sm text-slate-400 dark:bg-slate-800/50">No contact details on file{h.linked ? '' : ' — link this handler to a user account to pull live details'}.</p>
        )}

        <div className="flex flex-wrap gap-2 pt-1">
          {h.email && <a href={`mailto:${h.email}`} className="inline-flex items-center gap-1.5 rounded-xl bg-brand-600 px-3.5 py-2 text-sm font-semibold text-white hover:bg-brand-700"><Mail className="h-4 w-4" /> Email</a>}
          {h.phone && <a href={`tel:${h.phone}`} className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 px-3.5 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"><Phone className="h-4 w-4" /> Call</a>}
          {h.linkedinUrl && <a href={h.linkedinUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 px-3.5 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"><Linkedin className="h-4 w-4" /> LinkedIn</a>}
        </div>
      </div>
    </Modal>
  );
}

const Legend = ({ className, children }) => (
  <span className="inline-flex items-center gap-1.5">
    <span className={`h-2.5 w-2.5 rounded-full ${className}`} />
    {children}
  </span>
);

function PlatformCard({ a, onEdit, onRemove, onOpenContact }) {
  const meta = PLATFORM_META[a.platform] || { icon: Share2, color: '#64748b' };
  const Icon = meta.icon;

  // Group handlers by role so the differentiation is obvious.
  const byRole = useMemo(() => {
    const m = new Map();
    for (const h of a.handlers || []) {
      const key = h.role || 'Other';
      if (!m.has(key)) m.set(key, []);
      m.get(key).push(h);
    }
    // Super Admins first, then Content, then the rest.
    return [...m.entries()].sort(([x], [y]) => roleRank(x) - roleRank(y));
  }, [a.handlers]);

  return (
    <Card className="overflow-hidden">
      {/* Platform header strip */}
      <div className="flex items-center justify-between gap-3 border-b border-slate-100 px-4 py-3 dark:border-slate-800">
        <div className="flex min-w-0 items-center gap-2.5">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl text-white" style={{ background: meta.color }}>
            <Icon className="h-5 w-5" />
          </span>
          <div className="min-w-0">
            <p className="font-bold text-slate-800 dark:text-white">{a.platform}</p>
            {a.profileUrl ? (
              <a href={a.profileUrl} target="_blank" rel="noreferrer" className="flex items-center gap-1 truncate text-xs text-brand-600 hover:underline dark:text-brand-400">
                <ExternalLink className="h-3 w-3 shrink-0" /> <span className="truncate">{a.profileUrl.replace(/^https?:\/\//, '')}</span>
              </a>
            ) : (
              <p className="text-xs text-slate-400">No profile link</p>
            )}
          </div>
        </div>
        <div className="flex shrink-0 gap-1">
          <button onClick={onEdit} className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-brand-600 dark:hover:bg-slate-800" title="Edit"><Pencil className="h-4 w-4" /></button>
          <button onClick={onRemove} className="rounded-lg p-1.5 text-slate-400 hover:bg-rose-50 hover:text-rose-600 dark:hover:bg-rose-500/10" title="Remove"><Trash2 className="h-4 w-4" /></button>
        </div>
      </div>

      {/* Handlers grouped by role */}
      <div className="space-y-2.5 px-4 py-3">
        {byRole.length === 0 ? (
          <p className="text-sm text-slate-400">No admins assigned yet.</p>
        ) : (
          byRole.map(([role, people]) => (
            <div key={role} className="flex flex-wrap items-center gap-x-2 gap-y-1.5">
              <span className={`rounded-md px-2 py-0.5 text-[11px] font-bold uppercase tracking-wide ${roleBadge(role)}`}>{role}</span>
              {people.map((h, i) => (
                <button key={i} type="button" onClick={() => onOpenContact(h)} title="View contact details"
                  className="inline-flex items-center gap-1.5 rounded-lg bg-slate-50 px-2 py-1 text-sm text-slate-700 transition-colors hover:bg-brand-50 hover:text-brand-700 dark:bg-slate-800/60 dark:text-slate-200 dark:hover:bg-brand-500/10">
                  {h.linked && <UserCheck className="h-3.5 w-3.5 text-emerald-500" />}
                  <span className="font-medium">{h.name}</span>
                  {h.email && <Mail className="h-3.5 w-3.5 text-slate-400" />}
                  {h.phone && <Phone className="h-3.5 w-3.5 text-slate-400" />}
                </button>
              ))}
            </div>
          ))
        )}

        {/* Secondary details */}
        {(a.linkedEmails?.length > 0 || a.accessCount > 0 || a.notes) && (
          <div className="space-y-1 border-t border-slate-100 pt-2.5 text-xs text-slate-500 dark:border-slate-800 dark:text-slate-400">
            {a.linkedEmails?.length > 0 && <p><span className="font-semibold text-slate-600 dark:text-slate-300">Linked emails:</span> {a.linkedEmails.join(', ')}</p>}
            {a.accessCount > 0 && <p className="inline-flex items-center gap-1"><Users className="h-3.5 w-3.5" /> {a.accessCount} people with access</p>}
            {a.notes && <p><span className="font-semibold text-slate-600 dark:text-slate-300">Note:</span> {a.notes}</p>}
          </div>
        )}
      </div>
    </Card>
  );
}

const roleRank = (role = '') => {
  const r = role.toLowerCase();
  if (r.includes('super')) return 0;
  if (r.includes('content')) return 1;
  if (r.includes('portfolio')) return 2;
  return 3;
};

function AccountModal({ item, orgs, onClose, onSaved }) {
  const [form, setForm] = useState(item
    ? { ...blank, ...item, organization: item.organization?._id || item.organization || '', linkedEmails: (item.linkedEmails || []).join(', '), handlers: item.handlers?.length ? item.handlers.map((h) => ({ ...blankHandler, ...h, user: h.user?._id || h.user || null })) : [{ ...blankHandler }] }
    : blank);
  const [loading, setLoading] = useState(false);
  const set = (k, v) => setForm({ ...form, [k]: v });
  const setHandler = (i, k, v) => setForm({ ...form, handlers: form.handlers.map((h, idx) => (idx === i ? { ...h, [k]: v } : h)) });

  // Users available to link handlers to (their live email/phone/LinkedIn get shown).
  const { data: userData } = useQuery({ queryKey: ['users', 'picker'], queryFn: () => userApi.list() });
  const users = userData?.users || [];
  const linkUser = (i, userId) => {
    const u = users.find((x) => x._id === userId);
    setForm({
      ...form,
      handlers: form.handlers.map((h, idx) => idx === i
        ? (u ? { ...h, user: u._id, name: u.name, email: u.email, phone: u.phone || '' } : { ...h, user: null })
        : h),
    });
  };

  const submit = async (e) => {
    e.preventDefault();
    if (!item && !form.organization) { toast.error('Choose an organization'); return; }
    setLoading(true);
    try {
      const payload = { ...form, handlers: form.handlers.filter((h) => h.user || h.name || h.email || h.phone) };
      if (item) await socialAccountApi.update(item._id, payload);
      else await socialAccountApi.create(payload);
      toast.success('Saved'); onSaved();
    } catch (err) { toast.error(err.response?.data?.message || 'Save failed'); }
    finally { setLoading(false); }
  };

  return (
    <Modal open onClose={onClose} title={item ? 'Edit account' : 'Add social media account'} size="lg">
      <form onSubmit={submit} className="space-y-4">
        <div className="grid grid-cols-2 gap-3">
          {!item && (
            <Select label="Organization" value={form.organization} onChange={(e) => set('organization', e.target.value)}>
              <option value="">Select…</option>
              {orgs.map((o) => <option key={o._id} value={o._id}>{o.name}</option>)}
            </Select>
          )}
          <Select label="Platform" value={form.platform} onChange={(e) => set('platform', e.target.value)}>
            {PLATFORMS.map((p) => <option key={p} value={p}>{p}</option>)}
          </Select>
          <Input label="Account / handle" value={form.accountName} onChange={(e) => set('accountName', e.target.value)} placeholder="@college" />
          <Input label="Profile / website URL" value={form.profileUrl} onChange={(e) => set('profileUrl', e.target.value)} placeholder="https://…" />
          <Input label="People with access (optional)" type="number" min="0" value={form.accessCount} onChange={(e) => set('accessCount', e.target.value)} />
        </div>
        <Input label="Linked emails (comma separated)" value={form.linkedEmails} onChange={(e) => set('linkedEmails', e.target.value)} placeholder="a@x.com, b@x.com" />

        <div>
          <div className="mb-2 flex items-center justify-between">
            <span className="text-sm font-medium text-slate-600 dark:text-slate-300">Admins / handlers</span>
            <Button type="button" size="sm" variant="ghost" onClick={() => set('handlers', [...form.handlers, { ...blankHandler }])}><Plus className="h-4 w-4" /> Add admin</Button>
          </div>
          <div className="space-y-3">
            {form.handlers.map((h, i) => (
              <div key={i} className="rounded-xl border border-slate-200 p-3 dark:border-slate-700">
                <div className="mb-2 flex items-center justify-between">
                  <span className="text-xs font-semibold uppercase tracking-wide text-slate-400">Admin {i + 1}</span>
                  <button type="button" onClick={() => set('handlers', form.handlers.filter((_, idx) => idx !== i))} className="rounded-lg p-1 text-slate-400 hover:bg-rose-50 hover:text-rose-600 dark:hover:bg-rose-500/10" title="Remove admin"><X className="h-4 w-4" /></button>
                </div>
                <div className="mb-2">
                  <Select label="Link to a user account (pulls their live email, phone & LinkedIn)" value={h.user || ''} onChange={(e) => linkUser(i, e.target.value)}>
                    <option value="">Not linked — enter details manually</option>
                    {users.map((u) => <option key={u._id} value={u._id}>{u.name} · {u.email}</option>)}
                  </Select>
                </div>
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                  <Input placeholder="Name" value={h.name} onChange={(e) => setHandler(i, 'name', e.target.value)} disabled={!!h.user} />
                  <Select value={h.role} onChange={(e) => setHandler(i, 'role', e.target.value)}>
                    <option value="">Role…</option>
                    <option value="Super Admin">Super Admin</option>
                    <option value="Content Admin">Content Admin</option>
                    <option value="Portfolio Admin">Portfolio Admin</option>
                  </Select>
                  <Input type="email" placeholder="Email" value={h.email} onChange={(e) => setHandler(i, 'email', e.target.value)} disabled={!!h.user} />
                  <Input placeholder="Phone" value={h.phone} onChange={(e) => setHandler(i, 'phone', e.target.value)} disabled={!!h.user} />
                </div>
                {h.user && <p className="mt-1.5 text-[11px] text-emerald-600 dark:text-emerald-400">Linked — name, email & phone stay in sync with this user's account.</p>}
              </div>
            ))}
          </div>
        </div>

        <textarea className="input-base min-h-[60px]" placeholder="Notes (optional)" value={form.notes} onChange={(e) => set('notes', e.target.value)} />
        <div className="flex justify-end gap-2"><Button type="button" variant="outline" onClick={onClose}>Cancel</Button><Button type="submit" loading={loading}>Save</Button></div>
      </form>
    </Modal>
  );
}
