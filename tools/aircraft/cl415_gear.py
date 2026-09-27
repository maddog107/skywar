# ═══════════════════════════════════════════════════════════════
# Canadair CL-415: split helijah's model into the airframe and its retractable landing gear (Blender, headless).
#   blender -b -P tools/aircraft/cl415_gear.py -- SRC.glb AIRFRAME.glb models/aircraft/cl415_gear.glb [--check models/aircraft/cl415.glb]
# SRC: "cl415" by helijah, https://sketchfab.com/3d-models/cl415-bf3eaa6a1f4f4fc18df9b05cf40de927 (CC BY 4.0), from
#   the Objaverse mirror (tools/aircraft/IMPORTS.md). It is in metres: X is the length (nose toward −X), Z up.
# AIRFRAME: the source in its own frame without the landing gear, the static propeller blades (the game spins its
#   own: models.js MODEL_FILES.cl415.props) and the instrument gauges (too small to see through the windscreen), with
#   meaningful material names. models/aircraft/cl415.glb is made from it with import_model.py (IMPORTS.md).
# GEAR: the three gear legs in the frame import_model.py --nose -X gives the airframe (nose +Y in Blender = three.js
#   −Z, centred on the airframe's bounding box, same units), modelled extended (down), for models.js (MODEL_FILES
#   `gear`):
#   - gear_nose, gear_main_l, gear_main_r: origin on the retraction pivot, glTF extras
#       axis [x, y, z] (file coordinates), angle (degrees from down to fully up, a positive turn about axis),
#       kind 'nose' | 'main', contact [x, y, z] (the bottom of the wheels, extended)
#   - linked sub-parts: children with extras axis, angle, from, to (and fixed) that turn by `angle` about their own
#     origin as the part goes from from to to of its travel (models.js moves them from the part's own turn):
#       the main legs are parallelograms: an upper and a lower arm hinged on the hull side carry a vertical oleo leg.
#       The part turns the upper arm (and the locking strut on it) up 115° about its hull hinge; the leg counter-turns
#       (−115°) so it rises straight up into the slot in the hull side, the wheel ending against the hull side as on
#       the real aircraft; the lower arm turns with the upper one, so its hull end stays on its hinge.
#       The nose leg retracts rearward, 90° about its top, into the well under the cockpit; its two conformal doors
#       (hinged on the well's sides, meeting on the keel) close over it in the last 30% of the travel (fixed: they
#       stay on the airframe). The doors are rebuilt from the hull's own lines so they close flush, and
#       take the hull's texture mapping.
#   - materials carry no texture: extras share (an airframe material) and paint (0/1): models.js draws the part with
#     that airframe material (paint 1: the doors take the livery with the hull) or a copy of it that liveries skip.
# --check: load the finished airframe and confirm it has the size of the frame used here.
# ═══════════════════════════════════════════════════════════════
import bpy, bmesh, sys, os, math
import numpy as np
from mathutils import Vector, Matrix

argv = sys.argv[sys.argv.index('--') + 1:]
SRC, AIR_OUT, GEAR_OUT = argv[0], argv[1], argv[2]
CHECK = argv[argv.index('--check') + 1] if '--check' in argv else None

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=SRC)

def meshes():
    return [o for o in bpy.data.objects if o.type == 'MESH']

# ── bake every transform into the meshes (the source frame: metres, nose −X, Z up) ──
for o in meshes():
    mw = o.matrix_world.copy()
    o.parent = None
    o.data.transform(mw)
    o.matrix_world = Matrix.Identity(4)
for o in list(bpy.data.objects):
    if o.type != 'MESH':
        bpy.data.objects.remove(o)

# ── the instrument gauges and their glass: seven materials for detail nobody sees from outside ──
GAUGES = {'DefaultWhite_adf.png', 'DefaultWhite_ai.png', 'DefaultWhite_alt.png', 'DefaultWhite_asi.png',
          'DefaultWhite_tmp.png', 'DefaultWhite_vsi.png', 'transparent'}
for o in list(meshes()):
    if o.data.materials and all(m and m.name in GAUGES for m in o.data.materials):
        bpy.data.objects.remove(o)

