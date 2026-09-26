# ═══════════════════════════════════════════════════════════════
# Helpers for the red side's own-hull vehicles (osa.py, buk.py, btr80.py): corrugated missile-container packs,
# radar faces and lattice reflectors, wheel-arch skirts, vision blocks, smoke dischargers, road wheels.
# Game frame (x right, y up, z aft), world coordinates at the rest pose, like the rest of vkit.
# ═══════════════════════════════════════════════════════════════
import math
from mathutils import Vector
import vkit
from vkit import Part, lerp, vec


def corrugated_pack(p, x0, x1, y0, y1, z0, z1, n_cells=3, teeth=26, skin='paint', cap_skin='white', front_caps=True, rib=0.035):
    """a flat pack of n_cells missile containers side by side (x0..x1), lying along z (z0 = front / muzzle end):
    ribbed (sawtooth) top and bottom faces, plain sides, domed caps on the front ends, dark cells at the rear"""
    L = z1 - z0
    # sawtooth top and bottom: each tooth rises by `rib` over its first half and drops back
    for (y, s) in ((y1, 1), (y0, -1)):
        prev = None
        for i in range(teeth):
            za = z0 + L * i / teeth
            zb = z0 + L * (i + 0.5) / teeth
            zc = z0 + L * (i + 1) / teeth
            yt = y + s * rib
            p.face([(x0, y, za), (x1, y, za), (x1, yt, zb), (x0, yt, zb)], skin, want=(0, s, -0.3))
            p.face([(x0, yt, zb), (x1, yt, zb), (x1, y, zc), (x0, y, zc)], skin, want=(0, s, 0.3))
            # side triangles closing the teeth
            for (xe, sx) in ((x0, -1), (x1, 1)):
                p.face([(xe, y, za), (xe, yt, zb), (xe, y, zc)], skin, want=(sx, 0, 0))
    # plain side walls, ends
    p.box(skin, x0, x1, y0, y1, z0, z1, skip=('top', 'bottom'))
    w = (x1 - x0) / n_cells
    h = y1 - y0
    for c in range(n_cells):
        cx = x0 + w * (c + 0.5)
        cy = (y0 + y1) / 2
        r = min(w, h) * 0.42
        if front_caps:
            # domed cap on the front end
            p.lathe((cx, cy, z0 + 0.001), (0, 0, -1), [(0.0, r, cap_skin), (0.03, r * 0.96, cap_skin), (0.07, r * 0.7, cap_skin), (0.09, 0.0001, cap_skin)], n=12, smooth=True)
            p.disc('red', (cx, cy, z0 - 0.093), (0, 0, -1), r * 0.14, 6)
        # rear cell: a dark recess with a frame
        p.panel('black', [(cx - w * 0.4, cy - h * 0.38, z1), (cx + w * 0.4, cy - h * 0.38, z1), (cx + w * 0.4, cy + h * 0.38, z1), (cx - w * 0.4, cy + h * 0.38, z1)], (0, 0, 1), off=0.003)
    # longitudinal clamp bands around the pack
    for zb in (z0 + L * 0.12, z0 + L * 0.5, z0 + L * 0.88):
        p.box('dark', x0 - 0.012, x1 + 0.012, y0 - rib - 0.012, y1 + rib + 0.012, zb - 0.035, zb + 0.035)


def shield_plate(p, cx, cy, z, w, h, t=0.07, skin='paint', rim_skin='dark', notch=0.28):
    """the Osa tracking radar's front antenna: a flat plate facing -z, rounded bottom corners and a narrower top tab"""
    hw, hh = w / 2, h / 2
    pts = []
    # outline, counter-clockwise seen from the front (-z): start bottom-centre
    n = 6
    rc = hw * 0.55
    for i in range(n + 1):                       # bottom-right rounded corner
        a = -math.pi / 2 + (math.pi / 2) * i / n
        pts.append((cx + hw - rc + rc * math.cos(a), cy - hh + rc + rc * math.sin(a)))
    top = cy + hh
    tab = hw * 0.62
    pts += [(cx + hw, top - notch), (cx + tab, top - notch), (cx + tab * 0.92, top), (cx - tab * 0.92, top), (cx - tab, top - notch), (cx - hw, top - notch)]
    for i in range(n + 1):                       # bottom-left rounded corner
        a = math.pi + (math.pi / 2) * i / n
        pts.append((cx - hw + rc + rc * math.cos(a), cy - hh + rc + rc * math.sin(a)))
    p.prism_z(skin, pts, z, z + t, cap_skin=skin)
    # rim (a slightly bigger outline behind the plate)
    rim = [(cx + (x - cx) * 1.04, cy + (y - cy) * 1.03) for (x, y) in pts]
    p.prism_z(rim_skin, rim, z + t, z + t + 0.05)
    # bolts on the face
    for (bx, by) in ((-0.3, 0.35), (0.3, 0.35), (-0.36, -0.1), (0.36, -0.1), (0.0, 0.2), (0.0, -0.35), (-0.25, -0.38), (0.25, -0.38)):
        p.cyl('dark', (cx + bx * w, cy + by * h, z - 0.012), (cx + bx * w, cy + by * h, z), 0.018, 0.018, 6, cap1=False)
    return pts


