import { beforeAll, describe, expect, it } from 'vitest';
import { adminClient, client, makeUser, type Client } from './helpers.js';
import { prisma } from '../src/lib/prisma.js';
import request from 'supertest';
import { app } from './helpers.js';
import sharp from 'sharp';
import { loadPr } from '../src/services/pr.js';
import { prSignatureBoxes } from '../src/pdf/documents.js';
import { prTotals } from '../src/lib/money.js';

let admin: Client, requester: Client, requester2: Client, viewer: Client, buyer: Client, storeman: Client, approver: Client;
let partId: number;

beforeAll(async () => {
  admin = await adminClient();
  requester = await makeUser(admin, 'REQUESTER');
  requester2 = await makeUser(admin, 'REQUESTER');
  viewer = await makeUser(admin, 'VIEWER');
  buyer = await makeUser(admin, 'PROCUREMENT');
  storeman = await makeUser(admin, 'STORE_MANAGER');
  approver = await makeUser(admin, 'APPROVER');
  partId = (await prisma.part.findUniqueOrThrow({ where: { partNumber: 'E22110' } })).id;
});

describe('Authentication', () => {
  it('rejects anonymous requests and bad passwords', async () => {
    expect((await client().get('/api/parts')).status).toBe(401);
    expect((await client().post('/api/auth/login', { username: 'admin', password: 'wrong' })).status).toBe(401);
  });
  it('requires the anti-CSRF header on writes', async () => {
    const r = await request(app).post('/api/auth/login').send({ username: 'admin', password: 'x' });
    expect(r.status).toBe(403);
  });
  it('rejects weak passwords', async () => {
    expect((await admin.post('/api/users', { username: 'weakpw', fullName: 'W', password: 'short', roles: ['VIEWER'] })).status).toBe(400);
  });
  it('deactivated users lose access immediately', async () => {
    const u = await makeUser(admin, 'VIEWER');
    const me = (await u.get('/api/auth/me')).body;
    await admin.patch(`/api/users/${me.id}`, { active: false });
    expect((await u.get('/api/parts')).status).toBe(401);
  });
});

