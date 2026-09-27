# Quick look at a room GLB (Blender, headless): renders a few views to PNGs.
#   blender -b -P tools/interiors/preview.py -- models/interiors/ssn_control.glb /tmp/out_prefix  x,y,z:tx,ty,tz[:fov] …
# Positions are in the GAME frame (x right, y up, −z forward); Workbench shading with material colours.
import bpy, sys, math
from mathutils import Vector

args = sys.argv[sys.argv.index('--') + 1:]
glb, prefix = args[0], args[1]
views = args[2:] or ['0,1.6,4:0,1.0,-4']
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=glb)
sc = bpy.context.scene
sc.render.engine = 'BLENDER_WORKBENCH'
sc.display.shading.light = 'STUDIO'
sc.display.shading.color_type = 'MATERIAL'
sc.display.shading.show_shadows = True
sc.display.shading.show_cavity = True
sc.render.resolution_x, sc.render.resolution_y = 1280, 720
cam = bpy.data.objects.new('cam', bpy.data.cameras.new('cam'))
sc.collection.objects.link(cam)
sc.camera = cam
G = lambda p: Vector((p[0], -p[2], p[1]))
for i, v in enumerate(views):
    parts = v.split(':')
    p = [float(x) for x in parts[0].split(',')]
    t = [float(x) for x in parts[1].split(',')]
    cam.data.lens_unit = 'FOV'
    cam.data.angle = math.radians(float(parts[2]) if len(parts) > 2 else 75)
    cam.data.clip_start = 0.02
    cam.location = G(p)
    d = G(t) - G(p)
    cam.rotation_mode = 'QUATERNION'
    cam.rotation_quaternion = d.to_track_quat('-Z', 'Y')
    sc.render.filepath = '%s_%d.png' % (prefix, i)
    bpy.ops.render.render(write_still=True)
    print('rendered', sc.render.filepath)
