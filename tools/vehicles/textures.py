# ═══════════════════════════════════════════════════════════════
# Shared vehicle textures (python3 + numpy + Pillow):
#   python3 tools/vehicles/textures.py [OUT_DIR]     (default models/vehicles/tex)
#
#   paint_<scheme>.jpg   1024², tileable, covers PAINT_TILE metres (vkit.py box-maps the Paint material in metres)
#                        red_camo  Soviet/Russian three-tone summer camouflage (4BO green, khaki sand, black-brown)
#                        red_green plain 4BO green, weathered
#                        blue_green NATO CARC three-tone (green 383, brown 383, black)
#                        blue_tan  CARC tan 686A, weathered
#   detail.png / detail_orm.png   512² palette for the Detail material: 16×16 swatches of 32 px (flat colours with a
#                        little grain) + a few pattern cells; ORM = (occlusion, roughness, metalness) per swatch.
#                        The swatch table (PALETTE below) is mirrored in vkit.py, which maps faces to swatches.
#   track.jpg            512×128 tileable track links (u along the track, one tile = TRACK_LINKS links)
# ═══════════════════════════════════════════════════════════════
import sys, os, math
import numpy as np
from PIL import Image, ImageDraw, ImageFilter

OUT = sys.argv[1] if len(sys.argv) > 1 else os.path.join(os.path.dirname(__file__), '..', '..', 'models', 'vehicles', 'tex')
os.makedirs(OUT, exist_ok=True)
N = 1024
PAINT_TILE = 6.0   # metres covered by one paint tile (keep in sync with vkit.PAINT_TILE)
rng = np.random.default_rng(1943)


def tile_noise(n, freq, sharp=2.0, seed=None):
    """tileable band-limited noise in [-1, 1]: white noise filtered around `freq` cycles per tile (FFT → periodic)"""
    r = np.random.default_rng(seed) if seed is not None else rng
    w = r.standard_normal((n, n))
    fx = np.fft.fftfreq(n) * n
    kx, ky = np.meshgrid(fx, fx)
    k = np.sqrt(kx * kx + ky * ky)
    filt = np.exp(-((k / freq) ** sharp))
    filt[0, 0] = 0
    f = np.real(np.fft.ifft2(np.fft.fft2(w) * filt))
    f /= (np.abs(f).max() + 1e-9)
    return f


def fbm(n, base, octaves=4, gain=0.5, seed=0):
    out = np.zeros((n, n))
    amp, tot = 1.0, 0.0
    for o in range(octaves):
        out += amp * tile_noise(n, base * (2 ** o), 2.0, seed + o * 17)
        tot += amp
        amp *= gain
    return out / tot


def warp(field, dx, dy, amount):
    """domain-warp a tileable field by tileable offset fields (wraps, so it stays tileable)"""
    n = field.shape[0]
    yy, xx = np.mgrid[0:n, 0:n].astype(np.float64)
    sx = (xx + dx * amount) % n
    sy = (yy + dy * amount) % n
    x0 = np.floor(sx).astype(int); y0 = np.floor(sy).astype(int)
    fx = sx - x0; fy = sy - y0
    x1 = (x0 + 1) % n; y1 = (y0 + 1) % n
    return (field[y0, x0] * (1 - fx) * (1 - fy) + field[y0, x1] * fx * (1 - fy) +
            field[y1, x0] * (1 - fx) * fy + field[y1, x1] * fx * fy)


def blur_wrap(a, radius):
    """gaussian blur with wrap-around (tileable), via FFT"""
    n = a.shape[0]
    fx = np.fft.fftfreq(n)
    kx, ky = np.meshgrid(fx, fx)
    g = np.exp(-2 * (math.pi ** 2) * (radius ** 2) * (kx * kx + ky * ky))
    if a.ndim == 2:
        return np.real(np.fft.ifft2(np.fft.fft2(a) * g))
    return np.stack([np.real(np.fft.ifft2(np.fft.fft2(a[..., c]) * g)) for c in range(a.shape[2])], -1)


def srgb(h):
    return np.array([(h >> 16) & 255, (h >> 8) & 255, h & 255], dtype=np.float64)


