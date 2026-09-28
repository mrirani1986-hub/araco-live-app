import { Router } from 'express';
import { z } from 'zod';
import ExcelJS from 'exceljs';
import { Prisma } from '@prisma/client';
import { prisma } from '../lib/prisma.js';
import { requirePerm } from '../lib/auth.js';
import { idParam, optDate, optStr, pageArgs, qInt, qStr } from '../lib/http.js';
import { poTotals } from '../lib/money.js';
import { getSettings } from '../lib/settings.js';
import { audit } from '../lib/audit.js';
import {
  PO_OPEN, changePoStatus, createManualPo, createPosFromPr, loadPo, updatePo, withPoTotals,
} from '../services/po.js';
import { receiveGoods } from '../services/grn.js';
import { fileName, sendExport, sendPdf } from '../services/export.js';
import { poPdf, partPictureKeys } from '../pdf/documents.js';

const r = Router();

const headerSchema = z.object({
  currency: z.string().trim().length(3).optional(),
  paymentTerms: optStr, deliveryTerms: optStr, expectedDelivery: optDate, shippingMethod: optStr,
  shippingCost: z.coerce.number().min(0).optional(), otherCharges: z.coerce.number().min(0).optional(),
  terms: optStr, notes: optStr,
});
const lineSchema = z.object({
  prItemId: z.coerce.number().int().positive().nullish(),
  partId: z.coerce.number().int().positive().optional(),
  supplierId: z.coerce.number().int().positive().nullish(),
  quantity: z.coerce.number().positive(),
  unitPrice: z.coerce.number().min(0),
  discountPct: z.coerce.number().min(0).max(100).optional(),
  taxPct: z.coerce.number().min(0).max(100).optional(),
  supplierPartNumber: optStr,
  description: optStr,
});

function listWhere(q: Record<string, unknown>): Prisma.PurchaseOrderWhereInput {
  const where: Prisma.PurchaseOrderWhereInput = {};
  const status = qStr(q.status);
  if (status === 'OPEN') where.status = { in: PO_OPEN };
  else if (status === 'OVERDUE') { where.status = { in: ['APPROVED', 'SENT', 'PARTIALLY_RECEIVED'] }; where.expectedDelivery = { lt: new Date() }; }
  else if (status) where.status = { in: status.split(',') };
  const supplierId = qInt(q.supplierId);
  if (supplierId) where.supplierId = supplierId;
  const text = qStr(q.q);
  if (text) where.OR = [{ poNumber: { contains: text, mode: 'insensitive' } }, { prNumber: { contains: text, mode: 'insensitive' } }, { supplier: { name: { contains: text, mode: 'insensitive' } } }];
  const from = qStr(q.from), to = qStr(q.to);
  if (from || to) where.poDate = { gte: from ? new Date(from) : undefined, lte: to ? new Date(to + 'T23:59:59') : undefined };
  return where;
}

r.get('/', requirePerm('po.view', 'grn.create'), async (req, res) => {
  const { skip, take, page, pageSize } = pageArgs(req);
  const where = listWhere(req.query);
  const [rows, total] = await Promise.all([
    prisma.purchaseOrder.findMany({ where, orderBy: { id: 'desc' }, skip, take, include: { supplier: { select: { name: true } }, items: true } }),
    prisma.purchaseOrder.count({ where }),
  ]);
  res.json({
    page, pageSize, total,
    items: rows.map((p) => ({
      ...p, items: undefined, lineCount: p.items.length, totals: poTotals(p.items, p.shippingCost, p.otherCharges),
      overdue: !!p.expectedDelivery && ['APPROVED', 'SENT', 'PARTIALLY_RECEIVED'].includes(p.status) && p.expectedDelivery < new Date(),
    })),
  });
});

r.get('/export', requirePerm('export.run'), async (req, res) => {
  const rows = await prisma.purchaseOrder.findMany({ where: listWhere(req.query), orderBy: { id: 'desc' }, include: { supplier: true, items: true } });
  await sendExport(res, String(req.query.format ?? 'xlsx'), 'Purchase Orders', [
    { key: 'poNumber', label: 'PO Number' }, { key: 'poDate', label: 'Date', format: 'date' }, { key: 'supplier', label: 'Supplier' },
    { key: 'prNumber', label: 'PR' }, { key: 'status', label: 'Status' }, { key: 'expectedDelivery', label: 'Expected', format: 'date' },
    { key: 'lines', label: 'Lines', align: 'r' }, { key: 'total', label: 'Grand Total', align: 'r', format: 'num' }, { key: 'currency', label: 'Cur.' },
  ], rows.map((p) => ({ ...p, supplier: p.supplier.name, lines: p.items.length, total: poTotals(p.items, p.shippingCost, p.otherCharges).grandTotal })));
});

r.get('/:id', requirePerm('po.view', 'grn.create'), async (req, res) => {
  const po = withPoTotals(await loadPo(idParam(req)));
  const pics = await partPictureKeys(po.items.map((i) => i.partId));
  res.json({ ...po, items: po.items.map((i) => ({ ...i, picture: pics.get(i.partId) ?? null })) });
});

r.get('/:id/pdf', requirePerm('po.view'), async (req, res) => {
  const id = idParam(req);
  const po = await loadPo(id);
  const pdf = await poPdf(id);
  if (req.query.download) await audit(req, { action: 'PO_PDF_DOWNLOADED', docType: 'PO', docId: id, docNumber: po.poNumber });
  sendPdf(res, pdf, `${po.poNumber}.pdf`, !!req.query.download);
});

