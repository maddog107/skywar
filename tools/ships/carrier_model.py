# ═══════════════════════════════════════════════════════════════
# Nimitz-class aircraft carrier — scripted model for Blender (run headless):
#   python3 tools/ships/ship_textures.py /tmp/shiptex
#   blender -b -P tools/ships/carrier_model.py -- /tmp/shiptex models/ships/carrier.glb
# (tools/ships/build.sh does both.) Layout constants: carrier_layout.py — they are the
# gameplay coordinates of naval.js (deck at y = 19, cat spot, landing lane, island, mounts).
# Origin = hull centre on the waterline; three.js frame after export: x starboard, y up, bow −z.
# Hull: flared bow with bulb, parallel mid-body, wide transom; 11 m draft with red anti-fouling
# under a black boot-top (hull texture). Flight deck markings: deck texture.
# Separate nodes for naval.js: "radar" / "radar2" (rotating), "mount_<type>_<n>" (turrets).
# Root node extras.skywar = JSON layout (deck outline, waterline, wires, …) for the game.
# ═══════════════════════════════════════════════════════════════
import bpy, math, sys, os, json
sys.dont_write_bytecode = True
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import carrier_layout as C
from shipkit import (Part, material, srgb, smoothstep, lerp, clamp, add_text, MATS, ciws, launcher)

args = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
TEX = args[0] if len(args) > 0 else '/tmp/shiptex'
OUT = args[1] if len(args) > 1 else 'carrier.glb'
FONT = next((p for p in ('/System/Library/Fonts/Supplemental/Arial Black.ttf',
                         '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf') if os.path.exists(p)), None)

bpy.ops.wm.read_factory_settings(use_empty=True)

material('Deck', srgb(0xffffff), 0.0, 0.88, image=os.path.join(TEX, 'carrier_deck.jpg'))
material('Hull', srgb(0xffffff), 0.04, 0.68, image=os.path.join(TEX, 'carrier_hull.jpg'))
material('Super', srgb(0x899096), 0.04, 0.62)
material('Dark', srgb(0x2c2f32), 0.2, 0.7)
material('White', srgb(0xdadddd), 0.05, 0.45)
material('Glass', srgb(0x1a2631), 0.5, 0.12)
material('Yellow', srgb(0xc9a227), 0.1, 0.6)
material('Lamp', srgb(0xffa040), 0.0, 0.5, emit=srgb(0xffa040), emit_strength=6.0)
material('Datum', srgb(0x50ff80), 0.0, 0.5, emit=srgb(0x50ff80), emit_strength=4.0)

def deck_uv(x, y, z):
    return ((x - C.TEX_X0) / (C.TEX_X1 - C.TEX_X0), (C.TEX_Z1 - z) / (C.TEX_Z1 - C.TEX_Z0))

def hull_uv(x, y, z):
    return ((z + 160.0) / 320.0, (y + 12.0) / 32.0)

S = Part('carrier_static')
DY = C.DECK_Y

# ═════════════ Hull ═════════════
LEVELS = [-11.0, -10.6, -9.9, -8.9, -7.5, -5.5, -3.0, C.BOOT_LO, 0.0, C.BOOT_HI, 4.0, 7.0, 10.0, 12.8, C.GALLERY_Y]
NS = 96

def bsec(y):
    R = 3.4
    cx, cy = C.BEAM_WL - R, -C.DRAFT + R
    if y < cy:
        dy = cy - y
        return cx + math.sqrt(max(R * R - dy * dy, 0.0))
    if y <= 0:
        return C.BEAM_WL
    return C.BEAM_WL + 0.8 * min(y / C.GALLERY_Y, 1.0)

def stem_z(y):
    t = (y + C.DRAFT) / (C.GALLERY_Y + C.DRAFT)
    return -148.0 - 7.0 * t ** 1.4

def stern_z(y):
    return 152.0 if y >= -1.0 else 152.0 - 28.0 * ((-1.0 - y) / 10.0) ** 1.3

def deck_half(z):
    return min(-C.edge_at(C.PORT_EDGE, z), C.edge_at(C.STBD_EDGE, z))

def hb(s, y, z):
    t = (y + C.DRAFT) / (C.GALLERY_Y + C.DRAFT)
    se = 0.40 - 0.15 * t
    k = 1.6 + 1.9 * t ** 0.9
    u = min(s / se, 1.0)
    fore = 1 - (1 - u) ** k
    sa = lerp(0.30, 0.14, smoothstep(-2.0, 2.0, y))
    tf = lerp(0.04, 0.8, smoothstep(-4.0, 1.5, y))
    w = smoothstep(1 - sa, 1.0, s) ** 1.2
    aft = 1 - (1 - tf) * w
    return min(bsec(y) * fore * aft, deck_half(z) - 0.3)

grid = []
for y in LEVELS:
    z0, z1 = stem_z(y), stern_z(y)
    row = []
    for i in range(NS):
        s = 0.5 - 0.5 * math.cos(math.pi * i / (NS - 1))
        z = z0 + s * (z1 - z0)
        row.append((hb(s, y, z), y, z))
    grid.append(row)

