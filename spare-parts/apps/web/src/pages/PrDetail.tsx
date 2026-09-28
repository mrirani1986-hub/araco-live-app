import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Check, FilePlus2, Pencil, Printer, RotateCcw, Send, Trash2, X, XCircle } from 'lucide-react';
import { api, fileUrl, openDoc } from '../lib/api';
import { useAuth } from '../lib/auth';
import { useToast } from '../lib/toast';
import { date, dateTime, money, qty } from '../lib/format';
import { Button, Card, ConfirmDialog, ErrorState, Field, Input, KV, PageHeader, Select, Spinner, StatusBadge, Table, Td, Textarea, Th, Thumb, cx } from '../components/ui';

type Action = 'submit' | 'approve' | 'reject' | 'return' | 'cancel';

export default function PrDetail() {
  const { id } = useParams();
  const nav = useNavigate();
  const { me, can, hasRole } = useAuth();
  const toast = useToast();
  const qc = useQueryClient();
  const [action, setAction] = useState<Action | null>(null);
  const [editing, setEditing] = useState(false);
  const q = useQuery({ queryKey: ['pr', id], queryFn: () => api.get(`/prs/${id}`) });
  if (q.isLoading) return <Spinner />;
  if (q.error) return <ErrorState error={q.error} />;
  const pr = q.data;
  const isOwner = pr.requestedBy === me?.id;
  const step = pr.steps.find((s: any) => s.level === pr.currentLevel);
  const canAct = ['SUBMITTED', 'PENDING_APPROVAL'].includes(pr.status) && step && (hasRole('ADMIN') || (can('pr.approve') && hasRole(step.roleCode))) && (!isOwner || hasRole('ADMIN'));
  const editable = pr.status === 'DRAFT' && (isOwner || hasRole('ADMIN'));
  const run = async (a: Action, comment: string) => {
    const r = await api.post(`/prs/${id}/${a}`, { comment: comment || null });
    qc.setQueryData(['pr', id], { ...pr, ...r, steps: pr.steps, purchaseOrders: pr.purchaseOrders, items: r.items.map((i: any) => ({ ...i, picture: pr.items.find((x: any) => x.id === i.id)?.picture })) });
    qc.invalidateQueries({ queryKey: ['pr', id] }); qc.invalidateQueries({ queryKey: ['prs'] }); qc.invalidateQueries({ queryKey: ['pending'] });
    toast.success(`${pr.prNumber}: ${r.status.replace(/_/g, ' ').toLowerCase()}`);
  };
  const cfg: Record<Action, { title: string; msg: string; btn: string; variant: 'primary' | 'danger' | 'success'; req?: boolean }> = {
    submit: { title: 'Submit for approval', msg: 'After submitting, the PR is locked and goes to the first approver.', btn: 'Submit', variant: 'primary' },
    approve: { title: `Approve (${step?.name ?? ''})`, msg: 'Your approval is recorded with date, time and comment.', btn: 'Approve', variant: 'success' },
    reject: { title: 'Reject PR', msg: 'Rejection is final. Please give a reason.', btn: 'Reject', variant: 'danger', req: true },
    return: { title: 'Return for correction', msg: 'The PR goes back to the requester as a draft. Please explain what to change.', btn: 'Return', variant: 'primary', req: true },
    cancel: { title: 'Cancel PR', msg: 'The PR will be cancelled. This cannot be undone.', btn: 'Cancel PR', variant: 'danger' },
  };
  return (
    <div>
      <PageHeader
        back={<button onClick={() => nav('/requests')} className="mb-1 flex items-center gap-1 text-sm text-slate-500 hover:text-slate-800"><ArrowLeft className="h-4 w-4" />Requisitions</button>}
        title={<span className="flex items-center gap-3"><span className="font-mono">{pr.prNumber}</span><StatusBadge status={pr.status} /></span>}
        subtitle={`Requested by ${pr.requester.fullName} on ${date(pr.requestDate)}${step ? ` · waiting for: ${step.name}` : ''}`}
        actions={<>
          <Button icon={<Printer className="h-4 w-4" />} onClick={() => openDoc(`/prs/${id}/pdf`)}>PDF / Print</Button>
          {editable && <Button icon={<Pencil className="h-4 w-4" />} onClick={() => setEditing(true)}>Edit</Button>}
          {editable && <Button variant="primary" icon={<Send className="h-4 w-4" />} onClick={() => setAction('submit')}>Submit</Button>}
          {canAct && <>
            <Button variant="success" icon={<Check className="h-4 w-4" />} onClick={() => setAction('approve')}>Approve</Button>
            <Button icon={<RotateCcw className="h-4 w-4" />} onClick={() => setAction('return')}>Return</Button>
            <Button variant="danger" icon={<XCircle className="h-4 w-4" />} onClick={() => setAction('reject')}>Reject</Button>
          </>}
          {pr.status === 'APPROVED' && can('po.create') && <Button variant="primary" icon={<FilePlus2 className="h-4 w-4" />} onClick={() => nav(`/purchase-orders/from-pr/${id}`)}>Create PO</Button>}
          {['DRAFT', 'SUBMITTED', 'PENDING_APPROVAL', 'APPROVED'].includes(pr.status) && (isOwner || hasRole('ADMIN') || (pr.status === 'APPROVED' && can('po.create'))) && !pr.items.some((i: any) => Number(i.qtyOrdered) > 0) &&
            <Button variant="ghost" icon={<X className="h-4 w-4" />} onClick={() => setAction('cancel')}>Cancel PR</Button>}
        </>}
      />
      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_340px]">
        <div className="min-w-0 space-y-4">
          <Card>
            <KV cols={2} items={[['PR Number', <span className="font-mono">{pr.prNumber}</span>], ['Request date', date(pr.requestDate)], ['Requested by', pr.requester.fullName], ['Department', pr.department], ['Project', pr.project], ['Required date', date(pr.requiredDate)], ['Priority', pr.priority], ['Reason', pr.reason], ['Status', <StatusBadge status={pr.status} />]]} />
            {pr.notes && <div className="mt-3 rounded bg-slate-50 p-2 text-sm">{pr.notes}</div>}
          </Card>
          {editing ? <EditLines pr={pr} onDone={() => { setEditing(false); qc.invalidateQueries({ queryKey: ['pr', id] }); }} /> : (
            <Card title="Line items" bodyClass="p-0">
              <Table>
                <thead><tr><Th>#</Th><Th>Picture</Th><Th>Part Number</Th><Th>Description</Th><Th>Specification</Th><Th className="text-right">Qty</Th><Th>Unit</Th><Th className="text-right">Est. unit price</Th><Th className="text-right">Est. total</Th><Th>Supplier</Th><Th>Notes</Th>{Number(pr.items.some((i: any) => Number(i.qtyOrdered) > 0)) ? <Th className="text-right">Ordered</Th> : null}</tr></thead>
                <tbody>{pr.items.map((i: any) => (
                  <tr key={i.id} className="align-top">
                    <Td>{i.lineNo}</Td>
                    <Td><Thumb src={fileUrl(i.picture)} alt="" className="h-12 w-16 rounded border" /></Td>
                    <Td><Link to={`/parts/${i.partId}`} className="font-mono font-semibold text-brand-700 hover:underline">{i.part.partNumber}</Link></Td>
                    <Td className="max-w-[220px]">{i.description}{i.machine && <div className="text-xs text-slate-500">For: {i.machine}</div>}{i.requiredDate && <div className="text-xs text-slate-500">Needed: {date(i.requiredDate)}</div>}</Td>
                    <Td className="max-w-[160px] text-slate-600">{i.specification ?? '—'}</Td>
                    <Td className="text-right tabular-nums">{qty(i.quantity)}</Td><Td>{i.unit}</Td>
                    <Td className="text-right tabular-nums">{money(i.estUnitPrice)}</Td>
                    <Td className="text-right tabular-nums">{i.estUnitPrice != null ? money(Number(i.estUnitPrice) * Number(i.quantity)) : '—'}</Td>
                    <Td>{i.supplier?.name ?? '—'}</Td><Td className="max-w-[160px] text-xs text-slate-600">{[i.reason, i.notes].filter(Boolean).join(' — ')}</Td>
                    {pr.items.some((x: any) => Number(x.qtyOrdered) > 0) ? <Td className="text-right">{qty(i.qtyOrdered)}</Td> : null}
                  </tr>
                ))}</tbody>
              </Table>
              <div className="flex justify-end border-t p-3">
                <table className="text-sm"><tbody>
                  <tr><td className="pr-6 text-slate-500">Subtotal</td><td className="text-right tabular-nums">{money(pr.totals.subtotal, pr.currency)}</td></tr>
                  <tr><td className="pr-6 text-slate-500">Tax ({Number(pr.taxRate)}%)</td><td className="text-right tabular-nums">{money(pr.totals.tax, pr.currency)}</td></tr>
                  <tr className="font-bold"><td className="pr-6 pt-1">Estimated grand total</td><td className="pt-1 text-right tabular-nums">{money(pr.totals.grandTotal, pr.currency)}</td></tr>
                </tbody></table>
              </div>
            </Card>
          )}
          {pr.purchaseOrders.length > 0 && (
            <Card title="Purchase orders">
              <div className="flex flex-wrap gap-2">{pr.purchaseOrders.map((p: any) => <Link key={p.id} to={`/purchase-orders/${p.id}`} className="flex items-center gap-2 rounded border px-3 py-1.5 text-sm hover:border-brand-400"><span className="font-mono font-semibold text-brand-700">{p.poNumber}</span>{p.supplier.name}<StatusBadge status={p.status} /></Link>)}</div>
            </Card>
          )}
        </div>
        <Card title="Approval workflow">
          <ol className="space-y-3">
            {pr.steps.map((s: any) => {
              const done = pr.approvals.filter((a: any) => a.level === s.level).at(-1);
              const current = s.level === pr.currentLevel;
              return (
                <li key={s.id} className={cx('rounded-md border px-3 py-2 text-sm', current ? 'border-amber-300 bg-amber-50' : done?.action === 'APPROVED' ? 'border-emerald-200 bg-emerald-50' : 'border-slate-200')}>
                  <div className="flex items-center justify-between"><span className="font-semibold">{s.level}. {s.name}</span>{done ? <StatusBadge status={done.action} /> : current ? <span className="text-xs font-semibold text-amber-700">Waiting</span> : null}</div>
                  {s.minTotal && <div className="text-xs text-slate-500">Only above {money(s.minTotal)}</div>}
                </li>
              );
            })}
          </ol>
          <h3 className="mb-2 mt-5 text-xs font-semibold uppercase tracking-wide text-slate-500">History</h3>
          <ol className="space-y-2 border-l-2 border-slate-200 pl-3">
            {pr.approvals.map((a: any) => (
              <li key={a.id} className="text-sm">
                <div><StatusBadge status={a.action} /> <span className="font-medium">{a.user.fullName}</span> <span className="text-slate-500">· {a.stepName}</span></div>
                <div className="text-xs text-slate-500">{dateTime(a.createdAt)}</div>
                {a.comment && <div className="mt-0.5 rounded bg-slate-50 px-2 py-1 text-xs italic">“{a.comment}”</div>}
              </li>
            ))}
            {!pr.approvals.length && <li className="text-sm text-slate-500">Not submitted yet.</li>}
          </ol>
        </Card>
      </div>
      {action && <ConfirmDialog open onClose={() => setAction(null)} title={cfg[action].title} message={cfg[action].msg} confirmText={cfg[action].btn} variant={cfg[action].variant} withComment commentRequired={cfg[action].req} onConfirm={(c) => run(action, c)} />}
    </div>
  );
}

