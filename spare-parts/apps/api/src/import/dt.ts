import fs from 'node:fs/promises';
import path from 'node:path';
import { Prisma } from '@prisma/client';
import type { Request } from 'express';
import { env } from '../env.js';
import { prisma } from '../lib/prisma.js';
import { sha256, storeImage } from '../lib/storage.js';
import { audit } from '../lib/audit.js';
import { refreshSearchText } from '../services/parts.js';
import { cleanName, suggestCategory, type SourceImportResult } from './source.js';

/**
 * DT Spare Parts catalogue "Spare parts suitable for MAN TGA/TGS/TGX, TGL/TGM"
 * (source-data/original/dt/*.pdf, the catalogue split into files of 50 pages; read with OCR by
 * tools/extract_dt_catalogue.py). Imported file by file: a file whose SHA-256 is already in source_files is skipped,
 * so later parts of the catalogue can be added at any time. Existing parts are linked, never changed.
 */
interface Ref { maker: string; number: string; suffix: string | null }
interface Item {
  source_ref: string; page: number; section: string | null; n: number; dt: string | null; dt_from_qr: boolean;
  en: string; de: string; suitable: string; details: string; replaces: Ref[]; replaces_notes: string[];
  photo?: string; flags: string[]; index_confirmed: string[];
}
interface Catalogue {
  meta: { title: string; brand: string; note: string; sources: { file: string; sha256: string; pages: number; first_page: number }[] };
  sections: { code: string | null; title: string; group?: string; pages: number[] }[];
  items: Item[];
}

export const DT_DIR = 'dt-man-tga';
const EQUIPMENT_CODE = 'DT-MAN-TG';

