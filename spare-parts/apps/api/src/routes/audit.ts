import { Router } from 'express';
import { Prisma } from '@prisma/client';
import { prisma } from '../lib/prisma.js';
import { requirePerm } from '../lib/auth.js';
import { pageArgs, qInt, qStr } from '../lib/http.js';
import { sendExport } from '../services/export.js';

const r = Router();
r.use(requirePerm('audit.view'));

function where(q: Record<string, unknown>): Prisma.AuditLogWhereInput {
  const w: Prisma.AuditLogWhereInput = {};
  const action = qStr(q.action); if (action) w.action = { contains: action, mode: 'insensitive' };
  const docType = qStr(q.docType); if (docType) w.docType = docType;
  const docId = qInt(q.docId); if (docId) w.docId = docId;
  const userId = qInt(q.userId); if (userId) w.userId = userId;
  const text = qStr(q.q);
  if (text) w.OR = [{ docNumber: { contains: text, mode: 'insensitive' } }, { comment: { contains: text, mode: 'insensitive' } }, { action: { contains: text, mode: 'insensitive' } }];
  const from = qStr(q.from), to = qStr(q.to);
  if (from || to) w.createdAt = { gte: from ? new Date(from) : undefined, lte: to ? new Date(to + 'T23:59:59') : undefined };
  return w;
}

r.get('/', async (req, res) => {
  const { skip, take, page, pageSize } = pageArgs(req, 100);
  const w = where(req.query);
  const [rows, total, actions] = await Promise.all([
    prisma.auditLog.findMany({ where: w, orderBy: { id: 'desc' }, skip, take, include: { user: { select: { fullName: true, username: true } } } }),
    prisma.auditLog.count({ where: w }),
    prisma.auditLog.findMany({ distinct: ['action'], select: { action: true }, orderBy: { action: 'asc' } }),
  ]);
  res.json({ page, pageSize, total, actions: actions.map((a) => a.action), items: rows.map((x) => ({ ...x, id: x.id.toString() })) });
});

r.get('/export', requirePerm('export.run'), async (req, res) => {
  const rows = await prisma.auditLog.findMany({ where: where(req.query), orderBy: { id: 'desc' }, take: 20000, include: { user: true } });
  await sendExport(res, String(req.query.format ?? 'xlsx'), 'Audit Log', [
    { key: 'createdAt', label: 'Date/time' }, { key: 'user', label: 'User' }, { key: 'action', label: 'Action' }, { key: 'docType', label: 'Doc type' },
    { key: 'docNumber', label: 'Document' }, { key: 'oldValue', label: 'Old value' }, { key: 'newValue', label: 'New value' }, { key: 'comment', label: 'Comment' },
    { key: 'ip', label: 'IP' }, { key: 'userAgent', label: 'Device' },
  ], rows.map((x) => ({ ...x, createdAt: x.createdAt.toISOString().replace('T', ' ').slice(0, 19), user: x.user?.fullName ?? 'system', oldValue: x.oldValue ? JSON.stringify(x.oldValue) : '', newValue: x.newValue ? JSON.stringify(x.newValue) : '' })));
});

export default r;
