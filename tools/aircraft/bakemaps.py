# ═══════════════════════════════════════════════════════════════
# Bake where every texel of a model's texture lies on the airframe, for painting a new livery (Blender, headless).
#   blender -b -P tools/aircraft/bakemaps.py -- SRC.glb OUTDIR --mat REGEX [--size N] [--unwrap WxH] [--uv-only]
# For the materials whose name matches REGEX (they share one base-colour texture, or get a new one with --unwrap),
# writes into OUTDIR:
#   maps.npz     pos (H×W×3, metres, the source file's frame after import: Blender axes, Z up), nrm (H×W×3, unit
#                normals, same frame), cover (H×W, 1 where a face is mapped, 0 in the gutters), all rows top-down
#                like the PNG
#   base.png     the texture as it is (top-down), when the materials have one
# --unwrap WxH   the materials have no usable texture: give their meshes a fresh UV layout (Smart UV Project, the
#                islands packed with a margin) on a WxH texture; the new UVs are saved in uv.npz (per object: the
#                loop UVs) for tools/aircraft/import_model.py --uv-from to put back on the model it imports
# Painted textures go back into the model with import_model.py --image 'REGEX=painted.png'. The painting itself is
# tools/aircraft/livery.py (plain Python 3, numpy + Pillow) and each aircraft's paint_<id>.py.
# ═══════════════════════════════════════════════════════════════
import bpy, sys, os, re, math
import numpy as np

argv = sys.argv[sys.argv.index('--') + 1:]
SRC, OUT = argv[0], argv[1]
def opt(n, d=None):
    return argv[argv.index(n) + 1] if n in argv else d
RX = re.compile(opt('--mat', '.'))
os.makedirs(OUT, exist_ok=True)

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=SRC)
sc = bpy.context.scene

mats = [m for m in bpy.data.materials if RX.search(m.name) and m.use_nodes]
objs = [o for o in bpy.data.objects if o.type == 'MESH' and any(m in mats for m in o.data.materials)]
print('materials', [m.name for m in mats], 'objects', len(objs))
if not mats or not objs:
    raise SystemExit('no material matches ' + opt('--mat', '.'))

def base_image(m):
    b = next((n for n in m.node_tree.nodes if n.type == 'BSDF_PRINCIPLED'), None)
    if b and b.inputs['Base Color'].links:
        n = b.inputs['Base Color'].links[0].from_node
        while n and n.type != 'TEX_IMAGE' and n.inputs:   # (through a mix / multiply node)
            ls = [l for i in n.inputs for l in i.links]
            n = ls[0].from_node if ls else None
        if n and n.type == 'TEX_IMAGE':
            return n.image
    return None

unwrap = opt('--unwrap')
if unwrap:
    W, H = [int(v) for v in unwrap.lower().split('x')]
    # one fresh UV layer for all the objects together: islands packed into one texture
    bpy.ops.object.select_all(action='DESELECT')
    for o in objs:
        o.select_set(True)
        while o.data.uv_layers:
            o.data.uv_layers.remove(o.data.uv_layers[0])
        o.data.uv_layers.new(name='UVMap')
    bpy.context.view_layer.objects.active = objs[0]
    bpy.ops.object.mode_set(mode='EDIT')
    bpy.ops.mesh.select_all(action='SELECT')
    bpy.ops.uv.smart_project(angle_limit=math.radians(float(opt('--angle', 50))), island_margin=float(opt('--margin', 0.004)),
                             area_weight=0.0, correct_aspect=True, scale_to_bounds=False)
    bpy.ops.uv.pack_islands(rotate=True, margin=float(opt('--margin', 0.004)))
    bpy.ops.object.mode_set(mode='OBJECT')
    np.savez_compressed(os.path.join(OUT, 'uv.npz'), **{o.name: np.array([c for l in o.data.uv_layers[0].data for c in l.uv], np.float32) for o in objs})
    img0 = None
else:
    imgs = {base_image(m) for m in mats} - {None}
    if len(imgs) != 1:
        raise SystemExit('the materials need exactly one base-colour texture between them, found %s' % [i.name for i in imgs])
    img0 = imgs.pop()
    W, H = int(opt('--size', img0.size[0])), int(opt('--size', img0.size[1]))
    im2 = img0.copy(); im2.filepath_raw = os.path.join(OUT, 'base.png'); im2.file_format = 'PNG'; im2.save()

if '--uv-only' in argv:
    print('UV only'); raise SystemExit

# ── bake position and normal (world = the file's frame: import puts every object where it belongs) ──
sc.render.engine = 'CYCLES'
sc.cycles.device = 'CPU'
sc.cycles.samples = 1
sc.render.bake.margin = int(opt('--bake-margin', 6))
sc.render.bake.margin_type = 'EXTEND'
targets = {}
for key in ('pos', 'nrm', 'cov'):
    targets[key] = bpy.data.images.new('bake_' + key, W, H, alpha=True, float_buffer=True)
    targets[key].generated_color = (0, 0, 0, 0)

saved = {}
for m in mats:
    nt = m.node_tree
    out = next(n for n in nt.nodes if n.type == 'OUTPUT_MATERIAL' and n.is_active_output)
    saved[m.name] = [l.from_socket for l in out.inputs['Surface'].links]
    geo = nt.nodes.new('ShaderNodeNewGeometry')
    em = nt.nodes.new('ShaderNodeEmission')
    tex = nt.nodes.new('ShaderNodeTexImage')
    nt.links.new(em.outputs['Emission'], out.inputs['Surface'])
    m['_bake'] = (geo.name, em.name, tex.name, out.name)

bpy.ops.object.select_all(action='DESELECT')
for o in objs:
    o.select_set(True)
bpy.context.view_layer.objects.active = objs[0]

def bake(key, socket):
    for m in mats:
        nt = m.node_tree
        g, e, t, _ = [nt.nodes[n] for n in m['_bake']]
        t.image = targets[key]
        nt.nodes.active = t
        for l in list(e.inputs['Color'].links):
            nt.links.remove(l)
        if socket:
            nt.links.new(g.outputs[socket], e.inputs['Color'])
        else:
            e.inputs['Color'].default_value = (1, 1, 1, 1)
    bpy.ops.object.bake(type='EMIT', save_mode='INTERNAL', margin=sc.render.bake.margin if key != 'cov' else 0)
    a = np.array(targets[key].pixels[:], np.float32).reshape(H, W, 4)[::-1]
    return a

pos = bake('pos', 'Position')[:, :, :3]
nrm = bake('nrm', 'Normal')[:, :, :3]
cov = bake('cov', None)[:, :, 0]
ln = np.linalg.norm(nrm, axis=2, keepdims=True)
nrm = nrm / np.maximum(ln, 1e-6)
np.savez_compressed(os.path.join(OUT, 'maps.npz'), pos=pos.astype(np.float32), nrm=nrm.astype(np.float16), cover=(cov > 0.5).astype(np.uint8))
print('BAKED', W, H, 'covered %.1f%%' % (100 * (cov > 0.5).mean()), '->', OUT)
