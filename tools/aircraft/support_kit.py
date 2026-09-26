# ═══════════════════════════════════════════════════════════════
# SKYWAR support-aircraft kit (Blender, headless): derive a model from an imported one, add parts built with
# tools/aircraft_kit.py, and export the moving parts as separate named nodes (src/rigparts.js).
#
#   import support_kit as SK, aircraft_kit as K
#   SK.begin('e3', 46.61)                       # K.begin (scene reset + standard materials) with the name / length
#   air = SK.load(SRC, nose='+Y')                # import, bake transforms, nose → +Y (Blender), up +Z
#   SK.fit(air, length=46.61, nose_s=0.0)        # scale to metres, nose tip at s = 0, fuselage axis at z = 0
#   ... SK.delete_loose / stretch / paint / K.loft(...) ...
#   dome = SK.part('rotodome', objs, pivot=(s, x, z))   # a moving part: origin on its pivot
#   SK.export(OUT)                               # airframe joined per material family, parts kept as nodes
#
# Coordinates: the aircraft kit's (s = metres aft of the nose, x = right, z = up); Blender Y = -s. The glTF export
# turns Blender (x, y, z) into three.js (x, z, -y): nose toward -Z, up +Y (MODEL_FILES rot [0, 0, 0]).
# A part's axes: three.js +z (aft) is Blender -Y, three.js +y (up) is Blender +Z; a rotation about Blender X is
# the same rotation about three.js x (positive: an aft-pointing boom goes down).
# ═══════════════════════════════════════════════════════════════
import bpy, bmesh, math, os, re, sys, json
from mathutils import Vector, Matrix

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), '..'))
import aircraft_kit as K

PARTS = []      # moving-part objects (kept out of the airframe join)


def begin(name, length, **kw):
    K.begin(name, length, **kw)
    PARTS.clear()


def meshes(exclude_parts=True):
    return [o for o in bpy.data.objects if o.type == 'MESH' and not (exclude_parts and is_part(o))]


def is_part(o):
    while o is not None:
        if o in PARTS:
            return True
        o = o.parent
    return False


def bbox(objs=None):
    vs = [o.matrix_world @ v.co for o in (objs or meshes()) for v in o.data.vertices]
    mn = Vector((min(v.x for v in vs), min(v.y for v in vs), min(v.z for v in vs)))
    mx = Vector((max(v.x for v in vs), max(v.y for v in vs), max(v.z for v in vs)))
    return mn, mx


def tris(objs=None):
    return sum(len(p.vertices) - 2 for o in (objs or meshes(False)) for p in o.data.polygons)


# ───────────────────────── import ─────────────────────────
def load(src, nose='+Y', roll=0.0, pitch=0.0, weld_first=False, prefix='src_'):
    """Import a model, bake every transform / modifier into its meshes, drop non-mesh objects, turn the nose to +Y.
    Returns the imported mesh objects (named prefix + original name)."""
    before = set(bpy.data.objects)
    ext = os.path.splitext(src)[1].lower()
    if ext in ('.glb', '.gltf'):
        bpy.ops.import_scene.gltf(filepath=src)
    elif ext == '.obj':
        bpy.ops.wm.obj_import(filepath=src)
    elif ext == '.fbx':
        bpy.ops.import_scene.fbx(filepath=src)
    new = [o for o in bpy.data.objects if o not in before]
    dg = bpy.context.evaluated_depsgraph_get()
    out = []
    for o in new:
        if o.type != 'MESH':
            continue
        me = bpy.data.meshes.new_from_object(o.evaluated_get(dg), preserve_all_data_layers=True, depsgraph=dg)
        me.transform(o.matrix_world)
        n = bpy.data.objects.new(prefix + o.name, me)
        bpy.context.collection.objects.link(n)
        out.append(n)
    for o in new:
        bpy.data.objects.remove(o)
    yaw = {'+Y': 0, '-Y': math.pi, '+X': math.pi / 2, '-X': -math.pi / 2}[nose]
    R = Matrix.Rotation(yaw, 4, 'Z')
    if roll:
        R = Matrix.Rotation(math.radians(roll), 4, 'Y') @ R
    if pitch:
        R = Matrix.Rotation(math.radians(pitch), 4, 'X') @ R
    for o in out:
        o.data.transform(R)
    if weld_first:
        mn, mx = bbox(out)
        d0 = 1e-5 * (mx - mn).length
        for o in out:
            bm = bmesh.new(); bm.from_mesh(o.data)
            bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=d0)
            bm.to_mesh(o.data); bm.free()
    return out


