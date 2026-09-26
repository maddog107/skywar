# ═══════════════════════════════════════════════════════════════
# Command-staff vehicle (KShM style) on the Ural-4320: a K-4320 box body (kung) with windows, a rear door and
# ladder, roof antenna bases and whip antennas, cable reels, an air-conditioner, and a telescopic antenna mast that
# lies along the roof for travel, swings up and extends two sections.
#   blender -b -P tools/vehicles/build.py -- cmd_red
# References: Ural-4320 box-body (kung) vehicles — command posts, R-series radio stations (photos on Wikimedia
# Commons); K-4320 body about 4.1 m long, 2.5 m wide, roof about 3.4 m.
# Rig: mast (rot about −x at its hinge on the roof front, 0 → 90°, group 'raise'), mast_2 / mast_3 (telescopic
# sections sliding out along the mast, 2.4 m each, 'raise'), door_rear (rot y 0 → 100°, group 'door'), 6 wheels,
# exhaust, seat_driver, hatch_entry.
# ═══════════════════════════════════════════════════════════════
import math
from mathutils import Vector
import vkit
from vkit import Vehicle, Part, rot, slide, lerp
import ural
from ural import URAL

Z0, Z1 = 3.40, 7.20        # box body
HX = 1.25
Y0, Y1 = 1.42, 3.38        # floor underside / roof
MAST_PIV = (0.62, Y1 + 0.16, 3.72)
MAST_L = 2.9


def kung(b, z0, z1, hx, y0, y1):
    """the insulated box body: a slightly rounded roof, stiffened panels, windows, roof fittings"""
    r = 0.09
    # body as a loft of cross-sections with rounded upper corners
    def ring(z):
        pts = [(-hx, y0), (hx, y0), (hx, y1 - r)]
        for k in range(1, 4):
            a = math.pi / 2 * k / 4
            pts.append((hx - r + r * math.cos(a), y1 - r + r * math.sin(a)))
        pts.append((hx - r, y1))
        pts.append((-hx + r, y1))
        for k in range(1, 4):
            a = math.pi / 2 + math.pi / 2 * k / 4
            pts.append((-hx + r + r * math.cos(a), y1 - r + r * math.sin(a)))
        pts.append((-hx, y1 - r))
        return [(x, y, z) for (x, y) in pts]
    rings = [ring(z0), ring(z1)]
    b.loft('paint', rings, smooth=False)
    b.face(rings[0], 'paint', want=(0, 0, -1))
    b.face(rings[1], 'paint', want=(0, 0, 1))
    # panel seams and vertical stiffening ribs on the sides
    for sx in (-1, 1):
        x = sx * hx
        for z in [z0 + 0.05 + i * (z1 - z0 - 0.1) / 6 for i in range(7)]:
            b.box('paint', x, x + sx * 0.025, y0 + 0.05, y1 - 0.12, z - 0.025, z + 0.025)
        b.box('paint', x, x + sx * 0.03, y0, y0 + 0.08, z0, z1)
        # windows with armoured shutters (two a side), the shutters folded up
        for zc in (z0 + 1.1, z1 - 1.3):
            b.panel('glass', [(x, 2.35, zc - 0.3), (x, 2.35, zc + 0.3), (x, 2.8, zc + 0.3), (x, 2.8, zc - 0.3)], (sx, 0, 0), off=0.03, frame=0.035, frame_skin='dark')
            b.box('paint', x + sx * 0.03, x + sx * 0.06, 2.82, 3.02, zc - 0.34, zc + 0.34)
        # ventilation grille and the cable entry panel
        b.panel('vents', [(x, 1.7, z0 + 2.1), (x, 1.7, z0 + 2.5), (x, 1.95, z0 + 2.5), (x, 1.95, z0 + 2.1)], (sx, 0, 0), off=0.03)
    b.panel('dark', [(-1.21, 1.6, z0 - 0.001), (-0.55, 1.6, z0 - 0.001), (-0.55, 2.2, z0 - 0.001), (-1.21, 2.2, z0 - 0.001)], (0, 0, -1), off=0.005)
    # front wall: the air-conditioner / filter-ventilation unit
    b.box('paint', -0.5, 0.5, 2.5, 3.15, z0 - 0.35, z0, bev=0.03)
    b.panel('vents', [(-0.42, 2.58, z0 - 0.352), (0.42, 2.58, z0 - 0.352), (0.42, 3.08, z0 - 0.352), (-0.42, 3.08, z0 - 0.352)], (0, 0, -1), off=0.003)
    # roof: antenna bases, a walkway strip, the roof hatch, marker lamps
    b.panel('tread_plate', [(-0.2, y1, z0 + 0.4), (0.2, y1, z0 + 0.4), (0.2, y1, z1 - 0.4), (-0.2, y1, z1 - 0.4)], (0, 1, 0), off=0.004)
    b.panel('paint', [(-0.9, y1, z1 - 1.2), (-0.35, y1, z1 - 1.2), (-0.35, y1, z1 - 0.65), (-0.9, y1, z1 - 0.65)], (0, 1, 0), off=0.03, frame=0.03, frame_skin='dark')
    for sx in (-1, 1):
        vkit.lamp_box(b, (sx * (hx - 0.1), y1 - 0.12, z1 + 0.025), (0.12, 0.08, 0.05), (0, 0, 1), lens='lens_red')
        vkit.lamp_box(b, (sx * (hx - 0.1), y1 - 0.12, z0 - 0.025), (0.12, 0.08, 0.05), (0, 0, -1), lens='lens')
    # rear wall: frame of the door opening, cable reels either side, a rack for the generator cable
    for sx in (-1, 1):
        b.cyl('dark', (sx * 0.92, 1.95, z1), (sx * 0.92, 1.95, z1 + 0.12), 0.26, 0.26, 16)
        b.cyl('cable', (sx * 0.92, 1.95, z1 + 0.12), (sx * 0.92, 1.95, z1 + 0.28), 0.21, 0.21, 16)
        b.cyl('dark', (sx * 0.92, 1.95, z1 + 0.28), (sx * 0.92, 1.95, z1 + 0.32), 0.26, 0.26, 16)
    ural.outline(b, [(-0.42, 1.5, z1 + 0.001), (-0.42, 3.1, z1 + 0.001), (0.42, 3.1, z1 + 0.001), (0.42, 1.5, z1 + 0.001), (-0.42, 1.5, z1 + 0.001)], (0, 0, 1))


