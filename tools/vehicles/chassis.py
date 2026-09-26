# ═══════════════════════════════════════════════════════════════
# Shared chassis builders (Blender, with vkit): the cab, front end, frame, running gear and wheels of the
# truck families the vehicles ride on. Coordinates: game frame, z = distance aft of the front bumper face
# (vkit recentres the finished vehicle), x right, y up.
#
# MAZ-543 (8×8, MAZ-543A: SCUD 9P117M; MAZ-543M: S-300PS 5P85S, BM-30 Smerch): 11.46 m chassis, 3.07 m wide,
# 2.92 m to the cab roofs; axles 2.2 + 3.3 + 2.2 m apart, the first 2.57 m aft of the bumper; track 2.375 m;
# 1500×600-635 tyres. Two separate fibreglass cabs either side of the engine, the payload's front end between them.
# ═══════════════════════════════════════════════════════════════
import math
from mathutils import Vector
import vkit
from vkit import Part, lerp, vec

MAZ = {
    'axles': [2.57, 4.77, 8.07, 10.27],
    'track': 2.375,
    'R': 0.76, 'W': 0.60, 'rim': 0.36,
    'width': 3.07,
    'roof': 2.92,
    'frame_top': 1.30,
    'body_floor': 1.58,     # underside of the equipment bodies over the wheels
    'len': 11.40,           # chassis length (bumper face → rear frame end)
}
# MAZ-543M (and the MAZ-7910 built on it): the same running gear set 0.28 m further aft, a longer frame, a long
# two-door cab on the LEFT, the engine at the front right behind a wide grille, and (on the BM-30 Smerch) a second
# crew cab set back behind the engine on the right. The S-300PS 5P85S puts an equipment hut there instead.
MAZM = dict(MAZ, axles=[2.85, 5.05, 8.35, 10.55], len=11.70, deck=1.62)


def wheels(v, parent, axles, track, R, W, rim, steer=(), lugs=18, seg=24, nbolts=10, cti=True, prefix='wheel', hub_skin='paint', rim_skin='paint', tread='chevron', dual=False):
    """one shared wheel mesh on every hub: nodes wheel_<axle><l|r> (right wheels hold the mesh, left ones share it
    turned 180°). steer: {axle index: share of the steering angle}. Writes vk.wheels."""
    proto = None
    for i, z in enumerate(axles):
        for side in (1, -1):
            name = '%s_%d%s' % (prefix, i + 1, 'r' if side > 0 else 'l')
            if proto is None:
                p = Part(v, name, pivot=(side * track / 2, R, z), parent=parent, local=True)
                vkit.build_wheel(p, R, W, rim, lugs=lugs, seg=seg, nbolts=nbolts, cti=cti, hub_skin=hub_skin, rim_skin=rim_skin, tread=tread)
                proto = p
            else:
                p = Part(v, name, pivot=(side * track / 2, R, z), parent=parent, local=True,
                         rest_yaw=0.0 if side > 0 else math.pi, share=proto)
            v.meta['wheels'].append({'node': name, 'r': R, 'steer': steer.get(i, 0) if isinstance(steer, dict) else 0, 'side': side})
    return proto


