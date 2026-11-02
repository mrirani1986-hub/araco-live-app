"""Optional OCR assist with Tesseract (eng+ara): reads a delivery note and suggests the ticket fields."""
import os
import re
import shutil
import sys
from datetime import date
from pathlib import Path

from .db import _ALEF as _UNIFY, _TASHKEEL, norm

WINDOWS_PATHS = [
    r"C:\Program Files\Tesseract-OCR\tesseract.exe",
    r"C:\Program Files (x86)\Tesseract-OCR\tesseract.exe",
    os.path.expandvars(r"%LOCALAPPDATA%\Programs\Tesseract-OCR\tesseract.exe"),
    os.path.expandvars(r"%LOCALAPPDATA%\Tesseract-OCR\tesseract.exe"),
]


def find_tesseract(custom: str = "") -> str | None:
    if custom and Path(custom).is_file():
        return custom
    found = shutil.which("tesseract")
    if found:
        return found
    if sys.platform == "win32":
        return next((p for p in WINDOWS_PATHS if Path(p).is_file()), None)
    return None


def available_languages(exe: str) -> set[str]:
    import pytesseract
    pytesseract.pytesseract.tesseract_cmd = exe
    try:
        return set(pytesseract.get_languages(config=""))
    except Exception:  # noqa: BLE001 - any tesseract failure means "unknown"
        return set()


PASS_SEPARATOR = "\f"  # read_text joins the passes with it; extract_fields votes across them
CELLS_PASS = "#cells"  # header of the pass holding digit-only readings of the first table cells


def _langs(exe: str, languages: str) -> str:
    have = available_languages(exe)
    return "+".join(l for l in languages.split("+") if not have or l in have) or "eng"


def _runs(values, limit: float, gap: int = 3):
    """Consecutive indexes whose value is above `limit`, as [first, last] pairs."""
    out = []
    for i, v in enumerate(values):
        if v > limit:
            if out and i - out[-1][1] <= gap:
                out[-1][1] = i
            else:
                out.append([i, i])
    return out


def row_bands(gray):
    """Split a ruled form into its table rows using the horizontal ruling lines.

    Returns (top, bottom) pixel ranges between lines that contain some ink. Photos without
    clear ruling lines simply give no bands.
    """
    from PIL import Image, ImageOps
    w, h = gray.size
    ink = ImageOps.invert(gray.point(lambda v: 0 if v < 150 else 255))
    rows = list(ink.resize((1, h), Image.BOX).get_flattened_data())
    lines = _runs(rows, 0.30 * 255)
    if len(lines) < 3:
        return []
    edges = [0] + [y for pair in lines for y in pair] + [h]
    bands = []
    for top, bottom in zip(edges[::2], edges[1::2]):
        top, bottom = top + 3, bottom - 3
        if not 18 <= bottom - top <= 160:
            continue
        band_ink = ink.crop((0, top, w, bottom)).resize((1, 1), Image.BOX).getpixel((0, 0))
        if band_ink > 2:  # skip empty cells
            bands.append((top, bottom))
    return bands


