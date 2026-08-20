import asyncHandler from 'express-async-handler';
import WebTask, { WEB_TASK_TYPES, WEB_TASK_STATUS } from '../models/WebTask.js';
import Organization from '../models/Organization.js';
import User from '../models/User.js';
import { logActivity } from '../utils/logActivity.js';
import { createNotification } from '../utils/notify.js';
import { accessibleOrgIds, canAccessOrg, resolveOrgId } from '../utils/org.js';
import { ACTIVITY_ACTIONS, NOTIFICATION_TYPES } from '../config/constants.js';
import { assertCanDeleteOrgItem } from '../utils/permissions.js';

const populate = (q) => q
  .populate('organization', 'name color code')
  .populate('assignee', 'name avatar email')
  .populate('requestedBy', 'name avatar')
  .populate('website', 'institution domain');

// @route GET /api/web-tasks — scoped: super admin all, Admin their institutions,
// everyone else their own college.
export const listWebTasks = asyncHandler(async (req, res) => {
  const { status, taskType, search, organizationId, from, to } = req.query;
  const query = {};

  const allowed = accessibleOrgIds(req.user);
  if (allowed !== null) query.organization = { $in: allowed };
  if (organizationId && organizationId !== 'All') {
    query.organization = canAccessOrg(req.user, organizationId) ? organizationId : null;
  }
  if (taskType && taskType !== 'All') query.taskType = taskType;
  if (search) {
    const rx = { $regex: String(search), $options: 'i' };
    query.$or = [{ title: rx }, { details: rx }, { url: rx }, { notes: rx }];
  }
  const isDay = (s) => /^\d{4}-\d{2}-\d{2}$/.test(s || '');
  if (isDay(from) || isDay(to)) {
    query.createdAt = {};
    if (isDay(from)) query.createdAt.$gte = new Date(`${from}T00:00:00.000Z`);
    if (isDay(to)) query.createdAt.$lte = new Date(`${to}T23:59:59.999Z`);
  }

  // The status filter narrows the list only. Counting out of the narrowed list
  // would report zero for every status the caller did not ask for, so the tallies
  // are taken from the same scope minus the status.
  const listQuery = (status && status !== 'All') ? { ...query, status } : query;
  const [tasks, scoped] = await Promise.all([
    populate(WebTask.find(listQuery).sort({ createdAt: -1 })).lean({ virtuals: true }),
    WebTask.find(query).select('status').lean(),
  ]);
  const counts = { OPEN: 0, IN_PROGRESS: 0, BLOCKED: 0, COMPLETED: 0 };
  scoped.forEach((t) => { if (counts[t.status] !== undefined) counts[t.status] += 1; });

  res.json({ success: true, taskTypes: WEB_TASK_TYPES, statuses: WEB_TASK_STATUS, counts, tasks });
});

