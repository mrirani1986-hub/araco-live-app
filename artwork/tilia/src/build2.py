# -*- coding: utf-8 -*-
"""Tilia announcement, Design II — moonlit Islamic arch."""
import base64, math, os, random, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from elements import (f, rot, sparkle, star4, dot, peony, rose, ranunculus,
                      leaf, eucalyptus, foliage_spray, babys_breath, gold_sprig)
from motifs import crown, wing, cradle, divider
from motifs2 import Arch, arch_frame, rosette, crescent, geometric_ground, swag_points

BASE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
FONTS = os.path.join(BASE, "fonts")
W, H = 1200, 1750
rng = random.Random(760224)

ARABIC_1 = "﴿ وَاللَّهُ جَعَلَ لَكُم مِّنْ أَنفُسِكُمْ أَزْوَاجًا"
ARABIC_2 = "وَجَعَلَ لَكُم مِّنْ أَزْوَاجِكُم بَنِينَ وَحَفَدَةً ﴾"

ARCH = Arch(cx=600, half_w=486, base_y=1672, spring_y=760, apex_y=136, bulge=0.40, shoulder=0.60)

# ------------------------------------------------------------------ defs
def defs():
    return '''<defs>
<linearGradient id="sky" x1="0.15" y1="0" x2="0.85" y2="1">
  <stop offset="0%"   stop-color="#FBF1EC"/>
  <stop offset="26%"  stop-color="#F8E7E1"/>
  <stop offset="55%"  stop-color="#FCF4EE"/>
  <stop offset="80%"  stop-color="#F6E2DB"/>
  <stop offset="100%" stop-color="#EFD3CC"/>
</linearGradient>
<radialGradient id="nicheGlow" cx="50%" cy="30%" r="70%">
  <stop offset="0%"   stop-color="#FFF9EC" stop-opacity="1"/>
  <stop offset="40%"  stop-color="#FEF3E7" stop-opacity="0.85"/>
  <stop offset="78%"  stop-color="#FBE8DF" stop-opacity="0.55"/>
  <stop offset="100%" stop-color="#F5DAD2" stop-opacity="0.30"/>
</radialGradient>
<radialGradient id="halo" cx="50%" cy="24%" r="60%">
  <stop offset="0%"   stop-color="#FFF7E0" stop-opacity="0.92"/>
  <stop offset="45%"  stop-color="#FDEEDE" stop-opacity="0.45"/>
  <stop offset="100%" stop-color="#F7DED6" stop-opacity="0"/>
</radialGradient>
<radialGradient id="vignette" cx="50%" cy="46%" r="74%">
  <stop offset="58%"  stop-color="#000000" stop-opacity="0"/>
  <stop offset="100%" stop-color="#8A5F55" stop-opacity="0.26"/>
</radialGradient>
<radialGradient id="cloudG" cx="50%" cy="55%" r="50%">
  <stop offset="0%"   stop-color="#FFFFFF" stop-opacity="0.98"/>
  <stop offset="55%"  stop-color="#FFF7F2" stop-opacity="0.70"/>
  <stop offset="100%" stop-color="#F8E6E0" stop-opacity="0"/>
</radialGradient>
<radialGradient id="cloudWarm" cx="50%" cy="60%" r="50%">
  <stop offset="0%"   stop-color="#FFF3DC" stop-opacity="0.85"/>
  <stop offset="100%" stop-color="#FBE7D6" stop-opacity="0"/>
</radialGradient>
<radialGradient id="starGlow" cx="50%" cy="50%" r="50%">
  <stop offset="0%"   stop-color="#FFF3CE" stop-opacity="0.95"/>
  <stop offset="45%"  stop-color="#F7DFA6" stop-opacity="0.35"/>
  <stop offset="100%" stop-color="#F7DFA6" stop-opacity="0"/>
</radialGradient>
<radialGradient id="blushGlowL" cx="50%" cy="50%" r="50%">
  <stop offset="0%" stop-color="#F3CDC7" stop-opacity="0.7"/>
  <stop offset="100%" stop-color="#F3CDC7" stop-opacity="0"/>
</radialGradient>

<linearGradient id="goldFill" x1="0" y1="0" x2="0.6" y2="1">
  <stop offset="0%"   stop-color="#FBEBC8"/>
  <stop offset="26%"  stop-color="#E8C489"/>
  <stop offset="52%"  stop-color="#C89E57"/>
  <stop offset="74%"  stop-color="#EDD0A1"/>
  <stop offset="100%" stop-color="#AE853C"/>
</linearGradient>
<linearGradient id="goldLine" x1="0" y1="0" x2="1" y2="1">
  <stop offset="0%"   stop-color="#E7C98A"/>
  <stop offset="50%"  stop-color="#BE9445"/>
  <stop offset="100%" stop-color="#EAD4A5"/>
</linearGradient>
<radialGradient id="pearl" cx="35%" cy="30%" r="72%">
  <stop offset="0%" stop-color="#FFFFFF"/><stop offset="55%" stop-color="#FDF3E4"/><stop offset="100%" stop-color="#EAD9C2"/>
</radialGradient>
<radialGradient id="gemBlush" cx="35%" cy="30%" r="72%">
  <stop offset="0%" stop-color="#FDEFEC"/><stop offset="45%" stop-color="#F0C6C1"/><stop offset="100%" stop-color="#D79A94"/>
</radialGradient>
<radialGradient id="pollen" cx="40%" cy="35%" r="70%">
  <stop offset="0%" stop-color="#FBE9B8"/><stop offset="100%" stop-color="#D9B45F"/>
</radialGradient>

<radialGradient id="moonGlow" cx="50%" cy="50%" r="50%">
  <stop offset="0%"   stop-color="#FFF6DC" stop-opacity="0.85"/>
  <stop offset="42%"  stop-color="#FBE6BE" stop-opacity="0.40"/>
  <stop offset="100%" stop-color="#F6D9B4" stop-opacity="0"/>
</radialGradient>
<linearGradient id="moonFill" x1="0.1" y1="0" x2="0.8" y2="1">
  <stop offset="0%"   stop-color="#FDF0D2"/>
  <stop offset="30%"  stop-color="#F0D49A"/>
  <stop offset="62%"  stop-color="#D7B267"/>
  <stop offset="100%" stop-color="#B58F41"/>
</linearGradient>
<linearGradient id="moonSheen" x1="0" y1="0" x2="0.5" y2="1">
  <stop offset="0%"   stop-color="#FFFFFF" stop-opacity="0.55"/>
  <stop offset="45%"  stop-color="#FFFFFF" stop-opacity="0.06"/>
  <stop offset="100%" stop-color="#FFFFFF" stop-opacity="0"/>
</linearGradient>

<radialGradient id="peonyA0" cx="50%" cy="88%" r="80%"><stop offset="0%" stop-color="#E9AEA8"/><stop offset="58%" stop-color="#F3CDC7"/><stop offset="100%" stop-color="#FBEAE5"/></radialGradient>
<radialGradient id="peonyA1" cx="50%" cy="88%" r="80%"><stop offset="0%" stop-color="#E3A29C"/><stop offset="60%" stop-color="#F0C3BC"/><stop offset="100%" stop-color="#FBE6E0"/></radialGradient>
<radialGradient id="peonyA2" cx="50%" cy="88%" r="80%"><stop offset="0%" stop-color="#DB958F"/><stop offset="62%" stop-color="#EDB9B1"/><stop offset="100%" stop-color="#F9E0D9"/></radialGradient>
<radialGradient id="peonyB0" cx="50%" cy="88%" r="80%"><stop offset="0%" stop-color="#F2CFC6"/><stop offset="60%" stop-color="#FAE6DE"/><stop offset="100%" stop-color="#FFF7F1"/></radialGradient>
<radialGradient id="peonyB1" cx="50%" cy="88%" r="80%"><stop offset="0%" stop-color="#EDC2B8"/><stop offset="62%" stop-color="#F8E0D7"/><stop offset="100%" stop-color="#FFF5EE"/></radialGradient>
<radialGradient id="peonyB2" cx="50%" cy="88%" r="80%"><stop offset="0%" stop-color="#E6B4A9"/><stop offset="64%" stop-color="#F5D6CB"/><stop offset="100%" stop-color="#FEF2EA"/></radialGradient>
<radialGradient id="roseA0" cx="50%" cy="86%" r="80%"><stop offset="0%" stop-color="#E1A099"/><stop offset="60%" stop-color="#F1C8C1"/><stop offset="100%" stop-color="#FCEDE8"/></radialGradient>
<radialGradient id="roseA1" cx="50%" cy="86%" r="80%"><stop offset="0%" stop-color="#D9948D"/><stop offset="62%" stop-color="#EDBDB5"/><stop offset="100%" stop-color="#FAE5DE"/></radialGradient>
<radialGradient id="roseA2" cx="50%" cy="86%" r="80%"><stop offset="0%" stop-color="#D08882"/><stop offset="64%" stop-color="#E7B2AA"/><stop offset="100%" stop-color="#F7DCD4"/></radialGradient>
<radialGradient id="ivoryA0" cx="50%" cy="86%" r="80%"><stop offset="0%" stop-color="#F2E4D0"/><stop offset="60%" stop-color="#FBF2E6"/><stop offset="100%" stop-color="#FFFCF7"/></radialGradient>
<radialGradient id="ivoryA1" cx="50%" cy="86%" r="80%"><stop offset="0%" stop-color="#EDDCC4"/><stop offset="62%" stop-color="#F9EDDE"/><stop offset="100%" stop-color="#FFFBF5"/></radialGradient>
<radialGradient id="ivoryA2" cx="50%" cy="86%" r="80%"><stop offset="0%" stop-color="#E7D3B6"/><stop offset="64%" stop-color="#F6E7D4"/><stop offset="100%" stop-color="#FFFAF3"/></radialGradient>
<linearGradient id="leafA" x1="0" y1="1" x2="0.4" y2="0"><stop offset="0%" stop-color="#93A587"/><stop offset="60%" stop-color="#B4C2A9"/><stop offset="100%" stop-color="#D3DCC9"/></linearGradient>
<linearGradient id="leafB" x1="0" y1="1" x2="0.5" y2="0"><stop offset="0%" stop-color="#A2B096"/><stop offset="55%" stop-color="#C0CBB4"/><stop offset="100%" stop-color="#DDE4D2"/></linearGradient>

<linearGradient id="basketFill" x1="0" y1="0" x2="0.2" y2="1">
  <stop offset="0%" stop-color="#F7E7C4"/><stop offset="40%" stop-color="#E5CB96"/>
  <stop offset="72%" stop-color="#CFAE6B"/><stop offset="100%" stop-color="#B8933F"/>
</linearGradient>
<linearGradient id="hoodFill" x1="0.1" y1="0" x2="0.8" y2="1">
  <stop offset="0%" stop-color="#F9E9C6"/><stop offset="35%" stop-color="#EBD09A"/>
  <stop offset="70%" stop-color="#D6B370"/><stop offset="100%" stop-color="#BE9846"/>
</linearGradient>
<linearGradient id="silkFill" x1="0" y1="0" x2="0.3" y2="1">
  <stop offset="0%" stop-color="#FFFFFF"/><stop offset="45%" stop-color="#FCF6EC"/><stop offset="100%" stop-color="#EFE0CE"/>
</linearGradient>
<linearGradient id="drapeFill" x1="0.1" y1="0" x2="0.7" y2="1">
  <stop offset="0%" stop-color="#FFFDF9"/><stop offset="40%" stop-color="#FAF1E5"/>
  <stop offset="78%" stop-color="#F1E2D0"/><stop offset="100%" stop-color="#E6D4BE"/>
</linearGradient>
<linearGradient id="drapeShade" x1="0" y1="0" x2="1" y2="0.6">
  <stop offset="0%" stop-color="#C6A98C" stop-opacity="0.42"/><stop offset="34%" stop-color="#E4D2BC" stop-opacity="0.06"/>
  <stop offset="72%" stop-color="#FFFFFF" stop-opacity="0"/><stop offset="100%" stop-color="#C9AC8E" stop-opacity="0.26"/>
</linearGradient>
<linearGradient id="veilFill" x1="0" y1="0" x2="1" y2="1">
  <stop offset="0%" stop-color="#FFFFFF" stop-opacity="0.90"/><stop offset="60%" stop-color="#FDF6EE" stop-opacity="0.55"/>
  <stop offset="100%" stop-color="#F6E7DA" stop-opacity="0.30"/>
</linearGradient>
<linearGradient id="featherA" x1="0" y1="1" x2="0.3" y2="0"><stop offset="0%" stop-color="#F3E7DA"/><stop offset="45%" stop-color="#FDF8F2"/><stop offset="100%" stop-color="#FFFFFF"/></linearGradient>
<linearGradient id="featherB" x1="0" y1="1" x2="0.3" y2="0"><stop offset="0%" stop-color="#EEDFD0"/><stop offset="45%" stop-color="#FBF4EB"/><stop offset="100%" stop-color="#FFFDFA"/></linearGradient>
<linearGradient id="featherC" x1="0" y1="1" x2="0.3" y2="0"><stop offset="0%" stop-color="#E7D6C5"/><stop offset="42%" stop-color="#F8F0E5"/><stop offset="100%" stop-color="#FFFCF7"/></linearGradient>

<filter id="softBlur" x="-40%" y="-40%" width="180%" height="180%"><feGaussianBlur stdDeviation="26"/></filter>
<filter id="midBlur"  x="-40%" y="-40%" width="180%" height="180%"><feGaussianBlur stdDeviation="12"/></filter>
<filter id="tinyBlur" x="-40%" y="-40%" width="180%" height="180%"><feGaussianBlur stdDeviation="3"/></filter>
<filter id="goldGlow" x="-60%" y="-60%" width="220%" height="220%">
  <feGaussianBlur stdDeviation="9" result="b"/><feFlood flood-color="#F2D79A" flood-opacity="0.85"/>
  <feComposite in2="b" operator="in" result="g"/><feMerge><feMergeNode in="g"/><feMergeNode in="SourceGraphic"/></feMerge>
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
<clipPath id="nicheClip"><path d="''' + ARCH.outline(6) + '''"/></clipPath>
</defs>'''

