import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import {
  checkLoginThrottle, clearLoginFailures, clearSession, hashPassword, issueSession, recordLoginFailure, requireAuth,
  validatePasswordStrength, verifyPassword,
} from '../lib/auth.js';
import { HttpError } from '../lib/errors.js';
import { audit } from '../lib/audit.js';

const r = Router();

r.post('/login', async (req, res) => {
  const body = z.object({ username: z.string().trim().min(1), password: z.string().min(1) }).parse(req.body);
  const key = `${body.username.toLowerCase()}|${req.ip}`;
  checkLoginThrottle(key);
  const user = await prisma.user.findUnique({ where: { username: body.username.toLowerCase() } });
  if (!user || !user.active || !(await verifyPassword(body.password, user.passwordHash))) {
    recordLoginFailure(key);
    await audit(req, { action: 'LOGIN_FAILED', docType: 'USER', docNumber: body.username.toLowerCase() });
    throw new HttpError(401, 'Invalid username or password');
  }
  clearLoginFailures(key);
  issueSession(res, user);
  req.user = { id: user.id } as never;
  await audit(req, { action: 'LOGIN', docType: 'USER', docId: user.id, docNumber: user.username });
  res.json({ ok: true });
});

r.post('/logout', async (req, res) => {
  if (req.user) await audit(req, { action: 'LOGOUT', docType: 'USER', docId: req.user.id, docNumber: req.user.username });
  clearSession(res);
  res.json({ ok: true });
});

r.get('/me', requireAuth, (req, res) => {
  const u = req.user!;
  res.json({ id: u.id, username: u.username, fullName: u.fullName, department: u.department, roles: u.roles, permissions: [...u.permissions] });
});

r.post('/change-password', requireAuth, async (req, res) => {
  const body = z.object({ currentPassword: z.string(), newPassword: z.string() }).parse(req.body);
  const user = await prisma.user.findUniqueOrThrow({ where: { id: req.user!.id } });
  if (!(await verifyPassword(body.currentPassword, user.passwordHash))) throw new HttpError(400, 'Current password is incorrect');
  validatePasswordStrength(body.newPassword);
  const updated = await prisma.user.update({
    where: { id: user.id },
    data: { passwordHash: await hashPassword(body.newPassword), tokenVersion: { increment: 1 } },
  });
  issueSession(res, updated);
  await audit(req, { action: 'PASSWORD_CHANGED', docType: 'USER', docId: user.id, docNumber: user.username });
  res.json({ ok: true });
});

export default r;
