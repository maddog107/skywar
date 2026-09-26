# ═══════════════════════════════════════════════════════════════
# Naval building blocks on top of shipkit.py (runs inside Blender), shared by the
# destroyer, cruiser, submarine, supply ship, boats and the red navy scripts.
# Game frame as in shipkit: x starboard, y up (0 = waterline), z aft (bow −z).
#  • rig nodes: named objects with extras "rig" (JSON) that src/naval.js turns into
#    the ship's rig (see tools/ships/RIG.md): doors/hatches (hinge + angle), masts
#    and elevators (slide + travel), empties for cells, seats and nozzles.
#  • hull lofting, cambered decks, guard rails, deckhouses with sloped sides.
#  • fittings: Mk 41 VLS modules (with rigged cell doors), Phalanx, Mk 45, Mk 38,
#    Harpoon, Mk 32 torpedo tubes, SPG-62, SPY-1 faces, radomes, life rafts, boats.
# Dimensions are the real ones in metres (sources in the ship scripts / RIG.md).
# ═══════════════════════════════════════════════════════════════
import bpy, math, json
from mathutils import Vector, Quaternion
from shipkit import Part, V, clamp, lerp, smoothstep, point_in_poly

# ═════════════ rig nodes ═════════════
def rig_node(name, data, loc, parent=None, rot=None, spec=None):
    """object `name` holding mesh `data` (or an empty if None) at game-frame `loc`.
    rot: (game axis, angle) or a list of them, applied in order. spec: the rig extras naval.js reads."""
    ob = bpy.data.objects.new(name, data)
    bpy.context.collection.objects.link(ob)
    ob.location = V(loc)
    if rot:
        q = Quaternion((1.0, 0.0, 0.0, 0.0))
        for axis, ang in (rot if isinstance(rot, list) else [rot]):
            q = Quaternion(V(axis).normalized(), ang) @ q
        ob.rotation_mode = 'QUATERNION'
        ob.rotation_quaternion = q
    if parent is not None:
        ob.parent = parent
    if spec is not None:
        ob['rig'] = json.dumps(spec, separators=(',', ':'))
    if data is None:
        ob.empty_display_size = 0.3
    return ob

def point(name, loc, parent, rot=None, t='point', **extra):
    """an empty rig point (seat, nozzle, muzzle, hatch_entry, missile cell…)"""
    return rig_node(name, None, loc, parent, rot, dict(t=t, **extra))

def hinged(part, name, hinge_pt, parent, axis, angle, rot=None):
    """a door/hatch node from a Part modelled in ship coordinates: pivot at hinge_pt, turns about its
    local `axis` by `angle` radians when fully open (k = 1)"""
    return rig_node(name, part.mesh(origin=hinge_pt), hinge_pt, parent, rot, {'t': 'door', 'hinge': list(axis), 'open': round(angle, 4)})

def sliding(part, name, origin, parent, axis, travel, t='mast'):
    """a mast / elevator node: moves `travel` metres along its local `axis` at k = 1"""
    return rig_node(name, part.mesh(origin=origin), origin, parent, None, {'t': t, 'slide': list(axis), 'travel': round(travel, 4)})

# ═════════════ hull ═════════════
def loft_hull(part, TS, NS, keel, sheer, stem_z, stern_z, hb, mat='Hull', uvf=None, bottom=True, transom=True):
    """Hull surface: rows at fractions TS of the height keel → sheer line, NS stations cosine-spaced from the stem
    (s = 0) to the stern (s = 1), mirrored to port. sheer(z) = deck-edge height, stem_z(y) / stern_z(y) = where
    the hull ends at height y, hb(s, y, z) = half-breadth. Returns the starboard grid [row][station] = (x, y, z)."""
    grid = []
    for t in TS:
        row = []
        for i in range(NS):
            s = 0.5 - 0.5 * math.cos(math.pi * i / (NS - 1))
            y = keel + t * (sheer(0.0) - keel)
            for _ in range(3):
                z0, z1 = stem_z(y), stern_z(y)
                z = z0 + s * (z1 - z0)
                y = keel + t * (sheer(z) - keel)
            row.append((hb(s, y, z), y, z))
        grid.append(row)
    g = part.g(mat)
    uv = (lambda q: [uvf(*p) for p in q]) if uvf else (lambda q: None)
    for k in range(len(TS) - 1):
        for i in range(NS - 1):
            a, b, c, d = grid[k][i], grid[k][i + 1], grid[k + 1][i + 1], grid[k + 1][i]
            for sg in (1, -1):
                q = [(sg * p[0], p[1], p[2]) for p in (a, b, c, d)]
                g.face(q, uv(q), (sg, 0, 0), True)
        if transom:
            a, d = grid[k][-1], grid[k + 1][-1]
            q = [(-a[0], a[1], a[2]), (a[0], a[1], a[2]), (d[0], d[1], d[2]), (-d[0], d[1], d[2])]
            g.face(q, uv(q), (0, 0, 1), True)
    if bottom:
        for i in range(NS - 1):
            a, b = grid[0][i], grid[0][i + 1]
            q = [(-a[0], a[1], a[2]), (a[0], a[1], a[2]), (b[0], b[1], b[2]), (-b[0], b[1], b[2])]
            g.face(q, uv(q), (0, -1, 0), True)
    return grid

def outline_at(grid, y, step=2):
    """(x, z) outline where the hull crosses height y: starboard bow → stern, then port stern → bow"""
    wl = []
    NS = len(grid[0])
    idx = list(range(0, NS, step))
    if idx[-1] != NS - 1:
        idx.append(NS - 1)
    for i in idx:
        col = [grid[k][i] for k in range(len(grid))]
        for k in range(len(col) - 1):
            (x0, y0, z0), (x1, y1, z1) = col[k], col[k + 1]
            if y0 <= y <= y1:
                t = (y - y0) / (y1 - y0) if y1 != y0 else 0
                wl.append((round(x0 + (x1 - x0) * t, 2), round(z0 + (z1 - z0) * t, 2)))
                break
    return wl + [(-x, z) for x, z in reversed(wl)]

def half_width(grid, z, y):
    """hull half-width at (z, y), from the nearest station"""
    NS = len(grid[0])
    i = min(range(NS), key=lambda i: abs(grid[-1][i][2] - z))
    col = [grid[k][i] for k in range(len(grid))]
    for k in range(len(col) - 1):
        (x0, y0, _), (x1, y1, _) = col[k], col[k + 1]
        if y0 <= y <= y1:
            return x0 + (x1 - x0) * ((y - y0) / (y1 - y0) if y1 != y0 else 0)
    return col[-1][0]

