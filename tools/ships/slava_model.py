# ═══════════════════════════════════════════════════════════════
# Slava-class guided-missile cruiser (Project 1164; Varyag, pennant 011) — scripted model for Blender:
#   blender -b -P tools/ships/slava_model.py -- <texdir> models/ships/slava.glb
# Game frame (shipkit.py): x starboard, y up (0 = waterline), bow −z.
# Reference: US DoD profile (1986) and navypedia profile / plan drawings (scaled), kchf.ru, ru.wikipedia (Project 1164),
# the annotated armament drawing on Commons, photographs of Varyag and Moskva. LOA 186.4 m, beam 20.8 m (19.2 at the
# waterline), 6.28 m hull draught; freeboard ~9.5 m at the bow, 6 amidships, 4.5 aft. Positions below are metres
# aft of the stem head (x) and above the waterline.
# Rig (tools/ships/RIG.md): vls_1..16 the front caps of the 16 P-1000 Vulkan containers (8 twin SM-248 launchers
# stepped along the forward superstructure, 4 a side, pitched ~17°; caps hinged at the top, opening upward),
# cell_1..16 at the container mouths (+Y along the container: forward and up), vls_17..24 the launch hatches of the
# eight S-300F Fort revolvers aft (cell_17..80: 8 missiles each, all fired through their revolver's hatch),
# launcher_osa_1..2 (the Osa-M launchers pop up), radar (Top Pair, rotating), radar2 (Top Steer).
# Mounts for naval.js: mount_gun_0 (AK-130), mount_ciws_0..5 (AK-630), mount_sam_0 (S-300F), mount_sam_1 (Osa-M).
# ═══════════════════════════════════════════════════════════════
import bpy, math, sys, os, json
sys.dont_write_bytecode = True
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from shipkit import Part, material, srgb, smoothstep, lerp, clamp, add_text
import navkit as K
import fleet_textures as FT

args = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
TEX = args[0] if len(args) > 0 else '/tmp/shiptex'
OUT = args[1] if len(args) > 1 else 'slava.glb'
FONT = next((p for p in ('/System/Library/Fonts/Supplemental/Arial Black.ttf',
                         '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf') if os.path.exists(p)), None)

bpy.ops.wm.read_factory_settings(use_empty=True)
material('Deck', srgb(0xffffff), 0.0, 0.88, image=os.path.join(TEX, 'slava_deck.jpg'))
material('Hull', srgb(0xffffff), 0.04, 0.68, image=os.path.join(TEX, 'slava_hull.jpg'))
material('Super', srgb(0x8d979f), 0.04, 0.6)          # Soviet light blue-grey
material('Dark', srgb(0x2a2d31), 0.2, 0.7)
material('Black', srgb(0x151617), 0.1, 0.6)
material('White', srgb(0xdcdedd), 0.05, 0.45)
material('Glass', srgb(0x18232d), 0.5, 0.12)
material('Array', srgb(0x4f575e), 0.2, 0.55)
material('Canister', srgb(0x86909a), 0.1, 0.55)
material('Under', srgb(0x74879a), 0.04, 0.7)
material('NavRed', srgb(0xff2020), 0.0, 0.5, emit=srgb(0xff2020), emit_strength=5.0)
material('NavGreen', srgb(0x20ff50), 0.0, 0.5, emit=srgb(0x20ff50), emit_strength=5.0)
material('NavWhite', srgb(0xffffff), 0.0, 0.5, emit=srgb(0xfff4e0), emit_strength=5.0)

LOA = 186.4
def ZX(x):
    return -LOA / 2 + x
BOW, STERN = ZX(0.0), ZX(LOA)
KEEL = -6.28
H = FT.HULLS['slava']
D = FT.DECKS['slava']
def hull_uv(x, y, z):
    return ((z - H['z0']) / (H['z1'] - H['z0']), (y - H['y0']) / (H['y1'] - H['y0']))
def deck_uv(x, y, z):
    return ((x - D['x0']) / (D['x1'] - D['x0']), (D['z1'] - z) / (D['z1'] - D['z0']))

S = Part('slava_static')

# ═════════════ hull: flared bow with a long forecastle sheer, transom stern, sonar dome ═════════════
def sheer(z):
    x = z - BOW
    if x < 60:
        return 9.5 - 2.6 * (x / 60) ** 1.1
    return lerp(6.9, 4.7, smoothstep(60, 170, x))
def stem_z(y):
    t = clamp((y - KEEL) / (10.0 - KEEL), 0, 1)
    return BOW + 11.0 * (1 - t) ** 1.6
def stern_z(y):
    return STERN if y >= -0.3 else STERN - 22.0 * ((-0.3 - y) / (-0.3 - KEEL)) ** 1.2
def bsec(y):
    Rb = 2.4
    cx, cy = 9.6 - Rb, KEEL + Rb
    if y < cy:
        dy = cy - y
        return cx + math.sqrt(max(Rb * Rb - dy * dy, 0.0))
    if y <= 0:
        return 9.6
    return 9.6 + 0.8 * min(y / 6.0, 1.0)
