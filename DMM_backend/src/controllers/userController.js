import asyncHandler from 'express-async-handler';
import User from '../models/User.js';
import Organization from '../models/Organization.js';
import ProfileUpdateRequest from '../models/ProfileUpdateRequest.js';
import { uploadBuffer, deleteFile } from '../config/storage.js';
import { accessibleOrgIds } from '../utils/org.js';
import { escapeRegex } from '../utils/sheet.js';
import { logActivity } from '../utils/logActivity.js';
import { resolveJobTitle } from '../utils/jobTitle.js';
import { createNotification } from '../utils/notify.js';
import { sendEmail } from '../utils/email.js';
import { ROLES, USER_TYPES, ACTIVITY_ACTIONS, NOTIFICATION_TYPES } from '../config/constants.js';

const sanitize = (u) => ({
  _id: u._id,
  name: u.name,
  email: u.email,
  role: u.role,
  userType: u.userType || null,
  isSuperAdmin: !!u.isSuperAdmin,
  viewOnly: !!u.viewOnly,
  avatar: u.avatar,
  jobTitle: u.jobTitle,
  phone: u.phone || '',
  linkedinUrl: u.linkedinUrl || '',
  skills: u.skills || [],
  tools: u.tools || [],
  handles: u.handles || [],
  profileCompletedAt: u.profileCompletedAt || null,
  isActive: u.isActive,
  settings: u.settings,
  organization: u.organization || null,
  // The extra institutions an Admin was granted (empty for other roles).
  managedOrganizations: u.managedOrganizations || [],
  createdAt: u.createdAt,
});

// ADMIN is global; CEO/USER must belong to an organization — except a
// Photographer, a shared resource who works across every college rather than
// belonging to one, the same as an ADMIN in that one respect.
const roleNeedsOrg = (role, userType) => role === ROLES.CEO || (role === ROLES.USER && userType !== USER_TYPES.PHOTOGRAPHER);

// Multipart form fields always arrive as strings, so an org the client meant to
// leave empty can show up as the text "null" — which would CastError if it ever
// reached findById.
const orgIdOf = (raw) => {
  const v = String(raw ?? '').trim();
  return !v || v === 'null' || v === 'undefined' ? null : v;
};

// A profile picture has to actually be a picture: the shared uploader also
// accepts video and documents, which would render as a broken avatar. SVG is
// left out on purpose — it can carry script, and avatars are shown inline.
const AVATAR_EXTENSION = /\.(png|jpe?g|webp|gif)$/i;
const uploadAvatar = async (file, res) => {
  const okMime = /^image\/(png|jpe?g|webp|gif)$/i.test(file.mimetype || '');
  if (!okMime && !AVATAR_EXTENSION.test(file.originalname || '')) {
    res.status(400);
    throw new Error('The profile picture must be a PNG, JPG, WEBP or GIF image');
  }
  const { url, publicId } = await uploadBuffer(file.buffer, {
    folder: 'avatars',
    originalName: file.originalname,
  });
  return { avatar: url, avatarPublicId: publicId };
};

// Swap in a new picture and clean up the one it replaces, so old avatars don't
// accumulate in storage.
const replaceAvatar = async (user, file, res) => {
  const picture = await uploadAvatar(file, res);
  if (user.avatarPublicId) await deleteFile(user.avatarPublicId);
  user.avatar = picture.avatar;
  user.avatarPublicId = picture.avatarPublicId;
};

const normalizeUserType = (raw) => {
  if (!raw) return USER_TYPES.DESIGNER;
  return Object.values(USER_TYPES).includes(raw) ? raw : USER_TYPES.DESIGNER;
};

// Accept skills as an array or a comma/newline-separated string.
const parseSkills = (raw) => {
  if (!raw) return [];
  const arr = Array.isArray(raw) ? raw : String(raw).split(/[,\n]/);
  return arr.map((s) => String(s).trim()).filter(Boolean).slice(0, 30);
};

// The extra institutions put under an Admin. Accepts an array, a JSON string or
// a comma-separated list (multipart form fields can only carry text). Ids that
// don't resolve to a real organization are dropped rather than failing the whole
// save, and the Admin's own college is never duplicated in here.
const parseManagedOrgs = async (raw, primaryOrgId) => {
  let list = raw;
  if (typeof raw === 'string') {
    const text = raw.trim();
    if (!text) return [];
    try { list = JSON.parse(text); } catch { list = text.split(','); }
  }
  if (!Array.isArray(list)) return [];

  const out = [];
  const seen = new Set([String(primaryOrgId || '')]);
  for (const entry of list.slice(0, 50)) {
    const id = orgIdOf(entry?._id || entry);
    if (!id || seen.has(id)) continue;
    const org = await Organization.findById(id).select('_id');
    if (!org) continue;
    seen.add(id);
    out.push(org._id);
  }
  return out;
};

