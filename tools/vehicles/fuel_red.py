# ═══════════════════════════════════════════════════════════════
# ATZ-5-4320 fuel tanker on the Ural-4320: a 5,000 l tank of rounded-oval section on saddles, the manhole dome and
# breathers, a walkway with folding handrails, a ladder, hose lockers along the sides, fire extinguishers, and the
# rear pump compartment behind two doors (pump, hose reel, dispensing nozzle inside).
#   blender -b -P tools/vehicles/build.py -- fuel_red
# References: Ural-4320 tank truck photos (Tajikistan; Wikimedia Commons), ATZ-5-4320 data (5 m³, 7.4 × 2.5 m).
# Rig: door_l / door_r (the pump compartment doors, rot y 0 → ±110°, group 'door'), 6 wheels, exhaust,
# seat_driver, hatch_entry.
# ═══════════════════════════════════════════════════════════════
import math
from mathutils import Vector
import vkit
from vkit import Vehicle, Part, rot, lerp
import ural
from ural import URAL

TZ0, TZ1 = 3.38, 6.62       # tank
HW, HH = 1.15, 0.68         # half width / half height of the section
TY = 2.10                   # section centre height
CZ0, CZ1 = 6.66, 7.24       # pump compartment


def section(z, n=20, s=1.0):
    """a superellipse section (flattish sides, rounded corners)"""
    pts = []
    for i in range(n):
        a = 2 * math.pi * i / n
        c, sn = math.cos(a), math.sin(a)
        x = HW * s * math.copysign(abs(c) ** 0.6, c)
        y = HH * s * math.copysign(abs(sn) ** 0.6, sn)
        pts.append((x, TY + y, z))
    return pts


def build_tank(b):
    # shell with dished end caps
    rings = [section(TZ0 + 0.06, s=0.9), section(TZ0), section(TZ1), section(TZ1 + 0.06, s=0.9)]
    b.loft('paint', rings, smooth=True)
    b.face(rings[0], 'paint', want=(0, 0, -1))
    b.face(rings[-1], 'paint', want=(0, 0, 1))
    # reinforcing bands and the saddles on the frame
    for z in (TZ0 + 0.35, (TZ0 + TZ1) / 2, TZ1 - 0.35):
        rr = [(x * 1.012, TY + (y - TY) * 1.012, z) for (x, y, _) in section(z)]
        rr2 = [(x, y, z + 0.06) for (x, y, _) in rr]
        b.loft('dark', [rr, rr2], smooth=True)
        b.box('dark', -0.9, 0.9, URAL['frame'][1], TY - HH + 0.05, z - 0.06, z + 0.06)
    # the manhole dome with its lid and hinges, breather valves, the level gauge
    b.cyl('paint', (0, TY + HH - 0.02, TZ0 + 0.55), (0, TY + HH + 0.2, TZ0 + 0.55), 0.3, 0.3, 16)
    b.cyl('dark', (0, TY + HH + 0.2, TZ0 + 0.55), (0, TY + HH + 0.25, TZ0 + 0.55), 0.32, 0.28, 16)
    b.cyl('dark', (0.2, TY + HH + 0.25, TZ0 + 0.55), (0.2, TY + HH + 0.34, TZ0 + 0.55), 0.05, 0.05, 8)
    for x in (-0.35, 0.35):
        b.cyl('dark', (x, TY + HH - 0.02, TZ0 + 1.0), (x, TY + HH + 0.12, TZ0 + 1.0), 0.05, 0.05, 8)
        b.cyl('dark', (x, TY + HH + 0.12, TZ0 + 1.0), (x, TY + HH + 0.16, TZ0 + 1.0), 0.08, 0.08, 8)
    # walkway along the top and the folding handrails (down for travel)
    b.box('tread_plate', -0.24, 0.24, TY + HH - 0.01, TY + HH + 0.03, TZ0 + 0.9, TZ1 - 0.1)
    for sx in (-1, 1):
        b.tube('steel', [(sx * 0.3, TY + HH + 0.05, TZ0 + 1.0), (sx * 0.3, TY + HH + 0.08, TZ1 - 0.2)], 0.018, 6)
        for z in (TZ0 + 1.0, (TZ0 + TZ1) / 2 + 0.3, TZ1 - 0.2):
            b.cyl('dark', (sx * 0.3, TY + HH, z), (sx * 0.3, TY + HH + 0.07, z), 0.025, 0.025, 6)
    # ladder up the front of the tank (left)
    for x in (-0.95, -0.6):
        b.beam('dark', (x, URAL['bed'], TZ0 - 0.12), (x, TY + HH + 0.25, TZ0 - 0.04), 0.035, 0.035)
    for k in range(5):
        y = lerp(URAL['bed'] + 0.25, TY + HH, k / 4)
        z = lerp(TZ0 - 0.115, TZ0 - 0.055, k / 4)
        b.cyl('dark', (-0.95, y, z), (-0.6, y, z), 0.014, 0.014, 6)
    # hose lockers along the lower sides, their end caps; the placards
    for sx in (-1, 1):
        b.box('paint', sx * 1.0, sx * 1.24, 1.30, 1.62, TZ0 + 0.1, TZ1 - 0.05, bev=0.03)
        for z in (TZ0 + 0.1, TZ1 - 0.05):
            b.cyl('dark', (sx * 1.12, 1.46, z - 0.02), (sx * 1.12, 1.46, z + 0.02), 0.13, 0.13, 10)
        b.panel('orange', [(sx * (HW + 0.002), 2.2, 4.6), (sx * (HW + 0.002), 2.2, 5.3), (sx * (HW + 0.002), 2.5, 5.3), (sx * (HW + 0.002), 2.5, 4.6)], (sx, 0, 0), off=0.004)
        # fire extinguishers in brackets at the tank's front corners
        b.cyl('red', (sx * 1.02, 1.66, TZ0 + 0.15), (sx * 1.02, 2.08, TZ0 + 0.15), 0.075, 0.075, 10)
        b.cyl('dark', (sx * 1.02, 2.08, TZ0 + 0.15), (sx * 1.02, 2.16, TZ0 + 0.15), 0.03, 0.02, 6)
        b.box('dark', sx * 0.94, sx * 1.1, 1.62, 1.66, TZ0 + 0.05, TZ0 + 0.25)


