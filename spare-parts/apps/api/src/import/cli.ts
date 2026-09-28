import { prisma } from '../lib/prisma.js';
import { seedBase } from './seed.js';
import { importSourceWorkbook } from './source.js';

// Usage: npm run import:source [-- --dry-run]
const dryRun = process.argv.includes('--dry-run');
try {
  await seedBase();
  const res = await importSourceWorkbook(null, { dryRun });
  console.log(JSON.stringify({ dryRun, ...res }, null, 2));
} catch (e) {
  console.error(e);
  process.exitCode = 1;
} finally {
  await prisma.$disconnect();
}
