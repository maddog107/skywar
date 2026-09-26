# ═══════════════════════════════════════════════════════════════
# M142 HIMARS (High Mobility Artillery Rocket System) on the FMTV 6×6 with the armoured cab.
#   blender -b -P tools/vehicles/build.py -- himars
# 6.94 × 2.44 × 3.18 m, 16.25 t, 85 km/h, crew 3. FMTV layout from the Stewart & Stevenson M1088 sheet (front axle
# 1.34 m aft of the bumper, 4.1 m wheelbase, 1.5 m tandem, 395/85R20 tyres). The launcher-loader module carries one
# six-round pod (GMLRS / M26: 4.1 × 1.05 × 0.84 m); it traverses on its turntable and elevates about the pivot at
# its rear, the pod's covered front ends facing the cab when stowed (the prototype photo shows the front end
# raised). Photos: the HIMARS static display in Estonia and firing shots (US Army, public domain, Wikimedia Commons).
# Rig: turret (rot y, the launcher-loader module, full circle), launcher (rot x 0 → 60° about the rear pivot),
# muzzle_1..6 (pod front: 1-3 upper row left → right seen from behind, 4-6 lower row), ram_l / ram_r, door_l /
# door_r, 6 wheels (front axle steers), exhaust, seat_driver, hatch_entry.
# ═══════════════════════════════════════════════════════════════
import math
from mathutils import Vector
import vkit
from vkit import Vehicle, Part, rot, lerp
import usfam
from usfam import FMTV

AXLES = [1.34, 4.73, 6.23]
ZEND = 6.94
YD = 1.30                       # bed top
TURRET = (0.0, YD + 0.06, 5.55)
PIVOT = (0.0, 1.84, 6.72)
CAGE = {'z0': 2.46, 'z1': 6.92, 'y0': 1.84, 'y1': 2.92, 'hw': 0.78}
POD = {'z0': 2.62, 'z1': 6.72, 'hw': 0.525, 'y0': 1.92, 'y1': 2.76}


def build_chassis(v, b):
    F = FMTV
    fb, ft = F['frame']
    R = F['R']
    for sx in (-1, 1):
        b.box('dark', sx * 0.38, sx * 0.5, fb, ft, 0.3, ZEND - 0.04)
    for z in (0.5, 2.4, 3.8, 5.5, ZEND - 0.2):
        b.box('dark', -0.38, 0.38, fb + 0.04, ft - 0.04, z - 0.06, z + 0.06)
    b.face([(-0.9, fb - 0.02, 0.5), (0.9, fb - 0.02, 0.5), (0.9, fb - 0.02, ZEND - 0.3), (-0.9, fb - 0.02, ZEND - 0.3)], 'dark', want=(0, -1, 0))
    for z in AXLES:
        b.cyl('dark', (-0.82, R, z), (0.82, R, z), 0.08, 0.08, 10)
        b.lathe((0, R, z - 0.24), (0, 0, 1), [(0, 0.05, 'dark'), (0.05, 0.18, 'dark'), (0.34, 0.19, 'dark'), (0.42, 0.08, 'dark')], n=12, smooth=True)
        for sx in (-1, 1):
            b.box('dark', sx * 0.34, sx * 0.52, R + 0.06, fb, z - 0.5, z + 0.5)            # leaf springs
            b.cyl('dark', (sx * 0.62, R + 0.02, z - 0.18), (sx * 0.6, fb + 0.1, z - 0.28), 0.035, 0.035, 6)
    b.cyl('dark', (0, R + 0.1, 1.0), (0, R + 0.05, AXLES[-1]), 0.05, 0.05, 8)
    usfam.wheels(v, None, AXLES, F['track'], R, F['W'], F['rim'], steer={0: 1.0}, lugs=20, seg=24, nbolts=10, cti=True,
                 rim_skin='paint', hub_skin='paint', tread='block', rim_dish=0.05)
    # bed: deck plate, side rails, fenders over the tandem with flaps
    b.box('paint', -1.18, 1.18, YD - 0.08, YD, 2.4, ZEND, bev=0.015)
    for sx in (-1, 1):
        b.box('paint', sx * 1.08, sx * 1.2, YD - 0.28, YD, 2.4, ZEND)
        b.box('paint', sx * 0.72, sx * 1.2, YD - 0.1, YD - 0.06, 3.95, ZEND - 0.05)
        b.box('rubber', sx * 0.75, sx * 1.18, 0.38, YD - 0.1, ZEND - 0.06, ZEND - 0.03)
        b.box('rubber', sx * 0.75, sx * 1.18, 0.5, YD - 0.1, 3.95, 3.98)
    b.panel('tread_plate', [(-1.15, YD, 2.45), (1.15, YD, 2.45), (1.15, YD, 3.9), (-1.15, YD, 3.9)], (0, 1, 0), off=0.004)
    # behind the cab: exhaust stack (right), air intake with its mesh cap (left)
    b.cyl('dark', (0.98, 1.3, 2.52), (0.98, 3.05, 2.52), 0.07, 0.07, 10)
    b.cyl('paint', (0.98, 2.0, 2.52), (0.98, 2.85, 2.52), 0.095, 0.095, 10, cap0=False, cap1=False)
    b.cyl('soot', (0.98, 3.05, 2.52), (0.98, 3.09, 2.52), 0.075, 0.075, 10)
    b.empty('exhaust', (0.98, 3.09, 2.52), (0, 1, 0))
    b.box('paint', -1.15, -0.72, YD, 2.95, 2.42, 2.78, bev=0.02)
    b.panel('mesh', [(-1.1, 2.95, 2.46), (-0.77, 2.95, 2.46), (-0.77, 2.95, 2.74), (-1.1, 2.95, 2.74)], (0, 1, 0), off=0.004)
    # side boxes between the front wheel and the tandem: fuel tank (left), batteries / stowage (right)
    b.cyl('paint', (-0.92, 0.95, 2.5), (-0.92, 0.95, 3.85), 0.27, 0.27, 16)
    for z in (2.75, 3.6):
        b.box('dark', -1.22, -0.62, 0.64, 1.25, z - 0.04, z + 0.04)
    b.cyl('dark', (-0.92, 1.2, 3.2), (-0.92, 1.3, 3.2), 0.06, 0.06, 8)
    b.box('paint', 0.62, 1.2, 0.72, YD - 0.28, 2.5, 3.88, bev=0.02)
    usfam.hatch_x(b, 1.2, 1, 0.76, YD - 0.32, 2.56, 3.18)
    usfam.hatch_x(b, 1.2, 1, 0.76, YD - 0.32, 3.22, 3.82, hinge='back')
    # rear: lights, reflectors, pintle, the launcher's travel-lock post behind the cab
    b.box('paint', -1.18, 1.18, 0.74, YD - 0.08, ZEND - 0.18, ZEND, bev=0.02)
    for sx in (-1, 1):
        vkit.lamp_box(b, (sx * 0.95, 1.0, ZEND + 0.02), (0.2, 0.1, 0.05), (0, 0, 1), lens='lens_red')
        vkit.lamp_box(b, (sx * 0.95, 0.86, ZEND + 0.02), (0.09, 0.07, 0.05), (0, 0, 1), lens='lens_amber')
        usfam.reflector_tri(b, (sx * 0.62, 1.0, ZEND), (0, 0, 1), 0.06)
    b.box('dark', -0.1, 0.1, 0.8, 0.98, ZEND, ZEND + 0.1)
    for sx in (-1, 1):
        b.box('paint', sx * 0.3, sx * 0.5, YD, CAGE['y0'] - 0.01, 2.5, 2.7)
        b.box('dark', sx * 0.26, sx * 0.54, CAGE['y0'] - 0.05, CAGE['y0'] - 0.01, 2.46, 2.74)


