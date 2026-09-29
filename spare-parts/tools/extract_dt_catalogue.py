#!/usr/bin/env python3
"""
Read-only extractor for the DT Spare Parts catalogue "Spare parts suitable for MAN TGA/TGS/TGX, TGL/TGM"
(source-data/original/dt/MAN-TGA-TGS-TGX-TGL-TGM_Catalogue-<n>.pdf, the catalogue split into files of 50 pages).

Every page is a scanned picture (no text layer), so the pages are read with OCR (tesseract):
  * the DT number of each item comes from its QR code ("http://dtpi.de/?id=4.40097"); OCR is only a fallback;
  * each column is read from its own crop: Suitable for | Description (EN + DE line, located by the grey
    language tags) | Details | Replaces (e.g. "MAN: 51.04205.0021") ;
  * the part photo of each item is cut out and stored small;
  * the index pages (MAN number -> DT number -> page) are read to cross-check the "Replaces" numbers.
The PDFs are never written to. Every item keeps its provenance ("DT-MAN p121 #1").

Outputs (source-data/extracted/dt-man-tga/):
  catalogue.json   sections, items, index pairs, quality report
  items.csv        the same items, flat
  photos/*.jpg     one small photo per item (<DT number>.jpg)

Usage:  python3 spare-parts/tools/extract_dt_catalogue.py            (needs tesseract, opencv-python-headless)
"""
import csv
import hashlib
import io
import json
import os
import re
import subprocess
import sys
import tempfile
from multiprocessing import Pool
from pathlib import Path

import cv2
import numpy as np
import pymupdf
from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
SRC = ROOT / "source-data" / "original" / "dt"
OUT = ROOT / "source-data" / "extracted" / "dt-man-tga"
PREFIX = "DT-MAN"
os.environ["OMP_THREAD_LIMIT"] = "1"

# Column layout in page-image pixels (pages are 1300 x 1839). Odd pages: Suitable for | Description | Details |
# Replaces | DT No.; even pages are mirrored. The real positions are taken from each page's header row.
ODD_HEADERS = {"suitable": 134, "desc": 292, "details": 621, "replaces": 819, "dt": 1150}
EVEN_HEADERS = {"dt": 72, "replaces": 196, "details": 492, "desc": 680, "suitable": 1038}
PAGE_RIGHT = 1262
PAGE_LEFT = 60


def layout(heads):
    """Column x-ranges from header x positions."""
    order = sorted(heads.items(), key=lambda kv: kv[1])
    cols = {}
    for i, (k, x) in enumerate(order):
        x0 = x - 12 if i else PAGE_LEFT
        x1 = order[i + 1][1] - 10 if i + 1 < len(order) else PAGE_RIGHT
        cols[k] = (max(PAGE_LEFT, x0), x1)
    if order[0][0] == "dt":  # mirrored page: the DT number column starts at the page margin
        cols["dt"] = (PAGE_LEFT, heads["replaces"] - 10)
    else:
        cols["dt"] = (heads["dt"] - 70, PAGE_RIGHT)
    d0, d1 = cols["desc"]
    cols["tag"] = (heads["desc"] + 1, heads["desc"] + 7)
    cols["desc_text"] = (heads["desc"] + 32, d1)
    a = min(cols["details"][0], cols["replaces"][0])
    b = max(cols["details"][1], cols["replaces"][1])
    cols["photo"] = (a, b)
    return cols


def find_layout(gray):
    rows = ocr(gray[135:200, PAGE_LEFT:PAGE_RIGHT], psm=11, tsv=True)
    found = {}
    names = {"Suitable": "suitable", "Description": "desc", "Details": "details", "Replaces": "replaces", "DT": "dt"}
    for r in rows:
        k = names.get(r["text"].strip(".:"))
        if k and k not in found:
            found[k] = r["x"] + PAGE_LEFT
    base = EVEN_HEADERS if found.get("dt", 9999) < 400 or found.get("replaces", 9999) < 400 else ODD_HEADERS
    heads = {k: found.get(k, v) for k, v in base.items()}
    return layout(heads), found
