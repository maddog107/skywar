# ═══════════════════════════════════════════════════════════════
# Arleigh Burke-class (Flight IIA) guided-missile destroyer — scripted model for Blender:
#   python3 tools/ships/ship_textures.py /tmp/shiptex
#   blender -b -P tools/ships/destroyer_model.py -- /tmp/shiptex models/ships/destroyer.glb
# Game frame (see shipkit.py): x starboard, y up (0 = waterline), bow −z. naval.js TYPES.destroyer:
# L 155, B 20, deckY 8; mounts gun (0, deck, −58), VLS "sam" (−44), CIWS (0, 16, 26).
# Reference: LOA 155.3 m, beam 20.4 m (at the flared deck edge), hull draught ~6.3 m (9.4 m at the
# sonar dome), sheer rising to ~11 m at the stem; twin funnels, 4 SPY-1D faces, twin hangars aft.
# ═══════════════════════════════════════════════════════════════
import bpy, math, sys, os, json
sys.dont_write_bytecode = True
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from shipkit import (Part, material, srgb, smoothstep, lerp, clamp, add_text, ciws)

args = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
TEX = args[0] if len(args) > 0 else '/tmp/shiptex'
OUT = args[1] if len(args) > 1 else 'destroyer.glb'
FONT = next((p for p in ('/System/Library/Fonts/Supplemental/Arial Black.ttf',
                         '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf') if os.path.exists(p)), None)

bpy.ops.wm.read_factory_settings(use_empty=True)
material('Deck', srgb(0xffffff), 0.0, 0.88, image=os.path.join(TEX, 'destroyer_deck.jpg'))
material('Hull', srgb(0xffffff), 0.04, 0.68, image=os.path.join(TEX, 'carrier_hull.jpg'))
material('Super', srgb(0x899096), 0.04, 0.62)
material('Dark', srgb(0x2c2f32), 0.2, 0.7)
material('White', srgb(0xdadddd), 0.05, 0.45)
material('Glass', srgb(0x1a2631), 0.5, 0.12)
material('Array', srgb(0x5d646b), 0.1, 0.55)
material('Under', srgb(0x74879a), 0.04, 0.7)
material('NavRed', srgb(0xff2020), 0.0, 0.5, emit=srgb(0xff2020), emit_strength=5.0)
material('NavGreen', srgb(0x20ff50), 0.0, 0.5, emit=srgb(0x20ff50), emit_strength=5.0)
material('NavWhite', srgb(0xffffff), 0.0, 0.5, emit=srgb(0xfff4e0), emit_strength=5.0)

L = 155.0
BOW, STERN = -77.5, 77.5
KEEL = -6.3
DX0, DX1, DZ0, DZ1 = -11.0, 11.0, -78.0, 78.0

def deck_uv(x, y, z):
    return ((x - DX0) / (DX1 - DX0), (DZ1 - z) / (DZ1 - DZ0))

def hull_uv(x, y, z):
    return ((z + 160.0) / 320.0, (y + 12.0) / 32.0)

def sheer(z):
    """deck-edge height: rises to the stem, low flight deck aft"""
    if z < -20:
        t = (-20 - z) / (-20 - BOW)
        return 8.0 + 3.1 * t ** 1.6
    if z < 60:
        return 8.0 - 0.9 * (z + 20) / 80
    return 7.1 - 1.2 * smoothstep(60, 64, z)

def stem_z(y):
    t = clamp((y - KEEL) / (11.1 - KEEL), 0, 1)
    return -71.5 - 6.0 * t ** 1.3

def stern_z(y):
    return STERN if y >= -0.6 else STERN - 22.0 * ((-0.6 - y) / 5.7) ** 1.2

def bsec(y):
    R = 2.4
    cx, cy = 9.0 - R, KEEL + R
    if y < cy:
        dy = cy - y
        return cx + math.sqrt(max(R * R - dy * dy, 0.0))
    if y <= 0:
        return 9.0
    return 9.0 + 1.2 * min(y / 8.0, 1.0)      # flared topsides

