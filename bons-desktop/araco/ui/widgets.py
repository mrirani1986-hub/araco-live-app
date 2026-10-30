"""Shared widgets: table model/view, Arabic-aware autocomplete, image viewer, dialogs helpers."""
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path

from PySide6.QtCore import (QAbstractTableModel, QModelIndex, QObject, QEvent, QSortFilterProxyModel, QStandardPaths,
                            Qt, QThread, Signal)
from PySide6.QtGui import QColor, QImage, QPainter, QPixmap, QStandardItem, QStandardItemModel
from PySide6.QtWidgets import (QAbstractItemView, QComboBox, QCompleter, QFileDialog, QFrame, QGraphicsPixmapItem,
                               QGraphicsScene, QGraphicsView, QHBoxLayout, QHeaderView, QLabel, QMessageBox,
                               QPushButton, QSizePolicy, QTableView, QVBoxLayout, QWidget)

from .. import exporter
from ..db import norm
from ..i18n import is_rtl, tr, tr_error, tr_status

CURRENCY = {"symbol": "$"}


# --- formatting ------------------------------------------------------------------------

def fmt_num(v, decimals: int = 2) -> str:
    if v is None or v == "":
        return ""
    s = f"{float(v):,.{decimals}f}"
    return s.rstrip("0").rstrip(".") if "." in s else s


def fmt_money(v) -> str:
    if v is None or v == "":
        return ""
    return f"{CURRENCY['symbol']}{float(v):,.2f}"


def fmt_date(iso) -> str:
    if not iso:
        return ""
    s = str(iso)
    if len(s) >= 10 and s[4] == "-":
        rest = s[10:]
        return f"{s[8:10]}/{s[5:7]}/{s[:4]}{rest}"
    if len(s) == 7 and s[4] == "-":  # month
        return f"{s[5:7]}/{s[:4]}"
    return s


@dataclass
class Col:
    key: str
    title: str  # i18n key
    kind: str = "text"  # text | num | money | date | status | bool | int
    width: int = 0


class RowsModel(QAbstractTableModel):
    """Table model over a list of dicts."""

    def __init__(self, columns: list[Col], parent=None):
        super().__init__(parent)
        self.columns = columns
        self.rows: list[dict] = []

    def set_rows(self, rows):
        self.beginResetModel()
        self.rows = list(rows)
        self.endResetModel()

    def rowCount(self, parent=QModelIndex()):
        return 0 if parent.isValid() else len(self.rows)

    def columnCount(self, parent=QModelIndex()):
        return 0 if parent.isValid() else len(self.columns)

    def headerData(self, section, orientation, role=Qt.DisplayRole):
        if orientation == Qt.Horizontal and role == Qt.DisplayRole:
            return tr(self.columns[section].title)
        return None

    def display(self, row: dict, col: Col):
        v = row.get(col.key)
        if col.kind == "num":
            return fmt_num(v)
        if col.kind == "money":
            return fmt_money(v)
        if col.kind == "date":
            return fmt_date(v)
        if col.kind == "status":
            return tr_status(v)
        if col.kind == "bool":
            return "✔" if v else ""
        if col.kind == "int":
            return "" if v in (None, "") else str(int(v))
        return "" if v is None else str(v)

    def data(self, index, role=Qt.DisplayRole):
        if not index.isValid():
            return None
        row, col = self.rows[index.row()], self.columns[index.column()]
        if role == Qt.DisplayRole:
            return self.display(row, col)
        if role == Qt.UserRole:  # sort key
            v = row.get(col.key)
            if col.kind in ("num", "money", "int", "bool"):
                return float(v or 0)
            return norm(v)
        if role == Qt.TextAlignmentRole and col.kind in ("num", "money", "int"):
            return int(Qt.AlignVCenter | (Qt.AlignLeft if is_rtl() else Qt.AlignRight))
        if role == Qt.ForegroundRole:
            if row.get("status") == "cancelled":
                return QColor("#9AA0A6")
            if col.kind == "status" and row.get("status") == "delivered":
                return QColor("#1E8E3E")
        return None

    def export_values(self, row: dict, col: Col):
        """Raw numbers for Excel, display text for everything else."""
        if col.kind in ("num", "money", "int"):
            v = row.get(col.key)
            return None if v in (None, "") else float(v)
        return self.display(row, col)


