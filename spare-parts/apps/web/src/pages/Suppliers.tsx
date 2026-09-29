import { useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus } from 'lucide-react';
import { api, qs } from '../lib/api';
import { useAuth } from '../lib/auth';
import { useToast } from '../lib/toast';
import { Button, Card, Empty, ErrorState, ExportMenu, Field, Input, Modal, PageHeader, Pagination, Select, Spinner, StatusBadge, Table, Td, Textarea, Th } from '../components/ui';

export default function Suppliers() {
  const [sp, setSp] = useSearchParams();
  const { can } = useAuth();
  const [creating, setCreating] = useState(false);
  const f = { q: sp.get('q') ?? '', status: sp.get('status') ?? '', page: Number(sp.get('page') ?? 1) };
  const q = useQuery({ queryKey: ['suppliers', f], queryFn: () => api.get(`/suppliers${qs(f)}`), placeholderData: keepPreviousData });
  return (
    <div>
      <PageHeader title="Suppliers" actions={<>
        {can('export.run') && <ExportMenu url={`/suppliers/export${qs({ q: f.q, status: f.status })}`} />}
        {can('suppliers.manage') && <Button variant="primary" icon={<Plus className="h-4 w-4" />} onClick={() => setCreating(true)}>New supplier</Button>}
      </>} />
      <div className="mb-3 flex gap-2">
        <Input placeholder="Name, contact, email, tax number…" value={f.q} onChange={(e) => setSp({ q: e.target.value, status: f.status })} className="max-w-sm" />
        <Select value={f.status} onChange={(e) => setSp({ q: f.q, status: e.target.value })} className="w-auto" aria-label="Status"><option value="">All</option><option value="ACTIVE">Active</option><option value="INACTIVE">Inactive</option></Select>
      </div>
      {q.isLoading ? <Spinner /> : q.error ? <ErrorState error={q.error} /> : !q.data.items.length ? <Card><Empty title="No suppliers yet">{can('suppliers.manage') ? 'Create suppliers here or import them from Excel in Settings → Import.' : ''}</Empty></Card> : (
        <Card bodyClass="p-0">
          <Table>
            <thead><tr><Th>ID</Th><Th>Supplier</Th><Th>Contact</Th><Th>Phone</Th><Th>Email</Th><Th>Country</Th><Th>Currency</Th><Th>Payment terms</Th><Th className="text-right">Parts</Th><Th className="text-right">POs</Th><Th>Status</Th></tr></thead>
            <tbody>{q.data.items.map((s: any) => (
              <tr key={s.id} className="hover:bg-slate-50">
                <Td className="font-mono text-xs">{s.code}</Td><Td><Link to={`/suppliers/${s.id}`} className="font-semibold text-brand-700 hover:underline">{s.name}</Link>{s.company && s.company !== s.name && <div className="text-xs text-slate-500">{s.company}</div>}</Td>
                <Td>{s.contactPerson ?? '—'}</Td><Td>{s.phone ?? '—'}</Td><Td>{s.email ?? '—'}</Td><Td>{s.country ?? '—'}</Td><Td>{s.currency}</Td><Td>{s.paymentTerms ?? '—'}</Td>
                <Td className="text-right">{s._count.parts}</Td><Td className="text-right">{s._count.purchaseOrders}</Td><Td><StatusBadge status={s.status} /></Td>
              </tr>
            ))}</tbody>
          </Table>
          <div className="px-3"><Pagination page={f.page} pageSize={q.data.pageSize} total={q.data.total} onPage={(p) => setSp({ q: f.q, status: f.status, page: String(p) })} /></div>
        </Card>
      )}
      {creating && <SupplierForm onClose={() => setCreating(false)} />}
    </div>
  );
}

