# ═══════════════════════════════════════════════════════════════
# Harpoon coastal defence launcher: four RGM-84 Harpoon canisters on an elevating cradle, on the kit's HEMTT A4
# 8×8 chassis (usfam.py).
#   blender -b -P tools/airbases/build.py -- hcds
# The Boeing Harpoon Coastal Defense System (HCDS, fielded by Denmark, Egypt, Taiwan…) puts a four-canister
# launcher on an 8×8 truck with an elevating cradle: travel flat, then jacked down and elevated to ~35° to fire over
# the cab. The Harpoon canister here is 4.7 m long, 0.68 m across (Mk 141 launcher canister class), in a 2 × 2
# rack. Chassis: HEMTT A4 (9.12 × 2.44 m). Photos: Danish Harpoon coastal launchers and Taiwan's truck-mounted
# Harpoon battery (Wikimedia Commons), Boeing HCDS brochure layout.
# Rig: erector (rot x 0 → 0.61 rad about the cradle's rear pivot, group 'raise'), jack_fl/fr/rl/rr (slide −y,
# group 'jack'), muzzle_1..4 (canister fronts: 1-2 upper left → right, 3-4 lower), ram_l / ram_r, 8 wheels (front
# tandem steers), door_l / door_r, exhaust.
# ═══════════════════════════════════════════════════════════════
import math
import akit
import vkit
from akit import Vehicle, Part, rot, slide
import usfam

AXLES = [1.95, 3.47, 6.61, 8.13]
ZEND = 9.12
DECK = 1.30
PIVOT = (0.0, 1.92, 8.95)
CAN = {'z0': 4.25, 'z1': 8.95, 'r': 0.34, 'xs': (-0.37, 0.37), 'ys': (2.36 + 0.72, 2.36)}


def jack(v, name, x, z, top, foot=0.45):
    j = Part(v, name, pivot=(x, top, z), joint=slide('-y', foot, group='jack'))
    j.cyl('steel', (x, foot + 0.07, z), (x, top - 0.04, z), 0.07, 0.07, 10)
    j.cyl('dark', (x, foot, z), (x, foot + 0.07, z), 0.24, 0.21, 14)
    j.cyl('dark', (x, foot + 0.07, z), (x, foot + 0.14, z), 0.11, 0.09, 10)
    return j


def jack_housing(b, x, z, y0, y1):
    b.cyl('paint', (x, y0, z), (x, y1, z), 0.1, 0.1, 12)
    b.cyl('dark', (x, y0 - 0.02, z), (x, y0 + 0.05, z), 0.12, 0.12, 12)
    sx = 1 if x > 0 else -1
    b.box('dark', x - sx * 0.1, sx * 0.5, y1 - 0.14, y1 - 0.02, z - 0.09, z + 0.09)


def build_deck(v, b):
    # deck behind the engine, the cradle's pivot pedestals and travel rest, stowage and the launch-control box
    b.box('paint', -1.15, 1.15, DECK - 0.06, DECK, 3.98, ZEND)
    b.panel('tread_plate', [(-1.1, DECK, 4.02), (1.1, DECK, 4.02), (1.1, DECK, 4.9), (-1.1, DECK, 4.9)], (0, 1, 0), off=0.004)
    px, py, pz = PIVOT
    for sx in (-1, 1):
        b.box('paint', sx * 0.72, sx * 0.92, DECK, py + 0.1, pz - 0.45, pz + 0.12, bev=0.02)
        b.cyl('dark', (sx * 0.66, py, pz), (sx * 0.98, py, pz), 0.09, 0.09, 12)
        b.box('paint', sx * 0.5, sx * 0.72, DECK, 1.62, 4.3, 4.55, bev=0.02)                    # travel rest posts
        b.box('rubber', sx * 0.48, sx * 0.74, 1.62, 1.66, 4.28, 4.57)
        b.box('dark', sx * 0.28, sx * 0.5, DECK, DECK + 0.2, 5.9, 6.25)                         # ram brackets
        # side lockers under the cradle
        b.box('paint', sx * 0.92, sx * 1.2, DECK, 1.9, 5.0, 7.8, bev=0.02)
        usfam.hatch_x(b, sx * 1.2, sx, DECK + 0.05, 1.85, 5.1, 6.4)
        usfam.hatch_x(b, sx * 1.2, sx, DECK + 0.05, 1.85, 6.5, 7.7, hinge='back')
    b.box('paint', -0.5, 0.5, DECK, 1.62, 4.62, 5.3, bev=0.02)                                   # launch control unit
    b.panel('vents', [(-0.4, 1.62, 4.7), (0.4, 1.62, 4.7), (0.4, 1.62, 5.2), (-0.4, 1.62, 5.2)], (0, 1, 0), off=0.003)
    b.tube('cable', [(0.3, 1.5, 5.3), (0.35, 1.45, 6.4), (0.6, 1.5, 8.4), (0.7, py - 0.05, pz - 0.3)], 0.025, 5)
    # jack housings and the jacks (front pair behind the front tandem, rear pair at the tail)
    for sx in (-1, 1):
        jack_housing(b, sx * 1.34, 4.4, 0.95, 1.3)
        jack_housing(b, sx * 1.30, 8.92, 0.95, 1.3)
    for name, x, z in (('jack_fl', -1.34, 4.4), ('jack_fr', 1.34, 4.4), ('jack_rl', -1.30, 8.92), ('jack_rr', 1.30, 8.92)):
        jack(v, name, x, z, 1.3, foot=0.45)
    # rear crossmember: lights, reflectors, pintle
    b.box('paint', -1.2, 1.2, 0.72, 1.24, ZEND - 0.22, ZEND, bev=0.02)
    for sx in (-1, 1):
        vkit.lamp_box(b, (sx * 0.95, 1.05, ZEND + 0.02), (0.22, 0.1, 0.05), (0, 0, 1), lens='lens_red')
        vkit.lamp_box(b, (sx * 0.95, 0.9, ZEND + 0.02), (0.1, 0.08, 0.05), (0, 0, 1), lens='lens_amber')
        usfam.reflector_tri(b, (sx * 0.62, 1.05, ZEND), (0, 0, 1), 0.06)
    b.box('dark', -0.12, 0.12, 0.78, 0.98, ZEND, ZEND + 0.1)
    for sx in (-1, 1):
        usfam.stencil_box(b, (sx * 0.55, 0.83, -0.005), 0.3, 0.07, (0, 0, -1))
    vkit.whip_antenna(b, (1.05, 2.86, 2.3), h=2.4)
    vkit.whip_antenna(b, (-1.05, 2.86, 2.3), h=1.6)


