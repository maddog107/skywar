# ═══════════════════════════════════════════════════════════════
# Flight-deck crew and a deck tractor — scripted model for Blender (run headless):
#   blender -b -P tools/ships/deckcrew_model.py -- <texdir> models/ships/deckcrew.glb
# Frame (shipkit.py): x right, y up (0 = the deck), the figure faces −z.
# The crew figure comes apart at its joints so src/deckops.js can draw a whole deck crew as a few instanced meshes
# and pose them (walk, signal, kneel): each part is its own object with its origin on the joint.
#  • crew_torso: float coat / jersey, collar and cranial helmet with ear cups — drawn in the shirt colour of the
#    job (yellow: directors and shooters, green: catapult and arresting gear, blue: plane handlers, brown: plane
#    captains, purple: fuel, red: ordnance and crash & salvage, white: safety, LSOs, medical), so it's white here
#  • crew_head: face, neck and goggles (origin at the feet like the torso)
#  • crew_arm: sleeve and glove hanging from the shoulder joint (origin at the joint; shirt colour too)
#  • crew_leg: trouser leg and boot hanging from the hip joint (origin at the joint)
#  • tractor: an A/S32A-31A-style aircraft tow tractor (low, yellow, 3.3 × 1.8 m), origin on the deck at its centre
# Proportions: a 1.78 m sailor (hip joint 0.92 m, shoulders 1.42 m, 0.23 m either side of the centre line).
# Reference: US Navy flight-deck jersey colours (NAVAIR 00-80T-120 CV NATOPS), photographs of A/S32A-31A tractors.
# ═══════════════════════════════════════════════════════════════
import bpy, math, sys, os
sys.dont_write_bytecode = True
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from shipkit import Part, material, srgb

args = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
OUT = args[1] if len(args) > 1 else 'deckcrew.glb'

bpy.ops.wm.read_factory_settings(use_empty=True)
material('Jersey', srgb(0xf0f0ec), 0.0, 0.85)
material('Skin', srgb(0xb88a6a), 0.0, 0.7)
material('Dark', srgb(0x18191b), 0.2, 0.5)
material('Trouser', srgb(0x2e3338), 0.0, 0.9)
material('Boot', srgb(0x141414), 0.0, 0.8)
material('Yellow', srgb(0xe2b31e), 0.1, 0.55)
material('Tyre', srgb(0x161616), 0.0, 0.9)
material('Metal', srgb(0x5d6166), 0.6, 0.4)

HIP, SHOULDER, SX = 0.92, 1.42, 0.23

def taper_box(part, mat, y0, y1, w0, w1, d0, d1, zc=0.0):
    """a box whose width / depth change from the bottom (y0) to the top (y1)"""
    b = [(-w0, y0, zc - d0), (w0, y0, zc - d0), (w0, y0, zc + d0), (-w0, y0, zc + d0)]
    t = [(-w1, y1, zc - d1), (w1, y1, zc - d1), (w1, y1, zc + d1), (-w1, y1, zc + d1)]
    g = part.g(mat)
    g.face([b[0], b[3], b[2], b[1]], None, (0, -1, 0))
    g.face([t[0], t[1], t[2], t[3]], None, (0, 1, 0))
    for i in range(4):
        j = (i + 1) % 4
        q = [b[i], b[j], t[j], t[i]]
        cx = sum(p[0] for p in q) / 4; cz = sum(p[2] for p in q) / 4 - zc
        g.face(q, None, (cx, 0, cz))

