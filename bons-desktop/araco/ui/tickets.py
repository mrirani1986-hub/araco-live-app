"""Tickets list with filters and totals; also the FilterBar reused by the reports page."""
from datetime import date, timedelta

from PySide6.QtCore import QDate, QTimer, Signal
from PySide6.QtWidgets import (QComboBox, QDateEdit, QGridLayout, QHBoxLayout, QLabel, QLineEdit, QPushButton,
                               QVBoxLayout, QWidget)

from ..i18n import tr
from ..services import customers, lookups, settings, tickets
from .widgets import Col, DataTable, SearchCombo, ask, export_table, fmt_date, fmt_money, fmt_num, info, page_title

TICKET_COLUMNS = [
    Col("ticket_no", "ticket_no", width=110), Col("date", "date", "date", 110), Col("time", "time", width=70),
    Col("customer_name", "customer", width=210), Col("site_name", "site", width=170), Col("grade", "grade", width=130),
    Col("quantity", "quantity", "num", 115), Col("truck_no", "truck", width=125), Col("driver", "driver", width=140),
    Col("pump_no", "pump", width=75), Col("plant", "plant", width=95), Col("unit_price", "unit_price", "money", 105),
    Col("total", "total", "money", 110), Col("status", "status", "status", 90), Col("scan_count", "scans", "int", 55),
    Col("notes", "notes"),
]

PERIODS = ["this_month", "today", "yesterday", "this_week", "last_month", "this_year", "all_dates", "custom"]


def period_range(key: str, today: date | None = None):
    t = today or date.today()
    if key == "today":
        return t, t
    if key == "yesterday":
        y = t - timedelta(days=1)
        return y, y
    if key == "this_week":
        start = t - timedelta(days=(t.weekday() + 1) % 7)  # weeks start on Sunday
        return start, t
    if key == "this_month":
        return t.replace(day=1), t
    if key == "last_month":
        end = t.replace(day=1) - timedelta(days=1)
        return end.replace(day=1), end
    if key == "this_year":
        return t.replace(month=1, day=1), t
    return None, None


