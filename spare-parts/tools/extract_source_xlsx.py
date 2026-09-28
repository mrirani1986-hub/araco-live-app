#!/usr/bin/env python3
"""
Read-only extractor for the original workbook SPARE_PART_LIST.xlsx (source of truth).

Reads the .xlsx package directly (zip + XML, standard library only) so that
nothing is lost: raw cell text (incl. trailing spaces), merged captions,
fills, fonts, and every picture with its anchor, cropping and Excel image
effects. The workbook is never written to.

Outputs (source-data/extracted/workbook/):
  rows.json / rows.csv   every table row with provenance "SHEET!A12"
  images.json            every picture: sheet, anchor, media path in the zip,
                         sha256, size, linked table
  groups.json            machine -> assembly -> codes

Usage:  python3 spare-parts/tools/extract_source_xlsx.py
"""
import csv
import hashlib
import json
import re
import struct
import zipfile
from pathlib import Path
from xml.etree import ElementTree as ET

ROOT = Path(__file__).resolve().parents[1]
SRC = ROOT / "source-data" / "original" / "SPARE_PART_LIST.xlsx"
OUT = ROOT / "source-data" / "extracted" / "workbook"

NS = {
    "m": "http://schemas.openxmlformats.org/spreadsheetml/2006/main",
    "r": "http://schemas.openxmlformats.org/officeDocument/2006/relationships",
    "rel": "http://schemas.openxmlformats.org/package/2006/relationships",
    "xdr": "http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing",
    "a": "http://schemas.openxmlformats.org/drawingml/2006/main",
    "a14": "http://schemas.microsoft.com/office/drawing/2010/main",
}
R_ID = "{%s}id" % NS["r"]
R_EMBED = "{%s}embed" % NS["r"]

# Equipment (machine) per worksheet.
SHEET_MACHINE = {
    "MIXER": "TWINSHAFT MIXER",
    "CEMENT": "CEMENT WEIGHING BATCHER",
    "WATER": "WATER WEIGHING BATCHER",
    "ADDITIVE": "ADDITIVE WEIGHING BATCHER",
    "INLINE SILO": "INLINE SILO",
    "WEIGHING CONVEYOR": "WEIGHING CONVEYOR",
    "TRANSFER CONVEYOR": "TRANSFER CONVEYOR",
    "PNEUMATIC SYSTEM": "PNEUMATIC SYSTEM (COMPRESSOR)",
    "CEMENT SCREW": "CEMENT SCREW",
    "CEMENT SILO": "CEMENT SILO",
}

# Assembly names for tables that have no caption in the workbook. These are
# inferred from the drawings' "Fig." labels and flagged inferred=True.
INFERRED_GROUP = {
    ("MIXER", 6): "MIXING ARMS, SCRAPER ARMS AND DISCHARGE GATE",
    ("MIXER", 7): "LUBRICATION GROUP",
    ("MIXER", 8): "MIXER DISCHARGE AND GREASE PUMP",
    ("MIXER", 9): "HYDRAULIC UNIT (E53623)",
    ("CEMENT", 0): "CEMENT WEIGHING BATCHER",
    ("CEMENT", 1): "LOAD CELLS AND DISCHARGE VALVE",
    ("WATER", 0): "WATER WEIGHING BATCHER",
    ("ADDITIVE", 0): "ADDITIVE WEIGHING BATCHER",
    ("INLINE SILO", 0): "INLINE SILO",
    ("WEIGHING CONVEYOR", 0): "TAIL SECTION",
    ("WEIGHING CONVEYOR", 1): "HANGERS, HEAD DRIVE AND IDLERS",
    ("TRANSFER CONVEYOR", 0): "HEAD SECTION",
    ("TRANSFER CONVEYOR", 1): "TAIL SECTION AND IDLERS",
    ("PNEUMATIC SYSTEM", 2): "AIR SERVICE UNIT AND AIR TANK",
    ("CEMENT SCREW", 0): "CEMENT SCREW",
    ("CEMENT SILO", 0): "CEMENT SILO",
    ("CEMENT SILO", 1): "SILO BOTTOM AND AERATION",
}