g = S.g('Hull')
for k in range(len(LEVELS) - 1):
    for i in range(NS - 1):
        a, b, c, d = grid[k][i], grid[k][i + 1], grid[k + 1][i + 1], grid[k + 1][i]
        for sg in (1, -1):
            q = [(sg * p[0], p[1], p[2]) for p in (a, b, c, d)]
            g.face(q, [hull_uv(*p) for p in q], (sg, 0, 0), True)
    # transom
    a, d = grid[k][-1], grid[k + 1][-1]
    q = [(-a[0], a[1], a[2]), (a[0], a[1], a[2]), (d[0], d[1], d[2]), (-d[0], d[1], d[2])]
    g.face(q, [hull_uv(*p) for p in q], (0, 0, 1), True)
# flat bottom
for i in range(NS - 1):
    a, b = grid[0][i], grid[0][i + 1]
    q = [(-a[0], a[1], a[2]), (a[0], a[1], a[2]), (b[0], b[1], b[2]), (-b[0], b[1], b[2])]
    g.face(q, [hull_uv(*p) for p in q], (0, -1, 0), True)
# bulbous bow
S.sphere('Hull', (0.0, -6.6, -147.0), 2.7, 3.1, 7.8, nu=14, nv=8, uvf=hull_uv)

# waterline outline for the game's foam line (starboard bow → stern, port stern → bow)
k0 = LEVELS.index(0.0)
wl = [(round(p[0], 2), round(p[2], 2)) for p in grid[k0][::3]] + [(round(grid[k0][-1][0], 2), round(grid[k0][-1][2], 2))]
waterline = wl + [(-x, z) for x, z in reversed(wl)]

# ═════════════ Flight deck, elevators, sponsons ═════════════
zs = sorted(set([p[0] for p in C.STBD_EDGE] + [p[0] for p in C.PORT_EDGE]))
deck_poly = [(C.edge_at(C.STBD_EDGE, z), z) for z in zs] + [(C.edge_at(C.PORT_EDGE, z), z) for z in reversed(zs)]
# drop duplicate consecutive points
dp = []
for p in deck_poly:
    if not dp or abs(dp[-1][0] - p[0]) > 1e-3 or abs(dp[-1][1] - p[1]) > 1e-3:
        dp.append(p)
deck_poly = dp
S.prism(deck_poly, C.GALLERY_Y, DY, 'Deck', 'Hull', 'Super', uv_top=deck_uv, uv_side=hull_uv)

elev_polys = []
for (x0, x1, z0, z1) in C.ELEVATORS:
    if x0 < 0:   # port elevator: inboard edge follows the deck edge
        poly = [(x0, z0), (C.edge_at(C.PORT_EDGE, z0), z0), (C.edge_at(C.PORT_EDGE, z1), z1), (x0, z1)]
    else:
        poly = [(x0, z0), (x1, z0), (x1, z1), (x0, z1)]
    elev_polys.append(poly)
    S.prism(poly, DY - 0.75, DY, 'Deck', 'Super', 'Dark', uv_top=deck_uv)
    # hangar-bay opening in the hull side behind the elevator
    side = 1 if x0 > 0 else -1
    hx = side * 21.06
    q = [(hx, C.HANGAR_Y, z0 + 1.2), (hx, C.HANGAR_Y, z1 - 1.2), (hx, DY - 0.8, z1 - 1.2), (hx, DY - 0.8, z0 + 1.2)]
    S.g('Dark').face(q, None, (side, 0, 0))
    # elevator guide rails
    for zz in (z0 + 1.0, z1 - 1.0):
        S.box('Super', hx - 0.35 if side > 0 else hx - 0.05, hx + 0.05 if side > 0 else hx + 0.35, C.HANGAR_Y - 0.5, DY - 0.75, zz - 0.3, zz + 0.3)

x0, x1, z0, z1 = C.ISLAND_SPONSON
S.prism([(x0, z0), (x1, z0), (x1, z1), (x0, z1)], C.GALLERY_Y, DY, 'Deck', 'Hull', 'Super', uv_top=deck_uv, uv_side=hull_uv)
S.box('Super', x0, x1 - 0.5, 12.6, C.GALLERY_Y, z0 + 2, z1 - 2)

# fantail opening in the transom, forecastle opening under the bow overhang
S.g('Dark').face([(-9, C.HANGAR_Y, 152.06), (9, C.HANGAR_Y, 152.06), (9, 15.3, 152.06), (-9, 15.3, 152.06)], None, (0, 0, 1))
S.g('Dark').face([(-6, 16.0, -160.04), (6, 16.0, -160.04), (6, 18.0, -160.04), (-6, 18.0, -160.04)], None, (0, 0, -1))

