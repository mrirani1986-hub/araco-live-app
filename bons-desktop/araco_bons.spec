# PyInstaller spec: one-file, windowed ARACO_Bons.exe.   Build with:  pyinstaller araco_bons.spec
import sys

from PyInstaller.utils.hooks import collect_data_files, collect_submodules

datas = [("assets/araco.ico", "assets")]
datas += collect_data_files("arabic_reshaper")
datas += collect_data_files("reportlab")

hiddenimports = collect_submodules("araco")
if sys.platform == "win32":
    hiddenimports += ["win32com", "win32com.client", "pythoncom", "pywintypes"]

a = Analysis(
    ["main.py"],
    pathex=[],
    binaries=[],
    datas=datas,
    hiddenimports=hiddenimports,
    excludes=["tkinter", "matplotlib", "numpy", "pandas", "PySide6.QtWebEngineCore", "PySide6.QtWebEngineWidgets",
              "PySide6.Qt3DCore", "PySide6.QtQuick", "PySide6.QtQml", "PySide6.QtMultimedia"],
    noarchive=False,
)
pyz = PYZ(a.pure)
exe = EXE(
    pyz,
    a.scripts,
    a.binaries,
    a.datas,
    [],
    name="ARACO_Bons",
    icon="assets/araco.ico",
    console=False,
    upx=False,
    runtime_tmpdir=None,
)
