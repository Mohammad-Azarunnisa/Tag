import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';
import mongoose from 'mongoose';
import ExcelJS from 'exceljs';
import { MongoMemoryServer } from 'mongodb-memory-server';

const storageRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'tag-people-'));
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret';
process.env.STORAGE_DRIVER = 'local';
process.env.LOCAL_STORAGE_ROOT = storageRoot;
// The tests below that exercise the folder tree write to disk; the Drive-mode
// tests at the end switch this per test.
process.env.PEOPLE_PHOTO_STORAGE = 'local';

const { default: app } = await import('../app.js');
const { default: User } = await import('../models/User.js');
const { default: Organization } = await import('../models/Organization.js');
const { generateToken } = await import('../utils/token.js');
const { ROLES, USER_TYPES } = await import('../config/constants.js');

let mongod; let server; let origin; let ncet; let ncms;
const tok = {};

before(async () => {
  mongod = await MongoMemoryServer.create();
  await mongoose.connect(mongod.getUri());
  ncet = await Organization.create({ name: 'NCET', slug: 'ncet' });
  ncms = await Organization.create({ name: 'NCMS', slug: 'ncms' });
  const [su, coord, designer, viewOnlyCoord] = await User.create([
    { name: 'Super', email: 'su@t.com', password: 'Passw0rd!', role: ROLES.ADMIN, isSuperAdmin: true },
    { name: 'Coco', email: 'coco@t.com', password: 'Passw0rd!', role: ROLES.USER, userType: USER_TYPES.COORDINATOR, organization: ncet._id },
    { name: 'Dee', email: 'dee@t.com', password: 'Passw0rd!', role: ROLES.USER, userType: USER_TYPES.DESIGNER, organization: ncms._id },
    { name: 'Vic', email: 'vic@t.com', password: 'Passw0rd!', role: ROLES.USER, userType: USER_TYPES.COORDINATOR, organization: ncet._id, viewOnly: true },
  ]);
  Object.assign(tok, { su: generateToken(su._id), coord: generateToken(coord._id), designer: generateToken(designer._id), view: generateToken(viewOnlyCoord._id) });
  server = app.listen(0);
  await new Promise((r) => server.once('listening', r));
  origin = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  server?.close(); await mongoose.disconnect(); await mongod?.stop();
  fs.rmSync(storageRoot, { recursive: true, force: true });
});

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');
const form = (fields = {}, files = []) => {
  const f = new FormData();
  Object.entries(fields).forEach(([k, v]) => f.append(k, v));
  files.forEach(([field, name, buf]) => f.append(field, new Blob([buf]), name));
  return f;
};
const call = async (token, p, { method = 'GET', body } = {}) => {
  const res = await fetch(`${origin}${p}`, { method, headers: { Authorization: `Bearer ${token}` }, body });
  return { status: res.status, json: await res.json().catch(() => ({})) };
};

test('a coordinator adds a student with a photo and it lands in the college/year/branch folder named by roll number', async () => {
  const r = await call(tok.coord, '/api/people-data/students', {
    method: 'POST',
    body: form({ rollNo: '21a91a0501', name: 'Asha Rao', passOutYear: '2025', branch: 'cse' }, [['photo', 'whatever.jpg', PNG]]),
  });
  assert.equal(r.status, 201);
  assert.equal(r.json.student.rollNo, '21A91A0501');
  assert.equal(r.json.student.hasDetails, true);
  assert.ok(fs.existsSync(path.join(storageRoot, 'people-data', 'students', 'NCET', '2025', 'CSE', '21A91A0501.jpg')));
});

test('the same roll number cannot be added twice for one college', async () => {
  const r = await call(tok.coord, '/api/people-data/students', { method: 'POST', body: form({ rollNo: '21A91A0501', passOutYear: '2025', branch: 'CSE' }) });
  assert.equal(r.status, 409);
});

test('photos named by roll number attach to existing students and create the rest as "needs attention"', async () => {
  await call(tok.coord, '/api/people-data/students', { method: 'POST', body: form({ rollNo: '21A91A0502', name: 'Bala', passOutYear: '2025', branch: 'CSE' }) });
  const r = await call(tok.coord, '/api/people-data/students/photos', {
    method: 'POST',
    body: form({ passOutYear: '2025', branch: 'CSE' }, [['photos', '21A91A0502.jpg', PNG], ['photos', '21A91A0599.png', PNG], ['photos', '21A91A0501.jpg', PNG]]),
  });
  assert.equal(r.json.attached, 1);
  assert.equal(r.json.created, 1);
  assert.equal(r.json.skipped.length, 1); // 0501 already had a photo
  const list = await call(tok.coord, '/api/people-data/students?status=incomplete');
  assert.deepEqual(list.json.items.map((s) => s.rollNo), ['21A91A0599']); // photo but no name
});

test('an Excel sheet fills in names without touching existing photos', async () => {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('S');
  ws.addRow(['Roll No', 'Full Name', 'Branch', 'Pass-out Year', 'Mobile']);
  ws.addRow(['21A91A0599', 'Chitra Devi', 'CSE', 2025, '9999999999']);
  ws.addRow(['21A91A0600', 'Dev Kumar', 'ECE', 2025, '']);
  const buf = Buffer.from(await wb.xlsx.writeBuffer());
  const r = await call(tok.coord, '/api/people-data/students/import', { method: 'POST', body: form({}, [['file', 'students.xlsx', buf]]) });
  assert.equal(r.status, 200);
  assert.equal(r.json.updated, 1);
  assert.equal(r.json.created, 1);
  const list = await call(tok.coord, '/api/people-data/students?q=Chitra');
  assert.equal(list.json.items[0].hasPhoto, true);
  assert.equal(list.json.items[0].hasDetails, true);
});