# ── what each loose part is, from where it lies (source frame; the left side is −Y). By position only: the model's
#    objects are texture groups, not parts (the right leg's oleo is in another object than the left's) ──
def classify(obj, mn, mx):
    ay0, ay1 = sorted((abs(mn.y), abs(mx.y)))
    # nose gear: the leg and its twin wheels on the centreline, the doors hanging open beside them; the well itself
    # (its walls reach up to the roof at z −3.015) stays with the hull
    if -8.55 <= mn.x and mx.x <= -6.65 and -0.65 <= mn.y and mx.y <= 0.65 and -4.5 <= mn.z and mx.z <= -3.05:
        if ay0 >= 0.22:
            return 'nose_door_l' if mx.y < 0 else 'nose_door_r'
        return 'nose_leg'
    for side, s in (('l', -1), ('r', 1)):
        ylo, yhi = sorted((s * 1.0, s * 2.6))
        if -1.60 <= mn.x and mx.x <= -0.55 and ylo <= mn.y and mx.y <= yhi and -4.5 <= mn.z and mx.z <= -1.55:
            # the plate at the bottom of the gear slot stays on the hull
            if 1.32 <= ay0 and ay1 <= 1.55 and -3.95 <= mn.z and mx.z <= -3.41:
                return None
            # the upper arms and their hull hinge (from the hull side, above z −3.12) and the locking strut (reaching up
            # past z −2.5 toward its mount in the top of the slot)
            if ay1 <= 1.975 and mn.z >= -3.12 and (mx.z > -2.5 or (ay0 <= 1.1 and mx.z <= -2.66)):
                return 'main_%s_arm' % side
            # the lower arm (wishbone) and its hull hinge
            if ay0 <= 1.14 and mx.z <= -3.15:
                return 'main_%s_link' % side
            return 'main_%s_leg' % side              # oleo leg, collars, pins, axle, wheel
    # the static propeller blades (four flat paddles per engine, in the disc just behind the spinner)
    ay0, ay1 = sorted((abs(mn.y), abs(mx.y)))
    if -5.36 <= mn.x and mx.x <= -5.15 and 1.3 <= ay0 and ay1 <= 5.5 and -1.8 <= mn.z and mx.z <= 2.35:
        return 'blade'
    return None

def components(o):
    bm = bmesh.new(); bm.from_mesh(o.data)
    bm.verts.ensure_lookup_table(); bm.faces.ensure_lookup_table()
    parent = list(range(len(bm.verts)))
    def find(a):
        while parent[a] != a:
            parent[a] = parent[parent[a]]; a = parent[a]
        return a
    for e in bm.edges:
        a, b = find(e.verts[0].index), find(e.verts[1].index)
        if a != b: parent[a] = b
    comps = {}
    for f in bm.faces:
        comps.setdefault(find(f.verts[0].index), []).append(f.index)
    out = []
    for faces in comps.values():
        vs = {v.index for fi in faces for v in bm.faces[fi].verts}
        co = [bm.verts[i].co for i in vs]
        out.append((faces, Vector((min(c.x for c in co), min(c.y for c in co), min(c.z for c in co))),
                    Vector((max(c.x for c in co), max(c.y for c in co), max(c.z for c in co)))))
    bm.free()
    return out

def separate(o, faces, name):
    bpy.ops.object.select_all(action='DESELECT')
    bpy.context.view_layer.objects.active = o
    o.select_set(True)
    bpy.ops.object.mode_set(mode='EDIT')
    bpy.ops.mesh.select_mode(type='FACE')
    bpy.ops.mesh.select_all(action='DESELECT')
    bm = bmesh.from_edit_mesh(o.data)
    bm.faces.ensure_lookup_table()
    for i in faces:
        bm.faces[i].select_set(True)
    bmesh.update_edit_mesh(o.data)
    bpy.ops.mesh.separate(type='SELECTED')
    bpy.ops.object.mode_set(mode='OBJECT')
    new = [x for x in bpy.context.selected_objects if x != o][0]
    new.name = name
    return new

