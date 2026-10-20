# ═══════════════════════════════════════════════════════════════
# Fighter cockpit kit (Blender, headless) for cockpit.js COCKPIT_MODELS: the cockpits of the types without a
# licensed model, built from the layouts of the real ones.
#   blender -b -P tools/cockpits/cockpit_kit.py -- <layout> OUT.glb [--ao PX] [--samples N] [--preview DIR]
# Layouts (LAYOUTS below): hornet (F/A-18 family: centre stick, two DDIs over the AMPCD, the UFC, a windscreen bow
# with mirrors), viper (F-16 family: side-stick and throttle on the consoles, two MFDs, the ICP and DED, a one-piece
# canopy without a bow).
#
# Frame: the game's cockpit frame, metres: the pilot's design eye at the origin, x right, y up, the nose toward -z
# (tools/ships/shipkit.py V converts to Blender's). Real fighter proportions: the seat cushion ~0.8 m under the eye,
# the glareshield lip ~16° under the eye line (the view over the nose), the main panel ~0.7 m ahead tilted back,
# side consoles at elbow height, the canopy sills at the shoulders.
#
# What the game reads (cockpit.js loadModel):
#   SCREEN_<n>   a quad, UV 0..1 (u right, v up): a live display (COCKPIT_MODELS lists the kind for each n)
#   GAUGE_<kind> a round face, UV 0..1: a live gauge (asi, alt, adi)
#   ANN_<key>    a caution / warning lamp face, UV 0..1: master, stall, ab, brake, launch, lock, gear, fuel
#   HUD_GLASS    the combiner; CANOPY_GLASS the canopy (the game's glass shader)
#   STICK, THROTTLE   the controls, origin on the pivot (the game moves them with the pilot's inputs)
#   lbl_<n>      placards (text in extras: the game draws them into one atlas: roomdress.js mergeLabels)
#   everything else is merged per material (one draw call each; textures by material name: roomdress.js
#   ROOM_MATERIALS), with an ambient-occlusion bake on a second UV set (--ao: the glTF occlusion texture), the
#   soft contact shadows that make a cockpit read as solid.
# ═══════════════════════════════════════════════════════════════
import bpy, bmesh, math, os, sys, json
from mathutils import Vector
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, '..', 'interiors'))
sys.path.insert(0, os.path.join(HERE, '..', 'ships'))
import roomkit as R
from shipkit import Part, material, srgb, V, MATS

PI = math.pi
argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
LAYOUT = argv[0] if argv else 'hornet'
OUT = argv[1] if len(argv) > 1 else '/tmp/cockpit.glb'
def opt(name, default=None):
    return argv[argv.index(name) + 1] if name in argv else default
AO_PX = int(opt('--ao', '0'))
SAMPLES = int(opt('--samples', '48'))
PREVIEW = opt('--preview')

# ── layouts ──
# (stick: centre / side; bow: a windscreen bow; displays: the panel's layout (PANELS); seat: mk14 (handle between the
# knees), aces2 (on the seat sides), k36 (the Zvezda seat: orange handles between the knees); palette: west (dark gull
# grey) or russ (the Soviet blue-green); hmd: no HUD (the F-35's helmet display: the game keeps its HUD full screen))
LAYOUTS = {
    'hornet': dict(stick='centre', bow=True, displays='ddi3', seat='mk14', mirrors=3, glare_lip=-0.68),
    'viper': dict(stick='side', bow=False, displays='mfd2', seat='aces2', mirrors=3, glare_lip=-0.68),
    'eagle': dict(stick='centre', bow=True, displays='eagle', seat='aces2', mirrors=3, glare_lip=-0.68),
    'tomcat': dict(stick='centre', bow=True, displays='tomcat', seat='mk14', mirrors=3, glare_lip=-0.7),
    'analog': dict(stick='centre', bow=True, displays='analog', seat='mk14', mirrors=1, glare_lip=-0.66),
    'flanker': dict(stick='centre', bow=True, displays='flanker', seat='k36', mirrors=3, glare_lip=-0.68, palette='russ'),
    'fishbed': dict(stick='centre', bow=True, displays='fishbed', seat='k36', mirrors=1, glare_lip=-0.64, palette='russ'),
    'pcd': dict(stick='side', bow=False, displays='pcd', seat='mk14', mirrors=0, glare_lip=-0.7, hmd=True),
    'glass3': dict(stick='centre', bow=True, displays='glass3', seat='mk14', mirrors=3, glare_lip=-0.68),
    'glass3s': dict(stick='side', bow=True, displays='glass3', seat='mk14', mirrors=3, glare_lip=-0.68),
}
L = LAYOUTS[LAYOUT]
RUSS = L.get('palette') == 'russ'
PAINT = 'CkTurq' if RUSS else 'CkGrey'

R.begin()
for name, col, metal, rough in [
    ('CkGrey', 0x5e656b, 0.15, 0.62),      # FS 36231 dark gull grey: panels and consoles
    ('CkGreyDark', 0x474d53, 0.15, 0.7),   # the tub walls, the floor
    ('CkBlack', 0x0d0e0f, 0.0, 0.97),      # anti-glare black (glareshield)
    ('CkFrame', 0x24282c, 0.45, 0.42),     # canopy frame, sills
    ('CkSeat', 0x4a4b36, 0.0, 0.85),       # seat bucket (olive)
    ('CkCushion', 0x23251f, 0.0, 0.95),    # cushions
    ('CkStrap', 0x5c5a40, 0.0, 0.9),       # harness
    ('CkBtn', 0x62676c, 0.2, 0.5),         # push buttons
    ('CkTurq', 0x4a9a98, 0.12, 0.6),       # the Soviet cockpit's blue-green (Su-27, MiG-29, MiG-21)
    ('CkSeatK', 0x5a5f58, 0.0, 0.85),      # the K-36's grey
]:
    material(name, srgb(col), metal, rough)
S = R.static('cockpit')
LBL = []

# ── local frames: M (rotation) and o (origin) in the game frame; a panel's +z points out of it at the pilot ──
def frame(o, yaw=0.0, tilt=0.0, roll=0.0):
    return (R.mat3(yaw, tilt, roll), o, yaw, tilt, roll)
def at(F, x, y, z=0.0):
    return R.xf(F[0], F[1], (x, y, z))

def box(mat, F, x0, x1, y0, y1, z0, z1, skip=()):
    R.obox(S, mat, F[0], F[1], x0, x1, y0, y1, z0, z1, skip)
def cyl(mat, F, c, r0, r1, a0, a1, n=12, axis='z', cap0=True, cap1=True):
    R.ocyl(S, mat, F[0], F[1], c, r0, r1, a0, a1, n, axis, cap0, cap1)
def label(text, F, x, y, h=0.008, st='e', w=None, z=0.0012):
    LBL.append(R.label(text, at(F, x, y, z), F[2], F[3], h=h, w=w, st=st, roll=F[4]))

# ── static detail on a panel (local frame F; each faces +z) ──
def toggle(F, x, y, up=True, mat='Chrome'):
    box('Bezel', F, x - 0.007, x + 0.007, y - 0.007, y + 0.007, 0.0, 0.002)
    cyl('Chrome', F, (x, y, 0), 0.004, 0.004, 0.002, 0.005, 10)
    # the bat lever, thrown up (or down) at 25°
    s = 1 if up else -1
    pts = [(x, y, 0.005), (x, y + s * 0.007, 0.02)]
    a, b = at(F, *pts[0]), at(F, *pts[1])
    S.beam(mat, a, b, 0.0032, 0.0032)
    S.sphere(mat, b, 0.0028, 0.0028, 0.0028, 8, 5)
