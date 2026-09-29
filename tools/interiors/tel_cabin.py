# ═══════════════════════════════════════════════════════════════
# 9P117 Scud TEL (MAZ-543 chassis) — the sealed equipment cabin ("рубка") behind the cabs, the launch crew's post.
# A closed room (the game renders it alone). Blender, headless:
#   blender -b -P tools/interiors/tel_cabin.py -- models/interiors/tel_cabin.glb
# Room frame: the origin is the cabin floor's centre, x right (the vehicle's right), y up, −z forward (toward the
# cabs). In the vehicle frame of models/vehicles/scud.glb (vehicle faces −z, wheels on y 0; measured in Blender:
# the model is recentred 6.002 m aft of the bumper face, its "section A" compartments behind the cabs span
# x ±1.53, z −3.05..−0.60, y 1.58..2.55) the origin sits at (0.0, 1.00, −1.83): the cabin straddles the frame with
# its floor dropped into the chassis recess, its roof level with section A's top (2.55). The exterior's section A is
# a schematic (0.97 m tall inside its skin); this interior has the real cabin's height (1.55 m) and width.
# The real thing (missilery.info 9P117, https://missilery.info/missile/8k14/9p117 ; https://missilery.info/missile/8k14 ;
# https://en.wikipedia.org/wiki/MAZ-543 ; https://en.wikipedia.org/wiki/Scud):
#   • the launch controls are not in the cabs but in a separate sealed cabin mounted on the frame behind them; its
#     volume is split into LEFT and RIGHT compartments by the hump over the recess for the chassis; three seats
#     (two left, one right); a door in each side wall, each with a window and a blackout curtain; hinged seat backs
#   • LEFT: the 2V12M control-system test and launch station ("пост 2В12М"), the power distribution panel (РП, on
#     the ceiling), the generator control board (ЩУГ), the 2V26 self-destruct check panel, the POG-6 warhead
#     heating panel, the 9V362M1 code lock (КБУ: dial a six-digit code with the switch at "Н", then switch to "О";
#     without it the missile won't launch), the batteries (12-СТ-70) in their own box
#   • RIGHT: the APD-8 diesel generator (АПД-8-П/28-2) and the battery panel (ПА); the 9V344 remote launch panel
#     comes on a cable so the launch can be made from the cabin or from cover
#   • launch: rear supports down, raise the boom with the missile (2.25–3.5 min), table stops and wind bolts, level
#     and aim by turning the launch table (1G5 gyrocompass / theodolite, aiming poles), pre-launch checks (control
#     system test, combat mode, self-destruct prep, warhead mode, enter range, aim check, starting fuel, unlock the
#     code device, missile batteries, wind bolts), launch
# Layout: the operator sits in the left compartment facing forward at the 2V12M (its sloped desk of bat toggles,
# the upper panel with the lamp strip, a CRT and gauges); the code lock on the wall to his left, the generator board
# and the door behind it; the 9V344 on a shelf at his right hand over the hump; the batteries under the second seat
# at the back; over the hump you see the right compartment with the APD-8.
# ═══════════════════════════════════════════════════════════════
import sys, os, math
sys.dont_write_bytecode = True
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import roomkit as R
from roomkit import PI
from shipkit import Part, material, srgb, MATS
from mathutils import Vector

args = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
OUT = args[0] if args else 'models/interiors/tel_cabin.glb'

R.begin()
S = R.static()
for name, col, metal, rough in [
    ('ConsoleGreen', 0x5d6b57, 0.25, 0.55), ('ConsoleGreenDark', 0x3b4638, 0.25, 0.55), ('Paint', 0xe6e2d4, 0.0, 0.7),
    ('Curtain', 0x2f3a28, 0.0, 0.95), ('Olive', 0x4f5638, 0.1, 0.8), ('Bakelite', 0x1d1714, 0.1, 0.35),
    ('Cream', 0xd9d2b8, 0.0, 0.6), ('WallCab', 0xaeb5a6, 0.1, 0.65),
]:
    material(name, srgb(col), metal, rough)
material('LightWarm', srgb(0xffd9a0), 0.0, 0.4, emit=srgb(0xffd9a0), emit_strength=2.5)
material('LightWindow', srgb(0x9aa9ad), 0.0, 0.8, emit=srgb(0x9aa9ad), emit_strength=0.7)

XI, ZF, ZB, HC = 1.44, -1.15, 1.15, 1.55        # half width, front / back walls, ceiling
HX0, HX1, HH = 0.46, 0.58, 0.34                  # the hump: top half width, base half width, height
TX0, TX1, TY = 0.6, 0.78, 1.06                   # the ceiling trough under the erector: bottom / top half width, depth
_last = [0]


def mark(what):
    n = S.tris()
    print('  [cabin] %-20s %6d tris (total %d)' % (what, n - _last[0], n))
    _last[0] = n


def quad(mat, pts, n, uvs=None):
    if uvs is None:
        ax = max(range(3), key=lambda i: abs(n[i]))
        uvs = [(p[0], p[2]) if ax == 1 else (p[2], p[1]) if ax == 0 else (p[0], p[1]) for p in pts]
    S.g(mat).face([tuple(p) for p in pts], uvs, n)


def box(mat, x0, x1, y0, y1, z0, z1, skip=()):
    R.uvbox(S, mat, x0, x1, y0, y1, z0, z1, skip=skip)


def P(M, o, x, y, z=0.0):
    return R.xf(M, o, (x, y, z))


# ═════════════ small parts on a panel (local frame M, o: x across, y up, z out of the panel) ═════════════
def plate(M, o, x0, x1, y0, y1, mat, z=0.0015):
    S.g(mat).face([P(M, o, x0, y0, z), P(M, o, x1, y0, z), P(M, o, x1, y1, z), P(M, o, x0, y1, z)], None, tuple(M @ Vector((0, 0, 1))))


def outline(M, o, x0, x1, y0, y1, w=0.003, mat='Paint'):
    """a painted outline round a group of controls"""
    for (a, b, c, d) in ((x0, y0, x1, y0 + w), (x0, y1 - w, x1, y1), (x0, y0, x0 + w, y1), (x1 - w, y0, x1, y1)):
        plate(M, o, a, c, b, d, mat, 0.0012)


def gauge(M, o, x, y, r, needle=0.6):
    """a Soviet panel instrument: chrome rim, black face, white ticks and needle"""
    c = P(M, o, x, y)
    R.ocyl(S, 'Chrome', M, c, (0, 0, 0), r * 1.15, r * 1.15, 0.0, 0.012, 14, axis='z', cap0=False)
    R.ocyl(S, 'Black', M, c, (0, 0, 0), r, r, 0.0, 0.013, 14, axis='z', cap0=False)
    for k in range(9):
        a = -2.3 + 4.6 * k / 8
        dx, dy = math.sin(a), math.cos(a)
        L = r * (0.25 if k % 2 == 0 else 0.15)
        p0, p1 = (dx * (r * 0.92 - L), dy * (r * 0.92 - L)), (dx * r * 0.92, dy * r * 0.92)
        sx, sy = dy * 0.0025, -dx * 0.0025
        S.g('Paint').face([P(M, c, p0[0] - sx, p0[1] - sy, 0.0135), P(M, c, p1[0] - sx, p1[1] - sy, 0.0135), P(M, c, p1[0] + sx, p1[1] + sy, 0.0135), P(M, c, p0[0] + sx, p0[1] + sy, 0.0135)], None, tuple(M @ Vector((0, 0, 1))))
    a = -2.3 + 4.6 * needle
    dx, dy = math.sin(a), math.cos(a)
    S.g('Paint').face([P(M, c, -dy * 0.002, dx * 0.002, 0.0145), P(M, c, dx * r * 0.85 - dy * 0.001, dy * r * 0.85 + dx * 0.001, 0.0145), P(M, c, dx * r * 0.85 + dy * 0.001, dy * r * 0.85 - dx * 0.001, 0.0145), P(M, c, dy * 0.002, -dx * 0.002, 0.0145)], None, tuple(M @ Vector((0, 0, 1))))


def slamp(M, o, x, y, mat='LampGreen', r=0.009):
    """a static indicator lamp: a hex-ish bezel and a domed coloured lens"""
    c = P(M, o, x, y)
    R.ocyl(S, 'Chrome', M, c, (0, 0, 0), r * 1.45, r * 1.45, 0.0, 0.006, 6, axis='z', cap0=False)
    R.ocyl(S, mat, M, c, (0, 0, 0), r, r * 0.7, 0.006, 0.013, 8, axis='z', cap0=False)


