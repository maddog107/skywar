# ═══════════════════════════════════════════════════════════════
# Cut a cockpit out of a downloaded aircraft (or cockpit) model for SKYWAR's cockpit view (Blender, headless).
#   blender -b -P tools/cockpits/import_cockpit.py -- SRC.glb OUT.glb --box x0,x1,y0,y1,z0,z1 --eye x,y,z --upm U
#       [--screens MAT] [--hud MAT] [--glass MAT] [--drop REGEX] [--list]
# Coordinates are the file's as Blender imports it (Z up; the nose along +Y).
#   --box     keep the meshes whose bounding-box centre is inside it (the cockpit; the rest of the airframe goes)
#   --eye     the pilot's design eye point: it becomes the origin (cockpit.js puts the camera there)
#   --upm     file units per metre (the output is in metres)
#   --screens the material of the blank display faces: each loose quad becomes its own SCREEN_<n> object, UV-mapped
#             0..1 across it (u to the right, v up as the pilot sees it), numbered top to bottom then left to right,
#             for cockpit.js to put its live displays on
#   --hud     the HUD combiner's material: HUD_GLASS (the game draws its glass and fits the HUD symbology to it)
#   --glass   the canopy's material: CANOPY_GLASS (the game's glass shader replaces it)
#   --drop    delete objects whose (object or material) name matches
#   --list    print what is kept, per material
# Everything else is joined by material (one draw call each). The nose ends up along -Z in three.js (+Y here).
# ═══════════════════════════════════════════════════════════════
import bpy, bmesh, sys, re
from mathutils import Vector, Matrix

argv = sys.argv[sys.argv.index('--') + 1:]
SRC, OUT = argv[0], argv[1]
opts = argv[2:]
def opt(name, default=None):
    return opts[opts.index(name) + 1] if name in opts else default
def vec(s):
    return [float(v) for v in s.split(',')]

box = vec(opt('--box'))
eye = Vector(vec(opt('--eye')))
upm = float(opt('--upm', '1'))
mat_screen, mat_hud, mat_glass, drop = opt('--screens'), opt('--hud'), opt('--glass'), opt('--drop')

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=SRC)
scene = bpy.context.scene

def mats_of(o):
    return [m.name for m in o.data.materials if m]

# 1. keep the cockpit
for o in list(scene.objects):
    if o.type != 'MESH':
        continue
    ws = [o.matrix_world @ Vector(c) for c in o.bound_box]
    c = sum(ws, Vector()) / 8
    inside = box[0] < c.x < box[1] and box[2] < c.y < box[3] and box[4] < c.z < box[5]
    dropped = drop and (re.search(drop, o.name) or any(re.search(drop, m) for m in mats_of(o)))
    if not inside or dropped:
        bpy.data.objects.remove(o)
for o in list(scene.objects):
    if o.type != 'MESH':
        bpy.data.objects.remove(o)

# 2. bake every transform in, the eye to the origin, metres
M = Matrix.Scale(1 / upm, 4) @ Matrix.Translation(-eye)
for o in scene.objects:
    o.data = o.data.copy()
    o.data.transform(M @ o.matrix_world)
    o.matrix_world = Matrix.Identity(4)
    for p in o.data.polygons:
        p.use_smooth = p.use_smooth

def objects_with(mat):
    return [o for o in scene.objects if mat and mat in mats_of(o)]

def join(objs, name):
    if not objs:
        return None
    bpy.ops.object.select_all(action='DESELECT')
    for o in objs:
        o.select_set(True)
    bpy.context.view_layer.objects.active = objs[0]
    if len(objs) > 1:
        bpy.ops.object.join()
    o = bpy.context.view_layer.objects.active
    o.name = o.data.name = name
    return o

