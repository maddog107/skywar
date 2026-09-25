# ═══════════════════════════════════════════════════════════════
# Textures for the scripted carrier (python3 + Pillow + numpy, no Blender):
#   python3 tools/ships/ship_textures.py <outdir>
# writes  <outdir>/carrier_deck.jpg  (1024×4096: flight deck, bow at the top, port on the left)
#         <outdir>/carrier_hull.jpg  (2048×256: hull sides, bow on the left, keel at the bottom)
# The Blender script (carrier_model.py) maps them with the same layout constants.
# All artwork is generated here (CC0, part of SKYWAR).
# ═══════════════════════════════════════════════════════════════
import math, os, random, sys
import numpy as np
from PIL import Image, ImageDraw, ImageFilter, ImageFont

sys.dont_write_bytecode = True
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import carrier_layout as C

OUT = sys.argv[1] if len(sys.argv) > 1 else '.'
os.makedirs(OUT, exist_ok=True)
rng = random.Random(73)
nrng = np.random.default_rng(73)

def font(size, names=('DIN Condensed Bold.ttf', 'Arial Black.ttf', 'Arial Bold.ttf')):
    for n in names:
        for d in ('/System/Library/Fonts/Supplemental', '/System/Library/Fonts', '/usr/share/fonts/truetype/dejavu', '/Library/Fonts'):
            p = os.path.join(d, n)
            if os.path.exists(p):
                return ImageFont.truetype(p, size)
    for p in ('/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf',):
        if os.path.exists(p):
            return ImageFont.truetype(p, size)
    return ImageFont.load_default()

def smooth_noise(h, w, cell, rng_):
    """value noise: random grid of size (h/cell, w/cell) upsampled bicubically"""
    gh, gw = max(2, int(h / cell) + 2), max(2, int(w / cell) + 2)
    g = rng_.random((gh, gw)).astype(np.float32)
    im = Image.fromarray((g * 255).astype(np.uint8)).resize((int(gw * cell), int(gh * cell)), Image.BICUBIC)
    return np.asarray(im, dtype=np.float32)[:h, :w] / 255.0

# ═════════════ Flight deck ═════════════
W, H = 1024, 4096
SS = 2  # supersampling for the vector markings
sx = W / (C.TEX_X1 - C.TEX_X0)   # px per metre across
sz = H / (C.TEX_Z1 - C.TEX_Z0)   # px per metre along

def P(x, z, s=1):
    return ((x - C.TEX_X0) * sx * s, (z - C.TEX_Z0) * sz * s)

# base non-skid: dark grey with low-frequency mottling and panel-to-panel tone steps
base = np.full((H, W), 0.0, np.float32)
base += 0.55 * smooth_noise(H, W, 180, nrng) + 0.3 * smooth_noise(H, W, 40, nrng) + 0.15 * smooth_noise(H, W, 9, nrng)
base = (base - 0.5) * 0.12
# non-skid panels ~ 6 m × 12 m, each a slightly different tone
pan = np.zeros((H, W), np.float32)
for j in range(int(320 / 12) + 1):
    for i in range(int(76 / 6) + 1):
        x0, z0 = C.TEX_X0 + i * 6, C.TEX_Z0 + j * 12
        a, b = P(x0, z0)
        c, d = P(x0 + 6, z0 + 12)
        pan[int(b):int(d), int(a):int(c)] = nrng.normal(0, 0.006)
# sparse re-coated patches (fresher, darker non-skid) and worn lighter areas
for k in range(40):
    x0, z0 = rng.uniform(-40, 30), rng.uniform(-158, 150)
    a, b = P(x0, z0)
    c, d = P(x0 + rng.choice([6, 12]), z0 + rng.choice([12, 24]))
    pan[int(b):int(d), int(a):int(c)] += rng.uniform(-0.025, -0.01)