def hb(s, y):
    t = clamp((y - KEEL) / (11.1 - KEEL), 0, 1)
    se = 0.46 - 0.12 * t
    k = 1.5 + 1.6 * t
    u = min(s / se, 1.0)
    fore = 1 - (1 - u) ** k
    sa = lerp(0.34, 0.22, smoothstep(-2.0, 1.0, y))
    tf = lerp(0.05, 0.74, smoothstep(-3.0, 0.5, y))
    w = smoothstep(1 - sa, 1.0, s) ** 1.3
    return bsec(y) * fore * (1 - (1 - tf) * w)

S = Part('destroyer_static')
# ═════════════ Hull: rows at fractions of the height (keel → sheer line) ═════════════
TS = [0.0, 0.03, 0.08, 0.15, 0.25, 0.36, 0.44, 0.5, 0.58, 0.68, 0.8, 0.9, 1.0]
NS = 80
grid = []
for t in TS:
    row = []
    for i in range(NS):
        s = 0.5 - 0.5 * math.cos(math.pi * i / (NS - 1))
        # z range depends on height: solve with the height at a mid-station estimate
        y_est = KEEL + t * (8.0 - KEEL)
        z0, z1 = stem_z(y_est), stern_z(y_est)
        z = z0 + s * (z1 - z0)
        y = KEEL + t * (sheer(z) - KEEL)
        z0, z1 = stem_z(y), stern_z(y)
        z = z0 + s * (z1 - z0)
        y = KEEL + t * (sheer(z) - KEEL)
        row.append((hb(s, y), y, z))
    grid.append(row)
g = S.g('Hull')
for k in range(len(TS) - 1):
    for i in range(NS - 1):
        a, b, c, d = grid[k][i], grid[k][i + 1], grid[k + 1][i + 1], grid[k + 1][i]
        for sg in (1, -1):
            q = [(sg * p[0], p[1], p[2]) for p in (a, b, c, d)]
            g.face(q, [hull_uv(*p) for p in q], (sg, 0, 0), True)
    a, d = grid[k][-1], grid[k + 1][-1]
    q = [(-a[0], a[1], a[2]), (a[0], a[1], a[2]), (d[0], d[1], d[2]), (-d[0], d[1], d[2])]
    g.face(q, [hull_uv(*p) for p in q], (0, 0, 1), True)
for i in range(NS - 1):
    a, b = grid[0][i], grid[0][i + 1]
    q = [(-a[0], a[1], a[2]), (a[0], a[1], a[2]), (b[0], b[1], b[2]), (-b[0], b[1], b[2])]
    g.face(q, [hull_uv(*p) for p in q], (0, -1, 0), True)
# sonar dome under the forefoot, bilge keels
S.sphere('Hull', (0.0, -7.2, -60.0), 2.1, 2.3, 9.0, nu=12, nv=8, uvf=hull_uv)
for sg in (1, -1):
    S.beam('Hull', (sg * 7.9, -5.2, -25.0), (sg * 7.9, -5.2, 25.0), 0.9, 0.15)

# waterline outline (y = 0): interpolate each column between the rows that straddle the waterline
wl = []
for i in range(0, NS, 2):
    col = [grid[k][i] for k in range(len(TS))]
    for k in range(len(col) - 1):
        (x0, y0, z0), (x1, y1, z1) = col[k], col[k + 1]
        if y0 <= 0 <= y1:
            t = (0 - y0) / (y1 - y0) if y1 != y0 else 0
            wl.append((round(x0 + (x1 - x0) * t, 2), round(z0 + (z1 - z0) * t, 2)))
            break
waterline = wl + [(-x, z) for x, z in reversed(wl)]

# ═════════════ Main deck (cambered strip following the sheer) ═════════════
top = grid[-1]
for i in range(NS - 1):
    a, b = top[i], top[i + 1]
    ca = (0.0, a[1] + 0.18, a[2]); cb = (0.0, b[1] + 0.18, b[2])
    for sg in (1, -1):
        q = [(sg * a[0], a[1], a[2]), (sg * b[0], b[1], b[2]), cb, ca]
        S.g('Deck').face(q, [deck_uv(*p) for p in q], (0, 1, 0))