# ------------------------------------------------------------------ layers
def niche():
    o = [f'<path d="{ARCH.outline(6)}" fill="url(#nicheGlow)"/>']
    o.append(f'<g clip-path="url(#nicheClip)">')
    o.append(geometric_ground(80, 120, 1130, 1700, 96, 0.085))
    o.append(f'<ellipse cx="600" cy="380" rx="560" ry="420" fill="url(#halo)"/>')
    # clouds hugging the springing line and the base
    for cx, cy, rx, ry, op in [(230,700,250,86,0.65),(980,706,250,88,0.62),(600,660,300,70,0.34),
                               (600,1600,470,140,0.55),(250,1560,240,96,0.42),(950,1566,240,96,0.42)]:
        o.append(f'<ellipse cx="{cx}" cy="{cy}" rx="{rx}" ry="{ry}" fill="url(#cloudG)" opacity="{op}" filter="url(#softBlur)"/>')
    for cx, cy, rx, ry in [(300,330,220,96),(900,336,220,96)]:
        o.append(f'<ellipse cx="{cx}" cy="{cy}" rx="{rx}" ry="{ry}" fill="url(#cloudWarm)" opacity="0.45" filter="url(#softBlur)"/>')
    o.append('</g>')
    return "".join(o)

def top_motif():
    """Wings behind, crescent moon in front, coronet nested in the sickle."""
    cy = 392
    o = ['<g class="topmotif">']
    o.append(f'<ellipse cx="600" cy="{cy}" rx="300" ry="170" fill="url(#starGlow)" opacity="0.5" filter="url(#softBlur)"/>')
    o.append('<g filter="url(#dropSoft)" opacity="0.96">')
    o.append(wing(600-104, cy+104, 152, 164, -1, random.Random(211)))
    o.append(wing(600+104, cy+104, 152, 164,  1, random.Random(217)))
    o.append('</g>')
    o.append(crescent(600, cy+16, 156, -98, 0.870, 0.265))
    o.append(f'<g filter="url(#goldGlow)">{crown(600, cy+4, 128, 92)}</g>')
    for cxx, cyy, r in [(600-206, cy-78, 9), (600+206, cy-72, 8), (600, cy-170, 11), (600-136, cy+126, 7), (600+142, cy+122, 7)]:
        o.append(sparkle(cxx, cyy, r, 0.95))
    o.append('</g>')
    return "".join(o)

