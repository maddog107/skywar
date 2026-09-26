# ═══════════════════════════════════════════════════════════════
# Import + clean a downloaded aircraft model for SKYWAR (Blender, headless).
#   blender -b -P tools/aircraft/import_model.py -- SRC.glb OUT.glb [options]
#   blender -b -P tools/aircraft/import_model.py -- SRC.glb --inspect RENDER_DIR
# Options:
#   --nose +X|-X|+Y|-Y     which Blender axis the nose points along after import (default +Y)
#   --roll DEG / --pitch DEG  extra rotation about Y / X after the yaw fix (models lying on their side)
#   --delete REGEX         delete objects whose (object, mesh or material) name matches
#   --delete-mat REGEX     delete faces using materials whose name matches
#   --below FRAC           delete loose parts lying entirely below FRAC of the height (landing gear)
#   --below-max SIZE       ...but only parts smaller than SIZE (fraction of length) (default 0.25)
#   --outside-x FRAC       delete loose parts entirely outboard of FRAC of the half-span (e.g. ground props)
#   --tex N                downscale textures to at most N px (default 1024)
#   --glass REGEX          make matching materials alpha-blended canopy glass
#   --decimate RATIO       collapse-decimate every mesh (0..1)
#   --decimate-sym         ...keeping left and right identical (mirror about x = 0)
#   --fix-flipped K        flip faces that can only be seen from their back side from outside (K view directions)
#   --keep-gear            skip the gear heuristics
#   --keep-abs x0,y0,z0,x1,y1,z1   keep only objects inside this box (file coordinates, see --list)
#   --box-delete f,f,f,f,f,f       delete loose parts fully inside this box (fractions of the bbox)
#   --weld-first           merge coincident (seam-split) vertices straight after import: loose parts are then whole
#                          parts for --box-delete & co., and --decimate no longer tears the surface open at seams
#   --wires FRAC           delete antenna wires (loose parts of <= 16 vertices longer than FRAC of the length)
#   --rotate-part REGEX:axis:fx,fy,fz:deg   rotate matching objects about a hinge (e.g. close a canopy)
#   --level-roll / --level-pitch   auto-level a model that was exported banked / nose-up
#   --weld ANGLE           merge split vertices and re-smooth with sharp edges above ANGLE (smaller files)
#   --strip-maps           drop normal / metal-rough / emissive maps (keep base colour)
#   --mono '#hex' [--mono-mat REGEX] [--mono-sat S]   repaint base-colour textures in one paint colour
#                          (keeps shading/panel lines; removes logos and national markings)
#   --paint 'REGEX=#hex,REGEX=~hex,...'   repaint untextured materials; '#' adds the SKYWAR panel-line
#                          texture (box-mapped, needs --length L in metres), '~' is a flat colour
#   --tint '#hex'          multiply the colour of every textured material (darken a washed-out skin)
#   --one-uv / --uv0       drop extra UV sets / put the panel texture on UV0
#   --img JPEG             re-encode textures as JPEG on export
#   --list                 print every object with triangles, bbox and materials
# Output is joined into one mesh (materials kept), nose toward +Y (three.js -Z), centred, metres
# unchanged (the game rescales to the real length). Prints triangle count / size / bbox.
# ═══════════════════════════════════════════════════════════════
import bpy, bmesh, sys, os, re, math, json
from mathutils import Vector, Matrix

argv = sys.argv[sys.argv.index('--') + 1:]
SRC = argv[0]
OUT = argv[1] if len(argv) > 1 and not argv[1].startswith('--') else None
def opt(name, default=None, cast=str):
    if name in argv:
        return cast(argv[argv.index(name) + 1])
    return default
flag = lambda n: n in argv

bpy.ops.wm.read_factory_settings(use_empty=True)
ext = os.path.splitext(SRC)[1].lower()
if ext in ('.glb', '.gltf'):
    bpy.ops.import_scene.gltf(filepath=SRC)
elif ext == '.obj':
    bpy.ops.wm.obj_import(filepath=SRC)
elif ext == '.fbx':
    bpy.ops.import_scene.fbx(filepath=SRC)
