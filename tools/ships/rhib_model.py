# ═══════════════════════════════════════════════════════════════
# 11 m Naval Special Warfare RIB — scripted model for Blender (run headless):
#   blender -b -P tools/ships/rhib_model.py -- <texdir> models/ships/rhib.glb
# Game frame (shipkit.py): x starboard, y up (0 = waterline), bow −z.
# Reference: US Navy 11 m NSW RIB (United States Marine Inc.; USMI, americanspecialops, navyseals.com, photos of
# Special Boat Teams 12 and 20): LOA 11.0 m over the tube tails, beam 3.2 m, 0.5 m operating draught, deep-V
# hull with a foam-collar tube (Ø ~0.55 m), deck ~0.6 m above the water, centre console 1.1 × 1.0 m with an acrylic
# windscreen under a four-legged folding radar tower (radome platform ~4.5 m up), coxswain and navigator on
# shock-mitigating jockey seats, four rows of two for eight passengers, engine box aft (2 × Caterpillar 3126 driving
# KaMeWa waterjets), weapon pedestals forward (M2) and aft (M240), grey hull, black tube.
# Rig (tools/ships/RIG.md): seat_driver, seat_nav, seat_1..8 (+Z = backwards: a seated figure faces −Z),
# seat_gunner (bow gun), seat_gunner_2 (aft gun), wheel, jet_1 / jet_2 (nozzles: +Y points aft along the jet),
# muzzle_1 (bow M2), muzzle_2 (aft M240), hatch_entry (where you step aboard over the tube).
# ═══════════════════════════════════════════════════════════════
import bpy, math, sys, os, json
sys.dont_write_bytecode = True
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from shipkit import Part, material, srgb, smoothstep, lerp, clamp
import navkit as K

args = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
TEX = args[0] if len(args) > 0 else '/tmp/shiptex'
OUT = args[1] if len(args) > 1 else 'rhib.glb'

bpy.ops.wm.read_factory_settings(use_empty=True)
material('BoatHull', srgb(0x4f555a), 0.05, 0.55)
material('Bottom', srgb(0x26292b), 0.05, 0.7)
material('Tube', srgb(0x1a1c1e), 0.0, 0.85)
material('TubeSeam', srgb(0x101112), 0.0, 0.9)
material('BoatDeck', srgb(0xffffff), 0.0, 0.9, image=os.path.join(TEX, 'boat_deck.jpg'))
material('Console', srgb(0x50565b), 0.05, 0.5)
material('Seat', srgb(0x141516), 0.0, 0.8)
material('Frame', srgb(0x8a8f93), 0.6, 0.35)
material('Dark', srgb(0x2c2f32), 0.2, 0.7)
material('Glass', srgb(0x1a2631), 0.5, 0.1)
material('Screen', srgb(0x0a2030), 0.2, 0.2, emit=srgb(0x2a6a8a), emit_strength=1.0)
material('Gun', srgb(0x1d1f21), 0.5, 0.45)
material('NavRed', srgb(0xff2020), 0.0, 0.5, emit=srgb(0xff2020), emit_strength=5.0)
material('NavGreen', srgb(0x20ff50), 0.0, 0.5, emit=srgb(0x20ff50), emit_strength=5.0)
material('NavWhite', srgb(0xffffff), 0.0, 0.5, emit=srgb(0xfff4e0), emit_strength=5.0)

L = 11.0
ZB, ZT, ZTUBE = -5.35, 4.85, 5.45   # stem, transom, the tube tails behind it
def ZX(x):
    """x metres aft of the tube's nose (the published positions) → game z"""
    return -5.5 + x
DECK = 0.6                  # cockpit sole above the waterline
TUBE_R, TUBE_Y = 0.275, 0.73
S = Part('rhib_static')

# ═════════════ hull (deep V, 23° deadrise at the transom, finer forward) ═════════════
def keel_y(s):
    return -0.5 + 0.9 * (1 - smoothstep(0.0, 0.42, s)) ** 1.6
