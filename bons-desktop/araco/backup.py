"""Automatic daily database backups, manual backups, full ZIP and restore."""
import sqlite3
import zipfile
from datetime import date, datetime
from pathlib import Path

from . import config

KEEP_DAILY = 30


def _copy_db(conn: sqlite3.Connection, dest: Path) -> Path:
    """Consistent copy using SQLite's online backup API (safe while the app is open)."""
    dest.parent.mkdir(parents=True, exist_ok=True)
    target = sqlite3.connect(str(dest))
    with target:
        conn.backup(target)
    target.close()
    return dest


def daily_backup(db, keep: int = KEEP_DAILY, today: date | None = None) -> Path | None:
    """Create today's backup if it does not exist yet, then keep only the newest `keep`."""
    today = today or date.today()
    dest = config.backups_dir() / f"auto_{today.isoformat()}.db"
    made = None
    if not dest.exists():
        made = _copy_db(db.conn, dest)
    prune(keep)
    return made


def prune(keep: int = KEEP_DAILY):
    autos = sorted(config.backups_dir().glob("auto_*.db"))
    for old in autos[:-keep] if keep else autos:
        old.unlink(missing_ok=True)


def backup_now(db, folder: Path | None = None) -> Path:
    name = f"manual_{datetime.now():%Y-%m-%d_%H%M%S}.db"
    return _copy_db(db.conn, Path(folder or config.backups_dir()) / name)


def full_zip(db, folder: Path) -> Path:
    """Database plus every scanned ticket, in one ZIP (for a USB stick / external disk)."""
    folder = Path(folder)
    stamp = f"{datetime.now():%Y-%m-%d_%H%M%S}"
    tmp = config.backups_dir() / f"_zip_{stamp}.db"
    _copy_db(db.conn, tmp)
    out = folder / f"ARACO_full_backup_{stamp}.zip"
    try:
        with zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED) as z:
            z.write(tmp, "database.db")
            scans = config.scans_dir()
            for f in scans.rglob("*"):
                if f.is_file() and "_inbox" not in f.parts:
                    z.write(f, (Path("scans") / f.relative_to(scans)).as_posix())
    finally:
        tmp.unlink(missing_ok=True)
    return out


def list_backups() -> list[dict]:
    out = []
    for f in sorted(config.backups_dir().glob("*.db"), key=lambda p: p.stat().st_mtime, reverse=True):
        st = f.stat()
        out.append({"name": f.name, "path": str(f), "size": st.st_size,
                    "modified": datetime.fromtimestamp(st.st_mtime).strftime("%Y-%m-%d %H:%M")})
    return out


def is_araco_db(path) -> bool:
    try:
        con = sqlite3.connect(f"file:{Path(path).as_posix()}?mode=ro", uri=True)
        try:
            names = {r[0] for r in con.execute("SELECT name FROM sqlite_master WHERE type = 'table'")}
        finally:
            con.close()
    except sqlite3.DatabaseError:
        return False
    return {"customers", "tickets", "users", "audit_log"} <= names


def restore(db, src) -> Path:
    """Replace the live database with a backup (a .db file, or a full-backup ZIP).

    The current database is saved first as prerestore_<time>.db. Scans inside a ZIP are
    extracted next to the existing ones (existing files are not overwritten).
    """
    src = Path(src)
    extracted = None
    if src.suffix.lower() == ".zip":
        extracted = config.backups_dir() / f"_restore_{datetime.now():%Y%m%d%H%M%S}.db"
        with zipfile.ZipFile(src) as z:
            with z.open("database.db") as fh:
                extracted.write_bytes(fh.read())
            for name in z.namelist():
                if name.startswith("scans/") and not name.endswith("/"):
                    target = config.data_dir() / name
                    if ".." in Path(name).parts or target.exists():
                        continue
                    target.parent.mkdir(parents=True, exist_ok=True)
                    target.write_bytes(z.read(name))
        src = extracted
    try:
        if not is_araco_db(src):
            raise ValueError("not an ARACO database")
        safety = _copy_db(db.conn, config.backups_dir() / f"prerestore_{datetime.now():%Y-%m-%d_%H%M%S}.db")
        source = sqlite3.connect(str(src))
        try:
            source.backup(db.conn)
        finally:
            source.close()
        db.migrate()
    finally:
        if extracted:
            extracted.unlink(missing_ok=True)
    return safety
