# ═══════════════════════════════════════════════════════════════
# Nimitz-class carrier: the Combat Direction Center (CDC — a carrier's CIC) — scripted model for Blender (headless):
#   blender -b -P tools/interiors/cvn_cic.py -- models/interiors/cvn_cic.glb
# Room frame: floor centre at the origin, x starboard, y up, −z forward (toward the bow). A closed room (the game draws
# only it), lit dim blue: a blue hemisphere and blue-white points in the room's 'lights', 'LightBlue' strip fixtures.
# Where it sits: on the O-3 gallery deck, just under the flight deck (flight deck at ship y 19). The room's origin is at
# ship-local (−6, 13.0, 20) of models/ships/carrier.glb (x starboard, y up from the waterline, z aft), axes parallel
# to the ship's (the room's −z is the bow).
# References (US Navy photographs and their captions; the layout is estimated from them):
#   • https://en.wikipedia.org/wiki/Combat_information_center — on US carriers the CIC is the Combat Direction Center
#   • https://commons.wikimedia.org/wiki/Category:Combat_Direction_Center_of_USS_Ronald_Reagan_(CVN-76) and
#     https://commons.wikimedia.org/wiki/Category:Combat_Direction_Center_of_USS_George_Washington_(CVN-73): the watch
#     stations the captions name — tactical action officer (TAO), air defense warfare coordinator (ADWC), ship's
#     weapons coordinator, tactical information coordinator (TIC), auto track manager / identification operator, air
#     intercept and strike controllers, the Air Operations Officer, a surface tracer at a Q-70 in "tactical operations
#     plotting", the (digital) dead reckoning tracker and maneuvering-board plotting, GCCS and Link 11 consoles in the
#     "display and tracking module", the "undersea warfare module", the "air events board" and plot boards (clear,
#     edge-lit status boards written on from behind, in grease pencil)
#   • https://en.wikipedia.org/wiki/Ship_Self-Defense_System — SSDS Mk 2 (SPS-48 / SPS-49, SLQ-32, RAM, ESSM, CEC)
#   • https://en.wikipedia.org/wiki/AN/UYQ-70 — the "Q-70" display console (about 0.9 m wide, two stacked flat panels)
# Layout (18 m × 12 m, 2.6 m to the overhead; estimated):
#   • forward bulkhead: three large screen displays (LSDs) over a cabinet row; clocks, the threat-warning panel,
#     repeater displays, a weapons status board
#   • forward port: the air module — two rows of Q-70s facing forward (ADWC, ATM/ID, AIC, strike controller, air ops,
#     ship's weapons coordinator); on the port bulkhead the air events and CAP boards (a walkway behind them)
#   • forward starboard: the surface module (Q-70s), the DRT plotting table, the surface tracer; on the starboard
#     bulkhead the surface status board
#   • centre: the display & tracking module (low consoles: GCCS-M, Link 11/16, TIC) — the TAO looks over them
#   • centre aft: the TAO dais (0.2 m): the CDC watch officer, the TAO's dual console, the strike console
#   • aft port: the undersea warfare module behind low partitions; aft starboard: the EW alcove (SLQ-32)
#   • aft bulkhead: the watertight doors (flight deck / O-3 ladder, the ladder to Pri-Fly), racks, a safe, the coffee
#   • overhead: deck beams, cable trays, ventilation ducts and diffusers, the pipe runs along the sides, blue strip
#     lights, hanging module signs and monitors, speakers
# Build notes: repeated assemblies (the Q-70 consoles, the chairs) are one mesh shared by many nodes, and static
# geometry of untextured materials is exported without UVs — both keep the GLB small (see finish()).
# ═══════════════════════════════════════════════════════════════
import sys, os, math, json, random
sys.dont_write_bytecode = True
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import roomkit as R
from roomkit import PI
import bpy
from mathutils import Vector
from shipkit import Part, V, MATS, material, srgb, point_in_poly

args = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
OUT = args[0] if args else 'models/interiors/cvn_cic.glb'

R.begin()
S = R.static()
X0, X1, Z0, Z1, H = -9.0, 9.0, -6.0, 6.0, 2.6
DAIS = (-2.7, 2.7, 0.9, 4.0, 0.2)          # the TAO dais: x0, x1, z0, z1, height
rnd = random.Random(76)

# ═════════════ local helpers (roomkit is shared; this room's extras live here) ═════════════
# materials the game textures (src/warrooms.js ROOM_MATERIALS) or that need 0..1 UVs keep their UVs; the rest don't
TEXTURED = {'Deck', 'DeckTile', 'Carpet', 'Wall', 'WallDark', 'Ceiling', 'Panel', 'Concrete', 'ScreenArt', 'Label'}
def textured(m):
    return m in TEXTURED or m.startswith('Console')

def bx(P, mat, x0, x1, y0, y1, z0, z1, skip=('bottom',)):
    """an axis-aligned box (UVs in metres); the bottom is left out unless asked for"""
    R.uvbox(P, mat, min(x0, x1), max(x0, x1), min(y0, y1), max(y0, y1), min(z0, z1), max(z0, z1), skip)

def ob(P, mat, M, o, x0, x1, y0, y1, z0, z1, skip=('bottom',)):
    R.obox(P, mat, M, o, x0, x1, y0, y1, z0, z1, skip)

def add_part(S, P, pos=(0, 0, 0), yaw=0.0):
    """copy a Part modelled at the origin into S, turned by yaw about y and moved to pos"""
    M = R.mat3(yaw)
    for mname, g in P.geo.items():
        G = S.g(mname)
        for idx, uvs, sm in g.faces:
            G.face([R.xf(M, pos, g.verts[i]) for i in idx], uvs, None, sm)

PROTOS, INST = {}, []
def inst(key, build, pos, yaw=0.0):
    """a copy of a shared mesh (built once by build(Part) in its own frame): glTF stores the mesh once"""
    if key not in PROTOS:
        P = Part('proto_' + key)
        build(P)
        me = P.mesh()
        if not any(textured(m) for m in P.geo):
            me.uv_layers.remove(me.uv_layers[0])
        PROTOS[key] = (me, P.tris())
    o = bpy.data.objects.new('%s_%d' % (key, len(INST)), PROTOS[key][0])
    bpy.context.collection.objects.link(o)
    o.location = V(pos)
    o.rotation_mode = 'QUATERNION'
    o.rotation_quaternion = R.qrot(yaw)
    o.parent = R.ROOT
    INST.append(key)
    return o

