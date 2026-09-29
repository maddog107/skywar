# ═══════════════════════════════════════════════════════════════
# 9P117 Scud TEL (MAZ-543A chassis) — the LEFT cab, the driver's. A room WITH windows: the game draws it in the
# world's scene so you drive looking out (no lights; 'Glass' panes are see-through). Blender, headless:
#   blender -b -P tools/interiors/tel_cab.py -- models/interiors/tel_cab.glb
# Room frame: the origin is the cab floor's centre (the footwell floor), x right, y up, −z forward. In the vehicle
# frame of models/vehicles/scud.glb (vehicle faces −z, wheels on y 0; the model is recentred 6.002 m aft of the
# bumper face — seat_driver sits at (−1.0, 2.0, −4.252) there, (−1.0, 2.0, 1.75) in tools/vehicles/scud.py) the
# origin is at (−1.145, 1.45, −4.337). The shell follows the exterior cab of tools/vehicles/chassis.py maz_cab()
# (left cab: outer face x −1.52, inner face −0.47 over the windscreen foot and −0.77 below it, front z 0.38, rear
# 2.95 from the bumper, windscreen band y 2.02..2.76, roof 2.92) 3 cm inside it, and every window opening sits on
# the exterior's glass: the raked windscreen, the chamfered corner window, the door window, the rear side window,
# the small inner side window (toward the missile's nose) and the rear window.
# The MAZ-543 (https://en.wikipedia.org/wiki/MAZ-543): the engine between two fibreglass two-seat cabs, the seats in
# tandem, the driver in front in the LEFT cab and the commander behind him; the launch crew's cabin is separate
# (tel_cabin.glb). References for the launcher: https://missilery.info/missile/8k14/9p117 ,
# https://en.wikipedia.org/wiki/Scud .
# Inside: the driver's sprung seat, the big flat steering wheel on a raked column, the instrument panel under the
# windscreen (speedometer, tachometer, oil, coolant, the two-needle brake-air gauge, the tyre-pressure gauge of the
# central inflation system, voltmeter, fuel, warning lamps), the gear selector, pedals, the parking brake lever,
# the commander's seat behind on the raised floor over the front wheel, the radio and intercom, a fan, sun visors.
# ═══════════════════════════════════════════════════════════════
import sys, os, math
sys.dont_write_bytecode = True
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import roomkit as R
from roomkit import PI
from shipkit import Part, material, srgb, MATS, lerp
from mathutils import Vector

args = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
OUT = args[0] if args else 'models/interiors/tel_cab.glb'

R.begin()
S = R.static()
for name, col, metal, rough in [
    ('ConsoleGreen', 0x5d6b57, 0.25, 0.55), ('ConsoleGreenDark', 0x3b4638, 0.25, 0.55), ('Paint', 0xe6e2d4, 0.0, 0.7),
    ('WallCab', 0xaeb5a6, 0.1, 0.65), ('Bakelite', 0x1d1714, 0.1, 0.35), ('Olive', 0x4f5638, 0.1, 0.8),
    ('Dash', 0x24282a, 0.1, 0.7),
]:
    material(name, srgb(col), metal, rough)

# ── the exterior cab (tools/vehicles/chassis.py maz_cab, sx = −1), in the chassis builder's frame (z from the bumper) ──
sx = -1
xo, xi, xil = -1.52, -0.47, -0.77
c = 0.30
y0, yb, yw0, yw1, yr = 1.40, 1.62, 2.02, 2.76, 2.92
zf, zr = 0.38, 2.95


def plan(zfront, zrear, xin, xout, ch):
    return [(xin, zfront), (xout - sx * ch, zfront), (xout, zfront + ch), (xout, zrear), (xin, zrear)]


r0 = [Vector((x, yw0, z)) for (x, z) in plan(zf, zr, xi, xo, c)]
r1 = [Vector((x, yw1, z)) for (x, z) in plan(zf + 0.22, zr - 0.02, xi, xo, c * 0.92)]
r2 = [Vector((x, yr, z)) for (x, z) in plan(zf + 0.36, zr - 0.12, xi - sx * 0.07 * 0.3, xo - sx * 0.07, c * 0.8)]


def on(ra, rb, i, u, v):
    A0, A1 = ra[i], ra[(i + 1) % len(ra)]
    B0, B1 = rb[i], rb[(i + 1) % len(rb)]
    return (A0.lerp(A1, u)).lerp(B0.lerp(B1, u), v)


def fnorm_in(ra, rb, i):
    """the inward normal of the loft face between rings ra and rb on edge i"""
    A0, A1, B0 = ra[i], ra[(i + 1) % len(ra)], rb[i]
    n = (A1 - A0).cross(B0 - A0).normalized()
    cen = sum(ra, Vector()) / len(ra)
    return -n if n.dot(A0 - cen) > 0 else n


# ── the room's origin (the footwell floor's centre) in that frame; the vehicle frame is 6.002 m further forward ──
OX, OY, OZ = -1.145, 1.45, 1.665
T = 0.03                      # the lining sits 3 cm inside the skin


def VF(p):
    return (p[0] - OX, p[1] - OY, p[2] - OZ)


def quad(mat, pts, n, uvs=None):
    """a face from chassis-frame points (converted to the room frame), metre UVs on its dominant plane"""
    pts = [VF(p) for p in pts]
    if uvs is None:
        ax = max(range(3), key=lambda i: abs(n[i]))
        uvs = [(p[0], p[2]) if ax == 1 else (p[2], p[1]) if ax == 0 else (p[0], p[1]) for p in pts]
    S.g(mat).face(pts, uvs, tuple(n))


