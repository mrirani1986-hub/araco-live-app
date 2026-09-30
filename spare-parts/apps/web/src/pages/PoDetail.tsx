import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Check, FileSpreadsheet, FileText, Lock, PackageCheck, Pencil, Printer, Send, X } from 'lucide-react';
import { api, download, fileUrl, openDoc } from '../lib/api';
import { useAuth } from '../lib/auth';
import { useToast } from '../lib/toast';
import { date, dateTime, money, qty } from '../lib/format';
import { Button, Card, ConfirmDialog, ErrorState, Field, Input, KV, PageHeader, Spinner, StatusBadge, Table, Td, Textarea, Th, Thumb } from '../components/ui';
import { ReceiveForm } from './Receiving';

type Act = 'approve' | 'send' | 'cancel' | 'close';

export default function PoDetail() {
  const { id } = useParams();
  const nav = useNavigate();
  const { can } = useAuth();
  const toast = useToast();
  const qc = useQueryClient();
  const [act, setAct] = useState<Act | null>(null);
  const [editing, setEditing] = useState(false);
  const [receiving, setReceiving] = useState(false);
  const q = useQuery({ queryKey: ['po', id], queryFn: () => api.get(`/pos/${id}`) });
  if (q.isLoading) return <Spinner />;
  if (q.error) return <ErrorState error={q.error} />;
  const po = q.data;
  const sup = po.supplierSnapshot;
  const receivable = ['APPROVED', 'SENT', 'PARTIALLY_RECEIVED'].includes(po.status);
  const refresh = () => { qc.invalidateQueries({ queryKey: ['po', id] }); qc.invalidateQueries({ queryKey: ['pos'] }); };
  const cfg: Record<Act, { title: string; msg: string; btn: string; variant: 'primary' | 'danger' | 'success'; req?: boolean }> = {
    approve: { title: 'Approve purchase order', msg: 'After approval the PO can no longer be edited and can be sent to the supplier.', btn: 'Approve', variant: 'success' },
    send: { title: 'Mark as sent to supplier', msg: 'Download or print the PDF and send it to the supplier, then confirm here. The date is recorded.', btn: 'Mark as sent', variant: 'primary' },
    cancel: { title: 'Cancel purchase order', msg: 'The ordered quantities go back to the PR so they can be ordered again.', btn: 'Cancel PO', variant: 'danger', req: true },
    close: { title: 'Close purchase order', msg: 'Closes the PO even though not everything was received (remaining quantities will not be delivered).', btn: 'Close PO', variant: 'danger', req: true },
  };
  return (
    <div>
      <PageHeader back={<button onClick={() => nav('/purchase-orders')} className="mb-1 flex items-center gap-1 text-sm text-slate-500 hover:text-slate-800"><ArrowLeft className="h-4 w-4" />Purchase orders</button>}
        title={<span className="flex items-center gap-3"><span className="font-mono">{po.poNumber}</span><StatusBadge status={po.status} />{po.overdue && <StatusBadge status="OVERDUE" />}</span>}
        subtitle={`${sup.name} · ${date(po.poDate)}${po.prNumber ? ` · from ${po.prNumber}` : ''}`}
        actions={<>
          <Button icon={<Printer className="h-4 w-4" />} onClick={() => openDoc(`/pos/${id}/pdf`)}>Print</Button>
          <Button icon={<FileText className="h-4 w-4" />} onClick={() => download(`/pos/${id}/pdf?download=1`).catch(toast.error)}>PDF</Button>
          <Button icon={<FileSpreadsheet className="h-4 w-4" />} onClick={() => download(`/pos/${id}/xlsx`).catch(toast.error)}>Excel</Button>
          {po.status === 'DRAFT' && can('po.create') && <Button icon={<Pencil className="h-4 w-4" />} onClick={() => setEditing(true)}>Edit</Button>}
          {po.status === 'DRAFT' && can('po.approve') && <Button variant="success" icon={<Check className="h-4 w-4" />} onClick={() => setAct('approve')}>Approve</Button>}
          {po.status === 'APPROVED' && can('po.send') && <Button variant="primary" icon={<Send className="h-4 w-4" />} onClick={() => setAct('send')}>Send to supplier</Button>}
          {receivable && can('grn.create') && <Button variant="primary" icon={<PackageCheck className="h-4 w-4" />} onClick={() => setReceiving(true)}>Receive goods</Button>}
          {['DRAFT', 'APPROVED', 'SENT'].includes(po.status) && !po.items.some((i: any) => Number(i.qtyReceived) > 0) && can('po.create') && <Button variant="ghost" icon={<X className="h-4 w-4" />} onClick={() => setAct('cancel')}>Cancel</Button>}
          {receivable && po.items.some((i: any) => Number(i.qtyReceived) > 0) && can('po.create', 'grn.create') && <Button variant="ghost" icon={<Lock className="h-4 w-4" />} onClick={() => setAct('close')}>Close</Button>}
        </>} />
      {receiving && <div className="mb-4"><ReceiveForm po={po} onDone={() => { setReceiving(false); refresh(); }} onCancel={() => setReceiving(false)} /></div>}
      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="Supplier"><KV cols={1} items={[['Supplier', <Link to={`/suppliers/${po.supplierId}`} className="text-brand-700 hover:underline">{sup.name}</Link>], ['Address', [sup.address, sup.country].filter(Boolean).join(', ')], ['Contact', sup.contactPerson], ['Phone', sup.phone], ['Email', sup.email], ['Tax number', sup.taxNumber]]} /></Card>
        <Card title="Order"><KV cols={1} items={[['Company', po.company?.name], ['PO date', date(po.poDate)], ['Reference PR', po.prId ? <Link to={`/requests/${po.prId}`} className="font-mono text-brand-700 hover:underline">{po.prNumber}</Link> : null], ['Currency', po.currency], ['Payment terms', po.paymentTerms], ['Delivery terms', po.deliveryTerms], ['Expected delivery', date(po.expectedDelivery)], ['Shipping method', po.shippingMethod], ['Buyer', po.buyer.fullName], ['Sent', po.sentAt ? dateTime(po.sentAt) : null]]} /></Card>
      </div>
      {editing ? <EditPo po={po} onDone={() => { setEditing(false); refresh(); }} /> : (
        <Card title="Items" className="mt-4" bodyClass="p-0">
          <Table>
            <thead><tr><Th>#</Th><Th>Picture</Th><Th>Part Number</Th><Th>Description</Th><Th>Specification</Th><Th className="text-right">Qty</Th><Th>Unit</Th><Th className="text-right">Unit price</Th><Th className="text-right">Disc.</Th><Th className="text-right">Tax</Th><Th className="text-right">Line total</Th><Th className="text-right">Received</Th><Th className="text-right">Remaining</Th></tr></thead>
            <tbody>{po.items.map((i: any) => (
              <tr key={i.id}>
                <Td>{i.lineNo}</Td><Td><Thumb src={fileUrl(i.picture)} alt="" className="h-12 w-16 rounded border" /></Td>
                <Td><Link to={`/parts/${i.partId}`} className="font-mono font-semibold text-brand-700 hover:underline">{i.part.partNumber}</Link>{i.supplierPartNumber && <div className="text-xs text-slate-500">Sup: {i.supplierPartNumber}</div>}</Td>
                <Td className="max-w-[220px]">{i.description}</Td><Td className="max-w-[160px] text-slate-600">{i.specification ?? '—'}</Td>
                <Td className="text-right tabular-nums">{qty(i.quantity)}</Td><Td>{i.unit}</Td><Td className="text-right tabular-nums">{money(i.unitPrice)}</Td>
                <Td className="text-right">{Number(i.discountPct) ? `${Number(i.discountPct)}%` : '—'}</Td><Td className="text-right">{Number(i.taxPct)}%</Td>
                <Td className="text-right font-semibold tabular-nums">{money(i.lineTotal)}</Td>
                <Td className="text-right tabular-nums">{qty(i.qtyReceived)}</Td><Td className={`text-right font-semibold tabular-nums ${i.remaining > 0 ? 'text-amber-700' : 'text-emerald-700'}`}>{qty(i.remaining)}</Td>
              </tr>
            ))}</tbody>
          </Table>
          <div className="flex justify-end border-t p-3">
            <table className="text-sm"><tbody>
              {[['Subtotal', po.totals.subtotal], ['Discount', -po.totals.discount], ['Tax', po.totals.tax], ['Shipping', po.totals.shipping], ['Other charges', po.totals.other]].map(([k, v]) => <tr key={k as string}><td className="pr-8 text-slate-500">{k}</td><td className="text-right tabular-nums">{money(v, po.currency)}</td></tr>)}
              <tr className="text-base font-bold"><td className="pr-8 pt-1">Grand total</td><td className="pt-1 text-right tabular-nums">{money(po.totals.grandTotal, po.currency)}</td></tr>
            </tbody></table>
          </div>
        </Card>
      )}
      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <Card title="Goods receipts" bodyClass="p-0">
          {po.receipts.length ? (
            <Table><thead><tr><Th>GRN</Th><Th>Date</Th><Th>Received by</Th><Th className="text-right">Qty received</Th></tr></thead>
              <tbody>{po.receipts.map((g: any) => <tr key={g.id}><Td><Link to={`/receiving/${g.id}`} className="font-mono text-brand-700 hover:underline">{g.grnNumber}</Link></Td><Td>{date(g.receivedAt)}</Td><Td>{g.receiver.fullName}</Td><Td className="text-right">{qty(g.items.reduce((a: number, x: any) => a + Number(x.receivedQty), 0))}</Td></tr>)}</tbody></Table>
          ) : <div className="p-4 text-sm text-slate-500">Nothing received yet.</div>}
        </Card>
        <Card title="History">
          <ol className="space-y-2 text-sm">
            <li><StatusBadge status="DRAFT" /> created by {po.buyer.fullName} · {dateTime(po.createdAt)}</li>
            {po.approvals.map((a: any) => <li key={a.id}><StatusBadge status={a.action} /> {a.user.fullName} · {dateTime(a.createdAt)}{a.comment && <span className="italic text-slate-500"> — “{a.comment}”</span>}</li>)}
          </ol>
          {po.terms && <><h3 className="mb-1 mt-4 text-xs font-semibold uppercase text-slate-500">Terms &amp; conditions</h3><p className="whitespace-pre-line text-xs text-slate-600">{po.terms}</p></>}
        </Card>
      </div>
      {act && <ConfirmDialog open onClose={() => setAct(null)} title={cfg[act].title} message={cfg[act].msg} confirmText={cfg[act].btn} variant={cfg[act].variant} withComment commentRequired={cfg[act].req} commentLabel={cfg[act].req ? 'Reason' : 'Comment'}
        onConfirm={async (c) => { await api.post(`/pos/${id}/${act}`, { comment: c || null }); toast.success(`${po.poNumber} updated`); refresh(); }} />}
    </div>
  );
}

