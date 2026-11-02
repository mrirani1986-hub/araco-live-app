"""Import customers or past tickets from Excel/CSV: choose file → map columns → check → import."""
from pathlib import Path

from PySide6.QtWidgets import (QCheckBox, QComboBox, QDialog, QFileDialog, QGridLayout, QHBoxLayout, QLabel,
                               QPushButton, QTableWidget, QTableWidgetItem, QVBoxLayout)

from .. import exporter, importer
from ..context import ValidationError
from ..i18n import tr, tr_error
from .widgets import ask, documents_dir, fmt_date, fmt_money, fmt_num, info, show_errors

CUSTOMER_LABELS = {"code": "code", "name": "name", "company": "company_name", "phone": "phone", "phone2": "phone2",
                   "address": "address", "area": "area", "payment_terms": "payment_terms", "notes": "notes",
                   "site": "site"}
TICKET_LABELS = {"ticket_no": "ticket_no", "date": "date", "time": "time", "customer": "customer",
                 "customer_code": "customer_code", "site": "site", "grade": "grade", "quantity": "quantity",
                 "unit_price": "unit_price", "total": "total", "truck_no": "truck", "driver": "driver",
                 "pump": "pump", "pump_no": "pump_no", "plant": "plant", "status": "status", "notes": "notes"}
TICKET_REQUIRED = {"ticket_no", "date", "quantity", "grade"}