def maz_cab(b, sx, variant='A'):
    """one MAZ-543 cab (sx = -1 left, +1 right) on part b"""
    xo = sx * 1.52                      # outer face
    xi = sx * 0.47                      # inner face (upper cab)
    xil = sx * 0.77 if variant == 'A' else xi   # inner face below the windscreen (the 543A's grille lies between)
    c = 0.30                            # front outer chamfer
    y0, yb, yw0, yw1, yr = 1.40, 1.62, 2.02, 2.76, 2.92
    zf, zr = 0.38, 2.95                 # front face, rear face

    def plan(zfront, zrear, xin, xout, ch):
        return [(xin, zfront), (xout - sx * ch, zfront), (xout, zfront + ch), (xout, zrear), (xin, zrear)]
    # lower front block (below the windscreen, ahead of the front wheel), with the chamfered corner
    lp = plan(zf, 1.80, xil, xo, c)
    b.prism_y('paint', lp, y0, yw0)
    # above the front wheel (wheel arch below it)
    b.box('paint', min(xil, xo), max(xil, xo), yb, yw0, 1.80, zr, skip=('nz',))
    # upper cab: a loft of plan rings — windscreen foot, windscreen top, roof edge (inset = rounded roof)
    r0 = [(x, yw0, z) for (x, z) in plan(zf, zr, xi, xo, c)]
    r1 = [(x, yw1, z) for (x, z) in plan(zf + 0.22, zr - 0.02, xi, xo, c * 0.92)]
    ins = 0.07
    r2 = [(x, yr, z) for (x, z) in plan(zf + 0.36, zr - 0.12, xi - sx * ins * 0.3, xo - sx * ins, c * 0.8)]
    b.loft('paint', [r0, r1, r2], smooth=False)
    b.face(r2, 'paint', want=(0, 1, 0))
    b.face(r0, 'paint', want=(0, -1, 0))
    # ── glazing (vkit.panel lays a quad with a rubber frame onto a face) ──
    def on(ra, rb, i, u, v):
        """a point on the loft face between ring ra and rb, edge i→i+1: u along the edge, v up the face"""
        A0, A1 = Vector(ra[i]), Vector(ra[(i + 1) % len(ra)])
        B0, B1 = Vector(rb[i]), Vector(rb[(i + 1) % len(rb)])
        return lerp(lerp(A0, A1, u), lerp(B0, B1, u), v)

    def fnorm(ra, rb, i):
        A0, A1 = Vector(ra[i]), Vector(ra[(i + 1) % len(ra)])
        B0 = Vector(rb[i])
        n = (A1 - A0).cross(B0 - A0).normalized()
        cen = sum((Vector(p) for p in ra), Vector()) / len(ra)
        if n.dot(A0 - cen) < 0:
            n = -n
        return n
    # windscreen: edge 0 (inner → chamfer start) on the front face
    n = fnorm(r0, r1, 0)
    b.panel('glass', [on(r0, r1, 0, 0.06, 0.1), on(r0, r1, 0, 0.94, 0.1), on(r0, r1, 0, 0.94, 0.9), on(r0, r1, 0, 0.06, 0.9)], n, off=0.006, frame=0.035)
    # corner window on the chamfer (edge 1)
    n1 = fnorm(r0, r1, 1)
    b.panel('glass', [on(r0, r1, 1, 0.12, 0.14), on(r0, r1, 1, 0.88, 0.14), on(r0, r1, 1, 0.88, 0.86), on(r0, r1, 1, 0.12, 0.86)], n1, off=0.006, frame=0.03)
    # side windows on the outer face (x = xo): door window and rear window (543M: two doors, a window in each)
    for (za, zb) in (((1.42, 2.02), (2.20, 2.74)) if variant == 'A' else ((1.34, 1.90), (2.14, 2.70))):
        b.panel('glass', [(xo, 2.12, za), (xo, 2.12, zb), (xo, 2.68, zb), (xo, 2.68, za)], (sx, 0, 0), off=0.006, frame=0.035)
    # inner side window (towards the missile / the engine bay), small
    iy0 = 2.15 if variant == 'A' else 2.38
    b.panel('glass', [(xi, iy0, 2.25), (xi, iy0, 2.75), (xi, 2.62, 2.75), (xi, 2.62, 2.25)], (-sx, 0, 0), off=0.006, frame=0.03)
    # rear window (edge 3: outer-rear → inner-rear)
    n3 = fnorm(r0, r1, 3)
    b.panel('glass', [on(r0, r1, 3, 0.22, 0.2), on(r0, r1, 3, 0.8, 0.2), on(r0, r1, 3, 0.8, 0.8), on(r0, r1, 3, 0.22, 0.8)], n3, off=0.006, frame=0.03)
    # wiper arms on the windscreen
    for u in (0.3, 0.72):
        p0 = on(r0, r1, 0, u, 0.1) + n * 0.02
        p1 = on(r0, r1, 0, u - 0.12, 0.72) + n * 0.02
        b.beam('black', p0, p1, 0.012, 0.008)
    # doors: outline (panel lines), handle, hinges
    dy0, dy1 = 1.66, 2.80
    for (dz0, dz1) in (((1.36, 2.08),) if variant == 'A' else ((1.28, 1.98), (2.06, 2.80))):
        for (p0, p1) in (((xo, dy0, dz0), (xo, dy1, dz0)), ((xo, dy0, dz1), (xo, dy1, dz1)), ((xo, dy1, dz0), (xo, dy1, dz1)), ((xo, dy0, dz0), (xo, dy0, dz1))):
            P0, P1 = Vector(p0), Vector(p1)
            d = (P1 - P0).normalized()
            w = Vector((0, 0.012, 0)) if abs(d.y) < 0.5 else Vector((0, 0, 0.012))
            b.panel('black', [P0 - w, P1 - w, P1 + w, P0 + w], (sx, 0, 0), off=0.003)
        vkit.grab_handle(b, (xo + sx * 0.01, 1.98, dz1 - 0.12), (0, 0, 1), (sx, 0, 0), 0.16, 0.035, 'dark')
        for y in (1.9, 2.6):
            b.cyl('dark', (xo + sx * 0.02, y - 0.07, dz0 - 0.02), (xo + sx * 0.02, y + 0.07, dz0 - 0.02), 0.022, 0.022, 6)
    if variant == 'A':
        # grab rail up the cab side, behind the door
        vkit.grab_handle(b, (xo + sx * 0.01, 2.2, 2.28), (0, 1, 0), (sx, 0, 0), 0.5, 0.05, 'dark')
    # boarding steps below the door, ahead of the front wheel
    for k, y in enumerate((0.72, 1.02, 1.30)):
        zs = 1.28 + k * 0.08 if variant == 'A' else 1.50 + k * 0.05
        b.box('dark', xo - sx * 0.02, xo - sx * 0.42, y - 0.03, y, zs, zs + 0.42)
    so = 0.0 if variant == 'A' else 0.22
    b.beam('dark', (xo - sx * 0.05, 0.70, 1.28 + so), (xo - sx * 0.05, 1.40, 1.46 + so), 0.03, 0.03)
    b.beam('dark', (xo - sx * 0.05, 0.70, 1.72 + so), (xo - sx * 0.05, 1.40, 1.86 + so), 0.03, 0.03)
    # headlight pod on the lower front, near the outer corner: a blackout cover with a slit and a visor over it
    hc = Vector((xo - sx * 0.40, 1.74, zf - 0.02))
    vkit.headlight(b, hc, (0, 0, -1), r=0.1, depth=0.1, skin_body='dark', lens='lens')
    blackout(b, hc, 0.1)
    # a round screened intake low on the cab front
    b.disc('dark', (xo - sx * 0.95, 1.55, zf - 0.004), (0, 0, -1), 0.085, 12)
    b.disc('mesh', (xo - sx * 0.95, 1.55, zf - 0.008), (0, 0, -1), 0.07, 12)
    b.panel('dark', [(xo - sx * 0.95, 1.86, zf), (xo - sx * 0.62, 1.86, zf), (xo - sx * 0.62, 1.96, zf), (xo - sx * 0.95, 1.96, zf)], (0, 0, -1), off=0.004)
    vkit.grab_handle(b, (xo - sx * 0.78, 1.66, zf - 0.005), (1, 0, 0), (0, 0, -1), 0.3, 0.04, 'dark')
    # rain gutters along the top of the side walls
    b.beam('dark', (xo + sx * 0.012, yw1 - 0.01, zf + 0.5), (xo + sx * 0.012, yw1 - 0.01, zr - 0.08), 0.024, 0.02)
    b.beam('dark', (xi - sx * 0.012, yw1 - 0.01, zf + 0.3), (xi - sx * 0.012, yw1 - 0.01, zr - 0.08), 0.024, 0.02)
    # roof: hatch, marker lamps
    hc = ((xo + xi) / 2, yr, 1.9)
    b.panel('paint', [(hc[0] - 0.28, yr, 1.62), (hc[0] + 0.28, yr, 1.62), (hc[0] + 0.28, yr, 2.18), (hc[0] - 0.28, yr, 2.18)], (0, 1, 0), off=0.025, frame=0.03, frame_skin='dark')
    for dx in (-0.25, 0.25):
        vkit.lamp_box(b, (hc[0] + dx, yr + 0.03, zf + 0.42), (0.1, 0.06, 0.06), (0, 0, -1), lens='lens_amber')
    # mirror on the front outer corner
    vkit.mirror(b, (xo - sx * 0.05, 2.5, zf + 0.35), (xo + sx * 0.22, 2.45, zf + 0.05), (0.18, 0.28))