QTY_RE = re.compile(r"^\s*(\d+(?:\.\d+)?)\s*([A-Za-z]*)\s*$")
UNITS = {"PCS": "PCS", "PC": "PCS", "PS": "PCS", "SET": "SET", "M": "M"}
CAPTION_CODE_RE = re.compile(r"\((E[\d-]+)\)")


def parse_qty(raw, default_unit=None):
    """-> (qty, unit, flag). Raw text is always stored separately."""
    if raw is None or str(raw).strip() == "":
        return None, None, "empty"
    s = str(raw).strip()
    if set(s) <= {"-"}:
        return None, None, "dash_placeholder"
    if s.upper() == "ALL":
        return None, default_unit, "all_installed"
    m = QTY_RE.match(s)
    if not m:
        return None, None, "unparseable"
    q = float(m.group(1))
    q = int(q) if q.is_integer() else q
    unit_raw = m.group(2).upper()
    if unit_raw == "":
        return q, default_unit, "number_without_unit"
    unit = UNITS.get(unit_raw)
    if unit is None:
        return q, None, "unknown_unit"
    if unit_raw != unit:
        return q, unit, f"unit_variant:{unit_raw}"
    if " " not in s:
        return q, unit, "missing_space"
    return q, unit, None


def col_to_idx(col):
    n = 0
    for ch in col:
        n = n * 26 + ord(ch) - 64
    return n - 1


def png_size(data):
    if data[:8] == b"\x89PNG\r\n\x1a\n":
        return struct.unpack(">II", data[16:24])
    return None, None


