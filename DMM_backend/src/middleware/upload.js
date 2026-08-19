import multer from 'multer';

// We keep files in memory and hand the buffer to the storage driver
// (local disk or Cloudinary). This keeps the upload code driver-agnostic.
const storage = multer.memoryStorage();

const ALLOWED_EXTENSIONS = new Set([
  '.png',
  '.jpg',
  '.jpeg',
  '.webp',
  '.gif',
  '.svg',
  '.mp4',
  '.webm',
  '.mov',
  '.mkv',
  '.ogv',
  '.m4v',
  '.pdf',
  '.ppt',
  '.pptx',
  '.ai',
  '.psd',
  '.xlsx',
  '.xls',
  '.csv',
  // Word / plain text — documents people attach alongside artwork.
  '.doc',
  '.docx',
  '.txt',
]);

const getExtension = (filename = '') => {
  const dotIndex = filename.lastIndexOf('.');
  return dotIndex >= 0 ? filename.slice(dotIndex).toLowerCase() : '';
};

// The client controls both the declared mimetype and the filename, so neither
// is proof of real content — but gating on the extension alone (rather than
// mimetype-OR-extension) closes the "any file at all, labelled
// application/octet-stream" bypass: that mimetype is only on the allowlist as
// a fallback for a handful of real formats (.psd/.ai/.xlsx sometimes arrive
// with it), and accepting it unconditionally accepted everything.
const fileFilter = (req, file, cb) => {
  const extension = getExtension(file.originalname);
  if (ALLOWED_EXTENSIONS.has(extension)) return cb(null, true);
  cb(new Error(`Unsupported file type: ${extension || file.mimetype}`));
};

// 500MB — generous enough for the video uploads this app allows (event
// albums, signage banner photos/reels, brand videos) while still bounding
// per-request memory, since files are buffered fully in memory before being
// handed to the storage driver. Multiple concurrent uploads at this ceiling
// still add up; if that becomes a real constraint, switch memoryStorage to
// diskStorage streaming in this file so files never fully load into memory.
const MAX_FILE_BYTES = 500 * 1024 * 1024;

const upload = multer({
  storage,
  fileFilter,
  limits: { fileSize: MAX_FILE_BYTES },
});

export default upload;
