# X-100 Overkill: its own retractable landing gear (Blender, headless), for models.js MODEL_FILES `gear`.
#   /opt/homebrew/bin/blender -b -P tools/aircraft/x100_gear.py -- models/aircraft/x100.glb models/aircraft/x100_gear.glb
# (build the airframe first: tools/aircraft/x100.py; the doors take its skin's texture mapping.)
# The X-100's needle forebody sits high above the ground, so the game's generic struts (hung from the lowest point of
# the model) would float a long way under its nose; these legs live where the jet really has room for them:
#   - the nose leg under the cockpit (s 4.45 m), a tall single-wheel oleo with a taxi light and torque link, folding
#     90° aft into the forebody between two doors on the keel;
#   - the main legs under the nacelles (s 11.55 m, 1.42 m out), single wheels inboard on stub axles, each folding 90°
#     aft into its nacelle under a door hinged on the nacelle's outer bottom edge.
# All three wheels touch at the same height (z -1.95 m in the kit's frame: s aft of the nose, z up from the chine),
# so the jet sits level, the nacelles 1.06 m and the ventral fins 0.84 m off the ground. Folded, every part lies
# inside the airframe (checked here against the airframe file by ray casting).
# Frame: the airframe file's own (aircraft_kit: Blender Y = −s, Z up; glTF x, z_kit, s). File layout as for the
# CL-415 (tools/aircraft/cl415_gear.py, models.js normaliseGear): top-level gear_nose / gear_main_l / gear_main_r with
# origin on the pivot and extras axis (file coordinates), angle (degrees, down → up), kind, contact; the doors are
# children with extras axis / angle / from / to / fixed (they stay on the airframe and close in the last 30%).
# Materials carry no texture: legs, tyres and hubs have extras noPaint (liveries skip them); the doors' share 'Skin'
# and paint 1: they draw with the airframe's own skin (and its livery) through UVs projected from it.
import os, sys, math
import bpy, bmesh
from mathutils import Vector, Matrix
from mathutils.bvhtree import BVHTree
from mathutils.geometry import barycentric_transform
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), '..'))
import aircraft_kit as K

argv = sys.argv[sys.argv.index('--') + 1:]
AIRFRAME, OUT = argv[0], argv[1]

GROUND = -1.95                     # kit z of the wheels' contact
K.begin('x100_gear', 21.0, panel=None)
def gmat(name, col, metal, rough, **props):
    m = K.new_material(name, col, metal=metal, rough=rough)
    for k, v in props.items():
        m[k] = v
    return name
LEG = gmat('x100_gear_leg', '#c4c8cc', 0.6, 0.35, noPaint=1)
CHROME = gmat('x100_gear_chrome', '#e2e5e8', 0.9, 0.15, noPaint=1)
TYRE = gmat('x100_gear_tyre', '#1a1a1b', 0.0, 0.85, noPaint=1)
HUB = gmat('x100_gear_hub', '#8d9196', 0.6, 0.4, noPaint=1)
LIGHT = gmat('x100_gear_light', '#fffbe8', 0.0, 0.2, noPaint=1)
DOOR = gmat('x100_gear_door', '#17181b', 0.1, 0.5, share='Skin', paint=1)

# the airframe, for the doors' UVs and the stowage check
bpy.ops.import_scene.gltf(filepath=AIRFRAME)
air = [o for o in bpy.context.selected_objects if o.type == 'MESH']
assert len(air) == 1, 'one joined airframe mesh'
air = air[0]
air.data.transform(air.matrix_world)
air.matrix_world = Matrix.Identity(4)
dg = bpy.context.evaluated_depsgraph_get()
BVH = BVHTree.FromObject(air, dg)
K.STATE['objects'] = []

def V(s, x, z):
    return Vector((x, K.Y(s), z))

def rod(name, a, b, r, mat, N=12):
    return K.tube(name, [a, b], r, material=mat, N=N)[0]

