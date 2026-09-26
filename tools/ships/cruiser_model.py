# ═══════════════════════════════════════════════════════════════
# Ticonderoga-class guided-missile cruiser (CG-52 on: Mk 41 ships) — scripted model for Blender:
#   blender -b -P tools/ships/cruiser_model.py -- <texdir> models/ships/cruiser.glb
# Game frame (shipkit.py): x starboard, y up (0 = waterline), bow −z; the bow tip (at deck level) is z = −86.4.
# Reference (x = metres aft of the bow tip): FAS CG-47 page and the CG-47 aviation facilities resume (deck heights),
# globalsecurity "CG-47 Design", Navypedia, the Proietti drawing and the 1994 All Hands line drawing (Commons), an
# overhead photograph of USS Vincennes scaled to the length, naval-encyclopedia (SPY-1 face directions).
# LOA 172.8 m, beam 16.8 m, hull draught 7.46 m (10.5 m over the SQS-53 dome). Spruance hull: a long raised
# forecastle (10 m at the bow tip, 8.8 at the forward VERTREP square, 7.9 aft) with a V-shaped break at x 155–158
# down to the fantail (5.2 m). Mk 45 x 36.4 and x 160; Mk 41 (61 cells each, 8 × 8 with a strikedown crane) at
# x 43–52 and x 149–157.5; forward deckhouse from x 57 (SPY faces ahead and to starboard), foremast x 72.7,
# funnels x 75.5–83.5 and 110–118, main mast x 100 with SPS-49, aft deckhouse (SPY faces to port and aft) over
# the hangar; flight deck (02 level, 10.1 m) x 125–146; Harpoons on the fantail.
# Rig (tools/ships/RIG.md): vls_1..122 / cell_1..122 (forward 1–61, aft 62–122), uptake_1..16, door_hangar_1,
# radar (SPS-49), radar2 (SPS-55), mounts.
# ═══════════════════════════════════════════════════════════════
import bpy, math, sys, os, json
sys.dont_write_bytecode = True
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from shipkit import Part, material, srgb, smoothstep, lerp, clamp, add_text
import navkit as K
import fleet_textures as FT

args = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
TEX = args[0] if len(args) > 0 else '/tmp/shiptex'
OUT = args[1] if len(args) > 1 else 'cruiser.glb'
FONT = next((p for p in ('/System/Library/Fonts/Supplemental/Arial Black.ttf',
                         '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf') if os.path.exists(p)), None)
HULL_NO = '62'

bpy.ops.wm.read_factory_settings(use_empty=True)
material('Deck', srgb(0xffffff), 0.0, 0.88, image=os.path.join(TEX, 'cruiser_deck.jpg'))
material('Hull', srgb(0xffffff), 0.04, 0.68, image=os.path.join(TEX, 'cruiser_hull.jpg'))
material('Super', srgb(0x899096), 0.04, 0.62)
material('Dark', srgb(0x2c2f32), 0.2, 0.7)
material('White', srgb(0xdadddd), 0.05, 0.45)
material('Glass', srgb(0x1a2631), 0.5, 0.12)
material('Array', srgb(0x5d646b), 0.1, 0.55)
material('VLS', srgb(0x575c61), 0.1, 0.78)
material('Canister', srgb(0x3a3f44), 0.1, 0.7)
material('Tube', srgb(0x5d6166), 0.0, 0.8)
material('Black', srgb(0x161718), 0.1, 0.6)
material('Under', srgb(0x74879a), 0.04, 0.7)
material('NavRed', srgb(0xff2020), 0.0, 0.5, emit=srgb(0xff2020), emit_strength=5.0)
material('NavGreen', srgb(0x20ff50), 0.0, 0.5, emit=srgb(0x20ff50), emit_strength=5.0)
material('NavWhite', srgb(0xffffff), 0.0, 0.5, emit=srgb(0xfff4e0), emit_strength=5.0)

LOA = 172.8
BOW, STERN = -LOA / 2, LOA / 2
def ZX(x):
    return BOW + x
KEEL = -7.46
HB = 8.4
H = FT.HULLS['cruiser']
D = FT.DECKS['cruiser']
def hull_uv(x, y, z):
    return ((z - H['z0']) / (H['z1'] - H['z0']), (y - H['y0']) / (H['y1'] - H['y0']))
def deck_uv(x, y, z):
    return ((x - D['x0']) / (D['x1'] - D['x0']), (D['z1'] - z) / (D['z1'] - D['z0']))

