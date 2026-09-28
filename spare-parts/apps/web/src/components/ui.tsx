import { useEffect, useRef, useState, type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes } from 'react';
import { AlertTriangle, ChevronLeft, ChevronRight, Download, ImageOff, Inbox, Loader2, X } from 'lucide-react';
import { download } from '../lib/api';
import { useToast } from '../lib/toast';
import { label } from '../lib/format';

export const cx = (...c: (string | false | null | undefined)[]) => c.filter(Boolean).join(' ');

type Variant = 'primary' | 'secondary' | 'danger' | 'ghost' | 'success';
export function Button({ variant = 'secondary', loading, className, children, icon, ...p }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; loading?: boolean; icon?: ReactNode }) {
  const v = {
    primary: 'bg-brand-700 text-white hover:bg-brand-800 border-brand-700',
    secondary: 'bg-white text-slate-700 hover:bg-slate-50 border-slate-300',
    danger: 'bg-red-600 text-white hover:bg-red-700 border-red-600',
    success: 'bg-emerald-600 text-white hover:bg-emerald-700 border-emerald-600',
    ghost: 'bg-transparent text-slate-600 hover:bg-slate-100 border-transparent',
  }[variant];
  return (
    <button {...p} disabled={p.disabled || loading} className={cx('inline-flex items-center justify-center gap-1.5 rounded-md border px-3 py-1.5 text-sm font-medium shadow-sm transition disabled:cursor-not-allowed disabled:opacity-50', v, className)}>
      {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : icon}
      {children}
    </button>
  );
}

export const inputCls = 'w-full rounded-md border border-slate-300 bg-white px-2.5 py-1.5 text-sm shadow-sm placeholder:text-slate-400 focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-100 disabled:bg-slate-100';
// An explicit width in className (w-24, w-auto, max-w-…) replaces the default full width.
const withWidth = (extra?: string) => cx(/(^|\s)(w-|min-w-)/.test(extra ?? '') ? inputCls.replace('w-full ', '') : inputCls, extra);
export const Input = (p: InputHTMLAttributes<HTMLInputElement>) => <input {...p} className={withWidth(p.className)} />;
export const Textarea = (p: TextareaHTMLAttributes<HTMLTextAreaElement>) => <textarea rows={3} {...p} className={withWidth(p.className)} />;
export const Select = ({ children, ...p }: SelectHTMLAttributes<HTMLSelectElement>) => <select {...p} className={withWidth(cx('pr-8', p.className))}>{children}</select>;

export function Field({ label: l, children, hint, required, className }: { label: string; children: ReactNode; hint?: string; required?: boolean; className?: string }) {
  return (
    <label className={cx('block', className)}>
      <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-500">{l}{required && <span className="text-red-500"> *</span>}</span>
      {children}
      {hint && <span className="mt-1 block text-xs text-slate-500">{hint}</span>}
    </label>
  );
}

export function Card({ title, actions, children, className, bodyClass }: { title?: ReactNode; actions?: ReactNode; children: ReactNode; className?: string; bodyClass?: string }) {
  return (
    <section className={cx('rounded-lg border border-slate-200 bg-white shadow-sm', className)}>
      {(title || actions) && (
        <header className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 px-4 py-2.5">
          <h2 className="text-sm font-semibold text-slate-800">{title}</h2>
          <div className="flex flex-wrap items-center gap-2">{actions}</div>
        </header>
      )}
      <div className={cx('p-4', bodyClass)}>{children}</div>
    </section>
  );
}

export function PageHeader({ title, subtitle, actions, back }: { title: ReactNode; subtitle?: ReactNode; actions?: ReactNode; back?: ReactNode }) {
  return (
    <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
      <div className="min-w-0">
        {back}
        <h1 className="truncate text-xl font-bold text-slate-900">{title}</h1>
        {subtitle && <div className="mt-0.5 text-sm text-slate-500">{subtitle}</div>}
      </div>
      <div className="flex flex-wrap items-center gap-2">{actions}</div>
    </div>
  );
}

