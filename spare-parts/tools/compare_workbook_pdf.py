#!/usr/bin/env python3
"""Compares the workbook (current source of truth) with the 2021 PDF print, row by row.
Writes source-data/extracted/workbook_vs_pdf_2021.json. Read-only on both sources."""
import json
from collections import Counter
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
X = ROOT / "source-data" / "extracted"
wb = json.loads((X / "workbook" / "rows.json").read_text())["rows"]
pdf = [r for r in json.loads((X / "pdf-2021" / "rows.json").read_text())["rows"] if r["code"]]
assert len(wb) == len(pdf), "row counts differ"
diffs, kinds = [], Counter()
for w, p in zip(wb, pdf):
    assert w["code"] == p["code"], f"order differs at {w['source_ref']}"
    for field, a, b in [("part_name", w["part_name"], p["part_name"]),
                        ("pieces", str(w["pieces_raw"] or ""), p["pieces_raw"] or ""),
                        ("spare", str(w["spare_raw"] or ""), p["spare_raw"] or "")]:
        if a != b:
            kind = f"{field}:{'added' if not b else 'removed' if not a else 'changed'}"
            kinds[kind] += 1
            diffs.append(dict(workbook_ref=w["source_ref"], pdf_ref=p["source_ref"], code=w["code"], field=field, workbook=a, pdf_2021=b, pdf_highlighted=p["highlighted"]))
out = dict(rows_compared=len(wb), identical_codes_and_order=True, rows_with_differences=len({d["workbook_ref"] for d in diffs}),
           summary=dict(kinds), highlight_rows_in_pdf=sum(p["highlighted"] for p in pdf),
           highlight_rows_in_workbook=sum(1 for w in wb if w["fill"] not in (None, "theme:0")), differences=diffs)
(X / "workbook_vs_pdf_2021.json").write_text(json.dumps(out, indent=2))
print(json.dumps({k: v for k, v in out.items() if k != "differences"}, indent=2))
