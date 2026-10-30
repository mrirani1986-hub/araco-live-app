"""Delivery tickets (bons) and their scanned images."""
import re
import shutil
from datetime import datetime
from pathlib import Path

from .. import config
from ..context import ValidationError
from ..db import norm, now
from . import audit, customers, lookups

FIELDS = ["ticket_no", "date", "time", "customer_id", "site_id", "grade", "quantity", "truck_no", "driver",
          "pump_used", "pump_no", "plant", "unit_price", "total", "status", "notes"]
STATUSES = ("delivered", "cancelled")

SELECT = """
SELECT tk.*, c.name AS customer_name, c.code AS customer_code, s.name AS site_name,
       (SELECT COUNT(*) FROM ticket_scans sc WHERE sc.ticket_id = tk.id) AS scan_count,
       cu.username AS created_by_name, uu.username AS updated_by_name
FROM tickets tk
JOIN customers c ON c.id = tk.customer_id
LEFT JOIN sites s ON s.id = tk.site_id
LEFT JOIN users cu ON cu.id = tk.created_by
LEFT JOIN users uu ON uu.id = tk.updated_by
"""


def where(filters: dict) -> tuple[str, list]:
    """WHERE clause shared by the ticket search and the reports."""
    f = filters or {}
    sql = ["WHERE tk.deleted_at IS " + ("NOT NULL" if f.get("deleted") else "NULL")]
    params = []
    simple = {"customer_id": "tk.customer_id = ?", "site_id": "tk.site_id = ?", "grade": "tk.grade = ?",
              "truck_no": "tk.truck_no = ?", "driver": "tk.driver = ?", "plant": "tk.plant = ?",
              "status": "tk.status = ?", "date_from": "tk.date >= ?", "date_to": "tk.date <= ?"}
    for key, clause in simple.items():
        if f.get(key) not in (None, ""):
            sql.append("AND " + clause)
            params.append(f[key])
    for word in norm(f.get("text", "")).split():
        sql.append("AND (norm(tk.ticket_no) LIKE ? OR norm(c.name) LIKE ? OR norm(tk.notes) LIKE ? "
                   "OR norm(s.name) LIKE ?)")
        params += [f"%{word}%"] * 4
    return " ".join(sql), params


def search(db, filters: dict | None = None, limit: int = 20000) -> list[dict]:
    w, params = where(filters)
    return [dict(r) for r in db.query(
        f"{SELECT} {w} ORDER BY tk.date DESC, tk.time DESC, tk.id DESC LIMIT ?", params + [limit])]


def totals(rows) -> dict:
    """Count, m³ and amount; cancelled tickets are not counted."""
    live = [r for r in rows if r["status"] == "delivered"]
    return {"count": len(live), "cancelled": len(rows) - len(live),
            "quantity": round(sum(r["quantity"] for r in live), 2),
            "amount": round(sum(r["total"] for r in live), 2)}


def get(db, ticket_id: int):
    row = db.one(f"{SELECT} WHERE tk.id = ?", (ticket_id,))
    return dict(row) if row else None


def is_duplicate(db, ticket_no: str, exclude_id=None) -> bool:
    return bool(ticket_no.strip()) and bool(db.scalar(
        "SELECT 1 FROM tickets WHERE ticket_no = ? AND deleted_at IS NULL AND id IS NOT ?",
        (ticket_no.strip(), exclude_id)))


def _number(value, default=None):
    if value in (None, ""):
        return default
    if isinstance(value, (int, float)):
        return float(value)
    try:
        return float(norm(value).replace(",", "."))
    except ValueError:
        return "invalid"


def normalize(data: dict) -> dict:
    d = dict(data)
    for key in ("ticket_no", "time", "grade", "truck_no", "driver", "pump_no", "plant", "notes", "date",
                "site_name"):
        if key in d:
            d[key] = (d[key] or "").strip() if isinstance(d[key], str) or d[key] is None else d[key]
    d["quantity"] = _number(d.get("quantity"))
    d["unit_price"] = _number(d.get("unit_price"), 0.0)
    d["pump_used"] = 1 if d.get("pump_used") else 0
    if not d["pump_used"]:
        d["pump_no"] = ""
    d["status"] = d.get("status") or "delivered"
    if isinstance(d["quantity"], float) and isinstance(d["unit_price"], float):
        d["total"] = round(d["quantity"] * d["unit_price"], 2)
    return d


