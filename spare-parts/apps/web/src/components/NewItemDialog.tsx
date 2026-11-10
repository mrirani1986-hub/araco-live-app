import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '../lib/api';
import { useToast } from '../lib/toast';
import { Button, Field, Input, Modal, Select, Textarea } from './ui';

export interface NewItem { part: { id: number; partNumber: string; name: string; unit: string }; quantity: number; cart?: unknown }

/**
 * Request an item that is not in the system: it is created as a new part (marked for the store to review) and,
 * with addToCart, put in the request cart; otherwise the caller adds it as a PR line.
 */
export function NewItemDialog({ addToCart, onClose, onCreated }: { addToCart: boolean; onClose: () => void; onCreated: (r: NewItem) => void }) {
  const toast = useToast();
  const lookups = useQuery({ queryKey: ['lookups'], queryFn: () => api.get('/lookups'), staleTime: 300_000 });
  const [f, setF] = useState({ name: '', partNumber: '', brand: '', specification: '', unit: 'PCS', quantity: '1', equipmentId: '', notes: '' });
  const [busy, setBusy] = useState(false);
  const [existing, setExisting] = useState<{ id: number; partNumber: string; name: string } | null>(null);
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value });
  const qty = Number(f.quantity);
  const save = async () => {
    setBusy(true);
    setExisting(null);
    try {
      const r = await api.post('/cart/new-item', {
        name: f.name, partNumber: f.partNumber.trim() || undefined, brand: f.brand || null, specification: f.specification || null, unit: f.unit || 'PCS',
        quantity: qty, equipmentId: f.equipmentId ? Number(f.equipmentId) : null, notes: f.notes || null, addToCart,
      });
      toast.success(`${r.part.partNumber} ${r.part.name} added`);
      onCreated({ ...r, quantity: qty });
    } catch (e: any) {
      if (e?.status === 409 && e.details?.part) setExisting(e.details.part);
      toast.error(e);
    } finally { setBusy(false); }
  };
  return (
    <Modal open onClose={onClose} title="Item not in the system" size="lg" footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" loading={busy} disabled={f.name.trim().length < 2 || !(qty > 0)} onClick={save}>{addToCart ? 'Add to request' : 'Add line'}</Button></>}>
      <p className="mb-3 text-sm text-slate-600">Describe the item as well as you can. It is added to the system as a new part, marked for the store to check;
        without a part number it gets a <b>REQ-</b> number.</p>
      {existing && <div className="mb-3 rounded-md bg-amber-50 p-2 text-sm text-amber-800">This part number is already in the system: <a className="font-semibold underline" href={`/parts/${existing.id}`} target="_blank" rel="noreferrer">{existing.partNumber} — {existing.name}</a>. Add that part to the request instead.</div>}
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Item name / description *" className="sm:col-span-2"><Input value={f.name} onChange={set('name')} placeholder="e.g. Hydraulic hose 1/2&quot; x 1.5 m with fittings" autoFocus /></Field>
        <Field label="Part number (if known)"><Input value={f.partNumber} onChange={set('partNumber')} placeholder="maker's number" /></Field>
        <Field label="Brand / maker"><Input value={f.brand} onChange={set('brand')} /></Field>
        <Field label="Quantity *"><Input type="number" min={0} step="any" value={f.quantity} onChange={set('quantity')} /></Field>
        <Field label="Unit"><Input value={f.unit} onChange={set('unit')} placeholder="PCS, M, L, SET…" /></Field>
        <Field label="Specification / size" className="sm:col-span-2"><Input value={f.specification} onChange={set('specification')} /></Field>
        <Field label="For machine"><Select value={f.equipmentId} onChange={set('equipmentId')}><option value="">—</option>{lookups.data?.equipment?.map((e: any) => <option key={e.id} value={e.id}>{e.name}</option>)}</Select></Field>
        <Field label="Notes"><Textarea rows={1} value={f.notes} onChange={set('notes')} /></Field>
      </div>
    </Modal>
  );
}
