import { useEffect, useRef, useState } from 'react';
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Copy, Factory, ImagePlus, Info, Pencil, ShoppingCart, Star } from 'lucide-react';
import { api, fileUrl } from '../lib/api';
import { useAuth } from '../lib/auth';
import { useToast } from '../lib/toast';
import { Badge, Button, Card, Empty, ErrorState, Field, Input, KV, Modal, PageHeader, Spinner, Table, Td, Textarea, Th, cx } from '../components/ui';
import { AddToRequestModal, ImageViewer, type Img } from '../components/parts';

/** Browse the catalogue like the spare-parts books: plant/machine → assembly drawing → parts. */
export default function Machines() {
  const { id } = useParams();
  const nav = useNavigate();
  const loc = useLocation();
  const { can } = useAuth();
  const toast = useToast();
  const qc = useQueryClient();
  const lookups = useQuery({ queryKey: ['lookups'], queryFn: () => api.get('/lookups'), staleTime: 300_000 });
  const equipmentId = id ?? lookups.data?.equipment?.[0]?.id;
  const q = useQuery({ queryKey: ['equipment', equipmentId], queryFn: () => api.get(`/equipment/${equipmentId}`), enabled: !!equipmentId });
  const [viewer, setViewer] = useState<{ images: Img[]; i: number } | null>(null);
  const [adding, setAdding] = useState<any>(null);
  const [dialog, setDialog] = useState<'copy' | 'edit' | null>(null);
  const uploadRef = useRef<HTMLInputElement>(null);
  const [uploadAsm, setUploadAsm] = useState<number | null>(null);
  const [showAll, setShowAll] = useState(false); // trucks: also show parts for other models
  useEffect(() => {
    if (q.data && loc.hash) document.getElementById(loc.hash.slice(1))?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, [q.data, loc.hash]);
  if (lookups.isLoading) return <Spinner />;
  const groups = new Map<string, any[]>();
  for (const e of lookups.data?.equipment ?? []) {
    const k = e.manufacturer?.name ?? 'Other';
    groups.set(k, [...(groups.get(k) ?? []), e]);
  }
  const e = q.data;
  return (
    <div>
      <PageHeader title="Machines & assemblies" subtitle="Browse the spare-parts books by plant and machine, with the original assembly drawings" />
      <div className="grid gap-4 lg:grid-cols-[260px_minmax(0,1fr)]">
        <Card bodyClass="p-1">
          <nav className="flex flex-col">
            {[...groups].map(([maker, list]) => (
              <div key={maker}>
                <div className="px-3 pb-1 pt-3 text-xs font-semibold uppercase tracking-wide text-slate-400">{maker}</div>
                {list.map((x: any) => (
                  <button key={x.id} onClick={() => nav(`/machines/${x.id}`)} className={cx('flex w-full items-center gap-2 rounded px-3 py-2 text-left text-sm', String(x.id) === String(equipmentId) ? 'bg-brand-50 font-semibold text-brand-800' : 'text-slate-700 hover:bg-slate-50')}>
                    <Factory className="h-4 w-4 shrink-0" /><span className="flex-1">{x.name}</span><span className="text-xs text-slate-400">{x.assemblies.length}</span>
                  </button>
                ))}
              </div>
            ))}
          </nav>
        </Card>
        <div className="min-w-0 space-y-4">
          {q.isLoading ? <Spinner /> : q.error ? <ErrorState error={q.error} /> : e && (
            <>
              {(e.serialNumber || e.notes || e.location || e.copiedFrom || e.copies?.length > 0 || e.vehicleSeries) && (
                <Card title={e.name} actions={can('parts.edit') && (
                  <div className="flex flex-wrap gap-2">
                    <Button icon={<Pencil className="h-4 w-4" />} onClick={() => setDialog('edit')}>Edit</Button>
                    {e.serialNumber && <Button icon={<Copy className="h-4 w-4" />} onClick={() => setDialog('copy')}>Add another plant of this model</Button>}
                  </div>
                )}>
                  <KV items={[
                    ['Manufacturer', e.manufacturer?.name ?? '—'],
                    ['Model', e.model ?? '—'],
                    ['Serial number', e.serialNumber ? <span className="font-mono font-semibold">{e.serialNumber}</span> : '—'],
                    ['Location', e.location ?? '—'],
                    ...(e.vehicleSeries || e.engine ? [['Series / type code', `${e.vehicleSeries ?? '—'} / ${e.typeCode ?? '—'}`], ['Engine', e.engine ?? <span key="en" className="text-amber-700">not set — add it with Edit (from the engine plate)</span>]] as [string, any][] : []),
                    ...(e.copiedFrom ? [['Catalogue copied from', <Link key="c" to={`/machines/${e.copiedFrom.id}`} className="text-brand-700 hover:underline">{e.copiedFrom.name}</Link>] as [string, JSX.Element]] : []),
                    ...(e.copies?.length ? [['Same model', <span key="s">{e.copies.map((c: any) => <Link key={c.id} to={`/machines/${c.id}`} className="mr-3 text-brand-700 hover:underline">{c.name}</Link>)}</span>] as [string, JSX.Element]] : []),
                  ]} />
                  {e.notes && <p className="mt-3 flex gap-2 whitespace-pre-line rounded bg-amber-50 p-2 text-sm text-amber-900"><Info className="mt-0.5 h-4 w-4 shrink-0" />{e.notes}</p>}
                  {e.fitCount && <FitSummary count={e.fitCount} engine={e.engine} showAll={showAll} onToggle={() => setShowAll(!showAll)} />}
                </Card>
              )}
              {e.assemblies.filter((a: any) => showAll || !e.fitCount || a.usages.some((u: any) => u.fit !== 'OTHER_MODEL') || a.infoLines.length).map((a: any) => <AssemblyCard key={a.id} a={a} showAll={showAll} sections={e.assemblies} onZoom={(i) => setViewer({ images: a.images, i })} onAdd={setAdding}
                onUpload={() => { setUploadAsm(a.id); uploadRef.current?.click(); }} />)}
            </>
          )}
        </div>
      </div>
      <input ref={uploadRef} type="file" accept="image/jpeg,image/png,image/webp" hidden multiple onChange={async (ev) => {
        const files = ev.target.files; ev.target.value = '';
        if (!files?.length || !uploadAsm) return;
        const f = new FormData(); Array.from(files).forEach((x) => f.append('files', x));
        try { await api.upload(`/assemblies/${uploadAsm}/images`, f); toast.success('Drawing added'); qc.invalidateQueries({ queryKey: ['equipment'] }); } catch (err) { toast.error(err); }
      }} />
      {viewer && <ImageViewer images={viewer.images} index={viewer.i} onClose={() => setViewer(null)} />}
      <AddToRequestModal part={adding} open={!!adding} onClose={() => setAdding(null)} equipmentId={e?.id} />
      {dialog === 'copy' && e && <CopyPlantModal equipment={e} onClose={() => setDialog(null)} onDone={(newId) => { setDialog(null); nav(`/machines/${newId}`); }} />}
      {dialog === 'edit' && e && <EditPlantModal equipment={e} onClose={() => setDialog(null)} />}
    </div>
  );
}

const FIT_BADGE: Record<string, { tone: 'green' | 'amber' | 'red' | 'slate'; label: string }> = {
  FITS: { tone: 'green', label: 'Fits' }, CHECK_ENGINE: { tone: 'amber', label: 'Check engine' },
  OTHER_MODEL: { tone: 'red', label: 'Other model' }, UNKNOWN: { tone: 'slate', label: 'Model not given' },
};

/** Trucks: how many catalogue parts fit, need an engine check, or are for other models. */
function FitSummary({ count, engine, showAll, onToggle }: { count: Record<string, number>; engine: string | null; showAll: boolean; onToggle: () => void }) {
  return (
    <div className="mt-3 flex flex-wrap items-center gap-2 rounded border bg-slate-50 p-2 text-sm">
      <span className="font-medium text-slate-700">Parts in the DT catalogue for this truck:</span>
      {Object.entries(FIT_BADGE).filter(([k]) => count[k]).map(([k, b]) => <Badge key={k} tone={b.tone}>{b.label}: {count[k]}</Badge>)}
      <Button variant="ghost" className="ml-auto" onClick={onToggle}>{showAll ? 'Hide parts for other models' : `Show all (${count.OTHER_MODEL ?? 0} for other models)`}</Button>
      <p className="w-full text-xs text-slate-500">From the catalogue's "Suitable for" text: model series (and MAN type code where the catalogue names one){engine ? ' and engine' : '. "Check engine" parts are engine-specific: set the engine with Edit to sort them too'}.</p>
    </div>
  );
}

function AssemblyCard({ a, showAll = true, sections = [], onZoom, onAdd, onUpload }: { a: any; showAll?: boolean; sections?: any[]; onZoom: (i: number) => void; onAdd: (p: any) => void; onUpload: () => void }) {
  const seeLink = (u: any) => { const n = u.issues?.find((i: string) => i.startsWith('see:'))?.slice(4); const s = n && sections.find((x: any) => x.name === n); return s ? <a href={`#asm-${s.id}`} className="mt-0.5 block text-xs text-brand-700 hover:underline">See {s.name}</a> : null; };
  const { can } = useAuth();
  const hasPos = a.usages.some((u: any) => u.position) || a.infoLines.length > 0;
  const hasPhotos = a.usages.some((u: any) => u.part.images?.length);
  const rows = [...a.usages.filter((u: any) => showAll || u.fit !== 'OTHER_MODEL').map((u: any) => ({ t: 'u', o: u.sortOrder, u })), ...a.infoLines.map((l: any) => ({ t: 'i', o: l.sortOrder, l }))].sort((x, y) => x.o - y.o);
  return (
    <Card className="scroll-mt-20" title={<span id={`asm-${a.id}`}>{a.name}{a.nameInferred && <span className="ml-2 text-xs font-normal text-slate-400">(name inferred — no caption in workbook)</span>}{a.assemblyPart && <Link to={`/parts/${a.assemblyPart.id}`} className="ml-2 font-mono text-xs text-brand-700 hover:underline">{a.assemblyPart.partNumber}</Link>}</span>}
      actions={can('parts.images') && <Button variant="ghost" icon={<ImagePlus className="h-4 w-4" />} onClick={onUpload}>Add drawing</Button>}>
      {a.notes?.length > 0 && <div className="mb-3 space-y-1">{a.notes.map((n: string, i: number) => <p key={i} className="flex gap-2 text-sm text-slate-600"><Info className="mt-0.5 h-4 w-4 shrink-0 text-slate-400" />{n}</p>)}</div>}
      <div className={cx('grid gap-4', (a.images.length > 0 || !hasPhotos) && '2xl:grid-cols-[minmax(0,5fr)_minmax(0,6fr)]')}>
        {(a.images.length > 0 || !hasPhotos) && <div className="flex flex-col gap-2">
          {a.images.length ? a.images.map((img: Img, i: number) => (
            <button key={img.id} onClick={() => onZoom(i)} className="overflow-hidden rounded border bg-white hover:border-brand-400" title="Click to zoom">
              <img src={fileUrl(img.thumbKey ?? img.storageKey)!} alt={a.name} loading="lazy" className="mx-auto max-h-80 w-full object-contain" />
            </button>
          )) : <Empty title="No drawing" />}
        </div>}
        <Table>
          <thead><tr>{hasPos && <Th>Pos.</Th>}<Th>Code</Th><Th>Part name</Th><Th className="text-right">{hasPos ? 'Qty' : 'Pieces'}</Th><Th className="text-right">Spare part</Th><Th /></tr></thead>
          <tbody>{rows.map((r) => r.t === 'u' ? (
            <tr key={`u${r.u.id}`} className={cx((r.u.recommendedSpare || r.u.issues?.includes('highlighted_in_book')) && 'bg-amber-50/60')} title={r.u.issues?.includes('highlighted_in_book') ? 'Highlighted in yellow in the spare-parts book' : undefined}>
              {hasPos && <Td className="font-mono text-xs text-slate-500">{r.u.position ?? ''}{r.u.issues?.includes('alternative_for_position') && <span className="ml-1 text-slate-400" title="Alternative for this position">alt.</span>}</Td>}
              <Td><Link to={`/parts/${r.u.part.id}`} className="flex items-center gap-2 font-mono font-semibold text-brand-700 hover:underline">{hasPhotos && (r.u.part.images?.[0] ? <img src={fileUrl(r.u.part.images[0].thumbKey ?? r.u.part.images[0].storageKey)!} alt="" loading="lazy" className="h-10 w-10 shrink-0 rounded border bg-white object-contain" /> : <span className="h-10 w-10 shrink-0" />)}{r.u.part.partNumber}</Link></Td>
              <Td>{r.u.recommendedSpare ? <Star className="mr-1 inline h-3.5 w-3.5 text-amber-500" aria-label="Recommended spare" /> : null}{r.u.part.name}{r.u.nameInSource && r.u.nameInSource.toUpperCase() !== r.u.part.name && <div className="text-xs text-slate-400" title="Wording in the source book">{r.u.nameInSource}</div>}{seeLink(r.u)}{r.u.fit && <div className="mt-0.5 flex flex-wrap items-center gap-1 text-xs text-slate-500"><Badge tone={FIT_BADGE[r.u.fit].tone}>{FIT_BADGE[r.u.fit].label}</Badge>{r.u.suitable ? `Suitable for ${r.u.suitable}` : r.u.fitReason}</div>}</Td>
              <Td className="text-right">{r.u.installedRaw ?? '—'}</Td>
              <Td className="text-right font-semibold">{r.u.recommendedRaw ?? ''}</Td>
              <Td>{can('cart.use') && <Button variant="ghost" aria-label="Add to request" title="Add to request" onClick={() => onAdd(r.u.part)}><ShoppingCart className="h-4 w-4" /></Button>}</Td>
            </tr>
          ) : (
            <tr key={`i${r.l.id}`} className="text-slate-500">
              {hasPos && <Td className="font-mono text-xs">{r.l.position ?? ''}</Td>}
              <Td className="text-xs">—</Td>
              <Td className="italic">{r.l.description} <Badge>{r.l.note ?? 'Not sold separately'}</Badge></Td>
              <Td className="text-right">{r.l.quantityRaw ?? ''}</Td>
              <Td /><Td />
            </tr>
          ))}</tbody>
        </Table>
      </div>
    </Card>
  );
}

function CopyPlantModal({ equipment: e, onClose, onDone }: { equipment: any; onClose: () => void; onDone: (id: number) => void }) {
  const toast = useToast();
  const qc = useQueryClient();
  const [f, setF] = useState({ serialNumber: '', name: '', location: '' });
  const m = useMutation({
    mutationFn: () => api.post(`/equipment/${e.id}/copy`, { serialNumber: f.serialNumber, name: f.name || undefined, location: f.location || null }),
    onSuccess: (x: any) => { toast.success(`${x.name} added`); qc.invalidateQueries({ queryKey: ['lookups'] }); onDone(x.id); },
    onError: (err) => toast.error(err),
  });
  return (
    <Modal open onClose={onClose} title="Add another plant of this model" footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" loading={m.isPending} disabled={!f.serialNumber.trim()} onClick={() => m.mutate()}>Add plant</Button></>}>
      <p className="mb-4 text-sm text-slate-600">
        Copies the catalogue of <b>{e.name}</b> ({e.assemblies.length} sections, drawings and positions) to a new plant with its own serial number.
        Parts are shared, so stock and purchase history stay per part. Check with the manufacturer that the other plant has the same build — the spare-parts book is issued per serial number.
      </p>
      <div className="grid gap-3">
        <Field label="Serial number" required hint="From the plant's name plate; it is required on every spare-part order"><Input value={f.serialNumber} onChange={(x) => setF({ ...f, serialNumber: x.target.value })} /></Field>
        <Field label="Name" hint={`Leave empty for "${e.serialNumber ? e.name.replace(e.serialNumber, f.serialNumber || '…') : e.name}"`}><Input value={f.name} onChange={(x) => setF({ ...f, name: x.target.value })} /></Field>
        <Field label="Location / site"><Input value={f.location} onChange={(x) => setF({ ...f, location: x.target.value })} /></Field>
      </div>
    </Modal>
  );
}

function EditPlantModal({ equipment: e, onClose }: { equipment: any; onClose: () => void }) {
  const toast = useToast();
  const qc = useQueryClient();
  const [f, setF] = useState({ name: e.name ?? '', model: e.model ?? '', serialNumber: e.serialNumber ?? '', location: e.location ?? '', notes: e.notes ?? '', vehicleSeries: e.vehicleSeries ?? '', typeCode: e.typeCode ?? '', engine: e.engine ?? '' });
  const truck = !!(e.vehicleSeries || e.engine || e.copiedFrom?.name?.includes('DT catalogue'));
  const m = useMutation({
    mutationFn: () => api.patch(`/equipment/${e.id}`, { name: f.name, model: f.model || null, serialNumber: f.serialNumber || null, location: f.location || null, notes: f.notes || null, ...(truck ? { vehicleSeries: f.vehicleSeries || null, typeCode: f.typeCode || null, engine: f.engine || null } : {}) }),
    onSuccess: () => { toast.success('Saved'); qc.invalidateQueries({ queryKey: ['lookups'] }); qc.invalidateQueries({ queryKey: ['equipment'] }); onClose(); },
    onError: (err) => toast.error(err),
  });
  return (
    <Modal open onClose={onClose} title={`Edit ${e.name}`} footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" loading={m.isPending} disabled={!f.name.trim()} onClick={() => m.mutate()}>Save</Button></>}>
      <div className="grid gap-3">
        <Field label="Name" required><Input value={f.name} onChange={(x) => setF({ ...f, name: x.target.value })} /></Field>
        <Field label="Model"><Input value={f.model} onChange={(x) => setF({ ...f, model: x.target.value })} /></Field>
        <Field label="Serial number"><Input value={f.serialNumber} onChange={(x) => setF({ ...f, serialNumber: x.target.value })} /></Field>
        <Field label="Location / site"><Input value={f.location} onChange={(x) => setF({ ...f, location: x.target.value })} /></Field>
        {truck && <div className="grid gap-3 sm:grid-cols-3">
          <Field label="Model series" hint="TGA, TGS, TGX, TGM or TGL"><Input value={f.vehicleSeries} onChange={(x) => setF({ ...f, vehicleSeries: x.target.value.toUpperCase() })} /></Field>
          <Field label="MAN type code" hint="VIN characters 4-6"><Input value={f.typeCode} onChange={(x) => setF({ ...f, typeCode: x.target.value.toUpperCase() })} /></Field>
          <Field label="Engine" hint="From the engine plate, e.g. D 2066 LF"><Input value={f.engine} onChange={(x) => setF({ ...f, engine: x.target.value.toUpperCase() })} /></Field>
        </div>}
        <Field label="Notes"><Textarea value={f.notes} onChange={(x) => setF({ ...f, notes: x.target.value })} /></Field>
      </div>
    </Modal>
  );
}
