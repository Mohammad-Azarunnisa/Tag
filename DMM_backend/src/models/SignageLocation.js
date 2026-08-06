import mongoose from 'mongoose';
import { SIGNAGE_TYPES, SIGNAGE_LOCATION_STATUS } from '../config/constants.js';

// A fixed physical signage spot on campus — an iron stand, arch frame, foam-board
// mount or standee position. Locations are set up once with a code and the fixed
// size of the frame; the banners mounted on them over time live in the
// signageBanners collection and form each spot's change history.
const signageLocationSchema = new mongoose.Schema(
  {
    // Short identifier painted/known on campus, e.g. "MG-01", "BLK-A-02".
    code: { type: String, required: true, trim: true },
    // Where the stand physically is, e.g. "Main Gate", "Block A entrance".
    place: { type: String, required: true, trim: true },
    standType: { type: String, enum: SIGNAGE_TYPES, required: true },

    // Fixed frame size — banners printed for this spot must match it.
    width: { type: Number, default: 0 },
    height: { type: Number, default: 0 },
    sizeUnit: { type: String, enum: ['ft', 'in', 'cm', 'm'], default: 'ft' },

    // Optional photo of the stand/spot itself (helps new team members find it).
    photo: { type: String, default: '' },
    photoPublicId: { type: String, default: '' },

    // OCCUPIED/EMPTY follow automatically from banner placement/removal;
    // NEEDS_REPLACEMENT and DAMAGED are manual flags set from the UI.
    status: {
      type: String,
      enum: Object.values(SIGNAGE_LOCATION_STATUS),
      default: SIGNAGE_LOCATION_STATUS.EMPTY,
    },
    notes: { type: String, default: '' },

    // Which organization the spot belongs to (optional — many are college-wide).
    organization: { type: mongoose.Schema.Types.ObjectId, ref: 'Organization' },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true }
);

signageLocationSchema.index({ code: 1 });
signageLocationSchema.index({ organization: 1, standType: 1 });

const SignageLocation = mongoose.model('SignageLocation', signageLocationSchema);
export default SignageLocation;
