import ApprovalRequest from '../models/ApprovalRequest.js';
import WorkAssignment from '../models/WorkAssignment.js';
import { completePostingWork, closePostingWorkForApproval } from '../controllers/workAssignmentController.js';
import ApprovalComment from '../models/ApprovalComment.js';
import User from '../models/User.js';
import { createNotification } from '../utils/notify.js';
import { APPROVAL_STATUS, NOTIFICATION_TYPES } from '../config/constants.js';

// Approved content carries a go-live time. This sweeps for anything whose time
// has arrived and moves it to POSTED, so the board reflects reality without
// anyone remembering to click.
//
// It runs on an interval rather than a timer per request: timers die with the
// process, whereas a sweep picks up whatever is due — including anything that
// fell due while the server was restarting.

const CHECK_INTERVAL_MS = Number(process.env.SCHEDULED_POST_CHECK_MS || 60_000);

const channels = (r) => {
  const list = r.platforms?.length ? r.platforms : (r.platform ? [r.platform] : []);
  return list.length ? ` on ${list.join(', ')}` : '';
};

export const publishDueScheduledPosts = async (now = new Date()) => {
  const due = await ApprovalRequest.find({
    status: APPROVAL_STATUS.APPROVED,
    scheduledAt: { $ne: null, $lte: now },
    autoPostedAt: { $in: [null, undefined] },
  }).limit(200);

  const published = [];
  for (const request of due) {
    try {
      request.status = APPROVAL_STATUS.POSTED;
      request.postedAt = request.scheduledAt || now;
      request.autoPostedAt = now;
      // Credit whoever scheduled it; nobody clicked anything at this moment.
      request.postedBy = request.scheduledBy || request.createdBy;
      await request.save();

      await ApprovalComment.create({
        request: request._id,
        kind: 'event',
        author: request.scheduledBy || request.createdBy,
        text: `went live as scheduled${channels(request)}`,
      });

      // It is out, so the job raised to get it out is finished too.
      await closePostingWorkForApproval(request._id, null, now);

      const recipients = new Set([String(request.createdBy)]);
      if (request.scheduledBy) recipients.add(String(request.scheduledBy));
      if (request.assignedTo) recipients.add(String(request.assignedTo));
      const admins = await User.find({ isActive: true, isSuperAdmin: true }).select('_id');
      admins.forEach((a) => recipients.add(String(a._id)));

      await Promise.all([...recipients].map((id) => createNotification({
        recipient: id,
        organization: request.organization,
        type: NOTIFICATION_TYPES.CONTENT_POSTED,
        title: 'Scheduled post is live',
        message: `"${request.title}" went live as scheduled${channels(request)}.`,
        link: `/approvals/${request._id}`,
        relatedRequest: request._id,
      })));

      published.push(request._id);
    } catch (err) {
      // One bad row must not stop the rest of the sweep.
      console.error(`scheduled post ${request._id} failed:`, err.message);
    }
  }

  // A handler can book the same time on the posting job in their assigned work.
  // Closing those here keeps the two views in step: the board says posted and so
  // does their list, without either of them waiting on a click.
  const dueJobs = await WorkAssignment.find({
    status: { $ne: 'DONE' },
    scheduledAt: { $ne: null, $lte: now },
  }).limit(200);

  for (const job of dueJobs) {
    try {
      const owner = await User.findById(job.assignee).select('name');
      await completePostingWork(job, owner || { _id: job.assignee, name: 'the assignee' }, now);
      await createNotification({
        recipient: job.assignee,
        organization: job.organization,
        type: NOTIFICATION_TYPES.CONTENT_POSTED,
        title: 'Scheduled post is live',
        message: `"${job.title}" went out as scheduled and is marked posted.`,
        link: '/my-assigned-work',
        relatedRequest: job._id,
      });
      published.push(job._id);
    } catch (err) {
      console.error(`scheduled posting job ${job._id} failed:`, err.message);
    }
  }

  return published;
};

export const startScheduledPostWatcher = () => {
  const tick = () => {
    publishDueScheduledPosts().then((ids) => {
      if (ids.length) console.log(`   Published ${ids.length} scheduled post(s)`);
    }).catch((err) => console.error('scheduled post sweep failed:', err.message));
  };
  tick(); // catch anything that fell due while the server was down
  const timer = setInterval(tick, CHECK_INTERVAL_MS);
  timer.unref?.();
  return timer;
};
