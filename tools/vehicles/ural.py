# ═══════════════════════════════════════════════════════════════
# Ural-4320 6×6 chassis (Blender, with vkit): bonneted cab, hood with its C-louvres, flat-topped front wings with
# the headlights in their faces, grille, bumper, frame, leaf-spring axles, fuel tanks, spare wheel, 6 wheels on
# 1220×400-533 tyres. Coordinates: game frame, z = distance aft of the front bumper face (vkit recentres the
# finished vehicle), x right, y up.
# Reference: Mick Bell's 1/76 4-view drawing "Truck, 4500 kg, 6x6, cargo, Ural 4320" (CC BY 4.0, Wikimedia
# Commons), measured on a metric grid, and photos (BM-21 at the Kyiv museum, Russian Army trucks); specs:
# 7.366 × 2.5 m, 2.715 m to the cab roof, wheelbase 3.525 + 1.4 m, track 2.0 m, 1220×400-533 tyres.
# ═══════════════════════════════════════════════════════════════
import math
from mathutils import Vector
import vkit
from vkit import Part, lerp, vec

URAL = {
    'axles': [1.28, 4.805, 6.205],
    'track': 2.0,
    'R': 0.61, 'W': 0.40, 'rim': 0.29,
    'width': 2.5,
    'len': 7.14,           # front bumper face → rear frame end (the pintle hook reaches 7.36)
    'frame': (0.86, 1.10), # frame rail bottom / top
    'bed': 1.30,           # top of the sub-frame a body sits on
}


def wheels(v, parent=None, axles=None, track=None, R=None, W=None, rim=None, steer=None, lugs=16, seg=22, nbolts=10,
           prefix='wheel', rim_skin='dark', hub_skin='dark', tread='chevron'):
    """one shared wheel mesh on every hub: wheel_<axle><l|r> (right wheels hold the mesh, left ones share it turned
    180°); writes vk.wheels (radius, steering share, side)"""
    axles = axles or URAL['axles']
    track = track or URAL['track']
    R, W, rim = R or URAL['R'], W or URAL['W'], rim or URAL['rim']
    steer = steer if steer is not None else {0: 1.0}
    proto = None
    for i, z in enumerate(axles):
        for side in (1, -1):
            name = '%s_%d%s' % (prefix, i + 1, 'r' if side > 0 else 'l')
            if proto is None:
                p = Part(v, name, pivot=(side * track / 2, R, z), parent=parent, local=True)
                vkit.build_wheel(p, R, W, rim, lugs=lugs, seg=seg, nbolts=nbolts, cti=True, hub_skin=hub_skin, rim_skin=rim_skin, tread=tread)
                proto = p
            else:
                p = Part(v, name, pivot=(side * track / 2, R, z), parent=parent, local=True,
                         rest_yaw=0.0 if side > 0 else math.pi, share=proto)
            v.meta['wheels'].append({'node': name, 'r': R, 'steer': steer.get(i, 0), 'side': side})
    return proto


def outline(b, pts, normal, w=0.011, skin='black'):
    """a panel line (thin dark strip) along a polyline lying on a surface"""
    nrm = Vector(normal).normalized()
    P = [vec(p) for p in pts]
    for a, c in zip(P[:-1], P[1:]):
        d = (c - a).normalized()
        s = d.cross(nrm).normalized() * w
        b.face([tuple(a - s + nrm * 0.003), tuple(c - s + nrm * 0.003), tuple(c + s + nrm * 0.003), tuple(a + s + nrm * 0.003)], skin, want=tuple(nrm))


# ── front end ──
def hood_ring(z, y_top, ws, y_base=1.52, n_sh=4, r=0.14):
    """open cross-section of the hood at station z: from the left wing top, up the side, round the shoulder, over the
    top, down to the right wing top. Points ordered left → right."""
    pts = []
    xs = ws
    cy = y_top - r * 0.9
    pts.append((-xs, y_base, z))
    pts.append((-xs, cy - 0.02, z))
    for k in range(n_sh + 1):
        a = math.pi - (math.pi / 2) * k / n_sh
        pts.append((-xs + r + r * math.cos(a) * 1.0, cy + (y_top - cy) * math.sin(a), z))
    for k in range(n_sh + 1):
        a = math.pi / 2 - (math.pi / 2) * k / n_sh
        pts.append((xs - r + r * math.cos(a), cy + (y_top - cy) * math.sin(a), z))
    pts.append((xs, cy - 0.02, z))
    pts.append((xs, y_base, z))
    return pts


