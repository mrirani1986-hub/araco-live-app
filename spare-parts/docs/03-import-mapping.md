# 03 — Import mapping (source → database)

Status: **implemented** — `npm run import:source` (idempotent; refuses to run on a changed workbook until it is re-extracted).

Input: `source-data/extracted/workbook/rows.json` + `images.json` (produced read-only from the original workbook by
`tools/extract_source_xlsx.py`); the pictures are read straight out of the .xlsx and checked against their SHA-256. The 2021 PDF rows
(`extracted/pdf-2021/`) are attached to each source record for comparison. The import is idempotent (keyed on the source SHA-256 +
`source_ref`) and runs in a single DB transaction; it shows a preview and needs confirmation.

## 1. Field mapping

| Source | Target | Rule |
|---|---|---|
| whole file | `source_files` | name, SHA-256, stored path |
| every row | `source_records` | `source_ref` (`MIXER!A45`), raw JSON of all cells + the matching 2021 PDF values — **verbatim, append-only** |
| page title | `equipment.name` / `code` | 10 machines, e.g. `TWINSHAFT MIXER` → code `TWINSHAFT-MIXER` |
| group caption / inferred name | `assemblies.name`, `name_inferred` | 28 assemblies; inferred names flagged |
| caption code `(E18252)` | `assemblies.assembly_part_id` | parent/child BOM link |
| `CODE` | `parts.part_number` | exact text, unique; first occurrence creates the part |
| `PART NAME` | `parts.name` | proposed cleaned name (see §3); **all** original spellings → `part_aliases` |
| `PART NAME` | `part_usages.name_in_source` | exact text of that row |
| `PIECES` | `part_usages.installed_qty` + `installed_unit` | parsed number + unit (PC/PS → PCS); raw text stays in `source_records` |
| `SPARE PART` | `part_usages.recommended_spare` + unit | per usage; blank → NULL; `ALL` → installed quantity; bare number → unit of PIECES |
| SPARE PART present | `parts.is_critical = true` | the workbook no longer has highlighting; a recommendation in any machine marks the part (48 parts) |
| — | `parts.unit` | unit of the first usage (PCS/SET/M) |
| — | `parts.manufacturer_id` | ELKON *(to confirm)* |
| picture (PNG) | `part_images` (`kind=DRAWING`, `assembly_id`) | original bytes → `storage/images/drawings/<sha256>.png` (`original_key`); Excel rotation/flip applied to a display copy (`storage_key`) + webp thumbnail; `source_ref="MIXER!A5 (Picture 1, xl/media/image1.png)"` |
| Σ `recommended_spare` over usages | *suggested* `inventory.min_stock` | shown as suggestion only — applied after admin confirmation |
| — | category, description, spec, brand, model, supplier, price, currency, stock, location, notes | **left empty** (not in source) — no dummy values |

### Proposed categories (auto-suggested from the name, admin can change; nothing is lost if wrong)

Bearings & housings · Seals & O-rings · Belts, pulleys & chains · Pneumatics (valves, coils, pistons, air service) · Hydraulics & lubrication · Electrical & sensors (load cells, proximity switches, motors, control panel) · Gearboxes & drives · Wear parts (linings, paddles, scrapers, idlers) · Hoses, clamps & fittings · Structural & covers · Filters. Proposal is shown in the import preview; parts without a confident match stay uncategorised.

## 2. Resulting record counts (verified by the test suite)

| Table | Rows |
|---|---|
| source_records | 289 ✔ |
| equipment | 10 ✔ |
| assemblies | 28 ✔ |
| parts | 254 (252 codes + E22667, E1001393 created from captions) ✔ |
| part_usages | 289 ✔ |
| part_aliases | 264 ✔ (one per distinct code + spelling) |
| part_images (drawings) | 34 ✔ (21 shown rotated as in Excel) |
| suppliers / prices / stock | 0 — imported later from separate files |

## 2b. IMER / ORU spare-parts books (one plant per book)

