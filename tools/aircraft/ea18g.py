# Boeing EA-18G Growler — SKYWAR build, derived from the game's own F/A-18F model.
#   /opt/homebrew/bin/blender -b -P tools/aircraft/ea18g.py -- models/aircraft/fa18.glb models/aircraft/ea18g.glb
# SRC: models/aircraft/fa18.glb, i.e. "Low poly 1:1 F/A-18F SuperHornet" by WTigerTw (Yi Tsung Lee), CC BY 4.0,
# https://sketchfab.com/3d-models/low-poly-11-fa-18f-superhornet-635e68b7a0d24ac29c10f5fb9110129f (as cleaned for
# the game, tools/aircraft/IMPORTS.md). The EA-18G is the two-seat F airframe; changes:
#  - the wingtip AIM-9s and their rails → AN/ALQ-218(V)2 receiver pods
#  - a typical Growler load: AGM-88 HARM on stations 2/10, AN/ALQ-99 tactical jamming pods (with their ram-air
#    turbines) on 3/9 and the centreline (6), the 480 gal tanks kept on 4/8, AIM-120C AMRAAM on the fuselage
#    stations 5/7
#  - the ALQ-227 / datalink blade antennas on the spine
#  - squadron titles repainted for VAQ-133 "Wizards" (CVW-9, tail code NG) in this model's own copy of the texture
# The bounding box stays exactly the F/A-18F's (the centreline pod reaches the old centreline tank's lowest point),
# so the fa18 flap and brake definitions (src/surfacedefs.js) line up unchanged. Coordinates: Blender, nose +Y
# (the file's own metres: 18.79 long, rescaled by the game to 18.31 m), kit s = -y.
import os, sys, math
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import support_kit as SK
import aircraft_kit as K
from aircraft_kit import S
import bpy, bmesh

ARGS = sys.argv[sys.argv.index('--') + 1:]
SRC, OUT = ARGS[0], ARGS[1]

SK.begin('ea18g', 18.79, paint='#5f6468', paint2='#565b5f', radome='#4b5054', dark='#1c1e20', nozzle='#4a4541')
K.material('Pod', '#6a7075', 0.1, 0.55, panel={'key': 'panel'})         # jammer / receiver pod grey
K.material('PodDark', '#3a3f43', 0.1, 0.6)                              # pod radomes
K.material('Store', '#b9bab5', 0.1, 0.5)                                # missiles (white-grey)
K.material('Band', '#c9a227', 0.1, 0.5)                                 # live-round yellow band
K.material('Blue', '#2e4f86', 0.1, 0.5)                                 # training / seeker bands
air = SK.load(SRC, nose='+Y')[0]
mn0, mx0 = SK.bbox([air])
print('SOURCE BBOX', [round(v, 4) for v in mn0], [round(v, 4) for v in mx0])
MATS = [m.name for m in air.data.materials]
STORE = MATS.index('Material')          # the stores' texture
SKIN = MATS.index('Material.001')       # the airframe skin

def parts_with_mat(o):
    """loose parts with the material of their first face: [(verts, min, max, n, mat)]"""
    bm = bmesh.new(); bm.from_mesh(o.data); bm.verts.ensure_lookup_table()
    vmat = {}
    for f in bm.faces:
        for v in f.verts:
            vmat.setdefault(v.index, f.material_index)
    bm.free()
    return [(vs, a, b, len(vs), vmat.get(vs[0], -1)) for vs, a, b in SK.loose_parts(o)]

def delete_where(o, pred):
    kill, n = set(), 0
    for vs, a, b, cnt, mat in parts_with_mat(o):
        if pred(a, b, cnt, mat):
            kill.update(vs); n += 1
    if kill:
        bm = bmesh.new(); bm.from_mesh(o.data); bm.verts.ensure_lookup_table()
        bmesh.ops.delete(bm, geom=[bm.verts[i] for i in kill], context='VERTS')
        bm.to_mesh(o.data); bm.free()
    return n

ax = lambda a, b: (min(abs(a.x), abs(b.x)), max(abs(a.x), abs(b.x))) if a.x * b.x > 0 else (0.0, max(abs(a.x), abs(b.x)))
# wingtip AIM-9s and their launch rails (everything outboard of the wing tip)
print('wingtip stores', delete_where(air, lambda a, b, n, m: ax(a, b)[0] > 6.44 and n < 400))
# station 2/10 missiles and their launchers, station 3/9 missiles (the pylons there are airframe material: kept)
print('station 2/10', delete_where(air, lambda a, b, n, m: m == STORE and ax(a, b)[0] > 4.25 and ax(a, b)[1] < 4.95 and b.z < -1.0))
print('station 3/9', delete_where(air, lambda a, b, n, m: m == STORE and ax(a, b)[0] > 3.15 and ax(a, b)[1] < 3.9 and b.z < -1.1))
# the centreline tank
print('centreline tank', delete_where(air, lambda a, b, n, m: m == STORE and ax(a, b)[1] < 0.4 and b.z < -1.4))