def blackout(b, c, r):
    """a blackout cover over a round lamp: a black disc with a thin lit slit, and a visor hood above it"""
    c = Vector(c)
    b.disc('black', c + Vector((0, 0, -0.016)), (0, 0, -1), r * 1.02, 12)
    b.panel('lens', [c + Vector((-r * 0.62, -0.012, -0.018)), c + Vector((r * 0.62, -0.012, -0.018)),
                     c + Vector((r * 0.62, 0.012, -0.018)), c + Vector((-r * 0.62, 0.012, -0.018))], (0, 0, -1), off=0.001)
    b.face([c + Vector((-r * 1.15, r * 1.0, 0.0)), c + Vector((r * 1.15, r * 1.0, 0.0)),
            c + Vector((r * 1.15, r * 0.82, -0.1)), c + Vector((-r * 1.15, r * 0.82, -0.1))], 'black', want=(0, 1, -0.3))
    b.face([c + Vector((-r * 1.15, r * 1.0, 0.0)), c + Vector((-r * 1.15, r * 0.82, -0.1)),
            c + Vector((r * 1.15, r * 0.82, -0.1)), c + Vector((r * 1.15, r * 1.0, 0.0))], 'black', want=(0, -1, 0.3))


def maz_front(b, variant='A'):
    """bumper, skid plate, bumper lamps, tow gear; on the 543A also the grille and hood between the cabs"""
    # bumper (black), full width
    b.box('black', -1.53, 1.53, 1.08, 1.40, 0.0, 0.40, bev=0.03)
    # headlights in the bumper ends (wire guards)
    for sx in (-1, 1):
        vkit.headlight(b, (sx * 1.18, 1.24, -0.01), (0, 0, -1), r=0.085, depth=0.06, skin_body='black', lens='lens', guard=True)
        vkit.lamp_box(b, (sx * 1.40, 1.24, 0.0), (0.09, 0.07, 0.05), (0, 0, -1), lens='lens_amber', skin='black')
        # towing eyes
        b.cyl('dark', (sx * 0.75, 1.16, -0.04), (sx * 0.75, 1.16, 0.02), 0.07, 0.07, 8)
    # central tow hook
    b.box('dark', -0.12, 0.12, 1.02, 1.30, -0.10, 0.02)
    b.cyl('dark', (-0.1, 1.08, -0.16), (0.1, 1.08, -0.16), 0.05, 0.05, 8)
    # skid plate: sloping from under the bumper back to the frame
    b.face([(-1.30, 1.08, 0.02), (1.30, 1.08, 0.02), (1.10, 0.62, 1.30), (-1.10, 0.62, 1.30)], 'paint', want=(0, -0.4, -1))
    b.face([(-1.30, 1.08, 0.02), (-1.10, 0.62, 1.30), (-1.10, 1.08, 1.30)], 'paint', want=(-1, 0, 0))
    b.face([(1.30, 1.08, 0.02), (1.10, 1.08, 1.30), (1.10, 0.62, 1.30)], 'paint', want=(1, 0, 0))
    b.face([(-1.10, 0.62, 1.30), (1.10, 0.62, 1.30), (1.10, 0.62, 2.20), (-1.10, 0.62, 2.20)], 'dark', want=(0, -1, 0))
    if variant != 'A':
        return
    # grille between the cabs: frame, dark core, vertical bars
    gz = 0.44
    b.box('paint', -0.77, 0.77, 1.40, 1.46, gz, 2.95)
    b.box('paint', -0.77, -0.70, 1.40, 2.02, gz, gz + 0.1)
    b.box('paint', 0.70, 0.77, 1.40, 2.02, gz, gz + 0.1)
    b.box('paint', -0.77, 0.77, 1.95, 2.02, gz, gz + 0.1)
    b.panel('black', [(-0.70, 1.46, gz + 0.06), (0.70, 1.46, gz + 0.06), (0.70, 1.95, gz + 0.06), (-0.70, 1.95, gz + 0.06)], (0, 0, -1), off=0.0)
    for i in range(22):
        x = lerp(-0.66, 0.66, i / 21)
        b.box('paint', x - 0.012, x + 0.012, 1.46, 1.95, gz + 0.01, gz + 0.05)
    b.box('paint', -0.70, 0.70, 1.66, 1.69, gz + 0.0, gz + 0.05)
    # grille latches
    for x in (-0.45, 0.45):
        b.box('dark', x - 0.03, x + 0.03, 1.84, 1.93, gz - 0.02, gz + 0.01)
    # tubular guard in front of the grille (two rails, four uprights, mounting tabs)
    gzf = gz - 0.13
    for y in (1.60, 1.88):
        b.cyl('paint', (-0.62, y, gzf), (0.62, y, gzf), 0.022, 0.022, 8)
    for x in (-0.52, -0.18, 0.18, 0.52):
        b.cyl('paint', (x, 1.47, gzf), (x, 1.96, gzf), 0.02, 0.02, 8)
    for x in (-0.62, 0.62):
        for y in (1.60, 1.88):
            b.box('dark', x - 0.03, x + 0.03, y - 0.03, y + 0.03, gzf, gz)
    # hood between the cabs (engine cover), with handles and a filler cap
    b.box('paint', -0.77, 0.77, 2.02, 2.10, gz - 0.02, 1.70, bev=0.02)
    for x in (-0.35, 0.35):
        vkit.grab_handle(b, (x, 2.10, 0.62), (1, 0, 0), (0, 1, 0), 0.22, 0.04, 'dark')
    b.cyl('dark', (0.0, 2.10, 0.9), (0.0, 2.16, 0.9), 0.07, 0.07, 10)
    # mesh air intakes on the cab inner walls, by the nose (the front photo's two screens)
    for sx in (-1, 1):
        b.panel('mesh', [(sx * 0.465, 2.12, 0.62), (sx * 0.465, 2.12, 1.05), (sx * 0.465, 2.55, 1.05), (sx * 0.465, 2.55, 0.62)], (-sx, 0, 0), off=0.004)


