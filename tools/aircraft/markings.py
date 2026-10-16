# ═══════════════════════════════════════════════════════════════
# National markings and bort numbers for the Blender-built aircraft, drawn from scratch (plain python3 + Pillow):
#   python3 tools/aircraft/markings.py            → tools/aircraft/markings/*.png
# The kit (tools/aircraft_kit.py decal()) projects them onto the paint and finish(atlas=...) bakes them in.
# Everything is drawn here with polygons and strokes (no fonts): the PLAAF insignia (red star with "八一" and
# bars, yellow borders), block digits in PLAAF style for bort numbers, the ejection-seat warning triangle, the
# rescue arrow and panel outlines; a block-letter stroke font (GLYPHS) and the X-100's gold markings (fin and nose
# lettering, lightning flash, chevrons, the made-up SKYWAR test-squadron badge, stencils, door outlines).
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


# ── X-100 Overkill (tools/aircraft/x100.py): SKYWAR's own test jet, black with gold ──
# A block-letter stroke font (no font files): glyphs on a 4 × 7 grid (x right, y down) as polylines, with their
# advance width; drawn as thick strokes with square joints like the bort numbers.
GLYPHS = {
    'A': (4, [[(0, 7), (0, 1.2), (1.2, 0), (2.8, 0), (4, 1.2), (4, 7)], [(0, 3.9), (4, 3.9)]]),
    'B': (4, [[(0, 0), (3.1, 0), (4, 0.9), (4, 2.6), (3.1, 3.5), (0, 3.5)], [(3.1, 3.5), (4, 4.4), (4, 6.1), (3.1, 7), (0, 7), (0, 0)]]),
    'C': (4, [[(4, 0), (0.9, 0), (0, 0.9), (0, 6.1), (0.9, 7), (4, 7)]]),
    'D': (4, [[(0, 0), (2.8, 0), (4, 1.2), (4, 5.8), (2.8, 7), (0, 7), (0, 0)]]),
    'E': (4, [[(4, 0), (0, 0), (0, 7), (4, 7)], [(0, 3.5), (3.1, 3.5)]]),
    'F': (4, [[(4, 0), (0, 0), (0, 7)], [(0, 3.5), (3.1, 3.5)]]),
    'G': (4, [[(4, 0), (0.9, 0), (0, 0.9), (0, 6.1), (0.9, 7), (4, 7), (4, 3.8), (2.2, 3.8)]]),
    'H': (4, [[(0, 0), (0, 7)], [(4, 0), (4, 7)], [(0, 3.5), (4, 3.5)]]),
    'I': (0.0, [[(0, 0), (0, 7)]]),
    'K': (4, [[(0, 0), (0, 7)], [(4, 0), (0.3, 3.7)], [(1.4, 2.7), (4, 7)]]),
    'L': (4, [[(0, 0), (0, 7), (4, 7)]]),
    'M': (5, [[(0, 7), (0, 0), (2.5, 3.6), (5, 0), (5, 7)]]),
    'N': (4, [[(0, 7), (0, 0), (4, 7), (4, 0)]]),
    'O': (4, [[(0.9, 0), (3.1, 0), (4, 0.9), (4, 6.1), (3.1, 7), (0.9, 7), (0, 6.1), (0, 0.9), (0.9, 0)]]),
    'P': (4, [[(0, 7), (0, 0), (3.1, 0), (4, 0.9), (4, 2.9), (3.1, 3.8), (0, 3.8)]]),
    'Q': (4, [[(0.9, 0), (3.1, 0), (4, 0.9), (4, 6.1), (3.1, 7), (0.9, 7), (0, 6.1), (0, 0.9), (0.9, 0)], [(2.4, 5.2), (4.2, 7.4)]]),
    'R': (4, [[(0, 7), (0, 0), (3.1, 0), (4, 0.9), (4, 2.9), (3.1, 3.8), (0, 3.8)], [(1.8, 3.8), (4, 7)]]),
    'S': (4, [[(4, 0), (0.9, 0), (0, 0.9), (0, 2.6), (0.9, 3.5), (3.1, 3.5), (4, 4.4), (4, 6.1), (3.1, 7), (0, 7)]]),
    'T': (4, [[(0, 0), (4, 0)], [(2, 0), (2, 7)]]),
    'U': (4, [[(0, 0), (0, 6.1), (0.9, 7), (3.1, 7), (4, 6.1), (4, 0)]]),
    'V': (4, [[(0, 0), (2, 7), (4, 0)]]),
    'W': (5.4, [[(0, 0), (1.2, 7), (2.7, 2.4), (4.2, 7), (5.4, 0)]]),
    'X': (4, [[(0, 0), (4, 7)], [(4, 0), (0, 7)]]),
    'Y': (4, [[(0, 0), (2, 3.6), (4, 0)], [(2, 3.6), (2, 7)]]),
    'Z': (4, [[(0, 0), (4, 0), (0, 7), (4, 7)]]),
    '-': (2.6, [[(0.2, 3.6), (2.4, 3.6)]]),
    '.': (0.0, [[(0, 6.9), (0, 7)]]),
    '/': (3, [[(3, 0), (0, 7)]]),
    ' ': (2.2, []),
}
for _k, _v in DIGITS.items():
    GLYPHS.setdefault(_k, (4, _v))