def build_compartment(v, b):
    """the rear pump compartment: a steel cabinet across the back, two doors"""
    y0, y1 = 1.30, 2.62
    # an open-backed cabinet: shell, a dark interior (back wall, floor, sides), a frame round the opening
    b.box('paint', -1.22, 1.22, y0, y1, CZ0, CZ1 - 0.03, skip=('pz',))
    b.face([(-1.16, y0 + 0.06, CZ0 + 0.03), (1.16, y0 + 0.06, CZ0 + 0.03), (1.16, y1 - 0.06, CZ0 + 0.03), (-1.16, y1 - 0.06, CZ0 + 0.03)], 'interior', want=(0, 0, 1))
    b.face([(-1.16, y0 + 0.06, CZ0 + 0.03), (-1.16, y0 + 0.06, CZ1 - 0.03), (1.16, y0 + 0.06, CZ1 - 0.03), (1.16, y0 + 0.06, CZ0 + 0.03)], 'floor', want=(0, 1, 0))
    for sx in (-1, 1):
        b.face([(sx * 1.16, y0 + 0.06, CZ0 + 0.03), (sx * 1.16, y1 - 0.06, CZ0 + 0.03), (sx * 1.16, y1 - 0.06, CZ1 - 0.03), (sx * 1.16, y0 + 0.06, CZ1 - 0.03)], 'interior', want=(-sx, 0, 0))
    b.face([(-1.16, y1 - 0.06, CZ0 + 0.03), (1.16, y1 - 0.06, CZ0 + 0.03), (1.16, y1 - 0.06, CZ1 - 0.03), (-1.16, y1 - 0.06, CZ1 - 0.03)], 'interior', want=(0, -1, 0))
    for (a, c) in (((-1.22, y0), (1.22, y0 + 0.06)), ((-1.22, y1 - 0.06), (1.22, y1)), ((-1.22, y0), (-1.16, y1)), ((1.16, y0), (1.22, y1))):
        b.box('paint', a[0], c[0], a[1], c[1], CZ1 - 0.035, CZ1 - 0.03)
    # inside: pump, meter, hose reel with the hose and nozzle
    b.cyl('dark', (-0.55, 1.55, CZ1 - 0.35), (-0.55, 1.55, CZ1 - 0.1), 0.2, 0.2, 12)
    b.box('grey', -0.2, 0.25, 1.4, 1.75, CZ1 - 0.35, CZ1 - 0.1)
    b.cyl('dark', (0.45, 2.05, CZ1 - 0.45), (0.45, 2.05, CZ1 - 0.08), 0.42, 0.42, 16)
    b.cyl('hose', (0.45, 2.05, CZ1 - 0.42), (0.45, 2.05, CZ1 - 0.11), 0.36, 0.36, 16)
    b.box('dark', 0.3, 0.6, 1.38, 1.5, CZ1 - 0.2, CZ1 - 0.08)
    b.panel('orange', [(-0.35, 2.66, CZ1 - 0.029), (0.35, 2.66, CZ1 - 0.029), (0.35, 2.82, CZ1 - 0.029), (-0.35, 2.82, CZ1 - 0.029)], (0, 0, 1), off=0.001)
    for sx in (-1, 1):
        hx = sx * 1.16
        d = Part(v, 'door_' + ('r' if sx > 0 else 'l'), pivot=(hx, (y0 + y1) / 2, CZ1),
                 joint=rot('y', 0.0, math.radians(110), group='door') if sx < 0 else rot('y', -math.radians(110), 0.0, stow=0.0, deploy=-math.radians(110), group='door'))
        d.box('paint', min(hx, 0), max(hx, 0), y0 + 0.07, y1 - 0.07, CZ1 - 0.03, CZ1 + 0.01)
        ural.outline(d, [(sx * 0.1, y0 + 0.15, CZ1 + 0.012), (sx * 0.1, y1 - 0.15, CZ1 + 0.012), (sx * 1.05, y1 - 0.15, CZ1 + 0.012), (sx * 1.05, y0 + 0.15, CZ1 + 0.012), (sx * 0.1, y0 + 0.15, CZ1 + 0.012)], (0, 0, 1), w=0.008)
        d.panel('vents', [(sx * 0.35, y1 - 0.45, CZ1 + 0.01), (sx * 0.8, y1 - 0.45, CZ1 + 0.01), (sx * 0.8, y1 - 0.25, CZ1 + 0.01), (sx * 0.35, y1 - 0.25, CZ1 + 0.01)], (0, 0, 1), off=0.003)
        vkit.grab_handle(d, (sx * 0.16, (y0 + y1) / 2, CZ1 + 0.012), (0, 1, 0), (0, 0, 1), 0.2, 0.035, 'dark')
        for y in (y0 + 0.25, y1 - 0.25):
            d.cyl('dark', (hx, y - 0.07, CZ1 + 0.012), (hx, y + 0.07, CZ1 + 0.012), 0.022, 0.022, 6)
    # the earthing chain dragging from the rear
    for k in range(6):
        b.box('dark', -0.02, 0.02, 0.9 - k * 0.12, 0.98 - k * 0.12, CZ1 + 0.02 + k * 0.02, CZ1 + 0.05 + k * 0.02)


def make():
    vkit.setup_materials('red_green')
    v = Vehicle('fuel_red', 'ATZ-5-4320 fuel tanker (Ural-4320)', scheme='red_green')
    b = Part(v, 'body')
    ural.ural(v, b)
    b.box('dark', -0.46, 0.46, URAL['frame'][1], URAL['bed'], TZ0 - 0.1, CZ1 - 0.05)     # sub-frame
    build_tank(b)
    build_compartment(v, b)
    ural.rear_fenders(b, 4.25, 6.85, y=URAL['bed'])
    ural.rear_end(b, URAL['len'])
    return v
