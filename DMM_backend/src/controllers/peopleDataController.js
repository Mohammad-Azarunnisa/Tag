import path from 'path';
import asyncHandler from 'express-async-handler';
import ExcelJS from 'exceljs';
import Student from '../models/Student.js';
import Faculty from '../models/Faculty.js';
import Organization from '../models/Organization.js';
import { uploadBuffer, deleteFile, moveStoredFile, safeSegment } from '../config/storage.js';
import {
  isDriveConfigured, ensurePeopleFolder, uploadPersonPhoto, moveDriveFile, deleteDriveFile, driveLinks, driveFileIdFromLink,
} from '../services/googleDrive.js';
import { loadGrid, findColumns, cellText, escapeRegex } from '../utils/sheet.js';
import { accessibleOrgIds, canAccessOrg, pinnedWriteOrg } from '../utils/org.js';
import { ROLES, USER_TYPES } from '../config/constants.js';

// ---------------------------------------------------------------------------
// Student and faculty directory.
//
// Photos are stored in Google Drive (PEOPLE_PHOTO_STORAGE=drive, the default) in a
// folder tree that mirrors how the colleges think about this data:
//   Students/<college>/<pass-out year>/<branch>/<roll no>.jpg
//   Faculty/<college>/<employee id>/photo.jpg
// A photo that already sits in Drive can instead be attached by pasting its link.
// PEOPLE_PHOTO_STORAGE=local keeps the old behaviour of writing the same tree
// to the storage volume.
// Everything else about a person is a database record tied to the photo by
// roll number / employee ID, so names and details can change without renaming
// files. Reads and writes are scoped to the colleges the caller may act in.
// ---------------------------------------------------------------------------

const IMAGE_EXT = new Set(['.jpg', '.jpeg', '.png', '.webp']);
const extOf = (name = '') => path.extname(name).toLowerCase();
const isImage = (file) => !!file && IMAGE_EXT.has(extOf(file.originalname));

const isDesignerOrHandler = (u) => u?.role === ROLES.USER && (u.userType === USER_TYPES.DESIGNER || u.userType === USER_TYPES.SOCIAL_HANDLER);
const isCoordinatorUser = (u) => u?.role === ROLES.USER && u.userType === USER_TYPES.COORDINATOR;

// Who may add, change or remove people: the super admin, an Admin for their own
// colleges, and a coordinator for theirs. Designers and handlers only look up.
const canWrite = (u) => !u?.viewOnly && (u?.role === ROLES.ADMIN || u?.role === ROLES.CEO || isCoordinatorUser(u));

const requireWriter = (req, res) => {
  if (!canWrite(req.user)) { res.status(403); throw new Error('You can view this data but not change it'); }
};

// The colleges a read covers. Designers and handlers serve every college, so
// they are not limited to their own — but they only see complete records.
const readScope = (req) => {
  const asked = req.query.organizationId && req.query.organizationId !== 'all' ? String(req.query.organizationId) : null;
  let orgIds;
  if (isDesignerOrHandler(req.user)) orgIds = null;
  else orgIds = accessibleOrgIds(req.user);
  if (asked) {
    if (orgIds !== null && !orgIds.includes(asked)) return { orgIds: [], completeOnly: isDesignerOrHandler(req.user) };
    orgIds = [asked];
  }
  return { orgIds, completeOnly: isDesignerOrHandler(req.user) };
};

// The college a write belongs to. A coordinator is pinned to their own.
const writeOrgFor = async (req, res) => {
  const pinned = pinnedWriteOrg(req.user);
  const orgId = pinned || req.body?.organization || req.query.organizationId;
  if (!orgId || orgId === 'all') { res.status(400); throw new Error('Choose which college this is for'); }
  if (!canAccessOrg(req.user, orgId)) { res.status(403); throw new Error('Not allowed to manage that college'); }
  const org = await Organization.findById(orgId).select('_id name');
  if (!org) { res.status(400); throw new Error('That college does not exist'); }
  return org;
};

const orgFolder = (org) => safeSegment(org.name, 'college');

// ---------- students ----------
const studentFolder = (org, s) =>
  path.posix.join('people-data', 'students', orgFolder(org), s.passOutYear ? String(s.passOutYear) : 'year-not-set', safeSegment(s.branch, 'branch-not-set'));
