"""Quick-entry form for one ticket, with the scan beside the fields. Also drives batch scanning."""
import re
from datetime import date, datetime
from pathlib import Path

from PySide6.QtCore import QDate, Qt, QTimer
from PySide6.QtGui import QKeySequence, QShortcut
from PySide6.QtWidgets import (QCheckBox, QComboBox, QDateEdit, QDialog, QFileDialog, QFormLayout, QFrame,
                               QHBoxLayout, QLabel, QLineEdit, QMessageBox, QPushButton, QSplitter, QToolButton,
                               QVBoxLayout, QWidget)

from .. import config, ocr, scanner
from ..context import ValidationError
from ..i18n import is_rtl, tr, tr_error
from ..media import is_supported
from ..services import customers, lookups, settings, tickets
from .widgets import EnterNavigator, ImageViewer, SearchCombo, Worker, ask, fmt_date, fmt_money, show_errors, warn

ERROR_FIELDS = {
    "err_ticket_no_required": "ticket_no", "err_ticket_duplicate": "ticket_no", "err_date_invalid": "date",
    "err_time_invalid": "time", "err_customer_required": "customer", "err_grade_required": "grade",
    "err_quantity_required": "quantity", "err_quantity_positive": "quantity", "err_price_invalid": "unit_price",
}


def choose_batch_source(parent):
    box = QMessageBox(QMessageBox.Question, tr("batch_scan"), tr("batch_choose"), parent=parent)
    b_scan = box.addButton(tr("batch_from_scanner"), QMessageBox.AcceptRole)
    b_files = box.addButton(tr("batch_from_files"), QMessageBox.AcceptRole)
    box.addButton(tr("cancel"), QMessageBox.RejectRole)
    box.exec()
    return {b_scan: "scanner", b_files: "files"}.get(box.clickedButton())


def normalize_time(text: str) -> str:
    """'830' → '08:30', '8' → '08:00', '8.5' → '08:05', '14:3' → '14:03'."""
    t = text.strip().replace(".", ":").replace("h", ":")
    if not t:
        return ""
    if re.fullmatch(r"\d{3,4}", t):
        t = f"{t[:-2]}:{t[-2:]}"
    if re.fullmatch(r"\d{1,2}", t):
        t += ":00"
    m = re.fullmatch(r"(\d{1,2}):(\d{1,2})", t)
    return f"{int(m[1]):02d}:{int(m[2]):02d}" if m else text.strip()