def rels(z, path):
    p = Path(path)
    rp = str(p.parent / "_rels" / (p.name + ".rels"))
    if rp not in z.namelist():
        return {}
    root = ET.fromstring(z.read(rp))
    out = {}
    for r in root.findall("rel:Relationship", NS):
        tgt = r.get("Target")
        if not tgt.startswith("/"):
            tgt = str((p.parent / tgt)).replace("\\", "/")
            parts = []
            for seg in tgt.split("/"):
                if seg == "..":
                    parts.pop()
                else:
                    parts.append(seg)
            tgt = "/".join(parts)
        out[r.get("Id")] = dict(target=tgt.lstrip("/"), type=r.get("Type").rsplit("/", 1)[-1])
    return out


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    z = zipfile.ZipFile(SRC)

    shared = []
    if "xl/sharedStrings.xml" in z.namelist():
        for si in ET.fromstring(z.read("xl/sharedStrings.xml")).findall("m:si", NS):
            shared.append("".join(t.text or "" for t in si.iter("{%s}t" % NS["m"])))

    styles = ET.fromstring(z.read("xl/styles.xml"))
    fonts = styles.find("m:fonts", NS).findall("m:font", NS)
    fills = styles.find("m:fills", NS).findall("m:fill", NS)
    xfs = styles.find("m:cellXfs", NS).findall("m:xf", NS)

    def style_info(s):
        xf = xfs[int(s)] if s is not None else xfs[0]
        font = fonts[int(xf.get("fontId", 0))]
        color = font.find("m:color", NS)
        fill = fills[int(xf.get("fillId", 0))].find("m:patternFill", NS)
        fg = fill.find("m:fgColor", NS) if fill is not None else None
        return dict(
            bold=font.find("m:b", NS) is not None,
            font_color=(color.get("rgb") if color is not None and color.get("rgb") else None),
            fill=(None if fill is None or fill.get("patternType") in (None, "none", "gray125")
                  else (fg.get("rgb") or f"theme:{fg.get('theme')}" if fg is not None else "solid")),
        )

    wb = ET.fromstring(z.read("xl/workbook.xml"))
    wb_rels = rels(z, "xl/workbook.xml")
    rows_out, images_out = [], []

    for sheet in wb.find("m:sheets", NS).findall("m:sheet", NS):
        sname = sheet.get("name")
        spath = wb_rels[sheet.get(R_ID)]["target"]
        sx = ET.fromstring(z.read(spath))
        cells = {}
        for c in sx.iter("{%s}c" % NS["m"]):
            ref = c.get("r")
            m = re.match(r"([A-Z]+)(\d+)", ref)
            col, row = col_to_idx(m.group(1)), int(m.group(2))
            v = c.find("m:v", NS)
            t = c.get("t")
            if t == "s" and v is not None:
                val = shared[int(v.text)]
            elif t == "inlineStr":
                val = "".join(x.text or "" for x in c.iter("{%s}t" % NS["m"]))
            elif v is not None:
                val = v.text
                try:
                    f = float(val)
                    val = int(f) if f.is_integer() else f
                except ValueError:
                    pass
            else:
                val = None
            cells[(row, col)] = dict(value=val, style=style_info(c.get("s")))
        merged = [mc.get("ref") for mc in sx.iter("{%s}mergeCell" % NS["m"])]
        hidden_rows = [r.get("r") for r in sx.iter("{%s}row" % NS["m"]) if r.get("hidden") == "1"]
        hidden_cols = [c.get("min") for c in sx.iter("{%s}col" % NS["m"]) if c.get("hidden") == "1"]

        def val(r, c):
            x = cells.get((r, c))
            return None if x is None else x["value"]

        # Walk rows: header "CODE" starts a table; table ends at first empty row.
        max_row = max((r for r, _ in cells), default=0)
        tables, captions, title = [], [], None
        r = 1
        while r <= max_row:
            a = val(r, 0) if val(r, 0) is not None else val(r, 1)
            if isinstance(a, str) and a.strip().upper() == "CODE":
                tables.append(dict(header_row=r, rows=[]))
                r += 1
                while r <= max_row and any(val(r, c) not in (None, "") for c in range(4)):
                    tables[-1]["rows"].append(r)
                    r += 1
                continue
            if isinstance(a, str) and a.strip():
                if title is None and "SPARE PART LIST" in a.upper() and not tables:
                    title = (r, a)
                captions.append((r, a))
            r += 1

        # Caption for each table = last caption between previous table and this header.
        prev_end = 0
        for ti, t in enumerate(tables):
            cap = [c for c in captions if prev_end < c[0] < t["header_row"]]
            text = cap[-1][1].strip() if cap else None
            if text and title and cap[-1][0] == title[0]:
                text = None  # the sheet title is not a group caption
            if text and text.upper().endswith("SPARE PART LIST"):
                text = text[: -len("SPARE PART LIST")].strip()
            inferred = False
            if not text:
                text = INFERRED_GROUP.get((sname, ti))
                inferred = True
            code = CAPTION_CODE_RE.search(text or "")
            t.update(caption_raw=cap[-1][1] if cap else None, group=text, group_inferred=inferred,
                     group_code=code.group(1) if code else None,
                     caption_cell=f"A{cap[-1][0]}" if cap else None)
            prev_end = t["rows"][-1] if t["rows"] else t["header_row"]

        machine = SHEET_MACHINE[sname]
        for ti, t in enumerate(tables):
            for r in t["rows"]:
                code_raw, name_raw, pieces_raw, spare_raw = (val(r, c) for c in range(4))
                code = str(code_raw).strip() if code_raw is not None else ""
                name = " ".join(str(name_raw).split()) if name_raw is not None else ""
                pq, pu, pflag = parse_qty(pieces_raw)
                sq, su, sflag = parse_qty(spare_raw, default_unit=pu)
                if sflag == "empty":
                    sflag = None
                if sflag == "all_installed":
                    sq = pq
                st = cells.get((r, 0), {}).get("style", {})
                rows_out.append(dict(
                    source_ref=f"{sname}!A{r}", sheet=sname, row=r, table=ti,
                    machine=machine, group=t["group"], group_code=t["group_code"],
                    group_inferred=t["group_inferred"], caption_cell=t["caption_cell"],
                    code=code, code_raw=code_raw, part_name=name, name_raw=name_raw,
                    pieces_raw=pieces_raw, spare_raw=spare_raw,
                    pieces_qty=pq, pieces_unit=pu, pieces_issue=pflag,
                    spare_qty=sq, spare_unit=su, spare_issue=sflag,
                    code_has_whitespace=(isinstance(code_raw, str) and code_raw != code_raw.strip()),
                    fill=st.get("fill"),
                    pieces_font_color=cells.get((r, 2), {}).get("style", {}).get("font_color"),
                ))

        # Pictures
        srels = rels(z, spath)
        for rid, rel in srels.items():
            if rel["type"] != "drawing":
                continue
            dpath = rel["target"]
            drels = rels(z, dpath)
            dx = ET.fromstring(z.read(dpath))
            for anchor in list(dx):
                pic = anchor.find("xdr:pic", NS)
                if pic is None:
                    continue
                fr, to = anchor.find("xdr:from", NS), anchor.find("xdr:to", NS)
                frm = (int(fr.find("xdr:row", NS).text), int(fr.find("xdr:col", NS).text))
                too = (int(to.find("xdr:row", NS).text), int(to.find("xdr:col", NS).text)) if to is not None else None
                blip = pic.find("xdr:blipFill/a:blip", NS)
                media = drels[blip.get(R_EMBED)]["target"]
                layer = blip.find(".//a14:imgLayer", NS)
                original = drels[layer.get(R_EMBED)]["target"] if layer is not None else None
                effects = [list(e)[0].tag.split("}")[1] + str(dict(list(e)[0].attrib))
                           for e in (layer.findall("a14:imgEffect", NS) if layer is not None else [])]
                src = pic.find("xdr:blipFill/a:srcRect", NS)
                xfrm = pic.find("xdr:spPr/a:xfrm", NS)
                rotation = round(int(xfrm.get("rot", "0")) / 60000) % 360 if xfrm is not None else 0
                flip_h = xfrm is not None and xfrm.get("flipH") == "1"
                flip_v = xfrm is not None and xfrm.get("flipV") == "1"
                data = z.read(media)
                w, h = png_size(data)
                name = pic.find("xdr:nvPicPr/xdr:cNvPr", NS).get("name")
                # 1-based row of the anchor's top edge; link to the first table header below it.
                top_row = frm[0] + 1
                below = [(t["header_row"], i) for i, t in enumerate(tables) if t["header_row"] >= top_row]
                linked = min(below)[1] if below else None
                images_out.append(dict(
                    sheet=sname, picture_name=name, anchor_from=f"{chr(65 + frm[1])}{frm[0] + 1}",
                    anchor_to=f"{chr(65 + too[1])}{too[0] + 1}" if too else None,
                    media=media, original_media=original, effects=effects,
                    crop=dict(src.attrib) if src is not None else None,
                    rotation_deg=rotation, flip_h=flip_h, flip_v=flip_v,
                    sha256=hashlib.sha256(data).hexdigest(), bytes=len(data), width=w, height=h,
                    table=linked,
                    machine=machine,
                    group=tables[linked]["group"] if linked is not None else None,
                ))

        print(f"{sname:20s} tables={len(tables):2d} rows={sum(len(t['rows']) for t in tables):3d} "
              f"pictures={sum(1 for i in images_out if i['sheet'] == sname)} merged={len(merged)} "
              f"hidden_rows={hidden_rows} hidden_cols={hidden_cols}")

    props = ET.fromstring(z.read("docProps/core.xml"))
    meta = dict(
        source_file=str(SRC.relative_to(ROOT)),
        sha256=hashlib.sha256(SRC.read_bytes()).hexdigest(),
        properties={el.tag.split("}")[1]: el.text for el in props},
        sheets=list(SHEET_MACHINE), row_count=len(rows_out), image_count=len(images_out),
    )
    (OUT / "rows.json").write_text(json.dumps(dict(meta=meta, rows=rows_out), indent=2, default=str))
    (OUT / "images.json").write_text(json.dumps(images_out, indent=2))
    groups = {}
    for r in rows_out:
        g = groups.setdefault(f"{r['machine']} / {r['group']}", dict(
            machine=r["machine"], group=r["group"], group_code=r["group_code"],
            inferred=r["group_inferred"], sheet=r["sheet"], codes=[]))
        g["codes"].append(r["code"])
    (OUT / "groups.json").write_text(json.dumps(groups, indent=2))
    with open(OUT / "rows.csv", "w", newline="") as f:
        w = csv.DictWriter(f, fieldnames=list(rows_out[0].keys()))
        w.writeheader()
        w.writerows(rows_out)
    print(json.dumps({k: v for k, v in meta.items() if k != "properties"}, indent=2))


if __name__ == "__main__":
    main()