DT_RE = re.compile(r"\b(\d\.\d{5}[A-Z]?)\b")
QR_RE = re.compile(r"id=([0-9.]+[A-Z]?)")
MAKERS = ("MAN", "VOITH", "ZF", "KNORR", "WABCO", "BOSCH", "MERCEDES", "SCANIA", "VOLVO", "DAF", "IVECO", "RENAULT", "EATON", "MAHLE", "HALDEX", "MERITOR", "BPW", "SAF", "BEHR", "SACHS", "HELLA", "CONTI", "DEUTZ", "CUMMINS")


# Sections as printed in the catalogue's "List of Contents" (page 33): code, title, first page, main group.
# Items are assigned to the section whose page range contains their page (more reliable than OCR of each page header).
CONTENTS = [
    ("ENGINE", [("010 A", "Crankcase", 63), ("010 B", "Piston & Liner", 72), ("010 C", "Engine Suspension", 84), ("020 A", "Crankshaft", 87),
                ("020 B", "Flywheel", 91), ("020 C", "Connecting Rod", 97), ("030 A", "Cylinder Head", 103), ("040 A", "Engine Control - Cylinder Head", 114),
                ("040 B", "Engine Control - Camshaft", 122), ("050 A", "Oil Pump", 125), ("050 B", "Oil Filter & Oil Cooler", 128), ("050 C", "Oil Sump", 136),
                ("060 A", "Water Pump", 140), ("060 B", "Thermostat", 149), ("060 C", "Fan", 153), ("060 D", "Radiator & Intercooler", 165),
                ("060 E", "Radiator Hoses", 173), ("080 A", "Intake & Exhaust Manifold", 183), ("080 B", "Air Filter", 193), ("090 A", "Turbocharger", 196)]),
    ("FUEL & EXHAUST SYSTEM", [("100 A", "Injection Nozzles", 207), ("110 A", "Injection Pump", 218), ("120 A", "Fuel Filter", 226), ("120 B", "Fuel Tank", 233),
                               ("150 A", "Silencer", 239), ("150 B", "Exhaust Pipes", 245), ("150 C", "Clamps", 250), ("159 A", "Exhaust Brake", 253)]),
    ("ELECTRICAL SYSTEM", [("250 A", "Lighting, Front", 257), ("250 B", "Lighting, Rear", 270), ("250 C", "Bulbs", 278), ("250 D", "Relays", 288),
                           ("250 E", "Instrument Panel", 295), ("260 A", "Starter", 304), ("260 B", "Alternator", 313), ("260 C", "Belt Tensioner", 320),
                           ("260 D", "V-Belts", 327), ("260 E", "Wiper System", 336), ("261 A", "Battery", 339), ("270 A", "Sensors", 345), ("290 A", "Accessory", 361)]),
    ("CLUTCH", [("300 A", "Clutch Cover & Clutch Disc", 363), ("300 B", "Housing", 377), ("300 C", "Pedal & Cylinder", 381)]),
    ("GEARBOX", [("320 A", "Housing", 384), ("320 B", "Input Shaft", 393), ("320 C", "Main Shaft", 395), ("320 D", "Countershaft", 402),
                 ("320 E", "Planetary Gear", 404), ("320 F", "Shifting Shaft", 408), ("320 G", "Valves & Cylinders", 409), ("329 A", "Shifting", 414)]),
    ("AXLES", [("350 A", "Steering Knuckle", 427), ("350 B", "Track Rod", 430), ("350 C", "Hub", 435), ("350 D", "Wheel Bolts & Nuts", 452),
               ("350 E", "Outer Planetary Gear", 460), ("353 A", "Housing & Differential", 476)]),
    ("WHEEL BRAKE", [("360 A", "Brake Drum", 494), ("360 B", "Camshaft & Slack Adjuster", 505), ("360 C", "Brake Disc", 512)]),
    ("PROPELLER SHAFT", [("390 A", "Propeller Shaft", 527)]),
    ("FRAME PARTS", [("412 A", "Bumper", 536)]),
    ("SUSPENSION", [("430 A", "Leaf Spring - Front Axle", 553), ("430 B", "Leaf Spring - Rear Axle", 557), ("430 C", "Shock Absorber", 561),
                    ("430 D", "Air Springs", 576), ("430 E", "V-Stay & Reaction Rod", 583), ("430 F", "Stabilizer", 594), ("430 G", "Bogie Axle", 601),
                    ("435 A", "Air Spring Level Valves", 603)]),
    ("STEERING", [("461 A", "Servo Pump", 605), ("461 B", "Oil Container", 611), ("461 C", "Drag Link", 613)]),
    ("BRAKE SYSTEM", [("510 A", "Connectors", 619), ("520 A", "Switches & Sensors", 622), ("520 B", "Air Dryer", 625), ("520 C", "Brake Valves", 628),
                      ("520 D", "Brake Cylinder", 645), ("520 E", "Air Tank", 655), ("540 A", "Compressor", 660)]),
    ("CABIN", [("610 A", "Suspension", 698), ("610 B", "Cabin Tilt", 710), ("610 C", "Front Flap", 713), ("610 D", "Boarding Step", 718),
               ("610 E", "Windows", 728), ("610 F", "Door", 733), ("610 G", "Mirror", 740), ("610 H", "Seat", 752), ("610 I", "Sun Visor", 753),
               ("619 A", "Heating, Ventilation, Air Conditioning", 756), ("660 A", "Front Fender", 766), ("661 A", "Rear Fender", 768)]),
    ("STANDARD PARTS", [("900 A", "O-Rings", 774)]),
]
FLAT = sorted(((first, code, title, group) for group, secs in CONTENTS for code, title, first in secs))


