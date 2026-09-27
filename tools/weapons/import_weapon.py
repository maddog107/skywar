# ═══════════════════════════════════════════════════════════════
# Import + clean a downloaded weapon model for SKYWAR's on-foot arsenal (Blender, headless).
#   blender -b -P tools/weapons/import_weapon.py -- tools/weapons/specs/<id>.json preview OUT_DIR
#   blender -b -P tools/weapons/import_weapon.py -- tools/weapons/specs/<id>.json export models/weapons/<id>.glb
#
# The spec (JSON) says what to keep and how the weapon sits:
#   src        the downloaded GLB (Objaverse mirror of the Sketchfab model, see models/weapons/CREDITS.md)
#   delete     regex: objects (object / mesh / material names) to drop (loose rounds, bayonets, display stands)
#   deleteBox  [[x0,y0,z0,x1,y1,z1], ...]: drop loose parts wholly inside these boxes (butt frame, metres)
#   forward/up the source axes ('+X', '-Y', ...) the muzzle and the top of the weapon point along
#   fix        [rx, ry, rz] extra rotation in degrees after that (models exported slightly skewed)
#   length     real overall length (m) of the parts matching `lengthOf` (default: everything kept)
#   parts      { name: regex }: objects joined into named, separately movable parts (the rest is 'body')
#   split      { name: [x0,y0,z0,x1,y1,z1] }: loose pieces of the body wholly inside a box become that part
#   pivots     { part: [y, z] }: the part's origin (butt frame; x = 0), e.g. the top of a magazine
#   points     { name: [x, y, z] }: empties (butt frame): grip (right hand; becomes the origin), support
#              (left hand), muzzle, eject, sight (the eye point when aiming), ...
#   root       parts exported at the root, outside LOD0 (e.g. the RPG's in-flight rocket)
#   lod1       triangle budget of the merged, decimated LOD1 (the weapon in a soldier's hands at range)
#   tex        max texture size (default 1024)
# "Butt frame": after orienting and scaling, y runs forward from the rearmost point (the butt), z up from the
# lowest point, x is centred. The preview renders the right side with a centimetre grid in that frame.
# Output: nose toward three.js -Z, +Y up, metres, origin at the grip. Nodes: lod0 (parts + empties), lod1,
# and any root parts.
# ═══════════════════════════════════════════════════════════════
import bpy, bmesh, sys, os, re, json, math
from mathutils import Vector, Matrix

argv = sys.argv[sys.argv.index('--') + 1:]
SPEC_PATH, MODE, OUT = argv[0], argv[1], argv[2]
spec = json.load(open(SPEC_PATH))
here = os.path.dirname(os.path.abspath(SPEC_PATH))
src = spec['src'] if os.path.isabs(spec['src']) else os.path.join(os.environ.get('WEAPON_SRC', here), spec['src'])

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=src)

def meshes():
    return [o for o in bpy.data.objects if o.type == 'MESH']

# ── bake world transforms into the meshes, drop everything else ──
dg = bpy.context.evaluated_depsgraph_get()
for o in list(bpy.data.objects):
    if o.type != 'MESH':
        continue
    me = bpy.data.meshes.new_from_object(o.evaluated_get(dg), preserve_all_data_layers=True, depsgraph=dg)
    me.transform(o.matrix_world)
    n = bpy.data.objects.new(o.name, me)
    bpy.context.collection.objects.link(n)
    bpy.data.objects.remove(o)
for o in list(bpy.data.objects):
    if o.type != 'MESH':
        bpy.data.objects.remove(o)
for me in list(bpy.data.meshes):
    if me.users == 0: bpy.data.meshes.remove(me)

# ── vertex colours: weapons don't use them, and stray (black) COLOR_0 layers darken the textures (Blender's
# importer, and three.js's GLTFLoader, multiply them in); the importer's ".001" material variants made for
# them fold back into the original material ──
for o in meshes():
    ca = o.data.color_attributes
    while len(ca): ca.remove(ca[0])
    for i, m in enumerate(o.data.materials):
        base = re.sub(r'\.\d{3}$', '', m.name) if m else None
        if m and base != m.name and base in bpy.data.materials:
            o.data.materials[i] = bpy.data.materials[base]
for m in list(bpy.data.materials):
    if m.users == 0: bpy.data.materials.remove(m)

# ── delete unwanted objects ──
if spec.get('delete'):
    rx = re.compile(spec['delete'], re.I)
    for o in meshes():
        names = [o.name, o.data.name] + [m.name for m in o.data.materials if m]
        if any(rx.search(n) for n in names):
            bpy.data.objects.remove(o)