const parseHandles = async (raw) => {
  const arr = Array.isArray(raw)
    ? raw
    : typeof raw === 'string' && raw.trim()
      ? JSON.parse(raw)
      : [];
  if (!Array.isArray(arr)) return [];

  const clean = [];
  for (const h of arr.slice(0, 20)) {
    if (!h?.organization) continue;
    const org = await Organization.findById(h.organization).select('_id');
    if (!org) continue;
    const platforms = (Array.isArray(h.platforms) ? h.platforms : [])
      .map((p) => String(p).trim())
      .filter(Boolean)
      .slice(0, 10);
    if (platforms.length) clean.push({ organization: org._id, platforms });
  }
  return clean;
};

// ============================ ADMIN ============================

// @route GET /api/users/handlers?organizationId=&platform=  (ADMIN/CEO)
// Who can publish for an organization: social handlers whose profile handles
// declare that org (+ platform when given). `fallback` lists the org's OTHER
// active social handlers (who didn't declare this platform) so an approved
// design can still be allocated. Both lists are social handlers, so every
// entry is a valid allocation target for the design-approval flow.
export const listHandlers = asyncHandler(async (req, res) => {
  const { organizationId, platform } = req.query;
  if (!organizationId) { res.status(400); throw new Error('organizationId is required'); }
  const allowed = accessibleOrgIds(req.user);
  if (allowed !== null && !allowed.includes(String(organizationId))) { res.status(403); throw new Error('Not allowed'); }

  const elem = platform ? { organization: organizationId, platforms: platform } : { organization: organizationId };
  const handlers = await User.find({
    isActive: true,
    role: ROLES.USER,
    userType: USER_TYPES.SOCIAL_HANDLER,
    handles: { $elemMatch: elem },
  })
    .select('name email avatar role skills tools handles organization')
    .populate('organization', 'name color')
    .sort({ name: 1 })
    .lean();

  const matched = new Set(handlers.map((u) => String(u._id)));
  const fallback = await User.find({
    isActive: true,
    organization: organizationId,
    role: ROLES.USER,
    userType: USER_TYPES.SOCIAL_HANDLER,
  })
    .select('name email avatar role')
    .sort({ name: 1 })
    .lean()
    .then((users) => users.filter((u) => !matched.has(String(u._id))));

  res.json({ success: true, handlers, fallback });
});

// @route GET /api/users/designers  — active designers a coordinator can pick to
// work on a design brief. Central pool, not org-scoped (a designer serves any org).
export const listDesigners = asyncHandler(async (req, res) => {
  const designers = await User.find({ isActive: true, role: ROLES.USER, userType: USER_TYPES.DESIGNER })
    .select('name email avatar skills tools organization')
    .populate('organization', 'name color')
    .sort({ name: 1 })
    .lean();
  res.json({ success: true, designers });
});

/**
 * @route GET /api/users/directory — who you work with, and how to reach them.
 *
 * Everyone can see the people in their own college. A DESIGNER sees more,
 * because they are the one role that works across the whole network: briefs
 * reach them from any college's coordinator, so that coordinator's number is the
 * one they actually need. They also get the Admins over their college, who are
 * who you escalate to.
 *
 * The super admin is never listed — see getUsers; other logins are told one
 * exists and nothing more. Global oversight accounts (role ADMIN, e.g. the
 * Chairman) are not part of a college's people either, so they stay out too:
 * "Admin" here means the CEO who runs institutions.
 */
