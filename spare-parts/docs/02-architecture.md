# 02 — Proposed application architecture

Status: **implemented** (approved 2026-09-28). This document describes the system as built.

## 1. Where it lives

The repository already contains the ARACO fleet/fuel starter (`frontend/`, `backend/`,
`database/schema.sql` — plain JS, Express, `pg`, 4 hard-coded roles). The spare-parts system is
much larger and needs TypeScript, Prisma, a permission model, and document workflows, so it is
built as a **separate application in `spare-parts/`**, leaving the existing app untouched:

```
araco-live-app/
├── frontend/ backend/ database/        ← existing fleet app (not modified)
└── spare-parts/
    ├── apps/
    │   ├── api/        Node 22 + TypeScript + Express 5 + Prisma 5 (+ prisma/ schema & migrations, test/)
    │   └── web/        React 18 + TypeScript + Vite + Tailwind + TanStack Query + Recharts
    ├── e2e/            browser acceptance scenario + page smoke test (Playwright)
    ├── tools/          source extraction / comparison scripts (Python, read-only on source)
    ├── source-data/      original file (read-only) + SHA256 + extracted rows/images
    ├── storage/          (git-ignored) images/ imports/ exports/ backup/
    ├── docs/
    ├── Dockerfile      single image: API + built web app + Chromium (PDF) + pg_dump
    └── docker-compose.yml  postgres + app (own DB: araco_spares)
```

It can share the same PostgreSQL server as the fleet app (own database). Later, the fleet app's
vehicles can become `equipment` rows so maintenance and parts connect.

## 2. Stack

| Layer | Choice | Why |
|---|---|---|
| DB | PostgreSQL 16 | relational integrity, row locks for numbering, `pg_trgm` for fuzzy search, append-only triggers on ledgers |
| ORM | Prisma 5 | typed models, migrations (`docs/proposed-schema.prisma`, validated) |
| API | Express + TypeScript, zod validation | simple, matches the existing team skill set |
| Auth | httpOnly SameSite=strict cookie holding a JWT (12 h), token version for instant revocation, bcrypt(12), login throttling, anti-CSRF header | no tokens in localStorage |
| Authorisation | permission codes per role (DB-driven), checked in API middleware *and* hidden in UI | |
| Web | React + TS + Vite, Tailwind, TanStack Query/Table, React Router, lucide icons, Recharts | fast tables, caching, charts |
| PDF | server-side: **Playwright/Chromium printing HTML templates** (A4) | pixel-perfect PR/PO/GRN with pictures & logo |
| Excel | ExcelJS (import + export, embedded images) | also reads pictures from future `.xlsx` |
| Images | `StorageDriver` interface → `LocalDriver` (`storage/images`) now, `S3Driver` later; `sharp` makes thumbnails | |
| Tests | Vitest (unit), Supertest (API against a real Postgres), Playwright (acceptance scenario) | |

All secrets/config via `.env` (`DATABASE_URL`, `JWT_SECRET`, `STORAGE_DRIVER`, `COMPANY_*`…); `.env.example` only in git.

## 3. Core design rules

1. **Source is immutable.** `source-data/original/` is read-only, checksummed; every imported record links to `source_records` (page/table/row + raw JSON).
2. **Inventory = ledger.** `inventory` balances change only by inserting `inventory_transactions` in the same DB transaction (with `SELECT … FOR UPDATE`). Transactions, approvals, source records and audit rows are insert-only (database triggers reject UPDATE/DELETE). CHECK constraints stop negative stock and over-receipt.
3. **Document numbers** come from `document_sequences` via `INSERT … ON CONFLICT DO UPDATE SET last_value = last_value + 1 RETURNING` inside the document's transaction → no duplicates and no gaps under concurrency (tested with 60 simultaneous PRs); a unique index is the final guard. Numbers restart per year: `PR-2026-000001`. Also used for ISS/RET/ADJ/TRF stock documents and SUP supplier IDs.
4. **Frozen history.** PR/PO lines snapshot description, spec, price, supplier details. Editing a part or supplier never changes old documents. Purchase history is read from PO lines + GRN receipts.
5. **No silent edits after submit.** PR is editable only in DRAFT (or when returned by an approver). APPROVED/CONVERTED documents are locked; changes require cancel + new document, and everything is in the audit log (old/new JSON, user, IP, user-agent).
6. **Server is the source of truth for totals** (computed in `Decimal`, never floats).

## 4. Workflows

### Request cart → PR
The cart is stored server-side per user (`cart_items`, survives logout and device change). "Add to request" adds/merges a line (part, qty, required date, reason, equipment/machine, project, notes). "Create PR" assigns the number and asks for header data; "Submit" locks it and starts the workflow.

### Approval
`approval_workflows` per document type with ordered `approval_steps` (role per level; optional amount threshold so e.g. management only approves above X). Default:
`Requester → Store/Maintenance Manager → Procurement → Management → APPROVED`.
Each action writes `approvals` (user, time, action, comment) + audit. Reject ends; *Return* sends back to DRAFT for correction.

### PR → PO(s)
"Create PO" on an approved PR shows the lines grouped by preferred/selected supplier; one PO per supplier is created in one transaction (e.g. PR-2026-000001 → PO-2026-000034 (Supplier A) + PO-2026-000035 (Supplier B)). Partial conversion is supported via `qty_ordered`; PR becomes `CONVERTED_TO_PO` when fully ordered.
PO: DRAFT → APPROVED (`po.approve`) → SENT (PDF emailed or downloaded; `sent_at`) → PARTIALLY_RECEIVED → RECEIVED → CLOSED.

