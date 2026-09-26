# ═══════════════════════════════════════════════════════════════
# AN/MPQ-64 Sentinel air-defence radar on its two-wheel trailer (towed by a HMMWV).
#   blender -b -P tools/vehicles/build.py -- sentinel
# References: US Army / NASAMS / Lithuanian photos of the Sentinel and a side drawing on Wikimedia Commons
# (reference only): trailer ~3.3 m plus a 0.85 m drawbar, electronics box to 1.77 m, the antenna pedestal to
# 2.16 m, a 1.2 × 1.13 m planar array with the IFF array on top (3.4 m overall), HMMWV-size wheels,
# front cable reels, corner levelling jacks, a nose leg with a caster. The antenna turns at 30 rpm.
# Rig: antenna (spin, 30 rpm, about the pedestal axis), jack_fl/fr/rl/rr (levelling jacks), jack_nose (drawbar leg),
# door_box (the operator door on the electronics box), wheel_1l / wheel_1r, kingpin (towing eye: −z towards the tow
# vehicle), hatch_entry.
# ═══════════════════════════════════════════════════════════════
import math
from mathutils import Vector
import vkit
from vkit import Vehicle, Part, rot, slide, spinj, lerp
import blue

AXLE_Z = 2.14
TRACK = 1.86
WR, WW, WRIM = 0.46, 0.32, 0.21
BOX = (-0.74, 0.74, 0.82, 1.77, 1.49, 3.27)     # x0 x1 y0 y1 z0 z1
ANT_Z = 2.51
PED_TOP = 2.16


