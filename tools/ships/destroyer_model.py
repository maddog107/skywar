# ═══════════════════════════════════════════════════════════════
# Arleigh Burke-class (Flight IIA) guided-missile destroyer — scripted model for Blender:
#   python3 tools/ships/ship_textures.py /tmp/shiptex && python3 tools/ships/fleet_textures.py /tmp/shiptex
#   blender -b -P tools/ships/destroyer_model.py -- /tmp/shiptex models/ships/destroyer.glb
# Game frame (shipkit.py): x starboard, y up (0 = waterline), bow −z; the bow tip (at deck level) is z = −77.5.
# Reference (x = metres aft of the bow tip): Naval Vessel Register, USNI Proceedings June 2002 ("Handling the
# Arleigh Burkes"), FAS DDG-51 and its aviation facilities resume, Navypedia, the Shipbucket DDG-79 drawing, the
# Proietti Flight IIA drawing (Commons) and US Navy photographs; Mk 41 from the United Defense data sheets.
# LOA 155.3 m, beam 20.1 m (18.0 at the waterline), hull draught ~6.4 m (9.4 m over the sonar dome); deck edge 10.7 m
# at the bull nose, 8.5 at the gun, 6.7 amidships, flight deck 4.0 m. Mk 45 at x 30; forward Mk 41 (32 cells,
# 8 across × 4 along) at x 34.8–39.2 on a plinth; superstructure from x 44.5 with all four SPY-1D faces (the aft
# pair raised on the IIA); tripod mast (top x 64.5, 43 m); funnels x 68–76 and 85.5–93; aft Mk 41 (64 cells,
# 8 × 8) at x 120–129 between the two hangars (x 112–133); flight deck x 133–155.3.
# Rig (tools/ships/RIG.md): vls_1..96 cell doors (one shared mesh, drawn instanced), cell_1..96 (fore 1–32,
# aft 33–96; +Y up), uptake_1..12, door_hangar_1..2 (roller doors), radar (SPS-67), mounts (turrets).
# ═══════════════════════════════════════════════════════════════
import bpy, math, sys, os, json
sys.dont_write_bytecode = True
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from shipkit import Part, material, srgb, smoothstep, lerp, clamp, add_text
import navkit as K
import fleet_textures as FT

args = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
TEX = args[0] if len(args) > 0 else '/tmp/shiptex'
OUT = args[1] if len(args) > 1 else 'destroyer.glb'
FONT = next((p for p in ('/System/Library/Fonts/Supplemental/Arial Black.ttf',
                         '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf') if os.path.exists(p)), None)
HULL_NO = '89'

bpy.ops.wm.read_factory_settings(use_empty=True)
material('Deck', srgb(0xffffff), 0.0, 0.88, image=os.path.join(TEX, 'destroyer_deck.jpg'))
material('Hull', srgb(0xffffff), 0.04, 0.68, image=os.path.join(TEX, 'destroyer_hull.jpg'))
material('Super', srgb(0x899096), 0.04, 0.62)
material('Dark', srgb(0x2c2f32), 0.2, 0.7)
material('White', srgb(0xdadddd), 0.05, 0.45)
material('Glass', srgb(0x1a2631), 0.5, 0.12)
material('Array', srgb(0x5d646b), 0.1, 0.55)
material('VLS', srgb(0x575c61), 0.1, 0.78)       # deck grey, as the real lids
material('Canister', srgb(0x3a3f44), 0.1, 0.7)
material('Tube', srgb(0x5d6166), 0.0, 0.8)
material('Black', srgb(0x161718), 0.1, 0.6)
material('Orange', srgb(0xff6a10), 0.0, 0.6)
material('Under', srgb(0x74879a), 0.04, 0.7)
material('NavRed', srgb(0xff2020), 0.0, 0.5, emit=srgb(0xff2020), emit_strength=5.0)
material('NavGreen', srgb(0x20ff50), 0.0, 0.5, emit=srgb(0x20ff50), emit_strength=5.0)
material('NavWhite', srgb(0xffffff), 0.0, 0.5, emit=srgb(0xfff4e0), emit_strength=5.0)

LOA = 155.3
BOW, STERN = -77.5, -77.5 + LOA
def ZX(x):
    """x metres aft of the bow tip → game z"""
    return BOW + x
KEEL = -6.4
DX0, DX1, DZ0, DZ1 = -11.0, 11.0, -78.0, 78.0
H = FT.HULLS['destroyer']
def deck_uv(x, y, z):
    return ((x - DX0) / (DX1 - DX0), (DZ1 - z) / (DZ1 - DZ0))
def hull_uv(x, y, z):
    return ((z - H['z0']) / (H['z1'] - H['z0']), (y - H['y0']) / (H['y1'] - H['y0']))

MAIN = 6.7         # the main deck amidships (x 48–130)
FD = 4.0           # flight deck
Y01 = 9.6          # 01 level (and the hangar roof)
Y02, Y03 = 12.4, 15.1
SHEER = [(0.0, 10.7), (15.0, 9.5), (30.0, 8.5), (37.0, 8.0), (45.0, 7.2), (48.0, MAIN), (131.0, MAIN), (132.6, FD), (LOA + 1, FD)]
def sheer(z):
    x = z - BOW
    for (x0, h0), (x1, h1) in zip(SHEER, SHEER[1:]):
        if x0 <= x <= x1:
            t = (x - x0) / (x1 - x0)
            return h0 + (h1 - h0) * (smoothstep(0, 1, t) if (x0, x1) == (131.0, 132.6) else t)
    return SHEER[0][1] if x < 0 else SHEER[-1][1]