def box(mat, x0, x1, y0_, y1_, z0, z1, skip=()):
    a, b = VF((x0, y0_, z0)), VF((x1, y1_, z1))
    R.uvbox(S, mat, a[0], b[0], a[1], b[1], a[2], b[2], skip=skip)


def grid_wall(mat, P0, eu, ev, us, vs, holes, n):
    """a planar wall P0 + u·eu + v·ev over the breakpoints us × vs, the cells inside `holes` [(u0, u1, v0, v1)] left open"""
    P0, eu, ev = Vector(P0), Vector(eu), Vector(ev)
    for i in range(len(us) - 1):
        for j in range(len(vs) - 1):
            cu, cv = (us[i] + us[i + 1]) / 2, (vs[j] + vs[j + 1]) / 2
            if any(h[0] <= cu <= h[1] and h[2] <= cv <= h[3] for h in holes):
                continue
            q = [P0 + eu * us[i] + ev * vs[j], P0 + eu * us[i + 1] + ev * vs[j], P0 + eu * us[i + 1] + ev * vs[j + 1], P0 + eu * us[i] + ev * vs[j + 1]]
            quad(mat, [tuple(p) for p in q], n)


def seal(P0, eu, ev, u0, u1, v0, v1, n, w=0.022, glass=True):
    """a rubber seal round a window opening (just proud of the lining) and the glass pane in it"""
    P0, eu, ev, nn = Vector(P0), Vector(eu), Vector(ev), Vector(n) * 0.004
    lu, lv = eu.length, ev.length
    du, dv = w / lu, w / lv
    for (a0, a1, b0, b1) in ((u0 - du, u1 + du, v0 - dv, v0), (u0 - du, u1 + du, v1, v1 + dv), (u0 - du, u0, v0, v1), (u1, u1 + du, v0, v1)):
        q = [P0 + eu * a0 + ev * b0 + nn, P0 + eu * a1 + ev * b0 + nn, P0 + eu * a1 + ev * b1 + nn, P0 + eu * a0 + ev * b1 + nn]
        quad('Rubber', [tuple(p) for p in q], n)
    if glass:
        q = [P0 + eu * u0 + ev * v0 - nn, P0 + eu * u1 + ev * v0 - nn, P0 + eu * u1 + ev * v1 - nn, P0 + eu * u0 + ev * v1 - nn]
        quad('Glass', [tuple(p) for p in q], n)


# ═════════════ the shell (all faces point into the cab) ═════════════
# floor: the footwell (y 1.45) ahead of the front wheel, the raised floor over it (y 1.66) behind z 1.80
XO_, XIU, XIL = xo + T, xi - T, xil - T                     # lining planes: outer, inner (upper), inner (lower)
FL, FR = 1.45, 1.66
ZFR = zf + T
# the lower chamfer's lining line: x + z = k
k_ch = (-1.22 + 0.0212) + (0.38 + 0.0212)
zc_lo = k_ch - XO_                                           # where it meets the outer lining (z)
xc_lo = k_ch - ZFR                                           # where it meets the front lining (x)
quad('Rubber', [(XIL, FL, ZFR), (xc_lo, FL, ZFR), (XO_, FL, zc_lo), (XO_, FL, 1.80), (XIL, FL, 1.80)], (0, 1, 0))
quad('ConsoleGreen', [(XO_, FL, 1.80), (XIL, FL, 1.80), (XIL, FR, 1.80), (XO_, FR, 1.80)], (0, 0, -1))
quad('Rubber', [(XO_, FR, 1.80), (XO_, FR, zr - T), (XIL, FR, zr - T), (XIL, FR, 1.80)], (0, 1, 0))
# the front below the windscreen, the lower chamfer
quad('WallCab', [(XIL, FL, ZFR), (xc_lo, FL, ZFR), (xc_lo, yw0, ZFR), (XIL, yw0, ZFR)], (0, 0, 1))
quad('WallCab', [(xc_lo, FL, ZFR), (XO_, FL, zc_lo), (XO_, yw0, zc_lo), (xc_lo, yw0, ZFR)], (0.707, 0, 0.707))
# the inner walls: lower (x −0.80) to the windscreen foot, the sill (a shelf over the hood between the cabs), upper
quad('WallCab', [(XIL, FL, ZFR), (XIL, FL, 1.80), (XIL, yw0, 1.80), (XIL, yw0, ZFR)], (1, 0, 0))
quad('WallCab', [(XIL, FR, 1.80), (XIL, FR, zr - T), (XIL, yw0, zr - T), (XIL, yw0, 1.80)], (1, 0, 0))
quad('ConsoleGreen', [(XIL, yw0, ZFR), (XIL, yw0, zr - T), (XIU, yw0, zr - T), (XIU, yw0, ZFR)], (0, 1, 0))
# the upper inner wall with the small window toward the missile's nose (exterior glass z 2.25..2.75, y 2.15..2.62)
zws0 = zf + T                                              # the windscreen lining's foot / top z on the inner side
zws1 = zf + 0.22 + T
grid_wall('WallCab', (XIU, yw0, zws1), (0, 0, 1), (0, 1, 0), [0.0, 2.25 - zws1, 2.75 - zws1, zr - T - zws1], [0.0, 0.13, 0.60, yw1 - yw0],
          [(2.25 - zws1, 2.75 - zws1, 0.13, 0.60)], (-1, 0, 0))
