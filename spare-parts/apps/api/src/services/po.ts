import type { Request } from 'express';
import { Prisma } from '@prisma/client';
import { prisma, withTx, type Tx } from '../lib/prisma.js';
import { nextNumber } from '../lib/numbering.js';
import { audit } from '../lib/audit.js';
import { HttpError, badRequest, notFound } from '../lib/errors.js';
import { getSettings } from '../lib/settings.js';
import { D, poLineTotals, poTotals } from '../lib/money.js';
import { loadPr } from './pr.js';

export const poInclude = {
  supplier: true,
  buyer: { select: { id: true, fullName: true, username: true } },
  items: {
    orderBy: { lineNo: 'asc' as const },
    include: {
      part: { select: { id: true, partNumber: true, name: true, unit: true } },
      prItem: { select: { id: true, prId: true, lineNo: true } },
    },
  },
  receipts: { orderBy: { id: 'asc' as const }, include: { receiver: { select: { fullName: true } }, items: true } },
  approvals: { orderBy: { id: 'asc' as const }, include: { user: { select: { fullName: true, username: true } } } },
} satisfies Prisma.PurchaseOrderInclude;

export type PoFull = Prisma.PurchaseOrderGetPayload<{ include: typeof poInclude }>;
export const PO_RECEIVABLE = ['APPROVED', 'SENT', 'PARTIALLY_RECEIVED'];
export const PO_OPEN = ['DRAFT', 'APPROVED', 'SENT', 'PARTIALLY_RECEIVED'];

export async function loadPo(id: number, db: Tx | typeof prisma = prisma): Promise<PoFull> {
  const po = await db.purchaseOrder.findUnique({ where: { id }, include: poInclude });
  if (!po) throw notFound('Purchase order');
  return po;
}

export function withPoTotals(po: PoFull) {
  const totals = poTotals(po.items, po.shippingCost, po.otherCharges);
  const overdue = !!po.expectedDelivery && PO_RECEIVABLE.includes(po.status) && po.expectedDelivery < new Date();
  return {
    ...po,
    totals,
    overdue,
    items: po.items.map((i) => ({ ...i, lineTotal: Number(poLineTotals(i).total), remaining: Number(i.quantity) - Number(i.qtyReceived) })),
  };
}

export interface PoLineInput {
  prItemId?: number | null;
  partId?: number;
  quantity: number;
  unitPrice: number;
  discountPct?: number;
  taxPct?: number;
  supplierPartNumber?: string | null;
  description?: string | null;
}

export interface PoHeaderInput {
  currency?: string;
  paymentTerms?: string | null;
  deliveryTerms?: string | null;
  expectedDelivery?: string | null;
  shippingMethod?: string | null;
  shippingCost?: number;
  otherCharges?: number;
  terms?: string | null;
  notes?: string | null;
}

const supplierSnapshot = (s: { name: string; company: string | null; address: string | null; phone: string | null; email: string | null; contactPerson: string | null; taxNumber: string | null; country: string | null; code: string }) => ({
  code: s.code, name: s.name, company: s.company, address: s.address, country: s.country, phone: s.phone,
  email: s.email, contactPerson: s.contactPerson, taxNumber: s.taxNumber,
});

