// Design turnaround rules, in one place.
//
//  1. Every design request has a minimum of 2 working days.
//  2. Working days are Monday to Saturday; Sundays and the holidays on the
//     holiday list never count.
//  3. The design type decides how big the job is — Basic, Medium or Heavy — and
//     with it the design time shown to the designer and the coordinator.
//
// Dates are handled as India calendar days ('YYYY-MM-DD'), whatever timezone the
// server runs in.

export const MIN_WORKING_DAYS = 2;
const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;

export const TIERS = {
  BASIC: { key: 'BASIC', label: 'Basic', time: '1–1.5 hrs', minHours: 1, maxHours: 1.5 },
  MEDIUM: { key: 'MEDIUM', label: 'Medium', time: '2–3 hrs', minHours: 2, maxHours: 3 },
  HEAVY: { key: 'HEAVY', label: 'Heavy', time: '1–2 full working days', minHours: 8, maxHours: 16 },
};

// Which design types are which. Anything not listed falls back to the keyword
// rules below and finally to Medium, so a newly added design type always gets a
// sensible class instead of none.
const BASIC = [
  'Posters', 'Digital Posters', 'Notice Boards', 'Event Passes', 'Tickets', 'Business Cards', 'Name Boards', 'Certificates',
  'Invitations', 'Digital Invitations', 'Social Media Posts', 'WhatsApp Creatives', 'Story Designs', 'Reels Covers',
  'YouTube Thumbnails', 'YouTube Community Posts', 'Web Banners', 'Email Banners', 'Event Countdown Screens',
  'Speaker Introduction Slides', 'Sponsor Slides', 'Welcome Screens', 'Thank You Screens', 'Event Schedules',
  'Examination Notifications', 'Results Announcements', 'Internship Announcements', 'Club Activity Promotions',
  'Scholarship Promotions', 'Fee Reminder Creatives', 'Student Achievement Posts', 'Faculty Achievement Posts',
  'Ranking & Accreditation Posts', 'GIF Animations', 'Lower Third Graphics',
];
const MEDIUM = [
  'Flyers', 'Digital Flyers', 'Banners (Indoor & Outdoor)', 'Standees', 'Roll-up Banners', 'Flex Designs',
  'Signage & Direction Boards', 'Stage Backdrops', 'Photo Booth Backdrops', 'LED Screen Designs (Events)', 'LED Screen Content',
  'Website Sliders/Hero Banners', 'Email Newsletter Designs', 'Academic Content', 'Admission Campaign Creatives',
  'Open House Promotions', 'Campus Tour Graphics', 'Alumni Success Stories', 'Placement Success Creatives',
  'Animated Social Media Posts', 'Motion Posters', 'LED Animations',
];
const HEAVY = [
  'Brochures', 'Digital Brochures', 'Magazine Layouts', 'Newsletters', 'Department Handbooks', 'Student Diaries',
  'Event Promo Videos', 'Intro & Outro Videos',
];

const norm = (s) => String(s || '').trim().toLowerCase();
const index = new Map();
BASIC.forEach((n) => index.set(norm(n), 'BASIC'));
MEDIUM.forEach((n) => index.set(norm(n), 'MEDIUM'));
HEAVY.forEach((n) => index.set(norm(n), 'HEAVY'));

export const classifyDesign = ({ workItem = '', workCategory = '' } = {}) => {
  const item = norm(workItem);
  let key = index.get(item);
  if (!key) {
    if (/brochure|magazine|handbook|diary|prospectus|annual report|video|newsletter$/.test(item)) key = 'HEAVY';
    else if (/poster|post\b|story|thumbnail|card|pass|ticket|certificate|invitation|slide|screen|announcement|notification|thumbnail/.test(item)) key = 'BASIC';
    else if (norm(workCategory) === 'motion graphics') key = 'HEAVY';
    else key = 'MEDIUM';
  }
  return TIERS[key];
};

// ---- working-day arithmetic ----
export const istDateKey = (d) => new Date(new Date(d).getTime() + IST_OFFSET_MS).toISOString().slice(0, 10);
const parseKey = (key) => new Date(`${key}T00:00:00.000Z`);
const addDaysKey = (key, n) => new Date(parseKey(key).getTime() + n * 86400000).toISOString().slice(0, 10);
const isSunday = (key) => parseKey(key).getUTCDay() === 0;

/** Is this day a working day? `holidays` is a Set of 'YYYY-MM-DD'. */
export const isWorkingDay = (key, holidays = new Set()) => !isSunday(key) && !holidays.has(key);

/** The date `count` working days after `fromKey` (the starting day itself is not counted). */
export const addWorkingDays = (fromKey, count, holidays = new Set()) => {
  let key = fromKey;
  let left = count;
  while (left > 0) {
    key = addDaysKey(key, 1);
    if (isWorkingDay(key, holidays)) left -= 1;
  }
  return key;
};

/** Working days from `fromKey` (exclusive) up to and including `toKey`. */
export const workingDaysBetween = (fromKey, toKey, holidays = new Set()) => {
  let n = 0;
  for (let key = addDaysKey(fromKey, 1); key <= toKey; key = addDaysKey(key, 1)) if (isWorkingDay(key, holidays)) n += 1;
  return n;
};

/**
 * Everything the portal tells someone about a design: its class, how long the
 * design itself takes, and the earliest date it can be expected.
 */
export const planDesign = ({ workItem, workCategory, raisedAt = new Date(), holidays = new Set() }) => {
  const tier = classifyDesign({ workItem, workCategory });
  const raisedKey = istDateKey(raisedAt);
  // The two working days of design start on the first working day. A request raised on a
  // Sunday or a holiday does not start until the next working day, so that day is day zero
  // (raised on Sunday with Mon–Wed off, the days to design are Thu and Fri, and the
  // earliest delivery is the Saturday after) rather than being counted as day one.
  let startKey = raisedKey;
  while (!isWorkingDay(startKey, holidays)) startKey = addDaysKey(startKey, 1);
  const earliestKey = addWorkingDays(startKey, MIN_WORKING_DAYS, holidays);
  return {
    tier: tier.key,
    tierLabel: tier.label,
    designTime: tier.time,
    minWorkingDays: MIN_WORKING_DAYS,
    raisedOn: raisedKey,
    earliestDelivery: earliestKey,
  };
};
