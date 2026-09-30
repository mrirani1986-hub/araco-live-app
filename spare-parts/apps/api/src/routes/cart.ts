import { getSettings } from '../lib/settings.js';
import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { requirePerm } from '../lib/auth.js';
import { badRequest, notFound } from '../lib/errors.js';
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
