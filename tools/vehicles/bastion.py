# ═══════════════════════════════════════════════════════════════
# K-340P self-propelled launcher of the K-300P Bastion-P coastal missile system (two P-800 Oniks / Yakhont
# anti-ship missiles in transport-launch canisters) on the MZKT-7930 8×8.
#   blender -b -P tools/vehicles/build.py -- bastion
# References: MZKT-7930 12.67 × 3.07 m, cab roof 3.02 m; P-800 8.9 m × 0.7 m (canister ~9.3 m × 0.78 m);
# Wikimedia Commons photos (Rostov-on-Don 2014 parade rehearsal: front and side; the launcher with both canisters
# erected at the rear, bases near the ground, the lattice cradle on their front side).
# Rig: door_l / door_r (the housing's roof halves, gull-wing, group 'door'), erector (the cradle, rot x about the
# rear trunnions 0 → 90°, group 'raise'), canister_1/2 (children of the erector), muzzle_1/2 (front covers; −z along
# the launch direction, up when erected), jack_fl/fr/rl/rr, ram_l/ram_r, 8 wheels (two front axles steer),
# exhaust, seat_driver, hatch_entry. Sequence: openDoors(1) → deployJacks(1) → raise(1).
# ═══════════════════════════════════════════════════════════════
import math
from mathutils import Vector
import vkit
from vkit import Vehicle, Part, rot, slide, lerp
import mzkt

PIVOT = (0.0, 2.00, 10.20)      # cradle trunnions
CAN_Y = 2.46                    # canister axis height in travel
CAN_X = 0.44
CAN_R = 0.39
CAN_TOP, CAN_BOT = 2.62, 11.92  # canister ends (z) in travel: top (missile exit) forward
H_Z0, H_Z1 = 2.60, 11.60        # launcher housing
WALL_Y = 2.28                   # top of the housing's vertical walls
ROOF_Y = 3.12
HW = 1.50                       # housing half width


def housing_walls(b):
    """the static lower walls of the launcher housing, lockers, louvres over the engine, fittings"""
    for sx in (-1, 1):
        xo, xi = sx * HW, sx * (HW - 0.06)
        b.box('paint', min(xo, xi), max(xo, xi), 1.05, WALL_Y, H_Z0, H_Z1)
        # wheel arches: fenders over the pairs (the wall's lower edge sits above the tyres there)
        # engine air intakes (the engine lies under the canister tops, behind the cab)
        vkit.louvres(b, xo, 1.30, 2.05, H_Z0 + 0.25, H_Z0 + 1.35, 9, side=sx)
        # lockers along the housing side
        for (z0, z1) in ((4.75, 5.95), (6.25, 6.85), (9.55, 10.75)):
            for (p0, p1) in (((xo, 1.18, z0), (xo, 2.12, z0)), ((xo, 1.18, z1), (xo, 2.12, z1)), ((xo, 2.12, z0), (xo, 2.12, z1)), ((xo, 1.18, z0), (xo, 1.18, z1))):
                P0, P1 = Vector(p0), Vector(p1)
                w = Vector((0, 0.01, 0)) if abs((P1 - P0).y) < 0.1 else Vector((0, 0, 0.01))
                b.panel('black', [P0 - w, P1 - w, P1 + w, P0 + w], (sx, 0, 0), off=0.003)
            vkit.grab_handle(b, (xo + sx * 0.01, 1.65, z1 - 0.12), (0, 1, 0), (sx, 0, 0), 0.16, 0.03, 'dark')
        # grab rail and hinge line along the wall top (the roof halves hinge here)
        b.cyl('dark', (xo, WALL_Y, H_Z0 + 0.1), (xo, WALL_Y, H_Z1 - 0.1), 0.03, 0.03, 8)
        for z in range(4, 12, 2):
            b.box('dark', xo - 0.02 * sx, xo + 0.05 * sx, WALL_Y - 0.1, WALL_Y + 0.02, z - 0.08, z + 0.08)
    # front wall (behind the cab) and floor over the frame
    b.box('paint', -HW, HW, 1.05, WALL_Y, H_Z0, H_Z0 + 0.06)
    b.box('dark', -HW + 0.06, HW - 0.06, 1.05, 1.12, H_Z0, 10.0)


