# ═══════════════════════════════════════════════════════════════
# BTR-80 armoured personnel carrier (8×8) with the BPU-1 turret: 14.5 mm KPVT and coaxial 7.62 mm PKT.
#   blender -b -P tools/vehicles/build.py -- btr80
# References: 7.65 × 2.90 × 2.41 m, 13.6 t, wheelbase 4.4 m, track 2.41 m, KI-80 13.00-18 tyres; photos of the
# BTR-80 at Kubinka (front 3/4 and side, public domain) and at the Parola tank museum (front, CC BY 2.0), Wikimedia
# Commons — reference only.
# Rig: turret (rot y, full circle), launcher (the KPVT/PKT mantlet, rot x −4° … +60°, + = up), muzzle_1 (KPVT),
# muzzle_2 (PKT), door_l / door_r (side doors between axles 2 and 3, swing forwards), hatch_l / hatch_r (driver's and
# commander's roof hatches), hatch_turret, 8 wheels (front two axles steer), exhaust, seat_driver, hatch_entry.
# ═══════════════════════════════════════════════════════════════
import math
from mathutils import Vector
import vkit
from vkit import Vehicle, Part, rot, lerp
import chassis
import redkit

AXLES = [1.75, 3.10, 4.80, 6.15]
R, TW = 0.53, 0.33
TRACK = 2.41
REAR = 7.65
ROOF = 2.03
LEDGE = 1.10            # wheel-well roof
CHINE = (1.46, 1.32)    # widest point (x, y)
EDGE = (1.0, ROOF)      # roof edge
TPIV = (0.0, ROOF, 2.30)


def section(z, scale=1.0):
    """the hexagonal upper-hull cross-section at z: ledge, chine, roof edge (both sides), as a ring"""
    lx = 0.96
    pts = [(-lx, LEDGE, z), (lx, LEDGE, z), (CHINE[0] * scale, LEDGE + 0.02, z), (CHINE[0] * scale, CHINE[1], z), (EDGE[0] * scale, EDGE[1], z),
           (-EDGE[0] * scale, EDGE[1], z), (-CHINE[0] * scale, CHINE[1], z), (-CHINE[0] * scale, LEDGE + 0.02, z)]
    return pts