def chine(s):
    w = 1.12 * (smoothstep(0.0, 0.5, s) ** 0.55)
    return (w, keel_y(s) + w * math.tan(math.radians(lerp(52, 23, smoothstep(0.0, 0.6, s)))))
def sheer(s):
    w = 1.3 * (smoothstep(-0.05, 0.42, s) ** 0.5)
    return (max(w, 0.02), 0.52 + 0.4 * (1 - smoothstep(0.0, 0.45, s)))
st = K.planing_hull(S, ZB, ZT, keel_y, chine, sheer, None, n=30, mat='BoatHull', bottom_mat='Bottom', rail=0.05)

# ═════════════ collar: the tube round the gunwale, run on past the transom to its tails ═════════════
path = []
for i in range(len(st)):
    s = i / (len(st) - 1)
    sx, sy, z = st[i][4]
    path.append((sx + TUBE_R * 0.55 * smoothstep(0.0, 0.2, s), lerp(sy + TUBE_R * 0.9, TUBE_Y, smoothstep(0.0, 0.4, s)), z))
for k in range(1, 4):
    x, y, z = path[-1]
    path.append((x, y + 0.01 * k, ZT + (ZTUBE - ZT) * k / 3))
nose = (0.0, path[0][1] + 0.06, ZB - 0.15)
loop = [(-x, y, z) for x, y, z in reversed(path)] + [nose] + path
loop = [p for i, p in enumerate(loop) if i == 0 or math.dist(p, loop[i - 1]) > 0.05]
K.sweep_tube(S, loop, TUBE_R, 'Tube', n=14, cap=True, rfun=lambda i: TUBE_R * (0.72 if i in (0, len(loop) - 1) else 1.0))
# rubbing strake and grab line along the tube
for sg in (1, -1):
    pts = [(sg * (p[0] + TUBE_R * 0.98), p[1] - 0.05, p[2]) for p in path[3:-1]]
    for a, b in zip(pts, pts[1:]):
        S.beam('TubeSeam', a, b, 0.07, 0.05, caps=False)
    for i in range(4, len(path) - 4, 3):
        p, q = path[i], path[i + 2]
        S.beam('Dark', (sg * (p[0] + 0.05), p[1] + TUBE_R + 0.02, p[2]), (sg * (q[0] + 0.05), q[1] + TUBE_R + 0.02, q[2]), 0.025, caps=False)

# ═════════════ deck ═════════════
deck_pts = [(sh[0] - 0.02, sh[2]) for (k, c, co, mid, sh) in st[3:]]
deck_poly = [(x, z) for x, z in deck_pts] + [(-x, z) for x, z in reversed(deck_pts)]
S.prism(deck_poly, DECK - 0.05, DECK, 'BoatDeck', 'BoatHull', None, uv_top=lambda x, y, z: (x / 1.5, z / 1.5))

# ═════════════ console with its acrylic windscreen ═════════════
CZ0, CZ1 = ZX(4.2), ZX(5.3)
CT = 1.8                                  # console top above the waterline
S.box('Console', -0.5, 0.5, DECK, CT - 0.2, CZ0, CZ1)
S.g('Console').face([(-0.5, CT - 0.2, CZ0), (0.5, CT - 0.2, CZ0), (0.46, CT, CZ1 - 0.12), (-0.46, CT, CZ1 - 0.12)], None, (0, 1, -0.4))
for sx in (-0.5, 0.5):
    S.g('Console').face([(sx, CT - 0.2, CZ0), (sx, CT - 0.2, CZ1), (sx * 0.92, CT, CZ1 - 0.12)], None, (sx, 0, 0))
