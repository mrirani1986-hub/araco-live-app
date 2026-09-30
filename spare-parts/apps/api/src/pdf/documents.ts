import { prisma } from '../lib/prisma.js';
import { prTotals } from '../lib/money.js';
import { loadPr } from '../services/pr.js';
import { loadPo, withPoTotals } from '../services/po.js';
import { loadGrn } from '../services/grn.js';
import { searchParts, stockOf, purchaseHistory, type PartFilters } from '../services/parts.js';
import { documentCompany } from '../lib/companies.js';
import { BASE_CSS, companyHeader, dataUri, esc, fmtDate, fmtNum, fmtQty, getSettings, htmlToPdf, page } from './render.js';

/** Best picture for a part: its own photo, else the drawing of its first assembly. */
export async function partPictureKeys(partIds: number[]) {
  const out = new Map<number, string>();
  if (!partIds.length) return out;
  const photos = await prisma.partImage.findMany({
    where: { partId: { in: partIds } }, orderBy: [{ isPrimary: 'desc' }, { sortOrder: 'asc' }, { id: 'asc' }],
  });
  for (const p of photos) if (p.partId && !out.has(p.partId)) out.set(p.partId, p.thumbKey ?? p.storageKey);
  const missing = partIds.filter((id) => !out.has(id));
  if (missing.length) {
    const usages = await prisma.partUsage.findMany({
      where: { partId: { in: missing } }, orderBy: { id: 'asc' },
      include: { assembly: { include: { images: { orderBy: { sortOrder: 'asc' }, take: 1 } } } },
    });
    for (const u of usages) {
      const img = u.assembly.images[0];
      if (img && !out.has(u.partId)) out.set(u.partId, img.thumbKey ?? img.storageKey);
    }
  }
  return out;
}

async function pic(keys: Map<number, string>, partId: number) {
  const uri = await dataUri(keys.get(partId));
  return uri ? `<img class="pic" src="${uri}">` : '<div class="nopic">no picture</div>';
}

export async function prPdf(id: number) {
  const pr = await loadPr(id);
  const co = await documentCompany(pr.companyId);
  const t = prTotals(pr.items, pr.taxRate);
  const keys = await partPictureKeys(pr.items.map((i) => i.partId));
  const rows = [];
  for (const i of pr.items) {
    const lineTotal = i.estUnitPrice == null ? null : Number(i.quantity) * Number(i.estUnitPrice);
    rows.push(`<tr><td class="c">${i.lineNo}</td><td>${await pic(keys, i.partId)}</td><td class="mono">${esc(i.part.partNumber)}</td>
      <td>${esc(i.description)}${i.machine ? `<div class="muted">For: ${esc(i.machine)}</div>` : ''}${i.notes ? `<div class="muted">${esc(i.notes)}</div>` : ''}</td>
      <td>${esc(i.specification ?? '')}</td><td class="r">${fmtQty(i.quantity)}</td><td>${esc(i.unit)}</td>
      <td class="r">${fmtNum(i.estUnitPrice)}</td><td class="r">${fmtNum(lineTotal)}</td><td>${esc(i.supplier?.name ?? '')}</td></tr>`);
  }
  const approvals = pr.approvals.map((a) => `<tr><td>${esc(a.stepName)}</td><td>${esc(a.action)}</td><td>${esc(a.user.fullName)}</td>
    <td>${new Date(a.createdAt).toISOString().replace('T', ' ').slice(0, 16)}</td><td>${esc(a.comment ?? '')}</td></tr>`).join('');
  const body = `${await companyHeader(co, 'PURCHASE REQUISITION', pr.prNumber, `<div style="margin-top:4px"><span class="badge">${esc(pr.status.replace(/_/g, ' '))}</span></div>`)}
    <div class="grid">
      <div class="box"><div class="t">Request</div><div class="kv">
        <div class="k">PR Number</div><div>${esc(pr.prNumber)}</div>
        <div class="k">Request date</div><div>${fmtDate(pr.requestDate)}</div>
        <div class="k">Requested by</div><div>${esc(pr.requester.fullName)}</div>
        <div class="k">Department</div><div>${esc(pr.department ?? '')}</div></div></div>
      <div class="box"><div class="t">Requirement</div><div class="kv">
        <div class="k">Required date</div><div>${fmtDate(pr.requiredDate)}</div>
        <div class="k">Priority</div><div>${esc(pr.priority)}</div>
        <div class="k">Project</div><div>${esc(pr.project ?? '')}</div>
        <div class="k">Reason</div><div>${esc(pr.reason ?? '')}</div></div></div>
    </div>
    <h2>Items</h2>
    <table><thead><tr><th>#</th><th>Picture</th><th>Part No.</th><th>Description</th><th>Specification</th><th class="r">Qty</th><th>Unit</th>
      <th class="r">Est. Unit Price</th><th class="r">Est. Total</th><th>Supplier</th></tr></thead><tbody>${rows.join('')}</tbody></table>
    <table class="totals"><tr><td>Subtotal</td><td class="r">${fmtNum(t.subtotal)} ${esc(pr.currency)}</td></tr>
      <tr><td>Tax (${fmtNum(pr.taxRate, 1)}%)</td><td class="r">${fmtNum(t.tax)} ${esc(pr.currency)}</td></tr>
      <tr class="g"><td>Estimated Grand Total</td><td class="r">${fmtNum(t.grandTotal)} ${esc(pr.currency)}</td></tr></table>
    ${pr.notes ? `<h2>Notes</h2><div class="terms">${esc(pr.notes)}</div>` : ''}
    <h2>Approvals</h2>
    ${approvals ? `<table><thead><tr><th>Step</th><th>Action</th><th>By</th><th>Date / time</th><th>Comment</th></tr></thead><tbody>${approvals}</tbody></table>` : '<div class="muted">Not submitted yet.</div>'}
    <div class="sign"><div>Requested by</div><div>Store / Maintenance Manager</div><div>Management</div></div>`;
  return htmlToPdf(await page(pr.prNumber, body), { footer: `${co.name} — ${pr.prNumber}` });
}

