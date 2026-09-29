# ═══════════════════════════════════════════════════════════════
# Joint Operations Center — the combat operations floor at the home airbase (a closed room). Blender, headless:
#   blender -b -P tools/interiors/joc.py -- models/interiors/joc.glb
# Room frame: the origin is the floor centre of the front tier, x right, y up, −z toward the video wall.
# Modelled on an Air Operations Center's combat operations floor:
#   • an AOC has five divisions — Strategy, Combat Plans, Combat Operations, ISR and Air Mobility; Combat
#     Operations runs today's air war under the Chief of Combat Operations, and senior leadership watches from a
#     glassed "battlecab" over the floor (https://en.wikipedia.org/wiki/Air_Operations_Center)
#   • the 609th AOC / CAOC at Al Udeid: a wide floor of workstations with several monitors each, large screens of
#     maps and surveillance imagery on the front wall, coalition flags hanging from the ceiling
#     (https://www.dvidshub.net/image/2223198 , https://commons.wikimedia.org/wiki/File:USAFCENT_CAOC.JPG ,
#      https://commons.wikimedia.org/wiki/File:Combined_Air_Operations_Center_at_Al_Udeid_Air_Base,_Qatar.jpg)
#   • an operations centre's layout: rows of cells facing the common operational picture on the front wall
#     (https://en.wikipedia.org/wiki/Tactical_operations_center , https://en.wikipedia.org/wiki/Common_operational_picture)
# Ours is smaller: 20 m wide (x −10..10), 15 m deep (z −7.5..7.5), 4.2 m to the ceiling (it steps up to 4.6 m over
# the front 2.5 m so the wall's clock strip fits). Stadium tiers 0.3 m apart: tier 1 z −7.5..−2 (y 0), tier 2
# z −2..1.5 (y 0.3), tier 3 z 1.5..7.5 (y 0.6); the battlecab on a platform at the back centre (x −6..6, z 5..7.5,
# y 0.9, carpet, its own ceiling at 3.55) behind a glass front, a sliding glass door in its left wall; its desk is a
# counter with tall chairs so the staff see over the floor to the wall. Three desk rows of six positions
# (x −7.5..7.5; the monitors are kept low so the rows behind see the wall), side aisles with split steps at
# x ±7.5..10; the exit (double doors) in the back wall at the back left, the coffee bar at the back right, comms
# racks in the front right corner.
# In the building (joc_ext.glb) the room sits turned 180° about y with its origin at building (0, −0.45, 0): its
# back wall (the exit) faces the entrance on the building's −z side, the tier-3 floor level with the lobby.
# Live screens: the wall (map, intel, tasks, strikes, radio and the clock strip), six desk stations, the battlecab's.
# ═══════════════════════════════════════════════════════════════
import sys, os, math
sys.dont_write_bytecode = True
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import roomkit as R
from roomkit import PI
from shipkit import Part, material, srgb, MATS
from mathutils import Vector

args = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
OUT = args[0] if args else 'models/interiors/joc.glb'

R.begin()
S = R.static()
# extra colours (plain PBR: the game keys its textures and looks on roomkit's names only)
for name, col, metal, rough in [
    ('FlagRed', 0xc01f2f, 0.0, 0.85), ('FlagWhite', 0xf2f2ee, 0.0, 0.85), ('FlagNavy', 0x1b2a57, 0.0, 0.85),
    ('FlagBlue', 0x21468b, 0.0, 0.85), ('FlagMaroon', 0x8a1538, 0.0, 0.85), ('FlagYellow', 0xf2c51c, 0.0, 0.85),
    ('FlagGreen', 0x137a3e, 0.0, 0.85), ('MapSea', 0x5f8fb8, 0.0, 0.7), ('MapLand', 0xc9b98c, 0.0, 0.8),
    ('MapHigh', 0x9a8a62, 0.0, 0.8), ('Paper', 0xeeece4, 0.0, 0.9), ('Plastic', 0xb4b6b2, 0.0, 0.5),
    ('PlasticDark', 0x2c2e30, 0.0, 0.5), ('Cork', 0x9c7a4e, 0.0, 0.95), ('Marker', 0x1d4fb0, 0.0, 0.5),
]:
    material(name, srgb(col), metal, rough)
material('LightDim', srgb(0xfff2df), 0.0, 0.4, emit=srgb(0xfff2df), emit_strength=1.6)
material('ScreenArt', srgb(0xffffff), 0.0, 0.3)

X0, X1, Z0, Z1 = -10.0, 10.0, -7.5, 7.5
H, HF, ZSOF = 4.2, 4.6, -5.0            # ceiling, the raised ceiling over the front, the soffit line
TIERS = [(-7.5, -2.0, 0.0), (-2.0, 1.5, 0.3), (1.5, 7.5, 0.6)]
CX0, CX1, CZ0, CY, HC = -6.0, 6.0, 5.0, 0.9, 3.55   # battlecab: x, front z, floor, ceiling
ROWS = [(0.0, -4.45), (0.3, -1.85), (0.6, 1.65)]    # desk rows: tier floor, desk front z
DD, DH = 0.75, 0.72                                  # desk depth, height
POS = [-6.25, -3.75, -1.25, 1.25, 3.75, 6.25]        # positions along a row
RX0, RX1 = -7.5, 7.5                                 # row ends
_last = [0]


def mark(what):
    n = S.tris()
    print('  [joc] %-28s %6d tris (total %d)' % (what, n - _last[0], n))
    _last[0] = n


def quad(mat, pts, n, uvs=None):
    """a face with metre UVs projected on its dominant plane"""
    if uvs is None:
        ax = max(range(3), key=lambda i: abs(n[i]))
        uvs = [(p[0], p[2]) if ax == 1 else (p[2], p[1]) if ax == 0 else (p[0], p[1]) for p in pts]
    S.g(mat).face([tuple(p) for p in pts], uvs, n)


def disc(mat, c, r, n, normal):
    """a flat n-gon (horizontal: normal ±y; vertical: normal ±z)"""
    if abs(normal[1]) > 0.5:
        pts = [(c[0] + r * math.cos(2 * PI * k / n), c[1], c[2] + r * math.sin(2 * PI * k / n)) for k in range(n)]
    else:
        pts = [(c[0] + r * math.cos(2 * PI * k / n), c[1] + r * math.sin(2 * PI * k / n), c[2]) for k in range(n)]
    S.g(mat).face(pts, None, normal)


def look(name, eye, target, fov=50):
    d = Vector(target) - Vector(eye)
    yaw = math.atan2(-d.x, -d.z)
    pitch = math.atan2(d.y, math.hypot(d.x, d.z))
    return R.station(name, eye, yaw=yaw, pitch=pitch, fov=fov)


def cyl(mat, c, r, y0, y1, n=12, cap0=True, cap1=True):
    S.cyl(mat, c, r, r, y0, y1, n, cap0=cap0, cap1=cap1)


# ═════════════ the shell: tiered raised floor, walls, the stepped ceiling ═════════════
for (z0, z1, y) in TIERS:
    quad('DeckTile', [(X0, y, z0), (X0, y, z1), (X1, y, z1), (X1, y, z0)], (0, 1, 0))
# perforated air tiles in the aisles (cold air comes up through the raised floor)
for (x, z, y) in ((-4.35, -2.6, 0.0), (4.35, -2.6, 0.0), (-4.35, 0.9, 0.3), (4.35, 0.9, 0.3), (-4.35, 4.4, 0.6), (4.35, 4.4, 0.6), (-8.7, -5.9, 0.0), (8.7, -5.9, 0.0)):
    quad('Steel', [(x - 0.29, y + 0.002, z - 0.29), (x - 0.29, y + 0.002, z + 0.29), (x + 0.29, y + 0.002, z + 0.29), (x + 0.29, y + 0.002, z - 0.29)], (0, 1, 0))
    for k in range(5):
        zz = z - 0.2 + k * 0.1
        quad('Black', [(x - 0.22, y + 0.003, zz - 0.02), (x - 0.22, y + 0.003, zz + 0.02), (x + 0.22, y + 0.003, zz + 0.02), (x + 0.22, y + 0.003, zz - 0.02)], (0, 1, 0))
# risers between the tiers: steel kick plates, an aluminium nosing, a blue LED strip under it
for k in (1, 2):
    z, y0, y1 = TIERS[k][0], TIERS[k - 1][2], TIERS[k][2]
    quad('Steel', [(X0, y0, z), (X1, y0, z), (X1, y1, z), (X0, y1, z)], (0, 0, -1))
    R.uvbox(S, 'Metal', X0, X1, y1 - 0.012, y1 + 0.004, z - 0.03, z + 0.02, skip=('bottom',))
    quad('LightBlue', [(X0, y1 - 0.05, z - 0.001), (X1, y1 - 0.05, z - 0.001), (X1, y1 - 0.035, z - 0.001), (X0, y1 - 0.035, z - 0.001)], (0, 0, -1))
    # split steps in the side aisles (two 0.15 m steps) with yellow nosings
    for sx in (-1, 1):
        xa, xb = sorted((sx * 7.75, sx * 9.9))
        R.uvbox(S, 'DeckTile', xa, xb, y0, y0 + 0.15, z - 0.32, z, skip=('bottom', 'pz'))
        R.uvbox(S, 'Yellow', xa, xb, y0 + 0.15, y0 + 0.156, z - 0.36, z - 0.3, skip=('bottom',))
        R.uvbox(S, 'Yellow', xa, xb, y1, y1 + 0.006, z - 0.04, z + 0.02, skip=('bottom',))
# walls: acoustic fabric panels to 2.4 m (carpet), painted above; the front wall dark
for sx in (-1, 1):
    x = X1 * sx
    n = (-sx, 0, 0)
    quad('Carpet', [(x, 0, Z0), (x, 0, Z1), (x, 2.4, Z1), (x, 2.4, Z0)], n)
    quad('Wall', [(x, 2.4, Z0), (x, 2.4, Z1), (x, H, Z1), (x, H, Z0)], n)
    quad('Wall', [(x, H, Z0), (x, H, ZSOF), (x, HF, ZSOF), (x, HF, Z0)], n)
    # panel reveals (dark strips every 1.2 m), the chair-rail cap, the skirting
    z = Z0 + 1.2
    while z < Z1 - 0.1:
        quad('WallDark', [(x - sx * 0.002, 0.1, z - 0.012), (x - sx * 0.002, 0.1, z + 0.012), (x - sx * 0.002, 2.4, z + 0.012), (x - sx * 0.002, 2.4, z - 0.012)], n)
        z += 1.2
    R.uvbox(S, 'WallDark', min(x, x - sx * 0.04), max(x, x - sx * 0.04), 2.38, 2.44, Z0, Z1)
    quad('Black', [(x - sx * 0.012, 0.0, Z0), (x - sx * 0.012, 0.0, Z1), (x - sx * 0.012, 0.1, Z1), (x - sx * 0.012, 0.1, Z0)], n)
quad('WallDark', [(X0, 0, Z0), (X1, 0, Z0), (X1, HF, Z0), (X0, HF, Z0)], (0, 0, 1))
quad('Wall', [(X0, 0.6, Z1), (X0, H, Z1), (X1, H, Z1), (X1, 0.6, Z1)], (0, 0, -1))
quad('Black', [(X0, 0.6, Z1 - 0.012), (X0, 0.7, Z1 - 0.012), (X1, 0.7, Z1 - 0.012), (X1, 0.6, Z1 - 0.012)], (0, 0, -1))
# the ceiling (acoustic tiles, 0.6 m grid in the texture), the soffit where it steps up, a blue cove light
quad('Ceiling', [(X0, H, ZSOF), (X1, H, ZSOF), (X1, H, Z1), (X0, H, Z1)], (0, -1, 0))
quad('Ceiling', [(X0, HF, Z0), (X1, HF, Z0), (X1, HF, ZSOF), (X0, HF, ZSOF)], (0, -1, 0))
quad('Wall', [(X0, H, ZSOF), (X1, H, ZSOF), (X1, HF, ZSOF), (X0, HF, ZSOF)], (0, 0, -1))
R.uvbox(S, 'WallDark', X0, X1, H - 0.08, H, ZSOF - 0.06, ZSOF + 0.04, skip=('top',))
quad('LightBlue', [(X0 + 0.2, H - 0.075, ZSOF - 0.061), (X1 - 0.2, H - 0.075, ZSOF - 0.061), (X1 - 0.2, H - 0.055, ZSOF - 0.061), (X0 + 0.2, H - 0.055, ZSOF - 0.061)], (0, 0, -1))
mark('shell')

