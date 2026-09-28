import type { Request } from 'express';
import { z } from 'zod';
import { badRequest } from './errors.js';

export const idParam = (req: Request, name = 'id') => {
  const v = Number(req.params[name]);
  if (!Number.isInteger(v) || v <= 0) throw badRequest(`Invalid ${name}`);
  return v;
};

export const optStr = z.string().trim().max(2000).nullish().transform((v) => (v === '' ? null : v));
export const optDate = z.string().trim().nullish().transform((v, ctx) => {
  if (!v) return null;
  if (Number.isNaN(Date.parse(v))) { ctx.addIssue({ code: 'custom', message: 'Invalid date' }); return z.NEVER; }
  return v;
});
export const posNum = z.coerce.number().positive();
export const nonNegNum = z.coerce.number().min(0);

export const qInt = (v: unknown) => (v === undefined || v === '' ? undefined : Number(v));
export const qStr = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : undefined);
export const qBool = (v: unknown) => (v === 'true' ? true : v === 'false' ? false : undefined);

export const pageArgs = (req: Request, defaultSize = 50) => {
  const page = Math.max(1, Number(req.query.page ?? 1) || 1);
  const pageSize = Math.min(500, Math.max(1, Number(req.query.pageSize ?? defaultSize) || defaultSize));
  return { page, pageSize, skip: (page - 1) * pageSize, take: pageSize };
};
