# -*- coding: utf-8 -*-
"""Build the Tilia newborn announcement: SVG artwork + typography -> HTML -> PNG."""
import base64, math, os, random, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from elements import (f, rot, sparkle, star4, dot, peony, rose, ranunculus,
                      leaf, eucalyptus, foliage_spray, babys_breath, gold_sprig)
from motifs import crown, wing, cradle, corner_flourish, divider

BASE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
FONTS = os.path.join(BASE, "fonts")
W, H = 1200, 1750
rng = random.Random(20260901)

ARABIC_1 = "﴿ وَاللَّهُ جَعَلَ لَكُم مِّنْ أَنفُسِكُمْ أَزْوَاجًا"
ARABIC_2 = "وَجَعَلَ لَكُم مِّنْ أَزْوَاجِكُم بَنِينَ وَحَفَدَةً ﴾"

# ------------------------------------------------------------------ defs
def defs():
    d = ['<defs>']
    # ---- paper / sky
    d.append('''
<linearGradient id="sky" x1="0" y1="0" x2="0" y2="1">
  <stop offset="0%"   stop-color="#FDF6F0"/>
  <stop offset="22%"  stop-color="#FBEFE9"/>
  <stop offset="48%"  stop-color="#FCF6F0"/>
  <stop offset="74%"  stop-color="#FAEDE7"/>
  <stop offset="100%" stop-color="#F6E3DC"/>
</linearGradient>
<radialGradient id="halo" cx="50%" cy="26%" r="62%">
  <stop offset="0%"   stop-color="#FFF9EA" stop-opacity="0.95"/>
  <stop offset="38%"  stop-color="#FDF0E2" stop-opacity="0.55"/>
  <stop offset="100%" stop-color="#F7DED6" stop-opacity="0"/>
</radialGradient>
<radialGradient id="blushGlowL" cx="50%" cy="50%" r="50%">
  <stop offset="0%" stop-color="#F6D3CE" stop-opacity="0.75"/>
  <stop offset="100%" stop-color="#F6D3CE" stop-opacity="0"/>
</radialGradient>
<radialGradient id="vignette" cx="50%" cy="48%" r="72%">
  <stop offset="60%"  stop-color="#000000" stop-opacity="0"/>
  <stop offset="100%" stop-color="#8A5F55" stop-opacity="0.20"/>
</radialGradient>
<radialGradient id="cloudG" cx="50%" cy="55%" r="50%">
  <stop offset="0%"   stop-color="#FFFFFF" stop-opacity="0.98"/>
  <stop offset="55%"  stop-color="#FFF7F2" stop-opacity="0.72"/>
  <stop offset="100%" stop-color="#F8E6E0" stop-opacity="0"/>
</radialGradient>
<radialGradient id="cloudWarm" cx="50%" cy="60%" r="50%">
  <stop offset="0%"   stop-color="#FFF4DF" stop-opacity="0.85"/>
  <stop offset="100%" stop-color="#FBE7D6" stop-opacity="0"/>
</radialGradient>
<radialGradient id="starGlow" cx="50%" cy="50%" r="50%">
  <stop offset="0%"   stop-color="#FFF3CE" stop-opacity="0.95"/>
  <stop offset="45%"  stop-color="#F7DFA6" stop-opacity="0.35"/>
  <stop offset="100%" stop-color="#F7DFA6" stop-opacity="0"/>
</radialGradient>
<linearGradient id="rayG" x1="0" y1="0" x2="0" y2="1">
  <stop offset="0%"   stop-color="#FFF6DF" stop-opacity="0.72"/>
  <stop offset="55%"  stop-color="#FDECC9" stop-opacity="0.22"/>
  <stop offset="100%" stop-color="#FBE4BC" stop-opacity="0"/>
</linearGradient>
''')
    # ---- gold
    d.append('''
<linearGradient id="goldFill" x1="0" y1="0" x2="0.6" y2="1">
  <stop offset="0%"   stop-color="#FBEFCD"/>
  <stop offset="26%"  stop-color="#E7C583"/>
  <stop offset="52%"  stop-color="#C9A24F"/>
  <stop offset="74%"  stop-color="#EBD09A"/>
  <stop offset="100%" stop-color="#B08B39"/>
</linearGradient>
<linearGradient id="goldLine" x1="0" y1="0" x2="1" y2="1">
  <stop offset="0%"   stop-color="#E6C782"/>
  <stop offset="50%"  stop-color="#BF9743"/>
  <stop offset="100%" stop-color="#E8D2A0"/>
</linearGradient>
<radialGradient id="pearl" cx="35%" cy="30%" r="72%">
  <stop offset="0%"   stop-color="#FFFFFF"/>
  <stop offset="55%"  stop-color="#FDF3E4"/>
  <stop offset="100%" stop-color="#EAD9C2"/>
</radialGradient>
<radialGradient id="gemBlush" cx="35%" cy="30%" r="72%">
  <stop offset="0%"   stop-color="#FDEFEC"/>
  <stop offset="45%"  stop-color="#F0C6C1"/>
  <stop offset="100%" stop-color="#D79A94"/>
</radialGradient>
<radialGradient id="pollen" cx="40%" cy="35%" r="70%">
  <stop offset="0%" stop-color="#FBE9B8"/><stop offset="100%" stop-color="#D9B45F"/>
</radialGradient>
''')
    # ---- florals
    d.append('''
<radialGradient id="peonyA0" cx="50%" cy="88%" r="80%">
  <stop offset="0%" stop-color="#E9AEA8"/><stop offset="58%" stop-color="#F3CDC7"/><stop offset="100%" stop-color="#FBEAE5"/>
</radialGradient>
<radialGradient id="peonyA1" cx="50%" cy="88%" r="80%">
  <stop offset="0%" stop-color="#E3A29C"/><stop offset="60%" stop-color="#F0C3BC"/><stop offset="100%" stop-color="#FBE6E0"/>
</radialGradient>
<radialGradient id="peonyA2" cx="50%" cy="88%" r="80%">
  <stop offset="0%" stop-color="#DB958F"/><stop offset="62%" stop-color="#EDB9B1"/><stop offset="100%" stop-color="#F9E0D9"/>
</radialGradient>
<radialGradient id="peonyB0" cx="50%" cy="88%" r="80%">
  <stop offset="0%" stop-color="#F2CFC6"/><stop offset="60%" stop-color="#FAE6DE"/><stop offset="100%" stop-color="#FFF7F1"/>
</radialGradient>
<radialGradient id="peonyB1" cx="50%" cy="88%" r="80%">
  <stop offset="0%" stop-color="#EDC2B8"/><stop offset="62%" stop-color="#F8E0D7"/><stop offset="100%" stop-color="#FFF5EE"/>
</radialGradient>
<radialGradient id="peonyB2" cx="50%" cy="88%" r="80%">
  <stop offset="0%" stop-color="#E6B4A9"/><stop offset="64%" stop-color="#F5D6CB"/><stop offset="100%" stop-color="#FEF2EA"/>
</radialGradient>
<radialGradient id="roseA0" cx="50%" cy="86%" r="80%">
  <stop offset="0%" stop-color="#E1A099"/><stop offset="60%" stop-color="#F1C8C1"/><stop offset="100%" stop-color="#FCEDE8"/>
</radialGradient>
<radialGradient id="roseA1" cx="50%" cy="86%" r="80%">
  <stop offset="0%" stop-color="#D9948D"/><stop offset="62%" stop-color="#EDBDB5"/><stop offset="100%" stop-color="#FAE5DE"/>
</radialGradient>
<radialGradient id="roseA2" cx="50%" cy="86%" r="80%">
  <stop offset="0%" stop-color="#D08882"/><stop offset="64%" stop-color="#E7B2AA"/><stop offset="100%" stop-color="#F7DCD4"/>
</radialGradient>
<radialGradient id="ivoryA0" cx="50%" cy="86%" r="80%">
  <stop offset="0%" stop-color="#F2E4D0"/><stop offset="60%" stop-color="#FBF2E6"/><stop offset="100%" stop-color="#FFFCF7"/>
</radialGradient>
<radialGradient id="ivoryA1" cx="50%" cy="86%" r="80%">
  <stop offset="0%" stop-color="#EDDCC4"/><stop offset="62%" stop-color="#F9EDDE"/><stop offset="100%" stop-color="#FFFBF5"/>
</radialGradient>
<radialGradient id="ivoryA2" cx="50%" cy="86%" r="80%">
  <stop offset="0%" stop-color="#E7D3B6"/><stop offset="64%" stop-color="#F6E7D4"/><stop offset="100%" stop-color="#FFFAF3"/>
</radialGradient>
<linearGradient id="leafA" x1="0" y1="1" x2="0.4" y2="0">
  <stop offset="0%" stop-color="#93A587"/><stop offset="60%" stop-color="#B4C2A9"/><stop offset="100%" stop-color="#D3DCC9"/>
</linearGradient>
<linearGradient id="leafB" x1="0" y1="1" x2="0.5" y2="0">
  <stop offset="0%" stop-color="#A2B096"/><stop offset="55%" stop-color="#C0CBB4"/><stop offset="100%" stop-color="#DDE4D2"/>
</linearGradient>
''')
    # ---- cradle / silk / feathers
    d.append('''
<linearGradient id="basketFill" x1="0" y1="0" x2="0.2" y2="1">
  <stop offset="0%"   stop-color="#F7E7C4"/>
  <stop offset="40%"  stop-color="#E5CB96"/>
  <stop offset="72%"  stop-color="#CFAE६B"/>
  <stop offset="100%" stop-color="#B8933F"/>
</linearGradient>
<linearGradient id="silkFill" x1="0" y1="0" x2="0.3" y2="1">
  <stop offset="0%"   stop-color="#FFFFFF"/>
  <stop offset="45%"  stop-color="#FCF6EC"/>
  <stop offset="100%" stop-color="#EFE0CE"/>
</linearGradient>
<linearGradient id="drapeFill" x1="0.1" y1="0" x2="0.7" y2="1">
  <stop offset="0%"   stop-color="#FFFDF9"/>
  <stop offset="40%"  stop-color="#FAF1E5"/>
  <stop offset="78%"  stop-color="#F1E2D0"/>
  <stop offset="100%" stop-color="#E6D4BE"/>
</linearGradient>
<linearGradient id="drapeShade" x1="0" y1="0" x2="1" y2="0.6">
  <stop offset="0%"   stop-color="#C6A98C" stop-opacity="0.42"/>
  <stop offset="34%"  stop-color="#E4D2BC" stop-opacity="0.06"/>
  <stop offset="72%"  stop-color="#FFFFFF" stop-opacity="0"/>
  <stop offset="100%" stop-color="#C9AC8E" stop-opacity="0.26"/>
</linearGradient>
<linearGradient id="hoodFill" x1="0.1" y1="0" x2="0.8" y2="1">
  <stop offset="0%"   stop-color="#F9E9C6"/>
  <stop offset="35%"  stop-color="#EBD09A"/>
  <stop offset="70%"  stop-color="#D6B370"/>
  <stop offset="100%" stop-color="#BE9846"/>
</linearGradient>
<linearGradient id="veilFill" x1="0" y1="0" x2="1" y2="1">
  <stop offset="0%"   stop-color="#FFFFFF" stop-opacity="0.90"/>
  <stop offset="60%"  stop-color="#FDF6EE" stop-opacity="0.55"/>
  <stop offset="100%" stop-color="#F6E7DA" stop-opacity="0.30"/>
</linearGradient>
<linearGradient id="featherA" x1="0" y1="1" x2="0.3" y2="0">
  <stop offset="0%" stop-color="#F3E7DA"/><stop offset="45%" stop-color="#FDF8F2"/><stop offset="100%" stop-color="#FFFFFF"/>
</linearGradient>
<linearGradient id="featherB" x1="0" y1="1" x2="0.3" y2="0">
  <stop offset="0%" stop-color="#EEDFD0"/><stop offset="45%" stop-color="#FBF4EB"/><stop offset="100%" stop-color="#FFFDFA"/>
</linearGradient>
<linearGradient id="featherC" x1="0" y1="1" x2="0.3" y2="0">
  <stop offset="0%" stop-color="#E7D6C5"/><stop offset="42%" stop-color="#F8F0E5"/><stop offset="100%" stop-color="#FFFCF7"/>
</linearGradient>
''')
    # ---- filters
    d.append('''
<filter id="softBlur" x="-40%" y="-40%" width="180%" height="180%"><feGaussianBlur stdDeviation="26"/></filter>
<filter id="midBlur"  x="-40%" y="-40%" width="180%" height="180%"><feGaussianBlur stdDeviation="12"/></filter>
<filter id="tinyBlur" x="-40%" y="-40%" width="180%" height="180%"><feGaussianBlur stdDeviation="3"/></filter>
<filter id="rayBlur"  x="-30%" y="-30%" width="160%" height="160%"><feGaussianBlur stdDeviation="16"/></filter>
<filter id="goldGlow" x="-60%" y="-60%" width="220%" height="220%">
  <feGaussianBlur stdDeviation="9" result="b"/>
  <feFlood flood-color="#F2D79A" flood-opacity="0.85"/>
  <feComposite in2="b" operator="in" result="g"/>
  <feMerge><feMergeNode in="g"/><feMergeNode in="SourceGraphic"/></feMerge>
</filter>
<filter id="dropSoft" x="-40%" y="-40%" width="180%" height="180%">
  <feDropShadow dx="0" dy="10" stdDeviation="14" flood-color="#B08A7E" flood-opacity="0.24"/>
</filter>
<filter id="dropTiny" x="-40%" y="-40%" width="180%" height="180%">
  <feDropShadow dx="0" dy="4" stdDeviation="6" flood-color="#B08A7E" flood-opacity="0.20"/>
</filter>
<filter id="grain" x="0" y="0" width="100%" height="100%">
  <feTurbulence type="fractalNoise" baseFrequency="0.85" numOctaves="3" stitchTiles="stitch" result="n"/>
  <feColorMatrix in="n" type="saturate" values="0"/>
</filter>
''')
    d.append('</defs>')
    return "".join(d).replace("#CFAE६B", "#CFAE6B")