def trailer(v, b):
    x0, x1, y0, y1, z0, z1 = BOX
    # frame rails, cross members, the drawbar A-frame and the lunette
    for sx in (-1, 1):
        b.box('paint', sx * 0.52, sx * 0.64, 0.62, 0.78, 0.84, 3.30)
        b.beam('paint', (sx * 0.58, 0.70, 0.9), (sx * 0.08, 0.72, 0.12), 0.1, 0.1)
    for z in (0.9, 1.5, AXLE_Z, 2.8, 3.26):
        b.box('paint', -0.64, 0.64, 0.64, 0.76, z - 0.04, z + 0.04)
    b.box('dark', -0.08, 0.08, 0.66, 0.78, -0.05, 0.2)
    b.lathe((0, 0.72, -0.02), (0, 1, 0), [(-0.035, 0.1, 'dark'), (0.035, 0.1, 'dark')], n=12, smooth=False)
    b.cyl('dark', (0, 0.685, -0.02), (0, 0.755, -0.02), 0.055, 0.055, 10, cap0=True, cap1=True)
    b.empty('kingpin', (0, 0.72, -0.02), (0, 0, -1))
    # safety chains
    for sx in (-1, 1):
        b.tube('dark', [(sx * 0.1, 0.7, 0.15), (sx * 0.14, 0.55, 0.05), (sx * 0.1, 0.62, -0.03)], 0.01, 4)
    # front platform with the two cable reels and a junction box
    b.box('paint', -0.9, 0.9, 0.62, 0.68, 0.84, z0, bev=0.01)
    for sx in (-1, 1):
        c = Vector((sx * 0.5, 0.95, 1.18))
        b.cyl('dark', c - Vector((0.18, 0, 0)), c + Vector((0.18, 0, 0)), 0.26, 0.26, 18)      # reel flanges' drum
        for dx in (-0.19, 0.19):
            b.cyl('paint', c + Vector((dx - 0.01, 0, 0)), c + Vector((dx + 0.01, 0, 0)), 0.3, 0.3, 18)
        b.cyl('cable', c - Vector((0.17, 0, 0)), c + Vector((0.17, 0, 0)), 0.27, 0.27, 18, cap0=False, cap1=False)
        b.beam('paint', (sx * 0.5, 0.68, 1.0), (sx * 0.5, 0.95, 1.18), 0.05, 0.05)
        b.beam('paint', (sx * 0.5, 0.68, 1.36), (sx * 0.5, 0.95, 1.18), 0.05, 0.05)
    b.box('paint', -0.18, 0.18, 0.68, 1.1, 1.1, 1.4, bev=0.02)
    for k in range(3):
        b.cyl('dark', (-0.08 + k * 0.08, 0.95, 1.1), (-0.08 + k * 0.08, 0.95, 1.06), 0.025, 0.025, 8)
    # the electronics box: stepped over the wheels, doors, vents, latches
    b.box('paint', x0, x1, y0, y1, z0, z1, bev=0.03)
    for sx in (-1, 1):
        # side lockers above the fenders
        b.box('paint', sx * 0.74, sx * 1.02, 1.02, 1.62, z0 + 0.1, z1 - 0.1, bev=0.02)
        for (za, zb) in ((z0 + 0.14, AXLE_Z - 0.05), (AXLE_Z + 0.05, z1 - 0.14)):
            xo = sx * 1.02
            for (p0, p1) in (((xo, 1.06, za), (xo, 1.58, za)), ((xo, 1.06, zb), (xo, 1.58, zb)), ((xo, 1.58, za), (xo, 1.58, zb)), ((xo, 1.06, za), (xo, 1.06, zb))):
                P0, P1 = Vector(p0), Vector(p1)
                w = Vector((0, 0.009, 0)) if abs((P1 - P0).y) < 0.1 else Vector((0, 0, 0.009))
                b.panel('black', [P0 - w, P1 - w, P1 + w, P0 + w], (sx, 0, 0), off=0.003)
            vkit.grab_handle(b, (xo + sx * 0.005, 1.4, (za + zb) / 2), (0, 0, 1), (sx, 0, 0), 0.14, 0.03, 'dark')
        # fenders over the wheels
        xo = sx * (TRACK / 2 + WW / 2 + 0.03)
        xi = sx * (TRACK / 2 - WW / 2 - 0.03)
        arc = [(AXLE_Z + math.cos(a) * (WR + 0.08), 0.46 + math.sin(a) * (WR + 0.08)) for a in [math.radians(d) for d in range(0, 181, 20)]]
        for i in range(len(arc) - 1):
            (za, ya), (zb, yb) = arc[i], arc[i + 1]
            b.face([(xi, ya, za), (xo, ya, za), (xo, yb, zb), (xi, yb, zb)], 'paint', want=(0, ya + yb - 0.92, za + zb - 2 * AXLE_Z))
            b.face([(xi, ya, za), (xi, yb, zb), (xo, yb, zb), (xo, ya, za)], 'dark', want=(0, -(ya + yb - 0.92), -(za + zb - 2 * AXLE_Z)))
        b.box('paint', min(xo, xo - sx * 0.02), max(xo, xo - sx * 0.02), 0.56, 0.95, AXLE_Z - 0.55, AXLE_Z + 0.55)
        # mud flap behind the wheel
        b.box('rubber', min(xi, xo), max(xi, xo), 0.2, 0.62, AXLE_Z + 0.56, AXLE_Z + 0.58)
    # box front: vents, a data panel, connectors
    b.panel('vents', [(-0.6, 1.25, z0), (-0.05, 1.25, z0), (-0.05, 1.62, z0), (-0.6, 1.62, z0)], (0, 0, -1), off=0.004)
    b.panel('dials', [(0.12, 1.2, z0), (0.6, 1.2, z0), (0.6, 1.55, z0), (0.12, 1.55, z0)], (0, 0, -1), off=0.004)
    for k in range(4):
        b.cyl('dark', (0.2 + k * 0.12, 1.0, z0 + 0.005), (0.2 + k * 0.12, 1.0, z0 - 0.05), 0.035, 0.035, 8)
    # rear: tail lamps, reflectors, the air-conditioner grille
    for sx in (-1, 1):
        blue.tail_cluster(b, (sx * 0.62, 0.72, 3.32), (0, 0, 1), side=sx)
    b.panel('mesh', [(-0.5, 1.0, z1), (0.5, 1.0, z1), (0.5, 1.6, z1), (-0.5, 1.6, z1)], (0, 0, 1), off=0.004)
    # roof: the fixed pedestal base and a hand rail
    b.cyl('paint', (0, y1, ANT_Z), (0, y1 + 0.06, ANT_Z), 0.42, 0.38, 20)
    b.cyl('paint', (0, y1 + 0.06, ANT_Z), (0, PED_TOP - 0.05, ANT_Z), 0.27, 0.25, 20)
    b.cyl('dark', (0, PED_TOP - 0.05, ANT_Z), (0, PED_TOP, ANT_Z), 0.33, 0.33, 20)
    for k in range(6):
        ang = 2 * math.pi * k / 6
        b.beam('paint', (math.cos(ang) * 0.4, y1 + 0.06, ANT_Z + math.sin(ang) * 0.4), (math.cos(ang) * 0.26, PED_TOP - 0.12, ANT_Z + math.sin(ang) * 0.26), 0.03, 0.05)
    vkit.handrail(b, [(-0.6, y1, z0 + 0.1), (-0.6, y1 + 0.12, z0 + 0.12), (0.6, y1 + 0.12, z0 + 0.12), (0.6, y1, z0 + 0.1)], 0.016, 'dark')
    # GPS / comms mast stub and a whip antenna on the rear corner
    vkit.whip_antenna(b, (-0.66, y1, z1 - 0.12), h=1.8)
    b.empty('hatch_entry', (1.35, 0.0, 1.8), (-1, 0, 0))