def hb(s, y, z):
    t = clamp((y - KEEL) / (10.0 - KEEL), 0, 1)
    se = 0.44 - 0.14 * t
    k = 1.5 + 1.8 * t
    u = min(s / se, 1.0)
    fore = 1 - (1 - u) ** k
    sa = lerp(0.3, 0.2, smoothstep(-2.0, 1.0, y))
    tf = lerp(0.05, 0.78, smoothstep(-3.0, 0.4, y))
    w = smoothstep(1 - sa, 1.0, s) ** 1.3
    return bsec(y) * fore * (1 - (1 - tf) * w)
TS = [0.0, 0.03, 0.08, 0.15, 0.25, 0.36, 0.44, 0.5, 0.56, 0.64, 0.74, 0.84, 0.93, 1.0]
grid = K.loft_hull(S, TS, 90, KEEL, sheer, stem_z, stern_z, hb, mat='Hull', uvf=hull_uv)
S.sphere('Hull', (0.0, -7.2, ZX(26.0)), 2.3, 2.3, 9.0, nu=12, nv=8, uvf=hull_uv)        # sonar dome (8.4 m draught)
top = grid[-1]
waterline = K.outline_at(grid, 0.0)
K.deck_strip(S, top, 0.2, 'Deck', deck_uv)
deck_outline = [(round(p[0], 2), round(p[2], 2)) for p in top[::3]]
deck_outline = deck_outline + [(-x, z) for x, z in reversed(deck_outline)]
def deck_y(z):
    return K.edge_at(top, z)[1] + 0.12
for sg in (1, -1):
    pts = [(sg * (p[0] - 0.12), p[1] + 0.02, p[2]) for p in top[2:-1]]
    K.rail(S, pts[::2] + [pts[-1]], h=1.0, step=2.0)
# pennant number (white with black shading) under the launchers, anchors, hawse pipes
if FONT:
    for sg in (1, -1):
        zc = ZX(74.0)
        x = K.half_width(grid, zc, 3.0)
        ex = (0, 0, -1) if sg > 0 else (0, 0, 1)
        add_text(S, 'White', '011', 2.6, FONT, (sg * (x + 0.08), 3.0, zc), ex, (0, 1, 0), (sg, 0, 0), 0.04)
        add_text(S, 'Black', '011', 2.6, FONT, (sg * (x + 0.05), 2.85, zc + ex[2] * 0.15), ex, (0, 1, 0), (sg, 0, 0), 0.04)
for sg in (1, -1):
    S.cyl('Dark', (sg * 2.2, 0, ZX(14.0)), 0.8, 0.8, deck_y(ZX(14.0)), deck_y(ZX(14.0)) + 0.8, 12)
    S.beam('Black', (sg * 2.2, deck_y(ZX(12.0)) + 0.02, ZX(12.5)), (sg * 3.8, deck_y(ZX(8.0)) + 0.02, ZX(8.0)), 0.35, 0.1)
    for xx in (6.0, 20.0, 34.0, 120.0, 150.0):
        e = K.edge_at(top, ZX(xx))
        K.bollard(S, sg * (e[0] - 1.1), e[1] + 0.15, ZX(xx))

# ═════════════ weapons (turrets are mount_* nodes built below) ═════════════
def ak630(part, o):
    """AK-630M: a compact domed turret with the six-barrel 30 mm gun"""
    x, y, z = o
    part.cyl('Super', (x, 0, z), 0.95, 1.0, y, y + 0.5, 14)
    part.sphere('Super', (x, y + 0.5, z + 0.2), 0.95, 0.95, 1.2, 14, 7, v0=0.5, v1=1.0)
    part.box('Super', x - 0.6, x + 0.6, y + 0.5, y + 1.1, z - 0.6, z + 0.9)
    part.cyl('Dark', (x, y + 0.9, 0), 0.2, 0.2, z - 2.4, z - 0.6, 8, axis='z')
    part.cyl('Dark', (x, y + 0.9, 0), 0.25, 0.25, z - 2.6, z - 2.3, 8, axis='z')
def ak130(part, o):
    """AK-130: the twin 130 mm turret (a big angular house, two long barrels)"""
    x, y, z = o
    p0 = [(-2.4, 0, -2.6), (2.4, 0, -2.6), (2.6, 0, 3.4), (-2.6, 0, 3.4)]
    p1 = [(-1.9, 2.4, -1.6), (1.9, 2.4, -1.6), (2.2, 2.6, 3.2), (-2.2, 2.6, 3.2)]
    P0 = [(x + a, y + b, z + c) for a, b, c in p0]
    P1 = [(x + a, y + b, z + c) for a, b, c in p1]
    for i in range(4):
        j = (i + 1) % 4
        q = [P0[i], P0[j], P1[j], P1[i]]
        n = [(0, 0.3, -1), (1, 0.2, 0), (0, 0.2, 1), (-1, 0.2, 0)][i]
        part.g('Super').face(q, None, n)
    part.g('Super').face(P1, None, (0, 1, 0))
    part.cyl('Super', (x, 0, z + 0.4), 3.0, 3.0, y - 0.4, y, 18)
    for sx in (-0.8, 0.8):
        part.cyl('Super', (x + sx, y + 1.1, 0), 0.34, 0.22, z - 9.4, z - 2.0, 10, axis='z')
        part.cyl('Dark', (x + sx, y + 1.1, 0), 0.09, 0.09, z - 9.42, z - 9.38, 8, axis='z', cap1=False)
    part.box('Super', x - 0.6, x + 0.6, y + 2.6, y + 3.0, z + 1.0, z + 2.0)