class ImportDialog(QDialog):
    def __init__(self, ctx, parent=None, kind: str = "customers"):
        super().__init__(parent)
        self.ctx = ctx
        self.kind = kind
        self.header, self.rows = [], []
        self.labels = TICKET_LABELS if kind == "tickets" else CUSTOMER_LABELS
        self.targets = importer.TICKET_TARGETS if kind == "tickets" else importer.TARGETS
        self.setWindowTitle(tr("import_tickets_title") if kind == "tickets" else tr("import_title"))
        self.resize(1150, 800)
        lay = QVBoxLayout(self)
        top = QHBoxLayout()
        b_file = QPushButton(tr("choose_file"))
        b_file.setObjectName("primary")
        b_file.clicked.connect(self.choose)
        b_tpl = QPushButton(tr("download_template"))
        b_tpl.clicked.connect(self.save_template)
        self.file_label = QLabel("")
        top.addWidget(b_file)
        top.addWidget(self.file_label, 1)
        top.addWidget(b_tpl)
        lay.addLayout(top)

        t = QLabel(tr("mapping"))
        t.setObjectName("sectionTitle")
        lay.addWidget(t)
        hint = QLabel(tr("mapping_hint_tickets") if kind == "tickets" else tr("mapping_hint"))
        hint.setObjectName("hint")
        hint.setWordWrap(True)
        lay.addWidget(hint)
        grid = QGridLayout()
        self.combos = {}
        per_row = 3 if kind == "tickets" else 2
        for i, target in enumerate(self.targets):
            combo = QComboBox()
            combo.currentIndexChanged.connect(self.update_preview)
            self.combos[target] = combo
            required = target in TICKET_REQUIRED if kind == "tickets" else target == "name"
            label = QLabel(tr(self.labels[target]) + (" *" if required else ""))
            grid.addWidget(label, i // per_row, (i % per_row) * 2)
            grid.addWidget(combo, i // per_row, (i % per_row) * 2 + 1)
        lay.addLayout(grid)

        options = QHBoxLayout()
        self.update_existing = QCheckBox(tr("update_existing"))
        self.create_customers = QCheckBox(tr("create_missing_customers"))
        self.create_customers.setChecked(True)
        self.date_order = QComboBox()
        self.date_order.addItem(tr("date_order_dmy"), True)
        self.date_order.addItem(tr("date_order_mdy"), False)
        if kind == "tickets":
            options.addWidget(QLabel(tr("date_order")))
            options.addWidget(self.date_order)
            options.addSpacing(20)
            options.addWidget(self.create_customers)
        else:
            options.addWidget(self.update_existing)
        options.addStretch()

        p = QLabel(tr("preview"))
        p.setObjectName("sectionTitle")
        lay.addWidget(p)
        self.preview = QTableWidget()
        lay.addWidget(self.preview, 1)
        lay.addLayout(options)
        self.check_result = QLabel("")
        self.check_result.setObjectName("ocrNote")
        self.check_result.setWordWrap(True)
        self.check_result.hide()
        lay.addWidget(self.check_result)
        bottom = QHBoxLayout()
        bottom.addStretch()
        cancel = QPushButton(tr("cancel"))
        cancel.clicked.connect(self.reject)
        self.b_check = QPushButton(tr("check_file"))
        self.b_check.clicked.connect(self.check)
        self.b_check.setVisible(kind == "tickets")
        self.b_import = QPushButton(tr("do_import"))
        self.b_import.setObjectName("primary")
        self.b_import.setEnabled(False)
        self.b_import.clicked.connect(self.do_import)
        for b in (cancel, self.b_check, self.b_import):
            bottom.addWidget(b)
        lay.addLayout(bottom)

    # --- file and mapping ------------------------------------------------------------------
    def choose(self):
        path, _ = QFileDialog.getOpenFileName(self, tr("choose_file"), "", "Excel / CSV (*.xlsx *.xlsm *.csv *.txt)")
        if path:
            self.load(path)

    def save_template(self):
        name = "ARACO_tickets_template.xlsx" if self.kind == "tickets" else "ARACO_customers_template.xlsx"
        path, _ = QFileDialog.getSaveFileName(self, tr("download_template"), str(Path(documents_dir()) / name),
                                              "Excel (*.xlsx)")
        if path:
            importer.write_template(path, self.kind)
            if ask(self, tr("open_file_q")):
                exporter.open_file(path)

    def load(self, path):
        try:
            self.header, self.rows = importer.read_table(path)
        except ValidationError as e:
            show_errors(self, e.errors)
            return
        self.file_label.setText(f"{path}   —   {tr('file_rows', n=len(self.rows))}")
        guess = (importer.guess_ticket_mapping if self.kind == "tickets" else importer.guess_mapping)(self.header)
        for target, combo in self.combos.items():
            combo.blockSignals(True)
            combo.clear()
            combo.addItem(tr("not_mapped"), None)
            for i, h in enumerate(self.header):
                combo.addItem(f"{i + 1}. {h}", i)
            combo.setCurrentIndex(combo.findData(guess[target]) if target in guess else 0)
            combo.blockSignals(False)
        self.update_preview()

    def mapping(self) -> dict:
        return {t: c.currentData() for t, c in self.combos.items() if c.currentData() is not None}

    def mapping_ok(self) -> bool:
        m = self.mapping()
        if self.kind == "tickets":
            return TICKET_REQUIRED <= set(m) and bool({"customer", "customer_code"} & set(m))
        return "name" in m

    def update_preview(self, *_):
        m = self.mapping()
        targets = [t for t in self.targets if t in m]
        self.preview.clear()
        self.preview.setColumnCount(len(targets))
        self.preview.setHorizontalHeaderLabels([tr(self.labels[t]) for t in targets])
        sample = self.rows[:50]
        self.preview.setRowCount(len(sample))
        for r, row in enumerate(sample):
            for c, t in enumerate(targets):
                self.preview.setItem(r, c, QTableWidgetItem(row[m[t]] if m[t] < len(row) else ""))
        self.preview.resizeColumnsToContents()
        self.b_import.setEnabled(self.mapping_ok() and bool(self.rows))
        self.b_check.setEnabled(self.b_import.isEnabled())
        self.check_result.hide()

    # --- tickets ----------------------------------------------------------------------------
    def _run_tickets(self, dry_run: bool):
        return importer.import_tickets(self.ctx, self.rows, self.mapping(), day_first=self.date_order.currentData(),
                                       create_customers=self.create_customers.isChecked(), dry_run=dry_run)

    def ticket_summary(self, stats, dry_run: bool) -> str:
        head = tr("tickets_check_done" if dry_run else "tickets_import_done",
                  created=stats["created"], customers=stats["customers_created"], sites=stats["sites_created"],
                  duplicates=len(stats["duplicates"]), errors=len(stats["errors"]))
        if stats["created"]:
            head += "\n" + tr("totals_line", count=stats["created"], quantity=fmt_num(stats["quantity"]),
                              amount=fmt_money(stats["amount"]))
            head += f"   ({fmt_date(stats['date_from'])} → {fmt_date(stats['date_to'])})"
        lines = []
        if stats["duplicates"]:
            nos = ", ".join(f"{no} ({tr('line')} {line})" for line, no in stats["duplicates"][:15])
            lines.append(tr("duplicates_skipped") + " " + nos + ("…" if len(stats["duplicates"]) > 15 else ""))
        for line, errs in stats["errors"][:15]:
            lines.append(f"• {tr('line')} {line}: " + "، ".join(tr_error(e) for e in errs))
        if len(stats["errors"]) > 15:
            lines.append("…")
        return head + ("\n\n" + "\n".join(lines) if lines else "")

    def check(self):
        try:
            stats = self._run_tickets(dry_run=True)
        except ValidationError as e:
            show_errors(self, e.errors)
            return
        self.check_result.setText(self.ticket_summary(stats, dry_run=True))
        self.check_result.show()

    # --- import -----------------------------------------------------------------------------
    def do_import(self):
        try:
            if self.kind == "tickets":
                stats = self._run_tickets(dry_run=False)
                info(self, self.ticket_summary(stats, dry_run=False))
                self.accept()
                return
            stats = importer.import_customers(self.ctx, self.rows, self.mapping(), self.update_existing.isChecked())
        except ValidationError as e:
            show_errors(self, e.errors)
            return
        text = tr("import_done", created=stats["created"], updated=stats["updated"], skipped=stats["skipped"],
                  sites=stats["sites"], errors=len(stats["errors"]))
        if stats["errors"]:
            text += "\n\n" + "\n".join(f"• {where}: {tr_error(err)}" for where, err in stats["errors"][:20])
        info(self, text)
        self.accept()