class FilterBar(QWidget):
    changed = Signal()

    def __init__(self, db, parent=None, show_status: bool = True, period: str = "this_month"):
        super().__init__(parent)
        self.db = db
        self._timer = QTimer(self)
        self._timer.setSingleShot(True)
        self._timer.setInterval(300)
        self._timer.timeout.connect(self.changed.emit)

        self.period = QComboBox()
        for p in PERIODS:
            self.period.addItem(tr(p), p)
        self.d_from, self.d_to = QDateEdit(), QDateEdit()
        for d in (self.d_from, self.d_to):
            d.setCalendarPopup(True)
            d.setDisplayFormat("dd/MM/yyyy")
            d.dateChanged.connect(self._dates_edited)
        self.customer = SearchCombo(placeholder=tr("all"))
        self.site = SearchCombo(placeholder=tr("all"))
        self.grade, self.plant, self.status = QComboBox(), QComboBox(), QComboBox()
        self.truck, self.driver = SearchCombo(placeholder=tr("all")), SearchCombo(placeholder=tr("all"))
        self.text = QLineEdit()
        self.text.setPlaceholderText(tr("text_search"))
        self.text.setClearButtonEnabled(True)
        clear = QPushButton(tr("clear_filters"))
        clear.clicked.connect(self.clear)

        g = QGridLayout(self)
        g.setContentsMargins(0, 0, 0, 0)
        g.setHorizontalSpacing(8)
        g.setVerticalSpacing(6)
        row1 = [("period", self.period), ("from", self.d_from), ("to", self.d_to), ("customer", self.customer),
                ("site", self.site), ("text_search", self.text)]
        row2 = [("grade", self.grade), ("truck", self.truck), ("driver", self.driver), ("plant", self.plant)]
        if show_status:
            row2.append(("status", self.status))
        for r, items in enumerate((row1, row2)):
            col = 0
            for key, w in items:
                lbl = QLabel(tr(key))
                lbl.setObjectName("hint")
                g.addWidget(lbl, r * 2, col)
                g.addWidget(w, r * 2 + 1, col)
                col += 1
        g.addWidget(clear, 3, 5)
        for c in range(6):
            g.setColumnStretch(c, 1)
        self.status.setVisible(show_status)

        self.reload_lists()
        self.period.setCurrentIndex(PERIODS.index(period))
        self._apply_period()
        self.period.currentIndexChanged.connect(self._apply_period)
        self.customer.currentTextChanged.connect(self._customer_changed)
        for w in (self.site, self.truck, self.driver):
            w.currentTextChanged.connect(self.kick)
        for w in (self.grade, self.plant, self.status):
            w.currentIndexChanged.connect(self.kick)
        self.text.textChanged.connect(self.kick)

    def kick(self, *_):
        self._timer.start()

    def reload_lists(self):
        keep = self.values()
        self.customer.set_items([(f"{c['name']} — {c['code']}", c["id"]) for c in customers.choices(self.db)])
        for combo, kind, column in ((self.grade, "grade", "grade"), (self.plant, "plant", "plant")):
            combo.blockSignals(True)
            current = combo.currentText()
            combo.clear()
            combo.addItem(tr("all"), "")
            for v in sorted(set(lookups.values(self.db, kind)) | set(tickets.distinct(self.db, column))):
                combo.addItem(v, v)
            combo.setCurrentIndex(max(combo.findText(current), 0))
            combo.blockSignals(False)
        self.truck.set_items(tickets.distinct(self.db, "truck_no"))
        self.driver.set_items(tickets.distinct(self.db, "driver"))
        if self.status.count() == 0:
            self.status.addItem(tr("all"), "")
            for s in tickets.STATUSES:
                self.status.addItem(tr("status_" + s), s)
        if keep.get("customer_id"):
            self.customer.set_data_value(keep["customer_id"])

    def _apply_period(self, *_):
        key = self.period.currentData()
        start, end = period_range(key)
        if key == "all_dates":  # show the span of the data in the disabled boxes
            first = self.db.scalar("SELECT MIN(date) FROM tickets WHERE deleted_at IS NULL")
            start, end = (date.fromisoformat(first) if first else date.today()), date.today()
        for d in (self.d_from, self.d_to):
            d.blockSignals(True)
            d.setEnabled(key != "all_dates")
        if start:
            self.d_from.setDate(QDate(start.year, start.month, start.day))
            self.d_to.setDate(QDate(end.year, end.month, end.day))
        for d in (self.d_from, self.d_to):
            d.blockSignals(False)
        self.kick()

    def _dates_edited(self, *_):
        if self.period.currentData() != "custom":
            self.period.blockSignals(True)
            self.period.setCurrentIndex(PERIODS.index("custom"))
            self.period.blockSignals(False)
            self.d_from.setEnabled(True)
            self.d_to.setEnabled(True)
        self.kick()

    def _customer_changed(self, *_):
        cid = self.customer.value_data()
        self.site.set_items([(s["name"], s["id"]) for s in customers.sites(self.db, cid)] if cid else [],
                            keep_text=False)
        self.kick()

    def clear(self):
        for w in (self.customer, self.site, self.truck, self.driver):
            w.setCurrentIndex(-1)
            w.setEditText("")
        for w in (self.grade, self.plant, self.status):
            w.setCurrentIndex(0)
        self.text.clear()
        self.period.setCurrentIndex(0)

    def set_customer(self, customer_id):
        self.customer.set_data_value(customer_id)
        self._customer_changed()

    def values(self) -> dict:
        f = {}
        if self.period.currentData() != "all_dates":
            f["date_from"] = self.d_from.date().toString("yyyy-MM-dd")
            f["date_to"] = self.d_to.date().toString("yyyy-MM-dd")
        cid = self.customer.value_data()
        if cid:
            f["customer_id"] = cid
        sid = self.site.value_data()
        if sid:
            f["site_id"] = sid
        for key, combo in (("grade", self.grade), ("plant", self.plant), ("status", self.status)):
            if combo.currentData():
                f[key] = combo.currentData()
        if self.truck.value_text():
            f["truck_no"] = self.truck.value_text()
        if self.driver.value_text():
            f["driver"] = self.driver.value_text()
        if self.text.text().strip():
            f["text"] = self.text.text().strip()
        return f

    def describe(self) -> str:
        """Human summary of the active filters, printed under report titles."""
        f = self.values()
        parts = []
        if "date_from" in f:
            parts.append(f"{fmt_date(f['date_from'])} → {fmt_date(f['date_to'])}")
        else:
            parts.append(tr("all_dates"))
        for key, w in (("customer", self.customer), ("site", self.site), ("truck", self.truck),
                       ("driver", self.driver)):
            if w.value_text():
                parts.append(f"{tr(key)}: {w.value_text()}")
        for key, combo in (("grade", self.grade), ("plant", self.plant), ("status", self.status)):
            if combo.currentData():
                parts.append(f"{tr(key)}: {combo.currentText()}")
        return "  |  ".join(parts)


