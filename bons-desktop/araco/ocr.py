"""Optional OCR assist with Tesseract (eng+ara): suggests ticket no., date and quantity."""
import os
import re
import shutil
import sys
from datetime import date
from pathlib import Path

from .db import norm

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


def read_text(path, exe: str, languages: str = "eng+ara") -> str:
    import pytesseract
    from PIL import ImageOps

    from .media import load_pages
    pytesseract.pytesseract.tesseract_cmd = exe
    have = available_languages(exe)
    langs = "+".join(l for l in languages.split("+") if not have or l in have) or "eng"
    texts = []
    for page in load_pages(path, scale=2.0, max_pages=2):
        gray = ImageOps.autocontrast(ImageOps.grayscale(page))
        if gray.width < 1500:  # small phone photos read better upscaled
            f = 1500 / gray.width
            gray = gray.resize((int(gray.width * f), int(gray.height * f)))
        texts.append(pytesseract.image_to_string(gray, lang=langs, config="--psm 6"))
    return "\n".join(texts)


# --- field extraction ----------------------------------------------------------------

_NO_LABEL = (r"(?:ticket|bon|delivery\s*note|d\.?n\.?|no\.?|n[°ºo]\.?|num(?:ber)?|#|"
             r"رقم\s*البون|رقم\s*الفاتوره|رقم|بون)")
_DATE_PATTERNS = [
    (re.compile(r"\b(20\d{2})[-/.](\d{1,2})[-/.](\d{1,2})\b"), "ymd"),
    (re.compile(r"\b(\d{1,2})[-/.](\d{1,2})[-/.](20\d{2}|\d{2})\b"), "dmy"),
]
_QTY_UNIT = re.compile(r"(\d{1,3}(?:[.,]\d{1,2})?)\s*(?:m\s*3|m³|m\^3|cbm|cu\.?\s*m|م\s*3|م³|متر\s*مكعب|مكعب)",
                       re.IGNORECASE)
_QTY_LABEL = re.compile(r"(?:qty|quantity|volume|vol|load|الكميه|كميه)\s*[:=\-]?\s*(\d{1,3}(?:[.,]\d{1,2})?)",
                        re.IGNORECASE)


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


def _quantity(text: str) -> float | None:
    for rx in (_QTY_UNIT, _QTY_LABEL):
        for m in rx.finditer(text):
            q = float(m[1].replace(",", "."))
            if 0 < q <= 60:  # one mixer load / one pour, never hundreds of m³
                return q
    return None


def _ticket_no(text: str) -> str | None:
    m = re.search(_NO_LABEL + r"\s*[:.#\-]?\s*([A-Z]{0,3}\s?-?\d{3,10})\b", text, re.IGNORECASE)
    if m:
        return re.sub(r"\s", "", m[1])
    # otherwise the longest standalone number that is not part of a date or phone
    cleaned = text
    for rx, _ in _DATE_PATTERNS:
        cleaned = rx.sub(" ", cleaned)
    candidates = [c for c in re.findall(r"(?<![\d.,/:-])(\d{4,8})(?![\d.,/:-])", cleaned)
                  if not (len(c) == 8 and c.startswith(("03", "70", "71", "76", "78", "79", "81")))]  # mobiles
    return max(candidates, key=len) if candidates else None


def extract_fields(text: str) -> dict:
    """{'ticket_no', 'date', 'quantity'} — only the ones found."""
    t = norm(text)
    out = {"ticket_no": _ticket_no(t), "date": _date(t), "quantity": _quantity(t)}
    return {k: v for k, v in out.items() if v is not None}