def bass_tilt(part, o, face_yaw=0.0):
    """MR-123 Bass Tilt fire-control radar: a round dish housing on a pedestal"""
    x, y, z = o
    part.cyl('Super', (x, 0, z), 0.45, 0.55, y, y + 1.2, 10)
    part.cyl('Super', (x, y + 2.0, 0), 1.0, 1.0, z - 0.2, z + 0.7, 16, axis='z')
    part.cyl('Array', (x, y + 2.0, 0), 0.95, 0.95, z - 0.22, z - 0.2, 16, axis='z', cap1=False)
    part.box('Super', x - 0.4, x + 0.4, y + 1.2, y + 1.5, z - 0.3, z + 0.6)
def rbu6000(part, o, facing=0.0):
    """RBU-6000: twelve 212 mm barrels in a horseshoe on a trainable mount"""
    x, y, z = o
    part.cyl('Super', (x, 0, z), 0.7, 0.8, y, y + 0.9, 12)
    for k in range(12):
        a = math.pi * (0.15 + 0.7 * k / 11)
        cx, cy = 0.62 * math.cos(a), 0.62 * math.sin(a)
        part.beam('Dark', (x + cx, y + 1.4 + cy * 0.6, z + 0.9), (x + cx, y + 1.7 + cy * 0.6, z - 1.1), 0.2, 0.2)
    part.box('Super', x - 0.5, x + 0.5, y + 0.9, y + 1.5, z - 0.4, z + 0.6)

# ═════════════ forward superstructure: bridge, Front Door tower, the pyramid foremast ═════════════
y01 = deck_y(ZX(60.0))
# lower block between the launcher rows (narrow: the P-1000 containers stand either side of it)
S.box('Super', -5.4, 5.4, deck_y(ZX(40.0)) - 0.3, 12.0, ZX(38.0), ZX(96.0))
S.box('Super', -4.6, 4.6, 12.0, 14.8, ZX(52.0), ZX(96.0))
# the fwd AK-630 pair and the RBU-6000s sit on the lower block's forward end (x 40–50)
S.box('Super', -5.4, 5.4, 12.0, 12.2, ZX(38.0), ZX(52.0))
# bridge block (face at x 60, roof 20), wings, windows
K.deckhouse(S, 4.6, 4.3, 14.8, 20.0, ZX(58.0), ZX(72.0), chamfer_front=1.2)
S.g('Glass').face([(-3.6, 18.0, ZX(57.98) + 1.2 * 0), (3.6, 18.0, ZX(57.98)), (3.5, 19.4, ZX(57.98)), (-3.5, 19.4, ZX(57.98))], None, (0, 0, -1))
for sg in (1, -1):
    S.g('Glass').face([(sg * 4.33, 18.0, ZX(60.0)), (sg * 4.33, 18.0, ZX(67.0)), (sg * 4.33, 19.4, ZX(67.0)), (sg * 4.33, 19.4, ZX(60.0))], None, (sg, 0, 0))
    S.box('Super', min(sg * 4.4, sg * 8.2), max(sg * 4.4, sg * 8.2), 17.4, 17.7, ZX(58.5), ZX(63.0))
    S.box('NavRed' if sg < 0 else 'NavGreen', min(sg * 8.0, sg * 8.3), max(sg * 8.0, sg * 8.3), 17.7, 18.1, ZX(60.0), ZX(60.6))
    K.rail(S, [(sg * 4.4, 17.7, ZX(58.5)), (sg * 8.2, 17.7, ZX(58.5)), (sg * 8.2, 17.7, ZX(63.0))], h=1.0, step=1.5)
for k in range(1, 8):
    x = -3.6 + k * 7.2 / 8
    S.box('Super', x - 0.06, x + 0.06, 18.0, 19.4, ZX(57.95), ZX(58.02))
