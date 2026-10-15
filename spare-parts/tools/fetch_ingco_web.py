#!/usr/bin/env python3
"""
INGCO product data from the official INGCO websites (www.ingco.com/<country>/products), for the INGCO tools that have no
picture from the price list or the catalogues.

  1. fetch   every INGCO country site's product list (server-rendered pages, 100 products per page; one site per
             country, the English one when it has products). Each list entry has the model number, product name,
             category, three key specifications and the picture URL (res-de.togroup.com).
             -> source-data/original/ingco-web/products-<date>.json  (every product as listed, with the sites it is on)
  2. pictures for each INGCO product in source-data/extracted/ingco/catalogue.json that has no price-list or catalogue
             picture and is on a site: download its picture once
             -> source-data/extracted/ingco/web/<model>.<ext> and web.json (model, name, category, key data, site,
             picture URL, SHA-256)
Names are taken from an English-language site when the product is on one; otherwise the record is marked
"name_language": "not English".

Usage:  python3 spare-parts/tools/fetch_ingco_web.py [fetch] [pictures]     (both by default)
        INGCO_WEB_CACHE=/tmp/ingco-web keeps the downloaded pages between runs.
"""
import datetime
import hashlib
import json
import os
import re
import sys
import time
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SRC = ROOT / "source-data" / "original" / "ingco-web"
OUT = ROOT / "source-data" / "extracted" / "ingco"
CACHE = Path(os.environ.get("INGCO_WEB_CACHE", "/tmp/ingco-web"))
HOME = "https://www.ingco.com/lb-en/home"
ENGLISH = {"ke", "tz", "gy", "jm", "uk", "et"}  # English-language sites without "-en" in the name
KEEP = ("productNo", "productName", "categoryName", "keydata1", "keydata2", "keydata3", "productPics", "pathReplacement")


def get(url, binary=False, required=True):
    for a in range(4):
        try:
            with urllib.request.urlopen(urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"}), timeout=60) as r:
                b = r.read()
                return b if binary else b.decode("utf-8", "replace")
        except Exception:
            time.sleep(2 ** a)
    if required:
        raise SystemExit(f"could not fetch {url}")
    print(f"skipped (no answer): {url}", file=sys.stderr)
    return ""


def english(site):
    return site.endswith("-en") or site in ENGLISH


def fetch():
    sites = sorted(set(re.findall(r"https://www\.ingco\.com/([a-z-]+)/home", get(HOME))))
    totals = {}
    for c in sites:
        m = re.search(r'"total":(\d+)', get(f"https://www.ingco.com/{c}/products?pageNum=1&pageSize=1", required=False))
        totals[c] = int(m.group(1)) if m else 0
    chosen = {}
    for c in sites:
        if totals[c] and (c.split("-")[0] not in chosen or c.endswith("-en")):
            chosen[c.split("-")[0]] = c
    (CACHE / "sites").mkdir(parents=True, exist_ok=True)
    products = {}
    for c in sorted(chosen.values()):
        f = CACHE / "sites" / f"{c}.json"
        cached = json.loads(f.read_text()) if f.exists() else None
        if cached and len(cached["items"]) >= totals[c]:
            items = cached["items"]
        else:
            items, n = {}, 1
            while True:
                s = get(f"https://www.ingco.com/{c}/products?pageNum={n}&pageSize=100")
                i = s.find('"list":[{"id"')
                arr = json.JSONDecoder().raw_decode(s[i + 7:])[0] if i >= 0 else []
                for p in arr:
                    items.setdefault(p["productNo"], p)
                if not arr or len(items) >= totals[c] or n > 80:  # a page can hold fewer than 100 (hidden products)
                    break
                n += 1
                time.sleep(0.5)
            items = list(items.values())
            f.write_text(json.dumps({"site": c, "total": totals[c], "items": items}))
        print(c, totals[c], len(items), file=sys.stderr, flush=True)
        for p in items:
            key = p["productNo"].strip().upper()
            rec = products.get(key)
            if rec is None or (english(c) and not english(rec["site"])):
                products[key] = {**{k: p.get(k) for k in KEEP}, "site": c, "sites": (rec or {}).get("sites", [])}
            products[key]["sites"].append(c)
    SRC.mkdir(parents=True, exist_ok=True)
    out = SRC / f"products-{datetime.date.today().isoformat()}.json"
    out.write_text(json.dumps({
        "source": "www.ingco.com/<country>/products (server-rendered product lists)", "fetched": datetime.date.today().isoformat(),
        "sites": {c: totals[c] for c in sorted(chosen.values())},
        "note": "One record per model number, taken from an English-language site when the product is on one.",
        "products": [products[k] for k in sorted(products)],
    }, indent=1, ensure_ascii=False))
    print(f"{len(products)} products -> {out.relative_to(ROOT)}", file=sys.stderr)


def pictures():
    src = sorted(SRC.glob("products-*.json"))[-1]
    web = {p["productNo"].strip().upper(): p for p in json.loads(src.read_text())["products"]}
    cat = json.loads((OUT / "catalogue.json").read_text())
    (OUT / "web").mkdir(exist_ok=True)
    rows, missing = [], []
    for p in cat["products"]:
        if any(r.get("picture") for r in p["price_list_rows"]) or p.get("catalogue_picture"):
            continue
        w = web.get(p["ref"].upper())
        if not w or not w.get("productPics"):
            missing.append(p["ref"])
            continue
        url = w["productPics"].split(",")[0].strip()
        ext = Path(url.split("?")[0]).suffix.lower() or ".jpg"
        f = OUT / "web" / f"{p['ref']}{ext}"
        if not f.exists():
            f.write_bytes(get(url.replace(" ", "%20"), binary=True))
            time.sleep(0.2)
        rows.append({"ref": p["ref"], "name": w["productName"], "name_language": "English" if english(w["site"]) else "not English",
                     "category": w.get("categoryName"), "key_data": [w[k] for k in ("keydata1", "keydata2", "keydata3") if w.get(k)],
                     "site": w["site"], "page": f"https://www.ingco.com/{w['site']}/products/{w['pathReplacement']}" if w.get("pathReplacement") else None,
                     "picture_url": url, "file": f"web/{f.name}", "sha256": hashlib.sha256(f.read_bytes()).hexdigest()})
    (OUT / "web.json").write_text(json.dumps({
        "source": {"file": f"original/ingco-web/{src.name}", "sha256": hashlib.sha256(src.read_bytes()).hexdigest()},
        "products": rows, "not_on_the_websites": missing}, indent=1, ensure_ascii=False))
    print(json.dumps({"pictures": len(rows), "not_on_the_websites": len(missing)}), file=sys.stderr)


if __name__ == "__main__":
    steps = sys.argv[1:] or ["fetch", "pictures"]
    if "fetch" in steps:
        fetch()
    if "pictures" in steps:
        pictures()
