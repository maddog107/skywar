# ═══════════════════════════════════════════════════════════════
# Arleigh Burke-class (Flight IIA) guided-missile destroyer — scripted model for Blender:
#   python3 tools/ships/ship_textures.py /tmp/shiptex && python3 tools/ships/fleet_textures.py /tmp/shiptex
#   blender -b -P tools/ships/destroyer_model.py -- /tmp/shiptex models/ships/destroyer.glb
# Game frame (shipkit.py): x starboard, y up (0 = waterline), bow −z. naval.js TYPES.destroyer: L 155, B 20,
# deckY 8; mounts: gun (0, deck, −58), VLS "sam" fore and aft, CIWS fore and on the hangar.
# Reference: LOA 155.3 m, beam 20.1 m (flared deck edge), hull draught ~6.3 m (9.4 m at the sonar dome), sheer
# rising to ~11 m at the stem; Mk 41 VLS fore (32 cells) and aft (64 cells) as 8-cell modules, Mk 45 Mod 4, two
# funnels, four SPY-1D faces, SPG-62 illuminators (1 fwd, 2 aft), Mk 38 25 mm guns, Mk 32 torpedo tubes, twin
# hangars and flight deck (Flight IIA). Sources: tools/ships/RIG.md.
# Rig (tools/ships/RIG.md): vls_1..96 cell doors (shared mesh, drawn instanced), cell_1..96 (fore 1–32, aft
# 33–96; +Y up), uptake_1..12, door_hangar_1..2 (roller doors), radar (SPS-67), turrets mount_*.
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
material('VLS', srgb(0x575c61), 0.1, 0.78)       # deck grey, as the real hatches
material('Canister', srgb(0x3a3f44), 0.1, 0.7)
material('Tube', srgb(0x5d6166), 0.0, 0.8)
material('Black', srgb(0x161718), 0.1, 0.6)
material('Orange', srgb(0xff6a10), 0.0, 0.6)
material('Under', srgb(0x74879a), 0.04, 0.7)
material('NavRed', srgb(0xff2020), 0.0, 0.5, emit=srgb(0xff2020), emit_strength=5.0)
material('NavGreen', srgb(0x20ff50), 0.0, 0.5, emit=srgb(0x20ff50), emit_strength=5.0)
material('NavWhite', srgb(0xffffff), 0.0, 0.5, emit=srgb(0xfff4e0), emit_strength=5.0)

L = 155.0
BOW, STERN = -77.5, 77.5
KEEL = -6.3
DX0, DX1, DZ0, DZ1 = -11.0, 11.0, -78.0, 78.0
H = FT.HULLS['destroyer']
def deck_uv(x, y, z):
    return ((x - DX0) / (DX1 - DX0), (DZ1 - z) / (DZ1 - DZ0))
def hull_uv(x, y, z):
    return ((z - H['z0']) / (H['z1'] - H['z0']), (y - H['y0']) / (H['y1'] - H['y0']))

# ── Mk 41 launchers: (x0 ignored: centred), nx × nz modules, rows along 'along', centre z, which module is the crane ──
LAUNCHERS = [
    dict(name='fore', nx=2, nz=2, along='z', zc=-42.2),
    dict(name='aft', nx=4, nz=2, along='z', zc=43.0),
]

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
def hb(s, y, z=None):
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
# ═════════════ hull ═════════════
TS = [0.0, 0.03, 0.08, 0.15, 0.25, 0.36, 0.44, 0.5, 0.58, 0.68, 0.8, 0.9, 1.0]
grid = K.loft_hull(S, TS, 90, KEEL, sheer, stem_z, stern_z, hb, mat='Hull', uvf=hull_uv)
S.sphere('Hull', (0.0, -7.2, -60.0), 2.1, 2.3, 9.0, nu=12, nv=8, uvf=hull_uv)            # sonar dome
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

# ── Mk 41 launcher geometry (sizes from navkit.MK41) ──
for Ln in LAUNCHERS:
    W_, Lz_ = K.mk41_launcher_size(Ln['nx'], Ln['nz'], Ln['along'])
    Ln['x0'] = -W_ / 2
    Ln['z0'] = Ln['zc'] - Lz_ / 2
    Ln['W'], Ln['Lz'] = W_, Lz_
