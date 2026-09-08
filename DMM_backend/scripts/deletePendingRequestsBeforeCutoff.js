/**
 * One-off cleanup: remove InstitutionRequests that are still pending (status
 * OPEN — with the designers, unpicked or in progress) and were raised before a
 * cutoff date. Everything else is left untouched on purpose:
 *
 *   - APPROVED / DECLINED requests are already decided — done, not pending.
 *   - WITH_SOCIAL_HANDLER requests have moved past the designers onto posting —
 *     they are further along than "pending" means here, so they are kept.
 *   - IN_REVIEW / GETTING_ALLOCATED are legacy statuses no new request can
 *     reach; any that still exist predate this flow and are left as history.
 *
 * Safe by default: running it with no flags only COUNTS and PRINTS the matching
 * requests. Nothing is deleted unless you pass --confirm.
 *
 *   node scripts/deletePendingRequestsBeforeCutoff.js                 # dry run
 *   node scripts/deletePendingRequestsBeforeCutoff.js --confirm       # deletes
 *
 * Reads MONGO_URI from the environment the same way the app does (falls back
 * to the local default) — point it at the right database before running.
 */
import 'dotenv/config';
import mongoose from 'mongoose';
import InstitutionRequest from '../src/models/InstitutionRequest.js';

// "Before 31st August 2026" — local midnight on that day, so everything raised
// through the end of the 30th matches and the 31st itself does not.
const CUTOFF = new Date(2026, 7, 31); // month is 0-indexed: 7 = August

const confirm = process.argv.includes('--confirm');

const uri = process.env.MONGO_URI || 'mongodb://localhost:27017/dmm_platform';
await mongoose.connect(uri);
console.log(`Connected: ${mongoose.connection.host}/${mongoose.connection.name}`);

const query = { status: 'OPEN', createdAt: { $lt: CUTOFF } };

const matches = await InstitutionRequest.find(query)
  .select('title organization workType workCategory workItem createdAt raisedBy')
  .populate('organization', 'name')
  .populate('raisedBy', 'name')
  .sort({ createdAt: 1 })
  .lean();

console.log(`\nMatching pending requests raised before ${CUTOFF.toDateString()}: ${matches.length}\n`);
matches.forEach((r) => {
  const brief = [r.workType === 'DIGITAL_MEDIA' ? 'Digital' : 'Print', r.workCategory, r.workItem].filter(Boolean).join(' · ');
  console.log(`- ${r.createdAt.toISOString().slice(0, 10)}  ${r.organization?.name || 'Unknown college'}  "${r.title}"  (${brief})  raised by ${r.raisedBy?.name || 'unknown'}`);
});

if (!confirm) {
  console.log('\nDry run only — nothing was deleted. Re-run with --confirm to actually delete these.');
} else if (matches.length) {
  const result = await InstitutionRequest.deleteMany(query);
  console.log(`\nDeleted ${result.deletedCount} pending request(s).`);
} else {
  console.log('\nNothing to delete.');
}

await mongoose.connection.close();