# Kite Screech (AK-130 fire control) above the bridge
bass_tilt(S, (0.0, 20.0, ZX(63.0)))
S.cyl('Super', (0, 0, ZX(63.0)), 1.6, 1.6, 20.0, 20.4, 14)
# Front Door (P-500/1000 guidance) tower: a flat array on the tower's forward face, z 22–27
K.deckhouse(S, 3.4, 3.0, 20.0, 27.5, ZX(69.0), ZX(76.0))
S.box('Array', -2.6, 2.6, 22.0, 27.0, ZX(68.85), ZX(69.0))
S.box('Super', -2.9, 2.9, 21.7, 22.0, ZX(68.6), ZX(69.2))
S.cyl('White', (0, 0, ZX(72.0)), 0.9, 0.9, 27.5, 28.6, 12)
# the enclosed pyramid foremast (x 72–84, top 37) with Top Steer (radar2) on its top: plated, tapering, with
# equipment platforms and ESM domes on its faces
FM = (ZX(72.0), ZX(84.0))
fz = (FM[0] + FM[1]) / 2
pyr0 = [(-4.4, 14.8, FM[0]), (4.4, 14.8, FM[0]), (4.4, 14.8, FM[1]), (-4.4, 14.8, FM[1])]
pyr1 = [(-1.1, 33.5, fz - 1.2), (1.1, 33.5, fz - 1.2), (1.1, 33.5, fz + 1.2), (-1.1, 33.5, fz + 1.2)]
for i in range(4):
    j = (i + 1) % 4
    n = [(0, 0.3, -1), (1, 0.3, 0), (0, 0.3, 1), (-1, 0.3, 0)][i]
    S.g('Super').face([pyr0[i], pyr0[j], pyr1[j], pyr1[i]], None, n)
S.g('Super').face(pyr1, None, (0, 1, 0))
for y in (21.0, 26.5, 31.0):
    t = (y - 14.8) / (33.5 - 14.8)
    r = lerp(4.4, 1.1, t)
    rz = lerp(6.0, 1.2, t)
    S.box('Super', -r - 1.0, r + 1.0, y - 0.25, y, fz - rz - 0.8, fz + rz + 0.8)
    K.rail(S, [(-r - 1.0, y, fz - rz - 0.8), (r + 1.0, y, fz - rz - 0.8), (r + 1.0, y, fz + rz + 0.8), (-r - 1.0, y, fz + rz + 0.8)], h=0.9, step=1.5, closed=True)
for sg in (1, -1):
    for (y, dz) in ((23.0, -2.0), (28.5, 1.5)):
        t = (y - 14.8) / (33.5 - 14.8)
        S.sphere('White', (sg * (lerp(4.4, 1.1, t) + 0.4), y, fz + dz), 0.7, 0.7, 0.7, 12, 6)
S.box('Super', -1.4, 1.4, 33.5, 34.5, fz - 1.4, fz + 1.4)
S.beam('Super', (-5.5, 30.0, fz), (5.5, 30.0, fz), 0.3)
for sx in (-1, 1):
    S.cyl('White', (sx * 5.0, 0, fz), 0.35, 0.35, 30.2, 31.2, 8)
S.cyl('Super', (0, 0, fz + 1.0), 0.2, 0.1, 36.5, 41.0, 6)
S.box('NavWhite', -0.15, 0.15, 33.0, 33.3, fz - 1.6, fz - 1.4)

# ═════════════ midships: mainmast with Top Pair (radar), twin funnels, the crane ═════════════
S.box('Super', -6.8, 6.8, deck_y(ZX(96.0)) - 0.3, 12.5, ZX(90.0), ZX(126.0))
K.deckhouse(S, 5.6, 5.0, 12.5, 16.2, ZX(84.0), ZX(103.5), chamfer_front=1.5)     # the block under the mainmast
MMZ = ZX(100.0)
# the mainmast: a four-legged lattice tower carrying Top Pair
for (sx, sz) in ((1, 1), (-1, 1), (-1, -1), (1, -1)):
    S.beam('Super', (sx * 3.2, 16.2, MMZ + sz * 3.0), (sx * 1.3, 21.0, MMZ + sz * 1.3), 0.6)
for y in (17.8, 19.4):
    t = (y - 16.2) / (21.0 - 16.2)
    r = lerp(3.2, 1.3, t)
    for (a, b2) in (((-r, -r), (r, -r)), ((r, -r), (r, r)), ((r, r), (-r, r)), ((-r, r), (-r, -r))):
        S.beam('Super', (a[0], y, MMZ + a[1]), (b2[0], y, MMZ + b2[1]), 0.22)