def stem_z(y):
    # the bull nose at deck level, the stem meeting the water ~10 m aft of it, the forefoot sweeping back
    if y >= 0:
        return ZX(10.0) - 10.0 * min(y / 10.7, 1.0) ** 0.85
    return ZX(10.0) + 5.5 * (-y / -KEEL) ** 1.2
def stern_z(y):
    return STERN if y >= -0.6 else STERN - 22.0 * ((-0.6 - y) / 5.8) ** 1.2
def bsec(y):
    R = 2.4
    cx, cy = 9.0 - R, KEEL + R
    if y < cy:
        dy = cy - y
        return cx + math.sqrt(max(R * R - dy * dy, 0.0))
    if y <= 0:
        return 9.0
    return 9.0 + 1.05 * min(y / 7.0, 1.0)      # strong flare: 20.1 m across the deck edge
def hb(s, y, z=None):
    t = clamp((y - KEEL) / (10.7 - KEEL), 0, 1)
    se = 0.46 - 0.12 * t
    k = 1.5 + 1.6 * t
    u = min(s / se, 1.0)
    fore = 1 - (1 - u) ** k
    sa = lerp(0.34, 0.22, smoothstep(-2.0, 1.0, y))
    tf = lerp(0.05, 0.76, smoothstep(-3.0, 0.5, y))
    w = smoothstep(1 - sa, 1.0, s) ** 1.3
    return bsec(y) * fore * (1 - (1 - tf) * w)

S = Part('destroyer_static')
# ═════════════ hull ═════════════
TS = [0.0, 0.03, 0.08, 0.15, 0.25, 0.36, 0.44, 0.5, 0.58, 0.68, 0.8, 0.9, 1.0]
grid = K.loft_hull(S, TS, 96, KEEL, sheer, stem_z, stern_z, hb, mat='Hull', uvf=hull_uv)
S.sphere('Hull', (0.0, -7.1, ZX(17.5)), 2.1, 2.3, 9.0, nu=12, nv=8, uvf=hull_uv)          # SQS-53 sonar dome
for sg in (1, -1):
    S.beam('Hull', (sg * 7.9, -5.2, -25.0), (sg * 7.9, -5.2, 25.0), 0.9, 0.15)          # bilge keels
top = grid[-1]
waterline = K.outline_at(grid, 0.0)
deck_outline = [(round(p[0], 2), round(p[2], 2)) for p in top[::3]]
deck_outline = deck_outline + [(-x, z) for x, z in reversed(deck_outline)]
def deck_y(z):
    return sheer(z) + 0.1
def hull_x_at(z, y):
    return K.half_width(grid, z, y)

# ── Mk 41: rows of cells run athwartships (8 cells across the beam), the uptakes between the rows ──
LAUNCHERS = [
    dict(name='fore', nx=2, nz=2, along='x', zc=ZX(37.0)),       # 32 cells, 8 across × 4 along, 6.32 × 4.36 m
    dict(name='aft', nx=2, nz=4, along='x', zc=ZX(124.5)),       # 64 cells, 8 × 8, 6.32 × 8.71 m
]
for Ln in LAUNCHERS:
    W_, Lz_ = K.mk41_launcher_size(Ln['nx'], Ln['nz'], Ln['along'])
    Ln['x0'], Ln['z0'], Ln['W'], Ln['Lz'] = -W_ / 2, Ln['zc'] - Lz_ / 2, W_, Lz_
FWD, AFT = LAUNCHERS
K.deck_strip(S, top, 0.18, 'Deck', deck_uv)
# deck-edge rails from the bow round to the hangar, and round the flight deck
for sg in (1, -1):
    pts = [(sg * (p[0] - 0.12), p[1] + 0.02, p[2]) for p in top[2:-1] if p[2] < STERN - 1.0]
    K.rail(S, pts[::2] + [pts[-1]], h=1.05, step=1.8)

# ═════════════ forecastle: anchor gear, bollards, breakwater, jackstaff ═════════════
y = deck_y(ZX(10.0)) + 0.1
S.cyl('Dark', (1.5, 0, ZX(10.0)), 0.6, 0.6, y, y + 0.7, 12)                                  # windlass
S.cyl('Dark', (1.5, y + 0.5, 0), 0.35, 0.35, ZX(9.2), ZX(10.8), 10, axis='z')
S.beam('Black', (1.5, y + 0.03, ZX(9.4)), (3.6, deck_y(ZX(4.5)) + 0.08, ZX(4.5)), 0.3, 0.08)  # chain to the starboard hawse
S.cyl('Dark', (0.0, 0, ZX(6.5)), 0.45, 0.45, deck_y(ZX(6.5)), deck_y(ZX(6.5)) + 0.6, 10)      # stem-anchor capstan
for sg in (1, -1):
    for x in (4.5, 16.0, 27.0, 40.0):
        e = K.edge_at(top, ZX(x))
        K.bollard(S, sg * (e[0] - 1.0), e[1] + 0.12, ZX(x))
    # V breakwater ahead of the gun
    S.beam('Super', (0.0, deck_y(ZX(22.5)) + 0.6, ZX(21.8)), (sg * 5.8, deck_y(ZX(26.0)) + 0.6, ZX(26.5)), 1.2, 0.18)
