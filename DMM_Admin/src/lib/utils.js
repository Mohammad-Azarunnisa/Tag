import { clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';
import { format, formatDistanceToNow } from 'date-fns';

export const cn = (...inputs) => twMerge(clsx(inputs));

export const formatDate = (d) => (d ? format(new Date(d), 'dd MMM yyyy') : '-');
export const formatDateTime = (d) => (d ? format(new Date(d), 'dd MMM yyyy, HH:mm') : '-');
export const timeAgo = (d) => (d ? formatDistanceToNow(new Date(d), { addSuffix: true }) : '-');

export const formatBytes = (bytes) => {
  if (!bytes) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${(bytes / Math.pow(k, i)).toFixed(1)} ${sizes[i]}`;
};

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

export const initials = (name = '') =>
  name.split(' ').map((w) => w[0]).slice(0, 2).join('').toUpperCase();

// Trigger a browser download for a Blob (e.g. an Excel file returned by the API).
export const downloadBlob = (blob, filename) => {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
};

// Is this approval media item a video? Checks stored mediaType or URL extension.
export const isVideo = (m) =>
  m?.mediaType === 'video' || /\.(mp4|webm|mov|m4v|ogg|mkv)$/i.test(m?.url || '');

export const ROLE_STYLES = {
  ADMIN: 'bg-violet-100 text-violet-700 dark:bg-violet-500/15 dark:text-violet-400',
  CEO: 'bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-400',
  USER: 'bg-sky-100 text-sky-700 dark:bg-sky-500/15 dark:text-sky-400',
};

// Display labels for the USER sub-types (userType enum).
const USER_TYPE_LABELS = {
  DESIGNER: 'Designer',
  SOCIAL_HANDLER: 'Social Handler',
  COORDINATOR: 'Coordinator',
};
export const userTypeLabel = (t) => USER_TYPE_LABELS[t] || 'Designer';

// Three tiers shown to people: Super Admin → Admin (org manager, stored as CEO)
// → User. The internal role enum stays ADMIN/CEO/USER; a USER is further
// distinguished by its userType (designer / social handler / coordinator).
export const roleLabel = (u) => {
  if (u?.isSuperAdmin) return 'Super Admin';
  if (u?.role === 'USER') return userTypeLabel(u?.userType);
  return 'Admin';
};
export const roleStyle = (u) =>
  u?.isSuperAdmin
    ? ROLE_STYLES.ADMIN
    : u?.role === 'USER'
      ? ROLE_STYLES.USER
      : ROLE_STYLES.CEO;

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
