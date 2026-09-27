# ═══════════════════════════════════════════════════════════════
# Supply-class fast combat support ship (T-AOE-6, USNS Supply) — scripted model for Blender (run headless):
#   blender -b -P tools/ships/supply_model.py -- <texdir> models/ships/supply.glb
# Game frame (shipkit.py): x starboard, y up (0 = waterline), bow −z.
# Reference: US Navy 1995 Supply-class line drawing (Wikimedia Commons), Wikipedia / GlobalSecurity / FAS /
# navsource, the NPS thesis on the AOE-6 load-out (Appendix B: the replenishment station list), photographs of
# Supply and Arctic. LOA 229.8 m, beam 32.6 m, draught 11.9 m (full load); forecastle 13.6 m and main deck
# 10.2 m above the water; forward superstructure x 44–72 m from the stem (pilothouse roof 25 m) with a lattice
# foremast; the centreline cargo deckhouse x 72–146 (roof 17.5 m) with the replenishment kingposts along its
# edges; funnels x 146–157 and 164–175 (MSC black tops, blue and gold bands); aft superstructure with three
# hangar bays x 176–202; flight deck x 202–229.8. MSC service fit: no weapons.
# Rig (tools/ships/RIG.md): ras_1..12 (span-wire padeyes at each station's kingpost head; odd starboard, even
# port; layout.ras says which rig each is), hose_<n> (fuel stations: where the hose leaves its saddle),
# door_hangar_1..3 (hangar roller doors, slide up), door_accom and hatch_entry (starboard accommodation ladder).
# ═══════════════════════════════════════════════════════════════
import bpy, math, sys, os, json
sys.dont_write_bytecode = True
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from shipkit import Part, material, srgb, smoothstep, lerp, clamp, add_text
import navkit as K
import fleet_textures as FT

args = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
TEX = args[0] if len(args) > 0 else '/tmp/shiptex'
OUT = args[1] if len(args) > 1 else 'supply.glb'
FONT = next((p for p in ('/System/Library/Fonts/Supplemental/Arial Black.ttf',
                         '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf') if os.path.exists(p)), None)

bpy.ops.wm.read_factory_settings(use_empty=True)
material('Deck', srgb(0xffffff), 0.0, 0.88, image=os.path.join(TEX, 'supply_deck.jpg'))
material('Hull', srgb(0xffffff), 0.04, 0.68, image=os.path.join(TEX, 'supply_hull.jpg'))
material('Super', srgb(0x899096), 0.04, 0.62)
material('Dark', srgb(0x2c2f32), 0.2, 0.7)
material('Black', srgb(0x161718), 0.1, 0.6)
material('White', srgb(0xdadddd), 0.05, 0.45)
material('Glass', srgb(0x1a2631), 0.5, 0.12)
material('Blue', srgb(0x1c3f8a), 0.1, 0.5)
material('Gold', srgb(0xc9a227), 0.3, 0.45)
material('Hose', srgb(0x121212), 0.0, 0.7)
material('Tube', srgb(0x5d6166), 0.0, 0.8)
material('Under', srgb(0x74879a), 0.04, 0.7)
material('Yellow', srgb(0xc9a227), 0.1, 0.6)
material('Orange', srgb(0xff6a10), 0.0, 0.6)
material('NavRed', srgb(0xff2020), 0.0, 0.5, emit=srgb(0xff2020), emit_strength=5.0)
material('NavGreen', srgb(0x20ff50), 0.0, 0.5, emit=srgb(0x20ff50), emit_strength=5.0)
material('NavWhite', srgb(0xffffff), 0.0, 0.5, emit=srgb(0xfff4e0), emit_strength=5.0)

LOA = 229.8
def ZX(x):
    """x metres aft of the stem head (the published positions) → game z"""
    return -LOA / 2 + x
BOW, STERN = ZX(0.0), ZX(LOA)
KEEL = -11.9
HB_WL = 16.1                    # waterline half-beam
HB_DECK = 16.3
MAIN = 10.2                     # main deck at the side
FCSLE = 13.6                    # forecastle
H = FT.HULLS['supply']
D = FT.DECKS['supply']
def hull_uv(x, y, z):
    return ((z - H['z0']) / (H['z1'] - H['z0']), (y - H['y0']) / (H['y1'] - H['y0']))
def deck_uv(x, y, z):
    return ((x - D['x0']) / (D['x1'] - D['x0']), (D['z1'] - z) / (D['z1'] - D['z0']))

S = Part('supply_static')

# ═════════════ hull ═════════════
def sheer(z):
    """deck-edge height: raised forecastle to the forward superstructure, main deck aft"""
    x = z - BOW
    fc = FCSLE + 0.9 * (1 - smoothstep(0, 30, x))          # a little sheer at the stem
    return lerp(fc, MAIN, smoothstep(43.0, 47.0, x))
