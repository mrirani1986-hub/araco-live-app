import { Prisma } from '@prisma/client';
import { prisma, type Tx } from '../lib/prisma.js';

/** Rebuilds the denormalised search text used by the trigram index. */
export async function refreshSearchText(db: Tx | typeof prisma, partIds?: number[]) {
  const parts = await db.part.findMany({
    where: partIds ? { id: { in: partIds } } : undefined,
    include: {
      aliases: true, category: true, manufacturer: true,
      usages: { include: { assembly: { include: { equipment: true } } } },
      supplierParts: { include: { supplier: true } },
    },
  });
  for (const p of parts) {
    const bits = new Set<string>();
    const add = (s?: string | null) => { if (s) bits.add(s.trim()); };
    add(p.partNumber);
    add(p.partNumber.replace(/^E/i, '')); // "1001286" finds E1001286
    add(p.itemCode); add(p.name); add(p.description); add(p.specification); add(p.brand); add(p.model);
    add(p.subcategory); add(p.category?.name); add(p.manufacturer?.name);
    for (const a of p.aliases) add(a.alias);
    for (const u of p.usages) { add(u.assembly.name); add(u.assembly.equipment.name); }
    for (const sp of p.supplierParts) { add(sp.supplier.name); add(sp.supplierPartNumber); }
    await db.part.update({ where: { id: p.id }, data: { searchText: [...bits].join(' | ').toLowerCase() } });
  }
}

export interface PartFilters {
  q?: string;
  categoryId?: number;
  manufacturerId?: number;
  supplierId?: number;
  equipmentId?: number;
  assemblyId?: number;
  locationId?: number;
  stockStatus?: 'OUT_OF_STOCK' | 'LOW_STOCK' | 'REORDER' | 'OK' | 'NOT_STOCKED' | 'ATTENTION';
  priceMin?: number;
  priceMax?: number;
  critical?: boolean;
  page?: number;
  pageSize?: number;
  sort?: 'relevance' | 'partNumber' | 'name' | 'stock' | 'price';
}

// Stock status per part, aggregated over all locations. NOT_STOCKED = no stock
// and no minimum defined (not a stocked item yet), so it is not an alarm.
export const STOCK_CTE = Prisma.sql`
  stock AS (
    SELECT p.id AS part_id,
           COALESCE(SUM(i.on_hand), 0) AS on_hand,
           COALESCE(SUM(i.reserved), 0) AS reserved,
           SUM(i.min_stock) AS min_stock,
           SUM(i.max_stock) AS max_stock,
           SUM(i.reorder_level) AS reorder_level
    FROM parts p LEFT JOIN inventory i ON i.part_id = p.id
    GROUP BY p.id
  ),
  status AS (
    SELECT s.*,
      CASE
        WHEN s.on_hand <= 0 AND COALESCE(s.min_stock, 0) > 0 THEN 'OUT_OF_STOCK'
        WHEN s.min_stock IS NOT NULL AND s.on_hand < s.min_stock THEN 'LOW_STOCK'
        WHEN s.reorder_level IS NOT NULL AND s.on_hand <= s.reorder_level THEN 'REORDER'
        WHEN s.on_hand <= 0 THEN 'NOT_STOCKED'
        ELSE 'OK'
      END AS stock_status
    FROM stock s
  ),
  price AS (
    SELECT p.id AS part_id,
      COALESCE(
        (SELECT sp.price FROM supplier_parts sp WHERE sp.part_id = p.id AND sp.price IS NOT NULL
          ORDER BY sp.is_preferred DESC, sp.price ASC LIMIT 1),
        p.standard_price) AS price,
      (SELECT s.name FROM supplier_parts sp JOIN suppliers s ON s.id = sp.supplier_id
        WHERE sp.part_id = p.id ORDER BY sp.is_preferred DESC, sp.price ASC NULLS LAST LIMIT 1) AS supplier_name,
      (SELECT sp.supplier_id FROM supplier_parts sp
        WHERE sp.part_id = p.id ORDER BY sp.is_preferred DESC, sp.price ASC NULLS LAST LIMIT 1) AS supplier_id
    FROM parts p
  )`;

export async function searchParts(f: PartFilters): Promise<SearchResult> {
  const exact = await runSearch(f, false);
  // Typo tolerance only when the literal search finds nothing (e.g. "pnuematic").
  if (exact.total === 0 && (f.q ?? '').trim()) return { ...(await runSearch(f, true)), fuzzy: true };
  return exact;
}

type SearchResult = Awaited<ReturnType<typeof runSearch>> & { fuzzy?: boolean };