def art(S, c, yaw, tilt, w, h, k):
    """a decorative screen: one of the game's eight static console pictures (warrooms.js screenArt: 0 track mgmt,
    1 surface plot, 2 broadband, 3 comms, 4 system status, 5 tactical, 6 link 16, 7 nav data)"""
    if 'ScreenArt' not in MATS:
        material('ScreenArt', srgb(0xffffff), 0.0, 0.3)
    k = int(k) % 8
    u0, v0 = (k % 4) / 4, (k // 4) / 2
    R.oquad(S, 'ScreenArt', R.mat3(yaw, tilt), c, -w / 2, w / 2, -h / 2, h / 2, 0.0,
            uv=[(u0, v0), (u0 + 0.25, v0), (u0 + 0.25, v0 + 0.5), (u0, v0 + 0.5)])

def display(S, spec, c, yaw, tilt, w, h, px=None, bright=None):
    """a screen face at c: spec 'screen_…' (live canvas), an int (art picture) or None (dark glass)"""
    if isinstance(spec, str):
        return R.screen(spec, c, yaw, tilt, w, h, px, bright)
    if spec is None:
        R.oquad(S, 'Screen', R.mat3(yaw, tilt), c, -w / 2, w / 2, -h / 2, h / 2, 0.0)
    else:
        art(S, c, yaw, tilt, w, h, spec)
    return None

def zy_slab(P, mat, x0, x1, poly):
    """a (z, y) outline (convex or not) extruded along x from x0 to x1 — a console's side cheek"""
    P.g(mat).face([(x0, y, z) for z, y in poly], [(z, y) for z, y in poly], (-1, 0, 0))
    P.g(mat).face([(x1, y, z) for z, y in poly], [(z, y) for z, y in poly], (1, 0, 0))
    n = len(poly)
    for i in range(n):
        (za, ya), (zb, yb) = poly[i], poly[(i + 1) % n]
        dz, dy = zb - za, yb - ya
        L = math.hypot(dz, dy)
        if L < 1e-6:
            continue
        nz, ny = dy / L, -dz / L
        if point_in_poly((za + zb) / 2 + nz * 0.004, (ya + yb) / 2 + ny * 0.004, poly):
            nz, ny = -nz, -ny
        q = [(x0, ya, za), (x1, ya, za), (x1, yb, zb), (x0, yb, zb)]
        P.g(mat).face(q, [(p[0], p[1] + p[2]) for p in q], (0, ny, nz))

def facade(P, mat, x0, x1, prof):
    """quads across x up a (z, y) profile, facing the operator (+z / up)"""
    for (za, ya), (zb, yb) in zip(prof, prof[1:]):
        q = [(x0, ya, za), (x1, ya, za), (x1, yb, zb), (x0, yb, zb)]
        P.g(mat).face(q, [(p[0], p[1] - p[2]) for p in q], (0, -(zb - za), yb - ya))

# ── grease pencil: a small stroke alphabet (cell 0.6 × 1), written on the status boards ──
_BOX = [(0, 0), (0.6, 0), (0.6, 1), (0, 1), (0, 0)]
FONT = {
    '0': [_BOX, [(0.05, 0.1), (0.55, 0.9)]], '1': [[(0.15, 0.8), (0.32, 1), (0.32, 0)]], '2': [[(0.02, 0.8), (0.3, 1), (0.6, 0.78), (0, 0), (0.6, 0)]],
    '3': [[(0, 1), (0.6, 1), (0.25, 0.55), (0.6, 0.35), (0.45, 0), (0, 0.05)]], '4': [[(0.45, 0), (0.45, 1), (0, 0.32), (0.6, 0.32)]],
    '5': [[(0.6, 1), (0.08, 1), (0.02, 0.56), (0.35, 0.62), (0.58, 0.45), (0.58, 0.15), (0.35, 0), (0, 0.06)]], '6': [[(0.5, 1), (0.02, 0.45), (0.1, 0), (0.55, 0.05), (0.55, 0.45), (0.05, 0.4)]],
    '7': [[(0, 1), (0.6, 1), (0.18, 0)]], '8': [[(0.3, 0.52), (0.02, 0.78), (0.3, 1), (0.58, 0.78), (0.3, 0.52), (0, 0.22), (0.3, 0), (0.6, 0.22), (0.3, 0.52)]],
    '9': [[(0.58, 0.55), (0.05, 0.6), (0.1, 1), (0.58, 1), (0.5, 0)]],
    'A': [[(0, 0), (0.3, 1), (0.6, 0)], [(0.13, 0.42), (0.47, 0.42)]], 'B': [[(0, 0), (0, 1), (0.48, 0.95), (0.5, 0.55), (0, 0.52)], [(0.5, 0.55), (0.6, 0.1), (0, 0)]],
    'C': [[(0.6, 0.85), (0.45, 1), (0.15, 1), (0, 0.8), (0, 0.2), (0.15, 0), (0.45, 0), (0.6, 0.15)]], 'D': [[(0, 0), (0, 1), (0.4, 0.95), (0.6, 0.5), (0.4, 0.03), (0, 0)]],
    'E': [[(0.6, 1), (0, 1), (0, 0), (0.6, 0)], [(0, 0.52), (0.45, 0.52)]], 'F': [[(0.6, 1), (0, 1), (0, 0)], [(0, 0.52), (0.45, 0.52)]],
    'G': [[(0.6, 0.85), (0.45, 1), (0.15, 1), (0, 0.8), (0, 0.2), (0.15, 0), (0.45, 0), (0.6, 0.2), (0.6, 0.45), (0.3, 0.45)]], 'H': [[(0, 0), (0, 1)], [(0.6, 0), (0.6, 1)], [(0, 0.52), (0.6, 0.52)]],
    'I': [[(0.3, 0), (0.3, 1)], [(0.1, 1), (0.5, 1)], [(0.1, 0), (0.5, 0)]], 'J': [[(0.6, 1), (0.55, 0.05), (0.05, 0), (0, 0.3)]],
    'K': [[(0, 0), (0, 1)], [(0.6, 1), (0.02, 0.45), (0.6, 0)]], 'L': [[(0, 1), (0, 0), (0.6, 0)]], 'M': [[(0, 0), (0, 1), (0.3, 0.45), (0.6, 1), (0.6, 0)]],
    'N': [[(0, 0), (0, 1), (0.6, 0), (0.6, 1)]], 'O': [[(0.15, 0), (0.45, 0), (0.6, 0.2), (0.6, 0.8), (0.45, 1), (0.15, 1), (0, 0.8), (0, 0.2), (0.15, 0)]], 'P': [[(0, 0), (0, 1), (0.55, 0.97), (0.58, 0.55), (0, 0.5)]],
    'Q': [_BOX, [(0.35, 0.3), (0.7, -0.1)]], 'R': [[(0, 0), (0, 1), (0.55, 0.97), (0.58, 0.55), (0, 0.5), (0.6, 0)]],
    'S': [[(0.6, 0.86), (0.45, 1.0), (0.12, 0.98), (0.0, 0.8), (0.1, 0.6), (0.5, 0.44), (0.6, 0.22), (0.47, 0.02), (0.1, 0.0), (0.0, 0.14)]], 'T': [[(0, 1), (0.6, 1)], [(0.3, 1), (0.3, 0)]],
    'U': [[(0, 1), (0, 0.2), (0.15, 0), (0.45, 0), (0.6, 0.2), (0.6, 1)]], 'V': [[(0, 1), (0.3, 0), (0.6, 1)]], 'W': [[(0, 1), (0.13, 0), (0.3, 0.6), (0.47, 0), (0.6, 1)]],
    'X': [[(0, 0), (0.6, 1)], [(0, 1), (0.6, 0)]], 'Y': [[(0, 1), (0.3, 0.5), (0.6, 1)], [(0.3, 0.5), (0.3, 0)]], 'Z': [[(0, 1), (0.6, 1), (0, 0), (0.6, 0)]],
    '/': [[(0, 0), (0.6, 1)]], '-': [[(0.1, 0.5), (0.5, 0.5)]], '+': [[(0.05, 0.5), (0.55, 0.5)], [(0.3, 0.25), (0.3, 0.75)]],
    ':': [[(0.3, 0.2), (0.3, 0.32)], [(0.3, 0.68), (0.3, 0.8)]], '.': [[(0.3, 0), (0.3, 0.1)]], '>': [[(0.05, 0.9), (0.55, 0.5), (0.05, 0.1)]],
    '<': [[(0.55, 0.9), (0.05, 0.5), (0.55, 0.1)]], '*': [[(0.05, 0.5), (0.55, 0.5)], [(0.15, 0.15), (0.45, 0.85)], [(0.15, 0.85), (0.45, 0.15)]],
}
def scrawl(S, text, o, eu, ev, h=0.05, mat='LampAmber', seed=1, slant=0.15, adv=0.82, lift=0.004, t=None):
    """handwriting in thin strokes on a plane: o = the start of the baseline, eu along the line, ev up (the strokes face
    eu × ev). Each stroke is one strip with mitred joints (its quads share their vertices). Returns the length written"""
    eu, ev = Vector(eu).normalized(), Vector(ev).normalized()
    n = eu.cross(ev)
    t = t or h * 0.13
    rr = random.Random(seed)
    base = Vector(o) + n * lift
    W = lambda u, v: tuple(base + eu * u + ev * v)
    x = 0.0
    for ch in text.upper():
        strokes = FONT.get(ch)
        if strokes:
            jx, jy, sc = rr.uniform(-0.06, 0.06) * h, rr.uniform(-0.07, 0.07) * h, h * rr.uniform(0.9, 1.06)
            for poly in strokes:
                pts = [(x + (px + py * slant) * sc + jx, py * sc + jy) for px, py in poly]
                closed = len(pts) > 2 and math.hypot(pts[0][0] - pts[-1][0], pts[0][1] - pts[-1][1]) < 1e-9
                if closed:
                    pts = pts[:-1]
                m = len(pts)
                segs = m if closed else m - 1
                dirs = []
                for i in range(segs):
                    (ax, ay), (bx_, by) = pts[i], pts[(i + 1) % m]
                    L = math.hypot(bx_ - ax, by - ay) or 1e-9
                    dirs.append(((bx_ - ax) / L, (by - ay) / L))
                offs = []
                for i in range(m):
                    d0 = dirs[i - 1] if (closed or i > 0) else dirs[0]
                    d1 = dirs[i % segs] if (closed or i < segs) else dirs[-1]
                    n0, n1 = (-d0[1], d0[0]), (-d1[1], d1[0])
                    mx, my = n0[0] + n1[0], n0[1] + n1[1]
                    ml = math.hypot(mx, my)
                    if ml < 1e-6:
                        mx, my, k = n1[0], n1[1], 1.0
                    else:
                        mx, my = mx / ml, my / ml
                        k = min(1.0 / max(mx * n1[0] + my * n1[1], 1e-3), 2.2)
                    offs.append((mx * k * t / 2, my * k * t / 2))
                if not closed:
                    pts[0] = (pts[0][0] - dirs[0][0] * t / 2, pts[0][1] - dirs[0][1] * t / 2)
                    pts[-1] = (pts[-1][0] + dirs[-1][0] * t / 2, pts[-1][1] + dirs[-1][1] * t / 2)
                for i in range(segs):
                    j = (i + 1) % m
                    (ax, ay), (bx_, by), (oax, oay), (obx, oby) = pts[i], pts[j], offs[i], offs[j]
                    q = [(ax - oax, ay - oay), (bx_ - obx, by - oby), (bx_ + obx, by + oby), (ax + oax, ay + oay)]
                    S.g(mat).face([W(u, v) for u, v in q], None, tuple(n))
        x += adv * h
    return x

def switches(S, M, o, cols=6, rows=2, pitch=0.04, seed=0):
    """a panel of bat toggles and square lamps (static detail): one bezel plate, then the cells"""
    rr = random.Random(seed)
    w, h = cols * pitch, rows * pitch
    ob(S, 'Bezel', M, o, -w / 2, w / 2, -h / 2, h / 2, 0.0, 0.004, skip=('nz',))
    for r in range(rows):
        for k in range(cols):
            x, y = (k - (cols - 1) / 2) * pitch, (r - (rows - 1) / 2) * pitch
            if (k + r * 2) % 3 == 0:
                R.oquad(S, 'LampGreen' if rr.random() < 0.7 else 'LampAmber', M, o, x - 0.008, x + 0.008, y - 0.008, y + 0.008, 0.0046)
            else:
                S.beam('Chrome', R.xf(M, o, (x, y, 0.004)), R.xf(M, o, (x, y - 0.006, 0.024)), 0.0055, caps=False)

# ═════════════ the Q-70 console (one mesh, many copies) ═════════════
# local frame: operator at +z looking −z, origin on the deck at the front of the cabinet; the back at z −0.53
Q_SW, Q_SH = 0.50, 0.3125                                    # a Q-70 flat panel (16:10: the 768 × 480 canvases)
LO = (math.atan2(0.20, 0.34), (0.0, 0.95, -0.14))           # the lower display: its lean-back and face centre
UP = (math.atan2(0.04, 0.40), (0.0, 1.36, -0.28))           # the upper display
PROF_TALL = [(0.0, 0.73), (-0.04, 0.78), (-0.24, 1.12), (-0.26, 1.16), (-0.30, 1.56)]
PROF_LOW = [(0.0, 0.73), (-0.04, 0.78), (-0.24, 1.12)]
CHEEK_TALL = [(-0.53, 0.73), (0.03, 0.73), (-0.005, 0.78), (-0.205, 1.12), (-0.225, 1.16), (-0.265, 1.645), (-0.53, 1.645)]
CHEEK_LOW = [(-0.53, 0.73), (0.03, 0.73), (-0.005, 0.78), (-0.2, 1.12), (-0.215, 1.2), (-0.53, 1.2)]

def keyboard(P, cx, cz, y=0.73, w=0.44, d=0.16):
    bx(P, 'Black', cx - w / 2, cx + w / 2, y, y + 0.016, cz - d / 2, cz + d / 2)
    kw = (w - 0.03) / 12
    x0 = cx - w / 2 + 0.015
    for r in range(4):
        z = cz - d / 2 + 0.012 + r * 0.028
        for k in range(12):
            x = x0 + k * kw
            bx(P, 'Panel', x + 0.002, x + kw - 0.002, y + 0.016, y + 0.025, z + 0.002, z + 0.025)
    z = cz - d / 2 + 0.012 + 4 * 0.028
    for (a, b) in ((0, 1.5), (1.5, 3.0), (3.0, 9.0), (9.0, 10.5), (10.5, 12)):
        bx(P, 'Panel', x0 + a * kw + 0.002, x0 + b * kw - 0.002, y + 0.016, y + 0.025, z + 0.002, z + 0.025)

def trackball(P, cx, cz, y=0.73):
    bx(P, 'Black', cx - 0.055, cx + 0.055, y, y + 0.022, cz - 0.07, cz + 0.07)
    P.sphere('ConsoleBlue', (cx, y + 0.02, cz - 0.012), 0.027, 0.027, 0.027, 12, 6, v0=0.45)
    for sx in (-0.03, 0.03):
        bx(P, 'Panel', cx + sx - 0.017, cx + sx + 0.017, y + 0.022, y + 0.028, cz + 0.03, cz + 0.06)

def headset(P, x, y, z, side):
    """a headset hung on a hook on a console's side (side ±1: the side it hangs on)"""
    bx(P, 'Black', x, x + side * 0.03, y - 0.01, y + 0.01, z - 0.01, z + 0.01, skip=())
    for dz in (-0.075, 0.075):
        bx(P, 'Black', x + side * 0.01, x + side * 0.05, y - 0.16, y - 0.07, z + dz - 0.04, z + dz + 0.04, skip=())
    pts = [(x + side * 0.03, y - 0.08, z - 0.075), (x + side * 0.03, y, z - 0.04), (x + side * 0.03, y + 0.01, z + 0.04), (x + side * 0.03, y - 0.08, z + 0.075)]
    for a, b in zip(pts, pts[1:]):
        P.beam('Black', a, b, 0.012)
    P.beam('Cable', (x + side * 0.03, y - 0.16, z + 0.075), (x + side * 0.02, 0.76, z + 0.12), 0.006)   # the cord

def handset(P, x, y, z, side):
    """a phone handset in its cradle on a console's side"""
    bx(P, 'Black', x, x + side * 0.03, y - 0.1, y + 0.1, z - 0.035, z + 0.035, skip=())
    P.beam('Black', (x + side * 0.045, y - 0.09, z), (x + side * 0.045, y + 0.09, z), 0.028, 0.03)
    for dy in (-0.1, 0.1):
        P.cyl('Black', (x + side * 0.05, y + dy, 0), 0.027, 0.027, z - 0.02, z + 0.03, 8, axis='z')

def build_console(P, w=0.9, tall=True, screens=((0.0, Q_SW, Q_SH, (-1, 1)),), body='ConsoleLight', trim='Console',
                  kbd=(-0.07, 0.3), phone=True, hs=True):
    """an AN/UYQ-70 style console in P's own frame (see above): cabinet with doors and louvres, the work shelf with a
    keyboard and a trackball, the lower display leaning back over the shelf, the upper one (tall) under a hood, rows
    of variable-action buttons beside each display, a status strip, a headset and a handset on the sides"""
    hw = w / 2
    bx(P, 'Black', -hw + 0.015, hw - 0.015, 0.0, 0.08, -0.51, -0.07)
    bx(P, body, -hw, hw, 0.08, 0.70, -0.53, -0.05)
    for sx in (-1, 1):
        a, b = (-hw + 0.03, -0.012) if sx < 0 else (0.012, hw - 0.03)
        bx(P, body, a, b, 0.12, 0.665, -0.05, -0.041, skip=('bottom', 'nz'))
        hx = -0.045 if sx < 0 else 0.045
        bx(P, 'Chrome', hx - 0.008, hx + 0.008, 0.34, 0.48, -0.041, -0.028, skip=('nz',))
        for k in range(4):
            yy = 0.16 + k * 0.032
            bx(P, 'Black', a + 0.04, b - 0.04, yy, yy + 0.014, -0.041, -0.037, skip=('nz', 'bottom'))
    bx(P, 'Panel', -hw - 0.012, hw + 0.012, 0.70, 0.73, -0.12, 0.43)
    bx(P, 'Rubber', -hw - 0.012, hw + 0.012, 0.695, 0.735, 0.43, 0.455, skip=('bottom', 'nz'))
    prof, cheek = (PROF_TALL, CHEEK_TALL) if tall else (PROF_LOW, CHEEK_LOW)
    ytop = 1.645 if tall else 1.2
    zy_slab(P, body, -hw, -hw + 0.03, cheek)
    zy_slab(P, body, hw - 0.03, hw, cheek)
    facade(P, trim, -hw + 0.03, hw - 0.03, prof)
    if tall:
        bx(P, body, -hw, hw, 1.56, 1.645, -0.53, -0.245, skip=())
        bx(P, 'Black', -hw + 0.1, hw - 0.1, 1.575, 1.63, -0.245, -0.24, skip=('nz', 'bottom'))        # speaker grille
        for k in range(5):
            yy = 1.58 + k * 0.01
            bx(P, 'Bezel', -hw + 0.11, hw - 0.11, yy, yy + 0.004, -0.24, -0.236, skip=('nz', 'bottom'))
    else:
        bx(P, body, -hw, hw, 1.12, 1.2, -0.53, -0.215, skip=())
    bx(P, body, -hw + 0.03, hw - 0.03, 0.73, ytop - 0.02, -0.53, -0.51, skip=('bottom', 'top', 'pz'))
    for k in range(6 if tall else 3):                           # the back: cooling louvres, a data plate, the cables
        yy = 0.86 + k * 0.1
        bx(P, 'Black', -hw + 0.1, hw - 0.1, yy, yy + 0.03, -0.537, -0.53, skip=('pz', 'bottom'))
    for k in range(4):
        yy = 0.2 + k * 0.1
        bx(P, 'Black', -hw + 0.12, hw - 0.12, yy, yy + 0.03, -0.537, -0.53, skip=('pz', 'bottom'))
    bx(P, 'Metal', hw - 0.2, hw - 0.08, 0.64, 0.7, -0.535, -0.53, skip=('pz', 'bottom'))
    P.beam('Cable', (-hw + 0.12, 0.12, -0.545), (-hw + 0.12, 0.0, -0.6), 0.05, 0.03, caps=False)
    P.beam('Cable', (-hw + 0.19, 0.12, -0.545), (-hw + 0.21, 0.0, -0.6), 0.035, 0.03, caps=False)
    faces = [LO] + ([UP] if tall else [])
    for (sx0, sw, sh, vab) in screens:
        for (t, c) in faces:
            M = R.mat3(0, t)
            cc = (c[0] + sx0, c[1], c[2])
            e = 0.014
            ob(P, 'Bezel', M, cc, -sw / 2 - e, sw / 2 + e, sh / 2, sh / 2 + e, 0, 0.007, skip=('nz',))
            ob(P, 'Bezel', M, cc, -sw / 2 - e, sw / 2 + e, -sh / 2 - e, -sh / 2, 0, 0.007, skip=('nz',))
            ob(P, 'Bezel', M, cc, -sw / 2 - e, -sw / 2, -sh / 2, sh / 2, 0, 0.007, skip=('nz',))
            ob(P, 'Bezel', M, cc, sw / 2, sw / 2 + e, -sh / 2, sh / 2, 0, 0.007, skip=('nz',))
            for side in vab:
                x = sx0 + side * (sw / 2 + 0.085)
                if abs(x) > hw - 0.06:
                    continue
                for j in range(4):
                    y = -0.105 + j * 0.07
                    m = 'LampGreen' if (j == 2 and side < 0) else 'LampAmber' if (j == 0 and side > 0 and t < 0.3) else 'Panel'
                    ob(P, m, M, cc, x - 0.021, x + 0.021, y - 0.015, y + 0.015, 0, 0.01, skip=('nz',))
    # the status strip under the upper display (tall) / along the hood (low): three LEDs
    Ms = R.mat3(0, math.atan2(0.02, 0.04))
    cs = (0.0, 1.14, -0.25) if tall else (0.0, 1.13, -0.212)
    for k, m in enumerate(('LampGreen', 'LampGreen', 'LampAmber')):
        x = -hw + 0.1 + k * 0.035
        ob(P, m, Ms if tall else R.mat3(0), cs, x - 0.009, x + 0.009, -0.006, 0.006, 0, 0.006, skip=('nz',))
    if kbd:
        keyboard(P, kbd[0], 0.25)
        trackball(P, kbd[1], 0.25)
    if hs:
        headset(P, hw, 1.22 if tall else 1.05, -0.36, 1)
    if phone:
        handset(P, -hw, 1.05 if tall else 0.98, -0.36, -1)
    if tall:                                                    # a comms (net selector) box on the left cheek
        bx(P, 'Console', -hw - 0.05, -hw, 1.3, 1.5, -0.46, -0.3, skip=())
        for j in range(3):
            for i in range(2):
                P.cyl('Black', (-hw - 0.05, 1.34 + j * 0.06, -0.42 + i * 0.08), 0.013, 0.013, -hw - 0.068, -hw - 0.05, 8, axis='x', cap1=False)

def build_chair(P, h=0.47, mat='SeatBlue', head=False):
    """a console chair on a pedestal: swivel, padded seat with a rolled front, a back leaning a little, T-arms;
    the sitter faces −z"""
    P.cyl('Steel', (0, 0, 0), 0.23, 0.23, 0.0, 0.022, 16, cap0=False)
    P.cyl('Steel', (0, 0, 0), 0.07, 0.05, 0.022, 0.1, 10, cap0=False)
    P.cyl('Black', (0, 0, 0), 0.042, 0.042, 0.1, h - 0.17, 10, cap0=False, cap1=False)
    P.cyl('Chrome', (0, 0, 0), 0.03, 0.03, h - 0.17, h - 0.09, 10, cap0=False, cap1=False)
    bx(P, 'Black', -0.13, 0.13, h - 0.1, h - 0.06, -0.12, 0.16)
    bx(P, mat, -0.245, 0.245, h - 0.06, h + 0.035, -0.17, 0.25)
    P.cyl(mat, (0, h - 0.012, -0.17), 0.047, 0.047, -0.245, 0.245, 10, axis='x')
    Mb = R.mat3(0, -0.14)
    ob(P, 'Black', R.mat3(0), (0, 0, 0), -0.035, 0.035, h - 0.06, h + 0.12, 0.21, 0.28)
    ob(P, mat, Mb, (0, h + 0.07, 0.26), -0.23, 0.23, 0.0, 0.56 if not head else 0.62, -0.04, 0.03, skip=())
    ob(P, mat, Mb, (0, h + 0.07, 0.26), -0.2, 0.2, 0.06, 0.26, -0.06, -0.04, skip=())
    ob(P, 'Black', Mb, (0, h + 0.07, 0.26), -0.215, 0.215, 0.03, 0.53, 0.03, 0.045, skip=())
    if head:
        ob(P, mat, Mb, (0, h + 0.07, 0.26), -0.13, 0.13, 0.66, 0.84, -0.035, 0.03, skip=())
        ob(P, 'Black', Mb, (0, h + 0.07, 0.26), -0.025, 0.025, 0.6, 0.68, -0.0, 0.025, skip=())
    for sx in (-0.265, 0.265):
        bx(P, 'Black', sx - 0.017, sx + 0.017, h - 0.02, h + 0.19, 0.03, 0.1)
        bx(P, 'Black', sx - 0.035, sx + 0.035, h + 0.19, h + 0.225, -0.13, 0.16, skip=())

CH = {'std': lambda P: build_chair(P), 'high': lambda P: build_chair(P, h=0.5, head=True)}

def q70(x, z, yaw=0.0, tall=True, upper=None, lower=None, title=None, chair='std', floor=0.0, stand=None, pitch=-0.08, fov=56):
    """a Q-70 at (x, floor, z) turned by yaw, its displays (live name / art index / None dark), a title on the hood,
    a chair (a little askew) and, if asked, the operator's station"""
    pos = (x, floor, z)
    inst('q70' if tall else 'q70low', (lambda P: build_console(P, tall=True)) if tall else (lambda P: build_console(P, tall=False)), pos, yaw)
    Mi = R.mat3(yaw)
    for spec, (t, c) in [(lower, LO)] + ([(upper, UP)] if tall else []):
        cc = R.xf(Mi, pos, R.xf(R.mat3(0, t), c, (0, 0, 0.002)))
        display(S, spec, cc, yaw, t, Q_SW, Q_SH, px=(768, 480))
    if title:
        ty, tz = (1.6, -0.2435) if tall else (1.16, -0.2135)
        R.label(title, R.xf(Mi, pos, (0.0, ty, tz)), yaw, 0.0, h=0.034, st='w')
    if chair:
        inst('chair_' + chair, CH[chair], R.xf(Mi, pos, (rnd.uniform(-0.06, 0.06), 0.0, 0.95)), yaw + rnd.uniform(-0.18, 0.18))
    if stand:
        R.station(stand, R.xf(Mi, pos, (0.0, 1.2, 0.72)), yaw=yaw, pitch=pitch, fov=fov)
    return Mi, pos

# ═════════════ equipment cabinets, boards, small fittings ═════════════
def cabinet(S, x, z, yaw, w=0.6, d=0.6, h=1.9, body='Console', face='ConsoleLight', title=None, lights=True, st='b', seed=0):
    """an equipment rack with its back at (x, z) against a bulkhead, its front turned by yaw (0: facing +z): the
    frame, a door with a handle and louvres, a lamp strip, a row of switches and a nameplate"""
    M = R.mat3(yaw)
    o = (x, 0.0, z)
    ob(S, body, M, o, -w / 2, w / 2, 0.0, h, 0.0, d, skip=('bottom', 'nz'))
    ob(S, face, M, o, -w / 2 + 0.03, w / 2 - 0.03, 0.08, h - 0.05, d, d + 0.012, skip=('bottom', 'nz'))
    ob(S, 'Chrome', M, o, w / 2 - 0.08, w / 2 - 0.065, h * 0.45, h * 0.6, d + 0.012, d + 0.028, skip=('nz',))
    for k in range(6):
        yy = 0.14 + k * 0.035
        R.oquad(S, 'Black', M, o, -w / 2 + 0.08, w / 2 - 0.08, yy, yy + 0.016, d + 0.0125)
    if lights:
        rr = random.Random(seed)
        for k in range(5):
            xx = -w / 2 + 0.1 + k * 0.05
            m = rr.choice(('LampGreen', 'LampGreen', 'LampAmber', 'Panel'))
            R.oquad(S, m, M, o, xx - 0.012, xx + 0.012, h - 0.25, h - 0.226, d + 0.0125)
        switches(S, M, R.xf(M, o, (0.0, h - 0.42, d + 0.012)), cols=5, rows=2, pitch=0.05, seed=seed)
    if title:
        R.label(title, R.xf(M, o, (0.0, h - 0.12, d + 0.014)), yaw, 0.0, h=0.03, st=st)

def clock(S, c, yaw, r=0.14, title=None, hands=(0.3, 2.1)):
    """a bulkhead clock: rim, face, hour ticks, hands"""
    M = R.mat3(yaw)
    R.ocyl(S, 'Black', M, c, (0, 0, 0), r * 1.1, r * 1.1, -0.05, 0.0, 20, axis='z', cap0=False)
    R.ocyl(S, 'White', M, c, (0, 0, 0), r, r, -0.04, 0.002, 20, axis='z', cap0=False)
    for k in range(12):
        a = k * PI / 6
        s = 0.16 if k % 3 == 0 else 0.1
        R.oquad(S, 'Black', M @ R.mat3(0, 0, -a), c, -0.004, 0.004, r * (0.92 - s), r * 0.92, 0.004)
    for a, L, t in ((hands[0], 0.55, 0.012), (hands[1], 0.82, 0.008)):
        R.oquad(S, 'Black', M @ R.mat3(0, 0, -a), c, -t / 2, t / 2, -r * 0.1, r * L, 0.006)
    if title:
        R.label(title, R.xf(M, c, (0, -r * 1.1 - 0.045, 0.0)), yaw, 0.0, h=0.032, st='w')

def extinguisher(S, x, z, yaw, co2=False):
    """a fire extinguisher on its bulkhead bracket (co2: the black horn)"""
    M = R.mat3(yaw)
    o = (x, 0.0, z)
    ob(S, 'Steel', M, o, -0.1, 0.1, 0.5, 0.56, 0.0, 0.02)
    R.ocyl(S, 'Red', M, o, (0, 0, 0.1), 0.085 if co2 else 0.075, 0.085 if co2 else 0.075, 0.42, 1.0, 12, axis='y')
    R.ocyl(S, 'Red', M, o, (0, 0, 0.1), 0.085 if co2 else 0.075, 0.03, 1.0, 1.08, 12, axis='y', cap0=False)
    R.ocyl(S, 'Black', M, o, (0, 0, 0.1), 0.02, 0.02, 1.08, 1.14, 8, axis='y', cap0=False)
    S.beam('Black', R.xf(M, o, (0, 1.13, 0.1)), R.xf(M, o, (0.12, 1.1, 0.1)), 0.02, 0.012)
    if co2:
        S.beam('Black', R.xf(M, o, (0.0, 1.1, 0.1)), R.xf(M, o, (0.1, 0.85, 0.2)), 0.018)
        R.ocyl(S, 'Black', M, o, (0.1, 0.0, 0.2), 0.03, 0.06, 0.62, 0.85, 8, axis='y')
    else:
        S.beam('Black', R.xf(M, o, (0.0, 1.1, 0.1)), R.xf(M, o, (-0.09, 0.7, 0.19)), 0.016)
    ob(S, 'Steel', M, o, -0.1, 0.1, 0.9, 0.95, 0.0, 0.02)
    R.label('CO2' if co2 else 'PKP', R.xf(M, o, (0, 1.32, 0.002)), yaw, 0.0, h=0.045, st='r')

def battle_lantern(S, x, y, z, yaw):
    """the yellow battery lantern that lights when the power drops"""
    M = R.mat3(yaw)
    o = (x, y, z)
    ob(S, 'Yellow', M, o, -0.09, 0.09, -0.08, 0.08, 0.0, 0.14, skip=())
    R.ocyl(S, 'Chrome', M, o, (0, 0, 0), 0.06, 0.06, 0.14, 0.17, 12, axis='z', cap0=False)
    R.ocyl(S, 'White', M, o, (0, 0, 0), 0.048, 0.048, 0.17, 0.172, 12, axis='z', cap0=False)
    ob(S, 'Black', M, o, -0.03, 0.03, 0.08, 0.11, 0.03, 0.11, skip=())

def phone_box(S, x, y, z, yaw, title=None, dial=True):
    """a ship's telephone: the grey box, the handset in its cradle (and a dial / keypad)"""
    M = R.mat3(yaw)
    o = (x, y, z)
    ob(S, 'ConsoleLight', M, o, -0.1, 0.1, -0.16, 0.16, 0.0, 0.08, skip=())
    ob(S, 'Black', M, o, -0.075, -0.02, -0.13, 0.13, 0.08, 0.11, skip=('nz',))
    for dy in (-0.11, 0.11):
        ob(S, 'Black', M, o, -0.08, -0.015, dy - 0.028, dy + 0.028, 0.1, 0.13, skip=('nz',))
    if dial:
        for k in range(12):
            xx, yy = 0.03 + (k % 3) * 0.022, 0.06 - (k // 3) * 0.028
            ob(S, 'White', M, o, xx - 0.008, xx + 0.008, yy - 0.008, yy + 0.008, 0.08, 0.086, skip=('nz',))
    S.beam('Cable', R.xf(M, o, (-0.05, -0.13, 0.1)), R.xf(M, o, (-0.02, -0.3, 0.06)), 0.01)
    if title:
        R.label(title, R.xf(M, o, (0.0, 0.2, 0.001)), yaw, 0.0, h=0.03, st='y')

def speaker(S, x, y, z, yaw, hang=None):
    """a 1MC / 21MC loudspeaker box, tipped down a little (on a bulkhead, or hung from the overhead at y = hang)"""
    M = R.mat3(yaw, -0.3)
    o = (x, y, z)
    ob(S, 'ConsoleLight', M, o, -0.14, 0.14, -0.11, 0.11, 0.0, 0.13, skip=())
    for k in range(5):
        yy = -0.075 + k * 0.035
        R.oquad(S, 'Black', M, o, -0.11, 0.11, yy - 0.008, yy + 0.008, 0.1305)
    if hang:
        S.beam('Steel', R.xf(M, o, (0, 0.11, 0.06)), (x, hang, z), 0.02)

def eebd(S, x, y, z, yaw):
    """an emergency escape breathing device locker"""
    M = R.mat3(yaw)
    o = (x, y, z)
    ob(S, 'Yellow', M, o, -0.16, 0.16, -0.2, 0.2, 0.0, 0.16, skip=())
    ob(S, 'Chrome', M, o, 0.1, 0.13, -0.03, 0.03, 0.16, 0.175, skip=('nz',))
    R.label('EEBD', R.xf(M, o, (0, 0.07, 0.162)), yaw, 0.0, h=0.05, st='b')

def burn_bag(S, x, z):
    """a classified-waste burn bag in its stand (red and white stripes)"""
    bx(S, 'Steel', x - 0.17, x + 0.17, 0.0, 0.03, z - 0.13, z + 0.13)
    bx(S, 'White', x - 0.15, x + 0.15, 0.03, 0.62, z - 0.11, z + 0.11)
    for yy in (0.18, 0.34, 0.5):
        bx(S, 'Red', x - 0.152, x + 0.152, yy, yy + 0.05, z - 0.112, z + 0.112, skip=('bottom', 'top'))

# ═════════════════════════════════ the shell ═════════════════════════════════
R.shell(S, X0, X1, Z0, Z1, H, floor='DeckTile', wall='Wall', ceil='Ceiling')
# a dark cove base round the bulkheads
for (a, b, c, d) in ((X0, X1, Z0, Z0 + 0.02), (X0, X1, Z1 - 0.02, Z1), (X0, X0 + 0.02, Z0, Z1), (X1 - 0.02, X1, Z0, Z1)):
    bx(S, 'Rubber', a, b, 0.0, 0.1, c, d)
# bulkhead stiffeners (vertical frames) on the sides, and deck beams across the overhead
for z in [Z0 + 0.6 + k * 1.2 for k in range(10)]:
    for sx in (-1, 1):
        x = sx * X1
        bx(S, 'Wall', min(x, x - sx * 0.1), max(x, x - sx * 0.1), 0.1, H, z - 0.04, z + 0.04, skip=('bottom', 'top'))
for z in [Z0 + 0.6 + k * 1.2 for k in range(10)]:
    bx(S, 'Wall', X0, X1, H - 0.2, H, z - 0.006, z + 0.006, skip=('top', 'px', 'nx'))
    bx(S, 'Wall', X0, X1, H - 0.215, H - 0.2, z - 0.05, z + 0.05, skip=('top', 'px', 'nx'))
# the compartment's bull's-eye (location placard) by the doors, frame numbers on the stiffeners
R.label('03-105-0-C · COMBAT DIRECTION CENTER', (0.0, 2.25, Z1 - 0.012), PI, 0.0, h=0.05, st='b')
for k, z in enumerate([Z0 + 0.6 + k * 1.2 for k in range(0, 10, 3)]):
    R.label('FR %d' % (96 + k * 3), (X0 + 0.102, 2.2, z), PI / 2, 0.0, h=0.03, st='b')

# ═════════════ the forward bulkhead: three large screen displays over a cabinet row ═════════════
LSD = [(-2.25, 'screen_lsd_air', 'LSD 1 · AIR PICTURE'), (0.0, 'screen_lsd_map', 'LSD 2 · TACTICAL PLOT'), (2.25, 'screen_lsd_strike', 'LSD 3 · STRIKE / SURFACE')]
bx(S, 'Steel', -3.42, 3.42, 2.47, 2.53, Z0, Z0 + 0.16)                     # the mounting rail
for (x, name, title) in LSD:
    R.monitor(S, name, (x, 1.87, Z0 + 0.13), 0.0, 0.0, w=2.0, h=1.17, depth=0.1, bezel=0.045, px=(1024, 600), bright=1.1)
    R.label(title, (x, 1.215, Z0 + 0.131), 0.0, 0.0, h=0.045, st='w')
for x in (-3.37, 3.37):
    bx(S, 'Steel', x - 0.05, x + 0.05, 1.1, 2.53, Z0, Z0 + 0.14)
# cabinet row under the displays: display processors and the LSD controls
for k, x in enumerate([-2.975 + j * 0.85 for j in range(8)]):
    M = R.mat3(0)
    ob(S, 'Console', M, (x, 0, Z0), -0.42, 0.42, 0.0, 0.95, 0.0, 0.45)
    ob(S, 'ConsoleLight', M, (x, 0, Z0), -0.39, 0.39, 0.1, 0.9, 0.45, 0.46, skip=('bottom', 'nz'))
    ob(S, 'Chrome', M, (x, 0, Z0), 0.3, 0.315, 0.5, 0.7, 0.46, 0.475, skip=('nz',))
    for j in range(5):
        yy = 0.18 + j * 0.035
        R.oquad(S, 'Black', M, (x, 0, Z0), -0.32, 0.26, yy, yy + 0.015, 0.4605)
    ob(S, 'Panel', M, (x, 0, Z0), -0.42, 0.42, 0.95, 0.97, 0.0, 0.47)
    if k in (3, 4):
        switches(S, M, (x, 0.78, Z0 + 0.46), cols=6, rows=2, pitch=0.05, seed=k)
R.label('DISPLAY CONTROL · SSDS MK 2', (0.0, 0.88, Z0 + 0.466), 0.0, 0.0, h=0.03, st='e')
# port part of the forward bulkhead: weapons status board, a repeater display, the threat-warning panel, clocks
bx(S, 'Steel', -8.2, -6.9, 1.2, 2.3, Z0, Z0 + 0.04)
R.oquad(S, 'Black', R.mat3(0), (-7.55, 1.75, Z0 + 0.041), -0.62, 0.62, -0.52, 0.52, 0.0)
R.label('WEAPONS STATUS', (-7.55, 2.18, Z0 + 0.045), 0.0, 0.0, h=0.045, st='y')
for j, (wpn, st) in enumerate([('ESSM', '8 RDY'), ('RAM 1', '21 RDY'), ('RAM 2', '19 RDY'), ('CIWS 1', 'AUTO'), ('CIWS 2', 'AUTO'), ('CIWS 3', 'DOWN')]):
    y = 1.98 - j * 0.12
    scrawl(S, wpn, (-8.08, y, Z0 + 0.041), (1, 0, 0), (0, 1, 0), h=0.055, mat='LampWhite', seed=j + 3)
    scrawl(S, st, (-7.45, y, Z0 + 0.041), (1, 0, 0), (0, 1, 0), h=0.055, mat='LampRed' if st == 'DOWN' else 'LampGreen', seed=j + 30)
R.monitor(S, None, (-5.85, 1.85, Z0 + 0.08), 0.0, 0.0, w=1.1, h=0.62, depth=0.06, bezel=0.03, art=5)
R.label('SPS-48 REPEATER', (-5.85, 1.45, Z0 + 0.081), 0.0, 0.0, h=0.035, st='w')
# the threat-warning panel: RED / YELLOW / WHITE and the EMCON condition
bx(S, 'Console', -4.75, -3.95, 1.85, 2.35, Z0, Z0 + 0.06)
for j, (m, t) in enumerate((('LampRed', 'RED'), ('LampAmber', 'YELLOW'), ('LampWhite', 'WHITE'))):
    x = -4.6 + j * 0.25
    bx(S, 'Bezel', x - 0.08, x + 0.08, 2.1, 2.28, Z0 + 0.06, Z0 + 0.07, skip=('bottom', 'nz'))
    bx(S, m if j == 1 else 'Panel', x - 0.065, x + 0.065, 2.115, 2.265, Z0 + 0.07, Z0 + 0.078, skip=('bottom', 'nz'))
    R.label(t, (x, 2.04, Z0 + 0.061), 0.0, 0.0, h=0.03, st='e')
R.label('AIR WARNING', (-4.35, 1.93, Z0 + 0.061), 0.0, 0.0, h=0.03, st='w')
R.label('EMCON ALPHA', (-4.35, 1.74, Z0 + 0.01), 0.0, 0.0, h=0.05, st='y')
clock(S, (-4.35, 1.38, Z0 + 0.05), 0.0, r=0.14, title='ZULU', hands=(1.1, 4.4))
# starboard part: clocks, a repeater display, the EMCON / readiness board
clock(S, (4.35, 2.1, Z0 + 0.05), 0.0, r=0.14, title='LOCAL', hands=(4.6, 4.4))
clock(S, (4.35, 1.55, Z0 + 0.05), 0.0, r=0.11, title='TIME LATE', hands=(0.0, 1.6))
R.monitor(S, None, (5.85, 1.85, Z0 + 0.08), 0.0, 0.0, w=1.1, h=0.62, depth=0.06, bezel=0.03, art=1)
R.label('SPS-67 REPEATER', (5.85, 1.45, Z0 + 0.081), 0.0, 0.0, h=0.035, st='w')
bx(S, 'Steel', 6.9, 8.2, 1.2, 2.3, Z0, Z0 + 0.04)
R.oquad(S, 'Black', R.mat3(0), (7.55, 1.75, Z0 + 0.041), -0.62, 0.62, -0.52, 0.52, 0.0)
R.label('READINESS', (7.55, 2.18, Z0 + 0.045), 0.0, 0.0, h=0.045, st='y')
for j, (a, b_) in enumerate([('COND', 'III'), ('MATL', 'YOKE'), ('DEFCON', '3'), ('WX', '1-2 FT'), ('BRC', '095'), ('PIM', 'ON')]):
    y = 1.98 - j * 0.12
    scrawl(S, a, (6.97, y, Z0 + 0.041), (1, 0, 0), (0, 1, 0), h=0.055, mat='LampWhite', seed=j + 60)
    scrawl(S, b_, (7.6, y, Z0 + 0.041), (1, 0, 0), (0, 1, 0), h=0.055, mat='LampAmber', seed=j + 90)
# corner racks
cabinet(S, -8.62, Z0, 0.0, w=0.66, d=0.6, h=2.0, title='IFF / AIMS', seed=1)
cabinet(S, 8.62, Z0, 0.0, w=0.66, d=0.6, h=2.0, title='SPS-49 RCU', seed=2)

# ═════════════ the air module: two rows of Q-70s facing forward (port) ═════════════
AIR_A = [(-7.2, 'ADWC', 5, 0), (-6.2, 'ATM / ID', 0, 6), (-5.2, 'AIR 1 · AIC', 'screen_air_1', 'screen_air_2'), (-4.2, 'STRIKE CTLR', 5, 3)]
for (x, title, up, lo) in AIR_A:
    q70(x, -3.85, 0.0, upper=up, lower=lo, title=title,
        stand='stand_air' if up == 'screen_air_1' else None)
AIR_B = [(-7.2, 'AIR OPS', 4, 7), (-6.2, 'SWC', 5, 4), (-5.2, 'AIC 2', 0, 3)]
for (x, title, up, lo) in AIR_B:
    q70(x, -1.2, 0.0, upper=up, lower=lo, title=title)

# ═════════════ the display & tracking module: low consoles in front of the dais ═════════════
for (x, title, lo) in [(-1.0, 'GCCS-M', 5), (0.0, 'LINK 11 / 16 · DTS', 6), (1.0, 'TIC', 0)]:
    q70(x, -1.2, 0.0, tall=False, lower=lo, title=title)

# ═════════════ the surface module and tactical plotting (starboard) ═════════════
for (x, title, up, lo) in [(4.2, 'SUW COORD', 1, 6), (5.2, 'SURFACE', 'screen_surf', 1), (6.2, 'SURF 2', 5, 0)]:
    q70(x, -3.85, 0.0, upper=up, lower=lo, title=title, stand='stand_surf' if up == 'screen_surf' else None)
q70(7.25, -1.2, 0.0, upper=1, lower=7, title='SURF TRACER')
# the DRT plotting table: a chart under glass, lit from below, with the plotting tools on it
DX0, DX1, DZ0, DZ1 = 4.25, 6.05, -1.75, -0.7
bx(S, 'Console', DX0 + 0.05, DX1 - 0.05, 0.0, 0.84, DZ0 + 0.05, DZ1 - 0.05)
bx(S, 'Black', DX0 + 0.08, DX1 - 0.08, 0.0, 0.08, DZ0 + 0.08, DZ1 - 0.08)
bx(S, 'Steel', DX0, DX1, 0.84, 0.9, DZ0, DZ1)
R.oquad(S, 'White', R.mat3(0, PI / 2), ((DX0 + DX1) / 2, 0.902, (DZ0 + DZ1) / 2), -(DX1 - DX0) / 2 + 0.06, (DX1 - DX0) / 2 - 0.06, -(DZ1 - DZ0) / 2 + 0.06, (DZ1 - DZ0) / 2 - 0.06, 0.0)
cx, cz = (DX0 + DX1) / 2, (DZ0 + DZ1) / 2
for k in range(-6, 7):   # the chart's grid
    x = cx + k * 0.13
    S.g('PipeBlue').face([(x - 0.002, 0.9035, DZ0 + 0.07), (x + 0.002, 0.9035, DZ0 + 0.07), (x + 0.002, 0.9035, DZ1 - 0.07), (x - 0.002, 0.9035, DZ1 - 0.07)], None, (0, 1, 0))
for k in range(-3, 4):
    z = cz + k * 0.13
    S.g('PipeBlue').face([(DX0 + 0.07, 0.9035, z - 0.002), (DX1 - 0.07, 0.9035, z - 0.002), (DX1 - 0.07, 0.9035, z + 0.002), (DX0 + 0.07, 0.9035, z + 0.002)], None, (0, 1, 0))
for k in range(24):     # the compass rose
    a0, a1 = k * PI / 12, (k + 1) * PI / 12
    S.beam('Black', (cx + 0.3 * math.cos(a0), 0.905, cz + 0.3 * math.sin(a0)), (cx + 0.3 * math.cos(a1), 0.905, cz + 0.3 * math.sin(a1)), 0.005, 0.001)
trk = [(DX0 + 0.15, DZ1 - 0.15), (cx - 0.3, cz + 0.12), (cx - 0.05, cz - 0.02), (cx + 0.25, cz - 0.2), (DX1 - 0.2, DZ0 + 0.12)]
for a, b_ in zip(trk, trk[1:]):             # own ship's plotted track and a contact's
    S.beam('Black', (a[0], 0.905, a[1]), (b_[0], 0.905, b_[1]), 0.004, 0.001)
    S.beam('Black', (a[0], 0.905, a[1] - 0.25), (b_[0] + 0.1, 0.905, b_[1] - 0.3), 0.003, 0.001)
bx(S, 'LampWhite', cx - 0.01, cx + 0.01, 0.9, 0.906, cz - 0.01, cz + 0.01)       # the DRT's projected "bug"
S.beam('Chrome', (cx - 0.5, 0.91, cz + 0.28), (cx + 0.1, 0.91, cz - 0.05), 0.05, 0.008)      # parallel rulers
S.beam('Chrome', (cx - 0.46, 0.91, cz + 0.34), (cx + 0.14, 0.91, cz + 0.01), 0.05, 0.008)
S.beam('Steel', (cx + 0.5, 0.91, cz + 0.25), (cx + 0.62, 0.93, cz + 0.15), 0.008)             # dividers
S.beam('Steel', (cx + 0.5, 0.91, cz + 0.25), (cx + 0.66, 0.91, cz + 0.3), 0.008)
bx(S, 'White', cx - 0.8, cx - 0.52, 0.905, 0.91, cz - 0.4, cz - 0.12)                       # a maneuvering board pad
for k in range(4):
    r = 0.03 + k * 0.03
    for j in range(12):
        a0, a1 = j * PI / 6, (j + 1) * PI / 6
        S.beam('PipeBlue', (cx - 0.66 + r * math.cos(a0), 0.911, cz - 0.26 + r * math.sin(a0)), (cx - 0.66 + r * math.cos(a1), 0.911, cz - 0.26 + r * math.sin(a1)), 0.002, 0.001)
for sx in (DX0 - 0.02, DX1 + 0.02):
    R.handrail(S, (sx, 0.8, DZ0 + 0.1), (sx, 0.8, DZ1 - 0.1), standoff=0.0)
R.label('DRT · TACTICAL PLOT', (cx, 0.7, DZ1 + 0.001), 0.0, 0.0, h=0.04, st='w')
R.light_fixture(S, (cx, 2.0, cz), w=0.3, l=1.2, along='x', mat='LightBlue')
for sx in (-0.5, 0.5):
    S.beam('Steel', (cx + sx, 2.0, cz), (cx + sx, H - 0.2, cz), 0.02)
for k, x in enumerate((DX0 + 0.2, DX1 - 0.25)):
    inst('chair_std', CH['std'], (x, 0.0, DZ1 + 0.55), PI + rnd.uniform(-0.3, 0.3) + 0.4 * (k - 0.5))

# ═════════════ the status boards (clear, edge-lit, written on from behind) ═════════════
def status_board(x, z0, z1, side, title, cols, rows, y0=0.8, y1=2.35, seed=0):
    """a clear board standing off the side bulkhead (x: its plane; side +1 faces +x, −1 faces −x) with a walkway behind:
    frame, legs, the edge light, grid lines, column heads (labels) and grease-pencil rows"""
    eu = (0, 0, -side)                       # along the board as seen from the room
    yaw = side * PI / 2
    zl, zr = (z1, z0) if side > 0 else (z0, z1)     # left / right ends as seen from the room
    for z in (z0, z1):
        bx(S, 'Steel', x - 0.025, x + 0.025, 0.0, y1 + 0.12, z - 0.025, z + 0.025)
        bx(S, 'Steel', x - 0.2, x + 0.2, 0.0, 0.02, z - 0.04, z + 0.04)
    bx(S, 'Steel', x - 0.03, x + 0.03, y1, y1 + 0.03, z0, z1, skip=())
    bx(S, 'Steel', x - 0.03, x + 0.03, y0 - 0.03, y0, z0, z1, skip=())
    bx(S, 'LightBlue', x - 0.012, x + 0.012, y1 - 0.012, y1, z0 + 0.03, z1 - 0.03)      # the edge light
    q = [(x, y0, z0), (x, y0, z1), (x, y1, z1), (x, y1, z0)]
    S.g('Glass').face(q, None, (side, 0, 0))
    lx = x + side * 0.004
    for k in range(1, rows + 1):
        y = y1 - 0.14 - k * (y1 - y0 - 0.16) / (rows + 0.2)
        S.g('White').face([(lx, y - 0.002, z0 + 0.03), (lx, y + 0.002, z0 + 0.03), (lx, y + 0.002, z1 - 0.03), (lx, y - 0.002, z1 - 0.03)], None, (side, 0, 0))
    y = y1 - 0.14
    S.g('White').face([(lx, y - 0.003, z0 + 0.03), (lx, y + 0.003, z0 + 0.03), (lx, y + 0.003, z1 - 0.03), (lx, y - 0.003, z1 - 0.03)], None, (side, 0, 0))
    L = abs(z1 - z0)
    acc = 0.0
    for (head, frac) in cols:
        zc = zl + (-side) * (acc + frac / 2) * L
        R.label(head, (x + side * 0.006, y1 - 0.075, zc), yaw, 0.0, h=0.045, st='w')
        acc += frac
        if acc < 0.999:
            zz = zl + (-side) * acc * L
            S.g('White').face([(lx, y0 + 0.03, zz - 0.002), (lx, y1 - 0.03, zz - 0.002), (lx, y1 - 0.03, zz + 0.002), (lx, y0 + 0.03, zz + 0.002)], None, (side, 0, 0))
    R.label(title, (x + side * 0.006, y1 + 0.085, (z0 + z1) / 2), yaw, 0.0, h=0.06, st='y')
    return eu, zl, L, y1 - 0.14, (y1 - y0 - 0.16) / (rows + 0.2)

def board_rows(x, side, eu, zl, L, ytop, dy, cols, rows, h=0.05, seed=0):
    lx = x + side * 0.006
    for i, row in enumerate(rows):
        y = ytop - (i + 1) * dy + dy * 0.2
        acc = 0.0
        for j, (cell, (head, frac)) in enumerate(zip(row, cols)):
            if cell:
                txt, m = cell if isinstance(cell, tuple) else (cell, 'LampAmber')
                z = zl + (-side) * (acc + 0.012) * L
                scrawl(S, txt, (lx, y, z), eu, (0, 1, 0), h=h, mat=m, seed=seed + i * 17 + j)
            acc += frac

AIR_COLS = [('EVT', 0.08), ('SIDE', 0.1), ('TYPE', 0.11), ('MSN', 0.14), ('LNCH', 0.11), ('RCVY', 0.11), ('FUEL', 0.1), ('STATION', 0.25)]
AIR_ROWS = [
    ['1', '100', 'F18E', 'CAP', ('1330', 'LampGreen'), '1500', '8.2', 'STN ALFA'],
    ['1', '101', 'F18E', 'CAP', ('1330', 'LampGreen'), '1500', '7.9', 'STN ALFA'],
    ['1', '600', 'E2D', 'AEW', ('1315', 'LampGreen'), '1545', '-', 'STN 1'],
    ['1', '510', 'EA18', 'EW', ('1335', 'LampGreen'), '1510', '9.1', 'STRIKE'],
    ['1', '702', 'MH60', 'SSC', ('1340', 'LampGreen'), '1530', '-', 'SECTOR 2'],
    ['2', '200', 'F35C', 'STK', '1445', '1630', '-', ('ALERT 15', 'LampRed')],
    ['2', '201', 'F35C', 'STK', '1445', '1630', '-', ('ALERT 15', 'LampRed')],
    ['2', '300', 'F18F', 'TKR', '1440', '1615', '-', 'OVHD'],
]
e = status_board(-8.42, -5.3, -2.0, 1, 'AIR EVENTS', AIR_COLS, 9)
board_rows(-8.42, 1, e[0], e[1], e[2], e[3], e[4], AIR_COLS, AIR_ROWS, h=0.065, seed=11)
CAP_COLS = [('CAP STN', 0.3), ('BRG', 0.14), ('RNG', 0.14), ('ALT', 0.14), ('A/C', 0.28)]
CAP_ROWS = [['ALFA', '310', '120', '250', '100 101'], ['BRAVO', '045', '150', '220', ('VACANT', 'LampRed')], ['TANKER', '180', '40', '180', '300'],
            ['E2 STN 1', '270', '80', '250', '600'], ['MARSHAL', '095', '21', '060', '-']]
e = status_board(-8.42, -1.55, 1.75, 1, 'CAP / AIR STATIONS', CAP_COLS, 6)
board_rows(-8.42, 1, e[0], e[1], e[2], e[3], e[4], CAP_COLS, CAP_ROWS, h=0.065, seed=51)
SURF_COLS = [('TRK', 0.1), ('BRG', 0.1), ('RNG', 0.1), ('CSE', 0.1), ('SPD', 0.09), ('CPA', 0.14), ('ID / REMARKS', 0.37)]
SURF_ROWS = [
    ['7401', '045', '18.2', '210', '12', '6.1/1420', ('SKUNK A', 'LampRed')],
    ['7402', '112', '22.5', '300', '18', '11/1510', 'MERCHANT'],
    ['7403', '338', '9.8', '090', '6', '2.0/1355', ('FISHING', 'LampGreen')],
    ['7404', '270', '31.0', '015', '25', '-', ('UNK FAST', 'LampRed')],
    ['0101', '180', '4.0', '095', '20', '-', ('CG 57 PLANE GUARD', 'LampGreen')],
    ['0102', '090', '6.0', '095', '20', '-', ('DDG 104 SCREEN', 'LampGreen')],
]
e = status_board(8.42, -5.3, -2.0, -1, 'SURFACE STATUS', SURF_COLS, 8)
board_rows(8.42, -1, e[0], e[1], e[2], e[3], e[4], SURF_COLS, SURF_ROWS, h=0.062, seed=71)

# ═════════════ the TAO dais: CDC watch officer, the TAO's dual console, the strike console ═════════════
DX0_, DX1_, DZ0_, DZ1_, DH = DAIS
bx(S, 'DeckTile', DX0_, DX1_, 0.0, DH, DZ0_, DZ1_)
for (a, b_, c, d) in ((DX0_, DX1_, DZ0_, DZ0_ + 0.05), (DX0_, DX1_, DZ1_ - 0.05, DZ1_), (DX0_, DX0_ + 0.05, DZ0_, DZ1_), (DX1_ - 0.05, DX1_, DZ0_, DZ1_)):
    bx(S, 'Yellow', a, b_, DH, DH + 0.004, c, d)                # the edge strip
bx(S, 'Black', DX0_ - 0.004, DX1_ + 0.004, 0.0, 0.06, DZ0_ - 0.004, DZ1_ + 0.004, skip=('bottom', 'top'))
Q = (DH, 1.45)        # the dais consoles' deck height and their front line (z)
# the CDC watch officer (low Q-70)
q70(-2.0, Q[1], 0.0, tall=False, lower=6, title='CDC WATCH OFFICER', chair='std', floor=DH)
# the TAO's dual console (two displays side by side; built once, merged)
P = Part('tao')
build_console(P, w=1.5, tall=False, screens=((-0.34, Q_SW, Q_SH, (-1,)), (0.34, Q_SW, Q_SH, (1,))), kbd=None)
add_part(S, P, (-0.55, DH, Q[1]), 0.0)
inst('kbd', lambda P: keyboard(P, 0.0, 0.0, y=0.0), (-0.6, DH + 0.73, Q[1] + 0.25))
inst('tball', lambda P: trackball(P, 0.0, 0.0, y=0.0), (-0.19, DH + 0.73, Q[1] + 0.25))
M0 = R.mat3(0)
for k, sx in enumerate((-0.34, 0.34)):
    cc = R.xf(M0, (-0.55, DH, Q[1]), R.xf(R.mat3(0, LO[0]), (sx, LO[1][1], LO[1][2]), (0, 0, 0.002)))
    R.screen('screen_tao_%d' % (k + 1), cc, 0.0, LO[0], Q_SW, Q_SH, (768, 480))
R.label('TACTICAL ACTION OFFICER', (-0.55, 1.16 + DH, Q[1] - 0.2135), 0.0, 0.0, h=0.036, st='w')
inst('chair_high', CH['high'], (-0.55, DH, Q[1] + 0.95), 0.0)
R.station('stand_tao', (-0.55, DH + 1.28, Q[1] + 0.85), yaw=0.0, pitch=-0.19, fov=60)
# the TAO's red phone and the net microphone on its gooseneck
bx(S, 'Red', 0.02, 0.16, 0.73 + DH, 0.79 + DH, Q[1] + 0.05, Q[1] + 0.2)
S.beam('Black', (0.03, 0.8 + DH, Q[1] + 0.125), (0.15, 0.8 + DH, Q[1] + 0.125), 0.045, 0.035)
R.label('HOTLINE', (0.09, 0.76 + DH, Q[1] + 0.201), 0.0, 0.0, h=0.014, st='w')
bx(S, 'Black', -1.18, -1.08, 0.73 + DH, 0.76 + DH, Q[1] + 0.02, Q[1] + 0.12)
S.beam('Chrome', (-1.13, 0.76 + DH, Q[1] + 0.07), (-1.1, 1.0 + DH, Q[1] + 0.2), 0.012)
S.beam('Black', (-1.1, 1.0 + DH, Q[1] + 0.2), (-1.1, 1.03 + DH, Q[1] + 0.29), 0.025)
# the strike console: its display and the hard panel (weapon key, ARM, ABORT, LAUNCH under its guard, lamps)
SX = 1.2
P = Part('strike')
build_console(P, w=1.25, tall=False, screens=((-0.24, 0.56, 0.35, ()),), kbd=None)
add_part(S, P, (SX, DH, Q[1]), 0.0)
inst('kbd', lambda P: keyboard(P, 0.0, 0.0, y=0.0), (SX - 0.22, DH + 0.73, Q[1] + 0.25))
inst('tball', lambda P: trackball(P, 0.0, 0.0, y=0.0), (SX + 0.2, DH + 0.73, Q[1] + 0.25))
Mf, cf = R.mat3(0, LO[0]), (SX + 0.0, DH + LO[1][1], Q[1] + LO[1][2])
R.screen('screen_strike', R.xf(Mf, cf, (-0.24, 0.0, 0.002)), 0.0, LO[0], 0.56, 0.35, (1024, 640), bright=1.15)
hp = R.xf(Mf, cf, (0.35, 0.0, 0.0))              # the hard panel's centre, on the facade
ob(S, 'Panel', Mf, hp, -0.19, 0.19, -0.18, 0.18, 0.0, 0.006, skip=('nz',))
ob(S, 'Yellow', Mf, hp, -0.19, 0.19, 0.155, 0.165, 0.006, 0.008, skip=('nz',))
T = LO[0]
R.lamp('lamp_armed', R.xf(Mf, hp, (-0.11, 0.1, 0.006)), 0.0, T, r=0.014, color='#ffb020', mat='LampAmber', square=True)
R.label('ARMED', R.xf(Mf, hp, (-0.11, 0.055, 0.007)), 0.0, T, h=0.016, st='e')
R.lamp('lamp_launch', R.xf(Mf, hp, (0.0, 0.1, 0.006)), 0.0, T, r=0.014, color='#ff3a20', mat='LampRed', square=True)
R.label('LAUNCH', R.xf(Mf, hp, (0.0, 0.055, 0.007)), 0.0, T, h=0.016, st='e')
R.keyswitch('sw_key', R.xf(Mf, hp, (0.11, 0.1, 0.006)), 0.0, T)
R.label('WEAPON KEY', R.xf(Mf, hp, (0.11, 0.055, 0.007)), 0.0, T, h=0.014, st='e')
R.button('btn_arm', R.xf(Mf, hp, (-0.12, -0.03, 0.006)), 0.0, T, r=0.02, mat='Yellow', square=True)
R.label('ARM', R.xf(Mf, hp, (-0.12, -0.075, 0.007)), 0.0, T, h=0.016, st='e')
R.button('btn_abort', R.xf(Mf, hp, (-0.12, -0.13, 0.006)), 0.0, T, r=0.018, mat='White', square=True)
R.label('ABORT', R.xf(Mf, hp, (-0.03, -0.13, 0.007)), 0.0, T, h=0.016, st='e')
R.button('btn_launch', R.xf(Mf, hp, (0.09, -0.07, 0.006)), 0.0, T, r=0.026, mat='Red')
R.guard('guard_launch', R.xf(Mf, hp, (0.09, -0.07 + 0.048, 0.006)), 0.0, T, w=0.085, h=0.095, d=0.05)
R.label('LAUNCH', R.xf(Mf, hp, (0.09, -0.155, 0.007)), 0.0, T, h=0.018, st='r')
R.label('STRIKE · TLAM / TTWCS', (SX, 1.16 + DH, Q[1] - 0.2135), 0.0, 0.0, h=0.034, st='w')
inst('chair_std', CH['std'], (SX - 0.2, DH, Q[1] + 0.95), 0.1)
R.station('stand_strike', (SX - 0.05, DH + 1.2, Q[1] + 0.8), yaw=0.0, pitch=-0.42, fov=55)
# a TAO log stand on the aft of the dais
bx(S, 'Console', 2.0, 2.5, DH, DH + 1.05, 3.3, 3.8)
ob(S, 'Panel', R.mat3(PI, 0.5), (2.25, DH + 1.1, 3.55), -0.27, 0.27, -0.2, 0.2, -0.04, 0.0, skip=())
bx(S, 'White', 2.08, 2.42, DH + 1.12, DH + 1.13, 3.4, 3.7)
R.label('TAO LOG', (2.25, DH + 0.9, 3.299), PI, 0.0, h=0.04, st='w')
# the overhead monitors over the D&T row, facing the TAO (the flight deck camera, the ship's status)
for k, x in enumerate((-0.9, 0.9)):
    R.monitor(S, None, (x, 2.2, -1.35), PI, -0.25, w=0.85, h=0.5, depth=0.06, bezel=0.025, art=(4, 7)[k])
    R.oquad(S, 'Bezel', R.mat3(0, 0.25), (x, 2.2, -1.41), -0.45, 0.45, -0.28, 0.28, 0.0)
    for sx in (-0.3, 0.3):
        S.beam('Steel', (x + sx, 2.4, -1.38), (x + sx, H, -1.38), 0.03, caps=False)

# ═════════════ the undersea warfare module (aft port, behind low partitions) ═════════════
PH = 1.45
bx(S, 'WallDark', X0, -5.3, 0.0, PH, 2.27, 2.33, skip=('bottom',))
bx(S, 'WallDark', -5.33, -5.27, 0.0, PH, 2.27, 4.4, skip=('bottom',))
bx(S, 'Steel', X0, -5.25, PH, PH + 0.03, 2.25, 2.35, skip=())
bx(S, 'Steel', -5.35, -5.25, PH, PH + 0.03, 2.25, 4.42, skip=())
R.label('UNDERSEA WARFARE MODULE', (-7.0, 1.2, 2.265), PI, 0.0, h=0.055, st='big')
R.label('UNDERSEA WARFARE MODULE', (-5.265, 1.2, 3.3), PI / 2, 0.0, h=0.055, st='big')
for (z, title, up, lo, stand) in [(3.05, 'USW 1', 'screen_asw', 2, 'stand_asw'), (4.05, 'USW 2', 2, 1, None)]:
    q70(-8.45, z, PI / 2, upper=up, lower=lo, title=title, stand=stand)
# a sonobuoy / helo board on the aft bulkhead inside the module
bx(S, 'Steel', -8.9, -6.6, 1.0, 2.1, Z1 - 0.04, Z1)
R.oquad(S, 'Black', R.mat3(PI), (-7.75, 1.55, Z1 - 0.041), -1.1, 1.1, -0.5, 0.5, 0.0)
R.label('HELO / BUOY FIELD', (-7.75, 1.98, Z1 - 0.045), PI, 0.0, h=0.045, st='y')
for j, (a, b_) in enumerate([('702 DIP', 'PT 3'), ('703', 'READY DECK'), ('BUOYS', 'F1-F6 UP'), ('CONTACT', 'NONE')]):
    y = 1.78 - j * 0.14
    scrawl(S, a, (-6.75, y, Z1 - 0.041), (-1, 0, 0), (0, 1, 0), h=0.06, mat='LampWhite', seed=j + 120)
    scrawl(S, b_, (-7.75, y, Z1 - 0.041), (-1, 0, 0), (0, 1, 0), h=0.06, mat='LampGreen', seed=j + 140)
cabinet(S, -6.2, Z1 - 0.02, PI, w=0.6, d=0.5, h=1.3, title='SQQ-89 PRINTER', lights=False, seed=5)

# ═════════════ the EW alcove (aft starboard): the SLQ-32 console and its receiver rack ═════════════
bx(S, 'WallDark', 5.3, X1, 0.0, PH, 3.27, 3.33, skip=('bottom',))
bx(S, 'WallDark', 5.27, 5.33, 0.0, PH, 3.27, 4.4, skip=('bottom',))
bx(S, 'Steel', 5.25, X1, PH, PH + 0.03, 3.25, 3.35, skip=())
bx(S, 'Steel', 5.25, 5.35, PH, PH + 0.03, 3.25, 4.42, skip=())
R.label('EW MODULE · AN/SLQ-32(V)', (7.1, 1.2, 3.265), PI, 0.0, h=0.05, st='big')
q70(8.45, 4.2, -PI / 2, upper=4, lower=2, title='SLQ-32 · ESM')
cabinet(S, X1 - 0.02, 5.4, -PI / 2, w=0.8, d=0.55, h=2.0, title='SLQ-32 RCVR', seed=7)
cabinet(S, 6.3, Z1 - 0.02, PI, w=0.7, d=0.5, h=1.8, title='SSEE / NIXIE', seed=8)

# ═════════════ the aft bulkhead: doors, racks, the safe, the coffee mess ═════════════
def wt_door(name, x, z, yaw, kind, text, w=0.8, h=1.75):
    """a watertight door in its frame: coaming (knee-knocker), the leaf with six dogs and a lever (the node), the sign"""
    M = R.mat3(yaw)
    o = (x, 0.0, z)
    ob(S, 'Steel', M, o, -w / 2 - 0.12, w / 2 + 0.12, 0.0, h + 0.2, 0.0, 0.05)
    ob(S, 'Black', M, o, -w / 2, w / 2, 0.25, h + 0.05, 0.05, 0.051, skip=('nz',))
    ob(S, 'Yellow', M, o, -w / 2 - 0.12, w / 2 + 0.12, 0.0, 0.25, 0.05, 0.07)
    for k in range(4):
        xx = -w / 2 - 0.12 + (k + 0.5) * (w + 0.24) / 4
        ob(S, 'Black', M, o, xx - 0.04, xx + 0.04, 0.02, 0.23, 0.07, 0.072, skip=('nz',))
    P = Part(name)
    P.box('WallDark', -w / 2 + 0.02, w / 2 - 0.02, 0.27, h + 0.03, 0.05, 0.1)
    P.box('Steel', -w / 2 + 0.06, w / 2 - 0.06, 0.34, h - 0.04, 0.1, 0.108, skip=('nz',))
    for (dx, dy) in [(-w / 2 + 0.06, 0.55), (-w / 2 + 0.06, h - 0.2), (w / 2 - 0.06, 0.55), (w / 2 - 0.06, h - 0.2), (0, h), (0, 0.33)]:
        P.box('Metal', dx - 0.025, dx + 0.025, dy - 0.045, dy + 0.045, 0.1, 0.14, skip=('nz',))
    P.box('Metal', w / 2 - 0.2, w / 2 - 0.1, 1.0, 1.04, 0.108, 0.16, skip=('nz',))
    P.box('Red', w / 2 - 0.36, w / 2 - 0.19, 1.0, 1.04, 0.14, 0.16, skip=('nz',))
    R.node(name, P, o, yaw, 0.0, ctl={'t': kind})
    R.label(text, R.xf(M, o, (0, h + 0.3, 0.052)), yaw, 0.0, h=0.07, st='y')
    R.label('2-105-2-L', R.xf(M, o, (0, 1.55, 0.109)), yaw, 0.0, h=0.03, st='b')

wt_door('exit_door', -4.3, Z1, PI, 'exit', 'FLIGHT DECK / O-3 LADDER')
wt_door('door_prifly', 4.3, Z1, PI, 'door', 'LADDER TO PRI-FLY')
for sx in (-1, 1):
    extinguisher(S, sx * 5.05, Z1, PI, co2=True)          # by the doors (CO2: an electronics space)
    extinguisher(S, sx * X1, -0.35, -sx * PI / 2, co2=False)
    eebd(S, sx * 5.05, 1.5, Z1, PI)
    phone_box(S, sx * 3.55, 1.5, Z1, PI, title='SP PHONE · JA' if sx < 0 else 'DIAL · 4410')
    battle_lantern(S, sx * 3.55, 2.05, Z1, PI)
# racks along the aft bulkhead behind the dais (their backs on the bulkhead, fronts facing forward)
cabinet(S, -2.95, Z1, PI, w=0.7, d=0.6, h=1.95, title='SSDS MK 2 · LAN', seed=11)
cabinet(S, 1.65, Z1, PI, w=0.7, d=0.6, h=1.95, title='CEC · DDS', seed=12)
cabinet(S, 2.4, Z1, PI, w=0.7, d=0.6, h=1.95, title='LINK 16 · JTIDS', seed=13)
cabinet(S, 3.07, Z1, PI, w=0.5, d=0.6, h=1.95, title='GCCS-M', seed=14)
# the classified safe (four drawers, a combination dial) and the burn bag
M = R.mat3(PI)
SAFE = (0.75, 0.0, Z1)
ob(S, 'ConsoleLight', M, SAFE, -0.3, 0.3, 0.0, 1.35, 0.0, 0.6, skip=('bottom', 'nz'))
for j in range(4):
    yy = 0.06 + j * 0.32
    ob(S, 'ConsoleLight', M, SAFE, -0.27, 0.27, yy, yy + 0.29, 0.6, 0.612, skip=('bottom', 'nz'))
    ob(S, 'Chrome', M, SAFE, -0.08, 0.08, yy + 0.18, yy + 0.2, 0.612, 0.635, skip=('nz',))
R.ocyl(S, 'Black', M, SAFE, (0.0, 1.21, 0.6), 0.04, 0.04, 0.612, 0.64, 12, axis='z', cap0=False)
R.label('CLOSED', R.xf(M, SAFE, (0.0, 1.1, 0.613)), PI, 0.0, h=0.03, st='g')
burn_bag(S, 0.15, Z1 - 0.25)
# the coffee mess: a counter with the brewer, two pots and the mugs
CM = (-1.25, 0.0, Z1)
ob(S, 'Console', M, CM, -0.6, 0.6, 0.0, 0.9, 0.0, 0.55, skip=('bottom', 'nz'))
ob(S, 'Steel', M, CM, -0.62, 0.62, 0.9, 0.93, 0.0, 0.57, skip=('nz',))
ob(S, 'Black', M, CM, -0.35, 0.05, 0.93, 1.38, 0.05, 0.4, skip=('nz', 'bottom'))
ob(S, 'Black', M, CM, -0.35, 0.05, 1.38, 1.42, 0.05, 0.44, skip=('nz',))
for dx in (-0.25, -0.05):
    R.ocyl(S, 'Glass', M, CM, (dx, 0, 0.3), 0.07, 0.07, 0.95, 1.12, 12, axis='y')
    R.ocyl(S, 'Black', M, CM, (dx, 0, 0.3), 0.07, 0.065, 1.12, 1.16, 12, axis='y', cap0=False)
    R.ocyl(S, 'Black', M, CM, (dx, 0, 0.3), 0.075, 0.075, 0.93, 0.95, 12, axis='y', cap0=False)
for k in range(5):
    dx = 0.15 + k * 0.09
    R.ocyl(S, ('White', 'Blue', 'White', 'Red', 'Yellow')[k], M, CM, (dx, 0, 0.3 + (k % 2) * 0.1), 0.035, 0.035, 0.93, 1.03, 10, axis='y')
R.label('WARDROOM COFFEE MESS', R.xf(M, CM, (0.0, 1.62, 0.002)), PI, 0.0, h=0.03, st='b')
speaker(S, 0.0, 2.25, Z1, PI)
R.label('1MC', (0.0, 2.02, Z1 - 0.012), PI, 0.0, h=0.03, st='y')
R.label('NO FOOD OR DRINK AT CONSOLES', (-2.95, 2.08, Z1 - 0.012), PI, 0.0, h=0.03, st='r')
R.label('03-105-0-C', (-2.95, 2.3, Z1 - 0.012), PI, 0.0, h=0.05, st='b')

# ═════════════ side bulkheads: more fittings ═════════════
for (x, yaw) in ((X0, PI / 2), (X1, -PI / 2)):
    battle_lantern(S, x, 2.1, -1.2, yaw)
    battle_lantern(S, x, 2.1, 4.8, yaw)
    phone_box(S, x, 1.45, 2.1 if x < 0 else 2.4, yaw, title='SP PHONE · 21JS' if x < 0 else 'DIAL · 4411')
    speaker(S, x, 2.3, 1.1, yaw)
eebd(S, X1, 1.5, 1.3, -PI / 2)

# ═════════════ the overhead: trays, ducts, pipes, lights, signs, speakers ═════════════
# (deck beams every 1.2 m across; trays and ducts hang under their flanges at 2.385)
for (x, y, w_) in ((-3.0, H - 0.3, 0.32), (3.0, H - 0.3, 0.32), (-7.95, H - 0.34, 0.26), (7.95, H - 0.34, 0.26)):
    R.tray(S, (x, y, Z0 + 0.01), (x, y, Z1 - 0.01), w=w_, h=0.07)
    for zb, sg in ((Z0, 1), (Z1, -1)):       # the multi-cable transit frames where they go through the bulkheads
        bx(S, 'Steel', x - w_ / 2 - 0.06, x + w_ / 2 + 0.06, y - 0.06, y + 0.14, min(zb, zb + sg * 0.09), max(zb, zb + sg * 0.09), skip=())
        bx(S, 'Cable', x - w_ / 2 - 0.02, x + w_ / 2 + 0.02, y - 0.03, y + 0.11, min(zb, zb + sg * 0.095), max(zb, zb + sg * 0.095), skip=('bottom', 'top', 'px', 'nx'))
for z in (-4.8, 0.0, 3.6):
    R.tray(S, (-8.4, H - 0.16, z), (8.4, H - 0.16, z), w=0.28, h=0.06)
for x in (-3.0, 3.0, -7.95, 7.95):          # the trays' hangers, from every other beam
    for z in [Z0 + 0.6 + k * 2.4 for k in range(5)]:
        for sx in (-0.15, 0.15):
            S.beam('Steel', (x + sx, H - 0.305, z + 0.02), (x + sx, H - 0.215, z + 0.02), 0.016, caps=False)
# ventilation: two supply ducts fore-and-aft over the modules, square diffusers under them, a cross-connect aft
for x in (-6.7, 6.7):
    bx(S, 'PipeWhite', x - 0.28, x + 0.28, H - 0.5, H - 0.22, Z0 + 0.2, Z1 - 0.2, skip=('top',))
    for z in [Z0 + 0.45 + k * 1.5 for k in range(8)]:
        bx(S, 'Steel', x - 0.3, x + 0.3, H - 0.52, H - 0.215, z - 0.025, z + 0.025, skip=('top',))
    for z in (-4.6, -2.0, 0.6, 3.3):
        bx(S, 'Steel', x - 0.22, x + 0.22, H - 0.56, H - 0.5, z - 0.22, z + 0.22)
        for k in range(4):
            zz = z - 0.16 + k * 0.105
            bx(S, 'Black', x - 0.18, x + 0.18, H - 0.562, H - 0.56, zz - 0.02, zz + 0.02)
R.pipe(S, (-6.42, H - 0.45, 4.85), (6.42, H - 0.45, 4.85), 0.1, 'PipeWhite', 12)
for x in (-4.5, -1.5, 1.5, 4.5):
    S.beam('Steel', (x, H - 0.35, 4.85), (x, H - 0.215, 4.87), 0.02)
# the pipe runs along the sides (over the board walkways): firemain, chilled water supply and return (insulated),
# potable water, a drain
for sx in (-1, 1):
    for (d, y, r, m, fl) in ((0.15, H - 0.13, 0.055, 'PipeRed', True), (0.28, H - 0.3, 0.06, 'PipeWhite', True), (0.42, H - 0.3, 0.06, 'PipeWhite', False),
                             (0.15, H - 0.42, 0.03, 'PipeBlue', False), (0.28, H - 0.46, 0.035, 'PipeGreen', False)):
        x = sx * (X1 - d)
        R.pipe(S, (x, y, Z0 + 0.05), (x, y, Z1 - 0.05), r, m, 10 if r > 0.04 else 8, flanges=fl)
    R.valve_wheel(S, (sx * (X1 - 0.3), H - 0.52, 3.6), yaw=sx * PI / 2, r=0.1, mat='Red')
    S.beam('Steel', (sx * (X1 - 0.3), H - 0.52, 3.6), (sx * (X1 - 0.28), H - 0.36, 3.6), 0.025)
# electrical conduits along the overhead, with junction boxes
for x in (-5.5, -1.0, 1.0, 5.5):
    R.pipe(S, (x, H - 0.235, Z0 + 0.05), (x, H - 0.235, Z1 - 0.05), 0.013, 'Steel', 6, flanges=False)
    for z in (-3.6, 0.0, 3.6):
        bx(S, 'Steel', x - 0.07, x + 0.07, H - 0.33, H - 0.215, z - 0.07, z + 0.07)
# blue strip lights (the CDC's "blue light") between the beams
for x in (-7.3, -4.8, -2.0, 0.0, 2.0, 4.8, 7.3):
    for z in (-4.2, -1.8, 1.8, 4.2):
        if abs(x) < 3 and z < -3:
            continue          # (none in front of the LSDs: no glare on the screens)
        R.light_fixture(S, (x, H - 0.215, z + 0.6), w=0.16, l=0.9, along='z', mat='LightBlue')
# red night-lights by the doors
for x in (-4.3, 4.3):
    R.light_fixture(S, (x, H - 0.215, 5.4 + 0.3), w=0.12, l=0.4, along='x', mat='LightRed')
# hanging module signs (both faces lettered)
for (x, z, t) in ((-5.0, -2.55, 'AIR MODULE'), (5.0, -2.55, 'SURFACE MODULE'), (-0.55, 3.4, 'TAO')):
    hh = 0.09
    w_ = hh * 0.62 * len(t) + 0.2
    bx(S, 'Bezel', x - w_ / 2, x + w_ / 2, 2.03, 2.19, z - 0.015, z + 0.015, skip=())
    for sx in (-w_ / 2 + 0.08, w_ / 2 - 0.08):
        S.beam('Steel', (x + sx, 2.19, z), (x + sx, H, z), 0.012)
    R.label(t, (x, 2.11, z + 0.016), 0.0, 0.0, h=hh, st='big')
    R.label(t, (x, 2.11, z - 0.016), PI, 0.0, h=hh, st='big')
for (x, z) in ((-5.0, -5.4), (5.0, -5.4), (1.6, 2.4)):
    speaker(S, x, H - 0.5, z, 0.0, hang=H)

# ═════════════ more stations: the air detector-trackers in front, the EW attack console, the USW plotting desk ═════════════
for (x, title, lo) in [(-1.0, 'ID SUPV', 0), (0.0, 'AIR DETECTOR / TRACKER', 5), (1.0, 'RADAR SUPV', 6)]:
    q70(x, -3.85, 0.0, tall=False, lower=lo, title=title)
q70(6.5, 3.86, 0.0, tall=False, lower=3, title='SEWIP · EA')
bx(S, 'Console', -7.0, -5.62, 0.0, 0.74, 2.34, 2.9)
bx(S, 'Panel', -7.02, -5.6, 0.74, 0.77, 2.33, 2.92)
R.oquad(S, 'White', R.mat3(0, PI / 2), (-6.3, 0.771, 2.62), -0.3, 0.3, -0.2, 0.2, 0.0)
for k in range(6):                      # a sonobuoy pattern plotted on the chart
    a_ = k * PI / 3
    bx(S, 'Black', -6.3 + 0.13 * math.cos(a_) - 0.006, -6.3 + 0.13 * math.cos(a_) + 0.006, 0.771, 0.773, 2.62 + 0.13 * math.sin(a_) - 0.006, 2.62 + 0.13 * math.sin(a_) + 0.006)
inst('chair_std', CH['std'], (-6.3, 0.0, 3.35), PI + 0.25)
R.label('USW PLOT', (-6.3, 0.62, 2.901), 0.0, 0.0, h=0.035, st='w')

# ═════════════ hanging displays in front of the air and surface modules (the operators glance up at them) ═════════════
for (x, k) in ((-5.9, 5), (-4.5, 0), (4.5, 1), (5.9, 6)):
    R.monitor(S, None, (x, 2.1, -4.45), 0.0, -0.25, w=0.75, h=0.45, depth=0.06, bezel=0.025, art=k)
    for sx in (-0.25, 0.25):
        S.beam('Steel', (x + sx, 2.32, -4.52), (x + sx, H, -4.52), 0.025, caps=False)

# ═════════════ the small things: mugs, clipboards (checklists), binders, papers; deck mats ═════════════
def mug(x, y, z, mat='White'):
    S.cyl(mat, (x, 0, z), 0.04, 0.037, y, y + 0.095, 10, cap1=False)
    S.g('Black').face([(x + 0.035 * math.cos(2 * PI * i / 10), y + 0.08, z + 0.035 * math.sin(2 * PI * i / 10)) for i in range(10)], None, (0, 1, 0))
    S.beam(mat, (x + 0.038, y + 0.075, z), (x + 0.065, y + 0.05, z), 0.012, caps=False)
    S.beam(mat, (x + 0.065, y + 0.05, z), (x + 0.038, y + 0.022, z), 0.012, caps=False)

def clipboard(x, y, z, yaw, lines=5, seed=0):
    """a checklist on a clipboard, hung on a bulkhead or a partition"""
    M = R.mat3(yaw)
    o = (x, y, z)
    ob(S, 'Wood', M, o, -0.115, 0.115, -0.16, 0.16, 0.0, 0.006, skip=('nz',))
    ob(S, 'White', M, o, -0.105, 0.105, -0.15, 0.12, 0.006, 0.008, skip=('nz', 'bottom'))
    ob(S, 'Chrome', M, o, -0.045, 0.045, 0.11, 0.155, 0.006, 0.02, skip=('nz',))
    rr = random.Random(seed)
    for k in range(lines):
        yy = 0.08 - k * 0.045
        R.oquad(S, 'Black', M, o, -0.09, -0.09 + rr.uniform(0.08, 0.17), yy - 0.003, yy + 0.003, 0.0085)

def binders(x, y, z, yaw, n=4, seed=0):
    """binders standing on a shelf (their spines toward the room)"""
    M = R.mat3(yaw)
    rr = random.Random(seed)
    xx = -n * 0.03
    for i in range(n):
        w = rr.uniform(0.045, 0.07)
        hh = rr.uniform(0.28, 0.31)
        ob(S, rr.choice(('Blue', 'White', 'Red', 'Black', 'Green', 'Blue')), M, (x, y, z), xx, xx + w, 0.0, hh, -0.26, 0.0)
        ob(S, 'White', M, (x, y, z), xx + 0.01, xx + w - 0.01, hh * 0.55, hh * 0.72, 0.0, 0.002, skip=('nz', 'bottom'))
        xx += w + 0.004

def papers(x, y, z, yaw=0.0, n=2, seed=0):
    rr = random.Random(seed)
    for i in range(n):
        R.oquad(S, 'White', R.mat3(yaw + rr.uniform(-0.3, 0.3), PI / 2), (x + rr.uniform(-0.03, 0.03), y + 0.001 + i * 0.0015, z + rr.uniform(-0.03, 0.03)), -0.105, 0.105, -0.148, 0.148, 0.0)

# mugs on shelves (console-local x −0.38, z 0.33 → the world, by hand)
for (x, y, z, m) in ((-7.58, 0.73, -3.52, 'White'), (-5.58, 0.73, -3.52, 'Blue'), (4.58, 0.73, -3.52, 'White'), (-6.58, 0.73, -0.87, 'Red'),
                     (-1.38, 0.73, -0.87, 'White'), (-1.0, 0.73 + DH, Q[1] + 0.33, 'Blue'), (-2.38, 0.73 + DH, Q[1] + 0.33, 'White'), (1.35, 0.73, -3.52, 'Yellow')):
    mug(x, y, z, m)
# checklists hung round the room
for k, (x, y, z, yaw) in enumerate(((-5.265, 1.05, 3.85, PI / 2), (-5.265, 1.05, 3.55, PI / 2), (5.265, 1.05, 3.95, -PI / 2), (-8.99, 1.55, 3.6, PI / 2),
                                     (-3.95, 1.55, Z1 - 0.01, PI), (3.95, 1.4, Z1 - 0.01, PI), (8.99, 1.55, 3.9, -PI / 2),
                                     (X0 + 0.01, 1.5, -1.8, PI / 2), (X1 - 0.01, 1.5, -1.3, -PI / 2))):
    clipboard(x, y, z, yaw, seed=k)
R.label('EMCON BILL', (-3.95, 1.765, Z1 - 0.012), PI, 0.0, h=0.022, st='b')
R.label('BATTLE ORDERS', (3.95, 1.615, Z1 - 0.012), PI, 0.0, h=0.022, st='b')
# binders: on the TAO log stand, on the racks, on the coffee counter
binders(2.1, DH + 1.05, 3.8, PI, n=4, seed=3)
binders(-2.75, 1.95, Z1 - 0.1, PI, n=5, seed=4)
binders(2.2, 1.95, Z1 - 0.1, PI, n=6, seed=5)
binders(-1.7, 0.93, Z1 - 0.05, PI, n=3, seed=6)
papers(5.6, 0.912, -1.35, 0.3, n=3, seed=1)
papers(2.25, DH + 1.131, 3.55, 0.0, n=2, seed=2)
papers(-6.1, 0.772, 2.75, 0.2, n=2, seed=3)
# deck mats (black electrical-safety rubber) where the watchstanders sit
for (x0, x1, z0, z1, y) in ((-7.7, -3.75, -3.42, -2.3, 0.0), (3.75, 6.7, -3.42, -2.3, 0.0), (-7.7, -4.7, -0.72, 0.3, 0.0), (-1.5, 1.5, -0.72, 0.3, 0.0),
                            (-1.5, 1.5, -3.37, -2.35, 0.0), (-8.0, -6.9, 2.55, 4.6, 0.0), (-2.5, 1.9, 1.95, 2.95, DH), (-3.4, 3.4, -5.52, -5.05, 0.0)):
    S.g('Rubber').face([(x0, y + 0.003, z0), (x0, y + 0.003, z1), (x1, y + 0.003, z1), (x1, y + 0.003, z0)], None, (0, 1, 0))
# cable bundles dropping from the trays down the bulkheads to junction boxes
for (x, z, yaw) in ((X0, -4.8, PI / 2), (X0, 0.0, PI / 2), (X1, 0.0, -PI / 2), (X1, -4.8, -PI / 2), (-3.0, Z1, PI), (3.0, Z1, PI)):
    M = R.mat3(yaw)
    o = (x, 0.0, z)
    S.beam('Cable', R.xf(M, o, (0.0, H - 0.22, 0.05)), R.xf(M, o, (0.0, 1.95, 0.05)), 0.07, 0.04, caps=False)
    ob(S, 'ConsoleLight', M, o, -0.14, 0.14, 1.62, 1.95, 0.0, 0.12, skip=('nz',))
    ob(S, 'Black', M, o, -0.1, 0.1, 1.66, 1.68, 0.12, 0.122, skip=('nz', 'bottom'))

# ═════════════ spawn, walk areas, lights ═════════════
R.spawn((-4.3, 0.0, 5.25), yaw=0.0)
WALK = [
    [-3.75, 3.75, -5.45, -4.42, 0.0],       # in front of the LSDs
    [-3.75, -1.5, -4.42, -1.78, 0.0],       # beside the detector-trackers' row
    [1.5, 3.75, -4.42, -1.78, 0.0],
    [-1.5, 1.5, -3.35, -1.78, 0.0],         # behind it (to the D&T row's back)
    [-8.35, -3.75, -5.35, -4.42, 0.0],      # between the forward bulkhead and air row A
    [3.75, 8.35, -5.35, -4.42, 0.0],        # … and the surface row
    [-8.35, -7.7, -5.35, 2.22, 0.0],        # between the air boards and the air module
    [-8.8, -8.47, -5.3, 2.22, 0.0],         # the board writers' walkway (port)
    [-8.8, -8.3, -1.95, -1.6, 0.0],         # … its way in between the boards
    [-8.8, -8.3, 1.8, 2.22, 0.0],           # … and past the aft end
    [-7.7, -3.75, -2.95, -1.78, 0.0],       # behind air row A
    [-4.7, -3.75, -1.8, -0.35, 0.0],        # beside air row B
    [-2.72, -1.5, -1.8, -0.35, 0.0],        # beside the D&T row
    [1.5, 2.72, -1.8, -0.35, 0.0],
    [-8.35, 8.35, -0.4, 0.85, 0.0],         # the passage athwartships in front of the dais
    [-3.75, -2.7, -5.45, 5.35, 0.0],        # the port aisle beside the dais
    [2.7, 3.75, -5.45, 5.35, 0.0],          # the starboard aisle
    [3.75, 7.7, -2.95, -1.78, 0.0],         # behind the surface row
    [3.75, 4.2, -1.8, -0.35, 0.0],          # beside the DRT
    [6.1, 6.75, -1.8, -0.35, 0.0],          # between the DRT and the tracer
    [7.7, 8.35, -5.35, -0.35, 0.0],         # between the surface board and the consoles
    [8.47, 8.8, -5.3, -1.95, 0.0],          # the board writers' walkway (starboard)
    [8.3, 8.8, -1.95, -1.6, 0.0],
    [-8.35, -5.2, 0.85, 2.2, 0.0],          # outside the USW partition
    [-5.2, -3.75, 0.85, 4.05, 0.0],         # between the USW module and the dais
    [3.75, 5.2, 0.85, 4.05, 0.0],           # between the dais and the EW alcove
    [5.2, 8.35, 0.85, 3.2, 0.0],            # outside the EW alcove
    [-5.25, 5.25, 3.98, 5.35, 0.0],         # the aft passage (the doors)
    [-5.45, -5.2, 4.45, 5.35, 0.0],         # into the USW module
    [-7.95, -7.05, 2.4, 5.4, 0.0],          # inside the USW module (round the plotting desk)
    [-7.95, -5.4, 2.95, 5.4, 0.0],
    [-7.95, -6.55, 5.4, 5.8, 0.0],
    [5.2, 5.45, 4.45, 5.35, 0.0],           # into the EW alcove
    [5.4, 6.02, 3.4, 5.4, 0.0],             # inside the EW alcove (round the attack console)
    [6.98, 7.95, 3.4, 5.4, 0.0],
    [5.4, 7.95, 4.35, 5.4, 0.0],
    [-2.72, 2.72, 2.35, 3.25, DH],          # the dais behind the consoles
    [-2.72, 1.95, 3.25, 4.02, DH],
    [1.95, 2.72, 3.85, 4.02, DH],
]
LIGHTS = [
    {'t': 'hemi', 'sky': '#5a78a8', 'ground': '#0e141c', 'i': 0.42, 'name': 'amb'},
    {'t': 'point', 'p': [0.0, 2.25, -3.6], 'c': '#b4ccff', 'i': 3.5, 'd': 8.0, 'name': 'l1'},
    {'t': 'point', 'p': [-5.7, 2.2, -2.4], 'c': '#b4ccff', 'i': 4.5, 'd': 8.0, 'name': 'l2'},
    {'t': 'point', 'p': [5.7, 2.2, -2.4], 'c': '#b4ccff', 'i': 4.5, 'd': 8.0, 'name': 'l3'},
    {'t': 'point', 'p': [0.0, 2.3, 2.6], 'c': '#c8d8ff', 'i': 4.0, 'd': 7.5, 'name': 'l4'},
    {'t': 'point', 'p': [-6.8, 2.2, 4.0], 'c': '#9fbcff', 'i': 3.0, 'd': 6.0, 'name': 'l5'},
    {'t': 'point', 'p': [6.8, 2.2, 4.4], 'c': '#9fbcff', 'i': 3.0, 'd': 6.0, 'name': 'l6'},
]

# ═════════════ export: static geometry split into textured (with UVs) and plain (without) meshes ═════════════
def finish(out, meta):
    tris = 0
    for key, P in R.STATIC.items():
        if P.tris() == 0:
            continue
        tp, pp = Part(key + '_tex'), Part(key)
        for m, g in P.geo.items():
            (tp if textured(m) else pp).geo[m] = g
        if tp.tris():
            tp.build(parent=R.ROOT)
        if pp.tris():
            o = pp.build(parent=R.ROOT)
            o.data.uv_layers.remove(o.data.uv_layers[0])
        tris += P.tris()
    R.ROOT['room'] = json.dumps(meta, separators=(',', ':'))
    os.makedirs(os.path.dirname(os.path.abspath(out)), exist_ok=True)
    bpy.ops.export_scene.gltf(filepath=out, export_format='GLB', export_extras=True, export_yup=True,
                              export_materials='EXPORT', export_image_format='AUTO', export_cameras=False, export_lights=False)
    shared = sum(t for (_, t) in PROTOS.values())
    placed = sum(PROTOS[k][1] for k in INST)
    print('exported', out, os.path.getsize(out) // 1024, 'KB · static tris ~', tris, '· shared meshes', len(PROTOS), '(%d tris stored, %d drawn in %d copies)' % (shared, placed, len(INST)),
          '· nodes', len(R.NODES), '· labels', len(R.LABELS))

finish(OUT, {'walk': WALK, 'eye': 1.64, 'bg': '#020408', 'lights': LIGHTS})