def stem_z(y):
    # raked stem above the waterline, the bulb's forefoot below
    if y >= 0:
        return BOW + 5.0 * (1 - y / (FCSLE + 0.9)) ** 1.2
    return BOW + 5.0 + 2.0 * (-y / -KEEL) ** 0.8
def stern_z(y):
    return STERN if y >= 0.8 else STERN - 30.0 * ((0.8 - y) / (0.8 - KEEL)) ** 1.25
def bsec(y):
    Rb = 3.2
    cx, cy = HB_WL - Rb, KEEL + Rb
    if y < cy:
        dy = cy - y
        return cx + math.sqrt(max(Rb * Rb - dy * dy, 0.0))
    if y <= 0:
        return HB_WL
    return HB_WL + (HB_DECK - HB_WL) * min(y / MAIN, 1.0)
def hb(s, y, z):
    t = clamp((y - KEEL) / (FCSLE - KEEL), 0, 1)
    se = 0.36 - 0.1 * t
    k = 1.6 + 1.4 * t
    u = min(s / se, 1.0)
    fore = 1 - (1 - u) ** k
    sa = lerp(0.3, 0.2, smoothstep(-2.0, 1.0, y))
    tf = lerp(0.05, 0.82, smoothstep(-4.0, 0.8, y))
    w = smoothstep(1 - sa, 1.0, s) ** 1.3
    return bsec(y) * fore * (1 - (1 - tf) * w)
TS = [0.0, 0.03, 0.08, 0.15, 0.25, 0.36, 0.44, 0.5, 0.54, 0.58, 0.66, 0.76, 0.86, 0.94, 1.0]
grid = K.loft_hull(S, TS, 96, KEEL, sheer, stem_z, stern_z, hb, mat='Hull', uvf=hull_uv)
S.sphere('Hull', (0.0, -6.8, BOW + 5.6), 2.4, 2.8, 6.5, nu=14, nv=8, uvf=hull_uv)      # bulbous bow
top = grid[-1]
waterline = K.outline_at(grid, 0.0)

# decks: forecastle + main deck (one strip following the sheer), the flight deck is the same strip aft
K.deck_strip(S, top, 0.25, 'Deck', deck_uv)
deck_outline = [(round(p[0], 2), round(p[2], 2)) for p in top[::3]]
deck_outline = deck_outline + [(-x, z) for x, z in reversed(deck_outline)]
# the forecastle break: bulkhead from the main deck up to the forecastle, outboard of the superstructure
zb = ZX(45.0)
xe = K.edge_at(top, zb)[0]
S.g('Super').face([(-xe, MAIN, zb + 1.8), (xe, MAIN, zb + 1.8), (xe, FCSLE, zb + 1.8), (-xe, FCSLE, zb + 1.8)], None, (0, 0, 1))

# deck-edge rails (main deck, forecastle, flight deck), with gaps at the RAS stations
RAS_X = [70.0, 85.0, 104.0, 124.0, 144.0, 160.0]
for sg in (1, -1):
    segs, cur = [], []
    for p in top[2:-1]:
        x = p[2] - BOW
        if any(abs(x - rx) < 3.5 for rx in RAS_X):
            if len(cur) > 1:
                segs.append(cur)
            cur = []
            continue
        cur.append((sg * (p[0] - 0.15), p[1] + 0.02, p[2]))
    if len(cur) > 1:
        segs.append(cur)
    for sgm in segs:
        K.rail(S, sgm[::2] + [sgm[-1]], h=1.05, step=2.2, mat='Dark')
# hull number (black, MSC style) aft of the anchors, the name on the transom
if FONT:
    for sg in (1, -1):
        zc = ZX(23.0)
        x = K.half_width(grid, zc, 8.5)
        ex = (0, 0, -1) if sg > 0 else (0, 0, 1)
        add_text(S, 'Black', '6', 4.5, FONT, (sg * (x + 0.08), 8.5, zc), ex, (0, 1, 0), (sg, 0, 0), 0.05)
    add_text(S, 'Black', 'SUPPLY', 1.2, FONT, (0, 7.0, STERN + 0.06), (-1, 0, 0), (0, 1, 0), (0, 0, 1), 0.03)

# ═════════════ forecastle: windlasses, bollards, chocks ═════════════
yf = FCSLE + 0.3
for sg in (1, -1):
    S.cyl('Dark', (sg * 2.4, 0, ZX(17.0)), 0.9, 0.9, yf, yf + 0.9, 12)
    S.cyl('Dark', (sg * 2.4, yf + 0.6, 0), 0.5, 0.5, ZX(15.8), ZX(18.2), 10, axis='z')
    S.beam('Black', (sg * 2.4, yf + 0.05, ZX(15.5)), (sg * 4.6, yf + 0.05, ZX(12.0)), 0.4, 0.12)
    for xx in (8.0, 26.0, 36.0):
        K.bollard(S, sg * (K.edge_at(top, ZX(xx))[0] - 1.2), K.edge_at(top, ZX(xx))[1] + 0.2, ZX(xx))
