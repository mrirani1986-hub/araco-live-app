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
 * DT Spare Parts online catalogues (FlippingBook, no PDF), read by tools/extract_dt_flipbook.py: the DT number of each
 * item from its link, the columns read from the page image and checked word by word against the book's exact text.
 * First book: "Catalogue suitable for Mercedes-Benz Actros, Antos, Arocs, Atron, Axor" (source-data/original/dt-actros).
 * Each book is one machine, imported once in one transaction; existing parts (e.g. a DT part also in the MAN
 * catalogue) are linked and get the new reference numbers as aliases, never changed otherwise.
 */
interface Ref { maker: string; number: string; suffix: string | null; in_text: boolean }
interface Item {
  source_ref: string; page: number; n: number; dt: string; section: string; en: string; de: string; suitable: string; details: string;
  replaces: Ref[]; replaces_notes: string[]; marks: string[]; new_item: boolean; photo?: string; flags: string[];
}
interface Catalogue {
  meta: { title: string; brand: string; vehicle_maker: string; prefix: string; url: string; note: string; publication_date?: string; sources: { file: string; sha256: string }[] };
  sections: { code: string | null; title: string; group: string; first_page: number; pages: number[] }[];
  items: Item[];
}

export const DT_ACTROS_DIR = 'dt-actros';
const BOOKS: Record<string, { code: string; name: string; model: string }> = {
  [DT_ACTROS_DIR]: { code: 'DT-MB-ACTROS', name: 'Mercedes-Benz Actros, Antos, Arocs, Atron, Axor (DT catalogue)', model: 'Mercedes-Benz Actros / Antos / Arocs / Atron / Axor' },
};

export async function importDtFlipbooks(req: Request | null) {
  const out: Record<string, SourceImportResult> = {};
  for (const d of Object.keys(BOOKS)) out[d] = await importDtFlipbook(req, d);
  return out;
}

/** "000 131 5519" -> also "0001315519" and "A0001315519" (how Mercedes-Benz numbers are often written). */
export function mercedesForms(n: string) {
  const plain = n.replace(/\s/g, '');
  return /^\d{10}$/.test(plain) ? [n, plain, `A${plain}`, `A ${n}`] : [n, plain];
}

