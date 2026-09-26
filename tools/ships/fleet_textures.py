# ═══════════════════════════════════════════════════════════════
# Textures for the escorts, submarines, supply ship and red navy (python3 + Pillow + numpy):
#   python3 tools/ships/fleet_textures.py <outdir>
# Hull sides (one per ship, laid out bow → stern / keel → deck edge so hawse pipes, draught marks and
# the boot-top land where they are on the real ship), decks (non-skid, flight-deck markings), and a
# tiling anechoic-tile texture for the submarines. All artwork is generated here (CC0, part of SKYWAR).
# The Blender scripts map them with the same constants (HULLS / DECKS below, imported by the scripts).
# ═══════════════════════════════════════════════════════════════
import math, os, random, sys
try:                        # (the Blender scripts import this file only for HULLS / DECKS: Blender has no Pillow)
    import numpy as np
    from PIL import Image, ImageDraw, ImageFilter, ImageFont
except ImportError:
    pass

# ── hull texture layouts: z range (bow → stern), y range (keel → top), bands, fittings ──
# (Blender scripts import these to write the matching UVs)
HULLS = {
    'destroyer': dict(z0=-78.0, z1=78.0, y0=-10.0, y1=12.0, boot=(-0.6, 1.1), hawse=[(-66.0, 8.4)], drafts=(-70.0, 72.0),
                      paint='usn', seed=51),
    'cruiser': dict(z0=-87.0, z1=87.0, y0=-10.0, y1=10.0, boot=(-0.6, 1.1), hawse=[(-76.0, 6.9)], drafts=(-80.0, 83.0),
                    paint='usn', seed=52),
    'supply': dict(z0=-115.0, z1=115.0, y0=-12.5, y1=15.0, boot=(-0.8, 1.6), hawse=[(-104.0, 11.0)], drafts=(-108.0, 110.0),
                   paint='usn', seed=6),
    'slava': dict(z0=-94.0, z1=94.0, y0=-10.0, y1=12.0, boot=(-0.6, 1.2), hawse=[(-82.0, 8.5)], drafts=(-86.0, 88.0),
                  paint='vmf', seed=11),
}
# deck textures: x / z extents (m) and pixel size; bow at the top of the image, port on the left
DECKS = {
    'cruiser': dict(x0=-9.0, x1=9.0, z0=-87.0, z1=87.0, W=512, H=2048, seed=47),
    'supply': dict(x0=-17.0, x1=17.0, z0=-115.0, z1=115.0, W=512, H=2048, seed=6),
    'slava': dict(x0=-11.0, x1=11.0, z0=-94.0, z1=94.0, W=512, H=2048, seed=55),
}

def font(size, names=('Arial Black.ttf', 'Arial Bold.ttf', 'DejaVuSans-Bold.ttf')):
    for n in names:
        for d in ('/System/Library/Fonts/Supplemental', '/System/Library/Fonts', '/usr/share/fonts/truetype/dejavu', '/Library/Fonts'):
            p = os.path.join(d, n)
            if os.path.exists(p):
                return ImageFont.truetype(p, size)
    return ImageFont.load_default()

def smooth_noise(h, w, cell, rng_):
    gh, gw = max(2, int(h / cell) + 2), max(2, int(w / cell) + 2)
    g = rng_.random((gh, gw)).astype(np.float32)
    im = Image.fromarray((g * 255).astype(np.uint8)).resize((int(gw * cell), int(gh * cell)), Image.BICUBIC)
    return np.asarray(im, dtype=np.float32)[:h, :w] / 255.0

PAINTS = {
    # topsides, boot-top, antifouling (linear-ish sRGB 0..1)
    'usn': (np.array([0.50, 0.525, 0.545]), np.array([0.075, 0.08, 0.085]), np.array([0.36, 0.13, 0.10])),
    'vmf': (np.array([0.47, 0.51, 0.54]), np.array([0.07, 0.075, 0.08]), np.array([0.40, 0.14, 0.11])),
}