def guarded(F, x, y, col='Red'):
    toggle(F, x, y, False)
    box(col, F, x - 0.011, x + 0.011, y - 0.016, y + 0.012, 0.0, 0.0015)
    box(col, F, x - 0.011, x - 0.009, y - 0.016, y + 0.012, 0.0, 0.016)
    box(col, F, x + 0.009, x + 0.011, y - 0.016, y + 0.012, 0.0, 0.016)
    box(col, F, x - 0.011, x + 0.011, y + 0.010, y + 0.012, 0.0, 0.016)
def knob(F, x, y, r=0.011, mat='Black'):
    cyl('Bezel', F, (x, y, 0), r * 1.35, r * 1.35, 0.0, 0.002, 16)
    cyl(mat, F, (x, y, 0), r, r * 0.92, 0.002, 0.014, 16)
    box('White', F, x - 0.0012, x + 0.0012, y + r * 0.15, y + r * 0.9, 0.014, 0.0148)
def pushbutton(F, x, y, w=0.012, h=0.01, mat='CkBtn'):
    box('Bezel', F, x - w / 2 - 0.002, x + w / 2 + 0.002, y - h / 2 - 0.002, y + h / 2 + 0.002, 0.0, 0.002)
    box(mat, F, x - w / 2, x + w / 2, y - h / 2, y + h / 2, 0.002, 0.007)
def screw(F, x, y, r=0.0028):
    cyl('Metal', F, (x, y, 0), r, r * 0.8, 0.0, 0.0012, 8)
def plate(F, x0, x1, y0, y1, mat=None, d=0.004):
    """a module plate, raised a few mm, with its four screws"""
    box(mat or PAINT, F, x0, x1, y0, y1, 0.0, d, skip=('nz',))
    G = (F[0], at(F, 0, 0, d), F[2], F[3], F[4])
    for x in (x0 + 0.006, x1 - 0.006):
        for y in (y0 + 0.006, y1 - 0.006):
            screw(G, x, y)
    return G

# a node: a quad (or round face) with UV 0..1 the game draws on
def face_node(name, F, x, y, w, h, z=0.0, mat='Screen', round_=False):
    P = Part(name)
    if round_:
        n = 28
        pts = [(math.cos(2 * PI * i / n) * w / 2, math.sin(2 * PI * i / n) * h / 2, 0) for i in range(n)]
        uvs = [(0.5 + 0.5 * math.cos(2 * PI * i / n), 0.5 + 0.5 * math.sin(2 * PI * i / n)) for i in range(n)]
        P.g(mat).face(pts, uvs, (0, 0, 1))
    else:
        P.g(mat).face([(-w / 2, -h / 2, 0), (w / 2, -h / 2, 0), (w / 2, h / 2, 0), (-w / 2, h / 2, 0)], [(0, 0), (1, 0), (1, 1), (0, 1)], (0, 0, 1))
    return R.node(name, P, at(F, x, y, z), F[2], F[3], F[4])

SCREENS = []
def display(F, x, y, w, h, osb=True, bezel=0.026):
    """a display: bezel, recessed screen (SCREEN_<n>), push buttons round it, the brightness / contrast rockers"""
    box('Bezel', F, x - w / 2 - bezel, x + w / 2 + bezel, y - h / 2 - bezel, y + h / 2 + bezel, 0.0, 0.016)
    box('Black', F, x - w / 2 - 0.003, x + w / 2 + 0.003, y - h / 2 - 0.003, y + h / 2 + 0.003, 0.016, 0.0165)
    n = len(SCREENS)
    SCREENS.append(face_node('SCREEN_%d' % n, F, x, y, w, h, 0.0168))
    if osb:
        for i in range(5):
            t = (i - 2) / 4.6
            for (bx, by, rot) in [(x + t * w, y + h / 2 + bezel * 0.55, False), (x + t * w, y - h / 2 - bezel * 0.55, False),
                                   (x - w / 2 - bezel * 0.55, y + t * h, True), (x + w / 2 + bezel * 0.55, y + t * h, True)]:
                G = (F[0], at(F, 0, 0, 0.016), F[2], F[3], F[4])
                if rot:
                    pushbutton(G, bx, by, 0.009, 0.012)
                else:
                    pushbutton(G, bx, by, 0.012, 0.009)
        G = (F[0], at(F, 0, 0, 0.016), F[2], F[3], F[4])
        for (cx, cy) in [(x - w / 2 - bezel * 0.6, y + h / 2 + bezel * 0.6), (x + w / 2 + bezel * 0.6, y + h / 2 + bezel * 0.6),
                         (x - w / 2 - bezel * 0.6, y - h / 2 - bezel * 0.6), (x + w / 2 + bezel * 0.6, y - h / 2 - bezel * 0.6)]:
            box('CkBtn', G, cx - 0.006, cx + 0.006, cy - 0.006, cy + 0.006, 0.0, 0.006)
    return n

def gauge(F, kind, x, y, r):
    """a standby instrument: bezel ring, four screws, its live face (GAUGE_<kind>)"""
    box('Bezel', F, x - r - 0.012, x + r + 0.012, y - r - 0.012, y + r + 0.012, 0.0, 0.01)
    cyl('Black', F, (x, y, 0), r + 0.004, r + 0.004, 0.01, 0.014, 28)
    G = (F[0], at(F, 0, 0, 0.01), F[2], F[3], F[4])
    for sx in (-1, 1):
        for sy in (-1, 1):
            screw(G, x + sx * (r + 0.006), y + sy * (r + 0.006), 0.0022)
    face_node('GAUGE_' + kind, F, x, y, r * 2, r * 2, 0.0142, round_=True)

ANNS = []
def annunciators(F, x, y, keys, w=0.028, h=0.012, gap=0.004):
    """a strip of caution / warning lamps (ANN_<key>), on a black plate"""
    n = len(keys)
    W = n * w + (n - 1) * gap
    box('Bezel', F, x - W / 2 - 0.006, x + W / 2 + 0.006, y - h / 2 - 0.005, y + h / 2 + 0.005, 0.0, 0.008)
    for i, k in enumerate(keys):
        cx = x - W / 2 + w / 2 + i * (w + gap)
        ANNS.append(face_node('ANN_' + k, F, cx, y, w, h, 0.0085, mat='Screen'))

def module(F, x0, x1, y0, y1, title, rows):
    """a console module: plate, title, rows of controls [(kind, legend), ...] (kinds: t toggle, g guarded, k knob,
    b button, l lamp)"""
    G = plate(F, x0, x1, y0, y1)
    label(title, G, (x0 + x1) / 2, y1 - 0.011, h=0.0075, st='e')
    nr = len(rows)
    for ri, row in enumerate(rows):
        y = y1 - 0.03 - ri * (y1 - y0 - 0.034) / max(nr, 1)
        nc = len(row)
        for ci, (kind, leg) in enumerate(row):
            x = x0 + (x1 - x0) * (ci + 0.5) / nc
            if kind == 't':
                toggle(G, x, y + 0.002, (ri + ci) % 3 != 1)
            elif kind == 'g':
                guarded(G, x, y + 0.002)
            elif kind == 'k':
                knob(G, x, y + 0.002, 0.009)
            elif kind == 'b':
                pushbutton(G, x, y + 0.002)
            elif kind == 'l':
                cyl('Bezel', G, (x, y + 0.002, 0), 0.006, 0.006, 0.0, 0.002, 12)
                cyl('LampGreen', G, (x, y + 0.002, 0), 0.0045, 0.0045, 0.002, 0.004, 12)
            if leg:
                label(leg, G, x, y - 0.0135, h=0.0055, st='e')
    return G

