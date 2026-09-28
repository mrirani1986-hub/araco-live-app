import { Router } from 'express';
import { z } from 'zod';
import { Prisma } from '@prisma/client';
import { prisma, withTx } from '../lib/prisma.js';
import { requirePerm } from '../lib/auth.js';
import { idParam, optStr, pageArgs, qInt, qStr } from '../lib/http.js';
import { nextNumber } from '../lib/numbering.js';
import { audit } from '../lib/audit.js';
import { badRequest, notFound } from '../lib/errors.js';
import { postMovement } from '../services/inventory.js';
import { STOCK_CTE } from '../services/parts.js';
import { sendExport } from '../services/export.js';
import { suggestedMinimums } from '../import/source.js';

const r = Router();

// Stock list: one row per part (all locations), filterable by status.
async function stockRows(q: Record<string, unknown>) {
  const where: Prisma.Sql[] = [Prisma.sql`p.status <> 'DELETED'`];
  const status = qStr(q.status);
  if (status === 'ATTENTION') where.push(Prisma.sql`st.stock_status IN ('OUT_OF_STOCK','LOW_STOCK','REORDER')`);
  else if (status === 'STOCKED') where.push(Prisma.sql`(st.on_hand > 0 OR st.min_stock IS NOT NULL)`);
  else if (status) where.push(Prisma.sql`st.stock_status = ${status}`);
  const text = qStr(q.q);
  if (text) where.push(Prisma.sql`p.search_text ILIKE ${'%' + text.toLowerCase() + '%'}`);
  const locationId = qInt(q.locationId);
  if (locationId) where.push(Prisma.sql`EXISTS (SELECT 1 FROM inventory i WHERE i.part_id = p.id AND i.location_id = ${locationId})`);
  const rows = await prisma.$queryRaw<Record<string, unknown>[]>`
    WITH ${STOCK_CTE}
    SELECT p.id, p.part_number, p.name, p.unit, p.is_critical, st.on_hand, st.reserved, st.min_stock, st.max_stock, st.reorder_level, st.stock_status,
      (SELECT string_agg(w.code || '/' || l.code || ': ' || trim(to_char(i.on_hand, 'FM999999990.###')), ', ' ORDER BY w.code, l.code)
         FROM inventory i JOIN locations l ON l.id = i.location_id JOIN warehouses w ON w.id = l.warehouse_id
         WHERE i.part_id = p.id AND (i.on_hand <> 0 OR i.min_stock IS NOT NULL)) AS locations,
      (SELECT COALESCE(SUM(poi.quantity - poi.qty_received), 0) FROM purchase_order_items poi JOIN purchase_orders po ON po.id = poi.po_id
         WHERE poi.part_id = p.id AND po.status IN ('DRAFT','APPROVED','SENT','PARTIALLY_RECEIVED')) AS on_order,
      (SELECT t.unit_cost FROM inventory_transactions t WHERE t.part_id = p.id AND t.type = 'RECEIPT' ORDER BY t.id DESC LIMIT 1) AS last_cost,
      (SELECT t.currency FROM inventory_transactions t WHERE t.part_id = p.id AND t.type = 'RECEIPT' ORDER BY t.id DESC LIMIT 1) AS last_cost_currency
    FROM parts p JOIN status st ON st.part_id = p.id
    WHERE ${Prisma.join(where, ' AND ')}
    ORDER BY CASE st.stock_status WHEN 'OUT_OF_STOCK' THEN 0 WHEN 'LOW_STOCK' THEN 1 WHEN 'REORDER' THEN 2 WHEN 'OK' THEN 3 ELSE 4 END, p.part_number`;
  return rows.map((x) => ({
    partId: x.id as number, partNumber: x.part_number as string, name: x.name as string, unit: x.unit as string, isCritical: x.is_critical as boolean,
    onHand: Number(x.on_hand), reserved: Number(x.reserved), available: Number(x.on_hand) - Number(x.reserved),
    minStock: x.min_stock == null ? null : Number(x.min_stock), maxStock: x.max_stock == null ? null : Number(x.max_stock),
    reorderLevel: x.reorder_level == null ? null : Number(x.reorder_level), stockStatus: x.stock_status as string,
    locations: x.locations as string | null, onOrder: Number(x.on_order),
    lastCost: x.last_cost == null ? null : Number(x.last_cost), lastCostCurrency: x.last_cost_currency as string | null,
    value: x.last_cost == null ? null : Math.round(Number(x.last_cost) * Number(x.on_hand) * 100) / 100,
  }));
}

