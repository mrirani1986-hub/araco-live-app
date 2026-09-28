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
| `original/imer/CR_LIBANO_74_2010.pdf` | **IMER / ORU spare-parts book** — concrete batching plant LOGIK 2WXL 4/10, twin-shaft mixer MD 5000/3350, serial number 10090213 (52 pages) | **Read-only. Never edit or overwrite.** In `SHA256SUMS` |
| `transcribed/imer-10090213-gearboxes.json` | The three gearbox parts lists (pages 42, 44, 46) are scanned images; they were read and typed by hand, every column as printed (IT/EN/FR/DE names, note, markers `*`, `$1`, `#`) | Manual; parts carry the flag `TRANSCRIBED_FROM_SCAN` |
| `extracted/imer-10090213/catalogue.json`, `rows.csv` | Every table line of the book with provenance (`IMER-10090213 p16 L3`): section, position, code, description, quantity, kit components, alternatives, headings and printed notes | `python3 tools/extract_imer_catalogue.py` |
| `extracted/imer-10090213/drawings/` | The 22 exploded drawings, rendered at 150 dpi and turned upright | same script |

The importer (`npm run import:source`) refuses to run when `rows.json` / `catalogue.json` were not extracted from the
exact files in `original/` (SHA-256 check), and it never writes to this folder.
