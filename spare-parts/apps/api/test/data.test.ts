/**
 * Import fidelity (the workbook is fully represented), Excel import wizard,
 * exports, backups and error handling.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import ExcelJS from 'exceljs';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { adminClient, makeUser, type Client } from './helpers.js';
import { prisma } from '../src/lib/prisma.js';
import { importSourceWorkbook } from '../src/import/source.js';
import { IMER_DIR, importImerCatalogue } from '../src/import/imer.js';
import { DT_DIR, importDtCatalogue } from '../src/import/dt.js';
import { importFleet } from '../src/import/fleet.js';
import { vehicleFit } from '../src/lib/vehicleFit.js';
import { env } from '../src/env.js';

let admin: Client;
beforeAll(async () => { admin = await adminClient(); });

const binary = (r: import('supertest').Test) => r.buffer(true).parse((res, cb) => { const c: Buffer[] = []; res.on('data', (d: Buffer) => c.push(d)); res.on('end', () => cb(null, Buffer.concat(c))); });

describe('Original workbook import', () => {
  it('keeps every row, code, name and quantity of the workbook', async () => {
    const rows = JSON.parse(fs.readFileSync(path.join(env.sourceDir, 'extracted/workbook/rows.json'), 'utf8')).rows;
    const wbSource = { sourceFile: { fileName: 'SPARE_PART_LIST.xlsx' } };
    expect(await prisma.sourceRecord.count({ where: wbSource })).toBe(rows.length);
    expect(await prisma.partUsage.count({ where: { sourceRecord: wbSource } })).toBe(rows.length);
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
    const stored = await prisma.partImage.findMany({ where: { kind: 'DRAWING', NOT: { sourceRef: { startsWith: 'IMER-' } } } });
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

describe('IMER catalogue import (CR_LIBANO_74_2010.pdf)', () => {
  const cat = JSON.parse(fs.readFileSync(path.join(env.sourceDir, 'extracted', IMER_DIR, 'catalogue.json'), 'utf8'));

  it('keeps every catalogue line with its page, position, code, wording and quantity', async () => {
    const pdf = { sourceFile: { fileName: 'CR_LIBANO_74_2010.pdf' } };
    expect(await prisma.sourceRecord.count({ where: pdf })).toBe(cat.lines.length);
    const eq = await prisma.equipment.findUniqueOrThrow({ where: { code: 'IMER-10090213' }, include: { manufacturer: true, assemblies: true } });
    expect(eq).toMatchObject({ serialNumber: '10090213', name: 'IMER LOGIK 2WXL 4/10 (S/N 10090213)' });
    expect(eq.manufacturer?.name).toBe('IMER (ORU)');
    expect(eq.assemblies.length).toBe(22);
    for (const l of cat.lines) {
      if (l.kind === 'PART') {
        const u = await prisma.partUsage.findFirstOrThrow({ where: { sourceRecord: { sourceRef: l.source_ref } }, include: { part: { include: { aliases: true } }, assembly: true } });
        expect(u.part.partNumber).toBe(l.code);
        expect(u.nameInSource).toBe(l.description);
        expect(u.part.aliases.map((a) => a.alias)).toContain(l.description);
        expect(u.position).toBe(l.position);
        expect(u.installedRaw).toBe(l.qty_raw || null);
        expect(u.assembly.name.startsWith(`${l.section} - `)).toBe(true);
      } else if (l.description !== '-') {
        const i = await prisma.assemblyInfoLine.findFirstOrThrow({ where: { sourceRecord: { sourceRef: l.source_ref } } });
        expect(i.description).toBe(l.description);
      } else {
        expect(await prisma.sourceRecord.count({ where: { sourceRef: l.source_ref } })).toBe(1); // kept verbatim, not shown
      }
    }
    // Spot checks against the printed book
    const scraper = await prisma.partUsage.findFirstOrThrow({ where: { part: { partNumber: 'L1001401' }, assembly: { equipmentId: eq.id } }, include: { assembly: true } });
    expect(scraper).toMatchObject({ position: '9/2', installedRaw: '7' });
    expect(scraper.assembly.name).toBe('4 - AGGREGATES CONVEYOR BELT');
    expect((await prisma.part.findUniqueOrThrow({ where: { partNumber: '86801000' } })).unit).toBe('M');
  });

  it('imports the other IMER books line by line (LIBANO 76, 77, 79), one plant per serial number', async () => {
    const books = fs.readdirSync(path.join(env.sourceDir, 'extracted')).filter((d) => d.startsWith('imer-') && d !== IMER_DIR);
    expect(books.sort()).toEqual(['imer-11010013', 'imer-11060151', 'imer-12010006']);
    for (const b of books) {
      const c = JSON.parse(fs.readFileSync(path.join(env.sourceDir, 'extracted', b, 'catalogue.json'), 'utf8'));
      const pdf = fs.readFileSync(path.join(env.sourceDir, c.meta.source_file));
      expect(crypto.createHash('sha256').update(pdf).digest('hex')).toBe(c.meta.sha256);
      const eq = await prisma.equipment.findUniqueOrThrow({ where: { code: c.meta.equipment_code }, include: { assemblies: true } });
      expect(eq).toMatchObject({ serialNumber: c.meta.serial_number, name: c.meta.equipment_name });
      expect(eq.assemblies.length).toBe(c.sections.length);
      expect(await prisma.sourceRecord.count({ where: { sourceFile: { sha256: c.meta.sha256 } } })).toBe(c.lines.length);
      for (const l of c.lines) {
        if (l.kind === 'PART') {
          const u = await prisma.partUsage.findFirstOrThrow({ where: { sourceRecord: { sourceRef: l.source_ref } }, include: { part: { include: { aliases: true } }, assembly: true } });
          expect(u.part.partNumber).toBe(l.code);
          expect(u.nameInSource).toBe(l.description);
          expect(u.part.aliases.map((a) => a.alias)).toContain(l.description);
          expect(u.position).toBe(l.position);
          expect(u.assembly.equipmentId).toBe(eq.id);
          expect(u.issues.includes('highlighted_in_book')).toBe(!!l.highlighted);
        } else if (l.description !== '-') {
          expect((await prisma.assemblyInfoLine.findFirstOrThrow({ where: { sourceRecord: { sourceRef: l.source_ref } } })).description).toBe(l.description);
        }
      }
      expect(await prisma.partImage.count({ where: { assembly: { equipmentId: eq.id } } })).toBe(c.drawings.length);
    }
    // parts shared between books are one part with several usages
    const vib = await prisma.part.findUniqueOrThrow({ where: { partNumber: '24703100' }, include: { usages: { include: { assembly: { include: { equipment: true } } } } } });
    expect(new Set(vib.usages.map((u) => u.assembly.equipment.code))).toEqual(new Set(['IMER-10090213', 'IMER-11010013', 'IMER-11060151', 'IMER-12010006']));
    // book 77 reuses the gearbox transcription only because its scanned pages are byte-identical to book 74's
    expect(await prisma.partUsage.count({ where: { assembly: { equipment: { code: 'IMER-11060151' } }, issues: { has: 'transcribed_from_scan' } } })).toBe(92);
    // book 79 is multilingual: Italian names are searchable aliases; yellow rows are marked
    const cell = await prisma.part.findUniqueOrThrow({ where: { partNumber: 'M2500468' }, include: { aliases: true } });
    expect(cell.aliases.map((a) => a.alias)).toContain('CELLA DI CARICO A TRAZIONE');
    expect((await admin.get('/api/parts?q=cella%20di%20carico&pageSize=5')).body.total).toBeGreaterThan(0);
  });

  it('flags the transcribed gearbox pages and the "#" recommended spares', async () => {
    const oring = await prisma.part.findUniqueOrThrow({ where: { partNumber: '715303245A' }, include: { usages: { where: { assembly: { equipment: { code: 'IMER-10090213' } } }, include: { assembly: true } } } });
    expect(oring.reviewFlags).toContain('TRANSCRIBED_FROM_SCAN');
    expect(oring.isCritical).toBe(true);
    expect(oring.usages.map((u) => u.assembly.name).sort()).toEqual(['22 - GEARBOX RIGHT SIDE', '23 - GEARBOX LEFT SIDE']);
    expect(oring.usages.every((u) => u.recommendedRaw === '#')).toBe(true);
    // right/left angle gearboxes differ only in the bevel gear
    expect((await prisma.partUsage.findFirstOrThrow({ where: { part: { partNumber: '6667505240' }, assembly: { equipment: { code: 'IMER-10090213' } } }, include: { assembly: true } })).assembly.name).toBe('22 - GEARBOX RIGHT SIDE');
    expect((await prisma.partUsage.findFirstOrThrow({ where: { part: { partNumber: '6667505230' }, assembly: { equipment: { code: 'IMER-10090213' } } }, include: { assembly: true } })).assembly.name).toBe('23 - GEARBOX LEFT SIDE');
  });

  it('shows lines without a code as info only, and stores 22 upright drawings', async () => {
    const kit = await prisma.assemblyInfoLine.findMany({ where: { assembly: { name: '8 - PNEUMATIC UNIT COMPONENTS', equipment: { code: 'IMER-10090213' } }, position: '3' } });
    expect(kit.map((k) => k.description)).toEqual(['Pipe fitting 1/2"', 'Rapid discharge valve 1/2"', 'Silencer 1/2"', 'Nipple 1/2"']);
    const drawings = await prisma.partImage.findMany({ where: { sourceRef: { startsWith: 'IMER-10090213' }, assembly: { equipment: { code: 'IMER-10090213' } } } });
    expect(drawings.length).toBe(22);
    for (const d of drawings) {
      const buf = fs.readFileSync(path.join(env.storageDir, d.storageKey));
      expect(crypto.createHash('sha256').update(buf).digest('hex')).toBe(d.sha256);
    }
    const r = await admin.get(`/api/equipment/${drawings[0].assemblyId && (await prisma.assembly.findUniqueOrThrow({ where: { id: drawings[0].assemblyId } })).equipmentId}`);
    expect(r.status).toBe(200);
    expect(r.body.assemblies.some((a: { infoLines: unknown[] }) => a.infoLines.length > 0)).toBe(true);
  });

  it('is idempotent, checks the PDF checksum and never modifies it', async () => {
    const f = path.join(env.sourceDir, 'original/imer/CR_LIBANO_74_2010.pdf');
    const before = crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex');
    expect(before).toBe(cat.meta.sha256);
    expect((await importImerCatalogue(null)).status).toBe('ALREADY_IMPORTED');
    expect(crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex')).toBe(before);
    expect(fs.readFileSync(path.join(env.sourceDir, 'original/SHA256SUMS'), 'utf8')).toContain(before);
  });

  it('copies the catalogue to another plant of the same model', async () => {
    const src = await prisma.equipment.findUniqueOrThrow({ where: { code: 'IMER-10090213' } });
    const viewer = await makeUser(admin, 'VIEWER');
    expect((await viewer.post(`/api/equipment/${src.id}/copy`, { serialNumber: 'T-778' })).status).toBe(403);
    expect((await admin.post(`/api/equipment/${src.id}/copy`, {})).status).toBe(400);
    expect((await admin.post(`/api/equipment/${src.id}/copy`, { serialNumber: '10090213' })).status).toBe(400);
    expect((await admin.post(`/api/equipment/${src.id}/copy`, { serialNumber: '12010006' })).status).toBe(400); // has its own book
    const r = await admin.post(`/api/equipment/${src.id}/copy`, { serialNumber: 'T-777', location: 'Test site' });
    expect(r.status).toBe(201);
    expect(r.body).toMatchObject({ code: 'IMER-T-777', name: 'IMER LOGIK 2WXL 4/10 (S/N T-777)', serialNumber: 'T-777', copiedFromId: src.id });
    const count = async (id: number) => ({
      usages: await prisma.partUsage.count({ where: { assembly: { equipmentId: id } } }),
      info: await prisma.assemblyInfoLine.count({ where: { assembly: { equipmentId: id } } }),
      images: await prisma.partImage.count({ where: { assembly: { equipmentId: id } } }),
    });
    expect(await count(r.body.id)).toEqual(await count(src.id));
    expect((await admin.post(`/api/equipment/${src.id}/copy`, { serialNumber: 'T-777' })).status).toBe(400);
    expect((await admin.get(`/api/parts?q=T-777&pageSize=5`)).body.total).toBeGreaterThan(0);
  });
});

describe('DT Spare Parts catalogue for MAN TGA/TGS/TGX, TGL/TGM (scanned, read with OCR)', () => {
  const cat = JSON.parse(fs.readFileSync(path.join(env.sourceDir, 'extracted', DT_DIR, 'catalogue.json'), 'utf8'));

  it('imports every catalogue item with its DT number, MAN numbers, section and provenance', async () => {
    const eq = await prisma.equipment.findUniqueOrThrow({ where: { code: 'DT-MAN-TG' }, include: { manufacturer: true } });
    expect(eq.manufacturer?.name).toBe('MAN');
    for (const src of cat.meta.sources) {
      const buf = fs.readFileSync(path.join(env.sourceDir, src.file));
      expect(crypto.createHash('sha256').update(buf).digest('hex')).toBe(src.sha256);
    }
    const items = cat.items.filter((i: { dt: string | null }) => i.dt);
    expect(await prisma.sourceRecord.count({ where: { sourceRef: { startsWith: 'DT-MAN ' } } })).toBe(items.length);
    for (const it of items) {
      const u = await prisma.partUsage.findFirstOrThrow({ where: { sourceRecord: { sourceRef: it.source_ref } }, include: { part: { include: { aliases: true } }, assembly: true } });
      expect(u.part.partNumber).toBe(it.dt);
      expect(u.assembly.equipmentId).toBe(eq.id);
      expect(u.assembly.name.startsWith(`${it.section} - `)).toBe(true);
      expect(u.part.reviewFlags).toContain('TEXT_FROM_OCR');
      for (const r of it.replaces) expect(u.part.aliases.map((a) => a.alias)).toContain(r.number);
    }
    // quality: nearly every DT number is confirmed by its QR code
    expect(cat.quality.dt_from_qr / cat.quality.items).toBeGreaterThan(0.95);
  });

  it('finds a DT part by its MAN number, with or without dots, and shows its photo', async () => {
    const it = cat.items.find((i: { dt: string; photo?: string; replaces: { maker: string }[] }) => i.dt && i.photo && i.replaces.some((r) => r.maker === 'MAN'));
    const man = it.replaces.find((r: { maker: string }) => r.maker === 'MAN').number;
    for (const q of [man, man.replace(/\./g, '')]) {
      const r = await admin.get(`/api/parts?q=${encodeURIComponent(q)}&pageSize=10`);
      expect(r.body.items.map((p: { partNumber: string }) => p.partNumber)).toContain(it.dt);
    }
    const part = await prisma.part.findUniqueOrThrow({ where: { partNumber: it.dt }, include: { images: true } });
    expect(part.images.some((i) => i.isPrimary && i.kind === 'PHOTO')).toBe(true);
    expect(part.notes).toContain('not for invoices');
  });

  it('is imported file by file and never twice', async () => {
    expect((await importDtCatalogue(null)).status).toBe('ALREADY_IMPORTED');
    expect(await prisma.sourceFile.count({ where: { storedPath: { startsWith: 'source-data/original/dt/' } } })).toBe(cat.meta.sources.length);
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
    const s = await upload('SUPPLIERS', [['Supplier Name', 'Email', 'Currency', 'Tax Number'], ['Import Supplier LLC', 'a@b.example', 'USD', '3100001']]);
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

describe('MAN trucks from the type plates', () => {
  it('each truck is a machine with its VIN, type and a copy of the DT catalogue; never duplicated', async () => {
    const dt = await prisma.equipment.findUniqueOrThrow({ where: { code: 'DT-MAN-TG' }, include: { assemblies: { include: { _count: { select: { usages: true } } } } } });
    const dtUsages = dt.assemblies.reduce((a, x) => a + x._count.usages, 0);
    const trucks = await prisma.equipment.findMany({ where: { copiedFromId: dt.id }, orderBy: { code: 'asc' }, include: { assemblies: { include: { _count: { select: { usages: true } } } } } });
    expect(trucks.map((t) => [t.code, t.serialNumber, t.model])).toEqual([
      ['MAN-39W0535', 'WMA39WZZ4CM599234', 'MAN TGS 41.400 8X4 BB-WW'],
      ['MAN-HW33059', 'WMAHW3ZZ79M540622', 'MAN TGA 41.360 8X4 BB-WW'],
    ]);
    for (const t of trucks) {
      expect(t.manufacturerId).toBe(dt.manufacturerId);
      expect(t.assemblies.length).toBe(dt.assemblies.length);
      expect(t.assemblies.reduce((a, x) => a + x._count.usages, 0)).toBe(dtUsages);
      expect(t.notes).toMatch(/model year (2012|2009)/);
      expect(t.notes).toMatch(/type-plate-WMA/);
    }
    // a truck can be found by its VIN in Machines and its parts carry the truck on a request
    const r = await admin.get(`/api/equipment/${trucks[0].id}`);
    expect(r.status).toBe(200);
    expect(r.body.serialNumber).toBe('WMA39WZZ4CM599234');
    expect((await importFleet(null)).status).toBe('ALREADY_IMPORTED');
    expect(await prisma.equipment.count({ where: { copiedFromId: dt.id } })).toBe(2);
  });
});

describe('Which catalogue parts fit which truck', () => {
  const tga = { vehicleSeries: 'TGA', typeCode: 'HW3', engine: null };
  const tgs = { vehicleSeries: 'TGS', typeCode: '39W', engine: null };
  it('reads the "Suitable for" text: series, MAN type codes, engines, universal', () => {
    expect(vehicleFit('TGA/TGS/TGX', tga).fit).toBe('FITS');
    expect(vehicleFit('TGA', tgs).fit).toBe('OTHER_MODEL');
    expect(vehicleFit('TGS/TGX', tga).fit).toBe('OTHER_MODEL');
    expect(vehicleFit('TGUTGM, TGA/TGS/TGX', tgs).fit).toBe('FITS'); // OCR "TGU" = "TGL/"
    expect(vehicleFit('TGA (H76)', tga).fit).toBe('OTHER_MODEL'); // only type code H76
    expect(vehicleFit('TGA (HW3)', tga).fit).toBe('FITS');
    expect(vehicleFit('TGA (H55), TGS (70S), TGX', tgs).fit).toBe('OTHER_MODEL');
    expect(vehicleFit('TGM (N48), TGA/TGS/TGX', tga).fit).toBe('FITS');
    expect(vehicleFit('TGL D 0834', tga).fit).toBe('OTHER_MODEL');
    expect(vehicleFit('Universal', tga).fit).toBe('FITS');
    expect(vehicleFit('', tga).fit).toBe('UNKNOWN');
    expect(vehicleFit('D 2866, D 2876', tga).fit).toBe('CHECK_ENGINE');
    expect(vehicleFit('D 2066/2676, D 2840/2866', { ...tga, engine: 'D 2066 LF' }).fit).toBe('FITS');
    expect(vehicleFit('D 2066/2676, D 2840/2866', { ...tga, engine: 'D2676' }).fit).toBe('FITS');
    expect(vehicleFit('D 2866, D 2876', { ...tga, engine: 'D 2066 LF' }).fit).toBe('OTHER_MODEL');
  });

  it('the truck pages mark every part; the catalogue page does not', async () => {
    const counts: Record<string, Record<string, number>> = {};
    for (const code of ['MAN-HW33059', 'MAN-39W0535']) {
      const t = await prisma.equipment.findUniqueOrThrow({ where: { code } });
      const r = await admin.get(`/api/equipment/${t.id}`);
      const usages = r.body.assemblies.flatMap((a: { usages: { fit: string; suitable: string | null }[] }) => a.usages);
      expect(usages.every((u: { fit: string }) => ['FITS', 'CHECK_ENGINE', 'OTHER_MODEL', 'UNKNOWN'].includes(u.fit))).toBe(true);
      expect(usages.filter((u: { suitable: string | null }) => u.suitable === null).length).toBe(0); // every line found its catalogue text
      counts[t.vehicleSeries!] = r.body.fitCount;
    }
    console.log('Fit per truck:', counts);
    expect(counts.TGA.FITS).toBeGreaterThan(1000);
    expect(counts.TGS.OTHER_MODEL).toBeGreaterThan(counts.TGA.OTHER_MODEL); // many parts are TGA-only
    const dt = await prisma.equipment.findUniqueOrThrow({ where: { code: 'DT-MAN-TG' } });
    expect((await admin.get(`/api/equipment/${dt.id}`)).body.fitCount).toBeUndefined();
    // the engine sorts the engine-specific parts
    const tgaTruck = await prisma.equipment.findUniqueOrThrow({ where: { code: 'MAN-HW33059' } });
    expect((await admin.patch(`/api/equipment/${tgaTruck.id}`, { engine: 'D 2066 LF' })).status).toBe(200);
    const after = (await admin.get(`/api/equipment/${tgaTruck.id}`)).body.fitCount;
    expect(after.CHECK_ENGINE).toBeUndefined();
    await admin.patch(`/api/equipment/${tgaTruck.id}`, { engine: null });
    expect((await admin.patch(`/api/equipment/${tgaTruck.id}`, { vehicleSeries: 'XYZ' })).status).toBe(400);
  });
});
