import type { NextFunction, Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import { env } from '../env.js';
import { prisma } from './prisma.js';
import { HttpError, forbidden } from './errors.js';
import type { Permission } from './permissions.js';

export const COOKIE = 'araco_sp_session';

export interface AuthUser {
  id: number;
  username: string;
  fullName: string;
  department: string | null;
  roles: string[];
  permissions: Set<string>;
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: AuthUser;
    }
  }
}

export const hashPassword = (pw: string) => bcrypt.hash(pw, 12);
export const verifyPassword = (pw: string, hash: string) => bcrypt.compare(pw, hash);

export function validatePasswordStrength(pw: string) {
  if (pw.length < 8 || !/[A-Za-z]/.test(pw) || !/\d/.test(pw)) {
    throw new HttpError(400, 'Password must be at least 8 characters and contain letters and numbers');
  }
}

export function issueSession(res: Response, user: { id: number; tokenVersion: number }) {
  const token = jwt.sign({ sub: user.id, v: user.tokenVersion }, env.jwtSecret, { expiresIn: `${env.sessionHours}h` });
  res.cookie(COOKIE, token, {
    httpOnly: true,
    sameSite: 'strict',
    secure: env.isProd,
    maxAge: env.sessionHours * 3600 * 1000,
    path: '/',
  });
}

export function clearSession(res: Response) {
  res.clearCookie(COOKIE, { path: '/' });
}

export async function loadUser(id: number, tokenVersion?: number): Promise<AuthUser | null> {
  const u = await prisma.user.findUnique({
    where: { id },
    include: { roles: { include: { role: { include: { permissions: { include: { permission: true } } } } } } },
  });
  if (!u || !u.active) return null;
  if (tokenVersion !== undefined && u.tokenVersion !== tokenVersion) return null;
  const permissions = new Set<string>();
  for (const ur of u.roles) for (const rp of ur.role.permissions) permissions.add(rp.permission.code);
  return {
    id: u.id, username: u.username, fullName: u.fullName, department: u.department,
    roles: u.roles.map((r) => r.role.code), permissions,
  };
}

export async function authenticate(req: Request, _res: Response, next: NextFunction) {
  const token = req.cookies?.[COOKIE];
  if (!token) return next();
  try {
    const payload = jwt.verify(token, env.jwtSecret) as unknown as { sub: number; v: number };
    const user = await loadUser(Number(payload.sub), payload.v);
    if (user) req.user = user;
  } catch {
    /* invalid / expired token => anonymous */
  }
  next();
}

export function requireAuth(req: Request, _res: Response, next: NextFunction) {
  if (!req.user) return next(new HttpError(401, 'Please sign in'));
  next();
}

export const can = (req: Request, p: Permission) => !!req.user?.permissions.has(p);
export const hasRole = (req: Request, role: string) => !!req.user?.roles.includes(role);

export function requirePerm(...perms: Permission[]) {
  return (req: Request, _res: Response, next: NextFunction) => {
    if (!req.user) return next(new HttpError(401, 'Please sign in'));
    if (!perms.some((p) => req.user!.permissions.has(p))) return next(forbidden());
    next();
  };
}

/** CSRF defence in depth: SameSite=strict cookie + custom header required on writes. */
export function requireCsrfHeader(req: Request, _res: Response, next: NextFunction) {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
  if (req.get('x-requested-with') !== 'araco-sp') return next(new HttpError(403, 'Missing request header'));
  next();
}

// Simple in-memory login throttle (per username+ip).
const attempts = new Map<string, { n: number; until: number }>();
export function checkLoginThrottle(key: string) {
  const a = attempts.get(key);
  if (a && a.until > Date.now()) throw new HttpError(429, 'Too many failed attempts. Try again in a few minutes.');
}
export function recordLoginFailure(key: string) {
  const a = attempts.get(key) ?? { n: 0, until: 0 };
  a.n += 1;
  if (a.n >= 5) { a.until = Date.now() + 5 * 60_000; a.n = 0; }
  attempts.set(key, a);
}
export const clearLoginFailures = (key: string) => attempts.delete(key);
