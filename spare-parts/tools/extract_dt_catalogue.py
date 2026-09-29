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

# column boundaries in page-image pixels (pages are 1300 x 1839)
COL_SUITABLE = (118, 288)
COL_TAG = (292, 298)
COL_DESC = (325, 608)
COL_DETAILS = (612, 812)
COL_REPLACES = (812, 1096)
COL_DT = (1090, 1262)
DT_RE = re.compile(r"\b(\d\.\d{5}[A-Z]?)\b")
QR_RE = re.compile(r"id=([0-9.]+[A-Z]?)")
MAKERS = ("MAN", "VOITH", "ZF", "KNORR", "WABCO", "BOSCH", "MERCEDES", "SCANIA", "VOLVO", "DAF", "IVECO", "RENAULT", "EATON", "MAHLE", "HALDEX", "MERITOR", "BPW", "SAF", "BEHR", "SACHS", "HELLA", "CONTI", "DEUTZ", "CUMMINS")


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
        if r["conf"] >= min_conf:
            out.setdefault(r["line"], []).append(r)
    return [" ".join(w["text"] for w in sorted(ws, key=lambda w: w["x"])) for _, ws in sorted(out.items(), key=lambda kv: min(w["y"] for w in kv[1]))]


def decode_qrs(gray: np.ndarray):
    """[(y_top, y_bottom, dt_number)] for the QR codes in the DT-number column."""
    x0, x1 = COL_DT
    strip = gray[:, x0:x1]
    big = cv2.resize(strip, None, fx=2, fy=2, interpolation=cv2.INTER_CUBIC)
    det = cv2.QRCodeDetector()
    ok, _, pts, _ = det.detectAndDecodeMulti(big)
    found = []
    if pts is None:
        return found
    for p in pts:
        (px0, py0), (px1, py1) = p.min(0) / 2, p.max(0) / 2
        crop = strip[max(0, int(py0) - 8):int(py1) + 8, max(0, int(px0) - 8):int(px1) + 8]
        value = None
        for s in (4, 3, 5, 6):
            for th in (128, 150, 110):
                c = cv2.resize(crop, None, fx=s, fy=s, interpolation=cv2.INTER_NEAREST)
                _, c = cv2.threshold(c, th, 255, cv2.THRESH_BINARY)
                c = cv2.copyMakeBorder(c, 40, 40, 40, 40, cv2.BORDER_CONSTANT, value=255)
                v = det.detectAndDecode(c)[0]
                m = QR_RE.search(v or "")
                if m:
                    value = m.group(1)
                    break
            if value:
                break
        found.append((int(py0), int(py1), value))
    return sorted(found)


def tag_runs(gray: np.ndarray, y0: int, y1: int):
    """Rows of the grey language tags (EN, DE, FR, ...) inside an item."""
    col = gray[y0:y1, COL_TAG[0]:COL_TAG[1]].min(1)
    runs, start = [], None
    for i, v in enumerate(col):
        if v < 215 and start is None:
            start = i
        elif v >= 215 and start is not None:
            if i - start >= 12:
                runs.append((y0 + start, y0 + i))
            start = None
    return runs


def parse_replaces(lines):
    refs, maker = [], None
    for ln in lines:
        ln = ln.replace("|", " ").strip()
        m = re.match(r"^([A-Z][A-Za-z\-]+)\s*[:;]\s*(.*)$", ln)
        rest = ln
        if m and m.group(1).upper() in MAKERS:
            maker, rest = m.group(1).upper(), m.group(2)
        for num in re.findall(r"[0-9A-Z][0-9A-Z.\-/ ]{4,}[0-9A-Z]", rest):
            num = num.strip()
            if maker and re.search(r"\d", num):
                refs.append({"maker": maker, "number": num.replace(" ", "")})
    return refs


def photo_crop(rgb: np.ndarray, gray: np.ndarray, y0: int, y1: int, text_boxes):
    """Largest non-text blob in the Details/Replaces area of an item = the part photo."""
    xa, xb = 560, COL_REPLACES[1]
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
    m = re.search(r"\b(\d{3})\s?([A-Z])\b", txt.replace("O", "0"))
    code = f"{m.group(1)} {m.group(2)}" if m else None
    title = re.sub(r"\b\d{3}\s?[A-Z]\b", "", txt.split("\n")[0]).strip(" -_|=—") if txt else ""
    return code, title