# the angled-deck overhang: an enclosed sponson under the deck edge with knee braces to the hull
for zz in range(-60, 152, 6):
    za, zb = zz, zz + 6
    ea, eb = C.edge_at(C.PORT_EDGE, za) + 3.0, C.edge_at(C.PORT_EDGE, zb) + 3.0
    if ea > -22.0 and eb > -22.0:
        continue
    ea, eb = min(ea, -21.0), min(eb, -21.0)
    # sloped underside from the hull side (y 11.5) out to the sponson's outer wall (y 13.2)
    pts = [(-20.8, 11.4, za), (ea, 13.2, za), (eb, 13.2, zb), (-20.8, 11.4, zb)]
    S.g('Super').face(pts, None, (0, -1, 0))
    S.g('Super').face([(ea, 13.2, za), (ea, C.GALLERY_Y, za), (eb, C.GALLERY_Y, zb), (eb, 13.2, zb)], None, (-1, 0, 0))
for zz in range(-40, 152, 12):
    e = C.edge_at(C.PORT_EDGE, zz)
    if e < -24:
        S.beam('Super', (-20.6, 7.0, zz), (e + 3.5, 13.3, zz), 0.7)
# bow flare knees under the forward deck edges
for zz in range(-150, -70, 10):
    for sg, edge in ((1, C.STBD_EDGE), (-1, C.PORT_EDGE)):
        e = C.edge_at(edge, zz)
        S.beam('Super', (sg * 17.0, 9.0, zz), (e - sg * 1.2, C.GALLERY_Y - 0.1, zz), 0.5)

# ── catwalks along the deck edges (shelf + outer rail), skipping elevators and sponsons ──
def catwalk(edge, side, z0, z1, step=4.0):
    n = max(1, int((z1 - z0) / step))
    for i in range(n):
        za, zb = z0 + (z1 - z0) * i / n, z0 + (z1 - z0) * (i + 1) / n
        ea, eb = C.edge_at(edge, za), C.edge_at(edge, zb)
        oa, ob = ea + side * 1.5, eb + side * 1.5
        y0, y1 = DY - 1.25, DY - 1.05
        S.g('Dark').face([(ea, y1, za), (oa, y1, za), (ob, y1, zb), (eb, y1, zb)], None, (0, 1, 0))
        S.g('Dark').face([(ea, y0, za), (oa, y0, za), (ob, y0, zb), (eb, y0, zb)], None, (0, -1, 0))
        q = [(oa, y0, za), (ob, y0, zb), (ob, y1 + 0.95, zb), (oa, y1 + 0.95, za)]
        S.g('Dark').face(q, None, (side, 0, 0))
        S.g('Dark').face(q, None, (-side, 0, 0))
for (z0, z1) in ((-146, -102), (-76, -68), (-42, 4), (52, 56), (82, 148)):
    catwalk(C.STBD_EDGE, 1, z0, z1)
for (z0, z1) in ((-146, -76), (-42, 66), (94, 148)):
    catwalk(C.PORT_EDGE, -1, z0, z1)

# ── weapon sponsons ──
mount_info = []
for i, (typ, mx, mz) in enumerate(C.MOUNTS):
    side = 1 if mx > 0 else -1
    edge = C.edge_at(C.STBD_EDGE if side > 0 else C.PORT_EDGE, mz)
    inner = edge - side * 1.0
    outer = mx + side * 3.6
    xa, xb = sorted((inner, outer))
    S.box('Super', xa, xb, C.GALLERY_Y - 0.7, C.GALLERY_Y, mz - 4.2, mz + 4.2)
    # tapered support under it
    xin = inner
    S.g('Super').face([(xin, C.GALLERY_Y - 0.7, mz - 4.2), (outer, C.GALLERY_Y - 0.7, mz - 4.2), (xin, C.GALLERY_Y - 5.5, mz - 2.0)], None, (0, 0, -1))
    S.g('Super').face([(xin, C.GALLERY_Y - 0.7, mz + 4.2), (outer, C.GALLERY_Y - 0.7, mz + 4.2), (xin, C.GALLERY_Y - 5.5, mz + 2.0)], None, (0, 0, 1))
    S.g('Super').face([(outer, C.GALLERY_Y - 0.7, mz - 4.2), (outer, C.GALLERY_Y - 0.7, mz + 4.2), (xin, C.GALLERY_Y - 5.5, mz + 2.0), (xin, C.GALLERY_Y - 5.5, mz - 2.0)], None, (side, -1, 0))
    # railing round the platform
    for (pa, pb) in (((outer, mz - 4.2), (outer, mz + 4.2)), ((inner, mz - 4.2), (outer, mz - 4.2)), ((inner, mz + 4.2), (outer, mz + 4.2))):
        S.beam('Dark', (pa[0], C.GALLERY_Y + 1.0, pa[1]), (pb[0], C.GALLERY_Y + 1.0, pb[1]), 0.07)
    mount_info.append({'type': typ, 'x': mx, 'y': C.GALLERY_Y, 'z': mz})

