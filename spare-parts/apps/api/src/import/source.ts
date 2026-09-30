import fs from 'node:fs/promises';
import path from 'node:path';
import AdmZip from 'adm-zip';
import { Prisma } from '@prisma/client';
import { env } from '../env.js';
import { prisma, withTx } from '../lib/prisma.js';
import { sha256, storeImage } from '../lib/storage.js';
import { audit } from '../lib/audit.js';
import { refreshSearchText } from '../services/parts.js';
import type { Request } from 'express';

interface WbRow {
  source_ref: string; sheet: string; row: number; table: number; machine: string; group: string; group_code: string | null;
  group_inferred: boolean; caption_cell: string | null; code: string; code_raw: string; part_name: string; name_raw: string;
  pieces_raw: string | number | null; spare_raw: string | number | null; pieces_qty: number | null; pieces_unit: string | null;
  pieces_issue: string | null; spare_qty: number | null; spare_unit: string | null; spare_issue: string | null;
  code_has_whitespace: boolean; fill: string | null; pieces_font_color: string | null;
}
interface WbImage {
  sheet: string; picture_name: string; anchor_from: string; anchor_to: string | null; media: string; original_media: string | null;
  effects: string[]; rotation_deg?: number; flip_h?: boolean; flip_v?: boolean; sha256: string; bytes: number; width: number; height: number; table: number | null; machine: string; group: string | null;
}
interface PdfRow { source_ref: string; code: string; spare_raw: string; highlighted: boolean; page: number }

// Spelling corrections for the DISPLAY name only. Originals are kept as aliases.
const SPELLING: Record<string, string> = {
  PENEUMATIC: 'PNEUMATIC', PENUMATIC: 'PNEUMATIC', DISTRUBITOR: 'DISTRIBUTOR', VIBERATOR: 'VIBRATOR', ACUATOR: 'ACTUATOR',
  SAFTY: 'SAFETY', SELENOID: 'SOLENOID', GURD: 'GUARD', GABLE: 'CABLE', HUMMER: 'HAMMER', LOADCELL: 'LOAD CELL',
  ORING: 'O RING', VALVECOIL: 'VALVE COIL', WEARLINING: 'WEAR LINING', PULLGUARD: 'PULL GUARD', CYLINDRICAL: 'CYLINDRICAL',
};
export const cleanName = (n: string) => n.toUpperCase().split(/\s+/).filter(Boolean).map((w) => SPELLING[w] ?? w).join(' ');

// Suggested categories from the part name (first match wins). Admins can change them.
const CATEGORY_RULES: [RegExp, string][] = [
  [/BEARING|BEARING BODY|BEARING COVER/, 'Bearings & Housings'],
  [/SEAL|O RING|LEAKPROOF|GASKET/, 'Seals & O-Rings'],
  [/BELT|PULLEY|CHAIN|GEARWHEEL|COUPLING|SPROCKET|CLAMPING SLEEVE/, 'Belts, Pulleys & Power Transmission'],
  [/GEARBOX|GEAR|SHAFT|MOTOR/, 'Motors, Gearboxes & Drives'],
  [/PNEUMATIC|SOLENOID|AIR SERVICE|LUBRICATOR|WATER CATCHER|WATER DRAINER|AIR TANK|MUFFLER|AIR SHOCK|ACTUATOR|COMPRESSOR|PUMP KIT|CYLINDER HEAD|COOLER|MANOMETER|PRESSURE SWITCH|SAFETY VALVE|NON RETURN|DRAIN VALVE/, 'Pneumatics & Compressed Air'],
  [/HYDRAULIC|GREASE|LUBRICATION|OIL/, 'Hydraulics & Lubrication'],
  [/LOAD CELL|PROXIMITY|SENSOR|SWITCH|CONTROL PANEL|LEVEL INDICATOR|TIMER|CABLE|COIL|PULL GUARD|VIBRATOR/, 'Electrical, Sensors & Weighing'],
  [/LINING|PADDLE|SCRAPER|MIXING ARM|IDLER|ROLLER|BRUSH|BELT CLEANER|WEAR/, 'Wear Parts'],
  [/HOSE|CLAMP|FITTING|PIPE|BELLOW|VALVE/, 'Valves, Hoses & Fittings'],
  [/FILTER/, 'Filters'],
  [/STUD|NUT|WASHER|BOLT|PIN|SPACER|ROD END|FIXER|FIXING PLATE|LOCK|CIRCLIP|SPRING|ECCENTRIC/, 'Fasteners & Small Parts'],
  [/COVER|GUARD|HANDLE|HOUSING|FLANGE|FOOT|RUBBER|DAMPER|CHUTE|GATE|DRUM|RAIL|SLIDE|ADAPTER|CONNECTION|CAP|SHIELD|FRAME|BODY|COLLECTOR/, 'Structural, Covers & Housings'],
  [/PUMP|TANK|BATCHER|SILO|RESERVOIR|DISTRIBUTOR|KIT|GROUP|UNIT/, 'Assemblies & Units'],
];
export const suggestCategory = (name: string) => CATEGORY_RULES.find(([re]) => re.test(name))?.[1] ?? null;

