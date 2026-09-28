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
 * IMER / ORU spare-parts book for the LOGIK 2WXL 4/10 batching plant, serial number 10090213
 * (source-data/original/imer/CR_LIBANO_74_2010.pdf, extracted by tools/extract_imer_catalogue.py).
 * Idempotent: keyed on the PDF's SHA-256. Existing parts with the same code are reused, never changed.
 */
interface Line {
  source_ref: string; page: number; section: number; kind: 'PART' | 'INFO'; role: 'MAIN' | 'VARIANT' | 'COMPONENT';
  position_raw: string; position: string | null; parent_position: string | null; code: string | null; description: string;
  qty_raw: string; qty: number | null; unit: string; heading: string | null; transcribed: boolean;
  recommended_for_stock?: boolean; note?: string; marker?: string; raw: unknown;
}
interface Section {
  no: number; title: string; pages: number[]; table_page: number; group: string | null;
  notes: { source_ref: string; text: string; display?: boolean }[];
  gearbox_list?: { spare_part_list: string; list_suffix: string; product_type: string; revision: string; date: string };
}
interface Drawing { section: number; page: number; file: string; sha256: string; width: number; height: number; rotated_deg: number; source_ref: string }
interface Catalogue {
  meta: { source_file: string; sha256: string; manufacturer: string; plant_model: string; mixer_model: string; serial_number: string;
    equipment_name: string; equipment_code: string; ordering_rule: string; publisher: string; plant_type: string; revision: string };
  sections: Section[]; lines: Line[]; drawings: Drawing[];
}

export const IMER_DIR = 'imer-10090213';

// Extra suggestions for wording used in the IMER book (tried when the shared rules find nothing). Admins can change them.
const EXTRA_CATEGORY_RULES: [RegExp, string][] = [
  [/O-RING|NILOS RING|ELASTOMER/, 'Seals & O-Rings'],
  [/Y SUPPORT|SUPPORT (Y|TYPE)/, 'Bearings & Housings'],
  [/SCREW|KEY |TIE-ROD|TIE ROAD|CENTERING RING|CLEANING RING|FORK/, 'Fasteners & Small Parts'],
  [/HUB|TOOTH RING|REDUCTION (ASSEMBLY|STAGE)|FLYWHEEL|OLEODINAMIC JOINT|JOINT TIPO|OUTPUT ASSEMBLY/, 'Motors, Gearboxes & Drives'],
  [/CYLINDER|REGULATOR|SILENCER|NOZZLE|FLUIDIFICATION|PRESSURE GAUGE|MANUAL COMAND|HAND CONTROL/, 'Pneumatics & Compressed Air'],
  [/HYDRO PROBE|TYMER|PULL-CORD|VIBRATING|COPPER PLAIT/, 'Electrical, Sensors & Weighing'],
  [/BLADE|PLATE|SAC FOR AIRBAG/, 'Wear Parts'],
  [/CARTER|PROTECTION|DOOR|HOPPER|CASING|TAIL|ENCLOSURE|CONVEYOR|SCHAFT|LEVER/, 'Structural, Covers & Housings'],
];
const categoryFor = (name: string) => suggestCategory(name) ?? EXTRA_CATEGORY_RULES.find(([re]) => re.test(name))?.[1] ?? null;

