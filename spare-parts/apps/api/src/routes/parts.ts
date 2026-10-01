import { Router } from 'express';
import multer from 'multer';
import { z } from 'zod';
import { prisma, withTx } from '../lib/prisma.js';
import { requirePerm } from '../lib/auth.js';
import { audit, diff } from '../lib/audit.js';
import { badRequest, notFound } from '../lib/errors.js';
import { idParam, optStr, qBool, qInt, qStr } from '../lib/http.js';
import { storeImage } from '../lib/storage.js';
import { getSettings } from '../lib/settings.js';
import { listCompanies } from '../lib/companies.js';
import { copyEquipment } from '../services/equipment.js';
import { purchaseHistory, refreshSearchText, searchParts, stockOf, type PartFilters } from '../services/parts.js';
import { sendExport, sendPdf, fileName } from '../services/export.js';
import { cataloguePdf, partPdf } from '../pdf/documents.js';

const r = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 15 * 1024 * 1024, files: 10 } });

const filters = (q: Record<string, unknown>): PartFilters => ({
  q: qStr(q.q),
  categoryId: qInt(q.categoryId),
  manufacturerId: qInt(q.manufacturerId),
  supplierId: qInt(q.supplierId),
  equipmentId: qInt(q.equipmentId),
  assemblyId: qInt(q.assemblyId),
  locationId: qInt(q.locationId),
  stockStatus: qStr(q.stockStatus) as PartFilters['stockStatus'],
  priceMin: qInt(q.priceMin),
  priceMax: qInt(q.priceMax),
  critical: qBool(q.critical),
  page: qInt(q.page),
  pageSize: qInt(q.pageSize),
  sort: qStr(q.sort) as PartFilters['sort'],
});

r.get('/parts', requirePerm('parts.view'), async (req, res) => {
  res.json(await searchParts(filters(req.query)));
});

const PART_COLUMNS = [
  { key: 'partNumber', label: 'Part Number' }, { key: 'name', label: 'Part Name' }, { key: 'category', label: 'Category' },
  { key: 'manufacturer', label: 'Manufacturer' }, { key: 'equipment', label: 'Equipment' }, { key: 'unit', label: 'Unit' },
  { key: 'onHand', label: 'Stock', align: 'r' as const, format: 'qty' as const },
  { key: 'minStock', label: 'Min', align: 'r' as const, format: 'qty' as const },
  { key: 'stockStatus', label: 'Status' }, { key: 'supplierName', label: 'Supplier' },
  { key: 'price', label: 'Price', align: 'r' as const, format: 'num' as const }, { key: 'currency', label: 'Cur.' },
  { key: 'locations', label: 'Location' },
];

r.get('/parts/export', requirePerm('export.run'), async (req, res) => {
  const f = filters(req.query);
  const all = [];
  for (let page = 1; ; page++) {
    const chunk = await searchParts({ ...f, page, pageSize: 200 });
    all.push(...chunk.items);
    if (page * 200 >= chunk.total) break;
  }
  await sendExport(res, String(req.query.format ?? 'xlsx'), 'Parts', PART_COLUMNS, all);
});

r.get('/parts/catalogue.pdf', requirePerm('parts.view'), async (req, res) => {
  sendPdf(res, await cataloguePdf(filters(req.query)), fileName('Catalogue', 'pdf'));
});

r.get('/parts/:id', requirePerm('parts.view'), async (req, res) => {
  const id = idParam(req);
  const p = await prisma.part.findUnique({
    where: { id },
    include: {
      category: true, manufacturer: true, aliases: { orderBy: { id: 'asc' } },
      images: { orderBy: [{ isPrimary: 'desc' }, { sortOrder: 'asc' }, { id: 'asc' }] },
      usages: {
        orderBy: { id: 'asc' },
        include: {
          assembly: { include: { equipment: true, assemblyPart: { select: { id: true, partNumber: true } }, images: { orderBy: { sortOrder: 'asc' } } } },
          sourceRecord: { include: { sourceFile: { select: { fileName: true, sha256: true } } } },
        },
      },
      assembliesOf: { include: { equipment: true, usages: { include: { part: { select: { id: true, partNumber: true, name: true } } } } } },
      supplierParts: { include: { supplier: true }, orderBy: [{ isPreferred: 'desc' }, { price: 'asc' }] },
      inventory: { include: { location: { include: { warehouse: true } } } },
    },
  });
  if (!p) throw notFound('Part');
  const drawings = new Map<number, (typeof p.usages)[number]['assembly']['images'][number]>();
  for (const u of p.usages) for (const img of u.assembly.images) drawings.set(img.id, img);
  res.json({ ...p, drawings: [...drawings.values()], stock: await stockOf(id), purchase: await purchaseHistory(id) });
});

