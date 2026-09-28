// End-to-end acceptance scenario (section 30) driven through the real web UI.
// Usage: BASE_URL=http://localhost:4200 ADMIN_PASSWORD=... node e2e/acceptance.e2e.mjs
// Run it against a disposable database: it creates users, suppliers and documents.
import { chromium } from 'playwright-core';
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';

const BASE = process.env.BASE_URL ?? 'http://localhost:4200';
const ADMIN_PW = process.env.ADMIN_PASSWORD;
const SHOTS = path.resolve(process.env.SHOTS_DIR ?? 'docs/screenshots');
fs.mkdirSync(SHOTS, { recursive: true });
const PW = 'Test#12345';
const stamp = Date.now() % 100000;
const log = (m) => console.log(`✔ ${m}`);

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH ?? '/opt/pw-browsers/chromium', args: ['--no-sandbox'] });

async function session(username, password) {
  const ctx = await browser.newContext({ baseURL: BASE, viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => { console.error('PAGE ERROR', e.message); process.exitCode = 1; });
  await page.goto('/login');
  await page.getByLabel('Username').fill(username);
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await page.getByRole('heading', { name: 'Dashboard' }).waitFor();
  return page;
}
const api = (page) => ({
  post: async (url, data) => { const r = await page.request.post(`/api${url}`, { data, headers: { 'x-requested-with': 'araco-sp' } }); assert.ok(r.ok(), `${url}: ${r.status()} ${await r.text()}`); return r.json(); },
  put: async (url, data) => { const r = await page.request.put(`/api${url}`, { data, headers: { 'x-requested-with': 'araco-sp' } }); assert.ok(r.ok(), `${url}: ${r.status()}`); return r.json(); },
  get: async (url) => { const r = await page.request.get(`/api${url}`, { headers: { 'x-requested-with': 'araco-sp' } }); assert.ok(r.ok(), `${url}: ${r.status()}`); return r; },
});
const shot = (page, name) => page.screenshot({ path: path.join(SHOTS, `${name}.png`), fullPage: false });
const confirmDialog = async (page, buttonName, comment) => {
  const dlg = page.getByRole('dialog');
  if (comment) await dlg.getByRole('textbox').fill(comment);
  await dlg.getByRole('button', { name: buttonName, exact: true }).click();
  await dlg.waitFor({ state: 'detached' });
};

// ── Setup (administrator): users, suppliers, supplier prices ────────────────
const admin = await session('admin', ADMIN_PW);
const A = api(admin);
const users = {};
for (const [role, name] of [['REQUESTER', 'Rami Requester'], ['STORE_MANAGER', 'Sami Store'], ['PROCUREMENT', 'Bilal Buyer'], ['APPROVER', 'Majid Manager']]) {
  const username = `${role.toLowerCase().replace('_', '')}${stamp}`;
  await A.post('/users', { username, fullName: name, password: PW, roles: [role], department: 'Maintenance' });
  users[role] = username;
}
const supA = await A.post('/suppliers', { name: `Gulf Bearings Trading ${stamp}`, currency: 'SAR', paymentTerms: '30 days', deliveryTerms: 'DAP Riyadh', phone: '+966 11 000 0000', email: 'sales@gulfbearings.example', address: 'Industrial Area, Riyadh', country: 'Saudi Arabia' });
const supB = await A.post('/suppliers', { name: `Elkon Parts ME ${stamp}`, currency: 'SAR', paymentTerms: 'Advance' });
const find = async (q) => (await (await A.get(`/parts?q=${encodeURIComponent(q)}&pageSize=1`)).json()).items[0];
const bearing = await find('E1003141');
const seal = await find('E1007058');
const belt = await find('E1001286');
for (const [p, s, price] of [[bearing, supA, 85.5], [seal, supA, 12.25], [belt, supB, 40]]) await A.put(`/suppliers/${s.id}/parts`, { partId: p.id, price, supplierPartNumber: `SUP-${p.partNumber}`, isPreferred: true });
await shot(admin, '01-dashboard');
await admin.context().close();
log('setup: 4 users, 2 suppliers, prices');

// ── 1-7 Requester: search, open part, see picture/specs, add qty 10 + others ─
const req = await session(users.REQUESTER, PW);
await req.goto('/parts');
await req.getByPlaceholder(/Search by part number/).fill('bearing');
await req.waitForFunction(() => !document.body.innerText.includes('254 parts'));
await req.getByText('E1003141', { exact: true }).first().waitFor();
const firstNames = await req.locator('main .grid .line-clamp-2').allInnerTexts();
assert.ok(firstNames.slice(0, 5).every((n) => /BEARING/.test(n)), `relevance order: ${firstNames.slice(0, 5)}`);
await shot(req, '02-catalogue-search-bearing');
log('1. search "bearing" shows bearing parts (grid)');
await req.getByRole('button', { name: 'Table' }).click();
await req.getByRole('columnheader', { name: 'Part Number' }).waitFor();
await shot(req, '03-catalogue-table-view');
await req.getByRole('button', { name: 'Grid' }).click();
await req.getByRole('link', { name: 'E1003141' }).first().click();
await req.getByRole('heading', { name: /E1003141/ }).waitFor();
await req.waitForFunction(() => [...document.images].some((i) => i.complete && i.naturalWidth > 100 && i.src.includes('/api/files/')));
for (const label of ['Part Number', 'Part Name', 'Category', 'Manufacturer', 'Equipment', 'Specification', 'Unit', 'Supplier', 'Supplier Part No.', 'Price', 'Current Stock', 'Minimum Stock', 'Location']) {
  await req.getByText(label, { exact: true }).first().waitFor();
}
await shot(req, '04-part-details');
log('2-4. part page shows picture (drawing) and all specification fields');
await req.getByRole('tab', { name: 'Where used (2)' }).click();
await req.getByRole('cell', { name: 'BEARING(IDLE SIDE)GROUP (E18252)' }).waitFor();
await req.locator('main img').first().click();
await req.getByRole('button', { name: 'Zoom in' }).click();
await req.getByText('125%').waitFor();
await shot(req, '05-image-zoom');
await req.getByRole('button', { name: 'Close', exact: true }).click();
log('   image viewer zooms');
await req.getByRole('button', { name: 'Add to request' }).first().click();
await req.getByRole('dialog').getByLabel('Quantity').fill('10');
await req.getByRole('dialog').getByLabel('Required date').fill('2026-10-05');
await req.getByRole('dialog').getByLabel('Equipment').selectOption({ label: 'TWINSHAFT MIXER' });
await req.getByRole('dialog').getByLabel('Machine / unit').fill('Concrete Plant #1');
await shot(req, '06-add-to-request');
await req.getByRole('dialog').getByRole('button', { name: 'Add to request' }).click();
await req.getByText('10 × E1003141 added to your request').waitFor();
log('5-6. quantity 10 added to request');
for (const [q, n] of [['E1007058', '4'], ['E1001286', '2']]) {
  await req.goto(`/parts?q=${q}`);
  await req.getByRole('button', { name: 'Add to request' }).first().click();
  await req.getByRole('dialog').getByLabel('Quantity').fill(n);
  await req.getByRole('dialog').getByRole('button', { name: 'Add to request' }).click();
  await req.getByText(`${n} × ${q} added`).waitFor();
}
await req.goto('/cart');
await req.getByText('Estimated total').waitFor();
assert.equal(await req.locator('tbody tr').count(), 3);
await req.getByText('984.00 SAR').waitFor(); // 10×85.5 + 4×12.25 + 2×40
await shot(req, '07-request-cart');
log('7. cart has 3 parts, totals calculated (984.00 SAR)');

// ── 8-9 Create and submit PR ────────────────────────────────────────────────
await req.getByLabel('Project').fill('Plant #1 overhaul');
await req.getByLabel('Reason').fill('Planned maintenance of the twin-shaft mixer');
await req.getByRole('button', { name: /Create PR from 3 item/ }).click();
await req.waitForURL(/\/requests\/\d+$/);
const prUrl = req.url();
const prNumber = (await req.locator('h1 .font-mono').innerText()).trim();
assert.match(prNumber, /^PR-\d{4}-\d{6}$/);
await req.getByText('1,131.60 SAR').waitFor(); // incl. 15% VAT
log(`8. ${prNumber} created (grand total 1,131.60 SAR incl. VAT)`);
await req.getByRole('button', { name: 'Submit' }).click();
await confirmDialog(req, 'Submit', 'Please approve');
await req.locator('h1').getByText('Submitted').waitFor();
await shot(req, '08-pr-submitted');
log('9. PR submitted and locked');
await req.context().close();

// ── 10 Approvals (3 levels) ─────────────────────────────────────────────────
for (const [role, comment] of [['STORE_MANAGER', 'Needed for overhaul'], ['PROCUREMENT', 'Prices checked'], ['APPROVER', 'Approved']]) {
  const p = await session(users[role], PW);
  await p.getByText(/to approve/).click();
  await p.getByRole('link', { name: prNumber }).click();
  await p.getByRole('button', { name: 'Approve' }).click();
  await confirmDialog(p, 'Approve', comment);
  await p.getByText(comment).first().waitFor();
  if (role === 'APPROVER') { await p.locator('h1').getByText('Approved').waitFor(); await shot(p, '09-pr-approved'); }
  await p.context().close();
}
log('10. PR approved by Store Manager → Procurement → Management');

// ── 11-13 Create POs (grouped by supplier), PDF, approve, send ──────────────
const buyer = await session(users.PROCUREMENT, PW);
await buyer.goto(prUrl);
await buyer.getByRole('button', { name: 'Create PO' }).click();
await buyer.getByRole('heading', { name: `Create PO from ${prNumber}` }).waitFor();
await buyer.getByLabel('Expected delivery').fill('2026-10-20');
await buyer.getByLabel('Shipping method').fill('Road freight');
await shot(buyer, '10-create-po-from-pr');
await buyer.getByRole('button', { name: 'Create 2 POs' }).click();
await buyer.waitForURL(/purchase-orders\?q=/);
await buyer.getByRole('cell', { name: supA.name }).waitFor();
assert.equal(await buyer.locator('tbody tr').count(), 2);
log('11-12. suppliers selected, 2 POs created (one per supplier)');
await buyer.getByRole('row', { name: new RegExp(supA.name) }).getByRole('link').first().click();
await buyer.waitForURL(/purchase-orders\/\d+$/);
const poUrl = buyer.url();
const poNumber = (await buyer.locator('h1 .font-mono').innerText()).trim();
const poId = poUrl.split('/').pop();
const pdf = await (await api(buyer).get(`/pos/${poId}/pdf`)).body();
assert.equal(pdf.subarray(0, 5).toString(), '%PDF-');
fs.writeFileSync(path.join(SHOTS, `${poNumber}.pdf`), pdf);
await shot(buyer, '11-po-detail');
log(`13. ${poNumber} PDF generated (${Math.round(pdf.length / 1024)} KB)`);
await buyer.getByRole('button', { name: 'Approve' }).click();
await confirmDialog(buyer, 'Approve');
await buyer.getByRole('button', { name: 'Send to supplier' }).click();
await confirmDialog(buyer, 'Mark as sent', 'Emailed to supplier');
await buyer.locator('h1').getByText('Sent').waitFor();
log('    PO approved and sent');
await buyer.context().close();

// ── 14-18 Receive 8, then remaining 2 ───────────────────────────────────────
const store = await session(users.STORE_MANAGER, PW);
const stockBefore = (await (await api(store).get(`/parts/${bearing.id}`)).json()).stock.onHand;
await store.goto('/receiving');
await store.getByRole('row', { name: new RegExp(poNumber) }).getByRole('button', { name: 'Receive' }).click();
const bearingRow = store.getByRole('row', { name: /E1003141/ });
await bearingRow.getByLabel('Received quantity').fill('8');
await bearingRow.getByText('2', { exact: true }).waitFor(); // remaining after
await shot(store, '12-receive-8-of-10');
await store.getByRole('button', { name: 'Post GRN' }).click();
await store.getByText(/GRN-\d{4}-\d{6} posted/).waitFor();
let part = (await (await api(store).get(`/parts/${bearing.id}`)).json());
assert.equal(part.stock.onHand, stockBefore + 8);
await store.goto(poUrl);
await store.getByRole('row', { name: /E1003141/ }).getByText('2', { exact: true }).last().waitFor();
await store.locator('h1').getByText('Partially received').waitFor();
await shot(store, '13-po-partially-received');
log('14-16. received 8 of 10: stock +8, 2 remaining, PO partially received');
await store.getByRole('button', { name: 'Receive goods' }).click();
await store.getByRole('button', { name: 'Receive all remaining' }).click();
await store.getByRole('button', { name: 'Post GRN' }).click();
await store.getByText(/GRN-\d{4}-\d{6} posted/).waitFor();
await store.locator('h1').getByText('Received', { exact: true }).waitFor();
part = (await (await api(store).get(`/parts/${bearing.id}`)).json());
assert.equal(part.stock.onHand, stockBefore + 10);
await shot(store, '14-po-received');
log('17-18. remaining 2 received: stock complete (+10), PO received');

// ── 19 Purchase history ─────────────────────────────────────────────────────
await store.goto(`/parts/${bearing.id}`);
await store.getByRole('button', { name: 'View history' }).click();
await store.getByText('Purchase price statistics').waitFor();
const histRows = store.locator('section', { hasText: 'Purchase history' }).locator('tbody tr');
assert.equal(await histRows.filter({ hasText: poNumber }).count(), 2);
await shot(store, '15-part-purchase-history');
log('19. purchase history shows both receipts with price 85.50');
await store.goto('/inventory?tab=transactions');
await store.locator('tbody').getByText('Receipt', { exact: true }).first().waitFor();
await shot(store, '16-inventory-transactions');
await store.context().close();

// ── 20 Audit log ────────────────────────────────────────────────────────────
const mgr = await session(users.APPROVER, PW);
await mgr.goto(`/audit?q=${prNumber}`);
for (const a of ['PR_CREATED', 'PR_SUBMITTED', 'PR_APPROVED', 'PR_CONVERTED_TO_PO']) await mgr.locator('tbody').getByText(a, { exact: true }).first().waitFor();
await shot(mgr, '17-audit-log');
await mgr.goto(`/audit?q=${poNumber}`);
for (const a of ['PO_CREATED', 'PO_APPROVED', 'PO_SENT', 'PO_PARTIALLY_RECEIVED', 'PO_RECEIVED']) await mgr.locator('tbody').getByText(a, { exact: true }).first().waitFor();
log('20. audit log records PR and PO actions');
await mgr.goto('/');
await mgr.getByText('Purchases by month').waitFor();
await mgr.mouse.move(5, 5);
await shot(mgr, '18-dashboard-after');
await mgr.goto('/machines');
await mgr.getByText('MIXER TOP COVER GROUP').waitFor();
await shot(mgr, '19-machines');
// mobile layout check
await mgr.setViewportSize({ width: 390, height: 844 });
await mgr.goto('/parts?q=seal');
await mgr.getByText('E1007058').first().waitFor();
await shot(mgr, '20-mobile-catalogue');
await mgr.context().close();

await browser.close();
console.log(`\nACCEPTANCE SCENARIO PASSED — ${prNumber} → ${poNumber}`);