class DataTable(QTableView):
    activated_row = Signal(dict)

    def __init__(self, columns: list[Col], parent=None):
        super().__init__(parent)
        self.model_ = RowsModel(columns, self)
        self.proxy = QSortFilterProxyModel(self)
        self.proxy.setSourceModel(self.model_)
        self.proxy.setSortRole(Qt.UserRole)
        self.setModel(self.proxy)
        self.setSortingEnabled(True)
        self.setSelectionBehavior(QAbstractItemView.SelectRows)
        self.setSelectionMode(QAbstractItemView.ExtendedSelection)
        self.setEditTriggers(QAbstractItemView.NoEditTriggers)
        self.setAlternatingRowColors(True)
        self.verticalHeader().setVisible(False)
        self.verticalHeader().setDefaultSectionSize(34)
        h = self.horizontalHeader()
        h.setSectionResizeMode(QHeaderView.Interactive)
        h.setStretchLastSection(True)
        h.setHighlightSections(False)
        self.doubleClicked.connect(self._double)
        self.sortByColumn(-1, Qt.AscendingOrder)

    def set_rows(self, rows):
        self.model_.set_rows(rows)
        for i, col in enumerate(self.model_.columns):
            if col.width:
                self.setColumnWidth(i, col.width)
        if not any(c.width for c in self.model_.columns):
            self.resizeColumnsToContents()

    def _double(self, index):
        row = self.row_at(index)
        if row is not None:
            self.activated_row.emit(row)

    def row_at(self, proxy_index):
        if not proxy_index.isValid():
            return None
        return self.model_.rows[self.proxy.mapToSource(proxy_index).row()]

    def selected_row(self):
        idx = self.selectionModel().selectedRows()
        return self.row_at(idx[0]) if idx else None

    def selected_rows(self):
        return [self.row_at(i) for i in self.selectionModel().selectedRows()]

    def visible_rows(self):
        return [self.model_.rows[self.proxy.mapToSource(self.proxy.index(r, 0)).row()]
                for r in range(self.proxy.rowCount())]

    def export_data(self):
        cols = self.model_.columns
        headers = [tr(c.title) for c in cols]
        rows = [[self.model_.export_values(r, c) for c in cols] for r in self.visible_rows()]
        return headers, rows

    def keyPressEvent(self, e):
        if e.key() in (Qt.Key_Return, Qt.Key_Enter):
            row = self.selected_row()
            if row is not None:
                self.activated_row.emit(row)
                return
        super().keyPressEvent(e)


# --- autocomplete ---------------------------------------------------------------------

class NormCompleter(QCompleter):
    """Contains-matching that ignores Arabic hamza/alef forms and case."""
    NORM_ROLE = Qt.UserRole + 50

    def __init__(self, parent=None):
        super().__init__(parent)
        self.source = QStandardItemModel(self)
        self.setModel(self.source)
        self.setCompletionRole(self.NORM_ROLE)
        self.setFilterMode(Qt.MatchContains)
        self.setCaseSensitivity(Qt.CaseInsensitive)
        self.setCompletionMode(QCompleter.PopupCompletion)
        self.setMaxVisibleItems(12)

    def set_texts(self, texts):
        self.source.clear()
        for t in texts:
            item = QStandardItem(t)
            item.setData(norm(t), self.NORM_ROLE)
            self.source.appendRow(item)

    def splitPath(self, path):
        return [norm(path)]

    def pathFromIndex(self, index):
        return index.data(Qt.DisplayRole)