# ═════════════ the tub ═════════════
SILL_Y, SILL_X = -0.25, 0.44
CONS_Y = -0.56          # side console tops
FLOOR_Y = -1.06
def tub():
    W = SILL_X
    # side walls from the console up to the sill, the cockpit floor, the forward bulkhead under the panel
    F0 = frame((0, 0, 0))
    for s in (-1, 1):
        x = s * W
        S.g('CkGreyDark').face([(x, CONS_Y, -0.98), (x, SILL_Y, -0.98), (x, SILL_Y, 0.52), (x, CONS_Y, 0.52)], None, (-s, 0, 0))
        # the sill: a frame rail along the top of the wall, riveted
        S.beam('CkFrame', (x - s * 0.02, SILL_Y + 0.012, -0.95), (x - s * 0.02, SILL_Y + 0.012, 0.62), 0.045, 0.026)
        for z in [i * 0.05 - 0.92 for i in range(31)]:
            R.ocyl(S, 'Metal', R.mat3(0, PI / 2), (x - s * 0.02, SILL_Y + 0.0255, z), (0, 0, 0), 0.0026, 0.002, 0.0, 0.0012, 6)
        # the wall below the console, down to the floor
        S.g('CkGreyDark').face([(s * 0.47, FLOOR_Y, -1.0), (s * 0.47, CONS_Y - 0.1, -1.0), (s * 0.47, CONS_Y - 0.1, 0.5), (s * 0.47, FLOOR_Y, 0.5)], None, (-s, 0, 0))
        # forward of the consoles, the wall from the floor up under the panel's edge
        S.g('CkGreyDark').face([(s * 0.44, FLOOR_Y, -1.0), (s * 0.44, SILL_Y, -1.0), (s * 0.44, SILL_Y, -0.62), (s * 0.44, FLOOR_Y, -0.62)], None, (-s, 0, 0))
        # wiring bundles and a hydraulic line along the wall
        for k, (yy, r) in enumerate([(-0.36, 0.009), (-0.4, 0.006), (-0.44, 0.011)]):
            R._tube(S, (x - s * 0.012, yy, -0.6), (x - s * 0.012, yy + 0.01, 0.45), r, 'Cable', 8)
            for z in (-0.45, -0.15, 0.15):
                S.beam('Metal', (x - s * 0.004, yy - r - 0.004, z), (x - s * 0.004, yy + r + 0.004, z), 0.008, 0.006)
    S.g('CkGreyDark').face([(-0.47, FLOOR_Y, -1.0), (-0.47, FLOOR_Y, 0.5), (0.47, FLOOR_Y, 0.5), (0.47, FLOOR_Y, -1.0)], None, (0, 1, 0))
    # rudder pedals on their arms, kick plates
    for s in (-1, 1):
        x = s * 0.15
        S.beam('Metal', (x, FLOOR_Y + 0.02, -1.0), (x, FLOOR_Y + 0.17, -0.92), 0.02, 0.02)
        Fp = frame((x, FLOOR_Y + 0.17, -0.9), tilt=-0.7)
        box('CkGreyDark', Fp, -0.055, 0.055, -0.06, 0.06, 0.0, 0.016)
        for i in range(4):
            box('Rubber', Fp, -0.05, 0.05, -0.05 + i * 0.03, -0.04 + i * 0.03, 0.016, 0.02)
    # the footwell's forward bulkhead under the panel
    S.g('CkGreyDark').face([(-0.44, FLOOR_Y, -1.0), (0.44, FLOOR_Y, -1.0), (0.44, -0.3, -1.0), (-0.44, -0.3, -1.0)], None, (0, 0, 1))
    # aft bulkhead behind the seat
    S.g('CkGreyDark').face([(-0.47, FLOOR_Y, 0.55), (-0.47, SILL_Y, 0.55), (0.47, SILL_Y, 0.55), (0.47, FLOOR_Y, 0.55)], None, (0, 0, -1))

# ═════════════ the side consoles ═════════════
def consoles():
    for s in (-1, 1):
        x0, x1 = (0.235, 0.44) if s > 0 else (-0.44, -0.235)
        # the console body: top, inboard face down to the floor
        F = frame((0, CONS_Y, 0), tilt=PI / 2)                      # local x right, y forward (-z), +z up
        box(PAINT, F, x0, x1, -0.5, 0.62, -0.13, 0.0)
        # its modules (the left console: engines, fuel, comms; the right: lights, sensors, environment)
        mods = ([('FUEL', [[('t', 'PROBE'), ('t', 'DUMP')], [('k', 'BINGO'), ('t', 'X-FEED')]]),
                 ('COMM', [[('k', 'VOL 1'), ('k', 'VOL 2')], [('t', 'IFF'), ('t', 'ILS')]]),
                 ('APU', [[('g', 'APU'), ('t', 'ENG CRANK')], [('l', ''), ('t', 'GEN TIE')]]),
                 ('EXT LT', [[('k', 'FORM'), ('k', 'POSN')], [('t', 'STROBE'), ('t', 'LDG/TAXI')]])]
                if s < 0 else
                [('SNSR', [[('k', 'FLIR'), ('k', 'RADAR')], [('t', 'INS'), ('t', 'LST')]]),
                 ('ECS', [[('k', 'TEMP'), ('t', 'DEFOG')], [('t', 'CABIN'), ('t', 'ANTI-ICE')]]),
                 ('INTR LT', [[('k', 'CONSOLE'), ('k', 'INST PNL')], [('k', 'FLOOD'), ('t', 'TEST')]]),
                 ('ELEC', [[('g', 'BATT'), ('t', 'L GEN')], [('t', 'R GEN'), ('l', '')]])])
        z_free = (0.08, -0.22) if (s < 0 or L['stick'] == 'side') else None   # (the throttle / side-stick quadrant)
        zs = [0.5, 0.29, -0.3, -0.48] if z_free else [0.5, 0.29, 0.08, -0.13]
        for (title, rows), zc in zip(mods, zs):
            # (module frames: local y is forward along the console, so the text reads from the seat)
            module(F, x0 + 0.008, x1 - 0.008, -zc - 0.1, -zc + 0.1, title, rows)
        if z_free:
            # the quadrant: a black slot plate for the lever
            G = plate(F, x0 + 0.01, x1 - 0.01, -0.02, 0.27, 'Bezel')
            label('THROTTLE' if s < 0 else 'FLCS', G, (x0 + x1) / 2, 0.255, h=0.007)
            box('Black', G, (x0 + x1) / 2 - 0.012 + s * 0.02, (x0 + x1) / 2 + 0.012 + s * 0.02, 0.02, 0.24, -0.002, 0.0005)
            for k, t in enumerate(['OFF', 'IDLE', 'MIL', 'AB']):
                label(t, G, (x0 + x1) / 2 - s * 0.05, 0.05 + k * 0.055, h=0.0055)

