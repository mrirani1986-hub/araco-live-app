#!/usr/bin/env python3
"""
Read-only extractor for the INGCO tool documents in source-data/original/ingco/ (uploaded by the owner):

  ingco-price-list-2026.pdf  English price list, 70 pages, one table:
                             S.No. | INGCO item No. | Product name | Picture | Description & Features | List Price | Qty/Ctn
                             (the currency of the list price is not stated in the document; it is kept as printed)
  ingco_katalog_2024-<1..4>.pdf  INGCO Indonesia catalogue 2024 (160 pages, uploaded in 4 parts). Read for the reference,
                             its Indonesian title (directly above the reference, or the same line before it) and the page.
                             Specification bullets are NOT taken: the brochure layout (side boxes such as
                             "RECOMENDED / UPGRADE FROM", several products per row) does not tie them to one product
                             reliably; tests showed bullets of neighbouring products being attached.

Catalogue pictures (Spanish and Indonesian catalogues), for products without a price-list picture: the picture right
under a single reference (Indonesian: starts within 30 pt below it; Spanish: 5-80 pt below, slightly indented), kept only
when it fits exactly one reference and that reference has exactly one picture (overlapping layers are cut together).
Products listed in size tables share a picture with other sizes and get none.
  Catalogo_Ingco.pdf         Spanish catalogue of INGCO España (76 pages, brochure layout). Read for:
                               - size/variant tables "PESO/MEDIDA ... EAN  REF  COD  unid." -> reference, EAN, INGCO España code
                               - single products: Spanish title directly above the reference, "COD nnnn" on the title line
                             EAN numbers printed beside single products are NOT taken: their position on the page does not
                             tie them to one product reliably.

The PDFs are never written to. Outputs (source-data/extracted/ingco/):
  catalogue.json   every price-list row (provenance "INGCO-PL p3 #12") and every reference found in the Spanish catalogue
                   (provenance "INGCO-ES p39"), merged per INGCO reference
  products.csv     the same, flat
  pictures/*.jpg   the product picture of each price-list row

Usage:  python3 spare-parts/tools/extract_ingco_catalogue.py
"""
import csv
import hashlib
import json
import re
from pathlib import Path

import pymupdf

ROOT = Path(__file__).resolve().parents[1]
ORIGINAL = ROOT / "source-data" / "original" / "ingco"
OUT = ROOT / "source-data" / "extracted" / "ingco"
PRICE_LIST = "ingco-price-list-2026.pdf"
CATALOGO = "Catalogo_Ingco.pdf"
KATALOG = [f"ingco_katalog_2024-{i}.pdf" for i in range(1, 5)]

# price list columns (x of the first word of a cell, points); header at y ~ 135
PL_COLS = [("sno", 0, 50), ("ref", 50, 128), ("name", 128, 215), ("desc", 355, 505), ("price", 505, 548), ("qty", 548, 700)]
REF_RE = re.compile(r"^[A-Z]{1,}[A-Z0-9]*\d[A-Z0-9-]*$")
EAN_RE = re.compile(r"^69\d{11}$")

