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

The importer (`npm run import:source`) refuses to run when `rows.json` / `catalogue.json` were not extracted from the
exact files in `original/` (SHA-256 check), and it never writes to this folder.