# ═════════════ the main panel, glareshield, HUD ═════════════
# (its top edge just under the glareshield lip, 19° under the eye line; the displays 25-35° down)
PANEL_O, PANEL_TILT = (0.0, -0.45, -0.69), 0.24
def panel():
    F = frame(PANEL_O, tilt=PANEL_TILT)
    # the panel: a wide upper part and the centre pedestal between the knees, its edges sweeping back to the sills
    box(PAINT, F, -0.43, 0.43, -0.03, 0.2, -0.05, 0.0)
    box(PAINT, F, -0.2, 0.2, -0.26, -0.03, -0.05, 0.0)
    for s in (-1, 1):
        box(PAINT, F, s * 0.43 - 0.02, s * 0.43 + 0.02, -0.03, 0.2, -0.05, 0.22)
    # the pedestal down to the floor
    box(PAINT, frame((0, 0, 0)), -0.17, 0.17, FLOOR_Y, PANEL_O[1] - 0.24, -0.86, -0.7)
    PANELS[L['displays']](F)
    # panel seams and screws round the edge
    for x in [-0.42 + i * 0.105 for i in range(9)]:
        screw(F, x, 0.19); screw(F, x, -0.02)
    return F

def master_arm(F, x, y):
    G = plate(F, x - 0.045, x + 0.045, y - 0.04, y + 0.04)
    label('MASTER ARM', G, x, y + 0.03, h=0.006)
    guarded(G, x - 0.015, y)
    pushbutton(G, x + 0.02, y, 0.014, 0.014, 'Red')

def switch_row(F, x0, x1, y, n, title=None, guard_at=None):
    G = plate(F, x0, x1, y - 0.02, y + 0.022)
    for i in range(n):
        x = x0 + (x1 - x0) * (i + 0.5) / n
        if i == guard_at:
            guarded(G, x, y + 0.002)
        else:
            toggle(G, x, y + 0.002, i % 2 == 0)
    if title:
        label(title, G, (x0 + x1) / 2, y - 0.013, h=0.0055)

def p_ddi3(F):
    # F/A-18: left and right DDIs, the AMPCD between the knees, the UFC on top, the standby instruments
    display(F, -0.255, 0.065, 0.145, 0.145)
    display(F, 0.255, 0.065, 0.145, 0.145)
    ufc(F, 0.0, 0.11)
    display(F, 0.0, -0.145, 0.15, 0.15)
    gauge(F, 'adi', -0.115, -0.065, 0.032)
    gauge(F, 'asi', 0.115, -0.03, 0.026)
    gauge(F, 'alt', 0.115, -0.1, 0.026)
    annunciators(F, -0.255, 0.18, ['master', 'stall', 'ab', 'brake'])
    annunciators(F, 0.255, 0.18, ['launch', 'lock', 'gear', 'fuel'])
    landing_gear(F, -0.39, -0.0)
    master_arm(F, 0.375, 0.02)
    for s in (-1, 1):
        switch_row(F, s * 0.355 - 0.035, s * 0.355 + 0.035, 0.115, 2, 'HOOK' if s < 0 else 'SPIN')
    switch_row(F, -0.19, 0.19, -0.235, 9)

def p_mfd2(F):
    # F-16: the two MFDs low, the ICP and DED up in the middle, standby instruments, the RWR scope
    display(F, -0.255, 0.02, 0.135, 0.135)
    display(F, 0.255, 0.02, 0.135, 0.135)
    ufc(F, 0.0, 0.12, ded=True)
    gauge(F, 'adi', 0.0, -0.06, 0.036)
    gauge(F, 'asi', -0.1, -0.02, 0.025)
    gauge(F, 'alt', 0.1, -0.02, 0.025)
    display(F, 0.0, -0.17, 0.08, 0.08, osb=False, bezel=0.018)   # the RWR / TSD scope
    annunciators(F, -0.255, 0.155, ['master', 'stall', 'ab', 'brake'])
    annunciators(F, 0.255, 0.155, ['launch', 'lock', 'gear', 'fuel'])
    landing_gear(F, -0.39, -0.02)
    master_arm(F, 0.375, 0.125)
    for s in (-1, 1):
        switch_row(F, s * 0.355 - 0.035, s * 0.355 + 0.035, -0.06, 2, 'HOOK' if s < 0 else 'SPIN')
    switch_row(F, -0.19, 0.19, -0.235, 9)

