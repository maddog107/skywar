# ═══════════════════════════════════════════════════════════════
# Wheel loader for rapid runway repair (the Caterpillar 950 class; the US Army's 130G / the USAF RADR kit's
# loaders are this size): articulated frame, four 23.5R25 tyres, Z-bar lift linkage, a 3 m general-purpose bucket.
#   blender -b -P tools/airbases/build.py -- loader
# Caterpillar 950M spec sheet: 8.6 m long with the bucket on the ground, 2.9 m over the tyres (bucket 3.0 m),
# 3.45 m to the top of the ROPS cab, wheelbase 3.35 m, tread 2.2 m, 23.5R25 tyres (1.6 m diameter), hinge-pin
# height 4.1 m fully raised. Photos: Cat 950 series loaders and USAF RADR exercise shots (DVIDS, public domain).
# Rig: arm (rot x about the lift-arm pins on the front frame, group 'raise': 0 bucket on the ground … 1 raised to
# ~4 m hinge height), lift rams ram_l / ram_r, 4 wheels, exhaust.
# ═══════════════════════════════════════════════════════════════
import math
import akit
import vkit
from akit import Vehicle, Part, rot
import usfam

R, W, RIM = 0.80, 0.60, 0.50
AXLES = [2.65, 6.0]
TRACK = 2.2
PIN = (0.0, 2.15, 3.35)          # lift-arm pins on the front frame
BPIN = (0.0, 0.62, 1.05)          # bucket hinge pins
ART = 4.35                        # articulation hitch


def front_frame(b):
    # the front (loader) frame: side plates from the hitch to the arm towers, axle, fenders
    for sx in (-1, 1):
        b.box('paint', sx * 0.42, sx * 0.56, 0.75, 1.35, 2.0, ART)
        b.box('paint', sx * 0.36, sx * 0.52, 1.2, PIN[1] + 0.12, PIN[2] - 0.3, PIN[2] + 0.35, bev=0.02)     # arm towers
        b.cyl('dark', (sx * 0.3, PIN[1], PIN[2]), (sx * 0.6, PIN[1], PIN[2]), 0.1, 0.1, 10)
        # fenders over the front wheels
        f = [(AXLES[0] - 1.0, 1.35), (AXLES[0] - 0.75, 1.72), (AXLES[0] + 0.55, 1.72), (AXLES[0] + 0.85, 1.35)]
        for (za, ya), (zb, yb) in zip(f, f[1:]):
            b.face([(sx * 0.62, ya, za), (sx * 1.45, ya, za), (sx * 1.45, yb, zb), (sx * 0.62, yb, zb)], 'paint', want=(0, 1, -0.3 if zb > za else 0.3))
    b.box('paint', -0.56, 0.56, 0.8, 1.35, 2.0, 2.2)
    b.box('paint', -0.56, 0.56, 0.9, 1.3, ART - 0.25, ART)
    b.cyl('dark', (-0.95, R, AXLES[0]), (0.95, R, AXLES[0]), 0.13, 0.13, 10)
    b.lathe((0, R, AXLES[0] - 0.3), (0, 0, 1), [(0, 0.06, 'dark'), (0.08, 0.26, 'dark'), (0.5, 0.28, 'dark'), (0.6, 0.1, 'dark')], n=12)
    # articulation hitch (the pins linking the frames)
    for y in (0.95, 1.35):
        b.cyl('steel', (0, y - 0.08, ART), (0, y + 0.08, ART), 0.16, 0.16, 12)
    for sx in (-1, 1):
        vkit.headlight(b, (sx * 0.5, PIN[1] + 0.02, PIN[2] - 0.34), (0, 0, -1), r=0.09, guard=True)