async function runSearch(f: PartFilters, fuzzy: boolean) {
  const page = Math.max(1, f.page ?? 1);
  const pageSize = Math.min(200, Math.max(1, f.pageSize ?? 48));
  const where: Prisma.Sql[] = [Prisma.sql`p.status <> 'DELETED'`];
  const q = (f.q ?? '').trim().toLowerCase();
  let rank = Prisma.sql`0`;
  if (q) {
    const terms = q.split(/\s+/).filter(Boolean).slice(0, 8);
    for (const t of terms) {
      const like = `%${t.replace(/[%_\\]/g, (m) => '\\' + m)}%`;
      where.push(fuzzy ? Prisma.sql`(p.search_text ILIKE ${like} OR word_similarity(${t}, p.search_text) >= 0.4)` : Prisma.sql`p.search_text ILIKE ${like}`);
    }
    const digits = q.replace(/^e/, '');
    rank = Prisma.sql`(CASE
        WHEN lower(p.part_number) = ${q} OR lower(p.part_number) = ${'e' + digits} THEN 0
        WHEN lower(p.part_number) LIKE ${q + '%'} OR lower(p.part_number) LIKE ${'e' + digits + '%'} THEN 1
        WHEN lower(p.part_number) LIKE ${'%' + digits + '%'} THEN 2
        WHEN lower(p.name) LIKE ${'%' + q + '%'} THEN 3
        ELSE 4 END) * 10 - word_similarity(${q}, p.search_text)`;
  }
  if (f.categoryId) where.push(Prisma.sql`p.category_id = ${f.categoryId}`);
  if (f.manufacturerId) where.push(Prisma.sql`p.manufacturer_id = ${f.manufacturerId}`);
  if (f.critical !== undefined) where.push(Prisma.sql`p.is_critical = ${f.critical}`);
  if (f.supplierId) where.push(Prisma.sql`EXISTS (SELECT 1 FROM supplier_parts sp WHERE sp.part_id = p.id AND sp.supplier_id = ${f.supplierId})`);
  if (f.equipmentId) where.push(Prisma.sql`EXISTS (SELECT 1 FROM part_usages u JOIN assemblies a ON a.id = u.assembly_id WHERE u.part_id = p.id AND a.equipment_id = ${f.equipmentId})`);
  if (f.assemblyId) where.push(Prisma.sql`EXISTS (SELECT 1 FROM part_usages u WHERE u.part_id = p.id AND u.assembly_id = ${f.assemblyId})`);
  if (f.locationId) where.push(Prisma.sql`EXISTS (SELECT 1 FROM inventory i WHERE i.part_id = p.id AND i.location_id = ${f.locationId})`);
  if (f.stockStatus === 'ATTENTION') where.push(Prisma.sql`st.stock_status IN ('OUT_OF_STOCK','LOW_STOCK','REORDER')`);
  else if (f.stockStatus) where.push(Prisma.sql`st.stock_status = ${f.stockStatus}`);
  if (f.priceMin !== undefined) where.push(Prisma.sql`pr.price >= ${f.priceMin}`);
  if (f.priceMax !== undefined) where.push(Prisma.sql`pr.price <= ${f.priceMax}`);

  const order = {
    relevance: q ? Prisma.sql`rank ASC, p.part_number ASC` : Prisma.sql`p.part_number ASC`,
    partNumber: Prisma.sql`p.part_number ASC`,
    name: Prisma.sql`p.name ASC, p.part_number ASC`,
    stock: Prisma.sql`st.on_hand DESC, p.part_number ASC`,
    price: Prisma.sql`pr.price ASC NULLS LAST, p.part_number ASC`,
  }[f.sort || 'relevance'];

  const whereSql = Prisma.join(where, ' AND ');
  const rows = await prisma.$queryRaw<Record<string, unknown>[]>`
    WITH ${STOCK_CTE}
    SELECT p.id, p.part_number, p.name, p.unit, p.is_critical, p.currency, p.subcategory,
           c.name AS category, m.name AS manufacturer,
           st.on_hand, st.reserved, st.min_stock, st.reorder_level, st.stock_status,
           pr.price, pr.supplier_name, pr.supplier_id,
           (SELECT COALESCE(pi.thumb_key, pi.storage_key) FROM part_images pi WHERE pi.part_id = p.id
              ORDER BY pi.is_primary DESC, pi.sort_order, pi.id LIMIT 1) AS photo_thumb,
           (SELECT COALESCE(pi.thumb_key, pi.storage_key) FROM part_usages u JOIN part_images pi ON pi.assembly_id = u.assembly_id
              WHERE u.part_id = p.id ORDER BY u.id, pi.sort_order LIMIT 1) AS drawing_thumb,
           (SELECT string_agg(DISTINCT e.name, ', ') FROM part_usages u JOIN assemblies a ON a.id = u.assembly_id
              JOIN equipment e ON e.id = a.equipment_id WHERE u.part_id = p.id) AS equipment,
           (SELECT string_agg(DISTINCT l.code, ', ') FROM inventory i JOIN locations l ON l.id = i.location_id
              WHERE i.part_id = p.id AND i.on_hand > 0) AS locations,
           ${rank} AS rank,
           COUNT(*) OVER() AS total
    FROM parts p
    JOIN status st ON st.part_id = p.id
    JOIN price pr ON pr.part_id = p.id
    LEFT JOIN categories c ON c.id = p.category_id
    LEFT JOIN manufacturers m ON m.id = p.manufacturer_id
    WHERE ${whereSql}
    ORDER BY ${order}
    LIMIT ${pageSize} OFFSET ${(page - 1) * pageSize}`;

  const total = rows.length ? Number(rows[0].total) : 0;
  return {
    page, pageSize, total,
    items: rows.map((r) => ({
      id: r.id as number,
      partNumber: r.part_number as string,
      name: r.name as string,
      unit: r.unit as string,
      isCritical: r.is_critical as boolean,
      category: r.category as string | null,
      subcategory: r.subcategory as string | null,
      manufacturer: r.manufacturer as string | null,
      equipment: r.equipment as string | null,
      locations: r.locations as string | null,
      onHand: Number(r.on_hand),
      reserved: Number(r.reserved),
      available: Number(r.on_hand) - Number(r.reserved),
      minStock: r.min_stock == null ? null : Number(r.min_stock),
      reorderLevel: r.reorder_level == null ? null : Number(r.reorder_level),
      stockStatus: r.stock_status as string,
      price: r.price == null ? null : Number(r.price),
      currency: r.currency as string,
      supplierName: r.supplier_name as string | null,
      supplierId: r.supplier_id as number | null,
      thumb: (r.photo_thumb ?? r.drawing_thumb) as string | null,
      thumbIsDrawing: !r.photo_thumb && !!r.drawing_thumb,
    })),
  };
}