def edge_at(top, z):
    """deck-edge (x, y) at z, interpolated along the hull's top row"""
    for a, b in zip(top, top[1:]):
        if a[2] <= z <= b[2]:
            t = (z - a[2]) / (b[2] - a[2]) if b[2] != a[2] else 0
            return a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t
    p = top[0] if z < top[0][2] else top[-1]
    return p[0], p[1]

def deck_strip(part, top, camber, mat='Deck', uvf=None, z0=-1e9, z1=1e9, holes=()):
    """cambered deck along the hull's top row: each pair of stations → quads from the deck edge to the
    centreline. holes: [(half_width, z0, z1)] openings centred on the centreline (a VLS launcher sits in one)."""
    def y_at(x, zp, ea, eb):
        """deck height at |x| on the section interpolated at zp between stations ea and eb"""
        t = (zp - ea[2]) / (eb[2] - ea[2]) if eb[2] != ea[2] else 0.0
        xe = ea[0] + (eb[0] - ea[0]) * t
        ye = ea[1] + (eb[1] - ea[1]) * t
        return xe, ye + camber * (1 - min(abs(x) / xe, 1.0) if xe > 1e-6 else 1.0)
    for a, b in zip(top, top[1:]):
        if b[2] <= z0 or a[2] >= z1:
            continue
        cuts = sorted(set([a[2], b[2]] + [z for h in holes for z in (h[1], h[2]) if a[2] < z < b[2]]))
        for zs, ze in zip(cuts, cuts[1:]):
            zm = (zs + ze) / 2
            hw = max([h[0] for h in holes if h[1] <= zm <= h[2]] or [0.0])
            xe_s, _ = y_at(0, zs, a, b)
            xe_e, _ = y_at(0, ze, a, b)
            spans = [(0.0, 1.0)] if hw <= 0 else [(min(hw / max(xe_s, 1e-6), 1.0), 1.0)]
            for sg in (1, -1):
                for (f0, f1) in spans:
                    # corners at fraction f of the local half-width (so the quads follow the deck edge)
                    def P(f, zp, xe):
                        x = hw if (f0 > 0 and f == f0) else f * xe
                        _, y = y_at(x, zp, a, b)
                        return (sg * x, y, zp)
                    q = [P(f1, zs, xe_s), P(f1, ze, xe_e), P(f0, ze, xe_e), P(f0, zs, xe_s)]
                    part.g(mat).face(q, [uvf(*p) for p in q] if uvf else None, (0, 1, 0))

# ═════════════ structure ═════════════
def deckhouse(part, xh0, xh1, y0, y1, z0, z1, mat='Super', chamfer_front=0.0, chamfer_back=0.0, xc=0.0, top=True, roof_mat=None):
    """deckhouse with inward-sloping sides (stealth shaping) and optional 45° corner chamfers; xh0/xh1 =
    half-widths at the bottom / top. Returns the bottom and top rings."""
    def ring(xh, y, ch_f, ch_b):
        return [(xc - xh + ch_f, y, z0), (xc + xh - ch_f, y, z0), (xc + xh, y, z0 + ch_f), (xc + xh, y, z1 - ch_b),
                (xc + xh - ch_b, y, z1), (xc - xh + ch_b, y, z1), (xc - xh, y, z1 - ch_b), (xc - xh, y, z0 + ch_f)]
    sc = xh1 / xh0
    r0 = ring(xh0, y0, chamfer_front, chamfer_back)
    r1 = ring(xh1, y1, chamfer_front * sc, chamfer_back * sc)
    cz = (z0 + z1) / 2
    for i in range(8):
        j = (i + 1) % 8
        q = [r0[i], r0[j], r1[j], r1[i]]
        if abs(q[0][0] - q[1][0]) < 1e-6 and abs(q[0][2] - q[1][2]) < 1e-6:
            continue
        mx = (r0[i][0] + r0[j][0]) / 2 - xc; mz = (r0[i][2] + r0[j][2]) / 2
        part.g(mat).face(q, None, (mx, 0.15, mz - cz))
    if top:
        part.g(roof_mat or mat).face(r1, None, (0, 1, 0))
    return r0, r1

def rail(part, pts, h=1.0, step=1.8, mat='Dark', wires=(0.5, 1.0), post=0.045, wire=0.03, closed=False):
    """guard rail on a polyline of deck points: stanchions every `step` m (and at the ends), wires at `wires` × h"""
    P = [tuple(p) for p in pts]
    if closed:
        P = P + [P[0]]
    if len(P) < 2:
        return
    acc = step
    for a, b in zip(P, P[1:]):
        seg = math.dist(a, b)
        if seg < 1e-6:
            continue
        t = (step - acc) / seg if acc < step else 0.0
        while t <= 1.0 + 1e-9:
            p = [a[k] + (b[k] - a[k]) * t for k in range(3)]
            part.beam(mat, tuple(p), (p[0], p[1] + h, p[2]), post, caps=False)
            t += step / seg
        acc = (1.0 - (t - step / seg)) * seg
        for f in wires:
            part.beam(mat, (a[0], a[1] + h * f, a[2]), (b[0], b[1] + h * f, b[2]), wire, caps=False)
    if not closed:
        b = P[-1]
        part.beam(mat, b, (b[0], b[1] + h, b[2]), post, caps=False)

def ladder(part, p0, p1, w=0.7, mat='Dark', rung=0.3):
    """inclined ladder / stair from p0 (bottom centre) to p1 (top centre), stringers across x"""
    for sx in (-w / 2, w / 2):
        part.beam(mat, (p0[0] + sx, p0[1], p0[2]), (p1[0] + sx, p1[1], p1[2]), 0.06, 0.12)
    n = max(2, int(math.dist(p0, p1) / rung))
    for k in range(1, n):
        t = k / n
        c = [p0[i] + (p1[i] - p0[i]) * t for i in range(3)]
        part.beam(mat, (c[0] - w / 2, c[1], c[2]), (c[0] + w / 2, c[1], c[2]), 0.04, caps=False)

