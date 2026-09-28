import { Prisma } from '@prisma/client';

export const D = (v: Prisma.Decimal.Value | null | undefined) => new Prisma.Decimal(v ?? 0);
export const round2 = (d: Prisma.Decimal) => d.toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);
export const num = (d: Prisma.Decimal | null | undefined) => (d == null ? null : Number(d));

export interface PoLineLike {
  quantity: Prisma.Decimal.Value;
  unitPrice: Prisma.Decimal.Value;
  discountPct?: Prisma.Decimal.Value | null;
  taxPct?: Prisma.Decimal.Value | null;
}

export function poLineTotals(l: PoLineLike) {
  const gross = D(l.quantity).mul(D(l.unitPrice));
  const discount = gross.mul(D(l.discountPct)).div(100);
  const net = gross.minus(discount);
  const tax = net.mul(D(l.taxPct)).div(100);
  return { gross: round2(gross), discount: round2(discount), net: round2(net), tax: round2(tax), total: round2(net.plus(tax)) };
}

export function poTotals(lines: PoLineLike[], shipping: Prisma.Decimal.Value = 0, other: Prisma.Decimal.Value = 0) {
  let subtotal = D(0), discount = D(0), tax = D(0);
  for (const l of lines) {
    const t = poLineTotals(l);
    subtotal = subtotal.plus(t.gross);
    discount = discount.plus(t.discount);
    tax = tax.plus(t.tax);
  }
  const grand = subtotal.minus(discount).plus(tax).plus(D(shipping)).plus(D(other));
  return {
    subtotal: Number(round2(subtotal)), discount: Number(round2(discount)), tax: Number(round2(tax)),
    shipping: Number(round2(D(shipping))), other: Number(round2(D(other))), grandTotal: Number(round2(grand)),
  };
}

export function prTotals(lines: { quantity: Prisma.Decimal.Value; estUnitPrice: Prisma.Decimal.Value | null }[], taxRate: Prisma.Decimal.Value) {
  let subtotal = D(0);
  for (const l of lines) subtotal = subtotal.plus(D(l.quantity).mul(D(l.estUnitPrice)));
  const tax = subtotal.mul(D(taxRate)).div(100);
  return { subtotal: Number(round2(subtotal)), tax: Number(round2(tax)), grandTotal: Number(round2(subtotal.plus(tax))) };
}
