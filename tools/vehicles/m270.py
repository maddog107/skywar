# ═══════════════════════════════════════════════════════════════
# M270A1 Multiple Launch Rocket System: M993 carrier (a lengthened Bradley chassis) with the M269
# launcher-loader module and two six-rocket pods.
#   blender -b -P tools/vehicles/build.py -- m270
# References: 6.97 m long, 2.97 m wide, 2.59 m high stowed; 170.5 in (4.33 m) of track on the ground,
# 6 dual road wheels a side, front drive sprocket, rear idler, T157-type 21 in (0.53 m) track; the LLM
# traverses and lifts the cage (pivot at its rear) to 60°, the pods' front ends (tube covers) face forwards when
# stowed. Photos: US Army / South Dakota ANG, Danish, Finnish and German (MARS) M270s on Wikimedia Commons.
# Rig: turret (LLM traverse, rot y), launcher (cage elevation, rot x about its rear pivot, 0→60°),
# muzzle_1..12 (pod tube exits: left pod 1-6, right pod 7-12, top row first), ram_l / ram_r (elevation rams),
# door_l / door_r (cab doors), hatch_roof, wheel_<n><l|r> road wheels + sprocket_<l|r> / idler_<l|r> (roll),
# track_l / track_r (scrolling), exhaust, seat_driver, hatch_entry.
# ═══════════════════════════════════════════════════════════════
import math
from mathutils import Vector
import vkit
from vkit import Vehicle, Part, rot, lerp
import blue

W2 = 1.485                  # half width
TRK_X, TRK_W, TRK_T = 1.205, 0.533, 0.065
RW_R = 0.305
RW_Y = RW_R + TRK_T         # road wheels sit so the track's bottom is on y = 0
RW_Z = [1.05, 1.91, 2.77, 3.63, 4.49, 5.35]
SPROCKET = (0.46, 0.72, 0.28)
IDLER = (6.24, 0.62, 0.285)
DECK = 1.35
TURRET = (0.0, DECK, 4.55)
CAGE_PIVOT = (0.0, 1.50, 6.88)
CAGE_Z0, CAGE_Z1 = 2.66, 6.97
POD_Y0, POD_Y1 = 1.62, 2.44


def running_gear(v):
    rw_proto = None
    for side in (1, -1):        # right first: the right wheels hold the shared mesh (outer face +x)
        x = side * TRK_X
        sd = 'l' if side < 0 else 'r'
        for i, z in enumerate(RW_Z):
            name = 'wheel_%d%s' % (i + 1, sd)
            if rw_proto is None:
                rw_proto = Part(v, name, pivot=(x, RW_Y, z), local=True)
                blue.road_wheel(rw_proto, RW_R, 0.44, gap=0.1)
            else:
                Part(v, name, pivot=(x, RW_Y, z), local=True, rest_yaw=0.0 if side > 0 else math.pi, share=rw_proto)
            v.meta['wheels'].append({'node': name, 'r': RW_R, 'steer': 0, 'side': side})
    sp = None
    for side in (1, -1):
        sd = 'l' if side < 0 else 'r'
        z, y, r = SPROCKET
        name = 'sprocket_' + sd
        if sp is None:
            sp = Part(v, name, pivot=(side * TRK_X, y, z), local=True)
            blue.sprocket(sp, r + 0.03, 0.44, teeth=11, gap=0.1)
        else:
            Part(v, name, pivot=(side * TRK_X, y, z), local=True, rest_yaw=0.0 if side > 0 else math.pi, share=sp)
        v.meta['wheels'].append({'node': name, 'r': r + 0.02, 'steer': 0, 'side': side})
    idp = None
    for side in (1, -1):
        sd = 'l' if side < 0 else 'r'
        z, y, r = IDLER
        name = 'idler_' + sd
        if idp is None:
            idp = Part(v, name, pivot=(side * TRK_X, y, z), local=True)
            blue.idler(idp, r, 0.44, gap=0.1)
        else:
            Part(v, name, pivot=(side * TRK_X, y, z), local=True, rest_yaw=0.0 if side > 0 else math.pi, share=idp)
        v.meta['wheels'].append({'node': name, 'r': r, 'steer': 0, 'side': side})
    # tracks: loop from the idler along the ground run to the sprocket and back over the top
    circles = [IDLER] + [(z, RW_Y, RW_R) for z in reversed(RW_Z)] + [SPROCKET]
    for side in (-1, 1):
        vkit.track_run(v, side, side * TRK_X, TRK_W, circles, thick=TRK_T, tile=0.68)


