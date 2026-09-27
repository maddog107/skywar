# Tupolev Tu-95MS "Bear-H" — SKYWAR support-aircraft kit build.
#   /opt/homebrew/bin/blender -b -P tools/aircraft/tu95.py -- SRC.glb models/aircraft/tu95.glb
# SRC: "Tu95" by manilov.ap (CC BY 4.0), https://sketchfab.com/3d-models/tu95-1eac97ec49ed4f1da8b7deb1e1b2cc7a
# (Objaverse glbs/000-114/1eac97ec49ed4f1da8b7deb1e1b2cc7a.glb): a Tu-95MS (solid radome, nose refuelling probe,
# tail turret, Russian flag), exported yawed 39° in the ground plane with its gear down.
# Changes: straightened; the static propellers (blades and blur discs) removed — the game spins eight props of its
# own on the model's spinners (MODEL_FILES props: four contra-rotating pairs, AV-60K, 5.6 m); the landing gear, gear
# doors and the HF wire removed, the gear bays covered; the wing stretched spanwise outboard of the root (x1.041) to the real 50.1 m span.
# Real size: 46.2 m long without the probe (48.9 m probe tip to the fin-tip fairing, measured on the three-view
# https://commons.wikimedia.org/wiki/File:Tupolev_Tu-95MS_3-view.svg), span 50.1 m, height 12.12 m.
# s = metres aft of the nose (the probe tip), x right, z up.
import os, sys, math, re
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import support_kit as SK
import aircraft_kit as K
from aircraft_kit import S
from mathutils import Vector, Matrix

ARGS = sys.argv[sys.argv.index('--') + 1:]
SRC, OUT = ARGS[0], ARGS[1]
L, SPAN = 48.9, 50.1

SK.begin('tu95', L)
air = SK.load(SRC, nose='+Y')
R = Matrix.Rotation(math.radians(-129.002), 4, 'Z')        # fuselage axis at 39.0° → nose to +Y
for o in air:
    o.data.transform(R)
SK.fit(air, L)
obj = {re.sub(r'^src_(.*?)-FACES.*$', r'\1', o.name) + ('' if o.name.endswith('.001') else o.name[-4:]): o for o in air}
def by(rx):
    r = re.compile(rx)
    return [o for o in SK.meshes() if r.match(o.name[len('src_'):])]

# ── clean-up ──
props = by(r'VINT\d+-') + [o for o in by(r'Cylinder(5[6-9]|[6-7]\d|8[0-7])-')]      # blur discs + 32 blades
tyres = by(r'Torus\d+-')
doors = by(r'stv_')
nose_gear = by(r'Cylinder(39|4[0-8]|5[0-3])-') + by(r'Line03-')
main_gear = by(r'Cylinder(0[1-6]|19|2\d|3[0-8])-') + by(r'Box(02|03|09|19|20|21)-') + by(r'Line(02|50)-')
wire = by(r'Line01-')
print('delete: props %d, tyres %d, doors %d, nose gear %d, main gear %d, wire %d' % (len(props), len(tyres), len(doors), len(nose_gear), len(main_gear), len(wire)))
SK.delete(props + tyres + doors + nose_gear + main_gear + wire)

# ── gear doors closed: the model's doors hang open, so the bays get covers in their place, following the
#    rounded belly between the doors' hinge lines (main gear under the inboard nacelle pods, nose gear under the
#    cockpit), in the skin colour of the nacelles ──
import numpy as np
def tex_mean(mat_rx):
    for m in bpy.data.materials:
        if not re.search(mat_rx, m.name) or not m.use_nodes:
            continue
        b = m.node_tree.nodes.get('Principled BSDF')
        if b and b.inputs['Base Color'].links and b.inputs['Base Color'].links[0].from_node.type == 'TEX_IMAGE':
            im = b.inputs['Base Color'].links[0].from_node.image
            px = np.empty(im.size[0] * im.size[1] * 4, np.float32); im.pixels.foreach_get(px)
            c = px.reshape(-1, 4)[:, :3].mean(0)          # linear
            srgb = [((1.055 * v ** (1 / 2.4) - 0.055) if v > 0.0031308 else 12.92 * v) for v in c]
            return '#%02x%02x%02x' % tuple(int(max(0, min(1, v)) * 255) for v in srgb)
    return '#a9adae'
import bpy
skin = tex_mean(r'^dvig06-FACES$')
print('bay door colour', skin)
K.material('BayDoor', skin, 0.12, 0.55, panel={'key': 'panel'})
covers = []
for sd in (1, -1):
    covers.append(K.loft('MainBayDoor' + ('R' if sd > 0 else 'L'), [
        S(19.1, 0.36, 0.02, 0.07, z=-1.11, x=sd * 6.19), S(20.9, 0.39, 0.02, 0.09, z=-1.11, x=sd * 6.19),
        S(21.05, 0.47, 0.02, 0.11, z=-1.12, x=sd * 6.19), S(23.1, 0.47, 0.02, 0.11, z=-1.13, x=sd * 6.19)], material='BayDoor', ring=24))
