import pytest

from araco.context import NotAllowed, ValidationError
from araco.services import audit, customers


def test_auto_code_and_search_arabic(admin):
    a = customers.create(admin, {"name": "أحمد الخوري", "phone": "03 123 456", "area": "جونية"}, sites=["ورشة 1"])
    b = customers.create(admin, {"name": "Beirut Builders", "company": "BB sal"})
    assert customers.get(admin.db, a)["code"] == "C0001"
    assert customers.get(admin.db, b)["code"] == "C0002"
    # hamza / alef forms are ignored, phone matches without spaces
    assert [c["id"] for c in customers.search(admin.db, "احمد")] == [a]
    assert [c["id"] for c in customers.search(admin.db, "03123")] == [a]
    assert [c["id"] for c in customers.search(admin.db, "c0002")] == [b]
    assert customers.sites(admin.db, a)[0]["name"] == "ورشة 1"


def test_validation_and_duplicate_code(admin):
    with pytest.raises(ValidationError) as e:
        customers.create(admin, {"name": "  "})
    assert "err_name_required" in e.value.errors
    customers.create(admin, {"code": "X1", "name": "One"})
    with pytest.raises(ValidationError):
        customers.create(admin, {"code": "x1", "name": "Two"})


def test_update_writes_audit(admin):
    cid = customers.create(admin, {"name": "Old"})
    customers.update(admin, cid, {"name": "New", "phone": "70111222"})
    log = audit.search(admin.db, "customer", entity_id=cid)
    assert log[0]["action"] == "update" and '"New"' in log[0]["details"]
    assert customers.get(admin.db, cid)["updated_by"] == admin.user_id


def test_soft_delete_restore_and_roles(admin, entry):
    cid = customers.create(entry, {"name": "Entry made"})
    with pytest.raises(NotAllowed):
        customers.soft_delete(entry, cid)
    customers.soft_delete(admin, cid)
    assert customers.search(admin.db) == []
    assert [c["id"] for c in customers.search(admin.db, deleted=True)] == [cid]
    customers.restore(admin, cid)
    assert len(customers.search(admin.db)) == 1
