import { Router } from 'express';
import multer from 'multer';
import { z } from 'zod';
import { prisma, withTx } from '../lib/prisma.js';
import { requirePerm } from '../lib/auth.js';
import { idParam } from '../lib/http.js';
import { audit } from '../lib/audit.js';
import { HttpError, badRequest, notFound } from '../lib/errors.js';
import { sha256, storage } from '../lib/storage.js';
import { fileName } from '../services/export.js';
import {
  IMPORT_DEFS, applyRows, parseWorkbook, summarize, templateBuffer, validateRows, type ImportKind, type PreviewRow,
} from '../services/excelImport.js';
import { importSourceWorkbook } from '../import/source.js';

const r = Router();
r.use(requirePerm('import.run'));
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 40 * 1024 * 1024 } });
const kindSchema = z.enum(['PARTS', 'SUPPLIERS', 'SUPPLIER_PRICES', 'STOCK', 'CATEGORIES']);

r.get('/kinds', (_req, res) => res.json(Object.entries(IMPORT_DEFS).map(([kind, d]) => ({ kind, title: d.title, fields: d.fields }))));

r.get('/templates/:kind', async (req, res) => {
  const kind = kindSchema.parse(req.params.kind);
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="${fileName(`template_${kind.toLowerCase()}`, 'xlsx')}"`);
  res.send(await templateBuffer(kind));
});

r.get('/', async (_req, res) => {
  const rows = await prisma.importBatch.findMany({ orderBy: { id: 'desc' }, take: 100 });
  res.json(rows.map((b) => ({ ...b, summary: { ...(b.summary as object), rows: undefined } })));
});

// Original workbook (source of truth)
r.get('/source/status', async (_req, res) => {
  const files = await prisma.sourceFile.findMany({ include: { _count: { select: { records: true } } }, orderBy: { id: 'asc' } });
  res.json(files);
});
r.post('/source/run', requirePerm('backup.run'), async (req, res) => {
  res.json(await importSourceWorkbook(req));
});

// 1) Upload → validate → preview (nothing is written to master data)
r.post('/:kind', upload.single('file'), async (req, res) => {
  const kind = kindSchema.parse(req.params.kind);
  if (!req.file) throw badRequest('Choose an Excel file (.xlsx)');
  if (!/\.xlsx$/i.test(req.file.originalname)) throw badRequest('Only .xlsx files are supported');
  let parsed;
  try {
    parsed = await parseWorkbook(kind, req.file.buffer);
  } catch (e) {
    throw badRequest(e instanceof Error ? e.message : 'Could not read the file');
  }
  const rows = await validateRows(kind, parsed.rows);
  const hash = sha256(req.file.buffer);
  const key = `imports/${new Date().toISOString().slice(0, 10)}_${hash.slice(0, 12)}_${req.file.originalname.replace(/[^A-Za-z0-9_.-]+/g, '_')}`;
  await storage.put(key, req.file.buffer); // the uploaded file is kept unchanged
  const batch = await prisma.importBatch.create({
    data: { kind, fileName: req.file.originalname, sha256: hash, storedPath: key, status: 'PREVIEW', createdBy: req.user!.id, summary: { ...summarize(rows), unknownHeaders: parsed.unknownHeaders, rows } as object },
  });
  await audit(req, { action: 'IMPORT_PREVIEWED', docType: 'IMPORT', docId: batch.id, docNumber: req.file.originalname, newValue: summarize(rows) });
  res.status(201).json(batch);
});

async function loadBatch(id: number) {
  const b = await prisma.importBatch.findUnique({ where: { id } });
  if (!b) throw notFound('Import');
  return b;
}

r.get('/:id', async (req, res) => res.json(await loadBatch(idParam(req))));

// 2) Correct a row / choose what to do with it
r.patch('/:id/rows/:rowNo', async (req, res) => {
  const b = await loadBatch(idParam(req));
  if (b.status !== 'PREVIEW') throw new HttpError(409, 'This import is no longer editable');
  const rowNo = idParam(req, 'rowNo');
  const body = z.object({ data: z.record(z.string(), z.union([z.string(), z.number(), z.boolean(), z.null()])).optional(), action: z.enum(['CREATE', 'SKIP', 'FILL_EMPTY', 'OVERWRITE']).optional() }).parse(req.body);
  const summary = b.summary as unknown as { rows: PreviewRow[] };
  const row = summary.rows.find((x) => x.rowNo === rowNo);
  if (!row) throw notFound('Row');
  if (body.data) {
    const allowed = new Set(IMPORT_DEFS[b.kind as ImportKind].fields.map((f) => f.key));
    for (const [k, v] of Object.entries(body.data)) if (allowed.has(k)) row.data[k] = v;
  }
  if (body.action) {
    if (row.status === 'NEW' && !['CREATE', 'SKIP'].includes(body.action)) throw badRequest('New rows can be created or skipped');
    if (row.status === 'EXISTING' && body.action === 'CREATE') throw badRequest('This record already exists: choose skip, fill empty fields, or overwrite');
    row.action = body.action;
    row.userChoice = true;
  }
  const rows = await validateRows(b.kind as ImportKind, summary.rows);
  const updated = await prisma.importBatch.update({ where: { id: b.id }, data: { summary: { ...(b.summary as object), ...summarize(rows), rows } as object } });
  res.json(updated);
});

// 3) Confirm
r.post('/:id/commit', async (req, res) => {
  const id = idParam(req);
  const result = await withTx(async (tx) => {
    const b = await tx.importBatch.findUnique({ where: { id } });
    if (!b) throw notFound('Import');
    if (b.status !== 'PREVIEW') throw new HttpError(409, `This import is already ${b.status.toLowerCase()}`);
    const rows = (b.summary as unknown as { rows: PreviewRow[] }).rows;
    const out = await applyRows(req, tx, b.kind as ImportKind, rows, b.id);
    await tx.importBatch.update({ where: { id }, data: { status: 'COMMITTED', committedAt: new Date(), summary: { ...(b.summary as object), result: out } as object } });
    await audit(req, { action: 'IMPORT_COMMITTED', docType: 'IMPORT', docId: id, docNumber: b.fileName, newValue: { kind: b.kind, ...out } }, tx);
    return out;
  });
  res.json(result);
});

r.post('/:id/discard', async (req, res) => {
  const b = await loadBatch(idParam(req));
  if (b.status !== 'PREVIEW') throw new HttpError(409, 'Only previews can be discarded');
  await prisma.importBatch.update({ where: { id: b.id }, data: { status: 'DISCARDED' } });
  await audit(req, { action: 'IMPORT_DISCARDED', docType: 'IMPORT', docId: b.id, docNumber: b.fileName });
  res.json({ ok: true });
});

export default r;