def wdoor(part, x, y, z, face, w=0.8, h=1.9, mat='Dark'):
    """watertight door (dark panel, slightly proud) on a wall facing `face` ('+x', '-x', '+z', '-z')"""
    o = 0.03
    if face in ('+x', '-x'):
        sg = 1 if face == '+x' else -1
        q = [(x + sg * o, y, z - w / 2), (x + sg * o, y, z + w / 2), (x + sg * o, y + h, z + w / 2), (x + sg * o, y + h, z - w / 2)]
        part.g(mat).face(q, None, (sg, 0, 0))
    else:
        sg = 1 if face == '+z' else -1
        q = [(x - w / 2, y, z + sg * o), (x + w / 2, y, z + sg * o), (x + w / 2, y + h, z + sg * o), (x - w / 2, y + h, z + sg * o)]
        part.g(mat).face(q, None, (0, 0, sg))

def portholes(part, x, y, z0, z1, n, face, r=0.22, mat='Glass'):
    """a row of n square-ish ports on a hull/house side (x = const)"""
    sg = 1 if face == '+x' else -1
    for k in range(n):
        z = z0 + (z1 - z0) * (k + 0.5) / n
        q = [(x + sg * 0.02, y - r, z - r), (x + sg * 0.02, y - r, z + r), (x + sg * 0.02, y + r, z + r), (x + sg * 0.02, y + r, z - r)]
        part.g(mat).face(q, None, (sg, 0, 0))

# ═════════════ deck fittings ═════════════
def bollard(part, x, y, z, mat='Dark'):
    """double bitt"""
    for dz in (-0.35, 0.35):
        part.cyl(mat, (x, 0, z + dz), 0.14, 0.14, y, y + 0.45, 8)
        part.cyl(mat, (x, 0, z + dz), 0.19, 0.19, y + 0.45, y + 0.5, 8)
    part.box(mat, x - 0.25, x + 0.25, y, y + 0.06, z - 0.6, z + 0.6)

def raft(part, c, along='z', L=1.55, r=0.34, mat='White', band='Dark'):
    """25-person life-raft canister (white GRP, two strap bands) centred at c"""
    x, y, z = c
    if along == 'z':
        part.cyl(mat, (x, y, 0), r, r, z - L / 2, z + L / 2, 10, axis='z')
        for dz in (-L * 0.28, L * 0.28):
            part.cyl(band, (x, y, 0), r + 0.015, r + 0.015, z + dz - 0.04, z + dz + 0.04, 10, axis='z', cap0=False, cap1=False)
    else:
        part.cyl(mat, (0, y, z), r, r, x - L / 2, x + L / 2, 10, axis='x')
        for dx in (-L * 0.28, L * 0.28):
            part.cyl(band, (0, y, z), r + 0.015, r + 0.015, x + dx - 0.04, x + dx + 0.04, 10, axis='x', cap0=False, cap1=False)

def raft_rack(part, x, y, z, n=2, along='z', side=1, mat='White', frame='Super'):
    """n canisters side by side on an inclined cradle (tilted outboard, as on USN ships); x = inboard edge"""
    tilt = 0.28
    for k in range(n):
        if along == 'z':
            cx = x + side * (0.4 + k * 0.72)
            cy = y + 0.45 - side * 0.0 + (0.72 * k) * -tilt * 0.3
            raft(part, (cx, y + 0.45, z), 'z', mat=mat)
        else:
            cz = z + side * (0.4 + k * 0.72)
            raft(part, (x, y + 0.45, cz), 'x', mat=mat)
    if along == 'z':
        xa, xb = sorted((x, x + side * (0.1 + n * 0.72)))
        for dz in (-0.55, 0.55):
            part.box(frame, xa, xb, y, y + 0.12, z + dz - 0.05, z + dz + 0.05)
    else:
        za, zb = sorted((z, z + side * (0.1 + n * 0.72)))
        for dx in (-0.55, 0.55):
            part.box(frame, x + dx - 0.05, x + dx + 0.05, y, y + 0.12, za, zb)

def radome(part, x, y, z, r, mat='White', ped='Super', ped_h=0.8):
    part.cyl(ped, (x, 0, z), r * 0.35, r * 0.35, y, y + ped_h, 8)
    part.sphere(mat, (x, y + ped_h + r * 0.85, z), r, r, r, 14, 8)

def whip(part, x, y, z, h, mat='Dark', r=0.05):
    part.cyl(mat, (x, 0, z), r, r * 0.4, y, y + h, 5, cap0=False)

# ═════════════ weapons and sensors (turret origin = base centre; guns point −z) ═════════════
def phalanx(part, o, mat='White', dark='Dark'):
    """Mk 15 Phalanx CIWS Block 1B: pedestal, barbette, the radome ("R2-D2") with the search dome on top and the
    track antenna below, the M61 gun cluster in its shroud forward, FLIR box on the port side. ~4.7 m tall."""
    x, y, z = o
    part.cyl(mat, (x, 0, z), 1.0, 1.1, y, y + 0.55, 14)
    part.box(mat, x - 0.95, x + 0.95, y + 0.55, y + 1.75, z - 0.75, z + 1.25)
    part.box(mat, x - 0.62, x + 0.62, y + 1.75, y + 1.95, z - 0.2, z + 1.2)
    # the radome column and its dome
    part.cyl(mat, (x, 0, z + 0.45), 0.72, 0.72, y + 1.95, y + 3.85, 16, cap1=False)
    part.sphere(mat, (x, y + 3.85, z + 0.45), 0.72, 0.62, 0.72, 16, 6, v0=0.5, v1=1.0)
    part.cyl(dark, (x, 0, z + 0.45), 0.735, 0.735, y + 2.55, y + 2.62, 16, cap0=False, cap1=False)
    # gun: elevation trunnion, ammo drum below, barrel cluster in a shroud with the muzzle restraint
    part.cyl(mat, (x, y + 1.55, 0), 0.45, 0.45, z - 0.9, z + 0.6, 12, axis='z')
    part.cyl(mat, (0, y + 1.1, z + 0.2), 0.42, 0.42, x - 0.62, x + 0.62, 12, axis='x')
    part.cyl(dark, (x, y + 1.55, 0), 0.24, 0.24, z - 2.6, z - 0.9, 10, axis='z')
    part.cyl(dark, (x, y + 1.55, 0), 0.28, 0.28, z - 2.85, z - 2.6, 10, axis='z')
    for k in range(6):
        a = k * math.pi / 3
        part.cyl(dark, (x + 0.1 * math.cos(a), y + 1.55 + 0.1 * math.sin(a), 0), 0.03, 0.03, z - 3.05, z - 2.85, 5, cap0=False)
    part.box(dark, x - 1.12, x - 0.72, y + 2.0, y + 2.55, z - 0.35, z + 0.25)

