# ═══════════════════════════════════════════════════════════════
# 11 m Naval Special Warfare RHIB — scripted model for Blender (run headless):
#   blender -b -P tools/ships/rhib_model.py -- <texdir> models/ships/rhib.glb
# Game frame (shipkit.py): x starboard, y up (0 = waterline), bow −z.
# Reference: NSW RHIB (US Navy / United States Marine Inc.): LOA 11 m, beam 3.2 m, draft ~0.9 m, deep-V
# GRP/Kevlar hull with a foam-filled collar, twin diesels driving waterjets, crew 3 + 8 passengers on
# shock-mitigating jockey seats, centre console, radar arch aft, pintle mounts fore and aft.
# Rig (tools/ships/RIG.md): seat_driver, seat_nav, seat_1..8, seat_gunner (bow mount), wheel,
# jet_1 / jet_2 (nozzles at the transom), muzzle_1 (bow gun), hatch_entry (where you step aboard).
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
material('BoatHull', srgb(0x5f656b), 0.05, 0.55)
material('Bottom', srgb(0x2a2d30), 0.05, 0.7)
material('Tube', srgb(0x1c1e20), 0.0, 0.85)
material('TubeSeam', srgb(0x121314), 0.0, 0.9)
material('BoatDeck', srgb(0xffffff), 0.0, 0.9, image=os.path.join(TEX, 'boat_deck.jpg'))
material('Console', srgb(0x585e63), 0.05, 0.5)
material('Seat', srgb(0x141516), 0.0, 0.8)
material('Frame', srgb(0x8a8f93), 0.6, 0.35)
material('Dark', srgb(0x2c2f32), 0.2, 0.7)
material('Glass', srgb(0x1a2631), 0.5, 0.1)
material('Screen', srgb(0x0a2030), 0.2, 0.2, emit=srgb(0x2a6a8a), emit_strength=1.2)
material('Gun', srgb(0x1d1f21), 0.5, 0.45)
material('NavRed', srgb(0xff2020), 0.0, 0.5, emit=srgb(0xff2020), emit_strength=5.0)
material('NavGreen', srgb(0x20ff50), 0.0, 0.5, emit=srgb(0x20ff50), emit_strength=5.0)
material('NavWhite', srgb(0xffffff), 0.0, 0.5, emit=srgb(0xfff4e0), emit_strength=5.0)

L = 11.0
ZB, ZS = -5.5, 5.5          # stem, transom
DECK = 0.32                 # cockpit sole above the waterline
TUBE_R = 0.29
S = Part('rhib_static')

# ═════════════ hull (deep V, 24° deadrise at the transom, finer forward) ═════════════
def keel_y(s):
    return -0.62 + 0.95 * (1 - smoothstep(0.0, 0.42, s)) ** 1.6
def chine(s):
    w = 1.18 * (smoothstep(0.0, 0.5, s) ** 0.55)
    return (w, keel_y(s) + w * math.tan(math.radians(lerp(52, 23, smoothstep(0.0, 0.6, s)))))
def sheer(s):
    w = 1.34 * (smoothstep(-0.05, 0.42, s) ** 0.5)
    return (max(w, 0.02), 0.56 + 0.22 * (1 - smoothstep(0.0, 0.45, s)))
st = K.planing_hull(S, ZB, ZS, keel_y, chine, sheer, None, n=30, mat='BoatHull', bottom_mat='Bottom', rail=0.05)

# ═════════════ collar: the foam-filled tube round the gunwale, cones at the transom ═════════════
path = []
for i in range(len(st)):
    s = i / (len(st) - 1)
    sx, sy, z = st[i][4]
    path.append((sx + TUBE_R * 0.55 * smoothstep(0.0, 0.2, s), sy + TUBE_R * 0.75, z))
# round the bow: join the two sides through the stem
bow = []
x0, y0, z0 = path[0]
for k in range(1, 6):
    a = math.pi / 2 * k / 6
    bow.append((0.0 + (path[2][0]) * math.cos(a) * 0.0, y0 + 0.05, z0 - 0.15 * math.sin(a)))
