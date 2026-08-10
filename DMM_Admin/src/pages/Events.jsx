import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { Camera, Plus, ExternalLink, MapPin, CalendarDays, Pencil, Trash2, FolderOpen, ImagePlus } from 'lucide-react';
import { eventApi, organizationApi } from '../api/endpoints.js';
import { useAuthStore } from '../store/authStore.js';
import PageHeader from '../components/layout/PageHeader.jsx';
import { Modal } from '../components/ui/Modal.jsx';
import { Button } from '../components/ui/Button.jsx';
import { Input, Select, Card, Skeleton, EmptyState } from '../components/ui/primitives.jsx';
import ViewToggle, { useViewMode } from '../components/ui/ViewToggle.jsx';
import { formatDate } from '../lib/utils.js';

// Where "Open in Drive" goes: the link the organiser pasted, falling back to the
// Drive folder created for the event when there isn't one.
const photosHref = (ev) => ev.link || ev.folderLink || '';
// The event's tile picture: its cover image, else the first Drive photo.
const coverOf = (ev) => ev.coverImage || ev.photos?.[0]?.thumbnailUrl || '';

export default function Events() {
  const qc = useQueryClient();
  const { user } = useAuthStore();
  const [search, setSearch] = useState('');
  const [orgFilter, setOrgFilter] = useState(''); // '' = all, 'shared' = college-wide only, or an org id
  const [view, setView] = useViewMode('events');
  const [editing, setEditing] = useState(null);

  const { data: orgData } = useQuery({ queryKey: ['orgs-list'], queryFn: () => organizationApi.list() });
  const orgs = orgData?.organizations || [];

  const { data, isLoading } = useQuery({
    queryKey: ['events', search, orgFilter],
    queryFn: () => eventApi.list({ search, organizationId: orgFilter || undefined }),
  });
  const events = data?.events || [];
  const filtered = !!search.trim() || !!orgFilter;

  const removeMut = useMutation({
    mutationFn: (id) => eventApi.remove(id),
    onSuccess: () => { toast.success('Event deleted'); qc.invalidateQueries({ queryKey: ['events'] }); },
    onError: (e) => toast.error(e.response?.data?.message || 'Delete failed'),
  });

  const canManage = (ev) => ev.createdBy?._id === user?._id || user?.role === 'ADMIN' || user?.role === 'CEO';

  return (
    <div>
      <PageHeader
        title="Events"
        subtitle="Event photos captured by the Zolo team — kept at a linked Drive folder or album."
        actions={<Button onClick={() => setEditing({})}><Plus className="h-4 w-4" /> Add Event</Button>}
      />

      {/* Filters + view toggle */}
      <div className="mb-5 flex flex-col gap-3 lg:flex-row">
        <div className="flex-1">
          <Input placeholder="Search name, description or location…" value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
        <Select className="lg:w-60" value={orgFilter} onChange={(e) => setOrgFilter(e.target.value)} title="Filter by organization">
          <option value="">All colleges</option>
          <option value="shared">College-wide only</option>
          {orgs.map((o) => <option key={o._id} value={o._id}>{o.name}</option>)}
        </Select>
        <ViewToggle view={view} onChange={setView} />
      </div>

      {isLoading ? (
        view === 'grid' ? (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">{Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-64" />)}</div>
        ) : (
          <div className="space-y-2">{Array.from({ length: 8 }).map((_, i) => <Skeleton key={i} className="h-14" />)}</div>
        )
      ) : events.length === 0 ? (
        filtered ? (
          <EmptyState icon={Camera} title="No events match these filters" description="Try a different organization, or clear the search." />
        ) : (
          <EmptyState icon={Camera} title="No events yet" description="Add an event and link the folder or album holding its photos." action={<Button onClick={() => setEditing({})}><Plus className="h-4 w-4" /> Add Event</Button>} />
        )
      ) : view === 'list' ? (
        /* List view — one row per event, easier to scan a long season */
        <Card className="overflow-x-auto">
          <table className="w-full min-w-[820px] text-sm">
            <thead>
              <tr className="border-b border-slate-100 text-left text-xs font-bold uppercase tracking-wide text-slate-400 dark:border-slate-800">
                <th className="px-4 py-3">Event</th>
                <th className="px-3 py-3">Organization</th>
                <th className="px-3 py-3">Date</th>
                <th className="px-3 py-3">Location</th>
                <th className="px-3 py-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {events.map((ev) => (
                <tr key={ev._id} className="border-b border-slate-100 last:border-0 hover:bg-slate-50 dark:border-slate-800 dark:hover:bg-slate-800/50">
                  <td className="px-4 py-2.5">
                    <a href={photosHref(ev)} target="_blank" rel="noreferrer" className="flex items-center gap-3">
                      <span className="flex h-10 w-14 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-slate-100 dark:bg-slate-800">
                        {coverOf(ev) ? <img src={coverOf(ev)} alt="" className="h-full w-full object-cover" /> : <Camera className="h-4 w-4 text-brand-400" />}
                      </span>
                      <span className="min-w-0">
                        <span className="block truncate font-semibold text-slate-800 dark:text-white">{ev.name}</span>
                        {ev.description && <span className="block max-w-[280px] truncate text-xs text-slate-400">{ev.description}</span>}
                      </span>
                    </a>
                  </td>
                  <td className="px-3 py-2.5 text-xs text-slate-500 dark:text-slate-400">{ev.organization?.name || '— college-wide —'}</td>
                  <td className="whitespace-nowrap px-3 py-2.5 text-xs text-slate-500 dark:text-slate-400">{ev.eventDate ? formatDate(ev.eventDate) : '—'}</td>
                  <td className="px-3 py-2.5 text-xs text-slate-500 dark:text-slate-400">{ev.location || '—'}</td>
                  <td className="px-3 py-2.5">
                    <span className="flex items-center justify-end gap-1">
                      <a href={photosHref(ev)} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 rounded-lg bg-brand-600 px-2.5 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-brand-700">
                        <FolderOpen className="h-3.5 w-3.5" /> Photos
                      </a>
                      {canManage(ev) && (
                        <>
                          <button onClick={() => setEditing(ev)} aria-label={`Edit ${ev.name}`} className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-600 dark:hover:bg-slate-800 dark:hover:text-slate-300"><Pencil className="h-4 w-4" /></button>
                          <button onClick={() => { if (window.confirm(`Delete "${ev.name}"?`)) removeMut.mutate(ev._id); }} aria-label={`Delete ${ev.name}`} className="rounded-lg p-1.5 text-rose-500 hover:bg-rose-50 dark:hover:bg-rose-500/10"><Trash2 className="h-4 w-4" /></button>
                        </>
                      )}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {events.map((ev) => (
            <Card key={ev._id} className="group overflow-hidden">
              <div className="relative flex aspect-video items-center justify-center bg-gradient-to-br from-brand-500/10 to-slate-100 dark:from-brand-500/10 dark:to-slate-800">
                {coverOf(ev) ? (
                  <img src={coverOf(ev)} alt={ev.name} className="h-full w-full object-cover" />
                ) : (
                  <Camera className="h-10 w-10 text-brand-400" />
                )}
                {ev.organization?.name && (
                  <span className="absolute left-2 top-2 rounded-md bg-slate-900/70 px-2 py-0.5 text-[11px] font-semibold text-white">{ev.organization.name}</span>
                )}
                {canManage(ev) && (
                  <div className="absolute right-2 top-2 flex gap-1 opacity-0 transition-opacity group-hover:opacity-100">
                    <button onClick={() => setEditing(ev)} aria-label="Edit event" className="rounded-lg bg-white/90 p-1.5 text-slate-600 shadow-sm hover:bg-white dark:bg-slate-900/90 dark:text-slate-300"><Pencil className="h-3.5 w-3.5" /></button>
                    <button onClick={() => { if (window.confirm(`Delete "${ev.name}"?`)) removeMut.mutate(ev._id); }} aria-label="Delete event" className="rounded-lg bg-white/90 p-1.5 text-rose-600 shadow-sm hover:bg-white dark:bg-slate-900/90"><Trash2 className="h-3.5 w-3.5" /></button>
                  </div>
                )}
              </div>
              <div className="p-4">
                <p className="truncate font-bold text-slate-800 dark:text-white">{ev.name}</p>
                <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-xs text-slate-400">
                  {ev.eventDate && <span className="inline-flex items-center gap-1"><CalendarDays className="h-3.5 w-3.5" /> {formatDate(ev.eventDate)}</span>}
                  {ev.location && <span className="inline-flex items-center gap-1"><MapPin className="h-3.5 w-3.5" /> {ev.location}</span>}
                </div>
                {ev.description && <p className="mt-2 line-clamp-2 text-xs text-slate-500 dark:text-slate-400">{ev.description}</p>}
                <div className="mt-3 flex items-center gap-2">
                  <a href={photosHref(ev)} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 rounded-lg bg-brand-600 px-3 py-2 text-xs font-semibold text-white transition-colors hover:bg-brand-700">
                    <FolderOpen className="h-4 w-4" /> Open in Drive <ExternalLink className="h-3.5 w-3.5 opacity-80" />
                  </a>
                  {ev.photos?.length > 0 && <span className="text-xs text-slate-400">{ev.photos.length} photo{ev.photos.length > 1 ? 's' : ''}</span>}
                </div>
              </div>
            </Card>
          ))}
        </div>
      )}

      {editing && <EventModal event={editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); qc.invalidateQueries({ queryKey: ['events'] }); }} />}
    </div>
  );
}

