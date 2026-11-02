from datetime import datetime

import pytest
from openpyxl import Workbook

from araco import importer
from araco.context import NotAllowed, ValidationError
from araco.services import audit, customers, lookups, reports, tickets


def sheet(tmp_path, header, rows, name="old_tickets.xlsx"):
    wb = Workbook()
    ws = wb.active
    ws.append(header)
    for r in rows:
        ws.append(r)
    path = tmp_path / name
    wb.save(path)
    return importer.read_table(path)


HEADER = ["رقم البون", "التاريخ", "الوقت", "الزبون", "الموقع", "صنف الباطون", "الكمية م³", "سعر المتر", "المجموع",
          "رقم الخلاطة", "السائق", "مضخة", "المجبل", "الحالة", "ملاحظات"]


def test_import_messy_historical_sheet(admin, tmp_path):
    existing = customers.create(admin, {"name": "أحمد الخوري"}, sites=["بناية الجميزة"])
    tickets.create(admin, {"ticket_no": "1003", "date": "2025-01-01", "customer_id": existing, "grade": "B250",
                           "quantity": 5})
    header, rows = sheet(tmp_path, HEADER, [
        # real Excel date cell, existing customer written with a different alef, existing site
        [1001, datetime(2025, 3, 4), "7:30", "احمد الخوري", "بناية الجميزة", "b 300", 8, "$75", None, "M-12",
         "Ali", "نعم", "Plant 1", "", ""],
        # text date d/m/y, new customer + new site, price from total, pump number, thousands separator
        ["1002", "05/03/2025", "", "Rami Saad", "Byblos Tower", "250", "10", "", "1,200.00", "M-14", "Tony",
         "P-2", "Plant 2", "", "old"],
        ["1003", "06/03/2025", "", "Rami Saad", "", "B300", 6, 70, None, "", "", "", "", "", ""],  # exists in DB
        ["1004", "07/03/2025", "", "Rami Saad", "", "B300", 6, 70, None, "", "", "", "", "ملغى", ""],  # cancelled
        ["1004", "07/03/2025", "", "Rami Saad", "", "B300", 6, 70, None, "", "", "", "", "", ""],  # repeated
        ["1005", "31/02/2025", "", "Rami Saad", "", "B300", 6, 70, None, "", "", "", "", "", ""],  # bad date
        ["1006", "08/03/2025", "", "Rami Saad", "", "B300", -2, 70, None, "", "", "", "", "", ""],  # bad qty
        ["", "", "", "", "", "", "", "", "", "", "", "", "", "", ""],  # blank line is ignored
    ])
    mapping = importer.guess_ticket_mapping(header)
    assert mapping == {"ticket_no": 0, "date": 1, "time": 2, "customer": 3, "site": 4, "grade": 5, "quantity": 6,
                       "unit_price": 7, "total": 8, "truck_no": 9, "driver": 10, "pump": 11, "plant": 12,
                       "status": 13, "notes": 14}

    check = importer.import_tickets(admin, rows, mapping, dry_run=True)
    assert check["created"] == 3 and tickets.search(admin.db, {"date_from": "2025-03-01"}) == []
    assert customers.find_by_code(admin.db, "C0002") is None  # dry run created nothing

    stats = importer.import_tickets(admin, rows, mapping)
    assert (stats["created"], stats["customers_created"], stats["sites_created"]) == (3, 1, 1)
    assert stats["duplicates"] == [(4, "1003"), (6, "1004")]
    assert [line for line, _ in stats["errors"]] == [7, 8]
    assert "err_date_invalid" in stats["errors"][0][1] and "err_quantity_positive" in stats["errors"][1][1]
    assert (stats["date_from"], stats["date_to"]) == ("2025-03-04", "2025-03-07")

    t1 = tickets.search(admin.db, {"text": "1001"})[0]
    assert (t1["customer_id"], t1["site_name"], t1["grade"], t1["date"], t1["time"], t1["total"], t1["pump_used"]) == \
        (existing, "بناية الجميزة", "B300", "2025-03-04", "07:30", 600.0, 1)
    t2 = tickets.search(admin.db, {"text": "1002"})[0]
    assert (t2["customer_name"], t2["site_name"], t2["grade"], t2["unit_price"], t2["total"], t2["pump_no"]) == \
        ("Rami Saad", "Byblos Tower", "B250", 120.0, 1200.0, "P-2")
    assert tickets.search(admin.db, {"text": "1004"})[0]["status"] == "cancelled"
    _, total = reports.summary(admin.db, "month", {"date_from": "2025-03-01", "date_to": "2025-03-31"})
    assert (total["count"], total["quantity"], total["amount"]) == (2, 18.0, 1800.0)
    assert "Plant 2" in lookups.values(admin.db, "plant")
    log = audit.search(admin.db, "ticket")[0]
    assert log["action"] == "import" and '"created": 3' in log["details"]