def wheel(name, c, R, W, N=24):
    """A tyre and hub turning about the x axis, centred on c = (s, x, z)."""
    s, x, z = c
    bm = bmesh.new()
    prof = [(-W / 2, R * 0.60), (-W / 2, R * 0.84), (-W * 0.40, R * 0.97), (0.0, R), (W * 0.40, R * 0.97), (W / 2, R * 0.84),
            (W / 2, R * 0.60)]
    rings = [[bm.verts.new((x + dx, K.Y(s) + r * math.cos(2 * math.pi * k / N), z + r * math.sin(2 * math.pi * k / N))) for k in range(N)]
             for dx, r in prof]
    for a, b in zip(rings, rings[1:]):
        K._bridge(bm, a, b)
    # the hub: a recessed disc each side
    hub = []
    for side in (-1, 1):
        rim = rings[0] if side < 0 else rings[-1]
        inner = [bm.verts.new((x + side * W * 0.30, K.Y(s) + R * 0.45 * math.cos(2 * math.pi * k / N), z + R * 0.45 * math.sin(2 * math.pi * k / N))) for k in range(N)]
        cen = bm.verts.new((x + side * W * 0.34, K.Y(s), z))
        hub.append((rim, inner, cen, side))
    for rim, inner, cen, side in hub:
        for k in range(N):
            j = (k + 1) % N
            f = bm.faces.new((rim[k], rim[j], inner[j], inner[k]))
            f.material_index = 1
            f = bm.faces.new((inner[k], inner[j], cen))
            f.material_index = 1
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    return K._obj(name, bm, [TYRE, HUB])

def door(name, quad, t=0.01):
    """A door plate (closed pose) over quad = four (s, x, z) corners on the skin, its UVs projected from the airframe."""
    o = K.plate(name, quad, t=t, material=DOOR)[0]
    me = o.data
    uvl = me.uv_layers.new(name='UVMap')
    src_uv = air.data.uv_layers[0].data
    for poly in me.polygons:
        for li in poly.loop_indices:
            co = me.vertices[me.loops[li].vertex_index].co
            loc, nrm, fi, dist = BVH.find_nearest(co)
            f = air.data.polygons[fi]
            vs = [air.data.vertices[i].co for i in f.vertices[:3]]
            uvs = [Vector((src_uv[l].uv[0], src_uv[l].uv[1], 0)) for l in f.loop_indices[:3]]
            w = barycentric_transform(loc, vs[0], vs[1], vs[2], uvs[0], uvs[1], uvs[2])
            uvl.data[li].uv = (w.x, w.y)
    return o

def skin_below(s, x):
    """The airframe's lower skin height under (s, x): a ray up from below."""
    hit = BVH.ray_cast(V(s, x, -5.0), Vector((0, 0, 1)))
    return hit[0].z

def empty(name, q):
    e = bpy.data.objects.new(name, None)
    bpy.context.collection.objects.link(e)
    e.location = q
    return e

def attach(child, par, origin=None):
    if origin is not None:
        child.data.transform(Matrix.Translation(-origin))
        child.location = origin
    bpy.context.view_layer.update()
    child.parent = par
    child.matrix_parent_inverse = par.matrix_world.inverted()

def rotate_obj(o, pivot, axis, ang):
    """Turn an object's mesh about a world axis through pivot (its origin stays where it is)."""
    M = Matrix.Translation(pivot) @ Matrix.Rotation(ang, 4, axis) @ Matrix.Translation(-pivot)
    o.data.transform(o.matrix_world.inverted() @ M @ o.matrix_world)

gl = lambda v: [round(v[0], 5), round(v[2], 5), round(-v[1], 5)]   # Blender → glTF file coordinates
AFT_UP = Vector((-1, 0, 0))        # +90° about −x swings a hanging leg's foot aft and up

