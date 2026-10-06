import mongoose from 'mongoose';
import { PHOTOGRAPHER_SLOTS } from '../config/constants.js';

// One booking of a photographer for a fixed block of a single day. The
// photographer pool is shared across every college (see photographerController
// #listPhotographers) — any coordinator or admin can book any active
// photographer, and the photographer can also book themselves (e.g. an event
// they already know they're covering).
//
// `date` is a plain 'YYYY-MM-DD' key rather than a Date — a slot belongs to a
// calendar day, not a timestamp, and string equality sidesteps timezone drift
// entirely when checking "is this photographer already booked that day".
const photographerSlotSchema = new mongoose.Schema(
  {
    photographer: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    date: { type: String, required: true, index: true },
    slot: { type: String, enum: PHOTOGRAPHER_SLOTS, required: true },
    // The college this booking is FOR — shown to anyone else who tries to book
    // the same photographer, so "occupied" reads as "occupied by NCET" rather
    // than a bare refusal.
    organization: { type: mongoose.Schema.Types.ObjectId, ref: 'Organization', required: true, index: true },
    eventName: { type: String, required: true, trim: true },
    notes: { type: String, default: '' },
    bookedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  },
  { timestamps: true }
);

photographerSlotSchema.index({ photographer: 1, date: 1 });

const PhotographerSlot = mongoose.model('PhotographerSlot', photographerSlotSchema);
export default PhotographerSlot;