def first_cells(gray, bands):
    """The narrow first cell of each table row (e.g. CUBIC METERS), as (band, box) pairs."""
    from PIL import Image, ImageOps
    ink = ImageOps.invert(gray.point(lambda v: 0 if v < 150 else 255))
    w = gray.width
    out = []
    for top, bottom in bands:
        cols = list(ink.crop((0, top, w, bottom)).resize((w, 1), Image.BOX).get_flattened_data())
        verticals = [(a + b) // 2 for a, b in _runs(cols, 0.7 * 255)]
        if len(verticals) < 4:
            continue  # not a multi-column table row
        x1, x2 = verticals[0], verticals[1]
        if 40 < x2 - x1 < 0.25 * w:
            out.append(((top, bottom), (x1 + 4, top, x2 - 4, bottom)))
    return out


def read_passes(path, exe: str, languages: str = "eng+ara") -> list[str]:
    """Several OCR readings of the first page: the whole page, then each table row at two zooms.

    Delivery notes are printed forms whose ruling lines confuse Tesseract; reading each row
    separately recovers the table values (quantity, class, truck, driver, times).
    """
    import pytesseract
    from PIL import Image, ImageOps

    from .media import load_pages
    pytesseract.pytesseract.tesseract_cmd = exe
    langs = _langs(exe, languages)
    page = load_pages(path, scale=2.0, max_pages=1)[0]
    if page.width < 1400:  # small phone photos read better upscaled
        f = 1400 / page.width
        page = page.resize((int(page.width * f), int(page.height * f)), Image.LANCZOS)
    gray = ImageOps.autocontrast(page.convert("L"), cutoff=1)
    passes = [pytesseract.image_to_string(gray, lang=langs, config="--psm 6")]
    bands = row_bands(ImageOps.autocontrast(page.getchannel("R"), cutoff=1))
    if not bands:
        return passes
    # Mostly Latin page → read the rows in English only (much faster, fewer stray Arabic glyphs)
    letters = re.findall(r"[A-Za-z\u0600-\u06ff]", passes[0])
    arabic = sum("\u0600" <= ch <= "\u06ff" for ch in letters)
    row_langs = langs if arabic > 0.2 * max(len(letters), 1) else "eng"
    for scale in (2, 3):
        # Rows are cut out, separated by white space and stacked: one Tesseract call per zoom
        gap = 24
        crops = [gray.crop((0, top, gray.width, bottom)) for top, bottom in bands]
        sheet = Image.new("L", (gray.width, sum(c.height for c in crops) + gap * (len(crops) + 1)), 255)
        y = gap
        for c in crops:
            sheet.paste(c, (0, y))
            y += c.height + gap
        sheet = sheet.resize((sheet.width * scale, sheet.height * scale), Image.LANCZOS)
        passes.append(pytesseract.image_to_string(sheet, lang=row_langs, config="--psm 6"))
    # Small handwritten-size numbers in table cells (the m³) read far better alone, digits only
    cells = []
    for _, box in first_cells(ImageOps.autocontrast(page.getchannel("R"), cutoff=1), bands):
        cell = gray.crop(box)
        cell = cell.resize((cell.width * 3, cell.height * 3), Image.LANCZOS)
        framed = Image.new("L", (cell.width + 60, cell.height + 60), 255)
        framed.paste(cell, (30, 30))
        value = pytesseract.image_to_string(
            framed, lang="eng", config="--psm 7 -c tessedit_char_whitelist=0123456789.,").strip()
        if re.fullmatch(r"\d{1,2}(?:[.,]\d{1,2})?", value) and 0 < float(value.replace(",", ".")) <= 60:
            cells.append(value)
    if len(cells) == 1:  # exactly one number-only first cell: the quantity
        passes.append(f"{CELLS_PASS}\nquantity: {cells[0]}")
    return passes


def read_text(path, exe: str, languages: str = "eng+ara") -> str:
    return PASS_SEPARATOR.join(read_passes(path, exe, languages))


# --- field extraction ----------------------------------------------------------------
# Patterns run on norm()ed text: lowercase, Arabic letter forms unified, western digits.

_NO_LABEL = (r"(?:voucher|ticket|bon|delivery\s*note|رقم\s*البون|رقم\s*الفاتوره|بون)"
             r"(?:\s*(?:no|n[°ºo]|number|#))?")
_NO_GENERIC = r"(?:\bno\b\.?|\bn[°º]\.?|number|\#|رقم)"
_TOKEN = r"([a-z0-9][a-z0-9\-/]{2,15})"
_DATE_PATTERNS = [
    (re.compile(r"\b(20\d{2})[-/.](\d{1,2})[-/.](\d{1,2})\b"), "ymd"),
    (re.compile(r"\b(\d{1,2})[-/.](\d{1,2})[-/.](20\d{2}|\d{2})\b"), "dmy"),
]
_QTY_UNIT = re.compile(r"(?<![\d/])(\d{1,3}(?:[.,]\d{1,2})?)\s*(?:m\s*3|m³|m\^3|cbm|cu\.?\s*m|م\s*3|م³|متر\s*مكعب|مكعب)",
                       re.IGNORECASE)
_QTY_LABEL = re.compile(r"(?:qty|quantity|volume|cubic\s*met\w*|الكميه|كميه)\s*[:=\-]?\s*(\d{1,3}(?:[.,]\d{1,2})?)\b",
                        re.IGNORECASE)
_GRADE = re.compile(r"(?:^|[^a-z0-9]|rm[a-z0-9]?)([bc])\s?(\d{2,3})(?![\d])")
_TIME = re.compile(r"(?<![\d:])([01]?\d|2[0-3])\s?[:.]\s?([0-5]\d)(?![\d.:/-])\s*(am|pm)?")
_END = r"(?=\s*(?:\||\n|$|\s{3,}|destination|date|project|address|driver|pump|التاريخ|العنوان))"
_SEP = r"[ \t]*[:.;\-=*~#]*[ \t]*"


def _date(text: str) -> str | None:
    for rx, kind in _DATE_PATTERNS:
        for m in rx.finditer(text):
            try:
                if kind == "ymd":
                    y, mo, d = int(m[1]), int(m[2]), int(m[3])
                else:
                    d, mo, y = int(m[1]), int(m[2]), int(m[3])
                    y += 2000 if y < 100 else 0
                return date(y, mo, d).isoformat()
            except ValueError:
                continue
    return None


def _without_dates(text: str) -> str:
    for rx, _ in _DATE_PATTERNS:
        text = rx.sub(" ", text)
    return text


def _quantity(text: str) -> float | None:
    def ok(v):
        q = float(v.replace(",", "."))
        return q if 0 < q <= 60 else None  # one mixer load, never hundreds of m³
    for rx in (_QTY_UNIT, _QTY_LABEL):
        for m in rx.finditer(text):
            if ok(m[1]):
                return ok(m[1])
    # printed forms: the quantity is the first number on the row that holds the concrete class
    for line in text.splitlines():
        if _GRADE.search(line):
            m = re.match(r"^\W*(?:[a-z]{1,2}\W+)?(\d{1,2}(?:[.,]\d{1,2})?)(?![\d/])", line)  # skip specks
            if m and ok(m[1]):
                return ok(m[1])
    return None


def _ticket_no(text: str) -> str | None:
    for label in (_NO_LABEL, _NO_GENERIC):
        for m in re.finditer(label + _SEP + _TOKEN, text):
            token = m[1].strip("-/")
            if sum(ch.isdigit() for ch in token) >= 3 and not _date(token):
                return token.upper()
    # otherwise the longest standalone number that is not part of a date or a mobile number
    candidates = [c for c in re.findall(r"(?<![\d.,/:-])(\d{4,8})(?![\d.,/:-])", _without_dates(text))
                  if not (len(c) == 8 and c.startswith(("03", "70", "71", "76", "78", "79", "81")))]
    return max(candidates, key=len) if candidates else None


def _time(text: str) -> str | None:
    labelled = re.search(r"(?:loading|time|departure|الوقت|الساعه)[^\n]*", text)
    for chunk in ([labelled[0]] if labelled else []) + [_without_dates(text)]:
        m = _TIME.search(chunk)
        if m:
            h = int(m[1]) + (12 if m[3] == "pm" and int(m[1]) < 12 else 0)
            return f"{h % 24:02d}:{m[2]}"
    return None


def _grade(text: str) -> str | None:
    m = _GRADE.search(text)
    return f"{m[1].upper()}{m[2]}" if m else None


def _clean_name(value: str) -> str | None:
    """Keep the words of a name, drop OCR specks like '*', '|', '~'."""
    words = [re.sub(r"^(?:[^\w\u0600-\u06ff]|_)+|(?:[^\w\u0600-\u06ff]|_)+$", "", w) for w in value.split()]
    words = [w for w in words if re.search(r"[a-z\u0600-\u06ff]{2,}", w, re.IGNORECASE)]
    return " ".join(words) or None


def _after(labels: list[str], text: str, cased: str) -> str | None:
    """Value printed after the first label that has one on the same line, in its original case."""
    for label in labels:
        for m in re.finditer(label + _SEP + r"([^\n|]+?)" + _END, text):
            value = _clean_name(cased[m.start(1):m.end(1)])
            if value:
                return value
    return None


def _truck(text: str) -> str | None:
    m = re.search(r"(?:truck|mixer|خلاطه|الخلاطه)[^\n|]*?(?<![a-z0-9])([a-z]{0,2}-?\d{1,4})(?![\d:/])", text)
    return m[1].upper() if m else None


def _pump(text: str) -> str | None:
    m = re.search(r"pump\s*n\w*\W{0,4}([a-z]{0,2}-?\d{1,3})(?![\d])", text)
    return m[1].upper() if m else None


def extract_one(text: str) -> dict:
    """Fields found in one OCR reading. Name fields keep the original letter case."""
    cased = _TASHKEEL.sub("", text.translate(_UNIFY)).strip()  # norm() without lowercasing
    t = cased.lower()
    if len(t) != len(cased):  # exotic case mappings; fall back to lowercase names
        cased = t
    out = {
        "ticket_no": _ticket_no(t), "date": _date(t), "time": _time(t), "quantity": _quantity(t),
        "grade": _grade(t), "truck_no": _truck(t), "pump_no": _pump(t),
        "customer": _after([r"(?:customer|client|الزبون|العميل)"], t, cased),
        "site": _after([r"project\s*name", r"(?:project|site|الموقع|المشروع|الورشه)", r"destination"], t, cased),
        "driver": _after([r"(?:driver|السايق|سايق)"], t, cased),
        "address": _after([r"(?:address|العنوان)"], t, cased),
    }
    return {k: v for k, v in out.items() if v not in (None, "")}


def _vote(values: list):
    """Most frequent value; on a tie the earliest reading wins."""
    best = max(values, key=lambda v: (values.count(v), -values.index(v)))
    return best


def _vote_name(values: list[str]) -> str:
    """Names often get a stray OCR word in front ('Sad Abdelrahman Krayt'); keep the words the
    readings agree on, i.e. the longest word-suffix shared by most readings."""
    if len(values) < 2:
        return values[0]
    split = [v.split() for v in values]
    for n in range(max(len(s) for s in split), 0, -1):
        tails = [" ".join(s[-n:]) for s in split if len(s) >= n]
        best = _vote(tails)
        if tails.count(best) >= 2:
            return best
    return _vote(values)


def extract_fields(text: str) -> dict:
    """Ticket fields from read_text() output, voting across its passes.

    Keys (only those found): ticket_no, date, time, quantity, grade, truck_no, pump_no,
    customer, site, driver.
    """
    parts = [p for p in text.split(PASS_SEPARATOR) if p.strip()]
    readings = [extract_one(p) for p in parts if not p.startswith(CELLS_PASS)]
    cells = [extract_one(p) for p in parts if p.startswith(CELLS_PASS)]
    out = {}
    for key in ("ticket_no", "date", "time", "quantity", "grade", "truck_no", "pump_no", "customer", "site",
                "driver", "address"):
        values = [r[key] for r in readings if key in r]
        if values:
            out[key] = _vote_name(values) if key in ("customer", "site", "driver", "address") else _vote(values)
    for c in cells:  # a cell read on its own beats the row readings
        out.update(c)
    return out


def snap(value: str, choices, cutoff: float = 0.78):
    """The existing name closest to an OCR reading ('Abdelranman Krayt' → 'Abdelrahman Krayt'), or None.

    choices: strings, or (text, data) pairs; returns the matching item as given.
    """
    from difflib import SequenceMatcher
    target = re.sub(r"[^\w\u0600-\u06ff]+", " ", norm(value)).strip()
    if not target:
        return None
    best, score = None, cutoff
    for item in choices:
        text = item[0] if isinstance(item, tuple) else item
        cand = re.sub(r"[^\w\u0600-\u06ff]+", " ", norm(text)).strip()
        r = 1.0 if cand == target else SequenceMatcher(None, target, cand).ratio()
        if r > score or (r == score and best is None and r >= cutoff):
            best, score = item, r
    return best