const studentFileName = (s, ext) => `${safeSegment(s.rollNo, 'student')}${ext}`;

const parseYear = (v) => {
  const n = parseInt(String(v ?? '').replace(/[^0-9]/g, '').slice(0, 4), 10);
  return Number.isFinite(n) && n >= 1990 && n <= 2100 ? n : null;
};
const clean = (v) => String(v ?? '').trim();

const publicStudent = (s) => ({
  _id: s._id,
  organization: s.organization,
  rollNo: s.rollNo,
  name: s.name,
  passOutYear: s.passOutYear,
  branch: s.branch,
  section: s.section,
  phone: s.phone,
  email: s.email,
  guardianPhone: s.guardianPhone,
  photoUrl: s.photo?.url || '',
  downloadUrl: s.photo?.downloadUrl || s.photo?.url || '',
  hasPhoto: !!s.photo?.url,
  hasDetails: !!(s.name && s.passOutYear && s.branch),
  updatedAt: s.updatedAt,
});

const useDrive = () => (process.env.PEOPLE_PHOTO_STORAGE || 'drive').toLowerCase() === 'drive';

const requireDrive = (res) => {
  if (useDrive() && !isDriveConfigured()) {
    res.status(503);
    throw new Error('Google Drive isn\'t connected yet. Run "node scripts/googleDriveAuth.js" on the server, then restart the backend.');
  }
};

const normExt = (name) => (extOf(name) === '.jpeg' ? '.jpg' : extOf(name));

// Where a photo belongs: Drive folder path + file name (and the same tree on disk).
const studentSpot = (org, s, ext) => ({
  segments: ['Students', orgFolder(org), s.passOutYear ? String(s.passOutYear) : 'year-not-set', safeSegment(s.branch, 'branch-not-set')],
  localFolder: studentFolder(org, s),
  fileName: studentFileName(s, ext),
});
const facultySpot = (org, f, ext) => ({
  segments: ['Faculty', orgFolder(org), safeSegment(f.employeeId, 'employee')],
  localFolder: facultyFolder(org, f),
  fileName: `photo${ext}`,
});

// Remove whatever file backs a photo — but never a Drive file the user merely linked.
const dropPhoto = async (photo) => {
  if (!photo) return;
  if (photo.driveFileId && !photo.linked) await deleteDriveFile(photo.driveFileId);
  else if (photo.publicId) await deleteFile(photo.publicId);
};

// Store an uploaded image for this person (replacing their current one) and set doc.photo.
const storePhoto = async (doc, file, spot) => {
  const ext = normExt(file.originalname);
  const old = doc.photo;
  if (useDrive()) {
    const folderId = await ensurePeopleFolder(spot.segments);
    const id = await uploadPersonPhoto(folderId, file.buffer, spot.fileName, file.mimetype);
    await dropPhoto(old);
    doc.photo = { ...driveLinks(id), driveFileId: id, publicId: '', ext, location: [...spot.segments, spot.fileName].join('/'), linked: false };
    return;
  }
  const stored = await uploadBuffer(file.buffer, { folder: spot.localFolder, originalName: file.originalname, exactName: spot.fileName });
  if (old?.publicId && old.publicId !== stored.publicId) await dropPhoto(old);
  doc.photo = { url: stored.url, publicId: stored.publicId, driveFileId: '', downloadUrl: '', viewUrl: '', ext, location: stored.publicId, linked: false };
};

// Attach a photo that already lives in Drive, by its share link.
const linkPhoto = async (doc, link, res) => {
  const id = driveFileIdFromLink(link);
  if (!id) { res.status(400); throw new Error('That does not look like a Google Drive file link. Share the photo with "anyone with the link" and paste its link.'); }
  const old = doc.photo;
  doc.photo = { ...driveLinks(id), driveFileId: id, publicId: '', ext: '', location: '', linked: true };
  await dropPhoto(old);
};

