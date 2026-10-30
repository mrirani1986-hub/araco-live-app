"""SQLite connection, schema and text normalisation for Arabic/English search."""
import re
import sqlite3
from datetime import datetime
from pathlib import Path

from .auth import hash_password

SCHEMA_VERSION = 1

SCHEMA = """
CREATE TABLE IF NOT EXISTS users (
    id            INTEGER PRIMARY KEY,
    username      TEXT NOT NULL UNIQUE COLLATE NOCASE,
    full_name     TEXT NOT NULL DEFAULT '',
    password_hash TEXT NOT NULL,
    role          TEXT NOT NULL CHECK (role IN ('admin', 'data_entry')),
    active        INTEGER NOT NULL DEFAULT 1,
    created_at    TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS customers (
    id            INTEGER PRIMARY KEY,
    code          TEXT NOT NULL UNIQUE COLLATE NOCASE,
    name          TEXT NOT NULL,
    company       TEXT NOT NULL DEFAULT '',
    phone         TEXT NOT NULL DEFAULT '',
    phone2        TEXT NOT NULL DEFAULT '',
    address       TEXT NOT NULL DEFAULT '',
    area          TEXT NOT NULL DEFAULT '',
    payment_terms TEXT NOT NULL DEFAULT '',
    notes         TEXT NOT NULL DEFAULT '',
    created_at    TEXT NOT NULL,
    created_by    INTEGER REFERENCES users(id),
    updated_at    TEXT,
    updated_by    INTEGER REFERENCES users(id),
    deleted_at    TEXT,
    deleted_by    INTEGER REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS sites (
    id          INTEGER PRIMARY KEY,
    customer_id INTEGER NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
    name        TEXT NOT NULL,
    address     TEXT NOT NULL DEFAULT '',
    notes       TEXT NOT NULL DEFAULT '',
    created_at  TEXT NOT NULL,
    created_by  INTEGER REFERENCES users(id),
    deleted_at  TEXT,
    UNIQUE (customer_id, name)
);

CREATE TABLE IF NOT EXISTS tickets (
    id          INTEGER PRIMARY KEY,
    ticket_no   TEXT NOT NULL,
    date        TEXT NOT NULL,
    time        TEXT NOT NULL DEFAULT '',
    customer_id INTEGER NOT NULL REFERENCES customers(id),
    site_id     INTEGER REFERENCES sites(id),
    grade       TEXT NOT NULL,
    quantity    REAL NOT NULL CHECK (quantity > 0),
    truck_no    TEXT NOT NULL DEFAULT '',
    driver      TEXT NOT NULL DEFAULT '',
    pump_used   INTEGER NOT NULL DEFAULT 0,
    pump_no     TEXT NOT NULL DEFAULT '',
    plant       TEXT NOT NULL DEFAULT '',
    unit_price  REAL NOT NULL DEFAULT 0 CHECK (unit_price >= 0),
    total       REAL NOT NULL DEFAULT 0,
    status      TEXT NOT NULL DEFAULT 'delivered' CHECK (status IN ('delivered', 'cancelled')),
    notes       TEXT NOT NULL DEFAULT '',
    created_at  TEXT NOT NULL,
    created_by  INTEGER REFERENCES users(id),
    updated_at  TEXT,
    updated_by  INTEGER REFERENCES users(id),
    deleted_at  TEXT,
    deleted_by  INTEGER REFERENCES users(id)
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_tickets_no ON tickets(ticket_no) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS ix_tickets_date ON tickets(date);
CREATE INDEX IF NOT EXISTS ix_tickets_customer ON tickets(customer_id);

CREATE TABLE IF NOT EXISTS ticket_scans (
    id            INTEGER PRIMARY KEY,
    ticket_id     INTEGER NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
    file_path     TEXT NOT NULL,
    original_name TEXT NOT NULL DEFAULT '',
    ocr_text      TEXT NOT NULL DEFAULT '',
    created_at    TEXT NOT NULL,
    created_by    INTEGER REFERENCES users(id)
);
CREATE INDEX IF NOT EXISTS ix_scans_ticket ON ticket_scans(ticket_id);

CREATE TABLE IF NOT EXISTS lookups (
    id         INTEGER PRIMARY KEY,
    kind       TEXT NOT NULL CHECK (kind IN ('grade', 'plant', 'truck', 'driver')),
    value      TEXT NOT NULL,
    sort_order INTEGER NOT NULL DEFAULT 0,
    active     INTEGER NOT NULL DEFAULT 1,
    UNIQUE (kind, value)
);

CREATE TABLE IF NOT EXISTS settings (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS audit_log (
    id        INTEGER PRIMARY KEY,
    ts        TEXT NOT NULL,
    user_id   INTEGER,
    username  TEXT NOT NULL DEFAULT '',
    action    TEXT NOT NULL,
    entity    TEXT NOT NULL DEFAULT '',
    entity_id INTEGER,
    details   TEXT NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS ix_audit_entity ON audit_log(entity, entity_id);
"""

