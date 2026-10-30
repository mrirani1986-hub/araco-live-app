"""ARACO Bons — start the desktop application."""
import argparse
import os
import sys
import traceback
from datetime import datetime

from PySide6.QtCore import Qt
from PySide6.QtGui import QIcon
from PySide6.QtWidgets import QApplication, QMessageBox

from araco import APP_NAME, backup, config, i18n
from araco.context import Ctx
from araco.db import Database
from araco.services import audit, settings
from araco.ui import theme
from araco.ui.widgets import CURRENCY


class App:
    def __init__(self, qapp, db):
        self.qapp = qapp
        self.db = db
        self.window = None
        self.ctx = None
        self.last_username = ""

    def apply_language(self, lang):
        i18n.set_language(lang)
        self.qapp.setLayoutDirection(Qt.RightToLeft if i18n.is_rtl() else Qt.LeftToRight)

    def toggle_language(self):
        lang = "en" if i18n.language() == "ar" else "ar"
        settings.set_value(self.db, "language", lang)
        self.apply_language(lang)

    def login(self):
        from araco.ui.login import LoginDialog
        while True:
            dlg = LoginDialog(self.db, self.last_username)
            toggled = []
            dlg.language_toggled.connect(lambda: (toggled.append(1), dlg.reject()))
            dlg.exec()
            if toggled:
                self.toggle_language()
                continue
            if dlg.user is None:
                self.qapp.quit()
                return False
            self.ctx = Ctx(self.db, dlg.user)
            self.last_username = dlg.user["username"]
            with self.db.conn:
                audit.log(self.ctx, "login", "user", dlg.user["id"])
            self.offer_sample_data()
            self.open_main()
            return True

    def offer_sample_data(self):
        if not self.ctx.is_admin or settings.get(self.db, "sample_offered") == "1":
            return
        settings.set_value(self.db, "sample_offered", "1")
        if self.db.scalar("SELECT COUNT(*) FROM customers"):
            return
        from araco import seed
        from araco.ui.widgets import ask, info
        if ask(None, i18n.tr("load_sample_q")):
            stats = seed.seed(self.ctx)
            with self.db.conn:
                audit.log(self.ctx, "seed", "all", None, stats)
            info(None, i18n.tr("sample_loaded", **stats))

    def open_main(self):
        from araco.ui.main_window import MainWindow
        CURRENCY["symbol"] = settings.get(self.db, "currency", "$")
        old = self.window
        self.window = MainWindow(self.ctx)
        self.window.language_changed.connect(self.on_language)
        self.window.logout_requested.connect(self.on_logout)
        self.window.data_replaced.connect(self.open_main)
        if old is not None:
            self.window.setGeometry(old.geometry())
            if old.isMaximized():
                self.window.showMaximized()
            else:
                self.window.show()
            old.close()
            old.deleteLater()
        else:
            self.window.showMaximized()

    def on_language(self):
        """The sidebar button or Settings saved a new language: rebuild the window in it."""
        self.apply_language(settings.get(self.db, "language", "ar"))
        self.open_main()

    def on_logout(self):
        self.window.close()
        self.window.deleteLater()
        self.window = None
        self.ctx = None
        self.login()


def install_excepthook():
    def hook(exc_type, exc, tb):
        text = "".join(traceback.format_exception(exc_type, exc, tb))
        try:
            with open(config.data_dir() / "error.log", "a", encoding="utf-8") as fh:
                fh.write(f"\n--- {datetime.now():%Y-%m-%d %H:%M:%S}\n{text}")
        except OSError:
            pass
        sys.__stderr__ and sys.__stderr__.write(text)
        if QApplication.instance():
            QMessageBox.critical(None, APP_NAME, f"{exc}\n\n(error.log: {config.data_dir()})")
    sys.excepthook = hook


def main(argv=None):
    parser = argparse.ArgumentParser(description=APP_NAME)
    parser.add_argument("--data-dir", help=r"data folder (default C:\ARACO_Data)")
    parser.add_argument("--seed", action="store_true", help="load sample data into an empty database and exit")
    args = parser.parse_args(argv)
    if args.data_dir:
        os.environ["ARACO_DATA_DIR"] = args.data_dir

    db = Database(config.db_path())
    if args.seed:
        from araco import seed
        from araco.services import users
        ctx = Ctx(db, users.authenticate(db, "admin", "admin123") or {"id": None, "username": "seed", "role": "admin"})
        print(seed.seed(ctx))
        return 0

    QApplication.setHighDpiScaleFactorRoundingPolicy(Qt.HighDpiScaleFactorRoundingPolicy.PassThrough)
    qapp = QApplication(sys.argv[:1])
    qapp.setApplicationName(APP_NAME)
    icon = config.resource_path("assets/araco.ico")
    if icon.exists():
        qapp.setWindowIcon(QIcon(str(icon)))
    theme.apply(qapp)
    install_excepthook()
    try:
        backup.daily_backup(db)
    except OSError as e:
        QMessageBox.warning(None, APP_NAME, f"Backup failed: {e}")

    app = App(qapp, db)
    app.apply_language(settings.get(db, "language", "ar"))
    if not app.login():
        return 0
    return qapp.exec()


if __name__ == "__main__":
    sys.exit(main())