async function createOnePo(tx: Tx, req: Request, supplierId: number, header: PoHeaderInput, lines: PoLineInput[], pr?: { id: number; prNumber: string }) {
  const settings = await getSettings(tx);
  const supplier = await tx.supplier.findUnique({ where: { id: supplierId } });
  if (!supplier) throw badRequest(`Supplier ${supplierId} not found`);
  if (supplier.status !== 'ACTIVE') throw badRequest(`Supplier ${supplier.name} is not active`);
  if (!lines.length) throw badRequest('A purchase order needs at least one line');

  const items: Prisma.PurchaseOrderItemCreateWithoutPoInput[] = [];
  let lineNo = 0;
  for (const l of lines) {
    if (!(l.quantity > 0)) throw badRequest('Quantities must be greater than zero');
    if (!(l.unitPrice >= 0)) throw badRequest('Unit price must be zero or more');
    let partId = l.partId;
    let description = l.description ?? undefined;
    let specification: string | null = null;
    if (l.prItemId) {
      // Lock the PR line so two buyers cannot over-order it concurrently.
      await tx.$queryRaw`SELECT id FROM purchase_requisition_items WHERE id = ${l.prItemId} FOR UPDATE`;
      const pri = await tx.purchaseRequisitionItem.findUnique({ where: { id: l.prItemId } });
      if (!pri || (pr && pri.prId !== pr.id)) throw badRequest('PR line does not belong to this PR');
      const open = D(pri.quantity).minus(pri.qtyOrdered);
      if (D(l.quantity).gt(open)) throw new HttpError(409, `PR line ${pri.lineNo}: only ${open} left to order`);
      await tx.purchaseRequisitionItem.update({ where: { id: pri.id }, data: { qtyOrdered: { increment: l.quantity } } });
      partId = pri.partId;
      description = description ?? pri.description;
      specification = pri.specification;
    }
    if (!partId) throw badRequest('Each line needs a part');
    const part = await tx.part.findUniqueOrThrow({ where: { id: partId } });
    const sp = await tx.supplierPart.findUnique({ where: { supplierId_partId: { supplierId, partId } } });
    items.push({
      lineNo: ++lineNo,
      part: { connect: { id: partId } },
      prItem: l.prItemId ? { connect: { id: l.prItemId } } : undefined,
      description: description ?? part.name,
      specification: specification ?? part.specification,
      supplierPartNumber: l.supplierPartNumber ?? sp?.supplierPartNumber ?? null,
      quantity: l.quantity,
      unit: part.unit,
      unitPrice: l.unitPrice,
      discountPct: l.discountPct ?? 0,
      taxPct: l.taxPct ?? settings.taxRate,
    });
  }
  const poNumber = await nextNumber(tx, 'PO');
  const po = await tx.purchaseOrder.create({
    data: {
      poNumber,
      supplierId,
      supplierSnapshot: supplierSnapshot(supplier),
      prId: pr?.id,
      prNumber: pr?.prNumber,
      currency: header.currency ?? supplier.currency ?? settings.currency,
      paymentTerms: header.paymentTerms ?? supplier.paymentTerms ?? settings.defaultPaymentTerms,
      deliveryTerms: header.deliveryTerms ?? supplier.deliveryTerms ?? settings.defaultDeliveryTerms,
      expectedDelivery: header.expectedDelivery ? new Date(header.expectedDelivery) : null,
      shippingMethod: header.shippingMethod,
      shippingCost: header.shippingCost ?? 0,
      otherCharges: header.otherCharges ?? 0,
      terms: header.terms ?? settings.poTerms,
      notes: header.notes,
      buyerId: req.user!.id,
      items: { create: items },
    },
  });
  await audit(req, { action: 'PO_CREATED', docType: 'PO', docId: po.id, docNumber: poNumber, newValue: { supplier: supplier.name, lines: items.length, pr: pr?.prNumber } }, tx);
  return po;
}

/**
 * Converts an approved PR into one PO per supplier. Lines without an explicit
 * supplier use the supplier chosen on the PR line.
 */
