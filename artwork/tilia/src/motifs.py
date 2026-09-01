# -*- coding: utf-8 -*-
"""Crown, wings, cradle, filigree frame."""
import math, random
from elements import f, rot, dot, sparkle

# ---------------------------------------------------------------- crown
def crown(cx, cy, w, h):
    """Openwork gold coronet. (cx,cy) is the centre of the band."""
    hw = w/2
    band_t = h*0.19
    by = cy + h*0.40          # band top
    bb = by + band_t
    out = ['<g class="crown">']

    peaks = [(-0.86, 0.46), (-0.45, 0.78), (0.0, 1.00), (0.45, 0.78), (0.86, 0.46)]

    # --- openwork lancet arches
    for px, ph in peaks:
        ax = cx + px*hw
        ph_h = h*ph*0.86
        half = w*(0.115 if abs(px) < 0.2 else 0.100 if abs(px) < 0.6 else 0.086)
        apex = by - ph_h
        d = (f"M {f(ax-half)} {f(by)} "
             f"C {f(ax-half*0.98)} {f(by - ph_h*0.52)} {f(ax-half*0.50)} {f(by - ph_h*0.86)} {f(ax)} {f(apex)} "
             f"C {f(ax+half*0.50)} {f(by - ph_h*0.86)} {f(ax+half*0.98)} {f(by - ph_h*0.52)} {f(ax+half)} {f(by)} Z")
        out.append(f'<path d="{d}" fill="url(#goldFill)" fill-opacity="0.42" stroke="url(#goldLine)" '
                   f'stroke-width="{f(w*0.016)}" stroke-linejoin="round"/>')
        # inner lancet outline (openwork)
        ih = ph_h*0.62; ihalf = half*0.52
        out.append(f'<path d="M {f(ax-ihalf)} {f(by-h*0.02)} C {f(ax-ihalf)} {f(by-ih*0.62)} {f(ax-ihalf*0.5)} {f(by-ih*0.92)} '
                   f'{f(ax)} {f(by-ih)} C {f(ax+ihalf*0.5)} {f(by-ih*0.92)} {f(ax+ihalf)} {f(by-ih*0.62)} {f(ax+ihalf)} {f(by-h*0.02)}" '
                   f'fill="none" stroke="url(#goldLine)" stroke-width="{f(w*0.009)}" opacity="0.85"/>')
        # tiny scroll curl inside
        out.append(f'<path d="M {f(ax)} {f(by-h*0.04)} q {f(-w*0.030)} {f(-ph_h*0.30)} 0 {f(-ph_h*0.46)} '
                   f'q {f(w*0.030)} {f(ph_h*0.16)} 0 {f(ph_h*0.46)} Z" fill="#FBEBC6" opacity="0.55"/>')

    # --- filler scrolls in the valleys
    for i in range(len(peaks)-1):
        vx = cx + (peaks[i][0] + peaks[i+1][0])/2*hw
        out.append(f'<path d="M {f(vx)} {f(by)} q {f(-w*0.045)} {f(-h*0.16)} 0 {f(-h*0.26)} '
                   f'q {f(w*0.045)} {f(h*0.10)} 0 {f(h*0.26)} Z" fill="url(#goldFill)" opacity="0.85"/>')
        out.append(f'<circle cx="{f(vx)}" cy="{f(by - h*0.30)}" r="{f(w*0.016)}" fill="url(#pearl)" stroke="#C9A45E" stroke-width="{f(w*0.005)}"/>')

    # --- pearls crowning each point
    for px, ph in peaks:
        ax = cx + px*hw; ay = by - h*ph*0.86
        r = w*(0.050 if abs(px) < 0.2 else 0.042 if abs(px) < 0.6 else 0.034)
        out.append(f'<circle cx="{f(ax)}" cy="{f(ay - r*0.75)}" r="{f(r)}" fill="url(#pearl)" stroke="#C9A45E" stroke-width="{f(w*0.006)}"/>')
        out.append(f'<circle cx="{f(ax - r*0.30)}" cy="{f(ay - r*1.05)}" r="{f(r*0.30)}" fill="#FFFFFF" opacity="0.9"/>')

    # --- band
    out.append(f'<rect x="{f(cx-hw*1.06)}" y="{f(by)}" width="{f(w*1.06)}" height="{f(band_t)}" rx="{f(band_t*0.45)}" '
               f'fill="url(#goldFill)" stroke="url(#goldLine)" stroke-width="{f(w*0.013)}"/>')
    out.append(f'<rect x="{f(cx-hw*1.02)}" y="{f(by+band_t*0.14)}" width="{f(w*1.02 - w*0.02)}" height="{f(band_t*0.20)}" '
               f'rx="{f(band_t*0.10)}" fill="#FDF2D6" opacity="0.55"/>')
    n = 9
    for i in range(n):
        gx = cx - hw*1.06 + w*1.06*(i+0.5)/n
        rr = w*0.019 if i % 2 == 0 else w*0.012
        col = "url(#gemBlush)" if i % 2 == 0 else "url(#pearl)"
        out.append(f'<circle cx="{f(gx)}" cy="{f(by + band_t*0.62)}" r="{f(rr)}" fill="{col}" stroke="#C9A45E" stroke-width="{f(w*0.004)}"/>')
    # centre drop gem
    out.append(f'<ellipse cx="{f(cx)}" cy="{f(bb + h*0.055)}" rx="{f(w*0.028)}" ry="{f(w*0.042)}" fill="url(#gemBlush)" '
               f'stroke="#C9A45E" stroke-width="{f(w*0.006)}"/>')
    out.append(f'<circle cx="{f(cx - w*0.010)}" cy="{f(bb + h*0.035)}" r="{f(w*0.008)}" fill="#FFFFFF" opacity="0.8"/>')
    out.append('</g>')
    return "".join(out)