elif ext == '.blend':
    with bpy.data.libraries.load(SRC) as (src, dst):
        dst.objects = src.objects
    for o in dst.objects:
        if o: bpy.context.collection.objects.link(o)

def meshes():
    return [o for o in bpy.data.objects if o.type == 'MESH']

# ── bake transforms / modifiers, drop helpers ──
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

def bbox(objs=None):
    vs = [v.co for o in (objs or meshes()) for v in o.data.vertices]
    mn = Vector((min(v.x for v in vs), min(v.y for v in vs), min(v.z for v in vs)))
    mx = Vector((max(v.x for v in vs), max(v.y for v in vs), max(v.z for v in vs)))
    return mn, mx

def tris(objs=None):
    return sum(len(p.vertices) - 2 for o in (objs or meshes()) for p in o.data.polygons)

# ── weld first: glTF files split vertices at every UV / normal seam. Merging them before anything else
#    makes each part one connected surface, so --box-delete & co. see whole parts and --decimate collapses
#    across seams instead of tearing the surface open along them (cracks and folded, flipped triangles) ──
if flag('--weld-first'):
    mn0, mx0 = bbox()
    d0 = 1e-5 * (mx0 - mn0).length
    for o in meshes():
        bm = bmesh.new(); bm.from_mesh(o.data)
        n0 = len(bm.verts)
        bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=d0)
        print('weld-first', o.name, n0, '->', len(bm.verts), 'verts')
        bm.to_mesh(o.data); bm.free()

if flag('--list'):
    mn0, mx0 = bbox()
    print('LIST bbox', [round(v, 2) for v in mn0], [round(v, 2) for v in mx0])
    for o in sorted(meshes(), key=lambda o: o.name):
        a, b = bbox([o])
        print('  OBJ %-40s tris %6d  min %s max %s mats %s' % (o.name[:40], tris([o]), [round(v, 2) for v in a], [round(v, 2) for v in b],
              [m.name for m in o.data.materials if m][:4]))

keep = opt('--keep-abs')   # "x0,y0,z0,x1,y1,z1" in the file's own coordinates (see --list): keep only parts inside
if keep:
    kb = [float(v) for v in keep.split(',')]
    lo, hi = Vector(kb[:3]), Vector(kb[3:])
    for o in list(meshes()):
        a, b = bbox([o])
        if not all(lo[i] <= a[i] and b[i] <= hi[i] for i in range(3)):
            bpy.data.objects.remove(o)
    print('kept', len(meshes()), 'objects inside', kb)

rx = opt('--delete')
if rx:
    r = re.compile(rx, re.I)
    for o in list(meshes()):
        names = [o.name, o.data.name] + [m.name for m in o.data.materials if m]
        if any(r.search(n) for n in names if n):
            print('delete object', o.name)
            bpy.data.objects.remove(o)
rm = opt('--delete-mat')
if rm:
    r = re.compile(rm, re.I)
    for o in meshes():
        bad = {i for i, m in enumerate(o.data.materials) if m and r.search(m.name)}
        if not bad:
            continue
        bm = bmesh.new(); bm.from_mesh(o.data)
        bmesh.ops.delete(bm, geom=[f for f in bm.faces if f.material_index in bad], context='FACES')
        bm.to_mesh(o.data); bm.free()
        print('deleted faces of materials', [o.data.materials[i].name for i in bad], 'in', o.name)

# ── orientation: nose → +Y, up → +Z ──
nose = opt('--nose', '+Y')
yaw = {'+Y': 0, '-Y': math.pi, '+X': math.pi / 2, '-X': -math.pi / 2}[nose]
R = Matrix.Rotation(yaw, 4, 'Z')
if opt('--roll'):
    R = Matrix.Rotation(math.radians(float(opt('--roll'))), 4, 'Y') @ R
if opt('--pitch'):
    R = Matrix.Rotation(math.radians(float(opt('--pitch'))), 4, 'X') @ R
for o in meshes():
    o.data.transform(R)

