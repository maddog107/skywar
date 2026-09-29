# ═══════════════════════════════════════════════════════════════
# The Joint Operations Center building at the home airbase — its exterior, static world geometry (seen from the
# ground and from the air). Blender, headless:
#   blender -b -P tools/interiors/joc_ext.py -- models/interiors/joc_ext.glb
# Frame: the origin is the building's ground-floor centre at ground level (y 0 = the ground), x right, y up; the
# entrance is on the −z face (at x = +8). No screens or controls: an empty 'entry' (ctl {t: 'point'}) marks where
# you stand to go in, the door is a plain mesh. The root's extras 'room' carry {footprint: [x0, x1, z0, z1] of the
# building's walls, height} (the game makes those walls solid) and, as a hint, 'solids': [[x0, x1, z0, z1, h], …]
# for the T-wall runs, HESCO rows, generators and the fuel tank.
# What it is (a hardened single-storey operations building behind blast walls, as at forward air bases):
#   • 26 × 18 m, 5.0 m to the roof slab, a 0.5 m parapet: cast concrete with pilasters and a plinth, a recessed
#     steel entrance door under a concrete hood at the front right (it opens into the JOC floor's back left: the
#     room, joc.glb, sits turned 180° with its origin at (0, −0.45, 0)), an emergency exit at the back, louvred
#     air intakes, downspouts, a caged ladder to the roof
#   • on the roof: four packaged AC units on curbs, a triangular lattice antenna mast with its antennas and an
#     obstruction light, whip antennas, two satellite dishes on ballasted frames, a roof hatch
#   • beside it: the generator farm — two sound-attenuated generator sets on skids with exhaust stacks, a
#     horizontal fuel tank in a containment bund behind a HESCO revetment, cables to the building's service entrance
#   • a ring of 3.66 m concrete T-walls ("Bremer walls", https://en.wikipedia.org/wiki/Bremer_wall) around it all,
#     with an entry chicane in front of the door; a row of HESCO bastions (tan wire-mesh cages of earth,
#     https://en.wikipedia.org/wiki/Hesco_bastion) along the west side; sandbag walls and a sandbagged guard post at
#     the entrance, camouflage netting over it, floodlights, and "JOINT OPERATIONS CENTER" painted on the chicane.
# ═══════════════════════════════════════════════════════════════
import sys, os, math
sys.dont_write_bytecode = True
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import bpy
import roomkit as R
from roomkit import PI
from shipkit import Part, material, srgb, MATS
from mathutils import Vector

args = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
OUT = args[0] if args else 'models/interiors/joc_ext.glb'

R.begin()
S = R.static()
for name, col, metal, rough in [
    ('Roof', 0x5c5e5b, 0.0, 0.95), ('HescoTan', 0xb49c72, 0.0, 0.95), ('Earth', 0x7a6446, 0.0, 1.0),
    ('Sandbag', 0xa48f66, 0.0, 0.95), ('CamoNet', 0x4b5234, 0.0, 0.95), ('CamoNet2', 0x6d6a44, 0.0, 0.95),
    ('GenGreen', 0x56603f, 0.2, 0.7), ('TankWhite', 0xd6d4ca, 0.2, 0.6), ('HVACGrey', 0xb8bab5, 0.4, 0.5),
    ('Gravel', 0x8a857a, 0.0, 1.0), ('Paint', 0xe8e6de, 0.0, 0.8), ('SignRed', 0xb3261e, 0.0, 0.7),
    ('PlasticDark', 0x2c2e30, 0.0, 0.5),
]:
    material(name, srgb(col), metal, rough)

BX, BZ, BH, PH = 13.0, 9.0, 5.0, 5.5          # half extents, roof slab top, parapet top
DOOR_X = 8.0
_last = [0]


def mark(what):
    n = S.tris()
    print('  [ext] %-22s %6d tris (total %d)' % (what, n - _last[0], n))
    _last[0] = n


def quad(mat, pts, n, uvs=None):
    if uvs is None:
        ax = max(range(3), key=lambda i: abs(n[i]))
        uvs = [(p[0], p[2]) if ax == 1 else (p[2], p[1]) if ax == 0 else (p[0], p[1]) for p in pts]
    S.g(mat).face([tuple(p) for p in pts], uvs, n)


def box(mat, x0, x1, y0, y1, z0, z1, skip=('bottom',)):
    R.uvbox(S, mat, x0, x1, y0, y1, z0, z1, skip=skip)


def disc(mat, c, r, n, normal):
    if abs(normal[1]) > 0.5:
        pts = [(c[0] + r * math.cos(2 * PI * k / n), c[1], c[2] + r * math.sin(2 * PI * k / n)) for k in range(n)]
    elif abs(normal[0]) > 0.5:
        pts = [(c[0], c[1] + r * math.cos(2 * PI * k / n), c[2] + r * math.sin(2 * PI * k / n)) for k in range(n)]
    else:
        pts = [(c[0] + r * math.cos(2 * PI * k / n), c[1] + r * math.sin(2 * PI * k / n), c[2]) for k in range(n)]
    S.g(mat).face(pts, None, normal)


def text(mat, txt, size, origin, ex, ey, res=2):
    """flat lettering (Blender's built-in font, few curve segments) laid on a face: ex reading direction, ey up"""
    cu = bpy.data.curves.new('txt', type='FONT')
    cu.body = txt
    cu.size = size
    cu.align_x = 'CENTER'
    cu.align_y = 'CENTER'
    cu.resolution_u = res
    ob = bpy.data.objects.new('txt', cu)
    bpy.context.collection.objects.link(ob)
    dg = bpy.context.evaluated_depsgraph_get()
    me = bpy.data.meshes.new_from_object(ob.evaluated_get(dg))
    ex, ey = Vector(ex), Vector(ey)
    n = ex.cross(ey)
    o = Vector(origin)
    for p in me.polygons:
        pts = [tuple(o + ex * me.vertices[i].co.x + ey * me.vertices[i].co.y) for i in p.vertices]
        S.g(mat).face(pts, None, tuple(n))
    bpy.data.objects.remove(ob)
    bpy.data.meshes.remove(me)
    bpy.data.curves.remove(cu)


# ═════════════ the building: plinth, walls with pilasters, parapet and coping, the roof ═════════════
# outer walls (faces out), a slightly proud plinth band, the parapet's inner faces and the coping on top
for (p0, p1, n) in (((-BX, -BZ), (BX, -BZ), (0, 0, -1)), ((BX, -BZ), (BX, BZ), (1, 0, 0)), ((BX, BZ), (-BX, BZ), (0, 0, 1)), ((-BX, BZ), (-BX, -BZ), (-1, 0, 0))):
    (xa, za), (xb, zb) = p0, p1
    quad('Concrete', [(xa, 0.45, za), (xb, 0.45, zb), (xb, PH, zb), (xa, PH, za)], n)
    ox, oz = n[0] * 0.06, n[2] * 0.06
    quad('Concrete', [(xa + ox, 0.0, za + oz), (xb + ox, 0.0, zb + oz), (xb + ox, 0.45, zb + oz), (xa + ox, 0.45, za + oz)], n)
    quad('Concrete', [(xa + ox, 0.45, za + oz), (xb + ox, 0.45, zb + oz), (xb, 0.45, zb), (xa, 0.45, za)], (0, 1, 0))
    # the parapet's inner face (0.3 m thick parapet)
    ix, iz = -n[0] * 0.3, -n[2] * 0.3
    quad('Concrete', [(xb + ix, BH, zb + iz), (xa + ix, BH, za + iz), (xa + ix, PH, za + iz), (xb + ix, PH, zb + iz)], (-n[0], 0, -n[2]))