S.box('Super', -2.2, 2.2, 20.5, 21.5, MMZ - 2.2, MMZ + 2.2)
K.rail(S, [(-2.2, 21.5, MMZ - 2.2), (2.2, 21.5, MMZ - 2.2), (2.2, 21.5, MMZ + 2.2), (-2.2, 21.5, MMZ + 2.2)], h=0.9, step=1.2, closed=True)
S.cyl('Super', (0, 0, MMZ), 1.1, 1.1, 21.5, 22.2, 12)
# twin funnels side by side (x 104–116, ±4.1), each with two big uptake openings
for sg in (1, -1):
    xc = sg * 4.1
    K.deckhouse(S, 1.9, 1.7, 12.5, 17.5, ZX(104.0), ZX(116.0), xc=xc, top=False)
    S.box('Black', xc - 1.7, xc + 1.7, 17.3, 17.5, ZX(104.3), ZX(115.7))
    for dz in (107.0, 112.5):
        S.box('Black', xc - 1.4, xc + 1.4, 17.5, 18.6, ZX(dz) - 1.6, ZX(dz) + 1.6)
        S.box('Dark', xc - 1.2, xc + 1.2, 18.6, 18.62, ZX(dz) - 1.4, ZX(dz) + 1.4)
    for k in range(4):
        S.box('Dark', min(xc + sg * 1.9, xc + sg * 2.0), max(xc + sg * 1.9, xc + sg * 2.0), 13.5 + k * 0.9, 14.1 + k * 0.9, ZX(105.0), ZX(110.0))
# crane (post x 120–124) stowed between the funnels
S.cyl('Super', (0, 0, ZX(122.0)), 0.8, 0.7, 12.5, 16.5, 12)
S.beam('Super', (0, 16.3, ZX(122.0)), (0, 17.2, ZX(105.0)), 0.6)
S.beam('Dark', (0, 17.2, ZX(105.0)), (0, 14.5, ZX(104.8)), 0.05)
# aft AK-630 platforms (x ~94 and ~100, ±7.8) with Bass Tilts
for (x, sg) in ((94.0, 1), (94.0, -1), (100.0, 1), (100.0, -1)):
    S.box('Super', min(sg * 5.4, sg * 9.2), max(sg * 5.4, sg * 9.2), 7.9, 8.3, ZX(x) - 2.5, ZX(x) + 2.5)
for sg in (1, -1):
    bass_tilt(S, (sg * 4.0, 12.5, ZX(97.0)))
# boats on davits and life-raft racks along the midships deckhouse
for sg in (1, -1):
    K.rhib7(S, (sg * 8.6, 10.0, ZX(118.0)), yaw=0.0, hull='Super', tube='Dark')
    K.davit(S, (sg * 6.9, 12.5, ZX(115.2)), side=sg, h=2.2, reach=2.2)
    for k in range(4):
        K.raft_rack(S, sg * 6.85, 12.5, ZX(124.0) - k * 1.9, n=1, along='z', side=sg)

# ═════════════ aft: S-300F revolver covers, the hangar with Top Dome, Osa-M, flight deck ═════════════
FORT_X = [128.7, 133.1, 137.3, 141.4]
FORT_Y = 3.3
for x in FORT_X:
    for sg in (1, -1):
        y = deck_y(ZX(x))
        S.cyl('Super', (sg * FORT_Y, 0, ZX(x)), 1.65, 1.65, y - 0.05, y + 0.06, 24)
        S.cyl('Dark', (sg * FORT_Y, 0, ZX(x)), 1.66, 1.66, y + 0.0, y + 0.03, 24, cap0=False, cap1=False)
        # the launch hatch position on each cover (outboard-forward), and its dark opening under the hatch
        hx, hz = sg * (FORT_Y + 0.85), ZX(x) - 0.5
        S.cyl('Dark', (hx, 0, hz), 0.42, 0.42, y + 0.06, y + 0.07, 14, cap0=False)
# hangar block x 145–165 (roof ~10), the hangar ramp door facing aft
HZ0, HZ1 = ZX(145.0), ZX(165.0)
K.deckhouse(S, 7.2, 6.8, deck_y(HZ0) - 0.3, 10.2, HZ0, HZ1)
S.g('Dark').face([(-4.2, deck_y(HZ1), HZ1 + 0.02), (4.2, deck_y(HZ1), HZ1 + 0.02), (4.2, 8.8, HZ1 + 0.02), (-4.2, 8.8, HZ1 + 0.02)], None, (0, 0, 1))
# Top Dome (S-300F guidance) on the hangar roof: the big radome with its flat back
S.cyl('Super', (0, 0, ZX(153.5)), 2.6, 2.6, 10.2, 12.2, 18)
S.sphere('White', (0, 12.2, ZX(153.5)), 2.8, 3.4, 2.8, 18, 10, v0=0.5, v1=1.0)
S.box('Super', -2.2, 2.2, 12.0, 16.5, ZX(156.0), ZX(157.2))
S.cyl('Array', (0, 14.4, 0), 1.6, 1.6, ZX(157.2), ZX(157.4), 16, axis='z')
for sg in (1, -1):
    # torpedo-tube shutters in the hull sides (x 150–157, 3–4 m up)
    x = K.half_width(grid, ZX(153.5), 3.5)
    S.g('Dark').face([(sg * (x + 0.03), 2.8, ZX(150.0)), (sg * (x + 0.03), 2.8, ZX(157.0)), (sg * (x + 0.03), 4.2, ZX(157.0)), (sg * (x + 0.03), 4.2, ZX(150.0))], None, (sg, 0, 0))
    # Osa-M launcher wells (x ~163, ±7): the covers are flush, the launcher is a rig node
    S.cyl('Dark', (sg * 7.0, 0, ZX(163.0)), 1.25, 1.25, deck_y(ZX(163.0)) - 0.02, deck_y(ZX(163.0)) + 0.03, 16)