FANTAIL = 5.2
AFT01 = 7.9
FLIGHT = 10.1
SHEER = [(0.0, 10.0), (28.0, 8.8), (60.0, 8.4), (100.0, 8.1), (154.6, AFT01), (155.4, FANTAIL), (LOA + 1, FANTAIL)]
def sheer(z):
    x = z - BOW
    for (x0, h0), (x1, h1) in zip(SHEER, SHEER[1:]):
        if x0 <= x <= x1:
            t = (x - x0) / (x1 - x0)
            return h0 + (h1 - h0) * (smoothstep(0, 1, t) if (x0, x1) == (154.6, 155.4) else t)
    return SHEER[0][1] if x < 0 else SHEER[-1][1]
def stem_z(y):
    if y >= 0:
        return ZX(7.0) - 7.0 * min(y / 10.0, 1.0) ** 0.9
    return ZX(7.0) + 4.0 * (-y / -KEEL) ** 1.2
def stern_z(y):
    if y >= 1.2:
        return STERN
    return STERN - 4.6 * min(1.0, (1.2 - y) / 1.2) ** 0.6 - 20.0 * max(0.0, -y / -KEEL) ** 1.3
def bsec(y):
    R = 2.6
    cx, cy = HB - R, KEEL + R
    if y < cy:
        dy = cy - y
        return cx + math.sqrt(max(R * R - dy * dy, 0.0))
    return HB + 0.1 * min(max(y, 0) / 8.0, 1.0)
def hb(s, y, z=None):
    t = clamp((y - KEEL) / (10.0 - KEEL), 0, 1)
    se = 0.42 - 0.12 * t
    k = 1.5 + 1.5 * t
    u = min(s / se, 1.0)
    fore = 1 - (1 - u) ** k
    sa = lerp(0.3, 0.18, smoothstep(-2.0, 1.5, y))
    tf = lerp(0.05, 0.8, smoothstep(-3.0, 1.2, y))
    w = smoothstep(1 - sa, 1.0, s) ** 1.3
    return bsec(y) * fore * (1 - (1 - tf) * w)

S = Part('cruiser_static')
TS = [0.0, 0.03, 0.08, 0.15, 0.25, 0.36, 0.44, 0.5, 0.58, 0.68, 0.8, 0.9, 1.0]
grid = K.loft_hull(S, TS, 100, KEEL, sheer, stem_z, stern_z, hb, mat='Hull', uvf=hull_uv)
S.sphere('Hull', (0.0, -8.2, ZX(22.0)), 2.2, 2.4, 9.5, nu=12, nv=8, uvf=hull_uv)           # SQS-53 dome
for sg in (1, -1):
    S.beam('Hull', (sg * 7.2, -6.2, ZX(60.0)), (sg * 7.2, -6.2, ZX(115.0)), 0.9, 0.15)
top = grid[-1]
waterline = K.outline_at(grid, 0.0)
deck_outline = [(round(p[0], 2), round(p[2], 2)) for p in top[::3]]
deck_outline = deck_outline + [(-x, z) for x, z in reversed(deck_outline)]
def deck_y(z):
    return sheer(z) + 0.1

# ── the two 61-cell launchers: 2 modules across × 4 along, rows athwartships; a strikedown crane in each ──
LAUNCHERS = [
    dict(name='fore', nx=2, nz=4, along='x', zc=ZX(47.5), crane=(0, 1, 0, (0, 1, 2))),     # port half, 2nd module from fwd
    dict(name='aft', nx=2, nz=4, along='x', zc=ZX(153.2), crane=(1, 2, 1, (1, 2, 3))),     # stbd half, 2nd from aft, outboard 3
]
for Ln in LAUNCHERS:
    W_, Lz_ = K.mk41_launcher_size(Ln['nx'], Ln['nz'], Ln['along'])
    Ln['x0'], Ln['z0'], Ln['W'], Ln['Lz'] = -W_ / 2, Ln['zc'] - Lz_ / 2, W_, Lz_