HOOD = [  # (z, top height, half width at the sides)
    (0.21, 1.735, 0.47), (0.45, 1.83, 0.56), (0.80, 1.915, 0.66), (1.20, 1.975, 0.76), (1.55, 2.01, 0.83), (1.79, 2.03, 0.88),
]


def ural_front(b):
    # ── bumper: a heavy channel beam, tow hooks, number plate ──
    b.box('dark', -1.07, 1.07, 0.86, 1.10, 0.02, 0.26, bev=0.02)
    b.box('dark', -1.07, 1.07, 0.88, 1.08, 0.26, 0.40)                       # bumper brackets / top flange
    for sx in (-1, 1):
        # tow hooks on the bumper face
        b.box('dark', sx * 0.62 - 0.05, sx * 0.62 + 0.05, 1.08, 1.16, 0.04, 0.22)
        b.tube('dark', [(sx * 0.62, 1.16, 0.2), (sx * 0.62, 1.24, 0.1), (sx * 0.62, 1.2, 0.02), (sx * 0.62, 1.12, 0.04)], 0.026, 6)
    b.panel('white', [(-0.26, 0.9, 0.019), (0.26, 0.9, 0.019), (0.26, 1.02, 0.019), (-0.26, 1.02, 0.019)], (0, 0, -1), off=0.003)
    # ── grille: frame, dark core, 8 vertical bars with bent tops ──
    gz = 0.20
    b.box('paint', -0.47, 0.47, 1.00, 1.05, gz, gz + 0.12)
    b.box('paint', -0.47, -0.42, 1.00, 1.64, gz, gz + 0.12)
    b.box('paint', 0.42, 0.47, 1.00, 1.64, gz, gz + 0.12)
    b.panel('black', [(-0.42, 1.05, gz + 0.1), (0.42, 1.05, gz + 0.1), (0.42, 1.64, gz + 0.1), (-0.42, 1.64, gz + 0.1)], (0, 0, -1), off=0.0)
    for i in range(8):
        x = lerp(-0.36, 0.36, i / 7)
        b.box('paint', x - 0.014, x + 0.014, 1.07, 1.52, gz - 0.01, gz + 0.05)
        b.beam('paint', (x, 1.51, gz + 0.02), (x * 0.92, 1.63, gz + 0.07), 0.028, 0.05)
    b.box('paint', -0.42, 0.42, 1.13, 1.16, gz - 0.005, gz + 0.04)
    # ── hood: loft of cross-sections from the grille to the windscreen, a front cap over the grille ──
    rings = [hood_ring(z, yt, ws) for (z, yt, ws) in HOOD]
    b.loft('paint', rings, closed=False, smooth=True)
    front = rings[0]
    b.face([(x, y, z) for (x, y, z) in front] + [(0.47, 1.64, front[0][2])][:0], 'paint', want=(0, 0.2, -1))
    b.box('paint', -0.47, 0.47, 1.52, 1.66, gz, gz + 0.03)
    # hood centre seam and the side hinges (panel lines)
    outline(b, [(0, HOOD[i][1] + 0.003, HOOD[i][0]) for i in range(len(HOOD))], (0, 1, 0), w=0.006)
    # C-louvres on each hood side (the "СССС" vents): recessed slots with a raised lip
    for sx in (-1, 1):
        for i in range(7):
            z0 = 0.62 + i * 0.105
            ws = lerp(0.56, 0.78, (z0 - 0.45) / 0.8)
            x = sx * (ws + 0.004)
            b.panel('black', [(x, 1.60, z0), (x, 1.60, z0 + 0.07), (x, 1.73, z0 + 0.07), (x, 1.73, z0)], (sx, 0, 0), off=0.003)
            b.face([(x + sx * 0.004, 1.735, z0 - 0.005), (x + sx * 0.004, 1.735, z0 + 0.075), (x + sx * 0.03, 1.72, z0 + 0.075), (x + sx * 0.03, 1.72, z0 - 0.005)], 'paint', want=(sx, 1, 0))
        # hood latches
        b.box('dark', sx * 0.47 - 0.02, sx * 0.47 + 0.02, 1.55, 1.62, 0.3, 0.38)
    # ── front wings: flat-topped fenders over the front wheels, sweeping down to the cab step ──
    R, zw = URAL['R'], URAL['axles'][0]
    ra = R + 0.11
    for sx in (-1, 1):
        prof = [(0.21, 1.00), (0.21, 1.47), (0.235, 1.505), (0.28, 1.52), (1.30, 1.52), (1.42, 1.50), (2.06, 0.98), (2.08, 0.90)]
        arch = []
        for k in range(10):
            a = math.radians(24 + (180 - 48) * k / 9)
            arch.append((zw + ra * math.cos(a), URAL['axles'][0] * 0 + R + ra * math.sin(a)))
        prof += arch
        prof += [(0.55, 0.92)]
        x_in, x_out = sx * 0.46, sx * 1.22
        b.prism_x('paint', prof, min(x_in, x_out), max(x_in, x_out), cap0=True, cap1=True)
        # the rolled bead along the wing's outer edge, following its outline
        bead = [(sx * 1.225, y, z) for (z, y) in prof[:8]]
        b.tube('paint', bead, 0.022, 6)
        # wing top stiffening ribs
        for dx in (0.18, 0.36):
            xr = sx * (1.22 - dx)
            b.beam('paint', (xr, 1.525, 0.26), (xr, 1.525, 1.30), 0.03, 0.012)
        # headlight in the wing face, the side light above it, turn lamp outboard
        vkit.headlight(b, (sx * 0.64, 1.28, 0.20), (0, 0, -1), r=0.10, depth=0.07, skin_body='dark', lens='lens')
        b.lathe((sx * 0.64, 1.28, 0.208), (0, 0, -1), [(0, 0.125, 'paint'), (0.02, 0.118, 'paint'), (0.02, 0.10, 'dark')], n=14, smooth=False)
        vkit.headlight(b, (sx * 0.64, 1.44, 0.20), (0, 0, -1), r=0.035, depth=0.03, skin_body='dark', lens='lens_amber')
        vkit.headlight(b, (sx * 0.96, 1.30, 0.20), (0, 0, -1), r=0.05, depth=0.04, skin_body='dark', lens='lens_amber')
        # mesh guard over the side lamp (the grilled lamp boxes on the wing tops)
        b.box('paint', sx * 0.56, sx * 0.76, 1.52, 1.60, 0.24, 0.40)
        b.panel('mesh', [(sx * 0.57, 1.53, 0.235), (sx * 0.75, 1.53, 0.235), (sx * 0.75, 1.59, 0.235), (sx * 0.57, 1.59, 0.235)], (0, 0, -1), off=0.002)
    # the inner mudguard (splash wall) behind each front wheel and the engine sump pan
    b.face([(-0.46, 0.86, 0.30), (0.46, 0.86, 0.30), (0.46, 0.86, 1.95), (-0.46, 0.86, 1.95)], 'dark', want=(0, -1, 0))