r.get('/', requirePerm('inventory.view'), async (req, res) => {
  const all = await stockRows(req.query);
  const { skip, take, page, pageSize } = pageArgs(req, 100);
  const counts = all.reduce<Record<string, number>>((a, x) => { a[x.stockStatus] = (a[x.stockStatus] ?? 0) + 1; return a; }, {});
  res.json({ page, pageSize, total: all.length, counts, items: all.slice(skip, skip + take) });
});

r.get('/export', requirePerm('export.run'), async (req, res) => {
  await sendExport(res, String(req.query.format ?? 'xlsx'), 'Inventory', [
    { key: 'partNumber', label: 'Part Number' }, { key: 'name', label: 'Part Name' }, { key: 'unit', label: 'Unit' },
    { key: 'onHand', label: 'Current', align: 'r', format: 'qty' }, { key: 'reserved', label: 'Reserved', align: 'r', format: 'qty' },
    { key: 'available', label: 'Available', align: 'r', format: 'qty' }, { key: 'minStock', label: 'Min', align: 'r', format: 'qty' },
    { key: 'maxStock', label: 'Max', align: 'r', format: 'qty' }, { key: 'reorderLevel', label: 'Reorder', align: 'r', format: 'qty' },
    { key: 'onOrder', label: 'On order', align: 'r', format: 'qty' }, { key: 'stockStatus', label: 'Status' }, { key: 'locations', label: 'Warehouse / Location' },
    { key: 'value', label: 'Value (last cost)', align: 'r', format: 'num' },
  ], await stockRows(req.query));
});

r.get('/part/:id', requirePerm('inventory.view'), async (req, res) => {
  const partId = idParam(req);
  res.json(await prisma.inventory.findMany({ where: { partId }, include: { location: { include: { warehouse: true } } }, orderBy: { id: 'asc' } }));
});

function txWhere(q: Record<string, unknown>): Prisma.InventoryTransactionWhereInput {
  const w: Prisma.InventoryTransactionWhereInput = {};
  const type = qStr(q.type); if (type) w.type = { in: type.split(',') };
  const partId = qInt(q.partId); if (partId) w.partId = partId;
  const text = qStr(q.q);
  if (text) w.OR = [{ docNumber: { contains: text, mode: 'insensitive' } }, { part: { partNumber: { contains: text, mode: 'insensitive' } } }, { reason: { contains: text, mode: 'insensitive' } }];
  const from = qStr(q.from), to = qStr(q.to);
  if (from || to) w.createdAt = { gte: from ? new Date(from) : undefined, lte: to ? new Date(to + 'T23:59:59') : undefined };
  return w;
}

r.get('/transactions', requirePerm('inventory.view'), async (req, res) => {
  const { skip, take, page, pageSize } = pageArgs(req);
  const w = txWhere(req.query);
  const [rows, total] = await Promise.all([
    prisma.inventoryTransaction.findMany({ where: w, orderBy: { id: 'desc' }, skip, take, include: { part: { select: { id: true, partNumber: true, name: true, unit: true } }, location: { include: { warehouse: true } }, user: { select: { fullName: true } } } }),
    prisma.inventoryTransaction.count({ where: w }),
  ]);
  const eqIds = [...new Set(rows.map((x) => x.equipmentId).filter(Boolean))] as number[];
  const eq = new Map((await prisma.equipment.findMany({ where: { id: { in: eqIds } } })).map((e) => [e.id, e.name]));
  res.json({ page, pageSize, total, items: rows.map((x) => ({ ...x, equipment: x.equipmentId ? eq.get(x.equipmentId) : null })) });
});