export const listDirectory = asyncHandler(async (req, res) => {
  const me = req.user;
  const ownOrg = me.organization?._id || me.organization || null;
  // A social handler can serve colleges they do not belong to, through `handles`
  // — those are their colleagues too.
  const handled = (me.handles || []).map((h) => h.organization).filter(Boolean);
  const myOrgs = [...new Set([ownOrg, ...handled].filter(Boolean).map(String))];

  const isDesigner = me.role === ROLES.USER && me.userType === USER_TYPES.DESIGNER;
  const clauses = [];
  // Everyone: the people of the colleges I belong to or serve.
  if (myOrgs.length) {
    clauses.push({ organization: { $in: myOrgs } }, { 'handles.organization': { $in: myOrgs } });
  }
  if (isDesigner) {
    // Every coordinator, whichever college — any of them can send this designer
    // a brief, and they need to be able to talk to whoever did.
    clauses.push({ role: ROLES.USER, userType: USER_TYPES.COORDINATOR });
    // And the Admins who hold their college, by either route.
    if (ownOrg) {
      clauses.push({ role: ROLES.CEO, $or: [{ organization: ownOrg }, { managedOrganizations: ownOrg }] });
    }
  }
  // An account attached to nothing would otherwise match everyone.
  if (!clauses.length) return res.json({ success: true, count: 0, people: [] });

  const query = {
    isActive: true,
    isSuperAdmin: { $ne: true },
    // A global oversight account is not a colleague to list.
    role: { $ne: ROLES.ADMIN },
    $or: clauses,
  };
  const { search } = req.query;
  if (search) {
    const rx = { $regex: String(search), $options: 'i' };
    query.$and = [{ $or: [{ name: rx }, { email: rx }, { jobTitle: rx }, { phone: rx }] }];
  }

  const people = await User.find(query)
    // Exactly the columns the directory shows — nothing else leaves the server.
    .select('name email phone avatar role userType jobTitle organization handles')
    .populate('organization', 'name color')
    .populate('handles.organization', 'name color')
    .sort({ name: 1 })
    .lean();

  res.json({ success: true, count: people.length, people });
});

// @route GET /api/users  (ADMIN, or an Admin/CEO within their own institutions)
// — list with search + role + organization filter
export const getUsers = asyncHandler(async (req, res) => {
  const { search, role, organization, page, limit = 25 } = req.query;
  const query = {};
  if (organization && organization !== 'All') query.organization = organization;

  // An Admin (CEO) sees the people inside the institutions they hold, and
  // nobody else. A social handler can serve a college through `handles` while
  // belonging to another one, so both links count. Written as $and because
  // `search` already owns $or.
  const allowed = accessibleOrgIds(req.user);
  if (allowed !== null) {
    if (organization && organization !== 'All' && !allowed.includes(String(organization))) {
      res.status(403); throw new Error('You do not have access to that institution');
    }
    query.$and = [
      ...(query.$and || []),
      { $or: [{ organization: { $in: allowed } }, { 'handles.organization': { $in: allowed } }] },
    ];
  }
  // The super admin's account is their own business: name, email and everything
  // else stay private to them. Everyone else is told one EXISTS — a count, so
  // they know who to escalate to — without a single detail of who it is. The
  // exclusion is explicit rather than relying on the org scope above, which only
  // happens to hide them because the account belongs to no college.
  const viewerIsSuperAdmin = !!req.user.isSuperAdmin;
  if (!viewerIsSuperAdmin) query.isSuperAdmin = { $ne: true };

  // The stat tiles are a standing count of who exists in view (scoped by
  // organization/permissions), not a live reflection of the search box —
  // typing a name would otherwise shrink "Total Users" as you type, which
  // reads as accounts disappearing rather than a list narrowing below.
  // Snapshotted before the free-text search clause is added, so counting off
  // it later is unaffected by whatever's currently typed in the search box.
  const countBaseQuery = { ...query };

  if (search) query.$or = [
    { name: { $regex: escapeRegex(search), $options: 'i' } },
    { email: { $regex: escapeRegex(search), $options: 'i' } },
  ];

  // The role tile is applied to the LIST only, never to the counts — the tiles
  // are how you pick a role, so counting out of the filtered list would zero
  // every other tile the moment you clicked one.
  //
  // 'SUPER' is a tile, not a role value: the account carries the flag while its
  // role is ADMIN, and role ADMIN also covers view-only oversight accounts. Only
  // the super admin can list that account at all, so for anyone else the answer
  // is an empty list rather than a filter that quietly matches everything.
  let listQuery = query;
  if (role && role !== 'All') {
    if (role === 'SUPER') listQuery = viewerIsSuperAdmin ? { ...query, isSuperAdmin: true } : null;
    else if (Object.values(USER_TYPES).includes(role)) listQuery = { ...query, role: ROLES.USER, userType: role };
    else listQuery = { ...query, role };
  }

  // Pagination is opt-in and, when active, applies only to the page of rows
  // returned — the role-tile counts above are deliberately counted against
  // the full `query` (or `{...query, role:...}`), never the paginated slice,
  // or every tile but the current page would read wrong the moment you paged
  // past page 1. Opt-in because this endpoint also feeds pickers elsewhere
  // (TeamWork, AssignedWork, WorkAssignmentModal, the SocialAccounts handler
  // picker) that call it with no `page` and expect every matching user back.
  const paging = page !== undefined;
  const skip = paging ? (Number(page) - 1) * Number(limit) : 0;

  const [users, matched, total, ceoCount, userCount, superAdminCount] = await Promise.all([
    listQuery
      ? (() => {
          let find = User.find(listQuery).populate('organization', 'name slug color').sort({ createdAt: -1 });
          if (paging) find = find.skip(skip).limit(Number(limit));
          return find;
        })()
      : [],
    listQuery ? User.countDocuments(listQuery) : 0,
    User.countDocuments(countBaseQuery),
    User.countDocuments({ ...countBaseQuery, role: ROLES.CEO }),
    User.countDocuments({ ...countBaseQuery, role: ROLES.USER }),
    User.countDocuments({ isSuperAdmin: true, isActive: true }),
  ]);

  res.json({
    success: true,
    count: users.length,
    matched,
    page: paging ? Number(page) : 1,
    pages: paging ? (Math.ceil(matched / Number(limit)) || 1) : 1,
    superAdminCount,
    roleCounts: { total, SUPER: superAdminCount, CEO: ceoCount, USER: userCount },
    users: users.map(sanitize),
  });
});