K.whip(S, 0, yf, ZX(3.0), 6.0, mat='Super', r=0.12)          # jackstaff

# ═════════════ forward superstructure (x 44–72) and the bridge ═════════════
FZ0, FZ1 = ZX(44.0), ZX(72.0)
def block(xh, y0, y1, z0, z1, xc=0.0, mat='Super'):
    S.box(mat, xc - xh, xc + xh, y0, y1, z0, z1)
block(13.0, MAIN, 16.4, FZ0, FZ1)
block(12.4, 16.4, 19.2, FZ0 + 1.0, FZ1 - 1.5)
block(11.8, 19.2, 22.0, FZ0 + 1.5, FZ1 - 6.0)
block(10.4, 22.0, 25.0, ZX(46.0), ZX(54.0))                     # pilothouse
block(6.0, 25.0, 26.2, ZX(47.0), ZX(53.0))
# bridge wings to the full beam, pilothouse windows all round the front
for sg in (1, -1):
    S.box('Super', min(sg * 10.4, sg * 16.0), max(sg * 10.4, sg * 16.0), 22.0, 22.3, ZX(46.2), ZX(50.0))
    S.box('Super', min(sg * 15.6, sg * 16.1), max(sg * 15.6, sg * 16.1), 22.3, 23.3, ZX(46.2), ZX(50.0))
    S.box('NavRed' if sg < 0 else 'NavGreen', min(sg * 15.9, sg * 16.15), max(sg * 15.9, sg * 16.15), 23.3, 23.7, ZX(47.8), ZX(48.4))
S.g('Glass').face([(-10.0, 23.0, ZX(45.98)), (10.0, 23.0, ZX(45.98)), (10.0, 24.4, ZX(45.98)), (-10.0, 24.4, ZX(45.98))], None, (0, 0, -1))
for k in range(1, 16):
    x = -10.0 + k * 20.0 / 16
    S.box('Super', x - 0.08, x + 0.08, 23.0, 24.4, ZX(45.92), ZX(46.0))
for sg in (1, -1):
    S.g('Glass').face([(sg * 10.42, 23.0, ZX(46.6)), (sg * 10.42, 23.0, ZX(53.4)), (sg * 10.42, 24.4, ZX(53.4)), (sg * 10.42, 24.4, ZX(46.6))], None, (sg, 0, 0))
# windows / portholes on the lower levels, doors, ladders, rafts
for sg in (1, -1):
    K.portholes(S, sg * 13.0, 14.8, FZ0 + 2, FZ1 - 2, 12, '+x' if sg > 0 else '-x', r=0.3)
    K.portholes(S, sg * 12.4, 17.8, FZ0 + 3, FZ1 - 3, 10, '+x' if sg > 0 else '-x', r=0.3)
    K.portholes(S, sg * 11.8, 20.6, FZ0 + 3, FZ1 - 8, 8, '+x' if sg > 0 else '-x', r=0.3)
    K.wdoor(S, sg * 13.0, MAIN, FZ1 - 3.0, '+x' if sg > 0 else '-x')
    K.wdoor(S, sg * 12.4, 16.4, FZ1 - 4.0, '+x' if sg > 0 else '-x')
    for k in range(4):
        K.raft_rack(S, sg * 12.45, 16.4, FZ0 + 5 + k * 3.2, n=1, along='z', side=sg)
S.g('Glass').face([(-8.0, 20.0, FZ0 + 1.48), (8.0, 20.0, FZ0 + 1.48), (8.0, 21.2, FZ0 + 1.48), (-8.0, 21.2, FZ0 + 1.48)], None, (0, 0, -1))
K.rail(S, [(-11.8, 22.0, FZ0 + 1.5), (11.8, 22.0, FZ0 + 1.5)], h=1.0, step=2.0)
K.rail(S, [(-13.0, 16.4, FZ0), (13.0, 16.4, FZ0)], h=1.0, step=2.0)

# ── lattice foremast (x 60–68) on the superstructure roof, radar platforms, radomes ──
MX0, MX1 = ZX(60.0), ZX(68.0)
MY0, MY1 = 22.0, 40.0
mzc = (MX0 + MX1) / 2
def leg(y, sx, sz):
    t = (y - MY0) / (MY1 - MY0)
    return (sx * lerp(2.6, 0.7, t), mzc + sz * lerp(3.6, 0.7, t))
C4 = [(1, 1), (-1, 1), (-1, -1), (1, -1)]
for sx, sz in C4:
    a, b2 = leg(MY0, sx, sz), leg(MY1, sx, sz)
    S.beam('Super', (a[0], MY0, a[1]), (b2[0], MY1, b2[1]), 0.35)
