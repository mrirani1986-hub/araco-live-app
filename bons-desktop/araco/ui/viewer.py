"""Full-size viewer for the scans of a ticket."""
from PySide6.QtCore import Qt
from PySide6.QtWidgets import QDialog, QHBoxLayout, QPushButton, QVBoxLayout

from .. import exporter
from ..i18n import tr
from ..services import tickets
from .widgets import ImageViewer


class ScanViewerDialog(QDialog):
    def __init__(self, db, ticket_id, parent=None):
        super().__init__(parent)
        t = tickets.get(db, ticket_id)
        self.setWindowTitle(f"{tr('ticket')} {t['ticket_no']} — {t['customer_name']}")
        self.setWindowFlag(Qt.WindowMaximizeButtonHint, True)
        self.resize(1000, 900)
        self.viewer = ImageViewer(self)
        self.viewer.set_files([s["abs_path"] for s in tickets.scans(db, ticket_id)])
        b_open = QPushButton(tr("open_external"))
        b_open.clicked.connect(lambda: self.viewer.current_file() and exporter.open_file(self.viewer.current_file()))
        b_close = QPushButton(tr("close"))
        b_close.clicked.connect(self.accept)
        bar = QHBoxLayout()
        bar.addStretch()
        bar.addWidget(b_open)
        bar.addWidget(b_close)
        lay = QVBoxLayout(self)
        lay.addWidget(self.viewer, 1)
        lay.addLayout(bar)
