import { Router } from 'express';
import { storage } from '../lib/storage.js';
import { notFound, badRequest } from '../lib/errors.js';

const r = Router();

// Authenticated image delivery: /api/files/images/thumbs/<sha>.webp
r.get(/^\/(images\/[A-Za-z0-9_/.-]+)$/, async (req, res) => {
  const key = (req.params as unknown as string[])[0];
  if (key.includes('..')) throw badRequest('Invalid path');
  if (!(await storage.exists(key))) throw notFound('File');
  const ext = key.split('.').pop()!.toLowerCase();
  const type = { webp: 'image/webp', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg' }[ext];
  if (!type) throw badRequest('Unsupported file type');
  res.setHeader('Content-Type', type);
  // Keys are content hashes, so they never change: cache aggressively (private: needs auth).
  res.setHeader('Cache-Control', 'private, max-age=31536000, immutable');
  storage.stream(key).pipe(res);
});

export default r;
