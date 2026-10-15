#!/usr/bin/env python3
"""
Read-only extractor for DT Spare Parts online catalogues (FlippingBook, no PDF offered), first of all
"Catalogue suitable for Mercedes-Benz Actros, Antos, Arocs, Atron, Axor" (source-data/original/dt-actros/).

What the online book gives, and how each field is read:
  * pager.js      every item has a link box to "http://dtpi.de/?id=<DT number>"  -> the DT number (exact) and the
                  item's place on the page (no QR decoding, no guessing of item boundaries);
  * searchtext.js the exact text of every page, but without positions and in an order that mixes the columns;
  * workspace.js  the list of contents (main groups and sections with their first page);
  * page images   (downloaded and checked against pages.json) -> each column of an item (Suitable for | Description
                  EN / DE | Details | Replaces) is read with OCR from its own crop, and every word read is then checked
                  against the exact page text of that item: a word that is in it is confirmed, a word one or two
                  characters off is replaced by the book's word, anything else is kept and the item is flagged.
                  The "Replaces" reference numbers are taken from the exact text whenever OCR and text agree.
  * the part photo of each item is cut out of the image and stored small.
Page markers: "N" = new catalogue item, "S" = special DT repair kit (legend on page 18).
Every item keeps its provenance ("DT-MB p201 #1"). The source files are never written to.

Outputs (source-data/extracted/dt-actros/): catalogue.json, items.csv, photos/<DT number>.jpg

Usage:  python3 spare-parts/tools/extract_dt_flipbook.py   (needs tesseract, opencv-python-headless, network or a
        page cache in $DT_FLIPBOOK_CACHE, default /tmp/dt-flipbook)
"""
import csv
import difflib
import hashlib
import io
import json
import os
import re
import sys
import urllib.request
from multiprocessing import Pool
from pathlib import Path

import cv2
import numpy as np
from PIL import Image

sys.path.insert(0, str(Path(__file__).resolve().parent))
from extract_dt_catalogue import find_layout, lines_of, ocr, photo_crop, tag_runs  # noqa: E402  (same page design)

ROOT = Path(__file__).resolve().parents[1]
BOOKS = {
    "dt-actros": {"prefix": "DT-MB", "maker": "Mercedes-Benz"},
}
os.environ["OMP_THREAD_LIMIT"] = "1"
CACHE = Path(os.environ.get("DT_FLIPBOOK_CACHE", "/tmp/dt-flipbook"))
READER_VERSION = "v3"
PAGE_W, PAGE_H = 595.0, 841.0     # link coordinates
IMG_W, IMG_H = 1300, 1839         # page images
FOOTER_PX = 1735  # top of the blue footer band
DT_RE = re.compile(r"^\d\.\d{5}[A-Z]{0,2}$")  # e.g. 4.63906SP
MB_RE = re.compile(r"(?<![\w-])(\d{3} \d{3} \d{4})(?: (S\d|E\d))?\b")  # Mercedes-Benz number as printed: "000 131 5519 S2"
MAKER_RE = re.compile(r"^([A-Z][A-Za-z.&\- ]{1,30}):$")


def sha256(b: bytes) -> str:
    return hashlib.sha256(b).hexdigest()


def load_js(path: Path):
    s = path.read_text(encoding="utf-8-sig")
    return json.loads(s[s.find("{"):s.rfind("}") + 1])


def page_image(book: str, p: dict) -> bytes:
    f = CACHE / book / f"{p['page']:04d}{Path(p['url']).suffix}"
    if f.exists():
        data = f.read_bytes()
    else:
        with urllib.request.urlopen(p["url"], timeout=60) as r:
            data = r.read()
        f.parent.mkdir(parents=True, exist_ok=True)
        f.write_bytes(data)
    if sha256(data) != p["sha256"]:
        raise SystemExit(f"page {p['page']}: image differs from the one recorded in pages.json ({p['url']})")
    return data


def norm(t: str) -> str:
    return t.strip(".,;:()").lower()