# ── auto-level roll: outboard (wing) vertices must have no z-vs-x trend (symmetric dihedral cancels) ──
if flag('--level-roll'):
    mn0, mx0 = bbox()
    hs0 = max(-mn0.x, mx0.x)
    cx0 = (mn0.x + mx0.x) / 2
    pts = [v.co for o in meshes() for v in o.data.vertices if abs(v.co.x - cx0) > 0.35 * hs0]
    if pts:
        mxv = sum(p.x for p in pts) / len(pts); mzv = sum(p.z for p in pts) / len(pts)
        cov = sum((p.x - mxv) * (p.z - mzv) for p in pts); var = sum((p.x - mxv) ** 2 for p in pts)
        ang = math.atan2(cov, var)
        print('level roll by %.2f deg' % -math.degrees(ang))
        Rr = Matrix.Rotation(ang, 4, 'Y')
        for o in meshes():
            o.data.transform(Rr)

# ── rotate one part about a hinge: REGEX:axis:px,py,pz:deg (hinge point in fractions of THAT part's bbox,
#    after the nose fix: +Y = forward, +Z = up) — e.g. close an open canopy ──
for spec in [argv[i + 1] for i, a in enumerate(argv) if a == '--rotate-part']:
    rxp, axis, pt, deg = spec.split(':')
    r_ = re.compile(rxp, re.I)
    parts = [o for o in meshes() if r_.search(o.name) or any(m and r_.search(m.name) for m in o.data.materials)]
    if not parts:
        continue
    mn0, mx0 = bbox(parts)
    f = [float(v) for v in pt.split(',')]
    P = Vector((mn0.x + f[0] * (mx0.x - mn0.x), mn0.y + f[1] * (mx0.y - mn0.y), mn0.z + f[2] * (mx0.z - mn0.z)))
    M = Matrix.Translation(P) @ Matrix.Rotation(math.radians(float(deg)), 4, axis.upper()) @ Matrix.Translation(-P)
    for o in parts:
        o.data.transform(M)
        print('rotated', o.name, 'about', [round(v, 2) for v in P])

# ── pitch auto-level: the belly line (lowest centreline points) of the middle of the fuselage is horizontal ──
if flag('--level-pitch'):
    mn0, mx0 = bbox()
    cx0 = (mn0.x + mx0.x) / 2
    Lr = mx0.y - mn0.y
    bins = {}
    for o in meshes():
        for v in o.data.vertices:
            if abs(v.co.x - cx0) < 0.03 * Lr:
                k = int((v.co.y - mn0.y) / Lr * 40)
                if 8 <= k <= 32:
                    bins[k] = min(bins.get(k, 1e9), v.co.z)
    ks = sorted(bins)
    if len(ks) > 4:
        ys = [mn0.y + (k + 0.5) / 40 * Lr for k in ks]; zs = [bins[k] for k in ks]
        my = sum(ys) / len(ys); mz = sum(zs) / len(zs)
        slope = sum((a - my) * (b - mz) for a, b in zip(ys, zs)) / sum((a - my) ** 2 for a in ys)
        ang = math.atan(slope)
        print('level pitch by %.2f deg' % -math.degrees(ang))
        for o in meshes():
            o.data.transform(Matrix.Rotation(-ang, 4, 'X'))

# ── landing gear / props on the ground: loose parts entirely below a height fraction ──
def split_loose():
    out = []
    for o in list(meshes()):
        bpy.ops.object.select_all(action='DESELECT')
        o.select_set(True)
        bpy.context.view_layer.objects.active = o
        bpy.ops.object.mode_set(mode='EDIT')
        bpy.ops.mesh.select_all(action='SELECT')
        bpy.ops.mesh.separate(type='LOOSE')
        bpy.ops.object.mode_set(mode='OBJECT')
    return meshes()

