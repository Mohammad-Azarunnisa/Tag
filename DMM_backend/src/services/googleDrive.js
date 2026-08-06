// Google Drive storage for the Events module. Each event gets its own folder
// under GOOGLE_DRIVE_ROOT_PATH; uploaded photos land inside that folder and
// are shared "anyone with the link can view" so the folderLink/thumbnails work
// for every teammate without them needing Drive access to the underlying account.
//
// Auth is the personal OAuth "Desktop app" flow — see scripts/googleDriveAuth.js
// for the one-time setup that produces the credentials/token files below.
import fs from 'fs';
import path from 'path';
import { Readable } from 'stream';
import { google } from 'googleapis';

const CREDENTIALS_PATH = path.resolve(process.cwd(), process.env.GOOGLE_DRIVE_CREDENTIALS_PATH || 'src/config/credentials/google_drive_api.json');
const TOKEN_PATH = path.resolve(process.cwd(), process.env.GOOGLE_DRIVE_TOKEN_PATH || 'src/config/credentials/google_drive_token.json');
const ROOT_PATH = process.env.GOOGLE_DRIVE_ROOT_PATH || 'Tag-application/Events';
// Must match scripts/googleDriveAuth.js — irrelevant to refresh-token calls,
// but kept identical in case Google ever re-validates it on token exchange.
const REDIRECT_URI = 'http://localhost:8080';

export function isDriveConfigured() {
  return fs.existsSync(CREDENTIALS_PATH) && fs.existsSync(TOKEN_PATH);
}

let drive = null;

function getDrive() {
  if (drive) return drive;
  const { installed, web } = JSON.parse(fs.readFileSync(CREDENTIALS_PATH, 'utf8'));
  const cfg = installed || web;
  const token = JSON.parse(fs.readFileSync(TOKEN_PATH, 'utf8'));

  const auth = new google.auth.OAuth2(cfg.client_id, cfg.client_secret, REDIRECT_URI);
  auth.setCredentials(token);
  // Google rotates the access token under the hood; persist it so the next
  // process restart doesn't have to re-auth from the (unchanged) refresh token.
  auth.on('tokens', (fresh) => {
    fs.writeFileSync(TOKEN_PATH, JSON.stringify({ ...token, ...fresh }, null, 2));
  });

  drive = google.drive({ version: 'v3', auth });
  return drive;
}

async function shareWithLink(fileId) {
  await getDrive().permissions.create({ fileId, requestBody: { role: 'reader', type: 'anyone' } });
}

async function findOrCreateFolder(name, parentId) {
  const escaped = name.replace(/'/g, "\\'");
  const q = [
    `name='${escaped}'`,
    "mimeType='application/vnd.google-apps.folder'",
    'trashed=false',
    parentId ? `'${parentId}' in parents` : "'root' in parents",
  ].join(' and ');
  const { data } = await getDrive().files.list({ q, fields: 'files(id)', spaces: 'drive' });
  if (data.files?.length) return data.files[0].id;
  const { data: created } = await getDrive().files.create({
    requestBody: { name, mimeType: 'application/vnd.google-apps.folder', parents: parentId ? [parentId] : [] },
    fields: 'id',
  });
  return created.id;
}

let rootFolderIdPromise = null;
function getRootFolderId() {
  if (!rootFolderIdPromise) {
    rootFolderIdPromise = ROOT_PATH.split('/').filter(Boolean).reduce(
      (parent, segment) => parent.then((parentId) => findOrCreateFolder(segment, parentId)),
      Promise.resolve(null)
    );
  }
  return rootFolderIdPromise;
}

// Creates "<ROOT_PATH>/<eventName>" and makes it link-shareable. Returns the
// folder's Drive id and the link to put in the event's folderLink field.
export async function createEventDriveFolder(eventName) {
  const rootId = await getRootFolderId();
  const { data: folder } = await getDrive().files.create({
    requestBody: { name: eventName, mimeType: 'application/vnd.google-apps.folder', parents: [rootId] },
    fields: 'id, webViewLink',
  });
  await shareWithLink(folder.id);
  return { id: folder.id, webViewLink: folder.webViewLink };
}

// Uploads one file into an existing event folder and makes it link-shareable.
export async function uploadEventPhoto(folderId, buffer, originalName, mimetype) {
  const { data: file } = await getDrive().files.create({
    requestBody: { name: originalName, parents: [folderId] },
    media: { mimeType: mimetype || 'application/octet-stream', body: Readable.from(buffer) },
    fields: 'id, name, webViewLink, thumbnailLink',
  });
  await shareWithLink(file.id);
  return file;
}

// Deletes a file OR folder (recursively removes everything inside a folder).
export async function deleteDriveFile(fileId) {
  if (!fileId) return;
  try {
    await getDrive().files.delete({ fileId });
  } catch (err) {
    if (err.code !== 404) throw err;
  }
}