export async function importImerCatalogue(req: Request | null): Promise<SourceImportResult> {
  const dir = path.join(env.sourceDir, 'extracted', IMER_DIR);
  const cat = JSON.parse(await fs.readFile(path.join(dir, 'catalogue.json'), 'utf8')) as Catalogue;
  const pdfPath = path.join(env.sourceDir, cat.meta.source_file);
  const pdfSha = sha256(await fs.readFile(pdfPath));
  if (pdfSha !== cat.meta.sha256) throw new Error('catalogue.json was extracted from a different PDF. Re-run tools/extract_imer_catalogue.py');

  const existing = await prisma.sourceFile.findUnique({ where: { sha256: pdfSha }, include: { _count: { select: { records: true } } } });
  if (existing && existing._count.records > 0) return { status: 'ALREADY_IMPORTED', sourceSha256: pdfSha, counts: { sourceRecords: existing._count.records } };

  // Drawings are stored first (content-addressed, so a retry after a failure is harmless).
  const stored = new Map<string, Awaited<ReturnType<typeof storeImage>>>();
  for (const d of cat.drawings) {
    const data = await fs.readFile(path.join(dir, d.file));
    if (sha256(data) !== d.sha256) throw new Error(`Drawing ${d.file} checksum mismatch`);
    stored.set(d.file, await storeImage(data, 'drawings'));
  }

  const counts: Record<string, number> = {};
  const inc = (k: string, n = 1) => { counts[k] = (counts[k] ?? 0) + n; };
  const m = cat.meta;

  await prisma.$transaction(async (tx) => {
    const sourceFile = await tx.sourceFile.upsert({
      where: { sha256: pdfSha }, update: {},
      create: {
        fileName: path.basename(m.source_file), kind: 'PDF', sha256: pdfSha, storedPath: `source-data/${m.source_file}`, importedBy: req?.user?.id,
        properties: { catalogue: `${m.plant_type} ${m.plant_model} / ${m.mixer_model}`, serialNumber: m.serial_number, publisher: m.publisher, revision: m.revision },
      },
    });
    const maker = await tx.manufacturer.upsert({ where: { name: m.manufacturer }, update: {}, create: { name: m.manufacturer } });
    const company = await tx.company.findFirst();
    const branch = company ? await tx.branch.findFirst({ where: { companyId: company.id } }) : null;
    const maxOrder = (await tx.equipment.aggregate({ _max: { sortOrder: true } }))._max.sortOrder ?? 0;
    const eq = await tx.equipment.upsert({
      where: { code: m.equipment_code }, update: {},
      create: {
        code: m.equipment_code, name: m.equipment_name, model: `${m.plant_model} · mixer ${m.mixer_model}`, manufacturerId: maker.id,
        serialNumber: m.serial_number, notes: m.ordering_rule, sourceSheet: path.basename(m.source_file), sortOrder: maxOrder + 1, branchId: branch?.id,
      },
    });
    inc('equipment');

    const catIds = new Map((await tx.category.findMany()).map((c) => [c.name, c.id]));
    const assemblyIds = new Map<number, number>();
    for (const s of cat.sections) {
      const notes = [
        ...(s.group ? [`Part of the ${s.group}.`] : []),
        ...(s.gearbox_list ? [`Gearbox spare part list ${s.gearbox_list.spare_part_list} ${s.gearbox_list.list_suffix}, ${s.gearbox_list.product_type}, rev. ${s.gearbox_list.revision}, ${s.gearbox_list.date}. Transcribed from a scanned page — check codes against the drawing before ordering.`] : []),
        ...s.notes.filter((n) => n.display).map((n) => n.text),
      ];
      const a = await tx.assembly.upsert({
        where: { equipmentId_name: { equipmentId: eq.id, name: `${s.no} - ${s.title}` } }, update: {},
        create: { equipmentId: eq.id, name: `${s.no} - ${s.title}`, sourceRef: `IMER-${m.serial_number} p${s.pages.join(', p')}`, notes, sortOrder: s.no },
      });
      assemblyIds.set(s.no, a.id);
      inc('assemblies');
    }

    // Parts: one per code. Display name = longest wording (upper case, like the rest of the catalogue); every wording kept as alias.
    const byCode = new Map<string, Line[]>();
    for (const l of cat.lines) if (l.kind === 'PART' && l.code) byCode.set(l.code, [...(byCode.get(l.code) ?? []), l]);
    const partIds = new Map<string, number>();
    for (const [code, ls] of byCode) {
      const names = [...new Set(ls.map((l) => l.description))];
      const found = await tx.part.findUnique({ where: { partNumber: code } });
      if (found) {
        // Never overwrite an existing part: only link it and keep the catalogue wording as aliases.
        for (const n of names) await tx.partAlias.upsert({ where: { partId_alias: { partId: found.id, alias: n } }, update: {}, create: { partId: found.id, alias: n, sourceRef: ls.find((l) => l.description === n)!.source_ref } });
        partIds.set(code, found.id);
        inc('existingPartsLinked');
        continue;
      }
      const display = names.map((n) => cleanName(n)).sort((a, b) => b.length - a.length)[0];
      const flags: string[] = [];
      if (names.length > 1) flags.push('NAME_VARIANTS_IN_SOURCE');
      if (ls.some((l) => l.transcribed)) flags.push('TRANSCRIBED_FROM_SCAN');
      const recommended = ls.some((l) => l.recommended_for_stock);
      const catName = categoryFor(display);
      const t = ls.find((l) => l.transcribed);
      const sec = cat.sections.find((s) => s.no === t?.section);
      const p = await tx.part.create({
        data: {
          partNumber: code, name: display, unit: ls.find((l) => l.unit === 'M') ? 'M' : 'PCS', manufacturerId: maker.id,
          categoryId: catName ? catIds.get(catName) : null, isCritical: recommended, reviewFlags: flags, createdFrom: 'CATALOGUE',
          specification: t?.note || null,
          notes: t && sec?.gearbox_list ? `Gearbox maker's code from spare part list ${sec.gearbox_list.spare_part_list} (${sec.gearbox_list.list_suffix}), typed from a scanned page.${recommended ? ' Marked "#" = recommended for stock.' : ''}` : null,
          aliases: { create: names.map((n) => ({ alias: n, sourceRef: ls.find((l) => l.description === n)!.source_ref })) },
        },
      });
      partIds.set(code, p.id);
      inc('parts');
      inc('aliases', names.length);
    }

    for (const [i, l] of cat.lines.entries()) {
      const rec = await tx.sourceRecord.create({ data: { sourceFileId: sourceFile.id, sourceRef: l.source_ref, raw: l as unknown as Prisma.InputJsonValue } });
      inc('sourceRecords');
      const assemblyId = assemblyIds.get(l.section)!;
      if (l.kind === 'INFO' || !l.code) {
        if (l.description === '-') continue; // printed "- - -" placeholder rows stay in source_records only
        await tx.assemblyInfoLine.create({
          data: {
            assemblyId, position: l.position, description: l.description, quantityRaw: l.qty_raw || null, sortOrder: i, sourceRecordId: rec.id,
            note: l.role === 'COMPONENT' ? `Included in pos. ${l.parent_position}` : 'No code — not sold separately',
          },
        });
        inc('infoLines');
        continue;
      }
      const issues: string[] = [];
      if (l.role === 'VARIANT') issues.push('alternative_for_position');
      if (l.heading) issues.push(`heading:${l.heading}`);
      if (l.transcribed) issues.push('transcribed_from_scan');
      if (l.marker) issues.push(`marker:${l.marker}`);
      await tx.partUsage.create({
        data: {
          partId: partIds.get(l.code)!, assemblyId, position: l.position, installedQty: l.qty, installedUnit: l.unit,
          installedRaw: l.qty_raw || null, recommendedSpare: l.recommended_for_stock ? l.qty : null, recommendedUnit: l.recommended_for_stock ? l.unit : null,
          recommendedRaw: l.recommended_for_stock ? '#' : null, nameInSource: l.description, issues, sortOrder: i, sourceRecordId: rec.id,
        },
      });
      inc('usages');
    }

    for (const d of cat.drawings) {
      const s = stored.get(d.file)!;
      await tx.partImage.create({
        data: {
          assemblyId: assemblyIds.get(d.section)!, kind: 'DRAWING', storageKey: s.key, thumbKey: s.thumbKey, mimeType: s.mime, width: s.width,
          height: s.height, bytes: s.bytes, sha256: s.sha256, caption: cat.sections.find((x) => x.no === d.section)!.title, sortOrder: 0,
          sourceRef: `${d.source_ref}, rendered at 150 dpi${d.rotated_deg ? ' and turned upright' : ''}`,
        },
      });
      inc('drawings');
    }

    await refreshSearchText(tx, [...partIds.values()]);
    await audit(req, { action: 'SOURCE_CATALOGUE_IMPORTED', docType: 'SOURCE', docId: sourceFile.id, docNumber: sourceFile.fileName, newValue: { sha256: pdfSha, counts } }, tx);
  }, { timeout: 600_000, maxWait: 30_000 });

  return { status: 'IMPORTED', sourceSha256: pdfSha, counts };
}
