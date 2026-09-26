# ═══════════════════════════════════════════════════════════════
# Ural-4320 cargo truck carrying ammunition: the standard dropside body with wooden-slatted side boards, the tilt
# (canvas tent) on five bows with its rear flap rolled up, the tailgate, stacked ammunition crates.
#   blender -b -P tools/vehicles/build.py -- ammo_red
# Reference: Mick Bell's Ural-4320 cargo 4-view (CC BY 4.0, Wikimedia Commons): body 3.9 m long, sides to 2.02 m,
# tilt to 3.0 m; Russian Army Ural-4320 photos.
# Rig: door_tail (the tailgate, rot x at the floor's rear edge, 0 → 90° down, group 'door'), 6 wheels, exhaust,
# seat_driver, hatch_entry.
# ═══════════════════════════════════════════════════════════════
import math
from mathutils import Vector
import vkit
from vkit import Vehicle, Part, rot, lerp
import ural
from ural import URAL

Z0, Z1 = 3.43, 7.25          # body front / rear
HX = 1.25                    # half width (2.5 m over the body)
FLOOR = 1.38
SIDE_TOP = 2.02
TILT = 2.98


def tilt(b, z0, z1, hx, y0, y1, skin='canvas_green', rear_open=True):
    """the canvas tent over the body: sides, a gently arched roof sagging between the bows, tie-down loops,
    a rolled-up rear flap"""
    bows = [z0 + 0.07 + i * (z1 - z0 - 0.14) / 4 for i in range(5)]
    arch = 0.08
    xs = [-hx, -hx * 0.96, -hx * 0.6, 0.0, hx * 0.6, hx * 0.96, hx]
    def roof_y(x):
        return y1 - 0.05 + arch * (1 - (x / hx) ** 2)
    # roof + sides as one surface per bay, sagging a little between the bows
    zs = []
    for i in range(len(bows) - 1):
        for t in (0.0, 0.5):
            zs.append(lerp(bows[i], bows[i + 1], t))
    zs = [z0] + zs[1:] + [bows[-1], z1]
    prof = [(-hx, y0)] + [(x, roof_y(x)) for x in xs[1:-1]] + [(hx, y0)]
    prof[1] = (-hx, y1 - 0.12)
    prof[-2] = (hx, y1 - 0.12)
    rings = []
    for j, z in enumerate(zs):
        sag = 0.0
        for i in range(len(bows) - 1):
            if bows[i] < z < bows[i + 1]:
                sag = 0.035
        r = []
        for (x, y) in prof:
            if y > y0 + 0.2:
                r.append((x * (1 - sag * 0.4), y - sag, z))
            else:
                r.append((x * (1 - sag * 0.15), y, z))
        rings.append(r)
    b.loft(skin, rings, closed=False, smooth=True)
    # front end of the tent (closed)
    b.face([(x, y, z0) for (x, y) in prof], skin, want=(0, 0, -1))
    # bows visible as seams on the roof, the side rope rail with tie-down loops
    for z in bows:
        b.tube('canvas', [(-hx - 0.012, y0 + 0.05, z), (-hx - 0.012, y1 - 0.12, z), (0, y1 + arch - 0.045, z), (hx + 0.012, y1 - 0.12, z), (hx + 0.012, y0 + 0.05, z)], 0.012, 4)
    for sx in (-1, 1):
        b.tube('cable', [(sx * (hx + 0.015), y0 + 0.04, z0 + 0.02), (sx * (hx + 0.015), y0 + 0.04, z1 - 0.02)], 0.01, 4)
        for k in range(12):
            z = lerp(z0 + 0.15, z1 - 0.15, k / 11)
            b.box('dark', sx * (hx + 0.005), sx * (hx + 0.02), y0 - 0.08, y0 + 0.05, z - 0.012, z + 0.012)
        # small side windows in the tent (celluloid) near the front
        b.panel('glass', [(sx * (hx + 0.004), y1 - 0.45, z0 + 0.35), (sx * (hx + 0.004), y1 - 0.45, z0 + 0.65), (sx * (hx + 0.004), y1 - 0.25, z0 + 0.65), (sx * (hx + 0.004), y1 - 0.25, z0 + 0.35)], (sx, 0, 0), off=0.003, frame=0.02, frame_skin='canvas')
    if rear_open:
        # the rear flap rolled up under the roof edge, with its straps
        b.cyl(skin, (-hx + 0.05, y1 - 0.2, z1 + 0.06), (hx - 0.05, y1 - 0.2, z1 + 0.06), 0.1, 0.1, 10)
        for x in (-0.7, 0.0, 0.7):
            b.tube('cable', [(x, y1 - 0.08, z1 + 0.0), (x, y1 - 0.2, z1 + 0.17), (x, y1 - 0.32, z1 + 0.06)], 0.01, 4)
        # the rear frame above the opening
        b.face([(x, y, z1) for (x, y) in prof if y > y1 - 0.2] + [(hx, y1 - 0.2, z1), (-hx, y1 - 0.2, z1)][:0], skin, want=(0, 0, 1))