# tool categories, from the English (price list) or Spanish (catalogue) product name; first match wins
CATEGORIES = [
    ("Tools - Welding", r"weld|soldad|electrode|electrodo|soldering|solder|las\b|mesin las|kawat las"),
    ("Tools - Generators & compressors", r"generator|generador|compressor|compresor|kompresor|genset"),
    ("Tools - Measuring", r"measur|\btape\b|\blevel\b|caliper|multimeter|clamp meter|laser|tester|\bmeter\b|medir|flex[oó]metro|nivel|calibre|mult[ií]metro|detector|meteran|jangka sorong|waterpass|tespen|test pencil|luxmeter"),
    ("Tools - Safety (PPE)", r"glove|goggle|helmet|mask|safety|vest|earmuff|guante|gafa|casco|mascarilla|seguridad|chaleco|sarung tangan|kacamata|helm"),
    ("Tools - Garden & cleaning", r"garden|\bhose\b|nozzle|sprayer|mower|trimmer|vacuum|blower|pruning|shear|earth auger|pressure washer|washer\(|foam|jard[ií]n|manguera|pulverizador|cortac[eé]sped|aspirador|soplador|podar|hidrolimpiadora|selang|semprot|gunting dahan"),
    ("Tools - Air tools", r"\bair\b|pneumatic|nailer|blow gun|inflat|spray gun|neum[aá]tic|angin|paku tembak|\baire\b"),
    ("Tools - Accessories & consumables", r"\b(bits?|blades?|discs?|disks?|chisels?|sanding|abrasive|brush|brushes|accessor\w*|extractor set|holders?|hole saw|brocas?|discos?|hojas?|lijas?|cepillos?|puntas?|mata|batu gerinda|batu potong|amplas|diamond wheel|wheels?|segmentado|azulejos|kuas|bulu polis|steples|refill|puntero|cincel|portapuntas|cuchillas)\b"),
    ("Tools - Power tools", r"cordless|brushless|drill|grinder|\bsaw\b|jigsaw|sander|polisher|planer|router|impact|rotary hammer|demolition|heat gun|glue gun|battery|charger|mixer|wall chaser|li-ion|tronzadora|pistola pintar|"
                            r"taladro|amoladora|sierra|lijadora|pulidora|martillo (perforador|demoledor)|bater[ií]a|cargador|atornillador|pistola de calor|mesin|bor\b|gerinda|baterai|charger"),
    ("Tools - Hand tools", r"hammer|plier|wrench|spanner|screwdriver|socket|knife|cutter|clamp|vise|\bfile\b|hex key|torx|allen|crowbar|tools? set|tool ?box|stripper|crimper|mallet|\baxe\b|riveter|stapler|staple gun|trowel|scraper|snip|caulking|chalk line|tool bag|pouch|sucker|"
                           r"martillo|maza|maceta|alicate|llave|destornillador|cuchillo|tenaza|sargento|tornillo de banco|lima|caja de herramientas|juego|"
                           r"kunci|tang\b|obeng|palu|gergaji|kotak perkakas|tool set|cutter|pisau|ragum|catut"),
]
CAT_RES = [(c, re.compile(p, re.I)) for c, p in CATEGORIES]


def category(*names):
    for n in names:
        for c, r in CAT_RES:
            if n and r.search(n):
                return c
    return "Tools - Other"


def clean_title(t):
    """A catalogue title, or None when the text is a table header, size row or a list of references."""
    if not t:
        return None
    t = re.sub(r"\s+COD\s+\d{3,5}$", "", " ".join(t.split()))
    letters = [c for c in t if c.isalpha()]
    if len(letters) < 4 or sum(c.isupper() for c in letters) / len(letters) < 0.8:
        return None
    if any(REF_RE.match(tok.strip(",.;")) and len(tok.strip(",.;")) >= 5 for tok in t.split()):
        return None
    return t


def page_pictures(page, kind):
    """{reference: clip rectangle} for single-reference products whose picture is unambiguous (kind 'es' or 'id')."""
    blocks = page.get_text("blocks")
    refs = [b for b in blocks if len(b[4].split()) == 1 and REF_RE.match(b[4].strip()) and len(b[4].strip()) >= 4]
    imgs = [r for im in page.get_images(full=True) for r in page.get_image_rects(im[0])
            if r.width >= (60 if kind == "id" else 100) and r.width < 400 and r.height >= 30]

    def cand(ref, r):
        if kind == "id":
            return -5 <= r.y0 - ref[3] <= 30 and ref[0] - 40 <= r.x0 <= ref[0] + 60
        return 5 <= r.y0 - ref[3] <= 80 and ref[0] - 15 <= r.x0 <= ref[0] + 90

    out = {}
    for ref in refs:
        cs = [r for r in imgs if cand(ref, r)]
        if not cs:
            continue
        u = pymupdf.Rect(cs[0])
        for r in cs[1:]:
            if r.intersects(u):
                u |= r
        if any(not r.intersects(u) for r in cs):
            continue  # pictures in more than one place
        if any(cand(o, r) for o in refs if o is not ref for r in cs):
            continue  # another reference could own it
        out[ref[4].strip()] = u
    return out


