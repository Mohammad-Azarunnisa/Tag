import mongoose from 'mongoose';

// One student of one college. The photo lives on the storage volume at
//   people-data/students/<college>/<pass-out year>/<branch>/<roll no>.<ext>
// (see controllers/peopleDataController.js); everything else about the student
// lives here, tied to the photo by roll number.
const studentSchema = new mongoose.Schema(
  {
    organization: { type: mongoose.Schema.Types.ObjectId, ref: 'Organization', required: true, index: true },
    rollNo: { type: String, required: true, trim: true, uppercase: true },
    name: { type: String, default: '', trim: true },
    passOutYear: { type: Number, default: null, index: true },
    branch: { type: String, default: '', trim: true, uppercase: true },
    section: { type: String, default: '', trim: true },
    phone: { type: String, default: '', trim: true },
    email: { type: String, default: '', trim: true, lowercase: true },
    guardianPhone: { type: String, default: '', trim: true },
    photo: {
      url: { type: String, default: '' },
      publicId: { type: String, default: '' },
      // Google Drive photos: the file id, links a browser can use, and the
      // folder/name it was filed under (so a move is only made when it changes).
      driveFileId: { type: String, default: '' },
      downloadUrl: { type: String, default: '' },
      viewUrl: { type: String, default: '' },
      ext: { type: String, default: '' },
      location: { type: String, default: '' },
      // A photo pasted in as a Drive link: it is not ours to move or delete.
      linked: { type: Boolean, default: false },
    },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true }
);

// A roll number is unique within a college, not across the group.
studentSchema.index({ organization: 1, rollNo: 1 }, { unique: true });
studentSchema.index({ organization: 1, passOutYear: 1, branch: 1 });

export default mongoose.model('Student', studentSchema);
