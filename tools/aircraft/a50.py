# Beriev A-50U "Mainstay" (AWACS) — SKYWAR support-aircraft build.
#   /opt/homebrew/bin/blender -b -P tools/aircraft/a50.py -- SRC.glb models/aircraft/a50.glb
# SRC: "Ilyushin Il-76" by helijah (Emmanuel Baranger), CC BY 4.0,
# https://sketchfab.com/3d-models/ilyushin-il-76-ab71a5f790f940798cc755246a7a8a7f (Objaverse glbs/000-050/ab71a5f790f940798cc755246a7a8a7f.glb)
# The A-50 is an Il-76MD airframe. Changes:
#  - landing gear wheels and the cockpit interior removed; the Aeroflot livery replaced by the A-50U scheme: white
#    fuselage and fin, grey wings, stabiliser and pylons (SKYWAR panel texture), a black anti-glare "V" under the
#    windscreen, Russian stars (red, white and blue border) on the fin and wings
#  - the navigator's glazed nose faired over (the A-50 has none), cheek antenna blisters on the nose
#  - the 10 m rotodome (≈1.9 m thick at the centre) with its two red-tipped side fairings, on two struts over the
#    wing's trailing edge: the `rotodome` node, turning about its own +y
#  - the refuelling probe over the cockpit (REFUEL 'probe' at its tip), a SATCOM fairing, blade antennas
# References (measuring only): Wikimedia Commons "Beriev A-50 3-view line drawing.png", photographs of A-50U
# RF-94268 (Zhukovsky 2012), RF-93966 and the grey A-50 "33" (MAKS-2013).
# Real size: 46.59 m airframe (49.6 m with the probe), span 50.50 m, height 14.76 m.
# s = metres aft of the nose, x right, z up (tools/aircraft_kit.py).
import os, sys, math
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import support_kit as SK
import aircraft_kit as K
from aircraft_kit import S
import bpy, bmesh
from mathutils import Vector, Matrix
from mathutils.bvhtree import BVHTree

ARGS = sys.argv[sys.argv.index('--') + 1:]
SRC, OUT = ARGS[0], ARGS[1]
L = 46.59

SK.begin('a50', L, paint='#e2e4e3', paint2='#a4a9ac', radome='#d9dbda', dark='#1a1c1e', nozzle='#4a4541', glass='#253240')
K.material('Metal', '#b5b8ba', 0.7, 0.38)
K.material('Pylon', '#a4a9ac', 0.12, 0.55, panel={'key': 'panel'})
K.material('DomeWhite', '#e6e7e4', 0.05, 0.5)
K.material('DomeRed', '#b82a22', 0.05, 0.5)
K.material('StarRed', '#c8102e', 0.05, 0.5)
K.material('StarWhite', '#f2f2f0', 0.05, 0.5)
K.material('StarBlue', '#1f3f94', 0.05, 0.5)
air = SK.load(SRC, nose='-X')
SK.fit(air, L)
obj = {o.name[len('src_'):].split('.')[0]: o for o in air}

# ── clean-up: wheels, the cockpit interior (instrument panels, seats, yokes, cabin) ──
SK.delete([obj['Object_%d' % i] for i in (13, 14, 15, 16, 17)])
SK.delete([o for n, o in obj.items() if n in ['Object_%d' % i for i in list(range(21, 41)) + [2, 3, 4, 5]]])
# the gear legs, axles and hubs (the pylons' object holds them), and the small open door plates by the main gear
print('gear legs', SK.delete_loose(lambda a, b, n: b.z < 3.0 and n in (64, 96, 98), [obj['Object_12']]),
      SK.delete_loose(lambda a, b, n: n <= 12 and b.z < 2.2 and 19.5 < -b.y and -a.y < 23.2, [obj['Object_10']]))
live = [o for o in bpy.data.objects if o.type == 'MESH']
obj = {n: o for n, o in obj.items() if o in live}