def delete_loose(pred):
    """Delete connected components (loose parts) for which pred(min, max, vertex count) is true. Fast (bmesh union-find)."""
    n_parts = n_tris = 0
    for o in meshes():
        bm = bmesh.new(); bm.from_mesh(o.data)
        bm.verts.ensure_lookup_table()
        parent = list(range(len(bm.verts)))
        def find(a):
            while parent[a] != a:
                parent[a] = parent[parent[a]]; a = parent[a]
            return a
        for e in bm.edges:
            a, b = find(e.verts[0].index), find(e.verts[1].index)
            if a != b: parent[a] = b
        comps = {}
        for v in bm.verts:
            comps.setdefault(find(v.index), []).append(v)
        kill = []
        for vs in comps.values():
            a = Vector((min(v.co.x for v in vs), min(v.co.y for v in vs), min(v.co.z for v in vs)))
            b = Vector((max(v.co.x for v in vs), max(v.co.y for v in vs), max(v.co.z for v in vs)))
            if pred(a, b, len(vs)):
                kill.extend(vs); n_parts += 1
        if kill:
            fs = {f for v in kill for f in v.link_faces}
            n_tris += sum(len(f.verts) - 2 for f in fs)
            bmesh.ops.delete(bm, geom=kill, context='VERTS')
            bm.to_mesh(o.data)
        bm.free()
    return n_parts, n_tris

below = opt('--below', None, float)
outx = opt('--outside-x', None, float)
if (below is not None or outx is not None) and not flag('--keep-gear'):
    mn, mx = bbox()
    H = mx.z - mn.z
    L = mx.y - mn.y
    hs = max(-mn.x, mx.x)
    lim = opt('--below-max', 0.25, float) * L
    if below is not None:
        print('deleted low parts (parts, tris):', delete_loose(lambda a, b, n: b.z < mn.z + below * H and (b - a).length < lim))
    if outx is not None:
        print('deleted outboard parts:', delete_loose(lambda a, b, n: a.x > outx * hs or b.x < -outx * hs))
box_del = opt('--box-delete')   # "x0,y0,z0,x1,y1,z1" in fractions of the bbox (0..1): delete loose parts fully inside
if box_del:
    mn, mx = bbox()
    f = [float(v) for v in box_del.split(',')]
    lo = Vector((mn.x + f[0] * (mx.x - mn.x), mn.y + f[1] * (mx.y - mn.y), mn.z + f[2] * (mx.z - mn.z)))
    hi = Vector((mn.x + f[3] * (mx.x - mn.x), mn.y + f[4] * (mx.y - mn.y), mn.z + f[5] * (mx.z - mn.z)))
    print('deleted parts in box:', delete_loose(lambda a, b, n: all(lo[i] <= a[i] and b[i] <= hi[i] for i in range(3))))
wires = opt('--wires', None, float)   # thin antenna wires: tiny loose parts longer than FRAC of the length (they alias into dotted lines)
if wires is not None:
    mn, mx = bbox()
    print('deleted wires:', delete_loose(lambda a, b, n: n <= 16 and (b - a).length > wires * (mx.y - mn.y)))

# ── glass ──
g = opt('--glass')
if g:
    r = re.compile(g, re.I)
    for m in bpy.data.materials:
        if r.search(m.name) and m.use_nodes:
            b = m.node_tree.nodes.get('Principled BSDF')
            if b:
                b.inputs['Alpha'].default_value = min(b.inputs['Alpha'].default_value, 0.45)
                try: m.surface_render_method = 'BLENDED'
                except Exception: m.blend_method = 'BLEND'
                print('glass', m.name)

# ── texture maps: keep only base colour (normal / metal-rough / AO / emissive maps cost MBs) ──
if flag('--strip-maps'):
    for m in bpy.data.materials:
        if not m.use_nodes:
            continue
        b = m.node_tree.nodes.get('Principled BSDF')
        if not b:
            continue
        for inp in ('Normal', 'Metallic', 'Roughness', 'Emission Color', 'Alpha' if not re.search(opt('--glass', '$^'), m.name, re.I) else '__'):
            if inp in b.inputs:
                for l in list(b.inputs[inp].links):
                    m.node_tree.links.remove(l)
        for n in list(m.node_tree.nodes):
            if n.type == 'TEX_IMAGE' and not any(l.to_socket == b.inputs['Base Color'] or (l.to_node.type != 'BSDF_PRINCIPLED') for l in n.outputs['Color'].links):
                m.node_tree.nodes.remove(n)
    for im in list(bpy.data.images):
        if im.users == 0:
            bpy.data.images.remove(im)