# ── cab ──
def cab_ring(y, z0, z1, hx, ch=0.06):
    """a plan ring (8 points, chamfered corners) at height y"""
    return [(-hx + ch, y, z0), (hx - ch, y, z0), (hx, y, z0 + ch), (hx, y, z1 - ch), (hx - ch, y, z1), (-hx + ch, y, z1), (-hx, y, z1 - ch), (-hx, y, z0 + ch)]


def ural_cab(b):
    r0 = cab_ring(1.10, 1.96, 2.85, 0.88)
    r1 = cab_ring(2.02, 1.785, 2.85, 0.885)
    r2 = cab_ring(2.54, 1.895, 2.84, 0.865, 0.07)
    r3 = cab_ring(2.64, 1.97, 2.79, 0.82, 0.10)
    r4 = cab_ring(2.675, 2.08, 2.70, 0.68, 0.12)
    b.loft('paint', [r0, r1, r2, r3, r4], smooth=False)
    b.face(r4, 'paint', want=(0, 1, 0))
    b.face(r0, 'dark', want=(0, -1, 0))

    def on(ra, rb, i, u, v):
        A0, A1 = Vector(ra[i]), Vector(ra[(i + 1) % len(ra)])
        B0, B1 = Vector(rb[i]), Vector(rb[(i + 1) % len(rb)])
        return lerp(lerp(A0, A1, u), lerp(B0, B1, u), v)

    def nrm(ra, rb, i):
        A0, A1, B0 = Vector(ra[i]), Vector(ra[(i + 1) % len(ra)]), Vector(rb[i])
        n = (A1 - A0).cross(B0 - A0).normalized()
        c = sum((Vector(p) for p in ra), Vector()) / len(ra)
        return n if n.dot(A0 - c) > 0 else -n
    # windscreen: two panes (edge 0 = the front face between r1 and r2)
    n = nrm(r1, r2, 0)
    for (u0, u1) in ((0.03, 0.485), (0.515, 0.97)):
        b.panel('glass', [on(r1, r2, 0, u0, 0.07), on(r1, r2, 0, u1, 0.07), on(r1, r2, 0, u1, 0.93), on(r1, r2, 0, u0, 0.93)], n, off=0.006, frame=0.03)
    # wipers
    for u in (0.2, 0.62):
        p0 = on(r1, r2, 0, u, 0.06) + n * 0.02
        p1 = on(r1, r2, 0, u + 0.14, 0.62) + n * 0.02
        b.beam('black', p0, p1, 0.012, 0.008)
    # sun visor over the windscreen (the roof overhang)
    b.box('paint', -0.83, 0.83, 2.60, 2.635, 1.84, 1.99)
    # doors: outline, window, quarter vent window, handle, hinges; the rear window
    for sx in (-1, 1):
        x = sx * 0.885
        side = (sx, 0, 0)
        outline(b, [(x, 1.13, 1.97), (x, 2.53, 1.97), (x, 2.53, 2.75), (x, 1.13, 2.75), (x, 1.13, 1.97)], side)
        b.panel('glass', [(x, 2.05, 2.10), (x, 2.05, 2.66), (x, 2.49, 2.66), (x, 2.49, 2.10)], side, off=0.006, frame=0.03)
        b.panel('glass', [(x, 2.05, 1.99), (x, 2.05, 2.06), (x, 2.49, 2.06), (x, 2.49, 1.93)], side, off=0.006, frame=0.02)
        vkit.grab_handle(b, (x + sx * 0.01, 1.92, 2.62), (0, 0, 1), side, 0.14, 0.03, 'dark')
        for y in (1.45, 2.3):
            b.cyl('dark', (x + sx * 0.015, y - 0.06, 1.975), (x + sx * 0.015, y + 0.06, 1.975), 0.02, 0.02, 6)
        # handrail on the cab's rear corner
        vkit.grab_handle(b, (x + sx * 0.01, 1.85, 2.8), (0, 1, 0), side, 0.5, 0.04, 'dark')
        # mirrors on stays from the A-pillar base
        vkit.mirror(b, (sx * 0.87, 2.08, 1.86), (sx * 1.33, 2.26, 1.9), (0.18, 0.3))
        b.tube('dark', [(sx * 0.87, 2.5, 1.9), (sx * 1.2, 2.4, 1.9)], 0.01, 5)
    b.panel('glass', [(-0.36, 2.12, 2.851), (0.36, 2.12, 2.851), (0.36, 2.42, 2.851), (-0.36, 2.42, 2.851)], (0, 0, 1), off=0.004, frame=0.03)
    # roof: marker lamps, ribs
    for x in (-0.33, 0.0, 0.33):
        vkit.lamp_box(b, (x, 2.70, 2.1), (0.1, 0.05, 0.06), (0, 0, -1), lens='lens_amber')
    for k in range(5):
        z = 2.18 + k * 0.12
        b.beam('paint', (-0.6, 2.678, z), (0.6, 2.678, z), 0.03, 0.01)
    # air intake on the right: the filter drum beside the hood, a pipe up the A-pillar and its cap
    b.cyl('paint', (1.02, 1.56, 1.62), (1.02, 1.92, 1.62), 0.14, 0.14, 12)
    b.cyl('dark', (1.02, 1.92, 1.62), (1.02, 1.97, 1.62), 0.15, 0.12, 12)
    b.tube('paint', [(0.93, 1.90, 1.64), (0.93, 2.3, 1.84), (0.93, 2.52, 1.84)], 0.05, 8)
    b.cyl('dark', (0.93, 2.52, 1.84), (0.93, 2.6, 1.84), 0.09, 0.07, 10)
    # steps below the doors (on the wings' rear), two treads each
    for sx in (-1, 1):
        b.box('paint', sx * 0.80, sx * 1.12, 0.62, 1.02, 2.08, 2.72)
        for y in (0.74, 0.96):
            b.panel('tread_plate', [(sx * 1.121, y - 0.03, 2.12), (sx * 1.121, y - 0.03, 2.68), (sx * 1.121, y + 0.03, 2.68), (sx * 1.121, y + 0.03, 2.12)], (sx, 0, 0), off=0.003)
    # cab rear wall details: the cab mounts
    b.box('dark', -0.6, 0.6, 1.02, 1.10, 2.6, 2.84)


