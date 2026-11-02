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


def selftest(folder) -> int:
    """Exercise database, sample data, exports, PDF rendering, OCR lookup and every screen.

    Used by the build pipeline on the packaged .exe; safe to run on a user's PC too.
    """
    from pathlib import Path
    out = Path(folder)
    out.mkdir(parents=True, exist_ok=True)
    os.environ["ARACO_DATA_DIR"] = str(out / "data")
    lines = []
    try:
        from araco import exporter, media, ocr, scanner, seed
        from araco.services import reports, users
        db = Database(config.db_path())
        ctx = Ctx(db, users.authenticate(db, "admin", "admin123"))
        lines.append(f"seed: {seed.seed(ctx, n_tickets=40, with_images=2)}")
        rows, total = reports.summary(db, "customer")
        lines.append(f"report: {len(rows)} customers, {total['quantity']} m3")
        headers = ["رقم البون", "الزبون", "الكمية"]
        data = [["1", "شركة الأمل", 8.0], ["2", "Rami Saad", 6.5]]
        exporter.export_xlsx(out / "selftest.xlsx", "اختبار", headers, data, rtl=True)
        pdf = exporter.export_pdf(out / "selftest.pdf", "اختبار", headers, data, rtl=True)
        lines.append(f"pdf pages: {len(media.load_pages(pdf))}")
        lines.append(f"backup: {backup.backup_now(db).name}")
        lines.append(f"tesseract: {ocr.find_tesseract() or 'not installed'}")
        lines.append(f"wia scanner support: {scanner.available()}")
        qapp = QApplication.instance() or QApplication(sys.argv[:1])
        theme.apply(qapp)
        from araco.ui.main_window import MainWindow
        from araco.ui.ticket_form import TicketForm
        for lang in ("ar", "en"):
            i18n.set_language(lang)
            win = MainWindow(ctx)
            for name in ("dashboard", "tickets", "customers", "reports", "trash", "audit", "settings"):
                win.show_page(name)
            win.grab().save(str(out / f"selftest_{lang}.png"))
            form = TicketForm(ctx, ticket_id=db.scalar("SELECT ticket_id FROM ticket_scans LIMIT 1"))
            assert form.viewer.pages, "scan image did not load"
            form.close()
            win.close()
        lines.append("screens: ok")
        db.close()
        status = 0
    except Exception:  # noqa: BLE001 - report everything
        lines.append(traceback.format_exc())
        status = 1
    lines.insert(0, "OK" if status == 0 else "FAILED")
    (out / "selftest.txt").write_text("\n".join(lines), encoding="utf-8")
    return status


def main(argv=None):
    parser = argparse.ArgumentParser(description=APP_NAME)
    parser.add_argument("--data-dir", help=r"data folder (default C:\ARACO_Data)")
    parser.add_argument("--seed", action="store_true", help="load sample data into an empty database and exit")
    parser.add_argument("--selftest", metavar="FOLDER",
                        help="check the installation in a scratch data folder, write FOLDER/selftest.txt and exit")
    args = parser.parse_args(argv)
    if args.selftest:
        return selftest(args.selftest)
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
