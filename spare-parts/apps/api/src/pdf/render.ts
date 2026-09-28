import { chromium, type Browser } from 'playwright-core';
import { env } from '../env.js';
import { storage } from '../lib/storage.js';
import { getSettings, type AppSettings } from '../lib/settings.js';

let browserPromise: Promise<Browser> | null = null;

function browser() {
  if (!browserPromise) {
    browserPromise = chromium.launch({
      executablePath: env.chromiumPath || undefined,
      args: ['--no-sandbox', '--disable-dev-shm-usage'],
    }).catch((e) => { browserPromise = null; throw e; });
  }
  return browserPromise;
}

export async function closePdfBrowser() {
  if (browserPromise) { const b = await browserPromise.catch(() => null); browserPromise = null; await b?.close(); }
}

/** Renders a full HTML document to an A4 PDF. */
export async function htmlToPdf(html: string, opts: { landscape?: boolean; footer?: string } = {}) {
  const b = await browser();
  const page = await b.newPage();
  try {
    await page.setContent(html, { waitUntil: 'load' });
    return await page.pdf({
      format: 'A4',
      landscape: opts.landscape,
      printBackground: true,
      margin: { top: '12mm', bottom: '16mm', left: '10mm', right: '10mm' },
      displayHeaderFooter: true,
      headerTemplate: '<span></span>',
      footerTemplate: `<div style="font-size:8px;width:100%;padding:0 10mm;color:#666;display:flex;justify-content:space-between">
        <span>${esc(opts.footer ?? '')}</span><span>Page <span class="pageNumber"></span> / <span class="totalPages"></span></span></div>`,
    });
  } finally {
    await page.close();
  }
}

export const esc = (v: unknown) =>
  String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

export const fmtNum = (n: unknown, dp = 2) =>
  n == null || n === '' ? '' : Number(n).toLocaleString('en-US', { minimumFractionDigits: dp, maximumFractionDigits: dp });
export const fmtQty = (n: unknown) => (n == null ? '' : Number(n).toLocaleString('en-US', { maximumFractionDigits: 3 }));
export const fmtDate = (d: unknown) => (d ? new Date(d as string).toISOString().slice(0, 10) : '');

const imgCache = new Map<string, string>();
/** Embeds a stored image (thumbnail preferred) as a data URI so the PDF is self-contained. */
export async function dataUri(key: string | null | undefined) {
  if (!key) return null;
  if (imgCache.has(key)) return imgCache.get(key)!;
  try {
    const buf = await storage.get(key);
    const mime = key.endsWith('.webp') ? 'image/webp' : key.endsWith('.png') ? 'image/png' : 'image/jpeg';
    const uri = `data:${mime};base64,${buf.toString('base64')}`;
    if (imgCache.size > 500) imgCache.clear();
    imgCache.set(key, uri);
    return uri;
  } catch {
    return null;
  }
}

export const BASE_CSS = `
  * { box-sizing: border-box; }
  html, body { width: 100%; }
  body { font-family: 'Segoe UI', Arial, Helvetica, sans-serif; font-size: 10.5px; color: #1f2937; margin: 0; }
  h1 { font-size: 20px; margin: 0; letter-spacing: .5px; }
  h2 { font-size: 12px; margin: 14px 0 6px; text-transform: uppercase; color: #0f3d68; border-bottom: 1.5px solid #0f3d68; padding-bottom: 2px; }
  .head { display: flex; justify-content: space-between; align-items: flex-start; border-bottom: 3px solid #0f3d68; padding-bottom: 8px; margin-bottom: 10px; }
  .company { display: flex; gap: 10px; align-items: center; }
  .company img { max-height: 56px; max-width: 150px; }
  .company .name { font-size: 15px; font-weight: 700; color: #0f3d68; }
  .company .meta { color: #4b5563; font-size: 9.5px; line-height: 1.35; white-space: pre-line; }
  .doc { text-align: right; }
  .doc h1 { color: #0f3d68; }
  .doc .no { font-size: 13px; font-weight: 700; margin-top: 3px; }
  .grid { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); gap: 10px; }
  .grid > * { min-width: 0; }
  .box { border: 1px solid #d1d5db; border-radius: 4px; padding: 7px 9px; }
  .box .t { font-weight: 700; color: #0f3d68; font-size: 9.5px; text-transform: uppercase; margin-bottom: 4px; }
  .kv { display: grid; grid-template-columns: 110px minmax(0, 1fr); gap: 2px 8px; }
  .kv > div { overflow-wrap: anywhere; }
  .kv .k { color: #6b7280; }
  table { width: 100%; border-collapse: collapse; margin-top: 4px; }
  th { background: #0f3d68; color: #fff; font-weight: 600; font-size: 9.5px; text-align: left; padding: 5px 4px; }
  td { border-bottom: 1px solid #e5e7eb; padding: 4px; vertical-align: middle; overflow-wrap: anywhere; }
  tr { page-break-inside: avoid; }
  tbody tr:nth-child(even) td { background: #f8fafc; }
  .r { text-align: right; } .c { text-align: center; }
  .pic { width: 54px; height: 44px; object-fit: contain; border: 1px solid #e5e7eb; background: #fff; }
  .nopic { width: 54px; height: 44px; border: 1px dashed #d1d5db; color: #9ca3af; font-size: 8px; display:flex; align-items:center; justify-content:center; }
  .totals { margin-left: auto; width: 290px; margin-top: 8px; }
  .totals td { border: none; padding: 3px 4px; }
  .totals .g td { border-top: 2px solid #0f3d68; font-weight: 700; font-size: 12px; }
  .terms { white-space: pre-line; font-size: 9.5px; color: #374151; }
  .sign { display: grid; grid-template-columns: repeat(3, 1fr); gap: 18px; margin-top: 26px; }
  .sign div { border-top: 1px solid #6b7280; padding-top: 4px; text-align: center; color: #4b5563; font-size: 9.5px; }
  .badge { display: inline-block; padding: 1px 6px; border-radius: 8px; background: #e0e7ff; color: #1e3a8a; font-size: 9px; font-weight: 600; }
  .muted { color: #6b7280; }
  .mono { font-family: Consolas, 'Courier New', monospace; }
`;

export async function companyHeader(settings: AppSettings, docTitle: string, docNo: string, extra = '') {
  const c = settings.company;
  const logo = await dataUri(c.logoKey);
  const meta = [c.address, [c.phone && `Tel: ${c.phone}`, c.email].filter(Boolean).join('  ·  '), c.taxNumber && `VAT/Tax No: ${c.taxNumber}`]
    .filter(Boolean).join('\n');
  return `<div class="head">
    <div class="company">${logo ? `<img src="${logo}">` : ''}<div><div class="name">${esc(c.name)}</div><div class="meta">${esc(meta)}</div></div></div>
    <div class="doc"><h1>${esc(docTitle)}</h1><div class="no">${esc(docNo)}</div>${extra}</div>
  </div>`;
}

export async function page(title: string, body: string) {
  return `<!doctype html><html><head><meta charset="utf-8"><title>${esc(title)}</title><style>${BASE_CSS}</style></head><body>${body}</body></html>`;
}

export { getSettings };