class SearchCombo(QComboBox):
    """Editable combo with type-to-search; free text allowed unless the caller checks value_data()."""

    def __init__(self, parent=None, placeholder: str = ""):
        super().__init__(parent)
        self.setEditable(True)
        self.setInsertPolicy(QComboBox.NoInsert)
        self.setMaxVisibleItems(15)
        self.setSizeAdjustPolicy(QComboBox.AdjustToMinimumContentsLengthWithIcon)
        self.setMinimumContentsLength(12)
        self.norm_completer = NormCompleter(self)
        self.setCompleter(self.norm_completer)
        if placeholder:
            self.lineEdit().setPlaceholderText(placeholder)

    def set_items(self, items, keep_text: bool = True):
        """items: list of str or (text, data)."""
        text = self.currentText()
        self.blockSignals(True)
        self.clear()
        texts = []
        for it in items:
            t, d = (it, it) if isinstance(it, str) else it
            self.addItem(t, d)
            texts.append(t)
        self.norm_completer.set_texts(texts)
        self.setCurrentIndex(-1)
        self.setEditText(text if keep_text else "")
        self.blockSignals(False)

    def value_text(self) -> str:
        return self.currentText().strip()

    def value_data(self):
        idx = self.findText(self.value_text(), Qt.MatchFixedString)
        return self.itemData(idx) if idx >= 0 else None

    def set_data_value(self, data):
        idx = self.findData(data)
        self.setCurrentIndex(idx)
        if idx < 0:
            self.setEditText("")

    def set_text(self, text):
        idx = self.findText(text or "", Qt.MatchFixedString)
        if idx >= 0:
            self.setCurrentIndex(idx)
        else:
            self.setCurrentIndex(-1)
            self.setEditText(text or "")


class EnterNavigator(QObject):
    """Enter/Return moves to the next field; on the last field it calls `on_last`."""

    def __init__(self, fields: list, on_last, parent=None):
        super().__init__(parent)
        self.fields = fields
        self.on_last = on_last
        self._owners = {}
        for f in fields:
            self._watch(f, f)
            for child in f.findChildren(QWidget):
                self._watch(child, f)

    def _watch(self, w, owner):
        w.installEventFilter(self)
        self._owners[w] = owner

    def eventFilter(self, obj, event):
        if event.type() == QEvent.KeyPress and event.key() in (Qt.Key_Return, Qt.Key_Enter) \
                and not event.modifiers() & (Qt.ControlModifier | Qt.ShiftModifier):
            owner = self._owners.get(obj)
            if owner is None:
                return False
            visible = [f for f in self.fields if f.isEnabled() and f.isVisible()]
            if owner not in visible:
                return False
            i = visible.index(owner)
            if i == len(visible) - 1:
                self.on_last()
            else:
                nxt = visible[i + 1]
                nxt.setFocus(Qt.TabFocusReason)
                le = getattr(nxt, "lineEdit", None)
                if callable(le) and le():
                    le().selectAll()
                elif hasattr(nxt, "selectAll"):
                    nxt.selectAll()
            return True
        return False


# --- image viewer ---------------------------------------------------------------------

def pil_to_qimage(im) -> QImage:
    im = im.convert("RGBA")
    data = im.tobytes("raw", "RGBA")
    return QImage(data, im.width, im.height, im.width * 4, QImage.Format_RGBA8888).copy()


