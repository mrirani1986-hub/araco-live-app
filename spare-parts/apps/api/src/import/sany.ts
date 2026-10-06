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
 * SANY parts books (source-data/original/sany, each split into files of 50 pages), read by tools/extract_sany_catalogue.py
 * from the PDF text layer: the mixer truck SYM1310T-412C8RS1T5 chassis and the SYG5371THB 470C-10 concrete pump truck.
 * Each book is one machine, imported in one transaction; a book already imported is skipped. Existing parts (e.g. the
 * same SANY part in both books) are linked, never changed.
 */
interface Item {
  source_ref: string; pdf_page: number; book_page: string; assembly: string; index: string; part_no: string;
  description: string; remark?: string | null; qty: string; see_page: string | null; see_assembly?: string | null; flags: string[];
}
interface Assembly {
  key: string; code: string; name: string; group: string; group_no: number; book_pages: string[]; pdf_pages: number[]; lines: number;
  drawings: { file: string; sha256: string; pdf_page: number; book_page: string; part: string | null }[];
}
interface Catalogue {
  meta: { title: string; brand: string; model: string; machine?: string; equipment_no: string; publisher: string; sources: { file: string; sha256: string; pages: number; first_page: number }[] };
  assemblies: Assembly[];
  items: Item[];
}

export const SANY_DIR = 'sany-22DP0131010170';
export const SANY_PUMP_DIR = 'sany-BC5371CC1593';

/** Every SANY book in source-data/extracted/sany-*, in name order. */
export async function importSanyCatalogues(req: Request | null) {
  const dirs = (await fs.readdir(path.join(env.sourceDir, 'extracted')).catch(() => [] as string[])).filter((d) => d.startsWith('sany-')).sort();
  const out: Record<string, SourceImportResult> = {};
  for (const d of dirs) out[d] = await importSanyCatalogue(req, d);
  return out;
}