export async function stockOf(partId: number) {
  const rows = await prisma.$queryRaw<Record<string, unknown>[]>`
    WITH ${STOCK_CTE} SELECT * FROM status WHERE part_id = ${partId}`;
  const r = rows[0];
  return {
    onHand: Number(r.on_hand), reserved: Number(r.reserved), available: Number(r.on_hand) - Number(r.reserved),
    minStock: r.min_stock == null ? null : Number(r.min_stock),
    maxStock: r.max_stock == null ? null : Number(r.max_stock),
    reorderLevel: r.reorder_level == null ? null : Number(r.reorder_level),
    stockStatus: r.stock_status as string,
  };
}

/** Purchase history (from goods receipts) and price statistics for a part. */
export async function purchaseHistory(partId: number) {
  const rows = await prisma.$queryRaw<Record<string, unknown>[]>`
    SELECT g.received_at, g.grn_number, po.id AS po_id, po.po_number, po.currency, s.id AS supplier_id, s.name AS supplier,
           gi.received_qty, gi.rejected_qty, poi.unit_price, poi.discount_pct,
           (poi.unit_price * (1 - poi.discount_pct / 100)) AS net_price
    FROM goods_receipt_items gi
    JOIN goods_receipts g ON g.id = gi.grn_id
    JOIN purchase_order_items poi ON poi.id = gi.po_item_id
    JOIN purchase_orders po ON po.id = poi.po_id
    JOIN suppliers s ON s.id = po.supplier_id
    WHERE poi.part_id = ${partId}
    ORDER BY g.received_at DESC, g.id DESC`;
  const history = rows.map((r) => ({
    date: r.received_at as Date, grnNumber: r.grn_number as string, poId: r.po_id as number, poNumber: r.po_number as string,
    supplierId: r.supplier_id as number, supplier: r.supplier as string, qty: Number(r.received_qty),
    rejectedQty: Number(r.rejected_qty), unitPrice: Number(r.unit_price), discountPct: Number(r.discount_pct),
    netPrice: Math.round(Number(r.net_price) * 10000) / 10000, currency: r.currency as string,
  }));
  const priced = history.filter((h) => h.qty > 0);
  const prices = priced.map((h) => h.netPrice);
  const totalQty = priced.reduce((a, h) => a + h.qty, 0);
  const stats = priced.length ? {
    lastPrice: priced[0].netPrice,
    lowestPrice: Math.min(...prices),
    highestPrice: Math.max(...prices),
    averagePrice: Math.round((priced.reduce((a, h) => a + h.netPrice * h.qty, 0) / totalQty) * 10000) / 10000,
    lastSupplier: priced[0].supplier,
    lastPurchaseDate: priced[0].date,
    currency: priced[0].currency,
    totalQty,
  } : null;
  // Ordered but not yet (fully) received
  const openOrders = await prisma.purchaseOrderItem.findMany({
    where: { partId, po: { status: { in: ['DRAFT', 'APPROVED', 'SENT', 'PARTIALLY_RECEIVED'] } } },
    include: { po: { include: { supplier: true } } },
    orderBy: { id: 'desc' },
  });
  return {
    history, stats,
    openOrders: openOrders.map((o) => ({
      poId: o.poId, poNumber: o.po.poNumber, status: o.po.status, supplier: o.po.supplier.name,
      ordered: Number(o.quantity), received: Number(o.qtyReceived), remaining: Number(o.quantity) - Number(o.qtyReceived),
      unitPrice: Number(o.unitPrice), currency: o.po.currency, expectedDelivery: o.po.expectedDelivery,
    })),
  };
}