// @route POST /api/users  (ADMIN) — create a new user
export const createUser = asyncHandler(async (req, res) => {
  const {
    name,
    email,
    password,
    role,
    userType,
    jobTitle,
    organization,
    skills,
    handles,
    isSuperAdmin,
    viewOnly,
    phone,
    linkedinUrl,
    managedOrganizations,
  } = req.body;
  if (!name || !email || !password) {
    res.status(400);
    throw new Error('Name, email and password are required');
  }
  // No `current` to fall back on for a brand-new account, so the list is the
  // whole rule here — a new user cannot be created with an off-list title.
  const createTitle = resolveJobTitle(jobTitle);
  if (createTitle.error) { res.status(400); throw new Error(createTitle.error); }
  if (password.length < 6) {
    res.status(400);
    throw new Error('Password must be at least 6 characters');
  }
  // A super admin is a global ADMIN with the flag set and no organization. Only
  // an existing super admin reaches this route (requireSuperAdmin), so granting
  // it here is safe. A view-only account (e.g. the Chairman) is also a global
  // ADMIN, but read-only — never a super admin.
  const wantSuper = isSuperAdmin === true || isSuperAdmin === 'true';
  const wantViewOnly = (viewOnly === true || viewOnly === 'true') && !wantSuper;
  const finalRole = (wantSuper || wantViewOnly) ? ROLES.ADMIN : (role || ROLES.USER);
  const finalUserType = finalRole === ROLES.USER ? normalizeUserType(userType) : undefined;
  if (!Object.values(ROLES).includes(finalRole)) {
    res.status(400);
    throw new Error('Invalid role');
  }
  // CEO/USER must be assigned to a valid, active organization (super admins are global).
  let orgId = null;
  if (!wantSuper && roleNeedsOrg(finalRole, finalUserType)) {
    const wanted = orgIdOf(organization);
    if (!wanted) { res.status(400); throw new Error('An organization is required for Admin and User accounts'); }
    const org = await Organization.findById(wanted);
    if (!org) { res.status(400); throw new Error('Selected organization does not exist'); }
    orgId = org._id;
  }
  const exists = await User.findOne({ email: email.toLowerCase() });
  if (exists) {
    res.status(400);
    throw new Error('A user with this email already exists');
  }
  // Uploaded last, once everything else has passed, so a rejected form never
  // leaves an orphaned file behind.
  // Extra institutions only mean something for an Admin (CEO), who heads one
  // college and can be given more. Ignored for every other role.
  const managed = finalRole === ROLES.CEO ? await parseManagedOrgs(managedOrganizations, orgId) : [];

  const picture = req.file ? await uploadAvatar(req.file, res) : {};
  const user = await User.create({
    ...picture,
    managedOrganizations: managed,
    name,
    email,
    password,
    role: finalRole,
    userType: finalUserType,
    isSuperAdmin: wantSuper,
    viewOnly: wantViewOnly,
    jobTitle: createTitle.value || '',
    phone: phone || '',
    linkedinUrl: linkedinUrl || '',
    skills: parseSkills(skills),
    handles: await parseHandles(handles),
    organization: orgId,
  });

  logActivity({ user: req.user._id, organization: orgId, action: ACTIVITY_ACTIONS.USER_CREATED, description: `Created user "${name}" (${user.role})`, entityType: 'User', entityId: user._id });

  // Welcome email (only if SMTP configured) — never blocks the response.
  sendEmail({
    to: user.email,
    subject: 'Your DMM Platform account is ready',
    html: `<div style="font-family:Inter,Arial,sans-serif">
        <h2 style="color:#4f46e5">Welcome to DMM Platform</h2>
        <p>Hi ${name}, an account has been created for you with the role <b>${user.role}</b>.</p>
        <p>You can sign in at <a href="${process.env.CLIENT_URL?.split(',')[0] || ''}">the platform</a> using your email and the password provided by your administrator.</p>
      </div>`,
  });

  res.status(201).json({ success: true, user: sanitize(user) });
});