# ── frame, running gear, tanks ──
def ural_frame(b, zmax=None, fuel_right=True, spare=True, battery=True):
    zmax = zmax or URAL['len']
    f0, f1 = URAL['frame']
    R = URAL['R']
    for sx in (-1, 1):
        b.box('dark', sx * 0.36, sx * 0.44, f0, f1, 0.25, zmax)
    for z in (0.35, 2.0, 3.5, 5.5, zmax - 0.08):
        b.box('dark', -0.36, 0.36, f0 + 0.04, f1 - 0.04, z - 0.05, z + 0.05)
    # front axle: beam, differential, leaf springs, shock absorbers, steering
    za = URAL['axles'][0]
    b.cyl('dark', (-0.9, R, za), (0.9, R, za), 0.07, 0.07, 10)
    b.lathe((0.12, R, za), (0, 0, 1), [(-0.2, 0.05, 'dark'), (-0.12, 0.17, 'dark'), (0.12, 0.17, 'dark'), (0.2, 0.06, 'dark')], n=12)
    for z in URAL['axles'][1:]:
        b.cyl('dark', (-0.9, R, z), (0.9, R, z), 0.07, 0.07, 10)
        b.lathe((0.0, R, z), (0, 0, 1), [(-0.24, 0.05, 'dark'), (-0.14, 0.19, 'dark'), (0.14, 0.19, 'dark'), (0.24, 0.05, 'dark')], n=12)
    for sx in (-1, 1):
        # front leaf spring (stack of arched plates) and shock absorber
        for k in range(4):
            y = f0 - 0.04 - k * 0.022
            b.face([(sx * 0.43, y, za - 0.55 + k * 0.08), (sx * 0.37, y, za - 0.55 + k * 0.08), (sx * 0.37, y - 0.1 + k * 0.02, za), (sx * 0.43, y - 0.1 + k * 0.02, za)], 'dark', want=(0, -1, 0))
            b.face([(sx * 0.43, y - 0.1 + k * 0.02, za), (sx * 0.37, y - 0.1 + k * 0.02, za), (sx * 0.37, y, za + 0.55 - k * 0.08), (sx * 0.43, y, za + 0.55 - k * 0.08)], 'dark', want=(0, -1, 0))
        b.box('dark', sx * 0.36, sx * 0.44, R + 0.04, f0 - 0.14, za - 0.08, za + 0.08)
        b.cyl('dark', (sx * 0.5, R + 0.05, za + 0.18), (sx * 0.47, f0 + 0.1, za + 0.32), 0.035, 0.035, 8)
        # rear bogie: the balancer springs between the rear axles, torque rods
        zb = (URAL['axles'][1] + URAL['axles'][2]) / 2
        b.box('dark', sx * 0.36, sx * 0.44, R + 0.08, f0 - 0.02, URAL['axles'][1] - 0.02, URAL['axles'][2] + 0.02)
        b.cyl('dark', (sx * 0.30, R + 0.25, zb), (sx * 0.52, R + 0.25, zb), 0.11, 0.11, 12)
        b.beam('dark', (sx * 0.2, R + 0.15, URAL['axles'][1]), (sx * 0.2, f0 - 0.05, zb - 0.2), 0.05, 0.05)
        b.beam('dark', (sx * 0.2, R + 0.15, URAL['axles'][2]), (sx * 0.2, f0 - 0.05, zb + 0.2), 0.05, 0.05)
    # drive shafts and the transfer case
    b.box('dark', -0.22, 0.22, 0.64, 0.92, 2.95, 3.45, bev=0.03)
    b.cyl('dark', (0.0, 0.76, 3.0), (0.12, R + 0.02, za + 0.2), 0.045, 0.045, 8)
    b.cyl('dark', (0.0, 0.76, 3.4), (0.0, R + 0.05, URAL['axles'][1] - 0.2), 0.045, 0.045, 8)
    b.cyl('dark', (0.0, R + 0.05, URAL['axles'][1] + 0.2), (0.0, R + 0.05, URAL['axles'][2] - 0.2), 0.045, 0.045, 8)
    # engine sump / gearbox under the cab
    b.box('dark', -0.3, 0.3, 0.72, 0.96, 0.6, 2.6, bev=0.04)
    # fuel tank(s): boxes outboard of the frame between the cab and the middle axle
    tanks = [(-1)] + ([1] if fuel_right else [])
    for sx in tanks:
        b.box('paint', sx * 0.47, sx * 1.12, 0.60, 1.08, 2.98, 4.05, bev=0.04)
        b.cyl('dark', (sx * 0.9, 1.08, 3.3), (sx * 0.9, 1.13, 3.3), 0.06, 0.06, 8)
        for z in (3.15, 3.85):
            b.box('dark', sx * 0.46, sx * 1.13, 0.58, 0.62, z - 0.03, z + 0.03)
            b.box('dark', sx * 0.46, sx * 1.13, 1.06, 1.10, z - 0.03, z + 0.03)
    if not fuel_right:
        # battery box and air tanks on the right
        b.box('paint', 0.47, 1.05, 0.64, 1.06, 3.0, 3.6, bev=0.03)
        vkit.grab_handle(b, (1.06, 0.9, 3.3), (0, 0, 1), (1, 0, 0), 0.2, 0.03, 'dark')
        b.cyl('paint', (0.62, 0.72, 3.7), (0.62, 0.72, 4.3), 0.13, 0.13, 12)
        b.cyl('paint', (0.92, 0.72, 3.7), (0.92, 0.72, 4.3), 0.13, 0.13, 12)
    # muffler and tail pipe under the right step
    b.cyl('dark', (0.6, 0.66, 2.1), (0.6, 0.66, 2.8), 0.1, 0.1, 10)
    b.tube('dark', [(0.6, 0.66, 2.8), (0.7, 0.6, 2.95), (0.85, 0.55, 3.0)], 0.035, 6)
    b.empty('exhaust', (0.86, 0.55, 3.0), (1, -0.3, 0.3))
    # spare wheel upright behind the cab (right), battery / tool box beside it (left)
    if spare:
        sw = vec((0.57, 1.88, 3.14))
        b.cyl('tyre', sw + Vector((0, 0, -0.19)), sw + Vector((0, 0, 0.19)), 0.60, 0.60, 20)
        b.cyl('dark', sw + Vector((0, 0, -0.195)), sw + Vector((0, 0, 0.195)), 0.28, 0.28, 16)
        b.box('dark', 0.0, 1.1, 1.10, 1.24, 3.0, 3.3)
        b.beam('dark', (0.0, 1.2, 3.3), (0.0, 2.3, 3.3), 0.06, 0.06)
    if battery:
        b.box('paint', -1.0, -0.1, 1.10, 1.72, 2.95, 3.35, bev=0.03)
        for x in (-0.75, -0.35):
            b.cyl('dark', (x, 1.72, 3.15), (x, 1.76, 3.15), 0.06, 0.06, 10)
        vkit.grab_handle(b, (-1.01, 1.45, 3.15), (0, 0, 1), (-1, 0, 0), 0.2, 0.03, 'dark')


