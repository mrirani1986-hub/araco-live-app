import { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowDownToLine, ArrowLeftRight, ArrowUpFromLine, ClipboardEdit, Plus, Sparkles, Trash2 } from 'lucide-react';
import { api, qs } from '../lib/api';
import { useAuth } from '../lib/auth';
import { useToast } from '../lib/toast';
import { dateTime, money, qty } from '../lib/format';
import { Button, Card, Empty, ErrorState, ExportMenu, Field, Input, Modal, PageHeader, Pagination, Select, Spinner, StatusBadge, Table, Tabs, Td, Textarea, Th, cx } from '../components/ui';

type Tab = 'stock' | 'transactions' | 'suggested' | 'warehouses';

export default function Inventory() {
  const [sp, setSp] = useSearchParams();
  const { can } = useAuth();
  const tab = (sp.get('tab') as Tab) ?? 'stock';
  const [movement, setMovement] = useState<null | 'issue' | 'return' | 'adjust' | 'transfer'>(null);
  return (
    <div>
      <PageHeader title="Inventory" actions={<>
        {can('inventory.issue') && <Button icon={<ArrowUpFromLine className="h-4 w-4" />} onClick={() => setMovement('issue')}>Issue</Button>}
        {can('inventory.issue') && <Button icon={<ArrowDownToLine className="h-4 w-4" />} onClick={() => setMovement('return')}>Return</Button>}
        {can('inventory.transfer') && <Button icon={<ArrowLeftRight className="h-4 w-4" />} onClick={() => setMovement('transfer')}>Transfer</Button>}
        {can('inventory.adjust') && <Button icon={<ClipboardEdit className="h-4 w-4" />} onClick={() => setMovement('adjust')}>Adjustment</Button>}
      </>} />
      <Tabs value={tab} onChange={(t) => setSp({ tab: t })} tabs={[{ key: 'stock', label: 'Stock' }, { key: 'transactions', label: 'Transactions' }, { key: 'suggested', label: 'Suggested minimum stock' }, { key: 'warehouses', label: 'Warehouses & locations' }]} />
      {tab === 'stock' && <StockTab />}
      {tab === 'transactions' && <TxTab />}
      {tab === 'suggested' && <SuggestedTab />}
      {tab === 'warehouses' && <WarehousesTab />}
      {movement && <MovementModal kind={movement} onClose={() => setMovement(null)} />}
    </div>
  );
}

function StockTab() {
  const [sp, setSp] = useSearchParams();
  const { can } = useAuth();
  const f = { status: sp.get('status') ?? '', q: sp.get('q') ?? '', page: Number(sp.get('page') ?? 1) };
  const set = (k: string, v: string) => { const n = new URLSearchParams(sp); v ? n.set(k, v) : n.delete(k); if (k !== 'page') n.delete('page'); setSp(n, { replace: true }); };
  const q = useQuery({ queryKey: ['inventory', f], queryFn: () => api.get(`/inventory${qs(f)}`), placeholderData: keepPreviousData });
  const counts = q.data?.counts ?? {};
  return (
    <>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <Input placeholder="Search part…" value={f.q} onChange={(e) => set('q', e.target.value)} className="max-w-xs" />
        {[['', 'All'], ['ATTENTION', 'Needs attention'], ['OUT_OF_STOCK', 'Out of stock'], ['LOW_STOCK', 'Low stock'], ['REORDER', 'Reorder required'], ['OK', 'In stock'], ['STOCKED', 'Stocked items'], ['NOT_STOCKED', 'Not stocked']].map(([k, l]) => (
          <button key={k} onClick={() => set('status', k)} className={cx('rounded-full border px-3 py-1 text-xs font-medium', f.status === k ? 'border-brand-700 bg-brand-700 text-white' : 'border-slate-300 bg-white text-slate-600 hover:bg-slate-50')}>
            {l}{counts[k] != null ? ` (${counts[k]})` : ''}
          </button>
        ))}
        <div className="ml-auto">{can('export.run') && <ExportMenu url={`/inventory/export${qs({ status: f.status, q: f.q })}`} />}</div>
      </div>
      {q.isLoading ? <Spinner /> : q.error ? <ErrorState error={q.error} /> : !q.data.items.length ? <Card><Empty title="No parts match" /></Card> : (
        <Card bodyClass="p-0">
          <Table>
            <thead><tr><Th>Part Number</Th><Th>Part Name</Th><Th className="text-right">Current</Th><Th className="text-right">Reserved</Th><Th className="text-right">Available</Th><Th className="text-right">Min</Th><Th className="text-right">Max</Th><Th className="text-right">Reorder</Th><Th className="text-right">On order</Th><Th>Status</Th><Th>Warehouse / location</Th><Th className="text-right">Value</Th></tr></thead>
            <tbody>{q.data.items.map((r: any) => (
              <tr key={r.partId} className="hover:bg-slate-50">
                <Td><Link to={`/parts/${r.partId}`} className="font-mono font-semibold text-brand-700 hover:underline">{r.partNumber}</Link></Td>
                <Td className="max-w-[240px] truncate">{r.name}</Td>
                <Td className="text-right font-semibold tabular-nums">{qty(r.onHand)} <span className="text-xs font-normal text-slate-500">{r.unit}</span></Td>
                <Td className="text-right tabular-nums">{qty(r.reserved)}</Td><Td className="text-right tabular-nums">{qty(r.available)}</Td>
                <Td className="text-right tabular-nums">{qty(r.minStock)}</Td><Td className="text-right tabular-nums">{qty(r.maxStock)}</Td><Td className="text-right tabular-nums">{qty(r.reorderLevel)}</Td>
                <Td className="text-right tabular-nums">{r.onOrder ? qty(r.onOrder) : '—'}</Td>
                <Td><StatusBadge status={r.stockStatus} /></Td><Td className="text-xs text-slate-600">{r.locations ?? '—'}</Td>
                <Td className="text-right tabular-nums">{r.value != null ? money(r.value, r.lastCostCurrency) : '—'}</Td>
              </tr>
            ))}</tbody>
          </Table>
          <div className="px-3"><Pagination page={f.page} pageSize={q.data.pageSize} total={q.data.total} onPage={(p) => set('page', String(p))} /></div>
        </Card>
      )}
    </>
  );
}

