import ExcelJS from 'exceljs';
import { Prisma } from '@prisma/client';
import type { Request } from 'express';
import { prisma, type Tx } from '../lib/prisma.js';
import { nextNumber } from '../lib/numbering.js';
import { audit } from '../lib/audit.js';
import { postMovement } from './inventory.js';
import { refreshSearchText } from './parts.js';

export type ImportKind = 'PARTS' | 'SUPPLIERS' | 'SUPPLIER_PRICES' | 'STOCK' | 'CATEGORIES';
export type RowAction = 'CREATE' | 'SKIP' | 'FILL_EMPTY' | 'OVERWRITE';
export type RowStatus = 'NEW' | 'EXISTING' | 'ERROR' | 'DUPLICATE_IN_FILE';

interface FieldDef { key: string; label: string; aliases?: string[]; required?: boolean; type?: 'number' | 'bool' }

export const IMPORT_DEFS: Record<ImportKind, { title: string; fields: FieldDef[] }> = {
  PARTS: {
    title: 'Parts',
    fields: [
      { key: 'partNumber', label: 'Part Number', aliases: ['code', 'part no', 'part number', 'partnumber'], required: true },
      { key: 'name', label: 'Part Name', aliases: ['name', 'part name'], required: true },
      { key: 'itemCode', label: 'Item Code' }, { key: 'description', label: 'Description' },
      { key: 'category', label: 'Category' }, { key: 'subcategory', label: 'Subcategory' },
      { key: 'manufacturer', label: 'Manufacturer' }, { key: 'brand', label: 'Brand' }, { key: 'model', label: 'Model' },
      { key: 'equipment', label: 'Equipment', aliases: ['machine'] }, { key: 'specification', label: 'Specification', aliases: ['spec'] },
      { key: 'unit', label: 'Unit' }, { key: 'standardPrice', label: 'Price', aliases: ['cost', 'unit price', 'standard price'], type: 'number' },
      { key: 'currency', label: 'Currency' }, { key: 'notes', label: 'Notes' },
    ],
  },
  SUPPLIERS: {
    title: 'Suppliers',
    fields: [
      { key: 'name', label: 'Supplier Name', aliases: ['name', 'supplier'], required: true }, { key: 'company', label: 'Company' },
      { key: 'contactPerson', label: 'Contact Person', aliases: ['contact'] }, { key: 'phone', label: 'Phone' }, { key: 'email', label: 'Email' },
      { key: 'address', label: 'Address' }, { key: 'country', label: 'Country' }, { key: 'currency', label: 'Currency' },
      { key: 'paymentTerms', label: 'Payment Terms' }, { key: 'deliveryTerms', label: 'Delivery Terms' },
      { key: 'taxNumber', label: 'Tax Number', aliases: ['vat', 'vat number', 'tax no'] }, { key: 'notes', label: 'Notes' },
    ],
  },
  SUPPLIER_PRICES: {
    title: 'Supplier prices',
    fields: [
      { key: 'supplier', label: 'Supplier', aliases: ['supplier name', 'supplier id', 'supplier code'], required: true },
      { key: 'partNumber', label: 'Part Number', aliases: ['code', 'part no'], required: true },
      { key: 'supplierPartNumber', label: 'Supplier Part Number', aliases: ['supplier part no'] },
      { key: 'price', label: 'Price', aliases: ['unit price', 'cost'], type: 'number' }, { key: 'currency', label: 'Currency' },
      { key: 'leadTimeDays', label: 'Lead Time Days', aliases: ['lead time'], type: 'number' },
      { key: 'preferred', label: 'Preferred', type: 'bool' },
    ],
  },
  STOCK: {
    title: 'Opening stock / stock count',
    fields: [
      { key: 'partNumber', label: 'Part Number', aliases: ['code'], required: true },
      { key: 'warehouse', label: 'Warehouse', required: true }, { key: 'location', label: 'Location', aliases: ['bin', 'shelf'], required: true },
      { key: 'onHand', label: 'Quantity On Hand', aliases: ['stock', 'qty', 'quantity', 'current stock', 'on hand'], type: 'number' },
      { key: 'minStock', label: 'Minimum Stock', aliases: ['min', 'min stock'], type: 'number' },
      { key: 'maxStock', label: 'Maximum Stock', aliases: ['max', 'max stock'], type: 'number' },
      { key: 'reorderLevel', label: 'Reorder Level', aliases: ['reorder'], type: 'number' },
      { key: 'unitCost', label: 'Unit Cost', aliases: ['cost'], type: 'number' },
    ],
  },
  CATEGORIES: {
    title: 'Categories',
    fields: [{ key: 'name', label: 'Category', aliases: ['name', 'category name'], required: true }, { key: 'parent', label: 'Parent Category', aliases: ['parent'] }],
  },
};