// If the college/year/branch/roll number changed, move the photo to match.
const relocatePhoto = async (doc, spotFor) => {
  const p = doc.photo;
  if (!p?.url || p.linked) return;
  const ext = p.ext || path.extname(p.publicId || '') || '.jpg';
  const spot = spotFor(ext);
  if (p.driveFileId) {
    const location = [...spot.segments, spot.fileName].join('/');
    if (p.location === location) return;
    const folderId = await ensurePeopleFolder(spot.segments);
    await moveDriveFile(p.driveFileId, folderId, spot.fileName);
    doc.photo = { ...(p.toObject ? p.toObject() : p), location };
    return;
  }
  if (p.publicId) {
    const moved = moveStoredFile(p.publicId, spot.localFolder, spot.fileName);
    if (moved) doc.photo = { ...(p.toObject ? p.toObject() : p), url: moved.url, publicId: moved.publicId, location: moved.publicId };
  }
};

const attachStudentPhoto = (student, org, file) => storePhoto(student, file, studentSpot(org, student, normExt(file.originalname)));
const relocateStudentPhoto = (student, org) => relocatePhoto(student, (ext) => studentSpot(org, student, ext));

const studentQuery = (req) => {
  const { orgIds, completeOnly } = readScope(req);
  const q = {};
  if (orgIds !== null) q.organization = { $in: orgIds };
  const year = parseYear(req.query.year);
  if (year) q.passOutYear = year;
  if (req.query.branch) q.branch = clean(req.query.branch).toUpperCase();
  const and = [];
  if (req.query.q) {
    const rx = new RegExp(escapeRegex(clean(req.query.q)), 'i');
    and.push({ $or: [{ name: rx }, { rollNo: rx }] });
  }
  if (completeOnly) and.push({ 'photo.url': { $ne: '' }, name: { $ne: '' } });
  else if (req.query.status === 'incomplete') and.push({ $or: [{ 'photo.url': '' }, { name: '' }, { passOutYear: null }, { branch: '' }] });
  if (and.length) q.$and = and;
  return { q, orgIds, completeOnly };
};

// @route GET /api/people-data/students?organizationId&year&branch&q&status&page&limit
export const listStudents = asyncHandler(async (req, res) => {
  const { q, orgIds, completeOnly } = studentQuery(req);
  const page = Math.max(1, parseInt(req.query.page, 10) || 1);
  const limit = Math.min(200, Math.max(1, parseInt(req.query.limit, 10) || 60));

  const [items, total, years, branches, incomplete] = await Promise.all([
    Student.find(q).populate('organization', 'name').sort({ passOutYear: -1, branch: 1, rollNo: 1 }).skip((page - 1) * limit).limit(limit).lean(),
    Student.countDocuments(q),
    Student.distinct('passOutYear', orgIds === null ? {} : { organization: { $in: orgIds } }),
    Student.distinct('branch', orgIds === null ? {} : { organization: { $in: orgIds } }),
    completeOnly ? 0 : Student.countDocuments({
      ...(orgIds === null ? {} : { organization: { $in: orgIds } }),
      $or: [{ 'photo.url': '' }, { name: '' }, { passOutYear: null }, { branch: '' }],
    }),
  ]);

  res.json({
    success: true,
    items: items.map((s) => ({ ...publicStudent(s), organization: s.organization })),
    total, page, limit,
    facets: { years: years.filter(Boolean).sort((a, b) => b - a), branches: branches.filter(Boolean).sort() },
    incompleteCount: incomplete,
    canEdit: canWrite(req.user),
  });
});

const applyStudentFields = (student, body) => {
  if (body.name !== undefined) student.name = clean(body.name);
  if (body.passOutYear !== undefined) student.passOutYear = parseYear(body.passOutYear);
  if (body.branch !== undefined) student.branch = clean(body.branch).toUpperCase();
  if (body.section !== undefined) student.section = clean(body.section);
  if (body.phone !== undefined) student.phone = clean(body.phone);
  if (body.email !== undefined) student.email = clean(body.email);
  if (body.guardianPhone !== undefined) student.guardianPhone = clean(body.guardianPhone);
};