loop = [(-x, y, z) for x, y, z in reversed(path)] + [(0.0, y0 + 0.06, z0 - 0.18)] + path
loop = [p for i, p in enumerate(loop) if i == 0 or math.dist(p, loop[i - 1]) > 0.05]
K.sweep_tube(S, loop, TUBE_R, 'Tube', n=14, cap=True, rfun=lambda i: TUBE_R * (0.8 if i in (0, len(loop) - 1) else 1.0))
# rubbing strake and grab lines along the tube
for sg in (1, -1):
    pts = [(sg * (p[0] + TUBE_R * 0.98), p[1] - 0.05, p[2]) for p in path[3:-1]]
    for a, b in zip(pts, pts[1:]):
        S.beam('TubeSeam', a, b, 0.07, 0.05, caps=False)
    for i in range(4, len(path) - 2, 3):
        p = path[i]
        S.beam('Dark', (sg * (p[0] + 0.05), p[1] + TUBE_R + 0.02, p[2]), (sg * (path[i + 2][0] + 0.05), path[i + 2][1] + TUBE_R + 0.02, path[i + 2][2]), 0.025, caps=False)

# ═════════════ deck ═════════════
deck_pts = []
for (k, c, co, mid, sh) in st[3:]:
    deck_pts.append((sh[0] - 0.02, sh[2]))
deck_poly = [(x, z) for x, z in deck_pts] + [(-x, z) for x, z in reversed(deck_pts)]
S.prism(deck_poly, DECK - 0.05, DECK, 'BoatDeck', 'BoatHull', None, uv_top=lambda x, y, z: (x / 1.5, z / 1.5))

# ═════════════ console, windscreen, wheel housing ═════════════
CZ0, CZ1 = -2.3, -1.25
S.box('Console', -0.52, 0.52, DECK, DECK + 1.05, CZ0, CZ1)
S.g('Console').face([(-0.52, DECK + 1.05, CZ0), (0.52, DECK + 1.05, CZ0), (0.48, DECK + 1.25, CZ1 - 0.1), (-0.48, DECK + 1.25, CZ1 - 0.1)], None, (0, 1, -0.4))
S.box('Screen', -0.34, 0.34, DECK + 1.08, DECK + 1.22, CZ1 - 0.34, CZ1 - 0.3)
S.box('Screen', -0.1, 0.4, DECK + 0.7, DECK + 0.98, CZ1 + 0.0, CZ1 + 0.02)
# windscreen with a frame
S.g('Glass').face([(-0.5, DECK + 1.1, CZ0 - 0.02), (0.5, DECK + 1.1, CZ0 - 0.02), (0.46, DECK + 1.6, CZ0 + 0.22), (-0.46, DECK + 1.6, CZ0 + 0.22)], None, (0, 0.4, -1))
S.g('Glass').face([(-0.5, DECK + 1.1, CZ0 - 0.02), (-0.46, DECK + 1.6, CZ0 + 0.22), (0.46, DECK + 1.6, CZ0 + 0.22), (0.5, DECK + 1.1, CZ0 - 0.02)], None, (0, -0.4, 1))
K.sweep_tube(S, [(-0.52, DECK + 1.08, CZ0 - 0.03), (-0.47, DECK + 1.62, CZ0 + 0.23), (0.47, DECK + 1.62, CZ0 + 0.23), (0.52, DECK + 1.08, CZ0 - 0.03)], 0.025, 'Frame', n=6)
# grab rail round the console
K.sweep_tube(S, [(-0.62, DECK + 0.3, CZ1 + 0.05), (-0.62, DECK + 1.0, CZ1 + 0.05), (-0.62, DECK + 1.0, CZ0 - 0.1), (0.62, DECK + 1.0, CZ0 - 0.1), (0.62, DECK + 1.0, CZ1 + 0.05), (0.62, DECK + 0.3, CZ1 + 0.05)], 0.02, 'Frame', n=6)
# nav lights: sidelights on the console, masthead / stern light on the arch
S.box('NavRed', -0.56, -0.52, DECK + 0.95, DECK + 1.03, CZ0 + 0.1, CZ0 + 0.25)
S.box('NavGreen', 0.52, 0.56, DECK + 0.95, DECK + 1.03, CZ0 + 0.1, CZ0 + 0.25)

