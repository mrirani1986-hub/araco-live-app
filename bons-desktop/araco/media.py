"""Load scanned tickets (images or PDFs) as PIL images."""
from pathlib import Path

IMAGE_EXT = {".jpg", ".jpeg", ".png", ".bmp", ".tif", ".tiff", ".gif", ".webp"}
SUPPORTED = IMAGE_EXT | {".pdf"}


def is_supported(path) -> bool:
    return Path(path).suffix.lower() in SUPPORTED


def load_pages(path, scale: float = 2.0, max_pages: int = 20):
    """All pages as PIL images (one for a photo, one per page for a PDF / multi-page TIFF)."""
    from PIL import Image, ImageOps
    path = Path(path)
    if path.suffix.lower() == ".pdf":
        import pypdfium2 as pdfium
        pdf = pdfium.PdfDocument(str(path))
        try:
            return [pdf[i].render(scale=scale).to_pil() for i in range(min(len(pdf), max_pages))]
        finally:
            pdf.close()
    pages = []
    with Image.open(path) as im:
        for i in range(min(getattr(im, "n_frames", 1), max_pages)):
            im.seek(i)
            pages.append(ImageOps.exif_transpose(im.convert("RGB")))
    return pages