# the coping (steel cap on the parapet), the roof slab surface
for (x0, x1, z0, z1) in ((-BX - 0.03, BX + 0.03, -BZ - 0.03, -BZ + 0.33), (-BX - 0.03, BX + 0.03, BZ - 0.33, BZ + 0.03),
                         (-BX - 0.03, -BX + 0.33, -BZ + 0.33, BZ - 0.33), (BX - 0.33, BX + 0.03, -BZ + 0.33, BZ - 0.33)):
    box('Steel', x0, x1, PH, PH + 0.04, z0, z1, skip=())
quad('Roof', [(-BX + 0.3, BH, -BZ + 0.3), (-BX + 0.3, BH, BZ - 0.3), (BX - 0.3, BH, BZ - 0.3), (BX - 0.3, BH, -BZ + 0.3)], (0, 1, 0))
# pilasters: every 3.25 m along the long walls, 4.5 m along the ends
for sz in (-1, 1):
    for k in range(9):
        x = -BX + k * 3.25
        if abs(x - DOOR_X) < 1.4 and sz < 0:
            continue
        z = sz * BZ
        box('Concrete', x - 0.3, x + 0.3, 0.45, PH - 0.3, min(z, z + sz * 0.22), max(z, z + sz * 0.22), skip=('bottom', 'pz' if sz < 0 else 'nz'))
        quad('Concrete', [(x - 0.3, PH - 0.3, z + sz * 0.22), (x + 0.3, PH - 0.3, z + sz * 0.22), (x + 0.3, PH, z), (x - 0.3, PH, z)], (0, 0.6, sz * 0.8))
for sx in (-1, 1):
    for k in range(5):
        z = -BZ + k * 4.5
        x = sx * BX
        box('Concrete', min(x, x + sx * 0.22), max(x, x + sx * 0.22), 0.45, PH - 0.3, z - 0.3, z + 0.3, skip=('bottom', 'nx' if sx > 0 else 'px'))
        quad('Concrete', [(x + sx * 0.22, PH - 0.3, z - 0.3), (x + sx * 0.22, PH - 0.3, z + 0.3), (x, PH, z + 0.3), (x, PH, z - 0.3)], (sx * 0.8, 0.6, 0))
# pour lines (a slightly darker band where the lifts met) around the building
for y in (1.9, 3.5):
    for (p0, p1, n) in (((-BX, -BZ), (BX, -BZ), (0, 0, -1)), ((BX, -BZ), (BX, BZ), (1, 0, 0)), ((BX, BZ), (-BX, BZ), (0, 0, 1)), ((-BX, BZ), (-BX, -BZ), (-1, 0, 0))):
        (xa, za), (xb, zb) = p0, p1
        ox, oz = n[0] * 0.004, n[2] * 0.004
        quad('WallDark', [(xa + ox, y, za + oz), (xb + ox, y, zb + oz), (xb + ox, y + 0.025, zb + oz), (xa + ox, y + 0.025, za + oz)], n)
mark('building shell')

# ═════════════ the entrance (front right): a recessed steel door under a concrete hood, landing, lights, signs ═════════════
dz = -BZ
# the recess (0.35 m deep) cut into the wall face: its reveals and back, the door in it
box('Concrete', DOOR_X - 1.1, DOOR_X - 0.8, 0.0, 2.75, dz - 0.35, dz, skip=('bottom', 'pz'))
box('Concrete', DOOR_X + 0.8, DOOR_X + 1.1, 0.0, 2.75, dz - 0.35, dz, skip=('bottom', 'pz'))
box('Concrete', DOOR_X - 1.1, DOOR_X + 1.1, 2.55, 2.75, dz - 0.35, dz, skip=('pz',))
door = Part('entrance_door')
door.box('WallDark', -0.62, 0.62, 0.0, 2.35, -0.05, 0.0)
door.box('Steel', -0.7, -0.62, 0.0, 2.43, -0.07, 0.0)
door.box('Steel', 0.62, 0.7, 0.0, 2.43, -0.07, 0.0)
door.box('Steel', -0.62, 0.62, 2.35, 2.43, -0.07, 0.0)
door.box('Glass', -0.12, 0.12, 1.45, 1.85, -0.052, -0.05)
door.box('Steel', -0.5, 0.5, 0.05, 0.35, -0.053, -0.05)
for y in (0.35, 1.2, 2.05):
    door.box('Black', 0.6, 0.66, y, y + 0.16, -0.09, -0.05)
door.box('Metal', -0.55, -0.4, 1.02, 1.06, -0.12, -0.05)
door.box('Metal', -0.55, -0.51, 0.98, 1.1, -0.12, -0.05)
R.node('entrance_door', door, (DOOR_X, 0.15, dz - 0.3), yaw=0.0)
# the hood over the door, the landing and its step, a card reader, a light, the stencil above
box('Concrete', DOOR_X - 1.6, DOOR_X + 1.6, 2.85, 3.15, dz - 1.5, dz, skip=('pz',))
box('Concrete', DOOR_X - 1.4, DOOR_X + 1.4, 0.0, 0.15, dz - 1.3, dz - 0.3, skip=('bottom', 'pz'))
box('Yellow', DOOR_X - 1.4, DOOR_X + 1.4, 0.15, 0.153, dz - 1.3, dz - 1.24, skip=('bottom',))
box('PlasticDark', DOOR_X + 1.15, DOOR_X + 1.27, 1.2, 1.42, dz - 0.03, dz, skip=('pz',))
box('Steel', DOOR_X - 0.25, DOOR_X + 0.25, 2.62, 2.72, dz - 0.62, dz - 0.35, skip=('pz',))
quad('LampWhite', [(DOOR_X - 0.2, 2.619, dz - 0.6), (DOOR_X + 0.2, 2.619, dz - 0.6), (DOOR_X + 0.2, 2.619, dz - 0.37), (DOOR_X - 0.2, 2.619, dz - 0.37)], (0, -1, 0))
text('Paint', 'JOC', 0.5, (DOOR_X, 3.6, dz - 0.004), (-1, 0, 0), (0, 1, 0))
text('SignRed', 'AUTHORIZED PERSONNEL ONLY', 0.09, (DOOR_X - 1.75, 1.7, dz - 0.004), (-1, 0, 0), (0, 1, 0))
R.node('entry', None, (DOOR_X, 0.0, dz - 1.6), ctl={'t': 'point'})
# the emergency exit at the back: a steel door, a small hood
box('WallDark', -4.6, -3.4, 0.0, 2.3, BZ, BZ + 0.05, skip=('bottom', 'nz'))
box('Steel', -4.7, -3.3, 2.3, 2.4, BZ, BZ + 0.08, skip=('nz',))
box('Metal', -4.5, -3.5, 1.0, 1.05, BZ + 0.05, BZ + 0.1, skip=('nz',))
box('Concrete', -5.0, -3.0, 2.6, 2.8, BZ, BZ + 0.9, skip=('nz',))
box('Concrete', -4.8, -3.2, 0.0, 0.15, BZ, BZ + 0.9, skip=('bottom', 'nz'))
text('SignRed', 'EMERGENCY EXIT', 0.12, (-4.0, 2.5, BZ + 0.004), (1, 0, 0), (0, 1, 0))
mark('entrance + exit')