# ── paint ──
AIRFRAME = [obj[n] for n in ('Object_8', 'Object_9', 'Object_10', 'Object_11', 'Object_20', 'Object_12')]
for o in AIRFRAME:
    SK.set_material([o], 'Paint')
    K._box_uv(o, 8.0)
def paint_faces(objs, pred, mat):
    """give the faces whose centre satisfies pred(Vector) the kit material `mat` (appended to the object's slots)"""
    m = K.mat(mat)
    n = 0
    for o in objs:
        if m.name not in [x.name for x in o.data.materials if x]:
            o.data.materials.append(m)
        mi = [x.name if x else None for x in o.data.materials].index(m.name)
        mw = o.matrix_world
        for p in o.data.polygons:
            if pred(mw @ p.center):
                p.material_index = mi; n += 1
    return n
# grey flying surfaces: the wing outboard of the fuselage (and its slats, flaps and ailerons), the stabiliser, pylons
wing = lambda c: abs(c.x) > 2.55 and c.z > 4.9 and 10.0 < -c.y < 31.0
print('grey faces', paint_faces(AIRFRAME, lambda c: wing(c) or c.z > 13.9 and abs(c.x) > 0.55, 'Paint2'))
SK.set_material([obj['Object_12']], 'Pylon')
# engines keep their own model (nacelles, fan faces, exhausts): the atlas repainted light grey, shading kept
SK.mono('#dfe1e0', mat_rx='^DefaultWhite$')
# the glass: windscreen and eyebrow windows stay; the navigator's glazing (below the windscreen) is faired over
SK.set_material([obj['Object_6']], 'Canopy_Glass')
print('nav glazing faired over', paint_faces([obj['Object_6']], lambda c: c.z < 4.6, 'Paint'))

# ── nose: black anti-glare "V" under the windscreen, cheek blisters, refuelling probe ──
def bvh(objs):
    verts, polys = [], []
    for o in objs:
        mw = o.matrix_world
        base = len(verts)
        verts += [mw @ v.co for v in o.data.vertices]
        polys += [[base + i for i in p.vertices] for p in o.data.polygons]
    return BVHTree.FromPolygons(verts, polys)
SHELL = bvh([obj['Object_8'], obj['Object_9'], obj['Object_11']])
def decal(name, pts2d, tris, origin, u, v, d, lift, mat):
    """a decal: 2D points (metres, in the plane origin + a*u + b*v) projected along d onto the airframe and lifted
    `lift` off it along the surface normal. tris: triangle index triples. Returns the object (or None)."""
    bm = bmesh.new()
    vv = []
    for a, b in pts2d:
        p = origin + u * a + v * b
        hit = SHELL.ray_cast(p - d * 6.0, d, 12.0)
        if hit[0] is None:
            hit = SHELL.ray_cast(p + d * 6.0, -d, 12.0)
        if hit[0] is None:
            bm.free(); print('decal miss', name); return None
        loc, nrm = hit[0], hit[1]
        if nrm.dot(d) > 0:
            nrm = -nrm
        vv.append(bm.verts.new(loc + nrm * lift))
    for t in tris:
        try:
            bm.faces.new([vv[i] for i in t])
        except ValueError:
            pass
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    # face the outside (against the projection)
    for f in bm.faces:
        f.normal_update()
        if f.normal.dot(d) > 0:
            f.normal_flip()
    ob = K._obj(name, bm, [mat])
    ob['keep_uv'] = 1
    return ob
def grid_tris(nu, nv):
    return [(j * (nu + 1) + i, j * (nu + 1) + i + 1, (j + 1) * (nu + 1) + i + 1, (j + 1) * (nu + 1) + i) for j in range(nv) for i in range(nu)]
# anti-glare V: a band under the windscreen from the side windows to a point on the nose centreline
NU, NV = 24, 6
pts = []
for j in range(NV + 1):
    for i in range(NU + 1):
        xx = -1.35 + 2.7 * i / NU
        top = 5.08 - 0.02 * abs(xx)                       # under the windscreen
        bot = 4.2 + 0.62 * abs(xx)                        # the V's lower edge, its point on the centreline
        zz = top + (bot - top) * j / NV
        pts.append((xx, zz))