def crates(b, z0, z1, hx, y0, rows_high=4):
    """ammunition crates stacked in the body: wooden boxes with rope handles, some painted green"""
    cw, ch, cd = 0.62, 0.26, 0.40      # crate size (x, y, z)
    k = 0
    nx = int((2 * hx - 0.1) // (cw + 0.02))
    x0 = -((nx * (cw + 0.02)) - 0.02) / 2
    z = z1 - 0.1 - cd
    while z > z0 + 0.8:
        for row in range(rows_high if z > z1 - 1.3 else rows_high - 1):
            for i in range(nx):
                x = x0 + i * (cw + 0.02)
                y = y0 + row * (ch + 0.005)
                skin = 'olive' if (k * 7 + row) % 3 else 'wood'
                b.box(skin, x, x + cw, y, y + ch, z, z + cd, bev=0.012)
                # lid battens and the rope handles on the visible (rear) face
                b.box('dark' if skin == 'olive' else 'rust', x + 0.04, x + cw - 0.04, y + ch * 0.45, y + ch * 0.55, z + cd, z + cd + 0.006)
                if z > z1 - 1.0:
                    for hx_ in (x + 0.12, x + cw - 0.12):
                        b.tube('canvas', [(hx_ - 0.05, y + ch * 0.7, z + cd + 0.006), (hx_, y + ch * 0.62, z + cd + 0.03), (hx_ + 0.05, y + ch * 0.7, z + cd + 0.006)], 0.008, 4)
                k += 1
        z -= cd + 0.02


def build_tailgate(v, z1, hx, y0, y1):
    d = Part(v, 'door_tail', pivot=(0, y0, z1), joint=rot('x', 0.0, math.pi / 2, group='door'))
    d.box('paint', -hx + 0.02, hx - 0.02, y0, y1, z1 - 0.045, z1)
    for k in range(3):
        y = y0 + 0.12 + k * 0.2
        d.box('paint', -hx + 0.05, hx - 0.05, y, y + 0.05, z1, z1 + 0.015)
    for x in (-0.9, -0.3, 0.3, 0.9):
        d.box('dark', x - 0.03, x + 0.03, y0 + 0.02, y1 - 0.02, z1, z1 + 0.02)
    for sx in (-1, 1):
        # latches at the top corners and the hinge knuckles on the floor edge
        d.box('dark', sx * (hx - 0.12), sx * (hx - 0.02), y1 - 0.1, y1 - 0.02, z1, z1 + 0.04)
        d.cyl('dark', (sx * 0.7, y0, z1 - 0.02), (sx * 0.5, y0, z1 - 0.02), 0.03, 0.03, 8)
    # boarding steps hung on the tailgate
    for y in (y0 + 0.15, y0 + 0.4):
        d.box('dark', -0.25, 0.25, y, y + 0.03, z1 + 0.015, z1 + 0.12)
    return d


def make():
    vkit.setup_materials('red_green')
    v = Vehicle('ammo_red', 'Ural-4320 cargo truck (ammunition)', scheme='red_green')
    b = Part(v, 'body')
    ural.ural(v, b)
    ural.cargo_bed(b, Z0, Z1, hx=HX, y0=URAL['bed'], y1=FLOOR, sides=SIDE_TOP - FLOOR, skip_rear=True)
    ural.rear_fenders(b, 4.25, 6.85, y=URAL['bed'])
    ural.rear_end(b, URAL['len'])
    tilt(b, Z0, Z1, HX, SIDE_TOP, TILT)
    crates(b, Z0, Z1, HX - 0.06, FLOOR)
    build_tailgate(v, Z1, HX, FLOOR, SIDE_TOP)
    return v