def stoggle(M, o, x, y, up=True):
    """a static small toggle"""
    c = P(M, o, x, y)
    R.ocyl(S, 'Chrome', M, c, (0, 0, 0), 0.008, 0.008, 0.0, 0.005, 6, axis='z', cap0=False)
    a = 0.45 if up else -0.45
    tip = P(M, c, 0, math.sin(a) * 0.022, 0.005 + math.cos(a) * 0.022)
    S.beam('Chrome', P(M, c, 0, 0, 0.005), tip, 0.004, caps=False)
    S.sphere('Chrome', tip, 0.004, 0.004, 0.004, 6, 3)


def srotary(M, o, x, y, r=0.018, a=0.4, ticks=6):
    """a static rotary switch (галетный переключатель): a black bakelite knob with a pointer, detent ticks round it"""
    c = P(M, o, x, y)
    R.ocyl(S, 'Bakelite', M, c, (0, 0, 0), r, r * 0.85, 0.0, 0.018, 10, axis='z', cap0=False)
    S.beam('Bakelite', P(M, c, -math.sin(a) * r * 0.9, -math.cos(a) * r * 0.9, 0.024), P(M, c, math.sin(a) * r * 0.9, math.cos(a) * r * 0.9, 0.024), 0.007, 0.012, caps=False)
    for k in range(ticks):
        t = -1.2 + 2.4 * k / max(1, ticks - 1)
        dx, dy = math.sin(t), math.cos(t)
        plate(M, c, dx * r * 1.3 - 0.0015, dx * r * 1.3 + 0.0015, dy * r * 1.3 - 0.004, dy * r * 1.3 + 0.004, 'Paint', 0.0012)


def sknob(M, o, x, y, r=0.012):
    """a small black bakelite knob"""
    c = P(M, o, x, y)
    R.ocyl(S, 'Bakelite', M, c, (0, 0, 0), r, r * 0.8, 0.0, 0.016, 8, axis='z', cap0=False)


def connector(M, o, x, y, r=0.022, cable=None):
    """a round military connector (ШР) on the panel, with its plug and a cable dropping away"""
    c = P(M, o, x, y)
    R.ocyl(S, 'Steel', M, c, (0, 0, 0), r, r, 0.0, 0.012, 10, axis='z', cap0=False)
    R.ocyl(S, 'Olive', M, c, (0, 0, 0), r * 0.9, r * 0.8, 0.012, 0.05, 10, axis='z', cap0=False)
    if cable:
        pts = [P(M, c, 0, 0, 0.05)] + cable
        for a, b in zip(pts, pts[1:]):
            R._tube(S, a, b, r * 0.35, 'Cable', 6)


def screws(M, o, x0, x1, y0, y1):
    for (x, y) in ((x0 + 0.012, y0 + 0.012), (x1 - 0.012, y0 + 0.012), (x0 + 0.012, y1 - 0.012), (x1 - 0.012, y1 - 0.012)):
        R.ocyl(S, 'Chrome', M, P(M, o, x, y), (0, 0, 0), 0.004, 0.004, 0.0, 0.003, 5, axis='z', cap0=False)


# ═════════════ the interactive parts (custom Soviet looks, same contracts as roomkit's) ═════════════
def bat_toggle(name, M, o, x, y, yaw, tilt, throw=0.9):
    """a big bat-handle toggle (ТВ1-1 style): a hex nut and a long bat; modelled down (k 0 = off), flips up (k 1)"""
    Pn = Part(name)
    Pn.cyl('Chrome', (0, 0, 0), 0.011, 0.011, 0.0, 0.006, 6, axis='z')
    Pn.cyl('Chrome', (0, 0, 0), 0.006, 0.005, 0.006, 0.012, 8, axis='z')
    a = throw / 2
    tip = (0, -math.sin(a) * 0.045, 0.012 + math.cos(a) * 0.045)
    Pn.beam('Chrome', (0, 0, 0.01), tip, 0.006, 0.004)
    Pn.sphere('Chrome', tip, 0.0055, 0.0055, 0.0055, 8, 4)
    return R.node(name, Pn, P(M, o, x, y), yaw, tilt, ctl={'t': 'switch', 'hinge': [1, 0, 0], 'open': -throw})


def code_wheel(name, M, o, x, y, yaw, tilt, r=0.016):
    """one of the code lock's six digit selectors: a knurled bakelite knob with a pointer, 10 detents (0..9)"""
    Pn = Part(name)
    Pn.cyl('Bakelite', (0, 0, 0), r, r * 0.92, 0.0, 0.02, 12, axis='z')
    Pn.box('Paint', -0.0018, 0.0018, r * 0.25, r * 0.95, 0.02, 0.0205)
    Pn.box('Bakelite', -r * 0.3, r * 0.3, -r * 0.95, r * 0.95, 0.02, 0.028)
    node = R.node(name, Pn, P(M, o, x, y), yaw, tilt, ctl={'t': 'knob', 'hinge': [0, 0, 1], 'open': -2 * PI * 0.9, 'steps': 10})
    c = P(M, o, x, y)
    for k in range(10):
        t = 2 * PI * 0.9 * k / 9
        dx, dy = math.sin(t), math.cos(t)
        plate(M, c, dx * r * 1.35 - 0.0012, dx * r * 1.35 + 0.0012, dy * r * 1.35 - 0.003, dy * r * 1.35 + 0.003, 'Paint' if k else 'Red', 0.0012)
    return node


# ═════════════ the shell: floor, the hump over the chassis recess, walls, the ceiling with its trough ═════════════
for sx in (-1, 1):
    xa, xb = sorted((sx * XI, sx * HX1))
    quad('Deck', [(xa, 0, ZF), (xa, 0, ZB), (xb, 0, ZB), (xb, 0, ZF)], (0, 1, 0))
    # the hump's side (painted), a rubber mat on its top
    quad('ConsoleGreen', [(sx * HX1, 0, ZF), (sx * HX1, 0, ZB), (sx * HX0, HH, ZB), (sx * HX0, HH, ZF)], (sx * 0.95, 0.3, 0))
    # the side walls: painted steel, a darker dado band, a cable duct along the top
    x = sx * XI
    quad('WallCab', [(x, 0, ZF), (x, 0, ZB), (x, HC, ZB), (x, HC, ZF)], (-sx, 0, 0))
    quad('ConsoleGreenDark', [(x - sx * 0.002, 0.0, ZF), (x - sx * 0.002, 0.0, ZB), (x - sx * 0.002, 0.1, ZB), (x - sx * 0.002, 0.1, ZF)], (-sx, 0, 0))
    xa, xb = sorted((x, x - sx * 0.06))
    box('ConsoleGreen', xa, xb, HC - 0.07, HC, ZF, ZB, skip=('top', 'nx' if sx < 0 else 'px'))
    # the ceiling over the compartment, the trough's sloping side
    xa, xb = sorted((sx * XI, sx * TX1))
    quad('WallCab', [(xa, HC, ZF), (xb, HC, ZF), (xb, HC, ZB), (xa, HC, ZB)], (0, -1, 0))
    quad('WallCab', [(sx * TX1, HC, ZF), (sx * TX1, HC, ZB), (sx * TX0, TY, ZB), (sx * TX0, TY, ZF)], (sx * 0.94, -0.35, 0))  # (faces the compartment below it: it pointed into the trough, and from the seat you saw through the roof)
quad('Rubber', [(-HX0, HH, ZF), (-HX0, HH, ZB), (HX0, HH, ZB), (HX0, HH, ZF)], (0, 1, 0))
quad('WallCab', [(-TX0, TY, ZF), (TX0, TY, ZF), (TX0, TY, ZB), (-TX0, TY, ZB)], (0, -1, 0))
# ribs across the ceiling (the roof's stiffeners), rivet strips on the walls
for z in (-0.55, 0.05, 0.65):
    for sx in (-1, 1):
        xa, xb = sorted((sx * XI, sx * TX1))
        box('WallCab', xa, xb, HC - 0.035, HC, z - 0.025, z + 0.025, skip=('top',))
