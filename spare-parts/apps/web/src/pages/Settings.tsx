import { useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Database, Download, FileSpreadsheet, ImagePlus, Plus, RotateCcw, Trash2, Upload } from 'lucide-react';
import { api, download, fileUrl } from '../lib/api';
import { useAuth } from '../lib/auth';
import { useToast } from '../lib/toast';
import { date, dateTime } from '../lib/format';
import { Button, Card, ConfirmDialog, Empty, Field, Input, Modal, PageHeader, Select, Spinner, StatusBadge, Table, Tabs, Td, Textarea, Th, cx } from '../components/ui';

type Tab = 'company' | 'workflow' | 'numbering' | 'import' | 'backup';

export default function Settings() {
  const [sp, setSp] = useSearchParams();
  const { can } = useAuth();
  const tabs = [
    ...(can('settings.manage') ? [{ key: 'company' as const, label: 'Company & documents' }, { key: 'workflow' as const, label: 'Approval workflow' }, { key: 'numbering' as const, label: 'Numbering' }] : []),
    ...(can('import.run') ? [{ key: 'import' as const, label: 'Import from Excel' }] : []),
    ...(can('backup.run') ? [{ key: 'backup' as const, label: 'Backup & restore' }] : []),
  ];
  const tab = (sp.get('tab') as Tab) ?? tabs[0]?.key;
  return (
    <div>
      <PageHeader title="Settings" />
      <Tabs value={tab} onChange={(t) => setSp({ tab: t })} tabs={tabs} />
      {tab === 'company' && <CompanyTab />}
      {tab === 'workflow' && <WorkflowTab />}
      {tab === 'numbering' && <NumberingTab />}
      {tab === 'import' && <ImportTab />}
      {tab === 'backup' && <BackupTab />}
    </div>
  );
}

function CompanyTab() {
  const toast = useToast();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['settings'], queryFn: () => api.get('/settings') });
  const [f, setF] = useState<any>(null);
  const logoRef = useRef<HTMLInputElement>(null);
  useEffect(() => { if (q.data) setF(q.data); }, [q.data]);
  const save = useMutation({
    mutationFn: () => api.put('/settings', { company: { name: f.company.name, address: f.company.address, phone: f.company.phone, email: f.company.email, taxNumber: f.company.taxNumber }, currency: f.currency, taxRate: Number(f.taxRate), poTerms: f.poTerms, defaultPaymentTerms: f.defaultPaymentTerms, defaultDeliveryTerms: f.defaultDeliveryTerms, overReceiptTolerancePct: Number(f.overReceiptTolerancePct) }),
    onSuccess: (d) => { qc.setQueryData(['settings'], d); toast.success('Settings saved'); },
    onError: (e) => toast.error(e),
  });
  if (!f) return <Spinner />;
  const c = f.company;
  const setC = (k: string) => (e: any) => setF({ ...f, company: { ...c, [k]: e.target.value } });
  return (
    <div className="grid gap-4 xl:grid-cols-2">
      <Card title="Company (printed on PR / PO / GRN)" actions={<Button variant="primary" loading={save.isPending} onClick={() => save.mutate()}>Save</Button>}>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Company name" required className="sm:col-span-2"><Input value={c.name} onChange={setC('name')} /></Field>
          <Field label="Address" className="sm:col-span-2"><Textarea rows={2} value={c.address} onChange={setC('address')} /></Field>
          <Field label="Phone"><Input value={c.phone} onChange={setC('phone')} /></Field>
          <Field label="Email"><Input value={c.email} onChange={setC('email')} /></Field>
          <Field label="VAT / tax number"><Input value={c.taxNumber} onChange={setC('taxNumber')} /></Field>
          <Field label="Logo">
            <div className="flex items-center gap-3">
              {c.logoKey ? <img src={fileUrl(c.logoKey)!} alt="Logo" className="h-12 max-w-[120px] object-contain" /> : <span className="text-xs text-slate-400">No logo</span>}
              <Button icon={<ImagePlus className="h-4 w-4" />} onClick={() => logoRef.current?.click()}>Upload</Button>
              <input ref={logoRef} type="file" accept="image/png,image/jpeg,image/webp" hidden onChange={async (e) => {
                const file = e.target.files?.[0]; e.target.value = '';
                if (!file) return;
                const fd = new FormData(); fd.append('file', file);
                try { const d = await api.upload('/settings/logo', fd); qc.setQueryData(['settings'], d); setF(d); toast.success('Logo updated'); } catch (err) { toast.error(err); }
              }} />
            </div>
          </Field>
        </div>
      </Card>
      <Card title="Purchasing defaults">
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Currency"><Input maxLength={3} value={f.currency} onChange={(e) => setF({ ...f, currency: e.target.value.toUpperCase() })} /></Field>
          <Field label="Tax / VAT rate (%)"><Input type="number" min={0} max={100} value={f.taxRate} onChange={(e) => setF({ ...f, taxRate: e.target.value })} /></Field>
          <Field label="Default payment terms"><Input value={f.defaultPaymentTerms} onChange={(e) => setF({ ...f, defaultPaymentTerms: e.target.value })} /></Field>
          <Field label="Default delivery terms"><Input value={f.defaultDeliveryTerms} onChange={(e) => setF({ ...f, defaultDeliveryTerms: e.target.value })} /></Field>
          <Field label="Over-receipt tolerance (%)" hint="0 = never receive more than ordered"><Input type="number" min={0} max={50} value={f.overReceiptTolerancePct} onChange={(e) => setF({ ...f, overReceiptTolerancePct: e.target.value })} /></Field>
          <Field label="PO terms & conditions" className="sm:col-span-2"><Textarea rows={6} value={f.poTerms} onChange={(e) => setF({ ...f, poTerms: e.target.value })} /></Field>
        </div>
      </Card>
      <OtherCompanies />
    </div>
  );
}