def weather(img, seed, dust=(150, 138, 110), dust_amt=0.10, grain=4.0, streaks=0.05, chips=0.004):
    """paint grain, large soft light/dark variation, faint vertical grime streaks, dust tint and small chips"""
    n = img.shape[0]
    big = fbm(n, 3, 3, 0.5, seed + 1)
    img = img * (1 + 0.07 * big[..., None])
    d = np.clip(fbm(n, 5, 3, 0.55, seed + 2) * 0.5 + 0.5, 0, 1) ** 2.2
    img = img * (1 - dust_amt * d[..., None]) + np.array(dust) * dust_amt * d[..., None]
    # vertical streaks: noise stretched along v (image y), tileable
    st = tile_noise(n, 40, 2.0, seed + 3)
    st = blur_wrap(np.repeat(st[:, ::1], 1, 0), 0.8)
    col = np.tile(st[0:1, :], (n, 1))                   # a streak value per column…
    fade = tile_noise(n, 6, 2.0, seed + 4) * 0.5 + 0.5  # …switched on in patches
    img = img * (1 - streaks * np.clip(col, 0, 1)[..., None] * fade[..., None])
    img = img + rng.normal(0, grain, img.shape[:2])[..., None]
    ch = rng.random((n, n)) < chips
    ch = blur_wrap(ch.astype(np.float64), 0.7) > 0.12
    img[ch] = img[ch] * 0.55 + np.array([62, 58, 50]) * 0.45
    return np.clip(img, 0, 255)


def camo(cols, fracs, scale, seed, edge=1.6, warp_amt=90):
    """three/four-colour blotch camouflage: cols[0] is the base; each further colour covers ~fracs[i] of the tile"""
    n = N
    img = np.tile(srgb(cols[0]), (n, n, 1))
    wx = tile_noise(n, 6, 2, seed + 11); wy = tile_noise(n, 6, 2, seed + 12)
    taken = np.zeros((n, n), bool)
    for i, (c, f) in enumerate(zip(cols[1:], fracs)):
        fld = fbm(n, scale, 3, 0.45, seed + 30 * i)
        fld = warp(fld, wx, wy, warp_amt)
        fld = blur_wrap(fld, edge)
        free = fld[~taken]
        t = np.quantile(free, 1 - f / max(1e-6, (1 - taken.mean())))
        m = (fld > t) & ~taken
        # a sprayed edge: a thin soft band
        soft = np.clip((fld - t) / 0.025, 0, 1)
        soft[taken] = 0
        img = img * (1 - soft[..., None]) + srgb(c) * soft[..., None]
        taken |= m
    return img


def save_jpg(a, name, q=86):
    Image.fromarray(np.clip(a, 0, 255).astype(np.uint8)).save(os.path.join(OUT, name), quality=q, optimize=True)
    print('wrote', name)


# ── paints (colours: sRGB; blotch scale = blotches per 6 m tile) ──
save_jpg(weather(camo([0x4c5533, 0x958a66, 0x2c2b25], [0.30, 0.20], 3.2, 100), 5), 'paint_red_camo.jpg')
save_jpg(weather(np.tile(srgb(0x4f5937), (N, N, 1)) * (1 + 0.035 * fbm(N, 8, 3, 0.5, 21))[..., None], 6, dust_amt=0.12), 'paint_red_green.jpg')
save_jpg(weather(camo([0x4a5230, 0x5b4a35, 0x262624], [0.33, 0.18], 2.6, 200, edge=1.0, warp_amt=60), 7, dust_amt=0.08), 'paint_blue_green.jpg')
save_jpg(weather(np.tile(srgb(0xb49f78), (N, N, 1)) * (1 + 0.03 * fbm(N, 8, 3, 0.5, 31))[..., None], 8,
                 dust=(190, 172, 140), dust_amt=0.10, streaks=0.07), 'paint_blue_tan.jpg')