def starfield():
    o = ['<g class="stars">']
    for cx, cy, r in [(232,556,14),(972,540,13),(180,880,10),(1020,900,11),(268,1120,9),
                      (938,1140,10),(150,660,8),(1052,672,8),(310,236,9),(896,244,8)]:
        o.append(sparkle(cx, cy, r, 0.92))
    for _ in range(105):
        cx = rng.uniform(96, W-96); cy = rng.uniform(150, H-110)
        if 220 < cx < 980 and 560 < cy < 1260:
            continue
        if abs(cx-600) < 240 and 240 < cy < 540:
            continue
        o.append(star4(cx, cy, rng.uniform(2.0, 6.0), rng.uniform(0.32, 0.88)))
    for _ in range(230):
        o.append(dot(rng.uniform(80, W-80), rng.uniform(140, H-90), rng.uniform(0.8, 2.6),
                     rng.uniform(0.16, 0.60), rng.choice(["#E9CB92","#F3DCA9","#FFF3D6"])))
    o.append('</g>')
    return "".join(o)

def arch_swags():
    """Floral cascades hanging from the arch shoulders down the curve."""
    o = ['<g class="swags" filter="url(#dropTiny)">']
    for side in (-1, 1):
        pts = swag_points(ARCH, side, 0.24, 0.82, 7)
        r = random.Random(300 + side)
        for i, (px, py) in enumerate(pts):
            k = 1 - i/9
            ang = ARCH.tangent(0.24 + 0.58*i/6, side)
            inward = side*-1
            ox = px + inward*8*k
            o.append(foliage_spray(ox, py, ang + side*96, 118*k, 6, 0.72*k + 0.18, r))
            if i % 2 == 0:
                o.append(peony(ox + inward*10, py - 6, 40*k + 12, r.uniform(0, 360), "peonyB" if i % 4 else "peonyA", r,
                               rings=(1.0, 0.72, 0.48)))
            else:
                o.append(rose(ox + inward*14, py + 8, 26*k + 8, r.uniform(0, 360), "roseA", r))
            if i % 3 == 1:
                o.append(ranunculus(ox + inward*34, py + 26, 18*k + 6, 0, "ivoryA", r))
            o.append(gold_sprig(ox + inward*4, py + 14, ang + side*104, 92*k + 18, 0.62, r))
        # crest bloom right at the top of each cascade
        tx, ty = ARCH.pt(0.86, side)
        o.append(peony(tx + side*-16, ty + 14, 34, side*24, "peonyA", random.Random(400+side), rings=(1.0, 0.70, 0.46)))
    o.append('</g>')
    return "".join(o)