r.get('/parts/:id/history', requirePerm('parts.view'), async (req, res) => {
  const id = idParam(req);
  const [purchase, transactions, prLines, auditRows] = await Promise.all([
    purchaseHistory(id),
    prisma.inventoryTransaction.findMany({ where: { partId: id }, orderBy: { id: 'desc' }, take: 200, include: { location: { include: { warehouse: true } }, user: { select: { fullName: true } } } }),
    prisma.purchaseRequisitionItem.findMany({ where: { partId: id }, orderBy: { id: 'desc' }, take: 100, include: { pr: { select: { id: true, prNumber: true, status: true, requestDate: true } } } }),
    prisma.auditLog.findMany({ where: { docType: 'PART', docId: id }, orderBy: { id: 'desc' }, take: 100, include: { user: { select: { fullName: true } } } }),
  ]);
  res.json({ purchase, transactions, prLines, audit: auditRows.map((a) => ({ ...a, id: a.id.toString() })) });
});

r.get('/parts/:id/pdf', requirePerm('parts.view'), async (req, res) => {
  const id = idParam(req);
  const p = await prisma.part.findUnique({ where: { id }, select: { partNumber: true } });
  if (!p) throw notFound('Part');
  sendPdf(res, await partPdf(id), `${p.partNumber}.pdf`);
});

const partSchema = z.object({
  partNumber: z.string().trim().min(1).max(60),
  itemCode: optStr,
  name: z.string().trim().min(1).max(300),
  description: optStr,
  specification: optStr,
  categoryId: z.coerce.number().int().positive().nullish(),
  subcategory: optStr,
  manufacturerId: z.coerce.number().int().positive().nullish(),
  brand: optStr,
  model: optStr,
  unit: z.string().trim().min(1).max(20),
  standardPrice: z.coerce.number().min(0).nullish(),
  currency: z.string().trim().length(3).optional(),
  notes: optStr,
  isCritical: z.boolean().optional(),
  status: z.enum(['ACTIVE', 'INACTIVE']).optional(),
});

r.post('/parts', requirePerm('parts.edit'), async (req, res) => {
  const body = partSchema.parse(req.body);
  const part = await withTx(async (tx) => {
    const p = await tx.part.create({ data: { ...body, currency: body.currency ?? (await getSettings(tx)).currency, createdFrom: 'MANUAL', aliases: { create: [{ alias: body.name }] } } });
    await refreshSearchText(tx, [p.id]);
    await audit(req, { action: 'PART_CREATED', docType: 'PART', docId: p.id, docNumber: p.partNumber, newValue: body }, tx);
    return p;
  });
  res.status(201).json(part);
});

r.patch('/parts/:id', requirePerm('parts.edit'), async (req, res) => {
  const id = idParam(req);
  const body = partSchema.partial().extend({ reviewFlags: z.array(z.string()).optional() }).parse(req.body);
  const part = await withTx(async (tx) => {
    const before = await tx.part.findUnique({ where: { id } });
    if (!before) throw notFound('Part');
    const d = diff(before as unknown as Record<string, unknown>, body as Record<string, unknown>);
    if (!d.changed) return before;
    const p = await tx.part.update({ where: { id }, data: body });
    if (body.name && body.name !== before.name) {
      await tx.partAlias.upsert({ where: { partId_alias: { partId: id, alias: body.name } }, update: {}, create: { partId: id, alias: body.name } });
    }
    await refreshSearchText(tx, [id]);
    await audit(req, { action: 'PART_EDITED', docType: 'PART', docId: id, docNumber: before.partNumber, oldValue: d.oldValue, newValue: d.newValue }, tx);
    return p;
  });
  res.json(part);
});