def roof_half(v, sx):
    """one gull-wing roof half: the sloped side panel and half of the flat top, hinged on the wall top"""
    name = 'door_r' if sx > 0 else 'door_l'
    hinge = (sx * HW, WALL_Y, 0.0)
    # rotate about ±z: the right half turns about −z (its top swings up and out to +x)
    j = rot([0, 0, -sx], 0.0, math.radians(125), group='door')
    d = Part(v, name, pivot=(hinge[0], hinge[1], (H_Z0 + H_Z1) / 2), joint=j)
    xs = sx * (HW - 0.47)                       # where the slope meets the flat top
    t = 0.05
    for (z0, z1) in ((H_Z0, H_Z1),):
        # outer skin: slope and top
        d.face([(sx * HW, WALL_Y, z0), (sx * HW, WALL_Y, z1), (xs, ROOF_Y, z1), (xs, ROOF_Y, z0)], 'paint', want=(sx * 0.87, 0.5, 0))
        d.face([(xs, ROOF_Y, z0), (xs, ROOF_Y, z1), (0.0, ROOF_Y, z1), (0.0, ROOF_Y, z0)], 'paint', want=(0, 1, 0))
        # inner skin (seen when open)
        d.face([(sx * (HW - t), WALL_Y + 0.02, z0), (sx * (HW - t), WALL_Y + 0.02, z1), (xs - sx * t * 0.5, ROOF_Y - t, z1), (xs - sx * t * 0.5, ROOF_Y - t, z0)], 'interior', want=(-sx * 0.87, -0.5, 0))
        d.face([(xs - sx * t * 0.5, ROOF_Y - t, z0), (xs - sx * t * 0.5, ROOF_Y - t, z1), (0.0, ROOF_Y - t, z1), (0.0, ROOF_Y - t, z0)], 'interior', want=(0, -1, 0))
        # end caps
        for z, s in ((z0, -1), (z1, 1)):
            d.face([(sx * HW, WALL_Y, z), (xs, ROOF_Y, z), (0.0, ROOF_Y, z), (0.0, ROOF_Y - t, z), (xs - sx * t * 0.5, ROOF_Y - t, z), (sx * (HW - t), WALL_Y + 0.02, z)], 'paint', want=(0, 0, s))
        # the centre seam (rubber)
        d.box('rubber', min(0, sx * 0.03), max(0, sx * 0.03), ROOF_Y - 0.02, ROOF_Y + 0.012, z0, z1)
    # stiffening ribs on the slope, a walkway strip on top, lifting eyes
    for z in (4.2, 6.0, 7.8, 9.6):
        d.beam('paint', (sx * (HW - 0.02), WALL_Y + 0.04, z), (xs + sx * 0.02, ROOF_Y - 0.02, z), 0.06, 0.03, up=(sx * 0.87, 0.5, 0))
    for z in (H_Z0 + 0.4, H_Z1 - 0.4):
        d.tube('dark', [(sx * 0.7, ROOF_Y, z - 0.06), (sx * 0.7, ROOF_Y + 0.06, z - 0.03), (sx * 0.7, ROOF_Y + 0.06, z + 0.03), (sx * 0.7, ROOF_Y, z + 0.06)], 0.012, 5)
    return d


def canister(v, parent, i, x):
    """a transport-launch canister (its own node, child of the cradle): body, end rings, front cover, rear cap"""
    c = Part(v, 'canister_%d' % i, pivot=(x, CAN_Y, CAN_BOT), parent=parent)
    p0 = Vector((x, CAN_Y, CAN_TOP))
    L = CAN_BOT - CAN_TOP
    prof = [(0.0, 0.0, 'paint'), (0.04, 0.22, 'paint'), (0.12, 0.34, 'paint'), (0.22, 0.40, 'dark'), (0.30, 0.43, 'dark'), (0.42, 0.43, 'paint'),
            (0.46, CAN_R, 'paint'), (L * 0.33, CAN_R, 'dark'), (L * 0.33 + 0.08, CAN_R, 'paint'), (L * 0.66, CAN_R, 'dark'),
            (L * 0.66 + 0.08, CAN_R, 'paint'), (L - 0.40, CAN_R, 'paint'), (L - 0.36, 0.43, 'dark'), (L - 0.06, 0.43, 'dark'), (L, 0.36, 'dark'), (L, 0.0, 'dark')]
    c.lathe(p0, (0, 0, 1), prof, n=20, smooth=True)
    # reinforcing bands and a cable duct along the top
    for f in (0.2, 0.45, 0.8):
        z = CAN_TOP + L * f
        c.lathe((x, CAN_Y, z - 0.04), (0, 0, 1), [(0, CAN_R + 0.018, 'dark'), (0.08, CAN_R + 0.018, 'dark')], n=20, smooth=True)
    c.beam('paint', (x, CAN_Y + CAN_R + 0.03, CAN_TOP + 0.6), (x, CAN_Y + CAN_R + 0.03, CAN_BOT - 0.6), 0.09, 0.06)
    for z in (CAN_TOP + 1.2, CAN_BOT - 1.4):
        c.tube('dark', [(x - 0.1, CAN_Y + CAN_R + 0.06, z), (x - 0.1, CAN_Y + CAN_R + 0.16, z), (x + 0.1, CAN_Y + CAN_R + 0.16, z), (x + 0.1, CAN_Y + CAN_R + 0.06, z)], 0.015, 5)
    # umbilical connector box on the rear end
    c.box('dark', x - 0.12, x + 0.12, CAN_Y - 0.15, CAN_Y + 0.15, CAN_BOT, CAN_BOT + 0.1)
    c.empty('muzzle_%d' % i, (x, CAN_Y, CAN_TOP - 0.02), (0, 0, -1))
    return c


