import { clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';
import { format, formatDistanceToNow } from 'date-fns';

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