# ── monochrome repaint of base-colour textures: saturated colours (logos, stripes) become paint,
#    greys keep their shading so panel lines / windows / dark trim survive ──
mono = opt('--mono')
if mono:
    import numpy as np
    h = int(mono.lstrip('#'), 16)
    paint = np.array([((h >> 16) & 255) / 255, ((h >> 8) & 255) / 255, (h & 255) / 255], np.float32)
    sat_lim = opt('--mono-sat', 0.22, float)
    seen = set()
    for m in bpy.data.materials:
        if not m.use_nodes:
            continue
        b = m.node_tree.nodes.get('Principled BSDF')
        if not b or not b.inputs['Base Color'].links:
            continue
        n = b.inputs['Base Color'].links[0].from_node
        if n.type != 'TEX_IMAGE' or not n.image or n.image.name in seen or (opt('--mono-mat') and not re.search(opt('--mono-mat'), m.name)):
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
        print('mono', im.name)

# ── repaint untextured materials: REGEX=#hex[,REGEX=#hex...] (+ SKYWAR panel-line texture, box UVs) ──
paint_spec = opt('--paint')
if paint_spec:
    sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), '..'))
    import aircraft_kit as K
    K.STATE['factors'] = {}
    img = K.panel_image('panel')
    rules = [(re.compile(r.split('=')[0], re.I), r.split('=')[1]) for r in paint_spec.split(',')]
    mn_, mx_ = bbox()
    units_per_m = (mx_.y - mn_.y) / opt('--length', 15.0, float)
    uv_scale = opt('--uv-scale', 8.0, float) * units_per_m
    has_uv = any(len(o.data.uv_layers) for o in meshes())
    layer = 'PanelUV' if has_uv and not flag('--uv0') else None
    for m in bpy.data.materials:
        for rx_, col in rules:
            if not rx_.search(m.name):
                continue
            m.use_nodes = True
            nt = m.node_tree
            b = nt.nodes.get('Principled BSDF')
            for l in list(b.inputs['Base Color'].links):
                nt.links.remove(l)
            c = K.srgb(col.lstrip('~'))
            b.inputs['Base Color'].default_value = (*c, 1)
            m.diffuse_color = (*c, 1)
            if col.startswith('#') and not flag('--no-panel'):
                t = nt.nodes.new('ShaderNodeTexImage'); t.image = img
                if layer:
                    uvn = nt.nodes.new('ShaderNodeUVMap'); uvn.uv_map = layer
                    nt.links.new(uvn.outputs['UV'], t.inputs['Vector'])
                nt.links.new(t.outputs['Color'], b.inputs['Base Color'])
                K.STATE['factors'][m.name] = list(c) + [1.0]
            b.inputs['Metallic'].default_value = min(b.inputs['Metallic'].default_value, 0.3)
            print('paint', m.name, col)
            break
    for o in meshes():
        K._box_uv(o, uv_scale, layer)

# ── decimate ──
dec = opt('--decimate', None, float)
if dec:
    for o in meshes():
        md = o.modifiers.new('dec', 'DECIMATE')
        md.ratio = dec
        if flag('--decimate-sym'):   # keep left and right identical (mirror about the model's x = 0 plane)
            md.use_symmetry = True; md.symmetry_axis = 'X'
        bpy.context.view_layer.objects.active = o
        bpy.ops.object.modifier_apply(modifier=md.name)

