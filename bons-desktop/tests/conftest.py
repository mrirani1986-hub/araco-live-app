import os
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
os.environ.setdefault("QT_QPA_PLATFORM", "offscreen")

from araco.context import Ctx  # noqa: E402
from araco.db import Database  # noqa: E402
from araco.services import users  # noqa: E402


@pytest.fixture
def data_dir(tmp_path, monkeypatch):
    monkeypatch.setenv("ARACO_DATA_DIR", str(tmp_path / "ARACO_Data"))
    from araco import config
    return config.data_dir()


@pytest.fixture
def db(data_dir):
    database = Database(data_dir / "database.db")
    yield database
    database.close()


@pytest.fixture
def admin(db):
    return Ctx(db, users.authenticate(db, "admin", "admin123"))


@pytest.fixture
def entry(db):
    return Ctx(db, users.authenticate(db, "entry", "entry123"))