# 3. the screens: one object per loose quad, UV 0..1 across it as the pilot sees it
screens = []
for o in objects_with(mat_screen):
    bm = bmesh.new(); bm.from_mesh(o.data)
    bm.faces.ensure_lookup_table()
    seen = set()
    for f in bm.faces:
        if f.index in seen:
            continue
        # the loose part this face is in
        part, stack = set(), [f]
        while stack:
            g = stack.pop()
            if g.index in part:
                continue
            part.add(g.index)
            for e in g.edges:
                for h in e.link_faces:
                    if h.index not in part:
                        stack.append(h)
        seen |= part
        faces = [bm.faces[i] for i in part]
        verts = {v for g in faces for v in g.verts}
        cen = sum((v.co for v in verts), Vector()) / len(verts)
        nrm = sum((g.normal * g.calc_area() for g in faces), Vector()).normalized()
        if nrm.dot(-cen) < 0:
            nrm = -nrm  # (facing the eye)
        # screen axes: u to the pilot's right (+X projected onto the face), v up the face
        u = (Vector((1, 0, 0)) - nrm * nrm.x).normalized()
        v = nrm.cross(u).normalized()
        if v.z < 0:
            v = -v
        us = [(p.co - cen).dot(u) for p in verts]; vs = [(p.co - cen).dot(v) for p in verts]
        u0, u1, v0, v1 = min(us), max(us), min(vs), max(vs)
        nb = bmesh.new()
        vmap = {p: nb.verts.new(p.co) for p in verts}
        uvl = nb.loops.layers.uv.new('UVMap')
        for g in faces:
            nf = nb.faces.new([vmap[p] for p in g.verts])
            for l in nf.loops:
                d = l.vert.co - cen
                l[uvl].uv = ((d.dot(u) - u0) / max(u1 - u0, 1e-6), (d.dot(v) - v0) / max(v1 - v0, 1e-6))
        me = bpy.data.meshes.new('screen')
        nb.to_mesh(me); nb.free()
        me.materials.append(bpy.data.materials[mat_screen])
        so = bpy.data.objects.new('screen', me)
        scene.collection.objects.link(so)
        screens.append((cen, so, (u1 - u0, v1 - v0)))
    bm.free()
    # (the screen faces leave the object they came in; anything else in it stays)
    keep = [i for i, m in enumerate(o.data.materials) if m and m.name != mat_screen]
    bm = bmesh.new(); bm.from_mesh(o.data)
    bmesh.ops.delete(bm, geom=[f for f in bm.faces if o.data.materials[f.material_index].name == mat_screen], context='FACES')
    bm.to_mesh(o.data); bm.free()
    if not o.data.polygons:
        bpy.data.objects.remove(o)
# top to bottom (rows ~6 cm apart), then left to right
screens.sort(key=lambda s: (-round(s[0].z / 0.06), s[0].x))
for i, (cen, so, size) in enumerate(screens):
    so.name = so.data.name = 'SCREEN_%d' % i
    print('SCREEN_%d centre %s size %.3f x %.3f m' % (i, tuple(round(c, 3) for c in cen), size[0], size[1]))

hud = join(objects_with(mat_hud), 'HUD_GLASS')
glass = join(objects_with(mat_glass), 'CANOPY_GLASS')
special = {s[1].name for s in screens} | {o.name for o in (hud, glass) if o}

# 4. the rest joined by material
by_mat = {}
for o in list(scene.objects):
    if o.name in special:
        continue
    ms = mats_of(o)
    by_mat.setdefault(ms[0] if len(ms) == 1 else '+'.join(sorted(set(ms))), []).append(o)
for k, objs in by_mat.items():
    o = join(objs, 'part_' + re.sub(r'[^A-Za-z0-9]+', '_', k)[:40])
    if '--list' in opts:
        print('PART', o.name, sum(len(p.vertices) - 2 for p in o.data.polygons), 'tris')

tris = sum(sum(len(p.vertices) - 2 for p in o.data.polygons) for o in scene.objects)
print('objects', len(scene.objects), 'triangles', tris)
bpy.ops.export_scene.gltf(filepath=OUT, export_format='GLB', export_apply=True, export_yup=True,
                          export_image_format='AUTO', export_jpeg_quality=85)
