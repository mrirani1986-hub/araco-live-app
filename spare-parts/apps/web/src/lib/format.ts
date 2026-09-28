export const money = (v: unknown, cur?: string | null) =>
  v == null || v === '' ? '—' : `${Number(v).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}${cur ? ' ' + cur : ''}`;
export const qty = (v: unknown) => (v == null || v === '' ? '—' : Number(v).toLocaleString('en-US', { maximumFractionDigits: 3 }));
export const date = (v: unknown) => (v ? new Date(v as string).toISOString().slice(0, 10) : '—');
export const dateTime = (v: unknown) => (v ? new Date(v as string).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' }) : '—');
export const today = () => new Date().toISOString().slice(0, 10);
export const label = (s: string | null | undefined) => (s ? s.replace(/_/g, ' ').toLowerCase().replace(/^\w/, (c) => c.toUpperCase()) : '');