def build_turret(v):
    tx, ty, tz = TURRET
    t = Part(v, 'turret', pivot=TURRET, joint=rot('y', -math.pi, math.pi, stow=0.0, deploy=0.0, group='turret'))
    t.cyl('dark', (0, YD, tz), (0, YD + 0.1, tz), 0.85, 0.85, 26, cap0=False)
    t.cyl('paint', (0, YD + 0.1, tz), (0, YD + 0.18, tz), 0.9, 0.88, 26, cap0=False)
    t.bolts('dark', (0, YD + 0.1, tz), (0, 1, 0), 0.8, 18, rb=0.018, h=0.03)
    px, py, pz = PIVOT
    for sx in (-1, 1):
        t.box('paint', sx * 0.45, sx * 0.7, YD + 0.16, py - 0.02, pz - 0.28, pz + 0.18, bev=0.02)          # pivot pedestals
        t.box('paint', sx * 0.36, sx * 0.62, YD + 0.16, YD + 0.4, 4.3, pz - 0.1)                           # base beams
        t.box('dark', sx * 0.38, sx * 0.56, YD + 0.16, YD + 0.34, 5.95, 6.25)                              # ram brackets
    t.box('paint', -0.62, 0.62, YD + 0.16, YD + 0.32, 4.3, 4.55)
    # hydraulic power unit / electronics on the base
    t.box('paint', -0.3, 0.3, YD + 0.18, YD + 0.48, 4.6, 5.4, bev=0.02)
    usfam.hatch_x(t, 0.3, 1, YD + 0.2, YD + 0.45, 4.7, 5.3)
    t.tube('hose', [(0.2, YD + 0.48, 5.3), (0.25, YD + 0.4, 5.8), (0.4, YD + 0.3, 6.0)], 0.02, 5)
    return t