def rear_end(b, zr, y=0.95, lamps=True, hitch=True, mudflaps=True):
    """rear cross member, tail lamps, pintle hook"""
    b.box('dark', -1.0, 1.0, 0.82, 1.08, zr - 0.12, zr)
    if lamps:
        for sx in (-1, 1):
            vkit.lamp_box(b, (sx * 0.9, y, zr + 0.03), (0.2, 0.1, 0.06), (0, 0, 1), lens='lens_red')
            vkit.lamp_box(b, (sx * 0.9, y - 0.1, zr + 0.03), (0.1, 0.07, 0.06), (0, 0, 1), lens='lens_amber')
    if hitch:
        b.box('dark', -0.1, 0.1, 0.68, 0.84, zr, zr + 0.1)
        b.tube('dark', [(0, 0.76, zr + 0.1), (0, 0.76, zr + 0.2), (0, 0.66, zr + 0.24), (0, 0.6, zr + 0.18)], 0.03, 6)


def rear_fenders(b, z0, z1, y=1.28, sx_list=(-1, 1)):
    """flat mudguards over the rear bogie (hung under a body floor) with rubber flaps"""
    for sx in sx_list:
        b.box('paint', sx * 0.78, sx * 1.24, y - 0.04, y, z0, z1)
        b.box('paint', sx * 1.20, sx * 1.24, y - 0.22, y, z0, z1)
        b.box('rubber', sx * 0.80, sx * 1.22, 0.42, y - 0.04, z1 - 0.02, z1 + 0.01)