# ═════════════ Island ═════════════
def glass_band(face, a0, a1, y0, y1, pos):
    """window band on an island wall: face 'x' (a = z range) or 'z' (a = x range) at coordinate pos"""
    if face == 'x':
        sg = 1 if pos > 19 else -1
        q = [(pos, y0, a0), (pos, y0, a1), (pos, y1, a1), (pos, y1, a0)]
        S.g('Glass').face(q, None, (sg, 0, 0))
    else:
        sg = 1 if pos > 26 else -1
        q = [(a0, y0, pos), (a1, y0, pos), (a1, y1, pos), (a0, y1, pos)]
        S.g('Glass').face(q, None, (0, 0, sg))

ix0, ix1, iz0, iz1 = C.ISLAND
S.box('Super', ix0, ix1, DY, 27.4, iz0, iz1)                 # O-3..O-5
S.box('Super', 13.3, 24.7, 27.4, 31.0, 10.6, 44.0)           # flag bridge level
S.box('Super', 12.8, 25.2, 31.0, 34.4, 11.2, 41.0)           # navigation bridge level
S.box('Super', 13.6, 24.4, 34.4, 37.8, 13.5, 40.0)
S.box('Super', 12.2, 19.5, 34.4, 38.4, 32.0, 43.0)           # primary flight control, overlooking the deck
S.box('Super', 14.6, 23.4, 37.8, 40.2, 15.5, 36.0)
# bridge wings
S.box('Super', 11.2, 12.8, 31.0, 31.35, 11.4, 17.0)
S.box('Super', 25.2, 26.8, 31.0, 31.35, 11.4, 17.0)
# windows
glass_band('z', 13.6, 24.4, 32.0, 33.9, 11.17)
glass_band('x', 11.8, 24.0, 32.0, 33.9, 12.77)
glass_band('x', 11.8, 24.0, 32.0, 33.9, 25.23)
glass_band('z', 14.2, 23.8, 28.3, 30.2, 10.57)
glass_band('x', 11.2, 18.0, 28.3, 30.2, 13.27)
glass_band('x', 11.2, 18.0, 28.3, 30.2, 24.73)
glass_band('x', 32.6, 42.4, 35.3, 37.6, 12.17)
glass_band('z', 12.8, 19.0, 35.3, 37.6, 43.03)
glass_band('z', 12.8, 18.8, 35.3, 37.6, 31.97)
# small windows / doors on the base
for zz in (18.0, 33.0):
    S.g('Dark').face([(12.97, DY, zz - 0.55), (12.97, DY, zz + 0.55), (12.97, DY + 2.1, zz + 0.55), (12.97, DY + 2.1, zz - 0.55)], None, (-1, 0, 0))
for zz in (14.0, 40.0):
    S.g('Dark').face([(25.03, DY, zz - 0.55), (25.03, DY, zz + 0.55), (25.03, DY + 2.1, zz + 0.55), (25.03, DY + 2.1, zz - 0.55)], None, (1, 0, 0))
S.g('Dark').face([(15, DY, 9.97), (17, DY, 9.97), (17, DY + 2.3, 9.97), (15, DY + 2.3, 9.97)], None, (0, 0, -1))
for yy in (21.8, 24.6):
    for zz in range(14, 44, 5):
        S.g('Glass').face([(25.03, yy, zz), (25.03, yy, zz + 1.2), (25.03, yy + 0.8, zz + 1.2), (25.03, yy + 0.8, zz)], None, (1, 0, 0))
        S.g('Glass').face([(12.97, yy, zz), (12.97, yy, zz + 1.2), (12.97, yy + 0.8, zz + 1.2), (12.97, yy + 0.8, zz)], None, (-1, 0, 0))
# parapets on the bridge roofs
for (xa, xb, za, zb, y) in ((12.8, 25.2, 11.2, 13.4, 34.4), (14.6, 23.4, 15.5, 17.0, 40.2)):
    S.box('Super', xa, xb, y, y + 1.0, za, za + 0.12)
    S.box('Super', xa, xa + 0.12, y, y + 1.0, za, zb)
    S.box('Super', xb - 0.12, xb, y, y + 1.0, za, zb)
# hull number on both sides of the island (white with a dark drop shadow)
if FONT:
    for sg, xface in ((1, 25.0), (-1, 13.0)):
        ex = (0, 0, -1) if sg > 0 else (0, 0, 1)
        ez = (sg, 0, 0)
        add_text(S, 'White', '73', 7.4, FONT, (xface + sg * 0.1, 23.2, 27.5), ex, (0, 1, 0), ez, 0.04)
        add_text(S, 'Dark', '73', 7.4, FONT, (xface + sg * 0.06, 23.2 - 0.3, 27.5 + ex[2] * 0.3), ex, (0, 1, 0), ez, 0.04)

# ── lattice mast ──
MX, MZ, MY0, MY1 = 19.0, 27.0, 40.2, 62.0
def leg_xz(y, sx, sz):
    t = (y - MY0) / (MY1 - MY0)
    r = lerp(2.0, 0.55, t)
    return MX + sx * r, MZ + sz * r
