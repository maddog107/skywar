# ═══════════════════════════════════════════════════════════════
# Small geometry kit for the scripted ship models (runs inside Blender).
# Geometry is written in the GAME's frame — x starboard, y up (0 = waterline),
# z aft (bow −z) — and converted to Blender's (x, −z, y) only when a mesh is built,
# so the glTF exporter's +Y-up conversion hands three.js exactly these coordinates.
# ═══════════════════════════════════════════════════════════════
import bpy, bmesh, math
from mathutils import Vector, Matrix

def clamp(v, a, b):
    return a if v < a else b if v > b else v

def lerp(a, b, t):
    return a + (b - a) * t

def smoothstep(a, b, x):
    t = clamp((x - a) / (b - a), 0.0, 1.0)
    return t * t * (3 - 2 * t)

def srgb(h):
    c = [((h >> 16) & 255) / 255, ((h >> 8) & 255) / 255, (h & 255) / 255]
    return tuple(x / 12.92 if x <= 0.04045 else ((x + 0.055) / 1.055) ** 2.4 for x in c)

def V(p):
    return Vector((p[0], -p[2], p[1]))

def newell(pts):
    nx = ny = nz = 0.0
    n = len(pts)
    for i in range(n):
        x1, y1, z1 = pts[i]
        x2, y2, z2 = pts[(i + 1) % n]
        nx += (y1 - y2) * (z1 + z2)
        ny += (z1 - z2) * (x1 + x2)
        nz += (x1 - x2) * (y1 + y2)
    return (nx, ny, nz)

MATS = {}

def material(name, color, metal=0.1, rough=0.6, image=None, emit=None, emit_strength=1.0):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    nt = m.node_tree
    b = nt.nodes['Principled BSDF']
    b.inputs['Base Color'].default_value = (*color, 1)
    b.inputs['Metallic'].default_value = metal
    b.inputs['Roughness'].default_value = rough
    if image:
        tex = nt.nodes.new('ShaderNodeTexImage')
        tex.image = bpy.data.images.load(image)
        tex.interpolation = 'Linear'
        nt.links.new(tex.outputs['Color'], b.inputs['Base Color'])
    if emit:
        b.inputs['Emission Color'].default_value = (*emit, 1)
        b.inputs['Emission Strength'].default_value = emit_strength
    MATS[name] = m
    return m


class Geo:
    """Polygon soup for one material: faces keep their own vertices (welded when built)."""
    def __init__(self):
        self.verts = []
        self.faces = []   # (vertex indices, uvs or None, smooth)

    def face(self, pts, uvs=None, want=None, smooth=False):
        pts = [tuple(p) for p in pts]
        if want is not None:
            n = newell(pts)
            if n[0] * want[0] + n[1] * want[1] + n[2] * want[2] < 0:
                pts = pts[::-1]
                uvs = uvs[::-1] if uvs else None
        b = len(self.verts)
        self.verts.extend(pts)
        self.faces.append((list(range(b, b + len(pts))), uvs, smooth))

    def tris(self):
        return sum(len(f[0]) - 2 for f in self.faces)


