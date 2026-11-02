"""OCR on ARACO's printed 'Delivery Journal' notes (blue ink on cyan paper, ruled table)."""
import pytest

from araco import ocr, seed

# What Tesseract returns for the three readings of a real note (names changed): whole page,
# rows at 2x, rows at 3x, plus the digits-only quantity cell.
PASSES = [
    "DELIVERY JOURNAL 1\nDELIVERY VOUCHER: 26TS020999 5 DATE: 20-10-2026\nCUSTOMER: NOVA BUILD SARL 3 DESTINATION:\n"
    "ADDRESS: ACHRAFIEH SASSINE =\nGEMMAYZEH BLG 2ND FLR 5 Project Name: CEDRUS\nCEMENT\nDOSAGE D. MAX\n"
    "(Kg/m3) 0 AGG. (mm) _|\nPurp Nos:\nSta Lgpding Ary at site Start 0 | Discharge Arrive at ple\n"
    "We will be responsible ... 30 minute from the time of delivery, or 6 minutes per cubic meter",
    "| DELIVERY VOUCHER: 26TS020999 o | DATE: 20-10-2026\n| = CUSTOMER: NOVA BUILD SARL * | DESTINATION:\n"
    "| ADDRESS: ACHRAFIEH SASSINE ~\nGEMMAYZEH BLG 2ND FLR 2 Project Name: CEDRUS\n"
    "i; 40 $| RMO B25 TYPE-1/5 | a | |\n"
    "| TRUCK MIXER N#*%@ M33 ‘ | Driver: he Kamal Haddad | Pump No#: :\n15:48 PM £",
    "DELIVERY VOUCHER: 2678020999 “al | DATE: 20-10-2026\nCUSTOMER: NOVA BUILD SARL\n"
    "10 | RMCB25TYPE-1/) | ia | , |\nTRUCK MIXER N#*~ M33 : Driver: Sad Kamal Haddad Pump No#: :\n15:48 PM",
    ocr.CELLS_PASS + "\nquantity: 10",
]


def test_fields_from_delivery_journal_text():
    fields = ocr.extract_fields(ocr.PASS_SEPARATOR.join(PASSES))
    assert fields == {"ticket_no": "26TS020999", "date": "2026-10-20", "time": "15:48", "quantity": 10.0,
                      "grade": "B25", "truck_no": "M33", "customer": "NOVA BUILD SARL", "site": "CEDRUS",
                      "driver": "Kamal Haddad", "address": "ACHRAFIEH SASSINE"}


def test_voting_without_the_cell_reading():
    # rows disagree on the quantity (40 vs 10) and the voucher; the earliest reading wins ties
    fields = ocr.extract_fields(ocr.PASS_SEPARATOR.join(PASSES[:3]))
    assert fields["ticket_no"] == "26TS020999" and fields["quantity"] == 40.0


def test_snap_to_known_names():
    assert ocr.snap("Abdelranman Krayt", ["Abdelrahman Krayt", "Tony Rizk"]) == "Abdelrahman Krayt"
    assert ocr.snap("BETABAT SARL", [("Betabat sarl", 5), ("Beta", 2)]) == ("Betabat sarl", 5)
    assert ocr.snap("احمد الخوري", ["أحمد الخوري"]) == "أحمد الخوري"
    assert ocr.snap("Someone New", ["Tony Rizk"]) is None


@pytest.mark.skipif(not ocr.find_tesseract(), reason="tesseract not installed")
@pytest.mark.parametrize("qty,cls,grade", [(8.5, "RMC B30 TYPE-1/J", "B30"), (10, "RMC B25 TYPE-1/J", "B25")])
def test_reads_a_drawn_delivery_journal(tmp_path, qty, cls, grade):
    path = seed.draw_delivery_journal(tmp_path / "dj.jpg", "26TS031744", "2026-10-28", "15:05",
                                      "CEDAR DEVELOPMENTS SARL", "DBAYEH MAIN ROAD", "SURSOCK LOFTS", qty, cls, "M17",
                                      "Tony Rizk", "P-2")
    fields = ocr.extract_fields(ocr.read_text(path, ocr.find_tesseract()))
    assert fields == {"ticket_no": "26TS031744", "date": "2026-10-28", "time": "15:05", "quantity": float(qty),
                      "grade": grade, "truck_no": "M17", "pump_no": "P-2", "customer": "CEDAR DEVELOPMENTS SARL",
                      "site": "SURSOCK LOFTS", "driver": "Tony Rizk", "address": "DBAYEH MAIN ROAD"}