K.whip(S, 0, deck_y(ZX(0.8)), ZX(0.8), 4.5, mat='Super', r=0.08)          # jackstaff
S.box('NavWhite', -0.1, 0.1, deck_y(ZX(0.8)) + 4.3, deck_y(ZX(0.8)) + 4.5, ZX(0.7), ZX(0.9))

# ═════════════ the 01 deckhouse from the superstructure front (x 44.5) to the hangar's aft face (x 133) ═════════════
Z01A, Z01B = ZX(44.5), ZX(133.0)
BOAT0, BOAT1 = ZX(89.0), ZX(108.0)          # the starboard boat bay (the deckhouse steps in there)
def house_side(sg, z0, z1, xb, xt, yb, yt):
    S.g('Super').face([(sg * xb, yb, z0), (sg * xb, yb, z1), (sg * xt, yt, z1), (sg * xt, yt, z0)], None, (sg, 0.15, 0))
for sg in (1, -1):
    if sg > 0:
        house_side(sg, Z01A + 3.0, BOAT0, 8.3, 7.9, MAIN, Y01)
        house_side(sg, BOAT0, BOAT1, 5.6, 5.3, MAIN, Y01)
        house_side(sg, BOAT1, Z01B, 8.3, 7.9, MAIN, Y01)
        for zb in (BOAT0, BOAT1):
            S.g('Super').face([(5.6, MAIN, zb), (8.3, MAIN, zb), (7.9, Y01, zb), (5.3, Y01, zb)], None, (0, 0, 1 if zb == BOAT0 else -1))
    else:
        house_side(sg, Z01A + 3.0, Z01B, 8.3, 7.9, MAIN, Y01)
# chamfered front corners and the front face
S.g('Super').face([(-5.3, MAIN, Z01A), (5.3, MAIN, Z01A), (5.0, Y01, Z01A + 0.4), (-5.0, Y01, Z01A + 0.4)], None, (0, 0.15, -1))
for sg in (1, -1):
    S.g('Super').face([(sg * 5.3, MAIN, Z01A), (sg * 8.3, MAIN, Z01A + 3.0), (sg * 7.9, Y01, Z01A + 3.2), (sg * 5.0, Y01, Z01A + 0.4)], None, (sg, 0.15, -1))
# the aft face (hangar doors are rig nodes; the frames and the wall between them here), down to the flight deck
S.g('Super').face([(-7.9, FD, Z01B), (-6.4, FD, Z01B), (-6.4, Y01, Z01B), (-7.9, Y01, Z01B)], None, (0, 0, 1))
S.g('Super').face([(6.4, FD, Z01B), (7.9, FD, Z01B), (7.9, Y01, Z01B), (6.4, Y01, Z01B)], None, (0, 0, 1))
S.g('Super').face([(-1.1, FD, Z01B), (1.1, FD, Z01B), (1.1, Y01, Z01B), (-1.1, Y01, Z01B)], None, (0, 0, 1))
for x0, x1 in ((-6.4, -1.1), (1.1, 6.4)):
    S.g('Super').face([(x0, 8.6, Z01B), (x1, 8.6, Z01B), (x1, Y01, Z01B), (x0, Y01, Z01B)], None, (0, 0, 1))
    S.g('Dark').face([(x0, FD, Z01B - 0.4), (x1, FD, Z01B - 0.4), (x1, 8.6, Z01B - 0.4), (x0, 8.6, Z01B - 0.4)], None, (0, 0, 1))   # hangar inside
    for xs in (x0, x1):
        S.g('Dark').face([(xs, FD, Z01B), (xs, FD, Z01B - 0.4), (xs, 8.6, Z01B - 0.4), (xs, 8.6, Z01B)], None, (1 if xs == x0 else -1, 0, 0))
for sg in (1, -1):   # the lower hangar sides from the main deck down to the flight deck at the stern end
    S.g('Super').face([(sg * 8.3, FD, Z01B - 2.0), (sg * 8.3, FD, Z01B), (sg * 8.3, MAIN, Z01B), (sg * 8.3, MAIN, Z01B - 2.0)], None, (sg, 0, 0))
# the 01 roof, with the aft launcher's opening between the hangars
ah = (AFT['x0'] - 0.33, AFT['x0'] + AFT['W'] + 0.33, AFT['z0'] - 0.33, AFT['z0'] + AFT['Lz'] + 0.33)
K.plate_with_holes(S, 'Deck', -7.9, 7.9, Z01A + 3.2, Z01B, Y01, [ah], depth=0.6, wall='Super', bottom='Dark', uvf=deck_uv)
S.g('Deck').face([(-5.0, Y01, Z01A + 0.4), (5.0, Y01, Z01A + 0.4), (7.9, Y01, Z01A + 3.2), (-7.9, Y01, Z01A + 3.2)], [deck_uv(0, Y01, Z01A)] * 4, (0, 1, 0))
for sg in (1, -1):
    K.rail(S, [(sg * 7.85, Y01, ZX(62.0)), (sg * 7.85, Y01, Z01B)], h=1.0, step=1.8)
    K.portholes(S, sg * 8.25, 8.3, ZX(50.0), ZX(84.0), 8, '+x' if sg > 0 else '-x', r=0.2)
    K.wdoor(S, sg * 8.3, MAIN, ZX(66.0), '+x' if sg > 0 else '-x')
    K.wdoor(S, sg * 8.3, MAIN, ZX(114.0), '+x' if sg > 0 else '-x')

