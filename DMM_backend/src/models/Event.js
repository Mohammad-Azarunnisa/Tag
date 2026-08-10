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
    // A photo location the organiser pastes in themselves — a Drive folder,
    // shared album, anything. When set it is what "Open in Drive" opens, and the
    // event does not need the Drive API at all (see controllers/eventController).
    link: { type: String, default: '' },
    // Optional single image used as the event's tile picture. Stored through the
    // app's own storage driver, not Drive, so it shows even when Drive is not
    // connected. Falls back to the first Drive photo, then to a placeholder.
    coverImage: { type: String, default: '' },
    coverImagePublicId: { type: String, default: '' },
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