// @route POST /api/web-tasks — raise website work for a college.
export const createWebTask = asyncHandler(async (req, res) => {
  const { title, taskType, details, url, dueDate, assignee, notes } = req.body;
  if (!title || !String(title).trim()) { res.status(400); throw new Error('Give the task a title'); }
  if (taskType && !WEB_TASK_TYPES.includes(taskType)) {
    res.status(400); throw new Error(`taskType must be one of ${WEB_TASK_TYPES.join(', ')}`);
  }

  const orgId = req.body.organization || resolveOrgId(req);
  if (!orgId) { res.status(400); throw new Error('Choose the college this is for'); }
  if (!canAccessOrg(req.user, orgId)) { res.status(403); throw new Error('You do not have access to that college'); }
  const org = await Organization.findById(orgId).select('_id name isActive');
  if (!org || !org.isActive) { res.status(400); throw new Error('That college does not exist'); }

  let due;
  if (dueDate) {
    due = new Date(dueDate);
    if (Number.isNaN(due.getTime())) { res.status(400); throw new Error('That due date is not valid'); }
  }

  // The web developer it goes to, if one is named.
  let assigneeId = null;
  if (assignee) {
    const person = await User.findOne({ _id: assignee, isActive: true }).select('_id name');
    if (!person) { res.status(400); throw new Error('Selected assignee not found'); }
    assigneeId = person._id;
  }

  const task = await WebTask.create({
    organization: org._id,
    title: String(title).trim(),
    taskType: taskType || 'Content / page updates',
    details: String(details || '').trim(),
    url: String(url || '').trim(),
    dueDate: due,
    assignee: assigneeId,
    requestedBy: req.user._id,
    notes: String(notes || '').trim(),
  });

  await logActivity({
    user: req.user._id, organization: org._id, action: ACTIVITY_ACTIONS.WEB_TASK_UPDATED,
    description: `Raised web task "${task.title}" for ${org.name}`,
    entityType: 'WebTask', entityId: task._id,
  });
  if (assigneeId) {
    await createNotification({
      recipient: assigneeId, organization: org._id, type: NOTIFICATION_TYPES.WORK_ASSIGNED,
      title: 'Website task assigned to you',
      message: `${req.user.name} assigned "${task.title}"${due ? ` — due ${due.toISOString().slice(0, 10)}` : ''}`,
      link: '/web-tasks', relatedRequest: task._id,
    });
  }

  const created = await populate(WebTask.findById(task._id)).lean({ virtuals: true });
  res.status(201).json({ success: true, task: created });
});

// @route PUT /api/web-tasks/:id — move it along, or correct it.
export const updateWebTask = asyncHandler(async (req, res) => {
  const task = await WebTask.findById(req.params.id);
  if (!task) { res.status(404); throw new Error('Task not found'); }
  if (!canAccessOrg(req.user, task.organization)) {
    res.status(403); throw new Error('That task belongs to a college you do not have access to');
  }

  const { title, taskType, details, url, dueDate, assignee, notes, status } = req.body;
  if (title !== undefined) {
    if (!String(title).trim()) { res.status(400); throw new Error('Give the task a title'); }
    task.title = String(title).trim();
  }
  if (taskType !== undefined) {
    if (!WEB_TASK_TYPES.includes(taskType)) { res.status(400); throw new Error('Invalid task type'); }
    task.taskType = taskType;
  }
  if (details !== undefined) task.details = String(details).trim();
  if (url !== undefined) task.url = String(url).trim();
  if (notes !== undefined) task.notes = String(notes).trim();
  if (dueDate !== undefined) {
    if (!dueDate) task.dueDate = undefined;
    else {
      const due = new Date(dueDate);
      if (Number.isNaN(due.getTime())) { res.status(400); throw new Error('That due date is not valid'); }
      task.dueDate = due;
    }
  }
  if (assignee !== undefined) task.assignee = assignee || null;

  if (status !== undefined) {
    if (!WEB_TASK_STATUS.includes(status)) { res.status(400); throw new Error('Invalid status'); }
    task.status = status;
    // completedAt is what the turnaround and on-time figures are measured from,
    // so it is stamped here rather than trusted from the client.
    if (status === 'COMPLETED') task.completedAt = task.completedAt || new Date();
    else task.completedAt = undefined;
  }

  await task.save();
  await logActivity({
    user: req.user._id, organization: task.organization, action: ACTIVITY_ACTIONS.WEB_TASK_UPDATED,
    description: `Updated web task "${task.title}"${status ? ` → ${status.toLowerCase()}` : ''}`,
    entityType: 'WebTask', entityId: task._id,
  });

  const updated = await populate(WebTask.findById(task._id)).lean({ virtuals: true });
  res.json({ success: true, task: updated });
});

// @route DELETE /api/web-tasks/:id  (super admin)
export const deleteWebTask = asyncHandler(async (req, res) => {
  const task = await WebTask.findById(req.params.id);
  if (!task) { res.status(404); throw new Error('Task not found'); }
  assertCanDeleteOrgItem(req, res, task.organization, 'a web task');
  await task.deleteOne();
  res.json({ success: true, message: 'Task removed' });
});