def sha256(b: bytes) -> str:
    return hashlib.sha256(b).hexdigest()


def lines(words):
    rows = {}
    for w in words:
        rows.setdefault(round(w[1] / 3), []).append(w)
    return [sorted(rows[k], key=lambda w: w[0]) for k in sorted(rows)]


def price_list(doc):
    rows = []
    for pn, page in enumerate(doc, start=1):
        words = [w for w in page.get_text("words") if w[1] > 150 or pn > 1 or True]
        hdr = [w for w in words if w[4] == "Qty/Ctn"]
        top = (hdr[0][1] + 10) if hdr else 0
        body = [w for w in words if w[1] > top and not w[4].startswith("Page") and not re.match(r"^\d+$", w[4]) or (w[1] > top and w[0] < 50)]
        body = [w for w in page.get_text("words") if w[1] > top and not (w[4] in ("Page", "of") or (w[1] > page.rect.height - 30))]
        anchors = sorted([w for w in body if w[0] < 50 and re.match(r"^\d+$", w[4])], key=lambda w: w[1])
        bands = [(a, a[1] - 6, (anchors[i + 1][1] - 6) if i + 1 < len(anchors) else page.rect.height - 30) for i, a in enumerate(anchors)]
        # text above the first anchor on a page continues the last row of the previous page
        if rows and anchors:
            cont = [w for w in body if w[1] < anchors[0][1] - 6]
            for w in cont:
                c = next(c for c, x0, x1 in PL_COLS if x0 <= w[0] < x1) if any(x0 <= w[0] < x1 for _, x0, x1 in PL_COLS) else None
                if c in ("desc", "name"):
                    rows[-1][c] += (" " if c == "name" else "\n") + w[4]
        imgs = []
        for img in page.get_images(full=True):
            for r in page.get_image_rects(img[0]):
                if r.x0 >= 200 and r.x1 <= 380:
                    imgs.append(r)
        for a, y0, y1 in bands:
            cells = {c: [] for c, _, _ in PL_COLS}
            for ln in lines([w for w in body if y0 <= w[1] < y1]):
                parts = {}
                for w in ln:
                    for c, x0, x1 in PL_COLS:
                        if x0 <= w[0] < x1:
                            parts.setdefault(c, []).append(w[4])
                for c, v in parts.items():
                    cells[c].append(" ".join(v))
            ref = cells["ref"][0] if cells["ref"] else ""
            pic = next((r for r in imgs if y0 - 20 <= (r.y0 + r.y1) / 2 < y1), None)
            rows.append({
                "source_ref": f"INGCO-PL p{pn} #{a[4]}", "page": pn, "sno": int(a[4]), "ref": ref,
                "ref_extra": " ".join(cells["ref"][1:]) or None,
                "name": " ".join(cells["name"]), "desc": "\n".join(cells["desc"]),
                "price": " ".join(cells["price"]), "qty_ctn": " ".join(cells["qty"]),
                "_pic": (pn, pic) if pic else None,
            })
    return rows


def catalogo(doc):
    found = {}
    for pn, page in enumerate(doc, start=1):
        blocks = page.get_text("blocks")
        for b in blocks:
            toks = b[4].split()
            # variant table row: label words..., EAN, REF, COD, units
            eans = [t for t in toks if EAN_RE.match(t)]
            if len(eans) == 1:
                i = toks.index(eans[0])
                if i + 2 < len(toks) and REF_RE.match(toks[i + 1]) and re.match(r"^\d{3,5}$", toks[i + 2]):
                    ref = toks[i + 1]
                    found.setdefault(ref, {"ref": ref, "pages": [], "ean": None, "cod": None, "title_es": None, "variant_es": None})
                    f = found[ref]
                    f["pages"].append(pn)
                    f["ean"], f["cod"] = eans[0], toks[i + 2]
                    f["variant_es"] = " ".join(toks[:i]) or None
                    continue
        # single products: a block holding only a reference, with the title block right above it (same x)
        for b in blocks:
            t = b[4].strip()
            if REF_RE.match(t) and len(t) >= 4:
                title = next((x for x in blocks if abs(x[0] - b[0]) < 3 and 0 < b[1] - x[3] < 12 and x[4].strip().isupper()), None)
                cod = None
                if title:
                    cod_b = next((x for x in blocks if abs(x[1] - title[1]) < 3 and 0 < x[0] - b[0] < 260 and x[4].strip().startswith("COD ")), None)
                    cod = cod_b[4].strip()[4:].strip() if cod_b else None
                found.setdefault(t, {"ref": t, "pages": [], "ean": None, "cod": None, "title_es": None, "variant_es": None})
                f = found[t]
                f["pages"].append(pn)
                if title and not f["title_es"]:
                    f["title_es"] = clean_title(title[4])
                if cod and not f["cod"]:
                    f["cod"] = cod
    for f in found.values():
        f["pages"] = sorted(set(f["pages"]))
        f["source_ref"] = f"INGCO-ES p{f['pages'][0]}"
    return found


