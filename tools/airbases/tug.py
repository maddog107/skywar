# ═══════════════════════════════════════════════════════════════
# Aircraft tow tractor: the USAF MB-4 / U30 class (a low, heavily ballasted 4×4 tug with an open operator seat
# behind a windscreen, pintle hitches front and rear, a beacon). Pulls fighters out of shelters with a tow bar.
#   blender -b -P tools/airbases/build.py -- tug
# Size ≈ 4.4 × 2.1 × 1.6 m, ~9 t with ballast, 9.00-20 / 10.00-20 tyres; the U30 (Eagle / TUG) sheet gives
# 4.34 × 2.08 m, 1.55 m to the top of the steering column, drawbar pull 30,000 lb. Photos: MB-4 and U30 tugs on
# USAF flight lines (DVIDS / USAF, public domain).
# Rig: 4 wheels (front axle steers), exhaust, hitch (front pintle, where a tow bar attaches).
# ═══════════════════════════════════════════════════════════════
import math
import akit
import vkit
from akit import Vehicle, Part
import usfam

R, W, RIM = 0.47, 0.3, 0.26
AXLES = [1.05, 3.35]
TRACK = 1.72
HW = 1.04
L = 4.4


def make():
    akit.setup_materials('blue_tan')
    v = Vehicle('tug', 'Aircraft tow tractor', scheme='blue_tan')
    b = Part(v, 'body')
    ra = 0.55
    # the ballast body: one concave side profile (sloped nose, low deck, engine hood, wheel arches)
    prof = [(0.05, 0.35), (0.0, 0.62), (0.18, 0.95), (1.6, 1.0), (1.62, 0.88), (2.6, 0.88), (2.62, 1.12), (L - 0.15, 1.12), (L, 0.95), (L, 0.35)]
    for zc in (AXLES[1], AXLES[0]):
        prof += [(zc + ra * math.cos(math.pi * k / 8), R + 0.05 + ra * math.sin(math.pi * k / 8)) for k in range(9)]
    b.prism_x('paint', prof, -HW, HW)
    # deck tread plate at the operator station, engine grille and the hood louvres
    b.panel('tread_plate', [(-HW + 0.05, 0.88, 1.65), (HW - 0.05, 0.88, 1.65), (HW - 0.05, 0.88, 2.58), (-HW + 0.05, 0.88, 2.58)], (0, 1, 0), off=0.003)
    b.panel('mesh', [(-0.7, 0.5, L + 0.001), (0.7, 0.5, L + 0.001), (0.7, 0.9, L + 0.001), (-0.7, 0.9, L + 0.001)], (0, 0, 1), off=0.003)
    for sx in (-1, 1):
        b.panel('vents', [(sx * HW, 0.65, 2.9), (sx * HW, 0.65, 3.9), (sx * HW, 1.0, 3.9), (sx * HW, 1.0, 2.9)], (sx, 0, 0), off=0.003)
    # bumpers (rubber-faced) and the pintle hitches
    b.box('dark', -HW - 0.05, HW + 0.05, 0.32, 0.6, -0.12, 0.05)
    b.box('rubber', -HW, HW, 0.36, 0.56, -0.16, -0.12)
    b.box('dark', -HW - 0.05, HW + 0.05, 0.32, 0.6, L - 0.02, L + 0.12)
    for z, s in ((-0.16, -1), (L + 0.12, 1)):
        b.box('dark', -0.12, 0.12, 0.38, 0.52, z, z + s * 0.16)
        b.cyl('steel', (0, 0.4, z + s * 0.22), (0, 0.55, z + s * 0.22), 0.07, 0.07, 10)
    b.empty('hitch', (0, 0.45, -0.38), (0, 0, -1))
    # operator station: seat, steering column and wheel, pedals, the low windscreen frame and the dash
    b.box('seat', -0.3, 0.3, 0.88, 1.28, 2.2, 2.5)
    b.box('seat', -0.3, 0.3, 1.28, 1.75, 2.45, 2.58)
    b.box('dark', -0.5, 0.5, 0.88, 1.22, 1.62, 1.8)
    b.box('dash', -0.45, 0.45, 1.22, 1.3, 1.62, 1.82)
    b.cyl('dark', (0, 1.0, 1.75), (0, 1.5, 1.95), 0.04, 0.04, 8)
    b.lathe((0, 1.52, 1.97), (0, 0.9, 0.44), [(0, 0.2, 'black'), (0.03, 0.2, 'black'), (0.03, 0.17, 'black'), (0.0, 0.17, 'black')], n=16, cap0=False)
    for sx in (-1, 1):
        b.beam('dark', (sx * 0.95, 1.0, 1.62), (sx * 0.95, 1.62, 1.7), 0.05, 0.05)
    b.beam('dark', (-0.95, 1.62, 1.7), (0.95, 1.62, 1.7), 0.05, 0.05)
    b.face([(-0.92, 1.3, 1.63), (0.92, 1.3, 1.63), (0.92, 1.6, 1.69), (-0.92, 1.6, 1.69)], 'glass', want=(0, 0.2, -1))
    # lights, the amber beacon on a mast, the exhaust
    for sx in (-1, 1):
        vkit.headlight(b, (sx * 0.78, 0.82, 0.05), (0, 0, -1), r=0.08, guard=True)
        vkit.lamp_box(b, (sx * 0.85, 0.9, L + 0.005), (0.16, 0.1, 0.04), (0, 0, 1), lens='lens_red')
        usfam.reflector_tri(b, (sx * 0.85, 0.72, L), (0, 0, 1), 0.05)
    b.cyl('dark', (-0.85, 1.12, 3.9), (-0.85, 1.75, 3.9), 0.03, 0.03, 6)
    b.cyl('lens_amber', (-0.85, 1.75, 3.9), (-0.85, 1.92, 3.9), 0.08, 0.07, 10)
    b.cyl('dark', (0.8, 1.12, 3.1), (0.8, 1.5, 3.12), 0.05, 0.05, 8)
    b.empty('exhaust', (0.8, 1.5, 3.12), (0, 1, 0))
    b.box('black', -HW + 0.02, HW - 0.02, 0.25, 0.35, 0.3, L - 0.3)
    usfam.stencil_box(b, (0.0, 0.8, -0.001), 0.5, 0.1, (0, 0, -1))
    usfam.wheels(v, None, AXLES, TRACK, R, W, RIM, steer={0: 1.0}, lugs=14, seg=20, nbolts=8, cti=False,
                 hub_skin='paint', rim_skin='paint', tread='block', rim_dish=0.04)
    return v