export async function importDtCatalogue(req: Request | null): Promise<SourceImportResult> {
  const dir = path.join(env.sourceDir, 'extracted', DT_DIR);
  const cat = JSON.parse(await fs.readFile(path.join(dir, 'catalogue.json'), 'utf8').catch(() => 'null')) as Catalogue | null;
  if (!cat) return { status: 'ALREADY_IMPORTED', sourceSha256: '', counts: {} };

  // which catalogue files are new?
  const pending: Catalogue['meta']['sources'] = [];
  for (const s of cat.meta.sources) {
    const sha = sha256(await fs.readFile(path.join(env.sourceDir, s.file)));
    if (sha !== s.sha256) throw new Error(`${s.file} differs from the one catalogue.json was extracted from. Re-run tools/extract_dt_catalogue.py`);
    // recorded in the same transaction as its items, so a recorded file is complete (front-matter files have no items)
    if (!(await prisma.sourceFile.findUnique({ where: { sha256: sha } }))) pending.push(s);
  }
  if (!pending.length) return { status: 'ALREADY_IMPORTED', sourceSha256: cat.meta.sources.map((s) => s.sha256).join(','), counts: {} };
  const fileOf = (page: number) => cat.meta.sources.find((s) => page >= s.first_page && page < s.first_page + s.pages)!;
  const items = cat.items.filter((i) => i.dt && pending.includes(fileOf(i.page)));
  const pendingPages = new Set(pending.flatMap((s) => Array.from({ length: s.pages }, (_, k) => s.first_page + k)));

  const photos = new Map<string, Awaited<ReturnType<typeof storeImage>>>();
  for (const it of items) {
    if (!it.photo || photos.has(it.photo)) continue;
    const data = await fs.readFile(path.join(dir, it.photo)).catch(() => null);
    if (data) photos.set(it.photo, await storeImage(data, 'parts'));
  }

  const counts: Record<string, number> = {};
  const inc = (k: string, n = 1) => { counts[k] = (counts[k] ?? 0) + n; };

  await prisma.$transaction(async (tx) => {
    const files = new Map<string, number>();
    for (const s of pending) {
      const f = await tx.sourceFile.upsert({
        where: { sha256: s.sha256 }, update: {},
        create: {
          fileName: path.basename(s.file), kind: 'PDF', sha256: s.sha256, storedPath: `source-data/${s.file}`, importedBy: req?.user?.id,
          properties: { catalogue: cat.meta.title, brand: cat.meta.brand, pages: `${s.first_page}-${s.first_page + s.pages - 1}`, read: 'OCR' },
        },
      });
      files.set(s.file, f.id);
      inc('sourceFiles');
    }
    const maker = await tx.manufacturer.upsert({ where: { name: cat.meta.brand }, update: {}, create: { name: cat.meta.brand } });
    const man = await tx.manufacturer.upsert({ where: { name: 'MAN' }, update: {}, create: { name: 'MAN' } });
    const maxOrder = (await tx.equipment.aggregate({ _max: { sortOrder: true } }))._max.sortOrder ?? 0;
    const eq = await tx.equipment.upsert({
      where: { code: EQUIPMENT_CODE }, update: {},
      create: {
        code: EQUIPMENT_CODE, name: 'MAN TGA/TGS/TGX, TGL/TGM (DT catalogue)', model: 'MAN TGA/TGS/TGX, TGL/TGM', manufacturerId: man.id,
        sourceSheet: cat.meta.title, sortOrder: maxOrder + 1,
        notes: `${cat.meta.brand} catalogue "${cat.meta.title}". Order by DT number. ${cat.meta.note} The pages are scanned pictures read with OCR: check descriptions and MAN numbers against the catalogue page before ordering.`,
      },
    });
    inc('equipment');

    const assemblyIds = new Map<string, number>();
    for (const s of cat.sections) {
      if (!s.code || !s.pages.some((p) => pendingPages.has(p))) continue;
      const name = `${s.code} - ${s.title}`;
      const a = await tx.assembly.upsert({
        where: { equipmentId_name: { equipmentId: eq.id, name } }, update: {},
        create: { equipmentId: eq.id, name, notes: s.group ? [`Main group: ${s.group}`] : [], sourceRef: `DT-MAN p${s.pages[0]}-${s.pages[s.pages.length - 1]}`, sortOrder: parseInt(s.code, 10) * 10 + (s.code.charCodeAt(4) - 64) },
      });
      assemblyIds.set(s.code, a.id);
      inc('assemblies');
    }
    const catIds = new Map((await tx.category.findMany()).map((c) => [c.name, c.id]));

    const byDt = new Map<string, Item[]>();
    for (const it of items) byDt.set(it.dt!, [...(byDt.get(it.dt!) ?? []), it]);
    const partIds = new Map<string, number>();
    for (const [dt, its] of byDt) {
      const first = its[0];
      const refs = its.flatMap((i) => i.replaces);
      const aliases = new Set<string>();
      for (const i of its) { if (i.en) aliases.add(i.en); if (i.de) aliases.add(i.de); }
      for (const r of refs) {
        aliases.add(`${r.maker} ${r.number}`);
        aliases.add(r.number);
        if (r.maker === 'MAN') aliases.add(r.number.replace(/\./g, '')); // "51025006023" finds 51.02500.6023
      }
      const found = await tx.part.findUnique({ where: { partNumber: dt } });
      let partId: number;
      if (found) {
        partId = found.id;
        inc('existingPartsLinked');
      } else {
        const name = cleanName(first.en || first.de || `DT ${dt}`);
        const flags = ['TEXT_FROM_OCR', ...new Set(its.flatMap((i) => i.flags))];
        const catName = suggestCategory(name);
        const refText = refs.map((r) => `${r.maker} ${r.number}${r.suffix ? ` ${r.suffix}` : ''}`);
        const p = await tx.part.create({
          data: {
            partNumber: dt, name, manufacturerId: maker.id, brand: cat.meta.brand, unit: 'PCS', createdFrom: 'CATALOGUE', reviewFlags: flags,
            categoryId: catName ? catIds.get(catName) : null, specification: first.details || null,
            description: first.suitable ? `Suitable for ${first.suitable}` : null,
            notes: [refText.length ? `Replaces (for comparison only, not for invoices): ${[...new Set(refText)].join('; ')}` : '',
              ...new Set(its.flatMap((i) => i.replaces_notes))].filter(Boolean).join('. ') || null,
          },
        });
        partId = p.id;
        inc('parts');
      }
      for (const a of aliases) {
        if (!a.trim()) continue;
        await tx.partAlias.upsert({ where: { partId_alias: { partId, alias: a } }, update: {}, create: { partId, alias: a, sourceRef: first.source_ref } });
      }
      const ph = first.photo ? photos.get(first.photo) : undefined;
      if (ph && !found) {
        await tx.partImage.create({
          data: { partId, kind: 'PHOTO', storageKey: ph.key, thumbKey: ph.thumbKey, mimeType: ph.mime, width: ph.width, height: ph.height, bytes: ph.bytes,
            sha256: ph.sha256, caption: `${cat.meta.brand} catalogue photo`, isPrimary: true, sourceRef: `${first.source_ref} (photo cut from the page)` },
        });
        inc('photos');
      }
      partIds.set(dt, partId);
    }

    for (const it of items) {
      const assemblyId = it.section ? assemblyIds.get(it.section) : undefined;
      const rec = await tx.sourceRecord.create({
        data: { sourceFileId: files.get(fileOf(it.page).file)!, sourceRef: it.source_ref, raw: it as unknown as Prisma.InputJsonValue },
      });
      inc('sourceRecords');
      if (!assemblyId) continue;
      await tx.partUsage.create({
        data: {
          partId: partIds.get(it.dt!)!, assemblyId, nameInSource: it.en || it.de || '', sortOrder: it.page * 100 + it.n, sourceRecordId: rec.id,
          issues: ['text_from_ocr', ...it.flags.map((f) => f.toLowerCase())],
        },
      });
      inc('usages');
    }
    await refreshSearchText(tx, [...partIds.values()]);
    await audit(req, { action: 'SOURCE_CATALOGUE_IMPORTED', docType: 'SOURCE', docNumber: `${cat.meta.brand} MAN TG`, newValue: { files: pending.map((s) => s.file), counts } }, tx);
  }, { timeout: 900_000, maxWait: 30_000 });

  return { status: 'IMPORTED', sourceSha256: pending.map((s) => s.sha256).join(','), counts };
}