class ImageView(QGraphicsView):
    def __init__(self, parent=None):
        super().__init__(parent)
        self.setScene(QGraphicsScene(self))
        self.item = QGraphicsPixmapItem()
        self.item.setTransformationMode(Qt.SmoothTransformation)
        self.scene().addItem(self.item)
        self.setRenderHints(QPainter.Antialiasing | QPainter.SmoothPixmapTransform)
        self.setDragMode(QGraphicsView.ScrollHandDrag)
        self.setTransformationAnchor(QGraphicsView.AnchorUnderMouse)
        self.setBackgroundBrush(QColor("#E9ECF1"))
        self.setFrameShape(QFrame.NoFrame)
        self.placeholder = ""
        self.auto_fit = True
        self.setLayoutDirection(Qt.LeftToRight)

    def set_pixmap(self, pix: QPixmap | None):
        self.item.setPixmap(pix or QPixmap())
        self.item.setRotation(0)
        self.scene().setSceneRect(self.item.sceneBoundingRect())
        self.auto_fit = True
        self.fit()

    def fit(self):
        if not self.item.pixmap().isNull():
            self.scene().setSceneRect(self.item.sceneBoundingRect())
            self.fitInView(self.item, Qt.KeepAspectRatio)
            self.auto_fit = True

    def zoom(self, factor: float):
        self.auto_fit = False
        self.scale(factor, factor)

    def rotate_image(self):
        self.item.setTransformOriginPoint(self.item.boundingRect().center())
        self.item.setRotation((self.item.rotation() + 90) % 360)
        self.fit()

    def wheelEvent(self, e):
        self.zoom(1.2 if e.angleDelta().y() > 0 else 1 / 1.2)

    def resizeEvent(self, e):
        super().resizeEvent(e)
        if self.auto_fit:
            self.fit()

    def drawForeground(self, painter, rect):
        if self.item.pixmap().isNull() and self.placeholder:
            painter.save()
            painter.resetTransform()
            painter.setPen(QColor("#6B7280"))
            f = painter.font()
            f.setPointSize(13)
            painter.setFont(f)
            painter.drawText(self.viewport().rect(), Qt.AlignCenter, self.placeholder)
            painter.restore()


class ImageViewer(QWidget):
    """Zoomable viewer for one or more image/PDF files, with page navigation."""

    def __init__(self, parent=None, compact: bool = False):
        super().__init__(parent)
        self.pages: list[tuple[str, QImage]] = []
        self.index = 0
        self.view = ImageView(self)
        self.view.placeholder = tr("no_image")
        bar = QHBoxLayout()
        bar.setContentsMargins(0, 0, 0, 0)
        self.btn_prev = QPushButton("◀" if not is_rtl() else "▶")
        self.btn_next = QPushButton("▶" if not is_rtl() else "◀")
        self.page_label = QLabel("")
        self.btn_prev.clicked.connect(lambda: self.show_page(self.index - 1))
        self.btn_next.clicked.connect(lambda: self.show_page(self.index + 1))
        buttons = [("zoom_in", "+", lambda: self.view.zoom(1.25)), ("zoom_out", "−", lambda: self.view.zoom(0.8)),
                   ("fit", "⤢", self.view.fit), ("rotate", "⟳", self.view.rotate_image)]
        for key, label, fn in buttons:
            b = QPushButton(label)
            b.setToolTip(tr(key))
            b.setObjectName("iconButton")
            b.clicked.connect(fn)
            bar.addWidget(b)
        bar.addStretch()
        bar.addWidget(self.btn_prev)
        bar.addWidget(self.page_label)
        bar.addWidget(self.btn_next)
        lay = QVBoxLayout(self)
        lay.setContentsMargins(0, 0, 0, 0)
        lay.addLayout(bar)
        lay.addWidget(self.view, 1)
        self._update_nav()

    def set_files(self, paths):
        from ..media import load_pages
        self.pages = []
        for p in paths:
            try:
                for im in load_pages(p, scale=2.0):
                    self.pages.append((str(p), pil_to_qimage(im)))
            except Exception as e:  # noqa: BLE001 - a broken file must not break the form
                self.pages.append((str(p), QImage()))
                self.view.placeholder = f"{Path(p).name}\n{e}"
        self.index = 0
        self.show_page(0)

    def clear(self):
        self.set_files([])

    def current_file(self):
        return self.pages[self.index][0] if self.pages else None

    def show_page(self, i):
        if not self.pages:
            self.view.placeholder = tr("no_image")
            self.view.set_pixmap(None)
        else:
            self.index = max(0, min(i, len(self.pages) - 1))
            self.view.set_pixmap(QPixmap.fromImage(self.pages[self.index][1]))
        self._update_nav()

    def _update_nav(self):
        n = len(self.pages)
        self.page_label.setText(tr("page_of", i=self.index + 1, n=n) if n > 1 else "")
        self.btn_prev.setVisible(n > 1)
        self.btn_next.setVisible(n > 1)
        self.btn_prev.setEnabled(self.index > 0)
        self.btn_next.setEnabled(self.index < n - 1)