# ── orient: muzzle → Blender +Y (three.js -Z), top → +Z ──
AX = {'+X': Vector((1, 0, 0)), '-X': Vector((-1, 0, 0)), '+Y': Vector((0, 1, 0)), '-Y': Vector((0, -1, 0)), '+Z': Vector((0, 0, 1)), '-Z': Vector((0, 0, -1))}
f, u = AX[spec.get('forward', '+Y')], AX[spec.get('up', '+Z')]
r = f.cross(u)
# rows: new x = right, new y = forward, new z = up
R = Matrix(((r.x, r.y, r.z, 0), (f.x, f.y, f.z, 0), (u.x, u.y, u.z, 0), (0, 0, 0, 1)))
fix = spec.get('fix')
if fix:
    R = Matrix.Rotation(math.radians(fix[2]), 4, 'Z') @ Matrix.Rotation(math.radians(fix[1]), 4, 'Y') @ Matrix.Rotation(math.radians(fix[0]), 4, 'X') @ R
for o in meshes():
    o.data.transform(R)

def bbox(objs=None):
    lo, hi = Vector((1e18,) * 3), Vector((-1e18,) * 3)
    for o in objs if objs is not None else meshes():
        for v in o.data.vertices:
            c = v.co
            lo.x = min(lo.x, c.x); lo.y = min(lo.y, c.y); lo.z = min(lo.z, c.z)
            hi.x = max(hi.x, c.x); hi.y = max(hi.y, c.y); hi.z = max(hi.z, c.z)
    return lo, hi

# ── scale to the real length, then into the butt frame ──
lof = spec.get('lengthOf')
ref = [o for o in meshes() if re.search(lof, o.name, re.I)] if lof else meshes()
lo, hi = bbox(ref)
axis = spec.get('lengthAxis', 'y')
k = spec['length'] / (getattr(hi, axis) - getattr(lo, axis)) if spec.get('length') else 1
lo_all, hi_all = bbox()
cx = (lo_all.x + hi_all.x) / 2
T = Matrix.Scale(k, 4) @ Matrix.Translation(Vector((-cx, -lo.y, -lo_all.z)))
for o in meshes():
    o.data.transform(T)
lo, hi = bbox()
print('BUTTFRAME bbox', [round(v, 4) for v in lo], [round(v, 4) for v in hi])
if MODE == 'preview':
    for o in sorted(meshes(), key=lambda o: o.name):
        a, b = bbox([o])
        print('  OBJ %-34s %6d tris  x %6.3f..%6.3f  y %6.3f..%6.3f  z %6.3f..%6.3f  %s' % (o.name[:34], sum(len(p.vertices) - 2 for p in o.data.polygons), a.x, b.x, a.y, b.y, a.z, b.z, [m.name for m in o.data.materials if m]))
    for m in bpy.data.materials:
        if not m.users or not m.use_nodes: continue
        links = []
        for n in m.node_tree.nodes:
            if n.type == 'TEX_IMAGE' and n.image:
                to = [l.to_socket.name for l in n.outputs[0].links] if n.outputs[0].links else []
                links.append((n.image.name, tuple(n.image.size), to))
            if n.type == 'BSDF_PRINCIPLED':
                bc = n.inputs['Base Color'].default_value
                links.append(('bsdf', [round(bc[i], 2) for i in range(3)], 'metal %.2f rough %.2f' % (n.inputs['Metallic'].default_value, n.inputs['Roughness'].default_value)))
        print('  MAT', m.name, links)

# ── loose pieces in boxes: drop them, or move them into a part ──
def loose_components(o):
    bm = bmesh.new(); bm.from_mesh(o.data); bm.verts.ensure_lookup_table()
    parent = list(range(len(bm.verts)))
    def find(a):
        while parent[a] != a:
            parent[a] = parent[parent[a]]; a = parent[a]
        return a
    for e in bm.edges:
        a, b = find(e.verts[0].index), find(e.verts[1].index)
        if a != b: parent[a] = b
    comps = {}
    for v in bm.verts: comps.setdefault(find(v.index), []).append(v.index)
    return bm, list(comps.values())

def inside(box, a, b):
    return a.x >= box[0] and a.y >= box[1] and a.z >= box[2] and b.x <= box[3] and b.y <= box[4] and b.z <= box[5]

def comps_in_boxes(o, boxes):
    bm, comps = loose_components(o)
    hit = []
    for vs in comps:
        cs = [bm.verts[i].co for i in vs]
        a = Vector((min(c.x for c in cs), min(c.y for c in cs), min(c.z for c in cs)))
        b = Vector((max(c.x for c in cs), max(c.y for c in cs), max(c.z for c in cs)))
        if any(inside(bx, a, b) for bx in boxes): hit.extend(vs)
    return bm, hit

