import mongoose from 'mongoose';

// One faculty/trainer of one college. Their photo lives on the storage volume
// in a folder named after their employee ID:
//   people-data/faculty/<college>/<employee id>/photo.<ext>
const facultySchema = new mongoose.Schema(
  {
    organization: { type: mongoose.Schema.Types.ObjectId, ref: 'Organization', required: true, index: true },
    employeeId: { type: String, required: true, trim: true, uppercase: true },
    name: { type: String, default: '', trim: true },
    degree: { type: String, default: '', trim: true },
    designation: { type: String, default: '', trim: true },
    department: { type: String, default: '', trim: true },
    phone: { type: String, default: '', trim: true },
    email: { type: String, default: '', trim: true, lowercase: true },
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

facultySchema.index({ organization: 1, employeeId: 1 }, { unique: true });

export default mongoose.model('Faculty', facultySchema);
