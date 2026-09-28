import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQuery } from '@tanstack/react-query';
import { ArrowLeft, FilePlus2 } from 'lucide-react';
import { api } from '../lib/api';
import { useToast } from '../lib/toast';
import { money, qty } from '../lib/format';
import { Button, Card, ErrorState, Field, Input, PageHeader, Select, Spinner, Table, Td, Textarea, Th } from '../components/ui';

/** Converts an approved PR into one PO per supplier. */
export default function PoFromPr() {
  const { prId } = useParams();
  const nav = useNavigate();
  const toast = useToast();
  const pr = useQuery({ queryKey: ['pr', prId], queryFn: () => api.get(`/prs/${prId}`) });
  const lookups = useQuery({ queryKey: ['lookups'], queryFn: () => api.get('/lookups'), staleTime: 60_000 });
  const settings = useQuery({ queryKey: ['settings'], queryFn: () => api.get('/settings') });
  const [lines, setLines] = useState<any[]>([]);
  const [h, setH] = useState({ expectedDelivery: '', shippingMethod: '', shippingCost: '', otherCharges: '', paymentTerms: '', deliveryTerms: '', notes: '' });
  useEffect(() => {
    if (pr.data && settings.data) setLines(pr.data.items.filter((i: any) => Number(i.quantity) > Number(i.qtyOrdered)).map((i: any) => ({
      include: true, prItemId: i.id, lineNo: i.lineNo, partNumber: i.part.partNumber, name: i.description, unit: i.unit,
      open: Number(i.quantity) - Number(i.qtyOrdered), quantity: Number(i.quantity) - Number(i.qtyOrdered), unitPrice: i.estUnitPrice ?? '',
      supplierId: i.supplierId ? String(i.supplierId) : '', discountPct: 0, taxPct: settings.data.taxRate,
    })));
  }, [pr.data, settings.data]);
  const groups = useMemo(() => {
    const g = new Map<string, any[]>();
    for (const l of lines.filter((x) => x.include)) g.set(l.supplierId || 'none', [...(g.get(l.supplierId || 'none') ?? []), l]);
    return g;
  }, [lines]);
  const create = useMutation({
    mutationFn: () => api.post(`/pos/from-pr/${prId}`, {
      expectedDelivery: h.expectedDelivery || null, shippingMethod: h.shippingMethod || null, shippingCost: h.shippingCost === '' ? undefined : Number(h.shippingCost),
      otherCharges: h.otherCharges === '' ? undefined : Number(h.otherCharges), paymentTerms: h.paymentTerms || undefined, deliveryTerms: h.deliveryTerms || undefined, notes: h.notes || null,
      lines: lines.filter((l) => l.include).map((l) => ({ prItemId: l.prItemId, supplierId: Number(l.supplierId), quantity: Number(l.quantity), unitPrice: Number(l.unitPrice || 0), discountPct: Number(l.discountPct || 0), taxPct: Number(l.taxPct || 0) })),
    }),
    onSuccess: (pos: any[]) => { toast.success(`Created ${pos.map((p) => p.poNumber).join(', ')}`); nav(pos.length === 1 ? `/purchase-orders/${pos[0].id}` : `/purchase-orders?q=${pr.data.prNumber}`); },
    onError: (e) => toast.error(e),
  });
  if (pr.isLoading || settings.isLoading) return <Spinner />;
  if (pr.error) return <ErrorState error={pr.error} />;
  const upd = (i: number, k: string, v: unknown) => setLines(lines.map((l, n) => (n === i ? { ...l, [k]: v } : l)));
  const missingSupplier = lines.some((l) => l.include && !l.supplierId);
  const invalid = lines.some((l) => l.include && (!(Number(l.quantity) > 0) || Number(l.quantity) > l.open));
  const supName = (id: string) => lookups.data?.suppliers?.find((s: any) => String(s.id) === id)?.name ?? '—';
  return (
    <div>
      <PageHeader back={<button onClick={() => nav(-1)} className="mb-1 flex items-center gap-1 text-sm text-slate-500"><ArrowLeft className="h-4 w-4" />Back</button>}
        title={`Create PO from ${pr.data.prNumber}`} subtitle="Choose the supplier and price for each line. One purchase order is created per supplier."
        actions={<Button variant="primary" icon={<FilePlus2 className="h-4 w-4" />} loading={create.isPending} disabled={missingSupplier || invalid || !lines.some((l) => l.include)} onClick={() => create.mutate()}>Create {groups.size} PO{groups.size === 1 ? '' : 's'}</Button>} />
      {pr.data.status !== 'APPROVED' && <div className="mb-3 rounded-md bg-red-50 px-3 py-2 text-sm text-red-800">This PR is {pr.data.status}; only approved PRs can be converted.</div>}
      <Card title="Lines" bodyClass="p-0">
        <Table>
          <thead><tr><Th /><Th>#</Th><Th>Part</Th><Th>Description</Th><Th className="text-right">Open qty</Th><Th>Order qty</Th><Th>Supplier</Th><Th>Unit price</Th><Th>Disc. %</Th><Th>Tax %</Th><Th className="text-right">Line total</Th></tr></thead>
          <tbody>{lines.map((l, i) => {
            const total = Number(l.quantity) * Number(l.unitPrice || 0) * (1 - Number(l.discountPct || 0) / 100) * (1 + Number(l.taxPct || 0) / 100);
            return (
              <tr key={l.prItemId} className={l.include ? '' : 'opacity-50'}>
                <Td><input type="checkbox" checked={l.include} onChange={(e) => upd(i, 'include', e.target.checked)} aria-label="Include line" /></Td>
                <Td>{l.lineNo}</Td><Td className="font-mono font-semibold">{l.partNumber}</Td><Td className="max-w-[200px]">{l.name}</Td>
                <Td className="text-right">{qty(l.open)} {l.unit}</Td>
                <Td><Input type="number" min={0} max={l.open} step="any" value={l.quantity} onChange={(e) => upd(i, 'quantity', e.target.value)} className="w-24" /></Td>
                <Td><Select value={l.supplierId} onChange={(e) => upd(i, 'supplierId', e.target.value)} className="w-52"><option value="">Select supplier…</option>{lookups.data?.suppliers?.map((s: any) => <option key={s.id} value={s.id}>{s.name}</option>)}</Select></Td>
                <Td><Input type="number" min={0} step="0.01" value={l.unitPrice} onChange={(e) => upd(i, 'unitPrice', e.target.value)} className="w-28" /></Td>
                <Td><Input type="number" min={0} max={100} value={l.discountPct} onChange={(e) => upd(i, 'discountPct', e.target.value)} className="w-20" /></Td>
                <Td><Input type="number" min={0} max={100} value={l.taxPct} onChange={(e) => upd(i, 'taxPct', e.target.value)} className="w-20" /></Td>
                <Td className="text-right tabular-nums">{money(total)}</Td>
              </tr>
            );
          })}</tbody>
        </Table>
      </Card>
      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <Card title="Order details (applies to all POs; supplier defaults used when empty)">
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Expected delivery"><Input type="date" value={h.expectedDelivery} onChange={(e) => setH({ ...h, expectedDelivery: e.target.value })} /></Field>
            <Field label="Shipping method"><Input value={h.shippingMethod} onChange={(e) => setH({ ...h, shippingMethod: e.target.value })} placeholder="Road freight, courier…" /></Field>
            <Field label="Payment terms"><Input value={h.paymentTerms} onChange={(e) => setH({ ...h, paymentTerms: e.target.value })} /></Field>
            <Field label="Delivery terms"><Input value={h.deliveryTerms} onChange={(e) => setH({ ...h, deliveryTerms: e.target.value })} /></Field>
            <Field label="Shipping cost (per PO)"><Input type="number" min={0} value={h.shippingCost} onChange={(e) => setH({ ...h, shippingCost: e.target.value })} /></Field>
            <Field label="Other charges (per PO)"><Input type="number" min={0} value={h.otherCharges} onChange={(e) => setH({ ...h, otherCharges: e.target.value })} /></Field>
            <Field label="Notes" className="sm:col-span-2"><Textarea rows={2} value={h.notes} onChange={(e) => setH({ ...h, notes: e.target.value })} /></Field>
          </div>
        </Card>
        <Card title="Purchase orders to be created">
          {[...groups.entries()].map(([sid, ls]) => (
            <div key={sid} className="mb-2 flex items-center justify-between rounded border px-3 py-2 text-sm">
              <span className={sid === 'none' ? 'text-red-700' : 'font-medium'}>{sid === 'none' ? 'No supplier selected' : supName(sid)}</span>
              <span className="text-slate-500">{ls.length} line(s)</span>
            </div>
          ))}
        </Card>
      </div>
    </div>
  );
}
