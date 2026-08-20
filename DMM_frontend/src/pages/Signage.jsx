import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import {
  Flag, Plus, MapPin, Pencil, Trash2, History, Download, Camera, CalendarDays, ExternalLink,
} from 'lucide-react';
import { signageApi, eventApi, organizationApi } from '../api/endpoints.js';
import { useAuthStore } from '../store/authStore.js';
import PageHeader from '../components/layout/PageHeader.jsx';
import { Modal } from '../components/ui/Modal.jsx';
import { Button } from '../components/ui/Button.jsx';
import { Input, Select, Card, Skeleton, EmptyState } from '../components/ui/primitives.jsx';
import ViewToggle, { useViewMode } from '../components/ui/ViewToggle.jsx';
import { formatDate, cn, canDeleteOrgItem } from '../lib/utils.js';

const STAND_TYPES = ['Arch banner', 'Foam board', 'Standee', 'Normal banner', 'Other'];
const UNITS = ['ft', 'in', 'cm', 'm'];

const STATUS_META = {
  OCCUPIED: { label: 'Occupied', cls: 'bg-emerald-500/90 text-white' },
  EMPTY: { label: 'Empty', cls: 'bg-slate-500/90 text-white' },
  NEEDS_REPLACEMENT: { label: 'Needs replacement', cls: 'bg-amber-500/90 text-white' },
  DAMAGED: { label: 'Damaged', cls: 'bg-rose-500/90 text-white' },
};

const sizeLabel = (o) => (o && (o.width || o.height) ? `${o.width || '?'} × ${o.height || '?'} ${o.sizeUnit || 'ft'}` : '');

// Accept the design-source formats the backend allows (PSD / PDF / AI / image).
const SOURCE_ACCEPT = '.psd,.pdf,.ai,image/*,application/pdf,image/vnd.adobe.photoshop,application/postscript';

