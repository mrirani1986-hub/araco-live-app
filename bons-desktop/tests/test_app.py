"""main.py controller: login → sample data offer → window, language switch, restore reload, logout."""
from PySide6.QtWidgets import QApplication

import main as app_main
from araco import i18n
from araco.services import settings
from araco.ui import login as login_mod
from araco.ui import widgets


def test_login_language_logout(db, monkeypatch):
    qapp = QApplication.instance() or QApplication([])
    attempts = []

    def fake_exec(self):
        attempts.append(1)
        if len(attempts) == 1:  # first: press the language button on the login screen
            self.language_toggled.emit()
            return 0
        if len(attempts) == 2:  # wrong password keeps the dialog open; then the right one
            self.username.setText("admin")
            self.password.setText("nope")
            self.try_login()
            assert self.user is None
            self.password.setText("admin123")
            self.try_login()
            return 1
        return 0  # after logout: close the login window → quit

    monkeypatch.setattr(login_mod.LoginDialog, "exec", fake_exec)
    monkeypatch.setattr(widgets, "ask", lambda *a, **k: True)
    monkeypatch.setattr(widgets, "info", lambda *a, **k: None)

    app = app_main.App(qapp, db)
    app.apply_language("ar")
    assert app.login()
    assert i18n.language() == "en" and settings.get(db, "language") == "en"
    assert db.scalar("SELECT COUNT(*) FROM customers") == 20  # accepted the sample data offer
    first = app.window
    first.toggle_language()  # sidebar button
    assert i18n.language() == "ar" and app.window is not first
    app.window.data_replaced.emit()  # after a restore the window is rebuilt
    app.on_logout()
    assert app.window is None and len(attempts) == 3
    assert db.scalar("SELECT COUNT(*) FROM audit_log WHERE action = 'login'") == 1


def test_cli_seed(data_dir, capsys):
    assert app_main.main(["--seed"]) == 0
    assert "'customers': 20" in capsys.readouterr().out