pan = np.asarray(Image.fromarray(((pan + 0.5) * 255).clip(0, 255).astype(np.uint8)).filter(ImageFilter.GaussianBlur(1.2)), np.float32) / 255 - 0.5
grain = nrng.normal(0, 0.035, (H, W)).astype(np.float32)
lum = 0.35 + base + pan + grain * 0.5
deck = np.stack([lum * 1.06, lum * 1.0, lum * 0.9], -1)

# tie-down points: a grid of small dark dots
for zz in np.arange(-157, 158, 3.3):
    for xx in np.arange(-41, 34, 3.3):
        px, py = P(xx, zz)
        ix, iy = int(px), int(py)
        if 1 <= ix < W - 1 and 1 <= iy < H - 1:
            deck[iy - 1:iy + 1, ix - 1:ix + 1] *= 0.55

img = Image.fromarray(np.clip(deck * 255, 0, 255).astype(np.uint8), 'RGB')

# ── grime layer (soot, tyre rubber, steam stains), drawn at 1× with blur ──
grime = Image.new('L', (W, H), 0)
gd = ImageDraw.Draw(grime)
def dir_line(x, z, dx, dz, length, width, alpha):
    a = P(x, z); b = P(x + dx * length, z + dz * length)
    gd.line([a, b], fill=alpha, width=max(1, int(width * sx)))
# tyre marks along the angled deck and along the gameplay landing lane (x = −4)
for k in range(260):
    z = rng.uniform(40, 156) if rng.random() < 0.7 else rng.uniform(-20, 156)
    if rng.random() < 0.5:
        x = C.la_center_x(z) + rng.gauss(0, 3.2)
        dx, dz = C.LA_DIR
    else:
        x = -4 + rng.gauss(0, 2.2)
        dx, dz = 0.0, -1.0
    dir_line(x, z, dx, dz, rng.uniform(4, 30) * (1.6 if z > 90 else 1), rng.uniform(0.15, 0.4), rng.randint(20, 70))
# heavy rubber deposit in the touchdown zone
for k in range(90):
    z = rng.uniform(98, 150)
    x = C.la_center_x(z) + rng.gauss(0, 2.0)
    dir_line(x, z, C.LA_DIR[0], C.LA_DIR[1], rng.uniform(6, 18), rng.uniform(0.3, 0.6), rng.randint(40, 90))
# soot / steam along the cat tracks and blast marks behind the JBDs
for (cx, z0, z1) in C.CATS:
    for k in range(40):
        z = rng.uniform(min(z0, z1), max(z0, z1))
        dir_line(cx + rng.gauss(0, 0.8), z, 0, -1, rng.uniform(3, 12), rng.uniform(0.3, 1.2), rng.randint(15, 45))
for (cx, zh, wd, _) in C.JBDS:
    for k in range(30):
        a = P(cx + rng.uniform(-wd / 2, wd / 2), zh + rng.uniform(4.5, 12))
        r = rng.uniform(0.6, 2.2) * sx
        gd.ellipse([a[0] - r, a[1] - r * 2, a[0] + r, a[1] + r * 2], fill=rng.randint(25, 60))
# oil drips / random stains
for k in range(500):
    a = P(rng.uniform(-40, 32), rng.uniform(-158, 158))
    r = rng.uniform(0.2, 1.1) * sx
    gd.ellipse([a[0] - r, a[1] - r, a[0] + r, a[1] + r], fill=rng.randint(10, 35))
grime = grime.filter(ImageFilter.GaussianBlur(1.6))
g = np.asarray(grime, np.float32)[..., None] / 255.0
arr = np.asarray(img, np.float32)
arr = arr * (1 - g * 0.8) + np.array([18, 17, 16], np.float32) * g * 0.8
img = Image.fromarray(np.clip(arr, 0, 255).astype(np.uint8), 'RGB')

# ── vector markings on a 2× RGBA layer, then downsampled onto the deck ──
mk = Image.new('RGBA', (W * SS, H * SS), (0, 0, 0, 0))
md = ImageDraw.Draw(mk)
WHITE = (236, 236, 230, 255)
YELLOW = (226, 186, 52, 255)
RED = (176, 40, 34, 255)
BLACK = (22, 22, 22, 255)

