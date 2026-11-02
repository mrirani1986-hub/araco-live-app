"""Totals of m³ and amount per customer / day / month / grade / truck … with export."""
from PySide6.QtWidgets import QComboBox, QHBoxLayout, QLabel, QPushButton, QVBoxLayout, QWidget

from ..i18n import tr
from ..services import reports, settings
from .tickets import FilterBar
from .widgets import Col, DataTable, export_table, fmt_money, fmt_num, page_title

GROUP_ORDER = ["customer", "day", "month", "grade", "truck", "driver", "plant", "site", "year"]


class ReportsPage(QWidget):
    def __init__(self, main):
        super().__init__()
        self.main = main
        self.ctx = main.ctx
        self.setObjectName("page")
        lay = QVBoxLayout(self)
        lay.setContentsMargins(24, 18, 24, 18)
        lay.setSpacing(10)
        top = QHBoxLayout()
        top.addWidget(page_title(tr("nav_reports")))
        top.addStretch()
        lbl = QLabel(tr("group_by"))
        lbl.setObjectName("sectionTitle")
        self.group = QComboBox()
        self.group.setMinimumWidth(200)
        for g in GROUP_ORDER:
            self.group.addItem(tr("group_" + g), g)
        self.group.currentIndexChanged.connect(self.reload)
        top.addWidget(lbl)
        top.addWidget(self.group)
        lay.addLayout(top)

        self.filters = FilterBar(self.ctx.db, self, show_status=False)
        self.filters.changed.connect(self.reload)
        lay.addWidget(self.filters)

        self.table = DataTable([Col("key", "group_customer", width=320), Col("count", "count", "int", 110),
                                Col("quantity", "quantity", "num", 140), Col("amount", "amount", "money", 160),
                                Col("avg_price", "avg_price", "money")])
        lay.addWidget(self.table, 1)
        bottom = QHBoxLayout()
        self.totals = QLabel("")
        self.totals.setObjectName("totals")
        bottom.addWidget(self.totals)
        bottom.addStretch()
        for key, kind in (("export_excel", "xlsx"), ("export_pdf", "pdf")):
            b = QPushButton(tr(key))
            b.clicked.connect(lambda _=False, k=kind: self.export(k))
            bottom.addWidget(b)
        lay.addLayout(bottom)

    def refresh(self):
        self.filters.reload_lists()
        self.reload()

    def reload(self, *_):
        g = self.group.currentData()
        self.table.model_.columns[0].title = "group_" + g
        rows, total = reports.summary(self.ctx.db, g, self.filters.values())
        if g in ("day", "month"):
            from .widgets import fmt_date
            for r in rows:
                r["key"] = fmt_date(r["key"])
        self.total = total
        self.table.set_rows(rows)
        self.totals.setText(tr("totals_line", count=total["count"], quantity=fmt_num(total["quantity"]),
                               amount=fmt_money(total["amount"])))

    def export(self, kind):
        headers, rows = self.table.export_data()
        t = self.total
        totals = [tr("total"), t["count"], t["quantity"], t["amount"], t["avg_price"]]
        title = tr("report_title", group=self.group.currentText())
        export_table(self, title, headers, rows, totals, kind, self.filters.describe(),
                     settings.get(self.ctx.db, "company_name"))
