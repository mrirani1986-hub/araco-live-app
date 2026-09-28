# 04 — Operations & testing

## Configuration (environment variables, `apps/api/.env`)

| Variable | Purpose |
|---|---|
| `DATABASE_URL` | PostgreSQL connection (the user must own the database; `pg_trgm` is created by the migration) |
| `JWT_SECRET` | Session signing secret, ≥ 32 random characters (enforced in production) |
| `SESSION_HOURS` | Session length (default 12) |
| `ADMIN_USERNAME`, `ADMIN_PASSWORD`, `ADMIN_FULL_NAME` | First administrator — created only when the database has no users |
| `STORAGE_DIR` | Pictures, imports, exports, backups (default `spare-parts/storage`) |
| `CHROMIUM_PATH` | Chromium for server-side PDFs |
| `PG_BIN_DIR` | Folder with `pg_dump` / `pg_restore` 16 for backups |
| `CORS_ORIGIN` | Only needed when the web app is served from another origin |

No secret is hard-coded; `.env` files are git-ignored.

## Storage layout

```
storage/
  images/drawings/   workbook pictures (original + oriented display copy), uploaded drawings
  images/parts/      uploaded part photos (JPG/PNG/WEBP, validated by content)
  images/thumbs/     480 px webp thumbnails
  images/company/    logo
  imports/           every uploaded Excel file, unchanged
  backup/            backup_YYYYMMDD_HHMMSS/{database.dump, files.tar.gz, manifest.json}
```
File names are SHA-256 hashes, so identical files are stored once and never overwritten. The storage driver is an
interface (`apps/api/src/lib/storage.ts`); an S3-compatible driver can be added without touching the rest of the code.

## Backup & restore

- **Settings → Backup & restore → Create backup now** (or `POST /api/backups`). Schedule it with cron, e.g.
  `curl -X POST -H 'x-requested-with: araco-sp' -b cookie.txt https://host/api/backups`, or run `pg_dump` directly.
- Restore requires typing the backup name; a safety backup of the current state is taken first, so a restore can be undone.
- Download the `database.dump` / `files.tar.gz` and keep copies off the server.

## Roles

ADMIN (everything) · STORE_MANAGER (inventory, receiving, issues, 1st approval) · REQUESTER (catalogue, cart, own PRs) ·
PROCUREMENT (suppliers, POs, approved PRs, 2nd approval) · APPROVER (management approval, PO approval) · VIEWER (read-only).
The permission matrix can be changed in **Users → Role permissions**; approval levels in **Settings → Approval workflow**.

## Continuous integration

`.github/workflows/spare-parts.yml` runs on every pull request and push to `main` that touches `spare-parts/`:
typecheck → API integration tests (PostgreSQL 16 service) → build → start the compiled app on a fresh database with the
workbook imported → browser acceptance scenario → page smoke test. Screenshots and the app log are uploaded as the
`spare-parts-e2e` artifact.

## Test results (2026-09-28)

### API integration tests — `npm test` → **45 / 45 passed**

Run on a freshly reset `araco_spares_test` database with the real workbook imported (254 parts, 289 rows, 34 drawings).

| File | Covers |
|---|---|
| `acceptance.test.ts` | Section 30 scenario 1–20 through the HTTP API: search, part + picture + specs, qty 10 to cart, 2 more parts, PR number, submit (locked), 3-level approval (wrong role refused), 2 POs grouped by supplier, PO PDF + Excel, approve/send, over-receipt refused, receive 8 (stock +8, 2 remaining, PARTIALLY_RECEIVED), receive 2 (stock 10, RECEIVED), purchase history with 2 receipts and price statistics, audit trail for PR/PO/GRN, audit rows and ledger cannot be modified in the database |
| `concurrency.test.ts` | 60 parallel PRs → 60 unique consecutive numbers; failed transaction releases its number; 100 parallel allocations unique; 15 parallel issues against 10 in stock → exactly 10 succeed, stock never negative, ledger = balance; 8 parallel receipts on a 5-unit PO line → exactly 5 |
| `permissions.test.ts` | anonymous/bad password/missing CSRF header refused; weak passwords refused; deactivated user loses access immediately; each role's allowed/forbidden actions; own-PR visibility; self-approval blocked; reject needs a comment; return → edit → audited old/new values |
| `data.test.ts` | every workbook row/code/name/quantity present with provenance; 34 pictures byte-identical to the workbook; import idempotent and original file unchanged; data-quality flags; Excel import wizard (new/existing/duplicate/error detection, correction, *fill empty* does not overwrite, stock via ledger); exports xlsx/csv/pdf for parts, inventory, suppliers, PRs, POs, GRNs, audit, reports; CSV formula injection neutralised; literal + typo-tolerant search; validation/404/path traversal/non-image upload errors; multi-picture upload with thumbnails; backup → change → restore (change gone, safety backup kept) |

### Browser acceptance scenario — `npm run e2e` → **passed**

Real Chromium against the production build, five different users, on a fresh database:
`PR-2026-000001 → PO-2026-000001`, 20/20 steps. Screenshots: `docs/screenshots/01…20-*.png`, generated PO PDF:
`docs/screenshots/PO-2026-000001.pdf`.

### Page smoke test — `npm run e2e:smoke` → **passed**

All 23 pages/tabs load as administrator without JavaScript errors, 5xx responses or error states; inventory,
part, supplier dialogs and the role matrix open.

## Known limitations / next steps

- Prices, suppliers, stock and locations are **not in the workbook**; they start empty and are entered or imported.
- Recommended spares are applied to minimum stock only when an administrator confirms (Inventory → Suggested minimum stock).
- Excel's picture effects (sharpen/brightness) are not re-applied; the pictures are shown as stored, with Excel's rotation.
- Part-level photos: the workbook only has assembly drawings; upload photos per part on the part page.
- Reserved stock is tracked in the schema but no module reserves stock yet (issues post directly).
- Multi-currency totals are shown per currency; there is no exchange-rate conversion in reports.
- The existing ARACO fleet app is untouched; linking vehicles to `equipment` is a possible next step.