# ------------------------------------------------------------------ layers
def clouds():
    o = ['<g class="clouds">']
    puffs = [
        (140, 150, 260, 120, 0.95), (330, 108, 300, 130, 0.90), (560, 130, 250, 110, 0.75),
        (900, 118, 300, 128, 0.92), (1080, 168, 250, 118, 0.88), (620, 60, 320, 96, 0.62),
        (60, 300, 220, 96, 0.55), (1160, 320, 230, 100, 0.55),
        (250, 250, 200, 78, 0.40), (960, 262, 210, 82, 0.40),
    ]
    for cx, cy, rx, ry, op in puffs:
        o.append(f'<ellipse cx="{cx}" cy="{cy}" rx="{rx}" ry="{ry}" fill="url(#cloudG)" opacity="{op}" filter="url(#softBlur)"/>')
    for cx, cy, rx, ry, op in [(360,178,190,70,0.5),(880,186,200,72,0.5),(600,146,170,58,0.4)]:
        o.append(f'<ellipse cx="{cx}" cy="{cy}" rx="{rx}" ry="{ry}" fill="url(#cloudWarm)" opacity="{op}" filter="url(#softBlur)"/>')
    # bottom haze
    o.append(f'<ellipse cx="600" cy="{H-40}" rx="640" ry="180" fill="url(#cloudG)" opacity="0.55" filter="url(#softBlur)"/>')
    o.append('</g>')
    return "".join(o)

