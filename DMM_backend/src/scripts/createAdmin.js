/**
 * Admin bootstrap utility.
 *
 * Creates (or resets) the platform administrator account. Useful for the very
 * first admin, or to recover admin access. It is idempotent: run it as many
 * times as you like.
 *
 * Usage:
 *   npm run create-admin
 *
 * Credentials default to Admin@DMM / Admin@DMM but can be overridden with env:
 *   ADMIN_NAME, ADMIN_EMAIL, ADMIN_PASSWORD
 */
import 'dotenv/config';
import mongoose from 'mongoose';
import connectDB from '../config/db.js';
import User from '../models/User.js';
import { ROLES } from '../config/constants.js';

const NAME = process.env.ADMIN_NAME || 'Administrator';
const EMAIL = (process.env.ADMIN_EMAIL || 'Admin@DMM').toLowerCase();
const PASSWORD = process.env.ADMIN_PASSWORD || 'Admin@DMM';

const run = async () => {
  await connectDB();

  let user = await User.findOne({ email: EMAIL });
  if (user) {
    // Reset existing account back to an active admin with the given password.
    user.name = NAME;
    user.role = ROLES.ADMIN;
    user.isActive = true;
    user.password = PASSWORD; // re-hashed by the pre-save hook
    await user.save();
    console.log(`✅ updated existing admin: ${EMAIL}`);
  } else {
    user = await User.create({
      name: NAME,
      email: EMAIL,
      password: PASSWORD,
      role: ROLES.ADMIN,
      jobTitle: 'Administrator',
    });
    console.log(`✅ created admin: ${EMAIL}`);
  }

  console.log('\n   Admin portal login (http://localhost:5174)');
  console.log('   ┌───────────────────────────────────────┐');
  console.log(`   │ Email:    ${EMAIL.padEnd(28)}│`);
  console.log(`   │ Password: ${String(PASSWORD).padEnd(28)}│`);
  console.log('   └───────────────────────────────────────┘');
  console.log('   (email is case-insensitive at login)\n');

  await mongoose.connection.close();
  process.exit(0);
};

run().catch((err) => {
  console.error('createAdmin failed:', err.message);
  process.exit(1);
});