def Q(x, z):
    return P(x, z, SS)

def seg(a, b, color, width_m):
    md.line([Q(*a), Q(*b)], fill=color, width=max(1, int(round(width_m * sx * SS))))

def dashed(a, b, color, width_m, dash, gap, phase=0.0):
    ax, az = a; bx, bz = b
    Ltot = math.hypot(bx - ax, bz - az)
    ux, uz = (bx - ax) / Ltot, (bz - az) / Ltot
    s = -phase
    while s < Ltot:
        s0, s1 = max(s, 0), min(s + dash, Ltot)
        if s1 > s0:
            seg((ax + ux * s0, az + uz * s0), (ax + ux * s1, az + uz * s1), color, width_m)
        s += dash + gap

def poly(pts, color):
    md.polygon([Q(x, z) for x, z in pts], fill=color)

def quad_along(a, b, half_w, color):
    ax, az = a; bx, bz = b
    Ll = math.hypot(bx - ax, bz - az)
    nx, nz = (bz - az) / Ll, -(bx - ax) / Ll
    poly([(ax + nx * half_w, az + nz * half_w), (bx + nx * half_w, bz + nz * half_w),
          (bx - nx * half_w, bz - nz * half_w), (ax - nx * half_w, az - nz * half_w)], color)

# deck-edge line (thin white, a little inboard of the edge) round the landing area side and the stern
def edge_line(edge, inset, z0, z1, color=WHITE, width=0.25, dash=None):
    zs = np.linspace(z0, z1, 120)
    pts = [(C.edge_at(edge, z) + inset, z) for z in zs]
    for a, b in zip(pts, pts[1:]):
        seg(a, b, color, width)
edge_line(C.PORT_EDGE, 0.9, -150, 158)
edge_line(C.STBD_EDGE, -0.9, -150, 158)

# ── angled landing area ──
fwd_len = (160 - C.LA_FWD_Z) / math.cos(C.ANGLE)
def la_pt(s, off):
    """s metres forward of the ramp along the centreline, off metres to starboard"""
    x0, z0 = C.la_center_x(160), 160.0
    return (x0 + C.LA_DIR[0] * s + C.LA_PERP[0] * off, z0 + C.LA_DIR[1] * s + C.LA_PERP[1] * off)
# boundaries: port solid white, starboard = the foul line (red/white)
seg(la_pt(0, -C.LA_HALF_W), la_pt(fwd_len, -C.LA_HALF_W), WHITE, 0.45)
seg(la_pt(0, C.LA_HALF_W), la_pt(fwd_len, C.LA_HALF_W), WHITE, 0.45)
dashed(la_pt(0, C.LA_HALF_W + 0.9), la_pt(fwd_len, C.LA_HALF_W + 0.9), RED, 0.45, 1.5, 1.5)
# centreline dashes
dashed(la_pt(2, 0), la_pt(fwd_len, 0), WHITE, 0.6, 7, 7)
# forward limit bar
seg(la_pt(fwd_len, -C.LA_HALF_W), la_pt(fwd_len, C.LA_HALF_W), WHITE, 0.6)
# ramp: short white hash marks across the stern of the landing area
for k in range(-6, 7):
    a = la_pt(0.4, k * 1.9)
    b = la_pt(3.4, k * 1.9)
    seg(a, b, WHITE, 0.35)
# arresting wires: dark cable line, white sheave marks at both ends, a number beside each
fnt_w = font(int(2.6 * sz * SS))
for i in range(len(C.WIRES_Z)):
    a, b = C.wire_ends(i)
    seg(a, b, BLACK, 0.22)
    for e, sgn in ((a, 1), (b, -1)):
        ex, ez = e
        seg((ex, ez - 0.9), (ex, ez + 0.9), WHITE, 0.4)
    # small wire number just outboard of the landing area's port edge
    px, pz = la_pt((160 - C.WIRES_Z[i]) / math.cos(C.ANGLE), -C.LA_HALF_W - 3.2)
    q = Q(px, pz)
    md.text(q, str(i + 1), fill=WHITE, font=fnt_w, anchor='mm')

