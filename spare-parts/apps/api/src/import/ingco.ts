import fs from 'node:fs/promises';
import path from 'node:path';
import { Prisma } from '@prisma/client';
import type { Request } from 'express';
import { env } from '../env.js';
import { prisma } from '../lib/prisma.js';
import { sameSource, sha256, storeImage } from '../lib/storage.js';
import { audit } from '../lib/audit.js';
import { refreshSearchText } from '../services/parts.js';
import { cleanName, type SourceImportResult } from './source.js';

/**
 * INGCO tools (source-data/original/ingco, read by tools/extract_ingco_catalogue.py): the English price list 2026 (name,
 * description, list price, qty per carton, picture), the Spanish INGCO España catalogue (Spanish name, EAN, local code)
 * and the INGCO Indonesia catalogue 2024 (Indonesian name, page). Tools are parts (manufacturer INGCO, "Tools - …"
 * categories), not machines. Imported once, in one transaction; existing parts are linked, never changed.
 */
interface PlRow { source_ref: string; page: number; sno: number; ref: string; ref_extra: string | null; name: string; desc: string; price: string; qty_ctn: string; picture?: string; flags: string[] }
interface Product {
  ref: string; category: string; price_list_rows: PlRow[];
  catalogo: { ref: string; pages: number[]; ean: string | null; cod: string | null; title_es: string | null; variant_es: string | null; source_ref: string } | null;
  katalog_id: { ref: string; page: number; title_id: string | null; source_ref: string } | null;
  catalogue_picture?: { file: string; source_ref: string } | null;
}
interface Catalogue { meta: { brand: string; sources: { file: string; sha256: string; pages: number; title: string; currency_note?: string }[] }; products: Product[] }

export const INGCO_DIR = 'ingco';

