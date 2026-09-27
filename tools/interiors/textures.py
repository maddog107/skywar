# ═══════════════════════════════════════════════════════════════
# Tiling surface textures for the interiors (python3 + Pillow + numpy, no Blender):
#   python3 tools/interiors/textures.py models/interiors/tex
# Each is a seamless 1024² (or 512²) colour map and, where the surface has relief, a matching tangent-space normal
# map (OpenGL convention, +Y up) made from a height field. src/warrooms.js ROOM_MATERIALS tiles them by material
# name (the room GLBs carry UVs in metres). All artwork is generated here (CC0, part of SKYWAR).
# ═══════════════════════════════════════════════════════════════
import math, os, sys
import numpy as np
from PIL import Image, ImageDraw, ImageFilter

OUT = sys.argv[1] if len(sys.argv) > 1 else 'models/interiors/tex'
os.makedirs(OUT, exist_ok=True)
rng = np.random.default_rng(1788)

def tile_noise(n, cells, octaves=4, seed=0):
    """seamless value noise (fbm) in 0..1 on an n×n grid"""
    r = np.random.default_rng(seed)
    out = np.zeros((n, n), np.float32)
    amp, tot = 1.0, 0.0
    for o in range(octaves):
        c = cells * (2 ** o)
        g = r.random((c, c)).astype(np.float32)
        # bicubic-ish upsample with wrap: tile 3×3, resize, crop the middle
        big = np.tile(g, (3, 3))
        im = Image.fromarray((big * 255).astype(np.uint8)).resize((n * 3, n * 3), Image.BICUBIC)
        a = np.asarray(im, np.float32)[n:2 * n, n:2 * n] / 255.0
        out += a * amp
        tot += amp
        amp *= 0.5
    return out / tot

def normal_from_height(h, strength=2.0):
    """tangent-space normal map (OpenGL: green up) from a seamless height field (0..1)"""
    dx = (np.roll(h, -1, axis=1) - np.roll(h, 1, axis=1)) * 0.5 * strength
    dy = (np.roll(h, -1, axis=0) - np.roll(h, 1, axis=0)) * 0.5 * strength
    nx, ny, nz = -dx, dy, np.ones_like(h)
    l = np.sqrt(nx * nx + ny * ny + nz * nz)
    rgb = np.stack([nx / l, ny / l, nz / l], -1) * 0.5 + 0.5
    return Image.fromarray((np.clip(rgb, 0, 1) * 255).astype(np.uint8), 'RGB')

