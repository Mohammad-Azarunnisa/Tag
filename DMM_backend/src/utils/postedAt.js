/**
 * When did it actually go out?
 *
 * "Mark as posted" used to mean "posted this second", because the server stamped
 * `new Date()` and never asked. That is wrong for the common case of recording
 * work that already happened: a handler catching up on a week of posts would
 * have every one of them dated the afternoon they did the data entry, which
 * moves the whole set into the wrong month for the calendar and the reports.
 *
 * So the client may name the moment, and this is the single place that decides
 * whether the named moment is allowed. Kept as a returned error rather than a
 * thrown one because the controllers set the HTTP status on `res` before
 * throwing (see middleware/error.js), which a util has no business doing.
 *
 * Returns { when } on success, { error } on refusal.
 */

// Clock skew between the user's browser and the server is normally seconds; a
// minute of slack stops "now" from being rejected as the future.
const FUTURE_SLACK_MS = 60_000;

// A back-date is for catching up on real posts, so it has to reach back a good
// way — but not to year 0206. This floor is what turns a mistyped year into a
// clear message instead of a row that quietly breaks every date-ordered report.
const MAX_BACKDATE_MS = 5 * 365 * 24 * 60 * 60 * 1000;

export function resolvePostedAt(raw) {
  if (!raw) return { when: new Date() };

  const when = new Date(raw);
  if (Number.isNaN(when.getTime())) {
    return { error: 'That is not a valid date and time' };
  }
  if (when.getTime() > Date.now() + FUTURE_SLACK_MS) {
    return { error: 'That moment is in the future — to book a post ahead of time, choose the scheduled option instead' };
  }
  if (when.getTime() < Date.now() - MAX_BACKDATE_MS) {
    return { error: 'That date is more than five years ago — check the year' };
  }
  return { when };
}
