# ═══════════════════════════════════════════════════════════════
# NATO third-generation hardened aircraft shelter (TAB-V, "Theater Air Base Vulnerability" programme, built across
# USAFE / RAF / Luftwaffe bases 1976–85).
#   blender -b -P tools/airbases/build.py -- has_nato
# Outer 26 m wide × 38 m long × 9.4 m high: a reinforced-concrete barrel vault on a slab (the TAB-V is about
# 82 ft × 124 ft × 30 ft outside), a vertical front headwall with a 21 m × 7.4 m opening closed by two sliding
# steel-and-concrete door leaves that roll sideways on ground rails into guide frames either side of the shell, and a
# rear wall with the jet-exhaust port and its deflector. References: the TAB-V drawings in the USAF Hardened Aircraft
# Shelter survey (HAER) photos of RAF Upper Heyford / Bentwaters / Hahn shelters (public domain, Library of Congress
# HAER, e.g. HAER UK-1), and the Wikipedia article "Hardened aircraft shelter".
# Frame: the door faces −Z, the aircraft sits at (0, 0, −3.5) facing out.
# Rig: door_l, door_r (slide ∓x 11.3 m, group 'door').
# ═══════════════════════════════════════════════════════════════
import math
import akit
from akit import Vehicle, Part, slide

CENTER = False
W, L, H = 26.0, 38.0, 9.4
Z0, Z1 = -L / 2, L / 2          # the front (door) end, the rear
T = 0.9                          # shell thickness
DW, DH = 10.6, 7.4               # the opening's half width, its height
N = 20


def arch_y(x, span, rise):
    """the vault's profile: a half-ellipse, slightly pointed (the TAB-V is a near-circular arch on low walls)"""
    u = min(1.0, abs(x) / (span / 2))
    return rise * (1 - u ** 2.2) ** 0.5