def maz_frame(b, zmax, variant='A', axles=None):
    """frame rails, cross members, underbody pan, suspension arms, drive line"""
    R = MAZ['R']
    axles = axles or MAZ['axles']
    for sx in (-1, 1):
        b.box('dark', sx * 0.40, sx * 0.56, 0.95, 1.30, 1.2, zmax, skip=())
    for z in (1.4, 3.6, 5.9, 7.0, 9.2, zmax - 0.1):
        b.box('dark', -0.40, 0.40, 1.05, 1.22, z - 0.07, z + 0.07)
    # underbody pan between the wheels (hides the see-through)
    b.face([(-0.9, 0.95, 1.3), (0.9, 0.95, 1.3), (0.9, 0.95, zmax), (-0.9, 0.95, zmax)], 'dark', want=(0, -1, 0))
    # drive line: shafts and transfer / axle differential boxes
    for z in axles:
        b.box('dark', -0.30, 0.30, 0.62, 0.98, z - 0.28, z + 0.28, bev=0.04)
        for sx in (-1, 1):
            # half shaft to the wheel hub, suspension wishbones, torsion bar
            b.cyl('dark', (sx * 0.30, R, z), (sx * 0.95, R, z), 0.06, 0.06, 8)
            b.beam('dark', (sx * 0.42, 0.98, z - 0.35), (sx * 0.92, R + 0.10, z - 0.05), 0.08, 0.06)
            b.beam('dark', (sx * 0.42, 0.62, z - 0.35), (sx * 0.92, R - 0.12, z - 0.05), 0.08, 0.06)
            b.cyl('dark', (sx * 0.74, R - 0.2, z), (sx * 0.74, R + 0.22, z), 0.11, 0.11, 10)   # hub carrier / planetary reducer
    b.cyl('dark', (0, 0.78, 1.5), (0, 0.78, axles[-1]), 0.06, 0.06, 8)


