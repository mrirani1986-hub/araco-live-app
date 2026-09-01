# -*- coding: utf-8 -*-
"""Procedural SVG element generators for the Tilia announcement artwork."""
import math, random

def rot(x, y, cx, cy, a):
    ar = math.radians(a); dx, dy = x - cx, y - cy
    return (cx + dx*math.cos(ar) - dy*math.sin(ar), cy + dx*math.sin(ar) + dy*math.cos(ar))

def f(v): return round(v, 2)

# ---------------------------------------------------------------- sparkles
def sparkle(cx, cy, r, opacity=1.0, color="#F6E3B4", thin=0.16):
    w = r*thin
    d = (f"M {f(cx)} {f(cy-r)} C {f(cx+w*0.6)} {f(cy-r*0.32)} {f(cx+r*0.32)} {f(cy-w*0.6)} {f(cx+r)} {f(cy)} "
         f"C {f(cx+r*0.32)} {f(cy+w*0.6)} {f(cx+w*0.6)} {f(cy+r*0.32)} {f(cx)} {f(cy+r)} "
         f"C {f(cx-w*0.6)} {f(cy+r*0.32)} {f(cx-r*0.32)} {f(cy+w*0.6)} {f(cx-r)} {f(cy)} "
         f"C {f(cx-r*0.32)} {f(cy-w*0.6)} {f(cx-w*0.6)} {f(cy-r*0.32)} {f(cx)} {f(cy-r)} Z")
    return (f'<circle cx="{f(cx)}" cy="{f(cy)}" r="{f(r*0.75)}" fill="url(#starGlow)" opacity="{f(opacity*0.55)}"/>'
            f'<path d="{d}" fill="{color}" opacity="{f(opacity)}"/>')

def star4(cx, cy, r, opacity=1.0):
    return sparkle(cx, cy, r, opacity, "#FFF6DE", 0.10)

def dot(cx, cy, r, opacity, color="#EBCB8E"):
    return f'<circle cx="{f(cx)}" cy="{f(cy)}" r="{f(r)}" fill="{color}" opacity="{f(opacity)}"/>'

# ---------------------------------------------------------------- petals
def petal_path(cx, cy, ang, length, width, curl=0.0):
    """Teardrop petal rooted at (cx,cy) pointing along ang (deg, 0=up)."""
    pts = [(0,0), (-width, -length*0.30), (-width*0.86+curl*width, -length*0.80),
           (curl*width*0.6, -length), (width*0.86+curl*width, -length*0.80),
           (width, -length*0.30), (0,0)]
    P = [rot(cx+px, cy+py, cx, cy, ang) for px, py in pts]
    return (f"M {f(P[0][0])} {f(P[0][1])} C {f(P[1][0])} {f(P[1][1])} {f(P[2][0])} {f(P[2][1])} {f(P[3][0])} {f(P[3][1])} "
            f"C {f(P[4][0])} {f(P[4][1])} {f(P[5][0])} {f(P[5][1])} {f(P[6][0])} {f(P[6][1])} Z")

def peony(cx, cy, r, rot_deg=0, grad="peonyA", rng=None, rings=(1.0, 0.74, 0.52, 0.33), stroke="#D79E9B"):
    rng = rng or random.Random(7)
    out = [f'<g class="bloom">']
    for ri, rf in enumerate(rings):
        n = max(5, int(9 - ri*1.4))
        L = r*rf; W = L*(0.50 - ri*0.03)
        base = rot_deg + ri*(360/n)*0.5
        op = 1.0 if ri == 0 else 0.97
        for i in range(n):
            a = base + i*(360.0/n) + rng.uniform(-5, 5)
            ln = L*rng.uniform(0.92, 1.06)
            out.append(f'<path d="{petal_path(cx, cy, a, ln, W, rng.uniform(-0.12,0.12))}" '
                       f'fill="url(#{grad}{min(ri,2)})" stroke="{stroke}" stroke-width="{f(r*0.011)}" '
                       f'stroke-opacity="0.35" opacity="{op}"/>')
    # ruffled heart
    for i in range(7):
        a = rot_deg + i*51 + rng.uniform(-8, 8)
        out.append(f'<path d="{petal_path(cx, cy, a, r*0.21, r*0.12, rng.uniform(-0.3,0.3))}" '
                   f'fill="url(#{grad}2)" stroke="{stroke}" stroke-width="{f(r*0.008)}" stroke-opacity="0.4"/>')
    out.append(f'<circle cx="{f(cx)}" cy="{f(cy)}" r="{f(r*0.075)}" fill="url(#pollen)"/>')
    for i in range(9):
        a = i*40; px, py = rot(cx, cy - r*0.11, cx, cy, a)
        out.append(dot(px, py, r*0.016, 0.85, "#E8C87E"))
    out.append('</g>')
    return "".join(out)

