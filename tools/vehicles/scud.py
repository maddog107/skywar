# ═══════════════════════════════════════════════════════════════
# 9P117M1 TEL of the 9K72 "Elbrus" system (NATO SS-1C "Scud-B") on the MAZ-543A, with an R-17 missile.
#   blender -b -P tools/vehicles/build.py -- scud
# References: MAZ-543A drawings/specs (11.46 m, 3.07 m, axles 2.2 + 3.3 + 2.2 m, track 2.375 m, 1500×600-635 tyres),
# the 9P117 photos at the Artillery Museum, St Petersburg and the erected TEL at Lviv (Wikimedia Commons),
# R-17: 11.16 m long, 0.88 m diameter, 1.8 m fin span.
# Rig: erector (rot x about the rear hinge, 0 → 90°, group 'raise'), missile (child of the erector, origin on the
# base, nose along −z), nozzle (empty, −z = exhaust flow), pad (the launch table, rot x 0 → 90°, group 'pad'),
# jack_fl/fr/rl/rr (slide −y, group 'jack'), ram_l / ram_r (telescopic erector rams), wheels, exhaust,
# seat_driver, hatch_entry.
# ═══════════════════════════════════════════════════════════════
import math
from mathutils import Vector
import vkit
from vkit import Vehicle, Part, rot, slide, lerp
import chassis
from chassis import MAZ

HINGE = (0.0, 1.72, 11.20)      # erector hinge (x, y, z)
MIS_Y = 2.62                    # missile axis height in travel
MIS_NOSE = 0.95                 # nose tip z in travel
MIS_LEN = 11.16
MIS_R = 0.44
PAD_HINGE = (0.0, 0.70, 11.51)  # launch pad hinge


def r17_profile():
    """(t from the nose tip, radius, skin) — warhead ogive, body, tail flare"""
    wh = 'odgreen'
    body = 'missile_green'
    return [
        (0.0, 0.0, wh), (0.06, 0.05, wh), (0.35, 0.13, wh), (0.8, 0.22, wh), (1.3, 0.30, wh), (1.8, 0.36, wh),
        (2.3, 0.405, wh), (2.75, 0.435, 'dark'), (2.82, 0.44, body), (5.9, 0.44, 'dark'), (5.95, 0.44, body),
        (9.75, 0.44, 'dark'), (9.8, 0.44, body), (10.9, 0.45, body), (11.12, 0.46, 'dark'), (11.16, 0.40, 'soot'),
    ]


