import { Link, useNavigate, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { ArrowLeft, Printer } from 'lucide-react';
import { api, openDoc } from '../lib/api';
import { date, qty } from '../lib/format';
import { Button, Card, ErrorState, KV, PageHeader, Spinner, Table, Td, Th } from '../components/ui';

export default function GrnDetail() {
  const { id } = useParams();
  const nav = useNavigate();
  const q = useQuery({ queryKey: ['grn', id], queryFn: () => api.get(`/grns/${id}`) });
  if (q.isLoading) return <Spinner />;
  if (q.error) return <ErrorState error={q.error} />;
  const g = q.data;
  return (
    <div>
      <PageHeader back={<button onClick={() => nav(-1)} className="mb-1 flex items-center gap-1 text-sm text-slate-500"><ArrowLeft className="h-4 w-4" />Back</button>}
        title={<span className="font-mono">{g.grnNumber}</span>} subtitle={`Goods receipt for ${g.po.poNumber}`}
        actions={<Button icon={<Printer className="h-4 w-4" />} onClick={() => openDoc(`/grns/${id}/pdf`)}>Print / PDF</Button>} />
      <Card><KV cols={3} items={[['GRN number', <span className="font-mono">{g.grnNumber}</span>], ['PO number', <Link to={`/purchase-orders/${g.po.id}`} className="font-mono text-brand-700 hover:underline">{g.po.poNumber}</Link>], ['Supplier', g.po.supplier.name], ['Receiving date', date(g.receivedAt)], ['Received by', g.receiver.fullName], ['Warehouse', g.warehouse.name], ['Delivery note', g.deliveryNote], ['Notes', g.notes]]} /></Card>
      <Card title="Items" className="mt-4" bodyClass="p-0">
        <Table>
          <thead><tr><Th>Part Number</Th><Th>Description</Th><Th className="text-right">Ordered</Th><Th className="text-right">Received</Th><Th className="text-right">Rejected</Th><Th className="text-right">Remaining</Th><Th>Condition</Th><Th>Notes</Th></tr></thead>
          <tbody>{g.items.map((i: any) => (
            <tr key={i.id}><Td><Link to={`/parts/${i.poItem.part.id}`} className="font-mono font-semibold text-brand-700 hover:underline">{i.poItem.part.partNumber}</Link></Td><Td>{i.poItem.description}</Td><Td className="text-right">{qty(i.orderedQty)}</Td><Td className="text-right font-semibold">{qty(i.receivedQty)}</Td><Td className="text-right">{qty(i.rejectedQty)}</Td><Td className="text-right">{qty(i.remainingQty)}</Td><Td>{i.condition}</Td><Td>{i.notes}</Td></tr>
          ))}</tbody>
        </Table>
      </Card>
    </div>
  );
}