for (z, n) in ((ZF, (0, 0, 1)), (ZB, (0, 0, -1))):
    prof = [(-XI, 0.0), (-HX1, 0.0), (-HX0, HH), (HX0, HH), (HX1, 0.0), (XI, 0.0), (XI, HC), (TX1, HC), (TX0, TY), (-TX0, TY), (-TX1, HC), (-XI, HC)]
    S.g('WallCab').face([(x, y, z) for (x, y) in prof], [(x * (1 if n[2] > 0 else -1), y) for (x, y) in prof], n)
mark('shell')

# ═════════════ the 2V12M test and launch station (front of the left compartment) ═════════════
XL, XR = -1.42, -0.44
XC, W = (XL + XR) / 2, XR - XL
ZC = ZF + 0.36                        # the cabinet's front face
# the lower cabinet: two doors with louvres and handles, a plinth
box('ConsoleGreen', XL, XR, 0.0, 0.6, ZF, ZC, skip=('nz', 'bottom'))
box('Black', XL + 0.01, XR - 0.01, 0.0, 0.05, ZC, ZC + 0.005, skip=('nz', 'bottom'))
for (x0, x1) in ((XL + 0.03, XC - 0.01), (XC + 0.01, XR - 0.03)):
    quad('ConsoleGreenDark', [(x0, 0.08, ZC + 0.002), (x1, 0.08, ZC + 0.002), (x1, 0.56, ZC + 0.002), (x0, 0.56, ZC + 0.002)], (0, 0, 1))
    for k in range(6):
        y = 0.14 + k * 0.035
        quad('Black', [(x0 + 0.05, y, ZC + 0.003), (x1 - 0.05, y, ZC + 0.003), (x1 - 0.05, y + 0.015, ZC + 0.003), (x0 + 0.05, y + 0.015, ZC + 0.003)], (0, 0, 1))
    box('Chrome', (x0 + x1) / 2 - 0.05, (x0 + x1) / 2 + 0.05, 0.45, 0.47, ZC + 0.002, ZC + 0.03, skip=('nz',))
    for yy in (0.1, 0.52):
        box('Chrome', x0 + 0.005, x0 + 0.02, yy, yy + 0.03, ZC + 0.002, ZC + 0.012, skip=('nz',))
# the sloped desk (35°) and the upper panel (leaning back 12°), side cheeks
DT = math.radians(55)
Md = R.mat3(0, DT)
od = (XC, 0.6 + 0.125 * math.sin(math.radians(35)), ZC - 0.125 * math.cos(math.radians(35)))
R.obox(S, 'ConsoleGreenDark', Md, od, -W / 2, W / 2, -0.125, 0.125, -0.03, 0.0)
UT = math.radians(12)
Mu = R.mat3(0, UT)
ybot, zbot = 0.6 + 0.25 * math.sin(math.radians(35)), ZC - 0.25 * math.cos(math.radians(35))
ou = (XC, ybot + 0.34 * math.cos(UT), zbot - 0.34 * math.sin(UT))
R.obox(S, 'ConsoleGreenDark', Mu, ou, -W / 2, W / 2, -0.34, 0.34, -0.03, 0.0)
for x in (XL, XR):
    prof = [(ZF, 0.0), (ZC, 0.0), (ZC, 0.6), (zbot, ybot), (ZF + 0.02, 1.43), (ZF, 1.43)]
    for sx, xx in ((-1, x - 0.001), (1, x + 0.001)):
        S.g('ConsoleGreen').face([(xx, y, z) for (z, y) in prof], [(z, y) for (z, y) in prof], (sx, 0, 0))
box('ConsoleGreen', XL, XR, 1.4, 1.46, ZF, ZF + 0.16, skip=())
# edge trims (the Soviet panel's chrome / black strips)
R.obox(S, 'Black', Md, P(Md, od, 0, -0.125), -W / 2, W / 2, -0.008, 0.0, -0.03, 0.004)
R.obox(S, 'Black', Mu, P(Mu, ou, 0, -0.34), -W / 2, W / 2, -0.008, 0.004, -0.03, 0.004)

# ── the upper panel: the lamp strip, the CRT, instruments, mode switches, the name plate ──
LAMPS = [('lamp_power', 'POWER', 'ПИТАНИЕ', 'LampGreen', '#30ff60'), ('lamp_jacks', 'SUPPORTS', 'ОПОРЫ', 'LampGreen', '#30ff60'),
         ('lamp_table', 'TABLE', 'СТОЛ', 'LampGreen', '#30ff60'), ('lamp_erect', 'BOOM UP', 'СТРЕЛА', 'LampAmber', '#ffb020'),
         ('lamp_align', 'ALIGNED', 'ГК', 'LampGreen', '#30ff60'), ('lamp_test', 'TEST OK', 'НОРМА СУ', 'LampGreen', '#30ff60'),
         ('lamp_combat', 'COMBAT', 'БОЕВОЙ', 'LampRed', '#ff3a20'), ('lamp_code', 'CODE', 'КБУ', 'LampAmber', '#ffb020'),
         ('lamp_ready', 'READY', 'ГОТОВ', 'LampRed', '#ff3a20')]
plate(Mu, ou, -0.47, 0.47, 0.215, 0.325, 'Black')
for k, (nm, en, ru, mat, col) in enumerate(LAMPS):
    x = -0.42 + k * 0.105
    if nm == 'lamp_code':
        # the code lamp lives on the code lock box itself; here: its repeater (static)
        slamp(Mu, ou, x, 0.29, 'LampAmber', 0.012)
    else:
        R.lamp(nm, P(Mu, ou, x, 0.29, 0.0015), 0.0, UT, r=0.013, color=col, mat=mat)
    R.label(en, P(Mu, ou, x, 0.254, 0.002), 0.0, UT, h=0.012, st='w')
    R.label(ru, P(Mu, ou, x, 0.235, 0.002), 0.0, UT, h=0.01, st='e')
outline(Mu, ou, -0.47, 0.47, 0.215, 0.325)
# the CRT: a round-cornered bezel, a hood, brightness / focus knobs
cx, cy = -0.22, 0.03
R.screen('screen_tel', P(Mu, ou, cx, cy, 0.003), 0.0, UT, w=0.28, h=0.21, px=(768, 576), bright=1.0)
for (x0, x1, y0, y1) in ((-0.17, 0.17, 0.105, 0.14), (-0.17, 0.17, -0.14, -0.105), (-0.17, -0.14, -0.105, 0.105), (0.14, 0.17, -0.105, 0.105)):
    R.obox(S, 'Bakelite', Mu, P(Mu, ou, cx, cy), x0, x1, y0, y1, 0.0, 0.012)
for (sx, sy) in ((-1, -1), (1, -1), (1, 1), (-1, 1)):
    R.obox(S, 'Bakelite', Mu, P(Mu, ou, cx + sx * 0.132, cy + sy * 0.097), -0.012, 0.012, -0.012, 0.012, 0.0, 0.012)
for (a, b, c, d, n) in ((-0.17, 0.14, 0.17, 0.14, (0, 1, 0)), (-0.17, -0.14, 0.17, -0.14, (0, -1, 0))):
    pts = [P(Mu, ou, cx + a, cy + b, 0.012), P(Mu, ou, cx + c, cy + d, 0.012), P(Mu, ou, cx + c * 1.1, cy + d * 1.15, 0.07), P(Mu, ou, cx + a * 1.1, cy + b * 1.15, 0.07)]
    S.g('Black').face(pts, None, tuple(Mu @ Vector(n)))
for (a, n) in ((-0.17, (-1, 0, 0)), (0.17, (1, 0, 0))):
    pts = [P(Mu, ou, cx + a, cy - 0.14, 0.012), P(Mu, ou, cx + a, cy + 0.14, 0.012), P(Mu, ou, cx + a * 1.1, cy + 0.14 * 1.15, 0.07), P(Mu, ou, cx + a * 1.1, cy - 0.14 * 1.15, 0.07)]
    S.g('Black').face(pts, None, tuple(Mu @ Vector(n)))
for k, (lab, x) in enumerate((('ЯРКОСТЬ', -0.3), ('ФОКУС', -0.22), ('МАСШТАБ', -0.14))):
    sknob(Mu, ou, x, -0.155)
    R.label(lab, P(Mu, ou, x, -0.185, 0.002), 0.0, UT, h=0.009, st='e')
