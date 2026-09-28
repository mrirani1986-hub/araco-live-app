import type { Request } from 'express';
import { prisma, type Tx } from './prisma.js';

export interface AuditEntry {
  action: string;
  docType?: string;
  docId?: number;
  docNumber?: string | null;
  oldValue?: unknown;
  newValue?: unknown;
  comment?: string | null;
}

const clean = (v: unknown) =>
  v === undefined ? undefined : JSON.parse(JSON.stringify(v, (_k, x) => (typeof x === 'bigint' ? x.toString() : x)));

/** Writes an audit row. Pass tx so the audit is committed atomically with the change. */
export async function audit(req: Request | null, e: AuditEntry, tx?: Tx) {
  const db = tx ?? prisma;
  await db.auditLog.create({
    data: {
      userId: req?.user?.id ?? null,
      action: e.action,
      docType: e.docType,
      docId: e.docId,
      docNumber: e.docNumber ?? undefined,
      oldValue: clean(e.oldValue),
      newValue: clean(e.newValue),
      comment: e.comment ?? undefined,
      ip: req ? (req.ip ?? null) : null,
      userAgent: req ? (req.get('user-agent')?.slice(0, 300) ?? null) : 'system',
    },
  });
}

/** Returns only the fields whose values changed (for compact old/new audit values). */
export function diff<T extends Record<string, unknown>>(before: T, after: Partial<T>) {
  const oldV: Record<string, unknown> = {};
  const newV: Record<string, unknown> = {};
  for (const k of Object.keys(after)) {
    const a = before[k];
    const b = after[k];
    if (JSON.stringify(clean(a)) !== JSON.stringify(clean(b))) {
      oldV[k] = a;
      newV[k] = b;
    }
  }
  return { oldValue: oldV, newValue: newV, changed: Object.keys(newV).length > 0 };
}