def wheels(v):
    proto = None
    for side in (1, -1):
        name = 'wheel_1' + ('r' if side > 0 else 'l')
        if proto is None:
            proto = Part(v, name, pivot=(side * TRACK / 2, WR, AXLE_Z), local=True)
            blue.truck_wheel(proto, WR, WW, WRIM, tread='chevron', nbolts=8)
        else:
            Part(v, name, pivot=(side * TRACK / 2, WR, AXLE_Z), local=True, rest_yaw=math.pi, share=proto)
        v.meta['wheels'].append({'node': name, 'r': WR, 'steer': 0, 'side': side})


def jacks(v, b):
    """levelling jacks at the box corners (a screw leg in a housing, foot pad) and the drawbar nose leg"""
    for name, sx, z in (('jack_fl', -1, 1.62), ('jack_fr', 1, 1.62), ('jack_rl', -1, 3.14), ('jack_rr', 1, 3.14)):
        x = sx * 1.1
        top = 1.5
        foot = 0.36
        # housing on a bracket from the frame
        b.cyl('paint', (x, 0.72, z), (x, top + 0.1, z), 0.055, 0.055, 10)
        b.cyl('dark', (x, top + 0.1, z), (x, top + 0.16, z), 0.03, 0.03, 6)
        b.beam('dark', (x, top + 0.16, z), (x + sx * 0.12, top + 0.2, z), 0.02, 0.02)      # crank handle
        b.box('dark', min(x, sx * 0.6), max(x, sx * 0.6), 0.68, 0.76, z - 0.05, z + 0.05)
        j = Part(v, name, pivot=(x, top, z), joint=slide('-y', foot, group='jack'))
        j.cyl('steel', (x, foot + 0.04, z), (x, 0.8, z), 0.038, 0.038, 8)
        j.cyl('dark', (x, foot, z), (x, foot + 0.04, z), 0.14, 0.13, 12)
    # drawbar nose leg with a caster wheel
    zc, xc = 0.36, 0.0
    b.cyl('paint', (0.14, 0.62, zc), (0.14, 1.02, zc), 0.045, 0.045, 10)
    b.box('dark', 0.06, 0.16, 0.66, 0.74, zc - 0.05, zc + 0.05)
    n = Part(v, 'jack_nose', pivot=(0.14, 1.0, zc), joint=slide('-y', 0.33, group='jack'))
    n.cyl('steel', (0.14, 0.52, zc), (0.14, 0.95, zc), 0.032, 0.032, 8)
    n.box('dark', 0.1, 0.18, 0.4, 0.52, zc - 0.04, zc + 0.04)
    n.cyl('rubber', (0.1, 0.33, zc + 0.08), (0.18, 0.33, zc + 0.08), 0.075, 0.075, 12)   # caster
    n.cyl('dark', (0.095, 0.33, zc + 0.08), (0.185, 0.33, zc + 0.08), 0.03, 0.03, 6)


def door(v):
    """the operator door on the front right of the electronics box (hinged on its front edge, swings forwards)"""
    x0, x1, y0, y1, z0, z1 = BOX
    x = 1.022
    d = Part(v, 'door_box', pivot=(x, 1.34, 1.62), joint=rot('y', 0.0, 1.6, stow=0.0, deploy=1.6, group='door'))
    d.box('paint', x, x + 0.03, 1.08, 1.6, 1.62, 2.06)
    vkit.grab_handle(d, (x + 0.035, 1.34, 1.98), (0, 1, 0), (1, 0, 0), 0.14, 0.03, 'dark')
    return d


