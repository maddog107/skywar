# ═══════════════════════════════════════════════════════════════
# Follow-me car: a crew-cab-less full-size pickup (Ford F-250 / Toyota Hilux class) in airfield yellow with a
# black-and-yellow chequered band, an amber light bar and the lit FOLLOW ME roof sign facing the aircraft behind it.
#   blender -b -P tools/airbases/build.py -- followme
# ICAO Annex 14 Vol I §9.4 / Aerodrome Design Manual: vehicles airside are yellow, with a chequered pattern of
# ≥ 0.9 m squares on large surfaces (small vehicles: a band); a follow-me car carries a FOLLOW ME sign readable from
# the cockpit and flashing amber lights (ICAO Annex 14 §6.2 obstacle-light colours for vehicles). Size ≈ 5.3 ×
# 1.95 × 1.9 m (2.4 m over the sign), wheelbase 3.4 m. Photos: follow-me cars at Frankfurt / Schiphol / USAF bases
# (Wikimedia Commons).
# Rig: 4 wheels (front axle steers). No Paint material: the livery is fixed.
# ═══════════════════════════════════════════════════════════════
import math
import akit
import vkit
from akit import Vehicle, Part
import usfam

R, W, RIM = 0.39, 0.26, 0.22
AXLES = [1.0, 4.4]
TRACK = 1.66
HW = 0.97
SIGN = {'z': 2.75, 'y': 2.02, 'w': 1.5, 'h': 0.42, 'd': 0.24}


def arch(zc, rr, n=8):
    """wheel-arch points (z, y) from the rear edge over the top to the front edge (profile runs aft → fore along the
    bottom)"""
    return [(zc + rr * math.cos(math.pi * k / n), R + 0.02 + rr * math.sin(math.pi * k / n)) for k in range(n + 1)]