def hull_texture(out, name, W=2048, H=256):
    c = HULLS[name]
    rng = random.Random(c['seed'])
    nrng = np.random.default_rng(c['seed'])
    z0, z1, y0, y1 = c['z0'], c['z1'], c['y0'], c['y1']
    def hy(y):
        return (y1 - y) / (y1 - y0) * H
    def hx(z):
        return (z - z0) / (z1 - z0) * W
    ys = y1 - (np.arange(H) + 0.5) / H * (y1 - y0)
    Y = np.repeat(ys[:, None], W, 1)
    grey, blk, red = PAINTS[c['paint']]
    lo, hi = c['boot']
    col = np.where((Y > hi)[..., None], grey, np.where((Y > lo)[..., None], blk, red)).astype(np.float32)
    col = col * np.where((Y < lo)[..., None], (0.82 + 0.18 * np.clip((Y - y0) / (lo - y0), 0, 1))[..., None], 1.0)
    band = np.clip(1 - (Y - hi) / 2.5, 0, 1) * (Y > hi)
    col = col * (1 - 0.14 * band[..., None])
    mott = smooth_noise(H, W, 20, nrng) * 0.6 + smooth_noise(H, W, 5, nrng) * 0.4
    col = col * (0.94 + 0.1 * mott[..., None])
    # plate seams (strakes every ~2.4 m, frames every ~6 m) and the faint shadow of the stiffeners
    for yy in np.arange(y0 + 1.2, y1, 2.4):
        r = int(hy(yy))
        if 0 <= r < H:
            col[r] *= 0.9
    for zz in np.arange(z0 + 3, z1, 6.0):
        cc = int(hx(zz))
        if 0 <= cc < W:
            col[:, cc] *= 0.95
    img = Image.fromarray(np.clip(col * 255, 0, 255).astype(np.uint8), 'RGB')
    d = ImageDraw.Draw(img, 'RGBA')
    # rust / water streaks from scuppers and the deck edge
    for k in range(int((z1 - z0) * 1.6)):
        z = rng.uniform(z0 + 4, z1 - 3)
        ya = rng.uniform(y1 - 2.5, y1 - 0.2) if rng.random() < 0.65 else rng.uniform(hi + 1.0, y1 - 2.0)
        Ls = rng.uniform(0.5, 4.0)
        x = hx(z)
        cc = (95, 62, 40, rng.randint(20, 60)) if rng.random() < 0.55 else (40, 42, 44, rng.randint(18, 45))
        d.line([(x, hy(ya)), (x + rng.uniform(-1, 1), hy(max(ya - Ls, hi)))], fill=cc, width=rng.choice([1, 1, 2]))
    # hawse pipes with anchor-chain rust
    for (z, y) in c['hawse']:
        x, yy = hx(z), hy(y)
        rw, rh = 1.1 / (z1 - z0) * W, 0.9 / (y1 - y0) * H
        d.ellipse([x - rw, yy - rh, x + rw, yy + rh], fill=(20, 20, 20, 255))
        d.ellipse([x - rw * 0.7, yy - rh * 0.7, x + rw * 0.7, yy + rh * 0.7], fill=(45, 44, 42, 255))
        for k in range(8):
            d.line([(x + rng.uniform(-rw, rw), yy + rh), (x + rng.uniform(-rw * 1.2, rw * 1.2), hy(rng.uniform(hi + 0.5, y - 1.5)))], fill=(110, 60, 35, 80), width=2)
    # draught marks (white numerals every metre at bow and stern, reading up from the keel)
    fs = font(max(8, int(0.55 / (y1 - y0) * H)), ('Arial Bold.ttf',))
    for z in c['drafts']:
        for m in range(1, int(-y0) + 1):
            yy = -(-y0) + m          # metres above the keel → height
            y = y0 + m
            if y > hi + 0.5:
                break
            d.text((hx(z), hy(y)), str(m), fill=(215, 215, 205, 210), font=fs, anchor='mm')
    img = img.filter(ImageFilter.GaussianBlur(0.35))
    img.save(os.path.join(out, name + '_hull.jpg'), quality=88, optimize=True)

def deck_base(W, H, nrng, tone=0.3):
    b = 0.55 * smooth_noise(H, W, 120, nrng) + 0.3 * smooth_noise(H, W, 30, nrng) + 0.15 * smooth_noise(H, W, 8, nrng)
    l = tone + (b - 0.5) * 0.1 + nrng.normal(0, 0.03, (H, W)).astype(np.float32) * 0.5
    return np.stack([l * 1.01, l, l * 0.98], -1)

def deck_texture(out, name, draw):
    """non-skid deck with markings drawn by draw(mk, P, s) on a 2× RGBA layer (P(x, z) → pixels)"""
    c = DECKS[name]
    W, H = c['W'], c['H']
    nrng = np.random.default_rng(c['seed'])
    SS = 2
    sx, sz = W / (c['x1'] - c['x0']), H / (c['z1'] - c['z0'])
    def P(x, z):
        return ((x - c['x0']) * sx * SS, (z - c['z0']) * sz * SS)
    base = Image.fromarray(np.clip(deck_base(W, H, nrng) * 255, 0, 255).astype(np.uint8), 'RGB')
    mk = Image.new('RGBA', (W * SS, H * SS), (0, 0, 0, 0))
    draw(ImageDraw.Draw(mk), P, sx * SS)
    mk = mk.resize((W, H), Image.LANCZOS)
    ma = np.asarray(mk, np.float32) / 255.0
    arr = np.asarray(base, np.float32)
    wear = 0.85 + 0.15 * smooth_noise(H, W, 14, nrng)[..., None]
    a = ma[..., 3:4] * wear
    arr = arr * (1 - a) + ma[..., :3] * 255 * a
    Image.fromarray(np.clip(arr, 0, 255).astype(np.uint8), 'RGB').save(os.path.join(out, name + '_deck.jpg'), quality=86, optimize=True)