def rear_frame(b):
    y0 = 0.85
    # rear frame, engine hood sloping down to the counterweight
    for sx in (-1, 1):
        b.box('paint', sx * 0.45, sx * 0.6, y0, 1.35, ART, 8.1)
    b.box('paint', -1.1, 1.1, 1.35, 1.55, ART + 0.1, 8.0)                                           # deck
    prof = [(6.0, 1.55), (6.0, 2.6), (7.4, 2.5), (7.95, 2.3), (7.95, 1.55)]
    b.prism_x('paint', [(z, y) for (z, y) in prof], -0.85, 0.85)
    for sx in (-1, 1):
        b.panel('vents', [(sx * 0.851, 1.75, 6.75), (sx * 0.851, 1.75, 7.7), (sx * 0.851, 2.35, 7.7), (sx * 0.851, 2.35, 6.75)], (sx, 0, 0), off=0.004)
        b.panel('paint', [(sx * 0.852, 1.62, 6.08), (sx * 0.852, 1.62, 6.65), (sx * 0.852, 2.45, 6.65), (sx * 0.852, 2.45, 6.08)], (sx, 0, 0), off=0.01)
    # counterweight with the rear grille, lights and the tow hitch
    b.box('paint', -1.2, 1.2, 0.72, 1.6, 7.95, 8.45, bev=0.05)
    b.panel('mesh', [(-0.7, 1.7, 7.96), (0.7, 1.7, 7.96), (0.7, 2.25, 7.96), (-0.7, 2.25, 7.96)], (0, 0, 1), off=0.001)
    b.panel('mesh', [(-0.7, 1.7, 7.96), (0.7, 1.7, 7.96), (0.7, 2.25, 7.96), (-0.7, 2.25, 7.96)], (0, 0, 1), off=0.001)
    for sx in (-1, 1):
        vkit.lamp_box(b, (sx * 0.95, 1.45, 8.46), (0.2, 0.12, 0.05), (0, 0, 1), lens='lens_red')
        vkit.headlight(b, (sx * 0.8, 2.36, 7.93), (0, 0.3, 1), r=0.08)
        usfam.reflector_tri(b, (sx * 0.6, 1.1, 8.45), (0, 0, 1), 0.06)
    b.box('dark', -0.15, 0.15, 0.8, 1.0, 8.45, 8.6)
    # rear axle and fenders (full, with steps)
    b.cyl('dark', (-0.95, R, AXLES[1]), (0.95, R, AXLES[1]), 0.13, 0.13, 10)
    b.lathe((0, R, AXLES[1] - 0.3), (0, 0, 1), [(0, 0.06, 'dark'), (0.08, 0.26, 'dark'), (0.5, 0.28, 'dark'), (0.6, 0.1, 'dark')], n=12)
    for sx in (-1, 1):
        f = [(AXLES[1] - 0.95, 1.4), (AXLES[1] - 0.7, 1.75), (AXLES[1] + 0.7, 1.75), (AXLES[1] + 0.95, 1.4)]
        for (za, ya), (zb, yb) in zip(f, f[1:]):
            b.face([(sx * 0.85, ya, za), (sx * 1.45, ya, za), (sx * 1.45, yb, zb), (sx * 0.85, yb, zb)], 'paint', want=(0, 1, -0.3 if zb > za else 0.3))
        b.box('paint', sx * 1.0, sx * 1.45, 1.35, 1.4, ART + 0.05, AXLES[1] - 0.95)                      # side walkway
        vkit.ladder(b, sx * 1.12, 0.45, 1.35, 4.6, 4.95, rungs=3)
    # exhaust stack, air-cleaner pre-filter
    b.cyl('dark', (0.45, 2.55, 6.9), (0.45, 3.25, 6.95), 0.07, 0.07, 10)
    b.empty('exhaust', (0.45, 3.25, 6.95), (0, 1, 0))
    b.cyl('paint', (-0.45, 2.55, 6.6), (-0.45, 3.05, 6.6), 0.1, 0.1, 10)
    b.cyl('black', (-0.45, 3.05, 6.6), (-0.45, 3.2, 6.6), 0.14, 0.14, 10)


