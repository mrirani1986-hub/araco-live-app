#!/usr/bin/env python3
"""
Read-only extractor for SANY parts books (each book split into files of 50 pages):
  mixer  SYM1310T-412C8RS1T5 chassis, Equipment No. 22DP0131010170  source-data/original/sany/SYM1310T-...-<1..12>.pdf
  pump   SYG5371THB 470C-10 truck-mounted concrete pump, Equipment No. BC5371CC1593  source-data/original/sany/SYG5371THB-...-<n>.pdf

The PDFs are never written to. The book has a real text layer (no OCR):
  - every page has a header "<assembly code> <assembly name> (k/n)" and a footer "<book page> <group name>";
  - drawing pages hold the line-art illustration with callout numbers;
  - table pages hold "INDEX  PART NO.  DESCRIPTION  [Remark]  QTY  SEE PAGE" (SEE PAGE = the page of a sub-assembly);
    column positions are read from each page's header row. A row with a part number but no index is a variant of
    the row above (e.g. another colour) and keeps its index.

Outputs (source-data/extracted/sany-<equipment no.>/):
  catalogue.json   truck, groups, assemblies (code, name, group, book pages, drawings), every table line with
                   provenance ("SANY p123 L4" = PDF page 123 of the whole book, line 4)
  rows.csv         the same lines, flat
  drawings/*.png   each drawing page rendered at 150 dpi (header and footer cut off)

Usage:  python3 spare-parts/tools/extract_sany_catalogue.py [mixer|pump ...]
"""
import csv
import hashlib
import json
import re
import sys
from pathlib import Path

import pymupdf

ROOT = Path(__file__).resolve().parents[1]
ORIGINAL = ROOT / "source-data" / "original"
BOOKS = {
    "mixer": {"files": [f"sany/SYM1310T-412C8RS1T5_Chassis_Parts_Book-{i}.pdf" for i in range(1, 13)],
              "model": "SYM1310T-412C8RS1T5", "equipment_no": "22DP0131010170", "kind": "Chassis", "machine": "mixer truck",
              "publisher": "Sany Automobile Hoisting Machinery Co., Ltd."},
    "pump": {"files": [f"sany/SYG5371THB-470C-10_Parts_Book-{i}.pdf" for i in range(1, 100)],
             "model": "SYG5371THB 470C-10", "equipment_no": "BC5371CC1593", "kind": "Truck-mounted Concrete Pump", "machine": "concrete pump truck",
             "publisher": "SANY Automobile Manufacturing Co., Ltd."},
}
HEADER_Y = (45, 60)   # assembly header line
TABLE_TOP = 85        # below the column titles
FOOTER_Y = 760
PAGE_LABEL_RE = re.compile(r"^\d{1,2}-\d{1,3}$")
PART_RE = re.compile(r"^[A-Z0-9][A-Z0-9-]{3,}$")
OF_RE = re.compile(r"\((\d+)/(\d+)\)$")


def sha256(b: bytes) -> str:
    return hashlib.sha256(b).hexdigest()


def lines_of(words, y0, y1):
    """Words between y0 and y1 grouped into lines (by rounded baseline)."""
    rows = {}
    for w in words:
        if y0 <= w[1] < y1:
            rows.setdefault(round(w[3]), []).append(w)
    out, last = [], None
    for y in sorted(rows):
        if last is not None and y - last <= 2:
            out[-1].extend(rows[y])
        else:
            out.append(list(rows[y]))
        last = y
    return [sorted(l, key=lambda w: w[0]) for l in out]


def columns(words):
    """Cell boundaries from the column titles of a table page (x of the first word of each cell, points)."""
    hx = {w[4]: w[0] for w in words if 70 < w[1] < 90}
    cols = [("index", 0), ("part_no", hx["PART"] - 3), ("description", hx["DESCRIPTION"] - 3)]
    if "Remark" in hx:
        cols.append(("remark", hx["Remark"] - 15))
    cols += [("qty", hx["QTY"] - 8), ("see_page", hx["SEE"] - 5)]
    return [(c, x0, cols[i + 1][1] if i + 1 < len(cols) else 1000) for i, (c, x0) in enumerate(cols)]