export async function poPdf(id: number) {
  const po = withPoTotals(await loadPo(id));
  const co = await documentCompany(po.companyId);
  const sup = po.supplierSnapshot as Record<string, string | null>;
  const keys = await partPictureKeys(po.items.map((i) => i.partId));
  const rows = [];
  for (const i of po.items) {
    rows.push(`<tr><td class="c">${i.lineNo}</td><td>${await pic(keys, i.partId)}</td><td class="mono">${esc(i.part.partNumber)}${i.supplierPartNumber ? `<div class="muted">Sup: ${esc(i.supplierPartNumber)}</div>` : ''}</td>
      <td>${esc(i.description)}</td><td>${esc(i.specification ?? '')}</td><td class="r">${fmtQty(i.quantity)}</td><td>${esc(i.unit)}</td>
      <td class="r">${fmtNum(i.unitPrice)}</td><td class="r">${Number(i.discountPct) ? fmtNum(i.discountPct, 1) + '%' : ''}</td>
      <td class="r">${fmtNum(i.taxPct, 1)}%</td><td class="r">${fmtNum(i.lineTotal)}</td></tr>`);
  }
  const t = po.totals;
  const cur = esc(po.currency);
  const approvedBy = po.approvals.filter((a) => a.action === 'APPROVED').at(-1);
  const body = `${await companyHeader(co, 'PURCHASE ORDER', po.poNumber, `<div class="muted" style="margin-top:3px">Date: ${fmtDate(po.poDate)}</div>`)}
    <div class="grid">
      <div class="box"><div class="t">Supplier</div>
        <div style="font-weight:700;font-size:12px">${esc(sup.name)}</div>
        ${sup.company && sup.company !== sup.name ? `<div>${esc(sup.company)}</div>` : ''}
        <div class="terms">${esc([sup.address, sup.country].filter(Boolean).join(', '))}</div>
        <div class="kv" style="margin-top:4px"><div class="k">Contact</div><div>${esc(sup.contactPerson ?? '')}</div>
        <div class="k">Phone</div><div>${esc(sup.phone ?? '')}</div><div class="k">Email</div><div>${esc(sup.email ?? '')}</div>
        <div class="k">VAT / Tax No.</div><div>${esc(sup.taxNumber ?? '')}</div></div></div>
      <div class="box"><div class="t">Order details</div><div class="kv">
        <div class="k">PO Number</div><div><b>${esc(po.poNumber)}</b></div>
        <div class="k">PO Date</div><div>${fmtDate(po.poDate)}</div>
        <div class="k">Reference PR</div><div>${esc(po.prNumber ?? '—')}</div>
        <div class="k">Currency</div><div>${cur}</div>
        <div class="k">Payment terms</div><div>${esc(po.paymentTerms ?? '')}</div>
        <div class="k">Delivery terms</div><div>${esc(po.deliveryTerms ?? '')}</div>
        <div class="k">Expected delivery</div><div>${fmtDate(po.expectedDelivery)}</div>
        <div class="k">Shipping method</div><div>${esc(po.shippingMethod ?? '')}</div>
        <div class="k">Buyer</div><div>${esc(po.buyer.fullName)}</div></div></div>
    </div>
    <h2>Items</h2>
    <table><thead><tr><th>#</th><th>Picture</th><th>Part No.</th><th>Description</th><th>Specification</th><th class="r">Qty</th><th>Unit</th>
      <th class="r">Unit Price</th><th class="r">Disc.</th><th class="r">Tax</th><th class="r">Total</th></tr></thead><tbody>${rows.join('')}</tbody></table>
    <table class="totals">
      <tr><td>Subtotal</td><td class="r">${fmtNum(t.subtotal)} ${cur}</td></tr>
      ${t.discount ? `<tr><td>Discount</td><td class="r">-${fmtNum(t.discount)} ${cur}</td></tr>` : ''}
      <tr><td>Tax</td><td class="r">${fmtNum(t.tax)} ${cur}</td></tr>
      ${t.shipping ? `<tr><td>Shipping</td><td class="r">${fmtNum(t.shipping)} ${cur}</td></tr>` : ''}
      ${t.other ? `<tr><td>Other charges</td><td class="r">${fmtNum(t.other)} ${cur}</td></tr>` : ''}
      <tr class="g"><td>Grand Total</td><td class="r">${fmtNum(t.grandTotal)} ${cur}</td></tr></table>
    ${po.notes ? `<h2>Notes</h2><div class="terms">${esc(po.notes)}</div>` : ''}
    <h2>Terms &amp; Conditions</h2><div class="terms">${esc(po.terms ?? '')}</div>
    <div class="sign"><div>Prepared by<br><b>${esc(po.buyer.fullName)}</b></div>
      <div>Authorized by${approvedBy ? `<br><b>${esc(approvedBy.user.fullName)}</b> — ${fmtDate(approvedBy.createdAt)}` : ''}<br><br>Signature</div>
      <div>Supplier acceptance<br><br>Signature &amp; stamp</div></div>`;
  return htmlToPdf(await page(po.poNumber, body), { footer: `${co.name} — ${po.poNumber}` });
}