decal('AntiGlare', pts, grid_tris(NU, NV), Vector((0, 0, 0)), Vector((1, 0, 0)), Vector((0, 0, 1)), Vector((0, -1, 0)), 0.012, 'Dark')
for sd in (1, -1):
    K.ellipsoid('Cheek' + ('R' if sd > 0 else 'L'), 3.3, sd * 1.72, 4.05, 0.62, 0.2, 0.2, material='Paint')
    K.ellipsoid('CheekRear' + ('R' if sd > 0 else 'L'), 7.4, sd * 2.25, 5.35, 0.75, 0.18, 0.24, material='Paint')
# refuelling probe: from a fairing on the cockpit roof forward over the nose, rising gently
PR0, PR1 = (4.0, 6.25), (-3.0, 7.1)                   # (s, z) root and tip (49.59 m overall with the probe)
def along_probe(t):
    return PR0[0] + (PR1[0] - PR0[0]) * t, PR0[1] + (PR1[1] - PR0[1]) * t
K.loft('ProbeFairing', [S(5.6, 0.04, 0.03, z=6.28), S(4.9, 0.26, 0.2, 0.05, z=6.25), S(3.9, 0.26, 0.24, 0.05, z=6.28), S(3.2, 0.17, 0.17, z=6.36)], material='Paint', ring=16)
probe_secs = []
for t, r in ((0.0, 0.15), (0.12, 0.13), (0.86, 0.12), (0.9, 0.16), (0.975, 0.16), (1.0, 0.08)):
    s, z = along_probe(t)
    probe_secs.append(S(s, r, r, z=z))
K.loft('Probe', probe_secs, material='Dark', ring=14)
# SATCOM fairing on the spine and blade antennas
K.loft('Satcom', [S(8.2, 0.05, 0.05, z=6.38), S(8.8, 0.62, 0.3, 0.05, z=6.38), S(10.3, 0.62, 0.32, 0.05, z=6.52), S(10.9, 0.05, 0.05, z=6.55)], material='Paint', ring=20)
for k, (s, z) in enumerate(((11.6, 6.6), (12.6, 6.72), (27.5, 6.3), (29.5, 6.35), (31.5, 6.6))):
    K.fin('Blade%d' % k, (s, s + 0.5), (s + 0.3, s + 0.55, 0.45), t=0.08, t_tip=0.06, x=0.0, z=z - 0.03, material='Dark', subdiv=0)
for k, (s, z) in enumerate(((9.0, 1.72), (12.5, 1.66), (31.0, 3.0))):
    K.fin('Belly%d' % k, (s, s + 0.45), (s + 0.25, s + 0.5, 0.4), t=0.08, t_tip=0.06, x=0.0, z=z + 0.02, cant=180, material='Dark', subdiv=0)

