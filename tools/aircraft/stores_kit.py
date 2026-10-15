# ═══════════════════════════════════════════════════════════════
# Stores (missiles, launchers, pylons, tanks) built in Blender to add to an imported airframe
# (tools/aircraft/import_model.py --add STORES.glb). A spec script imports this module, builds its parts in the
# frame of the model it goes on (Blender axes: nose toward +Y, x to the right wing, Z up, metres; the frame of the
# file import_model.py is given as SRC) and calls export(path).
#   blender -b -P tools/aircraft/<id>_stores.py -- OUT.glb
# Real dimensions: AIM-9L/M Sidewinder 2.87 m long, 127 mm body, 0.64 m across the canards and the wings (with
# rollerons), the warhead band yellow and the motor band brown on live rounds.
# ═══════════════════════════════════════════════════════════════
import bpy, bmesh, math, os, sys
from mathutils import Vector, Matrix

MATS = {}


def srgb(h):
    h = int(h.lstrip('#'), 16)
    c = [((h >> 16) & 255) / 255, ((h >> 8) & 255) / 255, (h & 255) / 255]
    return tuple(x / 12.92 if x <= 0.04045 else ((x + 0.055) / 1.055) ** 2.4 for x in c)


def material(name, colour, metal=0.1, rough=0.5):
    if name in MATS:
        return MATS[name]
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    b = m.node_tree.nodes['Principled BSDF']
    b.inputs['Base Color'].default_value = (*srgb(colour), 1)
    b.inputs['Metallic'].default_value = metal
    b.inputs['Roughness'].default_value = rough
    m.diffuse_color = (*srgb(colour), 1)
    MATS[name] = m
    return m


def begin():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    MATS.clear()
    material('Store', '#c9cac4')            # missile body: light grey
    material('StoreBand', '#c9a227')        # warhead band (live round)
    material('StoreMotor', '#6b4a2a')       # rocket motor band
    material('Seeker', '#2a2e33', 0.4, 0.2)  # IR dome
    material('Launcher', '#8c8f8c', 0.2, 0.55)
    material('Pylon', '#7d817c', 0.15, 0.55)


def _obj(name, bm, mats):
    me = bpy.data.meshes.new(name)
    bm.normal_update()
    bm.to_mesh(me)
    bm.free()
    ob = bpy.data.objects.new(name, me)
    bpy.context.collection.objects.link(ob)
    for m in mats:
        me.materials.append(MATS[m])
    for p in me.polygons:
        p.use_smooth = True
    return ob


def _frame(nose, axis=(0, -1, 0), roll=0.0):
    """matrix: local x across, local y along the store (from the nose aft = +y local), local z up"""
    a = Vector(axis).normalized()
    up = Vector((0, 0, 1))
    x = a.cross(up).normalized() if abs(a.dot(up)) < 0.99 else Vector((1, 0, 0))
    z = x.cross(a).normalized()
    R = Matrix((x, a, z)).transposed().to_4x4()
    return Matrix.Translation(Vector(nose)) @ R @ Matrix.Rotation(roll, 4, 'Y')


def revolve(name, profile, M, mat, ring=16, mat_ranges=None):
    """a body of revolution: profile [(t along, r), ...] from the nose aft; mat_ranges [(t0, t1, mat)] paint bands"""
    bm = bmesh.new()
    rings = []
    for t, r in profile:
        if r <= 1e-5:
            rings.append([bm.verts.new(M @ Vector((0, t, 0)))])
        else:
            rings.append([bm.verts.new(M @ Vector((r * math.cos(2 * math.pi * k / ring), t, r * math.sin(2 * math.pi * k / ring)))) for k in range(ring)])
    names = [mat] + [m for _, _, m in (mat_ranges or []) if m != mat]
    names = list(dict.fromkeys(names))
    for i in range(len(rings) - 1):
        a, b = rings[i], rings[i + 1]
        tmid = (profile[i][0] + profile[i + 1][0]) / 2
        mi = 0
        for t0, t1, m in mat_ranges or []:
            if t0 <= tmid <= t1:
                mi = names.index(m)
        if len(a) == 1 and len(b) > 1:
            fs = [bm.faces.new((a[0], b[(k + 1) % ring], b[k])) for k in range(ring)]
        elif len(b) == 1 and len(a) > 1:
            fs = [bm.faces.new((a[k], a[(k + 1) % ring], b[0])) for k in range(ring)]
        else:
            fs = [bm.faces.new((a[k], a[(k + 1) % ring], b[(k + 1) % ring], b[k])) for k in range(ring)]
        for f in fs:
            f.material_index = mi
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    return _obj(name, bm, names)


def fin(name, M, root0, root1, tip0, tip1, r_root, span, t=0.006, mat='Store', angles=(45, 135, 225, 315)):
    """cruciform fins: root chord root0..root1 (along), tip chord tip0..tip1 at radius r_root + span"""
    bm = bmesh.new()
    for ang in angles:
        a = math.radians(ang)
        d = Vector((math.cos(a), 0, math.sin(a))); n = Vector((-math.sin(a), 0, math.cos(a)))
        pts = [(root0, r_root), (root1, r_root), (tip1, r_root + span), (tip0, r_root + span)]
        top = [bm.verts.new(M @ (Vector((0, s, 0)) + d * r + n * t / 2)) for s, r in pts]
        bot = [bm.verts.new(M @ (Vector((0, s, 0)) + d * r - n * t / 2)) for s, r in pts]
        bm.faces.new(top); bm.faces.new(list(reversed(bot)))
        for k in range(4):
            bm.faces.new((top[k], bot[k], bot[(k + 1) % 4], top[(k + 1) % 4]))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    ob = _obj(name, bm, [mat])
    for p in ob.data.polygons:
        p.use_smooth = False
    return ob