FWD, AFT = LAUNCHERS
holes = [(Ln['W'] / 2 + 0.33, Ln['z0'] - 0.33, Ln['z0'] + Ln['Lz'] + 0.33) for Ln in LAUNCHERS]
K.deck_strip(S, top, 0.2, 'Deck', deck_uv, holes=holes)
for sg in (1, -1):
    pts = [(sg * (p[0] - 0.12), p[1] + 0.02, p[2]) for p in top[2:-1]]
    K.rail(S, pts[::2] + [pts[-1]], h=1.05, step=1.8)
    # bow bulwarks (port and starboard) on the forecastle
    for (za, zb) in ((ZX(2.0), ZX(11.0)),):
        pa, pb = K.edge_at(top, za), K.edge_at(top, zb)
        S.g('Hull').face([(sg * pa[0], pa[1], za), (sg * pb[0], pb[1], zb), (sg * pb[0], pb[1] + 1.0, zb), (sg * pa[0], pa[1] + 1.0, za)], [hull_uv(sg * pa[0], pa[1], za)] * 4, (sg, 0, 0))

# ═════════════ the V-shaped break (x 155–158): the 01 deck steps down to the fantail ═════════════
vb = [(-HB, ZX(155.0)), (HB, ZX(155.0)), (3.95, ZX(158.2)), (-3.95, ZX(158.2))]
S.prism(vb, FANTAIL, AFT01 + 0.1, 'Deck', 'Super', None, uv_top=deck_uv)
K.rail(S, [(HB - 0.1, AFT01 + 0.1, ZX(155.1)), (3.95, AFT01 + 0.1, ZX(158.2)), (-3.95, AFT01 + 0.1, ZX(158.2)), (-HB + 0.1, AFT01 + 0.1, ZX(155.1))], h=1.0, step=1.5)

# ═════════════ forecastle gear ═════════════
S.cyl('Dark', (0.0, 0, ZX(10.0)), 0.55, 0.55, deck_y(ZX(10.0)), deck_y(ZX(10.0)) + 0.7, 12)          # stem-anchor windlass
S.cyl('Dark', (1.6, 0, ZX(11.0)), 0.55, 0.55, deck_y(ZX(11.0)), deck_y(ZX(11.0)) + 0.7, 12)          # starboard anchor
for sg in (1, -1):
    for x in (6.0, 18.0, 34.0, 56.0, 120.0, 147.0, 164.0):
        e = K.edge_at(top, ZX(x))
        K.bollard(S, sg * (e[0] - 1.0), e[1] + 0.12, ZX(x))
K.whip(S, 0, deck_y(ZX(0.8)), ZX(0.8), 4.2, mat='Super', r=0.08)
S.box('NavWhite', -0.1, 0.1, deck_y(ZX(0.8)) + 4.0, deck_y(ZX(0.8)) + 4.2, ZX(0.7), ZX(0.9))

# ═════════════ forward deckhouse (x 57–91): SPY faces ahead and to starboard, bridge, SPG-62s ═════════════
Y01 = deck_y(ZX(60.0))
L02, L03, L04, L05, ROOF = 11.2, 14.0, 16.8, 19.5, 22.3
S.box('Super', -7.2, 7.2, Y01 - 0.4, L02, ZX(57.0), ZX(91.0))
S.box('Super', -7.0, 7.0, L02, L04, ZX(57.0), ZX(70.5))
S.box('Super', -6.6, 6.6, L04, L05, ZX(57.8), ZX(70.0))
S.box('Super', -5.6, 5.6, L05, ROOF, ZX(58.0), ZX(65.0))                     # pilothouse
S.box('Super', -3.6, 3.6, ROOF - 1.0, ROOF, ZX(65.0), ZX(69.5))
K.spy_face(S, (0.0, 15.5, ZX(57.0) - 0.02), (0.0, -1.0), size=3.75, tilt=math.radians(-6))      # dead ahead
K.spy_face(S, (7.02, 15.7, ZX(63.0)), (1.0, 0.0), size=3.75, tilt=math.radians(-6))           # to starboard
# bridge windows, wings, nav lights
S.g('Glass').face([(-5.2, 20.1, ZX(58.0) - 0.02), (5.2, 20.1, ZX(58.0) - 0.02), (5.2, 21.3, ZX(58.0) - 0.02), (-5.2, 21.3, ZX(58.0) - 0.02)], None, (0, 0, -1))
for k in range(1, 8):
    x = -5.2 + k * 10.4 / 8
    S.box('Super', x - 0.06, x + 0.06, 20.1, 21.3, ZX(58.0) - 0.08, ZX(58.0))
