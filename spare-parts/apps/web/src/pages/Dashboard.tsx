import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Bar, BarChart, CartesianGrid, LabelList, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { AlertTriangle, Boxes, ClipboardCheck, ClipboardList, Clock, FileText, PackageX, Wallet } from 'lucide-react';
import { api, qs } from '../lib/api';
import { useAuth } from '../lib/auth';
import { money, qty, date } from '../lib/format';
import { Card, Empty, ErrorState, Input, PageHeader, Spinner, StatusBadge, Table, Td, Th, cx } from '../components/ui';

// Single-series charts use one validated hue (reference palette slot 1); text stays in ink tokens.
const SERIES = '#2a78d6';
const GRID = '#e7e5e0';
const INK2 = '#52514e';

function Kpi({ label, value, icon, to, tone }: { label: string; value: React.ReactNode; icon: React.ReactNode; to?: string; tone?: 'warn' | 'bad' }) {
  const body = (
    <div className={cx('flex items-center gap-3 rounded-lg border bg-white p-4 shadow-sm transition', to && 'hover:border-brand-300 hover:shadow')}>
      <div className={cx('grid h-10 w-10 shrink-0 place-items-center rounded-lg', tone === 'bad' ? 'bg-red-50 text-red-700' : tone === 'warn' ? 'bg-amber-50 text-amber-700' : 'bg-brand-50 text-brand-700')}>{icon}</div>
      <div className="min-w-0">
        <div className="text-xs font-medium uppercase tracking-wide text-slate-500">{label}</div>
        <div className="truncate text-2xl font-bold tabular-nums text-slate-900">{value}</div>
      </div>
    </div>
  );
  return to ? <Link to={to}>{body}</Link> : body;
}

function ChartTip({ active, payload, label, unit }: any) {
  if (!active || !payload?.length) return null;
  return <div className="rounded-md border bg-white px-2.5 py-1.5 text-xs shadow"><div className="font-semibold text-slate-800">{label}</div><div className="text-slate-600">{unit === 'qty' ? qty(payload[0].value) : money(payload[0].value)}</div></div>;
}