S.box('Console', -0.46, 0.46, CT - 0.2, CT, CZ1 - 0.12, CZ1)
S.box('Screen', -0.32, 0.32, CT - 0.12, CT - 0.02, CZ1 - 0.46, CZ1 - 0.42)     # plotter / radar display
S.box('Screen', -0.1, 0.3, CT - 0.55, CT - 0.3, CZ1 + 0.0, CZ1 + 0.02)
S.box('Dark', -0.4, -0.25, CT - 0.45, CT - 0.25, CZ1, CZ1 + 0.1)                 # throttles
g = S.g('Glass')
ws = [(-0.5, CT - 0.2, CZ0 - 0.02), (0.5, CT - 0.2, CZ0 - 0.02), (0.44, 2.3, CZ0 + 0.3), (-0.44, 2.3, CZ0 + 0.3)]
g.face(ws, None, (0, 0.4, -1))
g.face(ws[::-1], None, (0, -0.4, 1))
K.sweep_tube(S, [(-0.52, CT - 0.2, CZ0 - 0.03), (-0.45, 2.32, CZ0 + 0.31), (0.45, 2.32, CZ0 + 0.31), (0.52, CT - 0.2, CZ0 - 0.03)], 0.022, 'Frame', n=6)
S.box('NavRed', -0.54, -0.5, CT - 0.35, CT - 0.25, CZ0 + 0.1, CZ0 + 0.25)
S.box('NavGreen', 0.5, 0.54, CT - 0.35, CT - 0.25, CZ0 + 0.1, CZ0 + 0.25)

# ═════════════ the four-legged radar tower straddling the console (folds for air transport) ═════════════
TZ0, TZ1 = ZX(4.0), ZX(5.4)
TOP = 4.4
legs = [(sx, zz) for zz in (TZ0, TZ1) for sx in (-0.78, 0.78)]
for (sx, zz) in legs:
    K.sweep_tube(S, [(sx, DECK, zz), (sx * 0.9, TOP - 0.9, zz + (0.12 if zz == TZ0 else -0.12)), (sx * 0.55, TOP, (TZ0 + TZ1) / 2 + (-0.35 if zz == TZ0 else 0.35))], 0.045, 'Frame', n=8)
    S.box('Frame', sx - 0.08, sx + 0.08, DECK, DECK + 0.04, zz - 0.08, zz + 0.08)
for zz in (TZ0, TZ1):          # hinge collars where it folds, and a cross tube
    S.beam('Frame', (-0.74, 2.45, zz + (0.05 if zz == TZ0 else -0.05)), (0.74, 2.45, zz + (0.05 if zz == TZ0 else -0.05)), 0.05, caps=False)
S.cyl('Frame', (0, 0, (TZ0 + TZ1) / 2), 0.62, 0.62, TOP - 0.05, TOP + 0.03, 16)
K.radome(S, 0.0, TOP + 0.03, (TZ0 + TZ1) / 2, 0.36, mat='BoatHull', ped='Frame', ped_h=0.1)
for (x, h) in ((-0.5, 1.6), (0.5, 1.2)):
    K.whip(S, x, TOP + 0.03, (TZ0 + TZ1) / 2 + 0.3, h, mat='Dark', r=0.02)
S.box('NavWhite', -0.05, 0.05, TOP + 0.9, TOP + 1.0, (TZ0 + TZ1) / 2 - 0.05, (TZ0 + TZ1) / 2 + 0.05)
K.searchlight(S, 0.45, TOP + 0.03, (TZ0 + TZ1) / 2 - 0.35, mat='Frame')

# ═════════════ shock-mitigating jockey seats: coxswain + navigator, 4 rows of 2 passengers ═════════════
def jockey(x, z, part=S):
    part.box('Frame', x - 0.06, x + 0.06, DECK, DECK + 0.62, z - 0.06, z + 0.06)           # post (with the damper)
    part.box('Frame', x - 0.2, x + 0.2, DECK, DECK + 0.04, z - 0.25, z + 0.25)             # foot
    part.box('Seat', x - 0.19, x + 0.19, DECK + 0.62, DECK + 0.78, z - 0.28, z + 0.3)      # saddle
    part.box('Seat', x - 0.16, x + 0.16, DECK + 0.78, DECK + 1.02, z + 0.12, z + 0.3)      # backrest bolster
    K.sweep_tube(part, [(x - 0.22, DECK + 0.95, z - 0.26), (x - 0.22, DECK + 1.05, z - 0.36), (x + 0.22, DECK + 1.05, z - 0.36), (x + 0.22, DECK + 0.95, z - 0.26)], 0.018, 'Frame', n=5)
    return (x, DECK + 0.78, z)