def return_rollers(b):
    """three support rollers touching the underside of the top run (static, on the hull)"""
    (z0, y0, r0), (z1, y1, r1) = SPROCKET, IDLER
    for z in (1.95, 3.55, 5.05):
        t = (z - z0) / (z1 - z0)
        top = lerp(y0 + r0, y1 + r1, t) + 0.004
        rr = 0.095
        for side in (-1, 1):
            x = side * TRK_X
            b.cyl('rubber', (x - 0.2, top - rr, z), (x + 0.2, top - rr, z), rr, rr, 12)
            b.cyl('dark', (x - side * 0.2, top - rr, z), (side * 0.93, top - rr, z), 0.035, 0.035, 6)   # stub axle


def hull(v, b):
    # lower hull between the tracks: glacis, belly, rear slope
    prof = [(0.02, 1.02), (0.45, 0.42), (6.38, 0.42), (6.62, 0.66), (6.62, 1.02)]
    b.prism_x('paint', prof, -0.93, 0.93)
    # upper hull: centre deck and the sponsons over the tracks
    b.box('paint', -0.93, 0.93, 1.02, DECK, 0.0, 6.62)
    for sx in (-1, 1):
        b.box('paint', sx * 0.93, sx * W2, 1.10, DECK, 0.0, 6.62, bev=0.015)
        # sponson underside lip and a rubbing strip along the side
        b.box('dark', sx * (W2 - 0.005), sx * (W2 + 0.01), 1.16, 1.2, 0.3, 6.4)
        # front and rear mud flaps
        b.box('rubber', sx * 0.96, sx * 1.46, 0.60, 1.10, -0.02, 0.0)
        b.box('rubber', sx * 0.96, sx * 1.46, 0.34, 1.10, 6.62, 6.64)
        # track tension housing near the idler, hull side detail
        b.cyl('dark', (sx * 0.93, IDLER[1] + 0.02, IDLER[0] - 0.02), (sx * 0.98, IDLER[1] + 0.02, IDLER[0] - 0.02), 0.12, 0.12, 10)
        b.cyl('dark', (sx * 0.93, SPROCKET[1], SPROCKET[0]), (sx * 0.98, SPROCKET[1], SPROCKET[0]), 0.2, 0.2, 12)
        # suspension arm bosses on the hull side for each road wheel
        for z in RW_Z:
            b.cyl('dark', (sx * 0.93, RW_Y + 0.05, z + 0.18), (sx * 0.99, RW_Y + 0.05, z + 0.18), 0.09, 0.09, 8)
            b.beam('dark', (sx * 0.97, RW_Y + 0.05, z + 0.18), (sx * 0.97, RW_Y, z), 0.07, 0.06)
    return_rollers(b)
    # tow hooks and towing eyes, front and rear
    for sx in (-1, 1):
        b.box('dark', sx * 0.52, sx * 0.68, 0.74, 0.92, -0.04, 0.12)
        b.tube('dark', [(sx * 0.6, 0.78, -0.06), (sx * 0.6, 0.70, -0.12), (sx * 0.6, 0.62, -0.06)], 0.025, 6)
        b.box('dark', sx * 0.52, sx * 0.68, 0.72, 0.88, 6.56, 6.70)
        blue.tail_cluster(b, (sx * 1.18, 1.20, 6.64), (0, 0, 1), side=sx)
    b.box('dark', -0.1, 0.1, 0.70, 0.86, 6.62, 6.78)          # pintle
    b.panel('white', [(-0.3, 1.08, 6.625), (0.3, 1.08, 6.625), (0.3, 1.24, 6.625), (-0.3, 1.24, 6.625)], (0, 0, 1), off=0.003)
    # LLM turret ring (fixed part)
    b.cyl('dark', (0, DECK, TURRET[2]), (0, DECK + 0.03, TURRET[2]), 1.0, 1.0, 24)
    # engine exhaust grille on the right front of the hull (the engine sits under the cab, right side)
    b.panel('vents', [(W2, 1.14, 1.0), (W2, 1.14, 1.6), (W2, 1.32, 1.6), (W2, 1.32, 1.0)], (1, 0, 0), off=0.004)
    b.empty('exhaust', (W2 + 0.02, 1.23, 1.3), (1, 0, 0))


