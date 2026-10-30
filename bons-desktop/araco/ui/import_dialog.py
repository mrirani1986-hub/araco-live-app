"""Import customers from Excel/CSV: choose file → map columns → preview → import."""
from PySide6.QtWidgets import (QCheckBox, QComboBox, QDialog, QFileDialog, QGridLayout, QHBoxLayout, QLabel,
                               QPushButton, QTableWidget, QTableWidgetItem, QVBoxLayout)

from ..context import ValidationError
from ..i18n import tr, tr_error
from .. import importer
from .widgets import info, show_errors

TARGET_LABELS = {"code": "code", "name": "name", "company": "company_name", "phone": "phone", "phone2": "phone2",
                 "address": "address", "area": "area", "payment_terms": "payment_terms", "notes": "notes",
                 "site": "site"}


class ImportDialog(QDialog):
    def __init__(self, ctx, parent=None):
        super().__init__(parent)
        self.ctx = ctx
        self.header, self.rows = [], []
        self.setWindowTitle(tr("import_title"))
        self.resize(1100, 760)
        lay = QVBoxLayout(self)
        top = QHBoxLayout()
        b_file = QPushButton(tr("choose_file"))
        b_file.setObjectName("primary")
        b_file.clicked.connect(self.choose)
        self.file_label = QLabel("")
        top.addWidget(b_file)
        top.addWidget(self.file_label, 1)
        lay.addLayout(top)

        t = QLabel(tr("mapping"))
        t.setObjectName("sectionTitle")
        lay.addWidget(t)
        hint = QLabel(tr("mapping_hint"))
        hint.setObjectName("hint")
        hint.setWordWrap(True)
        lay.addWidget(hint)
        grid = QGridLayout()
        self.combos = {}
        for i, target in enumerate(importer.TARGETS):
            combo = QComboBox()
            combo.currentIndexChanged.connect(self.update_preview)
            self.combos[target] = combo
            label = QLabel(tr(TARGET_LABELS[target]) + (" *" if target == "name" else ""))
            grid.addWidget(label, i // 2, (i % 2) * 2)
            grid.addWidget(combo, i // 2, (i % 2) * 2 + 1)
        lay.addLayout(grid)

        p = QLabel(tr("preview"))
        p.setObjectName("sectionTitle")
        lay.addWidget(p)
        self.preview = QTableWidget()
        lay.addWidget(self.preview, 1)
        self.update_existing = QCheckBox(tr("update_existing"))
        lay.addWidget(self.update_existing)
        bottom = QHBoxLayout()
        bottom.addStretch()
        cancel = QPushButton(tr("cancel"))
        cancel.clicked.connect(self.reject)
        self.b_import = QPushButton(tr("do_import"))
        self.b_import.setObjectName("primary")
        self.b_import.setEnabled(False)
        self.b_import.clicked.connect(self.do_import)
        bottom.addWidget(cancel)
        bottom.addWidget(self.b_import)
        lay.addLayout(bottom)

    def choose(self):
        path, _ = QFileDialog.getOpenFileName(self, tr("choose_file"), "", "Excel / CSV (*.xlsx *.xlsm *.csv *.txt)")
        if path:
            self.load(path)

    def load(self, path):
        try:
            self.header, self.rows = importer.read_table(path)
        except ValidationError as e:
            show_errors(self, e.errors)
            return
        self.file_label.setText(f"{path}   —   {tr('file_rows', n=len(self.rows))}")
        guess = importer.guess_mapping(self.header)
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

    def update_preview(self, *_):
        m = self.mapping()
        targets = [t for t in importer.TARGETS if t in m]
        self.preview.clear()
        self.preview.setColumnCount(len(targets))
        self.preview.setHorizontalHeaderLabels([tr(TARGET_LABELS[t]) for t in targets])
        sample = self.rows[:50]
        self.preview.setRowCount(len(sample))
        for r, row in enumerate(sample):
            for c, t in enumerate(targets):
                self.preview.setItem(r, c, QTableWidgetItem(row[m[t]] if m[t] < len(row) else ""))
        self.preview.resizeColumnsToContents()
        self.b_import.setEnabled("name" in m and bool(self.rows))

    def do_import(self):
        try:
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
