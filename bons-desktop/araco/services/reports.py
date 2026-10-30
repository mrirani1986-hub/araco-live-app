"""Totals of m³ and amount grouped by customer, day, month, grade, truck…"""
from .tickets import where

GROUPS = {
    "customer": ("c.code || ' — ' || c.name", "c.name COLLATE NOCASE"),
    "site": ("c.name || ' / ' || COALESCE(s.name, '—')", "c.name COLLATE NOCASE, s.name"),
    "day": ("tk.date", "tk.date"),
    "month": ("substr(tk.date, 1, 7)", "substr(tk.date, 1, 7)"),
    "year": ("substr(tk.date, 1, 4)", "substr(tk.date, 1, 4)"),
    "grade": ("tk.grade", "tk.grade"),
    "truck": ("COALESCE(NULLIF(tk.truck_no, ''), '—')", "tk.truck_no"),
    "driver": ("COALESCE(NULLIF(tk.driver, ''), '—')", "tk.driver"),
    "plant": ("COALESCE(NULLIF(tk.plant, ''), '—')", "tk.plant"),
}


def summary(db, group_by: str, filters: dict | None = None) -> tuple[list[dict], dict]:
    """Rows of {key, count, quantity, amount, avg_price} plus a grand total.

    Only delivered tickets count unless the filter asks for a status explicitly.
    """
    key_sql, order_sql = GROUPS[group_by]
    f = dict(filters or {})
    f.setdefault("status", "delivered")
    w, params = where(f)
    rows = [dict(r) for r in db.query(
        f"""SELECT {key_sql} AS key, COUNT(*) AS count, ROUND(SUM(tk.quantity), 2) AS quantity,
                   ROUND(SUM(tk.total), 2) AS amount,
                   CASE WHEN SUM(tk.quantity) > 0 THEN ROUND(SUM(tk.total) / SUM(tk.quantity), 2) END AS avg_price
            FROM tickets tk JOIN customers c ON c.id = tk.customer_id LEFT JOIN sites s ON s.id = tk.site_id
            {w} GROUP BY {key_sql} ORDER BY {order_sql}""", params)]
    total = {"count": sum(r["count"] for r in rows),
             "quantity": round(sum(r["quantity"] or 0 for r in rows), 2),
             "amount": round(sum(r["amount"] or 0 for r in rows), 2)}
    total["avg_price"] = round(total["amount"] / total["quantity"], 2) if total["quantity"] else None
    return rows, total


def dashboard(db, today: str) -> dict:
    month = today[:7]

    def agg(cond, params):
        r = db.one(f"SELECT COUNT(*), COALESCE(SUM(quantity), 0), COALESCE(SUM(total), 0) FROM tickets "
                   f"WHERE deleted_at IS NULL AND status = 'delivered' AND {cond}", params)
        return {"count": r[0], "quantity": round(r[1], 2), "amount": round(r[2], 2)}

    return {
        "today": agg("date = ?", (today,)),
        "month": agg("substr(date, 1, 7) = ?", (month,)),
        "year": agg("substr(date, 1, 4) = ?", (today[:4],)),
        "customers": db.scalar("SELECT COUNT(*) FROM customers WHERE deleted_at IS NULL"),
        "top_customers": [dict(r) for r in db.query(
            "SELECT c.name, ROUND(SUM(t.quantity), 2) AS quantity FROM tickets t JOIN customers c ON c.id = t.customer_id "
            "WHERE t.deleted_at IS NULL AND t.status = 'delivered' AND substr(t.date, 1, 7) = ? "
            "GROUP BY c.id ORDER BY quantity DESC LIMIT 5", (month,))],
        "recent": [dict(r) for r in db.query(
            "SELECT t.ticket_no, t.date, c.name AS customer_name, t.grade, t.quantity FROM tickets t "
            "JOIN customers c ON c.id = t.customer_id WHERE t.deleted_at IS NULL ORDER BY t.id DESC LIMIT 8")],
    }