ys = [MY0 + i * (MY1 - MY0) / 7 for i in range(8)]
for j in range(len(ys) - 1):
    for c in range(4):
        (sxa, sza), (sxb, szb) = C4[c], C4[(c + 1) % 4]
        pa, pb = leg(ys[j], sxa, sza), leg(ys[j], sxb, szb)
        S.beam('Super', (pa[0], ys[j], pa[1]), (pb[0], ys[j], pb[1]), 0.14)
        qb = leg(ys[j + 1], sxb, szb)
        S.beam('Super', (pa[0], ys[j], pa[1]), (qb[0], ys[j + 1], qb[1]), 0.09)
for y in (33.0, 35.0):
    r = lerp(2.6, 0.7, (y - MY0) / (MY1 - MY0)) + 0.8
    S.box('Super', -r, r, y - 0.2, y, mzc - r, mzc + r)
    K.rail(S, [(-r, y, mzc - r), (r, y, mzc - r), (r, y, mzc + r), (-r, y, mzc + r)], h=0.9, step=1.5, closed=True)
S.beam('Super', (-6.5, 31.0, mzc), (6.5, 31.0, mzc), 0.3)
for sx in (-1, 1):
    S.beam('Dark', (sx * 6.0, 31.0, mzc), (sx * 6.0, 29.0, mzc), 0.06)
S.cyl('Super', (0, 0, mzc), 0.35, 0.3, MY1, MY1 + 1.2, 8)
S.cyl('White', (0, 0, mzc), 0.8, 0.8, MY1 + 1.2, MY1 + 2.6, 12)               # TACAN
K.whip(S, 0, MY1 + 2.6, mzc, 4.0)
S.box('NavWhite', -0.18, 0.18, 36.5, 36.9, mzc - 1.4, mzc - 1.0)
for sx in (-1, 1):
    K.radome(S, sx * 7.5, 25.0, ZX(58.0), 1.3)                                   # SATCOM radomes
K.radome(S, 0.0, 26.2, ZX(52.0), 0.9)

# ═════════════ the centreline cargo deckhouse (x 72–146) and the replenishment stations ═════════════
CZ0, CZ1 = ZX(72.0), ZX(146.0)
S.box('Super', -10.0, 10.0, MAIN, 17.5, CZ0, CZ1)
S.box('Super', -9.6, 9.6, 17.5, 17.8, CZ0 + 0.3, CZ1 - 0.3)
for sg in (1, -1):
    # cargo doors / elevator openings to the holds, vents, lights along the deckhouse side
    for x in (78.0, 93.0, 113.0, 133.0):
        zc = ZX(x)
        S.g('Dark').face([(sg * 10.02, MAIN, zc - 2.2), (sg * 10.02, MAIN, zc + 2.2), (sg * 10.02, MAIN + 4.4, zc + 2.2), (sg * 10.02, MAIN + 4.4, zc - 2.2)], None, (sg, 0, 0))
        S.box('Super', min(sg * 10.0, sg * 10.18), max(sg * 10.0, sg * 10.18), MAIN + 4.4, MAIN + 4.7, zc - 2.5, zc + 2.5)
    K.portholes(S, sg * 10.0, 15.8, CZ0 + 4, CZ1 - 4, 18, '+x' if sg > 0 else '-x', r=0.25)
    K.rail(S, [(sg * 9.6, 17.8, CZ0 + 0.3), (sg * 9.6, 17.8, CZ1 - 0.3)], h=1.0, step=2.5)
# roof clutter: vents, kingpost crossbeams sit on top, small cranes, radomes on posts
for x in (80.0, 98.0, 118.0, 138.0):
    S.box('Super', -3.0, -1.2, 17.8, 19.0, ZX(x) - 1.2, ZX(x) + 1.2)
    S.box('Dark', -2.9, -1.3, 18.3, 18.9, ZX(x) - 1.22, ZX(x) - 1.2)
for x in (95.0, 115.0, 135.0):
    for sg in (1, -1):
        S.box('Super', sg * 9.6 - 0.35, sg * 9.6 + 0.35, 17.8, 23.0, ZX(x) - 0.35, ZX(x) + 0.35)
        K.radome(S, sg * 9.6, 23.0, ZX(x), 0.55, ped_h=0.3)
        S.box('NavWhite', sg * 9.6 - 0.12, sg * 9.6 + 0.12, 22.5, 22.8, ZX(x) - 0.12, ZX(x) + 0.12)