FWD, AFT = LAUNCHERS
# main deck, with the forward launcher's opening cut out (it stands in the hole, coaming round it)
K.deck_strip(S, top, 0.18, 'Deck', deck_uv, holes=[(FWD['W'] / 2 + 0.33, FWD['z0'] - 0.33, FWD['z0'] + FWD['Lz'] + 0.33)])
# deck-edge rails from the bow to the hangar and round the flight deck (with the stern open for the RAST)
for sg in (1, -1):
    pts = [(sg * (p[0] - 0.12), p[1] + 0.02, p[2]) for p in top[2:-1] if p[2] < 76.0]
    K.rail(S, pts[::2] + [pts[-1]], h=1.05, step=1.8)

# ═════════════ forecastle: windlasses, chains, bollards, breakwater, jackstaff ═════════════
for sg in (1, -1):
    y = deck_y(-67.0) + 0.1
    S.cyl('Dark', (sg * 1.6, 0, -66.5), 0.55, 0.55, y, y + 0.7, 12)
    S.cyl('Dark', (sg * 1.6, y + 0.5, 0), 0.35, 0.35, -67.3, -65.7, 10, axis='z')
    S.beam('Black', (sg * 1.6, y + 0.02, -67.2), (sg * 3.2, deck_y(-71.0) + 0.1, -71.0), 0.3, 0.08)   # chain to the hawse pipe
    for z in (-73.0, -60.5, -50.0, -36.0):
        e = K.edge_at(top, z)
        K.bollard(S, sg * (e[0] - 1.0), e[1] + 0.12, z)
    # breakwater ahead of the forward VLS
    S.beam('Super', (0.0, deck_y(-51.5) + 0.6, -52.8), (sg * 5.6, deck_y(-48.5) + 0.6, -48.0), 1.2, 0.18)
K.whip(S, 0, deck_y(-76.5), -76.5, 4.5, mat='Super', r=0.08)          # jackstaff
S.box('NavWhite', -0.1, 0.1, deck_y(-76.5) + 4.3, deck_y(-76.5) + 4.5, -76.6, -76.4)

# ═════════════ the 01 deckhouse: forward superstructure → hangar; aft launcher sunk into its roof ═════════════
Y01 = 11.6
r0, r1 = K.deckhouse(S, 8.0, 7.6, 6.0, Y01, -30.0, 62.0, chamfer_front=2.5, top=False)
# the 01 roof: a plate with the aft launcher's opening (and the chamfered front as its own polygon)
zf = -30.0 + 2.5 * 7.6 / 8.0
S.g('Deck').face([(-7.6 + 2.5 * 7.6 / 8.0, Y01, -30.0), (7.6 - 2.5 * 7.6 / 8.0, Y01, -30.0), (7.6, Y01, zf), (-7.6, Y01, zf)],
                 [deck_uv(-7.6, Y01, -30.0)] * 4, (0, 1, 0))
K.plate_with_holes(S, 'Deck', -7.6, 7.6, zf, 62.0, Y01, [(AFT['x0'] - 0.33, AFT['x0'] + AFT['W'] + 0.33, AFT['z0'] - 0.33, AFT['z0'] + AFT['Lz'] + 0.33)],
                   depth=0.6, wall='Super', bottom='Dark', uvf=deck_uv)
for sg in (1, -1):
    K.rail(S, [(sg * 7.55, Y01, -22.0), (sg * 7.55, Y01, 46.0)], h=1.0, step=1.8)

# ═════════════ forward superstructure (02–04 levels), SPY-1D faces, bridge ═════════════
K.deckhouse(S, 7.4, 6.8, Y01, 17.6, -27.0, 4.0, chamfer_front=4.2)
for sg in (1, -1):
    K.spy_face(S, (sg * 5.0, 14.8, -25.2), (sg * 0.707, -0.707), size=3.8, tilt=math.radians(-6))