# ═════════════ forward superstructure: 02–05 levels, all four SPY-1D faces, pilothouse ═════════════
ZF0, ZF1 = ZX(44.8), ZX(66.0)
K.deckhouse(S, 7.6, 7.2, Y01, Y03, ZF0, ZF1, chamfer_front=3.6)
for sg in (1, -1):
    K.spy_face(S, (sg * 5.35, 14.5, ZX(52.0) - 5.0 + 0.3), (sg * 0.707, -0.707), size=3.75, tilt=math.radians(-8))
# the 04 level and the raised aft block carrying the aft pair (x 61.5, 17 m)
K.deckhouse(S, 6.9, 6.6, Y03, 18.0, ZX(47.8), ZX(64.5), chamfer_front=1.2, chamfer_back=3.4)
K.deckhouse(S, 6.3, 6.0, 18.0, 19.4, ZX(56.0), ZX(64.3), chamfer_back=3.1)
for sg in (1, -1):
    K.spy_face(S, (sg * 5.1, 17.0, ZX(61.5)), (sg * 0.707, 0.707), size=3.75, tilt=math.radians(-8))
# the pilothouse (x 48–56): windows round the front and sides, a visor, bridge wings to ±9.5
S.g('Glass').face([(-5.6, 16.2, ZX(47.8) - 0.02), (5.6, 16.2, ZX(47.8) - 0.02), (5.5, 17.6, ZX(47.8) - 0.02), (-5.5, 17.6, ZX(47.8) - 0.02)], None, (0, 0, -1))
for k in range(1, 9):
    x = -5.6 + k * 11.2 / 9
    S.box('Super', x - 0.06, x + 0.06, 16.2, 17.6, ZX(47.8) - 0.08, ZX(47.8))
S.box('Super', -6.0, 6.0, 17.6, 17.75, ZX(47.8) - 0.45, ZX(47.8))
for sg in (1, -1):
    x = sg * 6.72
    S.g('Glass').face([(x, 16.2, ZX(49.2)), (x, 16.2, ZX(55.0)), (x, 17.6, ZX(55.0)), (x, 17.6, ZX(49.2))], None, (sg, 0, 0))
    S.box('Super', min(sg * 6.6, sg * 9.5), max(sg * 6.6, sg * 9.5), Y03 - 0.25, Y03, ZX(48.0), ZX(53.5))           # wing
    K.rail(S, [(sg * 6.6, Y03, ZX(48.0)), (sg * 9.5, Y03, ZX(48.0)), (sg * 9.5, Y03, ZX(53.5)), (sg * 6.6, Y03, ZX(53.5))], h=1.0, step=1.2)
    S.box('Glass', min(sg * 9.1, sg * 9.4), max(sg * 9.1, sg * 9.4), Y03 + 0.6, Y03 + 1.5, ZX(49.0), ZX(49.8))
    S.box('NavRed' if sg < 0 else 'NavGreen', min(sg * 9.45, sg * 9.75), max(sg * 9.45, sg * 9.75), Y03 + 0.2, Y03 + 0.55, ZX(50.0), ZX(50.5))
    K.searchlight(S, sg * 9.0, Y03, ZX(52.5))
    # SLQ-32(V)3 / SEWIP: the big sloped EW arrays on sponsons (x 57–60, ~18 m, ±8)
    S.box('Super', min(sg * 6.6, sg * 8.2), max(sg * 6.6, sg * 8.2), Y03 + 0.9, Y03 + 1.2, ZX(56.8), ZX(60.2))
    S.box('Super', min(sg * 7.0, sg * 8.4), max(sg * 7.0, sg * 8.4), Y03 + 1.2, 20.2, ZX(57.0), ZX(60.0))
    S.box('Array', min(sg * 8.4, sg * 8.46), max(sg * 8.4, sg * 8.46), Y03 + 1.5, 19.9, ZX(57.2), ZX(59.8))
    K.wdoor(S, sg * 7.55, Y01, ZX(58.0), '+x' if sg > 0 else '-x')
    K.wdoor(S, sg * 7.0, Y03, ZX(60.0), '+x' if sg > 0 else '-x')
    for k in range(3):
        K.raft_rack(S, sg * 7.9, Y01, ZX(46.5) + k * 1.9 + 16.0, n=1, along='z', side=sg)
    K.decoy_launcher(S, (sg * 6.6, Y01, ZX(64.0)), facing=sg)
    K.decoy_launcher(S, (sg * 6.6, Y01, ZX(66.5)), facing=sg)
