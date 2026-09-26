# ═══════════════════════════════════════════════════════════════
# CB90H (Stridsbåt 90H, Combat Boat 90) — scripted model for Blender (run headless):
#   blender -b -P tools/ships/cb90_model.py -- <texdir> models/ships/cb90.glb
# Game frame (shipkit.py): x starboard, y up (0 = waterline), bow −z.
# Reference: Dockstavarvet general arrangement and specification (CB90H), hhogman.se, SoldF, photographs:
# 15.9 m over the waterjets (hull 14.9 m), beam 3.8 m, draught 0.8 m, freeboard ~1.2 m bow / 1.5 m amidships /
# 1.1 m stern; a one-man-wide bow ramp in a recessed well (the front plate hinged at its lower edge, lowering
# forward onto the shore); the splinter-protected wheelhouse (x 4.0–6.6 m from the stem, 3 front windows, 2 a
# side) with the twin 12.7 mm mount on its roof; the troop compartment (x 6.7–10.9, three small windows a side);
# a ring mount on its roof; folding masts; engine room aft; 2 × KaMeWa FF-450 waterjets with reversing buckets.
# Swedish coastal-forces splinter camouflage (fleet_textures.py camo()).
# Rig (tools/ships/RIG.md): door_ramp (the bow ramp), hatch_bow (the troops' way up to the ramp well),
# hatch_roof (the commander's hatch), hatch_troop_1..2, seat_driver, seat_commander, seat_gunner (roof mount),
# seat_gunner_2 (ring mount), seat_1..18 (troops), wheel, jet_1 / jet_2, muzzle_1..3, hatch_entry.
# ═══════════════════════════════════════════════════════════════
import bpy, math, sys, os, json
sys.dont_write_bytecode = True
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from shipkit import Part, material, srgb, smoothstep, lerp, clamp, add_text
import navkit as K

args = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
TEX = args[0] if len(args) > 0 else '/tmp/shiptex'
OUT = args[1] if len(args) > 1 else 'cb90.glb'
FONT = next((p for p in ('/System/Library/Fonts/Supplemental/Arial Black.ttf',
                         '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf') if os.path.exists(p)), None)

bpy.ops.wm.read_factory_settings(use_empty=True)
material('Camo', srgb(0xffffff), 0.05, 0.62, image=os.path.join(TEX, 'cb90_camo.jpg'))
material('Bottom', srgb(0x2b2d2a), 0.05, 0.7)
material('Deck', srgb(0x3a3f38), 0.0, 0.9)
material('Dark', srgb(0x262826), 0.2, 0.7)
material('Fender', srgb(0x151615), 0.0, 0.9)
material('Frame', srgb(0x7c8279), 0.5, 0.4)
material('Glass', srgb(0x16222a), 0.5, 0.08)
material('Gun', srgb(0x1d1f21), 0.5, 0.45)
material('Seat', srgb(0x2a2c2a), 0.0, 0.8)
material('White', srgb(0xe0e0d8), 0.05, 0.5)
material('Screen', srgb(0x0a2030), 0.2, 0.2, emit=srgb(0x2a6a8a), emit_strength=1.0)
material('NavRed', srgb(0xff2020), 0.0, 0.5, emit=srgb(0xff2020), emit_strength=5.0)
material('NavGreen', srgb(0x20ff50), 0.0, 0.5, emit=srgb(0x20ff50), emit_strength=5.0)
material('NavWhite', srgb(0xffffff), 0.0, 0.5, emit=srgb(0xfff4e0), emit_strength=5.0)

def ZX(x):
    """x metres aft of the stem head (the published positions) → game z"""
    return -7.95 + x
ZB, ZT = ZX(0.0), ZX(14.8)
def camo_uv(x, y, z):
    return (z / 4.0 + x / 9.0, (y + x * 0.5) / 4.0)

S = Part('cb90_static')

# ═════════════ hull: deep V aft, a fine forefoot, the bow truncated by the 1.2 m ramp ═════════════
def keel_y(s):
    return -0.8 + 1.15 * (1 - smoothstep(0.0, 0.38, s)) ** 1.5
def chine(s):
    w = 1.62 * (smoothstep(0.0, 0.48, s) ** 0.6)
    return (w, keel_y(s) + w * math.tan(math.radians(lerp(45, 20, smoothstep(0.0, 0.6, s)))) + 0.05)