def mk45(part, o, mat='Super', dark='Dark'):
    """5-in/62 Mk 45 Mod 4: faceted low-signature gun shield, 7.9 m barrel with the bore evacuator"""
    x, y, z = o
    pts0 = [(-1.8, 0, -2.4), (1.8, 0, -2.4), (2.25, 0, 0.4), (2.05, 0, 3.0), (-2.05, 0, 3.0), (-2.25, 0, 0.4)]
    pts1 = [(-1.05, 2.05, -1.3), (1.05, 2.05, -1.3), (1.55, 2.25, 0.4), (1.45, 2.25, 2.7), (-1.45, 2.25, 2.7), (-1.55, 2.25, 0.4)]
    P0 = [(x + a, y + b, z + c) for a, b, c in pts0]
    P1 = [(x + a, y + b, z + c) for a, b, c in pts1]
    n = len(P0)
    for i in range(n):
        j = (i + 1) % n
        q = [P0[i], P0[j], P1[j], P1[i]]
        mx = (pts0[i][0] + pts0[j][0]) / 2; mz = (pts0[i][2] + pts0[j][2]) / 2
        part.g(mat).face(q, None, (mx, 0.25, mz - 0.3))
    part.g(mat).face(P1, None, (0, 1, 0))
    part.cyl(mat, (x, 0, z + 0.4), 2.45, 2.45, y - 0.35, y, 20)
    # barrel slot, barrel, bore evacuator, muzzle
    part.box(dark, x - 0.42, x + 0.42, y + 0.6, y + 1.5, z - 2.46, z - 2.36)
    part.cyl(mat, (x, y + 1.05, 0), 0.26, 0.19, z - 9.4, z - 1.9, 12, axis='z')
    part.cyl(mat, (x, y + 1.05, 0), 0.27, 0.27, z - 6.2, z - 5.1, 12, axis='z')
    part.cyl(dark, (x, y + 1.05, 0), 0.07, 0.07, z - 9.42, z - 9.38, 8, axis='z', cap1=False)
    # hatches and the sight on the roof
    part.box(mat, x - 0.5, x + 0.5, y + 2.25, y + 2.33, z + 1.2, z + 2.2)
    part.box(dark, x + 1.2, x + 1.6, y + 2.25, y + 2.6, z + 0.2, z + 0.6)

def mk38(part, o, mat='Super', dark='Dark'):
    """Mk 38 Mod 2/3 25 mm stabilised gun: pedestal, cradle box, barrel, EO sight on the side"""
    x, y, z = o
    part.cyl(mat, (x, 0, z), 0.42, 0.5, y, y + 0.9, 10)
    part.box(mat, x - 0.55, x + 0.55, y + 0.9, y + 1.55, z - 0.7, z + 0.8)
    part.cyl(dark, (x, y + 1.25, 0), 0.07, 0.06, z - 2.9, z - 0.7, 8, axis='z')
    part.cyl(mat, (x, y + 1.25, 0), 0.13, 0.13, z - 1.3, z - 0.7, 8, axis='z')
    part.box(dark, x + 0.55, x + 0.85, y + 1.05, y + 1.5, z - 0.5, z + 0.1)
    part.box(mat, x - 0.9, x - 0.55, y + 0.95, y + 1.4, z - 0.3, z + 0.5)

def harpoon_quad(part, o, facing=1, mat='Super', can='Canister', dark='Dark'):
    """Mk 141 quad Harpoon launcher: four canisters (2 × 2) at 35° on a frame; the missiles fire outboard
    (facing +1 = to starboard, −1 = to port)"""
    x, y, z = o
    el = math.radians(35)
    Lc = 4.6
    for (dz, dy) in ((-0.33, 0.0), (0.33, 0.0), (-0.33, 0.62), (0.33, 0.62)):
        base = (x - facing * 1.6, y + 0.9 + dy, z + dz)
        tip = (base[0] + facing * Lc * math.cos(el), base[1] + Lc * math.sin(el), base[2])
        part.beam(can, base, tip, 0.56, 0.56)
        # the frangible end cover (darker) and two stiffening rings
        dx, dy_ = tip[0] - base[0], tip[1] - base[1]
        for f in (0.3, 0.7):
            c = (base[0] + dx * f, base[1] + dy_ * f, base[2])
            part.beam(mat, (c[0] - facing * 0.05, c[1] - 0.035, c[2]), (c[0] + facing * 0.05, c[1] + 0.035, c[2]), 0.64, 0.64)
    for dz in (-0.9, 0.9):
        part.beam(mat, (x - facing * 1.6, y, z + dz), (x - facing * 1.6, y + 1.9, z + dz), 0.18)
        part.beam(mat, (x + facing * 1.1, y, z + dz), (x + facing * 1.1, y + 3.1, z + dz), 0.18)
        part.beam(mat, (x - facing * 1.6, y + 0.9, z + dz), (x + facing * 1.1, y + 2.75, z + dz), 0.14)
    part.box(mat, x - 1.8, x + 1.3, y, y + 0.15, z - 1.0, z + 1.0)

def svtt(part, o, facing=1, mat='Super', dark='Dark'):
    """Mk 32 triple torpedo tubes (324 mm) on their training stand, tubes pointing outboard (facing ±1 in x)"""
    x, y, z = o
    part.cyl(mat, (x, 0, z), 0.5, 0.55, y, y + 0.9, 10)
    for k, (dz, dy) in enumerate(((-0.42, 1.05), (0.0, 1.45), (0.42, 1.05))):
        a = (x - facing * 1.1, y + dy, z + dz)
        b = (x + facing * 2.3, y + dy, z + dz)
        part.beam(mat, a, b, 0.4, 0.4)
        part.beam(dark, (b[0] - facing * 0.02, b[1], b[2]), (b[0] + facing * 0.03, b[1], b[2]), 0.3, 0.3)
    part.box(mat, x - 0.3, x + 0.3, y + 0.9, y + 1.3, z - 0.7, z + 0.7)