// @route POST /api/people-data/students  (multipart: optional photo + fields)
export const createStudent = asyncHandler(async (req, res) => {
  requireWriter(req, res);
  const org = await writeOrgFor(req, res);
  const rollNo = clean(req.body.rollNo).toUpperCase();
  if (!rollNo) { res.status(400); throw new Error('Roll number is required'); }
  if (req.file && !isImage(req.file)) { res.status(400); throw new Error('The photo must be a JPG, PNG or WEBP image'); }
  if (req.file) requireDrive(res);
  if (await Student.exists({ organization: org._id, rollNo })) {
    res.status(409); throw new Error(`${rollNo} already exists for ${org.name} — edit that student instead`);
  }
  const student = new Student({ organization: org._id, rollNo, createdBy: req.user._id });
  applyStudentFields(student, req.body);
  if (req.file) await attachStudentPhoto(student, org, req.file);
  else if (clean(req.body.photoLink)) await linkPhoto(student, req.body.photoLink, res);
  await student.save();
  res.status(201).json({ success: true, student: publicStudent(student) });
});

const loadStudent = async (req, res) => {
  const student = await Student.findById(req.params.id);
  if (!student) { res.status(404); throw new Error('Student not found'); }
  if (!canAccessOrg(req.user, student.organization)) { res.status(404); throw new Error('Student not found'); }
  const org = await Organization.findById(student.organization).select('_id name');
  return { student, org };
};

// @route PUT /api/people-data/students/:id
export const updateStudent = asyncHandler(async (req, res) => {
  requireWriter(req, res);
  const { student, org } = await loadStudent(req, res);
  if (req.file && !isImage(req.file)) { res.status(400); throw new Error('The photo must be a JPG, PNG or WEBP image'); }
  if (req.body.rollNo !== undefined && clean(req.body.rollNo).toUpperCase() !== student.rollNo) {
    const next = clean(req.body.rollNo).toUpperCase();
    if (!next) { res.status(400); throw new Error('Roll number cannot be empty'); }
    if (await Student.exists({ organization: org._id, rollNo: next, _id: { $ne: student._id } })) {
      res.status(409); throw new Error(`${next} already exists for ${org.name}`);
    }
    student.rollNo = next;
  }
  applyStudentFields(student, req.body);
  if (req.file) { requireDrive(res); await attachStudentPhoto(student, org, req.file); }
  else if (clean(req.body.photoLink)) await linkPhoto(student, req.body.photoLink, res);
  else await relocateStudentPhoto(student, org);
  await student.save();
  res.json({ success: true, student: publicStudent(student) });
});

// @route DELETE /api/people-data/students/:id
export const deleteStudent = asyncHandler(async (req, res) => {
  requireWriter(req, res);
  const { student } = await loadStudent(req, res);
  await dropPhoto(student.photo);
  await student.deleteOne();
  res.json({ success: true, id: req.params.id });
});

// @route POST /api/people-data/students/photos  (multipart: photos[] named by roll no)
// body: organization, passOutYear, branch, overwrite. A photo for a roll number
// that is not on file yet creates the student with just the photo, so it shows
// up under "needs attention" until its details arrive.
export const uploadStudentPhotos = asyncHandler(async (req, res) => {
  requireWriter(req, res);
  const org = await writeOrgFor(req, res);
  const files = req.files || [];
  if (!files.length) { res.status(400); throw new Error('Choose at least one photo'); }
  requireDrive(res);
  const year = parseYear(req.body.passOutYear);
  const branch = clean(req.body.branch).toUpperCase();
  const overwrite = req.body.overwrite === 'true' || req.body.overwrite === true;

  const result = { attached: 0, replaced: 0, created: 0, skipped: [], failed: [] };
  for (const file of files) {
    const rollNo = path.basename(file.originalname, path.extname(file.originalname)).trim().toUpperCase();
    try {
      if (!isImage(file)) { result.failed.push({ file: file.originalname, reason: 'Not a JPG, PNG or WEBP image' }); continue; }
      if (!rollNo) { result.failed.push({ file: file.originalname, reason: 'No roll number in the file name' }); continue; }
      let student = await Student.findOne({ organization: org._id, rollNo });
      if (student) {
        if (student.photo?.url && !overwrite) { result.skipped.push({ file: file.originalname, reason: 'Already has a photo' }); continue; }
        const had = !!student.photo?.url;
        if (!student.passOutYear && year) student.passOutYear = year;
        if (!student.branch && branch) student.branch = branch;
        await attachStudentPhoto(student, org, file);
        await student.save();
        if (had) result.replaced += 1; else result.attached += 1;
      } else {
        if (!year || !branch) { result.failed.push({ file: file.originalname, reason: 'New roll number — choose the pass-out year and branch first' }); continue; }
        student = new Student({ organization: org._id, rollNo, passOutYear: year, branch, createdBy: req.user._id });
        await attachStudentPhoto(student, org, file);
        await student.save();
        result.created += 1;
      }
    } catch (e) {
      result.failed.push({ file: file.originalname, reason: e.message || 'Could not save' });
    }
  }
  res.json({ success: true, ...result });
});

