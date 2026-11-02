"""Home page: today / month / year figures and quick actions."""
from datetime import date

from PySide6.QtWidgets import QGridLayout, QHBoxLayout, QLabel, QPushButton, QVBoxLayout, QWidget

from ..i18n import tr
from ..services import reports
from .widgets import Col, DataTable, card, fmt_money, fmt_num, page_title


class DashboardPage(QWidget):
    def __init__(self, main):
        super().__init__()
        self.main = main
        self.setObjectName("page")
        lay = QVBoxLayout(self)
        lay.setContentsMargins(24, 18, 24, 18)
        lay.setSpacing(14)
        self.title = page_title("")
        lay.addWidget(self.title)

        cards = QHBoxLayout()
        self.c_today = card(tr("kpi_today"))
        self.c_month = card(tr("kpi_month"), accent="#1F2A44")
        self.c_year = card(tr("kpi_year"), accent="#2E7D32")
        self.c_cust = card(tr("kpi_customers"), accent="#5E35B1")
        for c in (self.c_today, self.c_month, self.c_year, self.c_cust):
            cards.addWidget(c)
        lay.addLayout(cards)

        actions = QHBoxLayout()
        for key, fn, primary in (("new_ticket", main.new_ticket, True), ("scan_ticket", main.scan_ticket, False),
                                 ("batch_scan", main.batch_scan, False), ("import_file", main.import_ticket_file, False),
                                 ("new_customer", main.new_customer, False)):
            b = QPushButton(tr(key))
            if primary:
                b.setObjectName("primary")
            b.setMinimumHeight(48)
            b.clicked.connect(fn)
            actions.addWidget(b)
        lay.addLayout(actions)

        grid = QGridLayout()
        t1 = QLabel(tr("recent_tickets"))
        t1.setObjectName("sectionTitle")
        t2 = QLabel(tr("top_customers_month"))
        t2.setObjectName("sectionTitle")
        self.recent = DataTable([Col("ticket_no", "ticket_no"), Col("date", "date", "date"),
                                 Col("customer_name", "customer"), Col("grade", "grade"),
                                 Col("quantity", "quantity", "num")])
        self.recent.activated_row.connect(lambda r: main.open_ticket_by_no(r["ticket_no"]))
        self.top = DataTable([Col("name", "customer"), Col("quantity", "quantity", "num")])
        grid.addWidget(t1, 0, 0)
        grid.addWidget(t2, 0, 1)
        grid.addWidget(self.recent, 1, 0)
        grid.addWidget(self.top, 1, 1)
        grid.setColumnStretch(0, 3)
        grid.setColumnStretch(1, 2)
        lay.addLayout(grid, 1)

    def refresh(self):
        user = self.main.ctx.user
        self.title.setText(tr("welcome", name=user.get("full_name") or user["username"]))
        d = reports.dashboard(self.main.ctx.db, date.today().isoformat())
        for c, k in ((self.c_today, "today"), (self.c_month, "month"), (self.c_year, "year")):
            c.value_label.setText(f"{fmt_num(d[k]['quantity'])} {tr('m3')}")
            c.sub_label.setText(f"{tr('tickets_n', n=d[k]['count'])}  •  {fmt_money(d[k]['amount'])}")
        self.c_cust.value_label.setText(str(d["customers"]))
        self.c_cust.sub_label.setText("")
        self.recent.set_rows(d["recent"])
        self.top.set_rows(d["top_customers"])