const EMPTY_COMPANY = { name: '', address: '', phone: '', email: '', taxNumber: '' };

/** Other companies that PRs and POs can be raised for; each prints its own letterhead. */
function OtherCompanies() {
  const toast = useToast();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['companies'], queryFn: () => api.get('/settings/companies') });
  const [edit, setEdit] = useState<any>(null); // { id?: number, ...fields }
  const logoRef = useRef<HTMLInputElement>(null);
  const [logoFor, setLogoFor] = useState<number | null>(null);
  const refresh = () => { qc.invalidateQueries({ queryKey: ['companies'] }); qc.invalidateQueries({ queryKey: ['lookups'] }); };
  const save = useMutation({
    mutationFn: () => { const body = { name: edit.name, address: edit.address, phone: edit.phone, email: edit.email, taxNumber: edit.taxNumber }; return edit.id ? api.put(`/settings/companies/${edit.id}`, body) : api.post('/settings/companies', body); },
    onSuccess: (c: any) => { toast.success(`${c.name} saved`); setEdit(null); refresh(); },
    onError: (e) => toast.error(e),
  });
  const others = (q.data ?? []).filter((c: any) => !c.isMain);
  return (
    <Card title="Other companies" className="xl:col-span-2" actions={<Button icon={<Plus className="h-4 w-4" />} onClick={() => setEdit({ ...EMPTY_COMPANY })}>Add company</Button>}>
      <p className="mb-3 text-sm text-slate-600">Purchase requisitions and purchase orders can be raised for any of these companies; the PR, PO and GRN print that company's name, address and logo. Parts, stock, suppliers and numbering are shared.</p>
      {q.isLoading ? <Spinner /> : !others.length ? <Empty title="No other companies" /> : (
        <Table>
          <thead><tr><Th>Logo</Th><Th>Company</Th><Th>Address</Th><Th>Phone / email</Th><Th>VAT / tax no.</Th><Th /></tr></thead>
          <tbody>{others.map((c: any) => (
            <tr key={c.id}>
              <Td>{c.logoKey ? <img src={fileUrl(c.logoKey)!} alt="Logo" className="h-10 max-w-[100px] object-contain" /> : <span className="text-xs text-slate-400">No logo</span>}</Td>
              <Td className="font-semibold">{c.name}<div className="font-mono text-xs font-normal text-slate-500">{c.code}</div></Td>
              <Td className="whitespace-pre-line text-sm">{c.address || '—'}</Td>
              <Td className="text-sm">{[c.phone, c.email].filter(Boolean).join(' · ') || '—'}</Td>
              <Td className="text-sm">{c.taxNumber || '—'}</Td>
              <Td className="whitespace-nowrap text-right">
                <Button icon={<ImagePlus className="h-4 w-4" />} onClick={() => { setLogoFor(c.id); logoRef.current?.click(); }}>Logo</Button>{' '}
                <Button onClick={() => setEdit({ ...c })}>Edit</Button>
              </Td>
            </tr>
          ))}</tbody>
        </Table>
      )}
      <input ref={logoRef} type="file" accept="image/png,image/jpeg,image/webp" hidden onChange={async (e) => {
        const file = e.target.files?.[0]; e.target.value = '';
        if (!file || !logoFor) return;
        const fd = new FormData(); fd.append('file', file);
        try { await api.upload(`/settings/companies/${logoFor}/logo`, fd); refresh(); toast.success('Logo updated'); } catch (err) { toast.error(err); }
      }} />
      <Modal open={!!edit} onClose={() => setEdit(null)} title={edit?.id ? `Edit ${edit.name}` : 'Add company'}
        footer={<><Button onClick={() => setEdit(null)}>Cancel</Button><Button variant="primary" loading={save.isPending} disabled={!edit?.name?.trim()} onClick={() => save.mutate()}>Save</Button></>}>
        {edit && (
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Company name" required className="sm:col-span-2"><Input value={edit.name} onChange={(e) => setEdit({ ...edit, name: e.target.value })} /></Field>
            <Field label="Address" className="sm:col-span-2"><Textarea rows={2} value={edit.address} onChange={(e) => setEdit({ ...edit, address: e.target.value })} /></Field>
            <Field label="Phone"><Input value={edit.phone} onChange={(e) => setEdit({ ...edit, phone: e.target.value })} /></Field>
            <Field label="Email"><Input value={edit.email} onChange={(e) => setEdit({ ...edit, email: e.target.value })} /></Field>
            <Field label="VAT / tax number"><Input value={edit.taxNumber} onChange={(e) => setEdit({ ...edit, taxNumber: e.target.value })} /></Field>
          </div>
        )}
      </Modal>
    </Card>
  );
}

