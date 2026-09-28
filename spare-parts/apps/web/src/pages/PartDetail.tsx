import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, ClipboardPlus, History, ImagePlus, Pencil, Printer, ShoppingCart, Star, Trash2, Upload } from 'lucide-react';
import { api, fileUrl, openDoc } from '../lib/api';
import { useAuth } from '../lib/auth';
import { useToast } from '../lib/toast';
import { date, dateTime, money, qty } from '../lib/format';
import { Badge, Button, Card, ConfirmDialog, Empty, ErrorState, Field, Input, KV, Modal, PageHeader, Select, Spinner, StatusBadge, Table, Tabs, Td, Textarea, Th, Thumb, cx } from '../components/ui';
import { AddToRequestModal, ImageViewer, type Img } from '../components/parts';

const FLAG_TEXT: Record<string, string> = {
  NAME_VARIANTS_IN_SOURCE: 'Different names used for this code in the source book', NAME_UNCLEAR: 'Name in workbook is unclear — please review',
  CODE_WHITESPACE_TRIMMED: 'Code had extra spaces in the workbook', INSTALLED_QTY_MISSING: 'Installed quantity missing in the workbook',
  UNIT_VARIANT: 'Unit written differently in the workbook (PC/PS)', SPARE_RECOMMENDATION_DIFFERS_BY_MACHINE: 'Recommended spare differs between machines',
  CREATED_FROM_CAPTION: 'Created from an assembly caption (not a row in the workbook)',
  TRANSCRIBED_FROM_SCAN: 'Typed from a scanned page of the IMER book — check the code against the drawing before ordering',
};