export async function grnPdf(id: number) {
  const g = await loadGrn(id);
  const co = await documentCompany(g.po.companyId);
  const rows = g.items.map((i) => `<tr><td class="mono">${esc(i.poItem.part.partNumber)}</td><td>${esc(i.poItem.description)}</td>
    <td class="r">${fmtQty(i.orderedQty)}</td><td class="r">${fmtQty(i.receivedQty)}</td><td class="r">${fmtQty(i.rejectedQty)}</td>
    <td class="r">${fmtQty(i.remainingQty)}</td><td>${esc(i.poItem.unit)}</td><td>${esc(i.condition)}</td><td>${esc(i.notes ?? '')}</td></tr>`).join('');
  const body = `${await companyHeader(co, 'GOODS RECEIPT NOTE', g.grnNumber)}
    <div class="grid"><div class="box"><div class="kv">
      <div class="k">GRN Number</div><div><b>${esc(g.grnNumber)}</b></div>
      <div class="k">PO Number</div><div>${esc(g.po.poNumber)}</div>
      <div class="k">Supplier</div><div>${esc(g.po.supplier.name)}</div></div></div>
      <div class="box"><div class="kv">
      <div class="k">Receiving date</div><div>${fmtDate(g.receivedAt)}</div>
      <div class="k">Received by</div><div>${esc(g.receiver.fullName)}</div>
      <div class="k">Warehouse</div><div>${esc(g.warehouse.name)}</div>
      <div class="k">Delivery note</div><div>${esc(g.deliveryNote ?? '')}</div></div></div></div>
    <h2>Items</h2>
    <table><thead><tr><th>Part No.</th><th>Description</th><th class="r">Ordered</th><th class="r">Received</th><th class="r">Rejected</th>
      <th class="r">Remaining</th><th>Unit</th><th>Condition</th><th>Notes</th></tr></thead><tbody>${rows}</tbody></table>
    ${g.notes ? `<h2>Notes</h2><div class="terms">${esc(g.notes)}</div>` : ''}
    <div class="sign"><div>Received by</div><div>Checked by</div><div>Store Manager</div></div>`;
  return htmlToPdf(await page(g.grnNumber, body), { footer: `${co.name} — ${g.grnNumber}` });
}