describe('Role-based permissions', () => {
  it('REQUESTER: create PR, sees only own PRs; cannot approve, create PO, adjust stock or manage suppliers', async () => {
    const pr = (await requester.post('/api/prs', { lines: [{ partId, quantity: 2 }] })).body;
    expect(pr.prNumber).toBeTruthy();
    expect((await requester2.get(`/api/prs/${pr.id}`)).status).toBe(403);
    const list = (await requester2.get('/api/prs')).body.items;
    expect(list.some((p: { id: number }) => p.id === pr.id)).toBe(false);
    expect((await requester2.patch(`/api/prs/${pr.id}`, { reason: 'hijack' })).status).toBe(403);
    expect((await requester.post('/api/pos', { supplierId: 1, lines: [] })).status).toBe(403);
    expect((await requester.post('/api/inventory/adjust', { reason: 'x', lines: [] })).status).toBe(403);
    expect((await requester.post('/api/suppliers', { name: 'X' })).status).toBe(403);
    expect((await requester.get('/api/users')).status).toBe(403);
    expect((await requester.get('/api/backups')).status).toBe(403);
    // self-approval is impossible
    await requester.post(`/api/prs/${pr.id}/submit`, {});
    expect((await requester.post(`/api/prs/${pr.id}/approve`, {})).status).toBe(403);
  });

  it('PROCUREMENT: manages suppliers, sees approved PRs, creates POs; cannot receive goods or manage users', async () => {
    expect((await buyer.post('/api/suppliers', { name: 'Perm Test Supplier' })).status).toBe(201);
    expect((await buyer.post('/api/pos/1/receive', { warehouseId: 1, lines: [{ poItemId: 1, receivedQty: 1 }] })).status).toBe(403);
    expect((await buyer.get('/api/users')).status).toBe(403);
    expect((await buyer.get('/api/prs?status=APPROVED')).status).toBe(200);
  });

  it('APPROVER: approves PRs at its step only; cannot create POs', async () => {
    const pr = (await requester.post('/api/prs', { lines: [{ partId, quantity: 1 }] })).body;
    await requester.post(`/api/prs/${pr.id}/submit`, {});
    expect((await approver.post(`/api/prs/${pr.id}/approve`, {})).status).toBe(403); // level 1 is store manager
    expect((await storeman.post(`/api/prs/${pr.id}/reject`, {})).status).toBe(400); // comment required
    const rej = await storeman.post(`/api/prs/${pr.id}/reject`, { comment: 'Not needed' });
    expect(rej.body.status).toBe('REJECTED');
    expect((await approver.post('/api/pos', { supplierId: 1, lines: [{ partId, quantity: 1, unitPrice: 1 }] })).status).toBe(403);
  });

  it('RETURN sends the PR back to the requester for correction (audited)', async () => {
    const pr = (await requester.post('/api/prs', { lines: [{ partId, quantity: 1 }] })).body;
    await requester.post(`/api/prs/${pr.id}/submit`, {});
    const r = await storeman.post(`/api/prs/${pr.id}/return`, { comment: 'Please add equipment' });
    expect(r.body.status).toBe('DRAFT');
    const e = await requester.patch(`/api/prs/${pr.id}`, { reason: 'For mixer', lines: [{ partId, quantity: 3, equipmentId: 1 }] });
    expect(e.status).toBe(200);
    const log = await prisma.auditLog.findFirstOrThrow({ where: { docType: 'PR', docId: pr.id, action: 'PR_EDITED' } });
    expect(JSON.stringify(log.oldValue)).toContain('"qty":1');
    expect(JSON.stringify(log.newValue)).toContain('"qty":3');
  });

  it('VIEWER: read-only', async () => {
    expect((await viewer.get('/api/parts?q=seal')).status).toBe(200);
    expect((await viewer.post('/api/cart', { partId, quantity: 1 })).status).toBe(403);
    expect((await viewer.patch(`/api/parts/${partId}`, { notes: 'x' })).status).toBe(403);
    expect((await viewer.get('/api/parts/export?format=csv')).status).toBe(403);
  });

  it('STORE_MANAGER: inventory and receiving; cannot create POs or manage suppliers', async () => {
    const wh = await prisma.warehouse.findFirstOrThrow({ include: { locations: true } });
    expect((await storeman.put('/api/inventory/levels', { partId, locationId: wh.locations[0].id, minStock: 2, maxStock: 6, reorderLevel: 3 })).status).toBe(200);
    expect((await storeman.post('/api/pos', { supplierId: 1, lines: [{ partId, quantity: 1, unitPrice: 1 }] })).status).toBe(403);
    expect((await storeman.post('/api/suppliers', { name: 'nope' })).status).toBe(403);
  });

  it('ADMIN can do everything', async () => {
    for (const url of ['/api/users', '/api/audit', '/api/backups', '/api/settings/numbering', '/api/imports']) expect((await admin.get(url)).status).toBe(200);
  });
});

describe('Revising an approved PR', () => {
  it('goes back to draft with a reason, is audited, and needs every approval again', async () => {
    await requester.post('/api/cart', { partId, quantity: 3 });
    const pr = (await requester.post('/api/cart/checkout', {})).body;
    await requester.post(`/api/prs/${pr.id}/submit`, {});
    for (let i = 0; i < 5 && (await admin.get(`/api/prs/${pr.id}`)).body.status !== 'APPROVED'; i++) await admin.post(`/api/prs/${pr.id}/approve`, {});
    expect((await admin.get(`/api/prs/${pr.id}`)).body.status).toBe('APPROVED');

    expect((await requester.patch(`/api/prs/${pr.id}`, { project: 'changed' })).status).toBe(409); // still locked
    expect((await requester.post(`/api/prs/${pr.id}/revise`, {})).status).toBe(400); // reason required
    expect((await requester2.post(`/api/prs/${pr.id}/revise`, { comment: 'x' })).status).toBe(403); // not the requester
    const r = await requester.post(`/api/prs/${pr.id}/revise`, { comment: 'Quantity changed' });
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ status: 'DRAFT', version: pr.version + 1 });
    expect(r.body.approvals.at(-1)).toMatchObject({ action: 'REVISED', comment: 'Quantity changed' });
    expect(await prisma.auditLog.count({ where: { action: 'PR_REVISED', docId: pr.id } })).toBe(1);

    expect((await requester.patch(`/api/prs/${pr.id}`, { project: 'changed' })).status).toBe(200);
    const sub = await requester.post(`/api/prs/${pr.id}/submit`, {});
    expect(sub.body.status).toBe('SUBMITTED'); // approvals start again
    expect((await requester.post(`/api/prs/${pr.id}/revise`, { comment: 'x' })).status).toBe(409); // only approved PRs
  });
});