export default function PartDetail() {
  const { id } = useParams();
  const nav = useNavigate();
  const { can } = useAuth();
  const toast = useToast();
  const qc = useQueryClient();
  const [tab, setTab] = useState<'details' | 'where' | 'suppliers' | 'stock' | 'history'>('details');
  const [viewer, setViewer] = useState<number | null>(null);
  const [adding, setAdding] = useState<null | 'cart' | 'pr'>(null);
  const [editing, setEditing] = useState(false);
  const [removeImg, setRemoveImg] = useState<Img | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const q = useQuery({ queryKey: ['part', id], queryFn: () => api.get(`/parts/${id}`) });
  const hist = useQuery({ queryKey: ['part-history', id], queryFn: () => api.get(`/parts/${id}/history`), enabled: tab === 'history' });
  const upload = useMutation({
    mutationFn: (files: FileList) => { const f = new FormData(); Array.from(files).forEach((x) => f.append('files', x)); return api.upload(`/parts/${id}/images`, f); },
    onSuccess: (r: any[]) => { toast.success(`${r.length} picture(s) uploaded`); qc.invalidateQueries({ queryKey: ['part', id] }); qc.invalidateQueries({ queryKey: ['parts'] }); },
    onError: (e) => toast.error(e),
  });
  if (q.isLoading) return <Spinner />;
  if (q.error) return <ErrorState error={q.error} retry={() => q.refetch()} />;
  const p = q.data;
  const gallery: Img[] = [...p.images, ...p.drawings];
  const main = gallery[0];
  const sp = p.supplierParts[0];
  const equipment = [...new Set(p.usages.map((u: any) => u.assembly.equipment.name))].join(', ');
  const locations = p.inventory.filter((i: any) => Number(i.onHand) > 0).map((i: any) => `${i.location.warehouse.code}/${i.location.code}`).join(', ');
  const totalSpare = p.usages.reduce((a: number, u: any) => a + Number(u.recommendedSpare ?? 0), 0);

  return (
    <div>
      <PageHeader
        back={<button onClick={() => nav(-1)} className="mb-1 flex items-center gap-1 text-sm text-slate-500 hover:text-slate-800"><ArrowLeft className="h-4 w-4" />Back</button>}
        title={<span className="flex items-center gap-2"><span className="font-mono">{p.partNumber}</span><span className="text-slate-400">·</span><span>{p.name}</span>{p.isCritical && <Badge tone="amber"><Star className="h-3 w-3" />Recommended spare</Badge>}</span>}
        subtitle={[p.manufacturer?.name, p.category?.name, equipment].filter(Boolean).join(' · ')}
        actions={<>
          {can('cart.use') && <Button variant="primary" icon={<ShoppingCart className="h-4 w-4" />} onClick={() => setAdding('cart')}>Add to request</Button>}
          {can('pr.create') && <Button icon={<ClipboardPlus className="h-4 w-4" />} onClick={() => setAdding('pr')}>Add to PR</Button>}
          <Button icon={<History className="h-4 w-4" />} onClick={() => setTab('history')}>View history</Button>
          {can('parts.edit') && <Button icon={<Pencil className="h-4 w-4" />} onClick={() => setEditing(true)}>Edit</Button>}
          <Button icon={<Printer className="h-4 w-4" />} onClick={() => openDoc(`/parts/${p.id}/pdf`)}>Print</Button>
        </>}
      />
      {p.reviewFlags.length > 0 && (
        <div className="mb-4 rounded-lg border border-amber-200 bg-amber-50 px-4 py-2 text-sm text-amber-900">
          <b>Data review:</b> {p.reviewFlags.map((f: string) => FLAG_TEXT[f] ?? f).join(' · ')}
        </div>
      )}
      <div className="grid gap-4 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
        <Card bodyClass="p-3">
          {main ? (
            <button className="block w-full" onClick={() => setViewer(0)} title="Click to zoom">
              <img src={fileUrl(main.storageKey)!} alt={main.caption ?? p.name} className="mx-auto max-h-[420px] w-full rounded bg-white object-contain" />
            </button>
          ) : <div className="grid h-72 place-items-center rounded bg-slate-50 text-slate-400">No picture yet</div>}
          <div className="mt-2 text-center text-xs text-slate-500">{main ? (main.kind === 'DRAWING' ? `Assembly drawing: ${main.caption} — click to zoom` : 'Click to zoom') : ''}</div>
          <div className="mt-3 flex flex-wrap gap-2">
            {gallery.map((g, i) => (
              <div key={g.id} className="group relative">
                <button onClick={() => setViewer(i)} className="h-16 w-20 overflow-hidden rounded border bg-white hover:border-brand-400"><Thumb src={fileUrl(g.thumbKey ?? g.storageKey)} alt={g.caption ?? ''} className="h-full w-full" /></button>
                {g.kind === 'DRAWING' && <span className="absolute bottom-0.5 left-0.5 rounded bg-slate-900/60 px-1 text-[9px] text-white">drawing</span>}
                {can('parts.images') && g.kind === 'PHOTO' && (
                  <div className="absolute right-0.5 top-0.5 hidden gap-0.5 group-hover:flex">
                    <button className="rounded bg-white/90 p-0.5 shadow" title="Make main picture" onClick={async () => { await api.patch(`/images/${g.id}`, { isPrimary: true }); qc.invalidateQueries({ queryKey: ['part', id] }); }}><Star className="h-3.5 w-3.5 text-amber-500" /></button>
                    <button className="rounded bg-white/90 p-0.5 shadow" title="Remove picture" onClick={() => setRemoveImg(g)}><Trash2 className="h-3.5 w-3.5 text-red-600" /></button>
                  </div>
                )}
              </div>
            ))}
            {can('parts.images') && (
              <button onClick={() => fileRef.current?.click()} className="grid h-16 w-20 place-items-center rounded border-2 border-dashed text-slate-400 hover:border-brand-400 hover:text-brand-600" title="Upload pictures (JPG, PNG, WEBP)">
                {upload.isPending ? <Upload className="h-5 w-5 animate-pulse" /> : <ImagePlus className="h-5 w-5" />}
              </button>
            )}
            <input ref={fileRef} type="file" accept="image/jpeg,image/png,image/webp" multiple hidden onChange={(e) => { if (e.target.files?.length) upload.mutate(e.target.files); e.target.value = ''; }} />
          </div>
        </Card>

        <div className="min-w-0">
          <Tabs value={tab} onChange={setTab} tabs={[{ key: 'details', label: 'Details' }, { key: 'where', label: `Where used (${p.usages.length})` }, { key: 'suppliers', label: `Suppliers (${p.supplierParts.length})` }, { key: 'stock', label: 'Stock' }, { key: 'history', label: 'History' }]} />
          {tab === 'details' && (
            <Card>
              <KV items={[
                ['Part Number', <span className="font-mono">{p.partNumber}</span>], ['Item Code', p.itemCode], ['Part Name', p.name], ['Description', p.description],
                ['Category', [p.category?.name, p.subcategory].filter(Boolean).join(' / ')], ['Manufacturer', p.manufacturer?.name], ['Brand', p.brand], ['Model', p.model],
                ['Equipment', equipment], ['Specification', p.specification], ['Unit', p.unit],
                ['Supplier', sp ? <Link to={`/suppliers/${sp.supplierId}`} className="text-brand-700 hover:underline">{sp.supplier.name}</Link> : null], ['Supplier Part No.', sp?.supplierPartNumber],
                ['Price', sp?.price != null ? money(sp.price, sp.currency) : p.standardPrice != null ? `${money(p.standardPrice, p.currency)} (standard)` : null], ['Currency', sp?.currency ?? p.currency],
                ['Current Stock', <span>{qty(p.stock.onHand)} {p.unit} <StatusBadge status={p.stock.stockStatus} className="ml-1" /></span>], ['Available', `${qty(p.stock.available)} ${p.unit}`],
                ['Minimum Stock', p.stock.minStock != null ? qty(p.stock.minStock) : null], ['Recommended spare (workbook)', totalSpare ? `${qty(totalSpare)} ${p.unit}` : null],
                ['Location', locations], ['Notes', p.notes],
                ['Also known as', p.aliases.map((a: any) => a.alias).filter((a: string) => a !== p.name).join('; ')],
                ['Last purchase', p.purchase.stats ? `${money(p.purchase.stats.lastPrice, p.purchase.stats.currency)} · ${p.purchase.stats.lastSupplier} · ${date(p.purchase.stats.lastPurchaseDate)}` : null],
              ]} />
            </Card>
          )}
          {tab === 'where' && (
            <Card bodyClass="p-0">
              <Table>
                <thead><tr><Th>Equipment</Th><Th>Assembly</Th><Th>Pos.</Th><Th className="text-right">Installed</Th><Th className="text-right">Recommended spare</Th><Th>Name in source</Th><Th>Source</Th></tr></thead>
                <tbody>{p.usages.map((u: any) => (
                  <tr key={u.id}>
                    <Td><Link className="text-brand-700 hover:underline" to={`/machines/${u.assembly.equipment.id}#asm-${u.assembly.id}`}>{u.assembly.equipment.name}</Link></Td>
                    <Td>{u.assembly.name}{u.assembly.nameInferred && <span className="ml-1 text-xs text-slate-400">(inferred)</span>}</Td>
                    <Td className="font-mono text-xs">{u.position ?? ''}</Td>
                    <Td className="text-right">{u.installedRaw ?? '—'}</Td>
                    <Td className="text-right">{u.recommendedRaw ?? '—'}{u.issues.filter((x: string) => x.startsWith('pdf2021')).map((x: string) => <div key={x} className="text-[11px] text-slate-400">2021 list: {x.split(':')[1]}</div>)}</Td>
                    <Td className="font-mono text-xs">{u.nameInSource}</Td>
                    <Td className="font-mono text-xs text-slate-500">{u.sourceRecord?.sourceRef ?? (u.issues.find((x: string) => x.startsWith('copied_from:'))?.replace('copied_from:', 'copied from ') ?? 'manual')}</Td>
                  </tr>
                ))}</tbody>
              </Table>
              {p.assembliesOf.length > 0 && (
                <div className="border-t p-3 text-sm">This part is an assembly: {p.assembliesOf.map((a: any) => <Link key={a.id} to={`/machines/${a.equipment.id}#asm-${a.id}`} className="mr-2 text-brand-700 hover:underline">{a.name} ({a.usages.length} components)</Link>)}</div>
              )}
              {!p.usages.length && <Empty title="Not linked to any machine" />}
            </Card>
          )}
          {tab === 'suppliers' && <SupplierPrices part={p} />}
          {tab === 'stock' && <StockPanel part={p} />}
          {tab === 'history' && (hist.isLoading ? <Spinner /> : hist.data && <HistoryPanel data={hist.data} unit={p.unit} />)}
        </div>
      </div>
      {viewer !== null && <ImageViewer images={gallery} index={viewer} onClose={() => setViewer(null)} />}
      <AddToRequestModal part={p} open={!!adding} mode={adding ?? 'cart'} onClose={() => setAdding(null)} />
      {editing && <PartFormModal open part={p} onClose={() => setEditing(false)} />}
      <ConfirmDialog open={!!removeImg} onClose={() => setRemoveImg(null)} variant="danger" title="Remove picture" message="The picture will be removed from this part. The file is kept in storage and backups, and the action is recorded in the audit log." confirmText="Remove"
        onConfirm={async () => { await api.del(`/images/${removeImg!.id}`); qc.invalidateQueries({ queryKey: ['part', id] }); toast.success('Picture removed'); }} />
    </div>
  );
}