function EditLines({ pr, onDone }: { pr: any; onDone: () => void }) {
  const toast = useToast();
  const lookups = useQuery({ queryKey: ['lookups'], queryFn: () => api.get('/lookups'), staleTime: 300_000 });
  const [h, setH] = useState({ department: pr.department ?? '', project: pr.project ?? '', requiredDate: pr.requiredDate?.slice(0, 10) ?? '', priority: pr.priority, reason: pr.reason ?? '', notes: pr.notes ?? '' });
  const [lines, setLines] = useState(pr.items.map((i: any) => ({ partId: i.partId, partNumber: i.part.partNumber, name: i.part.name, quantity: Number(i.quantity), estUnitPrice: i.estUnitPrice ?? '', supplierId: i.supplierId ?? '', equipmentId: i.equipmentId, machine: i.machine, requiredDate: i.requiredDate?.slice(0, 10) ?? '', reason: i.reason, notes: i.notes ?? '' })));
  const [search, setSearch] = useState('');
  const found = useQuery({ queryKey: ['parts-mini', search], queryFn: () => api.get(`/parts?q=${encodeURIComponent(search)}&pageSize=8`), enabled: search.length > 1 });
  const save = useMutation({
    mutationFn: () => api.patch(`/prs/${pr.id}`, { ...h, requiredDate: h.requiredDate || null, lines: lines.map((l: any) => ({ partId: l.partId, quantity: l.quantity, estUnitPrice: l.estUnitPrice === '' ? null : Number(l.estUnitPrice), supplierId: l.supplierId ? Number(l.supplierId) : null, equipmentId: l.equipmentId, machine: l.machine, requiredDate: l.requiredDate || null, reason: l.reason, notes: l.notes || null })) }),
    onSuccess: () => { toast.success('PR updated'); onDone(); },
    onError: (e) => toast.error(e),
  });
  const upd = (i: number, k: string, v: unknown) => setLines(lines.map((l: any, n: number) => (n === i ? { ...l, [k]: v } : l)));
  return (
    <Card title="Edit PR" actions={<><Button onClick={onDone}>Cancel</Button><Button variant="primary" loading={save.isPending} disabled={!lines.length || lines.some((l: any) => !(l.quantity > 0))} onClick={() => save.mutate()}>Save changes</Button></>}>
      <div className="mb-4 grid gap-3 sm:grid-cols-3">
        <Field label="Department"><Input value={h.department} onChange={(e) => setH({ ...h, department: e.target.value })} /></Field>
        <Field label="Project"><Input value={h.project} onChange={(e) => setH({ ...h, project: e.target.value })} /></Field>
        <Field label="Required date"><Input type="date" value={h.requiredDate} onChange={(e) => setH({ ...h, requiredDate: e.target.value })} /></Field>
        <Field label="Priority"><Select value={h.priority} onChange={(e) => setH({ ...h, priority: e.target.value })}>{['LOW', 'NORMAL', 'HIGH', 'URGENT'].map((p) => <option key={p}>{p}</option>)}</Select></Field>
        <Field label="Reason" className="sm:col-span-2"><Input value={h.reason} onChange={(e) => setH({ ...h, reason: e.target.value })} /></Field>
        <Field label="Notes" className="sm:col-span-3"><Textarea rows={2} value={h.notes} onChange={(e) => setH({ ...h, notes: e.target.value })} /></Field>
      </div>
      <Table>
        <thead><tr><Th>Part</Th><Th>Qty</Th><Th>Est. price</Th><Th>Supplier</Th><Th>Notes</Th><Th /></tr></thead>
        <tbody>{lines.map((l: any, i: number) => (
          <tr key={l.partId}>
            <Td><span className="font-mono font-semibold">{l.partNumber}</span> <span className="text-slate-600">{l.name}</span></Td>
            <Td><Input type="number" min={0} step="any" value={l.quantity} onChange={(e) => upd(i, 'quantity', Number(e.target.value))} className="w-24" /></Td>
            <Td><Input type="number" min={0} step="0.01" value={l.estUnitPrice} onChange={(e) => upd(i, 'estUnitPrice', e.target.value)} className="w-28" /></Td>
            <Td><Select value={l.supplierId} onChange={(e) => upd(i, 'supplierId', e.target.value)} className="w-48"><option value="">—</option>{lookups.data?.suppliers?.map((s: any) => <option key={s.id} value={s.id}>{s.name}</option>)}</Select></Td>
            <Td><Input value={l.notes} onChange={(e) => upd(i, 'notes', e.target.value)} /></Td>
            <Td><Button variant="ghost" aria-label="Remove line" onClick={() => setLines(lines.filter((_: any, n: number) => n !== i))}><Trash2 className="h-4 w-4 text-red-600" /></Button></Td>
          </tr>
        ))}</tbody>
      </Table>
      <div className="relative mt-3 max-w-md">
        <Input placeholder="Add a part: type number or name…" value={search} onChange={(e) => setSearch(e.target.value)} />
        {search.length > 1 && found.data?.items?.length > 0 && (
          <div className="absolute z-20 mt-1 w-full rounded-md border bg-white shadow-lg">
            {found.data.items.map((p: any) => (
              <button key={p.id} className="block w-full px-3 py-1.5 text-left text-sm hover:bg-slate-50" onClick={() => { if (!lines.some((l: any) => l.partId === p.id)) setLines([...lines, { partId: p.id, partNumber: p.partNumber, name: p.name, quantity: 1, estUnitPrice: p.price ?? '', supplierId: p.supplierId ?? '', notes: '' }]); setSearch(''); }}>
                <span className="font-mono font-semibold">{p.partNumber}</span> {p.name}
              </button>
            ))}
          </div>
        )}
      </div>
    </Card>
  );
}
