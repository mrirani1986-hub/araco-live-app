# ARACO Spare Parts Management & Procurement

Catalogue → search → part details with pictures → request cart → purchase requisition (PR) →
multi-level approval → purchase orders per supplier → goods receiving → inventory → purchase history,
with a complete audit trail. Built on the original ELKON spare-part workbook (`SPARE_PART_LIST.xlsx`),
which is kept unchanged as the source of truth.

This is a separate application inside the repository; the existing fleet app (`../frontend`, `../backend`) is not touched.

| | |
|---|---|
| Stack | PostgreSQL 16 · Prisma 5 · Node 22 / Express 5 / TypeScript · React 18 / Vite / Tailwind · Chromium PDFs · ExcelJS |
| Data | 254 parts (252 workbook codes + 2 assembly codes from captions), 289 bill-of-material rows, 10 machines, 28 assemblies, 34 drawings, 264 name aliases |
| Tests | 45 API integration tests + browser acceptance scenario (section 30, all 20 steps) + page smoke test |

## Documents

| | |
|---|---|
| [docs/01-source-analysis.md](docs/01-source-analysis.md) | Workbook & 2021 PDF analysis, data-quality report, workbook-vs-PDF differences |
| [docs/02-architecture.md](docs/02-architecture.md) | Architecture, design rules, workflows, roles, page list, search |
| [docs/03-import-mapping.md](docs/03-import-mapping.md) | Source → database mapping, Excel import wizard rules |
| [docs/04-operations-and-testing.md](docs/04-operations-and-testing.md) | Running, configuration, backups, test results, known limitations |
| [docs/05-deploy-railway.md](docs/05-deploy-railway.md) | Step-by-step deployment on Railway |
| [docs/screenshots/](docs/screenshots/) | Screenshots and a generated PO PDF from the acceptance run |
| [source-data/](source-data/README.md) | Read-only originals (+ SHA-256) and extracted rows/pictures metadata |

## Quick start (Docker)

```bash
cd spare-parts
cp .env.example .env          # set DB_PASSWORD, JWT_SECRET (32+ chars), ADMIN_PASSWORD
docker compose up -d --build  # http://localhost:4100 — the first start imports the original workbook
```

**Railway:** see [docs/05-deploy-railway.md](docs/05-deploy-railway.md).

Sign in with `ADMIN_USERNAME` / `ADMIN_PASSWORD`, then: **Users** → create real users and roles;
**Settings → Company** → address, phone, VAT number, logo; **Suppliers** → suppliers and prices (or import from Excel);
**Settings → Import → Stock** → opening stock; **Inventory → Suggested minimum stock** → apply the workbook's spare recommendations.

## Development

```bash
cd spare-parts
npm install
# PostgreSQL 16 with a database the app user owns, e.g. araco_spares
cp apps/api/.env.example apps/api/.env      # edit DATABASE_URL, JWT_SECRET, ADMIN_PASSWORD
npm run db:migrate                           # apply migrations
npm run import:source                        # roles, settings, admin + original workbook (idempotent)
npm run dev:api                              # API on :4100
npm run dev:web                              # UI on :5174 (proxies /api)
```

| Command | |
|---|---|
| `npm test` | API integration tests on a separate `araco_spares_test` database (reset each run, real workbook data) |
| `npm run typecheck` | TypeScript checks for API and web |
| `npm run build` | Compile API and web (`apps/web/dist` is served by the API) |
| `npm run e2e` / `npm run e2e:smoke` | Browser tests against a running server (`BASE_URL`, `ADMIN_PASSWORD`) — use a disposable database |
| `npm run extract` | Re-extract the workbook (`tools/extract_source_xlsx.py`) and compare with the 2021 PDF |

## Data safety

- `source-data/original/` holds the workbook and the 2021 PDF, read-only, verified by `SHA256SUMS`. The import checks the checksum and refuses to run on a different file.
- Every imported record links to its sheet/row (`MIXER!A45`); the raw cell values are stored verbatim in `source_records` (append-only).
- Nothing is overwritten silently: imports preview first and existing records are skipped unless you choose *fill empty fields* or *overwrite* per row.
- Stock, approvals, source records and the audit log are append-only (enforced by database triggers).
- Backups (Settings → Backup) contain a full `pg_dump` plus all pictures and imported files; a restore first takes a safety backup.