corners = [(1, 1), (-1, 1), (-1, -1), (1, -1)]
for sx, sz in corners:
    a = leg_xz(MY0, sx, sz); b = leg_xz(MY1, sx, sz)
    S.beam('Super', (a[0], MY0, a[1]), (b[0], MY1, b[1]), 0.3)
ys = [MY0 + 0.3 + i * (MY1 - MY0 - 0.3) / 6 for i in range(7)]
for j in range(len(ys)):
    for c in range(4):
        (sxa, sza), (sxb, szb) = corners[c], corners[(c + 1) % 4]
        pa, pb = leg_xz(ys[j], sxa, sza), leg_xz(ys[j], sxb, szb)
        S.beam('Super', (pa[0], ys[j], pa[1]), (pb[0], ys[j], pb[1]), 0.16)
        if j < len(ys) - 1:
            qb = leg_xz(ys[j + 1], sxb, szb)
            S.beam('Super', (pa[0], ys[j], pa[1]), (qb[0], ys[j + 1], qb[1]), 0.1)
for (y, r) in ((49.0, 2.2), (56.0, 1.8)):
    S.box('Super', MX - r, MX + r, y - 0.2, y, MZ - r, MZ + r)
    S.beam('Dark', (MX - r, y + 0.9, MZ - r), (MX + r, y + 0.9, MZ - r), 0.06)
    S.beam('Dark', (MX - r, y + 0.9, MZ + r), (MX + r, y + 0.9, MZ + r), 0.06)
S.beam('Super', (MX - 6.5, 53.0, MZ), (MX + 6.5, 53.0, MZ), 0.3)          # yardarm
for sx in (-1, 1):
    S.beam('Dark', (MX + sx * 6.0, 53.0, MZ), (MX + sx * 6.0, 50.6, MZ), 0.08)
S.cyl('Super', (MX, 0, MZ), 0.35, 0.35, MY1, MY1 + 0.6, 8)
S.cyl('White', (MX, 0, MZ), 0.95, 0.95, MY1 + 0.6, MY1 + 2.8, 14)          # TACAN
S.cyl('White', (MX, 0, MZ), 0.95, 0.2, MY1 + 2.8, MY1 + 3.4, 14)
S.cyl('Dark', (MX, 0, MZ), 0.06, 0.03, MY1 + 3.4, MY1 + 8.0, 5)
for sx in (-1, 1):
    S.sphere('White', (MX + sx * 1.6, 49.6, MZ + 1.6), 0.55, 0.55, 0.55, 10, 6)
# SATCOM radomes on pedestals
for (x, y, z, r) in ((15.8, 38.4, 40.6, 1.55), (22.2, 31.0, 42.6, 1.35)):
    S.cyl('Super', (x, 0, z), 0.5, 0.5, y, y + 0.8, 8)
    S.sphere('White', (x, y + 0.8 + r * 0.8, z), r, r, r, 16, 10)
# small whip antennas and a short signal yard on the island roof
for (x, z, h) in ((14.9, 34.8, 6.0), (23.1, 34.8, 6.0), (23.0, 16.0, 4.5)):
    S.cyl('Dark', (x, 0, z), 0.05, 0.03, 40.2, 40.2 + h, 5, cap0=False)
# radar pedestals
S.cyl('Super', (19.0, 0, 18.3), 0.9, 0.8, 40.2, 41.4, 12)
S.cyl('Super', (19.0, 0, 34.2), 0.8, 0.6, 40.2, 42.8, 12)

# ── island detail: window mullions, side walkways with rails, external ladders, aft signal platform ──
def mullions_z(x0, x1, y0, y1, zface, sg, step=1.3):
    n = int((x1 - x0) / step)
    for k in range(1, n):
        x = x0 + (x1 - x0) * k / n
        S.box('Super', x - 0.07, x + 0.07, y0, y1, zface - (0.06 if sg < 0 else 0), zface + (0.06 if sg > 0 else 0))
def mullions_x(z0, z1, y0, y1, xface, sg, step=1.3):
    n = int((z1 - z0) / step)
    for k in range(1, n):
        z = z0 + (z1 - z0) * k / n
        S.box('Super', xface - (0.06 if sg < 0 else 0), xface + (0.06 if sg > 0 else 0), y0, y1, z - 0.07, z + 0.07)