s_ = lambda y: -y         # kit station from a Blender y
Y = K.Y

# ── ALQ-218(V)2 wingtip pods: a slim body with receiver radomes at both ends ──
TIPX, TIPZ = 6.555, -0.555
for sd in (1, -1):
    x = sd * TIPX
    K.loft('ALQ218' + ('R' if sd > 0 else 'L'), [S(s_(-1.15), 0.012, 0.012, x=x, z=TIPZ), S(s_(-1.45), 0.08, 0.08, x=x, z=TIPZ), S(s_(-1.9), 0.135, 0.135, x=x, z=TIPZ),
                                                   S(s_(-2.5), 0.15, 0.15, x=x, z=TIPZ), S(s_(-3.9), 0.15, 0.15, x=x, z=TIPZ), S(s_(-4.35), 0.13, 0.13, x=x, z=TIPZ),
                                                   S(s_(-4.6), 0.07, 0.07, x=x, z=TIPZ)],
           material='Pod', ring=20, mat_ranges=[(s_(-1.15), s_(-1.9), 'PodDark'), (s_(-4.3), s_(-4.6), 'PodDark')])

# ── AN/ALQ-99 jamming pods: nose ram-air turbine, rounded body, radomes at each end, on stations 3/9 and 6 ──
def alq99(name, x, zc, y0, length=4.72, w=0.32, h=0.36):
    s0 = s_(y0)
    K.loft(name, [S(s0 + 0.18, 0.05, 0.05, z=zc, x=x), S(s0 + 0.32, w * 0.62, h * 0.62, z=zc, x=x, nt=2.4, nb=2.4), S(s0 + 0.8, w * 0.95, h * 0.95, z=zc, x=x, nt=2.6, nb=2.6),
                  S(s0 + 1.3, w, h, z=zc, x=x, nt=2.7, nb=2.7), S(s0 + length - 1.1, w, h, z=zc, x=x, nt=2.7, nb=2.7),
                  S(s0 + length - 0.35, w * 0.8, h * 0.78, z=zc, x=x, nt=2.4, nb=2.4), S(s0 + length, w * 0.35, h * 0.3, z=zc, x=x)],
           material='Pod', ring=24, mat_ranges=[(s0, s0 + 0.8, 'PodDark'), (s0 + length - 0.6, s0 + length, 'PodDark')])
    # the ram-air turbine: a hub and four blades on the nose
    K.propeller(name + 'RAT', s0 + 0.22, x, zc, 0.29, blades=4, chord=0.07, spinner=0.07, spinner_len=0.22, pitch=40)
    # sway-brace saddle on top where it hangs from the pylon
    K.box(name + 'Saddle', s0 + 1.55, s0 + 3.2, x - 0.07, x + 0.07, zc + h * 0.85, zc + h + 0.04, material='PodDark')
# stations 3/9: under the existing pylons (their foot at z -1.32)
for sd in (1, -1):
    alq99('ALQ99' + ('R' if sd > 0 else 'L'), sd * 3.49, -1.32 - 0.36, 1.25)
# centreline: where the tank hung, its bottom exactly at the old tank's (keeps the bounding box)
alq99('ALQ99C', 0.0, mn0.z + 0.36, 2.55)

# ── AGM-88 HARM on stations 2/10, on a pylon and a LAU-118 launcher ──
def harm(name, x, zc, y0):
    s0 = s_(y0)
    L, r = 4.17, 0.127
    K.loft(name, [S(s0, 0.01, 0.01, z=zc, x=x), S(s0 + 0.35, 0.09, 0.09, z=zc, x=x), S(s0 + 0.75, r, r, z=zc, x=x), S(s0 + L - 0.04, r, r, z=zc, x=x),
                  S(s0 + L, r * 0.8, r * 0.8, z=zc, x=x)], material='Store', ring=16, mat_ranges=[(s0, s0 + 0.35, 'PodDark'), (s0 + 1.05, s0 + 1.15, 'Band')])
    for k in range(4):   # mid-body wings (cruciform, X) and tail fins
        a = math.pi / 4 + k * math.pi / 2
        ca, sa = math.cos(a), math.sin(a)
        for (f0, f1, span) in ((s0 + 1.55, s0 + 2.25, 0.56), (s0 + L - 0.45, s0 + L - 0.02, 0.36)):
            bm = bmesh.new()
            v = [bm.verts.new((x + ca * r * 0.95, Y(f0), zc + sa * r * 0.95)), bm.verts.new((x + ca * r * 0.95, Y(f1), zc + sa * r * 0.95)),
                 bm.verts.new((x + ca * span, Y(f1 - 0.05), zc + sa * span)), bm.verts.new((x + ca * span, Y(f0 + (f1 - f0) * 0.55), zc + sa * span))]
            bm.faces.new(v)
            K._obj(name + 'Fin', bm, ['Store'])
    K.box(name + 'LAU118', s0 + 0.9, s0 + 3.4, x - 0.07, x + 0.07, zc + r * 0.85, zc + r + 0.14, material='Paint2')
