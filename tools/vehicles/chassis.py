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
    xil = sx * 0.77                     # inner face below the windscreen (the grille lies between)
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
    # side windows on the outer face (x = xo): door window and rear window
    for (za, zb) in ((1.42, 2.02), (2.20, 2.74)):
        b.panel('glass', [(xo, 2.12, za), (xo, 2.12, zb), (xo, 2.68, zb), (xo, 2.68, za)], (sx, 0, 0), off=0.006, frame=0.035)
    # inner side window (towards the missile), small
    b.panel('glass', [(xi, 2.15, 2.25), (xi, 2.15, 2.75), (xi, 2.62, 2.75), (xi, 2.62, 2.25)], (-sx, 0, 0), off=0.006, frame=0.03)
    # rear window (edge 3: outer-rear → inner-rear)
    n3 = fnorm(r0, r1, 3)
    b.panel('glass', [on(r0, r1, 3, 0.22, 0.2), on(r0, r1, 3, 0.8, 0.2), on(r0, r1, 3, 0.8, 0.8), on(r0, r1, 3, 0.22, 0.8)], n3, off=0.006, frame=0.03)
    # wiper arms on the windscreen
    for u in (0.3, 0.72):
        p0 = on(r0, r1, 0, u, 0.1) + n * 0.02
        p1 = on(r0, r1, 0, u - 0.12, 0.72) + n * 0.02
        b.beam('black', p0, p1, 0.012, 0.008)
    # door: outline (panel lines), handle, hinges
    dz0, dz1, dy0, dy1 = 1.36, 2.08, 1.66, 2.80
    for (p0, p1) in (((xo, dy0, dz0), (xo, dy1, dz0)), ((xo, dy0, dz1), (xo, dy1, dz1)), ((xo, dy1, dz0), (xo, dy1, dz1)), ((xo, dy0, dz0), (xo, dy0, dz1))):
        P0, P1 = Vector(p0), Vector(p1)
        d = (P1 - P0).normalized()
        w = Vector((0, 0.012, 0)) if abs(d.y) < 0.5 else Vector((0, 0, 0.012))
        b.panel('black', [P0 - w, P1 - w, P1 + w, P0 + w], (sx, 0, 0), off=0.003)
    vkit.grab_handle(b, (xo + sx * 0.01, 1.98, dz1 - 0.12), (0, 0, 1), (sx, 0, 0), 0.16, 0.035, 'dark')
    for y in (1.9, 2.6):
        b.cyl('dark', (xo + sx * 0.02, y - 0.07, dz0 - 0.02), (xo + sx * 0.02, y + 0.07, dz0 - 0.02), 0.022, 0.022, 6)
    # grab rail up the cab side, behind the door
    vkit.grab_handle(b, (xo + sx * 0.01, 2.2, 2.28), (0, 1, 0), (sx, 0, 0), 0.5, 0.05, 'dark')
    # boarding steps below the door, ahead of the front wheel
    for k, y in enumerate((0.72, 1.02, 1.30)):
        zs = 1.28 + k * 0.08
        b.box('dark', xo - sx * 0.02, xo - sx * 0.42, y - 0.03, y, zs, zs + 0.42)
    b.beam('dark', (xo - sx * 0.05, 0.70, 1.28), (xo - sx * 0.05, 1.40, 1.46), 0.03, 0.03)
    b.beam('dark', (xo - sx * 0.05, 0.70, 1.72), (xo - sx * 0.05, 1.40, 1.86), 0.03, 0.03)
    # headlight pod on the lower front, near the outer corner
    vkit.headlight(b, (xo - sx * 0.40, 1.74, zf - 0.02), (0, 0, -1), r=0.1, depth=0.1, skin_body='dark', lens='lens')
    b.panel('dark', [(xo - sx * 0.95, 1.86, zf), (xo - sx * 0.62, 1.86, zf), (xo - sx * 0.62, 1.96, zf), (xo - sx * 0.95, 1.96, zf)], (0, 0, -1), off=0.004)
    vkit.grab_handle(b, (xo - sx * 0.78, 1.66, zf - 0.005), (1, 0, 0), (0, 0, -1), 0.3, 0.04, 'dark')
    # roof: hatch, marker lamps, rain gutter
    hc = ((xo + xi) / 2, yr, 1.9)
    b.panel('paint', [(hc[0] - 0.28, yr, 1.62), (hc[0] + 0.28, yr, 1.62), (hc[0] + 0.28, yr, 2.18), (hc[0] - 0.28, yr, 2.18)], (0, 1, 0), off=0.025, frame=0.03, frame_skin='dark')
    for dx in (-0.25, 0.25):
        vkit.lamp_box(b, (hc[0] + dx, yr + 0.03, zf + 0.42), (0.1, 0.06, 0.06), (0, 0, -1), lens='lens_amber')
    # mirror on the front outer corner
    vkit.mirror(b, (xo - sx * 0.05, 2.5, zf + 0.35), (xo + sx * 0.22, 2.45, zf + 0.05), (0.18, 0.28))