def validate(db, d: dict, ticket_id=None) -> list:
    errors = []
    if not d.get("ticket_no"):
        errors.append("err_ticket_no_required")
    elif is_duplicate(db, d["ticket_no"], ticket_id):
        errors.append(("err_ticket_duplicate", {"no": d["ticket_no"]}))
    try:
        datetime.strptime(d.get("date") or "", "%Y-%m-%d")
    except ValueError:
        errors.append("err_date_invalid")
    if d.get("time") and not re.fullmatch(r"([01]?\d|2[0-3]):[0-5]\d", d["time"]):
        errors.append("err_time_invalid")
    if not d.get("customer_id") or not db.scalar(
            "SELECT 1 FROM customers WHERE id = ? AND deleted_at IS NULL", (d.get("customer_id"),)):
        errors.append("err_customer_required")
    if not d.get("grade"):
        errors.append("err_grade_required")
    q = d.get("quantity")
    if q is None:
        errors.append("err_quantity_required")
    elif q == "invalid" or q <= 0:
        errors.append("err_quantity_positive")
    p = d.get("unit_price")
    if p == "invalid" or (isinstance(p, float) and p < 0):
        errors.append("err_price_invalid")
    if d.get("status") not in STATUSES:
        errors.append("err_status")
    return errors


def _resolve_site(ctx, d: dict):
    """A typed site name becomes a site of the chosen customer."""
    if d.get("site_name") is not None and d.get("customer_id"):
        d["site_id"] = customers.get_or_create_site(ctx, d["customer_id"], d["site_name"])
    elif d.get("site_id") and not ctx.db.scalar("SELECT 1 FROM sites WHERE id = ? AND customer_id = ?",
                                                (d["site_id"], d.get("customer_id"))):
        d["site_id"] = None


def create(ctx, data: dict, scan_files=()) -> int:
    d = normalize(data)
    errors = validate(ctx.db, d)
    if errors:
        raise ValidationError(errors)
    with ctx.db.conn:
        _resolve_site(ctx, d)
        tid = insert(ctx, d)
    for item in scan_files:
        path, ocr_text = item if isinstance(item, tuple) else (item, "")
        attach_scan(ctx, tid, path, ocr_text=ocr_text)
    return tid


def insert(ctx, d: dict, log: bool = True) -> int:
    """Insert an already normalised and validated ticket. The caller owns the transaction."""
    row = {f: d.get(f) for f in FIELDS}
    for f in ("time", "truck_no", "driver", "pump_no", "plant", "notes"):
        row[f] = row[f] or ""
    cur = ctx.db.execute(
        f"INSERT INTO tickets ({', '.join(FIELDS)}, created_at, created_by) "
        f"VALUES ({', '.join('?' * len(FIELDS))}, ?, ?)",
        [row[f] for f in FIELDS] + [now(), ctx.user_id])
    tid = cur.lastrowid
    lookups.learn(ctx.db, "truck", row["truck_no"])
    lookups.learn(ctx.db, "driver", row["driver"])
    if log:
        audit.log(ctx, "create", "ticket", tid, {k: v for k, v in row.items() if v not in (None, "", 0)})
    return tid


def update(ctx, ticket_id: int, data: dict):
    old = get(ctx.db, ticket_id)
    if not old:
        raise ValidationError(["err_not_found"])
    d = normalize({**{f: old[f] for f in FIELDS}, **data})
    errors = validate(ctx.db, d, ticket_id)
    if errors:
        raise ValidationError(errors)
    with ctx.db.conn:
        _resolve_site(ctx, d)
        new = {f: d.get(f) for f in FIELDS}
        for f in ("time", "truck_no", "driver", "pump_no", "plant", "notes"):
            new[f] = new[f] or ""
        changes = audit.diff(old, new, FIELDS)
        if not changes:
            return
        sets = ", ".join(f"{f} = ?" for f in changes)
        ctx.db.execute(f"UPDATE tickets SET {sets}, updated_at = ?, updated_by = ? WHERE id = ?",
                       [new[f] for f in changes] + [now(), ctx.user_id, ticket_id])
        lookups.learn(ctx.db, "truck", new["truck_no"])
        lookups.learn(ctx.db, "driver", new["driver"])
        audit.log(ctx, "update", "ticket", ticket_id, changes)


def soft_delete(ctx, ticket_id: int):
    ctx.require_admin()
    with ctx.db.conn:
        ctx.db.execute("UPDATE tickets SET deleted_at = ?, deleted_by = ? WHERE id = ? AND deleted_at IS NULL",
                       (now(), ctx.user_id, ticket_id))
        audit.log(ctx, "delete", "ticket", ticket_id)


def restore(ctx, ticket_id: int):
    ctx.require_admin()
    row = ctx.db.one("SELECT ticket_no, customer_id FROM tickets WHERE id = ?", (ticket_id,))
    if is_duplicate(ctx.db, row["ticket_no"], ticket_id):
        raise ValidationError([("err_ticket_duplicate", {"no": row["ticket_no"]})])
    with ctx.db.conn:
        ctx.db.execute("UPDATE tickets SET deleted_at = NULL, deleted_by = NULL WHERE id = ?", (ticket_id,))
        # Bring the customer back too, otherwise the ticket would point at a hidden customer.
        ctx.db.execute("UPDATE customers SET deleted_at = NULL, deleted_by = NULL WHERE id = ?", (row["customer_id"],))
        audit.log(ctx, "restore", "ticket", ticket_id)