S.box('NavWhite', -0.15, 0.15, 10.2, 10.5, HZ1 - 0.5, HZ1 - 0.2)
# helicopter pad edge nets, the flagstaff
for sg in (1, -1):
    for x in range(167, 186, 3):
        e = K.edge_at(top, ZX(x))
        S.box('Dark', min(sg * e[0], sg * (e[0] + 1.1)), max(sg * e[0], sg * (e[0] + 1.1)), e[1] - 0.2, e[1] - 0.15, ZX(x) - 1.4, ZX(x) + 1.4)
K.whip(S, 0, deck_y(STERN - 1.0), STERN - 1.0, 5.0, mat='Super', r=0.1)

# ═════════════ underwater: shafts, struts, four propellers, twin rudders ═════════════
for sx in (-6.2, -2.4, 2.4, 6.2):
    S.beam('Hull', (sx * 0.8, -4.0, ZX(140.0)), (sx, -4.3, ZX(170.0)), 0.55)
    S.cyl('Dark', (sx, -4.3, 0), 0.5, 0.22, ZX(170.0), ZX(171.4), 8, axis='z')
    for b in range(5):
        a = 2 * math.pi * b / 5
        S.beam('Dark', (sx, -4.3, ZX(170.6)), (sx + 1.9 * math.cos(a), -4.3 + 1.9 * math.sin(a), ZX(170.8)), 0.8, 0.1)
for sx in (-3.6, 3.6):
    S.box('Hull', sx - 0.35, sx + 0.35, -5.4, -1.2, ZX(175.0), ZX(179.5), uvf=hull_uv)

root = bpy.data.objects.new('slava', None)
bpy.context.collection.objects.link(root)
S.build(parent=root)

# ═════════════ P-1000 Vulkan: 8 twin SM-248 launchers, 4 a side, stepped along the forward superstructure ═════════════
PITCH = math.radians(17.0)
CL = 12.5          # container length
CR = 0.8           # container radius
FRONTS = [40.0, 52.0, 64.0, 75.0]
C2 = Part('p1000_containers')
cap_me = None
cells = []
tube_no = 1
def cap_mesh():
    """a container's domed front cap in its own frame: hinge along local x at the top edge, the cap hanging
    down (−y) over the mouth, facing −z (forward)"""
    p = Part('p1000_cap')
    n = 18
    ring0 = [(CR * math.cos(2 * math.pi * i / n), -CR + CR * math.sin(2 * math.pi * i / n), 0.0) for i in range(n)]
    ring1 = [(0.8 * CR * math.cos(2 * math.pi * i / n), -CR + 0.8 * CR * math.sin(2 * math.pi * i / n), -0.28) for i in range(n)]
    for i in range(n):
        j = (i + 1) % n
        p.g('Canister').face([ring0[i], ring0[j], ring1[j], ring1[i]], None, (ring0[i][0], ring0[i][1] + CR, -0.6), True)
    p.g('Canister').face(ring1, None, (0, 0, -1))
    p.g('Canister').face(ring0[::-1], None, (0, 0, 1))
    p.box('Dark', -0.1, 0.1, -0.08, 0.06, -0.12, 0.05)
    return p.mesh(origin=(0, 0, 0))
