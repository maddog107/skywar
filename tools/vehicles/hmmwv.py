# ═══════════════════════════════════════════════════════════════
# HMMWV (M1097A2 / M1113 heavy variant, two-door cab) — the chassis of cmd_blue, reusable for others.
# Game frame, z = distance aft of the front bumper face. Real size: 4.57 m long, 2.16 m wide, cab roof 1.78 m,
# wheelbase 3.30 m, track 1.82 m, 37×12.5R16.5 tyres (0.47 m radius). Proportions from the HMMWV + Sentinel side
# drawing and HMMWV photos on Wikimedia Commons (reference only).
# ═══════════════════════════════════════════════════════════════
import math
from mathutils import Vector
import vkit
from vkit import Part, rot, lerp
import blue

H = {
    'len': 4.57, 'half': 1.08, 'axles': (0.66, 3.96), 'track': 1.82, 'R': 0.47, 'W': 0.32, 'rim': 0.21,
    'sill': 0.62, 'belt': 1.28, 'roof': 1.78, 'cowl_z': 1.30, 'cab_rear': 2.36, 'bed': 1.1,
}


def arch_cut_box(b, skin, x0, x1, y0, y1, z0, z1, wz, wr, wy):
    """a side panel box with a round wheel-arch cut: built as vertical slices outside the arch"""
    # slices in z; below the arch curve the slice starts at the arch height
    n = 14
    zs = [z0] + [wz - wr + 2 * wr * i / n for i in range(n + 1)] + [z1]
    zs = sorted(set([min(max(z, z0), z1) for z in zs]))
    for i in range(len(zs) - 1):
        za, zb = zs[i], zs[i + 1]
        zm = (za + zb) / 2
        dz = zm - wz
        yb = y0
        if abs(dz) < wr:
            yb = max(y0, wy + math.sqrt(wr * wr - dz * dz))
        if yb >= y1 - 1e-4:
            continue
        b.box(skin, x0, x1, yb, y1, za, zb, skip=('nz', 'pz') if 0 < i < len(zs) - 2 else ())


def wheels(v, steer=True, skin='paint'):
    proto = None
    for i, z in enumerate(H['axles']):
        for side in (1, -1):
            name = 'wheel_%d%s' % (i + 1, 'r' if side > 0 else 'l')
            if proto is None:
                proto = Part(v, name, pivot=(side * H['track'] / 2, H['R'], z), local=True)
                blue.truck_wheel(proto, H['R'], H['W'], H['rim'], skin=skin, tread='chevron', nbolts=8, beadlock=True)
            else:
                Part(v, name, pivot=(side * H['track'] / 2, H['R'], z), local=True, rest_yaw=0.0 if side > 0 else math.pi, share=proto)
            v.meta['wheels'].append({'node': name, 'r': H['R'], 'steer': (1.0 if (i == 0 and steer) else 0), 'side': side})
    return proto


def front(b):
    """hood with integral fenders, grille, lamps, bumper, windscreen cowl"""
    hx = H['half']
    fz, cz = 0.10, H['cowl_z']
    wz, wr = H['axles'][0], H['R'] + 0.1
    # engine bay / lower front between the wheels (recessed behind the fender fronts: the grille sits in front of it)
    b.box('paint', -0.70, 0.70, 0.56, 1.02, fz + 0.12, cz)
    # hood: a wedge over the full width (sloping down to the front), fenders below its outer edges with arch cuts
    prof = [(fz + 0.04, 1.02), (fz + 0.04, 1.10), (fz + 0.12, 1.16), (cz, 1.30), (cz, 1.02)]
    b.prism_x('paint', prof, -hx, hx)
    for sx in (-1, 1):
        arch_cut_box(b, 'paint', min(sx * 0.70, sx * hx), max(sx * 0.70, sx * hx), 0.66, 1.02, fz + 0.04, cz, wz, wr, H['R'])
        # arch lining (dark) to hide the inside of the fender
        b.box('dark', min(sx * 0.70, sx * 0.72), max(sx * 0.70, sx * 0.72), 0.56, 1.02, wz - wr, wz + wr)
        # turn signal on the fender front, side marker on the fender side
        vkit.lamp_box(b, (sx * 0.9, 0.94, fz + 0.03), (0.13, 0.08, 0.04), (0, 0, -1), lens='lens_amber', skin='dark')
        vkit.lamp_box(b, (sx * (hx + 0.005), 0.96, fz + 0.3), (0.02, 0.05, 0.1), (sx, 0, 0), lens='lens_amber', skin='dark')
    # grille: a black panel across the recess, vertical slats in the middle, the headlights at its ends
    gz = fz + 0.115
    b.panel('black', [(-0.70, 0.62, gz), (0.70, 0.62, gz), (0.70, 1.02, gz), (-0.70, 1.02, gz)], (0, 0, -1), off=0.002)
    for i in range(8):
        x = lerp(-0.4, 0.4, i / 7)
        b.box('paint', x - 0.035, x + 0.035, 0.66, 1.0, gz - 0.03, gz)
    b.box('paint', -0.47, 0.47, 0.98, 1.02, gz - 0.03, gz)
    b.box('paint', -0.47, 0.47, 0.64, 0.68, gz - 0.03, gz)
    for sx in (-1, 1):
        vkit.headlight(b, (sx * 0.59, 0.87, gz - 0.005), (0, 0, -1), r=0.09, depth=0.03, skin_body='dark', lens='lens')
        vkit.lamp_box(b, (sx * 0.59, 0.7, gz - 0.02), (0.1, 0.05, 0.04), (0, 0, -1), lens='lens_amber', skin='dark')
    # hood air-intake louvre on the right of the cowl, hood latches
    b.panel('vents', [(0.2, 1.285, cz - 0.28), (0.85, 1.285, cz - 0.28), (0.85, 1.297, cz - 0.08), (0.2, 1.297, cz - 0.08)], (0, 1, 0.1), off=0.004)
    for sx in (-1, 1):
        b.box('dark', sx * 0.8, sx * 0.86, 1.12, 1.18, fz + 0.1, fz + 0.14)
    # bumper with tow shackles and the bumper number plate
    b.box('paint', -1.0, 1.0, 0.54, 0.7, -0.02, fz + 0.04, bev=0.015)
    for sx in (-1, 1):
        b.tube('dark', [(sx * 0.42, 0.56, -0.02), (sx * 0.42, 0.52, -0.08), (sx * 0.42, 0.6, -0.08), (sx * 0.42, 0.64, -0.02)], 0.014, 6)
    b.panel('white', [(-0.9, 0.58, -0.02), (-0.5, 0.58, -0.02), (-0.5, 0.66, -0.02), (-0.9, 0.66, -0.02)], (0, 0, -1), off=0.003)