def cab(b):
    # ROPS / FOPS cab: four posts, big glass, roof with work lights and a beacon
    z0, z1, y0, y1 = 4.45, 5.95, 1.55, 3.45
    hw = 0.78
    for sx in (-1, 1):
        for z in (z0, z1):
            b.box('paint', sx * hw - 0.06, sx * hw + 0.06, y0, y1 - 0.08, z - 0.06, z + 0.06)
    b.box('paint', -hw - 0.1, hw + 0.1, y1 - 0.12, y1, z0 - 0.14, z1 + 0.12, bev=0.03)
    b.box('dark', -hw, hw, y0, y0 + 0.5, z0 + 0.05, z1 - 0.05)                                  # lower cab / floor
    # glass: front, rear, sides
    b.face([(-hw + 0.06, y0 + 0.5, z0), (hw - 0.06, y0 + 0.5, z0), (hw - 0.06, y1 - 0.12, z0 - 0.02), (-hw + 0.06, y1 - 0.12, z0 - 0.02)], 'glass', want=(0, 0, -1))
    b.face([(-hw + 0.06, y0 + 0.9, z1), (hw - 0.06, y0 + 0.9, z1), (hw - 0.06, y1 - 0.12, z1), (-hw + 0.06, y1 - 0.12, z1)], 'glass', want=(0, 0, 1))
    b.box('paint', -hw, hw, y0 + 0.5, y0 + 0.9, z1 - 0.02, z1 + 0.02)
    for sx in (-1, 1):
        b.face([(sx * hw, y0 + 0.5, z0 + 0.06), (sx * hw, y0 + 0.5, z1 - 0.06), (sx * hw, y1 - 0.12, z1 - 0.06), (sx * hw, y1 - 0.12, z0 + 0.06)], 'glass', want=(sx, 0, 0))
        b.beam('dark', (sx * (hw + 0.01), y0 + 0.5, (z0 + z1) / 2), (sx * (hw + 0.01), y1 - 0.12, (z0 + z1) / 2), 0.03, 0.03)
    b.box('seat', -0.3, 0.3, y0 + 0.5, y0 + 1.2, 5.3, 5.55)
    b.box('dash', -0.35, 0.35, y0 + 0.5, y0 + 1.05, z0 + 0.1, z0 + 0.35)
    for sx in (-1, 1):
        vkit.headlight(b, (sx * 0.6, y1 + 0.08, z0 - 0.08), (0, -0.2, -1), r=0.07)
        vkit.headlight(b, (sx * 0.6, y1 + 0.08, z1 + 0.08), (0, -0.2, 1), r=0.07)
        vkit.mirror(b, (sx * (hw + 0.08), y1 - 0.4, z0 + 0.05), (sx * (hw + 0.35), y1 - 0.25, z0 - 0.1))
    b.cyl('dark', (0, y1, 5.6), (0, y1 + 0.06, 5.6), 0.1, 0.1, 10)
    b.cyl('lens_amber', (0, y1 + 0.06, 5.6), (0, y1 + 0.2, 5.6), 0.08, 0.07, 10)