def hull(b):
    # upper hull: a hexagonal prism from behind the windscreen plate to the rear plate
    prof = [(-0.96, LEDGE), (0.96, LEDGE), (CHINE[0], LEDGE + 0.02), (CHINE[0], CHINE[1]), (EDGE[0], ROOF), (-EDGE[0], ROOF), (-CHINE[0], CHINE[1]), (-CHINE[0], LEDGE + 0.02)]
    b.prism_z('paint', prof, 1.55, 7.22, cap0=False, cap1=False)
    # rear: the upper rear plate leans in; the lower rear slopes to the belly
    rr = [(x * 0.94, y + 0.0, 7.50) for (x, y) in [(-0.96, LEDGE), (0.96, LEDGE), (CHINE[0], LEDGE + 0.02), (CHINE[0], CHINE[1]), (EDGE[0], ROOF - 0.08), (-EDGE[0], ROOF - 0.08), (-CHINE[0], CHINE[1]), (-CHINE[0], LEDGE + 0.02)]]
    b.loft('paint', [[(x, y, 7.22) for (x, y) in prof], rr], smooth=False, cap1=True)
    # front: the windscreen plate rising from the upper glacis to the roof, and the bow wedge
    front_top = [(x * 0.97, y, 1.55) for (x, y) in prof]
    b.loft('paint', [[(x, y, 1.55) for (x, y) in prof], [(-0.9, LEDGE, 1.0), (0.9, LEDGE, 1.0), (1.3, LEDGE + 0.02, 1.0), (1.32, 1.26, 1.0), (1.02, 1.62, 1.0), (-1.02, 1.62, 1.0), (-1.32, 1.26, 1.0), (-1.3, LEDGE + 0.02, 1.0)]], smooth=False)
    nose = [(-0.72, 0.84, 0.02), (0.72, 0.84, 0.02), (1.02, 0.86, 0.04), (1.06, 0.95, 0.04), (0.82, 1.02, 0.06), (-0.82, 1.02, 0.06), (-1.06, 0.95, 0.04), (-1.02, 0.86, 0.04)]
    b.loft('paint', [[(-0.9, LEDGE, 1.0), (0.9, LEDGE, 1.0), (1.3, LEDGE + 0.02, 1.0), (1.32, 1.26, 1.0), (1.02, 1.62, 1.0), (-1.02, 1.62, 1.0), (-1.32, 1.26, 1.0), (-1.3, LEDGE + 0.02, 1.0)], nose], smooth=False, cap1=True)
    # lower hull (belly) between the wheel wells: vertical sides, a V bottom, the lower glacis wedge at the front
    belly = [(-0.72, 0.48), (0.72, 0.48), (0.96, 0.74), (0.96, LEDGE), (-0.96, LEDGE), (-0.96, 0.74)]
    b.prism_z('paint', belly, 1.0, 7.0, cap0=False, cap1=False)
    b.loft('paint', [[(x, y, 1.0) for (x, y) in belly], [(-0.72, 0.84, 0.02), (0.72, 0.84, 0.02), (0.9, 0.86, 0.02), (0.9, 0.86, 0.02), (-0.9, 0.86, 0.02), (-0.9, 0.86, 0.02)]], smooth=False)
    b.loft('paint', [[(x, y, 7.0) for (x, y) in belly], [(-0.6, 0.9, 7.52), (0.6, 0.9, 7.52), (0.8, 0.96, 7.52), (0.8, LEDGE, 7.52), (-0.8, LEDGE, 7.52), (-0.8, 0.96, 7.52)]], smooth=False, cap1=True)
    # side skirts between the wheel arches
    for sx in (-1, 1):
        redkit.arch_skirt(b, sx * (CHINE[0] - 0.03), 0.70, LEDGE + 0.02, 1.05, 7.2, [(z, R) for z in AXLES], 0.64, t=0.03, side=sx)


def front(b):
    # the driver's and commander's windows (armoured covers raised) on the windscreen plate
    a0, a1 = Vector((0, 1.62, 1.0)), Vector((0, ROOF, 1.55))
    n = Vector((0, (a1 - a0).z, -(a1 - a0).y)).normalized()
    for (xa, xb) in ((-0.92, -0.12), (0.12, 0.92)):
        pts = []
        for (u, v) in ((0, 0.18), (1, 0.18), (1, 0.84), (0, 0.84)):
            q = a0.lerp(a1, v)
            pts.append(Vector((lerp(xa, xb, u), q.y, q.z)))
        b.panel('glass', pts, n, off=0.006, frame=0.05, frame_skin='dark')
        # the raised armour cover: hinged at the top edge, standing up
        top = a0.lerp(a1, 0.95)
        b.box('paint', xa - 0.03, xb + 0.03, top.y, top.y + 0.04, top.z - 0.02, top.z + 0.48)
        b.cyl('dark', (xa, top.y + 0.02, top.z), (xb, top.y + 0.02, top.z), 0.025, 0.025, 6)
    # upper bow plate with the folded trim vane (ribbed) and the towing cable
    g0, g1 = Vector((0, 1.02, 0.06)), Vector((0, 1.62, 1.0))
    ng = Vector((0, (g1 - g0).z, -(g1 - g0).y)).normalized()
    pts = [Vector((-0.95, 0, 0)) + g0.lerp(g1, 0.1), Vector((0.95, 0, 0)) + g0.lerp(g1, 0.1), Vector((0.95, 0, 0)) + g0.lerp(g1, 0.85), Vector((-0.95, 0, 0)) + g0.lerp(g1, 0.85)]
    b.panel('paint', pts, ng, off=0.03, frame=0.02, frame_skin='paint')
    for i in range(6):
        x = lerp(-0.8, 0.8, i / 5)
        b.beam('paint', Vector((x, 0, 0)) + g0.lerp(g1, 0.14) + ng * 0.05, Vector((x, 0, 0)) + g0.lerp(g1, 0.8) + ng * 0.05, 0.03, 0.04, up=tuple(ng))
    cable = [Vector((-1.1, 0, 0)) + g0.lerp(g1, 0.92) + ng * 0.04, Vector((0, 0, 0)) + g0.lerp(g1, 0.95) + ng * 0.06, Vector((1.1, 0, 0)) + g0.lerp(g1, 0.92) + ng * 0.04]
    b.tube('dark', cable, 0.022, 5)
    for sx in (-1, 1):
        # headlight clusters on the front corners (guards), marker / blackout lights
        vkit.headlight(b, (sx * 1.18, 1.52, 0.98), (sx * 0.25, 0.1, -1), r=0.08, depth=0.08, skin_body='dark', lens='lens', guard=True)
        vkit.headlight(b, (sx * 1.2, 1.36, 1.02), (sx * 0.25, 0.1, -1), r=0.06, depth=0.06, skin_body='dark', lens='lens')
        vkit.lamp_box(b, (sx * 1.2, 1.24, 1.03), (0.07, 0.07, 0.05), (0, 0, -1), lens='lens_red', skin='dark')
        b.tube('paint', [(sx * 1.05, 1.28, 0.9), (sx * 1.3, 1.62, 1.05), (sx * 1.33, 1.6, 1.25)], 0.02, 5)
        # tow hooks
        b.box('dark', sx * 0.55 - 0.08, sx * 0.55 + 0.08, 0.72, 0.9, 0.06, 0.2)
        b.cyl('dark', (sx * 0.55 - 0.06, 0.8, 0.02), (sx * 0.55 + 0.06, 0.8, 0.02), 0.04, 0.04, 8)
        # rear-view mirrors on stalks
        vkit.mirror(b, (sx * 1.02, 1.68, 1.1), (sx * 1.32, 1.95, 1.0), (0.14, 0.2))