def maz_front(b, variant='A'):
    """bumper, skid plate, grille, hood between the cabs, bumper lamps, tow gear"""
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
    # hood between the cabs (engine cover), with handles and a filler cap
    b.box('paint', -0.77, 0.77, 2.02, 2.10, gz - 0.02, 1.70, bev=0.02)
    for x in (-0.35, 0.35):
        vkit.grab_handle(b, (x, 2.10, 0.62), (1, 0, 0), (0, 1, 0), 0.22, 0.04, 'dark')
    b.cyl('dark', (0.0, 2.10, 0.9), (0.0, 2.16, 0.9), 0.07, 0.07, 10)
    # mesh air intakes on the cab inner walls, by the nose (the front photo's two screens)
    for sx in (-1, 1):
        b.panel('mesh', [(sx * 0.465, 2.12, 0.62), (sx * 0.465, 2.12, 1.05), (sx * 0.465, 2.55, 1.05), (sx * 0.465, 2.55, 0.62)], (-sx, 0, 0), off=0.004)


def maz_frame(b, zmax, variant='A'):
    """frame rails, cross members, underbody pan, suspension arms, drive line"""
    R = MAZ['R']
    for sx in (-1, 1):
        b.box('dark', sx * 0.40, sx * 0.56, 0.95, 1.30, 1.2, zmax, skip=())
    for z in (1.4, 3.6, 5.9, 7.0, 9.2, zmax - 0.1):
        b.box('dark', -0.40, 0.40, 1.05, 1.22, z - 0.07, z + 0.07)
    # underbody pan between the wheels (hides the see-through)
    b.face([(-0.9, 0.95, 1.3), (0.9, 0.95, 1.3), (0.9, 0.95, zmax), (-0.9, 0.95, zmax)], 'dark', want=(0, -1, 0))
    # drive line: shafts and transfer / axle differential boxes
    for z in MAZ['axles']:
        b.box('dark', -0.30, 0.30, 0.62, 0.98, z - 0.28, z + 0.28, bev=0.04)
        for sx in (-1, 1):
            # half shaft to the wheel hub, suspension wishbones, torsion bar
            b.cyl('dark', (sx * 0.30, R, z), (sx * 0.95, R, z), 0.06, 0.06, 8)
            b.beam('dark', (sx * 0.42, 0.98, z - 0.35), (sx * 0.92, R + 0.10, z - 0.05), 0.08, 0.06)
            b.beam('dark', (sx * 0.42, 0.62, z - 0.35), (sx * 0.92, R - 0.12, z - 0.05), 0.08, 0.06)
            b.cyl('dark', (sx * 0.74, R - 0.2, z), (sx * 0.74, R + 0.22, z), 0.11, 0.11, 10)   # hub carrier / planetary reducer
    b.cyl('dark', (0, 0.78, 1.5), (0, 0.78, MAZ['axles'][-1]), 0.06, 0.06, 8)


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