// ─── Images ────────────────────────────────────────────────────────────────
r.post('/parts/:id/images', requirePerm('parts.images'), upload.array('files', 10), async (req, res) => {
  const id = idParam(req);
  const part = await prisma.part.findUnique({ where: { id }, include: { images: true } });
  if (!part) throw notFound('Part');
  const files = (req.files as Express.Multer.File[] | undefined) ?? [];
  if (!files.length) throw badRequest('Choose at least one image');
  const created: Awaited<ReturnType<typeof prisma.partImage.create>>[] = [];
  let order = part.images.length;
  for (const f of files) {
    const s = await storeImage(f.buffer, 'parts');
    const img = await prisma.partImage.create({
      data: {
        partId: id, kind: 'PHOTO', storageKey: s.key, thumbKey: s.thumbKey, mimeType: s.mime, width: s.width, height: s.height,
        bytes: s.bytes, sha256: s.sha256, caption: String(req.body.caption ?? '') || f.originalname, sortOrder: order++,
        isPrimary: part.images.filter((i) => i.kind === 'PHOTO').length === 0 && created.length === 0, uploadedBy: req.user!.id,
        sourceRef: `upload: ${f.originalname}`,
      },
    });
    created.push(img);
  }
  await audit(req, { action: 'PART_IMAGES_ADDED', docType: 'PART', docId: id, docNumber: part.partNumber, newValue: created.map((c) => ({ id: c.id, file: c.caption, sha256: c.sha256 })) });
  res.status(201).json(created);
});

r.patch('/images/:id', requirePerm('parts.images'), async (req, res) => {
  const id = idParam(req);
  const body = z.object({ isPrimary: z.boolean().optional(), caption: optStr, sortOrder: z.number().int().optional() }).parse(req.body);
  const img = await prisma.partImage.findUnique({ where: { id } });
  if (!img) throw notFound('Image');
  await withTx(async (tx) => {
    if (body.isPrimary && img.partId) await tx.partImage.updateMany({ where: { partId: img.partId }, data: { isPrimary: false } });
    await tx.partImage.update({ where: { id }, data: body });
    await audit(req, { action: 'PART_IMAGE_EDITED', docType: 'PART', docId: img.partId ?? undefined, oldValue: { isPrimary: img.isPrimary, caption: img.caption }, newValue: body }, tx);
  });
  res.json({ ok: true });
});

r.delete('/images/:id', requirePerm('parts.images'), async (req, res) => {
  const id = idParam(req);
  const img = await prisma.partImage.findUnique({ where: { id } });
  if (!img) throw notFound('Image');
  if (img.kind === 'DRAWING' && img.sourceRef && !img.sourceRef.startsWith('upload')) throw badRequest('Drawings imported from the original workbook cannot be deleted');
  await prisma.partImage.delete({ where: { id } });
  // The file itself is kept (content-addressed, may be shared and is part of backups).
  await audit(req, { action: 'PART_IMAGE_REMOVED', docType: 'PART', docId: img.partId ?? undefined, oldValue: { id, caption: img.caption, sha256: img.sha256, storageKey: img.storageKey } });
  res.json({ ok: true });
});