# ---------------------------------------------------------------- wings
def wing(cx, cy, w, h, side=1, rng=None):
    """Soft feathered angel wing sweeping outward from (cx,cy)."""
    rng = rng or random.Random(23)
    out = ['<g class="wing">']
    # downy glow behind
    out.append(f'<ellipse cx="{f(cx + side*w*0.40)}" cy="{f(cy - h*0.26)}" rx="{f(w*0.50)}" ry="{f(h*0.42)}" '
               f'transform="rotate({f(side*-18)} {f(cx + side*w*0.40)} {f(cy - h*0.26)})" '
               f'fill="#FFFFFF" opacity="0.40" filter="url(#midBlur)"/>')
    rows = [
        # n, lenBase, angRoot, angTip, spanX, arch, widthK, fill
        (12, 1.00, 128, 56, 1.00, 0.46, 0.150, "url(#featherC)"),
        (10, 0.78, 132, 62, 0.82, 0.37, 0.158, "url(#featherB)"),
        ( 8, 0.57, 136, 70, 0.63, 0.27, 0.170, "url(#featherA)"),
        ( 6, 0.39, 141, 80, 0.44, 0.17, 0.186, "url(#featherA)"),
        ( 4, 0.25, 146, 92, 0.27, 0.09, 0.210, "url(#featherA)"),
    ]
    for ri, (n, bl, a0, a1, sx, arch, wk, fill) in enumerate(rows):
        for i in range(n):
            t = i/(n-1)
            ang = a0 + (a1-a0)*t
            L = h*bl*(0.60 + 0.40*(t**0.8))*rng.uniform(0.97, 1.03)
            px = cx + side*w*sx*(t**0.82)
            py = cy - h*arch*math.sin(t*math.pi*0.58)**0.9 - h*0.014*ri
            adeg = side*ang
            W = L*wk
            pts = [(0,0), (-W, -L*0.24), (-W*0.90, -L*0.82), (0, -L),
                   (W*0.90, -L*0.82), (W, -L*0.24), (0,0)]
            P = [rot(px+dx, py+dy, px, py, adeg) for dx, dy in pts]
            d = (f"M {f(P[0][0])} {f(P[0][1])} C {f(P[1][0])} {f(P[1][1])} {f(P[2][0])} {f(P[2][1])} {f(P[3][0])} {f(P[3][1])} "
                 f"C {f(P[4][0])} {f(P[4][1])} {f(P[5][0])} {f(P[5][1])} {f(P[6][0])} {f(P[6][1])} Z")
            out.append(f'<path d="{d}" fill="{fill}" stroke="#E4D6C7" stroke-width="{f(L*0.011)}" stroke-opacity="0.5"/>')
            tipx, tipy = rot(px, py - L*0.84, px, py, adeg)
            out.append(f'<path d="M {f(px)} {f(py)} L {f(tipx)} {f(tipy)}" stroke="#EADCCC" stroke-width="{f(L*0.010)}" '
                       f'stroke-opacity="0.55" fill="none" stroke-linecap="round"/>')
    # downy shoulder tufts
    for k in range(5):
        ox = cx + side*w*0.038*k
        oy = cy - h*0.02 - k*h*0.026
        out.append(f'<ellipse cx="{f(ox)}" cy="{f(oy)}" rx="{f(w*0.085 - k*w*0.010)}" ry="{f(h*0.058 - k*h*0.006)}" '
                   f'transform="rotate({f(side*-22)} {f(ox)} {f(oy)})" fill="#FFFEFB" opacity="0.72"/>')
    out.append('</g>')
    return "".join(out)