export async function importDtFlipbook(req: Request | null, dirName = DT_ACTROS_DIR): Promise<SourceImportResult> {
  const book = BOOKS[dirName];
  const dir = path.join(env.sourceDir, 'extracted', dirName);
  const cat = JSON.parse(await fs.readFile(path.join(dir, 'catalogue.json'), 'utf8').catch(() => 'null')) as Catalogue | null;
  if (!cat || !book) return { status: 'ALREADY_IMPORTED', sourceSha256: '', counts: {} };
  for (const s of cat.meta.sources) {
    if (sha256(await fs.readFile(path.join(env.sourceDir, s.file))) !== s.sha256) throw new Error(`${s.file} differs from the one catalogue.json was extracted from. Re-run tools/extract_dt_flipbook.py`);
  }
  const shas = cat.meta.sources.map((s) => s.sha256);
  if (await prisma.sourceFile.findUnique({ where: { sha256: shas[0] } })) return { status: 'ALREADY_IMPORTED', sourceSha256: shas.join(','), counts: {} };

  const photos = new Map<string, Awaited<ReturnType<typeof storeImage>>>();
  for (const it of cat.items) {
    if (!it.photo || photos.has(it.photo)) continue;
    const data = await fs.readFile(path.join(dir, it.photo)).catch(() => null);
    if (data) photos.set(it.photo, await storeImage(data, 'parts'));
  }

  const m = cat.meta;
  const counts: Record<string, number> = {};
  const inc = (k: string, n = 1) => { counts[k] = (counts[k] ?? 0) + n; };

  await prisma.$transaction(async (tx) => {
    let pagesFile = 0;
    for (const s of m.sources) {
      const f = await tx.sourceFile.create({
        data: { fileName: path.basename(s.file), kind: 'ONLINE_CATALOGUE', sha256: s.sha256, storedPath: `source-data/${s.file}`, importedBy: req?.user?.id,
          properties: { catalogue: m.title, brand: m.brand, url: m.url, publicationDate: m.publication_date ?? null } },
      });
      if (s.file.endsWith('pages.json')) pagesFile = f.id;
      inc('sourceFiles');
    }
    const maker = await tx.manufacturer.upsert({ where: { name: m.brand }, update: {}, create: { name: m.brand } });
    const vehicleMaker = await tx.manufacturer.upsert({ where: { name: m.vehicle_maker }, update: {}, create: { name: m.vehicle_maker } });
    const maxOrder = (await tx.equipment.aggregate({ _max: { sortOrder: true } }))._max.sortOrder ?? 0;
    const eq = await tx.equipment.upsert({
      where: { code: book.code }, update: {},
      create: {
        code: book.code, name: book.name, model: book.model, manufacturerId: vehicleMaker.id, sourceSheet: m.title, sortOrder: maxOrder + 1,
        notes: `${m.brand} catalogue "${m.title}" (online edition, ${m.url}). Order by DT number. ${m.note} `
          + 'The columns were read from the page images and checked word by word against the catalogue\'s own text; flagged lines could not be fully confirmed.',
      },
    });
    inc('equipment');

    const assemblyIds = new Map<string, number>();
    for (const s of cat.sections) {
      const name = s.code ? `${s.code} - ${s.title}` : s.title;
      const key = s.code ? `${s.code} ${s.title}` : s.title;
      const a = await tx.assembly.upsert({
        where: { equipmentId_name: { equipmentId: eq.id, name } }, update: {},
        create: { equipmentId: eq.id, name, notes: [`Main group: ${s.group}`, `Catalogue pages ${s.pages[0]}–${s.pages[s.pages.length - 1]}`], sourceRef: `${m.prefix} p${s.pages[0]}-${s.pages[s.pages.length - 1]}`, sortOrder: s.first_page },
      });
      assemblyIds.set(key, a.id);
      inc('assemblies');
    }
    const catIds = new Map((await tx.category.findMany()).map((c) => [c.name, c.id]));

    const byDt = new Map<string, Item[]>();
    for (const it of cat.items) byDt.set(it.dt, [...(byDt.get(it.dt) ?? []), it]);
    const partIds = new Map<string, number>();
    for (const [dt, its] of byDt) {
      const first = its[0];
      const refs = its.flatMap((i) => i.replaces);
      const aliases = new Set<string>();
      for (const i of its) { if (i.en) aliases.add(i.en); if (i.de) aliases.add(i.de); }
      for (const r of refs) {
        aliases.add(`${r.maker} ${r.number}`);
        for (const f of r.maker === 'Mercedes-Benz' ? mercedesForms(r.number) : [r.number, r.number.replace(/[\s.]/g, '')]) aliases.add(f);
      }
      const found = await tx.part.findUnique({ where: { partNumber: dt } });
      let partId: number;
      if (found) {
        partId = found.id;
        inc('existingPartsLinked');
      } else {
        const name = cleanName(first.en || first.de || `DT ${dt}`);
        const catName = suggestCategory(name);
        const refText = [...new Set(refs.map((r) => `${r.maker} ${r.number}${r.suffix ? ` ${r.suffix}` : ''}`))];
        const suitable = [...new Set(its.map((i) => i.suitable).filter(Boolean))];
        const p = await tx.part.create({
          data: {
            partNumber: dt, name, manufacturerId: maker.id, brand: m.brand, unit: 'PCS', createdFrom: 'CATALOGUE',
            reviewFlags: [...new Set(its.flatMap((i) => i.flags))], categoryId: catName ? catIds.get(catName) : null,
            specification: first.details || null, description: suitable.length ? `Suitable for ${suitable.join(' | ')}` : null,
            notes: [refText.length ? `Replaces (for comparison only, not for invoices): ${refText.join('; ')}` : '',
              its.some((i) => i.marks.includes('S')) ? 'Special DT repair kit' : '',
              ...new Set(its.flatMap((i) => i.replaces_notes))].filter(Boolean).join('. ') || null,
          },
        });
        partId = p.id;
        inc('parts');
        const ph = its.map((i) => i.photo && photos.get(i.photo)).find(Boolean);
        if (ph) {
          const src = its.find((i) => i.photo && photos.get(i.photo) === ph)!;
          await tx.partImage.create({
            data: { partId, kind: 'PHOTO', storageKey: ph.key, thumbKey: ph.thumbKey, mimeType: ph.mime, width: ph.width, height: ph.height, bytes: ph.bytes,
              sha256: ph.sha256, caption: `${m.brand} catalogue photo`, isPrimary: true, sourceRef: `${src.source_ref} (photo cut from the page)` },
          });
          inc('photos');
        }
      }
      for (const a of aliases) {
        if (!a.trim()) continue;
        await tx.partAlias.upsert({ where: { partId_alias: { partId, alias: a } }, update: {}, create: { partId, alias: a, sourceRef: first.source_ref } });
      }
      partIds.set(dt, partId);
    }

    for (const it of cat.items) {
      const rec = await tx.sourceRecord.create({ data: { sourceFileId: pagesFile, sourceRef: it.source_ref, raw: it as unknown as Prisma.InputJsonValue } });
      inc('sourceRecords');
      await tx.partUsage.create({
        data: {
          partId: partIds.get(it.dt)!, assemblyId: assemblyIds.get(it.section)!, nameInSource: it.en || it.de || '', sortOrder: it.page * 100 + it.n, sourceRecordId: rec.id,
          issues: [...it.flags.map((f) => f.toLowerCase()), ...(it.suitable ? [`suitable:${it.suitable}`] : [])],
        },
      });
      inc('usages');
    }
    await refreshSearchText(tx, [...partIds.values()]);
    await audit(req, { action: 'SOURCE_CATALOGUE_IMPORTED', docType: 'SOURCE', docNumber: m.title, newValue: { files: m.sources.map((s) => s.file), counts } }, tx);
  }, { timeout: 1_800_000, maxWait: 30_000 });

  return { status: 'IMPORTED', sourceSha256: shas.join(','), counts };
}