# ── rotodome (moving part) and its struts ──
DS, R, HT = 25.9, 5.0, 0.95                         # centre station, radius, half thickness at the centre
CROWN = SK.section([obj['Object_8']], s=DS, pred=lambda p: abs(p.x) < 1.0)[3]
DZ = CROWN + 2.6 + HT
print('rotodome: crown z %.2f, centre z %.2f' % (CROWN, DZ))
def rotodome():
    bm = bmesh.new()
    N, M = 72, 16
    prof = []
    for j in range(M + 1):
        r = R * math.sin(0.5 * math.pi * j / M) ** 0.75
        h = HT * max(0.0, 1 - (r / R) ** 2.2) ** 0.55 + 0.05 * (r / R) ** 8   # a lens: thick centre, thin rounded rim
        prof.append((r, h))
    top_c = bm.verts.new((0, K.Y(DS), DZ + HT)); bot_c = bm.verts.new((0, K.Y(DS), DZ - HT))
    rt_all, rb_all = [], []
    for (r, h) in prof[1:]:
        rt, rb = [], []
        for i in range(N):
            a = 2 * math.pi * i / N
            rt.append(bm.verts.new((r * math.cos(a), K.Y(DS) + r * math.sin(a), DZ + h)))
            rb.append(bm.verts.new((r * math.cos(a), K.Y(DS) + r * math.sin(a), DZ - h)))
        rt_all.append(rt); rb_all.append(rb)
    for i in range(N):
        n1 = (i + 1) % N
        bm.faces.new((top_c, rt_all[0][i], rt_all[0][n1])); bm.faces.new((bot_c, rb_all[0][n1], rb_all[0][i]))
        for j in range(len(prof) - 2):
            bm.faces.new((rt_all[j][i], rt_all[j + 1][i], rt_all[j + 1][n1], rt_all[j][n1]))
            bm.faces.new((rb_all[j][n1], rb_all[j + 1][n1], rb_all[j + 1][i], rb_all[j][i]))
        bm.faces.new((rt_all[-1][i], rb_all[-1][i], rb_all[-1][n1], rt_all[-1][n1]))
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-5)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    return K._obj('Rotodome', bm, ['DomeWhite'])
dome = rotodome()
hub = K.loft('DomeHub', [S(DS - 0.8, 0.8, 0.14, z=DZ - HT - 0.08), S(DS + 0.8, 0.8, 0.14, z=DZ - HT - 0.08)], material='Paint2', ring=24)
# the side fairings (antennas) sticking out of the rim, red-tipped
ears = []
for sd in (1, -1):
    x0, x1 = sd * (R - 0.6), sd * (R + 1.55)
    ears += K.surface('Ear' + ('R' if sd > 0 else 'L'), [(DS - 0.5, DS + 0.5, x0, DZ, 0.32), (DS - 0.28, DS + 0.28, x1 - sd * 0.38, DZ, 0.3)], material='DomeWhite', mirror=False, subdiv=1)
    ears += K.surface('EarTip' + ('R' if sd > 0 else 'L'), [(DS - 0.28, DS + 0.28, x1 - sd * 0.38, DZ, 0.3), (DS - 0.16, DS + 0.16, x1, DZ, 0.28)], material='DomeRed', mirror=False, subdiv=0)
SK.part('rotodome', [dome, hub] + ears, (DS, 0.0, DZ), props={'rpm': 6, 'diameter': 2 * R})
struts = []
for sd in (1, -1):
    struts += K.surface('Strut' + ('R' if sd > 0 else 'L'), [(DS - 0.95, DS + 0.95, sd * 0.78, CROWN - 0.15, 0.2), (DS - 0.85, DS + 0.85, sd * 0.48, DZ - HT - 0.1, 0.19)],
                        material='Paint', mirror=False, subdiv=2)
K.loft('StrutFairing', [S(DS - 2.3, 0.05, 0.05, z=CROWN - 0.1), S(DS - 1.5, 0.8, 0.26, 0.1, z=CROWN - 0.08), S(DS, 1.1, 0.36, 0.1, z=CROWN - 0.08),
                        S(DS + 1.4, 0.85, 0.28, 0.1, z=CROWN - 0.08), S(DS + 2.4, 0.05, 0.05, z=CROWN - 0.1)], material='Paint', ring=24)

# ── Russian stars: red with a white border and a blue outline, on the fin (both sides) and the wings (both sides) ──
def star_pts(R, rings=3):
    """a five-point star as a fan: centre + `rings` rings of 10 points → (points, triangles)"""
    pts = [(0.0, 0.0)]
    for k in range(1, rings + 1):
        f = k / rings
        for i in range(10):
            a = math.pi / 2 + i * math.pi / 5
            rr = R if i % 2 == 0 else R * 0.382
            pts.append((math.cos(a) * rr * f, math.sin(a) * rr * f))
    tris = [(0, 1 + i, 1 + (i + 1) % 10) for i in range(10)]
    for k in range(rings - 1):
        b0, b1 = 1 + 10 * k, 1 + 10 * (k + 1)
        for i in range(10):
            n1 = (i + 1) % 10
            tris += [(b0 + i, b1 + i, b1 + n1), (b0 + i, b1 + n1, b0 + n1)]
    return pts, tris