def sides(b):
    for sx in (-1, 1):
        a0 = Vector((sx * CHINE[0], CHINE[1], 0))
        a1 = Vector((sx * EDGE[0], EDGE[1], 0))
        n = Vector((sx * (EDGE[1] - CHINE[1]), CHINE[0] - EDGE[0], 0)).normalized()

        def on(z, v):
            return a0.lerp(a1, v) + Vector((0, 0, z))
        # firing ports (round ball mounts with hinged covers) along the sloped side
        for z in (2.45, 5.4, 6.1):
            c = on(z, 0.45)
            b.cyl('paint', c - n * 0.01, c + n * 0.035, 0.09, 0.08, 10)
            b.box('dark', c.x - 0.02, c.x + 0.02, c.y + 0.02, c.y + 0.13, z - 0.03, z + 0.03)
        # vision blocks near the roof edge
        for z in (1.85, 2.7, 3.2, 5.2, 5.9, 6.6):
            redkit.vision_block(b, on(z, 0.88), n, w=0.16, h=0.06, d=0.06)
        # the side door opening frame (the doors are their own nodes)
        for (p0, p1) in ((on(3.42, 0.08), on(3.42, 0.8)), (on(4.46, 0.08), on(4.46, 0.8)), (on(3.42, 0.8), on(4.46, 0.8))):
            b.beam('dark', p0 + n * 0.005, p1 + n * 0.005, 0.03, 0.01, up=tuple(n))
        # lower door leaf (the step) below it, on the chine face
        b.box('paint', sx * (CHINE[0] - 0.02), sx * (CHINE[0] + 0.02), LEDGE + 0.04, CHINE[1] - 0.02, 3.45, 4.43)
        # grab handles and a stowage rail
        for z in (1.4, 6.9):
            vkit.grab_handle(b, on(z, 0.6) + n * 0.01, (0, 0, 1), tuple(n), 0.3, 0.05, 'dark')
        b.beam('dark', on(4.9, 0.3) + n * 0.03, on(6.95, 0.3) + n * 0.03, 0.03, 0.03)
        # tow cable clipped along the sloped side
        b.tube('dark', [on(1.3, 0.22) + n * 0.03, on(3.2, 0.2) + n * 0.035, on(4.7, 0.2) + n * 0.035, on(7.0, 0.22) + n * 0.03], 0.02, 5)
        # step below the door
        b.box('dark', sx * (CHINE[0] - 0.05), sx * (CHINE[0] + 0.05), 0.74, 0.78, 3.6, 4.3)
        # the wheel-arch rims
        for z in AXLES:
            b.box('paint', sx * (CHINE[0] - 0.02), sx * (CHINE[0] + 0.03), LEDGE - 0.02, LEDGE + 0.02, z - 0.62, z + 0.62)


