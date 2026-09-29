# ═══════════════════════════════════════════════════════════════
# Soviet arch aircraft shelter ("arochnoye ukrytiye", the earth-covered arch shelters built on Warsaw Pact fighter
# bases from the late 1970s: Soviet fields in the GDR such as Finow and Gross Dölln, Polish and Czechoslovak bases).
#   blender -b -P tools/airbases/build.py -- has_red
# 26 m × 38 m × 9.4 m arch: a precast concrete vault buried under a grassed earth berm (~33 m wide at its foot), only the concrete portal
# showing at the front, with two outward-swinging steel gate leaves hinged on the portal piers; a small exhaust
# opening with a concrete blast wall at the back. References: photographs of the abandoned shelters at Finow
# (Eberswalde) and Gross Dölln (Wikimedia Commons, CC BY-SA, used for reference only), and the Wikipedia article
# "Hardened aircraft shelter".
# Frame: the gates face −Z, the aircraft sits at (0, 0, −3.5) facing out.
# Rig: door_l, door_r (rot y, 0 → ±100°, group 'door').
# ═══════════════════════════════════════════════════════════════
import math
import akit
from akit import Vehicle, Part, rot

CENTER = False
W, L, H = 26.0, 38.0, 9.4
Z0, Z1 = -L / 2, L / 2
DW, DH = 10.4, 7.2
N = 18


def prof(x, span, rise, p=2.0):
    u = min(1.0, abs(x) / (span / 2))
    return rise * (1 - u ** p) ** 0.5


