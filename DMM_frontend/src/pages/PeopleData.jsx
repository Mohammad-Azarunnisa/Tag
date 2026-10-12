import { useEffect, useMemo, useRef, useState } from 'react';
import { useQuery, useMutation, useQueryClient, keepPreviousData } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import {
  Upload, FileSpreadsheet, Plus, Download, Pencil, Trash2, UserRound, GraduationCap, Briefcase,
  AlertTriangle, ChevronLeft, ChevronRight, X, Mail, Phone, Camera,
} from 'lucide-react';
import { peopleDataApi, organizationApi } from '../api/endpoints.js';
import { useAuthStore } from '../store/authStore.js';
import PageHeader from '../components/layout/PageHeader.jsx';
import { Modal } from '../components/ui/Modal.jsx';
import { Button } from '../components/ui/Button.jsx';
import { Card, Select, Input, Skeleton, EmptyState } from '../components/ui/primitives.jsx';
import { cn, triggerDownload } from '../lib/utils.js';

// Student and faculty directory — one page where a person's photo, name and
// details are always shown together. Photos live on the storage volume
// (people-data/students/<college>/<year>/<branch>/<roll no> and
// people-data/faculty/<college>/<employee id>/photo); this page is the one
// place to find, check and download them.

const DEFAULT_BRANCHES = ['CSE', 'ECE', 'EEE', 'MECH', 'CIVIL', 'IT', 'AIML', 'DS'];
const errMsg = (e, fallback) => e?.response?.data?.message || fallback;

function Photo({ url, name, className }) {
  const initials = (name || '?').split(' ').filter(Boolean).slice(0, 2).map((w) => w[0]).join('').toUpperCase();
  return url ? (
    <img src={url} alt={name || ''} loading="lazy" className={cn('object-cover', className)} />
  ) : (
    <div className={cn('flex items-center justify-center bg-slate-100 text-slate-400 dark:bg-slate-800', className)}>
      {initials ? <span className="text-lg font-bold">{initials}</span> : <Camera className="h-6 w-6" />}
    </div>
  );
}