def fit(objs, length, nose_s=0.0, axis_z=None, centre_x=True):
    """Scale uniformly so the bounding box is `length` long (Y), put the nose tip at s = nose_s (Y = -nose_s) and,
    with axis_z given (in the file's height fraction 0..1 after scaling, or None: keep), the fuselage axis at z = 0."""
    mn, mx = bbox(objs)
    k = length / (mx.y - mn.y)
    cx = (mn.x + mx.x) / 2 if centre_x else 0.0
    M = Matrix.Scale(k, 4)
    for o in objs:
        o.data.transform(Matrix.Translation(Vector((-cx, -mx.y, 0))))
        o.data.transform(M)
        o.data.transform(Matrix.Translation(Vector((0, -nose_s, 0))))
    return k


def shift(objs, ds=0.0, dx=0.0, dz=0.0):
    for o in objs:
        o.data.transform(Matrix.Translation(Vector((dx, -ds, dz))))


# ───────────────────────── editing ─────────────────────────
def by_name(rx, objs=None):
    r = re.compile(rx, re.I)
    return [o for o in (objs or meshes()) if r.search(o.name) or r.search(o.data.name) or any(m and r.search(m.name) for m in o.data.materials)]


def delete(objs):
    for o in list(objs):
        bpy.data.objects.remove(o)


def delete_faces(pred, objs=None):
    """Delete faces whose centre (Blender coords) satisfies pred(Vector) → count."""
    n = 0
    for o in objs or meshes():
        bm = bmesh.new(); bm.from_mesh(o.data)
        kill = [f for f in bm.faces if pred(o.matrix_world @ f.calc_center_median())]
        n += len(kill)
        if kill:
            bmesh.ops.delete(bm, geom=kill, context='FACES')
            bm.to_mesh(o.data)
        bm.free()
    return n


def delete_mat_faces(rx, objs=None):
    r = re.compile(rx, re.I)
    n = 0
    for o in objs or meshes():
        bad = {i for i, m in enumerate(o.data.materials) if m and r.search(m.name)}
        if not bad:
            continue
        bm = bmesh.new(); bm.from_mesh(o.data)
        kill = [f for f in bm.faces if f.material_index in bad]
        n += len(kill)
        bmesh.ops.delete(bm, geom=kill, context='FACES')
        bm.to_mesh(o.data); bm.free()
    return n


def loose_parts(o):
    """Connected components of a mesh object: list of (vertex index list, min, max) in world coords."""
    bm = bmesh.new(); bm.from_mesh(o.data)
    bm.verts.ensure_lookup_table()
    parent = list(range(len(bm.verts)))
    def find(a):
        while parent[a] != a:
            parent[a] = parent[parent[a]]; a = parent[a]
        return a
    for e in bm.edges:
        a, b = find(e.verts[0].index), find(e.verts[1].index)
        if a != b:
            parent[a] = b
    comps = {}
    for v in bm.verts:
        comps.setdefault(find(v.index), []).append(v.index)
    mw = o.matrix_world
    out = []
    for vs in comps.values():
        cs = [mw @ bm.verts[i].co for i in vs]
        out.append((vs, Vector((min(c.x for c in cs), min(c.y for c in cs), min(c.z for c in cs))),
                    Vector((max(c.x for c in cs), max(c.y for c in cs), max(c.z for c in cs)))))
    bm.free()
    return out


def delete_loose(pred, objs=None):
    """Delete loose parts for which pred(min, max, n_verts) (Blender coords) is true → (parts, tris)."""
    n_parts = n_tris = 0
    for o in objs or meshes():
        comps = loose_parts(o)
        kill = set()
        for vs, a, b in comps:
            if pred(a, b, len(vs)):
                kill.update(vs); n_parts += 1
        if kill:
            bm = bmesh.new(); bm.from_mesh(o.data)
            bm.verts.ensure_lookup_table()
            vv = [bm.verts[i] for i in kill]
            n_tris += sum(len(f.verts) - 2 for f in {f for v in vv for f in v.link_faces})
            bmesh.ops.delete(bm, geom=vv, context='VERTS')
            bm.to_mesh(o.data); bm.free()
    return n_parts, n_tris


