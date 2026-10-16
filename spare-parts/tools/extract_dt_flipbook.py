#!/usr/bin/env python3
"""
Read-only extractor for DT Spare Parts online catalogues (FlippingBook, no PDF offered), first of all
"Catalogue suitable for Mercedes-Benz Actros, Antos, Arocs, Atron, Axor" (source-data/original/dt-actros/).

What the online book gives, and how each field is read:
  * pager.js      every item has a link box to "http://dtpi.de/?id=<DT number>" (or dtpi.de/<DT number>)  -> the DT number (exact) and the
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
    "dt-volvo": {"prefix": "DT-VOLVO", "maker": "Volvo"},
    "dt-daf": {"prefix": "DT-DAF", "maker": "DAF"},
    "dt-scania": {"prefix": "DT-SCANIA", "maker": "Scania"},
    "dt-renault": {"prefix": "DT-RENAULT", "maker": "Renault Trucks"},
    "dt-iveco-daily": {"prefix": "DT-IVECO", "maker": "Iveco"},
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


def _cached(book: str, name: str, url: str, sha: str) -> bytes:
    f = CACHE / book / name
    if f.exists():
        data = f.read_bytes()
    else:
        with urllib.request.urlopen(url, timeout=60) as r:
            data = r.read()
        f.parent.mkdir(parents=True, exist_ok=True)
        f.write_bytes(data)
    if sha256(data) != sha:
        raise SystemExit(f"page image differs from the one recorded in pages.json ({url})")
    return data


def page_rgb(book: str, p: dict) -> np.ndarray:
    """The page as a 1300 x 1839 RGB picture. Newer books have the text as a separate transparent picture, which is
    laid over the background picture."""
    data = _cached(book, f"{p['page']:04d}{Path(p['url']).suffix}", p["url"], p["sha256"])
    im = Image.open(io.BytesIO(data)).convert("RGB")
    if p.get("text_url"):
        text = Image.open(io.BytesIO(_cached(book, f"{p['page']:04d}.text.png", p["text_url"], p["text_sha256"]))).convert("RGBA")
        im = im.resize((IMG_W, IMG_H), Image.LANCZOS)
        im.paste(text.resize((IMG_W, IMG_H), Image.LANCZOS), (0, 0), text.resize((IMG_W, IMG_H), Image.LANCZOS))
    elif im.size != (IMG_W, IMG_H):
        im = im.resize((IMG_W, IMG_H), Image.LANCZOS)
    return np.array(im)


def norm(t: str) -> str:
    return t.strip(".,;:()").lower()


class Checker:
    """Confirms OCR words against the exact text of the item."""

    def __init__(self, text: str, page_text: str = ""):
        split = lambda s: [x for t in s.split() for x in ([t] + re.split(r"(?<=\d)(?=[A-Z][a-z])", t)[1:])]  # "2005Silencer" -> also "Silencer"
        self.tokens = split(text)
        self.set = set(self.tokens)
        # some books (DAF) mix the order of neighbouring items in their text: a word is also confirmed by the same page
        self.page = Checker(page_text) if page_text else None
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
        if self.page:
            v, st = self.page.word(w)
            if st == "ok":
                return v, "ok"
        return w, "unconfirmed"

    def joined(self, words):
        """Words that together are one word of the text: the DAF book's text leaves out spaces ("Springbushing")."""
        key = norm("".join(words))
        return bool(key) and (key in self.by_norm or bool(self.page and key in self.page.by_norm))

    def line(self, s: str):
        """-> (text, unconfirmed words); a line without any confirmed word is noise from the photo -> ("", 0)."""
        out, bad = [], 0
        words = [w for w in s.split() if w not in ("|", "_", "—", "-", "~", "=") and re.search(r"\w", w)]
        i = 0
        while i < len(words):
            w = words[i]
            if not (w in self.set or (norm(w) and norm(w) in self.by_norm)):
                n = next((n for n in (2, 3) if i + n <= len(words) and self.joined(words[i:i + n])), 0)
                if n:
                    out.extend(words[i:i + n])  # as OCR read them (with the spaces)
                    i += n
                    continue
            v, st = self.word(w)
            out.append(v)
            bad += st == "unconfirmed"
            i += 1
        if out and bad == len(out):
            return "", 0
        return " ".join(out), bad


