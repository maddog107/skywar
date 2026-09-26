# ═══════════════════════════════════════════════════════════════
# M1126 Stryker Infantry Carrier Vehicle (8×8) with the M151 Protector remote weapon station (M2 .50 cal).
#   blender -b -P tools/vehicles/build.py -- stryker
# References: 6.95 × 2.72 × 2.64 m, 16.5 t, 2 crew + 9; a side drawing (Wikimedia Commons, reference only) for the
# axle stations (1.58 / 2.78 / 4.19 / 5.37 m from the nose), wheel size (1.1 m), the long upper glacis and the roof
# line at 2.1 m; US Army photos (public domain) for the front, the bolt-on armour, the RWS and the rear ramp.
# Rig: turret (RWS yaw, full circle), launcher (M2 cradle, rot x −20° → 60°), muzzle_1 (M2 muzzle), door_ramp (rear
# ramp, rot x about its bottom hinge 0 → 116°, resting on the ground), hatch_driver, hatch_cmd, wheel_<axle><l|r> (axles 1 and 2 steer),
# exhaust, seat_driver, hatch_entry.
# ═══════════════════════════════════════════════════════════════
import math
from mathutils import Vector
import vkit
from vkit import Vehicle, Part, rot, lerp
import blue

AXLES = [1.58, 2.78, 4.19, 5.37]
TRACK = 2.2
WR, WW, WRIM = 0.55, 0.32, 0.26
HX = 1.36                  # half width over the bolt-on armour
Y_SP, Y_ROOF = 1.28, 2.10  # sponson lower edge, roof
Z_NOSE, Z_ROOF0, Z_REAR = 0.05, 2.30, 6.72
RWS = (0.12, Y_ROOF, 3.25)