def separate_loose(pred, name, objs=None):
    """Move the loose parts for which pred(min, max, n) is true into a new object `name` → object or None."""
    got = []
    for o in objs or meshes():
        comps = loose_parts(o)
        take = set()
        for vs, a, b in comps:
            if pred(a, b, len(vs)):
                take.update(vs)
        if not take:
            continue
        got.append(split_verts(o, take, name + '_tmp'))
    if not got:
        return None
    return join(got, name)


def separate_faces(pred, name, objs=None):
    """Move the faces whose centre satisfies pred(Vector) into a new object `name` → object or None."""
    got = []
    for o in objs or meshes():
        bm = bmesh.new(); bm.from_mesh(o.data)
        take = [f for f in bm.faces if pred(o.matrix_world @ f.calc_center_median())]
        bm.free()
        if not take:
            continue
        idx = {f.index for f in take}
        got.append(split_faces(o, idx, name + '_tmp'))
    if not got:
        return None
    return join(got, name)


def split_verts(o, vidx, name):
    bm = bmesh.new(); bm.from_mesh(o.data)
    bm.faces.ensure_lookup_table()
    fidx = {f.index for f in bm.faces if all(v.index in vidx for v in f.verts)}
    bm.free()
    return split_faces(o, fidx, name)


def split_faces(o, fidx, name):
    """Copy o, keep faces fidx in the copy and delete them from o."""
    me2 = o.data.copy()
    n = bpy.data.objects.new(name, me2)
    bpy.context.collection.objects.link(n)
    n.matrix_world = o.matrix_world.copy()
    bm = bmesh.new(); bm.from_mesh(me2)
    bmesh.ops.delete(bm, geom=[f for f in bm.faces if f.index not in fidx], context='FACES')
    bm.to_mesh(me2); bm.free()
    bm = bmesh.new(); bm.from_mesh(o.data)
    bm.faces.ensure_lookup_table()
    bmesh.ops.delete(bm, geom=[bm.faces[i] for i in fidx], context='FACES')
    bm.to_mesh(o.data); bm.free()
    return n


def slice_points(objs, x=None, s=None, z=None, pred=None):
    """Where the mesh edges cross the plane x = const, s = const or z = const (kit coordinates) → [Vector] (Blender
    coords), optionally filtered by pred(point)."""
    out = []
    for o in objs:
        mw = o.matrix_world
        co = [mw @ v.co for v in o.data.vertices]
        if x is not None:
            f = [c.x - x for c in co]
        elif s is not None:
            f = [-c.y - s for c in co]
        else:
            f = [c.z - z for c in co]
        for e in o.data.edges:
            a, b = e.vertices
            fa, fb = f[a], f[b]
            if (fa > 0) == (fb > 0) or fa == fb:
                continue
            t = fa / (fa - fb)
            p = co[a].lerp(co[b], t)
            if pred is None or pred(p):
                out.append(p)
    return out


def section(objs, x=None, s=None, z=None, pred=None):
    """Probe the geometry with a plane (see slice_points): x = const → (s_le, s_te, z_min, z_max) of a wing section;
    s = const → (x_min, x_max, z_min, z_max) of a fuselage section; z = const → (s_min, s_max, x_min, x_max)."""
    pts = slice_points(objs, x=x, s=s, z=z, pred=pred)
    if not pts:
        return None
    if x is not None:
        return (min(-p.y for p in pts), max(-p.y for p in pts), min(p.z for p in pts), max(p.z for p in pts))
    if s is not None:
        return (min(p.x for p in pts), max(p.x for p in pts), min(p.z for p in pts), max(p.z for p in pts))
    return (min(-p.y for p in pts), max(-p.y for p in pts), min(p.x for p in pts), max(p.x for p in pts))


def stretch(pred, delta, objs=None):
    """Move every vertex (Blender coords) for which pred(co) is true by delta: a Vector, or a function co → Vector
    (a fuselage plug: everything ahead of a station moves forward; an outer wing panel: a spanwise stretch)."""
    n = 0
    for o in objs or meshes():
        mw = o.matrix_world; inv = mw.inverted()
        for v in o.data.vertices:
            w = mw @ v.co
            if pred(w):
                d = delta(w) if callable(delta) else delta
                v.co = inv @ (w + d); n += 1
        o.data.update()
    return n