export async function partPdf(id: number) {
  const s = await getSettings();
  const p = await prisma.part.findUniqueOrThrow({
    where: { id },
    include: {
      category: true, manufacturer: true, aliases: true,
      images: { orderBy: [{ isPrimary: 'desc' }, { sortOrder: 'asc' }] },
      usages: { include: { assembly: { include: { equipment: true, images: { orderBy: { sortOrder: 'asc' } } } } } },
      supplierParts: { include: { supplier: true } },
      inventory: { include: { location: { include: { warehouse: true } } } },
    },
  });
  const stock = await stockOf(id);
  const hist = await purchaseHistory(id);
  const imgs = [...p.images.map((i) => i.storageKey), ...p.usages.flatMap((u) => u.assembly.images.map((i) => i.storageKey))].slice(0, 3);
  const pics = (await Promise.all(imgs.map(dataUri))).filter(Boolean).map((u) => `<img src="${u}" style="max-width:100%;max-height:300px;border:1px solid #e5e7eb;margin-bottom:6px">`).join('');
  const sp = p.supplierParts.sort((a, b) => Number(b.isPreferred) - Number(a.isPreferred))[0];
  const kv = (k: string, v: unknown) => `<div class="k">${k}</div><div>${esc(v ?? '')}</div>`;
  const body = `${await companyHeader(s.company, 'SPARE PART', p.partNumber)}
    <div class="grid"><div>${pics || '<div class="nopic" style="width:100%;height:160px">no picture</div>'}</div>
    <div class="box"><div class="kv">
      ${kv('Part Number', p.partNumber)}${kv('Item Code', p.itemCode)}${kv('Part Name', p.name)}${kv('Description', p.description)}
      ${kv('Category', [p.category?.name, p.subcategory].filter(Boolean).join(' / '))}${kv('Manufacturer', p.manufacturer?.name)}
      ${kv('Brand', p.brand)}${kv('Model', p.model)}${kv('Equipment', [...new Set(p.usages.map((u) => u.assembly.equipment.name))].join(', '))}
      ${kv('Specification', p.specification)}${kv('Unit', p.unit)}${kv('Supplier', sp?.supplier.name)}${kv('Supplier Part No.', sp?.supplierPartNumber)}
      ${kv('Price', sp?.price != null ? `${fmtNum(sp.price)} ${sp.currency}` : p.standardPrice != null ? `${fmtNum(p.standardPrice)} ${p.currency}` : '')}
      ${kv('Current Stock', `${fmtQty(stock.onHand)} ${p.unit}`)}${kv('Minimum Stock', stock.minStock == null ? '' : fmtQty(stock.minStock))}
      ${kv('Location', p.inventory.filter((i) => Number(i.onHand) > 0).map((i) => `${i.location.warehouse.code}/${i.location.code}`).join(', '))}
      ${kv('Notes', p.notes)}${kv('Also known as', p.aliases.map((a) => a.alias).filter((a) => a !== p.name).join('; '))}
    </div></div></div>
    <h2>Where used</h2><table><thead><tr><th>Equipment</th><th>Assembly</th><th class="r">Installed</th><th class="r">Recommended spare</th><th>Name in workbook</th></tr></thead><tbody>
    ${p.usages.map((u) => `<tr><td>${esc(u.assembly.equipment.name)}</td><td>${esc(u.assembly.name)}</td><td class="r">${esc(u.installedRaw ?? '')}</td><td class="r">${esc(u.recommendedRaw ?? '')}</td><td class="mono">${esc(u.nameInSource)}</td></tr>`).join('')}</tbody></table>
    <h2>Purchase history</h2>${hist.history.length ? `<table><thead><tr><th>Date</th><th>PO</th><th>GRN</th><th>Supplier</th><th class="r">Qty</th><th class="r">Unit price</th><th>Currency</th></tr></thead><tbody>
    ${hist.history.map((h) => `<tr><td>${fmtDate(h.date)}</td><td>${esc(h.poNumber)}</td><td>${esc(h.grnNumber)}</td><td>${esc(h.supplier)}</td><td class="r">${fmtQty(h.qty)}</td><td class="r">${fmtNum(h.netPrice)}</td><td>${esc(h.currency)}</td></tr>`).join('')}</tbody></table>` : '<div class="muted">No purchases recorded yet.</div>'}`;
  return htmlToPdf(await page(p.partNumber, body), { footer: `${s.company.name} — ${p.partNumber}` });
}

