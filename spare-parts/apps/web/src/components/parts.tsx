import { useEffect, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ChevronLeft, ChevronRight, Minus, Plus, RotateCcw, ZoomIn, ZoomOut } from 'lucide-react';
import { api, fileUrl } from '../lib/api';
import { useToast } from '../lib/toast';
import { useAuth } from '../lib/auth';
import { Button, Field, Input, Modal, Select, Textarea } from './ui';

export interface Img { id: number; storageKey: string; thumbKey: string | null; caption: string | null; kind: string; width?: number | null; height?: number | null }

/** Full-screen zoomable image viewer (wheel / buttons / drag to pan). */
export function ImageViewer({ images, index, onClose }: { images: Img[]; index: number; onClose: () => void }) {
  const [i, setI] = useState(index);
  const [z, setZ] = useState(1);
  const [pos, setPos] = useState({ x: 0, y: 0 });
  const drag = useRef<{ x: number; y: number } | null>(null);
  useEffect(() => { setZ(1); setPos({ x: 0, y: 0 }); }, [i]);
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      if (e.key === 'ArrowRight') setI((x) => Math.min(images.length - 1, x + 1));
      if (e.key === 'ArrowLeft') setI((x) => Math.max(0, x - 1));
      if (e.key === '+') setZ((x) => Math.min(8, x * 1.25));
      if (e.key === '-') setZ((x) => Math.max(1, x / 1.25));
    };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [images.length, onClose]);
  const img = images[i];
  return (
    <div className="fixed inset-0 z-[60] flex flex-col bg-slate-950/95 text-white" role="dialog" aria-modal="true">
      <div className="flex items-center gap-2 px-4 py-2 text-sm">
        <span className="flex-1 truncate">{img.caption ?? ''} <span className="text-slate-400">({i + 1}/{images.length}{img.kind === 'DRAWING' ? ' · drawing' : ''})</span></span>
        <button className="rounded p-1.5 hover:bg-white/10" onClick={() => setZ((x) => Math.max(1, x / 1.25))} aria-label="Zoom out"><ZoomOut className="h-5 w-5" /></button>
        <span className="w-12 text-center">{Math.round(z * 100)}%</span>
        <button className="rounded p-1.5 hover:bg-white/10" onClick={() => setZ((x) => Math.min(8, x * 1.25))} aria-label="Zoom in"><ZoomIn className="h-5 w-5" /></button>
        <button className="rounded p-1.5 hover:bg-white/10" onClick={() => { setZ(1); setPos({ x: 0, y: 0 }); }} aria-label="Reset zoom"><RotateCcw className="h-5 w-5" /></button>
        <button className="ml-2 rounded bg-white/10 px-3 py-1 hover:bg-white/20" onClick={onClose}>Close</button>
      </div>
      <div className="relative flex-1 cursor-grab overflow-hidden active:cursor-grabbing"
        onWheel={(e) => setZ((x) => Math.min(8, Math.max(1, x * (e.deltaY < 0 ? 1.15 : 1 / 1.15))))}
        onMouseDown={(e) => { drag.current = { x: e.clientX - pos.x, y: e.clientY - pos.y }; }}
        onMouseMove={(e) => { if (drag.current) setPos({ x: e.clientX - drag.current.x, y: e.clientY - drag.current.y }); }}
        onMouseUp={() => { drag.current = null; }} onMouseLeave={() => { drag.current = null; }}
        onDoubleClick={() => setZ((x) => (x > 1 ? 1 : 2.5))}>
        <img src={fileUrl(img.storageKey)!} alt={img.caption ?? ''} draggable={false}
          className="absolute left-1/2 top-1/2 max-h-full max-w-full select-none bg-white"
          style={{ transform: `translate(calc(-50% + ${pos.x}px), calc(-50% + ${pos.y}px)) scale(${z})`, transition: drag.current ? 'none' : 'transform .12s' }} />
        {i > 0 && <button onClick={() => setI(i - 1)} className="absolute left-3 top-1/2 rounded-full bg-black/50 p-2 hover:bg-black/70" aria-label="Previous"><ChevronLeft className="h-6 w-6" /></button>}
        {i < images.length - 1 && <button onClick={() => setI(i + 1)} className="absolute right-3 top-1/2 rounded-full bg-black/50 p-2 hover:bg-black/70" aria-label="Next"><ChevronRight className="h-6 w-6" /></button>}
      </div>
      <div className="flex gap-2 overflow-x-auto px-4 py-2">
        {images.map((m, k) => (
          <button key={m.id} onClick={() => setI(k)} className={`h-14 w-20 shrink-0 overflow-hidden rounded border-2 bg-white ${k === i ? 'border-amber-400' : 'border-transparent opacity-70'}`}>
            <img src={fileUrl(m.thumbKey ?? m.storageKey)!} alt="" className="h-full w-full object-contain" />
          </button>
        ))}
      </div>
    </div>
  );
}

export function QtyStepper({ value, onChange, min = 0 }: { value: number; onChange: (v: number) => void; min?: number }) {
  return (
    <div className="inline-flex items-center rounded-md border border-slate-300 bg-white">
      <button type="button" className="px-2 py-1.5 text-slate-600 hover:bg-slate-50 disabled:opacity-40" onClick={() => onChange(Math.max(min, value - 1))} disabled={value <= min} aria-label="Decrease"><Minus className="h-3.5 w-3.5" /></button>
      <input type="number" min={min} step="any" value={value} onChange={(e) => onChange(Math.max(min, Number(e.target.value) || 0))} className="w-16 border-x border-slate-200 py-1 text-center text-sm focus:outline-none" aria-label="Quantity" />
      <button type="button" className="px-2 py-1.5 text-slate-600 hover:bg-slate-50" onClick={() => onChange(value + 1)} aria-label="Increase"><Plus className="h-3.5 w-3.5" /></button>
    </div>
  );
}