def main(book):
    cfg = BOOKS[book]
    MODEL, EQUIPMENT_NO = cfg["model"], cfg["equipment_no"]
    OUT = ROOT / "source-data" / "extracted" / f"sany-{EQUIPMENT_NO}"
    OUT.mkdir(parents=True, exist_ok=True)
    (OUT / "drawings").mkdir(exist_ok=True)
    sources, pages = [], []
    for f in [f for f in cfg["files"] if (ORIGINAL / f).exists()]:
        data = (ORIGINAL / f).read_bytes()
        doc = pymupdf.open(stream=data, filetype="pdf")
        sources.append({"file": f"original/{f}", "sha256": sha256(data), "pages": doc.page_count, "first_page": len(pages) + 1})
        pages.extend(doc[i] for i in range(doc.page_count))

    assemblies, order, items, groups = {}, [], [], {}
    skipped = []
    for n, page in enumerate(pages, start=1):
        words = page.get_text("words")
        footer = " ".join(w[4] for w in sorted(words, key=lambda w: w[0]) if w[1] >= FOOTER_Y)
        label = next((w[4] for w in words if w[1] >= FOOTER_Y and PAGE_LABEL_RE.match(w[4])), None)
        group = re.sub(rf"\s*({re.escape(MODEL)}|\d{{1,2}}-\d{{1,3}})\s*", " ", footer).strip()
        head = " ".join(w[4] for w in sorted(words, key=lambda w: w[0]) if HEADER_Y[0] <= w[1] < HEADER_Y[1])
        group_title = bool(label) and label.endswith("-1") and any(w[4] == "Group" for w in words)
        if not label or not head or group.lower() == "index" or group_title:
            skipped.append(n)  # cover, preface, contents, group title pages, alphabetical index, back cover
            continue
        code, _, name = head.partition(" ")
        of = OF_RE.search(name)
        name = OF_RE.sub("", name).strip()
        # a new section starts when the header changes; the book prints some assemblies twice (e.g. the front
        # leaf spring under each front axle module), each printing is kept as its own section
        key = f"{code} {name}"
        if order and assemblies[order[-1]]["code"] == code and assemblies[order[-1]]["name"] == name and assemblies[order[-1]]["pdf_pages"][-1] == n - 1:
            key = order[-1]
        elif key in assemblies:
            key = f"{key} (p{label})"
        if key not in assemblies:
            assemblies[key] = {"key": key, "code": code, "name": name, "group": group, "group_no": int(label.split("-")[0]),
                               "book_pages": [], "pdf_pages": [], "drawings": [], "lines": 0}
            order.append(key)
        a = assemblies[key]
        groups.setdefault(a["group_no"], group)
        a["book_pages"].append(label)
        a["pdf_pages"].append(n)
        is_table = sum(1 for w in words if 70 < w[1] < 85 and w[4] in ("INDEX", "PART", "QTY", "SEE")) >= 3
        if not is_table:
            png = f"drawings/p{n:03d}.png"
            clip = pymupdf.Rect(0, 62, page.rect.width, FOOTER_Y - 4)
            pix = page.get_pixmap(dpi=150, clip=clip, colorspace=pymupdf.csGRAY)
            pix.save(OUT / png)
            a["drawings"].append({"file": png, "sha256": sha256((OUT / png).read_bytes()), "pdf_page": n, "book_page": label, "part": f"{of.group(1)}/{of.group(2)}" if of else None})
            continue
        ln = 0
        COLS = columns(words)
        for line in lines_of(words, TABLE_TOP, FOOTER_Y):
            cells = {c: [] for c, _, _ in COLS}
            for w in line:
                c = next(c for c, x0, x1 in COLS if x0 <= w[0] < x1)
                cells[c].append(w[4])
            cell = {c: " ".join(v) for c, v in cells.items()}
            cell.setdefault("remark", "")
            if not cell["part_no"] and not cell["index"]:
                if items and items[-1]["pdf_page"] == n and cell["description"]:
                    items[-1]["description"] += " " + cell["description"]  # wrapped description (none in this book)
                continue
            ln += 1
            flags = []
            variant = not cell["index"] and bool(items) and items[-1]["pdf_page"] == n
            if variant:
                flags.append("VARIANT_OF_ROW_ABOVE")
                cell["index"] = items[-1]["index"]
            if not PART_RE.match(cell["part_no"]):
                flags.append("PART_NO_UNUSUAL")
            if not re.match(r"^\d+(\.\d+)?$", cell["qty"]) and not (variant and not cell["qty"]):
                flags.append("QTY_NOT_NUMBER")
            items.append({
                "source_ref": f"SANY p{n} L{ln}", "pdf_page": n, "book_page": label, "assembly": key,
                "index": cell["index"], "part_no": cell["part_no"], "description": cell["description"],
                "remark": cell["remark"] or None, "qty": cell["qty"], "see_page": cell["see_page"] or None, "flags": flags,
            })
            a["lines"] += 1

    # sub-assemblies: the SEE PAGE of a line points at the assembly that starts on that book page
    start = {}
    for key in order:
        start.setdefault(assemblies[key]["book_pages"][0], key)
    for it in items:
        if it["see_page"]:
            it["see_assembly"] = start.get(it["see_page"])

    catalogue = {
        "meta": {
            "title": f"SANY {cfg['kind']} Parts Book {MODEL}", "brand": "SANY", "model": MODEL, "machine": cfg["machine"], "equipment_no": EQUIPMENT_NO,
            "publisher": cfg.get("publisher", "SANY"), "sources": sources,
            "not_extracted": f"PDF pages {', '.join(map(str, skipped))}: cover, preface, contents, group title pages, alphabetical index, back cover",
        },
        "groups": [{"no": k, "name": v} for k, v in sorted(groups.items())],
        "assemblies": [assemblies[k] for k in order],
        "items": items,
    }
    (OUT / "catalogue.json").write_text(json.dumps(catalogue, ensure_ascii=False, indent=1))
    with open(OUT / "rows.csv", "w", newline="", encoding="utf-8") as f:
        w = csv.writer(f)
        w.writerow(["source_ref", "book_page", "assembly", "index", "part_no", "description", "remark", "qty", "see_page", "flags"])
        for it in items:
            w.writerow([it["source_ref"], it["book_page"], it["assembly"], it["index"], it["part_no"], it["description"], it["remark"] or "", it["qty"], it["see_page"] or "", ";".join(it["flags"])])
    print(json.dumps({"pages": len(pages), "assemblies": len(order), "groups": len(groups), "items": len(items),
                      "drawings": sum(len(assemblies[k]["drawings"]) for k in order),
                      "flagged": sum(1 for i in items if i["flags"]), "skipped_pages": len(skipped)}, indent=1))


if __name__ == "__main__":
    for b in sys.argv[1:] or list(BOOKS):
        main(b)
