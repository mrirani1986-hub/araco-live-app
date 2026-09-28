import { prisma, type Tx } from './prisma.js';

export interface CompanySettings {
  name: string;
  address: string;
  phone: string;
  email: string;
  taxNumber: string;
  logoKey: string | null;
}

export interface AppSettings {
  company: CompanySettings;
  currency: string;
  taxRate: number;
  poTerms: string;
  defaultPaymentTerms: string;
  defaultDeliveryTerms: string;
  overReceiptTolerancePct: number;
}

export const DEFAULT_SETTINGS: AppSettings = {
  company: { name: 'ARACO READY MIX', address: '', phone: '', email: '', taxNumber: '', logoKey: null },
  currency: 'SAR',
  taxRate: 15,
  poTerms: [
    '1. Please quote the PO number on all invoices, delivery notes and correspondence.',
    '2. Goods must match the part numbers and specifications stated on this order.',
    '3. Deliveries are subject to inspection; rejected goods will be returned at the supplier\'s cost.',
    '4. Prices are fixed as stated on this order unless agreed in writing.',
  ].join('\n'),
  defaultPaymentTerms: '',
  defaultDeliveryTerms: '',
  overReceiptTolerancePct: 0,
};

export async function getSettings(tx?: Tx): Promise<AppSettings> {
  const rows = await (tx ?? prisma).setting.findMany();
  const s: Record<string, unknown> = { ...DEFAULT_SETTINGS };
  for (const r of rows) s[r.key] = r.value;
  s.company = { ...DEFAULT_SETTINGS.company, ...(s.company as object) };
  return s as unknown as AppSettings;
}

export async function setSetting(key: keyof AppSettings, value: unknown, tx?: Tx) {
  await (tx ?? prisma).setting.upsert({ where: { key }, update: { value: value as object }, create: { key, value: value as object } });
}