def hull(v, b):
    # upper hull: side profile extruded across the width (nose, upper glacis, roof, rear plate)
    prof = [(Z_NOSE, Y_SP), (Z_ROOF0, Y_ROOF), (Z_REAR - 0.04, Y_ROOF), (Z_REAR, Y_ROOF - 0.06), (Z_REAR, Y_SP)]
    b.prism_x('paint', prof, -HX, HX)
    # lower hull: narrower, sloping in to the belly; lower glacis at the front, sloped rear under the ramp
    lo = [(-HX + 0.02, Y_SP), (HX - 0.02, Y_SP), (0.86, 0.56), (-0.86, 0.56)]
    b.prism_z('paint', lo, Z_NOSE + 0.35, Z_REAR - 0.05)
    # lower glacis (front) joining the nose to the belly
    b.face([(-HX + 0.02, Y_SP, Z_NOSE), (HX - 0.02, Y_SP, Z_NOSE), (0.86, 0.56, Z_NOSE + 0.75), (-0.86, 0.56, Z_NOSE + 0.75)], 'paint', want=(0, -0.7, -1))
    for sx in (-1, 1):
        b.face([(sx * (HX - 0.02), Y_SP, Z_NOSE), (sx * 0.86, 0.56, Z_NOSE + 0.75), (sx * (HX - 0.02), Y_SP, Z_NOSE + 0.75)], 'paint', want=(sx, -0.3, -0.3))
    b.box('paint', -0.86, 0.86, 0.56, 0.6, Z_NOSE + 0.35, Z_NOSE + 0.8)
    # armour tile seams and bolt rows on the sides and glacis (the bolt-on ceramic armour)
    for sx in (-1, 1):
        x = sx * HX
        for z in (2.2, 3.1, 4.0, 4.9, 5.8):
            b.panel('black', [(x, Y_SP + 0.04, z - 0.006), (x, Y_SP + 0.04, z + 0.006), (x, Y_ROOF - 0.05, z + 0.006), (x, Y_ROOF - 0.05, z - 0.006)], (sx, 0, 0), off=0.002)
        b.panel('black', [(x, 1.66, 1.2), (x, 1.66, Z_REAR - 0.1), (x, 1.672, Z_REAR - 0.1), (x, 1.672, 1.2)], (sx, 0, 0), off=0.002)
        for k in range(12):
            z = lerp(2.5, 6.4, k / 11)
            b.cyl('dark', (x, 1.9, z), (x + sx * 0.015, 1.9, z), 0.022, 0.022, 6, cap0=False)
            b.cyl('dark', (x, 1.45, z), (x + sx * 0.015, 1.45, z), 0.022, 0.022, 6, cap0=False)
        # stowage bin on the rear side, a jerrycan rack, the side lamps
        b.box('paint', x, x + sx * 0.16, 1.4, 1.85, 5.6, 6.5, bev=0.015)
        vkit.grab_handle(b, (x + sx * 0.165, 1.62, 6.05), (0, 0, 1), (sx, 0, 0), 0.16, 0.03, 'dark')
        vkit.lamp_box(b, (x + sx * 0.02, 1.95, Z_REAR - 0.1), (0.04, 0.06, 0.1), (sx, 0, 0), lens='lens_amber', skin='dark')
        # mirror posts at the front corners
        base = Vector((sx * 1.2, 1.45, 0.5))
        b.tube('dark', [base, base + Vector((sx * 0.1, 0.15, 0.0)), base + Vector((sx * 0.1, 0.52, 0.02))], 0.02, 6)
        vkit.mirror(b, base + Vector((sx * 0.1, 0.52, 0.02)), base + Vector((sx * 0.18, 0.58, -0.02)), (0.15, 0.22))
    # glacis: tile seams and bolts, headlight groups in guards, tow hooks
    n = Vector((0, Z_ROOF0 - Z_NOSE, -(Y_ROOF - Y_SP))).normalized()
    def gl(x, t):
        return Vector((x, lerp(Y_SP, Y_ROOF, t), lerp(Z_NOSE, Z_ROOF0, t)))
    for t in (0.33, 0.66):
        a, c = gl(-HX + 0.05, t), gl(HX - 0.05, t)
        b.panel('black', [a - Vector((0, 0.005, 0)), c - Vector((0, 0.005, 0)), c + Vector((0, 0.005, 0)), a + Vector((0, 0.005, 0))], n, off=0.002)
    for k in range(14):
        x = lerp(-1.2, 1.2, k / 13)
        for t in (0.1, 0.5, 0.9):
            p = gl(x, t)
            b.cyl('dark', p, p + n * 0.015, 0.022, 0.022, 6, cap0=False)
    for sx in (-1, 1):
        c = gl(sx * 0.95, 0.12) + n * 0.04
        blue.lamp_cluster(b, c, (0, 0.2, -1), side=sx, marker=False)
        g0 = c + Vector((0, 0, -0.14))
        for dx in (-0.2, 0.2):
            b.tube('dark', [c + Vector((dx, -0.12, 0.02)), c + Vector((dx, -0.1, -0.14)), c + Vector((dx, 0.12, -0.12)), c + Vector((dx, 0.16, 0.02))], 0.012, 5)
        b.tube('dark', [(sx * 0.55, 0.95, Z_NOSE + 0.3), (sx * 0.55, 0.85, Z_NOSE + 0.2), (sx * 0.55, 0.78, Z_NOSE + 0.34)], 0.025, 6)
    # engine air-exhaust grille on the right front and the exhaust outlet
    b.panel('vents', [(HX, 1.45, 0.9), (HX, 1.45, 1.6), (HX, 1.85, 1.6), (HX, 1.85, 0.9)], (1, 0, 0), off=0.004)
    b.empty('exhaust', (HX + 0.02, 1.35, 1.3), (1, 0, 0))
    # roof: driver's periscopes, the commander's cupola ring with vision blocks, troop hatches, antennas
    for k in range(3):
        b.box('dark', -0.95 + k * 0.14, -0.85 + k * 0.14, Y_ROOF, Y_ROOF + 0.07, 2.25, 2.33)
    b.lathe((-0.55, Y_ROOF, 4.2), (0, 1, 0), [(0, 0.45, 'paint'), (0.1, 0.45, 'paint'), (0.1, 0.36, 'paint')], n=16, smooth=False)
    for k in range(5):
        a = math.radians(-60 + k * 30)
        p = Vector((-0.55 + math.sin(a) * 0.45, Y_ROOF + 0.05, 4.2 - math.cos(a) * 0.45))
        b.box('glass', p.x - 0.06, p.x + 0.06, p.y - 0.03, p.y + 0.03, p.z - 0.02, p.z + 0.02)
    for (za, zb) in ((5.0, 5.8), (5.85, 6.55)):
        b.panel('paint', [(-0.9, Y_ROOF, za), (0.9, Y_ROOF, za), (0.9, Y_ROOF, zb), (-0.9, Y_ROOF, zb)], (0, 1, 0), off=0.02, frame=0.03, frame_skin='dark')
    for sx in (-1, 1):
        vkit.whip_antenna(b, (sx * 1.1, Y_ROOF, 6.4), h=2.8)
    b.box('dark', 0.55, 0.95, Y_ROOF, Y_ROOF + 0.12, 5.9, 6.3, bev=0.02)          # comms box
    # rear plate: ramp opening (dark, seen when the ramp is down), lamps, pintle, steps
    b.panel('interior', [(-0.62, 0.62, Z_REAR), (0.62, 0.62, Z_REAR), (0.62, 1.96, Z_REAR), (-0.62, 1.96, Z_REAR)], (0, 0, 1), off=0.002)
    b.box('floor', -0.62, 0.62, 0.6, 0.66, 3.0, Z_REAR - 0.02)
    for sx in (-1, 1):
        b.box('seat', sx * 0.4, sx * 0.8, 0.66, 1.1, 3.4, Z_REAR - 0.3)           # troop benches
        blue.tail_cluster(b, (sx * 1.05, 1.9, Z_REAR + 0.02), (0, 0, 1), side=sx)
    b.box('dark', -0.1, 0.1, 0.55, 0.7, Z_REAR, Z_REAR + 0.16)
    # belly / drive line under the hull (dark)
    for z in AXLES:
        for sx in (-1, 1):
            b.beam('dark', (sx * 0.8, 0.72, z), (sx * 0.98, WR, z), 0.1, 0.08)
    b.empty('seat_driver', (-0.8, 1.55, 1.8), (0, 0, -1))
    b.empty('hatch_entry', (0.0, 0.0, Z_REAR + 1.8), (0, 0, -1))