def purge(ctx, ticket_id: int):
    """Permanently delete a ticket from the Trash, with its scan files."""
    ctx.require_admin()
    paths = [r["file_path"] for r in ctx.db.query("SELECT file_path FROM ticket_scans WHERE ticket_id = ?",
                                                  (ticket_id,))]
    no = ctx.db.scalar("SELECT ticket_no FROM tickets WHERE id = ?", (ticket_id,))
    with ctx.db.conn:
        ctx.db.execute("DELETE FROM ticket_scans WHERE ticket_id = ?", (ticket_id,))
        ctx.db.execute("DELETE FROM tickets WHERE id = ?", (ticket_id,))
        audit.log(ctx, "purge", "ticket", ticket_id, {"ticket_no": no})
    for p in paths:
        (config.data_dir() / p).unlink(missing_ok=True)


def distinct(db, column: str) -> list[str]:
    assert column in ("truck_no", "driver", "plant", "grade", "pump_no")
    return [r[0] for r in db.query(
        f"SELECT DISTINCT {column} FROM tickets WHERE {column} != '' ORDER BY {column}")]


def last_values(db) -> dict:
    """Most recent ticket, to pre-fill the next one (date, plant, price…)."""
    row = db.one("SELECT * FROM tickets WHERE deleted_at IS NULL ORDER BY id DESC LIMIT 1")
    return dict(row) if row else {}


# --- scans -----------------------------------------------------------------------------

def _safe(name: str) -> str:
    return re.sub(r"[^\w.-]+", "_", name, flags=re.UNICODE).strip("_") or "scan"


def attach_scan(ctx, ticket_id: int, src, ocr_text: str = "", move: bool = False) -> int:
    """Copy (or move) an image/PDF into scans/YYYY/MM/ and link it to the ticket."""
    src = Path(src)
    t = ctx.db.one("SELECT ticket_no, date FROM tickets WHERE id = ?", (ticket_id,))
    year, month = (t["date"] or now())[:4], (t["date"] or now())[5:7]
    folder = config.scans_dir() / year / month
    folder.mkdir(parents=True, exist_ok=True)
    stamp = datetime.now().strftime("%Y%m%d%H%M%S%f")[:-3]
    dest = folder / f"{_safe(t['ticket_no'])}_{stamp}{src.suffix.lower()}"
    if move:
        shutil.move(str(src), dest)
    else:
        shutil.copy2(src, dest)
    rel = dest.relative_to(config.data_dir()).as_posix()
    with ctx.db.conn:
        cur = ctx.db.execute(
            "INSERT INTO ticket_scans (ticket_id, file_path, original_name, ocr_text, created_at, created_by) "
            "VALUES (?,?,?,?,?,?)", (ticket_id, rel, src.name, ocr_text or "", now(), ctx.user_id))
        audit.log(ctx, "attach_scan", "ticket", ticket_id, {"file": rel})
    return cur.lastrowid


def scans(db, ticket_id: int) -> list[dict]:
    out = []
    for r in db.query("SELECT * FROM ticket_scans WHERE ticket_id = ? ORDER BY id", (ticket_id,)):
        d = dict(r)
        d["abs_path"] = str(config.data_dir() / d["file_path"])
        out.append(d)
    return out


def remove_scan(ctx, scan_id: int):
    row = ctx.db.one("SELECT * FROM ticket_scans WHERE id = ?", (scan_id,))
    if not row:
        return
    with ctx.db.conn:
        ctx.db.execute("DELETE FROM ticket_scans WHERE id = ?", (scan_id,))
        audit.log(ctx, "remove_scan", "ticket", row["ticket_id"], {"file": row["file_path"]})
    # The file is kept on disk under scans/_removed so nothing is ever lost by a misclick.
    src = config.data_dir() / row["file_path"]
    if src.exists():
        dest = config.scans_dir() / "_removed"
        dest.mkdir(parents=True, exist_ok=True)
        shutil.move(str(src), dest / src.name)


def last_price(db, customer_id, grade: str):
    """Price of this customer's most recent ticket of the same grade, to pre-fill a new ticket."""
    return db.scalar("SELECT unit_price FROM tickets WHERE customer_id = ? AND grade = ? AND deleted_at IS NULL "
                     "AND unit_price > 0 ORDER BY date DESC, id DESC LIMIT 1", (customer_id, grade))


def last_driver(db, truck_no: str):
    return db.scalar("SELECT driver FROM tickets WHERE truck_no = ? AND driver != '' AND deleted_at IS NULL "
                     "ORDER BY id DESC LIMIT 1", (truck_no,))