R.label('ИНДИКАТОР · DISPLAY', P(Mu, ou, cx, 0.185, 0.002), 0.0, UT, h=0.012, st='e')
# instruments: supply voltage, battery voltage, current, hydraulic pressure
for k, (lab, x, y, nd) in enumerate((('U ПИТ · V', 0.06, 0.1, 0.55), ('U БАТ · V', 0.19, 0.1, 0.62), ('I · A', 0.32, 0.1, 0.35), ('P ГИДР', 0.43, 0.1, 0.7))):
    gauge(Mu, ou, x, y, 0.042 if k < 3 else 0.03, nd)
    R.label(lab, P(Mu, ou, x, 0.042, 0.002), 0.0, UT, h=0.01, st='e')
outline(Mu, ou, 0.0, 0.47, 0.03, 0.18)
# a bank of small toggles (circuit selects), a lamp row, the mode rotary switch, the name plate, screws, a connector
for k in range(7):
    x = 0.04 + k * 0.058
    stoggle(Mu, ou, x, -0.03, up=(k % 3 != 1))
    slamp(Mu, ou, x, -0.085, ['LampGreen', 'LampAmber', 'LampGreen', 'LampWhite', 'LampGreen', 'LampRed', 'LampGreen'][k], 0.006)
R.label('КОНТРОЛЬ ЦЕПЕЙ · CIRCUITS', P(Mu, ou, 0.22, 0.012, 0.002), 0.0, UT, h=0.01, st='e')
outline(Mu, ou, 0.0, 0.47, -0.11, 0.025)
srotary(Mu, ou, 0.1, -0.2, 0.022, 0.35, 7)
R.label('РОД РАБОТЫ · MODE', P(Mu, ou, 0.1, -0.245, 0.002), 0.0, UT, h=0.01, st='e')
srotary(Mu, ou, 0.26, -0.2, 0.022, -0.5, 5)
R.label('ДАЛЬНОСТЬ · RANGE', P(Mu, ou, 0.26, -0.245, 0.002), 0.0, UT, h=0.01, st='e')
connector(Mu, ou, 0.41, -0.2, 0.024)
R.label('Ш72', P(Mu, ou, 0.41, -0.245, 0.002), 0.0, UT, h=0.01, st='e')
plate(Mu, ou, -0.46, -0.02, -0.33, -0.27, 'Cream')
R.label('ПОСТ 2В12М · TEST & LAUNCH STATION', P(Mu, ou, -0.24, -0.3, 0.002), 0.0, UT, h=0.016, st='b')
screws(Mu, ou, -W / 2, W / 2, -0.34, 0.34)
mark('2V12M upper')

# ── the desk: the launch sequence in bat toggles, the table knob, the gyro / test / abort buttons ──
SW = [('sw_power', -0.43, 'MAIN POWER', 'ПИТАНИЕ'), ('sw_gen', -0.335, 'GENERATOR', 'ГЕНЕРАТОР'),
      ('sw_jacks', -0.2, 'SUPPORTS', 'ОПОРЫ'), ('sw_table', -0.105, 'TABLE', 'СТОЛ'), ('sw_erect', -0.01, 'BOOM', 'СТРЕЛА'),
      ('sw_combat', 0.13, 'COMBAT', 'БОЕВОЙ'), ('sw_batt', 0.225, 'MSL BATT', 'БОРТ. БАТ.')]
for (nm, x, en, ru) in SW:
    bat_toggle(nm, Md, od, x, 0.03, 0.0, DT)
    R.label(en, P(Md, od, x, 0.098, 0.002), 0.0, DT, h=0.011, st='w')
    R.label(ru, P(Md, od, x, 0.082, 0.002), 0.0, DT, h=0.009, st='e')
    R.label('ВКЛ', P(Md, od, x + 0.03, 0.058, 0.002), 0.0, DT, h=0.007, st='e')
    R.label('ВЫКЛ', P(Md, od, x + 0.03, 0.005, 0.002), 0.0, DT, h=0.007, st='e')
outline(Md, od, -0.475, -0.29, -0.005, 0.115)
outline(Md, od, -0.245, 0.035, -0.005, 0.115)
outline(Md, od, 0.085, 0.27, -0.005, 0.115)
R.label('REAR SUPPORTS · TABLE · BOOM', P(Md, od, -0.105, 0.121, 0.002), 0.0, DT, h=0.007, st='y')
R.label('PRE-LAUNCH', P(Md, od, 0.1775, 0.121, 0.002), 0.0, DT, h=0.007, st='y')
# the lower row: the launch table's azimuth knob with its 36-step dial, gyrocompass, control-system test, abort
kx, ky = -0.4, -0.07
R.knob('knob_azimuth', P(Md, od, kx, ky), 0.0, DT, r=0.026, steps=36, arc=2 * PI * 35 / 36, mat='Bakelite')
for k in range(36):
    t = 2 * PI * k / 36
    dx, dy = math.sin(t), math.cos(t)
    L = 0.008 if k % 9 == 0 else 0.004
    plate(Md, P(Md, od, kx, ky), dx * 0.036 - 0.0008, dx * 0.036 + 0.0008, dy * 0.036 - L / 2, dy * 0.036 + L / 2, 'Paint', 0.0012)
R.label('0', P(Md, od, kx, ky + 0.046, 0.002), 0.0, DT, h=0.008, st='e')
R.label('СТОЛ · AZIMUTH', P(Md, od, kx + 0.085, ky + 0.03, 0.002), 0.0, DT, h=0.009, st='w')
R.button('btn_gyro', P(Md, od, -0.23, ky), 0.0, DT, r=0.016, mat='Blue', square=True)
R.label('GYRO ALIGN', P(Md, od, -0.23, ky - 0.035, 0.002), 0.0, DT, h=0.009, st='w')
R.label('ГИРОКОМПАС', P(Md, od, -0.23, ky - 0.048, 0.002), 0.0, DT, h=0.007, st='e')
R.button('btn_test', P(Md, od, -0.11, ky), 0.0, DT, r=0.016, mat='Yellow', square=True)
R.label('SYSTEM TEST', P(Md, od, -0.11, ky - 0.035, 0.002), 0.0, DT, h=0.009, st='w')
R.label('ПРОВЕРКА СУ', P(Md, od, -0.11, ky - 0.048, 0.002), 0.0, DT, h=0.007, st='e')
R.button('btn_abort', P(Md, od, 0.05, ky), 0.0, DT, r=0.022, mat='Red')
R.label('ABORT', P(Md, od, 0.05, ky - 0.037, 0.002), 0.0, DT, h=0.009, st='r')
R.label('ОТБОЙ', P(Md, od, 0.05, ky - 0.05, 0.002), 0.0, DT, h=0.007, st='e')
# the right end of the desk: aiming check lamps, a static rotary (warhead mode), small knobs
srotary(Md, od, 0.2, -0.065, 0.02, -0.3, 4)
R.label('РЕЖИМ БЧ · WARHEAD', P(Md, od, 0.2, -0.1, 0.002), 0.0, DT, h=0.007, st='e')
for k, m in enumerate(('LampGreen', 'LampAmber', 'LampRed')):
    slamp(Md, od, 0.33 + k * 0.045, 0.06, m, 0.008)
R.label('ПРИЦЕЛ · AIM', P(Md, od, 0.375, 0.09, 0.002), 0.0, DT, h=0.008, st='e')
for k in range(3):
    sknob(Md, od, 0.33 + k * 0.045, -0.04, 0.01)
R.label('ТОЧНО · ГРУБО', P(Md, od, 0.375, -0.07, 0.002), 0.0, DT, h=0.007, st='e')
screws(Md, od, -W / 2, W / 2, -0.125, 0.125)
mark('2V12M desk')

