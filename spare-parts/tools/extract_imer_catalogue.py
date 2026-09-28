#!/usr/bin/env python3
"""
Read-only extractor for the IMER / ORU spare-parts catalogue
source-data/original/imer/CR_LIBANO_74_2010.pdf
(CONCRETE BATCHING PLANT LOGIK 2WXL 4/10, twin-shaft mixer MD 5000/3350, serial number 10090213).

The PDF is never written to. Text pages are read with PyMuPDF word coordinates (the tables are printed
sideways on most pages); the three scanned gearbox lists (pages 42, 44, 46) come from the manual
transcription in source-data/transcribed/imer-10090213-gearboxes.json.

Outputs (source-data/extracted/imer-10090213/):
  catalogue.json   plant, sections, every table line with provenance ("IMER-10090213 p6 L3")
  rows.csv         the same lines, flat
  drawings/*.png   each section's exploded drawing rendered at 150 dpi and turned upright

Usage:  python3 spare-parts/tools/extract_imer_catalogue.py
"""
import csv
import hashlib
import json
import re
from pathlib import Path

import pymupdf

ROOT = Path(__file__).resolve().parents[1]
SRC = ROOT / "source-data" / "original" / "imer" / "CR_LIBANO_74_2010.pdf"
TRANSCRIBED = ROOT / "source-data" / "transcribed" / "imer-10090213-gearboxes.json"
OUT = ROOT / "source-data" / "extracted" / "imer-10090213"
PREFIX = "IMER-10090213"

POS_RE = re.compile(r"^(\d{1,3}(/\d{1,2})*|[A-Z]|-)$")
CODE_RE = re.compile(r"^[A-Z0-9]{6,}$")
NO_CODE = {"", "-", "/"}
MIXER_SECTIONS = range(14, 24)  # "Twin shaft mixer mod. MD 5000/3350" in the contents page


def sha256(b: bytes) -> str:
    return hashlib.sha256(b).hexdigest()


def parse_qty(raw: str):
    raw = (raw or "").strip()
    if raw.lower() == "m":
        return None, "M"
    if re.fullmatch(r"\d+", raw):
        return int(raw), "PCS"
    return None, "PCS"


def table_lines(page):
    """Raw table lines of a parts-list page: [{block, line, pos, code, desc, qty}] in reading order."""
    ws = page.get_text("words")
    heads = [w for w in ws if w[4] == "POS."]
    if not heads:
        return []
    rotated = heads[0][2] - heads[0][0] < heads[0][3] - heads[0][1]
    # normalise: L = line coordinate, R = reading position (increasing), T = text
    N = [(round(w[0]) if rotated else round(w[1]), -w[3] if rotated else w[0], w[4]) for w in ws]
    hl = min(n[0] for n in N if n[2] == "POS.")
    hs = sorted([n for n in N if n[2] in ("POS.", "CODE", "DESCRIPTION", "Q.TY") and abs(n[0] - hl) < 3], key=lambda n: n[1])
    names = [h[2] for h in hs]
    blocks = []
    for i in range(0, len(hs), 4):
        assert names[i:i + 4] == ["POS.", "CODE", "DESCRIPTION", "Q.TY"], names
        blocks.append([h[1] for h in hs[i:i + 4]])
    out = []
    for bi, (rp, rc, rd, rq) in enumerate(blocks):
        start, end = rp - 8, (blocks[bi + 1][0] - 3 if bi + 1 < len(blocks) else 1e9)
        lines = {}
        for L, R, T in N:
            if L <= hl + 4 or not (start <= R < end):
                continue
            col = "pos" if R < (rp + rc) / 2 else "code" if R < (rc + rd) / 2 else "qty" if R > rq - 12 else "desc"
            key = next((k for k in lines if abs(k - L) <= 2), L)
            lines.setdefault(key, []).append((col, R, T))
        for x in sorted(lines):
            cells = {}
            for col, _, t in sorted(lines[x], key=lambda c: c[1]):
                cells.setdefault(col, []).append(t)
            out.append({"block": bi + 1, "line": x, **{k: " ".join(v) for k, v in cells.items()}})
    return out