def rays():
    o = ['<g class="rays" filter="url(#rayBlur)" opacity="0.72">']
    ox, oy = 600, -260
    for a, wdt in [(-30,26),(-21,16),(-13,34),(-6,14),(2,28),(9,18),(17,30),(25,15),(32,24)]:
        L = 1080
        x1, y1 = rot(ox - wdt/2, oy + L, ox, oy, a)
        x2, y2 = rot(ox + wdt/2, oy + L, ox, oy, a)
        o.append(f'<path d="M {ox} {oy} L {f(x1)} {f(y1)} L {f(x2)} {f(y2)} Z" fill="url(#rayG)"/>')
    o.append('</g>')
    return "".join(o)

def starfield():
    o = ['<g class="stars">']
    # big feature sparkles
    feats = [(196,330,17),(1012,300,15),(292,470,11),(910,486,12),(150,596,9),
             (1054,612,10),(238,204,10),(966,196,9),(600,96,12),(404,286,8),(800,272,8)]
    for cx, cy, r in feats:
        o.append(sparkle(cx, cy, r, 0.95))
    # small four-point stars
    for _ in range(90):
        cx = rng.uniform(58, W-58); cy = rng.uniform(52, H*0.62)
        if 250 < cx < 950 and 520 < cy < 1210:   # keep the text field clear
            continue
        r = rng.uniform(2.2, 6.2)
        o.append(star4(cx, cy, r, rng.uniform(0.35, 0.9)))
    # gold dust
    for _ in range(220):
        cx = rng.uniform(40, W-40); cy = rng.uniform(30, H-30)
        r = rng.uniform(0.8, 2.6)
        o.append(dot(cx, cy, r, rng.uniform(0.18, 0.62), rng.choice(["#E9CB92","#F3DCA9","#FFF3D6"])))
    o.append('</g>')
    return "".join(o)

