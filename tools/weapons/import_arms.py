# ═══════════════════════════════════════════════════════════════
# First-person arms for the on-foot view model (Blender, headless): re-export a rigged arms model with its
# skin and bones intact, materials converted to metal/roughness (the source uses the spec/gloss extension,
# which three.js no longer reads), textures downscaled and re-encoded as JPEG.
#   WEAPON_SRC=<dir> blender -b -P tools/weapons/import_arms.py -- 08ec4403a47645d8ad80633abf13d39d.glb models/weapons/arms.glb
# The game (src/weaponmodels.js) measures the bones and scales the rig to metres itself.
# ═══════════════════════════════════════════════════════════════
import bpy, sys, os
argv = sys.argv[sys.argv.index('--') + 1:]
src = argv[0] if os.path.isabs(argv[0]) else os.path.join(os.environ.get('WEAPON_SRC', '.'), argv[0])
OUT = argv[1]
TEX = int(argv[2]) if len(argv) > 2 else 1024
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=src)
for im in bpy.data.images:
    if im.size[0] > TEX or im.size[1] > TEX:
        s = TEX / max(im.size)
        im.scale(max(1, int(im.size[0] * s)), max(1, int(im.size[1] * s)))
# bone display shapes and other strays: only skinned meshes are kept
for o in list(bpy.data.objects):
    if o.type == 'MESH' and not any(m.type == 'ARMATURE' for m in o.modifiers):
        bpy.data.objects.remove(o)
for o in bpy.data.objects:
    if o.type != 'MESH': continue
    while len(o.data.uv_layers) > 1: o.data.uv_layers.remove(o.data.uv_layers[-1])
# plain metal/roughness: default specular and IOR, so the exporter writes no KHR_materials_specular / _ior
# (three.js would otherwise build a MeshPhysicalMaterial for them)
for m in bpy.data.materials:
    if not m.use_nodes: continue
    for n in m.node_tree.nodes:
        if n.type != 'BSDF_PRINCIPLED': continue
        for name, v in (('IOR', 1.5), ('Specular IOR Level', 0.5)):
            s = n.inputs.get(name)
            if s is None: continue
            for l in list(s.links): m.node_tree.links.remove(l)
            s.default_value = v
        s = n.inputs.get('Specular Tint')
        if s is not None:
            for l in list(s.links): m.node_tree.links.remove(l)
            s.default_value = (1, 1, 1, 1)
for o in bpy.data.objects:
    print('OBJ', o.type, o.name, tuple(round(v, 3) for v in o.scale), o.parent.name if o.parent else '')
print('IMAGES', [(im.name, tuple(im.size)) for im in bpy.data.images])
os.makedirs(os.path.dirname(os.path.abspath(OUT)), exist_ok=True)
bpy.ops.export_scene.gltf(filepath=OUT, export_format='GLB', export_yup=True, export_skins=True, export_animations=False,
                          export_image_format='JPEG', export_jpeg_quality=85)
print('EXPORTED', OUT, os.path.getsize(OUT) // 1024, 'KB')
