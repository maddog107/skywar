# ═══════════════════════════════════════════════════════════════
# M983A4 HEMTT A4 tractor (Oshkosh), the prime mover of the Patriot launching station and radar set.
#   blender -b -P tools/vehicles/build.py -- hemtt
# Oshkosh HEMTT A4 M983A4 Patriot tractor sheet: 9.119 × 2.438 m, 2.997 m over the spare tyre, track 2.007 m,
# wheelbase 4.661 m (tandem centres), 16.00R20 XZL tyres, front tandem steers, 16.2 t, 100 km/h.
# Photos: the HEMTT A4 LET (Oshkosh, CC BY-SA) and the RoCAF M983 with a Patriot launcher (CC0), Wikimedia Commons.
# Rig: 8 wheels (front tandem steers), door_l / door_r, hitch (empty on the fifth wheel: put a trailer's kingpin there),
# exhaust, seat_driver, hatch_entry.
# ═══════════════════════════════════════════════════════════════
import math
from mathutils import Vector
import vkit
from vkit import Vehicle, Part, lerp
import usfam

AXLES = [1.95, 3.47, 6.61, 8.13]
ZEND = 9.12
FW = {'z': 7.18, 'top': 1.50}          # fifth wheel centre and plate top


def glad_hands(b, z):
    """the air / electrical coupling stand behind the cab, with red and blue coiled hoses"""
    b.box('paint', -0.35, 0.35, 1.3, 1.95, z - 0.06, z + 0.06)
    for x, sk in ((-0.22, 'red'), (0.0, 'lens_blue'), (0.22, 'black')):
        b.cyl('dark', (x, 1.78, z + 0.06), (x, 1.78, z + 0.14), 0.04, 0.04, 8)
        pts = []
        for k in range(40):
            a = k * 0.55
            pts.append((x + 0.07 * math.cos(a), 1.72 + 0.07 * math.sin(a), z + 0.18 + k * 0.024))
        b.tube(sk if sk != 'black' else 'cable', pts, 0.012, 4)


def fifth_wheel(b):
    z, top = FW['z'], FW['top']
    # mounting brackets on the frame, the rocking plate with its throat and jaws, the ramps behind
    for sx in (-1, 1):
        b.box('dark', sx * 0.38, sx * 0.62, 1.22, top - 0.18, z - 0.35, z + 0.35)
        b.cyl('dark', (sx * 0.62, top - 0.22, z), (sx * 0.38, top - 0.22, z), 0.08, 0.08, 10)
    plate = [(-0.55, z - 0.5), (0.55, z - 0.5), (0.6, z - 0.1), (0.6, z + 0.3), (0.12, z + 0.55), (-0.12, z + 0.55), (-0.6, z + 0.3), (-0.6, z - 0.1)]
    b.prism_y('dark', plate, top - 0.12, top)
    b.panel('black', [(-0.07, top, z), (0.07, top, z), (0.07, top, z + 0.55), (-0.07, top, z + 0.55)], (0, 1, 0), off=0.002)
    b.cyl('steel', (0, top - 0.02, z), (0, top + 0.001, z), 0.1, 0.1, 12, cap0=False)
    b.box('dark', 0.6, 0.72, top - 0.1, top - 0.04, z - 0.05, z + 0.05)     # release handle
    b.beam('dark', (0.72, top - 0.07, z), (0.95, top - 0.12, z + 0.1), 0.03, 0.03)
    for sx in (-1, 1):
        b.face([(sx * 0.2, top - 0.12, z + 0.55), (sx * 0.62, top - 0.12, z + 0.45), (sx * 0.62, 1.22, ZEND - 0.25), (sx * 0.2, 1.22, ZEND - 0.25)], 'dark', want=(0, 1, 0.3))
    b.empty('hitch', (0, top - 0.07, z), (0, 0, -1))


def make():
    vkit.setup_materials('blue_tan')
    v = Vehicle('hemtt', 'M983A4 HEMTT A4 tractor', scheme='blue_tan')
    b = Part(v, 'body')
    usfam.hemtt_cab(v, b)
    usfam.hemtt_engine(b, spare=True)
    usfam.hemtt_chassis(v, b, AXLES, ZEND, fenders=((), ((5.92, 8.82),)))
    # tractor deck behind the engine: catwalk grating, coupling stand, tool box, crane-mount plate
    b.box('paint', -1.1, 1.1, 1.24, 1.30, 3.98, 6.15)
    b.panel('tread_plate', [(-1.05, 1.30, 4.02), (1.05, 1.30, 4.02), (1.05, 1.30, 6.1), (-1.05, 1.30, 6.1)], (0, 1, 0), off=0.004)
    glad_hands(b, 4.25)
    b.box('paint', 0.55, 1.1, 1.3, 1.85, 5.3, 6.05, bev=0.02)
    usfam.hatch_x(b, 1.1, 1, 1.35, 1.8, 5.35, 6.0)
    for sx in (-1, 1):
        vkit.handrail(b, [(sx * 1.08, 1.30, 4.05), (sx * 1.08, 2.1, 4.1), (sx * 1.08, 2.1, 4.9), (sx * 1.08, 1.30, 4.95)], 0.018, 'dark')
    fifth_wheel(b)
    # rear crossmember: tail and stop lights, reflectors, pintle hook
    b.box('paint', -1.2, 1.2, 0.72, 1.24, ZEND - 0.22, ZEND, bev=0.02)
    for sx in (-1, 1):
        vkit.lamp_box(b, (sx * 0.95, 1.05, ZEND + 0.02), (0.22, 0.1, 0.05), (0, 0, 1), lens='lens_red')
        vkit.lamp_box(b, (sx * 0.95, 0.9, ZEND + 0.02), (0.1, 0.08, 0.05), (0, 0, 1), lens='lens_amber')
        usfam.reflector_tri(b, (sx * 0.62, 1.05, ZEND), (0, 0, 1), 0.06)
    b.box('dark', -0.12, 0.12, 0.78, 0.98, ZEND, ZEND + 0.1)
    b.cyl('dark', (0, 0.88, ZEND + 0.12), (0, 0.98, ZEND + 0.12), 0.05, 0.05, 8)
    # stencils: bumper codes on the front bumper, a data plate on the door
    for sx in (-1, 1):
        usfam.stencil_box(b, (sx * 0.55, 0.83, -0.005), 0.3, 0.07, (0, 0, -1))
    vkit.whip_antenna(b, (1.05, 2.86, 2.3), h=2.4)
    return v
