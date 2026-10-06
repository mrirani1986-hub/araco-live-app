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

## Currency

The company currency is **USD** (Settings → Company → Currency). New parts, suppliers and supplier prices without a
currency get the company currency; purchase requisitions use it; purchase orders use the supplier's currency. Changing
the setting does not convert amounts that were already entered. The migration `currency_usd` switched the setting and every
record **without an amount** from SAR to USD; prices and documents already entered keep their currency.

## Companies

The main company (the first one, **ARACO READY MIX**) is edited in **Settings → Company & documents**. Other companies are
added in **Settings → Other companies** (name, address, phone, email, VAT number, logo); the migration `second_company`
added **Skyline Contracting** to the existing installation. When there is more than one company, the request cart, the PR
edit form and *New PO* ask which company the document is for (default: the main company); a PO created from a PR is always
for the PR's company. The PR, PO (PDF and Excel) and GRN print that company's letterhead, and the PR and PO lists can be
filtered by company. Parts, stock, suppliers, approval workflow and document numbering are shared by all companies.
Existing PRs and POs were assigned to the main company.

## Trucks

The MAN trucks are listed in `source-data/fleet/man-trucks.json`, transcribed from the photos of their type plates
(`source-data/original/fleet`). At start-up each truck not yet in the app (matched by VIN) is added under **Machines → MAN**
as its own machine with a copy of the DT catalogue, so a part requested from that page is recorded for that truck. Add the
plate/fleet number and location with **Edit**. More trucks: add them to the JSON file (or use **Copy plant** on the DT
catalogue with the VIN as the serial number).

Each truck has a **model series** (TGA/TGS…), **MAN type code** (VIN characters 4-6) and **engine** (from the engine plate;
not on the type plate, so empty until entered with **Edit**). The truck page marks every DT part from the catalogue's
"Suitable for" text: **Fits** (its series, or its type code where the catalogue restricts a part to type codes, or
universal), **Check engine** (the catalogue names engines only — sorted once the engine is set), **Other model**
(hidden unless *Show all*), **Model not given**. With the type plates alone: TGA HW3 1,514 fit / 788 check engine / 280
other models; TGS 39W 1,244 / 788 / 550 (13 lines have no model in the catalogue).

## Rebuild speed

The Dockerfile pins the Node base image by digest (`NODE_IMAGE`), so a rebuild after `git pull` reuses the installed
system packages (Chromium, PostgreSQL client) and production packages; only the changed app code is rebuilt (a few
minutes). To update the base image on purpose, change
the digest in `NODE_IMAGE`.

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

### API integration tests — `npm test` → **65 / 65 passed**

Run on a freshly reset `araco_spares_test` database with the real workbook (254 parts, 289 rows, 34 drawings) and the four
IMER books (1,894 lines, 89 drawings) imported.