# kingposts: box posts 1.3 m square on the main deck at the deckhouse edges, heads ~25 m, a crossbeam over the
# deckhouse (a goalpost); fuel stations carry an outrigger saddle arm with the hose looping down to the probe
# cradle at the deck edge; STREAM stations a sliding-padeye rail on the post
STATIONS = [  # (x, starboard rig, port rig): 'fuel' | 'fuel2' (double hose) | 'stream' | None
    (70.0, 'stream', 'fuel2'), (85.0, 'fuel', 'stream'), (104.0, 'stream', 'stream'),
    (124.0, 'fuel', 'fuel2'), (144.0, 'stream', 'fuel2'), (160.0, 'stream', 'stream')]
HEAD = 25.0
ras_points, hose_points = [], []
for i, (x, rs, rp) in enumerate(STATIONS):
    zc = ZX(x)
    head = HEAD + (1.5 if x in (144.0,) else 0.0)
    for sg, rig in ((1, rs), (-1, rp)):
        px = sg * 11.0
        S.box('Super', px - 0.65, px + 0.65, MAIN, head, zc - 0.65, zc + 0.65)
        S.box('Super', px - 0.85, px + 0.85, head, head + 0.4, zc - 0.85, zc + 0.85)       # head cap
        S.cyl('Dark', (px + sg * 0.9, head - 0.3, 0), 0.25, 0.25, zc - 0.2, zc + 0.2, 8, axis='z')   # span-wire padeye
        S.box('Yellow', min(px + sg * 0.66, px + sg * 0.7), max(px + sg * 0.66, px + sg * 0.7), 13.0, 14.2, zc - 0.5, zc + 0.5)   # station board
        n = 2 * i + (1 if sg > 0 else 2)
        ras_points.append((n, (px + sg * 1.0, head - 0.3, zc), rig, 'stbd' if sg > 0 else 'port'))
        if rig == 'stream':
            S.box('Dark', min(px + sg * 0.66, px + sg * 0.8), max(px + sg * 0.66, px + sg * 0.8), 14.5, head - 1.0, zc - 0.12, zc + 0.12)
            S.box('Dark', min(px + sg * 0.8, px + sg * 1.2), max(px + sg * 0.8, px + sg * 1.2), 18.0, 18.6, zc - 0.3, zc + 0.3)   # trolley
        elif rig:
            hoses = 2 if rig == 'fuel2' else 1
            ya = 21.5
            arm_end = px + sg * 4.2
            S.beam('Super', (px + sg * 0.65, ya, zc), (arm_end, ya, zc), 0.35)
            S.beam('Super', (px + sg * 0.65, ya - 2.0, zc), (arm_end - sg * 0.5, ya - 0.1, zc), 0.18)
            for h in range(hoses):
                dz = (h - (hoses - 1) / 2) * 0.9
                sx0 = px + sg * (2.0 + 1.6 * h)
                S.cyl('Dark', (sx0, ya + 0.35, 0), 0.35, 0.35, zc + dz - 0.2, zc + dz + 0.2, 10, axis='z')   # saddle
                # hose: from the saddle down in a catenary to the probe cradle at the deck edge
                edge = K.edge_at(top, zc + dz)
                ex_, ey_ = edge[0] - 0.4, edge[1] + 1.2
                pts = []
                for k in range(13):
                    t = k / 12
                    xx = lerp(sx0, sg * ex_, t)
                    yy = lerp(ya + 0.35, ey_, t) - 4.5 * math.sin(math.pi * t) * (1 - t * 0.6)
                    pts.append((xx, max(yy, MAIN + 1.2), zc + dz))
                K.sweep_tube(S, pts, 0.14, 'Hose', n=8)
                S.box('Dark', min(sg * ex_, sg * (ex_ - 1.0)), max(sg * ex_, sg * (ex_ - 1.0)), MAIN, ey_ + 0.3, zc + dz - 0.5, zc + dz + 0.5)   # probe cradle
                hose_points.append(('hose_%d_%d' % (n, h + 1), (sx0, ya + 0.35, zc + dz)))
    # crossbeam over the deckhouse, a catwalk under it
    S.box('Super', -11.0, 11.0, head - 0.2, head + 0.6, zc - 0.5, zc + 0.5)
    S.box('Super', -10.0, 10.0, 17.8, 18.2, zc - 0.9, zc + 0.9)
# cargo booms: station 3/4 frame stowed sloping forward, station 11/12 sloping aft beside funnel 2
for (x, dirz) in ((85.0, -1), (160.0, 1)):
    for sg in (1, -1):
        base = (sg * 11.0, 12.5, ZX(x) + dirz * 0.7)
        tip = (sg * 11.8, 17.5, ZX(x) + dirz * 16.0)
        S.beam('Super', base, tip, 0.5)
        S.beam('Dark', tip, (sg * 11.0, HEAD, ZX(x)), 0.06)

