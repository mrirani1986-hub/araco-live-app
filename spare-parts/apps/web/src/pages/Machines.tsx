import { useEffect, useRef, useState } from 'react';
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Factory, ImagePlus, ShoppingCart, Star } from 'lucide-react';
import { api, fileUrl } from '../lib/api';
import { useAuth } from '../lib/auth';
import { useToast } from '../lib/toast';
import { Button, Card, Empty, ErrorState, PageHeader, Spinner, Table, Td, Th, cx } from '../components/ui';
import { AddToRequestModal, ImageViewer, type Img } from '../components/parts';

/** Browse the catalogue like the original workbook: machine → assembly drawing → parts. */
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
  const uploadRef = useRef<HTMLInputElement>(null);
  const [uploadAsm, setUploadAsm] = useState<number | null>(null);
  useEffect(() => {
    if (q.data && loc.hash) document.getElementById(loc.hash.slice(1))?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, [q.data, loc.hash]);
  if (lookups.isLoading) return <Spinner />;
  return (
    <div>
      <PageHeader title="Machines & assemblies" subtitle="Browse the spare-parts book by machine, with the original assembly drawings" />
      <div className="grid gap-4 lg:grid-cols-[240px_minmax(0,1fr)]">
        <Card bodyClass="p-1">
          <nav className="flex flex-col">
            {lookups.data?.equipment?.map((e: any) => (
              <button key={e.id} onClick={() => nav(`/machines/${e.id}`)} className={cx('flex items-center gap-2 rounded px-3 py-2 text-left text-sm', String(e.id) === String(equipmentId) ? 'bg-brand-50 font-semibold text-brand-800' : 'text-slate-700 hover:bg-slate-50')}>
                <Factory className="h-4 w-4 shrink-0" /><span className="flex-1">{e.name}</span><span className="text-xs text-slate-400">{e.assemblies.length}</span>
              </button>
            ))}
          </nav>
        </Card>
        <div className="min-w-0 space-y-4">
          {q.isLoading ? <Spinner /> : q.error ? <ErrorState error={q.error} /> : q.data && q.data.assemblies.map((a: any) => (
            <Card key={a.id} className="scroll-mt-20" title={<span id={`asm-${a.id}`}>{a.name}{a.nameInferred && <span className="ml-2 text-xs font-normal text-slate-400">(name inferred — no caption in workbook)</span>}{a.assemblyPart && <Link to={`/parts/${a.assemblyPart.id}`} className="ml-2 font-mono text-xs text-brand-700 hover:underline">{a.assemblyPart.partNumber}</Link>}</span>}
              actions={can('parts.images') && <Button variant="ghost" icon={<ImagePlus className="h-4 w-4" />} onClick={() => { setUploadAsm(a.id); uploadRef.current?.click(); }}>Add drawing</Button>}>
              <div className="grid gap-4 2xl:grid-cols-[minmax(0,5fr)_minmax(0,6fr)]">
                <div className="flex flex-col gap-2">
                  {a.images.length ? a.images.map((img: Img, i: number) => (
                    <button key={img.id} onClick={() => setViewer({ images: a.images, i })} className="overflow-hidden rounded border bg-white hover:border-brand-400" title="Click to zoom">
                      <img src={fileUrl(img.thumbKey ?? img.storageKey)!} alt={a.name} loading="lazy" className="mx-auto max-h-80 w-full object-contain" />
                    </button>
                  )) : <Empty title="No drawing" />}
                </div>
                <Table>
                  <thead><tr><Th>Code</Th><Th>Part name</Th><Th className="text-right">Pieces</Th><Th className="text-right">Spare part</Th><Th /></tr></thead>
                  <tbody>{a.usages.map((u: any) => (
                    <tr key={u.id} className={cx(u.recommendedSpare && 'bg-amber-50/60')}>
                      <Td><Link to={`/parts/${u.part.id}`} className="font-mono font-semibold text-brand-700 hover:underline">{u.part.partNumber}</Link></Td>
                      <Td>{u.recommendedSpare ? <Star className="mr-1 inline h-3.5 w-3.5 text-amber-500" aria-label="Recommended spare" /> : null}{u.part.name}</Td>
                      <Td className="text-right">{u.installedRaw ?? '—'}</Td>
                      <Td className="text-right font-semibold">{u.recommendedRaw ?? ''}</Td>
                      <Td>{can('cart.use') && <Button variant="ghost" aria-label="Add to request" title="Add to request" onClick={() => setAdding(u.part)}><ShoppingCart className="h-4 w-4" /></Button>}</Td>
                    </tr>
                  ))}</tbody>
                </Table>
              </div>
            </Card>
          ))}
        </div>
      </div>
      <input ref={uploadRef} type="file" accept="image/jpeg,image/png,image/webp" hidden multiple onChange={async (e) => {
        const files = e.target.files; e.target.value = '';
        if (!files?.length || !uploadAsm) return;
        const f = new FormData(); Array.from(files).forEach((x) => f.append('files', x));
        try { await api.upload(`/assemblies/${uploadAsm}/images`, f); toast.success('Drawing added'); qc.invalidateQueries({ queryKey: ['equipment'] }); } catch (err) { toast.error(err); }
      }} />
      {viewer && <ImageViewer images={viewer.images} index={viewer.i} onClose={() => setViewer(null)} />}
      <AddToRequestModal part={adding} open={!!adding} onClose={() => setAdding(null)} />
    </div>
  );
}
