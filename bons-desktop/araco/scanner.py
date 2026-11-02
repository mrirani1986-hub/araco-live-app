"""Acquire images straight from a scanner with Windows Image Acquisition (WIA)."""
import sys
from pathlib import Path

FORMAT_JPEG = "{B96B3CAE-0728-11D3-9D7B-0000F81EF32E}"
SCANNER_DEVICE = 1
PROP_INTENT = 6146          # 1 = colour, 2 = greyscale
PROP_HRES, PROP_VRES = 6147, 6148
PROP_DOC_HANDLING = 3088    # 1 = feeder, 2 = flatbed
WIA_ERROR_PAPER_EMPTY = 0x80210003
WIA_ERROR_BUSY = 0x80210006
WIA_ERROR_OFFLINE = 0x80210005
WIA_ERROR_CANCELLED = 0x80210064


class ScannerError(Exception):
    def __init__(self, key: str, detail: str = ""):
        super().__init__(key)
        self.key, self.detail = key, detail


class FeederEmpty(ScannerError):
    def __init__(self):
        super().__init__("scan_feeder_empty")


def available() -> bool:
    if sys.platform != "win32":
        return False
    try:
        import win32com.client  # noqa: F401
        return True
    except ImportError:
        return False


def _hresult(exc) -> int:
    """WIA puts its own error code in excepinfo[5]; fall back to the COM hresult."""
    args = getattr(exc, "args", ())
    code = args[0] if args else 0
    if len(args) > 2 and args[2] and len(args[2]) > 5 and args[2][5]:
        code = args[2][5]
    return code & 0xFFFFFFFF


class WiaScanner:
    """Pick a scanner once, then call scan() for each ticket (flatbed or feeder)."""

    def __init__(self, dpi: int = 200, color: bool = True, show_ui: bool = False):
        if not available():
            raise ScannerError("scan_unavailable")
        import win32com.client
        self.dpi, self.color, self.show_ui = dpi, color, show_ui
        self.dialog = win32com.client.Dispatch("WIA.CommonDialog")
        self.device = None

    def select_device(self) -> bool:
        try:
            self.device = self.dialog.ShowSelectDevice(SCANNER_DEVICE, False, False)
        except Exception as e:  # noqa: BLE001 - COM errors
            code = _hresult(e)
            if code == 0x80210015:  # WIA_S_NO_DEVICE_AVAILABLE
                raise ScannerError("scan_no_device") from e
            raise ScannerError("scan_failed", str(e)) from e
        if self.device is None:
            return False
        try:
            self.device_name = self.device.Properties("Name").Value
        except Exception:  # noqa: BLE001
            self.device_name = ""
        return True

    @staticmethod
    def _set(props, pid, value):
        for p in props:
            if p.PropertyID == pid:
                try:
                    p.Value = value
                except Exception:  # noqa: BLE001 - property not supported by this model
                    pass
                return

    def scan(self, dest: Path) -> Path | None:
        """Scan one page to `dest` (JPEG). Returns None if the user cancelled."""
        dest = Path(dest)
        dest.parent.mkdir(parents=True, exist_ok=True)
        if dest.exists():
            dest.unlink()
        try:
            if self.show_ui:
                image = self.dialog.ShowAcquireImage(SCANNER_DEVICE, 1 if self.color else 2, 0, FORMAT_JPEG,
                                                     False, True, False)
            else:
                if self.device is None and not self.select_device():
                    return None
                item = self.device.Items(1)
                self._set(item.Properties, PROP_INTENT, 1 if self.color else 2)
                self._set(item.Properties, PROP_HRES, self.dpi)
                self._set(item.Properties, PROP_VRES, self.dpi)
                image = self.dialog.ShowTransfer(item, FORMAT_JPEG, False)
        except Exception as e:  # noqa: BLE001 - COM errors carry the WIA code
            code = _hresult(e)
            if code == WIA_ERROR_PAPER_EMPTY:
                raise FeederEmpty() from e
            if code == WIA_ERROR_CANCELLED:
                return None
            if code == WIA_ERROR_BUSY:
                raise ScannerError("scan_busy") from e
            if code == WIA_ERROR_OFFLINE:
                raise ScannerError("scan_offline") from e
            raise ScannerError("scan_failed", f"0x{code:08X} {e}") from e
        if image is None:
            return None
        image.SaveFile(str(dest))
        return dest