class Part:
    """A named object being built: one Geo per material."""
    def __init__(self, name):
        self.name = name
        self.geo = {}

    def g(self, mat):
        if mat not in self.geo:
            self.geo[mat] = Geo()
        return self.geo[mat]

    # ── primitives (game frame) ──
    def box(self, mat, x0, x1, y0, y1, z0, z1, uvf=None, skip=()):
        c = ((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2)
        faces = {
            'top': ([(x0, y1, z0), (x0, y1, z1), (x1, y1, z1), (x1, y1, z0)], (0, 1, 0)),
            'bottom': ([(x0, y0, z0), (x1, y0, z0), (x1, y0, z1), (x0, y0, z1)], (0, -1, 0)),
            'px': ([(x1, y0, z0), (x1, y1, z0), (x1, y1, z1), (x1, y0, z1)], (1, 0, 0)),
            'nx': ([(x0, y0, z0), (x0, y0, z1), (x0, y1, z1), (x0, y1, z0)], (-1, 0, 0)),
            'pz': ([(x0, y0, z1), (x1, y0, z1), (x1, y1, z1), (x0, y1, z1)], (0, 0, 1)),
            'nz': ([(x0, y0, z0), (x0, y1, z0), (x1, y1, z0), (x1, y0, z0)], (0, 0, -1)),
        }
        for k, (pts, want) in faces.items():
            if k in skip:
                continue
            self.g(mat).face(pts, [uvf(*p) for p in pts] if uvf else None, want)

    def beam(self, mat, p0, p1, w, h=None):
        """square/rect bar from p0 to p1 (any direction)"""
        h = h or w
        a, b = Vector(p0), Vector(p1)
        d = (b - a)
        if d.length < 1e-6:
            return
        d.normalize()
        up = Vector((0, 1, 0)) if abs(d.y) < 0.95 else Vector((1, 0, 0))
        s = d.cross(up).normalized()
        u = s.cross(d).normalized()
        s *= w / 2
        u *= h / 2
        corners = lambda c: [c + s + u, c - s + u, c - s - u, c + s - u]
        A, B = corners(a), corners(b)
        for i in range(4):
            j = (i + 1) % 4
            quad = [A[i], A[j], B[j], B[i]]
            mid = (A[i] + A[j]) / 2 - a
            self.g(mat).face([tuple(q) for q in quad], None, tuple(mid))
        self.g(mat).face([tuple(q) for q in A], None, tuple(-d))
        self.g(mat).face([tuple(q) for q in B], None, tuple(d))

    def cyl(self, mat, c, r0, r1, y0, y1, n=16, cap0=True, cap1=True, smooth=True, axis='y', rz=None):
        """cylinder / cone along +y (or along z / x) centred on c (x, _, z)"""
        def P(a, r, y):
            ca, sa = math.cos(a), math.sin(a)
            if axis == 'y':
                return (c[0] + r * ca, y, c[2] + r * sa)
            if axis == 'z':
                return (c[0] + r * ca, c[1] + r * sa, y)
            return (y, c[1] + r * ca, c[2] + r * sa)
        axisv = {'y': (0, 1, 0), 'z': (0, 0, 1), 'x': (1, 0, 0)}[axis]
        ring0 = [P(2 * math.pi * i / n, r0, y0) for i in range(n)]
        ring1 = [P(2 * math.pi * i / n, r1, y1) for i in range(n)]
        g = self.g(mat)
        for i in range(n):
            j = (i + 1) % n
            a = 2 * math.pi * (i + 0.5) / n
            out = {'y': (math.cos(a), 0, math.sin(a)), 'z': (math.cos(a), math.sin(a), 0), 'x': (0, math.cos(a), math.sin(a))}[axis]
            g.face([ring0[i], ring0[j], ring1[j], ring1[i]], None, out, smooth)
        if cap0 and r0 > 1e-4:
            g.face(ring0, None, tuple(-v for v in axisv))
        if cap1 and r1 > 1e-4:
            g.face(ring1, None, axisv)

    def sphere(self, mat, c, rx, ry, rz, nu=16, nv=10, v0=0.0, v1=1.0, uvf=None):
        """ellipsoid (optionally only the band v0..v1, 0 = bottom pole, 1 = top pole)"""
        g = self.g(mat)
        rows = []
        for j in range(nv + 1):
            t = lerp(v0, v1, j / nv)
            phi = -math.pi / 2 + t * math.pi
            rows.append([(c[0] + rx * math.cos(phi) * math.cos(2 * math.pi * i / nu),
                          c[1] + ry * math.sin(phi),
                          c[2] + rz * math.cos(phi) * math.sin(2 * math.pi * i / nu)) for i in range(nu)])
        for j in range(nv):
            for i in range(nu):
                k = (i + 1) % nu
                q = [rows[j][i], rows[j][k], rows[j + 1][k], rows[j + 1][i]]
                cen = [sum(p[m] for p in q) / 4 - c[m] for m in range(3)]
                g.face(q, [uvf(*p) for p in q] if uvf else None, tuple(cen), True)
        if v1 < 1.0:
            g.face(rows[-1], None, (0, 1, 0))
        if v0 > 0.0:
            g.face(rows[0], None, (0, -1, 0))

    def prism(self, poly, y0, y1, mat_top, mat_side, mat_bottom=None, uv_top=None, uv_side=None, uv_bottom=None):
        """vertical prism from an (x, z) polygon (any winding, may be concave)"""
        n = len(poly)
        top = [(x, y1, z) for x, z in poly]
        self.g(mat_top).face(top, [uv_top(*p) for p in top] if uv_top else None, (0, 1, 0))
        if mat_bottom:
            bot = [(x, y0, z) for x, z in poly]
            self.g(mat_bottom).face(bot, [uv_bottom(*p) for p in bot] if uv_bottom else None, (0, -1, 0))
        for i in range(n):
            (xa, za), (xb, zb) = poly[i], poly[(i + 1) % n]
            dx, dz = xb - xa, zb - za
            ln = math.hypot(dx, dz)
            if ln < 1e-6:
                continue
            nx, nz = dz / ln, -dx / ln
            mx, mz = (xa + xb) / 2 + nx * 0.01, (za + zb) / 2 + nz * 0.01
            if point_in_poly(mx, mz, poly):
                nx, nz = -nx, -nz
            q = [(xa, y0, za), (xb, y0, zb), (xb, y1, zb), (xa, y1, za)]
            self.g(mat_side).face(q, [uv_side(*p) for p in q] if uv_side else None, (nx, 0, nz))

    def tris(self):
        return sum(g.tris() for g in self.geo.values())

    def build(self, origin=(0, 0, 0), parent=None, weld=True, sharp_deg=35.0):
        me = bpy.data.meshes.new(self.name)
        verts, faces, uvs, midx, smooth = [], [], [], [], []
        names = list(self.geo.keys())
        for mi, mname in enumerate(names):
            g = self.geo[mname]
            off = len(verts)
            verts += [V((p[0] - origin[0], p[1] - origin[1], p[2] - origin[2])) for p in g.verts]
            for idx, uv, sm in g.faces:
                faces.append([i + off for i in idx])
                uvs.append(uv)
                midx.append(mi)
                smooth.append(sm)
        me.from_pydata(verts, [], faces)
        uvl = me.uv_layers.new(name='UVMap')
        for fi, poly in enumerate(me.polygons):
            uv = uvs[fi]
            for k, li in enumerate(poly.loop_indices):
                uvl.data[li].uv = uv[k] if uv else (0.0, 0.0)
            poly.material_index = midx[fi]
            poly.use_smooth = smooth[fi]
        for mname in names:
            me.materials.append(MATS[mname])
        if weld:
            bm = bmesh.new()
            bm.from_mesh(me)
            bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=0.0005)
            bm.to_mesh(me)
            bm.free()
        me.set_sharp_from_angle(angle=math.radians(sharp_deg))
        ob = bpy.data.objects.new(self.name, me)
        bpy.context.collection.objects.link(ob)
        ob.location = V(origin)
        if parent:
            ob.parent = parent
        return ob


