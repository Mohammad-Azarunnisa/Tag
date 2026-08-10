import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { BriefcaseBusiness, ClipboardList, Palette, Send } from 'lucide-react';
import { organizationApi, userApi, workAssignmentApi, institutionRequestApi } from '../../api/endpoints.js';
import { useAuthStore } from '../../store/authStore.js';
import { Modal } from '../ui/Modal.jsx';
import { Button } from '../ui/Button.jsx';
import { Input, Select } from '../ui/primitives.jsx';
import { cn } from '../../lib/utils.js';

const ASSIGNEE_TYPES = [
  { key: 'DESIGNER', label: 'Designer', icon: Palette, hint: 'Creative and production work' },
  { key: 'SOCIAL_HANDLER', label: 'Social Handler', icon: Send, hint: 'Platform-specific publishing work' },
];

const PLATFORMS = ['LinkedIn', 'Instagram', 'YouTube', 'Facebook'];

// Tells the assignee what to pick up first.
const URGENCIES = [
  { key: 'LOW', label: 'Low', cls: 'border-slate-300 text-slate-600 dark:border-slate-600 dark:text-slate-300' },
  { key: 'NORMAL', label: 'Normal', cls: 'border-sky-400 text-sky-700 dark:text-sky-300' },
  { key: 'HIGH', label: 'High', cls: 'border-amber-400 text-amber-700 dark:text-amber-300' },
  { key: 'URGENT', label: 'Urgent', cls: 'border-rose-400 text-rose-700 dark:text-rose-300' },
];

