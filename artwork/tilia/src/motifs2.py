# -*- coding: utf-8 -*-
"""Design II motifs: pointed Islamic arch, crescent moon, geometric ground."""
import math, random
from elements import f, rot, dot, sparkle

# ---------------------------------------------------------------- arch geometry
class Arch:
    """Two-centred pointed arch. Sides run from base_y up to spring_y,
    then two mirrored cubics meet at the apex."""
    def __init__(self, cx, half_w, base_y, spring_y, apex_y, bulge=0.42, shoulder=0.62):
        self.cx, self.hw = cx, half_w
        self.base_y, self.spring_y, self.apex_y = base_y, spring_y, apex_y
        h = spring_y - apex_y
        # left curve control points: (spring) -> (apex)
        self.p0 = (cx - half_w, spring_y)
        self.p1 = (cx - half_w, spring_y - h*shoulder)
        self.p2 = (cx - half_w*bulge, apex_y + h*0.06)
        self.p3 = (cx, apex_y)

    def pt(self, t, side=-1):
        """Point on the arch curve; t=0 at the springing, 1 at the apex."""
        p0, p1, p2, p3 = self.p0, self.p1, self.p2, self.p3
        x = ((1-t)**3*p0[0] + 3*(1-t)**2*t*p1[0] + 3*(1-t)*t**2*p2[0] + t**3*p3[0])
        y = ((1-t)**3*p0[1] + 3*(1-t)**2*t*p1[1] + 3*(1-t)*t**2*p2[1] + t**3*p3[1])
        if side == 1:
            x = 2*self.cx - x
        return (x, y)

    def tangent(self, t, side=-1):
        a = self.pt(max(0.0, t-0.004), side); b = self.pt(min(1.0, t+0.004), side)
        return math.degrees(math.atan2(b[1]-a[1], b[0]-a[0]))

    def outline(self, inset=0.0, close_base=True):
        """SVG path for the arch, optionally shrunk toward the centre."""
        k = 1 - inset/self.hw if self.hw else 1
        def sx(x): return self.cx + (x - self.cx)*k
        p0, p1, p2, p3 = self.p0, self.p1, self.p2, self.p3
        ay = self.apex_y + inset*0.92
        d = [f"M {f(sx(p0[0]))} {f(self.base_y)}", f"L {f(sx(p0[0]))} {f(p0[1])}"]
        d.append(f"C {f(sx(p1[0]))} {f(p1[1]+inset*0.30)} {f(sx(p2[0]))} {f(p2[1]+inset*0.80)} {f(self.cx)} {f(ay)}")
        d.append(f"C {f(2*self.cx - sx(p2[0]))} {f(p2[1]+inset*0.80)} {f(2*self.cx - sx(p1[0]))} {f(p1[1]+inset*0.30)} {f(2*self.cx - sx(p0[0]))} {f(p0[1])}")
        d.append(f"L {f(2*self.cx - sx(p0[0]))} {f(self.base_y)}")
        if close_base:
            d.append("Z")
        return " ".join(d)

def arch_frame(arch, rng=None):
    """Gold moulding: outer mouldings, foliated intrados, capitals, base, keystone."""
    rng = rng or random.Random(5)
    focus = (arch.cx, arch.spring_y + 60)

    def inward(pt, d):
        vx, vy = focus[0]-pt[0], focus[1]-pt[1]
        n = math.hypot(vx, vy) or 1
        return (pt[0] + vx/n*d, pt[1] + vy/n*d)

    o = ['<g class="arch">']
    o.append(f'<path d="{arch.outline(0)}" fill="none" stroke="url(#goldLine)" stroke-width="3.2"/>')
    o.append(f'<path d="{arch.outline(10)}" fill="none" stroke="url(#goldLine)" stroke-width="1.0" opacity="0.7"/>')
    o.append(f'<path d="{arch.outline(27)}" fill="none" stroke="url(#goldLine)" stroke-width="1.9" opacity="0.92"/>')

    # --- foliated (cusped) intrados
    for side in (-1, 1):
        n = 8
        for i in range(n):
            t0 = 0.03 + (0.92)*i/n
            t1 = 0.03 + (0.92)*(i+1)/n
            a = inward(arch.pt(t0, side), 27)
            b = inward(arch.pt(t1, side), 27)
            mx, my = (a[0]+b[0])/2, (a[1]+b[1])/2
            im = inward((mx, my), 15 + 7*math.sin(t0*math.pi))
            o.append(f'<path d="M {f(a[0])} {f(a[1])} Q {f(im[0])} {f(im[1])} {f(b[0])} {f(b[1])}" '
                     f'fill="none" stroke="url(#goldLine)" stroke-width="1.6" opacity="0.9"/>')
            o.append(f'<circle cx="{f(a[0])}" cy="{f(a[1])}" r="2.4" fill="url(#goldFill)"/>')
        # cusp pendant where the foliation meets the springing
        e = inward(arch.pt(0.03, side), 27)
        o.append(f'<circle cx="{f(e[0])}" cy="{f(e[1])}" r="3.2" fill="url(#pearl)" stroke="#C9A45E" stroke-width="0.9"/>')

    # --- springing collar
    for s in (-1, 1):
        x = arch.cx + s*arch.hw
        o.append(f'<path d="M {f(x + s*9)} {f(arch.spring_y-6)} L {f(x - s*40)} {f(arch.spring_y-6)} '
                 f'L {f(x - s*40)} {f(arch.spring_y+6)} L {f(x + s*9)} {f(arch.spring_y+6)} Z" fill="url(#goldFill)" opacity="0.95"/>')
        cxp = x - s*17
        o.append(f'<path d="M {f(cxp)} {f(arch.spring_y-11)} L {f(cxp+8)} {f(arch.spring_y)} '
                 f'L {f(cxp)} {f(arch.spring_y+11)} L {f(cxp-8)} {f(arch.spring_y)} Z" '
                 f'fill="url(#goldFill)" stroke="#BE9445" stroke-width="0.8"/>')
        o.append(f'<circle cx="{f(cxp)}" cy="{f(arch.spring_y)}" r="2.2" fill="#FFF8E2"/>')

    # --- base moulding
    by = arch.base_y
    o.append(f'<path d="M {f(arch.cx-arch.hw-16)} {f(by)} L {f(arch.cx+arch.hw+16)} {f(by)}" stroke="url(#goldLine)" stroke-width="3.0"/>')
    o.append(f'<path d="M {f(arch.cx-arch.hw-26)} {f(by+10)} L {f(arch.cx+arch.hw+26)} {f(by+10)}" stroke="url(#goldLine)" stroke-width="1.6" opacity="0.8"/>')
    for i in range(21):
        x = arch.cx - arch.hw + (2*arch.hw)*i/20
        o.append(f'<circle cx="{f(x)}" cy="{f(by-8)}" r="2.3" fill="url(#goldFill)" opacity="0.8"/>')
    for s in (-1, 1):
        o.append(f'<circle cx="{f(arch.cx + s*(arch.hw+16))}" cy="{f(by)}" r="4.4" fill="url(#goldFill)" stroke="#B9913F" stroke-width="0.9"/>')

    # --- keystone rosette at the apex
    o.append(rosette(arch.cx, arch.apex_y + 36, 21))
    o.append('</g>')
    return "".join(o)