// Assembly drawings upload (e.g. additional drawings for a machine group)
r.post('/assemblies/:id/images', requirePerm('parts.images'), upload.array('files', 10), async (req, res) => {
  const id = idParam(req);
  const asm = await prisma.assembly.findUnique({ where: { id }, include: { images: true } });
  if (!asm) throw notFound('Assembly');
  const files = (req.files as Express.Multer.File[] | undefined) ?? [];
  if (!files.length) throw badRequest('Choose at least one image');
  let order = asm.images.length;
  for (const f of files) {
    const s = await storeImage(f.buffer, 'drawings');
    await prisma.partImage.create({ data: { assemblyId: id, kind: 'DRAWING', storageKey: s.key, thumbKey: s.thumbKey, mimeType: s.mime, width: s.width, height: s.height, bytes: s.bytes, sha256: s.sha256, caption: asm.name, sortOrder: order++, uploadedBy: req.user!.id, sourceRef: `upload: ${f.originalname}` } });
  }
  await audit(req, { action: 'ASSEMBLY_DRAWING_ADDED', docType: 'ASSEMBLY', docId: id, docNumber: asm.name, newValue: files.map((f) => f.originalname) });
  res.status(201).json({ ok: true });
});

// ─── Lookups / master data ─────────────────────────────────────────────────
r.get('/lookups', async (_req, res) => {
  const [categories, manufacturers, equipment, suppliers, warehouses, companies] = await Promise.all([
    prisma.category.findMany({ orderBy: { name: 'asc' }, include: { _count: { select: { parts: true } } } }),
    prisma.manufacturer.findMany({ orderBy: { name: 'asc' } }),
    prisma.equipment.findMany({ orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }], include: { manufacturer: { select: { id: true, name: true } }, assemblies: { orderBy: { sortOrder: 'asc' }, select: { id: true, name: true } } } }),
    prisma.supplier.findMany({ where: { status: 'ACTIVE' }, orderBy: { name: 'asc' }, select: { id: true, code: true, name: true, currency: true } }),
    prisma.warehouse.findMany({ orderBy: { code: 'asc' }, include: { locations: { orderBy: { code: 'asc' } } } }),
    listCompanies().then((cs) => cs.map((c) => ({ id: c.id, code: c.code, name: c.name, isMain: c.isMain }))),
  ]);
  res.json({ categories, manufacturers, equipment, suppliers, warehouses, companies });
});

r.get('/equipment/:id', requirePerm('parts.view'), async (req, res) => {
  const id = idParam(req);
  const e = await prisma.equipment.findUnique({
    where: { id },
    include: {
      manufacturer: true,
      assemblies: {
        orderBy: { sortOrder: 'asc' },
        include: {
          assemblyPart: { select: { id: true, partNumber: true, name: true } },
          images: { orderBy: { sortOrder: 'asc' } },
          usages: { orderBy: { sortOrder: 'asc' }, include: { part: { select: { id: true, partNumber: true, name: true, unit: true, isCritical: true, images: { where: { isPrimary: true }, take: 1, select: { thumbKey: true, storageKey: true } } } } } },
          infoLines: { orderBy: { sortOrder: 'asc' } },
        },
      },
    },
  });
  if (!e) throw notFound('Equipment');
  const copiedFrom = e.copiedFromId ? await prisma.equipment.findUnique({ where: { id: e.copiedFromId }, select: { id: true, name: true } }) : null;
  const copies = await prisma.equipment.findMany({ where: { copiedFromId: e.id }, select: { id: true, name: true } });
  res.json({ ...e, copiedFrom, copies });
});