def roof(b):
    # engine deck grilles at the rear, air intakes, the exhaust box on the right side
    for sx in (-1, 1):
        b.panel('mesh', [(sx * 0.12, ROOF, 5.6), (sx * 0.95, ROOF, 5.6), (sx * 0.95, ROOF, 7.0), (sx * 0.12, ROOF, 7.0)], (0, 1, 0), off=0.004, frame=0.04, frame_skin='dark')
    # the rounded stowage box / exhaust cowling on the rear right
    b.loft('paint', [rrect_z(0.72, ROOF, 5.3, 0.62, 0.3), rrect_z(0.72, ROOF, 7.05, 0.62, 0.3)], smooth=True, cap0=True, cap1=True)
    # roof hatches over the troop compartment
    for sx in (-1, 1):
        b.panel('paint', [(sx * 0.2, ROOF, 3.4), (sx * 0.85, ROOF, 3.4), (sx * 0.85, ROOF, 4.3), (sx * 0.2, ROOF, 4.3)], (0, 1, 0), off=0.02, frame=0.03, frame_skin='dark')
        vkit.grab_handle(b, (sx * 0.5, ROOF + 0.02, 3.85), (1, 0, 0), (0, 1, 0), 0.2, 0.03, 'dark')
    # frames of the driver's and commander's hatches (lids are nodes)
    for sx in (-1, 1):
        b.panel('dark', [(sx * 0.18, ROOF, 1.6), (sx * 0.78, ROOF, 1.6), (sx * 0.78, ROOF, 2.1), (sx * 0.18, ROOF, 2.1)], (0, 1, 0), off=0.004)
    # turret ring
    b.cyl('dark', (0, ROOF, TPIV[2]), (0, ROOF + 0.03, TPIV[2]), 0.74, 0.74, 24)
    # rear: lights, the water-jet cover, tow hooks
    for sx in (-1, 1):
        vkit.lamp_box(b, (sx * 0.95, 1.7, 7.47), (0.12, 0.09, 0.05), (0, 0, 1), lens='lens_red')
        b.cyl('dark', (sx * 0.5, 0.95, 7.45), (sx * 0.5, 0.95, 7.6), 0.05, 0.05, 8)
    b.cyl('paint', (0, 1.32, 7.43), (0, 1.32, 7.49), 0.24, 0.24, 16)
    b.cyl('dark', (0, 1.32, 7.49), (0, 1.32, 7.52), 0.05, 0.05, 8)
    vkit.whip_antenna(b, (-0.95, ROOF, 6.8), h=2.2)


def rrect_z(cx, y0, z, w, h, n=3):
    """a ring for a rounded box lying on the roof (x across, y up), flat bottom at y0"""
    pts = [(cx - w / 2, y0, z), (cx + w / 2, y0, z)]
    r = h * 0.9
    for i in range(n + 1):
        a = 0 + (math.pi / 2) * i / n
        pts.append((cx + w / 2 - r + r * math.cos(a), y0 + h - r + r * math.sin(a), z))
    for i in range(n + 1):
        a = math.pi / 2 + (math.pi / 2) * i / n
        pts.append((cx - w / 2 + r + r * math.cos(a), y0 + h - r + r * math.sin(a), z))
    return pts