export default function PeopleData() {
  const { user } = useAuthStore();
  const qc = useQueryClient();
  const isCoordinator = user?.role === 'USER' && user?.userType === 'COORDINATOR';
  const [tab, setTab] = useState('students');
  const [orgId, setOrgId] = useState('');
  const [year, setYear] = useState('');
  const [branch, setBranch] = useState('');
  const [search, setSearch] = useState('');
  const [debounced, setDebounced] = useState('');
  const [incompleteOnly, setIncompleteOnly] = useState(false);
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState(() => new Set());
  const [detail, setDetail] = useState(null);
  const [modal, setModal] = useState(null); // 'photos' | 'import' | { edit: person|null }

  useEffect(() => { const t = setTimeout(() => { setDebounced(search.trim()); setPage(1); }, 300); return () => clearTimeout(t); }, [search]);
  useEffect(() => { setPage(1); setSelected(new Set()); }, [tab, orgId, year, branch, incompleteOnly]);
  useEffect(() => { setYear(''); setBranch(''); setIncompleteOnly(false); }, [tab]);

  const { data: orgData } = useQuery({ queryKey: ['organization-options'], queryFn: () => organizationApi.options(), enabled: !isCoordinator });
  const orgs = orgData?.organizations || [];

  const params = {
    organizationId: orgId || undefined,
    year: tab === 'students' ? year || undefined : undefined,
    branch: tab === 'students' ? branch || undefined : undefined,
    q: debounced || undefined,
    status: incompleteOnly ? 'incomplete' : undefined,
    page,
  };
  const { data, isLoading, isFetching } = useQuery({
    queryKey: ['people-data', tab, params],
    queryFn: () => (tab === 'students' ? peopleDataApi.students(params) : peopleDataApi.faculty(params)),
    placeholderData: keepPreviousData,
  });
  const items = data?.items || [];
  const canEdit = !!data?.canEdit && !user?.viewOnly;
  const pages = Math.max(1, Math.ceil((data?.total || 0) / (data?.limit || 60)));
  const refresh = () => qc.invalidateQueries({ queryKey: ['people-data'] });

  const toggle = (id) => setSelected((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const downloadSelected = () => {
    const chosen = items.filter((p) => selected.has(p._id) && p.photoUrl);
    chosen.forEach((p, i) => setTimeout(() => triggerDownload(p.downloadUrl || p.photoUrl, fileNameFor(tab, p)), i * 350));
    if (!chosen.length) toast.error('None of the selected people have a photo yet');
  };

  const branchOptions = useMemo(() => [...new Set([...(data?.facets?.branches || []), ...DEFAULT_BRANCHES])].sort(), [data]);

  const delMut = useMutation({
    mutationFn: (p) => (tab === 'students' ? peopleDataApi.removeStudent(p._id) : peopleDataApi.removeFaculty(p._id)),
    onSuccess: () => { toast.success('Removed'); setDetail(null); refresh(); },
    onError: (e) => toast.error(errMsg(e, 'Could not remove that')),
  });

  return (
    <div>
      <PageHeader
        title="People Directory"
        subtitle="Student and faculty photos with their details, in one place — find someone, check their details, download their photo."
        actions={canEdit && (
          <>
            <Button variant="outline" onClick={() => setModal('import')}><FileSpreadsheet className="h-4 w-4" /> Import Excel</Button>
            {tab === 'students' && <Button variant="outline" onClick={() => setModal('photos')}><Upload className="h-4 w-4" /> Upload photos</Button>}
            <Button onClick={() => setModal({ edit: null })}><Plus className="h-4 w-4" /> Add {tab === 'students' ? 'student' : 'faculty'}</Button>
          </>
        )}
      />

      <div className="mb-4 inline-flex rounded-xl bg-slate-100 p-1 dark:bg-slate-800">
        {[['students', 'Students', GraduationCap], ['faculty', 'Faculty', Briefcase]].map(([k, label, Icon]) => (
          <button key={k} onClick={() => setTab(k)}
            className={cn('inline-flex items-center gap-2 rounded-lg px-4 py-1.5 text-sm font-semibold transition-colors',
              tab === k ? 'bg-white text-brand-600 shadow-sm dark:bg-slate-900 dark:text-brand-400' : 'text-slate-500 hover:text-slate-700 dark:text-slate-400')}>
            <Icon className="h-4 w-4" /> {label}
          </button>
        ))}
      </div>

      <Card className="mb-4 p-3">
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative min-w-[200px] flex-1">
            <Input aria-label="Search" placeholder={tab === 'students' ? 'Search name or roll number' : 'Search name, employee ID or designation'}
              value={search} onChange={(e) => setSearch(e.target.value)} />
          </div>
          {!isCoordinator && (
            <Select className="w-full sm:w-44" aria-label="College" value={orgId} onChange={(e) => setOrgId(e.target.value)}>
              <option value="">All colleges</option>
              {orgs.map((o) => <option key={o._id} value={o._id}>{o.name}</option>)}
            </Select>
          )}
          {tab === 'students' && (
            <>
              <Select className="w-full sm:w-36" aria-label="Pass-out year" value={year} onChange={(e) => setYear(e.target.value)}>
                <option value="">All years</option>
                {(data?.facets?.years || []).map((y) => <option key={y} value={y}>{y}</option>)}
              </Select>
              <Select className="w-full sm:w-36" aria-label="Branch" value={branch} onChange={(e) => setBranch(e.target.value)}>
                <option value="">All branches</option>
                {(data?.facets?.branches || []).map((b) => <option key={b} value={b}>{b}</option>)}
              </Select>
            </>
          )}
          {canEdit && (
            <button onClick={() => setIncompleteOnly((v) => !v)}
              className={cn('inline-flex items-center gap-1.5 rounded-xl border px-3 py-2 text-sm font-semibold transition-colors',
                incompleteOnly ? 'border-amber-300 bg-amber-50 text-amber-700 dark:border-amber-500/40 dark:bg-amber-500/10 dark:text-amber-300'
                  : 'border-slate-200 text-slate-500 hover:bg-slate-50 dark:border-slate-700 dark:hover:bg-slate-800')}>
              <AlertTriangle className="h-4 w-4" /> Needs attention{data?.incompleteCount ? ` (${data.incompleteCount})` : ''}
            </button>
          )}
        </div>
      </Card>

      {selected.size > 0 && (
        <div className="mb-3 flex items-center justify-between rounded-xl bg-brand-50 px-4 py-2 text-sm font-semibold text-brand-700 dark:bg-brand-500/10 dark:text-brand-300">
          {selected.size} selected
          <span className="flex gap-2">
            <Button size="sm" onClick={downloadSelected}><Download className="h-4 w-4" /> Download photos</Button>
            <Button size="sm" variant="ghost" onClick={() => setSelected(new Set())}><X className="h-4 w-4" /> Clear</Button>
          </span>
        </div>
      )}

      {isLoading ? (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">{Array.from({ length: 10 }).map((_, i) => <Skeleton key={i} className="h-56" />)}</div>
      ) : items.length === 0 ? (
        <EmptyState icon={UserRound} title={incompleteOnly ? 'Nothing needs attention' : `No ${tab} found`}
          description={canEdit ? 'Upload photos named by roll number or employee ID, then import an Excel sheet with names and details.' : 'Nothing matches those filters yet.'} />
      ) : (
        <div className={cn('grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5', isFetching && 'opacity-70')}>
          {items.map((p) => (
            <PersonCard key={p._id} p={p} tab={tab} showCollege={!isCoordinator} checked={selected.has(p._id)}
              onToggle={() => toggle(p._id)} onOpen={() => setDetail(p)} />
          ))}
        </div>
      )}

      {pages > 1 && (
        <div className="mt-5 flex items-center justify-center gap-3 text-sm text-slate-500">
          <Button size="sm" variant="outline" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}><ChevronLeft className="h-4 w-4" /></Button>
          Page {page} of {pages} · {data?.total} {tab}
          <Button size="sm" variant="outline" disabled={page >= pages} onClick={() => setPage((p) => p + 1)}><ChevronRight className="h-4 w-4" /></Button>
        </div>
      )}

      {detail && (
        <DetailModal p={detail} tab={tab} canEdit={canEdit} onClose={() => setDetail(null)}
          onEdit={() => { setModal({ edit: detail }); setDetail(null); }}
          onDelete={() => { if (window.confirm(`Remove ${detail.name || (tab === 'students' ? detail.rollNo : detail.employeeId)}? Their photo is deleted too.`)) delMut.mutate(detail); }} />
      )}
      {modal && typeof modal === 'object' && (
        <PersonForm tab={tab} person={modal.edit} orgs={orgs} isCoordinator={isCoordinator} branchOptions={branchOptions}
          defaultOrg={orgId} onClose={() => setModal(null)} onSaved={() => { setModal(null); refresh(); }} />
      )}
      {modal === 'photos' && (
        <PhotosModal orgs={orgs} isCoordinator={isCoordinator} branchOptions={branchOptions} defaultOrg={orgId}
          onClose={() => setModal(null)} onDone={refresh} />
      )}
      {modal === 'import' && (
        <ImportModal tab={tab} orgs={orgs} isCoordinator={isCoordinator} branchOptions={branchOptions} defaultOrg={orgId}
          onClose={() => setModal(null)} onDone={refresh} />
      )}
    </div>
  );
}

const fileNameFor = (tab, p) => {
  const base = (tab === 'students' ? p.rollNo : p.employeeId) || 'photo';
  const ext = (p.photoUrl.split('?')[0].match(/\.[a-z0-9]+$/i) || ['.jpg'])[0];
  return `${base}${ext}`;
};

function PersonCard({ p, tab, showCollege, checked, onToggle, onOpen }) {
  const isStudent = tab === 'students';
  const missing = [!p.hasPhoto && 'No photo', !p.hasDetails && 'No details'].filter(Boolean);
  return (
    <Card className={cn('group relative overflow-hidden p-0 transition-shadow hover:shadow-md', checked && 'ring-2 ring-brand-400')}>
      <label className="absolute left-2 top-2 z-10 flex h-6 w-6 cursor-pointer items-center justify-center rounded-md bg-white/90 shadow-sm dark:bg-slate-900/90">
        <input type="checkbox" checked={checked} onChange={onToggle} aria-label="Select" className="h-4 w-4 accent-brand-500" />
      </label>
      {missing.length > 0 && (
        <span className="absolute right-2 top-2 z-10 rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-bold text-amber-700">{missing.join(' · ')}</span>
      )}
      <button onClick={onOpen} className="block w-full text-left">
        <Photo url={p.photoUrl} name={p.name} className="h-40 w-full" />
        <div className="p-3">
          <p className="truncate text-sm font-bold text-slate-800 dark:text-white">{p.name || <span className="font-medium text-slate-400">Name not added</span>}</p>
          <p className="mt-0.5 truncate text-xs font-semibold text-brand-600 dark:text-brand-400">{isStudent ? p.rollNo : p.employeeId}</p>
          <p className="mt-1 truncate text-xs text-slate-400">
            {isStudent
              ? [p.branch, p.passOutYear && `Batch ${p.passOutYear}`].filter(Boolean).join(' · ') || '—'
              : [p.designation, p.department].filter(Boolean).join(' · ') || '—'}
          </p>
          {showCollege && <p className="mt-0.5 truncate text-[11px] text-slate-400">{p.organization?.name}</p>}
        </div>
      </button>
    </Card>
  );
}

function Row({ icon: Icon, label, value }) {
  if (!value) return null;
  return (
    <div className="flex items-start gap-2.5 text-sm">
      {Icon ? <Icon className="mt-0.5 h-4 w-4 shrink-0 text-slate-400" /> : <span className="w-4" />}
      <div><p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">{label}</p><p className="font-medium text-slate-700 dark:text-slate-200">{value}</p></div>
    </div>
  );
}

function DetailModal({ p, tab, canEdit, onClose, onEdit, onDelete }) {
  const isStudent = tab === 'students';
  return (
    <Modal open onClose={onClose} title={p.name || (isStudent ? p.rollNo : p.employeeId)} size="md">
      <div className="space-y-4">
        <Photo url={p.photoUrl} name={p.name} className="mx-auto h-72 w-full max-w-xs rounded-2xl" />
        <div className="grid gap-3 sm:grid-cols-2">
          <Row label={isStudent ? 'Roll number' : 'Employee ID'} value={isStudent ? p.rollNo : p.employeeId} />
          <Row label="Full name" value={p.name} />
          <Row label="College" value={p.organization?.name} />
          {isStudent ? (
            <>
              <Row label="Branch" value={p.branch} />
              <Row label="Pass-out year" value={p.passOutYear} />
              <Row label="Section" value={p.section} />
              <Row icon={Phone} label="Mobile" value={p.phone} />
              <Row icon={Phone} label="Guardian mobile" value={p.guardianPhone} />
              <Row icon={Mail} label="Email" value={p.email} />
            </>
          ) : (
            <>
              <Row label="Designation" value={p.designation} />
              <Row label="Degree" value={p.degree} />
              <Row label="Department" value={p.department} />
              <Row icon={Phone} label="Mobile" value={p.phone} />
              <Row icon={Mail} label="Email" value={p.email} />
            </>
          )}
        </div>
        <div className="flex flex-wrap justify-end gap-2 border-t border-slate-100 pt-3 dark:border-slate-800">
          {canEdit && <Button variant="danger" size="sm" onClick={onDelete}><Trash2 className="h-4 w-4" /> Remove</Button>}
          {canEdit && <Button variant="outline" size="sm" onClick={onEdit}><Pencil className="h-4 w-4" /> Edit</Button>}
          <Button size="sm" disabled={!p.photoUrl} onClick={() => triggerDownload(p.downloadUrl || p.photoUrl, fileNameFor(tab, p))}><Download className="h-4 w-4" /> Download photo</Button>
        </div>
      </div>
    </Modal>
  );
}

function CollegePicker({ orgs, isCoordinator, value, onChange }) {
  if (isCoordinator) return null;
  return (
    <Select label="College" value={value} onChange={(e) => onChange(e.target.value)}>
      <option value="">Select a college…</option>
      {orgs.map((o) => <option key={o._id} value={o._id}>{o.name}</option>)}
    </Select>
  );
}

function BranchInput({ value, onChange, options, label = 'Branch' }) {
  const id = useRef(`branches-${Math.random().toString(36).slice(2, 7)}`).current;
  return (
    <>
      <Input label={label} list={id} value={value} onChange={(e) => onChange(e.target.value.toUpperCase())} placeholder="e.g. CSE" />
      <datalist id={id}>{options.map((b) => <option key={b} value={b} />)}</datalist>
    </>
  );
}

function PersonForm({ tab, person, orgs, isCoordinator, branchOptions, defaultOrg, onClose, onSaved }) {
  const isStudent = tab === 'students';
  const editing = !!person;
  const [f, setF] = useState(() => ({
    organization: person?.organization?._id || defaultOrg || '',
    rollNo: person?.rollNo || '', employeeId: person?.employeeId || '',
    name: person?.name || '', passOutYear: person?.passOutYear || '', branch: person?.branch || '', section: person?.section || '',
    phone: person?.phone || '', email: person?.email || '', guardianPhone: person?.guardianPhone || '',
    degree: person?.degree || '', designation: person?.designation || '', department: person?.department || '',
    photoLink: '',
  }));
  const [photo, setPhoto] = useState(null);
  const set = (k) => (e) => setF((s) => ({ ...s, [k]: e.target.value }));
  const preview = useMemo(() => (photo ? URL.createObjectURL(photo) : person?.photoUrl || ''), [photo, person]);

  const mut = useMutation({
    mutationFn: () => {
      const fd = new FormData();
      const fields = isStudent
        ? ['rollNo', 'name', 'passOutYear', 'branch', 'section', 'phone', 'email', 'guardianPhone']
        : ['employeeId', 'name', 'degree', 'designation', 'department', 'phone', 'email'];
      fields.forEach((k) => fd.append(k, f[k] ?? ''));
      if (!editing && !isCoordinator) fd.append('organization', f.organization);
      if (photo) fd.append('photo', photo);
      else if (f.photoLink.trim()) fd.append('photoLink', f.photoLink.trim());
      if (isStudent) return editing ? peopleDataApi.updateStudent(person._id, fd) : peopleDataApi.createStudent(fd);
      return editing ? peopleDataApi.updateFaculty(person._id, fd) : peopleDataApi.createFaculty(fd);
    },
    onSuccess: () => { toast.success(editing ? 'Saved' : 'Added'); onSaved(); },
    onError: (e) => toast.error(errMsg(e, 'Could not save that')),
  });

  const submit = (e) => {
    e.preventDefault();
    if (!editing && !isCoordinator && !f.organization) return toast.error('Choose a college');
    if (isStudent && !f.rollNo.trim()) return toast.error('Roll number is required');
    if (!isStudent && !f.employeeId.trim()) return toast.error('Employee ID is required');
    mut.mutate();
  };

  return (
    <Modal open onClose={onClose} title={`${editing ? 'Edit' : 'Add'} ${isStudent ? 'student' : 'faculty member'}`} size="md">
      <form onSubmit={submit} className="space-y-4">
        <div className="flex items-center gap-4">
          <Photo url={preview} name={f.name} className="h-24 w-24 shrink-0 rounded-2xl" />
          <label className="cursor-pointer text-sm font-semibold text-brand-600 hover:underline dark:text-brand-400">
            {preview ? 'Change photo' : 'Choose a photo'}
            <input type="file" accept="image/png,image/jpeg,image/webp" className="hidden" onChange={(e) => setPhoto(e.target.files?.[0] || null)} />
            <span className="mt-0.5 block text-xs font-normal text-slate-400">JPG, PNG or WEBP — saved to Google Drive</span>
          </label>
        </div>
        <Input label="Or paste a Google Drive link to the photo" value={f.photoLink} onChange={set('photoLink')} disabled={!!photo}
          placeholder="https://drive.google.com/file/d/…/view" />
        <p className="-mt-2 text-xs text-slate-400">Share the photo with “Anyone with the link” first, so it shows here.</p>
        {!editing && <CollegePicker orgs={orgs} isCoordinator={isCoordinator} value={f.organization} onChange={(v) => setF((s) => ({ ...s, organization: v }))} />}
        <div className="grid gap-3 sm:grid-cols-2">
          {isStudent ? (
            <Input label="Roll number" required value={f.rollNo} onChange={set('rollNo')} placeholder="e.g. 21A91A0501" />
          ) : (
            <Input label="Employee ID" required disabled={editing} value={f.employeeId} onChange={set('employeeId')} placeholder="e.g. EMP1042" />
          )}
          <Input label="Full name" value={f.name} onChange={set('name')} />
          {isStudent ? (
            <>
              <BranchInput value={f.branch} onChange={(v) => setF((s) => ({ ...s, branch: v }))} options={branchOptions} />
              <Input label="Pass-out year" type="number" value={f.passOutYear} onChange={set('passOutYear')} placeholder="e.g. 2025" />
              <Input label="Section" value={f.section} onChange={set('section')} />
              <Input label="Mobile" value={f.phone} onChange={set('phone')} />
              <Input label="Guardian mobile" value={f.guardianPhone} onChange={set('guardianPhone')} />
              <Input label="Email" type="email" value={f.email} onChange={set('email')} />
            </>
          ) : (
            <>
              <Input label="Degree" value={f.degree} onChange={set('degree')} placeholder="e.g. M.Tech, Ph.D" />
              <Input label="Designation" value={f.designation} onChange={set('designation')} placeholder="e.g. Associate Professor" />
              <Input label="Department" value={f.department} onChange={set('department')} />
              <Input label="Mobile" value={f.phone} onChange={set('phone')} />
              <Input label="Email" type="email" value={f.email} onChange={set('email')} />
            </>
          )}
        </div>
        {editing && isStudent && <p className="text-xs text-slate-400">Changing the branch, year or roll number moves the photo to the matching folder in Google Drive.</p>}
        <div className="flex justify-end gap-2 pt-1">
          <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
          <Button type="submit" loading={mut.isPending}>{editing ? 'Save changes' : 'Add'}</Button>
        </div>
      </form>
    </Modal>
  );
}

function PhotosModal({ orgs, isCoordinator, branchOptions, defaultOrg, onClose, onDone }) {
  const [organization, setOrganization] = useState(defaultOrg || '');
  const [passOutYear, setYear] = useState('');
  const [branch, setBranch] = useState('');
  const [overwrite, setOverwrite] = useState(false);
  const [files, setFiles] = useState([]);
  const [result, setResult] = useState(null);

  const mut = useMutation({
    mutationFn: () => {
      const fd = new FormData();
      if (!isCoordinator) fd.append('organization', organization);
      fd.append('passOutYear', passOutYear);
      fd.append('branch', branch);
      fd.append('overwrite', String(overwrite));
      files.forEach((file) => fd.append('photos', file));
      return peopleDataApi.uploadStudentPhotos(fd);
    },
    onSuccess: (r) => { setResult(r); onDone(); },
    onError: (e) => toast.error(errMsg(e, 'Upload failed')),
  });

  const submit = (e) => {
    e.preventDefault();
    if (!isCoordinator && !organization) return toast.error('Choose a college');
    if (!files.length) return toast.error('Choose the photos first');
    mut.mutate();
  };

  return (
    <Modal open onClose={onClose} title="Upload student photos" size="md">
      {result ? (
        <div className="space-y-3 text-sm">
          <p className="font-semibold text-slate-800 dark:text-white">Done.</p>
          <ul className="space-y-1 text-slate-600 dark:text-slate-300">
            <li>{result.attached} photo(s) added to existing students</li>
            <li>{result.replaced} photo(s) replaced</li>
            <li>{result.created} new student(s) created — these show under “Needs attention” until their details are added</li>
            {result.skipped.length > 0 && <li>{result.skipped.length} skipped — already had a photo</li>}
          </ul>
          {[...result.skipped, ...result.failed].length > 0 && (
            <div className="max-h-40 overflow-auto rounded-xl bg-slate-50 p-3 text-xs dark:bg-slate-800/60">
              {[...result.skipped, ...result.failed].map((x, i) => <p key={i}><b>{x.file}</b> — {x.reason}</p>)}
            </div>
          )}
          <div className="flex justify-end"><Button onClick={onClose}>Close</Button></div>
        </div>
      ) : (
        <form onSubmit={submit} className="space-y-4">
          <p className="rounded-xl bg-slate-50 px-3 py-2 text-xs text-slate-500 dark:bg-slate-800/60 dark:text-slate-300">
            Name each photo with the student’s roll number (for example <b>21A91A0501.jpg</b>). It is saved to Google Drive in the college → year → branch folder.
          </p>
          <CollegePicker orgs={orgs} isCoordinator={isCoordinator} value={organization} onChange={setOrganization} />
          <div className="grid gap-3 sm:grid-cols-2">
            <Input label="Pass-out year" type="number" value={passOutYear} onChange={(e) => setYear(e.target.value)} placeholder="e.g. 2025" />
            <BranchInput value={branch} onChange={setBranch} options={branchOptions} />
          </div>
          <label className="block">
            <span className="mb-1.5 block text-sm font-medium text-slate-600 dark:text-slate-300">Photos</span>
            <input type="file" multiple accept="image/png,image/jpeg,image/webp" onChange={(e) => setFiles(Array.from(e.target.files || []))}
              className="block w-full text-sm text-slate-500 file:mr-3 file:rounded-lg file:border-0 file:bg-brand-50 file:px-3 file:py-2 file:text-sm file:font-semibold file:text-brand-700" />
            {files.length > 0 && <span className="mt-1 block text-xs text-slate-400">{files.length} photo(s) chosen</span>}
          </label>
          <label className="flex items-center gap-2 text-sm text-slate-600 dark:text-slate-300">
            <input type="checkbox" checked={overwrite} onChange={(e) => setOverwrite(e.target.checked)} className="h-4 w-4 accent-brand-500" />
            Replace photos that already exist for the same roll number
          </label>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
            <Button type="submit" loading={mut.isPending}><Upload className="h-4 w-4" /> Upload</Button>
          </div>
        </form>
      )}
    </Modal>
  );
}

function ImportModal({ tab, orgs, isCoordinator, branchOptions, defaultOrg, onClose, onDone }) {
  const isStudent = tab === 'students';
  const [organization, setOrganization] = useState(defaultOrg || '');
  const [passOutYear, setYear] = useState('');
  const [branch, setBranch] = useState('');
  const [file, setFile] = useState(null);
  const [result, setResult] = useState(null);

  const mut = useMutation({
    mutationFn: () => {
      const fd = new FormData();
      if (!isCoordinator) fd.append('organization', organization);
      if (isStudent) { fd.append('passOutYear', passOutYear); fd.append('branch', branch); }
      fd.append('file', file);
      return isStudent ? peopleDataApi.importStudents(fd) : peopleDataApi.importFaculty(fd);
    },
    onSuccess: (r) => { setResult(r); onDone(); },
    onError: (e) => toast.error(errMsg(e, 'Import failed')),
  });

  const submit = (e) => {
    e.preventDefault();
    if (!isCoordinator && !organization) return toast.error('Choose a college');
    if (!file) return toast.error('Choose the Excel file first');
    mut.mutate();
  };

  return (
    <Modal open onClose={onClose} title={`Import ${isStudent ? 'student' : 'faculty'} details from Excel`} size="md">
      {result ? (
        <div className="space-y-3 text-sm">
          <p className="font-semibold text-slate-800 dark:text-white">{result.created} added, {result.updated} updated.</p>
          {result.problems?.length > 0 && (
            <div className="max-h-40 overflow-auto rounded-xl bg-amber-50 p-3 text-xs text-amber-800">{result.problems.map((x, i) => <p key={i}>{x}</p>)}</div>
          )}
          <div className="flex justify-end"><Button onClick={onClose}>Close</Button></div>
        </div>
      ) : (
        <form onSubmit={submit} className="space-y-4">
          <p className="rounded-xl bg-slate-50 px-3 py-2 text-xs text-slate-500 dark:bg-slate-800/60 dark:text-slate-300">
            One row per {isStudent ? 'student' : 'person'}, matched by {isStudent ? 'roll number' : 'employee ID'}. Existing photos are kept, and blank cells never erase details already saved.{' '}
            <button type="button" className="font-semibold text-brand-600 hover:underline dark:text-brand-400" onClick={() => (isStudent ? peopleDataApi.studentTemplate() : peopleDataApi.facultyTemplate())}>
              Download the template
            </button>
          </p>
          <CollegePicker orgs={orgs} isCoordinator={isCoordinator} value={organization} onChange={setOrganization} />
          {isStudent && (
            <div className="grid gap-3 sm:grid-cols-2">
              <Input label="Pass-out year (if the sheet has none)" type="number" value={passOutYear} onChange={(e) => setYear(e.target.value)} />
              <BranchInput label="Branch (if the sheet has none)" value={branch} onChange={setBranch} options={branchOptions} />
            </div>
          )}
          <input type="file" accept=".xlsx,.xls,.csv" onChange={(e) => setFile(e.target.files?.[0] || null)}
            className="block w-full text-sm text-slate-500 file:mr-3 file:rounded-lg file:border-0 file:bg-brand-50 file:px-3 file:py-2 file:text-sm file:font-semibold file:text-brand-700" />
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
            <Button type="submit" loading={mut.isPending}><FileSpreadsheet className="h-4 w-4" /> Import</Button>
          </div>
        </form>
      )}
    </Modal>
  );
}