# ── nose leg ──
NS, NZ, NR, NW = 4.45, -0.05, 0.27, 0.17
n_axle = GROUND + NR
nparts = [rod('gear_nose_strut', (NS, 0, NZ + 0.02), (NS, 0, -1.18), 0.072, LEG),
          rod('gear_nose_oleo', (NS, 0, -1.10), (NS, 0, n_axle + 0.06), 0.05, CHROME),
          rod('gear_nose_collar', (NS, 0, -1.20), (NS, 0, -1.12), 0.085, LEG),
          K.plate('gear_nose_fork', [(NS - 0.07, 0.105, n_axle + 0.30), (NS + 0.07, 0.105, n_axle + 0.30), (NS + 0.05, 0.105, n_axle),
                                     (NS - 0.05, 0.105, n_axle)], t=0.025, material=LEG, mirror=True),
          rod('gear_nose_axle', (NS, -0.12, n_axle), (NS, 0.12, n_axle), 0.025, HUB, N=8),
          wheel('gear_nose_wheel', (NS, 0, n_axle), NR, NW),
          # torque link (the scissors on the leg's front), the taxi light and its bracket, the steering actuator
          rod('gear_nose_torque_a', (NS - 0.02, 0, -1.16), (NS - 0.13, 0, -1.30), 0.018, LEG, N=6),
          rod('gear_nose_torque_b', (NS - 0.13, 0, -1.30), (NS - 0.02, 0, n_axle + 0.24), 0.018, LEG, N=6),
          rod('gear_nose_lightarm', (NS, 0, -0.80), (NS - 0.16, 0, -0.80), 0.02, LEG, N=6),
          K.ellipsoid('gear_nose_light', NS - 0.19, 0.0, -0.80, 0.05, 0.065, 0.065, material=LIGHT, seg=12)[0],
          rod('gear_nose_steer', (NS + 0.06, 0.05, -0.30), (NS + 0.06, 0.05, -0.75), 0.025, LEG, N=8)]
nparts = [p[0] if isinstance(p, list) and len(p) == 1 else p for p in nparts]
flat = []
for p in nparts:
    flat += p if isinstance(p, list) else [p]
nparts = flat

# nose doors on the keel either side of the bay, hinged on the bay's sides; modelled open (hanging), the last 30%
# of the travel closes them flush over the folded leg
N_S0, N_S1, N_HW = 4.15, 6.40, 0.21
ndoors = []
for side in (1, -1):
    xs = side * N_HW
    za, zb = skin_below(N_S0, xs * 0.5) - 0.011, skin_below(N_S1, xs * 0.5) - 0.011
    d = door('gear_nose_door_' + ('r' if side > 0 else 'l'), [(N_S0, 0.004 * side, za), (N_S1, 0.004 * side, zb), (N_S1, xs, zb), (N_S0, xs, za)])
    hinge_a, hinge_b = V(N_S0, xs, za), V(N_S1, xs, zb)
    ax = (hinge_a - hinge_b).normalized() * side          # closing: the hanging plate swings inboard
    rotate_obj(d, hinge_a, ax, -math.pi / 2)              # open it: hang it down from its hinge
    ndoors.append((d, (hinge_a + hinge_b) / 2, ax))

# ── main legs ──
MS, MZ, MX, WX, MR, MW = 11.55, -0.42, 1.42, 1.24, 0.40, 0.26
m_axle = GROUND + MR
mains = {}
for side in (1, -1):
    sx = 'r' if side > 0 else 'l'
    x, wx = side * MX, side * WX
    parts = [rod(f'gear_main_{sx}_strut', (MS, x, MZ + 0.02), (MS, x, -1.18), 0.09, LEG),
             rod(f'gear_main_{sx}_collar', (MS, x, -1.22), (MS, x, -1.13), 0.11, LEG),
             rod(f'gear_main_{sx}_oleo', (MS, x, -1.15), (MS, x, m_axle), 0.066, CHROME),
             rod(f'gear_main_{sx}_axle', (MS, x, m_axle), (MS, wx - side * MW * 0.4, m_axle), 0.04, HUB, N=8),
             wheel(f'gear_main_{sx}_wheel', (MS, wx, m_axle), MR, MW),
             # the side brace runs aft and up from the strut (folded, it lies along the nacelle's roof)
             rod(f'gear_main_{sx}_brace', (MS + 0.02, x, -0.92), (MS + 0.70, x, MZ + 0.05), 0.035, LEG, N=8),
             rod(f'gear_main_{sx}_torque_a', (MS + 0.02, x, -1.18), (MS + 0.14, x, -1.32), 0.02, LEG, N=6),
             rod(f'gear_main_{sx}_torque_b', (MS + 0.14, x, -1.32), (MS + 0.02, x, m_axle + 0.10), 0.02, LEG, N=6)]
    # the door on the nacelle's flat bottom, hinged on its outer edge
    d0, d1, xi, xo = 11.30, 13.15, side * 1.08, side * 1.50
    za, zb = skin_below(d0, (xi + xo) / 2) - 0.011, skin_below(d1, (xi + xo) / 2) - 0.011
    d = door(f'gear_main_{sx}_door', [(d0, xi, za), (d1, xi, zb), (d1, xo, zb), (d0, xo, za)])
    hinge_a, hinge_b = V(d0, xo, za), V(d1, xo, zb)
    ax = (hinge_a - hinge_b).normalized() * side
    rotate_obj(d, hinge_a, ax, -math.pi / 2)
    mains[sx] = (parts, (d, (hinge_a + hinge_b) / 2, ax), V(MS, x, MZ), Vector((wx, K.Y(MS), GROUND)))