// @route GET /api/users/:id  (ADMIN)
export const getUser = asyncHandler(async (req, res) => {
  const user = await User.findById(req.params.id);
  if (!user) { res.status(404); throw new Error('User not found'); }
  res.json({ success: true, user: sanitize(user) });
});

// @route PUT /api/users/:id  (ADMIN) — update name, role, jobTitle, isActive
export const updateUser = asyncHandler(async (req, res) => {
  const user = await User.findById(req.params.id);
  if (!user) { res.status(404); throw new Error('User not found'); }

  const { name, role, userType, jobTitle, isActive, organization, skills, handles, isSuperAdmin, viewOnly, phone, linkedinUrl, managedOrganizations } = req.body;
  const wantSuper = isSuperAdmin === true || isSuperAdmin === 'true';
  const wantViewOnly = (viewOnly === true || viewOnly === 'true') && !wantSuper;

  // A super admin can't be deactivated. Its role can't be changed unless it's
  // being demoted out of super admin (handled below).
  if (user.isSuperAdmin) {
    if (isActive === false) { res.status(400); throw new Error('A super admin cannot be deactivated'); }
    if (role && role !== ROLES.ADMIN && isSuperAdmin === undefined) { res.status(400); throw new Error('A super admin role cannot be changed'); }
  }
  // Always keep at least one super admin.
  if (user.isSuperAdmin && isSuperAdmin !== undefined && !wantSuper) {
    const others = await User.countDocuments({ isSuperAdmin: true, _id: { $ne: user._id } });
    if (others === 0) { res.status(400); throw new Error('At least one super admin must remain'); }
  }

  // Guard: don't allow removing the last active admin or self-demotion lockout
  if (role && role !== user.role && user.role === ROLES.ADMIN && role !== ROLES.ADMIN) {
    const adminCount = await User.countDocuments({ role: ROLES.ADMIN, isActive: true });
    if (adminCount <= 1) { res.status(400); throw new Error('Cannot change the role of the last admin'); }
  }
  if (isActive === false && user.role === ROLES.ADMIN) {
    const adminCount = await User.countDocuments({ role: ROLES.ADMIN, isActive: true });
    if (adminCount <= 1) { res.status(400); throw new Error('Cannot deactivate the last admin'); }
  }

  if (name) user.name = name;
  const title = resolveJobTitle(jobTitle, user.jobTitle);
  if (title.error) { res.status(400); throw new Error(title.error); }
  if (title.value !== undefined) user.jobTitle = title.value;
  if (phone !== undefined) user.phone = phone;
  if (linkedinUrl !== undefined) user.linkedinUrl = linkedinUrl;
  if (skills !== undefined) user.skills = parseSkills(skills);
  if (handles !== undefined) user.handles = await parseHandles(handles);
  if (typeof isActive === 'boolean') user.isActive = isActive;
  if (req.file) await replaceAvatar(user, req.file, res);

  const nextRole = role && Object.values(ROLES).includes(role) ? role : user.role;
  const nextUserType = nextRole === ROLES.USER ? normalizeUserType(userType || user.userType) : undefined;
  // Determine the resulting organization. Org is required for CEO/USER, cleared
  // for ADMIN — and for a Photographer, who works across every college rather
  // than belonging to one.
  const nextOrg = organization !== undefined ? orgIdOf(organization) : user.organization;
  if (roleNeedsOrg(nextRole, nextUserType)) {
    if (!nextOrg) { res.status(400); throw new Error('An organization is required for CEO and User accounts'); }
    const org = await Organization.findById(nextOrg);
    if (!org) { res.status(400); throw new Error('Selected organization does not exist'); }
    user.organization = org._id;
  } else {
    user.organization = null; // ADMIN is global, or a Photographer who isn't tied to one college
  }
  user.role = nextRole;
  user.userType = nextUserType;

  // Extra institutions belong to an Admin (CEO) only, so they are cleared on any
  // other role - otherwise a demoted account would keep a stale grant.
  if (nextRole !== ROLES.CEO) user.managedOrganizations = [];
  else if (managedOrganizations !== undefined) {
    user.managedOrganizations = await parseManagedOrgs(managedOrganizations, user.organization);
  }

  // Promote/demote super admin (global, no organization).
  if (isSuperAdmin !== undefined) {
    user.isSuperAdmin = wantSuper;
    if (wantSuper) { user.role = ROLES.ADMIN; user.organization = null; user.userType = undefined; }
  }
  // View-only (Chairman) toggle — a global read-only ADMIN. Mutually exclusive
  // with super admin, which always keeps write access.
  if (viewOnly !== undefined) {
    user.viewOnly = wantViewOnly;
    if (wantViewOnly) { user.role = ROLES.ADMIN; user.organization = null; user.userType = undefined; }
  }
  if (user.isSuperAdmin) user.viewOnly = false; // the super admin is never read-only
  await user.save();

  const action = isActive === false ? ACTIVITY_ACTIONS.USER_DEACTIVATED : ACTIVITY_ACTIONS.USER_UPDATED;
  logActivity({ user: req.user._id, organization: user.organization, action, description: `Updated user "${user.name}"`, entityType: 'User', entityId: user._id });

  await user.populate('organization', 'name slug color');
  res.json({ success: true, user: sanitize(user) });
});