export interface PreviewRow {
  rowNo: number;
  data: Record<string, string | number | boolean | null>;
  status: RowStatus;
  action: RowAction;
  errors: string[];
  warnings: string[];
  existing?: Record<string, unknown> | null;
  userChoice?: boolean; // action chosen explicitly in the preview
}

const norm = (s: unknown) => String(s ?? '').trim().toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

function cellText(v: ExcelJS.CellValue): string | number | boolean | null {
  if (v == null) return null;
  if (typeof v === 'object') {
    if ('result' in v) return cellText(v.result as ExcelJS.CellValue);
    if ('richText' in v) return v.richText.map((t) => t.text).join('');
    if ('text' in v) return String(v.text);
    if (v instanceof Date) return v.toISOString().slice(0, 10);
    return String(v);
  }
  return typeof v === 'string' ? v.trim() : v;
}

export async function templateBuffer(kind: ImportKind) {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet(IMPORT_DEFS[kind].title.slice(0, 31));
  ws.addRow(IMPORT_DEFS[kind].fields.map((f) => f.label + (f.required ? ' *' : '')));
  ws.getRow(1).font = { bold: true };
  ws.columns.forEach((c) => { c.width = 22; });
  return Buffer.from(await wb.xlsx.writeBuffer());
}

export async function parseWorkbook(kind: ImportKind, buf: Buffer) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buf as unknown as ArrayBuffer);
  const ws = wb.worksheets[0];
  if (!ws) throw new Error('The file has no worksheet');
  const defs = IMPORT_DEFS[kind].fields;
  // Header row = first row containing a required field label/alias.
  let headerRow = 0;
  const colMap = new Map<number, FieldDef>();
  for (let r = 1; r <= Math.min(ws.rowCount, 20) && !headerRow; r++) {
    const row = ws.getRow(r);
    const tmp = new Map<number, FieldDef>();
    row.eachCell((cell, col) => {
      const h = norm(cellText(cell.value)).replace(/\s*\*$/, '');
      const f = defs.find((d) => norm(d.label) === h || d.key.toLowerCase() === h.replace(/ /g, '') || d.aliases?.some((a) => norm(a) === h));
      if (f) tmp.set(col, f);
    });
    if (defs.filter((d) => d.required).every((d) => [...tmp.values()].includes(d))) { headerRow = r; tmp.forEach((v, k) => colMap.set(k, v)); }
  }
  if (!headerRow) throw new Error(`Could not find the header row. Required columns: ${defs.filter((d) => d.required).map((d) => d.label).join(', ')}. Download the template to see the expected layout.`);
  const unknownHeaders: string[] = [];
  ws.getRow(headerRow).eachCell((cell, col) => { if (!colMap.has(col) && cellText(cell.value)) unknownHeaders.push(String(cellText(cell.value))); });
  const rows: PreviewRow[] = [];
  for (let r = headerRow + 1; r <= ws.rowCount; r++) {
    const row = ws.getRow(r);
    const data: PreviewRow['data'] = {};
    let any = false;
    for (const [col, f] of colMap) {
      let v = cellText(row.getCell(col).value);
      if (v === '') v = null;
      if (v != null) any = true;
      if (v != null && f.type === 'number') v = typeof v === 'number' ? v : Number(String(v).replace(/,/g, ''));
      if (v != null && f.type === 'bool') v = ['yes', 'true', '1', 'y', 'x'].includes(String(v).toLowerCase());
      data[f.key] = v;
    }
    if (any) rows.push({ rowNo: r, data, status: 'NEW', action: 'CREATE', errors: [], warnings: [] });
  }
  return { rows, unknownHeaders };
}