class TicketForm(QDialog):
    def __init__(self, ctx, parent=None, ticket_id=None, customer_id=None, files=None, batch_files=None,
                 batch_scanner=False, start_scan=False):
        super().__init__(parent)
        self.ctx = ctx
        self.db = ctx.db
        self.ticket_id = ticket_id
        self.pending: list[dict] = []   # {"path", "temp", "ocr"} not yet linked to the ticket
        self.existing: list[dict] = []  # scans already saved for this ticket
        self.batch_files = list(batch_files or [])
        self.batch_index = 0
        self.batch_scanner = batch_scanner
        self.saved_count = 0
        self.scanner = None
        self.ocr_worker = None
        self._snapshot = None
        self.setWindowTitle(tr("edit_ticket") if ticket_id else tr("new_ticket"))
        self.setWindowFlag(Qt.WindowMaximizeButtonHint, True)
        self.resize(1380, 860)
        self._build()
        self._load_lists()
        if ticket_id:
            self._load_ticket(ticket_id)
        else:
            self._reset_for_new(customer_id=customer_id)
            if files:
                self._add_files(files)
            if self.batch_files:
                self._load_batch_file()
            elif batch_scanner or start_scan:
                QTimer.singleShot(150, self.scan)
        self._snapshot = self._state()

    # --- layout -----------------------------------------------------------------------------
    def _build(self):
        # image side
        self.viewer = ImageViewer(self)
        img_buttons = QHBoxLayout()
        self.b_scan = QPushButton("📠 " + tr("scan"))
        self.b_scan.clicked.connect(self.scan)
        self.b_attach = QPushButton("📎 " + tr("attach_file"))
        self.b_attach.clicked.connect(self.attach_file)
        self.b_ocr = QPushButton("🔎 " + tr("ocr_read"))
        self.b_ocr.clicked.connect(self.run_ocr)
        self.b_remove = QPushButton(tr("remove_image"))
        self.b_remove.setObjectName("danger")
        self.b_remove.clicked.connect(self.remove_image)
        for b in (self.b_scan, self.b_attach, self.b_ocr, self.b_remove):
            b.setFocusPolicy(Qt.NoFocus)
            img_buttons.addWidget(b)
        img_buttons.addStretch()
        left = QWidget()
        ll = QVBoxLayout(left)
        ll.setContentsMargins(0, 0, 0, 0)
        ll.addLayout(img_buttons)
        ll.addWidget(self.viewer, 1)

        # fields side
        self.f_no = QLineEdit()
        self.f_no.textChanged.connect(self._check_duplicate)
        self.dup = QLabel("")
        self.dup.setObjectName("dupFlag")
        self.f_date = QDateEdit()
        self.f_date.setCalendarPopup(True)
        self.f_date.setDisplayFormat("dd/MM/yyyy")
        self.f_time = QLineEdit()
        self.f_time.setPlaceholderText("08:30")
        self.f_time.editingFinished.connect(lambda: self.f_time.setText(normalize_time(self.f_time.text())))
        self.f_customer = SearchCombo(placeholder=tr("search_hint"))
        self.f_customer.currentTextChanged.connect(self._customer_changed)
        self.b_new_customer = QToolButton()
        self.b_new_customer.setText("+")
        self.b_new_customer.setToolTip(tr("new_customer"))
        self.b_new_customer.setFocusPolicy(Qt.NoFocus)
        self.b_new_customer.clicked.connect(lambda: self.create_customer(self.f_customer.value_text()))
        cust_row = QHBoxLayout()
        cust_row.addWidget(self.f_customer, 1)
        cust_row.addWidget(self.b_new_customer)
        self.f_site = SearchCombo()
        self.f_grade = QComboBox()
        self.f_grade.currentTextChanged.connect(self._suggest_price)
        self.f_qty = QLineEdit()
        self.f_qty.textChanged.connect(self._update_total)
        self.f_price = QLineEdit()
        self.f_price.textChanged.connect(self._update_total)
        self.f_total = QLineEdit()
        self.f_total.setReadOnly(True)
        self.f_total.setFocusPolicy(Qt.NoFocus)
        self.f_truck = SearchCombo()
        self.f_truck.currentTextChanged.connect(self._truck_changed)
        self.f_driver = SearchCombo()
        self.f_pump = QCheckBox(tr("pump_used"))
        self.f_pump_no = SearchCombo()
        self.f_pump.toggled.connect(self.f_pump_no.setEnabled)
        self.f_plant = QComboBox()
        self.f_status = QComboBox()
        for s in tickets.STATUSES:
            self.f_status.addItem(tr("status_" + s), s)
        self.f_notes = QLineEdit()

        form = QFormLayout()
        form.setLabelAlignment(Qt.AlignVCenter)
        form.setVerticalSpacing(9)
        form.addRow(tr("ticket_no") + " *", self.f_no)
        form.addRow("", self.dup)
        form.addRow(tr("date") + " *", self.f_date)
        form.addRow(tr("time"), self.f_time)
        form.addRow(tr("customer") + " *", cust_row)
        form.addRow(tr("site"), self.f_site)
        form.addRow(tr("grade") + " *", self.f_grade)
        form.addRow(tr("quantity") + " *", self.f_qty)
        form.addRow(tr("unit_price"), self.f_price)
        form.addRow(tr("total"), self.f_total)
        form.addRow(tr("truck"), self.f_truck)
        form.addRow(tr("driver"), self.f_driver)
        pump_row = QHBoxLayout()
        pump_row.addWidget(self.f_pump)
        pump_row.addSpacing(18)
        pump_row.addWidget(QLabel(tr("pump_no")))
        pump_row.addWidget(self.f_pump_no, 1)
        form.addRow(tr("pump"), pump_row)
        form.addRow(tr("plant"), self.f_plant)
        form.addRow(tr("status"), self.f_status)
        form.addRow(tr("notes"), self.f_notes)

        self.ocr_note = QLabel("")
        self.ocr_note.setObjectName("ocrNote")
        self.ocr_note.setWordWrap(True)
        self.ocr_note.hide()
        self.batch_label = QLabel("")
        self.batch_label.setObjectName("sectionTitle")
        self.audit_label = QLabel("")
        self.audit_label.setObjectName("hint")
        self.audit_label.setWordWrap(True)
        hint = QLabel(tr("keyboard_hint"))
        hint.setObjectName("hint")

        self.b_save_next = QPushButton(tr("save_next"))
        self.b_save_next.setObjectName("primary")
        self.b_save_next.clicked.connect(self.save_and_next)
        self.b_save = QPushButton(tr("save") if self.ticket_id else tr("save_close"))
        self.b_save.clicked.connect(self.save_and_close)
        self.b_skip = QPushButton(tr("skip"))
        self.b_skip.clicked.connect(self.skip)
        self.b_history = QPushButton(tr("history"))
        self.b_history.clicked.connect(self.show_history)
        b_cancel = QPushButton(tr("close"))
        b_cancel.clicked.connect(self.reject)
        buttons = QHBoxLayout()
        for b in (self.b_history, self.b_skip):
            buttons.addWidget(b)
        buttons.addStretch()
        for b in (b_cancel, self.b_save, self.b_save_next):
            b.setFocusPolicy(Qt.NoFocus)
            buttons.addWidget(b)
        if self.ticket_id:
            self.b_save.setObjectName("primary")
            self.b_save_next.hide()
        else:
            self.b_history.hide()
        self.b_skip.setVisible(bool(self.batch_files or self.batch_scanner))

        panel = QFrame()
        panel.setObjectName("panel")
        pl = QVBoxLayout(panel)
        pl.setContentsMargins(18, 14, 18, 14)
        pl.addWidget(self.batch_label)
        pl.addLayout(form)
        pl.addWidget(self.ocr_note)
        pl.addStretch()
        pl.addWidget(self.audit_label)
        pl.addWidget(hint)
        pl.addLayout(buttons)
        panel.setMinimumWidth(520)

        split = QSplitter(Qt.Horizontal)
        split.addWidget(left)
        split.addWidget(panel)
        split.setStretchFactor(0, 3)
        split.setStretchFactor(1, 2)
        lay = QVBoxLayout(self)
        lay.setContentsMargins(12, 12, 12, 12)
        lay.addWidget(split)

        self.fields = {"ticket_no": self.f_no, "date": self.f_date, "time": self.f_time,
                       "customer": self.f_customer, "site": self.f_site, "grade": self.f_grade,
                       "quantity": self.f_qty, "unit_price": self.f_price, "truck": self.f_truck,
                       "driver": self.f_driver, "pump": self.f_pump, "pump_no": self.f_pump_no,
                       "plant": self.f_plant, "status": self.f_status, "notes": self.f_notes}
        order = list(self.fields.values())
        for a, b in zip(order, order[1:]):
            QWidget.setTabOrder(a, b)
        self.nav = EnterNavigator(order, self._enter_on_last, self)
        QShortcut(QKeySequence("Ctrl+S"), self, activated=self._enter_on_last)
        QShortcut(QKeySequence("F2"), self, activated=self.scan)
        QShortcut(QKeySequence("F3"), self, activated=self.run_ocr)

        ocr_on = settings.get_bool(self.db, "ocr_enabled", True)
        self.b_ocr.setVisible(ocr_on)
        self.b_scan.setToolTip("F2")
        self.b_ocr.setToolTip("F3")

    def _load_lists(self):
        self.f_customer.set_items([(f"{c['name']} — {c['code']}", c["id"]) for c in customers.choices(self.db)],
                                  keep_text=False)
        self.f_grade.clear()
        self.f_grade.addItems(lookups.values(self.db, "grade"))
        self.f_plant.clear()
        self.f_plant.addItem("")
        self.f_plant.addItems(lookups.values(self.db, "plant"))
        merge = lambda a, b: sorted(set(a) | set(b), key=str.lower)  # noqa: E731
        self.f_truck.set_items(merge(lookups.values(self.db, "truck"), tickets.distinct(self.db, "truck_no")),
                               keep_text=False)
        self.f_driver.set_items(merge(lookups.values(self.db, "driver"), tickets.distinct(self.db, "driver")),
                                keep_text=False)
        self.f_pump_no.set_items(tickets.distinct(self.db, "pump_no"), keep_text=False)

    # --- load / reset ----------------------------------------------------------------------
    @staticmethod
    def _set_combo(combo: QComboBox, text: str):
        if text and combo.findText(text) < 0:
            combo.addItem(text)  # an old value no longer in the settings list
        combo.setCurrentIndex(max(combo.findText(text or ""), 0) if text else (0 if combo.count() else -1))

    def _load_ticket(self, ticket_id):
        t = tickets.get(self.db, ticket_id)
        self.f_no.setText(t["ticket_no"])
        self.f_date.setDate(QDate.fromString(t["date"], "yyyy-MM-dd"))
        self.f_time.setText(t["time"])
        self.f_customer.set_data_value(t["customer_id"])
        self._customer_changed()
        self.f_site.set_text(t["site_name"] or "")
        self._set_combo(self.f_grade, t["grade"])
        self.f_qty.setText(f"{t['quantity']:g}")
        self.f_price.setText(f"{t['unit_price']:g}" if t["unit_price"] else "")
        self.f_truck.set_text(t["truck_no"])
        self.f_driver.set_text(t["driver"])
        self.f_pump.setChecked(bool(t["pump_used"]))
        self.f_pump_no.setEnabled(bool(t["pump_used"]))
        self.f_pump_no.set_text(t["pump_no"])
        self._set_combo(self.f_plant, t["plant"])
        self.f_status.setCurrentIndex(self.f_status.findData(t["status"]))
        self.f_notes.setText(t["notes"])
        who = f"{tr('created_by')}: {t['created_by_name'] or '—'}  {fmt_date(t['created_at'])}"
        if t["updated_at"]:
            who += f"   •   {tr('updated_by')}: {t['updated_by_name'] or '—'}  {fmt_date(t['updated_at'])}"
        self.audit_label.setText(who)
        self.existing = tickets.scans(self.db, ticket_id)
        self._refresh_viewer()
        self.f_no.setFocus()

    def _reset_for_new(self, customer_id=None, keep: dict | None = None):
        """Blank form; date and plant carry over from the previous ticket of the batch."""
        keep = keep or {}
        last = tickets.last_values(self.db)
        self.ticket_id = None
        self.f_no.clear()
        d = keep.get("date") or date.today().isoformat()
        self.f_date.setDate(QDate.fromString(d, "yyyy-MM-dd"))
        self.f_time.clear()
        self.f_customer.setCurrentIndex(-1)
        self.f_customer.setEditText("")
        if customer_id:
            self.f_customer.set_data_value(customer_id)
        self._customer_changed()
        self.f_site.setEditText("")
        self._set_combo(self.f_grade, keep.get("grade") or last.get("grade") or "")
        self.f_qty.clear()
        self.f_price.clear()
        self.f_truck.set_text("")
        self.f_driver.set_text("")
        self.f_pump.setChecked(False)
        self.f_pump_no.setEnabled(False)
        self.f_pump_no.set_text("")
        self._set_combo(self.f_plant, keep.get("plant") or last.get("plant") or "")
        self.f_status.setCurrentIndex(0)
        self.f_notes.clear()
        self.pending = []
        self.existing = []
        self._clear_marks()
        self._refresh_viewer()
        self._update_batch_label()
        self.f_no.setFocus()

    def _state(self):
        return (self._collect_raw(), tuple(p["path"] for p in self.pending))

    # --- field logic -------------------------------------------------------------------------
    def _check_duplicate(self):
        dup = tickets.is_duplicate(self.db, self.f_no.text(), self.ticket_id)
        self.dup.setText(tr("duplicate_flag") if dup else "")
        self._mark(self.f_no, "invalid", dup)

    def _customer_changed(self, *_):
        cid = self.f_customer.value_data()
        text = self.f_site.value_text()
        self.f_site.set_items([s["name"] for s in customers.sites(self.db, cid)] if cid else [], keep_text=False)
        if cid and text:
            self.f_site.set_text(text)
        if cid:
            sites = customers.sites(self.db, cid)
            if len(sites) == 1 and not text:
                self.f_site.set_text(sites[0]["name"])
            self._mark(self.f_customer, "invalid", False)
        self._suggest_price()

    def _suggest_price(self, *_):
        cid = self.f_customer.value_data()
        if cid and not self.f_price.text().strip() and self.f_grade.currentText():
            p = tickets.last_price(self.db, cid, self.f_grade.currentText())
            if p:
                self.f_price.setText(f"{p:g}")

    def _truck_changed(self, text):
        if text and not self.f_driver.value_text():
            d = tickets.last_driver(self.db, text.strip())
            if d:
                self.f_driver.set_text(d)

    def _update_total(self, *_):
        q, p = tickets._number(self.f_qty.text()), tickets._number(self.f_price.text(), 0.0)
        ok = isinstance(q, float) and isinstance(p, float)
        self.f_total.setText(fmt_money(q * p) if ok else "")

    def _mark(self, widget, prop: str, on: bool):
        targets = [widget]
        if isinstance(widget, QComboBox) and widget.isEditable():
            targets.append(widget.lineEdit())  # the combo frame and the text box inside it
        for target in targets:
            target.setProperty(prop, on)
            target.style().unpolish(target)
            target.style().polish(target)

    def _clear_marks(self):
        for w in self.fields.values():
            if isinstance(w, (QLineEdit, QComboBox, QDateEdit)):
                self._mark(w, "invalid", False)
                self._mark(w, "ocr", False)
        self.ocr_note.hide()
        self.dup.setText("")

    def _collect_raw(self) -> dict:
        return {
            "ticket_no": self.f_no.text().strip(),
            "date": self.f_date.date().toString("yyyy-MM-dd"),
            "time": normalize_time(self.f_time.text()),
            "customer_id": self.f_customer.value_data(),
            "site_name": self.f_site.value_text(),
            "grade": self.f_grade.currentText(),
            "quantity": self.f_qty.text().strip(),
            "unit_price": self.f_price.text().strip(),
            "truck_no": self.f_truck.value_text(),
            "driver": self.f_driver.value_text(),
            "pump_used": self.f_pump.isChecked(),
            "pump_no": self.f_pump_no.value_text() if self.f_pump.isChecked() else "",
            "plant": self.f_plant.currentText(),
            "status": self.f_status.currentData(),
            "notes": self.f_notes.text().strip(),
        }

    # --- customers -----------------------------------------------------------------------------
    def create_customer(self, name: str = ""):
        from .customers import CustomerDialog
        preset = {"name": name}
        ocr_customer = getattr(self, "ocr_customer", None)
        if ocr_customer and ocr_customer["name"] == name:
            preset["address"] = ocr_customer["address"]
        dlg = CustomerDialog(self.ctx, parent=self, preset=preset)
        if dlg.exec() and dlg.customer_id:
            site = self.f_site.value_text()
            self._load_lists_customers()
            self.f_customer.set_data_value(dlg.customer_id)
            self._customer_changed()
            if site:
                self.f_site.set_text(site)
            return dlg.customer_id
        return None

    def _load_lists_customers(self):
        self.f_customer.set_items([(f"{c['name']} — {c['code']}", c["id"]) for c in customers.choices(self.db)],
                                  keep_text=False)

    # --- save --------------------------------------------------------------------------------
    def _enter_on_last(self):
        if self.ticket_id:
            self.save_and_close()
        else:
            self.save_and_next()

    def save(self) -> bool:
        self._clear_marks()
        self._check_duplicate()
        data = self._collect_raw()
        typed = self.f_customer.value_text()
        if not data["customer_id"] and typed:
            if ask(self, tr("new_customer_q", name=typed)):
                data["customer_id"] = self.create_customer(typed)
                data["site_name"] = self.f_site.value_text()
            if not data["customer_id"]:
                self.f_customer.setFocus()
                return False
        try:
            if self.ticket_id:
                tickets.update(self.ctx, self.ticket_id, data)
                tid = self.ticket_id
            else:
                tid = tickets.create(self.ctx, data)
        except ValidationError as e:
            for err in e.errors:
                key = err if isinstance(err, str) else err[0]
                if key in ERROR_FIELDS:
                    self._mark(self.fields[ERROR_FIELDS[key]], "invalid", True)
            first = next((ERROR_FIELDS[k] for k in (x if isinstance(x, str) else x[0] for x in e.errors)
                          if k in ERROR_FIELDS), None)
            show_errors(self, e.errors)
            if first:
                self.fields[first].setFocus()
            return False
        for p in self.pending:
            tickets.attach_scan(self.ctx, tid, p["path"], ocr_text=p.get("ocr", ""), move=p["temp"])
        self.pending = []
        self.ticket_id = tid
        self.saved_count += 1
        return True

    def save_and_close(self):
        if self.save():
            self.accept()

    def save_and_next(self):
        keep = {"date": self.f_date.date().toString("yyyy-MM-dd"), "plant": self.f_plant.currentText()}
        if not self.save():
            return
        self._reset_for_new(keep=keep)
        self._snapshot = self._state()
        self._next_batch_item()

    def skip(self):
        self._discard_pending()
        keep = {"date": self.f_date.date().toString("yyyy-MM-dd"), "plant": self.f_plant.currentText()}
        self._reset_for_new(keep=keep)
        self._next_batch_item()

    def _next_batch_item(self):
        if self.batch_files:
            self.batch_index += 1
            if self.batch_index >= len(self.batch_files):
                QMessageBox.information(self, tr("batch_scan"), tr("batch_done", n=self.saved_count))
                self.accept()
                return
            self._load_batch_file()
        elif self.batch_scanner:
            QTimer.singleShot(100, self.scan)

    def _update_batch_label(self):
        if self.batch_files:
            self.batch_label.setText(tr("batch_progress", i=self.batch_index + 1, n=len(self.batch_files)))
        elif self.batch_scanner:
            self.batch_label.setText(tr("batch_scanner_progress", n=self.saved_count))
        self.batch_label.setVisible(bool(self.batch_files or self.batch_scanner))

    def _load_batch_file(self):
        self._update_batch_label()
        self._add_files([self.batch_files[self.batch_index]])
        self._snapshot = self._state()

    # --- images --------------------------------------------------------------------------------
    def _refresh_viewer(self):
        paths = [s["abs_path"] for s in self.existing] + [p["path"] for p in self.pending]
        self.viewer.set_files(paths)
        if paths:
            self.viewer.show_page(len(self.viewer.pages) - 1)
        self.b_remove.setEnabled(bool(paths))
        self.b_ocr.setEnabled(bool(paths))

    def _add_files(self, paths, temp: bool = False):
        added = False
        for p in paths:
            if not is_supported(p):
                warn(self, f"{tr('file_unsupported')}\n{p}")
                continue
            self.pending.append({"path": str(p), "temp": temp, "ocr": ""})
            added = True
        self._refresh_viewer()
        if added and settings.get_bool(self.db, "ocr_enabled", True) and settings.get_bool(self.db, "ocr_auto", True):
            if ocr.find_tesseract(settings.get(self.db, "tesseract_path")):
                QTimer.singleShot(50, lambda: self.run_ocr(quiet=True))

    def attach_file(self):
        paths, _ = QFileDialog.getOpenFileNames(self, tr("attach_file"), "", tr("images_filter"))
        if paths:
            self._add_files(paths)

    def scan(self):
        try:
            if self.scanner is None:
                self.scanner = scanner.WiaScanner(dpi=settings.get_int(self.db, "scan_dpi", 200),
                                                  color=settings.get_bool(self.db, "scan_color", True),
                                                  show_ui=settings.get_bool(self.db, "scan_show_ui", False))
                if not self.scanner.show_ui and not self.scanner.select_device():
                    self.scanner = None
                    return
            dest = config.inbox_dir() / f"scan_{datetime.now():%Y%m%d_%H%M%S_%f}.jpg"
            path = self.scanner.scan(dest)
        except scanner.FeederEmpty:
            if self.batch_scanner and self.saved_count:
                if ask(self, tr("scan_feeder_empty") + "\n\n" + tr("batch_done", n=self.saved_count) +
                       "\n\n" + tr("scan") + "?"):
                    return self.scan()
                return
            warn(self, tr("scan_feeder_empty"))
            return
        except scanner.ScannerError as e:
            self.scanner = None if e.key in ("scan_no_device", "scan_offline", "scan_unavailable") else self.scanner
            warn(self, tr(e.key, detail=e.detail))
            return
        if path:
            self._update_batch_label()
            self._add_files([path], temp=True)
            self.f_no.setFocus()

    def remove_image(self):
        current = self.viewer.current_file()
        if not current:
            return
        for p in self.pending:
            if p["path"] == current:
                self.pending.remove(p)
                if p["temp"]:
                    Path(current).unlink(missing_ok=True)
                break
        else:
            scan = next((s for s in self.existing if s["abs_path"] == current), None)
            if scan and ask(self, tr("confirm_delete", name=Path(current).name)):
                tickets.remove_scan(self.ctx, scan["id"])
                self.existing.remove(scan)
        self._refresh_viewer()

    def _discard_pending(self):
        for p in self.pending:
            if p["temp"]:
                Path(p["path"]).unlink(missing_ok=True)
        self.pending = []

    # --- OCR -------------------------------------------------------------------------------------
    def run_ocr(self, quiet: bool = False):
        if self.ocr_worker is not None or not settings.get_bool(self.db, "ocr_enabled", True):
            return
        path = self.viewer.current_file()
        if not path:
            return
        exe = ocr.find_tesseract(settings.get(self.db, "tesseract_path"))
        if not exe:
            if not quiet:
                warn(self, tr("ocr_missing"))
            return
        self.b_ocr.setText("⏳ " + tr("ocr_running"))
        self.b_ocr.setEnabled(False)
        langs = settings.get(self.db, "ocr_languages", "eng+ara")
        self.ocr_worker = Worker(ocr.read_text, path, exe, langs, parent=self)
        self.ocr_worker.done.connect(lambda text: self._ocr_done(path, text))
        self.ocr_worker.failed.connect(self._ocr_failed)
        self.ocr_worker.finished.connect(self._ocr_finished)
        self.ocr_worker.start()

    def _ocr_finished(self):
        self.b_ocr.setText("🔎 " + tr("ocr_read"))
        self.b_ocr.setEnabled(True)
        self.ocr_worker = None

    def _ocr_failed(self, exc):
        self.ocr_note.setText(f"OCR: {exc}")
        self.ocr_note.show()

    def _ocr_done(self, path, text):
        for p in self.pending:
            if p["path"] == path:
                p["ocr"] = text
        self.apply_ocr_fields(ocr.extract_fields(text))

    def apply_ocr_fields(self, fields: dict):
        """Fill the form from an OCR reading. Only empty fields are filled (the date always, since it
        defaults to today); names are matched to existing customers/sites/trucks/drivers when close.
        Every filled field turns yellow so the user checks it before saving."""
        filled = []

        def mark(widget, label):
            self._mark(widget, "ocr", True)
            filled.append(tr(label))

        if fields.get("ticket_no") and not self.f_no.text().strip():
            self.f_no.setText(fields["ticket_no"])
            mark(self.f_no, "ticket_no")
        if fields.get("date"):
            d = QDate.fromString(fields["date"], "yyyy-MM-dd")
            if d.isValid() and abs(d.daysTo(QDate.currentDate())) < 400:
                self.f_date.setDate(d)
                mark(self.f_date, "date")
        if fields.get("time") and not self.f_time.text().strip():
            self.f_time.setText(fields["time"])
            mark(self.f_time, "time")
        if fields.get("customer") and not self.f_customer.value_text():
            self.ocr_customer = {"name": fields["customer"], "address": fields.get("address", "")}
            match = ocr.snap(fields["customer"], [(c["name"], c["id"]) for c in customers.choices(self.db)])
            if match:
                self.f_customer.set_data_value(match[1])
            else:
                self.f_customer.setEditText(fields["customer"])  # saving offers to create it
            self._customer_changed()
            mark(self.f_customer, "customer")
        if fields.get("site") and not self.f_site.value_text():
            cid = self.f_customer.value_data()
            known = [s["name"] for s in customers.sites(self.db, cid)] if cid else []
            self.f_site.set_text(ocr.snap(fields["site"], known) or fields["site"])
            mark(self.f_site, "site")
        if fields.get("grade"):
            items = [self.f_grade.itemText(i) for i in range(self.f_grade.count())]
            grade = next((g for g in items if g.upper() == fields["grade"].upper()), fields["grade"])
            if grade != self.f_grade.currentText():
                self._set_combo(self.f_grade, grade)
                mark(self.f_grade, "grade")
        if fields.get("quantity") and not self.f_qty.text().strip():
            self.f_qty.setText(f"{fields['quantity']:g}")
            mark(self.f_qty, "quantity")
        for key, combo, label in (("truck_no", self.f_truck, "truck"), ("driver", self.f_driver, "driver"),
                                  ("pump_no", self.f_pump_no, "pump_no")):
            if fields.get(key) and not combo.value_text():
                known = [combo.itemText(i) for i in range(combo.count())]
                combo.set_text(ocr.snap(fields[key], known) or fields[key])
                if key == "pump_no":
                    self.f_pump.setChecked(True)
                mark(combo, label)
        joined = ("، " if is_rtl() else ", ").join(filled)
        self.ocr_note.setText(tr("ocr_filled", fields=joined) if filled else tr("ocr_nothing"))
        self.ocr_note.show()
        self._check_duplicate()

    # --- history / close ---------------------------------------------------------------------------
    def show_history(self):
        from .audit import HistoryDialog
        if self.ticket_id:
            HistoryDialog(self.db, "ticket", self.ticket_id, self).exec()

    def has_unsaved(self) -> bool:
        return self._snapshot is not None and self._state() != self._snapshot and bool(
            self.pending or self.f_no.text().strip() or self.ticket_id)

    def reject(self):
        if self.has_unsaved() and not ask(self, tr("unsaved_changes")):
            return
        self._discard_pending()
        if self.ocr_worker is not None:
            self.ocr_worker.wait(5000)
        super().reject()

    def errors_text(self, errors):
        return "\n".join(tr_error(e) for e in errors)
