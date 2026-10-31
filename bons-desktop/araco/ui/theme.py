"""Fonts and style sheet: large readable text, sidebar navigation, ARACO orange accent."""
import sys

from PySide6.QtGui import QFont

NAVY = "#1F2A44"
ACCENT = "#E87722"

QSS = f"""
* {{ font-size: 15px; }}
QMainWindow, QDialog {{ background: #F4F6FA; }}
QWidget#page {{ background: #F4F6FA; }}

QFrame#sidebar {{ background: {NAVY}; }}
QFrame#sidebar QLabel {{ color: #DDE3EE; }}
QLabel#brand {{ color: white; font-size: 26px; font-weight: 800; letter-spacing: 2px; padding: 18px 8px 0 8px; }}
QLabel#brandSub {{ color: {ACCENT}; font-size: 13px; padding: 0 8px 14px 8px; }}
QPushButton#nav {{
    color: #DDE3EE; background: transparent; border: none; border-radius: 8px;
    text-align: left; padding: 11px 14px; font-size: 16px;
}}
QPushButton#nav:hover {{ background: #2C3A5C; }}
QPushButton#nav:checked {{ background: {ACCENT}; color: white; font-weight: 700; }}
QPushButton#sideSmall {{
    color: #DDE3EE; background: #2C3A5C; border: none; border-radius: 6px; padding: 7px 10px; font-size: 14px;
}}
QPushButton#sideSmall:hover {{ background: #3A4B73; }}
QLabel#userLabel {{ color: white; font-weight: 600; padding: 4px 8px; }}

QLabel#pageTitle {{ font-size: 24px; font-weight: 800; color: {NAVY}; padding: 4px 0 8px 0; }}
QLabel#sectionTitle {{ font-size: 17px; font-weight: 700; color: {NAVY}; padding: 6px 0; }}
QLabel#hint {{ color: #6B7280; font-size: 13px; }}
QLabel#totals {{ font-size: 16px; font-weight: 700; color: {NAVY}; padding: 6px 4px; }}
QLabel#dupFlag {{ color: #C62828; font-weight: 700; }}
QLabel#ocrNote {{ color: #8A5A00; background: #FFF4D6; border-radius: 6px; padding: 6px 10px; }}

QFrame#card {{ background: white; border: 1px solid #E3E7EF; border-radius: 12px; }}
QLabel#cardTitle {{ color: #6B7280; font-size: 14px; }}
QLabel#cardValue {{ font-size: 28px; font-weight: 800; }}
QLabel#cardSub {{ color: #6B7280; font-size: 13px; }}
QFrame#panel {{ background: white; border: 1px solid #E3E7EF; border-radius: 12px; }}

QPushButton {{
    background: white; border: 1px solid #C9D0DC; border-radius: 8px; padding: 8px 16px; color: #1F2937;
}}
QPushButton:hover {{ background: #F0F3F8; border-color: #9AA6BA; }}
QPushButton:disabled {{ color: #A0A7B4; background: #F3F4F6; }}
QPushButton#primary {{ background: {ACCENT}; color: white; border: none; font-weight: 700; }}
QPushButton#primary:hover {{ background: #D2691A; }}
QPushButton#danger {{ color: #B3261E; border-color: #E8B4B0; }}
QPushButton#danger:hover {{ background: #FDECEA; }}
QPushButton#iconButton {{ padding: 4px 10px; min-width: 28px; font-size: 17px; }}

QLineEdit, QComboBox, QDateEdit, QTimeEdit, QSpinBox, QDoubleSpinBox, QPlainTextEdit, QTextEdit {{
    background: white; border: 1px solid #C9D0DC; border-radius: 7px; padding: 6px 8px; min-height: 22px;
    selection-background-color: {ACCENT};
}}
QLineEdit:focus, QComboBox:focus, QDateEdit:focus, QPlainTextEdit:focus, QDoubleSpinBox:focus {{
    border: 2px solid {ACCENT};
}}
QLineEdit[invalid="true"], QComboBox[invalid="true"], QDateEdit[invalid="true"] {{
    border: 2px solid #D93025; background: #FDECEA;
}}
QLineEdit[ocr="true"], QDateEdit[ocr="true"], QComboBox[ocr="true"], QComboBox[ocr="true"] QLineEdit {{
    background: #FFF4D6;
}}
QLineEdit:read-only {{ background: #F3F4F6; }}

QTableView {{
    background: white; border: 1px solid #E3E7EF; border-radius: 10px; gridline-color: #EEF1F6;
    alternate-background-color: #F8FAFD; selection-background-color: #FCE4CC; selection-color: #111827;
}}
QHeaderView::section {{
    background: #EEF1F6; color: {NAVY}; font-weight: 700; border: none; border-bottom: 1px solid #DDE3EE;
    padding: 8px 6px;
}}
QTabWidget::pane {{ border: 1px solid #E3E7EF; border-radius: 10px; background: white; top: -1px; }}
QTabBar::tab {{ background: #E9ECF1; padding: 9px 18px; border-top-left-radius: 8px; border-top-right-radius: 8px;
               margin: 0 2px; }}
QTabBar::tab:selected {{ background: white; font-weight: 700; color: {NAVY}; }}
QGroupBox {{ font-weight: 700; color: {NAVY}; border: 1px solid #E3E7EF; border-radius: 10px; margin-top: 14px;
            padding: 12px 10px 10px 10px; background: white; }}
QGroupBox::title {{ subcontrol-origin: margin; left: 12px; right: 12px; padding: 0 4px; }}
QCheckBox {{ spacing: 8px; }}
QCheckBox::indicator {{ width: 20px; height: 20px; }}
QListWidget {{ background: white; border: 1px solid #C9D0DC; border-radius: 8px; }}
QToolTip {{ font-size: 14px; }}
"""


def app_font() -> QFont:
    family = "Segoe UI" if sys.platform == "win32" else "Noto Sans"
    f = QFont(family, 11)
    f.setStyleHint(QFont.SansSerif)
    return f


def apply(app):
    app.setStyle("Fusion")
    app.setFont(app_font())
    app.setStyleSheet(QSS)
