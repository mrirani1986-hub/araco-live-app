import { getSettings } from '../lib/settings.js';
import { Router } from 'express';
import { Prisma } from '@prisma/client';
import { prisma } from '../lib/prisma.js';
import { qStr } from '../lib/http.js';
import { STOCK_CTE } from '../services/parts.js';
import { pendingForUser } from '../services/pr.js';

const r = Router();

// Net value of a PO line (after discount, incl. tax) — used for spend analytics.
const LINE_VALUE = Prisma.sql`(poi.quantity * poi.unit_price * (1 - poi.discount_pct / 100) * (1 + poi.tax_pct / 100))`;

r.get('/', async (req, res) => {
  const from = qStr(req.query.from) ? new Date(String(req.query.from)) : new Date(new Date().getFullYear(), 0, 1);
  const to = qStr(req.query.to) ? new Date(String(req.query.to) + 'T23:59:59') : new Date();
  const canReports = req.user!.permissions.has('reports.view');

  const [stock] = await prisma.$queryRaw<Record<string, bigint>[]>`
    WITH ${STOCK_CTE}
    SELECT COUNT(*) FILTER (WHERE true) AS total_parts,
           COUNT(*) FILTER (WHERE stock_status = 'LOW_STOCK') AS low_stock,
           COUNT(*) FILTER (WHERE stock_status = 'OUT_OF_STOCK') AS out_of_stock,
           COUNT(*) FILTER (WHERE stock_status = 'REORDER') AS reorder,
           COUNT(*) FILTER (WHERE on_hand > 0) AS in_stock
    FROM status s JOIN parts p ON p.id = s.part_id WHERE p.status <> 'DELETED'`;
  const [openPrs, openPos, overduePos, myDrafts] = await Promise.all([
    prisma.purchaseRequisition.count({ where: { status: { in: ['DRAFT', 'SUBMITTED', 'PENDING_APPROVAL', 'APPROVED'] } } }),
    prisma.purchaseOrder.count({ where: { status: { in: ['DRAFT', 'APPROVED', 'SENT', 'PARTIALLY_RECEIVED'] } } }),
    prisma.purchaseOrder.count({ where: { status: { in: ['APPROVED', 'SENT', 'PARTIALLY_RECEIVED'] }, expectedDelivery: { lt: new Date() } } }),
    prisma.purchaseRequisition.count({ where: { status: 'DRAFT', requestedBy: req.user!.id } }),
  ]);
  const pendingApprovals = await prisma.purchaseRequisition.count({ where: { status: { in: ['SUBMITTED', 'PENDING_APPROVAL'] } } });
  const myPending = req.user!.permissions.has('pr.approve') ? (await pendingForUser(req)).length : 0;

  const cards = {
    totalParts: Number(stock.total_parts), inStock: Number(stock.in_stock), lowStock: Number(stock.low_stock), outOfStock: Number(stock.out_of_stock),
    reorder: Number(stock.reorder), openPrs, pendingApprovals, myPendingApprovals: myPending, openPos, overduePos, myDrafts,
    totalPurchaseValue: 0,
  };
  if (!canReports) return res.json({ from, to, cards });

  const byMonth = await prisma.$queryRaw<{ month: string; currency: string; value: number }[]>`
    SELECT to_char(date_trunc('month', po.po_date), 'YYYY-MM') AS month, po.currency, SUM(${LINE_VALUE})::float AS value
    FROM purchase_orders po JOIN purchase_order_items poi ON poi.po_id = po.id
    WHERE po.status <> 'CANCELLED' AND po.status <> 'DRAFT' AND po.po_date BETWEEN ${from} AND ${to}
    GROUP BY 1, 2 ORDER BY 1`;
  const bySupplier = await prisma.$queryRaw<{ supplier: string; value: number }[]>`
    SELECT s.name AS supplier, SUM(${LINE_VALUE})::float AS value
    FROM purchase_orders po JOIN purchase_order_items poi ON poi.po_id = po.id JOIN suppliers s ON s.id = po.supplier_id
    WHERE po.status NOT IN ('CANCELLED','DRAFT') AND po.po_date BETWEEN ${from} AND ${to}
    GROUP BY 1 ORDER BY 2 DESC LIMIT 10`;
  const byCategory = await prisma.$queryRaw<{ category: string; value: number }[]>`
    SELECT COALESCE(c.name, 'Uncategorised') AS category, SUM(${LINE_VALUE})::float AS value
    FROM purchase_orders po JOIN purchase_order_items poi ON poi.po_id = po.id JOIN parts p ON p.id = poi.part_id LEFT JOIN categories c ON c.id = p.category_id
    WHERE po.status NOT IN ('CANCELLED','DRAFT') AND po.po_date BETWEEN ${from} AND ${to}
    GROUP BY 1 ORDER BY 2 DESC LIMIT 12`;
  const topParts = await prisma.$queryRaw<{ part_id: number; part_number: string; name: string; qty: number; value: number }[]>`
    SELECT p.id AS part_id, p.part_number, p.name, SUM(poi.quantity)::float AS qty, SUM(${LINE_VALUE})::float AS value
    FROM purchase_orders po JOIN purchase_order_items poi ON poi.po_id = po.id JOIN parts p ON p.id = poi.part_id
    WHERE po.status NOT IN ('CANCELLED','DRAFT') AND po.po_date BETWEEN ${from} AND ${to}
    GROUP BY 1, 2, 3 ORDER BY 5 DESC LIMIT 10`;
  const poStatus = await prisma.$queryRaw<{ status: string; count: number }[]>`
    SELECT CASE WHEN status IN ('APPROVED','SENT','PARTIALLY_RECEIVED') AND expected_delivery < now() THEN 'OVERDUE' ELSE status END AS status, COUNT(*)::int AS count
    FROM purchase_orders WHERE po_date BETWEEN ${from} AND ${to} GROUP BY 1 ORDER BY 1`;
  const lowStock = await prisma.$queryRaw<Record<string, unknown>[]>`
    WITH ${STOCK_CTE}
    SELECT p.id, p.part_number, p.name, p.unit, s.on_hand::float, s.min_stock::float, s.reorder_level::float, s.stock_status
    FROM status s JOIN parts p ON p.id = s.part_id
    WHERE s.stock_status IN ('OUT_OF_STOCK','LOW_STOCK','REORDER')
    ORDER BY CASE s.stock_status WHEN 'OUT_OF_STOCK' THEN 0 WHEN 'LOW_STOCK' THEN 1 ELSE 2 END, p.part_number LIMIT 15`;
  const [openPrList, openPoList] = await Promise.all([
    prisma.purchaseRequisition.findMany({ where: { status: { in: ['SUBMITTED', 'PENDING_APPROVAL', 'APPROVED'] } }, orderBy: { id: 'desc' }, take: 8, include: { requester: { select: { fullName: true } } } }),
    prisma.purchaseOrder.findMany({ where: { status: { in: ['DRAFT', 'APPROVED', 'SENT', 'PARTIALLY_RECEIVED'] } }, orderBy: { id: 'desc' }, take: 8, include: { supplier: { select: { name: true } } } }),
  ]);
  cards.totalPurchaseValue = Math.round(byMonth.reduce((a, m) => a + m.value, 0) * 100) / 100;
  res.json({ from, to, cards, byMonth, bySupplier, byCategory, topParts, poStatus, lowStock, openPrList, openPoList, currencies: [...new Set(byMonth.map((m) => m.currency))], defaultCurrency: (await getSettings()).currency });
});

export default r;