r.get('/:id/xlsx', requirePerm('po.view'), async (req, res) => {
  const po = withPoTotals(await loadPo(idParam(req)));
  const s = await getSettings();
  const sup = po.supplierSnapshot as Record<string, string | null>;
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet(po.poNumber);
  ws.addRow([s.company.name]).font = { bold: true, size: 14 };
  ws.addRow([s.company.address]);
  ws.addRow([[s.company.phone, s.company.email].filter(Boolean).join('  ')]);
  ws.addRow([]);
  ws.addRow(['PURCHASE ORDER', po.poNumber]).font = { bold: true, size: 13 };
  const kv: [string, unknown][] = [
    ['PO Date', po.poDate.toISOString().slice(0, 10)], ['Supplier', sup.name], ['Supplier address', sup.address], ['Supplier phone', sup.phone],
    ['Supplier email', sup.email], ['Reference PR', po.prNumber], ['Currency', po.currency], ['Payment terms', po.paymentTerms],
    ['Delivery terms', po.deliveryTerms], ['Expected delivery', po.expectedDelivery?.toISOString().slice(0, 10)], ['Shipping method', po.shippingMethod], ['Buyer', po.buyer.fullName],
  ];
  for (const [k, v] of kv) ws.addRow([k, v ?? '']);
  ws.addRow([]);
  const hdr = ws.addRow(['Line', 'Part Number', 'Supplier Part No.', 'Description', 'Specification', 'Qty', 'Unit', 'Unit Price', 'Discount %', 'Tax %', 'Line Total']);
  hdr.font = { bold: true, color: { argb: 'FFFFFFFF' } };
  hdr.eachCell((c) => { c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF0F3D68' } }; });
  for (const i of po.items) ws.addRow([i.lineNo, i.part.partNumber, i.supplierPartNumber ?? '', i.description, i.specification ?? '', Number(i.quantity), i.unit, Number(i.unitPrice), Number(i.discountPct), Number(i.taxPct), i.lineTotal]);
  ws.addRow([]);
  for (const [k, v] of [['Subtotal', po.totals.subtotal], ['Discount', -po.totals.discount], ['Tax', po.totals.tax], ['Shipping', po.totals.shipping], ['Other charges', po.totals.other], ['Grand Total', po.totals.grandTotal]] as const) {
    const row = ws.addRow(['', '', '', '', '', '', '', '', '', k, v]);
    if (k === 'Grand Total') row.font = { bold: true };
  }
  ws.addRow([]);
  ws.addRow(['Terms & Conditions']).font = { bold: true };
  for (const line of (po.terms ?? '').split('\n')) ws.addRow([line]);
  ws.columns.forEach((c, i) => { c.width = [6, 14, 16, 36, 24, 8, 7, 12, 10, 8, 14][i] ?? 12; });
  ws.getColumn(8).numFmt = '#,##0.00';
  ws.getColumn(11).numFmt = '#,##0.00';
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="${fileName(po.poNumber, 'xlsx')}"`);
  res.send(Buffer.from(await wb.xlsx.writeBuffer()));
});

r.post('/', requirePerm('po.create'), async (req, res) => {
  const body = headerSchema.extend({ supplierId: z.coerce.number().int().positive(), lines: z.array(lineSchema).min(1) }).parse(req.body);
  res.status(201).json(await createManualPo(req, body.supplierId, body, body.lines));
});

r.post('/from-pr/:prId', requirePerm('po.create'), async (req, res) => {
  const body = headerSchema.extend({
    lines: z.array(lineSchema.extend({ prItemId: z.coerce.number().int().positive() })).min(1),
    perSupplier: z.record(z.string(), headerSchema).optional(),
  }).parse(req.body);
  res.status(201).json(await createPosFromPr(req, idParam(req, 'prId'), body.lines, body));
});

r.patch('/:id', requirePerm('po.create'), async (req, res) => {
  const body = headerSchema.extend({
    lines: z.array(z.object({
      id: z.number().int().positive(), quantity: z.coerce.number().positive().optional(), unitPrice: z.coerce.number().min(0).optional(),
      discountPct: z.coerce.number().min(0).max(100).optional(), taxPct: z.coerce.number().min(0).max(100).optional(), supplierPartNumber: optStr,
    })).optional(),
  }).parse(req.body);
  res.json(await updatePo(req, idParam(req), body, body.lines));
});

const comment = z.object({ comment: optStr });
r.post('/:id/approve', requirePerm('po.approve'), async (req, res) => res.json(await changePoStatus(req, idParam(req), 'APPROVE', comment.parse(req.body ?? {}).comment ?? undefined)));
r.post('/:id/send', requirePerm('po.send'), async (req, res) => res.json(await changePoStatus(req, idParam(req), 'SEND', comment.parse(req.body ?? {}).comment ?? undefined)));
r.post('/:id/cancel', requirePerm('po.create'), async (req, res) => res.json(await changePoStatus(req, idParam(req), 'CANCEL', comment.parse(req.body ?? {}).comment ?? undefined)));
r.post('/:id/close', requirePerm('po.create', 'grn.create'), async (req, res) => res.json(await changePoStatus(req, idParam(req), 'CLOSE', comment.parse(req.body ?? {}).comment ?? undefined)));

r.post('/:id/receive', requirePerm('grn.create'), async (req, res) => {
  const body = z.object({
    warehouseId: z.coerce.number().int().positive(),
    receivedAt: optDate, deliveryNote: optStr, notes: optStr,
    lines: z.array(z.object({
      poItemId: z.coerce.number().int().positive(), receivedQty: z.coerce.number().min(0), rejectedQty: z.coerce.number().min(0).optional(),
      locationId: z.coerce.number().int().positive().optional(), condition: z.string().trim().max(40).optional(), notes: optStr,
    })).min(1),
  }).parse(req.body);
  res.status(201).json(await receiveGoods(req, idParam(req), { ...body, receivedAt: body.receivedAt ?? undefined }));
});

export default r;