for sg in (1, -1):
    S.g('Glass').face([(sg * 5.62, 20.1, ZX(59.0)), (sg * 5.62, 20.1, ZX(64.0)), (sg * 5.62, 21.3, ZX(64.0)), (sg * 5.62, 21.3, ZX(59.0))], None, (sg, 0, 0))
    S.box('Super', min(sg * 5.6, sg * 8.4), max(sg * 5.6, sg * 8.4), L05 - 0.25, L05, ZX(58.2), ZX(62.5))
    K.rail(S, [(sg * 5.6, L05, ZX(58.2)), (sg * 8.4, L05, ZX(58.2)), (sg * 8.4, L05, ZX(62.5)), (sg * 5.6, L05, ZX(62.5))], h=1.0, step=1.2)
    S.box('NavRed' if sg < 0 else 'NavGreen', min(sg * 8.35, sg * 8.65), max(sg * 8.35, sg * 8.65), L05 + 0.3, L05 + 0.65, ZX(59.5), ZX(60.0))
    K.searchlight(S, sg * 7.9, L05, ZX(61.8))
    for lv in (L02, L03):
        if not (sg > 0 and lv == L03):          # (the starboard SPY face is there)
            K.portholes(S, sg * 7.0, lv + 1.2, ZX(64.5), ZX(70.0), 3, '+x' if sg > 0 else '-x', r=0.22)
    K.wdoor(S, sg * 7.2, Y01 - 0.4, ZX(73.0), '+x' if sg > 0 else '-x')
    K.wdoor(S, sg * 7.0, L02, ZX(68.0), '+x' if sg > 0 else '-x')
    for k in range(4):
        K.raft_rack(S, sg * 7.25, L02, ZX(72.0) + k * 1.9, n=1, along='z', side=sg)
K.rail(S, [(-7.0, L04, ZX(57.0)), (7.0, L04, ZX(57.0))], h=1.0, step=1.4)
# two forward SPG-62s (x 67, 24 m, ±3) on the 05-level roof behind the pilothouse
S.box('Super', -4.6, 4.6, ROOF, ROOF + 0.3, ZX(65.5), ZX(69.0))
for sg in (1, -1):
    K.spg62(S, (sg * 3.0, ROOF - 0.6, ZX(67.0)))
K.decoy_launcher(S, (-6.2, L02, ZX(71.5)), facing=-1)
K.decoy_launcher(S, (6.2, L02, ZX(71.5)), facing=1)
# foremast: a four-legged lattice tower (x 72.7, top 36) with SPS-55 (radar2), the SPQ-9 radome, SPS-64
FMZ = ZX(72.7)
for (sx, sz) in ((1, 1), (-1, 1), (-1, -1), (1, -1)):
    S.beam('Super', (sx * 2.2, L04, FMZ + sz * 1.8), (sx * 0.7, 32.0, FMZ + sz * 0.7), 0.3)
for yy in (19.5, 22.5, 25.5, 28.5):
    t = (yy - L04) / (32.0 - L04)
    r, rz = lerp(2.2, 0.7, t), lerp(1.8, 0.7, t)
    for (a, b2) in (((-r, -rz), (r, -rz)), ((r, -rz), (r, rz)), ((r, rz), (-r, rz)), ((-r, rz), (-r, -rz))):
        S.beam('Super', (a[0], yy, FMZ + a[1]), (b2[0], yy, FMZ + b2[1]), 0.12)
S.box('Super', -1.6, 1.6, 32.0, 32.3, FMZ - 1.6, FMZ + 1.6)
K.rail(S, [(-1.6, 32.3, FMZ - 1.6), (1.6, 32.3, FMZ - 1.6), (1.6, 32.3, FMZ + 1.6), (-1.6, 32.3, FMZ + 1.6)], h=0.9, step=1.0, closed=True)
K.radome(S, 0.0, 26.0, FMZ - 2.4, 1.0, ped_h=0.3)                                    # SPQ-9 radome
S.box('Super', -1.2, 1.2, 25.8, 26.0, FMZ - 3.4, FMZ - 1.2)
S.beam('Super', (-4.8, 30.0, FMZ), (4.8, 30.0, FMZ), 0.22)
S.cyl('Super', (0, 0, FMZ), 0.15, 0.08, 33.5, 36.0, 6)
S.box('NavWhite', -0.15, 0.15, 33.0, 33.3, FMZ - 0.15, FMZ + 0.15)
for sx in (-1, 1):
    S.beam('Dark', (sx * 4.4, 30.0, FMZ), (sx * 4.4, 28.2, FMZ), 0.04)