def base_scene():
    """Cradle on a bed of cloud with a low floral border."""
    cx, cy = 600, 1452
    o = ['<g class="scene">']
    o.append(f'<ellipse cx="{cx}" cy="{cy+128}" rx="430" ry="108" fill="url(#blushGlowL)" opacity="0.5" filter="url(#softBlur)"/>')
    o.append('<g opacity="0.9">')
    o.append(eucalyptus(258, 1584, -36, 268, 1.0, random.Random(501), -1))
    o.append(eucalyptus(942, 1584,  36, 268, 1.0, random.Random(503),  1))
    o.append(eucalyptus(196, 1636, -12, 216, 0.85, random.Random(551), -1))
    o.append(eucalyptus(1004, 1636, 12, 216, 0.85, random.Random(553),  1))
    o.append(foliage_spray(214, 1650, -28, 250, 7, 0.95, random.Random(505)))
    o.append(foliage_spray(986, 1650,  28, 250, 7, 0.95, random.Random(507)))
    o.append(foliage_spray(330, 1600, -58, 200, 6, 0.85, random.Random(555)))
    o.append(foliage_spray(870, 1600,  58, 200, 6, 0.85, random.Random(557)))
    o.append('</g>')
    o.append(f'<g filter="url(#dropSoft)">{cradle(cx, cy, 366, 182)}</g>')
    o.append('<g filter="url(#dropTiny)">')
    o.append(foliage_spray(300, 1600, -48, 190, 6, 0.85, random.Random(541)))
    o.append(foliage_spray(900, 1600,  48, 190, 6, 0.85, random.Random(543)))
    o.append(peony(268, 1524, 76, 14, "peonyA", random.Random(509)))
    o.append(peony(932, 1530, 72, -18, "peonyB", random.Random(511)))
    o.append(rose(374, 1584, 48, 26, "roseA", random.Random(513)))
    o.append(rose(828, 1580, 46, -14, "roseA", random.Random(515)))
    o.append(ranunculus(184, 1592, 42, 8, "ivoryA", random.Random(517)))
    o.append(ranunculus(1016, 1596, 40, -8, "ivoryA", random.Random(519)))
    o.append(peony(462, 1626, 44, 40, "peonyB", random.Random(521), rings=(1.0, 0.72, 0.48)))
    o.append(peony(740, 1630, 42, -34, "peonyA", random.Random(523), rings=(1.0, 0.72, 0.48)))
    o.append(rose(600, 1648, 36, 16, "roseA", random.Random(525)))
    o.append(ranunculus(526, 1658, 26, 12, "ivoryA", random.Random(545)))
    o.append(ranunculus(676, 1660, 25, -10, "ivoryA", random.Random(547)))
    o.append(rose(340, 1512, 34, 8, "roseA", random.Random(559)))
    o.append(rose(862, 1516, 32, -8, "roseA", random.Random(561)))
    o.append(ranunculus(410, 1540, 26, 4, "ivoryA", random.Random(563)))
    o.append(ranunculus(794, 1544, 25, -4, "ivoryA", random.Random(565)))
    o.append('</g>')
    o.append(babys_breath(330, 1560, -32, 124, 0.95, random.Random(527)))
    o.append(babys_breath(870, 1564,  32, 124, 0.95, random.Random(529)))
    o.append(babys_breath(534, 1644, -14, 86, 0.85, random.Random(531)))
    o.append(babys_breath(666, 1646,  14, 86, 0.85, random.Random(533)))
    o.append(gold_sprig(238, 1508, -44, 186, 0.9, random.Random(535)))
    o.append(gold_sprig(962, 1512,  44, 186, 0.9, random.Random(537)))
    for cxx, cyy, r in [(224,1500,8),(976,1508,8),(600,1258,9)]:
        o.append(sparkle(cxx, cyy, r, 0.9))
    o.append('</g>')
    return "".join(o)