DEFAULT_GRADES = ["B150", "B200", "B250", "B300", "B350", "B400", "B450", "B500"]
DEFAULT_PLANTS = ["Plant 1", "Plant 2"]
DEFAULT_SETTINGS = {
    "language": "ar",
    "company_name": "ARACO Ready Mix",
    "currency": "$",
    "ocr_enabled": "1",
    "ocr_auto": "1",
    "tesseract_path": "",
    "ocr_languages": "eng+ara",
    "scan_dpi": "200",
    "scan_color": "1",
    "scan_show_ui": "0",
}

_ALEF = str.maketrans({"أ": "ا", "إ": "ا", "آ": "ا", "ٱ": "ا", "ة": "ه", "ى": "ي", "ؤ": "و", "ئ": "ي",
                       "٠": "0", "١": "1", "٢": "2", "٣": "3", "٤": "4",
                       "٥": "5", "٦": "6", "٧": "7", "٨": "8", "٩": "9",
                       "۰": "0", "۱": "1", "۲": "2", "۳": "3", "۴": "4",
                       "۵": "5", "۶": "6", "۷": "7", "۸": "8", "۹": "9"})
_TASHKEEL = re.compile(r"[ؐ-ًؚ-ٰٟـ]")


def norm(text) -> str:
    """Lowercase, unify Arabic letter forms, drop diacritics/tatweel, western digits."""
    if text is None:
        return ""
    return _TASHKEEL.sub("", str(text).translate(_ALEF)).lower().strip()


def digits(text) -> str:
    """Only the digits of a phone number, so '03 123 456' matches '03123456'."""
    return re.sub(r"\D", "", norm(text))


def now() -> str:
    return datetime.now().strftime("%Y-%m-%d %H:%M:%S")


class Database:
    def __init__(self, path: Path | str):
        self.path = Path(path)
        self.conn = self._connect()
        self.migrate()

    def _connect(self) -> sqlite3.Connection:
        conn = sqlite3.connect(str(self.path))
        conn.row_factory = sqlite3.Row
        conn.execute("PRAGMA foreign_keys = ON")
        conn.create_function("norm", 1, norm, deterministic=True)
        conn.create_function("digits", 1, digits, deterministic=True)
        return conn

    def close(self):
        self.conn.close()

    # --- helpers -----------------------------------------------------------------
    def query(self, sql: str, params=()) -> list[sqlite3.Row]:
        return self.conn.execute(sql, params).fetchall()

    def one(self, sql: str, params=()):
        return self.conn.execute(sql, params).fetchone()

    def scalar(self, sql: str, params=()):
        row = self.conn.execute(sql, params).fetchone()
        return row[0] if row else None

    def execute(self, sql: str, params=()) -> sqlite3.Cursor:
        return self.conn.execute(sql, params)

    # --- schema ------------------------------------------------------------------
    def migrate(self):
        version = self.scalar("PRAGMA user_version")
        if version < 1:
            with self.conn:
                self.conn.executescript(SCHEMA)
                self._seed_defaults()
                self.conn.execute(f"PRAGMA user_version = {SCHEMA_VERSION}")

    def _seed_defaults(self):
        ts = now()
        if not self.scalar("SELECT COUNT(*) FROM users"):
            self.conn.execute(
                "INSERT INTO users (username, full_name, password_hash, role, created_at) VALUES (?,?,?,?,?)",
                ("admin", "Administrator", hash_password("admin123"), "admin", ts))
            self.conn.execute(
                "INSERT INTO users (username, full_name, password_hash, role, created_at) VALUES (?,?,?,?,?)",
                ("entry", "Data Entry", hash_password("entry123"), "data_entry", ts))
        for i, grade in enumerate(DEFAULT_GRADES):
            self.conn.execute("INSERT OR IGNORE INTO lookups (kind, value, sort_order) VALUES ('grade', ?, ?)",
                              (grade, i))
        for i, plant in enumerate(DEFAULT_PLANTS):
            self.conn.execute("INSERT OR IGNORE INTO lookups (kind, value, sort_order) VALUES ('plant', ?, ?)",
                              (plant, i))
        for key, value in DEFAULT_SETTINGS.items():
            self.conn.execute("INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)", (key, value))
