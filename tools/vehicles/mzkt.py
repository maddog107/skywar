# ═══════════════════════════════════════════════════════════════
# MZKT-7930 "Astrolog" 8×8 chassis (Blender, with vkit): the forward-control cab, engine housing behind it,
# frame, running gear. z = distance aft of the bumper face (vkit recentres the vehicle), x right, y up.
# MZKT-7930: 12.67 × 3.07 m, cab roof 3.02 m, 1500×600-635 tyres, ground clearance 0.4 m. Axles in two pairs:
# 1.9 m apart front and rear, 3.2 m between the pairs (measured from side photos of the K-340P).
# ═══════════════════════════════════════════════════════════════
import math
from mathutils import Vector
import vkit
from vkit import Part, lerp
import chassis

MZKT = {
    'axles': [1.95, 3.85, 7.05, 8.95],
    'track': 2.40,
    'R': 0.76, 'W': 0.60, 'rim': 0.36,
    'width': 3.07,
    'cab_front': 0.30, 'cab_rear': 2.55, 'cab_roof': 3.02,
}


def cab(b):
    """the full-width fibreglass cab-over cab with three windscreen panes"""
    zf, zr, yt = MZKT['cab_front'], MZKT['cab_rear'], MZKT['cab_roof']
    hw = 1.46
    yb = 1.02                                   # cab floor line (above the bumper top)
    ya = 1.66                                   # top of the front wheel arch
    yw0, yw1 = 1.92, 2.78                       # windscreen band
    z_arch = MZKT['axles'][0] - MZKT['R'] - 0.08
    # upper cab (above the wheel arch), side profile (z, y): nearly vertical front with a slight rake, rounded roof
    prof = [(zf, ya), (zf, yw0), (zf + 0.10, yw1), (zf + 0.20, yt - 0.03), (zf + 0.32, yt), (zr - 0.12, yt), (zr, yt - 0.10), (zr, ya)]
    b.prism_x('paint', prof, -hw, hw)
    # lower cab: full width ahead of the front wheels, narrower between them
    b.box('paint', -hw, hw, yb, ya, zf, z_arch, skip=('top',))
    b.box('paint', -0.84, 0.84, yb, ya, z_arch, zr, skip=('top',))
    for sx in (-1, 1):
        # arch lining (dark) and a mud flap behind the front wheel
        b.face([(sx * 0.84, ya, z_arch), (sx * hw, ya, z_arch), (sx * hw, ya, zr), (sx * 0.84, ya, zr)], 'dark', want=(0, -1, 0))
        b.box('rubber', sx * 0.92, sx * 1.44, 0.6, ya, zr + 0.02, zr + 0.05)
    # chamfer strips on the vertical front corners (a rounded look)
    for sx in (-1, 1):
        x = sx * hw
        b.face([(x, yb, zf), (x - sx * 0.10, yb, zf - 0.001), (x - sx * 0.10, yw0, zf - 0.001), (x, yw0, zf)], 'paint', want=(sx * 0.5, 0, -1))
    # front face: three framed windscreen panes on the raked band
    def fp(u, v):
        """point on the windscreen band: u across (-1..1), v up (0..1)"""
        return Vector((u * hw, lerp(yw0, yw1, v), lerp(zf, zf + 0.10, v)))
    n = (Vector((0, yw1 - yw0, -0.10))).cross(Vector((1, 0, 0))).normalized()
    if n.z > 0:
        n = -n
    edges = [-0.95, -0.335, 0.335, 0.95]
    for i in range(3):
        u0, u1 = edges[i] + 0.02, edges[i + 1] - 0.02
        b.panel('glass', [fp(u0, 0.06), fp(u1, 0.06), fp(u1, 0.94), fp(u0, 0.94)], n, off=0.008, frame=0.045, frame_skin='black')
        # wiper hanging from the top rail
        top = fp((u0 + u1) / 2 - 0.05, 0.97) + n * 0.03
        b.beam('black', top, fp((u0 + u1) / 2 + 0.12, 0.35) + n * 0.03, 0.014, 0.01)
        b.cyl('black', top, top + n * 0.04, 0.02, 0.02, 6)
    # grab handles over the windscreen, sun-visor rail
    for u in (-0.55, 0.0, 0.55):
        vkit.grab_handle(b, fp(u, 1.1) + n * 0.01, (1, 0, 0), n, 0.26, 0.04, 'dark')
    # front panel below the windscreen: louvred grille and hatch outlines
    gy0, gy1 = 1.20, 1.66
    b.panel('dark', [(-0.62, gy0, zf), (0.62, gy0, zf), (0.62, gy1, zf), (-0.62, gy1, zf)], (0, 0, -1), off=0.004)
    for k in range(7):
        y = lerp(gy0 + 0.05, gy1 - 0.05, k / 6)
        b.box('black', -0.55, 0.55, y - 0.018, y + 0.018, zf - 0.02, zf - 0.004)
    for sx in (-1, 1):
        b.panel('black', [(sx * 0.66, 1.12, zf), (sx * 1.35, 1.12, zf), (sx * 1.35, 1.14, zf), (sx * 0.66, 1.14, zf)], (0, 0, -1), off=0.004)
    # side windows and doors (both sides), steps down past the front wheel
    for sx in (-1, 1):
        x = sx * hw
        b.panel('glass', [(x, 2.02, 0.55), (x, 2.02, 1.10), (x, 2.72, 1.10), (x, 2.72, 0.55)], (sx, 0, 0), off=0.008, frame=0.04, frame_skin='black')
        # door (behind the front corner window): window, outline, handle, hinges
        dz0, dz1 = 1.28, 2.12
        b.panel('glass', [(x, 2.05, dz0 + 0.1), (x, 2.05, dz1 - 0.1), (x, 2.72, dz1 - 0.1), (x, 2.72, dz0 + 0.1)], (sx, 0, 0), off=0.008, frame=0.04, frame_skin='black')
        for (p0, p1) in (((x, 1.70, dz0), (x, 2.86, dz0)), ((x, 1.70, dz1), (x, 2.86, dz1)), ((x, 2.86, dz0), (x, 2.86, dz1)), ((x, 1.70, dz0), (x, 1.70, dz1))):
            P0, P1 = Vector(p0), Vector(p1)
            w = Vector((0, 0.012, 0)) if abs((P1 - P0).y) < 0.1 else Vector((0, 0, 0.012))
            b.panel('black', [P0 - w, P1 - w, P1 + w, P0 + w], (sx, 0, 0), off=0.003)
        vkit.grab_handle(b, (x + sx * 0.01, 1.9, dz1 - 0.12), (0, 0, 1), (sx, 0, 0), 0.16, 0.035, 'dark')
        vkit.grab_handle(b, (x + sx * 0.01, 2.2, dz0 - 0.08), (0, 1, 0), (sx, 0, 0), 0.6, 0.05, 'dark')
        # rear quarter window
        b.panel('glass', [(x, 2.10, 2.18), (x, 2.10, 2.42), (x, 2.62, 2.42), (x, 2.62, 2.18)], (sx, 0, 0), off=0.008, frame=0.03, frame_skin='black')
        # boarding steps below the cab, ahead of the front wheel
        za = MZKT['axles'][0] - MZKT['R'] - 0.12
        for k, y in enumerate((0.55, 0.82, 1.1)):
            b.box('dark', x - sx * 0.02, x - sx * 0.40, y - 0.03, y, za - 0.42, za)
        b.beam('dark', (x - sx * 0.05, 0.52, za - 0.40), (x - sx * 0.05, 1.05, za - 0.40), 0.03, 0.03)
        b.beam('dark', (x - sx * 0.05, 0.52, za - 0.02), (x - sx * 0.05, 1.05, za - 0.02), 0.03, 0.03)
        # mirrors: two heads on a long bent tube arm, reaching forward and out
        base = Vector((x - sx * 0.02, 2.45, zf + 0.25))
        head = Vector((x + sx * 0.36, 2.35, zf - 0.02))
        b.tube('black', [base, base + Vector((sx * 0.2, 0.0, -0.08)), head + Vector((0, 0.32, 0)), head - Vector((0, 0.32, 0)), base + Vector((0, -0.5, 0))], 0.014, 5)
        for dy in (0.17, -0.17):
            c = head + Vector((0, dy, 0))
            b.box('black', c.x - 0.09, c.x + 0.09, c.y - 0.15, c.y + 0.15, c.z - 0.02, c.z + 0.03, bev=0.02)
            b.panel('glass', [(c.x - 0.075, c.y - 0.13, c.z + 0.031), (c.x + 0.075, c.y - 0.13, c.z + 0.031), (c.x + 0.075, c.y + 0.13, c.z + 0.031), (c.x - 0.075, c.y + 0.13, c.z + 0.031)], (0, 0, 1), off=0.002)
    # roof: searchlight, marker lamps, antenna base
    for sx in (-1, 1):
        vkit.lamp_box(b, (sx * 1.1, yt + 0.035, zf + 0.35), (0.12, 0.07, 0.07), (0, 0, -1), lens='lens_amber')
    b.cyl('dark', (0.9, yt, 0.9), (0.9, yt + 0.25, 0.9), 0.03, 0.03, 6)
    b.cyl('dark', (0.9, yt + 0.25, 0.95), (0.9, yt + 0.25, 0.78), 0.12, 0.11, 12)
    b.disc('lens', (0.9, yt + 0.25, 0.775), (0, 0, -1), 0.1, 12)
    vkit.whip_antenna(b, (-1.2, yt, 2.3), h=2.2)


