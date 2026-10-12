import express from 'express';
import {
  listStudents, createStudent, updateStudent, deleteStudent, uploadStudentPhotos, importStudents, studentTemplate,
  listFaculty, createFaculty, updateFaculty, deleteFaculty, importFaculty, facultyTemplate,
} from '../controllers/peopleDataController.js';
import { protect } from '../middleware/auth.js';
import upload from '../middleware/upload.js';

const router = express.Router();
router.use(protect);

// Reads are open to every signed-in role (scoped by the controller); writes are
// checked there too — super admin, Admin and coordinator only.
router.get('/students', listStudents);
router.get('/students/template', studentTemplate);
router.post('/students/photos', upload.array('photos', 300), uploadStudentPhotos);
router.post('/students/import', upload.single('file'), importStudents);
router.post('/students', upload.single('photo'), createStudent);
router.put('/students/:id', upload.single('photo'), updateStudent);
router.delete('/students/:id', deleteStudent);

router.get('/faculty', listFaculty);
router.get('/faculty/template', facultyTemplate);
router.post('/faculty/import', upload.single('file'), importFaculty);
router.post('/faculty', upload.single('photo'), createFaculty);
router.put('/faculty/:id', upload.single('photo'), updateFaculty);
router.delete('/faculty/:id', deleteFaculty);

export default router;