WHITE, YELLOW, RED, BLACK = (232, 232, 226, 255), (222, 186, 50, 255), (170, 40, 34, 255), (25, 25, 25, 255)

def flight_deck(m, P, s, x_half, z0, z1, circle_z, r=3.6, lineup=True):
    """USN small-ship flight deck: white perimeter, dashed lineup line, yellow touchdown circle, landing T"""
    for (a, b) in (((-x_half, z0), (x_half, z0)), ((-x_half, z0), (-x_half, z1)), ((x_half, z0), (x_half, z1)), ((-x_half, z1), (x_half, z1))):
        m.line([P(*a), P(*b)], fill=WHITE, width=max(1, int(0.2 * s)))
    if lineup:
        z = z0 + 0.5
        while z < z1:
            m.line([P(0, z), P(0, min(z + 1.2, z1))], fill=WHITE, width=max(1, int(0.25 * s)))
            z += 2.4
    (ax, ay), (bx, by) = P(-r, circle_z - r), P(r, circle_z + r)
    m.ellipse([ax, ay, bx, by], outline=YELLOW, width=max(1, int(0.25 * s)))
    m.line([P(-4.5, circle_z), P(4.5, circle_z)], fill=WHITE, width=max(1, int(0.3 * s)))
    m.line([P(-3.0, z0 + 0.6), P(3.0, z0 + 0.6)], fill=YELLOW, width=max(1, int(0.3 * s)))

def cruiser_deck(m, P, s):
    # flight deck aft (CG-47: z 55..85 in the model), anchor chains forward, VLS safety lines
    flight_deck(m, P, s, 7.0, 57.0, 84.0, 70.0)
    for sg in (-1, 1):
        m.line([P(sg * 1.1, -70.0), P(sg * 4.8, -80.5)], fill=BLACK, width=max(1, int(0.35 * s)))

def supply_deck(m, P, s):
    # flight deck aft (z 88..113), RAS station markings along both edges, forecastle chains
    flight_deck(m, P, s, 13.0, 88.0, 113.0, 100.0, r=5.5)
    for zz in (-45.0, -20.0, 5.0, 30.0):
        for sg in (-1, 1):
            m.rectangle([P(sg * 15.2 - 0.6, zz - 3)[0], P(0, zz - 3)[1], P(sg * 15.2 + 0.6, zz + 3)[0], P(0, zz + 3)[1]], outline=YELLOW, width=max(1, int(0.15 * s)))
    for sg in (-1, 1):
        m.line([P(sg * 1.4, -98.0), P(sg * 7.0, -109.0)], fill=BLACK, width=max(1, int(0.4 * s)))

def slava_deck(m, P, s):
    # Soviet helicopter pad on the quarterdeck (x 166–186 m from the stem): yellow-edged circle and cross
    cz = 82.8
    (ax, ay), (bx, by) = P(-5.5, cz - 5.5), P(5.5, cz + 5.5)
    m.ellipse([ax, ay, bx, by], outline=YELLOW, width=max(1, int(0.3 * s)))
    m.line([P(-4.5, cz), P(4.5, cz)], fill=WHITE, width=max(1, int(0.35 * s)))
    m.line([P(0, cz - 4.5), P(0, cz + 4.5)], fill=WHITE, width=max(1, int(0.35 * s)))
    for sg in (-1, 1):
        m.line([P(sg * 1.2, -80.0), P(sg * 5.2, -90.0)], fill=BLACK, width=max(1, int(0.35 * s)))

