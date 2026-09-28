import { Router } from 'express';
import { Prisma } from '@prisma/client';
import { prisma } from '../lib/prisma.js';
import { requirePerm } from '../lib/auth.js';
import { idParam, pageArgs, qStr } from '../lib/http.js';
import { loadGrn } from '../services/grn.js';
import { sendExport, sendPdf } from '../services/export.js';
import { grnPdf } from '../pdf/documents.js';

const r = Router();
r.use(requirePerm('grn.view', 'grn.create'));

function where(q: Record<string, unknown>): Prisma.GoodsReceiptWhereInput {
  const w: Prisma.GoodsReceiptWhereInput = {};
  const text = qStr(q.q);
  if (text) w.OR = [{ grnNumber: { contains: text, mode: 'insensitive' } }, { po: { poNumber: { contains: text, mode: 'insensitive' } } }, { po: { supplier: { name: { contains: text, mode: 'insensitive' } } } }];
  const from = qStr(q.from), to = qStr(q.to);
  if (from || to) w.receivedAt = { gte: from ? new Date(from) : undefined, lte: to ? new Date(to + 'T23:59:59') : undefined };
  return w;
}

r.get('/', async (req, res) => {
  const { skip, take, page, pageSize } = pageArgs(req);
  const w = where(req.query);
  const [rows, total] = await Promise.all([
    prisma.goodsReceipt.findMany({ where: w, orderBy: { id: 'desc' }, skip, take, include: { po: { select: { id: true, poNumber: true, supplier: { select: { name: true } } } }, receiver: { select: { fullName: true } }, items: { select: { receivedQty: true, rejectedQty: true } } } }),
    prisma.goodsReceipt.count({ where: w }),
  ]);
  res.json({ page, pageSize, total, items: rows.map((g) => ({ ...g, lineCount: g.items.length, receivedQty: g.items.reduce((a, i) => a + Number(i.receivedQty), 0), rejectedQty: g.items.reduce((a, i) => a + Number(i.rejectedQty), 0) })) });
});

r.get('/export', requirePerm('export.run'), async (req, res) => {
  const rows = await prisma.goodsReceiptItem.findMany({
    where: { grn: where(req.query) }, orderBy: { id: 'desc' },
    include: { grn: { include: { po: { include: { supplier: true } }, receiver: true } }, poItem: { include: { part: true } } },
  });
  await sendExport(res, String(req.query.format ?? 'xlsx'), 'Goods Receipts', [
    { key: 'grn', label: 'GRN' }, { key: 'date', label: 'Date', format: 'date' }, { key: 'po', label: 'PO' }, { key: 'supplier', label: 'Supplier' },
    { key: 'part', label: 'Part Number' }, { key: 'desc', label: 'Description' }, { key: 'ordered', label: 'Ordered', align: 'r', format: 'qty' },
    { key: 'received', label: 'Received', align: 'r', format: 'qty' }, { key: 'rejected', label: 'Rejected', align: 'r', format: 'qty' },
    { key: 'remaining', label: 'Remaining', align: 'r', format: 'qty' }, { key: 'by', label: 'Received by' },
  ], rows.map((i) => ({ grn: i.grn.grnNumber, date: i.grn.receivedAt, po: i.grn.po.poNumber, supplier: i.grn.po.supplier.name, part: i.poItem.part.partNumber, desc: i.poItem.description, ordered: i.orderedQty, received: i.receivedQty, rejected: i.rejectedQty, remaining: i.remainingQty, by: i.grn.receiver.fullName })));
});

r.get('/:id', async (req, res) => res.json(await loadGrn(idParam(req))));
r.get('/:id/pdf', async (req, res) => {
  const g = await loadGrn(idParam(req));
  sendPdf(res, await grnPdf(g.id), `${g.grnNumber}.pdf`);
});

export default r;
