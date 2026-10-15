# ═══════════════════════════════════════════════════════════════
# Boeing 747-400: get kaymanv's "Boeing747" (CC BY) ready for a livery (Blender, headless).
#   blender -b -P tools/aircraft/b747_prep.py -- SRC.glb OUT.glb
# The source is one untextured white material; its cabin windows and doors are modelled (little boxes standing on
# the skin), but white on white. This splits it into materials by part and gives the painted parts UVs:
#   Fuselage    the fuselage shell, unwrapped round its axis: u along the length, v round the section from the
#               belly (the seam on the bottom centreline), on a 4096×1024 texture (1.7 cm a texel along, 2 cm round)
#   Fin         the fin, projected from the side onto a 1024² texture (both sides share it: the logo is symmetric)
#   Window      the cabin and upper-deck windows (dark glass);  Door  the doors (light panel grey)
#   Wing        wings and tailplanes;  EngineCowl / EngineLip / EngineCore / Fan / Pylon  the four engines
# The livery itself is painted onto Fuselage and Fin by tools/aircraft/paint_b747.py. The source frame is kept
# (nose toward −Y, Z up, the file's own units: 26.62 to the 70.6 m length).
# ═══════════════════════════════════════════════════════════════
import bpy, bmesh, sys, math
from mathutils import Vector

argv = sys.argv[sys.argv.index('--') + 1:]
SRC, OUT = argv[0], argv[1]
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=SRC)
for o in [o for o in bpy.data.objects if o.type == 'MESH']:
    o.data.transform(o.matrix_world)
    o.matrix_world.identity()
    o.parent = None
objs = {o.name: o for o in bpy.data.objects if o.type == 'MESH'}

MATS = {}
def mat(name, colour, metal=0.1, rough=0.5, size=None):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    b = m.node_tree.nodes['Principled BSDF']
    h = int(colour.lstrip('#'), 16)
    c = [((h >> 16) & 255) / 255, ((h >> 8) & 255) / 255, (h & 255) / 255]
    c = [x / 12.92 if x <= 0.04045 else ((x + 0.055) / 1.055) ** 2.4 for x in c]
    b.inputs['Base Color'].default_value = (*c, 1)
    b.inputs['Metallic'].default_value = metal
    b.inputs['Roughness'].default_value = rough
    if size:
        img = bpy.data.images.new(name + '_tex', size[0], size[1])
        img.generated_color = (*c, 1)
        t = m.node_tree.nodes.new('ShaderNodeTexImage'); t.image = img
        m.node_tree.links.new(t.outputs['Color'], b.inputs['Base Color'])
    MATS[name] = m
    return m

mat('Fuselage', '#f3f4f2', size=(4096, 1024))
mat('Fin', '#f3f4f2', size=(1024, 1024))
mat('Window', '#18202a', 0.3, 0.15)
mat('Door', '#d3d8dc', 0.1, 0.45)
mat('Wing', '#c7cbce', 0.15, 0.5)
mat('EngineCowl', '#1b3478', 0.15, 0.45)
mat('EngineLip', '#b9bdc1', 0.7, 0.3)
mat('EngineCore', '#55585c', 0.5, 0.5)
mat('Fan', '#2a2c30', 0.6, 0.4)
mat('Pylon', '#d7dadd', 0.1, 0.5)

def set_mat(o, names_for_faces):
    me = o.data
    me.materials.clear()
    names = sorted(set(names_for_faces))
    for n in names:
        me.materials.append(MATS[n])
    for p, n in zip(me.polygons, names_for_faces):
        p.material_index = names.index(n)

def components(o):
    bm = bmesh.new(); bm.from_mesh(o.data)
    bm.verts.ensure_lookup_table(); bm.faces.ensure_lookup_table()
    parent = list(range(len(bm.verts)))
    def find(a):
        while parent[a] != a:
            parent[a] = parent[parent[a]]; a = parent[a]
        return a
    # weld by position so seam-split pieces count as one part
    key = {}
    for v in bm.verts:
        k = tuple(round(c, 4) for c in v.co)
        if k in key:
            a, b = find(v.index), find(key[k])
            if a != b: parent[a] = b
        else:
            key[k] = v.index
    for e in bm.edges:
        a, b = find(e.verts[0].index), find(e.verts[1].index)
        if a != b: parent[a] = b
    comp = [find(f.verts[0].index) for f in bm.faces]
    bm.free()
    return comp

# ── windows and doors ──
o = objs['Object_18']
comp = components(o)
ext = {}
for p, c in zip(o.data.polygons, comp):
    for vi in p.vertices:
        co = o.data.vertices[vi].co
        e = ext.setdefault(c, [Vector(co), Vector(co)])
        e[0] = Vector(map(min, e[0], co)); e[1] = Vector(map(max, e[1], co))