const STATUS_TONE: Record<string, string> = {
  DRAFT: 'bg-slate-100 text-slate-700 ring-slate-300', SUBMITTED: 'bg-sky-50 text-sky-800 ring-sky-300',
  PENDING_APPROVAL: 'bg-amber-50 text-amber-800 ring-amber-300', APPROVED: 'bg-emerald-50 text-emerald-800 ring-emerald-300',
  REJECTED: 'bg-red-50 text-red-800 ring-red-300', CANCELLED: 'bg-slate-100 text-slate-500 ring-slate-300 line-through',
  CONVERTED_TO_PO: 'bg-violet-50 text-violet-800 ring-violet-300', SENT: 'bg-sky-50 text-sky-800 ring-sky-300',
  PARTIALLY_RECEIVED: 'bg-amber-50 text-amber-800 ring-amber-300', RECEIVED: 'bg-emerald-50 text-emerald-800 ring-emerald-300',
  CLOSED: 'bg-slate-100 text-slate-700 ring-slate-300', OVERDUE: 'bg-red-50 text-red-800 ring-red-300',
  OUT_OF_STOCK: 'bg-red-50 text-red-800 ring-red-300', LOW_STOCK: 'bg-amber-50 text-amber-800 ring-amber-300',
  REORDER: 'bg-orange-50 text-orange-800 ring-orange-300', OK: 'bg-emerald-50 text-emerald-800 ring-emerald-300',
  NOT_STOCKED: 'bg-slate-50 text-slate-500 ring-slate-200', ACTIVE: 'bg-emerald-50 text-emerald-800 ring-emerald-300',
  INACTIVE: 'bg-slate-100 text-slate-500 ring-slate-300', RECEIPT: 'bg-emerald-50 text-emerald-800 ring-emerald-300',
  ISSUE: 'bg-orange-50 text-orange-800 ring-orange-300', RETURN: 'bg-sky-50 text-sky-800 ring-sky-300',
  ADJUSTMENT: 'bg-violet-50 text-violet-800 ring-violet-300', TRANSFER_IN: 'bg-slate-100 text-slate-700 ring-slate-300', TRANSFER_OUT: 'bg-slate-100 text-slate-700 ring-slate-300',
  NEW: 'bg-emerald-50 text-emerald-800 ring-emerald-300', EXISTING: 'bg-sky-50 text-sky-800 ring-sky-300', ERROR: 'bg-red-50 text-red-800 ring-red-300',
  DUPLICATE_IN_FILE: 'bg-amber-50 text-amber-800 ring-amber-300', PREVIEW: 'bg-amber-50 text-amber-800 ring-amber-300', COMMITTED: 'bg-emerald-50 text-emerald-800 ring-emerald-300', DISCARDED: 'bg-slate-100 text-slate-500 ring-slate-300',
};
const STATUS_TEXT: Record<string, string> = { NOT_STOCKED: 'Not stocked', OK: 'In stock', CONVERTED_TO_PO: 'Converted to PO', PENDING_APPROVAL: 'Pending approval' };

export function StatusBadge({ status, className }: { status: string; className?: string }) {
  return <span className={cx('inline-flex whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-semibold ring-1 ring-inset', STATUS_TONE[status] ?? 'bg-slate-100 text-slate-700 ring-slate-300', className)}>{STATUS_TEXT[status] ?? label(status)}</span>;
}

export function Badge({ children, tone = 'slate' }: { children: ReactNode; tone?: 'slate' | 'amber' | 'brand' | 'red' | 'green' }) {
  const t = { slate: 'bg-slate-100 text-slate-700', amber: 'bg-amber-100 text-amber-900', brand: 'bg-brand-100 text-brand-800', red: 'bg-red-100 text-red-800', green: 'bg-emerald-100 text-emerald-800' }[tone];
  return <span className={cx('inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-xs font-medium', t)}>{children}</span>;
}

export const Spinner = ({ label: l = 'Loading…' }: { label?: string }) => (
  <div className="flex items-center justify-center gap-2 py-12 text-sm text-slate-500"><Loader2 className="h-5 w-5 animate-spin" />{l}</div>
);