export default function WorkAssignmentModal({ onClose, onSaved }) {
  const me = useAuthStore((s) => s.user);
  const isPrivileged = ['ADMIN', 'CEO'].includes(me?.role);
  const [form, setForm] = useState({ organization: '', assigneeType: 'DESIGNER', assigneeIds: [], platform: '', urgency: 'NORMAL', title: '', description: '', sourceRequest: '' });
  const [loading, setLoading] = useState(false);

  const { data: orgData } = useQuery({ queryKey: ['work-assign-orgs'], queryFn: () => organizationApi.list() });
  const orgs = orgData?.organizations || [];

  // Every request the Admin or super admin approved parks in GETTING_ALLOCATED
  // until someone hands the work out. This queue is what the page is for, so it
  // is fetched unscoped — the server already limits it to colleges the viewer
  // holds — and picking one fills the rest of the form in.
  const { data: reqData } = useQuery({
    queryKey: ['work-allocation-queue'],
    queryFn: () => institutionRequestApi.list({ status: 'GETTING_ALLOCATED' }),
  });
  const approvedRequests = reqData?.requests || [];
  const picked = approvedRequests.find((r) => r._id === form.sourceRequest) || null;

  // A picked request already names the college the work is for, so the org
  // question is answered and the picker is not asked again.
  const showOrgPicker = !picked && (form.assigneeType === 'SOCIAL_HANDLER' || !isPrivileged);
  // Designers are one pool across every college; only a social handler has to be
  // mapped to the college, so only they need an org before names can be listed.
  const needsOrgFirst = !form.organization && (form.assigneeType === 'SOCIAL_HANDLER' || !isPrivileged);

  // Taking a request off the queue carries its college, its urgency and its
  // brief across, so the allocation describes what the college actually asked
  // for rather than whatever the allocator retypes.
  const pickRequest = (id) => {
    const r = approvedRequests.find((x) => x._id === id);
    if (!r) {
      setForm((f) => ({ ...f, sourceRequest: '', organization: '', assigneeIds: [], title: '', description: '' }));
      return;
    }
    setForm((f) => ({
      ...f,
      sourceRequest: r._id,
      organization: String(r.organization?._id || r.organization || ''),
      assigneeIds: [],
      urgency: ['LOW', 'NORMAL', 'HIGH', 'URGENT'].includes(r.priority) ? r.priority : 'NORMAL',
      title: r.title || '',
      description: r.details || '',
    }));
  };

  // Designers come back unscoped for an Admin — the pool is shared, so narrowing
  // by the request's college here would hide most of it. Everyone else is fetched
  // against the college the work is for.
  const designerPool = form.assigneeType === 'DESIGNER' && isPrivileged;
  const { data: usersData } = useQuery({
    queryKey: ['work-assign-users', designerPool ? 'all' : form.organization, form.assigneeType],
    queryFn: () => userApi.list(
      designerPool || form.assigneeType === 'SOCIAL_HANDLER' || !form.organization
        ? { role: 'USER' }
        : { role: 'USER', organization: form.organization }
    ),
  });
  const users = usersData?.users || [];

  const candidates = useMemo(() => {
    let list = users.filter((u) => u.role === 'USER' && u.userType === form.assigneeType);
    if (form.assigneeType === 'DESIGNER' && isPrivileged) {
      return list;
    }
    if (form.assigneeType !== 'SOCIAL_HANDLER' && form.organization) {
      list = list.filter((u) => String(u.organization?._id || u.organization || '') === String(form.organization));
    }
    if (form.assigneeType === 'SOCIAL_HANDLER' && form.organization) {
      list = list.filter((u) => (u.handles || []).some((h) => String(h.organization?._id || h.organization) === String(form.organization)
        && (!form.platform || (h.platforms || []).includes(form.platform))));
    }
    return list;
  }, [users, form.organization, form.assigneeType, form.platform, isPrivileged]);

  const submit = async () => {
    if (needsOrgFirst) { toast.error('Please choose an organization'); return; }
    if (!form.assigneeIds.length) { toast.error('Please choose at least one assignee'); return; }
    if (!form.title.trim()) { toast.error('Please add a title'); return; }
    if (form.assigneeType === 'SOCIAL_HANDLER' && !form.platform) { toast.error('Choose a platform for social-handler work'); return; }

    setLoading(true);
    try {
      await workAssignmentApi.create({
        ...(form.organization ? { organization: form.organization } : {}),
        assigneeIds: form.assigneeIds,
        urgency: form.urgency,
        platform: form.platform,
        title: form.title,
        description: form.description,
        ...(form.sourceRequest ? { sourceRequest: form.sourceRequest } : {}),
      });
      toast.success(form.assigneeIds.length > 1 ? `Work assigned to ${form.assigneeIds.length} people` : 'Work assigned successfully');
      onSaved?.();
    } catch (err) {
      toast.error(err.response?.data?.message || 'Assignment failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <Modal open onClose={onClose} title="Work Allocation" size="lg">
      <div className="space-y-4">
        {/* The queue this screen exists for: everything the Admin or super admin
            approved, waiting to be handed to someone. */}
        <div>
          <div className="mb-1.5 flex items-end justify-between gap-3">
            <span className="text-sm font-medium text-slate-600 dark:text-slate-300">
              Approved requests waiting for allocation
              {approvedRequests.length > 0 && <span className="font-normal text-slate-400"> · {approvedRequests.length}</span>}
            </span>
            {picked && (
              <button type="button" onClick={() => pickRequest('')}
                className="text-xs font-semibold text-slate-400 hover:underline">
                Clear
              </button>
            )}
          </div>

          {approvedRequests.length === 0 ? (
            <p className="rounded-xl border border-dashed border-slate-200 p-4 text-sm text-slate-400 dark:border-slate-700">
              Nothing is waiting. A request appears here once it is approved on the College Requests page.
            </p>
          ) : (
            <div className="max-h-52 space-y-1 overflow-y-auto rounded-xl border border-slate-200 p-1.5 dark:border-slate-700">
              {approvedRequests.map((r) => {
                const active = form.sourceRequest === r._id;
                return (
                  <button key={r._id} type="button" onClick={() => pickRequest(active ? '' : r._id)}
                    className={cn('flex w-full items-start gap-3 rounded-lg px-2.5 py-2 text-left transition-colors',
                      active ? 'bg-brand-50 dark:bg-brand-500/10' : 'hover:bg-slate-50 dark:hover:bg-slate-800')}>
                    <ClipboardList className={cn('mt-0.5 h-4 w-4 shrink-0', active ? 'text-brand-600 dark:text-brand-400' : 'text-slate-400')} />
                    <span className="min-w-0">
                      <span className="block truncate text-sm font-semibold text-slate-700 dark:text-slate-200">{r.title}</span>
                      <span className="block truncate text-xs text-slate-400">
                        {r.organization?.name || 'Unknown college'}
                        {r.raisedBy?.name ? ` · ${r.raisedBy.name}` : ''}
                        {r.priority && r.priority !== 'NORMAL' ? ` · ${r.priority.charAt(0)}${r.priority.slice(1).toLowerCase()}` : ''}
                      </span>
                    </span>
                  </button>
                );
              })}
            </div>
          )}
          <p className="mt-1.5 text-xs text-slate-400">
            Picking one carries its college, urgency and brief into the allocation. Leave it unpicked to hand out standalone work.
          </p>
        </div>

        {showOrgPicker ? (
          <Select label="Organization" value={form.organization} onChange={(e) => setForm({ ...form, organization: e.target.value, assigneeIds: [], sourceRequest: '' })}>
            <option value="">— Select organization —</option>
            {orgs.map((org) => <option key={org._id} value={org._id}>{org.name}</option>)}
          </Select>
        ) : (
          <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-600 dark:border-slate-700 dark:bg-slate-800/60 dark:text-slate-300">
            {picked
              ? <>This work is for <span className="font-semibold">{picked.organization?.name || 'the requesting college'}</span>.{form.assigneeType === 'DESIGNER' ? ' Designers are shown from all organizations.' : ''}</>
              : 'Designers are shown from all organizations.'}
          </div>
        )}

        <div>
          <span className="mb-1.5 block text-sm font-medium text-slate-600 dark:text-slate-300">Assign to</span>
          <div className="grid gap-3 sm:grid-cols-2">
            {ASSIGNEE_TYPES.map((type) => {
              const Icon = type.icon;
              const active = form.assigneeType === type.key;
              return (
                <button
                  key={type.key}
                  type="button"
                  onClick={() => setForm({ ...form, assigneeType: type.key, assigneeIds: [], platform: '' })}
                  className={cn(
                    'rounded-2xl border-2 p-4 text-left transition',
                    active ? 'border-brand-500 bg-brand-50/60 dark:bg-brand-500/10' : 'border-slate-200 hover:border-brand-300 dark:border-slate-700'
                  )}
                >
                  <Icon className={cn('h-5 w-5', active ? 'text-brand-600 dark:text-brand-400' : 'text-slate-400')} />
                  <p className="mt-2 text-sm font-bold text-slate-800 dark:text-white">{type.label}</p>
                  <p className="mt-0.5 text-xs text-slate-400">{type.hint}</p>
                </button>
              );
            })}
          </div>
        </div>

        {/* Designers work on creative output, so no channel applies. A social
            handler always publishes somewhere, so the platform is required and
            also narrows the list of handlers below. */}
        {form.assigneeType === 'SOCIAL_HANDLER' && (
          <div>
            <Select label="Platform" value={form.platform} onChange={(e) => setForm({ ...form, platform: e.target.value, assigneeIds: [] })}>
              <option value="">— Select the platform —</option>
              {PLATFORMS.map((platform) => <option key={platform} value={platform}>{platform}</option>)}
            </Select>
            <p className="mt-1.5 text-xs text-slate-400">
              Required for social handlers — only handlers mapped to this college and platform can be assigned.
            </p>
          </div>
        )}

        {/* Pick as many people from this organization as the work needs — each
            one gets their own copy of the assignment to track. */}
        <div>
          <div className="mb-1.5 flex items-end justify-between gap-3">
            <span className="text-sm font-medium text-slate-600 dark:text-slate-300">
              {form.assigneeType === 'SOCIAL_HANDLER' ? 'Social handlers' : 'Designers'}
              <span className="font-normal text-slate-400"> · pick one or more</span>
            </span>
            {candidates.length > 0 && (
              <button type="button"
                onClick={() => setForm((f) => ({
                  ...f,
                  assigneeIds: f.assigneeIds.length === candidates.length ? [] : candidates.map((c) => c._id),
                }))}
                className="text-xs font-semibold text-brand-600 hover:underline dark:text-brand-400">
                {form.assigneeIds.length === candidates.length ? 'Clear all' : 'Select all'}
              </button>
            )}
          </div>

          {needsOrgFirst ? (
            <p className="rounded-xl border border-dashed border-slate-200 p-4 text-sm text-slate-400 dark:border-slate-700">
              Choose an organization first to see who you can assign.
            </p>
          ) : candidates.length === 0 ? (
            <p className="rounded-xl border border-dashed border-slate-200 p-4 text-sm text-slate-400 dark:border-slate-700">
              {form.assigneeType === 'SOCIAL_HANDLER'
                ? 'No social handlers matched this organization/platform yet.'
                : isPrivileged ? 'No designers found.' : 'No designers belong to this organization yet.'}
            </p>
          ) : (
            <div className="max-h-56 space-y-1 overflow-y-auto rounded-xl border border-slate-200 p-1.5 dark:border-slate-700">
              {candidates.map((user) => {
                const checked = form.assigneeIds.includes(user._id);
                return (
                  <label key={user._id}
                    className={cn('flex cursor-pointer items-center gap-3 rounded-lg px-2.5 py-2 transition-colors',
                      checked ? 'bg-brand-50 dark:bg-brand-500/10' : 'hover:bg-slate-50 dark:hover:bg-slate-800')}>
                    <input
                      type="checkbox" checked={checked}
                      onChange={() => setForm((f) => ({
                        ...f,
                        assigneeIds: checked
                          ? f.assigneeIds.filter((id) => id !== user._id)
                          : [...f.assigneeIds, user._id],
                      }))}
                      className="h-4 w-4 shrink-0 cursor-pointer accent-brand-600"
                    />
                    <span className="min-w-0">
                      <span className="block truncate text-sm font-semibold text-slate-700 dark:text-slate-200">{user.name}</span>
                      <span className="block truncate text-xs text-slate-400">
                        {user.jobTitle || user.email}
                        {user.organization?.name ? ` · ${user.organization.name}` : ''}
                      </span>
                    </span>
                  </label>
                );
              })}
            </div>
          )}

          {form.assigneeIds.length > 0 && (
            <p className="mt-1.5 text-xs text-slate-400">
              {form.assigneeIds.length} {form.assigneeIds.length === 1 ? 'person' : 'people'} selected — each gets their own assignment to acknowledge and complete.
            </p>
          )}
        </div>

        <div>
          <span className="mb-1.5 block text-sm font-medium text-slate-600 dark:text-slate-300">Urgency</span>
          <div className="flex flex-wrap gap-2">
            {URGENCIES.map((u) => (
              <button key={u.key} type="button" onClick={() => setForm({ ...form, urgency: u.key })}
                className={cn('rounded-xl border-2 px-3 py-2 text-sm font-semibold transition',
                  form.urgency === u.key ? u.cls + ' bg-slate-50 dark:bg-slate-800' : 'border-slate-200 text-slate-500 hover:bg-slate-50 dark:border-slate-700 dark:hover:bg-slate-800')}>
                {u.label}
              </button>
            ))}
          </div>
          <p className="mt-1.5 text-xs text-slate-400">Shown to the assignee so they know what to do first.</p>
        </div>

        <Input label="Work title" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder="e.g. Create placement story carousel" />

        {picked && (
          <p className="-mt-2 text-xs text-slate-400">
            Linked to “{picked.title}” — the request closes once the work is picked up.
          </p>
        )}

        <textarea
          className="input-base min-h-[90px]"
          placeholder="Add a short brief or instructions for the person receiving the work"
          value={form.description}
          onChange={(e) => setForm({ ...form, description: e.target.value })}
        />

        <div className="mt-6 flex items-center justify-end gap-2">
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button loading={loading} onClick={submit}><BriefcaseBusiness className="h-4 w-4" /> Allocate Work</Button>
        </div>
      </div>
    </Modal>
  );
}