export async function createPosFromPr(req: Request, prId: number, lines: (PoLineInput & { supplierId?: number | null })[], header: PoHeaderInput & { perSupplier?: Record<string, PoHeaderInput> }) {
  const created = await withTx(async (tx) => {
    await tx.$queryRaw`SELECT id FROM purchase_requisitions WHERE id = ${prId} FOR UPDATE`;
    const pr = await loadPr(prId, tx);
    if (pr.status !== 'APPROVED') throw new HttpError(409, `${pr.prNumber} must be APPROVED to create a PO (it is ${pr.status})`);
    const groups = new Map<number, PoLineInput[]>();
    for (const l of lines) {
      const pri = pr.items.find((i) => i.id === l.prItemId);
      if (!pri) throw badRequest('Line does not belong to this PR');
      const supplierId = l.supplierId ?? pri.supplierId;
      if (!supplierId) throw badRequest(`Select a supplier for line ${pri.lineNo} (${pri.part.partNumber})`);
      if (!groups.has(supplierId)) groups.set(supplierId, []);
      groups.get(supplierId)!.push(l);
    }
    if (!groups.size) throw badRequest('Select at least one line');
    const pos = [];
    for (const [supplierId, ls] of groups) {
      const h = { ...header, ...(header.perSupplier?.[String(supplierId)] ?? {}) };
      pos.push(await createOnePo(tx, req, supplierId, h, ls, pr));
    }
    const after = await tx.purchaseRequisitionItem.findMany({ where: { prId } });
    if (after.every((i) => D(i.qtyOrdered).gte(i.quantity))) {
      await tx.purchaseRequisition.update({ where: { id: prId }, data: { status: 'CONVERTED_TO_PO' } });
      await audit(req, { action: 'PR_CONVERTED_TO_PO', docType: 'PR', docId: prId, docNumber: pr.prNumber, oldValue: { status: 'APPROVED' }, newValue: { status: 'CONVERTED_TO_PO', pos: pos.map((p) => p.poNumber) } }, tx);
    }
    return pos.map((p) => p.id);
  });
  return Promise.all(created.map(async (id) => withPoTotals(await loadPo(id))));
}

export async function createManualPo(req: Request, supplierId: number, header: PoHeaderInput, lines: PoLineInput[]) {
  const id = await withTx(async (tx) => (await createOnePo(tx, req, supplierId, header, lines.map((l) => ({ ...l, prItemId: null })))).id);
  return withPoTotals(await loadPo(id));
}

export async function updatePo(req: Request, id: number, header: PoHeaderInput, lines?: { id: number; quantity?: number; unitPrice?: number; discountPct?: number; taxPct?: number; supplierPartNumber?: string | null }[]) {
  await withTx(async (tx) => {
    await tx.$queryRaw`SELECT id FROM purchase_orders WHERE id = ${id} FOR UPDATE`;
    const before = await loadPo(id, tx);
    if (before.status !== 'DRAFT') throw new HttpError(409, `${before.poNumber} is ${before.status}; only DRAFT orders can be edited`);
    await tx.purchaseOrder.update({
      where: { id },
      data: {
        currency: header.currency, paymentTerms: header.paymentTerms, deliveryTerms: header.deliveryTerms,
        expectedDelivery: header.expectedDelivery === undefined ? undefined : header.expectedDelivery ? new Date(header.expectedDelivery) : null,
        shippingMethod: header.shippingMethod, shippingCost: header.shippingCost, otherCharges: header.otherCharges,
        terms: header.terms, notes: header.notes,
      },
    });
    for (const l of lines ?? []) {
      const it = before.items.find((i) => i.id === l.id);
      if (!it) throw badRequest('Line does not belong to this PO');
      if (l.quantity !== undefined && l.quantity !== Number(it.quantity)) {
        if (!(l.quantity > 0)) throw badRequest('Quantities must be greater than zero');
        if (it.prItemId) {
          await tx.$queryRaw`SELECT id FROM purchase_requisition_items WHERE id = ${it.prItemId} FOR UPDATE`;
          const pri = await tx.purchaseRequisitionItem.findUniqueOrThrow({ where: { id: it.prItemId } });
          const delta = D(l.quantity).minus(it.quantity);
          if (D(pri.qtyOrdered).plus(delta).gt(pri.quantity)) throw new HttpError(409, `Line ${it.lineNo}: quantity exceeds the approved PR quantity`);
          await tx.purchaseRequisitionItem.update({ where: { id: pri.id }, data: { qtyOrdered: { increment: delta } } });
        }
      }
      await tx.purchaseOrderItem.update({
        where: { id: l.id },
        data: { quantity: l.quantity, unitPrice: l.unitPrice, discountPct: l.discountPct, taxPct: l.taxPct, supplierPartNumber: l.supplierPartNumber },
      });
    }
    const after = await loadPo(id, tx);
    const snap = (p: PoFull) => ({ header: { currency: p.currency, paymentTerms: p.paymentTerms, deliveryTerms: p.deliveryTerms, expectedDelivery: p.expectedDelivery, shipping: Number(p.shippingCost), other: Number(p.otherCharges) }, lines: p.items.map((i) => ({ line: i.lineNo, qty: Number(i.quantity), price: Number(i.unitPrice), disc: Number(i.discountPct), tax: Number(i.taxPct) })) });
    await audit(req, { action: 'PO_EDITED', docType: 'PO', docId: id, docNumber: before.poNumber, oldValue: snap(before), newValue: snap(after) }, tx);
  });
  return withPoTotals(await loadPo(id));
}

