import { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { keepPreviousData, useMutation, useQuery } from '@tanstack/react-query';
import { PackageCheck } from 'lucide-react';
import { api, qs } from '../lib/api';
import { useAuth } from '../lib/auth';
import { useToast } from '../lib/toast';
import { date, qty, today } from '../lib/format';
import { Button, Card, Empty, ErrorState, ExportMenu, Field, Input, PageHeader, Pagination, Select, Spinner, StatusBadge, Table, Tabs, Td, Th } from '../components/ui';

export default function Receiving() {
  const [sp, setSp] = useSearchParams();
  const { can } = useAuth();
  const tab = (sp.get('tab') as 'open' | 'grns') ?? (can('grn.create') ? 'open' : 'grns');
  const page = Number(sp.get('page') ?? 1);
  const text = sp.get('q') ?? '';
  const [receivePo, setReceivePo] = useState<number | null>(null);
  const open = useQuery({ queryKey: ['pos', 'receivable'], queryFn: () => api.get('/pos?status=APPROVED,SENT,PARTIALLY_RECEIVED&pageSize=200'), enabled: tab === 'open' });
  const grns = useQuery({ queryKey: ['grns', page, text], queryFn: () => api.get(`/grns${qs({ page, q: text })}`), enabled: tab === 'grns', placeholderData: keepPreviousData });
  const po = useQuery({ queryKey: ['po', String(receivePo)], queryFn: () => api.get(`/pos/${receivePo}`), enabled: !!receivePo });
  return (
    <div>
      <PageHeader title="Goods receiving" actions={tab === 'grns' && can('export.run') && <ExportMenu url={`/grns/export${qs({ q: text })}`} />} />
      <Tabs value={tab} onChange={(t) => setSp({ tab: t })} tabs={[...(can('grn.create') ? [{ key: 'open' as const, label: 'Awaiting delivery' }] : []), { key: 'grns' as const, label: 'Goods receipt notes (GRN)' }]} />
      {tab === 'open' ? (
        receivePo ? (po.isLoading ? <Spinner /> : po.data && <ReceiveForm po={po.data} onDone={() => { setReceivePo(null); open.refetch(); }} onCancel={() => setReceivePo(null)} />) :
        open.isLoading ? <Spinner /> : open.error ? <ErrorState error={open.error} /> : !open.data.items.length ? <Card><Empty title="No purchase orders waiting for delivery" /></Card> : (
          <Card bodyClass="p-0"><Table>
            <thead><tr><Th>PO</Th><Th>Supplier</Th><Th>PO date</Th><Th>Expected</Th><Th>Status</Th><Th className="text-right">Lines</Th><Th /></tr></thead>
            <tbody>{open.data.items.map((p: any) => (
              <tr key={p.id} className="hover:bg-slate-50">
                <Td><Link to={`/purchase-orders/${p.id}`} className="font-mono font-semibold text-brand-700 hover:underline">{p.poNumber}</Link></Td>
                <Td>{p.supplier.name}</Td><Td>{date(p.poDate)}</Td><Td className={p.overdue ? 'font-semibold text-red-700' : ''}>{date(p.expectedDelivery)}{p.overdue ? ' (overdue)' : ''}</Td>
                <Td><StatusBadge status={p.status} /></Td><Td className="text-right">{p.lineCount}</Td>
                <Td><Button variant="primary" icon={<PackageCheck className="h-4 w-4" />} onClick={() => setReceivePo(p.id)}>Receive</Button></Td>
              </tr>
            ))}</tbody>
          </Table></Card>
        )
      ) : (
        <>
          <Input placeholder="GRN, PO or supplier…" value={text} onChange={(e) => setSp({ tab: 'grns', q: e.target.value })} className="mb-3 max-w-xs" />
          {grns.isLoading ? <Spinner /> : grns.error ? <ErrorState error={grns.error} /> : !grns.data.items.length ? <Card><Empty title="No goods receipts yet" /></Card> : (
            <Card bodyClass="p-0"><Table>
              <thead><tr><Th>GRN</Th><Th>Date</Th><Th>PO</Th><Th>Supplier</Th><Th>Received by</Th><Th className="text-right">Lines</Th><Th className="text-right">Received</Th><Th className="text-right">Rejected</Th></tr></thead>
              <tbody>{grns.data.items.map((g: any) => (
                <tr key={g.id} className="hover:bg-slate-50">
                  <Td><Link to={`/receiving/${g.id}`} className="font-mono font-semibold text-brand-700 hover:underline">{g.grnNumber}</Link></Td><Td>{date(g.receivedAt)}</Td>
                  <Td><Link to={`/purchase-orders/${g.po.id}`} className="font-mono text-brand-700 hover:underline">{g.po.poNumber}</Link></Td><Td>{g.po.supplier.name}</Td><Td>{g.receiver.fullName}</Td>
                  <Td className="text-right">{g.lineCount}</Td><Td className="text-right">{qty(g.receivedQty)}</Td><Td className="text-right">{qty(g.rejectedQty)}</Td>
                </tr>
              ))}</tbody>
            </Table>
            <div className="px-3"><Pagination page={page} pageSize={grns.data.pageSize} total={grns.data.total} onPage={(p) => setSp({ tab: 'grns', page: String(p), q: text })} /></div></Card>
          )}
        </>
      )}
    </div>
  );
}

/** Receiving form against a PO: ordered / already received / receive now / rejected / remaining. */
export function ReceiveForm({ po, onDone, onCancel }: { po: any; onDone: () => void; onCancel: () => void }) {
  const toast = useToast();
  const lookups = useQuery({ queryKey: ['lookups'], queryFn: () => api.get('/lookups'), staleTime: 60_000 });
  const warehouses = lookups.data?.warehouses ?? [];
  const [warehouseId, setWarehouseId] = useState<string>('');
  const wh = warehouses.find((w: any) => String(w.id) === warehouseId) ?? warehouses[0];
  const [h, setH] = useState({ receivedAt: today(), deliveryNote: '', notes: '' });
  const [lines, setLines] = useState(() => po.items.map((i: any) => ({ poItemId: i.id, lineNo: i.lineNo, partNumber: i.part.partNumber, description: i.description, unit: i.unit, ordered: Number(i.quantity), received: Number(i.qtyReceived), remaining: Number(i.quantity) - Number(i.qtyReceived), receivedQty: 0, rejectedQty: 0, locationId: '', condition: 'GOOD', notes: '' })));
  const upd = (i: number, k: string, v: unknown) => setLines(lines.map((l: any, n: number) => (n === i ? { ...l, [k]: v } : l)));
  const post = useMutation({
    mutationFn: () => api.post(`/pos/${po.id}/receive`, {
      warehouseId: wh.id, receivedAt: h.receivedAt, deliveryNote: h.deliveryNote || null, notes: h.notes || null,
      lines: lines.filter((l: any) => l.receivedQty > 0 || l.rejectedQty > 0).map((l: any) => ({ poItemId: l.poItemId, receivedQty: Number(l.receivedQty), rejectedQty: Number(l.rejectedQty), locationId: l.locationId ? Number(l.locationId) : undefined, condition: l.condition, notes: l.notes || null })),
    }),
    onSuccess: (g: any) => { toast.success(`${g.grnNumber} posted — stock updated`); onDone(); },
    onError: (e) => toast.error(e),
  });
  const over = lines.some((l: any) => Number(l.receivedQty) > l.remaining);
  const nothing = !lines.some((l: any) => Number(l.receivedQty) > 0 || Number(l.rejectedQty) > 0);
  return (
    <Card title={`Receive goods — ${po.poNumber} (${po.supplierSnapshot?.name ?? po.supplier?.name})`} actions={<>
      <Button onClick={onCancel}>Cancel</Button>
      <Button onClick={() => setLines(lines.map((l: any) => ({ ...l, receivedQty: l.remaining })))}>Receive all remaining</Button>
      <Button variant="primary" icon={<PackageCheck className="h-4 w-4" />} loading={post.isPending} disabled={over || nothing || !wh} onClick={() => post.mutate()}>Post GRN</Button>
    </>}>
      <div className="mb-4 grid gap-3 sm:grid-cols-4">
        <Field label="Receiving date"><Input type="date" value={h.receivedAt} onChange={(e) => setH({ ...h, receivedAt: e.target.value })} /></Field>
        <Field label="Warehouse"><Select value={wh?.id ?? ''} onChange={(e) => setWarehouseId(e.target.value)}>{warehouses.map((w: any) => <option key={w.id} value={w.id}>{w.code} — {w.name}</option>)}</Select></Field>
        <Field label="Supplier delivery note"><Input value={h.deliveryNote} onChange={(e) => setH({ ...h, deliveryNote: e.target.value })} /></Field>
        <Field label="Notes"><Input value={h.notes} onChange={(e) => setH({ ...h, notes: e.target.value })} /></Field>
      </div>
      <Table>
        <thead><tr><Th>#</Th><Th>Part</Th><Th>Description</Th><Th className="text-right">Ordered</Th><Th className="text-right">Already received</Th><Th>Receive now</Th><Th>Rejected</Th><Th className="text-right">Remaining after</Th><Th>Location</Th><Th>Condition</Th><Th>Notes</Th></tr></thead>
        <tbody>{lines.map((l: any, i: number) => {
          const after = l.remaining - Number(l.receivedQty || 0);
          return (
            <tr key={l.poItemId} className={l.remaining <= 0 ? 'opacity-50' : ''}>
              <Td>{l.lineNo}</Td><Td className="font-mono font-semibold">{l.partNumber}</Td><Td className="max-w-[200px]">{l.description}</Td>
              <Td className="text-right">{qty(l.ordered)} {l.unit}</Td><Td className="text-right">{qty(l.received)}</Td>
              <Td><Input type="number" min={0} max={l.remaining} step="any" value={l.receivedQty} disabled={l.remaining <= 0} onChange={(e) => upd(i, 'receivedQty', Math.max(0, Number(e.target.value)))} className={`w-24 ${Number(l.receivedQty) > l.remaining ? 'border-red-500' : ''}`} aria-label="Received quantity" /></Td>
              <Td><Input type="number" min={0} step="any" value={l.rejectedQty} disabled={l.remaining <= 0} onChange={(e) => upd(i, 'rejectedQty', Math.max(0, Number(e.target.value)))} className="w-20" aria-label="Rejected quantity" /></Td>
              <Td className={`text-right font-semibold ${after < 0 ? 'text-red-700' : after > 0 ? 'text-amber-700' : 'text-emerald-700'}`}>{qty(after)}</Td>
              <Td><Select value={l.locationId} onChange={(e) => upd(i, 'locationId', e.target.value)} className="w-32" aria-label="Location">{wh?.locations.map((x: any) => <option key={x.id} value={x.id}>{x.code}</option>)}</Select></Td>
              <Td><Select value={l.condition} onChange={(e) => upd(i, 'condition', e.target.value)} className="w-28" aria-label="Condition">{['GOOD', 'DAMAGED', 'WRONG_ITEM', 'REJECTED'].map((c) => <option key={c}>{c}</option>)}</Select></Td>
              <Td><Input value={l.notes} onChange={(e) => upd(i, 'notes', e.target.value)} className="w-40" /></Td>
            </tr>
          );
        })}</tbody>
      </Table>
      {over && <div className="mt-2 text-sm text-red-700">You cannot receive more than the remaining quantity.</div>}
      <p className="mt-2 text-xs text-slate-500">Accepted quantities are added to stock immediately. Rejected quantities are recorded on the GRN but not added to stock.</p>
    </Card>
  );
}