for sd in (1, -1):
    x = sd * 4.585
    wl = SK.section([air], x=x, pred=lambda p: -4.5 < p.y < 1.0 and -0.75 < p.z < -0.3)   # the wing's lower skin there
    zlow = wl[2] if wl else -0.56
    harm('HARM' + ('R' if sd > 0 else 'L'), x, zlow - 0.62, 0.62)
    K.surface('Pylon2' + ('R' if sd > 0 else 'L'), [(s_(0.1), s_(-3.2), x, zlow - 0.36, 0.08), (s_(0.3), s_(-3.0), x, zlow + 0.05, 0.08)],
              material='Paint', mirror=False, subdiv=1)

# ── AIM-120C on the fuselage stations 5/7 (nacelle corners, aft of the intakes) ──
def aim120(name, x, zc, y0):
    s0 = s_(y0)
    L, r = 3.66, 0.089
    K.loft(name, [S(s0, 0.01, 0.01, z=zc, x=x), S(s0 + 0.3, 0.07, 0.07, z=zc, x=x), S(s0 + 0.6, r, r, z=zc, x=x), S(s0 + L, r, r, z=zc, x=x)],
           material='Store', ring=14, mat_ranges=[(s0, s0 + 0.3, 'PodDark'), (s0 + 0.95, s0 + 1.02, 'Band')])
    for k in range(4):
        a = math.pi / 4 + k * math.pi / 2
        ca, sa = math.cos(a), math.sin(a)
        for (f0, f1, span) in ((s0 + 1.25, s0 + 1.6, 0.2), (s0 + L - 0.33, s0 + L - 0.02, 0.23)):
            bm = bmesh.new()
            v = [bm.verts.new((x + ca * r * 0.95, Y(f0), zc + sa * r * 0.95)), bm.verts.new((x + ca * r * 0.95, Y(f1), zc + sa * r * 0.95)),
                 bm.verts.new((x + ca * span, Y(f1 - 0.03), zc + sa * span)), bm.verts.new((x + ca * span, Y(f0 + (f1 - f0) * 0.4), zc + sa * span))]
            bm.faces.new(v)
            K._obj(name + 'Fin', bm, ['Store'])
fus = SK.section([air], s=s_(-1.0), pred=lambda p: 0.9 < abs(p.x) < 1.7 and p.z < -0.9)
zf = fus[2] if fus else -1.45
print('nacelle bottom at y=-1', fus)
for sd in (1, -1):
    aim120('AIM120' + ('R' if sd > 0 else 'L'), sd * 1.22, zf - 0.13, 0.95)
    K.box('LAU116' + ('R' if sd > 0 else 'L'), s_(0.55), s_(-2.1), sd * 1.22 - 0.05, sd * 1.22 + 0.05, zf - 0.06, zf + 0.04, material='Paint2')

# ── spine: ALQ-227 / datalink blade antennas behind the canopy ──
spine = lambda y: (SK.section([air], s=s_(y), pred=lambda p: abs(p.x) < 0.15 and p.z > 0.0) or (0, 0, 0, 0.55))[3]
for k, (y, h) in enumerate(((0.95, 0.24), (0.25, 0.3), (-0.55, 0.24))):
    z = spine(y)
    K.fin('Blade%d' % k, (s_(y), s_(y) + 0.32), (s_(y) + 0.14, s_(y) + 0.36, h), t=0.07, t_tip=0.05, x=0.0, z=z - 0.02, material='Dark', subdiv=0)
# (the M61's muzzle is a dark patch in the shared skin texture at the radome joint: left as it is)

