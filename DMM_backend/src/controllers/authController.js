import asyncHandler from 'express-async-handler';
import crypto from 'crypto';
import User from '../models/User.js';
import { generateToken } from '../utils/token.js';
import { sendEmail, isEmailConfigured } from '../utils/email.js';
import { ROLES } from '../config/constants.js';

// The two front-ends are separate products for separate audiences: the console
// (DMM_Admin) belongs to the platform's ADMIN accounts, the product app
// (DMM_frontend) to the colleges' own people. An account may only sign in
// through its own portal. Enforcing it here rather than only in the browser
// means admin credentials typed into the product app are refused by the API,
// so no token is ever issued for the wrong portal.
//
// A request that names no portal is treated as the product app: that is the
// default consumer of this endpoint, and it is the side that must stay closed.
export const PORTALS = { ADMIN: 'admin', USER: 'user' };

// Who administers institutions, and therefore belongs in the console: the super
// admin across all of them, and an Admin (role CEO) inside the ones they hold.
// They do the same job — see the users, assign work, approve content, answer
// requests — and every endpoint they reach is scoped to their institutions
// server-side. The console is their ONLY door: an administrator signing into the
// product app would find none of that there, which is exactly the confusion this
// rule exists to prevent.
export const CONSOLE_ROLES = [ROLES.ADMIN, ROLES.CEO];

const assertPortal = (user, rawPortal, res) => {
  const portal = String(rawPortal || PORTALS.USER).toLowerCase();
  if (portal === PORTALS.USER && CONSOLE_ROLES.includes(user.role)) {
    res.status(403);
    throw new Error('You are trying to log in with an Admin account. Please use the Admin Portal.');
  }
  if (portal === PORTALS.ADMIN && !CONSOLE_ROLES.includes(user.role)) {
    res.status(403);
    throw new Error('You are trying to log in with a User account. Please use the User Portal.');
  }
};

const sanitize = (user) => ({
  _id: user._id,
  name: user.name,
  email: user.email,
  role: user.role,
  userType: user.userType || null,
  isSuperAdmin: !!user.isSuperAdmin,
  // The console hides every action behind this; without it in the payload a
  // view-only account was shown buttons the server then refused.
  viewOnly: !!user.viewOnly,
  // The extra institutions an Admin holds, so the console can scope its pickers
  // to what they can actually act in.
  managedOrganizations: user.managedOrganizations || [],
  avatar: user.avatar,
  jobTitle: user.jobTitle,
  phone: user.phone || '',
  linkedinUrl: user.linkedinUrl || '',
  skills: user.skills || [],
  tools: user.tools || [],
  handles: user.handles || [],
  profileCompletedAt: user.profileCompletedAt || null,
  settings: user.settings,
  // Populated org doc (CEO/USER) or null (ADMIN)
  organization: user.organization || null,
});

// @route GET /api/auth/setup-status
// Tells the client whether the very first admin account still needs to be created.
export const setupStatus = asyncHandler(async (req, res) => {
  const count = await User.estimatedDocumentCount();
  res.json({ success: true, needsSetup: count === 0 });
});

// @route POST /api/auth/setup
// Creates the first ADMIN account. Only works while the database has zero users,
// so it cannot be abused once the platform is set up.
export const setup = asyncHandler(async (req, res) => {
  const count = await User.estimatedDocumentCount();
  if (count > 0) {
    res.status(403);
    throw new Error('Setup has already been completed');
  }
  const { name, email, password } = req.body;
  if (!name || !email || !password) {
    res.status(400);
    throw new Error('Name, email and password are required');
  }
  if (password.length < 6) {
    res.status(400);
    throw new Error('Password must be at least 6 characters');
  }
  const user = await User.create({
    name, email, password,
    role: ROLES.ADMIN,
    jobTitle: 'Administrator',
  });
  res.status(201).json({ success: true, user: sanitize(user), token: generateToken(user._id) });
});

