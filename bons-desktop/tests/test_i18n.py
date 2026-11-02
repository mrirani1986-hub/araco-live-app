import re
from pathlib import Path

from araco import i18n

ROOT = Path(__file__).resolve().parent.parent


def test_every_literal_key_is_translated():
    used = set()
    for f in list((ROOT / "araco").rglob("*.py")) + [ROOT / "main.py"]:
        text = f.read_text(encoding="utf-8")
        used |= set(re.findall(r"""\btr\(\s*["']([a-z0-9_]+)["']""", text))
        used |= set(re.findall(r"""["'](err_[a-z0-9_]+)["']""", text))
        used |= set(re.findall(r"""ScannerError\(\s*["']([a-z0-9_]+)["']""", text))
    missing = sorted(k for k in used if k not in i18n.STRINGS and not k.endswith("_"))  # "_" = prefix
    assert not missing, missing


def test_dynamic_keys():
    from araco.services import lookups, users, reports
    from araco.ui.tickets import PERIODS
    keys = ([f"role_{r}" for r in users.ROLES] + [f"list_{k}" for k in lookups.KINDS] + list(PERIODS)
            + [f"group_{g}" for g in reports.GROUPS] + [f"act_{a}" for a in i18n.ACTIONS]
            + [f"status_{s}" for s in ("delivered", "cancelled")])
    assert not [k for k in keys if k not in i18n.STRINGS]


def test_both_languages_present():
    for key, pair in i18n.STRINGS.items():
        assert len(pair) == 2 and all(pair), key
    i18n.set_language("en")
    assert i18n.tr("err_ticket_duplicate", no="77") == "Ticket no. 77 already exists"
    i18n.set_language("ar")
    assert i18n.is_rtl() and "77" in i18n.tr("err_ticket_duplicate", no="77")
