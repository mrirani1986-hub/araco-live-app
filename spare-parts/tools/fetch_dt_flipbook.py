#!/usr/bin/env python3
"""
Downloads a DT Spare Parts online catalogue (FlippingBook on cdn.dt-spareparts.com; the site offers no PDF) as source
data for tools/extract_dt_flipbook.py:

  source-data/original/<dir>/pager.js       link boxes per page ("http://dtpi.de/?id=<DT number>")
                             searchtext.js  exact text of every page
                             workspace.js   list of contents, title, publication data
                             pages.json     URL and SHA-256 of every page image (the images themselves are kept in the
                                            page cache $DT_FLIPBOOK_CACHE/<dir>/, not in the repository)

Usage:  python3 spare-parts/tools/fetch_dt_flipbook.py <dir> <catalogue folder>
        e.g. dt-volvo Catalogue_suitable_for_Volvo-FH-FM
Existing files in source-data/original/<dir> are never overwritten.
"""
import datetime
import hashlib
import json
import os
import sys
import time
import urllib.error
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
CACHE = Path(os.environ.get("DT_FLIPBOOK_CACHE", "/tmp/dt-flipbook"))
CDN = "https://cdn.dt-spareparts.com/data/catalogues/"


def get(url, missing_ok=False):
    for a in range(5):
        try:
            with urllib.request.urlopen(url, timeout=60) as r:
                return r.read()
        except urllib.error.HTTPError as e:
            if e.code == 404 and missing_ok:
                return None
            time.sleep(2 ** a)
        except Exception:
            time.sleep(2 ** a)
    raise SystemExit(f"could not fetch {url}")


def main(dirname, folder):
    out = ROOT / "source-data" / "original" / dirname
    if (out / "pages.json").exists():
        raise SystemExit(f"{out} already has the catalogue; not overwritten")
    base = f"{CDN}{folder}/"
    files = {"pager.js": "files/assets/common/pager.js", "searchtext.js": "files/assets/mobile/search/searchtext.js",
             "workspace.js": "files/assets/html/workspace.js"}
    data = {k: get(base + v) for k, v in files.items()}
    s = data["pager.js"].decode("utf-8-sig")
    pager = json.loads(s[s.find("{"):s.rfind("}") + 1])["pages"]
    n_pages = max(int(k) for k in pager if k.isdigit())
    cache = CACHE / dirname
    cache.mkdir(parents=True, exist_ok=True)
    def fetch_to(f, url):
        b = f.read_bytes() if f.exists() else get(url, missing_ok=True)
        if b and not b.lstrip(b"\xef\xbb\xbf").startswith(b"<?xml"):
            f.write_bytes(b)
            return {"url": url, "sha256": hashlib.sha256(b).hexdigest()}
        return None

    def page(n):
        found = None
        # older books: one full page picture (mobile/pages/pageNNNN_i2.jpg|png)
        for ext in ("jpg", "png"):
            found = fetch_to(cache / f"{n:04d}.{ext}", f"{base}files/assets/mobile/pages/page{n:04d}_i2.{ext}")
            if found:
                break
        if not found:
            # newer books: background picture without text + the text as a transparent picture on top
            found = fetch_to(cache / f"{n:04d}.jpg", f"{base}files/assets/common/page-html5-substrates/page{n:04d}_2.jpg")
            if not found:
                raise SystemExit(f"page {n}: no image")
            text = fetch_to(cache / f"{n:04d}.text.png", f"{base}files/assets/common/page-textlayers/page{n:04d}_2.png")
            if text:
                found.update(text_url=text["url"], text_sha256=text["sha256"])
        if n % 100 == 0:
            print(f"{dirname}: page {n}/{n_pages}", file=sys.stderr, flush=True)
        return {"page": n, **found}

    with ThreadPoolExecutor(8) as ex:
        pages = list(ex.map(page, range(1, n_pages + 1)))
    s = data["workspace.js"].decode("utf-8-sig")
    title = json.loads(s[s.find("{"):s.rfind("}") + 1]).get("title")
    out.mkdir(parents=True, exist_ok=True)
    for k, b in data.items():
        (out / k).write_bytes(b)
    (out / "pages.json").write_text(json.dumps({
        "catalogue": title, "publisher": "DT Spare Parts (Diesel Technic)", "base_url": base,
        "downloaded": datetime.date.today().isoformat(), "files": {k: base + v for k, v in files.items()},
        "note": "The online catalogue offers no PDF. The page images (1300 x 1839) are not stored here; "
                "tools/extract_dt_flipbook.py downloads them and checks each against its SHA-256 below. Where a page has "
                "text_url, the page is the background picture with the text picture laid over it.",
        "pages": pages}, indent=1))
    print(f"{dirname}: {title}, {n_pages} pages", file=sys.stderr)


if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2])
