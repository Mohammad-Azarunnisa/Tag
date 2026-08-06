// Storage abstraction. Default driver is "local" (disk via Multer).
// Switch STORAGE_DRIVER=cloudinary in .env to upload to Cloudinary instead.
// Controllers only ever call uploadBuffer()/deleteFile() so the rest of the
// codebase doesn't care which driver is active.
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import crypto from 'crypto';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Where locally-stored files live on disk. Defaults to the app's own `uploads`
// folder (fine for local dev). In production point LOCAL_STORAGE_ROOT at the
// mounted storage volume, e.g. the TrueNAS mount: LOCAL_STORAGE_ROOT=/mnt/tag-storage
// Everything (templates, assets, brand assets, approvals, avatars) is written
// under and served from this single root, so one env var moves all of it.
const UPLOAD_ROOT = process.env.LOCAL_STORAGE_ROOT
  ? path.resolve(process.env.LOCAL_STORAGE_ROOT)
  : path.resolve(__dirname, '../../uploads');

const driver = (process.env.STORAGE_DRIVER || 'local').toLowerCase();

// Boot-time sanity check: if a storage root is configured but missing, warn
// loudly. This catches the classic footgun of the TrueNAS mount not being
// mounted yet — otherwise files would silently land on the local disk under
// the mount point and vanish once the real volume mounts.
function ensureStorageReady() {
  if (driver !== 'local') return { ok: true, root: null };
  const configured = !!process.env.LOCAL_STORAGE_ROOT;
  const exists = fs.existsSync(UPLOAD_ROOT);
  if (configured && !exists) {
    console.warn(`⚠️  LOCAL_STORAGE_ROOT is set to "${UPLOAD_ROOT}" but that path does not exist. Is the storage volume mounted? Uploads will fail until it is available.`);
  }
  return { ok: !configured || exists, root: UPLOAD_ROOT };
}

/**
 * Persist a file buffer and return { url, publicId }.
 * @param {Buffer} buffer
 * @param {object} opts { folder, originalName, mimetype }
 */
async function uploadBuffer(buffer, { folder = 'misc', originalName = 'file' }) {
  if (driver === 'cloudinary') {
    return uploadToCloudinary(buffer, folder, originalName);
  }
  return uploadToLocal(buffer, folder, originalName);
}

async function deleteFile(publicId) {
  if (!publicId) return;
  if (driver === 'cloudinary') {
    const { v2: cloudinary } = await import('cloudinary');
    configureCloudinary(cloudinary);
    await cloudinary.uploader.destroy(publicId, { resource_type: 'auto' });
    return;
  }
  // local: publicId is a path relative to uploads root
  const abs = path.join(UPLOAD_ROOT, publicId);
  if (abs.startsWith(UPLOAD_ROOT) && fs.existsSync(abs)) fs.unlinkSync(abs);
}

// ---------- local driver ----------
function uploadToLocal(buffer, folder, originalName) {
  const dir = path.join(UPLOAD_ROOT, folder);
  fs.mkdirSync(dir, { recursive: true });
  const ext = path.extname(originalName) || '';
  const base = path
    .basename(originalName, ext)
    .replace(/[^a-zA-Z0-9-_]/g, '_')
    .slice(0, 40);
  const unique = `${Date.now()}-${crypto.randomBytes(4).toString('hex')}`;
  const filename = `${base || 'file'}-${unique}${ext}`;
  const relPath = path.posix.join(folder, filename);
  fs.writeFileSync(path.join(dir, filename), buffer);
  return {
    url: `/uploads/${relPath}`, // served statically by express
    publicId: relPath,
  };
}

// ---------- cloudinary driver ----------
function configureCloudinary(cloudinary) {
  cloudinary.config({
    cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
    api_key: process.env.CLOUDINARY_API_KEY,
    api_secret: process.env.CLOUDINARY_API_SECRET,
  });
}

async function uploadToCloudinary(buffer, folder, originalName) {
  const { v2: cloudinary } = await import('cloudinary');
  configureCloudinary(cloudinary);
  return new Promise((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(
      { folder: `dmm/${folder}`, resource_type: 'auto', public_id: path.parse(originalName).name },
      (err, result) => {
        if (err) return reject(err);
        resolve({ url: result.secure_url, publicId: result.public_id });
      }
    );
    stream.end(buffer);
  });
}

export { uploadBuffer, deleteFile, driver, UPLOAD_ROOT, ensureStorageReady };