# ═════════════ funnels (x 146–157, 164–175): MSC black tops with stub exhausts, blue and gold bands ═════════════
def funnel(x0, x1, top_y):
    z0, z1 = ZX(x0), ZX(x1)
    w0, w1 = 4.6, 4.2
    S.box('Super', -w0, w0, 17.5, top_y - 3.6, z0, z1)
    S.box('Blue', -w0 - 0.02, w0 + 0.02, top_y - 3.6, top_y - 3.2, z0 - 0.02, z1 + 0.02)
    S.box('Gold', -w0 - 0.02, w0 + 0.02, top_y - 3.2, top_y - 2.6, z0 - 0.02, z1 + 0.02)
    S.box('Black', -w1, w1, top_y - 2.6, top_y, z0 + 0.2, z1 - 0.2)
    for sx in (-2.2, 0.0, 2.2):
        for dz in (-2.0, 2.0):
            S.cyl('Black', (sx, 0, (z0 + z1) / 2 + dz), 0.55, 0.55, top_y, top_y + 1.2, 10)
    for sg in (1, -1):
        S.box('Dark', min(sg * w0, sg * (w0 + 0.1)), max(sg * w0, sg * (w0 + 0.1)), 19.0, top_y - 4.0, z0 + 1.5, z0 + 3.5)   # louvres
funnel(146.0, 157.0, 27.5)
funnel(164.0, 175.0, 26.0)
S.box('Super', -10.0, 10.0, MAIN, 17.5, ZX(146.0), ZX(176.0))         # the structure under the funnels
for sg in (1, -1):
    K.portholes(S, sg * 10.0, 15.8, ZX(147), ZX(175), 10, '+x' if sg > 0 else '-x', r=0.25)

# ═════════════ aft superstructure, hangar (three bays facing aft), flight deck ═════════════
AZ0, AZ1 = ZX(176.0), ZX(202.0)
S.box('Super', -14.0, 14.0, MAIN, 17.5, AZ0, AZ1)
S.box('Super', -12.0, 12.0, 17.5, 19.0, AZ0 + 1.0, AZ1)
S.box('Super', -6.0, 6.0, 19.0, 22.5, ZX(196.0), AZ1)                   # flight control / hangar top
S.g('Glass').face([(-5.0, 20.5, AZ1 + 0.02), (5.0, 20.5, AZ1 + 0.02), (5.0, 21.8, AZ1 + 0.02), (-5.0, 21.8, AZ1 + 0.02)], None, (0, 0, 1))
S.g('Glass').face([(-11.0, 18.0, AZ1 + 0.02), (-7.0, 18.0, AZ1 + 0.02), (-7.0, 18.8, AZ1 + 0.02), (-11.0, 18.8, AZ1 + 0.02)], None, (0, 0, 1))
HANGAR_W, HANGAR_H = 8.5, 6.6
hangar_x = [-9.2, 0.0, 9.2]
for hx in hangar_x:
    S.g('Dark').face([(hx - HANGAR_W / 2, MAIN, AZ1 + 0.02), (hx + HANGAR_W / 2, MAIN, AZ1 + 0.02), (hx + HANGAR_W / 2, MAIN + HANGAR_H, AZ1 + 0.02), (hx - HANGAR_W / 2, MAIN + HANGAR_H, AZ1 + 0.02)], None, (0, 0, 1))
for sg in (1, -1):
    K.portholes(S, sg * 14.0, 15.0, AZ0 + 2, AZ1 - 2, 8, '+x' if sg > 0 else '-x', r=0.3)
    K.wdoor(S, sg * 14.0, MAIN, AZ0 + 3.0, '+x' if sg > 0 else '-x')
    K.radome(S, sg * 9.0, 19.0, AZ0 + 4.0, 1.1)
    for k in range(3):
        K.raft_rack(S, sg * 14.05, 17.5, AZ0 + 5 + k * 3.2, n=1, along='z', side=sg)
K.rail(S, [(-12.0, 19.0, AZ1), (12.0, 19.0, AZ1)], h=1.0, step=2.0)
S.cyl('Super', (0, 0, ZX(199.0)), 0.25, 0.15, 22.5, 30.0, 8)
S.box('NavWhite', -0.15, 0.15, 29.6, 29.9, ZX(199.0) - 0.15, ZX(199.0) + 0.15)
# flight-deck edge: safety nets folded out, lights
for sg in (1, -1):
    for x in range(204, 229, 3):
        edge = K.edge_at(top, ZX(x))
        S.box('Dark', min(sg * edge[0], sg * (edge[0] + 1.3)), max(sg * edge[0], sg * (edge[0] + 1.3)), edge[1] - 0.25, edge[1] - 0.2, ZX(x) - 1.4, ZX(x) + 1.4)

# ═════════════ boats (x 110–120), the accommodation ladder (starboard 105–117) ═════════════
for sg in (1, -1):
    K.rhib7(S, (sg * 13.2, MAIN + 1.4, ZX(115.0)), yaw=0.0)
    K.davit(S, (sg * 11.0, MAIN, ZX(118.5)), side=sg, h=5.2, reach=3.0)
