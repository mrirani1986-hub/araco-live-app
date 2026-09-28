// Opens every page as administrator and exercises the main dialogs; fails on any
// JavaScript error, failed API call (5xx) or error state shown on the page.
// Usage: BASE_URL=http://localhost:4200 ADMIN_PASSWORD=... node e2e/smoke.e2e.mjs
import { chromium } from 'playwright-core';
import assert from 'node:assert/strict';

const BASE = process.env.BASE_URL ?? 'http://localhost:4200';
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH ?? '/opt/pw-browsers/chromium', args: ['--no-sandbox'] });
const ctx = await browser.newContext({ baseURL: BASE, viewport: { width: 1440, height: 900 } });
const page = await ctx.newPage();
const problems = [];
page.on('pageerror', (e) => problems.push(`JS error: ${e.message}`));
page.on('response', (r) => { if (r.status() >= 500) problems.push(`${r.status()} ${r.url()}`); });

await page.goto('/login');
await page.getByLabel('Username').fill('admin');
await page.getByLabel('Password').fill(process.env.ADMIN_PASSWORD);
await page.getByRole('button', { name: 'Sign in' }).click();
await page.getByRole('heading', { name: 'Dashboard' }).waitFor();

const pages = [
  ['/', 'Dashboard'], ['/parts', 'Spare Parts Catalogue'], ['/machines', 'Machines & assemblies'], ['/inventory', 'Inventory'],
  ['/inventory?tab=transactions', 'Inventory'], ['/inventory?tab=suggested', 'Inventory'], ['/inventory?tab=warehouses', 'Inventory'],
  ['/requests', 'Requests / Purchase requisitions'], ['/requests?tab=approvals', 'Requests / Purchase requisitions'],
  ['/purchase-orders', 'Purchase orders'], ['/purchase-orders/new', 'New purchase order'], ['/receiving', 'Goods receiving'],
  ['/receiving?tab=grns', 'Goods receiving'], ['/suppliers', 'Suppliers'], ['/reports', 'Reports'], ['/users', 'Users & roles'],
  ['/settings?tab=company', 'Settings'], ['/settings?tab=workflow', 'Settings'], ['/settings?tab=numbering', 'Settings'],
  ['/settings?tab=import', 'Settings'], ['/settings?tab=backup', 'Settings'], ['/audit', 'Audit log'], ['/cart', 'Spare parts request'],
];
for (const [url, heading] of pages) {
  await page.goto(url);
  await page.getByRole('heading', { name: heading, exact: true }).waitFor();
  await page.waitForLoadState('networkidle');
  assert.equal(await page.getByText('Something went wrong').count(), 0, `error state on ${url}`);
  console.log(`✔ ${url}`);
}
// Dialogs
await page.goto('/inventory');
for (const b of ['Issue', 'Return', 'Transfer', 'Adjustment']) {
  await page.getByRole('button', { name: b, exact: true }).click();
  await page.getByRole('dialog').waitFor();
  await page.getByRole('dialog').getByPlaceholder(/Add a part/).fill('E1001286');
  await page.getByRole('dialog').getByText('V BELT').first().click();
  await page.getByRole('dialog').getByRole('button', { name: 'Cancel' }).click();
}
console.log('✔ inventory dialogs');
await page.goto('/parts');
await page.getByRole('button', { name: 'New part' }).click();
await page.getByRole('dialog').getByText('New part').waitFor();
await page.getByRole('dialog').getByRole('button', { name: 'Cancel' }).click();
await page.getByRole('button', { name: 'Table' }).click();
await page.getByRole('button', { name: 'Filters' }).click();
console.log('✔ part form, table view');
await page.goto('/suppliers');
await page.getByRole('button', { name: 'New supplier' }).click();
await page.getByRole('dialog').getByRole('button', { name: 'Cancel' }).click();
await page.goto('/users');
await page.getByRole('tab', { name: 'Role permissions' }).click();
await page.getByText('parts.view').waitFor();
console.log('✔ supplier form, role matrix');
await page.goto('/machines');
await page.getByRole('button', { name: /CEMENT SILO/ }).click();
await page.getByText('CEMENT SILO AIR FILTER').first().waitFor();
console.log('✔ machine browser');
await page.getByRole('button', { name: /IMER LOGIK 2WXL/ }).click();
await page.getByText('10090213', { exact: true }).waitFor();
await page.getByText('9 - ELECTROCOMPRESSOR B6000').waitFor();
assert.ok(await page.getByText('Not sold separately').count() > 0, 'info-only lines are shown');
await page.getByRole('button', { name: 'Add another plant of this model' }).click();
await page.getByRole('dialog').getByLabel(/^Serial number/).waitFor();
await page.getByRole('dialog').getByRole('button', { name: 'Cancel' }).click();
await page.getByRole('button', { name: 'Edit', exact: true }).click();
await page.getByRole('dialog').getByRole('button', { name: 'Cancel' }).click();
console.log('✔ IMER plant catalogue, copy & edit dialogs');
await browser.close();
if (problems.length) { console.error(problems.join('\n')); process.exit(1); }
console.log('\nSMOKE TEST PASSED — all pages load without errors');