export async function importIngcoCatalogue(req: Request | null): Promise<SourceImportResult> {
  const dir = path.join(env.sourceDir, 'extracted', INGCO_DIR);
  const cat = JSON.parse(await fs.readFile(path.join(dir, 'catalogue.json'), 'utf8').catch(() => 'null')) as Catalogue | null;
  if (!cat) return { status: 'ALREADY_IMPORTED', sourceSha256: '', counts: {} };
  for (const s of cat.meta.sources) {
    if (!sameSource(await fs.readFile(path.join(env.sourceDir, s.file)), s.sha256)) throw new Error(`${s.file} differs from the one catalogue.json was extracted from. Re-run tools/extract_ingco_catalogue.py`);
  }
  const shas = cat.meta.sources.map((s) => s.sha256);
  if (await prisma.sourceFile.findUnique({ where: { sha256: shas[0] } })) {
    const added = await addCataloguePictures(req, cat, dir);
    const web = await addWebData(req, cat, dir);
    const lb = await addLebanonProducts(req, cat, dir);
    return { status: 'ALREADY_IMPORTED', sourceSha256: shas.join(','), counts: { ...(added ? { cataloguePictures: added } : {}), ...web, ...lb } };
  }

  const pictures = new Map<string, Awaited<ReturnType<typeof storeImage>>>();
  for (const p of cat.products) for (const r of p.price_list_rows) {
    if (r.picture && !pictures.has(r.picture)) pictures.set(r.picture, await storeImage(await fs.readFile(path.join(dir, r.picture)), 'parts'));
  }

  const counts: Record<string, number> = {};
  const inc = (k: string, n = 1) => { counts[k] = (counts[k] ?? 0) + n; };
  const [pl, es, ...id] = cat.meta.sources;

  await prisma.$transaction(async (tx) => {
    const files = new Map<string, number>();
    for (const s of cat.meta.sources) {
      const f = await tx.sourceFile.create({ data: { fileName: path.basename(s.file), kind: 'PDF', sha256: s.sha256, storedPath: `source-data/${s.file}`, importedBy: req?.user?.id, properties: { catalogue: s.title, pages: s.pages } } });
      files.set(s.file, f.id);
      inc('sourceFiles');
    }
    const idFileOf = (page: number) => { let n = 0; for (const s of id) { if (page <= n + s.pages) return s.file; n += s.pages; } return id[id.length - 1].file; };
    const maker = await tx.manufacturer.upsert({ where: { name: cat.meta.brand }, update: {}, create: { name: cat.meta.brand } });
    const catIds = new Map<string, number>();
    for (const name of [...new Set(cat.products.map((p) => p.category))].sort()) {
      const c = await tx.category.upsert({ where: { name }, update: {}, create: { name } });
      catIds.set(name, c.id);
    }

    const partIds: number[] = [];
    for (const p of cat.products) {
      const r = p.price_list_rows[0];
      const es1 = p.catalogo, id1 = p.katalog_id;
      const flags: string[] = [];
      let name: string;
      if (r?.name) name = cleanName(r.name);
      else if (es1?.title_es) { name = cleanName(es1.title_es); flags.push('NAME_IN_SPANISH'); }
      else if (id1?.title_id) { name = cleanName(id1.title_id.replace(/^\(\w+\)\s*/, '')); flags.push('NAME_IN_INDONESIAN'); }
      else { name = `INGCO ${p.ref}`; flags.push('NO_NAME_IN_SOURCE'); }
      const notes = [
        r ? `INGCO price list 2026 (${r.source_ref}): list price ${r.price} — currency not stated in the list; ${r.qty_ctn} per carton.` : '',
        es1 ? `Catálogo INGCO España p${es1.pages.join(', p')}${es1.title_es ? `: ${es1.title_es}` : ''}${es1.variant_es ? ` (${es1.variant_es})` : ''}${es1.cod ? `, COD ${es1.cod}` : ''}${es1.ean ? `, EAN ${es1.ean}` : ''}.` : '',
        id1 ? `INGCO Indonesia catalogue 2024 p${id1.page}${id1.title_id ? `: ${id1.title_id}` : ''}.` : '',
      ].filter(Boolean).join('\n');
      const aliases = [...new Set([r?.name, r?.ref_extra, es1?.title_es, es1?.ean, id1?.title_id].filter((x): x is string => !!x && x.trim().length > 0))];
      const found = await tx.part.findUnique({ where: { partNumber: p.ref } });
      let partId: number;
      if (found) { partId = found.id; inc('existingPartsLinked'); } else {
        const part = await tx.part.create({
          data: {
            partNumber: p.ref, name, unit: 'PCS', manufacturerId: maker.id, brand: cat.meta.brand, createdFrom: 'CATALOGUE',
            categoryId: catIds.get(p.category), specification: r?.desc || null, reviewFlags: flags,
            description: r ? null : 'In the INGCO catalogues, not in the 2024/2026 price list', notes: notes || null,
          },
        });
        partId = part.id;
        inc('parts');
        const ph = r?.picture ? pictures.get(r.picture) : undefined;
        if (ph) {
          await tx.partImage.create({ data: { partId, kind: 'PHOTO', storageKey: ph.key, thumbKey: ph.thumbKey, mimeType: ph.mime, width: ph.width, height: ph.height, bytes: ph.bytes, sha256: ph.sha256, caption: 'INGCO price list picture', isPrimary: true, sourceRef: `${r!.source_ref} (picture cut from the page)` } });
          inc('photos');
        }
      }
      for (const a of aliases) await tx.partAlias.upsert({ where: { partId_alias: { partId, alias: a } }, update: {}, create: { partId, alias: a, sourceRef: (es1?.title_es === a || es1?.ean === a) ? es1!.source_ref : id1?.title_id === a ? id1!.source_ref : r?.source_ref ?? null } });
      partIds.push(partId);
      for (const row of p.price_list_rows) { await tx.sourceRecord.create({ data: { sourceFileId: files.get(pl.file)!, sourceRef: row.source_ref, raw: row as unknown as Prisma.InputJsonValue } }); inc('sourceRecords'); }
      if (es1) { await tx.sourceRecord.create({ data: { sourceFileId: files.get(es.file)!, sourceRef: `${es1.source_ref} ${p.ref}`, raw: es1 as unknown as Prisma.InputJsonValue } }); inc('sourceRecords'); }
      if (id1) { await tx.sourceRecord.create({ data: { sourceFileId: files.get(idFileOf(id1.page))!, sourceRef: `${id1.source_ref} ${p.ref}`, raw: id1 as unknown as Prisma.InputJsonValue } }); inc('sourceRecords'); }
    }
    await refreshSearchText(tx, partIds);
    await audit(req, { action: 'SOURCE_CATALOGUE_IMPORTED', docType: 'SOURCE', docNumber: 'INGCO tools', newValue: { files: cat.meta.sources.map((s) => s.file), counts } }, tx);
  }, { timeout: 900_000, maxWait: 30_000 });

  const added = await addCataloguePictures(req, cat, dir);
  if (added) counts.cataloguePictures = added;
  Object.assign(counts, await addWebData(req, cat, dir));
  Object.assign(counts, await addLebanonProducts(req, cat, dir));
  return { status: 'IMPORTED', sourceSha256: shas.join(','), counts };
}