def maz_fender(b, sx, z0, z1, y=None, depth=0.62):
    """a flat mudguard over a wheel pair with rubber flaps"""
    y = y or MAZ['body_floor']
    xo = sx * 1.53
    b.box('paint', min(xo, xo - sx * depth), max(xo, xo - sx * depth), y - 0.05, y, z0, z1)
    b.box('rubber', min(xo, xo - sx * 0.55), max(xo, xo - sx * 0.55) - (0 if sx > 0 else 0), 0.62, y - 0.05, z1 - 0.02, z1 + 0.01)


def maz543(v, parent, variant='A', rear_z=None, steer=None, rim='dark'):
    """the common MAZ-543 chassis on `parent` (static body part). Returns layout info."""
    b = parent
    for sx in (-1, 1):
        maz_cab(b, sx, variant)
    maz_front(b, variant)
    zmax = rear_z or MAZ['len']
    maz_frame(b, zmax, variant)
    wheels(v, None, MAZ['axles'], MAZ['track'], MAZ['R'], MAZ['W'], MAZ['rim'], steer=steer or {0: 1.0, 1: 0.62}, lugs=18, seg=24, nbolts=10, rim_skin=rim, hub_skin=rim)
    return {'zmax': zmax}


# ═════════════ MAZ-543M / MAZ-7910 ═════════════

def plan_chamfer(x_in, x_out, z0, z1, ch, sx):
    """a plan (x, z) rectangle from x_in to x_out (x_out on the outside, sx = its sign), front-outer corner cut by ch"""
    return [(x_in, z0), (x_out - sx * ch, z0), (x_out, z0 + ch), (x_out, z1), (x_in, z1)]


def panel_lines(b, face_x, sx, rect, w=0.011, skin='black'):
    """a rectangular panel outline (door, hatch) as thin dark strips on a side face at x = face_x; rect = (z0, z1, y0, y1)"""
    z0, z1, y0, y1 = rect
    for (p0, p1) in (((face_x, y0, z0), (face_x, y1, z0)), ((face_x, y0, z1), (face_x, y1, z1)),
                     ((face_x, y1, z0), (face_x, y1, z1)), ((face_x, y0, z0), (face_x, y0, z1))):
        P0, P1 = Vector(p0), Vector(p1)
        d = Vector((0, w, 0)) if abs((P1 - P0).y) < 1e-6 else Vector((0, 0, w))
        b.panel(skin, [P0 - d, P1 - d, P1 + d, P0 + d], (sx, 0, 0), off=0.003)


