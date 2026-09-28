# ARACO Spare Parts Management & Procurement

Separate application inside this repository (the existing fleet app in `../frontend`, `../backend` is not touched).

**Current phase: 1 — analysis & design (awaiting approval).** No database, import or application code yet.

| Document | |
|---|---|
| [docs/01-source-analysis.md](docs/01-source-analysis.md) | What is in the source file, data-quality report |
| [docs/02-architecture.md](docs/02-architecture.md) | Stack, rules, workflows, roles, page/module list |
| [docs/03-import-mapping.md](docs/03-import-mapping.md) | Source → database mapping and import validation |
| [docs/proposed-schema.prisma](docs/proposed-schema.prisma) | Proposed normalised schema (validated with `prisma validate`) |
| [source-data/](source-data/README.md) | Read-only original + extracted rows and images |

Re-run the extraction (read-only on the original):

```bash
pip install pymupdf
python3 spare-parts/tools/extract_source_pdf.py
python3 spare-parts/tools/data_quality_report.py
```
