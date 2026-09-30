import { prisma, type Tx } from './prisma.js';
import { badRequest } from './errors.js';
import { getSettings, type CompanySettings } from './settings.js';

type Db = Tx | typeof prisma;

/** The main company is the first one; its name, address and logo live in the settings (Settings → Company). */
export const mainCompany = (db: Db = prisma) => db.company.findFirst({ orderBy: { id: 'asc' } });

/** All companies for pickers and Settings; the main company shows its settings details. */
export async function listCompanies(db: Db = prisma) {
  const [rows, s] = await Promise.all([db.company.findMany({ orderBy: { id: 'asc' } }), getSettings(db as Tx)]);
  return rows.map((c, i) => (i === 0
    ? { id: c.id, code: c.code, isMain: true, ...s.company }
    : { id: c.id, code: c.code, isMain: false, name: c.name, address: c.address ?? '', phone: c.phone ?? '', email: c.email ?? '', taxNumber: c.taxNumber ?? '', logoKey: c.logoKey }));
}

/** Company a new PR/PO is for: the one asked for (must exist), else the main company. */
export async function resolveCompanyId(db: Db, companyId?: number | null) {
  if (companyId) {
    if (!(await db.company.findUnique({ where: { id: companyId } }))) throw badRequest(`Company ${companyId} does not exist`);
    return companyId;
  }
  return (await mainCompany(db))?.id ?? null;
}

/** Letterhead for a document: its company's details (the main company's come from the settings). */
export async function documentCompany(companyId: number | null | undefined): Promise<CompanySettings> {
  const s = await getSettings();
  const main = await mainCompany();
  if (!companyId || companyId === main?.id) return s.company;
  const c = await prisma.company.findUnique({ where: { id: companyId } });
  if (!c) return s.company;
  return { name: c.name, address: c.address ?? '', phone: c.phone ?? '', email: c.email ?? '', taxNumber: c.taxNumber ?? '', logoKey: c.logoKey };
}
