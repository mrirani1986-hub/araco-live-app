#!/usr/bin/env python3
"""
Builds the data-quality findings from source-data/extracted/rows.json.
Nothing is changed or deleted; findings are written to
source-data/extracted/data_quality.json for review.
"""
import json
import re
from collections import defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
EXTRACTED = ROOT / "source-data" / "extracted" / "pdf-2021"

# Known spelling variants seen in the list. Used only to FLAG possible
# name inconsistencies; the original text is always kept.
SPELLING = {
    "PENEUMATIC": "PNEUMATIC", "PENUMATIC": "PNEUMATIC", "DISTRUBITOR": "DISTRIBUTOR",
    "VIBERATOR": "VIBRATOR", "ACUATOR": "ACTUATOR", "SAFTY": "SAFETY", "SELENOID": "SOLENOID",
    "GURD": "GUARD", "GABLE": "CABLE", "HUMMER": "HAMMER", "SAPRE": "SPARE",
    "LOADCELL": "LOAD CELL", "ORING": "O RING", "VALVECOIL": "VALVE COIL", "WEARLINING": "WEAR LINING",
    "BEARINGS": "BEARING", "PULLGUARD": "PULL GUARD",
}
CODE_RE = re.compile(r"^E\d+(-\d+)?$")


def norm_name(n):
    words = re.sub(r"[^A-Z0-9 ]", " ", n.upper()).split()
    return " ".join(SPELLING.get(w, w) for w in words)


def main():
    rows = json.loads((EXTRACTED / "rows.json").read_text())["rows"]
    data = [r for r in rows if r["code"]]
    by_code = defaultdict(list)
    for r in data:
        by_code[r["code"]].append(r)

    f = {}
    f["summary"] = dict(
        table_rows=len(rows), blank_rows=len(rows) - len(data), part_rows=len(data),
        unique_codes=len(by_code),
        codes_listed_more_than_once=sum(1 for v in by_code.values() if len(v) > 1),
        highlighted_rows=sum(r["highlighted"] for r in data),
        rows_with_spare_qty=sum(r["spare_qty"] is not None for r in data),
        machines=sorted({r["machine"] for r in data}),
    )
    f["blank_rows"] = [r["source_ref"] for r in rows if not r["code"]]

    f["repeated_codes"] = [
        dict(code=c, occurrences=[dict(ref=r["source_ref"], machine=r["machine"], group=r["group"],
                                       name=r["part_name"], pieces=r["pieces_raw"], spare=r["spare_raw"])
                                  for r in v])
        for c, v in sorted(by_code.items()) if len(v) > 1
    ]

    f["same_code_different_name"] = []
    for c, v in sorted(by_code.items()):
        names = sorted({r["part_name"] for r in v})
        if len(names) > 1:
            kind = "spelling_or_format" if len({norm_name(n) for n in names}) == 1 else "different_wording"
            f["same_code_different_name"].append(dict(code=c, names=names, kind=kind))

    by_norm = defaultdict(set)
    for r in data:
        by_norm[norm_name(r["part_name"])].add(r["code"])
    f["same_name_different_codes"] = {n: sorted(cs) for n, cs in sorted(by_norm.items()) if len(cs) > 1}

    f["spelling_flags"] = sorted({(r["part_name"], norm_name(r["part_name"])) for r in data
                                  if norm_name(r["part_name"]) != " ".join(re.sub(r"[^A-Z0-9 ]", " ", r["part_name"].upper()).split())})

    f["code_format"] = dict(
        invalid=[c for c in by_code if not CODE_RE.match(c)],
        suffixed=[c for c in by_code if "-" in c],
        short_codes_lt_4_digits=[c for c in by_code if re.fullmatch(r"E\d{1,3}", c)],
        lengths={str(k): v for k, v in sorted(
            {len(c): sum(1 for x in by_code if len(x) == len(c)) for c in by_code}.items())},
    )

    f["quantity_issues"] = [
        dict(ref=r["source_ref"], code=r["code"], name=r["part_name"], column=col, raw=r[f"{col}_raw"],
             issue=r[f"{col}_issue"])
        for r in data for col in ("pieces", "spare") if r[f"{col}_issue"]
    ]
    f["unit_mismatch_pieces_vs_spare"] = [
        dict(ref=r["source_ref"], code=r["code"], pieces=r["pieces_raw"], spare=r["spare_raw"])
        for r in data if r["pieces_unit"] and r["spare_unit"] and r["pieces_unit"] != r["spare_unit"]
    ]
    f["highlight_inconsistencies"] = dict(
        highlighted_without_spare_qty=[dict(ref=r["source_ref"], code=r["code"], name=r["part_name"])
                                       for r in data if r["highlighted"] and r["spare_qty"] is None],
        spare_qty_without_highlight=[dict(ref=r["source_ref"], code=r["code"], name=r["part_name"],
                                          spare=r["spare_raw"])
                                     for r in data if not r["highlighted"] and r["spare_qty"] is not None],
    )
    # Same part recommended with different spare quantities in different places.
    f["conflicting_spare_recommendations"] = [
        dict(code=c, values=[(r["source_ref"], r["spare_raw"]) for r in v])
        for c, v in sorted(by_code.items())
        if len({r["spare_raw"] for r in v}) > 1
    ]
    f["assembly_codes_not_listed_as_rows"] = sorted(
        {r["group_code"] for r in data if r["group_code"]} - set(by_code))
    f["missing_fields_entire_source"] = [
        "Manufacturer/brand (only implied: ELKON logo on drawings, E-codes)", "Specification", "Category",
        "Unit price", "Currency", "Supplier", "Supplier part number", "Current stock", "Min/Max stock",
        "Warehouse/location", "Notes",
    ]

    (EXTRACTED / "data_quality.json").write_text(json.dumps(f, indent=2))
    print(json.dumps(f["summary"], indent=2))


if __name__ == "__main__":
    main()
