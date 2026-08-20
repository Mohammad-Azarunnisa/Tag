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