def cab(b, v, door_parts=True):
    """two-door hard-top cab: body tub, windscreen, pillars, roof; the doors are separate parts (door_l, door_r)"""
    hx = 1.0
    z0, z1 = H['cowl_z'], H['cab_rear']
    s, bl, rf = H['sill'], H['belt'], H['roof']
    # tub below the belt line (the door parts cover the openings)
    b.box('paint', -hx, hx, s, bl, z0, z1)
    # windscreen frame (leaning back), roof, B-pillar, rear wall
    wz0, wz1 = z0, z0 + 0.13
    for sx in (-1, 1):
        b.beam('paint', (sx * 0.97, bl, wz0 + 0.02), (sx * 0.95, rf, wz1 + 0.02), 0.06, 0.05)      # A-pillar
        b.box('paint', sx * 0.93, sx * hx, bl, rf, z1 - 0.12, z1)                                   # B-pillar / rear corner
    b.box('paint', -hx, hx, bl, bl + 0.05, wz0 - 0.02, wz0 + 0.06)                                  # cowl top
    b.box('paint', -hx, hx, rf - 0.05, rf, wz1 - 0.02, z1, bev=0.02)                                # roof
    b.box('paint', -0.06, 0.06, bl, rf, wz0, wz1 + 0.02)                                             # centre post
    # windscreen: two flat panes
    for sx in (-1, 1):
        pts = [(sx * 0.07, bl + 0.05, wz0 + 0.03), (sx * 0.9, bl + 0.05, wz0 + 0.03), (sx * 0.9, rf - 0.06, wz1 - 0.01), (sx * 0.07, rf - 0.06, wz1 - 0.01)]
        n = Vector((0, 0.13, -(rf - bl))).normalized()
        b.face([tuple(p) for p in pts], 'glass', want=tuple(n))
        # wiper
        b.beam('black', (sx * 0.45, bl + 0.07, wz0 + 0.02), (sx * 0.3, bl + 0.35, wz0 + 0.08), 0.012, 0.008)
    # rear window of the cab (seen above the bed when there is no shelter)
    b.panel('glass', [(-0.7, bl + 0.1, z1), (0.7, bl + 0.1, z1), (0.7, rf - 0.1, z1), (-0.7, rf - 0.1, z1)], (0, 0, 1), off=0.004, frame=0.03)
    # interior seen through the windows / open doors: seats, dash, wheel
    b.box('dash', -0.95, 0.95, bl - 0.12, bl + 0.02, z0 + 0.02, z0 + 0.3)
    for sx in (-1, 1):
        b.box('seat', sx * 0.25, sx * 0.8, s + 0.3, s + 0.55, z1 - 0.6, z1 - 0.2)
        b.box('seat', sx * 0.25, sx * 0.8, s + 0.55, bl + 0.35, z1 - 0.3, z1 - 0.18)
    b.cyl('black', (-0.5, bl + 0.02, z0 + 0.42), (-0.5, bl + 0.08, z0 + 0.36), 0.17, 0.17, 12, cap0=False)
    for sx in (-1, 1):
        b.panel('interior', [(sx * hx, s + 0.02, z0 + 0.06), (sx * hx, s + 0.02, z1 - 0.12), (sx * hx, bl - 0.02, z1 - 0.12), (sx * hx, bl - 0.02, z0 + 0.06)], (sx, 0, 0), off=0.002)
    # mirrors on arms from the windscreen frame
    for sx in (-1, 1):
        vkit.mirror(b, (sx * 0.98, bl + 0.1, wz0 + 0.05), (sx * 1.24, bl + 0.14, wz0 - 0.02), (0.16, 0.22))
    if door_parts:
        for sx, name in ((-1, 'door_l'), (1, 'door_r')):
            hz0, hz1 = z0 + 0.06, z1 - 0.12
            x = sx * (hx + 0.012)
            j = rot('y', -1.3, 0.0, stow=0.0, deploy=-1.3, group='door') if sx < 0 else rot('y', 0.0, 1.3, stow=0.0, deploy=1.3, group='door')
            d = Part(v, name, pivot=(x, 1.2, hz0), joint=j)
            d.box('paint', x - 0.012, x + 0.012, s + 0.06, bl, hz0, hz1, bev=0.006)
            # window frame and glass above the belt
            for (za, zb, ya, yb) in ((hz0, hz0 + 0.05, bl, rf - 0.06), (hz1 - 0.05, hz1, bl, rf - 0.06), (hz0, hz1, rf - 0.1, rf - 0.06)):
                d.box('paint', x - 0.01, x + 0.01, ya, yb, za, zb)
            d.panel('glass', [(x, bl + 0.02, hz0 + 0.05), (x, bl + 0.02, hz1 - 0.05), (x, rf - 0.1, hz1 - 0.05), (x, rf - 0.1, hz0 + 0.05)], (sx, 0, 0), off=0.004)
            d.panel('glass', [(x, bl + 0.02, hz0 + 0.05), (x, bl + 0.02, hz1 - 0.05), (x, rf - 0.1, hz1 - 0.05), (x, rf - 0.1, hz0 + 0.05)], (-sx, 0, 0), off=0.004)
            vkit.grab_handle(d, (x + sx * 0.012, bl - 0.12, hz1 - 0.12), (0, 0, 1), (sx, 0, 0), 0.14, 0.03, 'dark')
            for y in (s + 0.2, bl - 0.1):
                d.cyl('dark', (x + sx * 0.015, y - 0.05, hz0 + 0.01), (x + sx * 0.015, y + 0.05, hz0 + 0.01), 0.018, 0.018, 6)