def sheer_h(s):
    # 1.2 m at the bow, 1.5 amidships, 1.1 at the transom
    return lerp(1.2, 1.5, smoothstep(0.0, 0.35, s)) - 0.4 * smoothstep(0.6, 1.0, s)
def sheer(s):
    w = lerp(0.62, 1.9, smoothstep(0.0, 0.4, s) ** 0.65)
    return (w, sheer_h(s))
st = K.planing_hull(S, ZB, ZT, keel_y, chine, sheer, None, n=30, mat='Camo', bottom_mat='Bottom', uvf=camo_uv, rail=0.06)
# the bow face under the ramp (the s = 0 section, closed)
b = st[0]
pts = [b[4], b[3], b[2], b[1], b[0], (-b[1][0], b[1][1], b[1][2]), (-b[2][0], b[2][1], b[2][2]), (-b[3][0], b[3][1], b[3][2]), (-b[4][0], b[4][1], b[4][2])]
S.g('Camo').face(pts, [camo_uv(*p) for p in pts], (0, 0, -1))
# fender strip along the gunwale
for sg in (1, -1):
    pts = [(sg * (sh[0] + 0.05), sh[1] - 0.12, sh[2]) for (k, c, co, mid, sh) in st[2:]]
    for a, c in zip(pts, pts[1:]):
        S.beam('Fender', a, c, 0.12, 0.16, caps=False)

top = [p[4] for p in st]                     # sheer line (starboard)
def sheer_at(z):
    return K.edge_at(top, z)

# ═════════════ decks ═════════════
WELL_Z1 = ZX(2.0)
deck_pts = [(sh[0] - 0.03, sh[1] + 0.01, sh[2]) for (k, c, co, mid, sh) in st]
# foredeck (with the ramp well cut out), then the aft deck; the superstructure covers the middle
def deck_quad(z0, z1, x_in=0.0):
    ea, eb = sheer_at(z0), sheer_at(z1)
    for sg in (1, -1):
        q = [(sg * (ea[0] - 0.03), ea[1] + 0.01, z0), (sg * (eb[0] - 0.03), eb[1] + 0.01, z1), (sg * x_in, eb[1] + 0.06, z1), (sg * x_in, ea[1] + 0.06, z0)]
        S.g('Deck').face(q, None, (0, 1, 0))
zz = [ZB + 0.001] + [ZB + 0.25 * i for i in range(1, 9)] + [ZX(2.0 + 0.5 * i) for i in range(1, 5)]
for z0, z1 in zip(zz, zz[1:]):
    deck_quad(z0, z1, 0.62 if z1 <= WELL_Z1 + 1e-6 else 0.0)
zz = [ZX(10.9 + 0.5 * i) for i in range(0, 8)] + [ZT - 0.02]
for z0, z1 in zip(zz, zz[1:]):
    deck_quad(z0, z1)
# the ramp well: floor at 1.0, walls up to the foredeck, hand rails along its edges
S.box('Deck', -0.6, 0.6, 0.94, 1.0, ZB + 0.05, WELL_Z1)
for sg in (1, -1):
    S.g('Camo').face([(sg * 0.6, 1.0, ZB + 0.05), (sg * 0.6, 1.0, WELL_Z1), (sg * 0.6, sheer_at(WELL_Z1)[1] + 0.06, WELL_Z1), (sg * 0.6, 1.26, ZB + 0.05)], None, (-sg, 0, 0))
    K.sweep_tube(S, [(sg * 0.66, 1.25, ZB + 0.25), (sg * 0.66, 2.1, ZB + 0.4), (sg * 0.66, 2.1, WELL_Z1 - 0.1), (sg * 0.66, sheer_at(WELL_Z1)[1] + 0.05, WELL_Z1 + 0.2)], 0.025, 'Frame', n=6)
S.g('Camo').face([(-0.6, 1.0, WELL_Z1), (0.6, 1.0, WELL_Z1), (0.6, sheer_at(WELL_Z1)[1] + 0.06, WELL_Z1), (-0.6, sheer_at(WELL_Z1)[1] + 0.06, WELL_Z1)], None, (0, 0, -1))
# guard rails round the foredeck and the aft deck
for sg in (1, -1):
    K.rail(S, [(sg * (sheer_at(z)[0] - 0.08), sheer_at(z)[1], z) for z in (ZX(0.6), ZX(1.5), ZX(2.5), ZX(3.6))], h=0.75, step=0.9, mat='Frame', wires=(0.5, 1.0))
    K.rail(S, [(sg * (sheer_at(z)[0] - 0.08), sheer_at(z)[1], z) for z in (ZX(11.2), ZX(12.5), ZX(13.8), ZX(14.6))], h=0.75, step=0.9, mat='Frame', wires=(0.5, 1.0))
