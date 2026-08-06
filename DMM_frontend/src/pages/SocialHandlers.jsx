import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Navigate } from 'react-router-dom';
import { Share2, Mail, Phone, Users, ExternalLink, Linkedin, UserCheck, Copy } from 'lucide-react';
import toast from 'react-hot-toast';
import { libraryApi } from '../api/endpoints.js';
import { useAuthStore } from '../store/authStore.js';
import PageHeader from '../components/layout/PageHeader.jsx';
import { Card, Skeleton, EmptyState } from '../components/ui/primitives.jsx';
import { Modal } from '../components/ui/Modal.jsx';

export default function SocialHandlers() {
  const { user } = useAuthStore();
  const blocked = user && user.role !== 'CEO';
  const { data, isLoading } = useQuery({ queryKey: ['social-accounts'], queryFn: () => libraryApi.socialAccounts(), enabled: !blocked });
  const [contact, setContact] = useState(null);
  if (blocked) return <Navigate to="/dashboard" replace />;
  const accounts = data?.accounts || [];

  return (
    <div>
      <PageHeader title="Social Media Handlers" subtitle="Who manages each of your social platforms — click any name to see their contact details." />
      {isLoading ? (
        <div className="grid gap-4 lg:grid-cols-2">{Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-48" />)}</div>
      ) : accounts.length === 0 ? (
        <EmptyState icon={Share2} title="No accounts listed yet" description="Your admin hasn't added social media handler details for your organization." />
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          {accounts.map((a) => (
            <Card key={a._id} className="p-5">
              <div className="flex items-center gap-2">
                <span className="font-bold text-slate-800 dark:text-white">{a.platform}</span>
                {a.accountName && <span className="text-sm text-slate-500">· {a.accountName}</span>}
              </div>
              <div className="mt-3 grid grid-cols-2 gap-2 text-sm">
                {a.ownerName && <div><p className="text-xs text-slate-400">Owner</p><p className="font-medium text-slate-700 dark:text-slate-200">{a.ownerName}</p></div>}
                {a.ownerEmail && <div><p className="text-xs text-slate-400">Owner email</p><p className="font-medium text-slate-700 dark:text-slate-200">{a.ownerEmail}</p></div>}
                <div><p className="text-xs text-slate-400">People with access</p><p className="inline-flex items-center gap-1 font-medium text-slate-700 dark:text-slate-200"><Users className="h-3.5 w-3.5" />{a.accessCount || 0}</p></div>
              </div>
              {a.profileUrl && <a href={a.profileUrl} target="_blank" rel="noreferrer" className="mt-2 inline-flex items-center gap-1 text-xs font-semibold text-brand-600 hover:underline"><ExternalLink className="h-3.5 w-3.5" />{a.profileUrl}</a>}
              {a.linkedEmails?.length > 0 && <p className="mt-2 text-xs text-slate-400">Linked emails: <span className="text-slate-600 dark:text-slate-300">{a.linkedEmails.join(', ')}</span></p>}
              {a.handlers?.length > 0 && (
                <div className="mt-3 border-t border-slate-100 pt-3 dark:border-slate-800">
                  <p className="mb-2 text-xs font-semibold uppercase text-slate-400">Admins — click to contact</p>
                  <div className="flex flex-wrap gap-2">
                    {a.handlers.map((h, i) => (
                      <button key={i} type="button" onClick={() => setContact({ handler: h, account: a })} title="View contact details"
                        className="inline-flex items-center gap-1.5 rounded-lg bg-slate-50 px-2.5 py-1.5 text-sm text-slate-700 transition-colors hover:bg-brand-50 hover:text-brand-700 dark:bg-slate-800/60 dark:text-slate-200 dark:hover:bg-brand-500/10">
                        {h.linked && <UserCheck className="h-3.5 w-3.5 text-emerald-500" />}
                        <span className="font-medium">{h.name}</span>
                        {h.role && <span className="text-xs text-slate-400">· {h.role}</span>}
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </Card>
          ))}
        </div>
      )}

      {contact && <ContactModal handler={contact.handler} account={contact.account} onClose={() => setContact(null)} />}
    </div>
  );
}

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
            <p className="text-xs text-slate-400">{[h.role, h.jobTitle].filter(Boolean).join(' · ')}{h.role || h.jobTitle ? ' · ' : ''}{account.platform}</p>
          </div>
        </div>

        <div className="space-y-2">
          <Row icon={Mail} label="Email" value={h.email} href={h.email ? `mailto:${h.email}` : undefined} onCopy />
          <Row icon={Phone} label="Phone" value={h.phone} href={h.phone ? `tel:${h.phone}` : undefined} onCopy />
          <Row icon={Linkedin} label="LinkedIn" value={h.linkedinUrl} display={h.linkedinUrl?.replace(/^https?:\/\/(www\.)?/, '').replace(/\/$/, '')} href={h.linkedinUrl || undefined} onCopy />
        </div>

        {!h.email && !h.phone && !h.linkedinUrl && (
          <p className="rounded-xl bg-slate-50 px-3.5 py-2.5 text-sm text-slate-400 dark:bg-slate-800/50">No contact details on file.</p>
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
