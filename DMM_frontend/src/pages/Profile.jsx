import { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import {
  CircleUser, Camera, Sparkles, Wrench, Share2, Plus, X, Pencil, Clock, CheckCircle2, XCircle,
} from 'lucide-react';
import { userApi, organizationApi } from '../api/endpoints.js';
import { useAuthStore } from '../store/authStore.js';
import PageHeader from '../components/layout/PageHeader.jsx';
import { Modal } from '../components/ui/Modal.jsx';
import { Button } from '../components/ui/Button.jsx';
import { Card, Input, Select, Avatar } from '../components/ui/primitives.jsx';
import JobTitleSelect from '../components/ui/JobTitleSelect.jsx';
import { formatDate, cn } from '../lib/utils.js';

const PAGE_PLATFORMS = ['LinkedIn', 'Instagram', 'YouTube', 'Facebook', 'X (Twitter)'];
const TOOL_SUGGESTIONS = ['Photoshop', 'Illustrator', 'Premiere Pro', 'After Effects', 'Canva', 'Figma', 'CorelDRAW', 'Lightroom', 'DaVinci Resolve', 'CapCut'];

export default function Profile() {
  const { user, setUser } = useAuthStore();
  const qc = useQueryClient();
  const firstTime = !user?.profileCompletedAt;

  const { data: orgData } = useQuery({ queryKey: ['org-options'], queryFn: organizationApi.options });
  const orgs = orgData?.organizations || [];

  const { data: reqData } = useQuery({
    queryKey: ['my-profile-request'],
    queryFn: userApi.myUpdateRequest,
    enabled: !firstTime,
  });
  const request = reqData?.request;

  return (
    <div>
      <PageHeader
        title="My Profile"
        subtitle={firstTime
          ? 'Welcome! Complete your profile below to start using the platform.'
          : 'Your details, skills and the pages you handle. Skill/tool changes are reviewed by an admin.'}
      />

      {firstTime ? (
        <FirstTimeForm user={user} orgs={orgs} onDone={(u) => { setUser(u); toast.success('Profile completed — welcome aboard!'); }} />
      ) : (
        <div className="space-y-5">
          {request?.status === 'PENDING' && (
            <div className="flex items-start gap-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm dark:border-amber-500/30 dark:bg-amber-500/10">
              <Clock className="mt-0.5 h-4 w-4 shrink-0 text-amber-500" />
              <div className="text-amber-700 dark:text-amber-300">
                <p className="font-semibold">Your profile update is waiting for admin review</p>
                <p className="mt-0.5 text-xs">Submitted {formatDate(request.createdAt)} — requested skills: {request.changes?.skills?.join(', ') || '—'} · tools: {request.changes?.tools?.join(', ') || '—'}</p>
              </div>
            </div>
          )}
          {request?.status === 'REJECTED' && (
            <div className="flex items-start gap-3 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm dark:border-rose-500/30 dark:bg-rose-500/10">
              <XCircle className="mt-0.5 h-4 w-4 shrink-0 text-rose-500" />
              <div className="text-rose-700 dark:text-rose-300">
                <p className="font-semibold">Your last profile update was rejected{request.reviewedBy?.name ? ` by ${request.reviewedBy.name}` : ''}</p>
                {request.reviewNote && <p className="mt-0.5 text-xs">Reason: {request.reviewNote}</p>}
                <p className="mt-0.5 text-xs">You can edit and submit again below.</p>
              </div>
            </div>
          )}
          {request?.status === 'APPROVED' && (
            <div className="flex items-start gap-3 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm dark:border-emerald-500/30 dark:bg-emerald-500/10">
              <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-500" />
              <p className="font-semibold text-emerald-700 dark:text-emerald-300">Your latest profile update was approved {request.reviewedAt ? formatDate(request.reviewedAt) : ''}.</p>
            </div>
          )}

          <ContactCard user={user} setUser={setUser} />
          <SkillsCard user={user} orgs={orgs} pending={request?.status === 'PENDING'} onSubmitted={() => qc.invalidateQueries({ queryKey: ['my-profile-request'] })} />
        </div>
      )}
    </div>
  );
}

// ---- Reusable chip/tag input ----
function TagInput({ label, values, onChange, placeholder, suggestions = [] }) {
  const [draft, setDraft] = useState('');
  const add = (raw) => {
    const v = String(raw).trim();
    if (!v) return;
    if (values.some((x) => x.toLowerCase() === v.toLowerCase())) { setDraft(''); return; }
    onChange([...values, v].slice(0, 30));
    setDraft('');
  };
  const onKey = (e) => {
    if (e.key === 'Enter' || e.key === ',') { e.preventDefault(); add(draft); }
    else if (e.key === 'Backspace' && !draft && values.length) onChange(values.slice(0, -1));
  };
  const unused = suggestions.filter((s) => !values.some((v) => v.toLowerCase() === s.toLowerCase()));
  return (
    <div>
      <span className="mb-1.5 block text-sm font-medium text-slate-600 dark:text-slate-300">{label}</span>
      <div className="flex flex-wrap items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-2.5 py-2 focus-within:border-brand-400 dark:border-slate-700 dark:bg-slate-900">
        {values.map((v) => (
          <span key={v} className="inline-flex items-center gap-1 rounded-lg bg-brand-50 px-2 py-0.5 text-xs font-semibold text-brand-700 dark:bg-brand-500/10 dark:text-brand-300">
            {v}
            <button type="button" onClick={() => onChange(values.filter((x) => x !== v))} aria-label={`Remove ${v}`} className="hover:text-brand-900"><X className="h-3 w-3" /></button>
          </span>
        ))}
        <input value={draft} onChange={(e) => setDraft(e.target.value)} onKeyDown={onKey} onBlur={() => add(draft)}
          placeholder={values.length ? '' : placeholder} className="min-w-[120px] flex-1 bg-transparent py-0.5 text-sm outline-none placeholder:text-slate-400 dark:text-white" />
      </div>
      {unused.length > 0 && (
        <div className="mt-1.5 flex flex-wrap gap-1">
          {unused.slice(0, 8).map((s) => (
            <button key={s} type="button" onClick={() => add(s)}
              className="rounded-lg bg-slate-100 px-2 py-0.5 text-[11px] font-medium text-slate-500 hover:bg-brand-50 hover:text-brand-600 dark:bg-slate-800 dark:text-slate-400 dark:hover:text-brand-300">
              + {s}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ---- Handles editor: which organization + which pages ----
function HandlesEditor({ value, onChange, orgs, optional = false }) {
  const rows = value.length ? value : [{ organization: '', platforms: [] }];
  const setRow = (i, patch) => {
    const next = rows.map((r, idx) => (idx === i ? { ...r, ...patch } : r));
    onChange(next);
  };
  const togglePlatform = (i, p) => {
    const row = rows[i];
    const platforms = row.platforms.includes(p) ? row.platforms.filter((x) => x !== p) : [...row.platforms, p];
    setRow(i, { platforms });
  };
  return (
    <div>
      <span className="mb-1.5 block text-sm font-medium text-slate-600 dark:text-slate-300">
        Pages you handle (organization + platforms)
        {optional && <span className="font-normal text-slate-400"> · optional</span>}
      </span>
      {optional && (
        <p className="mb-2 text-xs text-slate-400">
          Only fill this in if you publish for a college page. Leave it empty otherwise.
        </p>
      )}
      <div className="space-y-2.5">
        {rows.map((row, i) => (
          <div key={i} className="rounded-xl border border-slate-200 p-3 dark:border-slate-700">
            <div className="flex items-center gap-2">
              <Select value={row.organization} onChange={(e) => setRow(i, { organization: e.target.value })} className="flex-1">
                <option value="">— Choose organization —</option>
                {orgs.map((o) => <option key={o._id} value={o._id}>{o.name}</option>)}
              </Select>
              {rows.length > 1 && (
                <button type="button" onClick={() => onChange(rows.filter((_, idx) => idx !== i))} aria-label="Remove row"
                  className="rounded-lg p-2 text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-500/10"><X className="h-4 w-4" /></button>
              )}
            </div>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {PAGE_PLATFORMS.map((p) => (
                <button key={p} type="button" onClick={() => togglePlatform(i, p)}
                  className={cn('rounded-lg border px-2.5 py-1 text-xs font-semibold transition',
                    row.platforms.includes(p)
                      ? 'border-transparent bg-brand-600 text-white'
                      : 'border-slate-200 text-slate-500 hover:border-brand-300 dark:border-slate-700 dark:text-slate-400')}>
                  {p}
                </button>
              ))}
            </div>
          </div>
        ))}
      </div>
      <button type="button" onClick={() => onChange([...rows, { organization: '', platforms: [] }])}
        className="mt-2 inline-flex items-center gap-1 text-sm font-semibold text-brand-600 hover:text-brand-700">
        <Plus className="h-4 w-4" /> Add another organization
      </button>
    </div>
  );
}

const cleanHandles = (handles) => handles.filter((h) => h.organization && h.platforms.length);

// ---- First login: one form, applied directly ----
function FirstTimeForm({ user, orgs, onDone }) {
  // Who a page mapping actually applies to. A social handler publishes, so it is
  // required of them; a coordinator has no pages at all, so the section is not
  // even shown; a designer may optionally declare one.
  const isSocialHandler = user?.role === 'USER' && user?.userType === 'SOCIAL_HANDLER';
  const isCoordinator = user?.role === 'USER' && user?.userType === 'COORDINATOR';
  const [form, setForm] = useState({
    name: user?.name || '', phone: user?.phone || '', jobTitle: user?.jobTitle || '', linkedinUrl: user?.linkedinUrl || '',
  });
  const [skills, setSkills] = useState(user?.skills || []);
  const [tools, setTools] = useState(user?.tools || []);
  const [handles, setHandles] = useState([{ organization: '', platforms: [] }]);
  const [loading, setLoading] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    if (!form.name.trim()) { toast.error('Enter your name'); return; }
    if (!form.phone.trim()) { toast.error('Enter your phone number'); return; }
    if (!skills.length) { toast.error('Add at least one skill'); return; }
    if (!tools.length) { toast.error('Add at least one tool you know'); return; }
    const h = cleanHandles(handles);
    // Matches the server: only a social handler must name the pages they run.
    if (isSocialHandler && !h.length) { toast.error('Add at least one organization/page you handle'); return; }
    setLoading(true);
    try {
      const res = await userApi.completeProfile({ ...form, skills, tools, handles: h });
      onDone(res.user);
    } catch (err) {
      toast.error(err.response?.data?.message || 'Could not save profile');
    } finally { setLoading(false); }
  };

  return (
    <form onSubmit={submit}>
      <Card className="mx-auto max-w-3xl p-6">
        <div className="mb-5 flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-brand-500/10"><CircleUser className="h-5 w-5 text-brand-500" /></div>
          <div>
            <h3 className="font-bold text-slate-800 dark:text-white">Complete your profile</h3>
            <p className="text-xs text-slate-400">Signed in as {user?.email}. This first save applies immediately — later skill changes need admin approval.</p>
          </div>
        </div>
        <div className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <Input label="Full name" required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
            <Input label="Email" value={user?.email || ''} disabled />
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <Input label="Phone number" required value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} placeholder="+91 …" />
            <JobTitleSelect value={form.jobTitle} current={user?.jobTitle}
              onChange={(e) => setForm({ ...form, jobTitle: e.target.value })} />
          </div>
          <Input label="LinkedIn profile (optional)" value={form.linkedinUrl} onChange={(e) => setForm({ ...form, linkedinUrl: e.target.value })} placeholder="https://linkedin.com/in/…" />
          <TagInput label="Skill set" values={skills} onChange={setSkills} placeholder="e.g. Video Editing, Poster Design — press Enter to add" />
          <TagInput label="Tools you know" values={tools} onChange={setTools} placeholder="e.g. Photoshop — press Enter to add" suggestions={TOOL_SUGGESTIONS} />
          {!isCoordinator && (
            <HandlesEditor value={handles} onChange={setHandles} orgs={orgs} optional={!isSocialHandler} />
          )}
        </div>
        <Button type="submit" className="mt-6 w-full" size="lg" loading={loading}>Complete profile</Button>
      </Card>
    </form>
  );
}

// ---- Contact details (direct save, no review) ----
function ContactCard({ user, setUser }) {
  const [form, setForm] = useState({ name: user?.name || '', phone: user?.phone || '', jobTitle: user?.jobTitle || '', linkedinUrl: user?.linkedinUrl || '' });
  const [avatar, setAvatar] = useState(null);
  const [preview, setPreview] = useState(user?.avatar || '');
  const [loading, setLoading] = useState(false);

  // Revoke the object URL we created for the preview when it's replaced or the card unmounts.
  useEffect(() => {
    return () => { if (preview?.startsWith('blob:')) URL.revokeObjectURL(preview); };
  }, [preview]);

  const onAvatar = (e) => {
    const f = e.target.files?.[0];
    if (f) {
      if (preview?.startsWith('blob:')) URL.revokeObjectURL(preview);
      setAvatar(f);
      setPreview(URL.createObjectURL(f));
    }
  };

  const save = async () => {
    if (!form.name.trim()) { toast.error('Name is required'); return; }
    setLoading(true);
    try {
      const fd = new FormData();
      Object.entries(form).forEach(([k, v]) => fd.append(k, v));
      if (avatar) fd.append('avatar', avatar);
      const res = await userApi.updateProfile(fd);
      setUser({ ...user, ...res.user });
      toast.success('Contact details saved');
    } catch (e) { toast.error(e.response?.data?.message || 'Failed'); }
    finally { setLoading(false); }
  };

  return (
    <Card className="p-6">
      <h3 className="mb-5 font-bold text-slate-800 dark:text-white">Contact details</h3>
      <div className="mb-5 flex items-center gap-4">
        <div className="relative">
          <Avatar src={preview} name={form.name} size="lg" />
          <label className="absolute -bottom-1 -right-1 cursor-pointer rounded-full bg-brand-600 p-1.5 text-white hover:bg-brand-700">
            <Camera className="h-3.5 w-3.5" />
            <input type="file" accept="image/*" className="hidden" onChange={onAvatar} />
          </label>
        </div>
        <div>
          <p className="font-semibold text-slate-700 dark:text-slate-200">{user?.name}</p>
          <p className="text-sm text-slate-400">{user?.email} · {user?.role}{user?.organization?.name ? ` · ${user.organization.name}` : ''}</p>
        </div>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <Input label="Full name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
        <Input label="Phone number" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
        <JobTitleSelect value={form.jobTitle} current={user?.jobTitle}
          onChange={(e) => setForm({ ...form, jobTitle: e.target.value })} />
        <Input label="LinkedIn profile" value={form.linkedinUrl} onChange={(e) => setForm({ ...form, linkedinUrl: e.target.value })} />
      </div>
      <Button className="mt-5" loading={loading} onClick={save}>Save contact details</Button>
    </Card>
  );
}

// ---- Skills / tools / handles (read-only; changes go through admin review) ----

// Lively but consistent chip palette — each skill gets a colour by position.
const SKILL_TONES = [
  'bg-violet-50 text-violet-700 ring-violet-200 dark:bg-violet-500/10 dark:text-violet-300 dark:ring-violet-500/20',
  'bg-sky-50 text-sky-700 ring-sky-200 dark:bg-sky-500/10 dark:text-sky-300 dark:ring-sky-500/20',
  'bg-emerald-50 text-emerald-700 ring-emerald-200 dark:bg-emerald-500/10 dark:text-emerald-300 dark:ring-emerald-500/20',
  'bg-amber-50 text-amber-700 ring-amber-200 dark:bg-amber-500/10 dark:text-amber-300 dark:ring-amber-500/20',
  'bg-rose-50 text-rose-700 ring-rose-200 dark:bg-rose-500/10 dark:text-rose-300 dark:ring-rose-500/20',
  'bg-brand-50 text-brand-700 ring-brand-200 dark:bg-brand-500/10 dark:text-brand-300 dark:ring-brand-500/20',
];

// Social platforms carry their real brand colours.
const PLATFORM_TONES = {
  LinkedIn: 'bg-[#0A66C2]/10 text-[#0A66C2] ring-[#0A66C2]/20 dark:text-[#6BB3F0]',
  Instagram: 'bg-[#E1306C]/10 text-[#E1306C] ring-[#E1306C]/20 dark:text-[#F06C9B]',
  YouTube: 'bg-[#FF0000]/10 text-[#D40000] ring-[#FF0000]/20 dark:text-[#FF6B6B]',
  Facebook: 'bg-[#1877F2]/10 text-[#1877F2] ring-[#1877F2]/20 dark:text-[#6FA8F5]',
  'X (Twitter)': 'bg-slate-800/10 text-slate-700 ring-slate-400/30 dark:bg-white/10 dark:text-slate-200',
};

const Chip = ({ tone, children }) => (
  <span className={cn('inline-flex items-center rounded-full px-3 py-1 text-xs font-semibold ring-1 ring-inset', tone)}>
    {children}
  </span>
);

// A soft panel with an icon header for each profile category.
function ProfilePanel({ icon: Icon, iconTone, title, count, children, empty }) {
  return (
    <div className="rounded-2xl border border-slate-100 bg-slate-50/60 p-4 dark:border-slate-800 dark:bg-slate-800/30">
      <div className="mb-3 flex items-center gap-2.5">
        <span className={cn('flex h-8 w-8 items-center justify-center rounded-lg', iconTone)}>
          <Icon className="h-4 w-4" />
        </span>
        <p className="text-sm font-bold text-slate-700 dark:text-slate-200">{title}</p>
        {count > 0 && <span className="ml-auto rounded-full bg-white px-2 py-0.5 text-[11px] font-bold text-slate-500 shadow-soft dark:bg-slate-900 dark:text-slate-400">{count}</span>}
      </div>
      {count > 0 ? children : (
        <div className="rounded-xl border border-dashed border-slate-200 px-3 py-4 text-center text-xs italic text-slate-400 dark:border-slate-700">{empty}</div>
      )}
    </div>
  );
}

function SkillsCard({ user, orgs, pending, onSubmitted }) {
  const [editOpen, setEditOpen] = useState(false);
  const orgName = (id) => orgs.find((o) => o._id === String(id))?.name || 'Organization';
  const orgColor = (h) => h.organization?.color || orgs.find((o) => o._id === String(h.organization?._id || h.organization))?.color || '#f15d27';
  const skills = user?.skills || [];
  const tools = user?.tools || [];
  const handles = user?.handles || [];

  return (
    <Card className="overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 bg-gradient-to-r from-brand-500/[0.06] to-transparent px-6 py-4 dark:border-slate-800">
        <div>
          <h3 className="font-bold text-slate-800 dark:text-white">Skills, tools & pages you handle</h3>
          <p className="mt-0.5 text-xs text-slate-400">What you're great at, what you work with, and the pages you run.</p>
        </div>
        <Button size="sm" variant="outline" onClick={() => setEditOpen(true)} disabled={pending} title={pending ? 'Waiting for admin review of your previous request' : undefined}>
          <Pencil className="h-3.5 w-3.5" /> {pending ? 'Review pending…' : 'Request changes'}
        </Button>
      </div>

      <div className="grid gap-4 p-6 lg:grid-cols-3">
        <ProfilePanel icon={Sparkles} iconTone="bg-violet-100 text-violet-600 dark:bg-violet-500/15 dark:text-violet-300"
          title="Skill set" count={skills.length} empty="No skills added yet.">
          <div className="flex flex-wrap gap-1.5">
            {skills.map((s, i) => <Chip key={s} tone={SKILL_TONES[i % SKILL_TONES.length]}>{s}</Chip>)}
          </div>
        </ProfilePanel>

        <ProfilePanel icon={Wrench} iconTone="bg-amber-100 text-amber-600 dark:bg-amber-500/15 dark:text-amber-300"
          title="Tools" count={tools.length} empty="No tools added yet.">
          <div className="flex flex-wrap gap-1.5">
            {tools.map((t) => (
              <Chip key={t} tone="bg-white text-slate-700 ring-slate-200 shadow-soft dark:bg-slate-900 dark:text-slate-200 dark:ring-slate-700">
                <Wrench className="mr-1 h-3 w-3 text-amber-500" /> {t}
              </Chip>
            ))}
          </div>
        </ProfilePanel>

        <ProfilePanel icon={Share2} iconTone="bg-sky-100 text-sky-600 dark:bg-sky-500/15 dark:text-sky-300"
          title="Pages handled" count={handles.length} empty="No pages assigned yet.">
          <div className="space-y-2.5">
            {handles.map((h, i) => (
              <div key={i} className="rounded-xl bg-white p-2.5 shadow-soft dark:bg-slate-900">
                <p className="mb-1.5 flex items-center gap-1.5 text-sm font-semibold text-slate-700 dark:text-slate-200">
                  <span className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: orgColor(h) }} />
                  {h.organization?.name || orgName(h.organization)}
                </p>
                <div className="flex flex-wrap gap-1">
                  {(h.platforms || []).map((p) => (
                    <Chip key={p} tone={PLATFORM_TONES[p] || 'bg-slate-100 text-slate-600 ring-slate-200 dark:bg-slate-800 dark:text-slate-300 dark:ring-slate-700'}>{p}</Chip>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </ProfilePanel>
      </div>

      <p className="border-t border-slate-100 px-6 py-3 text-xs text-slate-400 dark:border-slate-800">
        Changes to this section need admin approval — use “Request changes” and an admin will review it.
      </p>

      {editOpen && <ChangeRequestModal user={user} orgs={orgs} onClose={() => setEditOpen(false)} onSubmitted={() => { setEditOpen(false); onSubmitted(); }} />}
    </Card>
  );
}

function ChangeRequestModal({ user, orgs, onClose, onSubmitted }) {
  const isSocialHandler = user?.role === 'USER' && user?.userType === 'SOCIAL_HANDLER';
  const isCoordinator = user?.role === 'USER' && user?.userType === 'COORDINATOR';
  const [skills, setSkills] = useState(user?.skills || []);
  const [tools, setTools] = useState(user?.tools || []);
  const [handles, setHandles] = useState(
    (user?.handles || []).length
      ? user.handles.map((h) => ({ organization: String(h.organization?._id || h.organization), platforms: h.platforms || [] }))
      : [{ organization: '', platforms: [] }]
  );
  const [note, setNote] = useState('');
  const [loading, setLoading] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    if (!skills.length) { toast.error('Add at least one skill'); return; }
    if (!tools.length) { toast.error('Add at least one tool'); return; }
    setLoading(true);
    try {
      await userApi.requestUpdate({ skills, tools, handles: cleanHandles(handles), note });
      toast.success('Sent for admin review — you will be notified once it is approved');
      onSubmitted();
    } catch (err) {
      toast.error(err.response?.data?.message || 'Could not submit');
    } finally { setLoading(false); }
  };

  return (
    <Modal open onClose={onClose} title="Request profile changes" size="lg">
      <form onSubmit={submit} className="space-y-4">
        <p className="rounded-xl bg-slate-50 px-3 py-2 text-xs text-slate-500 dark:bg-slate-800/60 dark:text-slate-400">
          Your changes below replace your current skills, tools{isCoordinator ? '' : ' and pages'} once an admin approves them.
        </p>
        <TagInput label="Skill set" values={skills} onChange={setSkills} placeholder="Press Enter to add" />
        <TagInput label="Tools you know" values={tools} onChange={setTools} placeholder="e.g. Photoshop" suggestions={TOOL_SUGGESTIONS} />
        {!isCoordinator && (
          <HandlesEditor value={handles} onChange={setHandles} orgs={orgs} optional={!isSocialHandler} />
        )}
        <Input label="Note to the admin (optional)" value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. Learned After Effects in the recent workshop" />
        <div className="flex justify-end gap-2 pt-2">
          <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
          <Button type="submit" loading={loading}>Submit for review</Button>
        </div>
      </form>
    </Modal>
  );
}