/**
 * Pictures cut from the Spanish / Indonesian catalogues for INGCO parts that have no picture yet (never replaces one,
 * including a picture added in the app). Runs at every start; does nothing once every such part has a picture.
 */
async function addCataloguePictures(req: Request | null, cat: Catalogue, dir: string) {
  const wanted = cat.products.filter((p) => p.catalogue_picture);
  if (!wanted.length) return 0;
  const parts = await prisma.part.findMany({
    where: { partNumber: { in: wanted.map((p) => p.ref) }, manufacturer: { name: cat.meta.brand }, images: { none: {} } },
    select: { id: true, partNumber: true },
  });
  if (!parts.length) return 0;
  const byNo = new Map(wanted.map((p) => [p.ref, p.catalogue_picture!]));
  let added = 0;
  for (const part of parts) {
    const pic = byNo.get(part.partNumber)!;
    const s = await storeImage(await fs.readFile(path.join(dir, pic.file)), 'parts');
    await prisma.partImage.create({
      data: { partId: part.id, kind: 'PHOTO', storageKey: s.key, thumbKey: s.thumbKey, mimeType: s.mime, width: s.width, height: s.height, bytes: s.bytes, sha256: s.sha256,
        caption: 'INGCO catalogue picture', isPrimary: true, sourceRef: `${pic.source_ref} (picture cut from the page)` },
    });
    added++;
  }
  await audit(req, { action: 'PART_PICTURES_ADDED', docType: 'SOURCE', docNumber: 'INGCO tools', newValue: { pictures: added, from: 'INGCO catalogues (Spanish / Indonesian)' } });
  return added;
}

interface WebProduct { ref: string; name: string; name_language: string; category: string | null; key_data: string[]; site: string; page: string | null; picture_url: string; file: string; sha256: string }

/**
 * INGCO website data (source-data/extracted/ingco/web.json, from tools/fetch_ingco_web.py) for INGCO tools without a
 * price-list or catalogue picture: the website picture (only for a part with no picture at all), the key data as
 * specification (only when the specification is empty), the website name as search name and a note. Applied once per
 * website snapshot (recorded in source_files); never replaces anything.
 */