# ═════════════ shock-mitigating jockey seats (crew 2 behind the console, 8 passengers aft) ═════════════
def jockey(x, z, part=S):
    part.box('Frame', x - 0.06, x + 0.06, DECK, DECK + 0.62, z - 0.06, z + 0.06)           # post (with the damper)
    part.box('Frame', x - 0.2, x + 0.2, DECK, DECK + 0.04, z - 0.25, z + 0.25)             # foot
    part.box('Seat', x - 0.19, x + 0.19, DECK + 0.62, DECK + 0.78, z - 0.34, z + 0.3)      # saddle
    part.box('Seat', x - 0.16, x + 0.16, DECK + 0.78, DECK + 0.9, z + 0.05, z + 0.3)       # bolster
    K.sweep_tube(part, [(x - 0.22, DECK + 0.95, z - 0.32), (x - 0.22, DECK + 1.05, z - 0.42), (x + 0.22, DECK + 1.05, z - 0.42), (x + 0.22, DECK + 0.95, z - 0.32)], 0.018, 'Frame', n=5)
    return (x, DECK + 0.78, z)
seats = {}
seats['driver'] = jockey(-0.3, CZ1 + 0.75)
seats['nav'] = jockey(0.3, CZ1 + 0.75)
n = 1
for row in range(4):
    z = CZ1 + 1.6 + row * 0.85
    for x in (-0.42, 0.42):
        seats[str(n)] = jockey(x, z)
        n += 1

# ═════════════ engine box, radar arch, antennas, stern gear ═════════════
EZ0 = CZ1 + 1.6 + 3 * 0.85 + 0.6
S.box('Console', -0.95, 0.95, DECK, DECK + 0.55, EZ0, ZS - 0.35)
S.box('Dark', -0.85, 0.85, DECK + 0.55, DECK + 0.58, EZ0 + 0.1, ZS - 0.45)
for sg in (1, -1):
    S.box('Dark', sg * 0.7 - 0.12, sg * 0.7 + 0.12, DECK + 0.58, DECK + 0.64, EZ0 + 0.25, EZ0 + 0.45)   # vents
AZ = EZ0 + 0.35
arch = [(-1.1, DECK, AZ + 0.2), (-0.95, DECK + 1.9, AZ - 0.05), (-0.7, DECK + 2.25, AZ - 0.12), (0.7, DECK + 2.25, AZ - 0.12), (0.95, DECK + 1.9, AZ - 0.05), (1.1, DECK, AZ + 0.2)]
K.sweep_tube(S, arch, 0.06, 'Frame', n=8)
S.box('Frame', -0.75, 0.75, DECK + 2.2, DECK + 2.3, AZ - 0.35, AZ + 0.15)
K.radome(S, 0.0, DECK + 2.3, AZ - 0.1, 0.33, mat='BoatHull', ped='Frame', ped_h=0.12)
for (x, h) in ((-0.6, 1.8), (0.6, 1.4), (0.35, 0.9)):
    K.whip(S, x, DECK + 2.3, AZ - 0.25, h, mat='Dark', r=0.02)
S.box('NavWhite', -0.05, 0.05, DECK + 2.95, DECK + 3.05, AZ - 0.15, AZ - 0.05)
S.cyl('NavWhite', (0, 0, AZ), 0.05, 0.05, DECK + 2.3, DECK + 2.4, 6)
# waterjet nozzles and steering deflectors under the transom
for sg in (1, -1):
    x = sg * 0.52
    S.cyl('Dark', (x, -0.12, 0), 0.19, 0.16, ZS - 0.1, ZS + 0.35, 12, axis='z')
    S.box('Dark', x - 0.2, x + 0.2, -0.36, 0.1, ZS + 0.35, ZS + 0.5)
# towing / lifting eyes, bow fairlead, stern cleats
S.cyl('Frame', (0, 0, ZB + 0.8), 0.05, 0.05, DECK, DECK + 0.3, 6)
for sg in (1, -1):
    S.box('Frame', sg * 1.0 - 0.1, sg * 1.0 + 0.1, DECK, DECK + 0.12, ZS - 0.5, ZS - 0.3)

