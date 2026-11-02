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


def test_ticket_import_dialog(qapp, admin, tmp_path, monkeypatch):
    from openpyxl import Workbook

    from araco.ui import import_dialog
    from araco.ui.import_dialog import ImportDialog

    shown = []
    monkeypatch.setattr(import_dialog, "info", lambda parent, text: shown.append(text))
    i18n.set_language("ar")
    qapp.setLayoutDirection(Qt.RightToLeft)
    wb = Workbook()
    ws = wb.active
    ws.append(["رقم البون", "التاريخ", "الزبون", "الموقع", "الصنف", "الكمية", "السعر"])
    for i in range(30):
        ws.append([f"9{i:03d}", f"{i % 28 + 1:02d}/09/2025", ["جورج حداد", "Rami Saad"][i % 2], "ورشة", "B300",
                   8, 75])
    ws.append(["9000", "01/09/2025", "Rami Saad", "", "B300", 8, 75])  # repeated number
    path = tmp_path / "old.xlsx"
    wb.save(path)

    dlg = ImportDialog(admin, kind="tickets")
    dlg.resize(1250, 860)
    dlg.show()
    dlg.load(str(path))
    assert dlg.b_import.isEnabled() and dlg.combos["customer"].currentData() == 2
    dlg.check()
    shot(dlg, "ar_import_tickets_check")
    assert "30" in dlg.check_result.text() and tickets.search(admin.db, {}) == []
    dlg.do_import()
    assert len(tickets.search(admin.db, {})) == 30 and "9000" in shown[0]
    i18n.set_language("en")
    qapp.setLayoutDirection(Qt.LeftToRight)


def test_form_filled_from_delivery_note(qapp, admin, monkeypatch):
    """OCR fields go into the form, snapped to existing names; a new grade (B25) is kept and learnt."""
    from araco.services import customers, lookups
    from araco.ui import ticket_form
    from araco.ui.ticket_form import TicketForm

    i18n.set_language("en")
    cid = customers.create(admin, {"name": "Betabat sarl"}, sites=["Medyar"])
    other = customers.create(admin, {"name": "Someone else"})
    tickets.create(admin, {"ticket_no": "1", "date": "2026-10-01", "customer_id": other, "grade": "B300",
                           "quantity": 5, "truck_no": "M33", "driver": "Abdelrahman Krayt"})
    form = TicketForm(admin)
    form.show()
    form.apply_ocr_fields({"ticket_no": "26TS020562", "date": "2026-10-20", "time": "15:48", "quantity": 10.0,
                           "grade": "B25", "truck_no": "M33", "customer": "BETABAT SARL", "site": "MEDYAR",
                           "driver": "Abdelranman Krayt"})
    assert form.f_customer.value_data() == cid and form.f_site.value_text() == "Medyar"
    assert form.f_driver.value_text() == "Abdelrahman Krayt" and form.f_grade.currentText() == "B25"
    assert form.f_no.property("ocr") and "Customer" in form.ocr_note.text()
    form.f_price.setText("80")
    assert form.save()
    t = tickets.search(admin.db, {"text": "26TS020562"})[0]
    assert (t["customer_id"], t["site_name"], t["date"], t["time"], t["grade"], t["quantity"], t["total"]) == \
        (cid, "Medyar", "2026-10-20", "15:48", "B25", 10.0, 800.0)
    assert "B25" in lookups.values(admin.db, "grade")

    # an unknown customer is typed in; saving offers to create it with the address from the note
    created = {}

    def fake_dialog(ctx, parent=None, preset=None):
        created.update(preset)

        class D:
            customer_id = customers.create(ctx, preset)

            def exec(self):
                return 1
        return D()
    monkeypatch.setattr(ticket_form, "ask", lambda *a, **k: True)
    monkeypatch.setattr("araco.ui.customers.CustomerDialog", fake_dialog)
    form2 = TicketForm(admin)
    form2.apply_ocr_fields({"ticket_no": "26TS020563", "date": "2026-10-20", "quantity": 8.0, "grade": "B25",
                            "customer": "NOVA BUILD SARL", "address": "ACHRAFIEH SASSINE", "site": "CEDRUS"})
    assert form2.f_customer.value_data() is None and form2.f_customer.value_text() == "NOVA BUILD SARL"
    assert form2.save()
    assert created == {"name": "NOVA BUILD SARL", "address": "ACHRAFIEH SASSINE"}
    t = tickets.search(admin.db, {"text": "26TS020563"})[0]
    assert (t["customer_name"], t["site_name"]) == ("NOVA BUILD SARL", "CEDRUS")
    form._snapshot = form._state()
    form2._snapshot = form2._state()