# ── stowage check: fold each leg and confirm it lies inside the airframe (every sample point enclosed: rays in six
# directions all hit the skin) ──
def enclosed(p):
    for d in ((1, 0, 0), (-1, 0, 0), (0, 1, 0), (0, -1, 0), (0, 0, 1), (0, 0, -1)):
        if BVH.ray_cast(p, Vector(d), 25.0)[0] is None:
            return False
    return True
def check(objs, pivot, name):
    R = Matrix.Translation(pivot) @ Matrix.Rotation(math.pi / 2, 4, AFT_UP) @ Matrix.Translation(-pivot)
    bad, n = 0, 0
    for o in objs:
        for v in list(o.data.vertices)[::3]:
            n += 1
            if not enclosed(R @ (o.matrix_world @ v.co)):
                bad += 1
    print('STOW %-10s %d of %d sample points outside the airframe' % (name, bad, n))
    return bad
bad = check(nparts, V(NS, 0, NZ), 'nose')
for sx, (parts, _, piv, _) in mains.items():
    bad += check(parts, piv, 'main_' + sx)

# ── assemble: the legs on their pivots, the doors as fixed linked parts ──
report = {}
nose = empty('gear_nose', V(NS, 0, NZ))
for p in nparts:
    attach(p, nose, V(NS, 0, NZ))
for d, h, ax in ndoors:
    attach(d, nose, h)
    d['axis'] = gl(ax); d['angle'] = 90.0; d['from'] = 0.7; d['to'] = 1.0; d['fixed'] = 1
nose['axis'] = gl(AFT_UP); nose['angle'] = 90.0; nose['kind'] = 'nose'; nose['contact'] = gl(Vector((0, K.Y(NS), GROUND)))
report['gear_nose'] = (V(NS, 0, NZ), Vector((0, K.Y(NS), GROUND)))
for sx, (parts, (d, h, ax), piv, ct) in mains.items():
    top = empty('gear_main_' + sx, piv)
    for p in parts:
        attach(p, top, piv)
    attach(d, top, h)
    d['axis'] = gl(ax); d['angle'] = 90.0; d['from'] = 0.7; d['to'] = 1.0; d['fixed'] = 1
    top['axis'] = gl(AFT_UP); top['angle'] = 90.0; top['kind'] = 'main'; top['contact'] = gl(ct)
    report['gear_main_' + sx] = (piv, ct)

# smooth shading on the round parts (rods, wheels), flat on plates
for o in bpy.data.objects:
    if o.type == 'MESH' and o is not air:
        K._shade(o, 40)

bpy.ops.object.select_all(action='DESELECT')
for r in [bpy.data.objects[n] for n in ('gear_nose', 'gear_main_l', 'gear_main_r')]:
    r.select_set(True)
    for c in r.children_recursive:
        c.select_set(True)
bpy.ops.export_scene.gltf(filepath=OUT, export_format='GLB', use_selection=True, export_apply=True, export_yup=True,
                          export_extras=True, export_materials='EXPORT', export_texcoords=True, export_normals=True)
tris = sum(len(p.vertices) - 2 for o in bpy.data.objects if o.type == 'MESH' and o is not air for p in o.data.polygons)
print('WROTE', OUT, os.path.getsize(OUT), 'gear tris', tris)
for name, (q, ct) in report.items():
    print('GEAR %-12s pivot %s contact %s (file)' % (name, gl(q), gl(ct)))
assert bad == 0, 'gear parts stick out of the airframe when folded'