class Checker:
    """Confirms OCR words against the exact text of the item."""

    def __init__(self, text: str):
        self.tokens = text.split()
        self.set = set(self.tokens)
        self.by_norm = {}
        for t in self.tokens:
            self.by_norm.setdefault(norm(t), t)

    def word(self, w: str):
        if w in self.set:
            return w, "ok"
        if norm(w) in self.by_norm and norm(w):
            return self.by_norm[norm(w)], "ok"
        near = difflib.get_close_matches(w, self.tokens, n=2, cutoff=0.75)
        if near and (len(near) == 1 or near[0] == near[1]) and not (any(c.isdigit() for c in w) and len(w) <= 4):
            return near[0], "fixed"
        return w, "unconfirmed"

    def line(self, s: str):
        """-> (text, unconfirmed words); a line without any confirmed word is noise from the photo -> ("", 0)."""
        out, bad = [], 0
        for w in s.split():
            if w in ("|", "_", "—", "-", "~", "=") or not re.search(r"\w", w):
                continue
            v, st = self.word(w)
            out.append(v)
            bad += st == "unconfirmed"
        if out and bad == len(out):
            return "", 0
        return " ".join(out), bad


def chunks(text: str, dts: list, dt_first: bool):
    """Split the page text into one piece per item (DT numbers are exact anchors)."""
    end = text.find("Reference numbers and names")
    text = text[:end] if end > 0 else text
    pos, start = [], 0
    for d in dts:
        m = re.compile(rf"(?<![\d.]){re.escape(d)}(?![\w])").search(text, start)
        if not m:
            return None
        pos.append((m.start(), m.end()))
        start = m.end()
    out = []
    for i, (a, b) in enumerate(pos):
        if dt_first:
            nxt = pos[i + 1][0] if i + 1 < len(pos) else len(text)
            body = text[b:nxt].split()
            marks = []
            while body and body[-1] in ("N", "S"):
                marks.insert(0, body.pop())
            out.append({"text": " ".join(body), "marks": marks})
        else:
            prev = out[-1]["_after"] if out else text.find("DT No.") + len("DT No.")
            tail = text[b:pos[i + 1][0] if i + 1 < len(pos) else len(text)].split()
            marks = []
            while tail and tail[0] in ("N", "S"):
                marks.append(tail.pop(0))
            after = b + len(" ".join(marks)) + (1 if marks else 0)
            out.append({"text": text[prev:a].strip(), "marks": marks, "_after": after})
    for c in out:
        c.pop("_after", None)
    return out


def parse_replaces(lines, chunk_text):
    """'Mercedes-Benz: 541 016 0128' (maker on the first line, more numbers below) -> refs + notes."""
    refs, notes, maker = [], [], None
    for ln in lines:
        m = re.match(r"^([A-Z][A-Za-z.&\- ]{1,30}):\s*(.*)$", ln)
        rest = ln
        if m:
            maker, rest = m.group(1).strip(), m.group(2)
        if not rest:
            continue
        if maker == "Mercedes-Benz" or maker is None:
            found = list(MB_RE.finditer(rest))
            if found:
                for f in found:
                    refs.append({"maker": "Mercedes-Benz", "number": f.group(1), "suffix": f.group(2), "in_text": f.group(1) in chunk_text})
                continue
        if maker and sum(c.isdigit() for c in rest) >= 3 and re.fullmatch(r"[0-9A-Z][0-9A-Z .\-/]*", rest):
            refs.append({"maker": maker, "number": rest, "suffix": None, "in_text": rest in chunk_text})
        else:
            notes.append(ln)
    return refs, notes


CONFUSABLE = str.maketrans({"O": "0", "o": "0", "Q": "0", "I": "1", "l": "1"})