FLIP_V, FLIP_H = True, False   # how the titles sit in the texture (checked on a render)
# ── TEXTURE: squadron titles "VFA-11x" → "VAQ-133" (this model's own copy of the skin texture) ──
import numpy as np
skin_img = None
for m in air.data.materials:
    if m.name == 'Material.001':
        b = m.node_tree.nodes.get('Principled BSDF')
        skin_img = b.inputs['Base Color'].links[0].from_node.image
img = skin_img.copy()
img.name = 'ea18g_skin'
for m in air.data.materials:
    if m.name == 'Material.001':
        m.node_tree.nodes.get('Principled BSDF').inputs['Base Color'].links[0].from_node.image = img
W, H = img.size
px = np.empty(W * H * 4, np.float32); img.pixels.foreach_get(px); px = px.reshape(H, W, 4)
import subprocess, tempfile
MASK = os.path.join(tempfile.gettempdir(), 'ea18g_title_%d.png')
FONT = None
for f in ('/System/Library/Fonts/Supplemental/Arial Narrow Bold.ttf', '/System/Library/Fonts/Supplemental/Arial Bold.ttf', '/Library/Fonts/Arial Bold.ttf'):
    if os.path.exists(f):
        FONT = f; break
def title_mask(k, tw, th, text='VAQ-133'):
    """white-on-black text image tw x th (rendered by the system python's PIL: Blender's python has none)"""
    code = ('from PIL import Image, ImageDraw, ImageFont\n'
            'tw, th = %d, %d\n'
            't = Image.new("L", (tw * 4, th * 4), 0); d = ImageDraw.Draw(t)\n'
            'f = ImageFont.truetype(%r, th * 3) if %r else ImageFont.load_default()\n'
            'bb = d.textbbox((0, 0), %r, font=f)\n'
            'd.text(((tw * 4 - (bb[2] - bb[0])) / 2 - bb[0], (th * 4 - (bb[3] - bb[1])) / 2 - bb[1]), %r, fill=255, font=f)\n'
            't.resize((tw, th), Image.LANCZOS).save(%r)\n') % (tw, th, FONT, FONT, text, text, MASK % k)
    subprocess.run(['/usr/bin/env', 'python3', '-c', code], check=True)
    im = bpy.data.images.load(MASK % k)
    a = np.empty(tw * th * 4, np.float32); im.pixels.foreach_get(a)
    return a.reshape(th, tw, 4)[..., 0]          # Blender rows: bottom-up
for k, (x0, y0, x1, y1) in enumerate(((540, 95, 624, 118), (408, 256, 494, 279))):   # the two titles (image coords, top-left origin)
    r0, r1 = H - y1, H - y0                                            # Blender pixel rows run bottom-up
    band = px[r0:r1, x0:x1, :3]
    lum = band.mean(2)
    dark = np.median(lum[lum < np.percentile(lum, 40)])
    text = lum > dark + 0.06
    tint = band[text].mean(0) if text.any() else np.array([0.45, 0.45, 0.45])
    bg = band[~text].mean(0)
    band[:] = bg                                                       # paint the old title out
    a = title_mask(k, x1 - x0, y1 - y0)
    if FLIP_V:
        a = a[::-1, :]
    if FLIP_H:
        a = a[:, ::-1]
    band[:] = band * (1 - a[..., None]) + tint[None, None, :] * a[..., None]
    px[r0:r1, x0:x1, :3] = band
img.pixels.foreach_set(px.ravel())
img.pack()

# join the airframe with the imported mesh active, so its UV maps stay first and active (the skin texture reads
# them); the new parts get box-projected panel UVs in the same 'UVMap' layer
alive = {o.name: o for o in bpy.data.objects}
for ob in K.STATE['objects']:
    try:
        nm = ob.name
    except ReferenceError:
        continue
    if alive.get(nm) is ob and ob.type == 'MESH':
        K._shade(ob, 34)
        K._box_uv(ob, 8.0, layer='UVMap')
        ob['keep_uv'] = 1
SK.join([air] + [o for o in SK.meshes() if o is not air], 'ea18g')
while len(air.data.uv_layers) > 2:
    air.data.uv_layers.remove(air.data.uv_layers[-1])
air.data.uv_layers.active_index = 0
air.data.uv_layers[0].active_render = True
if 'keep_uv' in air:
    del air['keep_uv']
SK.finish(OUT)
mn1, mx1 = SK.bbox(SK.meshes(False))
print('OUT BBOX', [round(v, 4) for v in mn1], [round(v, 4) for v in mx1])
print('BBOX same length / height / centre:', abs((mx1.y - mn1.y) - (mx0.y - mn0.y)) < 1e-3, abs(mn1.z - mn0.z) < 1e-3, abs(mx1.z - mx0.z) < 1e-3)