def outer_border():
    m = 40
    return (f'<rect x="{m}" y="{m}" width="{W-2*m}" height="{H-2*m}" rx="4" fill="none" '
            f'stroke="url(#goldLine)" stroke-width="2.0" opacity="0.9"/>'
            f'<rect x="{m+9}" y="{m+9}" width="{W-2*m-18}" height="{H-2*m-18}" rx="3" fill="none" '
            f'stroke="url(#goldLine)" stroke-width="0.9" opacity="0.5"/>')

def svg_art():
    p = [f'<svg id="art" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {W} {H}" width="{W}" height="{H}">']
    p.append(defs())
    p.append(f'<rect width="{W}" height="{H}" fill="url(#sky)"/>')
    p.append(niche())
    p.append(starfield())
    p.append(top_motif())
    p.append(arch_frame(ARCH))
    p.append(arch_swags())
    p.append(f'<g opacity="0.95">{divider(600, 830, 300)}</g>')
    p.append(base_scene())
    p.append(f'<rect width="{W}" height="{H}" fill="url(#vignette)"/>')
    p.append(f'<rect width="{W}" height="{H}" filter="url(#grain)" opacity="0.055" style="mix-blend-mode:multiply"/>')
    p.append(outer_border())
    p.append('</svg>')
    return "".join(p)