function EventModal({ event, onClose, onSaved }) {
  const isEdit = !!event._id;
  const [form, setForm] = useState({
    name: event.name || '',
    eventDate: event.eventDate ? String(event.eventDate).slice(0, 10) : '',
    location: event.location || '',
    description: event.description || '',
    organization: event.organization?._id || '',
    link: event.link || '',
  });
  // One optional picture for the event's tile. The album itself lives at `link`.
  const [cover, setCover] = useState(null);
  const [coverPreview, setCoverPreview] = useState(event.coverImage || '');
  const [loading, setLoading] = useState(false);

  const onCover = (e) => {
    const f = e.target.files?.[0];
    if (f) { setCover(f); setCoverPreview(URL.createObjectURL(f)); }
  };

  const { data: orgData } = useQuery({ queryKey: ['orgs-list'], queryFn: () => organizationApi.list() });
  const orgs = orgData?.organizations || [];

  const submit = async (e) => {
    e.preventDefault();
    if (!form.name.trim()) { toast.error('Event name is required'); return; }
    setLoading(true);
    try {
      // Only send multipart when there is actually a file to carry.
      const body = () => {
        if (!cover) return { ...form };
        const fd = new FormData();
        Object.entries(form).forEach(([k, v]) => fd.append(k, v));
        fd.append('coverImage', cover);
        return fd;
      };
      if (isEdit) await eventApi.update(event._id, body());
      else await eventApi.create(body());
      toast.success(isEdit ? 'Event updated' : 'Event added');
      onSaved();
    } catch (err) {
      toast.error(err.response?.data?.message || 'Save failed');
    } finally { setLoading(false); }
  };

  return (
    <Modal open onClose={onClose} title={isEdit ? 'Edit Event' : 'Add Event'} size="lg">
      <form onSubmit={submit} className="space-y-4">
        <Input label="Event name" required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="e.g. Annual Tech Fest 2026" />

        <div className="grid gap-4 sm:grid-cols-2">
          <Input label="Event date" type="date" value={form.eventDate} onChange={(e) => setForm({ ...form, eventDate: e.target.value })} />
          <Input label="Location" value={form.location} onChange={(e) => setForm({ ...form, location: e.target.value })} placeholder="e.g. Main Auditorium" />
        </div>

        <Select label="Related organization (optional)" value={form.organization} onChange={(e) => setForm({ ...form, organization: e.target.value })}>
          <option value="">— None / college-wide —</option>
          {orgs.map((o) => <option key={o._id} value={o._id}>{o.name}</option>)}
        </Select>

        {/* Where the event's photos live. Paste the folder or album link and
            "Open in Drive" goes straight there. */}
        <Input
          label="Photos link"
          type="url"
          value={form.link}
          onChange={(e) => setForm({ ...form, link: e.target.value })}
          placeholder="https://drive.google.com/drive/folders/..."
        />
        <p className="-mt-2 text-xs text-slate-400">
          The Drive folder or shared album holding this event’s photos — “Open in Drive” opens it.
          {isEdit ? '' : ' Leave it blank to have a Drive folder created for the event instead.'}
        </p>

        {/* Cover image — one picture for the event tile, entirely optional. */}
        <div>
          <span className="mb-1.5 block text-sm font-medium text-slate-600 dark:text-slate-300">
            Cover image <span className="font-normal text-slate-400">· optional</span>
          </span>
          <div className="flex items-center gap-4">
            {coverPreview ? (
              <img src={coverPreview} alt="" className="h-16 w-24 shrink-0 rounded-xl object-cover" />
            ) : (
              <div className="flex h-16 w-24 shrink-0 items-center justify-center rounded-xl bg-slate-100 dark:bg-slate-800">
                <Camera className="h-5 w-5 text-slate-300 dark:text-slate-600" />
              </div>
            )}
            <div className="min-w-0">
              <label className="inline-flex cursor-pointer items-center gap-1.5 rounded-xl border border-slate-200 px-3 py-2 text-sm font-semibold text-slate-600 transition-colors hover:border-brand-300 hover:bg-brand-50/50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-brand-500/5">
                <ImagePlus className="h-4 w-4 text-brand-600" />
                {coverPreview ? 'Change cover image' : 'Upload cover image'}
                <input type="file" accept="image/*" className="hidden" onChange={onCover} />
              </label>
              <p className="mt-1.5 truncate text-xs text-slate-400">
                {cover ? cover.name : 'Shown on the event card. Leave blank for a placeholder.'}
              </p>
            </div>
          </div>
        </div>

        <textarea className="input-base min-h-[80px]" placeholder="Details about the event…" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />

        <div className="flex justify-end gap-2 pt-2">
          <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
          <Button type="submit" loading={loading}>{isEdit ? 'Save changes' : 'Add Event'}</Button>
        </div>
      </form>
    </Modal>
  );
}