def frame():
    m1, m2 = 44, 62
    o = ['<g class="frame">']
    o.append(f'<rect x="{m1}" y="{m1}" width="{W-2*m1}" height="{H-2*m1}" rx="6" fill="none" stroke="url(#goldLine)" stroke-width="2.4" opacity="0.95"/>')
    o.append(f'<rect x="{m2}" y="{m2}" width="{W-2*m2}" height="{H-2*m2}" rx="4" fill="none" stroke="url(#goldLine)" stroke-width="1.0" opacity="0.65"/>')
    s = 150
    o.append(corner_flourish(m2+2,   m2+2,   s,  1,  1))
    o.append(corner_flourish(W-m2-2, m2+2,   s, -1,  1))
    o.append(corner_flourish(m2+2,   H-m2-2, s,  1, -1))
    o.append(corner_flourish(W-m2-2, H-m2-2, s, -1, -1))
    o.append('</g>')
    return "".join(o)

def top_motif():
    """Crown between two wings, with halo."""
    cy = 288
    o = ['<g class="topmotif">']
    o.append(f'<ellipse cx="600" cy="{cy}" rx="300" ry="150" fill="url(#starGlow)" opacity="0.55" filter="url(#softBlur)"/>')
    o.append(f'<g filter="url(#dropSoft)">')
    o.append(wing(600-54, cy+30, 186, 196, -1, random.Random(31)))
    o.append(wing(600+54, cy+30, 186, 196,  1, random.Random(37)))
    o.append('</g>')
    o.append(f'<g filter="url(#goldGlow)">{crown(600, cy-52, 186, 132)}</g>')
    for cx, cyy, r in [(600-224, cy-52, 9), (600+224, cy-52, 9), (600, cy-162, 12)]:
        o.append(sparkle(cx, cyy, r, 0.95))
    o.append('</g>')
    return "".join(o)