def doors(v):
    out = []
    for sx, n in ((-1, 'door_l'), (1, 'door_r')):
        a0 = Vector((sx * CHINE[0], CHINE[1], 0))
        a1 = Vector((sx * EDGE[0], EDGE[1], 0))
        nn = Vector((sx * (EDGE[1] - CHINE[1]), CHINE[0] - EDGE[0], 0)).normalized()
        hinge = a0.lerp(a1, 0.45) + Vector((0, 0, 3.44)) + nn * 0.02
        d = Part(v, n, pivot=tuple(hinge), joint=rot('-y' if sx < 0 else 'y', 0.0, math.radians(100), group='door'))
        pts = [a0.lerp(a1, 0.1) + Vector((0, 0, 3.45)), a0.lerp(a1, 0.1) + Vector((0, 0, 4.43)), a0.lerp(a1, 0.78) + Vector((0, 0, 4.43)), a0.lerp(a1, 0.78) + Vector((0, 0, 3.45))]
        P = [p + nn * 0.015 for p in pts]
        Q = [p + nn * 0.05 for p in pts]
        d.face([tuple(q) for q in Q], 'paint', want=tuple(nn))
        d.face([tuple(p) for p in reversed(P)], 'paint', want=tuple(-nn))
        for i in range(4):
            j = (i + 1) % 4
            mid = (P[i] + P[j]) / 2 - sum(P, Vector()) / 4
            d.face([tuple(P[i]), tuple(P[j]), tuple(Q[j]), tuple(Q[i])], 'paint', want=tuple(mid))
        c = sum(Q, Vector()) / 4
        redkit.vision_block(d, c + nn * 0.005 + Vector((0, 0.12, 0)), nn, w=0.14, h=0.06, d=0.04)
        vkit.grab_handle(d, c - Vector((0, 0.12, -0.3)) + nn * 0.005, (0, 0, 1), tuple(nn), 0.16, 0.03, 'dark')
        out.append(d)
    return out


def hatches(v):
    for sx, n in ((-1, 'hatch_l'), (1, 'hatch_r')):
        h = Part(v, n, pivot=(sx * 0.48, ROOF + 0.02, 2.1), joint=rot('x', 0.0, math.radians(95), group='hatch'))   # hinged at the rear edge
        h.box('paint', sx * 0.2, sx * 0.76, ROOF, ROOF + 0.05, 1.62, 2.1, bev=0.012)
        h.cyl('dark', (sx * 0.24, ROOF + 0.025, 2.1), (sx * 0.72, ROOF + 0.025, 2.1), 0.022, 0.022, 6)
        redkit.vision_block(h, (sx * 0.48, ROOF + 0.09, 1.66), (0, 0.2, -1), w=0.18, h=0.06, d=0.07)


def turret(v):
    t = Part(v, 'turret', pivot=TPIV, joint=rot('y', -math.pi, math.pi, stow=0.0, deploy=0.0, group='turret'))
    x, y, z = TPIV
    # BPU-1: a truncated cone with a flattened front for the gun mantlet
    t.lathe((x, y + 0.02, z), (0, 1, 0), [(0.0, 0.72, 'paint'), (0.05, 0.72, 'paint'), (0.36, 0.5, 'paint'), (0.38, 0.44, 'paint'), (0.38, 0.0001, 'paint')], n=20, smooth=False)
    # mantlet housing (the gun ports) at the front
    t.box('paint', -0.32, 0.26, y + 0.1, y + 0.36, z - 0.72, z - 0.4, bev=0.02)
    # sight periscope (1PZ-2) front left, searchlight right, the hatch, vision blocks
    t.box('paint', -0.48, -0.3, y + 0.3, y + 0.52, z - 0.36, z - 0.12, bev=0.02)
    t.panel('glass', [(-0.46, y + 0.38, z - 0.361), (-0.32, y + 0.38, z - 0.361), (-0.32, y + 0.47, z - 0.361), (-0.46, y + 0.47, z - 0.361)], (0, 0, -1), off=0.003)
    t.cyl('dark', (0.42, y + 0.36, z - 0.05), (0.42, y + 0.56, z - 0.05), 0.03, 0.03, 6)
    vkit.headlight(t, (0.42, y + 0.64, z - 0.12), (0, 0, -1), r=0.12, depth=0.16, skin_body='dark', lens='lens')
    t.cyl('paint', (0.05, y + 0.39, z + 0.1), (0.05, y + 0.43, z + 0.1), 0.26, 0.26, 16)
    t.box('dark', -0.2, 0.3, y + 0.43, y + 0.46, z + 0.06, z + 0.14)
    for a in (-60, 60, 150, 210):
        ang = math.radians(a)
        c = Vector((x + math.sin(ang) * 0.55, y + 0.24, z - math.cos(ang) * 0.55))
        redkit.vision_block(t, c, (math.sin(ang), 0.5, -math.cos(ang)), w=0.12, h=0.05, d=0.05)
    # six 902V smoke-grenade launchers on the rear of the turret, three a side, fanned
    for sx in (-1, 1):
        redkit.smoke_dischargers(t, (sx * 0.42, y + 0.33, z + 0.5), (sx * 0.8, 0, 0.6), n=3, spacing=0.12, r=0.04, length=0.22)
    # antenna
    vkit.whip_antenna(t, (-0.4, y + 0.3, z + 0.35), h=1.8, base_r=0.03)
    return t