# anchor and bollards on the foredeck, pennant number on the bow
S.box('Dark', 0.75, 1.05, sheer_at(ZX(2.8))[1] + 0.05, sheer_at(ZX(2.8))[1] + 0.2, ZX(2.5), ZX(3.2))
for sg in (1, -1):
    K.bollard(S, sg * 1.2, sheer_at(ZX(3.4))[1] + 0.04, ZX(3.4), mat='Dark')
    K.bollard(S, sg * 1.3, sheer_at(ZX(13.6))[1] + 0.04, ZX(13.6), mat='Dark')
if FONT:
    for sg in (1, -1):
        zc = ZX(1.15)
        x = K.edge_at(top, zc)[0] - 0.05
        # the hull side there: a little inboard of the gunwale, 0.8 m up
        ex = (0, 0, -1) if sg > 0 else (0, 0, 1)
        xs = lerp(chine(0.08)[0], x, 0.7) + 0.06
        add_text(S, 'White', '848', 0.62, FONT, (sg * xs, 0.72, zc), ex, (0, 1, 0), (sg, 0, 0), 0.02)

# ═════════════ superstructure: wheelhouse (fwd) and troop compartment ═════════════
WZ0, WZ1 = ZX(4.0), ZX(6.6)
TZ0, TZ1 = ZX(6.7), ZX(10.9)
def house(z0, z1, y0, y1, w0, w1, front_rake=0.0, back_rake=0.0, mat='Camo'):
    """armoured house: sloped sides (w0 half-width at y0, w1 at y1), optionally raked front / back faces"""
    r0 = [(-w0, y0, z0), (w0, y0, z0), (w0, y0, z1), (-w0, y0, z1)]
    r1 = [(-w1, y1, z0 + front_rake), (w1, y1, z0 + front_rake), (w1, y1, z1 - back_rake), (-w1, y1, z1 - back_rake)]
    for i in range(4):
        j = (i + 1) % 4
        q = [r0[i], r0[j], r1[j], r1[i]]
        n = [(0, 0.2, -1), (1, 0.2, 0), (0, 0.2, 1), (-1, 0.2, 0)][i]
        S.g(mat).face(q, [camo_uv(*p) for p in q], n)
    S.g(mat).face(r1, [camo_uv(*p) for p in r1], (0, 1, 0))
    return r0, r1
ys_w = sheer_at(WZ0)[1] - 0.05
house(WZ0, TZ1, ys_w, 2.5, 1.3, 1.08, front_rake=0.55, back_rake=0.0)
# the troop compartment roof sits a little higher, with a shallow step at the wheelhouse's back
house(TZ0, TZ1, 2.45, 2.6, 1.1, 1.05)
# wheelhouse windows: three on the raked front, two a side (dark armoured glass, frames proud)
def pane(p0, p1, p2, p3, n):
    S.g('Glass').face([p0, p1, p2, p3], None, n)
yw0, yw1 = 1.85, 2.35
def front_pt(x, y):
    t = (y - ys_w) / (2.5 - ys_w)
    return (x, y, WZ0 + 0.55 * t - 0.02)
for k in range(3):
    xa, xb = -1.02 + k * 0.7, -1.02 + k * 0.7 + 0.62
    pane(front_pt(xa, yw0), front_pt(xb, yw0), front_pt(xb * 0.97, yw1), front_pt(xa * 0.97, yw1), (0, 0.6, -1))
for sg in (1, -1):
    for (za, zb) in ((WZ0 + 0.75, WZ0 + 1.45), (WZ0 + 1.6, WZ0 + 2.3)):
        x = sg * (lerp(1.3, 1.08, (yw0 - ys_w) / (2.5 - ys_w)) + 0.015)
        x1 = sg * (lerp(1.3, 1.08, (yw1 - ys_w) / (2.5 - ys_w)) + 0.015)
        pane((x, yw0, za), (x, yw0, zb), (x1, yw1, zb), (x1, yw1, za), (sg, 0.2, 0))
    # three small windows a side in the troop compartment's hull
    for k in range(3):
        zc = TZ0 + 0.8 + k * 1.3
        x = sg * (sheer_at(zc)[0] + 0.01)
        pane((x, 0.95, zc - 0.22), (x, 0.95, zc + 0.22), (x, 1.2, zc + 0.22), (x, 1.2, zc - 0.22), (sg, 0, 0))
