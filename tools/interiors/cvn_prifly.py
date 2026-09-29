# ═══════════════════════════════════════════════════════════════
# Nimitz-class carrier: Primary Flight Control ("Pri-Fly", the tower) — scripted model for Blender (headless):
#   blender -b -P tools/interiors/cvn_prifly.py -- models/interiors/cvn_prifly.glb
# The glass cab at the top of the island, overlooking the flight deck. A room WITH WINDOWS: the game draws it inside
# the world's scene (no room lights: 'lights' is empty; the world lights it), and its panes are material 'Glass'
# (see-through in the game). Walls are single-sided, facing in.
# Room frame: floor centre at the origin, x toward the bow, y up, −z toward the flight deck (the ship's port side).
# Where it sits: the Pri-Fly block of models/ships/carrier.glb (tools/ships/carrier_model.py: ship-local x 12.2..19.5,
# y 34.4..38.4, z 32.0..43.0). The room's origin is at ship-local (15.85, 34.4, 37.5), turned so that room +x = ship −z
# (the bow), room +z = ship +x (starboard), room −z = ship −x (port, the deck side): a yaw of +π/2 about y. The room
# spans x −5.4..5.4, z −3.6..3.6 (inside the block); its floor is laid 4 cm up (the island's roof below is at the
# origin) and its ceiling is at 3.35 (under the island's upper tier, whose underside is at 3.4). The deck-side panes
# and mullions line up with the island's window band (ship x 12.17, z 32.6..42.4, y 35.3..37.6: room x −4.9..4.9)
# and its outer mullions (room x ±0.7, ±2.1, ±3.5); the end windows with the fore / aft bands (room z −3.05..3.15).
# References:
#   • https://en.wikipedia.org/wiki/Air_boss — the Air Boss and the Mini Boss in Pri-Fly, visual control of the aircraft
#     in the carrier control zone
#   • https://commons.wikimedia.org/wiki/Category:Primary_Flight_Control_of_USS_Ronald_Reagan_(CVN-76) and
#     https://commons.wikimedia.org/wiki/File:Miniboss.jpg — the raised swivel chairs, the window console, launch
#     times logged in grease pencil, the arresting-gear screen
#   • https://www.globalsecurity.org/military/systems/ship/cvn-68-design.htm — Pri-Fly the top of the island
#   • https://en.wikipedia.org/wiki/Catapult_officer — the catapults the Mini Boss watches
# Layout (estimated): the deck-side windows lean out ~15° at the top over a long sill console — radio control heads,
# sound-powered phones, the flight deck 5MC microphone, true / relative wind repeaters, the arresting-gear and
# catapult status panels, the deck-status light switch (red / amber / green); the Air Boss's raised swivel chair at
# the aft end looking out at the landing area, the Mini Boss's at the forward end looking at the bow catapults, each
# with a sloped control panel on the sill; PLAT / ILARTS deck-camera monitors hung from the overhead over the windows;
# launch times written on the glass; the flight-deck status board, clocks, the radio rack, the air-plan desk, the
# ladder down to the flight deck and the door to the Combat Direction Center on the inner (starboard) wall.
# Build notes: repeated assemblies (the chairs) are one mesh shared by the nodes that place them, and static geometry
# of untextured materials is exported without UVs (see finish()).
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
OUT = args[0] if args else 'models/interiors/cvn_prifly.glb'

R.begin()
S = R.static()
X0, X1, Z0, Z1 = -5.4, 5.4, -3.6, 3.6
FY, H = 0.04, 3.35                       # the floor (4 cm over the island's roof) and the overhead
YS, YH = 0.97, 3.2                       # the glass: sill and head
TG = math.atan2(0.62, 2.25)              # the deck-side glass leans out ~15° at the top
ZT = Z0                                  # its head line (z)
ZB = ZT + (YH - YS) * math.tan(TG)       # its sill line (z ≈ −2.985)
ZC = -2.3                                # the front of the sill console
MXS = [-4.9, -3.5, -2.1, -0.7, 0.7, 2.1, 3.5, 4.9]      # deck-side mullions (the island's outer ones line up)
EZS = [-2.75, -1.5, 0.05, 1.6, 3.15]                     # the end windows' mullions (z)
MG = R.mat3(0, TG)                        # the glass's frame: x along, y up the glass, z out of it into the room
GN = (0.0, math.sin(TG), math.cos(TG))    # the glass's normal (into the room)
GU = (0.0, math.cos(TG), -math.sin(TG))   # up the glass
LG = math.hypot(YH - YS, ZB - ZT)         # the glass's slant height
rnd = random.Random(1972)

def gpt(x, s, out=0.0):
    """a point on the deck-side glass: x along, s = 0 (sill) … 1 (head), out = off the glass into the room"""
    return (x + GN[0] * out, YS + s * (YH - YS) + GN[1] * out, ZB + s * (ZT - ZB) + GN[2] * out)

# ═════════════ local helpers (roomkit is shared; this room's extras live here) ═════════════
# materials the game textures (src/warrooms.js ROOM_MATERIALS) or that need 0..1 UVs keep their UVs; the rest don't
TEXTURED = {'Deck', 'DeckTile', 'Carpet', 'Wall', 'WallDark', 'Ceiling', 'Panel', 'Concrete', 'ScreenArt', 'Label'}
def textured(m):
    return m in TEXTURED or m.startswith('Console')

def bx(P, mat, x0, x1, y0, y1, z0, z1, skip=('bottom',)):
    R.uvbox(P, mat, min(x0, x1), max(x0, x1), min(y0, y1), max(y0, y1), min(z0, z1), max(z0, z1), skip)

def ob(P, mat, M, o, x0, x1, y0, y1, z0, z1, skip=('bottom',)):
    R.obox(P, mat, M, o, x0, x1, y0, y1, z0, z1, skip)