# ═════════════ the 9V344 remote launch panel on its shelf (right of the desk, over the hump) ═════════════
box('ConsoleGreen', XR, XR + 0.3, 0.585, 0.605, ZF + 0.06, ZF + 0.4, skip=())
S.beam('ConsoleGreen', (XR + 0.28, 0.585, ZF + 0.39), (XR + 0.28, 0.4, ZF + 0.08), 0.02, caps=False)
RY = -0.5
Mr = R.mat3(RY)
ro = (XR + 0.15, 0.605, ZF + 0.25)
R.obox(S, 'Olive', Mr, ro, -0.11, 0.11, 0.0, 0.07, -0.09, 0.09)
RT = math.radians(55)
S.g('Olive').face([R.xf(Mr, ro, p) for p in ((-0.11, 0.07, -0.09), (0.11, 0.07, -0.09), (0.11, 0.07 + 0.126, -0.09 + 0.0), (-0.11, 0.07 + 0.126, -0.09))], None, tuple(Mr @ Vector((0, 0, -1))))
# the sloped control face: from the box's front top edge rising back 35°
fo = R.xf(Mr, ro, (0.0, 0.07 + 0.063, 0.0))
Mf = R.mat3(RY, math.radians(55))
R.obox(S, 'Olive', Mf, fo, -0.11, 0.11, -0.11, 0.11, -0.012, 0.0)
for sx in (-1, 1):
    S.g('Olive').face([R.xf(Mr, ro, p) for p in ((sx * 0.11, 0.07, -0.09), (sx * 0.11, 0.07, 0.09), (sx * 0.11, 0.07 + 0.126, -0.09))], None, tuple(Mr @ Vector((sx, 0, 0))))
plate(Mf, fo, -0.1, 0.1, -0.1, 0.1, 'ConsoleGreenDark')
R.button('btn_launch', P(Mf, fo, -0.02, -0.02), RY, math.radians(55), r=0.024, mat='Red')
R.guard('guard_launch', P(Mf, fo, -0.02, -0.02 + 0.044), RY, math.radians(55), w=0.075, h=0.088, d=0.05)
R.label('LAUNCH', P(Mf, fo, -0.02, -0.074, 0.002), RY, math.radians(55), h=0.016, st='r')
R.label('[ПУСК]', P(Mf, fo, -0.02, -0.092, 0.002), RY, math.radians(55), h=0.012, st='r')
slamp(Mf, fo, 0.07, 0.05, 'LampRed', 0.009)
R.label('ГОТОВ', P(Mf, fo, 0.07, 0.03, 0.002), RY, math.radians(55), h=0.008, st='e')
slamp(Mf, fo, 0.07, -0.01, 'LampGreen', 0.009)
R.label('ВКЛ', P(Mf, fo, 0.07, -0.03, 0.002), RY, math.radians(55), h=0.008, st='e')
R.label('9В344', P(Mf, fo, 0.0, 0.085, 0.002), RY, math.radians(55), h=0.012, st='w')
# the carrying handle and the cable back to the 2V12M's Ш72 connector
for sx in (-1, 1):
    S.beam('Chrome', R.xf(Mr, ro, (sx * 0.08, 0.2, 0.09)), R.xf(Mr, ro, (sx * 0.08, 0.26, 0.05)), 0.012, caps=False)
S.beam('Chrome', R.xf(Mr, ro, (-0.08, 0.26, 0.05)), R.xf(Mr, ro, (0.08, 0.26, 0.05)), 0.014, caps=False)
cab = [R.xf(Mr, ro, (0.11, 0.03, 0.0)), (XR + 0.3, 0.58, ZF + 0.3), (XR + 0.22, 0.4, ZF + 0.5), (XR + 0.05, 0.36, ZF + 0.62), (XR - 0.02, 0.4, ZF + 0.42), (XR + 0.02, 0.55, ZF + 0.37)]
for a, b in zip(cab, cab[1:]):
    R._tube(S, a, b, 0.009, 'Cable', 6)
R.label('ВЫНОСНОЙ ПУЛЬТ · REMOTE', (XR + 0.15, 0.59, ZF + 0.401), 0.0, 0.0, h=0.01, st='e')
mark('9V344')

# ═════════════ the 9V362M1 code lock on the left wall (the operator's left hand) ═════════════
CL_YAW = PI / 2 - 0.45
Mc = R.mat3(CL_YAW)
cl = (-XI + 0.12, 0.93, -0.72)
R.obox(S, 'ConsoleGreen', Mc, cl, -0.19, 0.19, -0.11, 0.11, -0.11, 0.0)
S.beam('Steel', R.xf(Mc, cl, (-0.12, -0.11, -0.08)), (-XI, 0.8, -0.8), 0.03, caps=False)
S.beam('Steel', R.xf(Mc, cl, (0.12, -0.11, -0.08)), (-XI, 0.8, -0.62), 0.03, caps=False)
plate(Mc, cl, -0.18, 0.18, -0.1, 0.1, 'ConsoleGreenDark')
plate(Mc, cl, -0.17, 0.05, 0.068, 0.095, 'Cream', 0.0016)
R.label('9В362М1 · CODE LOCK [КБУ]', P(Mc, cl, -0.06, 0.0815, 0.0025), CL_YAW, 0.0, h=0.012, st='b')
for k in range(6):
    x = -0.145 + k * 0.047
    code_wheel('knob_code_%d' % (k + 1), Mc, cl, x, -0.012, CL_YAW, 0.0)
    R.label(str(k + 1), P(Mc, cl, x, 0.038, 0.002), CL_YAW, 0.0, h=0.011, st='w')
R.label('КОД · SIX-DIGIT CODE', P(Mc, cl, -0.03, -0.065, 0.002), CL_YAW, 0.0, h=0.01, st='e')
outline(Mc, cl, -0.175, 0.1, -0.085, 0.055)
bat_toggle('sw_code', Mc, cl, 0.145, -0.02, CL_YAW, 0.0)
R.label('О', P(Mc, cl, 0.145, 0.03, 0.002), CL_YAW, 0.0, h=0.014, st='w')
R.label('Н', P(Mc, cl, 0.145, -0.07, 0.002), CL_YAW, 0.0, h=0.014, st='w')
R.lamp('lamp_code', P(Mc, cl, 0.145, 0.072, 0.0015), CL_YAW, 0.0, r=0.011, color='#ffb020', mat='LampAmber')
screws(Mc, cl, -0.19, 0.19, -0.11, 0.11)
R.label('Н — SET CODE · О — UNLOCK', (-XI + 0.003, 1.09, -0.72), PI / 2, 0.0, h=0.014, st='y')
mark('code lock')

# ═════════════ the left wall: POG-6, the generator board (ЩУГ), the launch checklist ═════════════
Mw = R.mat3(PI / 2)          # panels on the left wall face +x


def wall_panel(zc, yc, w, h, depth, mat='ConsoleGreen'):
    o = (-XI + depth, yc, zc)
    R.obox(S, mat, Mw, o, -w / 2, w / 2, -h / 2, h / 2, -depth, 0.0, skip=('nz',))
    plate(Mw, o, -w / 2 + 0.01, w / 2 - 0.01, -h / 2 + 0.01, h / 2 - 0.01, 'ConsoleGreenDark')
    screws(Mw, o, -w / 2, w / 2, -h / 2, h / 2)
    return o


# POG-6: the warhead heating panel under the code lock
po = wall_panel(-0.72, 0.55, 0.34, 0.2, 0.09)
gauge(Mw, po, -0.09, 0.0, 0.05, 0.4)
R.label('°C', P(Mw, po, -0.09, -0.07, 0.002), PI / 2, 0.0, h=0.01, st='e')
for k in range(2):
    stoggle(Mw, po, 0.03 + k * 0.05, 0.02)
slamp(Mw, po, 0.13, 0.02, 'LampAmber', 0.009)
R.label('ПОГ-6 · WARHEAD HEATING', P(Mw, po, 0.05, -0.06, 0.002), PI / 2, 0.0, h=0.01, st='w')
# the generator control board: three instruments, lamps, switches, a rotary
go = wall_panel(-0.2, 1.02, 0.48, 0.58, 0.1)
for k, (lab, nd) in enumerate((('V', 0.55), ('A', 0.3), ('Hz', 0.5))):
    gauge(Mw, go, -0.15 + k * 0.15, 0.16, 0.05, nd)
    R.label(lab, P(Mw, go, -0.15 + k * 0.15, 0.09, 0.002), PI / 2, 0.0, h=0.012, st='e')
for k in range(4):
    stoggle(Mw, go, -0.16 + k * 0.1, -0.02, up=(k != 2))
    slamp(Mw, go, -0.16 + k * 0.1, 0.04, ['LampGreen', 'LampGreen', 'LampRed', 'LampAmber'][k], 0.008)