function EditPo({ po, onDone }: { po: any; onDone: () => void }) {
  const toast = useToast();
  const [h, setH] = useState({ currency: po.currency, paymentTerms: po.paymentTerms ?? '', deliveryTerms: po.deliveryTerms ?? '', expectedDelivery: po.expectedDelivery?.slice(0, 10) ?? '', shippingMethod: po.shippingMethod ?? '', shippingCost: Number(po.shippingCost), otherCharges: Number(po.otherCharges), terms: po.terms ?? '', notes: po.notes ?? '' });
  const [lines, setLines] = useState(po.items.map((i: any) => ({ id: i.id, lineNo: i.lineNo, partNumber: i.part.partNumber, quantity: Number(i.quantity), unitPrice: Number(i.unitPrice), discountPct: Number(i.discountPct), taxPct: Number(i.taxPct), supplierPartNumber: i.supplierPartNumber ?? '' })));
  const save = useMutation({
    mutationFn: () => api.patch(`/pos/${po.id}`, { ...h, expectedDelivery: h.expectedDelivery || null, lines: lines.map((l: any) => ({ ...l, lineNo: undefined, partNumber: undefined, supplierPartNumber: l.supplierPartNumber || null })) }),
    onSuccess: () => { toast.success('PO updated'); onDone(); },
    onError: (e) => toast.error(e),
  });
  const upd = (i: number, k: string, v: unknown) => setLines(lines.map((l: any, n: number) => (n === i ? { ...l, [k]: v } : l)));
  return (
    <Card title="Edit purchase order" className="mt-4" actions={<><Button onClick={onDone}>Cancel</Button><Button variant="primary" loading={save.isPending} onClick={() => save.mutate()}>Save</Button></>}>
      <div className="grid gap-3 sm:grid-cols-4">
        <Field label="Currency"><Input maxLength={3} value={h.currency} onChange={(e) => setH({ ...h, currency: e.target.value.toUpperCase() })} /></Field>
        <Field label="Payment terms"><Input value={h.paymentTerms} onChange={(e) => setH({ ...h, paymentTerms: e.target.value })} /></Field>
        <Field label="Delivery terms"><Input value={h.deliveryTerms} onChange={(e) => setH({ ...h, deliveryTerms: e.target.value })} /></Field>
        <Field label="Expected delivery"><Input type="date" value={h.expectedDelivery} onChange={(e) => setH({ ...h, expectedDelivery: e.target.value })} /></Field>
        <Field label="Shipping method"><Input value={h.shippingMethod} onChange={(e) => setH({ ...h, shippingMethod: e.target.value })} /></Field>
        <Field label="Shipping cost"><Input type="number" min={0} value={h.shippingCost} onChange={(e) => setH({ ...h, shippingCost: Number(e.target.value) })} /></Field>
        <Field label="Other charges"><Input type="number" min={0} value={h.otherCharges} onChange={(e) => setH({ ...h, otherCharges: Number(e.target.value) })} /></Field>
        <Field label="Notes"><Input value={h.notes} onChange={(e) => setH({ ...h, notes: e.target.value })} /></Field>
        <Field label="Terms & conditions" className="sm:col-span-4"><Textarea rows={4} value={h.terms} onChange={(e) => setH({ ...h, terms: e.target.value })} /></Field>
      </div>
      <Table className="mt-4">
        <thead><tr><Th>#</Th><Th>Part</Th><Th>Supplier part no.</Th><Th>Qty</Th><Th>Unit price</Th><Th>Disc. %</Th><Th>Tax %</Th></tr></thead>
        <tbody>{lines.map((l: any, i: number) => (
          <tr key={l.id}><Td>{l.lineNo}</Td><Td className="font-mono">{l.partNumber}</Td>
            <Td><Input value={l.supplierPartNumber} onChange={(e) => upd(i, 'supplierPartNumber', e.target.value)} className="w-40" /></Td>
            <Td><Input type="number" min={0} step="any" value={l.quantity} onChange={(e) => upd(i, 'quantity', Number(e.target.value))} className="w-24" /></Td>
            <Td><Input type="number" min={0} step="0.01" value={l.unitPrice} onChange={(e) => upd(i, 'unitPrice', Number(e.target.value))} className="w-28" /></Td>
            <Td><Input type="number" min={0} max={100} value={l.discountPct} onChange={(e) => upd(i, 'discountPct', Number(e.target.value))} className="w-20" /></Td>
            <Td><Input type="number" min={0} max={100} value={l.taxPct} onChange={(e) => upd(i, 'taxPct', Number(e.target.value))} className="w-20" /></Td></tr>
        ))}</tbody>
      </Table>
    </Card>
  );
}
