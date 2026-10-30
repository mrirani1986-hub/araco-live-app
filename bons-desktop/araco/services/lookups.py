"""Editable lists: concrete grades, plants, trucks, drivers."""
from . import audit

KINDS = ("grade", "plant", "truck", "driver")


def values(db, kind: str, include_inactive: bool = False) -> list[str]:
    sql = "SELECT value FROM lookups WHERE kind = ?"
    if not include_inactive:
        sql += " AND active = 1"
    return [r[0] for r in db.query(sql + " ORDER BY sort_order, value", (kind,))]


def rows(db, kind: str) -> list[dict]:
    return [dict(r) for r in db.query(
        "SELECT * FROM lookups WHERE kind = ? ORDER BY sort_order, value", (kind,))]


def learn(db, kind: str, value: str):
    """Remember a truck/driver typed in a ticket so it autocompletes next time."""
    value = (value or "").strip()
    if value:
        nxt = (db.scalar("SELECT MAX(sort_order) FROM lookups WHERE kind = ?", (kind,)) or 0) + 1
        db.execute("INSERT OR IGNORE INTO lookups (kind, value, sort_order) VALUES (?, ?, ?)",
                   (kind, value, nxt))


def save_list(ctx, kind: str, items: list[tuple[str, bool]]):
    """Replace a list with (value, active) pairs in the given order (admin)."""
    ctx.require_admin()
    assert kind in KINDS
    before = values(ctx.db, kind, include_inactive=True)
    with ctx.db.conn:
        seen = set()
        for order, (value, active) in enumerate(items):
            value = value.strip()
            if not value or value in seen:
                continue
            seen.add(value)
            ctx.db.execute(
                "INSERT INTO lookups (kind, value, sort_order, active) VALUES (?, ?, ?, ?) "
                "ON CONFLICT(kind, value) DO UPDATE SET sort_order = excluded.sort_order, active = excluded.active",
                (kind, value, order, 1 if active else 0))
        for old in before:
            if old not in seen:
                ctx.db.execute("DELETE FROM lookups WHERE kind = ? AND value = ?", (kind, old))
        audit.log(ctx, "update", "lookups", None, {"kind": kind, "values": [v for v, _ in items]})