r.get('/transactions/export', requirePerm('export.run'), async (req, res) => {
  const rows = await prisma.inventoryTransaction.findMany({ where: txWhere(req.query), orderBy: { id: 'desc' }, include: { part: true, location: { include: { warehouse: true } }, user: true } });
  await sendExport(res, String(req.query.format ?? 'xlsx'), 'Inventory Transactions', [
    { key: 'date', label: 'Date', format: 'date' }, { key: 'doc', label: 'Document' }, { key: 'type', label: 'Type' }, { key: 'part', label: 'Part Number' },
    { key: 'name', label: 'Part Name' }, { key: 'loc', label: 'Location' }, { key: 'qty', label: 'Qty', align: 'r', format: 'qty' },
    { key: 'bal', label: 'Balance', align: 'r', format: 'qty' }, { key: 'cost', label: 'Unit cost', align: 'r', format: 'num' }, { key: 'reason', label: 'Reason' }, { key: 'user', label: 'User' },
  ], rows.map((x) => ({ date: x.createdAt, doc: x.docNumber, type: x.type, part: x.part.partNumber, name: x.part.name, loc: `${x.location.warehouse.code}/${x.location.code}`, qty: x.quantity, bal: x.balanceAfter, cost: x.unitCost, reason: x.reason, user: x.user.fullName })));
});

const movementLine = z.object({
  partId: z.coerce.number().int().positive(),
  locationId: z.coerce.number().int().positive(),
  quantity: z.coerce.number().positive(),
});

// ISSUE (to a machine) and RETURN (back from a machine)
for (const kind of ['issue', 'return'] as const) {
  r.post(`/${kind}`, requirePerm('inventory.issue'), async (req, res) => {
    const body = z.object({
      lines: z.array(movementLine).min(1), equipmentId: z.coerce.number().int().positive().nullish(), reason: z.string().trim().min(1, 'Reason is required'),
    }).parse(req.body);
    const doc = await withTx(async (tx) => {
      const docNumber = await nextNumber(tx, kind === 'issue' ? 'ISS' : 'RET');
      const txs = [];
      for (const l of body.lines) {
        txs.push(await postMovement(tx, {
          partId: l.partId, locationId: l.locationId, quantity: kind === 'issue' ? -l.quantity : l.quantity,
          type: kind === 'issue' ? 'ISSUE' : 'RETURN', docNumber, userId: req.user!.id, equipmentId: body.equipmentId, reason: body.reason,
        }));
      }
      await audit(req, { action: kind === 'issue' ? 'INVENTORY_ISSUED' : 'INVENTORY_RETURNED', docType: 'INVENTORY', docNumber, newValue: { lines: body.lines, equipmentId: body.equipmentId }, comment: body.reason }, tx);
      return { docNumber, transactions: txs.length };
    });
    res.status(201).json(doc);
  });
}