def cab(v, b):
    def ring(y, zf, zr, x):
        return [(-x, y, zf), (x, y, zf), (x, y, zr), (-x, y, zr)]
    r0 = ring(DECK, 0.02, 2.10, 1.45)
    r1 = ring(1.88, 0.02, 2.10, 1.43)
    r2 = ring(2.42, 0.55, 2.10, 1.37)
    r3 = ring(2.52, 0.64, 2.02, 1.33)
    b.loft('paint', [r0, r1, r2, r3], smooth=False)
    b.face(r3, 'paint', want=(0, 1, 0))

    def on(ra, rb, i, u, w):
        A0, A1 = Vector(ra[i]), Vector(ra[(i + 1) % 4])
        B0, B1 = Vector(rb[i]), Vector(rb[(i + 1) % 4])
        return lerp(lerp(A0, A1, u), lerp(B0, B1, u), w)

    def nrm(ra, rb, i):
        A0, A1, B0 = Vector(ra[i]), Vector(ra[(i + 1) % 4]), Vector(rb[i])
        n = (A1 - A0).cross(B0 - A0).normalized()
        c = sum((Vector(p) for p in ra), Vector()) / 4
        return n if n.dot(A0 - c) > 0 else -n
    # three armoured louvre shutters over the windscreens (sloped front, edge 0 between r1 and r2)
    n = nrm(r1, r2, 0)
    for (u0, u1) in ((0.04, 0.325), (0.355, 0.645), (0.675, 0.96)):
        blue.shutter(b, [on(r1, r2, 0, u0, 0.1), on(r1, r2, 0, u1, 0.1), on(r1, r2, 0, u1, 0.92), on(r1, r2, 0, u0, 0.92)], n, slats=6)
        # shutter hinges along the top edge
        for u in (u0 + 0.03, u1 - 0.03):
            h = on(r1, r2, 0, u, 0.95) + n * 0.03
            b.cyl('dark', h - Vector((0.04, 0, 0)), h + Vector((0.04, 0, 0)), 0.02, 0.02, 6)
    # lower front: lamp groups, bumper number plate, a grab handle and the driver's vision block
    for sx in (-1, 1):
        blue.lamp_cluster(b, (sx * 1.12, 1.70, 0.015), (0, 0, -1), side=sx)
    b.panel('white', [(0.25, 1.46, 0.02), (0.85, 1.46, 0.02), (0.85, 1.56, 0.02), (0.25, 1.56, 0.02)], (0, 0, -1), off=0.003)
    b.panel('black', [(-0.2, 1.46, 0.02), (-0.8, 1.46, 0.02), (-0.8, 1.56, 0.02), (-0.2, 1.56, 0.02)], (0, 0, -1), off=0.003)
    vkit.grab_handle(b, (0.0, 1.62, 0.015), (1, 0, 0), (0, 0, -1), 0.4, 0.05, 'dark')
    # roof: handrail round the edge, antenna bases, a vent, the commander's hatch ring
    rail = [(-1.2, 2.52, 1.95), (-1.2, 2.60, 1.9), (-1.2, 2.60, 0.8), (-1.2, 2.52, 0.75)]
    for sx in (-1, 1):
        b.tube('dark', [(sx * q[0] * -1, q[1], q[2]) if sx > 0 else q for q in rail], 0.018, 6)
    b.tube('dark', [(-1.2, 2.60, 1.9), (1.2, 2.60, 1.9)], 0.018, 6, caps=False)
    for sx in (-1, 1):
        vkit.whip_antenna(b, (sx * 1.18, 2.52, 1.96), h=2.4)
    b.box('dark', -0.55, -0.15, 2.52, 2.62, 1.55, 1.9, bev=0.02)          # ventilator housing
    b.lathe((0.62, 2.52, 1.35), (0, 1, 0), [(0, 0.42, 'paint'), (0.05, 0.42, 'paint'), (0.05, 0.36, 'dark')], n=18, smooth=False)
    # mirrors on arms at the front top corners
    for sx in (-1, 1):
        vkit.mirror(b, (sx * 1.38, 2.34, 0.75), (sx * 1.58, 2.30, 0.52), (0.14, 0.2))
    # the cab rear wall: a stowage basket up top
    for sx in (-1, 1):
        b.beam('dark', (sx * 1.2, 2.18, 2.12), (sx * 1.2, 2.44, 2.12), 0.03, 0.03)
    b.beam('dark', (-1.2, 2.44, 2.12), (1.2, 2.44, 2.12), 0.03, 0.03)


