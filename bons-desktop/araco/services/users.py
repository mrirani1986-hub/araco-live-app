"""Login and user management."""
from ..auth import hash_password, verify_password
from ..context import ValidationError
from ..db import now
from . import audit

ROLES = ("admin", "data_entry")


def authenticate(db, username: str, password: str):
    row = db.one("SELECT * FROM users WHERE username = ? AND active = 1", (username.strip(),))
    if row and verify_password(password, row["password_hash"]):
        return {k: row[k] for k in ("id", "username", "full_name", "role")}
    return None


def list_users(db) -> list[dict]:
    return [dict(r) for r in db.query(
        "SELECT id, username, full_name, role, active, created_at FROM users ORDER BY username")]


def create(ctx, username: str, full_name: str, password: str, role: str) -> int:
    ctx.require_admin()
    username = username.strip()
    errors = []
    if not username:
        errors.append("err_username_required")
    if len(password) < 4:
        errors.append("err_password_short")
    if role not in ROLES:
        errors.append("err_role")
    if username and ctx.db.scalar("SELECT 1 FROM users WHERE username = ?", (username,)):
        errors.append("err_username_taken")
    if errors:
        raise ValidationError(errors)
    with ctx.db.conn:
        cur = ctx.db.execute(
            "INSERT INTO users (username, full_name, password_hash, role, created_at) VALUES (?,?,?,?,?)",
            (username, full_name.strip(), hash_password(password), role, now()))
        audit.log(ctx, "create", "user", cur.lastrowid, {"username": username, "role": role})
    return cur.lastrowid


def update(ctx, user_id: int, full_name: str, role: str, active: bool):
    ctx.require_admin()
    if role not in ROLES:
        raise ValidationError(["err_role"])
    if user_id == ctx.user_id and (role != "admin" or not active):
        raise ValidationError(["err_cannot_demote_self"])
    with ctx.db.conn:
        ctx.db.execute("UPDATE users SET full_name = ?, role = ?, active = ? WHERE id = ?",
                       (full_name.strip(), role, 1 if active else 0, user_id))
        audit.log(ctx, "update", "user", user_id, {"role": role, "active": active})


def set_password(ctx, user_id: int, new_password: str, old_password: str | None = None):
    """Admins may reset anyone; others may only change their own (with the old password)."""
    if user_id != ctx.user_id:
        ctx.require_admin()
    elif old_password is not None:
        row = ctx.db.one("SELECT password_hash FROM users WHERE id = ?", (user_id,))
        if not verify_password(old_password, row["password_hash"]):
            raise ValidationError(["err_old_password"])
    if len(new_password) < 4:
        raise ValidationError(["err_password_short"])
    with ctx.db.conn:
        ctx.db.execute("UPDATE users SET password_hash = ? WHERE id = ?", (hash_password(new_password), user_id))
        audit.log(ctx, "password", "user", user_id)