function WorkflowTab() {
  const toast = useToast();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['approval-steps'], queryFn: () => api.get('/settings/approval-steps') });
  const [steps, setSteps] = useState<any[] | null>(null);
  useEffect(() => { if (q.data) setSteps(q.data.map((s: any) => ({ name: s.name, roleCode: s.roleCode, minTotal: s.minTotal ?? '', active: s.active }))); }, [q.data]);
  const save = useMutation({
    mutationFn: () => api.put('/settings/approval-steps', { steps: steps!.map((s) => ({ ...s, minTotal: s.minTotal === '' ? null : Number(s.minTotal) })) }),
    onSuccess: () => { toast.success('Approval workflow saved'); qc.invalidateQueries({ queryKey: ['approval-steps'] }); },
    onError: (e) => toast.error(e),
  });
  if (!steps) return <Spinner />;
  const upd = (i: number, k: string, v: unknown) => setSteps(steps.map((s, n) => (n === i ? { ...s, [k]: v } : s)));
  return (
    <Card title="PR approval levels" actions={<><Button icon={<Plus className="h-4 w-4" />} onClick={() => setSteps([...steps, { name: 'New step', roleCode: 'APPROVER', minTotal: '', active: true }])}>Add level</Button><Button variant="primary" loading={save.isPending} onClick={() => save.mutate()}>Save workflow</Button></>}>
      <p className="mb-3 text-sm text-slate-600">Requester → level 1 → level 2 → … → Approved. A level with a minimum amount only applies to PRs whose estimated total is at least that amount. Changes are blocked while PRs are waiting for approval.</p>
      <Table>
        <thead><tr><Th>Level</Th><Th>Step name</Th><Th>Approver role</Th><Th>Only above amount</Th><Th>Active</Th><Th /></tr></thead>
        <tbody>{steps.map((s, i) => (
          <tr key={i}><Td className="font-semibold">{i + 1}</Td>
            <Td><Input value={s.name} onChange={(e) => upd(i, 'name', e.target.value)} /></Td>
            <Td><Select value={s.roleCode} onChange={(e) => upd(i, 'roleCode', e.target.value)}>{['STORE_MANAGER', 'PROCUREMENT', 'APPROVER', 'ADMIN'].map((r) => <option key={r}>{r}</option>)}</Select></Td>
            <Td><Input type="number" min={0} value={s.minTotal} placeholder="always" onChange={(e) => upd(i, 'minTotal', e.target.value)} className="w-32" /></Td>
            <Td><input type="checkbox" checked={s.active} onChange={(e) => upd(i, 'active', e.target.checked)} aria-label="Active" /></Td>
            <Td><Button variant="ghost" aria-label="Remove level" onClick={() => setSteps(steps.filter((_, n) => n !== i))}><Trash2 className="h-4 w-4 text-red-600" /></Button></Td></tr>
        ))}</tbody>
      </Table>
    </Card>
  );
}

