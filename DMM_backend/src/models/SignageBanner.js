import mongoose from 'mongoose';

// One banner mounted on a signage location for an event/campaign. Placing a new
// banner on an occupied stand automatically retires the previous one (status
// REMOVED + removedAt), so a location's banners double as its change history.
//
// Three optional files per banner:
//   • preview  — a JPG/PNG of the artwork (what the UI shows; browsers can't
//     render PSD/PDF, so this is the visual)
//   • source   — the print-ready design file (PSD / PDF / AI) for reprints/edits
//   • photo    — a real photo of the banner installed at the spot
const signageBannerSchema = new mongoose.Schema(
  {
    location: { type: mongoose.Schema.Types.ObjectId, ref: 'SignageLocation', required: true, index: true },
    title: { type: String, required: true, trim: true },

    // The event/campaign this banner was put up for. Free text, optionally
    // linked to an Event record when one exists.
    eventName: { type: String, default: '', trim: true },
    event: { type: mongoose.Schema.Types.ObjectId, ref: 'Event' },

    // Printed size — defaults to the location's fixed frame size.
    width: { type: Number, default: 0 },
    height: { type: Number, default: 0 },
    sizeUnit: { type: String, enum: ['ft', 'in', 'cm', 'm'], default: 'ft' },

    installedAt: { type: Date, default: Date.now },
    removedAt: { type: Date },
    status: { type: String, enum: ['ACTIVE', 'REMOVED'], default: 'ACTIVE' },

    preview: { type: String, default: '' },
    previewPublicId: { type: String, default: '' },
    source: { type: String, default: '' },
    sourcePublicId: { type: String, default: '' },
    sourceName: { type: String, default: '' }, // original filename, e.g. "admissions-2026.psd"
    photo: { type: String, default: '' },
    photoPublicId: { type: String, default: '' },

    notes: { type: String, default: '' },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true }
);

signageBannerSchema.index({ location: 1, installedAt: -1 });
signageBannerSchema.index({ status: 1 });

const SignageBanner = mongoose.model('SignageBanner', signageBannerSchema);
export default SignageBanner;