def finish_refs(refs, chunk_text):
    """Each reference number is looked up in the exact text (ignoring spaces and O/0, I/1 confusion) and replaced by
    the printed form; Mercedes-Benz numbers that OCR missed are added from the text; the suffix ("S2") comes from the
    text. Applied after the (cached) page reading."""
    out = []
    for r in refs:
        if r.get("from_text_only"):
            continue
        r = dict(r)
        if not r["in_text"]:
            cls = {"0": "[0Oo]", "1": "[1Il]", "5": "[5S]"}
            chars = [cls.get(c, re.escape(c)) for c in r["number"].translate(CONFUSABLE).replace(" ", "").replace("S", "5")]
            m = re.search(r"(?<![\w])" + r"\s?(?:/\s)?".join(chars) + r"(?![\w])", chunk_text)
            if m:
                r.update(number=m.group(0), in_text=True)
        # "K002624 / BS3514" = two numbers; "0 301 081 513 / RHD" = number + right-hand-drive note
        parts = r["number"].split(" / ") if r["in_text"] else [r["number"]]
        nums = [x for x in parts if sum(c.isdigit() for c in x) >= 3]
        extra = " ".join(x for x in parts if x not in nums)
        for n in nums or parts:
            x = dict(r, number=n, suffix=extra or r["suffix"])
            if not any(y["maker"] == x["maker"] and y["number"] == x["number"] for y in out):
                out.append(x)
    for f in MB_RE.finditer(chunk_text):
        if not any(x["number"] == f.group(1) for x in out):
            out.append({"maker": "Mercedes-Benz", "number": f.group(1), "suffix": None, "in_text": True, "from_text_only": True})
    for r in out:
        if r["maker"] == "Mercedes-Benz" and r["in_text"]:
            m = re.search(rf"{re.escape(r['number'])} (S\d|E\d)\b", chunk_text)
            r["suffix"] = m.group(1) if m else None
    return out


def read_page(task):
    book, p, text, links = task
    cache = CACHE / book / f"items-{p['sha256'][:16]}-{READER_VERSION}.json"
    if cache.exists():
        return json.loads(cache.read_text())
    r = _read_page(book, p, text, links)
    cache.write_text(json.dumps(r))
    return r


def _read_page(book, p, text, links):
    rgb = np.array(Image.open(io.BytesIO(page_image(book, p))).convert("RGB"))
    gray = cv2.cvtColor(rgb, cv2.COLOR_RGB2GRAY)
    sx, sy = rgb.shape[1] / PAGE_W, rgb.shape[0] / PAGE_H
    C, found = find_layout(gray)
    dt_left = C["dt"][0] < 200
    result = {"page": p["page"], "items": [], "layout": {"dt_left": dt_left, "headers_found": sorted(found)}}
    dts = [l["dt"] for l in links]
    parts = chunks(text, dts, text.startswith("DT No."))
    if parts is None:
        result["error"] = "DT number of a link not found in the page text"
        return result
    for n, (l, ch) in enumerate(zip(links, parts)):
        y0 = max(150, int(l["y"] * sy) - 6)
        y1 = int(links[n + 1]["y"] * sy) - 6 if n + 1 < len(links) else FOOTER_PX
        chk = Checker(ch["text"])
        tags = tag_runs(gray, y0, y1, C["tag"])
        dx0, dx1 = C["desc_text"]
        en_y0 = tags[0][0] - 4 if tags else y0
        en_y1 = tags[1][0] - 3 if len(tags) > 1 else en_y0 + 32
        de_y1 = tags[2][0] - 3 if len(tags) > 2 else en_y1 + 32
        en, en_bad = chk.line(" ".join(ocr(gray[en_y0:en_y1, dx0:dx1], psm=6).split()))
        de, de_bad = chk.line(" ".join(ocr(gray[en_y1:de_y1, dx0:dx1], psm=6).split())) if len(tags) > 1 else ("", 0)
        ty0 = max(150, (tags[0][0] - 10) if tags else y0)
        suit_rows = ocr(gray[ty0:y1, C["suitable"][0]:C["suitable"][1]], psm=6, tsv=True)
        det_rows = ocr(gray[ty0:min(y1, ty0 + 200), C["details"][0]:C["details"][1]], psm=6, tsv=True)
        rep_rows = ocr(gray[ty0:min(y1, ty0 + 200), C["replaces"][0]:C["replaces"][1]], psm=6, tsv=True)
        suitable, s_bad = chk.line(" ".join(lines_of(suit_rows, 40)))
        det_lines = [chk.line(x) for x in lines_of(det_rows, 35)]
        rep_lines = [chk.line(x) for x in lines_of(rep_rows, 35)]
        refs, rep_notes = parse_replaces([x for x, _ in rep_lines if x], ch["text"])  # finished in main()
        boxes = [(r["x"] + C["details"][0], r["y"] + ty0, r["w"], r["h"]) for r in det_rows if r["conf"] > 50] + \
                [(r["x"] + C["replaces"][0], r["y"] + ty0, r["w"], r["h"]) for r in rep_rows if r["conf"] > 50]
        photo = photo_crop(rgb, gray, ty0, y1, boxes, C["photo"])
        result["items"].append({
            "n": n + 1, "dt": l["dt"], "y": y0, "en": en, "de": de, "suitable": suitable,
            "details": " · ".join(x for x, _ in det_lines if x), "replaces": refs, "replaces_notes": rep_notes,
            "marks": ch["marks"], "text": ch["text"], "language_tags": len(tags),
            "unconfirmed_words": {"en": en_bad, "de": de_bad, "suitable": s_bad, "details": sum(b for _, b in det_lines), "replaces": sum(b for _, b in rep_lines)},
            "photo": photo.hex() if photo else None,
        })
    return result