deck_outline = [(round(p[0], 2), round(p[2], 2)) for p in top[::3]]
deck_outline = deck_outline + [(-x, z) for x, z in reversed(deck_outline)]
# deck-edge rails (stanchions + two wires) from the bow to the hangar, and round the flight deck
for i in range(2, NS - 1, 3):
    a, b = top[i], top[min(i + 3, NS - 1)]
    for sg in (1, -1):
        for hgt in (0.55, 1.05):
            S.beam('Dark', (sg * (a[0] - 0.1), a[1] + hgt, a[2]), (sg * (b[0] - 0.1), b[1] + hgt, b[2]), 0.035)
        S.beam('Dark', (sg * (a[0] - 0.1), a[1], a[2]), (sg * (a[0] - 0.1), a[1] + 1.1, a[2]), 0.05)

def deck_y(z):
    return sheer(z) + 0.1

def hull_x_at(z, y):
    """hull half-width at (z, y), from the nearest grid column"""
    i = min(range(NS), key=lambda i: abs(grid[-1][i][2] - z))
    col = [grid[k][i] for k in range(len(TS))]
    for k in range(len(col) - 1):
        (x0, y0, _), (x1, y1, _) = col[k], col[k + 1]
        if y0 <= y <= y1:
            return x0 + (x1 - x0) * ((y - y0) / (y1 - y0) if y1 != y0 else 0)
    return col[-1][0]

# ═════════════ Superstructure ═════════════
def tilted_block(x_half0, x_half1, y0, y1, z0, z1, mat='Super', chamfer_front=0.0, chamfer_back=0.0):
    """deckhouse with inward-sloping sides (stealth shaping) and optional 45° corner chamfers"""
    def ring(xh, y, ch_f, ch_b):
        return [(-xh + ch_f, y, z0), (xh - ch_f, y, z0), (xh, y, z0 + ch_f), (xh, y, z1 - ch_b), (xh - ch_b, y, z1), (-xh + ch_b, y, z1), (-xh, y, z1 - ch_b), (-xh, y, z0 + ch_f)]
    sc = x_half1 / x_half0
    r0 = ring(x_half0, y0, chamfer_front, chamfer_back)
    r1 = ring(x_half1, y1, chamfer_front * sc, chamfer_back * sc)
    n = len(r0)
    cz = (z0 + z1) / 2
    for i in range(n):
        j = (i + 1) % n
        q = [r0[i], r0[j], r1[j], r1[i]]
        mx = (r0[i][0] + r0[j][0]) / 2; mz = (r0[i][2] + r0[j][2]) / 2
        S.g(mat).face(q, None, (mx, 0.15, mz - cz))
    S.g(mat).face(r1, None, (0, 1, 0))
    return r0, r1

def spy_array(center, normal_xz, size=3.7):
    """octagonal SPY-1D face, a little proud of the wall"""
    cx, cy, cz = center
    nx, nz = normal_xz
    tx, tz = -nz, nx
    pts = []
    for k in range(8):
        a = math.pi / 8 + k * math.pi / 4
        u, v = math.cos(a) * size / 2, math.sin(a) * size / 2
        pts.append((cx + tx * u + nx * 0.12, cy + v, cz + tz * u + nz * 0.12))
    S.g('Array').face(pts, None, (nx, 0, nz))
    back = [(p[0] - nx * 0.12, p[1], p[2] - nz * 0.12) for p in pts]
    for k in range(8):
        j = (k + 1) % 8
        mid = ((pts[k][0] + pts[j][0]) / 2 - cx, (pts[k][1] + pts[j][1]) / 2 - cy, (pts[k][2] + pts[j][2]) / 2 - cz)
        S.g('Array').face([back[k], back[j], pts[j], pts[k]], None, mid)

# 01 level: one long deckhouse from the forward superstructure to the hangars
tilted_block(8.0, 7.6, 6.0, 11.6, -30.0, 62.0, chamfer_front=2.5)
# forward superstructure (02-03 levels) with the SPY faces on 45° corners
r0, r1 = tilted_block(7.4, 6.8, 11.6, 17.6, -27.0, 4.0, chamfer_front=4.2)
for sg in (1, -1):
    spy_array((sg * 5.0, 14.8, -25.2), (sg * 0.707, -0.707))