def totals_text(t: dict) -> str:
    s = tr("totals_line", count=t["count"], quantity=fmt_num(t["quantity"]), amount=fmt_money(t["amount"]))
    if t.get("cancelled"):
        s += tr("cancelled_count", n=t["cancelled"])
    return s


class TicketsPage(QWidget):
    def __init__(self, main):
        super().__init__()
        self.main = main
        self.ctx = main.ctx
        self.setObjectName("page")
        lay = QVBoxLayout(self)
        lay.setContentsMargins(24, 18, 24, 18)
        lay.setSpacing(10)
        top = QHBoxLayout()
        top.addWidget(page_title(tr("tickets")))
        top.addStretch()
        actions = [("new_ticket", main.new_ticket, "primary"), ("scan_ticket", main.scan_ticket, ""),
                   ("batch_scan", main.batch_scan, ""), ("import_file", main.import_ticket_file, "")]
        for key, fn, obj in actions:
            b = QPushButton(tr(key))
            if obj:
                b.setObjectName(obj)
            b.clicked.connect(lambda _=False, f=fn: f())
            top.addWidget(b)
        lay.addLayout(top)

        self.filters = FilterBar(self.ctx.db, self)
        self.filters.changed.connect(self.reload)
        lay.addWidget(self.filters)

        self.table = DataTable(TICKET_COLUMNS)
        self.table.activated_row.connect(lambda r: main.edit_ticket(r["id"]))
        lay.addWidget(self.table, 1)

        bottom = QHBoxLayout()
        self.totals = QLabel("")
        self.totals.setObjectName("totals")
        bottom.addWidget(self.totals)
        bottom.addStretch()
        buttons = [("edit", self.edit, ""), ("view_scan", self.view_scan, ""), ("view_customer", self.view_customer, ""),
                   ("export_excel", lambda: self.export("xlsx"), ""), ("export_pdf", lambda: self.export("pdf"), "")]
        if self.ctx.is_admin:
            buttons.append(("delete", self.delete, "danger"))
        for key, fn, obj in buttons:
            b = QPushButton(tr(key))
            if obj:
                b.setObjectName(obj)
            b.clicked.connect(fn)
            bottom.addWidget(b)
        lay.addLayout(bottom)

    def refresh(self):
        self.filters.reload_lists()
        self.reload()

    def reload(self):
        rows = tickets.search(self.ctx.db, self.filters.values())
        self.table.set_rows(rows)
        self.totals.setText(totals_text(tickets.totals(rows)))

    def _selected(self):
        row = self.table.selected_row()
        if row is None:
            info(self, tr("select_row"))
        return row

    def edit(self):
        row = self._selected()
        if row:
            self.main.edit_ticket(row["id"])

    def view_scan(self):
        row = self._selected()
        if row:
            from .viewer import ScanViewerDialog
            ScanViewerDialog(self.ctx.db, row["id"], self).exec()

    def view_customer(self):
        row = self._selected()
        if row:
            self.main.open_customer(row["customer_id"])

    def delete(self):
        rows = self.table.selected_rows()
        if not rows:
            info(self, tr("select_row"))
            return
        names = ", ".join(r["ticket_no"] for r in rows[:10]) + ("…" if len(rows) > 10 else "")
        if ask(self, tr("confirm_delete", name=f"{tr('ticket')} {names}")):
            for r in rows:
                tickets.soft_delete(self.ctx, r["id"])
            self.reload()

    def export(self, kind):
        headers, rows = self.table.export_data()
        t = tickets.totals(self.table.visible_rows())
        totals = [""] * len(headers)
        cols = [c.key for c in TICKET_COLUMNS]
        totals[0] = tr("total")
        totals[cols.index("quantity")] = t["quantity"]
        totals[cols.index("total")] = t["amount"]
        totals[cols.index("customer_name")] = tr("tickets_n", n=t["count"])
        export_table(self, tr("tickets_report"), headers, rows, totals, kind, self.filters.describe(),
                     settings.get(self.ctx.db, "company_name"))