def antenna(v):
    """the turning antenna group: turntable, drive housing, the tilted planar array with its back-up boxes, the IFF
    array on top. Built facing −z (the array's face) at rest."""
    a = Part(v, 'antenna', pivot=(0, PED_TOP, ANT_Z), joint=spinj('y', rpm=30.0))
    y0 = PED_TOP
    a.cyl('paint', (0, y0, ANT_Z), (0, y0 + 0.1, ANT_Z), 0.3, 0.28, 20)
    a.box('paint', -0.22, 0.22, y0 + 0.1, y0 + 0.36, ANT_Z - 0.2, ANT_Z + 0.22, bev=0.02)       # drive housing
    a.cyl('dark', (-0.24, y0 + 0.26, ANT_Z), (0.24, y0 + 0.26, ANT_Z), 0.07, 0.07, 10)           # elevation trunnion
    # array: 1.2 m wide × 1.13 m, tilted back 10°, its face towards −z
    tilt = math.radians(10)
    c = Vector((0, y0 + 0.36 + 0.58, ANT_Z - 0.05))
    up = Vector((0, math.cos(tilt), math.sin(tilt)))
    fwd = Vector((0, -math.sin(tilt), math.cos(tilt))) * -1          # the face normal (towards −z, tilted up)
    across = Vector((1, 0, 0))
    hw, hh, th = 0.6, 0.565, 0.12
    def q(u, w, d):
        return c + across * u + up * w - fwd * d
    face = [q(-hw, -hh, 0), q(hw, -hh, 0), q(hw, hh, 0), q(-hw, hh, 0)]
    back = [q(-hw, -hh, th), q(hw, -hh, th), q(hw, hh, th), q(-hw, hh, th)]
    a.face([tuple(p) for p in face], 'radar_face', want=tuple(fwd))
    a.face([tuple(p) for p in back], 'paint', want=tuple(-fwd))
    for i in range(4):
        j = (i + 1) % 4
        mid = (face[i] + face[j]) / 2 - c
        a.face([tuple(face[i]), tuple(face[j]), tuple(back[j]), tuple(back[i])], 'paint', want=tuple(mid))
    # frame rim round the face and a grid of radiating-element rows (thin raised strips)
    for (u0, w0, u1, w1) in ((-hw, -hh, hw, -hh), (hw, -hh, hw, hh), (hw, hh, -hw, hh), (-hw, hh, -hw, -hh)):
        a.beam('paint', q(u0, w0, -0.015), q(u1, w1, -0.015), 0.05, 0.035, up=tuple(fwd))
    for k in range(1, 8):
        w = lerp(-hh, hh, k / 8)
        a.beam('darkgrey', q(-hw + 0.04, w, -0.008), q(hw - 0.04, w, -0.008), 0.012, 0.01, up=tuple(fwd))
    # back-up electronics boxes behind the array (the camo boxes in the photos)
    a.box('paint', -0.42, 0.42, y0 + 0.5, y0 + 1.35, ANT_Z + 0.05, ANT_Z + 0.36, bev=0.02)
    a.box('paint', -0.58, -0.44, y0 + 0.62, y0 + 1.2, ANT_Z - 0.02, ANT_Z + 0.3, bev=0.015)
    a.box('paint', 0.44, 0.58, y0 + 0.62, y0 + 1.2, ANT_Z - 0.02, ANT_Z + 0.3, bev=0.015)
    a.panel('dark', [(0.43, y0 + 0.9, ANT_Z + 0.2), (0.43, y0 + 0.9, ANT_Z + 0.36), (0.43, y0 + 1.25, ANT_Z + 0.36), (0.43, y0 + 1.25, ANT_Z + 0.2)], (1, 0, 0), off=0.003)
    # IFF array bar on top of the main array
    top = q(0, hh, 0.04)
    a.box('paint', -0.45, 0.45, top.y, top.y + 0.13, top.z - 0.1, top.z + 0.08, bev=0.015)
    a.panel('radar_face', [(-0.42, top.y + 0.01, top.z - 0.101), (0.42, top.y + 0.01, top.z - 0.101), (0.42, top.y + 0.12, top.z - 0.101), (-0.42, top.y + 0.12, top.z - 0.101)], (0, 0, -1), off=0.002)
    # cable loop from the turntable up to the boxes
    a.tube('cable', [(0.25, y0 + 0.2, ANT_Z + 0.1), (0.35, y0 + 0.4, ANT_Z + 0.3), (0.3, y0 + 0.6, ANT_Z + 0.36)], 0.02, 5)
    # warning plates (the yellow diamonds in the photos)
    a.panel('yellow', [(-0.425, y0 + 1.12, ANT_Z + 0.22), (-0.425, y0 + 1.2, ANT_Z + 0.3), (-0.425, y0 + 1.28, ANT_Z + 0.22), (-0.425, y0 + 1.2, ANT_Z + 0.14)], (-1, 0, 0), off=0.003)
    return a


def make():
    vkit.setup_materials('blue_green')
    v = Vehicle('sentinel', 'AN/MPQ-64 Sentinel radar', scheme='blue_green')
    b = Part(v, 'body')
    trailer(v, b)
    wheels(v)
    jacks(v, b)
    door(v)
    antenna(v)
    return v