# bridge level with its windows and wings
tilted_block(6.8, 6.5, 17.6, 20.6, -24.0, -4.0, chamfer_front=1.4)
S.g('Glass').face([(-5.3, 18.6, -24.05), (5.3, 18.6, -24.05), (5.2, 20.1, -24.05), (-5.2, 20.1, -24.05)], None, (0, 0, -1))
for sg in (1, -1):
    x = sg * 6.72
    S.g('Glass').face([(x, 18.6, -22.4), (x, 18.6, -16.0), (x, 20.1, -16.0), (x, 20.1, -22.4)], None, (sg, 0, 0))
    S.box('Super', min(sg * 6.6, sg * 9.4), max(sg * 6.6, sg * 9.4), 17.6, 17.85, -23.0, -17.0)
    S.beam('Dark', (sg * 9.4, 18.9, -23.0), (sg * 9.4, 18.9, -17.0), 0.05)
for k in range(1, 8):
    x = -5.3 + k * 10.6 / 8
    S.box('Super', x - 0.06, x + 0.06, 18.6, 20.1, -24.12, -24.02)
tilted_block(4.2, 3.9, 20.6, 22.4, -20.0, -8.0)
# navigation lights on the bridge wings and the mast
S.box('NavRed', -9.55, -9.2, 17.85, 18.2, -21.0, -20.5)
S.box('NavGreen', 9.2, 9.55, 17.85, 18.2, -21.0, -20.5)
S.box('NavWhite', -0.18, 0.18, 38.6, 38.95, -9.95, -9.6)

# ── mast: raked tripod with yards, the SPS-67 surface radar ("radar") and a pole top ──
MT = (0.0, 36.0, -9.5)
for leg in ((0.0, 22.4, -18.5), (-3.2, 22.4, -9.0), (3.2, 22.4, -9.0)):
    S.beam('Super', leg, MT, 0.45)
S.box('Super', -2.4, 2.4, 29.6, 29.9, -15.2, -11.6)
S.beam('Super', (-6.0, 32.5, -10.5), (6.0, 32.5, -10.5), 0.28)
S.beam('Super', (-3.5, 35.0, -9.8), (3.5, 35.0, -9.8), 0.2)
S.cyl('Super', (0, 0, -9.5), 0.22, 0.12, 36.0, 43.0, 6)
S.cyl('White', (0, 0, -9.5), 0.55, 0.55, 40.5, 41.7, 10)
S.cyl('Dark', (0, 0, -9.5), 0.04, 0.03, 43.0, 46.0, 4)
for sx in (-1, 1):
    S.sphere('White', (sx * 1.6, 30.5, -13.0), 0.5, 0.5, 0.5, 10, 6)
    S.beam('Dark', (sx * 5.6, 32.5, -10.5), (sx * 5.6, 30.4, -10.5), 0.05)

# ── funnels (raked, tapered, three exhausts each) ──
def funnel(z0, z1):
    rake = 1.2
    base = [(-3.4, 11.6, z0), (3.4, 11.6, z0), (3.4, 11.6, z1), (-3.4, 11.6, z1)]
    topy = 20.2
    topq = [(-2.7, topy, z0 + 1.4 + rake), (2.7, topy, z0 + 1.4 + rake), (2.7, topy, z1 - 0.4 + rake), (-2.7, topy, z1 - 0.4 + rake)]
    cz = (z0 + z1) / 2
    for i in range(4):
        j = (i + 1) % 4
        q = [base[i], base[j], topq[j], topq[i]]
        mx = (base[i][0] + base[j][0]) / 2; mz = (base[i][2] + base[j][2]) / 2
        S.g('Super').face(q, None, (mx, 0.2, mz - cz))
    S.g('Dark').face(topq, None, (0, 1, 0))
    for k in range(3):
        zz = z0 + 2.2 + rake + k * (z1 - z0 - 2.6) / 3
        S.cyl('Dark', (0, 0, zz), 0.75, 0.75, topy - 0.2, topy + 1.0, 10)
    S.box('Super', -2.9, 2.9, topy - 0.3, topy, z0 + 1.2 + rake, z1 - 0.2 + rake)
