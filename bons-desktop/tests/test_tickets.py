import pytest

from araco.context import ValidationError
from araco.services import customers, lookups, reports, tickets


@pytest.fixture
def cust(admin):
    return customers.create(admin, {"name": "Client A"}, sites=["Tower"])


def base(cust, **kw):
    d = {"ticket_no": "1001", "date": "2026-10-01", "time": "08:30", "customer_id": cust, "grade": "B300",
         "quantity": "8", "unit_price": "75", "truck_no": "M-12", "driver": "Ali", "plant": "Plant 1"}
    d.update(kw)
    return d


def test_create_computes_total_and_learns_lookups(admin, cust):
    tid = tickets.create(admin, base(cust, site_name="New Site"))
    t = tickets.get(admin.db, tid)
    assert t["total"] == 600 and t["site_name"] == "New Site"
    assert "M-12" in lookups.values(admin.db, "truck") and "Ali" in lookups.values(admin.db, "driver")
    assert len(customers.sites(admin.db, cust)) == 2


def test_validation(admin, cust):
    with pytest.raises(ValidationError) as e:
        tickets.create(admin, base(cust, ticket_no="", quantity="0", date="2026-13-01", grade="", time="25:00"))
    errs = e.value.errors
    for key in ("err_ticket_no_required", "err_quantity_positive", "err_date_invalid", "err_grade_required",
                "err_time_invalid"):
        assert key in errs
    with pytest.raises(ValidationError):
        tickets.create(admin, base(cust, quantity="-3"))


def test_duplicate_flag_and_restore_conflict(admin, cust):
    first = tickets.create(admin, base(cust))
    assert tickets.is_duplicate(admin.db, "1001")
    assert not tickets.is_duplicate(admin.db, "1001", exclude_id=first)
    with pytest.raises(ValidationError) as e:
        tickets.create(admin, base(cust))
    assert e.value.errors[0][0] == "err_ticket_duplicate"
    tickets.soft_delete(admin, first)
    second = tickets.create(admin, base(cust))  # number is free again once deleted
    with pytest.raises(ValidationError):
        tickets.restore(admin, first)
    tickets.soft_delete(admin, second)
    tickets.restore(admin, first)


def test_search_filters_and_reports(admin, cust):
    other = customers.create(admin, {"name": "Client B"})
    tickets.create(admin, base(cust, ticket_no="1", date="2026-09-30", grade="B250", quantity=5))
    tickets.create(admin, base(cust, ticket_no="2", date="2026-10-01"))
    tickets.create(admin, base(other, ticket_no="3", date="2026-10-02", truck_no="M-7"))
    tickets.create(admin, base(other, ticket_no="4", date="2026-10-02", status="cancelled"))
    rows = tickets.search(admin.db, {"date_from": "2026-10-01", "date_to": "2026-10-31"})
    assert {r["ticket_no"] for r in rows} == {"2", "3", "4"}
    assert tickets.totals(rows) == {"count": 2, "cancelled": 1, "quantity": 16.0, "amount": 1200.0}
    assert [r["ticket_no"] for r in tickets.search(admin.db, {"truck_no": "M-7"})] == ["3"]
    by_month, total = reports.summary(admin.db, "month")
    assert [(r["key"], r["quantity"]) for r in by_month] == [("2026-09", 5.0), ("2026-10", 16.0)]
    assert total["count"] == 3 and total["amount"] == 1575.0
    by_grade, _ = reports.summary(admin.db, "grade", {"customer_id": cust})
    assert {r["key"]: r["count"] for r in by_grade} == {"B250": 1, "B300": 1}
    c = customers.get(admin.db, cust)
    assert c["ticket_count"] == 2 and c["total_m3"] == 13


def test_scan_is_copied_into_year_month(admin, cust, data_dir, tmp_path):
    img = tmp_path / "phone photo.jpg"
    img.write_bytes(b"fake")
    tid = tickets.create(admin, base(cust, date="2025-03-04"), scan_files=[img])
    s = tickets.scans(admin.db, tid)[0]
    assert s["file_path"].startswith("scans/2025/03/1001_")
    assert (data_dir / s["file_path"]).read_bytes() == b"fake"
    tickets.remove_scan(admin, s["id"])
    assert tickets.scans(admin.db, tid) == []
    tickets.soft_delete(admin, tid)
    tickets.purge(admin, tid)
    assert tickets.get(admin.db, tid) is None