# ── fix flipped faces by what can be seen from outside: every face is looked at from many directions
#    (a ray from far outside to its centre); a face that is only ever seen from its back is inside-out
#    (the sky shows through it with single-sided materials) and gets flipped. --fix-flipped K = directions. ──
def fix_flipped(k_dirs):
    from mathutils.bvhtree import BVHTree
    objs = meshes()
    bms = []
    verts, polys, owner = [], [], []
    for o in objs:
        bm = bmesh.new(); bm.from_mesh(o.data)
        bm.verts.index_update(); bm.faces.ensure_lookup_table(); bm.normal_update()
        base = len(verts)
        verts += [v.co.copy() for v in bm.verts]
        for f in bm.faces:
            polys.append([base + v.index for v in f.verts]); owner.append((len(bms), f.index))
        bms.append(bm)
    tree = BVHTree.FromPolygons(verts, polys, epsilon=0.0)
    mn0, mx0 = bbox()
    far = (mx0 - mn0).length * 2
    dirs = []
    for i in range(k_dirs):   # Fibonacci sphere
        y = 1 - 2 * (i + 0.5) / k_dirs
        r = math.sqrt(max(0.0, 1 - y * y)); th = i * math.pi * (3 - math.sqrt(5))
        dirs.append(Vector((r * math.cos(th), r * math.sin(th), y)))
    n_flip = n_both = 0
    for gi, (bi, fi) in enumerate(owner):
        f = bms[bi].faces[fi]
        if f.calc_area() <= 0:
            continue
        c = f.calc_center_median(); nrm = f.normal
        seen_front = seen_back = 0
        for d in dirs:   # d = viewing direction (from the eye toward the face)
            dn = d.dot(nrm)
            if abs(dn) < 0.08:
                continue
            loc, _n, idx, dist = tree.ray_cast(c - d * far, d, far * 1.01)
            if idx == gi or (loc is not None and (loc - c).length < 1e-7 * far):
                if dn < 0: seen_front += 1
                else: seen_back += 1
        if seen_back and not seen_front:
            f.normal_flip(); n_flip += 1
        elif seen_back and seen_front:
            n_both += 1
    for o, bm in zip(objs, bms):
        bm.to_mesh(o.data); bm.free()
        if n_flip and o.data.has_custom_normals:   # imported split normals would still point inward
            bpy.context.view_layer.objects.active = o
            bpy.ops.mesh.customdata_custom_splitnormals_clear()
    print('fix-flipped: flipped %d faces (%d more are seen from both sides)' % (n_flip, n_both))

kff = opt('--fix-flipped', None, int)
if kff:
    fix_flipped(kff)

# ── weld split vertices (flat-shaded / split-normal meshes export 3 vertices per triangle) and
#    re-derive smooth normals with sharp edges above the given angle ──
weld = opt('--weld', None, float)
if weld is not None:
    mn0, mx0 = bbox()
    dist = 1e-5 * (mx0 - mn0).length
    for o in meshes():
        bm = bmesh.new(); bm.from_mesh(o.data)
        bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=dist)
        for f in bm.faces:
            f.smooth = True
        for e in bm.edges:
            e.smooth = not (len(e.link_faces) != 2 or e.calc_face_angle(0) > math.radians(weld))
        bm.to_mesh(o.data); bm.free()
        try:
            o.data.free_normals_split() if hasattr(o.data, 'free_normals_split') else None
            if o.data.has_custom_normals:
                bpy.context.view_layer.objects.active = o
                bpy.ops.mesh.customdata_custom_splitnormals_clear()
        except Exception as e:
            print('normals', e)
    print('welded, sharp >', weld)
if flag('--one-uv'):
    for o in meshes():
        while len(o.data.uv_layers) > 1:
            o.data.uv_layers.remove(o.data.uv_layers[-1])

# ── textures ──
tex = opt('--tex', 1024, int)
for im in bpy.data.images:
    if im.size[0] > tex or im.size[1] > tex:
        s = tex / max(im.size)
        print('scale image', im.name, tuple(im.size), '->', int(im.size[0] * s), int(im.size[1] * s))
        im.scale(max(1, int(im.size[0] * s)), max(1, int(im.size[1] * s)))

# ── centre + join ──
mn, mx = bbox()
c = (mn + mx) / 2
for o in meshes():
    o.data.transform(Matrix.Translation(-c))
ms = meshes()
if len(ms) > 1:
    bpy.ops.object.select_all(action='DESELECT')
    for o in ms:
        o.select_set(True)
    bpy.context.view_layer.objects.active = ms[0]
    bpy.ops.object.join()
ob = meshes()[0]
ob.name = 'aircraft'
mn, mx = bbox()