const readJson = async <T>(p: string) => JSON.parse(await fs.readFile(p, 'utf8')) as T;

export interface SourceImportResult {
  status: 'IMPORTED' | 'ALREADY_IMPORTED';
  sourceSha256: string;
  counts: Record<string, number>;
}

export async function importSourceWorkbook(req: Request | null, opts: { dryRun?: boolean } = {}): Promise<SourceImportResult> {
  const wbPath = path.join(env.sourceDir, 'original', 'SPARE_PART_LIST.xlsx');
  const pdfPath = path.join(env.sourceDir, 'original', 'SPARE_PART_LIST.pdf');
  const extracted = path.join(env.sourceDir, 'extracted');
  const wbBuf = await fs.readFile(wbPath);
  const wbSha = sha256(wbBuf);
  const { meta, rows } = await readJson<{ meta: { sha256: string; properties: Record<string, string> }; rows: WbRow[] }>(path.join(extracted, 'workbook', 'rows.json'));
  if (meta.sha256 !== wbSha) throw new Error('rows.json was extracted from a different workbook. Re-run tools/extract_source_xlsx.py');
  const images = await readJson<WbImage[]>(path.join(extracted, 'workbook', 'images.json'));
  const pdfRows = (await readJson<{ rows: PdfRow[] }>(path.join(extracted, 'pdf-2021', 'rows.json'))).rows.filter((r) => r.code);

  const existing = await prisma.sourceFile.findUnique({ where: { sha256: wbSha }, include: { _count: { select: { records: true } } } });
  if (existing && existing._count.records > 0) {
    return { status: 'ALREADY_IMPORTED', sourceSha256: wbSha, counts: { sourceRecords: existing._count.records } };
  }

  // 2021 PDF values matched row-by-row (the extraction showed identical code order).
  const pdfByIndex = rows.map((r, i) => (pdfRows[i]?.code === r.code ? pdfRows[i] : null));

  // Pre-store drawings outside the DB transaction (files are content-addressed, so this is idempotent).
  const zip = new AdmZip(wbBuf);
  const stored = new Map<string, Awaited<ReturnType<typeof storeImage>>>();
  if (!opts.dryRun) {
    for (const im of images) {
      const data = zip.getEntry(im.media)?.getData();
      if (!data) throw new Error(`Picture ${im.media} missing from workbook`);
      if (sha256(data) !== im.sha256) throw new Error(`Picture ${im.media} checksum mismatch`);
      stored.set(im.media, await storeImage(data, 'drawings', { rotate: im.rotation_deg, flipH: im.flip_h, flipV: im.flip_v }));
    }
  }

  const counts: Record<string, number> = {};
  const inc = (k: string, n = 1) => { counts[k] = (counts[k] ?? 0) + n; };

  const run = async (tx: Prisma.TransactionClient) => {
    const pdfBuf = await fs.readFile(pdfPath).catch(() => null);
    const sourceFile = await tx.sourceFile.upsert({
      where: { sha256: wbSha },
      update: {},
      create: { fileName: 'SPARE_PART_LIST.xlsx', kind: 'WORKBOOK', sha256: wbSha, storedPath: 'source-data/original/SPARE_PART_LIST.xlsx', properties: meta.properties, importedBy: req?.user?.id },
    });
    if (pdfBuf) {
      await tx.sourceFile.upsert({
        where: { sha256: sha256(pdfBuf) }, update: {},
        create: { fileName: 'SPARE_PART_LIST.pdf', kind: 'PDF', sha256: sha256(pdfBuf), storedPath: 'source-data/original/SPARE_PART_LIST.pdf', properties: { note: '2021 PDF print of an earlier version of the workbook; used for comparison only' }, importedBy: req?.user?.id },
      });
    }
    const elkon = await tx.manufacturer.upsert({ where: { name: 'ELKON' }, update: {}, create: { name: 'ELKON' } });
    const company = await tx.company.findFirst({ orderBy: { id: 'asc' } });
    const branch = company ? await tx.branch.findFirst({ where: { companyId: company.id } }) : null;

    // Categories
    const catIds = new Map<string, number>();
    for (const [, name] of CATEGORY_RULES) {
      const c = await tx.category.upsert({ where: { name }, update: {}, create: { name } });
      catIds.set(name, c.id);
    }

    // Equipment & assemblies
    const machines = [...new Set(rows.map((r) => r.machine))];
    const equipmentIds = new Map<string, number>();
    for (const [i, m] of machines.entries()) {
      const sheet = rows.find((r) => r.machine === m)!.sheet;
      const e = await tx.equipment.upsert({
        where: { code: sheet.replace(/\s+/g, '-') },
        update: {},
        create: { code: sheet.replace(/\s+/g, '-'), name: m, manufacturerId: elkon.id, sourceSheet: sheet, sortOrder: i, branchId: branch?.id },
      });
      equipmentIds.set(m, e.id);
      inc('equipment');
    }
    const assemblyIds = new Map<string, number>();
    let asmOrder = 0;
    for (const r of rows) {
      const key = `${r.machine}||${r.group}`;
      if (assemblyIds.has(key)) continue;
      const a = await tx.assembly.upsert({
        where: { equipmentId_name: { equipmentId: equipmentIds.get(r.machine)!, name: r.group } },
        update: {},
        create: {
          equipmentId: equipmentIds.get(r.machine)!, name: r.group, nameInferred: r.group_inferred,
          sourceRef: r.caption_cell ? `${r.sheet}!${r.caption_cell}` : `${r.sheet} table ${r.table + 1}`, sortOrder: asmOrder++,
        },
      });
      assemblyIds.set(key, a.id);
      inc('assemblies');
    }

    // Parts: one per code; display name = longest cleaned spelling; all spellings kept as aliases.
    const byCode = new Map<string, WbRow[]>();
    for (const r of rows) byCode.set(r.code, [...(byCode.get(r.code) ?? []), r]);
    const partIds = new Map<string, number>();
    for (const [code, rs] of byCode) {
      const names = [...new Set(rs.map((r) => r.part_name))];
      const display = names.map(cleanName).sort((a, b) => b.length - a.length)[0];
      const flags: string[] = [];
      if (names.length > 1) flags.push('NAME_VARIANTS_IN_SOURCE');
      if (display === 'PN') flags.push('NAME_UNCLEAR');
      if (rs.some((r) => r.code_has_whitespace)) flags.push('CODE_WHITESPACE_TRIMMED');
      if (rs.some((r) => ['empty', 'dash_placeholder'].includes(r.pieces_issue ?? ''))) flags.push('INSTALLED_QTY_MISSING');
      if (rs.some((r) => r.pieces_issue?.startsWith('unit_variant') || r.spare_issue?.startsWith('unit_variant'))) flags.push('UNIT_VARIANT');
      const spares = new Set(rs.map((r) => (r.spare_qty == null ? null : `${r.spare_qty} ${r.spare_unit}`)));
      if (rs.length > 1 && spares.size > 1) flags.push('SPARE_RECOMMENDATION_DIFFERS_BY_MACHINE');
      const unit = rs.find((r) => r.pieces_unit)?.pieces_unit ?? rs.find((r) => r.spare_unit)?.spare_unit ?? 'PCS';
      const cat = suggestCategory(display);
      const p = await tx.part.create({
        data: {
          partNumber: code, name: display, unit, manufacturerId: elkon.id, categoryId: cat ? catIds.get(cat) : null,
          isCritical: rs.some((r) => r.spare_qty != null && r.spare_qty > 0), reviewFlags: flags, createdFrom: 'WORKBOOK',
          aliases: { create: names.map((n) => ({ alias: n, sourceRef: rs.find((r) => r.part_name === n)!.source_ref })) },
        },
      });
      partIds.set(code, p.id);
      inc('parts');
      inc('aliases', names.length);
    }
    // Assembly codes that only appear in captions become parts too (flagged).
    for (const r of rows) {
      if (!r.group_code || partIds.has(r.group_code)) continue;
      const nm = cleanName(r.group.replace(/\(.*?\)/g, '').trim());
      const p = await tx.part.create({
        data: {
          partNumber: r.group_code, name: nm, unit: 'SET', manufacturerId: elkon.id, categoryId: catIds.get('Assemblies & Units'),
          createdFrom: 'CAPTION', reviewFlags: ['CREATED_FROM_CAPTION'],
          notes: `Assembly code taken from caption "${r.group}" (${r.sheet}${r.caption_cell ? '!' + r.caption_cell : ''}); not listed as a row in the workbook.`,
          aliases: { create: [{ alias: r.group, sourceRef: `${r.sheet}!${r.caption_cell}` }] },
        },
      });
      partIds.set(r.group_code, p.id);
      inc('partsFromCaptions');
    }
    // Link assemblies to their own part code.
    for (const r of rows) {
      if (!r.group_code) continue;
      await tx.assembly.update({ where: { id: assemblyIds.get(`${r.machine}||${r.group}`)! }, data: { assemblyPartId: partIds.get(r.group_code) } });
    }

    // Source records + usages (one per workbook row — nothing merged away).
    for (const [i, r] of rows.entries()) {
      const pdf = pdfByIndex[i];
      const rec = await tx.sourceRecord.create({
        data: {
          sourceFileId: sourceFile.id, sourceRef: r.source_ref,
          raw: { ...r, pdf_2021: pdf ? { ref: pdf.source_ref, spare_raw: pdf.spare_raw, highlighted: pdf.highlighted } : null } as unknown as Prisma.InputJsonValue,
        },
      });
      const issues = [r.pieces_issue, r.spare_issue].filter(Boolean) as string[];
      if (pdf && (pdf.spare_raw ?? '') !== String(r.spare_raw ?? '')) issues.push(`pdf2021_spare:${pdf.spare_raw || 'none'}`);
      await tx.partUsage.create({
        data: {
          partId: partIds.get(r.code)!, assemblyId: assemblyIds.get(`${r.machine}||${r.group}`)!,
          installedQty: r.pieces_qty, installedUnit: r.pieces_unit, installedRaw: r.pieces_raw == null ? null : String(r.pieces_raw),
          recommendedSpare: r.spare_qty, recommendedUnit: r.spare_unit, recommendedRaw: r.spare_raw == null ? null : String(r.spare_raw),
          nameInSource: r.part_name, issues, sortOrder: r.row, sourceRecordId: rec.id,
        },
      });
      inc('sourceRecords');
      inc('usages');
    }

    // Drawings -> assembly images
    const imgOrder = new Map<number, number>();
    for (const im of images) {
      const row = rows.find((r) => r.sheet === im.sheet && r.table === im.table);
      if (!row) continue;
      const assemblyId = assemblyIds.get(`${row.machine}||${row.group}`)!;
      const s = stored.get(im.media);
      if (!s) continue;
      const order = imgOrder.get(assemblyId) ?? 0;
      imgOrder.set(assemblyId, order + 1);
      await tx.partImage.create({
        data: {
          assemblyId, kind: 'DRAWING', storageKey: s.key, originalKey: s.originalKey, thumbKey: s.thumbKey, mimeType: s.mime, width: s.width, height: s.height,
          bytes: s.bytes, sha256: s.sha256, caption: row.group, sortOrder: order,
          sourceRef: `${im.sheet}!${im.anchor_from} (${im.picture_name}, ${im.media}${im.rotation_deg ? `, shown rotated ${im.rotation_deg}° as in Excel` : ''})`,
        },
      });
      inc('drawings');
    }

    await refreshSearchText(tx);
    await audit(req, { action: 'SOURCE_WORKBOOK_IMPORTED', docType: 'SOURCE', docId: sourceFile.id, docNumber: 'SPARE_PART_LIST.xlsx', newValue: { sha256: wbSha, counts } }, tx);
    if (opts.dryRun) throw new DryRun();
  };

  try {
    await prisma.$transaction(run, { timeout: 600_000, maxWait: 30_000 });
  } catch (e) {
    if (!(e instanceof DryRun)) throw e;
  }
  return { status: 'IMPORTED', sourceSha256: wbSha, counts };
}

class DryRun extends Error {}

/** Suggested minimum stock per part = sum of recommended spares over all machines. */
export async function suggestedMinimums() {
  const rows = await prisma.$queryRaw<{ part_id: number; part_number: string; name: string; unit: string; suggested: Prisma.Decimal; all_flag: boolean }[]>`
    SELECT p.id AS part_id, p.part_number, p.name, p.unit, SUM(u.recommended_spare) AS suggested,
           bool_or(u.recommended_raw = 'ALL') AS all_flag
    FROM part_usages u JOIN parts p ON p.id = u.part_id
    WHERE u.recommended_spare IS NOT NULL AND u.recommended_spare > 0
    GROUP BY p.id ORDER BY p.part_number`;
  return rows.map((r) => ({ partId: r.part_id, partNumber: r.part_number, name: r.name, unit: r.unit, suggested: Number(r.suggested), fromAll: r.all_flag }));
}

export { withTx };