def cradle(v):
    e = Part(v, 'erector', pivot=PIVOT, joint=rot('x', 0.0, math.pi / 2, group='raise'))
    y0, y1 = 1.90, 2.04
    for sx in (-1, 1):
        # longitudinal lattice beams under each canister, and the outer ones
        for xx in (sx * 0.16, sx * 0.72):
            e.box('paint', xx - 0.06, xx + 0.06, y0, y1, CAN_TOP + 0.5, PIVOT[2] + 0.4, bev=0.01)
        for k in range(8):
            za = lerp(CAN_TOP + 0.6, PIVOT[2] + 0.2, k / 8)
            zb = lerp(CAN_TOP + 0.6, PIVOT[2] + 0.2, (k + 1) / 8)
            e.beam('paint', (sx * 0.16, y0 + 0.07, za), (sx * 0.72, y0 + 0.07, zb), 0.05, 0.05)
    for k in range(9):
        z = lerp(CAN_TOP + 0.55, PIVOT[2] + 0.3, k / 8)
        e.box('paint', -0.72, 0.72, y0 + 0.01, y1 - 0.02, z - 0.04, z + 0.04)
    # clamp bands around both canisters (upper half hoops) at three stations
    for z in (CAN_TOP + 1.0, CAN_TOP + 4.6, CAN_BOT - 1.3):
        for sx in (-1, 1):
            ring = [(sx * CAN_X + math.cos(math.radians(a)) * (CAN_R + 0.03), CAN_Y + math.sin(math.radians(a)) * (CAN_R + 0.03), z) for a in range(-20, 205, 15)]
            e.tube('dark', ring, 0.022, 5)
            e.box('paint', sx * CAN_X - 0.3, sx * CAN_X + 0.3, y1 - 0.02, CAN_Y - 0.25, z - 0.06, z + 0.06)
    # the trunnion block and pivot tube at the rear end
    e.box('paint', -0.9, 0.9, PIVOT[1] - 0.16, y1, PIVOT[2] - 0.35, PIVOT[2] + 0.35, bev=0.03)
    e.cyl('dark', (-1.05, PIVOT[1], PIVOT[2]), (1.05, PIVOT[1], PIVOT[2]), 0.1, 0.1, 12)
    # hydraulic and cable lines
    for sx in (-1, 1):
        e.tube('hose', [(sx * 0.8, y1 - 0.03, CAN_TOP + 1.0), (sx * 0.8, y1 - 0.03, PIVOT[2] - 0.4), (sx * 0.95, PIVOT[1] + 0.05, PIVOT[2] - 0.15)], 0.014, 5)
    # ram brackets
    for sx in (-1, 1):
        e.box('dark', sx * 0.3 - 0.06, sx * 0.3 + 0.06, y0 - 0.14, y0, 9.05, 9.35)
    return e


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
    b.box('dark', x - sx * 0.1, sx * 0.9, y1 - 0.14, y1 - 0.02, z - 0.09, z + 0.09)