def weld(objs=None, angle=35, dist=None):
    for o in objs or meshes():
        mn, mx = bbox([o])
        d = dist if dist is not None else 1e-5 * max((mx - mn).length, 1e-3)
        bm = bmesh.new(); bm.from_mesh(o.data)
        bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=d)
        for f in bm.faces:
            f.smooth = True
        for e in bm.edges:
            e.smooth = not (len(e.link_faces) != 2 or e.calc_face_angle(0) > math.radians(angle))
        bm.to_mesh(o.data); bm.free()
        if o.data.has_custom_normals:
            bpy.context.view_layer.objects.active = o
            bpy.ops.mesh.customdata_custom_splitnormals_clear()


def decimate(ratio, objs=None, sym=False, min_tris=0):
    for o in objs or meshes():
        if tris([o]) < min_tris:
            continue
        md = o.modifiers.new('dec', 'DECIMATE')
        md.ratio = ratio
        if sym:
            md.use_symmetry = True; md.symmetry_axis = 'X'
        bpy.context.view_layer.objects.active = o
        bpy.ops.object.modifier_apply(modifier=md.name)


def join(objs, name):
    objs = [o for o in objs if o is not None]
    if not objs:
        return None
    bpy.ops.object.select_all(action='DESELECT')
    for o in objs:
        o.select_set(True)
    bpy.context.view_layer.objects.active = objs[0]
    if len(objs) > 1:
        bpy.ops.object.join()
    ob = bpy.context.view_layer.objects.active
    ob.name = name
    ob.data.name = name
    return ob


def set_material(objs, mat_name):
    m = K.mat(mat_name) if isinstance(mat_name, str) else mat_name
    for o in objs:
        o.data.materials.clear()
        o.data.materials.append(m)


def replace_material(rx, mat_name, objs=None):
    """Swap every material slot whose name matches rx for a kit material (paint over a livery, a dark radome...)."""
    r = re.compile(rx, re.I)
    m = K.mat(mat_name) if isinstance(mat_name, str) else mat_name
    for o in objs or meshes(False):
        for i, s in enumerate(o.data.materials):
            if s and r.search(s.name):
                o.data.materials[i] = m


def mono(hex_color, mat_rx=None, sat_lim=0.22, objs=None, keep_dark=True):
    """Repaint the base-colour textures of matching materials in one colour, keeping shading and panel lines
    (import_model.py --mono): saturated colours (markings) become paint."""
    import numpy as np
    h = int(hex_color.lstrip('#'), 16)
    paint = np.array([((h >> 16) & 255) / 255, ((h >> 8) & 255) / 255, (h & 255) / 255], np.float32)
    seen = set()
    for m in bpy.data.materials:
        if not m.use_nodes or (mat_rx and not re.search(mat_rx, m.name)):
            continue
        b = m.node_tree.nodes.get('Principled BSDF')
        if not b or not b.inputs['Base Color'].links:
            continue
        n = b.inputs['Base Color'].links[0].from_node
        if n.type != 'TEX_IMAGE' or not n.image or n.image.name in seen:
            continue
        seen.add(n.image.name)
        im = n.image
        px = np.empty(im.size[0] * im.size[1] * 4, np.float32)
        im.pixels.foreach_get(px)
        px = px.reshape(-1, 4)
        rgb = px[:, :3]
        mx_, mn_ = rgb.max(1), rgb.min(1)
        sat = (mx_ - mn_) / np.maximum(mx_, 1e-4)
        lum = rgb @ np.array([0.3, 0.59, 0.11], np.float32)
        white = np.percentile(lum, 90)
        v = np.where((sat > sat_lim) & (lum > 0.08), 1.0, np.clip(lum / max(white, 1e-3), 0, 1.05))
        px[:, :3] = paint[None, :] * v[:, None]
        im.pixels.foreach_set(px.ravel())
        im.pack()


def shrink_textures(n=1024):
    for im in bpy.data.images:
        if im.size[0] > n or im.size[1] > n:
            s = n / max(im.size)
            im.scale(max(1, int(im.size[0] * s)), max(1, int(im.size[1] * s)))


