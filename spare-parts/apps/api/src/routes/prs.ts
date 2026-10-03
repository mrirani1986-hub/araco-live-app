import { Router } from 'express';
import { z } from 'zod';
import { Prisma } from '@prisma/client';
import { prisma } from '../lib/prisma.js';
import { can, requirePerm } from '../lib/auth.js';
import { forbidden } from '../lib/errors.js';
import { idParam, optDate, optStr, pageArgs, qInt, qStr } from '../lib/http.js';
import { prTotals } from '../lib/money.js';
import {
  actOnPr, addLineToDraft, revisePr, activeSteps, canViewPr, cancelPr, createPr, loadPr, pendingForUser, prInclude, submitPr, updatePr, withTotals,
} from '../services/pr.js';
import { sendExport, sendPdf } from '../services/export.js';
import { prPdf, partPictureKeys } from '../pdf/documents.js';

const r = Router();

const lineSchema = z.object({
  partId: z.coerce.number().int().positive(),
  quantity: z.coerce.number().positive(),
  estUnitPrice: z.coerce.number().min(0).nullish(),
  supplierId: z.coerce.number().int().positive().nullish(),
  equipmentId: z.coerce.number().int().positive().nullish(),
  machine: optStr, requiredDate: optDate, reason: optStr, notes: optStr,
});
const headerSchema = z.object({
  companyId: z.coerce.number().int().positive().nullish(),
  department: optStr, project: optStr, requiredDate: optDate, priority: z.enum(['LOW', 'NORMAL', 'HIGH', 'URGENT']).optional(),
  reason: optStr, notes: optStr,
});

function listWhere(req: Parameters<typeof can>[0]): Prisma.PurchaseRequisitionWhereInput {
  const status = qStr(req.query.status);
  const q = qStr(req.query.q);
  const scope = qStr(req.query.scope);
  const where: Prisma.PurchaseRequisitionWhereInput = {};
  if (status) where.status = { in: status.split(',') };
  const companyId = qInt(req.query.companyId);
  if (companyId) where.companyId = companyId;
  if (q) where.OR = [{ prNumber: { contains: q, mode: 'insensitive' } }, { project: { contains: q, mode: 'insensitive' } }, { items: { some: { part: { partNumber: { contains: q, mode: 'insensitive' } } } } }];
  const from = qStr(req.query.from), to = qStr(req.query.to);
  if (from || to) where.requestDate = { gte: from ? new Date(from) : undefined, lte: to ? new Date(to + 'T23:59:59') : undefined };
  // Visibility
  if (scope === 'mine' || !(can(req, 'pr.view_all') || can(req, 'pr.view_approved') || can(req, 'pr.approve'))) {
    where.requestedBy = req.user!.id;
  } else if (!can(req, 'pr.view_all')) {
    const vis: Prisma.PurchaseRequisitionWhereInput[] = [{ requestedBy: req.user!.id }];
    if (can(req, 'pr.view_approved')) vis.push({ status: { in: ['APPROVED', 'CONVERTED_TO_PO'] } });
    if (can(req, 'pr.approve')) vis.push({ status: { in: ['SUBMITTED', 'PENDING_APPROVAL'] } });
    where.AND = [{ OR: vis }];
  }
  return where;
}

r.get('/', async (req, res) => {
  const { skip, take, page, pageSize } = pageArgs(req);
  const where = listWhere(req);
  const [rows, total] = await Promise.all([
    prisma.purchaseRequisition.findMany({ where, orderBy: { id: 'desc' }, skip, take, include: { company: { select: { id: true, name: true } }, requester: { select: { fullName: true } }, items: { select: { quantity: true, estUnitPrice: true } } } }),
    prisma.purchaseRequisition.count({ where }),
  ]);
  res.json({ page, pageSize, total, items: rows.map((p) => ({ ...p, items: undefined, lineCount: p.items.length, totals: prTotals(p.items, p.taxRate) })) });
});