function TxTab() {
  const [sp, setSp] = useSearchParams();
  const { can } = useAuth();
  const f = { type: sp.get('type') ?? '', q: sp.get('q') ?? '', from: sp.get('from') ?? '', to: sp.get('to') ?? '', page: Number(sp.get('page') ?? 1) };
  const set = (k: string, v: string) => { const n = new URLSearchParams(sp); v ? n.set(k, v) : n.delete(k); if (k !== 'page') n.delete('page'); setSp(n, { replace: true }); };
  const q = useQuery({ queryKey: ['inv-tx', f], queryFn: () => api.get(`/inventory/transactions${qs(f)}`), placeholderData: keepPreviousData });
  return (
    <>
      <div className="mb-3 flex flex-wrap gap-2">
        <Input placeholder="Document, part number or reason…" value={f.q} onChange={(e) => set('q', e.target.value)} className="max-w-xs" />
        <Select value={f.type} onChange={(e) => set('type', e.target.value)} className="w-auto" aria-label="Type"><option value="">All types</option>{['RECEIPT', 'ISSUE', 'RETURN', 'ADJUSTMENT', 'TRANSFER_IN', 'TRANSFER_OUT'].map((t) => <option key={t}>{t}</option>)}</Select>
        <Input type="date" value={f.from} onChange={(e) => set('from', e.target.value)} className="w-auto" aria-label="From" />
        <Input type="date" value={f.to} onChange={(e) => set('to', e.target.value)} className="w-auto" aria-label="To" />
        <div className="ml-auto">{can('export.run') && <ExportMenu url={`/inventory/transactions/export${qs({ ...f, page: undefined })}`} />}</div>
      </div>
      {q.isLoading ? <Spinner /> : q.error ? <ErrorState error={q.error} /> : !q.data.items.length ? <Card><Empty title="No transactions" /></Card> : (
        <Card bodyClass="p-0">
          <Table>
            <thead><tr><Th>Date</Th><Th>Document</Th><Th>Type</Th><Th>Part</Th><Th>Location</Th><Th className="text-right">Qty</Th><Th className="text-right">Balance</Th><Th className="text-right">Unit cost</Th><Th>Equipment</Th><Th>Reason</Th><Th>User</Th></tr></thead>
            <tbody>{q.data.items.map((t: any) => (
              <tr key={t.id}>
                <Td className="whitespace-nowrap">{dateTime(t.createdAt)}</Td><Td className="font-mono">{t.docNumber}</Td><Td><StatusBadge status={t.type} /></Td>
                <Td><Link to={`/parts/${t.part.id}`} className="font-mono text-brand-700 hover:underline">{t.part.partNumber}</Link> <span className="text-slate-500">{t.part.name}</span></Td>
                <Td>{t.location.warehouse.code}/{t.location.code}</Td>
                <Td className={cx('text-right font-semibold tabular-nums', Number(t.quantity) < 0 ? 'text-red-700' : 'text-emerald-700')}>{Number(t.quantity) > 0 ? '+' : ''}{qty(t.quantity)}</Td>
                <Td className="text-right tabular-nums">{qty(t.balanceAfter)}</Td><Td className="text-right tabular-nums">{t.unitCost != null ? money(t.unitCost, t.currency) : '—'}</Td>
                <Td>{t.equipment ?? '—'}</Td><Td className="max-w-[200px] truncate text-slate-600">{t.reason}</Td><Td>{t.user.fullName}</Td>
              </tr>
            ))}</tbody>
          </Table>
          <div className="px-3"><Pagination page={f.page} pageSize={q.data.pageSize} total={q.data.total} onPage={(p) => set('page', String(p))} /></div>
        </Card>
      )}
    </>
  );
}