GOLD_HI, GOLD, GOLD_LO, GOLD_EDGE = (250, 222, 140, 255), (222, 170, 64, 255), (164, 112, 34, 255), (92, 60, 16, 255)
GREY = (128, 133, 140, 255)
DARK = (30, 31, 34, 255)


def _strokes(d, text, k, x0, y0, width, gap, italic, col):
    """Draw text's glyph strokes (width in grid units) at grid unit k from (x0, y0) px; returns the end x."""
    x = x0
    for ch in text:
        adv, lines = GLYPHS.get(ch, GLYPHS[' '])
        for line in lines:
            pts = [(x + (gx + (7 - gy) * italic) * k, y0 + gy * k) for gx, gy in line]
            for a, b in zip(pts, pts[1:]):
                d.line([a, b], fill=col, width=max(1, int(k * width)))
            r = k * width / 2
            for p in pts:
                d.rectangle([p[0] - r, p[1] - r, p[0] + r, p[1] + r], fill=col)
        x += (adv + gap) * k
    return x


def _advance(text, gap):
    return sum(GLYPHS.get(ch, GLYPHS[' '])[0] + gap for ch in text) - gap


def gradient(w, h, top, mid, bot):
    """A vertical three-stop gradient (gold leaf: light at the top, deep at the bottom)."""
    im = Image.new('RGBA', (w, h))
    px = im.load()
    for y in range(h):
        t = y / max(1, h - 1)
        a, b, u = (top, mid, t * 2) if t < 0.5 else (mid, bot, t * 2 - 1)
        c = tuple(int(a[i] + (b[i] - a[i]) * u) for i in range(4))
        for x in range(w):
            px[x, y] = c
    return im


