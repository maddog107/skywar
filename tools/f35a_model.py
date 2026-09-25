# ═══════════════════════════════════════════════════════════════
# F-35A Lightning II — scripted model for Blender (run headless):
#   blender -b -P tools/f35a_model.py -- models/f35a.glb
# Dimensions measured off the public-domain three-view drawing on Wikimedia Commons
# (File:Lockheed_Martin_F-35A_Lightning_II_3-view_drawing.png and File:F-35A_Top.jpg):
# length 15.67 m, span 10.7 m. Blender axes: nose toward +Y, up +Z, span along X
# (the glTF exporter turns that into three.js's "nose toward -Z, up +Y").
# Stations below are metres aft of the nose tip.
# ═══════════════════════════════════════════════════════════════
import bpy, bmesh, math, sys
from mathutils import Vector

L = 15.67
out = sys.argv[sys.argv.index('--') + 1] if '--' in sys.argv else 'f35a.glb'

bpy.ops.wm.read_factory_settings(use_empty=True)

def Y(station):
    return L / 2 - station  # station (m aft of nose) → Blender Y

def mat(name, color, metal=0.35, rough=0.45, emit=None, alpha=1.0):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    b = m.node_tree.nodes['Principled BSDF']
    b.inputs['Base Color'].default_value = (*color, 1)
    b.inputs['Metallic'].default_value = metal
    b.inputs['Roughness'].default_value = rough
    if alpha < 1:
        b.inputs['Alpha'].default_value = alpha
        m.blend_method = 'BLEND'
    return m

def srgb(h):
    c = [((h >> 16) & 255) / 255, ((h >> 8) & 255) / 255, (h & 255) / 255]
    return tuple(x / 12.92 if x <= 0.04045 else ((x + 0.055) / 1.055) ** 2.4 for x in c)

M_SKIN = mat('Skin', srgb(0x6b7076), 0.3, 0.5)        # F-35 low-observable grey
M_DARK = mat('Dark', srgb(0x2c2f33), 0.4, 0.55)       # edges, nozzle feathers, intake lips
M_GLASS = mat('Canopy', srgb(0x8c6a30), 0.9, 0.08)    # gold-tinted canopy
M_HOLE = mat('Intake', srgb(0x08090a), 0.0, 0.9)      # intake mouth / nozzle interior

def new_obj(name, bm, material):
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    ob = bpy.data.objects.new(name, me)
    bpy.context.collection.objects.link(ob)
    me.materials.append(material)
    return ob

# ── Fuselage: lofted cross-sections (superellipse; low exponent = sharp chines) ──
#  station, half-width, top (above chine), bottom (below chine), chine height z, exponent
STATIONS = [
    (0.00, 0.02, 0.02, 0.02, 0.00, 1.3),
    (0.50, 0.17, 0.13, 0.11, 0.00, 1.3),
    (1.20, 0.36, 0.31, 0.26, 0.00, 1.4),
    (2.00, 0.52, 0.46, 0.40, 0.00, 1.6),
    (3.00, 0.64, 0.58, 0.52, 0.02, 1.9),
    (4.00, 0.74, 0.66, 0.60, 0.03, 2.2),
    (4.40, 0.77, 0.70, 0.64, 0.03, 2.4),   # intake lips: the body steps out to the cheeks here
    (4.46, 1.60, 0.72, 0.66, 0.03, 3.4),
    (5.20, 1.70, 0.82, 0.72, 0.04, 3.6),
    (6.40, 1.78, 0.92, 0.82, 0.05, 3.8),
    (8.00, 1.80, 0.95, 0.90, 0.05, 3.8),   # weapons bays
    (10.00, 1.74, 0.92, 0.90, 0.05, 3.8),
    (11.40, 1.55, 0.84, 0.78, 0.05, 3.4),
    (12.60, 1.12, 0.72, 0.66, 0.03, 2.8),
    (13.20, 0.80, 0.64, 0.60, 0.00, 2.4),
    (13.50, 0.66, 0.60, 0.58, 0.00, 2.1),
]
RING = 36