quad('WallCab', [(XIU, yw0, zws0), (XIU, yw0, zws1), (XIU, yw1, zws1)], (-1, 0, 0))
seal((XIU, yw0, zws1), (0, 0, 1), (0, 1, 0), 2.25 - zws1, 2.75 - zws1, 0.13, 0.60, (-1, 0, 0))
# the outer wall: the door opening (z 1.36..2.08, y 1.66..2.74: the door node fills it) and the rear side window
# (exterior glass z 2.20..2.74, y 2.12..2.68); in front, the slanted edge where the upper chamfer meets it
zc_hi = on(r0, r1, 1, 1.0, 1.0).z + T * 1.0                # the chamfer's back edge at the windscreen top (z ≈ 0.9)
quad('WallCab', [(XO_, FL, zc_lo), (XO_, FL, zc_hi), (XO_, yw0, zc_hi), (XO_, yw0, zc_lo)], (1, 0, 0))
quad('WallCab', [(XO_, yw0, zc_lo), (XO_, yw0, zc_hi), (XO_, yw1, zc_hi)], (1, 0, 0))
grid_wall('WallCab', (XO_, FL, zc_hi), (0, 0, 1), (0, 1, 0),
          [0.0, 1.36 - zc_hi, 2.08 - zc_hi, 2.20 - zc_hi, 2.74 - zc_hi, zr - T - zc_hi],
          [0.0, FR - FL, 2.12 - FL, 2.68 - FL, 2.74 - FL, yw1 - FL],
          [(1.36 - zc_hi, 2.08 - zc_hi, FR - FL, 2.74 - FL), (2.20 - zc_hi, 2.74 - zc_hi, 2.12 - FL, 2.68 - FL)], (1, 0, 0))
seal((XO_, FL, zc_hi), (0, 0, 1), (0, 1, 0), 2.20 - zc_hi, 2.74 - zc_hi, 2.12 - FL, 2.68 - FL, (1, 0, 0))
# the door's frame in the lining (a steel surround round the opening)
for (a, b, cc, d) in ((1.33, 1.36, FR, 2.77), (2.08, 2.11, FR, 2.77), (1.33, 2.11, 2.74, 2.77)):
    box('Steel', XO_, XO_ + 0.02, cc, d, a, b)
# the rear wall: the rear window (exterior glass: edge 3, u 0.22..0.8, v 0.2..0.8)
ZRW = zr - T
rw0, rw1 = on(r0, r1, 3, 0.22, 0.2), on(r0, r1, 3, 0.8, 0.8)
xa_, xb_ = sorted((rw0.x, rw1.x))
grid_wall('WallCab', (XO_, yw0, ZRW), (1, 0, 0), (0, 1, 0), [0.0, xa_ - XO_, xb_ - XO_, XIU - XO_], [0.0, rw0.y - yw0, rw1.y - yw0, yw1 - yw0],
          [(xa_ - XO_, xb_ - XO_, rw0.y - yw0, rw1.y - yw0)], (0, 0, -1))
quad('WallCab', [(XO_, FR, ZRW), (XIL, FR, ZRW), (XIL, yw0, ZRW), (XO_, yw0, ZRW)], (0, 0, -1))
seal((XO_, yw0, ZRW), (1, 0, 0), (0, 1, 0), xa_ - XO_, xb_ - XO_, rw0.y - yw0, rw1.y - yw0, (0, 0, -1))
# the raked windscreen (edge 0, glass u 0.06..0.94, v 0.1..0.9) and the corner window (edge 1, u 0.12..0.88, v 0.14..0.86)
for (edge, ua, ub, va, vb, u_lo) in ((0, 0.06, 0.94, 0.1, 0.9, T / 0.75), (1, 0.12, 0.88, 0.14, 0.86, 0.0)):
    nin = fnorm_in(r0, r1, edge)
    us = [u_lo, ua, ub, 1.0]
    vs = [0.0, va, vb, 1.0]
    for i in range(3):
        for j in range(3):
            if i == 1 and j == 1:
                continue
            q = [on(r0, r1, edge, us[i], vs[j]) + nin * T, on(r0, r1, edge, us[i + 1], vs[j]) + nin * T,
                 on(r0, r1, edge, us[i + 1], vs[j + 1]) + nin * T, on(r0, r1, edge, us[i], vs[j + 1]) + nin * T]
            quad('WallCab', [tuple(p) for p in q], tuple(nin))
    # the seal and the glass
    corners = [on(r0, r1, edge, ua, va), on(r0, r1, edge, ub, va), on(r0, r1, edge, ub, vb), on(r0, r1, edge, ua, vb)]
    corners = [p + nin * (T - 0.004) for p in corners]
    quad('Glass', [tuple(p) for p in corners], tuple(nin))
    eu, ev = (corners[1] - corners[0]), (corners[3] - corners[0])
    w = 0.022
    for (a0, a1, b0, b1) in ((-w, 1 + w, -w, 0), (-w, 1 + w, 1, 1 + w), (-w, 0, 0, 1), (1, 1 + w, 0, 1)):
        du, dv = (a0 if abs(a0) > 0.5 or a0 == 0 else a0 / eu.length), (b0 if abs(b0) > 0.5 or b0 == 0 else b0 / ev.length)
        uu0 = a0 / eu.length if a0 < 0 else (1 + (a0 - 1) / eu.length if a0 > 1 else a0)
        uu1 = a1 / eu.length if a1 < 0 else (1 + (a1 - 1) / eu.length if a1 > 1 else a1)
        vv0 = b0 / ev.length if b0 < 0 else (1 + (b0 - 1) / ev.length if b0 > 1 else b0)
        vv1 = b1 / ev.length if b1 < 0 else (1 + (b1 - 1) / ev.length if b1 > 1 else b1)
        p0 = corners[0] + nin * 0.008
        q = [p0 + eu * uu0 + ev * vv0, p0 + eu * uu1 + ev * vv0, p0 + eu * uu1 + ev * vv1, p0 + eu * uu0 + ev * vv1]
        quad('Rubber', [tuple(p) for p in q], tuple(nin))
