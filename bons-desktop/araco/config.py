"""Where the app keeps its data and bundled resources."""
import os
import sys
from pathlib import Path


def data_dir() -> Path:
    """C:\\ARACO_Data on Windows. ARACO_DATA_DIR overrides it (used by tests)."""
    env = os.environ.get("ARACO_DATA_DIR")
    if env:
        path = Path(env)
    elif sys.platform == "win32":
        path = Path(r"C:\ARACO_Data")
    else:
        path = Path.home() / "ARACO_Data"
    for sub in ("scans", "backups"):
        (path / sub).mkdir(parents=True, exist_ok=True)
    return path


def db_path() -> Path:
    return data_dir() / "database.db"


def scans_dir() -> Path:
    return data_dir() / "scans"


def backups_dir() -> Path:
    return data_dir() / "backups"


def inbox_dir() -> Path:
    """Scans that are not yet linked to a saved ticket."""
    path = scans_dir() / "_inbox"
    path.mkdir(parents=True, exist_ok=True)
    return path


def resource_path(rel: str) -> Path:
    """Path to a bundled file, both from source and inside the PyInstaller .exe."""
    base = getattr(sys, "_MEIPASS", None)
    root = Path(base) if base else Path(__file__).resolve().parent.parent
    return root / rel