def read_page(task):
    file, idx, page_no = task
    doc = pymupdf.open(file)
    xref = doc[idx].get_images(full=True)[0][0]
    raw = doc.extract_image(xref)["image"]
    rgb = np.array(Image.open(io.BytesIO(raw)).convert("RGB"))
    gray = cv2.cvtColor(rgb, cv2.COLOR_RGB2GRAY)
    result = {"page": page_no, "kind": "other", "items": []}
    top_txt = ocr(gray[40:180, 100:1270], psm=6)
    if re.search(r"Replaces\s+MAN", top_txt) or "Index" in top_txt[:120]:
        rows = ocr(gray[150:1760, 80:1270], psm=6)
        pairs = re.findall(r"(\d{2}[.,]\d{5}[.,]\d{4}[A-Z0-9]*)\s*(?:S\d?|\$\d?)?\s+(\d\.\d{5}[A-Z]?)\s+(\d{1,3})\b", rows)
        result.update(kind="index", index=[{"man": a.replace(",", "."), "dt": b, "page": int(c)} for a, b, c in pairs])
        return result
    if "Description" not in top_txt and "Suitable" not in top_txt:
        return result
    result["kind"] = "parts"
    result["section_code"], result["section_title"] = header(gray)
    qrs = decode_qrs(gray)
    # fallback / cross-check: bold DT numbers printed above the QR codes
    dt_rows = ocr(gray[150:1760, COL_DT[0]:COL_DT[1]], psm=6, tsv=True)
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
        tags = tag_runs(gray, y0, y1)
        en_y0 = tags[0][0] - 4 if tags else y0
        en_y1 = tags[1][0] - 3 if len(tags) > 1 else en_y0 + 32
        de_y1 = tags[2][0] - 3 if len(tags) > 2 else (tags[1][1] + 6 if len(tags) > 1 else en_y1 + 32)
        en = " ".join(ocr(gray[en_y0:en_y1, COL_DESC[0]:COL_DESC[1]], psm=6).split())
        de = " ".join(ocr(gray[en_y1:de_y1, COL_DESC[0]:COL_DESC[1]], psm=6).split()) if len(tags) > 1 else ""
        suit_rows = ocr(gray[y0:y1, COL_SUITABLE[0]:COL_SUITABLE[1]], psm=6, tsv=True)
        det_rows = ocr(gray[y0:y1, COL_DETAILS[0]:COL_DETAILS[1]], psm=6, tsv=True)
        rep_rows = ocr(gray[y0:y1, COL_REPLACES[0]:COL_REPLACES[1]], psm=6, tsv=True)
        boxes = [(r["x"] + COL_DETAILS[0], r["y"] + y0, r["w"], r["h"]) for r in det_rows if r["conf"] > 50] + \
                [(r["x"] + COL_REPLACES[0], r["y"] + y0, r["w"], r["h"]) for r in rep_rows if r["conf"] > 50]
        photo = photo_crop(rgb, gray, y0, y1, boxes)
        replaces_lines = lines_of(rep_rows, 50)
        result["items"].append({
            "n": n + 1, "y": int(y0), "dt": a["dt"], "dt_from_qr": a["qr"], "dt_printed": a["printed"],
            "en": en, "de": de, "suitable": " ".join(lines_of(suit_rows, 50)), "details": " ".join(lines_of(det_rows, 50)),
            "replaces_raw": replaces_lines, "replaces": parse_replaces(replaces_lines), "language_tags": len(tags),
            "photo": photo.hex() if photo else None,
        })
    return result


def main():
    files = sorted(SRC.glob("MAN-TGA-TGS-TGX-TGL-TGM_Catalogue-*.pdf"), key=lambda p: int(re.search(r"-(\d+)\.pdf$", p.name).group(1)))
    tasks, sources, offset = [], [], 0
    for f in files:
        d = pymupdf.open(f)
        sources.append({"file": f"original/dt/{f.name}", "sha256": sha256(f.read_bytes()), "pages": d.page_count, "first_page": offset + 1})
        tasks += [(str(f), i, offset + i + 1) for i in range(d.page_count)]
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
    last = (None, None)
    for pg in pages:
        if pg["kind"] != "parts":
            continue
        code = pg.get("section_code") or last[0]
        title = pg.get("section_title") or last[1]
        last = (code, title)
        s = sections.setdefault(code, {"code": code, "title": title, "pages": []})
        s["pages"].append(pg["page"])
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
            if man and not it["index_confirmed"]:
                flags.append("MAN_NUMBER_NOT_IN_INDEX")
            it.update({"section": code, "page": pg["page"], "source_ref": f"{PREFIX} p{pg['page']} #{it['n']}", "flags": flags})
            items.append(it)
    quality = {
        "pages": len(pages), "parts_pages": sum(p["kind"] == "parts" for p in pages), "index_pages": sum(p["kind"] == "index" for p in pages),
        "items": len(items), "distinct_dt": len({i["dt"] for i in items if i["dt"]}), "dt_from_qr": sum(i["dt_from_qr"] for i in items),
        "flags": {f: sum(f in i["flags"] for i in items) for f in sorted({f for i in items for f in i["flags"]})},
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