K.deckhouse(S, 6.8, 6.5, 17.6, 20.6, -24.0, -4.0, chamfer_front=1.4)
S.g('Glass').face([(-5.3, 18.6, -24.05), (5.3, 18.6, -24.05), (5.2, 20.1, -24.05), (-5.2, 20.1, -24.05)], None, (0, 0, -1))
for sg in (1, -1):
    x = sg * 6.72
    S.g('Glass').face([(x, 18.6, -22.4), (x, 18.6, -16.0), (x, 20.1, -16.0), (x, 20.1, -22.4)], None, (sg, 0, 0))
    S.box('Super', min(sg * 6.6, sg * 9.4), max(sg * 6.6, sg * 9.4), 17.6, 17.85, -23.0, -17.0)     # bridge wings
    K.rail(S, [(sg * 6.6, 17.85, -23.0), (sg * 9.4, 17.85, -23.0), (sg * 9.4, 17.85, -17.0), (sg * 6.6, 17.85, -17.0)], h=1.0, step=1.2)
    S.box('Glass', min(sg * 9.0, sg * 9.3), max(sg * 9.0, sg * 9.3), 18.2, 19.2, -22.6, -21.8)   # pelorus / wing console
for k in range(1, 8):
    x = -5.3 + k * 10.6 / 8
    S.box('Super', x - 0.06, x + 0.06, 18.6, 20.1, -24.12, -24.02)
S.box('Super', -5.6, 5.6, 20.1, 20.25, -24.4, -24.0)                  # sun visor over the bridge windows
K.deckhouse(S, 4.2, 3.9, 20.6, 22.4, -20.0, -8.0)
S.box('NavRed', -9.55, -9.2, 17.85, 18.2, -21.0, -20.5)
S.box('NavGreen', 9.2, 9.55, 17.85, 18.2, -21.0, -20.5)
# 02–03 level detail: doors, SLQ-32 electronic-warfare arrays either side, SRBOC decoy launchers, signal lamps
for sg in (1, -1):
    K.wdoor(S, sg * 7.9, 6.0, -12.0, '+x' if sg > 0 else '-x')
    K.wdoor(S, sg * 7.05, Y01, -6.0, '+x' if sg > 0 else '-x')
    # SLQ-32(V)3 / SEWIP: a tall sloped box on the 03 level side, aft of the SPY face
    S.box('Super', min(sg * 7.0, sg * 8.3), max(sg * 7.0, sg * 8.3), 13.2, 16.4, -19.0, -14.6)
    S.box('Array', min(sg * 8.3, sg * 8.36), max(sg * 8.3, sg * 8.36), 13.5, 16.1, -18.7, -14.9)
    S.box('Super', min(sg * 7.0, sg * 8.1), max(sg * 7.0, sg * 8.1), 16.4, 17.0, -18.4, -15.2)
    K.decoy_launcher(S, (sg * 6.2, Y01, -1.0), facing=sg)
    K.decoy_launcher(S, (sg * 6.2, Y01, 1.6), facing=sg)
    K.searchlight(S, sg * 8.6, 17.85, -20.0)
    for k in range(3):                                                  # life rafts on the 01 level, forward
        K.raft_rack(S, sg * 7.6, Y01, -3.5 - k * 2.1 + 9.5, n=1, along='z', side=sg)
# the forward CIWS platform in front of the bridge (02 level)
S.box('Super', -2.2, 2.2, 14.6, 15.0, -30.2, -26.6)
K.rail(S, [(-2.2, 15.0, -30.2), (2.2, 15.0, -30.2)], h=1.0, step=1.1)
# forward SPG-62 illuminator on top of the bridge block, the Mk 99 director / EO sight
K.spg62(S, (0.0, 22.4, -16.5))
S.box('Super', -1.0, 1.0, 22.4, 23.0, -12.5, -10.5)
S.sphere('White', (0.0, 23.5, -11.5), 0.55, 0.55, 0.55, 10, 6)

# ═════════════ mast: raked tripod, platforms and yards (the SPS-67 is the rotating "radar") ═════════════
MT = (0.0, 36.0, -9.5)
for leg in ((0.0, 22.4, -18.5), (-3.2, 22.4, -9.0), (3.2, 22.4, -9.0)):
    S.beam('Super', leg, MT, 0.45)