def section_pts(st):
    s, W, T, B, z0, n = st
    pts = []
    for i in range(RING):
        a = 2 * math.pi * i / RING
        c, sn = math.cos(a), math.sin(a)
        x = W * math.copysign(abs(c) ** (2 / n), c)
        h = T if sn >= 0 else B
        z = z0 + h * math.copysign(abs(sn) ** (2 / n), sn)
        # flatter underside mid-body (weapons bays / engine)
        if sn < 0 and n > 3:
            z = z0 - B * (abs(sn) ** 0.35)
        # crowned top: the spine stands above the intake shoulders
        if sn > 0 and n > 3:
            z = z0 + (z - z0) * (1 - 0.32 * (x / W) ** 2)
        pts.append(Vector((x, Y(s), z)))
    return pts

def loft(sections, name, material, cap_front=True, cap_back=True):
    bm = bmesh.new()
    rings = [[bm.verts.new(p) for p in sec] for sec in sections]
    n = len(sections[0])
    for a, b in zip(rings, rings[1:]):
        for i in range(n):
            bm.faces.new((a[i], a[(i + 1) % n], b[(i + 1) % n], b[i]))
    if cap_front: bm.faces.new(list(reversed(rings[0])))
    if cap_back: bm.faces.new(rings[-1])
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    return new_obj(name, bm, material)

fus = loft([section_pts(st) for st in STATIONS], 'Fuselage', M_SKIN, cap_front=False, cap_back=True)

# ── Nozzle: round, with the sawtooth "feathers" at the exit ──
def nozzle():
    bm = bmesh.new()
    r0, r1, s0, s1, z = 0.64, 0.55, 13.50, 14.15, 0.0
    N = 28
    ring0 = [bm.verts.new((r0 * math.cos(2 * math.pi * i / N), Y(s0), z + r0 * math.sin(2 * math.pi * i / N))) for i in range(N)]
    ring1 = []
    for i in range(N):
        a = 2 * math.pi * i / N
        tooth = 0.18 if i % 2 == 0 else 0.0   # serrated trailing edge
        ring1.append(bm.verts.new((r1 * math.cos(a), Y(s1 + tooth), z + r1 * math.sin(a))))
    for i in range(N):
        bm.faces.new((ring0[i], ring0[(i + 1) % N], ring1[(i + 1) % N], ring1[i]))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    ob = new_obj('Nozzle', bm, M_DARK)
    # dark engine face inside
    bm2 = bmesh.new()
    vs = [bm2.verts.new((0.55 * math.cos(2 * math.pi * i / N), Y(13.80), z + 0.55 * math.sin(2 * math.pi * i / N))) for i in range(N)]
    bm2.faces.new(vs)
    new_obj('NozzleFace', bm2, M_HOLE)
    return ob
nozzle()

# ── Canopy: one-piece bubble, gold tint ──
def canopy():
    secs = []
    CS = [(1.85, 0.06, 0.02), (2.3, 0.36, 0.26), (3.0, 0.50, 0.50), (3.7, 0.53, 0.57), (4.4, 0.48, 0.48), (5.0, 0.32, 0.28), (5.4, 0.08, 0.06)]
    for s, w, h in CS:
        # base sits on the fuselage top at this station
        base = next((st for st in STATIONS if st[0] >= s), STATIONS[-1])
        top = base[4] + base[2] * 0.93
        pts = []
        for i in range(17):
            a = math.pi * i / 16
            pts.append(Vector((w * math.cos(a), Y(s), top + h * math.sin(a) ** 0.9)))
        secs.append(pts)
    bm = bmesh.new()
    rings = [[bm.verts.new(p) for p in sec] for sec in secs]
    for a, b in zip(rings, rings[1:]):
        for i in range(len(a) - 1):
            bm.faces.new((a[i], a[i + 1], b[i + 1], b[i]))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    return new_obj('Canopy', bm, M_GLASS)