# the headliner: the ceiling at y 2.86 and the strips from the wall tops (y 2.76) up to it
tc = (2.86 - yw1) / (yr - yw1)
rc = [a.lerp(b, tc) for a, b in zip(r1, r2)]
cen = sum(rc, Vector()) / len(rc)
rci = []
for p in rc:
    d = Vector((cen.x - p.x, 0, cen.z - p.z))
    rci.append(p + d.normalized() * T * 1.2 + Vector((0, -0.005, 0)))
quad('WallCab', [tuple(p) for p in rci], (0, -1, 0))
tops = [on(r0, r1, 0, T / 0.75, 1.0) + fnorm_in(r0, r1, 0) * T, on(r0, r1, 1, 0.0, 1.0) + fnorm_in(r0, r1, 1) * T,
        Vector((XO_, yw1, zc_hi)), Vector((XO_, yw1, ZRW)), Vector((XIU, yw1, ZRW))]
tops.append(Vector((XIU, yw1, zws1)))
ring_c = [rci[0], rci[1], rci[2], rci[3], rci[4], rci[0]]
wall_t = [tops[5], tops[1], tops[2], tops[3], tops[4], tops[5]]
wall_t = [Vector((XIU, yw1, zws1)), on(r0, r1, 1, 0.0, 1.0) + fnorm_in(r0, r1, 1) * T, Vector((XO_, yw1, zc_hi)), Vector((XO_, yw1, ZRW)), Vector((XIU, yw1, ZRW))]
for i in range(5):
    j = (i + 1) % 5
    q = [wall_t[i], wall_t[j], rci[j], rci[i]]
    mid = (q[0] + q[1]) / 2
    nrm = Vector((cen.x - mid.x, -0.6, cen.z - mid.z)).normalized()
    quad('WallCab', [tuple(p) for p in q], tuple(nrm))
# a roof hatch in the headliner (the exterior's hatch), grab handles, the dome lamp
hx = (xo + xi) / 2
box('Steel', hx - 0.3, hx + 0.3, 2.84, 2.855, 1.6, 2.2, skip=('top',))
box('ConsoleGreen', hx - 0.27, hx + 0.27, 2.83, 2.845, 1.63, 2.17, skip=('top',))
for z in (1.7, 2.1):
    box('Chrome', hx - 0.02, hx + 0.02, 2.79, 2.83, z - 0.06, z + 0.06, skip=('top',))
S.cyl('Chrome', VF((hx + 0.25, 0, 2.6)), 0.06, 0.06, VF((0, 2.83, 0))[1], VF((0, 2.85, 0))[1], 10, cap1=False)
S.sphere('LampWhite', VF((hx + 0.25, 2.83, 2.6)), 0.05, 0.025, 0.05, 10, 3, v0=0.0, v1=0.5)
R._tube(S, VF((XO_ + 0.05, 2.62, 1.2)), VF((XO_ + 0.05, 2.62, 1.3)), 0.012, 'Black', 6)
mark_n = [0]


def mark(what):
    n = S.tris()
    print('  [cab] %-20s %6d tris (total %d)' % (what, n - mark_n[0], n))
    mark_n[0] = n


mark('shell')

# ═════════════ the instrument panel under the windscreen ═════════════
DX = OX                        # the driver's centre line (x)
# the dash: a shelf along the windscreen foot, the cluster facing the driver, a lower console
box('Dash', XO_ + 0.12, XIL, yw0 - 0.02, yw0 + 0.04, ZFR, 0.62)
box('Dash', XO_ + 0.12, XIL, 1.62, yw0 - 0.02, ZFR, 0.5, skip=('pz',))
ct = math.radians(30)
Mc = R.mat3(0, ct)
cc = VF((DX, 1.93, 0.62))
R.obox(S, 'Dash', Mc, cc, -0.3, 0.3, -0.11, 0.11, -0.12, 0.0)
R.obox(S, 'Black', Mc, cc, -0.28, 0.28, -0.1, 0.1, 0.0, 0.004)
R.obox(S, 'Dash', R.mat3(0, ct), R.xf(Mc, cc, (0, 0.11, 0.0)), -0.3, 0.3, 0.0, 0.035, -0.1, 0.06)       # the hood over the gauges


def gauge(M, o, x, y, r, needle=0.5, face='Black'):
    cg = R.xf(M, o, (x, y, 0.004))
    R.ocyl(S, 'Chrome', M, cg, (0, 0, 0), r * 1.12, r * 1.12, 0.0, 0.01, 14, axis='z', cap0=False)
    R.ocyl(S, face, M, cg, (0, 0, 0), r, r, 0.0, 0.011, 14, axis='z', cap0=False)
    for k in range(9):
        a = -2.3 + 4.6 * k / 8
        dx, dy = math.sin(a), math.cos(a)
        L = r * (0.25 if k % 2 == 0 else 0.14)
        p0, p1 = (dx * (r * 0.92 - L), dy * (r * 0.92 - L)), (dx * r * 0.92, dy * r * 0.92)
        sx_, sy_ = dy * 0.002, -dx * 0.002
        S.g('Paint').face([R.xf(M, cg, (p0[0] - sx_, p0[1] - sy_, 0.0115)), R.xf(M, cg, (p1[0] - sx_, p1[1] - sy_, 0.0115)), R.xf(M, cg, (p1[0] + sx_, p1[1] + sy_, 0.0115)), R.xf(M, cg, (p0[0] + sx_, p0[1] + sy_, 0.0115))], None, tuple(M @ Vector((0, 0, 1))))
    a = -2.3 + 4.6 * needle
    dx, dy = math.sin(a), math.cos(a)
    S.g('Orange').face([R.xf(M, cg, (-dy * 0.0018, dx * 0.0018, 0.0125)), R.xf(M, cg, (dx * r * 0.85, dy * r * 0.85, 0.0125)), R.xf(M, cg, (dy * 0.0018, -dx * 0.0018, 0.0125))], None, tuple(M @ Vector((0, 0, 1))))


