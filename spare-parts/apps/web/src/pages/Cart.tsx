import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ClipboardList, ShoppingCart, Trash2 } from 'lucide-react';
import { api, fileUrl } from '../lib/api';
import { useAuth } from '../lib/auth';
import { useToast } from '../lib/toast';
import { date, money } from '../lib/format';
import { Button, Card, ConfirmDialog, Empty, ErrorState, Field, Input, PageHeader, Select, Spinner, Table, Td, Textarea, Th, Thumb } from '../components/ui';
import { QtyStepper } from '../components/parts';

export default function Cart() {
  const qc = useQueryClient();
  const toast = useToast();
  const nav = useNavigate();
  const { me, can } = useAuth();
  const q = useQuery({ queryKey: ['cart'], queryFn: () => api.get('/cart') });
  const [clearing, setClearing] = useState(false);
  const [h, setH] = useState({ department: me?.department ?? '', project: '', requiredDate: '', priority: 'NORMAL', reason: '', notes: '' });
  const update = useMutation({
    mutationFn: ({ id, body }: { id: number; body: object }) => api.patch(`/cart/${id}`, body),
    onSuccess: (d) => qc.setQueryData(['cart'], d),
    onError: (e) => toast.error(e),
  });
  const remove = useMutation({ mutationFn: (id: number) => api.del(`/cart/${id}`), onSuccess: (d) => qc.setQueryData(['cart'], d), onError: (e) => toast.error(e) });
  const checkout = useMutation({
    mutationFn: () => api.post('/cart/checkout', { ...h, requiredDate: h.requiredDate || null }),
    onSuccess: (pr: any) => { toast.success(`${pr.prNumber} created. Review it and press Submit.`); qc.invalidateQueries({ queryKey: ['cart'] }); nav(`/requests/${pr.id}`); },
    onError: (e) => toast.error(e),
  });
  if (q.isLoading) return <Spinner />;
  if (q.error) return <ErrorState error={q.error} />;
  const c = q.data;
  return (
    <div>
      <PageHeader title="Spare parts request" subtitle="Your request cart — review quantities, then create a purchase requisition" actions={c.count > 0 && <Button variant="ghost" icon={<Trash2 className="h-4 w-4" />} onClick={() => setClearing(true)}>Empty cart</Button>} />
      {!c.count ? (
        <Card><Empty title="Your request is empty" icon={<ShoppingCart className="h-9 w-9 text-slate-300" />}>Find parts in the <Link to="/parts" className="text-brand-700 underline">catalogue</Link> and press “Add to request”.</Empty></Card>
      ) : (
        <div className="grid gap-4 2xl:grid-cols-[minmax(0,1fr)_360px]">
          <Card bodyClass="p-0">
            <Table>
              <thead><tr><Th>#</Th><Th>Picture</Th><Th>Part Number</Th><Th>Description</Th><Th>Qty</Th><Th>Unit</Th><Th className="text-right">Price</Th><Th className="text-right">Total</Th><Th>Required / reason</Th><Th /></tr></thead>
              <tbody>{c.items.map((i: any, n: number) => (
                <tr key={i.id} className="align-top">
                  <Td className="text-slate-500">{n + 1}</Td>
                  <Td><Thumb src={fileUrl(i.picture)} alt="" className="h-12 w-16 rounded border" /></Td>
                  <Td><Link to={`/parts/${i.partId}`} className="font-mono font-semibold text-brand-700 hover:underline">{i.partNumber}</Link></Td>
                  <Td className="max-w-[240px]"><div className="font-medium">{i.name}</div>{i.description && <div className="text-xs text-slate-500">{i.description}</div>}{i.supplier && <div className="text-xs text-slate-500">Supplier: {i.supplier.name}</div>}</Td>
                  <Td><QtyStepper value={i.quantity} min={1} onChange={(v) => v > 0 && update.mutate({ id: i.id, body: { quantity: v } })} /></Td>
                  <Td>{i.unit}</Td>
                  <Td className="text-right tabular-nums">{i.price != null ? money(i.price) : <span className="text-xs text-slate-400">no price</span>}</Td>
                  <Td className="text-right font-semibold tabular-nums">{i.lineTotal != null ? money(i.lineTotal) : '—'}</Td>
                  <Td className="text-xs text-slate-600">{i.requiredDate ? date(i.requiredDate) : ''}{i.reason ? ` · ${i.reason}` : ''}{i.equipment ? <div>{i.equipment}</div> : null}{i.machine ? <div>{i.machine}</div> : null}{i.project ? <div>Project: {i.project}</div> : null}</Td>
                  <Td><Button variant="ghost" aria-label="Remove" title="Remove" onClick={() => remove.mutate(i.id)}><Trash2 className="h-4 w-4 text-red-600" /></Button></Td>
                </tr>
              ))}</tbody>
              <tfoot><tr><Td colSpan={7} className="text-right font-semibold">Estimated total{c.unpriced ? ` (${c.unpriced} line(s) without price)` : ''}</Td><Td className="text-right text-base font-bold tabular-nums">{money(c.total, c.currency)}{c.mixedCurrencies ? ' (mixed currencies)' : ''}</Td><Td colSpan={2} /></tr></tfoot>
            </Table>
          </Card>
          <Card title="Create purchase requisition">
            <div className="space-y-3">
              <Field label="Department"><Input value={h.department} onChange={(e) => setH({ ...h, department: e.target.value })} /></Field>
              <Field label="Project"><Input value={h.project} onChange={(e) => setH({ ...h, project: e.target.value })} /></Field>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Required date"><Input type="date" value={h.requiredDate} onChange={(e) => setH({ ...h, requiredDate: e.target.value })} /></Field>
                <Field label="Priority"><Select value={h.priority} onChange={(e) => setH({ ...h, priority: e.target.value })}>{['LOW', 'NORMAL', 'HIGH', 'URGENT'].map((p) => <option key={p}>{p}</option>)}</Select></Field>
              </div>
              <Field label="Reason"><Input value={h.reason} onChange={(e) => setH({ ...h, reason: e.target.value })} placeholder="e.g. Planned maintenance" /></Field>
              <Field label="Notes"><Textarea rows={2} value={h.notes} onChange={(e) => setH({ ...h, notes: e.target.value })} /></Field>
              <Button variant="primary" className="w-full py-2" icon={<ClipboardList className="h-4 w-4" />} loading={checkout.isPending} disabled={!can('pr.create')} onClick={() => checkout.mutate()}>Create PR from {c.count} item(s)</Button>
              <p className="text-xs text-slate-500">The PR gets its number now and stays a draft until you submit it for approval.</p>
            </div>
          </Card>
        </div>
      )}
      <ConfirmDialog open={clearing} onClose={() => setClearing(false)} title="Empty the request cart?" message="All items will be removed from your cart." variant="danger" confirmText="Empty cart"
        onConfirm={async () => qc.setQueryData(['cart'], await api.del('/cart'))} />
    </div>
  );
}