for bx in spec.get('deleteBox', []):
    for o in meshes():
        bm, hit = comps_in_boxes(o, [bx])
        if hit:
            bm.verts.ensure_lookup_table()
            bmesh.ops.delete(bm, geom=[bm.verts[i] for i in hit], context='VERTS')
            bm.to_mesh(o.data)
            print('deleteBox', o.name, len(hit), 'verts')
        bm.free()
for o in list(meshes()):
    if len(o.data.vertices) == 0: bpy.data.objects.remove(o)

# ── parts ──
def join(objs, name):
    objs = [o for o in objs if o.name in bpy.data.objects]
    if not objs: return None
    bpy.ops.object.select_all(action='DESELECT')
    for o in objs: o.select_set(True)
    bpy.context.view_layer.objects.active = objs[0]
    if len(objs) > 1: bpy.ops.object.join()
    ob = bpy.context.view_layer.objects.active
    ob.name = name; ob.data.name = name
    return ob

groups = {}
for o in meshes():
    part = 'body'
    for name, rxs in spec.get('parts', {}).items():
        if re.search(rxs, o.name, re.I): part = name; break
    groups.setdefault(part, []).append(o)
parts = {name: join(objs, name) for name, objs in groups.items()}
# loose pieces of the body inside a box → their own part (a slide or pump that wasn't a separate object)
for name, bx in spec.get('split', {}).items():
    body = parts.get('body')
    if not body: continue
    bm, hit = comps_in_boxes(body, [bx])
    bm.free()
    if not hit: print('split', name, 'nothing in box'); continue
    bpy.ops.object.select_all(action='DESELECT')
    bpy.context.view_layer.objects.active = body; body.select_set(True)
    bpy.ops.object.mode_set(mode='EDIT'); bpy.ops.mesh.select_all(action='DESELECT'); bpy.ops.object.mode_set(mode='OBJECT')
    for i in hit: body.data.vertices[i].select = True
    bpy.ops.object.mode_set(mode='EDIT'); bpy.ops.mesh.select_linked(); bpy.ops.mesh.separate(type='SELECTED'); bpy.ops.object.mode_set(mode='OBJECT')
    new = [o for o in bpy.context.selected_objects if o is not body][0]
    new.name = name; new.data.name = name
    if name in parts and parts[name]: parts[name] = join([parts[name], new], name)
    else: parts[name] = new
    print('split', name, len(hit), 'verts')
parts = {n: o for n, o in parts.items() if o}

def tris(o): return sum(len(p.vertices) - 2 for p in o.data.polygons)
for n, o in parts.items():
    a, b = bbox([o])
    print('PART', n, tris(o), 'tris', [round(v, 4) for v in a], [round(v, 4) for v in b])

# ── textures: base colour up to `tex`, normal maps up to `texNormal`, the rest (metal/roughness, AO) `texOther` ──
roles = {}
for m in bpy.data.materials:
    if not m.users or not m.use_nodes: continue
    for n in m.node_tree.nodes:
        if n.type != 'TEX_IMAGE' or not n.image: continue
        for l in n.outputs['Color'].links:
            role = 'normal' if l.to_node.type == 'NORMAL_MAP' else 'base' if l.to_socket.name == 'Base Color' else 'other'
            prev = roles.get(n.image.name)
            roles[n.image.name] = 'base' if 'base' in (role, prev) else role if prev in (None, 'normal') else prev
caps = {'base': spec.get('tex', 1024), 'normal': spec.get('texNormal', 512), 'other': spec.get('texOther', 512)}
for im in bpy.data.images:
    cap = caps.get(roles.get(im.name, 'base'), 1024)
    if im.size[0] > cap or im.size[1] > cap:
        s = cap / max(im.size)
        im.scale(max(1, int(im.size[0] * s)), max(1, int(im.size[1] * s)))
print('ROLES', roles)
if spec.get('oneUV'):
    for o in meshes():
        while len(o.data.uv_layers) > 1: o.data.uv_layers.remove(o.data.uv_layers[-1])
print('IMAGES', [(im.name, tuple(im.size)) for im in bpy.data.images if im.size[0]])
print('MATERIALS', [m.name for m in bpy.data.materials if m.users])
print('TRIS', sum(tris(o) for o in meshes()))