function HBar({ data, dataKey, nameKey, unit }: { data: any[]; dataKey: string; nameKey: string; unit?: 'qty' }) {
  if (!data?.length) return <Empty title="No purchases in this period" />;
  return (
    <ResponsiveContainer width="100%" height={Math.max(160, data.length * 34 + 30)}>
      <BarChart data={data} layout="vertical" margin={{ left: 8, right: 70, top: 4, bottom: 4 }} barCategoryGap={6}>
        <CartesianGrid horizontal={false} stroke={GRID} />
        <XAxis type="number" tick={{ fontSize: 11, fill: INK2 }} tickFormatter={(v) => Number(v).toLocaleString('en-US', { notation: 'compact' })} axisLine={false} tickLine={false} />
        <YAxis type="category" dataKey={nameKey} width={150} tick={{ fontSize: 11, fill: INK2 }} axisLine={false} tickLine={false} />
        <Tooltip content={<ChartTip unit={unit} />} cursor={{ fill: '#f1f5f9' }} />
        <Bar dataKey={dataKey} fill={SERIES} radius={[0, 4, 4, 0]} maxBarSize={22} isAnimationActive={false}>
          <LabelList dataKey={dataKey} position="right" formatter={(v: number) => (unit === 'qty' ? qty(v) : Number(v).toLocaleString('en-US', { maximumFractionDigits: 0 }))} style={{ fontSize: 11, fill: INK2 }} />
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

export default function Dashboard() {
  const { can, me } = useAuth();
  const [from, setFrom] = useState(`${new Date().getFullYear()}-01-01`);
  const [to, setTo] = useState(new Date().toISOString().slice(0, 10));
  const q = useQuery({ queryKey: ['dashboard', from, to], queryFn: () => api.get(`/dashboard${qs({ from, to })}`) });
  if (q.isLoading) return <Spinner />;
  if (q.error) return <ErrorState error={q.error} retry={() => q.refetch()} />;
  const d = q.data;
  const c = d.cards;
  const cur = d.currencies?.length === 1 ? d.currencies[0] : d.currencies?.length ? 'mixed currencies' : 'SAR';
  return (
    <div>
      <PageHeader title="Dashboard" subtitle={`Welcome, ${me?.fullName}`} actions={can('reports.view') && (
        <div className="flex items-center gap-2 text-sm"><span className="text-slate-500">Period</span>
          <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="w-auto" aria-label="From" />
          <span>–</span><Input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="w-auto" aria-label="To" />
        </div>
      )} />
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Kpi label="Total parts" value={c.totalParts.toLocaleString()} icon={<Boxes className="h-5 w-5" />} to="/parts" />
        <Kpi label="Low stock" value={c.lowStock + c.reorder} icon={<AlertTriangle className="h-5 w-5" />} to="/inventory?status=ATTENTION" tone={c.lowStock + c.reorder ? 'warn' : undefined} />
        <Kpi label="Out of stock" value={c.outOfStock} icon={<PackageX className="h-5 w-5" />} to="/inventory?status=OUT_OF_STOCK" tone={c.outOfStock ? 'bad' : undefined} />
        <Kpi label="Open PRs" value={c.openPrs} icon={<ClipboardList className="h-5 w-5" />} to="/requests" />
        <Kpi label="Pending approvals" value={c.pendingApprovals} icon={<ClipboardCheck className="h-5 w-5" />} to="/requests?tab=approvals" tone={c.myPendingApprovals ? 'warn' : undefined} />
        <Kpi label="Open POs" value={c.openPos} icon={<FileText className="h-5 w-5" />} to="/purchase-orders?status=OPEN" />
        <Kpi label="Overdue POs" value={c.overduePos} icon={<Clock className="h-5 w-5" />} to="/purchase-orders?status=OVERDUE" tone={c.overduePos ? 'bad' : undefined} />
        <Kpi label={`Purchase value (${cur})`} value={money(c.totalPurchaseValue)} icon={<Wallet className="h-5 w-5" />} to="/reports" />
      </div>
      {c.inStock === 0 && c.totalParts > 0 && (
        <div className="mt-4 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          No stock has been recorded yet. Record opening stock in <Link to="/settings?tab=import" className="font-semibold underline">Settings → Import (Stock)</Link> or with an adjustment in <Link to="/inventory" className="font-semibold underline">Inventory</Link>, and apply the suggested minimum stock from the workbook.
        </div>
      )}
      {can('reports.view') && d.byMonth && (
        <div className="mt-5 grid gap-4 xl:grid-cols-2">
          <Card title={`Purchases by month (${cur})`}>
            {d.byMonth.length ? (
              <ResponsiveContainer width="100%" height={240}>
                <BarChart data={d.byMonth} margin={{ top: 18, right: 8, left: 0, bottom: 0 }} barCategoryGap="20%">
                  <CartesianGrid vertical={false} stroke={GRID} />
                  <XAxis dataKey="month" tick={{ fontSize: 11, fill: INK2 }} axisLine={false} tickLine={false} />
                  <YAxis tick={{ fontSize: 11, fill: INK2 }} tickFormatter={(v) => Number(v).toLocaleString('en-US', { notation: 'compact' })} axisLine={false} tickLine={false} width={48} />
                  <Tooltip content={<ChartTip />} cursor={{ fill: '#f1f5f9' }} />
                  <Bar dataKey="value" fill={SERIES} radius={[4, 4, 0, 0]} maxBarSize={48} isAnimationActive={false} />
                </BarChart>
              </ResponsiveContainer>
            ) : <Empty title="No purchase orders in this period" />}
          </Card>
          <Card title="PO delivery status">
            {d.poStatus.length ? (
              <div className="space-y-2">
                {d.poStatus.map((s: any) => {
                  const max = Math.max(...d.poStatus.map((x: any) => x.count));
                  return (
                    <Link key={s.status} to={`/purchase-orders?status=${s.status}`} className="flex items-center gap-3 text-sm hover:bg-slate-50">
                      <div className="w-40"><StatusBadge status={s.status} /></div>
                      <div className="h-5 flex-1 rounded bg-slate-100"><div className="h-5 rounded" style={{ width: `${(s.count / max) * 100}%`, background: SERIES }} /></div>
                      <div className="w-10 text-right font-semibold tabular-nums">{s.count}</div>
                    </Link>
                  );
                })}
              </div>
            ) : <Empty title="No purchase orders in this period" />}
          </Card>
          <Card title="Purchases by supplier"><HBar data={d.bySupplier} dataKey="value" nameKey="supplier" /></Card>
          <Card title="Purchases by category"><HBar data={d.byCategory} dataKey="value" nameKey="category" /></Card>
          <Card title="Top purchased parts (value)" bodyClass="p-0">
            {d.topParts.length ? (
              <Table><thead><tr><Th>Part</Th><Th>Name</Th><Th className="text-right">Qty</Th><Th className="text-right">Value</Th></tr></thead>
                <tbody>{d.topParts.map((p: any) => <tr key={p.part_id}><Td><Link to={`/parts/${p.part_id}`} className="font-mono text-brand-700 hover:underline">{p.part_number}</Link></Td><Td>{p.name}</Td><Td className="text-right tabular-nums">{qty(p.qty)}</Td><Td className="text-right tabular-nums">{money(p.value)}</Td></tr>)}</tbody></Table>
            ) : <Empty title="No purchases in this period" />}
          </Card>
          <Card title="Low stock parts" actions={<Link to="/inventory?status=ATTENTION" className="text-xs text-brand-700 hover:underline">View all</Link>} bodyClass="p-0">
            {d.lowStock.length ? (
              <Table><thead><tr><Th>Part</Th><Th>Name</Th><Th className="text-right">On hand</Th><Th className="text-right">Min</Th><Th>Status</Th></tr></thead>
                <tbody>{d.lowStock.map((p: any) => <tr key={p.id}><Td><Link to={`/parts/${p.id}`} className="font-mono text-brand-700 hover:underline">{p.part_number}</Link></Td><Td>{p.name}</Td><Td className="text-right tabular-nums">{qty(p.on_hand)}</Td><Td className="text-right tabular-nums">{qty(p.min_stock)}</Td><Td><StatusBadge status={p.stock_status} /></Td></tr>)}</tbody></Table>
            ) : <Empty title="No low-stock parts">Parts appear here once minimum stock levels are set.</Empty>}
          </Card>
          <Card title="Open PRs" actions={<Link to="/requests" className="text-xs text-brand-700 hover:underline">View all</Link>} bodyClass="p-0">
            {d.openPrList.length ? (
              <Table><tbody>{d.openPrList.map((p: any) => <tr key={p.id}><Td><Link to={`/requests/${p.id}`} className="font-mono text-brand-700 hover:underline">{p.prNumber}</Link></Td><Td>{p.requester.fullName}</Td><Td>{date(p.requestDate)}</Td><Td><StatusBadge status={p.status} /></Td></tr>)}</tbody></Table>
            ) : <Empty title="No open PRs" />}
          </Card>
          <Card title="Open POs" actions={<Link to="/purchase-orders?status=OPEN" className="text-xs text-brand-700 hover:underline">View all</Link>} bodyClass="p-0">
            {d.openPoList.length ? (
              <Table><tbody>{d.openPoList.map((p: any) => <tr key={p.id}><Td><Link to={`/purchase-orders/${p.id}`} className="font-mono text-brand-700 hover:underline">{p.poNumber}</Link></Td><Td>{p.supplier.name}</Td><Td>{date(p.expectedDelivery)}</Td><Td><StatusBadge status={p.status} /></Td></tr>)}</tbody></Table>
            ) : <Empty title="No open POs" />}
          </Card>
        </div>
      )}
    </div>
  );
}
