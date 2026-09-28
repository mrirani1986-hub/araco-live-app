# 01 — Source analysis & data-quality report

Status: **analysis only. Nothing has been imported, cleaned, merged or deleted.**

## 1. What was received

| Item | Value |
|---|---|
| File | `SPARE_PART_LIST.pdf` (copied read-only to `source-data/original/`) |
| SHA-256 | `73bf6c035735ec1a2e25e663f23da0205af8caf5107d8da9e1b12038ba98b9d7` (see `SHA256SUMS`) |
| Produced by | Microsoft Excel 2016 → "Save as PDF", author *Maheen*, 2021-03-26 11:32 (+03:00) |
| Pages | 26 (US Letter), one worksheet print area per page range |
| Title | **TWINSHAFT MIXER SPARE PART LIST** (ELKON batching plant; ELKON logo visible on the drawings) |

> **Important:** the upload is the PDF *printout* of the workbook, not the `.xlsx` itself.
> A PDF only contains the printed area: hidden columns, hidden sheets, cell comments,
> formulas and per-cell pictures outside the print area are not in it. Everything
> below was extracted from the PDF. If the original `.xlsx` exists, please upload it —
> the extractor will be extended to read it and the results compared against this report.

## 2. Structure of the document

Every page follows the same pattern:

```
[ section title, e.g. "CEMENT SILO SPARE PART LIST" ]      (on first page of a machine)
[ exploded-view drawing(s) with E-code call-outs ]          (embedded JPEG)
[ group caption, e.g. "DRIVING GROUP" / "BARE PUMP (E75941)" ]  (sometimes)
┌──────┬───────────┬────────┬────────────┐
│ CODE │ PART NAME │ PIECES │ SPARE PART │   ← yellow row = recommended spare
└──────┴───────────┴────────┴────────────┘
```

### Columns found (the only four columns in the whole document)

| Column | Meaning (as interpreted) | Example |
|---|---|---|
| `CODE` | ELKON part number | `E1001286` |
| `PART NAME` | Short name, upper case | `V BELT` |
| `PIECES` | Quantity **installed** in that machine/assembly + unit (printed red on 248 of 289 rows) | `12 PCS` |
| `SPARE PART` | **Recommended spare quantity** to hold in store (blank = none) | `24 PC` |
| Row fill yellow | Row flagged as recommended/critical spare | 90 rows |

### Implicit fields (derived from layout, not from a column)

| Field | Where it comes from |
|---|---|
| Equipment / machine | page title ("TWINSHAFT MIXER", "CEMENT SILO", …) |
| Assembly / group | caption under the drawing ("DRIVING GROUP"); inferred from drawing "Fig." labels where no caption exists (flagged `group_inferred=true`) |
| Parent assembly code | caption code, e.g. "BEARING (IDLE SIDE) GROUP **(E18252)**" → BOM parent/child |
| Manufacturer | ELKON (logo on drawings, E-code scheme) — **not stated per part** |
| Unit | suffix of the PIECES/SPARE values: `PCS`, `SET`, `M` |
| Picture | assembly drawing above the table |

### Fields requested but **not present anywhere in the source**

Item code (separate from part number) · Description (beyond the short name) · Category/Subcategory ·
Brand · Model · Specification · Existing / Min / Max stock · Supplier · Supplier part number ·
Cost · Currency · Location · Notes.

These will be created as empty columns in the application (no dummy values) and can be filled
by a later Excel import (price list, supplier list, stock count) or by hand.

## 3. Totals

| Metric | Count |
|---|---|
| Table rows (excluding headers) | 291 |
| Blank table rows | 2 (`p6.t0.r4`, `p16.t0.r8`) |
| Part rows | 289 |
| **Unique part codes** | **252** |
| Codes listed more than once | 36 |
| Rows highlighted yellow | 90 (87 unique codes) |
| Rows with a spare-part quantity | 87 |
| Embedded pictures | 34 (all JPEG, extracted losslessly) |
| Machines | 10 |
| Assemblies / groups | 28 tables, each mapped to a group |

### Per machine

| Machine | Pages | Groups | Rows | Unique codes | Highlighted codes |
|---|---|---|---|---|---|
| TWINSHAFT MIXER | 1–9 | 10 | 96 | 83 | 19 |
| CEMENT WEIGHING BATCHER | 10–11 | 2 | 19 | 19 | 10 |
| WATER WEIGHING BATCHER | 12–13 | 1 | 21 | 21 | 8 |
| ADDITIVE WEIGHING BATCHER | 14 | 1 | 19 | 19 | 4 |
| INLINE SILO | 15 | 1 | 8 | 8 | 7 |
| WEIGHING CONVEYOR | 16–17 | 2 | 19 | 19 | 13 |
| TRANSFER CONVEYOR | 18–19 | 2 | 24 | 24 | 11 |
| COMPRESSOR | 20–21 | 3 | 30 | 30 | 8 |
| CEMENT SCREW | 22–23 | 2 | 32 | 32 | 4 |
| CEMENT SILO | 24–26 | 4 | 21 | 21 | 6 |