S.box('Super', -2.4, 2.4, 29.6, 29.9, -15.2, -11.6)
K.rail(S, [(-2.4, 29.9, -15.2), (2.4, 29.9, -15.2), (2.4, 29.9, -11.6), (-2.4, 29.9, -11.6)], h=0.9, step=1.2, closed=True)
S.box('Super', -1.6, 1.6, 26.0, 26.25, -12.4, -9.6)
S.beam('Super', (-6.0, 32.5, -10.5), (6.0, 32.5, -10.5), 0.28)
S.beam('Super', (-3.5, 35.0, -9.8), (3.5, 35.0, -9.8), 0.2)
S.cyl('Super', (0, 0, -9.5), 0.22, 0.12, 36.0, 43.0, 6)
S.cyl('White', (0, 0, -9.5), 0.55, 0.55, 40.5, 41.7, 10)               # TACAN / UHF
S.cyl('Dark', (0, 0, -9.5), 0.04, 0.03, 43.0, 46.0, 4)
S.box('NavWhite', -0.18, 0.18, 38.6, 38.95, -9.95, -9.6)
for sx in (-1, 1):
    S.sphere('White', (sx * 1.6, 30.5, -13.0), 0.5, 0.5, 0.5, 10, 6)     # ESM domes
    S.beam('Dark', (sx * 5.6, 32.5, -10.5), (sx * 5.6, 30.4, -10.5), 0.05)
    S.beam('Dark', (sx * 3.2, 35.0, -9.8), (sx * 3.2, 33.6, -9.8), 0.04)
    S.box('White', sx * 1.9 - 0.3, sx * 1.9 + 0.3, 26.25, 27.0, -11.4, -10.6)   # SPS-73 / nav radars
S.box('Dark', -1.2, 1.2, 27.0, 27.2, -11.2, -10.8)

# ═════════════ funnels (raked, tapered, three exhausts each under the cap) ═════════════
def funnel(z0, z1):
    rake = 1.2
    base = [(-3.4, Y01, z0), (3.4, Y01, z0), (3.4, Y01, z1), (-3.4, Y01, z1)]
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
        S.cyl('Black', (0, 0, zz), 0.75, 0.75, topy - 0.2, topy + 1.0, 12)
        S.cyl('Dark', (0, 0, zz), 0.6, 0.6, topy + 1.0, topy + 1.02, 12, cap0=False)
    S.box('Super', -2.9, 2.9, topy - 0.3, topy, z0 + 1.2 + rake, z1 - 0.2 + rake)
    for sg in (1, -1):                   # intake louvres on the funnel sides
        for k in range(4):
            y = 13.0 + k * 1.1
            S.box('Dark', min(sg * 3.3, sg * 3.42), max(sg * 3.3, sg * 3.42), y, y + 0.6, z0 + 1.6, z1 - 1.8)
funnel(5.5, 15.0)
funnel(30.5, 39.5)

# ═════════════ amidships: boats and davit, torpedo tubes, rafts, the refuelling station ═════════════
for sg in (1, -1):
    K.rhib7(S, (sg * 6.0, Y01 + 1.3, 20.5), yaw=0.0)
    S.box('Super', min(sg * 4.6, sg * 7.4), max(sg * 4.6, sg * 7.4), Y01, Y01 + 0.9, 17.2, 17.8)
    S.box('Super', min(sg * 4.6, sg * 7.4), max(sg * 4.6, sg * 7.4), Y01, Y01 + 0.9, 23.2, 23.8)
    K.svtt(S, (sg * 5.4, 6.0, 26.5), facing=sg)                      # Mk 32 tubes in the 01-level recess
    S.g('Dark').face([(sg * 7.72, 6.0, 24.8), (sg * 7.72, 6.0, 28.4), (sg * 7.72, 9.4, 28.4), (sg * 7.72, 9.4, 24.8)], None, (sg, 0, 0))