# ---------------------------------------------------------------- cradle
def cradle(cx, cy, w, h, rng=None):
    """Gilded bassinet with a hooded canopy, silk bedding and rockers.
    (cx,cy) = centre of the basket body."""
    rng = rng or random.Random(101)
    hw, hh = w/2, h/2
    rail_y = cy - hh*0.62                 # top rail line
    out = ['<g class="cradle">']

    # ================= rockers & stand =================
    ry = cy + hh*1.00
    out.append(f'<path d="M {f(cx-hw*0.94)} {f(ry-h*0.10)} Q {f(cx)} {f(ry+h*0.24)} {f(cx+hw*0.94)} {f(ry-h*0.10)}" '
               f'fill="none" stroke="url(#goldLine)" stroke-width="{f(h*0.052)}" stroke-linecap="round"/>')
    out.append(f'<path d="M {f(cx-hw*0.94)} {f(ry-h*0.10)} Q {f(cx)} {f(ry+h*0.24)} {f(cx+hw*0.94)} {f(ry-h*0.10)}" '
               f'fill="none" stroke="#FCEFD0" stroke-width="{f(h*0.012)}" opacity="0.75"/>')
    for s in (-1, 1):
        out.append(f'<circle cx="{f(cx + s*hw*0.94)}" cy="{f(ry - h*0.10)}" r="{f(h*0.042)}" fill="url(#goldFill)" '
                   f'stroke="#B9913F" stroke-width="1.4"/>')
    # crossed legs
    for s in (-1, 1):
        out.append(f'<path d="M {f(cx + s*hw*0.64)} {f(cy+hh*0.34)} C {f(cx + s*hw*0.80)} {f(cy+hh*0.72)} '
                   f'{f(cx + s*hw*0.74)} {f(cy+hh*0.90)} {f(cx + s*hw*0.64)} {f(ry - h*0.048)}" '
                   f'fill="none" stroke="url(#goldLine)" stroke-width="{f(h*0.030)}" stroke-linecap="round"/>')

    # ================= hood / canopy shell (left end) =================
    hood_top = rail_y - h*0.86
    hood = (f"M {f(cx-hw*0.98)} {f(rail_y+h*0.04)} "
            f"C {f(cx-hw*1.04)} {f(rail_y-h*0.44)} {f(cx-hw*0.76)} {f(hood_top)} {f(cx-hw*0.24)} {f(hood_top+h*0.03)} "
            f"C {f(cx-hw*0.02)} {f(hood_top+h*0.06)} {f(cx+hw*0.06)} {f(rail_y-h*0.22)} {f(cx+hw*0.04)} {f(rail_y+h*0.02)} Z")
    out.append(f'<path d="{hood}" fill="url(#hoodFill)" stroke="url(#goldLine)" stroke-width="{f(h*0.020)}"/>')
    # hood ribs
    for i in range(1, 4):
        t = i/4.6
        sxp = cx - hw*(0.98 - 1.02*t)
        out.append(f'<path d="M {f(cx-hw*0.98)} {f(rail_y+h*0.02)} Q {f(cx-hw*(0.86-0.86*t))} {f(hood_top + h*0.10 + t*h*0.10)} '
                   f'{f(sxp + hw*0.02)} {f(hood_top + h*0.04 + t*t*h*0.44)}" fill="none" stroke="#E4CEA4" '
                   f'stroke-width="1.1" opacity="0.40"/>')
    # hood inner lining
    out.append(f'<path d="M {f(cx-hw*0.86)} {f(rail_y+h*0.02)} C {f(cx-hw*0.90)} {f(rail_y-h*0.38)} {f(cx-hw*0.66)} {f(hood_top+h*0.14)} '
               f'{f(cx-hw*0.24)} {f(hood_top+h*0.16)} C {f(cx-hw*0.06)} {f(hood_top+h*0.20)} {f(cx-hw*0.02)} {f(rail_y-h*0.20)} '
               f'{f(cx-hw*0.04)} {f(rail_y+h*0.02)} Z" fill="url(#silkFill)" opacity="0.95"/>')
    # scalloped gold trim on the hood edge
    steps = 9
    for i in range(steps):
        t0, t1 = i/steps, (i+1)/steps
        def hp(t):
            # cubic along the hood outer edge
            p0=(cx-hw*0.98, rail_y+h*0.04); p1=(cx-hw*1.04, rail_y-h*0.44)
            p2=(cx-hw*0.76, hood_top); p3=(cx-hw*0.24, hood_top+h*0.03)
            return ((1-t)**3*p0[0]+3*(1-t)**2*t*p1[0]+3*(1-t)*t**2*p2[0]+t**3*p3[0],
                    (1-t)**3*p0[1]+3*(1-t)**2*t*p1[1]+3*(1-t)*t**2*p2[1]+t**3*p3[1])
        a, b = hp(t0), hp(t1)
        mx, my = (a[0]+b[0])/2, (a[1]+b[1])/2
        nx, ny = -(b[1]-a[1]), (b[0]-a[0])
        nl = math.hypot(nx, ny) or 1
        k = h*0.045
        out.append(f'<path d="M {f(a[0])} {f(a[1])} Q {f(mx - nx/nl*k)} {f(my - ny/nl*k)} {f(b[0])} {f(b[1])}" '
                   f'fill="none" stroke="url(#goldLine)" stroke-width="{f(h*0.012)}" opacity="0.9"/>')

    # ================= basket body =================
    body = (f"M {f(cx-hw)} {f(rail_y)} "
            f"C {f(cx-hw*0.97)} {f(cy+hh*0.30)} {f(cx-hw*0.60)} {f(cy+hh*0.76)} {f(cx)} {f(cy+hh*0.78)} "
            f"C {f(cx+hw*0.60)} {f(cy+hh*0.76)} {f(cx+hw*0.97)} {f(cy+hh*0.30)} {f(cx+hw)} {f(rail_y)} Z")
    out.append(f'<path d="{body}" fill="url(#basketFill)" stroke="url(#goldLine)" stroke-width="{f(h*0.024)}"/>')
    # woven/scroll panelling
    for i in range(-4, 5):
        px = cx + i*hw*0.195
        k = 1 - abs(i)/5.6
        out.append(f'<path d="M {f(px)} {f(rail_y + h*0.05)} Q {f(px - hw*0.085*k)} {f(cy+hh*0.20)} {f(px)} {f(cy+hh*0.62*k + hh*0.08)} '
                   f'Q {f(px + hw*0.085*k)} {f(cy+hh*0.20)} {f(px)} {f(rail_y + h*0.05)} Z" fill="#F7E4B8" opacity="0.20"/>')
        out.append(f'<path d="M {f(px)} {f(rail_y + h*0.05)} Q {f(px - hw*0.085*k)} {f(cy+hh*0.20)} {f(px)} {f(cy+hh*0.62*k + hh*0.08)}" '
                   f'fill="none" stroke="#CFA busy" stroke-width="1.1" opacity="0.45"/>'.replace("#CFA busy", "#CFA85F"))
    # decorative gold band round the belly
    out.append(f'<path d="M {f(cx-hw*0.95)} {f(cy+hh*0.06)} C {f(cx-hw*0.60)} {f(cy+hh*0.40)} {f(cx+hw*0.60)} {f(cy+hh*0.40)} {f(cx+hw*0.95)} {f(cy+hh*0.06)}" '
               f'fill="none" stroke="url(#goldLine)" stroke-width="{f(h*0.016)}" opacity="0.85"/>')

    # ================= top rail =================
    out.append(f'<ellipse cx="{f(cx)}" cy="{f(rail_y)}" rx="{f(hw)}" ry="{f(hh*0.185)}" fill="url(#goldFill)" '
               f'stroke="url(#goldLine)" stroke-width="{f(h*0.018)}"/>')
    out.append(f'<ellipse cx="{f(cx)}" cy="{f(rail_y)}" rx="{f(hw*0.905)}" ry="{f(hh*0.135)}" fill="#C99C63" opacity="0.5"/>')

    # ================= bedding: mattress, pillow, blanket =================
    out.append(f'<path d="M {f(cx-hw*0.88)} {f(rail_y - hh*0.02)} Q {f(cx)} {f(rail_y - hh*0.40)} {f(cx+hw*0.88)} {f(rail_y - hh*0.02)} '
               f'Q {f(cx)} {f(rail_y + hh*0.16)} {f(cx-hw*0.88)} {f(rail_y - hh*0.02)} Z" fill="url(#silkFill)"/>')
    # pillow tucked under the hood
    out.append(f'<ellipse cx="{f(cx-hw*0.46)}" cy="{f(rail_y - hh*0.16)}" rx="{f(hw*0.30)}" ry="{f(hh*0.20)}" '
               f'transform="rotate(-6 {f(cx-hw*0.46)} {f(rail_y - hh*0.16)})" fill="url(#silkFill)" stroke="#E5D3BC" stroke-width="1.2"/>')
    out.append(f'<ellipse cx="{f(cx-hw*0.46)}" cy="{f(rail_y - hh*0.19)}" rx="{f(hw*0.20)}" ry="{f(hh*0.11)}" fill="#FFFFFF" opacity="0.65"/>')
    # blanket folded over the front rail
    blanket = (f"M {f(cx+hw*0.02)} {f(rail_y + hh*0.03)} "
               f"C {f(cx+hw*0.08)} {f(rail_y - hh*0.22)} {f(cx+hw*0.40)} {f(rail_y - hh*0.24)} {f(cx+hw*0.50)} {f(rail_y + hh*0.05)} "
               f"C {f(cx+hw*0.56)} {f(cy+hh*0.26)} {f(cx+hw*0.52)} {f(cy+hh*0.52)} {f(cx+hw*0.47)} {f(cy+hh*0.68)} "
               f"C {f(cx+hw*0.36)} {f(cy+hh*0.77)} {f(cx+hw*0.17)} {f(cy+hh*0.75)} {f(cx+hw*0.06)} {f(cy+hh*0.64)} "
               f"C {f(cx-hw*0.01)} {f(cy+hh*0.40)} {f(cx-hw*0.01)} {f(cy+hh*0.16)} {f(cx+hw*0.02)} {f(rail_y + hh*0.03)} Z")
    out.append(f'<path d="{blanket}" fill="url(#drapeFill)" stroke="#E4D2BA" stroke-width="1.2" opacity="0.97"/>')
    out.append(f'<path d="{blanket}" fill="url(#drapeShade)" opacity="0.6"/>')
    # the crest of the fold sitting on the rail
    out.append(f'<path d="M {f(cx+hw*0.03)} {f(rail_y + hh*0.02)} C {f(cx+hw*0.09)} {f(rail_y - hh*0.19)} {f(cx+hw*0.39)} {f(rail_y - hh*0.21)} '
               f'{f(cx+hw*0.49)} {f(rail_y + hh*0.04)} C {f(cx+hw*0.36)} {f(rail_y + hh*0.16)} {f(cx+hw*0.14)} {f(rail_y + hh*0.16)} '
               f'{f(cx+hw*0.03)} {f(rail_y + hh*0.02)} Z" fill="#FFFDF8" opacity="0.75"/>')
    for i in range(5):
        px = cx + hw*(0.09 + i*0.085)
        out.append(f'<path d="M {f(px)} {f(rail_y + hh*0.10)} C {f(px + hw*0.022)} {f(cy+hh*0.14)} {f(px - hw*0.010)} {f(cy+hh*0.40)} '
                   f'{f(px - hw*0.030)} {f(cy+hh*0.66 - abs(i-2)*h*0.016)}" fill="none" stroke="#E0CBB0" stroke-width="1.15" opacity="0.5"/>')
    # scalloped lace hem
    for i in range(6):
        t = i/6
        px = cx + hw*(0.075 + t*0.335); py = cy + hh*(0.685 + 0.055*math.sin(t*math.pi))
        out.append(f'<path d="M {f(px)} {f(py)} q {f(hw*0.030)} {f(h*0.022)} {f(hw*0.060)} 0" fill="none" '
                   f'stroke="#F1E0C8" stroke-width="1.2" opacity="0.85"/>')
    # slim satin ribbon across the fold
    out.append(f'<path d="M {f(cx+hw*0.08)} {f(rail_y + hh*0.06)} C {f(cx+hw*0.20)} {f(rail_y + hh*0.16)} {f(cx+hw*0.34)} {f(rail_y + hh*0.16)} {f(cx+hw*0.45)} {f(rail_y + hh*0.05)}" '
               f'fill="none" stroke="#EBC7C2" stroke-width="{f(h*0.017)}" stroke-linecap="round" opacity="0.9"/>')

    # ================= ribbon bow on the hood =================
    bx, by_ = cx - hw*0.30, hood_top + h*0.10
    out.append(f'<path d="M {f(bx)} {f(by_)} C {f(bx-h*0.16)} {f(by_-h*0.13)} {f(bx-h*0.20)} {f(by_+h*0.07)} {f(bx-h*0.02)} {f(by_+h*0.015)} Z" '
               f'fill="url(#silkFill)" stroke="#DFC9AC" stroke-width="1.1"/>')
    out.append(f'<path d="M {f(bx)} {f(by_)} C {f(bx+h*0.16)} {f(by_-h*0.13)} {f(bx+h*0.20)} {f(by_+h*0.07)} {f(bx+h*0.02)} {f(by_+h*0.015)} Z" '
               f'fill="url(#silkFill)" stroke="#DFC9AC" stroke-width="1.1"/>')
    out.append(f'<path d="M {f(bx-h*0.01)} {f(by_+h*0.01)} q {f(-h*0.05)} {f(h*0.12)} {f(-h*0.02)} {f(h*0.18)}" fill="none" stroke="#E7D5BC" stroke-width="{f(h*0.014)}" stroke-linecap="round"/>')
    out.append(f'<path d="M {f(bx+h*0.01)} {f(by_+h*0.01)} q {f(h*0.06)} {f(h*0.11)} {f(h*0.02)} {f(h*0.18)}" fill="none" stroke="#E7D5BC" stroke-width="{f(h*0.014)}" stroke-linecap="round"/>')
    out.append(f'<circle cx="{f(bx)}" cy="{f(by_+h*0.008)}" r="{f(h*0.026)}" fill="url(#goldFill)" stroke="#B9913F" stroke-width="1"/>')
    out.append('</g>')
    return "".join(out)