def wheels(v):
    proto = None
    for i, z in enumerate(AXLES):
        for side in (1, -1):
            name = 'wheel_%d%s' % (i + 1, 'r' if side > 0 else 'l')
            if proto is None:
                proto = Part(v, name, pivot=(side * TRACK / 2, WR, z), local=True)
                vkit.build_wheel(proto, WR, WW, WRIM, lugs=18, seg=24, nbolts=10, cti=True, hub_skin='paint', rim_skin='paint', tread='chevron')
            else:
                Part(v, name, pivot=(side * TRACK / 2, WR, z), local=True, rest_yaw=0.0 if side > 0 else math.pi, share=proto)
            v.meta['wheels'].append({'node': name, 'r': WR, 'steer': {0: 1.0, 1: 0.55}.get(i, 0), 'side': side})


def ramp(v):
    """the rear ramp, hinged at its bottom edge, lowered 116° onto the ground (with its emergency door outline)"""
    y0, y1 = 0.62, 1.96
    r = Part(v, 'door_ramp', pivot=(0, y0, Z_REAR + 0.02), joint=rot('x', 0.0, math.radians(116), stow=0.0, deploy=math.radians(116), group='door'))
    r.box('paint', -0.66, 0.66, y0, y1, Z_REAR, Z_REAR + 0.07, bev=0.01)
    r.box('floor', -0.62, 0.62, y0 + 0.05, y1 - 0.05, Z_REAR - 0.005, Z_REAR)
    for (p0, p1) in (((0.1, y0 + 0.2, Z_REAR + 0.07), (0.1, y1 - 0.1, Z_REAR + 0.07)), ((0.55, y0 + 0.2, Z_REAR + 0.07), (0.55, y1 - 0.1, Z_REAR + 0.07)),
                     ((0.1, y1 - 0.1, Z_REAR + 0.07), (0.55, y1 - 0.1, Z_REAR + 0.07)), ((0.1, y0 + 0.2, Z_REAR + 0.07), (0.55, y0 + 0.2, Z_REAR + 0.07))):
        P0, P1 = Vector(p0), Vector(p1)
        w = Vector((0.008, 0, 0)) if abs((P1 - P0).y) > 0.1 else Vector((0, 0.008, 0))
        r.panel('black', [P0 - w, P1 - w, P1 + w, P0 + w], (0, 0, 1), off=0.002)
    vkit.grab_handle(r, (0.45, 1.25, Z_REAR + 0.075), (0, 1, 0), (0, 0, 1), 0.16, 0.035, 'dark')
    r.panel('glass', [(0.22, 1.6, Z_REAR + 0.07), (0.44, 1.6, Z_REAR + 0.07), (0.44, 1.76, Z_REAR + 0.07), (0.22, 1.76, Z_REAR + 0.07)], (0, 0, 1), off=0.003, frame=0.02, frame_skin='dark')
    for sx in (-1, 1):
        r.cyl('dark', (sx * 0.5, y0 + 0.03, Z_REAR + 0.02), (sx * 0.64, y0 + 0.03, Z_REAR + 0.02), 0.04, 0.04, 8)