ACC_TOP = (MAIN, ZX(116.0))
ACC_BOT = (1.6, ZX(105.0))
xt = K.half_width(grid, ACC_TOP[1], ACC_TOP[0] - 0.5)
xb = K.half_width(grid, ACC_BOT[1], ACC_BOT[0])
S.box('Super', xt, xt + 1.6, ACC_TOP[0] - 0.2, ACC_TOP[0], ACC_TOP[1] - 1.6, ACC_TOP[1] + 1.4)
S.box('Super', xb + 0.15, xb + 2.2, ACC_BOT[0] - 0.22, ACC_BOT[0], ACC_BOT[1] - 2.2, ACC_BOT[1] + 0.9)
lx = (xt + xb) / 2 + 1.0
K.ladder(S, (lx, ACC_BOT[0], ACC_BOT[1] + 0.9), (lx, ACC_TOP[0] - 0.1, ACC_TOP[1] - 1.6), w=1.0, mat='Super', rung=0.28)
for dx in (-0.55, 0.55):
    S.beam('Dark', (lx + dx, ACC_BOT[0] + 1.0, ACC_BOT[1] + 0.9), (lx + dx, ACC_TOP[0] + 0.9, ACC_TOP[1] - 1.6), 0.05)
K.rail(S, [(xb + 2.2, ACC_BOT[0], ACC_BOT[1] - 2.2), (xb + 2.2, ACC_BOT[0], ACC_BOT[1] + 0.9)], h=1.0, step=0.8)
S.g('Dark').face([(xt + 0.02, ACC_TOP[0] - 3.0, ACC_TOP[1] - 0.6), (xt + 0.02, ACC_TOP[0] - 3.0, ACC_TOP[1] + 0.6), (xt + 0.02, ACC_TOP[0] - 1.0, ACC_TOP[1] + 0.6), (xt + 0.02, ACC_TOP[0] - 1.0, ACC_TOP[1] - 0.6)], None, (1, 0, 0))

# ═════════════ underwater: shafts, struts, propellers, rudders ═════════════
for sx in (-6.5, 6.5):
    S.beam('Hull', (sx * 0.8, -8.6, ZX(180.0)), (sx, -8.8, ZX(214.0)), 0.9)
    S.beam('Hull', (sx, -8.8, ZX(210.0)), (sx * 0.85, -4.0, ZX(209.0)), 0.5, 1.2)
    S.cyl('Dark', (sx, -8.8, 0), 0.7, 0.3, ZX(214.0), ZX(215.8), 10, axis='z')
    for b in range(5):
        a = 2 * math.pi * b / 5
        S.beam('Dark', (sx, -8.8, ZX(214.9)), (sx + 3.0 * math.cos(a), -8.8 + 3.0 * math.sin(a), ZX(215.2)), 1.1, 0.14)
    S.box('Hull', sx - 0.45, sx + 0.45, -10.5, -3.0, ZX(219.0), ZX(225.0), uvf=hull_uv)

# ═════════════ detail: RAS winches and cargo, superstructure rails and stairs, deck fittings, antennas ═════════════
for i, (x, rs, rp) in enumerate(STATIONS):
    zc = ZX(x)
    for sg, rig in ((1, rs), (-1, rp)):
        # the station's winch on the main deck inboard of the post (drum and motor housing)
        S.box('Super',min(sg * 10.0, sg * 11.4), max(sg * 10.0, sg * 11.4), MAIN, MAIN + 1.2, zc + 1.2, zc + 2.8)
        S.cyl('Dark', (0, MAIN + 0.9, zc + 2.0), 0.55, 0.55, min(sg * 11.5, sg * 12.6), max(sg * 11.5, sg * 12.6), 12, axis='x')
        if rig == 'stream':
            # palletised cargo staged at the deck edge for the next lift
            for k in range(3):
                e = K.edge_at(top, zc - 3.0 - k * 1.6)
                S.box('Dark' if k % 2 else 'Super', sg * (e[0] - 2.6) - 0.6, sg * (e[0] - 2.6) + 0.6, MAIN + 0.1, MAIN + 1.2 + 0.2 * k, zc - 3.6 - k * 1.6, zc - 2.4 - k * 1.6)
for (y, xh, z0, z1) in ((16.4, 13.0, FZ0, FZ1), (19.2, 12.4, FZ0 + 1.0, FZ1 - 1.5), (22.0, 11.8, FZ0 + 1.5, FZ1 - 6.0)):
    K.rail(S, [(-xh, y, z1), (-xh, y, z0 + 2.0)], h=1.0, step=2.0)
    K.rail(S, [(xh, y, z1), (xh, y, z0 + 2.0)], h=1.0, step=2.0)
    K.rail(S, [(-xh, y, z1), (xh, y, z1)], h=1.0, step=2.0)
