import type { NextFunction, Request, Response } from 'express';
import { ZodError } from 'zod';
import { Prisma } from '@prisma/client';

export class HttpError extends Error {
  constructor(public status: number, message: string, public details?: unknown) {
    super(message);
  }
}

export const badRequest = (msg: string, details?: unknown) => new HttpError(400, msg, details);
export const forbidden = (msg = 'You do not have permission for this action') => new HttpError(403, msg);
export const notFound = (what = 'Record') => new HttpError(404, `${what} not found`);
export const conflict = (msg: string) => new HttpError(409, msg);

export function errorHandler(err: unknown, _req: Request, res: Response, _next: NextFunction) {
  if (err instanceof HttpError) {
    return res.status(err.status).json({ error: err.message, details: err.details });
  }
  if (err instanceof ZodError) {
    return res.status(400).json({
      error: 'Validation failed',
      details: err.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
    });
  }
  if (err instanceof Prisma.PrismaClientKnownRequestError) {
    if (err.code === 'P2002') return res.status(409).json({ error: `Duplicate value: ${(err.meta?.target as string[] | undefined)?.join(', ') ?? 'unique field'}` });
    if (err.code === 'P2025') return res.status(404).json({ error: 'Record not found' });
    if (err.code === 'P2003') return res.status(409).json({ error: 'Record is referenced by other data and cannot be changed' });
  }
  const msg = err instanceof Error ? err.message : String(err);
  if (/append-only|violates check constraint/.test(msg)) {
    return res.status(409).json({ error: msg.includes('append-only') ? 'History records cannot be modified' : 'Operation would make a quantity invalid' });
  }
  console.error(err);
  return res.status(500).json({ error: 'Unexpected server error' });
}