def toc_sections(ws, text_of):
    en = next(c for c in ws["toc"]["children"] if c["title"].startswith("[EN]"))
    out = []
    for g in en["children"]:
        for s in g.get("children", [g]):
            t = text_of.get(s["page"], "")
            m = re.search(rf"(\d{{2}} [A-Z]) {re.escape(s['title'])}\b", t, re.I) or re.search(rf"{re.escape(s['title'])} (\d{{2}} [A-Z])\b", t, re.I)
            out.append({"code": m.group(1) if m else None, "title": s["title"], "group": g["title"], "first_page": s["page"], "pages": []})
    out.sort(key=lambda s: s["first_page"])
    return out


def main(book):
    cfg = BOOKS[book]
    src = ROOT / "source-data" / "original" / book
    out_dir = ROOT / "source-data" / "extracted" / book
    manifest = json.loads((src / "pages.json").read_text())
    pager = load_js(src / "pager.js")["pages"]
    ws = load_js(src / "workspace.js")
    text_of = {int(x["@ID"]): x["#text"] for x in load_js(src / "searchtext.js")["pages"]["page"]}
    sections = toc_sections(ws, text_of)
    first, last = sections[0]["first_page"], max(int(k) for k in pager if k.isdigit())

    tasks = []
    for p in manifest["pages"]:
        n = p["page"]
        t = text_of.get(n, "")
        if n < first or not (t.startswith("Suitable for Description") or t.startswith("DT No. Replaces")):
            continue
        links = []
        for l in pager.get(str(n), {}).get("links", []):
            m = re.search(r"dtpi\.de/\?id=(.+)$", l.get("url", ""))
            if m and DT_RE.match(m.group(1)):
                w, h, x, y = l["rect"]
                links.append({"dt": m.group(1), "x": x, "y": y, "w": w, "h": h})
        links.sort(key=lambda l: l["y"])
        if links:
            tasks.append((book, p, t, links))
    limit = os.environ.get("DT_PAGES")
    if limit:
        a, _, b = limit.partition("-")
        tasks = [t for t in tasks if int(a) <= t[1]["page"] <= int(b or a)]
    (CACHE / book).mkdir(parents=True, exist_ok=True)
    pages = []
    with Pool(int(os.environ.get("DT_JOBS", os.cpu_count() or 2))) as pool:
        for i, r in enumerate(pool.imap(read_page, tasks, chunksize=1)):
            pages.append(r)
            if i % 25 == 0:
                print(f"page {r['page']} ({len(r['items'])} items)", file=sys.stderr, flush=True)

    out_dir.mkdir(parents=True, exist_ok=True)
    (out_dir / "photos").mkdir(exist_ok=True)
    items, page_errors = [], []
    for pg in pages:
        if pg.get("error"):
            page_errors.append({"page": pg["page"], "error": pg["error"]})
        sec = max((s for s in sections if s["first_page"] <= pg["page"]), key=lambda s: s["first_page"])
        sec["pages"].append(pg["page"])
        for it in pg["items"]:
            it["replaces"] = finish_refs(it["replaces"], it["text"])
            photo = it.pop("photo")
            if photo:
                name = f"{it['dt']}.jpg"
                if not (out_dir / "photos" / name).exists():
                    (out_dir / "photos" / name).write_bytes(bytes.fromhex(photo))
                it["photo"] = f"photos/{name}"
            flags = []
            u = it["unconfirmed_words"]
            if not it["en"]:
                flags.append("NO_DESCRIPTION")
            elif u["en"]:
                flags.append("NAME_NOT_CONFIRMED_BY_TEXT")
            if u["suitable"]:
                flags.append("SUITABLE_NOT_CONFIRMED_BY_TEXT")
            if any(not r["in_text"] for r in it["replaces"]):
                flags.append("REFERENCE_NOT_CONFIRMED_BY_TEXT")
            if "S" in it["marks"]:
                flags.append("SPECIAL_DT_REPAIR_KIT")
            it.update({"section": f"{sec['code']} {sec['title']}" if sec["code"] else sec["title"], "page": pg["page"],
                       "source_ref": f"{cfg['prefix']} p{pg['page']} #{it['n']}", "flags": flags, "new_item": "N" in it["marks"]})
            items.append(it)
    sections = [s for s in sections if s["pages"]]
    quality = {
        "pages_read": len(pages), "items": len(items), "distinct_dt": len({i["dt"] for i in items}),
        "photos": sum(bool(i.get("photo")) for i in items), "page_errors": page_errors,
        "flags": {f: sum(f in i["flags"] for i in items) for f in sorted({f for i in items for f in i["flags"]})},
        "items_with_mercedes_number": sum(any(r["maker"] == "Mercedes-Benz" for r in i["replaces"]) for i in items),
        "words_unconfirmed": {k: sum(i["unconfirmed_words"][k] for i in items) for k in ("en", "de", "suitable", "details", "replaces")},
    }
    sources = [{"file": f"original/{book}/{f}", "sha256": sha256((src / f).read_bytes())} for f in ("pages.json", "pager.js", "searchtext.js", "workspace.js")]
    meta = {"title": ws["title"], "publisher": "DT Spare Parts (Diesel Technic)", "brand": "DT Spare Parts", "vehicle_maker": cfg["maker"],
            "prefix": cfg["prefix"], "url": manifest["base_url"], "publication_date": ws.get("publicationInfo", {}).get("publicationDate"),
            "sources": sources,
            "note": "Reference numbers and names, with the exception of DT Spare Parts, are only intended for comparison purposes and may not be shown in invoices."}
    (out_dir / "catalogue.json").write_text(json.dumps({"meta": meta, "quality": quality, "sections": sections, "items": items}, indent=1, ensure_ascii=False))
    with open(out_dir / "items.csv", "w", newline="", encoding="utf-8") as f:
        w = csv.writer(f)
        w.writerow(["source_ref", "section", "page", "dt", "en", "de", "suitable", "details", "replaces", "marks", "flags"])
        for i in items:
            w.writerow([i["source_ref"], i["section"], i["page"], i["dt"], i["en"], i["de"], i["suitable"], i["details"],
                        "; ".join(f"{r['maker']}: {r['number']}{' ' + r['suffix'] if r['suffix'] else ''}" for r in i["replaces"]), " ".join(i["marks"]), " ".join(i["flags"])])
    print(json.dumps(quality, indent=1))


if __name__ == "__main__":
    for b in sys.argv[1:] or list(BOOKS):
        main(b)