function HistoryPanel({ data, unit }: { data: any; unit: string }) {
  const s = data.purchase.stats;
  return (
    <div className="space-y-4">
      <Card title="Purchase price statistics">
        {s ? <KV cols={3} items={[['Last price', money(s.lastPrice, s.currency)], ['Lowest price', money(s.lowestPrice, s.currency)], ['Highest price', money(s.highestPrice, s.currency)], ['Average price', money(s.averagePrice, s.currency)], ['Last supplier', s.lastSupplier], ['Last purchase', date(s.lastPurchaseDate)]]} /> : <div className="text-sm text-slate-500">No purchases received yet.</div>}
      </Card>
      <Card title="Purchase history" bodyClass="p-0">
        {data.purchase.history.length ? (
          <Table><thead><tr><Th>Date</Th><Th>PO</Th><Th>GRN</Th><Th>Supplier</Th><Th className="text-right">Qty</Th><Th className="text-right">Unit price</Th><Th>Currency</Th></tr></thead>
            <tbody>{data.purchase.history.map((h: any, i: number) => <tr key={i}><Td>{date(h.date)}</Td><Td><Link className="font-mono text-brand-700 hover:underline" to={`/purchase-orders/${h.poId}`}>{h.poNumber}</Link></Td><Td className="font-mono">{h.grnNumber}</Td><Td>{h.supplier}</Td><Td className="text-right">{qty(h.qty)}</Td><Td className="text-right">{money(h.netPrice)}</Td><Td>{h.currency}</Td></tr>)}</tbody></Table>
        ) : <Empty title="No purchases yet" />}
      </Card>
      {data.purchase.openOrders.length > 0 && (
        <Card title="On order" bodyClass="p-0">
          <Table><thead><tr><Th>PO</Th><Th>Status</Th><Th>Supplier</Th><Th className="text-right">Ordered</Th><Th className="text-right">Received</Th><Th className="text-right">Remaining</Th><Th>Expected</Th></tr></thead>
            <tbody>{data.purchase.openOrders.map((o: any) => <tr key={o.poNumber + o.ordered}><Td><Link className="font-mono text-brand-700 hover:underline" to={`/purchase-orders/${o.poId}`}>{o.poNumber}</Link></Td><Td><StatusBadge status={o.status} /></Td><Td>{o.supplier}</Td><Td className="text-right">{qty(o.ordered)}</Td><Td className="text-right">{qty(o.received)}</Td><Td className="text-right">{qty(o.remaining)}</Td><Td>{date(o.expectedDelivery)}</Td></tr>)}</tbody></Table>
        </Card>
      )}
      <Card title="Stock movements" bodyClass="p-0">
        {data.transactions.length ? (
          <Table><thead><tr><Th>Date</Th><Th>Document</Th><Th>Type</Th><Th>Location</Th><Th className="text-right">Qty</Th><Th className="text-right">Balance</Th><Th>By</Th><Th>Reason</Th></tr></thead>
            <tbody>{data.transactions.map((t: any) => <tr key={t.id}><Td>{dateTime(t.createdAt)}</Td><Td className="font-mono">{t.docNumber}</Td><Td><StatusBadge status={t.type} /></Td><Td>{t.location.warehouse.code}/{t.location.code}</Td><Td className={cx('text-right tabular-nums', Number(t.quantity) < 0 ? 'text-red-700' : 'text-emerald-700')}>{Number(t.quantity) > 0 ? '+' : ''}{qty(t.quantity)} {unit}</Td><Td className="text-right tabular-nums">{qty(t.balanceAfter)}</Td><Td>{t.user.fullName}</Td><Td className="text-slate-600">{t.reason}</Td></tr>)}</tbody></Table>
        ) : <Empty title="No stock movements" />}
      </Card>
      <Card title="Requests" bodyClass="p-0">
        {data.prLines.length ? (
          <Table><thead><tr><Th>PR</Th><Th>Date</Th><Th>Status</Th><Th className="text-right">Qty</Th></tr></thead>
            <tbody>{data.prLines.map((l: any) => <tr key={l.id}><Td><Link className="font-mono text-brand-700 hover:underline" to={`/requests/${l.pr.id}`}>{l.pr.prNumber}</Link></Td><Td>{date(l.pr.requestDate)}</Td><Td><StatusBadge status={l.pr.status} /></Td><Td className="text-right">{qty(l.quantity)}</Td></tr>)}</tbody></Table>
        ) : <Empty title="Never requested" />}
      </Card>
      <Card title="Changes to this part" bodyClass="p-0">
        {data.audit.length ? (
          <Table><thead><tr><Th>When</Th><Th>User</Th><Th>Action</Th><Th>Old</Th><Th>New</Th></tr></thead>
            <tbody>{data.audit.map((a: any) => <tr key={a.id}><Td>{dateTime(a.createdAt)}</Td><Td>{a.user?.fullName ?? 'system'}</Td><Td>{a.action}</Td><Td className="max-w-xs truncate font-mono text-xs" title={JSON.stringify(a.oldValue)}>{a.oldValue ? JSON.stringify(a.oldValue) : ''}</Td><Td className="max-w-xs truncate font-mono text-xs" title={JSON.stringify(a.newValue)}>{a.newValue ? JSON.stringify(a.newValue) : ''}</Td></tr>)}</tbody></Table>
        ) : <Empty title="No changes recorded" />}
      </Card>
    </div>
  );
}

