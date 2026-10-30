"""Import historical customers from Excel (.xlsx) or CSV with a column mapping."""
import csv
import io
import re
from pathlib import Path

from .context import ValidationError
from .db import digits, norm
from .services import audit, customers

TARGETS = ["code", "name", "company", "phone", "phone2", "address", "area", "payment_terms", "notes", "site"]

# Header words (normalised) that suggest each target field.
SYNONYMS = {
    "code": ["code", "customer code", "client code", "id", "no", "number", "كود", "رمز", "رقم الزبون", "الرقم"],
    "name": ["name", "customer", "client", "customer name", "client name", "الاسم", "اسم", "الزبون", "اسم الزبون",
             "العميل", "اسم العميل"],
    "company": ["company", "firm", "contractor", "الشركه", "شركه", "المتعهد", "المؤسسه"],
    "phone": ["phone", "tel", "telephone", "mobile", "gsm", "phone 1", "الهاتف", "هاتف", "الخليوي", "رقم الهاتف",
              "جوال", "موبايل"],
    "phone2": ["phone 2", "phone2", "tel 2", "mobile 2", "other phone", "هاتف 2", "هاتف اخر"],
    "address": ["address", "location", "العنوان", "عنوان"],
    "area": ["area", "region", "city", "town", "المنطقه", "منطقه", "البلده", "المدينه"],
    "payment_terms": ["payment", "payment terms", "terms", "شروط الدفع", "الدفع", "طريقه الدفع"],
    "notes": ["notes", "note", "remarks", "comments", "ملاحظات", "ملاحظه"],
    "site": ["site", "sites", "project", "project site", "الورشه", "ورشه", "الموقع", "المشروع", "المشاريع"],
}


def read_table(path) -> tuple[list[str], list[list[str]]]:
    """Return (header, rows) as strings. The first row is the header."""
    path = Path(path)
    ext = path.suffix.lower()
    if ext in (".xlsx", ".xlsm"):
        from openpyxl import load_workbook
        wb = load_workbook(path, read_only=True, data_only=True)
        ws = wb.worksheets[0]
        rows = [[_cell(v) for v in row] for row in ws.iter_rows(values_only=True)]
        wb.close()
    elif ext in (".csv", ".txt"):
        raw = path.read_bytes()
        for enc in ("utf-8-sig", "cp1256", "latin-1"):
            try:
                text = raw.decode(enc)
                break
            except UnicodeDecodeError:
                continue
        try:
            dialect = csv.Sniffer().sniff(text[:4096], delimiters=",;\t|")
        except csv.Error:
            dialect = csv.excel
        rows = [[c.strip() for c in row] for row in csv.reader(io.StringIO(text), dialect)]
    elif ext == ".xls":
        raise ValidationError(["err_xls_old"])
    else:
        raise ValidationError(["err_file_type"])
    rows = [r for r in rows if any(c for c in r)]
    if not rows:
        return [], []
    width = max(len(r) for r in rows)
    rows = [r + [""] * (width - len(r)) for r in rows]
    return rows[0], rows[1:]


def _cell(v) -> str:
    if v is None:
        return ""
    if isinstance(v, float) and v.is_integer():
        return str(int(v))  # phone numbers stored as numbers in Excel
    return str(v).strip()


def guess_mapping(header: list[str]) -> dict:
    """{target: column index} from header names (Arabic or English)."""
    mapping = {}
    for idx, h in enumerate(header):
        key = re.sub(r"[_\-.:#]+", " ", norm(h)).strip()
        for target, words in SYNONYMS.items():
            if target in mapping:
                continue
            if key in words:
                mapping[target] = idx
                break
    # loose match on contained words for anything left
    for idx, h in enumerate(header):
        key = norm(h)
        if idx in mapping.values():
            continue
        for target, words in SYNONYMS.items():
            if target not in mapping and any(len(w) > 3 and w in key for w in words):
                mapping[target] = idx
                break
    return mapping


def import_customers(ctx, rows: list[list[str]], mapping: dict, update_existing: bool = False) -> dict:
    """Create customers from mapped rows.

    Rows describing the same customer (same code, or same name + phone) are merged, so a sheet
    with one row per project site creates one customer with several sites.
    Existing customers (same code, or same name + phone) are skipped, or updated if asked.
    """
    ctx.require_admin()
    if "name" not in mapping:
        raise ValidationError(["err_map_name"])
    stats = {"created": 0, "updated": 0, "skipped": 0, "sites": 0, "errors": []}
    groups: dict[str, dict] = {}
    for line_no, row in enumerate(rows, start=2):
        rec = {t: (row[i] if i is not None and i < len(row) else "").strip() for t, i in mapping.items()}
        if not rec.get("name"):
            if any(rec.values()):
                stats["errors"].append((line_no, "err_name_required"))
            continue
        key = norm(rec.get("code")) or f"{norm(rec['name'])}|{digits(rec.get('phone'))}"
        g = groups.setdefault(key, {"data": {}, "sites": []})
        for t, v in rec.items():
            if t == "site":
                for s in re.split(r"[;|\n]+", v):
                    if s.strip() and s.strip() not in g["sites"]:
                        g["sites"].append(s.strip())
            elif v and not g["data"].get(t):
                g["data"][t] = v

    for g in groups.values():
        data = g["data"]
        existing = None
        if data.get("code"):
            existing = ctx.db.one("SELECT id FROM customers WHERE code = ?", (data["code"],))
        else:
            for r in ctx.db.query("SELECT id, phone FROM customers WHERE norm(name) = ?", (norm(data["name"]),)):
                if digits(r["phone"]) == digits(data.get("phone")):
                    existing = r
                    break
        try:
            if existing:
                if update_existing:
                    customers.update(ctx, existing["id"], data)
                    stats["updated"] += 1
                else:
                    stats["skipped"] += 1
                cid = existing["id"]
                for s in g["sites"]:
                    if not ctx.db.scalar("SELECT 1 FROM sites WHERE customer_id = ? AND name = ?", (cid, s)):
                        customers.add_site(ctx, cid, s)
                        stats["sites"] += 1
            else:
                customers.create(ctx, data, sites=g["sites"])
                stats["created"] += 1
                stats["sites"] += len(g["sites"])
        except ValidationError as e:
            stats["errors"].append((data.get("name"), e.errors[0]))
    with ctx.db.conn:
        audit.log(ctx, "import", "customer", None, {k: v for k, v in stats.items() if k != "errors"})
    return stats
