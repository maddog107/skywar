# ═══════════════════════════════════════════════════════════════
# M978A4 HEMTT A4 fuel servicing truck (2,500 US gal / 9,500 L tanker).
#   blender -b -P tools/vehicles/build.py -- fuel_blue
# HEMTT A4 cab, engine box and chassis as the M983A4 (tools/vehicles/usfam.py) on the long wheelbase (5.33 m
# between the tandem centres); an oval tank on saddles with a top walkway and manholes, the side pipe, and the
# pump / hose-reel module at the rear. Photos: the Oshkosh HEMTT A4 tanker, the Colorado Guard M978A4 and US Army
# M978 photos (Wikimedia Commons, public domain / CC BY-SA — reference only).
# Rig: 8 wheels (front tandem steers), door_l / door_r (cab), door_pump (the pump module's side door),
# exhaust, seat_driver, hatch_entry.
# ═══════════════════════════════════════════════════════════════
import math
from mathutils import Vector
import vkit
from vkit import Vehicle, Part, rot, lerp
import usfam

AXLES = [1.95, 3.47, 7.28, 8.80]
ZEND = 10.25
TANK = {'z0': 4.12, 'z1': 9.50, 'yc': 1.92, 'a': 1.12, 'b': 0.62}


def ellipse(z, s, n=24):
    a, bb, yc = TANK['a'] * s, TANK['b'] * s, TANK['yc']
    return [(a * math.cos(2 * math.pi * k / n), yc + bb * math.sin(2 * math.pi * k / n), z) for k in range(n)]


def build_tank(b):
    z0, z1 = TANK['z0'], TANK['z1']
    # the shell: domed ends, straight between (a loft of ellipses)
    stations = [(z0, 0.62), (z0 + 0.06, 0.86), (z0 + 0.16, 0.97), (z0 + 0.3, 1.0), (z1 - 0.3, 1.0), (z1 - 0.16, 0.97), (z1 - 0.06, 0.86), (z1, 0.62)]
    rings = [ellipse(z, s) for (z, s) in stations]
    b.loft('paint', rings, smooth=True)
    b.face(rings[0], 'paint', want=(0, 0, -1))
    b.face(rings[-1], 'paint', want=(0, 0, 1))
    # saddles and hold-down bands
    for z in (4.75, 7.0, 9.0):
        band = [ellipse(z - 0.05, 1.012), ellipse(z + 0.05, 1.012)]
        b.loft('dark', band, smooth=True)
        for sx in (-1, 1):
            b.box('dark', sx * 0.52, sx * 0.98, 1.22, 1.52, z - 0.12, z + 0.12)
    # compartment seams
    for z in (5.9, 7.7):
        b.loft('paint', [ellipse(z - 0.015, 1.006), ellipse(z + 0.015, 1.006)], smooth=True)
    # top: walkway with tread plate, manholes with their vents, fold-down handrails
    top = TANK['yc'] + TANK['b']
    b.box('paint', -0.34, 0.34, top - 0.06, top + 0.05, 4.55, 9.1)
    b.panel('tread_plate', [(-0.32, top + 0.05, 4.6), (0.32, top + 0.05, 4.6), (0.32, top + 0.05, 9.05), (-0.32, top + 0.05, 9.05)], (0, 1, 0), off=0.003)
    for z in (5.2, 6.8, 8.4):
        b.cyl('paint', (0.55, top - 0.1, z), (0.55, top + 0.06, z), 0.26, 0.26, 16)
        b.cyl('dark', (0.55, top + 0.06, z), (0.55, top + 0.1, z), 0.22, 0.2, 16)
        b.cyl('dark', (0.55, top + 0.1, z - 0.14), (0.55, top + 0.2, z - 0.14), 0.035, 0.035, 8)
        b.cyl('dark', (-0.55, top - 0.08, z + 0.3), (-0.55, top + 0.08, z + 0.3), 0.06, 0.06, 8)
    for sx in (-1, 1):
        for z in (4.7, 6.2, 7.7, 9.0):
            b.cyl('dark', (sx * 0.3, top + 0.05, z), (sx * 0.3, top + 0.12, z), 0.02, 0.02, 6)
        b.tube('dark', [(sx * 0.3, top + 0.12, 4.7), (sx * 0.3, top + 0.12, 9.0)], 0.017, 6)
    # the long pipes along the lower sides
    for sx in (-1, 1):
        b.cyl('paint', (sx * 1.0, 1.42, 4.3), (sx * 1.0, 1.42, 9.35), 0.07, 0.07, 10)
        for z in (4.6, 6.2, 7.9, 9.2):
            b.box('dark', sx * 0.86, sx * 1.06, 1.36, 1.48, z - 0.04, z + 0.04)
    # ladder up the front right of the tank
    vkit.ladder(b, 1.16, 1.3, top + 0.05, 4.3, 4.62, rungs=5)
    # hazmat placards (red diamond, white number band) and the FLAMMABLE stencil band
    for sx in (-1, 1):
        x = sx * (TANK['a'] + 0.005)
        c = Vector((x, 1.72, 9.25))
        b.panel('red', [c + Vector((0, -0.18, 0)), c + Vector((0, 0, 0.18)), c + Vector((0, 0.18, 0)), c + Vector((0, 0, -0.18))], (sx, 0, 0), off=0.006)
        b.panel('white', [c + Vector((0, -0.05, -0.1)), c + Vector((0, -0.05, 0.1)), c + Vector((0, 0.05, 0.1)), c + Vector((0, 0.05, -0.1))], (sx, 0, 0), off=0.008)
        # FLAMMABLE / NO SMOKING WITHIN 50 FEET, pressed onto the oval shell (reading front → back on the right side,
        # back → front on the left, as painted)
        def onto(p, sx=sx):
            t = max(-0.999, min(0.999, (p.y - TANK['yc']) / TANK['b']))
            return Vector((sx * TANK['a'] * math.sqrt(1 - t * t), p.y, p.z))
        right = (0, 0, sx)
        usfam.add_text(b, 'black', 'FLAMMABLE', 0.24, (x, 2.02, 6.9), right, (0, 1, 0), project=onto, off=0.006)
        usfam.add_text(b, 'black', 'NO SMOKING WITHIN 50 FEET', 0.085, (x, 1.83, 6.9), right, (0, 1, 0), project=onto, off=0.006)