def point_in_poly(x, z, poly):
    inside = False
    n = len(poly)
    for i in range(n):
        xa, za = poly[i]
        xb, zb = poly[(i + 1) % n]
        if (za > z) != (zb > z):
            xc = xa + (z - za) / (zb - za) * (xb - xa)
            if xc > x:
                inside = not inside
    return inside


def text_mesh(txt, size, font_path, extrude=0.05):
    """returns (verts [(x, y, z) text-local: x reading direction, y up, z out of the face], faces, width, height)"""
    cu = bpy.data.curves.new('txt', type='FONT')
    cu.body = txt
    try:
        cu.font = bpy.data.fonts.load(font_path, check_existing=True)
    except Exception:
        pass
    cu.size = size
    cu.extrude = extrude
    cu.align_x = 'CENTER'
    cu.align_y = 'CENTER'
    ob = bpy.data.objects.new('txt', cu)
    bpy.context.collection.objects.link(ob)
    dg = bpy.context.evaluated_depsgraph_get()
    me = bpy.data.meshes.new_from_object(ob.evaluated_get(dg))
    verts = [(v.co.x, v.co.y, v.co.z) for v in me.vertices]
    faces = [list(p.vertices) for p in me.polygons]
    xs = [v[0] for v in verts]; ys = [v[1] for v in verts]
    bpy.data.objects.remove(ob)
    bpy.data.meshes.remove(me)
    return verts, faces, (min(xs), max(xs)), (min(ys), max(ys))


