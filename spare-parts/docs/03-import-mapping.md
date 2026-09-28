# 03 — Import mapping (source → database)

Status: **proposal.** The import has not been run.

Input: `source-data/extracted/rows.json` + `images.json` (produced read-only from the original by
`tools/extract_source_pdf.py`). The import is idempotent (keyed on the source SHA-256 +
`source_ref`) and runs in a single DB transaction; it shows a preview and needs confirmation.

## 1. Field mapping

| Source | Target | Rule |
|---|---|---|
| whole file | `source_files` | name, SHA-256, stored path |
| every row (incl. blank) | `source_records` | `source_ref` (`p3.t0.r6`), page, table, row, raw JSON — **verbatim** |
| page title | `equipment.name` / `code` | 10 machines, e.g. `TWINSHAFT MIXER` → code `TWINSHAFT-MIXER` |
| group caption / inferred name | `assemblies.name`, `name_inferred` | 28 assemblies; inferred names flagged |
| caption code `(E18252)` | `assemblies.assembly_part_id` | parent/child BOM link |
| `CODE` | `parts.part_number` | exact text, unique; first occurrence creates the part |
| `PART NAME` | `parts.name` | proposed cleaned name (see §3); **all** original spellings → `part_aliases` |
| `PART NAME` | `part_usages.name_in_source` | exact text of that row |
| `PIECES` | `part_usages.installed_qty` + `installed_unit` | parsed number + unit (PC/PS → PCS); raw text stays in `source_records` |
| `SPARE PART` | `part_usages.recommended_spare` + unit | per usage; blank → NULL |
| yellow highlight | `parts.is_critical = true` | if highlighted in any usage |
| — | `parts.unit` | unit of the first usage (PCS/SET/M) |
| — | `parts.manufacturer_id` | ELKON *(to confirm)* |
| drawing JPEG | `part_images` (`kind=DRAWING`, `assembly_id`) | copied to `storage/images/drawings/<sha256>.jpeg`; `source_ref="pdf xref N, page P"` |
| Σ `recommended_spare` over usages | *suggested* `inventory.min_stock` | shown as suggestion only — applied after admin confirmation |
| — | category, description, spec, brand, model, supplier, price, currency, stock, location, notes | **left empty** (not in source) — no dummy values |

### Proposed categories (auto-suggested from the name, admin can change; nothing is lost if wrong)

Bearings & housings · Seals & O-rings · Belts, pulleys & chains · Pneumatics (valves, coils, pistons, air service) · Hydraulics & lubrication · Electrical & sensors (load cells, proximity switches, motors, control panel) · Gearboxes & drives · Wear parts (linings, paddles, scrapers, idlers) · Hoses, clamps & fittings · Structural & covers · Filters. Proposal is shown in the import preview; parts without a confident match stay uncategorised.

## 2. Resulting record counts (dry-run expectation)

| Table | Rows |
|---|---|
| source_records | 291 |
| equipment | 10 |
| assemblies | 28 |
| parts | 254 (252 codes + E22667, E1001393 created from captions) |
| part_usages | 289 |
| part_aliases | 264 (one per distinct code + spelling) |
| part_images (drawings) | 34 |
| suppliers / prices / stock | 0 — imported later from separate files |

## 3. Name clean-up proposal (display name only)

| Rule | Example |
|---|---|
| Spelling fixes from `01-source-analysis.md §4.4` | `PENEUMATIC VALVE` → `PNEUMATIC VALVE` |
| When one code has several wordings, use the longer / more specific | E1006768 → `TWO PIECE AIR SERVICE UNIT` |
| Unclear names kept unchanged + review flag | E19846 `PN` |

## 4. Validation in the import wizard (also used for future Excel imports)

1. Required: part number, name. Missing → error row, not imported until corrected in the preview grid.
2. Part number already in DB → shown as *existing*: choose **skip**, **add as new usage/alias**, or **update empty fields only**. Overwriting a non-empty value requires an explicit per-field confirmation and is audited. Never silent.
3. Duplicate within the file → grouped and shown together.
4. Quantities/units parsed; unparseable values flagged with the raw text.
5. Summary: new / existing / warnings / errors → **Confirm import** → report saved in `storage/imports/`.

## 5. Later imports (templates supplied as .xlsx)

| Template | Key | Columns |
|---|---|---|
| Parts | Part Number | Item Code, Name, Description, Category, Subcategory, Manufacturer, Brand, Model, Equipment, Specification, Unit, Notes, Image file name |
| Suppliers | Supplier name + tax no. | Company, Contact, Phone, Email, Address, Country, Currency, Payment/Delivery terms, Tax No., Notes |
| Supplier prices | Supplier + Part Number | Supplier Part No., Price, Currency, Lead time, Preferred |
| Opening stock | Part Number + Warehouse + Location | On hand, Min, Max, Reorder level, Unit cost |

Opening stock is posted as `ADJUSTMENT` transactions (reason "Opening balance") so the ledger is complete from day one.
