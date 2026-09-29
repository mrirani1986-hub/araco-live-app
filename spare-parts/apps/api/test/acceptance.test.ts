/**
 * Section 30 acceptance scenario, end to end through the HTTP API, on data
 * imported from the original workbook (no dummy catalogue data).
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { adminClient, makeUser, type Client } from './helpers.js';
import { prisma } from '../src/lib/prisma.js';

let admin: Client, requester: Client, storeman: Client, buyer: Client, manager: Client;
let supplierA: { id: number }, supplierB: { id: number };
let mainPart: { id: number; partNumber: string };
let otherParts: { id: number; partNumber: string }[] = [];
let prId: number;
let pos: { id: number; poNumber: string; supplierId: number; items: { id: number; partId: number; quantity: string }[] }[] = [];
let poA: (typeof pos)[number];
let location: { id: number; warehouseId: number };
const year = new Date().getFullYear();

const stockOf = async (partId: number) => Number((await prisma.inventory.aggregate({ where: { partId }, _sum: { onHand: true } }))._sum.onHand ?? 0);

beforeAll(async () => {
  admin = await adminClient();
  requester = await makeUser(admin, 'REQUESTER', 'Rami Requester');
  storeman = await makeUser(admin, 'STORE_MANAGER', 'Sami Store');
  buyer = await makeUser(admin, 'PROCUREMENT', 'Bilal Buyer');
  manager = await makeUser(admin, 'APPROVER', 'Majid Manager');
  const wh = await prisma.warehouse.findFirstOrThrow({ include: { locations: true } });
  location = { id: wh.locations[0].id, warehouseId: wh.id };
  const a = await buyer.post('/api/suppliers', { name: 'Gulf Bearings Trading', currency: 'SAR', paymentTerms: '30 days', deliveryTerms: 'DAP Riyadh', phone: '+966 11 000 0000', email: 'sales@gulfbearings.example', address: 'Industrial Area, Riyadh' });
  const b = await buyer.post('/api/suppliers', { name: 'Elkon Middle East Parts', currency: 'SAR', paymentTerms: 'Advance', email: 'parts@elkon-me.example' });
  expect(a.status).toBe(201);
  expect(b.status).toBe(201);
  supplierA = a.body; supplierB = b.body;
});

describe('Acceptance scenario', () => {
  it('1. searches for a spare part', async () => {
    const r = await requester.get('/api/parts?q=bearing&pageSize=10');
    expect(r.status).toBe(200);
    expect(r.body.total).toBeGreaterThan(5);
    const names = r.body.items.map((i: { name: string }) => i.name);
    expect(names.slice(0, 5).every((n: string) => /BEARING/.test(n))).toBe(true);
    mainPart = r.body.items.find((i: { partNumber: string }) => i.partNumber === 'E1003141') ?? (await requester.get('/api/parts?q=E1003141')).body.items[0];
    expect(mainPart.partNumber).toBe('E1003141');
    // ELKON search returns the whole ELKON catalogue; partial number search works too
    expect((await requester.get('/api/parts?q=ELKON&pageSize=1')).body.total).toBeGreaterThanOrEqual(252);
    const byNumber = await requester.get('/api/parts?q=1001286');
    expect(byNumber.body.items[0].partNumber).toBe('E1001286');
  });

  it('2-4. opens the part, sees its picture and all specifications', async () => {
    const r = await requester.get(`/api/parts/${mainPart.id}`);
    expect(r.status).toBe(200);
    expect(r.body.partNumber).toBe(mainPart.partNumber);
    expect(r.body.manufacturer.name).toBe('ELKON');
    expect(r.body.drawings.length).toBeGreaterThan(0);
    for (const k of ['name', 'unit', 'category', 'usages', 'aliases', 'stock', 'purchase']) expect(r.body).toHaveProperty(k);
    expect(r.body.usages[0].sourceRecord.sourceRef).toMatch(/^MIXER!A\d+$/);
    const img = await requester.get(`/api/files/${r.body.drawings[0].thumbKey}`);
    expect(img.status).toBe(200);
    expect(img.headers['content-type']).toBe('image/webp');
    // Buyer registers supplier prices for the parts used below
    const others = (await requester.get('/api/parts?q=seal&pageSize=3')).body.items;
    otherParts = others.slice(0, 2);
    for (const [p, s, price] of [[mainPart, supplierA, 85.5], [otherParts[0], supplierA, 12.25], [otherParts[1], supplierB, 40]] as const) {
      const sp = await buyer.put(`/api/suppliers/${s.id}/parts`, { partId: p.id, price, supplierPartNumber: `SUP-${p.partNumber}`, isPreferred: true });
      expect(sp.status).toBe(200);
    }
  });

  it('5-7. enters quantity 10, adds it to the request and adds other parts', async () => {
    let r = await requester.post('/api/cart', { partId: mainPart.id, quantity: 10, requiredDate: '2026-10-05', reason: 'Maintenance', equipmentId: 1, project: 'Plant #1 overhaul' });
    expect(r.status).toBe(201);
    r = await requester.post('/api/cart', { partId: otherParts[0].id, quantity: 4, reason: 'Maintenance' });
    r = await requester.post('/api/cart', { partId: otherParts[1].id, quantity: 2, reason: 'Maintenance' });
    expect(r.body.count).toBe(3);
    const line = r.body.items.find((i: { partId: number }) => i.partId === mainPart.id);
    expect(line.quantity).toBe(10);
    expect(line.lineTotal).toBe(855);
    expect(r.body.total).toBe(855 + 49 + 80);
  });

  it('8. creates the PR with an automatic number', async () => {
    const r = await requester.post('/api/cart/checkout', { department: 'Maintenance', priority: 'HIGH', requiredDate: '2026-10-05', reason: 'Planned maintenance of mixer' });
    expect(r.status).toBe(201);
    expect(r.body.prNumber).toMatch(new RegExp(`^PR-${year}-\\d{6}$`));
    expect(r.body.status).toBe('DRAFT');
    expect(r.body.items).toHaveLength(3);
    expect(r.body.totals.subtotal).toBe(984);
    expect(r.body.totals.tax).toBe(147.6);
    expect(r.body.totals.grandTotal).toBe(1131.6);
    prId = r.body.id;
    expect((await requester.get('/api/cart')).body.count).toBe(0);
  });

  it('9. submits the PR', async () => {
    const r = await requester.post(`/api/prs/${prId}/submit`, { comment: 'Please approve' });
    expect(r.status).toBe(200);
    expect(r.body.status).toBe('SUBMITTED');
    // Submitted PRs are locked
    const edit = await requester.patch(`/api/prs/${prId}`, { reason: 'changed' });
    expect(edit.status).toBe(409);
  });

  it('10. approves the PR through every configured level', async () => {
    expect((await requester.post(`/api/prs/${prId}/approve`, {})).status).toBe(403);
    expect((await buyer.post(`/api/prs/${prId}/approve`, {})).status).toBe(403); // not the procurement step yet
    let r = await storeman.post(`/api/prs/${prId}/approve`, { comment: 'Needed for overhaul' });
    expect(r.body.status).toBe('PENDING_APPROVAL');
    r = await buyer.post(`/api/prs/${prId}/approve`, { comment: 'Prices checked' });
    expect(r.body.status).toBe('PENDING_APPROVAL');
    r = await manager.post(`/api/prs/${prId}/approve`, { comment: 'Approved' });
    expect(r.status).toBe(200);
    expect(r.body.status).toBe('APPROVED');
    const actions = r.body.approvals.map((a: { action: string; user: { fullName: string } }) => `${a.action}:${a.user.fullName}`);
    expect(actions).toEqual(['SUBMITTED:Rami Requester', 'APPROVED:Sami Store', 'APPROVED:Bilal Buyer', 'APPROVED:Majid Manager']);
    // Approved PRs cannot be silently changed
    expect((await requester.patch(`/api/prs/${prId}`, { reason: 'x' })).status).toBe(409);
    expect((await admin.patch(`/api/prs/${prId}`, { reason: 'x' })).status).toBe(409);
  });

  it('11-12. selects suppliers and creates one PO per supplier', async () => {
    const pr = (await buyer.get(`/api/prs/${prId}`)).body;
    const lines = pr.items.map((i: { id: number; partId: number; quantity: string; estUnitPrice: string; supplierId: number }) => ({
      prItemId: i.id, quantity: Number(i.quantity), unitPrice: Number(i.estUnitPrice), supplierId: i.supplierId,
    }));
    expect(lines.map((l: { supplierId: number }) => l.supplierId).sort()).toEqual([supplierA.id, supplierA.id, supplierB.id].sort());
    const r = await buyer.post(`/api/pos/from-pr/${prId}`, { lines, expectedDelivery: '2026-10-20', shippingMethod: 'Road freight', shippingCost: 50 });
    expect(r.status).toBe(201);
    pos = r.body;
    expect(pos).toHaveLength(2);
    for (const p of pos) expect(p.poNumber).toMatch(new RegExp(`^PO-${year}-\\d{6}$`));
    poA = pos.find((p) => p.supplierId === supplierA.id)!;
    expect(poA.items).toHaveLength(2);
    expect((await buyer.get(`/api/prs/${prId}`)).body.status).toBe('CONVERTED_TO_PO');
    // cannot order the same PR lines twice
    expect((await buyer.post(`/api/pos/from-pr/${prId}`, { lines })).status).toBe(409);
  });

  it('13. generates the professional PO PDF (and Excel)', async () => {
    const r = await buyer.get(`/api/pos/${poA.id}/pdf`).buffer(true).parse((res, cb) => {
      const chunks: Buffer[] = [];
      res.on('data', (c: Buffer) => chunks.push(c));
      res.on('end', () => cb(null, Buffer.concat(chunks)));
    });
    expect(r.status).toBe(200);
    expect(r.headers['content-type']).toBe('application/pdf');
    const pdf = r.body as Buffer;
    expect(pdf.subarray(0, 5).toString()).toBe('%PDF-');
    expect(pdf.length).toBeGreaterThan(20_000); // contains embedded part pictures
    const x = await buyer.get(`/api/pos/${poA.id}/xlsx`);
    expect(x.status).toBe(200);
    expect(x.headers['content-type']).toContain('spreadsheetml');
    // approve + send
    expect((await buyer.post(`/api/pos/${poA.id}/approve`, {})).body.status).toBe('APPROVED');
    expect((await buyer.post(`/api/pos/${poA.id}/send`, {})).body.status).toBe('SENT');
  });

  it('14-16. receives 8 of 10: stock +8, 2 remain', async () => {
    const line = poA.items.find((i) => i.partId === mainPart.id)!;
    const before = await stockOf(mainPart.id);
    // over-receipt is refused
    expect((await storeman.post(`/api/pos/${poA.id}/receive`, { warehouseId: location.warehouseId, lines: [{ poItemId: line.id, receivedQty: 11 }] })).status).toBe(409);
    const r = await storeman.post(`/api/pos/${poA.id}/receive`, { warehouseId: location.warehouseId, deliveryNote: 'DN-5541', lines: [{ poItemId: line.id, receivedQty: 8, locationId: location.id }] });
    expect(r.status).toBe(201);
    expect(r.body.grnNumber).toMatch(new RegExp(`^GRN-${year}-\\d{6}$`));
    expect(Number(r.body.items[0].remainingQty)).toBe(2);
    expect(await stockOf(mainPart.id)).toBe(before + 8);
    const po = (await buyer.get(`/api/pos/${poA.id}`)).body;
    expect(po.status).toBe('PARTIALLY_RECEIVED');
    expect(po.items.find((i: { id: number }) => i.id === line.id).remaining).toBe(2);
  });

  it('17-18. receives the remaining 2: inventory complete', async () => {
    const line = poA.items.find((i) => i.partId === mainPart.id)!;
    const other = poA.items.find((i) => i.partId !== mainPart.id)!;
    const r = await storeman.post(`/api/pos/${poA.id}/receive`, {
      warehouseId: location.warehouseId,
      lines: [{ poItemId: line.id, receivedQty: 2, locationId: location.id }, { poItemId: other.id, receivedQty: Number(other.quantity), locationId: location.id }],
    });
    expect(r.status).toBe(201);
    expect(await stockOf(mainPart.id)).toBe(10);
    expect((await buyer.get(`/api/pos/${poA.id}`)).body.status).toBe('RECEIVED');
    // receiving on a completed PO is refused
    expect((await storeman.post(`/api/pos/${poA.id}/receive`, { warehouseId: location.warehouseId, lines: [{ poItemId: line.id, receivedQty: 1 }] })).status).toBe(409);
  });

  it('19. purchase history records both receipts with prices', async () => {
    const r = await requester.get(`/api/parts/${mainPart.id}`);
    const h = r.body.purchase;
    expect(h.history).toHaveLength(2);
    expect(h.history.map((x: { qty: number }) => x.qty).sort()).toEqual([2, 8]);
    expect(h.history[0].supplier).toBe('Gulf Bearings Trading');
    expect(h.history[0].netPrice).toBe(85.5);
    expect(h.stats).toMatchObject({ lastPrice: 85.5, lowestPrice: 85.5, highestPrice: 85.5, averagePrice: 85.5, lastSupplier: 'Gulf Bearings Trading', totalQty: 10 });
    expect(r.body.stock.onHand).toBe(10);
    const ledger = await prisma.inventoryTransaction.findMany({ where: { partId: mainPart.id }, orderBy: { id: 'asc' } });
    expect(ledger.map((t) => [t.type, Number(t.quantity), Number(t.balanceAfter)])).toEqual([['RECEIPT', 8, 8], ['RECEIPT', 2, 10]]);
  });

  it('20. audit log records every action', async () => {
    const pr = await prisma.purchaseRequisition.findUniqueOrThrow({ where: { id: prId } });
    const prLog = await prisma.auditLog.findMany({ where: { docType: 'PR', docId: prId }, orderBy: { id: 'asc' } });
    expect(prLog.map((a) => a.action)).toEqual(['PR_CREATED', 'PR_SUBMITTED', 'PR_APPROVED', 'PR_APPROVED', 'PR_APPROVED', 'PR_CONVERTED_TO_PO']);
    expect(prLog.every((a) => a.docNumber === pr.prNumber && a.userId && a.ip)).toBe(true);
    const poLog = (await prisma.auditLog.findMany({ where: { docType: 'PO', docId: poA.id }, orderBy: { id: 'asc' } })).map((a) => a.action);
    expect(poLog).toEqual(['PO_CREATED', 'PO_APPROVED', 'PO_SENT', 'PO_PARTIALLY_RECEIVED', 'PO_RECEIVED']);
    const grnLog = await prisma.auditLog.count({ where: { action: 'GOODS_RECEIVED' } });
    expect(grnLog).toBeGreaterThanOrEqual(2);
    // The API exposes it to authorised users only
    expect((await manager.get('/api/audit?q=' + pr.prNumber)).body.total).toBeGreaterThanOrEqual(6);
    expect((await requester.get('/api/audit')).status).toBe(403);
    // History cannot be altered, even directly in the database
    await expect(prisma.auditLog.deleteMany({ where: { docId: prId } })).rejects.toThrow(/append-only/);
    await expect(prisma.inventoryTransaction.updateMany({ where: { partId: mainPart.id }, data: { quantity: 99 } })).rejects.toThrow(/append-only/);
  });
});