def katalog(docs):
    """INGCO Indonesia 2024: reference, Indonesian title and page. Page numbers count across the 4 files."""
    found, n0 = {}, 0
    for doc in docs:
        for i, page in enumerate(doc):
            pn = n0 + i + 1
            blocks = [b for b in page.get_text("blocks") if b[1] < page.rect.height - 50]
            for b in blocks:
                toks = b[4].split()
                if len(toks) == 1 and REF_RE.match(toks[0]) and len(toks[0]) >= 4:
                    title = next((x for x in blocks if abs(x[0] - b[0]) < 10 and 0 <= b[1] - x[3] < 8 and x is not b
                                  and not (len(x[4].split()) == 1 and REF_RE.match(x[4].strip()))), None)
                    found.setdefault(toks[0], {"ref": toks[0], "page": pn, "source_ref": f"INGCO-ID p{pn}",
                                               "title_id": clean_title(title[4]) if title else None})
                elif len(toks) >= 3 and REF_RE.match(toks[-1]) and len(toks[-1]) >= 5 and " ".join(toks[:-1]).replace("(SS)", "").strip().isupper():
                    found.setdefault(toks[-1], {"ref": toks[-1], "page": pn, "source_ref": f"INGCO-ID p{pn}", "title_id": clean_title(" ".join(toks[:-1]))})
        n0 += doc.page_count
    return found


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    (OUT / "pictures").mkdir(exist_ok=True)
    pl_bytes = (ORIGINAL / PRICE_LIST).read_bytes()
    es_bytes = (ORIGINAL / CATALOGO).read_bytes()
    pl = pymupdf.open(stream=pl_bytes, filetype="pdf")
    es = pymupdf.open(stream=es_bytes, filetype="pdf")
    rows = price_list(pl)
    es_found = catalogo(es)
    kat_bytes = [(ORIGINAL / f).read_bytes() for f in KATALOG]
    kat_docs = [pymupdf.open(stream=b, filetype="pdf") for b in kat_bytes]
    id_found = katalog(kat_docs)

    products, flags = {}, []
    for r in rows:
        pic = r.pop("_pic")
        if pic:
            pn, rect = pic
            pix = pl[pn - 1].get_pixmap(dpi=150, clip=rect)
            name = f"pictures/{re.sub(r'[^A-Za-z0-9-]', '_', r['ref'] or str(r['sno']))}.jpg"
            pix.save(OUT / name, jpg_quality=85)
            r["picture"] = name
        r["flags"] = []
        if not REF_RE.match(r["ref"]):
            r["flags"].append("REF_UNUSUAL")
        if not re.match(r"^\d+(\.\d+)?$", r["price"]):
            r["flags"].append("PRICE_NOT_NUMBER")
        if r["ref"] in products:
            r["flags"].append("DUPLICATE_IN_PRICE_LIST")
            products[r["ref"]]["price_list_rows"].append(r)
            continue
        products[r["ref"]] = {"ref": r["ref"], "price_list_rows": [r], "catalogo": None}
    for ref, f in es_found.items():
        products.setdefault(ref, {"ref": ref, "price_list_rows": [], "catalogo": None})["catalogo"] = f
    for ref, k in id_found.items():
        products.setdefault(ref, {"ref": ref, "price_list_rows": [], "catalogo": None})["katalog_id"] = k
    # catalogue pictures for products without a price-list picture
    pic_docs = [(es, "es", "INGCO-ES", 0)]
    n0 = 0
    for d in kat_docs:
        pic_docs.append((d, "id", "INGCO-ID", n0))
        n0 += d.page_count
    for doc, kind, tag, off in pic_docs:
        for i, page in enumerate(doc):
            for ref, rect in page_pictures(page, kind).items():
                p = products.get(ref)
                if not p or p.get("catalogue_picture") or any(r.get("picture") for r in p["price_list_rows"]):
                    continue
                name = f"pictures/{kind}-{re.sub(r'[^A-Za-z0-9-]', '_', ref)}.jpg"
                page.get_pixmap(dpi=150, clip=rect).save(OUT / name, jpg_quality=85)
                p["catalogue_picture"] = {"file": name, "source_ref": f"{tag} p{off + i + 1}"}
    for p in products.values():
        p.setdefault("catalogue_picture", None)
        p.setdefault("katalog_id", None)
        r = p["price_list_rows"][0] if p["price_list_rows"] else None
        c, k = p["catalogo"], p["katalog_id"]
        p["category"] = category(r and r["name"], c and c["title_es"], r and r["desc"][:80], k and k["title_id"])

    cat = {
        "meta": {
            "brand": "INGCO",
            "sources": [
                {"file": f"original/ingco/{PRICE_LIST}", "sha256": sha256(pl_bytes), "pages": pl.page_count,
                 "title": "INGCO price list 2026 (English)", "currency_note": "The list price currency is not stated in the price list."},
                {"file": f"original/ingco/{CATALOGO}", "sha256": sha256(es_bytes), "pages": es.page_count,
                 "title": "Catálogo INGCO España (Spanish)"},
                *[{"file": f"original/ingco/{f}", "sha256": sha256(b), "pages": d.page_count, "title": f"INGCO Indonesia catalogue 2024, part {n}"}
                  for n, (f, b, d) in enumerate(zip(KATALOG, kat_bytes, kat_docs), start=1)],
            ],
        },
        "products": sorted(products.values(), key=lambda p: (p["price_list_rows"][0]["sno"] if p["price_list_rows"] else 10**6, p["ref"])),
    }
    (OUT / "catalogue.json").write_text(json.dumps(cat, ensure_ascii=False, indent=1))
    with open(OUT / "products.csv", "w", newline="", encoding="utf-8") as f:
        w = csv.writer(f)
        w.writerow(["ref", "category", "price_list_ref", "name_en", "list_price", "qty_ctn", "catalogo_ref", "title_es", "variant_es", "ean", "cod_es", "flags"])
        for p in cat["products"]:
            r = p["price_list_rows"][0] if p["price_list_rows"] else {}
            c = p["catalogo"] or {}
            w.writerow([p["ref"], p["category"], r.get("source_ref", ""), r.get("name", ""), r.get("price", ""), r.get("qty_ctn", ""),
                        c.get("source_ref", ""), c.get("title_es") or "", c.get("variant_es") or "", c.get("ean") or "", c.get("cod") or "",
                        ";".join(r.get("flags", []))])
    n_pl = sum(1 for p in products.values() if p["price_list_rows"])
    print(json.dumps({"price_list_rows": len(rows), "products": len(products), "in_price_list": n_pl,
                      "only_in_catalogo": len(products) - n_pl, "both": sum(1 for p in products.values() if p["price_list_rows"] and p["catalogo"]),
                      "pictures": sum(1 for r in rows if r.get("picture")), "flagged_rows": sum(1 for r in rows if r["flags"]),
                      "with_ean": sum(1 for p in products.values() if p["catalogo"] and p["catalogo"]["ean"]),
                      "in_katalog_2024": len(id_found), "katalog_with_title": sum(1 for k in id_found.values() if k["title_id"]),
                      "catalogue_pictures": sum(1 for p in products.values() if p["catalogue_picture"]),
                      "without_picture": sum(1 for p in products.values() if not p["catalogue_picture"] and not any(r.get("picture") for r in p["price_list_rows"]))}, indent=1))


if __name__ == "__main__":
    main()