# forward funnel (x 75.5–83.5): tall and flat-sided, a black cap (25 m) with exhaust pipes to 29
def funnel(x0, x1, cap_y, pipes_y):
    z0, z1 = ZX(x0), ZX(x1)
    S.box('Super', -3.4, 3.4, L02, cap_y - 1.6, z0, z1)
    S.box('Super', -3.6, 3.6, cap_y - 1.6, cap_y - 1.3, z0 - 0.2, z1 + 0.2)
    S.box('Black', -3.3, 3.3, cap_y - 1.3, cap_y, z0 + 0.1, z1 - 0.1)
    for (px, pz) in ((-1.6, 0.3), (0.0, 0.3), (1.6, 0.3), (-0.9, 0.65), (0.9, 0.65)):
        S.cyl('Black', (px, 0, z0 + (z1 - z0) * pz), 0.5, 0.5, cap_y, pipes_y - (0.8 if pz > 0.5 else 0.0), 10)
    for sg in (1, -1):
        for k in range(5):
            yy = L02 + 1.2 + k * 1.3
            S.box('Dark', min(sg * 3.4, sg * 3.5), max(sg * 3.4, sg * 3.5), yy, yy + 0.7, z0 + 1.0, z1 - 1.0)
funnel(75.5, 83.5, 25.0, 29.0)
# Phalanx platforms either side just aft of the funnel (x 88, base 16, ±5), SLQ-32 (x 90, 15 m)
S.box('Super', -7.2, 7.2, L02, 15.6, ZX(84.5), ZX(91.0))
for sg in (1, -1):
    S.box('Super', min(sg * 3.0, sg * 7.4), max(sg * 3.0, sg * 7.4), 15.6, 16.0, ZX(85.5), ZX(90.5))
    K.rail(S, [(sg * 7.4, 16.0, ZX(85.5)), (sg * 7.4, 16.0, ZX(90.5))], h=1.0, step=1.2)
    S.box('Super', min(sg * 7.2, sg * 8.3), max(sg * 7.2, sg * 8.3), 13.2, 16.6, ZX(89.0), ZX(92.2))
    S.box('Array', min(sg * 8.3, sg * 8.36), max(sg * 8.3, sg * 8.36), 13.5, 16.3, ZX(89.2), ZX(92.0))

# ═════════════ midships (x 91–110): main lattice mast with SPS-49, boats ═════════════
S.box('Super', -6.8, 6.8, deck_y(ZX(100.0)) - 0.3, L02, ZX(91.0), ZX(110.0))
MMZ = ZX(100.0)
for (sx, sz) in ((1, 1), (-1, 1), (-1, -1), (1, -1)):
    S.beam('Super', (sx * 2.6, L02, MMZ + sz * 2.4), (sx * 0.8, 38.0, MMZ + sz * 0.8), 0.35)
for yy in (15.0, 19.0, 23.0, 27.0, 31.0, 35.0):
    t = (yy - L02) / (38.0 - L02)
    r = lerp(2.6, 0.8, t)
    rz = lerp(2.4, 0.8, t)
    for (a, b2) in (((-r, -rz), (r, -rz)), ((r, -rz), (r, rz)), ((r, rz), (-r, rz)), ((-r, rz), (-r, -rz))):
        S.beam('Super', (a[0], yy, MMZ + a[1]), (b2[0], yy, MMZ + b2[1]), 0.12)
    S.beam('Super', (-r, yy, MMZ - rz), (r, yy + 4.0 if yy < 35 else yy, MMZ + rz), 0.08)
S.box('Super', -1.5, 1.5, 28.2, 28.5, MMZ + 1.0, MMZ + 4.4)                    # the SPS-49 platform on the aft side
S.cyl('Super', (0, 0, MMZ), 0.15, 0.08, 38.0, 41.0, 6)
S.beam('Super', (-5.0, 34.0, MMZ), (5.0, 34.0, MMZ), 0.22)
S.cyl('White', (0, 0, MMZ), 0.5, 0.5, 38.0, 39.2, 10)                           # TACAN
S.box('NavWhite', -0.15, 0.15, 36.5, 36.8, MMZ - 1.0, MMZ - 0.7)
for sg in (1, -1):
    K.rhib7(S, (sg * 6.4, L02 - 0.4, ZX(105.5)), yaw=0.0)
    K.davit(S, (sg * 5.0, L02, ZX(102.0)), side=sg, h=3.4, reach=2.0)
    for k in range(4):
        K.raft_rack(S, sg * 6.85, L02, ZX(92.0) + k * 1.9, n=1, along='z', side=sg)