# ═════════════ walls: louvred intakes, the service entrance, downspouts, the caged ladder ═════════════
def louvre(c, w, h, n):
    """a louvred intake on a wall face with normal n (±x or ±z)"""
    x, y, z = c
    nx, nz = n[0], n[2]
    if abs(nz) > 0.5:
        box('Steel', x - w / 2, x + w / 2, y - h / 2, y + h / 2, min(z, z + nz * 0.08), max(z, z + nz * 0.08), skip=('pz' if nz < 0 else 'nz',))
        for k in range(int(h / 0.1)):
            yy = y - h / 2 + 0.05 + k * 0.1
            quad('Black', [(x - w / 2 + 0.04, yy, z + nz * 0.081), (x + w / 2 - 0.04, yy, z + nz * 0.081), (x + w / 2 - 0.04, yy + 0.035, z + nz * 0.081), (x - w / 2 + 0.04, yy + 0.035, z + nz * 0.081)], n)
    else:
        box('Steel', min(x, x + nx * 0.08), max(x, x + nx * 0.08), y - h / 2, y + h / 2, z - w / 2, z + w / 2, skip=('nx' if nx > 0 else 'px',))
        for k in range(int(h / 0.1)):
            yy = y - h / 2 + 0.05 + k * 0.1
            quad('Black', [(x + nx * 0.081, yy, z - w / 2 + 0.04), (x + nx * 0.081, yy, z + w / 2 - 0.04), (x + nx * 0.081, yy + 0.035, z + w / 2 - 0.04), (x + nx * 0.081, yy + 0.035, z - w / 2 + 0.04)], n)


for x in (-9.75, -3.25, 3.25):
    louvre((x + 1.6, 3.9, -BZ), 1.6, 0.9, (0, 0, -1))
for x in (-6.5, 0.0, 6.5):
    louvre((x + 1.6, 3.9, BZ), 1.6, 0.9, (0, 0, 1))
for z in (-2.25, 2.25):
    louvre((-BX, 3.9, z), 1.6, 0.9, (-1, 0, 0))
# the service entrance on the east wall: a transfer switch cabinet, a meter box, conduits into the ground
box('HVACGrey', BX, BX + 0.45, 0.3, 2.2, -3.2, -1.8, skip=('bottom', 'nx'))
box('HVACGrey', BX, BX + 0.25, 1.2, 2.0, -1.4, -0.8, skip=('bottom', 'nx'))
quad('Black', [(BX + 0.451, 1.9, -3.1), (BX + 0.451, 1.9, -1.9), (BX + 0.451, 2.1, -1.9), (BX + 0.451, 2.1, -3.1)], (1, 0, 0))
text('SignRed', 'DANGER HIGH VOLTAGE', 0.08, (BX + 0.453, 1.6, -2.5), (0, 0, -1), (0, 1, 0))
for k in range(4):
    z = -3.05 + k * 0.4
    S.cyl('Steel', (BX + 0.3, 0, z), 0.05, 0.05, 0.0, 0.3, 6, cap0=False, cap1=False)
# downspouts at the corners
for sx in (-1, 1):
    for sz in (-1, 1):
        x, z = sx * (BX + 0.12), sz * (BZ + 0.12)
        S.cyl('Steel', (x, 0, z), 0.06, 0.06, 0.15, PH - 0.15, 6, cap0=False, cap1=False)
        S.beam('Steel', (x, PH - 0.15, z), (x - sx * 0.35, PH - 0.15, z - sz * 0.35), 0.1, caps=False)
        box('Concrete', x - 0.25, x + 0.25, 0.0, 0.06, z - 0.25, z + 0.25)
# the caged ladder to the roof on the west wall
lx, lz = -BX - 0.2, 5.5
for sz in (-0.25, 0.25):
    S.beam('Steel', (lx, 0.3, lz + sz), (lx, PH + 1.0, lz + sz), 0.05, caps=False)
y = 0.5
while y < PH + 0.9:
    S.beam('Steel', (lx, y, lz - 0.25), (lx, y, lz + 0.25), 0.025, caps=False)
    y += 0.3
for y in (2.4, 3.4, 4.4, 5.4):
    ring = [(lx - 0.35 - 0.35 * math.sin(PI * k / 6), y, lz + 0.35 * math.cos(PI * k / 6)) for k in range(7)]
    for a, b in zip(ring, ring[1:]):
        S.beam('Steel', a, b, 0.03, caps=False)
for k in range(5):
    a = PI * k / 4
    p = (lx - 0.35 - 0.35 * math.sin(a), 0, lz + 0.35 * math.cos(a))
    S.beam('Steel', (p[0], 2.4, p[2]), (p[0], 5.4, p[2]), 0.02, caps=False)
mark('walls')

# ═════════════ the roof: AC units, the lattice mast, whips, satellite dishes, the hatch ═════════════
def ac_unit(x, z, w=3.0, d=1.4, h=1.15):
    y0 = BH
    box('Steel', x - w / 2 - 0.1, x + w / 2 + 0.1, y0, y0 + 0.25, z - d / 2 - 0.1, z + d / 2 + 0.1)
    box('HVACGrey', x - w / 2, x + w / 2, y0 + 0.25, y0 + 0.25 + h, z - d / 2, z + d / 2)
    top = y0 + 0.25 + h
    for fx in (-w / 4, w / 4):
        S.cyl('Black', (x + fx, 0, z), 0.5, 0.5, top, top + 0.12, 12, cap0=False, cap1=False)
        disc('PlasticDark', (x + fx, top + 0.05, z), 0.48, 12, (0, 1, 0))
        for k in range(3):
            a = 2 * PI * k / 3
            S.beam('Steel', (x + fx, top + 0.121, z), (x + fx + math.cos(a) * 0.48, top + 0.121, z + math.sin(a) * 0.48), 0.03, 0.01, caps=False)
    for sz in (-1, 1):
        for k in range(8):
            xx = x - w / 2 + 0.25 + k * (w - 0.5) / 7
            quad('Black', [(xx - 0.12, y0 + 0.45, z + sz * (d / 2 + 0.002)), (xx + 0.12, y0 + 0.45, z + sz * (d / 2 + 0.002)), (xx + 0.12, top - 0.2, z + sz * (d / 2 + 0.002)), (xx - 0.12, top - 0.2, z + sz * (d / 2 + 0.002))], (0, 0, sz))
    box('HVACGrey', x - w / 2 - 0.6, x - w / 2, y0, y0 + 0.9, z - 0.4, z + 0.4)          # the duct down into the roof


for (x, z) in ((-7.5, -4.0), (-2.5, -4.0), (2.5, -4.0), (-5.0, 3.5)):
    ac_unit(x, z)