def bottom_scene():
    """Cradle with the floral garden around it."""
    o = ['<g class="scene">']
    cx, cy = 600, 1452
    # soft ground glow
    o.append(f'<ellipse cx="{cx}" cy="{cy+140}" rx="480" ry="124" fill="url(#blushGlowL)" opacity="0.55" filter="url(#softBlur)"/>')
    # --- back foliage
    o.append(f'<g opacity="0.85">')
    o.append(eucalyptus(238, 1512, -38, 300, 1.05, random.Random(41), -1))
    o.append(eucalyptus(962, 1512,  38, 300, 1.05, random.Random(43),  1))
    o.append(foliage_spray(168, 1540, -22, 300, 8, 1.0, random.Random(45)))
    o.append(foliage_spray(1032, 1540, 22, 300, 8, 1.0, random.Random(47)))
    o.append(eucalyptus(356, 1556, -68, 240, 0.9, random.Random(49), -1))
    o.append(eucalyptus(844, 1556,  68, 240, 0.9, random.Random(51),  1))
    o.append('</g>')
    # --- the cradle
    o.append(f'<g filter="url(#dropSoft)">{cradle(cx, cy, 396, 196)}</g>')
    # --- front florals, left cluster
    o.append(f'<g filter="url(#dropTiny)">')
    o.append(foliage_spray(292, 1580, -50, 200, 6, 0.9, random.Random(53)))
    o.append(foliage_spray(908, 1580,  50, 200, 6, 0.9, random.Random(55)))
    o.append(peony(258, 1492, 86, 12, "peonyA", random.Random(57)))
    o.append(peony(944, 1502, 80, -20, "peonyB", random.Random(59)))
    o.append(rose(360, 1574, 54, 30, "roseA", random.Random(61)))
    o.append(rose(852, 1566, 50, -14, "roseA", random.Random(63)))
    o.append(ranunculus(172, 1558, 46, 8, "ivoryA", random.Random(65)))
    o.append(ranunculus(1028, 1570, 44, -8, "ivoryA", random.Random(67)))
    o.append(peony(444, 1624, 46, 44, "peonyB", random.Random(69), rings=(1.0,0.72,0.48)))
    o.append(peony(766, 1628, 44, -36, "peonyA", random.Random(71), rings=(1.0,0.72,0.48)))
    o.append(rose(600, 1646, 40, 18, "roseA", random.Random(73)))
    o.append(ranunculus(518, 1656, 30, 20, "ivoryA", random.Random(75)))
    o.append(ranunculus(690, 1660, 28, -12, "ivoryA", random.Random(77)))
    o.append('</g>')
    # --- baby's breath + gold accents
    o.append(babys_breath(328, 1556, -34, 130, 1.0, random.Random(79)))
    o.append(babys_breath(890, 1556,  34, 130, 1.0, random.Random(81)))
    o.append(babys_breath(514, 1638, -16, 96, 0.9, random.Random(83)))
    o.append(babys_breath(706, 1640,  16, 96, 0.9, random.Random(85)))
    o.append(gold_sprig(210, 1486, -46, 190, 0.95, random.Random(87)))
    o.append(gold_sprig(990, 1490,  46, 190, 0.95, random.Random(89)))
    o.append(gold_sprig(412, 1638, -30, 120, 0.8, random.Random(91)))
    o.append(gold_sprig(796, 1642,  30, 120, 0.8, random.Random(93)))
    for cxx, cyy, r in [(182,1436,9),(1020,1444,8),(392,1444,6),(812,1436,6),(600,1246,9)]:
        o.append(sparkle(cxx, cyy, r, 0.9))
    o.append('</g>')
    return "".join(o)