export async function importSanyCatalogue(req: Request | null, dirName = SANY_DIR): Promise<SourceImportResult> {
  const dir = path.join(env.sourceDir, 'extracted', dirName);
  const cat = JSON.parse(await fs.readFile(path.join(dir, 'catalogue.json'), 'utf8').catch(() => 'null')) as Catalogue | null;
  if (!cat) return { status: 'ALREADY_IMPORTED', sourceSha256: '', counts: {} };
  for (const s of cat.meta.sources) {
    if (sha256(await fs.readFile(path.join(env.sourceDir, s.file))) !== s.sha256) throw new Error(`${s.file} differs from the one catalogue.json was extracted from. Re-run tools/extract_sany_catalogue.py`);
  }
  const shas = cat.meta.sources.map((s) => s.sha256);
  if (await prisma.sourceFile.findUnique({ where: { sha256: shas[0] } })) return { status: 'ALREADY_IMPORTED', sourceSha256: shas.join(','), counts: {} };

  // drawings first (content-addressed, so a retry after a failure is harmless)
  const stored = new Map<string, Awaited<ReturnType<typeof storeImage>>>();
  for (const a of cat.assemblies) for (const d of a.drawings) {
    const data = await fs.readFile(path.join(dir, d.file));
    if (sha256(data) !== d.sha256) throw new Error(`Drawing ${d.file} checksum mismatch`);
    stored.set(d.file, await storeImage(data, 'drawings'));
  }

  const m = cat.meta;
  const counts: Record<string, number> = {};
  const inc = (k: string, n = 1) => { counts[k] = (counts[k] ?? 0) + n; };
  const sectionName = (a: Assembly) => `${a.book_pages[0]} · ${a.code} ${a.name}`;

  await prisma.$transaction(async (tx) => {
    const files = new Map<string, number>();
    for (const s of m.sources) {
      const f = await tx.sourceFile.create({
        data: {
          fileName: path.basename(s.file), kind: 'PDF', sha256: s.sha256, storedPath: `source-data/${s.file}`, importedBy: req?.user?.id,
          properties: { catalogue: m.title, equipmentNo: m.equipment_no, publisher: m.publisher, pages: `${s.first_page}-${s.first_page + s.pages - 1}` },
        },
      });
      files.set(s.file, f.id);
      inc('sourceFiles');
    }
    const fileOf = (page: number) => m.sources.find((s) => page >= s.first_page && page < s.first_page + s.pages)!.file;

    const maker = await tx.manufacturer.upsert({ where: { name: m.brand }, update: {}, create: { name: m.brand } });
    const company = await tx.company.findFirst({ orderBy: { id: 'asc' } });
    const branch = company ? await tx.branch.findFirst({ where: { companyId: company.id } }) : null;
    const maxOrder = (await tx.equipment.aggregate({ _max: { sortOrder: true } }))._max.sortOrder ?? 0;
    const eq = await tx.equipment.create({
      data: {
        code: `SANY-${m.equipment_no}`, name: `SANY ${m.model} ${m.machine ?? 'mixer truck'} (Equipment No. ${m.equipment_no})`, model: m.model,
        manufacturerId: maker.id, serialNumber: m.equipment_no, sourceSheet: m.title, sortOrder: maxOrder + 1, branchId: branch?.id,
        notes: `${m.title} (${m.publisher}). Order by SANY part number and quote the Equipment No. ${m.equipment_no}. `
          + 'A line with "See" is a sub-assembly that has its own section.'
          + (cat.items.some((i) => i.flags.includes('VARIANT_OF_ROW_ABOVE')) ? ' Lines marked "alt." are another version of the position above (usually another paint colour, shown in the Remark).' : ''),
      },
    });
    inc('equipment');

    const assemblyIds = new Map<string, number>();
    for (const [i, a] of cat.assemblies.entries()) {
      const x = await tx.assembly.create({
        data: {
          equipmentId: eq.id, name: sectionName(a), sortOrder: i + 1,
          notes: [`Group ${a.group_no}: ${a.group}`, `Book pages ${a.book_pages[0]}–${a.book_pages[a.book_pages.length - 1]}`],
          sourceRef: `SANY p${a.pdf_pages[0]}-${a.pdf_pages[a.pdf_pages.length - 1]}`,
        },
      });
      assemblyIds.set(a.key, x.id);
      for (const [k, d] of a.drawings.entries()) {
        const s = stored.get(d.file)!;
        await tx.partImage.create({
          data: {
            assemblyId: x.id, kind: 'DRAWING', storageKey: s.key, thumbKey: s.thumbKey, mimeType: s.mime, width: s.width, height: s.height,
            bytes: s.bytes, sha256: s.sha256, caption: `${a.name}${d.part ? ` (${d.part})` : ''} — book page ${d.book_page}`, sortOrder: k,
            sourceRef: `SANY p${d.pdf_page} (book page ${d.book_page}), rendered at 150 dpi`,
          },
        });
        inc('drawings');
      }
      inc('assemblies');
    }
    const nameByKey = new Map(cat.assemblies.map((a) => [a.key, sectionName(a)]));

    // parts: one per SANY part number; every wording in the book kept as alias
    const byNo = new Map<string, Item[]>();
    for (const it of cat.items) byNo.set(it.part_no, [...(byNo.get(it.part_no) ?? []), it]);
    const catIds = new Map((await tx.category.findMany()).map((c) => [c.name, c.id]));
    const partIds = new Map<string, number>();
    for (const [no, its] of byNo) {
      const wordings = [...new Set(its.map((i) => i.description))];
      const found = await tx.part.findUnique({ where: { partNumber: no } });
      let id: number;
      if (found) {
        id = found.id;
        inc('existingPartsLinked');
      } else {
        const name = cleanName(wordings.slice().sort((a, b) => b.length - a.length)[0]).toUpperCase();
        const catName = suggestCategory(name);
        const p = await tx.part.create({
          data: {
            partNumber: no, name, unit: 'PCS', manufacturerId: maker.id, brand: m.brand, createdFrom: 'CATALOGUE',
            categoryId: catName ? catIds.get(catName) : null, reviewFlags: wordings.length > 1 ? ['NAME_VARIANTS_IN_SOURCE'] : [],
            notes: its.some((i) => i.see_page) ? `Assembly — its parts are listed in the SANY book on page ${its.find((i) => i.see_page)!.see_page}.` : null,
          },
        });
        id = p.id;
        inc('parts');
      }
      for (const w of wordings) await tx.partAlias.upsert({ where: { partId_alias: { partId: id, alias: w } }, update: {}, create: { partId: id, alias: w, sourceRef: its.find((i) => i.description === w)!.source_ref } });
      partIds.set(no, id);
    }

    for (const [i, it] of cat.items.entries()) {
      const rec = await tx.sourceRecord.create({ data: { sourceFileId: files.get(fileOf(it.pdf_page))!, sourceRef: it.source_ref, raw: it as unknown as Prisma.InputJsonValue } });
      inc('sourceRecords');
      const qty = /^\d+(\.\d+)?$/.test(it.qty) ? new Prisma.Decimal(it.qty) : null;
      const see = it.see_assembly ? nameByKey.get(it.see_assembly) : undefined;
      await tx.partUsage.create({
        data: {
          partId: partIds.get(it.part_no)!, assemblyId: assemblyIds.get(it.assembly)!, position: it.index || null,
          installedQty: qty, installedUnit: qty ? 'PCS' : null, installedRaw: it.qty || null, nameInSource: it.description,
          issues: [...(see ? [`see:${see}`] : []), ...(it.remark ? [`remark:${it.remark}`] : []), ...(it.flags.includes('VARIANT_OF_ROW_ABOVE') ? ['alternative_for_position'] : [])],
          sortOrder: i, sourceRecordId: rec.id,
        },
      });
      inc('usages');
    }
    // an assembly's own part number is linked to its section
    for (const a of cat.assemblies) {
      const pid = partIds.get(a.code);
      if (pid) await tx.assembly.update({ where: { id: assemblyIds.get(a.key)! }, data: { assemblyPartId: pid } });
    }

    await refreshSearchText(tx, [...partIds.values()]);
    await audit(req, { action: 'SOURCE_CATALOGUE_IMPORTED', docType: 'SOURCE', docNumber: m.title, newValue: { files: m.sources.map((s) => s.file), counts } }, tx);
  }, { timeout: 900_000, maxWait: 30_000 });

  return { status: 'IMPORTED', sourceSha256: shas.join(','), counts };
}