The full row-level extraction (with `source_ref` = page/table/row) is in
`source-data/extracted/rows.csv` and `rows.json`; all findings below are in
`source-data/extracted/data_quality.json`.

## 4. Data-quality findings

Nothing below has been "fixed". Each finding has a proposed handling rule for the import (see `03-import-mapping.md`).

### 4.1 Duplicate part codes (same code on several rows) — 36 codes

These are **not** errors in most cases: the same physical part is used in several machines/assemblies.
They will become **one part** with several *usages* (bill-of-materials rows), so no row is lost.

| Pattern | Codes |
|---|---|
| Shared between idle-side and driving-side bearing groups (p4/p5) | E18244, E1007058, E1007991, E18246, E18247, E1007057, E18245, E1007059, E18249, E18248, E18250, E1007056, E1003141 |
| Shared between Weighing conveyor (p16–17) and Transfer conveyor (p19) | E1000150, E1000814, E1008003, E29006, E67086, E8771, E27279, E27283 |
| Shared between the three weighing batchers | E1000052, E1000201, E1001498, E1007151, E19778, E41210, E43480, E43481, E61686, E62219, E62210 |
| Shared compressor / silo air components | E1005628, E1006349, E1006768 |
| Other | E1005844 (cement batcher vibrator & transfer conveyor vibrator) |

⚠️ **Please confirm:** page 19 (Transfer conveyor, 2nd half) repeats 7 codes of the Weighing
conveyor with near-identical quantities (32 chassis / 96 idlers). This is plausible (same conveyor
design) but could also be a copy-paste in the workbook.

### 4.2 Same code, different names — 12 codes

| Code | Names used | Type |
|---|---|---|
| E1000201 | PENEUMATIC VALVE COIL / PNEUMATIC VALVE COIL | spelling |
| E19778 | PENEUMATIC VALVE / PNEUMATIC VALVE | spelling |
| E61686 | PENUMATIC VALVECOIL / PNEUMATIC VALVE COIL | spelling |
| E62219 | PENUMATIC VALVE / PNEUMATIC VALVE | spelling |
| E1005844 | VIBERATOR / VIBRATOR | spelling |
| E41210 | EARTHING CABLE / EARTHING GABLE | spelling |
| E1005628 | WATER DRAINER / WATER CATCHER | wording |
| E1006349 | AIR LUBRICATOR / LUBRICATOR | wording |
| E1006768 | TWO PIECE AIR SERVICE UNIT / AIR SERVICE UNIT | wording |
| E27279 | TROUGHING IDLER / TROUGHING IDLER ROLLER | wording |
| E29006 | BELT CENTERING ROLLER / CONVEYOR GUIDE ROLLERS | wording |
| E8771 | TROUGHING IDLER CHASSIS / TROUGHING IDLER ROLLER CHASSIS | wording |

Handling: one part per code; the display name is proposed from the most complete spelling;
**every** original spelling is stored as an alias (searchable) and on its usage row.

### 4.3 Different codes, same name ("different names referring to the same part?")

Generic names occur under many different codes, e.g. `SEAL` (7 codes), `CLAMP` (6),
`THREADED STUD` (6), `BEARING` (5), `MAINTENANCE COVER` (5), `LOAD CELL` (4),
`PNEUMATIC VALVE` (4), `FIXING PLATE` (4), `BELLOW HOSE` (4), `BALL BEARING` (4) — 39 names in total.
Because the manufacturer gave them different codes they are **different parts** (different
size/spec). They will **not** be merged. Recommendation: add a specification (bearing
number, size, voltage…) to these parts later so they can be told apart. E1002653 and E1002654
(both PROXIMITY SWITCH, 2 installed / 4 spare each) are worth a check.

### 4.4 Spelling variants (kept as aliases, corrected display name proposed)

ACUATOR→ACTUATOR · DISTRUBITOR→DISTRIBUTOR · VIBERATOR→VIBRATOR · PENEUMATIC/PENUMATIC→PNEUMATIC ·
SAFTY→SAFETY · SELENOID→SOLENOID · GURD→GUARD (E23) · GABLE→CABLE · HUMMER LOCK→HAMMER LOCK ·
LOADCELL→LOAD CELL · ORING→O RING · VALVECOIL→VALVE COIL · WEARLINING→WEAR LINING ·
PULLGUARD→PULL GUARD · "SAPRE" in the compressor page title.
**Unclear:** `E19846 "PN"` (p7) — probably *PIN*; kept as "PN" and flagged for review.

### 4.5 Part-number format