# ── catapults ──
for n, (cx, z0, z1) in enumerate(C.CATS):
    zt, zb = min(z0, z1), max(z0, z1)
    poly([(cx - 0.55, zt), (cx + 0.55, zt), (cx + 0.55, zb), (cx - 0.55, zb)], (58, 60, 62, 255))
    seg((cx, zt + 0.5), (cx, zb), (8, 8, 8, 255), 0.14)          # shuttle slot
    seg((cx - 0.75, zt), (cx - 0.75, zb), WHITE, 0.14)
    seg((cx + 0.75, zt), (cx + 0.75, zb), WHITE, 0.14)
    # yellow lead-in line up to the shuttle start, and shuttle-start "T"
    seg((cx, zb), (cx, zb + 16), YELLOW, 0.35)
    seg((cx - 1.8, zb), (cx + 1.8, zb), WHITE, 0.4)
    # launch-bar hash marks every 10 m along the stroke
    for zz in np.arange(zb - 10, zt + 5, -10):
        seg((cx - 1.4, zz), (cx - 0.9, zz), WHITE, 0.25)
        seg((cx + 0.9, zz), (cx + 1.4, zz), WHITE, 0.25)
# JBD panels (flush ones painted; the raised one is geometry, but its hinge area is painted too)
for (cx, zh, wd, raised) in C.JBDS:
    x0, x1 = cx - wd / 2, cx + wd / 2
    poly([(x0, zh), (x1, zh), (x1, zh + 4.4), (x0, zh + 4.4)], (46, 48, 50, 255))
    for k in range(1, 11):
        zz = zh + k * 0.4
        seg((x0 + 0.2, zz), (x1 - 0.2, zz), (70, 72, 74, 255), 0.08)
    seg((x0, zh), (x1, zh), YELLOW, 0.2)
    seg((x0, zh + 4.4), (x1, zh + 4.4), YELLOW, 0.2)

# ── elevators: outline + hazard edge on the inboard side ──
for (x0, x1, z0, z1) in C.ELEVATORS:
    for a, b in (((x0, z0), (x1, z0)), ((x0, z1), (x1, z1)), ((x0, z0), (x0, z1)), ((x1, z0), (x1, z1))):
        seg(a, b, (20, 20, 20, 255), 0.12)
    inboard = x0 if x0 > 0 else x1
    dashed((inboard + (0.35 if x0 > 0 else -0.35), z0), (inboard + (0.35 if x0 > 0 else -0.35), z1), YELLOW, 0.4, 1.0, 1.0)
    dashed((inboard + (0.35 if x0 > 0 else -0.35), z0), (inboard + (0.35 if x0 > 0 else -0.35), z1), BLACK, 0.4, 1.0, 1.0, 1.0)

# ── yellow taxi lines ──
def curve(pts, color, width):
    for a, b in zip(pts, pts[1:]):
        seg(a, b, color, width)
curve([(3.0, -150)] + [(3.0 + 0.0 * t, -150 + t) for t in range(0, 110, 5)], YELLOW, 0.3)
curve([(3.0 + 6 * (1 - math.cos(t / 40 * math.pi / 2)), -40 + t) for t in range(0, 41, 2)], YELLOW, 0.3)
curve([(-12 - 8 * math.sin(t / 60 * math.pi / 2), 20 - t) for t in range(0, 61, 3)], YELLOW, 0.3)
# safe-parking line along the starboard side and around the island
curve([(17.0, -150), (17.0, -100)], WHITE, 0.25)
dashed((12.0, 5.0), (12.0, 50.0), WHITE, 0.3, 2.0, 2.0)

# ── hull number at the bow (reads from astern) ──
fnt = font(int(15 * sz * SS))
q = Q(3.0, -140)
md.text(q, '73', fill=WHITE, font=fnt, anchor='mm')

