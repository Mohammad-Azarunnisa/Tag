import mongoose from 'mongoose';

// A designer's own entry on their Design Calendar — work done outside t@g (a
// banner printed on the spot, a quick edit someone asked for in person…). Kept
// apart from the approved designs on purpose: nobody approved it here, so it is
// the designer's word, shown differently and only to them.
const designerNoteSchema = new mongoose.Schema(
  {
    designer: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    // An India calendar day, 'YYYY-MM-DD'.
    date: { type: String, required: true, match: /^\d{4}-\d{2}-\d{2}$/, index: true },
    title: { type: String, required: true, trim: true, maxlength: 160 },
    details: { type: String, default: '', trim: true, maxlength: 2000 },
    // Which college the work was for, if it matters.
    organization: { type: mongoose.Schema.Types.ObjectId, ref: 'Organization', default: null },
  },
  { timestamps: true }
);

designerNoteSchema.index({ designer: 1, date: 1 });

export default mongoose.model('DesignerNote', designerNoteSchema);