def side_accents():
    """Small floral corners framing the text field."""
    o = ['<g class="accents">']
    o.append(f'<g opacity="0.95" filter="url(#dropTiny)">')
    # upper-left / upper-right small sprays beside the name
    o.append(foliage_spray(146, 906, 22, 158, 5, 0.72, random.Random(101)))
    o.append(foliage_spray(1054, 906, -22, 158, 5, 0.72, random.Random(103)))
    o.append(rose(146, 884, 31, 12, "roseA", random.Random(105)))
    o.append(rose(1054, 884, 29, -12, "roseA", random.Random(107)))
    o.append(ranunculus(184, 932, 20, 0, "ivoryA", random.Random(109)))
    o.append(ranunculus(1016, 932, 19, 0, "ivoryA", random.Random(111)))
    o.append(gold_sprig(116, 948, 8, 116, 0.64, random.Random(113)))
    o.append(gold_sprig(1084, 948, -8, 116, 0.64, random.Random(115)))
    o.append('</g>')
    o.append('</g>')
    return "".join(o)

def svg_art():
    parts = [f'<svg id="art" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {W} {H}" width="{W}" height="{H}">']
    parts.append(defs())
    parts.append(f'<rect width="{W}" height="{H}" fill="url(#sky)"/>')
    parts.append(f'<ellipse cx="600" cy="430" rx="780" ry="640" fill="url(#halo)"/>')
    parts.append(rays())
    parts.append(clouds())
    parts.append(f'<ellipse cx="600" cy="880" rx="470" ry="360" fill="url(#halo)" opacity="0.75"/>')
    parts.append(starfield())
    parts.append(top_motif())
    parts.append(f'<g opacity="0.95">{divider(600, 800, 344)}</g>')
    parts.append(side_accents())
    parts.append(bottom_scene())
    parts.append(f'<rect width="{W}" height="{H}" fill="url(#vignette)"/>')
    parts.append(f'<rect width="{W}" height="{H}" filter="url(#grain)" opacity="0.055" style="mix-blend-mode:multiply"/>')
    parts.append(frame())
    parts.append('</svg>')
    return "".join(parts)

# ------------------------------------------------------------------ html
def font_face(family, path, weight=400, style="normal"):
    b64 = base64.b64encode(open(os.path.join(FONTS, path), "rb").read()).decode()
    return (f"@font-face{{font-family:'{family}';font-style:{style};font-weight:{weight};"
            f"src:url(data:font/ttf;base64,{b64}) format('truetype');font-display:block;}}")

