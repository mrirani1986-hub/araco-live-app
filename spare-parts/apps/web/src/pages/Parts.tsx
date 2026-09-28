import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { Filter, LayoutGrid, List, Plus, Printer, ShoppingCart, Star } from 'lucide-react';
import { api, fileUrl, openDoc, qs } from '../lib/api';
import { useAuth } from '../lib/auth';
import { money, qty } from '../lib/format';
import { Button, Empty, ErrorState, ExportMenu, Input, PageHeader, Pagination, Select, Spinner, StatusBadge, Table, Td, Th, Thumb, cx } from '../components/ui';
import { AddToRequestModal } from '../components/parts';
import { PartFormModal } from './PartDetail';

const FILTER_KEYS = ['q', 'categoryId', 'manufacturerId', 'supplierId', 'equipmentId', 'assemblyId', 'stockStatus', 'priceMin', 'priceMax', 'locationId', 'critical', 'sort'] as const;

export default function Parts() {
  const [sp, setSp] = useSearchParams();
  const { can } = useAuth();
  const [view, setView] = useState<'grid' | 'table'>(() => { try { return (localStorage.getItem('parts.view') as 'grid' | 'table') ?? 'grid'; } catch { return 'grid'; } });
  const [showFilters, setShowFilters] = useState(true);
  const [adding, setAdding] = useState<any>(null);
  const [creating, setCreating] = useState(false);
  const [text, setText] = useState(sp.get('q') ?? '');
  const page = Number(sp.get('page') ?? 1);
  const filters = Object.fromEntries(FILTER_KEYS.map((k) => [k, sp.get(k) ?? ''])) as Record<string, string>;
  useEffect(() => setText(sp.get('q') ?? ''), [sp]);
  useEffect(() => { try { localStorage.setItem('parts.view', view); } catch { /* ignore */ } }, [view]);
  // debounce free text
  useEffect(() => {
    const t = setTimeout(() => { if (text !== (sp.get('q') ?? '')) set('q', text); }, 300);
    return () => clearTimeout(t);
  }, [text]); // eslint-disable-line react-hooks/exhaustive-deps

  const lookups = useQuery({ queryKey: ['lookups'], queryFn: () => api.get('/lookups'), staleTime: 300_000 });
  const pageSize = view === 'grid' ? 48 : 100;
  const q = useQuery({ queryKey: ['parts', filters, page, pageSize], queryFn: () => api.get(`/parts${qs({ ...filters, page, pageSize })}`), placeholderData: keepPreviousData });

  function set(k: string, v: string) {
    const n = new URLSearchParams(sp);
    if (v) n.set(k, v); else n.delete(k);
    if (k !== 'page') n.delete('page');
    setSp(n, { replace: true });
  }
  const eq = lookups.data?.equipment ?? [];
  const selectedEq = eq.find((e: any) => String(e.id) === filters.equipmentId);
  const activeCount = FILTER_KEYS.filter((k) => k !== 'q' && k !== 'sort' && filters[k]).length;

  return (
    <div>
      <PageHeader title="Spare Parts Catalogue" subtitle={q.data ? `${q.data.total.toLocaleString()} parts` : ' '} actions={<>
        <div className="flex rounded-md border border-slate-300 bg-white p-0.5" role="group" aria-label="View">
          <button onClick={() => setView('grid')} className={cx('flex items-center gap-1 rounded px-2 py-1 text-sm', view === 'grid' ? 'bg-brand-700 text-white' : 'text-slate-600')}><LayoutGrid className="h-4 w-4" />Grid</button>
          <button onClick={() => setView('table')} className={cx('flex items-center gap-1 rounded px-2 py-1 text-sm', view === 'table' ? 'bg-brand-700 text-white' : 'text-slate-600')}><List className="h-4 w-4" />Table</button>
        </div>
        <Button icon={<Printer className="h-4 w-4" />} onClick={() => openDoc(`/parts/catalogue.pdf${qs(filters)}`)}>Print catalogue</Button>
        {can('export.run') && <ExportMenu url={`/parts/export${qs(filters)}`} />}
        {can('parts.edit') && <Button variant="primary" icon={<Plus className="h-4 w-4" />} onClick={() => setCreating(true)}>New part</Button>}
      </>} />

      <div className="mb-3 flex flex-wrap items-center gap-2">
        <Input value={text} onChange={(e) => setText(e.target.value)} placeholder="Search by part number, name, description, machine, supplier, spec… (e.g. bearing, ELKON, 1001286)" className="min-w-[260px] flex-1 py-2" autoFocus />
        <Button icon={<Filter className="h-4 w-4" />} onClick={() => setShowFilters((s) => !s)}>Filters{activeCount ? ` (${activeCount})` : ''}</Button>
        <Select value={filters.sort} onChange={(e) => set('sort', e.target.value)} className="w-auto" aria-label="Sort">
          <option value="">Sort: relevance</option><option value="partNumber">Part number</option><option value="name">Name</option><option value="stock">Stock (high→low)</option><option value="price">Price (low→high)</option>
        </Select>
      </div>
      {showFilters && (
        <div className="mb-4 grid grid-cols-2 gap-2 rounded-lg border bg-white p-3 shadow-sm md:grid-cols-3 xl:grid-cols-5">
          <Select value={filters.categoryId} onChange={(e) => set('categoryId', e.target.value)} aria-label="Category"><option value="">All categories</option>{lookups.data?.categories?.map((c: any) => <option key={c.id} value={c.id}>{c.name} ({c._count.parts})</option>)}</Select>
          <Select value={filters.equipmentId} onChange={(e) => { const n = new URLSearchParams(sp); e.target.value ? n.set('equipmentId', e.target.value) : n.delete('equipmentId'); n.delete('assemblyId'); n.delete('page'); setSp(n, { replace: true }); }} aria-label="Equipment"><option value="">All equipment</option>{eq.map((e: any) => <option key={e.id} value={e.id}>{e.name}</option>)}</Select>
          <Select value={filters.assemblyId} onChange={(e) => set('assemblyId', e.target.value)} disabled={!selectedEq} aria-label="Assembly"><option value="">{selectedEq ? 'All assemblies' : 'Assembly (pick equipment)'}</option>{selectedEq?.assemblies.map((a: any) => <option key={a.id} value={a.id}>{a.name}</option>)}</Select>
          <Select value={filters.manufacturerId} onChange={(e) => set('manufacturerId', e.target.value)} aria-label="Manufacturer"><option value="">All manufacturers</option>{lookups.data?.manufacturers?.map((m: any) => <option key={m.id} value={m.id}>{m.name}</option>)}</Select>
          <Select value={filters.supplierId} onChange={(e) => set('supplierId', e.target.value)} aria-label="Supplier"><option value="">All suppliers</option>{lookups.data?.suppliers?.map((s: any) => <option key={s.id} value={s.id}>{s.name}</option>)}</Select>
          <Select value={filters.stockStatus} onChange={(e) => set('stockStatus', e.target.value)} aria-label="Stock status"><option value="">Any stock status</option><option value="ATTENTION">Needs attention</option><option value="OUT_OF_STOCK">Out of stock</option><option value="LOW_STOCK">Low stock</option><option value="REORDER">Reorder required</option><option value="OK">In stock</option><option value="NOT_STOCKED">Not stocked</option></Select>
          <Select value={filters.locationId} onChange={(e) => set('locationId', e.target.value)} aria-label="Location"><option value="">All locations</option>{lookups.data?.warehouses?.flatMap((w: any) => w.locations.map((l: any) => <option key={l.id} value={l.id}>{w.code}/{l.code}</option>))}</Select>
          <div className="flex gap-1"><Input type="number" min={0} placeholder="Price min" value={filters.priceMin} onChange={(e) => set('priceMin', e.target.value)} aria-label="Min price" /><Input type="number" min={0} placeholder="max" value={filters.priceMax} onChange={(e) => set('priceMax', e.target.value)} aria-label="Max price" /></div>
          <label className="col-span-2 flex items-center gap-2 text-sm text-slate-600 md:col-span-1"><input type="checkbox" checked={filters.critical === 'true'} onChange={(e) => set('critical', e.target.checked ? 'true' : '')} />Recommended spares only</label>
          {activeCount > 0 && <Button variant="ghost" onClick={() => { const n = new URLSearchParams(); if (filters.q) n.set('q', filters.q); setSp(n); }}>Clear filters</Button>}
        </div>
      )}

      {q.isLoading ? <Spinner /> : q.error ? <ErrorState error={q.error} retry={() => q.refetch()} /> : !q.data.items.length ? (
        <Empty title="No parts found">Try a shorter search term, a part-number fragment, or clear the filters.</Empty>
      ) : view === 'grid' ? (
        <div className={cx('grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4', q.isFetching && 'opacity-70')}>
          {q.data.items.map((p: any) => (
            <div key={p.id} className="group flex flex-col overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm transition hover:border-brand-300 hover:shadow-md">
              <Link to={`/parts/${p.id}`} className="relative block h-44 border-b bg-white">
                <Thumb src={fileUrl(p.thumb)} alt={p.name} drawing={p.thumbIsDrawing} className="h-full w-full" />
                {p.thumbIsDrawing && <span className="absolute left-2 top-2 rounded bg-slate-900/60 px-1.5 py-0.5 text-[10px] font-medium text-white">Assembly drawing</span>}
                {p.isCritical && <span className="absolute right-2 top-2 flex items-center gap-1 rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-semibold text-amber-900"><Star className="h-3 w-3" />Spare</span>}
              </Link>
              <div className="flex flex-1 flex-col gap-1 p-3">
                <Link to={`/parts/${p.id}`} className="font-mono text-sm font-bold text-brand-700 hover:underline">{p.partNumber}</Link>
                <div className="line-clamp-2 min-h-[2.5rem] text-sm font-medium text-slate-800">{p.name}</div>
                <div className="truncate text-xs text-slate-500">{p.category ?? 'Uncategorised'}{p.equipment ? ` · ${p.equipment}` : ''}</div>
                <div className="mt-1 flex items-center justify-between text-sm">
                  <span className="tabular-nums">Stock: <b>{qty(p.onHand)}</b> {p.unit}</span>
                  <StatusBadge status={p.stockStatus} />
                </div>
                <div className="flex items-center justify-between text-xs text-slate-500">
                  <span className="truncate">{p.supplierName ?? 'No supplier yet'}</span>
                  <span className="font-semibold text-slate-800">{p.price != null ? money(p.price, p.currency) : '—'}</span>
                </div>
                {can('cart.use') && <Button className="mt-2" icon={<ShoppingCart className="h-4 w-4" />} onClick={() => setAdding(p)}>Add to request</Button>}
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className={cx('rounded-lg border bg-white shadow-sm', q.isFetching && 'opacity-70')}>
          <Table>
            <thead><tr><Th>Picture</Th><Th>Part Number</Th><Th>Part Name</Th><Th>Category</Th><Th>Manufacturer</Th><Th>Equipment</Th><Th className="text-right">Stock</Th><Th>Status</Th><Th>Supplier</Th><Th className="text-right">Price</Th><Th>Location</Th><Th /></tr></thead>
            <tbody>
              {q.data.items.map((p: any) => (
                <tr key={p.id} className="hover:bg-slate-50">
                  <Td><Thumb src={fileUrl(p.thumb)} alt="" className="h-10 w-14 rounded border" /></Td>
                  <Td><Link to={`/parts/${p.id}`} className="font-mono font-semibold text-brand-700 hover:underline">{p.partNumber}</Link></Td>
                  <Td className="max-w-[260px] truncate">{p.isCritical && <Star className="mr-1 inline h-3.5 w-3.5 text-amber-500" aria-label="Recommended spare" />}{p.name}</Td>
                  <Td className="text-slate-600">{p.category ?? '—'}</Td>
                  <Td className="text-slate-600">{p.manufacturer ?? '—'}</Td>
                  <Td className="max-w-[200px] truncate text-slate-600">{p.equipment ?? '—'}</Td>
                  <Td className="text-right tabular-nums">{qty(p.onHand)} {p.unit}</Td>
                  <Td><StatusBadge status={p.stockStatus} /></Td>
                  <Td className="text-slate-600">{p.supplierName ?? '—'}</Td>
                  <Td className="text-right tabular-nums">{p.price != null ? money(p.price, p.currency) : '—'}</Td>
                  <Td className="text-slate-600">{p.locations ?? '—'}</Td>
                  <Td>{can('cart.use') && <Button variant="ghost" onClick={() => setAdding(p)} title="Add to request" aria-label="Add to request"><ShoppingCart className="h-4 w-4" /></Button>}</Td>
                </tr>
              ))}
            </tbody>
          </Table>
        </div>
      )}
      {q.data && <Pagination page={page} pageSize={pageSize} total={q.data.total} onPage={(p) => set('page', String(p))} />}
      <AddToRequestModal part={adding} open={!!adding} onClose={() => setAdding(null)} />
      {creating && <PartFormModal open onClose={() => setCreating(false)} />}
    </div>
  );
}