# the lattice antenna mast (triangular, 10 m over the roof) at the back left, with its antennas
mx, mz, mh = -10.0, 6.0, 10.0
legs = [(mx + 0.45 * math.cos(a), mz + 0.45 * math.sin(a)) for a in (PI / 2, PI / 2 + 2 * PI / 3, PI / 2 + 4 * PI / 3)]
box('Concrete', mx - 0.8, mx + 0.8, BH, BH + 0.25, mz - 0.8, mz + 0.8)
for (lx_, lz_) in legs:
    S.beam('Steel', (lx_, BH + 0.25, lz_), (lx_ * 0.7 + mx * 0.3, BH + mh, lz_ * 0.7 + mz * 0.3), 0.045, caps=False)
for k in range(10):
    t0, t1 = k / 10, (k + 1) / 10
    y0, y1 = BH + 0.25 + t0 * (mh - 0.25), BH + 0.25 + t1 * (mh - 0.25)
    P = lambda i, t: (legs[i][0] + (mx - legs[i][0]) * 0.3 * t, legs[i][1] + (mz - legs[i][1]) * 0.3 * t)
    for i in range(3):
        j = (i + 1) % 3
        a0, b0, b1 = P(i, t0), P(j, t0), P(j, t1)
        S.beam('Steel', (a0[0], y0, a0[1]), (b0[0], y0, b0[1]), 0.022, caps=False)
        S.beam('Steel', (a0[0], y0, a0[1]), (b1[0], y1, b1[1]), 0.016, caps=False)
top = BH + mh
S.cyl('Steel', (mx, 0, mz), 0.03, 0.02, top, top + 3.0, 6, cap0=False)
for (dx, dz_, L) in ((0.4, 0.0, 2.2), (-0.3, 0.3, 1.8), (-0.2, -0.35, 1.6)):
    S.beam('Steel', (mx, top - 0.3, mz), (mx + dx, top - 0.3, mz + dz_), 0.03, caps=False)
    S.cyl('Black', (mx + dx, 0, mz + dz_), 0.02, 0.012, top - 0.6, top - 0.6 + L, 6, cap0=False)
for yy in (top - 2.0, top - 4.0):
    for a in (0.3, 2.4, 4.5):
        S.beam('Steel', (mx, yy, mz), (mx + math.cos(a) * 0.9, yy, mz + math.sin(a) * 0.9), 0.03, caps=False)
        S.cyl('PlasticDark', (mx + math.cos(a) * 0.9, 0, mz + math.sin(a) * 0.9), 0.04, 0.04, yy - 0.7, yy + 0.7, 6)
S.sphere('LampRed', (mx, top + 3.05, mz), 0.08, 0.08, 0.08, 8, 4)
S.sphere('LampRed', (mx, BH + 0.25 + (mh - 0.25) * 0.5, mz), 0.07, 0.07, 0.07, 6, 3)
for (lx_, lz_) in legs:
    S.beam('Cable', (lx_, BH + 0.26, lz_), (lx_ + 0.5, BH, lz_ + 0.6), 0.02, caps=False)
# whip antennas along the back parapet, on base mounts
for k, x in enumerate((-6.0, -2.0, 2.0, 5.5, 9.0)):
    z = BZ - 0.55
    box('Steel', x - 0.12, x + 0.12, BH, BH + 0.12, z - 0.12, z + 0.12)
    S.cyl('Black', (x, 0, z), 0.03, 0.03, BH + 0.12, BH + 0.5, 6, cap0=False)
    S.cyl('Black', (x, 0, z), 0.012, 0.006, BH + 0.5, BH + 3.0 + (k % 3) * 0.8, 4, cap0=False)


def dish(c, r, az, el):
    """a satellite dish on a ballasted non-penetrating roof frame; az = the heading its axis points to (from −z,
    positive toward +x), el = elevation"""
    x, y, z = c
    d = Vector((math.sin(az) * math.cos(el), math.sin(el), -math.cos(az) * math.cos(el)))
    u = Vector((0, 1, 0)) - d * d.y
    u.normalize()
    s = d.cross(u)
    hub = Vector((x, y + r + 0.4, z))
    depth = r * 0.28
    rings = [(0.0, 0.0), (0.35, 0.035), (0.7, 0.14), (1.0, 0.28)]
    pts = []
    for (f, dd) in rings:
        pts.append([hub + d * (dd * r - depth) + (u * math.cos(2 * PI * k / 16) + s * math.sin(2 * PI * k / 16)) * (f * r) for k in range(16)])
    for j in range(len(rings) - 1):
        for k in range(16):
            k1 = (k + 1) % 16
            q = [pts[j][k], pts[j][k1], pts[j + 1][k1], pts[j + 1][k]]
            S.g('Paint').face([tuple(v) for v in q], None, tuple(d))
            S.g('HVACGrey').face([tuple(v - d * 0.01) for v in reversed(q)], None, tuple(-d))
    feed = hub + d * (r * 0.75)
    for k in range(3):
        a = 2 * PI * k / 3
        rim = hub + d * (0.28 * r - depth) + (u * math.cos(a) + s * math.sin(a)) * r
        S.beam('Steel', tuple(rim), tuple(feed), 0.03, caps=False)
    S.beam('PlasticDark', tuple(feed - d * 0.05), tuple(feed + d * 0.12), 0.12, caps=True)
    # the mount: a king post and a base frame with ballast blocks
    S.beam('Steel', (x, BH + 0.2, z), tuple(hub - d * depth), 0.12, caps=False)
    for (ax, az_) in ((-1, -1), (1, -1), (1, 1), (-1, 1)):
        S.beam('Steel', (x, BH + 0.2, z), (x + ax * r * 0.7, BH + 0.1, z + az_ * r * 0.7), 0.06, caps=False)
        box('Concrete', x + ax * r * 0.7 - 0.25, x + ax * r * 0.7 + 0.25, BH, BH + 0.2, z + az_ * r * 0.7 - 0.25, z + az_ * r * 0.7 + 0.25)


dish((7.0, BH, 3.0), 1.2, 0.4, 0.75)
dish((10.2, BH, 5.8), 0.9, -0.3, 0.6)
# the roof hatch with its guard rail, vent pipes, roof drains
box('Steel', 3.0, 3.9, BH, BH + 0.35, 5.5, 6.4)
box('HVACGrey', 2.98, 3.92, BH + 0.35, BH + 0.4, 5.48, 6.42)
for (x0, z0, x1, z1) in ((2.7, 5.2, 4.2, 5.2), (4.2, 5.2, 4.2, 6.7), (2.7, 5.2, 2.7, 6.7)):
    S.beam('Yellow', (x0, BH + 1.05, z0), (x1, BH + 1.05, z1), 0.04, caps=False)
    S.beam('Yellow', (x0, BH, z0), (x0, BH + 1.05, z0), 0.04, caps=False)
    S.beam('Yellow', (x1, BH, z1), (x1, BH + 1.05, z1), 0.04, caps=False)
for (x, z) in ((0.5, 1.0), (-9.0, -1.0), (9.5, -6.5), (-0.5, 6.5)):
    S.cyl('Black', (x, 0, z), 0.07, 0.07, BH, BH + 0.6, 6, cap0=False)
    S.cyl('Steel', (x, 0, z), 0.1, 0.1, BH + 0.6, BH + 0.68, 6, cap0=False)
for (x, z) in ((-12.4, -8.4), (12.4, -8.4), (-12.4, 8.4), (12.4, 8.4)):
    disc('Black', (x, BH + 0.005, z), 0.15, 6, (0, 1, 0))