# --- small helpers --------------------------------------------------------------------

class Worker(QThread):
    """Run a function off the UI thread; emits done(result) or failed(exception)."""
    done = Signal(object)
    failed = Signal(object)

    def __init__(self, fn, *args, parent=None):
        super().__init__(parent)
        self.fn, self.args = fn, args

    def run(self):
        try:
            self.done.emit(self.fn(*self.args))
        except Exception as e:  # noqa: BLE001
            self.failed.emit(e)


def card(title: str, value: str = "", sub: str = "", accent: str = "#E87722") -> QFrame:
    f = QFrame()
    f.setObjectName("card")
    f.setSizePolicy(QSizePolicy.Expanding, QSizePolicy.Fixed)
    lay = QVBoxLayout(f)
    lay.setContentsMargins(18, 14, 18, 14)
    t = QLabel(title)
    t.setObjectName("cardTitle")
    v = QLabel(value)
    v.setObjectName("cardValue")
    v.setStyleSheet(f"color: {accent};")
    s = QLabel(sub)
    s.setObjectName("cardSub")
    for w in (t, v, s):
        lay.addWidget(w)
    f.value_label, f.sub_label = v, s
    return f


def page_title(text: str) -> QLabel:
    lbl = QLabel(text)
    lbl.setObjectName("pageTitle")
    return lbl


def info(parent, text: str, title: str = ""):
    QMessageBox.information(parent, title or tr("info"), text)


def warn(parent, text: str, title: str = ""):
    QMessageBox.warning(parent, title or tr("warning"), text)


def ask(parent, text: str, title: str = "") -> bool:
    box = QMessageBox(QMessageBox.Question, title or tr("confirm"), text, parent=parent)
    yes = box.addButton(tr("yes"), QMessageBox.YesRole)
    box.addButton(tr("no"), QMessageBox.NoRole)
    box.exec()
    return box.clickedButton() is yes


def show_errors(parent, errors):
    text = tr("fix_errors") + "\n\n" + "\n".join("• " + tr_error(e) for e in errors)
    QMessageBox.warning(parent, tr("error"), text)


def documents_dir() -> str:
    return QStandardPaths.writableLocation(QStandardPaths.DocumentsLocation) or str(Path.home())


def export_table(parent, title: str, headers, rows, totals=None, kind: str = "xlsx", subtitle: str = "",
                 company: str = ""):
    stamp = datetime.now().strftime("%Y-%m-%d_%H%M")
    safe = "".join(ch if ch.isalnum() or ch in " _-" else "_" for ch in title).strip() or "export"
    default = str(Path(documents_dir()) / f"{safe}_{stamp}.{kind}")
    flt = "Excel (*.xlsx)" if kind == "xlsx" else "PDF (*.pdf)"
    path, _ = QFileDialog.getSaveFileName(parent, tr("export_excel" if kind == "xlsx" else "export_pdf"), default, flt)
    if not path:
        return None
    if not path.lower().endswith("." + kind):
        path += "." + kind
    try:
        if kind == "xlsx":
            exporter.export_xlsx(path, title, headers, rows, totals=totals, rtl=is_rtl(), subtitle=subtitle)
        else:
            exporter.export_pdf(path, title, headers, rows, totals=totals, rtl=is_rtl(), subtitle=subtitle,
                                company=company or tr("company"))
    except PermissionError:
        warn(parent, f"{path}\n\nPermission denied — is the file open in another program?")
        return None
    if ask(parent, tr("open_file_q")):
        exporter.open_file(path)
    return path