def build_launcher(v, tur):
    px, py, pz = PIVOT
    L = Part(v, 'launcher', pivot=PIVOT, parent=tur, joint=rot('x', 0.0, math.radians(60), stow=0.0, deploy=math.radians(60), group='launcher'))
    z0, z1, y0, y1, hw = CAGE['z0'], CAGE['z1'], CAGE['y0'], CAGE['y1'], CAGE['hw']
    # the cage: floor frame, riveted side panels, top frame, end frames
    L.box('paint', -hw, hw, y0, y0 + 0.08, z0, z1)
    for sx in (-1, 1):
        x = sx * hw
        L.box('paint', min(x, x - sx * 0.05), max(x, x - sx * 0.05), y0, y1, z0, z1)
        for k in range(6):
            za = lerp(z0 + 0.12, z1 - 0.12, k / 6)
            zb = lerp(z0 + 0.12, z1 - 0.12, (k + 1) / 6) - 0.06
            usfam.panel_lines(L, [(x, y0 + 0.14, za), (x, y0 + 0.14, zb), (x, y1 - 0.12, zb), (x, y1 - 0.12, za)], (sx, 0, 0), 0.012)
            for (yy, zz) in ((y0 + 0.2, za + 0.06), (y1 - 0.18, za + 0.06), (y0 + 0.2, zb - 0.06), (y1 - 0.18, zb - 0.06)):
                L.cyl('paint', (x, yy, zz), (x + sx * 0.012, yy, zz), 0.018, 0.018, 6, cap0=False)
            L.box('paint', min(x, x + sx * 0.03), max(x, x + sx * 0.03), y0 + 0.1, y1 - 0.06, zb + 0.01, zb + 0.05)
        usfam.stencil_box(L, (x, y1 - 0.35, z0 + 0.8), 0.4, 0.08, (sx, 0, 0))
        usfam.stencil_box(L, (x, y0 + 0.3, z1 - 1.2), 0.25, 0.1, (sx, 0, 0), skin='yellow')
    for z in (z0, z1 - 0.1):
        L.box('paint', -hw, hw, y1 - 0.1, y1, z, z + 0.1)
    # loading hoist: two rails along the top, over-hanging both ends, with the crossbeam at the rear
    for sx in (-1, 1):
        L.box('paint', sx * 0.4 - 0.06, sx * 0.4 + 0.06, y1, y1 + 0.14, z0 - 0.06, z1 + 0.02, bev=0.01)
        L.box('dark', sx * 0.4 - 0.08, sx * 0.4 + 0.08, y1 + 0.14, y1 + 0.17, z1 - 0.2, z1 + 0.02)
    L.box('paint', -0.52, 0.52, y1 + 0.02, y1 + 0.16, z1 - 0.12, z1 + 0.02)
    L.box('dark', -0.12, 0.12, y1 - 0.2, y1 + 0.02, z1 - 0.1, z1 - 0.02)                        # hoist block
    # the pod: covered front, open tube ends at the rear, lifting frame on top
    pz0, pz1, phw, py0, py1 = POD['z0'], POD['z1'], POD['hw'], POD['y0'], POD['y1']
    L.box('paint', -phw, phw, py0, py1, pz0, pz1, bev=0.02)
    for z in (pz0 + 0.25, (pz0 + pz1) / 2, pz1 - 0.25):
        L.box('paint', -phw - 0.02, phw + 0.02, py0 - 0.02, py1 + 0.02, z - 0.05, z + 0.05)
    cols = (-0.34, 0.0, 0.34)
    rows = (py1 - 0.21, py0 + 0.21)
    k = 1
    for yy in rows:
        for xx in cols:
            # front cover (frangible) and the tube's aft closure
            L.cyl('dark', (xx, yy, pz0 - 0.03), (xx, yy, pz0 + 0.001), 0.16, 0.16, 16, cap1=False)
            L.disc('radome', (xx, yy, pz0 - 0.031), (0, 0, -1), 0.145, 16)
            L.cyl('dark', (xx, yy, pz1 - 0.001), (xx, yy, pz1 + 0.03), 0.16, 0.16, 16, cap0=False)
            L.disc('soot', (xx, yy, pz1 + 0.031), (0, 0, 1), 0.13, 16)
            L.empty('muzzle_%d' % k, (xx, yy, pz0 - 0.04), (0, 0, -1))
            k += 1
    # cable from the pod to the cage and the pivot trunnions
    L.tube('cable', [(-phw, py0 + 0.1, pz1 - 0.1), (-hw + 0.08, py0 + 0.05, pz1 + 0.05)], 0.02, 5)
    for sx in (-1, 1):
        L.cyl('dark', (sx * 0.45, py, pz), (sx * 0.72, py, pz), 0.1, 0.1, 12)
    return L


def make():
    vkit.setup_materials('blue_green')
    v = Vehicle('himars', 'M142 High Mobility Artillery Rocket System', scheme='blue_green')
    b = Part(v, 'body')
    usfam.fmtv_armoured_cab(v, b)
    build_chassis(v, b)
    tur = build_turret(v)
    lau = build_launcher(v, tur)
    for sx, n in ((-1, 'ram_l'), (1, 'ram_r')):
        vkit.ram(v, n, tur, (sx * 0.47, YD + 0.26, 6.1), lau, (sx * 0.47, CAGE['y0'] - 0.02, 5.0), r=0.07)
    return v