def round_antenna(p, c, r, depth=0.3, skin='paint', drum_skin='paint'):
    """a round antenna facing -z: a flat face with a rim and a drum behind it"""
    c = vec(c)
    p.cyl(drum_skin, c + Vector((0, 0, 0.05)), c + Vector((0, 0, depth)), r * 0.93, r * 0.85, 16)
    p.cyl('dark', c + Vector((0, 0, 0.0)), c + Vector((0, 0, 0.06)), r * 1.02, r * 1.02, 16, cap0=False)
    p.disc(skin, c + Vector((0, 0, -0.002)), (0, 0, -1), r, 16)
    p.bolts('dark', c + Vector((0, 0, -0.002)), (0, 0, -1), r * 0.86, 10, rb=0.012, h=0.012, seg=5)


def lattice_reflector(p, c, width, height, depth, n_cols=7, n_rows=4, w=0.022, skin='paint', normal=(0, 0, -1)):
    """a curved open-lattice reflector (cylindrical, curving about the vertical) centred on c, opening towards
    `normal` (in the xz plane): horizontal arcs and vertical ribs as thin beams"""
    c = vec(c)
    nr = Vector(normal).normalized()
    side = Vector((0, 1, 0)).cross(nr).normalized()     # across the reflector
    up = Vector((0, 1, 0))

    def P(u, v):
        # u in [-1, 1] across, v in [-1, 1] up; the surface bows back by depth·u²
        return c + side * (u * width / 2) + up * (v * height / 2) - nr * (depth * u * u)
    rows = [lerp(-1, 1, j / (n_rows - 1)) for j in range(n_rows)]
    for v in rows:
        pts = [P(lerp(-1, 1, i / 10), v) for i in range(11)]
        for i in range(10):
            p.beam(skin, pts[i], pts[i + 1], w, w)
    for i in range(n_cols):
        u = lerp(-1, 1, i / (n_cols - 1))
        p.beam(skin, P(u, -1), P(u, 1), w, w)
    # diagonal bracing on the back
    p.beam(skin, P(-1, -1), P(0, 1), w * 0.8, w * 0.8)
    p.beam(skin, P(1, -1), P(0, 1), w * 0.8, w * 0.8)


def arch_skirt(p, x, y0, y1, z0, z1, arches, r, t=0.03, skin='paint', side=1):
    """a side plate (x = plane, thickness t outwards) from z0 to z1 between y0 and y1, cut by wheel arches
    (arches: [(z, y) wheel centres], radius r): the pieces between the arches as prisms"""
    cuts = sorted(arches)
    spans = []
    zs = z0
    for (zc, yc) in cuts:
        # where the arch circle crosses y1 (top of the skirt): half-width
        dy = y1 - yc
        hw = math.sqrt(max(0.0, r * r - dy * dy)) if abs(dy) < r else 0.0
        dy0 = y0 - yc
        hw0 = math.sqrt(max(0.0, r * r - dy0 * dy0)) if abs(dy0) < r else 0.0
        spans.append((zs, zc - max(hw, hw0), zc, yc))
        zs = zc + max(hw, hw0)
    spans.append((zs, z1, None, None))
    xa, xb = (x, x + side * t)
    for (za, zb, zc_next, yc_next) in spans:
        if zb - za < 0.05:
            continue
        prof = [(za, y0), (za, y1), (zb, y1), (zb, y0)]
        # follow the arch on the rear side of the span (the arch of the next wheel), and on the front (previous)
        p.prism_x(skin, arc_trim(prof, cuts, r), min(xa, xb), max(xa, xb))