def maz_engine_m(b, zr=2.62, intake=False):
    """the 543M's engine bay at the front right, from the left cab's inner face (x = -0.47) to the right side:
    a wide radiator grille on the front, screened vents on the side, an intake hump on the hood.
    intake: the MAZ-7910's tall air-intake box standing on the rear half of the bay."""
    x0, x1 = -0.47, 1.52
    zf = 0.40
    top = 2.28
    ch = 0.32
    front = [(x0, zf), (x1 - ch, zf), (x1, zf + ch), (x1, 2.02), (x0, 2.02)]
    b.prism_y('paint', front, 1.40, top)
    b.box('paint', x0, x1, 1.64, top, 2.02, zr, skip=('nz',))
    # grille: dark core, vertical bars in a frame, a stiffener, latches
    gx0, gx1, gy0, gy1 = -0.40, 1.14, 1.47, 2.17
    b.panel('black', [(gx0, gy0, zf), (gx1, gy0, zf), (gx1, gy1, zf), (gx0, gy1, zf)], (0, 0, -1), off=0.003)
    n = 26
    for i in range(n):
        x = lerp(gx0 + 0.03, gx1 - 0.03, i / (n - 1))
        b.box('paint', x - 0.014, x + 0.014, gy0, gy1, zf - 0.045, zf - 0.004)
    b.box('paint', gx0 - 0.05, gx1 + 0.05, gy0 - 0.05, gy0, zf - 0.06, zf)
    b.box('paint', gx0 - 0.05, gx1 + 0.05, gy1, gy1 + 0.05, zf - 0.06, zf)
    b.box('paint', gx0 - 0.05, gx0, gy0, gy1, zf - 0.06, zf)
    b.box('paint', gx1, gx1 + 0.05, gy0, gy1, zf - 0.06, zf)
    b.box('paint', gx0, gx1, 1.80, 1.84, zf - 0.065, zf - 0.04)
    for x in (0.05, 0.72):
        b.box('dark', x - 0.03, x + 0.03, 2.03, 2.13, zf - 0.08, zf - 0.04)
    # headlight pod on the chamfered corner
    d = Vector((0.7071, 0, -0.7071))
    vkit.headlight(b, (x1 - ch * 0.5 + d.x * 0.01, 1.76, zf + ch * 0.5 + d.z * 0.01), tuple(d), r=0.1, depth=0.1, skin_body='dark', lens='lens')
    # three screened vents on the right side
    for z in (1.00, 1.38, 1.76):
        b.panel('mesh', [(x1, 1.62, z), (x1, 1.62, z + 0.3), (x1, 1.98, z + 0.3), (x1, 1.98, z)], (1, 0, 0), off=0.004, frame=0.022, frame_skin='dark')
    # hood: intake hump with louvred sides, handles, filler cap
    b.box('paint', 0.05, 1.18, top, top + 0.14, 0.72, 2.00, bev=0.03)
    for zc in (0.95, 1.35, 1.75):
        b.panel('vents', [(1.18, top + 0.03, zc - 0.14), (1.18, top + 0.03, zc + 0.14), (1.18, top + 0.11, zc + 0.14), (1.18, top + 0.11, zc - 0.14)], (1, 0, 0), off=0.003)
    for x in (0.25, 0.95):
        vkit.grab_handle(b, (x, top + 0.14, 0.82), (1, 0, 0), (0, 1, 0), 0.2, 0.04, 'dark')
    b.cyl('dark', (-0.22, top, 1.25), (-0.22, top + 0.06, 1.25), 0.07, 0.07, 10)
    if intake:
        # MAZ-7910: the tall intake / cooling box behind the hump, a grille facing forward
        b.box('paint', 0.02, 1.48, top, 3.05, 1.62, zr, bev=0.03)
        b.panel('black', [(0.12, 2.40, 1.62), (1.38, 2.40, 1.62), (1.38, 2.95, 1.62), (0.12, 2.95, 1.62)], (0, 0, -1), off=0.003)
        for i in range(18):
            x = lerp(0.16, 1.34, i / 17)
            b.box('paint', x - 0.012, x + 0.012, 2.40, 2.95, 1.585, 1.62)
        vkit.louvres(b, 1.48, 2.45, 2.95, 1.8, 2.45, 6, side=1)