export default function Signage() {
  const qc = useQueryClient();
  const { user } = useAuthStore();
  const [filters, setFilters] = useState({ search: '', standType: 'All', status: 'All' });
  const [view, setView] = useViewMode('signage');
  const [editLocation, setEditLocation] = useState(null); // null | {} (new) | location (edit)
  const [placingOn, setPlacingOn] = useState(null); // null | {} (pick stand) | location (preset)
  const [historyOf, setHistoryOf] = useState(null); // null | location

  const { data, isLoading } = useQuery({ queryKey: ['signage-locations', filters], queryFn: () => signageApi.locations(filters) });
  const locations = data?.locations || [];
  const counts = data?.counts || { total: 0, occupied: 0, empty: 0, attention: 0 };

  const removeMut = useMutation({
    mutationFn: (id) => signageApi.removeLocation(id),
    onSuccess: () => { toast.success('Location deleted'); qc.invalidateQueries({ queryKey: ['signage-locations'] }); },
    onError: (e) => toast.error(e.response?.data?.message || 'Delete failed'),
  });

  const canManage = (doc) => doc.createdBy?._id === user?._id || user?.role === 'ADMIN' || user?.role === 'CEO';
  // Deleting a stand erases its entire banner history, so it is an
  // administrator's call rather than the creator's.
  const canRemove = (doc) => canDeleteOrgItem(user, doc.organization);
  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['signage-locations'] });
    qc.invalidateQueries({ queryKey: ['signage-banners'] });
  };

  const tiles = [
    { label: 'Total stands', value: counts.total, status: 'All' },
    { label: 'Occupied', value: counts.occupied, status: 'OCCUPIED' },
    { label: 'Empty', value: counts.empty, status: 'EMPTY' },
    { label: 'Needs attention', value: counts.attention, status: 'NEEDS_REPLACEMENT' },
  ];

  return (
    <div>
      <PageHeader
        title="Signage"
        subtitle="Every banner stand on campus — what's mounted on it, for which event, and its full change history."
        actions={
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => setEditLocation({})}><MapPin className="h-4 w-4" /> Add Location</Button>
            <Button onClick={() => setPlacingOn({})}><Plus className="h-4 w-4" /> Place Banner</Button>
          </div>
        }
      />

      {/* Summary tiles */}
      <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
        {tiles.map((t) => (
          <Card
            key={t.label}
            role="button" tabIndex={0}
            onClick={() => setFilters({ ...filters, status: filters.status === t.status ? 'All' : t.status })}
            onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setFilters({ ...filters, status: filters.status === t.status ? 'All' : t.status }); } }}
            className={cn('cursor-pointer p-4 transition hover:-translate-y-0.5 hover:shadow-glow', filters.status === t.status && t.status !== 'All' && 'ring-2 ring-brand-500/40')}
          >
            <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">{t.label}</p>
            <p className="mt-1 text-3xl font-extrabold text-slate-800 dark:text-white">{t.value}</p>
          </Card>
        ))}
      </div>

      {/* Filters + view toggle */}
      <div className="mb-5 flex flex-col gap-3 lg:flex-row">
        <div className="flex-1">
          <Input placeholder="Search code or place…" value={filters.search} onChange={(e) => setFilters({ ...filters, search: e.target.value })} />
        </div>
        <Select className="lg:w-52" value={filters.standType} onChange={(e) => setFilters({ ...filters, standType: e.target.value })}>
          <option value="All">All stand types</option>
          {STAND_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
        </Select>
        <Select className="lg:w-52" value={filters.status} onChange={(e) => setFilters({ ...filters, status: e.target.value })}>
          <option value="All">All statuses</option>
          {Object.entries(STATUS_META).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
        </Select>
        <ViewToggle view={view} onChange={setView} />
      </div>

      {isLoading ? (
        view === 'grid' ? (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">{Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-72" />)}</div>
        ) : (
          <div className="space-y-2">{Array.from({ length: 8 }).map((_, i) => <Skeleton key={i} className="h-14" />)}</div>
        )
      ) : locations.length === 0 ? (
        <EmptyState icon={Flag} title="No signage locations yet"
          description="Add each banner stand once (its code, place and fixed size). Then track every banner mounted on it over time."
          action={<Button onClick={() => setEditLocation({})}><MapPin className="h-4 w-4" /> Add Location</Button>} />
      ) : view === 'list' ? (
        /* List view — every stand as a row, so a whole campus fits on one screen */
        <Card className="overflow-x-auto">
          <table className="w-full min-w-[940px] text-sm">
            <thead>
              <tr className="border-b border-slate-100 text-left text-xs font-bold uppercase tracking-wide text-slate-400 dark:border-slate-800">
                <th className="px-4 py-3">Stand</th>
                <th className="px-3 py-3">Type</th>
                <th className="px-3 py-3">Size</th>
                <th className="px-3 py-3">Status</th>
                <th className="px-3 py-3">Currently mounted</th>
                <th className="px-3 py-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {locations.map((loc) => {
                const meta = STATUS_META[loc.status] || STATUS_META.EMPTY;
                const visual = loc.currentBanner?.preview || loc.currentBanner?.photo || loc.photo;
                return (
                  <tr key={loc._id} className="border-b border-slate-100 last:border-0 hover:bg-slate-50 dark:border-slate-800 dark:hover:bg-slate-800/50">
                    <td className="px-4 py-2.5">
                      <button onClick={() => setHistoryOf(loc)} className="flex w-full items-center gap-3 text-left" title="Banner history">
                        <span className="flex h-10 w-14 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-slate-100 dark:bg-slate-800">
                          {visual ? <img src={visual} alt="" className="h-full w-full object-cover" /> : <Flag className="h-4 w-4 text-brand-400" />}
                        </span>
                        <span className="min-w-0">
                          <span className="block truncate font-bold text-slate-800 dark:text-white">{loc.code}</span>
                          <span className="block max-w-[200px] truncate text-xs text-slate-400">{loc.place}</span>
                        </span>
                      </button>
                    </td>
                    <td className="px-3 py-2.5 text-xs text-slate-500 dark:text-slate-400">{loc.standType}</td>
                    <td className="whitespace-nowrap px-3 py-2.5 text-xs text-slate-500 dark:text-slate-400">{sizeLabel(loc) || '—'}</td>
                    <td className="px-3 py-2.5">
                      <span className={cn('whitespace-nowrap rounded-md px-2 py-0.5 text-[11px] font-semibold', meta.cls)}>{meta.label}</span>
                    </td>
                    <td className="px-3 py-2.5">
                      {loc.currentBanner ? (
                        <span className="block min-w-0">
                          <span className="block max-w-[240px] truncate font-semibold text-slate-600 dark:text-slate-300">{loc.currentBanner.title}</span>
                          <span className="block text-xs text-slate-400">
                            {loc.currentBanner.eventName ? `${loc.currentBanner.eventName} · ` : ''}since {formatDate(loc.currentBanner.installedAt)}
                          </span>
                        </span>
                      ) : (
                        <span className="text-xs italic text-slate-400">Nothing mounted</span>
                      )}
                    </td>
                    <td className="px-3 py-2.5">
                      <span className="flex items-center justify-end gap-1">
                        <Button size="sm" variant="outline" onClick={() => setHistoryOf(loc)}><History className="h-3.5 w-3.5" /> History</Button>
                        <Button size="sm" variant="outline" onClick={() => setPlacingOn(loc)}><Plus className="h-3.5 w-3.5" /> Place</Button>
                        {canManage(loc) && (
                          <button onClick={() => setEditLocation(loc)} aria-label={`Edit ${loc.code}`} className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-600 dark:hover:bg-slate-800 dark:hover:text-slate-300"><Pencil className="h-4 w-4" /></button>
                        )}
                        {canRemove(loc) && (
                          <button onClick={() => { if (window.confirm(`Delete stand ${loc.code} (${loc.place}) and its entire banner history? This cannot be undone.`)) removeMut.mutate(loc._id); }} aria-label={`Delete ${loc.code}`} className="rounded-lg p-1.5 text-rose-500 hover:bg-rose-50 dark:hover:bg-rose-500/10"><Trash2 className="h-4 w-4" /></button>
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
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {locations.map((loc) => {
            const meta = STATUS_META[loc.status] || STATUS_META.EMPTY;
            const visual = loc.currentBanner?.preview || loc.currentBanner?.photo || loc.photo;
            return (
              <Card key={loc._id} className="group overflow-hidden">
                <div className="relative flex aspect-video items-center justify-center bg-gradient-to-br from-brand-500/10 to-slate-100 dark:from-brand-500/10 dark:to-slate-800">
                  {visual ? (
                    <img src={visual} alt={loc.place} className="h-full w-full object-cover" />
                  ) : (
                    <Flag className="h-10 w-10 text-brand-400" />
                  )}
                  <span className="absolute left-2 top-2 rounded-md bg-slate-900/70 px-2 py-0.5 text-[11px] font-bold text-white">{loc.code}</span>
                  <span className={cn('absolute right-2 top-2 rounded-md px-2 py-0.5 text-[11px] font-semibold', meta.cls)}>{meta.label}</span>
                  {sizeLabel(loc) && (
                    <span className="absolute bottom-2 right-2 rounded-md bg-slate-900/70 px-2 py-0.5 text-[11px] font-medium text-white">{sizeLabel(loc)}</span>
                  )}
                </div>
                <div className="p-4">
                  <div className="flex items-center justify-between gap-2">
                    <p className="truncate font-bold text-slate-800 dark:text-white">{loc.place}</p>
                    <span className="shrink-0 rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-semibold text-slate-500 dark:bg-slate-800 dark:text-slate-400">{loc.standType}</span>
                  </div>
                  {loc.currentBanner ? (
                    <div className="mt-2 text-xs text-slate-500 dark:text-slate-400">
                      <p className="truncate font-semibold text-slate-600 dark:text-slate-300">{loc.currentBanner.title}</p>
                      <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1">
                        {loc.currentBanner.eventName && <span className="inline-flex items-center gap-1"><Flag className="h-3.5 w-3.5" /> {loc.currentBanner.eventName}</span>}
                        <span className="inline-flex items-center gap-1"><CalendarDays className="h-3.5 w-3.5" /> since {formatDate(loc.currentBanner.installedAt)}</span>
                      </div>
                    </div>
                  ) : (
                    <p className="mt-2 text-xs italic text-slate-400">Nothing mounted right now.</p>
                  )}
                  <div className="mt-3 flex items-center gap-1.5 border-t border-slate-100 pt-3 dark:border-slate-800">
                    <Button size="sm" variant="outline" onClick={() => setHistoryOf(loc)}><History className="h-3.5 w-3.5" /> History</Button>
                    <Button size="sm" variant="outline" onClick={() => setPlacingOn(loc)}><Plus className="h-3.5 w-3.5" /> Place</Button>
                    {(canManage(loc) || canRemove(loc)) && (
                      <div className="ml-auto flex gap-1">
                        {canManage(loc) && (
                          <button onClick={() => setEditLocation(loc)} aria-label="Edit location" className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-600 dark:hover:bg-slate-800 dark:hover:text-slate-300"><Pencil className="h-4 w-4" /></button>
                        )}
                        {canRemove(loc) && (
                          <button onClick={() => { if (window.confirm(`Delete stand ${loc.code} (${loc.place}) and its entire banner history? This cannot be undone.`)) removeMut.mutate(loc._id); }} aria-label="Delete location" className="rounded-lg p-1.5 text-rose-500 hover:bg-rose-50 dark:hover:bg-rose-500/10"><Trash2 className="h-4 w-4" /></button>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              </Card>
            );
          })}
        </div>
      )}

      {editLocation && <LocationModal location={editLocation} onClose={() => setEditLocation(null)} onSaved={() => { setEditLocation(null); invalidate(); }} />}
      {placingOn && <BannerModal preset={placingOn} locations={locations} onClose={() => setPlacingOn(null)} onSaved={() => { setPlacingOn(null); invalidate(); }} />}
      {historyOf && <HistoryModal location={historyOf} canManage={canManage} canRemove={canRemove(historyOf)} onClose={() => setHistoryOf(null)} onChanged={invalidate} />}
    </div>
  );
}

// ---- Add / edit a stand ----
function LocationModal({ location, onClose, onSaved }) {
  const isEdit = !!location._id;
  const [form, setForm] = useState({
    code: location.code || '',
    place: location.place || '',
    standType: location.standType || STAND_TYPES[0],
    width: location.width || '',
    height: location.height || '',
    sizeUnit: location.sizeUnit || 'ft',
    status: location.status || 'EMPTY',
    notes: location.notes || '',
    organization: location.organization?._id || '',
  });
  const [photo, setPhoto] = useState(null);
  const [loading, setLoading] = useState(false);

  const { data: orgData } = useQuery({ queryKey: ['org-options'], queryFn: organizationApi.options });
  const orgs = orgData?.organizations || [];

  const submit = async (e) => {
    e.preventDefault();
    if (!form.code.trim()) { toast.error('Enter the stand code (e.g. MG-01)'); return; }
    if (!form.place.trim()) { toast.error('Enter the place (e.g. Main Gate)'); return; }
    setLoading(true);
    try {
      const fd = new FormData();
      Object.entries(form).forEach(([k, v]) => { if (k !== 'status' || isEdit) fd.append(k, v); });
      if (photo) fd.append('photo', photo);
      if (isEdit) await signageApi.updateLocation(location._id, fd);
      else await signageApi.createLocation(fd);
      toast.success(isEdit ? 'Location updated' : 'Location added');
      onSaved();
    } catch (err) {
      toast.error(err.response?.data?.message || 'Save failed');
    } finally { setLoading(false); }
  };

  return (
    <Modal open onClose={onClose} title={isEdit ? `Edit ${location.code}` : 'Add Signage Location'} size="lg">
      <form onSubmit={submit} className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <Input label="Stand code" required value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value })} placeholder="e.g. MG-01" />
          <Input label="Place" required value={form.place} onChange={(e) => setForm({ ...form, place: e.target.value })} placeholder="e.g. Main Gate" />
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <Select label="Stand type" value={form.standType} onChange={(e) => setForm({ ...form, standType: e.target.value })}>
            {STAND_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
          </Select>
          {isEdit && (
            <Select label="Status" value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value })}>
              {Object.entries(STATUS_META).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
            </Select>
          )}
        </div>

        <div>
          <span className="mb-1.5 block text-sm font-medium text-slate-600 dark:text-slate-300">Fixed frame size (banners for this spot must match)</span>
          <div className="grid grid-cols-3 gap-3">
            <Input type="number" min="0" step="0.1" placeholder="Width" value={form.width} onChange={(e) => setForm({ ...form, width: e.target.value })} />
            <Input type="number" min="0" step="0.1" placeholder="Height" value={form.height} onChange={(e) => setForm({ ...form, height: e.target.value })} />
            <Select value={form.sizeUnit} onChange={(e) => setForm({ ...form, sizeUnit: e.target.value })}>
              {UNITS.map((u) => <option key={u} value={u}>{u}</option>)}
            </Select>
          </div>
        </div>

        <Select label="Organization (optional)" value={form.organization} onChange={(e) => setForm({ ...form, organization: e.target.value })}>
          <option value="">— None / college-wide —</option>
          {orgs.map((o) => <option key={o._id} value={o._id}>{o.name}</option>)}
        </Select>

        <label className="block">
          <span className="mb-1.5 block text-sm font-medium text-slate-600 dark:text-slate-300">Photo of the stand / spot (optional — helps the team find it)</span>
          <input type="file" accept="image/*" onChange={(e) => setPhoto(e.target.files?.[0] || null)}
            className="block w-full text-sm text-slate-500 file:mr-3 file:cursor-pointer file:rounded-lg file:border-0 file:bg-brand-50 file:px-3 file:py-2 file:text-sm file:font-semibold file:text-brand-700 hover:file:bg-brand-100 dark:file:bg-brand-500/10 dark:file:text-brand-300" />
        </label>

        <textarea className="input-base min-h-[70px]" placeholder="Notes (landmark, mounting details…)" value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />

        <div className="flex justify-end gap-2 pt-2">
          <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
          <Button type="submit" loading={loading}>{isEdit ? 'Save changes' : 'Add Location'}</Button>
        </div>
      </form>
    </Modal>
  );
}

// ---- Place a banner on a stand (or edit an existing banner record) ----
function BannerModal({ preset = {}, banner = null, locations = [], onClose, onSaved }) {
  const isEdit = !!banner?._id;
  const presetLoc = isEdit ? banner.location : (preset._id ? preset : null);
  const [form, setForm] = useState({
    location: presetLoc?._id || '',
    title: banner?.title || '',
    event: banner?.event || '',
    eventName: banner?.eventName || '',
    width: banner?.width ?? presetLoc?.width ?? '',
    height: banner?.height ?? presetLoc?.height ?? '',
    sizeUnit: banner?.sizeUnit || presetLoc?.sizeUnit || 'ft',
    installedAt: (banner?.installedAt ? String(banner.installedAt) : new Date().toISOString()).slice(0, 10),
    notes: banner?.notes || '',
  });
  const [files, setFiles] = useState({ preview: null, source: null, photo: null });
  const [loading, setLoading] = useState(false);

  const { data: evData } = useQuery({ queryKey: ['events', ''], queryFn: () => eventApi.list({}) });
  const events = evData?.events || [];

  const pickLocation = (id) => {
    const loc = locations.find((l) => l._id === id);
    setForm((f) => ({
      ...f, location: id,
      // Prefill the print size from the stand's fixed frame.
      width: loc?.width || f.width, height: loc?.height || f.height, sizeUnit: loc?.sizeUnit || f.sizeUnit,
    }));
  };

  const pickEvent = (id) => {
    const ev = events.find((x) => x._id === id);
    setForm((f) => ({ ...f, event: id, eventName: ev ? ev.name : f.eventName }));
  };

  const setFile = (key) => (e) => setFiles((f) => ({ ...f, [key]: e.target.files?.[0] || null }));

  const submit = async (e) => {
    e.preventDefault();
    if (!form.location) { toast.error('Choose the stand this banner goes on'); return; }
    if (!form.title.trim()) { toast.error('Give the banner a title'); return; }
    setLoading(true);
    try {
      const fd = new FormData();
      Object.entries(form).forEach(([k, v]) => fd.append(k, v));
      if (files.preview) fd.append('preview', files.preview);
      if (files.source) fd.append('source', files.source);
      if (files.photo) fd.append('photo', files.photo);
      if (isEdit) await signageApi.updateBanner(banner._id, fd);
      else await signageApi.placeBanner(fd);
      toast.success(isEdit ? 'Banner updated' : 'Banner placed — previous one moved to history');
      onSaved();
    } catch (err) {
      toast.error(err.response?.data?.message || 'Save failed');
    } finally { setLoading(false); }
  };

  const fileInputCls = 'block w-full text-sm text-slate-500 file:mr-3 file:cursor-pointer file:rounded-lg file:border-0 file:bg-brand-50 file:px-3 file:py-2 file:text-sm file:font-semibold file:text-brand-700 hover:file:bg-brand-100 dark:file:bg-brand-500/10 dark:file:text-brand-300';

  return (
    <Modal open onClose={onClose} title={isEdit ? 'Edit Banner' : 'Place a Banner'} size="lg">
      <form onSubmit={submit} className="space-y-4">
        <Select label="Stand / location" value={form.location} onChange={(e) => pickLocation(e.target.value)} disabled={isEdit}>
          <option value="">— Choose the stand —</option>
          {(isEdit ? [banner.location] : locations).filter(Boolean).map((l) => (
            <option key={l._id} value={l._id}>{l.code} — {l.place}{sizeLabel(l) ? ` (${sizeLabel(l)})` : ''}</option>
          ))}
        </Select>

        <Input label="Banner title" required value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder="e.g. Admissions Open 2026 arch" />

        <div className="grid gap-4 sm:grid-cols-2">
          <Select label="Link to an event (optional)" value={form.event} onChange={(e) => pickEvent(e.target.value)}>
            <option value="">— None —</option>
            {events.map((ev) => <option key={ev._id} value={ev._id}>{ev.name}</option>)}
          </Select>
          <Input label="Event / campaign name" value={form.eventName} onChange={(e) => setForm({ ...form, eventName: e.target.value })} placeholder="e.g. Admissions 2026" />
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <span className="mb-1.5 block text-sm font-medium text-slate-600 dark:text-slate-300">Printed size</span>
            <div className="grid grid-cols-3 gap-3">
              <Input type="number" min="0" step="0.1" placeholder="Width" value={form.width} onChange={(e) => setForm({ ...form, width: e.target.value })} />
              <Input type="number" min="0" step="0.1" placeholder="Height" value={form.height} onChange={(e) => setForm({ ...form, height: e.target.value })} />
              <Select value={form.sizeUnit} onChange={(e) => setForm({ ...form, sizeUnit: e.target.value })}>
                {UNITS.map((u) => <option key={u} value={u}>{u}</option>)}
              </Select>
            </div>
          </div>
          <Input label="Put up on" type="date" value={form.installedAt} onChange={(e) => setForm({ ...form, installedAt: e.target.value })} />
        </div>

        <div className="grid gap-4 sm:grid-cols-3">
          <label className="block">
            <span className="mb-1.5 block text-sm font-medium text-slate-600 dark:text-slate-300">Preview image (JPG/PNG)</span>
            <input type="file" accept="image/*" onChange={setFile('preview')} className={fileInputCls} />
          </label>
          <label className="block">
            <span className="mb-1.5 block text-sm font-medium text-slate-600 dark:text-slate-300">Design file (PSD/PDF/AI)</span>
            <input type="file" accept={SOURCE_ACCEPT} onChange={setFile('source')} className={fileInputCls} />
          </label>
          <label className="block">
            <span className="mb-1.5 block text-sm font-medium text-slate-600 dark:text-slate-300">Photo at the spot</span>
            <input type="file" accept="image/*" onChange={setFile('photo')} className={fileInputCls} />
          </label>
        </div>
        <p className="-mt-2 text-xs text-slate-400">The preview is what shows on cards; the design file is the print-ready original for reprints; the photo proves how it looks installed.</p>

        <textarea className="input-base min-h-[70px]" placeholder="Notes (printer, cost, who mounted it…)" value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />

        <div className="flex justify-end gap-2 pt-2">
          <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
          <Button type="submit" loading={loading}>{isEdit ? 'Save changes' : 'Place Banner'}</Button>
        </div>
      </form>
    </Modal>
  );
}

// ---- One stand's banner history (newest first) ----
// `canRemove` is decided by the parent, which has the signed-in user: deleting a
// banner record wipes its files, so it follows the same administrator rule as
// deleting the stand itself rather than the looser edit rule.
function HistoryModal({ location, canManage, canRemove, onClose, onChanged }) {
  const qc = useQueryClient();
  const [editBanner, setEditBanner] = useState(null);

  const { data, isLoading } = useQuery({
    queryKey: ['signage-banners', location._id],
    queryFn: () => signageApi.banners({ locationId: location._id }),
  });
  const banners = data?.banners || [];

  const refresh = () => { qc.invalidateQueries({ queryKey: ['signage-banners', location._id] }); onChanged(); };

  const removeMut = useMutation({
    mutationFn: (id) => signageApi.markRemoved(id),
    onSuccess: () => { toast.success('Marked as removed — the stand is empty now'); refresh(); },
    onError: (e) => toast.error(e.response?.data?.message || 'Update failed'),
  });
  const deleteMut = useMutation({
    mutationFn: (id) => signageApi.removeBanner(id),
    onSuccess: () => { toast.success('Banner record deleted'); refresh(); },
    onError: (e) => toast.error(e.response?.data?.message || 'Delete failed'),
  });

  return (
    <Modal open onClose={onClose} title={`${location.code} — ${location.place}`} size="lg">
      <p className="mb-4 text-xs text-slate-400">
        {location.standType}{sizeLabel(location) ? ` · ${sizeLabel(location)}` : ''} · every banner ever mounted here, newest first.
      </p>

      {isLoading ? (
        <div className="space-y-3">{Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-24" />)}</div>
      ) : banners.length === 0 ? (
        <EmptyState icon={History} title="No banners yet" description="Place the first banner on this stand to start its history." />
      ) : (
        <div className="space-y-3">
          {banners.map((b) => (
            <div key={b._id} className="flex gap-3 rounded-xl border border-slate-100 p-3 dark:border-slate-800">
              <div className="flex h-20 w-28 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-slate-100 dark:bg-slate-800">
                {b.preview || b.photo ? (
                  <img src={b.preview || b.photo} alt={b.title} className="h-full w-full object-cover" />
                ) : (
                  <Flag className="h-6 w-6 text-slate-300" />
                )}
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <p className="truncate text-sm font-bold text-slate-800 dark:text-white">{b.title}</p>
                  <span className={cn('shrink-0 rounded-full px-2 py-0.5 text-[10px] font-bold',
                    b.status === 'ACTIVE' ? 'bg-emerald-50 text-emerald-600 dark:bg-emerald-500/10' : 'bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400')}>
                    {b.status === 'ACTIVE' ? 'On the stand' : 'Removed'}
                  </span>
                </div>
                <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-xs text-slate-400">
                  {b.eventName && <span className="inline-flex items-center gap-1"><Flag className="h-3.5 w-3.5" /> {b.eventName}</span>}
                  <span className="inline-flex items-center gap-1">
                    <CalendarDays className="h-3.5 w-3.5" /> {formatDate(b.installedAt)}{b.removedAt ? ` → ${formatDate(b.removedAt)}` : ' → today'}
                  </span>
                  {sizeLabel(b) && <span>{sizeLabel(b)}</span>}
                </div>
                {b.notes && <p className="mt-1 line-clamp-2 text-xs text-slate-500 dark:text-slate-400">{b.notes}</p>}
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  {b.source && (
                    <a href={b.source} download={b.sourceName || true} target="_blank" rel="noreferrer"
                      className="inline-flex items-center gap-1 rounded-lg bg-slate-100 px-2 py-1 text-[11px] font-semibold text-slate-600 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700">
                      <Download className="h-3 w-3" /> {b.sourceName || 'Design file'}
                    </a>
                  )}
                  {b.photo && (
                    <a href={b.photo} target="_blank" rel="noreferrer"
                      className="inline-flex items-center gap-1 rounded-lg bg-slate-100 px-2 py-1 text-[11px] font-semibold text-slate-600 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700">
                      <Camera className="h-3 w-3" /> Photo at spot <ExternalLink className="h-2.5 w-2.5 opacity-70" />
                    </a>
                  )}
                  {canManage(b) && (
                    <span className="ml-auto flex gap-1">
                      {b.status === 'ACTIVE' && (
                        <Button size="sm" variant="outline" loading={removeMut.isPending}
                          onClick={() => { if (window.confirm(`Mark "${b.title}" as taken down? The stand becomes empty.`)) removeMut.mutate(b._id); }}>
                          Taken down
                        </Button>
                      )}
                      <button onClick={() => setEditBanner(b)} aria-label="Edit banner" className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-600 dark:hover:bg-slate-800 dark:hover:text-slate-300"><Pencil className="h-4 w-4" /></button>
                      {canRemove && (
                        <button onClick={() => { if (window.confirm(`Delete the record of "${b.title}" from the history? Its files are removed too.`)) deleteMut.mutate(b._id); }} aria-label="Delete banner" className="rounded-lg p-1.5 text-rose-500 hover:bg-rose-50 dark:hover:bg-rose-500/10"><Trash2 className="h-4 w-4" /></button>
                      )}
                    </span>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {editBanner && <BannerModal banner={editBanner} onClose={() => setEditBanner(null)} onSaved={() => { setEditBanner(null); refresh(); }} />}
    </Modal>
  );
}