function NumberingTab() {
  const q = useQuery({ queryKey: ['numbering'], queryFn: () => api.get('/settings/numbering') });
  return (
    <Card title="Document numbering">
      <p className="mb-3 text-sm text-slate-600">Numbers are allocated inside the same database transaction that saves the document, using a row lock, so two users can never receive the same number. Format: <span className="font-mono">PR-YYYY-000001</span>, <span className="font-mono">PO-YYYY-000001</span>, <span className="font-mono">GRN-YYYY-000001</span>; counters restart every year.</p>
      {q.isLoading ? <Spinner /> : !q.data.length ? <Empty title="No documents numbered yet" /> : (
        <Table><thead><tr><Th>Document</Th><Th>Year</Th><Th className="text-right">Last number</Th></tr></thead>
          <tbody>{q.data.map((s: any) => <tr key={s.docType + s.year}><Td className="font-mono">{s.docType}</Td><Td>{s.year}</Td><Td className="text-right font-mono">{s.lastValue}</Td></tr>)}</tbody></Table>
      )}
    </Card>
  );
}

function ImportTab() {
  const toast = useToast();
  const qc = useQueryClient();
  const kinds = useQuery({ queryKey: ['import-kinds'], queryFn: () => api.get('/imports/kinds') });
  const batches = useQuery({ queryKey: ['imports'], queryFn: () => api.get('/imports') });
  const source = useQuery({ queryKey: ['source-status'], queryFn: () => api.get('/imports/source/status') });
  const [kind, setKind] = useState('PARTS');
  const [batchId, setBatchId] = useState<number | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  return (
    <div className="space-y-4">
      <Card title="Original workbook (source data)">
        {source.isLoading ? <Spinner /> : (
          <Table><thead><tr><Th>File</Th><Th>Type</Th><Th>SHA-256</Th><Th className="text-right">Records</Th><Th>Imported</Th></tr></thead>
            <tbody>{source.data?.map((s: any) => <tr key={s.id}><Td>{s.fileName}</Td><Td>{s.kind}</Td><Td className="font-mono text-xs">{s.sha256.slice(0, 16)}…</Td><Td className="text-right">{s._count.records}</Td><Td>{dateTime(s.importedAt)}</Td></tr>)}</tbody></Table>
        )}
        <p className="mt-2 text-xs text-slate-500">The original file is stored read-only in <span className="font-mono">source-data/original/</span> and is never modified. Every imported part keeps a link to its sheet and row.</p>
      </Card>
      <Card title="Import from Excel" actions={<>
        <Select value={kind} onChange={(e) => setKind(e.target.value)} className="w-auto" aria-label="Import type">{kinds.data?.map((k: any) => <option key={k.kind} value={k.kind}>{k.title}</option>)}</Select>
        <Button icon={<Download className="h-4 w-4" />} onClick={() => download(`/imports/templates/${kind}`).catch(toast.error)}>Template</Button>
        <Button variant="primary" icon={<Upload className="h-4 w-4" />} loading={uploading} onClick={() => fileRef.current?.click()}>Upload .xlsx</Button>
        <input ref={fileRef} type="file" accept=".xlsx" hidden onChange={async (e) => {
          const file = e.target.files?.[0]; e.target.value = '';
          if (!file) return;
          const fd = new FormData(); fd.append('file', file); setUploading(true);
          try { const b = await api.upload(`/imports/${kind}`, fd); qc.invalidateQueries({ queryKey: ['imports'] }); setBatchId(b.id); } catch (err) { toast.error(err); } finally { setUploading(false); }
        }} />
      </>}>
        <p className="text-sm text-slate-600">1. Download the template · 2. Fill it in · 3. Upload → the file is validated and shown as a preview (nothing is saved yet) · 4. Correct errors and choose what to do with existing records · 5. Confirm. Existing data is never overwritten unless you choose “Overwrite” for that row.</p>
        <p className="mt-1 text-xs text-slate-500">Columns: {kinds.data?.find((k: any) => k.kind === kind)?.fields.map((f: any) => f.label + (f.required ? '*' : '')).join(', ')}</p>
      </Card>
      <Card title="Import history" bodyClass="p-0">
        {batches.isLoading ? <Spinner /> : !batches.data?.length ? <Empty title="No imports yet" /> : (
          <Table><thead><tr><Th>#</Th><Th>Date</Th><Th>Type</Th><Th>File</Th><Th>Status</Th><Th className="text-right">Rows</Th><Th className="text-right">New</Th><Th className="text-right">Existing</Th><Th className="text-right">Errors</Th><Th /></tr></thead>
            <tbody>{batches.data.map((b: any) => <tr key={b.id}><Td>{b.id}</Td><Td>{date(b.createdAt)}</Td><Td>{b.kind}</Td><Td>{b.fileName}</Td><Td><StatusBadge status={b.status} /></Td><Td className="text-right">{b.summary.total}</Td><Td className="text-right">{b.summary.new}</Td><Td className="text-right">{b.summary.existing}</Td><Td className="text-right">{b.summary.errors + b.summary.duplicates}</Td><Td><Button variant="ghost" onClick={() => setBatchId(b.id)}>{b.status === 'PREVIEW' ? 'Review' : 'View'}</Button></Td></tr>)}</tbody></Table>
        )}
      </Card>
      {batchId && <ImportPreview id={batchId} onClose={() => { setBatchId(null); qc.invalidateQueries({ queryKey: ['imports'] }); }} />}
    </div>
  );
}