// ADJUSTMENT: set a counted quantity (or +/- delta) with a mandatory reason
r.post('/adjust', requirePerm('inventory.adjust'), async (req, res) => {
  const body = z.object({
    reason: z.string().trim().min(3, 'Reason is required'),
    lines: z.array(z.object({
      partId: z.coerce.number().int().positive(), locationId: z.coerce.number().int().positive(),
      countedQty: z.coerce.number().min(0).optional(), delta: z.coerce.number().optional(),
    })).min(1),
  }).parse(req.body);
  const doc = await withTx(async (tx) => {
    const docNumber = await nextNumber(tx, 'ADJ');
    const changes = [];
    for (const l of body.lines) {
      const inv = await tx.inventory.findUnique({ where: { partId_locationId: { partId: l.partId, locationId: l.locationId } } });
      const current = Number(inv?.onHand ?? 0);
      const delta = l.countedQty !== undefined ? l.countedQty - current : l.delta;
      if (delta === undefined) throw badRequest('Give a counted quantity or a delta');
      if (Math.abs(delta) < 1e-9) continue;
      await postMovement(tx, { partId: l.partId, locationId: l.locationId, quantity: delta, type: 'ADJUSTMENT', docNumber, userId: req.user!.id, reason: body.reason });
      changes.push({ partId: l.partId, locationId: l.locationId, before: current, after: current + delta });
    }
    if (!changes.length) throw badRequest('Nothing to adjust: counted quantities equal current stock');
    await audit(req, { action: 'INVENTORY_ADJUSTED', docType: 'INVENTORY', docNumber, oldValue: changes.map((c) => ({ partId: c.partId, qty: c.before })), newValue: changes.map((c) => ({ partId: c.partId, qty: c.after })), comment: body.reason }, tx);
    return { docNumber, changes };
  });
  res.status(201).json(doc);
});

r.post('/transfer', requirePerm('inventory.transfer'), async (req, res) => {
  const body = z.object({
    fromLocationId: z.coerce.number().int().positive(), toLocationId: z.coerce.number().int().positive(), reason: optStr,
    lines: z.array(z.object({ partId: z.coerce.number().int().positive(), quantity: z.coerce.number().positive() })).min(1),
  }).parse(req.body);
  if (body.fromLocationId === body.toLocationId) throw badRequest('Choose two different locations');
  const doc = await withTx(async (tx) => {
    const docNumber = await nextNumber(tx, 'TRF');
    for (const l of body.lines) {
      await postMovement(tx, { partId: l.partId, locationId: body.fromLocationId, quantity: -l.quantity, type: 'TRANSFER_OUT', docNumber, userId: req.user!.id, reason: body.reason, refType: 'LOCATION', refId: body.toLocationId });
      await postMovement(tx, { partId: l.partId, locationId: body.toLocationId, quantity: l.quantity, type: 'TRANSFER_IN', docNumber, userId: req.user!.id, reason: body.reason, refType: 'LOCATION', refId: body.fromLocationId });
    }
    await audit(req, { action: 'INVENTORY_TRANSFERRED', docType: 'INVENTORY', docNumber, newValue: body }, tx);
    return { docNumber };
  });
  res.status(201).json(doc);
});

// Min / max / reorder levels per part & location
r.put('/levels', requirePerm('inventory.adjust'), async (req, res) => {
  const body = z.object({
    partId: z.coerce.number().int().positive(), locationId: z.coerce.number().int().positive(),
    minStock: z.coerce.number().min(0).nullable(), maxStock: z.coerce.number().min(0).nullable(), reorderLevel: z.coerce.number().min(0).nullable(),
  }).parse(req.body);
  if (body.minStock != null && body.maxStock != null && body.maxStock < body.minStock) throw badRequest('Maximum must be greater than or equal to minimum');
  const before = await prisma.inventory.findUnique({ where: { partId_locationId: { partId: body.partId, locationId: body.locationId } } });
  const inv = await prisma.inventory.upsert({
    where: { partId_locationId: { partId: body.partId, locationId: body.locationId } },
    update: { minStock: body.minStock, maxStock: body.maxStock, reorderLevel: body.reorderLevel },
    create: { partId: body.partId, locationId: body.locationId, minStock: body.minStock, maxStock: body.maxStock, reorderLevel: body.reorderLevel },
  });
  await audit(req, { action: 'STOCK_LEVELS_CHANGED', docType: 'PART', docId: body.partId, oldValue: before && { min: before.minStock, max: before.maxStock, reorder: before.reorderLevel }, newValue: { min: body.minStock, max: body.maxStock, reorder: body.reorderLevel } });
  res.json(inv);
});

