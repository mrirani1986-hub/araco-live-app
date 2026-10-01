import fs from 'node:fs/promises';
import path from 'node:path';
import type { Request } from 'express';
import { env } from '../env.js';
import { prisma, withTx } from '../lib/prisma.js';
import { sha256 } from '../lib/storage.js';
import { audit } from '../lib/audit.js';
import { refreshSearchText } from '../services/parts.js';
import { catalogueInclude, copyEquipment } from '../services/equipment.js';

/**
 * MAN trucks from source-data/fleet/man-trucks.json (transcribed from the type-plate photos in
 * source-data/original/fleet). Each truck becomes a machine with its own copy of the DT catalogue, so
 * requests can name the truck. Keyed by VIN: a truck already in the app is never changed or duplicated.
 */
interface Truck {
  vin: string; vehicleNumber: string; type: string; manufacturer: string; modelYear: number;
  masses: Record<string, string>; smokeKValue: string; photo: string;
}
const LABELS: Record<string, string> = {
  grossVehicleWeight: 'Gross vehicle weight', grossCombinationWeight: 'Gross combination weight',
  axle1: 'Axle 1', axle2: 'Axle 2', axle3: 'Axle 3', axle4: 'Axle 4', trailerT1: 'Trailer T1', trailerT2: 'Trailer T2',
};

export async function importFleet(req: Request | null) {
  const file = path.join(env.sourceDir, 'fleet', 'man-trucks.json');
  const data = JSON.parse(await fs.readFile(file, 'utf8').catch(() => 'null')) as { catalogue: string; trucks: Truck[] } | null;
  if (!data) return { status: 'NO_FILE', added: [] as string[] };
  const src = await prisma.equipment.findUnique({ where: { code: data.catalogue }, include: catalogueInclude });
  if (!src) return { status: 'CATALOGUE_NOT_IMPORTED', added: [] as string[] };
  const added: string[] = [];
  for (const t of data.trucks) {
    if (await prisma.equipment.findFirst({ where: { serialNumber: t.vin } })) continue;
    const photo = await fs.readFile(path.join(env.sourceDir, t.photo));
    const [series, ...rest] = t.type.split(' ');
    const model = `MAN ${t.type}`;
    const notes = [
      `${t.manufacturer} ${t.type}, VIN ${t.vin}, MAN vehicle number ${t.vehicleNumber}, model year ${t.modelYear} (from the VIN).`,
      `Type plate: ${Object.entries(t.masses).map(([k, v]) => `${LABELS[k] ?? k} ${v}`).join('; ')}; smoke K-value ${t.smokeKValue}.`,
      `Parts: copy of the DT catalogue "Spare parts suitable for MAN TGA/TGS/TGX, TGL/TGM"; it also lists parts for other TG models and engines, so check the "suitable for" text on each part.`,
      `Source: type-plate photo source-data/${t.photo} (SHA-256 ${sha256(photo).slice(0, 12)}…). Plate and fleet number: add with Edit.`,
    ].join('\n');
    const e = await withTx(async (tx) => {
      const e = await copyEquipment(tx, src, {
        code: `MAN-${t.vehicleNumber}`.toUpperCase().replace(/[^A-Z0-9-]+/g, '-'),
        name: `MAN ${series} ${rest.join(' ')} (VIN ${t.vin})`,
        serialNumber: t.vin, model, notes,
      });
      await audit(req, { action: 'EQUIPMENT_COPIED', docType: 'EQUIPMENT', docId: e.id, docNumber: e.code, newValue: { from: src.code, vin: t.vin, type: t.type, source: t.photo } }, tx);
      return e;
    });
    added.push(e.code);
  }
  if (added.length) await refreshSearchText(prisma, [...new Set(src.assemblies.flatMap((a) => a.usages.map((u) => u.partId)))]);
  return { status: added.length ? 'IMPORTED' : 'ALREADY_IMPORTED', added };
}