pieces = {}
for o in list(meshes()):
    while True:
        labs = {}
        for faces, mn, mx in components(o):
            lab = classify(o.name, mn, mx)
            if lab:
                labs.setdefault(lab, []).extend(faces)
        if not labs:
            break
        lab, faces = next(iter(labs.items()))
        pieces.setdefault(lab, []).append(separate(o, faces, lab + '|' + o.name))

def join(objs, name):
    bpy.ops.object.select_all(action='DESELECT')
    for x in objs:
        x.select_set(True)
    bpy.context.view_layer.objects.active = objs[0]
    if len(objs) > 1:
        bpy.ops.object.join()
    objs[0].name = name
    return objs[0]

parts = {lab: join(objs, lab) for lab, objs in pieces.items()}
ntri = lambda o: sum(len(p.vertices) - 2 for p in o.data.polygons)
for lab in sorted(parts):
    print('PIECE %-14s tris %5d' % (lab, ntri(parts[lab])))
for lab in ('nose_leg', 'nose_door_l', 'nose_door_r', 'main_l_arm', 'main_l_leg', 'main_l_link', 'main_r_arm', 'main_r_leg', 'main_r_link', 'blade'):
    assert lab in parts, 'missing ' + lab
bpy.data.objects.remove(parts.pop('blade'))

# ── meaningful material names (liveries skip seat / pilot / glass materials, and glass is drawn as glass) ──
RENAME = {'DefaultWhite': 'cl415_paint', 'DefaultWhite_interior.png': 'cabin_seats_interior',
          'DefaultWhite_panel.png': 'pilot_instrument_panel', 'transparent2': 'window_glass'}
for m in bpy.data.materials:
    if m.name in RENAME:
        m.name = RENAME[m.name]

gear = set(parts.values())
airframe = [o for o in meshes() if o not in gear]

# ── the frame import_model.py --nose -X gives the airframe: yaw −90° (nose −X → +Y), centred on its bbox ──
R = Matrix.Rotation(-math.pi / 2, 4, 'Z')
pts = [R @ v.co for o in airframe for v in o.data.vertices]
mn = Vector((min(p.x for p in pts), min(p.y for p in pts), min(p.z for p in pts)))
mx = Vector((max(p.x for p in pts), max(p.y for p in pts), max(p.z for p in pts)))
C = (mn + mx) / 2
F = Matrix.Translation(-C) @ R
print('AIRFRAME bbox (final frame) size', [round(v, 4) for v in (mx - mn)], 'centre', [round(v, 4) for v in C])
print('AIRFRAME tris', sum(ntri(o) for o in airframe))

# ── export the airframe in the source frame ──
bpy.ops.object.select_all(action='DESELECT')
for o in airframe:
    o.select_set(True)
os.makedirs(os.path.dirname(os.path.abspath(AIR_OUT)), exist_ok=True)
bpy.ops.export_scene.gltf(filepath=AIR_OUT, export_format='GLB', use_selection=True, export_apply=True, export_yup=True)
print('WROTE', AIR_OUT, os.path.getsize(AIR_OUT))

# ── the nose doors, rebuilt to close flush: each closed door is the strip of hull bottom between the well's side
#    (its hinge) and the keel. The well walls give that line at five stations (x, z of the edge at y = ±0.363) and the
#    keel's depth below it (0.263 m at the front wall, 0.218 m at the back). Every vertex of the modelled (open) door
#    keeps its place on the door — station along x, fraction across (u), depth into the plate (w) — and is put on
#    the closed strip, then the strip is opened 90° about the straight hinge through the edge's ends: that is the
#    angle helijah's doors hang at (31° from vertical at the back, 36° at the front). ──
EDGE = [(-8.49, -3.439), (-7.964, -3.602), (-7.616, -3.674), (-7.145, -3.732), (-6.7, -3.767)]
DROP = (0.263, 0.218)
# the modelled left door's outer skin: inner (hinge-side) and outer edge at each of its stations
DOOR_I = [(-8.506, -0.251, -3.569), (-7.968, -0.347, -3.629), (-7.615, -0.375, -3.669), (-7.144, -0.373, -3.722), (-6.701, -0.352, -3.772)]
DOOR_O = [(-8.514, -0.513, -3.933), (-7.979, -0.582, -3.993), (-7.627, -0.602, -4.033), (-7.157, -0.593, -4.086), (-6.714, -0.569, -4.136)]
WELL_Y = 0.363

