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

The importer (`npm run import:source`) refuses to run when `rows.json` was not extracted from the exact
workbook in `original/` (SHA-256 check), and it never writes to this folder.