export function SupplierForm({ supplier, onClose }: { supplier?: any; onClose: () => void }) {
  const toast = useToast();
  const qc = useQueryClient();
  const nav = useNavigate();
  const [f, setF] = useState<any>(() => ({
    name: '', company: '', contactPerson: '', phone: '', email: '', address: '', country: 'Saudi Arabia', currency: '', paymentTerms: '', deliveryTerms: '', taxNumber: '', notes: '', status: 'ACTIVE',
    ...(supplier ? Object.fromEntries(Object.entries(supplier).map(([k, v]) => [k, v ?? ''])) : {}),
  }));
  const dup = useQuery({
    queryKey: ['sup-dup', f.name, f.taxNumber, f.email], enabled: f.name.length > 2,
    queryFn: () => api.post('/suppliers/check-duplicates', { name: f.name, taxNumber: f.taxNumber || null, email: f.email || null, id: supplier?.id }),
  });
  const set = (k: string) => (e: any) => setF({ ...f, [k]: e.target.value });
  const m = useMutation({
    mutationFn: () => {
      const body = { name: f.name, company: f.company, contactPerson: f.contactPerson, phone: f.phone, email: f.email, address: f.address, country: f.country, currency: f.currency || undefined, paymentTerms: f.paymentTerms, deliveryTerms: f.deliveryTerms, taxNumber: f.taxNumber, notes: f.notes, status: f.status };
      return supplier ? api.patch(`/suppliers/${supplier.id}`, body) : api.post('/suppliers', body);
    },
    onSuccess: (s: any) => { toast.success(supplier ? 'Supplier updated' : `Supplier ${s.code} created`); qc.invalidateQueries({ queryKey: ['suppliers'] }); qc.invalidateQueries({ queryKey: ['supplier'] }); qc.invalidateQueries({ queryKey: ['lookups'] }); onClose(); if (!supplier) nav(`/suppliers/${s.id}`); },
    onError: (e) => toast.error(e),
  });
  return (
    <Modal open onClose={onClose} size="lg" title={supplier ? `Edit ${supplier.name}` : 'New supplier'} footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" loading={m.isPending} disabled={!f.name.trim()} onClick={() => m.mutate()}>Save</Button></>}>
      {dup.data?.length > 0 && <div className="mb-3 rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-900">Possible duplicate: {dup.data.map((d: any) => `${d.name} (${d.code})`).join(', ')}</div>}
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Supplier name" required><Input value={f.name} onChange={set('name')} /></Field>
        <Field label="Company (legal name)"><Input value={f.company} onChange={set('company')} /></Field>
        <Field label="Contact person"><Input value={f.contactPerson} onChange={set('contactPerson')} /></Field>
        <Field label="Phone"><Input value={f.phone} onChange={set('phone')} /></Field>
        <Field label="Email"><Input type="email" value={f.email} onChange={set('email')} /></Field>
        <Field label="Country"><Input value={f.country} onChange={set('country')} /></Field>
        <Field label="Address" className="sm:col-span-2"><Textarea rows={2} value={f.address} onChange={set('address')} /></Field>
        <Field label="Currency" hint="Empty = company currency (Settings)"><Input maxLength={3} value={f.currency} placeholder="USD" onChange={(e) => setF({ ...f, currency: e.target.value.toUpperCase() })} /></Field>
        <Field label="Tax / VAT number"><Input value={f.taxNumber} onChange={set('taxNumber')} /></Field>
        <Field label="Payment terms"><Input value={f.paymentTerms} onChange={set('paymentTerms')} placeholder="e.g. 30 days net" /></Field>
        <Field label="Delivery terms"><Input value={f.deliveryTerms} onChange={set('deliveryTerms')} placeholder="e.g. DAP site" /></Field>
        <Field label="Status"><Select value={f.status} onChange={set('status')}><option value="ACTIVE">Active</option><option value="INACTIVE">Inactive</option></Select></Field>
        <Field label="Notes" className="sm:col-span-2"><Textarea rows={2} value={f.notes} onChange={set('notes')} /></Field>
      </div>
    </Modal>
  );
}