def text_img(text, h=200, fill=GOLD, outline=GOLD_EDGE, stroke=1.0, gap=1.5, ol=0.28, italic=0.0, leaf=False):
    """Text in the block font: fill colour (leaf=True: a gold-leaf gradient) with an outline (None: none)."""
    H = h * SS
    k = H / 9.0
    W = int((_advance(text, gap) + 7 * abs(italic) + 2) * k + k * (stroke + 2 * ol))
    shape = Image.new('L', (W, H), 0)
    edge = Image.new('L', (W, H), 0)
    _strokes(ImageDraw.Draw(shape), text, k, k * 1.0, k * 1.0, stroke, gap, italic, 255)
    if outline is not None:
        _strokes(ImageDraw.Draw(edge), text, k, k * 1.0, k * 1.0, stroke + 2 * ol, gap, italic, 255)
    im = Image.new('RGBA', (W, H), (0, 0, 0, 0))
    if outline is not None:
        im.paste(Image.new('RGBA', (W, H), outline), (0, 0), edge)
    face = gradient(W, H, GOLD_HI, GOLD, GOLD_LO) if leaf else Image.new('RGBA', (W, H), fill)
    im.paste(face, (0, 0), shape)
    return im.resize((W // SS, H // SS), Image.LANCZOS)


def lightning(w=1024, h=160, col=GOLD, edge=GOLD_HI):
    """The X-100's lightning flash: a long bolt, broad at the back, zig-zagging twice to a needle point at the front
    (toward +x)."""
    W, H = w * SS, h * SS
    im = Image.new('RGBA', (W, H), (0, 0, 0, 0))
    d = ImageDraw.Draw(im)
    # upper and lower edges, back (x = 0) to the point (x = 1); y 0..1 down
    up = [(0.00, 0.20), (0.44, 0.34), (0.38, 0.04), (0.76, 0.40), (0.71, 0.18), (1.00, 0.54)]
    lo = [(1.00, 0.54), (0.74, 0.62), (0.79, 0.86), (0.40, 0.62), (0.46, 0.96), (0.00, 0.80)]
    poly = [(x * W, y * H) for x, y in up + lo]
    d.polygon(poly, fill=edge)
    # the face inset a little: a bright rim round a deeper gold
    cx, cy = W * 0.5, H * 0.5
    inner = [(cx + (x - cx) * 0.985, cy + (y - cy) * 0.80) for x, y in poly]
    d.polygon(inner, fill=col)
    return im.resize((w, h), Image.LANCZOS)


def chevron(w=512, h=384, n=2, col=GOLD, edge=GOLD_EDGE):
    """Nested chevrons pointing up (forward, on a decal facing up): the dorsal flash behind the canopy."""
    W, H = w * SS, h * SS
    im = Image.new('RGBA', (W, H), (0, 0, 0, 0))
    d = ImageDraw.Draw(im)
    t = 0.16                       # bar thickness, fraction of h
    for i in range(n):
        y0 = H * (0.04 + i * 0.36)
        tip, arm = (W / 2, y0), H * 0.52
        outer = [(W / 2, y0), (W * 0.98, y0 + arm), (W * 0.98, y0 + arm + H * t), (W / 2, y0 + H * t), (W * 0.02, y0 + arm + H * t), (W * 0.02, y0 + arm)]
        d.polygon(outer, fill=edge)
        k = H * 0.018
        inner = [(W / 2, y0 + k * 1.6), (W * 0.98 - k, y0 + arm + k * 0.6), (W * 0.98 - k, y0 + arm + H * t - k), (W / 2, y0 + H * t - k * 0.4),
                 (W * 0.02 + k, y0 + arm + H * t - k), (W * 0.02 + k, y0 + arm + k * 0.6)]
        d.polygon(inner, fill=col)
    return im.resize((w, h), Image.LANCZOS)


def _arc_text(im, text, cx, cy, R, h, col, top=True, gap=1.4, spread=1.0):
    """Glyphs set round an arc of radius R (centre of the letters), on top reading clockwise, at the bottom reading
    left to right with their feet outward."""
    k = h / 9.0
    adv = [(GLYPHS.get(ch, GLYPHS[' '])[0] + gap) * k for ch in text]
    total = sum(adv) - gap * k
    ang = total / R * spread                      # radians the text spans
    a = -ang / 2
    for ch, w_ in zip(text, adv):
        gw = GLYPHS.get(ch, GLYPHS[' '])[0] * k
        mid = a + (gw / 2) / R * spread
        tile = Image.new('RGBA', (int(h * 1.4), int(h * 1.4)), (0, 0, 0, 0))
        _strokes(ImageDraw.Draw(tile), ch, k, tile.width / 2 - gw / 2, tile.height / 2 - 3.5 * k, 1.05, gap, 0.0, col)
        if top:
            th = mid
            rot = tile.rotate(-math.degrees(th), resample=Image.BICUBIC)
            px, py = cx + R * math.sin(th), cy - R * math.cos(th)
        else:
            th = mid
            rot = tile.rotate(math.degrees(th), resample=Image.BICUBIC)
            px, py = cx + R * math.sin(th), cy + R * math.cos(th)
        im.alpha_composite(rot, (int(px - rot.width / 2), int(py - rot.height / 2)))
        a += w_ / R * spread


def badge(size=512):
    """The SKYWAR test-squadron patch (made up): a gold-rimmed disc, SKYWAR round the top and TEST SQN round the
    bottom of a deep red band, gold stars between; in the black centre a silver cranked-arrow jet in plan, nose up,
    crossed by a gold lightning bolt."""
    S_ = size * SS
    im = Image.new('RGBA', (S_, S_), (0, 0, 0, 0))
    d = ImageDraw.Draw(im)
    c = S_ / 2
    def disc(r, col):
        d.ellipse([c - r, c - r, c + r, c + r], fill=col)
    disc(S_ * 0.495, GOLD_EDGE)
    disc(S_ * 0.478, GOLD)
    disc(S_ * 0.452, (110, 16, 20, 255))
    disc(S_ * 0.318, GOLD)
    disc(S_ * 0.300, (16, 17, 19, 255))
    # the band's lettering and stars
    hband = S_ * 0.085
    _arc_text(im, 'SKYWAR', c, c, S_ * 0.386, hband, GOLD_HI, top=True, gap=1.6)
    _arc_text(im, 'TEST SQN', c, c, S_ * 0.386, hband, GOLD_HI, top=False, gap=1.3)
    for sx in (-1, 1):
        d.polygon(star_pts(c + sx * S_ * 0.386, c, S_ * 0.034), fill=GOLD_HI)
    # the jet in plan (cranked arrow, canards, twin canted fins seen from above as slivers)
    j = S_ * 0.25
    def P(x, y):
        return (c + x * j, c + y * j)
    jet = [P(0, -0.98), P(0.10, -0.55), P(0.18, -0.12), P(0.42, 0.22), P(0.86, 0.50), P(0.88, 0.66), P(0.30, 0.56),
           P(0.26, 0.80), P(0.10, 0.78), P(0.0, 0.70), P(-0.10, 0.78), P(-0.26, 0.80), P(-0.30, 0.56), P(-0.88, 0.66),
           P(-0.86, 0.50), P(-0.42, 0.22), P(-0.18, -0.12), P(-0.10, -0.55)]
    d.polygon(jet, fill=(206, 212, 218, 255))
    for sx in (-1, 1):
        d.polygon([P(sx * 0.13, -0.30), P(sx * 0.40, -0.12), P(sx * 0.40, -0.05), P(sx * 0.15, -0.14)], fill=(206, 212, 218, 255))
    d.polygon([P(0, -0.86), P(0.045, -0.52), P(0, -0.40), P(-0.045, -0.52)], fill=(222, 170, 64, 255))   # gold canopy
    # the bolt, upper right to lower left, over the jet
    bolt = [P(0.62, -0.78), P(0.10, -0.06), P(0.30, -0.02), P(-0.20, 0.52), P(-0.04, 0.54), P(-0.66, 0.98),
            P(-0.30, 0.40), P(-0.48, 0.38), P(-0.02, -0.12), P(-0.22, -0.16)]
    d.polygon(bolt, fill=GOLD_EDGE)
    inner = [(c + (x - c) * 0.93, c + (y - c) * 0.93) for x, y in bolt]
    d.polygon(inner, fill=GOLD_HI)
    return im.resize((size, size), Image.LANCZOS)


def danger_intake(w=512, h=160):
    """Intake danger zone: a red chevron band with DANGER in white on red."""
    W, H = w * SS, h * SS
    im = Image.new('RGBA', (W, H), (0, 0, 0, 0))
    d = ImageDraw.Draw(im)
    d.rectangle([0, 0, W, H], fill=RED)
    d.rectangle([W * 0.02, H * 0.08, W * 0.98, H * 0.92], outline=WHITE, width=int(H * 0.05))
    t = text_img('DANGER', int(h * 0.62), fill=WHITE, outline=None, gap=1.3)
    t = t.resize((t.width * SS, t.height * SS), Image.LANCZOS)
    im.alpha_composite(t, (int(W / 2 - t.width / 2), int(H / 2 - t.height / 2)))
    return im.resize((w, h), Image.LANCZOS)


def x100_markings():
    door = (54, 57, 62, 235)
    return {
        'x100_fin.png': text_img('X-100', 220, outline=GOLD_EDGE, leaf=True, italic=0.16, gap=1.4),
        'x100_wing.png': text_img('X-100', 220, outline=None, fill=(196, 150, 56, 255), italic=0.16, gap=1.4),
        'x100_nose.png': text_img('OVERKILL', 140, outline=GOLD_EDGE, leaf=True, italic=0.16, gap=1.5, ol=0.22),
        'x100_serial.png': text_img('SKYWAR  26-0100', 110, fill=GREY, outline=None, gap=1.5, stroke=0.9),
        'x100_nostep.png': text_img('NO STEP', 110, fill=GREY, outline=None, gap=1.5, stroke=0.9),
        'x100_flash.png': lightning(1024, 160),
        'x100_chevron.png': chevron(512, 384),
        'x100_badge.png': badge(512),
        'x100_danger.png': danger_intake(512, 160),
        'x100_door.png': outline_box(512, 256, 7, col=door, radius=0.06),
        'x100_saw.png': sawtooth_box(1024, 256, 8, 9, col=door),
    }


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
    out.update(x100_markings())
    for name, im in out.items():
        im.save(os.path.join(OUT, name))
        print(name, im.size)


if __name__ == '__main__':
    main()
