# ═══════════════════════════════════════════════════════════════
# Helpers for the blue-side vehicles (fork E: m270, sentinel, cmd_blue, stryker): tracked running gear
# (dual road wheels, toothed sprocket, spoked idler), US-pattern lamp clusters, louvred armour shutters,
# road wheels for trucks / trailers / APCs. Geometry in the game frame (see vkit.py).
# ═══════════════════════════════════════════════════════════════
import math
from mathutils import Vector
import vkit
from vkit import Part, lerp, vec


def dish(p, x0, facing, prof, seg=18, phase=0.0):
    """a disc / dish seen from `facing` (±1 along x), local coordinates (axle along x):
    prof = [(dx, r, skin), ...] from the rim inwards; dx < 0 recesses into the wheel. Faces face `facing`."""
    rings = []
    for (dx, r, sk) in prof:
        x = x0 + facing * dx
        rings.append(([(x, r * math.cos(phase + 2 * math.pi * i / seg), r * math.sin(phase + 2 * math.pi * i / seg)) for i in range(seg)], sk, r))
    for j in range(len(rings) - 1):
        A, sk, ra = rings[j]
        B, _, rb = rings[j + 1]
        for i in range(seg):
            k = (i + 1) % seg
            if rb < 1e-4:
                p.face([A[i], A[k], B[i]], sk, want=(facing, 0, 0))
            else:
                p.face([A[i], A[k], B[k], B[i]], sk, want=(facing, 0, 0))


def road_wheel(p, R, W, gap=0.08, tyre=0.045, skin='paint', nb=8):
    """a dual rubber-tyred road wheel in local coordinates (axle along x, outer face towards +x): two discs with
    rubber tyres either side of the gap the track's centre guides run in, a dished hub with bolts"""
    hw = W / 2
    seg = 18
    A, B = Vector((0, 1, 0)), Vector((0, 0, 1))
    for s in (1, -1):
        x_in, x_out = s * gap / 2, s * hw
        a, b = (x_in, x_out) if s > 0 else (x_out, x_in)
        # rubber tyre band
        p.cyl('rubber', (a, 0, 0), (b, 0, 0), R, R, seg, cap0=False, cap1=False)
        # tyre side wall and the dished steel disc on the outer face of each half, a flat disc on the gap side
        dish(p, x_out, s, [(0, R, 'rubber'), (0.0, R - tyre, skin), (-0.03, R * 0.55, skin), (-0.045, 0.0, skin)], seg)
        dish(p, x_in, -s, [(0, R, 'rubber'), (0.0, R - tyre, skin), (0.0, 0.0, skin)], seg)
    # hub cap and bolts on the outer face
    xo = hw - 0.05
    p.cyl('dark', (xo - 0.01, 0, 0), (xo + 0.035, 0, 0), R * 0.2, R * 0.16, 8, cap0=False)
    p.bolts('dark', (xo - 0.005, 0, 0), (1, 0, 0), R * 0.27, nb, rb=0.013, h=0.02, seg=5)
    for i in range(5):
        ang = 2 * math.pi * (i + 0.5) / 5
        c = Vector((xo - 0.018, math.cos(ang) * R * 0.47, math.sin(ang) * R * 0.47))
        p.disc('dark', c, (1, 0, 0), R * 0.075, 6)


def sprocket(p, R, W, teeth=11, skin='paint', gap=0.08):
    """a drive sprocket (local, axle along x): two toothed rings on a hub"""
    hw = W / 2
    seg = 22
    for s in (1, -1):
        xa, xb = s * gap / 2, s * (gap / 2 + 0.05)
        a, b = min(xa, xb), max(xa, xb)
        p.cyl(skin, (a, 0, 0), (b, 0, 0), R * 0.86, R * 0.86, seg)
        for i in range(teeth):
            ang = 2 * math.pi * i / teeth
            d = Vector((0, math.cos(ang), math.sin(ang)))
            t = Vector((0, -math.sin(ang), math.cos(ang)))
            c0 = d * (R * 0.84)
            c1 = d * R
            w0, w1 = R * 0.13, R * 0.06
            pts = [c0 - t * w0, c1 - t * w1, c1 + t * w1, c0 + t * w0]
            for x in (a, b):
                p.face([(x, q.y, q.z) for q in pts], 'steel', want=(1 if x == b else -1, 0, 0))
            for k in range(4):
                q0, q1 = pts[k], pts[(k + 1) % 4]
                out = (q0 + q1) / 2
                p.face([(a, q0.y, q0.z), (a, q1.y, q1.z), (b, q1.y, q1.z), (b, q0.y, q0.z)], 'steel', want=(0, out.y, out.z))
    # hub drum out to the side
    p.cyl(skin, (gap / 2 + 0.05, 0, 0), (hw, 0, 0), R * 0.42, R * 0.38, 14)
    p.cyl('dark', (hw, 0, 0), (hw + 0.03, 0, 0), R * 0.26, R * 0.2, 12)
    p.bolts('dark', (hw, 0, 0), (1, 0, 0), R * 0.3, 8, rb=0.012, h=0.02, seg=6)
    p.cyl(skin, (-gap / 2 - 0.05, 0, 0), (-hw * 0.8, 0, 0), R * 0.36, R * 0.36, 12)


