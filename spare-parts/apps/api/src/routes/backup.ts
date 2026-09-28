import { Router } from 'express';
import { z } from 'zod';
import { requirePerm } from '../lib/auth.js';
import { audit } from '../lib/audit.js';
import { badRequest } from '../lib/errors.js';
import { backupPath, createBackup, listBackups, restoreBackup } from '../services/backup.js';

const r = Router();
r.use(requirePerm('backup.run'));

r.get('/', async (_req, res) => res.json(await listBackups()));

r.post('/', async (req, res) => {
  const body = z.object({ label: z.string().max(30).optional() }).parse(req.body ?? {});
  const m = await createBackup(body.label);
  await audit(req, { action: 'BACKUP_CREATED', docType: 'BACKUP', docNumber: m.name, newValue: m });
  res.status(201).json(m);
});

r.get('/:name/:file', async (req, res) => {
  const file = String(req.params.file);
  if (file !== 'database.dump' && file !== 'files.tar.gz') throw badRequest('Unknown file');
  await audit(req, { action: 'BACKUP_DOWNLOADED', docType: 'BACKUP', docNumber: `${req.params.name}/${file}` });
  res.download(backupPath(String(req.params.name), file));
});

r.post('/:name/restore', async (req, res) => {
  const name = String(req.params.name);
  const body = z.object({ confirm: z.string() }).parse(req.body);
  if (body.confirm !== name) throw badRequest('Type the backup name to confirm the restore');
  const result = await restoreBackup(name);
  // Written after the restore so it is not rolled back by it.
  await audit(req, { action: 'BACKUP_RESTORED', docType: 'BACKUP', docNumber: name, newValue: result });
  res.json(result);
});

export default r;