- Format is `E` + digits for all 252 codes; lengths: 3 chars (1), 4 chars (12), 5 (1), 6 (139), 8 (99).
- Short codes (E23, E270, E363, E380, E384, E761, E894, E979, E981, E985, E987, E990, E993) are valid ELKON codes — kept exactly as printed.
- `E29028-1 … E29028-9`: sub-components of air filter E29028 using a suffix scheme found nowhere else. Kept verbatim; linked to parent E29028.
- No leading/trailing spaces or lowercase codes were found. Codes are stored **exactly as printed** (no zero-padding / reformatting).

### 4.6 Quantity problems (raw text always kept)

| Ref | Code | Column | Raw | Issue |
|---|---|---|---|---|
| p1.t0.r5 | E1000328 RUBBER | pieces | `--` | placeholder, highlighted but no spare qty |
| p11.t0.r13 | E41270 CLAMP | pieces | `----` | placeholder |
| p10.t0.r2/3 | E1005641 CLAMP, E1005642 CLAMP LOCK | pieces | *(blank)* | missing |
| p22 | E26750, E18121, E19595 | pieces | *(blank)* | missing |
| p22 | E1000921 OIL HOSE (4 M), E1000922 OIL HOSE (6M) | pieces & spare | *(blank)* | **highlighted but no quantities** |
| p26.t0.r4 | E1000953 PNEUMATIC HOSE | pieces | *(blank)* | spare given as `50 M` (metres) |
| p3.t0.r6 | E1001286 V BELT | spare | `24 PC` | unit variant PC |
| p19.t0.r6 | E8771 | pieces | `32 PC` | unit variant PC |
| p22.t0.r7 | E17708 | pieces | `1 PS` | unit typo PS |
| p7.t0.r22 | E1007261 | spare | `2PCS` | missing space |
| p13.t0.r8 | E1008091 BUTTERFLY VALVE GROUP | — | `1 PCS` vs `1 SET` | unit differs between columns |

Units found: `PCS` (incl. PC/PS variants), `SET`, `M`.

### 4.7 Conflicting spare recommendations for the same code (12 codes)

e.g. E1001498 ROD END: 3 PCS (cement batcher) vs 2 PCS (water batcher); E27279 TROUGHING IDLER:
30 PCS (weighing conveyor) vs none (transfer conveyor). Handling: recommendations are stored
**per machine usage**; the part-level suggested minimum stock is shown as their **sum**, and an
administrator confirms it (nothing is auto-applied to stock levels).

### 4.8 Assembly / parent codes

| Parent | Children | Note |
|---|---|---|
| E22667 Mixer lining group | p2 rows | **E22667 not listed as a row** |
| E18252 Bearing (idle side) group | p4 rows | listed as row on p3 |
| E18242 Bearing (driving side) group | p5 rows | listed as row on p3 |
| E1002548 Automatic lubrication | E1002546, E1005791 (Fig. 15) | from drawing caption |
| E53623 Hydraulic unit | E25955, E20321, E53625 (p9) | inferred |
| E1001393 Compressor | p20 rows | **E1001393 not listed as a row** |
| E75941 Pump → Bare pump | p21 table 1 | listed as row on p20 |
| E24501 Gearbox and motor → Cement screw gearbox | p23 rows | inferred |
| E29028 Air filter | E29028-1…-9 | suffix scheme |

E22667 and E1001393 will be created as parts flagged "created from caption".

### 4.9 Suppliers

The source contains **no supplier information**, so duplicate-supplier detection is not
applicable yet. It will run in the Supplier import (name + tax number + email similarity).

## 5. Images

- 34 embedded pictures, all JPEG, 205–851 px wide, extracted **byte-for-byte** (no re-compression) to `source-data/extracted/images/` with SHA-256 in `images.json`.
- They are **assembly drawings** (exploded views with E-code call-outs), not per-part photographs. Several parts appear in one drawing; no part has a photo of its own.
- Each drawing is linked to the table printed directly under it (all 28 tables have at least one drawing). Page 12's drawing belongs to the table on page 13. Picture `xref 35` overflows the bottom of page 8 and is printed in full at the top of page 9 — stored once.
- In the app, every part in a group will show that group's drawing ("Drawing" tab, zoomable). Real photos per part can be uploaded later (JPG/JPEG/PNG/WEBP, multiple per part).
- Call-outs in the drawings are raster text, so the exact position of each code in the picture cannot be read automatically without OCR. OCR hotspots can be added later if wanted.

## 6. Relationships between "sheets"

```
Plant (Batching plant, ELKON)
 └─ Equipment (10 machines)                 ← page titles
     └─ Assembly / group (28)               ← captions / drawings
         └─ Part usage (289 rows)           ← table rows: installed qty, spare qty
             └─ Part (252 unique codes)     ← CODE
                 └─ may itself be an assembly (E18252, E75941, E29028 …)
```