async function addWebData(req: Request | null, cat: Catalogue, dir: string) {
  const web = JSON.parse(await fs.readFile(path.join(dir, 'web.json'), 'utf8').catch(() => 'null')) as { source: { file: string; sha256: string }; products: WebProduct[] } | null;
  if (!web) return {};
  if (!sameSource(await fs.readFile(path.join(env.sourceDir, web.source.file)), web.source.sha256)) throw new Error(`${web.source.file} differs from the one web.json was made from. Re-run tools/fetch_ingco_web.py pictures`);
  if (await prisma.sourceFile.findUnique({ where: { sha256: web.source.sha256 } })) return {};
  const counts: Record<string, number> = {};
  const inc = (k: string) => { counts[k] = (counts[k] ?? 0) + 1; };
  const stored = new Map<string, Awaited<ReturnType<typeof storeImage>>>();
  for (const w of web.products) {
    const data = await fs.readFile(path.join(dir, w.file));
    if (sha256(data) !== w.sha256) throw new Error(`${w.file} checksum mismatch`);
    stored.set(w.ref, await storeImage(data, 'parts'));
  }
  await prisma.$transaction(async (tx) => {
    const f = await tx.sourceFile.create({ data: { fileName: path.basename(web.source.file), kind: 'WEBSITE', sha256: web.source.sha256, storedPath: `source-data/${web.source.file}`, importedBy: req?.user?.id, properties: { source: 'www.ingco.com product lists', products: web.products.length } } });
    const parts = await tx.part.findMany({ where: { partNumber: { in: web.products.map((w) => w.ref) }, manufacturer: { name: cat.meta.brand } }, include: { _count: { select: { images: true } } } });
    const byNo = new Map(web.products.map((w) => [w.ref, w]));
    for (const part of parts) {
      const w = byNo.get(part.partNumber)!;
      const ref = `INGCO website (${w.site})${w.page ? ` ${w.page}` : ''}`;
      await tx.sourceRecord.create({ data: { sourceFileId: f.id, sourceRef: `${ref} ${w.ref}`, raw: w as unknown as Prisma.InputJsonValue } });
      if (!part._count.images) {
        const s = stored.get(w.ref)!;
        await tx.partImage.create({ data: { partId: part.id, kind: 'PHOTO', storageKey: s.key, thumbKey: s.thumbKey, mimeType: s.mime, width: s.width, height: s.height, bytes: s.bytes, sha256: s.sha256, caption: 'INGCO website picture', isPrimary: true, sourceRef: `${ref} (${w.picture_url})` } });
        inc('websitePictures');
      }
      const data: Prisma.PartUpdateInput = {};
      if (!part.specification && w.key_data.length) data.specification = w.key_data.join('; ');
      const note = `INGCO website (${w.site}): ${w.name}${w.category ? ` — ${w.category}` : ''}${w.key_data.length ? ` — ${w.key_data.join('; ')}` : ''}.`;
      if (!part.notes?.includes(note)) data.notes = [part.notes, note].filter(Boolean).join('\n');
      if (Object.keys(data).length) {
        await tx.part.update({ where: { id: part.id }, data });
        await audit(req, { action: 'PART_EDITED', docType: 'PART', docId: part.id, docNumber: part.partNumber, oldValue: { specification: part.specification, notes: part.notes }, newValue: { ...data, from: ref } }, tx);
        if (data.specification) inc('specificationsFilled');
      }
      if (w.name_language === 'English' && w.name.trim()) await tx.partAlias.upsert({ where: { partId_alias: { partId: part.id, alias: w.name.trim() } }, update: {}, create: { partId: part.id, alias: w.name.trim(), sourceRef: ref } });
      inc('partsMatched');
    }
    await refreshSearchText(tx, parts.map((p) => p.id));
    await audit(req, { action: 'PART_PICTURES_ADDED', docType: 'SOURCE', docNumber: 'INGCO tools', newValue: { from: 'INGCO website', ...counts } }, tx);
  }, { timeout: 600_000, maxWait: 30_000 });
  return counts;
}

interface LbProduct { ref: string; name: string; name_language: string; web_category: string | null; category: string; key_data: string[]; site: string; record_from: string; page: string | null; picture_url: string | null; file: string | null; sha256: string | null }

/**
 * The INGCO Lebanon website range (source-data/extracted/ingco/web-lb.json, from tools/fetch_ingco_web.py lebanon): every
 * product of www.ingco.com/lb-en that is not in the price list or the catalogues becomes an INGCO part with its name,
 * category, key data and picture. Applied once (recorded in source_files); a part number already in the app is only
 * linked (website name as search name), never changed.
 */