export async function changePoStatus(req: Request, id: number, action: 'APPROVE' | 'SEND' | 'CANCEL' | 'CLOSE', comment?: string) {
  await withTx(async (tx) => {
    await tx.$queryRaw`SELECT id FROM purchase_orders WHERE id = ${id} FOR UPDATE`;
    const po = await loadPo(id, tx);
    const rules: Record<string, { from: string[]; to: string; audit: string }> = {
      APPROVE: { from: ['DRAFT'], to: 'APPROVED', audit: 'PO_APPROVED' },
      SEND: { from: ['APPROVED', 'SENT'], to: 'SENT', audit: 'PO_SENT' },
      CANCEL: { from: ['DRAFT', 'APPROVED', 'SENT'], to: 'CANCELLED', audit: 'PO_CANCELLED' },
      CLOSE: { from: ['PARTIALLY_RECEIVED', 'SENT', 'APPROVED'], to: 'CLOSED', audit: 'PO_CLOSED' },
    };
    const r = rules[action];
    if (!r.from.includes(po.status)) throw new HttpError(409, `${po.poNumber} is ${po.status}; cannot ${action.toLowerCase()}`);
    if (action === 'CANCEL' && po.items.some((i) => D(i.qtyReceived).gt(0))) throw new HttpError(409, 'Goods were already received on this PO; close it instead');
    if ((action === 'CANCEL' || action === 'CLOSE') && !comment?.trim()) throw badRequest('Please give a reason');
    if (action === 'CANCEL') {
      // Give the quantities back to the PR so they can be ordered again.
      for (const i of po.items) {
        if (!i.prItemId) continue;
        await tx.purchaseRequisitionItem.update({ where: { id: i.prItemId }, data: { qtyOrdered: { decrement: i.quantity } } });
      }
      if (po.prId) {
        const pr = await tx.purchaseRequisition.findUnique({ where: { id: po.prId } });
        if (pr?.status === 'CONVERTED_TO_PO') await tx.purchaseRequisition.update({ where: { id: pr.id }, data: { status: 'APPROVED' } });
      }
    }
    await tx.purchaseOrder.update({
      where: { id },
      data: {
        status: r.to,
        approvedAt: action === 'APPROVE' ? new Date() : undefined,
        sentAt: action === 'SEND' ? new Date() : undefined,
      },
    });
    await tx.approval.create({ data: { poId: id, level: 1, stepName: 'Purchase order', action: r.to, userId: req.user!.id, comment } });
    await audit(req, { action: r.audit, docType: 'PO', docId: id, docNumber: po.poNumber, oldValue: { status: po.status }, newValue: { status: r.to }, comment }, tx);
  });
  return withPoTotals(await loadPo(id));
}