def interp(table, x):   # table [(x, value...)] sorted by x → value at x (linear, clamped)
    if x <= table[0][0]: return table[0][1:]
    for a, b in zip(table, table[1:]):
        if x <= b[0]:
            t = (x - a[0]) / (b[0] - a[0])
            return tuple(a[i] + (b[i] - a[i]) * t for i in range(1, len(a)))
    return table[-1][1:]

def edge_pt(x, s):
    return Vector((x, s * WELL_Y, interp(EDGE, x)[0]))

def keel_pt(x):
    t = (x - EDGE[0][0]) / (EDGE[-1][0] - EDGE[0][0])
    return Vector((x, 0.0, interp(EDGE, x)[0] - (DROP[0] + (DROP[1] - DROP[0]) * t)))

def rotate_about(p, a, d, ang):
    return a + Matrix.Rotation(ang, 3, d) @ (p - a)

HINGE_A = [edge_pt(EDGE[0][0], s) for s in (-1, 1)]
HINGE_B = [edge_pt(EDGE[-1][0], s) for s in (-1, 1)]
DOOR_AXIS = {}

# the hull bottom beside the well is textured by a side projection (u from x, v from z): fitted on the airframe's own
# faces there, it gives the closed doors the hull's texture, so they stay one with it under any livery
def hull_uv_fit(s):
    rows = []
    for o in airframe:
        uvl = o.data.uv_layers.active
        for poly in o.data.polygons:
            c = poly.center
            if -8.8 <= c.x <= -6.4 and 0.2 <= c.y * s <= 0.9 and c.z <= -3.3 and poly.normal.z < -0.3:
                for li in poly.loop_indices:
                    p = o.data.vertices[o.data.loops[li].vertex_index].co
                    rows.append((p.x, p.z, uvl.data[li].uv.x, uvl.data[li].uv.y))
    R = np.array(rows)
    (bu, au), *_ = np.linalg.lstsq(np.c_[R[:, 0], np.ones(len(R))], R[:, 2], rcond=None)
    (bv, av), *_ = np.linalg.lstsq(np.c_[R[:, 1], np.ones(len(R))], R[:, 3], rcond=None)
    err = max(np.abs(au + bu * R[:, 0] - R[:, 2]).max(), np.abs(av + bv * R[:, 1] - R[:, 3]).max())
    print('HULL UV side %d: u = %.5f %+.5f x, v = %.5f %+.5f z over %d corners, max error %.4f' % (s, au, bu, av, bv, len(R), err))
    assert err < 0.01
    return lambda p: (au + bu * p.x, av + bv * p.z)
for side, s in (('l', -1), ('r', 1)):
    o = parts['nose_door_' + side]
    Itab = [(p[0], p[1] if s < 0 else -p[1], p[2]) for p in DOOR_I]   # (x, y, z): y, z at x
    Otab = [(p[0], p[1] if s < 0 else -p[1], p[2]) for p in DOOR_O]
    x0, x1 = min(v.co.x for v in o.data.vertices), max(v.co.x for v in o.data.vertices)
    a, b = HINGE_A[0 if s < 0 else 1], HINGE_B[0 if s < 0 else 1]
    d = (b - a).normalized() * (1 if s < 0 else -1)      # closing is +90° about d (left: toward the tail)
    DOOR_AXIS[side] = d
    uv_at = hull_uv_fit(s)
    closed_at = {}
    for v in o.data.vertices:
        p = v.co.copy()
        i = Vector((p.x, *interp(Itab, p.x))); q = Vector((p.x, *interp(Otab, p.x)))
        across = q - i
        u = (p - i).dot(across) / across.length_squared
        n_open = Vector((1, 0, 0)).cross(across).normalized()
        if n_open.y * -s < 0: n_open = -n_open            # toward the well (the plate's inner skin)
        w = (p - i - across * u).dot(n_open)
        xs = EDGE[0][0] + (p.x - x0) / (x1 - x0) * (EDGE[-1][0] - EDGE[0][0])
        e, k = edge_pt(xs, s), keel_pt(xs)
        de = (edge_pt(xs + 0.01, s) - edge_pt(xs - 0.01, s)).normalized()
        n_in = de.cross(k - e).normalized()
        if n_in.z < 0: n_in = -n_in                          # into the hull
        closed = e + (k - e) * u + n_in * w
        closed_at[v.index] = closed
        v.co = rotate_about(closed, a, d, -math.pi / 2)      # hanging open
    uvl = o.data.uv_layers.active
    for lp in o.data.loops:
        uvl.data[lp.index].uv = uv_at(closed_at[lp.vertex_index])
    if o.data.has_custom_normals:
        o.data.normals_split_custom_set([(0, 0, 0)] * len(o.data.loops))   # (recomputed from the new shape)
    for poly in o.data.polygons:
        poly.use_smooth = False