// Suggested minimum stock from the workbook's SPARE PART column (preview + confirmed apply)
r.get('/suggested-min', requirePerm('inventory.view'), async (_req, res) => {
  const sugg = await suggestedMinimums();
  const current = await prisma.inventory.groupBy({ by: ['partId'], _sum: { minStock: true } });
  const cur = new Map(current.map((c) => [c.partId, c._sum.minStock == null ? null : Number(c._sum.minStock)]));
  res.json(sugg.map((s) => ({ ...s, currentMin: cur.get(s.partId) ?? null })));
});

r.post('/apply-suggested-min', requirePerm('inventory.adjust'), async (req, res) => {
  const body = z.object({ locationId: z.coerce.number().int().positive(), partIds: z.array(z.number().int()).min(1), onlyWhereEmpty: z.boolean().default(true) }).parse(req.body);
  const loc = await prisma.location.findUnique({ where: { id: body.locationId } });
  if (!loc) throw notFound('Location');
  const sugg = new Map((await suggestedMinimums()).map((s) => [s.partId, s]));
  const applied: { partId: number; min: number }[] = [];
  await withTx(async (tx) => {
    for (const pid of body.partIds) {
      const s = sugg.get(pid);
      if (!s) continue;
      const ex = await tx.inventory.findUnique({ where: { partId_locationId: { partId: pid, locationId: body.locationId } } });
      if (body.onlyWhereEmpty && ex?.minStock != null) continue;
      await tx.inventory.upsert({
        where: { partId_locationId: { partId: pid, locationId: body.locationId } },
        update: { minStock: s.suggested, reorderLevel: s.suggested },
        create: { partId: pid, locationId: body.locationId, minStock: s.suggested, reorderLevel: s.suggested },
      });
      applied.push({ partId: pid, min: s.suggested });
    }
    await audit(req, { action: 'SUGGESTED_MIN_APPLIED', docType: 'INVENTORY', newValue: { locationId: body.locationId, count: applied.length, applied } }, tx);
  });
  res.json({ applied: applied.length });
});

// ─── Warehouses & locations ────────────────────────────────────────────────
r.get('/warehouses', requirePerm('inventory.view'), async (_req, res) => {
  res.json(await prisma.warehouse.findMany({ orderBy: { code: 'asc' }, include: { locations: { orderBy: { code: 'asc' }, include: { _count: { select: { inventory: true } } } } } }));
});
r.post('/warehouses', requirePerm('inventory.adjust'), async (req, res) => {
  const body = z.object({ code: z.string().trim().min(1).max(20), name: z.string().trim().min(1) }).parse(req.body);
  const branch = await prisma.branch.findFirst();
  const w = await prisma.warehouse.create({ data: { ...body, code: body.code.toUpperCase(), branchId: branch?.id, locations: { create: [{ code: 'GENERAL' }] } } });
  await audit(req, { action: 'WAREHOUSE_CREATED', docType: 'WAREHOUSE', docId: w.id, docNumber: w.code, newValue: body });
  res.status(201).json(w);
});
r.patch('/warehouses/:id', requirePerm('inventory.adjust'), async (req, res) => {
  const id = idParam(req);
  const body = z.object({ name: z.string().trim().min(1) }).parse(req.body);
  const before = await prisma.warehouse.findUniqueOrThrow({ where: { id } });
  const w = await prisma.warehouse.update({ where: { id }, data: body });
  await audit(req, { action: 'WAREHOUSE_EDITED', docType: 'WAREHOUSE', docId: id, docNumber: w.code, oldValue: { name: before.name }, newValue: body });
  res.json(w);
});
r.post('/warehouses/:id/locations', requirePerm('inventory.adjust'), async (req, res) => {
  const warehouseId = idParam(req);
  const body = z.object({ code: z.string().trim().min(1).max(40), description: optStr }).parse(req.body);
  const l = await prisma.location.create({ data: { warehouseId, code: body.code.toUpperCase(), description: body.description } });
  await audit(req, { action: 'LOCATION_CREATED', docType: 'LOCATION', docId: l.id, docNumber: l.code, newValue: body });
  res.status(201).json(l);
});

export default r;
