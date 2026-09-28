import { Router } from 'express';
import { Prisma } from '@prisma/client';
import { prisma } from '../lib/prisma.js';
import { requirePerm } from '../lib/auth.js';
import { qInt, qStr } from '../lib/http.js';
import { sendExport } from '../services/export.js';
import type { TableColumn } from '../pdf/documents.js';

const r = Router();
r.use(requirePerm('reports.view'));

const range = (q: Record<string, unknown>) => ({
  from: qStr(q.from) ? new Date(String(q.from)) : new Date('2000-01-01'),
  to: qStr(q.to) ? new Date(String(q.to) + 'T23:59:59') : new Date('2999-12-31'),
});

interface Report { title: string; columns: TableColumn[]; rows: (q: Record<string, unknown>) => Promise<Record<string, unknown>[]> }

const REPORTS: Record<string, Report> = {
  'purchase-history': {
    title: 'Purchase History',
    columns: [
      { key: 'date', label: 'Date', format: 'date' }, { key: 'grn', label: 'GRN' }, { key: 'po', label: 'PO' }, { key: 'supplier', label: 'Supplier' },
      { key: 'partNumber', label: 'Part Number' }, { key: 'name', label: 'Part Name' }, { key: 'qty', label: 'Qty', align: 'r', format: 'qty' },
      { key: 'unitPrice', label: 'Unit Price', align: 'r', format: 'num' }, { key: 'currency', label: 'Currency' },
    ],
    rows: async (q) => {
      const { from, to } = range(q);
      const partId = qInt(q.partId), supplierId = qInt(q.supplierId);
      return prisma.$queryRaw`
        SELECT g.received_at AS date, g.grn_number AS grn, po.po_number AS po, s.name AS supplier, p.part_number AS "partNumber", p.name,
               gi.received_qty AS qty, (poi.unit_price * (1 - poi.discount_pct / 100)) AS "unitPrice", po.currency
        FROM goods_receipt_items gi JOIN goods_receipts g ON g.id = gi.grn_id JOIN purchase_order_items poi ON poi.id = gi.po_item_id
        JOIN purchase_orders po ON po.id = poi.po_id JOIN suppliers s ON s.id = po.supplier_id JOIN parts p ON p.id = poi.part_id
        WHERE g.received_at BETWEEN ${from} AND ${to}
          AND (${partId ?? null}::int IS NULL OR p.id = ${partId ?? null})
          AND (${supplierId ?? null}::int IS NULL OR s.id = ${supplierId ?? null})
        ORDER BY g.received_at DESC, g.id DESC`;
    },
  },
  'spend-by-supplier': {
    title: 'Spend by Supplier',
    columns: [{ key: 'supplier', label: 'Supplier' }, { key: 'pos', label: 'POs', align: 'r' }, { key: 'value', label: 'Value (incl. tax)', align: 'r', format: 'num' }, { key: 'currency', label: 'Currency' }],
    rows: async (q) => {
      const { from, to } = range(q);
      return prisma.$queryRaw`
        SELECT s.name AS supplier, COUNT(DISTINCT po.id)::int AS pos, po.currency,
               SUM(poi.quantity * poi.unit_price * (1 - poi.discount_pct/100) * (1 + poi.tax_pct/100)) AS value
        FROM purchase_orders po JOIN purchase_order_items poi ON poi.po_id = po.id JOIN suppliers s ON s.id = po.supplier_id
        WHERE po.status NOT IN ('CANCELLED','DRAFT') AND po.po_date BETWEEN ${from} AND ${to}
        GROUP BY s.name, po.currency ORDER BY value DESC`;
    },
  },
  'spend-by-equipment': {
    title: 'Spend by Equipment',
    columns: [{ key: 'equipment', label: 'Equipment' }, { key: 'value', label: 'Value (incl. tax)', align: 'r', format: 'num' }, { key: 'currency', label: 'Currency' }],
    rows: async (q) => {
      const { from, to } = range(q);
      return prisma.$queryRaw`
        SELECT COALESCE(e.name, pri.machine, 'Not specified') AS equipment, po.currency,
               SUM(poi.quantity * poi.unit_price * (1 - poi.discount_pct/100) * (1 + poi.tax_pct/100)) AS value
        FROM purchase_orders po JOIN purchase_order_items poi ON poi.po_id = po.id
        LEFT JOIN purchase_requisition_items pri ON pri.id = poi.pr_item_id LEFT JOIN equipment e ON e.id = pri.equipment_id
        WHERE po.status NOT IN ('CANCELLED','DRAFT') AND po.po_date BETWEEN ${from} AND ${to}
        GROUP BY 1, 2 ORDER BY value DESC`;
    },
  },
  'issues-by-equipment': {
    title: 'Parts Issued by Equipment',
    columns: [{ key: 'date', label: 'Date', format: 'date' }, { key: 'doc', label: 'Document' }, { key: 'equipment', label: 'Equipment' }, { key: 'partNumber', label: 'Part Number' }, { key: 'name', label: 'Part Name' }, { key: 'qty', label: 'Qty', align: 'r', format: 'qty' }, { key: 'reason', label: 'Reason' }],
    rows: async (q) => {
      const { from, to } = range(q);
      return prisma.$queryRaw`
        SELECT t.created_at AS date, t.doc_number AS doc, COALESCE(e.name, '—') AS equipment, p.part_number AS "partNumber", p.name, -t.quantity AS qty, t.reason
        FROM inventory_transactions t JOIN parts p ON p.id = t.part_id LEFT JOIN equipment e ON e.id = t.equipment_id
        WHERE t.type = 'ISSUE' AND t.created_at BETWEEN ${from} AND ${to} ORDER BY t.id DESC`;
    },
  },
  'inventory-valuation': {
    title: 'Inventory Valuation',
    columns: [{ key: 'partNumber', label: 'Part Number' }, { key: 'name', label: 'Part Name' }, { key: 'onHand', label: 'On hand', align: 'r', format: 'qty' }, { key: 'unit', label: 'Unit' }, { key: 'avgCost', label: 'Avg. receipt cost', align: 'r', format: 'num' }, { key: 'value', label: 'Value', align: 'r', format: 'num' }, { key: 'currency', label: 'Currency' }],
    rows: async () => prisma.$queryRaw`
      SELECT p.part_number AS "partNumber", p.name, p.unit, SUM(i.on_hand) AS "onHand",
             c.avg_cost AS "avgCost", SUM(i.on_hand) * c.avg_cost AS value, c.currency
      FROM parts p JOIN inventory i ON i.part_id = p.id
      LEFT JOIN LATERAL (SELECT SUM(t.quantity * t.unit_cost) / NULLIF(SUM(t.quantity), 0) AS avg_cost, MAX(t.currency) AS currency
                         FROM inventory_transactions t WHERE t.part_id = p.id AND t.type = 'RECEIPT') c ON true
      GROUP BY p.id, c.avg_cost, c.currency HAVING SUM(i.on_hand) > 0 ORDER BY p.part_number`,
  },
  'recommended-spares': {
    title: 'Recommended Spares vs Stock',
    columns: [{ key: 'partNumber', label: 'Part Number' }, { key: 'name', label: 'Part Name' }, { key: 'equipment', label: 'Equipment' }, { key: 'recommended', label: 'Recommended (workbook)', align: 'r', format: 'qty' }, { key: 'onHand', label: 'On hand', align: 'r', format: 'qty' }, { key: 'shortfall', label: 'Shortfall', align: 'r', format: 'qty' }, { key: 'unit', label: 'Unit' }],
    rows: async () => prisma.$queryRaw`
      SELECT p.part_number AS "partNumber", p.name, p.unit, string_agg(DISTINCT e.name, ', ') AS equipment,
             SUM(u.recommended_spare) AS recommended,
             COALESCE((SELECT SUM(on_hand) FROM inventory i WHERE i.part_id = p.id), 0) AS "onHand",
             GREATEST(SUM(u.recommended_spare) - COALESCE((SELECT SUM(on_hand) FROM inventory i WHERE i.part_id = p.id), 0), 0) AS shortfall
      FROM part_usages u JOIN parts p ON p.id = u.part_id JOIN assemblies a ON a.id = u.assembly_id JOIN equipment e ON e.id = a.equipment_id
      WHERE u.recommended_spare > 0 GROUP BY p.id ORDER BY shortfall DESC, p.part_number`,
  },
};

r.get('/', (_req, res) => res.json(Object.entries(REPORTS).map(([key, v]) => ({ key, title: v.title, columns: v.columns }))));

r.get('/:key', async (req, res) => {
  const rep = REPORTS[String(req.params.key)];
  if (!rep) return res.status(404).json({ error: 'Report not found' });
  const rows = (await rep.rows(req.query)).map((row) => Object.fromEntries(Object.entries(row).map(([k, v]) => [k, v instanceof Prisma.Decimal ? Number(v) : v])));
  const format = qStr(req.query.format);
  if (format) {
    if (!req.user!.permissions.has('export.run')) return res.status(403).json({ error: 'You do not have permission to export' });
    return sendExport(res, format, rep.title, rep.columns, rows);
  }
  res.json({ title: rep.title, columns: rep.columns, rows });
});

export default r;