def make():
    akit.setup_materials('red_green')
    v = Vehicle('has_red', 'Arch aircraft shelter', scheme='red_green')
    b = Part(v, 'shell')
    # ── the earth berm: a low, wide mound over the arch (flatter than the concrete inside), sloping to the ground
    # at the back; at the front it stops at the portal ──
    zf = Z0 + 1.6
    rings = []
    BW = W + 7.0                                                    # the berm spreads wider than the arch
    zs = [zf, zf + 5, 0, Z1 - 5, Z1 - 0.5, Z1 + 3.5, Z1 + 7.0]
    for z in zs:
        t = 1.0 if z <= Z1 - 0.5 else max(0.0, (Z1 + 7.0 - z) / 7.5)
        span = BW + 3.0 * (1 - t)
        rise = H * (0.12 + 0.88 * t ** 0.8)
        ring = []
        for i in range(N + 1):
            x = -span / 2 + span * i / N
            ring.append((x, prof(x, span, rise, 1.7), z))
        rings.append(ring)
    for j in range(len(rings) - 1):
        A, B = rings[j], rings[j + 1]
        for i in range(N):
            b.face([A[i], A[i + 1], B[i + 1], B[i]], 'earth', want=(A[i][0] + A[i + 1][0], 1.0, 0.3 if j >= 4 else 0), smooth=True)
    # the berm's face behind the portal: between the berm's profile and the vault's opening, strip by strip
    sp0 = rings[0][-1][0] - rings[0][0][0]
    xs = [-sp0 / 2 + sp0 * i / 48 for i in range(49)]
    for i in range(48):
        xa, xb = xs[i], xs[i + 1]
        ya, yb = prof(xa, sp0, H * 1.0, 1.7), prof(xb, sp0, H * 1.0, 1.7)
        ia = prof(xa, W - 2.8, H - 1.2, 2.2) if abs(xa) < W / 2 - 1.4 else 0.0
        ib = prof(xb, W - 2.8, H - 1.2, 2.2) if abs(xb) < W / 2 - 1.4 else 0.0
        b.face([(xa, ia, zf), (xa, ya, zf), (xb, yb, zf), (xb, ib, zf)], 'earth', want=(0, 0, -1))
    # the inner vault (concrete), seen through the open gates
    Ti = 1.4
    inn = [(x, prof(x, W - 2 * Ti, H - 1.2, 2.2)) for x in [-(W / 2 - Ti) + (W - 2 * Ti) * i / N for i in range(N + 1)]]
    zr = Z1 - 1.0
    for k in range(N):
        (ax, ay), (bx, by) = inn[k], inn[k + 1]
        b.quad((ax, ay, zf), (bx, by, zf), (bx, by, zr), (ax, ay, zr), 'concrete', want=(-(ax + bx), -(ay + by), 0), smooth=True)
    b.face([(-(W / 2 - Ti), 0, zr)] + [(x, y, zr) for x, y in inn] + [(W / 2 - Ti, 0, zr)], 'concrete', want=(0, 0, -1))
    b.face([(-W / 2 + Ti, 0.03, zf), (W / 2 - Ti, 0.03, zf), (W / 2 - Ti, 0.03, zr), (-W / 2 + Ti, 0.03, zr)], 'concrete', want=(0, 1, 0))
    for z in (-10, 0, 10):
        for x in (-5.5, 5.5):
            y = prof(x, W - 2 * Ti, H - 1.2, 2.2) - 0.05
            b.box('lamp_glow', x - 0.5, x + 0.5, y - 0.1, y, z - 0.12, z + 0.12)
    # ── the portal: a thick concrete frame with piers, a lintel, and sloping wing walls holding the berm back ──
    zp0, zp1 = Z0, zf
    cols = [(-W / 2 + W * i / 36) for i in range(37)]
    for i in range(36):
        xa, xb = cols[i], cols[i + 1]
        ya, yb = prof(xa, W, H, 2.6) + 0.3, prof(xb, W, H, 2.6) + 0.3
        bot = DH if (abs(xa) < DW + 1e-6 and abs(xb) < DW + 1e-6) else 0.0
        for z, n in ((zp0, -1), (zp1, 1)):
            b.face([(xa, bot, z), (xb, bot, z), (xb, yb, z), (xa, ya, z)], 'concrete', want=(0, 0, n))
        b.face([(xa, ya, zp0), (xb, yb, zp0), (xb, yb, zp1), (xa, ya, zp1)], 'concrete', want=(0, 1, 0))
    for s in (-1, 1):
        b.face([(s * DW, 0, zp0), (s * DW, DH, zp0), (s * DW, DH, zp1), (s * DW, 0, zp1)], 'concrete', want=(-s, 0, 0))
    b.face([(-DW, DH, zp0), (DW, DH, zp0), (DW, DH, zp1), (-DW, DH, zp1)], 'concrete', want=(0, -1, 0))
    for s in (-1, 1):
        # piers (the gate hinges hang on them) and the splayed wing walls
        b.box('concrete', s * DW, s * (DW + 1.6), 0, DH + 0.9, Z0 - 1.0, Z0 + 0.2, bev=0.06)
        b.prism_z('concrete', [(s * (W / 2 - 0.4), 0), (s * (W / 2 + 3.5), 0), (s * (W / 2 + 3.5), 0.8), (s * (W / 2 - 0.4), 4.2)], Z0 - 0.2, Z0 + 0.6)
        # the gate stop blocks out on the apron
        b.box('concrete', s * (DW + 0.2) - 0.4, s * (DW + 0.2) + 0.4, 0, 0.5, Z0 - 11.6, Z0 - 10.8)
    # the lintel's number and a red lamp over the gates
    b.box('white', -1.4, 1.4, DH + 0.6, DH + 1.4, Z0 - 0.03, Z0)
    b.box('red', -0.9, -0.1, DH + 0.7, DH + 1.3, Z0 - 0.04, Z0 - 0.03)
    b.box('red', 0.1, 0.9, DH + 0.7, DH + 1.3, Z0 - 0.04, Z0 - 0.03)
    b.box('lens_red', -0.25, 0.25, DH + 1.6, DH + 1.9, Z0 - 0.3, Z0)
    # ── the back: the exhaust tunnel through the berm (a concrete box), its louvred mouth and a blast wall ──
    b.box('concrete', -3.6, 3.6, 0, 4.8, Z1 - 1.5, Z1 + 6.6, skip=('bottom',))
    b.box('dark', -2.6, 2.6, 1.0, 3.8, Z1 + 6.6, Z1 + 6.62)
    for k in range(5):
        b.box('steelplate', -2.6, 2.6, 1.2 + k * 0.55, 1.3 + k * 0.55, Z1 + 6.62, Z1 + 6.8)
    b.prism_x('concrete', [(Z1 + 10.4, 0), (Z1 + 11.4, 0), (Z1 + 11.4, 0.4), (Z1 + 10.9, 4.6), (Z1 + 10.4, 4.6)], -4.6, 4.6)
    # a ventilation stack poking out of the berm
    b.cyl('concrete', (7.0, H * 0.72, 8.0), (7.0, H * 0.72 + 1.6, 8.0), 0.5, 0.5, 10)
    b.cyl('dark', (7.0, H * 0.72 + 1.6, 8.0), (7.0, H * 0.72 + 2.0, 8.0), 0.65, 0.65, 10)
    # ── the gate leaves: steel frames with vertical corrugations, hinged on the piers ──
    for side, name in ((-1, 'door_l'), (1, 'door_r')):
        hx = side * DW
        j = rot('y', 0, 1.75, stow=0, deploy=1.75, group='door') if side < 0 else rot('y', -1.75, 0, stow=0, deploy=-1.75, group='door')
        d = Part(v, name, pivot=(hx, 0, Z0 - 0.35), joint=j)
        x0, x1 = (hx, -0.02) if side < 0 else (0.02, hx)
        d.box('steelplate', x0, x1, 0.1, DH - 0.05, Z0 - 0.6, Z0 - 0.1)
        n = 12
        for k in range(n):
            xx = x0 + (x1 - x0) * (k + 0.5) / n
            d.box('steelplate', xx - 0.14, xx + 0.14, 0.2, DH - 0.2, Z0 - 0.72, Z0 - 0.6)
        for y in (0.35, DH / 2, DH - 0.35):
            d.box('dark', x0, x1, y - 0.15, y + 0.15, Z0 - 0.76, Z0 - 0.6)
        for y in (1.2, DH - 1.2):
            d.cyl('dark', (hx, y - 0.4, Z0 - 0.35), (hx, y + 0.4, Z0 - 0.35), 0.16, 0.16, 8)
        # the red star on each leaf
        cx = (x0 + x1) / 2
        pts = []
        for k in range(10):
            r = 0.9 if k % 2 == 0 else 0.36
            a = math.pi / 2 + k * math.pi / 5
            pts.append((cx + r * math.cos(a), 4.2 + r * math.sin(a), Z0 - 0.78))
        for k in range(10):
            d.face([(cx, 4.2, Z0 - 0.78), pts[k], pts[(k + 1) % 10]], 'red', want=(0, 0, -1))
    return v