def spg62(part, o, face_yaw=0.0, mat='Super', dish='White', dark='Dark'):
    """AN/SPG-62 fire-control illuminator: 2.4 m dish with its feed on a stabilised pedestal; face_yaw turns
    the dish from facing −z (forward)"""
    x, y, z = o
    part.cyl(mat, (x, 0, z), 0.55, 0.65, y, y + 1.1, 12)
    part.box(mat, x - 0.55, x + 0.55, y + 1.1, y + 1.7, z - 0.5, z + 0.5)
    c, s = math.cos(face_yaw), math.sin(face_yaw)
    def P(u, v, w):   # u across, v up, w forward (dish axis) → ship frame
        return (x + u * c - w * s, y + 2.35 + v, z - w * c - u * s)
    R = 1.2
    n = 16
    rim = [P(R * math.cos(2 * math.pi * i / n), R * math.sin(2 * math.pi * i / n), 0.25) for i in range(n)]
    cen = P(0, 0, -0.15)
    for i in range(n):
        j = (i + 1) % n
        part.g(dish).face([cen, rim[i], rim[j]], None, (-s, 0, -c))
        part.g(mat).face([cen, rim[j], rim[i]], None, (s, 0, c))
    for u in (-0.9, 0.9):
        part.beam(dark, P(u * 0.9, 0.0, 0.2), P(0, 0, 1.15), 0.05)
    part.beam(dark, P(0, 0.9, 0.2), P(0, 0, 1.15), 0.05)
    fx, fy, fz = P(0, 0, 1.15)
    part.box(dark, fx - 0.15, fx + 0.15, fy - 0.15, fy + 0.15, fz - 0.15, fz + 0.15)   # the feed horn
    part.beam(mat, (x, y + 1.7, z), P(0, 0, -0.1), 0.35)

def spy_face(part, center, normal_xz, size=3.8, mat='Array', rim='Super', tilt=0.0):
    """octagonal SPY-1 array face on a wall with outward normal (nx, nz); tilt leans the top back (rad)"""
    cx, cy, cz = center
    nx, nz = normal_xz
    tx, tz = -nz, nx
    ct, st = math.cos(tilt), math.sin(tilt)
    pts = []
    for k in range(8):
        a = math.pi / 8 + k * math.pi / 4
        u, v = math.cos(a) * size / 2, math.sin(a) * size / 2
        # v runs up the wall, leaning back by `tilt`
        pts.append((cx + tx * u + nx * (0.14 - v * st), cy + v * ct, cz + tz * u + nz * (0.14 - v * st)))
    part.g(mat).face(pts, None, (nx * ct, st, nz * ct))
    back = [(p[0] - nx * 0.14, p[1], p[2] - nz * 0.14) for p in pts]
    for k in range(8):
        j = (k + 1) % 8
        mid = ((pts[k][0] + pts[j][0]) / 2 - cx, (pts[k][1] + pts[j][1]) / 2 - cy, (pts[k][2] + pts[j][2]) / 2 - cz)
        part.g(rim).face([back[k], back[j], pts[j], pts[k]], None, mid)
    # a thin frame round the face
    for k in range(8):
        j = (k + 1) % 8
        part.beam(rim, pts[k], pts[j], 0.08, caps=False)

def decoy_launcher(part, o, facing=1, mat='Super', dark='Dark'):
    """Mk 137 decoy launcher (SRBOC / Nulka): six short tubes fanned at 45° and 60°"""
    x, y, z = o
    part.box(mat, x - 0.5, x + 0.5, y, y + 0.35, z - 0.55, z + 0.55)
    for k, (dz, el) in enumerate(((-0.35, 45), (0.0, 45), (0.35, 45), (-0.35, 60), (0.0, 60), (0.35, 60))):
        e = math.radians(el)
        b = (x - facing * 0.15 + (0.25 if el == 60 else 0) * -facing, y + 0.35, z + dz)
        t = (b[0] + facing * 1.2 * math.cos(e), b[1] + 1.2 * math.sin(e), b[2])
        part.beam(mat, b, t, 0.16, 0.16)

def searchlight(part, x, y, z, mat='Super', lens='Glass'):
    part.cyl(mat, (x, 0, z), 0.08, 0.1, y, y + 0.5, 6)
    part.cyl(mat, (x, y + 0.72, 0), 0.25, 0.25, z - 0.3, z + 0.25, 10, axis='z')
    part.cyl(lens, (x, y + 0.72, 0), 0.22, 0.22, z - 0.32, z - 0.3, 10, axis='z', cap1=False)

def lifebuoy(part, x, y, z, face, mat='Orange'):
    """ring buoy on a rail / wall (face '+x' / '-x')"""
    sg = 1 if face == '+x' else -1
    n = 10
    for i in range(n):
        a0, a1 = 2 * math.pi * i / n, 2 * math.pi * (i + 1) / n
        for (r0, r1) in ((0.2, 0.36),):
            q = [(x + sg * 0.05, y + r0 * math.sin(a0), z + r0 * math.cos(a0)), (x + sg * 0.05, y + r1 * math.sin(a0), z + r1 * math.cos(a0)),
                 (x + sg * 0.05, y + r1 * math.sin(a1), z + r1 * math.cos(a1)), (x + sg * 0.05, y + r0 * math.sin(a1), z + r0 * math.cos(a1))]
            part.g(mat).face(q, None, (sg, 0, 0))

def plate_with_holes(part, mat, x0, x1, z0, z1, y, holes, depth=0.35, wall='Dark', bottom='Canister', uvf=None):
    """flat plate (top face at y) over [x0, x1] × [z0, z1] with rectangular holes (hx0, hx1, hz0, hz1) that are
    recessed `depth` deep: walls down to a floor (a missile canister's top, say). Holes must not overlap."""
    xs = sorted(set([x0, x1] + [h[0] for h in holes] + [h[1] for h in holes]))
    zs = sorted(set([z0, z1] + [h[2] for h in holes] + [h[3] for h in holes]))
    def in_hole(cx, cz):
        return any(h[0] < cx < h[1] and h[2] < cz < h[3] for h in holes)
    for i in range(len(xs) - 1):
        # merge runs along z of solid cells into one quad per column strip
        j = 0
        while j < len(zs) - 1:
            cx = (xs[i] + xs[i + 1]) / 2
            if in_hole(cx, (zs[j] + zs[j + 1]) / 2):
                j += 1
                continue
            k = j
            while k < len(zs) - 1 and not in_hole(cx, (zs[k] + zs[k + 1]) / 2):
                k += 1
            q = [(xs[i], y, zs[j]), (xs[i], y, zs[k]), (xs[i + 1], y, zs[k]), (xs[i + 1], y, zs[j])]
            part.g(mat).face(q, [uvf(*p) for p in q] if uvf else None, (0, 1, 0))
            j = k
    for (hx0, hx1, hz0, hz1) in holes:
        yb = y - depth
        part.g(bottom).face([(hx0, yb, hz0), (hx0, yb, hz1), (hx1, yb, hz1), (hx1, yb, hz0)], None, (0, 1, 0))
        part.g(wall).face([(hx0, yb, hz0), (hx0, y, hz0), (hx0, y, hz1), (hx0, yb, hz1)], None, (1, 0, 0))
        part.g(wall).face([(hx1, yb, hz0), (hx1, yb, hz1), (hx1, y, hz1), (hx1, y, hz0)], None, (-1, 0, 0))
        part.g(wall).face([(hx0, yb, hz0), (hx1, yb, hz0), (hx1, y, hz0), (hx0, y, hz0)], None, (0, 0, 1))
        part.g(wall).face([(hx0, yb, hz1), (hx0, y, hz1), (hx1, y, hz1), (hx1, yb, hz1)], None, (0, 0, -1))