def section_of(page):
    found = None
    for first, code, title, group in FLAT:
        if page >= first:
            found = (code, title, group)
    return found


def sha256(b: bytes) -> str:
    return hashlib.sha256(b).hexdigest()


def ocr(img: np.ndarray, psm: int = 6, tsv: bool = False, scale: int = 2):
    """OCR a grey crop; returns text or TSV rows (coordinates in crop pixels)."""
    if img.size == 0:
        return [] if tsv else ""
    big = cv2.resize(img, None, fx=scale, fy=scale, interpolation=cv2.INTER_CUBIC)
    with tempfile.NamedTemporaryFile(suffix=".png") as f:
        cv2.imwrite(f.name, big)
        args = ["tesseract", f.name, "-", "--psm", str(psm)] + (["tsv"] if tsv else [])
        out = subprocess.run(args, capture_output=True, text=True).stdout
    if not tsv:
        return out.strip()
    rows = []
    for r in csv.DictReader(io.StringIO(out), delimiter="\t", quoting=csv.QUOTE_NONE):
        t = (r.get("text") or "").strip()
        if t and float(r["conf"]) >= 0:
            rows.append({"text": t, "conf": float(r["conf"]), "x": int(r["left"]) // scale, "y": int(r["top"]) // scale,
                         "w": int(r["width"]) // scale, "h": int(r["height"]) // scale, "line": (r["block_num"], r["par_num"], r["line_num"])})
    return rows


def lines_of(rows, min_conf=40):
    out = {}
    for r in rows:
        if r["conf"] >= min_conf and re.search(r"[A-Za-z0-9]", r["text"]):
            out.setdefault(r["line"], []).append(r)
    return [" ".join(w["text"] for w in sorted(ws, key=lambda w: w["x"])) for _, ws in sorted(out.items(), key=lambda kv: min(w["y"] for w in kv[1]))]


def _decode_one(det, crop):
    for sc in (4, 3, 5, 6, 8):
        for th in (128, 150, 110, 170):
            c = cv2.resize(crop, None, fx=sc, fy=sc, interpolation=cv2.INTER_NEAREST)
            _, c = cv2.threshold(c, th, 255, cv2.THRESH_BINARY)
            c = cv2.copyMakeBorder(c, 40, 40, 40, 40, cv2.BORDER_CONSTANT, value=255)
            m = QR_RE.search(det.detectAndDecode(c)[0] or "")
            if m:
                return m.group(1)
    return None


def decode_qrs(gray: np.ndarray, col):
    """[(y_top, y_bottom, dt_number or None)] for the QR codes in the DT-number column.
    QR codes are found as dark squares of about 86 px (more reliable than OpenCV's detector on these scans)."""
    x0, x1 = col
    pad = 20
    strip = cv2.copyMakeBorder(gray[:, x0:x1], 0, 0, pad, pad, cv2.BORDER_CONSTANT, value=255)
    _, bw = cv2.threshold(strip, 160, 255, cv2.THRESH_BINARY_INV)
    bw = cv2.dilate(bw, np.ones((7, 7), np.uint8))
    n, _, st, _ = cv2.connectedComponentsWithStats(bw)
    det = cv2.QRCodeDetector()
    found = []
    for i in range(1, n):
        x, y, w, h, area = st[i]
        if 70 <= w <= 115 and 70 <= h <= 115 and abs(w - h) < 14 and y > 150:
            crop = strip[max(0, y - 4):y + h + 4, max(0, x - 4):x + w + 4]
            found.append((int(y), int(y + h), _decode_one(det, crop)))
    return sorted(found)


def tag_runs(gray: np.ndarray, y0: int, y1: int, tag):
    """Rows of the grey language tags (EN, DE, FR, ...) inside an item."""
    col = gray[y0:y1, tag[0]:tag[1]].min(1)
    runs, start = [], None
    for i, v in enumerate(col):
        if v < 215 and start is None:
            start = i
        elif v >= 215 and start is not None:
            if 12 <= i - start <= 40:
                runs.append((y0 + start, y0 + i))
            start = None
    return runs


MAN_RE = re.compile(r"(\d{2})[.,](\d{5})[.,](\d{4})(?:\s*([S$][1-9]?)\b)?")


def parse_replaces(lines):
    """'MAN: 51.01113.6073 S1' / 'Mahle: 229 04 00' / '10 halves' -> refs + notes."""
    refs, notes, maker = [], [], None
    for ln in lines:
        ln = " ".join(ln.replace("|", " ").split())
        m = re.match(r"^([A-Za-z][A-Za-z\-]+)\s*[:;]\s*(.*)$", ln)
        rest = ln
        if m and m.group(1).upper() in MAKERS:
            maker, rest = m.group(1).upper(), m.group(2)
        mans = list(MAN_RE.finditer(rest))
        if mans:
            for mm in mans:
                refs.append({"maker": "MAN", "number": f"{mm.group(1)}.{mm.group(2)}.{mm.group(3)}",
                             "suffix": (mm.group(4) or "").replace("$", "S") or None})
            continue
        if maker and maker != "MAN" and re.fullmatch(r"[0-9A-Z][0-9A-Z .\-/]*[0-9A-Z]", rest) and sum(c.isdigit() for c in rest) >= 3:
            refs.append({"maker": maker, "number": rest, "suffix": None})
        elif rest and not (m and rest == ""):
            notes.append(ln)
    return refs, [n for n in notes if len(n) > 2]


def photo_crop(rgb: np.ndarray, gray: np.ndarray, y0: int, y1: int, text_boxes, area):
    """Largest non-text blob in the Details/Replaces area of an item = the part photo."""
    xa, xb = area
    region = gray[y0:y1, xa:xb].copy()
    mask = (region < 235).astype(np.uint8)
    for (bx, by, bw, bh) in text_boxes:
        cx0, cy0 = max(0, bx - xa - 3), max(0, by - y0 - 3)
        mask[cy0:cy0 + bh + 6, cx0:cx0 + bw + 6] = 0
    mask = cv2.dilate(mask, np.ones((9, 9), np.uint8))
    n, labels, stats, _ = cv2.connectedComponentsWithStats(mask)
    best = max(range(1, n), key=lambda i: stats[i, cv2.CC_STAT_AREA], default=None)
    if best is None or stats[best, cv2.CC_STAT_AREA] < 1500:
        return None
    x, y, w, h = stats[best, :4]
    crop = rgb[y0 + y:y0 + y + h, xa + x:xa + x + w]
    im = Image.fromarray(crop)
    im.thumbnail((320, 320))
    buf = io.BytesIO()
    im.save(buf, "JPEG", quality=78)
    return buf.getvalue()


def header(gray: np.ndarray):
    txt = ocr(gray[40:100, 100:1270], psm=6)
    m = re.search(r"\b([0-9O]{3})\s?([A-Z8])\b", txt)
    code = f"{m.group(1).replace('O', '0')} {m.group(2).replace('8', 'B')}" if m else None
    first = txt.split("\n")[0] if txt else ""
    first = re.sub(r"\b\d{3}\s?[A-Z8]\b", " ", first.replace("O0", "00"))
    words = [w for w in re.findall(r"[A-Za-z&][A-Za-z&\-]*", first) if len(w) > 1 or w == "&"]
    title = re.sub(r"(?<=[a-z])(?=[A-Z])", " ", " ".join(words))  # "CylinderHead" -> "Cylinder Head"
    title = re.sub(r"\s*&\s*", " & ", title).strip()
    return code, title


CACHE = Path(os.environ.get("DT_CACHE", "/tmp/dt-ocr-cache"))
READER_VERSION = "v3"


def read_page(task):
    """Cached per page (keyed by the file's SHA-256 and page index), so new catalogue files only cost their own pages."""
    file, idx, page_no, file_sha = task
    cache = CACHE / f"{file_sha[:16]}-{idx:03d}-{READER_VERSION}.json"
    if cache.exists():
        r = json.loads(cache.read_text())
        r["page"] = page_no
        return r
    r = _read_page(file, idx, page_no)
    CACHE.mkdir(parents=True, exist_ok=True)
    cache.write_text(json.dumps(r))
    return r


def _read_page(file, idx, page_no):
    doc = pymupdf.open(file)
    xref = doc[idx].get_images(full=True)[0][0]
    raw = doc.extract_image(xref)["image"]
    rgb = np.array(Image.open(io.BytesIO(raw)).convert("RGB"))
    gray = cv2.cvtColor(rgb, cv2.COLOR_RGB2GRAY)
    result = {"page": page_no, "kind": "other", "items": []}
    top_txt = ocr(gray[40:180, 100:1270], psm=6)
    if re.search(r"Replaces\s+MAN", top_txt) or "Index" in top_txt[:120]:
        rows = ocr(gray[150:1760, 80:1270], psm=6)
        # "51.02500.6298 S 3.90133 72" (the S/S1 set marker is often read as "5", "$" or glued to the number)
        pairs = re.findall(r"(\d{2})[.,](\d{5})[.,](\d{4})\S*\s*(?:[S$5][1-9]?\s+)?(\d\.\d{5}[A-Z]?)\s+(\d{1,3})\b", rows)
        result.update(kind="index", index=[{"man": f"{a}.{b}.{c}", "dt": d, "page": int(e)} for a, b, c, d, e in pairs])
        return result
    if "Description" not in top_txt and "Suitable" not in top_txt:
        return result
    result["kind"] = "parts"
    result["section_code"], result["section_title"] = header(gray)
    C, found = find_layout(gray)
    result["layout"] = {"mirrored": C["dt"][0] == PAGE_LEFT, "headers_found": sorted(found)}
    qrs = decode_qrs(gray, C["dt"])
    # fallback / cross-check: bold DT numbers printed above the QR codes
    dt_rows = ocr(gray[150:1760, C["dt"][0]:C["dt"][1]], psm=6, tsv=True)
    printed = [(r["y"] + 150, DT_RE.search(r["text"]).group(1)) for r in dt_rows if DT_RE.search(r["text"]) and r["conf"] > 30]
    anchors = []
    for (qy0, qy1, val) in qrs:
        near = [d for y, d in printed if qy0 - 60 < y < qy0 + 5]
        anchors.append({"y": qy0 - 42, "dt": val or (near[0] if near else None), "qr": bool(val), "printed": near[0] if near else None})
    for y, d in printed:  # items whose QR code was not found
        if not any(abs(a["y"] - (y - 6)) < 45 for a in anchors):
            anchors.append({"y": y - 6, "dt": d, "qr": False, "printed": d})
    anchors.sort(key=lambda a: a["y"])
    for n, a in enumerate(anchors):
        y0 = max(150, a["y"])
        y1 = anchors[n + 1]["y"] if n + 1 < len(anchors) else 1760
        tags = tag_runs(gray, y0, y1, C["tag"])
        en_y0 = tags[0][0] - 4 if tags else y0
        en_y1 = tags[1][0] - 3 if len(tags) > 1 else en_y0 + 32
        de_y1 = tags[2][0] - 3 if len(tags) > 2 else (tags[1][1] + 6 if len(tags) > 1 else en_y1 + 32)
        dx0, dx1 = C["desc_text"]
        en = " ".join(ocr(gray[en_y0:en_y1, dx0:dx1], psm=6).split())
        de = " ".join(ocr(gray[en_y1:de_y1, dx0:dx1], psm=6).split()) if len(tags) > 1 else ""
        # text in these columns sits in the first lines of the item; the photo is below it
        ty0 = max(150, (tags[0][0] - 10) if tags else y0)
        ty1 = min(y1, ty0 + 150)
        suit_rows = ocr(gray[ty0:min(y1, ty0 + 260), C["suitable"][0]:C["suitable"][1]], psm=6, tsv=True)
        det_rows = ocr(gray[ty0:ty1, C["details"][0]:C["details"][1]], psm=6, tsv=True)
        rep_rows = ocr(gray[ty0:ty1, C["replaces"][0]:C["replaces"][1]], psm=6, tsv=True)
        boxes = [(r["x"] + C["details"][0], r["y"] + ty0, r["w"], r["h"]) for r in det_rows if r["conf"] > 50] + \
                [(r["x"] + C["replaces"][0], r["y"] + ty0, r["w"], r["h"]) for r in rep_rows if r["conf"] > 50]
        photo = photo_crop(rgb, gray, y0, y1, boxes, C["photo"])
        replaces_lines = lines_of(rep_rows, 35)
        refs, rep_notes = parse_replaces(replaces_lines)
        result["items"].append({
            "n": n + 1, "y": int(y0), "dt": a["dt"], "dt_from_qr": a["qr"], "dt_printed": a["printed"],
            "en": en, "de": de, "suitable": " ".join(lines_of(suit_rows, 50)), "details": " ".join(w for w in " ".join(lines_of(det_rows, 35)).split() if w not in ("Sample", "}", "{", "|", "O", "o", "_")),
            "replaces_raw": replaces_lines, "replaces": refs, "replaces_notes": rep_notes, "language_tags": len(tags),
            "photo": photo.hex() if photo else None,
        })
    return result


def main():
    files = sorted(SRC.glob("MAN-TGA-TGS-TGX-TGL-TGM_Catalogue-*.pdf"), key=lambda p: int(re.search(r"-(\d+)\.pdf$", p.name).group(1)))
    tasks, sources, offset = [], [], 0
    for f in files:
        d = pymupdf.open(f)
        sources.append({"file": f"original/dt/{f.name}", "sha256": sha256(f.read_bytes()), "pages": d.page_count, "first_page": offset + 1})
        tasks += [(str(f), i, offset + i + 1, sources[-1]["sha256"]) for i in range(d.page_count)]
        offset += d.page_count
    limit = int(os.environ.get("DT_PAGES", "0") or 0)
    if limit:
        tasks = [t for t in tasks if t[2] <= limit]
    with Pool(int(os.environ.get("DT_JOBS", os.cpu_count() or 2))) as pool:
        pages = []
        for i, r in enumerate(pool.imap(read_page, tasks, chunksize=2)):
            pages.append(r)
            if i % 25 == 0:
                print(f"page {r['page']} ({r['kind']}, {len(r['items'])} items)", file=sys.stderr, flush=True)
    OUT.mkdir(parents=True, exist_ok=True)
    (OUT / "photos").mkdir(exist_ok=True)
    index = [p for pg in pages if pg["kind"] == "index" for p in pg["index"]]
    by_man = {}
    for p in index:
        by_man.setdefault(p["man"], set()).add(p["dt"])
    sections, items = {}, []
    for pg in pages:
        if pg["kind"] != "parts" or pg["page"] < FLAT[0][0]:
            continue
        code, title, group = section_of(pg["page"])
        s = sections.setdefault(code, {"code": code, "title": title, "group": group, "pages": [], "header_ocr": []})
        s["pages"].append(pg["page"])
        s["header_ocr"].append(f"{pg.get('section_code')} {pg.get('section_title')}")
        for it in pg["items"]:
            photo = it.pop("photo")
            if photo and it["dt"]:
                name = f"{it['dt']}.jpg"
                if not (OUT / "photos" / name).exists():
                    (OUT / "photos" / name).write_bytes(bytes.fromhex(photo))
                it["photo"] = f"photos/{name}"
            flags = []
            if not it["dt"]:
                flags.append("NO_DT_NUMBER")
            elif not it["dt_from_qr"]:
                flags.append("DT_NUMBER_FROM_OCR")
            if it["dt_printed"] and it["dt"] and it["dt_printed"] != it["dt"]:
                flags.append("PRINTED_DT_DIFFERS_FROM_QR")
            if not it["en"]:
                flags.append("NO_DESCRIPTION")
            man = [r["number"] for r in it["replaces"] if r["maker"] == "MAN"]
            it["index_confirmed"] = [m for m in man if it["dt"] in by_man.get(m, set())]
            # (not a flag: the index pages are read with OCR too and miss rows; spot checks showed the item's own number right)
            it.update({"section": code, "page": pg["page"], "source_ref": f"{PREFIX} p{pg['page']} #{it['n']}", "flags": flags})
            items.append(it)
    quality = {
        "pages": len(pages), "parts_pages": sum(p["kind"] == "parts" for p in pages), "index_pages": sum(p["kind"] == "index" for p in pages),
        "items": len(items), "distinct_dt": len({i["dt"] for i in items if i["dt"]}), "dt_from_qr": sum(i["dt_from_qr"] for i in items),
        "flags": {f: sum(f in i["flags"] for i in items) for f in sorted({f for i in items for f in i["flags"]})},
        "man_numbers_confirmed_by_index": sum(bool(i["index_confirmed"]) for i in items),
        "items_with_man_number": sum(any(r["maker"] == "MAN" for r in i["replaces"]) for i in items),
        "index_pairs": len(index),
    }
    meta = {"title": "Spare parts suitable for MAN TGA/TGS/TGX, TGL/TGM", "publisher": "DT Spare Parts (Diesel Technic)", "brand": "DT Spare Parts",
            "sources": sources, "note": "Reference numbers and names, with the exception of DT Spare Parts, are only intended for comparison purposes and may not be shown in invoices."}
    (OUT / "catalogue.json").write_text(json.dumps({"meta": meta, "quality": quality, "sections": list(sections.values()), "items": items, "index": index}, indent=1, ensure_ascii=False))
    with open(OUT / "items.csv", "w", newline="", encoding="utf-8") as f:
        w = csv.writer(f)
        w.writerow(["source_ref", "section", "page", "dt", "en", "de", "suitable", "details", "replaces", "flags"])
        for i in items:
            w.writerow([i["source_ref"], i["section"], i["page"], i["dt"], i["en"], i["de"], i["suitable"], i["details"],
                        "; ".join(f"{r['maker']}: {r['number']}" for r in i["replaces"]), " ".join(i["flags"])])
    print(json.dumps(quality, indent=1))


if __name__ == "__main__":
    main()