// @route PUT /api/users/:id/reset-password  (ADMIN)
export const adminResetPassword = asyncHandler(async (req, res) => {
  const { password } = req.body;
  if (!password || password.length < 6) {
    res.status(400);
    throw new Error('Password must be at least 6 characters');
  }
  const user = await User.findById(req.params.id);
  if (!user) { res.status(404); throw new Error('User not found'); }
  user.password = password;
  await user.save();
  logActivity({ user: req.user._id, action: ACTIVITY_ACTIONS.USER_UPDATED, description: `Reset password for "${user.name}"`, entityType: 'User', entityId: user._id });
  res.json({ success: true, message: 'Password reset successfully' });
});

// @route DELETE /api/users/:id  (ADMIN)
export const deleteUser = asyncHandler(async (req, res) => {
  const user = await User.findById(req.params.id);
  if (!user) { res.status(404); throw new Error('User not found'); }
  if (user.isSuperAdmin) { res.status(400); throw new Error('The super admin account cannot be deleted'); }
  if (String(user._id) === String(req.user._id)) { res.status(400); throw new Error('You cannot delete your own account'); }
  if (user.role === ROLES.ADMIN) {
    const adminCount = await User.countDocuments({ role: ROLES.ADMIN });
    if (adminCount <= 1) { res.status(400); throw new Error('Cannot delete the last admin'); }
  }
  if (user.avatarPublicId) await deleteFile(user.avatarPublicId);
  await user.deleteOne();
  logActivity({ user: req.user._id, action: ACTIVITY_ACTIONS.USER_DEACTIVATED, description: `Deleted user "${user.name}"`, entityType: 'User', entityId: user._id });
  res.json({ success: true, message: 'User deleted' });
});

// ============================ SELF ============================

// @route PUT /api/users/profile
export const updateProfile = asyncHandler(async (req, res) => {
  const user = await User.findById(req.user._id);
  const { name, jobTitle, phone, linkedinUrl } = req.body;
  // A job title has to come off the canonical list (utils/jobTitle.js) — free
  // text is what filled the directory with three spellings of "Coordinator".
  const title = resolveJobTitle(jobTitle, user.jobTitle);
  if (title.error) { res.status(400); throw new Error(title.error); }
  if (name) user.name = name;
  if (title.value !== undefined) user.jobTitle = title.value;
  if (phone !== undefined) user.phone = phone;
  if (linkedinUrl !== undefined) user.linkedinUrl = linkedinUrl;

  if (req.file) await replaceAvatar(user, req.file, res);
  await user.save();

  logActivity({
    user: req.user._id,
    organization: user.organization,
    action: ACTIVITY_ACTIONS.PROFILE_UPDATED,
    description: `${user.name} updated their profile`,
    entityType: 'User',
    entityId: user._id,
  });

  res.json({ success: true, user: sanitize(user) });
});