def ural(v, body, zmax=None, fuel_right=True, spare=True, battery=True, rim='dark'):
    """the common Ural-4320 chassis on `body`: front end, cab, frame, running gear, wheels"""
    ural_front(body)
    ural_cab(body)
    ural_frame(body, zmax, fuel_right, spare, battery)
    wheels(v, None, rim_skin=rim, hub_skin=rim)
    body.empty('seat_driver', (-0.42, 1.75, 2.35), (0, 0, -1))
    body.empty('hatch_entry', (-1.35, 0.0, 2.35), (1, 0, 0))
    return {'zmax': zmax or URAL['len']}


# ── bodies shared by several Ural vehicles ──
def cargo_bed(b, z0, z1, hx=1.2, y0=1.30, y1=1.38, sides=0.64, drop_sides=True, skip_rear=False):
    """a flatbed with wooden-slatted fold-down side boards (the Ural-4320 cargo body)"""
    b.box('dark', -0.46, 0.46, URAL['frame'][1], y0, z0 + 0.1, z1 - 0.1)          # sub-frame
    for z in [z0 + 0.3 + i * (z1 - z0 - 0.6) / 5 for i in range(6)]:
        b.box('dark', -hx, hx, y0 - 0.08, y0, z - 0.04, z + 0.04)                  # cross bearers
    b.box('paint', -hx, hx, y0, y1, z0, z1)                                         # floor
    top = y1 + sides
    for sx in (-1, 1):
        b.box('paint', sx * (hx - 0.04), sx * hx, y1, top, z0, z1)
        for k in range(3):
            y = y1 + 0.12 + k * 0.2
            b.box('paint', sx * hx, sx * (hx + 0.015), y, y + 0.05, z0 + 0.05, z1 - 0.05)
        for z in [z0 + 0.1 + i * (z1 - z0 - 0.2) / 4 for i in range(5)]:
            b.box('dark', sx * hx, sx * (hx + 0.03), y1, top, z - 0.03, z + 0.03)
    b.box('paint', -hx, hx, y1, top + 0.08, z0, z0 + 0.04)                          # front board (a bit higher)
    if not skip_rear:
        b.box('paint', -hx, hx, y1, top, z1 - 0.04, z1)
        for k in range(3):
            y = y1 + 0.12 + k * 0.2
            b.box('paint', -hx + 0.05, hx - 0.05, y, y + 0.05, z1, z1 + 0.015)
    return top