# ── gear in the final frame ──
for o in gear:
    o.data.transform(F)
Rf = F.to_3x3()
P = lambda v: F @ Vector(v)                  # a source-frame point in the final frame
gl = lambda v: [round(v[0], 5), round(v[2], 5), round(-v[1], 5)]   # Blender final → glTF file coordinates

def set_origin(o, q):
    o.data.transform(Matrix.Translation(-q))
    o.location = q

def empty(name, q):
    e = bpy.data.objects.new(name, None)
    bpy.context.collection.objects.link(e)
    e.location = q
    return e

def parent(child, par):
    bpy.context.view_layer.update()
    child.parent = par
    child.matrix_parent_inverse = par.matrix_world.inverted()

def contact(objs):
    vs = [o.matrix_world @ v.co for o in objs for v in o.data.vertices]
    zmin = min(v.z for v in vs)
    low = [v for v in vs if v.z < zmin + 0.02]
    return Vector(((min(v.x for v in low) + max(v.x for v in low)) / 2, (min(v.y for v in low) + max(v.y for v in low)) / 2, zmin))

# placeholder materials: the parts draw with the airframe's own material (see the header)
def placeholder(name, share, paint):
    m = bpy.data.materials.new(name)
    m['share'] = share
    m['paint'] = paint
    return m
MAT_GEAR = placeholder('cl415_gear', 'cl415_paint', 0)
MAT_DOOR = placeholder('cl415_gear_door', 'cl415_paint', 1)
for o in gear:
    mat = MAT_DOOR if 'door' in o.name else MAT_GEAR
    o.data.materials.clear()
    o.data.materials.append(mat)

report = {}
# nose: pivot on the top of the leg; retracts rearward (the wheels swing aft and up): +90° about −x
N0 = P((-8.2595, 0.0, -3.081))
nose = empty('gear_nose', N0)
leg = parts['nose_leg']; leg.name = 'gear_nose_leg'
bpy.context.view_layer.update()
nc = contact([leg])
set_origin(leg, N0)
parent(leg, nose)
nose['axis'] = gl(Vector((-1, 0, 0))); nose['angle'] = 90.0; nose['kind'] = 'nose'; nose['contact'] = gl(nc)
report['gear_nose'] = (N0, Vector((-1, 0, 0)), 90.0, nc)
for side, s in (('l', -1), ('r', 1)):
    door = parts['nose_door_' + side]; door.name = 'gear_nose_door_' + side
    h = P(tuple((HINGE_A[0 if s < 0 else 1] + HINGE_B[0 if s < 0 else 1]) / 2))
    set_origin(door, h)
    parent(door, nose)
    door['axis'] = gl((Rf @ DOOR_AXIS[side]).normalized()); door['angle'] = 90.0
    door['from'] = 0.7; door['to'] = 1.0; door['fixed'] = 1