# ═════════════ aft deckhouse (x 110–125): funnel, SPG-62s, SPY faces to port and aft, the hangar ═════════════
S.box('Super', -7.0, 7.0, deck_y(ZX(115.0)) - 0.3, L02, ZX(110.0), ZX(125.0))
S.box('Super', -6.6, 6.6, L02, L04 + 1.4, ZX(113.0), ZX(125.0))              # above the hangar
funnel(110.0, 118.0, 23.0, 26.5)
K.spy_face(S, (-6.62, 16.0, ZX(119.3)), (-1.0, 0.0), size=3.75, tilt=math.radians(-6))      # to port
K.spy_face(S, (0.0, 16.4, ZX(125.0) + 0.02), (0.0, 1.0), size=3.75, tilt=math.radians(-6))   # dead aft, above the hangar
S.box('Super', -5.0, 5.0, L04 + 1.4, 19.8, ZX(114.5), ZX(120.5))
for (x, yd, sg) in ((115.0, 26.0, 1), (119.0, 24.0, -1)):
    S.box('Super', min(sg * 1.2, sg * 4.6), max(sg * 1.2, sg * 4.6), 19.8, yd - 2.35, ZX(x) - 1.6, ZX(x) + 1.6)
    K.spg62(S, (sg * 3.0, yd - 2.35, ZX(x)), face_yaw=math.pi)
for sg in (1, -1):
    K.wdoor(S, sg * 7.0, deck_y(ZX(112.0)) - 0.3, ZX(112.0), '+x' if sg > 0 else '-x')
    K.radome(S, sg * 4.2, L04 + 1.4, ZX(123.2), 0.8)
# the hangar (11.8 × 8.8 × 4.6 m) opening onto the flight deck; the door is a rig node
S.g('Dark').face([(-4.3, FLIGHT, ZX(124.6)), (4.3, FLIGHT, ZX(124.6)), (4.3, FLIGHT + 4.6, ZX(124.6)), (-4.3, FLIGHT + 4.6, ZX(124.6))], None, (0, 0, 1))
for sx in (-4.3, 4.3):
    S.g('Dark').face([(sx, FLIGHT, ZX(125.0)), (sx, FLIGHT, ZX(124.6)), (sx, FLIGHT + 4.6, ZX(124.6)), (sx, FLIGHT + 4.6, ZX(125.0))], None, (-1 if sx > 0 else 1, 0, 0))
S.box('Super', -6.6, -4.3, FLIGHT, L02 + 3.6, ZX(124.6), ZX(125.0))
S.box('Super', 4.3, 6.6, FLIGHT, L02 + 3.6, ZX(124.6), ZX(125.0))

# ═════════════ flight deck (02 level, 10.1 m) x 125–146, 12.5 m wide ═════════════
FZ0, FZ1 = ZX(125.0), ZX(146.0)
S.box('Super', -6.25, 6.25, deck_y(FZ1) - 0.3, FLIGHT - 0.15, FZ0, FZ1)
S.g('Deck').face([(-6.25, FLIGHT, FZ0), (6.25, FLIGHT, FZ0), (6.25, FLIGHT, FZ1), (-6.25, FLIGHT, FZ1)], [deck_uv(-6.25, 0, FZ0), deck_uv(6.25, 0, FZ0), deck_uv(6.25, 0, FZ1), deck_uv(-6.25, 0, FZ1)], (0, 1, 0))
for sg in (1, -1):
    for z in range(int(FZ0) + 1, int(FZ1), 3):
        S.box('Dark', min(sg * 6.25, sg * 7.3), max(sg * 6.25, sg * 7.3), FLIGHT - 0.2, FLIGHT - 0.15, z - 1.4, z + 1.4)
    # Mk 32 torpedo tubes behind hull shutters (x ~140, 6.5 m)
    xh = K.half_width(grid, ZX(140.0), 6.5)
    S.g('Dark').face([(sg * (xh + 0.03), 5.6, ZX(138.0)), (sg * (xh + 0.03), 5.6, ZX(142.0)), (sg * (xh + 0.03), 7.3, ZX(142.0)), (sg * (xh + 0.03), 7.3, ZX(138.0))], None, (sg, 0, 0))
K.rail(S, [(-6.25, FLIGHT, FZ1), (6.25, FLIGHT, FZ1)], h=0.9, step=1.5)
S.box('Dark', -0.3, 0.3, FLIGHT + 0.01, FLIGHT + 0.04, FZ0 + 0.5, FZ1 - 1.0)        # RAST track