mullions_z(13.6, 24.4, 32.0, 33.9, 11.17, -1)
mullions_x(11.8, 24.0, 32.0, 33.9, 12.77, -1)
mullions_x(11.8, 24.0, 32.0, 33.9, 25.23, 1)
mullions_z(14.2, 23.8, 28.3, 30.2, 10.57, -1)
mullions_x(32.6, 42.4, 35.3, 37.6, 12.17, -1)
mullions_z(12.8, 19.0, 35.3, 37.6, 43.03, 1)
# a slim window-washing ledge / eyebrow over the bridge windows
S.box('Super', 13.0, 25.0, 34.0, 34.15, 10.6, 11.2)
S.box('Super', 12.9, 13.3, 27.25, 27.4, 10.2, 44.4)
# walkways round the O-5 level with railings
for (xa, xb, za, zb) in ((11.6, 13.0, 10.4, 44.0), (25.0, 26.4, 10.4, 44.0)):
    S.box('Super', xa, xb, 27.1, 27.35, za, zb)
    xr = xa if xa < 13 else xb
    S.beam('Dark', (xr, 28.35, za), (xr, 28.35, zb), 0.06)
    S.beam('Dark', (xr, 27.85, za), (xr, 27.85, zb), 0.04)
    for zz in range(int(za) + 1, int(zb), 3):
        S.beam('Dark', (xr, 27.35, zz), (xr, 28.35, zz), 0.05)
# external ladders on the aft face
for k in range(3):
    y0 = DY + 1.0 + k * 3.0
    S.beam('Dark', (15.5 + k * 2.2, y0, 46.4), (17.0 + k * 2.2, y0 + 3.0, 46.4), 0.5, 0.12)
# aft signal platform with a small yard and flag halyards
S.box('Super', 19.5, 24.4, 37.8, 38.05, 40.0, 43.5)
S.beam('Super', (22.0, 38.05, 43.3), (22.0, 43.5, 43.3), 0.22)
S.beam('Super', (19.8, 42.6, 43.3), (24.2, 42.6, 43.3), 0.12)
for k in range(4):
    S.beam('Dark', (20.0 + k * 1.3, 42.6, 43.3), (20.2 + k * 1.3, 38.1, 41.0), 0.03)
# SPN-series approach radars and ESM boxes on the island front roofs
S.box('White', 22.0, 24.0, 34.4, 35.6, 12.0, 13.4)
S.box('Super', 14.2, 16.0, 34.4, 35.4, 11.8, 13.2)
S.sphere('White', (15.1, 35.9, 12.5), 0.6, 0.6, 0.6, 10, 6)

# ── starboard refuelling-at-sea stations: sponsons with kingposts under the deck edge ──
for zz in (-24.0, 92.0):
    S.box('Super', 21.0, 24.2, 12.2, 12.8, zz - 5.0, zz + 5.0)
    S.beam('Super', (23.6, 12.8, zz), (23.6, DY - 1.4, zz), 0.45)
    S.beam('Super', (23.6, DY - 2.0, zz), (21.1, DY - 2.0, zz - 3.0), 0.25)
    S.beam('Dark', (24.2, 13.8, zz - 5.0), (24.2, 13.8, zz + 5.0), 0.06)
# boat bays / small sponsons along both sides
for (sg, zz) in ((1, -118.0), (1, 118.0), (-1, -96.0), (-1, 30.0), (-1, 122.0)):
    x = sg * 20.9
    S.box('Dark', min(x, x + sg * 0.12), max(x, x + sg * 0.12), 11.6, 14.4, zz - 4.0, zz + 4.0)
    S.box('Super', min(x, x + sg * 1.6), max(x, x + sg * 1.6), 11.2, 11.5, zz - 4.4, zz + 4.4)
# stern: vertical line of drop lights under the landing-area centreline, and the ship's name board
for k in range(6):
    y = DY - 1.3 - k * 0.9
    S.box('Lamp', C.LA_STERN_X - 0.18, C.LA_STERN_X + 0.18, y - 0.18, y + 0.18, 160.0, 160.1)
S.box('Dark', -7.0, 7.0, 16.2, 17.2, 159.98, 160.02)
S.beam('Super', (C.LA_STERN_X, 12.4, 159.8), (C.LA_STERN_X, C.GALLERY_Y, 159.8), 0.3)

# ═════════════ Deck gear ═════════════
# raised jet blast deflector behind cat 1 (three hinged panels leaning aft)
cx, zh, wd, _ = C.JBDS[0]
ang = math.radians(52)
for k in range(3):
    xa = cx - wd / 2 + k * wd / 3 + 0.1
    xb = xa + wd / 3 - 0.2
    Lp = 4.2
    y1, z1 = DY + Lp * math.sin(ang), zh + Lp * math.cos(ang)
    t = 0.28
    ny, nz = math.cos(ang) * t, -math.sin(ang) * t
    front = [(xa, DY, zh), (xb, DY, zh), (xb, y1, z1), (xa, y1, z1)]
    back = [(p[0], p[1] - ny, p[2] - nz) for p in front]
    S.g('Super').face(front, None, (0, math.cos(ang), -math.sin(ang)))
    S.g('Super').face(back, None, (0, -math.cos(ang), math.sin(ang)))
    S.g('Super').face([front[2], front[3], back[3], back[2]], None, (0, 1, 0))
    S.g('Super').face([front[0], back[0], back[3], front[3]], None, (-1, 0, 0))
    S.g('Super').face([front[1], front[2], back[2], back[1]], None, (1, 0, 0))
    for xs in (xa + 0.8, xb - 0.8):
        S.beam('Dark', (xs, DY + 0.1, zh + 3.6), (xs, DY + Lp * 0.5 * math.sin(ang) - 0.2, zh + Lp * 0.5 * math.cos(ang) + 0.2), 0.18)