def arc_trim(prof, cuts, r, n=8):
    """replace the straight vertical ends of a skirt piece with arcs of the adjacent wheel arches"""
    (za, y0), (_, y1), (zb, _), _ = prof
    pts = []
    # start at the bottom-front corner, go up the front end (arc of the wheel ahead, if any)
    front = [c for c in cuts if abs((c[0] + math.sqrt(max(0, r * r - (y1 - c[1]) ** 2))) - za) < 0.02 or abs((c[0] + math.sqrt(max(0, r * r - (y0 - c[1]) ** 2))) - za) < 0.02]
    back = [c for c in cuts if abs((c[0] - math.sqrt(max(0, r * r - (y1 - c[1]) ** 2))) - zb) < 0.02 or abs((c[0] - math.sqrt(max(0, r * r - (y0 - c[1]) ** 2))) - zb) < 0.02]
    if front:
        zc, yc = front[0]
        a0 = math.asin(max(-1, min(1, (y0 - yc) / r)))
        a1 = math.asin(max(-1, min(1, (y1 - yc) / r)))
        for i in range(n + 1):
            a = lerp(a0, a1, i / n)
            pts.append((zc + r * math.cos(a), yc + r * math.sin(a)))
    else:
        pts += [(za, y0), (za, y1)]
    if back:
        zc, yc = back[0]
        a0 = math.asin(max(-1, min(1, (y1 - yc) / r)))
        a1 = math.asin(max(-1, min(1, (y0 - yc) / r)))
        for i in range(n + 1):
            a = lerp(a0, a1, i / n)
            pts.append((zc - r * math.cos(a), yc + r * math.sin(a)))
    else:
        pts += [(zb, y1), (zb, y0)]
    return pts


def vision_block(p, c, normal, w=0.14, h=0.08, d=0.08, skin='paint'):
    """a periscope / vision block: a small armoured box with a glass face"""
    c = vec(c)
    nr = Vector(normal).normalized()
    a = Vector((0, 1, 0)).cross(nr)
    if a.length < 1e-6:
        a = Vector((1, 0, 0))
    a.normalize()
    b = nr.cross(a).normalized()
    corners = [c + a * sx * w / 2 + b * sy * h / 2 for (sx, sy) in ((-1, -1), (1, -1), (1, 1), (-1, 1))]
    back = [q - nr * d for q in corners]
    front = [q + nr * 0.004 for q in corners]
    for i in range(4):
        j = (i + 1) % 4
        mid = (corners[i] + corners[j]) / 2 - c
        p.face([tuple(back[i]), tuple(back[j]), tuple(corners[j]), tuple(corners[i])], skin, want=tuple(mid))
    p.face([tuple(q) for q in corners], skin, want=tuple(nr))
    p.panel('glass', [c + a * sx * w * 0.38 + b * sy * h * 0.32 for (sx, sy) in ((-1, -1), (1, -1), (1, 1), (-1, 1))], nr, off=0.006)


def smoke_dischargers(p, c, direction, n=3, spacing=0.14, r=0.045, length=0.25, skin='paint', fan=0.25):
    """a row of smoke-grenade tubes on a bracket, fanned slightly"""
    c = vec(c)
    d0 = Vector(direction).normalized()
    side = Vector((0, 1, 0)).cross(d0).normalized()
    p.box('dark', *(sorted([c.x - side.x * spacing * n / 2 - 0.03, c.x + side.x * spacing * n / 2 + 0.03]) if abs(side.x) > 0.5 else [c.x - 0.05, c.x + 0.05]),
          c.y - 0.06, c.y - 0.02,
          *(sorted([c.z - side.z * spacing * n / 2 - 0.03, c.z + side.z * spacing * n / 2 + 0.03]) if abs(side.z) > 0.5 else [c.z - 0.05, c.z + 0.05]))
    for i in range(n):
        k = (i - (n - 1) / 2)
        base = c + side * (k * spacing)
        d = (d0 + side * (k * fan * 0.3) + Vector((0, 0.35, 0))).normalized()
        p.cyl(skin, base, base + d * length, r, r, 8)
        p.disc('black', base + d * (length + 0.002), d, r * 0.8, 8)


def road_wheel(p, R, W, rim_skin='paint', tyre='rubber', dual=True, bolts=8):
    """a tracked vehicle's road wheel in local coordinates (axle along x, outer face +x): steel disc with a rubber tyre,
    dual (two discs with a gap for the guide horns) if dual"""
    halves = ((-W / 2, -0.03), (0.03, W / 2)) if dual else ((-W / 2, W / 2),)
    for (x0, x1) in halves:
        # rubber tyre band
        p.cyl(tyre, (x0, 0, 0), (x1, 0, 0), R, R, 20, cap0=False, cap1=False)
        # disc faces with a raised hub
        for (xf, s) in ((x0, -1), (x1, 1)):
            p.lathe((xf, 0, 0), (s, 0, 0), [(0.0, R, tyre), (0.0, R * 0.88, rim_skin), (0.015, R * 0.84, rim_skin), (0.015, R * 0.4, rim_skin), (0.05, R * 0.32, rim_skin), (0.05, 0.0001, rim_skin)], n=20, smooth=False)
    # hub cap and bolts on the outer face
    p.cyl('dark', (W / 2 + 0.05, 0, 0), (W / 2 + 0.09, 0, 0), R * 0.18, R * 0.14, 10, cap0=False)
    p.bolts('dark', (W / 2 + 0.05, 0, 0), (1, 0, 0), R * 0.26, bolts, rb=0.012, h=0.018, seg=5)