# mains: the parallelogram (source frame, left side; the right mirrors y). Hull hinges of the upper and lower arms,
# and their pins on the leg: P1 (−1.0785, −2.688), A0 (−1.9455, −3.0925), P2 (−1.1185, −3.1905), B0 (−1.9855, −3.5945)
# (y, z): both arms 0.957 m long, 25° below level, parallel. Up 115° they stand vertical in the slot.
for side, s in (('l', -1), ('r', 1)):
    P1, A0, B0 = P((-1.12, s * 1.0785, -2.688)), P((-1.12, s * 1.9455, -3.0925)), P((-1.12, s * 1.9855, -3.5945))
    ax = Rf @ Vector((s * 1.0, 0, 0))            # left: the arm's outer end goes up turning +115° about −x (source)
    top = empty('gear_main_' + side, P1)
    arm, legm, link = parts['main_%s_arm' % side], parts['main_%s_leg' % side], parts['main_%s_link' % side]
    arm.name, legm.name, link.name = 'gear_main_%s_arm' % side, 'gear_main_%s_leg' % side, 'gear_main_%s_link' % side
    bpy.context.view_layer.update()
    mc = contact([legm])
    set_origin(arm, P1); set_origin(legm, A0); set_origin(link, B0)
    parent(arm, top); parent(legm, top); parent(link, legm)
    top['axis'] = gl(ax); top['angle'] = 115.0; top['kind'] = 'main'; top['contact'] = gl(mc)
    legm['axis'] = gl(ax); legm['angle'] = -115.0; legm['from'] = 0.0; legm['to'] = 1.0
    link['axis'] = gl(ax); link['angle'] = 115.0; link['from'] = 0.0; link['to'] = 1.0
    report['gear_main_' + side] = (P1, ax, 115.0, mc)

# check the arm's sense: turning A0 about P1 by +115° about ax must bring it straight above P1
for side, s in (('l', -1), ('r', 1)):
    P1, ax = report['gear_main_' + side][0], report['gear_main_' + side][1]
    A0 = P((-1.12, s * 1.9455, -3.0925))
    up = rotate_about(A0, P1, ax, math.radians(115.0)) - P1
    print('CHECK main_%s arm up: %s (want (0, 0, +0.957))' % (side, [round(v, 3) for v in up]))
    assert abs(up.x) < 0.01 and up.z > 0.9
# … and the nose wheels go aft (−y in Blender final) and up
wc = P((-8.26, 0, -4.2195))
w_up = rotate_about(wc, N0, Vector((-1, 0, 0)), math.radians(90.0)) - N0
print('CHECK nose wheel up: %s (want y < 0, z ≈ 0)' % [round(v, 3) for v in w_up])
assert w_up.y < -1.0 and abs(w_up.z) < 0.05

bpy.ops.object.select_all(action='DESELECT')
roots = [bpy.data.objects[n] for n in ('gear_nose', 'gear_main_l', 'gear_main_r')]
for r in roots:
    r.select_set(True)
    for c in r.children_recursive:
        c.select_set(True)
bpy.ops.export_scene.gltf(filepath=GEAR_OUT, export_format='GLB', use_selection=True, export_apply=True, export_yup=True,
                          export_extras=True, export_materials='EXPORT')
print('WROTE', GEAR_OUT, os.path.getsize(GEAR_OUT), 'gear tris', sum(ntri(o) for o in gear))
L = mx.y - mn.y
for name, (q, ax, ang, ct) in report.items():
    print('GEAR %-12s pivot %s axis %s angle %.0f contact %s (file) | contact in model space for L 19.82: %s' % (
        name, gl(q), gl(ax), ang, gl(ct), [round(v * 19.82 / L, 4) for v in gl(ct)]))

if CHECK:
    for o in list(bpy.data.objects):
        bpy.data.objects.remove(o)
    bpy.ops.import_scene.gltf(filepath=CHECK)
    vs = [o.matrix_world @ v.co for o in meshes() for v in o.data.vertices]
    a = Vector((min(v.x for v in vs), min(v.y for v in vs), min(v.z for v in vs)))
    b = Vector((max(v.x for v in vs), max(v.y for v in vs), max(v.z for v in vs)))
    err = max(abs(u - w) for u, w in zip(b - a, mx - mn))
    cen = ((a + b) / 2).length
    print('CHECK airframe %s: size %s vs frame %s, centre off %.4f → %s' % (CHECK, [round(v, 4) for v in (b - a)], [round(v, 4) for v in (mx - mn)], cen,
          'OK' if err < 0.002 and cen < 0.002 else 'MISMATCH'))