# arresting wires (raised on their bow-spring supports) and deck sheaves
for i in range(len(C.WIRES_Z)):
    (ax, az), (bx, bz) = C.wire_ends(i)
    S.beam('Dark', (ax, DY + 0.1, az), (bx, DY + 0.1, bz), 0.07)
    for (ex, ez) in ((ax, az), (bx, bz)):
        S.box('Dark', ex - 0.4, ex + 0.4, DY, DY + 0.18, ez - 0.4, ez + 0.4)
# Fresnel lens (IFLOLS) on the port deck edge abeam the wires, facing aft
lx, lz = C.LENS
S.box('Super', lx - 2.2, lx + 0.4, DY - 0.9, DY - 0.1, lz - 1.6, lz + 1.6)
S.box('Super', lx - 1.5, lx - 0.1, DY - 0.1, DY + 3.6, lz - 0.5, lz + 0.5)
S.box('Dark', lx - 1.3, lx - 0.3, DY + 1.2, DY + 3.3, lz + 0.5, lz + 0.56)
S.box('Lamp', lx - 1.0, lx - 0.6, DY + 2.05, DY + 2.45, lz + 0.56, lz + 0.62)
for dx in (-3.2, -2.4, 1.2, 2.0):
    S.box('Datum', lx - 0.8 + dx * 0.5 - 0.15, lx - 0.8 + dx * 0.5 + 0.15, DY + 2.15, DY + 2.35, lz + 0.56, lz + 0.62)
S.box('Super', lx - 3.6, lx + 1.9, DY + 2.1, DY + 2.4, lz + 0.1, lz + 0.5)
# LSO platform with its windscreen
ox, oz = C.LSO
S.box('Super', ox - 4.0, ox + 0.6, DY - 0.8, DY - 0.1, oz - 3.0, oz + 3.0)
S.box('Glass', ox - 3.8, ox + 0.4, DY - 0.1, DY + 1.4, oz - 3.05, oz - 2.95)
# yellow deck tractors and the crash crane ("Tilly") beside the island
for (x, z, yaw) in ((23.3, 47.6, 0.0), (8.6, 47.0, 0.4)):
    S.box('Yellow', x - 0.8, x + 0.8, DY, DY + 1.0, z - 1.6, z + 1.6)
    S.box('Dark', x - 0.7, x + 0.7, DY + 1.0, DY + 1.3, z + 0.2, z + 1.4)
S.box('Yellow', 21.6, 24.8, DY, DY + 2.4, 6.4, 9.6)
S.box('Glass', 21.9, 24.5, DY + 2.4, DY + 3.6, 8.2, 9.4)
S.beam('Yellow', (23.2, DY + 2.2, 6.8), (23.2, DY + 7.5, -1.0), 0.5)
S.beam('Dark', (23.2, DY + 7.5, -1.0), (23.2, DY + 4.5, -1.2), 0.05)

# ═════════════ Underwater gear: shafts, propellers, rudders ═════════════
for sx in (-13.0, -5.0, 5.0, 13.0):
    S.beam('Hull', (sx, -6.8, 110.0), (sx, -7.2, 133.0), 0.8)
    S.cyl('Dark', (sx, -7.2, 0), 0.5, 0.2, 133.0, 134.6, 8, axis='z')
    for b in range(5):
        a = 2 * math.pi * b / 5
        tip = (sx + 3.0 * math.cos(a), -7.2 + 3.0 * math.sin(a), 133.6)
        S.beam('Dark', (sx, -7.2, 133.6), tip, 0.9, 0.12)
for sx in (-6.0, 6.0):
    S.box('Hull', sx - 0.4, sx + 0.4, -9.0, -1.2, 137.0, 144.0, uvf=hull_uv)

root = bpy.data.objects.new('carrier', None)
bpy.context.collection.objects.link(root)
static = S.build(parent=root)

# ═════════════ Rotating radars ═════════════
# SPS-49-style air-search dish on the aft pedestal: node "radar" (pivot on its axis)
R = Part('radar')
piv = (19.0, 42.8, 34.2)
R.cyl('Super', (piv[0], 0, piv[2]), 0.45, 0.45, piv[1], piv[1] + 0.6, 8)
W, H, depth = 7.3, 4.2, 0.9
nu, nv = 10, 5
def dish(u, v):
    x = (u - 0.5) * W
    y = (v - 0.5) * H
    z = -depth * ((2 * (u - 0.5)) ** 2 * 0.8 + (2 * (v - 0.5)) ** 2 * 0.3)
    return (piv[0] + x, piv[1] + 2.9 + y, piv[2] - 0.6 + z)
for j in range(nv):
    for i in range(nu):
        q = [dish(i / nu, j / nv), dish((i + 1) / nu, j / nv), dish((i + 1) / nu, (j + 1) / nv), dish(i / nu, (j + 1) / nv)]
        R.g('Dark').face(q, None, (0, 0, -1))
        R.g('Dark').face(q, None, (0, 0, 1))
