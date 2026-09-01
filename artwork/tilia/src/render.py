"""Render tilia.html to PNG at a chosen scale.  usage: python3 render.py [scale] [out.png]"""
import os, sys
from playwright.sync_api import sync_playwright

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CHROME = os.environ.get("CHROME_PATH", "/opt/pw-browsers/chromium-1194/chrome-linux/chrome")
scale = float(sys.argv[1]) if len(sys.argv) > 1 else 3.0
out = sys.argv[2] if len(sys.argv) > 2 else os.path.join(ROOT, "tilia-announcement.png")

with sync_playwright() as p:
    kw = {"args": ["--force-color-profile=srgb", "--font-render-hinting=none"]}
    if os.path.exists(CHROME):
        kw["executable_path"] = CHROME
    b = p.chromium.launch(**kw)
    pg = b.new_page(viewport={"width": 1200, "height": 1750}, device_scale_factor=scale)
    pg.goto("file://" + os.path.join(ROOT, "tilia.html"))
    pg.wait_for_timeout(1800)
    pg.locator("#page").screenshot(path=out)
    b.close()
print("wrote", out, os.path.getsize(out))