# speedometer and tachometer big in the middle, the small instruments round them
gauge(Mc, cc, -0.085, 0.0, 0.07, 0.25)
gauge(Mc, cc, 0.085, 0.0, 0.07, 0.35)
R.label('км/ч', R.xf(Mc, cc, (-0.085, -0.03, 0.017)), 0.0, ct, h=0.011, st='e')
R.label('об/мин', R.xf(Mc, cc, (0.085, -0.03, 0.017)), 0.0, ct, h=0.011, st='e')
for k, (x, y, lab, nd) in enumerate(((-0.235, 0.045, 'МАСЛО', 0.55), (-0.235, -0.045, 'ВОДА', 0.5), (0.235, 0.045, 'ВОЗДУХ', 0.7), (0.235, -0.045, 'ШИНЫ', 0.45))):
    gauge(Mc, cc, x, y, 0.036, nd)
    R.label(lab, R.xf(Mc, cc, (x - 0.055 if x < 0 else x + 0.055, y, 0.006)), 0.0, ct, h=0.009, st='e', roll=0.0) if False else None
R.label('OIL · WATER', R.xf(Mc, cc, (-0.235, 0.095, 0.006)), 0.0, ct, h=0.008, st='e')
R.label('AIR · TYRES', R.xf(Mc, cc, (0.235, 0.095, 0.006)), 0.0, ct, h=0.008, st='e')
# the lower row: voltmeter, fuel, warning lamps; the brake lamp (live) among them
for k, (x, m) in enumerate(((-0.17, 'LampAmber'), (-0.14, 'LampGreen'), (0.14, 'LampAmber'), (0.2, 'LampBlue'))):
    c0 = R.xf(Mc, cc, (x, -0.085, 0.004))
    R.ocyl(S, 'Chrome', Mc, c0, (0, 0, 0), 0.011, 0.011, 0.0, 0.005, 6, axis='z', cap0=False)
    R.ocyl(S, m, Mc, c0, (0, 0, 0), 0.008, 0.006, 0.005, 0.011, 8, axis='z', cap0=False)
R.lamp('lamp_brake', R.xf(Mc, cc, (0.0, -0.08, 0.004)), 0.0, ct, r=0.012, color='#ff3a20', mat='LampRed')
R.label('BRAKE [ТОРМОЗ]', R.xf(Mc, cc, (0.0, -0.1, 0.006)), 0.0, ct, h=0.009, st='r')
mark('instruments')

# the switch panel to the right of the cluster (toward the inner wall): the engine start button, lights, wipers, heater
Ms = R.mat3(0.35, math.radians(38))
so = VF((DX + 0.4, 1.9, 0.62))
R.obox(S, 'Dash', Ms, so, -0.1, 0.1, -0.1, 0.1, -0.06, 0.0)
R.obox(S, 'Black', Ms, so, -0.095, 0.095, -0.095, 0.095, 0.0, 0.003)
R.button('btn_start', R.xf(Ms, so, (0.0, 0.03, 0.003)), 0.35, math.radians(38), r=0.02, mat='Red')
R.label('ENGINE START', R.xf(Ms, so, (0.0, -0.005, 0.005)), 0.35, math.radians(38), h=0.011, st='w')
R.label('[ПУСК ДВИГ.]', R.xf(Ms, so, (0.0, -0.02, 0.005)), 0.35, math.radians(38), h=0.009, st='e')
for k in range(4):
    x = -0.07 + k * 0.047
    cs = R.xf(Ms, so, (x, -0.065, 0.003))
    R.ocyl(S, 'Chrome', Ms, cs, (0, 0, 0), 0.007, 0.007, 0.0, 0.005, 6, axis='z', cap0=False)
    S.beam('Chrome', R.xf(Ms, cs, (0, 0, 0.005)), R.xf(Ms, cs, (0, 0.009 if k % 2 else -0.009, 0.024)), 0.004, caps=False)
R.label('СВЕТ · ФАРЫ · ДВОРН. · ОТОП.', R.xf(Ms, so, (0.0, -0.088, 0.005)), 0.35, math.radians(38), h=0.007, st='e')
# the ignition key / mass switch on the left of the cluster
Mk = R.mat3(-0.3, math.radians(38))
ko = VF((DX - 0.36, 1.9, 0.62))
R.obox(S, 'Dash', Mk, ko, -0.07, 0.07, -0.07, 0.07, -0.05, 0.0)
R.ocyl(S, 'Chrome', Mk, R.xf(Mk, ko, (0.0, 0.015, 0.0)), (0, 0, 0), 0.016, 0.016, 0.0, 0.008, 10, axis='z', cap0=False)
R.obox(S, 'Brass', Mk, R.xf(Mk, ko, (0.0, 0.015, 0.008)), -0.003, 0.003, -0.012, 0.012, 0.0, 0.025)
R.label('МАССА · BATT', R.xf(Mk, ko, (0.0, -0.035, 0.002)), -0.3, math.radians(38), h=0.009, st='e')
mark('switch panel')

