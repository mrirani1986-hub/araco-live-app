"""Customers and their project sites."""
from ..context import ValidationError
from ..db import digits, norm, now
from . import audit

FIELDS = ["code", "name", "company", "phone", "phone2", "address", "area", "payment_terms", "notes"]

# Delivered, non-deleted tickets per customer, joined into list/detail queries.
_TOTALS = """
LEFT JOIN (
    SELECT customer_id, COUNT(*) AS ticket_count, SUM(quantity) AS total_m3, SUM(total) AS total_amount,
           MAX(date) AS last_date
    FROM tickets WHERE deleted_at IS NULL AND status = 'delivered' GROUP BY customer_id
) t ON t.customer_id = c.id
"""


def next_code(db) -> str:
    n = db.scalar("SELECT MAX(CAST(SUBSTR(code, 2) AS INTEGER)) FROM customers WHERE code GLOB 'C[0-9]*'") or 0
    return f"C{n + 1:04d}"


def _clean(data: dict) -> dict:
    return {f: str(data.get(f) or "").strip() for f in FIELDS if f in data}


def validate(db, data: dict, customer_id=None) -> list:
    errors = []
    if not data.get("name"):
        errors.append("err_name_required")
    code = data.get("code")
    if code and db.scalar("SELECT 1 FROM customers WHERE code = ? AND id IS NOT ?", (code, customer_id)):
        errors.append(("err_code_taken", {"code": code}))
    return errors


def create(ctx, data: dict, sites=()) -> int:
    data = _clean(data)
    if not data.get("code"):
        data["code"] = next_code(ctx.db)
    errors = validate(ctx.db, data)
    if errors:
        raise ValidationError(errors)
    with ctx.db.conn:
        return insert(ctx, data, sites)


def insert(ctx, data: dict, sites=(), log: bool = True) -> int:
    """Insert a cleaned, validated customer (code already set). The caller owns the transaction."""
    row = {f: data.get(f, "") for f in FIELDS}
    cur = ctx.db.execute(
        f"INSERT INTO customers ({', '.join(FIELDS)}, created_at, created_by) "
        f"VALUES ({', '.join('?' * len(FIELDS))}, ?, ?)",
        [row[f] for f in FIELDS] + [now(), ctx.user_id])
    cid = cur.lastrowid
    for site in sites:
        _insert_site(ctx, cid, site)
    if log:
        audit.log(ctx, "create", "customer", cid, {k: v for k, v in row.items() if v})
    return cid


def update(ctx, customer_id: int, data: dict):
    data = _clean(data)
    old = get(ctx.db, customer_id)
    if not old:
        raise ValidationError(["err_not_found"])
    if "code" in data and not data["code"]:
        data["code"] = old["code"]
    merged = {**old, **data}
    errors = validate(ctx.db, merged, customer_id)
    if errors:
        raise ValidationError(errors)
    changes = audit.diff(old, data, FIELDS)
    if not changes:
        return
    with ctx.db.conn:
        sets = ", ".join(f"{f} = ?" for f in changes)
        ctx.db.execute(f"UPDATE customers SET {sets}, updated_at = ?, updated_by = ? WHERE id = ?",
                       [data[f] for f in changes] + [now(), ctx.user_id, customer_id])
        audit.log(ctx, "update", "customer", customer_id, changes)


def get(db, customer_id: int):
    row = db.one(f"SELECT c.*, t.ticket_count, t.total_m3, t.total_amount, t.last_date FROM customers c {_TOTALS} "
                 "WHERE c.id = ?", (customer_id,))
    return dict(row) if row else None


def find_by_code(db, code: str):
    row = db.one("SELECT * FROM customers WHERE code = ? AND deleted_at IS NULL", (code.strip(),))
    return dict(row) if row else None


def search(db, text: str = "", deleted: bool = False, limit: int = 5000) -> list[dict]:
    """Search by name, company, code, phone or area. Arabic letter forms are ignored."""
    sql = [f"SELECT c.*, COALESCE(t.ticket_count, 0) AS ticket_count, COALESCE(t.total_m3, 0) AS total_m3, "
           f"COALESCE(t.total_amount, 0) AS total_amount, t.last_date, "
           f"(SELECT GROUP_CONCAT(name, ' | ') FROM sites s WHERE s.customer_id = c.id AND s.deleted_at IS NULL) AS sites "
           f"FROM customers c {_TOTALS} WHERE c.deleted_at IS {'NOT ' if deleted else ''}NULL"]
    params = []
    for word in norm(text).split():
        like = f"%{word}%"
        clause = ("(norm(c.name) LIKE ? OR norm(c.company) LIKE ? OR norm(c.code) LIKE ? OR norm(c.area) LIKE ? "
                  "OR norm(c.address) LIKE ?")
        params += [like] * 5
        d = digits(word)
        if d:
            clause += " OR digits(c.phone) LIKE ? OR digits(c.phone2) LIKE ?"
            params += [f"%{d}%"] * 2
        sql.append(f"AND {clause})")
    sql.append("ORDER BY c.name COLLATE NOCASE LIMIT ?")
    params.append(limit)
    return [dict(r) for r in db.query(" ".join(sql), params)]


