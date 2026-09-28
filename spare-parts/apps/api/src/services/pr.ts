import type { Request } from 'express';
import { Prisma } from '@prisma/client';
import { prisma, withTx, type Tx } from '../lib/prisma.js';
import { nextNumber } from '../lib/numbering.js';
import { audit } from '../lib/audit.js';
import { HttpError, badRequest, forbidden, notFound } from '../lib/errors.js';
import { getSettings } from '../lib/settings.js';
import { D, prTotals } from '../lib/money.js';
import { can, hasRole } from '../lib/auth.js';

export const PR_EDITABLE = ['DRAFT'];
export const PR_IN_APPROVAL = ['SUBMITTED', 'PENDING_APPROVAL'];

export const prInclude = {
  requester: { select: { id: true, fullName: true, username: true, department: true } },
  items: {
    orderBy: { lineNo: 'asc' as const },
    include: {
      part: { select: { id: true, partNumber: true, name: true, unit: true, specification: true } },
      supplier: { select: { id: true, name: true, code: true } },
    },
  },
  approvals: { orderBy: { id: 'asc' as const }, include: { user: { select: { id: true, fullName: true, username: true } } } },
} satisfies Prisma.PurchaseRequisitionInclude;

export type PrFull = Prisma.PurchaseRequisitionGetPayload<{ include: typeof prInclude }>;

export async function loadPr(id: number, db: Tx | typeof prisma = prisma): Promise<PrFull> {
  const pr = await db.purchaseRequisition.findUnique({ where: { id }, include: prInclude });
  if (!pr) throw notFound('Purchase requisition');
  return pr;
}

export function canViewPr(req: Request, pr: { requestedBy: number; status: string }) {
  if (pr.requestedBy === req.user!.id || can(req, 'pr.view_all')) return true;
  if (can(req, 'pr.view_approved') && ['APPROVED', 'CONVERTED_TO_PO'].includes(pr.status)) return true;
  if (can(req, 'pr.approve') && PR_IN_APPROVAL.includes(pr.status)) return true;
  return false;
}

export async function activeSteps(total: number) {
  const steps = await prisma.approvalStep.findMany({ where: { docType: 'PR', active: true }, orderBy: { level: 'asc' } });
  return steps.filter((s) => s.minTotal == null || total >= Number(s.minTotal));
}

export function withTotals(pr: PrFull) {
  return { ...pr, totals: prTotals(pr.items, pr.taxRate) };
}

export interface PrLineInput {
  partId: number;
  quantity: number;
  estUnitPrice?: number | null;
  supplierId?: number | null;
  equipmentId?: number | null;
  machine?: string | null;
  requiredDate?: string | null;
  reason?: string | null;
  notes?: string | null;
}

export interface PrHeaderInput {
  department?: string | null;
  project?: string | null;
  requiredDate?: string | null;
  priority?: 'LOW' | 'NORMAL' | 'HIGH' | 'URGENT';
  reason?: string | null;
  notes?: string | null;
}

/** Builds snapshot line data (description/spec/price frozen at the time of the request). */
async function buildLines(tx: Tx, lines: PrLineInput[]) {
  if (!lines.length) throw badRequest('A purchase requisition needs at least one line');
  const parts = await tx.part.findMany({
    where: { id: { in: lines.map((l) => l.partId) } },
    include: { supplierParts: { orderBy: [{ isPreferred: 'desc' }, { price: 'asc' }] } },
  });
  const byId = new Map(parts.map((p) => [p.id, p]));
  return lines.map((l, i) => {
    const p = byId.get(l.partId);
    if (!p) throw badRequest(`Part ${l.partId} does not exist`);
    if (!(l.quantity > 0)) throw badRequest(`Line ${i + 1}: quantity must be greater than zero`);
    const sp = l.supplierId ? p.supplierParts.find((s) => s.supplierId === l.supplierId) : p.supplierParts[0];
    return {
      lineNo: i + 1,
      partId: p.id,
      description: p.description ? `${p.name} — ${p.description}` : p.name,
      specification: p.specification,
      quantity: new Prisma.Decimal(l.quantity),
      unit: p.unit,
      estUnitPrice: l.estUnitPrice != null ? new Prisma.Decimal(l.estUnitPrice) : (sp?.price ?? p.standardPrice ?? null),
      supplierId: l.supplierId ?? sp?.supplierId ?? null,
      equipmentId: l.equipmentId ?? null,
      machine: l.machine ?? null,
      requiredDate: l.requiredDate ? new Date(l.requiredDate) : null,
      reason: l.reason ?? null,
      notes: l.notes ?? null,
    };
  });
}

