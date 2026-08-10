import asyncHandler from 'express-async-handler';
import Purchase from '../models/Purchase.js';
import { accessibleOrgIds, requireOrgId } from '../utils/org.js';

// ?organizationId=all rolls every college the caller can see into one list.
const ALL_ORGS = 'all';

const FIELDS = ['name', 'vendor', 'category', 'seats', 'cost', 'currency', 'purchaseDate', 'expiryDate', 'notes'];

const apply = (doc, body) => {
  for (const f of FIELDS) {
    if (body[f] === undefined) continue;
    if (f === 'seats' || f === 'cost') doc[f] = Number(body[f]) || 0;
    else if (f === 'purchaseDate' || f === 'expiryDate') doc[f] = body[f] ? new Date(body[f]) : undefined;
    else doc[f] = body[f];
  }
};

// @route GET /api/purchases — purchases for the active org (soonest expiry first),
// or every organization the caller can see with ?organizationId=all.
//
// The roll-up is scoped the same way everything else is: a super admin sees every
// college, an Admin only the institutions they hold. It carries the organization
// on each row so the table can say which college a purchase belongs to.
export const listPurchases = asyncHandler(async (req, res) => {
  if (String(req.query.organizationId || '').toLowerCase() === ALL_ORGS) {
    const allowed = accessibleOrgIds(req.user);
    const query = allowed === null ? {} : { organization: { $in: allowed } };
    const purchases = await Purchase.find(query)
      .populate('organization', 'name color')
      .sort({ expiryDate: 1, createdAt: -1 })
      .lean();
    return res.json({ success: true, scope: ALL_ORGS, purchases });
  }

  const orgId = requireOrgId(req, res);
  const purchases = await Purchase.find({ organization: orgId }).sort({ expiryDate: 1, createdAt: -1 }).lean();
  res.json({ success: true, purchases });
});

// @route POST /api/purchases  (ADMIN)
export const createPurchase = asyncHandler(async (req, res) => {
  const orgId = requireOrgId(req, res);
  if (!req.body.name?.trim()) { res.status(400); throw new Error('A name is required'); }
  const doc = new Purchase({ organization: orgId });
  apply(doc, req.body);
  await doc.save();
  res.status(201).json({ success: true, purchase: doc });
});

// @route PUT /api/purchases/:id  (ADMIN)
export const updatePurchase = asyncHandler(async (req, res) => {
  const orgId = requireOrgId(req, res);
  const doc = await Purchase.findOne({ _id: req.params.id, organization: orgId });
  if (!doc) { res.status(404); throw new Error('Purchase not found'); }
  apply(doc, req.body);
  await doc.save();
  res.json({ success: true, purchase: doc });
});

// @route DELETE /api/purchases/:id  (ADMIN)
export const deletePurchase = asyncHandler(async (req, res) => {
  const orgId = requireOrgId(req, res);
  const doc = await Purchase.findOneAndDelete({ _id: req.params.id, organization: orgId });
  if (!doc) { res.status(404); throw new Error('Purchase not found'); }
  res.json({ success: true, id: req.params.id });
});
