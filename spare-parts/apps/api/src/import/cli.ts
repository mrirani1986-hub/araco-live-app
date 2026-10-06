import { prisma } from '../lib/prisma.js';
import { seedBase } from './seed.js';
import { importSourceWorkbook } from './source.js';
import { importImerCatalogues } from './imer.js';
import { importDtCatalogue } from './dt.js';
import { importFleet } from './fleet.js';
import { importSanyCatalogue } from './sany.js';

// Usage: npm run import:source [-- --dry-run]
const dryRun = process.argv.includes('--dry-run');
try {
  await seedBase();
  const res = await importSourceWorkbook(null, { dryRun });
  console.log(JSON.stringify({ dryRun, ...res }, null, 2));
  if (!dryRun) console.log(JSON.stringify({ imer: await importImerCatalogues(null) }, null, 2));
  if (!dryRun) console.log(JSON.stringify({ dt: await importDtCatalogue(null) }, null, 2));
  if (!dryRun) console.log(JSON.stringify({ fleet: await importFleet(null) }, null, 2));
  if (!dryRun) console.log(JSON.stringify({ sany: await importSanyCatalogue(null) }, null, 2));
} catch (e) {
  console.error(e);
  process.exitCode = 1;
} finally {
  await prisma.$disconnect();
}
