"""Admin settings: general, scanner/OCR, editable lists, users, backup & restore."""
from PySide6.QtCore import Qt
from PySide6.QtWidgets import (QCheckBox, QComboBox, QDialog, QDialogButtonBox, QFileDialog, QFormLayout, QGridLayout,
                               QGroupBox, QHBoxLayout, QInputDialog, QLabel, QLineEdit, QListWidget, QListWidgetItem,
                               QPushButton, QSpinBox, QTabWidget, QVBoxLayout, QWidget)

from .. import backup, config, exporter, ocr, scanner, seed
from ..context import ValidationError
from ..i18n import tr
from ..services import audit, lookups, settings, users
from .widgets import CURRENCY, Col, DataTable, ask, fmt_num, info, page_title, show_errors, warn


class ListEditor(QGroupBox):
    """Ordered list of values with an active tick box (grades, plants, trucks, drivers)."""

    def __init__(self, ctx, kind):
        super().__init__(tr("list_" + kind))
        self.ctx, self.kind = ctx, kind
        self.list = QListWidget()
        self.list.setDragDropMode(QListWidget.InternalMove)
        self.input = QLineEdit()
        self.input.setPlaceholderText(tr("value"))
        self.input.returnPressed.connect(self.add)
        add = QPushButton(tr("add"))
        add.clicked.connect(self.add)
        up, down, rem = QPushButton(tr("move_up")), QPushButton(tr("move_down")), QPushButton(tr("delete"))
        up.clicked.connect(lambda: self.move(-1))
        down.clicked.connect(lambda: self.move(1))
        rem.clicked.connect(self.remove)
        row = QHBoxLayout()
        row.addWidget(self.input, 1)
        row.addWidget(add)
        row2 = QHBoxLayout()
        for b in (up, down, rem):
            row2.addWidget(b)
        lay = QVBoxLayout(self)
        lay.addWidget(self.list, 1)
        lay.addLayout(row)
        lay.addLayout(row2)
        self.load()

    def load(self):
        self.list.clear()
        for r in lookups.rows(self.ctx.db, self.kind):
            self._add_item(r["value"], bool(r["active"]))

    def _add_item(self, value, active=True):
        item = QListWidgetItem(value)
        item.setFlags(item.flags() | Qt.ItemIsUserCheckable | Qt.ItemIsEditable)
        item.setCheckState(Qt.Checked if active else Qt.Unchecked)
        self.list.addItem(item)

    def add(self):
        v = self.input.text().strip()
        if v and not self.list.findItems(v, Qt.MatchFixedString):
            self._add_item(v)
        self.input.clear()

    def move(self, step):
        r = self.list.currentRow()
        if r < 0 or not 0 <= r + step < self.list.count():
            return
        item = self.list.takeItem(r)
        self.list.insertItem(r + step, item)
        self.list.setCurrentRow(r + step)

    def remove(self):
        r = self.list.currentRow()
        if r >= 0:
            self.list.takeItem(r)

    def save(self):
        items = [(self.list.item(i).text(), self.list.item(i).checkState() == Qt.Checked)
                 for i in range(self.list.count())]
        lookups.save_list(self.ctx, self.kind, items)