def rosette(cx, cy, r, petals=8):
    o = [f'<circle cx="{f(cx)}" cy="{f(cy)}" r="{f(r)}" fill="none" stroke="url(#goldLine)" stroke-width="1.3" opacity="0.9"/>']
    for i in range(petals):
        a = i*(360/petals)
        px, py = rot(cx, cy - r*0.56, cx, cy, a)
        o.append(f'<ellipse cx="{f(px)}" cy="{f(py)}" rx="{f(r*0.20)}" ry="{f(r*0.36)}" '
                 f'transform="rotate({f(a)} {f(px)} {f(py)})" fill="url(#goldFill)" opacity="0.92"/>')
    o.append(f'<circle cx="{f(cx)}" cy="{f(cy)}" r="{f(r*0.17)}" fill="url(#pearl)" stroke="#C9A45E" stroke-width="0.8"/>')
    return "".join(o)

# ---------------------------------------------------------------- crescent
def crescent(cx, cy, R, tilt=-24, thin=0.845, off=0.30):
    """Gold crescent moon; `thin` and `off` set how slender the sickle is."""
    r = R*thin; dx = R*off
    ix = (R*R - r*r + dx*dx)/(2*dx)
    iy = math.sqrt(max(R*R - ix*ix, 1e-6))
    d = (f"M {f(cx+ix)} {f(cy-iy)} "
         f"A {f(R)} {f(R)} 0 1 0 {f(cx+ix)} {f(cy+iy)} "
         f"A {f(r)} {f(r)} 0 1 1 {f(cx+ix)} {f(cy-iy)} Z")
    o = [f'<g transform="rotate({f(tilt)} {f(cx)} {f(cy)})">']
    o.append(f'<circle cx="{f(cx)}" cy="{f(cy)}" r="{f(R*1.28)}" fill="url(#moonGlow)" opacity="0.9"/>')
    o.append(f'<path d="{d}" fill="url(#moonFill)" stroke="url(#goldLine)" stroke-width="{f(R*0.022)}"/>')
    o.append(f'<path d="{d}" fill="url(#moonSheen)" opacity="0.55"/>')
    # fine engraved line inside the sickle
    o.append(f'<path d="M {f(cx+ix*0.94)} {f(cy-iy*0.86)} A {f(R*0.90)} {f(R*0.90)} 0 1 0 {f(cx+ix*0.94)} {f(cy+iy*0.86)}" '
             f'fill="none" stroke="#FBEBC6" stroke-width="{f(R*0.014)}" opacity="0.55"/>')
    o.append('</g>')
    return "".join(o)

# ---------------------------------------------------------------- geometric ground
def star8(cx, cy, r, rot_deg=0):
    pts = []
    for i in range(16):
        rr = r if i % 2 == 0 else r*0.415
        a = rot_deg + i*22.5
        pts.append(rot(cx, cy - rr, cx, cy, a))
    return "M " + " L ".join(f"{f(x)} {f(y)}" for x, y in pts) + " Z"

def geometric_ground(x0, y0, x1, y1, step=118, opacity=0.16):
    """Faint interlaced 8-point-star tessellation."""
    o = [f'<g class="geo" opacity="{opacity}">']
    row = 0
    y = y0
    while y < y1 + step:
        xoff = (step/2 if row % 2 else 0)
        x = x0 - step
        while x < x1 + step:
            o.append(f'<path d="{star8(x+xoff, y, step*0.30, 22.5)}" fill="none" stroke="#C9A45E" stroke-width="0.9"/>')
            o.append(f'<path d="{star8(x+xoff+step/2, y+step/2, step*0.115, 0)}" fill="none" stroke="#C9A45E" stroke-width="0.7"/>')
            x += step
        y += step; row += 1
    o.append('</g>')
    return "".join(o)

# ---------------------------------------------------------------- lantern-free swag helper
def swag_points(arch, side, t0, t1, n):
    """Evenly spaced anchor points along one side of the arch curve."""
    return [arch.pt(t0 + (t1-t0)*i/(n-1), side) for i in range(n)]