srotary(Mw, go, -0.1, -0.16, 0.025, 0.6, 5)
srotary(Mw, go, 0.08, -0.16, 0.025, -0.2, 3)
R.label('ЩУГ · GENERATOR CONTROL', P(Mw, go, 0.0, 0.255, 0.002), PI / 2, 0.0, h=0.014, st='w')
R.label('ВОЗБУЖДЕНИЕ', P(Mw, go, -0.1, -0.21, 0.002), PI / 2, 0.0, h=0.009, st='e')
R.label('СЕТЬ · MAINS', P(Mw, go, 0.08, -0.21, 0.002), PI / 2, 0.0, h=0.009, st='e')
connector(Mw, go, 0.19, -0.2, 0.02, [(-XI + 0.15, 0.62, -0.02), (-XI + 0.05, 0.3, 0.02), (-XI + 0.04, 0.12, 0.05)])
# the launch checklist card above the code lock (pre-launch order, as the crew's card has it)
co = (-XI + 0.004, 1.3, -0.72)
plate(Mw, co, -0.22, 0.22, -0.2, 0.2, 'Cream', 0.0)
STEPS = ['ПОРЯДОК ПОДГОТОВКИ К ПУСКУ', '1 POWER · GENERATOR ON', '2 REAR SUPPORTS DOWN', '3 BOOM UP · TABLE ON STOPS',
         '4 GYRO ALIGN · TURN THE TABLE', '5 CONTROL SYSTEM TEST', '6 COMBAT MODE', '7 CODE: SET Н · DIAL · О',
         '8 MISSILE BATTERIES ON', '9 LIFT GUARD · LAUNCH [ПУСК]']
for k, t in enumerate(STEPS):
    R.label(t, P(Mw, co, -0.2 if k else 0.0, 0.17 - k * 0.037, 0.002), PI / 2, 0.0, h=0.017 if k == 0 else 0.015, w=0.4 if k else None, st='b')
mark('left wall')

# ═════════════ the front wall over the hump: the 2V26 self-destruct check panel; the ceiling: РП, dome lights ═════════════
Mfw = R.mat3(0)
so = (-0.24, 0.9, ZF + 0.08)
R.obox(S, 'ConsoleGreen', Mfw, so, -0.17, 0.17, -0.13, 0.13, -0.08, 0.0, skip=('nz',))
plate(Mfw, so, -0.16, 0.16, -0.12, 0.12, 'ConsoleGreenDark')
for k in range(4):
    slamp(Mfw, so, -0.12 + k * 0.08, 0.06, ['LampGreen', 'LampGreen', 'LampRed', 'LampWhite'][k], 0.009)
srotary(Mfw, so, -0.07, -0.04, 0.022, -0.6, 6)
stoggle(Mfw, so, 0.06, -0.04)
stoggle(Mfw, so, 0.11, -0.04, up=False)
R.label('2В26 · SELF-DESTRUCT CHECK', P(Mfw, so, 0.0, 0.1, 0.002), 0.0, 0.0, h=0.011, st='w')
R.label('АПР', P(Mfw, so, 0.085, -0.085, 0.002), 0.0, 0.0, h=0.012, st='r')
screws(Mfw, so, -0.17, 0.17, -0.13, 0.13)
# the distribution panel (РП) on the ceiling over the operator: breakers pointing down, fuses, a lamp
rp = (-1.08, HC - 0.1, -0.35)
box('ConsoleGreen', -1.34, -0.82, HC - 0.12, HC, -0.55, -0.15, skip=('top',))
Mcl = R.mat3(0, -PI / 2)
for k in range(8):
    x = -1.29 + k * 0.06
    c = (x, HC - 0.121, -0.42)
    R.ocyl(S, 'Black', Mcl, c, (0, 0, 0), 0.012, 0.012, 0.0, 0.01, 6, axis='z', cap0=False)
    S.beam('Chrome', (x, HC - 0.13, -0.42), (x, HC - 0.15, -0.42 + (0.012 if k % 3 else -0.012)), 0.004, caps=False)
    R.ocyl(S, 'Cream', Mcl, (x, HC - 0.121, -0.28), (0, 0, 0), 0.01, 0.01, 0.0, 0.018, 6, axis='z', cap0=False)
R.label('РП · DISTRIBUTION', (-1.08, HC - 0.1205, -0.2), 0.0, -PI / 2, h=0.014, st='w')
# dome lights (warm), a red night light
for (x, z) in ((-1.1, 0.35), (1.1, 0.1)):
    S.cyl('Chrome', (x, 0, z), 0.09, 0.09, HC - 0.03, HC, 12, cap1=False)
    S.sphere('LightWarm', (x, HC - 0.03, z), 0.075, 0.035, 0.075, 12, 3, v0=0.0, v1=0.5)
S.sphere('LampRed', (-0.85, HC - 0.005, 0.8), 0.03, 0.015, 0.03, 8, 2, v0=0.0, v1=0.5)
# cable bundles along the walls and over the trough, clips
for sx in (-1, 1):
    x = sx * (XI - 0.05)
    for k, dy in enumerate((0.0, 0.035)):
        R._tube(S, (x, HC - 0.1 - dy, ZF + 0.05), (x, HC - 0.1 - dy, ZB - 0.05), 0.014, 'Cable', 6)
    for z in (-0.9, -0.3, 0.3, 0.9):
        box('Steel', min(x, x + sx * 0.04), max(x, x + sx * 0.04), HC - 0.16, HC - 0.07, z - 0.012, z + 0.012)
R._tube(S, (-TX0 - 0.03, TY + 0.05, ZF + 0.05), (-TX0 - 0.03, TY + 0.05, ZB - 0.05), 0.02, 'Cable', 6)
R._tube(S, (TX0 + 0.03, TY + 0.05, ZF + 0.05), (TX0 + 0.03, TY + 0.05, ZB - 0.05), 0.02, 'Cable', 6)
mark('2V26 + ceiling')

# ═════════════ seats: the operator's (a pedestal seat), the second on the battery box, the third on the right ═════════════
def seat(pos, yaw=0.0, h=0.44, back=True, fold=False):
    M = R.mat3(yaw)
    o = pos
    if not fold:
        R.ocyl(S, 'Steel', M, o, (0, 0, 0), 0.16, 0.16, 0.0, 0.02, 10, axis='y', cap0=False)
        R.ocyl(S, 'Steel', M, o, (0, 0, 0), 0.035, 0.035, 0.02, h - 0.06, 8, axis='y', cap0=False, cap1=False)
        R.obox(S, 'Steel', M, o, -0.16, 0.16, h - 0.07, h - 0.05, -0.16, 0.16)
    R.obox(S, 'Leather', M, o, -0.2, 0.2, h - 0.05, h + 0.04, -0.2, 0.18)
    for k in range(3):
        R.obox(S, 'Black', M, o, -0.2 + k * 0.13 + 0.06, -0.2 + k * 0.13 + 0.068, h + 0.04, h + 0.042, -0.19, 0.17)
    if back:
        Mb = M @ R.mat3(0, -0.15)
        bo = R.xf(M, o, (0, h + 0.08, 0.2))
        R.obox(S, 'Leather', Mb, bo, -0.19, 0.19, 0.0, 0.42, -0.04, 0.03)
        R.obox(S, 'Steel', Mb, bo, -0.17, -0.15, -0.1, 0.35, 0.03, 0.045)
        R.obox(S, 'Steel', Mb, bo, 0.15, 0.17, -0.1, 0.35, 0.03, 0.045)


seat((-0.93, 0.0, 0.02), 0.0)
# the battery box at the back of the left compartment (the second seat's base; the wheel arch is under it)
box('ConsoleGreen', -XI, -HX1 - 0.02, 0.0, 0.42, 0.25, ZB, skip=('bottom', 'pz', 'nx'))
for k in range(5):
    y = 0.1 + k * 0.05
    quad('Black', [(-1.3, y, 0.249), (-0.72, y, 0.249), (-0.72, y + 0.02, 0.249), (-1.3, y + 0.02, 0.249)], (0, 0, -1))
for x in (-1.36, -0.66):
    box('Chrome', x - 0.02, x + 0.02, 0.36, 0.38, 0.235, 0.25, skip=('pz',))