# ═════════════ the steering wheel, column, gear selector, pedals, the parking brake ═════════════
sw_c = VF((DX, 2.12, 0.98))
st_t = math.radians(58)                     # the wheel's plane leans back toward the driver (a flat bus-like wheel)
Mw = R.mat3(0, st_t)
n_ring = 20
Rw = 0.24
for k in range(n_ring):
    a0, a1 = 2 * PI * k / n_ring, 2 * PI * (k + 1) / n_ring
    R._tube(S, R.xf(Mw, sw_c, (math.cos(a0) * Rw, math.sin(a0) * Rw, 0.0)), R.xf(Mw, sw_c, (math.cos(a1) * Rw, math.sin(a1) * Rw, 0.0)), 0.016, 'Black', 6)
for a in (PI / 2 + 0.15, PI + PI / 2 - 0.9, -0.9 + PI / 2 + PI):
    pass
for a in (-PI / 2, PI / 6 + 0.1, PI - PI / 6 - 0.1):
    S.beam('Chrome', R.xf(Mw, sw_c, (0, 0, -0.01)), R.xf(Mw, sw_c, (math.cos(a) * Rw, math.sin(a) * Rw, 0.0)), 0.02, 0.008, caps=False)
R.ocyl(S, 'Black', Mw, sw_c, (0, 0, 0), 0.045, 0.04, -0.04, 0.012, 10, axis='z', cap0=False)
R.ocyl(S, 'Red', Mw, sw_c, (0, 0, 0), 0.025, 0.025, 0.012, 0.016, 10, axis='z', cap0=False)
col_end = R.xf(Mw, sw_c, (0, 0, -0.05))
col_base = VF((DX, 1.62, 0.58))
R._tube(S, col_end, col_base, 0.035, 'Dash', 8)
R._tube(S, R.xf(Mw, sw_c, (0, 0, -0.05)), R.xf(Mw, sw_c, (0, 0, -0.2)), 0.05, 'Dash', 8)
S.beam('Black', R.xf(Mw, sw_c, (-0.06, 0.0, -0.1)), R.xf(Mw, sw_c, (-0.16, -0.02, -0.1)), 0.012, caps=False)     # the indicator stalk
# pedals: brake (centre) and throttle (right); the dimmer button on the floor at left
for (px, w_, h_) in ((DX - 0.06, 0.1, 0.12), (DX + 0.14, 0.07, 0.2)):
    Mp = R.mat3(0, math.radians(60))
    po = VF((px, 1.56, 0.62))
    R.obox(S, 'Rubber', Mp, po, -w_ / 2, w_ / 2, -h_ / 2, h_ / 2, 0.0, 0.015)
    S.beam('Steel', R.xf(Mp, po, (0, h_ / 2 - 0.02, 0)), VF((px, 1.7, 0.47)), 0.02, caps=False)
S.cyl('Steel', VF((DX - 0.26, 0, 0.6)), 0.02, 0.02, VF((0, FL, 0))[1], VF((0, FL + 0.03, 0))[1], 8, cap0=False)
# the gear selector of the hydromechanical box, in its gate to the driver's right
gb = VF((DX + 0.26, FL, 1.1))
R.uvbox(S, 'Dash', gb[0] - 0.07, gb[0] + 0.07, gb[1], gb[1] + 0.22, gb[2] - 0.12, gb[2] + 0.12)
R.uvbox(S, 'Black', gb[0] - 0.012, gb[0] + 0.012, gb[1] + 0.221, gb[1] + 0.222, gb[2] - 0.09, gb[2] + 0.09)
S.beam('Chrome', (gb[0], gb[1] + 0.22, gb[2] - 0.03), (gb[0] - 0.01, gb[1] + 0.55, gb[2] + 0.02), 0.018, caps=False)
S.sphere('Bakelite', (gb[0] - 0.01, gb[1] + 0.57, gb[2] + 0.02), 0.03, 0.03, 0.03, 10, 6)
R.label('Н · 1 · 2 · 3 · З', (gb[0], gb[1] + 0.223, gb[2] + 0.1), 0.0, PI / 2, h=0.012, st='w')
# the parking brake lever (a switch: k 0 released, forward — k 1 applied, pulled back)
pb = VF((DX + 0.3, FL + 0.18, 1.42))
R.uvbox(S, 'Dash', pb[0] - 0.05, pb[0] + 0.05, FL - OY, pb[1], pb[2] - 0.1, pb[2] + 0.1)
lev = Part('sw_brake')
a = 0.5
tip = (0, math.cos(a) * 0.36, -math.sin(a) * 0.36)
lev.beam('Steel', (0, 0, 0), tip, 0.022, 0.014)
lev.cyl('Red', (0, 0, 0), 0.02, 0.02, -0.03, 0.03, 8, axis='x')
lev.beam('Black', (0, math.cos(a) * 0.24, -math.sin(a) * 0.24), tip, 0.032, 0.03)
lev.box('Chrome', -0.006, 0.006, math.cos(a) * 0.36 - 0.005, math.cos(a) * 0.36 + 0.02, -math.sin(a) * 0.36 - 0.006, -math.sin(a) * 0.36 + 0.006)
R.node('sw_brake', lev, pb, 0.0, 0.0, ctl={'t': 'switch', 'hinge': [1, 0, 0], 'open': 0.9})
R.label('PARKING BRAKE [СТОЯНОЧНЫЙ ТОРМОЗ]', (pb[0] + 0.055, pb[1] - 0.06, pb[2]), PI / 2, 0.0, h=0.013, st='y')
mark('controls')