def build_pump_module(v, b):
    """the pump / filter / hose-reel module behind the tank"""
    z0, z1, y0, y1, hw = 9.55, ZEND - 0.05, 0.9, 2.28, 1.18
    b.box('paint', -hw, hw, y0, y1, z0, z1, bev=0.03)
    # rear: roll-up shutter (slat seams), handle; lights and reflectors below
    for k in range(10):
        y = lerp(y0 + 0.2, y1 - 0.12, k / 9)
        usfam.panel_lines(b, [(-hw + 0.12, y, z1), (hw - 0.12, y, z1)], (0, 0, 1), 0.012)
    usfam.panel_lines(b, [(-hw + 0.1, y0 + 0.12, z1), (hw - 0.1, y0 + 0.12, z1), (hw - 0.1, y1 - 0.08, z1), (-hw + 0.1, y1 - 0.08, z1)], (0, 0, 1))
    vkit.grab_handle(b, (0, y0 + 0.28, z1 + 0.005), (1, 0, 0), (0, 0, 1), 0.3, 0.04, 'dark')
    c = Vector((0.7, 1.95, z1 + 0.005))
    b.panel('red', [c + Vector((0, -0.16, 0)), c + Vector((0.16, 0, 0)), c + Vector((0, 0.16, 0)), c + Vector((-0.16, 0, 0))], (0, 0, 1), off=0.006)
    # right side: a hinged door onto the pump and filter-separator (door_pump), a hose on its reel beside it
    x = hw
    d = Part(v, 'door_pump', pivot=(x, y0 + 0.1, z0 + 0.06), joint=rot([0, 1, 0], 0.0, 1.75, stow=0.0, deploy=1.75, group='door'))
    xo_ = x + 0.012
    d.box('paint', xo_ - 0.04, xo_, y0 + 0.1, y1 - 0.1, z0 + 0.06, z1 - 0.08, bev=0.01)
    vkit.grab_handle(d, (xo_ + 0.01, 1.6, z1 - 0.2), (0, 1, 0), (1, 0, 0), 0.2, 0.03, 'dark')
    b.panel('interior', [(x, y0 + 0.12, z0 + 0.08), (x, y0 + 0.12, z1 - 0.1), (x, y1 - 0.12, z1 - 0.1), (x, y1 - 0.12, z0 + 0.08)], (1, 0, 0), off=0.002)
    # left side: louvres and the fire extinguisher bracket
    vkit.louvres(b, -hw, 1.6, 2.1, z0 + 0.1, z1 - 0.1, 5, side=-1)
    b.cyl('red', (-1.26, 1.05, z0 + 0.3), (-1.26, 1.45, z0 + 0.3), 0.075, 0.075, 10)
    # top railing
    for sx in (-1, 1):
        vkit.handrail(b, [(sx * 1.1, y1, z0 + 0.05), (sx * 1.1, y1 + 0.5, z0 + 0.1), (sx * 1.1, y1 + 0.5, z1 - 0.1), (sx * 1.1, y1, z1 - 0.05)], 0.017, 'dark')
    # rear bumper, lights, mud flaps
    b.box('paint', -1.2, 1.2, 0.62, 0.92, ZEND - 0.25, ZEND, bev=0.02)
    for sx in (-1, 1):
        vkit.lamp_box(b, (sx * 0.95, 0.78, ZEND + 0.02), (0.22, 0.1, 0.05), (0, 0, 1), lens='lens_red')
        vkit.lamp_box(b, (sx * 0.62, 0.78, ZEND + 0.02), (0.1, 0.08, 0.05), (0, 0, 1), lens='lens_amber')
        usfam.reflector_tri(b, (sx * 0.3, 0.78, ZEND), (0, 0, 1), 0.06)
    b.box('dark', -0.12, 0.12, 0.66, 0.86, ZEND, ZEND + 0.1)


def make():
    vkit.setup_materials('blue_tan')
    v = Vehicle('fuel_blue', 'M978A4 HEMTT A4 fuel servicing truck', scheme='blue_tan')
    b = Part(v, 'body')
    usfam.hemtt_cab(v, b)
    usfam.hemtt_engine(b, spare=True)
    usfam.hemtt_chassis(v, b, AXLES, ZEND, fenders=((), ((6.58, 9.52),)))
    # sub-frame under the tank
    for sx in (-1, 1):
        b.box('paint', sx * 0.45, sx * 0.62, 1.22, 1.3, 4.0, 9.6)
    build_tank(b)
    build_pump_module(v, b)
    vkit.whip_antenna(b, (1.05, 2.86, 2.3), h=2.4)
    return v