R.beam('Super', (piv[0], piv[1] + 0.6, piv[2]), (piv[0], piv[1] + 2.9, piv[2] - 0.9), 0.3)
R.beam('Super', (piv[0], piv[1] + 2.9, piv[2] - 0.9), (piv[0], piv[1] + 2.9, piv[2] - 3.4), 0.18)
R.box('Super', piv[0] - 0.3, piv[0] + 0.3, piv[1] + 2.6, piv[1] + 3.2, piv[2] - 3.8, piv[2] - 3.3)
radar = R.build(origin=piv, parent=root)

# SPS-48-style planar array forward: node "radar2"
R2 = Part('radar2')
piv2 = (19.0, 41.4, 18.3)
R2.cyl('Super', (piv2[0], 0, piv2[2]), 0.55, 0.55, piv2[1], piv2[1] + 0.9, 10)
tilt = math.radians(18)
def arr(u, v, off=0.0):
    x = (u - 0.5) * 5.4
    h = v * 5.4
    y = piv2[1] + 0.9 + h * math.cos(tilt) + off * math.sin(tilt)
    z = piv2[2] - 1.2 + h * math.sin(tilt) - off * math.cos(tilt)
    return (piv2[0] + x, y, z)
fr = [arr(0, 0, 0.25), arr(1, 0, 0.25), arr(1, 1, 0.25), arr(0, 1, 0.25)]
bk = [arr(0, 0, -0.35), arr(1, 0, -0.35), arr(1, 1, -0.35), arr(0, 1, -0.35)]
nrm = (0, -math.sin(tilt), -math.cos(tilt))
R2.g('Dark').face(fr, None, nrm)
R2.g('Super').face(bk, None, (0, math.sin(tilt), math.cos(tilt)))
for a, b in ((0, 1), (1, 2), (2, 3), (3, 0)):
    q = [fr[a], fr[b], bk[b], bk[a]]
    cen = [sum(p[m] for p in q) / 4 for m in range(3)]
    mid = [sum(p[m] for p in fr) / 4 for m in range(3)]
    R2.g('Super').face(q, None, tuple(cen[m] - mid[m] for m in range(3)))
for k in range(1, 6):
    a, b = arr(0.02, k / 6, 0.27), arr(0.98, k / 6, 0.27)
    R2.beam('Super', a, b, 0.05)
R2.beam('Super', (piv2[0], piv2[1] + 0.9, piv2[2]), arr(0.5, 0.45, -0.4), 0.35)
radar2 = R2.build(origin=piv2, parent=root)

# ═════════════ Weapon mounts (turrets; guns point −z in their own frame) ═════════════
mount_nodes = []
count = {}
for m in mount_info:
    typ = m['type']
    n = count.get(typ, 0); count[typ] = n + 1
    P_ = Part('mount_%s_%d' % (typ, n))
    o = (m['x'], m['y'], m['z'])
    if typ == 'ciws':
        ciws(P_, o)
    else:
        launcher(P_, o, big=(n % 2 == 1))
    ob = P_.build(origin=o, parent=root)
    mount_nodes.append(ob.name)
    m['node'] = ob.name

# ═════════════ Layout for the game (root extras) ═════════════
layout = {
    'version': 1,
    'deckY': DY, 'shadowY': DY, 'L': C.L, 'draft': C.DRAFT,
    'deck': [[round(x, 2), round(z, 2)] for x, z in deck_poly],
    'elevators': [[[round(x, 2), round(z, 2)] for x, z in p] for p in elev_polys],
    'islandSponson': list(C.ISLAND_SPONSON),
    'island': list(C.ISLAND),
    'waterline': [[x, z] for x, z in waterline],
    'landing': {'angleDeg': C.ANGLE_DEG, 'sternX': C.LA_STERN_X, 'halfW': C.LA_HALF_W, 'fwdZ': C.LA_FWD_Z},
    'wires': [[[round(v, 2) for v in C.wire_ends(i)[0]], [round(v, 2) for v in C.wire_ends(i)[1]]] for i in range(len(C.WIRES_Z))],
    'cats': [list(c) for c in C.CATS],
    'catSpawn': list(C.CAT_SPAWN),
    'mounts': mount_info,
    'parked': [list(p) for p in C.PARKED],
    'lens': list(C.LENS),
}
root['skywar'] = json.dumps(layout, separators=(',', ':'))

print('carrier static tris ~', S.tris(), ' radars', R.tris() + R2.tris())

os.makedirs(os.path.dirname(os.path.abspath(OUT)), exist_ok=True)
bpy.ops.export_scene.gltf(filepath=OUT, export_format='GLB', export_extras=True, export_yup=True,
                          export_materials='EXPORT',
                          export_image_format='AUTO', export_cameras=False, export_lights=False)
print('exported', OUT, os.path.getsize(OUT) // 1024, 'KB')
