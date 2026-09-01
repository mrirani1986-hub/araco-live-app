# Tilia — newborn announcement artwork

`tilia-announcement.png` — 3600 × 5250 px (12" × 17.5" at 300 dpi).

Everything in the piece is drawn as vector SVG and typeset with real fonts, then
rasterised through headless Chromium. Nothing is AI-generated imagery, so the
Arabic is guaranteed to be correctly shaped, pointed and vocalised rather than
approximated.

## Text in the piece

Name: **Tilia**

Qur'an 16:72 (an-Nahl), partial:

```
﴿ وَاللَّهُ جَعَلَ لَكُم مِّنْ أَنفُسِكُمْ أَزْوَاجًا
وَجَعَلَ لَكُم مِّنْ أَزْوَاجِكُم بَنِينَ وَحَفَدَةً ﴾
```

> "And Allah has made for you spouses from among yourselves and has made for you
> from your spouses children and grandchildren."
> — Qur'an 16:72

## Rebuilding

```
pip install playwright        # Chromium must be available; set CHROME_PATH if needed
python3 src/build.py          # writes tilia.html (fonts inlined as base64)
python3 src/render.py 3       # writes tilia-announcement.png at 3× (3600 × 5250)
```

`src/build.py` holds the layout and typography; `src/elements.py` generates the
botanicals and sparkles; `src/motifs.py` the crown, wings, cradle and gold frame.
Change `scale` in `render.py` for a larger or smaller export.

## Fonts

All bundled fonts are under the SIL Open Font License 1.1:

- **Amiri / Amiri Quran** — Khaled Hosny (Arabic calligraphy; Amiri Quran is the
  Qur'anic-typesetting cut, used for the verse)
- **Great Vibes** — the name
- **Cormorant Garamond** — the English translation
- **Cinzel** — the citation line
