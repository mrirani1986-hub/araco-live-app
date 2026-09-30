import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMutation, useQuery } from '@tanstack/react-query';
import { ArrowLeft, Trash2 } from 'lucide-react';
import { api } from '../lib/api';
import { useToast } from '../lib/toast';
import { money } from '../lib/format';
import { CompanyField } from '../components/parts';
import { Button, Card, Field, Input, PageHeader, Select, Table, Td, Textarea, Th } from '../components/ui';

/** Purchase order without a PR (e.g. urgent or stock replenishment by procurement). */
export default function PoNew() {
  const nav = useNavigate();
  const toast = useToast();
  const lookups = useQuery({ queryKey: ['lookups'], queryFn: () => api.get('/lookups'), staleTime: 60_000 });
  const settings = useQuery({ queryKey: ['settings'], queryFn: () => api.get('/settings') });
  const [supplierId, setSupplierId] = useState('');
  const [h, setH] = useState({ companyId: '', expectedDelivery: '', shippingMethod: '', paymentTerms: '', deliveryTerms: '', shippingCost: '', notes: '' });
  const [lines, setLines] = useState<any[]>([]);
  const [search, setSearch] = useState('');
  const found = useQuery({ queryKey: ['parts-mini', search], queryFn: () => api.get(`/parts?q=${encodeURIComponent(search)}&pageSize=8`), enabled: search.length > 1 });
  const create = useMutation({
    mutationFn: () => api.post('/pos', { supplierId: Number(supplierId), ...h, companyId: h.companyId ? Number(h.companyId) : null, expectedDelivery: h.expectedDelivery || null, shippingCost: h.shippingCost === '' ? undefined : Number(h.shippingCost), paymentTerms: h.paymentTerms || undefined, deliveryTerms: h.deliveryTerms || undefined, lines: lines.map((l) => ({ partId: l.partId, quantity: Number(l.quantity), unitPrice: Number(l.unitPrice || 0), discountPct: Number(l.discountPct || 0), taxPct: Number(l.taxPct || 0) })) }),
    onSuccess: (po: any) => { toast.success(`${po.poNumber} created`); nav(`/purchase-orders/${po.id}`); },
    onError: (e) => toast.error(e),
  });
  const upd = (i: number, k: string, v: unknown) => setLines(lines.map((l, n) => (n === i ? { ...l, [k]: v } : l)));
  const total = lines.reduce((a, l) => a + Number(l.quantity) * Number(l.unitPrice || 0) * (1 - Number(l.discountPct || 0) / 100) * (1 + Number(l.taxPct || 0) / 100), 0);
  return (
    <div>
      <PageHeader back={<button onClick={() => nav(-1)} className="mb-1 flex items-center gap-1 text-sm text-slate-500"><ArrowLeft className="h-4 w-4" />Back</button>} title="New purchase order"
        actions={<Button variant="primary" loading={create.isPending} disabled={!supplierId || !lines.length || lines.some((l) => !(Number(l.quantity) > 0))} onClick={() => create.mutate()}>Create PO</Button>} />
      <Card>
        <div className="grid gap-3 sm:grid-cols-3">
          <CompanyField value={h.companyId} onChange={(v) => setH({ ...h, companyId: v })} hint="Buying company printed on the PO" />
          <Field label="Supplier" required><Select value={supplierId} onChange={(e) => setSupplierId(e.target.value)}><option value="">Select…</option>{lookups.data?.suppliers?.map((s: any) => <option key={s.id} value={s.id}>{s.name}</option>)}</Select></Field>
          <Field label="Expected delivery"><Input type="date" value={h.expectedDelivery} onChange={(e) => setH({ ...h, expectedDelivery: e.target.value })} /></Field>
          <Field label="Shipping method"><Input value={h.shippingMethod} onChange={(e) => setH({ ...h, shippingMethod: e.target.value })} /></Field>
          <Field label="Payment terms"><Input value={h.paymentTerms} onChange={(e) => setH({ ...h, paymentTerms: e.target.value })} placeholder="Supplier default" /></Field>
          <Field label="Delivery terms"><Input value={h.deliveryTerms} onChange={(e) => setH({ ...h, deliveryTerms: e.target.value })} placeholder="Supplier default" /></Field>
          <Field label="Shipping cost"><Input type="number" min={0} value={h.shippingCost} onChange={(e) => setH({ ...h, shippingCost: e.target.value })} /></Field>
          <Field label="Notes" className="sm:col-span-3"><Textarea rows={2} value={h.notes} onChange={(e) => setH({ ...h, notes: e.target.value })} /></Field>
        </div>
      </Card>
      <Card title="Lines" className="mt-4">
        <Table>
          <thead><tr><Th>Part</Th><Th>Qty</Th><Th>Unit price</Th><Th>Disc. %</Th><Th>Tax %</Th><Th /></tr></thead>
          <tbody>{lines.map((l, i) => (
            <tr key={l.partId}><Td><span className="font-mono font-semibold">{l.partNumber}</span> {l.name}</Td>
              <Td><Input type="number" min={0} step="any" value={l.quantity} onChange={(e) => upd(i, 'quantity', e.target.value)} className="w-24" /></Td>
              <Td><Input type="number" min={0} step="0.01" value={l.unitPrice} onChange={(e) => upd(i, 'unitPrice', e.target.value)} className="w-28" /></Td>
              <Td><Input type="number" min={0} max={100} value={l.discountPct} onChange={(e) => upd(i, 'discountPct', e.target.value)} className="w-20" /></Td>
              <Td><Input type="number" min={0} max={100} value={l.taxPct} onChange={(e) => upd(i, 'taxPct', e.target.value)} className="w-20" /></Td>
              <Td><Button variant="ghost" aria-label="Remove" onClick={() => setLines(lines.filter((_, n) => n !== i))}><Trash2 className="h-4 w-4 text-red-600" /></Button></Td></tr>
          ))}</tbody>
        </Table>
        <div className="relative mt-3 max-w-md">
          <Input placeholder="Add a part: type number or name…" value={search} onChange={(e) => setSearch(e.target.value)} />
          {search.length > 1 && found.data?.items?.length > 0 && (
            <div className="absolute z-20 mt-1 w-full rounded-md border bg-white shadow-lg">
              {found.data.items.map((p: any) => (
                <button key={p.id} className="block w-full px-3 py-1.5 text-left text-sm hover:bg-slate-50" onClick={() => { if (!lines.some((l) => l.partId === p.id)) setLines([...lines, { partId: p.id, partNumber: p.partNumber, name: p.name, quantity: 1, unitPrice: p.price ?? '', discountPct: 0, taxPct: settings.data?.taxRate ?? 0 }]); setSearch(''); }}>
                  <span className="font-mono font-semibold">{p.partNumber}</span> {p.name}
                </button>
              ))}
            </div>
          )}
        </div>
        <div className="mt-3 text-right text-base font-bold">Total: {money(total)}</div>
      </Card>
    </div>
  );
}
