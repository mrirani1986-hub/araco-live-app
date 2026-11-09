import { getSettings } from '../lib/settings.js';
import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { requirePerm } from '../lib/auth.js';
import { HttpError, badRequest, notFound } from '../lib/errors.js';
import { refreshSearchText } from '../services/parts.js';
import { idParam, optDate, optStr } from '../lib/http.js';
import { audit } from '../lib/audit.js';
import { createPr } from '../services/pr.js';
import { partPictureKeys } from '../pdf/documents.js';

const r = Router();
r.use(requirePerm('cart.use'));

const itemSchema = z.object({
  quantity: z.coerce.number().positive(),
  requiredDate: optDate,
  reason: optStr,
  equipmentId: z.coerce.number().int().positive().nullish(),
  machine: optStr,
  project: optStr,
  notes: optStr,
});

async function cartView(userId: number) {
  const items = await prisma.cartItem.findMany({
    where: { userId },
    orderBy: { createdAt: 'asc' },
    include: {
      part: {
        select: {
          id: true, partNumber: true, name: true, description: true, unit: true, standardPrice: true, currency: true,
          supplierParts: { orderBy: [{ isPreferred: 'desc' }, { price: 'asc' }], take: 1, include: { supplier: { select: { id: true, name: true } } } },
        },
      },
    },
  });
  const pics = await partPictureKeys(items.map((i) => i.partId));
  const equipmentIds = [...new Set(items.map((i) => i.equipmentId).filter(Boolean))] as number[];
  const equipment = new Map((await prisma.equipment.findMany({ where: { id: { in: equipmentIds } } })).map((e) => [e.id, e.name]));
  let total = 0;
  const rows = items.map((i) => {
    const sp = i.part.supplierParts[0];
    const price = sp?.price != null ? Number(sp.price) : i.part.standardPrice != null ? Number(i.part.standardPrice) : null;
    const lineTotal = price == null ? null : Math.round(price * Number(i.quantity) * 100) / 100;
    total += lineTotal ?? 0;
    return {
      id: i.id, partId: i.partId, partNumber: i.part.partNumber, name: i.part.name, description: i.part.description,
      unit: i.part.unit, quantity: Number(i.quantity), price, currency: sp?.currency ?? i.part.currency, lineTotal,
      supplier: sp?.supplier ?? null, picture: pics.get(i.partId) ?? null, requiredDate: i.requiredDate, reason: i.reason,
      equipmentId: i.equipmentId, equipment: i.equipmentId ? equipment.get(i.equipmentId) : null, machine: i.machine,
      project: i.project, notes: i.notes,
    };
  });
  const priced = [...new Set(rows.filter((r) => r.price != null).map((r) => r.currency))];
  const currency = priced.length === 1 ? priced[0] : (await getSettings()).currency;
  return { items: rows, total: Math.round(total * 100) / 100, currency, mixedCurrencies: priced.length > 1, count: rows.length, unpriced: rows.filter((r) => r.price == null).length };
}

r.get('/', async (req, res) => res.json(await cartView(req.user!.id)));

r.post('/', async (req, res) => {
  const body = itemSchema.extend({ partId: z.coerce.number().int().positive() }).parse(req.body);
  const part = await prisma.part.findUnique({ where: { id: body.partId } });
  if (!part) throw notFound('Part');
  const existing = await prisma.cartItem.findUnique({ where: { userId_partId: { userId: req.user!.id, partId: body.partId } } });
  const data = {
    requiredDate: body.requiredDate ? new Date(body.requiredDate) : undefined, reason: body.reason ?? undefined,
    equipmentId: body.equipmentId ?? undefined, machine: body.machine ?? undefined, project: body.project ?? undefined, notes: body.notes ?? undefined,
  };
  if (existing) {
    await prisma.cartItem.update({ where: { id: existing.id }, data: { ...data, quantity: { increment: body.quantity } } });
  } else {
    await prisma.cartItem.create({ data: { ...data, userId: req.user!.id, partId: body.partId, quantity: body.quantity } });
  }
  await audit(req, { action: 'CART_ITEM_ADDED', docType: 'PART', docId: part.id, docNumber: part.partNumber, newValue: { quantity: body.quantity } });
  res.status(201).json(await cartView(req.user!.id));
});

/**
 * An item that is not in the system yet, typed in by the requester: it becomes a new part (marked
 * ADDED_FROM_REQUEST for the store to review; without a maker's part number it gets the next REQ-nnnnnn number
 * and NO_PART_NUMBER) and, unless addToCart is false (the PR edit screen adds it as a line itself), goes into the
 * cart. A part number that already exists is refused with that part, so nothing is duplicated.
 */