# ── torso, collar, helmet (shirt colour) ──
T = Part('crew_torso')
taper_box(T, 'Jersey', HIP - 0.06, 1.2, 0.17, 0.2, 0.12, 0.135)          # float coat, lower
taper_box(T, 'Jersey', 1.2, SHOULDER + 0.03, 0.2, 0.22, 0.135, 0.12)       # chest and shoulders
T.box('Jersey', -0.12, 0.12, SHOULDER + 0.01, SHOULDER + 0.08, -0.09, 0.1)  # the float collar
T.box('Jersey', -0.21, 0.21, HIP - 0.08, HIP + 0.02, -0.125, 0.125)         # belt with the survival gear
T.sphere('Jersey', (0.0, 1.645, 0.012), 0.128, 0.118, 0.135, 12, 6, v0=0.45, v1=1.0)  # cranial helmet
for sx in (-1, 1):
    T.cyl('Jersey', (0, 1.615, 0.0), 0.058, 0.058, sx * 0.1, sx * 0.145, 10, axis='x')  # ear defenders
T.build(origin=(0, 0, 0))

# ── face, neck, goggles ──
H = Part('crew_head')
H.sphere('Skin', (0.0, 1.605, -0.01), 0.092, 0.115, 0.1, 10, 8)
H.cyl('Skin', (0, 0, 0.0), 0.052, 0.05, SHOULDER - 0.02, 1.53, 8)
H.box('Dark', -0.095, 0.095, 1.625, 1.668, -0.112, -0.07)                   # goggles pushed up on the cranial
H.box('Dark', -0.06, 0.06, 1.55, 1.575, -0.108, -0.09)                      # the mouth of the float-coat hood
H.build(origin=(0, 0, 0))

# ── arm from the shoulder joint: sleeve and glove (shirt colour) ──
A = Part('crew_arm')
taper_box(A, 'Jersey', -0.53, 0.02, 0.045, 0.058, 0.048, 0.06)
A.box('Jersey', -0.042, 0.042, -0.67, -0.53, -0.05, 0.035)                  # glove
A.build(origin=(0, 0, 0))

# ── leg from the hip joint: trouser leg and boot ──
L = Part('crew_leg')
taper_box(L, 'Trouser', -0.8, 0.02, 0.058, 0.075, 0.062, 0.08)
L.box('Boot', -0.058, 0.058, -HIP, -0.8, -0.16, 0.07)
L.build(origin=(0, 0, 0))

# ── tow tractor ──
R = Part('tractor')
R.box('Yellow', -0.85, 0.85, 0.22, 0.78, -1.55, 1.6)                        # chassis / ballast body
R.box('Yellow', -0.8, 0.8, 0.78, 0.98, -1.5, -0.2)                          # engine deck (front)
R.box('Dark', -0.45, 0.45, 0.78, 0.86, 0.35, 0.95)                          # driver's seat pan
R.box('Dark', -0.45, 0.45, 0.86, 1.3, 0.95, 1.05)                           # seat back
R.box('Metal', -0.06, 0.06, 0.5, 0.62, -2.1, -1.55)                         # tow bar lug
R.box('Dark', -0.4, 0.4, 0.98, 1.02, -1.3, -0.5)                            # engine grille
R.box('Yellow', -0.12, 0.12, 0.78, 1.15, 0.15, 0.3)                         # steering column
R.cyl('Dark', (0.0, 1.17, 0.18), 0.17, 0.17, 1.15, 1.19, 10)                # steering wheel
for sx in (-1, 1):
    for sz in (-1.0, 1.05):
        R.cyl('Tyre', (0, 0.3, sz), 0.3, 0.3, sx * 0.62, sx * 0.9, 12, axis='x')
R.build(origin=(0, 0, 0))

print('crew parts tris ~', T.tris() + H.tris() + 2 * A.tris() + 2 * L.tris(), ' tractor', R.tris())
os.makedirs(os.path.dirname(os.path.abspath(OUT)), exist_ok=True)
bpy.ops.export_scene.gltf(filepath=OUT, export_format='GLB', export_extras=True, export_yup=True,
                          export_materials='EXPORT', export_image_format='AUTO', export_cameras=False, export_lights=False)
print('exported', OUT, os.path.getsize(OUT) // 1024, 'KB')
