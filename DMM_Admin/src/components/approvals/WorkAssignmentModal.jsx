import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { BriefcaseBusiness, Palette, Send } from 'lucide-react';
import { organizationApi, userApi, workAssignmentApi, institutionRequestApi } from '../../api/endpoints.js';
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
  const [form, setForm] = useState({ organization: '', assigneeType: 'DESIGNER', assigneeIds: [], platform: '', urgency: 'NORMAL', title: '', description: '', sourceRequest: '' });
  const [loading, setLoading] = useState(false);

  const { data: orgData } = useQuery({ queryKey: ['work-assign-orgs'], queryFn: () => organizationApi.list() });
  const orgs = orgData?.organizations || [];

  // IN_REVIEW requests for the chosen org — available as an optional link.
  const { data: reqData } = useQuery({
    queryKey: ['work-assign-inreview', form.organization],
    queryFn: () => institutionRequestApi.list({ organizationId: form.organization, status: 'IN_REVIEW' }),
    enabled: !!form.organization,
  });
  const inReviewRequests = reqData?.requests || [];

  const { data: usersData } = useQuery({
    queryKey: ['work-assign-users', form.organization, form.assigneeType],
    queryFn: () => userApi.list(
      form.assigneeType === 'SOCIAL_HANDLER' || !form.organization
        ? { role: 'USER' }
        : { role: 'USER', organization: form.organization }
    ),
  });
  const users = usersData?.users || [];

  const candidates = useMemo(() => {
    let list = users.filter((u) => u.role === 'USER' && u.userType === form.assigneeType);
    if (form.assigneeType !== 'SOCIAL_HANDLER' && form.organization) {
      list = list.filter((u) => String(u.organization?._id || u.organization || '') === String(form.organization));
    }
    if (form.assigneeType === 'SOCIAL_HANDLER' && form.organization) {
      list = list.filter((u) => (u.handles || []).some((h) => String(h.organization?._id || h.organization) === String(form.organization)
        && (!form.platform || (h.platforms || []).includes(form.platform))));
    }
    return list;
  }, [users, form.organization, form.assigneeType, form.platform]);

  const submit = async () => {
    if (!form.organization) { toast.error('Please choose an organization'); return; }
    if (!form.assigneeIds.length) { toast.error('Please choose at least one assignee'); return; }
    if (!form.title.trim()) { toast.error('Please add a title'); return; }
    if (form.assigneeType === 'SOCIAL_HANDLER' && !form.platform) { toast.error('Choose a platform for social-handler work'); return; }

    setLoading(true);
    try {
      await workAssignmentApi.create({
        organization: form.organization,
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
    <Modal open onClose={onClose} title="Assign Work" size="lg">
      <div className="space-y-4">
        <Select label="Organization" value={form.organization} onChange={(e) => setForm({ ...form, organization: e.target.value, assigneeIds: [], sourceRequest: '' })}>
          <option value="">— Select organization —</option>
          {orgs.map((org) => <option key={org._id} value={org._id}>{org.name}</option>)}
        </Select>

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

          {!form.organization ? (
            <p className="rounded-xl border border-dashed border-slate-200 p-4 text-sm text-slate-400 dark:border-slate-700">
              Choose an organization first to see who you can assign.
            </p>
          ) : candidates.length === 0 ? (
            <p className="rounded-xl border border-dashed border-slate-200 p-4 text-sm text-slate-400 dark:border-slate-700">
              {form.assigneeType === 'SOCIAL_HANDLER'
                ? 'No social handlers matched this organization/platform yet.'
                : 'No designers belong to this organization yet.'}
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

        {/* Optional: link to an IN_REVIEW college request. When the assignee
            acknowledges this work, that request is auto-moved to APPROVED. */}
        {inReviewRequests.length > 0 && (
          <Select
            label="Linked college request (optional)"
            value={form.sourceRequest}
            onChange={(e) => setForm({ ...form, sourceRequest: e.target.value })}
          >
            <option value="">— None —</option>
            {inReviewRequests.map((r) => (
              <option key={r._id} value={r._id}>{r.title}</option>
            ))}
          </Select>
        )}
        {form.sourceRequest && (
          <p className="-mt-2 text-xs text-slate-400">
            When the assignee accepts this work the linked request will automatically be marked approved.
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
          <Button loading={loading} onClick={submit}><BriefcaseBusiness className="h-4 w-4" /> Assign Work</Button>
        </div>
      </div>
    </Modal>
  );
}