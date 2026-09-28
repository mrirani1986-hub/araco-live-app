import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api, qs } from '../lib/api';
import { useAuth } from '../lib/auth';
import { date, money, qty } from '../lib/format';
import { Card, Empty, ErrorState, ExportMenu, Input, PageHeader, Spinner, Table, Td, Th, cx } from '../components/ui';

export default function Reports() {
  const { can } = useAuth();
  const list = useQuery({ queryKey: ['reports'], queryFn: () => api.get('/reports') });
  const [key, setKey] = useState('purchase-history');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const rep = useQuery({ queryKey: ['report', key, from, to], queryFn: () => api.get(`/reports/${key}${qs({ from, to })}`) });
  const fmt = (c: any, v: unknown) => (c.format === 'num' ? money(v) : c.format === 'qty' ? qty(v) : c.format === 'date' ? date(v) : String(v ?? '—'));
  return (
    <div>
      <PageHeader title="Reports" actions={<>
        <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="w-auto" aria-label="From" />
        <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="w-auto" aria-label="To" />
        {can('export.run') && <ExportMenu url={`/reports/${key}${qs({ from, to })}`} />}
      </>} />
      <div className="grid gap-4 lg:grid-cols-[240px_minmax(0,1fr)]">
        <Card bodyClass="p-1">
          {list.data?.map((r: any) => (
            <button key={r.key} onClick={() => setKey(r.key)} className={cx('block w-full rounded px-3 py-2 text-left text-sm', key === r.key ? 'bg-brand-50 font-semibold text-brand-800' : 'text-slate-700 hover:bg-slate-50')}>{r.title}</button>
          ))}
        </Card>
        <Card title={rep.data?.title} bodyClass="p-0">
          {rep.isLoading ? <Spinner /> : rep.error ? <ErrorState error={rep.error} /> : !rep.data.rows.length ? <Empty title="No data for this period" /> : (
            <Table>
              <thead><tr>{rep.data.columns.map((c: any) => <Th key={c.key} className={c.align === 'r' ? 'text-right' : ''}>{c.label}</Th>)}</tr></thead>
              <tbody>{rep.data.rows.map((r: any, i: number) => <tr key={i}>{rep.data.columns.map((c: any) => <Td key={c.key} className={cx(c.align === 'r' && 'text-right tabular-nums')}>{fmt(c, r[c.key])}</Td>)}</tr>)}</tbody>
            </Table>
          )}
        </Card>
      </div>
    </div>
  );
}