r.get('/export', requirePerm('export.run'), async (req, res) => {
  const rows = await prisma.purchaseRequisition.findMany({ where: listWhere(req), orderBy: { id: 'desc' }, include: { company: true, requester: true, items: true } });
  await sendExport(res, String(req.query.format ?? 'xlsx'), 'Purchase Requisitions', [
    { key: 'prNumber', label: 'PR Number' }, { key: 'company', label: 'Company' }, { key: 'requestDate', label: 'Date', format: 'date' }, { key: 'requester', label: 'Requested by' },
    { key: 'department', label: 'Department' }, { key: 'project', label: 'Project' }, { key: 'priority', label: 'Priority' },
    { key: 'requiredDate', label: 'Required', format: 'date' }, { key: 'status', label: 'Status' }, { key: 'lines', label: 'Lines', align: 'r' },
    { key: 'total', label: 'Est. Total', align: 'r', format: 'num' }, { key: 'currency', label: 'Cur.' },
  ], rows.map((p) => ({ ...p, company: p.company?.name ?? '', requester: p.requester.fullName, lines: p.items.length, total: prTotals(p.items, p.taxRate).grandTotal })));
});

r.get('/pending', requirePerm('pr.approve'), async (req, res) => res.json(await pendingForUser(req)));

r.get('/workflow', async (_req, res) => {
  res.json(await prisma.approvalStep.findMany({ where: { docType: 'PR' }, orderBy: { level: 'asc' } }));
});

r.get('/:id', async (req, res) => {
  const pr = await loadPr(idParam(req));
  if (!canViewPr(req, pr)) throw forbidden();
  const pics = await partPictureKeys(pr.items.map((i) => i.partId));
  const t = withTotals(pr);
  const steps = await activeSteps(t.totals.grandTotal);
  const pos = await prisma.purchaseOrder.findMany({ where: { prId: pr.id }, select: { id: true, poNumber: true, status: true, supplier: { select: { name: true } } } });
  res.json({ ...t, items: t.items.map((i) => ({ ...i, picture: pics.get(i.partId) ?? null })), steps, purchaseOrders: pos });
});

r.get('/:id/pdf', async (req, res) => {
  const id = idParam(req);
  const pr = await prisma.purchaseRequisition.findUnique({ where: { id }, include: prInclude });
  if (!pr || !canViewPr(req, pr)) throw forbidden();
  sendPdf(res, await prPdf(id), `${pr.prNumber}.pdf`);
});

r.post('/', requirePerm('pr.create'), async (req, res) => {
  const body = headerSchema.extend({ lines: z.array(lineSchema).min(1) }).parse(req.body);
  res.status(201).json(await createPr(req, body, body.lines));
});

r.patch('/:id', requirePerm('pr.create'), async (req, res) => {
  const body = headerSchema.extend({ lines: z.array(lineSchema).min(1).optional() }).parse(req.body);
  res.json(await updatePr(req, idParam(req), body, body.lines));
});

// "Add to PR": append a part to one of my DRAFT PRs
r.post('/:id/lines', requirePerm('pr.create'), async (req, res) => {
  res.json(await addLineToDraft(req, idParam(req), lineSchema.parse(req.body)));
});

const commentSchema = z.object({ comment: optStr });
r.post('/:id/submit', requirePerm('pr.create'), async (req, res) => res.json(await submitPr(req, idParam(req), commentSchema.parse(req.body ?? {}).comment ?? undefined)));
r.post('/:id/approve', requirePerm('pr.approve'), async (req, res) => res.json(await actOnPr(req, idParam(req), 'APPROVE', commentSchema.parse(req.body ?? {}).comment ?? undefined)));
r.post('/:id/reject', requirePerm('pr.approve'), async (req, res) => res.json(await actOnPr(req, idParam(req), 'REJECT', commentSchema.parse(req.body ?? {}).comment ?? undefined)));
r.post('/:id/return', requirePerm('pr.approve'), async (req, res) => res.json(await actOnPr(req, idParam(req), 'RETURN', commentSchema.parse(req.body ?? {}).comment ?? undefined)));
r.post('/:id/revise', requirePerm('pr.create'), async (req, res) => res.json(await revisePr(req, idParam(req), commentSchema.parse(req.body ?? {}).comment ?? undefined)));
r.post('/:id/cancel', async (req, res) => res.json(await cancelPr(req, idParam(req), commentSchema.parse(req.body ?? {}).comment ?? undefined)));

export default r;