def add_text(part, mat, txt, size, font_path, origin, ex, ey, ez, extrude=0.05):
    """place text: ex / ey / ez = game-frame unit vectors for text x (reading), y (up), z (towards the viewer)"""
    verts, faces, (x0, x1), (y0, y1) = text_mesh(txt, size, font_path, extrude)
    cx, cy = (x0 + x1) / 2, (y0 + y1) / 2
    def T(v):
        x, y, z = v[0] - cx, v[1] - cy, v[2]
        return tuple(origin[k] + ex[k] * x + ey[k] * y + ez[k] * z for k in range(3))
    g = part.g(mat)
    for f in faces:
        pts = [T(verts[i]) for i in f]
        g.face(pts)   # the mapping is a proper rotation: winding (and so the normal) is kept


# ── weapon mounts (turrets; the gun points −z in the turret's own frame, origin = base centre) ──
def ciws(part, o):
    x, y, z = o
    part.cyl('Super', (x, 0, z), 1.15, 1.05, y, y + 0.9, 14)
    part.box('White', x - 0.95, x + 0.95, y + 0.9, y + 2.3, z - 0.9, z + 1.2)
    part.cyl('White', (x, 0, z + 0.3), 0.85, 0.85, y + 2.3, y + 3.8, 16, cap1=False)
    part.sphere('White', (x, y + 3.8, z + 0.3), 0.85, 0.75, 0.85, 16, 6, v0=0.5, v1=1.0)
    part.cyl('White', (x, y + 1.9, 0), 0.42, 0.42, z - 0.4, z + 1.0, 12, axis='z')
    part.cyl('Dark', (x, y + 2.0, 0), 0.2, 0.2, z - 3.6, z - 0.9, 8, axis='z')
    part.cyl('Dark', (x, y + 2.0, 0), 0.26, 0.26, z - 3.9, z - 3.5, 8, axis='z')

def launcher(part, o, big):
    x, y, z = o
    w, h, d = (2.4, 2.0, 4.2) if big else (1.7, 1.5, 3.4)
    part.cyl('Super', (x, 0, z), 1.1, 1.0, y, y + 1.0, 14)
    part.box('Super', x - w / 2 - 0.4, x - w / 2 - 0.05, y + 1.0, y + 2.6, z - 0.6, z + 0.6)
    part.box('Super', x + w / 2 + 0.05, x + w / 2 + 0.4, y + 1.0, y + 2.6, z - 0.6, z + 0.6)
    part.box('Super', x - w / 2, x + w / 2, y + 1.7, y + 1.7 + h, z - d / 2, z + d / 2)
    part.box('Dark', x - w / 2 + 0.12, x + w / 2 - 0.12, y + 1.82, y + 1.58 + h, z - d / 2 - 0.05, z - d / 2)
    if big:
        for cx in (-0.9, -0.3, 0.3, 0.9):
            for cy in (0.5, 1.4):
                part.box('Super', x + cx * (w / 2.4) - 0.25, x + cx * (w / 2.4) + 0.25, y + 1.7 + cy - 0.35, y + 1.7 + cy + 0.35, z - d / 2 - 0.1, z - d / 2 - 0.05)
