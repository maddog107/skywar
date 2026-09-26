# General Atomics MQ-9A Reaper (extended-range wing) — SKYWAR support-aircraft build.
#   /opt/homebrew/bin/blender -b -P tools/aircraft/mq9.py -- SRC.glb models/aircraft/mq9.glb
# SRC: "MQ-9 Reaper" by Tyler V Howell (TVHowell), CC BY 4.0,
# https://sketchfab.com/3d-models/mq-9-reaper-eff549610fee4f20904f7b388a3a0830
# (Objaverse glbs/000-020/eff549610fee4f20904f7b388a3a0830.glb).
# Changes: nose turned to +Y, scaled to the real 11.0 m length; its proportions are those of the 79 ft (24 m)
# extended-range wing, so the outer panels are brought in slightly to exactly 24.0 m span; the static three-blade
# propeller removed (the game spins its own on the model's spinner: MODEL_FILES props); the eight Hellfires
# decimated (they were ~20k triangles); normal / metal-roughness maps dropped (base colour kept) and the textures
# downscaled (1024 airframe, 512 stores). Loadout as modelled: AGM-114 Hellfires and GBU-12s.
# Real size: length 11.0 m, span 24.0 m (ER wing; 20.1 m standard), height 3.8 m.
# s = metres aft of the nose, x right, z up (tools/aircraft_kit.py).
import os, sys, math, re
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import support_kit as SK
import aircraft_kit as K
import bpy
from mathutils import Vector

ARGS = sys.argv[sys.argv.index('--') + 1:]
SRC, OUT = ARGS[0], ARGS[1]
L = 11.0
SPAN = 24.0

SK.begin('mq9', L, paint='#a3a8ab', dark='#1d1f21')
air = SK.load(SRC, nose='+X')

def box(o):
    a, b = SK.bbox([o]); return a, b, b - a, (a + b) / 2

# the static propeller: a thin disc of blades (thinnest object fore-aft for its size across)
blades = max(air, key=lambda o: (box(o)[2].x + box(o)[2].z) / max(box(o)[2].y, 1e-4))
ba, bb, bd, bc = box(blades)
# the spinner: the smallest object sitting on the blade disc's centre
spinner = min((o for o in air if o is not blades and (box(o)[3] - bc).length < 0.3), key=lambda o: SK.tris([o]))
sa, sb, sd, scn = box(spinner)
ax, az = scn.x, scn.z
R_src = max(math.hypot(v.co.x - ax, v.co.z - az) for v in blades.data.vertices)
hub_src = Vector((ax, bc.y, az))
print('blades', blades.name, SK.tris([blades]), 'spinner', spinner.name, 'hub', hub_src, 'R', R_src)
SK.delete([blades])
air = [o for o in air if o is not blades]

# nose tip → s = 0, the real length (nose to spinner tip); convert the hub through the same transform
mn0, mx0 = SK.bbox(air)
k = SK.fit(air, L)
cx = (mn0.x + mx0.x) / 2
hub = ((mx0.y - hub_src.y) * k, (hub_src.x - cx) * k, hub_src.z * k)
R_prop = R_src * k
print('scale %.4f  hub (s, x, z) %s  prop radius %.2f m' % (k, [round(v, 3) for v in hub], R_prop))

# stores: the Hellfires are over-tessellated
for o in air:
    if any(m and m.name.startswith('Rocket_mat') for m in o.data.materials):
        SK.decimate(0.22, [o])
print('tris after decimation', SK.tris(air))

# ER wing → exactly 24.0 m: bring the outer panels in (outboard of the outer pylons, 4.0 m out)
mn, mx = SK.bbox(air)
semi = max(-mn.x, mx.x)
X0 = 4.0
kw = (SPAN / 2 - X0) / (semi - X0)
print('semispan %.2f → %.2f (outer panels x%.3f)' % (semi, SPAN / 2, kw))
SK.stretch(lambda w: abs(w.x) > X0, lambda w: Vector(((abs(w.x) - X0) * (kw - 1) * (1 if w.x > 0 else -1), 0, 0)), air)  # (copysign would drop the minus)

# textures: base colour only (drop normal / metallic-roughness maps), 1024 for the airframe, 512 for the stores
for m in bpy.data.materials:
    if not m.use_nodes:
        continue
    b = m.node_tree.nodes.get('Principled BSDF')
    if not b:
        continue
    for inp in ('Normal', 'Metallic', 'Roughness', 'Emission Color'):
        if inp in b.inputs:
            for l in list(b.inputs[inp].links):
                m.node_tree.links.remove(l)
    b.inputs['Metallic'].default_value = 0.15
    b.inputs['Roughness'].default_value = 0.55
    for n in list(m.node_tree.nodes):
        if n.type == 'TEX_IMAGE' and not any(l.to_socket == b.inputs['Base Color'] for l in n.outputs['Color'].links):
            m.node_tree.nodes.remove(n)
    keep = 1024 if re.search(r'^(Body|Wing)_mat', m.name) else 512
    for n in m.node_tree.nodes:
        if n.type == 'TEX_IMAGE' and n.image and max(n.image.size) > keep:
            s = keep / max(n.image.size)
            n.image.scale(max(1, int(n.image.size[0] * s)), max(1, int(n.image.size[1] * s)))
for im in list(bpy.data.images):
    if im.users == 0:
        bpy.data.images.remove(im)
print('images', [(im.name, tuple(im.size)) for im in bpy.data.images if im.size[0]])
# the airframe textures are nearly white (median sRGB 0.90): a light-medium USAF grey, as on the real aircraft,
# through the glTF colour factor (SK.finish → K._patch_glb writes STATE['factors'] as baseColorFactor)
for n in ('Body_mat', 'Wing_mat', 'CameraSystem_mat', 'Extras_mat', 'Rocket_system_mat'):
    K.STATE['factors'][n] = [0.52, 0.52, 0.52, 1.0]

air_obj = SK.finish(OUT)
fr = SK.frac(*hub)
mn, mx = SK.bbox(SK.meshes(False))
Lb = mx.y - mn.y
print('PROPS', {'x': fr[0], 'y': fr[1], 'z': fr[2], 'r': round(R_prop / Lb, 4), 'blades': 3})
print('COCKPIT', SK.frac(0.45, 0.0, hub[2] + 0.1))