# floodlights on the front parapet over the entrance and on the corners
def floodlight(c, yaw, tilt=0.5):
    M = R.mat3(yaw, -tilt)
    R.obox(S, 'Black', M, c, -0.22, 0.22, -0.16, 0.16, -0.14, 0.0)
    R.oquad(S, 'LampWhite', M, c, -0.19, 0.19, -0.13, 0.13, 0.002)


for x in (DOOR_X - 2.5, DOOR_X + 2.5, -BX + 0.6, BX - 0.6):
    box('Steel', x - 0.04, x + 0.04, PH, PH + 0.5, -BZ + 0.05, -BZ + 0.15)
    floodlight((x, PH + 0.5, -BZ - 0.02), PI, 0.55)
mark('roof')

# ═════════════ the generator farm (east): two gensets on skids, the fuel tank in its bund, cables ═════════════
GX = 19.0
box('Gravel', 15.2, 25.8, 0.0, 0.03, -8.0, 7.0)


def genset(x, z, L=4.6, W=1.7, Hh=2.1):
    box('Steel', x - W / 2 - 0.1, x + W / 2 + 0.1, 0.03, 0.25, z - L / 2 - 0.2, z + L / 2 + 0.2)          # the skid
    for sx in (-1, 1):
        box('Black', x + sx * (W / 2 + 0.1) - 0.02, x + sx * (W / 2 + 0.1) + 0.02, 0.1, 0.18, z - L / 2 - 0.3, z + L / 2 + 0.3)
    box('GenGreen', x - W / 2, x + W / 2, 0.25, 0.25 + Hh, z - L / 2, z + L / 2)
    top = 0.25 + Hh
    # doors along both sides (panel lines, handles), louvred ends, the control panel, the exhaust stack
    for sx in (-1, 1):
        xf = x + sx * (W / 2 + 0.002)
        for k in range(4):
            zz = z - L / 2 + 0.3 + k * (L - 0.6) / 4
            quad('Black', [(xf, 0.4, zz), (xf, 0.4, zz + 0.012), (xf, top - 0.2, zz + 0.012), (xf, top - 0.2, zz)], (sx, 0, 0))
            box('Metal', min(xf, xf + sx * 0.04), max(xf, xf + sx * 0.04), 1.2, 1.35, zz + 0.4, zz + 0.44)
    for sz in (-1, 1):
        zf = z + sz * (L / 2 + 0.002)
        for k in range(10):
            yy = 0.5 + k * 0.17
            quad('Black', [(x - W / 2 + 0.12, yy, zf), (x + W / 2 - 0.12, yy, zf), (x + W / 2 - 0.12, yy + 0.07, zf), (x - W / 2 + 0.12, yy + 0.07, zf)], (0, 0, sz))
    box('HVACGrey', x - 0.4, x + 0.4, 1.0, 1.8, z + L / 2, z + L / 2 + 0.25)
    quad('Screen', [(x - 0.3, 1.45, z + L / 2 + 0.251), (x + 0.3, 1.45, z + L / 2 + 0.251), (x + 0.3, 1.7, z + L / 2 + 0.251), (x - 0.3, 1.7, z + L / 2 + 0.251)], (0, 0, 1))
    quad('LampGreen', [(x - 0.3, 1.2, z + L / 2 + 0.251), (x - 0.22, 1.2, z + L / 2 + 0.251), (x - 0.22, 1.28, z + L / 2 + 0.251), (x - 0.3, 1.28, z + L / 2 + 0.251)], (0, 0, 1))
    S.cyl('Steel', (x + 0.3, 0, z - L / 2 + 0.8), 0.13, 0.13, top, top + 1.1, 8, cap0=False)
    S.cyl('Black', (x + 0.3, 0, z - L / 2 + 0.8), 0.14, 0.14, top + 1.1, top + 1.18, 8, cap0=False)
    box('Steel', x - 0.5, x + 0.1, top, top + 0.25, z - 0.8, z + 0.8)          # the radiator hood
    text('Paint', 'GEN %d' % (1 if z < 0 else 2), 0.3, (x - W / 2 - 0.004, 1.9, z), (0, 0, 1), (0, 1, 0))


genset(GX, -3.2)
genset(GX, 2.2)
# the fuel tank: a horizontal double-walled tank on saddles inside a concrete bund, a HESCO revetment behind it
tx, tz = 23.2, -0.5
box('Concrete', tx - 1.6, tx + 1.6, 0.0, 0.5, tz - 3.4, tz - 3.2)
box('Concrete', tx - 1.6, tx + 1.6, 0.0, 0.5, tz + 3.2, tz + 3.4)
box('Concrete', tx - 1.6, tx - 1.4, 0.0, 0.5, tz - 3.2, tz + 3.2)
box('Concrete', tx + 1.4, tx + 1.6, 0.0, 0.5, tz - 3.2, tz + 3.2)
quad('Concrete', [(tx - 1.4, 0.05, tz - 3.2), (tx - 1.4, 0.05, tz + 3.2), (tx + 1.4, 0.05, tz + 3.2), (tx + 1.4, 0.05, tz - 3.2)], (0, 1, 0))
for zz in (tz - 1.6, tz + 1.6):
    box('Steel', tx - 0.9, tx + 0.9, 0.05, 0.7, zz - 0.15, zz + 0.15)
S.cyl('TankWhite', (tx, 1.55, 0), 1.05, 1.05, tz - 2.8, tz + 2.8, 16, axis='z')
for sz in (-1, 1):
    disc('TankWhite', (tx, 1.55, tz + sz * 2.801), 1.02, 16, (0, 0, sz))
for zz in (tz - 1.6, tz + 1.6):
    ring = [(tx + 1.07 * math.cos(PI * k / 8), 1.55 + 1.07 * math.sin(PI * k / 8), zz) for k in range(9)]
    for a, b in zip(ring, ring[1:]):
        S.beam('Steel', a, b, 0.05, 0.12, caps=False)
box('Steel', tx - 0.3, tx + 0.3, 2.55, 2.75, tz - 0.3, tz + 0.3)
S.cyl('Steel', (tx + 0.6, 0, tz + 1.0), 0.05, 0.05, 2.5, 3.1, 6, cap0=False)
S.beam('Steel', (tx + 0.6, 3.1, tz + 1.0), (tx + 0.75, 3.0, tz + 1.0), 0.1, caps=False)
text('SignRed', 'DIESEL', 0.45, (tx - 1.07, 1.6, tz), (0, 0, 1), (0, 1, 0))
text('SignRed', 'NO SMOKING', 0.18, (tx - 1.07, 1.05, tz), (0, 0, 1), (0, 1, 0))
# fuel lines from the tank to the gensets (on low supports), power cables to the service entrance (in a trench cover)
for zz in (-3.2, 2.2):
    pts = [(tx - 1.2, 0.4, tz + (zz - tz) * 0.3), (GX + 1.2, 0.4, zz + 0.8), (GX + 0.85, 0.4, zz + 0.8)]
    for a, b in zip(pts, pts[1:]):
        S.beam('Black', a, b, 0.05, caps=False)
