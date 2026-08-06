// One-time interactive setup for Google Drive access (Events module only).
// Run: node scripts/googleDriveAuth.js
//
// The full Drive scope is blocked on Google's device-authorization (TV/limited
// input) flow, so this uses the standard authorization-code flow instead. The
// redirect URI includes an explicit port (http://localhost:8080) — a bare
// "http://localhost" with no port is rejected by Google's newer loopback
// redirect validation. Nothing needs to actually listen on that port: the
// browser tab will fail to load after you approve access, which is expected —
// the "code" query parameter is still in the address bar for you to copy.
//
// Before running: download an OAuth2 "Desktop app" client from Google Cloud
// Console (APIs & Services -> Credentials -> Create Credentials -> OAuth
// client ID -> Desktop app) and save it as
// DMM_backend/src/config/credentials/google_drive_api.json
import fs from 'fs';
import path from 'path';
import readline from 'readline';
import { fileURLToPath } from 'url';
import { google } from 'googleapis';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CREDENTIALS_PATH = path.resolve(__dirname, '../src/config/credentials/google_drive_api.json');
const TOKEN_PATH = path.resolve(__dirname, '../src/config/credentials/google_drive_token.json');
const SCOPES = ['https://www.googleapis.com/auth/drive'];
const REDIRECT_URI = 'http://localhost:8080';

function fail(message) {
  console.error(`\n✖ ${message}\n`);
  process.exit(1);
}

if (!fs.existsSync(CREDENTIALS_PATH)) {
  fail(`Could not find ${CREDENTIALS_PATH}\nDownload the OAuth2 "Desktop app" client JSON from Google Cloud Console and save it there first.`);
}

const raw = JSON.parse(fs.readFileSync(CREDENTIALS_PATH, 'utf8'));
const cfg = raw.installed || raw.web;
if (!cfg) fail('google_drive_api.json is missing an "installed" or "web" key — is this a valid OAuth2 client secret file?');

const oAuth2Client = new google.auth.OAuth2(cfg.client_id, cfg.client_secret, REDIRECT_URI);

const authUrl = oAuth2Client.generateAuthUrl({ access_type: 'offline', prompt: 'consent', scope: SCOPES });

console.log('\n1. Open this URL in a browser that is logged into the Google account you want to use:\n');
console.log(authUrl);
console.log('\n2. Approve access. Google will redirect to a localhost:8080 URL that fails to load — that is expected.');
console.log('3. Copy the value of the "code" query parameter from that browser address bar and paste it below.\n');

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
rl.question('Paste the code here: ', async (code) => {
  rl.close();
  try {
    const { tokens } = await oAuth2Client.getToken(code.trim());
    fs.writeFileSync(TOKEN_PATH, JSON.stringify(tokens, null, 2));
    console.log(`\n✔ Saved Drive access token to ${TOKEN_PATH}`);
    console.log('The Events module can now upload/download to your Google Drive. Restart the backend if it is running.\n');
  } catch (err) {
    fail(`Failed to exchange code for tokens: ${err.message}`);
  }
});