def rear(b):
    """rear section behind the frame: side boxes, the rear hood over the canister ends, lights, jacks"""
    z0, z1 = 10.0, 12.70
    for sx in (-1, 1):
        b.box('paint', sx * 0.92, sx * HW, 1.05, WALL_Y, H_Z1, z1)
        b.box('paint', sx * 0.92, sx * HW, 1.05, 1.12, z0, H_Z1)
    # the rear hood (the "doghouse"), open underneath for the canisters' bases
    prof = [(H_Z1, WALL_Y), (H_Z1, 3.46), (H_Z1 + 0.25, 3.60), (z1, 3.60), (z1, WALL_Y)]
    b.prism_x('paint', prof, -HW, HW, cap0=True, cap1=True)
    b.face([(-HW, WALL_Y, H_Z1), (HW, WALL_Y, H_Z1), (HW, WALL_Y, z1), (-HW, WALL_Y, z1)], 'dark', want=(0, -1, 0))
    # rear face details: door outline, ladder, lights, tow hook
    zr = z1
    for (p0, p1) in (((-0.55, 2.45, zr), (-0.55, 3.45, zr)), ((0.55, 2.45, zr), (0.55, 3.45, zr)), ((-0.55, 3.45, zr), (0.55, 3.45, zr)), ((-0.55, 2.45, zr), (0.55, 2.45, zr))):
        P0, P1 = Vector(p0), Vector(p1)
        w = Vector((0.012, 0, 0)) if abs((P1 - P0).x) < 0.1 else Vector((0, 0.012, 0))
        b.panel('black', [P0 - w, P1 - w, P1 + w, P0 + w], (0, 0, 1), off=0.003)
    vkit.ladder(b, 0.0, 0.5, 2.4, zr + 0.06, zr + 0.06, rungs=6)
    b.box('dark', -0.22, 0.22, 0.5, 0.56, zr, zr + 0.12)
    for sx in (-1, 1):
        vkit.lamp_box(b, (sx * 1.25, 1.35, zr + 0.02), (0.22, 0.1, 0.06), (0, 0, 1), lens='lens_red')
        vkit.lamp_box(b, (sx * 1.25, 1.22, zr + 0.02), (0.1, 0.08, 0.06), (0, 0, 1), lens='lens_amber')
    b.panel('white', [(-0.26, 1.2, zr), (0.26, 1.2, zr), (0.26, 1.36, zr), (-0.26, 1.36, zr)], (0, 0, 1), off=0.004)
    b.box('black', -1.45, 1.45, 0.95, 1.08, zr - 0.2, zr + 0.05)
    # trunnion bearings on the side boxes
    for sx in (-1, 1):
        b.box('dark', sx * 0.94, sx * 1.12, PIVOT[1] - 0.25, PIVOT[1] + 0.2, PIVOT[2] - 0.2, PIVOT[2] + 0.2)


def make():
    vkit.setup_materials('red_green')
    v = Vehicle('bastion', 'K-340P launcher, K-300P Bastion-P (SSC-5 Stooge)', scheme='red_green')
    b = Part(v, 'body')
    mzkt.build(v, b, 10.0)
    housing_walls(b)
    rear(b)
    # engine exhaust: a stack in the gap between the cab and the housing, right side, with a rain cap
    b.cyl('dark', (1.22, 1.9, 2.58), (1.22, 3.2, 2.58), 0.075, 0.075, 10)
    b.cyl('dark', (1.22, 3.2, 2.58), (1.22, 3.26, 2.5), 0.09, 0.08, 10)
    b.empty('exhaust', (1.22, 3.26, 2.5), (0, 0.6, -0.8))
    # fenders over the wheel pairs (the housing walls end above them)
    for sx in (-1, 1):
        for (z0, z1) in ((2.72, 4.75), (6.20, 9.85)):
            b.box('paint', sx * 0.88, sx * HW, 1.60, 1.66, z0, z1)
            b.box('rubber', sx * 0.95, sx * 1.46, 0.62, 1.60, z1 - 0.02, z1 + 0.01)
        jack_housing(b, sx * 1.36, 5.45, 0.95, 1.66)
        jack_housing(b, sx * 1.30, 12.35, 0.95, 1.9)
    for sx in (-1, 1):
        roof_half(v, sx)
    e = cradle(v)
    canister(v, e, 1, -CAN_X)
    canister(v, e, 2, CAN_X)
    for name, x, z, top in (('jack_fl', -1.36, 5.45, 1.62), ('jack_fr', 1.36, 5.45, 1.62), ('jack_rl', -1.30, 12.35, 1.86), ('jack_rr', 1.30, 12.35, 1.86)):
        jack(v, name, x, z, top, foot=0.45)
    for sx, n in ((-1, 'ram_l'), (1, 'ram_r')):
        vkit.ram(v, n, b, (sx * 0.30, 1.14, 8.2), e, (sx * 0.30, 1.90, 9.2), r=0.08)
    return v