# ═════════════ Mk 41 vertical launching system ═════════════
MK41 = {
    # United Defense / Lockheed Martin data sheets, and measured launch photographs: a module in a launcher is
    # 3.16 × 2.18 m: two rows of four cells (0.79 m pitch along a row) either side of a 0.24 m exhaust-uptake
    # slot; across it: hinge strip 0.20 | lid 0.77 | uptake 0.24 | lid 0.77 | hinge strip 0.20. Canisters are 25 in
    # (0.64 m) square. An 8-module launcher is 8.71 × 6.32 m.
    'pitch_u': 0.97,     # one row's share of the module width (hinge strip + lid)
    'pitch_v': 0.79,     # cell pitch along a row
    'hatch': 0.77,       # lid (square)
    'mouth': 0.64,       # the cell opening (the canister top) under the lid
    'uptake_w': 0.24,    # exhaust-uptake slot between the two rows
    'gap': 0.0,          # modules are packed edge to edge in a launcher
    'depth': 7.7,        # strike-length module (the missile's start point is the cell mouth; the canister goes this deep)
    'open': -1.66,       # lid opening angle (rad): swings up and outward about its outer edge and stands ~95°
}

def mk41_module_size():
    """(width across the two columns + uptake, length along the four rows)"""
    return 2 * MK41['pitch_u'] + MK41['uptake_w'], 4 * MK41['pitch_v']

def mk41_launcher_size(nx, nz, along='z'):
    mw, ml = mk41_module_size()
    fx, fz = (mw, ml) if along == 'z' else (ml, mw)
    g = MK41['gap']
    return nx * fx + (nx - 1) * g, nz * fz + (nz - 1) * g

def mk41_door_mesh(name='mk41_hatch', mat='VLS', dark='Dark'):
    """one cell hatch in its own frame: hinge along local x through the origin, plate towards +z,
    top at y ≈ 0.09 (flush-ish with the module top); shared by every cell door node"""
    h = MK41['hatch']
    p = Part(name)
    t = 0.08                     # a raised plate about 8 cm thick
    p.box(mat, -h / 2, h / 2, 0.01, 0.01 + t, 0.02, h - 0.02)
    p.box(mat, -h / 2 + 0.05, h / 2 - 0.05, 0.01 + t, 0.01 + t + 0.015, 0.07, h - 0.07)   # the raised centre
    p.box(dark, -0.08, 0.08, 0.01 + t, 0.01 + t + 0.035, h - 0.12, h - 0.04)             # latch
    # the hinge: two brackets and a bar (~0.5 m × 0.1 m) along the lid's outer edge
    p.cyl(mat, (0, 0.05, 0.0), 0.05, 0.05, -0.25, 0.25, 8, axis='x')
    for x in (-0.2, 0.2):
        p.box(mat, x - 0.04, x + 0.04, 0.0, 0.09, -0.02, 0.1)
    return p.mesh(origin=(0, 0, 0))

def mk41_uptake_mesh(name='mk41_uptake', mat='VLS', dark='Dark'):
    """a module's exhaust-uptake hatch: long narrow plate over the plenum, hinge along local z at x = 0,
    plate towards +x (turned 90° about its hinge to vent)"""
    L = MK41['pitch_v'] * 4 - 0.16        # ~3.0 m
    w = MK41['uptake_w'] - 0.02           # ~0.24 m
    p = Part(name)
    p.box(mat, 0.0, w, 0.01, 0.07, -L / 2, L / 2)
    for k in range(6):
        zz = -L / 2 + (k + 0.5) * L / 6
        p.box(dark, 0.04, w - 0.04, 0.07, 0.085, zz - 0.02, zz + 0.02)
    return p.mesh(origin=(0, 0, 0))

