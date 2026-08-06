import nodemailer from 'nodemailer';

// Returns a configured transporter, or null if SMTP env vars are not set.
const getTransporter = () => {
  const { SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS } = process.env;
  if (!SMTP_HOST || !SMTP_USER || !SMTP_PASS) return null;
  return nodemailer.createTransport({
    host: SMTP_HOST,
    port: Number(SMTP_PORT) || 587,
    secure: Number(SMTP_PORT) === 465,
    auth: { user: SMTP_USER, pass: SMTP_PASS },
  });
};

export const isEmailConfigured = () => !!getTransporter();

/**
 * Send an email. Returns true if sent, false if SMTP is not configured.
 * Never throws into the request flow on transport errors.
 */
export const sendEmail = async ({ to, subject, html, text }) => {
  const transporter = getTransporter();
  if (!transporter) {
    console.warn('✉️  Email not sent — SMTP is not configured (set SMTP_HOST/PORT/USER/PASS).');
    return false;
  }
  try {
    await transporter.sendMail({
      from: process.env.SMTP_FROM || `DMM Platform <${process.env.SMTP_USER}>`,
      to, subject, text, html,
    });
    return true;
  } catch (err) {
    console.error('sendEmail error:', err.message);
    return false;
  }
};