# LSO platform and lens marks
lx, lz = C.LSO
poly([(lx - 2.5, lz - 3), (lx + 2.5, lz - 3), (lx + 2.5, lz + 3), (lx - 2.5, lz + 3)], (70, 72, 70, 255))
seg((lx - 2.5, lz - 3), (lx + 2.5, lz - 3), WHITE, 0.2)

mk = mk.resize((W, H), Image.LANCZOS)
# weather the paint a little: markings pick up the grime too
mka = np.asarray(mk, np.float32) / 255.0
alpha = mka[..., 3:4] * (0.88 + 0.12 * smooth_noise(H, W, 30, nrng)[..., None]) * (1 - g * 0.55)
arr = np.asarray(img, np.float32)
arr = arr * (1 - alpha) + mka[..., :3] * 255 * alpha
Image.fromarray(np.clip(arr, 0, 255).astype(np.uint8), 'RGB').save(os.path.join(OUT, 'carrier_deck.jpg'), quality=86, optimize=True)

# ═════════════ Hull sides ═════════════
HW, HH = 2048, 256
Y_TOP, Y_BOT = 20.0, -12.0
def hy(y):
    return (Y_TOP - y) / (Y_TOP - Y_BOT) * HH
def hx(z):
    return (z + 160.0) / 320.0 * HW
ys = Y_TOP - (np.arange(HH) + 0.5) / HH * (Y_TOP - Y_BOT)
Y = np.repeat(ys[:, None], HW, 1)
grey = np.array([0.5, 0.525, 0.545], np.float32)
red = np.array([0.36, 0.13, 0.10], np.float32)
blk = np.array([0.08, 0.085, 0.09], np.float32)
col = np.where((Y > C.BOOT_HI)[..., None], grey, np.where((Y > C.BOOT_LO)[..., None], blk, red))
# red darkens with depth (less light, more fouling), grey gets a salt-stained band above the boot top
col = col * np.where((Y < C.BOOT_LO)[..., None], (0.85 + 0.15 * np.clip((Y + 11) / 10, 0, 1))[..., None], 1.0)
band = np.clip(1 - (Y - C.BOOT_HI) / 3.0, 0, 1) * (Y > C.BOOT_HI)
col = col * (1 - 0.18 * band[..., None])
# mottling and plate seams
mott = smooth_noise(HH, HW, 24, nrng) * 0.6 + smooth_noise(HH, HW, 6, nrng) * 0.4
col = col * (0.93 + 0.12 * mott[..., None])
for yy in np.arange(-10.8, 20, 2.4):
    r = int(hy(yy))
    if 0 <= r < HH:
        col[r] *= 0.9
for zz in np.arange(-158, 160, 6.2):
    c = int(hx(zz))
    col[:, c] *= 0.95
himg = Image.fromarray(np.clip(col * 255, 0, 255).astype(np.uint8), 'RGB')
hd = ImageDraw.Draw(himg, 'RGBA')
# rust / water streaks running down from scuppers and openings
for k in range(420):
    z = rng.uniform(-150, 150)
    y0 = rng.choice([rng.uniform(9, 16), rng.uniform(3, 9)])
    Ls = rng.uniform(0.8, 6.0)
    x = hx(z)
    c = (95, 62, 40, rng.randint(25, 70)) if rng.random() < 0.6 else (40, 42, 44, rng.randint(20, 50))
    hd.line([(x, hy(y0)), (x + rng.uniform(-1, 1), hy(max(y0 - Ls, C.BOOT_HI)))], fill=c, width=rng.choice([1, 1, 2]))
# hawse pipes (anchors) near the bow
for z in (-141.0,):
    x, y = hx(z), hy(12.0)
    hd.ellipse([x - 7, y - 5, x + 7, y + 5], fill=(18, 18, 18, 255))
    hd.ellipse([x - 5, y - 3.5, x + 5, y + 3.5], fill=(40, 40, 40, 255))
    for k in range(6):
        hd.line([(x + rng.uniform(-5, 5), y + 4), (x + rng.uniform(-6, 6), hy(rng.uniform(4, 9)))], fill=(110, 60, 35, 90), width=2)
