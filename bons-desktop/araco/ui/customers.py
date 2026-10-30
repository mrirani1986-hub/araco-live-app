"""Customers list, add/edit dialog (with sites) and the customer page (tickets + totals)."""
from PySide6.QtCore import Qt, QTimer
from PySide6.QtWidgets import (QDialog, QFormLayout, QGridLayout, QHBoxLayout, QInputDialog, QLabel, QLineEdit,
                               QListWidget, QListWidgetItem, QPlainTextEdit, QPushButton, QVBoxLayout, QWidget)

from ..context import ValidationError
from ..i18n import tr
from ..services import customers, settings, tickets
from .tickets import TICKET_COLUMNS, FilterBar, totals_text
from .widgets import (Col, DataTable, ask, card, export_table, fmt_date, fmt_money, fmt_num, info, page_title,
                      show_errors, warn)

LIST_COLUMNS = [
    Col("code", "code", width=80), Col("name", "name", width=220), Col("company", "company_name", width=170),
    Col("phone", "phone", width=120), Col("area", "area", width=110), Col("sites", "sites", width=220),
    Col("ticket_count", "ticket_count", "int", 90), Col("total_m3", "quantity", "num", 100),
    Col("total_amount", "amount", "money", 120), Col("last_date", "last_delivery", "date", 110),
    Col("payment_terms", "payment_terms"),
]