// @route POST /api/auth/login
export const login = asyncHandler(async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) {
    res.status(400);
    throw new Error('Email and password are required');
  }
  const user = await User.findOne({ email: email.toLowerCase() })
    .select('+password')
    .populate('organization', 'name slug logo color isActive');
  if (!user || !(await user.matchPassword(password))) {
    res.status(401);
    throw new Error('Invalid email or password');
  }
  if (!user.isActive) {
    res.status(403);
    throw new Error('Your account has been deactivated. Contact your administrator.');
  }
  // Right credentials, wrong door — see PORTALS above.
  assertPortal(user, req.body.portal, res);
  // An Admin's working set is their own institution PLUS the ones granted to
  // them, so holding nothing but grants is perfectly normal — checking only
  // `organization` would lock out an admin who heads no single college.
  if (user.role === ROLES.CEO) {
    const holds = [user.organization?._id || user.organization, ...(user.managedOrganizations || [])].filter(Boolean);
    if (!holds.length) {
      res.status(403);
      throw new Error('Your account is not assigned to any institution. Contact your administrator.');
    }
  } else if (user.role !== ROLES.ADMIN) {
    // A college account belongs to exactly one organization, and it must be live.
    if (!user.organization) {
      res.status(403);
      throw new Error('Your account is not assigned to an organization. Contact your administrator.');
    }
    if (user.organization.isActive === false) {
      res.status(403);
      throw new Error('Your organization has been deactivated. Contact your administrator.');
    }
  }
  res.json({ success: true, user: sanitize(user), token: generateToken(user._id) });
});

// @route GET /api/auth/me
export const getMe = asyncHandler(async (req, res) => {
  res.json({ success: true, user: sanitize(req.user) });
});

// @route POST /api/auth/logout  (stateless JWT — client clears token)
export const logout = asyncHandler(async (req, res) => {
  res.json({ success: true, message: 'Logged out' });
});

// @route POST /api/auth/forgot-password
// Generates a reset token and emails a reset link. Always returns a generic
// response so the endpoint cannot be used to discover which emails exist.
export const forgotPassword = asyncHandler(async (req, res) => {
  const { email } = req.body;
  const generic = { success: true, message: 'If an account exists for that email, a reset link has been sent.' };

  const user = await User.findOne({ email: (email || '').toLowerCase() });
  if (!user) return res.json(generic);

  const resetToken = user.createPasswordResetToken();
  await user.save({ validateBeforeSave: false });

  const resetUrl = `${process.env.CLIENT_URL?.split(',')[0] || 'http://localhost:5173'}/reset-password/${resetToken}`;
  const sent = await sendEmail({
    to: user.email,
    subject: 'Reset your DMM Platform password',
    text: `Reset your password using this link: ${resetUrl} (valid for 1 hour).`,
    html: `
      <div style="font-family:Inter,Arial,sans-serif;max-width:480px;margin:auto">
        <h2 style="color:#4f46e5">Password reset</h2>
        <p>We received a request to reset your password. Click below to choose a new one. This link is valid for 1 hour.</p>
        <p><a href="${resetUrl}" style="display:inline-block;background:#4f46e5;color:#fff;padding:12px 20px;border-radius:10px;text-decoration:none">Reset password</a></p>
        <p style="color:#94a3b8;font-size:12px">If you didn't request this, you can safely ignore this email.</p>
      </div>`,
  });

  if (!sent) {
    // SMTP not configured: don't silently fail — surface to the user so an admin
    // can reset the password from the admin panel instead.
    return res.json({
      success: true,
      emailConfigured: false,
      message: 'Email delivery is not configured on this server. Please ask an administrator to reset your password.',
    });
  }
  res.json(generic);
});

// @route POST /api/auth/reset-password/:token
export const resetPassword = asyncHandler(async (req, res) => {
  const hashed = crypto.createHash('sha256').update(req.params.token).digest('hex');
  const user = await User.findOne({
    resetPasswordToken: hashed,
    resetPasswordExpire: { $gt: Date.now() },
  }).select('+resetPasswordToken +resetPasswordExpire');

  if (!user) {
    res.status(400);
    throw new Error('Invalid or expired reset token');
  }
  if (!req.body.password || req.body.password.length < 6) {
    res.status(400);
    throw new Error('Password must be at least 6 characters');
  }
  user.password = req.body.password;
  user.resetPasswordToken = undefined;
  user.resetPasswordExpire = undefined;
  await user.save();
  res.json({ success: true, message: 'Password reset successful', token: generateToken(user._id) });
});

// @route GET /api/auth/email-status  — whether SMTP is configured (for UI hints)
export const emailStatus = asyncHandler(async (req, res) => {
  res.json({ success: true, emailConfigured: isEmailConfigured() });
});