def build_missile(v, parent):
    tail = Vector((0, MIS_Y, MIS_NOSE + MIS_LEN))
    m = Part(v, 'missile', pivot=tuple(tail), parent=parent)
    nose = Vector((0, MIS_Y, MIS_NOSE))
    # body of revolution (the X of the fins is at 45°: phase so seams fall between fins)
    m.lathe(nose, (0, 0, 1), r17_profile(), n=20, smooth=True, cap1=False)
    # nozzle: a dark recessed bell at the base
    m.lathe(tail + Vector((0, 0, -0.30)), (0, 0, 1), [(0.0, 0.10, 'soot'), (0.30, 0.34, 'soot')], n=16, smooth=True)
    m.disc('soot', tail + Vector((0, 0, -0.28)), (0, 0, 1), 0.11, 10)
    # four trapezoidal tail fins in an X (swept leading edge), with root fairings
    for k in range(4):
        ang = math.radians(45 + 90 * k)
        d = Vector((math.cos(ang), math.sin(ang), 0))
        t = Vector((-math.sin(ang), math.cos(ang), 0)) * 0.022   # half thickness
        zr0, zr1 = MIS_NOSE + 9.95, MIS_NOSE + 11.02            # root chord
        zt0, zt1 = MIS_NOSE + 10.55, MIS_NOSE + 10.98           # tip chord
        r0, r1 = MIS_R, 0.90
        base = Vector((0, MIS_Y, 0))
        A = base + d * r0 + Vector((0, 0, zr0))
        B = base + d * r0 + Vector((0, 0, zr1))
        C = base + d * r1 + Vector((0, 0, zt1))
        D = base + d * r1 + Vector((0, 0, zt0))
        pts = [A, B, C, D]
        for s in (1, -1):
            m.face([tuple(p + t * s) for p in pts], 'missile_green', want=tuple(t * s))
        for i in range(4):
            j = (i + 1) % 4
            e = (pts[i] + pts[j]) / 2 - (A + C) / 2
            m.face([tuple(pts[i] + t), tuple(pts[j] + t), tuple(pts[j] - t), tuple(pts[i] - t)], 'missile_green', want=tuple(e))
        # fin root fairing strip
        m.beam('missile_green', base + d * (r0 + 0.01) + Vector((0, 0, zr0 - 0.2)), base + d * (r0 + 0.01) + Vector((0, 0, zr1)), 0.07, 0.03, up=tuple(d))
    # cable duct along the side (fairing), and the fuelling / drain fittings
    for side in (1, -1):
        a = math.radians(90 if side > 0 else 270)
        d = Vector((math.cos(a) * 0.0 + side, 0, 0))
        m.beam('missile_green', (side * (MIS_R + 0.015), MIS_Y + 0.0, MIS_NOSE + 3.1), (side * (MIS_R + 0.015), MIS_Y, MIS_NOSE + 9.7), 0.05, 0.1, up=(1, 0, 0))
    for z in (4.6, 7.4):
        m.cyl('dark', (0.0, MIS_Y + MIS_R - 0.01, MIS_NOSE + z), (0.0, MIS_Y + MIS_R + 0.03, MIS_NOSE + z), 0.06, 0.06, 8)
    # the nozzle empty: its -z points along the exhaust flow (aft when stowed, down when erected)
    m.empty('nozzle', tail, (0, 0, 1))
    return m


def build_erector(v):
    hx, hy, hz = HINGE
    e = Part(v, 'erector', pivot=HINGE, joint=rot('x', 0.0, math.pi / 2, group='raise'))
    y0, y1 = 1.98, 2.16
    rx = 0.30
    za, zb = 3.35, 10.70
    for sx in (-1, 1):
        # main box beams under the missile, dropping to the hinge at the rear
        e.box('paint', sx * rx - 0.07, sx * rx + 0.07, y0, y1, za, zb, bev=0.015)
        e.beam('paint', (sx * rx, (y0 + y1) / 2, zb - 0.1), (sx * 0.34, hy + 0.05, hz - 0.05), 0.14, 0.18)
        # the wide base frame (the trapezoid seen when erected)
        e.beam('paint', (sx * 0.62, hy, hz), (sx * rx, y0 + 0.05, 9.55), 0.1, 0.1)
        e.beam('paint', (sx * 0.62, hy, hz), (sx * 0.62, y0 - 0.1, 10.15), 0.09, 0.09)
        e.beam('paint', (sx * 0.62, y0 - 0.1, 10.15), (sx * rx, y0 + 0.05, 9.55), 0.07, 0.07)
        # hydraulic lines along the beam
        e.tube('hose', [(sx * (rx + 0.08), y0 + 0.04, 4.0), (sx * (rx + 0.08), y0 + 0.04, 9.4), (sx * (rx + 0.1), hy + 0.2, hz - 0.2)], 0.012, 5)
        # ram brackets
        e.box('dark', sx * rx - 0.05, sx * rx + 0.05, y0 - 0.12, y0, 9.05, 9.35)
    # hinge tube and bearings
    e.cyl('dark', (-0.72, hy, hz), (0.72, hy, hz), 0.09, 0.09, 12)
    # cross members and X bracing between the beams
    zs = [3.45, 4.9, 6.3, 7.7, 9.1, 10.5]
    for z in zs:
        e.box('paint', -rx, rx, y0 + 0.02, y1 - 0.04, z - 0.05, z + 0.05)
    for i in range(len(zs) - 1):
        e.beam('paint', (-rx, y0 + 0.06, zs[i]), (rx, y0 + 0.06, zs[i + 1]), 0.05, 0.05)
    # cradle saddles (curved supports hugging the missile) and clamp bands over it
    for z, full in ((4.25, True), (8.35, False)):
        arc = []
        for k in range(13):
            a = math.radians(200 + 140 * k / 12)
            arc.append((math.cos(a) * (MIS_R + 0.05), MIS_Y + math.sin(a) * (MIS_R + 0.05), z))
        e.tube('paint', arc, 0.045, 6)
        for sx in (-1, 1):
            e.beam('paint', (sx * rx, y1, z), (sx * (MIS_R + 0.05) * 0.94, MIS_Y - 0.17, z), 0.08, 0.1)
            e.box('dark', sx * rx - 0.06, sx * rx + 0.06, y1 - 0.02, y1 + 0.04, z - 0.12, z + 0.12)
        if full:
            # the ring clamp (upper yoke): a full band with hinge lugs
            ring = []
            for k in range(25):
                a = math.radians(-20 + 220 * k / 24)
                ring.append((math.cos(a) * (MIS_R + 0.035), MIS_Y + math.sin(a) * (MIS_R + 0.035), z))
            e.tube('dark', ring, 0.03, 6)
            e.box('dark', MIS_R - 0.02, MIS_R + 0.14, MIS_Y - 0.12, MIS_Y + 0.02, z - 0.06, z + 0.06)
        else:
            band = []
            for k in range(19):
                a = math.radians(-15 + 210 * k / 18)
                band.append((math.cos(a) * (MIS_R + 0.02), MIS_Y + math.sin(a) * (MIS_R + 0.02), z))
            e.tube('dark', band, 0.02, 5)
    # tail support (fin guard) at the rear end
    e.box('paint', -0.5, 0.5, y0 - 0.02, y0 + 0.08, 10.55, 10.75)
    return e