def rear(b, bed_top=None):
    """rear body: cargo bed tub with the rear wheel arches, rear bumper, lamps, pintle"""
    hx = H['half']
    z0, z1 = H['cab_rear'], H['len']
    wz, wr = H['axles'][1], H['R'] + 0.1
    top = bed_top or H['bed']
    b.box('paint', -0.72, 0.72, 0.56, top, z0, z1 - 0.1)
    for sx in (-1, 1):
        arch_cut_box(b, 'paint', min(sx * 0.72, sx * hx), max(sx * 0.72, sx * hx), 0.62, top, z0, z1 - 0.1, wz, wr, H['R'])
        b.box('dark', min(sx * 0.72, sx * 0.74), max(sx * 0.72, sx * 0.74), 0.56, 1.0, wz - wr, wz + wr)
        blue.tail_cluster(b, (sx * 0.86, 0.86, z1 - 0.09), (0, 0, 1), side=sx)
    # rear bumper and pintle
    b.box('paint', -1.0, 1.0, 0.56, 0.72, z1 - 0.12, z1, bev=0.012)
    b.box('dark', -0.08, 0.08, 0.6, 0.74, z1, z1 + 0.12)
    b.tube('dark', [(0, 0.66, z1 + 0.12), (0, 0.58, z1 + 0.2), (0, 0.7, z1 + 0.24)], 0.02, 6)
    # rocker / step between the wheels and the underbody
    for sx in (-1, 1):
        b.box('dark', sx * 0.98, sx * 1.04, 0.5, 0.58, H['axles'][0] + 0.6, H['axles'][1] - 0.6)
    b.face([(-0.9, 0.5, 0.2), (0.9, 0.5, 0.2), (0.9, 0.5, 4.4), (-0.9, 0.5, 4.4)], 'dark', want=(0, -1, 0))
    for z in H['axles']:
        b.box('dark', -0.3, 0.3, 0.3, 0.56, z - 0.2, z + 0.2, bev=0.03)                      # differential
        for sx in (-1, 1):
            b.beam('dark', (sx * 0.3, 0.42, z), (sx * 0.72, H['R'], z), 0.08, 0.08)           # half shaft / arm