# ═════════════ bow pintle mount with an M2 .50 cal ═════════════
GZ = ZB + 1.7
S.cyl('Frame', (0, 0, GZ), 0.06, 0.06, DECK, DECK + 1.0, 8)
S.box('Frame', -0.3, 0.3, DECK, DECK + 0.05, GZ - 0.3, GZ + 0.3)
S.box('Gun', -0.1, 0.1, DECK + 1.0, DECK + 1.22, GZ - 0.4, GZ + 0.5)
S.cyl('Gun', (0, DECK + 1.12, 0), 0.03, 0.03, GZ - 1.55, GZ - 0.4, 6, axis='z')
S.cyl('Gun', (0, DECK + 1.12, 0), 0.045, 0.045, GZ - 0.75, GZ - 0.4, 6, axis='z')
S.box('Gun', 0.1, 0.28, DECK + 0.95, DECK + 1.15, GZ - 0.15, GZ + 0.2)             # ammo can
for sg in (1, -1):
    S.box('Gun', sg * 0.12 - 0.02, sg * 0.12 + 0.02, DECK + 1.0, DECK + 1.25, GZ + 0.45, GZ + 0.6)   # spade grips

root = bpy.data.objects.new('rhib', None)
bpy.context.collection.objects.link(root)
S.build(parent=root, sharp_deg=38)

# ═════════════ Rig ═════════════
W = Part('wheel')
wc = (-0.28, DECK + 1.0, CZ1 + 0.2)
tilt = math.radians(35)                # the shaft leans back 35° from horizontal, towards the helmsman
def wp(u, v, w=0.0):                   # wheel plane: u across, v up the face (leaning forward), w along the shaft (aft/up)
    return (wc[0] + u, wc[1] + v * math.cos(tilt) + w * math.sin(tilt), wc[2] - v * math.sin(tilt) + w * math.cos(tilt))
rim = [wp(0.19 * math.cos(2 * math.pi * k / 16), 0.19 * math.sin(2 * math.pi * k / 16)) for k in range(16)]
K.sweep_tube(W, rim + [rim[0]], 0.017, 'Dark', n=6, cap=False)
for k in range(3):
    a = 2 * math.pi * k / 3 + math.pi / 2
    W.beam('Dark', wp(0, 0), wp(0.18 * math.cos(a), 0.18 * math.sin(a)), 0.02)
W.beam('Dark', wp(0, 0, -0.28), wp(0, 0, 0.03), 0.06)          # the shaft into the console
# the wheel turns about its shaft: the normal of the tilted wheel plane
axis = (0.0, math.sin(tilt), math.cos(tilt))
ob = K.rig_node('wheel', W.mesh(origin=wc), wc, root, None, {'t': 'wheel', 'hinge': [round(v, 4) for v in axis], 'open': 2.4})
for k, p in seats.items():
    K.point('seat_' + k, p, root)
K.point('seat_gunner', (0, DECK, GZ + 0.75), root)
K.point('muzzle_1', (0, DECK + 1.12, GZ - 1.55), root)
for i, sg in enumerate((-1, 1)):
    K.point('jet_%d' % (i + 1), (sg * 0.52, -0.12, ZS + 0.5), root, ((1, 0, 0), -math.pi / 2))   # +Y of the jet points aft
K.point('hatch_entry', (1.2, DECK, 1.2), root)

# waterline outline for the foam line: the hull at y = 0
wl = []
for (k, c, co, mid, sh) in st:
    pts = [k, c, co, mid, sh]
    x = None
    for a, b in zip(pts, pts[1:]):
        if a[1] <= 0 <= b[1]:
            t = (0 - a[1]) / (b[1] - a[1]) if b[1] != a[1] else 0
            x = a[0] + (b[0] - a[0]) * t
            break
    if x is not None:
        wl.append((round(x, 3), round(k[2], 3)))
waterline = wl + [(-x, z) for x, z in reversed(wl)]
layout = {
    'version': 1, 'deckY': DECK, 'shadowY': 0.9, 'L': L, 'draft': 0.62,
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