def test_month_first_dates_codes_and_no_auto_customers(admin, tmp_path):
    customers.create(admin, {"code": "K-7", "name": "Samir"})
    header, rows = sheet(tmp_path, ["Bon No", "Delivery Date", "Customer Code", "Customer", "Grade", "Qty", "Price"], [
        ["7001", "03/15/2025", "K-7", "", "B350", "7,5", "80"],
        ["7002", "03/16/2025", "", "Unknown Co", "B350", "4", "80"],
        ["7003", "45736", "k-7", "", "B350", "4", "80"],  # Excel serial day in a CSV-like cell
    ])
    mapping = importer.guess_ticket_mapping(header)
    assert {"ticket_no", "date", "customer_code", "customer", "grade", "quantity", "unit_price"} <= set(mapping)
    stats = importer.import_tickets(admin, rows, mapping, day_first=False, create_customers=False)
    assert stats["created"] == 2 and stats["customers_created"] == 0
    assert stats["errors"] == [(3, [("err_customer_not_found", {"name": "Unknown Co"})])]
    t = tickets.search(admin.db, {"text": "7001"})[0]
    assert (t["date"], t["quantity"], t["total"], t["customer_name"]) == ("2025-03-15", 7.5, 600.0, "Samir")
    assert tickets.search(admin.db, {"text": "7003"})[0]["date"] == "2025-03-20"


def test_import_requires_admin_and_mapping(admin, entry):
    with pytest.raises(NotAllowed):
        importer.import_tickets(entry, [], {"ticket_no": 0})
    with pytest.raises(ValidationError):
        importer.import_tickets(admin, [], {"ticket_no": 0, "date": 1})


def test_template_round_trip(admin, tmp_path):
    from araco import i18n
    for lang in ("ar", "en"):
        i18n.set_language(lang)
        path = importer.write_template(tmp_path / f"t_{lang}.xlsx", "tickets")
        header, rows = importer.read_table(path)
        mapping = importer.guess_ticket_mapping(header)
        assert set(mapping) == set(importer.TICKET_TARGETS) - {"pump"}, (lang, header, mapping)
        cpath = importer.write_template(tmp_path / f"c_{lang}.xlsx", "customers")
        ch, _ = importer.read_table(cpath)
        assert set(importer.guess_mapping(ch)) == set(importer.TARGETS), (lang, ch)
    stats = importer.import_tickets(admin, rows, mapping)
    assert stats["created"] == 1 and stats["errors"] == []


def test_parsers():
    assert importer.parse_date("2026-10-05 00:00") == "2026-10-05"
    assert importer.parse_date("5.10.26") == "2026-10-05"
    assert importer.parse_date("13/10/2026", day_first=False) == "2026-10-13"  # obviously day first
    assert importer.parse_date("٠٥/١٠/٢٠٢٦") == "2026-10-05"
    assert importer.parse_date("garbage") is None
    assert importer.parse_time("2:15 PM") == "14:15" and importer.parse_time("") == ""
    assert importer.parse_number("1,250.50") == 1250.5 and importer.parse_number("7,5") == 7.5
    assert importer.parse_number("1,250") == 1250.0 and importer.parse_number("abc") == "invalid"
    assert importer.normalize_grade(" b 400 ") == "B400" and importer.normalize_grade("300") == "B300"