# ------------------------------------------------------------------ html
def font_face(family, path, weight=400, style="normal"):
    b64 = base64.b64encode(open(os.path.join(FONTS, path), "rb").read()).decode()
    return (f"@font-face{{font-family:'{family}';font-style:{style};font-weight:{weight};"
            f"src:url(data:font/ttf;base64,{b64}) format('truetype');font-display:block;}}")

def build_html():
    faces = "".join([
        font_face("PinyonScript", "PinyonScript-400.ttf"),
        font_face("Cormorant", "CormorantGaramond-300.ttf", 300),
        font_face("Cormorant", "CormorantGaramond-400.ttf", 400),
        font_face("Cormorant", "CormorantGaramond-500.ttf", 500),
        font_face("Cinzel", "Cinzel-400.ttf", 400),
        font_face("Cinzel", "Cinzel-500.ttf", 500),
        font_face("AmiriQuran", "AmiriQuran.ttf"),
        font_face("Amiri", "Amiri-Regular.ttf"),
    ])
    return f"""<!doctype html><html><head><meta charset="utf-8"><style>
{faces}
*{{margin:0;padding:0;box-sizing:border-box;}}
html,body{{background:#fff;}}
#page{{position:relative;width:{W}px;height:{H}px;overflow:hidden;background:#FBF1EC;}}
#page > svg{{position:absolute;inset:0;}}
.layer{{position:absolute;left:0;right:0;text-align:center;}}

#name{{top:560px;height:290px;}}
.nm{{position:absolute;left:0;right:0;top:0;font-family:'PinyonScript',cursive;font-size:206px;
     line-height:1.0;letter-spacing:0.012em;}}
.nm-glow{{color:#EFD49A;filter:blur(19px);opacity:0.92;}}
.nm-glow2{{color:#FFF2CE;filter:blur(5px);opacity:0.9;}}
.nm-shadow{{color:#B98F6B;opacity:0.20;transform:translate(0,5px);filter:blur(2px);}}
.nm-grad{{background:linear-gradient(178deg,#FFF9E8 2%,#F4E0AF 20%,#DCB56C 42%,#B98F3C 58%,#E9CD90 74%,#FCF1D6 94%);
     -webkit-background-clip:text;background-clip:text;color:transparent;}}
.nm-stroke{{color:transparent;-webkit-text-stroke:1px rgba(176,133,52,0.5);}}

#verse{{top:892px;}}
.ar{{font-family:'AmiriQuran','Amiri',serif;direction:rtl;unicode-bidi:isolate;
    font-size:42px;line-height:2.02;color:#8A6A2E;
    text-shadow:0 0 24px rgba(240,214,155,0.8),0 0 6px rgba(255,246,220,0.9),0 2px 3px rgba(150,112,60,0.15);
    width:900px;margin:0 auto;font-feature-settings:"calt" 1,"liga" 1,"kern" 1;}}
.ar .ln{{display:block;white-space:nowrap;}}

#trans{{top:1094px;}}
.tr{{font-family:'Cormorant',serif;font-weight:400;font-style:italic;font-size:25px;line-height:1.62;
     color:#7B6053;letter-spacing:0.012em;}}
.tr span{{display:block;white-space:nowrap;}}
.ref{{font-family:'Cinzel',serif;font-weight:500;font-size:14px;letter-spacing:0.30em;
      color:#A8873F;margin-top:19px;text-transform:uppercase;}}
.ref .dash{{letter-spacing:0.12em;}}
</style></head><body><div id="page">
{svg_art()}
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

if __name__ == "__main__":
    out = os.path.join(BASE, "tilia2.html")
    open(out, "w", encoding="utf-8").write(build_html())
    print("wrote", out, os.path.getsize(out))