def wq(mat, pts, n):
    """a wall face (UVs in metres in its plane)"""
    if abs(n[0]) > 0.5:
        uv = [(p[2], p[1]) for p in pts]
    elif abs(n[1]) > 0.7:
        uv = [(p[0], p[2]) for p in pts]
    else:
        uv = [(p[0], p[1]) for p in pts]
    S.g(mat).face(pts, uv, n)

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
    """a decorative screen: one of the game's eight static console pictures (warrooms.js screenArt)"""
    if 'ScreenArt' not in MATS:
        material('ScreenArt', srgb(0xffffff), 0.0, 0.3)
    k = int(k) % 8
    u0, v0 = (k % 4) / 4, (k // 4) / 2
    R.oquad(S, 'ScreenArt', R.mat3(yaw, tilt), c, -w / 2, w / 2, -h / 2, h / 2, 0.0,
            uv=[(u0, v0), (u0 + 0.25, v0), (u0 + 0.25, v0 + 0.5), (u0, v0 + 0.5)])

def bezel(S, M, c, w, h, e=0.016, d=0.008):
    """a raised frame round a screen let into a panel"""
    ob(S, 'Bezel', M, c, -w / 2 - e, w / 2 + e, h / 2, h / 2 + e, 0, d, skip=('nz',))
    ob(S, 'Bezel', M, c, -w / 2 - e, w / 2 + e, -h / 2 - e, -h / 2, 0, d, skip=('nz',))
    ob(S, 'Bezel', M, c, -w / 2 - e, -w / 2, -h / 2, h / 2, 0, d, skip=('nz',))
    ob(S, 'Bezel', M, c, w / 2, w / 2 + e, -h / 2, h / 2, 0, d, skip=('nz',))

def zy_slab(P, mat, x0, x1, poly):
    """a (z, y) outline extruded along x from x0 to x1 (a wedge, a console's cheek)"""
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

# ── grease pencil: a small stroke alphabet (cell 0.6 × 1) for the glass and the status board ──
_BOX = [(0, 0), (0.6, 0), (0.6, 1), (0, 1), (0, 0)]
FONT = {
    '0': [_BOX, [(0.05, 0.1), (0.55, 0.9)]], '1': [[(0.15, 0.8), (0.32, 1), (0.32, 0)]], '2': [[(0.02, 0.8), (0.3, 1), (0.6, 0.78), (0, 0), (0.6, 0)]],
    '3': [[(0, 1), (0.6, 1), (0.25, 0.55), (0.6, 0.35), (0.45, 0), (0, 0.05)]], '4': [[(0.45, 0), (0.45, 1), (0, 0.32), (0.6, 0.32)]],
    '5': [[(0.6, 1), (0.08, 1), (0.02, 0.56), (0.35, 0.62), (0.58, 0.45), (0.58, 0.15), (0.35, 0), (0, 0.06)]],
    '6': [[(0.5, 1), (0.02, 0.45), (0.1, 0), (0.55, 0.05), (0.55, 0.45), (0.05, 0.4)]],
    '7': [[(0, 1), (0.6, 1), (0.18, 0)]], '8': [[(0.3, 0.52), (0.02, 0.78), (0.3, 1), (0.58, 0.78), (0.3, 0.52), (0, 0.22), (0.3, 0), (0.6, 0.22), (0.3, 0.52)]],
    '9': [[(0.58, 0.55), (0.05, 0.6), (0.1, 1), (0.58, 1), (0.5, 0)]],
    'A': [[(0, 0), (0.3, 1), (0.6, 0)], [(0.13, 0.42), (0.47, 0.42)]], 'B': [[(0, 0), (0, 1), (0.48, 0.95), (0.5, 0.55), (0, 0.52)], [(0.5, 0.55), (0.6, 0.1), (0, 0)]],
    'C': [[(0.6, 0.85), (0.45, 1), (0.15, 1), (0, 0.8), (0, 0.2), (0.15, 0), (0.45, 0), (0.6, 0.15)]], 'D': [[(0, 0), (0, 1), (0.4, 0.95), (0.6, 0.5), (0.4, 0.03), (0, 0)]],
    'E': [[(0.6, 1), (0, 1), (0, 0), (0.6, 0)], [(0, 0.52), (0.45, 0.52)]], 'F': [[(0.6, 1), (0, 1), (0, 0)], [(0, 0.52), (0.45, 0.52)]],
    'G': [[(0.6, 0.85), (0.45, 1), (0.15, 1), (0, 0.8), (0, 0.2), (0.15, 0), (0.45, 0), (0.6, 0.2), (0.6, 0.45), (0.3, 0.45)]],
    'H': [[(0, 0), (0, 1)], [(0.6, 0), (0.6, 1)], [(0, 0.52), (0.6, 0.52)]],
    'I': [[(0.3, 0), (0.3, 1)], [(0.1, 1), (0.5, 1)], [(0.1, 0), (0.5, 0)]], 'J': [[(0.6, 1), (0.55, 0.05), (0.05, 0), (0, 0.3)]],
    'K': [[(0, 0), (0, 1)], [(0.6, 1), (0.02, 0.45), (0.6, 0)]], 'L': [[(0, 1), (0, 0), (0.6, 0)]], 'M': [[(0, 0), (0, 1), (0.3, 0.45), (0.6, 1), (0.6, 0)]],
    'N': [[(0, 0), (0, 1), (0.6, 0), (0.6, 1)]], 'O': [[(0.15, 0), (0.45, 0), (0.6, 0.2), (0.6, 0.8), (0.45, 1), (0.15, 1), (0, 0.8), (0, 0.2), (0.15, 0)]],
    'P': [[(0, 0), (0, 1), (0.55, 0.97), (0.58, 0.55), (0, 0.5)]],
    'Q': [_BOX, [(0.35, 0.3), (0.7, -0.1)]], 'R': [[(0, 0), (0, 1), (0.55, 0.97), (0.58, 0.55), (0, 0.5), (0.6, 0)]],
    'S': [[(0.6, 0.86), (0.45, 1.0), (0.12, 0.98), (0.0, 0.8), (0.1, 0.6), (0.5, 0.44), (0.6, 0.22), (0.47, 0.02), (0.1, 0.0), (0.0, 0.14)]],
    'T': [[(0, 1), (0.6, 1)], [(0.3, 1), (0.3, 0)]],
    'U': [[(0, 1), (0, 0.2), (0.15, 0), (0.45, 0), (0.6, 0.2), (0.6, 1)]], 'V': [[(0, 1), (0.3, 0), (0.6, 1)]], 'W': [[(0, 1), (0.13, 0), (0.3, 0.6), (0.47, 0), (0.6, 1)]],
    'X': [[(0, 0), (0.6, 1)], [(0, 1), (0.6, 0)]], 'Y': [[(0, 1), (0.3, 0.5), (0.6, 1)], [(0.3, 0.5), (0.3, 0)]], 'Z': [[(0, 1), (0.6, 1), (0, 0), (0.6, 0)]],
    '/': [[(0, 0), (0.6, 1)]], '-': [[(0.1, 0.5), (0.5, 0.5)]], '+': [[(0.05, 0.5), (0.55, 0.5)], [(0.3, 0.25), (0.3, 0.75)]],
    ':': [[(0.3, 0.2), (0.3, 0.32)], [(0.3, 0.68), (0.3, 0.8)]], '.': [[(0.3, 0), (0.3, 0.1)]], '>': [[(0.05, 0.9), (0.55, 0.5), (0.05, 0.1)]],
}
def scrawl(S, text, o, eu, ev, h=0.05, mat='Yellow', seed=1, slant=0.15, adv=0.82, lift=0.004, t=None):
    """handwriting in thin strokes on a plane: o = the start of the baseline, eu along the line, ev up (the strokes face
    eu × ev); each stroke one strip with mitred joints. Returns the length written"""
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
    """a panel of bat toggles and square lamps (static detail)"""
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

def clock(S, c, yaw, r=0.14, title=None, hands=(0.3, 2.1), tilt=0.0):
    M = R.mat3(yaw, tilt)
    R.ocyl(S, 'Black', M, c, (0, 0, 0), r * 1.1, r * 1.1, -0.05, 0.0, 20, axis='z', cap0=False)
    R.ocyl(S, 'White', M, c, (0, 0, 0), r, r, -0.04, 0.002, 20, axis='z', cap0=False)
    for k in range(12):
        a = k * PI / 6
        s = 0.16 if k % 3 == 0 else 0.1
        R.oquad(S, 'Black', M @ R.mat3(0, 0, -a), c, -0.004, 0.004, r * (0.92 - s), r * 0.92, 0.004)
    for a, L, t in ((hands[0], 0.55, 0.012), (hands[1], 0.82, 0.008)):
        R.oquad(S, 'Black', M @ R.mat3(0, 0, -a), c, -t / 2, t / 2, -r * 0.1, r * L, 0.006)
    if title:
        R.label(title, R.xf(M, c, (0, -r * 1.1 - 0.045, 0.0)), yaw, tilt, h=0.032, st='w')

def dial(S, c, M, r=0.06, needle=0.0):
    """a round indicator (wind direction): rim, face, ticks, the needle"""
    R.ocyl(S, 'Black', M, c, (0, 0, 0), r * 1.15, r * 1.15, 0.0, 0.012, 16, axis='z', cap0=False)
    R.ocyl(S, 'White', M, c, (0, 0, 0), r, r, 0.012, 0.014, 16, axis='z', cap0=False)
    for k in range(8):
        a = k * PI / 4
        R.oquad(S, 'Black', M @ R.mat3(0, 0, -a), c, -0.002, 0.002, r * 0.75, r * 0.95, 0.0145)
    R.oquad(S, 'Red', M @ R.mat3(0, 0, -needle), c, -0.004, 0.004, -r * 0.2, r * 0.85, 0.016)

def extinguisher(S, x, z, yaw, co2=False):
    M = R.mat3(yaw)
    o = (x, FY, z)
    ob(S, 'Steel', M, o, -0.1, 0.1, 0.5, 0.56, 0.0, 0.02)
    R.ocyl(S, 'Red', M, o, (0, 0, 0.1), 0.085 if co2 else 0.075, 0.085 if co2 else 0.075, 0.42, 1.0, 12, axis='y')
    R.ocyl(S, 'Red', M, o, (0, 0, 0.1), 0.085 if co2 else 0.075, 0.03, 1.0, 1.08, 12, axis='y', cap0=False)
    R.ocyl(S, 'Black', M, o, (0, 0, 0.1), 0.02, 0.02, 1.08, 1.14, 8, axis='y', cap0=False)
    S.beam('Black', R.xf(M, o, (0, 1.13, 0.1)), R.xf(M, o, (0.12, 1.1, 0.1)), 0.02, 0.012)
    S.beam('Black', R.xf(M, o, (0.0, 1.1, 0.1)), R.xf(M, o, (-0.09, 0.7, 0.19)), 0.016)
    ob(S, 'Steel', M, o, -0.1, 0.1, 0.9, 0.95, 0.0, 0.02)
    R.label('CO2' if co2 else 'PKP', R.xf(M, o, (0, 1.32, 0.002)), yaw, 0.0, h=0.045, st='r')

def phone_box(S, x, y, z, yaw, title=None, tilt=0.0):
    """a ship's telephone: the grey box, the handset in its cradle, a keypad"""
    M = R.mat3(yaw, tilt)
    o = (x, y, z)
    ob(S, 'ConsoleLight', M, o, -0.1, 0.1, -0.16, 0.16, 0.0, 0.08, skip=())
    ob(S, 'Black', M, o, -0.075, -0.02, -0.13, 0.13, 0.08, 0.11, skip=('nz',))
    for dy in (-0.11, 0.11):
        ob(S, 'Black', M, o, -0.08, -0.015, dy - 0.028, dy + 0.028, 0.1, 0.13, skip=('nz',))
    for k in range(12):
        xx, yy = 0.03 + (k % 3) * 0.022, 0.06 - (k // 3) * 0.028
        R.oquad(S, 'White', M, o, xx - 0.008, xx + 0.008, yy - 0.008, yy + 0.008, 0.081)
    if title:
        R.label(title, R.xf(M, o, (0.0, 0.2, 0.001)), yaw, tilt, h=0.028, st='y')

def speaker(S, x, y, z, yaw, hang=None):
    M = R.mat3(yaw, -0.3)
    o = (x, y, z)
    ob(S, 'ConsoleLight', M, o, -0.14, 0.14, -0.11, 0.11, 0.0, 0.13, skip=())
    for k in range(5):
        yy = -0.075 + k * 0.035
        R.oquad(S, 'Black', M, o, -0.11, 0.11, yy - 0.008, yy + 0.008, 0.1305)
    if hang:
        S.beam('Steel', R.xf(M, o, (0, 0.11, 0.06)), (x, hang, z), 0.02)

def mug(x, y, z, mat='White'):
    S.cyl(mat, (x, 0, z), 0.04, 0.037, y, y + 0.095, 10, cap1=False)
    S.g('Black').face([(x + 0.035 * math.cos(2 * PI * i / 10), y + 0.08, z + 0.035 * math.sin(2 * PI * i / 10)) for i in range(10)], None, (0, 1, 0))
    S.beam(mat, (x + 0.038, y + 0.075, z), (x + 0.065, y + 0.05, z), 0.012, caps=False)
    S.beam(mat, (x + 0.065, y + 0.05, z), (x + 0.038, y + 0.022, z), 0.012, caps=False)

def clipboard(x, y, z, yaw, tilt=0.0, lines=5, seed=0):
    M = R.mat3(yaw, tilt)
    o = (x, y, z)
    ob(S, 'Wood', M, o, -0.115, 0.115, -0.16, 0.16, 0.0, 0.006, skip=('nz',))
    ob(S, 'White', M, o, -0.105, 0.105, -0.15, 0.12, 0.006, 0.008, skip=('nz', 'bottom'))
    ob(S, 'Chrome', M, o, -0.045, 0.045, 0.11, 0.155, 0.006, 0.02, skip=('nz',))
    rr = random.Random(seed)
    for k in range(lines):
        yy = 0.08 - k * 0.045
        R.oquad(S, 'Black', M, o, -0.09, -0.09 + rr.uniform(0.08, 0.17), yy - 0.003, yy + 0.003, 0.0085)

def papers(x, y, z, yaw=0.0, n=2, seed=0):
    rr = random.Random(seed)
    for i in range(n):
        R.oquad(S, 'White', R.mat3(yaw + rr.uniform(-0.3, 0.3), PI / 2), (x + rr.uniform(-0.03, 0.03), y + 0.001 + i * 0.0015, z + rr.uniform(-0.03, 0.03)), -0.105, 0.105, -0.148, 0.148, 0.0)

def cabinet(S, x, z, yaw, w=0.6, d=0.6, h=1.9, body='Console', face='ConsoleLight', title=None, lights=True, st='b', seed=0):
    """an equipment rack with its back at (x, z) against a bulkhead, its front turned by yaw (0: facing +z)"""
    M = R.mat3(yaw)
    o = (x, FY, z)
    ob(S, body, M, o, -w / 2, w / 2, 0.0, h, 0.0, d, skip=('bottom', 'nz'))
    ob(S, face, M, o, -w / 2 + 0.03, w / 2 - 0.03, 0.08, h - 0.05, d, d + 0.012, skip=('bottom', 'nz'))
    ob(S, 'Chrome', M, o, w / 2 - 0.08, w / 2 - 0.065, h * 0.45, h * 0.6, d + 0.012, d + 0.028, skip=('nz',))
    for k in range(6):
        yy = 0.14 + k * 0.035
        R.oquad(S, 'Black', M, o, -w / 2 + 0.08, w / 2 - 0.08, yy, yy + 0.016, d + 0.0125)
    if lights:
        switches(S, M, R.xf(M, o, (0.0, h - 0.42, d + 0.012)), cols=5, rows=2, pitch=0.05, seed=seed)
    if title:
        R.label(title, R.xf(M, o, (0.0, h - 0.12, d + 0.014)), yaw, 0.0, h=0.03, st=st)

def radio_head(x, z, title, yaw=0.0, seed=0):
    """a radio control head standing on the sill: grey case, its face tipped up, a green display, two knobs, keys"""
    M = R.mat3(yaw)
    o = (x, YS, z)
    ob(S, 'ConsoleLight', M, o, -0.09, 0.09, 0.0, 0.12, -0.12, 0.0)
    Mf = R.mat3(yaw, 0.35)
    f = R.xf(M, o, (0.0, 0.07, 0.0))
    ob(S, 'Console', Mf, f, -0.09, 0.09, -0.07, 0.06, -0.02, 0.0, skip=('nz',))
    R.oquad(S, 'LampGreen', Mf, f, -0.07, 0.02, 0.0, 0.035, 0.001)
    for kx in (0.045, -0.055):
        R.ocyl(S, 'Black', Mf, f, (kx, -0.035 if kx < 0 else 0.015, 0.0), 0.016, 0.014, 0.0, 0.02, 10, axis='z', cap0=False)
    for k in range(3):
        R.oquad(S, 'Panel', Mf, f, -0.02 + k * 0.022, -0.004 + k * 0.022, -0.045, -0.03, 0.001)
    R.label(title, R.xf(Mf, f, (0.0, 0.052, 0.002)), yaw, 0.35, h=0.012, st='e')

def handset(x, y, z, yaw):
    """a sound-powered phone handset hanging in its cradle on the console's front"""
    M = R.mat3(yaw)
    o = (x, y, z)
    ob(S, 'Black', M, o, -0.035, 0.035, -0.1, 0.1, 0.0, 0.03, skip=('nz',))
    S.beam('Black', R.xf(M, o, (0, -0.09, 0.045)), R.xf(M, o, (0, 0.09, 0.045)), 0.028, 0.03)
    for dy in (-0.1, 0.1):
        R.ocyl(S, 'Black', M, o, (0, dy, 0), 0.027, 0.027, 0.02, 0.07, 8, axis='z')
    S.beam('Cable', R.xf(M, o, (0, -0.12, 0.04)), R.xf(M, o, (0.05, -0.35, 0.05)), 0.01, caps=False)

def binoculars(x, y, z, yaw):
    """a pair of 7×50s lying on a surface"""
    M = R.mat3(yaw)
    o = (x, y, z)
    for sx in (-0.045, 0.045):
        R.ocyl(S, 'Black', M, o, (sx, 0.04, 0.0), 0.034, 0.03, -0.09, 0.08, 10, axis='z')
        R.ocyl(S, 'Glass', M, o, (sx, 0.04, 0.0), 0.028, 0.028, 0.08, 0.082, 10, axis='z', cap0=False)
    ob(S, 'Black', M, o, -0.03, 0.03, 0.025, 0.06, -0.02, 0.05, skip=())

# ═════════════════════════════════ the shell ═════════════════════════════════
wq('DeckTile', [(X0, FY, ZB), (X0, FY, Z1), (X1, FY, Z1), (X1, FY, ZB)], (0, 1, 0))
wq('Ceiling', [(X0, H, Z0), (X1, H, Z0), (X1, H, Z1), (X0, H, Z1)], (0, -1, 0))
wq('Wall', [(X0, FY, Z1), (X1, FY, Z1), (X1, H, Z1), (X0, H, Z1)], (0, 0, -1))              # the inner (starboard) wall
wq('Wall', [(X0, FY, ZB), (X1, FY, ZB), (X1, YS, ZB), (X0, YS, ZB)], (0, 0, 1))              # under the sill
wq('Wall', [(X0, YH, ZT), (X1, YH, ZT), (X1, H, ZT), (X0, H, ZT)], (0, 0, 1))                # over the glass
for sx in (-1, 1):                                                                           # the solid corners of the slanted wall
    a, b = (X0, MXS[0]) if sx < 0 else (MXS[-1], X1)
    wq('Wall', [gpt(a, 0), gpt(b, 0), gpt(b, 1), gpt(a, 1)], GN)
S.g('Steel').face([(X0, YS - 0.015, ZT - 0.04), (X1, YS - 0.015, ZT - 0.04), (X1, YS - 0.015, ZB), (X0, YS - 0.015, ZB)], None, (0, 1, 0))   # the outside sill ledge
# the end walls (aft x0 facing +x, forward x1 facing −x), each round its window
for (x, n) in ((X0, (1, 0, 0)), (X1, (-1, 0, 0))):
    ez0, ez1 = EZS[0], (EZS[-1] if x < 0 else 2.95)
    wq('Wall', [(x, FY, ZB), (x, FY, Z1), (x, YS, Z1), (x, YS, ZB)], n)
    wq('Wall', [(x, YH, ZT), (x, YH, Z1), (x, H, Z1), (x, H, ZT)], n)
    wq('Wall', [(x, YS, ez1), (x, YS, Z1), (x, YH, Z1), (x, YH, ez1)], n)
    wq('Wall', [(x, YS, ZB), (x, YS, ez0), (x, YH, ez0), (x, YH, ZT)], n)
# a dark cove base
bx(S, 'Rubber', X0, X1, FY, FY + 0.1, Z1 - 0.02, Z1)
for x in (X0, X1 - 0.02):
    bx(S, 'Rubber', x, x + 0.02, FY, FY + 0.1, ZB, Z1)

# ═════════════ the windows: panes, mullions, rails, wipers outside, blinds at the head ═════════════
for x in MXS:
    wm = 0.06 if abs(x) > 4.8 else 0.05
    ob(S, 'Steel', MG, (x, (YS + YH) / 2, (ZB + ZT) / 2), -wm, wm, -LG / 2, LG / 2, 0.0, 0.1, skip=())
ob(S, 'Steel', MG, (0.0, (YS + YH) / 2, (ZB + ZT) / 2), X0, X1, LG / 2 - 0.06, LG / 2, 0.0, 0.12, skip=())
ob(S, 'Steel', MG, (0.0, (YS + YH) / 2, (ZB + ZT) / 2), X0, X1, -LG / 2, -LG / 2 + 0.05, 0.0, 0.08, skip=())
for a, b in zip(MXS, MXS[1:]):
    S.g('Glass').face([gpt(a + 0.05, 0.02), gpt(b - 0.05, 0.02), gpt(b - 0.05, 0.975), gpt(a + 0.05, 0.975)], None, GN)
    xc = (a + b) / 2
    # the wiper outside: its arm from a pivot under the pane, the blade across the glass
    p0 = gpt(xc + 0.25, 0.03, -0.035)
    p1 = gpt(xc - 0.2, 0.42, -0.035)
    S.beam('Black', p0, p1, 0.016, 0.01, caps=False)
    S.beam('Black', gpt(xc - 0.36, 0.3, -0.025), gpt(xc - 0.04, 0.54, -0.025), 0.02, 0.012, caps=False)
    R.ocyl(S, 'Black', MG, gpt(xc + 0.25, 0.03, -0.035), (0, 0, 0), 0.025, 0.025, -0.03, 0.0, 8, axis='z')
    # a roller blind at the head (one half drawn)
    R.ocyl(S, 'Black', R.mat3(0), gpt(xc, 0.955, 0.06), (0, 0, 0), 0.032, 0.032, a + 0.08 - xc, b - 0.08 - xc, 8, axis='x')
    if abs(xc + 2.8) < 0.1 or abs(xc - 4.2) < 0.1:
        S.g('Black').face([gpt(a + 0.1, 0.955, 0.04), gpt(b - 0.1, 0.955, 0.04), gpt(b - 0.1, 0.72, 0.04), gpt(a + 0.1, 0.72, 0.04)], None, GN)
for (x, n) in ((X0, 1), (X1, -1)):
    ez = EZS if x < 0 else EZS[:-1] + [2.95]
    for z in ez:
        bx(S, 'Steel', x if n > 0 else x - 0.1, x + 0.1 if n > 0 else x, YS, YH, z - 0.05, z + 0.05, skip=())
    bx(S, 'Steel', x if n > 0 else x - 0.12, x + 0.12 if n > 0 else x, YH - 0.05, YH, ez[0] - 0.05, ez[-1] + 0.05, skip=())
    bx(S, 'Steel', x if n > 0 else x - 0.35, x + 0.35 if n > 0 else x, YS - 0.03, YS, ez[0] - 0.05, ez[-1] + 0.05, skip=())   # the end sills (shelves)
    for a, b in zip(ez, ez[1:]):
        S.g('Glass').face([(x, YS, a + 0.05), (x, YS, b - 0.05), (x, YH - 0.05, b - 0.05), (x, YH - 0.05, a + 0.05)], None, (n, 0, 0))
        zc = (a + b) / 2
        S.beam('Black', (x - n * 0.03, YS + 0.05, zc + 0.3), (x - n * 0.03, YS + 0.9, zc - 0.25), 0.016, 0.01, caps=False)
# launch times and the recovery plan in grease pencil on the glass (written from inside)
for (x, s, txt, m) in ((-3.38, 0.9, 'EVENT 3', 'Yellow'), (-3.38, 0.82, 'LNCH 1430', 'Yellow'), (-3.38, 0.74, 'RCVY 1545', 'Yellow'),
                       (-3.38, 0.66, 'CASE I', 'White'), (-1.98, 0.9, 'BRC 095', 'White'), (-1.98, 0.82, 'WIND 25', 'White'),
                       (-1.98, 0.74, 'CAT 1 2 3', 'Yellow'), (-1.98, 0.66, 'PLANE GUARD 702', 'Red'), (2.22, 0.9, 'EVENT 4', 'Yellow'),
                       (2.22, 0.82, '1600 / 1715', 'Yellow'), (2.22, 0.74, 'ALERT 5: 100 101', 'Red'), (3.62, 0.9, 'LAST LAUNCH', 'White'),
                       (3.62, 0.82, '1447', 'White')):
    scrawl(S, txt, gpt(x, s, 0.0), (1, 0, 0), GU, h=0.075, mat=m, seed=int(abs(x) * 10 + s * 100), lift=0.006)

# ═════════════ the sill console along the deck-side windows ═════════════
SX0, SX1 = X0 + 0.2, X1 - 0.2
bx(S, 'Console', SX0, SX1, FY, YS - 0.03, ZB, ZC, skip=('bottom', 'nz'))
bx(S, 'Panel', SX0 - 0.02, SX1 + 0.02, YS - 0.03, YS, ZB - 0.03, ZC + 0.03, skip=('bottom',))
bx(S, 'Rubber', SX0 - 0.02, SX1 + 0.02, YS - 0.035, YS + 0.005, ZC + 0.03, ZC + 0.055, skip=('bottom', 'nz'))
bx(S, 'Black', SX0 + 0.02, SX1 - 0.02, FY, FY + 0.09, ZC - 0.03, ZC + 0.002, skip=('bottom', 'nz'))
xx = SX0 + 0.05
while xx < SX1 - 0.5:                        # doors along its front, with louvres and pulls
    ob(S, 'ConsoleLight', R.mat3(0), (xx + 0.44, FY, ZC), -0.42, 0.42, 0.13, YS - 0.1, 0.0, 0.01, skip=('bottom', 'nz'))
    R.oquad(S, 'Chrome', R.mat3(0), (xx + 0.44, FY, ZC), -0.08, 0.08, YS - 0.2, YS - 0.18, 0.012)
    for k in range(4):
        R.oquad(S, 'Black', R.mat3(0), (xx + 0.44, FY, ZC), -0.34, 0.34, 0.2 + k * 0.035, 0.216 + k * 0.035, 0.0105)
    xx += 0.9

# the boss panels: sloped desks on the sill in front of the two chairs
TP = math.atan2(0.56, 0.28)
def boss_panel(xc, w=1.9, title=''):
    poly = [(ZC - 0.04, YS), (-2.9, 1.25), (-2.96, 1.25), (-2.96, YS)]
    zy_slab(S, 'Console', xc - w / 2, xc + w / 2, poly)
    M = R.mat3(0, TP)
    c = (xc, (YS + 1.25) / 2, (ZC - 0.04 - 2.9) / 2)
    ob(S, 'Panel', M, c, -w / 2 + 0.015, w / 2 - 0.015, -0.3, 0.3, 0.0, 0.006, skip=('nz',))
    if title:
        R.label(title, R.xf(M, c, (0.0, 0.285, 0.007)), 0.0, TP, h=0.02, st='w')
    return M, c

# ── the Air Boss's panel: the wind (left), the deck-status selector and its lamps, the four action buttons, the
#    flight-deck status / air plan (right) ──
MB, CB = boss_panel(-2.65, title='AIR BOSS')
PB = lambda lx, ly, lz=0.006: R.xf(MB, CB, (lx, ly, lz))
bezel(S, MB, PB(-0.69, 0.0), 0.44, 0.275)
R.screen('screen_wind', PB(-0.69, 0.0, 0.0075), 0.0, TP, 0.44, 0.275, (768, 480))
bezel(S, MB, PB(0.68, 0.0), 0.5, 0.3125)
R.screen('screen_deck', PB(0.68, 0.0, 0.0075), 0.0, TP, 0.5, 0.3125, (1024, 640))
ob(S, 'Bezel', MB, PB(0.0, 0.0, 0.0), -0.44, 0.4, -0.29, 0.26, 0.006, 0.008, skip=('nz',))
for k, (nm, col, mat, t) in enumerate((('lamp_red', '#ff3a20', 'LampRed', 'RED'), ('lamp_amber', '#ffb020', 'LampAmber', 'AMBER'), ('lamp_green', '#30ff60', 'LampGreen', 'GREEN'))):
    x = -0.13 + k * 0.13
    R.lamp(nm, PB(x, 0.2, 0.008), 0.0, TP, r=0.02, color=col, mat=mat, square=True)
    R.label(t, PB(x, 0.155, 0.009), 0.0, TP, h=0.016, st='e')
R.knob('knob_deck', PB(0.0, 0.05, 0.008), 0.0, TP, r=0.034, steps=3, arc=1.6)
R.label('DECK STATUS', PB(0.0, -0.01, 0.009), 0.0, TP, h=0.016, st='e')
for (x, t) in ((-0.075, 'R'), (0.0, 'A'), (0.075, 'G')):
    R.label(t, PB(x, 0.105 if t == 'A' else 0.085, 0.009), 0.0, TP, h=0.013, st='e')
R.button('btn_horn', PB(-0.3, -0.1, 0.008), 0.0, TP, r=0.024, mat='Yellow')
R.label('HORN / 5MC', PB(-0.3, -0.165, 0.009), 0.0, TP, h=0.013, st='e')
R.button('btn_spot', PB(-0.1, -0.1, 0.008), 0.0, TP, r=0.022, mat='Blue', square=True)
R.label('SPOT JET CAT 1', PB(-0.1, -0.215, 0.009), 0.0, TP, h=0.013, st='e')
R.button('btn_launch', PB(0.1, -0.1, 0.008), 0.0, TP, r=0.026, mat='Red')
R.guard('guard_launch', PB(0.1, -0.052, 0.008), 0.0, TP, w=0.085, h=0.095, d=0.05)
R.label('LAUNCH ALERT FIGHTER', PB(0.1, -0.175, 0.009), 0.0, TP, h=0.013, st='r')
R.button('btn_recover', PB(0.3, -0.1, 0.008), 0.0, TP, r=0.024, mat='Green', square=True)
R.label('RECOVERY — TURN INTO WIND', PB(0.3, -0.215, 0.009), 0.0, TP, h=0.0125, st='e')
switches(S, MB, PB(-0.32, 0.17, 0.008), cols=4, rows=2, pitch=0.04, seed=3)
switches(S, MB, PB(0.3, 0.17, 0.008), cols=4, rows=2, pitch=0.04, seed=4)
# the 5MC flight-deck microphone on its gooseneck, the boss's headset
bx(S, 'Black', -1.67, -1.57, YS, YS + 0.03, -2.72, -2.62)
S.beam('Chrome', (-1.62, YS + 0.03, -2.67), (-1.64, YS + 0.3, -2.55), 0.012, caps=False)
S.beam('Chrome', (-1.64, YS + 0.3, -2.55), (-1.76, YS + 0.36, -2.45), 0.012, caps=False)
R.ocyl(S, 'Black', R.mat3(1.0, -0.6), (-1.76, YS + 0.36, -2.45), (0, 0, 0), 0.02, 0.026, 0.0, 0.07, 10, axis='z')
R.label('5MC', (-1.62, YS + 0.015, -2.619), 0.0, 0.0, h=0.012, st='y')

# ── the Mini Boss's panel: catapult status lamps, the catapult / arresting gear screen, a camera repeater ──
MM, CM = boss_panel(2.65, title='MINI BOSS')
PM = lambda lx, ly, lz=0.006: R.xf(MM, CM, (lx, ly, lz))
bezel(S, MM, PM(0.69, 0.0), 0.44, 0.275)
R.screen('screen_cats', PM(0.69, 0.0, 0.0075), 0.0, TP, 0.44, 0.275, (768, 480))
bezel(S, MM, PM(-0.69, 0.0), 0.44, 0.275)
art(S, PM(-0.69, 0.0, 0.0075), 0.0, TP, 0.44, 0.275, 4)
ob(S, 'Bezel', MM, PM(0.0, -0.01, 0.0), -0.42, 0.42, -0.27, 0.25, 0.006, 0.008, skip=('nz',))
R.label('CAT', PM(-0.33, 0.215, 0.009), 0.0, TP, h=0.015, st='e')
for j, t in enumerate(('SUSPEND', 'STANDBY', 'FINAL RDY', 'LAUNCH')):
    R.label(t, PM(-0.18 + j * 0.13, 0.215, 0.009), 0.0, TP, h=0.013, st='e')
lit = {(0, 2), (1, 1), (2, 0), (3, 1)}
for i in range(4):
    y = 0.16 - i * 0.075
    R.label('CAT %d' % (i + 1), PM(-0.33, y, 0.009), 0.0, TP, h=0.015, st='e')
    for j, m in enumerate(('LampRed', 'LampAmber', 'LampGreen', 'LampWhite')):
        x = -0.18 + j * 0.13
        ob(S, 'Bezel', MM, PM(x, y, 0.008), -0.03, 0.03, -0.022, 0.022, 0.0, 0.004, skip=('nz',))
        R.oquad(S, m if (i, j) in lit else 'Panel', MM, PM(x, y, 0.008), -0.024, 0.024, -0.016, 0.016, 0.0045)
switches(S, MM, PM(0.0, -0.22, 0.008), cols=8, rows=1, pitch=0.05, seed=7)

# ── the arresting-gear panel beside the boss's panel ──
Mg = R.mat3(0, 0.9)
cg = (-1.28, YS + 0.14, -2.6)
ob(S, 'Console', R.mat3(0), (-1.28, YS, -2.62), -0.26, 0.26, 0.0, 0.2, -0.22, 0.12)
ob(S, 'Panel', Mg, cg, -0.25, 0.25, -0.15, 0.15, 0.0, 0.005, skip=('nz',))
R.label('ARRESTING GEAR', R.xf(Mg, cg, (0.0, 0.12, 0.006)), 0.0, 0.9, h=0.016, st='e')
for i, t in enumerate(('1', '2', '3', '4', 'BARR')):
    x = -0.2 + i * 0.1
    R.label(t, R.xf(Mg, cg, (x, 0.075, 0.006)), 0.0, 0.9, h=0.014, st='e')
    for j, m in enumerate(('LampGreen', 'LampRed')):
        on = (j == 0 and i < 4) or (j == 1 and i == 4 and False)
        R.oquad(S, m if on else 'Panel', Mg, cg, x - 0.022, x + 0.022, 0.02 - j * 0.065, 0.05 - j * 0.065, 0.006)
R.label('SET · FOUL', R.xf(Mg, cg, (0.0, -0.125, 0.006)), 0.0, 0.9, h=0.013, st='e')

# ── the middle of the sill: wind repeaters, radio heads, phones, the talkers' station ──
Mw = R.mat3(0, 0.55)
cw = (-0.5, YS + 0.13, -2.62)
ob(S, 'Console', R.mat3(0), (-0.5, YS, -2.66), -0.36, 0.36, 0.0, 0.2, -0.22, 0.12)
ob(S, 'Panel', Mw, cw, -0.35, 0.35, -0.13, 0.13, 0.0, 0.005, skip=('nz',))
for k, (x, t, nd) in enumerate(((-0.2, 'TRUE WIND', 0.35), (0.12, 'REL WIND', -0.12))):
    dial(S, R.xf(Mw, cw, (x, 0.0, 0.005)), Mw, r=0.07, needle=nd)
    R.label(t, R.xf(Mw, cw, (x, -0.1, 0.006)), 0.0, 0.55, h=0.014, st='e')
    R.oquad(S, 'Screen', Mw, cw, x + 0.09, x + 0.15, 0.02, 0.05, 0.006)
    R.oquad(S, 'LampRed', Mw, cw, x + 0.095, x + 0.145, 0.028, 0.042, 0.0065)
R.label('KTS', R.xf(Mw, cw, (0.27, 0.07, 0.006)), 0.0, 0.55, h=0.012, st='e')
for k, (x, t) in enumerate(((0.2, 'TWR PRI'), (0.42, 'TWR SEC'), (0.64, 'HELO'), (0.86, 'LSO'), (1.08, 'CATCC'), (1.3, 'DECK'), (1.52, 'GUARD'))):
    radio_head(x, -2.78, t, seed=k)
phone_box(S, -0.02, YS + 0.2, -2.9, 0.0, title='SP · 5JG', tilt=0.3)
for x in (-1.0, -0.2, 0.9, 1.5):
    handset(x, YS - 0.25, ZC + 0.012, 0.0)
R.label('PHONE TALKER', (0.3, YS - 0.13, ZC + 0.012), 0.0, 0.0, h=0.022, st='w')
mug(-0.95, YS, -2.45, 'White')
clipboard(0.62, YS + 0.004, -2.52, 0.2, PI / 2, seed=1)
papers(1.2, YS, -2.5, 0.1, n=2, seed=2)

# ── the ends of the sill: binoculars in their rack, a phone, clipboards ──
bx(S, 'Wood', -5.15, -4.45, YS, YS + 0.12, -2.9, -2.6)
for k in range(3):
    bx(S, 'Black', -5.1 + k * 0.23, -4.93 + k * 0.23, YS + 0.12, YS + 0.121, -2.88, -2.62)
binoculars(-4.97, YS + 0.02, -2.75, 0.0)
binoculars(-4.74, YS + 0.02, -2.75, 0.0)
R.label('BINOCULARS · SIGN FOR', (-4.8, YS + 0.06, -2.599), 0.0, 0.0, h=0.018, st='b')
binoculars(4.6, YS, -2.55, 0.5)
phone_box(S, 4.95, YS + 0.2, -2.9, 0.0, title='DIAL · 7100', tilt=0.3)
mug(1.72, YS, -2.42, 'Blue')
clipboard(-3.95, YS + 0.004, -2.55, -0.15, PI / 2, seed=3)
mug(-3.72, YS, -2.4, 'White')

# ═════════════ the chairs: the bosses' raised swivel chairs on their pedestals, stools for the talkers ═════════════
def build_throne(P, mat='Leather'):
    """the boss's high chair: a column, a padded seat with a rolled front, a high back with a headrest, wide arms
    with control pods, a foot bar; the sitter faces −z"""
    h = 0.5
    P.cyl('Steel', (0, 0, 0), 0.22, 0.22, 0.0, 0.03, 16, cap0=False)
    P.cyl('Black', (0, 0, 0), 0.065, 0.065, 0.03, h - 0.13, 12, cap0=False, cap1=False)
    P.cyl('Chrome', (0, 0, 0), 0.042, 0.042, h - 0.13, h - 0.07, 12, cap0=False, cap1=False)
    ring = [(0.25 * math.sin(2 * PI * i / 10), 0.24, -0.25 * math.cos(2 * PI * i / 10) * 0.9) for i in range(10)]
    for a, b in zip(ring, ring[1:] + ring[:1]):
        P.beam('Chrome', a, b, 0.022, caps=False)
    for i in (0, 4, 6):
        P.beam('Chrome', (0, 0.24, 0), ring[i], 0.02, caps=False)
    bx(P, 'Black', -0.15, 0.15, h - 0.09, h - 0.05, -0.14, 0.18)
    bx(P, mat, -0.28, 0.28, h - 0.05, h + 0.07, -0.2, 0.28)
    P.cyl(mat, (0, h + 0.005, -0.2), 0.064, 0.064, -0.28, 0.28, 12, axis='x')
    Mb = R.mat3(0, -0.2)
    ob(P, mat, Mb, (0, h + 0.07, 0.27), -0.27, 0.27, 0.0, 0.74, -0.05, 0.05, skip=())
    ob(P, mat, Mb, (0, h + 0.07, 0.27), -0.21, 0.21, 0.08, 0.32, -0.08, -0.05, skip=())
    ob(P, mat, Mb, (0, h + 0.07, 0.27), -0.16, 0.16, 0.78, 0.99, -0.04, 0.05, skip=())
    ob(P, 'Black', Mb, (0, h + 0.07, 0.27), -0.05, 0.05, 0.7, 0.8, 0.0, 0.045, skip=())
    ob(P, 'Black', Mb, (0, h + 0.07, 0.27), -0.26, 0.26, 0.02, 0.72, 0.05, 0.066, skip=())
    ob(P, 'Black', Mb, (0, h + 0.07, 0.27), -0.15, 0.15, 0.8, 0.97, 0.05, 0.062, skip=())
    for sx in (-1, 1):
        x = sx * 0.335
        bx(P, 'Black', x - 0.03, x + 0.03, h, h + 0.22, 0.0, 0.12)
        bx(P, mat, x - 0.06, x + 0.06, h + 0.22, h + 0.285, -0.23, 0.2, skip=())
        bx(P, 'Console', x - 0.055, x + 0.055, h + 0.285, h + 0.305, -0.22, -0.07)
        for k, m in enumerate(('LampGreen', 'Panel', 'Red')):
            bx(P, m, x - 0.035 + k * 0.025, x - 0.017 + k * 0.025, h + 0.305, h + 0.312, -0.19, -0.17)
        bx(P, 'Black', x - 0.02, x + 0.02, h + 0.305, h + 0.33, -0.12, -0.09)

def build_stool(P, mat='SeatBlue'):
    """a tall watch stool: pedestal, foot ring, a round seat and a low back"""
    h = 0.74
    P.cyl('Steel', (0, 0, 0), 0.2, 0.2, 0.0, 0.025, 14, cap0=False)
    P.cyl('Black', (0, 0, 0), 0.035, 0.035, 0.025, h - 0.05, 10, cap0=False, cap1=False)
    ring = [(0.2 * math.sin(2 * PI * i / 8), 0.36, 0.2 * math.cos(2 * PI * i / 8)) for i in range(8)]
    for a, b in zip(ring, ring[1:] + ring[:1]):
        P.beam('Chrome', a, b, 0.018, caps=False)
    for i in (0, 3, 5):
        P.beam('Chrome', (0, 0.36, 0), ring[i], 0.016, caps=False)
    P.cyl(mat, (0, 0, 0), 0.2, 0.19, h - 0.05, h + 0.03, 14, cap0=False)
    ob(P, mat, R.mat3(0, -0.15), (0, h + 0.05, 0.17), -0.18, 0.18, 0.0, 0.2, -0.03, 0.03, skip=())

def platform(xc, zc, title):
    """the pedestal under a boss's chair: a raised box with a step, anti-slip plate, yellow nosing"""
    x0, x1, z0, z1, hp = xc - 0.55, xc + 0.55, zc - 0.33, zc + 0.6, 0.5
    bx(S, 'Deck', x0, x1, FY, FY + hp, z0, z1)
    bx(S, 'Deck', x0 + 0.1, x1 - 0.1, FY, FY + 0.25, z1, z1 + 0.3)
    for (a, b, c, d, y) in ((x0, x1, z1 - 0.04, z1, FY + hp), (x0 + 0.1, x1 - 0.1, z1 + 0.26, z1 + 0.3, FY + 0.25)):
        bx(S, 'Yellow', a, b, y, y + 0.004, c, d)
    bx(S, 'Black', x0 - 0.004, x1 + 0.004, FY, FY + 0.06, z0 - 0.004, z1 + 0.004, skip=('bottom', 'top'))
    R.handrail(S, (x1 + 0.02, FY + hp + 0.6, z0 + 0.1), (x1 + 0.02, FY + hp + 0.6, z1 - 0.1), standoff=0.0)
    for zz in (z0 + 0.1, z1 - 0.1):
        S.beam('Metal', (x1 + 0.02, FY + hp, zz), (x1 + 0.02, FY + hp + 0.6, zz), 0.03, caps=False)
    R.label(title, ((x0 + x1) / 2, FY + 0.3, z1 + 0.301), 0.0, 0.0, h=0.05, st='y')
    return FY + hp

BOSS = (-2.2, -1.9)
MINI = (2.2, -1.9)
yb = platform(BOSS[0], BOSS[1], 'AIR BOSS')
ym = platform(MINI[0], MINI[1], 'MINI BOSS')
inst('throne', build_throne, (BOSS[0], yb, BOSS[1]), 0.35)
inst('throne', build_throne, (MINI[0], ym, MINI[1]), -0.35)
for (xc, yaw, t) in ((BOSS[0], 0.35, 'AIR BOSS'), (MINI[0], -0.35, 'MINI BOSS')):
    Mt = R.mat3(yaw) @ R.mat3(0, -0.2)
    R.label(t, R.xf(R.mat3(yaw), (xc, yb, -1.9), R.xf(R.mat3(0, -0.2), (0, 0.57, 0.27), (0, 0.885, 0.063))), yaw, -0.2, h=0.04, st='w')
for (x, z, yaw) in ((-0.85, -1.85, 0.2), (0.95, -1.8, -0.3)):
    inst('stool', build_stool, (x, FY, z), yaw)

# the stations: each boss's eye in his chair, looking out over his panel at his part of the deck
R.station('stand_boss', (BOSS[0], FY + 1.75, -2.0), yaw=0.72, pitch=-0.36, fov=64)
R.station('stand_miniboss', (MINI[0], FY + 1.75, -2.0), yaw=-0.72, pitch=-0.36, fov=64)

# ═════════════ the deck cameras (PLAT / ILARTS) hung from the overhead over the windows ═════════════
def hung_monitor(name, x, z, yaw, w, h, px=None, k=None, y=2.72):
    R.monitor(S, name, (x, y, z), yaw, -0.32, w=w, h=h, depth=0.07, bezel=0.03, px=px, art=k)
    M = R.mat3(yaw)
    for sx in (-w / 2 + 0.06, w / 2 - 0.06):
        top = R.xf(R.mat3(yaw, -0.32), (x, y, z), (sx, h / 2 + 0.03, -0.04))
        S.beam('Steel', top, (top[0], H, top[2]), 0.022, caps=False)
    R.label(name and 'PLAT · LANDING' or 'ILARTS', R.xf(R.mat3(yaw, -0.32), (x, y, z), (0.0, -h / 2 - 0.06, 0.002)), yaw, -0.32, h=0.028, st='w')
hung_monitor('screen_plat', -3.55, -2.95, 0.45, 0.64, 0.36, px=(1024, 576))
hung_monitor(None, -4.55, -2.8, 0.75, 0.46, 0.28, k=5)
hung_monitor(None, 3.55, -2.95, -0.45, 0.46, 0.28, k=7)
hung_monitor(None, 4.5, -2.8, -0.75, 0.46, 0.28, k=1)

# ═════════════ the inner (starboard) wall: the ladder, the status board, clocks, the door, the rack, the desk ═════════════
# the ladder down to the flight deck: an inclined ladder's well in the deck with its handrails (the exit node)
LX0, LX1, LZ0, LZ1 = -5.05, -3.35, 2.72, 3.5
bx(S, 'Steel', LX0 - 0.06, LX1 + 0.06, FY, FY + 0.05, LZ0 - 0.06, LZ0, skip=('bottom',))
bx(S, 'Steel', LX0 - 0.06, LX0, FY, FY + 0.05, LZ0, LZ1, skip=('bottom',))
LO = ((LX0 + LX1) / 2, FY, (LZ0 + LZ1) / 2)          # the node's origin: the well's centre
L = Part('exit_ladder')
def lp(p):
    return (p[0] - LO[0], p[1] - LO[1], p[2] - LO[2])
L.g('Black').face([lp((LX0, FY + 0.006, LZ0)), lp((LX0, FY + 0.006, LZ1)), lp((LX1, FY + 0.006, LZ1)), lp((LX1, FY + 0.006, LZ0))], None, (0, 1, 0))
for z in (LZ0 + 0.06, LZ1 - 0.06):
    pts = [(LX1 - 0.52, FY - 0.1, z), (LX1, FY + 0.9, z), (LX1 + 0.25, FY + 0.95, z), (LX1 + 0.3, FY + 0.05, z)]
    for a_, b_ in zip(pts, pts[1:]):
        L.beam('Metal', lp(a_), lp(b_), 0.04, caps=False)
L.beam('Metal', lp((LX0 + 0.05, FY + 1.0, LZ0 + 0.06)), lp((LX1 - 0.5, FY + 1.0, LZ0 + 0.06)), 0.035, caps=False)
for (x, z) in ((LX0 + 0.05, LZ0 + 0.06), (LX0 + 0.05, LZ1 - 0.06)):
    L.beam('Metal', lp((x, FY, z)), lp((x, FY + 1.0, z)), 0.035, caps=False)
L.beam('Metal', lp((LX0 + 0.05, FY + 1.0, LZ0 + 0.06)), lp((LX0 + 0.05, FY + 1.0, LZ1 - 0.06)), 0.035, caps=False)
L.beam('Metal', lp((LX0 + 0.05, FY + 0.5, LZ0 + 0.06)), lp((LX1 - 0.6, FY + 0.5, LZ0 + 0.06)), 0.03, caps=False)
for k in range(3):                              # the top treads, going down into the dark
    x = LX1 - 0.12 - k * 0.2
    a_, b_ = lp((x - 0.09, FY - 0.03 - k * 0.3, LZ0 + 0.1)), lp((x + 0.09, FY - k * 0.3, LZ1 - 0.1))
    L.box('Steel', a_[0], b_[0], a_[1], b_[1], a_[2], b_[2], skip=('bottom',))
R.node('exit_ladder', L, LO, 0.0, 0.0, ctl={'t': 'exit'})
R.label('LADDER TO THE FLIGHT DECK', ((LX0 + LX1) / 2, 2.25, Z1 - 0.012), PI, 0.0, h=0.07, st='y')
R.label('O-10 · 10-140-1-Q', ((LX0 + LX1) / 2, 2.1, Z1 - 0.012), PI, 0.0, h=0.035, st='b')
for k in range(9):                              # the hazard stripes on the well's coaming
    x = LX0 - 0.03 + k * 0.2
    S.g('Yellow' if k % 2 == 0 else 'Black').face([(x, FY + 0.051, LZ0 - 0.06), (x + 0.2, FY + 0.051, LZ0 - 0.06), (x + 0.2, FY + 0.051, LZ0), (x, FY + 0.051, LZ0)], None, (0, 1, 0))

# the flight deck status board (dry-erase): side numbers, types, spots, status, fuel
BX0, BX1, BY0, BY1 = -2.95, -0.25, 1.02, 2.3
bx(S, 'Steel', BX0 - 0.04, BX1 + 0.04, BY0 - 0.04, BY1 + 0.04, Z1 - 0.03, Z1, skip=('bottom',))
S.g('White').face([(BX0, BY0, Z1 - 0.031), (BX1, BY0, Z1 - 0.031), (BX1, BY1, Z1 - 0.031), (BX0, BY1, Z1 - 0.031)], None, (0, 0, -1))
bx(S, 'Steel', BX0, BX1, BY0 - 0.08, BY0 - 0.04, Z1 - 0.1, Z1 - 0.03)              # the pen tray
for k, m in enumerate(('Black', 'Red', 'Blue', 'Green')):
    S.beam(m, (BX1 - 0.3 + k * 0.05, BY0 - 0.035, Z1 - 0.07), (BX1 - 0.3 + k * 0.05 + 0.02, BY0 - 0.035, Z1 - 0.07 + 0.012), 0.014, caps=False)
COLS = [('SIDE', 0.14), ('TYPE', 0.16), ('SPOT', 0.2), ('STATUS', 0.3), ('FUEL', 0.2)]
ROWS = [('100', 'F18E', 'CAT 1', 'UP', '11.2'), ('101', 'F18E', 'CAT 2', 'UP', '11.0'), ('200', 'F35C', 'ROW 3', ('DOWN', 'Red'), '-'),
        ('201', 'F35C', 'CAT 3', 'UP', '14.5'), ('300', 'F18F', 'EL 2', ('TANKER', 'Blue'), '16.8'), ('600', 'E2D', 'CAT 4', 'UP', '-'),
        ('702', 'MH60', 'SPOT 6', ('PLANE GRD', 'Blue'), '-'), ('510', 'EA18', 'JUNKYARD', ('HOT PIT', 'Red'), '4.1')]
W_ = BX1 - BX0
dy = (BY1 - BY0 - 0.16) / (len(ROWS) + 0.2)
ytop = BY1 - 0.14
for k in range(len(ROWS) + 1):
    y = ytop - k * dy
    S.g('Black').face([(BX0 + 0.02, y - 0.002, Z1 - 0.033), (BX1 - 0.02, y - 0.002, Z1 - 0.033), (BX1 - 0.02, y + 0.002, Z1 - 0.033), (BX0 + 0.02, y + 0.002, Z1 - 0.033)], None, (0, 0, -1))
acc = 0.0
for (head, frac) in COLS:
    R.label(head, (BX1 - (acc + frac / 2) * W_, BY1 - 0.075, Z1 - 0.034), PI, 0.0, h=0.04, st='b')
    acc += frac
    if acc < 0.999:
        xx_ = BX1 - acc * W_
        S.g('Black').face([(xx_ - 0.002, BY0 + 0.03, Z1 - 0.033), (xx_ - 0.002, BY1 - 0.03, Z1 - 0.033), (xx_ + 0.002, BY1 - 0.03, Z1 - 0.033), (xx_ + 0.002, BY0 + 0.03, Z1 - 0.033)], None, (0, 0, -1))
for i, row in enumerate(ROWS):
    y = ytop - (i + 1) * dy + dy * 0.2
    acc = 0.0
    for j, (cell, (head, frac)) in enumerate(zip(row, COLS)):
        txt, m = cell if isinstance(cell, tuple) else (cell, 'Black')
        scrawl(S, txt, (BX1 - (acc + 0.02) * W_, y, Z1 - 0.034), (-1, 0, 0), (0, 1, 0), h=0.058, mat=m, seed=i * 13 + j, lift=0.0)
        acc += frac
R.label('FLIGHT DECK STATUS · EVENT 3', ((BX0 + BX1) / 2, BY1 + 0.1, Z1 - 0.012), PI, 0.0, h=0.055, st='y')
clock(S, (-2.3, 2.78, Z1 - 0.05), PI, r=0.13, title='ZULU', hands=(1.1, 4.4))
clock(S, (-0.9, 2.78, Z1 - 0.05), PI, r=0.13, title='LOCAL', hands=(4.2, 4.4))
R.label('PRIMARY FLIGHT CONTROL', (-1.6, 3.12, Z1 - 0.012), PI, 0.0, h=0.07, st='big')

# the door down to the CDC: a watertight door in its frame (the node is its leaf)
def wt_door(name, x, z, yaw, kind, text, w=0.8, h=1.75):
    M = R.mat3(yaw)
    o = (x, FY, z)
    ob(S, 'Steel', M, o, -w / 2 - 0.12, w / 2 + 0.12, 0.0, h + 0.2, 0.0, 0.05)
    ob(S, 'Yellow', M, o, -w / 2 - 0.12, w / 2 + 0.12, 0.0, 0.25, 0.05, 0.07)
    for k in range(4):
        xx = -w / 2 - 0.12 + (k + 0.5) * (w + 0.24) / 4
        R.oquad(S, 'Black', M, o, xx - 0.04, xx + 0.04, 0.02, 0.23, 0.0705)
    P = Part(name)
    P.box('WallDark', -w / 2 + 0.02, w / 2 - 0.02, 0.27, h + 0.03, 0.05, 0.1)
    P.box('Steel', -w / 2 + 0.06, w / 2 - 0.06, 0.34, h - 0.04, 0.1, 0.108, skip=('nz',))
    for (dx, dy_) in [(-w / 2 + 0.06, 0.55), (-w / 2 + 0.06, h - 0.2), (w / 2 - 0.06, 0.55), (w / 2 - 0.06, h - 0.2), (0, h), (0, 0.33)]:
        P.box('Metal', dx - 0.025, dx + 0.025, dy_ - 0.045, dy_ + 0.045, 0.1, 0.14, skip=('nz',))
    P.box('Metal', w / 2 - 0.2, w / 2 - 0.1, 1.0, 1.04, 0.108, 0.16, skip=('nz',))
    P.box('Red', w / 2 - 0.36, w / 2 - 0.19, 1.0, 1.04, 0.14, 0.16, skip=('nz',))
    R.node(name, P, o, yaw, 0.0, ctl={'t': kind})
    R.label(text, R.xf(M, o, (0, h + 0.3, 0.052)), yaw, 0.0, h=0.07, st='y')
wt_door('door_cic', 0.75, Z1, PI, 'door', 'DOWN TO CDC')
extinguisher(S, 1.45, Z1, PI, co2=True)
# the radio rack, a locker with the float coats and cranials, the air-plan desk
cabinet(S, 2.1, Z1, PI, w=0.8, d=0.5, h=1.95, title='UHF / VHF RADIO', seed=21)
bx(S, 'ConsoleLight', 2.6, 3.15, FY, FY + 1.9, Z1 - 0.45, Z1, skip=('bottom',))
bx(S, 'ConsoleLight', 2.63, 3.12, FY + 0.06, FY + 1.86, Z1 - 0.462, Z1 - 0.45, skip=('bottom', 'pz'))
for k in range(4):
    R.oquad(S, 'Black', R.mat3(PI), (2.875, FY, Z1 - 0.462), -0.18, 0.18, 1.6 + k * 0.03, 1.615 + k * 0.03, 0.001)
R.label('FLOAT COATS · CRANIALS', (2.875, FY + 1.3, Z1 - 0.464), PI, 0.0, h=0.022, st='b')
for k, m in enumerate(('White', 'Yellow')):
    S.sphere(m, (2.72 + k * 0.28, FY + 1.95, Z1 - 0.22), 0.13, 0.1, 0.14, 12, 6, v0=0.5)
    bx(S, 'Black', 2.6 + k * 0.28, 2.84 + k * 0.28, FY + 1.9, FY + 1.93, Z1 - 0.3, Z1 - 0.14)
DK = (3.35, 5.2, Z1 - 0.7, Z1)
bx(S, 'Console', DK[0], DK[1], FY, FY + 0.72, DK[2] + 0.05, DK[3])
bx(S, 'Panel', DK[0] - 0.02, DK[1] + 0.02, FY + 0.72, FY + 0.75, DK[2], DK[3])
R.monitor(S, None, (4.0, FY + 1.05, Z1 - 0.32), PI, 0.08, w=0.5, h=0.31, depth=0.04, bezel=0.02, stand=0.12, art=6)
bx(S, 'Black', 3.78, 4.22, FY + 0.75, FY + 0.765, Z1 - 0.62, Z1 - 0.48)
bx(S, 'ConsoleLight', 4.55, 5.05, FY + 0.75, FY + 0.97, Z1 - 0.55, Z1 - 0.15)
bx(S, 'Black', 4.6, 5.0, FY + 0.97, FY + 0.975, Z1 - 0.45, Z1 - 0.2)
papers(4.8, FY + 0.975, Z1 - 0.33, 0.0, n=2, seed=5)
phone_box(S, 3.62, FY + 0.95, Z1, PI, title='DIAL · 7101')
papers(3.55, FY + 0.75, Z1 - 0.45, 0.4, n=3, seed=6)
mug(4.35, FY + 0.75, Z1 - 0.58, 'Red')
inst('stool', build_stool, (4.1, FY, Z1 - 1.05), PI + 0.3)
R.label('AIR PLAN · FLIGHT SCHEDULE', (4.27, FY + 0.6, DK[2] - 0.001), 0.0, 0.0, h=0.03, st='w')
clipboard(3.5, 1.6, Z1 - 0.01, PI, seed=7)
clipboard(3.8, 1.6, Z1 - 0.01, PI, seed=8)
R.label('AIR PLAN', (3.65, 1.82, Z1 - 0.012), PI, 0.0, h=0.025, st='b')
speaker(S, -3.2, 2.6, Z1, PI)

# ═════════════ the overhead: a supply duct, light fixtures, speakers, a cable tray ═════════════
bx(S, 'PipeWhite', X0 + 0.05, X1 - 0.05, H - 0.34, H - 0.06, 2.1, 2.6, skip=('top', 'px', 'nx'))
for x in [X0 + 0.5 + k * 1.3 for k in range(8)]:
    bx(S, 'Steel', x - 0.025, x + 0.025, H - 0.36, H - 0.05, 2.08, 2.62, skip=('top',))
for x in (-3.9, -1.3, 1.3, 3.9):
    bx(S, 'Steel', x - 0.2, x + 0.2, H - 0.4, H - 0.34, 2.15, 2.55)
    for k in range(3):
        bx(S, 'Black', x - 0.16, x + 0.16, H - 0.402, H - 0.4, 2.2 + k * 0.12, 2.24 + k * 0.12)
for x in (-3.8, -1.3, 1.3, 3.8):
    for z in (-1.3, 0.8):
        R.light_fixture(S, (x, H, z), w=0.3, l=1.1, along='x', mat='Light')
R.tray(S, (X0 + 0.1, H - 0.1, 3.3), (X1 - 0.1, H - 0.1, 3.3), w=0.24, h=0.06)
speaker(S, -0.4, H - 0.3, -1.2, 0.0, hang=H)
R.light_fixture(S, (0.0, H, -2.9), w=0.12, l=0.5, along='x', mat='LightRed')

# ═════════════ spawn, walk areas ═════════════
R.spawn((-3.05, FY, 3.05), yaw=0.0)
WALK = [
    [X0 + 0.15, -2.8, -2.18, 2.66, FY],        # the aft end (the boss's pedestal excluded)
    [-1.6, 1.6, -2.18, 2.66, FY],              # between the pedestals
    [2.8, X1 - 0.15, -2.18, 2.66, FY],         # the forward end
    [-2.8, -1.6, -0.97, 2.66, FY],             # behind the pedestals (their steps)
    [1.6, 2.8, -0.97, 2.66, FY],
    [-3.3, 1.58, 2.66, Z1 - 0.12, FY],         # along the inner wall: the board, the door
    [1.58, 3.3, 2.66, Z1 - 0.52, FY],          # in front of the rack and the locker
    [3.3, X1 - 0.15, 2.66, DK[2] - 0.05, FY],  # in front of the desk
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

# (a room with windows: the world lights it — no room lights; 'bg' is only used by closed rooms)
finish(OUT, {'walk': WALK, 'eye': 1.64, 'lights': [], 'bg': '#7f97ad'})