function SuggestedTab() {
  const { can } = useAuth();
  const toast = useToast();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['suggested-min'], queryFn: () => api.get('/inventory/suggested-min') });
  const lookups = useQuery({ queryKey: ['lookups'], queryFn: () => api.get('/lookups'), staleTime: 60_000 });
  const [sel, setSel] = useState<Set<number>>(new Set());
  const [locationId, setLocationId] = useState('');
  const locs = lookups.data?.warehouses?.flatMap((w: any) => w.locations.map((l: any) => ({ id: l.id, label: `${w.code}/${l.code}` }))) ?? [];
  const apply = useMutation({
    mutationFn: () => api.post('/inventory/apply-suggested-min', { locationId: Number(locationId || locs[0]?.id), partIds: [...sel], onlyWhereEmpty: true }),
    onSuccess: (r: any) => { toast.success(`Minimum stock set for ${r.applied} part(s)`); setSel(new Set()); qc.invalidateQueries({ queryKey: ['suggested-min'] }); qc.invalidateQueries({ queryKey: ['inventory'] }); },
    onError: (e) => toast.error(e),
  });
  if (q.isLoading) return <Spinner />;
  if (q.error) return <ErrorState error={q.error} />;
  const rows = q.data as any[];
  const pending = rows.filter((r) => r.currentMin == null);
  return (
    <Card title="Recommended spares from the workbook (SPARE PART column)" actions={can('inventory.adjust') && <>
      <Select value={locationId} onChange={(e) => setLocationId(e.target.value)} className="w-auto" aria-label="Location">{locs.map((l: any) => <option key={l.id} value={l.id}>{l.label}</option>)}</Select>
      <Button onClick={() => setSel(new Set(pending.map((r) => r.partId)))}>Select all without minimum ({pending.length})</Button>
      <Button variant="primary" icon={<Sparkles className="h-4 w-4" />} disabled={!sel.size} loading={apply.isPending} onClick={() => apply.mutate()}>Apply to {sel.size} part(s)</Button>
    </>} bodyClass="p-0">
      <p className="px-4 pt-3 text-sm text-slate-600">The suggested minimum is the total recommended spare quantity over all machines that use the part. Nothing changes until you select parts and press Apply; existing minimums are never overwritten here.</p>
      <Table className="mt-2">
        <thead><tr><Th /><Th>Part</Th><Th>Name</Th><Th className="text-right">Suggested min</Th><Th className="text-right">Current min</Th></tr></thead>
        <tbody>{rows.map((r) => (
          <tr key={r.partId}>
            <Td><input type="checkbox" disabled={r.currentMin != null || !can('inventory.adjust')} checked={sel.has(r.partId)} onChange={(e) => { const n = new Set(sel); e.target.checked ? n.add(r.partId) : n.delete(r.partId); setSel(n); }} aria-label={`Select ${r.partNumber}`} /></Td>
            <Td><Link to={`/parts/${r.partId}`} className="font-mono text-brand-700 hover:underline">{r.partNumber}</Link></Td><Td>{r.name}</Td>
            <Td className="text-right tabular-nums">{qty(r.suggested)} {r.unit}{r.fromAll && <span className="ml-1 text-xs text-slate-400">(“ALL”)</span>}</Td>
            <Td className="text-right tabular-nums">{r.currentMin != null ? qty(r.currentMin) : '—'}</Td>
          </tr>
        ))}</tbody>
      </Table>
    </Card>
  );
}