# ---------------------------------------------------------------- frame
def corner_flourish(x, y, s, sx=1, sy=1):
    g = f'<g transform="translate({f(x)} {f(y)}) scale({sx} {sy})">'
    p = [f'<path d="M 0 {f(s*1.10)} C {f(s*0.02)} {f(s*0.44)} {f(s*0.44)} {f(s*0.02)} {f(s*1.10)} 0" '
         f'fill="none" stroke="url(#goldLine)" stroke-width="{f(s*0.026)}"/>',
         f'<path d="M {f(s*0.16)} {f(s*1.02)} C {f(s*0.20)} {f(s*0.52)} {f(s*0.52)} {f(s*0.20)} {f(s*1.02)} {f(s*0.16)}" '
         f'fill="none" stroke="url(#goldLine)" stroke-width="{f(s*0.014)}" opacity="0.8"/>',
         f'<path d="M {f(s*0.30)} {f(s*0.78)} C {f(s*0.10)} {f(s*0.62)} {f(s*0.30)} {f(s*0.34)} {f(s*0.52)} {f(s*0.44)} '
         f'C {f(s*0.66)} {f(s*0.50)} {f(s*0.60)} {f(s*0.72)} {f(s*0.44)} {f(s*0.70)}" '
         f'fill="none" stroke="url(#goldLine)" stroke-width="{f(s*0.016)}"/>',
         f'<path d="M {f(s*0.78)} {f(s*0.30)} C {f(s*0.62)} {f(s*0.10)} {f(s*0.34)} {f(s*0.30)} {f(s*0.44)} {f(s*0.52)}" '
         f'fill="none" stroke="url(#goldLine)" stroke-width="{f(s*0.016)}"/>']
    for px, py, a in [(s*0.24,s*0.92,42),(s*0.46,s*0.66,50),(s*0.66,s*0.46,58),(s*0.92,s*0.24,66)]:
        L = s*0.15
        p.append(f'<ellipse cx="{f(px)}" cy="{f(py)}" rx="{f(L*0.52)}" ry="{f(L*0.20)}" transform="rotate({a} {f(px)} {f(py)})" fill="url(#goldFill)" opacity="0.9"/>')
    p.append(f'<circle cx="{f(s*0.60)}" cy="{f(s*0.60)}" r="{f(s*0.030)}" fill="url(#pearl)" stroke="#C9A45E" stroke-width="{f(s*0.006)}"/>')
    return g + "".join(p) + '</g>'