def build_erector(v):
    px, py, pz = PIVOT
    e = Part(v, 'erector', pivot=PIVOT, joint=rot('x', 0.0, 0.61, stow=0.0, deploy=0.61, group='raise'))
    z0, z1, r = CAN['z0'], CAN['z1'], CAN['r']
    ylo = CAN['ys'][1] - r - 0.08
    yhi = CAN['ys'][0] + r + 0.06
    # cradle: two longitudinal beams under the rack, cross members, end frames round the canisters
    for sx in (-1, 1):
        e.box('paint', sx * 0.56, sx * 0.76, ylo - 0.18, ylo, z0 + 0.1, z1)
        e.box('paint', sx * 0.72, sx * 0.8, ylo, yhi, z1 - 0.2, z1)                     # rear frame posts
        e.box('paint', sx * 0.72, sx * 0.8, ylo, yhi, z0 + 0.3, z0 + 0.45)              # front frame posts
        e.box('paint', sx * 0.72, sx * 0.8, ylo, yhi, (z0 + z1) / 2 - 0.08, (z0 + z1) / 2 + 0.08)
        e.cyl('dark', (sx * 0.62, py, pz), (sx * 0.8, py, pz), 0.1, 0.1, 12)            # pivot bosses
        e.box('paint', sx * 0.62, sx * 0.8, py - 0.12, ylo, pz - 0.35, pz + 0.05)
    for z in (z0 + 0.35, (z0 + z1) / 2, z1 - 0.12):
        e.box('paint', -0.8, 0.8, ylo - 0.16, ylo, z - 0.08, z + 0.08)
        e.box('paint', -0.8, 0.8, yhi - 0.08, yhi, z - 0.08, z + 0.08)
    e.box('dark', -0.06, 0.06, ylo - 0.1, yhi, z0 + 0.3, z0 + 0.45)                     # centre post (front)
    # canisters: ribbed tubes, frangible front covers, aft closures with the umbilical boxes
    k = 1
    for y in CAN['ys']:
        for x in CAN['xs']:
            e.cyl('missile_green', (x, y, z0), (x, y, z1 - 0.02), r, r, 16, cap0=False, cap1=False)
            for zz in (z0 + 0.12, z0 + 1.2, (z0 + z1) / 2 + 0.3, z1 - 1.0, z1 - 0.14):
                e.cyl('missile_green', (x, y, zz - 0.05), (x, y, zz + 0.05), r + 0.03, r + 0.03, 16)
            e.disc('radome', (x, y, z0 - 0.001), (0, 0, -1), r - 0.02, 16)
            e.cyl('dark', (x, y, z0 - 0.01), (x, y, z0 + 0.02), r + 0.005, r + 0.005, 16, cap0=False, cap1=False)
            e.disc('dark', (x, y, z1 - 0.02), (0, 0, 1), r, 16)
            e.box('dark', x - 0.1, x + 0.1, y - 0.08, y + 0.08, z1 - 0.02, z1 + 0.06)
            usfam.stencil_box(e, (x, y + r + 0.031, z0 + 0.7), 0.4, 0.08, (0, 1, 0))
            e.empty('muzzle_%d' % k, (x, y, z0 - 0.04), (0, 0, -1))
            k += 1
    # ram anchors under the cradle
    for sx in (-1, 1):
        e.box('dark', sx * 0.3 - 0.06, sx * 0.3 + 0.06, ylo - 0.3, ylo - 0.16, 5.35, 5.6)
    return e


def make():
    akit.setup_materials('blue_tan')
    v = Vehicle('hcds', 'Harpoon coastal defence launcher', scheme='blue_tan')
    b = Part(v, 'body')
    usfam.hemtt_cab(v, b)
    usfam.hemtt_engine(b, spare=False)
    usfam.hemtt_chassis(v, b, AXLES, ZEND, fenders=((), ((5.92, 8.82),)))
    build_deck(v, b)
    e = build_erector(v)
    for sx, n in ((-1, 'ram_l'), (1, 'ram_r')):
        vkit.ram(v, n, b, (sx * 0.39, DECK + 0.1, 6.1), e, (sx * 0.3, CAN['ys'][1] - CAN['r'] - 0.36, 5.48), r=0.08)
    return v