// @route PUT /api/users/password
export const changePassword = asyncHandler(async (req, res) => {
  const { currentPassword, newPassword } = req.body;
  const user = await User.findById(req.user._id).select('+password');
  if (!(await user.matchPassword(currentPassword))) {
    res.status(400);
    throw new Error('Current password is incorrect');
  }
  if (!newPassword || newPassword.length < 6) {
    res.status(400);
    throw new Error('New password must be at least 6 characters');
  }
  user.password = newPassword;
  await user.save();

  logActivity({
    user: req.user._id,
    organization: user.organization,
    action: ACTIVITY_ACTIONS.USER_UPDATED,
    description: `${user.name} changed their password`,
    entityType: 'User',
    entityId: user._id,
  });

  res.json({ success: true, message: 'Password updated' });
});

// @route PUT /api/users/settings  — theme + notification prefs
export const updateSettings = asyncHandler(async (req, res) => {
  const user = await User.findById(req.user._id);
  const { theme, notifications } = req.body;
  if (theme) user.settings.theme = theme;
  if (notifications) {
    user.settings.notifications = { ...user.settings.notifications.toObject?.() ?? user.settings.notifications, ...notifications };
  }
  await user.save();

  logActivity({
    user: req.user._id,
    organization: user.organization,
    action: ACTIVITY_ACTIONS.PROFILE_UPDATED,
    description: `${user.name} updated their settings`,
    entityType: 'User',
    entityId: user._id,
  });

  res.json({ success: true, settings: user.settings });
});

// ======================= PROFILE COMPLETION + REVIEW =======================

// @route PUT /api/users/profile/complete — the FIRST profile fill-in after the
// account is created. Applies directly (no review) and unlocks the app.
export const completeProfile = asyncHandler(async (req, res) => {
  const user = await User.findById(req.user._id);
  if (user.profileCompletedAt) {
    res.status(400);
    throw new Error('Your profile is already completed — further skill/tool changes need an update request');
  }
  const { name, phone, jobTitle, linkedinUrl, skills, tools, handles } = req.body;
  if (!name?.trim()) { res.status(400); throw new Error('Your name is required'); }
  if (!phone?.trim()) { res.status(400); throw new Error('Your phone number is required'); }
  const skillList = parseSkills(skills);
  const toolList = parseSkills(tools);
  if (!skillList.length) { res.status(400); throw new Error('Add at least one skill'); }
  if (!toolList.length) { res.status(400); throw new Error('Add at least one tool you know'); }
  const handleList = await parseHandles(handles);
  if (user.role === ROLES.USER && user.userType === USER_TYPES.SOCIAL_HANDLER && !handleList.length) {
    res.status(400); throw new Error('Add at least one organization/page you handle');
  }

  const title = resolveJobTitle(jobTitle, user.jobTitle);
  if (title.error) { res.status(400); throw new Error(title.error); }

  user.name = name.trim();
  user.phone = phone.trim();
  if (title.value !== undefined) user.jobTitle = title.value;
  if (linkedinUrl !== undefined) user.linkedinUrl = linkedinUrl;
  user.skills = skillList;
  user.tools = toolList;
  user.handles = handleList;
  user.profileCompletedAt = new Date();
  await user.save();

  logActivity({ user: user._id, organization: user.organization, action: ACTIVITY_ACTIONS.PROFILE_UPDATED, description: `${user.name} completed their profile`, entityType: 'User', entityId: user._id });
  const populated = await User.findById(user._id).populate('organization', 'name slug logo color isActive');
  res.json({ success: true, user: sanitize(populated) });
});

// @route GET /api/users/profile/update-request — my latest request (any status),
// so the profile page can show pending/rejected state.
export const myProfileRequest = asyncHandler(async (req, res) => {
  const request = await ProfileUpdateRequest.findOne({ user: req.user._id })
    .sort({ createdAt: -1 })
    .populate('reviewedBy', 'name')
    .populate('changes.handles.organization', 'name color')
    .lean();
  res.json({ success: true, request: request || null });
});

