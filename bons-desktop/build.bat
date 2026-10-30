@echo off
REM Build dist\ARACO_Bons.exe on Windows (Python 3.11+ must be installed and on PATH).
cd /d "%~dp0"
if not exist .venv (
    py -3 -m venv .venv || python -m venv .venv
)
call .venv\Scripts\activate.bat
python -m pip install --upgrade pip
pip install -r requirements-dev.txt || goto :error
set QT_QPA_PLATFORM=offscreen
python -m pytest -q tests || goto :error
set QT_QPA_PLATFORM=
pyinstaller --noconfirm --clean araco_bons.spec || goto :error
dist\ARACO_Bons.exe --selftest "%TEMP%\araco_selftest"
type "%TEMP%\araco_selftest\selftest.txt"
echo.
echo Done: dist\ARACO_Bons.exe
goto :eof
:error
echo Build failed.
exit /b 1
