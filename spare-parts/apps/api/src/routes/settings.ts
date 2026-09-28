import { Router } from 'express';
import multer from 'multer';
import { z } from 'zod';
import { prisma, withTx } from '../lib/prisma.js';
import { requirePerm } from '../lib/auth.js';
import { audit } from '../lib/audit.js';
import { badRequest } from '../lib/errors.js';
import { getSettings, setSetting } from '../lib/settings.js';
import { storeImage } from '../lib/storage.js';

const r = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 } });

r.get('/', async (_req, res) => res.json(await getSettings()));

r.put('/', requirePerm('settings.manage'), async (req, res) => {
  const body = z.object({
    company: z.object({ name: z.string().trim().min(1), address: z.string().default(''), phone: z.string().default(''), email: z.string().default(''), taxNumber: z.string().default('') }).optional(),
    currency: z.string().trim().length(3).optional(),
    taxRate: z.coerce.number().min(0).max(100).optional(),
    poTerms: z.string().optional(),
    defaultPaymentTerms: z.string().optional(),
    defaultDeliveryTerms: z.string().optional(),
    overReceiptTolerancePct: z.coerce.number().min(0).max(50).optional(),
  }).parse(req.body);
  const before = await getSettings();
  await withTx(async (tx) => {
    for (const [k, v] of Object.entries(body)) {
      if (v === undefined) continue;
      const value = k === 'company' ? { ...before.company, ...(v as object) } : v;
      await setSetting(k as never, value, tx);
    }
    if (body.company?.name) await tx.company.updateMany({ data: { name: body.company.name, address: body.company.address, phone: body.company.phone, email: body.company.email, taxNumber: body.company.taxNumber } });
    await audit(req, { action: 'SETTINGS_CHANGED', docType: 'SETTINGS', oldValue: Object.fromEntries(Object.keys(body).map((k) => [k, (before as unknown as Record<string, unknown>)[k]])), newValue: body }, tx);
  });
  res.json(await getSettings());
});

r.post('/logo', requirePerm('settings.manage'), upload.single('file'), async (req, res) => {
  if (!req.file) throw badRequest('Choose an image');
  const s = await storeImage(req.file.buffer, 'company');
  const before = await getSettings();
  await setSetting('company', { ...before.company, logoKey: s.key });
  await audit(req, { action: 'COMPANY_LOGO_CHANGED', docType: 'SETTINGS', oldValue: { logoKey: before.company.logoKey }, newValue: { logoKey: s.key } });
  res.json(await getSettings());
});

// Approval workflow (configurable levels)
r.get('/approval-steps', async (_req, res) => {
  res.json(await prisma.approvalStep.findMany({ where: { docType: 'PR' }, orderBy: { level: 'asc' } }));
});

r.put('/approval-steps', requirePerm('settings.manage'), async (req, res) => {
  const body = z.object({
    steps: z.array(z.object({
      name: z.string().trim().min(1), roleCode: z.enum(['STORE_MANAGER', 'PROCUREMENT', 'APPROVER', 'ADMIN']),
      minTotal: z.coerce.number().min(0).nullish(), active: z.boolean().default(true),
    })).max(10),
  }).parse(req.body);
  const inFlight = await prisma.purchaseRequisition.count({ where: { status: { in: ['SUBMITTED', 'PENDING_APPROVAL'] } } });
  if (inFlight) throw badRequest(`${inFlight} PR(s) are waiting for approval. Finish or return them before changing the workflow.`);
  const before = await prisma.approvalStep.findMany({ where: { docType: 'PR' }, orderBy: { level: 'asc' } });
  await withTx(async (tx) => {
    await tx.approvalStep.deleteMany({ where: { docType: 'PR' } });
    await tx.approvalStep.createMany({ data: body.steps.map((s, i) => ({ docType: 'PR', level: i + 1, name: s.name, roleCode: s.roleCode, minTotal: s.minTotal ?? null, active: s.active })) });
    await audit(req, { action: 'APPROVAL_WORKFLOW_CHANGED', docType: 'SETTINGS', oldValue: before.map((s) => ({ level: s.level, name: s.name, role: s.roleCode, minTotal: s.minTotal })), newValue: body.steps }, tx);
  });
  res.json(await prisma.approvalStep.findMany({ where: { docType: 'PR' }, orderBy: { level: 'asc' } }));
});

// Document numbering status (read-only: numbers are allocated atomically)
r.get('/numbering', requirePerm('settings.manage'), async (_req, res) => {
  res.json(await prisma.documentSequence.findMany({ orderBy: [{ year: 'desc' }, { docType: 'asc' }] }));
});

export default r;