export async function cataloguePdf(filters: PartFilters) {
  const s = await getSettings();
  const res = await searchParts({ ...filters, page: 1, pageSize: 200 });
  let items = res.items;
  if (res.total > 200) {
    for (let pg = 2; (pg - 1) * 200 < res.total; pg++) items = items.concat((await searchParts({ ...filters, page: pg, pageSize: 200 })).items);
  }
  const rows = [];
  for (const p of items) {
    const uri = await dataUri(p.thumb);
    rows.push(`<tr><td>${uri ? `<img class="pic" src="${uri}">` : '<div class="nopic">—</div>'}</td><td class="mono">${esc(p.partNumber)}</td><td>${esc(p.name)}</td>
      <td>${esc(p.category ?? '')}</td><td>${esc(p.equipment ?? '')}</td><td class="r">${fmtQty(p.onHand)} ${esc(p.unit)}</td>
      <td>${esc(p.supplierName ?? '')}</td><td class="r">${p.price == null ? '' : fmtNum(p.price) + ' ' + esc(p.currency)}</td></tr>`);
  }
  const body = `${await companyHeader(s.company, 'SPARE PARTS CATALOGUE', `${items.length} parts`, `<div class="muted">${new Date().toISOString().slice(0, 10)}</div>`)}
    <table><thead><tr><th>Picture</th><th>Part No.</th><th>Part Name</th><th>Category</th><th>Equipment</th><th class="r">Stock</th><th>Supplier</th><th class="r">Price</th></tr></thead><tbody>${rows.join('')}</tbody></table>`;
  return htmlToPdf(await page('Catalogue', body), { footer: `${s.company.name} — Spare parts catalogue` });
}

export interface TableColumn { key: string; label: string; align?: 'r' | 'c'; format?: 'num' | 'qty' | 'date' }

/** Generic printable report used for all "export to PDF" of lists. */
export async function tablePdf(title: string, columns: TableColumn[], rows: Record<string, unknown>[], subtitle = '') {
  const s = await getSettings();
  const fmt = (c: TableColumn, v: unknown) => c.format === 'num' ? fmtNum(v) : c.format === 'qty' ? fmtQty(v) : c.format === 'date' ? fmtDate(v) : esc(v ?? '');
  const body = `${await companyHeader(s.company, title.toUpperCase(), subtitle || `${rows.length} rows`, `<div class="muted">Generated ${new Date().toISOString().slice(0, 16).replace('T', ' ')}</div>`)}
    <table><thead><tr>${columns.map((c) => `<th class="${c.align ?? ''}">${esc(c.label)}</th>`).join('')}</tr></thead>
    <tbody>${rows.map((r) => `<tr>${columns.map((c) => `<td class="${c.align ?? ''}">${fmt(c, r[c.key])}</td>`).join('')}</tr>`).join('')}</tbody></table>`;
  return htmlToPdf(await page(title, body), { landscape: columns.length > 7, footer: `${s.company.name} — ${title}` });
}

export { BASE_CSS };