// @route POST /api/people-data/students/import  (multipart: file)
// body: organization, passOutYear, branch — used for rows that leave them blank.
export const importStudents = asyncHandler(async (req, res) => {
  requireWriter(req, res);
  const org = await writeOrgFor(req, res);
  if (!req.file) { res.status(400); throw new Error('No Excel file uploaded'); }
  let grid;
  try { grid = await loadGrid(req.file); }
  catch { res.status(400); throw new Error('Could not read the file. Please upload a valid .xlsx Excel file.'); }

  const { headerRow, map } = findColumns(grid, [
    { field: 'guardianPhone', test: (h) => /guardian|parent|father|mother/.test(h) },
    { field: 'email', test: (h) => /mail/.test(h) },
    { field: 'phone', test: (h) => /phone|mobile|contact|cell/.test(h) },
    { field: 'rollNo', test: (h) => /roll|regd|regno|registration|admission|hallticket|studentid|^id$/.test(h) },
    { field: 'branch', test: (h) => /branch|department|dept|course|stream/.test(h) },
    { field: 'passOutYear', test: (h) => /year|batch|passout|passing/.test(h) },
    { field: 'section', test: (h) => /section|sec$/.test(h) },
    { field: 'name', test: (h) => /name/.test(h) },
  ], 'rollNo') || {};
  if (!map) { res.status(400); throw new Error('Could not find a Roll No column. Add a header row with a "Roll No" column.'); }

  const defaultYear = parseYear(req.body.passOutYear);
  const defaultBranch = clean(req.body.branch).toUpperCase();
  const at = (row, field) => (map[field] != null ? clean(cellText(row[map[field]])) : '');
  let created = 0; let updated = 0; const problems = [];

  for (let i = headerRow + 1; i < grid.length; i += 1) {
    const row = grid[i] || [];
    const rollNo = at(row, 'rollNo').toUpperCase();
    if (!rollNo) continue;
    let student = await Student.findOne({ organization: org._id, rollNo });
    const isNew = !student;
    if (isNew) student = new Student({ organization: org._id, rollNo, createdBy: req.user._id });
    // Only non-blank cells overwrite, so re-importing a partial sheet never wipes details.
    const fields = { name: at(row, 'name'), section: at(row, 'section'), phone: at(row, 'phone'), email: at(row, 'email'), guardianPhone: at(row, 'guardianPhone') };
    Object.entries(fields).forEach(([k, v]) => { if (v) student[k] = v; });
    const year = parseYear(at(row, 'passOutYear')) || defaultYear;
    if (year) student.passOutYear = year;
    const branch = (at(row, 'branch') || defaultBranch).toUpperCase();
    if (branch) student.branch = branch;
    if (isNew && (!student.passOutYear || !student.branch)) { problems.push(`${rollNo}: missing pass-out year or branch`); continue; }
    await relocateStudentPhoto(student, org);
    await student.save();
    if (isNew) created += 1; else updated += 1;
  }
  if (!created && !updated) { res.status(400); throw new Error(problems[0] || 'No student rows found under the header.'); }
  res.json({ success: true, created, updated, problems: problems.slice(0, 20) });
});

const sendTemplate = async (res, sheetName, columns, example, fileName) => {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet(sheetName);
  ws.columns = columns;
  const head = ws.getRow(1);
  head.font = { bold: true, color: { argb: 'FFFFFFFF' } };
  head.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF0B2350' } };
  head.height = 22;
  ws.addRow(example);
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
  await wb.xlsx.write(res);
  res.end();
};

export const studentTemplate = asyncHandler(async (req, res) => sendTemplate(res, 'Students', [
  { header: 'Roll No', key: 'rollNo', width: 18 },
  { header: 'Full Name', key: 'name', width: 28 },
  { header: 'Branch', key: 'branch', width: 12 },
  { header: 'Pass-out Year', key: 'year', width: 14 },
  { header: 'Section', key: 'section', width: 10 },
  { header: 'Mobile', key: 'phone', width: 16 },
  { header: 'Email', key: 'email', width: 26 },
  { header: 'Guardian Mobile', key: 'guardian', width: 18 },
], { rollNo: '21A91A0501', name: 'A. Sample Student', branch: 'CSE', year: 2025, section: 'A', phone: '', email: '', guardian: '' }, 'students-template.xlsx'));