# forward CIWS platform on the superstructure front (x 46.5, base 14.5)
S.box('Super', -2.3, 2.3, Y03 - 0.9, Y03 - 0.6, ZX(45.2), ZX(48.2))
S.box('Super', -1.2, 1.2, Y01, Y03 - 0.9, ZX(45.6), ZX(47.8))
K.rail(S, [(-2.3, Y03 - 0.6, ZX(45.2)), (2.3, Y03 - 0.6, ZX(45.2))], h=1.0, step=1.1)
# 05 level: the forward SPG-62 (x 55.5, dish 22.5), the Mk 20 EO sight, radomes
K.deckhouse(S, 3.0, 2.8, 18.0, 19.6, ZX(50.0), ZX(56.0))
K.spg62(S, (0.0, 19.6, ZX(55.2)))
S.sphere('White', (0.0, 20.2, ZX(51.0)), 0.5, 0.5, 0.5, 10, 6)
for sx in (-1, 1):
    K.radome(S, sx * 4.2, 19.4, ZX(63.5), 0.75)

# ═════════════ raked tripod mast (legs x 58–66, top x 64.5 at 43 m) ═════════════
MZ = ZX(64.5)
MT = (0.0, 35.5, MZ - 0.6)
for leg in ((0.0, 19.4, ZX(58.2)), (-3.0, 19.4, ZX(64.0)), (3.0, 19.4, ZX(64.0))):
    S.beam('Super', leg, MT, 0.45)
S.box('Super', -2.4, 2.4, 29.2, 29.5, MZ - 5.8, MZ - 2.4)                    # the SPS-67 platform
K.rail(S, [(-2.4, 29.5, MZ - 5.8), (2.4, 29.5, MZ - 5.8), (2.4, 29.5, MZ - 2.4), (-2.4, 29.5, MZ - 2.4)], h=0.9, step=1.2, closed=True)
S.box('Super', -1.7, 1.7, 25.6, 25.85, MZ - 3.2, MZ - 0.4)
S.beam('Super', (-6.2, 32.3, MZ - 1.2), (6.2, 32.3, MZ - 1.2), 0.28)
S.beam('Super', (-3.6, 34.6, MZ - 0.8), (3.6, 34.6, MZ - 0.8), 0.2)
S.cyl('Super', (0, 0, MZ - 0.6), 0.22, 0.12, 35.5, 42.3, 6)
S.cyl('White', (0, 0, MZ - 0.6), 0.55, 0.55, 39.6, 40.8, 10)                 # TACAN / UHF
S.cyl('Dark', (0, 0, MZ - 0.6), 0.04, 0.03, 42.3, 44.5, 4)
S.box('NavWhite', -0.18, 0.18, 38.0, 38.35, MZ - 1.1, MZ - 0.75)
for sx in (-1, 1):
    S.sphere('White', (sx * 1.6, 30.1, MZ - 4.5), 0.5, 0.5, 0.5, 10, 6)       # ESM domes
    S.beam('Dark', (sx * 5.8, 32.3, MZ - 1.2), (sx * 5.8, 30.2, MZ - 1.2), 0.05)
    S.beam('Dark', (sx * 3.3, 34.6, MZ - 0.8), (sx * 3.3, 33.2, MZ - 0.8), 0.04)
    S.box('White', sx * 1.9 - 0.3, sx * 1.9 + 0.3, 25.85, 26.6, MZ - 2.2, MZ - 1.4)   # SPS-73 navigation radars
S.box('Dark', -1.2, 1.2, 26.6, 26.8, MZ - 2.0, MZ - 1.6)

# ═════════════ funnels (x 68–76 and 85.5–93, tops ~20 m): raked, tapered, three exhausts under the cap ═════════════
def funnel(x0, x1, base=Y01):
    z0, z1 = ZX(x0), ZX(x1)
    rake = 1.0
    b = [(-3.3, base, z0), (3.3, base, z0), (3.3, base, z1), (-3.3, base, z1)]
    topy = 19.3
    tq = [(-2.6, topy, z0 + 1.2 + rake), (2.6, topy, z0 + 1.2 + rake), (2.6, topy, z1 - 0.3 + rake), (-2.6, topy, z1 - 0.3 + rake)]
    cz = (z0 + z1) / 2
    for i in range(4):
        j = (i + 1) % 4
        q = [b[i], b[j], tq[j], tq[i]]
        mx = (b[i][0] + b[j][0]) / 2; mz = (b[i][2] + b[j][2]) / 2
        S.g('Super').face(q, None, (mx, 0.2, mz - cz))
    S.g('Dark').face(tq, None, (0, 1, 0))
    for k in range(3):
        zz = z0 + 2.0 + rake + k * (z1 - z0 - 2.4) / 3
        S.cyl('Black', (0, 0, zz), 0.72, 0.72, topy - 0.2, topy + 0.9, 12)
        S.cyl('Dark', (0, 0, zz), 0.58, 0.58, topy + 0.9, topy + 0.92, 12, cap0=False)
    S.box('Super', -2.85, 2.85, topy - 0.3, topy, z0 + 1.0 + rake, z1 - 0.1 + rake)
    for sg in (1, -1):
        for k in range(4):
            yy = 12.0 + k * 1.1
            S.box('Dark', min(sg * 3.2, sg * 3.32), max(sg * 3.2, sg * 3.32), yy, yy + 0.6, z0 + 1.4, z1 - 1.6)