def doors(v):
    """cab side doors (hinged at the front edge, swing out) with an armoured vision block"""
    for sx, name in ((-1, 'door_l'), (1, 'door_r')):
        z0, z1, y0, y1 = 0.78, 1.78, 1.40, 2.34
        x = sx * 1.458
        hinge = (x, 1.87, z0)
        j = rot('y', -1.25, 0.0, stow=0.0, deploy=-1.25, group='door') if sx < 0 else rot('y', 0.0, 1.25, stow=0.0, deploy=1.25, group='door')
        d = Part(v, name, pivot=hinge, joint=j)
        # the door follows the cab side: vertical up to 1.88, then leaning in like the upper cab
        xt = sx * 1.40
        lo = [(x, y0, z0), (x, y0, z1), (x, 1.88, z1), (x, 1.88, z0)]
        hi = [(x, 1.88, z0), (x, 1.88, z1), (xt, y1, z1), (xt, y1, z0)]
        for q in (lo, hi):
            d.face(q, 'paint', want=(sx, 0.1 if q is hi else 0, 0))
            d.face([(p[0] - sx * 0.03, p[1], p[2]) for p in q], 'dark', want=(-sx, 0, 0))
        d.face([(x, y0, z0), (x, y0, z1), (x - sx * 0.03, y0, z1), (x - sx * 0.03, y0, z0)], 'paint', want=(0, -1, 0))
        d.face([(xt, y1, z0), (xt - sx * 0.03, y1, z0), (xt - sx * 0.03, y1, z1), (xt, y1, z1)], 'paint', want=(0, 1, 0))
        for (za, xa, xb) in ((z0, x, xt), (z1, x, xt)):
            d.face([(x, y0, za), (x - sx * 0.03, y0, za), (x - sx * 0.03, 1.88, za), (x, 1.88, za)], 'paint', want=(0, 0, -1 if za == z0 else 1))
        # vision block (armoured window) in the upper door
        nr = Vector((sx * 0.54, 0.084, 0)).normalized()
        c = Vector((lerp(x, xt, 0.5), 2.11, (z0 + z1) / 2 + 0.05))
        w = [c + Vector((0, -0.11, -0.2)), c + Vector((0, -0.11, 0.2)), c + Vector((0, 0.11, 0.2)), c + Vector((0, 0.11, -0.2))]
        d.panel('glass', [tuple(q) for q in w], (sx, 0.1, 0), off=0.012, frame=0.035, frame_skin='dark')
        vkit.grab_handle(d, (x + sx * 0.005, 1.62, z1 - 0.12), (0, 0, 1), (sx, 0, 0), 0.16, 0.035, 'dark')
        for y in (1.55, 2.05):
            d.cyl('dark', (x + sx * 0.02, y - 0.07, z0 + 0.02), (x + sx * 0.02, y + 0.07, z0 + 0.02), 0.022, 0.022, 6)
    # the dark door openings in the cab (seen when the doors swing open)
    return None