export function Empty({ title = 'Nothing here yet', children, icon }: { title?: string; children?: ReactNode; icon?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 py-12 text-center text-slate-500">
      {icon ?? <Inbox className="h-9 w-9 text-slate-300" />}
      <div className="font-medium text-slate-700">{title}</div>
      {children && <div className="max-w-md text-sm">{children}</div>}
    </div>
  );
}

export function ErrorState({ error, retry }: { error: unknown; retry?: () => void }) {
  return (
    <div className="flex flex-col items-center gap-2 rounded-lg border border-red-200 bg-red-50 px-4 py-8 text-center text-sm text-red-800">
      <AlertTriangle className="h-7 w-7" />
      <div className="font-semibold">Something went wrong</div>
      <div>{error instanceof Error ? error.message : String(error)}</div>
      {retry && <Button onClick={retry}>Try again</Button>}
    </div>
  );
}

export function Modal({ open, onClose, title, children, footer, size = 'md' }: { open: boolean; onClose: () => void; title: ReactNode; children: ReactNode; footer?: ReactNode; size?: 'sm' | 'md' | 'lg' | 'xl' }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const h = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', h);
    ref.current?.querySelector<HTMLElement>('input,select,textarea,button')?.focus();
    return () => window.removeEventListener('keydown', h);
  }, [open, onClose]);
  if (!open) return null;
  const w = { sm: 'max-w-md', md: 'max-w-xl', lg: 'max-w-3xl', xl: 'max-w-6xl' }[size];
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-slate-900/40 p-3 pt-10 sm:p-6 sm:pt-16" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div ref={ref} role="dialog" aria-modal="true" className={cx('w-full rounded-xl bg-white shadow-2xl', w)}>
        <div className="flex items-center justify-between border-b px-5 py-3">
          <h3 className="text-base font-semibold text-slate-900">{title}</h3>
          <button onClick={onClose} aria-label="Close" className="rounded p-1 text-slate-500 hover:bg-slate-100"><X className="h-5 w-5" /></button>
        </div>
        <div className="max-h-[75vh] overflow-y-auto px-5 py-4">{children}</div>
        {footer && <div className="flex flex-wrap justify-end gap-2 border-t bg-slate-50 px-5 py-3">{footer}</div>}
      </div>
    </div>
  );
}

/** Confirmation dialog; optional comment (required when commentRequired). */
export function ConfirmDialog({ open, onClose, onConfirm, title, message, confirmText = 'Confirm', variant = 'primary', withComment, commentRequired, commentLabel = 'Comment' }: {
  open: boolean; onClose: () => void; onConfirm: (comment: string) => Promise<unknown> | void; title: string; message: ReactNode; confirmText?: string; variant?: Variant; withComment?: boolean; commentRequired?: boolean; commentLabel?: string;
}) {
  const [comment, setComment] = useState('');
  const [busy, setBusy] = useState(false);
  const toast = useToast();
  useEffect(() => { if (open) setComment(''); }, [open]);
  return (
    <Modal open={open} onClose={onClose} title={title} size="sm" footer={<>
      <Button onClick={onClose} disabled={busy}>Cancel</Button>
      <Button variant={variant} loading={busy} disabled={commentRequired && !comment.trim()} onClick={async () => {
        setBusy(true);
        try { await onConfirm(comment.trim()); onClose(); } catch (e) { toast.error(e); } finally { setBusy(false); }
      }}>{confirmText}</Button>
    </>}>
      <div className="space-y-3 text-sm text-slate-700">
        <div>{message}</div>
        {withComment && <Field label={commentLabel} required={commentRequired}><Textarea value={comment} onChange={(e) => setComment(e.target.value)} /></Field>}
      </div>
    </Modal>
  );
}

export function Pagination({ page, pageSize, total, onPage }: { page: number; pageSize: number; total: number; onPage: (p: number) => void }) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  if (total <= pageSize) return <div className="px-1 py-2 text-xs text-slate-500">{total} record{total === 1 ? '' : 's'}</div>;
  return (
    <div className="flex items-center justify-between gap-2 px-1 py-2 text-sm text-slate-600">
      <span className="text-xs">{(page - 1) * pageSize + 1}–{Math.min(total, page * pageSize)} of {total}</span>
      <div className="flex items-center gap-1">
        <Button variant="ghost" disabled={page <= 1} onClick={() => onPage(page - 1)} aria-label="Previous page"><ChevronLeft className="h-4 w-4" /></Button>
        <span className="text-xs">Page {page} / {pages}</span>
        <Button variant="ghost" disabled={page >= pages} onClick={() => onPage(page + 1)} aria-label="Next page"><ChevronRight className="h-4 w-4" /></Button>
      </div>
    </div>
  );
}

