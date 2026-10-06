# source-data

| Path | Content | Rule |
|---|---|---|
| `original/SPARE_PART_LIST.xlsx` | **The original workbook — source of truth** (10 sheets, 34 pictures) | **Read-only. Never edit or overwrite.** Verify with `sha256sum -c original/SHA256SUMS` |
| `original/SPARE_PART_LIST.pdf` | 2021 PDF print of an earlier version of the workbook | Read-only; kept for comparison |
| `extracted/workbook/rows.json`, `rows.csv` | Every workbook table row verbatim with `source_ref` (`MIXER!A45`), parsed quantities/units, caption/group, fill and font info | `python3 tools/extract_source_xlsx.py` |
| `extracted/workbook/images.json` | Every picture: sheet, anchor cell, media path inside the .xlsx, SHA-256, size, Excel rotation/flip, linked table | same script (pictures are read from the .xlsx at import time) |
| `extracted/workbook/groups.json` | Machine → assembly → part codes | same script |
| `extracted/workbook_vs_pdf_2021.json` | Row-by-row differences between the workbook and the 2021 PDF | `python3 tools/compare_workbook_pdf.py` |
| `extracted/pdf-2021/` | Extraction of the PDF (rows, 34 JPEGs, data-quality findings) | `tools/extract_source_pdf.py`, `tools/data_quality_report.py` |
| `original/imer/*.pdf` | **IMER / ORU spare-parts books**, one per plant: `CR_LIBANO_74_2010.pdf` (LOGIK 2WXL 4/10, S/N 10090213), `CR_PDF_LIBANO_76.pdf` (ORU ONEDAY, S/N 11010013), `CR_PDF_LIBANO_77.pdf` (LOGIK WXL4/8SC-MD, S/N 11060151), `CR_LIBANO79.pdf` (LOGIK WB 4-82, S/N 12010006) | **Read-only. Never edit or overwrite.** In `SHA256SUMS` |
| `transcribed/imer-10090213-gearboxes.json` | The three gearbox parts lists (pages 42, 44, 46) of books 74 and 77 are scanned images; they were read and typed by hand, every column as printed (IT/EN/FR/DE names, note, markers `*`, `$1`, `#`). Applied to a book only when its scanned page image has the recorded SHA-256 (it does in 74 and 77) | Manual; parts carry the flag `TRANSCRIBED_FROM_SCAN`. Book 79 prints the same gearbox codes as text, which confirms the transcription |
| `extracted/imer-<serial>/catalogue.json`, `rows.csv` | Every table line of each book with provenance (`IMER-10090213 p16 L3`): section, position, code, description, quantity, kit components, alternatives, headings, printed notes; for book 79 also the five language columns and the yellow highlighting | `python3 tools/extract_imer_catalogue.py [serial]` |
| `extracted/imer-<serial>/drawings/` | Each section's exploded drawing, rendered at 150 dpi and turned upright | same script |

| `original/dt/MAN-TGA-TGS-TGX-TGL-TGM_Catalogue-<1..16>.pdf` | **DT Spare Parts catalogue** "Spare parts suitable for MAN TGA/TGS/TGX, TGL/TGM", 790 pages, split into 16 files of up to 50 pages (as uploaded) | **Read-only.** In `SHA256SUMS` |
| `extracted/dt-man-tga/catalogue.json`, `items.csv`, `photos/` | Every item (`DT-MAN p121 #1`): DT number (QR code, OCR fallback), EN/DE description, engines, details, reference numbers, notes, quality flags; sections from the list of contents; index pairs; one photo per part | `python3 tools/extract_dt_catalogue.py` (tesseract + opencv; pages are cached) |
| `original/sany/SYM1310T-412C8RS1T5_Chassis_Parts_Book-<1..12>.pdf` | **SANY chassis parts book** of the mixer truck SYM1310T-412C8RS1T5, Equipment No. 22DP0131010170, 566 pages split into 12 files (as uploaded) | **Read-only.** In `SHA256SUMS` |
| `extracted/sany-22DP0131010170/catalogue.json`, `rows.csv`, `drawings/` | 191 sections (as in the book's contents; the front leaf spring printed twice is kept twice), 2,394 lines (`SANY p37 L1`): index, part no., description, qty, see page (sub-assembly); 266 drawings at 150 dpi | `python3 tools/extract_sany_catalogue.py` (PDF text layer, no OCR) |
| `original/sany/SYG5371THB-470C-10_Parts_Book-<1..15>.pdf` | **SANY parts book** of the truck-mounted concrete pump SYG5371THB 470C-10, Equipment No. BC5371CC1593, 716 pages split into 15 files (as uploaded) | **Read-only.** In `SHA256SUMS` |
| `extracted/sany-BC5371CC1593/catalogue.json`, `rows.csv`, `drawings/` | 223 sections (as in the book's contents), 3,670 lines with the Remark column (paint colour); 303 lines without index/qty are colour variants of the line above (`VARIANT_OF_ROW_ABOVE`); 340 drawings | `python3 tools/extract_sany_catalogue.py pump` |
| `original/sany/SY412C-8-ST_Upper_Structure_Parts_Book-<1..7>.pdf` | **SANY upper-structure parts book** (drum, water, chutes, drum drive, markings) of the mixer truck SY412C-8/ST, Equipment No. HNGJ1241009906, 198 pages in 7 files. Same truck as the chassis book (owner confirmed) | **Read-only.** In `SHA256SUMS` |
| `extracted/sany-HNGJ1241009906/catalogue.json`, `rows.csv`, `drawings/` | 84 sections (as in the contents), 747 lines, 89 drawings; `attach_to` = the chassis book's Equipment No., so the sections are added to that truck as "Upper structure …" | `python3 tools/extract_sany_catalogue.py upper` |
| `original/fleet/type-plate-<VIN>.jpg` | Photos of the type plates of the MAN trucks (as sent by the owner) | **Read-only.** In `SHA256SUMS` |
| `fleet/man-trucks.json` | The trucks transcribed from those photos: VIN (check digit verified), MAN vehicle number, type, model year (from the VIN), permitted masses, K-value | Manual. Each truck is imported as a machine with a copy of the DT catalogue (keyed by VIN, never duplicated, never overwritten) |

The importer (`npm run import:source`) refuses to run when `rows.json` / `catalogue.json` were not extracted from the
exact files in `original/` (SHA-256 check), and it never writes to this folder.
