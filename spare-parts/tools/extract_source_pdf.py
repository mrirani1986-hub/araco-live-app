#!/usr/bin/env python3
"""
Read-only extractor for the ELKON spare-part list (PDF printed from Excel).

The source file is NEVER modified. This script:
  1. verifies the SHA-256 of the source copy in source-data/original/
  2. extracts every table row with full provenance (page, table, row, bbox)
  3. records row highlighting (yellow = recommended spare) and text colours
  4. extracts every embedded picture losslessly (original stream bytes)
  5. writes rows.csv / rows.json / images.json / groups.json to source-data/extracted/

Usage:  python3 spare-parts/tools/extract_source_pdf.py
Requires: pymupdf  (pip install pymupdf)
"""
import csv
import hashlib
import json
import re
from pathlib import Path

import pymupdf

ROOT = Path(__file__).resolve().parents[1]
SRC = ROOT / "source-data" / "original" / "SPARE_PART_LIST.pdf"
OUT = ROOT / "source-data" / "extracted" / "pdf-2021"
IMG_OUT = OUT / "images"

# Machine (equipment) and assembly group for each (page, table_index).
# Taken from the printed page captions; entries marked inferred=True had no
# caption on the page and were assigned from the drawing's "Fig." labels or the
# preceding page. They are flagged as such in the output, never silently.
GROUP_MAP = {
    (1, 0): ("TWINSHAFT MIXER", "MIXER TOP COVER GROUP", None, False),
    (2, 0): ("TWINSHAFT MIXER", "MIXER LINING GROUP", "E22667", False),
    (3, 0): ("TWINSHAFT MIXER", "DRIVING GROUP", None, False),
    (4, 0): ("TWINSHAFT MIXER", "BEARING (IDLE SIDE) GROUP", "E18252", False),
    (5, 0): ("TWINSHAFT MIXER", "BEARING (DRIVING SIDE) GROUP", "E18242", False),
    (6, 0): ("TWINSHAFT MIXER", "MIXING ARMS AND SCRAPER ARMS GROUP", None, False),
    (7, 0): ("TWINSHAFT MIXER", "MIXING ARMS, SCRAPER ARMS AND DISCHARGE GATE", None, True),
    (8, 0): ("TWINSHAFT MIXER", "LUBRICATION GROUP", None, True),
    (9, 0): ("TWINSHAFT MIXER", "MIXER DISCHARGE AND GREASE PUMP", None, True),
    (9, 1): ("TWINSHAFT MIXER", "HYDRAULIC UNIT", "E53623", True),
    (10, 0): ("CEMENT WEIGHING BATCHER", "CEMENT WEIGHING BATCHER", "E37680", False),
    (11, 0): ("CEMENT WEIGHING BATCHER", "LOAD CELLS AND DISCHARGE VALVE", None, True),
    (13, 0): ("WATER WEIGHING BATCHER", "WATER WEIGHING BATCHER", "E74430", False),
    (14, 0): ("ADDITIVE WEIGHING BATCHER", "ADDITIVE WEIGHING BATCHER", "E76109", False),
    (15, 0): ("INLINE SILO", "INLINE SILO", None, False),
    (16, 0): ("WEIGHING CONVEYOR", "WEIGHING CONVEYOR - TAIL SECTION", None, True),
    (17, 0): ("WEIGHING CONVEYOR", "WEIGHING CONVEYOR - HANGERS, HEAD DRIVE AND IDLERS", None, True),
    (18, 0): ("TRANSFER CONVEYOR", "TRANSFER CONVEYOR - HEAD SECTION", None, True),
    (19, 0): ("TRANSFER CONVEYOR", "TRANSFER CONVEYOR - TAIL AND IDLERS", None, True),
    (20, 0): ("COMPRESSOR", "COMPRESSOR", "E1001393", False),
    (21, 0): ("COMPRESSOR", "BARE PUMP", "E75941", False),
    (21, 1): ("COMPRESSOR", "AIR SERVICE UNIT AND AIR TANK", None, True),
    (22, 0): ("CEMENT SCREW", "CEMENT SCREW", None, False),
    (23, 0): ("CEMENT SCREW", "CEMENT SCREW GEARBOX", "E24501", True),
    (24, 0): ("CEMENT SILO", "CEMENT SILO", None, False),
    (24, 1): ("CEMENT SILO", "CEMENT SILO - BOTTOM AND AERATION", None, True),
    (25, 0): ("CEMENT SILO", "CEMENT SILO AIR FILTER", "E29028", False),
    (26, 0): ("CEMENT SILO", "CEMENT SILO PNEUMATIC SCHEMA", None, False),
}

QTY_RE = re.compile(r"^\s*(\d+(?:\.\d+)?)\s*([A-Za-z]*)\s*$")
UNIT_NORMALISE = {"PCS": "PCS", "PC": "PCS", "PS": "PCS", "SET": "SET", "M": "M"}


def parse_qty(raw):
    """Return (qty, unit, issue) without losing the raw text."""
    raw = (raw or "").strip()
    if raw == "":
        return None, None, "empty"
    if set(raw) <= {"-"}:
        return None, None, "dash_placeholder"
    m = QTY_RE.match(raw)
    if not m:
        return None, None, "unparseable"
    unit_raw = m.group(2).upper()
    unit = UNIT_NORMALISE.get(unit_raw)
    issue = None
    if unit is None:
        issue = "unknown_unit"
    elif unit_raw != unit:
        issue = f"unit_variant:{unit_raw}"
    elif " " not in raw:
        issue = "missing_space"
    q = float(m.group(1))
    return (int(q) if q.is_integer() else q), unit, issue


