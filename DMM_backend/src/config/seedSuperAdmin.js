import User from '../models/User.js';
import { ROLES } from './constants.js';

// Ensures exactly one built-in super admin exists. Runs on every startup:
// - If the configured account exists, it is (re)promoted to super admin.
// - Otherwise it is created with a temporary password (change it after first
//   login). Any other stray super-admin flags are cleared so there is only one.
//
// Configure via env: SUPER_ADMIN_EMAIL, SUPER_ADMIN_PASSWORD, SUPER_ADMIN_NAME.
export const seedSuperAdmin = async () => {
  const email = (process.env.SUPER_ADMIN_EMAIL || 'development@ncetmail.com').toLowerCase().trim();
  const password = process.env.SUPER_ADMIN_PASSWORD || 'ChangeMe@123';
  const name = process.env.SUPER_ADMIN_NAME || 'Super Admin';

  const existing = await User.findOne({ email });
  if (existing) {
    let changed = false;
    if (!existing.isSuperAdmin) { existing.isSuperAdmin = true; changed = true; }
    if (existing.role !== ROLES.ADMIN) { existing.role = ROLES.ADMIN; changed = true; }
    if (!existing.isActive) { existing.isActive = true; changed = true; }
    if (existing.organization) { existing.organization = null; changed = true; }
    if (changed) await existing.save();
    // Make sure no one else carries the super-admin flag.
    await User.updateMany({ _id: { $ne: existing._id }, isSuperAdmin: true }, { isSuperAdmin: false });
    console.log(`   Super admin: ${email}`);
    return;
  }

  await User.updateMany({ isSuperAdmin: true }, { isSuperAdmin: false });
  await User.create({ name, email, password, role: ROLES.ADMIN, isSuperAdmin: true, jobTitle: 'Super Administrator' });
  console.log(`   Super admin created: ${email} — temporary password "${password}" (change it after first login)`);
};
