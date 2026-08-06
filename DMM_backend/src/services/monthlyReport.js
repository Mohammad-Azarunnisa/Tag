import User from '../models/User.js';
import { createNotification } from '../utils/notify.js';
import { logActivity } from '../utils/logActivity.js';
import { sendEmail } from '../utils/email.js';
import { buildPeriodReport, lastCompleteMonth } from './periodReport.js';
import { ACTIVITY_ACTIONS, NOTIFICATION_TYPES } from '../config/constants.js';

// Which day of the month the run goes out on, and at what UTC time. The 1st is
// the earliest a full month can be reported on.
const DEFAULT_DAY = Number(process.env.MONTHLY_REPORT_DAY || 1);
const DEFAULT_TIME = process.env.MONTHLY_REPORT_TIME || '06:00';

const parseTime = (value) => {
  const m = String(value || DEFAULT_TIME).trim().match(/^([01]?\d|2[0-3]):([0-5]\d)$/);
  return { hour: m ? Number(m[1]) : 6, minute: m ? Number(m[2]) : 0 };
};

const nextRunAt = (now = new Date()) => {
  const { hour, minute } = parseTime(DEFAULT_TIME);
  const day = Math.min(Math.max(DEFAULT_DAY, 1), 28);
  let next = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), day, hour, minute, 0, 0));
  if (next <= now) next = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, day, hour, minute, 0, 0));
  return next;
};

// setTimeout takes a 32-bit delay - anything past ~24.8 days silently clamps to
// 1ms and fires straight away. A month is longer than that, so the wait is
// chained in day-long hops and the target time re-checked on each wake.
const MAX_TIMEOUT_MS = 24 * 60 * 60 * 1000;

const nf = (n) => Number(n || 0).toLocaleString('en-IN');

// A short read-out for the notification and the email — the figures management
// asks about first, in the order they ask about them.
const summarise = (r) => {
  const h = r.headline;
  const lines = [
    `${h.designsDelivered.value} of ${h.designsDelivered.of} designs delivered`,
    h.deliveredOnTimeRate == null ? null : `${h.deliveredOnTimeRate}% on time`,
    `${h.webTasksDone.value} of ${h.webTasksDone.of} web tasks done`,
    `${nf(h.postsPublished)} posts published`,
    h.engagementRate == null ? null : `${h.engagementRate}% engagement`,
    h.adSpend ? `₹${nf(h.adSpend)} ad spend` : null,
    h.leadsFromAds ? `${nf(h.leadsFromAds)} leads${h.costPerLead ? ` at ₹${nf(h.costPerLead)} each` : ''}` : null,
  ].filter(Boolean);
  return lines.join(' · ');
};

/**
 * Build last month's report and put it in front of the super admins.
 *
 * The report itself is always recomputed from live data rather than stored, so
 * this run is a delivery mechanism, not a snapshot — opening the same period in
 * the console later shows the same figures, including any corrections made since.
 */
export const sendMonthlyReport = async ({ now = new Date() } = {}) => {
  const { from, to } = lastCompleteMonth(now);
  const report = await buildPeriodReport({ from, to });

  const recipients = await User.find({ isActive: true, isSuperAdmin: true }).select('_id name email').lean();
  if (!recipients.length) return { sent: 0, period: report.period };

  const monthName = from.toLocaleString('en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' });
  const summary = summarise(report);
  const link = `/reports?from=${report.period.from}&to=${report.period.to}`;

  await Promise.all(recipients.map((u) => createNotification({
    recipient: u._id,
    type: NOTIFICATION_TYPES.MONTHLY_REPORT,
    title: `${monthName} report is ready`,
    message: summary,
    link,
  })));

  // Email is best-effort: it only goes if SMTP is configured, and never blocks.
  const rows = report.design.rows
    .map((d) => `<tr><td style="padding:4px 10px">${d.organization.name}</td><td style="padding:4px 10px;text-align:right">${d.completed}/${d.requestsReceived}</td><td style="padding:4px 10px;text-align:right">${d.onTimeRate == null ? '—' : `${d.onTimeRate}%`}</td></tr>`)
    .join('');
  await Promise.all(recipients.map((u) => sendEmail({
    to: u.email,
    subject: `Branding & Marketing report — ${monthName}`,
    html: `<div style="font-family:Inter,Arial,sans-serif;color:#1e293b">
        <h2 style="color:#4f46e5;margin-bottom:4px">Branding &amp; Marketing — ${monthName}</h2>
        <p style="color:#64748b;margin-top:0">${report.period.from} to ${report.period.to}</p>
        <p style="font-size:15px">${summary}</p>
        <table style="border-collapse:collapse;font-size:13px;margin-top:12px">
          <tr style="background:#f1f5f9"><th style="padding:6px 10px;text-align:left">Institution</th><th style="padding:6px 10px">Delivered</th><th style="padding:6px 10px">On time</th></tr>
          ${rows}
        </table>
        ${report.gaps.length ? `<p style="color:#b45309;font-size:12px;margin-top:14px"><b>Worth knowing:</b><br>${report.gaps.join('<br>')}</p>` : ''}
        <p style="color:#64748b;font-size:12px;margin-top:16px">Open the console to see every part and download the workbook.</p>
      </div>`,
  })));

  await logActivity({
    action: ACTIVITY_ACTIONS.REPORT_GENERATED,
    description: `Monthly report generated for ${report.period.from} to ${report.period.to}`,
  });

  return { sent: recipients.length, period: report.period, summary };
};

/**
 * Run once a month. Deliberately fire-and-forget with a self-rescheduling timer,
 * matching the daily analytics refresh, so there is no cron dependency.
 */
export const startMonthlyReportScheduler = () => {
  let target = nextRunAt();

  const tick = () => {
    const remaining = target.getTime() - Date.now();
    if (remaining > 0) {
      setTimeout(tick, Math.min(remaining, MAX_TIMEOUT_MS)).unref?.();
      return;
    }
    (async () => {
      try {
        const result = await sendMonthlyReport();
        console.log(`📊 Monthly report sent to ${result.sent} super admin(s) for ${result.period.from} → ${result.period.to}`);
      } catch (err) {
        // A failed run must not stop next month's.
        console.error('Monthly report failed:', err.message);
      }
      // Move the target on before waiting again, so a run can never repeat.
      target = nextRunAt(new Date(Date.now() + 1000));
      tick();
    })();
  };
  tick();
  const { hour, minute } = parseTime(DEFAULT_TIME);
  return { day: DEFAULT_DAY, time: `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}` };
};