def divider(cx, y, w):
    """Thin gold rule with leaf tips and a centre lozenge."""
    hw = w/2
    o = []
    for s in (-1, 1):
        o.append(f'<path d="M {f(cx + s*hw*0.10)} {f(y)} L {f(cx + s*hw*0.86)} {f(y)}" stroke="url(#goldLine)" stroke-width="1.6" opacity="1"/>')
        # leaf tip
        o.append(f'<path d="M {f(cx + s*hw*0.86)} {f(y)} C {f(cx + s*hw*0.90)} {f(y-5.5)} {f(cx + s*hw*0.97)} {f(y-4.5)} {f(cx + s*hw)} {f(y)} '
                 f'C {f(cx + s*hw*0.97)} {f(y+4.5)} {f(cx + s*hw*0.90)} {f(y+5.5)} {f(cx + s*hw*0.86)} {f(y)} Z" fill="url(#goldFill)"/>')
        o.append(f'<circle cx="{f(cx + s*hw*0.78)}" cy="{f(y)}" r="1.9" fill="url(#goldFill)" opacity="0.9"/>')
        # small curl toward the centre
        o.append(f'<path d="M {f(cx + s*hw*0.12)} {f(y)} C {f(cx + s*hw*0.16)} {f(y-7)} {f(cx + s*hw*0.26)} {f(y-6)} {f(cx + s*hw*0.30)} {f(y)}" '
                 f'fill="none" stroke="url(#goldLine)" stroke-width="1.3" opacity="0.95"/>')
    o.append(f'<path d="M {f(cx)} {f(y-9)} C {f(cx+4)} {f(y-4)} {f(cx+11)} {f(y)} {f(cx+11)} {f(y)} '
             f'C {f(cx+11)} {f(y)} {f(cx+4)} {f(y+4)} {f(cx)} {f(y+9)} '
             f'C {f(cx-4)} {f(y+4)} {f(cx-11)} {f(y)} {f(cx-11)} {f(y)} '
             f'C {f(cx-11)} {f(y)} {f(cx-4)} {f(y-4)} {f(cx)} {f(y-9)} Z" fill="url(#goldFill)" stroke="#C09A4F" stroke-width="0.7"/>')
    o.append(f'<circle cx="{f(cx)}" cy="{f(y)}" r="2.3" fill="#FFF8E2"/>')
    return "".join(o)