R.label('БАТАРЕИ 12-СТ-70 · BATTERIES', (-1.0, 0.37, 0.248), PI, 0.0, h=0.014, st='w')
R.label('24 V', (-1.0, 0.07, 0.248), PI, 0.0, h=0.014, st='y')
seat((-1.0, 0.42 - 0.44 + 0.02, 0.72), 0.0, h=0.44, fold=True)
# the fire extinguisher (ОУ-2) on the back wall, a first aid box, a thermos on the hump, the field telephone
S.cyl('Red', (-0.72, 0, ZB - 0.1), 0.055, 0.055, 0.62, 1.05, 10)
S.cyl('Black', (-0.72, 0, ZB - 0.1), 0.02, 0.02, 1.05, 1.12, 6)
S.beam('Black', (-0.72, 1.1, ZB - 0.1), (-0.66, 0.95, ZB - 0.16), 0.03, caps=False)
S.cyl('Black', (-0.66, 0, ZB - 0.16), 0.02, 0.05, 0.84, 0.95, 8)
box('Steel', -0.8, -0.64, 0.9, 0.96, ZB - 0.03, ZB)
R.label('ОУ-2', (-0.72, 0.8, ZB - 0.156), PI, 0.0, h=0.018, st='w')
box('White', -1.38, -1.18, 1.05, 1.22, ZB - 0.1, ZB, skip=('pz',))
quad('Red', [(-1.27, 1.09, ZB - 0.101), (-1.29, 1.09, ZB - 0.101), (-1.29, 1.18, ZB - 0.101), (-1.27, 1.18, ZB - 0.101)], (0, 0, -1))
quad('Red', [(-1.235, 1.125, ZB - 0.1015), (-1.325, 1.125, ZB - 0.1015), (-1.325, 1.145, ZB - 0.1015), (-1.235, 1.145, ZB - 0.1015)], (0, 0, -1))
S.cyl('Steel', (-0.25, 0, 0.55), 0.045, 0.045, HH, HH + 0.3, 10)
S.cyl('Black', (-0.25, 0, 0.55), 0.048, 0.048, HH + 0.3, HH + 0.34, 10)
tp = (-0.1, HH, 0.2)
box('Olive', tp[0] - 0.12, tp[0] + 0.12, HH, HH + 0.1, tp[2] - 0.09, tp[2] + 0.09)
S.beam('Black', (tp[0] - 0.09, HH + 0.12, tp[2] - 0.02), (tp[0] + 0.09, HH + 0.12, tp[2] - 0.02), 0.035, 0.035)
R.ocyl(S, 'Black', R.mat3(0), (tp[0] + 0.07, HH + 0.1, tp[2] + 0.04), (0, 0, 0), 0.02, 0.02, 0.0, 0.01, 8, axis='y', cap0=False)
R.label('ТА-57', (tp[0], HH + 0.06, tp[2] + 0.091), 0.0, 0.0, h=0.014, st='w')
# a headset on a hook by the 2V12M, the operator's torch
S.beam('Steel', (XL + 0.02, 1.15, ZC - 0.25), (XL + 0.06, 1.15, ZC - 0.25), 0.012)
for sx in (-1, 1):
    R.ocyl(S, 'Black', R.mat3(PI / 2), (XL + 0.07, 1.05, ZC - 0.25 + sx * 0.07), (0, 0, 0), 0.035, 0.035, -0.015, 0.015, 8, axis='z')
S.beam('Black', (XL + 0.07, 1.08, ZC - 0.32), (XL + 0.07, 1.15, ZC - 0.25), 0.014, caps=False)
S.beam('Black', (XL + 0.07, 1.15, ZC - 0.25), (XL + 0.07, 1.08, ZC - 0.18), 0.014, caps=False)
# a desk fan on top of the 2V12M, a log book and a pencil on the hump
fo_ = (-1.22, 1.46, ZF + 0.1)
box('ConsoleGreen', fo_[0] - 0.06, fo_[0] + 0.06, 1.46, 1.48, fo_[2] - 0.05, fo_[2] + 0.05)
S.cyl('ConsoleGreen', (fo_[0], 0, fo_[2]), 0.012, 0.012, 1.48, 1.52, 6, cap0=False)
fc = (fo_[0], 1.525, fo_[2] + 0.02)
Mfan = R.mat3(0.35, -0.15)
R.ocyl(S, 'ConsoleGreen', Mfan, fc, (0, 0, 0), 0.03, 0.03, -0.05, 0.0, 8, axis='z', cap0=False)
for k in range(8):
    a0, a1 = 2 * PI * k / 8, 2 * PI * (k + 1) / 8
    S.beam('Chrome', R.xf(Mfan, fc, (math.cos(a0) * 0.1, math.sin(a0) * 0.1, 0.02)), R.xf(Mfan, fc, (math.cos(a1) * 0.1, math.sin(a1) * 0.1, 0.02)), 0.005, caps=False)
    S.beam('Chrome', R.xf(Mfan, fc, (0, 0, 0.035)), R.xf(Mfan, fc, (math.cos(a0) * 0.1, math.sin(a0) * 0.1, 0.02)), 0.003, caps=False)
for k in range(3):
    a = 2 * PI * k / 3
    S.g('Black').face([R.xf(Mfan, fc, (0, 0, 0.012)), R.xf(Mfan, fc, (math.cos(a) * 0.085, math.sin(a) * 0.085, 0.012)), R.xf(Mfan, fc, (math.cos(a + 0.7) * 0.085, math.sin(a + 0.7) * 0.085, 0.012))], None, tuple(Mfan @ Vector((0, 0, 1))))
box('Cream', -0.36, -0.12, HH, HH + 0.02, -0.05, 0.12)
box('ConsoleGreenDark', -0.365, -0.115, HH, HH + 0.012, -0.055, 0.125)
S.beam('Yellow', (-0.3, HH + 0.025, 0.0), (-0.16, HH + 0.025, 0.05), 0.008, caps=False)
R.label('ЖУРНАЛ', (-0.24, HH + 0.021, 0.035), 0.0, PI / 2, h=0.02, st='b')
mark('seats + kit')

# ═════════════ the doors: the left one is the exit (window, blackout curtain, dogs); the right one static ═════════════
def door_part(name, curtain=0.45):
    D = Part(name)
    w, h = 0.8, 1.02
    D.box('ConsoleGreen', -w / 2, w / 2, 0.0, h, -0.04, 0.0)
    D.box('Rubber', -w / 2 - 0.03, w / 2 + 0.03, -0.03, h + 0.03, -0.045, -0.035)
    # the window, its frame, the blackout curtain half drawn (a rolled top and a hanging flap)
    wx, wy, ww, wh = 0.0, 0.72, 0.24, 0.18
    D.box('Steel', wx - ww / 2 - 0.02, wx + ww / 2 + 0.02, wy - wh / 2 - 0.02, wy + wh / 2 + 0.02, 0.0, 0.012)
    D.g('Glass').face([(wx - ww / 2, wy - wh / 2, 0.006), (wx + ww / 2, wy - wh / 2, 0.006), (wx + ww / 2, wy + wh / 2, 0.006), (wx - ww / 2, wy + wh / 2, 0.006)], None, (0, 0, 1))
    D.g('Glass').face([(wx - ww / 2, wy - wh / 2, 0.004), (wx - ww / 2, wy + wh / 2, 0.004), (wx + ww / 2, wy + wh / 2, 0.004), (wx + ww / 2, wy - wh / 2, 0.004)], None, (0, 0, -1))
    D.cyl('Curtain', (0, wy + wh / 2 + 0.035, 0.025), 0.02, 0.02, wx - ww / 2 - 0.03, wx + ww / 2 + 0.03, 8, axis='x')
    D.box('Curtain', wx - ww / 2 - 0.02, wx + ww / 2 + 0.02, wy + wh / 2 - wh * curtain, wy + wh / 2 + 0.03, 0.016, 0.02)
    D.box('Chrome', -0.01, 0.01, wy + wh / 2 - wh * curtain - 0.02, wy + wh / 2 - wh * curtain, 0.02, 0.028)
    # the dogs (lever latches) and a grab handle, hinges on the hinge side
    for y in (0.25, 0.8):
        D.cyl('Chrome', (w / 2 - 0.07, y, 0), 0.018, 0.018, 0.0, 0.03, 8, axis='z')
        D.box('Chrome', w / 2 - 0.19, w / 2 - 0.07, y - 0.012, y + 0.012, 0.03, 0.045)
    D.box('Chrome', w / 2 - 0.14, w / 2 - 0.11, 0.42, 0.62, 0.0, 0.04)
    for y in (0.15, 0.85):
        D.cyl('Steel', (-w / 2 - 0.01, 0, 0.0), 0.015, 0.015, y - 0.06, y + 0.06, 8)
    D.box('ConsoleGreenDark', -w / 2 + 0.06, w / 2 - 0.25, 0.08, 0.5, 0.0, 0.003)
    return D


