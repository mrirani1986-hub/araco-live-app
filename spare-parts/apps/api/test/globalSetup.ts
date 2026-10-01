import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const TEST_DB = process.env.TEST_DATABASE_URL ?? 'postgresql://araco:araco_dev@localhost:5432/araco_spares_test';

/** Fresh test database + real data imported from the original workbook. */
export default async function setup() {
  Object.assign(process.env, {
    DATABASE_URL: TEST_DB, NODE_ENV: 'test', JWT_SECRET: 'test_secret_0123456789abcdefghijklmnopqrstuvwxyz',
    STORAGE_DIR: '../../storage-test', ADMIN_USERNAME: 'admin', ADMIN_PASSWORD: 'Admin#Test2026',
  });
  const storageTest = path.resolve(import.meta.dirname, '../../../storage-test');
  fs.rmSync(storageTest, { recursive: true, force: true });
  execSync('npx prisma migrate reset --force --skip-seed --skip-generate', { stdio: 'inherit', env: process.env, cwd: path.resolve(import.meta.dirname, '..') });
  const { seedBase } = await import('../src/import/seed.js');
  const { importSourceWorkbook } = await import('../src/import/source.js');
  const { prisma } = await import('../src/lib/prisma.js');
  await seedBase();
  const res = await importSourceWorkbook(null);
  console.log('Test data imported from workbook:', res.counts);
  const { importImerCatalogues } = await import('../src/import/imer.js');
  for (const [book, r] of Object.entries(await importImerCatalogues(null))) console.log(`Test data imported from ${book}:`, r.counts);
  const { importDtCatalogue } = await import('../src/import/dt.js');
  console.log('Test data imported from the DT catalogue:', (await importDtCatalogue(null)).counts);
  const { importFleet } = await import('../src/import/fleet.js');
  console.log('Trucks imported:', (await importFleet(null)).added);
  await prisma.$disconnect();
}