# small dark openings along the gallery-deck fascia
for z in np.arange(-150, 150, 9.5):
    if rng.random() < 0.55:
        x = hx(z + rng.uniform(-2, 2))
        hd.rectangle([x - 2, hy(18.2), x + 2, hy(17.2)], fill=(30, 32, 34, 200))
# draught marks at bow and stern (white numerals every metre, small)
fs = font(9, ('Arial Bold.ttf',))
for z in (-146.0, 146.0):
    for d in range(2, 12, 2):
        hd.text((hx(z), hy(-d + 0.4)), str(d), fill=(210, 210, 200, 200), font=fs, anchor='mm')
himg = himg.filter(ImageFilter.GaussianBlur(0.4))
himg.save(os.path.join(OUT, 'carrier_hull.jpg'), quality=88, optimize=True)
print('textures written to', OUT)

# ═════════════ Destroyer deck (x −11..11, z −78..78; bow at the top) ═════════════
DW, DH = 512, 2048
DX0, DX1, DZ0, DZ1 = -11.0, 11.0, -78.0, 78.0
dsx, dsz = DW / (DX1 - DX0), DH / (DZ1 - DZ0)
def DP(x, z, s=1):
    return ((x - DX0) * dsx * s, (z - DZ0) * dsz * s)
b2 = 0.55 * smooth_noise(DH, DW, 120, nrng) + 0.3 * smooth_noise(DH, DW, 30, nrng) + 0.15 * smooth_noise(DH, DW, 8, nrng)
dl = 0.3 + (b2 - 0.5) * 0.1 + nrng.normal(0, 0.03, (DH, DW)).astype(np.float32) * 0.5
dd = np.stack([dl * 1.01, dl, dl * 0.98], -1)
dimg = Image.fromarray(np.clip(dd * 255, 0, 255).astype(np.uint8), 'RGB')
mk2 = Image.new('RGBA', (DW * SS, DH * SS), (0, 0, 0, 0))
m2 = ImageDraw.Draw(mk2)
def DQ(x, z):
    return DP(x, z, SS)
def dseg(a, b, color, w):
    m2.line([DQ(*a), DQ(*b)], fill=color, width=max(1, int(round(w * dsx * SS))))
# flight deck (z 62..77.5): perimeter, lineup line, landing circle, hangar door "T"
FD0, FD1 = 62.5, 77.0
for (a, b) in (((-7.2, FD0), (7.2, FD0)), ((-7.2, FD0), (-7.2, FD1)), ((7.2, FD0), (7.2, FD1)), ((-7.2, FD1), (7.2, FD1))):
    dseg(a, b, WHITE, 0.2)
z = FD0 + 0.5
while z < FD1:
    dseg((0, z), (0, min(z + 1.2, FD1)), WHITE, 0.25)
    z += 2.4
cx, cz, r = 0.0, 70.0, 3.6
m2.ellipse([DQ(cx - r, cz - r)[0], DQ(cx - r, cz - r)[1], DQ(cx + r, cz + r)[0], DQ(cx + r, cz + r)[1]], outline=YELLOW, width=int(0.25 * dsx * SS))
dseg((-4.5, cz), (4.5, cz), WHITE, 0.3)
dseg((-3.0, FD0 + 0.6), (3.0, FD0 + 0.6), YELLOW, 0.3)
# anchor chain runs on the forecastle
for sg in (-1, 1):
    dseg((sg * 1.2, -63.0), (sg * 5.5, -71.5), (30, 30, 30, 255), 0.35)
mk2 = mk2.resize((DW, DH), Image.LANCZOS)
ma = np.asarray(mk2, np.float32) / 255.0
arr2 = np.asarray(dimg, np.float32)
arr2 = arr2 * (1 - ma[..., 3:4]) + ma[..., :3] * 255 * ma[..., 3:4]
Image.fromarray(np.clip(arr2, 0, 255).astype(np.uint8), 'RGB').save(os.path.join(OUT, 'destroyer_deck.jpg'), quality=86, optimize=True)
print('destroyer deck written')
