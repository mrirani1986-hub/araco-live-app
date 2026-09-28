import type { Request } from 'express';
import { withTx, prisma } from '../lib/prisma.js';
import { nextNumber } from '../lib/numbering.js';
import { audit } from '../lib/audit.js';
import { HttpError, badRequest, notFound } from '../lib/errors.js';
import { getSettings } from '../lib/settings.js';
import { D } from '../lib/money.js';
import { postMovement } from './inventory.js';
import { PO_RECEIVABLE } from './po.js';

export interface GrnLineInput {
  poItemId: number;
  receivedQty: number; // accepted into stock
  rejectedQty?: number;
  locationId?: number;
  condition?: string;
  notes?: string | null;
}

export const grnInclude = {
  po: { include: { supplier: true } },
  receiver: { select: { fullName: true, username: true } },
  warehouse: true,
  items: {
    orderBy: { id: 'asc' as const },
    include: { poItem: { include: { part: { select: { id: true, partNumber: true, name: true, unit: true } } } } },
  },
};

export async function loadGrn(id: number) {
  const g = await prisma.goodsReceipt.findUnique({ where: { id }, include: grnInclude });
  if (!g) throw notFound('Goods receipt');
  return g;
}

/**
 * Posts a goods receipt: validates remaining quantities under row locks,
 * increases stock (RECEIPT movements with the PO unit cost), updates
 * received quantities and the PO status — all in one transaction.
 */
export async function receiveGoods(req: Request, poId: number, input: { warehouseId: number; receivedAt?: string; deliveryNote?: string | null; notes?: string | null; lines: GrnLineInput[] }) {
  const settings = await getSettings();
  const lines = input.lines.filter((l) => (l.receivedQty ?? 0) > 0 || (l.rejectedQty ?? 0) > 0);
  if (!lines.length) throw badRequest('Enter a received or rejected quantity on at least one line');
  const grnId = await withTx(async (tx) => {
    await tx.$queryRaw`SELECT id FROM purchase_orders WHERE id = ${poId} FOR UPDATE`;
    const po = await tx.purchaseOrder.findUnique({ where: { id: poId }, include: { items: true } });
    if (!po) throw notFound('Purchase order');
    if (!PO_RECEIVABLE.includes(po.status)) throw new HttpError(409, `${po.poNumber} is ${po.status}; goods can only be received on approved/sent orders`);
    const warehouse = await tx.warehouse.findUnique({ where: { id: input.warehouseId }, include: { locations: { orderBy: { id: 'asc' } } } });
    if (!warehouse) throw badRequest('Warehouse not found');
    if (!warehouse.locations.length) throw badRequest(`Warehouse ${warehouse.code} has no locations`);

    const grnNumber = await nextNumber(tx, 'GRN');
    const grn = await tx.goodsReceipt.create({
      data: {
        grnNumber, poId, receivedAt: input.receivedAt ? new Date(input.receivedAt) : new Date(), receivedBy: req.user!.id,
        warehouseId: warehouse.id, deliveryNote: input.deliveryNote, notes: input.notes,
      },
    });
    const summary = [];
    for (const l of lines) {
      const item = po.items.find((i) => i.id === l.poItemId);
      if (!item) throw badRequest('Line does not belong to this purchase order');
      const received = D(l.receivedQty ?? 0);
      const rejected = D(l.rejectedQty ?? 0);
      if (received.isNegative() || rejected.isNegative()) throw badRequest('Quantities cannot be negative');
      const remainingBefore = D(item.quantity).minus(item.qtyReceived);
      const tolerance = D(item.quantity).mul(settings.overReceiptTolerancePct).div(100);
      if (received.gt(remainingBefore.plus(tolerance))) {
        throw new HttpError(409, `Line ${item.lineNo}: receiving ${received} but only ${remainingBefore} remain on the order`);
      }
      const locationId = l.locationId ?? warehouse.locations[0].id;
      if (!warehouse.locations.some((x) => x.id === locationId)) throw badRequest('Location is not in the selected warehouse');
      const newReceived = D(item.qtyReceived).plus(received);
      const capped = newReceived.gt(item.quantity) ? D(item.quantity) : newReceived; // tolerance over-receipt goes to stock but not beyond ordered on the PO
      await tx.purchaseOrderItem.update({ where: { id: item.id }, data: { qtyReceived: capped } });
      item.qtyReceived = capped;
      await tx.goodsReceiptItem.create({
        data: {
          grnId: grn.id, poItemId: item.id, locationId, orderedQty: item.quantity, receivedQty: received, rejectedQty: rejected,
          remainingQty: D(item.quantity).minus(capped), condition: l.condition ?? (rejected.gt(0) && received.isZero() ? 'REJECTED' : 'GOOD'), notes: l.notes,
        },
      });
      if (received.gt(0)) {
        const netCost = D(item.unitPrice).mul(D(100).minus(item.discountPct)).div(100);
        await postMovement(tx, {
          partId: item.partId, locationId, quantity: received, type: 'RECEIPT', docNumber: grnNumber, userId: req.user!.id,
          unitCost: netCost, currency: po.currency, refType: 'GRN', refId: grn.id, reason: `PO ${po.poNumber}`,
        });
      }
      summary.push({ line: item.lineNo, received: Number(received), rejected: Number(rejected), remaining: Number(D(item.quantity).minus(capped)) });
    }
    const allDone = po.items.every((i) => D(i.qtyReceived).gte(i.quantity));
    const status = allDone ? 'RECEIVED' : 'PARTIALLY_RECEIVED';
    await tx.purchaseOrder.update({ where: { id: poId }, data: { status } });
    await audit(req, { action: 'GOODS_RECEIVED', docType: 'GRN', docId: grn.id, docNumber: grnNumber, newValue: { po: po.poNumber, lines: summary } }, tx);
    if (status !== po.status) {
      await audit(req, { action: allDone ? 'PO_RECEIVED' : 'PO_PARTIALLY_RECEIVED', docType: 'PO', docId: poId, docNumber: po.poNumber, oldValue: { status: po.status }, newValue: { status, grn: grnNumber } }, tx);
    }
    return grn.id;
  });
  return loadGrn(grnId);
}