# ═════════════ the video wall (front, z = −7.5): a dark bezel frame around tiled displays ═════════════
ZW = Z0 + 0.4                 # the display plane
WALL = [  # name, centre x, centre y, w, h, px, tiles (cols, rows)
    ('screen_wall_map', 0.0, 2.32, 6.4, 3.4, (1024, 544), (5, 4)),
    ('screen_wall_intel', -4.85, 3.12, 3.2, 1.8, (1024, 576), (3, 2)),
    ('screen_wall_tasks', -4.85, 1.41, 3.2, 1.5, (1024, 480), (3, 2)),
    ('screen_wall_strikes', 4.85, 3.12, 3.2, 1.8, (1024, 576), (3, 2)),
    ('screen_wall_radio', 4.85, 1.41, 3.2, 1.5, (1024, 480), (3, 2)),
    ('screen_wall_clock', 0.0, 4.305, 12.0, 0.45, (1024, 64), (1, 1)),
]
# the frame: a box behind the displays, columns and bands between them, a vented base cabinet with doors
R.uvbox(S, 'Bezel', -6.62, 6.62, 0.55, HF, Z0, ZW - 0.02, skip=('nz', 'top'))
R.uvbox(S, 'Console', -6.7, 6.7, 0.0, 0.55, Z0, ZW + 0.1, skip=('nz', 'bottom'))
quad('Black', [(-6.7, 0.0, ZW + 0.105), (6.7, 0.0, ZW + 0.105), (6.7, 0.08, ZW + 0.105), (-6.7, 0.08, ZW + 0.105)], (0, 0, 1))
for k in range(12):
    x = -6.2 + k * 1.127
    quad('Panel', [(x - 0.5, 0.14, ZW + 0.102), (x + 0.5, 0.14, ZW + 0.102), (x + 0.5, 0.48, ZW + 0.102), (x - 0.5, 0.48, ZW + 0.102)], (0, 0, 1))
    for j in range(5):
        y = 0.2 + j * 0.055
        quad('Black', [(x - 0.42, y, ZW + 0.104), (x + 0.42, y, ZW + 0.104), (x + 0.42, y + 0.02, ZW + 0.104), (x - 0.42, y + 0.02, ZW + 0.104)], (0, 0, 1))
    R.uvbox(S, 'Metal', x + 0.4, x + 0.44, 0.3, 0.36, ZW + 0.1, ZW + 0.13, skip=('nz',))
for (x0, x1) in ((-6.62, -6.45), (6.45, 6.62), (-3.25, -3.2), (3.2, 3.25)):
    R.uvbox(S, 'Bezel', x0, x1, 0.55, 4.08, ZW - 0.02, ZW + 0.04, skip=('nz',))
for (x0, x1) in ((-6.45, -3.25), (3.25, 6.45)):
    R.uvbox(S, 'Bezel', x0, x1, 2.16, 2.22, ZW - 0.02, ZW + 0.04, skip=('nz',))
R.uvbox(S, 'Bezel', -6.62, 6.62, 0.55, 0.62, ZW - 0.02, ZW + 0.04, skip=('nz',))
R.uvbox(S, 'Bezel', -6.62, 6.62, 4.02, 4.08, ZW - 0.02, ZW + 0.04, skip=('nz',))
R.uvbox(S, 'Bezel', -6.62, 6.62, 4.53, HF, ZW - 0.02, ZW + 0.04, skip=('nz', 'top'))
R.uvbox(S, 'Bezel', -6.62, -6.0, 4.08, 4.53, ZW - 0.02, ZW + 0.04, skip=('nz',))
R.uvbox(S, 'Bezel', 6.0, 6.62, 4.08, 4.53, ZW - 0.02, ZW + 0.04, skip=('nz',))
for (name, cx, cy, w, h, px, (nc, nr)) in WALL:
    R.screen(name, (cx, cy, ZW), 0.0, 0.0, w, h, px=px, bright=1.2)
    # the seams of the tiled display cubes (thin dark strips just in front of the canvas)
    for i in range(1, nc):
        x = cx - w / 2 + w * i / nc
        quad('Bezel', [(x - 0.006, cy - h / 2, ZW + 0.003), (x + 0.006, cy - h / 2, ZW + 0.003), (x + 0.006, cy + h / 2, ZW + 0.003), (x - 0.006, cy + h / 2, ZW + 0.003)], (0, 0, 1))
    for j in range(1, nr):
        y = cy - h / 2 + h * j / nr
        quad('Bezel', [(cx - w / 2, y - 0.006, ZW + 0.003), (cx + w / 2, y - 0.006, ZW + 0.003), (cx + w / 2, y + 0.006, ZW + 0.003), (cx - w / 2, y + 0.006, ZW + 0.003)], (0, 0, 1))
# speakers either side of the wall, a PTZ camera dome on the top of the frame
for sx in (-1, 1):
    xs_ = sx * 6.98
    R.uvbox(S, 'Black', xs_ - 0.18, xs_ + 0.18, 1.2, 3.3, Z0, Z0 + 0.28, skip=('nz',))
    quad('PlasticDark', [(xs_ - 0.16, 1.22, Z0 + 0.282), (xs_ + 0.16, 1.22, Z0 + 0.282), (xs_ + 0.16, 3.28, Z0 + 0.282), (xs_ - 0.16, 3.28, Z0 + 0.282)], (0, 0, 1))
    for yy in (1.55, 2.25, 2.95):
        S.cyl('Black', (xs_, yy, 0), 0.11, 0.07, Z0 + 0.283, Z0 + 0.29, 10, axis='z', cap0=False)
S.sphere('Black', (0.0, HF - 0.14, ZW + 0.12), 0.09, 0.09, 0.09, 10, 4, v0=0.0, v1=0.5)
R.uvbox(S, 'Black', -0.08, 0.08, HF - 0.14, HF, ZW + 0.04, ZW + 0.14, skip=('top', 'nz'))
mark('video wall')


# ═════════════ front corners: clocks (ZULU / LOCAL), secondary TVs, acoustic panels, the lectern ═════════════
def clock(c, label, r=0.2):
    """a round wall clock facing +z: rim, face, hour ticks and hands (flat quads)"""
    S.cyl('Black', (c[0], c[1], 0), r * 1.08, r * 1.08, c[2], c[2] + 0.05, 16, axis='z', cap0=False)
    disc('FlagWhite', (c[0], c[1], c[2] + 0.051), r, 16, (0, 0, 1))
    for k in range(12):
        a = 2 * PI * k / 12
        L = 0.05 if k % 3 == 0 else 0.025
        w = 0.008 if k % 3 == 0 else 0.005
        d, s = Vector((math.sin(a), math.cos(a))), Vector((math.cos(a), -math.sin(a)))
        p0, p1 = d * (r - 0.02 - L), d * (r - 0.02)
        pts = [(c[0] + q.x, c[1] + q.y, c[2] + 0.052) for q in (p0 - s * w, p1 - s * w, p1 + s * w, p0 + s * w)]
        S.g('Black').face(pts, None, (0, 0, 1))
    for (a, L, w) in ((0.9, r * 0.55, 0.012), (-1.6, r * 0.8, 0.007), (2.6, r * 0.85, 0.003)):
        d, s = Vector((math.sin(a), math.cos(a))), Vector((math.cos(a), -math.sin(a)))
        p0, p1 = d * -0.02, d * L
        pts = [(c[0] + q.x, c[1] + q.y, c[2] + 0.054) for q in (p0 - s * w, p1 - s * w, p1 + s * w, p0 + s * w)]
        S.g('FlagRed' if w < 0.004 else 'Black').face(pts, None, (0, 0, 1))
    R.label(label, (c[0], c[1] - r - 0.09, c[2] + 0.02), 0.0, 0.0, h=0.08, st='w')


for sx, lab in ((-1, 'ZULU'), (1, 'LOCAL')):
    clock((sx * 8.35, 3.35, Z0 + 0.001), lab)
    # a secondary TV under each clock (weather / news)
    R.monitor(S, None, (sx * 8.35, 2.05, Z0 + 0.08), 0.0, 0.0, w=1.2, h=0.68, depth=0.06, bezel=0.02, art=5 if sx < 0 else 6)
    R.label('WEATHER' if sx < 0 else 'NEWS', (sx * 8.35, 1.6, Z0 + 0.03), 0.0, 0.0, h=0.05, st='w')
    for k in range(3):
        x = sx * (7.55 + k * 0.84)
        R.uvbox(S, 'Carpet', x - 0.4, x + 0.4, 0.25, 1.25, Z0, Z0 + 0.04, skip=('nz', 'bottom'))
# the lectern for the ops briefings, front left
M = R.mat3(0.35)
lo = (-8.3, 0.0, -6.0)
R.obox(S, 'Wood', M, lo, -0.32, 0.32, 0.0, 1.0, -0.22, 0.22, skip=('bottom',))
R.obox(S, 'Wood', M @ R.mat3(0, 0.35), R.xf(M, lo, (0, 1.0, 0.0)), -0.36, 0.36, -0.03, 0.02, -0.3, 0.28)
R.obox(S, 'Black', M, lo, -0.34, 0.34, 0.0, 0.04, -0.24, 0.24, skip=('bottom',))
S.beam('Black', R.xf(M, lo, (0.2, 1.05, -0.1)), R.xf(M, lo, (0.22, 1.35, 0.05)), 0.012, caps=False)
R.label('JOC', R.xf(M, lo, (0, 0.62, 0.225)), 0.35, 0.0, h=0.12, st='big')
# comms racks in the front right corner: crypto, radios, network, with status lights
for k in range(3):
    x0 = 7.45 + k * 0.66
    R.uvbox(S, 'PlasticDark', x0, x0 + 0.6, 0.0, 2.1, Z0 + 0.45, Z0 + 1.45, skip=('bottom', 'nz'))
    R.uvbox(S, 'Black', x0 + 0.03, x0 + 0.57, 0.08, 2.02, Z0 + 1.45, Z0 + 1.46, skip=('nz',))
    for j in range(9):
        y = 0.2 + j * 0.2
        quad('Panel', [(x0 + 0.05, y, Z0 + 1.462), (x0 + 0.55, y, Z0 + 1.462), (x0 + 0.55, y + 0.15, Z0 + 1.462), (x0 + 0.05, y + 0.15, Z0 + 1.462)], (0, 0, 1))
        for i in range(4):
            if (i + j + k) % 3:
                m = ['LampGreen', 'LampGreen', 'LampAmber', 'LampRed', 'LampBlue'][(i * 3 + j * 5 + k) % 5]
                xx = x0 + 0.1 + i * 0.05
                quad(m, [(xx, y + 0.1, Z0 + 1.464), (xx + 0.02, y + 0.1, Z0 + 1.464), (xx + 0.02, y + 0.12, Z0 + 1.464), (xx, y + 0.12, Z0 + 1.464)], (0, 0, 1))
    R.label(['KG CRYPTO', 'RADIOS', 'SIPR · NIPR'][k], (x0 + 0.3, 2.02, Z0 + 1.465), 0.0, 0.0, h=0.03, st='y')
R.label('AUTHORIZED ACCESS ONLY', (8.43, 2.25, Z0 + 1.46), 0.0, 0.0, h=0.035, st='r')
mark('front corners')


# ═════════════ desks: three rows of six positions facing the wall ═════════════
def desk_row(y, zf):
    """a continuous ops desk: top, rubber edge, a modesty panel at the front (toward the wall), end panels and
    legs, the monitor rail at the back, a cable trough under the top, a name strip on the front"""
    zb = zf + DD
    R.uvbox(S, 'Panel', RX0, RX1, y + DH - 0.03, y + DH, zf, zb)
    R.uvbox(S, 'Rubber', RX0, RX1, y + DH - 0.034, y + DH + 0.004, zb, zb + 0.014, skip=('bottom',))
    R.uvbox(S, 'Console', RX0, RX1, y + 0.03, y + DH - 0.03, zf, zf + 0.03, skip=('top',))
    quad('Black', [(RX0, y, zf - 0.001), (RX1, y, zf - 0.001), (RX1, y + 0.03, zf - 0.001), (RX0, y + 0.03, zf - 0.001)], (0, 0, -1))
    for x in (RX0, RX1):
        R.uvbox(S, 'Console', x - 0.02, x + 0.02, y, y + DH - 0.03, zf, zb - 0.02, skip=('top', 'bottom'))
    for x in POS[:-1]:
        xm = x + 1.25
        R.uvbox(S, 'Steel', xm - 0.025, xm + 0.025, y, y + DH - 0.03, zf + 0.03, zf + 0.12, skip=('top', 'bottom', 'nz'))
        R.uvbox(S, 'Steel', xm - 0.025, xm + 0.025, y, y + 0.04, zf + 0.03, zb - 0.08, skip=('bottom', 'nz'))
    R.uvbox(S, 'Steel', RX0, RX1, y + DH - 0.16, y + DH - 0.03, zf + 0.06, zf + 0.2, skip=('top', 'nx', 'px'))
    R.uvbox(S, 'Metal', RX0, RX1, y + DH, y + DH + 0.045, zf + 0.02, zf + 0.07, skip=('bottom',))
    R.uvbox(S, 'Metal', RX0, RX1, y + DH - 0.1, y + DH - 0.07, zf - 0.004, zf, skip=('pz', 'nx', 'px'))