box('Steel', BX + 0.45, GX - 0.95, 0.0, 0.06, -2.9, -2.1)
box('Steel', GX - 1.2, GX - 0.95, 0.0, 0.06, -2.9, 2.6)
for k in range(8):
    x = BX + 0.7 + k * 0.6
    quad('Black', [(x, 0.061, -2.9), (x, 0.061, -2.1), (x + 0.02, 0.061, -2.1), (x + 0.02, 0.061, -2.9)], (0, 1, 0))
mark('generator farm')


# ═════════════ HESCO bastions ═════════════
def hesco(p0, p1, h=1.37, w=1.06, cells=None):
    """a line of HESCO cells from p0 to p1 (x, z): tan geotextile faces, wire lines and coil joints, earth on top"""
    a, b = Vector((p0[0], 0, p0[1])), Vector((p1[0], 0, p1[1]))
    d = b - a
    L = d.length
    d.normalize()
    n = Vector((d.z, 0, -d.x))
    cells = cells or max(1, round(L / w))
    c0 = [a + n * (w / 2), b + n * (w / 2), b - n * (w / 2), a - n * (w / 2)]
    for sgn, (u, v) in ((1, (0, 1)), (-1, (2, 3))):
        pu, pv = c0[u], c0[v]
        S.g('HescoTan').face([tuple(pu), tuple(pv), tuple(pv + Vector((0, h, 0))), tuple(pu + Vector((0, h, 0)))], [(0, 0), (L, 0), (L, h), (0, h)], tuple(n * sgn))
        for k in range(1, 4):
            y = h * k / 4
            off = n * sgn * 0.004
            S.g('Steel').face([tuple(pu + off + Vector((0, y - 0.01, 0))), tuple(pv + off + Vector((0, y - 0.01, 0))), tuple(pv + off + Vector((0, y + 0.01, 0))), tuple(pu + off + Vector((0, y + 0.01, 0)))], None, tuple(n * sgn))
        for k in range(cells + 1):
            p = pu + (pv - pu) * (k / cells) + n * sgn * 0.006
            S.g('Steel').face([tuple(p - d * 0.018), tuple(p + d * 0.018), tuple(p + d * 0.018 + Vector((0, h + 0.02, 0))), tuple(p - d * 0.018 + Vector((0, h + 0.02, 0)))], None, tuple(n * sgn))
    for (u, v, nn) in ((0, 3, -d), (1, 2, d)):
        S.g('HescoTan').face([tuple(c0[u]), tuple(c0[v]), tuple(c0[v] + Vector((0, h, 0))), tuple(c0[u] + Vector((0, h, 0)))], None, tuple(nn))
    # the earth fill, heaped a little in each cell
    for k in range(cells):
        pa, pb = a + d * (L * k / cells), a + d * (L * (k + 1) / cells)
        mid = (pa + pb) / 2 + Vector((0, h + 0.08, 0))
        corners = [pa + n * (w / 2 - 0.02), pb + n * (w / 2 - 0.02), pb - n * (w / 2 - 0.02), pa - n * (w / 2 - 0.02)]
        for i in range(4):
            q0, q1 = corners[i] + Vector((0, h - 0.03, 0)), corners[(i + 1) % 4] + Vector((0, h - 0.03, 0))
            S.g('Earth').face([tuple(q0), tuple(q1), tuple(mid)], None, (0, 1, 0))
    return (min(p0[0], p1[0]) - w / 2, max(p0[0], p1[0]) + w / 2, min(p0[1], p1[1]) - w / 2, max(p0[1], p1[1]) + w / 2, h)


SOLIDS = []
SOLIDS.append(hesco((-BX - 2.2, -7.5), (-BX - 2.2, 3.5)))                 # the row along the west side
SOLIDS.append(hesco((tx + 2.4, tz - 4.2), (tx + 2.4, tz + 4.2)))         # the revetment behind the fuel tank
SOLIDS.append(hesco((tx - 1.6, tz - 4.3), (tx + 1.9, tz - 4.3)))
SOLIDS.append(hesco((tx - 1.6, tz + 4.3), (tx + 1.9, tz + 4.3)))
mark('hesco')


# ═════════════ the T-wall ring with the entry chicane ═════════════
def twall(c, yaw, h=3.66, w=1.52, bh=0.34):
    """one Bremer T-wall section: a 1.2 m base, a fillet, a tapering stem, two lifting holes; local x along the wall"""
    M = R.mat3(yaw)
    R.obox(S, 'Concrete', M, c, -w / 2, w / 2, 0.0, bh, -0.6, 0.6, skip=('bottom',))
    for sz in (-1, 1):
        q = [(-w / 2, 0.34, sz * 0.36), (w / 2, 0.34, sz * 0.36), (w / 2, 0.62, sz * 0.15), (-w / 2, 0.62, sz * 0.15)]
        S.g('Concrete').face([R.xf(M, c, p) for p in q], [(p[0], p[1]) for p in q], tuple(M @ Vector((0, 0.6, sz * 0.8))))
        q = [(-w / 2, 0.62, sz * 0.15), (w / 2, 0.62, sz * 0.15), (w / 2, h, sz * 0.1), (-w / 2, h, sz * 0.1)]
        S.g('Concrete').face([R.xf(M, c, p) for p in q], [(p[0], p[1]) for p in q], tuple(M @ Vector((0, 0.0, sz))))
        for hx in (-0.35, 0.35):
            q = [(hx - 0.09, h - 0.42, sz * 0.105), (hx + 0.09, h - 0.42, sz * 0.105), (hx + 0.09, h - 0.3, sz * 0.105), (hx - 0.09, h - 0.3, sz * 0.105)]
            S.g('Black').face([R.xf(M, c, (p[0], p[1], p[2] + sz * 0.003)) for p in q], None, tuple(M @ Vector((0, 0, sz))))
    for sx in (-1, 1):
        q = [(sx * w / 2, 0.34, -0.36), (sx * w / 2, 0.34, 0.36), (sx * w / 2, 0.62, 0.15), (sx * w / 2, h, 0.1), (sx * w / 2, h, -0.1), (sx * w / 2, 0.62, -0.15)]
        S.g('Concrete').face([R.xf(M, c, p) for p in q], [(p[2], p[1]) for p in q], tuple(M @ Vector((sx, 0, 0))))
    q = [(-w / 2, h, -0.1), (w / 2, h, -0.1), (w / 2, h, 0.1), (-w / 2, h, 0.1)]
    S.g('Concrete').face([R.xf(M, c, p) for p in q], [(p[0], p[2]) for p in q], (0, 1, 0))


def twall_run(p0, p1, gaps=(), bh=0.34):
    """T-wall sections from p0 to p1 (x, z), 1.54 m pitch, skipping any section whose centre falls in a gap (a0, a1)
    measured along the run; returns the solid boxes of the pieces"""
    a, b = Vector((p0[0], 0, p0[1])), Vector((p1[0], 0, p1[1]))
    L = (b - a).length
    d = (b - a) / L
    yaw = math.atan2(-d.z, d.x)
    n = int(L / 1.54)
    pitch = L / n
    out, cur = [], None
    for k in range(n):
        s = (k + 0.5) * pitch
        if any(g0 <= s <= g1 for (g0, g1) in gaps):
            if cur:
                out.append(cur)
                cur = None
            continue
        c = a + d * s
        twall(tuple(c), yaw, bh=bh)
        if cur is None:
            cur = [s - pitch / 2, s + pitch / 2]
        else:
            cur[1] = s + pitch / 2
    if cur:
        out.append(cur)
    boxes = []
    for (s0, s1) in out:
        q0, q1 = a + d * s0, a + d * s1
        boxes.append((min(q0.x, q1.x) - 0.6 * abs(d.z) - 0.1, max(q0.x, q1.x) + 0.6 * abs(d.z) + 0.1, min(q0.z, q1.z) - 0.6 * abs(d.x) - 0.1, max(q0.z, q1.z) + 0.6 * abs(d.x) + 0.1, 3.66))
    return boxes