DZ = (0.075 + 1.025) / 2
R.node('exit_door', door_part('exit_door', 0.45), (-XI + 0.005, 0.45, DZ), yaw=PI / 2, ctl={'t': 'exit'})
R.label('ВЫХОД · EXIT', (-XI + 0.02, 1.52, DZ), PI / 2, 0.0, h=0.022, st='y')
rd = door_part('door_right_static', 0.7)
for mname, geo in rd.geo.items():
    Mrd = R.mat3(-PI / 2)
    for idx, uvs, sm in geo.faces:
        S.g(mname).face([R.xf(Mrd, (XI - 0.005, 0.45, DZ), geo.verts[i]) for i in idx], uvs, None, sm)
# daylight outside the door windows (the game renders the cabin alone)
for sx in (-1, 1):
    x = sx * (XI + 0.3)
    quad('LightWindow', [(x, 1.0, DZ - 0.35), (x, 1.0, DZ + 0.35), (x, 1.5, DZ + 0.35), (x, 1.5, DZ - 0.35)], (-sx, 0, 0))
    quad('Olive', [(x + sx * 0.01, 0.6, DZ - 0.4), (x + sx * 0.01, 0.6, DZ + 0.4), (x + sx * 0.01, 1.02, DZ + 0.4), (x + sx * 0.01, 1.02, DZ - 0.4)], (-sx, 0.2, 0))
    # the door's frame in the wall: a thick steel surround and the sill (the wheel arch is under it)
    xa, xb = sorted((sx * XI, sx * (XI - 0.03)))
    for (z0, z1, y0, y1) in ((DZ - 0.47, DZ - 0.43, 0.42, 1.51), (DZ + 0.43, DZ + 0.47, 0.42, 1.51), (DZ - 0.47, DZ + 0.47, 1.47, 1.51), (DZ - 0.47, DZ + 0.47, 0.42, 0.45)):
        box('Steel', xa, xb, y0, y1, z0, z1, skip=('nx' if sx < 0 else 'px',))
mark('doors')

# ═════════════ the right compartment: the APD-8 diesel generator, the battery panel (ПА), the third seat ═════════════
gx0, gx1, gz0, gz1 = HX1 + 0.05, XI - 0.04, ZF + 0.02, ZF + 0.9
box('Olive', gx0, gx1, 0.0, 0.62, gz0, gz1, skip=('bottom', 'nz'))
box('Olive', gx0 + 0.05, gx1 - 0.05, 0.62, 0.7, gz0 + 0.1, gz1 - 0.2)
# the radiator grille on the aft face, the air filter, the exhaust through the wall, the fuel line, the control box
for k in range(9):
    y = 0.08 + k * 0.055
    quad('Black', [(gx0 + 0.08, y, gz1 + 0.002), (gx1 - 0.08, y, gz1 + 0.002), (gx1 - 0.08, y + 0.03, gz1 + 0.002), (gx0 + 0.08, y + 0.03, gz1 + 0.002)], (0, 0, 1))
S.cyl('Olive', (gx0 + 0.25, 0, gz0 + 0.35), 0.1, 0.1, 0.7, 0.92, 10)
S.cyl('Black', (gx0 + 0.25, 0, gz0 + 0.35), 0.104, 0.104, 0.92, 0.95, 10)
R._tube(S, (gx1 - 0.15, 0.55, gz0 + 0.3), (gx1 - 0.15, 0.95, gz0 + 0.3), 0.04, 'Steel', 8)
R._tube(S, (gx1 - 0.15, 0.95, gz0 + 0.3), (XI, 1.2, gz0 + 0.3), 0.04, 'Steel', 8)
box('Black', XI - 0.01, XI, 1.12, 1.28, gz0 + 0.22, gz0 + 0.38)
R._tube(S, (gx0 + 0.1, 0.2, gz1), (gx0 + 0.02, 0.05, gz1 + 0.3), 0.01, 'Black', 6)
box('ConsoleGreen', gx0 + 0.1, gx0 + 0.42, 0.25, 0.55, gz1, gz1 + 0.08, skip=('nz',))
gauge(R.mat3(0), (gx0 + 0.18, 0.46, gz1 + 0.08), 0, 0, 0.03, 0.4)
stoggle(R.mat3(0), (gx0 + 0.3, 0.46, gz1 + 0.08), 0, 0)
slamp(R.mat3(0), (gx0 + 0.36, 0.46, gz1 + 0.08), 0, 0, 'LampGreen', 0.008)
R.label('АПД-8 · DIESEL GENERATOR', ((gx0 + gx1) / 2, 0.66, gz1 + 0.003), 0.0, 0.0, h=0.02, st='w')
R.label('ПУСК · СТОП', (gx0 + 0.26, 0.37, gz1 + 0.082), 0.0, 0.0, h=0.01, st='e')
# the battery panel (ПА) on the right wall, a filter-ventilation unit (the cabin is sealed), the third seat
Mrw = R.mat3(-PI / 2)
pa = (XI - 0.08, 1.02, 0.1)
R.obox(S, 'ConsoleGreen', Mrw, pa, -0.22, 0.22, -0.2, 0.2, -0.08, 0.0, skip=('nz',))
plate(Mrw, pa, -0.21, 0.21, -0.19, 0.19, 'ConsoleGreenDark')
for k in range(2):
    gauge(Mrw, pa, -0.1 + k * 0.2, 0.07, 0.05, 0.5 + k * 0.1)
for k in range(4):
    stoggle(Mrw, pa, -0.15 + k * 0.1, -0.08)
R.label('ПА · BATTERY PANEL', (XI - 0.079, 1.19, 0.1), -PI / 2, 0.0, h=0.014, st='w')
S.cyl('Olive', (XI - 0.22, 0, ZB - 0.2), 0.15, 0.15, 0.0, 0.62, 12)
box('Olive', XI - 0.4, XI - 0.02, 0.62, 0.86, ZB - 0.38, ZB - 0.02)
R._tube(S, (XI - 0.21, 0.86, ZB - 0.2), (XI - 0.21, HC - 0.02, ZB - 0.2), 0.05, 'Steel', 8)
R.label('ФВУ', (XI - 0.21, 0.74, ZB - 0.381), PI, 0.0, h=0.03, st='w')
seat((0.98, 0.0, 0.35), -PI / 2 + 0.3)
mark('right compartment')

# ═════════════ stations, spawn ═════════════
# the operator: seated at the 2V12M, eye 1.12 m over the floor, turned a little right to take in the 9V344
R.station('stand_launch', (-0.93, 1.12, -0.2), yaw=-0.1, pitch=-0.21, fov=62)
d = Vector(R.xf(Mc, cl, (-0.02, -0.01, 0.0))) - Vector((-0.97, 1.12, -0.33))
R.station('stand_code', (-0.97, 1.12, -0.33), yaw=math.atan2(-d.x, -d.z), pitch=math.atan2(d.y, math.hypot(d.x, d.z)), fov=40)
R.spawn((-1.0, 0.0, 0.12), yaw=0.0)

R.finish(OUT, {
    'walk': [[-1.32, -0.66, -0.74, 0.18, 0.0]],
    'eye': 1.2, 'bg': '#050604',
    'lights': [
        {'t': 'hemi', 'sky': '#8d8672', 'ground': '#2a2a22', 'i': 0.35, 'name': 'amb'},
        {'t': 'point', 'p': [-1.1, 1.42, 0.35], 'c': '#ffd6a0', 'i': 2.4, 'd': 3.2, 'name': 'dome'},
        {'t': 'point', 'p': [-0.93, 1.0, -0.75], 'c': '#d8ffd0', 'i': 0.7, 'd': 1.3, 'name': 'panel'},
        {'t': 'point', 'p': [1.1, 1.42, 0.1], 'c': '#ffd6a0', 'i': 1.4, 'd': 2.8, 'name': 'dome_r'},
    ],
})