cap_me = cap_mesh()
for sg in (1, -1):
    for xf in FRONTS:
        for lat in (6.6, 8.3):                    # inboard, outboard tube
            x = sg * lat
            # the container's axis: from the rear (z = x_rear, low) to the mouth (x_front, high)
            zf = ZX(xf)
            yf = 11.0 - (0.0 if lat == 6.6 else 0.15)
            zr = zf + CL * math.cos(PITCH)
            yr = yf - CL * math.sin(PITCH)
            # tube body with ring stiffeners
            dirv = (0.0, yf - yr, zf - zr)
            ln = math.hypot(dirv[1], dirv[2])
            u = (0.0, dirv[1] / ln, dirv[2] / ln)
            n_seg = 16
            ring = lambda t, r: [(x + r * math.cos(2 * math.pi * i / n_seg), yr + (yf - yr) * t + r * math.sin(2 * math.pi * i / n_seg) * u[2] * 1.0,
                                  zr + (zf - zr) * t - r * math.sin(2 * math.pi * i / n_seg) * u[1]) for i in range(n_seg)]
            A, B = ring(0.0, CR), ring(1.0, CR)
            for i in range(n_seg):
                j = (i + 1) % n_seg
                C2.g('Canister').face([A[i], A[j], B[j], B[i]], None, (A[i][0] - x, A[i][1] - yr, 0), True)
            C2.g('Canister').face(A, None, (0, -u[1], -u[2]))
            for t in (0.15, 0.4, 0.65, 0.9):
                R1, R2 = ring(t - 0.008, CR + 0.06), ring(t + 0.008, CR + 0.06)
                for i in range(n_seg):
                    j = (i + 1) % n_seg
                    C2.g('Super').face([R1[i], R1[j], R2[j], R2[i]], None, (R1[i][0] - x, R1[i][1] - (yr + (yf - yr) * t), 0), True)
            # mouth rim and the dark bore behind the cap
            Mo = ring(1.0, CR + 0.05)
            Mi = ring(1.0, CR - 0.1)
            for i in range(n_seg):
                j = (i + 1) % n_seg
                C2.g('Super').face([Mo[i], Mo[j], Mi[j], Mi[i]], None, (0, u[1], u[2]))
            C2.g('Dark').face(Mi[::-1], None, (0, u[1], u[2]))
            # plate pylons down to the deck
            for t in (0.2, 0.75):
                py, pz = yr + (yf - yr) * t, zr + (zf - zr) * t
                C2.box('Super', x - 0.08, x + 0.08, deck_y(pz) - 0.1, py - CR * 0.8, pz - 0.9, pz + 0.9)
            # the cap: hinged at the top of the mouth (the mouth centre + CR along (0, cos P, sin P), which is
            # square to the container axis), turned by +P about x so it faces along the axis; opens upward
            hinge = (x, yf + CR * math.cos(PITCH) + 0.02 * math.sin(PITCH), zf + CR * math.sin(PITCH) - 0.02 * math.cos(PITCH))
            K.rig_node('vls_%d' % tube_no, cap_me, hinge, root, ((1, 0, 0), PITCH), {'t': 'door', 'hinge': [1, 0, 0], 'open': 1.75})
            # launch point at the mouth, +Y along the container (the missile leaves forward and up)
            K.point('cell_%d' % tube_no, (x, yf, zf), root, ((1, 0, 0), -(math.pi / 2 - PITCH)), t='cell', door='vls_%d' % tube_no, depth=CL)
            tube_no += 1
    # efflux openings in the hull side below the rear of each pair
    for xf in FRONTS:
        zr = ZX(xf) + CL * math.cos(PITCH)
        xh = K.half_width(grid, zr, deck_y(zr) - 1.6)
        C2.g('Dark').face([(sg * (xh + 0.03), deck_y(zr) - 2.4, zr - 1.6), (sg * (xh + 0.03), deck_y(zr) - 2.4, zr + 0.6), (sg * (xh + 0.03), deck_y(zr) - 1.0, zr + 0.6), (sg * (xh + 0.03), deck_y(zr) - 1.0, zr - 1.6)], None, (sg, 0, 0))
C2.build(parent=root)

# ═════════════ S-300F Fort launch hatches (one per revolver, 8 missiles each) ═════════════
def fort_hatch_mesh():
    p = Part('fort_hatch')
    p.cyl('Super', (0, 0, 0.42), 0.46, 0.44, 0.0, 0.1, 14)
    p.box('Dark', -0.08, 0.08, 0.1, 0.14, 0.0, 0.2)
    return p.mesh(origin=(0, 0, 0))
fh = fort_hatch_mesh()
cell_no = tube_no
for x in FORT_X:
    for sg in (1, -1):
        y = deck_y(ZX(x)) + 0.06
        hx, hz = sg * (FORT_Y + 0.85), ZX(x) - 0.5
        n = tube_no
        # hinged on its forward edge (local +z = aft), opening forward
        K.rig_node('vls_%d' % n, fh, (hx, y, hz - 0.42), root, None, {'t': 'door', 'hinge': [1, 0, 0], 'open': -1.9})
        for k in range(8):
            K.point('cell_%d' % cell_no, (hx, y - 0.4, hz), root, None, t='cell', door='vls_%d' % n, depth=10.0)
            cell_no += 1
        tube_no += 1

# ═════════════ Osa-M pop-up launchers ═════════════
for i, sg in enumerate((1, -1)):
    Op = Part('launcher_osa_%d' % (i + 1))
    x0, z0 = sg * 7.0, ZX(163.0)
    y0 = deck_y(z0) - 3.0
    Op.cyl('Super', (x0, 0, z0), 1.1, 1.1, y0, y0 + 2.9, 16)
    Op.box('Super', x0 - 0.4, x0 + 0.4, y0 + 2.9, y0 + 3.6, z0 - 0.4, z0 + 0.4)
    for sx in (-0.75, 0.75):
        Op.beam('Super', (x0 + sx, y0 + 3.4, z0 + 0.8), (x0 + sx, y0 + 3.9, z0 - 2.2), 0.18)
        Op.cyl('White', (x0 + sx, y0 + 4.2, 0), 0.1, 0.1, z0 - 2.4, z0 + 0.5, 8, axis='z')
    Op.cyl('Dark', (x0, 0, z0), 1.2, 1.2, y0 + 2.9, y0 + 3.0, 16, cap0=False)
    K.sliding(Op, 'launcher_osa_%d' % (i + 1), (x0, y0, z0), root, (0, 1, 0), 3.0, t='lift')

