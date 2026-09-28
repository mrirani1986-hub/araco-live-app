import { beforeAll, describe, expect, it } from 'vitest';
import { adminClient, makeUser, type Client } from './helpers.js';
import { prisma } from '../src/lib/prisma.js';
import { withTx } from '../src/lib/prisma.js';
import { nextNumber } from '../src/lib/numbering.js';

let admin: Client, requester: Client, storeman: Client;
let partId: number, locationId: number, warehouseId: number;

beforeAll(async () => {
  admin = await adminClient();
  requester = await makeUser(admin, 'REQUESTER');
  storeman = await makeUser(admin, 'STORE_MANAGER');
  partId = (await prisma.part.findUniqueOrThrow({ where: { partNumber: 'E1001286' } })).id; // V BELT
  const wh = await prisma.warehouse.findFirstOrThrow({ include: { locations: true } });
  warehouseId = wh.id;
  locationId = wh.locations[0].id;
});

describe('Document numbering', () => {
  it('never issues the same number to simultaneous users (60 parallel PRs)', async () => {
    const results = await Promise.all(Array.from({ length: 60 }, () => requester.post('/api/prs', { lines: [{ partId, quantity: 1 }] })));
    expect(results.every((r) => r.status === 201)).toBe(true);
    const numbers = results.map((r) => r.body.prNumber as string);
    expect(new Set(numbers).size).toBe(60);
    const seqs = numbers.map((n) => Number(n.slice(-6))).sort((a, b) => a - b);
    for (let i = 1; i < seqs.length; i++) expect(seqs[i]).toBe(seqs[i - 1] + 1); // no gaps, no duplicates
  });

  it('releases the number when the surrounding transaction fails (no gaps)', async () => {
    const before = await prisma.documentSequence.findUnique({ where: { docType_year: { docType: 'ADJ', year: new Date().getFullYear() } } });
    await expect(withTx(async (tx) => { await nextNumber(tx, 'ADJ'); throw new Error('boom'); })).rejects.toThrow('boom');
    const after = await prisma.documentSequence.findUnique({ where: { docType_year: { docType: 'ADJ', year: new Date().getFullYear() } } });
    expect(after?.lastValue ?? 0).toBe(before?.lastValue ?? 0);
  });

  it('parallel direct allocations are unique', async () => {
    const nums = await Promise.all(Array.from({ length: 100 }, () => withTx((tx) => nextNumber(tx, 'TRF'))));
    expect(new Set(nums).size).toBe(100);
  });
});

describe('Concurrent stock operations', () => {
  it('parallel issues can never make stock negative', async () => {
    const adj = await storeman.post('/api/inventory/adjust', { reason: 'Stock count', lines: [{ partId, locationId, countedQty: 10 }] });
    expect(adj.status).toBe(201);
    const results = await Promise.all(Array.from({ length: 15 }, () => storeman.post('/api/inventory/issue', { reason: 'Maintenance', equipmentId: 1, lines: [{ partId, locationId, quantity: 1 }] })));
    const ok = results.filter((r) => r.status === 201).length;
    const refused = results.filter((r) => r.status === 409).length;
    expect(ok).toBe(10);
    expect(refused).toBe(5);
    const inv = await prisma.inventory.findUniqueOrThrow({ where: { partId_locationId: { partId, locationId } } });
    expect(Number(inv.onHand)).toBe(0);
    // ledger balance matches the stock row
    const sum = await prisma.inventoryTransaction.aggregate({ where: { partId, locationId }, _sum: { quantity: true } });
    expect(Number(sum._sum.quantity)).toBe(0);
  });

  it('parallel receipts on the same PO line cannot exceed the ordered quantity', async () => {
    const buyer = await makeUser(admin, 'PROCUREMENT');
    const sup = (await buyer.post('/api/suppliers', { name: 'Concurrency Supplier' })).body;
    const po = (await buyer.post('/api/pos', { supplierId: sup.id, lines: [{ partId, quantity: 5, unitPrice: 10 }] })).body;
    await buyer.post(`/api/pos/${po.id}/approve`, {});
    const lineId = po.items[0].id;
    const results = await Promise.all(Array.from({ length: 8 }, () => storeman.post(`/api/pos/${po.id}/receive`, { warehouseId, lines: [{ poItemId: lineId, receivedQty: 1, locationId }] })));
    expect(results.filter((r) => r.status === 201)).toHaveLength(5);
    const item = await prisma.purchaseOrderItem.findUniqueOrThrow({ where: { id: lineId } });
    expect(Number(item.qtyReceived)).toBe(5);
    expect((await prisma.purchaseOrder.findUniqueOrThrow({ where: { id: po.id } })).status).toBe('RECEIVED');
    const grnNumbers = (await prisma.goodsReceipt.findMany({ where: { poId: po.id } })).map((g) => g.grnNumber);
    expect(new Set(grnNumbers).size).toBe(5);
  });
});