funnel(68.0, 76.0)
funnel(85.5, 93.0)
# 02-level houses between and behind the funnels
K.deckhouse(S, 5.4, 5.1, Y01, Y02, ZX(76.0), ZX(85.5))
K.deckhouse(S, 5.0, 4.7, Y01, Y02, ZX(93.0), ZX(106.0), chamfer_back=1.5)
# Mk 32 torpedo tubes behind the side shutters (x ~72, 7.5 m; DDG-79 to 90)
for sg in (1, -1):
    xh = 8.32
    S.g('Dark').face([(sg * xh, MAIN + 0.2, ZX(70.5)), (sg * xh, MAIN + 0.2, ZX(74.0)), (sg * xh, Y01 - 0.3, ZX(74.0)), (sg * xh, Y01 - 0.3, ZX(70.5))], None, (sg, 0, 0))
    K.svtt(S, (sg * 6.6, MAIN, ZX(72.2)), facing=sg)
    # Mk 38 Mod 2 25 mm on the 01-level edges (x 83–86), life rafts along the 01 deck
    K.mk38(S, (sg * 6.9, Y01, ZX(84.5)))
    for k in range(4):
        K.raft_rack(S, sg * 7.9, Y01, ZX(94.5) + k * 1.8, n=1, along='z', side=sg)
    for k in range(3):
        K.raft_rack(S, sg * 7.9, Y01, ZX(77.0) + k * 1.8, n=1, along='z', side=sg)
# refuelling-at-sea station (starboard, abreast the forward funnel): kingpost with the probe receiver
S.box('Super', 7.1, 7.7, Y01, Y01 + 5.0, ZX(79.8), ZX(80.4))
S.box('Dark', 7.1, 8.3, Y01 + 3.4, Y01 + 3.8, ZX(79.9), ZX(80.3))

# ═════════════ the two RHIBs in tandem in the starboard boat bay (x 90–107), one davit (x 98) ═════════════
K.rhib7(S, (7.3, MAIN + 0.8, ZX(94.0)), yaw=0.0)
K.rhib7(S, (7.3, MAIN + 0.8, ZX(102.5)), yaw=0.0)
for zz in (ZX(91.5), ZX(96.5), ZX(100.0), ZX(105.0)):
    S.box('Super', 6.3, 8.3, MAIN, MAIN + 0.7, zz - 0.25, zz + 0.25)
K.davit(S, (5.9, Y01, ZX(98.0)), side=1, h=4.2, reach=2.4)

# ═════════════ aft SPG-62s (x 96.5 and 100, dishes 19.5 and 17), aft Phalanx (x 104.5), hangar top ═════════════
S.box('Super', 1.2, 4.6, Y02, 15.4, ZX(95.0), ZX(98.5))
S.box('Super', -4.6, -1.2, Y02, 13.1, ZX(98.5), ZX(102.0))
K.spg62(S, (2.9, 15.4, ZX(96.5)), face_yaw=math.pi)
K.spg62(S, (-2.9, 13.1, ZX(100.0)), face_yaw=math.pi)
S.box('Super', -2.0, 2.0, Y01, 11.5, ZX(103.0), ZX(106.2))                   # the aft CIWS pedestal
K.rail(S, [(-2.0, 11.5, ZX(106.2)), (2.0, 11.5, ZX(106.2))], h=1.0, step=1.0)
# helicopter control station (x 129–132, ~11 m) aft of the launcher, between the hangars
K.deckhouse(S, 1.8, 1.7, Y01, 11.6, ZX(129.2), ZX(132.4))
S.g('Glass').face([(-1.6, 10.4, ZX(132.4) + 0.02), (1.6, 10.4, ZX(132.4) + 0.02), (1.55, 11.3, ZX(132.4) + 0.02), (-1.55, 11.3, ZX(132.4) + 0.02)], None, (0, 0, 1))
for sx in (-1, 1):
    K.radome(S, sx * 5.2, Y01, ZX(115.0), 0.9)                                   # SATCOM radomes on the hangar roof
    K.whip(S, sx * 7.2, Y01, ZX(127.0), 6.0)
S.cyl('Super', (0, 0, ZX(114.0)), 0.18, 0.1, Y01, 18.0, 6)                       # aft pole mast
S.beam('Super', (-2.2, 16.5, ZX(114.0)), (2.2, 16.5, ZX(114.0)), 0.15)
S.box('NavWhite', -0.12, 0.12, 17.6, 17.9, ZX(113.9), ZX(114.2))
# flight deck: RAST track, deck-edge nets (folded out), the stern flap
S.box('Dark', -0.3, 0.3, FD + 0.11, FD + 0.14, Z01B + 0.5, STERN - 1.0)
for sg in (1, -1):
    for z in range(int(Z01B) + 2, int(STERN) - 1, 3):
        e = K.edge_at(top, float(z))
        S.box('Dark', min(sg * e[0], sg * (e[0] + 1.1)), max(sg * e[0], sg * (e[0] + 1.1)), e[1] - 0.2, e[1] - 0.15, z - 1.4, z + 1.4)