def gun(v, t):
    x, y, z = TPIV
    piv = (0.0, y + 0.24, z - 0.6)
    g = Part(v, 'launcher', pivot=piv, parent=t, joint=rot('x', math.radians(-4), math.radians(60), stow=0.0, deploy=0.0, group='launcher'))
    gy, gz = piv[1], piv[2]
    # KPVT 14.5 mm: the barrel jacket and barrel with its conical flash hider
    g.cyl('paint', (0.06, gy, gz - 0.02), (0.06, gy, gz - 0.2), 0.08, 0.08, 12)
    g.cyl('dark', (0.06, gy, gz - 0.2), (0.06, gy, gz - 1.28), 0.032, 0.026, 10)
    g.cyl('dark', (0.06, gy, gz - 1.28), (0.06, gy, gz - 1.4), 0.04, 0.03, 10)
    g.empty('muzzle_1', (0.06, gy, gz - 1.41), (0, 0, -1))
    # PKT 7.62 mm coaxial, to the left
    g.cyl('dark', (-0.16, gy - 0.02, gz - 0.05), (-0.16, gy - 0.02, gz - 0.58), 0.02, 0.018, 8)
    g.empty('muzzle_2', (-0.16, gy - 0.02, gz - 0.6), (0, 0, -1))
    # mantlet face
    g.box('paint', -0.24, 0.2, gy - 0.12, gy + 0.12, gz - 0.06, gz + 0.02, bev=0.015)
    return g


def make():
    vkit.setup_materials('red_green')
    v = Vehicle('btr80', 'BTR-80 armoured personnel carrier', scheme='red_green')
    b = Part(v, 'body')
    hull(b)
    front(b)
    sides(b)
    roof(b)
    chassis.wheels(v, None, AXLES, TRACK, R, TW, 0.25, steer={0: 1.0, 1: 0.6}, lugs=16, seg=24, nbolts=8, cti=True,
                   hub_skin='olive', rim_skin='olive')
    doors(v)
    hatches(v)
    t = turret(v)
    gun(v, t)
    h = Part(v, 'hatch_turret', pivot=(0.05 - 0.26, ROOF + 0.43, TPIV[2] + 0.1), parent=t, joint=rot('z', 0.0, math.radians(100), group='hatch'))
    h.cyl('paint', (0.05, ROOF + 0.43, TPIV[2] + 0.1), (0.05, ROOF + 0.48, TPIV[2] + 0.1), 0.24, 0.24, 16)
    b.empty('exhaust', (0.72, ROOF + 0.3, 7.08), (0, 0.3, 1))
    b.empty('seat_driver', (-0.48, 1.55, 1.75), (0, 0, -1))
    b.empty('hatch_entry', (-1.75, 0.0, 3.95), (1, 0, 0))
    return v