### Receiving (GRN)
Against an open PO: per line ordered / previously received / received now / rejected / remaining. Posting a GRN creates `RECEIPT` transactions (stock ↑ by accepted qty, unit cost from PO line) and updates `qty_received`. Receiving 8 of 10 leaves 2 open; a second GRN closes it. Over-receipt is blocked unless a permission allows tolerance.

### Issues / returns / adjustments / transfers
Store issues a part to a machine (stock ↓, linked to equipment → future maintenance cost), returns, stock-count adjustments with reason, transfers between locations/warehouses.

## 5. Roles → permissions (default, editable by ADMIN)

| Permission | ADMIN | STORE_MANAGER | REQUESTER | PROCUREMENT | APPROVER | VIEWER |
|---|---|---|---|---|---|---|
| View catalogue / stock | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ |
| Edit parts, upload images | ✔ | ✔ | | ✔ | | |
| Create/submit own PR | ✔ | ✔ | ✔ | ✔ | | |
| View all PRs | ✔ | ✔ | own only | approved + own | assigned + own | ✔ |
| Approve/reject PR (at own step) | ✔ | ✔ (manager step) | | ✔ (procurement step) | ✔ | |
| Create/send PO, manage suppliers | ✔ | | | ✔ | | |
| Receive goods, issue, adjust, transfer | ✔ | ✔ | | | | |
| Import / export / backup / users / settings | ✔ | | | | | |
| Audit log | ✔ | read | | read | read | |

## 6. Pages / modules

| Menu | Pages |
|---|---|
| **Dashboard** | KPI cards (Total parts, Low stock, Out of stock, Open PRs, Pending approvals, Open POs, Overdue POs, Purchase value) · charts: purchases by month / supplier / category, top parts, PO delivery status · date filter |
| **Machines** | Browse like the original book: machine → assembly → drawing (zoom) + CODE / PART NAME / PIECES / SPARE PART table |
| **Parts** | Catalogue (grid ⇄ table, global search, filters: category, manufacturer, supplier, equipment/machine, assembly, stock status, price range, location, critical) · Part details (image gallery + zoom, all fields, where-used/BOM, drawings, stock by location, purchase history & price stats, source reference, buttons: Add to request, Add to PR, History, Edit, Print) · Part edit · Browse by machine → assembly (drawing + table, like the original book) |
| **Inventory** | Stock list with status · Transactions ledger · Issue · Return · Adjustment · Transfer · Low-stock / reorder report · Warehouses & locations |
| **Requests / PR** | My cart · PR list · PR detail (lines with pictures, totals, approval timeline) · Approval inbox |
| **Purchase orders** | PO list · Create from PR (grouped by supplier) · PO detail/edit (DRAFT) · PDF / Excel / Print · Mark sent |
| **Receiving** | Open POs to receive · GRN create · GRN list/detail/print |
| **Suppliers** | List · Detail (+ history: POs, parts, total value, average price, last purchase) · Supplier parts & prices |
| **Reports** | Purchase history, spend by supplier/category/machine, inventory valuation, catalogue print — each exportable to Excel / CSV / PDF |
| **Users** | Users, roles, permission matrix |
| **Settings** | Company profile & logo, currency, tax rate, numbering, approval workflow, PO terms, Import wizard (+ original workbook status), Backup & restore |
| **Audit log** | Filter by user / document / action / date, old vs new diff |

UI: desktop-first responsive layout, left navigation (collapsible → bottom bar on mobile), toast notifications, confirm dialogs for destructive actions, skeleton loaders, empty and error states on every list.

## 7. Search

`parts.search_text` = part number, aliases (all source spellings), name, description, spec, manufacturer, brand, model, category, equipment & assembly names, supplier names and supplier part numbers — rebuilt on change. Queries use:
1. every word must match (`ILIKE`, trigram-indexed); exact / prefix part-number matches rank first (`1001286` → `E1001286`),
2. only when nothing matches literally, a typo-tolerant `pg_trgm` word-similarity search runs (`pnuematic` → PNEUMATIC parts),
3. original workbook spellings are aliases, so `PENEUMATIC` still finds E19778,
4. filters applied in SQL, paginated, debounced in the UI.

`ELKON` finds all parts because ELKON is set as manufacturer for all imported codes (confirm).

## 8. Data safety

- `storage/backup/`: `pg_dump` custom-format + images tarball, triggered from Settings or cron; restore via admin page (to a *new* DB first, then switch) or CLI script.
- `storage/imports/`: every uploaded import file kept with checksum and the import report.
- `storage/exports/`: generated files (auto-cleanup policy configurable).
- `source-data/`: original + extraction outputs, version-controlled.

## 9. Built to extend

Company → Branch → Warehouse/Equipment hierarchy already in the schema (multi-company/branch/warehouse); equipment table ready for maintenance & fleet linkage; `part_number` / `item_code` ready for barcode/QR labels; API-first design for a mobile app; approval engine generic by `doc_type` (RFQ, quotations, POs); PO/GRN carry currency, exchange rate and tax for accounting export.