def door_openings(b):
    for sx in (-1, 1):
        x = sx * 1.452
        b.panel('interior', [(x, 1.42, 0.8), (x, 1.42, 1.76), (x, 1.86, 1.76), (x, 1.86, 0.8)], (sx, 0, 0), off=0.002)
        # seats and dash seen through the opening
        b.box('seat', sx * 0.7, sx * 1.2, 1.55, 1.95, 1.2, 1.6)
        b.box('dash', -1.3, 1.3, 1.7, 1.95, 0.1, 0.4)


def hatch(v):
    """commander's roof hatch (hinged at its rear edge, lifts forward edge up)"""
    c = Vector((0.62, 2.57, 1.35))
    h = Part(v, 'hatch_roof', pivot=(0.62, 2.58, 1.35 + 0.36), joint=rot('x', 0.0, 1.9, group='hatch'))
    h.cyl('paint', (c.x, 2.56, c.z), (c.x, 2.62, c.z), 0.36, 0.34, 18)
    h.box('dark', c.x - 0.04, c.x + 0.04, 2.62, 2.66, c.z - 0.2, c.z + 0.2)
    h.box('dark', c.x - 0.12, c.x + 0.12, 2.56, 2.63, c.z + 0.32, c.z + 0.4)


def llm(v):
    t = Part(v, 'turret', pivot=TURRET, joint=rot('y', -math.pi, math.pi, stow=0.0, deploy=0.0, group='turret'))
    # turntable deck
    t.box('paint', -1.30, 1.30, DECK + 0.03, 1.44, 2.18, 6.90, bev=0.015)
    # electronics / hydraulics box at the front of the module, radiator ribs on its faces
    t.box('paint', -1.24, 0.36, 1.44, 2.40, 2.16, 2.62, bev=0.02)
    for i in range(10):
        x = lerp(-1.12, 0.2, i / 9)
        t.box('paint', x - 0.018, x + 0.018, 1.62, 2.28, 2.13, 2.16)
    t.panel('black', [(-1.14, 1.62, 2.158), (0.22, 1.62, 2.158), (0.22, 2.28, 2.158), (-1.14, 2.28, 2.158)], (0, 0, -1), off=0.0)
    t.box('paint', 0.42, 1.24, 1.44, 1.96, 2.2, 2.62, bev=0.02)
    t.box('dark', 0.6, 1.0, 1.96, 2.02, 2.3, 2.5)
    vkit.grab_handle(t, (-1.245, 1.9, 2.4), (0, 1, 0), (-1, 0, 0), 0.3, 0.04, 'dark')
    # hydraulic lines from the box to the cage pivot
    for sx in (-1, 1):
        t.tube('hose', [(sx * 0.9, 1.46, 2.62), (sx * 0.9, 1.47, 5.8), (sx * 1.0, 1.49, 6.7)], 0.02, 5)
    # cage pivot trunnions at the rear of the turntable
    for sx in (-1, 1):
        t.box('dark', sx * 1.0, sx * 1.18, 1.42, 1.62, 6.72, 6.98)
    return t