RX0, RX1, RZ0, RZ1 = -18.0, 28.0, -14.5, 13.5
# the ring (the front run has the entry gap at x 5.6..10.4, in front of the door)
SOLIDS += twall_run((RX0, RZ0), (5.6, RZ0))
SOLIDS += twall_run((10.4, RZ0), (RX1, RZ0))
SOLIDS += twall_run((RX1, RZ0 + 0.3), (RX1, RZ1 - 0.3), bh=0.35)
SOLIDS += twall_run((RX1, RZ1), (RX0, RZ1))
SOLIDS += twall_run((RX0, RZ1 - 0.3), (RX0, RZ0 + 0.3), bh=0.35)
# the chicane: a run outside the gap (you come in round its ends), with the building's name painted on it
CZ = RZ0 - 3.2
SOLIDS += twall_run((3.4, CZ), (12.6, CZ))
# painted on the chicane's outer face: a blue band with the name, the restricted-area warning under it
quad('Blue', [(12.5, 2.0, CZ - 0.152), (3.5, 2.0, CZ - 0.152), (3.5, 2.72, CZ - 0.152), (12.5, 2.72, CZ - 0.152)], (0, 0, -1))
text('Paint', 'JOINT OPERATIONS CENTER', 0.52, (8.0, 2.35, CZ - 0.156), (-1, 0, 0), (0, 1, 0))
quad('Paint', [(10.6, 0.95, CZ - 0.155), (5.4, 0.95, CZ - 0.155), (5.4, 1.8, CZ - 0.155), (10.6, 1.8, CZ - 0.155)], (0, 0, -1))
text('SignRed', 'RESTRICTED AREA', 0.3, (8.0, 1.55, CZ - 0.159), (-1, 0, 0), (0, 1, 0))
text('Black', 'DEADLY FORCE AUTHORIZED', 0.2, (8.0, 1.14, CZ - 0.159), (-1, 0, 0), (0, 1, 0))
mark('t-walls')

# ═════════════ the entrance: sandbag walls, a sandbagged guard post, camouflage netting, floodlight poles ═════════════
def sandbags(p0, p1, rows=6, bag=(0.52, 0.14, 0.3)):
    """a stacked sandbag wall from p0 to p1 (x, z): bags in running bond, slightly rounded (bevelled tops)"""
    a, b = Vector((p0[0], 0, p0[1])), Vector((p1[0], 0, p1[1]))
    L = (b - a).length
    d = (b - a) / L
    yaw = math.atan2(-d.z, d.x)
    M = R.mat3(yaw)
    bl, bh, bw = bag
    for r in range(rows):
        off = (bl / 2) * (r % 2)
        n = int((L - off) / bl)
        for k in range(n):
            s = off + (k + 0.5) * bl
            c = a + d * s
            y0 = r * bh
            R.obox(S, 'Sandbag', M, tuple(c), -bl / 2 + 0.01, bl / 2 - 0.01, y0, y0 + bh * 0.7, -bw / 2, bw / 2, skip=('bottom',))
            q = [(-bl / 2 + 0.03, y0 + bh * 0.7, -bw / 2 + 0.04), (bl / 2 - 0.03, y0 + bh * 0.7, -bw / 2 + 0.04), (bl / 2 - 0.05, y0 + bh, -bw / 2 + 0.08), (-bl / 2 + 0.05, y0 + bh, -bw / 2 + 0.08)]
            S.g('Sandbag').face([R.xf(M, tuple(c), p) for p in q], None, tuple(M @ Vector((0, 0.5, -0.8))))
            q = [(-bl / 2 + 0.05, y0 + bh, bw / 2 - 0.08), (bl / 2 - 0.05, y0 + bh, bw / 2 - 0.08), (bl / 2 - 0.03, y0 + bh * 0.7, bw / 2 - 0.04), (-bl / 2 + 0.03, y0 + bh * 0.7, bw / 2 - 0.04)]
            S.g('Sandbag').face([R.xf(M, tuple(c), p) for p in q], None, tuple(M @ Vector((0, 0.5, 0.8))))
            if r == rows - 1:
                q = [(-bl / 2 + 0.05, y0 + bh, -bw / 2 + 0.08), (bl / 2 - 0.05, y0 + bh, -bw / 2 + 0.08), (bl / 2 - 0.05, y0 + bh, bw / 2 - 0.08), (-bl / 2 + 0.05, y0 + bh, bw / 2 - 0.08)]
                S.g('Sandbag').face([R.xf(M, tuple(c), p) for p in q], None, (0, 1, 0))
    return (min(p0[0], p1[0]) - 0.2, max(p0[0], p1[0]) + 0.2, min(p0[1], p1[1]) - 0.2, max(p0[1], p1[1]) + 0.2, rows * bag[1])


# L-shaped sandbag walls flanking the entrance landing
SOLIDS.append(sandbags((DOOR_X - 3.2, -BZ - 0.2), (DOOR_X - 3.2, -BZ - 2.6)))
SOLIDS.append(sandbags((DOOR_X - 3.2, -BZ - 2.6), (DOOR_X - 1.8, -BZ - 2.6)))
SOLIDS.append(sandbags((DOOR_X + 3.2, -BZ - 0.2), (DOOR_X + 3.2, -BZ - 2.6)))
SOLIDS.append(sandbags((DOOR_X + 3.2, -BZ - 2.6), (DOOR_X + 1.8, -BZ - 2.6)))
# the guard post inside the gap: a ring of sandbags 1.2 m high, a small roof on posts
gpx, gpz = 14.2, RZ0 + 2.4
ring = [(gpx + 1.1 * math.cos(2 * PI * k / 8), gpz + 1.1 * math.sin(2 * PI * k / 8)) for k in range(8)]
for k in range(7):
    sandbags(ring[k], ring[k + 1], rows=8)
for k in range(4):
    a = 2 * PI * k / 4 + PI / 4
    S.beam('Wood', (gpx + 0.95 * math.cos(a), 0.0, gpz + 0.95 * math.sin(a)), (gpx + 0.95 * math.cos(a), 2.3, gpz + 0.95 * math.sin(a)), 0.1, caps=False)
box('Wood', gpx - 1.3, gpx + 1.3, 2.3, 2.4, gpz - 1.3, gpz + 1.3, skip=())
box('Sandbag', gpx - 1.2, gpx + 1.2, 2.4, 2.55, gpz - 1.2, gpz + 1.2)
SOLIDS.append((gpx - 1.3, gpx + 1.3, gpz - 1.3, gpz + 1.3, 1.2))


