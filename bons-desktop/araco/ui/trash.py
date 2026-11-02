"""Trash: deleted customers and tickets, restore or delete permanently (admin)."""
from PySide6.QtWidgets import QHBoxLayout, QPushButton, QTabWidget, QVBoxLayout, QWidget

from ..context import ValidationError
from ..i18n import tr
from ..services import customers, tickets
from .widgets import Col, DataTable, ask, info, page_title, show_errors


class TrashPage(QWidget):
    def __init__(self, main):
        super().__init__()
        self.ctx = main.ctx
        self.setObjectName("page")
        lay = QVBoxLayout(self)
        lay.setContentsMargins(24, 18, 24, 18)
        lay.addWidget(page_title(tr("nav_trash")))
        self.tabs = QTabWidget()
        self.t_tickets = DataTable([Col("ticket_no", "ticket_no"), Col("date", "date", "date"),
                                    Col("customer_name", "customer"), Col("grade", "grade"),
                                    Col("quantity", "quantity", "num"), Col("total", "total", "money"),
                                    Col("deleted_at", "deleted_at", "date")])
        self.t_customers = DataTable([Col("code", "code"), Col("name", "name"), Col("company", "company_name"),
                                      Col("phone", "phone"), Col("ticket_count", "ticket_count", "int"),
                                      Col("deleted_at", "deleted_at", "date")])
        self.tabs.addTab(self.t_tickets, tr("trash_tickets"))
        self.tabs.addTab(self.t_customers, tr("trash_customers"))
        lay.addWidget(self.tabs, 1)
        bar = QHBoxLayout()
        bar.addStretch()
        b_restore = QPushButton(tr("restore"))
        b_restore.setObjectName("primary")
        b_restore.clicked.connect(self.restore)
        b_purge = QPushButton(tr("purge"))
        b_purge.setObjectName("danger")
        b_purge.clicked.connect(self.purge)
        bar.addWidget(b_purge)
        bar.addWidget(b_restore)
        lay.addLayout(bar)

    def refresh(self):
        self.t_tickets.set_rows(tickets.search(self.ctx.db, {"deleted": True}))
        self.t_customers.set_rows(customers.search(self.ctx.db, deleted=True))

    def _current(self):
        is_ticket = self.tabs.currentIndex() == 0
        rows = (self.t_tickets if is_ticket else self.t_customers).selected_rows()
        if not rows:
            info(self, tr("select_row"))
        return is_ticket, rows

    def restore(self):
        is_ticket, rows = self._current()
        try:
            for r in rows:
                (tickets.restore if is_ticket else customers.restore)(self.ctx, r["id"])
        except ValidationError as e:
            show_errors(self, e.errors)
        if rows:
            info(self, tr("restored"))
        self.refresh()

    def purge(self):
        is_ticket, rows = self._current()
        if not rows:
            return
        label = ", ".join(r["ticket_no"] if is_ticket else r["name"] for r in rows[:10])
        if not ask(self, tr("confirm_purge", name=label)):
            return
        try:
            for r in rows:
                (tickets.purge if is_ticket else customers.purge)(self.ctx, r["id"])
        except ValidationError as e:
            show_errors(self, e.errors)
        self.refresh()