def maz_right_cab_m(b, z0=2.66, z1=4.30):
    """the 543M's second crew cab, set back behind the engine bay on the right (BM-30 Smerch)"""
    xo, xi = 1.52, 0.47
    ch = 0.22
    yb, yw1, ytop = 1.64, 2.80, 2.92
    r0 = [(x, yb, z) for (x, z) in plan_chamfer(xi, xo, z0, z1, ch, 1)]
    r1 = [(x, yw1, z) for (x, z) in plan_chamfer(xi, xo, z0 + 0.05, z1, ch, 1)]
    r2 = [(x, ytop, z) for (x, z) in plan_chamfer(xi + 0.03, xo - 0.07, z0 + 0.17, z1 - 0.1, ch * 0.8, 1)]
    b.loft('paint', [r0, r1, r2], smooth=False)
    b.face(r2, 'paint', want=(0, 1, 0))
    b.face(r0, 'paint', want=(0, -1, 0))

    def on(ra, rb, i, u, v):
        A0, A1 = Vector(ra[i]), Vector(ra[(i + 1) % len(ra)])
        B0, B1 = Vector(rb[i]), Vector(rb[(i + 1) % len(rb)])
        return lerp(lerp(A0, A1, u), lerp(B0, B1, u), v)

    def fnorm(ra, rb, i):
        A0, A1 = Vector(ra[i]), Vector(ra[(i + 1) % len(ra)])
        B0 = Vector(rb[i])
        n = (A1 - A0).cross(B0 - A0).normalized()
        cen = sum((Vector(p) for p in ra), Vector()) / len(ra)
        return n if n.dot(A0 - cen) > 0 else -n
    # windscreen (upper part of the front face, above the engine bay) and the corner window
    n0 = fnorm(r0, r1, 0)
    v0 = (2.38 - yb) / (yw1 - yb)
    b.panel('glass', [on(r0, r1, 0, 0.07, v0), on(r0, r1, 0, 0.93, v0), on(r0, r1, 0, 0.93, 0.95), on(r0, r1, 0, 0.07, 0.95)], n0, off=0.006, frame=0.035)
    n1 = fnorm(r0, r1, 1)
    b.panel('glass', [on(r0, r1, 1, 0.12, v0 + 0.02), on(r0, r1, 1, 0.88, v0 + 0.02), on(r0, r1, 1, 0.88, 0.93), on(r0, r1, 1, 0.12, 0.93)], n1, off=0.006, frame=0.03)
    for u in (0.35, 0.72):
        b.beam('black', on(r0, r1, 0, u, v0 + 0.04) + n0 * 0.02, on(r0, r1, 0, u - 0.1, 0.85) + n0 * 0.02, 0.012, 0.008)
    # door with a rounded-corner window on the right side, rear window
    dz0, dz1 = z0 + 0.42, z0 + 1.12
    panel_lines(b, xo, 1, (dz0, dz1, 1.70, 2.82))
    b.panel('glass', [(xo, 2.12, dz0 + 0.1), (xo, 2.12, dz1 - 0.1), (xo, 2.66, dz1 - 0.1), (xo, 2.66, dz0 + 0.1)], (1, 0, 0), off=0.006, frame=0.035)
    vkit.grab_handle(b, (xo + 0.01, 1.98, dz1 - 0.12), (0, 0, 1), (1, 0, 0), 0.16, 0.035, 'dark')
    for y in (1.9, 2.6):
        b.cyl('dark', (xo + 0.02, y - 0.07, dz0 - 0.02), (xo + 0.02, y + 0.07, dz0 - 0.02), 0.022, 0.022, 6)
    b.panel('glass', [(xo, 2.14, dz1 + 0.12), (xo, 2.14, z1 - 0.14), (xo, 2.64, z1 - 0.14), (xo, 2.64, dz1 + 0.12)], (1, 0, 0), off=0.006, frame=0.03)
    n3 = fnorm(r0, r1, 3)
    b.panel('glass', [on(r0, r1, 3, 0.25, 0.45), on(r0, r1, 3, 0.75, 0.45), on(r0, r1, 3, 0.75, 0.85), on(r0, r1, 3, 0.25, 0.85)], n3, off=0.006, frame=0.03)
    # boarding ladder below the door (between the first two wheels)
    for k, y in enumerate((0.72, 1.02, 1.32)):
        b.box('dark', xo - 0.42, xo - 0.03, y - 0.03, y, dz1 - 0.02, dz1 + 0.38)
    b.beam('dark', (xo - 0.06, 0.70, dz1), (xo - 0.06, yb, dz1), 0.03, 0.03)
    b.beam('dark', (xo - 0.06, 0.70, dz1 + 0.36), (xo - 0.06, yb, dz1 + 0.36), 0.03, 0.03)
    # roof hatch, marker lamps, mirror
    b.panel('paint', [(0.72, ytop, z0 + 0.7), (1.26, ytop, z0 + 0.7), (1.26, ytop, z0 + 1.25), (0.72, ytop, z0 + 1.25)], (0, 1, 0), off=0.025, frame=0.03, frame_skin='dark')
    for dx in (0.72, 1.22):
        vkit.lamp_box(b, (dx, ytop + 0.03, z0 + 0.3), (0.1, 0.06, 0.06), (0, 0, -1), lens='lens_amber')
    vkit.mirror(b, (xo - 0.05, 2.55, z0 + 0.3), (xo + 0.2, 2.5, z0 + 0.05), (0.18, 0.28))