def build_pad(v):
    """the launch table (modelled deployed, then turned −90° about its hinge into the stowed position)"""
    hx, hy, hz = PAD_HINGE
    p = Part(v, 'pad', pivot=PAD_HINGE, joint=rot('x', 0.0, math.pi / 2, group='pad'))
    tc = Vector((0, 0.81, 12.10))       # table top centre when deployed (the missile base rests on it)
    s = 0.58                             # half size of the table
    # four splayed legs with screw feet (on the ground when deployed)
    for (x, z) in ((-s, -s), (s, -s), (s, s), (-s, s)):
        p.cyl('dark', (x * 1.12, 0.0, tc.z + z * 1.12), (x * 1.12, 0.05, tc.z + z * 1.12), 0.1, 0.09, 10)     # foot pads
        p.cyl('steel', (x * 1.12, 0.05, tc.z + z * 1.12), (x * 1.12, 0.3, tc.z + z * 1.12), 0.035, 0.035, 8)  # screws
        p.beam('dark', (x * 1.12, 0.28, tc.z + z * 1.12), (x * 0.8, tc.y - 0.1, tc.z + z * 0.8), 0.09, 0.09)  # legs
    # table: a square plate with a raised ring collar and the central opening
    p.box('paint', -s * 0.85, s * 0.85, tc.y - 0.12, tc.y - 0.04, tc.z - s * 0.85, tc.z + s * 0.85, bev=0.02)
    p.lathe((0, tc.y - 0.04, tc.z), (0, 1, 0), [(0, 0.5, 'paint'), (0.04, 0.5, 'paint'), (0.04, 0.3, 'dark'), (0.0, 0.3, 'blast')], n=20, smooth=False)
    p.disc('blast', (0, tc.y - 0.035, tc.z), (0, 1, 0), 0.3, 16)
    # blast deflector: a cone under the table, apex down
    p.cyl('blast', (0, tc.y - 0.13, tc.z), (0, 0.18, tc.z), 0.46, 0.02, 16, cap0=False)
    # support pads on the table for the missile's base ring (4) and the fin guides
    for k in range(4):
        a = math.radians(45 + 90 * k)
        c = Vector((math.cos(a) * 0.42, tc.y, tc.z + math.sin(a) * 0.42))
        p.box('dark', c.x - 0.06, c.x + 0.06, tc.y - 0.04, tc.y + 0.06, c.z - 0.06, c.z + 0.06)
    # hinge arms from the table's front edge to the hinge
    for sx in (-1, 1):
        p.beam('paint', (sx * 0.4, tc.y - 0.08, tc.z - s * 0.85), (sx * 0.4, hy, hz), 0.1, 0.1)
        p.cyl('dark', (sx * 0.5, hy, hz), (sx * 0.3, hy, hz), 0.08, 0.08, 10)
    # turn into the stowed position (folded up behind the vehicle)
    p.rotate_about(PAD_HINGE, (1, 0, 0), -math.pi / 2)
    return p


