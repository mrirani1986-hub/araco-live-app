import { Router } from 'express';
import { z } from 'zod';
import { Prisma } from '@prisma/client';
import { prisma, withTx } from '../lib/prisma.js';
import { requirePerm } from '../lib/auth.js';
import { idParam, optStr, pageArgs, qStr } from '../lib/http.js';
import { nextNumber } from '../lib/numbering.js';
import { audit, diff } from '../lib/audit.js';
import { notFound } from '../lib/errors.js';
import { poTotals } from '../lib/money.js';
import { refreshSearchText } from '../services/parts.js';
import { getSettings } from '../lib/settings.js';
import { sendExport } from '../services/export.js';

const r = Router();

const supplierSchema = z.object({
  name: z.string().trim().min(1).max(200),
  company: optStr, contactPerson: optStr, phone: optStr, email: z.string().trim().email().or(z.literal('')).nullish().transform((v) => v || null),
  address: optStr, country: optStr, currency: z.string().trim().length(3).transform((c) => c.toUpperCase()).optional(), paymentTerms: optStr, deliveryTerms: optStr,
  taxNumber: optStr, notes: optStr, status: z.enum(['ACTIVE', 'INACTIVE']).optional(),
});

function where(q: Record<string, unknown>): Prisma.SupplierWhereInput {
  const w: Prisma.SupplierWhereInput = {};
  const text = qStr(q.q);
  if (text) w.OR = ['name', 'company', 'contactPerson', 'email', 'code', 'taxNumber'].map((f) => ({ [f]: { contains: text, mode: 'insensitive' } }));
  const status = qStr(q.status);
  if (status) w.status = status;
  return w;
}

r.get('/', requirePerm('suppliers.view', 'po.create'), async (req, res) => {
  const { skip, take, page, pageSize } = pageArgs(req);
  const w = where(req.query);
  const [rows, total] = await Promise.all([
    prisma.supplier.findMany({ where: w, orderBy: { name: 'asc' }, skip, take, include: { _count: { select: { purchaseOrders: true, parts: true } } } }),
    prisma.supplier.count({ where: w }),
  ]);
  res.json({ page, pageSize, total, items: rows });
});

r.get('/export', requirePerm('export.run'), async (req, res) => {
  const rows = await prisma.supplier.findMany({ where: where(req.query), orderBy: { name: 'asc' } });
  await sendExport(res, String(req.query.format ?? 'xlsx'), 'Suppliers', [
    { key: 'code', label: 'Supplier ID' }, { key: 'name', label: 'Supplier Name' }, { key: 'company', label: 'Company' }, { key: 'contactPerson', label: 'Contact' },
    { key: 'phone', label: 'Phone' }, { key: 'email', label: 'Email' }, { key: 'address', label: 'Address' }, { key: 'country', label: 'Country' },
    { key: 'currency', label: 'Currency' }, { key: 'paymentTerms', label: 'Payment Terms' }, { key: 'deliveryTerms', label: 'Delivery Terms' },
    { key: 'taxNumber', label: 'Tax Number' }, { key: 'status', label: 'Status' }, { key: 'notes', label: 'Notes' },
  ], rows);
});

/** Possible duplicates: similar names or identical tax number / email. */
async function findSimilar(name: string, taxNumber?: string | null, email?: string | null, excludeId?: number) {
  const rows = await prisma.$queryRaw<{ id: number; code: string; name: string }[]>`
    SELECT id, code, name FROM suppliers
    WHERE (similarity(lower(name), lower(${name})) > 0.5
       OR (${taxNumber ?? null}::text IS NOT NULL AND tax_number = ${taxNumber ?? null})
       OR (${email ?? null}::text IS NOT NULL AND lower(email) = lower(${email ?? null})))
      AND id <> ${excludeId ?? 0}
    LIMIT 5`;
  return rows;
}

r.post('/check-duplicates', requirePerm('suppliers.manage'), async (req, res) => {
  const b = z.object({ name: z.string(), taxNumber: optStr, email: optStr, id: z.number().optional() }).parse(req.body);
  res.json(await findSimilar(b.name, b.taxNumber, b.email, b.id));
});

r.get('/:id', requirePerm('suppliers.view', 'po.create'), async (req, res) => {
  const id = idParam(req);
  const s = await prisma.supplier.findUnique({ where: { id }, include: { parts: { include: { part: { select: { id: true, partNumber: true, name: true, unit: true } } }, orderBy: { part: { partNumber: 'asc' } } } } });
  if (!s) throw notFound('Supplier');
  const pos = await prisma.purchaseOrder.findMany({ where: { supplierId: id }, orderBy: { id: 'desc' }, include: { items: { include: { part: { select: { id: true, partNumber: true, name: true } } } } } });
  const active = pos.filter((p) => p.status !== 'CANCELLED');
  const byPart = new Map<number, { partId: number; partNumber: string; name: string; qty: number; value: number; lastPrice: number; lastDate: Date }>();
  for (const po of active) {
    for (const i of po.items) {
      const e = byPart.get(i.partId) ?? { partId: i.partId, partNumber: i.part.partNumber, name: i.part.name, qty: 0, value: 0, lastPrice: Number(i.unitPrice), lastDate: po.poDate };
      e.qty += Number(i.quantity);
      e.value += Number(i.quantity) * Number(i.unitPrice) * (1 - Number(i.discountPct) / 100);
      if (po.poDate >= e.lastDate) { e.lastPrice = Number(i.unitPrice); e.lastDate = po.poDate; }
      byPart.set(i.partId, e);
    }
  }
  const totalValue = active.reduce((a, p) => a + poTotals(p.items, p.shippingCost, p.otherCharges).grandTotal, 0);
  res.json({
    ...s,
    history: {
      purchaseOrders: pos.map((p) => ({ id: p.id, poNumber: p.poNumber, poDate: p.poDate, status: p.status, currency: p.currency, total: poTotals(p.items, p.shippingCost, p.otherCharges).grandTotal, lines: p.items.length })),
      purchasedParts: [...byPart.values()].map((p) => ({ ...p, averagePrice: p.qty ? Math.round((p.value / p.qty) * 100) / 100 : null, value: Math.round(p.value * 100) / 100 })),
      totalPurchaseValue: Math.round(totalValue * 100) / 100,
      poCount: active.length,
      lastPurchaseDate: active[0]?.poDate ?? null,
    },
  });
});