K.rail(S, [(-14.0, 17.5, AZ0), (14.0, 17.5, AZ0), (14.0, 17.5, AZ1), (-14.0, 17.5, AZ1)], h=1.0, step=2.0, closed=True)
for sg in (1, -1):
    K.stair(S, (sg * 12.0, MAIN, FZ1 + 3.0), (sg * 12.0, 16.4, FZ1 - 0.5))
    K.stair(S, (sg * 11.0, MAIN, ZX(140.0)), (sg * 10.4, 17.5, ZX(136.0)))
    K.stair(S, (sg * 15.0, MAIN, AZ0 - 2.5), (sg * 14.5, 17.5, AZ0 + 1.5))
    for x in list(range(8, 44, 7)) + list(range(50, 205, 12)):
        e = K.edge_at(top, ZX(x))
        if not any(abs(x - rx) < 4.5 for rx in RAS_X):
            K.cleat(S, sg * (e[0] - 0.5), e[1] + 0.05, ZX(x))
    for x in (60.0, 90.0, 130.0, 185.0):
        K.hose_reel(S, sg * (13.0 if x < 72 else 10.0 if x < 176 else 14.0), MAIN, ZX(x), '+x' if sg > 0 else '-x')
    for x in (40.0, 98.0, 178.0, 210.0):
        e = K.edge_at(top, ZX(x))
        K.lifebuoy(S, sg * (e[0] - 0.15), e[1] + 0.8, ZX(x), '+x' if sg > 0 else '-x')
    for (x, y, h) in ((50.0, 26.2, 6.0), (70.0, 22.0, 5.0), (150.0, 27.5, 5.0), (196.0, 22.5, 7.0)):
        K.whip(S, sg * 5.5, y, ZX(x), h, r=0.05)

root = bpy.data.objects.new('supply', None)
bpy.context.collection.objects.link(root)
S.build(parent=root)

# ═════════════ Rig ═════════════
for (n, p, rig, side) in ras_points:
    K.point('ras_%d' % n, p, root, None, t='point', rig=rig or 'none', side=side)
for (name, p) in hose_points:
    K.point(name, p, root)
for i, hx in enumerate(hangar_x):
    Dp = Part('door_hangar_%d' % (i + 1))
    Dp.box('Super', hx - HANGAR_W / 2, hx + HANGAR_W / 2, MAIN, MAIN + HANGAR_H, AZ1 + 0.03, AZ1 + 0.18)
    for k in range(1, 8):
        yy = MAIN + k * HANGAR_H / 8
        Dp.box('Dark', hx - HANGAR_W / 2 + 0.1, hx + HANGAR_W / 2 - 0.1, yy - 0.03, yy + 0.03, AZ1 + 0.18, AZ1 + 0.2)
    # a roller door: it rises into the hangar head (hidden above the opening)
    K.sliding(Dp, 'door_hangar_%d' % (i + 1), (hx, MAIN, AZ1 + 0.1), root, (0, 1, 0), HANGAR_H - 0.2, t='door')
# the hull door at the top of the accommodation ladder, and where a boat's crew steps off
Dd = Part('door_accom')
Dd.box('Super', xt + 0.02, xt + 0.09, ACC_TOP[0] - 3.0, ACC_TOP[0] - 1.0, ACC_TOP[1] - 0.6, ACC_TOP[1] + 0.6)
K.hinged(Dd, 'door_accom', (xt + 0.05, ACC_TOP[0] - 3.0, ACC_TOP[1] - 0.6), root, (0, 1, 0), 1.75)
K.point('hatch_entry', (xb + 1.2, ACC_BOT[0], ACC_BOT[1] - 0.6), root)

# ═════════════ layout ═════════════
layout = {
    'version': 1, 'deckY': MAIN, 'shadowY': 17.5, 'L': LOA, 'draft': -KEEL,
    'deck': [[x, z] for x, z in deck_outline],
    'waterline': [[x, z] for x, z in waterline],
    'ras': [{'n': n, 'rig': rig or 'none', 'side': side, 'p': [round(v, 2) for v in p]} for (n, p, rig, side) in ras_points],
    'flightDeck': [ZX(202.0), ZX(LOA)],
    'fx': {'bowWave': 20, 'sternWave': 9, 'contact': 4.0, 'pile': 1.4, 'occlusion': 9, 'maxLen': 1600},
    'mounts': [],
}
root['skywar'] = json.dumps(layout, separators=(',', ':'))
print('supply tris ~', S.tris())
os.makedirs(os.path.dirname(os.path.abspath(OUT)), exist_ok=True)
bpy.ops.export_scene.gltf(filepath=OUT, export_format='GLB', export_extras=True, export_yup=True,
                          export_materials='EXPORT', export_image_format='AUTO', export_cameras=False, export_lights=False)
print('exported', OUT, os.path.getsize(OUT) // 1024, 'KB')