covers.append(K.loft('NoseBayDoor', [S(6.86, 0.66, 0.02, 0.12, z=-1.06, x=-0.03), S(10.83, 0.66, 0.02, 0.12, z=-1.06, x=-0.03)], material='BayDoor', ring=24))
# The covers get the source meshes' layers: a 'UVMap' UV layer, and the 'Color' vertex colours the source carries
# (its material colours, which three.js multiplies in) at the nacelle skin's value. Without them the joined
# airframe (led by a cover: names sort before 'src_') ends up with two UV maps and a second, white colour layer
# as COLOR_0, which the game's merge reads unnormalised (x255): the whole aircraft renders flat white.
nac = next(o for o in SK.meshes() if o.data.color_attributes.get('Color') and any(m and m.name == 'dvig06-FACES' for m in o.data.materials))
vd = nac.data.color_attributes['Color'].data
vc = tuple(sum(c.color[i] for c in vd) / len(vd) for i in range(4))
print('cover vertex colour', [round(v, 3) for v in vc])
for o in covers:
    me = o.data
    me.uv_layers.new(name='UVMap')
    ca = me.color_attributes.new('Color', 'BYTE_COLOR', 'CORNER')
    for d in ca.data:
        d.color = vc
    me.color_attributes.active_color = ca
    me.color_attributes.render_color_index = 0

# ── the wing to its real span (outboard of the fuselage side, forward of the tailplane) ──
mn, mx = SK.bbox()
half = max(-mn.x, mx.x)
XR = 1.5
KW = (SPAN / 2 - XR) / (half - XR)
print('span %.2f -> %.2f (x%.4f)' % (2 * half, SPAN, KW))
SK.stretch(lambda w: abs(w.x) > XR and -w.y < 36.0, lambda w: Vector((math.copysign((abs(w.x) - XR) * (KW - 1), w.x), 0, 0)))

# ── probes: spinners (the prop hubs), exhaust stacks, the probe tip, the cockpit ──
hubs = []
for o in by(r'Sphere(01|02|10|11)-'):
    a, b = SK.bbox([o])
    hubs.append(((a.x + b.x) / 2, -b.y, (a.z + b.z) / 2))   # front of the spinner
hubs.sort()
print('SPINNERS', [(round(x, 2), round(s, 2), round(z, 2)) for x, s, z in hubs])
exh = []
for o in by(r'Object\d+-'):
    a, b = SK.bbox([o])
    exh.append(((a.x + b.x) / 2, -a.y, (a.z + b.z) / 2))
# one contrail point per engine: average the stacks on each nacelle
eng = {}
for x, s, z in exh:
    k = round(x / 3)
    e = eng.setdefault(k, [0, 0, 0, 0]); e[0] += x; e[1] = max(e[1], s); e[2] += z; e[3] += 1
print('EXHAUSTS', {k: (round(v[0] / v[3], 2), round(v[1], 2), round(v[2] / v[3], 2), v[3]) for k, v in eng.items()})
pa, pb = SK.bbox(by(r'Cylinder08-'))
print('PROBE s %.2f..%.2f x %.2f..%.2f z %.2f..%.2f' % (-pb.y, -pa.y, pa.x, pb.x, pa.z, pb.z))
ka, kb = SK.bbox(by(r'kabina-'))
print('CABIN s %.2f..%.2f z %.2f..%.2f' % (-kb.y, -ka.y, ka.z, kb.z))

SK.finish(OUT)
# props: AV-60K contra-rotating pairs, 5.6 m: the front prop (4 blades) turns clockwise seen from behind, the rear
# one, 0.75 m further aft, the other way. The discs sit where the model's blades were: 0.88 and 1.63 m aft of the
# spinner's tip. Left and right are averaged (the file is off-centre by ~3 cm).
mn, mx = SK.bbox(SK.meshes(False))
Lb = mx.y - mn.y
inb = [h for h in hubs if abs(h[0]) < 9]; outb = [h for h in hubs if abs(h[0]) >= 9]
out = []
for grp in (outb, inb):
    ax = sum(abs(h[0]) for h in grp) / len(grp); s = sum(h[1] for h in grp) / len(grp); z = sum(h[2] for h in grp) / len(grp)
    for sd in (-1, 1):
        for d, ds in ((1, 0.88), (-1, 1.63)):
            f = SK.frac(s + ds, sd * ax, z)
            out.append('{ x: %s, y: %s, z: %s, r: %.4f, blades: 4, dir: %d }' % (f[0], f[1], f[2], 2.8 / Lb, d))
print('PROPS [' + ', '.join(out) + ']')
print('NOZZLES', [SK.frac(v[1], v[0] / v[3], v[2] / v[3]) for v in eng.values()])
print('REFUEL', SK.frac(-pb.y, (pa.x + pb.x) / 2, (pa.z + pb.z) / 2))
print('COCKPIT', SK.frac((-kb.y - ka.y) / 2 + 0.3, 0.0, kb.z - 0.3))