# roof: the wheelhouse mast, the ring mount on the troop roof, vents, the aft folding mast
S.cyl('Frame', (0.7, 0, ZX(6.2)), 0.06, 0.05, 2.5, 4.1, 8)
S.beam('Frame', (0.2, 3.6, ZX(6.2)), (1.2, 3.6, ZX(6.2)), 0.05)
K.radome(S, 0.7, 4.1, ZX(6.2), 0.2, mat='White', ped='Frame', ped_h=0.05)
K.whip(S, -0.8, 2.5, ZX(6.1), 1.6, r=0.02)
S.box('NavWhite', 0.65, 0.75, 3.9, 3.98, ZX(6.2) - 0.05, ZX(6.2) + 0.05)
S.box('NavRed', -1.12, -1.08, 2.3, 2.4, WZ0 + 0.3, WZ0 + 0.45)
S.box('NavGreen', 1.08, 1.12, 2.3, 2.4, WZ0 + 0.3, WZ0 + 0.45)
# ring mount (40 mm grenade launcher) on the troop compartment roof
RZ = ZX(7.7)
S.cyl('Frame', (0, 0, RZ), 0.55, 0.55, 2.6, 2.7, 16, cap1=False)
S.cyl('Frame', (0, 0, RZ), 0.5, 0.5, 2.6, 2.7, 16, cap0=False, cap1=False)
S.cyl('Gun', (0, 0, RZ), 0.08, 0.08, 2.6, 3.0, 8)
S.box('Gun', -0.14, 0.14, 2.95, 3.2, RZ - 0.25, RZ + 0.35)
S.cyl('Gun', (0, 3.08, 0), 0.05, 0.05, RZ - 0.75, RZ - 0.25, 8, axis='z')
S.box('Gun', 0.14, 0.3, 2.95, 3.15, RZ - 0.1, RZ + 0.2)
# aft folding mast (radar, antennas), exhausts, engine-room hatches, life rafts
MZ = ZX(11.3)
for sg in (1, -1):
    S.beam('Frame', (sg * 0.5, sheer_at(MZ)[1], MZ), (sg * 0.12, 4.2, MZ - 0.2), 0.08)
S.box('Frame', -0.35, 0.35, 4.15, 4.25, MZ - 0.45, MZ + 0.1)
S.box('White', -0.5, 0.5, 4.25, 4.4, MZ - 0.3, MZ - 0.05)          # radar antenna
K.whip(S, 0.3, 4.25, MZ, 1.2, r=0.02)
S.box('NavWhite', -0.05, 0.05, 4.4, 4.5, MZ - 0.1, MZ)
for sg in (1, -1):
    ys = sheer_at(ZX(12.2))[1]
    S.box('Dark', sg * 0.9 - 0.2, sg * 0.9 + 0.2, ys, ys + 0.3, ZX(12.0), ZX(12.5))           # exhaust boxes
    S.box('Dark', sg * 0.95 - 0.15, sg * 0.95 + 0.15, ys + 0.3, ys + 0.34, ZX(12.05), ZX(12.45))
S.box('Camo', -0.7, 0.7, sheer_at(ZX(13.0))[1] + 0.03, sheer_at(ZX(13.0))[1] + 0.1, ZX(12.7), ZX(14.2), uvf=camo_uv)
K.raft(S, (0.0, sheer_at(ZX(12.2))[1] + 0.35, ZX(12.2)), 'x', L=1.2, r=0.28, mat='White')