function ImportPreview({ id, onClose }: { id: number; onClose: () => void }) {
  const toast = useToast();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['import', id], queryFn: () => api.get(`/imports/${id}`) });
  const kinds = useQuery({ queryKey: ['import-kinds'], queryFn: () => api.get('/imports/kinds') });
  const [filter, setFilter] = useState('');
  const [editRow, setEditRow] = useState<any>(null);
  const [confirm, setConfirm] = useState(false);
  const patch = async (rowNo: number, body: object) => {
    try { const b = await api.patch(`/imports/${id}/rows/${rowNo}`, body); qc.setQueryData(['import', id], b); } catch (e) { toast.error(e); }
  };
  if (q.isLoading || !q.data) return <Modal open onClose={onClose} title="Import"><Spinner /></Modal>;
  const b = q.data;
  const s = b.summary;
  const fields = kinds.data?.find((k: any) => k.kind === b.kind)?.fields ?? [];
  const rows = s.rows.filter((r: any) => !filter || r.status === filter);
  const editable = b.status === 'PREVIEW';
  return (
    <Modal open onClose={onClose} size="xl" title={`Import #${b.id} — ${b.fileName} (${b.kind})`} footer={<>
      {editable && <Button onClick={async () => { await api.post(`/imports/${id}/discard`); toast.info('Import discarded'); onClose(); }}>Discard</Button>}
      <Button onClick={onClose}>Close</Button>
      {editable && <Button variant="primary" icon={<FileSpreadsheet className="h-4 w-4" />} disabled={s.toCreate + s.toFill + s.toOverwrite === 0} onClick={() => setConfirm(true)}>Confirm import</Button>}
    </>}>
      <div className="mb-3 flex flex-wrap gap-2 text-sm">
        {[['', `All ${s.total}`], ['NEW', `New ${s.new}`], ['EXISTING', `Existing ${s.existing}`], ['ERROR', `Errors ${s.errors}`], ['DUPLICATE_IN_FILE', `Duplicates ${s.duplicates}`]].map(([k, l]) => (
          <button key={k} onClick={() => setFilter(k)} className={cx('rounded-full border px-3 py-1 text-xs font-medium', filter === k ? 'border-brand-700 bg-brand-700 text-white' : 'bg-white')}>{l}</button>
        ))}
        <span className="ml-auto text-xs text-slate-500">Will create {s.toCreate} · fill {s.toFill} · overwrite {s.toOverwrite} · skip {s.toSkip}</span>
      </div>
      {s.result && <div className="mb-3 rounded bg-emerald-50 p-2 text-sm text-emerald-900">Imported: {s.result.created} created, {s.result.updated} updated, {s.result.skipped} skipped{s.result.stockDocument ? ` (stock document ${s.result.stockDocument})` : ''}.</div>}
      {s.unknownHeaders?.length > 0 && <div className="mb-3 rounded bg-amber-50 p-2 text-xs text-amber-900">Columns not imported (unknown): {s.unknownHeaders.join(', ')}</div>}
      <Table>
        <thead><tr><Th>Row</Th><Th>Status</Th>{fields.map((f: any) => <Th key={f.key}>{f.label}</Th>)}<Th>Messages</Th><Th>Action</Th>{editable && <Th />}</tr></thead>
        <tbody>{rows.map((r: any) => (
          <tr key={r.rowNo} className="align-top">
            <Td>{r.rowNo}</Td><Td><StatusBadge status={r.status} /></Td>
            {fields.map((f: any) => <Td key={f.key} className="max-w-[160px] truncate">{r.data[f.key] == null ? '' : String(r.data[f.key])}{r.existing && r.existing[f.key] != null && String(r.existing[f.key]) !== String(r.data[f.key] ?? '') && r.data[f.key] != null && <div className="text-[11px] text-slate-400">current: {String(r.existing[f.key])}</div>}</Td>)}
            <Td className="max-w-[240px] text-xs">{r.errors.map((e: string) => <div key={e} className="text-red-700">{e}</div>)}{r.warnings.map((e: string) => <div key={e} className="text-amber-700">{e}</div>)}</Td>
            <Td>{editable && r.status === 'EXISTING' ? (
              <Select value={r.action} onChange={(e) => patch(r.rowNo, { action: e.target.value })} className="w-40" aria-label="Action"><option value="SKIP">Skip</option><option value="FILL_EMPTY">Fill empty fields</option><option value="OVERWRITE">Overwrite</option></Select>
            ) : editable && r.status === 'NEW' ? (
              <Select value={r.action} onChange={(e) => patch(r.rowNo, { action: e.target.value })} className="w-32" aria-label="Action"><option value="CREATE">Create</option><option value="SKIP">Skip</option></Select>
            ) : <span className="text-xs">{r.action}</span>}</Td>
            {editable && <Td><Button variant="ghost" onClick={() => setEditRow(r)}>Correct</Button></Td>}
          </tr>
        ))}</tbody>
      </Table>
      {editRow && (
        <Modal open onClose={() => setEditRow(null)} title={`Correct row ${editRow.rowNo}`} footer={<><Button onClick={() => setEditRow(null)}>Cancel</Button><Button variant="primary" onClick={async () => { await patch(editRow.rowNo, { data: editRow.data }); setEditRow(null); }}>Apply</Button></>}>
          <div className="grid gap-2 sm:grid-cols-2">{fields.map((f: any) => (
            <Field key={f.key} label={f.label} required={f.required}><Input value={editRow.data[f.key] ?? ''} onChange={(e) => setEditRow({ ...editRow, data: { ...editRow.data, [f.key]: e.target.value === '' ? null : f.type === 'number' ? Number(e.target.value) : e.target.value } })} /></Field>
          ))}</div>
        </Modal>
      )}
      <ConfirmDialog open={confirm} onClose={() => setConfirm(false)} title="Confirm import" confirmText="Import now"
        message={`Create ${s.toCreate}, fill empty fields on ${s.toFill}, overwrite ${s.toOverwrite}. ${s.toSkip} row(s) will be skipped. Every change is written to the audit log.`}
        onConfirm={async () => { const r = await api.post(`/imports/${id}/commit`); toast.success(`Imported: ${r.created} created, ${r.updated} updated`); qc.invalidateQueries({ queryKey: ['import', id] }); qc.invalidateQueries({ queryKey: ['parts'] }); qc.invalidateQueries({ queryKey: ['lookups'] }); }} />
    </Modal>
  );
}

