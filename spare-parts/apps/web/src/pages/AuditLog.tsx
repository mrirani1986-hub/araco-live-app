import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { api, qs } from '../lib/api';
import { useAuth } from '../lib/auth';
import { dateTime } from '../lib/format';
import { Card, Empty, ErrorState, ExportMenu, Input, Modal, PageHeader, Pagination, Select, Spinner, Table, Td, Th } from '../components/ui';

export default function AuditLog() {
  const [sp, setSp] = useSearchParams();
  const { can } = useAuth();
  const [open, setOpen] = useState<any>(null);
  const users = useQuery({ queryKey: ['user-options'], queryFn: () => api.get('/users/options') });
  const f = { q: sp.get('q') ?? '', action: sp.get('action') ?? '', docType: sp.get('docType') ?? '', userId: sp.get('userId') ?? '', from: sp.get('from') ?? '', to: sp.get('to') ?? '', page: Number(sp.get('page') ?? 1) };
  const set = (k: string, v: string) => { const n = new URLSearchParams(sp); v ? n.set(k, v) : n.delete(k); if (k !== 'page') n.delete('page'); setSp(n, { replace: true }); };
  const q = useQuery({ queryKey: ['audit', f], queryFn: () => api.get(`/audit${qs(f)}`), placeholderData: keepPreviousData });
  return (
    <div>
      <PageHeader title="Audit log" subtitle="Every important action, with user, time, old and new values. Entries cannot be edited or deleted." actions={can('export.run') && <ExportMenu url={`/audit/export${qs({ ...f, page: undefined })}`} formats={['xlsx', 'csv']} />} />
      <div className="mb-3 flex flex-wrap gap-2">
        <Input placeholder="Document number or comment…" value={f.q} onChange={(e) => set('q', e.target.value)} className="max-w-xs" />
        <Select value={f.action} onChange={(e) => set('action', e.target.value)} className="w-auto" aria-label="Action"><option value="">All actions</option>{q.data?.actions?.map((a: string) => <option key={a}>{a}</option>)}</Select>
        <Select value={f.docType} onChange={(e) => set('docType', e.target.value)} className="w-auto" aria-label="Document type"><option value="">All documents</option>{['PR', 'PO', 'GRN', 'PART', 'INVENTORY', 'SUPPLIER', 'USER', 'SETTINGS', 'IMPORT', 'BACKUP', 'SOURCE'].map((d) => <option key={d}>{d}</option>)}</Select>
        <Select value={f.userId} onChange={(e) => set('userId', e.target.value)} className="w-auto" aria-label="User"><option value="">All users</option>{users.data?.map((u: any) => <option key={u.id} value={u.id}>{u.fullName}</option>)}</Select>
        <Input type="date" value={f.from} onChange={(e) => set('from', e.target.value)} className="w-auto" aria-label="From" />
        <Input type="date" value={f.to} onChange={(e) => set('to', e.target.value)} className="w-auto" aria-label="To" />
      </div>
      {q.isLoading ? <Spinner /> : q.error ? <ErrorState error={q.error} /> : !q.data.items.length ? <Card><Empty title="No entries" /></Card> : (
        <Card bodyClass="p-0">
          <Table>
            <thead><tr><Th>Date / time</Th><Th>User</Th><Th>Action</Th><Th>Document</Th><Th>Change</Th><Th>Comment</Th><Th>IP / device</Th></tr></thead>
            <tbody>{q.data.items.map((a: any) => (
              <tr key={a.id} className="cursor-pointer hover:bg-slate-50" onClick={() => setOpen(a)}>
                <Td className="whitespace-nowrap">{dateTime(a.createdAt)}</Td><Td>{a.user?.fullName ?? 'system'}</Td><Td className="font-mono text-xs">{a.action}</Td>
                <Td>{a.docType && <span className="text-xs text-slate-500">{a.docType} </span>}<span className="font-mono">{a.docNumber}</span></Td>
                <Td className="max-w-[280px] truncate font-mono text-xs text-slate-600">{a.newValue ? JSON.stringify(a.newValue) : ''}</Td>
                <Td className="max-w-[200px] truncate text-slate-600">{a.comment}</Td>
                <Td className="max-w-[180px] truncate text-xs text-slate-500" title={a.userAgent}>{a.ip}</Td>
              </tr>
            ))}</tbody>
          </Table>
          <div className="px-3"><Pagination page={f.page} pageSize={q.data.pageSize} total={q.data.total} onPage={(p) => set('page', String(p))} /></div>
        </Card>
      )}
      <Modal open={!!open} onClose={() => setOpen(null)} size="lg" title={open ? `${open.action} — ${open.docNumber ?? ''}` : ''}>
        {open && <div className="space-y-3 text-sm">
          <div><b>When:</b> {dateTime(open.createdAt)} · <b>User:</b> {open.user?.fullName ?? 'system'} · <b>IP:</b> {open.ip ?? '—'}</div>
          <div className="text-xs text-slate-500">{open.userAgent}</div>
          {open.comment && <div><b>Comment:</b> {open.comment}</div>}
          <div className="grid gap-3 md:grid-cols-2">
            <div><div className="mb-1 font-semibold text-red-700">Old value</div><pre className="max-h-80 overflow-auto rounded bg-red-50 p-2 text-xs">{open.oldValue ? JSON.stringify(open.oldValue, null, 2) : '—'}</pre></div>
            <div><div className="mb-1 font-semibold text-emerald-700">New value</div><pre className="max-h-80 overflow-auto rounded bg-emerald-50 p-2 text-xs">{open.newValue ? JSON.stringify(open.newValue, null, 2) : '—'}</pre></div>
          </div>
        </div>}
      </Modal>
    </div>
  );
}