# ═════════════ waterjets with reversing buckets ═════════════
for sg in (1, -1):
    x = sg * 0.75
    S.box('Dark', x - 0.44, x + 0.44, -0.55, 0.3, ZT, ZT + 0.12)                       # transom flange
    S.cyl('Frame', (x, -0.12, 0), 0.26, 0.18, ZT + 0.12, ZT + 0.75, 12, axis='z')     # steering nozzle
    S.cyl('Dark', (x, -0.12, 0), 0.15, 0.15, ZT + 0.74, ZT + 0.76, 12, axis='z', cap0=False)
    # reversing bucket above the nozzle
    for yb in (0.12, 0.28):
        S.box('Dark', x - 0.3, x + 0.3, yb, yb + 0.06, ZT + 0.5, ZT + 1.2)
    S.box('Dark', x - 0.32, x + 0.32, -0.45, 0.35, ZT + 1.12, ZT + 1.2)
    for sx in (-0.29, 0.29):
        S.box('Dark', x + sx - 0.03, x + sx + 0.03, -0.3, 0.3, ZT + 0.3, ZT + 1.15)

root = bpy.data.objects.new('cb90', None)
bpy.context.collection.objects.link(root)
S.build(parent=root, sharp_deg=35)

# ═════════════ Rig ═════════════
# bow ramp: the front plate, hinged at its lower edge on the well floor, lowers forward onto the shore
Rp = Part('door_ramp')
Rp.box('Camo', -0.6, 0.6, 1.0, 2.2, ZB - 0.08, ZB + 0.02, uvf=camo_uv)
for yy in (1.3, 1.65, 2.0):
    Rp.box('Dark', -0.55, 0.55, yy - 0.03, yy + 0.03, ZB + 0.02, ZB + 0.06)      # stiffeners / treads (inside face)
K.hinged(Rp, 'door_ramp', (0, 1.0, ZB - 0.03), root, (1, 0, 0), -1.95)
# companionway hatch on the foredeck (the troops come up here to the ramp)
Hb = Part('hatch_bow')
yb = sheer_at(ZX(2.6))[1] + 0.08
Hb.box('Camo', -0.4, 0.4, yb, yb + 0.1, ZX(2.2), ZX(3.0), uvf=camo_uv)
Hb.box('Dark', -0.08, 0.08, yb + 0.1, yb + 0.14, ZX(2.8), ZX(2.95))
S2 = Part('cb90_static2')
S2.box('Dark', -0.44, 0.44, yb - 0.3, yb, ZX(2.15), ZX(3.05))                 # the hatch coaming (opening)
K.hinged(Hb, 'hatch_bow', (0, yb + 0.05, ZX(3.0)), root, (1, 0, 0), 1.9)
# commander's hatch on the wheelhouse roof, two troop-compartment roof hatches
def roof_hatch(name, x, z, y, w=0.7, l=0.7, hinge='aft'):
    Hp = Part(name)
    Hp.box('Camo', x - w / 2, x + w / 2, y, y + 0.08, z - l / 2, z + l / 2, uvf=camo_uv)
    Hp.box('Dark', x - 0.06, x + 0.06, y + 0.08, y + 0.12, z - l / 2 + 0.05, z - l / 2 + 0.15)
    S2.box('Dark', x - w / 2 - 0.04, x + w / 2 + 0.04, y - 0.02, y + 0.005, z - l / 2 - 0.04, z + l / 2 + 0.04)
    K.hinged(Hp, name, (x, y + 0.04, z + l / 2), root, (1, 0, 0), 1.9)
roof_hatch('hatch_roof', -0.55, ZX(5.4), 2.5)
roof_hatch('hatch_troop_1', 0.0, ZX(9.1), 2.6)
roof_hatch('hatch_troop_2', 0.0, ZX(10.2), 2.6, l=0.6)
# twin 12.7 mm mount on the wheelhouse roof (fired from the helm)
G = Part('twin_mount')
GZ = ZX(4.5)
G.cyl('Camo', (0.35, 0, GZ), 0.42, 0.42, 2.5, 2.72, 14)
G.box('Camo', 0.1, 0.6, 2.72, 3.12, GZ - 0.3, GZ + 0.35, uvf=camo_uv)
for sx in (0.22, 0.48):
    G.cyl('Gun', (sx, 2.93, 0), 0.045, 0.045, GZ - 1.3, GZ - 0.3, 8, axis='z')
    G.cyl('Gun', (sx, 2.93, 0), 0.03, 0.03, GZ - 1.55, GZ - 1.3, 6, axis='z')
G.box('Dark', 0.62, 0.8, 2.8, 3.0, GZ - 0.2, GZ + 0.1)                        # sight
S2.build(parent=root)
# the mount trains about its own vertical axis: poseRig(boat, 'turret', k) turns it k·180° (k −1..1); the muzzles ride it
TO = (0.35, 2.5, GZ)
tur = K.rig_node('turret', G.mesh(origin=TO), TO, root, None, {'t': 'turret', 'hinge': [0, 1, 0], 'open': 3.1416})
for i, sx in enumerate((0.22, 0.48)):
    K.point('muzzle_%d' % (i + 1), (sx - TO[0], 2.93 - TO[1], -1.55), tur)