# ═════════════ seats: the driver's (sprung, adjustable), the commander's behind on the raised floor ═════════════
def seat(pos, h=0.42, back_h=0.62, yaw=0.0):
    M = R.mat3(yaw)
    o = pos
    R.obox(S, 'Steel', M, o, -0.2, 0.2, 0.0, h - 0.12, -0.18, 0.18, skip=('bottom',))
    for sx_ in (-1, 1):
        S.beam('Black', R.xf(M, o, (sx_ * 0.19, 0.05, -0.15)), R.xf(M, o, (sx_ * 0.19, h - 0.14, 0.15)), 0.02, caps=False)
    R.obox(S, 'Leather', M, o, -0.23, 0.23, h - 0.12, h, -0.24, 0.2)
    R.obox(S, 'Leather', M, o, -0.21, 0.21, h, h + 0.02, -0.22, -0.12)
    Mb = M @ R.mat3(0, -0.18)
    bo = R.xf(M, o, (0, h, 0.2))
    R.obox(S, 'Leather', Mb, bo, -0.22, 0.22, 0.02, back_h, -0.07, 0.0)
    R.obox(S, 'Steel', Mb, bo, -0.2, 0.2, 0.05, back_h - 0.05, 0.0, 0.012)
    for sx_ in (-1, 1):
        R.obox(S, 'Black', Mb, bo, sx_ * 0.23 - 0.012, sx_ * 0.23 + 0.012, 0.12, back_h - 0.05, -0.06, -0.02)
    R.obox(S, 'Leather', Mb, bo, -0.12, 0.12, back_h + 0.02, back_h + 0.2, -0.06, 0.0)


seat(VF((DX, FL, 1.52)))
seat(VF((DX, FR, 2.42)), h=0.36, back_h=0.5)
mark('seats')

# ═════════════ the commander's kit: radio, intercom, a fan, sun visors, a fire extinguisher, the map light ═════════════
# the R-123M radio and its power unit on the sill over the hood, its handset, an intercom box
rx0 = XIL + 0.01
box('Olive', rx0, XIU - 0.01, yw0, yw0 + 0.2, 2.0, 2.45)
for k, m in enumerate(('Bakelite', 'Bakelite', 'Chrome', 'Bakelite')):
    S.cyl(m, (VF((rx0, 0, 0))[0] - 0.005, VF((0, yw0 + 0.1 + (k % 2) * 0.05, 0))[1], VF((0, 0, 2.08 + k * 0.1))[2]), 0.018, 0.018, 0.0, 0.0, 8) if False else None
Mr = R.mat3(-PI / 2)
ro = VF((rx0, yw0 + 0.1, 2.225))
for k in range(4):
    R.ocyl(S, 'Bakelite', Mr, R.xf(Mr, ro, (-0.15 + k * 0.1, 0.03 * (k % 2), 0.0)), (0, 0, 0), 0.018, 0.016, 0.0, 0.02, 8, axis='z', cap0=False)
R.obox(S, 'Black', Mr, R.xf(Mr, ro, (0.1, -0.06, 0.0)), -0.05, 0.05, -0.02, 0.02, 0.0, 0.004)
R.oquad(S, 'LampAmber', Mr, R.xf(Mr, ro, (-0.05, 0.065, 0.001)), -0.05, 0.05, -0.012, 0.012)
R.label('Р-123М', R.xf(Mr, ro, (0.1, 0.07, 0.002)), -PI / 2, 0.0, h=0.018, st='w')
box('Black', XIL + 0.02, XIL + 0.07, yw0 + 0.22, yw0 + 0.34, 2.5, 2.56)
R._tube(S, VF((XIL + 0.05, yw0 + 0.22, 2.53)), VF((XIL + 0.02, yw0 - 0.1, 2.6)), 0.006, 'Cable', 5)
box('Olive', XO_, XO_ + 0.08, 2.25, 2.4, 2.55, 2.75)
R.label('ТПУ', VF((XO_ + 0.081, 2.36, 2.65)), PI / 2, 0.0, h=0.018, st='w')
# a fan on the dash's inner corner (the classic cab fan), sun visors over the windscreen
fc = VF((XIU - 0.08, yw0 + 0.18, 0.5))
Mfan = R.mat3(0.6, -0.1)
S.cyl('Dash', VF((XIU - 0.08, 0, 0.5)), 0.02, 0.02, VF((0, yw0 + 0.04, 0))[1], fc[1], 6, cap0=False)
R.ocyl(S, 'Dash', Mfan, fc, (0, 0, 0), 0.03, 0.03, -0.05, 0.0, 8, axis='z', cap0=False)
for k in range(8):
    a0, a1 = 2 * PI * k / 8, 2 * PI * (k + 1) / 8
    S.beam('Chrome', R.xf(Mfan, fc, (math.cos(a0) * 0.1, math.sin(a0) * 0.1, 0.02)), R.xf(Mfan, fc, (math.cos(a1) * 0.1, math.sin(a1) * 0.1, 0.02)), 0.005, caps=False)
    S.beam('Chrome', R.xf(Mfan, fc, (0, 0, 0.035)), R.xf(Mfan, fc, (math.cos(a0) * 0.1, math.sin(a0) * 0.1, 0.02)), 0.003, caps=False)
for k in range(3):
    a = 2 * PI * k / 3
    S.g('Black').face([R.xf(Mfan, fc, (0, 0, 0.012)), R.xf(Mfan, fc, (math.cos(a) * 0.085, math.sin(a) * 0.085, 0.012)), R.xf(Mfan, fc, (math.cos(a + 0.7) * 0.085, math.sin(a + 0.7) * 0.085, 0.012))], None, tuple(Mfan @ Vector((0, 0, 1))))