# ── suggested rig: cockpit eye from the canopy glass (faces near the centreline) ──
entry = {'rot': [0, 0, 0]}
Lb = mx.y - mn.y
grx = re.compile(opt('--glass-rx', 'glass|canopy|cockpit|transparent|window|windscreen|verre|vidrio|vetro'), re.I)
gidx = {i for i, m in enumerate(ob.data.materials) if m and grx.search(m.name)}
if gidx:
    vs = [ob.data.vertices[v].co for p in ob.data.polygons if p.material_index in gidx for v in p.vertices]
    vs = [v for v in vs if abs(v.x) < 0.08 * (mx.x - mn.x)]
    if vs:
        ga = Vector((min(v.x for v in vs), min(v.y for v in vs), min(v.z for v in vs)))
        gb = Vector((max(v.x for v in vs), max(v.y for v in vs), max(v.z for v in vs)))
        if gb.y - ga.y < 0.45 * Lb:
            f = opt('--eye', 0.38, float)
            ye = gb.y - f * (gb.y - ga.y)
            ze = ga.z + 0.55 * (gb.z - ga.z)
            entry['cockpit'] = [round(ze / Lb, 4), round(-ye / Lb, 4)]
print('ENTRY', json.dumps(entry))
print('BBOX length(Y) %.3f span(X) %.3f height(Z) %.3f' % (mx.y - mn.y, mx.x - mn.x, mx.z - mn.z))
print('TRIS', tris())
print('MATERIALS', [m.name for m in ob.data.materials if m])
print('IMAGES', [(im.name, tuple(im.size)) for im in bpy.data.images if im.size[0]])

insp = opt('--inspect')
if insp:
    os.makedirs(insp, exist_ok=True)
    sc = bpy.context.scene
    sc.render.engine = 'BLENDER_WORKBENCH'
    sh = sc.display.shading
    sh.light = 'STUDIO'; sh.color_type = 'TEXTURE'
    sc.render.film_transparent = False
    cam = bpy.data.cameras.new('cam'); co = bpy.data.objects.new('cam', cam); sc.collection.objects.link(co); sc.camera = co
    cam.type = 'ORTHO'
    W = max(mx.x - mn.x, mx.y - mn.y, mx.z - mn.z) * 1.05
    cam.ortho_scale = W
    sc.render.resolution_x = sc.render.resolution_y = 700
    for v, loc, rot in (('top', (0, 0, 100), (0, 0, 0)), ('side', (100, 0, 0), (math.pi / 2, 0, math.pi / 2)),
                        ('front', (0, 100, 0), (math.pi / 2, 0, math.pi))):
        co.location = loc; co.rotation_euler = rot; cam.clip_end = 1000
        sc.render.filepath = os.path.join(insp, v + '.png')
        bpy.ops.render.render(write_still=True)
    print('INSPECT', insp)

if OUT:
    os.makedirs(os.path.dirname(os.path.abspath(OUT)), exist_ok=True)
    bpy.ops.export_scene.gltf(filepath=OUT, export_format='GLB', export_apply=True, export_yup=True,
                              export_image_format=opt('--img', 'AUTO'), export_jpeg_quality=85)
    if paint_spec:
        K._patch_glb(OUT)
    tint = opt('--tint')   # '#hex': multiply every textured material's colour (darken a washed-out skin)
    if tint:
        import struct
        h = int(tint.lstrip('#'), 16)
        tc = [((h >> 16) & 255) / 255, ((h >> 8) & 255) / 255, (h & 255) / 255]
        data = open(OUT, 'rb').read()
        magic, ver, total = struct.unpack_from('<III', data, 0)
        jlen, jtype = struct.unpack_from('<II', data, 12)
        doc = json.loads(data[20:20 + jlen].decode('utf8'))
        for m in doc.get('materials', []):
            pbr = m.setdefault('pbrMetallicRoughness', {})
            if 'baseColorTexture' in pbr and m.get('alphaMode') != 'BLEND':
                f0 = pbr.get('baseColorFactor', [1, 1, 1, 1])
                pbr['baseColorFactor'] = [round(f0[i] * tc[i], 4) for i in range(3)] + [f0[3]]
        js = json.dumps(doc, separators=(',', ':')).encode('utf8')
        js += b' ' * ((4 - len(js) % 4) % 4)
        rest = data[20 + jlen:]
        open(OUT, 'wb').write(struct.pack('<III', magic, ver, 12 + 8 + len(js) + len(rest)) + struct.pack('<II', len(js), jtype) + js + rest)
        print('tinted', tint)
    print('WROTE', OUT, os.path.getsize(OUT))