funnel(5.5, 15.0)
funnel(30.5, 39.5)
# CIWS pedestal between the funnels (the turret sits on it at y 16)
S.box('Super', -2.4, 2.4, 11.6, 16.0, 23.0, 29.0)
S.beam('Dark', (-2.4, 17.0, 23.0), (2.4, 17.0, 23.0), 0.05)
# boats on davits either side, between the funnels
for sg in (1, -1):
    S.sphere('White', (sg * 6.2, 12.6, 19.5), 1.2, 0.8, 4.0, 12, 6, v0=0.0, v1=0.55)
    S.box('Dark', min(sg * 5.4, sg * 7.0), max(sg * 5.4, sg * 7.0), 12.8, 13.0, 17.0, 22.0)
    for zz in (16.5, 22.5):
        S.beam('Super', (sg * 5.0, 11.6, zz), (sg * 6.4, 15.0, zz), 0.25)
    # life-raft canisters along the 01 deck edge
    for k in range(5):
        S.cyl('White', (sg * 7.3, 12.1, 42.0 + k * 1.6), 0.35, 0.35, 11.6, 12.5, 8, axis='y')
# aft VLS block (64 cells) on the 01 deck behind the second funnel
S.box('Dark', -2.8, 2.8, 11.6, 11.8, 40.6, 45.6)
for k in range(1, 4):
    S.box('Super', -2.8, 2.8, 11.8, 11.85, 40.6 + k * 1.25 - 0.05, 40.6 + k * 1.25 + 0.05)
# hangars (Flight IIA) with the aft SPY faces, hangar doors aft
tilted_block(7.8, 7.2, 11.6, 14.4, 46.0, 62.0, chamfer_back=0.0)
tilted_block(5.8, 5.4, 14.4, 19.2, 46.0, 53.5, chamfer_back=3.0)
for sg in (1, -1):
    spy_array((sg * 4.4, 17.0, 52.3), (sg * 0.707, 0.707))
    S.g('Dark').face([(sg * 0.8, deck_y(62) + 0.1, 62.05), (sg * 6.6, deck_y(62) + 0.1, 62.05), (sg * 6.6, 13.0, 62.05), (sg * 0.8, 13.0, 62.05)], None, (0, 0, 1))
S.cyl('Super', (0, 0, 49.5), 0.2, 0.12, 19.2, 26.0, 6)
S.beam('Super', (-2.5, 24.0, 49.5), (2.5, 24.0, 49.5), 0.15)
# breakwater ahead of the forward VLS
for sg in (1, -1):
    S.beam('Super', (0.0, deck_y(-51) + 0.6, -52.8), (sg * 5.0, deck_y(-49) + 0.6, -48.5), 1.2, 0.18)
# hull number on the bow (white with dark shadow)
if FONT:
    for sg in (1, -1):
        zc = -58.0
        x = hull_x_at(zc, 6.4)
        ex = (0, 0, -1) if sg > 0 else (0, 0, 1)
        add_text(S, 'White', '51', 3.2, FONT, (sg * (x + 0.08), 6.4, zc), ex, (0, 1, 0), (sg, 0, 0), 0.03)
        add_text(S, 'Dark', '51', 3.2, FONT, (sg * (x + 0.05), 6.25, zc + ex[2] * 0.15), ex, (0, 1, 0), (sg, 0, 0), 0.03)

# ═════════════ Underwater: shafts, struts, propellers, rudders ═════════════
for sx in (-4.6, 4.6):
    S.beam('Hull', (sx * 0.7, -4.4, 38.0), (sx, -4.6, 61.0), 0.5)
    S.beam('Hull', (sx, -4.6, 57.0), (sx * 0.9, -1.8, 56.0), 0.35, 0.8)
    S.cyl('Dark', (sx, -4.6, 0), 0.45, 0.2, 61.0, 62.4, 8, axis='z')
    for b in range(5):
        a = 2 * math.pi * b / 5
        S.beam('Dark', (sx, -4.6, 61.7), (sx + 2.5 * math.cos(a), -4.6 + 2.5 * math.sin(a), 61.9), 0.8, 0.1)
    S.box('Hull', sx - 0.3, sx + 0.3, -5.6, -1.4, 65.0, 69.5, uvf=hull_uv)

root = bpy.data.objects.new('destroyer', None)
bpy.context.collection.objects.link(root)
S.build(parent=root)