function WarehousesTab() {
  const { can } = useAuth();
  const toast = useToast();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['warehouses'], queryFn: () => api.get('/inventory/warehouses') });
  const [newWh, setNewWh] = useState({ code: '', name: '' });
  const [newLoc, setNewLoc] = useState<Record<number, string>>({});
  const refresh = () => { qc.invalidateQueries({ queryKey: ['warehouses'] }); qc.invalidateQueries({ queryKey: ['lookups'] }); };
  if (q.isLoading) return <Spinner />;
  return (
    <div className="space-y-4">
      {q.data.map((w: any) => (
        <Card key={w.id} title={`${w.code} — ${w.name}`}>
          <div className="flex flex-wrap gap-2">
            {w.locations.map((l: any) => <span key={l.id} className="rounded border bg-slate-50 px-2 py-1 font-mono text-sm">{l.code}<span className="ml-1 text-xs text-slate-400">({l._count.inventory})</span></span>)}
          </div>
          {can('inventory.adjust') && (
            <form className="mt-3 flex gap-2" onSubmit={async (e) => { e.preventDefault(); try { await api.post(`/inventory/warehouses/${w.id}/locations`, { code: newLoc[w.id] }); setNewLoc({ ...newLoc, [w.id]: '' }); refresh(); toast.success('Location added'); } catch (err) { toast.error(err); } }}>
              <Input placeholder="New location / bin, e.g. A-01-03" value={newLoc[w.id] ?? ''} onChange={(e) => setNewLoc({ ...newLoc, [w.id]: e.target.value })} className="max-w-xs" />
              <Button type="submit" disabled={!newLoc[w.id]} icon={<Plus className="h-4 w-4" />}>Add location</Button>
            </form>
          )}
        </Card>
      ))}
      {can('inventory.adjust') && (
        <Card title="Add warehouse">
          <form className="flex flex-wrap gap-2" onSubmit={async (e) => { e.preventDefault(); try { await api.post('/inventory/warehouses', newWh); setNewWh({ code: '', name: '' }); refresh(); toast.success('Warehouse created'); } catch (err) { toast.error(err); } }}>
            <Input placeholder="Code" value={newWh.code} onChange={(e) => setNewWh({ ...newWh, code: e.target.value })} className="w-32" />
            <Input placeholder="Name" value={newWh.name} onChange={(e) => setNewWh({ ...newWh, name: e.target.value })} className="max-w-xs" />
            <Button type="submit" variant="primary" disabled={!newWh.code || !newWh.name}>Create</Button>
          </form>
        </Card>
      )}
    </div>
  );
}

