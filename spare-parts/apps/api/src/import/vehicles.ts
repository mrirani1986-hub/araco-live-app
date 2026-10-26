import fs from 'node:fs/promises';
import path from 'node:path';
import type { Request } from 'express';
import { env } from '../env.js';
import { prisma } from '../lib/prisma.js';
import { audit } from '../lib/audit.js';

/**
 * Vehicles without a parts catalogue (source-data/fleet/vehicles.json), e.g. the Great Wall Wingle pickup. Each is
 * added once as a machine keyed by VIN (an existing one is never changed). The VIN check digit must be right.
 */
interface Vehicle { vin: string; manufacturer: string; model: string; modelYear: number; kind: string; source: string }

const VALUE: Record<string, number> = Object.fromEntries([
  ...'0123456789'.split('').map((c, i) => [c, i]),
  ...'ABCDEFGH'.split('').map((c, i) => [c, i + 1]), ...'JKLMN'.split('').map((c, i) => [c, i + 1]), ['P', 7], ['R', 9],
  ...'STUVWXYZ'.split('').map((c, i) => [c, i + 2]),
]);
const WEIGHT = [8, 7, 6, 5, 4, 3, 2, 10, 0, 9, 8, 7, 6, 5, 4, 3, 2];

export function vinCheckDigitOk(vin: string) {
  if (!/^[A-HJ-NPR-Z0-9]{17}$/.test(vin)) return false;
  const r = vin.split('').reduce((s, c, i) => s + VALUE[c] * WEIGHT[i], 0) % 11;
  return vin[8] === (r === 10 ? 'X' : String(r));
}

export async function importVehicles(req: Request | null) {
  const file = path.join(env.sourceDir, 'fleet', 'vehicles.json');
  const data = JSON.parse(await fs.readFile(file, 'utf8').catch(() => 'null')) as { vehicles: Vehicle[] } | null;
  if (!data) return { status: 'NO_FILE', added: [] as string[] };
  const added: string[] = [];
  for (const v of data.vehicles) {
    if (!vinCheckDigitOk(v.vin)) throw new Error(`vehicles.json: VIN ${v.vin} has a wrong check digit`);
    if (await prisma.equipment.findFirst({ where: { serialNumber: { equals: v.vin, mode: 'insensitive' } } })) continue;
    const maker = await prisma.manufacturer.upsert({ where: { name: v.manufacturer }, update: {}, create: { name: v.manufacturer } });
    const maxOrder = (await prisma.equipment.aggregate({ _max: { sortOrder: true } }))._max.sortOrder ?? 0;
    const code = `${v.manufacturer.split(' ').map((w) => w[0]).join('')}-${v.model}-${v.vin.slice(-6)}`.toUpperCase().replace(/[^A-Z0-9-]+/g, '-');
    const e = await prisma.equipment.create({
      data: {
        code, name: `${v.manufacturer} ${v.model} ${v.kind} ${v.modelYear} (VIN ${v.vin})`, model: `${v.model} (${v.modelYear})`,
        manufacturerId: maker.id, serialNumber: v.vin, sortOrder: maxOrder + 1,
        notes: `${v.source}\nNo parts catalogue in the app yet: add parts with Settings → Import from Excel (this machine's name in the Equipment column). Plate number and location: add with Edit.`,
      },
    });
    await audit(req, { action: 'EQUIPMENT_CREATED', docType: 'EQUIPMENT', docId: e.id, docNumber: e.code, newValue: { vin: v.vin, from: 'source-data/fleet/vehicles.json' } });
    added.push(e.code);
  }
  return { status: added.length ? 'IMPORTED' : 'ALREADY_IMPORTED', added };
}