def stars(name, origin, u, v, d, R):
    for layer, (scale, lift, mat) in enumerate(((1.28, 0.02, 'StarBlue'), (1.17, 0.032, 'StarWhite'), (1.0, 0.044, 'StarRed'))):
        pts, tris = star_pts(R * scale)
        decal('%s%d' % (name, layer), pts, tris, origin, u, v, d, lift, mat)
for sd in (1, -1):
    # fin: seen from the side, the star's "up" along +z
    stars('FinStar' + ('R' if sd > 0 else 'L'), Vector((0, K.Y(40.2), 10.3)), Vector((0, 1, 0)), Vector((0, 0, 1)), Vector((-sd, 0, 0)), 0.85)
    # wings: upper and lower surface near the tips, the star's "up" pointing forward
    for up in (1, -1):
        stars('WingStar%s%s' % ('R' if sd > 0 else 'L', 'U' if up > 0 else 'D'), Vector((sd * 19.5, K.Y(24.6), 5.6)), Vector((1, 0, 0)) if up > 0 else Vector((-1, 0, 0)),
              Vector((0, 1, 0)), Vector((0, 0, -up)), 0.95)

# engines: D-30KP exhausts for the contrails (the aft end of each nacelle's core nozzle)
exh = [(17.7, sd * 6.42, 4.1) for sd in (1, -1)] + [(19.8, sd * 10.79, 3.85) for sd in (1, -1)]
SK.finish(OUT)
# flaps and spoilers for src/surfacedefs.js, from kit coordinates against the final bounding box
mn, mx = SK.bbox(SK.meshes(False))
LB, CS, CZ = mx.y - mn.y, -(mn.y + mx.y) / 2, (mn.z + mx.z) / 2
fx = lambda x: round(x / LB, 4)
fy = lambda z: round((z - CZ) / LB, 4)
fz = lambda s: round((s - CS) / LB, 4)
def sdef(top, band, hinge, angle, dihedral, **kw):
    d = {'top': [[fx(x), fz(s)] for x, s in top], 'y': [fy(band[0]), fy(band[1])], 'dihedral': dihedral,
         'hinge': [[fx(x), fy(z), fz(s)] for x, z, s in hinge], 'angle': angle}
    for k, v in kw.items():
        d[k] = [round(v[0] / LB, 4), round(v[1] / LB, 4), round(v[2] / LB, 4)] if k == 'slide' else v
    return d
import json
flaps = [sdef([(2.35, 21.95), (11.45, 23.1), (11.45, 25.2), (2.35, 24.0)], (5.1, 6.75), [(2.35, 6.62, 21.95), (11.45, 6.28, 23.1)], 40, -2.6, slide=(0, -0.25, 1.4)),
         sdef([(11.55, 23.15), (18.45, 25.75), (18.45, 27.3), (11.55, 25.2)], (4.7, 6.38), [(11.55, 6.3, 23.15), (18.45, 5.86, 25.75)], 40, -3.4, slide=(0, -0.22, 1.2))]
brakes = [sdef([(4.0, 20.35), (10.5, 21.3), (10.5, 22.7), (4.0, 21.75)], (6.35, 7.0), [(4.0, 6.72, 20.35), (10.5, 6.44, 21.3)], -50, -2.6, skin=1),
          sdef([(12.0, 21.75), (17.5, 23.8), (17.5, 25.2), (12.0, 23.15)], (5.95, 6.55), [(12.0, 6.25, 21.75), (17.5, 5.95, 23.8)], -50, -3.4, skin=1)]
print('SURFACES', json.dumps({'flaps': flaps, 'brakes': brakes}))
print('NOZZLES', [SK.frac(s, x, z) for s, x, z in exh])
print('COCKPIT', SK.frac(3.4, 0.0, 5.45))
print('REFUEL', SK.frac(PR1[0], 0.0, PR1[1]))