describe('Signatures on the PR', () => {
  const png = () => sharp({ create: { width: 300, height: 80, channels: 4, background: { r: 255, g: 255, b: 255, alpha: 0 } } })
    .composite([{ input: Buffer.from('<svg width="300" height="80"><path d="M10 60 C 80 0, 120 90, 290 20" stroke="black" stroke-width="4" fill="none"/></svg>') }]).png().toBuffer();
  const boxes = async (id: number) => { const pr = await loadPr(id); return prSignatureBoxes(pr, prTotals(pr.items, pr.taxRate).grandTotal); };

  it('each user uploads their own signature (image only, audited) and can remove it', async () => {
    const u = await makeUser(admin, 'REQUESTER');
    expect((await u.agent.post('/api/auth/signature').set('x-requested-with', 'araco-sp').attach('file', Buffer.from('not an image'), 'sig.png')).status).toBe(400);
    const r = await u.agent.post('/api/auth/signature').set('x-requested-with', 'araco-sp').attach('file', await png(), 'sig.png');
    expect(r.status).toBe(200);
    const me = (await u.get('/api/auth/me')).body;
    expect(me.signatureKey).toBe(r.body.signatureKey);
    expect((await u.get(`/api/files/${me.signatureKey}`)).status).toBe(200);
    expect(await prisma.auditLog.count({ where: { action: 'SIGNATURE_CHANGED', docId: me.id } })).toBe(1);
    expect((await u.del('/api/auth/signature')).body.signatureKey).toBeNull();
    expect((await u.get('/api/auth/me')).body.signatureKey).toBeNull();
  });

  it('the PR PDF signs the requester box on submit and each level box on its approval, for the current round only', async () => {
    const req = await makeUser(admin, 'REQUESTER', 'Signing Requester');
    const sm = await makeUser(admin, 'STORE_MANAGER', 'Signing Store Manager');
    await req.agent.post('/api/auth/signature').set('x-requested-with', 'araco-sp').attach('file', await png(), 'sig.png');
    const reqKey = (await req.get('/api/auth/me')).body.signatureKey;
    const pr = (await req.post('/api/prs', { lines: [{ partId, quantity: 1 }] })).body;
    let b = await boxes(pr.id);
    expect(b[0].label).toBe('Requested by');
    expect(b.every((x) => !x.name)).toBe(true); // draft: nothing signed
    await req.post(`/api/prs/${pr.id}/submit`, {});
    b = await boxes(pr.id);
    expect(b[0]).toMatchObject({ name: 'Signing Requester', signatureKey: reqKey });
    expect(b.slice(1).every((x) => !x.name)).toBe(true);
    await sm.post(`/api/prs/${pr.id}/approve`, {});
    b = await boxes(pr.id);
    expect(b[1]).toMatchObject({ name: 'Signing Store Manager', signatureKey: null }); // no signature picture: name and date only
    // returned and submitted again: the earlier approval no longer signs
    expect((await admin.post(`/api/prs/${pr.id}/return`, { comment: 'Add the machine' })).body.status).toBe('DRAFT');
    await req.post(`/api/prs/${pr.id}/submit`, {});
    b = await boxes(pr.id);
    expect(b[0].name).toBe('Signing Requester');
    expect(b.slice(1).every((x) => !x.name)).toBe(true);
    const pdf = await req.get(`/api/prs/${pr.id}/pdf`);
    expect(pdf.status).toBe(200);
    expect(pdf.headers['content-type']).toContain('pdf');
  });
});
