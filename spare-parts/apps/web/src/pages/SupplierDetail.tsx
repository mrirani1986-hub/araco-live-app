import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Pencil, Trash2 } from 'lucide-react';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import { useToast } from '../lib/toast';
import { date, money, qty } from '../lib/format';
import { Badge, Button, Card, ConfirmDialog, Empty, ErrorState, KV, PageHeader, Spinner, StatusBadge, Table, Td, Th } from '../components/ui';
import { SupplierForm } from './Suppliers';

export default function SupplierDetail() {
  const { id } = useParams();
  const nav = useNavigate();
  const { can } = useAuth();
  const toast = useToast();
  const qc = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [removing, setRemoving] = useState<any>(null);
  const q = useQuery({ queryKey: ['supplier', id], queryFn: () => api.get(`/suppliers/${id}`) });
  if (q.isLoading) return <Spinner />;
  if (q.error) return <ErrorState error={q.error} />;
  const s = q.data;
  const h = s.history;
  return (
    <div>
      <PageHeader back={<button onClick={() => nav('/suppliers')} className="mb-1 flex items-center gap-1 text-sm text-slate-500"><ArrowLeft className="h-4 w-4" />Suppliers</button>}
        title={<span className="flex items-center gap-3">{s.name}<StatusBadge status={s.status} /></span>} subtitle={s.code}
        actions={can('suppliers.manage') && <Button icon={<Pencil className="h-4 w-4" />} onClick={() => setEditing(true)}>Edit</Button>} />
      <div className="grid gap-4 lg:grid-cols-3">
        <Card title="Details" className="lg:col-span-2"><KV items={[['Supplier ID', s.code], ['Company', s.company], ['Contact person', s.contactPerson], ['Phone', s.phone], ['Email', s.email], ['Address', s.address], ['Country', s.country], ['Currency', s.currency], ['Payment terms', s.paymentTerms], ['Delivery terms', s.deliveryTerms], ['Tax number', s.taxNumber], ['Notes', s.notes]]} /></Card>
        <Card title="Purchasing summary"><KV cols={1} items={[['Purchase orders', h.poCount], ['Total purchase value', money(h.totalPurchaseValue, s.currency)], ['Last purchase', date(h.lastPurchaseDate)], ['Parts supplied', s.parts.length]]} /></Card>
      </div>
      <div className="mt-4 grid gap-4 xl:grid-cols-2">
        <Card title="Purchased parts" bodyClass="p-0">
          {h.purchasedParts.length ? (
            <Table><thead><tr><Th>Part</Th><Th>Name</Th><Th className="text-right">Qty</Th><Th className="text-right">Average price</Th><Th className="text-right">Last price</Th><Th>Last date</Th></tr></thead>
              <tbody>{h.purchasedParts.map((p: any) => <tr key={p.partId}><Td><Link to={`/parts/${p.partId}`} className="font-mono text-brand-700 hover:underline">{p.partNumber}</Link></Td><Td>{p.name}</Td><Td className="text-right">{qty(p.qty)}</Td><Td className="text-right">{money(p.averagePrice)}</Td><Td className="text-right">{money(p.lastPrice)}</Td><Td>{date(p.lastDate)}</Td></tr>)}</tbody></Table>
          ) : <Empty title="Nothing purchased yet" />}
        </Card>
        <Card title="Previous purchase orders" bodyClass="p-0">
          {h.purchaseOrders.length ? (
            <Table><thead><tr><Th>PO</Th><Th>Date</Th><Th>Status</Th><Th className="text-right">Lines</Th><Th className="text-right">Total</Th></tr></thead>
              <tbody>{h.purchaseOrders.map((p: any) => <tr key={p.id}><Td><Link to={`/purchase-orders/${p.id}`} className="font-mono text-brand-700 hover:underline">{p.poNumber}</Link></Td><Td>{date(p.poDate)}</Td><Td><StatusBadge status={p.status} /></Td><Td className="text-right">{p.lines}</Td><Td className="text-right">{money(p.total, p.currency)}</Td></tr>)}</tbody></Table>
          ) : <Empty title="No purchase orders yet" />}
        </Card>
        <Card title="Price list (supplier parts)" className="xl:col-span-2" bodyClass="p-0">
          {s.parts.length ? (
            <Table><thead><tr><Th>Part</Th><Th>Name</Th><Th>Supplier part no.</Th><Th className="text-right">Price</Th><Th>Lead time</Th><Th />{can('suppliers.manage') && <Th />}</tr></thead>
              <tbody>{s.parts.map((p: any) => <tr key={p.id}><Td><Link to={`/parts/${p.part.id}`} className="font-mono text-brand-700 hover:underline">{p.part.partNumber}</Link></Td><Td>{p.part.name}</Td><Td className="font-mono">{p.supplierPartNumber ?? '—'}</Td><Td className="text-right">{money(p.price, p.currency)}</Td><Td>{p.leadTimeDays != null ? `${p.leadTimeDays} days` : '—'}</Td><Td>{p.isPreferred && <Badge tone="green">Preferred</Badge>}</Td>
                {can('suppliers.manage') && <Td><Button variant="ghost" aria-label="Remove" onClick={() => setRemoving(p)}><Trash2 className="h-4 w-4 text-red-600" /></Button></Td>}</tr>)}</tbody></Table>
          ) : <Empty title="No parts linked">Link parts to this supplier from the part page (Suppliers tab) or import a price list.</Empty>}
        </Card>
      </div>
      {editing && <SupplierForm supplier={s} onClose={() => setEditing(false)} />}
      <ConfirmDialog open={!!removing} onClose={() => setRemoving(null)} title="Remove part from supplier" message={`Remove ${removing?.part.partNumber} from this supplier's price list? Past purchase orders are not affected.`} variant="danger" confirmText="Remove"
        onConfirm={async () => { await api.del(`/suppliers/${id}/parts/${removing.part.id}`); qc.invalidateQueries({ queryKey: ['supplier', id] }); toast.success('Removed'); }} />
    </div>
  );
}
