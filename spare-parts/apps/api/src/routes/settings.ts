import { Router } from 'express';
import multer from 'multer';
import { z } from 'zod';
import { prisma, withTx } from '../lib/prisma.js';
import { requirePerm } from '../lib/auth.js';
import { audit } from '../lib/audit.js';
import { badRequest } from '../lib/errors.js';
import { getSettings, setSetting } from '../lib/settings.js';
import { storeImage } from '../lib/storage.js';
import { idParam } from '../lib/http.js';
import { listCompanies, mainCompany } from '../lib/companies.js';

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
    const main = await mainCompany(tx);
    if (body.company?.name && main) await tx.company.update({ where: { id: main.id }, data: { name: body.company.name, address: body.company.address, phone: body.company.phone, email: body.company.email, taxNumber: body.company.taxNumber } });
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

// Companies: the main company (details above, in the settings) and the other companies PRs/POs can be raised for.
const companySchema = z.object({
  name: z.string().trim().min(1).max(200), address: z.string().trim().default(''), phone: z.string().trim().default(''),
  email: z.string().trim().default(''), taxNumber: z.string().trim().default(''),
});
const companyCode = (name: string) => name.toUpperCase().replace(/[^A-Z0-9]+/g, '').slice(0, 12) || 'COMPANY';

r.get('/companies', async (_req, res) => res.json(await listCompanies()));

r.post('/companies', requirePerm('settings.manage'), async (req, res) => {
  const body = companySchema.parse(req.body);
  if (await prisma.company.findFirst({ where: { name: { equals: body.name, mode: 'insensitive' } } })) throw badRequest(`A company called "${body.name}" already exists`);
  let code = companyCode(body.name);
  for (let n = 2; await prisma.company.findUnique({ where: { code } }); n++) code = `${companyCode(body.name).slice(0, 10)}${n}`;
  const currency = (await getSettings()).currency;
  const c = await withTx(async (tx) => {
    const c = await tx.company.create({ data: { code, currency, ...body } });
    await audit(req, { action: 'COMPANY_CREATED', docType: 'SETTINGS', docId: c.id, docNumber: c.code, newValue: body }, tx);
    return c;
  });
  res.status(201).json((await listCompanies()).find((x) => x.id === c.id));
});

async function otherCompany(id: number) {
  const main = await mainCompany();
  const c = await prisma.company.findUnique({ where: { id } });
  if (!c) throw badRequest('Company not found');
  if (c.id === main?.id) throw badRequest('The main company is edited in the Company card above');
  return c;
}

r.put('/companies/:id', requirePerm('settings.manage'), async (req, res) => {
  const before = await otherCompany(idParam(req));
  const body = companySchema.parse(req.body);
  if (await prisma.company.findFirst({ where: { id: { not: before.id }, name: { equals: body.name, mode: 'insensitive' } } })) throw badRequest(`A company called "${body.name}" already exists`);
  await withTx(async (tx) => {
    await tx.company.update({ where: { id: before.id }, data: body });
    await audit(req, { action: 'COMPANY_CHANGED', docType: 'SETTINGS', docId: before.id, docNumber: before.code,
      oldValue: { name: before.name, address: before.address, phone: before.phone, email: before.email, taxNumber: before.taxNumber }, newValue: body }, tx);
  });
  res.json((await listCompanies()).find((x) => x.id === before.id));
});

r.post('/companies/:id/logo', requirePerm('settings.manage'), upload.single('file'), async (req, res) => {
  const before = await otherCompany(idParam(req));
  if (!req.file) throw badRequest('Choose an image');
  const s = await storeImage(req.file.buffer, 'company');
  await prisma.company.update({ where: { id: before.id }, data: { logoKey: s.key } });
  await audit(req, { action: 'COMPANY_LOGO_CHANGED', docType: 'SETTINGS', docId: before.id, docNumber: before.code, oldValue: { logoKey: before.logoKey }, newValue: { logoKey: s.key } });
  res.json((await listCompanies()).find((x) => x.id === before.id));
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