# ── detail palette ──
# name: (sRGB hex, roughness, metalness). Order = swatch index (row-major, 16 per row). Keep in sync with vkit.PALETTE
PALETTE = [
    ('tyre', 0x262624, 0.92, 0.0), ('tyre_side', 0x2e2d2a, 0.88, 0.0), ('rubber', 0x1c1c1b, 0.85, 0.0), ('black', 0x161616, 0.55, 0.1),
    ('dark', 0x2b2d2a, 0.65, 0.25), ('gunmetal', 0x3c3f40, 0.45, 0.7), ('steel', 0x7a7c7a, 0.4, 0.85), ('chrome', 0xd2d4d4, 0.12, 1.0),
    ('glass', 0x141b21, 0.05, 0.0), ('lens', 0xe8e6d8, 0.08, 0.0), ('lens_red', 0xa81a12, 0.15, 0.0), ('lens_amber', 0xd97a16, 0.15, 0.0),
    ('lens_blue', 0x2f4d8c, 0.15, 0.0), ('white', 0xdcdcd4, 0.5, 0.0), ('grey', 0x7c7d78, 0.6, 0.1), ('darkgrey', 0x46474a, 0.6, 0.15),
    ('missile_green', 0x56613e, 0.5, 0.08), ('missile_grey', 0x8e928c, 0.45, 0.1), ('missile_white', 0xe2e2dc, 0.4, 0.05), ('nose', 0x3a3d38, 0.45, 0.1),
    ('canvas', 0x6f6947, 0.95, 0.0), ('canvas_green', 0x4c5634, 0.95, 0.0), ('wood', 0x7a5a36, 0.8, 0.0), ('rust', 0x6e3d24, 0.9, 0.2),
    ('brass', 0xb48c3c, 0.35, 1.0), ('copper', 0xa8643c, 0.35, 1.0), ('radome', 0xc8c3aa, 0.55, 0.0), ('radar_face', 0x6c7064, 0.5, 0.2),
    ('soot', 0x0f0e0d, 1.0, 0.0), ('red', 0x9c231c, 0.55, 0.0), ('yellow', 0xd7b32a, 0.55, 0.0), ('orange', 0xd0601c, 0.55, 0.0),
    ('olive', 0x4f5a37, 0.7, 0.1), ('sand', 0x9d9068, 0.8, 0.05), ('tan', 0xb49f78, 0.7, 0.05), ('odgreen', 0x4a5230, 0.7, 0.1),
    ('hose', 0x202020, 0.7, 0.0), ('cable', 0x1a1a1a, 0.6, 0.0), ('aluminium', 0xa4a8ab, 0.35, 0.9), ('insulator', 0xd8d4c4, 0.3, 0.0),
    ('seat', 0x3d3a2e, 0.9, 0.0), ('dash', 0x222422, 0.8, 0.0), ('interior', 0x5f6b58, 0.8, 0.05), ('floor', 0x383a36, 0.9, 0.1),
    ('blast', 0x2e2c29, 0.95, 0.3), ('track_pad', 0x242322, 0.9, 0.1), ('zinc', 0x9aa0a2, 0.5, 0.8), ('dirt', 0x5a4c3a, 1.0, 0.0),
    ('lamp_glow', 0xfff4d6, 0.3, 0.0), ('green_lamp', 0x3ad05a, 0.3, 0.0), ('screen', 0x1d3a2a, 0.2, 0.0), ('decal_white', 0xe6e6e0, 0.6, 0.0),
]
# pattern cells (u0, v0 in swatch units, w, h): mesh screen, vent slots
PATTERNS = {'mesh': (0, 12, 4, 4), 'vents': (4, 12, 4, 4), 'tread_plate': (8, 12, 4, 4), 'dials': (12, 12, 4, 4)}
S = 32
det = np.zeros((512, 512, 3))
orm = np.zeros((512, 512, 3))
for i, (name, hx, rough, metal) in enumerate(PALETTE):
    cx, cy = (i % 16) * S, (i // 16) * S
    c = srgb(hx)
    det[cy:cy + S, cx:cx + S] = c * (1 + rng.normal(0, 0.02, (S, S, 1)))
    orm[cy:cy + S, cx:cx + S] = [255, rough * 255, metal * 255]
# mesh: dark wire grid
mx, my, mw, mh = [v * S for v in PATTERNS['mesh']]
g = np.full((mh, mw, 3), 28.0)
yy, xx = np.mgrid[0:mh, 0:mw]
wire = ((xx % 8) < 2) | ((yy % 8) < 2)
g[wire] = [88, 90, 86]
det[my:my + mh, mx:mx + mw] = g
orm[my:my + mh, mx:mx + mw] = [255, 150, 90]
orm[my:my + mh, mx:mx + mw][wire] = [255, 110, 200]
# vents: dark slots on a mid-grey
vx, vy, vw, vh = [v * S for v in PATTERNS['vents']]
g = np.full((vh, vw, 3), 70.0)
yy, xx = np.mgrid[0:vh, 0:vw]
slot = ((yy % 16) > 4) & ((yy % 16) < 12) & ((xx % 64) > 6) & ((xx % 64) < 58)
g[slot] = [18, 18, 17]
det[vy:vy + vh, vx:vx + vw] = g
orm[vy:vy + vh, vx:vx + vw] = [255, 170, 60]
# tread plate (diamond checker, bare steel)
tx, ty, tw, th = [v * S for v in PATTERNS['tread_plate']]
yy, xx = np.mgrid[0:th, 0:tw]
a = ((xx + yy) % 16 < 3) & ((xx // 8 + yy // 8) % 2 == 0)
b = ((xx - yy) % 16 < 3) & ((xx // 8 + yy // 8) % 2 == 1)
g = np.full((th, tw, 3), 96.0)
g[a | b] = [150, 152, 150]
det[ty:ty + th, tx:tx + tw] = g
orm[ty:ty + th, tx:tx + tw] = [255, 165, 120]   # worn, painted-over steel: not a mirror
# dials (instrument panel)
dx, dy, dw, dh = [v * S for v in PATTERNS['dials']]
im = Image.new('RGB', (dw, dh), (34, 36, 34))
dr = ImageDraw.Draw(im)
for k in range(6):
    x0, y0 = 10 + (k % 3) * 40, 14 + (k // 3) * 50
    dr.ellipse([x0, y0, x0 + 32, y0 + 32], fill=(12, 12, 12), outline=(150, 150, 140))
    dr.line([x0 + 16, y0 + 16, x0 + 16 + 12 * math.cos(k), y0 + 16 - 12 * math.sin(k)], fill=(230, 230, 220), width=2)
for k in range(8):
    dr.rectangle([10 + k * 14, 112, 18 + k * 14, 120], fill=(60 + 20 * (k % 3), 60, 50))
det[dy:dy + dh, dx:dx + dw] = np.asarray(im, np.float64)
orm[dy:dy + dh, dx:dx + dw] = [255, 150, 30]
Image.fromarray(np.clip(det, 0, 255).astype(np.uint8)).save(os.path.join(OUT, 'detail.png'), optimize=True)
Image.fromarray(np.clip(orm, 0, 255).astype(np.uint8)).save(os.path.join(OUT, 'detail_orm.png'), optimize=True)
print('wrote detail.png, detail_orm.png', len(PALETTE), 'swatches')

# ── track: 4 links per tile, u along the track (image x), v across (image y) ──
TW, TH, LINKS = 512, 128, 4
tr = np.zeros((TH, TW, 3))
yy, xx = np.mgrid[0:TH, 0:TW].astype(np.float64)
lx = (xx % (TW / LINKS)) / (TW / LINKS)          # 0..1 within a link
tr[:] = [46, 44, 41]
# link plate with a raised grouser bar across it, rubber pads in two rows (western style) / bare steel
plate = (lx > 0.06) & (lx < 0.94)
tr[plate] = [58, 56, 52]
grouser = (lx > 0.40) & (lx < 0.60)
tr[grouser] = [92, 90, 86]
pins = (lx < 0.06) | (lx > 0.94)
tr[pins] = [30, 29, 28]
edge = (yy < 10) | (yy > TH - 10)
tr[edge & ~pins] = [74, 72, 68]                  # end connectors
guide = (np.abs(yy - TH / 2) < 6) & (lx > 0.3) & (lx < 0.7)
tr[guide] = [104, 102, 98]                       # centre guide horn (polished)
tr += rng.normal(0, 5, (TH, TW, 1))
tr = blur_wrap(np.pad(tr, ((0, TW - TH), (0, 0), (0, 0)), mode='wrap'), 0.6)[:TH] if False else tr
Image.fromarray(np.clip(tr, 0, 255).astype(np.uint8)).save(os.path.join(OUT, 'track.jpg'), quality=88)
print('wrote track.jpg')