# ═════════════ rotating radars: Top Pair on the mainmast (radar), Top Steer on the foremast (radar2) ═════════════
R = Part('radar')
piv = (0.0, 22.2, MMZ)
R.cyl('Super', (0, 0, MMZ), 0.6, 0.6, 22.2, 23.0, 10)
# Top Sail: a tall parabolic-cylinder antenna, leaning back; Big Net back-to-back behind it
for k in range(8):
    y0, y1 = 23.0 + k * 0.8, 23.0 + (k + 1) * 0.8
    for side in (1, -1):
        pts = [(-3.6, y0, MMZ - 0.6 - 0.25 * k), (3.6, y0, MMZ - 0.6 - 0.25 * k), (3.6, y1, MMZ - 0.6 - 0.25 * (k + 1)), (-3.6, y1, MMZ - 0.6 - 0.25 * (k + 1))]
        R.g('Array').face(pts if side > 0 else pts[::-1], None, (0, 0.3, -side))
for k in range(5):
    y0 = 23.4 + k * 1.0
    R.beam('Super', (-3.0, y0, MMZ + 0.8), (3.0, y0, MMZ + 0.8), 0.12)
R.beam('Super', (-3.2, 23.2, MMZ + 0.8), (-3.2, 27.8, MMZ + 0.8), 0.15)
R.beam('Super', (3.2, 23.2, MMZ + 0.8), (3.2, 27.8, MMZ + 0.8), 0.15)
R.box('Super', -0.6, 0.6, 23.0, 28.0, MMZ - 0.4, MMZ + 0.6)
R.build(origin=piv, parent=root)
R2 = Part('radar2')
piv2 = (0.0, 34.5, fz)
R2.cyl('Super', (0, 0, fz), 0.4, 0.4, 34.5, 35.0, 8)
R2.box('Array', -2.4, 2.4, 35.0, 36.4, fz - 0.25, fz + 0.1)
R2.box('Super', -0.3, 0.3, 35.0, 35.5, fz - 0.2, fz + 0.4)
R2.build(origin=piv2, parent=root)

# ═════════════ mounts (naval.js turns guns and CIWS toward their targets) ═════════════
mounts = []
def mount(typ, n, o, fn):
    Pm = Part('mount_%s_%d' % (typ, n))
    if fn:
        fn(Pm, o)
    # (a SAM "mount" is just where the missile leaves: an empty without rig extras)
    ob = Pm.build(origin=o, parent=root) if fn else K.rig_node('mount_%s_%d' % (typ, n), None, o, root)
    mounts.append({'type': typ, 'x': round(o[0], 2), 'y': round(o[1], 2), 'z': round(o[2], 2), 'node': 'mount_%s_%d' % (typ, n)})
mount('gun', 0, (0.0, deck_y(ZX(29.0)) + 0.35, ZX(29.0)), ak130)
ci = 0
for o in ((-1.8, 12.2, ZX(43.0)), (1.8, 12.2, ZX(43.0)), (7.8, 8.3, ZX(94.0)), (-7.8, 8.3, ZX(94.0)), (7.8, 8.3, ZX(100.0)), (-7.8, 8.3, ZX(100.0))):
    mount('ciws', ci, o, ak630)
    ci += 1
# RBU-6000s ahead of the bridge (static)
S3 = Part('slava_rbu')
for sg in (1, -1):
    rbu6000(S3, (sg * 2.6, 12.2, ZX(48.0)))
bass_tilt(S3, (0.0, 12.2, ZX(52.5)))
S3.build(parent=root)
mount('sam', 0, (0.0, deck_y(ZX(135.0)), ZX(135.0)), None)
mount('sam', 1, (0.0, deck_y(ZX(163.0)), ZX(163.0)), None)

# ═════════════ layout ═════════════
layout = {
    'version': 1, 'deckY': round(deck_y(0.0), 2), 'shadowY': 12.0, 'L': LOA, 'draft': -KEEL,
    'deck': [[x, z] for x, z in deck_outline],
    'waterline': [[x, z] for x, z in waterline],
    'vls': [{'name': 'P-1000 Vulkan', 'cells': [1, 16]}, {'name': 'S-300F Fort', 'cells': [17, cell_no - 1]}],
    'mounts': mounts,
}
root['skywar'] = json.dumps(layout, separators=(',', ':'))
print('slava tris ~', S.tris() + C2.tris() + S3.tris(), 'cells', cell_no - 1)
os.makedirs(os.path.dirname(os.path.abspath(OUT)), exist_ok=True)
bpy.ops.export_scene.gltf(filepath=OUT, export_format='GLB', export_extras=True, export_yup=True,
                          export_materials='EXPORT', export_image_format='AUTO', export_cameras=False, export_lights=False)
print('exported', OUT, os.path.getsize(OUT) // 1024, 'KB')
