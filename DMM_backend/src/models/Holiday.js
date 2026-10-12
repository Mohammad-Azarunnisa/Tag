import mongoose from 'mongoose';

// A day nobody works. Kept as a plain 'YYYY-MM-DD' (an India calendar day) so it
// means the same thing in every timezone. Shared by every college.
const holidaySchema = new mongoose.Schema(
  {
    date: { type: String, required: true, unique: true, match: /^\d{4}-\d{2}-\d{2}$/ },
    name: { type: String, required: true, trim: true },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true }
);

export default mongoose.model('Holiday', holidaySchema);