# ═════════════ fantail: Harpoons (2 × quad, port, angled), flagstaff ═════════════
for k, xx in enumerate((168.0, 171.2)):
    K.harpoon_quad(S, (-4.2 + k * 0.4, FANTAIL + 0.1, ZX(xx)), facing=-1)
K.whip(S, 0.0, FANTAIL + 0.1, STERN - 0.8, 5.0, mat='Super', r=0.08)
S.box('NavWhite', -0.12, 0.12, FANTAIL + 1.2, FANTAIL + 1.45, STERN - 0.4, STERN - 0.2)
# hull number on the bow (white with a dark drop shadow)
if FONT:
    for sg in (1, -1):
        zc = ZX(16.0)
        x = K.half_width(grid, zc, 6.0)
        ex = (0, 0, -1) if sg > 0 else (0, 0, 1)
        add_text(S, 'White', HULL_NO, 3.2, FONT, (sg * (x + 0.08), 6.0, zc), ex, (0, 1, 0), (sg, 0, 0), 0.03)
        add_text(S, 'Dark', HULL_NO, 3.2, FONT, (sg * (x + 0.05), 5.85, zc + ex[2] * 0.15), ex, (0, 1, 0), (sg, 0, 0), 0.03)

# ═════════════ underwater: shafts, struts, propellers, rudders ═════════════
for sx in (-4.2, 4.2):
    S.beam('Hull', (sx * 0.7, -5.4, ZX(125.0)), (sx, -5.6, ZX(156.0)), 0.55)
    S.beam('Hull', (sx, -5.6, ZX(152.0)), (sx * 0.9, -2.2, ZX(151.0)), 0.35, 0.8)
    S.cyl('Dark', (sx, -5.6, 0), 0.5, 0.2, ZX(156.0), ZX(157.4), 8, axis='z')
    for b in range(5):
        a = 2 * math.pi * b / 5
        S.beam('Dark', (sx, -5.6, ZX(156.7)), (sx + 2.6 * math.cos(a), -5.6 + 2.6 * math.sin(a), ZX(156.9)), 0.85, 0.1)
    S.box('Hull', sx - 0.3, sx + 0.3, -6.6, -1.8, ZX(160.0), ZX(164.5), uvf=hull_uv)

root = bpy.data.objects.new('cruiser', None)
bpy.context.collection.objects.link(root)

# ═════════════ Mk 41 VLS: 61 + 61 cells, flush in the deck ═════════════
door_me = K.mk41_door_mesh()
upt_me = K.mk41_uptake_mesh()
cell_no, upt_no = 1, 1
vls_layout = []
for Ln in LAUNCHERS:
    ytop = max(deck_y(Ln['z0'] - 0.3), deck_y(Ln['z0'] + Ln['Lz'] + 0.3)) + 0.2 + 0.05
    first = cell_no
    cell_no, upt_no, cells = K.mk41_launcher(S, root, Ln['x0'], Ln['z0'], Ln['nx'], Ln['nz'], ytop, cell_no, upt_no, door_me, upt_me,
                                             crane=Ln['crane'], along=Ln['along'], mat='VLS', deck='Dark')
    vls_layout.append({'name': Ln['name'], 'cells': [first, cell_no - 1], 'top': round(ytop, 2)})
    Ln['ytop'] = ytop
S.build(parent=root)

# ═════════════ rotating radars: SPS-49 on the main mast (radar), SPS-55 on the foremast (radar2) ═════════════
R = Part('radar')
piv = (0.0, 28.5, MMZ + 2.8)
R.cyl('Super', (0, 0, piv[2]), 0.35, 0.35, piv[1], piv[1] + 0.6, 8)
W_, H_, dep = 7.3, 4.2, 0.8
def dish(u, v):
    return (piv[0] + (u - 0.5) * W_, piv[1] + 2.7 + (v - 0.5) * H_, piv[2] + 0.5 + dep * ((2 * (u - 0.5)) ** 2 * 0.8 + (2 * (v - 0.5)) ** 2 * 0.3))
for j in range(5):
    for i in range(10):
        q = [dish(i / 10, j / 5), dish((i + 1) / 10, j / 5), dish((i + 1) / 10, (j + 1) / 5), dish(i / 10, (j + 1) / 5)]
        R.g('Dark').face(q, None, (0, 0, 1))
        R.g('Dark').face(q, None, (0, 0, -1))