# ═════════════ Rotating radar: SPS-67 on the mast platform ═════════════
R = Part('radar')
piv = (0.0, 29.9, -13.4)
R.cyl('Super', (piv[0], 0, piv[2]), 0.25, 0.25, piv[1], piv[1] + 0.5, 8)
R.box('Dark', -1.9, 1.9, piv[1] + 0.5, piv[1] + 1.0, piv[2] - 0.35, piv[2] + 0.15)
R.box('Super', -0.3, 0.3, piv[1] + 0.3, piv[1] + 0.55, piv[2] - 0.2, piv[2] + 0.3)
R.build(origin=piv, parent=root)

# ═════════════ Mounts ═════════════
mounts = []
def gun(part, o):
    x, y, z = o
    # faceted Mk 45 Mod 4 shield: narrower, lower front
    pts0 = [(-1.7, y, z - 2.2), (1.7, y, z - 2.2), (2.2, y, z + 0.6), (1.9, y, z + 2.8), (-1.9, y, z + 2.8), (-2.2, y, z + 0.6)]
    pts1 = [(-1.0, y + 2.1, z - 1.2), (1.0, y + 2.1, z - 1.2), (1.5, y + 2.2, z + 0.6), (1.4, y + 2.2, z + 2.4), (-1.4, y + 2.2, z + 2.4), (-1.5, y + 2.2, z + 0.6)]
    n = len(pts0)
    for i in range(n):
        j = (i + 1) % n
        q = [pts0[i], pts0[j], pts1[j], pts1[i]]
        mx = (pts0[i][0] + pts0[j][0]) / 2; mz = (pts0[i][2] + pts0[j][2]) / 2
        part.g('Super').face(q, None, (mx - x, 0.2, mz - z - 0.3))
    part.g('Super').face(pts1, None, (0, 1, 0))
    part.cyl('Super', (x, 0, z + 0.4), 2.3, 2.3, y - 0.3, y, 16)
    part.cyl('Super', (x, y + 1.0, 0), 0.24, 0.17, z - 8.4, z - 1.0, 10, axis='z')
    part.cyl('Dark', (x, y + 1.0, 0), 0.28, 0.28, z - 1.8, z - 1.2, 10, axis='z')
    part.cyl('Dark', (x, y + 1.0, 0), 0.19, 0.19, z - 8.6, z - 8.35, 10, axis='z')

def vls(part, o, rows=4, cols=8):
    x, y, z = o
    w, d = 2.4 * cols / 4, 1.25 * rows
    part.box('Dark', x - w / 2, x + w / 2, y, y + 0.2, z - d / 2, z + d / 2)
    for r in range(rows):
        for c in range(cols):
            cx = x - w / 2 + (c + 0.5) * w / cols
            cz = z - d / 2 + (r + 0.5) * d / rows
            part.box('Super', cx - 0.26, cx + 0.26, y + 0.2, y + 0.26, cz - 0.5, cz + 0.5)

layout_mounts = []
for typ, (x, z), build in (('gun', (0.0, -58.0), 'gun'), ('sam', (0.0, -44.0), 'vls'), ('ciws', (0.0, 26.0), 'ciws')):
    y = 16.0 if typ == 'ciws' else deck_y(z) + 0.18
    P_ = Part('mount_%s_0' % typ)
    o = (x, y, z)
    if build == 'gun':
        gun(P_, o)
    elif build == 'vls':
        vls(P_, o)
    else:
        ciws(P_, o)
    P_.build(origin=o, parent=root)
    layout_mounts.append({'type': typ, 'x': x, 'y': round(y, 2), 'z': z, 'node': P_.name})

layout = {
    'version': 1, 'deckY': 8.0, 'shadowY': 11.0, 'L': L, 'draft': -KEEL,
    'deck': [[x, z] for x, z in deck_outline],
    'waterline': [[x, z] for x, z in waterline],
    'mounts': layout_mounts,
}
root['skywar'] = json.dumps(layout, separators=(',', ':'))
print('destroyer tris ~', S.tris(), ' radar', R.tris())
os.makedirs(os.path.dirname(os.path.abspath(OUT)), exist_ok=True)
bpy.ops.export_scene.gltf(filepath=OUT, export_format='GLB', export_extras=True, export_yup=True,
                          export_materials='EXPORT', export_image_format='AUTO', export_cameras=False, export_lights=False)
print('exported', OUT, os.path.getsize(OUT) // 1024, 'KB')
