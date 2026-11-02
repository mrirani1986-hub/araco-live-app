"""Key/value application settings."""


def get(db, key: str, default: str = "") -> str:
    value = db.scalar("SELECT value FROM settings WHERE key = ?", (key,))
    return default if value is None else value


def get_bool(db, key: str, default: bool = False) -> bool:
    return get(db, key, "1" if default else "0") == "1"


def get_int(db, key: str, default: int = 0) -> int:
    try:
        return int(get(db, key, str(default)))
    except ValueError:
        return default


def set_value(db, key: str, value):
    if isinstance(value, bool):
        value = "1" if value else "0"
    with db.conn:
        db.execute("INSERT INTO settings (key, value) VALUES (?, ?) "
                   "ON CONFLICT(key) DO UPDATE SET value = excluded.value", (key, str(value)))


def set_many(ctx, values: dict):
    from . import audit
    ctx.require_admin()
    old = {k: get(ctx.db, k) for k in values}
    for k, v in values.items():
        set_value(ctx.db, k, v)
    changes = {k: [old[k], get(ctx.db, k)] for k in values if old[k] != get(ctx.db, k)}
    if changes:
        with ctx.db.conn:
            audit.log(ctx, "update", "settings", None, changes)