export async function createPr(req: Request, header: PrHeaderInput, lines: PrLineInput[], opts: { fromCart?: boolean } = {}) {
  const settings = await getSettings();
  const id = await withTx(async (tx) => {
    const data = await buildLines(tx, lines);
    const prNumber = await nextNumber(tx, 'PR');
    const pr = await tx.purchaseRequisition.create({
      data: {
        prNumber,
        requestedBy: req.user!.id,
        department: header.department ?? req.user!.department,
        project: header.project,
        requiredDate: header.requiredDate ? new Date(header.requiredDate) : null,
        priority: header.priority ?? 'NORMAL',
        reason: header.reason,
        notes: header.notes,
        currency: settings.currency,
        taxRate: settings.taxRate,
        items: { create: data },
      },
      include: { items: true },
    });
    if (opts.fromCart) await tx.cartItem.deleteMany({ where: { userId: req.user!.id, partId: { in: lines.map((l) => l.partId) } } });
    await audit(req, { action: 'PR_CREATED', docType: 'PR', docId: pr.id, docNumber: prNumber, newValue: { header, lines: data.length } }, tx);
    return pr.id;
  });
  return withTotals(await loadPr(id));
}

function assertOwnerDraft(req: Request, pr: { requestedBy: number; status: string; prNumber: string }) {
  if (!PR_EDITABLE.includes(pr.status)) throw new HttpError(409, `${pr.prNumber} is ${pr.status} and can no longer be edited`);
  if (pr.requestedBy !== req.user!.id && !hasRole(req, 'ADMIN')) throw forbidden('Only the requester can edit this PR');
}

export async function updatePr(req: Request, id: number, header: PrHeaderInput, lines?: PrLineInput[]) {
  await withTx(async (tx) => {
    const before = await loadPr(id, tx);
    // Lock the row so a concurrent submit/approve cannot interleave with the edit.
    await tx.$queryRaw`SELECT id FROM purchase_requisitions WHERE id = ${id} FOR UPDATE`;
    const fresh = await tx.purchaseRequisition.findUniqueOrThrow({ where: { id } });
    assertOwnerDraft(req, fresh);
    await tx.purchaseRequisition.update({
      where: { id },
      data: {
        department: header.department, project: header.project, priority: header.priority, reason: header.reason,
        notes: header.notes, requiredDate: header.requiredDate === undefined ? undefined : header.requiredDate ? new Date(header.requiredDate) : null,
      },
    });
    if (lines) {
      const data = await buildLines(tx, lines);
      await tx.purchaseRequisitionItem.deleteMany({ where: { prId: id } });
      await tx.purchaseRequisitionItem.createMany({ data: data.map((d) => ({ ...d, prId: id })) });
    }
    const after = await loadPr(id, tx);
    await audit(req, {
      action: 'PR_EDITED', docType: 'PR', docId: id, docNumber: before.prNumber,
      oldValue: snapshot(before), newValue: snapshot(after),
    }, tx);
  });
  return withTotals(await loadPr(id));
}

const snapshot = (pr: PrFull) => ({
  department: pr.department, project: pr.project, priority: pr.priority, reason: pr.reason,
  requiredDate: pr.requiredDate, lines: pr.items.map((i) => ({ part: i.part.partNumber, qty: Number(i.quantity), price: i.estUnitPrice == null ? null : Number(i.estUnitPrice) })),
});

export async function addLineToDraft(req: Request, id: number, line: PrLineInput) {
  const pr = await loadPr(id);
  const existing = pr.items.map((i) => ({
    partId: i.partId, quantity: Number(i.quantity), estUnitPrice: i.estUnitPrice == null ? null : Number(i.estUnitPrice),
    supplierId: i.supplierId, equipmentId: i.equipmentId, machine: i.machine, requiredDate: i.requiredDate?.toISOString() ?? null,
    reason: i.reason, notes: i.notes,
  }));
  const same = existing.find((e) => e.partId === line.partId);
  if (same) same.quantity += line.quantity;
  else existing.push(line as never);
  return updatePr(req, id, {}, existing);
}

export async function submitPr(req: Request, id: number, comment?: string) {
  await withTx(async (tx) => {
    await tx.$queryRaw`SELECT id FROM purchase_requisitions WHERE id = ${id} FOR UPDATE`;
    const pr = await loadPr(id, tx);
    assertOwnerDraft(req, pr);
    if (!pr.items.length) throw badRequest('Add at least one line before submitting');
    const total = prTotals(pr.items, pr.taxRate).grandTotal;
    const steps = await activeSteps(total);
    const firstLevel = steps[0]?.level ?? null;
    await tx.purchaseRequisition.update({
      where: { id },
      data: {
        status: steps.length ? 'SUBMITTED' : 'APPROVED', currentLevel: firstLevel, submittedAt: new Date(),
        approvedAt: steps.length ? null : new Date(),
      },
    });
    await tx.approval.create({ data: { prId: id, level: 0, stepName: 'Requester', action: 'SUBMITTED', userId: req.user!.id, comment } });
    await audit(req, { action: 'PR_SUBMITTED', docType: 'PR', docId: id, docNumber: pr.prNumber, oldValue: { status: pr.status }, newValue: { status: steps.length ? 'SUBMITTED' : 'APPROVED' }, comment }, tx);
  });
  return withTotals(await loadPr(id));
}