// ---------- faculty ----------
const facultyFolder = (org, f) => path.posix.join('people-data', 'faculty', orgFolder(org), safeSegment(f.employeeId, 'employee'));

const publicFaculty = (f) => ({
  _id: f._id,
  organization: f.organization,
  employeeId: f.employeeId,
  name: f.name,
  degree: f.degree,
  designation: f.designation,
  department: f.department,
  phone: f.phone,
  email: f.email,
  photoUrl: f.photo?.url || '',
  downloadUrl: f.photo?.downloadUrl || f.photo?.url || '',
  hasPhoto: !!f.photo?.url,
  hasDetails: !!(f.name && f.designation),
  updatedAt: f.updatedAt,
});

const attachFacultyPhoto = (person, org, file) => storePhoto(person, file, facultySpot(org, person, normExt(file.originalname)));

// @route GET /api/people-data/faculty?organizationId&q&status&page&limit
export const listFaculty = asyncHandler(async (req, res) => {
  const { orgIds, completeOnly } = readScope(req);
  const q = {};
  if (orgIds !== null) q.organization = { $in: orgIds };
  const and = [];
  if (req.query.q) {
    const rx = new RegExp(escapeRegex(clean(req.query.q)), 'i');
    and.push({ $or: [{ name: rx }, { employeeId: rx }, { designation: rx }, { department: rx }] });
  }
  if (completeOnly) and.push({ 'photo.url': { $ne: '' }, name: { $ne: '' } });
  else if (req.query.status === 'incomplete') and.push({ $or: [{ 'photo.url': '' }, { name: '' }, { designation: '' }] });
  if (and.length) q.$and = and;

  const page = Math.max(1, parseInt(req.query.page, 10) || 1);
  const limit = Math.min(200, Math.max(1, parseInt(req.query.limit, 10) || 60));
  const base = orgIds === null ? {} : { organization: { $in: orgIds } };
  const [items, total, incomplete] = await Promise.all([
    Faculty.find(q).populate('organization', 'name').sort({ name: 1, employeeId: 1 }).skip((page - 1) * limit).limit(limit).lean(),
    Faculty.countDocuments(q),
    completeOnly ? 0 : Faculty.countDocuments({ ...base, $or: [{ 'photo.url': '' }, { name: '' }, { designation: '' }] }),
  ]);
  res.json({
    success: true,
    items: items.map((f) => ({ ...publicFaculty(f), organization: f.organization })),
    total, page, limit, incompleteCount: incomplete, canEdit: canWrite(req.user),
  });
});

const applyFacultyFields = (person, body) => {
  ['name', 'degree', 'designation', 'department', 'phone'].forEach((k) => { if (body[k] !== undefined) person[k] = clean(body[k]); });
  if (body.email !== undefined) person.email = clean(body.email);
};

// @route POST /api/people-data/faculty  (multipart: optional photo + fields)
export const createFaculty = asyncHandler(async (req, res) => {
  requireWriter(req, res);
  const org = await writeOrgFor(req, res);
  const employeeId = clean(req.body.employeeId).toUpperCase();
  if (!employeeId) { res.status(400); throw new Error('Employee ID is required'); }
  if (req.file && !isImage(req.file)) { res.status(400); throw new Error('The photo must be a JPG, PNG or WEBP image'); }
  if (req.file) requireDrive(res);
  if (await Faculty.exists({ organization: org._id, employeeId })) {
    res.status(409); throw new Error(`${employeeId} already exists for ${org.name} — edit that person instead`);
  }
  const person = new Faculty({ organization: org._id, employeeId, createdBy: req.user._id });
  applyFacultyFields(person, req.body);
  if (req.file) await attachFacultyPhoto(person, org, req.file);
  else if (clean(req.body.photoLink)) await linkPhoto(person, req.body.photoLink, res);
  await person.save();
  res.status(201).json({ success: true, faculty: publicFaculty(person) });
});