def anechoic(out, W=1024, H=1024, seed=774, tile_px=64):
    """tiling anechoic tiles: rubber tiles in staggered rows, slight tone steps, a few replaced (glossier,
    darker) or missing ones, faint salt streaks. One tile ≈ tile_px px; the model maps 1 tile to ~0.9 m."""
    rng = random.Random(seed)
    nrng = np.random.default_rng(seed)
    img = np.zeros((H, W, 3), np.float32)
    rows, cols = H // tile_px, W // tile_px
    base = np.array([0.085, 0.09, 0.095], np.float32)
    for r in range(rows):
        off = (tile_px // 2) if r % 2 else 0
        for cc in range(cols + 1):
            x0 = cc * tile_px - off
            t = base * (1 + rng.gauss(0, 0.06))
            if rng.random() < 0.025:
                t = base * 0.7          # a replaced tile
            if rng.random() < 0.006:
                t = np.array([0.30, 0.31, 0.30], np.float32)   # bare steel where one fell off
            for xx in (x0, x0 + W):     # wrap
                a, b = max(0, xx), min(W, xx + tile_px)
                if a < b:
                    img[r * tile_px:(r + 1) * tile_px, a:b] = t
    # seams
    for r in range(rows):
        img[r * tile_px, :] *= 0.55
        off = (tile_px // 2) if r % 2 else 0
        for cc in range(cols + 1):
            x = (cc * tile_px - off) % W
            img[r * tile_px:(r + 1) * tile_px, x] *= 0.6
    n = smooth_noise(H, W, 60, nrng) * 0.6 + smooth_noise(H, W, 12, nrng) * 0.4
    img *= (0.9 + 0.2 * n[..., None])
    # salt / wear streaks (vertical = around the hull, towards the keel)
    pil = Image.fromarray(np.clip(img * 255, 0, 255).astype(np.uint8), 'RGB')
    d = ImageDraw.Draw(pil, 'RGBA')
    for k in range(90):
        x = rng.uniform(0, W)
        y = rng.uniform(0, H)
        d.line([(x, y), (x + rng.uniform(-2, 2), y + rng.uniform(20, 120))], fill=(150, 150, 145, rng.randint(6, 18)), width=rng.choice([1, 2, 3]))
    pil = pil.filter(ImageFilter.GaussianBlur(0.5))
    pil.save(os.path.join(out, 'sub_tiles.jpg'), quality=88, optimize=True)

def rubber_deck(out, W=512, H=512, seed=11):
    """RHIB / CB90 non-slip deck: fine diamond pattern, tiling"""
    nrng = np.random.default_rng(seed)
    y, x = np.mgrid[0:H, 0:W].astype(np.float32)
    p = 16.0
    dmd = (np.abs(((x + y) % p) - p / 2) + np.abs(((x - y) % p) - p / 2)) / p
    l = 0.16 + 0.05 * (dmd > 0.55) + nrng.normal(0, 0.012, (H, W)).astype(np.float32)
    Image.fromarray(np.clip(np.stack([l, l * 1.02, l * 1.03], -1) * 255, 0, 255).astype(np.uint8), 'RGB').save(os.path.join(out, 'boat_deck.jpg'), quality=88, optimize=True)

def camo(out, W=1024, H=512, seed=90):
    """Swedish coastal-forces splinter camouflage (CB90): angular patches of grey-green, green, dark green and
    black-brown on a light grey-green ground; tiles in both directions"""
    rng = random.Random(seed)
    cols = [(128, 138, 116), (86, 101, 64), (48, 61, 44), (43, 38, 34)]
    img = Image.new('RGB', (W, H), cols[0])
    d = ImageDraw.Draw(img)
    for layer, (col, n, size) in enumerate(((cols[1], 34, 150), (cols[2], 30, 120), (cols[3], 18, 80))):
        for k in range(n):
            cx, cy = rng.uniform(0, W), rng.uniform(0, H)
            m = rng.randint(4, 6)
            ang0 = rng.uniform(0, math.pi * 2)
            pts = []
            for i in range(m):
                a = ang0 + 2 * math.pi * i / m + rng.uniform(-0.4, 0.4)
                r = size * rng.uniform(0.35, 1.0)
                pts.append((cx + math.cos(a) * r * 1.6, cy + math.sin(a) * r * 0.7))   # stretched along the hull
            for ox in (-W, 0, W):
                for oy in (-H, 0, H):
                    d.polygon([(x + ox, y + oy) for x, y in pts], fill=col)
    arr = np.asarray(img, np.float32)
    nrng = np.random.default_rng(seed)
    arr *= (0.94 + 0.08 * smooth_noise(H, W, 40, nrng)[..., None])
    Image.fromarray(np.clip(arr, 0, 255).astype(np.uint8), 'RGB').save(os.path.join(out, 'cb90_camo.jpg'), quality=88, optimize=True)

if __name__ == '__main__':
    OUT = sys.argv[1] if len(sys.argv) > 1 else '.'
    os.makedirs(OUT, exist_ok=True)
    for n in HULLS:
        hull_texture(OUT, n)
    deck_texture(OUT, 'cruiser', cruiser_deck)
    deck_texture(OUT, 'supply', supply_deck)
    deck_texture(OUT, 'slava', slava_deck)
    anechoic(OUT)
    rubber_deck(OUT)
    camo(OUT)
    print('fleet textures written to', OUT)
