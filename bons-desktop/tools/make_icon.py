"""Draw assets/araco.ico (a mixer-drum style "A" on ARACO orange). Run once; the .ico is committed."""
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

size = 256
img = Image.new("RGBA", (size, size), (0, 0, 0, 0))
d = ImageDraw.Draw(img)
d.rounded_rectangle([8, 8, size - 8, size - 8], radius=48, fill=(31, 42, 68, 255))
d.ellipse([40, 40, size - 40, size - 40], fill=(232, 119, 34, 255))
try:
    font = ImageFont.truetype("DejaVuSans-Bold.ttf", 130)
except OSError:
    font = ImageFont.truetype("/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf", 130)
d.text((size / 2, size / 2 + 4), "A", font=font, fill="white", anchor="mm")
out = Path(__file__).resolve().parent.parent / "assets" / "araco.ico"
img.save(out, sizes=[(16, 16), (24, 24), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)])
print(out)