def front(b):
    """black bumper with lamps, tow cable loop and shackles; skid plate"""
    zf = MZKT['cab_front']
    b.box('black', -1.50, 1.50, 0.62, 1.05, 0.0, zf + 0.05, bev=0.03)
    for sx in (-1, 1):
        # round headlight with visor, fog lamp, red marker
        vkit.headlight(b, (sx * 1.18, 0.90, -0.01), (0, 0, -1), r=0.085, depth=0.05, skin_body='black', lens='lens')
        b.box('black', sx * 1.18 - 0.1, sx * 1.18 + 0.1, 0.99, 1.01, -0.10, 0.0)
        vkit.lamp_box(b, (sx * 1.18, 0.72, 0.0), (0.2, 0.08, 0.05), (0, 0, -1), lens='lens')
        vkit.headlight(b, (sx * 1.40, 0.98, -0.005), (0, 0, -1), r=0.045, depth=0.03, skin_body='black', lens='lens_red')
    # the tow cable loop across the bumper and its shackles
    loop = [(-0.75, 0.88, -0.03), (-0.2, 0.9, -0.05), (0.55, 0.9, -0.05), (0.78, 0.83, -0.05), (0.55, 0.76, -0.05), (-0.55, 0.76, -0.05), (-0.78, 0.83, -0.04)]
    b.tube('steel', loop, 0.022, 6)
    b.box('dark', -0.08, 0.08, 0.70, 0.95, -0.12, 0.0)
    b.cyl('dark', (0.72, 0.9, -0.08), (0.9, 0.9, -0.08), 0.045, 0.045, 8)
    # skid plate below
    b.face([(-1.2, 0.62, 0.02), (1.2, 0.62, 0.02), (1.0, 0.42, 0.9), (-1.0, 0.42, 0.9)], 'dark', want=(0, -1, -0.5))