def arch_fender(b, sx, za, zb, R=0.76, depth=0.66, gap=0.10, a0=172.0, a1=8.0, thick=0.04, lip=0.10, flaps=True):
    """an arched mudguard (flat on top between the two axles za, zb) at side sx: a band following the wheels,
    with a hanging outer lip and rubber flaps behind"""
    xo = sx * 1.53
    xi = xo - sx * depth
    Rf = R + gap
    pts = []
    for k in range(7):
        a = math.radians(lerp(a0, 90.0, k / 6))
        pts.append(Vector((za + Rf * math.cos(a), R + Rf * math.sin(a))))
    for k in range(7):
        a = math.radians(lerp(90.0, a1, k / 6))
        pts.append(Vector((zb + Rf * math.cos(a), R + Rf * math.sin(a))))
    clean = [pts[0]]
    for p in pts[1:]:
        if (p - clean[-1]).length > 1e-4:
            clean.append(p)
    pts = clean
    # outward normals (in z, y): away from the wheel below
    nrm = []
    for i, p in enumerate(pts):
        t = (pts[min(i + 1, len(pts) - 1)] - pts[max(i - 1, 0)]).normalized()
        nrm.append(Vector((-t.y, t.x)))   # (z, y): the arch runs towards +z, so this points away from the wheel
    for i in range(len(pts) - 1):
        p, q, n, m = pts[i], pts[i + 1], nrm[i], nrm[i + 1]
        P, Q = (p + n * thick), (q + m * thick)
        mid = (n + m) / 2
        # upper surface, lower (inner) surface
        b.face([(xi, P.y, P.x), (xo, P.y, P.x), (xo, Q.y, Q.x), (xi, Q.y, Q.x)], 'paint', want=(0, mid.y, mid.x))
        b.face([(xi, p.y, p.x), (xo, p.y, p.x), (xo, q.y, q.x), (xi, q.y, q.x)], 'dark', want=(0, -mid.y, -mid.x))
        # the outer lip: a strip hanging from the band's outer edge
        L0, L1 = p - n * lip, q - m * lip
        b.face([(xo, P.y, P.x), (xo, Q.y, Q.x), (xo, L1.y, L1.x), (xo, L0.y, L0.x)], 'paint', want=(sx, 0, 0))
        b.face([(xi, p.y, p.x), (xi, q.y, q.x), (xi, Q.y, Q.x), (xi, P.y, P.x)], 'paint', want=(-sx, 0, 0))
    if flaps:
        e = pts[-1]
        b.box('rubber', min(xo - sx * 0.05, xo - sx * 0.55), max(xo - sx * 0.05, xo - sx * 0.55), 0.42, e.y, e.x + 0.02, e.x + 0.04)


def maz543m(v, parent, right='cab', rear_z=None, rim='dark', intake=False, steer=None, fenders=True, front_arch=True):
    """the MAZ-543M / MAZ-7910 chassis on `parent`: the long two-door left cab, the bumper and engine bay with its
    grille at the front right, the set-back right cab (right='cab') or nothing (right=None: the payload fills it),
    frame, running gear, wheels. Returns layout info (axles, deck height, chassis end)."""
    b = parent
    A = MAZM['axles']
    maz_cab(b, -1, 'M')
    maz_front(b, 'M')
    maz_engine_m(b, zr=2.62, intake=intake)
    if right == 'cab':
        maz_right_cab_m(b)
    zmax = rear_z or MAZM['len']
    maz_frame(b, zmax, 'M', axles=A)
    wheels(v, None, A, MAZM['track'], MAZM['R'], MAZM['W'], MAZM['rim'], steer=steer or {0: 1.0, 1: 0.62}, lugs=18, seg=24, nbolts=10, rim_skin=rim, hub_skin=rim)
    if fenders:
        for sx in (-1, 1):
            if front_arch:
                arch_fender(b, sx, A[0], A[1], a0=120.0)
            arch_fender(b, sx, A[2], A[3])
    return {'axles': A, 'deck': MAZM['deck'], 'zmax': zmax}