def arm(v):
    a = Part(v, 'arm', pivot=PIN, joint=rot('x', 0.0, 1.15, stow=0.0, deploy=1.15, group='raise'))
    px, py, pz = PIN
    bx, by, bz = BPIN
    # twin lift arms (boxed, with a bend) and the cross tube
    for sx in (-1, 1):
        x = sx * 0.72
        mid = (x, (py + by) / 2 + 0.25, (pz + bz) / 2 + 0.1)
        a.beam('paint', (x, py, pz), mid, 0.16, 0.34)
        a.beam('paint', mid, (x, by + 0.05, bz + 0.12), 0.16, 0.34)
        a.cyl('dark', (sx * 0.6, py, pz), (sx * 0.84, py, pz), 0.12, 0.12, 10)
        a.cyl('dark', (sx * 0.62, by, bz), (sx * 0.86, by, bz), 0.1, 0.1, 10)
    a.cyl('paint', (-0.72, 1.5, 2.1), (0.72, 1.5, 2.1), 0.14, 0.14, 12)
    # Z-bar tilt linkage: the tilt cylinder on the cross tube, the bellcrank, the link to the bucket
    a.cyl('paint', (0, 1.6, 2.2), (0, 2.05, 2.95), 0.12, 0.12, 10)
    a.cyl('chrome', (0, 1.55, 2.12), (0, 1.35, 1.8), 0.06, 0.06, 8)
    a.beam('paint', (0, 1.85, 2.35), (0, 1.15, 1.55), 0.14, 0.22)
    a.beam('dark', (0, 1.15, 1.55), (0, 1.0, 1.05), 0.1, 0.12)
    # the bucket: back plate curved, side plates, cutting edge with teeth, wear strips
    hw = 1.5
    prof = [(1.05, 0.05), (0.0, 0.05), (-0.12, 0.12), (0.05, 0.25), (0.25, 0.75), (0.5, 1.1), (0.95, 1.25), (1.25, 1.1), (1.3, 0.55), (1.2, 0.25)]
    # (z, y) profile, outer shell; the open mouth faces −z/up
    shell = [(1.05, 0.05), (1.2, 0.25), (1.3, 0.55), (1.25, 1.1), (0.95, 1.25)]
    floor = [(0.0, 0.05), (1.05, 0.05)]
    for (za, ya), (zb, yb) in zip(shell, shell[1:]):
        a.face([(-hw, ya, za), (hw, ya, za), (hw, yb, zb), (-hw, yb, zb)], 'paint', want=(0, (za + zb) / 2 - 0.6, (za + zb) / 2 - 0.4))
        a.face([(-hw, ya, za - 0.06), (-hw, yb, zb - 0.06), (hw, yb, zb - 0.06), (hw, ya, za - 0.06)], 'dirt', want=(0, 0.6 - (za + zb) / 2, 0.4 - (za + zb) / 2))
    a.box('paint', -hw, hw, 0.0, 0.05, 0.0, 1.1)
    a.face([(-hw, 0.055, -0.02), (hw, 0.055, -0.02), (hw, 0.055, 1.02), (-hw, 0.055, 1.02)], 'dirt', want=(0, 1, 0))
    side = [(-0.18, 0.05), (1.05, 0.05), (1.2, 0.25), (1.3, 0.55), (1.25, 1.1), (0.95, 1.25), (0.55, 1.1), (0.1, 0.35)]
    for sx in (-1, 1):
        a.prism_x('paint', side, sx * hw - (0.04 if sx > 0 else 0), sx * hw + (0.04 if sx < 0 else 0) if sx < 0 else sx * hw)
    a.box('steel', -hw, hw, 0.0, 0.07, -0.22, 0.02)                                               # cutting edge
    for k in range(8):
        x = -hw + 0.15 + k * (2 * hw - 0.3) / 7
        a.box('steel', x - 0.05, x + 0.05, 0.01, 0.08, -0.36, -0.2)
    for sx in (-1, 1):
        a.box('dark', sx * 0.72 - 0.1, sx * 0.72 + 0.1, by - 0.15, by + 0.15, bz - 0.05, bz + 0.25)
    return a


def make():
    akit.setup_materials('blue_tan')
    v = Vehicle('loader', 'Wheel loader (rapid runway repair)', scheme='blue_tan')
    b = Part(v, 'body')
    front_frame(b)
    rear_frame(b)
    cab(b)
    usfam.wheels(v, None, AXLES, TRACK, R, W, RIM, steer={}, lugs=16, seg=20, nbolts=10, cti=False,
                 hub_skin='paint', rim_skin='paint', tread='chevron', rim_dish=0.08)
    a = arm(v)
    for sx, n in ((-1, 'ram_l'), (1, 'ram_r')):
        vkit.ram(v, n, b, (sx * 0.62, 1.05, 3.05), a, (sx * 0.62, 1.55, 2.25), r=0.1)
    return v