function SupplierPrices({ part }: { part: any }) {
  const { can } = useAuth();
  const qc = useQueryClient();
  const toast = useToast();
  const lookups = useQuery({ queryKey: ['lookups'], queryFn: () => api.get('/lookups'), staleTime: 300_000 });
  const [f, setF] = useState({ supplierId: '', supplierPartNumber: '', price: '', currency: 'SAR', leadTimeDays: '', isPreferred: false });
  const save = useMutation({
    mutationFn: () => api.put(`/suppliers/${f.supplierId}/parts`, { partId: part.id, supplierPartNumber: f.supplierPartNumber || null, price: f.price === '' ? null : Number(f.price), currency: f.currency, leadTimeDays: f.leadTimeDays === '' ? null : Number(f.leadTimeDays), isPreferred: f.isPreferred }),
    onSuccess: () => { toast.success('Supplier price saved'); qc.invalidateQueries({ queryKey: ['part', String(part.id)] }); setF({ ...f, supplierId: '', supplierPartNumber: '', price: '' }); },
    onError: (e) => toast.error(e),
  });
  return (
    <Card bodyClass="p-0">
      {part.supplierParts.length ? (
        <Table><thead><tr><Th>Supplier</Th><Th>Supplier Part No.</Th><Th className="text-right">Price</Th><Th>Lead time</Th><Th>Preferred</Th>{can('suppliers.manage') && <Th />}</tr></thead>
          <tbody>{part.supplierParts.map((s: any) => (
            <tr key={s.id}><Td><Link to={`/suppliers/${s.supplierId}`} className="text-brand-700 hover:underline">{s.supplier.name}</Link></Td><Td className="font-mono">{s.supplierPartNumber ?? '—'}</Td><Td className="text-right">{money(s.price, s.currency)}</Td><Td>{s.leadTimeDays != null ? `${s.leadTimeDays} days` : '—'}</Td><Td>{s.isPreferred ? <Badge tone="green">Preferred</Badge> : ''}</Td>
              {can('suppliers.manage') && <Td><Button variant="ghost" onClick={() => setF({ supplierId: String(s.supplierId), supplierPartNumber: s.supplierPartNumber ?? '', price: s.price ?? '', currency: s.currency, leadTimeDays: s.leadTimeDays ?? '', isPreferred: s.isPreferred })}>Edit</Button></Td>}</tr>
          ))}</tbody></Table>
      ) : <Empty title="No supplier linked yet" />}
      {can('suppliers.manage') && (
        <div className="grid gap-2 border-t bg-slate-50 p-3 sm:grid-cols-6">
          <Select value={f.supplierId} onChange={(e) => { const s = lookups.data?.suppliers.find((x: any) => String(x.id) === e.target.value); setF({ ...f, supplierId: e.target.value, currency: s?.currency ?? f.currency }); }} className="sm:col-span-2" aria-label="Supplier">
            <option value="">Add / update supplier…</option>{lookups.data?.suppliers?.map((s: any) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </Select>
          <Input placeholder="Supplier part no." value={f.supplierPartNumber} onChange={(e) => setF({ ...f, supplierPartNumber: e.target.value })} />
          <Input type="number" min={0} step="0.01" placeholder="Price" value={f.price} onChange={(e) => setF({ ...f, price: e.target.value })} />
          <Input placeholder="Lead days" type="number" min={0} value={f.leadTimeDays} onChange={(e) => setF({ ...f, leadTimeDays: e.target.value })} />
          <div className="flex items-center gap-2"><label className="flex items-center gap-1 text-xs"><input type="checkbox" checked={f.isPreferred} onChange={(e) => setF({ ...f, isPreferred: e.target.checked })} />Preferred</label><Button variant="primary" disabled={!f.supplierId} loading={save.isPending} onClick={() => save.mutate()}>Save</Button></div>
        </div>
      )}
      {can('suppliers.manage') && !lookups.data?.suppliers?.length && <div className="px-3 pb-3 text-xs text-slate-500">No suppliers yet — <Link className="text-brand-700 underline" to="/suppliers">create one</Link>.</div>}
    </Card>
  );
}

function StockPanel({ part }: { part: any }) {
  const { can } = useAuth();
  const qc = useQueryClient();
  const toast = useToast();
  const lookups = useQuery({ queryKey: ['lookups'], queryFn: () => api.get('/lookups'), staleTime: 300_000 });
  const locs = lookups.data?.warehouses?.flatMap((w: any) => w.locations.map((l: any) => ({ id: l.id, label: `${w.code}/${l.code}` }))) ?? [];
  const [f, setF] = useState({ locationId: '', minStock: '', maxStock: '', reorderLevel: '' });
  useEffect(() => { if (!f.locationId && locs.length) setF((x) => ({ ...x, locationId: String(locs[0].id) })); }, [locs.length]); // eslint-disable-line
  const save = useMutation({
    mutationFn: () => api.put('/inventory/levels', { partId: part.id, locationId: Number(f.locationId), minStock: f.minStock === '' ? null : Number(f.minStock), maxStock: f.maxStock === '' ? null : Number(f.maxStock), reorderLevel: f.reorderLevel === '' ? null : Number(f.reorderLevel) }),
    onSuccess: () => { toast.success('Stock levels saved'); qc.invalidateQueries({ queryKey: ['part', String(part.id)] }); },
    onError: (e) => toast.error(e),
  });
  const s = part.stock;
  return (
    <Card>
      <KV cols={3} items={[['Current stock', `${qty(s.onHand)} ${part.unit}`], ['Reserved', qty(s.reserved)], ['Available', qty(s.available)], ['Minimum', qty(s.minStock)], ['Maximum', qty(s.maxStock)], ['Reorder level', qty(s.reorderLevel)]]} />
      <div className="mt-3"><StatusBadge status={s.stockStatus} /></div>
      {part.inventory.length > 0 && (
        <Table className="mt-4"><thead><tr><Th>Warehouse / location</Th><Th className="text-right">On hand</Th><Th className="text-right">Min</Th><Th className="text-right">Max</Th><Th className="text-right">Reorder</Th></tr></thead>
          <tbody>{part.inventory.map((i: any) => <tr key={i.id}><Td>{i.location.warehouse.name} / {i.location.code}</Td><Td className="text-right">{qty(i.onHand)}</Td><Td className="text-right">{qty(i.minStock)}</Td><Td className="text-right">{qty(i.maxStock)}</Td><Td className="text-right">{qty(i.reorderLevel)}</Td></tr>)}</tbody></Table>
      )}
      {can('inventory.adjust') && (
        <div className="mt-4 grid gap-2 rounded-md bg-slate-50 p-3 sm:grid-cols-5">
          <Select value={f.locationId} onChange={(e) => { const inv = part.inventory.find((i: any) => String(i.locationId) === e.target.value); setF({ locationId: e.target.value, minStock: inv?.minStock ?? '', maxStock: inv?.maxStock ?? '', reorderLevel: inv?.reorderLevel ?? '' }); }} aria-label="Location">{locs.map((l: any) => <option key={l.id} value={l.id}>{l.label}</option>)}</Select>
          <Input type="number" min={0} placeholder="Min" value={f.minStock} onChange={(e) => setF({ ...f, minStock: e.target.value })} aria-label="Minimum stock" />
          <Input type="number" min={0} placeholder="Max" value={f.maxStock} onChange={(e) => setF({ ...f, maxStock: e.target.value })} aria-label="Maximum stock" />
          <Input type="number" min={0} placeholder="Reorder" value={f.reorderLevel} onChange={(e) => setF({ ...f, reorderLevel: e.target.value })} aria-label="Reorder level" />
          <Button variant="primary" loading={save.isPending} disabled={!f.locationId} onClick={() => save.mutate()}>Save levels</Button>
        </div>
      )}
    </Card>
  );
}

export function PartFormModal({ open, onClose, part }: { open: boolean; onClose: () => void; part?: any }) {
  const qc = useQueryClient();
  const toast = useToast();
  const nav = useNavigate();
  const lookups = useQuery({ queryKey: ['lookups'], queryFn: () => api.get('/lookups'), staleTime: 300_000 });
  const [f, setF] = useState<any>(() => ({
    partNumber: part?.partNumber ?? '', itemCode: part?.itemCode ?? '', name: part?.name ?? '', description: part?.description ?? '', specification: part?.specification ?? '',
    categoryId: part?.categoryId ?? '', subcategory: part?.subcategory ?? '', manufacturerId: part?.manufacturerId ?? '', brand: part?.brand ?? '', model: part?.model ?? '',
    unit: part?.unit ?? 'PCS', standardPrice: part?.standardPrice ?? '', currency: part?.currency ?? 'SAR', notes: part?.notes ?? '', isCritical: part?.isCritical ?? false,
  }));
  const set = (k: string) => (e: any) => setF({ ...f, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value });
  const m = useMutation({
    mutationFn: () => {
      const body = { ...f, categoryId: f.categoryId ? Number(f.categoryId) : null, manufacturerId: f.manufacturerId ? Number(f.manufacturerId) : null, standardPrice: f.standardPrice === '' ? null : Number(f.standardPrice) };
      if (part) delete body.partNumber;
      return part ? api.patch(`/parts/${part.id}`, body) : api.post('/parts', body);
    },
    onSuccess: (r: any) => {
      toast.success(part ? 'Part updated (change recorded in the audit log)' : `Part ${r.partNumber} created`);
      qc.invalidateQueries({ queryKey: ['part'] }); qc.invalidateQueries({ queryKey: ['parts'] });
      onClose();
      if (!part) nav(`/parts/${r.id}`);
    },
    onError: (e) => toast.error(e),
  });
  return (
    <Modal open={open} onClose={onClose} size="lg" title={part ? `Edit ${part.partNumber}` : 'New part'} footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" loading={m.isPending} disabled={!f.name || !f.partNumber} onClick={() => m.mutate()}>Save</Button></>}>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Part number" required hint={part ? 'Part numbers cannot be changed (history is linked to them)' : undefined}><Input value={f.partNumber} onChange={set('partNumber')} disabled={!!part} /></Field>
        <Field label="Item code"><Input value={f.itemCode} onChange={set('itemCode')} /></Field>
        <Field label="Part name" required className="sm:col-span-2"><Input value={f.name} onChange={set('name')} /></Field>
        <Field label="Description" className="sm:col-span-2"><Textarea rows={2} value={f.description} onChange={set('description')} /></Field>
        <Field label="Specification" className="sm:col-span-2"><Textarea rows={2} value={f.specification} onChange={set('specification')} placeholder="e.g. bearing 6205-2RS, 25x52x15 mm" /></Field>
        <Field label="Category"><Select value={f.categoryId} onChange={set('categoryId')}><option value="">—</option>{lookups.data?.categories?.map((c: any) => <option key={c.id} value={c.id}>{c.name}</option>)}</Select></Field>
        <Field label="Subcategory"><Input value={f.subcategory} onChange={set('subcategory')} /></Field>
        <Field label="Manufacturer"><Select value={f.manufacturerId} onChange={set('manufacturerId')}><option value="">—</option>{lookups.data?.manufacturers?.map((c: any) => <option key={c.id} value={c.id}>{c.name}</option>)}</Select></Field>
        <Field label="Brand"><Input value={f.brand} onChange={set('brand')} /></Field>
        <Field label="Model"><Input value={f.model} onChange={set('model')} /></Field>
        <Field label="Unit"><Select value={f.unit} onChange={set('unit')}>{['PCS', 'SET', 'M', 'KG', 'L', 'BOX', 'ROLL', 'PAIR'].map((u) => <option key={u}>{u}</option>)}</Select></Field>
        <Field label="Standard price (estimate)"><Input type="number" min={0} step="0.01" value={f.standardPrice} onChange={set('standardPrice')} /></Field>
        <Field label="Currency"><Input maxLength={3} value={f.currency} onChange={(e) => setF({ ...f, currency: e.target.value.toUpperCase() })} /></Field>
        <Field label="Notes" className="sm:col-span-2"><Textarea rows={2} value={f.notes} onChange={set('notes')} /></Field>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={f.isCritical} onChange={set('isCritical')} />Recommended / critical spare</label>
      </div>
    </Modal>
  );
}