export function Table({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cx('overflow-x-auto', className)}><table className="w-full min-w-max text-left text-sm">{children}</table></div>;
}
export const Th = ({ children, className, ...p }: React.ThHTMLAttributes<HTMLTableCellElement>) => <th {...p} className={cx('whitespace-nowrap border-b border-slate-200 bg-slate-50 px-3 py-2 text-xs font-semibold uppercase tracking-wide text-slate-500', className)}>{children}</th>;
export const Td = ({ children, className, ...p }: React.TdHTMLAttributes<HTMLTableCellElement>) => <td {...p} className={cx('border-b border-slate-100 px-3 py-2 align-middle', className)}>{children}</td>;

export function ExportMenu({ url, formats = ['xlsx', 'csv', 'pdf'] }: { url: string; formats?: string[] }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const toast = useToast();
  const join = url.includes('?') ? '&' : '?';
  return (
    <div className="relative">
      <Button icon={<Download className="h-4 w-4" />} loading={busy} onClick={() => setOpen((o) => !o)}>Export</Button>
      {open && (
        <div className="absolute right-0 z-30 mt-1 w-40 rounded-md border bg-white py-1 shadow-lg" onMouseLeave={() => setOpen(false)}>
          {formats.map((f) => (
            <button key={f} className="block w-full px-3 py-1.5 text-left text-sm hover:bg-slate-50" onClick={async () => {
              setOpen(false); setBusy(true);
              try { await download(`${url}${join}format=${f}`); } catch (e) { toast.error(e); } finally { setBusy(false); }
            }}>{{ xlsx: 'Excel (.xlsx)', csv: 'CSV', pdf: 'PDF' }[f] ?? f}</button>
          ))}
        </div>
      )}
    </div>
  );
}

export function Thumb({ src, alt, drawing, className }: { src: string | null; alt: string; drawing?: boolean; className?: string }) {
  const [err, setErr] = useState(false);
  if (!src || err) return <div className={cx('flex items-center justify-center bg-slate-100 text-slate-400', className)}><ImageOff className="h-6 w-6" /></div>;
  return <img src={src} alt={alt} loading="lazy" onError={() => setErr(true)} className={cx('bg-white object-contain', drawing && 'p-1', className)} />;
}

export function Tabs<T extends string>({ tabs, value, onChange }: { tabs: { key: T; label: ReactNode }[]; value: T; onChange: (t: T) => void }) {
  return (
    <div className="mb-4 flex gap-1 overflow-x-auto border-b border-slate-200" role="tablist">
      {tabs.map((t) => (
        <button key={t.key} role="tab" aria-selected={value === t.key} onClick={() => onChange(t.key)}
          className={cx('-mb-px whitespace-nowrap border-b-2 px-3 py-2 text-sm font-medium', value === t.key ? 'border-brand-700 text-brand-800' : 'border-transparent text-slate-500 hover:text-slate-800')}>
          {t.label}
        </button>
      ))}
    </div>
  );
}

export function KV({ items, cols = 2 }: { items: [ReactNode, ReactNode][]; cols?: 1 | 2 | 3 }) {
  return (
    <dl className={cx('grid gap-x-6 gap-y-2 text-sm', cols === 1 ? 'grid-cols-1' : cols === 2 ? 'sm:grid-cols-2' : 'sm:grid-cols-3')}>
      {items.map(([k, v], i) => (
        <div key={i} className="flex gap-2 border-b border-dashed border-slate-100 pb-1.5">
          <dt className="w-36 shrink-0 text-slate-500">{k}</dt>
          <dd className="min-w-0 flex-1 break-words font-medium text-slate-800">{v === null || v === undefined || v === '' ? <span className="font-normal text-slate-400">—</span> : v}</dd>
        </div>
      ))}
    </dl>
  );
}