def aim9(name, nose, axis=(0, -1, 0), roll=0.0):
    """AIM-9L/M Sidewinder, nose at `nose`, pointing against `axis` (default: nose forward, +Y)"""
    M = _frame(nose, axis, roll)
    R = 0.0635
    prof = [(0, 0), (0.012, 0.035), (0.03, 0.052), (0.055, 0.061), (0.08, R), (0.64, R), (0.74, R), (1.08, R), (1.16, R), (2.80, R), (2.84, 0.055), (2.87, 0.045), (2.87, 0)]
    body = revolve(name + 'Body', prof, M, 'Store', ring=16, mat_ranges=[(0.0, 0.08, 'Seeker'), (0.64, 0.74, 'StoreBand'), (1.08, 1.16, 'StoreMotor')])
    canard = fin(name + 'Canards', M, 0.33, 0.60, 0.50, 0.58, R, 0.255, t=0.008)
    wings = fin(name + 'Wings', M, 2.42, 2.86, 2.66, 2.84, R, 0.255, t=0.008)
    # rollerons: small wheels at the wing tips' trailing corners
    bm = bmesh.new()
    for ang in (45, 135, 225, 315):
        a = math.radians(ang)
        d = Vector((math.cos(a), 0, math.sin(a)))
        c = Vector((0, 2.80, 0)) + d * (R + 0.245)
        res = bmesh.ops.create_cone(bm, cap_ends=True, segments=10, radius1=0.045, radius2=0.045, depth=0.012,
                                    matrix=M @ Matrix.Translation(c) @ Matrix.Rotation(a + math.pi / 2, 4, 'Y'))
    rol = _obj(name + 'Rollerons', bm, ['Launcher'])
    return [body, canard, wings, rol]


def box(name, lo, hi, mat='Launcher', bevel=0.0):
    bm = bmesh.new()
    vs = [bm.verts.new((x, y, z)) for x in (lo[0], hi[0]) for y in (lo[1], hi[1]) for z in (lo[2], hi[2])]
    for q in ((0, 1, 3, 2), (4, 6, 7, 5), (0, 4, 5, 1), (2, 3, 7, 6), (0, 2, 6, 4), (1, 5, 7, 3)):
        bm.faces.new([vs[i] for i in q])
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    if bevel:
        bmesh.ops.bevel(bm, geom=list(bm.edges), offset=bevel, segments=1, affect='EDGES')
    ob = _obj(name, bm, [mat])
    for p in ob.data.polygons:
        p.use_smooth = False
    return ob


def blade(name, x, y_front, y_back, z_root, z_top, t=0.07, sweep_top=0.0, mat='Pylon', taper=0.85):
    """a streamlined pylon blade standing on the skin (z_root) up to z_top, chord y_front..y_back (+Y forward):
    a lens section (pointed leading and trailing edges); the top chord is shortened by `taper` and shifted aft
    by sweep_top"""
    bm = bmesh.new()
    rings = []
    N = 8
    for z, f0, f1 in ((z_root, y_front, y_back), (z_top, y_front - sweep_top, y_front - sweep_top - (y_front - y_back) * taper)):
        ring = []
        for k in range(2 * N):
            u = k / N if k < N else 2 - k / N           # 0 → 1 → 0 round the section
            y = f0 + (f1 - f0) * u
            half = t / 2 * math.sin(math.pi * u) ** 0.7
            side = 1 if k < N else -1
            ring.append(bm.verts.new((x + side * half, y, z)))
        rings.append(ring)
    n = 2 * N
    for k in range(n):
        bm.faces.new((rings[0][k], rings[0][(k + 1) % n], rings[1][(k + 1) % n], rings[1][k]))
    bm.faces.new(rings[1]); bm.faces.new(list(reversed(rings[0])))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    return _obj(name, bm, [mat])


def scale(objs, s, origin):
    """scale parts built in metres to a model in other units, about `origin`"""
    M = Matrix.Translation(Vector(origin)) @ Matrix.Scale(s, 4) @ Matrix.Translation(-Vector(origin))
    for o in objs:
        o.data.transform(M)
    return objs


def mirror_x(objs, x0=0.0):
    """copies of the objects mirrored to the other side about the plane x = x0"""
    out = []
    for o in objs:
        me = o.data.copy()
        me.transform(Matrix.Translation((x0, 0, 0)) @ Matrix.Scale(-1, 4, Vector((1, 0, 0))) @ Matrix.Translation((-x0, 0, 0)))
        me.flip_normals()
        n = bpy.data.objects.new(o.name + '_L', me)
        bpy.context.collection.objects.link(n)
        out.append(n)
    return out


def export(out):
    os.makedirs(os.path.dirname(os.path.abspath(out)), exist_ok=True)
    bpy.ops.export_scene.gltf(filepath=out, export_format='GLB', export_apply=True, export_yup=True)
    tris = sum(len(p.vertices) - 2 for o in bpy.data.objects if o.type == 'MESH' for p in o.data.polygons)
    print('STORES', out, 'tris', tris)