def chunks(text: str, dts: list, dt_first: bool):
    """Split the page text into one piece per item (DT numbers are exact anchors)."""
    end = text.find("Reference numbers and names")
    text = text[:end] if end > 0 else text
    pos, start = [], 0
    for d in dts:
        m = re.compile(rf"(?<![\d.]){re.escape(d)}(?![\w])").search(text, start) \
            or re.compile(rf"{re.escape(d)}(?![\w])").search(text, start)  # "FH 13 20052.14051": a year glued to the DT number
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
            prev = out[-1]["_after"] if out else re.search(r"DT ?No\.", text).end()
            tail = text[b:pos[i + 1][0] if i + 1 < len(pos) else len(text)].split()
            marks = []
            while tail and tail[0] in ("N", "S"):
                marks.append(tail.pop(0))
            after = b + len(" ".join(marks)) + (1 if marks else 0)
            out.append({"text": text[prev:a].strip(), "marks": marks, "_after": after})
    for c in out:
        c.pop("_after", None)
    return out


def parse_replaces(lines, chunk_text, book_maker="Mercedes-Benz"):
    """'Mercedes-Benz: 541 016 0128' / 'Volvo: 20799675, 21479394' (maker on the first line, more numbers below)
    -> refs + notes."""
    refs, notes, maker = [], [], None
    for ln in lines:
        m = re.match(r"^([A-Z][A-Za-z.&\- ]{1,30}):\s*(.*)$", ln)
        rest = ln
        if m:
            maker, rest = m.group(1).strip(), m.group(2)
        if not rest:
            continue
        if maker == "Mercedes-Benz" or (maker is None and book_maker == "Mercedes-Benz"):
            found = list(MB_RE.finditer(rest))
            if found:
                for f in found:
                    refs.append({"maker": "Mercedes-Benz", "number": f.group(1), "suffix": f.group(2), "in_text": f.group(1) in chunk_text})
                continue
        nums = [x.strip() for x in re.split(r",\s*", rest)]
        if maker and all(sum(c.isdigit() for c in x) >= 3 and re.fullmatch(r"[0-9A-Z][0-9A-Z .\-/]*", x) for x in nums):
            for x in nums:
                refs.append({"maker": maker, "number": x, "suffix": None, "in_text": x in chunk_text})
        else:
            notes.append(ln)
    return refs, notes


CONFUSABLE = str.maketrans({"O": "0", "o": "0", "Q": "0", "I": "1", "l": "1"})


def finish_refs(refs, chunk_text, book_maker="Mercedes-Benz"):
    """Each reference number is looked up in the exact text (ignoring spaces and O/0, I/1 confusion) and replaced by
    the printed form; Mercedes-Benz numbers that OCR missed are added from the text; the suffix ("S2") comes from the
    text. Applied after the (cached) page reading."""
    out = []
    for r in refs:
        if r.get("from_text_only"):
            continue
        r = dict(r)
        toks = r["number"].split()
        while not r["in_text"] and len(toks) > 1 and toks[-1] not in chunk_text.split()[-1:] and re.fullmatch(r"\d\.?|S\d?", toks[-1]):
            toks.pop()  # "20451347 2." / "3985226 S": OCR picked up the start of the next column or the set marker
            r["number"] = " ".join(toks)
            r["in_text"] = r["number"] in chunk_text
        m = re.fullmatch(r"(.*\d) (S\d?)", r["number"])
        if m and m.group(1) in chunk_text:  # "1665898 S": the set marker printed after the number
            r.update(number=m.group(1), suffix=m.group(2), in_text=True)
        if re.fullmatch(r"\d\.\d{5}[A-Z]{0,2}( \+? ?\d\.\d{5}[A-Z]{0,2})+", r["number"]):
            r["kit_of_dt"] = re.findall(r"\d\.\d{5}[A-Z]{0,2}", r["number"])  # "2.14064 + 2.14046": DT parts of this kit
        if not r["in_text"] and not r.get("kit_of_dt"):
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
    for f in (MB_RE.finditer(chunk_text) if book_maker == "Mercedes-Benz" else []):
        if not any(x["number"] == f.group(1) for x in out):
            out.append({"maker": "Mercedes-Benz", "number": f.group(1), "suffix": None, "in_text": True, "from_text_only": True})
    for r in out:
        if r["maker"] == "Mercedes-Benz" and r["in_text"]:
            m = re.search(rf"{re.escape(r['number'])} (S\d|E\d)\b", chunk_text)
            r["suffix"] = m.group(1) if m else None
    return out