async function findExisting(kind: ImportKind, d: PreviewRow['data']) {
  switch (kind) {
    case 'PARTS': return prisma.part.findUnique({ where: { partNumber: String(d.partNumber ?? '') } });
    case 'SUPPLIERS': return prisma.supplier.findFirst({ where: { OR: [{ name: { equals: String(d.name ?? ''), mode: 'insensitive' } }, ...(d.taxNumber ? [{ taxNumber: String(d.taxNumber) }] : [])] } });
    case 'CATEGORIES': return prisma.category.findUnique({ where: { name: String(d.name ?? '') } });
    case 'SUPPLIER_PRICES': {
      const sup = await findSupplier(String(d.supplier ?? ''));
      const part = await prisma.part.findUnique({ where: { partNumber: String(d.partNumber ?? '') } });
      if (!sup || !part) return null;
      return prisma.supplierPart.findUnique({ where: { supplierId_partId: { supplierId: sup.id, partId: part.id } } });
    }
    case 'STOCK': {
      const loc = await findLocation(String(d.warehouse ?? ''), String(d.location ?? ''));
      const part = await prisma.part.findUnique({ where: { partNumber: String(d.partNumber ?? '') } });
      if (!loc || !part) return null;
      return prisma.inventory.findUnique({ where: { partId_locationId: { partId: part.id, locationId: loc.id } } });
    }
  }
}

const findSupplier = (s: string) => prisma.supplier.findFirst({ where: { OR: [{ code: { equals: s, mode: 'insensitive' } }, { name: { equals: s, mode: 'insensitive' } }] } });
const findLocation = (w: string, l: string) => prisma.location.findFirst({ where: { code: { equals: l, mode: 'insensitive' }, warehouse: { code: { equals: w, mode: 'insensitive' } } } });

/** Validates rows and marks new / existing / duplicates. Keeps user-chosen actions where still valid. */
export async function validateRows(kind: ImportKind, rows: PreviewRow[]) {
  const defs = IMPORT_DEFS[kind].fields;
  const keyOf = (d: PreviewRow['data']) => {
    switch (kind) {
      case 'PARTS': return norm(d.partNumber);
      case 'SUPPLIERS': return norm(d.name);
      case 'CATEGORIES': return norm(d.name);
      case 'SUPPLIER_PRICES': return `${norm(d.supplier)}|${norm(d.partNumber)}`;
      case 'STOCK': return `${norm(d.partNumber)}|${norm(d.warehouse)}|${norm(d.location)}`;
    }
  };
  const seen = new Map<string, number>();
  for (const row of rows) {
    const d = row.data;
    row.errors = [];
    row.warnings = [];
    for (const f of defs) {
      if (f.required && (d[f.key] == null || d[f.key] === '')) row.errors.push(`${f.label} is required`);
      if (f.type === 'number' && d[f.key] != null && (typeof d[f.key] !== 'number' || Number.isNaN(d[f.key]) || (d[f.key] as number) < 0)) row.errors.push(`${f.label} must be a number ≥ 0`);
    }
    if (kind === 'SUPPLIERS' && d.email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(String(d.email))) row.errors.push('Email is not valid');
    if (d.currency && !/^[A-Za-z]{3}$/.test(String(d.currency))) row.errors.push('Currency must be a 3-letter code (e.g. SAR)');
    if (kind === 'SUPPLIER_PRICES' || kind === 'STOCK') {
      if (d.partNumber && !(await prisma.part.findUnique({ where: { partNumber: String(d.partNumber) } }))) row.errors.push(`Part ${d.partNumber} does not exist`);
    }
    if (kind === 'SUPPLIER_PRICES' && d.supplier && !(await findSupplier(String(d.supplier)))) row.errors.push(`Supplier "${d.supplier}" does not exist (import suppliers first)`);
    if (kind === 'STOCK' && d.warehouse && d.location && !(await findLocation(String(d.warehouse), String(d.location)))) row.errors.push(`Location ${d.warehouse}/${d.location} does not exist (create it in Inventory → Warehouses)`);
    if (kind === 'STOCK' && d.minStock != null && d.maxStock != null && Number(d.maxStock) < Number(d.minStock)) row.errors.push('Maximum stock is below minimum stock');
    if (kind === 'PARTS' && d.equipment && !(await prisma.equipment.findFirst({ where: { OR: [{ name: { equals: String(d.equipment), mode: 'insensitive' } }, { code: { equals: String(d.equipment), mode: 'insensitive' } }] } }))) row.warnings.push(`Equipment "${d.equipment}" not found; it will be ignored`);

    const k = keyOf(d);
    if (seen.has(k)) { row.status = 'DUPLICATE_IN_FILE'; row.errors.push(`Duplicate of row ${seen.get(k)} in this file`); }
    else seen.set(k, row.rowNo);
    if (row.status !== 'DUPLICATE_IN_FILE') {
      const ex = row.errors.length ? null : await findExisting(kind, d);
      row.existing = ex ? JSON.parse(JSON.stringify(ex)) : null;
      row.status = row.errors.length ? 'ERROR' : ex ? 'EXISTING' : 'NEW';
    } else row.status = 'DUPLICATE_IN_FILE';
    if (row.status === 'ERROR' || row.status === 'DUPLICATE_IN_FILE') row.action = 'SKIP';
    else if (row.status === 'NEW') row.action = row.userChoice && row.action === 'SKIP' ? 'SKIP' : 'CREATE';
    else if (!row.userChoice || !['SKIP', 'FILL_EMPTY', 'OVERWRITE'].includes(row.action)) row.action = 'SKIP'; // existing: never overwrite by default
  }
  return rows;
}

