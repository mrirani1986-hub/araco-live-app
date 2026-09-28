/**
 * Import fidelity (the workbook is fully represented), Excel import wizard,
 * exports, backups and error handling.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import ExcelJS from 'exceljs';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { adminClient, type Client } from './helpers.js';
import { prisma } from '../src/lib/prisma.js';
import { importSourceWorkbook } from '../src/import/source.js';
import { env } from '../src/env.js';

let admin: Client;
beforeAll(async () => { admin = await adminClient(); });

const binary = (r: import('supertest').Test) => r.buffer(true).parse((res, cb) => { const c: Buffer[] = []; res.on('data', (d: Buffer) => c.push(d)); res.on('end', () => cb(null, Buffer.concat(c))); });

describe('Original workbook import', () => {
  it('keeps every row, code, name and quantity of the workbook', async () => {
    const rows = JSON.parse(fs.readFileSync(path.join(env.sourceDir, 'extracted/workbook/rows.json'), 'utf8')).rows;
    expect(await prisma.sourceRecord.count()).toBe(rows.length);
    expect(await prisma.partUsage.count({ where: { sourceRecordId: { not: null } } })).toBe(rows.length);
    const codes = new Set(rows.map((r: { code: string }) => r.code));
    expect(await prisma.part.count({ where: { partNumber: { in: [...codes] as string[] } } })).toBe(codes.size);
    for (const r of rows) {
      const u = await prisma.partUsage.findFirstOrThrow({ where: { sourceRecord: { sourceRef: r.source_ref } }, include: { part: { include: { aliases: true } } } });
      expect(u.part.partNumber).toBe(r.code);
      expect(u.nameInSource).toBe(r.part_name);
      expect(u.part.aliases.map((a) => a.alias)).toContain(r.part_name);
      expect(u.installedRaw).toBe(r.pieces_raw == null ? null : String(r.pieces_raw));
      expect(u.recommendedRaw).toBe(r.spare_raw == null ? null : String(r.spare_raw));
    }
  });

  it('extracted all 34 pictures unchanged and linked them to assemblies', async () => {
    const images = JSON.parse(fs.readFileSync(path.join(env.sourceDir, 'extracted/workbook/images.json'), 'utf8'));
    const stored = await prisma.partImage.findMany({ where: { kind: 'DRAWING' } });
    expect(stored.length).toBe(images.length);
    for (const s of stored) {
      const buf = fs.readFileSync(path.join(env.storageDir, s.originalKey ?? s.storageKey));
      expect(crypto.createHash('sha256').update(buf).digest('hex')).toBe(s.sha256);
      expect(s.assemblyId).not.toBeNull();
    }
    expect(new Set(stored.map((s) => s.sha256))).toEqual(new Set(images.map((i: { sha256: string }) => i.sha256)));
  });

  it('is idempotent and never modifies the original file', async () => {
    const wb = path.join(env.sourceDir, 'original/SPARE_PART_LIST.xlsx');
    const before = crypto.createHash('sha256').update(fs.readFileSync(wb)).digest('hex');
    const res = await importSourceWorkbook(null);
    expect(res.status).toBe('ALREADY_IMPORTED');
    expect(crypto.createHash('sha256').update(fs.readFileSync(wb)).digest('hex')).toBe(before);
    const sums = fs.readFileSync(path.join(env.sourceDir, 'original/SHA256SUMS'), 'utf8');
    expect(sums).toContain(before);
  });

  it('flags data-quality issues instead of hiding them', async () => {
    const pn = await prisma.part.findUniqueOrThrow({ where: { partNumber: 'E19846' } });
    expect(pn.reviewFlags).toContain('NAME_UNCLEAR');
    const valve = await prisma.part.findUniqueOrThrow({ where: { partNumber: 'E19778' }, include: { aliases: true } });
    expect(valve.name).toBe('PNEUMATIC VALVE');
    expect(valve.aliases.map((a) => a.alias).sort()).toEqual(['PENEUMATIC VALVE', 'PNEUMATIC VALVE']);
    expect((await prisma.part.findUniqueOrThrow({ where: { partNumber: 'E22667' } })).createdFrom).toBe('CAPTION');
  });
});

describe('Excel import wizard', () => {
  async function upload(kind: string, rows: (string | number | null)[][]) {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('Sheet1');
    for (const r of rows) ws.addRow(r);
    const buf = Buffer.from(await wb.xlsx.writeBuffer());
    return admin.agent.post(`/api/imports/${kind}`).set('x-requested-with', 'araco-sp').attach('file', buf, 'test.xlsx');
  }

  it('previews, detects duplicates/errors/existing, and never overwrites silently', async () => {
    const r = await upload('PARTS', [
      ['Part Number', 'Part Name', 'Specification', 'Price'],
      ['E22110', 'SHAFT CHANGED NAME', 'Ø80 x 1200', 999],   // existing
      ['NEW-001', 'Test new part', 'M12', 5],                   // new
      ['NEW-001', 'Duplicate row', null, 1],                    // duplicate in file
      [null, 'Missing number', null, null],                     // error
      ['NEW-002', 'Bad price', null, 'abc'],                    // error
    ]);
    expect(r.status).toBe(201);
    const s = r.body.summary;
    expect([s.new, s.existing, s.duplicates, s.errors]).toEqual([1, 1, 1, 2]);
    const existingRow = s.rows.find((x: { data: { partNumber: string } }) => x.data.partNumber === 'E22110');
    expect(existingRow.action).toBe('SKIP');
    // correct an error row in the preview
    const fixed = await admin.patch(`/api/imports/${r.body.id}/rows/6`, { data: { standardPrice: 7 } });
    expect(fixed.body.summary.new).toBe(2);
    // choose "fill empty fields only" for the existing part
    await admin.patch(`/api/imports/${r.body.id}/rows/2`, { action: 'FILL_EMPTY' });
    const commit = await admin.post(`/api/imports/${r.body.id}/commit`, {});
    expect(commit.status).toBe(200);
    expect(commit.body.created).toBe(2);
    const shaft = await prisma.part.findUniqueOrThrow({ where: { partNumber: 'E22110' } });
    expect(shaft.name).toBe('SHAFT'); // non-empty value NOT overwritten
    expect(shaft.specification).toBe('Ø80 x 1200'); // empty field filled
    expect((await admin.post(`/api/imports/${r.body.id}/commit`, {})).status).toBe(409);
  });

  it('imports suppliers, prices and opening stock via the ledger', async () => {
    const s = await upload('SUPPLIERS', [['Supplier Name', 'Email', 'Currency', 'Tax Number'], ['Import Supplier LLC', 'a@b.example', 'SAR', '3100001']]);
    await admin.post(`/api/imports/${s.body.id}/commit`, {});
    const p = await upload('SUPPLIER_PRICES', [['Supplier', 'Part Number', 'Price', 'Preferred'], ['Import Supplier LLC', 'E1003141', 77, 'yes']]);
    expect(p.body.summary.errors).toBe(0);
    await admin.post(`/api/imports/${p.body.id}/commit`, {});
    const st = await upload('STOCK', [['Part Number', 'Warehouse', 'Location', 'Quantity On Hand', 'Minimum Stock'], ['E1000150', 'MAIN', 'GENERAL', 6, 4], ['E1000150', 'MAIN', 'NOWHERE', 1, null]]);
    expect(st.body.summary.errors).toBe(1);
    const c = await admin.post(`/api/imports/${st.body.id}/commit`, {});
    expect(c.body.stockDocument).toMatch(/^ADJ-/);
    const part = await prisma.part.findUniqueOrThrow({ where: { partNumber: 'E1000150' }, include: { inventory: true } });
    expect(Number(part.inventory[0].onHand)).toBe(6);
    expect(await prisma.inventoryTransaction.count({ where: { partId: part.id, type: 'ADJUSTMENT' } })).toBe(1);
  });

  it('rejects files that are not Excel', async () => {
    const r = await admin.agent.post('/api/imports/PARTS').set('x-requested-with', 'araco-sp').attach('file', Buffer.from('hello'), 'x.csv');
    expect(r.status).toBe(400);
  });
});

describe('Exports', () => {
  for (const fmt of ['xlsx', 'csv', 'pdf']) {
    it(`exports parts to ${fmt}`, async () => {
      const r = await binary(admin.get(`/api/parts/export?format=${fmt}&q=bearing`));
      expect(r.status).toBe(200);
      expect((r.body as Buffer).length).toBeGreaterThan(200);
    });
  }
  it('exports inventory, suppliers, PRs, POs, audit and reports', async () => {
    for (const url of ['/api/inventory/export?format=xlsx', '/api/suppliers/export?format=csv', '/api/prs/export?format=xlsx', '/api/pos/export?format=pdf', '/api/audit/export?format=csv', '/api/reports/purchase-history?format=xlsx', '/api/reports/recommended-spares?format=pdf', '/api/grns/export?format=xlsx']) {
      const r = await binary(admin.get(url));
      expect(r.status, url).toBe(200);
    }
  });
  it('CSV export neutralises spreadsheet formulas', async () => {
    await admin.post('/api/suppliers', { name: '=HYPERLINK("http://evil")' });
    const r = await admin.get('/api/suppliers/export?format=csv');
    expect(r.text).toContain(`'=HYPERLINK`);
  });
});

describe('Search', () => {
  it('matches literally first and falls back to typo-tolerant search', async () => {
    const exact = (await admin.get('/api/parts?q=pneumatic&pageSize=5')).body;
    expect(exact.fuzzy).toBeUndefined();
    expect(exact.items[0].name).toMatch(/PNEUMATIC/);
    const typo = (await admin.get('/api/parts?q=pnuematic&pageSize=5')).body;
    expect(typo.fuzzy).toBe(true);
    expect(typo.total).toBeGreaterThan(0);
    // original misspelling from the workbook is still searchable
    expect((await admin.get('/api/parts?q=PENEUMATIC')).body.items.map((i: { partNumber: string }) => i.partNumber)).toContain('E19778');
  });
});

describe('Error handling', () => {
  it('returns clear validation errors', async () => {
    const r = await admin.post('/api/prs', { lines: [{ partId: 1, quantity: -5 }] });
    expect(r.status).toBe(400);
    expect(r.body.error).toBe('Validation failed');
    expect((await admin.get('/api/parts/999999')).status).toBe(404);
    expect((await admin.get('/api/parts/abc')).status).toBe(400);
    expect((await admin.get('/api/nope')).status).toBe(404);
  });
  it('rejects non-image uploads and path traversal', async () => {
    const r = await admin.agent.post('/api/parts/1/images').set('x-requested-with', 'araco-sp').attach('files', Buffer.from('not an image'), 'x.jpg');
    expect(r.status).toBe(400);
    expect((await admin.get('/api/files/images/../../package.json')).status).toBeGreaterThanOrEqual(400);
  });
  it('uploads a real picture (multiple per part) and makes a thumbnail', async () => {
    const sharp = (await import('sharp')).default;
    const png = await sharp({ create: { width: 64, height: 48, channels: 3, background: '#3366aa' } }).png().toBuffer();
    const webp = await sharp({ create: { width: 30, height: 30, channels: 3, background: '#aa3366' } }).webp().toBuffer();
    const r = await admin.agent.post('/api/parts/1/images').set('x-requested-with', 'araco-sp').attach('files', png, 'a.png').attach('files', webp, 'b.webp');
    expect(r.status).toBe(201);
    expect(r.body).toHaveLength(2);
    expect(r.body[0].isPrimary).toBe(true);
    const part = (await admin.get('/api/parts/1')).body;
    expect(part.images.length).toBe(2);
  });
});

describe('Backup and restore', () => {
  it('backs up, restores, and keeps a safety backup', async () => {
    const b = await admin.post('/api/backups', { label: 'test' });
    expect(b.status).toBe(201);
    const name = b.body.name as string;
    const extra = await admin.post('/api/parts', { partNumber: 'AFTER-BACKUP', name: 'Created after backup', unit: 'PCS' });
    expect(extra.status).toBe(201);
    expect((await admin.post(`/api/backups/${name}/restore`, { confirm: 'wrong' })).status).toBe(400);
    const r = await admin.post(`/api/backups/${name}/restore`, { confirm: name });
    expect(r.status).toBe(200);
    expect(await prisma.part.findUnique({ where: { partNumber: 'AFTER-BACKUP' } })).toBeNull();
    const list = (await admin.get('/api/backups')).body.map((x: { name: string }) => x.name);
    expect(list).toContain(r.body.safetyBackup);
    // the app keeps working after the restore
    expect((await admin.get('/api/parts?q=bearing')).status).toBe(200);
  });
});