def hatches(v):
    # driver's hatch (front left of the roof, hinged at its rear edge)
    hd = Part(v, 'hatch_driver', pivot=(-0.75, Y_ROOF + 0.02, 2.95), joint=rot('x', 0.0, 1.8, group='hatch'))
    hd.cyl('paint', (-0.75, Y_ROOF, 2.62), (-0.75, Y_ROOF + 0.06, 2.62), 0.3, 0.28, 16)
    hd.box('dark', -0.8, -0.7, Y_ROOF + 0.06, Y_ROOF + 0.1, 2.5, 2.75)
    # commander's hatch in the cupola
    hc = Part(v, 'hatch_cmd', pivot=(-0.55, Y_ROOF + 0.12, 4.56), joint=rot('x', 0.0, 1.8, group='hatch'))
    hc.cyl('paint', (-0.55, Y_ROOF + 0.08, 4.2), (-0.55, Y_ROOF + 0.14, 4.2), 0.36, 0.34, 16)
    hc.box('dark', -0.6, -0.5, Y_ROOF + 0.14, Y_ROOF + 0.18, 4.05, 4.35)


def rws(v):
    """M151 Protector RWS: turret (yaw) = pedestal and the side sight/electronics box; launcher (pitch) = the gun cradle
    with the M2, its ammunition can and the day/thermal sight"""
    x, y, z = RWS
    t = Part(v, 'turret', pivot=RWS, joint=rot('y', -math.pi, math.pi, stow=0.0, deploy=0.0, group='turret'))
    t.cyl('paint', (x, y, z), (x, y + 0.12, z), 0.34, 0.32, 18)
    t.cyl('dark', (x, y + 0.12, z), (x, y + 0.2, z), 0.2, 0.18, 14)
    t.box('paint', x - 0.2, x + 0.2, y + 0.2, y + 0.5, z - 0.22, z + 0.28, bev=0.02)           # yoke base
    for sx in (-1, 1):
        t.box('paint', x + sx * 0.16, x + sx * 0.24, y + 0.45, y + 0.72, z - 0.1, z + 0.12)     # yoke arms
    t.box('paint', x + 0.24, x + 0.52, y + 0.3, y + 0.62, z - 0.2, z + 0.24, bev=0.02)        # electronics / sight box
    t.box('glass', x + 0.3, x + 0.46, y + 0.42, y + 0.56, z - 0.205, z - 0.2)
    t.box('dark', x - 0.52, x - 0.24, y + 0.26, y + 0.5, z - 0.1, z + 0.22, bev=0.015)        # ammunition container
    for k in range(4):
        t.box('dark', x - 0.2 + k * 0.12, x - 0.12 + k * 0.12, y + 0.2, y + 0.23, z + 0.3, z + 0.34)   # smoke grenade launchers
    tr = Vector((x, y + 0.62, z))
    g = Part(v, 'launcher', pivot=tuple(tr), parent=t, joint=rot('x', math.radians(-20), math.radians(60), stow=0.0, deploy=math.radians(15), group='launcher'))
    # M2 receiver, barrel with the jacket, flash hider; a cradle and the sight head above it
    g.box('dark', x - 0.07, x + 0.07, tr.y - 0.08, tr.y + 0.09, z - 0.32, z + 0.34, bev=0.01)
    g.cyl('gunmetal', (x, tr.y, z - 0.32), (x, tr.y, z - 0.55), 0.045, 0.045, 10)             # barrel jacket
    g.cyl('gunmetal', (x, tr.y, z - 0.55), (x, tr.y, z - 1.44), 0.022, 0.022, 8)              # barrel
    g.cyl('black', (x, tr.y, z - 1.44), (x, tr.y, z - 1.5), 0.03, 0.028, 8)                   # flash hider
    g.box('paint', x - 0.13, x + 0.13, tr.y - 0.12, tr.y - 0.06, z - 0.3, z + 0.3)            # cradle
    g.box('paint', x - 0.1, x + 0.1, tr.y + 0.09, tr.y + 0.26, z - 0.2, z + 0.1, bev=0.015)   # sight head
    g.box('glass', x - 0.07, x + 0.07, tr.y + 0.12, tr.y + 0.23, z - 0.205, z - 0.2)
    g.tube('dark', [(x - 0.07, tr.y, z + 0.1), (x - 0.2, tr.y - 0.05, z + 0.05), (x - 0.3, tr.y - 0.12, z + 0.05)], 0.02, 5)   # ammo chute
    g.empty('muzzle_1', (x, tr.y, z - 1.5), (0, 0, -1))


def make():
    vkit.setup_materials('blue_tan')
    v = Vehicle('stryker', 'M1126 Stryker ICV', scheme='blue_tan')
    b = Part(v, 'body')
    hull(v, b)
    wheels(v)
    ramp(v)
    hatches(v)
    rws(v)
    return v
