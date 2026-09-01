# Tilia — newborn announcement artwork

Two designs, both 3600 × 5250 px (12" × 17.5" at 300 dpi):

- **`tilia-announcement.png`** — *Cloudline.* Gold coronet between angel wings
  over an open sky, the name centred, a gilded hooded cradle in a peony
  garland, inside a filigree corner frame.
- **`tilia-announcement-moonlit-arch.png`** — *Moonlit Arch.* A foliated
  Islamic pointed arch over a faint eight-point-star ground, a slender crescent
  moon cradling the coronet, floral cascades down the arch shoulders.

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
python3 src/build.py          # Design I -> tilia.html (fonts inlined as base64)
python3 src/render.py 3       # -> tilia-announcement.png at 3x (3600 x 5250)

python3 src/build2.py         # Design II -> tilia2.html
python3 src/render2.py 3      # -> tilia-announcement-moonlit-arch.png
```

`src/build.py` and `src/build2.py` hold the layout and typography for each
design; `src/elements.py` generates the botanicals and sparkles; `src/motifs.py`
the crown, wings, cradle and gold frame; `src/motifs2.py` the pointed arch,
crescent moon and geometric ground. Both designs share the botanical and crown
generators, so a change there shows up in both. Pass a different scale to the
render scripts for a larger or smaller export.

## Fonts

All bundled fonts are under the SIL Open Font License 1.1:

- **Amiri / Amiri Quran** — Khaled Hosny (Arabic calligraphy; Amiri Quran is the
  Qur'anic-typesetting cut, used for the verse)
- **Great Vibes** — the name in Design I
- **Pinyon Script** — the name in Design II
- **Cormorant Garamond** — the English translation
- **Cinzel** — the citation line
