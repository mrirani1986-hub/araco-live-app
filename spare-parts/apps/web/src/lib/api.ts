export class ApiError extends Error {
  constructor(public status: number, message: string, public details?: unknown) {
    super(message);
  }
}

const HEADERS = { 'x-requested-with': 'araco-sp' };

async function handle<T>(res: Response): Promise<T> {
  if (res.status === 204) return undefined as T;
  const text = await res.text();
  const data = text ? (() => { try { return JSON.parse(text); } catch { return text; } })() : undefined;
  if (!res.ok) {
    let msg = (data && typeof data === 'object' && 'error' in data ? String(data.error) : res.statusText) || 'Request failed';
    const details = data && typeof data === 'object' && 'details' in data ? data.details : undefined;
    if (Array.isArray(details) && details.length) msg += ': ' + details.map((d: { path?: string; message?: string }) => (d.path ? `${d.path} ${d.message}` : d.message)).join('; ');
    if (res.status === 401 && !location.pathname.startsWith('/login')) window.dispatchEvent(new Event('araco:unauthorized'));
    throw new ApiError(res.status, msg, details);
  }
  return data as T;
}

export const api = {
  get: <T = any>(url: string) => fetch(`/api${url}`, { headers: HEADERS, credentials: 'same-origin' }).then((r) => handle<T>(r)),
  post: <T = any>(url: string, body?: unknown) => send<T>('POST', url, body),
  put: <T = any>(url: string, body?: unknown) => send<T>('PUT', url, body),
  patch: <T = any>(url: string, body?: unknown) => send<T>('PATCH', url, body),
  del: <T = any>(url: string) => send<T>('DELETE', url),
  upload: <T = any>(url: string, form: FormData) =>
    fetch(`/api${url}`, { method: 'POST', headers: HEADERS, body: form, credentials: 'same-origin' }).then((r) => handle<T>(r)),
};

function send<T>(method: string, url: string, body?: unknown) {
  return fetch(`/api${url}`, {
    method,
    headers: { ...HEADERS, 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
    credentials: 'same-origin',
  }).then((r) => handle<T>(r));
}

export const fileUrl = (key?: string | null) => (key ? `/api/files/${key}` : null);

/** Opens a server-generated document (PDF) in a new tab for viewing / printing. */
export function openDoc(url: string) {
  window.open(`/api${url}`, '_blank', 'noopener');
}

/** Downloads an export (xlsx / csv / pdf) through the authenticated session. */
export async function download(url: string) {
  const res = await fetch(`/api${url}`, { headers: HEADERS, credentials: 'same-origin' });
  if (!res.ok) await handle(res);
  const blob = await res.blob();
  const cd = res.headers.get('content-disposition') ?? '';
  const name = /filename="([^"]+)"/.exec(cd)?.[1] ?? 'export';
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}

export const qs = (o: Record<string, unknown>) => {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(o)) if (v !== undefined && v !== null && v !== '') p.set(k, String(v));
  const s = p.toString();
  return s ? `?${s}` : '';
};
