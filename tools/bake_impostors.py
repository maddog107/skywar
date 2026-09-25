# ═══════════════════════════════════════════════════════════════
# Tree impostor baker (Blender, headless):
#   blender -b -P tools/bake_impostors.py -- <tree.gltf> <out_prefix> [frame_px] [object_name_filter]
# Renders a (very high-poly) tree model from 8 directions around it plus
# straight down into a 3×3 atlas with alpha: frames 0-7 = azimuth k·45°
# (looking at the tree from +Z rotated by k·45° about the up axis, slightly
# from above), frame 8 = top view. Lighting is a soft even sky so the game
# can shade the cards itself. Also writes <out_prefix>.json with the tree's
# real height / width and the frame layout.
# Source models: Poly Haven (CC0), e.g. fir_tree_01, island_tree_01/02.
# ═══════════════════════════════════════════════════════════════
import bpy, sys, math, json, os
from mathutils import Vector

argv = sys.argv[sys.argv.index('--') + 1:]
src, out = argv[0], argv[1]
FRAME = int(argv[2]) if len(argv) > 2 else 512
ONLY = argv[3] if len(argv) > 3 else None  # bake just the mesh objects whose name contains this (files holding several trees)
ELEV = math.radians(8)  # side views look slightly down, as a pilot usually does

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=src)
meshes = [o for o in bpy.context.scene.objects if o.type == 'MESH']
if ONLY:
    for o in meshes:
        if ONLY not in o.name: o.hide_render = True
    meshes = [o for o in meshes if ONLY in o.name]

# bounds in world space
lo = Vector((1e9, 1e9, 1e9)); hi = Vector((-1e9, -1e9, -1e9))
for o in meshes:
    for c in o.bound_box:
        w = o.matrix_world @ Vector(c)
        lo = Vector(map(min, lo, w)); hi = Vector(map(max, hi, w))
size = hi - lo
height = size.z
cx, cy = (lo.x + hi.x) / 2, (lo.y + hi.y) / 2
# widest the crown gets seen from any side: the furthest vertex from the trunk axis
radius = 0
for o in meshes:
    mw = o.matrix_world
    for v in o.data.vertices:
        w = mw @ v.co
        radius = max(radius, math.hypot(w.x - cx, w.y - cy))
print('BOUNDS', tuple(round(v, 2) for v in lo), tuple(round(v, 2) for v in hi), 'height', round(height, 2))

sc = bpy.context.scene
sc.render.engine = 'BLENDER_EEVEE' if 'BLENDER_EEVEE' in [e.identifier for e in bpy.types.RenderSettings.bl_rna.properties['engine'].enum_items] else 'BLENDER_EEVEE_NEXT'
sc.render.film_transparent = True
sc.render.resolution_x = sc.render.resolution_y = FRAME
sc.render.image_settings.file_format = 'PNG'
sc.render.image_settings.color_mode = 'RGBA'
sc.view_settings.view_transform = 'Standard'  # plain sRGB: the game does its own tone mapping
# soft sky + a gentle overhead key so the crown has shape
w = bpy.data.worlds.new('sky'); sc.world = w; w.use_nodes = True
bg = w.node_tree.nodes['Background']; bg.inputs[0].default_value = (0.9, 0.93, 1.0, 1); bg.inputs[1].default_value = 1.0
sun = bpy.data.objects.new('sun', bpy.data.lights.new('sun', 'SUN')); sc.collection.objects.link(sun)
sun.data.energy = 1.6; sun.rotation_euler = (math.radians(20), 0, 0)

cam = bpy.data.objects.new('cam', bpy.data.cameras.new('cam')); sc.collection.objects.link(cam); sc.camera = cam
cam.data.type = 'ORTHO'
# one ortho size for every side frame so all views line up: fits height and width
side_extent = max(height, 2 * radius) * 1.04
frames = []
tmp = []
for k in range(9):
    if k < 8:
        az = k * math.pi / 4
        d = 3 * max(height, radius) + 10
        # camera on a ring around the tree centre (Blender: Z up), looking at mid-height
        target = Vector((cx, cy, lo.z + height / 2))
        pos = target + Vector((math.sin(az) * math.cos(ELEV), -math.cos(az) * math.cos(ELEV), math.sin(ELEV))) * d
        cam.data.ortho_scale = side_extent
    else:
        target = Vector((cx, cy, lo.z + height / 2))
        pos = target + Vector((0, 0, 3 * height + 10))
        cam.data.ortho_scale = 2 * radius * 1.04
    cam.location = pos
    cam.rotation_euler = (target - pos).to_track_quat('-Z', 'Y').to_euler()
    cam.data.clip_end = 10 * (height + radius) + 100
    path = f'{out}_f{k}.png'
    sc.render.filepath = path
    bpy.ops.render.render(write_still=True)
    tmp.append(path)

# pack the 9 frames into a 3×3 atlas
atlas = bpy.data.images.new('atlas', 3 * FRAME, 3 * FRAME, alpha=True)
px = [0.0] * (3 * FRAME * 3 * FRAME * 4)
for k, path in enumerate(tmp):
    img = bpy.data.images.load(path)
    src_px = list(img.pixels)
    col, row = k % 3, 2 - k // 3  # Blender images are bottom-up: frame 0 at the top-left
    for y in range(FRAME):
        s0 = y * FRAME * 4
        d0 = ((row * FRAME + y) * 3 * FRAME + col * FRAME) * 4
        px[d0:d0 + FRAME * 4] = src_px[s0:s0 + FRAME * 4]
    bpy.data.images.remove(img)
    os.remove(path)
# edge padding: spread leaf colour into the transparent area so mipmapped (distant) trees don't get dark halos
import numpy as np
a = np.array(px, dtype=np.float32).reshape(3 * FRAME, 3 * FRAME, 4)
rgb, alpha = a[..., :3].copy(), a[..., 3]
filled = alpha > 0.5
for _ in range(24):
    if filled.all(): break
    acc = np.zeros_like(rgb); cnt = np.zeros(filled.shape, np.float32)
    for dy, dx in ((1, 0), (-1, 0), (0, 1), (0, -1)):
        f = np.roll(filled, (dy, dx), (0, 1)); c = np.roll(rgb, (dy, dx), (0, 1))
        acc += c * f[..., None]; cnt += f
    grow = (~filled) & (cnt > 0)
    rgb[grow] = acc[grow] / cnt[grow][:, None]
    filled = filled | grow
opaque = alpha > 0.5
if opaque.any(): rgb[~filled] = rgb[opaque].mean(axis=0)  # the rest: the tree's average colour (deep mips)
a[..., :3] = rgb
atlas.pixels = a.ravel().tolist()
atlas.filepath_raw = f'{out}.png'
atlas.file_format = 'PNG'
atlas.save()
meta = {
    'source': os.path.basename(src), 'height': round(height, 3), 'radius': round(radius, 3),
    'frame': FRAME, 'grid': 3, 'sideFrames': 8, 'topFrame': 8, 'elevationDeg': math.degrees(ELEV),
    'sideExtent': round(side_extent, 3), 'topExtent': round(2 * radius * 1.04, 3),
    'note': 'frames 0-7: viewed from azimuth k*45deg around the tree (0 = from -Y in Blender = +Z in three.js), frame 8: from above; sRGB, straight alpha',
}
json.dump(meta, open(f'{out}.json', 'w'), indent=1)
print('WROTE', f'{out}.png', meta)