def build_jack(v, name, x, z, top=1.52, foot=0.50):
    """a stabiliser jack: the housing is on the body; the node is the inner leg + foot, sliding down `foot` metres"""
    j = Part(v, name, pivot=(x, top, z), joint=slide('-y', foot, group='jack'))
    j.cyl('steel', (x, foot + 0.07, z), (x, top - 0.05, z), 0.065, 0.065, 10)
    j.cyl('dark', (x, foot, z), (x, foot + 0.07, z), 0.22, 0.2, 14)
    j.cyl('dark', (x, foot + 0.07, z), (x, foot + 0.13, z), 0.1, 0.08, 10)
    return j


def jack_housing(b, x, z, y0=0.95, y1=1.62):
    b.cyl('paint', (x, y0, z), (x, y1, z), 0.095, 0.095, 12)
    b.cyl('dark', (x, y0 - 0.02, z), (x, y0 + 0.04, z), 0.11, 0.11, 12)
    sx = 1 if x > 0 else -1
    b.box('dark', x - sx * 0.1, sx * 0.56, y1 - 0.12, y1 - 0.02, z - 0.08, z + 0.08)   # bracket to the frame


def build_body(v, b):
    lay = chassis.maz543(v, b, 'A')
    zr = MAZ['len']
    yf = MAZ['body_floor']
    # deck between the side bodies (the erector lies on it in travel)
    b.box('paint', -0.80, 0.80, 1.30, 1.42, 2.95, zr - 0.05)
    b.panel('tread_plate', [(-0.78, 1.42, 3.0), (0.78, 1.42, 3.0), (0.78, 1.42, zr - 0.1), (-0.78, 1.42, zr - 0.1)], (0, 1, 0), off=0.004)
    for sx in (-1, 1):
        xo, xi = sx * 1.53, sx * 0.80
        # section A: tall compartment behind the cab (air intakes up top), chamfered outer top edge
        prof = [(1.58, 0.0), (2.30, 0.0), (2.55, 0.25), (2.55, 0.73)]   # (y, inset from xo) — built as a prism along z
        pa = [(xo, 1.58), (xo, 2.30), (xo - sx * 0.25, 2.55), (xi, 2.55), (xi, 1.58)]
        b.prism_z('paint', pa, 2.95, 5.40)
        vkit.louvres(b, xo, 1.95, 2.25, 3.15, 4.05, 7, side=sx)
        vkit.louvres(b, xo, 1.62, 1.88, 3.15, 4.05, 6, side=sx)
        # compartment door (outline, hinges, latch)
        for (p0, p1) in (((xo, 1.62, 4.25), (xo, 2.26, 4.25)), ((xo, 1.62, 5.20), (xo, 2.26, 5.20)), ((xo, 2.26, 4.25), (xo, 2.26, 5.20))):
            P0, P1 = Vector(p0), Vector(p1)
            w = Vector((0, 0.01, 0)) if abs((P1 - P0).y) < 0.1 else Vector((0, 0, 0.01))
            b.panel('black', [P0 - w, P1 - w, P1 + w, P0 + w], (sx, 0, 0), off=0.003)
        vkit.grab_handle(b, (xo + sx * 0.01, 1.95, 5.05), (0, 1, 0), (sx, 0, 0), 0.18, 0.03, 'dark')
        # handrail along the top edge of section A
        vkit.handrail(b, [(xo - sx * 0.2, 2.40, 3.1), (xo - sx * 0.12, 2.60, 3.2), (xo - sx * 0.12, 2.60, 5.2), (xo - sx * 0.2, 2.40, 5.3)], 0.016, 'dark')
        # section B: lower compartments along the middle, round access hatches
        pb = [(xo, 1.58), (xo, 2.02), (xo - sx * 0.18, 2.20), (xi, 2.20), (xi, 1.58)]
        b.prism_z('paint', pb, 5.40, 9.55)
        for z in (5.95, 8.95):
            b.lathe((xo, 1.90, z), (sx, 0, 0), [(0.0, 0.2, 'paint'), (0.03, 0.2, 'paint'), (0.03, 0.17, 'paint'), (0.045, 0.0, 'paint')], n=14, smooth=False)
            b.cyl('dark', (xo + sx * 0.03, 1.90, z - 0.2), (xo + sx * 0.03, 1.90, z - 0.12), 0.03, 0.03, 6)
        for (p0, p1) in (((xo, 1.62, 6.6), (xo, 1.98, 6.6)), ((xo, 1.62, 7.5), (xo, 1.98, 7.5)), ((xo, 1.98, 6.6), (xo, 1.98, 7.5))):
            P0, P1 = Vector(p0), Vector(p1)
            w = Vector((0, 0.01, 0)) if abs((P1 - P0).y) < 0.1 else Vector((0, 0, 0.01))
            b.panel('black', [P0 - w, P1 - w, P1 + w, P0 + w], (sx, 0, 0), off=0.003)
        vkit.grab_handle(b, (xo + sx * 0.01, 1.82, 7.3), (0, 1, 0), (sx, 0, 0), 0.15, 0.03, 'dark')
        # jerrycans in a rack on section B
        for k, z in enumerate((7.75, 8.1)):
            vkit.jerrycan(b, (xo + sx * 0.09, 1.60, z))
        b.box('dark', xo, xo + sx * 0.2, 1.58, 1.61, 7.55, 8.3)
        # section C: rear boxes
        pc = [(xo, 1.58), (xo, 1.95), (xo - sx * 0.12, 2.07), (xi, 2.07), (xi, 1.58)]
        b.prism_z('paint', pc, 9.55, 10.95)
        # stowage boxes / batteries between the wheel pairs (skirts) — with the front jack between them
        for (z0, z1) in ((5.60, 6.22), (6.64, 7.26)):
            b.box('paint', sx * 1.02, sx * 1.50, 0.92, yf, z0, z1, bev=0.02)
            vkit.grab_handle(b, (sx * 1.505, 1.3, (z0 + z1) / 2), (0, 0, 1), (sx, 0, 0), 0.2, 0.03, 'dark')
        # mudguards and flaps over each wheel pair
        chassis.maz_fender(b, sx, 1.80, 5.60)   # front pair (under the cab rear / section A)
        chassis.maz_fender(b, sx, 7.28, 11.05)
        # the front jack housing, and the rear one behind the last wheel
        jack_housing(b, sx * 1.33, 6.43, 0.95, yf)
        jack_housing(b, sx * 1.28, 11.14, 0.95, 1.75)
        # rear lights
        vkit.lamp_box(b, (sx * 1.25, 1.35, zr + 0.02), (0.22, 0.1, 0.06), (0, 0, 1), lens='lens_red')
        vkit.lamp_box(b, (sx * 1.25, 1.22, zr + 0.02), (0.1, 0.08, 0.06), (0, 0, 1), lens='lens_amber')
    # rear frame end: cross beam, tow pintle, number plate, erector hinge brackets
    b.box('paint', -1.45, 1.45, 1.05, 1.45, zr - 0.35, zr, bev=0.02)
    b.box('dark', -0.12, 0.12, 1.00, 1.18, zr, zr + 0.18)
    b.panel('white', [(-0.26, 1.2, zr), (0.26, 1.2, zr), (0.26, 1.36, zr), (-0.26, 1.36, zr)], (0, 0, 1), off=0.004)
    hx, hy, hz = HINGE
    for sx in (-1, 1):
        b.box('dark', sx * 0.74, sx * 0.86, 1.30, hy + 0.14, hz - 0.2, hz + 0.2)
        b.box('dark', sx * 0.52, sx * 0.62, 0.62, PAD_HINGE[1] + 0.12, PAD_HINGE[2] - 0.3, PAD_HINGE[2] + 0.1)
    # erector ram bases on the deck
    for sx in (-1, 1):
        b.box('dark', sx * 0.36, sx * 0.50, 1.40, 1.52, 7.0, 7.4)
    # nose guard hoop over the missile's warhead, between the cab roofs
    hoop = [(-0.55, 2.86, 1.25), (-0.5, 3.02, 1.25), (-0.3, 3.16, 1.25), (0.0, 3.2, 1.25), (0.3, 3.16, 1.25), (0.5, 3.02, 1.25), (0.55, 2.86, 1.25)]
    b.tube('paint', hoop, 0.035, 6)
    # searchlight on the right cab roof (post, lamp, cage) and a horn
    b.cyl('dark', (1.05, 2.92, 1.0), (1.05, 3.28, 1.0), 0.025, 0.025, 6)
    b.cyl('dark', (1.05, 3.28, 1.05), (1.05, 3.28, 0.86), 0.13, 0.12, 12)
    b.disc('lens', (1.05, 3.28, 0.855), (0, 0, -1), 0.11, 12)
    for k in range(4):
        a = math.radians(45 + 90 * k)
        b.tube('dark', [(1.05 + math.cos(a) * 0.14, 3.28 + math.sin(a) * 0.14, 1.02), (1.05 + math.cos(a) * 0.15, 3.28 + math.sin(a) * 0.15, 0.82)], 0.006, 4)
    b.cyl('dark', (-1.1, 2.92, 1.35), (-1.1, 3.0, 1.35), 0.04, 0.04, 6)
    b.cyl('dark', (-1.1, 3.0, 1.35), (-1.1, 3.04, 1.12), 0.03, 0.09, 10)
    # radio antenna on the left cab's rear corner
    vkit.whip_antenna(b, (-1.35, 2.92, 2.75), h=2.6)
    # engine exhaust: behind the left cab, pointing up and out
    b.cyl('dark', (-0.62, 2.1, 3.05), (-0.62, 2.72, 3.05), 0.07, 0.07, 8)
    b.cyl('soot', (-0.62, 2.72, 3.05), (-0.62, 2.76, 3.05), 0.075, 0.075, 8)
    b.empty('exhaust', (-0.62, 2.76, 3.05), (0, 1, 0))
    b.empty('seat_driver', (-1.0, 2.0, 1.75), (0, 0, -1))
    b.empty('hatch_entry', (-1.9, 0.0, 1.7), (1, 0, 0))
    return lay


def make():
    vkit.setup_materials('red_camo')
    v = Vehicle('scud', '9P117M1 TEL with R-17 (SS-1C Scud-B)', scheme='red_camo')
    b = Part(v, 'body')
    build_body(v, b)
    e = build_erector(v)
    build_missile(v, e)
    build_pad(v)
    for name, x, z, top in (('jack_fl', -1.33, 6.43, 1.52), ('jack_fr', 1.33, 6.43, 1.52), ('jack_rl', -1.28, 11.14, 1.70), ('jack_rr', 1.28, 11.14, 1.70)):
        build_jack(v, name, x, z, top=top, foot=0.50)
    for sx, n in ((-1, 'ram_l'), (1, 'ram_r')):
        vkit.ram(v, n, b, (sx * 0.43, 1.52, 7.2), e, (sx * 0.30, 1.98, 9.2), r=0.085)
    return v