canopy()

# ── Lifting surfaces: thin biconvex airfoil lofted root → tip ──
def surface(name, root, tip, thick_root, thick_tip, mirror=True, material=M_SKIN, cant=0.0):
    # root/tip: (station of LE, station of TE, span position x, height z)
    objs = []
    for side in ([1, -1] if mirror else [1]):
        bm = bmesh.new()
        secs = []
        for (le, te, sx, sz), t in ((root, thick_root), (tip, thick_tip)):
            chord = te - le
            up, lo = [], []
            K = 10
            for k in range(K + 1):
                u = k / K
                y = Y(le + chord * u)
                th = t * chord * 2.0 * math.sqrt(max(u, 0) * (1 - u)) * (1.0 - 0.15 * u)
                up.append((y, th))
                lo.append((y, -th * 0.8))
            ring = [(yy, zz) for yy, zz in up] + [(yy, zz) for yy, zz in reversed(lo[1:-1])]
            secs.append([(sx, yy, sz + zz) for yy, zz in ring])
        rings = []
        for sec in secs:
            ring = []
            for (sx, yy, zz) in sec:
                # cant (vertical tails): rotate the span axis about the root line
                p = Vector((sx * side, yy, zz))
                ring.append(bm.verts.new(p))
            rings.append(ring)
        n = len(rings[0])
        for i in range(n):
            bm.faces.new((rings[0][i], rings[0][(i + 1) % n], rings[1][(i + 1) % n], rings[1][i]))
        bm.faces.new(rings[1])
        bm.faces.new(list(reversed(rings[0])))
        bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
        objs.append(new_obj(f'{name}_{"R" if side > 0 else "L"}', bm, material))
    return objs

# Wings: root at the fuselage side, slight anhedral, trapezoidal with a swept LE and forward-swept TE
surface('Wing', (7.10, 12.20, 1.60, 0.02), (9.85, 11.55, 5.35, -0.08), 0.045, 0.035)
# Horizontal tails (all-moving), on the tail booms
surface('Stab', (12.30, 15.35, 0.95, 0.05), (13.95, 15.60, 3.67, 0.02), 0.04, 0.03)

# Vertical tails: canted outward ~25°, swept LE, straight-ish TE
def fin(side):
    bm = bmesh.new()
    cant = math.radians(25)
    root = (11.40, 14.05)
    tip = (13.10, 14.90)
    span = 2.25
    rx, rz = 1.18, 0.55      # root sits on the tail boom shoulders
    secs = []
    for (le, te), s in ((root, 0.0), (tip, span)):
        chord = te - le
        x = rx + math.sin(cant) * s
        z = rz + math.cos(cant) * s
        t = 0.04 if s == 0 else 0.03
        pts = []
        K = 10
        up = []
        for k in range(K + 1):
            u = k / K
            th = t * chord * 2.0 * math.sqrt(u * (1 - u))
            up.append((Y(le + chord * u), th))
        ring = [(yy, th) for yy, th in up] + [(yy, -th) for yy, th in reversed(up[1:-1])]
        # thickness is along the fin's local normal (cos cant, -sin cant)
        nx, nz = math.cos(cant), -math.sin(cant)
        secs.append([bm.verts.new(((x + nx * th) * side, yy, z + nz * th)) for yy, th in ring])
    n = len(secs[0])
    for i in range(n):
        bm.faces.new((secs[0][i], secs[0][(i + 1) % n], secs[1][(i + 1) % n], secs[1][i]))
    bm.faces.new(secs[1]); bm.faces.new(list(reversed(secs[0])))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    return new_obj(f'Fin_{"R" if side > 0 else "L"}', bm, M_SKIN)
fin(1); fin(-1)