def idler(p, R, W, skin='paint', gap=0.08, spokes=6):
    """a spoked idler (local, axle along x): two rims with spokes and a hub"""
    hw = W / 2
    seg = 22
    for s in (1, -1):
        xa, xb = s * gap / 2, s * hw * 0.8
        a, b = min(xa, xb), max(xa, xb)
        # rim ring (tube section)
        p.cyl('steel', (a, 0, 0), (b, 0, 0), R, R, seg, cap0=False, cap1=False)
        ring_o, ring_i = R, R * 0.8
        for x, nx in ((b, 1), (a, -1)):
            for i in range(seg):
                a0 = 2 * math.pi * i / seg
                a1 = 2 * math.pi * (i + 1) / seg
                q = [(x, ring_i * math.cos(a0), ring_i * math.sin(a0)), (x, ring_o * math.cos(a0), ring_o * math.sin(a0)),
                     (x, ring_o * math.cos(a1), ring_o * math.sin(a1)), (x, ring_i * math.cos(a1), ring_i * math.sin(a1))]
                p.face(q, skin, want=(nx, 0, 0))
        p.cyl(skin, (a, 0, 0), (b, 0, 0), ring_i, ring_i, seg, cap0=False, cap1=False)
        xm = (a + b) / 2
        for k in range(spokes):
            ang = 2 * math.pi * (k + 0.5) / spokes
            d = Vector((0, math.cos(ang), math.sin(ang)))
            p.beam(skin, Vector((xm, 0, 0)) + d * R * 0.2, Vector((xm, 0, 0)) + d * R * 0.82, 0.05, abs(b - a) * 0.8, up=(1, 0, 0))
        p.cyl(skin, (a, 0, 0), (b, 0, 0), R * 0.22, R * 0.22, 10)
    p.cyl('dark', (hw * 0.8, 0, 0), (hw * 0.8 + 0.03, 0, 0), R * 0.16, R * 0.12, 10)


def lamp_cluster(p, c, normal, side=1, marker=True):
    """US-pattern front lamp group: sealed-beam headlight in a guard, amber turn lamp, blackout marker"""
    c = vec(c)
    nr = Vector(normal).normalized()
    a, b = vkit.frame_from_axis(nr)
    right = Vector((1, 0, 0)) if abs(nr.x) < 0.5 else Vector((0, 0, 1))
    vkit.headlight(p, c, nr, r=0.085, depth=0.06, skin_body='dark', lens='lens')
    vkit.headlight(p, c - right * side * 0.2, nr, r=0.05, depth=0.05, skin_body='dark', lens='lens_amber')
    if marker:
        vkit.lamp_box(p, tuple(c + right * side * 0.17 + Vector((0, 0.02, 0))), (0.08, 0.06, 0.05) if abs(nr.z) > 0.5 else (0.05, 0.06, 0.08), tuple(nr), lens='lens_amber', skin='dark')
    # sheet-metal guard around the group
    g0 = c - right * side * 0.3 - Vector((0, 0.11, 0)) + nr * 0.005
    g1 = c + right * side * 0.26 + Vector((0, 0.11, 0)) + nr * 0.005
    p.beam('dark', (g0.x, g1.y, g0.z) if abs(nr.z) > 0.5 else (g0.x, g1.y, g0.z), (g1.x, g1.y, g1.z), 0.03, 0.02)


def tail_cluster(p, c, normal, side=1):
    """US rear lamp group: stop / tail (red), turn (amber), blackout"""
    c = vec(c)
    nr = Vector(normal).normalized()
    right = Vector((1, 0, 0))
    vkit.lamp_box(p, tuple(c), (0.2, 0.1, 0.05), tuple(nr), lens='lens_red', skin='dark')
    vkit.lamp_box(p, tuple(c + right * side * 0.16), (0.08, 0.1, 0.05), tuple(nr), lens='lens_amber', skin='dark')


def shutter(p, corners, normal, slats=6, skin='paint', depth=0.035, frame=0.03):
    """an armoured louvre shutter lying on a (possibly sloped) face: a raised frame and horizontal slats.
    corners: 4 points on the face (bottom-left, bottom-right, top-right, top-left)"""
    P = [vec(q) for q in corners]
    nr = Vector(normal).normalized()
    up = (P[3] - P[0])
    across = (P[1] - P[0])
    # dark recess behind the slats
    p.panel('black', [tuple(q) for q in P], nr, off=0.004)
    # frame
    for (q0, q1) in ((P[0], P[1]), (P[1], P[2]), (P[2], P[3]), (P[3], P[0])):
        p.beam(skin, q0 + nr * depth * 0.5, q1 + nr * depth * 0.5, frame, depth, up=tuple(nr))
    # slats: tilted strips across
    for i in range(slats):
        t0 = (i + 0.15) / slats
        t1 = (i + 0.85) / slats
        a0 = P[0] + up * t0 + nr * 0.008
        a1 = P[0] + up * t1 + nr * depth
        p.face([tuple(a0), tuple(a0 + across), tuple(a1 + across), tuple(a1)], skin, want=tuple(nr + up.normalized() * 0.2))


def truck_wheel(p, R, W, rim, skin='paint', tread='road', nbolts=10, beadlock=False):
    """a truck / APC wheel (local, outer face +x) — vkit.build_wheel with a US-style rim"""
    vkit.build_wheel(p, R, W, rim, lugs=20, seg=24, nbolts=nbolts, cti=False, hub_skin=skin, rim_skin=skin, tread=tread)
    if beadlock:
        hw = W / 2
        p.bolts('dark', (hw * 0.78 + 0.01, 0, 0), (1, 0, 0), rim * 0.9, 16, rb=0.01, h=0.015, seg=5)