top_ws = [on(r0, r1, 0, u, 1.0) + fnorm_in(r0, r1, 0) * 0.05 for u in (0.12, 0.52, 0.55, 0.9)]
for (ua, ub) in ((0, 1), (2, 3)):
    pa, pb_ = top_ws[ua], top_ws[ub]
    dn = Vector((0, -0.16, 0.05))
    quad('Olive', [tuple(pa), tuple(pb_), tuple(pb_ + dn), tuple(pa + dn)], (0, -0.3, 1))
    quad('Olive', [tuple(pb_), tuple(pa), tuple(pa + dn), tuple(pb_ + dn)], (0, 0.3, -1))
# the fire extinguisher behind the commander's seat, a first-aid box, a grab handle on the pillar
S.cyl('Red', VF((XO_ + 0.12, 0, zr - T - 0.1)), 0.045, 0.045, VF((0, FR + 0.05, 0))[1], VF((0, FR + 0.42, 0))[1], 10)
S.cyl('Black', VF((XO_ + 0.12, 0, zr - T - 0.1)), 0.018, 0.018, VF((0, FR + 0.42, 0))[1], VF((0, FR + 0.48, 0))[1], 6)
box('White', XIL - 0.32, XIL - 0.02, 2.5, 2.66, zr - T - 0.1, zr - T)
quad('Red', [(XIL - 0.16, 2.54, zr - T - 0.101), (XIL - 0.18, 2.54, zr - T - 0.101), (XIL - 0.18, 2.62, zr - T - 0.101), (XIL - 0.16, 2.62, zr - T - 0.101)], (0, 0, -1))
quad('Red', [(XIL - 0.13, 2.57, zr - T - 0.1015), (XIL - 0.21, 2.57, zr - T - 0.1015), (XIL - 0.21, 2.59, zr - T - 0.1015), (XIL - 0.13, 2.59, zr - T - 0.1015)], (0, 0, -1))
R._tube(S, VF((XO_ + 0.05, 2.35, 1.2)), VF((XO_ + 0.05, 2.62, 1.2)), 0.014, 'Black', 6)
R._tube(S, VF((XIU - 0.05, 2.4, 0.9)), VF((XIU - 0.05, 2.62, 0.9)), 0.014, 'Black', 6)
mark('kit')

# ═════════════ the door (the exit): the lining with its window, the handle, the window crank, an arm rest ═════════════
dz0, dz1, dy0, dy1 = 1.36, 2.08, FR, 2.74
dc = ((dz0 + dz1) / 2)
D = Part('exit_door')
hw = (dz1 - dz0) / 2
wz0, wz1, wy0, wy1 = 1.42 - dc, 2.02 - dc, 2.12 - dy0, 2.68 - dy0          # the window opening (local: x = −(z − dc))
for (a0, a1, b0, b1) in ((-hw, -wz1, 0.0, dy1 - dy0), (-wz0, hw, 0.0, dy1 - dy0), (-wz1, -wz0, 0.0, wy0), (-wz1, -wz0, wy1, dy1 - dy0)):
    D.box('ConsoleGreen', a0, a1, b0, b1, 0.0, 0.035)
D.g('Glass').face([(-wz1, wy0, 0.012), (-wz0, wy0, 0.012), (-wz0, wy1, 0.012), (-wz1, wy1, 0.012)], None, (0, 0, 1))
for (a0, a1, b0, b1) in ((-wz1 - 0.02, -wz0 + 0.02, wy0 - 0.02, wy0), (-wz1 - 0.02, -wz0 + 0.02, wy1, wy1 + 0.02), (-wz1 - 0.02, -wz1, wy0, wy1), (-wz0, -wz0 + 0.02, wy0, wy1)):
    D.box('Rubber', a0, a1, b0, b1, 0.035, 0.04)
D.box('Leather', -hw + 0.08, hw - 0.12, wy0 - 0.2, wy0 - 0.14, 0.035, 0.1)                       # the arm rest
D.box('Chrome', -hw + 0.05, -hw + 0.08, 0.5, 0.62, 0.035, 0.07)                                   # the handle (rear edge)
D.box('Chrome', -hw + 0.05, -hw + 0.16, 0.6, 0.62, 0.06, 0.075)
D.cyl('Chrome', (0.1, 0.35, 0.0), 0.03, 0.03, 0.035, 0.05, 10, axis='z')                          # the window crank
D.box('Bakelite', 0.1 - 0.005, 0.1 + 0.005, 0.35, 0.42, 0.05, 0.06)
D.box('Rubber', -hw, hw, 0.0, 0.05, 0.035, 0.045)
R.node('exit_door', D, VF((XO_ + 0.001, dy0, dc)), yaw=PI / 2, ctl={'t': 'exit'})
R.label('ВЫХОД · EXIT', VF((XO_ + 0.045, 2.02, dc)), PI / 2, 0.0, h=0.018, st='y')
mark('door')

# ═════════════ the driver's eye, the spawn ═════════════
R.station('stand_driver', VF((DX, 2.52, 1.33)), yaw=0.0, pitch=-0.2, fov=64)
R.spawn(VF((DX, FL, 1.25)), yaw=0.0)

R.finish(OUT, {
    'walk': [[VF((XO_ + 0.25, 0, 0))[0], VF((XIL - 0.25, 0, 0))[0], VF((0, 0, 0.75))[2], VF((0, 0, 1.79))[2], 0.0],
             [VF((XO_ + 0.25, 0, 0))[0], VF((XIL - 0.25, 0, 0))[0], VF((0, 0, 1.8))[2], VF((0, 0, 2.7))[2], round(FR - FL, 3)]],
    'eye': 1.05,
})