async function addLebanonProducts(req: Request | null, cat: Catalogue, dir: string) {
  const buf = await fs.readFile(path.join(dir, 'web-lb.json')).catch(() => null);
  if (!buf) return {};
  const lb = JSON.parse(buf.toString('utf8')) as { source: { file: string; sha256: string }; site: string; products: LbProduct[] };
  if (!sameSource(await fs.readFile(path.join(env.sourceDir, lb.source.file)), lb.source.sha256)) throw new Error(`${lb.source.file} differs from the one web-lb.json was made from. Re-run tools/fetch_ingco_web.py lebanon`);
  const key = sha256(Buffer.from(buf.toString('utf8').replace(/\r\n/g, '\n'), 'utf8'));
  if (await prisma.sourceFile.findUnique({ where: { sha256: key } })) return {};
  const counts: Record<string, number> = {};
  const inc = (k: string) => { counts[k] = (counts[k] ?? 0) + 1; };
  const stored = new Map<string, Awaited<ReturnType<typeof storeImage>>>();
  for (const w of lb.products) {
    if (!w.file) continue;
    const data = await fs.readFile(path.join(dir, w.file));
    if (sha256(data) !== w.sha256) throw new Error(`${w.file} checksum mismatch`);
    stored.set(w.ref, await storeImage(data, 'parts'));
  }
  await prisma.$transaction(async (tx) => {
    const f = await tx.sourceFile.create({ data: { fileName: 'web-lb.json', kind: 'WEBSITE', sha256: key, storedPath: `source-data/extracted/${INGCO_DIR}/web-lb.json`, importedBy: req?.user?.id, properties: { source: lb.site, products: lb.products.length } } });
    const maker = await tx.manufacturer.upsert({ where: { name: cat.meta.brand }, update: {}, create: { name: cat.meta.brand } });
    const catIds = new Map<string, number>();
    for (const name of [...new Set(lb.products.map((p) => p.category))]) catIds.set(name, (await tx.category.upsert({ where: { name }, update: {}, create: { name } })).id);
    const ids: number[] = [];
    for (const w of lb.products) {
      const ref = `INGCO website (${w.site})${w.page ? ` ${w.page}` : ''}`;
      await tx.sourceRecord.create({ data: { sourceFileId: f.id, sourceRef: `${ref} ${w.ref}`, raw: w as unknown as Prisma.InputJsonValue } });
      let part = await tx.part.findUnique({ where: { partNumber: w.ref } });
      if (part) inc('existingPartsLinked');
      else {
        part = await tx.part.create({
          data: {
            partNumber: w.ref, name: cleanName(w.name), unit: 'PCS', manufacturerId: maker.id, brand: cat.meta.brand, createdFrom: 'CATALOGUE',
            categoryId: catIds.get(w.category), specification: w.key_data.join('; ') || null, reviewFlags: w.name_language === 'English' ? [] : ['NAME_NOT_IN_ENGLISH'],
            description: 'On the INGCO Lebanon website, not in the 2024/2026 price list or the catalogues',
            notes: `INGCO website (${w.site}): ${w.name}${w.web_category ? ` — ${w.web_category}` : ''}${w.key_data.length ? ` — ${w.key_data.join('; ')}` : ''}.`,
          },
        });
        inc('websiteParts');
        const s = stored.get(w.ref);
        if (s) {
          await tx.partImage.create({ data: { partId: part.id, kind: 'PHOTO', storageKey: s.key, thumbKey: s.thumbKey, mimeType: s.mime, width: s.width, height: s.height, bytes: s.bytes, sha256: s.sha256, caption: 'INGCO website picture', isPrimary: true, sourceRef: `${ref} (${w.picture_url})` } });
          inc('websitePartPictures');
        }
      }
      if (w.name.trim()) await tx.partAlias.upsert({ where: { partId_alias: { partId: part.id, alias: w.name.trim() } }, update: {}, create: { partId: part.id, alias: w.name.trim(), sourceRef: ref } });
      ids.push(part.id);
    }
    await refreshSearchText(tx, ids);
    await audit(req, { action: 'SOURCE_CATALOGUE_IMPORTED', docType: 'SOURCE', docNumber: 'INGCO Lebanon website', newValue: { file: `extracted/${INGCO_DIR}/web-lb.json`, counts } }, tx);
  }, { timeout: 600_000, maxWait: 30_000 });
  return counts;
}