def mk41_launcher(part, root, x0, z0, nx, nz, y, cell_no, uptake_no, door_mesh, uptake_mesh,
                  crane=None, along='z', mat='VLS', deck='Dark', plinth=None, plinth_mat='Super'):
    """A Mk 41 launcher of nx × nz 8-cell modules (nx across the ship, nz along it). Each module is 4 rows of
    2 cells with the exhaust uptake between the two columns; `along` = the direction of its rows ('z' fore-aft,
    'x' athwartships). (x0, z0) = the forward-port corner, y = the top of the modules. Static plating goes into
    `part`; each cell gets a door node vls_<n> (shared mesh, pivot on its outer hinge: it swings up and away
    from the uptake) and an empty cell_<n> at its mouth (+Y = the launch direction); each module an uptake_<m>
    node. crane = (ix, iz): the strikedown-crane module (its folded crane takes three cells, leaving 5).
    Returns (next cell_no, next uptake_no, [(n, x, z), ...])."""
    pu, pv, hs, uw, mo, gap = MK41['pitch_u'], MK41['pitch_v'], MK41['hatch'], MK41['uptake_w'], MK41['mouth'], MK41['gap']
    mw, ml = mk41_module_size()
    fx, fz = (mw, ml) if along == 'z' else (ml, mw)
    W, Lz = mk41_launcher_size(nx, nz, along)
    # launcher coaming and the plating between modules (below the cell recesses: the gaps read dark)
    part.box(deck, x0 - 0.25, x0 + W + 0.25, y - 0.5, y - 0.34, z0 - 0.25, z0 + Lz + 0.25)
    for sx in (x0 - 0.25, x0 + W + 0.25):
        part.box(mat, sx - 0.08, sx + 0.08, y - 0.4, y + 0.1, z0 - 0.33, z0 + Lz + 0.33)
    for sz in (z0 - 0.25, z0 + Lz + 0.25):
        part.box(mat, x0 - 0.33, x0 + W + 0.33, y - 0.4, y + 0.1, sz - 0.08, sz + 0.08)
    if plinth is not None:
        # the launcher stands on a plinth: its walls from the deck (a callable z → height, or a number) up to the coaming
        py = plinth if callable(plinth) else (lambda zz: plinth)
        xa, xb, za, zb = x0 - 0.33, x0 + W + 0.33, z0 - 0.33, z0 + Lz + 0.33
        n = 6
        for i in range(n):
            z_a, z_b = za + (zb - za) * i / n, za + (zb - za) * (i + 1) / n
            for xs, sg in ((xa, -1), (xb, 1)):
                part.g(plinth_mat).face([(xs, py(z_a) - 0.3, z_a), (xs, py(z_b) - 0.3, z_b), (xs, y - 0.38, z_b), (xs, y - 0.38, z_a)], None, (sg, 0, 0))
        for zs, sg in ((za, -1), (zb, 1)):
            part.g(plinth_mat).face([(xa, py(zs) - 0.3, zs), (xb, py(zs) - 0.3, zs), (xb, y - 0.38, zs), (xa, y - 0.38, zs)], None, (0, 0, sg))
    cells = []
    for iz in range(nz):
        for ix in range(nx):
            bx, bz = x0 + ix * (fx + gap), z0 + iz * (fz + gap)
            def S(u, v):                       # module (u across, v along) → ship (x, z)
                return (bx + u, bz + v) if along == 'z' else (bx + v, bz + u)
            def R(u0, v0, u1, v1):             # module rectangle → ship (x0, x1, z0, z1)
                (a, b), (c, d) = S(u0, v0), S(u1, v1)
                return (min(a, c), max(a, c), min(b, d), max(b, d))
            # crane = (ix, iz) or (ix, iz, col, rows): the module whose folded strikedown crane takes three adjacent
            # cells of one row (default: the first row's first three)
            has_crane = crane is not None and (ix, iz) == tuple(crane[:2])
            crane_col = crane[2] if has_crane and len(crane) > 2 else 0
            crane_rows = tuple(crane[3]) if has_crane and len(crane) > 3 else (0, 1, 2)
            holes = []
            for col in (0, 1):
                for row in range(4):
                    # the lid sits against the uptake slot, the hinge strip outboard of it
                    uc = (pu - hs / 2) if col == 0 else (pu + uw + hs / 2)
                    vc = pv / 2 + row * pv
                    if has_crane and col == crane_col and row in crane_rows:
                        continue
                    cx, cz = S(uc, vc)
                    holes.append(R(uc - mo / 2, vc - mo / 2, uc + mo / 2, vc + mo / 2))
                    # hinge on the lid's outer edge; the plate reaches in towards the uptake
                    # (R_y(θ) takes local +z to (sin θ, 0, cos θ))
                    hx, hz = S(uc - hs / 2 if col == 0 else uc + hs / 2, vc)
                    if along == 'z':
                        rot = ((0, 1, 0), math.pi / 2 if col == 0 else -math.pi / 2)   # local +z → ±x
                    else:
                        rot = None if col == 0 else ((0, 1, 0), math.pi)                # local +z → ±z
                    n = cell_no
                    rig_node('vls_%d' % n, door_mesh, (hx, y, hz), root, rot, {'t': 'door', 'hinge': [1, 0, 0], 'open': MK41['open']})
                    point('cell_%d' % n, (cx, y, cz), root, None, t='cell', door='vls_%d' % n, uptake='uptake_%d' % uptake_no,
                          depth=MK41['depth'])
                    cells.append((n, cx, cz))
                    cell_no += 1
            # module top with the cell mouths (canister tops 0.3 m down) and the sooty uptake slot
            holes.append(R(pu + 0.01, 0.08, pu + uw - 0.01, ml - 0.08))
            plate_with_holes(part, mat, *R(0, 0, mw, ml), y, holes, 0.3, 'Dark', 'Canister')
            ua = holes[-1]
            part.g('Dark').face([(ua[0], y - 0.29, ua[2]), (ua[0], y - 0.29, ua[3]), (ua[1], y - 0.29, ua[3]), (ua[1], y - 0.29, ua[2])], None, (0, 1, 0))
            if has_crane:
                # the folded strikedown crane under one long cover over its three cells
                u0 = (pu - hs - 0.02) if crane_col == 0 else (pu + uw)
                u1 = pu if crane_col == 0 else (pu + uw + hs + 0.02)
                v0, v1 = min(crane_rows) * pv + 0.06, (max(crane_rows) + 1) * pv - 0.06
                c0 = R(u0, v0, u1, v1)
                part.box(mat, c0[0], c0[1], y, y + 0.22, c0[2], c0[3])
                c1 = R(u0 + 0.14, v0 + 0.25, u1 - 0.14, v0 + 1.35)
                part.box(mat, c1[0], c1[1], y + 0.22, y + 0.42, c1[2], c1[3])
            # uptake hatch: hinge along one long edge of the slot, it turns up 90° and stands as a low fence
            if along == 'z':
                ux, uz = S(pu + 0.01, ml / 2)
                rot = None
            else:
                ux, uz = S(pu + uw - 0.01, ml / 2)
                rot = ((0, 1, 0), math.pi / 2)
            rig_node('uptake_%d' % uptake_no, uptake_mesh, (ux, y, uz), root, rot, {'t': 'door', 'hinge': [0, 0, 1], 'open': 1.57})
            uptake_no += 1
    return cell_no, uptake_no, cells

