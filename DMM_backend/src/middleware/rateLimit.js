import rateLimit, { ipKeyGenerator } from 'express-rate-limit';

// Applied only to the handful of routes worth protecting — login and
// forgot-password against credential-stuffing/brute-force, AI chat against
// unbounded per-account API cost. Everything else in the app stays
// unthrottled on purpose; there is no reason to slow down normal use of a
// dashboard or a list page.

// Keyed by IP: an attacker trying many passwords is one IP hammering /login,
// not one legitimate user. 10 attempts / 15 min is generous for a real typo
// or two, tight for a guessing script.
export const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, message: 'Too many login attempts. Try again in a few minutes.' },
});

// Forgot-password can be used to spam a stranger's inbox even without
// guessing anything, so it gets the same shape of limit as login.
export const forgotPasswordLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, message: 'Too many reset requests. Try again in a few minutes.' },
});

// AI chat costs real money per call. This runs after `protect`, so
// `req.user` exists — keying by user id (not IP) means one heavy user can't
// use up an IP-mate's quota, and a shared office IP isn't punished for one
// person's usage.
export const aiChatLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: 30,
  standardHeaders: true,
  legacyHeaders: false,
  // ipKeyGenerator normalizes IPv6 addresses (a single client can present many
  // equivalent ones) — required by express-rate-limit for any custom
  // keyGenerator that might fall back to an IP.
  keyGenerator: (req) => req.user?._id?.toString() || ipKeyGenerator(req.ip),
  message: { success: false, message: 'AI chat limit reached for this hour. Try again later.' },
});