def sha256(path):
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    IMG_OUT.mkdir(parents=True, exist_ok=True)
    doc = pymupdf.open(SRC)

    rows, images, seen_xref, table_tops = [], [], {}, {}
    for pno, page in enumerate(doc, start=1):
        yellow = [pymupdf.Rect(d["rect"]) for d in page.get_drawings()
                  if d.get("fill") and tuple(round(c, 2) for c in d["fill"]) == (1.0, 1.0, 0.0)]
        red_spans = []
        for b in page.get_text("dict")["blocks"]:
            for ln in b.get("lines", []):
                for s in ln["spans"]:
                    if s["color"] == 0xFF0000:
                        red_spans.append(pymupdf.Rect(s["bbox"]))

        tables = page.find_tables().tables
        for tno, tab in enumerate(tables):
            table_tops[(pno, tno)] = tab.bbox[1]
            machine, group, group_code, inferred = GROUP_MAP.get((pno, tno), (None, None, None, True))
            data = tab.extract()
            for rno, (cells, row_obj) in enumerate(zip(data, tab.rows)):
                if rno == 0:
                    continue  # header: CODE | PART NAME | PIECES | SPARE PART
                code, name, pieces, spare = [(c or "").strip() for c in cells]
                rrect = pymupdf.Rect(row_obj.bbox)
                if not any([code, name, pieces, spare]):
                    rows.append(dict(source_ref=f"p{pno}.t{tno}.r{rno}", page=pno, table=tno, row=rno,
                                     machine=machine, group=group, group_code=group_code,
                                     group_inferred=inferred, code="", part_name="", pieces_raw="",
                                     spare_raw="", pieces_qty=None, pieces_unit=None, pieces_issue="blank_row",
                                     spare_qty=None, spare_unit=None, spare_issue="blank_row",
                                     highlighted=False, pieces_red=False))
                    continue
                pq, pu, pi = parse_qty(pieces)
                sq, su, si = parse_qty(spare)
                if si == "empty":
                    si = None  # an empty spare column simply means "no spare recommended"
                highlighted = any((r & rrect).get_area() > 0.5 * rrect.get_area() for r in yellow)
                pieces_red = any(rrect.intersects(r) and r.x0 > rrect.x0 + 300 for r in red_spans)
                rows.append(dict(source_ref=f"p{pno}.t{tno}.r{rno}", page=pno, table=tno, row=rno,
                                 machine=machine, group=group, group_code=group_code,
                                 group_inferred=inferred, code=code, part_name=name,
                                 pieces_raw=pieces, spare_raw=spare,
                                 pieces_qty=pq, pieces_unit=pu, pieces_issue=pi,
                                 spare_qty=sq, spare_unit=su, spare_issue=si,
                                 highlighted=highlighted, pieces_red=pieces_red))

        # Embedded pictures: extract the original stream bytes (lossless).
        for img in page.get_images(full=True):
            xref = img[0]
            rects = page.get_image_rects(xref)
            if xref not in seen_xref:
                info = doc.extract_image(xref)
                fname = f"img_x{xref:03d}_p{pno:02d}.{info['ext']}"
                (IMG_OUT / fname).write_bytes(info["image"])
                seen_xref[xref] = dict(xref=xref, file=f"images/{fname}", width=info["width"],
                                       height=info["height"], ext=info["ext"],
                                       sha256=hashlib.sha256(info["image"]).hexdigest(), placements=[])
                images.append(seen_xref[xref])
            for r in rects:
                seen_xref[xref]["placements"].append(dict(page=pno, bbox=[round(v, 1) for v in r]))

    # Link each picture placement to the table printed directly below it on the
    # same page. Pictures are assembly drawings (with code callouts), so the link
    # is drawing -> group of parts, not drawing -> single part.
    for im in images:
        linked = set()
        for pl in im["placements"]:
            x0, y0, x1, y1 = pl["bbox"]
            pl["clipped"] = y1 > 792  # overflows the page; shown in full on the next page
            if pl["clipped"]:
                continue
            page = 13 if pl["page"] == 12 else pl["page"]  # page 12 drawing belongs to page 13 table
            below = sorted((top, t) for (p, t), top in table_tops.items()
                           if p == page and (page != pl["page"] or top >= y1 - 5))
            if below:
                t = below[0][1]
                g = GROUP_MAP[(page, t)]
                linked.add((page, t, g[0], g[1]))
        im["tables"] = [dict(page=p, table=t, machine=m, group=g) for p, t, m, g in sorted(linked)]

    groups = {}
    for r in rows:
        if not r["code"]:
            continue
        key = f"{r['machine']} / {r['group']}"
        g = groups.setdefault(key, dict(machine=r["machine"], group=r["group"], group_code=r["group_code"],
                                        inferred=r["group_inferred"], pages=set(), codes=[]))
        g["pages"].add(r["page"])
        g["codes"].append(r["code"])
    for g in groups.values():
        g["pages"] = sorted(g["pages"])

    meta = dict(source_file=str(SRC.relative_to(ROOT)), sha256=sha256(SRC),
                pdf_metadata=doc.metadata, page_count=doc.page_count,
                row_count=len(rows), image_count=len(images))

    (OUT / "rows.json").write_text(json.dumps(dict(meta=meta, rows=rows), indent=2))
    (OUT / "images.json").write_text(json.dumps(images, indent=2))
    (OUT / "groups.json").write_text(json.dumps(groups, indent=2))
    with open(OUT / "rows.csv", "w", newline="") as f:
        w = csv.DictWriter(f, fieldnames=list(rows[0].keys()))
        w.writeheader()
        w.writerows(rows)
    print(json.dumps(meta, indent=2))


if __name__ == "__main__":
    main()
