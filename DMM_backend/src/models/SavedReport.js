import mongoose from 'mongoose';

// A B&M report PDF the super admin has already generated, kept so asking for the same
// report again opens this copy rather than building a new one.
//
// The file is held here (not on the public /uploads route) because the report is the whole
// group's figures: it is only ever served through an authenticated super-admin request.
// A report is a few hundred KB, far under Mongo's 16MB document limit.
//
// `key` is the report's identity — the day window, the college and the platform. The same
// key is the same report. A window that was still running when it was made ends on that
// day (e.g. "This Month" on 7 Nov is 1–7 Nov), so tomorrow's request is a different key and
// builds afresh; a finished month stays the same key and keeps opening this copy.
const savedReportSchema = new mongoose.Schema(
  {
    key: { type: String, required: true, unique: true, index: true },
    from: { type: String, required: true }, // 'YYYY-MM-DD'
    to: { type: String, required: true },
    organization: { type: mongoose.Schema.Types.ObjectId, ref: 'Organization', default: null },
    organizationLabel: { type: String, default: 'All Organisations' },
    platform: { type: String, default: '' }, // '' = all social media
    // 'YYYY-MM' when the window is exactly one calendar month — the monthly archive lists these.
    month: { type: String, default: null, index: true },
    // Built by the schedule rather than requested by a person.
    automatic: { type: Boolean, default: false },
    filename: { type: String, required: true },
    size: { type: Number, default: 0 },
    // The period was still open when this copy was made (it ended on the day it was generated),
    // so the figures may have moved since.
    partialPeriod: { type: Boolean, default: false },
    generatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    generatedByName: { type: String, default: '' },
    pdf: { type: Buffer, required: true, select: false },
  },
  { timestamps: true }
);

savedReportSchema.index({ updatedAt: -1 });

export const reportKey = ({ from, to, orgId, platform }) => `${from}|${to}|${orgId || 'all'}|${platform || 'all'}`;

const SavedReport = mongoose.model('SavedReport', savedReportSchema);
export default SavedReport;