| File | Covers |
|---|---|
| `acceptance.test.ts` | Section 30 scenario 1–20 through the HTTP API: search, part + picture + specs, qty 10 to cart, 2 more parts, PR number, submit (locked), 3-level approval (wrong role refused), 2 POs grouped by supplier, PO PDF + Excel, approve/send, over-receipt refused, receive 8 (stock +8, 2 remaining, PARTIALLY_RECEIVED), receive 2 (stock 10, RECEIVED), purchase history with 2 receipts and price statistics, audit trail for PR/PO/GRN, audit rows and ledger cannot be modified in the database |
| `companies.test.ts` | second company added (duplicate name and non-admin refused, audited); editing it; saving the main company settings does not rename it; PR from the cart for the chosen company (unknown company refused, default = main); PR/PO lists filtered by company; PO from the PR is for the PR's company; manual PO for a chosen company; letterhead per company |
| `concurrency.test.ts` | 60 parallel PRs → 60 unique consecutive numbers; failed transaction releases its number; 100 parallel allocations unique; 15 parallel issues against 10 in stock → exactly 10 succeed, stock never negative, ledger = balance; 8 parallel receipts on a 5-unit PO line → exactly 5 |
| `permissions.test.ts` | anonymous/bad password/missing CSRF header refused; weak passwords refused; deactivated user loses access immediately; each role's allowed/forbidden actions; own-PR visibility; self-approval blocked; reject needs a comment; revise an approved PR (reason required, requester/admin only, back to draft, version +1, audited, all approvals again); return → edit → audited old/new values |
| `data.test.ts` | SANY upper-structure book: added to the same mixer truck (no second machine, model/notes updated and audited), all 747 lines after the chassis sections, 84 sections, 89 drawings, "-" descriptions flagged; SANY pump book: all 3,670 lines incl. colour remarks, colour variants as alternatives, 223 sections, 340 drawings, parts shared with the mixer book linked once; SANY mixer book: all 2,394 lines with source ref, part no., index, wording and qty in book order, 191 sections, 266 drawings, sub-assembly links, leaf spring printed twice, search by SANY number, PDFs unchanged, import not repeated; which parts fit which truck: "Suitable for" text with series, MAN type codes, engines, universal, OCR `TGU`; every truck line finds its catalogue text; engine sorts engine-specific parts; MAN trucks: each truck from the type plates is a machine with VIN, type and a full copy of the DT catalogue, never imported twice; DT catalogue: every item imported with DT number, section, MAN numbers as aliases, OCR flag; ≥ 95% of DT numbers confirmed by QR code; search by MAN number with and without dots; photo; file-by-file import never repeated; books 76/77/79: every line present with code, wording, position, plant and yellow highlighting, drawings per plant, shared parts linked across plants, gearbox transcription reused only for identical scans, Italian names searchable; every IMER book line present with page, position, code, wording and quantity; transcribed gearbox parts flagged, `#` spares, left/right gearbox difference; info-only lines; 22 drawings; PDF unchanged and import idempotent; copy to another plant (serial required/unique, viewer refused, identical sections/positions/drawings); every workbook row/code/name/quantity present with provenance; 34 pictures byte-identical to the workbook; import idempotent and original file unchanged; data-quality flags; Excel import wizard (new/existing/duplicate/error detection, correction, *fill empty* does not overwrite, stock via ledger); exports xlsx/csv/pdf for parts, inventory, suppliers, PRs, POs, GRNs, audit, reports; CSV formula injection neutralised; literal + typo-tolerant search; validation/404/path traversal/non-image upload errors; multi-picture upload with thumbnails; backup → change → restore (change gone, safety backup kept) |

### Browser acceptance scenario — `npm run e2e` → **passed**

Real Chromium against the production build, five different users, on a fresh database:
`PR-2026-000001 → PO-2026-000001`, 20/20 steps. Screenshots: `docs/screenshots/01…20-*.png`, generated PO PDF:
`docs/screenshots/PO-2026-000001.pdf`.

### Page smoke test — `npm run e2e:smoke` → **passed**

All 23 pages/tabs load as administrator without JavaScript errors, 5xx responses or error states; inventory,
part, supplier dialogs and the role matrix open; the IMER plant shows its serial number, sections and info-only lines,
and the *Add another plant* / *Edit* dialogs open. Screenshots: `docs/screenshots/21-imer-plant.png`,
`22-imer-positions-and-kits.png`.

## Known limitations / next steps

- Prices, suppliers, stock and locations are **not in the workbook**; they start empty and are entered or imported.
- Recommended spares are applied to minimum stock only when an administrator confirms (Inventory → Suggested minimum stock).
- Excel's picture effects (sharpen/brightness) are not re-applied; the pictures are shown as stored, with Excel's rotation.
- Part-level photos: the workbook only has assembly drawings; upload photos per part on the part page.
- Book 79's yellow rows are shown yellow but not treated as recommended spares (the book has no legend).
- IMER gearbox lists (sections 21–23 of books 74 and 77) were typed from scanned pages; check those codes against the drawing before the
  first order (the parts carry the review flag). The other IMER pages are read from the PDF text.
- Reserved stock is tracked in the schema but no module reserves stock yet (issues post directly).
- Multi-currency totals are shown per currency; there is no exchange-rate conversion in reports.
- The existing ARACO fleet app is untouched; linking vehicles to `equipment` is a possible next step.