Books: `CR_LIBANO_74_2010.pdf` (S/N 10090213), `CR_PDF_LIBANO_76.pdf` (S/N 11010013), `CR_PDF_LIBANO_77.pdf`
(S/N 11060151), `CR_LIBANO79.pdf` (S/N 12010006). The rules below were written for book 74; books 76 and 77 use the same
layout (76 prints `Q.TE` and, on the pan-mixer pages, the quantity before the description; the reader takes the column
order from each table's header). Book 79 uses a multilingual layout, see the end of this section.

### Book 74 (reference)

Extracted by `tools/extract_imer_catalogue.py` (PyMuPDF word positions; most tables are printed sideways), imported by
`apps/api/src/import/imer.ts` right after the workbook (same idempotency rule, keyed on the PDF's SHA-256).

| Source | Target | Rule |
|---|---|---|
| whole file | `source_files` (`kind=PDF`) | name, SHA-256, plant model, serial number, publisher |
| every table line | `source_records` | `source_ref` = `IMER-10090213 p<page> L<line>` (gearboxes: `… ref <n> (transcribed)`), raw cells verbatim |
| cover page | `equipment` `IMER-10090213` | name *IMER LOGIK 2WXL 4/10 (S/N 10090213)*, model, **serial number**, manufacturer *IMER (ORU)*, the book's ordering rule as notes |
| section heading (`8 - PNEUMATIC UNIT COMPONENTS`) | `assemblies.name` | 22 sections (3–24); printed notes, "part of the twin-shaft mixer MD 5000/3350" and gearbox list numbers → `assemblies.notes` |
| POS. | `part_usages.position` | `9/1` kept as printed; a `-` or empty position = alternative for the position above (issue `alternative_for_position`) |
| CODE | `parts.part_number` | one part per code (363); existing codes are **linked, never changed** |
| DESCRIPTION | `parts.name` (upper case, longest wording) + `part_aliases` (every wording) + `part_usages.name_in_source` | |
| Q.TY | `part_usages.installed_qty` / `installed_raw` | `m` → unit `M` (per metre), quantity empty |
| line without code (`-`, `/`) or kit component lines | `assembly_info_lines` | shown greyed with *No code — not sold separately* / *Included in pos. 3*; cannot be added to a request |
| `#` in the gearbox lists | `recommended_spare` = quantity, `recommended_raw='#'`, `parts.is_critical` | "recommended for stock" |
| drawing pages | `part_images` (`kind=DRAWING`) | rendered 150 dpi PNG, upright; `source_ref` names the page |

Counts: 468 source records · 22 assemblies · 363 parts · 445 usages · 21 info lines (2 printed `- - -` placeholder rows
are kept in `source_records` only) · 22 drawings. Nothing on pages 1–4 and 49–52 (cover, contents, ordering example,
warranty forms) is a parts line; those pages stay in the stored PDF.

**Book 79 (multilingual layout):** `Rif. | Cod. | Descrizione (I) | F | GB | E | D | Note`, no quantity column. The GB
description + note is the display wording; all five languages stay in `source_records`, and the Italian name is added as
a searchable alias. Rows printed with a yellow background get the usage issue `highlighted_in_book` and are shown yellow;
the book does not say what the colour means, so it is **not** turned into a recommended spare.

**Shared parts:** a code already imported from another book (or the ELKON workbook) is linked to the new plant and keeps
its name and data; the new wording is added as an alias.

**Plants added by hand:** if a plant with the book's serial number was already created with *Add another plant of this
model*, it is not touched; the book's plant is created next to it (code `IMER-<serial>-BOOK`) and both get a note.

**Other plants of the same model:** `POST /api/equipment/:id/copy` (Machines → *Add another plant of this model*) copies
sections, positions, info lines and drawings to a new equipment record with its own serial number (`copied_from_id`).

## 2c. DT Spare Parts catalogue for MAN TGA/TGS/TGX, TGL/TGM

The 790 pages are scanned pictures. `tools/extract_dt_catalogue.py` reads them with tesseract OCR:

| Source | Target | Rule |
|---|---|---|
| each catalogue file (16 × ≤ 50 pages) | `source_files` | imported file by file; a recorded file is never imported again (later files can be added) |
| item | `source_records` (`DT-MAN p121 #1`) | all read values + quality flags, verbatim |
| QR code under the DT number (`http://dtpi.de/?id=4.40097`) | `parts.part_number` | 96% confirmed by QR; otherwise the printed number (flag `DT_NUMBER_FROM_OCR`) |
| EN description (located by the grey language tags) | `parts.name` (upper case) + alias; DE description → alias | |
| Suitable for | `parts.description` ("Suitable for D 2866, D 2876") | |
| Details | `parts.specification` | |
| Replaces (`MAN: 51.02500.6023 S1`, `Mahle: 229 04 00`) | aliases (`51.02500.6023`, `51025006023`, `MAN 51.02500.6023`) + `parts.notes` | for comparison only — not for invoices (catalogue rule) |
| part photo | `part_images` (`PHOTO`, primary) | cut from the page, max 320 px |
| section (from the "List of Contents", page 33, by page range) | `assemblies` of equipment `DT-MAN-TG` | 94 sections, main group in the notes |

Every part carries `TEXT_FROM_OCR`. The MAN-number index (pages 41–61) is read too and confirms 2,150 of 2,550 MAN numbers;
spot checks of the others showed the item's own number correct (the index OCR misses rows), so no flag is set for them.

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
