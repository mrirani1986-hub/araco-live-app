"""Main window: sidebar navigation and the page stack."""
from PySide6.QtCore import QTimer, Qt, Signal
from PySide6.QtGui import QKeySequence, QShortcut
from PySide6.QtWidgets import (QButtonGroup, QDialog, QFileDialog, QFormLayout, QFrame, QHBoxLayout, QLabel,
                               QLineEdit, QMainWindow, QPushButton, QStackedWidget, QVBoxLayout, QWidget,
                               QDialogButtonBox)

from .. import APP_NAME, VERSION, backup
from ..context import ValidationError
from ..i18n import language, tr
from ..media import SUPPORTED
from ..services import settings, users
from .widgets import info, show_errors


class MainWindow(QMainWindow):
    language_changed = Signal()
    logout_requested = Signal()
    data_replaced = Signal()

    def __init__(self, ctx):
        super().__init__()
        self.ctx = ctx
        self.setWindowTitle(f"{tr('app_title')} — {APP_NAME} {VERSION}")
        self.resize(1400, 860)
        self.pages = {}
        self.buttons = {}

        sidebar = QFrame()
        sidebar.setObjectName("sidebar")
        sidebar.setFixedWidth(230)
        side = QVBoxLayout(sidebar)
        side.setContentsMargins(12, 6, 12, 14)
        side.setSpacing(4)
        brand = QLabel("ARACO")
        brand.setObjectName("brand")
        sub = QLabel(tr("company"))
        sub.setObjectName("brandSub")
        side.addWidget(brand)
        side.addWidget(sub)

        self.stack = QStackedWidget()
        self.group = QButtonGroup(self)
        self.group.setExclusive(True)
        nav = [("dashboard", "🏠"), ("tickets", "🧾"), ("customers", "👥"), ("reports", "📊")]
        if ctx.is_admin:
            nav += [("trash", "🗑"), ("audit", "📜"), ("settings", "⚙")]
        for i, (name, icon) in enumerate(nav):
            b = QPushButton(f"{icon}   {tr('nav_' + name)}")
            b.setObjectName("nav")
            b.setCheckable(True)
            b.setCursor(Qt.PointingHandCursor)
            b.setToolTip(f"Ctrl+{i + 1}")
            b.clicked.connect(lambda _=False, n=name: self.show_page(n))
            self.group.addButton(b)
            self.buttons[name] = b
            side.addWidget(b)
            QShortcut(QKeySequence(f"Ctrl+{i + 1}"), self, activated=lambda n=name: self.show_page(n))
        side.addStretch()
        role = tr("role_" + ctx.user["role"])
        who = QLabel(f"👤 {ctx.user.get('full_name') or ctx.user['username']}\n{role}")
        who.setObjectName("userLabel")
        side.addWidget(who)
        for key, fn in (("language_toggle", self.toggle_language), ("change_password", self.change_password),
                        ("logout", self.logout_requested.emit)):
            b = QPushButton(tr(key))
            b.setObjectName("sideSmall")
            b.clicked.connect(fn)
            side.addWidget(b)

        central = QWidget()
        lay = QHBoxLayout(central)
        lay.setContentsMargins(0, 0, 0, 0)
        lay.setSpacing(0)
        lay.addWidget(sidebar)
        lay.addWidget(self.stack, 1)
        self.setCentralWidget(central)
        QShortcut(QKeySequence("Ctrl+N"), self, activated=self.new_ticket)

        # A daily backup also when the program is left open overnight.
        self.backup_timer = QTimer(self)
        self.backup_timer.timeout.connect(lambda: backup.daily_backup(self.ctx.db))
        self.backup_timer.start(60 * 60 * 1000)
        self.show_page("dashboard")

    # --- navigation -------------------------------------------------------------------
    def page(self, name):
        if name not in self.pages:
            from .audit import AuditPage
            from .customers import CustomersPage
            from .dashboard import DashboardPage
            from .reports import ReportsPage
            from .settings import SettingsPage
            from .tickets import TicketsPage
            from .trash import TrashPage
            cls = {"dashboard": DashboardPage, "customers": CustomersPage, "tickets": TicketsPage,
                   "reports": ReportsPage, "trash": TrashPage, "audit": AuditPage, "settings": SettingsPage}[name]
            self.pages[name] = cls(self)
            self.stack.addWidget(self.pages[name])
        return self.pages[name]

    def show_page(self, name):
        if name not in self.buttons:
            return
        p = self.page(name)
        self.buttons[name].setChecked(True)
        self.stack.setCurrentWidget(p)
        p.refresh()
        return p

    def refresh_current(self):
        w = self.stack.currentWidget()
        if w is not None:
            w.refresh()

    # --- actions used from several pages --------------------------------------------------
    def open_ticket_form(self, **kw):
        from .ticket_form import TicketForm
        form = TicketForm(self.ctx, parent=self, **kw)
        form.exec()
        self.refresh_current()
        return form

    def new_ticket(self, customer_id=None):
        return self.open_ticket_form(customer_id=customer_id)

    def edit_ticket(self, ticket_id):
        return self.open_ticket_form(ticket_id=ticket_id)

    def open_ticket_by_no(self, ticket_no):
        tid = self.ctx.db.scalar("SELECT id FROM tickets WHERE ticket_no = ? AND deleted_at IS NULL", (ticket_no,))
        if tid:
            self.edit_ticket(tid)

    def scan_ticket(self):
        return self.open_ticket_form(start_scan=True)

    def import_ticket_file(self):
        exts = " ".join(f"*{e}" for e in sorted(SUPPORTED))
        paths, _ = QFileDialog.getOpenFileNames(self, tr("import_file"), "", f"{tr('images_filter')};;* ({exts})")
        if not paths:
            return
        if len(paths) == 1:
            return self.open_ticket_form(files=paths)
        return self.open_ticket_form(batch_files=paths)

    def batch_scan(self):
        from .ticket_form import choose_batch_source
        choice = choose_batch_source(self)
        if choice == "scanner":
            self.open_ticket_form(batch_scanner=True)
        elif choice == "files":
            paths, _ = QFileDialog.getOpenFileNames(self, tr("batch_from_files"), "", tr("images_filter"))
            if paths:
                self.open_ticket_form(batch_files=paths)

    def new_customer(self):
        from .customers import CustomerDialog
        dlg = CustomerDialog(self.ctx, parent=self)
        if dlg.exec():
            self.refresh_current()
        return dlg

    def open_customer(self, customer_id):
        from .customers import CustomerPageDialog
        CustomerPageDialog(self.ctx, customer_id, parent=self).exec()
        self.refresh_current()

    def toggle_language(self):
        settings.set_value(self.ctx.db, "language", "en" if language() == "ar" else "ar")
        self.language_changed.emit()

    def change_password(self):
        dlg = QDialog(self)
        dlg.setWindowTitle(tr("change_password"))
        old, new, rep = QLineEdit(), QLineEdit(), QLineEdit()
        for e in (old, new, rep):
            e.setEchoMode(QLineEdit.Password)
        form = QFormLayout(dlg)
        form.addRow(tr("old_password"), old)
        form.addRow(tr("new_password"), new)
        form.addRow(tr("repeat_password"), rep)
        bb = QDialogButtonBox(QDialogButtonBox.Ok | QDialogButtonBox.Cancel)
        bb.button(QDialogButtonBox.Ok).setText(tr("save"))
        bb.button(QDialogButtonBox.Cancel).setText(tr("cancel"))
        form.addRow(bb)
        bb.rejected.connect(dlg.reject)

        def save():
            if new.text() != rep.text():
                show_errors(dlg, ["passwords_differ"])
                return
            try:
                users.set_password(self.ctx, self.ctx.user_id, new.text(), old.text())
            except ValidationError as e:
                show_errors(dlg, e.errors)
                return
            info(dlg, tr("password_changed"))
            dlg.accept()
        bb.accepted.connect(save)
        dlg.exec()