r.post('/', requirePerm('suppliers.manage'), async (req, res) => {
  const body = supplierSchema.parse(req.body);
  const s = await withTx(async (tx) => {
    const code = await nextNumber(tx, 'SUP');
    const created = await tx.supplier.create({ data: { ...body, currency: body.currency ?? (await getSettings(tx)).currency, code } });
    await audit(req, { action: 'SUPPLIER_CREATED', docType: 'SUPPLIER', docId: created.id, docNumber: code, newValue: body }, tx);
    return created;
  });
  res.status(201).json({ ...s, possibleDuplicates: await findSimilar(s.name, s.taxNumber, s.email, s.id) });
});

r.patch('/:id', requirePerm('suppliers.manage'), async (req, res) => {
  const id = idParam(req);
  const body = supplierSchema.partial().parse(req.body);
  const before = await prisma.supplier.findUnique({ where: { id } });
  if (!before) throw notFound('Supplier');
  const d = diff(before as unknown as Record<string, unknown>, body as Record<string, unknown>);
  const s = await prisma.supplier.update({ where: { id }, data: body });
  if (d.changed) await audit(req, { action: 'SUPPLIER_EDITED', docType: 'SUPPLIER', docId: id, docNumber: s.code, oldValue: d.oldValue, newValue: d.newValue });
  if (body.name && body.name !== before.name) {
    await refreshSearchText(prisma, (await prisma.supplierPart.findMany({ where: { supplierId: id } })).map((x) => x.partId));
  }
  res.json(s);
});

// Supplier ↔ part prices
r.put('/:id/parts', requirePerm('suppliers.manage'), async (req, res) => {
  const supplierId = idParam(req);
  const body = z.object({
    partId: z.coerce.number().int().positive(), supplierPartNumber: optStr, price: z.coerce.number().min(0).nullish(),
    currency: z.string().trim().length(3).optional(), leadTimeDays: z.coerce.number().int().min(0).nullish(), isPreferred: z.boolean().optional(),
  }).parse(req.body);
  const sup = await prisma.supplier.findUnique({ where: { id: supplierId } });
  if (!sup) throw notFound('Supplier');
  const result = await withTx(async (tx) => {
    const before = await tx.supplierPart.findUnique({ where: { supplierId_partId: { supplierId, partId: body.partId } } });
    if (body.isPreferred) await tx.supplierPart.updateMany({ where: { partId: body.partId }, data: { isPreferred: false } });
    const sp = await tx.supplierPart.upsert({
      where: { supplierId_partId: { supplierId, partId: body.partId } },
      update: { supplierPartNumber: body.supplierPartNumber, price: body.price, currency: body.currency ?? sup.currency, leadTimeDays: body.leadTimeDays, isPreferred: body.isPreferred },
      create: { supplierId, partId: body.partId, supplierPartNumber: body.supplierPartNumber, price: body.price, currency: body.currency ?? sup.currency, leadTimeDays: body.leadTimeDays, isPreferred: body.isPreferred ?? false },
    });
    await refreshSearchText(tx, [body.partId]);
    await audit(req, { action: before ? 'SUPPLIER_PRICE_CHANGED' : 'SUPPLIER_PART_ADDED', docType: 'PART', docId: body.partId, docNumber: sup.code, oldValue: before && { price: before.price, supplierPartNumber: before.supplierPartNumber, preferred: before.isPreferred }, newValue: { supplier: sup.name, price: body.price, supplierPartNumber: body.supplierPartNumber, preferred: body.isPreferred } }, tx);
    return sp;
  });
  res.json(result);
});

r.delete('/:id/parts/:partId', requirePerm('suppliers.manage'), async (req, res) => {
  const supplierId = idParam(req);
  const partId = idParam(req, 'partId');
  const sp = await prisma.supplierPart.findUnique({ where: { supplierId_partId: { supplierId, partId } } });
  if (!sp) throw notFound('Supplier part');
  await prisma.supplierPart.delete({ where: { id: sp.id } });
  await refreshSearchText(prisma, [partId]);
  await audit(req, { action: 'SUPPLIER_PART_REMOVED', docType: 'PART', docId: partId, oldValue: { supplierId, price: sp.price, supplierPartNumber: sp.supplierPartNumber } });
  res.json({ ok: true });
});

export default r;
