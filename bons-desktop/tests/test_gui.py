"""Offscreen smoke test: every page and dialog builds, loads data and renders in both languages.

Set SHOTS_DIR to save screenshots.
"""
import os
from datetime import date
from pathlib import Path

import pytest

pytest.importorskip("PySide6")

from PySide6.QtCore import QDate, Qt  # noqa: E402
from PySide6.QtWidgets import QApplication  # noqa: E402

from araco import i18n, seed  # noqa: E402
from araco.services import tickets  # noqa: E402
from araco.ui import theme  # noqa: E402


@pytest.fixture(scope="module")
def qapp():
    app = QApplication.instance() or QApplication([])
    theme.apply(app)
    return app


def shot(widget, name):
    folder = os.environ.get("SHOTS_DIR")
    QApplication.processEvents()
    if folder:
        Path(folder).mkdir(parents=True, exist_ok=True)
        widget.grab().save(str(Path(folder) / f"{name}.png"))


@pytest.mark.parametrize("lang", ["ar", "en"])
def test_all_screens(qapp, admin, lang):
    from araco.ui.audit import HistoryDialog
    from araco.ui.customers import CustomerDialog, CustomerPageDialog
    from araco.ui.import_dialog import ImportDialog
    from araco.ui.main_window import MainWindow
    from araco.ui.ticket_form import TicketForm
    from araco.ui.viewer import ScanViewerDialog

    i18n.set_language(lang)
    qapp.setLayoutDirection(Qt.RightToLeft if lang == "ar" else Qt.LeftToRight)
    seed.seed(admin, n_tickets=150, with_images=4)

    win = MainWindow(admin)
    win.resize(1500, 900)
    win.show()
    for name in ("dashboard", "tickets", "customers", "reports", "trash", "audit", "settings"):
        page = win.show_page(name)
        shot(win, f"{lang}_{name}")
        assert page.isVisible()
    tickets_page = win.page("tickets")
    tickets_page.filters.period.setCurrentIndex(tickets_page.filters.period.findData("all_dates"))
    tickets_page.reload()
    assert tickets_page.table.model_.rowCount() == 150
    reports_page = win.show_page("reports")
    for g in range(reports_page.group.count()):
        reports_page.group.setCurrentIndex(g)
    reports_page.group.setCurrentIndex(reports_page.group.findData("customer"))
    shot(win, f"{lang}_reports_customer")
    settings_page = win.page("settings")
    win.show_page("settings")
    for i in range(settings_page.tabs.count()):
        settings_page.tabs.setCurrentIndex(i)
        shot(win, f"{lang}_settings_{i}")

    with_scan = admin.db.scalar("SELECT ticket_id FROM ticket_scans LIMIT 1")
    form = TicketForm(admin, ticket_id=with_scan)
    form.resize(1450, 880)
    form.show()
    shot(form, f"{lang}_ticket_edit")
    assert form.viewer.pages
    form._snapshot = form._state()
    form.reject()

    new = TicketForm(admin)
    new.resize(1450, 880)
    new.show()
    shot(new, f"{lang}_ticket_new")
    new.f_no.setText("250100")  # an existing number
    assert new.dup.text()
    new._snapshot = new._state()
    new.reject()

    cid = admin.db.scalar("SELECT id FROM customers WHERE name = 'Rami Saad'")
    page = CustomerPageDialog(admin, cid, parent=win)
    page.resize(1400, 860)
    page.show()
    shot(page, f"{lang}_customer_page")
    assert page.table.model_.rowCount() > 0
    page.close()

    dlg = CustomerDialog(admin, cid, parent=win)
    dlg.show()
    shot(dlg, f"{lang}_customer_edit")
    dlg.close()

    imp = ImportDialog(admin, win)
    imp.show()
    shot(imp, f"{lang}_import")
    imp.close()

    viewer = ScanViewerDialog(admin.db, with_scan, win)
    viewer.show()
    shot(viewer, f"{lang}_viewer")
    viewer.close()
    HistoryDialog(admin.db, "ticket", with_scan, win).close()
    win.close()


def test_entry_form_flow(qapp, admin, tmp_path):
    """Type a ticket like a user would: autocomplete values, Enter flow, save & next keeps the date."""
    from PySide6.QtTest import QTest

    from araco.services import customers
    from araco.ui.ticket_form import TicketForm, normalize_time

    i18n.set_language("en")
    cid = customers.create(admin, {"name": "أحمد خليل"}, sites=["Villa"])
    form = TicketForm(admin)
    form.show()
    form.f_no.setText("9001")
    form.f_date.setDate(QDate(2026, 10, 5))
    form.f_time.setText("745")
    form.f_time.editingFinished.emit()
    form.f_customer.setEditText("أحمد خليل — C0001")
    assert form.f_customer.value_data() == cid
    form._customer_changed()
    assert form.f_site.value_text() == "Villa"  # the only site is pre-selected
    form.f_grade.setCurrentText("B300")
    form.f_qty.setText("7,5")  # comma decimal is accepted
    form.f_price.setText("80")
    assert form.f_total.text() == "$600.00"
    form.f_truck.setEditText("M-30")
    form.f_notes.setFocus()
    QTest.keyClick(form.f_notes, Qt.Key_Return)  # Enter on the last field saves
    QApplication.processEvents()
    t = tickets.search(admin.db, {"text": "9001"})[0]
    assert (t["time"], t["quantity"], t["total"], t["site_name"]) == ("07:45", 7.5, 600.0, "Villa")
    assert form.f_no.text() == "" and form.f_date.date() == QDate(2026, 10, 5)  # ready for the next one
    assert normalize_time("8") == "08:00" and normalize_time("14.3") == "14:03"
    form._snapshot = form._state()
    form.reject()


def test_batch_files(qapp, admin, tmp_path, monkeypatch):
    from araco.services import customers
    from araco.ui import ticket_form
    from araco.ui.ticket_form import TicketForm

    monkeypatch.setattr(ticket_form.QMessageBox, "information", lambda *a, **k: None)
    i18n.set_language("en")
    cid = customers.create(admin, {"name": "Batch Client"})
    files = [seed.draw_ticket_image(tmp_path / f"b{i}.jpg", f"55{i}000", date.today().isoformat(), "09:00",
                                    "Batch Client", "B250", 6, "M-1") for i in range(3)]
    form = TicketForm(admin, batch_files=files)
    form.show()
    for i in range(3):
        assert form.batch_label.text() == f"Batch: {i + 1} of 3"
        form.f_no.setText(f"B-{i}")
        form.f_customer.set_data_value(cid)
        form.f_qty.setText("6")
        form.save_and_next()
    assert form.result() == 1  # accepted
    rows = tickets.search(admin.db, {"customer_id": cid})
    assert len(rows) == 3 and all(r["scan_count"] == 1 for r in rows)