def rose(cx, cy, r, rot_deg=0, grad="roseA", rng=None):
    rng = rng or random.Random(11)
    out = ['<g class="bloom">']
    # outer cupped petals
    for ri, rf in enumerate((1.0, 0.78, 0.58)):
        n = 6 - ri
        for i in range(n):
            a = rot_deg + i*(360.0/n) + ri*24 + rng.uniform(-4, 4)
            out.append(f'<path d="{petal_path(cx, cy, a, r*rf, r*rf*0.56, rng.uniform(-0.1,0.1))}" '
                       f'fill="url(#{grad}{min(ri,2)})" stroke="#D7A09B" stroke-width="{f(r*0.012)}" stroke-opacity="0.35"/>')
    # spiral heart
    steps = 16
    for i in range(steps):
        t = i/steps
        a = rot_deg + i*47
        rr = r*(0.42 - t*0.30)
        ox, oy = rot(cx, cy - r*0.06*t, cx, cy, a*0.5)
        out.append(f'<path d="{petal_path(ox, oy, a, rr, rr*0.72, 0.25)}" fill="url(#{grad}2)" '
                   f'stroke="#D7A09B" stroke-width="{f(r*0.008)}" stroke-opacity="0.35"/>')
    out.append('</g>')
    return "".join(out)

def ranunculus(cx, cy, r, rot_deg=0, grad="ivoryA", rng=None):
    rng = rng or random.Random(3)
    out = ['<g class="bloom">']
    for ri, rf in enumerate((1.0, 0.80, 0.62, 0.46, 0.32, 0.20)):
        n = max(4, 10 - ri)
        for i in range(n):
            a = rot_deg + i*(360.0/n) + ri*17
            out.append(f'<path d="{petal_path(cx, cy, a, r*rf, r*rf*0.55, 0)}" fill="url(#{grad}{min(ri,2)})" '
                       f'stroke="#DCC6B4" stroke-width="{f(r*0.010)}" stroke-opacity="0.45"/>')
    out.append(f'<circle cx="{f(cx)}" cy="{f(cy)}" r="{f(r*0.06)}" fill="#D9BE86" opacity="0.8"/>')
    out.append('</g>')
    return "".join(out)

# ---------------------------------------------------------------- foliage
def leaf(x, y, ang, L, W, fill="url(#leafA)", stroke="#9DAE92", vein=True):
    p = petal_path(x, y, ang, L, W, 0)
    tipx, tipy = rot(x, y - L, x, y, ang)
    out = [f'<path d="{p}" fill="{fill}" stroke="{stroke}" stroke-width="{f(L*0.018)}" stroke-opacity="0.5"/>']
    if vein:
        out.append(f'<path d="M {f(x)} {f(y)} L {f(tipx)} {f(tipy)}" stroke="{stroke}" stroke-width="{f(L*0.016)}" '
                   f'stroke-opacity="0.45" fill="none" stroke-linecap="round"/>')
    return "".join(out)