def build_door(v, z1):
    d = Part(v, 'door_rear', pivot=(0.42, 2.3, z1), joint=rot('y', 0.0, math.radians(100), group='door'))
    d.box('paint', -0.4, 0.4, 1.52, 3.08, z1, z1 + 0.05)
    d.panel('glass', [(-0.18, 2.55, z1 + 0.05), (0.18, 2.55, z1 + 0.05), (0.18, 2.85, z1 + 0.05), (-0.18, 2.85, z1 + 0.05)], (0, 0, 1), off=0.004, frame=0.03, frame_skin='rubber')
    vkit.grab_handle(d, (-0.3, 2.2, z1 + 0.055), (0, 1, 0), (0, 0, 1), 0.2, 0.04, 'dark')
    for y in (1.75, 2.85):
        d.cyl('dark', (0.4, y - 0.08, z1 + 0.03), (0.4, y + 0.08, z1 + 0.03), 0.022, 0.022, 6)
    return d


def build_mast(v):
    """a hinged, two-stage telescopic mast lying back along the roof; its head carries a small dipole array"""
    px, py, pz = MAST_PIV
    m = Part(v, 'mast', pivot=MAST_PIV, joint=rot('-x', 0.0, math.pi / 2, group='raise'))
    # base tube along +z (backwards over the roof)
    m.cyl('paint', (px, py, pz), (px, py, pz + MAST_L), 0.075, 0.075, 12, smooth=True)
    m.cyl('dark', (px, py, pz + MAST_L - 0.08), (px, py, pz + MAST_L), 0.09, 0.09, 12)
    m.cyl('dark', (px - 0.14, py, pz), (px + 0.14, py, pz), 0.06, 0.06, 10)       # hinge pin
    m.box('dark', px - 0.1, px + 0.1, py - 0.14, py + 0.02, pz - 0.1, pz + 0.3)    # hinge block
    stages = []
    parent = m
    r = 0.058
    for k, name in enumerate(('mast_2', 'mast_3')):
        s = Part(v, name, pivot=(px, py, pz), parent=parent, joint=slide('z', 2.4, group='raise'))
        z_in = pz + 0.35 + k * 0.1
        s.cyl('aluminium' if k else 'paint', (px, py, z_in), (px, py, pz + MAST_L + 0.08 + k * 0.1), r, r, 10, smooth=True)
        s.cyl('dark', (px, py, pz + MAST_L + 0.02 + k * 0.1), (px, py, pz + MAST_L + 0.08 + k * 0.1), r + 0.015, r + 0.015, 10)
        stages.append(s)
        parent = s
        r *= 0.78
    # the mast head on the last stage: a crossbar with two dipoles and a small whip
    top = pz + MAST_L + 0.2
    h = stages[-1]
    h.box('dark', px - 0.06, px + 0.06, py - 0.06, py + 0.06, top - 0.08, top + 0.06)
    h.beam('aluminium', (px - 0.6, py, top), (px + 0.6, py, top), 0.03, 0.03)
    for sx in (-1, 1):
        h.cyl('aluminium', (px + sx * 0.6, py - 0.45, top), (px + sx * 0.6, py + 0.45, top), 0.012, 0.012, 5)
    h.cyl('black', (px, py, top + 0.06), (px, py, top + 0.3), 0.014, 0.008, 5)
    h.empty('mast_head', (px, py, top + 0.3), (0, 0, 1))
    # guy-rope anchor ring and the stowage clamp on the roof
    return m