/** "Add to request" / "Add to PR" dialog used from the catalogue and part page. */
export function AddToRequestModal({ part, open, onClose, mode = 'cart', equipmentId }: { part: { id: number; partNumber: string; name: string; unit: string } | null; equipmentId?: number; open: boolean; onClose: () => void; mode?: 'cart' | 'pr' }) {
  const qc = useQueryClient();
  const toast = useToast();
  const { me } = useAuth();
  const lookups = useQuery({ queryKey: ['lookups'], queryFn: () => api.get('/lookups'), staleTime: 300_000 });
  const drafts = useQuery({ queryKey: ['my-drafts'], queryFn: () => api.get('/prs?scope=mine&status=DRAFT&pageSize=50'), enabled: open && mode === 'pr' });
  const [f, setF] = useState({ quantity: 1, requiredDate: '', reason: 'Maintenance', equipmentId: '', machine: '', project: '', notes: '', prId: '' });
  useEffect(() => { if (open) setF((x) => ({ ...x, quantity: 1, notes: '', equipmentId: equipmentId ? String(equipmentId) : x.equipmentId })); }, [open, part?.id, equipmentId]);
  const m = useMutation({
    mutationFn: async () => {
      const line = { partId: part!.id, quantity: f.quantity, requiredDate: f.requiredDate || null, reason: f.reason || null, equipmentId: f.equipmentId ? Number(f.equipmentId) : null, machine: f.machine || null, notes: [f.project && `Project: ${f.project}`, f.notes].filter(Boolean).join(' — ') || null };
      if (mode === 'pr') {
        if (f.prId) return api.post(`/prs/${f.prId}/lines`, line);
        return api.post('/prs', { department: me?.department, project: f.project || null, requiredDate: f.requiredDate || null, reason: f.reason || null, lines: [line] });
      }
      return api.post('/cart', { ...line, project: f.project || null, notes: f.notes || null });
    },
    onSuccess: (r: any) => {
      qc.invalidateQueries({ queryKey: ['cart'] });
      qc.invalidateQueries({ queryKey: ['my-drafts'] });
      toast.success(mode === 'pr' ? `${part!.partNumber} added to ${r.prNumber}` : `${f.quantity} × ${part!.partNumber} added to your request`);
      onClose();
    },
    onError: (e) => toast.error(e),
  });
  if (!part) return null;
  return (
    <Modal open={open} onClose={onClose} title={mode === 'pr' ? `Add ${part.partNumber} to a PR` : `Add ${part.partNumber} to request`} footer={<>
      <Button onClick={onClose}>Cancel</Button>
      <Button variant="primary" loading={m.isPending} disabled={!(f.quantity > 0)} onClick={() => m.mutate()}>{mode === 'pr' ? 'Add to PR' : 'Add to request'}</Button>
    </>}>
      <div className="mb-3 rounded-md bg-slate-50 px-3 py-2 text-sm"><span className="font-mono font-semibold">{part.partNumber}</span> — {part.name}</div>
      <div className="grid gap-3 sm:grid-cols-2">
        {mode === 'pr' && (
          <Field label="Purchase requisition" className="sm:col-span-2">
            <Select value={f.prId} onChange={(e) => setF({ ...f, prId: e.target.value })}>
              <option value="">➕ Create a new draft PR</option>
              {drafts.data?.items?.map((p: any) => <option key={p.id} value={p.id}>{p.prNumber} — {p.lineCount} lines{p.project ? ` — ${p.project}` : ''}</option>)}
            </Select>
          </Field>
        )}
        <Field label={`Quantity (${part.unit})`} required><QtyStepper value={f.quantity} onChange={(v) => setF({ ...f, quantity: v })} min={0} /></Field>
        <Field label="Required date"><Input type="date" value={f.requiredDate} onChange={(e) => setF({ ...f, requiredDate: e.target.value })} /></Field>
        <Field label="Equipment">
          <Select value={f.equipmentId} onChange={(e) => setF({ ...f, equipmentId: e.target.value })}>
            <option value="">— Select —</option>
            {lookups.data?.equipment?.map((e: any) => <option key={e.id} value={e.id}>{e.name}</option>)}
          </Select>
        </Field>
        <Field label="Machine / unit"><Input placeholder="e.g. Concrete Plant #1" value={f.machine} onChange={(e) => setF({ ...f, machine: e.target.value })} /></Field>
        <Field label="Reason">
          <Select value={f.reason} onChange={(e) => setF({ ...f, reason: e.target.value })}>
            {['Maintenance', 'Breakdown repair', 'Preventive maintenance', 'Stock replenishment', 'Project', 'Other'].map((r) => <option key={r}>{r}</option>)}
          </Select>
        </Field>
        <Field label="Project"><Input value={f.project} onChange={(e) => setF({ ...f, project: e.target.value })} /></Field>
        <Field label="Notes" className="sm:col-span-2"><Textarea rows={2} value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} /></Field>
      </div>
    </Modal>
  );
}