// @route POST /api/users/profile/update-request — propose new skills/tools/handles.
// Replaces any still-pending request; an Admin must approve before it applies.
export const requestProfileUpdate = asyncHandler(async (req, res) => {
  const user = await User.findById(req.user._id);
  if (!user.profileCompletedAt) { res.status(400); throw new Error('Complete your profile first'); }

  const { skills, tools, handles, note } = req.body;
  const skillList = parseSkills(skills);
  const toolList = parseSkills(tools);
  if (!skillList.length) { res.status(400); throw new Error('Add at least one skill'); }
  if (!toolList.length) { res.status(400); throw new Error('Add at least one tool'); }
  const handleList = await parseHandles(handles);

  // One pending request per user — a resubmission replaces the previous one.
  await ProfileUpdateRequest.deleteMany({ user: user._id, status: 'PENDING' });
  const request = await ProfileUpdateRequest.create({
    user: user._id,
    changes: { skills: skillList, tools: toolList, handles: handleList },
    note: note || '',
  });

  // Tell the admins there is something to review.
  const admins = await User.find({ isActive: true, role: ROLES.ADMIN }).select('_id');
  await Promise.all(admins.map((a) => createNotification({
    recipient: a._id, organization: user.organization, type: NOTIFICATION_TYPES.PROFILE_UPDATE_SUBMITTED,
    title: 'Profile update to review', message: `${user.name} wants to update their skills/tools`,
    link: '/users',
  })));
  logActivity({ user: user._id, organization: user.organization, action: ACTIVITY_ACTIONS.PROFILE_UPDATED, description: `${user.name} requested a profile update (awaiting review)`, entityType: 'User', entityId: user._id });
  res.status(201).json({ success: true, request });
});

// @route GET /api/users/profile-requests?status=  (ADMIN) — the review queue,
// each request alongside the user's CURRENT values for an easy diff.
export const listProfileRequests = asyncHandler(async (req, res) => {
  const status = ['PENDING', 'APPROVED', 'REJECTED'].includes(req.query.status) ? req.query.status : 'PENDING';
  const requests = await ProfileUpdateRequest.find({ status })
    .populate({
      path: 'user',
      select: 'name avatar email role skills tools handles organization',
      populate: [
        { path: 'organization', select: 'name color' },
        { path: 'handles.organization', select: 'name color' },
      ],
    })
    .populate('changes.handles.organization', 'name color')
    .sort({ createdAt: -1 })
    .lean();
  res.json({ success: true, count: requests.length, requests });
});

// @route PUT /api/users/profile-requests/:id  (ADMIN) — { action: 'approve'|'reject', note }
export const reviewProfileRequest = asyncHandler(async (req, res) => {
  const request = await ProfileUpdateRequest.findById(req.params.id).populate('user', 'name organization');
  if (!request) { res.status(404); throw new Error('Request not found'); }
  if (request.status !== 'PENDING') { res.status(400); throw new Error('This request was already reviewed'); }

  const { action, note } = req.body;
  if (!['approve', 'reject'].includes(action)) { res.status(400); throw new Error('action must be approve or reject'); }

  if (action === 'approve') {
    const user = await User.findById(request.user._id);
    user.skills = request.changes.skills || [];
    user.tools = request.changes.tools || [];
    user.handles = request.changes.handles || [];
    await user.save();
    request.status = 'APPROVED';
  } else {
    request.status = 'REJECTED';
  }
  request.reviewedBy = req.user._id;
  request.reviewedAt = new Date();
  request.reviewNote = note || '';
  await request.save();

  await createNotification({
    recipient: request.user._id, organization: request.user.organization, type: NOTIFICATION_TYPES.PROFILE_UPDATE_REVIEWED,
    title: action === 'approve' ? 'Profile update approved' : 'Profile update rejected',
    message: action === 'approve'
      ? 'Your new skills/tools are now live on your profile'
      : `Your profile update was rejected${note ? `: ${note}` : ''}`,
    link: '/profile',
  });
  logActivity({ user: req.user._id, organization: request.user.organization, action: ACTIVITY_ACTIONS.PROFILE_UPDATED, description: `${action === 'approve' ? 'Approved' : 'Rejected'} ${request.user.name}'s profile update`, entityType: 'User', entityId: request.user._id });
  res.json({ success: true, request });
});