def exact_window(ocr_text, chunk_text, min_ratio=0.85):
    """The run of words in the exact page text that best matches what OCR read (e.g. "D 12 A/BIC" -> "D 12 A/B/C"),
    when it matches closely enough."""
    toks, k = chunk_text.split(), len(ocr_text.split())
    best, best_r = None, 0.0
    for n in range(max(1, k - 2), k + 3):
        for i in range(0, len(toks) - n + 1):
            cand = " ".join(toks[i:i + n])
            r = difflib.SequenceMatcher(None, ocr_text, cand).ratio()
            if r > best_r:
                best, best_r = cand, r
    return best if best_r >= min_ratio else None


def read_page(task):
    book, p, text, links = task
    cache = CACHE / book / f"items-{p['sha256'][:16]}-{READER_VERSION}.json"
    if cache.exists():
        return json.loads(cache.read_text())
    r = _read_page(book, p, text, links)
    cache.write_text(json.dumps(r))
    return r


def _read_page(book, p, text, links):
    rgb = page_rgb(book, p)
    gray = cv2.cvtColor(rgb, cv2.COLOR_RGB2GRAY)
    sx, sy = rgb.shape[1] / PAGE_W, rgb.shape[0] / PAGE_H
    C, found = find_layout(gray)
    dt_left = C["dt"][0] < 200
    result = {"page": p["page"], "items": [], "layout": {"dt_left": dt_left, "headers_found": sorted(found)}}
    dts = [l["dt"] for l in links]
    dt_first = bool(re.match(r"DT ?No\.", text))
    parts = chunks(text, dts, dt_first)
    if parts is None:
        # a link with a wrong DT number (Renault: four items linked to the same number, or a typo): take the item DT
        # numbers from the page text when there is exactly one per item box, and flag the items
        body = text.split("Reference numbers and names")[0]
        found = list(dict.fromkeys(re.findall(r"(?<![\d.])(\d\.\d{5}(?:SP|[A-Z])?)(?![\w.])", body)))
        if len(found) != len(links):  # one link with a typo (DAF: link 5.63105, text 5.63109)
            spare = [d for d in found if d not in dts]
            fixed = []
            for d in dts:
                if d in found:
                    fixed.append(d)
                    continue
                near = [c for c in spare if len(c) == len(d) and sum(a != b for a, b in zip(c, d)) == 1]
                i = dts.index(d)  # the item's number sits in the text between its neighbours' numbers
                lo = body.find(dts[i - 1]) if i else -1
                hi = body.find(dts[i + 1]) if i + 1 < len(dts) and dts[i + 1] in body else len(body)
                near = [c for c in near if lo < body.find(c) < hi]
                fixed.append(near[0] if len(near) == 1 else None)
            found = fixed if None not in fixed else found
        parts = chunks(text, found, dt_first) if len(found) == len(links) else None
        if parts is None:
            result["error"] = "DT number of a link not found in the page text"
            return result
        for l, d in zip(links, found):
            if l["dt"] != d:
                l["link_dt"], l["dt"] = l["dt"], d
        dts = found
    for n, (l, ch) in enumerate(zip(links, parts)):
        y0 = max(150, int(l["y"] * sy) - 6)
        y1 = int(links[n + 1]["y"] * sy) - 6 if n + 1 < len(links) else FOOTER_PX
        chk = Checker(ch["text"], text)
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
        refs, rep_notes = parse_replaces([x for x, _ in rep_lines if x], ch["text"], BOOKS[book]["maker"])  # finished in main()
        boxes = [(r["x"] + C["details"][0], r["y"] + ty0, r["w"], r["h"]) for r in det_rows if r["conf"] > 50] + \
                [(r["x"] + C["replaces"][0], r["y"] + ty0, r["w"], r["h"]) for r in rep_rows if r["conf"] > 50]
        photo = photo_crop(rgb, gray, ty0, y1, boxes, C["photo"])
        result["items"].append({
            "n": n + 1, "dt": l["dt"], "y": y0, "en": en, "de": de, "suitable": suitable,
            "details": " · ".join(x for x, _ in det_lines if x), "replaces": refs, "replaces_notes": rep_notes,
            "marks": ch["marks"], "text": ch["text"], "language_tags": len(tags),
            "unconfirmed_words": {"en": en_bad, "de": de_bad, "suitable": s_bad, "details": sum(b for _, b in det_lines), "replaces": sum(b for _, b in rep_lines)},
            "photo": photo.hex() if photo else None, "link_dt": l.get("link_dt"),
        })
    return result