const loadFaculty = async (req, res) => {
  const person = await Faculty.findById(req.params.id);
  if (!person || !canAccessOrg(req.user, person.organization)) { res.status(404); throw new Error('Faculty member not found'); }
  const org = await Organization.findById(person.organization).select('_id name');
  return { person, org };
};

// @route PUT /api/people-data/faculty/:id   (the employee ID itself is fixed — it names the folder)
export const updateFaculty = asyncHandler(async (req, res) => {
  requireWriter(req, res);
  const { person, org } = await loadFaculty(req, res);
  if (req.file && !isImage(req.file)) { res.status(400); throw new Error('The photo must be a JPG, PNG or WEBP image'); }
  applyFacultyFields(person, req.body);
  if (req.file) { requireDrive(res); await attachFacultyPhoto(person, org, req.file); }
  else if (clean(req.body.photoLink)) await linkPhoto(person, req.body.photoLink, res);
  await person.save();
  res.json({ success: true, faculty: publicFaculty(person) });
});

// @route DELETE /api/people-data/faculty/:id
export const deleteFaculty = asyncHandler(async (req, res) => {
  requireWriter(req, res);
  const { person } = await loadFaculty(req, res);
  await dropPhoto(person.photo);
  await person.deleteOne();
  res.json({ success: true, id: req.params.id });
});

// @route POST /api/people-data/faculty/import  (multipart: file; body: organization)
export const importFaculty = asyncHandler(async (req, res) => {
  requireWriter(req, res);
  const org = await writeOrgFor(req, res);
  if (!req.file) { res.status(400); throw new Error('No Excel file uploaded'); }
  let grid;
  try { grid = await loadGrid(req.file); }
  catch { res.status(400); throw new Error('Could not read the file. Please upload a valid .xlsx Excel file.'); }

  const found = findColumns(grid, [
    { field: 'email', test: (h) => /mail/.test(h) },
    { field: 'phone', test: (h) => /phone|mobile|contact|cell/.test(h) },
    { field: 'employeeId', test: (h) => /emp|staff|^id$/.test(h) && !/name|designation/.test(h) },
    { field: 'degree', test: (h) => /degree|qualification/.test(h) },
    { field: 'designation', test: (h) => /designation|position|role|title/.test(h) },
    { field: 'department', test: (h) => /department|dept|branch/.test(h) },
    { field: 'name', test: (h) => /name/.test(h) },
  ], 'employeeId');
  if (!found?.map) { res.status(400); throw new Error('Could not find an Employee ID column. Add a header row with an "Employee ID" column.'); }
  const { headerRow, map } = found;
  const at = (row, field) => (map[field] != null ? clean(cellText(row[map[field]])) : '');
  let created = 0; let updated = 0;

  for (let i = headerRow + 1; i < grid.length; i += 1) {
    const row = grid[i] || [];
    const employeeId = at(row, 'employeeId').toUpperCase();
    if (!employeeId) continue;
    let person = await Faculty.findOne({ organization: org._id, employeeId });
    const isNew = !person;
    if (isNew) person = new Faculty({ organization: org._id, employeeId, createdBy: req.user._id });
    ['name', 'degree', 'designation', 'department', 'phone', 'email'].forEach((k) => { const v = at(row, k); if (v) person[k] = v; });
    await person.save();
    if (isNew) created += 1; else updated += 1;
  }
  if (!created && !updated) { res.status(400); throw new Error('No faculty rows found under the header.'); }
  res.json({ success: true, created, updated });
});

export const facultyTemplate = asyncHandler(async (req, res) => sendTemplate(res, 'Faculty', [
  { header: 'Employee ID', key: 'employeeId', width: 16 },
  { header: 'Full Name', key: 'name', width: 28 },
  { header: 'Degree', key: 'degree', width: 22 },
  { header: 'Designation', key: 'designation', width: 24 },
  { header: 'Department', key: 'department', width: 18 },
  { header: 'Mobile', key: 'phone', width: 16 },
  { header: 'Email', key: 'email', width: 26 },
], { employeeId: 'EMP1042', name: 'Dr. Sample Name', degree: 'M.Tech, Ph.D', designation: 'Associate Professor', department: 'CSE', phone: '', email: '' }, 'faculty-template.xlsx'));