seats = {}
seats['driver'] = jockey(0.45, ZX(5.7))
seats['nav'] = jockey(-0.45, ZX(5.7))
n = 1
for xr in (6.5, 7.3, 8.1, 8.9):
    for x in (0.45, -0.45):
        seats[str(n)] = jockey(x, ZX(xr))
        n += 1

# ═════════════ engine box, aft gun, stern gear ═════════════
EZ0 = ZX(9.35)
S.box('Console', -0.95, 0.95, DECK, 1.5, EZ0, ZT - 0.12)
S.box('Dark', -0.85, 0.85, 1.5, 1.53, EZ0 + 0.1, ZT - 0.2)
for sg in (1, -1):
    S.box('Dark', sg * 0.7 - 0.12, sg * 0.7 + 0.12, 1.53, 1.59, EZ0 + 0.25, EZ0 + 0.45)   # vents
# aft pintle mount with an M240 on the engine box
AGZ = ZX(9.8)
S.cyl('Frame', (0, 0, AGZ), 0.05, 0.05, 1.5, 2.0, 8)
S.box('Gun', -0.06, 0.06, 2.0, 2.14, AGZ - 0.3, AGZ + 0.35)
S.cyl('Gun', (0, 2.08, 0), 0.022, 0.022, AGZ + 0.35, AGZ + 1.0, 6, axis='z')
S.box('Gun', -0.05, 0.05, 1.86, 2.0, AGZ + 0.05, AGZ + 0.15)
# waterjet units (KaMeWa FF-series): nozzles with steering deflectors, reaching 0.8 m aft of the transom
for sg in (1, -1):
    x = sg * 0.45
    S.box('Dark', x - 0.22, x + 0.22, -0.3, 0.12, ZT, ZT + 0.35)
    S.cyl('Dark', (x, -0.09, 0), 0.13, 0.1, ZT + 0.35, ZT + 0.65, 10, axis='z')
    S.box('Dark', x - 0.15, x + 0.15, -0.26, 0.08, ZT + 0.62, ZT + 0.8)
S.box('BoatHull', -1.0, 1.0, 0.1, DECK + 0.05, ZT - 0.05, ZT)                            # transom face trim
S.cyl('Frame', (0, 0, ZB + 0.9), 0.05, 0.05, DECK, DECK + 0.3, 6)                         # bow eye
for sg in (1, -1):
    S.box('Frame', sg * 1.0 - 0.1, sg * 1.0 + 0.1, DECK, DECK + 0.12, ZT - 0.5, ZT - 0.3)

# ═════════════ bow pedestal with an M2 .50 cal ═════════════
GZ = ZX(3.05)
S.cyl('Frame', (0, 0, GZ), 0.07, 0.07, DECK, 2.0, 8)
S.box('Frame', -0.3, 0.3, DECK, DECK + 0.05, GZ - 0.3, GZ + 0.3)
S.box('Gun', -0.1, 0.1, 2.0, 2.24, GZ - 0.4, GZ + 0.5)
S.cyl('Gun', (0, 2.14, 0), 0.03, 0.03, GZ - 1.55, GZ - 0.4, 6, axis='z')
S.cyl('Gun', (0, 2.14, 0), 0.045, 0.045, GZ - 0.75, GZ - 0.4, 6, axis='z')
S.box('Gun', 0.1, 0.28, 1.95, 2.17, GZ - 0.15, GZ + 0.2)             # ammo can
for sg in (1, -1):
    S.box('Gun', sg * 0.12 - 0.02, sg * 0.12 + 0.02, 2.0, 2.27, GZ + 0.45, GZ + 0.6)   # spade grips