class CustomersPage(QWidget):
    def __init__(self, main):
        super().__init__()
        self.main = main
        self.ctx = main.ctx
        self.setObjectName("page")
        lay = QVBoxLayout(self)
        lay.setContentsMargins(24, 18, 24, 18)
        lay.setSpacing(10)
        top = QHBoxLayout()
        top.addWidget(page_title(tr("customers")))
        top.addStretch()
        b_new = QPushButton(tr("new_customer"))
        b_new.setObjectName("primary")
        b_new.clicked.connect(self.add)
        top.addWidget(b_new)
        if self.ctx.is_admin:
            b_imp = QPushButton(tr("import_customers"))
            b_imp.clicked.connect(self.import_file)
            top.addWidget(b_imp)
        lay.addLayout(top)

        self.search = QLineEdit()
        self.search.setPlaceholderText("🔍  " + tr("search_hint"))
        self.search.setClearButtonEnabled(True)
        self.search.setMinimumHeight(40)
        self._timer = QTimer(self)
        self._timer.setSingleShot(True)
        self._timer.setInterval(200)
        self._timer.timeout.connect(self.reload)
        self.search.textChanged.connect(lambda: self._timer.start())
        lay.addWidget(self.search)

        self.table = DataTable(LIST_COLUMNS)
        self.table.activated_row.connect(lambda r: self.main.open_customer(r["id"]))
        lay.addWidget(self.table, 1)

        bottom = QHBoxLayout()
        self.count = QLabel("")
        self.count.setObjectName("totals")
        bottom.addWidget(self.count)
        bottom.addStretch()
        buttons = [("customer_page", self.open_page, ""), ("edit", self.edit, ""), ("new_ticket_for", self.new_ticket, ""),
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
        self.reload()
        self.search.setFocus()

    def reload(self):
        rows = customers.search(self.ctx.db, self.search.text())
        self.table.set_rows(rows)
        self.count.setText(tr("rows_count", n=len(rows)))

    def _selected(self):
        row = self.table.selected_row()
        if row is None:
            info(self, tr("select_row"))
        return row

    def add(self):
        if CustomerDialog(self.ctx, parent=self).exec():
            self.reload()

    def edit(self):
        row = self._selected()
        if row and CustomerDialog(self.ctx, row["id"], parent=self).exec():
            self.reload()

    def open_page(self):
        row = self._selected()
        if row:
            self.main.open_customer(row["id"])

    def new_ticket(self):
        row = self._selected()
        if row:
            self.main.new_ticket(customer_id=row["id"])

    def delete(self):
        row = self._selected()
        if not row:
            return
        text = tr("confirm_delete", name=row["name"])
        if row["ticket_count"]:
            text += "\n\n" + tr("customer_deleted_tickets", n=row["ticket_count"])
        if ask(self, text):
            customers.soft_delete(self.ctx, row["id"])
            self.reload()

    def import_file(self):
        from .import_dialog import ImportDialog
        if ImportDialog(self.ctx, self).exec():
            self.reload()

    def export(self, kind):
        headers, rows = self.table.export_data()
        export_table(self, tr("customers"), headers, rows, None, kind, self.search.text(),
                     settings.get(self.ctx.db, "company_name"))


class CustomerDialog(QDialog):
    """Add or edit a customer and its project sites."""

    FIELDS = [("code", "code"), ("name", "name"), ("company", "company_name"), ("phone", "phone"),
              ("phone2", "phone2"), ("area", "area"), ("address", "address"), ("payment_terms", "payment_terms")]

    def __init__(self, ctx, customer_id=None, parent=None, preset: dict | None = None):
        super().__init__(parent)
        self.ctx = ctx
        self.customer_id = customer_id
        self.new_sites: list[str] = []
        self.setWindowTitle(tr("edit_customer") if customer_id else tr("new_customer"))
        self.setMinimumWidth(720)
        self.inputs = {}
        form = QFormLayout()
        for key, label in self.FIELDS:
            w = QLineEdit()
            self.inputs[key] = w
            form.addRow(tr(label) + (" *" if key == "name" else ""), w)
        self.inputs["code"].setPlaceholderText(f"{tr('code_auto')}: {customers.next_code(ctx.db)}")
        self.notes = QPlainTextEdit()
        self.notes.setFixedHeight(70)
        form.addRow(tr("notes"), self.notes)

        self.sites = QListWidget()
        self.sites.setMinimumHeight(140)
        site_buttons = QHBoxLayout()
        for key, fn in (("add_site", self.add_site), ("rename_site", self.rename_site),
                        ("remove_site", self.remove_site)):
            b = QPushButton(tr(key))
            b.clicked.connect(fn)
            site_buttons.addWidget(b)
            if key == "remove_site" and customer_id and not ctx.is_admin:
                b.setEnabled(False)
        site_buttons.addStretch()
        sites_title = QLabel(tr("sites"))
        sites_title.setObjectName("sectionTitle")

        save = QPushButton(tr("save"))
        save.setObjectName("primary")
        save.setDefault(True)
        save.clicked.connect(self.save)
        cancel = QPushButton(tr("cancel"))
        cancel.clicked.connect(self.reject)
        buttons = QHBoxLayout()
        if customer_id:
            hist = QPushButton(tr("history"))
            hist.clicked.connect(self.history)
            buttons.addWidget(hist)
        buttons.addStretch()
        buttons.addWidget(cancel)
        buttons.addWidget(save)

        lay = QVBoxLayout(self)
        lay.addLayout(form)
        lay.addWidget(sites_title)
        lay.addWidget(self.sites)
        lay.addLayout(site_buttons)
        lay.addLayout(buttons)

        if customer_id:
            c = customers.get(ctx.db, customer_id)
            for key, w in self.inputs.items():
                w.setText(c[key] or "")
            self.notes.setPlainText(c["notes"] or "")
            self.audit = QLabel(f"{tr('created_at')}: {fmt_date(c['created_at'])}"
                                + (f"   •   {tr('updated_at')}: {fmt_date(c['updated_at'])}" if c["updated_at"] else ""))
            self.audit.setObjectName("hint")
            lay.insertWidget(lay.count() - 1, self.audit)
        for k, v in (preset or {}).items():
            if k in self.inputs:
                self.inputs[k].setText(v or "")
        self.load_sites()
        self.inputs["name"].setFocus()

    def load_sites(self):
        self.sites.clear()
        if self.customer_id:
            for s in customers.sites(self.ctx.db, self.customer_id):
                item = QListWidgetItem(f"{s['name']}   ({fmt_num(s['total_m3'])} {tr('m3')})")
                item.setData(Qt.UserRole, s["id"])
                item.setData(Qt.UserRole + 1, s["name"])
                self.sites.addItem(item)
        for name in self.new_sites:
            item = QListWidgetItem(name)
            item.setData(Qt.UserRole + 1, name)
            self.sites.addItem(item)

    def add_site(self):
        name, ok = QInputDialog.getText(self, tr("add_site"), tr("site_name"))
        if not ok or not name.strip():
            return
        if self.customer_id:
            customers.add_site(self.ctx, self.customer_id, name)
        elif name.strip() not in self.new_sites:
            self.new_sites.append(name.strip())
        self.load_sites()

    def rename_site(self):
        item = self.sites.currentItem()
        if not item:
            return
        old = item.data(Qt.UserRole + 1)
        name, ok = QInputDialog.getText(self, tr("rename_site"), tr("site_name"), text=old)
        if not ok or not name.strip():
            return
        sid = item.data(Qt.UserRole)
        try:
            if sid:
                customers.update_site(self.ctx, sid, name)
            else:
                self.new_sites[self.new_sites.index(old)] = name.strip()
        except ValidationError as e:
            show_errors(self, e.errors)
        self.load_sites()

    def remove_site(self):
        item = self.sites.currentItem()
        if not item or not ask(self, tr("confirm_delete", name=item.data(Qt.UserRole + 1))):
            return
        sid = item.data(Qt.UserRole)
        if sid:
            customers.remove_site(self.ctx, sid)
        else:
            self.new_sites.remove(item.data(Qt.UserRole + 1))
        self.load_sites()

    def save(self):
        data = {k: w.text() for k, w in self.inputs.items()}
        data["notes"] = self.notes.toPlainText()
        try:
            if self.customer_id:
                customers.update(self.ctx, self.customer_id, data)
            else:
                self.customer_id = customers.create(self.ctx, data, sites=self.new_sites)
        except ValidationError as e:
            show_errors(self, e.errors)
            return
        self.accept()

    def history(self):
        from .audit import HistoryDialog
        HistoryDialog(self.ctx.db, "customer", self.customer_id, self).exec()


class CustomerPageDialog(QDialog):
    """Everything about one customer: details, totals, sites and all of its tickets."""

    def __init__(self, ctx, customer_id, parent=None):
        super().__init__(parent)
        self.ctx = ctx
        self.customer_id = customer_id
        self.main = parent
        self.setWindowTitle(tr("customer_page"))
        self.setWindowFlag(Qt.WindowMaximizeButtonHint, True)
        self.resize(1300, 820)
        lay = QVBoxLayout(self)
        lay.setContentsMargins(20, 14, 20, 14)

        head = QHBoxLayout()
        self.title = page_title("")
        head.addWidget(self.title)
        head.addStretch()
        for key, fn, obj in (("new_ticket_for", self.new_ticket, "primary"), ("edit", self.edit, ""),
                             ("history", self.history, "")):
            b = QPushButton(tr(key))
            if obj:
                b.setObjectName(obj)
            b.clicked.connect(fn)
            head.addWidget(b)
        lay.addLayout(head)
        self.details = QLabel("")
        self.details.setWordWrap(True)
        self.details.setTextInteractionFlags(Qt.TextSelectableByMouse)
        lay.addWidget(self.details)

        cards = QGridLayout()
        self.c_count = card(tr("ticket_count"), accent="#1F2A44")
        self.c_m3 = card(tr("quantity"))
        self.c_amount = card(tr("amount"), accent="#2E7D32")
        self.c_last = card(tr("last_delivery"), accent="#5E35B1")
        for i, c in enumerate((self.c_count, self.c_m3, self.c_amount, self.c_last)):
            cards.addWidget(c, 0, i)
        lay.addLayout(cards)

        mid = QHBoxLayout()
        self.sites = DataTable([Col("name", "site"), Col("ticket_count", "ticket_count", "int"),
                                Col("total_m3", "quantity", "num")])
        self.sites.setMaximumWidth(430)
        self.sites.setMinimumWidth(330)
        self.sites.activated_row.connect(self._filter_site)
        side = QVBoxLayout()
        st = QLabel(tr("sites"))
        st.setObjectName("sectionTitle")
        side.addWidget(st)
        side.addWidget(self.sites)

        right = QVBoxLayout()
        self.filters = FilterBar(ctx.db, self, period="all_dates")
        self.filters.customer.setEnabled(False)
        self.filters.set_customer(customer_id)
        self.filters.changed.connect(self.reload_tickets)
        right.addWidget(self.filters)
        cols = [c for c in TICKET_COLUMNS if c.key not in ("customer_name",)]
        self.table = DataTable(cols)
        self.table.activated_row.connect(self.edit_ticket)
        right.addWidget(self.table, 1)
        bottom = QHBoxLayout()
        self.totals = QLabel("")
        self.totals.setObjectName("totals")
        bottom.addWidget(self.totals)
        bottom.addStretch()
        for key, kind in (("export_excel", "xlsx"), ("export_pdf", "pdf")):
            b = QPushButton(tr(key))
            b.clicked.connect(lambda _=False, k=kind: self.export(k))
            bottom.addWidget(b)
        close = QPushButton(tr("close"))
        close.clicked.connect(self.accept)
        bottom.addWidget(close)
        right.addLayout(bottom)
        mid.addLayout(side)
        mid.addLayout(right, 1)
        lay.addLayout(mid, 1)
        self.reload()

    def reload(self):
        c = customers.get(self.ctx.db, self.customer_id)
        if not c:
            warn(self, tr("err_not_found"))
            return
        self.customer = c
        self.title.setText(f"{c['name']}   ·   {c['code']}")
        parts = [(tr("company_name"), c["company"]), (tr("phone"), " / ".join(p for p in (c["phone"], c["phone2"]) if p)),
                 (tr("area"), c["area"]), (tr("address"), c["address"]), (tr("payment_terms"), c["payment_terms"]),
                 (tr("notes"), c["notes"])]
        self.details.setText(" &nbsp;&nbsp;│&nbsp;&nbsp; ".join(f"<b>{k}:</b> {v}" for k, v in parts if v))
        self.c_count.value_label.setText(str(c["ticket_count"] or 0))
        self.c_m3.value_label.setText(f"{fmt_num(c['total_m3'] or 0)} {tr('m3')}")
        self.c_amount.value_label.setText(fmt_money(c["total_amount"] or 0))
        self.c_last.value_label.setText(fmt_date(c["last_date"]) or "—")
        self.sites.set_rows(customers.sites(self.ctx.db, self.customer_id))
        self.reload_tickets()

    def reload_tickets(self):
        f = self.filters.values()
        f["customer_id"] = self.customer_id
        rows = tickets.search(self.ctx.db, f)
        self.table.set_rows(rows)
        self.totals.setText(totals_text(tickets.totals(rows)))

    def _filter_site(self, row):
        self.filters.site.set_data_value(row["id"])

    def edit_ticket(self, row):
        self.main.edit_ticket(row["id"])
        self.reload()

    def new_ticket(self):
        self.main.new_ticket(customer_id=self.customer_id)
        self.reload()

    def edit(self):
        if CustomerDialog(self.ctx, self.customer_id, parent=self).exec():
            self.filters.reload_lists()
            self.filters.set_customer(self.customer_id)
            self.reload()

    def history(self):
        from .audit import HistoryDialog
        HistoryDialog(self.ctx.db, "customer", self.customer_id, self).exec()

    def export(self, kind):
        headers, rows = self.table.export_data()
        t = tickets.totals(self.table.visible_rows())
        keys = [c.key for c in self.table.model_.columns]
        totals = [""] * len(headers)
        totals[0] = tr("total")
        totals[keys.index("quantity")] = t["quantity"]
        totals[keys.index("total")] = t["amount"]
        title = f"{self.customer['name']} — {self.customer['code']}"
        export_table(self, title, headers, rows, totals, kind, self.filters.describe(),
                     settings.get(self.ctx.db, "company_name"))