# steering wheel at the helm (port side of the wheelhouse)
W = Part('wheel')
wc = (-0.55, 1.55, WZ0 + 0.95)
tilt = math.radians(30)
def wp(u, v, w=0.0):
    return (wc[0] + u, wc[1] + v * math.cos(tilt) + w * math.sin(tilt), wc[2] - v * math.sin(tilt) + w * math.cos(tilt))
rim = [wp(0.2 * math.cos(2 * math.pi * k / 16), 0.2 * math.sin(2 * math.pi * k / 16)) for k in range(16)]
K.sweep_tube(W, rim + [rim[0]], 0.017, 'Dark', n=6, cap=False)
for k in range(3):
    a = 2 * math.pi * k / 3 + math.pi / 2
    W.beam('Dark', wp(0, 0), wp(0.19 * math.cos(a), 0.19 * math.sin(a)), 0.02)
W.beam('Dark', wp(0, 0, -0.25), wp(0, 0, 0.03), 0.06)
K.rig_node('wheel', W.mesh(origin=wc), wc, root, None, {'t': 'wheel', 'hinge': [0.0, round(math.sin(tilt), 4), round(math.cos(tilt), 4)], 'open': 2.4})
# seats: helmsman and commander in the wheelhouse, gunners at the mounts, 6 rows × 3 troops
K.point('seat_driver', (-0.55, 1.1, WZ0 + 1.5), root)
K.point('seat_commander', (0.55, 1.1, WZ0 + 1.5), root)
K.point('seat_gunner', (0.35, 2.5, GZ + 0.8), root)
K.point('seat_gunner_2', (0.0, 2.6, RZ + 0.55), root)
n = 1
for row in range(6):
    z = TZ0 + 0.45 + row * 0.62
    for x in (-0.75, 0.0, 0.75):
        K.point('seat_%d' % n, (x, 1.0, z), root)
        n += 1
K.point('muzzle_3', (0.0, 3.08, RZ - 0.75), root)
for i, sg in enumerate((-1, 1)):
    K.point('jet_%d' % (i + 1), (sg * 0.75, -0.12, ZT + 0.76), root, ((1, 0, 0), math.pi / 2))   # +Y points aft
K.point('hatch_entry', (1.5, sheer_at(ZX(13.0))[1], ZX(13.0)), root)

# ═════════════ layout ═════════════
wl = []
for (k, c, co, mid, sh) in st:
    pts = [k, c, co, mid, sh]
    for a, b2 in zip(pts, pts[1:]):
        if a[1] <= 0 <= b2[1]:
            t = (0 - a[1]) / (b2[1] - a[1]) if b2[1] != a[1] else 0
            wl.append((round(a[0] + (b2[0] - a[0]) * t, 3), round(k[2], 3)))
            break
waterline = wl + [(-x, z) for x, z in reversed(wl)]
layout = {
    'version': 1, 'deckY': 1.4, 'shadowY': 2.0, 'L': 15.9, 'draft': 0.8,
    'waterline': [[x, z] for x, z in waterline],
    'deck': [[round(p[0], 3), round(p[2], 3)] for p in deck_pts[::2]] + [[round(-p[0], 3), round(p[2], 3)] for p in reversed(deck_pts[::2])],
    'fx': {'bowWave': 2.8, 'sternWave': 2.0, 'contact': 0.55, 'pile': 0.3, 'occlusion': 1.5, 'maxLen': 500, 'seg': 3, 'spray': 0.28},
    'mounts': [],
}
root['skywar'] = json.dumps(layout, separators=(',', ':'))
print('cb90 tris ~', S.tris() + S2.tris(), 'mount', G.tris())
os.makedirs(os.path.dirname(os.path.abspath(OUT)), exist_ok=True)
bpy.ops.export_scene.gltf(filepath=OUT, export_format='GLB', export_extras=True, export_yup=True,
                          export_materials='EXPORT', export_image_format='AUTO', export_cameras=False, export_lights=False)
print('exported', OUT, os.path.getsize(OUT) // 1024, 'KB')
