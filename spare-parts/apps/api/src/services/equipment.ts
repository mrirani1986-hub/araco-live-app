import type { Prisma } from '@prisma/client';
import type { Tx } from '../lib/prisma.js';

export type EquipmentWithCatalogue = Prisma.EquipmentGetPayload<{ include: { assemblies: { include: { usages: true; infoLines: true; images: true } } } }>;

export const catalogueInclude = {
  assemblies: { orderBy: { sortOrder: 'asc' as const }, include: { usages: true, infoLines: true, images: true } },
} satisfies Prisma.EquipmentInclude;

/** Creates another machine of the same model with a copy of the catalogue (sections, positions, info lines, drawings). */
export async function copyEquipment(
  tx: Tx, src: EquipmentWithCatalogue,
  data: { code: string; name: string; serialNumber: string; location?: string | null; model?: string | null; notes?: string | null; uploadedBy?: number | null },
) {
  const maxOrder = (await tx.equipment.aggregate({ _max: { sortOrder: true } }))._max.sortOrder ?? 0;
  const e = await tx.equipment.create({
    data: {
      code: data.code, name: data.name, model: data.model ?? src.model, manufacturerId: src.manufacturerId, branchId: src.branchId, serialNumber: data.serialNumber,
      location: data.location, notes: data.notes ?? src.notes, sourceSheet: src.sourceSheet, copiedFromId: src.id, sortOrder: maxOrder + 1,
    },
  });
  for (const a of src.assemblies) {
    const na = await tx.assembly.create({
      data: { equipmentId: e.id, name: a.name, nameInferred: a.nameInferred, assemblyPartId: a.assemblyPartId, sourceRef: a.sourceRef, notes: a.notes, sortOrder: a.sortOrder },
    });
    if (a.usages.length) await tx.partUsage.createMany({
      data: a.usages.map((u) => ({
        partId: u.partId, assemblyId: na.id, position: u.position, installedQty: u.installedQty, installedUnit: u.installedUnit, installedRaw: u.installedRaw,
        recommendedSpare: u.recommendedSpare, recommendedUnit: u.recommendedUnit, recommendedRaw: u.recommendedRaw, nameInSource: u.nameInSource,
        issues: [...u.issues, `copied_from:${src.code}`], sortOrder: u.sortOrder,
      })),
    });
    if (a.infoLines.length) await tx.assemblyInfoLine.createMany({
      data: a.infoLines.map((l) => ({ assemblyId: na.id, position: l.position, description: l.description, quantityRaw: l.quantityRaw, note: l.note, sortOrder: l.sortOrder })),
    });
    if (a.images.length) await tx.partImage.createMany({
      data: a.images.map((i) => ({
        assemblyId: na.id, kind: i.kind, storageKey: i.storageKey, originalKey: i.originalKey, thumbKey: i.thumbKey, mimeType: i.mimeType, width: i.width,
        height: i.height, bytes: i.bytes, sha256: i.sha256, caption: i.caption, sortOrder: i.sortOrder, sourceRef: i.sourceRef, uploadedBy: data.uploadedBy ?? null,
      })),
    });
  }
  return e;
}