root = bpy.data.objects.new('rhib', None)
bpy.context.collection.objects.link(root)
S.build(parent=root, sharp_deg=38)

# ═════════════ Rig ═════════════
W = Part('wheel')
wc = (0.42, CT - 0.3, CZ1 + 0.14)
tilt = math.radians(35)                # the shaft leans back 35° from horizontal, towards the helmsman
def wp(u, v, w=0.0):                   # wheel plane: u across, v up the face (leaning forward), w along the shaft (aft/up)
    return (wc[0] + u, wc[1] + v * math.cos(tilt) + w * math.sin(tilt), wc[2] - v * math.sin(tilt) + w * math.cos(tilt))
rim = [wp(0.18 * math.cos(2 * math.pi * k / 16), 0.18 * math.sin(2 * math.pi * k / 16)) for k in range(16)]
K.sweep_tube(W, rim + [rim[0]], 0.017, 'Dark', n=6, cap=False)
for k in range(3):
    a = 2 * math.pi * k / 3 + math.pi / 2
    W.beam('Dark', wp(0, 0), wp(0.17 * math.cos(a), 0.17 * math.sin(a)), 0.02)
W.beam('Dark', wp(0, 0, -0.2), wp(0, 0, 0.03), 0.06)          # the shaft into the console
axis = (0.0, math.sin(tilt), math.cos(tilt))                   # the wheel turns about its shaft
K.rig_node('wheel', W.mesh(origin=wc), wc, root, None, {'t': 'wheel', 'hinge': [round(v, 4) for v in axis], 'open': 2.4})
for k, p in seats.items():
    K.point('seat_' + k, p, root)
K.point('seat_gunner', (0, DECK, GZ + 0.75), root)
K.point('seat_gunner_2', (0, 1.5, AGZ - 0.7), root)
K.point('muzzle_1', (0, 2.14, GZ - 1.55), root)
K.point('muzzle_2', (0, 2.08, AGZ + 1.0), root, ((0, 1, 0), math.pi))
for i, sg in enumerate((-1, 1)):
    K.point('jet_%d' % (i + 1), (sg * 0.45, -0.09, ZT + 0.8), root, ((1, 0, 0), math.pi / 2))   # +Y of the jet points aft
K.point('hatch_entry', (1.25, DECK, ZX(7.0)), root)

# waterline outline for the foam line: the hull at y = 0
wl = []
for (k, c, co, mid, sh) in st:
    pts = [k, c, co, mid, sh]
    for a, b in zip(pts, pts[1:]):
        if a[1] <= 0 <= b[1]:
            t = (0 - a[1]) / (b[1] - a[1]) if b[1] != a[1] else 0
            wl.append((round(a[0] + (b[0] - a[0]) * t, 3), round(k[2], 3)))
            break
waterline = wl + [(-x, z) for x, z in reversed(wl)]
layout = {
    'version': 1, 'deckY': DECK, 'shadowY': 1.0, 'L': L, 'draft': 0.5,
    'waterline': [[x, z] for x, z in waterline],
    'deck': [[round(x + TUBE_R, 3), z] for x, z in deck_pts[::2]] + [[round(-x - TUBE_R, 3), z] for x, z in reversed(deck_pts[::2])],
    'fx': {'bowWave': 2.2, 'sternWave': 1.6, 'contact': 0.45, 'pile': 0.25, 'occlusion': 1.2, 'maxLen': 420, 'seg': 3, 'spray': 0.22},
    'mounts': [],
}
root['skywar'] = json.dumps(layout, separators=(',', ':'))
print('rhib tris ~', S.tris(), 'wheel', W.tris())
os.makedirs(os.path.dirname(os.path.abspath(OUT)), exist_ok=True)
bpy.ops.export_scene.gltf(filepath=OUT, export_format='GLB', export_extras=True, export_yup=True,
                          export_materials='EXPORT', export_image_format='AUTO', export_cameras=False, export_lights=False)
print('exported', OUT, os.path.getsize(OUT) // 1024, 'KB')