K.davit(S, (6.8, Y01, 17.0), side=1, h=3.6, reach=2.4)
K.davit(S, (-6.8, Y01, 17.0), side=-1, h=3.6, reach=2.4)
for sg in (1, -1):
    for k in range(4):
        K.raft_rack(S, sg * 7.55, Y01, 24.5 + k * 1.5, n=1, along='z', side=sg)
    # Mk 38 Mod 2 25 mm guns on the 01 level, either side abaft the forward superstructure
    K.mk38(S, (sg * 6.0, Y01, 2.5 + 0.0 * sg))
# refuelling-at-sea station (starboard): kingpost with the probe receiver
S.box('Super', 7.0, 7.6, Y01, Y01 + 5.0, 27.8, 28.4)
S.box('Dark', 7.0, 8.2, Y01 + 3.4, Y01 + 3.8, 27.9, 28.3)

# ═════════════ hangars (Flight IIA), aft SPY faces, SPG-62s, aft mast ═════════════
K.deckhouse(S, 7.8, 7.2, Y01, 14.4, 46.0, 62.0)
K.deckhouse(S, 5.8, 5.4, 14.4, 19.2, 46.0, 53.5, chamfer_back=3.0)
for sg in (1, -1):
    K.spy_face(S, (sg * 4.4, 17.0, 52.3), (sg * 0.707, 0.707), size=3.8, tilt=math.radians(-6))
    K.spg62(S, (sg * 3.4, 14.4, 58.0), face_yaw=math.pi)
    # the hangar-door frames aft (the doors are rig nodes)
    S.g('Dark').face([(sg * 0.6, deck_y(62) + 0.1, 62.02), (sg * 6.6, deck_y(62) + 0.1, 62.02), (sg * 6.6, 13.0, 62.02), (sg * 0.6, 13.0, 62.02)], None, (0, 0, 1))
    S.box('Super', min(sg * 0.4, sg * 0.7), max(sg * 0.4, sg * 0.7), deck_y(62), 13.4, 62.0, 62.3)
    S.box('Super', min(sg * 6.6, sg * 7.0), max(sg * 6.6, sg * 7.0), deck_y(62), 13.4, 62.0, 62.3)
    for k in range(3):
        K.raft_rack(S, sg * 7.7, Y01, 47.0 + k * 1.8, n=1, along='z', side=sg)
S.box('Super', -7.0, 7.0, 13.0, 13.4, 62.0, 62.3)
S.g('Glass').face([(-1.5, 15.2, 62.02), (1.5, 15.2, 62.02), (1.5, 16.2, 62.02), (-1.5, 16.2, 62.02)], None, (0, 0, 1))   # LSO / flight control window
S.cyl('Super', (0, 0, 49.5), 0.2, 0.12, 19.2, 26.0, 6)                # aft pole mast
S.beam('Super', (-2.5, 24.0, 49.5), (2.5, 24.0, 49.5), 0.15)
S.box('NavWhite', -0.12, 0.12, 25.6, 25.9, 49.4, 49.7)
for sx in (-1, 1):
    K.radome(S, sx * 2.6, 19.2, 50.5, 0.9)                             # SATCOM radomes on the hangar roof
# flight deck: RAST track, deck-edge nets (folded out), landing lights
S.box('Dark', -0.3, 0.3, deck_y(70) + 0.01, deck_y(70) + 0.04, 62.5, 76.0)
for sg in (1, -1):
    for z in range(63, 77, 3):
        e = K.edge_at(top, float(z))
        S.box('Dark', min(sg * e[0], sg * (e[0] + 1.1)), max(sg * e[0], sg * (e[0] + 1.1)), e[1] - 0.2, e[1] - 0.15, z - 1.4, z + 1.4)
# hull number on the bow (white with dark shadow)
if FONT:
    for sg in (1, -1):
        zc = -58.0
        x = hull_x_at(zc, 6.4)
        ex = (0, 0, -1) if sg > 0 else (0, 0, 1)
        add_text(S, 'White', HULL_NO, 3.2, FONT, (sg * (x + 0.08), 6.4, zc), ex, (0, 1, 0), (sg, 0, 0), 0.03)
        add_text(S, 'Dark', HULL_NO, 3.2, FONT, (sg * (x + 0.05), 6.25, zc + ex[2] * 0.15), ex, (0, 1, 0), (sg, 0, 0), 0.03)

