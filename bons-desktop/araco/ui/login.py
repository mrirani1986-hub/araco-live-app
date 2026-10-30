"""Login dialog (with the language switch, so it can be read in either language)."""
from PySide6.QtCore import Qt, Signal
from PySide6.QtWidgets import QDialog, QFormLayout, QHBoxLayout, QLabel, QLineEdit, QPushButton, QVBoxLayout

from ..i18n import tr
from ..services import users


class LoginDialog(QDialog):
    language_toggled = Signal()

    def __init__(self, db, username: str = ""):
        super().__init__()
        self.db = db
        self.user = None
        self.setWindowTitle(tr("app_title"))
        self.setMinimumWidth(460)
        brand = QLabel("ARACO")
        brand.setAlignment(Qt.AlignCenter)
        brand.setStyleSheet("font-size: 40px; font-weight: 900; color: #1F2A44; letter-spacing: 4px;")
        sub = QLabel(tr("company"))
        sub.setAlignment(Qt.AlignCenter)
        sub.setStyleSheet("color: #E87722; font-size: 16px; font-weight: 600;")
        title = QLabel(tr("login_title"))
        title.setObjectName("sectionTitle")
        self.username = QLineEdit(username)
        self.password = QLineEdit()
        self.password.setEchoMode(QLineEdit.Password)
        self.error = QLabel("")
        self.error.setObjectName("dupFlag")
        form = QFormLayout()
        form.addRow(tr("username"), self.username)
        form.addRow(tr("password"), self.password)
        ok = QPushButton(tr("login"))
        ok.setObjectName("primary")
        ok.setDefault(True)
        ok.clicked.connect(self.try_login)
        lang = QPushButton(tr("language_toggle"))
        lang.clicked.connect(self.language_toggled.emit)
        buttons = QHBoxLayout()
        buttons.addWidget(lang)
        buttons.addStretch()
        buttons.addWidget(ok)
        hint = QLabel(tr("default_login_hint"))
        hint.setObjectName("hint")
        hint.setWordWrap(True)
        lay = QVBoxLayout(self)
        lay.setContentsMargins(28, 24, 28, 24)
        lay.setSpacing(10)
        for w in (brand, sub, title):
            lay.addWidget(w)
        lay.addLayout(form)
        lay.addWidget(self.error)
        lay.addLayout(buttons)
        if db.scalar("SELECT COUNT(*) FROM audit_log WHERE action = 'login'") == 0:
            lay.addWidget(hint)
        (self.password if username else self.username).setFocus()

    def try_login(self):
        user = users.authenticate(self.db, self.username.text(), self.password.text())
        if not user:
            self.error.setText(tr("login_failed"))
            self.password.selectAll()
            self.password.setFocus()
            return
        self.user = user
        self.accept()
