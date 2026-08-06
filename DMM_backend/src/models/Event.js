import mongoose from 'mongoose';

// A college/marketing event captured by the Zolo team. Photos are pushed
// straight into a Drive folder created for this event (see services/googleDrive.js);
// folderLink is that folder's share link, kept here so the "open photos" button
// doesn't need a Drive round-trip.
const eventSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    description: { type: String, default: '' },
    driveFolderId: { type: String, default: '' },
    folderLink: { type: String, default: '' },
    photos: [
      {
        driveFileId: { type: String, required: true },
        name: String,
        url: String,
        thumbnailUrl: String,
      },
    ],
    eventDate: { type: Date },
    location: { type: String, default: '' },
    // Which organization the event relates to (optional — many events are college-wide).
    organization: { type: mongoose.Schema.Types.ObjectId, ref: 'Organization' },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true }
);

eventSchema.index({ eventDate: -1, createdAt: -1 });

const Event = mongoose.model('Event', eventSchema);
export default Event;