S.box('Hull', -5.0, 5.0, -1.4, -0.9, STERN - 0.2, STERN + 1.2, uvf=hull_uv)
# hull number on the bow (white with dark shadow)
if FONT:
    for sg in (1, -1):
        zc = ZX(17.5)
        x = hull_x_at(zc, 5.8)
        ex = (0, 0, -1) if sg > 0 else (0, 0, 1)
        add_text(S, 'White', HULL_NO, 3.2, FONT, (sg * (x + 0.08), 5.8, zc), ex, (0, 1, 0), (sg, 0, 0), 0.03)
        add_text(S, 'Dark', HULL_NO, 3.2, FONT, (sg * (x + 0.05), 5.65, zc + ex[2] * 0.15), ex, (0, 1, 0), (sg, 0, 0), 0.03)
    # a starboard hawse pipe at x ~4, 7 m up
    xh = hull_x_at(ZX(4.5), 7.2)
    S.box('Black', xh - 0.02, xh + 0.06, 6.8, 7.6, ZX(4.2), ZX(5.0))

# ═════════════ underwater: shafts, struts, propellers, rudders ═════════════
for sx in (-4.6, 4.6):
    S.beam('Hull', (sx * 0.7, -4.4, 38.0), (sx, -4.6, 61.0), 0.5)
    S.beam('Hull', (sx, -4.6, 57.0), (sx * 0.9, -1.8, 56.0), 0.35, 0.8)
    S.cyl('Dark', (sx, -4.6, 0), 0.45, 0.2, 61.0, 62.4, 8, axis='z')
    for b in range(5):
        a = 2 * math.pi * b / 5
        S.beam('Dark', (sx, -4.6, 61.7), (sx + 2.5 * math.cos(a), -4.6 + 2.5 * math.sin(a), 61.9), 0.8, 0.1)
    S.box('Hull', sx - 0.3, sx + 0.3, -5.6, -1.4, 65.0, 69.5, uvf=hull_uv)

# ═════════════ detail: superstructure rails and stairs, deck-edge cleats, hose stations, buoys, antennas ═════════════
K.rail(S, [(-7.2, Y03, ZF1), (7.2, Y03, ZF1)], h=1.0, step=1.5)                                   # 03 aft ledge
K.rail(S, [(-6.3, 18.0, ZX(48.6)), (-6.6, 18.0, ZX(50.0)), (-3.0, 18.0, ZX(50.0))], h=1.0, step=1.2)
K.rail(S, [(6.3, 18.0, ZX(48.6)), (6.6, 18.0, ZX(50.0)), (3.0, 18.0, ZX(50.0))], h=1.0, step=1.2)
K.rail(S, [(-3.0, 19.6, ZX(50.0)), (3.0, 19.6, ZX(50.0)), (3.0, 19.6, ZX(56.0)), (-3.0, 19.6, ZX(56.0))], h=0.9, step=1.2, closed=True)
for (z0, z1, xh) in ((ZX(76.0), ZX(85.5), 5.1), (ZX(93.0), ZX(106.0), 4.7)):
    K.rail(S, [(-xh, Y02, z0), (xh, Y02, z0), (xh, Y02, z1), (-xh, Y02, z1)], h=1.0, step=1.6, closed=True)
for sg in (1, -1):
    K.stair(S, (sg * 6.2, Y01, ZX(88.6)), (sg * 5.3, Y02, ZX(86.0)))
    if sg < 0:                                   # (the starboard side there is the boat bay)
        K.stair(S, (sg * 6.0, Y01, ZX(107.6)), (sg * 4.9, Y02, ZX(105.0)))
    # cleats and chocks along the main deck edges, fire-hose stations and ring buoys on the deckhouse sides
    for x in range(52, 128, 9):
        e = K.edge_at(top, ZX(x))
        K.cleat(S, sg * (e[0] - 0.45), e[1] + 0.05, ZX(x))
    for x in (6.0, 12.0, 22.0, 33.0):
        e = K.edge_at(top, ZX(x))
        K.cleat(S, sg * (e[0] - 0.5), e[1] + 0.05, ZX(x))
    for x in (54.0, 70.0, 99.0, 118.0):
        K.hose_reel(S, sg * 8.3, MAIN, ZX(x), '+x' if sg > 0 else '-x')
    for x in (51.0, 78.0, 112.0, 124.0):
        e = K.edge_at(top, ZX(x))
        K.lifebuoy(S, sg * (e[0] - 0.1), e[1] + 0.75, ZX(x), '+x' if sg > 0 else '-x')
    # whip and wire antennas on the superstructure and hangar edges
    for (x, y, h) in ((58.5, 19.4, 5.5), (63.0, 19.4, 6.5), (98.0, Y02, 7.0), (110.0, Y01, 6.0), (126.0, Y01, 5.0)):
        K.whip(S, sg * (5.6 if y > 15 else 7.4), y, ZX(x), h, r=0.045)
    S.beam('Dark', (sg * 5.6, 19.4 + 5.2, ZX(58.5)), (sg * 1.0, 32.3, MZ - 1.2), 0.02, caps=False)     # halyard / wire
    for k in range(3):                                                          # dipoles on the yardarm
        S.beam('Dark', (sg * (2.4 + k * 1.3), 32.3, MZ - 1.2), (sg * (2.4 + k * 1.3), 33.6, MZ - 1.2), 0.035, caps=False)
