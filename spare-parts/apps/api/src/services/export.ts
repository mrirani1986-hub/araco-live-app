import type { Response } from 'express';
import ExcelJS from 'exceljs';
import { badRequest } from '../lib/errors.js';
import { tablePdf, type TableColumn } from '../pdf/documents.js';

export type ExportFormat = 'xlsx' | 'csv' | 'pdf';

const csvCell = (v: unknown) => {
  if (v == null) return '';
  const s = v instanceof Date ? v.toISOString() : String(v);
  // Neutralise spreadsheet formula injection.
  const safe = /^[=+\-@\t\r]/.test(s) && isNaN(Number(s)) ? `'${s}` : s;
  return /[",\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
};

const excelValue = (v: unknown) => {
  if (typeof v === 'string' && /^[=+\-@]/.test(v) && isNaN(Number(v))) return `'${v}`;
  return v as ExcelJS.CellValue;
};

export function fileName(base: string, ext: string) {
  return `${base.replace(/[^A-Za-z0-9_.-]+/g, '_')}_${new Date().toISOString().slice(0, 10)}.${ext}`;
}

export async function workbookBuffer(title: string, columns: TableColumn[], rows: Record<string, unknown>[]) {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'ARACO Spare Parts';
  const ws = wb.addWorksheet(title.slice(0, 31));
  ws.columns = columns.map((c) => ({ header: c.label, key: c.key, width: Math.max(10, Math.min(50, c.label.length + 6)) }));
  ws.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
  ws.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF0F3D68' } };
  for (const r of rows) {
    const row: Record<string, unknown> = {};
    for (const c of columns) {
      const v = r[c.key];
      row[c.key] = c.format === 'date' && v ? new Date(v as string) : (c.format === 'num' || c.format === 'qty') && v != null && v !== '' ? Number(v) : excelValue(v);
    }
    ws.addRow(row);
  }
  columns.forEach((c, i) => {
    if (c.format === 'num') ws.getColumn(i + 1).numFmt = '#,##0.00';
    if (c.format === 'date') ws.getColumn(i + 1).numFmt = 'yyyy-mm-dd';
  });
  ws.views = [{ state: 'frozen', ySplit: 1 }];
  ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: columns.length } };
  return Buffer.from(await wb.xlsx.writeBuffer());
}

export async function sendExport(res: Response, format: string, title: string, columns: TableColumn[], rows: Record<string, unknown>[], subtitle?: string) {
  if (format === 'csv') {
    const lines = [columns.map((c) => csvCell(c.label)).join(','), ...rows.map((r) => columns.map((c) => csvCell(r[c.key])).join(','))];
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${fileName(title, 'csv')}"`);
    return res.send('﻿' + lines.join('\r\n'));
  }
  if (format === 'xlsx') {
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${fileName(title, 'xlsx')}"`);
    return res.send(await workbookBuffer(title, columns, rows));
  }
  if (format === 'pdf') {
    return sendPdf(res, await tablePdf(title, columns, rows, subtitle), fileName(title, 'pdf'));
  }
  throw badRequest('format must be xlsx, csv or pdf');
}

export function sendPdf(res: Response, pdf: Buffer | Uint8Array, name: string, download = false) {
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `${download ? 'attachment' : 'inline'}; filename="${name}"`);
  res.send(Buffer.from(pdf));
}