names = []
for p, c in zip(o.data.polygons, comp):
    a, b = ext[c]
    names.append('Door' if (b.y - a.y) > 0.25 or (b.z - a.z) > 0.25 else 'Window')
set_mat(o, names)
print('windows / doors:', names.count('Window'), names.count('Door'), 'faces')

# ── engines: nacelle (cowl, its front lip, the core and exhaust at the back), fan and spinner, pylon ──
o = objs['Object_16']
comp = components(o)
groups = {}
for i, c in enumerate(comp):
    groups.setdefault(c, []).append(i)
names = [None] * len(o.data.polygons)
for c, faces in groups.items():
    vs = [o.data.vertices[v].co for i in faces for v in o.data.polygons[i].vertices]
    a = Vector((min(v.x for v in vs), min(v.y for v in vs), min(v.z for v in vs)))
    b = Vector((max(v.x for v in vs), max(v.y for v in vs), max(v.z for v in vs)))
    size = b - a
    if len(faces) > 600:                     # the nacelle
        L = size.y
        for i in faces:
            y = o.data.polygons[i].center.y
            names[i] = 'EngineLip' if y < a.y + 0.06 * L else ('EngineCore' if y > a.y + 0.80 * L else 'EngineCowl')
    elif size.y > 1.5:                       # the pylon (long, above the nacelle)
        for i in faces: names[i] = 'Pylon'
    else:                                    # fan, spinner, blades
        for i in faces: names[i] = 'Fan'
set_mat(o, names)

# ── wings and tailplanes ──
for n in ('Object_8', 'Object_10', 'Object_12'):
    set_mat(objs[n], ['Wing'] * len(objs[n].data.polygons))

# ── fuselage: unwrapped round its axis ──
o = objs['Object_6']
me = o.data
set_mat(o, ['Fuselage'] * len(me.polygons))
ys = [v.co.y for v in me.vertices]
y0, y1 = min(ys), max(ys)
# the section's centre height at each station (from the shell's own top and bottom)
N = 200
lo = [1e9] * (N + 1); hi = [-1e9] * (N + 1)
for v in me.vertices:
    k = int((v.co.y - y0) / (y1 - y0) * N)
    lo[k] = min(lo[k], v.co.z); hi[k] = max(hi[k], v.co.z)
for k in range(N + 1):
    if lo[k] > hi[k]:
        lo[k], hi[k] = lo[k - 1], hi[k - 1]
def zc(y):
    t = (y - y0) / (y1 - y0) * N
    k = min(N - 1, int(t)); f = t - k
    return ((lo[k] + hi[k]) * (1 - f) + (lo[k + 1] + hi[k + 1]) * f) / 2
while me.uv_layers:
    me.uv_layers.remove(me.uv_layers[0])
uv = me.uv_layers.new(name='UVMap')
for p in me.polygons:
    vals = []
    for li in p.loop_indices:
        co = me.vertices[me.loops[li].vertex_index].co
        th = math.atan2(co.x, co.z - zc(co.y))          # 0 on top, ±π on the belly
        vals.append([(co.y - y0) / (y1 - y0), (th + math.pi) / (2 * math.pi)])
    vs = [v[1] for v in vals]
    if max(vs) - min(vs) > 0.5:                         # a face across the belly seam: keep it continuous
        for v in vals:
            if v[1] < 0.5: v[1] += 1.0
    for li, v in zip(p.loop_indices, vals):
        uv.data[li].uv = (v[0], v[1])

# ── fin: projected from the side ──
o = objs['Object_14']
me = o.data
set_mat(o, ['Fin'] * len(me.polygons))
ys = [v.co.y for v in me.vertices]; zs = [v.co.z for v in me.vertices]
fy0, fy1, fz0, fz1 = min(ys), max(ys), min(zs), max(zs)
while me.uv_layers:
    me.uv_layers.remove(me.uv_layers[0])
uv = me.uv_layers.new(name='UVMap')
for p in me.polygons:
    for li in p.loop_indices:
        co = me.vertices[me.loops[li].vertex_index].co
        uv.data[li].uv = ((co.y - fy0) / (fy1 - fy0), (co.z - fz0) / (fz1 - fz0))
# every mesh needs a UV layer for the exporter to keep one set for the textured parts
for o in objs.values():
    if not o.data.uv_layers:
        o.data.uv_layers.new(name='UVMap')

print('fuselage y %.3f..%.3f, fin y %.3f..%.3f z %.3f..%.3f' % (y0, y1, fy0, fy1, fz0, fz1))
bpy.ops.export_scene.gltf(filepath=OUT, export_format='GLB', export_apply=True, export_yup=True, export_image_format='AUTO')
print('WROTE', OUT)