def build_html():
    faces = "".join([
        font_face("GreatVibes", "GreatVibes-400.ttf"),
        font_face("Cormorant", "CormorantGaramond-300.ttf", 300),
        font_face("Cormorant", "CormorantGaramond-400.ttf", 400),
        font_face("Cormorant", "CormorantGaramond-500.ttf", 500),
        font_face("Cinzel", "Cinzel-400.ttf", 400),
        font_face("Cinzel", "Cinzel-500.ttf", 500),
        font_face("AmiriQuran", "AmiriQuran.ttf"),
        font_face("Amiri", "Amiri-Regular.ttf"),
    ])
    art = svg_art()
    ar_size, ar_lh = 46, 2.05
    html = f"""<!doctype html><html><head><meta charset="utf-8"><style>
{faces}
*{{margin:0;padding:0;box-sizing:border-box;}}
html,body{{background:#fff;}}
#page{{position:relative;width:{W}px;height:{H}px;overflow:hidden;background:#FDF6F0;}}
#page > svg{{position:absolute;inset:0;}}
.layer{{position:absolute;left:0;right:0;text-align:center;}}

/* ---- name ---- */
#name{{top:512px;height:300px;}}
.nm{{position:absolute;left:0;right:0;top:0;font-family:'GreatVibes',cursive;font-size:242px;
     line-height:1.0;letter-spacing:0.005em;}}
.nm-glow{{color:#EFD49A;filter:blur(18px);opacity:0.9;}}
.nm-glow2{{color:#FFF2CE;filter:blur(5px);opacity:0.92;}}
.nm-shadow{{color:#B98F6B;opacity:0.22;transform:translate(0,5px);filter:blur(2px);}}
.nm-grad{{background:linear-gradient(178deg,#FFF8E4 2%,#F3DEAA 20%,#DAB369 42%,#B98F3C 58%,#E8CB8C 74%,#FCF0D3 94%);
     -webkit-background-clip:text;background-clip:text;color:transparent;}}
.nm-stroke{{color:transparent;-webkit-text-stroke:1.1px rgba(176,133,52,0.5);}}

/* ---- arabic ---- */
#verse{{top:846px;}}
.ar{{font-family:'AmiriQuran','Amiri',serif;direction:rtl;unicode-bidi:isolate;
    font-size:{ar_size}px;line-height:{ar_lh};color:#8A6A2E;
    text-shadow:0 0 24px rgba(240,214,155,0.8),0 0 6px rgba(255,246,220,0.9),0 2px 3px rgba(150,112,60,0.15);
    width:1040px;margin:0 auto;font-feature-settings:"calt" 1,"liga" 1,"kern" 1;}}
.ar .ln{{display:block;white-space:nowrap;}}

/* ---- translation ---- */
#trans{{top:1062px;}}
.tr{{font-family:'Cormorant',serif;font-weight:400;font-style:italic;font-size:27px;line-height:1.60;
     color:#7B6053;letter-spacing:0.012em;}}
.tr span{{display:block;white-space:nowrap;}}
.ref{{font-family:'Cinzel',serif;font-weight:500;font-size:15px;letter-spacing:0.30em;
      color:#A8873F;margin-top:20px;text-transform:uppercase;}}
.ref .dash{{letter-spacing:0.12em;}}

/* ---- eyebrow ---- */
#eyebrow{{top:470px;}}
.eb{{font-family:'Cinzel',serif;font-weight:400;font-size:15.5px;letter-spacing:0.52em;color:#B08B4A;
     text-transform:uppercase;text-shadow:0 0 14px rgba(245,225,180,0.9);}}
</style></head><body><div id="page">
{art}

<div class="layer" id="name">
  <div class="nm nm-glow">Tilia</div>
  <div class="nm nm-glow2">Tilia</div>
  <div class="nm nm-shadow">Tilia</div>
  <div class="nm nm-grad">Tilia</div>
  <div class="nm nm-stroke">Tilia</div>
</div>

<div class="layer" id="verse">
  <div class="ar"><span class="ln">{ARABIC_1}</span><span class="ln">{ARABIC_2}</span></div>
</div>

<div class="layer" id="trans">
  <div class="tr"><span>&ldquo;And Allah has made for you spouses from among yourselves</span><span>and has made for you from your spouses children and grandchildren.&rdquo;</span></div>
  <div class="ref"><span class="dash">&mdash;</span>&nbsp;&nbsp;Qur&rsquo;an 16:72</div>
</div>

</div></body></html>"""
    return html

if __name__ == "__main__":
    out = os.path.join(BASE, "tilia.html")
    open(out, "w", encoding="utf-8").write(build_html())
    print("wrote", out, os.path.getsize(out))