function BackupTab() {
  const toast = useToast();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['backups'], queryFn: () => api.get('/backups') });
  const [restore, setRestore] = useState<string | null>(null);
  const [typed, setTyped] = useState('');
  const [busy, setBusy] = useState(false);
  const create = useMutation({ mutationFn: () => api.post('/backups', { label: 'manual' }), onSuccess: (b: any) => { toast.success(`Backup ${b.name} created`); qc.invalidateQueries({ queryKey: ['backups'] }); }, onError: (e) => toast.error(e) });
  return (
    <Card title="Backups" actions={<Button variant="primary" icon={<Database className="h-4 w-4" />} loading={create.isPending} onClick={() => create.mutate()}>Create backup now</Button>} bodyClass="p-0">
      <p className="px-4 pt-3 text-sm text-slate-600">A backup contains the full database (pg_dump) and all stored pictures and imported files. Before any restore, a safety backup of the current state is taken automatically.</p>
      {q.isLoading ? <Spinner /> : !q.data.length ? <Empty title="No backups yet" /> : (
        <Table className="mt-2"><thead><tr><Th>Name</Th><Th>Created</Th><Th className="text-right">Parts</Th><Th className="text-right">POs</Th><Th className="text-right">Size</Th><Th /></tr></thead>
          <tbody>{q.data.map((b: any) => (
            <tr key={b.name}><Td className="font-mono text-xs">{b.name}</Td><Td>{dateTime(b.createdAt)}</Td><Td className="text-right">{b.counts.parts}</Td><Td className="text-right">{b.counts.purchaseOrders}</Td><Td className="text-right">{((b.bytes.database + b.bytes.files) / 1048576).toFixed(1)} MB</Td>
              <Td className="flex gap-1">
                <Button variant="ghost" icon={<Download className="h-4 w-4" />} onClick={() => download(`/backups/${b.name}/database.dump`).catch(toast.error)}>DB</Button>
                <Button variant="ghost" icon={<Download className="h-4 w-4" />} onClick={() => download(`/backups/${b.name}/files.tar.gz`).catch(toast.error)}>Files</Button>
                <Button variant="ghost" icon={<RotateCcw className="h-4 w-4" />} onClick={() => { setRestore(b.name); setTyped(''); }}>Restore</Button>
              </Td></tr>
          ))}</tbody></Table>
      )}
      <Modal open={!!restore} onClose={() => setRestore(null)} title="Restore backup" size="sm" footer={<><Button onClick={() => setRestore(null)}>Cancel</Button><Button variant="danger" loading={busy} disabled={typed !== restore} onClick={async () => {
        setBusy(true);
        try { const r = await api.post(`/backups/${restore}/restore`, { confirm: typed }); toast.success(`Restored. Safety backup: ${r.safetyBackup}`); setRestore(null); qc.invalidateQueries(); } catch (e) { toast.error(e); } finally { setBusy(false); }
      }}>Restore</Button></>}>
        <p className="text-sm text-slate-700">All data will be replaced by the backup <b className="font-mono">{restore}</b>. Everybody should stop working during the restore. Type the backup name to confirm:</p>
        <Input className="mt-3 font-mono" value={typed} onChange={(e) => setTyped(e.target.value)} />
      </Modal>
    </Card>
  );
}