# ───────────────────────── moving parts ─────────────────────────
def part(name, objs, pivot, rot=(0.0, 0.0, 0.0), props=None, parent=None):
    """Join objs into a moving part `name` whose origin is the pivot (s, x, z) and whose rotation is rot (degrees
    about Blender X, Y, Z, e.g. a boom's stowed pitch about X). The geometry keeps its place. props: custom
    properties (exported as glTF extras → three.js userData). parent: a part it rides on."""
    ob = join(objs, name) if isinstance(objs, (list, tuple)) else objs
    if ob is None:  # an empty
        ob = bpy.data.objects.new(name, None)
        ob.empty_display_size = 0.3
        bpy.context.collection.objects.link(ob)
    else:
        ob.name = name
    s, x, z = pivot
    P = Vector((x, K.Y(s), z))
    R = Matrix.Rotation(math.radians(rot[2]), 4, 'Z') @ Matrix.Rotation(math.radians(rot[1]), 4, 'Y') @ Matrix.Rotation(math.radians(rot[0]), 4, 'X')
    if ob.type == 'MESH':
        # geometry in world space now → into the part's frame (origin P, rotated by R)
        ob.data.transform(ob.matrix_world)
        ob.matrix_world = Matrix.Identity(4)
        ob.data.transform((Matrix.Translation(P) @ R).inverted())
    ob.matrix_world = Matrix.Translation(P) @ R
    for k, v in (props or {}).items():
        ob[k] = v
    if parent is not None:
        mw = ob.matrix_world.copy()
        ob.parent = parent
        ob.matrix_world = mw
    else:
        PARTS.append(ob)
    return ob


def empty(name, at, parent=None, props=None):
    """An empty (a named point: boom_nozzle, basket coupling) at (s, x, z), riding on `parent`."""
    return part(name, None, at, props=props, parent=parent)


# ───────────────────────── finishing ─────────────────────────
def finish(out, shade_angle=34, uv_scale=8.0, img='JPEG', quality=82, join_airframe=True):
    """Shade and box-UV the kit-built objects (the imported ones keep their UVs and normals), join the airframe into
    one mesh (materials kept), export GLB with the moving parts as nodes. Returns the airframe object."""
    alive = {o.name: o for o in bpy.data.objects}
    for ob in K.STATE['objects']:
        try:
            name = ob.name
        except ReferenceError:   # joined into another object or deleted
            continue
        if alive.get(name) is ob and ob.type == 'MESH' and not ob.get('keep_uv'):
            K._shade(ob, shade_angle)
            K._box_uv(ob, uv_scale)
    air = None
    if join_airframe:
        air = join(meshes(True), K.STATE['name'])
    total = tris(meshes(False))
    mn, mx = bbox(meshes(False))
    print('BBOX length %.3f span %.3f height %.3f' % (mx.y - mn.y, mx.x - mn.x, mx.z - mn.z))
    print('TRIS', total, '(parts:', ', '.join('%s %d' % (p.name, tris([c for c in [p] + list(p.children_recursive) if c.type == 'MESH'])) for p in PARTS), ')')
    os.makedirs(os.path.dirname(os.path.abspath(out)), exist_ok=True)
    bpy.ops.export_scene.gltf(filepath=out, export_format='GLB', export_apply=True, export_yup=True, export_extras=True,
                              export_image_format=img, export_jpeg_quality=quality, export_texcoords=True,
                              export_normals=True, export_materials='EXPORT')
    K._patch_glb(out)
    print('WROTE', out, os.path.getsize(out))
    return air


def frac(s, x, z):
    """Model-space fractions (three.js x, y, z / L, relative to the bbox centre) of a kit point (s, x, z) — for
    MODEL_FILES nozzles / props / cockpit / refuel entries. L is the file's own bbox length: the game scales that
    to spec.length, so a fraction times spec.length lands on the same spot."""
    mn, mx = bbox(meshes(False))
    L = mx.y - mn.y
    cs, cz = -(mn.y + mx.y) / 2, (mn.z + mx.z) / 2
    return [round(x / L, 4), round((z - cz) / L, 4), round((s - cs) / L, 4)]
