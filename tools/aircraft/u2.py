# Lockheed U-2S Dragon Lady — SKYWAR support-aircraft build.
#   /opt/homebrew/bin/blender -b -P tools/aircraft/u2.py -- ER2_AFRC_AIR_0626.glb models/aircraft/u2.glb
# SRC: NASA Airborne Science Program 3D model "ER2_AFRC_AIR_0626" (NASA Armstrong's ER-2, a U-2S derivative:
# the same TR-1/U-2R airframe and F118 engine), https://airbornescience.nasa.gov/3d-models — NASA content, not
# subject to copyright in the US (https://www.nasa.gov/nasa-brand-center/images-and-media/); credit NASA.
# Changes: repainted in the U-2S's overall black (the NASA white scheme, worm, meatball and numbers removed by a
# monochrome repaint of the base-colour atlas), welded, normal / metal-rough maps dropped, textures 1024 px.
# U-2S: length 19.2 m, span 31.4 m, height 4.88 m; the "superpods" on the wings and the wingtip skids are kept.
# s = metres aft of the nose, x right, z up (tools/aircraft_kit.py).
import os, sys, math, re
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import support_kit as SK
import aircraft_kit as K
import bpy

ARGS = sys.argv[sys.argv.index('--') + 1:]
SRC, OUT = ARGS[0], ARGS[1]
L = 19.2

SK.begin('u2', L, paint='#1e2023', dark='#141517')
air = SK.load(SRC, nose='-Y', weld_first=True)
SK.fit(air, L)
o = air[0]
# the ER-2's belly instrument pod and a one-sided sensor fairing under the right wing (a U-2S carries neither)
print('ER-2 extras', SK.delete_loose(lambda a, b, n: (b.z < -0.4 and abs(a.x) < 0.3 and abs(b.x) < 0.3 and 9.5 < -b.y and -a.y < 13.2 and n > 300)
                                     or (a.x > 8.9 and b.x < 9.4 and 10.3 < -b.y and -a.y < 12.8 and 80 < n < 200), [o]))

# ── paint: the base-colour atlases (PaintM / PaintPM) in one colour, keeping the panel shading; the glass and
#    metal materials share the atlases, so repaint the images once ──
SK.mono('#26282b', mat_rx=r'^Paint(P)?M$', sat_lim=0.18)
# keep only the base colour (the 4096 px normal / metal-rough maps cost megabytes and the game re-shades anyway)
for m in bpy.data.materials:
    if not m.use_nodes or not re.match(r'^(Paint|Glass|Metal)P?M$', m.name):
        continue
    b = m.node_tree.nodes.get('Principled BSDF')
    for inp in ('Normal', 'Metallic', 'Roughness', 'Emission Color'):
        if inp in b.inputs:
            for l in list(b.inputs[inp].links):
                m.node_tree.links.remove(l)
    glass = m.name.startswith('Glass')
    b.inputs['Metallic'].default_value = 0.1 if not glass else 0.2
    b.inputs['Roughness'].default_value = 0.55 if not glass else 0.12
for n in list(bpy.data.images):
    if n.users == 0:
        bpy.data.images.remove(n)
SK.shrink_textures(1024)

# ── the exhaust and the cockpit, measured on the model ──
mn, mx = SK.bbox([o])
tail = SK.section([o], s=L - 0.12, pred=lambda p: abs(p.x) < 1.0 and p.z < 1.5)
print('tail section', tail)
glass_idx = {i for i, m in enumerate(o.data.materials) if m and m.name.startswith('Glass')}
gl = [o.matrix_world @ o.data.vertices[v].co for p in o.data.polygons if p.material_index in glass_idx for v in p.vertices]
gl = [v for v in gl if abs(v.x) < 0.5 and -v.y < 8 and v.z > 0.4]   # the canopy (not the nose's sensor windows)
if gl:
    gs0, gs1 = min(-v.y for v in gl), max(-v.y for v in gl)
    gz0, gz1 = min(v.z for v in gl), max(v.z for v in gl)
    print('canopy s %.2f..%.2f z %.2f..%.2f' % (gs0, gs1, gz0, gz1))
SK.finish(OUT)
ez = (tail[2] + tail[3]) / 2 if tail else 0.6
print('NOZZLES', [SK.frac(L - 0.05, 0.0, ez)])
if gl:
    print('COCKPIT', SK.frac(gs0 + 0.55 * (gs1 - gs0), 0.0, gz1 - 0.3))   # the pilot's eye, under the canopy top
