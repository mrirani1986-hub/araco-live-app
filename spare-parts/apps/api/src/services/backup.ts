import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import fs from 'node:fs/promises';
import path from 'node:path';
import { env } from '../env.js';
import { prisma } from '../lib/prisma.js';
import { badRequest } from '../lib/errors.js';

const run = promisify(execFile);
const bin = (name: string) => (env.pgBinDir ? path.join(env.pgBinDir, name) : name);
const backupDir = () => path.join(env.storageDir, 'backup');

function pgArgs() {
  const u = new URL(env.databaseUrl);
  const envVars = { ...process.env, PGPASSWORD: decodeURIComponent(u.password) };
  const args = ['-h', u.hostname, '-p', u.port || '5432', '-U', decodeURIComponent(u.username)];
  return { args, envVars, db: u.pathname.slice(1).split('?')[0] };
}

const NAME_RE = /^backup_\d{8}_\d{6}(_[a-z0-9-]+)?$/;

/** Full backup: pg_dump (custom format) + tar of stored images/imports. */
export async function createBackup(label = '') {
  await fs.mkdir(backupDir(), { recursive: true });
  const ts = new Date().toISOString().replace(/[-:]/g, '').replace('T', '_').slice(0, 15);
  const name = `backup_${ts}${label ? '_' + label.toLowerCase().replace(/[^a-z0-9-]+/g, '-').slice(0, 30) : ''}`;
  const dir = path.join(backupDir(), name);
  await fs.mkdir(dir);
  const { args, envVars, db } = pgArgs();
  await run(bin('pg_dump'), [...args, '-Fc', '--no-owner', '-f', path.join(dir, 'database.dump'), db], { env: envVars, maxBuffer: 1 << 26 });
  await run('tar', ['-czf', path.join(dir, 'files.tar.gz'), '-C', env.storageDir, 'images', 'imports'], { maxBuffer: 1 << 26 });
  const stats = await Promise.all(['database.dump', 'files.tar.gz'].map((f) => fs.stat(path.join(dir, f))));
  const manifest = {
    name, createdAt: new Date().toISOString(),
    counts: {
      parts: await prisma.part.count(), purchaseOrders: await prisma.purchaseOrder.count(), purchaseRequisitions: await prisma.purchaseRequisition.count(),
      inventoryTransactions: await prisma.inventoryTransaction.count(), auditLogs: await prisma.auditLog.count(),
    },
    bytes: { database: stats[0].size, files: stats[1].size },
  };
  await fs.writeFile(path.join(dir, 'manifest.json'), JSON.stringify(manifest, null, 2));
  return manifest;
}

export async function listBackups() {
  await fs.mkdir(backupDir(), { recursive: true });
  const names = (await fs.readdir(backupDir())).filter((n) => NAME_RE.test(n)).sort().reverse();
  const out = [];
  for (const n of names) {
    try { out.push(JSON.parse(await fs.readFile(path.join(backupDir(), n, 'manifest.json'), 'utf8'))); } catch { /* incomplete backup */ }
  }
  return out;
}

export function backupPath(name: string, file: 'database.dump' | 'files.tar.gz') {
  if (!NAME_RE.test(name)) throw badRequest('Invalid backup name');
  return path.join(backupDir(), name, file);
}

/**
 * Restores a backup. A safety backup of the current state is taken first, so
 * a restore can always be undone.
 */
export async function restoreBackup(name: string) {
  const dump = backupPath(name, 'database.dump');
  await fs.access(dump).catch(() => { throw badRequest('Backup not found'); });
  const safety = await createBackup('before-restore');
  await prisma.$disconnect();
  const { args, envVars, db } = pgArgs();
  await run(bin('pg_restore'), [...args, '--clean', '--if-exists', '--no-owner', '--single-transaction', '-d', db, dump], { env: envVars, maxBuffer: 1 << 26 });
  const files = backupPath(name, 'files.tar.gz');
  if (await fs.stat(files).catch(() => null)) await run('tar', ['-xzf', files, '-C', env.storageDir], { maxBuffer: 1 << 26 });
  await prisma.$connect();
  return { restored: name, safetyBackup: safety.name };
}
