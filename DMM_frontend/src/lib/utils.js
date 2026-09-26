import { useEffect, useState } from 'react';
import { clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';
import { format, formatDistanceToNow } from 'date-fns';

// Opening a row (a fresh navigate() to a detail route) and its Back button
// coming right back here are both full navigations, not a browser "back" — so
// filters, search text and pagination on a list page reset to their initial
// state on every return trip unless something remembers them. This mirrors
// them into sessionStorage under `key`, so the list looks exactly as the user
// left it. Session-scoped (not localStorage) on purpose: a stale filter from
// days ago shouldn't outlive the tab.
export function useSessionState(key, initialValue) {
  const [state, setState] = useState(() => {
    try {
      const saved = sessionStorage.getItem(key);
      return saved != null ? JSON.parse(saved) : initialValue;
    } catch {
      return initialValue;
    }
  });
  useEffect(() => {
    try { sessionStorage.setItem(key, JSON.stringify(state)); } catch { /* ignore */ }
  }, [key, state]);
  return [state, setState];
}

// Whether react-router has an in-app history entry to pop back to, so a
// "Back" button can return to wherever the user actually came from — a
// filtered list, a search result, a specific month on the calendar — instead
// of a single hardcoded destination that ignores how they got here. Falls
// back to that hardcoded destination only when there is nothing to go back
// to (a pasted link, a fresh tab, a page refresh on the detail view).
export const canNavigateBack = () => Boolean(window.history.state && window.history.state.idx > 0);

// A coordinator runs exactly one college, so any "which college?" control is a
// dead choice for them - the server pins their scope either way. Call sites use
// this to drop the control rather than render a one-option picker.
export const isCoordinatorUser = (user) => user?.role === 'USER' && user?.userType === 'COORDINATOR';

export const cn = (...inputs) => twMerge(clsx(inputs));

export const formatDate = (d) => (d ? format(new Date(d), 'dd MMM yyyy') : '-');
export const formatDateTime = (d) => (d ? format(new Date(d), 'dd MMM yyyy, HH:mm') : '-');
export const timeAgo = (d) => (d ? formatDistanceToNow(new Date(d), { addSuffix: true }) : '-');

// Show the full count with thousands separators (e.g. 12,400) — no K/M shorthand.
export const formatNumber = (n) => {
  if (n == null || n === '') return '0';
  const num = Number(n);
  if (!Number.isFinite(num)) return '0';
  return num.toLocaleString('en-US');
};

// Extract a YouTube video id from common URL forms (watch, youtu.be, embed, shorts, live).
export const youtubeId = (url = '') => {
  const m = String(url).match(/(?:youtube\.com\/(?:watch\?(?:.*&)?v=|embed\/|shorts\/|live\/)|youtu\.be\/)([\w-]{11})/i);
  return m ? m[1] : null;
};

// Preview thumbnail image for a YouTube link (or null if it isn't one).
export const youtubeThumb = (url = '') => {
  const id = youtubeId(url);
  return id ? `https://img.youtube.com/vi/${id}/hqdefault.jpg` : null;
};

export const formatBytes = (bytes) => {
  if (!bytes) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB', 'PB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${(bytes / Math.pow(k, i)).toFixed(1)} ${sizes[i]}`;
};

export const initials = (name = '') =>
  name.split(' ').map((w) => w[0]).slice(0, 2).join('').toUpperCase();

// People see three tiers: Super Admin → Admin (org manager, stored as CEO) → User.
// The internal role enum stays ADMIN/CEO/USER.
export const roleLabel = (u) => (u?.isSuperAdmin ? 'Super Admin' : u?.role === 'USER' ? 'User' : 'Admin');

// ---------------------------------------------------------------------------
// Who may delete
//
// Deleting is an administrator's act, and the server is the authority on it
// (DMM_backend/src/utils/permissions.js). These two are only what stops a button
// being offered to someone whose click would come back refused — a delete icon
// that always fails is worse than no icon at all.
//
// 'ADMIN' is the platform administrator (the super admin account); 'CEO' is an
// institution's Admin. Both read as "Admin" in the UI, which is why they are
// always tested together. A view-only account is blocked from every write
// server-side, so it must not see the button either.
export const canDeleteContent = (user) =>
  !user?.viewOnly && (user?.role === 'ADMIN' || user?.role === 'CEO');

// The same question for something that belongs to one institution. An
// institution's Admin may clear out their own college's material; anything
// shared across every college (no organization) belongs to the platform, so
// removing it stays with the super admin who curates it.
export const canDeleteOrgItem = (user, organization) =>
  canDeleteContent(user) && (user?.role === 'ADMIN' || Boolean(organization));

// Is this approval media item (or a raw File) a video? Checks the stored
// mediaType, the File mime type, or the URL/name extension as a fallback.
export const isVideo = (m) =>
  m?.mediaType === 'video' ||
  (typeof m?.type === 'string' && m.type.startsWith('video/')) ||
  /\.(mp4|webm|mov|m4v|ogg|mkv)$/i.test(m?.url || m?.name || '');

// Status -> tailwind color classes (badges, dots)
export const STATUS_STYLES = {
  IN_DESIGN: 'bg-indigo-100 text-indigo-700 dark:bg-indigo-500/15 dark:text-indigo-300',
  PENDING: 'bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-400',
  APPROVED: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-400',
  REJECTED: 'bg-rose-100 text-rose-700 dark:bg-rose-500/15 dark:text-rose-400',
  RESUBMITTED: 'bg-sky-100 text-sky-700 dark:bg-sky-500/15 dark:text-sky-400',
  POSTED: 'bg-violet-100 text-violet-700 dark:bg-violet-500/15 dark:text-violet-400',
  DELIVERED: 'bg-teal-100 text-teal-700 dark:bg-teal-500/15 dark:text-teal-300',
};

// Human labels for statuses (the raw enum is ALL_CAPS with underscores).
export const STATUS_LABELS = {
  IN_DESIGN: 'In design',
  PENDING: 'Pending review',
  APPROVED: 'Approved',
  REJECTED: 'Needs changes',
  RESUBMITTED: 'Resubmitted',
  POSTED: 'Posted',
  DELIVERED: 'Delivered',
};
export const statusLabel = (s) => STATUS_LABELS[s] || s;

export const PLATFORM_STYLES = {
  LinkedIn: { color: '#0A66C2', bg: 'bg-[#0A66C2]' },
  Instagram: { color: '#E1306C', bg: 'bg-[#E1306C]' },
  YouTube: { color: '#FF0000', bg: 'bg-[#FF0000]' },
  Facebook: { color: '#1877F2', bg: 'bg-[#1877F2]' },
};

export const CHART_COLORS = ['#6366f1', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#06b6d4'];

// Every channel an approval request targets. New requests carry `platforms`;
// older ones only have the single `platform`, so treat that as a one-item list.
export const platformsOf = (r) =>
  (r?.platforms?.length ? r.platforms : (r?.platform ? [r.platform] : []));

// Attachments that have no inline preview (PDF / Office / Excel / PSD / AI …).
// Checked BEFORE treating something as an image, because PSD and AI files often
// arrive with an image/* mime type.
export const isDoc = (m) =>
  m?.mediaType === 'document'
  || /\.(pdf|docx?|xlsx?|xls|csv|pptx?|ppt|psd|ai|eps|zip|rar|txt)$/i.test(m?.url || m?.name || '');

// Filename to show on a document tile, falling back to the tail of the URL.
export const fileLabel = (m) =>
  m?.name || decodeURIComponent(String(m?.url || '').split('/').pop() || 'file');

// ---------------------------------------------------------------------------
// Download a stored file
//
// `window.open(url)` is not a download. For the formats a repository is mostly
// made of — PDF, PNG, JPG, MP4 — the browser just renders the file in the new
// tab and nothing is ever saved, which is exactly what the Download button used
// to do. Asking our own /uploads route for the file with ?download=<name> makes
// the server answer with Content-Disposition: attachment, and that header is the
// only thing that changes the browser's mind
// (DMM_backend/src/utils/contentDisposition.js).
//
// A file we do not serve ourselves — an absolute URL on a third-party CDN — is
// not ours to add that header to, so it still opens in a tab rather than
// pretending to save.
export const triggerDownload = (url, fileName) => {
  if (!url) return;
  const external = url.startsWith('http://') || url.startsWith('https://');
  const href = external
    ? url
    : url + (url.includes('?') ? '&' : '?') + 'download=' + encodeURIComponent(fileName || '1');

  const a = document.createElement('a');
  a.href = href;
  if (external) { a.target = '_blank'; a.rel = 'noopener'; }
  // Same-origin, this attribute alone would be enough, and it also names the
  // saved file. It is ignored cross-origin, which is why the header above does
  // the real work rather than this.
  if (fileName) a.download = fileName;
  // Firefox only follows a click on a node that is actually in the document.
  document.body.appendChild(a);
  a.click();
  a.remove();
};

// Download every attachment in a message individually (no zip — see
// triggerDownload above for why). Fired in the same tick, a browser treats a
// burst of programmatic downloads like a popup flood and silently drops all
// but the first, so each one is staggered.
export const downloadAllAttachments = (attachments = []) => {
  attachments.forEach((a, i) => {
    setTimeout(() => triggerDownload(a?.url, fileLabel(a)), i * 400);
  });
};

// ---------------------------------------------------------------------------
// Job titles
//
// Mirrors DMM_backend/src/config/constants.js#JOB_TITLES, the same way the
// template and asset category lists are mirrored. Keep the two in step: the
// server validates against its copy and will refuse a title this list offers but
// that one does not.
//
// A fixed list because free text produced three spellings of "Coordinator" and a
// person who typed their own name into the field, and every screen that groups or
// searches by title read those as different jobs.
export const JOB_TITLES = [
  // Leadership and platform administration
  'CEO',
  'Super Administrator',
  'Administrator',
  'Manager',
  'Branding Manager',
  // Design and production
  'Graphic Designer',
  'Senior Graphic Designer',
  'Motion Graphics Designer',
  'Video Editor',
  'Photographer',
  'Videographer',
  // Social and content
  'Social Media Manager',
  'Social Media Handler',
  'Content Writer',
  // Web
  'Web Developer',
  // Institution side
  'Coordinator',
  'Admissions Coordinator',
];