def p_eagle(F):
    # F-15C: the VSD (radar) top left and the TEWS threat scope top right, the big ADI in the middle with the
    # standby air data round it, the MPCD and the HSI on the pedestal, the engine instruments on the right
    display(F, -0.29, 0.1, 0.11, 0.11)                    # VSD
    display(F, 0.31, 0.135, 0.075, 0.075, osb=False, bezel=0.016)   # TEWS
    display(F, -0.1, -0.15, 0.11, 0.11)                   # MPCD
    gauge(F, 'adi', 0.0, 0.07, 0.048)
    gauge(F, 'hsi', 0.1, -0.15, 0.045)
    gauge(F, 'asi', -0.135, 0.12, 0.026); gauge(F, 'aoa', -0.135, 0.045, 0.022)
    gauge(F, 'alt', 0.135, 0.12, 0.026); gauge(F, 'vvi', 0.135, 0.045, 0.022)
    for i, k in enumerate(['rpm', 'rpm', 'egt', 'egt']):
        gauge(F, k + '_%d' % i, 0.255 + (i % 2) * 0.075, 0.055 - (i // 2) * 0.055, 0.02)
    gauge(F, 'fuel', 0.38, 0.03, 0.022)
    annunciators(F, -0.25, 0.185, ['master', 'stall', 'ab', 'brake'], w=0.024)
    annunciators(F, 0.0, 0.185, ['launch', 'lock', 'gear', 'fuel'], w=0.024)
    landing_gear(F, -0.39, 0.07)
    switch_row(F, -0.43 + 0.01, -0.2 - 0.01, -0.01, 5, 'ARMT', guard_at=0)

def p_tomcat(F):
    # F-14 front cockpit: the VDI (the attitude picture) over the HSD (the tactical picture), analogue flight and
    # engine instruments either side, the armament panel low on the left
    display(F, 0.0, 0.1, 0.13, 0.13, osb=False, bezel=0.02)        # VDI
    display(F, 0.0, -0.13, 0.12, 0.12, osb=False, bezel=0.02)      # HSD
    gauge(F, 'asi', -0.16, 0.13, 0.027); gauge(F, 'aoa', -0.16, 0.055, 0.024); gauge(F, 'adi', -0.27, 0.1, 0.036)
    gauge(F, 'alt', 0.16, 0.13, 0.027); gauge(F, 'vvi', 0.16, 0.055, 0.024)
    for i, k in enumerate(['rpm', 'rpm', 'egt', 'egt']):
        gauge(F, k + '_%d' % i, 0.27 + (i % 2) * 0.07, 0.13 - (i // 2) * 0.06, 0.021)
    gauge(F, 'fuel', 0.305, 0.0, 0.024); gauge(F, 'hsi', -0.13, -0.13, 0.04)
    annunciators(F, -0.22, 0.185, ['master', 'stall', 'ab', 'brake'], w=0.024)
    annunciators(F, 0.22, 0.185, ['launch', 'lock', 'gear', 'fuel'], w=0.024)
    landing_gear(F, -0.39, 0.06)
    switch_row(F, -0.43 + 0.01, -0.21, -0.005, 4, 'WPN SEL', guard_at=3)

def p_analog(F):
    # the second-generation layout (F-4E, F-5E, A-10A, Mirage 5, Jaguar): the ADI over the HSI in the middle (the
    # basic T), air data round them, the radar scope top left, the engine instruments down the right
    display(F, -0.29, 0.1, 0.095, 0.095, osb=False, bezel=0.022)   # radar scope / TV monitor
    gauge(F, 'adi', 0.0, 0.085, 0.045)
    gauge(F, 'hsi', 0.0, -0.11, 0.045)
    gauge(F, 'asi', -0.13, 0.12, 0.027); gauge(F, 'aoa', -0.13, 0.045, 0.022)
    gauge(F, 'alt', 0.13, 0.12, 0.027); gauge(F, 'vvi', 0.13, 0.045, 0.022)
    gauge(F, 'g', -0.13, -0.08, 0.022)
    for i, k in enumerate(['rpm', 'egt', 'fuel', 'rpm']):
        gauge(F, k + '_%d' % i, 0.255 + (i % 2) * 0.075, 0.12 - (i // 2) * 0.065, 0.024)
    annunciators(F, -0.23, 0.185, ['master', 'stall', 'ab', 'brake'], w=0.024)
    annunciators(F, 0.23, 0.185, ['launch', 'lock', 'gear', 'fuel'], w=0.024)
    landing_gear(F, -0.39, 0.0)
    switch_row(F, 0.215, 0.425, -0.005, 5, 'ARMAMENT', guard_at=4)
    switch_row(F, 0.06, 0.19, -0.2, 3)

def p_flanker(F):
    # Su-35S (and the Su-27 family, MiG-29, J-10): two big MFDs side by side, a small one under them, the standby
    # instruments down the left, the engine gauges down the right, on the blue-green panel
    display(F, -0.105, 0.07, 0.15, 0.15)
    display(F, 0.105, 0.07, 0.15, 0.15)
    display(F, 0.0, -0.15, 0.1, 0.1, osb=False, bezel=0.02)
    gauge(F, 'adi', -0.31, 0.1, 0.036); gauge(F, 'asi', -0.31, 0.015, 0.024); gauge(F, 'alt', -0.37, 0.155, 0.02)
    gauge(F, 'vvi', -0.25, 0.155, 0.02)
    for i, k in enumerate(['rpm', 'rpm', 'egt', 'egt']):
        gauge(F, k + '_%d' % i, 0.28 + (i % 2) * 0.07, 0.13 - (i // 2) * 0.06, 0.021)
    gauge(F, 'fuel', 0.315, 0.01, 0.024); gauge(F, 'g', -0.13, -0.13, 0.022); gauge(F, 'aoa', 0.13, -0.13, 0.022)
    annunciators(F, -0.105, 0.183, ['master', 'stall', 'ab', 'brake'], w=0.026)
    annunciators(F, 0.105, 0.183, ['launch', 'lock', 'gear', 'fuel'], w=0.026)
    landing_gear(F, -0.395, -0.0)
    switch_row(F, 0.215, 0.425, -0.008, 5, None, guard_at=0)

def p_fishbed(F):
    # MiG-21 (and the MiG-25 / MiG-31, J-8): the radar scope under its rubber hood at the top of the panel, the ADI
    # under it, the HSI on the pedestal, round instruments either side, on the blue-green panel
    display(F, 0.0, 0.11, 0.1, 0.1, osb=False, bezel=0.018)
    G = (F[0], at(F, 0, 0, 0.016), F[2], F[3], F[4])
    for (x0, x1, y0, y1) in [(-0.075, -0.065, 0.04, 0.18), (0.065, 0.075, 0.04, 0.18), (-0.075, 0.075, 0.17, 0.18)]:
        box('Rubber', G, x0, x1, y0, y1, 0.0, 0.06)                 # the scope's viewing hood
    gauge(F, 'adi', 0.0, -0.02, 0.04)
    gauge(F, 'hsi', 0.0, -0.17, 0.04)
    gauge(F, 'asi', -0.15, 0.12, 0.027); gauge(F, 'alt', -0.15, 0.045, 0.027); gauge(F, 'vvi', -0.245, 0.09, 0.022)
    gauge(F, 'g', -0.13, -0.12, 0.022)
    gauge(F, 'rpm', 0.15, 0.12, 0.027); gauge(F, 'egt', 0.15, 0.045, 0.024); gauge(F, 'fuel', 0.245, 0.09, 0.024)
    gauge(F, 'aoa', 0.13, -0.12, 0.022)
    annunciators(F, -0.32, 0.17, ['master', 'stall', 'ab', 'brake'], w=0.022)
    annunciators(F, 0.32, 0.17, ['launch', 'lock', 'gear', 'fuel'], w=0.022)
    landing_gear(F, -0.39, 0.03)
    switch_row(F, 0.29, 0.425, 0.03, 3, None, guard_at=2)

def p_pcd(F):
    # F-35: the panoramic cockpit display, 20 by 8 inches, as two portals; the standby flight display under it;
    # no HUD (the helmet shows it)
    box('Bezel', F, -0.27, 0.27, -0.06, 0.17, 0.0, 0.016)
    display(F, -0.128, 0.055, 0.245, 0.2, osb=False, bezel=0.006)
    display(F, 0.128, 0.055, 0.245, 0.2, osb=False, bezel=0.006)
    display(F, 0.0, -0.14, 0.08, 0.07, osb=False, bezel=0.014)       # standby flight display
    annunciators(F, -0.33, 0.12, ['master', 'stall'], w=0.026); annunciators(F, -0.33, 0.1, ['ab', 'brake'], w=0.026)
    annunciators(F, 0.33, 0.12, ['launch', 'lock'], w=0.026); annunciators(F, 0.33, 0.1, ['gear', 'fuel'], w=0.026)
    gauge(F, 'asi', -0.13, -0.15, 0.022); gauge(F, 'alt', 0.13, -0.15, 0.022); gauge(F, 'adi', -0.37, 0.03, 0.024)
    landing_gear(F, -0.39, -0.0)
    master_arm(F, 0.38, 0.0)

def p_glass3(F):
    # the European canards and the Su-57 / J-20: three big displays across the panel, the standby instruments on the
    # pedestal, the warning panel above
    display(F, -0.25, 0.065, 0.14, 0.14)
    display(F, 0.0, 0.065, 0.155, 0.155)
    display(F, 0.25, 0.065, 0.14, 0.14)
    gauge(F, 'adi', 0.0, -0.13, 0.034); gauge(F, 'asi', -0.11, -0.13, 0.024); gauge(F, 'alt', 0.11, -0.13, 0.024)
    annunciators(F, -0.25, 0.183, ['master', 'stall', 'ab', 'brake'])
    annunciators(F, 0.25, 0.183, ['launch', 'lock', 'gear', 'fuel'])
    landing_gear(F, -0.395, -0.0)
    master_arm(F, 0.38, 0.0)
    switch_row(F, -0.19, 0.19, -0.235, 9)

PANELS = {'ddi3': p_ddi3, 'mfd2': p_mfd2, 'eagle': p_eagle, 'tomcat': p_tomcat, 'analog': p_analog,
          'flanker': p_flanker, 'fishbed': p_fishbed, 'pcd': p_pcd, 'glass3': p_glass3}

def ufc(F, x, y, ded=False):
    """up-front control: a keypad, option buttons, the text display (SCREEN), on its own plate"""
    G = plate(F, x - 0.1, x + 0.1, y - 0.06, y + 0.06, PAINT, 0.012)
    display(G, x + 0.03, y + 0.02, 0.1, 0.04 if not ded else 0.045, osb=False, bezel=0.008)
    keys = ['1', '2', '3', '4', '5', '6', '7', '8', '9', 'CLR', '0', 'ENT']
    for i, k in enumerate(keys):
        kx, ky = x - 0.082 + (i % 3) * 0.022, y + 0.038 - (i // 3) * 0.02
        pushbutton(G, kx, ky, 0.017, 0.014, 'CkBtn')
        label(k, (G[0], at(G, 0, 0, 0.007), G[2], G[3], G[4]), kx, ky, h=0.007, st='w', w=0.013)
    for i in range(5):
        pushbutton(G, x - 0.01 + i * 0.022, y - 0.03, 0.018, 0.011, 'CkBtn')
    knob(G, x + 0.09, y + 0.045, 0.008); knob(G, x + 0.09, y + 0.01, 0.008)
    label('UFC' if not ded else 'ICP', G, x + 0.03, y - 0.05, h=0.006)

def landing_gear(F, x, y):
    """the gear handle (the wheel-shaped knob that lights red in transit), its placard, the down-lock lamps"""
    G = plate(F, x - 0.04, x + 0.04, y - 0.07, y + 0.07)
    label('LDG GEAR', G, x, y + 0.06, h=0.006)
    box('Black', G, x - 0.006, x + 0.006, y - 0.045, y + 0.04, -0.001, 0.0005)
    S.beam('Chrome', at(G, x, y + 0.005, 0.0), at(G, x, y + 0.005, 0.05), 0.008, 0.008)
    R.ocyl(S, 'White', G[0], at(G, x, y + 0.005, 0.05), (0, 0, 0), 0.018, 0.018, -0.006, 0.006, 14, axis='z')
    for k in range(3):
        cyl('Bezel', G, (x - 0.02 + k * 0.02, y - 0.055, 0), 0.006, 0.006, 0.0, 0.002, 10)
        cyl('LampGreen', G, (x - 0.02 + k * 0.02, y - 0.055, 0), 0.0045, 0.0045, 0.002, 0.004, 10)

def glareshield_hud():
    lip = L['glare_lip']
    # the glareshield: an anti-glare hood over the panel, highest in the middle, its rounded lip toward the pilot
    n = 14
    top = lip * math.tan(math.radians(16))          # (the view over the nose: 16° under the eye line)
    for i in range(n):
        xa, xb = -0.44 + 0.88 * i / n, -0.44 + 0.88 * (i + 1) / n
        ya, yb = top - 0.055 * (xa / 0.44) ** 2, top - 0.055 * (xb / 0.44) ** 2
        S.g('CkBlack').face([(xa, ya, -1.0), (xa, ya, lip), (xb, yb, lip), (xb, yb, -1.0)], None, (0, 1, 0))
        S.g('CkBlack').face([(xa, ya, lip), (xa, ya - 0.05, lip + 0.01), (xb, yb - 0.05, lip + 0.01), (xb, yb, lip)], None, (0, 0, 1))
        S.beam('CkBlack', (xa, ya - 0.004, lip + 0.004), (xb, yb - 0.004, lip + 0.004), 0.016, 0.016, caps=False)
    if L.get('hmd'):
        return   # (no HUD: the helmet display; the game keeps the symbology full screen)
    # the HUD: its body standing on the glareshield, the combiner frame and glass on the eye line
    Fh = frame((0, top, lip - 0.08))
    box('CkBlack', Fh, -0.085, 0.085, -0.01, 0.06, -0.12, 0.06)
    box('Bezel', Fh, -0.07, 0.07, 0.06, 0.075, -0.05, 0.05)
    # (the combiner's glass straddles the eye line whatever the glareshield's height: its field of view is about
    # +5° to -8°, so the view straight ahead goes through glass, not its frame)
    hud_tilt, base = 0.32, -0.085
    Fc = frame((0, base, lip - 0.04), tilt=hud_tilt)
    W, H = 0.16, 0.15
    for s in (-1, 1):
        box('CkFrame', Fc, s * W / 2 - 0.006, s * W / 2 + 0.006, (top + 0.075) - base - 0.005, H, -0.006, 0.006)
    box('CkFrame', Fc, -W / 2 - 0.006, W / 2 + 0.006, H - 0.008, H + 0.004, -0.006, 0.006)
    P = Part('HUD_GLASS')
    P.g('Glass').face([(-W / 2, 0, 0), (W / 2, 0, 0), (W / 2, H - 0.008, 0), (-W / 2, H - 0.008, 0)], [(0, 0), (1, 0), (1, 1), (0, 1)], (0, 0, 1))
    R.node('HUD_GLASS', P, at(Fc, 0, 0, 0), 0.0, hud_tilt)
    # the standby compass on the bow or the glareshield, the canopy jettison handle beside the HUD
    box('Yellow', frame((0.3, top - 0.02, lip + 0.02)), -0.02, 0.02, -0.008, 0.008, -0.03, 0.0)
    label('CANOPY JETT', frame((0.3, top - 0.008, lip + 0.02), tilt=0.6), 0, 0.012, h=0.006, st='y')

# ═════════════ canopy ═════════════
CANOPY_C, CANOPY_R = (0.0, SILL_Y, -0.15), (0.455, 0.56, 1.05)
def canopy_at(z, t):
    """a point on the canopy's cross-section at z: t 0 the right sill … 0.5 the top … 1 the left sill"""
    cz = (z - CANOPY_C[2]) / CANOPY_R[2]
    k = math.sqrt(max(0.0, 1 - cz * cz))
    a = PI * t
    return (math.cos(a) * CANOPY_R[0] * k, CANOPY_C[1] + math.sin(a) * CANOPY_R[1] * k, z)
def bow(z, w=0.055, d=0.03, rivets=True):
    n = 18
    pts = [canopy_at(z, i / n) for i in range(n + 1)]
    for a, b in zip(pts, pts[1:]):
        S.beam('CkFrame', (a[0] * 0.985, a[1] - 0.01, a[2]), (b[0] * 0.985, b[1] - 0.01, b[2]), w, d)
    if rivets:
        for i in range(1, 3 * n):
            p = canopy_at(z, i / (3 * n))
            c = (p[0] * 0.955, CANOPY_C[1] + (p[1] - CANOPY_C[1]) * 0.955 - 0.01, z + d / 2 + 0.0005)
            R.ocyl(S, 'Metal', R.mat3(0, 0), c, (0, 0, 0), 0.0024, 0.0018, 0.0, 0.0012, 6)
    return pts
def canopy():
    # the bubble: from sill to sill over the head, open at the bottom (no cap across the cockpit)
    P = Part('CANOPY_GLASS')
    nz, nt = 30, 16
    zs = [CANOPY_C[2] - CANOPY_R[2] * 0.995 + (2 * CANOPY_R[2] * 0.995) * i / nz for i in range(nz + 1)]
    for i in range(nz):
        for j in range(nt):
            q = [canopy_at(zs[i], j / nt), canopy_at(zs[i + 1], j / nt), canopy_at(zs[i + 1], (j + 1) / nt), canopy_at(zs[i], (j + 1) / nt)]
            c = [sum(p[k] for p in q) / 4 for k in range(3)]
            P.g('Glass').face(q, None, (c[0], c[1] - CANOPY_C[1], (c[2] - CANOPY_C[2]) * 0.3), True)
    R.node('CANOPY_GLASS', P, (0, 0, 0))
    # the aft bow behind the head (both canopies), its handholds; the windscreen bow (hornet) with the mirrors
    bow(0.42, 0.06, 0.035)
    for s in (-1, 1):
        a = canopy_at(0.42, 0.5 + s * 0.28)
        S.beam('Yellow', (a[0] * 0.9, a[1] - 0.05, 0.40), (a[0] * 0.8, a[1] - 0.08, 0.40), 0.014, 0.014)
    if L['bow']:
        pts = bow(-0.88, 0.05, 0.032)
        # three rear-view mirrors on the bow, angled back at the pilot
        for t in (0.5, 0.33, 0.67)[:L['mirrors']]:
            p = canopy_at(-0.88, t)
            Fm = frame((p[0] * 0.9, p[1] - 0.045, -0.86), yaw=(t - 0.5) * 1.3, tilt=-0.15)
            box('CkFrame', Fm, -0.04, 0.04, -0.012, 0.012, -0.008, 0.0)
            box('Chrome', Fm, -0.037, 0.037, -0.009, 0.009, 0.0, 0.0015)
    else:
        # the F-16's one-piece canopy: no bow; its mirrors on short brackets on the canopy rails, ahead of the pilot
        for s in ((-1, 1) if L['mirrors'] else ()):
            Fm = frame((s * 0.385, SILL_Y + 0.09, -0.5), yaw=-s * 0.75, tilt=-0.1)
            box('CkFrame', Fm, -0.04, 0.04, -0.013, 0.013, -0.009, 0.0)
            box('Chrome', Fm, -0.037, 0.037, -0.01, 0.01, 0.0, 0.0015)
            S.beam('CkFrame', at(Fm, 0, -0.013, -0.005), (s * 0.42, SILL_Y + 0.025, -0.5), 0.01, 0.01)

# ═════════════ the seat ═════════════
def seat():
    zb = 0.2             # the seat back's face
    Fb = frame((0, 0, 0))
    SEAT = 'CkSeatK' if L['seat'] == 'k36' else 'CkSeat'
    # the bucket: sides, pan, back; cushions; the headbox behind the head (clear of it: the head is ~0.1 m behind the eye)
    for s in (-1, 1):
        box(SEAT, Fb, s * 0.235 - 0.02, s * 0.235 + 0.02, -0.98, -0.6, -0.32, zb + 0.06)
        box('Black', Fb, s * 0.258 - 0.0015, s * 0.258 + 0.0015, -0.94, -0.64, -0.3, zb)
    box(SEAT, Fb, -0.235, 0.235, -0.9, -0.84, -0.34, zb)
    box('CkCushion', Fb, -0.21, 0.21, -0.84, -0.79, -0.3, zb - 0.02)
    box(SEAT, Fb, -0.24, 0.24, -0.84, 0.0, zb + 0.02, zb + 0.12)
    box('CkCushion', Fb, -0.2, 0.2, -0.78, -0.12, zb - 0.03, zb + 0.02)
    # headbox (the parachute container), its warning stripes, the drogue chute
    box(SEAT, Fb, -0.17, 0.17, -0.06, 0.2, zb - 0.02, zb + 0.18)
    box('CkCushion', Fb, -0.11, 0.11, -0.1, 0.06, zb - 0.06, zb - 0.02)
    for i in range(6):
        box('Yellow' if i % 2 else 'Black', Fb, -0.17 + i * 0.0567, -0.17 + (i + 1) * 0.0567, 0.17, 0.2, zb - 0.0225, zb - 0.0195)
    # the harness: shoulder straps over the cushion, lap belts, the quick-release box
    for s in (-1, 1):
        S.beam('CkStrap', (s * 0.08, -0.12, zb - 0.035), (s * 0.06, -0.56, zb - 0.08), 0.045, 0.006)
        S.beam('CkStrap', (s * 0.2, -0.78, zb - 0.1), (s * 0.04, -0.74, -0.12), 0.045, 0.006)
    box('Metal', Fb, -0.03, 0.03, -0.75, -0.72, -0.15, -0.1)
    # the ejection handle: between the knees (Martin-Baker) or on the seat sides (ACES II)
    if L['seat'] in ('mk14', 'k36'):
        col = 'Orange' if L['seat'] == 'k36' else 'Yellow'
        R._tube(S, (-0.06, -0.78, -0.3), (0.06, -0.78, -0.3), 0.012, col, 8)
        for s in (-1, 1):
            R._tube(S, (s * 0.06, -0.78, -0.3), (s * 0.06, -0.84, -0.27), 0.012, col, 8)
        for i in range(4):
            S.beam('Black', (-0.05 + i * 0.033, -0.775, -0.3), (-0.05 + i * 0.033 + 0.012, -0.775, -0.3), 0.026, 0.026)
    else:
        for s in (-1, 1):
            Fh = frame((s * 0.26, -0.76, -0.18), yaw=0.0, tilt=0.4)
            box('Yellow', Fh, -0.012, 0.012, -0.045, 0.045, 0.0, 0.03)
            for i in range(3):
                box('Black', Fh, -0.0125, 0.0125, -0.04 + i * 0.03, -0.03 + i * 0.03, 0.0, 0.0305)

# ═════════════ the controls (nodes) ═════════════
def stick():
    P = Part('STICK')
    if L['stick'] == 'centre':
        # centre stick: the boot, the shaft, the grip with its trigger, pickle and castle switch
        P.cyl('Rubber', (0, 0, 0), 0.06, 0.03, 0.0, 0.07, 14)
        P.cyl('CkFrame', (0, 0, 0), 0.012, 0.012, 0.07, 0.34, 10)
        P.sphere('Black', (0, 0.4, 0.0), 0.023, 0.07, 0.027, 14, 10)
        P.box('Black', -0.012, 0.012, 0.33, 0.37, -0.04, -0.015)                   # trigger guard
        P.box('Red', -0.006, 0.006, 0.455, 0.47, -0.012, 0.006)                     # pickle
        P.cyl('Chrome', (0.0, 0.0, -0.012), 0.005, 0.005, 0.43, 0.445, 8)            # castle
        P.box('CkBtn', 0.016, 0.026, 0.42, 0.435, -0.01, 0.0)                       # trim hat
        R.node('STICK', P, (0, FLOOR_Y + 0.08, -0.36), tilt=-0.08)
    else:
        # F-16 side-stick: a force sensor under the grip, the grip on the right console, the armrest behind it
        P.box('Metal', -0.02, 0.02, 0.0, 0.03, -0.03, 0.03)
        P.sphere('Black', (0, 0.09, 0), 0.022, 0.065, 0.028, 14, 10)
        P.box('Red', -0.006, 0.006, 0.15, 0.162, -0.01, 0.006)
        P.cyl('Chrome', (0.0, 0.0, -0.014), 0.005, 0.005, 0.135, 0.15, 8)
        P.box('Black', -0.012, 0.012, 0.06, 0.09, -0.04, -0.018)
        R.node('STICK', P, (0.335, CONS_Y + 0.005, -0.12), tilt=-0.12)
        box('CkCushion', frame((0, 0, 0)), 0.28, 0.4, CONS_Y, CONS_Y + 0.05, 0.0, 0.18)                   # armrest
    # the throttle on the left console: lever and grip with its switches
    T = Part('THROTTLE')
    T.box('CkFrame', -0.008, 0.008, 0.0, 0.085, -0.008, 0.008)
    T.box('Black', -0.025, 0.03, 0.08, 0.135, -0.035, 0.035)
    T.cyl('Chrome', (0.031, 0.105, 0.0), 0.004, 0.004, 0.0, 0.012, 8, axis='x')
    T.box('CkBtn', -0.026, -0.018, 0.12, 0.13, -0.02, 0.0)
    T.box('Red', -0.004, 0.004, 0.135, 0.14, 0.0, 0.015)
    R.node('THROTTLE', T, (-0.335, CONS_Y, -0.1))

# ═════════════ UVs, ambient occlusion, export ═════════════
def box_uv(ob):
    """UVs in metres by box projection (the faces built without UVs): the tiled textures read at their real scale"""
    me = ob.data
    uvl = me.uv_layers[0]
    for poly in me.polygons:
        n = poly.normal
        ax = max(range(3), key=lambda i: abs(n[i]))
        for li in poly.loop_indices:
            co = me.vertices[me.loops[li].vertex_index].co
            u, v = ((co.y, co.z) if ax == 0 else (co.x, co.z) if ax == 1 else (co.x, co.y))
            uvl.data[li].uv = (u, v)

def bake_ao(objs, px, out_img):
    """one AO image over every static mesh (a fresh, packed second UV set 'AO'), wired as the glTF occlusion
    texture of each material"""
    sc = bpy.context.scene
    for ob in objs:
        if 'AO' not in ob.data.uv_layers:
            ob.data.uv_layers.new(name='AO')
        ob.data.uv_layers.active = ob.data.uv_layers['AO']
    bpy.ops.object.select_all(action='DESELECT')
    for ob in objs:
        ob.select_set(True)
    bpy.context.view_layer.objects.active = objs[0]
    bpy.ops.object.mode_set(mode='EDIT')
    bpy.ops.mesh.select_all(action='SELECT')
    bpy.ops.uv.smart_project(angle_limit=math.radians(55), island_margin=0.004, area_weight=0.0, correct_aspect=True, scale_to_bounds=False)
    try:
        bpy.ops.uv.pack_islands(rotate=True, margin=0.004)
    except Exception as e:
        print('pack', e)
    bpy.ops.object.mode_set(mode='OBJECT')
    img = bpy.data.images.new('cockpit_ao', px, px, alpha=False)
    img.generated_color = (1, 1, 1, 1)
    mats = {m for ob in objs for m in ob.data.materials if m}
    nodes = []
    for m in mats:
        nt = m.node_tree
        t = nt.nodes.new('ShaderNodeTexImage'); t.image = img
        nt.nodes.active = t
        nodes.append((m, t))
    sc.render.engine = 'CYCLES'
    sc.cycles.samples = SAMPLES
    sc.cycles.device = 'CPU'
    if not sc.world:
        sc.world = bpy.data.worlds.new('w')
    sc.world.light_settings.distance = 0.12   # (AO reach: contact shadows of switches, panels, the tub's corners)
    sc.render.bake.margin = 6
    bpy.ops.object.bake(type='AO', use_selected_to_active=False)
    img.filepath_raw = out_img
    img.file_format = 'JPEG'
    sc.render.image_settings.quality = 88
    img.save()
    # wire it as glTF occlusion: a "glTF Material Output" group with an Occlusion input, the image through UV 'AO'
    grp = bpy.data.node_groups.get('glTF Material Output')
    if grp is None:
        grp = bpy.data.node_groups.new('glTF Material Output', 'ShaderNodeTree')
        grp.interface.new_socket('Occlusion', in_out='INPUT', socket_type='NodeSocketFloat')
    for m, t in nodes:
        nt = m.node_tree
        uvn = nt.nodes.new('ShaderNodeUVMap'); uvn.uv_map = 'AO'
        nt.links.new(uvn.outputs['UV'], t.inputs['Vector'])
        sep = nt.nodes.new('ShaderNodeSeparateColor')
        nt.links.new(t.outputs['Color'], sep.inputs['Color'])
        g = nt.nodes.new('ShaderNodeGroup'); g.node_tree = grp
        nt.links.new(sep.outputs['Red'], g.inputs['Occlusion'])
    for ob in objs:
        ob.data.uv_layers.active = ob.data.uv_layers[0]
        ob.data.uv_layers[0].active_render = True

def preview(dirpath):
    sc = bpy.context.scene
    sc.render.engine = 'BLENDER_EEVEE_NEXT' if 'BLENDER_EEVEE_NEXT' in [e.identifier for e in bpy.types.RenderSettings.bl_rna.properties['engine'].enum_items] else 'BLENDER_EEVEE'
    cam = bpy.data.cameras.new('c'); cam.lens_unit = 'FOV'; cam.angle = math.radians(85); cam.clip_start = 0.01
    co = bpy.data.objects.new('c', cam); sc.collection.objects.link(co); sc.camera = co
    if not sc.world:
        sc.world = bpy.data.worlds.new('w')
    sc.world.use_nodes = True
    sc.world.node_tree.nodes['Background'].inputs[0].default_value = (0.55, 0.65, 0.8, 1)
    sc.world.node_tree.nodes['Background'].inputs[1].default_value = 1.2
    Ls = bpy.data.lights.new('sun', 'SUN'); Ls.energy = 3.5
    lo = bpy.data.objects.new('sun', Ls); sc.collection.objects.link(lo); lo.rotation_euler = (0.7, 0.3, 2.6)
    sc.render.resolution_x, sc.render.resolution_y = 1280, 720
    os.makedirs(dirpath, exist_ok=True)
    for name, tgt in [('fwd', (0, -0.25, -1)), ('down', (0, -0.75, -0.8)), ('left', (-0.8, -0.55, -0.4)), ('right', (0.8, -0.55, -0.4)), ('back', (0.3, -0.2, 1))]:
        co.location = V((0, 0, 0))
        d = V(tgt)
        co.rotation_euler = d.to_track_quat('-Z', 'Y').to_euler()
        sc.render.filepath = os.path.join(dirpath, name + '.png')
        bpy.ops.render.render(write_still=True)

# ═════════════ build ═════════════
tub()
consoles()
panel()
glareshield_hud()
canopy()
seat()
stick()

static_objs = []
for key, P in R.STATIC.items():
    if P.tris() == 0:
        continue
    ob = P.build(parent=R.ROOT)
    box_uv(ob)
    static_objs.append(ob)
tris = sum(P.tris() for P in R.STATIC.values())
if AO_PX:
    bake_ao(static_objs, AO_PX, os.path.splitext(OUT)[0] + '_ao.jpg')
if PREVIEW:
    preview(PREVIEW)
R.ROOT['cockpit'] = json.dumps({'layout': LAYOUT, 'screens': len(SCREENS)}, separators=(',', ':'))
os.makedirs(os.path.dirname(os.path.abspath(OUT)), exist_ok=True)
bpy.ops.export_scene.gltf(filepath=OUT, export_format='GLB', export_extras=True, export_yup=True,
                          export_materials='EXPORT', export_image_format='JPEG', export_jpeg_quality=88, export_cameras=False, export_lights=False)
print('exported', OUT, os.path.getsize(OUT) // 1024, 'KB · static tris ~', tris, '· screens', len(SCREENS), '· labels', len(R.LABELS))