def frame(b, z0, z1):
    R = MZKT['R']
    for sx in (-1, 1):
        b.box('dark', sx * 0.42, sx * 0.58, 0.72, 1.08, z0, z1)
    for z in [z0 + 0.1] + [a for a in MZKT['axles']] + [z1 - 0.1]:
        b.box('dark', -0.42, 0.42, 0.8, 1.0, z - 0.06, z + 0.06)
    b.face([(-0.95, 0.72, z0), (0.95, 0.72, z0), (0.95, 0.72, z1), (-0.95, 0.72, z1)], 'dark', want=(0, -1, 0))
    for z in MZKT['axles']:
        b.box('dark', -0.28, 0.28, 0.42, 0.8, z - 0.26, z + 0.26, bev=0.04)
        for sx in (-1, 1):
            b.cyl('dark', (sx * 0.28, R, z), (sx * 0.95, R, z), 0.06, 0.06, 8)
            b.beam('dark', (sx * 0.45, 0.95, z - 0.35), (sx * 0.9, R + 0.1, z - 0.05), 0.08, 0.06)
            b.beam('dark', (sx * 0.45, 0.45, z - 0.35), (sx * 0.9, R - 0.12, z - 0.05), 0.08, 0.06)
            b.cyl('dark', (sx * 0.74, R - 0.2, z), (sx * 0.74, R + 0.22, z), 0.11, 0.11, 10)


def engine_house(b, z0, z1):
    """the engine housing behind the cab: taller, sloped front, louvres, exhaust"""
    hw = 1.40
    prof = [(z0, 1.02), (z0, 2.9), (z0 + 0.45, 3.33), (z1, 3.33), (z1, 1.02)]
    b.prism_x('paint', prof, -hw, hw)
    for sx in (-1, 1):
        vkit.louvres(b, sx * hw, 2.2, 3.0, z0 + 0.6, z1 - 0.25, 8, side=sx)
        vkit.louvres(b, sx * hw, 1.25, 1.95, z0 + 0.6, z1 - 0.25, 7, side=sx)
    b.panel('mesh', [(-1.0, 3.33, z0 + 0.6), (1.0, 3.33, z0 + 0.6), (1.0, 3.33, z1 - 0.15), (-1.0, 3.33, z1 - 0.15)], (0, 1, 0), off=0.004)
    # exhaust stack behind the housing (right side)
    b.cyl('dark', (1.2, 2.8, z1 + 0.12), (1.2, 3.55, z1 + 0.12), 0.08, 0.08, 10)
    b.cyl('soot', (1.2, 3.55, z1 + 0.12), (1.2, 3.58, z1 + 0.12), 0.085, 0.085, 10)
    b.empty('exhaust', (1.2, 3.58, z1 + 0.12), (0, 1, 0))


def build(v, b, z_end):
    cab(b)
    front(b)
    frame(b, 0.35, z_end)
    chassis.wheels(v, None, MZKT['axles'], MZKT['track'], MZKT['R'], MZKT['W'], MZKT['rim'], steer={0: 1.0, 1: 0.6}, lugs=18, seg=24, nbolts=10, rim_skin='dark', hub_skin='dark')
    b.empty('seat_driver', (-0.8, 1.95, 1.2), (0, 0, -1))
    b.empty('hatch_entry', (-1.9, 0.0, 1.6), (1, 0, 0))