def eucalyptus(x, y, ang, length, size=1.0, rng=None, flip=1):
    """Round-leaf silver dollar eucalyptus sprig."""
    rng = rng or random.Random(5)
    steps = 9
    ex, ey = rot(x, y - length, x, y, ang)
    cx1, cy1 = rot(x + flip*length*0.22, y - length*0.45, x, y, ang)
    out = [f'<path d="M {f(x)} {f(y)} Q {f(cx1)} {f(cy1)} {f(ex)} {f(ey)}" fill="none" '
           f'stroke="#A8B79C" stroke-width="{f(2.0*size)}" stroke-linecap="round" opacity="0.9"/>']
    for i in range(steps):
        t = (i+1)/(steps+1)
        # quadratic point
        px = (1-t)**2*x + 2*(1-t)*t*cx1 + t**2*ex
        py = (1-t)**2*y + 2*(1-t)*t*cy1 + t**2*ey
        rr = (14 + 9*math.sin(t*math.pi))*size*(1-t*0.45)
        for s in (-1, 1):
            a = ang + s*(62 + rng.uniform(-10, 10)) + 180
            lx, ly = rot(px + s*rr*0.55, py, px, py, ang)
            out.append(f'<ellipse cx="{f(lx)}" cy="{f(ly)}" rx="{f(rr*0.62)}" ry="{f(rr*0.52)}" '
                       f'transform="rotate({f(ang + s*18)} {f(lx)} {f(ly)})" fill="url(#leafB)" '
                       f'stroke="#9DAE92" stroke-width="{f(0.9*size)}" stroke-opacity="0.45" opacity="0.95"/>')
    return "".join(out)

def foliage_spray(x, y, ang, length, n=7, size=1.0, rng=None, fill="url(#leafA)"):
    rng = rng or random.Random(9)
    ex, ey = rot(x, y - length, x, y, ang)
    cx1, cy1 = rot(x + length*0.18, y - length*0.5, x, y, ang)
    out = [f'<path d="M {f(x)} {f(y)} Q {f(cx1)} {f(cy1)} {f(ex)} {f(ey)}" fill="none" stroke="#A3B396" '
           f'stroke-width="{f(2.2*size)}" stroke-linecap="round" opacity="0.85"/>']
    for i in range(n):
        t = (i+1)/(n+1)
        px = (1-t)**2*x + 2*(1-t)*t*cx1 + t**2*ex
        py = (1-t)**2*y + 2*(1-t)*t*cy1 + t**2*ey
        L = (46 - 26*t)*size
        for s in (-1, 1):
            out.append(leaf(px, py, ang + s*52 + rng.uniform(-8, 8), L, L*0.30, fill))
    return "".join(out)

def babys_breath(x, y, ang, length, size=1.0, rng=None):
    rng = rng or random.Random(13)
    out = []
    for b in range(5):
        a = ang + rng.uniform(-30, 30)
        L = length*rng.uniform(0.6, 1.0)
        ex, ey = rot(x, y - L, x, y, a)
        out.append(f'<path d="M {f(x)} {f(y)} Q {f((x+ex)/2 + rng.uniform(-12,12))} {f((y+ey)/2)} {f(ex)} {f(ey)}" '
                   f'fill="none" stroke="#BCC7B2" stroke-width="{f(1.1*size)}" opacity="0.7"/>')
        for k in range(4):
            t = 0.45 + k*0.18
            px = x + (ex-x)*t + rng.uniform(-7, 7)
            py = y + (ey-y)*t + rng.uniform(-7, 7)
            rr = rng.uniform(2.6, 4.6)*size
            out.append(f'<circle cx="{f(px)}" cy="{f(py)}" r="{f(rr)}" fill="#FFFBF5" stroke="#E6D9C8" '
                       f'stroke-width="0.6" opacity="0.95"/>')
    return "".join(out)

def gold_sprig(x, y, ang, length, size=1.0, rng=None):
    """Delicate gold-leaf accent branch."""
    rng = rng or random.Random(17)
    ex, ey = rot(x, y - length, x, y, ang)
    cx1, cy1 = rot(x + length*0.20, y - length*0.5, x, y, ang)
    out = [f'<path d="M {f(x)} {f(y)} Q {f(cx1)} {f(cy1)} {f(ex)} {f(ey)}" fill="none" stroke="url(#goldLine)" '
           f'stroke-width="{f(1.6*size)}" stroke-linecap="round" opacity="0.9"/>']
    for i in range(7):
        t = (i+1)/8
        px = (1-t)**2*x + 2*(1-t)*t*cx1 + t**2*ex
        py = (1-t)**2*y + 2*(1-t)*t*cy1 + t**2*ey
        L = (26 - 15*t)*size
        for s in (-1, 1):
            out.append(f'<path d="{petal_path(px, py, ang + s*54, L, L*0.26, 0)}" fill="url(#goldFill)" opacity="0.85"/>')
    return "".join(out)
