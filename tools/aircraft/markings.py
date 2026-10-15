# ═══════════════════════════════════════════════════════════════
# National markings and bort numbers for the Blender-built aircraft, drawn from scratch (plain python3 + Pillow):
#   python3 tools/aircraft/markings.py            → tools/aircraft/markings/*.png
# The kit (tools/aircraft_kit.py decal()) projects them onto the paint and finish(atlas=...) bakes them in.
# Everything is drawn here with polygons and strokes (no fonts): the PLAAF insignia (red star with "八一" and
# bars, yellow borders), block digits in PLAAF style for bort numbers, the ejection-seat warning triangle, the
# rescue arrow and panel outlines.
# ═══════════════════════════════════════════════════════════════
import math, os, sys
from PIL import Image, ImageDraw

OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'markings')
SS = 4                                  # supersampling

RED = (204, 32, 30, 255)
YELLOW = (250, 204, 21, 255)
WHITE = (240, 240, 236, 255)
BLACK = (24, 26, 28, 255)


def star_pts(cx, cy, R, r=None, rot=-90):
    r = r if r is not None else R * 0.382
    pts = []
    for i in range(10):
        a = math.radians(rot + i * 36)
        rr = R if i % 2 == 0 else r
        pts.append((cx + rr * math.cos(a), cy + rr * math.sin(a)))
    return pts


def thick(d, pts, w, fill):
    """A polyline of width w with round joints."""
    for a, b in zip(pts, pts[1:]):
        d.line([a, b], fill=fill, width=int(w))
    for p in pts:
        d.ellipse([p[0] - w / 2, p[1] - w / 2, p[0] + w / 2, p[1] + w / 2], fill=fill)


