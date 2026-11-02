"""Audit log page and the per-record history dialog."""
import json

from PySide6.QtCore import QDate
from PySide6.QtWidgets import (QComboBox, QDateEdit, QDialog, QHBoxLayout, QLabel, QPushButton, QVBoxLayout,
                               QWidget)

from ..i18n import ACTIONS, tr
from ..services import audit
from .widgets import Col, DataTable, export_table, fmt_date, page_title

COLUMNS = [Col("ts", "audit_ts", "date", 160), Col("username", "audit_user", width=110),
           Col("action_label", "audit_action", width=130), Col("entity_label", "audit_entity", width=150),
           Col("details_text", "audit_details")]


def _value(v):
    if v is None or v == "":
        return "—"
    if isinstance(v, float) and v.is_integer():
        return str(int(v))
    return str(v)


def decorate(rows):
    for r in rows:
        r["action_label"] = tr("act_" + r["action"]) if r["action"] in ACTIONS else r["action"]
        ent = tr("ent_" + r["entity"]) if r["entity"] else ""
        r["entity_label"] = f"{ent} #{r['entity_id']}" if r["entity_id"] else ent
        text = r["details"]
        try:
            d = json.loads(text) if text else {}
            if isinstance(d, dict):
                parts = []
                for k, v in d.items():
                    label = tr(k) if k not in ("customer_id", "site_id") else k
                    if isinstance(v, list) and len(v) == 2 and r["action"] == "update":
                        parts.append(f"{label}: {_value(v[0])} → {_value(v[1])}")
                    else:
                        parts.append(f"{label}: {_value(v)}")
                text = "   •   ".join(parts)
        except (ValueError, TypeError):
            pass
        r["details_text"] = text
    return rows


class AuditPage(QWidget):
    def __init__(self, main):
        super().__init__()
        self.ctx = main.ctx
        self.setObjectName("page")
        lay = QVBoxLayout(self)
        lay.setContentsMargins(24, 18, 24, 18)
        lay.addWidget(page_title(tr("nav_audit")))
        bar = QHBoxLayout()
        self.entity = QComboBox()
        self.entity.addItem(tr("all"), "")
        for e in ("ticket", "customer", "site", "user", "settings", "lookups", "database"):
            self.entity.addItem(tr("ent_" + e), e)
        self.user = QComboBox()
        self.d_from, self.d_to = QDateEdit(QDate.currentDate().addDays(-30)), QDateEdit(QDate.currentDate())
        for d in (self.d_from, self.d_to):
            d.setCalendarPopup(True)
            d.setDisplayFormat("dd/MM/yyyy")
            d.dateChanged.connect(self.refresh)
        for label, w in (("audit_entity", self.entity), ("audit_user", self.user), ("from", self.d_from),
                         ("to", self.d_to)):
            bar.addWidget(QLabel(tr(label)))
            bar.addWidget(w)
        bar.addStretch()
        b = QPushButton(tr("export_excel"))
        b.clicked.connect(self.export)
        bar.addWidget(b)
        lay.addLayout(bar)
        self.entity.currentIndexChanged.connect(self.refresh)
        self.user.currentIndexChanged.connect(self.refresh)
        self.table = DataTable(COLUMNS)
        lay.addWidget(self.table, 1)

    def refresh(self, *_):
        names = [r[0] for r in self.ctx.db.query("SELECT DISTINCT username FROM audit_log ORDER BY username")]
        current = self.user.currentData()
        self.user.blockSignals(True)
        self.user.clear()
        self.user.addItem(tr("all"), "")
        for n in names:
            self.user.addItem(n, n)
        self.user.setCurrentIndex(max(self.user.findData(current), 0))
        self.user.blockSignals(False)
        rows = audit.search(self.ctx.db, self.entity.currentData(), self.user.currentData() or "",
                            self.d_from.date().toString("yyyy-MM-dd"), self.d_to.date().toString("yyyy-MM-dd"))
        self.table.set_rows(decorate(rows))

    def export(self):
        headers, rows = self.table.export_data()
        export_table(self, tr("nav_audit"), headers, rows, None, "xlsx")


class HistoryDialog(QDialog):
    def __init__(self, db, entity, entity_id, parent=None):
        super().__init__(parent)
        self.setWindowTitle(f"{tr('history')} — {tr('ent_' + entity)} #{entity_id}")
        self.resize(1000, 520)
        table = DataTable(COLUMNS)
        rows = audit.search(db, entity, entity_id=entity_id)
        table.set_rows(decorate(rows))
        close = QPushButton(tr("close"))
        close.clicked.connect(self.accept)
        lay = QVBoxLayout(self)
        lay.addWidget(table, 1)
        lay.addWidget(close)
