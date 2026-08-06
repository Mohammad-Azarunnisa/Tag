import mongoose from 'mongoose';
import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import { ROLES, USER_TYPES } from '../config/constants.js';

const userSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    email: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
    },
    password: { type: String, required: true, minlength: 6, select: false },
    role: { type: String, enum: Object.values(ROLES), default: ROLES.USER },
    // Sub-type inside USER role to model the two operational personas.
    userType: { type: String, enum: Object.values(USER_TYPES), default: undefined },
    // The single built-in super admin. Only this account can create/edit other
    // admins, users and organizations. Seeded on startup; never set via the API.
    isSuperAdmin: { type: Boolean, default: false },
    // View-only oversight account (e.g. the Chairman, NGI): sees all activity
    // but cannot change anything. Enforced globally in the protect middleware,
    // which blocks every non-GET request for these users.
    viewOnly: { type: Boolean, default: false },
    // CEO and USER belong to one organization. ADMIN is global (organization = null).
    organization: { type: mongoose.Schema.Types.ObjectId, ref: 'Organization', default: null, index: true },
    // An Admin (role CEO) heads `organization`, but the super admin can put more
    // institutions under them — this is that grant list. Their working set is
    // `organization` plus these; see utils/org.js#accessibleOrgIds. Empty for
    // every other role, which is why access rules read the two together rather
    // than this alone.
    managedOrganizations: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Organization', index: true }],
    avatar: { type: String, default: '' },
    avatarPublicId: { type: String, default: '' },
    jobTitle: { type: String, default: '' },
    // Contact details shown wherever this person appears (e.g. social handlers)
    // so teammates can reach them directly.
    phone: { type: String, default: '', trim: true },
    linkedinUrl: { type: String, default: '', trim: true },
    // Skill set, e.g. ["Video Editing", "Photo Editing", "Photography"].
    skills: [{ type: String, trim: true }],
    // Tools they know, e.g. ["Photoshop", "Premiere Pro", "Canva"].
    tools: [{ type: String, trim: true }],
    // Which organizations/pages this person handles, e.g.
    // { organization: NCET, platforms: ["Instagram", "Facebook"] }.
    handles: [
      {
        organization: { type: mongoose.Schema.Types.ObjectId, ref: 'Organization' },
        platforms: [{ type: String, trim: true }],
        _id: false,
      },
    ],
    // Set the first time the user fills in their profile after account creation.
    // Until then the product app keeps them on the profile page. Later changes
    // to skills/tools/handles go through an admin-reviewed update request.
    profileCompletedAt: { type: Date, default: null },
    isActive: { type: Boolean, default: true },
    settings: {
      theme: { type: String, enum: ['light', 'dark'], default: 'light' },
      notifications: {
        email: { type: Boolean, default: true },
        inApp: { type: Boolean, default: true },
      },
    },
    resetPasswordToken: { type: String, select: false },
    resetPasswordExpire: { type: Date, select: false },
  },
  { timestamps: true }
);

userSchema.pre('save', async function (next) {
  if (!this.isModified('password')) return next();
  const salt = await bcrypt.genSalt(10);
  this.password = await bcrypt.hash(this.password, salt);
  next();
});

userSchema.methods.matchPassword = function (entered) {
  return bcrypt.compare(entered, this.password);
};

userSchema.methods.createPasswordResetToken = function () {
  const resetToken = crypto.randomBytes(32).toString('hex');
  this.resetPasswordToken = crypto.createHash('sha256').update(resetToken).digest('hex');
  this.resetPasswordExpire = Date.now() + 60 * 60 * 1000; // 1 hour
  return resetToken;
};

const User = mongoose.model('User', userSchema);
export default User;
