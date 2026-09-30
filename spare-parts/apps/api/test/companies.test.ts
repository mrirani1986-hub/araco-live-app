/** Several companies: PRs and POs are raised for a company and print its letterhead. */
import { beforeAll, describe, expect, it } from 'vitest';
import { adminClient, makeUser, type Client } from './helpers.js';
import { prisma } from '../src/lib/prisma.js';
import { documentCompany } from '../src/lib/companies.js';

let admin: Client, requester: Client, buyer: Client;
let main: { id: number; name: string };
let skyline: { id: number; name: string; code: string };
let partId: number;
let supplierId: number;

beforeAll(async () => {
  admin = await adminClient();
  requester = await makeUser(admin, 'REQUESTER');
  buyer = await makeUser(admin, 'PROCUREMENT');
  partId = (await prisma.part.findFirstOrThrow({ where: { partNumber: 'E1003141' } })).id;
  const s = await buyer.post('/api/suppliers', { name: 'Skyline test supplier' });
  expect(s.status).toBe(201);
  supplierId = s.body.id;
});

describe('Companies', () => {
  it('adds a second company; the main company stays first', async () => {
    const before = (await admin.get('/api/settings/companies')).body;
    expect(before[0].isMain).toBe(true);
    main = before[0];
    const r = await admin.post('/api/settings/companies', { name: 'Skyline Contracting', address: 'Riyadh', phone: '+966 11 111 1111' });
    expect(r.status).toBe(201);
    expect(r.body).toMatchObject({ name: 'Skyline Contracting', code: 'SKYLINECONTR', isMain: false, address: 'Riyadh' });
    skyline = r.body;
    expect((await admin.post('/api/settings/companies', { name: 'skyline contracting' })).status).toBe(400); // no duplicates
    expect((await requester.post('/api/settings/companies', { name: 'Other' })).status).toBe(403);
    const lookups = (await requester.get('/api/lookups')).body.companies;
    expect(lookups.map((c: { id: number }) => c.id)).toEqual([main.id, skyline.id]);
    expect((await prisma.auditLog.count({ where: { action: 'COMPANY_CREATED', docNumber: skyline.code } }))).toBe(1);
  });

  it('edits the other company; saving the main company settings does not rename it', async () => {
    const r = await admin.put(`/api/settings/companies/${skyline.id}`, { name: 'Skyline Contracting', address: 'Jeddah', taxNumber: '300000000000003' });
    expect(r.status).toBe(200);
    expect(r.body.address).toBe('Jeddah');
    expect((await admin.put(`/api/settings/companies/${main.id}`, { name: 'X' })).status).toBe(400);
    const s = (await admin.get('/api/settings')).body;
    expect((await admin.put('/api/settings', { company: { ...s.company } })).status).toBe(200);
    expect((await prisma.company.findUniqueOrThrow({ where: { id: skyline.id } })).name).toBe('Skyline Contracting');
    const letterhead = await documentCompany(skyline.id);
    expect(letterhead).toMatchObject({ name: 'Skyline Contracting', address: 'Jeddah', taxNumber: '300000000000003' });
    expect((await documentCompany(main.id)).name).toBe(s.company.name);
  });

  it('raises a PR for the company; its PO is for the same company', async () => {
    await requester.post('/api/cart', { partId, quantity: 2 });
    const pr = await requester.post('/api/cart/checkout', { companyId: skyline.id });
    expect(pr.status).toBe(201);
    expect(pr.body.company.name).toBe('Skyline Contracting');
    // a PR without a company is for the main company
    await requester.post('/api/cart', { partId, quantity: 1 });
    const other = await requester.post('/api/cart/checkout', {});
    expect(other.body.companyId).toBe(main.id);
    expect((await requester.post('/api/cart', { partId, quantity: 1 })).status).toBe(201);
    expect((await requester.post('/api/cart/checkout', { companyId: 999999 })).status).toBe(400);
    await requester.del('/api/cart');

    const list = (await admin.get(`/api/prs?companyId=${skyline.id}`)).body.items;
    expect(list.map((p: { id: number }) => p.id)).toContain(pr.body.id);
    expect(list.map((p: { id: number }) => p.id)).not.toContain(other.body.id);

    expect((await requester.post(`/api/prs/${pr.body.id}/submit`, {})).status).toBe(200);
    for (let i = 0; i < 5; i++) {
      const cur = (await admin.get(`/api/prs/${pr.body.id}`)).body;
      if (cur.status === 'APPROVED') break;
      expect((await admin.post(`/api/prs/${pr.body.id}/approve`, {})).status).toBe(200);
    }
    const line = (await admin.get(`/api/prs/${pr.body.id}`)).body.items[0];
    // the PR's company wins over one sent with the request
    const pos = await buyer.post(`/api/pos/from-pr/${pr.body.id}`, { companyId: main.id, lines: [{ prItemId: line.id, supplierId, quantity: 2, unitPrice: 10 }] });
    expect(pos.status).toBe(201);
    expect(pos.body[0].company.name).toBe('Skyline Contracting');
    const byCompany = (await buyer.get(`/api/pos?companyId=${skyline.id}`)).body.items;
    expect(byCompany.map((p: { id: number }) => p.id)).toEqual([pos.body[0].id]);
  });

  it('creates a PO without a PR for a chosen company', async () => {
    const r = await buyer.post('/api/pos', { supplierId, companyId: skyline.id, lines: [{ partId, quantity: 1, unitPrice: 5 }] });
    expect(r.status).toBe(201);
    expect(r.body.companyId).toBe(skyline.id);
    const d = await buyer.post('/api/pos', { supplierId, lines: [{ partId, quantity: 1, unitPrice: 5 }] });
    expect(d.body.companyId).toBe(main.id);
  });
});
