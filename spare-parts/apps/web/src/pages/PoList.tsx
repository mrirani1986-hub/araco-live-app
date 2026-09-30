import { Link, useSearchParams } from 'react-router-dom';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { Plus } from 'lucide-react';
import { api, qs } from '../lib/api';
import { useAuth } from '../lib/auth';
import { date, money } from '../lib/format';
import { CompanyFilter, useCompanies } from '../components/parts';
import { Button, Card, Empty, ErrorState, ExportMenu, Input, PageHeader, Pagination, Select, Spinner, StatusBadge, Table, Td, Th } from '../components/ui';

export default function PoList() {
  const [sp, setSp] = useSearchParams();
  const { can } = useAuth();
  const multi = useCompanies().length > 1;
  const lookups = useQuery({ queryKey: ['lookups'], queryFn: () => api.get('/lookups'), staleTime: 300_000 });
  const f = { q: sp.get('q') ?? '', status: sp.get('status') ?? '', companyId: sp.get('companyId') ?? '', supplierId: sp.get('supplierId') ?? '', from: sp.get('from') ?? '', to: sp.get('to') ?? '', page: Number(sp.get('page') ?? 1) };
  const set = (k: string, v: string) => { const n = new URLSearchParams(sp); v ? n.set(k, v) : n.delete(k); if (k !== 'page') n.delete('page'); setSp(n, { replace: true }); };
  const q = useQuery({ queryKey: ['pos', f], queryFn: () => api.get(`/pos${qs(f)}`), placeholderData: keepPreviousData });
  return (
    <div>
      <PageHeader title="Purchase orders" actions={<>
        {can('export.run') && <ExportMenu url={`/pos/export${qs({ ...f, page: undefined })}`} />}
        {can('po.create') && <Link to="/purchase-orders/new"><Button variant="primary" icon={<Plus className="h-4 w-4" />}>New PO</Button></Link>}
      </>} />
      <div className="mb-3 flex flex-wrap gap-2">
        <Input placeholder="PO / PR number or supplier…" value={f.q} onChange={(e) => set('q', e.target.value)} className="max-w-xs" />
        <Select value={f.status} onChange={(e) => set('status', e.target.value)} className="w-auto" aria-label="Status">
          <option value="">All statuses</option><option value="OPEN">Open</option><option value="OVERDUE">Overdue</option>
          {['DRAFT', 'APPROVED', 'SENT', 'PARTIALLY_RECEIVED', 'RECEIVED', 'CLOSED', 'CANCELLED'].map((s) => <option key={s} value={s}>{s.replace(/_/g, ' ')}</option>)}
        </Select>
        <Select value={f.supplierId} onChange={(e) => set('supplierId', e.target.value)} className="w-auto" aria-label="Supplier"><option value="">All suppliers</option>{lookups.data?.suppliers?.map((s: any) => <option key={s.id} value={s.id}>{s.name}</option>)}</Select>
        <CompanyFilter value={f.companyId} onChange={(v) => set('companyId', v)} />
        <Input type="date" value={f.from} onChange={(e) => set('from', e.target.value)} className="w-auto" aria-label="From" />
        <Input type="date" value={f.to} onChange={(e) => set('to', e.target.value)} className="w-auto" aria-label="To" />
      </div>
      {q.isLoading ? <Spinner /> : q.error ? <ErrorState error={q.error} /> : !q.data.items.length ? <Card><Empty title="No purchase orders">Approved PRs can be converted to POs from the PR page.</Empty></Card> : (
        <Card bodyClass="p-0">
          <Table>
            <thead><tr><Th>PO Number</Th>{multi && <Th>Company</Th>}<Th>Date</Th><Th>Supplier</Th><Th>Reference PR</Th><Th>Expected</Th><Th>Status</Th><Th className="text-right">Lines</Th><Th className="text-right">Grand total</Th></tr></thead>
            <tbody>{q.data.items.map((p: any) => (
              <tr key={p.id} className="hover:bg-slate-50">
                <Td><Link to={`/purchase-orders/${p.id}`} className="font-mono font-semibold text-brand-700 hover:underline">{p.poNumber}</Link></Td>
                {multi && <Td>{p.company?.name ?? '—'}</Td>}
                <Td>{date(p.poDate)}</Td><Td>{p.supplier.name}</Td>
                <Td>{p.prId ? <Link to={`/requests/${p.prId}`} className="font-mono text-brand-700 hover:underline">{p.prNumber}</Link> : '—'}</Td>
                <Td className={p.overdue ? 'font-semibold text-red-700' : ''}>{date(p.expectedDelivery)}{p.overdue ? ' (overdue)' : ''}</Td>
                <Td><StatusBadge status={p.status} /></Td><Td className="text-right">{p.lineCount}</Td>
                <Td className="text-right tabular-nums">{money(p.totals.grandTotal, p.currency)}</Td>
              </tr>
            ))}</tbody>
          </Table>
          <div className="px-3"><Pagination page={f.page} pageSize={q.data.pageSize} total={q.data.total} onPage={(p) => set('page', String(p))} /></div>
        </Card>
      )}
    </div>
  );
}