def camo_net(x0, x1, z0, z1, y_hi, y_lo, nx=7, nz=5):
    """a camouflage net draped over the entrance: a sagging grid (seen from above and below), two colours in
    patches, garnish tufts"""
    def P(i, j):
        u, v = i / nx, j / nz
        sag = math.sin(u * PI) * math.sin(v * PI)
        y = y_hi - (y_hi - y_lo) * sag - (0.25 * v)
        jitter = ((i * 7 + j * 13) % 5 - 2) * 0.03
        return (x0 + (x1 - x0) * u, y + jitter, z0 + (z1 - z0) * v)
    for i in range(nx):
        for j in range(nz):
            m = 'CamoNet' if (i * 3 + j * 5) % 4 else 'CamoNet2'
            q = [P(i, j), P(i + 1, j), P(i + 1, j + 1), P(i, j + 1)]
            S.g(m).face(q, None, (0, 1, 0))
            S.g(m).face(list(reversed(q)), None, (0, -1, 0))
    # garnish: small tilted flaps sticking out of the net
    for k in range(18):
        i, j = (k * 5) % nx, (k * 3) % nz
        p = Vector(P(i + 0.5 if i < nx - 1 else i, j))
        a = k * 1.7
        q = [p + Vector((math.cos(a) * 0.3, 0.05, math.sin(a) * 0.3)), p + Vector((-math.sin(a) * 0.25, 0.15, math.cos(a) * 0.25)), p + Vector((-math.cos(a) * 0.3, 0.05, -math.sin(a) * 0.3))]
        S.g('CamoNet2' if k % 2 else 'CamoNet').face([tuple(v) for v in q], None, (0, 1, 0))
        S.g('CamoNet2' if k % 2 else 'CamoNet').face([tuple(v) for v in reversed(q)], None, (0, -1, 0))


camo_net(DOOR_X - 3.6, DOOR_X + 3.6, -BZ - 4.2, -BZ + 0.05, 3.5, 2.95)
for sx in (-1, 1):
    S.beam('Wood', (DOOR_X + sx * 3.5, 0.0, -BZ - 4.1), (DOOR_X + sx * 3.5, 3.3, -BZ - 4.1), 0.1, caps=False)
    S.beam('Metal', (DOOR_X + sx * 3.5, 3.3, -BZ - 4.1), (DOOR_X + sx * 4.8, 0.0, -BZ - 4.5), 0.01, caps=False)
S.beam('Wood', (DOOR_X - 3.5, 3.3, -BZ - 4.1), (DOOR_X + 3.5, 3.3, -BZ - 4.1), 0.08, caps=False)


def flood_pole(x, z, yaw):
    S.cyl('Steel', (x, 0, z), 0.09, 0.06, 0.0, 7.0, 6, cap0=False)
    box('Concrete', x - 0.35, x + 0.35, 0.0, 0.3, z - 0.35, z + 0.35)
    S.beam('Steel', (x - 0.5, 7.0, z), (x + 0.5, 7.0, z), 0.06, caps=False)
    for dx in (-0.4, 0.4):
        floodlight((x + dx, 6.85, z), yaw, 0.6)
    box('HVACGrey', x - 0.15, x + 0.15, 1.2, 1.7, z - 0.15, z + 0.15)


for (x, z) in ((RX0 + 1.5, RZ0 + 1.5), (RX1 - 1.5, RZ0 + 1.5), (RX0 + 1.5, RZ1 - 1.5), (RX1 - 1.5, RZ1 - 1.5)):
    flood_pole(x, z, math.atan2(x, z))
flood_pole(3.2, RZ0 + 1.8, math.atan2(3.2 - DOOR_X, RZ0 + 1.8 + BZ) + PI)
# the apron in front of the entrance, a walkway from the gap, a bench and a butt can by the chicane
box('Concrete', DOOR_X - 3.0, DOOR_X + 3.0, 0.0, 0.03, -BZ - 4.5, -BZ)
box('Concrete', DOOR_X - 1.2, DOOR_X + 1.2, 0.0, 0.025, RZ0 - 0.6, -BZ - 4.5)
box('Wood', -2.2, -0.2, 0.42, 0.47, RZ0 + 1.2, RZ0 + 1.6)
for x in (-2.0, -0.4):
    box('Steel', x - 0.04, x + 0.04, 0.0, 0.42, RZ0 + 1.25, RZ0 + 1.55)
S.cyl('SignRed', (0.3, 0, RZ0 + 1.4), 0.18, 0.18, 0.0, 0.6, 8, cap0=False)
fpx, fpz = 2.0, -11.2
box('Concrete', fpx - 0.4, fpx + 0.4, 0.0, 0.2, fpz - 0.4, fpz + 0.4)
S.cyl('Chrome', (fpx, 0, fpz), 0.07, 0.04, 0.2, 9.0, 8, cap0=False)
S.sphere('Brass', (fpx, 9.07, fpz), 0.08, 0.08, 0.08, 8, 4)
FW, FH = 2.2, 1.16
US = [0.0, 0.2, 0.4, 0.7, 1.0]          # the flag's panels along the fly (the canton covers the first two)


def fpt(u, v, dz=0.0):
    """a point on the flag (u from the hoist, v up): it flies toward +x and ripples"""
    return (fpx + 0.05 + u * FW, 8.9 - FH + v * FH - u * 0.08, fpz + 0.12 * math.sin(u * PI * 2.2) * u + dz)


for i in range(13):
    m = 'SignRed' if i % 2 == 0 else 'Paint'
    v0, v1 = 1 - (i + 1) / 13, 1 - i / 13
    for k in range(4):
        u0, u1 = US[k], US[k + 1]
        if k < 2 and i < 7:
            continue                      # under the canton
        q = [fpt(u0, v0), fpt(u1, v0), fpt(u1, v1), fpt(u0, v1)]
        S.g(m).face(q, None, (0, 0, -1))
        S.g(m).face(list(reversed(q)), None, (0, 0, 1))
for k in range(2):
    u0, u1 = US[k], US[k + 1]
    q = [fpt(u0, 6 / 13), fpt(u1, 6 / 13), fpt(u1, 1.0), fpt(u0, 1.0)]
    S.g('Blue').face(q, None, (0, 0, -1))
    S.g('Blue').face(list(reversed(q)), None, (0, 0, 1))
    for j in range(3):
        for i in range(3):
            uu, vv = u0 + (u1 - u0) * (i + 0.5) / 3, 6 / 13 + (7 / 13) * (j + 0.5) / 3
            for dz, nz in ((-0.004, -1), (0.004, 1)):
                c = fpt(uu, vv, dz)
                st = [(c[0] - 0.03, c[1], c[2]), (c[0], c[1] - 0.03, c[2]), (c[0] + 0.03, c[1], c[2]), (c[0], c[1] + 0.03, c[2])]
                S.g('Paint').face(st if nz < 0 else list(reversed(st)), None, (0, 0, nz))
text('Black', 'BLDG 1107', 0.3, (-BX + 1.8, 1.4, -BZ - 0.004), (-1, 0, 0), (0, 1, 0))
mark('entrance dressing')

R.finish(OUT, {
    'footprint': [-BX, BX, -BZ, BZ], 'height': PH,
    'solids': [[round(v, 2) for v in s] for s in SOLIDS],
    'interior': {'room': 'joc', 'origin': [0.0, -0.45, 0.0], 'yaw': math.pi},
})