# ═════════════ boats ═════════════
def planing_hull(part, z_bow, z_stern, keel_y, chine, sheer, deadrise, n=28, mat='BoatHull', bottom_mat=None,
                 uvf=None, transom=True, rail=0.06):
    """Deep-V planing hull between the stem (z_bow) and the transom (z_stern). For s = 0 (stem) … 1 (transom):
    keel_y(s) = keel height, chine(s) = (half-breadth, height) of the chine, sheer(s) = (half-breadth, height)
    of the gunwale, deadrise(s) unused if chine() already sets the height (kept for readability). A small
    spray rail runs along the chine. Returns the starboard stations [(keel, chine, chine_out, mid, sheer)]."""
    bm = bottom_mat or mat
    st = []
    for i in range(n + 1):
        s = i / n
        s = s ** 1.25                                  # more stations towards the bow, where it curves
        z = z_bow + (z_stern - z_bow) * s
        ky = keel_y(s)
        cx, cy = chine(s)
        sx, sy = sheer(s)
        k = (0.0, ky, z)
        c = (cx, cy, z)
        co = (cx + rail, cy + rail * 0.3, z)
        mid = (lerp(cx + rail, sx, 0.55) + (sx - cx) * 0.06, lerp(cy, sy, 0.5), z)
        sh = (sx, sy, z)
        st.append((k, c, co, mid, sh))
    uv = (lambda q: [uvf(*p) for p in q]) if uvf else (lambda q: None)
    for a, b in zip(st, st[1:]):
        for j in range(4):
            m = bm if j == 0 else mat
            for sg in (1, -1):
                q = [(sg * a[j][0], a[j][1], a[j][2]), (sg * b[j][0], b[j][1], b[j][2]),
                     (sg * b[j + 1][0], b[j + 1][1], b[j + 1][2]), (sg * a[j + 1][0], a[j + 1][1], a[j + 1][2])]
                part.g(m).face(q, uv(q), (sg, -0.6 if j == 0 else 0.2, 0), j != 1)
    if transom:
        t = st[-1]
        pts = [t[4], t[3], t[2], t[1], t[0], (-t[1][0], t[1][1], t[1][2]), (-t[2][0], t[2][1], t[2][2]),
               (-t[3][0], t[3][1], t[3][2]), (-t[4][0], t[4][1], t[4][2])]
        part.g(mat).face(pts, uv(pts), (0, 0, 1))
    return st

def sweep_tube(part, pts, r, mat, n=12, closed=False, cap=True, rfun=None):
    """a tube of radius r (or rfun(i) per point) swept along a polyline of 3D points (collar, rails, pipes)"""
    P = [Vector(p) for p in pts]
    m = len(P)
    rings = []
    for i in range(m):
        if closed:
            t = (P[(i + 1) % m] - P[(i - 1) % m])
        else:
            t = (P[min(i + 1, m - 1)] - P[max(i - 1, 0)])
        t.normalize()
        up = Vector((0, 1, 0)) if abs(t.y) < 0.9 else Vector((1, 0, 0))
        u = t.cross(up).normalized()
        v = u.cross(t).normalized()
        rr = rfun(i) if rfun else r
        rings.append([P[i] + (u * math.cos(2 * math.pi * k / n) + v * math.sin(2 * math.pi * k / n)) * rr for k in range(n)])
    segs = m if closed else m - 1
    for i in range(segs):
        A, B = rings[i], rings[(i + 1) % m]
        for k in range(n):
            q = [A[k], A[(k + 1) % n], B[(k + 1) % n], B[k]]
            c = (A[k] + A[(k + 1) % n]) / 2 - P[i]
            part.g(mat).face([tuple(p) for p in q], None, tuple(c), True)
    if cap and not closed:
        for (ring, pc, sgn) in ((rings[0], P[0], -1), (rings[-1], P[-1], 1)):
            t = (P[1] - P[0]) if sgn < 0 else (P[-1] - P[-2])
            part.g(mat).face([tuple(p) for p in ring], None, tuple(t * sgn))
    return rings

def rhib7(part, o, yaw=0.0, hull='Super', tube='Tube', dark='Dark'):
    """7 m RHIB (ship's boat) as carried on a destroyer's davit: grey GRP hull, dark collar, console, A-frame"""
    x0, y0, z0 = o
    c, s = math.cos(yaw), math.sin(yaw)
    def P(u, v, w):
        return (x0 + u * c + w * s, y0 + v, z0 - u * s + w * c)
    L, B = 7.0, 2.7
    # collar: a loop of tube segments round the hull (bow pointed)
    pts = []
    for k in range(13):
        t = k / 12
        w = -L / 2 + t * L
        half = B / 2 - 0.3 if w > -L * 0.1 else (B / 2 - 0.3) * math.sqrt(max(0.0, 1 - ((w + L * 0.1) / (L * 0.4)) ** 2))
        pts.append((half, w))
    loop = [(u, w) for u, w in pts] + [(-u, w) for u, w in reversed(pts)]
    for (ua, wa), (ub, wb) in zip(loop, loop[1:]):
        part.beam(tube, P(ua, 0.55, wa), P(ub, 0.55, wb), 0.5, 0.5, caps=False)
    # hull (V bottom)
    for (ua, wa), (ub, wb) in zip(pts, pts[1:]):
        for sg in (1, -1):
            part.g(hull).face([P(sg * ua, 0.35, wa), P(sg * ub, 0.35, wb), P(0, -0.25, wb), P(0, -0.25, wa)], None, (sg * c, -0.5, -sg * s))
    part.g(hull).face([P(-pts[-1][0], 0.35, L / 2), P(pts[-1][0], 0.35, L / 2), P(0, -0.25, L / 2)], None, (s, 0, c))
    # deck, console, engine box, A-frame
    q = [P(u, 0.4, w) for u, w in ((-0.9, -2.0), (0.9, -2.0), (0.9, 3.2), (-0.9, 3.2))]
    part.g(dark).face(q, None, (0, 1, 0))
    for (a, b) in (((-0.35, 0.4, -0.2), (0.35, 1.35, 0.6)),):
        cx, cz = P(0, 0, 0.2)[0], P(0, 0, 0.2)[2]
        part.box(hull, cx - 0.4, cx + 0.4, y0 + 0.4, y0 + 1.35, cz - 0.4, cz + 0.4)
    cx, cz = P(0, 0, 2.6)[0], P(0, 0, 2.6)[2]
    part.box(hull, cx - 0.55, cx + 0.55, y0 + 0.4, y0 + 1.0, cz - 0.5, cz + 0.5)
    for sg in (1, -1):
        part.beam(dark, P(sg * 0.9, 0.5, 3.1), P(sg * 0.5, 2.3, 2.9), 0.08)
    part.beam(dark, P(-0.5, 2.3, 2.9), P(0.5, 2.3, 2.9), 0.08)

def davit(part, o, side=1, h=3.2, reach=2.2, mat='Super', dark='Dark'):
    """single-arm boat davit / crane: post on the deck, arm reaching outboard, the fall hanging down"""
    x, y, z = o
    part.cyl(mat, (x, 0, z), 0.28, 0.24, y, y + h, 10)
    top = (x, y + h, z)
    tip = (x + side * reach, y + h + 0.4, z)
    part.beam(mat, top, tip, 0.3, 0.35)
    part.beam(dark, tip, (tip[0], tip[1] - 1.8, tip[2]), 0.04)
    part.box(dark, tip[0] - 0.12, tip[0] + 0.12, tip[1] - 1.95, tip[1] - 1.8, z - 0.12, z + 0.12)