def make():
    akit.setup_materials('blue_tan')
    v = Vehicle('followme', 'Follow-me car', scheme='blue_tan')
    b = Part(v, 'body')
    L = 5.3
    ra = 0.47
    # lower body: one concave side profile (hood, bed rail, wheel arches) extruded across the width
    prof = [(0.0, 0.42), (0.0, 0.98), (0.22, 1.1), (1.75, 1.16), (3.25, 1.14), (3.25, 0.8), (L, 0.8), (L, 0.42)]
    prof += arch(AXLES[1], ra)
    prof += arch(AXLES[0], ra)
    b.prism_x('yellow', prof, -HW, HW)
    # the bed: floor liner, side walls with rails, the tailgate
    b.panel('black', [(-HW + 0.06, 0.8, 3.26), (HW - 0.06, 0.8, 3.26), (HW - 0.06, 0.8, L - 0.07), (-HW + 0.06, 0.8, L - 0.07)], (0, 1, 0), off=0.003)
    for sx in (-1, 1):
        b.box('yellow', sx * (HW - 0.06), sx * HW, 0.8, 1.12, 3.25, L)
        b.box('yellow', sx * (HW - 0.08), sx * (HW + 0.01), 1.12, 1.15, 3.25, L)
        b.box('black', sx * (HW - 0.3), sx * (HW - 0.06), 0.8, 1.02, AXLES[1] - 0.5, AXLES[1] + 0.5)   # wheel tubs
    b.box('yellow', -HW + 0.06, HW - 0.06, 0.8, 1.12, L - 0.06, L)
    b.box('yellow', -HW, HW, 1.12, 1.15, L - 0.07, L)
    b.panel('dark', [(-HW + 0.05, 0.98, L), (HW - 0.05, 0.98, L), (HW - 0.05, 1.0, L), (-HW + 0.05, 1.0, L)], (0, 0, 1), off=0.002)
    # cab
    cab = [(1.75, 1.14), (2.4, 1.86), (3.22, 1.88), (3.25, 1.14)]
    b.prism_x('yellow', cab, -HW + 0.06, HW - 0.06)
    x = HW - 0.06
    A, B = (1.8, 1.2), (2.36, 1.82)
    n = (0, 0.65, -0.55)
    b.panel('glass', [(-x + 0.06, A[1], A[0]), (x - 0.06, A[1], A[0]), (x - 0.06, B[1], B[0]), (-x + 0.06, B[1], B[0])], n, off=0.01, frame=0.03, frame_skin='black')
    for sx in (-1, 1):
        b.panel('glass', [(sx * x, 1.24, 2.0), (sx * x, 1.24, 3.1), (sx * x, 1.78, 3.1), (sx * x, 1.78, 2.42)], (sx, 0, 0), off=0.006, frame=0.02, frame_skin='black')
        b.beam('black', (sx * (x + 0.008), 1.2, 2.72), (sx * (x + 0.008), 1.8, 2.72), 0.02, 0.04)
        vkit.mirror(b, (sx * x, 1.3, 2.05), (sx * (x + 0.22), 1.35, 2.0), size=(0.18, 0.22))
        b.beam('black', (sx * (HW + 0.002), 0.5, 3.2), (sx * (HW + 0.002), 1.12, 3.2), 0.012, 0.012)                  # door shut line
    b.panel('glass', [(-x + 0.15, 1.35, 3.251), (x - 0.15, 1.35, 3.251), (x - 0.15, 1.78, 3.231), (-x + 0.15, 1.78, 3.231)], (0, 0, 1), off=0.004)
    # chequer band along the sides (yellow body, black squares) over the door line
    s = 0.2
    for sx in (-1, 1):
        for i in range(int(L / s)):
            z = i * s
            if any(abs(z + s / 2 - a) < ra + 0.08 for a in AXLES):
                continue
            for row, y in enumerate((0.52, 0.52 + s)):
                if (i + row) % 2 == 0:
                    b.panel('black', [(sx * HW, y, z), (sx * HW, y, z + s), (sx * HW, y + s, z + s), (sx * HW, y + s, z)], (sx, 0, 0), off=0.004)
    # front: grille, headlights, bumper, plate; rear: tail lights, bumper, hitch
    b.panel('dark', [(-0.6, 0.62, -0.001), (0.6, 0.62, -0.001), (0.6, 0.95, -0.001), (-0.6, 0.95, -0.001)], (0, 0, -1), off=0.004)
    b.box('grey', -HW, HW, 0.35, 0.55, -0.12, 0.05, bev=0.03)
    b.box('grey', -HW, HW, 0.4, 0.6, L - 0.05, L + 0.12, bev=0.03)
    b.box('dark', -0.08, 0.08, 0.36, 0.44, L + 0.12, L + 0.24)
    for sx in (-1, 1):
        vkit.lamp_box(b, (sx * 0.78, 0.84, -0.01), (0.3, 0.16, 0.04), (0, 0, -1), lens='lens')
        vkit.lamp_box(b, (sx * 0.86, 0.82, L + 0.005), (0.14, 0.3, 0.04), (0, 0, 1), lens='lens_red')
        vkit.lamp_box(b, (sx * 0.8, 0.46, -0.13), (0.14, 0.06, 0.04), (0, 0, -1), lens='lens_amber')
    b.box('black', -HW + 0.02, HW - 0.02, 0.28, 0.42, 0.5, L - 0.2)                                   # underbody / frame shadow
    # roof: light bar and the FOLLOW ME sign on its frame
    b.box('black', -0.72, 0.72, 1.88, 1.93, 2.48, 2.62)
    b.box('dark', -0.72, 0.72, 1.93, 1.98, 2.46, 2.64)
    for k in range(6):
        xx = -0.62 + k * 0.248
        b.box('lens_amber', xx - 0.1, xx + 0.1, 1.93, 2.04, 2.47, 2.63)
    z, y, w, h, d = SIGN['z'], SIGN['y'], SIGN['w'], SIGN['h'], SIGN['d']
    for sx in (-1, 1):
        b.beam('dark', (sx * 0.55, 1.88, z - 0.1), (sx * 0.55, y + 0.02, z), 0.04, 0.04)
        b.beam('dark', (sx * 0.55, 1.88, z + 0.3), (sx * 0.55, y + 0.02, z), 0.04, 0.04)
    b.box('black', -w / 2, w / 2, y, y + h, z - d / 2, z + d / 2, bev=0.02)
    for face_z, right in ((z + d / 2, (1, 0, 0)), (z - d / 2, (-1, 0, 0))):
        nz = 1 if face_z > z else -1
        b.panel('yellow', [(-w / 2 + 0.04, y + 0.04, face_z), (w / 2 - 0.04, y + 0.04, face_z), (w / 2 - 0.04, y + h - 0.04, face_z), (-w / 2 + 0.04, y + h - 0.04, face_z)], (0, 0, nz), off=0.004)
        usfam.add_text(b, 'black', 'FOLLOW ME', 0.21, (0, y + h / 2, face_z + nz * 0.004), right, (0, 1, 0), off=0.004)
    vkit.whip_antenna(b, (0.6, 1.88, 3.0), h=0.9)
    usfam.wheels(v, None, AXLES, TRACK, R, W, RIM, steer={0: 1.0}, lugs=14, seg=20, nbolts=6, cti=False,
                 hub_skin='grey', rim_skin='grey', tread='road', rim_dish=0.03)
    return v