# Tail booms: the shoulders either side of the engine that carry the fins and stabs
def boom(side):
    secs = []
    for s, w, t, b in ((10.4, 0.05, 0.05, 0.05), (11.6, 0.40, 0.36, 0.30), (13.4, 0.40, 0.34, 0.28), (15.0, 0.26, 0.20, 0.16), (15.45, 0.06, 0.05, 0.04)):
        pts = []
        for i in range(20):
            a = 2 * math.pi * i / 20
            c, sn = math.cos(a), math.sin(a)
            x = side * 1.12 + w * math.copysign(abs(c) ** 0.6, c)
            z = 0.15 + (t if sn >= 0 else b) * math.copysign(abs(sn) ** 0.6, sn)
            pts.append(Vector((x, Y(s), z)))
        secs.append(pts)
    return loft(secs, f'Boom_{"R" if side > 0 else "L"}', M_SKIN)
boom(1); boom(-1)

# ── Intake mouths: dark trapezoids on the swept "cheek" ahead of the wing, one each side ──
def intake(side):
    bm = bmesh.new()
    # mouth: a canted quadrilateral (outer wall leans in at the top, like the real caret inlet)
    q = [(0.80, 4.36, 0.58), (1.50, 4.38, 0.50), (1.58, 4.42, -0.52), (0.80, 4.40, -0.58)]
    vs = [bm.verts.new((x * side, Y(s), z)) for x, s, z in q]
    bm.faces.new(vs if side < 0 else list(reversed(vs)))
    new_obj(f'Intake_{"R" if side > 0 else "L"}', bm, M_HOLE)
    # dark lip edge around the mouth
    bm3 = bmesh.new()
    for (x0, s0, z0), (x1, s1, z1) in zip(q, q[1:] + q[:1]):
        a0 = bm3.verts.new((x0 * side, Y(s0 - 0.01), z0)); a1 = bm3.verts.new((x1 * side, Y(s1 - 0.01), z1))
        b1 = bm3.verts.new((x1 * side, Y(s1 + 0.25), z1 * 1.05)); b0 = bm3.verts.new((x0 * side, Y(s0 + 0.25), z0 * 1.05))
        bm3.faces.new((a0, a1, b1, b0))
    bmesh.ops.recalc_face_normals(bm3, faces=bm3.faces)
    # the diverterless (DSI) bump on the forebody just ahead of each inlet
    bm2 = bmesh.new()
    bmesh.ops.create_uvsphere(bm2, u_segments=16, v_segments=8, radius=1.0)
    for v in bm2.verts:
        v.co = Vector((v.co.x * 0.16, v.co.y * 0.70, v.co.z * 0.34)) + Vector((0.72 * side, Y(4.05), 0.05))
    new_obj(f'DSI_{"R" if side > 0 else "L"}', bm2, M_SKIN)
intake(1); intake(-1)

# ── Finish: smooth shading with sharp edges kept at chines and trailing edges ──
for ob in bpy.data.objects:
    if ob.type != 'MESH':
        continue
    bpy.context.view_layer.objects.active = ob
    ob.select_set(True)
    for p in ob.data.polygons:
        p.use_smooth = ob.name.startswith(('Fuselage', 'Canopy', 'Boom', 'DSI', 'Nozzle'))
    bm = bmesh.new(); bm.from_mesh(ob.data)
    for e in bm.edges:
        if len(e.link_faces) == 2 and e.calc_face_angle(0) > math.radians(38):
            e.smooth = False
    bm.to_mesh(ob.data); bm.free()
    ob.select_set(False)

# dimensions for the game's config (nozzle & cockpit positions relative to the bbox centre)
xs, ys, zs = [], [], []
for ob in bpy.data.objects:
    for v in ob.data.vertices:
        w = ob.matrix_world @ v.co
        xs.append(w.x); ys.append(w.y); zs.append(w.z)
print('BBOX x', min(xs), max(xs), 'y', min(ys), max(ys), 'z', min(zs), max(zs))
tris = sum(len(p.vertices) - 2 for ob in bpy.data.objects for p in ob.data.polygons)
print('TRIS', tris)

bpy.ops.export_scene.gltf(filepath=out, export_format='GLB', export_apply=True, export_yup=True)
print('WROTE', out)