def make():
    vkit.setup_materials('red_green')
    v = Vehicle('cmd_red', 'Command-staff vehicle (KShM, Ural-4320 with a K-4320 box body)', scheme='red_green')
    b = Part(v, 'body')
    ural.ural(v, b)
    b.box('dark', -0.46, 0.46, URAL['frame'][1], Y0, Z0 + 0.15, Z1 - 0.15)     # sub-frame
    kung(b, Z0, Z1, HX, Y0, Y1)
    ural.rear_fenders(b, 4.25, 6.85, y=Y0)
    ural.rear_end(b, URAL['len'])
    # the boarding ladder hooked under the rear door
    for x in (-0.3, 0.3):
        b.beam('dark', (x, 0.55, Z1 + 0.42), (x, Y0 + 0.02, Z1 + 0.06), 0.035, 0.035)
    for k in range(3):
        y = lerp(0.62, Y0 - 0.12, k / 2)
        t = (y - 0.55) / (Y0 + 0.02 - 0.55)
        zc = lerp(Z1 + 0.42, Z1 + 0.06, t)
        b.box('dark', -0.3, 0.3, y - 0.02, y + 0.02, zc - 0.07, zc + 0.07)
    build_door(v, Z1)
    # whip antennas on the roof corners and the front antenna base
    for (x, z, h) in ((-1.1, Z0 + 0.25, 2.6), (1.1, Z1 - 0.25, 2.3), (-1.1, Z1 - 0.25, 2.0)):
        vkit.whip_antenna(b, (x, Y1, z), h=h)
        # the tie-down bow that holds the whip bent over for travel is omitted: whips stand up
    b.cyl('dark', (0.95, Y1, Z0 + 0.3), (0.95, Y1 + 0.2, Z0 + 0.3), 0.06, 0.05, 8)
    # the mast's roof stowage saddle at its tip
    b.box('dark', MAST_PIV[0] - 0.12, MAST_PIV[0] + 0.12, Y1, MAST_PIV[1] - 0.075, MAST_PIV[2] + MAST_L - 0.25, MAST_PIV[2] + MAST_L - 0.1)
    build_mast(v)
    return v