export function summarize(rows: PreviewRow[]) {
  const c = (f: (r: PreviewRow) => boolean) => rows.filter(f).length;
  return {
    total: rows.length, new: c((r) => r.status === 'NEW'), existing: c((r) => r.status === 'EXISTING'), errors: c((r) => r.status === 'ERROR'),
    duplicates: c((r) => r.status === 'DUPLICATE_IN_FILE'), warnings: c((r) => r.warnings.length > 0),
    toCreate: c((r) => r.action === 'CREATE'), toFill: c((r) => r.action === 'FILL_EMPTY'), toOverwrite: c((r) => r.action === 'OVERWRITE'), toSkip: c((r) => r.action === 'SKIP'),
  };
}

/** Only the fields to write for an existing record: FILL_EMPTY never replaces a non-empty value. */
function pick(data: Record<string, unknown>, existing: Record<string, unknown> | null | undefined, action: RowAction) {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(data)) {
    if (v == null || v === '') continue;
    if (action === 'FILL_EMPTY' && existing && existing[k] != null && existing[k] !== '') continue;
    out[k] = v;
  }
  return out;
}

export async function applyRows(req: Request, tx: Tx, kind: ImportKind, rows: PreviewRow[], batchId: number) {
  const touchedParts: number[] = [];
  let stockDoc: string | null = null;
  const results = { created: 0, updated: 0, skipped: 0 };
  for (const row of rows) {
    if (row.action === 'SKIP' || row.status === 'ERROR' || row.status === 'DUPLICATE_IN_FILE') { results.skipped++; continue; }
    const d = row.data as Record<string, unknown>;
    const ref = `import #${batchId} row ${row.rowNo}`;
    if (kind === 'CATEGORIES') {
      const parent = d.parent ? await tx.category.upsert({ where: { name: String(d.parent) }, update: {}, create: { name: String(d.parent) } }) : null;
      if (row.status === 'NEW') { await tx.category.create({ data: { name: String(d.name), parentId: parent?.id } }); results.created++; }
      else { const ex = await tx.category.findUniqueOrThrow({ where: { name: String(d.name) } }); if (parent && (row.action === 'OVERWRITE' || ex.parentId == null)) await tx.category.update({ where: { id: ex.id }, data: { parentId: parent.id } }); results.updated++; }
      continue;
    }
    if (kind === 'PARTS') {
      const cat = d.category ? await tx.category.upsert({ where: { name: String(d.category) }, update: {}, create: { name: String(d.category) } }) : null;
      const man = d.manufacturer ? await tx.manufacturer.upsert({ where: { name: String(d.manufacturer) }, update: {}, create: { name: String(d.manufacturer) } }) : null;
      const fields = {
        partNumber: String(d.partNumber), name: d.name as string, itemCode: d.itemCode as string, description: d.description as string,
        subcategory: d.subcategory as string, brand: d.brand as string, model: d.model as string, specification: d.specification as string,
        unit: (d.unit as string)?.toUpperCase(), standardPrice: d.standardPrice as number, currency: (d.currency as string)?.toUpperCase(), notes: d.notes as string,
        categoryId: cat?.id, manufacturerId: man?.id,
      };
      let partId: number;
      if (row.status === 'NEW') {
        const p = await tx.part.create({ data: { ...pick(fields, null, 'CREATE'), partNumber: fields.partNumber, name: fields.name, createdFrom: 'IMPORT', aliases: { create: [{ alias: fields.name, sourceRef: ref }] } } as Prisma.PartUncheckedCreateInput });
        partId = p.id; results.created++;
        await audit(req, { action: 'PART_CREATED', docType: 'PART', docId: p.id, docNumber: p.partNumber, newValue: fields, comment: ref }, tx);
      } else {
        const ex = await tx.part.findUniqueOrThrow({ where: { partNumber: fields.partNumber } });
        const upd = pick(fields, ex as unknown as Record<string, unknown>, row.action);
        delete upd.partNumber;
        if (Object.keys(upd).length) {
          await tx.part.update({ where: { id: ex.id }, data: upd });
          await audit(req, { action: 'PART_EDITED', docType: 'PART', docId: ex.id, docNumber: ex.partNumber, oldValue: Object.fromEntries(Object.keys(upd).map((k) => [k, (ex as unknown as Record<string, unknown>)[k]])), newValue: upd, comment: `${ref} (${row.action})` }, tx);
          results.updated++;
        } else results.skipped++;
        if (fields.name && fields.name !== ex.name) await tx.partAlias.upsert({ where: { partId_alias: { partId: ex.id, alias: fields.name } }, update: {}, create: { partId: ex.id, alias: fields.name, sourceRef: ref } });
        partId = ex.id;
      }
      if (d.equipment) {
        const eq = await tx.equipment.findFirst({ where: { OR: [{ name: { equals: String(d.equipment), mode: 'insensitive' } }, { code: { equals: String(d.equipment), mode: 'insensitive' } }] } });
        if (eq) {
          const asm = await tx.assembly.upsert({ where: { equipmentId_name: { equipmentId: eq.id, name: 'GENERAL' } }, update: {}, create: { equipmentId: eq.id, name: 'GENERAL', nameInferred: false } });
          const has = await tx.partUsage.findFirst({ where: { partId, assemblyId: asm.id } });
          if (!has) await tx.partUsage.create({ data: { partId, assemblyId: asm.id, nameInSource: String(d.name ?? ''), issues: [`imported:${ref}`] } });
        }
      }
      touchedParts.push(partId);
      continue;
    }
    if (kind === 'SUPPLIERS') {
      const fields = { ...d, currency: (d.currency as string | undefined)?.toUpperCase() } as Record<string, unknown>;
      if (row.status === 'NEW') {
        const code = await nextNumber(tx, 'SUP');
        const s = await tx.supplier.create({ data: { ...(pick(fields, null, 'CREATE') as object), name: String(d.name), code } as Prisma.SupplierUncheckedCreateInput });
        await audit(req, { action: 'SUPPLIER_CREATED', docType: 'SUPPLIER', docId: s.id, docNumber: code, newValue: fields, comment: ref }, tx);
        results.created++;
      } else {
        const ex = await tx.supplier.findUniqueOrThrow({ where: { id: (row.existing as { id: number }).id } });
        const upd = pick(fields, ex as unknown as Record<string, unknown>, row.action);
        if (Object.keys(upd).length) {
          await tx.supplier.update({ where: { id: ex.id }, data: upd });
          await audit(req, { action: 'SUPPLIER_EDITED', docType: 'SUPPLIER', docId: ex.id, docNumber: ex.code, oldValue: Object.fromEntries(Object.keys(upd).map((k) => [k, (ex as unknown as Record<string, unknown>)[k]])), newValue: upd, comment: `${ref} (${row.action})` }, tx);
          results.updated++;
        } else results.skipped++;
      }
      continue;
    }
    if (kind === 'SUPPLIER_PRICES') {
      const sup = (await tx.supplier.findFirst({ where: { OR: [{ code: { equals: String(d.supplier), mode: 'insensitive' } }, { name: { equals: String(d.supplier), mode: 'insensitive' } }] } }))!;
      const part = await tx.part.findUniqueOrThrow({ where: { partNumber: String(d.partNumber) } });
      const ex = await tx.supplierPart.findUnique({ where: { supplierId_partId: { supplierId: sup.id, partId: part.id } } });
      const fields = { supplierPartNumber: d.supplierPartNumber as string, price: d.price as number, currency: ((d.currency as string) ?? sup.currency).toUpperCase(), leadTimeDays: d.leadTimeDays as number, isPreferred: d.preferred as boolean };
      if (fields.isPreferred) await tx.supplierPart.updateMany({ where: { partId: part.id }, data: { isPreferred: false } });
      if (!ex) { await tx.supplierPart.create({ data: { supplierId: sup.id, partId: part.id, ...(pick(fields, null, 'CREATE') as object) } }); results.created++; }
      else {
        const upd = pick(fields, ex as unknown as Record<string, unknown>, row.action);
        if (Object.keys(upd).length) { await tx.supplierPart.update({ where: { id: ex.id }, data: upd }); results.updated++; } else results.skipped++;
      }
      await audit(req, { action: ex ? 'SUPPLIER_PRICE_CHANGED' : 'SUPPLIER_PART_ADDED', docType: 'PART', docId: part.id, docNumber: sup.code, oldValue: ex && { price: ex.price, supplierPartNumber: ex.supplierPartNumber }, newValue: fields, comment: ref }, tx);
      touchedParts.push(part.id);
      continue;
    }
    if (kind === 'STOCK') {
      const part = await tx.part.findUniqueOrThrow({ where: { partNumber: String(d.partNumber) } });
      const loc = (await tx.location.findFirst({ where: { code: { equals: String(d.location), mode: 'insensitive' }, warehouse: { code: { equals: String(d.warehouse), mode: 'insensitive' } } } }))!;
      const ex = await tx.inventory.findUnique({ where: { partId_locationId: { partId: part.id, locationId: loc.id } } });
      const levels = pick({ minStock: d.minStock, maxStock: d.maxStock, reorderLevel: d.reorderLevel }, ex as unknown as Record<string, unknown>, ex ? row.action : 'CREATE');
      if (Object.keys(levels).length) {
        await tx.inventory.upsert({ where: { partId_locationId: { partId: part.id, locationId: loc.id } }, update: levels, create: { partId: part.id, locationId: loc.id, ...levels } });
      }
      if (d.onHand != null) {
        const current = Number(ex?.onHand ?? 0);
        const target = Number(d.onHand);
        const allowed = !ex || current === 0 || row.action === 'OVERWRITE';
        if (allowed && target !== current) {
          stockDoc ??= await nextNumber(tx, 'ADJ');
          await postMovement(tx, { partId: part.id, locationId: loc.id, quantity: target - current, type: 'ADJUSTMENT', docNumber: stockDoc, userId: req.user!.id, unitCost: d.unitCost as number | undefined, reason: `Opening balance / stock import (${ref})` });
        }
      }
      ex ? results.updated++ : results.created++;
      continue;
    }
  }
  if (touchedParts.length) await refreshSearchText(tx, [...new Set(touchedParts)]);
  return { ...results, stockDocument: stockDoc };
}