def plaaf(size=512, bars=True):
    """PLAAF insignia: a red star with a yellow border and 八一 in yellow in its centre, flanked by red bars with
    yellow borders (bars=False: the star alone)."""
    W = int(size * SS * (2.5 if bars else 1))
    H = size * SS
    im = Image.new('RGBA', (W, H), (0, 0, 0, 0))
    d = ImageDraw.Draw(im)
    cx, cy, R = W / 2, H / 2 + H * 0.03, H * 0.47
    if bars:
        bh, bw = H * 0.30, (W - 2 * R * 0.30) / 2 - H * 0.02
        yb = cy + R * 0.05
        b = H * 0.035
        for side in (-1, 1):
            x0 = cx + side * R * 0.30
            x1 = x0 + side * bw
            xa, xb = min(x0, x1), max(x0, x1)
            d.rectangle([xa, yb - bh / 2, xb, yb + bh / 2], fill=YELLOW)
            d.rectangle([xa + b * (side < 0), yb - bh / 2 + b, xb - b * (side > 0), yb + bh / 2 - b], fill=RED)
    d.polygon(star_pts(cx, cy, R), fill=YELLOW)
    d.polygon(star_pts(cx, cy, R * 0.84, R * 0.84 * 0.382 * 0.97), fill=RED)
    # 八一 in yellow across the centre (the 八's two strokes splay out, the 一 is a level bar)
    u = R * 0.17
    w = u * 0.5
    x8, x1 = cx - u * 1.05, cx + u * 1.2
    thick(d, [(x8 - u * 0.1, cy - u * 0.9), (x8 - u * 0.25, cy - u * 0.1), (x8 - u * 0.8, cy + u * 0.8)], w, YELLOW)
    thick(d, [(x8 + u * 0.3, cy - u * 0.9), (x8 + u * 0.4, cy - u * 0.05), (x8 + u * 0.95, cy + u * 0.8)], w, YELLOW)
    thick(d, [(x1 - u * 0.75, cy + u * 0.05), (x1 + u * 0.75, cy + u * 0.05)], w * 1.05, YELLOW)
    return im.resize((W // SS, H // SS), Image.LANCZOS)


# Block digits on a 4 × 7 grid (x right, y down): polylines, drawn as thick strokes
DIGITS = {
    '0': [[(0, 0), (4, 0), (4, 7), (0, 7), (0, 0)]],
    '1': [[(0.8, 1.2), (2.4, 0), (2.4, 7)]],
    '2': [[(0, 0), (4, 0), (4, 3.5), (0, 3.5), (0, 7), (4, 7)]],
    '3': [[(0, 0), (4, 0), (4, 7), (0, 7)], [(1, 3.5), (4, 3.5)]],
    '4': [[(0, 0), (0, 4.5), (4, 4.5)], [(3.2, 0), (3.2, 7)]],
    '5': [[(4, 0), (0, 0), (0, 3.2), (4, 3.2), (4, 7), (0, 7)]],
    '6': [[(4, 0), (0, 0), (0, 7), (4, 7), (4, 3.5), (0, 3.5)]],
    '7': [[(0, 0), (4, 0), (1.5, 7)]],
    '8': [[(0, 0), (4, 0), (4, 7), (0, 7), (0, 0)], [(0, 3.5), (4, 3.5)]],
    '9': [[(0, 7), (4, 7), (4, 0), (0, 0), (0, 3.5), (4, 3.5)]],
}


def number(text, h=256, fill=RED, outline=WHITE, stroke=0.95, gap=1.6, ol=0.32):
    """Bort number in block digits: fill colour with an outline (None: no outline)."""
    H = h * SS
    k = H / 9.0                                    # grid unit (7 rows + margin)
    adv = (4 + gap) * k
    W = int(adv * len(text) + 2 * k)
    im = Image.new('RGBA', (W, H), (0, 0, 0, 0))
    d = ImageDraw.Draw(im)
    for pass_, (col, wmul) in enumerate(((outline, stroke + 2 * ol), (fill, stroke))):
        if col is None:
            continue
        for i, ch in enumerate(text):
            for line in DIGITS.get(ch, []):
                pts = [(k * 1.0 + i * adv + x * k, k * 1.0 + y * k) for x, y in line]
                for a, b in zip(pts, pts[1:]):
                    d.line([a, b], fill=col, width=int(k * wmul))
                for p in pts:
                    r = k * wmul / 2
                    d.rectangle([p[0] - r, p[1] - r, p[0] + r, p[1] + r], fill=col)
    return im.resize((W // SS, H // SS), Image.LANCZOS)


def warning_triangle(size=128):
    """The red ejection-seat warning triangle (white inside)."""
    S = size * SS
    im = Image.new('RGBA', (S, S), (0, 0, 0, 0))
    d = ImageDraw.Draw(im)
    p = [(S / 2, S * 0.06), (S * 0.97, S * 0.92), (S * 0.03, S * 0.92)]
    d.polygon(p, fill=RED)
    q = [(S / 2, S * 0.30), (S * 0.80, S * 0.82), (S * 0.20, S * 0.82)]
    d.polygon(q, fill=WHITE)
    d.rectangle([S * 0.47, S * 0.45, S * 0.53, S * 0.68], fill=BLACK)
    d.rectangle([S * 0.47, S * 0.71, S * 0.53, S * 0.77], fill=BLACK)
    return im.resize((size, size), Image.LANCZOS)


def rescue_arrow(size=256):
    """Rescue / canopy-release arrow: a red arrow with a white border, pointing right."""
    S = size * SS
    im = Image.new('RGBA', (S, S // 2), (0, 0, 0, 0))
    d = ImageDraw.Draw(im)
    h = S // 2
    for col, sh in ((WHITE, 0.0), (RED, 0.06)):
        p = [(S * (0.02 + sh), h * (0.35 + sh)), (S * (0.62 - sh * 0.3), h * (0.35 + sh)), (S * (0.62 - sh * 0.3), h * (0.08 + sh * 1.8)),
             (S * (0.98 - sh * 1.4), h * 0.5), (S * (0.62 - sh * 0.3), h * (0.92 - sh * 1.8)), (S * (0.62 - sh * 0.3), h * (0.65 - sh)),
             (S * (0.02 + sh), h * (0.65 - sh))]
        d.polygon(p, fill=col)
    return im.resize((size, size // 2), Image.LANCZOS)


def outline_box(w=512, h=256, line=6, col=(30, 32, 34, 210), radius=0.12):
    """A panel outline (thin rounded rectangle) — access panels, gear and weapon-bay doors."""
    im = Image.new('RGBA', (w * SS, h * SS), (0, 0, 0, 0))
    d = ImageDraw.Draw(im)
    r = int(min(w, h) * SS * radius)
    d.rounded_rectangle([line * SS, line * SS, w * SS - line * SS, h * SS - line * SS], radius=r, outline=col, width=line * SS)
    return im.resize((w, h), Image.LANCZOS)


def sawtooth_box(w=1024, h=256, line=10, teeth=9, col=(190, 196, 200, 255), radius=0.0):
    """A door outline with sawtooth fore and aft edges (the J-20's weapon-bay and gear doors), light grey."""
    im = Image.new('RGBA', (w * SS, h * SS), (0, 0, 0, 0))
    d = ImageDraw.Draw(im)
    L = line * SS
    W, H = w * SS, h * SS
    tw = (H - 2 * L) / teeth
    def zig(x0, sgn):
        pts = []
        for i in range(teeth + 1):
            y = L + i * tw
            pts.append((x0 + (sgn * tw * 0.45 if i % 2 else 0), y))
        return pts
    left, right = zig(L, 1), zig(W - L, -1)
    top = [(L, L), (W - L, L)]
    bot = [(L, H - L), (W - L, H - L)]
    for line_ in (left, right, top, bot):
        thick(d, line_, L, col)
    return im.resize((w, h), Image.LANCZOS)


def main():
    os.makedirs(OUT, exist_ok=True)
    out = {
        'plaaf_bars.png': plaaf(256, True),
        'plaaf_star.png': plaaf(256, False),
        'warning.png': warning_triangle(128),
        'rescue.png': rescue_arrow(256),
        'panel.png': outline_box(512, 512, 5),
        'saw_door.png': sawtooth_box(1024, 256, 8, 9),
        'saw_door_dark.png': sawtooth_box(1024, 256, 6, 9, col=(28, 30, 33, 200)),
        # bort numbers: J-10A and J-8II in red with a white outline (PLAAF style), J-20 in black with a
        # thin yellow outline
        'bort_j10.png': number('41112', 160, RED, WHITE),
        'bort_j8.png': number('20412', 160, RED, WHITE),
        'bort_j20.png': number('62012', 160, BLACK, YELLOW, ol=0.22),
        'fin_j10.png': number('112', 120, RED, WHITE),
    }
    for name, im in out.items():
        im.save(os.path.join(OUT, name))
        print(name, im.size)


if __name__ == '__main__':
    main()