function MovementModal({ kind, onClose }: { kind: 'issue' | 'return' | 'adjust' | 'transfer'; onClose: () => void }) {
  const toast = useToast();
  const qc = useQueryClient();
  const lookups = useQuery({ queryKey: ['lookups'], queryFn: () => api.get('/lookups'), staleTime: 60_000 });
  const locs = lookups.data?.warehouses?.flatMap((w: any) => w.locations.map((l: any) => ({ id: l.id, label: `${w.code}/${l.code}` }))) ?? [];
  const [h, setH] = useState({ reason: '', equipmentId: '', fromLocationId: '', toLocationId: '' });
  const [lines, setLines] = useState<any[]>([]);
  const [search, setSearch] = useState('');
  const found = useQuery({ queryKey: ['parts-mini', search], queryFn: () => api.get(`/parts?q=${encodeURIComponent(search)}&pageSize=8`), enabled: search.length > 1 });
  const defLoc = String(locs[0]?.id ?? '');
  const titles = { issue: 'Issue parts (to a machine)', return: 'Return parts to store', adjust: 'Stock adjustment / count', transfer: 'Transfer between locations' };
  const m = useMutation({
    mutationFn: () => {
      if (kind === 'adjust') return api.post('/inventory/adjust', { reason: h.reason, lines: lines.map((l) => ({ partId: l.partId, locationId: Number(l.locationId || defLoc), countedQty: Number(l.qty) })) });
      if (kind === 'transfer') return api.post('/inventory/transfer', { fromLocationId: Number(h.fromLocationId || defLoc), toLocationId: Number(h.toLocationId), reason: h.reason || null, lines: lines.map((l) => ({ partId: l.partId, quantity: Number(l.qty) })) });
      return api.post(`/inventory/${kind}`, { reason: h.reason, equipmentId: h.equipmentId ? Number(h.equipmentId) : null, lines: lines.map((l) => ({ partId: l.partId, locationId: Number(l.locationId || defLoc), quantity: Number(l.qty) })) });
    },
    onSuccess: (r: any) => { toast.success(`${r.docNumber} posted`); qc.invalidateQueries({ queryKey: ['inventory'] }); qc.invalidateQueries({ queryKey: ['inv-tx'] }); qc.invalidateQueries({ queryKey: ['part'] }); onClose(); },
    onError: (e) => toast.error(e),
  });
  const upd = (i: number, k: string, v: unknown) => setLines(lines.map((l, n) => (n === i ? { ...l, [k]: v } : l)));
  const needReason = kind !== 'transfer';
  return (
    <Modal open onClose={onClose} size="lg" title={titles[kind]} footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" loading={m.isPending} disabled={!lines.length || (needReason && !h.reason.trim()) || (kind === 'transfer' && !h.toLocationId) || lines.some((l) => l.qty === '' || Number(l.qty) < 0 || (kind !== 'adjust' && !(Number(l.qty) > 0)))} onClick={() => m.mutate()}>Post</Button></>}>
      <div className="grid gap-3 sm:grid-cols-2">
        {(kind === 'issue' || kind === 'return') && <Field label="Equipment"><Select value={h.equipmentId} onChange={(e) => setH({ ...h, equipmentId: e.target.value })}><option value="">—</option>{lookups.data?.equipment?.map((e: any) => <option key={e.id} value={e.id}>{e.name}</option>)}</Select></Field>}
        {kind === 'transfer' && <>
          <Field label="From location"><Select value={h.fromLocationId || defLoc} onChange={(e) => setH({ ...h, fromLocationId: e.target.value })}>{locs.map((l: any) => <option key={l.id} value={l.id}>{l.label}</option>)}</Select></Field>
          <Field label="To location" required><Select value={h.toLocationId} onChange={(e) => setH({ ...h, toLocationId: e.target.value })}><option value="">Select…</option>{locs.map((l: any) => <option key={l.id} value={l.id}>{l.label}</option>)}</Select></Field>
        </>}
        <Field label={kind === 'adjust' ? 'Reason (e.g. stock count, damage)' : 'Reason'} required={needReason} className={kind === 'transfer' ? 'sm:col-span-2' : ''}><Textarea rows={1} value={h.reason} onChange={(e) => setH({ ...h, reason: e.target.value })} /></Field>
      </div>
      <Table className="mt-4">
        <thead><tr><Th>Part</Th>{kind !== 'transfer' && <Th>Location</Th>}<Th>{kind === 'adjust' ? 'Counted quantity' : 'Quantity'}</Th><Th /></tr></thead>
        <tbody>{lines.map((l, i) => (
          <tr key={l.partId}><Td><span className="font-mono font-semibold">{l.partNumber}</span> {l.name}<div className="text-xs text-slate-500">In stock: {qty(l.onHand)} {l.unit}</div></Td>
            {kind !== 'transfer' && <Td><Select value={l.locationId || defLoc} onChange={(e) => upd(i, 'locationId', e.target.value)} className="w-36">{locs.map((x: any) => <option key={x.id} value={x.id}>{x.label}</option>)}</Select></Td>}
            <Td><Input type="number" min={0} step="any" value={l.qty} onChange={(e) => upd(i, 'qty', e.target.value)} className="w-28" /></Td>
            <Td><Button variant="ghost" aria-label="Remove" onClick={() => setLines(lines.filter((_, n) => n !== i))}><Trash2 className="h-4 w-4 text-red-600" /></Button></Td></tr>
        ))}</tbody>
      </Table>
      <div className="relative mt-3">
        <Input placeholder="Add a part: type number or name…" value={search} onChange={(e) => setSearch(e.target.value)} />
        {search.length > 1 && found.data?.items?.length > 0 && (
          <div className="absolute z-20 mt-1 w-full rounded-md border bg-white shadow-lg">
            {found.data.items.map((p: any) => (
              <button key={p.id} className="block w-full px-3 py-1.5 text-left text-sm hover:bg-slate-50" onClick={() => { if (!lines.some((l) => l.partId === p.id)) setLines([...lines, { partId: p.id, partNumber: p.partNumber, name: p.name, unit: p.unit, onHand: p.onHand, qty: kind === 'adjust' ? p.onHand : 1, locationId: '' }]); setSearch(''); }}>
                <span className="font-mono font-semibold">{p.partNumber}</span> {p.name} <span className="text-xs text-slate-500">· stock {qty(p.onHand)}</span>
              </button>
            ))}
          </div>
        )}
      </div>
    </Modal>
  );
}