def main():
    pdf = SRC.read_bytes()
    doc = pymupdf.open(stream=pdf, filetype="pdf")
    src_sha = sha256(pdf)
    OUT.mkdir(parents=True, exist_ok=True)
    (OUT / "drawings").mkdir(exist_ok=True)

    # Section titles come from each page's heading ("3 - AGGREGATES STORAGE UNIT WITH ACCESSORIES").
    sections = {}
    for pno in range(4, doc.page_count):
        text = doc[pno].get_text()
        m = re.search(r"^\s*(\d{1,2}) - ([A-Z0-9][^\n]+)$", text, re.M)
        if not m:
            continue
        no = int(m.group(1))
        s = sections.setdefault(no, {"no": no, "title": m.group(2).strip().rstrip(":").strip(), "pages": [], "notes": []})
        s["pages"].append(pno + 1)

    lines = []
    for no, s in sorted(sections.items()):
        for pno in s["pages"]:
            page = doc[pno - 1]
            raw = table_lines(page)
            if not raw:
                continue
            s["table_page"] = pno
            last_pos, last_main, heading, prev = None, None, None, None
            for n, r in enumerate(raw, start=1):
                pos, code, desc, qty = r.get("pos", ""), r.get("code", ""), r.get("desc", ""), r.get("qty", "")
                ref = f"{PREFIX} p{pno} L{n}"
                raw_cells = {k: r.get(k, "") for k in ("pos", "code", "desc", "qty")}
                if (pos and not POS_RE.match(pos)) or (code not in NO_CODE and not CODE_RE.match(code)):
                    s["notes"].append({"source_ref": ref, "text": " ".join(v for v in raw_cells.values() if v)})
                    continue
                if not pos and not code:
                    if desc and desc == desc.upper() and not qty.strip(" 1"):
                        heading = desc  # e.g. "INSIDE RUBBER TUBE"; a stray "1" beside it is ignored but kept in raw
                        s["notes"].append({"source_ref": ref, "text": f"Heading: {desc}", "raw": raw_cells})
                        continue
                    if prev and desc and not desc[0].isupper():
                        prev["description"] += " " + desc  # wrapped description ("2° utilization 5 litres ...")
                        prev["raw"]["continuation"] = raw_cells
                        continue
                    if last_main and desc:
                        q, unit = parse_qty(qty)
                        rec = {"kind": "INFO", "role": "COMPONENT", "position_raw": "", "position": last_main["position"],
                               "parent_position": last_main["position"], "code": None, "description": desc, "qty_raw": qty,
                               "qty": q, "unit": unit}
                    else:
                        s["notes"].append({"source_ref": ref, "text": " ".join(v for v in raw_cells.values() if v)})
                        continue
                else:
                    role = "MAIN"
                    eff = pos
                    if pos in ("", "-"):
                        role, eff = "VARIANT", last_pos
                    else:
                        last_pos = pos
                    q, unit = parse_qty(qty)
                    rec = {"kind": "PART" if code not in NO_CODE else "INFO", "role": role, "position_raw": pos, "position": eff,
                           "parent_position": eff.rsplit("/", 1)[0] if eff and "/" in eff else None,
                           "code": code if code not in NO_CODE else None, "description": desc, "qty_raw": qty, "qty": q, "unit": unit}
                    if role == "MAIN":
                        last_main = rec
                rec.update({"source_ref": ref, "page": pno, "section": no, "heading": heading, "transcribed": False, "raw": raw_cells})
                lines.append(rec)
                prev = rec

    # Scanned gearbox lists (manual transcription)
    tr = json.loads(TRANSCRIBED.read_text())
    assert tr["source_sha256"] == src_sha, "transcription belongs to a different PDF"
    for lst in tr["lists"]:
        s = sections[lst["section"]]
        s["table_page"] = lst["page"]
        s["gearbox_list"] = {k: lst[k] for k in lst if k not in ("rows",)}
        for r in lst["rows"]:
            name = r["en"] + (f" {r['note']}" if r["note"] else "")
            lines.append({
                "kind": "PART" if r["code"] else "INFO", "role": "MAIN", "position_raw": r["ref"], "position": r["ref"],
                "parent_position": None, "code": r["code"], "description": name, "qty_raw": str(r["qty"]), "qty": r["qty"], "unit": "PCS",
                "source_ref": f"{PREFIX} p{lst['page']} ref {r['ref']} (transcribed)", "page": lst["page"], "section": lst["section"],
                "heading": None, "transcribed": True, "recommended_for_stock": r["recommended"],
                "names": {"it": r["it"], "en": r["en"], "fr": r["fr"], "de": r["de"]}, "note": r["note"], "marker": r["mark"], "raw": r,
            })
    # Page 12's ordering note is printed across both table columns; the fragments stay in "notes", and the
    # sentence as printed is added once for display.
    for s in sections.values():
        if any(n["text"].startswith("ATTENTION") for n in s["notes"]):
            s["notes"].insert(0, {"source_ref": f"{PREFIX} p{s['table_page']}", "display": True, "text":
                "ATTENTION: by requesting screw feed spare parts, indicate the data relevant to screw feed itself. Example: for ordering "
                "spare part with position 1/2, the order will be as follows: 13015572 (Screw feeder code) - Reduction gear (Description) "
                "- 1 (Requested quantity)"})
    for no, s in sections.items():
        if "gearbox_list" in s:
            s["notes"].append({"source_ref": f"{PREFIX} p{s['table_page']}", "display": True, "text": "Markers: " + "; ".join(f"{k} = {v}" for k, v in tr["markers"].items())})

    # Drawings: the page of each section without a table (turned upright), rendered at 150 dpi.
    drawings = []
    for no, s in sorted(sections.items()):
        for pno in s["pages"]:
            if pno == s.get("table_page"):
                continue
            page = doc[pno - 1]
            dirs = {tuple(round(v) for v in l["dir"]) for b in page.get_text("dict")["blocks"] for l in b.get("lines", [])}
            rotate = 90 if (0, -1) in dirs else 0
            pix = page.get_pixmap(matrix=pymupdf.Matrix(150 / 72, 150 / 72).prerotate(rotate))
            png = pix.tobytes("png")
            name = f"section-{no:02d}-p{pno}.png"
            (OUT / "drawings" / name).write_bytes(png)
            drawings.append({"section": no, "page": pno, "file": f"drawings/{name}", "sha256": sha256(png), "width": pix.width,
                             "height": pix.height, "rotated_deg": rotate, "source_ref": f"{PREFIX} p{pno} (drawing)"})

    for s in sections.values():
        s["group"] = "TWIN SHAFT MIXER MD 5000/3350" if s["no"] in MIXER_SECTIONS else None
    meta = {
        "source_file": "original/imer/CR_LIBANO_74_2010.pdf", "sha256": src_sha, "pages": doc.page_count,
        "publisher": "Le Officine Riunite - Udine S.p.A., Via Santa Caterina 35, 33030 Basaldella di Campoformido (UD), Italy",
        "manufacturer": "IMER (ORU)", "plant_type": "CONCRETE BATCHING PLANT", "plant_model": "LOGIK 2WXL 4/10",
        "mixer_model": "MD 5000/3350", "serial_number": "10090213", "revision": "R0",
        "equipment_name": "IMER LOGIK 2WXL 4/10 (S/N 10090213)", "equipment_code": "IMER-10090213",
        "ordering_rule": "Orders must include the plant serial number, the part code, the description and the quantity. "
                         "Lines without a code are not sold separately; they only show what a kit contains.",
        "not_extracted": "p1 cover, p2 blank, p3 contents, p4 ordering example, p49-52 warranty conditions and forms",
    }
    data = {"meta": meta, "sections": [sections[k] for k in sorted(sections)], "lines": lines, "drawings": drawings}
    (OUT / "catalogue.json").write_text(json.dumps(data, indent=1, ensure_ascii=False))
    with open(OUT / "rows.csv", "w", newline="", encoding="utf-8") as f:
        cols = ["source_ref", "section", "page", "kind", "role", "position_raw", "position", "code", "description", "qty_raw", "qty", "unit", "heading", "transcribed"]
        w = csv.DictWriter(f, fieldnames=cols, extrasaction="ignore")
        w.writeheader()
        w.writerows(lines)
    parts = [l for l in lines if l["kind"] == "PART"]
    print(json.dumps({"sections": len(sections), "lines": len(lines), "part_lines": len(parts), "distinct_codes": len({l['code'] for l in parts}),
                      "info_lines": len(lines) - len(parts), "drawings": len(drawings)}, indent=1))


if __name__ == "__main__":
    main()