if MODE == 'preview':
    os.makedirs(OUT, exist_ok=True)
    sc = bpy.context.scene
    try: sc.render.engine = 'BLENDER_EEVEE'
    except Exception: sc.render.engine = 'BLENDER_EEVEE_NEXT'
    w = bpy.data.worlds.new('w'); sc.world = w; w.use_nodes = True
    bg = w.node_tree.nodes['Background']; bg.inputs[0].default_value = (0.8, 0.8, 0.8, 1); bg.inputs[1].default_value = 1.0
    sun = bpy.data.objects.new('sun', bpy.data.lights.new('sun', 'SUN')); sc.collection.objects.link(sun)
    sun.data.energy = 3; sun.rotation_euler = (math.radians(40), math.radians(60), 0)
    lo, hi = bbox()
    cam = bpy.data.objects.new('cam', bpy.data.cameras.new('cam')); sc.collection.objects.link(cam); sc.camera = cam
    cam.data.type = 'ORTHO'
    L = max(hi.y - lo.y, hi.z - lo.z) * 1.06
    cam.data.ortho_scale = L
    W = 1800
    Hh = int(W * (hi.z - lo.z + 0.06 * L) / L) + 40
    sc.render.resolution_x, sc.render.resolution_y = W, max(200, Hh)
    cyz = ((lo.y + hi.y) / 2, (lo.z + hi.z) / 2)
    # right side: camera on +X looking -X (muzzle to the right of the image)
    cam.location = (5, cyz[0], cyz[1]); cam.rotation_euler = (math.radians(90), 0, math.radians(90))
    cam.data.clip_end = 20
    sc.render.filepath = os.path.join(OUT, 'side.png')
    bpy.ops.render.render(write_still=True)
    # three-quarter view from the front right
    cam.data.type = 'PERSP'; cam.data.lens = 50
    d = Vector((1.0, 0.8, 0.5)).normalized() * L * 1.25
    c = Vector((0, cyz[0], cyz[1]))
    cam.location = c + d
    look = (c - cam.location).normalized()
    cam.rotation_euler = look.to_track_quat('-Z', 'Y').to_euler()
    sc.render.resolution_x, sc.render.resolution_y = 1200, 700
    sc.render.filepath = os.path.join(OUT, 'q34.png')
    bpy.ops.render.render(write_still=True)
    # the mapping from butt-frame (y, z) to side.png pixels, for the grid overlay
    json.dump({'W': W, 'H': max(200, Hh), 'L': L, 'cy': cyz[0], 'cz': cyz[1], 'lo': list(lo), 'hi': list(hi),
               'points': spec.get('points', {}), 'pivots': spec.get('pivots', {})}, open(os.path.join(OUT, 'map.json'), 'w'))
    print('PREVIEW', OUT)
    sys.exit(0)

# ═════════════ export ═════════════
pts = {k: Vector(v) for k, v in spec.get('points', {}).items()}
origin = pts.get('grip', Vector((0, 0, 0)))
# everything relative to the grip
for o in meshes():
    o.data.transform(Matrix.Translation(-origin))
pivots = spec.get('pivots', {})
for n, o in parts.items():
    if n in pivots:
        p = Vector((0, pivots[n][0], pivots[n][1])) - origin
    else:
        a, b = bbox([o]); p = (a + b) / 2
    o.data.transform(Matrix.Translation(-p))
    o.location = p

roots = set(spec.get('root', []))
lod0 = bpy.data.objects.new('lod0', None); bpy.context.collection.objects.link(lod0)
for n, o in parts.items():
    if n not in roots: o.parent = lod0
for name, p in pts.items():
    e = bpy.data.objects.new(name, None); bpy.context.collection.objects.link(e)
    e.location = p - origin
    e.parent = lod0
    e.empty_display_size = 0.01

# LOD1: every LOD0 part merged and decimated to the budget
budget = spec.get('lod1', 1200)
if budget:
    src_objs = [o for n, o in parts.items() if n not in roots]
    copies = []
    for o in src_objs:
        c = o.copy(); c.data = o.data.copy(); c.parent = None
        c.matrix_world = o.matrix_world.copy()
        bpy.context.collection.objects.link(c); copies.append(c)
    bpy.ops.object.select_all(action='DESELECT')
    for c in copies:
        c.select_set(True)
    bpy.context.view_layer.objects.active = copies[0]
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
    lod1 = join(copies, 'lod1')
    t0 = tris(lod1)
    if t0 > budget:
        m = lod1.modifiers.new('dec', 'DECIMATE'); m.ratio = budget / t0; m.use_collapse_triangulate = True
        bpy.context.view_layer.objects.active = lod1
        bpy.ops.object.modifier_apply(modifier='dec')
    print('LOD1', t0, '->', tris(lod1))

os.makedirs(os.path.dirname(os.path.abspath(OUT)), exist_ok=True)
bpy.ops.export_scene.gltf(filepath=OUT, export_format='GLB', export_apply=True, export_yup=True,
                          export_image_format='JPEG', export_jpeg_quality=82, export_extras=False)
print('EXPORTED', OUT, os.path.getsize(OUT) // 1024, 'KB')