test('a designer sees only complete records, across colleges, and cannot change anything', async () => {
  const list = await call(tok.designer, '/api/people-data/students');
  assert.equal(list.status, 200);
  assert.ok(list.json.items.length > 0);
  assert.ok(list.json.items.every((s) => s.hasPhoto && s.name));
  assert.equal(list.json.canEdit, false);
  const w = await call(tok.designer, '/api/people-data/students', { method: 'POST', body: form({ rollNo: 'X1', passOutYear: '2025', branch: 'CSE', organization: String(ncms._id) }) });
  assert.equal(w.status, 403);
});

test('a coordinator only ever sees and writes their own college', async () => {
  const other = await call(tok.su, '/api/people-data/students', { method: 'POST', body: form({ rollNo: 'N1', name: 'Other', passOutYear: '2024', branch: 'CSE', organization: String(ncms._id) }, [['photo', 'a.jpg', PNG]]) });
  assert.equal(other.status, 201);
  const list = await call(tok.coord, `/api/people-data/students?organizationId=${ncms._id}`);
  assert.ok(list.json.items.every((s) => String(s.organization._id) === String(ncet._id)));
  // even naming another college in the body, the student lands in their own
  const sneaky = await call(tok.coord, '/api/people-data/students', { method: 'POST', body: form({ rollNo: 'S1', name: 'Sneaky', passOutYear: '2025', branch: 'CSE', organization: String(ncms._id) }) });
  assert.equal(sneaky.status, 201);
  assert.equal(String(sneaky.json.student.organization), String(ncet._id));
});

test('a view-only account cannot write', async () => {
  const r = await call(tok.view, '/api/people-data/students', { method: 'POST', body: form({ rollNo: 'V1', passOutYear: '2025', branch: 'CSE' }) });
  assert.equal(r.status, 403);
});

test('changing a student branch moves the photo to the new branch folder', async () => {
  const list = await call(tok.coord, '/api/people-data/students?q=21A91A0502');
  const id = list.json.items[0]._id;
  const r = await call(tok.coord, `/api/people-data/students/${id}`, { method: 'PUT', body: form({ branch: 'ece' }) });
  assert.equal(r.status, 200);
  assert.ok(fs.existsSync(path.join(storageRoot, 'people-data', 'students', 'NCET', '2025', 'ECE', '21A91A0502.png')) || fs.existsSync(path.join(storageRoot, 'people-data', 'students', 'NCET', '2025', 'ECE', '21A91A0502.jpg')));
});

test('faculty photos go in a folder named after the employee ID', async () => {
  const r = await call(tok.coord, '/api/people-data/faculty', {
    method: 'POST',
    body: form({ employeeId: 'emp1042', name: 'Dr. Rao', degree: 'M.Tech, Ph.D', designation: 'Professor' }, [['photo', 'x.png', PNG]]),
  });
  assert.equal(r.status, 201);
  assert.ok(fs.existsSync(path.join(storageRoot, 'people-data', 'faculty', 'NCET', 'EMP1042', 'photo.png')));
  const list = await call(tok.designer, '/api/people-data/faculty');
  assert.equal(list.json.items.length, 1);
});


test('in Google Drive mode an upload is refused with a clear message when Drive is not connected', async () => {
  process.env.PEOPLE_PHOTO_STORAGE = 'drive';
  try {
    const r = await call(tok.coord, '/api/people-data/students', { method: 'POST', body: form({ rollNo: 'D1', name: 'Drive Test', passOutYear: '2025', branch: 'CSE' }, [['photo', 'd.jpg', PNG]]) });
    assert.equal(r.status, 503);
    assert.match(r.json.message, /Google Drive/);
    const bulk = await call(tok.coord, '/api/people-data/students/photos', { method: 'POST', body: form({ passOutYear: '2025', branch: 'CSE' }, [['photos', 'D2.jpg', PNG]]) });
    assert.equal(bulk.status, 503);
  } finally { process.env.PEOPLE_PHOTO_STORAGE = 'local'; }
});

test('a pasted Google Drive link becomes the photo, with no upload and no Drive connection needed', async () => {
  process.env.PEOPLE_PHOTO_STORAGE = 'drive';
  try {
    const id = '1AbCdEfGhIjKlMnOpQrStUvWxYz012345';
    const link = `https://drive.google.com/file/d/${id}/view?usp=sharing`;
    const r = await call(tok.coord, '/api/people-data/students', { method: 'POST', body: form({ rollNo: 'L1', name: 'Linked Student', passOutYear: '2025', branch: 'CSE', photoLink: link }) });
    assert.equal(r.status, 201);
    assert.equal(r.json.student.hasPhoto, true);
    assert.ok(r.json.student.photoUrl.includes(`drive.google.com/thumbnail?id=${id}`));
    assert.ok(r.json.student.downloadUrl.includes(`export=download&id=${id}`));
    // deleting it must not try to delete the user's own Drive file (Drive is not connected here, so that would throw)
    const del = await call(tok.coord, `/api/people-data/students/${r.json.student._id}`, { method: 'DELETE' });
    assert.equal(del.status, 200);
    const bad = await call(tok.coord, '/api/people-data/students', { method: 'POST', body: form({ rollNo: 'L2', passOutYear: '2025', branch: 'CSE', photoLink: 'https://example.com/x.jpg' }) });
    assert.equal(bad.status, 400);
  } finally { process.env.PEOPLE_PHOTO_STORAGE = 'local'; }
});