const nameSchema = z.object({ name: z.string().trim().min(1).max(200) });
r.post('/categories', requirePerm('parts.edit'), async (req, res) => {
  const body = nameSchema.extend({ parentId: z.number().int().positive().nullish() }).parse(req.body);
  const c = await prisma.category.create({ data: body });
  await audit(req, { action: 'CATEGORY_CREATED', docType: 'CATEGORY', docId: c.id, docNumber: c.name });
  res.status(201).json(c);
});
r.patch('/categories/:id', requirePerm('parts.edit'), async (req, res) => {
  const id = idParam(req);
  const body = nameSchema.parse(req.body);
  const before = await prisma.category.findUniqueOrThrow({ where: { id } });
  const c = await prisma.category.update({ where: { id }, data: body });
  const partIds = (await prisma.part.findMany({ where: { categoryId: id }, select: { id: true } })).map((p) => p.id);
  await refreshSearchText(prisma, partIds);
  await audit(req, { action: 'CATEGORY_RENAMED', docType: 'CATEGORY', docId: id, oldValue: { name: before.name }, newValue: body });
  res.json(c);
});
r.post('/manufacturers', requirePerm('parts.edit'), async (req, res) => {
  const body = nameSchema.parse(req.body);
  const m = await prisma.manufacturer.create({ data: body });
  await audit(req, { action: 'MANUFACTURER_CREATED', docType: 'MANUFACTURER', docId: m.id, docNumber: m.name });
  res.status(201).json(m);
});
r.post('/equipment', requirePerm('parts.edit'), async (req, res) => {
  const body = z.object({ code: z.string().trim().min(1).max(50), name: z.string().trim().min(1), model: optStr, manufacturerId: z.number().int().positive().nullish(), serialNumber: optStr, location: optStr, notes: optStr }).parse(req.body);
  const e = await prisma.equipment.create({ data: body });
  await audit(req, { action: 'EQUIPMENT_CREATED', docType: 'EQUIPMENT', docId: e.id, docNumber: e.code, newValue: body });
  res.status(201).json(e);
});
r.patch('/equipment/:id', requirePerm('parts.edit'), async (req, res) => {
  const id = idParam(req);
  const body = z.object({ name: z.string().trim().min(1).optional(), model: optStr, manufacturerId: z.number().int().positive().nullish(), serialNumber: optStr, location: optStr, notes: optStr }).parse(req.body);
  const before = await prisma.equipment.findUniqueOrThrow({ where: { id } });
  const e = await prisma.equipment.update({ where: { id }, data: body });
  const d = diff(before as unknown as Record<string, unknown>, body as Record<string, unknown>);
  await audit(req, { action: 'EQUIPMENT_EDITED', docType: 'EQUIPMENT', docId: id, docNumber: before.code, oldValue: d.oldValue, newValue: d.newValue });
  res.json(e);
});

/** Another plant of the same model: copies the catalogue (sections, positions, info lines, drawings) to a new serial number. */
r.post('/equipment/:id/copy', requirePerm('parts.edit'), async (req, res) => {
  const id = idParam(req);
  const body = z.object({
    serialNumber: z.string().trim().min(1, 'Serial number is required').max(60),
    name: z.string().trim().min(1).max(200).optional(),
    location: optStr,
  }).parse(req.body);
  const src = await prisma.equipment.findUnique({
    where: { id },
    include: { assemblies: { orderBy: { sortOrder: 'asc' }, include: { usages: true, infoLines: true, images: true } } },
  });
  if (!src) throw notFound('Equipment');
  if (src.serialNumber && src.serialNumber === body.serialNumber) throw badRequest('This serial number belongs to the plant you are copying from');
  const base = src.serialNumber && src.code.endsWith(`-${src.serialNumber}`) ? src.code.slice(0, -(src.serialNumber.length + 1)) : src.code;
  const code = `${base}-${body.serialNumber}`.toUpperCase().replace(/[^A-Z0-9-]+/g, '-').slice(0, 50);
  if (await prisma.equipment.findFirst({ where: { OR: [{ code }, { serialNumber: body.serialNumber, manufacturerId: src.manufacturerId }] } })) {
    throw badRequest(`A plant with serial number ${body.serialNumber} already exists`);
  }
  const name = body.name ?? (src.serialNumber ? src.name.replace(src.serialNumber, body.serialNumber) : `${src.name} (S/N ${body.serialNumber})`);
  const e = await withTx(async (tx) => {
    const e = await copyEquipment(tx, src, { code, name, serialNumber: body.serialNumber, location: body.location, uploadedBy: req.user!.id });
    await audit(req, { action: 'EQUIPMENT_COPIED', docType: 'EQUIPMENT', docId: e.id, docNumber: e.code, newValue: { from: src.code, ...body, assemblies: src.assemblies.length } }, tx);
    return e;
  });
  const partIds = [...new Set(src.assemblies.flatMap((a) => a.usages.map((u) => u.partId)))];
  await refreshSearchText(prisma, partIds);
  res.status(201).json(e);
});

export default r;