def save(img, name, q=90):
    p = os.path.join(OUT, name)
    img.save(p, quality=q, optimize=True)
    print('wrote', p, os.path.getsize(p) // 1024, 'KB')

def colorize(v, c0, c1):
    v = np.clip(v, 0, 1)[..., None]
    return (np.array(c0, np.float32) * (1 - v) + np.array(c1, np.float32) * v)

# ── diamond tread deck plate (submarine, CIC): painted, worn on the raised lugs ──
def deck_plate(n=1024):
    y, x = np.mgrid[0:n, 0:n].astype(np.float32) / n
    lugs = 8                                   # lugs per tile across (the tile = 1.2 m)
    u, v = (x * lugs) % 1.0, (y * lugs) % 1.0
    # alternate the lug direction every other cell (the classic diamond pattern)
    alt = ((np.floor(x * lugs) + np.floor(y * lugs)) % 2).astype(bool)
    a = np.where(alt, (u - 0.5) * 0.7 + (v - 0.5) * 0.7, (u - 0.5) * 0.7 - (v - 0.5) * 0.7)
    b = np.where(alt, (u - 0.5) * 0.7 - (v - 0.5) * 0.7, (u - 0.5) * 0.7 + (v - 0.5) * 0.7)
    lug = np.clip(1.0 - (np.abs(a) / 0.36) ** 2 - (np.abs(b) / 0.09) ** 2, 0, 1)
    lug = np.sqrt(lug)
    grime = tile_noise(n, 4, 4, 11)
    base = colorize(grime * 0.6 + 0.2, (58, 61, 64), (78, 82, 86))
    wear = np.clip(lug * (0.4 + 0.8 * tile_noise(n, 8, 3, 12)), 0, 1)[..., None]
    col = base * (1 - wear * 0.5) + np.array([150, 152, 150], np.float32) * wear * 0.5
    col *= (0.92 + 0.08 * tile_noise(n, 16, 2, 13))[..., None]
    save(Image.fromarray(np.clip(col, 0, 255).astype(np.uint8)), 'deck_plate.jpg')
    save(normal_from_height(lug * 0.6 + grime * 0.05, 6.0), 'deck_plate_n.jpg')

# ── vinyl / raised-floor tiles (the JOC): 0.6 m tiles, 2 across the texture ──
def floor_tile(n=1024):
    y, x = np.mgrid[0:n, 0:n].astype(np.float32) / n
    t = 2
    fu, fv = (x * t) % 1.0, (y * t) % 1.0
    edge = np.minimum(np.minimum(fu, 1 - fu), np.minimum(fv, 1 - fv))
    seam = np.clip(1 - edge / 0.006, 0, 1)
    tone = np.zeros((n, n), np.float32)
    r = np.random.default_rng(21)
    for i in range(t):
        for j in range(t):
            tone[j * n // t:(j + 1) * n // t, i * n // t:(i + 1) * n // t] = r.normal(0, 0.03)
    speck = tile_noise(n, 64, 2, 22)
    base = colorize(0.5 + tone + (speck - 0.5) * 0.25, (92, 96, 98), (128, 132, 134))
    col = base * (1 - seam[..., None] * 0.55)
    save(Image.fromarray(np.clip(col, 0, 255).astype(np.uint8)), 'floor_tile.jpg')
    save(normal_from_height(-seam * 0.3 + speck * 0.02, 4.0), 'floor_tile_n.jpg')

# ── carpet tiles ──
def carpet(n=512):
    fib = tile_noise(n, 128, 2, 31) * 0.6 + tile_noise(n, 32, 3, 32) * 0.4
    y, x = np.mgrid[0:n, 0:n].astype(np.float32) / n
    fu, fv = (x * 2) % 1.0, (y * 2) % 1.0
    edge = np.minimum(np.minimum(fu, 1 - fu), np.minimum(fv, 1 - fv))
    seam = np.clip(1 - edge / 0.01, 0, 1)
    col = colorize(fib, (44, 50, 60), (70, 78, 90)) * (1 - seam[..., None] * 0.25)
    save(Image.fromarray(np.clip(col, 0, 255).astype(np.uint8)), 'carpet.jpg')
    save(normal_from_height(fib * 0.4, 3.0), 'carpet_n.jpg')

# ── painted steel bulkhead: 1 texture = 2 m; panel seams, rivet rows, a little grime low down ──
def wall_paint(n=1024):
    y, x = np.mgrid[0:n, 0:n].astype(np.float32) / n
    h = np.zeros((n, n), np.float32)
    # vertical stiffener seams every 0.5 m (4 across), a horizontal seam at mid-height
    for k in range(4):
        cx = (k + 0.5) / 4
        h -= np.exp(-((x - cx) / 0.0025) ** 2) * 0.5
    h -= np.exp(-((y - 0.5) / 0.0025) ** 2) * 0.5
    # rivet rows beside the seams
    for k in range(4):
        cx = (k + 0.5) / 4
        for side in (-0.012, 0.012):
            for j in range(40):
                cy = (j + 0.5) / 40
                h += np.exp(-(((x - cx - side) / 0.0035) ** 2 + ((y - cy) / 0.0035) ** 2)) * 0.6
    orange = tile_noise(n, 3, 5, 41)
    paint = colorize(orange * 0.5 + 0.3, (176, 180, 176), (198, 201, 196))
    grime = np.clip(tile_noise(n, 2, 3, 43) * 1.6 - 0.7, 0, 1) * tile_noise(n, 12, 3, 42)  # (seamless: no ramp)
    col = paint * (1 - grime[..., None] * 0.18) * (1 + h[..., None] * 0.08)
    save(Image.fromarray(np.clip(col, 0, 255).astype(np.uint8)), 'wall_paint.jpg')
    save(normal_from_height(h * 0.4 + orange * 0.03, 5.0), 'wall_paint_n.jpg')

# ── ceiling: perforated acoustic panels in a grid (1 texture = 1.2 m) ──
def ceiling(n=1024):
    y, x = np.mgrid[0:n, 0:n].astype(np.float32) / n
    fu, fv = (x * 2) % 1.0, (y * 2) % 1.0
    edge = np.minimum(np.minimum(fu, 1 - fu), np.minimum(fv, 1 - fv))
    grid = np.clip(1 - edge / 0.012, 0, 1)
    holes = ((np.sin(x * 2 * math.pi * 96) > 0.85) & (np.sin(y * 2 * math.pi * 96) > 0.85)).astype(np.float32)
    col = colorize(0.6 + tile_noise(n, 6, 3, 51) * 0.3, (186, 188, 184), (206, 208, 204))
    col = col * (1 - grid[..., None] * 0.35) * (1 - holes[..., None] * 0.25)
    save(Image.fromarray(np.clip(col, 0, 255).astype(np.uint8)), 'ceiling.jpg')
    save(normal_from_height(-grid * 0.3 - holes * 0.05, 4.0), 'ceiling_n.jpg')

# ── powder-coated console metal: fine orange-peel grain ──
def console(n=512):
    g = tile_noise(n, 96, 2, 61) * 0.7 + tile_noise(n, 24, 3, 62) * 0.3
    col = colorize(g, (122, 124, 126), (140, 142, 144))
    save(Image.fromarray(np.clip(col, 0, 255).astype(np.uint8)), 'console.jpg')
    save(normal_from_height(g * 0.25, 3.0), 'console_n.jpg')

# ── cast concrete (the JOC's walls, T-walls): form-tie holes, pour lines, stains ──
def concrete(n=1024):
    y, x = np.mgrid[0:n, 0:n].astype(np.float32) / n
    n1 = tile_noise(n, 5, 5, 71)
    pores = (tile_noise(n, 180, 1, 72) > 0.82).astype(np.float32)
    h = n1 * 0.2 - pores * 0.15
    for k in range(2):
        h -= np.exp(-((y - (k + 0.5) / 2) / 0.002) ** 2) * 0.3
    for i in range(2):
        for j in range(2):
            cx, cy = (i + 0.5) / 2, (j + 0.25) / 2
            h -= np.exp(-(((x - cx) / 0.006) ** 2 + ((y - cy) / 0.006) ** 2)) * 0.8
    stain = np.clip(tile_noise(n, 3, 4, 73) - 0.35, 0, 1) * tile_noise(n, 2, 2, 74)
    col = colorize(n1 * 0.6 + 0.2, (126, 123, 116), (160, 157, 150)) * (1 - stain[..., None] * 0.3) * (1 - pores[..., None] * 0.2)
    save(Image.fromarray(np.clip(col, 0, 255).astype(np.uint8)), 'concrete.jpg')
    save(normal_from_height(h, 4.0), 'concrete_n.jpg')

deck_plate(); floor_tile(); carpet(); wall_paint(); ceiling(); console(); concrete()
