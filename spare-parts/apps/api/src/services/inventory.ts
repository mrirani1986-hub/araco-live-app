import { Prisma } from '@prisma/client';
import type { Tx } from '../lib/prisma.js';
import { HttpError } from '../lib/errors.js';
import { D } from '../lib/money.js';

export type MovementType = 'RECEIPT' | 'ISSUE' | 'RETURN' | 'ADJUSTMENT' | 'TRANSFER_OUT' | 'TRANSFER_IN';

export interface Movement {
  partId: number;
  locationId: number;
  quantity: Prisma.Decimal.Value; // signed: + into stock, - out of stock
  type: MovementType;
  docNumber: string;
  userId: number;
  unitCost?: Prisma.Decimal.Value | null;
  currency?: string | null;
  refType?: string;
  refId?: number;
  equipmentId?: number | null;
  reason?: string | null;
}

/**
 * The only way stock changes. Locks the balance row (SELECT ... FOR UPDATE),
 * refuses to go negative, updates the balance and appends to the ledger — all
 * in the caller's transaction, so concurrent issues/receipts are serialised.
 */
export async function postMovement(tx: Tx, m: Movement) {
  const qty = D(m.quantity);
  if (qty.isZero()) throw new HttpError(400, 'Quantity must not be zero');
  await tx.$executeRaw`
    INSERT INTO inventory (part_id, location_id, on_hand, reserved, updated_at)
    VALUES (${m.partId}, ${m.locationId}, 0, 0, now())
    ON CONFLICT (part_id, location_id) DO NOTHING`;
  const rows = await tx.$queryRaw<{ id: number; on_hand: Prisma.Decimal }[]>`
    SELECT id, on_hand FROM inventory WHERE part_id = ${m.partId} AND location_id = ${m.locationId} FOR UPDATE`;
  const inv = rows[0];
  const after = D(inv.on_hand).plus(qty);
  if (after.isNegative()) {
    const part = await tx.part.findUnique({ where: { id: m.partId }, select: { partNumber: true } });
    throw new HttpError(409, `Not enough stock of ${part?.partNumber}: available ${inv.on_hand}, requested ${qty.abs()}`);
  }
  await tx.inventory.update({ where: { id: inv.id }, data: { onHand: after } });
  return tx.inventoryTransaction.create({
    data: {
      docNumber: m.docNumber, type: m.type, partId: m.partId, locationId: m.locationId, quantity: qty,
      balanceAfter: after, unitCost: m.unitCost ?? null, currency: m.currency ?? null, refType: m.refType,
      refId: m.refId, equipmentId: m.equipmentId ?? null, reason: m.reason ?? null, userId: m.userId,
    },
  });
}