# ═════════════ underwater: shafts, struts, propellers, rudders ═════════════
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

# ═════════════ Mk 41 VLS: fore 32 cells, aft 64 (rigged doors, uptakes, cells) ═════════════
door_me = K.mk41_door_mesh()
upt_me = K.mk41_uptake_mesh()
cell_no, upt_no = 1, 1
vls_layout = []
for Ln in LAUNCHERS:
    if Ln['name'] == 'fore':
        # the launcher top a little above the deck's highest point over its footprint
        ytop = max(deck_y(Ln['z0']), deck_y(Ln['z0'] + Ln['Lz'])) + 0.18 + 0.05
    else:
        ytop = Y01 + 0.05
    first = cell_no
    cell_no, upt_no, cells = K.mk41_launcher(S, root, Ln['x0'], Ln['z0'], Ln['nx'], Ln['nz'], ytop, cell_no, upt_no, door_me, upt_me,
                                             crane=Ln.get('crane'), along=Ln['along'], mat='VLS', deck='Dark')
    vls_layout.append({'name': Ln['name'], 'cells': [first, cell_no - 1], 'top': round(ytop, 2)})
    Ln['ytop'] = ytop
S.build(parent=root)

# ═════════════ rotating radar: SPS-67 on the mast platform ═════════════
R = Part('radar')
piv = (0.0, 29.9, -13.4)
R.cyl('Super', (piv[0], 0, piv[2]), 0.25, 0.25, piv[1], piv[1] + 0.5, 8)
R.box('Dark', -1.9, 1.9, piv[1] + 0.5, piv[1] + 1.0, piv[2] - 0.35, piv[2] + 0.15)
R.box('Super', -0.3, 0.3, piv[1] + 0.3, piv[1] + 0.55, piv[2] - 0.2, piv[2] + 0.3)
R.build(origin=piv, parent=root)

# ═════════════ hangar roller doors (rig), mounts ═════════════
for i, sg in enumerate((-1, 1)):
    Dp = Part('door_hangar_%d' % (i + 1))
    x0, x1 = sorted((sg * 0.7, sg * 6.6))
    y0 = deck_y(62) + 0.1
    Dp.box('Super', x0, x1, y0, 13.0, 62.03, 62.13)
    for k in range(1, 7):
        yy = y0 + k * (13.0 - y0) / 7
        Dp.box('Dark', x0 + 0.1, x1 - 0.1, yy - 0.025, yy + 0.025, 62.13, 62.15)
    K.sliding(Dp, 'door_hangar_%d' % (i + 1), ((x0 + x1) / 2, y0, 62.08), root, (0, 1, 0), 13.0 - y0 - 0.3, t='door')

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
mount('gun', 0, (0.0, deck_y(-58.0) + 0.18, -58.0), K.mk45)
mount('sam', 0, (0.0, FWD['ytop'], FWD['zc']), None)
mount('sam', 1, (0.0, AFT['ytop'], AFT['zc']), None)
mount('ciws', 0, (0.0, 15.0, -28.4), K.phalanx)
mount('ciws', 1, (0.0, 19.2, 55.2), K.phalanx)

layout = {
    'version': 1, 'deckY': 8.0, 'shadowY': 11.0, 'L': L, 'draft': -KEEL,
    'deck': [[x, z] for x, z in deck_outline],
    'waterline': [[x, z] for x, z in waterline],
    'vls': vls_layout,
    'mounts': layout_mounts,
}
root['skywar'] = json.dumps(layout, separators=(',', ':'))
print('destroyer tris ~', S.tris(), ' radar', R.tris(), 'cells', cell_no - 1, 'uptakes', upt_no - 1)
os.makedirs(os.path.dirname(os.path.abspath(OUT)), exist_ok=True)
bpy.ops.export_scene.gltf(filepath=OUT, export_format='GLB', export_extras=True, export_yup=True,
                          export_materials='EXPORT', export_image_format='AUTO', export_cameras=False, export_lights=False)
print('exported', OUT, os.path.getsize(OUT) // 1024, 'KB')