r.post('/new-item', async (req, res) => {
  const body = itemSchema.extend({
    name: z.string().trim().min(2).max(200), partNumber: z.string().trim().max(60).optional(), unit: z.string().trim().min(1).max(20).default('PCS'),
    brand: optStr, specification: optStr, addToCart: z.boolean().default(true),
  }).parse(req.body);
  if (body.partNumber) {
    const found = await prisma.part.findFirst({ where: { OR: [{ partNumber: { equals: body.partNumber, mode: 'insensitive' } }, { aliases: { some: { alias: { equals: body.partNumber, mode: 'insensitive' } } } }] }, select: { id: true, partNumber: true, name: true } });
    if (found) throw new HttpError(409, `${body.partNumber} is already in the system as ${found.partNumber} — ${found.name}. Add that part instead.`, { part: found });
  }
  const part = await prisma.$transaction(async (tx) => {
    let partNumber = body.partNumber;
    if (!partNumber) {
      const last = await tx.part.findFirst({ where: { partNumber: { startsWith: 'REQ-' } }, orderBy: { partNumber: 'desc' }, select: { partNumber: true } });
      partNumber = `REQ-${String((Number(last?.partNumber.slice(4)) || 0) + 1).padStart(6, '0')}`;
    }
    const p = await tx.part.create({
      data: {
        partNumber, name: body.name.toUpperCase(), unit: body.unit.toUpperCase(), brand: body.brand ?? null, specification: body.specification ?? null,
        createdFrom: 'REQUEST', reviewFlags: ['ADDED_FROM_REQUEST', ...(body.partNumber ? [] : ['NO_PART_NUMBER'])],
        notes: `Added by ${req.user!.fullName} from a spare parts request (not in the catalogues); check the details before ordering.`,
      },
    });
    await refreshSearchText(tx, [p.id]);
    await audit(req, { action: 'PART_CREATED', docType: 'PART', docId: p.id, docNumber: p.partNumber, newValue: { name: p.name, from: 'request', partNumberGiven: !!body.partNumber } }, tx);
    if (body.addToCart) {
      await tx.cartItem.create({ data: { userId: req.user!.id, partId: p.id, quantity: body.quantity, requiredDate: body.requiredDate ? new Date(body.requiredDate) : undefined, reason: body.reason ?? undefined,
        equipmentId: body.equipmentId ?? undefined, machine: body.machine ?? undefined, project: body.project ?? undefined, notes: body.notes ?? undefined } });
    }
    return p;
  });
  res.status(201).json({ part: { id: part.id, partNumber: part.partNumber, name: part.name, unit: part.unit }, cart: body.addToCart ? await cartView(req.user!.id) : undefined });
});

r.patch('/:id', async (req, res) => {
  const id = idParam(req);
  const body = itemSchema.partial().parse(req.body);
  const item = await prisma.cartItem.findFirst({ where: { id, userId: req.user!.id } });
  if (!item) throw notFound('Cart item');
  await prisma.cartItem.update({
    where: { id },
    data: {
      quantity: body.quantity, reason: body.reason, equipmentId: body.equipmentId, machine: body.machine, project: body.project, notes: body.notes,
      requiredDate: body.requiredDate === undefined ? undefined : body.requiredDate ? new Date(body.requiredDate) : null,
    },
  });
  res.json(await cartView(req.user!.id));
});

r.delete('/:id', async (req, res) => {
  const id = idParam(req);
  const n = await prisma.cartItem.deleteMany({ where: { id, userId: req.user!.id } });
  if (!n.count) throw notFound('Cart item');
  res.json(await cartView(req.user!.id));
});

r.delete('/', async (req, res) => {
  await prisma.cartItem.deleteMany({ where: { userId: req.user!.id } });
  res.json(await cartView(req.user!.id));
});

// Create a PR from the cart (all items, or selected ones)
r.post('/checkout', requirePerm('pr.create'), async (req, res) => {
  const body = z.object({
    itemIds: z.array(z.number().int()).optional(),
    companyId: z.coerce.number().int().positive().nullish(),
    department: optStr, project: optStr, requiredDate: optDate, priority: z.enum(['LOW', 'NORMAL', 'HIGH', 'URGENT']).optional(),
    reason: optStr, notes: optStr, submit: z.boolean().optional(),
  }).parse(req.body);
  const items = await prisma.cartItem.findMany({
    where: { userId: req.user!.id, ...(body.itemIds ? { id: { in: body.itemIds } } : {}) }, orderBy: { createdAt: 'asc' },
    include: { part: { include: { supplierParts: { orderBy: [{ isPreferred: 'desc' }, { price: 'asc' }], take: 1 } } } },
  });
  if (!items.length) throw badRequest('Your request cart is empty');
  const equipmentNames = new Map((await prisma.equipment.findMany()).map((e) => [e.id, e.name]));
  const pr = await createPr(req, body, items.map((i) => ({
    partId: i.partId, quantity: Number(i.quantity), supplierId: i.part.supplierParts[0]?.supplierId ?? null,
    equipmentId: i.equipmentId, machine: i.machine ?? (i.equipmentId ? equipmentNames.get(i.equipmentId) ?? null : null),
    requiredDate: i.requiredDate?.toISOString() ?? null, reason: i.reason, notes: [i.project && `Project: ${i.project}`, i.notes].filter(Boolean).join(' — ') || null,
  })), { fromCart: true });
  res.status(201).json(pr);
});

export default r;
