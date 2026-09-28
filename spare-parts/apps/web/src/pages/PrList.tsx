import { Link, useSearchParams } from 'react-router-dom';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { Plus } from 'lucide-react';
import { api, qs } from '../lib/api';
import { useAuth } from '../lib/auth';
import { date, money } from '../lib/format';
import { Button, Card, Empty, ErrorState, ExportMenu, Input, PageHeader, Pagination, Select, Spinner, StatusBadge, Table, Tabs, Td, Th } from '../components/ui';

export default function PrList() {
  const [sp, setSp] = useSearchParams();
  const { can } = useAuth();
  const tab = (sp.get('tab') as 'all' | 'mine' | 'approvals') ?? (can('pr.view_all', 'pr.view_approved') ? 'all' : 'mine');
  const f = { q: sp.get('q') ?? '', status: sp.get('status') ?? '', from: sp.get('from') ?? '', to: sp.get('to') ?? '', page: Number(sp.get('page') ?? 1) };
  const set = (k: string, v: string) => { const n = new URLSearchParams(sp); v ? n.set(k, v) : n.delete(k); if (k !== 'page') n.delete('page'); setSp(n, { replace: true }); };
  const list = useQuery({ queryKey: ['prs', tab, f], queryFn: () => api.get(`/prs${qs({ ...f, scope: tab === 'mine' ? 'mine' : undefined })}`), enabled: tab !== 'approvals', placeholderData: keepPreviousData });
  const pending = useQuery({ queryKey: ['pending'], queryFn: () => api.get('/prs/pending'), enabled: can('pr.approve') });
  const tabs = [
    ...(can('pr.view_all', 'pr.view_approved', 'pr.approve') ? [{ key: 'all' as const, label: 'All requisitions' }] : []),
    { key: 'mine' as const, label: 'My requisitions' },
    ...(can('pr.approve') ? [{ key: 'approvals' as const, label: `Waiting for my approval${pending.data?.length ? ` (${pending.data.length})` : ''}` }] : []),
  ];
  return (
    <div>
      <PageHeader title="Requests / Purchase requisitions" actions={<>
        {can('export.run') && <ExportMenu url={`/prs/export${qs({ ...f, page: undefined, scope: tab === 'mine' ? 'mine' : undefined })}`} />}
        {can('cart.use') && <Link to="/parts"><Button variant="primary" icon={<Plus className="h-4 w-4" />}>New request</Button></Link>}
      </>} />
      <Tabs value={tab} onChange={(t) => { const n = new URLSearchParams(); n.set('tab', t); setSp(n); }} tabs={tabs} />
      {tab === 'approvals' ? (
        pending.isLoading ? <Spinner /> : !pending.data?.length ? <Card><Empty title="Nothing waiting for your approval" /></Card> : (
          <Card bodyClass="p-0"><Table>
            <thead><tr><Th>PR</Th><Th>Requested by</Th><Th>Department</Th><Th>Submitted</Th><Th>Priority</Th><Th>Step</Th><Th className="text-right">Est. total</Th></tr></thead>
            <tbody>{pending.data.map((p: any) => (
              <tr key={p.id} className="hover:bg-slate-50"><Td><Link to={`/requests/${p.id}`} className="font-mono font-semibold text-brand-700 hover:underline">{p.prNumber}</Link></Td><Td>{p.requester.fullName}</Td><Td>{p.department}</Td><Td>{date(p.submittedAt)}</Td><Td>{p.priority}</Td><Td>{p.waitingFor}</Td><Td className="text-right tabular-nums">{money(p.totals.grandTotal, p.currency)}</Td></tr>
            ))}</tbody>
          </Table></Card>
        )
      ) : (
        <>
          <div className="mb-3 flex flex-wrap gap-2">
            <Input placeholder="PR number, project or part number…" value={f.q} onChange={(e) => set('q', e.target.value)} className="max-w-xs" />
            <Select value={f.status} onChange={(e) => set('status', e.target.value)} className="w-auto" aria-label="Status">
              <option value="">All statuses</option>{['DRAFT', 'SUBMITTED', 'PENDING_APPROVAL', 'APPROVED', 'REJECTED', 'CANCELLED', 'CONVERTED_TO_PO'].map((s) => <option key={s} value={s}>{s.replace(/_/g, ' ')}</option>)}
            </Select>
            <Input type="date" value={f.from} onChange={(e) => set('from', e.target.value)} className="w-auto" aria-label="From" />
            <Input type="date" value={f.to} onChange={(e) => set('to', e.target.value)} className="w-auto" aria-label="To" />
          </div>
          {list.isLoading ? <Spinner /> : list.error ? <ErrorState error={list.error} /> : !list.data.items.length ? <Card><Empty title="No purchase requisitions" /></Card> : (
            <Card bodyClass="p-0">
              <Table>
                <thead><tr><Th>PR Number</Th><Th>Date</Th><Th>Requested by</Th><Th>Department</Th><Th>Project</Th><Th>Required</Th><Th>Priority</Th><Th>Status</Th><Th className="text-right">Lines</Th><Th className="text-right">Est. total</Th></tr></thead>
                <tbody>{list.data.items.map((p: any) => (
                  <tr key={p.id} className="hover:bg-slate-50">
                    <Td><Link to={`/requests/${p.id}`} className="font-mono font-semibold text-brand-700 hover:underline">{p.prNumber}</Link></Td>
                    <Td>{date(p.requestDate)}</Td><Td>{p.requester.fullName}</Td><Td>{p.department ?? '—'}</Td><Td>{p.project ?? '—'}</Td><Td>{date(p.requiredDate)}</Td><Td>{p.priority}</Td>
                    <Td><StatusBadge status={p.status} /></Td><Td className="text-right">{p.lineCount}</Td><Td className="text-right tabular-nums">{money(p.totals.grandTotal, p.currency)}</Td>
                  </tr>
                ))}</tbody>
              </Table>
              <div className="px-3"><Pagination page={f.page} pageSize={list.data.pageSize} total={list.data.total} onPage={(p) => set('page', String(p))} /></div>
            </Card>
          )}
        </>
      )}
    </div>
  );
}