def choices(db) -> list[dict]:
    """Light list for combo boxes/autocomplete."""
    return [dict(r) for r in db.query(
        "SELECT id, code, name, company, phone FROM customers WHERE deleted_at IS NULL ORDER BY name COLLATE NOCASE")]


def soft_delete(ctx, customer_id: int):
    ctx.require_admin()
    with ctx.db.conn:
        ctx.db.execute("UPDATE customers SET deleted_at = ?, deleted_by = ? WHERE id = ? AND deleted_at IS NULL",
                       (now(), ctx.user_id, customer_id))
        audit.log(ctx, "delete", "customer", customer_id)


def restore(ctx, customer_id: int):
    ctx.require_admin()
    with ctx.db.conn:
        ctx.db.execute("UPDATE customers SET deleted_at = NULL, deleted_by = NULL WHERE id = ?", (customer_id,))
        audit.log(ctx, "restore", "customer", customer_id)


def purge(ctx, customer_id: int):
    """Permanently delete a customer from the Trash. Refused while tickets reference it."""
    ctx.require_admin()
    if ctx.db.scalar("SELECT COUNT(*) FROM tickets WHERE customer_id = ?", (customer_id,)):
        raise ValidationError(["err_customer_has_tickets"])
    old = get(ctx.db, customer_id)
    with ctx.db.conn:
        ctx.db.execute("DELETE FROM sites WHERE customer_id = ?", (customer_id,))
        ctx.db.execute("DELETE FROM customers WHERE id = ?", (customer_id,))
        audit.log(ctx, "purge", "customer", customer_id, {"code": old and old["code"], "name": old and old["name"]})


# --- sites ---------------------------------------------------------------------------

def sites(db, customer_id: int, include_deleted: bool = False) -> list[dict]:
    sql = """SELECT s.*, COALESCE(t.n, 0) AS ticket_count, COALESCE(t.m3, 0) AS total_m3
             FROM sites s LEFT JOIN (
                SELECT site_id, COUNT(*) AS n, SUM(quantity) AS m3 FROM tickets
                WHERE deleted_at IS NULL AND status = 'delivered' GROUP BY site_id) t ON t.site_id = s.id
             WHERE s.customer_id = ?"""
    if not include_deleted:
        sql += " AND s.deleted_at IS NULL"
    return [dict(r) for r in db.query(sql + " ORDER BY s.name COLLATE NOCASE", (customer_id,))]


def _insert_site(ctx, customer_id: int, site) -> int:
    if isinstance(site, str):
        site = {"name": site}
    name = (site.get("name") or "").strip()
    if not name:
        raise ValidationError(["err_site_name_required"])
    existing = ctx.db.one("SELECT id, deleted_at FROM sites WHERE customer_id = ? AND name = ?", (customer_id, name))
    if existing:
        if existing["deleted_at"]:
            ctx.db.execute("UPDATE sites SET deleted_at = NULL WHERE id = ?", (existing["id"],))
        return existing["id"]
    cur = ctx.db.execute(
        "INSERT INTO sites (customer_id, name, address, notes, created_at, created_by) VALUES (?,?,?,?,?,?)",
        (customer_id, name, (site.get("address") or "").strip(), (site.get("notes") or "").strip(),
         now(), ctx.user_id))
    return cur.lastrowid


def add_site(ctx, customer_id: int, name: str, address: str = "", notes: str = "") -> int:
    with ctx.db.conn:
        sid = _insert_site(ctx, customer_id, {"name": name, "address": address, "notes": notes})
        audit.log(ctx, "create", "site", sid, {"customer_id": customer_id, "name": name.strip()})
    return sid


def get_or_create_site(ctx, customer_id: int, name: str):
    """Used by ticket entry: typing a new site name creates it under the customer."""
    name = (name or "").strip()
    if not name:
        return None
    row = ctx.db.one("SELECT id FROM sites WHERE customer_id = ? AND name = ? AND deleted_at IS NULL",
                     (customer_id, name))
    return row["id"] if row else add_site(ctx, customer_id, name)


def update_site(ctx, site_id: int, name: str, address: str = "", notes: str = ""):
    name = name.strip()
    if not name:
        raise ValidationError(["err_site_name_required"])
    old = ctx.db.one("SELECT * FROM sites WHERE id = ?", (site_id,))
    if ctx.db.scalar("SELECT 1 FROM sites WHERE customer_id = ? AND name = ? AND id != ?",
                     (old["customer_id"], name, site_id)):
        raise ValidationError(["err_site_exists"])
    new = {"name": name, "address": address.strip(), "notes": notes.strip()}
    changes = audit.diff(dict(old), new, new.keys())
    if changes:
        with ctx.db.conn:
            ctx.db.execute("UPDATE sites SET name = ?, address = ?, notes = ? WHERE id = ?",
                           (name, new["address"], new["notes"], site_id))
            audit.log(ctx, "update", "site", site_id, changes)


def remove_site(ctx, site_id: int):
    """Sites are hidden, not erased, so old tickets keep their site name."""
    ctx.require_admin()
    with ctx.db.conn:
        ctx.db.execute("UPDATE sites SET deleted_at = ? WHERE id = ?", (now(), site_id))
        audit.log(ctx, "delete", "site", site_id)