def make():
    akit.setup_materials('blue_green')
    v = Vehicle('has_nato', 'Hardened aircraft shelter (TAB-V)', scheme='blue_green')
    b = Part(v, 'shell')
    # ── the vault: outer, inner, and the front and rear rings ──
    xs = [-W / 2 + W * i / N for i in range(N + 1)]
    xi = [-(W / 2 - T) + (W - 2 * T) * i / N for i in range(N + 1)]
    out = [(x, arch_y(x, W, H)) for x in xs]
    inn = [(x, arch_y(x, W - 2 * T, H - T)) for x in xi]
    zf, zr = Z0 + 1.2, Z1 - 0.8                                        # vault between the headwall and the rear wall
    for k in range(N):
        (ax, ay), (bx, by) = out[k], out[k + 1]
        b.quad((ax, ay, zf), (bx, by, zf), (bx, by, zr), (ax, ay, zr), 'concrete', want=(ax + bx, ay + by + 0.01, 0), smooth=True)
        (ax, ay), (bx, by) = inn[k], inn[k + 1]
        b.quad((ax, ay, zf), (bx, by, zf), (bx, by, zr), (ax, ay, zr), 'concrete', want=(-(ax + bx), -(ay + by), 0), smooth=True)
    # the vault's ridge joints (expansion joints every 6 m: a slightly raised band)
    for z in (-12.0, -6.0, 0.0, 6.0, 12.0):
        for k in range(N):
            (ax, ay), (bx, by) = out[k], out[k + 1]
            s = 1.012
            b.quad((ax * s, ay * s + 0.02, z - 0.15), (bx * s, by * s + 0.02, z - 0.15), (bx * s, by * s + 0.02, z + 0.15), (ax * s, ay * s + 0.02, z + 0.15), 'concrete', want=(ax + bx, ay + by + 0.01, 0))
    # footing walls along the sides (the vault springs from a low plinth)
    for s in (-1, 1):
        b.box('concrete', s * (W / 2 - 0.4), s * (W / 2 + 0.5), 0, 1.1, zf, zr, skip=('bottom',))
    # floor slab
    b.face([(-W / 2 + T, 0.03, zf), (W / 2 - T, 0.03, zf), (W / 2 - T, 0.03, zr), (-W / 2 + T, 0.03, zr)], 'concrete', want=(0, 1, 0))
    # ── the front headwall: a thick vertical wall shaped to the arch, the door opening cut out, with pilasters ──
    zh0, zh1 = Z0 + 0.1, zf
    cols = [(-W / 2 + W * i / 40) for i in range(41)]
    for i in range(40):
        xa, xb = cols[i], cols[i + 1]
        ya, yb = arch_y(xa, W, H) + 0.25, arch_y(xb, W, H) + 0.25
        bot = DH if (abs(xa) < DW + 1e-6 and abs(xb) < DW + 1e-6) else 0.0
        for z, n in ((zh0, -1), (zh1, 1)):
            b.face([(xa, bot, z), (xb, bot, z), (xb, yb, z), (xa, ya, z)], 'concrete', want=(0, 0, n))
        b.face([(xa, ya, zh0), (xb, yb, zh0), (xb, yb, zh1), (xa, ya, zh1)], 'concrete', want=(0, 1, 0))
    for s in (-1, 1):
        # the jambs, the sides
        b.face([(s * DW, 0, zh0), (s * DW, DH, zh0), (s * DW, DH, zh1), (s * DW, 0, zh1)], 'concrete', want=(-s, 0, 0))
        b.face([(s * W / 2, 0, zh0), (s * W / 2, arch_y(W / 2, W, H) + 0.25, zh0), (s * W / 2, 0.25, zh1), (s * W / 2, 0, zh1)], 'concrete', want=(s, 0, 0))
    b.face([(-DW, DH, zh0), (DW, DH, zh0), (DW, DH, zh1), (-DW, DH, zh1)], 'concrete', want=(0, -1, 0))
    # ── door guide frames outside the shell: a concrete buttress at each end of the rail, the overhead track beam ──
    zr0, zr1 = Z0 - 1.9, Z0 + 0.1
    for s in (-1, 1):
        b.box('concrete', s * 23.6, s * 25.0, 0, 8.6, zr0 - 0.4, zr1, bev=0.08)                     # end buttress
        b.box('concrete', s * 12.6, s * 13.6, 0, 8.6, zr0 - 0.4, zr1, bev=0.08)                     # shell buttress
        b.box('steelplate', s * 10.0, s * 25.0, 7.7, 8.3, zr0 + 0.1, zr0 + 0.7)                          # guide beam
        b.box('steelplate', s * 13.6, s * 23.6, 7.9, 8.1, zr0 + 0.7, zr1 - 0.2)
    b.box('steelplate', -10.0, 10.0, 7.7, 8.3, zr0 + 0.1, zr0 + 0.7)
    # ground rails and the apron sill
    for z in (zr0 + 0.35, zr0 + 1.25):
        b.box('dark', -25.0, 25.0, 0.0, 0.08, z - 0.06, z + 0.06, skip=('bottom',))
    b.box('concrete', -25.0, 25.0, 0.0, 0.05, zr0 - 1.0, zr1, skip=('bottom',))
    # warning stripes on the buttresses (yellow / black at wingtip height)
    for s in (-1, 1):
        for k in range(5):
            y = 0.4 + k * 0.5
            b.box('yellow' if k % 2 == 0 else 'black', s * 12.58, s * 13.62, y, y + 0.5, zr0 - 0.41, zr0 - 0.39)
    # shelter number plate over the door, floodlight brackets, a door-control box
    b.box('white', -1.6, 1.6, DH + 0.5, DH + 1.4, zh0 - 0.03, zh0)
    b.box('black', -1.2, -0.2, DH + 0.6, DH + 1.3, zh0 - 0.04, zh0 - 0.03)
    b.box('black', 0.2, 1.2, DH + 0.6, DH + 1.3, zh0 - 0.04, zh0 - 0.03)
    for s in (-1, 1):
        b.box('dark', s * 6.0 - 0.3, s * 6.0 + 0.3, DH + 0.9, DH + 1.3, zh0 - 0.7, zh0)
        b.box('lens', s * 6.0 - 0.26, s * 6.0 + 0.26, DH + 0.92, DH + 1.0, zh0 - 0.72, zh0 - 0.1)
    b.box('grey', 12.0, 12.5, 1.0, 2.2, zr0 - 0.9, zr0 - 0.4, bev=0.03)
    # interior: lights along the vault, the refuel pit and tie-downs, a workbench and the environmental unit
    for z in (-12, -4, 4, 12):
        for x in (-5, 5):
            y = arch_y(x, W - 2 * T, H - T) - 0.05
            b.box('lamp_glow', x - 0.6, x + 0.6, y - 0.12, y, z - 0.15, z + 0.15)
    b.box('dark', -0.8, 0.8, 0.03, 0.05, 4.5, 5.5)
    b.box('grey', 8.4, 10.2, 0.03, 1.0, 10.0, 15.0, bev=0.03)
    b.box('grey', -10.4, -8.4, 0.03, 2.2, 12.0, 16.0, bev=0.05)
    # ── the rear wall with the exhaust port and its deflector ──
    zw0, zw1 = zr - 0.4, Z1
    for i in range(40):
        xa, xb = cols[i], cols[i + 1]
        ya, yb = arch_y(xa, W, H), arch_y(xb, W, H)
        port = abs(xa) < 2.6 + 1e-6 and abs(xb) < 2.6 + 1e-6
        for z, n in ((zw0, -1), (zw1, 1)):
            if port:
                b.face([(xa, 0, z), (xb, 0, z), (xb, 1.4, z), (xa, 1.4, z)], 'concrete', want=(0, 0, n))
                b.face([(xa, 4.4, z), (xb, 4.4, z), (xb, yb, z), (xa, ya, z)], 'concrete', want=(0, 0, n))
            else:
                b.face([(xa, 0, z), (xb, 0, z), (xb, yb, z), (xa, ya, z)], 'concrete', want=(0, 0, n))
        b.face([(xa, ya, zw0), (xb, yb, zw0), (xb, yb, zw1), (xa, ya, zw1)], 'concrete', want=(0, 1, 0))
    for s in (-1, 1):
        b.face([(s * 2.6, 1.4, zw0), (s * 2.6, 4.4, zw0), (s * 2.6, 4.4, zw1), (s * 2.6, 1.4, zw1)], 'concrete', want=(-s, 0, 0))
        b.face([(s * W / 2, 0, zw0), (s * W / 2, 0.01, zw0), (s * W / 2, 0.01, zw1), (s * W / 2, 0, zw1)], 'concrete', want=(s, 0, 0))
    b.face([(-2.6, 1.4, zw0), (2.6, 1.4, zw0), (2.6, 1.4, zw1), (-2.6, 1.4, zw1)], 'concrete', want=(0, 1, 0))
    b.face([(-2.6, 4.4, zw0), (2.6, 4.4, zw0), (2.6, 4.4, zw1), (-2.6, 4.4, zw1)], 'concrete', want=(0, -1, 0))
    # louvres in the port, the blast deflector (an inclined concrete hood outside it)
    for k in range(6):
        y = 1.6 + k * 0.5
        b.box('dark', -2.55, 2.55, y, y + 0.08, zw1 - 0.5, zw1 - 0.2)
    b.prism_x('concrete', [(Z1, 0), (Z1 + 4.2, 0), (Z1 + 4.2, 0.6), (Z1 + 0.6, 6.0), (Z1, 6.0)], -3.4, 3.4)
    b.prism_x('concrete', [(Z1, 0), (Z1 + 3.0, 0), (Z1 + 3.0, 0.6), (Z1, 4.6)], -3.6, -3.4)
    b.prism_x('concrete', [(Z1, 0), (Z1 + 3.0, 0), (Z1 + 3.0, 0.6), (Z1, 4.6)], 3.4, 3.6)
    # rear personnel door with its blast wall
    b.box('steelplate', 7.0, 8.2, 0.05, 2.2, Z1, Z1 + 0.05)
    b.box('concrete', 6.2, 9.0, 0.0, 2.6, Z1 + 1.6, Z1 + 2.0)
    # ── the door leaves: steel box girder frames skinned in plate, filled with concrete (~0.9 m thick), on bogies ──
    for side, name in ((-1, 'door_l'), (1, 'door_r')):
        x0, x1 = (-DW - 0.4, 0.02) if side < 0 else (-0.02, DW + 0.4)
        d = Part(v, name, pivot=((x0 + x1) / 2, 0, zr0 + 0.8), joint=slide('x' if side > 0 else '-x', 11.3, group='door'))
        d.box('steelplate', x0, x1, 0.12, DH + 0.35, zr0 + 0.35, zr0 + 1.25, bev=0.04)
        # ribs and the top roller housing
        for k in range(5):
            xx = x0 + (x1 - x0) * (k + 0.5) / 5
            d.box('steelplate', xx - 0.12, xx + 0.12, 0.3, DH + 0.2, zr0 + 0.27, zr0 + 0.35)
        for y in (1.6, 4.0, 6.4):
            d.box('steelplate', x0 + 0.1, x1 - 0.1, y - 0.1, y + 0.1, zr0 + 0.27, zr0 + 0.35)
        d.box('dark', x0 + 0.2, x1 - 0.2, DH + 0.35, DH + 0.55, zr0 + 0.55, zr0 + 1.05)
        for k in range(3):
            xx = x0 + (x1 - x0) * (k + 0.5) / 3
            d.box('dark', xx - 0.4, xx + 0.4, 0.0, 0.2, zr0 + 0.2, zr0 + 1.4)
        # the stencil stripe along the meeting edge
        e = x1 if side < 0 else x0
        d.box('yellow', e - 0.15, e + 0.15, 0.3, DH, zr0 + 0.25, zr0 + 0.27)
    return v