R.beam('Super', (piv[0], piv[1] + 0.6, piv[2]), (piv[0], piv[1] + 2.7, piv[2] + 0.9), 0.28)
R.beam('Super', (piv[0], piv[1] + 2.7, piv[2] + 0.9), (piv[0], piv[1] + 2.7, piv[2] + 3.2), 0.16)
R.build(origin=piv, parent=root)
R2 = Part('radar2')
piv2 = (0.0, 32.3, FMZ)
R2.cyl('Super', (0, 0, FMZ), 0.2, 0.2, 32.3, 32.8, 8)
R2.box('Dark', -1.6, 1.6, 32.8, 33.3, FMZ - 0.3, FMZ + 0.1)
R2.build(origin=piv2, parent=root)

# ═════════════ hangar roller door (rig), mounts ═════════════
Dp = Part('door_hangar_1')
Dp.box('Super', -4.3, 4.3, FLIGHT + 0.03, FLIGHT + 4.6, ZX(125.0) + 0.02, ZX(125.0) + 0.12)
for k in range(1, 6):
    yy = FLIGHT + k * 4.6 / 6
    Dp.box('Dark', -4.2, 4.2, yy - 0.025, yy + 0.025, ZX(125.0) + 0.12, ZX(125.0) + 0.14)
K.sliding(Dp, 'door_hangar_1', (0.0, FLIGHT + 0.03, ZX(125.0) + 0.07), root, (0, 1, 0), 4.3, t='door')

def mk45_mod2(part, o, mat='Super', dark='Dark'):
    """5-in/54 Mk 45 Mod 2: the rounded gun house of the cruisers' older mounts"""
    x, y, z = o
    part.cyl(mat, (x, 0, z + 0.3), 2.3, 2.3, y - 0.3, y, 18)
    part.sphere(mat, (x, y, z + 0.5), 2.0, 2.1, 2.9, 16, 7, v0=0.5, v1=1.0)
    part.box(mat, x - 1.9, x + 1.9, y, y + 1.2, z + 0.5, z + 3.1)
    part.box(dark, x - 0.38, x + 0.38, y + 0.55, y + 1.45, z - 2.35, z - 2.2)
    part.cyl(mat, (x, y + 1.0, 0), 0.24, 0.18, z - 9.0, z - 2.1, 10, axis='z')
    part.cyl(dark, (x, y + 1.0, 0), 0.07, 0.07, z - 9.02, z - 8.98, 8, axis='z', cap1=False)

layout_mounts = []
def mount(typ, n, o, fn):
    name = 'mount_%s_%d' % (typ, n)
    if fn:
        P_ = Part(name)
        fn(P_, o)
        P_.build(origin=o, parent=root)
    else:
        K.rig_node(name, None, o, root)
    layout_mounts.append({'type': typ, 'x': round(o[0], 2), 'y': round(o[1], 2), 'z': round(o[2], 2), 'node': name})
mount('gun', 0, (0.0, deck_y(ZX(36.4)) + 0.2, ZX(36.4)), mk45_mod2)
mount('gun', 1, (0.0, FANTAIL + 0.3, ZX(160.5)), lambda p, o: mk45_mod2(p, o))
mount('sam', 0, (0.0, FWD['ytop'], FWD['zc']), None)
mount('sam', 1, (0.0, AFT['ytop'], AFT['zc']), None)
mount('ciws', 0, (5.1, 16.0, ZX(88.0)), K.phalanx)
mount('ciws', 1, (-5.1, 16.0, ZX(88.0)), K.phalanx)

layout = {
    'version': 1, 'deckY': 8.4, 'shadowY': L02, 'L': LOA, 'draft': -KEEL,
    'deck': [[x, z] for x, z in deck_outline],
    'waterline': [[x, z] for x, z in waterline],
    'vls': vls_layout,
    'flightDeck': [round(FZ0, 2), round(FZ1, 2), FLIGHT],
    'mounts': layout_mounts,
}
root['skywar'] = json.dumps(layout, separators=(',', ':'))
print('cruiser tris ~', S.tris(), 'cells', cell_no - 1, 'uptakes', upt_no - 1)
os.makedirs(os.path.dirname(os.path.abspath(OUT)), exist_ok=True)
bpy.ops.export_scene.gltf(filepath=OUT, export_format='GLB', export_extras=True, export_yup=True,
                          export_materials='EXPORT', export_image_format='AUTO', export_cameras=False, export_lights=False)
print('exported', OUT, os.path.getsize(OUT) // 1024, 'KB')
