import { prisma } from '../lib/prisma.js';
import { PERMISSIONS, ROLES, DEFAULT_PR_STEPS } from '../lib/permissions.js';
import { hashPassword, validatePasswordStrength } from '../lib/auth.js';
import { DEFAULT_SETTINGS } from '../lib/settings.js';
import { ensureStorageDirs } from '../lib/storage.js';

/**
 * Idempotent bootstrap: permissions, roles, default approval workflow, settings,
 * company/branch, main warehouse and the first administrator (only when no
 * user exists). Never overwrites data an administrator has changed.
 */
export async function seedBase(opts: { adminUsername?: string; adminPassword?: string; adminFullName?: string } = {}) {
  await ensureStorageDirs();
  for (const [code, description] of Object.entries(PERMISSIONS)) {
    await prisma.permission.upsert({ where: { code }, update: { description }, create: { code, description } });
  }
  const perms = new Map((await prisma.permission.findMany()).map((p) => [p.code, p.id]));
  for (const [code, r] of Object.entries(ROLES)) {
    const existing = await prisma.role.findUnique({ where: { code } });
    if (existing) continue; // role permissions may have been customised by an admin
    await prisma.role.create({
      data: { code, name: r.name, permissions: { create: r.permissions.map((p) => ({ permissionId: perms.get(p)! })) } },
    });
  }
  // ADMIN always has every permission (including newly added ones).
  const admin = await prisma.role.findUniqueOrThrow({ where: { code: 'ADMIN' } });
  for (const id of perms.values()) {
    await prisma.rolePermission.upsert({ where: { roleId_permissionId: { roleId: admin.id, permissionId: id } }, update: {}, create: { roleId: admin.id, permissionId: id } });
  }
  if ((await prisma.approvalStep.count({ where: { docType: 'PR' } })) === 0) {
    await prisma.approvalStep.createMany({ data: DEFAULT_PR_STEPS.map((s) => ({ ...s, docType: 'PR' })) });
  }
  for (const [key, value] of Object.entries(DEFAULT_SETTINGS)) {
    await prisma.setting.upsert({ where: { key }, update: {}, create: { key, value: value as object } });
  }
  let company = await prisma.company.findFirst();
  if (!company) company = await prisma.company.create({ data: { code: 'ARACO', name: DEFAULT_SETTINGS.company.name } });
  let branch = await prisma.branch.findFirst({ where: { companyId: company.id } });
  if (!branch) branch = await prisma.branch.create({ data: { companyId: company.id, code: 'MAIN', name: 'Main plant' } });
  if ((await prisma.warehouse.count()) === 0) {
    await prisma.warehouse.create({
      data: { code: 'MAIN', name: 'Main Store', branchId: branch.id, locations: { create: [{ code: 'GENERAL', description: 'General storage (assign shelves later)' }] } },
    });
  }
  if ((await prisma.user.count()) === 0) {
    const username = opts.adminUsername ?? process.env.ADMIN_USERNAME;
    const password = opts.adminPassword ?? process.env.ADMIN_PASSWORD;
    if (!username || !password || /change_me/i.test(password)) {
      throw new Error('Set ADMIN_USERNAME and ADMIN_PASSWORD to create the first administrator');
    }
    validatePasswordStrength(password);
    await prisma.user.create({
      data: {
        username: username.toLowerCase(), fullName: opts.adminFullName ?? process.env.ADMIN_FULL_NAME ?? 'System Administrator',
        passwordHash: await hashPassword(password), roles: { create: [{ roleId: admin.id }] },
      },
    });
    console.log(`Created administrator "${username}"`);
  }
}

if (process.argv[1]?.endsWith('seed.ts') || process.argv[1]?.endsWith('seed.js')) {
  seedBase().then(() => { console.log('Seed complete'); return prisma.$disconnect(); }).catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1); });
}