def toc_sections(ws, text_of):
    """Sections from the list of contents; the code ("13 B", DAF "102", Iveco "5004") from the page headers of the
    section: the number printed right before or after the section title (most common one over the section's pages)."""
    en = next(c for c in ws["toc"]["children"] if re.match(r"\[?EN\b", c["title"]))  # "[EN] English" / "EN English"
    out = []
    for g in en["children"]:
        for s in g.get("children", [g]):
            out.append({"code": None, "title": s["title"], "group": g["title"], "first_page": s["page"], "pages": []})
    out.sort(key=lambda s: s["first_page"])
    last = max(text_of) if text_of else 0
    for i, sec in enumerate(out):
        end = out[i + 1]["first_page"] - 1 if i + 1 < len(out) else last
        title = r"\s*".join(re.escape(w) for w in sec["title"].split())  # DAF text: "Suspension, FrontAxle"
        code = r"(\d{2,4}(?: [A-Z]\b)?)"
        found = {}
        for n in range(sec["first_page"], max(sec["first_page"], end) + 1):
            t = text_of.get(n, "")
            for m in re.finditer(rf"(?<![\d.]){code} {title}\b|\b{title} {code}(?![\d.])", t, re.I):
                c = m.group(1) or m.group(2)
                found[c] = found.get(c, 0) + 1
        if found:
            sec["code"] = max(found, key=found.get)
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
        if n < first or not re.match(r"(Suitable for Description|DT ?No\. Replaces)", t):
            continue
        links = []
        for l in pager.get(str(n), {}).get("links", []):
            m = re.search(r"dtpi\.de/(?:\?id=)?(.+)$", l.get("url", ""))
            if m and DT_RE.match(m.group(1)):
                w, h, x, y = l["rect"]
                if any(abs(o["y"] - y) < 1 and abs(o["x"] - x) < 1 for o in links):
                    continue  # the same box listed twice (DAF)
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
            # a number without a maker label in the Replaces column is the truck maker's own (DAF prints "1261101")
            for n in [n for n in it["replaces_notes"] if re.fullmatch(r"[0-9][0-9A-Z .\-/]*", n) and sum(c.isdigit() for c in n) >= 4]:
                it["replaces_notes"].remove(n)
                it["replaces"].append({"maker": cfg["maker"], "number": n, "suffix": None, "in_text": n in it["text"], "unlabelled": True})
            it["replaces"] = finish_refs(it["replaces"], it["text"], cfg["maker"])
            for r in [r for r in it["replaces"] if r.get("kit_of_dt")]:
                it["replaces"].remove(r)
                it["replaces_notes"].append(f"Kit of DT {' + '.join(r['kit_of_dt'])}")
            if not it["en"]:  # OCR line lost (e.g. the text glues a year to the name: "2006Silencer EN")
                m = re.search(r"(?:\d|^)([A-Z][a-z][^\d]*?) EN ", it["text"])
                if m:
                    it["en"], it["en_from_text"] = m.group(1).strip(), True
            if it["unconfirmed_words"]["suitable"]:
                exact = exact_window(it["suitable"], it["text"]) or exact_window(it["suitable"], text_of.get(pg["page"], ""))
                if exact:
                    it["suitable_ocr"], it["suitable"] = it["suitable"], exact
                    it["unconfirmed_words"]["suitable"] = 0
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
            if it.get("link_dt"):
                flags.append("DT_NUMBER_FROM_TEXT_LINK_DIFFERS")
            it.update({"section": f"{sec['code']} {sec['title']}" if sec["code"] else sec["title"], "page": pg["page"],
                       "source_ref": f"{cfg['prefix']} p{pg['page']} #{it['n']}", "flags": flags, "new_item": "N" in it["marks"]})
            items.append(it)
    sections = [s for s in sections if s["pages"]]
    quality = {
        "pages_read": len(pages), "items": len(items), "distinct_dt": len({i["dt"] for i in items}),
        "photos": sum(bool(i.get("photo")) for i in items), "page_errors": page_errors,
        "flags": {f: sum(f in i["flags"] for i in items) for f in sorted({f for i in items for f in i["flags"]})},
        "items_with_vehicle_maker_number": sum(any(r["maker"].lower().startswith(cfg["maker"].lower()[:4]) for r in i["replaces"]) for i in items),
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