def display(name, c, yaw, tilt, w, h, art=None, px=None, stand=0.08, sticker=None, bright=None):
    """a flat panel on a slim stand; name → a live screen, else art (a ScreenArt picture) or dark; a coloured
    classification sticker on the bezel (green / red / orange)"""
    M = R.mat3(yaw, tilt)
    b = 0.014
    R.obox(S, 'Bezel', M, c, -w / 2 - b, w / 2 + b, -h / 2 - b, h / 2 + b, -0.035, 0.0)
    R.obox(S, 'Bezel', M, c, -w * 0.16, w * 0.16, -h * 0.22, h * 0.22, -0.065, -0.035, skip=('pz',))
    if stand:
        Mz = R.mat3(yaw)
        base = (c[0], c[1] - h / 2 - b - stand, c[2])
        R.obox(S, 'Bezel', Mz, base, -0.025, 0.025, 0.0, stand + h * 0.3, -0.09, -0.06, skip=('top', 'bottom'))
        R.obox(S, 'Bezel', Mz, base, -0.11, 0.11, 0.0, 0.01, -0.16, 0.04, skip=('bottom',))
        S.beam('Cable', R.xf(Mz, base, (0.0, stand + h * 0.25, -0.09)), R.xf(Mz, base, (0.03, 0.005, -0.2)), 0.009, caps=False)
    if sticker:
        R.oquad(S, sticker, M, R.xf(M, c, (-w / 2 + 0.03, h / 2 + b * 0.5, 0.0005)), -0.014, 0.014, -0.005, 0.005)
    if name:
        return R.screen(name, R.xf(M, c, (0, 0, 0.002)), yaw, tilt, w, h, px=px, bright=bright)
    if art is not None:
        k = int(art) % 8
        u0, v0 = (k % 4) / 4, (k // 4) / 2
        R.oquad(S, 'ScreenArt', M, c, -w / 2, w / 2, -h / 2, h / 2, 0.002, uv=[(u0, v0), (u0 + 0.25, v0), (u0 + 0.25, v0 + 0.5), (u0, v0 + 0.5)])
    else:
        R.oquad(S, 'Screen', M, c, -w / 2, w / 2, -h / 2, h / 2, 0.002)
    return None


def flat(mat, M, o, x0, x1, z0, z1, y=0.0):
    """a horizontal quad in a yawed frame (local x across, z toward the operator)"""
    S.g(mat).face([R.xf(M, o, (x0, y, z0)), R.xf(M, o, (x0, y, z1)), R.xf(M, o, (x1, y, z1)), R.xf(M, o, (x1, y, z0))], None, (0, 1, 0))


def keyboard(c, yaw=0.0, w=0.44, d=0.15):
    M = R.mat3(yaw)
    R.obox(S, 'PlasticDark', M, c, -w / 2, w / 2, 0.0, 0.02, -d / 2, d / 2, skip=('bottom',))
    flat('Black', M, c, -w / 2 + 0.012, w / 2 - 0.09, -d / 2 + 0.012, d / 2 - 0.012, 0.0205)
    flat('Black', M, c, w / 2 - 0.08, w / 2 - 0.012, -d / 2 + 0.05, d / 2 - 0.012, 0.0205)
    for j in range(4):
        z = -d / 2 + 0.03 + j * 0.028
        flat('Panel', M, c, -w / 2 + 0.014, w / 2 - 0.092, z - 0.004, z + 0.004, 0.021)


def mouse(c, yaw=0.0):
    M = R.mat3(yaw)
    flat('Black', M, c, -0.12, 0.12, -0.1, 0.1, 0.002)
    R.obox(S, 'PlasticDark', M, R.xf(M, c, (0, 0.002, 0)), -0.03, 0.03, 0.0, 0.03, -0.05, 0.05, skip=('bottom',))


def phone(c, yaw=0.0, red=False):
    """a desk phone (the red ones are the secure lines): a sloped body, display, keys, the handset and its cord"""
    M = R.mat3(yaw)
    Mt = R.mat3(yaw, 0.35)
    m = 'Red' if red else 'PlasticDark'
    R.obox(S, m, M, c, -0.1, 0.1, 0.0, 0.05, -0.1, 0.1, skip=('bottom',))
    R.obox(S, m, Mt, R.xf(M, c, (0, 0.05, 0.0)), -0.1, 0.1, -0.012, 0.012, -0.1, 0.1, skip=('bottom',))
    R.oquad(S, 'Screen', R.mat3(yaw, 0.35 + PI / 2), R.xf(M, c, (0.035, 0.064, -0.03)), -0.05, 0.05, -0.03, 0.025)
    R.oquad(S, 'Plastic', R.mat3(yaw, 0.35 + PI / 2), R.xf(M, c, (0.035, 0.066, 0.05)), -0.05, 0.05, -0.04, 0.03)
    R.obox(S, 'Black', M, R.xf(M, c, (-0.075, 0.062, 0.0)), -0.025, 0.025, 0.0, 0.03, -0.09, 0.09, skip=('bottom',))
    S.beam('Black', R.xf(M, c, (-0.1, 0.03, 0.08)), R.xf(M, c, (-0.16, 0.0, 0.18)), 0.006, caps=False)


def headset(c, yaw=0.0):
    M = R.mat3(yaw)
    pts = [(-0.075, 0.03, 0), (-0.06, 0.14, 0), (0.06, 0.14, 0), (0.075, 0.03, 0)]
    for a, b in zip(pts, pts[1:]):
        S.beam('Black', R.xf(M, c, a), R.xf(M, c, b), 0.018, 0.008, caps=False)
    for sx in (-1, 1):
        R.obox(S, 'Black', M, R.xf(M, c, (sx * 0.075, 0.03, 0)), -0.016, 0.016, -0.04, 0.03, -0.035, 0.035, skip=('bottom',))
    S.beam('Black', R.xf(M, c, (-0.09, 0.0, 0.0)), R.xf(M, c, (-0.02, 0.0, 0.1)), 0.006, caps=False)


def mug(c, mat='FlagWhite'):
    cyl(mat, (c[0], 0, c[2]), 0.04, c[1], c[1] + 0.1, 8, cap0=False, cap1=False)
    disc('Black', (c[0], c[1] + 0.07, c[2]), 0.036, 8, (0, 1, 0))
    S.beam(mat, (c[0] + 0.04, c[1] + 0.08, c[2]), (c[0] + 0.065, c[1] + 0.05, c[2]), 0.012, 0.008, caps=False)
    S.beam(mat, (c[0] + 0.065, c[1] + 0.05, c[2]), (c[0] + 0.04, c[1] + 0.02, c[2]), 0.012, 0.008, caps=False)


def papers(c, yaw=0.0, n=3, mat='Paper'):
    for k in range(n):
        M = R.mat3(yaw + (k - 1) * 0.12)
        flat(mat, M, (c[0] + k * 0.02, c[1] + 0.001 + k * 0.0015, c[2] + k * 0.015), -0.105, 0.105, -0.148, 0.148)


def binder(c, yaw=0.0, mat='FlagBlue'):
    M = R.mat3(yaw)
    R.obox(S, mat, M, c, -0.15, 0.15, 0.0, 0.05, -0.14, 0.14, skip=('bottom',))
    R.obox(S, 'Paper', M, c, -0.14, 0.14, 0.004, 0.046, -0.135, 0.145, skip=('bottom', 'top', 'nz'))


def chair(pos, yaw=0.0, mat='Seat', h=0.47, arms=True, tall=False):
    """an office task chair: a five-star base (one flat star), casters, gas lift, seat, back, arms; tall = a
    drafting chair with a foot ring"""
    M = R.mat3(yaw)
    o = pos
    star = []
    for i in range(10):
        a = 2 * PI * i / 10 + 0.31
        r = 0.31 if i % 2 == 0 else 0.07
        star.append((math.cos(a) * r, math.sin(a) * r))
    S.g('Black').face([R.xf(M, o, (x, 0.075, z)) for (x, z) in star], None, (0, 1, 0))
    for i in range(10):
        (ax, az), (bx, bz) = star[i], star[(i + 1) % 10]
        nl = M @ Vector((bz - az, 0.0, -(bx - ax)))
        S.g('Black').face([R.xf(M, o, (ax, 0.045, az)), R.xf(M, o, (bx, 0.045, bz)), R.xf(M, o, (bx, 0.075, bz)), R.xf(M, o, (ax, 0.075, az))], None, tuple(nl))
        if i % 2 == 0:
            R.obox(S, 'Black', M, R.xf(M, o, (ax * 0.93, 0.0, az * 0.93)), -0.018, 0.018, 0.0, 0.045, -0.018, 0.018, skip=('bottom', 'top'))
    R.ocyl(S, 'Chrome', M, o, (0, 0, 0), 0.022, 0.022, 0.075, h - 0.06, 6, axis='y', cap0=False, cap1=False)
    R.ocyl(S, 'Black', M, o, (0, 0, 0), 0.04, 0.04, 0.075, 0.2, 6, axis='y', cap0=False)
    if tall:
        ring = [R.xf(M, o, (math.cos(2 * PI * k / 8) * 0.24, h - 0.36, math.sin(2 * PI * k / 8) * 0.24)) for k in range(9)]
        for a, b in zip(ring, ring[1:]):
            S.beam('Chrome', a, b, 0.018, caps=False)
        for k in (0, 3, 6):
            S.beam('Chrome', R.xf(M, o, (0, h - 0.36, 0)), ring[k], 0.014, caps=False)
    R.obox(S, mat, M, o, -0.25, 0.25, h - 0.06, h + 0.03, -0.24, 0.22)
    R.obox(S, 'Black', M, o, -0.14, 0.14, h - 0.1, h - 0.06, -0.12, 0.12, skip=('top',))
    Mb = M @ R.mat3(0, -0.12)
    top = 0.72 if tall else 0.6
    R.obox(S, mat, Mb, R.xf(M, o, (0, h + 0.1, 0.25)), -0.23, 0.23, 0.0, top - 0.1, -0.035, 0.035)
    S.beam('Black', R.xf(M, o, (0, h - 0.04, 0.23)), R.xf(M, o, (0, h + 0.14, 0.25)), 0.05, 0.03, caps=False)
    if arms:
        for sx in (-0.27, 0.27):
            R.obox(S, 'Black', M, o, sx - 0.028, sx + 0.028, h + 0.19, h + 0.225, -0.13, 0.12)
            S.beam('Black', R.xf(M, o, (sx, h - 0.02, 0.03)), R.xf(M, o, (sx, h + 0.19, 0.03)), 0.028, 0.05, caps=False)


def trash(c, r=0.15, h=0.36, mat='PlasticDark'):
    cyl(mat, c, r, c[1], c[1] + h, 10, cap0=False, cap1=False)
    disc('Black', (c[0], c[1] + h - 0.08, c[2]), r * 0.95, 10, (0, 1, 0))


def desk_lamp(c, yaw=0.0):
    M = R.mat3(yaw)
    R.ocyl(S, 'Black', M, c, (0, 0, 0), 0.07, 0.07, 0.0, 0.02, 8, axis='y', cap0=False)
    p1 = R.xf(M, c, (0.0, 0.32, 0.08))
    p2 = R.xf(M, c, (0.0, 0.42, 0.34))
    S.beam('Black', R.xf(M, c, (0, 0.02, 0)), p1, 0.014, caps=False)
    S.beam('Black', p1, p2, 0.014, caps=False)
    R.obox(S, 'Black', M, p2, -0.15, 0.15, -0.02, 0.01, -0.03, 0.03)
    S.g('Light').face([R.xf(M, p2, (-0.14, -0.021, -0.022)), R.xf(M, p2, (0.14, -0.021, -0.022)), R.xf(M, p2, (0.14, -0.021, 0.022)), R.xf(M, p2, (-0.14, -0.021, 0.022))], None, (0, -1, 0))


def position(xc, y, zf, arts, live=None, live_px=(1024, 640), red_phone=False, seed=0):
    """one operator position: monitors on the rail (a live main screen and / or art screens), keyboard, mouse,
    phone, headset and the clutter; returns the main screen's centre"""
    top = y + DH
    zs = zf + 0.14
    stick = ['Green', 'Red', 'Orange'][seed % 3]
    main = None
    if live:
        w, h = 0.7, 0.4375
        c = (xc, top + 0.07 + h / 2 + 0.014, zs)
        display(live, c, 0.0, 0.06, w, h, px=live_px, stand=0.07, sticker='Red', bright=1.1)
        main = c
        for k, a in enumerate(arts):
            sx = -1 if k == 0 else 1
            display(None, (xc + sx * 0.83, top + 0.07 + 0.165 + 0.014, zs + 0.13), sx * 0.38, 0.06, 0.53, 0.33, art=a, stand=0.07, sticker=['Green', 'Red'][k % 2])
    else:
        offs = [(-0.56, 0.2), (0.56, -0.2)] if len(arts) == 2 else [(-1.06, 0.36), (0.0, 0.0), (1.06, -0.36)]
        for (dx, yaw), a in zip(offs, arts):
            display(None, (xc + dx, top + 0.07 + 0.165 + 0.014, zs + abs(dx) * 0.14), yaw, 0.06, 0.53, 0.33, art=a, stand=0.07, sticker=stick)
    keyboard((xc - 0.05, top, zf + DD - 0.22))
    mouse((xc + 0.32, top, zf + DD - 0.2))
    phone((xc - 0.78, top, zf + DD - 0.3), 0.35, red=red_phone)
    headset((xc + 0.78, top + 0.02, zf + 0.5), -0.3)
    if seed % 2 == 0:
        papers((xc - 0.5, top, zf + DD - 0.18), 0.1 + seed * 0.03)
    if seed % 3 == 1:
        mug((xc + 0.62, top, zf + DD - 0.12), 'FlagWhite' if seed % 2 else 'FlagNavy')
    if seed % 4 == 2:
        binder((xc + 0.95, top, zf + 0.4), 0.15, ['FlagBlue', 'Red', 'Black'][seed % 3])
    if seed % 5 == 3:
        desk_lamp((xc - 1.05, top, zf + 0.2), 0.4)
    if seed % 3 == 2:
        M = R.mat3(-0.25 + seed * 0.05)
        flat('FlagYellow', M, (xc + 0.55, top + 0.004, zf + DD - 0.25), -0.108, 0.108, -0.15, 0.15)
        for j in range(5):
            flat('Marker', M, (xc + 0.55, top + 0.005, zf + DD - 0.25), -0.09, 0.05 + (j % 3) * 0.02, -0.11 + j * 0.035, -0.108 + j * 0.035)
        S.beam('Black', R.xf(M, (xc + 0.55, top, zf + DD - 0.25), (0.12, 0.006, -0.1)), R.xf(M, (xc + 0.55, top, zf + DD - 0.25), (0.14, 0.006, 0.04)), 0.008, caps=False)
    if seed % 4 == 3:
        cyl('Glass', (xc - 0.95, 0, zf + DD - 0.45), 0.033, top, top + 0.2, 6, cap0=False)
        cyl('FlagBlue', (xc - 0.95, 0, zf + DD - 0.45), 0.018, top + 0.2, top + 0.225, 6, cap0=False)
    # a KVM switch under the rail, the computer tower under the desk
    R.uvbox(S, 'PlasticDark', xc + 0.38, xc + 0.62, top, top + 0.045, zf + 0.08, zf + 0.22, skip=('bottom',))
    quad('LampGreen', [(xc + 0.4, top + 0.02, zf + 0.221), (xc + 0.43, top + 0.02, zf + 0.221), (xc + 0.43, top + 0.03, zf + 0.221), (xc + 0.4, top + 0.03, zf + 0.221)], (0, 0, 1))
    R.uvbox(S, 'PlasticDark', xc + 0.72, xc + 0.92, y, y + 0.46, zf + 0.06, zf + 0.5, skip=('bottom', 'nz'))
    quad('LampBlue', [(xc + 0.8, y + 0.4, zf + 0.501), (xc + 0.84, y + 0.4, zf + 0.501), (xc + 0.84, y + 0.41, zf + 0.501), (xc + 0.8, y + 0.41, zf + 0.501)], (0, 0, 1))
    return main


# the cells (a sign hangs over each position) and the name plates
CELLS = [
    [('COMBAT OPS · OFFENSIVE', 'SODO'), ('AIRSPACE', 'AIRSPACE'), ('DYNAMIC OPS', 'DYN OPS'), ('ISR DIVISION', 'ISR'), ('PERSONNEL RECOVERY', 'PR'), ('WEATHER', 'WX')],
    [('COMBAT PLANS', 'ATO'), ('TARGETS', 'TGTS'), ('DYNAMIC TARGETING', 'DT'), ('TASKING · ATO', 'TASKS'), ('AIR MOBILITY', 'AMD'), ('SPACE · CYBER', 'SPACE')],
    [('STRATEGY', 'STRAT'), ('JAG · LEGAL', 'JAG'), ('SENIOR OPS', 'CCO'), ('JOINT INTERFACE', 'COMMS'), ('INTEL · SIDO', 'SIDO'), ('COALITION LNO', 'LNO')],
]
LIVE = {(0, 2): 'screen_ws_map', (0, 3): 'screen_ws_intel', (1, 2): 'screen_ws_strike', (1, 3): 'screen_ws_tasks',
        (2, 2): 'screen_ws_command', (2, 3): 'screen_ws_radio'}
STANDS = {'screen_ws_map': 'stand_map', 'screen_ws_intel': 'stand_intel', 'screen_ws_strike': 'stand_strike',
          'screen_ws_tasks': 'stand_tasks', 'screen_ws_command': 'stand_command', 'screen_ws_radio': 'stand_radio'}
MAINS = {}
seed = 0
for r, (y, zf) in enumerate(ROWS):
    desk_row(y, zf)
    for p, xc in enumerate(POS):
        seed += 1
        live = LIVE.get((r, p))
        a3 = ((seed * 3) % 8, (seed * 5 + 1) % 8, (seed * 7 + 2) % 8)
        arts = a3[:2] if (live or seed % 3 == 0) else a3
        if live == 'screen_ws_strike':
            arts = (arts[0],)
        c = position(xc, y, zf, arts, live, red_phone=(seed % 4 == 1), seed=seed)
        if live:
            MAINS[live] = c
        cp_, cyaw = (xc + ((seed % 3) - 1) * 0.08, y, zf + DD + 0.5), ((seed % 5) - 2) * 0.06
        chair(cp_, cyaw, mat='SeatBlue' if r == 2 else 'Seat')
        if seed % 4 == 0:
            Mj = R.mat3(cyaw) @ R.mat3(0, -0.12)
            jo = R.xf(R.mat3(cyaw), cp_, (0, 0.47 + 0.1, 0.25))
            R.obox(S, 'Canvas', Mj, jo, -0.25, 0.25, 0.28, 0.52, -0.05, 0.05)
            R.obox(S, 'Canvas', Mj, jo, -0.22, 0.22, -0.05, 0.28, 0.035, 0.06, skip=('nz',))
            R.obox(S, 'Canvas', Mj, jo, -0.33, -0.25, 0.05, 0.5, -0.03, 0.05)
            R.obox(S, 'Canvas', Mj, jo, 0.25, 0.33, 0.05, 0.5, -0.03, 0.05)
        cell, plate = CELLS[r][p]
        R.label(plate, (xc, y + DH - 0.085, zf - 0.005), PI, 0.0, h=0.03, st='e')
        R.label(plate, (xc - 0.9, y + DH + 0.035, zf + 0.071), 0.0, 0.0, h=0.022, st='w')
    trash((RX0 + 0.25, y, zf + DD + 0.3))
    trash((RX1 - 0.25, y, zf + DD + 0.3), mat='Red')
mark('desk rows')

# the strike cell's hard panel: a small box on the rail right of the main screen
cx, cy, cz = MAINS['screen_ws_strike']
Mp = R.mat3(-0.18, 0.12)
pc = (cx + 0.5, ROWS[1][0] + DH + 0.2, cz + 0.05)
R.obox(S, 'Panel', Mp, pc, -0.12, 0.12, -0.16, 0.16, -0.07, 0.0)
R.obox(S, 'Bezel', Mp, pc, -0.125, 0.125, -0.165, 0.165, -0.075, -0.07, skip=('pz',))
R.obox(S, 'Steel', R.mat3(-0.18), (pc[0], ROWS[1][0] + DH, pc[2] - 0.02), -0.03, 0.03, 0.0, 0.05, -0.05, 0.02, skip=('bottom', 'top'))
R.lamp('lamp_execute', R.xf(Mp, pc, (0.0, 0.115, 0.0)), -0.18, 0.12, r=0.016, color='#ff3a20', mat='LampRed', square=True)
R.label('STRIKE', R.xf(Mp, pc, (0.0, 0.145, 0.001)), -0.18, 0.12, h=0.016, st='e')
R.button('btn_transmit', R.xf(Mp, pc, (0.0, 0.035, 0.0)), -0.18, 0.12, r=0.018, mat='Yellow', square=True)
R.label('TRANSMIT MARKS', R.xf(Mp, pc, (0.0, 0.0, 0.001)), -0.18, 0.12, h=0.013, st='e')
R.button('btn_execute', R.xf(Mp, pc, (0.0, -0.085, 0.0)), -0.18, 0.12, r=0.022, mat='Red')
R.guard('guard_execute', R.xf(Mp, pc, (0.0, -0.085 + 0.04, 0.0)), -0.18, 0.12, w=0.075, h=0.08, d=0.045)
R.label('EXECUTE STRIKE', R.xf(Mp, pc, (0.0, -0.148, 0.001)), -0.18, 0.12, h=0.013, st='r')
# the radio cell: a radio control head (frequency readout, knobs) and a hand mic by the main screen
cx, cy, cz = MAINS['screen_ws_radio']
ry = ROWS[2][0] + DH
R.uvbox(S, 'PlasticDark', cx - 0.64, cx - 0.36, ry, ry + 0.09, cz + 0.2, cz + 0.36, skip=('bottom',))
quad('LampAmber', [(cx - 0.62, ry + 0.05, cz + 0.361), (cx - 0.47, ry + 0.05, cz + 0.361), (cx - 0.47, ry + 0.075, cz + 0.361), (cx - 0.62, ry + 0.075, cz + 0.361)], (0, 0, 1))
for k in range(3):
    S.cyl('Black', (cx - 0.44 + k * 0.035, ry + 0.03, 0), 0.012, 0.012, cz + 0.36, cz + 0.375, 8, axis='z', cap0=False)
R.label('RADIO', (cx - 0.5, ry + 0.092, cz + 0.28), 0.0, PI / 2, h=0.02, st='w')
R.obox(S, 'Black', R.mat3(0.3), (cx - 0.3, ry, cz + 0.45), -0.03, 0.03, 0.0, 0.03, -0.05, 0.05, skip=('bottom',))
S.beam('Cable', (cx - 0.3, ry + 0.015, cz + 0.4), (cx - 0.45, ry + 0.02, cz + 0.28), 0.006, caps=False)

# stations: seated, the eye over the chair, looking at the main screen (the strike one takes in its panel too)
for live, st in STANDS.items():
    c = MAINS[live]
    r = [k for k, v in LIVE.items() if v == live][0][0]
    y, zf = ROWS[r]
    eye = (c[0], y + 1.2, zf + DD + 0.28)
    if live == 'screen_ws_strike':
        look(st, eye, (c[0] + 0.15, c[1] - 0.05, c[2]), fov=50)
    else:
        look(st, eye, c, fov=44)
mark('hard panels')


# ═════════════ hanging cell signs, the coalition flags on the side walls ═════════════
def hanging_sign(text, c, w=2.0, h=0.25):
    """a cell sign hung close under the ceiling (kept above the sightlines from the back rows to the wall)"""
    x, y, z = c
    R.uvbox(S, 'WallDark', x - w / 2, x + w / 2, y - h / 2, y + h / 2, z - 0.015, z + 0.015)
    quad('LightBlue', [(x - w / 2, y - h / 2 - 0.001, z - 0.012), (x - w / 2, y - h / 2 - 0.001, z + 0.012), (x + w / 2, y - h / 2 - 0.001, z + 0.012), (x + w / 2, y - h / 2 - 0.001, z - 0.012)], (0, -1, 0))
    for sx in (-1, 1):
        S.beam('Metal', (x + sx * (w / 2 - 0.1), y + h / 2, z), (x + sx * (w / 2 - 0.1), H, z), 0.012, caps=False)
    R.label(text, (x, y, z + 0.016), 0.0, 0.0, h=h * 0.44, w=w - 0.1, st='w')


for r, (y, zf) in enumerate(ROWS):
    for p, xc in enumerate(POS):
        hanging_sign(CELLS[r][p][0], (xc, 4.02, zf + 0.3), w=2.1)


def clip_box(poly, x0, x1, y0, y1):
    """clip a convex polygon to an axis-aligned box (Sutherland–Hodgman)"""
    def clip(poly, inside, inter):
        out = []
        for i in range(len(poly)):
            a, b = poly[i], poly[(i + 1) % len(poly)]
            if inside(a):
                out.append(a)
            if inside(a) != inside(b):
                out.append(inter(a, b))
        return out

    def ix(a, b, x):
        t = (x - a[0]) / (b[0] - a[0])
        return (x, a[1] + (b[1] - a[1]) * t)

    def iy(a, b, y):
        t = (y - a[1]) / (b[1] - a[1])
        return (a[0] + (b[0] - a[0]) * t, y)
    for inside, inter in ((lambda q: q[0] >= x0, lambda a, b: ix(a, b, x0)), (lambda q: q[0] <= x1, lambda a, b: ix(a, b, x1)),
                          (lambda q: q[1] >= y0, lambda a, b: iy(a, b, y0)), (lambda q: q[1] <= y1, lambda a, b: iy(a, b, y1))):
        poly = clip(poly, inside, inter)
        if len(poly) < 3:
            return []
    return poly


def rect(x0, x1, y0, y1):
    return [(x0, y0), (x1, y0), (x1, y1), (x0, y1)]


def band(p0, p1, hw):
    d = Vector((p1[0] - p0[0], p1[1] - p0[1]))
    d.normalize()
    n = Vector((-d.y, d.x)) * hw
    return [(p0[0] + n.x, p0[1] + n.y), (p1[0] + n.x, p1[1] + n.y), (p1[0] - n.x, p1[1] - n.y), (p0[0] - n.x, p0[1] - n.y)]


def ngon(cx, cy, r, n, rot=0.0):
    return [(cx + r * math.cos(rot + 2 * PI * k / n), cy + r * math.sin(rot + 2 * PI * k / n)) for k in range(n)]


def union_jack(W, H, ox=0.0, oy=0.0):
    L = [('FlagNavy', rect(ox, ox + W, oy, oy + H))]
    for p0, p1 in (((ox, oy), (ox + W, oy + H)), ((ox, oy + H), (ox + W, oy))):
        L.append(('FlagWhite', band(p0, p1, H * 0.1)))
    for p0, p1 in (((ox, oy), (ox + W, oy + H)), ((ox, oy + H), (ox + W, oy))):
        L.append(('FlagRed', band(p0, p1, H * 0.034)))
    L.append(('FlagWhite', rect(ox, ox + W, oy + H / 3, oy + 2 * H / 3)))
    L.append(('FlagWhite', rect(ox + W / 2 - H / 6, ox + W / 2 + H / 6, oy, oy + H)))
    L.append(('FlagRed', rect(ox, ox + W, oy + H * 0.4, oy + H * 0.6)))
    L.append(('FlagRed', rect(ox + W / 2 - H * 0.1, ox + W / 2 + H * 0.1, oy, oy + H)))
    return [(m, clip_box(p, ox, ox + W, oy, oy + H)) for m, p in L]


def flag_design(kind, W, H):
    """the flag as layers of (material, convex polygon) in metres: x from the hoist, y up"""
    if kind == 'USA':
        L = [('FlagRed' if i % 2 == 0 else 'FlagWhite', rect(0, W, H - (i + 1) * H / 13, H - i * H / 13)) for i in range(13)]
        cw, ch = W * 0.4, H * 7 / 13
        L.append(('FlagNavy', rect(0, cw, H - ch, H)))
        for row in range(9):
            for k in range(6 if row % 2 == 0 else 5):
                x = cw * ((k + (0.5 if row % 2 == 0 else 1.0)) / 6.0)
                y = H - ch * (row + 0.5) / 9.0
                L.append(('FlagWhite', ngon(x, y, 0.011, 4, PI / 2)))
        return L
    if kind == 'UK':
        return union_jack(W, H)
    tri = {'FRA': ('FlagBlue', 'FlagWhite', 'FlagRed'), 'ITA': ('FlagGreen', 'FlagWhite', 'FlagRed'), 'BEL': ('Black', 'FlagYellow', 'FlagRed')}
    if kind in tri:
        a, b, c = tri[kind]
        return [(a, rect(0, W / 3, 0, H)), (b, rect(W / 3, 2 * W / 3, 0, H)), (c, rect(2 * W / 3, W, 0, H))]
    hor = {'NLD': ('FlagRed', 'FlagWhite', 'FlagBlue'), 'DEU': ('Black', 'FlagRed', 'FlagYellow')}
    if kind in hor:
        a, b, c = hor[kind]
        return [(a, rect(0, W, 2 * H / 3, H)), (b, rect(0, W, H / 3, 2 * H / 3)), (c, rect(0, W, 0, H / 3))]
    if kind == 'CAN':
        L = [('FlagRed', rect(0, W / 4, 0, H)), ('FlagWhite', rect(W / 4, 3 * W / 4, 0, H)), ('FlagRed', rect(3 * W / 4, W, 0, H))]
        cx, cy, s = W / 2, H * 0.5, H * 0.34
        L.append(('FlagRed', [(cx, cy + s), (cx + s * 0.35, cy + s * 0.3), (cx + s * 0.25, cy - s * 0.35), (cx, cy - s * 0.55), (cx - s * 0.25, cy - s * 0.35), (cx - s * 0.35, cy + s * 0.3)]))
        for sx in (-1, 1):
            L.append(('FlagRed', [(cx + sx * s * 0.2, cy + s * 0.2), (cx + sx * s * 0.9, cy + s * 0.35), (cx + sx * s * 0.7, cy - s * 0.25), (cx + sx * s * 0.2, cy - s * 0.3)]))
        L.append(('FlagRed', rect(cx - s * 0.05, cx + s * 0.05, cy - s * 0.95, cy - s * 0.4)))
        return L
    if kind == 'AUS':
        L = [('FlagNavy', rect(0, W, 0, H))] + union_jack(W / 2, H / 2, 0.0, H / 2)
        L.append(('FlagWhite', ngon(W / 4, H / 4, H * 0.14, 7, PI / 2)))
        for (x, y, r) in ((0.75, 0.82, 0.055), (0.62, 0.55, 0.05), (0.88, 0.6, 0.05), (0.75, 0.2, 0.06), (0.81, 0.45, 0.03)):
            L.append(('FlagWhite', ngon(W * x, H * y, H * r, 7, PI / 2)))
        return L
    if kind == 'DNK':
        return [('FlagRed', rect(0, W, 0, H)), ('FlagWhite', rect(W * 12 / 37, W * 16 / 37, 0, H)), ('FlagWhite', rect(0, W, H * 12 / 28, H * 16 / 28))]
    if kind == 'NOR':
        return [('FlagRed', rect(0, W, 0, H)), ('FlagWhite', rect(W * 6 / 22, W * 10 / 22, 0, H)), ('FlagWhite', rect(0, W, H * 6 / 16, H * 10 / 16)),
                ('FlagNavy', rect(W * 7 / 22, W * 9 / 22, 0, H)), ('FlagNavy', rect(0, W, H * 7 / 16, H * 9 / 16))]
    if kind == 'QAT':
        L = [('FlagMaroon', rect(0, W, 0, H)), ('FlagWhite', rect(0, W * 0.3, 0, H))]
        for k in range(9):
            y0, y1 = H * k / 9, H * (k + 1) / 9
            L.append(('FlagWhite', [(W * 0.3 - 0.001, y0), (W * 0.38, (y0 + y1) / 2), (W * 0.3 - 0.001, y1)]))
        return L
    if kind == 'ARE':
        return [('FlagGreen', rect(W / 4, W, 2 * H / 3, H)), ('FlagWhite', rect(W / 4, W, H / 3, 2 * H / 3)), ('Black', rect(W / 4, W, 0, H / 3)), ('FlagRed', rect(0, W / 4, 0, H))]
    return [('FlagWhite', rect(0, W, 0, H))]


FOLD = [0.0, 0.3, 0.64, 1.0]          # the cloth hangs in three slightly folded panels
FOLD_D = [0.0, 0.05, -0.015, 0.04]


def fold(u):
    for k in range(len(FOLD) - 1):
        if u <= FOLD[k + 1] + 1e-9:
            t = (u - FOLD[k]) / (FOLD[k + 1] - FOLD[k])
            return FOLD_D[k] + (FOLD_D[k + 1] - FOLD_D[k]) * t
    return FOLD_D[-1]


def flag(kind, o, ex, ey, W=1.4, Hf=0.8):
    """a hanging cloth flag: the design's polygons laid on the folded panels; a rod, its wires and finials"""
    ex, ey = Vector(ex), Vector(ey)
    n = ex.cross(ey)
    for li, (mat, poly) in enumerate(flag_design(kind, W, Hf)):
        for k in range(len(FOLD) - 1):
            p = clip_box(poly, FOLD[k] * W, FOLD[k + 1] * W, -1.0, Hf + 1.0)
            if len(p) < 3:
                continue
            pts = [tuple(Vector(o) + ex * x + ey * y + n * (fold(x / W) + li * 0.0012)) for (x, y) in p]
            S.g(mat).face(pts, None, tuple(n))
    top = Vector(o) + ey * (Hf + 0.03)
    a, b = top - ex * 0.06, top + ex * (W + 0.06)
    R._tube(S, tuple(a), tuple(b), 0.012, 'Chrome', 6)
    for p in (a, b):
        S.sphere('Brass', tuple(p), 0.022, 0.022, 0.022, 6, 3)
    for t in (0.1, 0.9):
        p = top + ex * (W * t)
        S.beam('Metal', tuple(p), (p.x, H, p.z), 0.006, caps=False)


FLAGS_L = ['USA', 'UK', 'AUS', 'CAN', 'FRA', 'QAT']
FLAGS_R = ['ITA', 'NLD', 'DNK', 'NOR', 'BEL', 'ARE']
for k, kind in enumerate(FLAGS_L):
    z = -4.2 + k * 1.95
    flag(kind, (X0 + 0.45, 3.05, z + 0.7), (0, 0, -1), (0, 1, 0))        # faces +x, the hoist toward +z (the viewer's left)
for k, kind in enumerate(FLAGS_R):
    z = -4.2 + k * 1.95
    flag(kind, (X1 - 0.45, 3.05, z - 0.7), (0, 0, 1), (0, 1, 0))         # faces −x
mark('signs + flags')


# ═════════════ ceiling services: downlights over the desks, troffers, diffusers, sprinklers, detectors, trays ═════════════
def downlight(x, z, y=H):
    disc('Steel', (x, y - 0.004, z), 0.1, 8, (0, -1, 0))
    disc('Light', (x, y - 0.006, z), 0.07, 8, (0, -1, 0))


def troffer(x, z, y=H, w=0.6, l=1.2):
    quad('Steel', [(x - w / 2 - 0.02, y - 0.004, z - l / 2 - 0.02), (x + w / 2 + 0.02, y - 0.004, z - l / 2 - 0.02), (x + w / 2 + 0.02, y - 0.004, z + l / 2 + 0.02), (x - w / 2 - 0.02, y - 0.004, z + l / 2 + 0.02)], (0, -1, 0))
    quad('LightDim', [(x - w / 2, y - 0.006, z - l / 2), (x + w / 2, y - 0.006, z - l / 2), (x + w / 2, y - 0.006, z + l / 2), (x - w / 2, y - 0.006, z + l / 2)], (0, -1, 0))
    for k in (-1, 1):
        zz = z + k * l / 6
        quad('Metal', [(x - w / 2, y - 0.008, zz - 0.012), (x + w / 2, y - 0.008, zz - 0.012), (x + w / 2, y - 0.008, zz + 0.012), (x - w / 2, y - 0.008, zz + 0.012)], (0, -1, 0))


def diffuser(x, z, y=H):
    for k, e in enumerate((0.3, 0.22, 0.14, 0.07)):
        quad('Plastic' if k % 2 == 0 else 'Steel', [(x - e, y - 0.004 - k * 0.004, z - e), (x + e, y - 0.004 - k * 0.004, z - e), (x + e, y - 0.004 - k * 0.004, z + e), (x - e, y - 0.004 - k * 0.004, z + e)], (0, -1, 0))


for r, (y, zf) in enumerate(ROWS):
    for xc in POS:
        for dx in (-0.6, 0.6):
            downlight(xc + dx, zf + 0.55)
for x in (-8.5, -4.5, 0.0, 4.5, 8.5):
    downlight(x, -6.3, HF)
for sx in (-1, 1):
    for z in (-4.0, -1.0, 2.0, 4.8):
        troffer(sx * 8.7, z)
for (x, z) in [(-5.0, -2.9), (0.0, -2.9), (5.0, -2.9), (-5.0, 0.6), (0.0, 0.6), (5.0, 0.6), (-5.0, 4.0), (0.0, 4.0), (5.0, 4.0), (-8.0, 6.3), (8.0, 6.3)]:
    diffuser(x, z)
for x in (-7.5, -2.5, 2.5, 7.5):
    for z in (-3.5, 0.0, 3.4, 6.2):
        if abs(x) < 6 and z > 5:
            continue
        S.cyl('Chrome', (x, 0, z), 0.012, 0.012, H - 0.05, H, 4, cap0=False, cap1=False)
        disc('Chrome', (x, H - 0.05, z), 0.03, 6, (0, -1, 0))
for (x, z) in [(-6.0, -1.5), (6.0, -1.5), (-6.0, 3.0), (6.0, 3.0), (0.0, -3.2), (-8.0, 5.8), (8.0, 5.8)]:
    S.cyl('FlagWhite', (x, 0, z), 0.07, 0.065, H - 0.04, H, 8, cap1=False)
    disc('LampGreen', (x + 0.03, H - 0.041, z), 0.006, 4, (0, -1, 0))
for (x, z) in [(-9.5, -6.9), (9.5, -6.9), (-9.5, 6.9), (9.5, 4.6)]:
    S.sphere('Black', (x, H - 0.02, z), 0.09, 0.09, 0.09, 8, 4, v0=0.0, v1=0.5)
for sx in (-1, 1):
    R.tray(S, (sx * 9.7, H - 0.25, Z0 + 0.5), (sx * 9.7, H - 0.25, Z1 - 0.3), w=0.3)
    for z in (-6.0, -3.0, 0.0, 3.0, 6.0):
        S.beam('Steel', (sx * 9.7, H - 0.25, z), (sx * 9.7, H, z), 0.02, caps=False)
# speakers in the ceiling (white discs), a projector-less ceiling
for (x, z) in [(-3.0, -1.0), (3.0, -1.0), (-3.0, 3.2), (3.0, 3.2)]:
    disc('FlagWhite', (x, H - 0.004, z), 0.13, 12, (0, -1, 0))
    for k in range(3):
        disc('Steel', (x, H - 0.006 - k * 0.001, z), 0.1 - k * 0.03, 12, (0, -1, 0))
mark('ceiling services')


# ═════════════ side walls: whiteboards, the map board, the notice board ═════════════
def whiteboard(z, y, w=2.4, h=1.2, sx=-1):
    x = sx * (X1 - 0.03)
    xa, xb = sorted((x, x - sx * 0.025))
    R.uvbox(S, 'Metal', xa, xb, y - h / 2 - 0.03, y + h / 2 + 0.03, z - w / 2 - 0.03, z + w / 2 + 0.03, skip=('nx' if sx < 0 else 'px',))
    xf = x - sx * 0.026
    quad('FlagWhite', [(xf, y - h / 2, z - w / 2), (xf, y - h / 2, z + w / 2), (xf, y + h / 2, z + w / 2), (xf, y + h / 2, z - w / 2)], (-sx, 0, 0))
    xa, xb = sorted((x, x - sx * 0.09))
    R.uvbox(S, 'Metal', xa, xb, y - h / 2 - 0.05, y - h / 2 - 0.03, z - w / 2, z + w / 2, skip=('nx' if sx < 0 else 'px',))
    for k, m in enumerate(('Marker', 'FlagRed', 'Black', 'FlagGreen')):
        zz = z - 0.4 + k * 0.12
        S.beam(m, (x - sx * 0.06, y - h / 2 - 0.02, zz), (x - sx * 0.06, y - h / 2 - 0.02, zz + 0.1), 0.016)
    # a status grid in marker, entries and ticks
    xm = xf - sx * 0.001
    for j in range(5):
        yy = y + h / 2 - 0.2 - j * 0.2
        quad('Black', [(xm, yy, z - w / 2 + 0.1), (xm, yy, z + w / 2 - 0.1), (xm, yy + 0.008, z + w / 2 - 0.1), (xm, yy + 0.008, z - w / 2 + 0.1)], (-sx, 0, 0))
        for i in range(3):
            za = z - w / 2 + 0.2 + i * (w - 0.3) / 3
            L = 0.3 + ((j * 3 + i) % 4) * 0.1
            quad(['Marker', 'FlagRed', 'Black'][(i + j) % 3], [(xm, yy + 0.05, za), (xm, yy + 0.05, za + L), (xm, yy + 0.07, za + L), (xm, yy + 0.07, za)], (-sx, 0, 0))
    for i in (1, 2):
        za = z - w / 2 + i * w / 3
        quad('Black', [(xm, y - h / 2 + 0.1, za), (xm, y - h / 2 + 0.1, za + 0.008), (xm, y + h / 2 - 0.1, za + 0.008), (xm, y + h / 2 - 0.1, za)], (-sx, 0, 0))


whiteboard(-0.3, 1.75, sx=-1)
R.label('AIR TASKING ORDER · STATUS', (X0 + 0.03, 2.5, -0.3), PI / 2, 0.0, h=0.07, st='b')
whiteboard(2.6, 1.95, w=1.8, sx=-1)
R.label('SPINS · ROE UPDATES', (X0 + 0.03, 2.72, 2.6), PI / 2, 0.0, h=0.06, st='b')


def map_board(zc, yc, w=3.2, h=1.8):
    """the theatre map on the right wall: sea, land masses, a grid, kill boxes, the front line, unit markers"""
    x = X1 - 0.03
    R.uvbox(S, 'Wood', x - 0.04, x, yc - h / 2 - 0.05, yc + h / 2 + 0.05, zc - w / 2 - 0.05, zc + w / 2 + 0.05, skip=('px',))
    xf = x - 0.041

    def P(u, v, d=0.0):
        return (xf - d, yc - h / 2 + v * h, zc + w / 2 - u * w)
    quad('MapSea', [P(0, 0), P(1, 0), P(1, 1), P(0, 1)], (-1, 0, 0))
    lands = [
        [(0.0, 0.35), (0.12, 0.42), (0.25, 0.4), (0.38, 0.55), (0.42, 0.75), (0.35, 1.0), (0.0, 1.0)],
        [(0.52, 1.0), (0.55, 0.8), (0.62, 0.62), (0.75, 0.5), (0.88, 0.55), (1.0, 0.5), (1.0, 1.0)],
        [(0.3, 0.0), (0.36, 0.12), (0.5, 0.2), (0.66, 0.18), (0.8, 0.3), (1.0, 0.25), (1.0, 0.0)],
        [(0.46, 0.4), (0.5, 0.47), (0.56, 0.44), (0.55, 0.36), (0.49, 0.35)],
    ]
    for poly in lands:
        S.g('MapLand').face([P(u, v, 0.001) for (u, v) in poly], None, (-1, 0, 0))
    for poly in ([(0.08, 0.7), (0.2, 0.78), (0.25, 0.9), (0.12, 0.92)], [(0.7, 0.68), (0.82, 0.62), (0.9, 0.75), (0.78, 0.82)]):
        S.g('MapHigh').face([P(u, v, 0.002) for (u, v) in poly], None, (-1, 0, 0))
    for i in range(1, 8):
        u = i / 8
        quad('Black', [P(u - 0.0015, 0, 0.003), P(u + 0.0015, 0, 0.003), P(u + 0.0015, 1, 0.003), P(u - 0.0015, 1, 0.003)], (-1, 0, 0))
    for j in range(1, 5):
        v = j / 5
        quad('Black', [P(0, v - 0.0025, 0.003), P(1, v - 0.0025, 0.003), P(1, v + 0.0025, 0.003), P(0, v + 0.0025, 0.003)], (-1, 0, 0))
    for (u0, v0, u1, v1) in ((0.625, 0.6, 0.75, 0.8), (0.75, 0.6, 0.875, 0.8)):
        for (a, b, c, d) in ((u0, v0, u1, v0 + 0.006), (u0, v1 - 0.006, u1, v1), (u0, v0, u0 + 0.004, v1), (u1 - 0.004, v0, u1, v1)):
            quad('FlagRed', [P(a, b, 0.004), P(c, b, 0.004), P(c, d, 0.004), P(a, d, 0.004)], (-1, 0, 0))
    fl = [(0.56, 0.98), (0.6, 0.8), (0.66, 0.66), (0.74, 0.56), (0.86, 0.6), (1.0, 0.56)]
    for a, b in zip(fl, fl[1:]):
        S.beam('FlagRed', P(a[0], a[1], 0.006), P(b[0], b[1], 0.006), 0.01, 0.004, caps=False)
    for (u, v) in [(0.1, 0.55), (0.2, 0.62), (0.3, 0.7), (0.15, 0.8), (0.4, 0.3), (0.6, 0.3)]:
        c = P(u, v)
        R.uvbox(S, 'FlagBlue', c[0] - 0.012, c[0], c[1] - 0.025, c[1] + 0.025, c[2] - 0.035, c[2] + 0.035, skip=('px',))
    for (u, v) in [(0.7, 0.72), (0.8, 0.7), (0.9, 0.78), (0.95, 0.66), (0.66, 0.9)]:
        c = P(u, v)
        S.beam('FlagRed', (c[0] - 0.012, c[1] - 0.03, c[2]), (c[0] - 0.012, c[1] + 0.03, c[2]), 0.045, 0.012)
    for (u, v) in [(0.68, 0.75), (0.82, 0.74), (0.72, 0.64), (0.91, 0.7)]:
        c = P(u, v)
        S.beam('Yellow', c, (c[0] - 0.05, c[1] + 0.02, c[2]), 0.006, caps=False)
        S.sphere('Yellow', (c[0] - 0.05, c[1] + 0.02, c[2]), 0.012, 0.012, 0.012, 6, 3)


map_board(-0.3, 1.8)
R.label('THEATRE AIR PICTURE · KILL BOXES', (X1 - 0.03, 2.82, -0.3), -PI / 2, 0.0, h=0.07, st='b')
# a cork board with the flying schedule and notices, right wall
R.uvbox(S, 'Wood', X1 - 0.04, X1, 1.2, 2.2, 2.4, 3.8, skip=('px',))
quad('Cork', [(X1 - 0.041, 1.24, 2.44), (X1 - 0.041, 1.24, 3.76), (X1 - 0.041, 2.16, 3.76), (X1 - 0.041, 2.16, 2.44)], (-1, 0, 0))
for k in range(7):
    zz, yy = 2.6 + (k % 4) * 0.3, 1.45 + (k // 4) * 0.42 + (k % 2) * 0.05
    quad('Paper', [(X1 - 0.043, yy - 0.14, zz - 0.1), (X1 - 0.043, yy - 0.14, zz + 0.1), (X1 - 0.043, yy + 0.14, zz + 0.1), (X1 - 0.043, yy + 0.14, zz - 0.1)], (-1, 0, 0))
    S.sphere('FlagRed', (X1 - 0.046, yy + 0.12, zz), 0.008, 0.008, 0.008, 4, 2)
R.label('NOTICES · FLYING SCHEDULE', (X1 - 0.03, 2.3, 3.1), -PI / 2, 0.0, h=0.05, st='b')
mark('side walls')

# ═════════════ the battlecab: a platform behind glass at the back centre ═════════════
R.uvbox(S, 'DeckTile', CX0, CX1, 0.6, CY, CZ0, Z1, skip=('bottom', 'top', 'pz'))
quad('Carpet', [(CX0, CY, CZ0), (CX0, CY, Z1), (CX1, CY, Z1), (CX1, CY, CZ0)], (0, 1, 0))
# the knee wall and the glass front, mullions clear of the director's line of sight
R.uvbox(S, 'WallDark', CX0, CX1, 0.6, 1.5, CZ0, CZ0 + 0.12, skip=('bottom',))
R.uvbox(S, 'Metal', CX0, CX1, 1.5, 1.53, CZ0 - 0.01, CZ0 + 0.14, skip=('bottom',))
xs = [-6.0, -4.5, -1.5, 1.5, 4.5, 6.0]
for x in xs:
    R.uvbox(S, 'Bezel', x - 0.035, x + 0.035, 1.53, HC, CZ0 + 0.03, CZ0 + 0.1, skip=('bottom', 'top'))
for a, b in zip(xs, xs[1:]):
    for zz, n in ((CZ0 + 0.06, (0, 0, -1)), (CZ0 + 0.065, (0, 0, 1))):
        quad('Glass', [(a + 0.035, 1.53, zz), (b - 0.035, 1.53, zz), (b - 0.035, HC - 0.05, zz), (a + 0.035, HC - 0.05, zz)], n)
R.uvbox(S, 'Bezel', CX0, CX1, HC - 0.05, HC, CZ0 - 0.01, CZ0 + 0.14, skip=('top',))
# the bulkhead above the glass (to the main ceiling), the side walls, the cab's own ceiling
quad('Wall', [(CX0, HC, CZ0), (CX1, HC, CZ0), (CX1, H, CZ0), (CX0, H, CZ0)], (0, 0, -1))
for sx in (-1, 1):
    x = sx * CX1
    quad('Wall', [(x, 0.6, CZ0), (x, 0.6, Z1), (x, H, Z1), (x, H, CZ0)], (sx, 0, 0))                  # outside
    if sx < 0:
        # the inside face, with the door opening (z 5.9..6.9) cut out
        for (za, zb) in ((CZ0, 5.9), (6.9, Z1)):
            quad('Wall', [(x + 0.12, CY, za), (x + 0.12, CY, zb), (x + 0.12, HC, zb), (x + 0.12, HC, za)], (1, 0, 0))
        quad('Wall', [(x + 0.12, 3.0, 5.9), (x + 0.12, 3.0, 6.9), (x + 0.12, HC, 6.9), (x + 0.12, HC, 5.9)], (1, 0, 0))
    else:
        quad('Wall', [(x - 0.12, CY, CZ0), (x - 0.12, CY, Z1), (x - 0.12, HC, Z1), (x - 0.12, HC, CZ0)], (-1, 0, 0))
    R.uvbox(S, 'WallDark', min(x, x - sx * 0.12), max(x, x - sx * 0.12), 0.6, H, CZ0, CZ0 + 0.12, skip=('pz',))
quad('Ceiling', [(CX0, HC, CZ0), (CX1, HC, CZ0), (CX1, HC, Z1), (CX0, HC, Z1)], (0, -1, 0))
# the door opening in the left wall: jambs, head, a step outside; the glass door slid open along the inside wall
x = CX0
R.uvbox(S, 'Bezel', x, x + 0.12, CY, 3.0, 5.86, 5.9, skip=('top',))
R.uvbox(S, 'Bezel', x, x + 0.12, CY, 3.0, 6.9, 6.94, skip=('top',))
R.uvbox(S, 'Bezel', x, x + 0.12, 2.96, 3.0, 5.86, 6.94, skip=('top',))
R.uvbox(S, 'WallDark', x, x + 0.12, 0.6, CY, 5.9, 6.9, skip=('bottom',))
R.uvbox(S, 'DeckTile', x - 0.34, x, 0.6, 0.75, 5.9, 6.9, skip=('bottom', 'px'))
R.uvbox(S, 'Yellow', x - 0.34, x, 0.75, 0.756, 5.9, 6.9, skip=('bottom', 'px'))
R.uvbox(S, 'Metal', x + 0.12, x + 0.16, 2.97, 3.03, 5.0, 6.94)                     # the slider's track
xd = x + 0.18
R.uvbox(S, 'Metal', xd - 0.012, xd + 0.012, CY + 0.02, 2.95, 5.02, 5.06)
R.uvbox(S, 'Metal', xd - 0.012, xd + 0.012, CY + 0.02, 2.95, 5.88, 5.92)
R.uvbox(S, 'Metal', xd - 0.012, xd + 0.012, 2.89, 2.95, 5.06, 5.88)
R.uvbox(S, 'Metal', xd - 0.012, xd + 0.012, CY + 0.02, CY + 0.1, 5.06, 5.88)
for d, n in ((-0.003, (-1, 0, 0)), (0.003, (1, 0, 0))):
    quad('Glass', [(xd + d, CY + 0.1, 5.06), (xd + d, CY + 0.1, 5.88), (xd + d, 2.89, 5.88), (xd + d, 2.89, 5.06)], n)
R.uvbox(S, 'Chrome', xd + 0.012, xd + 0.03, 1.4, 2.0, 5.8, 5.83)
R.label('BATTLE CAB', (x - 0.005, 3.2, 6.4), -PI / 2, 0.0, h=0.08, st='w')
R.label('DIRECTOR · CFACC STAFF', (x - 0.005, 3.08, 6.4), -PI / 2, 0.0, h=0.04, st='w')

# the director's counter along the glass (counter height, tall chairs: they see over the floor to the wall);
# five positions, the director's in the middle with the live screen
cz, CT = 5.2, 1.0
top = CY + CT
R.uvbox(S, 'Wood', -5.0, 5.0, top - 0.04, top, cz, cz + 0.72)
R.uvbox(S, 'Rubber', -5.0, 5.0, top - 0.045, top + 0.004, cz + 0.72, cz + 0.735, skip=('bottom',))
R.uvbox(S, 'WallDark', -5.0, 5.0, CY, top - 0.04, cz, cz + 0.05, skip=('top', 'bottom'))
R.uvbox(S, 'Metal', -5.0, 5.0, CY + 0.3, CY + 0.33, cz + 0.4, cz + 0.44)            # the foot rail
for x in (-5.0, -3.0, -1.0, 1.0, 3.0, 5.0):
    R.uvbox(S, 'WallDark', x - 0.02, x + 0.02, CY, top - 0.04, cz + 0.05, cz + 0.68, skip=('top', 'bottom', 'nz'))
    R.uvbox(S, 'Metal', x - 0.02, x + 0.02, CY + 0.3, CY + 0.33, cz + 0.05, cz + 0.4, skip=('nz', 'pz'))
for k, xc in enumerate((-4.0, -2.0, 0.0, 2.0, 4.0)):
    if xc == 0.0:
        cab_c = (0.0, top + 0.05 + 0.175 + 0.014, cz + 0.2)
        display('screen_cab', cab_c, 0.0, 0.28, 0.56, 0.35, px=(1024, 640), stand=0.04, sticker='Orange', bright=1.1)
        display(None, (-0.62, top + 0.05 + 0.13 + 0.014, cz + 0.25), 0.32, 0.28, 0.42, 0.26, art=3, stand=0.04, sticker='Red')
        display(None, (0.62, top + 0.05 + 0.13 + 0.014, cz + 0.25), -0.32, 0.28, 0.42, 0.26, art=1, stand=0.04, sticker='Red')
        phone((0.6, top, cz + 0.55), -0.3, red=True)
        phone((-0.85, top, cz + 0.5), 0.3)
        R.label('DIRECTOR', (0.0, top - 0.1, cz - 0.001), PI, 0.0, h=0.035, st='e')
        R.label('DIRECTOR OF COMBAT OPERATIONS', (-0.62, top + 0.002, cz + 0.66), 0.0, PI / 2, h=0.016, st='w')
        mug((0.38, top, cz + 0.45), 'FlagNavy')
        binder((-0.45, top, cz + 0.5), 0.3, 'Red')
    else:
        display(None, (xc - 0.28, top + 0.05 + 0.13 + 0.014, cz + 0.22), 0.1, 0.28, 0.42, 0.26, art=(k * 3) % 8, stand=0.04, sticker='Green')
        display(None, (xc + 0.28, top + 0.05 + 0.13 + 0.014, cz + 0.22), -0.1, 0.28, 0.42, 0.26, art=(k * 5 + 2) % 8, stand=0.04, sticker='Red')
        phone((xc + 0.62, top, cz + 0.5), -0.3, red=(k % 2 == 1))
        papers((xc - 0.55, top, cz + 0.5), 0.2)
        R.label(['CFACC', 'DEPUTY', '', 'SENIOR INTEL', 'LEGAL · POLAD'][k], (xc, top - 0.1, cz - 0.001), PI, 0.0, h=0.03, st='e')
    keyboard((xc, top, cz + 0.55))
    mouse((xc + 0.33, top, cz + 0.57))
    chair((xc, CY, cz + 1.2), 0.0, mat='Leather', tall=True, h=0.76)
# the director: tall chair, eye 1.55 m over the cab floor, the live screen low in view and the wall above it
R.station('stand_director', (0.0, CY + 1.55, cz + 1.08), yaw=0.0, pitch=-0.17, fov=60)
# the back wall: a credenza, a TV, the national colours on stands, a JOC plaque; downlights
R.uvbox(S, 'Wood', -2.5, 2.5, CY, CY + 0.75, Z1 - 0.5, Z1, skip=('bottom', 'pz'))
quad('WallDark', [(-2.45, CY + 0.08, Z1 - 0.501), (2.45, CY + 0.08, Z1 - 0.501), (2.45, CY + 0.7, Z1 - 0.501), (-2.45, CY + 0.7, Z1 - 0.501)], (0, 0, -1))
for x in (-1.25, 1.25):
    quad('Black', [(x - 0.005, CY + 0.08, Z1 - 0.502), (x + 0.005, CY + 0.08, Z1 - 0.502), (x + 0.005, CY + 0.7, Z1 - 0.502), (x - 0.005, CY + 0.7, Z1 - 0.502)], (0, 0, -1))
    R.uvbox(S, 'Brass', x - 0.25, x - 0.15, CY + 0.6, CY + 0.62, Z1 - 0.51, Z1 - 0.5, skip=('pz',))
display(None, (0.0, 2.3, Z1 - 0.05), PI, 0.0, 1.5, 0.85, art=0, stand=None, sticker=None)
papers((-1.6, CY + 0.75, Z1 - 0.28), 0.4, 2)
for sx, kind in ((-1, 'USA'), (1, 'QAT')):
    x = sx * 3.3
    S.cyl('Brass', (x, 0, Z1 - 0.4), 0.17, 0.15, CY, CY + 0.08, 12, cap0=False)
    S.cyl('Wood', (x, 0, Z1 - 0.4), 0.02, 0.02, CY + 0.08, CY + 2.45, 6, cap0=False, cap1=False)
    S.sphere('Brass', (x, CY + 2.5, Z1 - 0.4), 0.05, 0.07, 0.05, 8, 4)
    # the furled colours hanging on the pole: a draped cloth with its canton / band showing at the top
    S.cyl('FlagRed' if kind == 'USA' else 'FlagMaroon', (x + 0.06, 0, Z1 - 0.4), 0.045, 0.075, CY + 1.2, CY + 2.35, 8)
    S.cyl('FlagNavy' if kind == 'USA' else 'FlagWhite', (x + 0.06, 0, Z1 - 0.4), 0.075, 0.08, CY + 2.08, CY + 2.36, 8, cap0=False)
    S.cyl('Brass', (x + 0.06, 0, Z1 - 0.4), 0.05, 0.05, CY + 1.15, CY + 1.2, 8, cap1=False)
for x in (-4.5, -1.5, 1.5, 4.5):
    for z in (5.9, 6.9):
        downlight(x, z, HC)
R.label('JOINT OPERATIONS CENTER', (0.0, 3.25, Z1 - 0.01), PI, 0.0, h=0.12, st='big')
R.label('SECRET // REL TO COALITION', (0.0, 3.05, Z1 - 0.01), PI, 0.0, h=0.05, st='r')
mark('battlecab')

# ═════════════ back left: the exit (double doors, card reader, placards), the extinguisher, the burn bag ═════════════
EX = -8.0
dp = Part('exit_door')
for sx in (-1, 1):
    x0, x1 = (-0.9, -0.005) if sx < 0 else (0.005, 0.9)
    dp.box('WallDark', x0, x1, 0.0, 2.2, 0.0, 0.05, skip=('nz',))
    xm = (x0 + x1) / 2 + sx * 0.12
    dp.box('Glass', xm - 0.08, xm + 0.08, 1.2, 1.9, 0.05, 0.052, skip=('nz',))
    dp.box('Metal', x0 + 0.08, x1 - 0.08, 1.0, 1.06, 0.05, 0.1, skip=('nz',))                   # panic bar
    for xx in (x0 + 0.1, x1 - 0.1):
        dp.box('Metal', xx - 0.02, xx + 0.02, 0.98, 1.08, 0.05, 0.1, skip=('nz',))
    dp.box('Steel', x0 + 0.02, x1 - 0.02, 0.0, 0.3, 0.05, 0.053, skip=('nz',))                  # kick plate
dp.box('Bezel', -1.0, -0.9, 0.0, 2.3, -0.05, 0.06, skip=('nz',))
dp.box('Bezel', 0.9, 1.0, 0.0, 2.3, -0.05, 0.06, skip=('nz',))
dp.box('Bezel', -1.0, 1.0, 2.2, 2.3, -0.05, 0.06, skip=('nz',))
dp.box('Steel', -0.9, -0.3, 2.24, 2.29, 0.06, 0.1)                                              # the closer
R.node('exit_door', dp, (EX, 0.6, Z1 - 0.06), yaw=PI, ctl={'t': 'exit'})
R.label('EXIT', (EX, 0.6 + 2.62, Z1 - 0.07), PI, 0.0, h=0.12, st='r')
R.uvbox(S, 'FlagWhite', EX - 0.3, EX + 0.3, 0.6 + 2.36, 0.6 + 2.56, Z1 - 0.07, Z1, skip=('pz',))
quad('LightRed', [(EX + 0.26, 0.6 + 2.4, Z1 - 0.071), (EX - 0.26, 0.6 + 2.4, Z1 - 0.071), (EX - 0.26, 0.6 + 2.52, Z1 - 0.071), (EX + 0.26, 0.6 + 2.52, Z1 - 0.071)], (0, 0, -1))
R.uvbox(S, 'PlasticDark', EX + 1.15, EX + 1.27, 0.6 + 1.2, 0.6 + 1.42, Z1 - 0.03, Z1, skip=('pz',))          # card reader + keypad
quad('LampRed', [(EX + 1.24, 0.6 + 1.38, Z1 - 0.031), (EX + 1.18, 0.6 + 1.38, Z1 - 0.031), (EX + 1.18, 0.6 + 1.4, Z1 - 0.031), (EX + 1.24, 0.6 + 1.4, Z1 - 0.031)], (0, 0, -1))
for j in range(3):
    for i in range(3):
        xx, yy = EX + 1.17 + i * 0.03, 0.6 + 1.24 + j * 0.035
        quad('Plastic', [(xx + 0.02, yy, Z1 - 0.032), (xx, yy, Z1 - 0.032), (xx, yy + 0.02, Z1 - 0.032), (xx + 0.02, yy + 0.02, Z1 - 0.032)], (0, 0, -1))
R.label('CLASSIFIED AREA', (EX - 1.55, 0.6 + 1.75, Z1 - 0.01), PI, 0.0, h=0.07, st='r')
R.label('NO PERSONAL ELECTRONIC DEVICES', (EX - 1.55, 0.6 + 1.6, Z1 - 0.01), PI, 0.0, h=0.035, st='r')
R.label('AUTHORIZED PERSONNEL ONLY', (EX - 1.55, 0.6 + 1.5, Z1 - 0.01), PI, 0.0, h=0.035, st='w')
R.label('SECRET', (EX + 1.2, 0.6 + 1.65, Z1 - 0.01), PI, 0.0, h=0.05, st='r')
R.label('FPCON BRAVO · INFOCON 3', (EX + 1.2, 0.6 + 1.9, Z1 - 0.01), PI, 0.0, h=0.03, st='y')
xe = X0 + 0.14
S.cyl('Red', (xe, 0, 6.1), 0.085, 0.085, 0.6 + 0.35, 0.6 + 0.9, 10)
S.sphere('Red', (xe, 0.6 + 0.9, 6.1), 0.085, 0.05, 0.085, 10, 3, v0=0.5, v1=1.0)
S.cyl('Black', (xe, 0, 6.1), 0.02, 0.02, 0.6 + 0.94, 0.6 + 1.02, 6, cap0=False)
S.beam('Black', (xe, 0.6 + 1.0, 6.1), (xe + 0.06, 0.6 + 0.6, 6.19), 0.02, caps=False)
R.uvbox(S, 'Steel', X0, X0 + 0.04, 0.6 + 0.8, 0.6 + 0.88, 6.02, 6.18, skip=('nx',))
R.label('FIRE EXTINGUISHER', (X0 + 0.01, 0.6 + 1.3, 6.1), PI / 2, 0.0, h=0.05, st='r')
trash((-9.6, 0.6, 5.4), mat='PlasticDark')
cyl('Plastic', (-9.55, 0.6, 4.8), 0.2, 0.6, 0.6 + 0.7, 12, cap0=False)
for yy in (0.6 + 0.2, 0.6 + 0.45):
    S.cyl('FlagRed', (-9.55, 0, 4.8), 0.202, 0.202, yy, yy + 0.06, 12, cap0=False, cap1=False)
R.label('BURN BAG', (-9.55, 0.6 + 0.58, 4.8 + 0.201), 0.0, 0.0, h=0.04, st='r')
cr = (-9.55, 0.6, 7.05)
cyl('Black', cr, 0.2, 0.6, 0.62, 10, cap0=False)
cyl('Black', cr, 0.02, 0.62, 0.6 + 1.8, 6, cap0=False)
for k in range(4):
    a = 2 * PI * k / 4 + 0.4
    S.beam('Black', (cr[0], 0.6 + 1.7, cr[2]), (cr[0] + math.cos(a) * 0.16, 0.6 + 1.78, cr[2] + math.sin(a) * 0.16), 0.014, caps=False)
for k, a in enumerate((0.4, 2.0)):
    hx, hz = cr[0] + math.cos(a) * 0.14, cr[2] + math.sin(a) * 0.14
    R.obox(S, 'Canvas', R.mat3(-a), (hx, 0.6 + 1.0, hz), -0.2, 0.2, 0.0, 0.72, -0.05, 0.06)
    R.obox(S, 'Canvas', R.mat3(-a), (hx, 0.6 + 1.5, hz), -0.28, 0.28, 0.0, 0.2, -0.04, 0.05)
ca = 2 * PI * 2 / 4 + 0.4
S.sphere('Canvas', (cr[0] + math.cos(ca) * 0.17, 0.6 + 1.76, cr[2] + math.sin(ca) * 0.17), 0.1, 0.06, 0.1, 8, 3, v0=0.5, v1=1.0)
S.beam('Canvas', (cr[0] + math.cos(ca) * 0.17 - 0.02, 0.6 + 1.765, cr[2] + math.sin(ca) * 0.17), (cr[0] + math.cos(ca) * 0.3, 0.6 + 1.755, cr[2] + math.sin(ca) * 0.3), 0.12, 0.01, caps=False)
R.label('COMBAT OPERATIONS DIVISION', (X0 + 0.01, 2.6, 5.9), PI / 2, 0.0, h=0.06, st='w')
R.label('THIS ROOM IS CLEARED FOR CLASSIFIED PROCESSING', (X0 + 0.01, 2.9, 4.6), PI / 2, 0.0, h=0.05, st='r')
mark('exit')

# ═════════════ back right: the coffee bar, printers, a shredder ═════════════
ZC = Z1 - 0.62
R.uvbox(S, 'WallDark', 6.3, 9.9, 0.6, 0.6 + 0.88, ZC, Z1, skip=('bottom', 'pz'))
R.uvbox(S, 'Wood', 6.28, 9.92, 0.6 + 0.88, 0.6 + 0.92, ZC - 0.03, Z1, skip=('pz',))
for x in (6.8, 7.4, 8.0, 8.6, 9.2):
    R.uvbox(S, 'Metal', x - 0.1, x + 0.1, 0.6 + 0.78, 0.6 + 0.8, ZC - 0.006, ZC, skip=('pz',))
    quad('Black', [(x - 0.29, 0.6 + 0.05, ZC - 0.002), (x - 0.285, 0.6 + 0.05, ZC - 0.002), (x - 0.285, 0.6 + 0.86, ZC - 0.002), (x - 0.29, 0.6 + 0.86, ZC - 0.002)], (0, 0, -1))
R.uvbox(S, 'WallDark', 6.5, 9.9, 0.6 + 1.5, 0.6 + 2.1, Z1 - 0.35, Z1, skip=('pz',))                       # wall cabinets
top = 0.6 + 0.92
# a commercial coffee brewer with two carafes, a hot-water urn, cups, a microwave, the condiments
R.uvbox(S, 'Steel', 6.5, 7.1, top, top + 0.6, Z1 - 0.45, Z1 - 0.05, skip=('bottom', 'pz'))
quad('Black', [(6.55, top + 0.42, Z1 - 0.451), (7.05, top + 0.42, Z1 - 0.451), (7.05, top + 0.55, Z1 - 0.451), (6.55, top + 0.55, Z1 - 0.451)], (0, 0, -1))
for x in (6.65, 6.95):
    S.cyl('Glass', (x, 0, Z1 - 0.52), 0.07, 0.08, top + 0.02, top + 0.22, 8, cap0=False)
    S.cyl('Black', (x, 0, Z1 - 0.52), 0.075, 0.075, top + 0.22, top + 0.26, 8, cap0=False)
    S.cyl('Wood', (x, 0, Z1 - 0.52), 0.06, 0.07, top + 0.02, top + 0.1, 8, cap0=False)
    disc('Black', (x, top + 0.001, Z1 - 0.52), 0.09, 8, (0, 1, 0))
S.cyl('Steel', (7.45, 0, Z1 - 0.3), 0.15, 0.15, top, top + 0.5, 12, cap0=False)
S.cyl('Black', (7.45, 0, Z1 - 0.3), 0.16, 0.16, top + 0.5, top + 0.54, 12, cap0=False)
for k in range(6):
    mug((7.75 + (k % 3) * 0.1, top, Z1 - 0.45 + (k // 3) * 0.12), ['FlagWhite', 'FlagNavy', 'FlagRed', 'Black'][k % 4])
R.uvbox(S, 'FlagWhite', 8.3, 8.85, top, top + 0.32, Z1 - 0.45, Z1 - 0.05, skip=('bottom', 'pz'))
quad('Black', [(8.34, top + 0.05, Z1 - 0.451), (8.68, top + 0.05, Z1 - 0.451), (8.68, top + 0.28, Z1 - 0.451), (8.34, top + 0.28, Z1 - 0.451)], (0, 0, -1))
R.uvbox(S, 'Plastic', 9.0, 9.5, top, top + 0.08, Z1 - 0.4, Z1 - 0.1, skip=('bottom',))
for k in range(4):
    S.cyl(['FlagWhite', 'Wood', 'FlagRed', 'FlagYellow'][k], (9.08 + k * 0.11, 0, Z1 - 0.25), 0.04, 0.04, top + 0.08, top + 0.2, 8, cap0=False)
# a fridge at the end, a water cooler
R.uvbox(S, 'FlagWhite', 9.3, 9.95, 0.6, 0.6 + 1.7, Z1 - 0.7, Z1 - 0.05, skip=('bottom', 'pz', 'px'))
R.uvbox(S, 'Metal', 9.33, 9.36, 0.6 + 0.9, 0.6 + 1.5, Z1 - 0.72, Z1 - 0.7, skip=('pz',))
S.cyl('FlagWhite', (9.6, 0, 5.3), 0.17, 0.17, 0.6, 0.6 + 1.0, 10, cap0=False)
S.cyl('Glass', (9.6, 0, 5.3), 0.14, 0.14, 0.6 + 1.0, 0.6 + 1.45, 10, cap0=False)
S.cyl('FlagBlue', (9.6, 0, 5.3), 0.12, 0.12, 0.6 + 1.02, 0.6 + 1.3, 10, cap0=False)
R.label('COFFEE MESS · PAY YOUR DUES', (8.1, 0.6 + 2.2, Z1 - 0.01), PI, 0.0, h=0.05, st='w')
# printers (a big copier and a plotter) against the right wall, a shredder
R.uvbox(S, 'Plastic', X1 - 0.75, X1 - 0.05, 0.6, 0.6 + 1.05, 3.9, 4.65, skip=('bottom', 'px'))
R.uvbox(S, 'PlasticDark', X1 - 0.75, X1 - 0.05, 0.6 + 1.05, 0.6 + 1.1, 3.9, 4.65, skip=('bottom', 'px'))
R.uvbox(S, 'Plastic', X1 - 0.95, X1 - 0.75, 0.6 + 0.85, 0.6 + 0.88, 4.0, 4.5, skip=('px',))
for k in range(3):
    quad('PlasticDark', [(X1 - 0.752, 0.6 + 0.2 + k * 0.2, 4.0), (X1 - 0.752, 0.6 + 0.2 + k * 0.2, 4.55), (X1 - 0.752, 0.6 + 0.22 + k * 0.2, 4.55), (X1 - 0.752, 0.6 + 0.22 + k * 0.2, 4.0)], (-1, 0, 0))
quad('Screen', [(X1 - 0.6, 0.6 + 1.101, 3.95), (X1 - 0.6, 0.6 + 1.101, 4.1), (X1 - 0.4, 0.6 + 1.101, 4.1), (X1 - 0.4, 0.6 + 1.101, 3.95)], (0, 1, 0))
papers((X1 - 0.85, 0.6 + 0.88, 4.25), 0.0, 2)
R.uvbox(S, 'PlasticDark', X1 - 0.6, X1 - 0.05, 0.6, 0.6 + 1.0, 2.6, 3.8, skip=('bottom', 'px'))              # plotter
R.uvbox(S, 'Plastic', X1 - 0.6, X1 - 0.05, 0.6 + 1.0, 0.6 + 1.12, 2.55, 3.85, skip=('px',))
R.uvbox(S, 'Paper', X1 - 0.7, X1 - 0.6, 0.6 + 0.6, 0.6 + 1.02, 2.7, 3.7, skip=('px',))
R.uvbox(S, 'PlasticDark', X1 - 0.5, X1 - 0.05, 0.6, 0.6 + 0.75, 4.9, 5.3, skip=('bottom', 'px'))              # shredder
quad('Black', [(X1 - 0.45, 0.6 + 0.751, 4.95), (X1 - 0.45, 0.6 + 0.751, 5.25), (X1 - 0.1, 0.6 + 0.751, 5.25), (X1 - 0.1, 0.6 + 0.751, 4.95)], (0, 1, 0))
R.label('SHRED ALL CLASSIFIED WASTE', (X1 - 0.51, 0.6 + 0.6, 5.1), -PI / 2, 0.0, h=0.03, st='r')
R.label('PRINTER · SIPR', (X1 - 0.01, 0.6 + 1.5, 4.27), -PI / 2, 0.0, h=0.05, st='r')
R.label('PLOTTER · MAPS', (X1 - 0.01, 0.6 + 1.5, 3.2), -PI / 2, 0.0, h=0.05, st='w')
R.label('TOP SECRET // CLASSIFIED', (X1 - 0.01, 3.5, -5.5), -PI / 2, 0.0, h=0.07, st='r')
R.label('CLASSIFIED', (X0 + 0.01, 3.5, -5.5), PI / 2, 0.0, h=0.07, st='r')
for (z, y) in ((-2.0, 0.3), (1.5, 0.6)):
    for sx in (-1, 1):
        R.label('WATCH YOUR STEP', (sx * 8.8, y - 0.075, z - 0.006), PI, 0.0, h=0.04, st='y')
mark('coffee + printers')

R.spawn((EX, 0.6, 6.7), yaw=0.0)
look('stand_wall', (0.0, 0.6 + 1.66, 4.55), (0.0, 2.4, Z0), fov=42)

R.finish(OUT, {
    'walk': [
        [-9.6, 9.6, -7.0, -4.55, 0.0], [-9.6, -7.62, -4.55, -3.6, 0.0], [7.62, 9.6, -4.55, -3.6, 0.0], [-9.6, 9.6, -3.62, -2.0, 0.0],
        [-9.6, -7.62, -2.0, -1.02, 0.3], [7.62, 9.6, -2.0, -1.02, 0.3], [-9.6, 9.6, -1.04, 1.5, 0.3],
        [-9.6, -7.62, 1.5, 2.48, 0.6], [7.62, 9.6, 1.5, 2.48, 0.6], [-9.6, 9.6, 2.46, 4.88, 0.6],
        [-9.6, -6.2, 4.86, 7.2, 0.6], [6.2, 9.6, 4.86, 6.8, 0.6],
        [-6.3, -5.7, 5.95, 6.85, 0.9], [-5.8, 5.8, 6.05, 6.95, 0.9], [-5.8, -5.1, 5.18, 6.05, 0.9], [5.1, 5.8, 5.18, 6.05, 0.9],
        [-5.8, -2.6, 6.9, 7.2, 0.9], [2.6, 5.8, 6.9, 7.2, 0.9],
    ],
    'eye': 1.64, 'bg': '#020304',
    'lights': [
        {'t': 'hemi', 'sky': '#7d8a9c', 'ground': '#1c1f24', 'i': 0.26, 'name': 'amb'},
        {'t': 'point', 'p': [0.0, 2.6, -5.8], 'c': '#7fa6e0', 'i': 9, 'd': 11, 'name': 'wallglow'},
        {'t': 'spot', 'p': [-3.8, 4.1, -4.0], 'to': [-3.8, 0.7, -4.0], 'c': '#fff1dc', 'i': 16, 'd': 7, 'a': 0.95, 'pen': 0.7, 'name': 'row1l'},
        {'t': 'spot', 'p': [3.8, 4.1, -4.0], 'to': [3.8, 0.7, -4.0], 'c': '#fff1dc', 'i': 16, 'd': 7, 'a': 0.95, 'pen': 0.7, 'name': 'row1r'},
        {'t': 'spot', 'p': [-3.8, 4.1, -1.4], 'to': [-3.8, 1.0, -1.4], 'c': '#fff1dc', 'i': 15, 'd': 7, 'a': 0.95, 'pen': 0.7, 'name': 'row2l'},
        {'t': 'spot', 'p': [3.8, 4.1, -1.4], 'to': [3.8, 1.0, -1.4], 'c': '#fff1dc', 'i': 15, 'd': 7, 'a': 0.95, 'pen': 0.7, 'name': 'row2r'},
        {'t': 'spot', 'p': [0.0, 4.1, 2.1], 'to': [0.0, 1.3, 2.1], 'c': '#fff1dc', 'i': 19, 'd': 9, 'a': 1.2, 'pen': 0.7, 'name': 'row3'},
        {'t': 'point', 'p': [0.0, 3.2, 6.3], 'c': '#ffe6c4', 'i': 6, 'd': 8, 'name': 'cab'},
    ],
})