class SettingsPage(QWidget):
    def __init__(self, main):
        super().__init__()
        self.main = main
        self.ctx = main.ctx
        self.db = main.ctx.db
        self.setObjectName("page")
        lay = QVBoxLayout(self)
        lay.setContentsMargins(24, 18, 24, 18)
        lay.addWidget(page_title(tr("nav_settings")))
        self.tabs = QTabWidget()
        self.tabs.addTab(self._general_tab(), tr("tab_general"))
        self.tabs.addTab(self._scanner_tab(), tr("tab_scanner").replace("&", "&&"))
        self.tabs.addTab(self._lists_tab(), tr("tab_lists"))
        self.tabs.addTab(self._users_tab(), tr("tab_users"))
        self.tabs.addTab(self._backup_tab(), tr("tab_backup"))
        lay.addWidget(self.tabs, 1)

    def refresh(self):
        self.load_users()
        self.load_backups()
        self.update_ocr_status()

    # --- general -----------------------------------------------------------------------
    def _general_tab(self):
        w = QWidget()
        form = QFormLayout(w)
        self.s_company = QLineEdit(settings.get(self.db, "company_name"))
        self.s_currency = QLineEdit(settings.get(self.db, "currency", "$"))
        self.s_currency.setMaximumWidth(120)
        self.s_language = QComboBox()
        self.s_language.addItem("العربية", "ar")
        self.s_language.addItem("English", "en")
        self.s_language.setCurrentIndex(self.s_language.findData(settings.get(self.db, "language", "ar")))
        form.addRow(tr("company_name"), self.s_company)
        form.addRow(tr("currency"), self.s_currency)
        form.addRow(tr("default_language"), self.s_language)
        save = QPushButton(tr("save"))
        save.setObjectName("primary")
        save.clicked.connect(self.save_general)
        form.addRow("", save)
        return w

    def save_general(self):
        lang_before = settings.get(self.db, "language", "ar")
        settings.set_many(self.ctx, {"company_name": self.s_company.text().strip(),
                                     "currency": self.s_currency.text().strip(),
                                     "language": self.s_language.currentData()})
        CURRENCY["symbol"] = self.s_currency.text().strip()
        info(self, tr("settings_saved"))
        if self.s_language.currentData() != lang_before:
            self.main.language_changed.emit()

    # --- scanner & OCR -----------------------------------------------------------------
    def _scanner_tab(self):
        w = QWidget()
        lay = QVBoxLayout(w)
        g1 = QGroupBox(tr("scan"))
        f1 = QFormLayout(g1)
        self.s_dpi = QSpinBox()
        self.s_dpi.setRange(100, 600)
        self.s_dpi.setSingleStep(50)
        self.s_dpi.setValue(settings.get_int(self.db, "scan_dpi", 200))
        self.s_color = QCheckBox(tr("scan_color"))
        self.s_color.setChecked(settings.get_bool(self.db, "scan_color", True))
        self.s_ui = QCheckBox(tr("scan_show_ui"))
        self.s_ui.setChecked(settings.get_bool(self.db, "scan_show_ui", False))
        status = QLabel(tr("scanner_status_ok") if scanner.available() else tr("scanner_status_missing"))
        status.setWordWrap(True)
        f1.addRow(tr("scan_dpi"), self.s_dpi)
        f1.addRow("", self.s_color)
        f1.addRow("", self.s_ui)
        f1.addRow("", status)

        g2 = QGroupBox("OCR — Tesseract")
        f2 = QFormLayout(g2)
        self.s_ocr = QCheckBox(tr("ocr_enabled"))
        self.s_ocr.setChecked(settings.get_bool(self.db, "ocr_enabled", True))
        self.s_ocr_auto = QCheckBox(tr("ocr_auto"))
        self.s_ocr_auto.setChecked(settings.get_bool(self.db, "ocr_auto", True))
        self.s_tess = QLineEdit(settings.get(self.db, "tesseract_path"))
        self.s_tess.setPlaceholderText(r"C:\Program Files\Tesseract-OCR\tesseract.exe")
        browse = QPushButton(tr("browse"))
        browse.clicked.connect(self.browse_tesseract)
        test = QPushButton(tr("test"))
        test.clicked.connect(self.update_ocr_status)
        row = QHBoxLayout()
        row.addWidget(self.s_tess, 1)
        row.addWidget(browse)
        row.addWidget(test)
        self.s_langs = QLineEdit(settings.get(self.db, "ocr_languages", "eng+ara"))
        self.ocr_status = QLabel("")
        self.ocr_status.setWordWrap(True)
        f2.addRow("", self.s_ocr)
        f2.addRow("", self.s_ocr_auto)
        f2.addRow(tr("tesseract_path"), row)
        f2.addRow(tr("ocr_languages"), self.s_langs)
        f2.addRow("", self.ocr_status)

        save = QPushButton(tr("save"))
        save.setObjectName("primary")
        save.clicked.connect(self.save_scanner)
        lay.addWidget(g1)
        lay.addWidget(g2)
        lay.addWidget(save, 0, Qt.AlignLeft)
        lay.addStretch()
        return w

    def browse_tesseract(self):
        path, _ = QFileDialog.getOpenFileName(self, tr("tesseract_path"), r"C:\Program Files",
                                              "tesseract (tesseract.exe tesseract)")
        if path:
            self.s_tess.setText(path)
            self.update_ocr_status()

    def update_ocr_status(self):
        exe = ocr.find_tesseract(self.s_tess.text().strip())
        if exe:
            langs = ", ".join(sorted(ocr.available_languages(exe))) or "?"
            self.ocr_status.setText(tr("ocr_status_ok", path=exe, langs=langs))
            self.ocr_status.setStyleSheet("color: #1E8E3E;")
        else:
            self.ocr_status.setText(tr("ocr_status_missing") + "\n" + tr("ocr_missing"))
            self.ocr_status.setStyleSheet("color: #B3261E;")

    def save_scanner(self):
        settings.set_many(self.ctx, {"scan_dpi": self.s_dpi.value(), "scan_color": self.s_color.isChecked(),
                                     "scan_show_ui": self.s_ui.isChecked(), "ocr_enabled": self.s_ocr.isChecked(),
                                     "ocr_auto": self.s_ocr_auto.isChecked(),
                                     "tesseract_path": self.s_tess.text().strip(),
                                     "ocr_languages": self.s_langs.text().strip() or "eng+ara"})
        self.update_ocr_status()
        info(self, tr("settings_saved"))

    # --- lists -----------------------------------------------------------------------------
    def _lists_tab(self):
        w = QWidget()
        lay = QVBoxLayout(w)
        hint = QLabel(tr("list_hint"))
        hint.setObjectName("hint")
        hint.setWordWrap(True)
        lay.addWidget(hint)
        grid = QGridLayout()
        self.editors = [ListEditor(self.ctx, k) for k in lookups.KINDS]
        for i, e in enumerate(self.editors):
            grid.addWidget(e, 0, i)
        lay.addLayout(grid, 1)
        save = QPushButton(tr("save"))
        save.setObjectName("primary")
        save.clicked.connect(self.save_lists)
        lay.addWidget(save, 0, Qt.AlignLeft)
        return w

    def save_lists(self):
        for e in self.editors:
            e.save()
            e.load()
        info(self, tr("settings_saved"))

    # --- users -----------------------------------------------------------------------------
    def _users_tab(self):
        w = QWidget()
        lay = QVBoxLayout(w)
        self.users_table = DataTable([Col("username", "username", width=160), Col("full_name", "full_name", width=220),
                                      Col("role_label", "role", width=140), Col("active", "active", "bool", 80),
                                      Col("created_at", "created_at", "date")])
        self.users_table.activated_row.connect(self.edit_user)
        lay.addWidget(self.users_table, 1)
        bar = QHBoxLayout()
        bar.addStretch()
        for key, fn in (("new_user", self.new_user), ("edit", lambda: self.edit_user(self.users_table.selected_row())),
                        ("reset_password", self.reset_password)):
            b = QPushButton(tr(key))
            b.clicked.connect(fn)
            bar.addWidget(b)
        lay.addLayout(bar)
        return w

    def load_users(self):
        rows = users.list_users(self.db)
        for r in rows:
            r["role_label"] = tr("role_" + r["role"])
        self.users_table.set_rows(rows)

    def _user_dialog(self, row=None):
        dlg = QDialog(self)
        dlg.setWindowTitle(tr("new_user") if row is None else tr("edit"))
        form = QFormLayout(dlg)
        username = QLineEdit(row["username"] if row else "")
        username.setEnabled(row is None)
        full = QLineEdit(row["full_name"] if row else "")
        role = QComboBox()
        for r in users.ROLES:
            role.addItem(tr("role_" + r), r)
        role.setCurrentIndex(role.findData(row["role"] if row else "data_entry"))
        active = QCheckBox(tr("active"))
        active.setChecked(bool(row["active"]) if row else True)
        pw = QLineEdit()
        pw.setEchoMode(QLineEdit.Password)
        form.addRow(tr("username"), username)
        form.addRow(tr("full_name"), full)
        form.addRow(tr("role"), role)
        if row is None:
            form.addRow(tr("password"), pw)
        else:
            form.addRow("", active)
        bb = QDialogButtonBox(QDialogButtonBox.Ok | QDialogButtonBox.Cancel)
        bb.button(QDialogButtonBox.Ok).setText(tr("save"))
        bb.button(QDialogButtonBox.Cancel).setText(tr("cancel"))
        form.addRow(bb)
        bb.rejected.connect(dlg.reject)

        def save():
            try:
                if row is None:
                    users.create(self.ctx, username.text(), full.text(), pw.text(), role.currentData())
                else:
                    users.update(self.ctx, row["id"], full.text(), role.currentData(), active.isChecked())
            except ValidationError as e:
                show_errors(dlg, e.errors)
                return
            dlg.accept()
        bb.accepted.connect(save)
        if dlg.exec():
            self.load_users()

    def new_user(self):
        self._user_dialog()

    def edit_user(self, row):
        if row is None:
            info(self, tr("select_row"))
            return
        self._user_dialog(row)

    def reset_password(self):
        row = self.users_table.selected_row()
        if row is None:
            info(self, tr("select_row"))
            return
        pw, ok = QInputDialog.getText(self, tr("reset_password"), f"{tr('new_password')} — {row['username']}",
                                      QLineEdit.Password)
        if not ok:
            return
        try:
            users.set_password(self.ctx, row["id"], pw)
        except ValidationError as e:
            show_errors(self, e.errors)
            return
        info(self, tr("password_changed"))

    # --- backup ------------------------------------------------------------------------------
    def _backup_tab(self):
        w = QWidget()
        lay = QVBoxLayout(w)
        folder = QLabel(f"{tr('backup_folder')}:  \u2066{config.data_dir()}\u2069")
        folder.setTextInteractionFlags(Qt.TextSelectableByMouse)
        hint = QLabel(tr("backup_auto_hint"))
        hint.setObjectName("hint")
        lay.addWidget(folder)
        lay.addWidget(hint)
        bar = QHBoxLayout()
        for key, fn, obj in (("backup_now", self.do_backup, "primary"), ("backup_zip", self.do_zip, ""),
                             ("restore_backup", self.do_restore, "danger"), ("open_folder", self.open_folder, "")):
            b = QPushButton(tr(key))
            if obj:
                b.setObjectName(obj)
            b.clicked.connect(fn)
            bar.addWidget(b)
        bar.addStretch()
        lay.addLayout(bar)
        t = QLabel(tr("backup_list"))
        t.setObjectName("sectionTitle")
        lay.addWidget(t)
        self.backups_table = DataTable([Col("name", "file", width=360), Col("modified", "date", width=170),
                                        Col("size_kb", "size")])
        lay.addWidget(self.backups_table, 1)
        demo = QGroupBox(tr("sample_data"))
        dl = QHBoxLayout(demo)
        b_seed = QPushButton(tr("load_sample"))
        b_seed.clicked.connect(self.load_sample)
        b_wipe = QPushButton(tr("wipe_data"))
        b_wipe.setObjectName("danger")
        b_wipe.clicked.connect(self.wipe)
        dl.addWidget(b_seed)
        dl.addWidget(b_wipe)
        dl.addStretch()
        lay.addWidget(demo)
        return w

    def load_backups(self):
        rows = backup.list_backups()
        for r in rows:
            r["size_kb"] = f"{fmt_num(r['size'] / 1024, 0)} KB"
        self.backups_table.set_rows(rows)

    def do_backup(self):
        path = backup.backup_now(self.db)
        with self.db.conn:
            audit.log(self.ctx, "backup", "database", None, {"file": path.name})
        self.load_backups()
        info(self, tr("backup_done", path=path))

    def do_zip(self):
        folder = QFileDialog.getExistingDirectory(self, tr("backup_zip"))
        if not folder:
            return
        path = backup.full_zip(self.db, folder)
        with self.db.conn:
            audit.log(self.ctx, "backup", "database", None, {"file": str(path)})
        info(self, tr("backup_done", path=path))

    def do_restore(self):
        path, _ = QFileDialog.getOpenFileName(self, tr("restore_backup"), str(config.backups_dir()),
                                              "ARACO backup (*.db *.zip)")
        if not path:
            return
        if not path.lower().endswith(".zip") and not backup.is_araco_db(path):
            warn(self, tr("restore_invalid"))
            return
        if not ask(self, tr("restore_confirm", name=path)):
            return
        try:
            safety = backup.restore(self.db, path)
        except (ValueError, KeyError, OSError) as e:
            warn(self, f"{tr('restore_invalid')}\n{e}")
            return
        with self.db.conn:
            audit.log(self.ctx, "restore_db", "database", None, {"file": path})
        info(self, tr("restore_done", path=safety))
        self.main.data_replaced.emit()

    def open_folder(self):
        exporter.open_file(config.data_dir())

    def load_sample(self):
        if self.db.scalar("SELECT COUNT(*) FROM customers") or self.db.scalar("SELECT COUNT(*) FROM tickets"):
            warn(self, tr("sample_only_empty"))
            return
        stats = seed.seed(self.ctx)
        with self.db.conn:
            audit.log(self.ctx, "seed", "all", None, stats)
        info(self, tr("sample_loaded", **stats))

    def wipe(self):
        text, ok = QInputDialog.getText(self, tr("wipe_data"), tr("wipe_confirm"))
        if ok and text.strip().upper() == "WIPE":
            seed.wipe_business_data(self.ctx)
            self.load_backups()
            info(self, tr("wiped"))