def cage(v, t):
    c = Part(v, 'launcher', pivot=CAGE_PIVOT, parent=t, joint=rot('x', 0.0, math.radians(60), stow=0.0, deploy=math.radians(60), group='launcher'))
    z0, z1 = CAGE_Z0, CAGE_Z1
    # armoured side walls
    for sx in (-1, 1):
        c.box('paint', sx * 1.195, sx * 1.255, 1.50, 2.58, z0, z1, bev=0.008)
        c.box('paint', sx * 1.255, sx * 1.285, 1.50, 1.58, z0 + 0.05, z1 - 0.05)          # bottom stiffener
        for z in (3.7, 4.8, 5.9):
            c.box('paint', sx * 1.255, sx * 1.275, 1.58, 2.52, z - 0.03, z + 0.03)       # vertical stiffeners
        c.panel('black', [(sx * 1.256, 2.3, 4.1), (sx * 1.256, 2.3, 4.4), (sx * 1.256, 2.44, 4.4), (sx * 1.256, 2.44, 4.1)], (sx, 0, 0), off=0.003)
    # top plate and the loader boom (two arms along the top, crossbar and hoists at the front)
    c.box('paint', -1.255, 1.255, 2.52, 2.58, z0, z1)
    for sx in (-1, 1):
        c.box('paint', sx * 0.52, sx * 0.72, 2.58, 2.72, z0 + 0.05, z1 - 0.08, bev=0.015)
        c.box('dark', sx * 0.55, sx * 0.69, 2.72, 2.8, z0 + 0.08, z0 + 0.36)            # hoist block
        c.cyl('dark', (sx * 0.62, 2.58, z1 - 0.3), (sx * 0.62, 2.66, z1 - 0.3), 0.08, 0.08, 10)   # boom pivot
    c.box('paint', -0.72, 0.72, 2.6, 2.7, z0 + 0.05, z0 + 0.2)
    # front frame round the pod faces
    c.box('paint', -1.255, 1.255, 2.44, 2.52, z0, z0 + 0.1)
    c.box('paint', -1.255, 1.255, 1.50, 1.60, z0, z0 + 0.1)
    c.box('paint', -0.07, 0.07, 1.60, 2.44, z0, z0 + 0.1)
    c.box('paint', -1.255, 1.255, 2.44, 2.52, z1 - 0.1, z1)
    c.box('paint', -1.255, 1.255, 1.50, 1.60, z1 - 0.1, z1)
    # the two rocket pods (launch pod containers), each 2 × 3 tubes with frangible end covers, both ends
    mz = 0
    for k, (xa, xb) in enumerate(((-1.17, -0.08), (0.08, 1.17))):
        c.box('paint', xa, xb, POD_Y0, POD_Y1, z0 + 0.04, z1 - 0.06)
        xc = (xa + xb) / 2
        for row, y in enumerate((2.24, 1.83)):
            for col, dx in enumerate((-0.345, 0.0, 0.345)):
                for (zf, sgn) in ((z0 + 0.04, -1), (z1 - 0.06, 1)):
                    cc = Vector((xc + dx, y, zf))
                    nr = Vector((0, 0, sgn))
                    c.cyl('dark', cc, cc + nr * 0.012, 0.172, 0.172, 16, cap0=False)
                    c.cyl('odgreen', cc + nr * 0.012, cc + nr * 0.03, 0.16, 0.13, 16, cap0=False)
                if True:
                    mz += 1
                    c.empty('muzzle_%d' % mz, (xc + dx, y, z0 + 0.03), (0, 0, -1))
        # pod lifting eyes on top
        for zz in (z0 + 0.4, z1 - 0.4):
            c.box('dark', xc - 0.06, xc + 0.06, POD_Y1, POD_Y1 + 0.06, zz - 0.04, zz + 0.04)
    return c


def make():
    vkit.setup_materials('blue_green')
    v = Vehicle('m270', 'M270A1 Multiple Launch Rocket System', scheme='blue_green')
    b = Part(v, 'body')
    hull(v, b)
    cab(v, b)
    door_openings(b)
    doors(v)
    hatch(v)
    running_gear(v)
    t = llm(v)
    c = cage(v, t)
    for sx, n in ((-1, 'ram_l'), (1, 'ram_r')):
        vkit.ram(v, n, t, (sx * 0.98, 1.50, 3.25), c, (sx * 0.98, 1.60, 4.85), r=0.06)
    b.empty('seat_driver', (-0.75, 1.85, 0.95), (0, 0, -1))
    b.empty('hatch_entry', (-1.9, 0.0, 1.25), (1, 0, 0))
    return v
