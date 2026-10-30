"""Audit log: who did what, when."""
import json

from ..db import now


def log(ctx, action: str, entity: str = "", entity_id=None, details=None):
    ctx.db.execute(
        "INSERT INTO audit_log (ts, user_id, username, action, entity, entity_id, details) VALUES (?,?,?,?,?,?,?)",
        (now(), ctx.user_id, ctx.user.get("username", ""), action, entity, entity_id,
         json.dumps(details, ensure_ascii=False, default=str) if details else ""))


def diff(old: dict, new: dict, fields) -> dict:
    """{field: [old, new]} for the fields whose value changed."""
    changes = {}
    for f in fields:
        if f in new and (old.get(f) if old else None) != new[f]:
            changes[f] = [old.get(f) if old else None, new[f]]
    return changes


def search(db, entity: str = "", username: str = "", date_from: str = "", date_to: str = "",
           entity_id=None, limit: int = 2000):
    sql, params = ["SELECT * FROM audit_log WHERE 1=1"], []
    if entity:
        sql.append("AND entity = ?"); params.append(entity)
    if entity_id is not None:
        sql.append("AND entity_id = ?"); params.append(entity_id)
    if username:
        sql.append("AND username = ?"); params.append(username)
    if date_from:
        sql.append("AND ts >= ?"); params.append(date_from)
    if date_to:
        sql.append("AND ts < date(?, '+1 day')"); params.append(date_to)
    sql.append("ORDER BY id DESC LIMIT ?"); params.append(limit)
    return [dict(r) for r in db.query(" ".join(sql), params)]