export type ApprovalAction = 'APPROVE' | 'REJECT' | 'RETURN';

export async function actOnPr(req: Request, id: number, action: ApprovalAction, comment?: string) {
  if ((action === 'REJECT' || action === 'RETURN') && !comment?.trim()) throw badRequest('A comment is required when rejecting or returning a PR');
  await withTx(async (tx) => {
    await tx.$queryRaw`SELECT id FROM purchase_requisitions WHERE id = ${id} FOR UPDATE`;
    const pr = await loadPr(id, tx);
    if (!PR_IN_APPROVAL.includes(pr.status)) throw new HttpError(409, `${pr.prNumber} is ${pr.status}; it is not waiting for approval`);
    const total = prTotals(pr.items, pr.taxRate).grandTotal;
    const steps = await activeSteps(total);
    const step = steps.find((s) => s.level === pr.currentLevel);
    if (!step) throw new HttpError(409, 'Approval step configuration changed; please ask an administrator');
    if (!hasRole(req, 'ADMIN') && !(can(req, 'pr.approve') && hasRole(req, step.roleCode))) {
      throw forbidden(`This PR is waiting for "${step.name}" approval`);
    }
    if (pr.requestedBy === req.user!.id && !hasRole(req, 'ADMIN')) throw forbidden('You cannot approve your own PR');
    const next = steps.find((s) => s.level > step.level);
    let status = pr.status;
    let currentLevel: number | null = pr.currentLevel;
    let approvedAt: Date | null = null;
    let actionName: string;
    if (action === 'APPROVE') {
      actionName = 'APPROVED';
      if (next) { status = 'PENDING_APPROVAL'; currentLevel = next.level; }
      else { status = 'APPROVED'; currentLevel = null; approvedAt = new Date(); }
    } else if (action === 'REJECT') {
      actionName = 'REJECTED'; status = 'REJECTED'; currentLevel = null;
    } else {
      actionName = 'RETURNED'; status = 'DRAFT'; currentLevel = null;
    }
    await tx.purchaseRequisition.update({
      where: { id },
      data: { status, currentLevel, approvedAt, version: action === 'RETURN' ? { increment: 1 } : undefined },
    });
    await tx.approval.create({ data: { prId: id, level: step.level, stepName: step.name, action: actionName, userId: req.user!.id, comment } });
    await audit(req, {
      action: `PR_${actionName}`, docType: 'PR', docId: id, docNumber: pr.prNumber,
      oldValue: { status: pr.status, level: pr.currentLevel }, newValue: { status, level: currentLevel, step: step.name }, comment,
    }, tx);
  });
  return withTotals(await loadPr(id));
}

export async function cancelPr(req: Request, id: number, comment?: string) {
  await withTx(async (tx) => {
    await tx.$queryRaw`SELECT id FROM purchase_requisitions WHERE id = ${id} FOR UPDATE`;
    const pr = await loadPr(id, tx);
    if (!['DRAFT', 'SUBMITTED', 'PENDING_APPROVAL', 'APPROVED'].includes(pr.status)) throw new HttpError(409, `${pr.prNumber} is ${pr.status} and cannot be cancelled`);
    if (pr.items.some((i) => D(i.qtyOrdered).gt(0))) throw new HttpError(409, 'Purchase orders already exist for this PR; cancel those first');
    const isOwner = pr.requestedBy === req.user!.id;
    if (!isOwner && !hasRole(req, 'ADMIN') && !(pr.status === 'APPROVED' && can(req, 'po.create'))) throw forbidden();
    await tx.purchaseRequisition.update({ where: { id }, data: { status: 'CANCELLED', currentLevel: null } });
    await tx.approval.create({ data: { prId: id, level: pr.currentLevel ?? 0, stepName: isOwner ? 'Requester' : 'Cancellation', action: 'CANCELLED', userId: req.user!.id, comment } });
    await audit(req, { action: 'PR_CANCELLED', docType: 'PR', docId: id, docNumber: pr.prNumber, oldValue: { status: pr.status }, newValue: { status: 'CANCELLED' }, comment }, tx);
  });
  return withTotals(await loadPr(id));
}

/** PRs this user can act on right now. */
export async function pendingForUser(req: Request) {
  const prs = await prisma.purchaseRequisition.findMany({
    where: { status: { in: PR_IN_APPROVAL } },
    include: prInclude,
    orderBy: { submittedAt: 'asc' },
  });
  const out = [];
  for (const pr of prs) {
    const total = prTotals(pr.items, pr.taxRate).grandTotal;
    const step = (await activeSteps(total)).find((s) => s.level === pr.currentLevel);
    if (!step) continue;
    const mine = hasRole(req, 'ADMIN') || (can(req, 'pr.approve') && hasRole(req, step.roleCode));
    if (mine && pr.requestedBy !== req.user!.id) out.push({ ...withTotals(pr), waitingFor: step.name });
  }
  return out;
}