# the forward CIWS platform's ladder, the chain stopper, VERTREP lights on the forecastle
K.stair(S, (0.0, Y01, ZX(49.4)), (0.0, Y03 - 0.6, ZX(47.3)))
S.box('Dark', 1.2, 2.0, deck_y(ZX(7.0)), deck_y(ZX(7.0)) + 0.25, ZX(6.4), ZX(7.8))
for x in (17.0, 27.0):
    for sg in (1, -1):
        e = K.edge_at(top, ZX(x))
        S.box('NavWhite', sg * (e[0] - 0.6) - 0.08, sg * (e[0] - 0.6) + 0.08, e[1], e[1] + 0.1, ZX(x) - 0.08, ZX(x) + 0.08)

root = bpy.data.objects.new('destroyer', None)
bpy.context.collection.objects.link(root)

# ═════════════ Mk 41 VLS: forward 32 cells on a plinth, aft 64 cells between the hangars ═════════════
door_me = K.mk41_door_mesh()
upt_me = K.mk41_uptake_mesh()
cell_no, upt_no = 1, 1
vls_layout = []
for Ln in LAUNCHERS:
    if Ln['name'] == 'fore':
        # on a plinth a little above the cambered deck (its highest point, forward, plus the camber)
        ytop = max(deck_y(Ln['z0'] - 0.3), deck_y(Ln['z0'] + Ln['Lz'] + 0.3)) + 0.18 + 0.4
        plinth = lambda z: deck_y(z) + 0.18
    else:
        ytop = Y01 + 0.03
        plinth = None
    first = cell_no
    cell_no, upt_no, cells = K.mk41_launcher(S, root, Ln['x0'], Ln['z0'], Ln['nx'], Ln['nz'], ytop, cell_no, upt_no, door_me, upt_me,
                                             crane=Ln.get('crane'), along=Ln['along'], mat='VLS', deck='Dark', plinth=plinth)
    vls_layout.append({'name': Ln['name'], 'cells': [first, cell_no - 1], 'top': round(ytop, 2)})
    Ln['ytop'] = ytop
S.build(parent=root)

# ═════════════ rotating radar: SPS-67 on the mast platform ═════════════
R = Part('radar')
piv = (0.0, 29.5, MZ - 4.1)
R.cyl('Super', (piv[0], 0, piv[2]), 0.25, 0.25, piv[1], piv[1] + 0.5, 8)
R.box('Dark', -1.9, 1.9, piv[1] + 0.5, piv[1] + 1.0, piv[2] - 0.35, piv[2] + 0.15)
R.box('Super', -0.3, 0.3, piv[1] + 0.3, piv[1] + 0.55, piv[2] - 0.2, piv[2] + 0.3)
R.build(origin=piv, parent=root)

# ═════════════ hangar roller doors (rig), mounts ═════════════
for i, (x0, x1) in enumerate(((-6.4, -1.1), (1.1, 6.4))):
    Dp = Part('door_hangar_%d' % (i + 1))
    Dp.box('Super', x0, x1, FD + 0.05, 8.6, Z01B + 0.02, Z01B + 0.12)
    for k in range(1, 7):
        yy = FD + k * (8.6 - FD) / 7
        Dp.box('Dark', x0 + 0.1, x1 - 0.1, yy - 0.025, yy + 0.025, Z01B + 0.12, Z01B + 0.14)
    K.sliding(Dp, 'door_hangar_%d' % (i + 1), ((x0 + x1) / 2, FD + 0.05, Z01B + 0.07), root, (0, 1, 0), 8.6 - FD - 0.3, t='door')

layout_mounts = []
def mount(typ, n, o, fn):
    name = 'mount_%s_%d' % (typ, n)
    if fn:
        P_ = Part(name)
        fn(P_, o)
        P_.build(origin=o, parent=root)
    else:
        K.rig_node(name, None, o, root)          # a SAM "mount" is where the missiles leave: an empty
    layout_mounts.append({'type': typ, 'x': round(o[0], 2), 'y': round(o[1], 2), 'z': round(o[2], 2), 'node': name})
mount('gun', 0, (0.0, deck_y(ZX(30.0)) + 0.18, ZX(30.0)), K.mk45)
mount('sam', 0, (0.0, FWD['ytop'], FWD['zc']), None)
mount('sam', 1, (0.0, AFT['ytop'], AFT['zc']), None)
mount('ciws', 0, (0.0, Y03 - 0.6, ZX(46.5)), K.phalanx)
mount('ciws', 1, (0.0, 11.5, ZX(104.5)), K.phalanx)

layout = {
    'version': 1, 'deckY': 8.0, 'shadowY': Y01, 'L': LOA, 'draft': -KEEL,
    'deck': [[x, z] for x, z in deck_outline],
    'waterline': [[x, z] for x, z in waterline],
    'vls': vls_layout,
    'flightDeck': [round(Z01B, 2), round(STERN, 2)],
    'mounts': layout_mounts,
}
root['skywar'] = json.dumps(layout, separators=(',', ':'))
print('destroyer tris ~', S.tris(), ' radar', R.tris(), 'cells', cell_no - 1, 'uptakes', upt_no - 1)
os.makedirs(os.path.dirname(os.path.abspath(OUT)), exist_ok=True)
bpy.ops.export_scene.gltf(filepath=OUT, export_format='GLB', export_extras=True, export_yup=True,
                          export_materials='EXPORT', export_image_format='AUTO', export_cameras=False, export_lights=False)
print('exported', OUT, os.path.getsize(OUT) // 1024, 'KB')
