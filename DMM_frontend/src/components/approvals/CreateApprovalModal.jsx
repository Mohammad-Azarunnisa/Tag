import { useEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { Check, Plus, ChevronLeft, ChevronRight, Palette, Sparkles, Loader2, Share2, PackageCheck, BriefcaseBusiness, Building2 } from 'lucide-react';
import { approvalApi, organizationApi, aiApi, workAssignmentApi, workflowApi } from '../../api/endpoints.js';
import { useAuthStore } from '../../store/authStore.js';
import { Modal } from '../ui/Modal.jsx';
import { Button } from '../ui/Button.jsx';
import { Input, Select, Avatar } from '../ui/primitives.jsx';
import FileDropzone from '../ui/FileDropzone.jsx';
import { UPLOAD_ACCEPT } from '../../lib/uploads.js';
import { cn } from '../../lib/utils.js';

const PLATFORMS = ['LinkedIn', 'Instagram', 'YouTube', 'Facebook'];

// Channel badge for the per-channel copy headings, so the blocks are told apart
// at a glance rather than by reading each label.
const PLATFORM_TAG = {
  LinkedIn: 'bg-sky-100 text-sky-700 dark:bg-sky-500/15 dark:text-sky-300',
  Instagram: 'bg-pink-100 text-pink-700 dark:bg-pink-500/15 dark:text-pink-300',
  YouTube: 'bg-rose-100 text-rose-700 dark:bg-rose-500/15 dark:text-rose-300',
  Facebook: 'bg-blue-100 text-blue-700 dark:bg-blue-500/15 dark:text-blue-300',
};
// Common social aspect ratios, with a hint of where each is used.
const RATIOS = [
  { value: '1:1', label: '1:1 — Square (feed)' },
  { value: '4:5', label: '4:5 — Portrait (feed)' },
  { value: '9:16', label: '9:16 — Story / Reel / Short' },
  { value: '16:9', label: '16:9 — Landscape (YouTube)' },
  { value: '1.91:1', label: '1.91:1 — Link / landscape' },
];

// Shown against each linkable task so it is obvious which is which. Submitting
// against OPEN work claims it, so there is nothing to do beforehand — the label
// just says it has not been picked up yet.
const WORK_STATE = {
  OPEN: 'not started',
  ACKNOWLEDGED: 'in progress',
  SUBMITTED: 'awaiting approval',
};

export default function CreateApprovalModal({
  onClose, onSaved, defaultType = 'POST', sourceDesignId = '',
  // Arriving from "Send for approval" on a workflow item: the college already said
  // what it wants, so the title comes in filled and the submission is tied back to
  // that request, which moves it on to admin review.
  workflowItemId = '', defaultTitle = '',
}) {
  const { user } = useAuthStore();
  const isCoordinator = user?.role === 'USER' && user?.userType === 'COORDINATOR';
  const isPrincipal = user?.role === 'CEO';
  const ownOrgId = user?.organization?._id || user?.organization || '';
  // A designer delivers artwork, so the post copy (caption / description /
  // hashtags) isn't theirs to write — whoever publishes it does that.
  const isDesignerUser = user?.role === 'USER' && user?.userType === 'DESIGNER';
  // Coordinators AND principals raise DESIGN briefs for someone else to make.
  // (A legacy ?compose flow still forces POST via sourceDesignId.)
  const briefMode = (isCoordinator || isPrincipal) && !sourceDesignId;
  // A designer submits a finished design of their own. That is a DESIGN
  // approval too — it belongs in the Design Approvals pipeline, not Post
  // Approvals — but there is no designer to pick, because they are the designer.
  const ownDesignMode = isDesignerUser && !sourceDesignId;
  // A social handler writing the post for a workflow item hands it in here.
  const isHandlerUser = user?.role === 'USER' && user?.userType === 'SOCIAL_HANDLER';
  // Everyone else raises standalone ready-to-publish POSTs.
  const type = briefMode || ownDesignMode ? 'DESIGN' : 'POST';
  const noPostCopy = briefMode || isDesignerUser;
  // A brief has no channel at all. A designer MAY name one but is never forced
  // to; everyone else must pick at least one.
  const showPlatforms = !briefMode;
  // A designer's work isn't always tied to a college or a channel yet, so
  // neither is forced on them. Everyone else must still say who it's for.
  const platformsRequired = !briefMode && !isDesignerUser;
  // The college is always required — a request has to belong somewhere.
  const organizationRequired = true;

  const STEPS = noPostCopy
    ? [{ n: 1, label: 'Details' }, { n: 2, label: briefMode ? 'Reference' : 'Media' }]
    : [{ n: 1, label: 'Details' }, { n: 2, label: 'Content' }, { n: 3, label: 'Media' }];
  const lastStep = noPostCopy ? 2 : 3;

  const [step, setStep] = useState(1);
  const [form, setForm] = useState({
    // perPlatform holds a { caption, description } per channel, used only when
    // more than one is chosen. Keyed by channel so unticking and re-ticking one
    // does not lose what was already written for it.
    title: defaultTitle, platforms: [], caption: '', description: '', hashtags: '', perPlatform: {},
    aspectRatios: [], organization: ownOrgId, designer: '', deliveryType: 'DIGITAL',
    // 'wf:<id>' for a workflow item, 'wa:<id>' for a directly assigned task.
    linkedWork: workflowItemId ? `wf:${workflowItemId}` : '',
  });
  const [images, setImages] = useState([]);
  const [loading, setLoading] = useState(false);
  const [drafting, setDrafting] = useState(false);

  // One channel keeps the single description/caption pair; two or more get one
  // pair each, because the same post rarely reads the same everywhere.
  const multiChannel = !noPostCopy && form.platforms.length > 1;
  const setPerPlatform = (platform, field, value) => setForm((f) => ({
    ...f,
    perPlatform: { ...f.perPlatform, [platform]: { ...f.perPlatform[platform], [field]: value } },
  }));
  const [tagoNote, setTagoNote] = useState('');

  // Any organization can be the target of an approval request (shared workspace).
  const { data: orgData } = useQuery({ queryKey: ['org-options'], queryFn: organizationApi.options });
  const orgs = orgData?.organizations || [];

  // Only the channels the chosen college actually runs. Offering the full list
  // invited posts for a platform the college has no presence on — and the handler
  // then had nowhere to publish it. The server sends each college's own set with
  // the picker options, so no extra call is needed.
  const selectedOrg = orgs.find((o) => String(o._id) === String(form.organization));
  const orgPlatforms = selectedOrg?.platforms?.length ? selectedOrg.platforms : null;
  const platformChoices = (orgPlatforms || PLATFORMS).filter((p) => PLATFORMS.includes(p));

  // Switching college can strand a channel the new one does not run, which would
  // otherwise be submitted invisibly.
  useEffect(() => {
    if (!orgPlatforms) return;
    setForm((f) => {
      const kept = f.platforms.filter((p) => platformChoices.includes(p));
      return kept.length === f.platforms.length ? f : { ...f, platforms: kept };
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [form.organization, orgData]);

  // Designers the coordinator can hand the brief to.
  const { data: designerData } = useQuery({ queryKey: ['designers'], queryFn: approvalApi.designers, enabled: briefMode });
  const designers = designerData?.designers || [];

  // Everything still open to this person, so they can say which task the
  // submission is for. Only completed work is left out — that one is finished
  // and signed off, so nothing new belongs against it. Asking the server for
  // ACKNOWLEDGED alone used to hide work they had already submitted once, which
  // is exactly what a re-submission needs to point at.
  const { data: workData } = useQuery({
    queryKey: ['my-linkable-work'],
    queryFn: () => workAssignmentApi.list(),
  });
  const myWork = (workData?.assignments || []).filter((w) => w.status !== 'DONE');

  // Since the workflow boards landed, "my assigned work" is two things: the tasks
  // handed out directly, and the design work picked up in Designs to be Done. Both
  // belong in this picker or the list is only half the answer.
  const { data: workflowData } = useQuery({
    queryKey: ['my-linkable-workflow'],
    queryFn: () => workflowApi.list({ mine: 1 }),
    enabled: ownDesignMode || isHandlerUser,
  });
  // Only what this form can actually attach itself to: work that is mine, still
  // waiting on me, and not already handed in. A designer hands in the artwork; a
  // handler hands in the copy. Offering anything else would put options in the
  // list that the server then refuses.
  const myWorkflow = (workflowData?.items || []).filter((i) => (ownDesignMode
    ? i.myRole === 'DESIGNER' && i.workflowStage === 'DESIGN_IN_PROGRESS' && !i.designApproval
    : i.myRole === 'SOCIAL_HANDLER' && i.workflowStage === 'POST_IN_PROGRESS' && !i.postApproval));

  // One picker, two sources, so the value has to say which it came from.
  const linkedWorkOptions = [
    ...myWorkflow.map((i) => ({
      value: `wf:${i._id}`,
      group: 'From the workflow',
      label: [i.title, i.organization?.name, i.workCategory].filter(Boolean).join(' · '),
    })),
    ...myWork.map((w) => ({
      value: `wa:${w._id}`,
      group: 'Assigned to me',
      label: [w.title, w.organization?.name, w.platform, WORK_STATE[w.status]].filter(Boolean).join(' · '),
    })),
  ];
  const groups = [...new Set(linkedWorkOptions.map((o) => o.group))];

  // A handler handing in post content inherits the designer's artwork server-side,
  // so demanding an upload here would make them re-add the very files that are
  // already coming across.
  const pickedWorkflow = form.linkedWork.startsWith('wf:')
    ? myWorkflow.find((i) => `wf:${i._id}` === form.linkedWork)
    : null;
  const inheritsDesignMedia = !!pickedWorkflow?.designApproval && pickedWorkflow.myRole === 'SOCIAL_HANDLER';

  /**
   * Linking the coordinator's request carries its title across.
   *
   * The college named the thing it asked for; the approval the admin reviews
   * should carry that same name, or the two are the same piece of work under two
   * titles. Filling it from the selection means the designer never retypes it,
   * whether they arrived from "Send for approval" or picked the request here.
   *
   * `autoTitle` remembers what was filled in, so switching to another request
   * updates the title, while anything the designer typed themselves survives.
   */
  const autoTitle = useRef(defaultTitle);
  useEffect(() => {
    if (!form.linkedWork.startsWith('wf:')) return;
    const picked = myWorkflow.find((i) => `wf:${i._id}` === form.linkedWork);
    if (!picked) return;

    // The pages come across whatever the title says. These used to share one
    // early return, so editing the title before the request loaded dropped the
    // college's page selection on the floor — the handler then wrote copy for
    // whichever single channel they re-picked, and the rest went out with none.
    const pages = (picked.postPlatforms || []).filter((p) => PLATFORMS.includes(p));
    // Decided out here, not inside the updater: React invokes updaters more than
    // once, and moving the ref on from within one made the second pass read the
    // new value, judge the title "touched", and keep the previous request's name.
    const untouched = !form.title.trim() || form.title === autoTitle.current;
    if (untouched) autoTitle.current = picked.title;

    setForm((f) => ({
      ...f,
      ...(untouched ? { title: picked.title } : {}),
      // The coordinator already said which pages this goes out on, so the handler
      // does not choose again. Only channels this form knows about can be shown;
      // anything else stays on the request itself, where the handler can read it.
      platforms: f.platforms.length ? f.platforms : pages,
    }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [form.linkedWork, workflowData]);

  // A workflow item handed in through the URL may turn out not to be linkable —
  // already submitted, no longer this person's, or this form is not the design
  // form at all. Once the real list is in, drop a selection that is not on it, so
  // nothing is submitted that the picker never showed.
  useEffect(() => {
    if (!form.linkedWork || !form.linkedWork.startsWith('wf:')) return;
    // Wait for the list whenever it is being fetched at all — clearing the
    // selection before it arrives would throw away a perfectly good hand-in.
    if ((ownDesignMode || isHandlerUser) && !workflowData) return;
    if (!linkedWorkOptions.some((o) => o.value === form.linkedWork)) {
      setForm((f) => (f.linkedWork === form.linkedWork ? { ...f, linkedWork: '' } : f));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workflowData, ownDesignMode, form.linkedWork]);

  // Only offer AI drafting when the backend has an AI key configured.
  const { data: aiStatus } = useQuery({ queryKey: ['ai-status'], queryFn: aiApi.status, staleTime: 5 * 60 * 1000 });
  const aiReady = !!aiStatus?.configured;

  /**
   * Draft the whole post with Tago: description, caption and hashtags.
   *
   * `platform` names which channel to write for — on a multi-channel post each
   * block drafts for its own channel, because copy that reads well on LinkedIn
   * is the wrong shape for Instagram. Whatever is already typed goes up as the
   * brief, so this improves a draft rather than discarding it.
   */
  const draftWithTago = async (platform = form.platforms[0]) => {
    const perChannel = !!platform && multiChannel;
    const current = perChannel
      ? (form.perPlatform[platform] || {})
      : { description: form.description, caption: form.caption };

    if (!form.title.trim() && !String(current.description || '').trim() && !String(current.caption || '').trim()) {
      toast.error('Add a title or a short brief first so Tago knows the topic'); return;
    }
    setDrafting(platform || true);
    try {
      const r = await aiApi.draft({
        platform, organization: form.organization,
        title: form.title, brief: current.description, caption: current.caption,
      });
      if (perChannel) {
        setForm((f) => ({
          ...f,
          perPlatform: {
            ...f.perPlatform,
            [platform]: {
              description: r.description || f.perPlatform[platform]?.description || '',
              caption: r.caption || f.perPlatform[platform]?.caption || '',
            },
          },
          hashtags: r.hashtags || f.hashtags,
        }));
      } else {
        setForm((f) => ({
          ...f,
          description: r.description || f.description,
          caption: r.caption || f.caption,
          hashtags: r.hashtags || f.hashtags,
        }));
      }
      setTagoNote(r.note || '');
      toast.success('Tago drafted your copy — review and edit as you like');
    } catch (err) {
      toast.error(err.response?.data?.message || 'Could not draft right now — try again in a moment');
    } finally { setDrafting(false); }
  };

  // Legacy compose-from-design: prefill org/platform/title from the source design.
  const { data: designData } = useQuery({
    queryKey: ['approval', sourceDesignId],
    queryFn: () => approvalApi.get(sourceDesignId),
    enabled: !!sourceDesignId,
  });
  const design = designData?.request;
  useEffect(() => {
    if (!design) return;
    setForm((f) => ({
      ...f,
      organization: design.organization?._id || design.organization || f.organization,
      platforms: (design.platforms?.length ? design.platforms : (design.platform ? [design.platform] : f.platforms)),
      title: f.title || design.title || '',
      aspectRatios: (design.aspectRatios?.length ? design.aspectRatios : (design.aspectRatio ? [design.aspectRatio] : f.aspectRatios)),
    }));
  }, [design]);

  const next = () => {
    if (step === 1) {
      if (organizationRequired && !form.organization) { toast.error('Please choose the organization this is for'); return; }
      if (!form.title.trim()) { toast.error('Please give the request a title'); return; }
      if (platformsRequired && !form.platforms.length) { toast.error('Please pick at least one platform'); return; }
      if (briefMode && !form.designer) { toast.error('Please choose a designer to work on this brief'); return; }
    }
    setStep((s) => Math.min(s + 1, lastStep));
  };

  const submit = async () => {
    // A design brief may have optional reference media; a post needs its final
    // media — unless the design it is written around is coming across with it.
    if (!briefMode && images.length === 0 && !inheritsDesignMedia) {
      toast.error('Please add at least one file');
      return;
    }
    setLoading(true);
    try {
      const fd = new FormData();
      fd.append('title', form.title);
      fd.append('type', type);
      form.platforms.forEach((p) => fd.append('platforms', p));
      fd.append('organization', form.organization);
      fd.append('description', form.description);
      // Artwork carries no post copy — the publisher writes that on the post.
      if (!noPostCopy) {
        fd.append('caption', form.caption);
        fd.append('hashtags', form.hashtags);
      }
      // Several channels: send the pair written for each. The server keeps only
      // the channels actually chosen and mirrors the primary one into
      // caption/description, so single-caption readers are unaffected.
      if (multiChannel) {
        fd.append('platformContent', JSON.stringify(form.platforms.map((p) => ({
          platform: p,
          caption: form.perPlatform[p]?.caption || '',
          description: form.perPlatform[p]?.description || '',
        }))));
      }
      form.aspectRatios.forEach((r) => fd.append('aspectRatios', r));
      if (briefMode) {
        fd.append('designer', form.designer);
        fd.append('deliveryMode', form.deliveryType);
      }
      // The picker holds either kind; each goes up under its own name.
      if (form.linkedWork.startsWith('wf:')) fd.append('workflowItem', form.linkedWork.slice(3));
      else if (form.linkedWork.startsWith('wa:')) fd.append('workAssignment', form.linkedWork.slice(3));
      if (sourceDesignId) fd.append('sourceDesign', sourceDesignId);
      images.forEach((img) => fd.append('images', img));
      await approvalApi.create(fd);
      const chosen = designers.find((d) => d._id === form.designer);
      toast.success(
        briefMode ? `Design brief sent to ${chosen?.name || 'the designer'}`
          : ownDesignMode ? 'Design approval request submitted'
            : 'Post approval request submitted'
      );
      // Hand back the pipeline this landed in, so the list can open on the tab
      // that actually holds the new request.
      onSaved(type);
    } catch (err) {
      toast.error(err.response?.data?.message || 'Submission failed');
    } finally { setLoading(false); }
  };

  const title = briefMode
    ? 'Raise a design brief'
    : ownDesignMode
      ? 'Create Design Approval Request'
      : 'Create Post Approval Request';

  return (
    <Modal open onClose={onClose} title={title} size="lg">
      {briefMode && (
        <div className="mb-5 flex items-start gap-3 rounded-xl border border-violet-200 bg-violet-50/70 p-3.5 dark:border-violet-500/30 dark:bg-violet-500/10">
          <Palette className="mt-0.5 h-4 w-4 shrink-0 text-violet-500" />
          <p className="text-sm text-slate-600 dark:text-slate-300">
            Describe what you need and pick a designer. They’ll create it and submit for approval; once approved it’s
            either posted by a social handler or delivered back to you.
          </p>
        </div>
      )}

      {/* Stepper */}
      <div className="mb-6 flex items-center">
        {STEPS.map((s, i) => {
          const done = step > s.n;
          const current = step === s.n;
          return (
            <div key={s.n} className={cn('flex items-center', i < STEPS.length - 1 && 'flex-1')}>
              <div className="flex items-center gap-2">
                <span className={cn(
                  'flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-sm font-bold transition',
                  done && 'bg-emerald-500 text-white',
                  current && 'bg-brand-600 text-white',
                  !done && !current && 'border-2 border-slate-200 dark:border-slate-700 text-slate-400'
                )}>
                  {done ? <Check className="h-4 w-4" /> : s.n}
                </span>
                <span className={cn('text-sm font-semibold', current ? 'text-slate-800 dark:text-white' : 'text-slate-400')}>{s.label}</span>
              </div>
              {i < STEPS.length - 1 && (
                <div className={cn('mx-3 h-0.5 flex-1 rounded-full', done ? 'bg-emerald-500' : 'bg-slate-200 dark:bg-slate-700')} />
              )}
            </div>
          );
        })}
      </div>

      {/* Step 1 — Details */}
      {step === 1 && (
        <div className="space-y-4">
          {/* A coordinator raises requests for their own college; the server
              stamps it either way, so the choice is not offered. */}
          {isCoordinator ? (
            <div>
              <span className="mb-1.5 block text-sm font-medium text-slate-600 dark:text-slate-300">Organization</span>
              <p className="flex h-11 items-center gap-2 rounded-xl border border-slate-200 px-3 text-sm text-slate-600 dark:border-slate-700 dark:text-slate-300">
                <Building2 className="h-4 w-4 shrink-0 text-slate-400" />
                <span className="truncate">{user?.organization?.name || 'Your college'}</span>
              </p>
            </div>
          ) : (
            <Select
              label={organizationRequired ? 'Organization (who this is for)' : 'Organization (optional)'}
              value={form.organization}
              onChange={(e) => setForm({ ...form, organization: e.target.value })}
            >
              <option value="">{organizationRequired ? '— Select organization —' : '— Not tied to a college —'}</option>
              {orgs.map((o) => <option key={o._id} value={o._id}>{o.name}</option>)}
            </Select>
          )}
          <Input label="Title" required value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder="e.g. Placement Success Story" />

          {/* The same post can go out on several channels — pick every one it's
              for. A design brief has no channel; whoever publishes it picks one. */}
          {showPlatforms && (
          <div>
            <span className="mb-1.5 block text-sm font-medium text-slate-600 dark:text-slate-300">
              Social media platforms{' '}
              <span className="font-normal text-slate-400">
                {platformsRequired ? '· pick one or more' : '· optional — leave blank if the channel isn’t decided yet'}
              </span>
            </span>
            <div className="flex flex-wrap gap-2">
              {platformChoices.map((p) => {
                const on = form.platforms.includes(p);
                return (
                  <button
                    key={p} type="button" aria-pressed={on}
                    onClick={() => setForm((f) => ({
                      ...f,
                      platforms: f.platforms.includes(p)
                        ? f.platforms.filter((x) => x !== p)
                        : [...f.platforms, p],
                    }))}
                    className={cn('inline-flex items-center gap-1.5 rounded-xl border px-3 py-2 text-sm font-semibold transition',
                      on
                        ? 'border-brand-500 bg-brand-50 text-brand-700 dark:border-brand-500/60 dark:bg-brand-500/10 dark:text-brand-300'
                        : 'border-slate-200 text-slate-600 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800')}
                  >
                    {on ? <Check className="h-4 w-4" /> : <Plus className="h-4 w-4 opacity-50" />}
                    {p}
                  </button>
                );
              })}
            </div>
            {platformChoices.length === 0 && (
              <p className="mt-1.5 rounded-xl border border-amber-200 bg-amber-50/70 p-2.5 text-xs text-amber-800 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-300">
                This college has no social pages set up yet — ask the admin to add them before raising a post for it.
              </p>
            )}
            {form.platforms.length > 1 && (
              <p className="mt-1.5 text-xs text-slate-400">
                One request for {form.platforms.length} channels — <span className="font-semibold">{form.platforms[0]}</span> counts as the primary for analytics and goals.
              </p>
            )}
          </div>
          )}

          {/* Optional: tie this submission to work already on your plate, so the
              reviewer knows which piece they are checking — and so signing it off
              moves that work on rather than leaving it open behind this request. */}
          {linkedWorkOptions.length > 0 && (
            <div>
              <Select
                label="My assigned work (optional)"
                value={form.linkedWork}
                onChange={(e) => setForm({ ...form, linkedWork: e.target.value })}
              >
                <option value="">— Not linked to assigned work —</option>
                {groups.map((g) => (
                  <optgroup key={g} label={g}>
                    {linkedWorkOptions.filter((o) => o.group === g).map((o) => (
                      <option key={o.value} value={o.value}>{o.label}</option>
                    ))}
                  </optgroup>
                ))}
              </Select>
              <p className="mt-1.5 flex items-start gap-1.5 text-xs text-slate-400">
                <BriefcaseBusiness className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                {form.linkedWork.startsWith('wf:')
                  ? 'This goes in as the design for that request — it moves on to the Admin for approval.'
                  : form.linkedWork
                    ? 'Approving this request will also mark that assigned work complete.'
                    : 'Link the work this is for and the reviewer sees exactly what to check it against.'}
              </p>
            </div>
          )}

          {briefMode && (
            <>
              <Select label="Assign to designer" value={form.designer} onChange={(e) => setForm({ ...form, designer: e.target.value })}>
                <option value="">— Choose a designer —</option>
                {designers.map((d) => <option key={d._id} value={d._id}>{d.name}{d.organization?.name ? ` · ${d.organization.name}` : ''}</option>)}
              </Select>
              {form.designer && (() => {
                const d = designers.find((x) => x._id === form.designer);
                return d ? (
                  <div className="flex items-center gap-3 rounded-xl border border-slate-200 p-3 dark:border-slate-700">
                    <Avatar src={d.avatar} name={d.name} size="sm" />
                    <div className="min-w-0">
                      <p className="truncate text-sm font-semibold text-slate-800 dark:text-white">{d.name}</p>
                      {d.skills?.length > 0 && <p className="truncate text-xs text-slate-400">{d.skills.slice(0, 4).join(' · ')}</p>}
                    </div>
                  </div>
                ) : null;
              })()}

              {/* Delivery type: Digital (post) vs Print (deliver a copy) */}
              <div>
                <span className="mb-1.5 block text-sm font-medium text-slate-600 dark:text-slate-300">Delivery type</span>
                <div className="grid gap-3 sm:grid-cols-2">
                  {[
                    { key: 'DIGITAL', icon: Share2, title: 'Digital', desc: 'Post to social channels after approval.' },
                    { key: 'PRINT', icon: PackageCheck, title: 'Print', desc: 'Delivered back to you to print / keep a copy.' },
                  ].map((o) => (
                    <button key={o.key} type="button" onClick={() => setForm({ ...form, deliveryType: o.key })}
                      className={cn('rounded-2xl border-2 p-4 text-left transition',
                        form.deliveryType === o.key ? 'border-brand-500 bg-brand-50/60 dark:bg-brand-500/10' : 'border-slate-200 hover:border-brand-300 dark:border-slate-700')}>
                      <o.icon className={cn('h-5 w-5', form.deliveryType === o.key ? 'text-brand-600 dark:text-brand-400' : 'text-slate-400')} />
                      <p className="mt-2 text-sm font-bold text-slate-800 dark:text-white">{o.title}</p>
                      <p className="mt-0.5 text-xs text-slate-400">{o.desc}</p>
                    </button>
                  ))}
                </div>
              </div>
            </>
          )}

          {/* No Content step in these flows, so the instructions live here. */}
          {noPostCopy && (
            <label className="block">
              <span className="mb-1.5 block text-sm font-medium text-slate-600 dark:text-slate-300">
                {briefMode ? 'Brief — what should the design show?' : 'Notes for the approver'}
                <span className="font-normal text-slate-400"> · optional</span>
              </span>
              <textarea
                className="input-base min-h-[90px]"
                placeholder={briefMode
                  ? 'Any text, colours, references, dos & don’ts…'
                  : 'Anything the approver should know about this submission'}
                value={form.description}
                onChange={(e) => setForm({ ...form, description: e.target.value })}
              />
            </label>
          )}

          {/* Sizes needed — one piece of work is often wanted in several. */}
          <div>
            <span className="mb-1.5 block text-sm font-medium text-slate-600 dark:text-slate-300">
              Image / video ratio <span className="font-normal text-slate-400">· pick one or more</span>
            </span>
            <div className="flex flex-wrap gap-2">
              {RATIOS.map((r) => {
                const on = form.aspectRatios.includes(r.value);
                return (
                  <button key={r.value} type="button" aria-pressed={on}
                    onClick={() => setForm((f) => ({
                      ...f,
                      aspectRatios: on ? f.aspectRatios.filter((x) => x !== r.value) : [...f.aspectRatios, r.value],
                    }))}
                    className={cn('inline-flex items-center gap-1.5 rounded-xl border px-3 py-2 text-sm font-semibold transition',
                      on
                        ? 'border-brand-500 bg-brand-50 text-brand-700 dark:border-brand-500/60 dark:bg-brand-500/10 dark:text-brand-300'
                        : 'border-slate-200 text-slate-600 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800')}>
                    {on ? <Check className="h-4 w-4" /> : <Plus className="h-4 w-4 opacity-50" />}
                    {r.label}
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {/* Step 2 — Content / Brief */}
      {!noPostCopy && step === 2 && (
        <div className="space-y-4">
          {aiReady && (
            <div className="rounded-2xl border border-brand-200/70 bg-gradient-to-br from-brand-50 to-white p-3.5 dark:border-brand-500/25 dark:from-brand-500/10 dark:to-transparent">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-start gap-2.5">
                  <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-brand-500 to-amber-500 text-white shadow-sm">
                    <Sparkles className="h-4 w-4" />
                  </span>
                  <div>
                    <p className="text-sm font-bold text-slate-800 dark:text-white">Let Tago write it for you</p>
                    <p className="text-xs text-slate-500 dark:text-slate-400">
                      {multiChannel
                        ? `Description, caption & hashtags written for each channel — use the Tago button on any of the ${form.platforms.length} blocks below.`
                        : `On-brand ${form.platforms[0]} description, caption & hashtags from your title${form.description.trim() ? ' & brief' : ''}.`}
                    </p>
                  </div>
                </div>
                {/* On a multi-channel post the drafting happens per channel, on
                    each block, so there is nothing sensible for one button here
                    to write. */}
                {!multiChannel && (
                  <button
                    type="button" onClick={() => draftWithTago()} disabled={!!drafting}
                    className={cn('inline-flex items-center gap-1.5 rounded-full px-4 py-2 text-sm font-semibold text-white shadow-sm transition',
                      'bg-gradient-to-r from-brand-600 to-amber-500 hover:brightness-105 disabled:cursor-not-allowed disabled:opacity-70')}
                  >
                    {drafting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
                    {drafting ? 'Tago is writing…' : form.caption.trim() ? 'Redraft with Tago' : 'Draft with Tago'}
                  </button>
                )}
              </div>
              {tagoNote && (
                <p className="mt-3 flex items-start gap-1.5 border-t border-brand-200/60 pt-2.5 text-xs text-slate-500 dark:border-brand-500/20 dark:text-slate-400">
                  <Sparkles className="mt-0.5 h-3 w-3 shrink-0 text-brand-500" />
                  <span><span className="font-semibold text-slate-600 dark:text-slate-300">Tago’s note:</span> {tagoNote}</span>
                </p>
              )}
            </div>
          )}
          {/* One channel: one description and caption, as before. Several: the
              same post rarely reads the same on all of them, so each gets its
              own pair under its own heading. */}
          {multiChannel ? (
            <div className="space-y-3">
              <p className="text-xs text-slate-500 dark:text-slate-400">
                You picked {form.platforms.length} channels — write the copy for each. {form.platforms[0]} is the
                primary, and its wording is what reports and analytics quote.
              </p>
              {form.platforms.map((p, i) => (
                <div key={p} className="rounded-2xl border border-slate-200 p-3 dark:border-slate-700">
                  <p className="mb-2 flex items-center gap-2 text-sm font-bold text-slate-700 dark:text-slate-200">
                    <span className={`inline-flex h-6 w-6 items-center justify-center rounded-lg text-[11px] font-extrabold ${PLATFORM_TAG[p] || 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300'}`}>
                      {p.slice(0, 2)}
                    </span>
                    {p}
                    {i === 0 && <span className="rounded-full bg-brand-50 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-brand-600 dark:bg-brand-500/10 dark:text-brand-300">Primary</span>}
                    {/* Drafts this channel's copy in this channel's voice. */}
                    {aiReady && (
                      <button
                        type="button" onClick={() => draftWithTago(p)} disabled={!!drafting}
                        title={`Let Tago write the ${p} description, caption and hashtags`}
                        className="ml-auto inline-flex items-center gap-1 rounded-full bg-gradient-to-r from-brand-600 to-amber-500 px-2.5 py-1 text-[11px] font-semibold text-white shadow-sm transition hover:brightness-105 disabled:cursor-not-allowed disabled:opacity-70"
                      >
                        {drafting === p ? <Loader2 className="h-3 w-3 animate-spin" /> : <Sparkles className="h-3 w-3" />}
                        {drafting === p ? 'Writing…' : 'Tago'}
                      </button>
                    )}
                  </p>
                  <textarea
                    className="input-base min-h-[80px]"
                    placeholder={`Description for ${p}`}
                    value={form.perPlatform[p]?.description || ''}
                    onChange={(e) => setPerPlatform(p, 'description', e.target.value)}
                  />
                  <textarea
                    className="input-base mt-2 min-h-[64px]"
                    placeholder={`Caption for ${p}`}
                    value={form.perPlatform[p]?.caption || ''}
                    onChange={(e) => setPerPlatform(p, 'caption', e.target.value)}
                  />
                </div>
              ))}
            </div>
          ) : (
            <>
              <textarea className="input-base min-h-[90px]" placeholder="Description" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
              <textarea className="input-base min-h-[70px]" placeholder="Caption" value={form.caption} onChange={(e) => setForm({ ...form, caption: e.target.value })} />
            </>
          )}
          <Input label="Hashtags (comma or space separated)" value={form.hashtags} onChange={(e) => setForm({ ...form, hashtags: e.target.value })} placeholder="college, placement, success" />
        </div>
      )}

      {/* Final step — Media (post) / Reference (brief) */}
      {step === lastStep && (
        <div>
          <span className="mb-1.5 block text-sm font-medium text-slate-600 dark:text-slate-300">
            {briefMode ? 'Reference material (optional) — logos, examples, raw photos' : 'Images & videos (drag & drop, multiple, reorderable)'}
          </span>
          {inheritsDesignMedia && (
            <p className="mb-3 flex items-start gap-2 rounded-xl border border-indigo-200 bg-indigo-50/70 p-3 text-sm text-indigo-900 dark:border-indigo-500/30 dark:bg-indigo-500/10 dark:text-indigo-200">
              <PackageCheck className="mt-0.5 h-4 w-4 shrink-0" />
              <span>
                The approved design is attached automatically — add files here only if this post
                needs something extra.
              </span>
            </p>
          )}
          <FileDropzone multiple reorderable accept={UPLOAD_ACCEPT} files={images} onChange={setImages}
            label={briefMode ? 'Drop any reference files here (optional)' : 'Drop images or videos here or click to browse'} />
        </div>
      )}

      <div className="mt-6 flex items-center justify-between gap-2">
        <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
        <div className="flex gap-2">
          {step > 1 && (
            <Button type="button" variant="secondary" onClick={() => setStep((s) => s - 1)}><ChevronLeft className="h-4 w-4" /> Back</Button>
          )}
          {step < lastStep ? (
            <Button type="button" onClick={next}>Next <ChevronRight className="h-4 w-4" /></Button>
          ) : (
            <Button type="button" loading={loading} onClick={submit}>{briefMode ? 'Send brief' : 'Submit Request'}</Button>
          )}
        </div>
      </div>
    </Modal>
  );
}
