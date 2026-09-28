import { Router } from 'express';
import { z } from 'zod';
import { prisma, withTx } from '../lib/prisma.js';
import { hashPassword, requirePerm, validatePasswordStrength } from '../lib/auth.js';
import { idParam, optStr } from '../lib/http.js';
import { audit } from '../lib/audit.js';
import { badRequest, notFound } from '../lib/errors.js';
import { PERMISSIONS } from '../lib/permissions.js';

const r = Router();

// Lightweight list of users (for filters) — any signed-in user.
r.get('/options', async (_req, res) => {
  res.json(await prisma.user.findMany({ where: { active: true }, select: { id: true, fullName: true, username: true }, orderBy: { fullName: 'asc' } }));
});

r.use(requirePerm('users.manage'));

const userView = { id: true, username: true, fullName: true, email: true, department: true, active: true, createdAt: true, roles: { select: { role: { select: { code: true, name: true } } } } } as const;

r.get('/', async (_req, res) => {
  const users = await prisma.user.findMany({ orderBy: { username: 'asc' }, select: userView });
  res.json(users.map((u) => ({ ...u, roles: u.roles.map((x) => x.role.code) })));
});

r.get('/roles', async (_req, res) => {
  const roles = await prisma.role.findMany({ orderBy: { id: 'asc' }, include: { permissions: { include: { permission: true } }, _count: { select: { users: true } } } });
  res.json({
    roles: roles.map((x) => ({ id: x.id, code: x.code, name: x.name, users: x._count.users, permissions: x.permissions.map((p) => p.permission.code) })),
    permissions: Object.entries(PERMISSIONS).map(([code, description]) => ({ code, description })),
  });
});

r.put('/roles/:code/permissions', async (req, res) => {
  const code = String(req.params.code);
  if (code === 'ADMIN') throw badRequest('Administrator permissions cannot be reduced');
  const body = z.object({ permissions: z.array(z.string()) }).parse(req.body);
  const role = await prisma.role.findUnique({ where: { code }, include: { permissions: { include: { permission: true } } } });
  if (!role) throw notFound('Role');
  const perms = await prisma.permission.findMany({ where: { code: { in: body.permissions } } });
  await withTx(async (tx) => {
    await tx.rolePermission.deleteMany({ where: { roleId: role.id } });
    await tx.rolePermission.createMany({ data: perms.map((p) => ({ roleId: role.id, permissionId: p.id })) });
    await audit(req, { action: 'ROLE_PERMISSIONS_CHANGED', docType: 'ROLE', docId: role.id, docNumber: code, oldValue: role.permissions.map((p) => p.permission.code), newValue: perms.map((p) => p.code) }, tx);
  });
  res.json({ ok: true });
});

const roleCodes = z.array(z.enum(['ADMIN', 'STORE_MANAGER', 'REQUESTER', 'PROCUREMENT', 'APPROVER', 'VIEWER'])).min(1);

r.post('/', async (req, res) => {
  const body = z.object({
    username: z.string().trim().toLowerCase().regex(/^[a-z0-9._-]{3,40}$/, '3-40 characters: letters, numbers, . _ -'),
    fullName: z.string().trim().min(1), email: optStr, department: optStr, password: z.string(), roles: roleCodes,
  }).parse(req.body);
  validatePasswordStrength(body.password);
  const roles = await prisma.role.findMany({ where: { code: { in: body.roles } } });
  const u = await prisma.user.create({
    data: { username: body.username, fullName: body.fullName, email: body.email, department: body.department, passwordHash: await hashPassword(body.password), roles: { create: roles.map((x) => ({ roleId: x.id })) } },
    select: userView,
  });
  await audit(req, { action: 'USER_CREATED', docType: 'USER', docId: u.id, docNumber: u.username, newValue: { fullName: body.fullName, roles: body.roles, department: body.department } });
  res.status(201).json(u);
});

r.patch('/:id', async (req, res) => {
  const id = idParam(req);
  const body = z.object({ fullName: z.string().trim().min(1).optional(), email: optStr, department: optStr, active: z.boolean().optional(), roles: roleCodes.optional(), password: z.string().optional() }).parse(req.body);
  const before = await prisma.user.findUnique({ where: { id }, include: { roles: { include: { role: true } } } });
  if (!before) throw notFound('User');
  if (id === req.user!.id && (body.active === false || (body.roles && !body.roles.includes('ADMIN')))) throw badRequest('You cannot deactivate yourself or remove your own administrator role');
  if (body.password) validatePasswordStrength(body.password);
  await withTx(async (tx) => {
    await tx.user.update({
      where: { id },
      data: {
        fullName: body.fullName, email: body.email, department: body.department, active: body.active,
        passwordHash: body.password ? await hashPassword(body.password) : undefined,
        tokenVersion: body.password || body.active === false || body.roles ? { increment: 1 } : undefined,
      },
    });
    if (body.roles) {
      const roles = await tx.role.findMany({ where: { code: { in: body.roles } } });
      await tx.userRole.deleteMany({ where: { userId: id } });
      await tx.userRole.createMany({ data: roles.map((x) => ({ userId: id, roleId: x.id })) });
    }
    await audit(req, {
      action: body.password ? 'USER_PASSWORD_RESET' : 'USER_EDITED', docType: 'USER', docId: id, docNumber: before.username,
      oldValue: { fullName: before.fullName, department: before.department, active: before.active, roles: before.roles.map((x) => x.role.code) },
      newValue: { fullName: body.fullName, department: body.department, active: body.active, roles: body.roles, password: body.password ? '(changed)' : undefined },
    }, tx);
  });
  res.json({ ok: true });
});

export default r;
