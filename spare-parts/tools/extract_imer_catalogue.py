#!/usr/bin/env python3
"""
Read-only extractor for the IMER / ORU spare-parts books in source-data/original/imer/ (one book per plant serial number).

The PDFs are never written to. Two table layouts exist:
  ORU    "POS. CODE DESCRIPTION Q.TY" tables, mostly printed sideways (books LIBANO 74, 76, 77). Scanned gearbox
         lists (pages 42/44/46 of books 74 and 77, the same images) come from the manual transcription in
         source-data/transcribed/imer-10090213-gearboxes.json, applied only when the page image is byte-identical.
  MULTI  "Rif. Cod. Descrizione (I) / F / GB / E / D / Note" tables (book LIBANO 79); no quantity column,
         some rows highlighted in yellow.

Outputs per book (source-data/extracted/imer-<serial>/):
  catalogue.json   plant, sections, every table line with provenance ("IMER-10090213 p6 L3")
  rows.csv         the same lines, flat
  drawings/*.png   each section's exploded drawing rendered at 150 dpi and turned upright

Usage:  python3 spare-parts/tools/extract_imer_catalogue.py [serial ...]
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
TRANSCRIBED = ROOT / "source-data" / "transcribed" / "imer-10090213-gearboxes.json"
PUBLISHER = "Le Officine Riunite - Udine S.p.A., Via Santa Caterina 35, 33030 Basaldella di Campoformido (UD), Italy"
ORDERING_RULE = ("Orders must include the plant serial number, the part code, the description and the quantity. "
                 "Lines without a code are not sold separately; they only show what a kit contains.")

BOOKS = [
    {"pdf": "imer/CR_LIBANO_74_2010.pdf", "layout": "ORU", "serial": "10090213", "plant_model": "LOGIK 2WXL 4/10",
     "mixer_model": "MD 5000/3350", "revision": "R0", "equipment_name": "IMER LOGIK 2WXL 4/10 (S/N 10090213)",
     "group": ("TWIN SHAFT MIXER MD 5000/3350", range(14, 24)), "transcription": True,
     "not_extracted": "p1 cover, p2 blank, p3 contents, p4 ordering example, p49-52 warranty conditions and forms"},
    {"pdf": "imer/CR_PDF_LIBANO_76.pdf", "layout": "ORU", "serial": "11010013", "plant_model": "ORU ONEDAY",
     "mixer_model": "Saturno MS 2250/1500S (pan mixer)", "revision": "R0", "equipment_name": "IMER ORU ONEDAY (S/N 11010013)",
     "group": ("PAN MIXER SATURNO MS 2250/1500S", range(12, 20)), "transcription": False,
     "not_extracted": "p1 cover, p2 blank, p3 contents, p4 ordering example, p43-46 warranty conditions and forms"},
    {"pdf": "imer/CR_PDF_LIBANO_77.pdf", "layout": "ORU", "serial": "11060151", "plant_model": "LOGIK WXL4/8SC-MD",
     "mixer_model": "MD 5000/3350", "revision": "R0", "equipment_name": "IMER LOGIK WXL4/8SC-MD (S/N 11060151)",
     "group": ("TWIN SHAFT MIXER MD 5000/3350", range(14, 24)), "transcription": True,
     "not_extracted": "p1 cover, p2 blank, p3 contents, p4 ordering example, p49-52 warranty conditions and forms"},
    {"pdf": "imer/CR_LIBANO79.pdf", "layout": "MULTI", "serial": "12010006", "plant_model": "LOGIK WB 4-82",
     "mixer_model": "MD3000", "revision": "03/12 R0 (catalogue n. 02/0429c)", "equipment_name": "IMER LOGIK WB 4-82 (S/N 12010006)",
     "group": ("TWIN SHAFT MIXER MD3000", range(14, 24)), "transcription": False,
     "not_extracted": "p1 cover, p2 blank, p3 ordering instructions, p4 index, p60 order form, p61-63 warranty, p64 back cover"},
]

POS_RE = re.compile(r"^(\d{1,3}[A-Z]?(/\d{1,2})*|[A-Z]|-)$")
CODE_RE = re.compile(r"^[A-Z0-9]{4,}$")  # e.g. K1017995, 94100500, V2Z5, VLYQ
FOOTER_RE = re.compile(r"^Rev\. \d+ Pag")
NO_CODE = {"", "-", "/"}


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
    ws = [w[:4] + ("Q.TY" if w[4] == "Q.TE" else w[4],) + w[5:] for w in ws]  # some books print "Q.TE"
    rotated = heads[0][2] - heads[0][0] < heads[0][3] - heads[0][1]
    code_head = min((w for w in ws if w[4] == "CODE"), key=lambda w: abs(w[0] - heads[0][0]) + abs(w[1] - heads[0][1]))
    upward = code_head[1] < heads[0][1]  # sideways text read bottom-to-top (else top-to-bottom, page printed the other way)
    # normalise: L = line coordinate (increasing down the table), R = reading position (increasing), T = text
    if not rotated:
        N = [(round(w[1]), w[0], w[4]) for w in ws]
    elif upward:
        N = [(round(w[0]), -w[3], w[4]) for w in ws]
    else:
        N = [(-round(w[2]), w[1], w[4]) for w in ws]
    hl = min(n[0] for n in N if n[2] == "POS.")
    hs = sorted([n for n in N if n[2] in ("POS.", "CODE", "DESCRIPTION", "Q.TY") and abs(n[0] - hl) < 3], key=lambda n: n[1])
    # blocks of four headers (POS., CODE, DESCRIPTION, Q.TY in any order), side by side
    blocks = [hs[i:i + 4] for i in range(0, len(hs), 4)]
    for b in blocks:
        assert sorted(h[2] for h in b) == ["CODE", "DESCRIPTION", "POS.", "Q.TY"], [h[2] for h in hs]
    key = {"POS.": "pos", "CODE": "code", "DESCRIPTION": "desc", "Q.TY": "qty"}
    out = []
    for bi, b in enumerate(blocks):
        start, end = b[0][1] - 8, (blocks[bi + 1][0][1] - 3 if bi + 1 < len(blocks) else 1e9)
        heads_r = [(h[1], key[h[2]]) for h in b]
        def column(R):
            # the quantity column is right-aligned: its values start a little after its heading
            cands = [(hr, k) for hr, k in heads_r if R >= hr - (6 if k == "qty" else 0) - 6]
            return max(cands)[1] if cands else heads_r[0][1]
        lines = {}
        for L, R, T in N:
            if L <= hl + 4 or not (start <= R < end):
                continue
            col = column(R)
            k2 = next((k for k in lines if abs(k - L) <= 2), L)
            lines.setdefault(k2, []).append((col, R, T))
        for x in sorted(lines):
            cells = {}
            for col, _, t in sorted(lines[x], key=lambda c: c[1]):
                cells.setdefault(col, []).append(t)
            out.append({"block": bi + 1, "line": x, **{k: " ".join(v) for k, v in cells.items()}})
    return out


def extract_oru(doc, cfg, PREFIX):
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
                if FOOTER_RE.match(desc) or FOOTER_RE.match(" ".join(v for v in raw_cells.values() if v)):
                    continue  # page footer ("Rev. 0 Page 15")
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

    # Scanned gearbox lists (manual transcription), only where the scanned page image is byte-identical
    tr = json.loads(TRANSCRIBED.read_text()) if cfg["transcription"] else {"lists": []}
    for lst in tr["lists"]:
        img = doc.extract_image(doc[lst["page"] - 1].get_images(full=True)[0][0])["image"]
        assert sha256(img) == lst["page_image_sha256"], f"scanned page {lst['page']} differs from the transcribed one"
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
            feeder = next(m.group(1) for n in s["notes"] if (m := re.match(r"^(\S+) \(Screw feeder code\)", n["text"])))
            s["notes"].insert(0, {"source_ref": f"{PREFIX} p{s['table_page']}", "display": True, "text":
                "ATTENTION: by requesting screw feed spare parts, indicate the data relevant to screw feed itself. Example: for ordering "
                f"spare part with position 1/2, the order will be as follows: {feeder} (Screw feeder code) - Reduction gear (Description) "
                "- 1 (Requested quantity)"})
    for no, s in sections.items():
        if "gearbox_list" in s:
            s["notes"].append({"source_ref": f"{PREFIX} p{s['table_page']}", "display": True, "text": "Markers: " + "; ".join(f"{k} = {v}" for k, v in tr["markers"].items())})
    return sections, lines


LANGS = ["it", "fr", "en", "es", "de"]


def extract_multi(doc, cfg, PREFIX):
    """Book layout "Rif. | Cod. | I | F | GB | E | D | Note" (one line per row, no quantity column)."""
    sections, lines = {}, []
    for pno in range(4, doc.page_count):
        page = doc[pno]
        head = page.get_text().strip().split("\n")[:3]
        m = next((re.match(r"^(\d{1,2}) ([A-Z].+)$", h.strip()) for h in head if re.match(r"^(\d{1,2}) ([A-Z].+)$", h.strip())), None)
        if not m:
            continue
        no = int(m.group(1))
        s = sections.setdefault(no, {"no": no, "title": m.group(2).strip(), "pages": [], "notes": []})
        s["pages"].append(pno + 1)
        M = page.rotation_matrix
        words = [(pymupdf.Rect(w[:4]) * M, w[4]) for w in page.get_text("words")]
        hdr = [r for r, t in words if t == "Rif."]
        if not hdr:
            continue
        s.setdefault("table_pages", []).append(pno + 1)
        # column separators = vertical rules of the table
        xs = set()
        for dr in page.get_drawings():
            for it in dr["items"]:
                if it[0] == "l":
                    a, b = it[1] * M, it[2] * M
                    if abs(a.x - b.x) < 0.5 and abs(a.y - b.y) > 20:
                        xs.add(round(a.x))
                elif it[0] == "re":
                    r = it[1] * M
                    if r.width < 2 and r.height > 20:
                        xs.add(round(r.x0))
        xs = sorted(xs)
        assert len(xs) == 9, (pno + 1, xs)
        cols = ["pos", "code"] + LANGS + ["note"]
        yellow = [dr["rect"] * M for dr in page.get_drawings() if dr.get("fill") and dr["fill"][0] > 0.9 and dr["fill"][1] > 0.8 and dr["fill"][2] < 0.7]
        top = hdr[0].y1 + 2
        body = [(r, t) for r, t in words if r.y0 > top and xs[0] <= r.x0 < xs[-1]]
        anchors = sorted({round(r.y0) for r, t in body if xs[1] <= r.x0 < xs[2]})  # rows = lines with a code cell
        rows = {}
        for r, t in body:
            y = min(anchors, key=lambda a: abs(a - r.y0)) if anchors else None
            if y is None or abs(y - r.y0) > 7:
                if t.isdigit():
                    continue  # printed page number
                s["notes"].append({"source_ref": f"{PREFIX} p{pno + 1}", "text": t})
                continue
            col = cols[max(i for i in range(8) if r.x0 >= xs[i] - 1)]
            rows.setdefault(y, {}).setdefault(col, []).append((r.x0, t, r))
        for n, y in enumerate(sorted(rows), start=1):
            cells = {k: " ".join(t for _, t, _ in sorted(v, key=lambda c: c[0])) for k, v in rows[y].items()}
            code_rects = [r for _, _, r in rows[y].get("code", [])]
            hl = any(any(yr.intersects(cr) for cr in code_rects) for yr in yellow)
            code = cells.get("code", "")
            pos = cells.get("pos", "")
            name = cells.get("en") or cells.get("it") or ""
            note = cells.get("note", "")
            lines.append({
                "kind": "PART" if CODE_RE.match(code) else "INFO", "role": "MAIN", "position_raw": pos, "position": pos or None,
                "parent_position": pos.rsplit("/", 1)[0] if "/" in pos else None, "code": code if CODE_RE.match(code) else None,
                "description": (name + (f" {note}" if note else "")).strip(), "qty_raw": "", "qty": None, "unit": "PCS",
                "source_ref": f"{PREFIX} p{pno + 1} L{n}", "page": pno + 1, "section": no, "heading": None, "transcribed": False,
                "highlighted": hl, "names": {k: cells.get(k, "") for k in LANGS}, "note": note, "raw": cells,
            })
    for s in sections.values():
        if s.get("table_pages"):
            s["table_page"] = s["table_pages"][0]
    for no in [no for no, s in sections.items() if not s.get("table_pages")]:
        del sections[no]  # order form / warranty pages
    return sections, lines


def extract(cfg):
    pdf = (ORIGINAL / cfg["pdf"]).read_bytes()
    doc = pymupdf.open(stream=pdf, filetype="pdf")
    src_sha = sha256(pdf)
    PREFIX = f"IMER-{cfg['serial']}"
    OUT = ROOT / "source-data" / "extracted" / f"imer-{cfg['serial']}"
    OUT.mkdir(parents=True, exist_ok=True)
    (OUT / "drawings").mkdir(exist_ok=True)
    sections, lines = (extract_oru if cfg["layout"] == "ORU" else extract_multi)(doc, cfg, PREFIX)

    # Drawings: the page of each section without a table (turned upright), rendered at 150 dpi.
    drawings = []
    for no, s in sorted(sections.items()):
        for pno in s["pages"]:
            if pno == s.get("table_page") or pno in s.get("table_pages", []):
                continue
            page = doc[pno - 1]
            dirs = {tuple(round(v) for v in l["dir"]) for b in page.get_text("dict")["blocks"] for l in b.get("lines", [])}
            rotate = 90 if cfg["layout"] == "ORU" and (0, -1) in dirs else 0  # MULTI pages carry /Rotate, applied by the renderer
            pix = page.get_pixmap(matrix=pymupdf.Matrix(150 / 72, 150 / 72).prerotate(rotate))
            png = pix.tobytes("png")
            name = f"section-{no:02d}-p{pno}.png"
            (OUT / "drawings" / name).write_bytes(png)
            drawings.append({"section": no, "page": pno, "file": f"drawings/{name}", "sha256": sha256(png), "width": pix.width,
                             "height": pix.height, "rotated_deg": rotate, "source_ref": f"{PREFIX} p{pno} (drawing)"})

    group, group_sections = cfg["group"]
    for s in sections.values():
        s["group"] = group if s["no"] in group_sections else None
    meta = {
        "source_file": f"original/{cfg['pdf']}", "sha256": src_sha, "pages": doc.page_count, "layout": cfg["layout"],
        "publisher": PUBLISHER, "manufacturer": "IMER (ORU)", "plant_type": "CONCRETE BATCHING PLANT", "plant_model": cfg["plant_model"],
        "mixer_model": cfg["mixer_model"], "serial_number": cfg["serial"], "revision": cfg["revision"],
        "equipment_name": cfg["equipment_name"], "equipment_code": PREFIX, "ordering_rule": ORDERING_RULE,
        "not_extracted": cfg["not_extracted"],
    }
    data = {"meta": meta, "sections": [sections[k] for k in sorted(sections)], "lines": lines, "drawings": drawings}
    (OUT / "catalogue.json").write_text(json.dumps(data, indent=1, ensure_ascii=False))
    with open(OUT / "rows.csv", "w", newline="", encoding="utf-8") as f:
        cols = ["source_ref", "section", "page", "kind", "role", "position_raw", "position", "code", "description", "qty_raw", "qty", "unit", "heading", "transcribed", "highlighted"]
        w = csv.DictWriter(f, fieldnames=cols, extrasaction="ignore")
        w.writeheader()
        w.writerows(lines)
    parts = [l for l in lines if l["kind"] == "PART"]
    print(json.dumps({"book": cfg["pdf"], "sections": len(sections), "lines": len(lines), "part_lines": len(parts), "distinct_codes": len({l['code'] for l in parts}),
                      "info_lines": len(lines) - len(parts), "drawings": len(drawings)}))


if __name__ == "__main__":
    wanted = set(sys.argv[1:])
    for book in BOOKS:
        if not wanted or book["serial"] in wanted:
            extract(book)
