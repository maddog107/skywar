# ═══════════════════════════════════════════════════════════════
# SKYWAR airbase kit: the vehicle kit (tools/vehicles/vkit.py) plus structure materials.
#   skins 'concrete', 'earth', 'steelplate' → materials Concrete / Earth / Steel, box-mapped in metres (TILE m per texture
#   repeat) like the Paint skin; the game swaps in models/airbases/tex/<name>.jpg by material name (airbasemodels.js).
# Everything else (Part, Vehicle, joints rot/slide/spinj, empties, primitives, export) is vkit's.
# ═══════════════════════════════════════════════════════════════
import os, sys, math
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, '..', 'vehicles'))
import bpy, bmesh
from mathutils import Vector
import vkit
from vkit import *  # noqa: F401,F403  (Vehicle, Part, rot, slide, spinj, helpers)

EXTRA = {'concrete': 'Concrete', 'earth': 'Earth', 'steelplate': 'Steel'}   # ('steel' stays the kit's palette colour)
TILE = {'Concrete': 4.0, 'Earth': 6.0, 'Steel': 3.0}
TEX = os.path.join(vkit.REPO, 'models', 'airbases', 'tex')
ORDER = ('Paint', 'Detail', 'Track', 'Concrete', 'Earth', 'Steel')

_skin = vkit.skin_material


def skin_material(skin):
    return EXTRA.get(skin) or _skin(skin)


vkit.skin_material = skin_material


def setup_materials(scheme='blue_green'):
    vkit.setup_materials(scheme)
    for name in ('Concrete', 'Earth', 'Steel'):
        m = bpy.data.materials.get(name) or bpy.data.materials.new(name)
        m.use_nodes = True
        b = m.node_tree.nodes['Principled BSDF']
        p = os.path.join(TEX, name.lower() + '.jpg')
        if os.path.exists(p):
            t = m.node_tree.nodes.new('ShaderNodeTexImage')
            t.image = bpy.data.images.get(os.path.basename(p)) or bpy.data.images.load(p)
            m.node_tree.links.new(t.outputs['Color'], b.inputs['Base Color'])
        b.inputs['Roughness'].default_value = 0.55 if name == 'Steel' else 0.95
        b.inputs['Metallic'].default_value = 0.5 if name == 'Steel' else 0.0
        vkit.MATS[name] = m
    return vkit.MATS


_face = vkit.Part.face


def face(self, pts, skin='paint', uvs=None, smooth=False, want=None):
    mat = EXTRA.get(skin)
    if mat and uvs is None:
        pts = [tuple(float(c) for c in p) for p in pts]
        if len(pts) < 3:
            return
        n = vkit.newell(pts)
        if want is not None and n.dot(Vector(want)) < 0:
            pts = pts[::-1]
            n = -n
        ax = max(range(3), key=lambda i: abs(n[i]))
        T = TILE[mat]
        uvs = []
        for (x, y, z) in pts:
            u, v = (z, y) if ax == 0 else (x, z) if ax == 1 else (x, y)
            uvs.append((u / T, v / T))
        g = self.g(mat)
        b = len(g.verts)
        g.verts.extend(pts)
        g.faces.append((list(range(b, b + len(pts))), uvs, smooth))
        return
    return _face(self, pts, skin, uvs, smooth, want)


vkit.Part.face = face


def _mesh(self, src):
    me = bpy.data.meshes.new(self.name)
    verts, faces, uvs, midx, smooth = [], [], [], [], []
    names = [m for m in ORDER if m in src.geo]
    piv = Vector((0, 0, 0)) if src.local else src.pivot
    for mi, mname in enumerate(names):
        g = src.geo[mname]
        off = len(verts)
        verts += [vkit.V((p[0] - piv.x, p[1] - piv.y, p[2] - piv.z)) for p in g.verts]
        for idx, uv, sm in g.faces:
            faces.append([i + off for i in idx]); uvs.append(uv); midx.append(mi); smooth.append(sm)
    me.from_pydata(verts, [], faces)
    uvl = me.uv_layers.new(name='UVMap')
    for fi, poly in enumerate(me.polygons):
        uv = uvs[fi]
        for k, li in enumerate(poly.loop_indices):
            uvl.data[li].uv = uv[k] if uv else (0.0, 0.0)
        poly.material_index = midx[fi]
        poly.use_smooth = smooth[fi]
    for mname in names:
        me.materials.append(vkit.MATS[mname])
    bm = bmesh.new()
    bm.from_mesh(me)
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=0.0004)
    bm.to_mesh(me)
    bm.free()
    me.set_sharp_from_angle(angle=math.radians(38))
    return me


vkit.Part._mesh = _mesh


def arch(part, skin, span, rise, z0, z1, n=16, x0=0.0, y0=0.0, thick=0.0, caps=True, cap_skin=None):
    """a barrel vault along z: half-ellipse of `span` x `rise` (outer), from z0 to z1; thick > 0 adds the inner skin
    and the end rings (a hollow shell)"""
    def ring(sx, sy):
        return [(x0 + math.cos(math.pi * k / n) * sx / 2, y0 + math.sin(math.pi * k / n) * sy) for k in range(n + 1)]
    out = ring(span, rise)
    for k in range(n):
        (ax, ay), (bx, by) = out[k], out[k + 1]
        part.quad((ax, ay, z0), (bx, by, z0), (bx, by, z1), (ax, ay, z1), skin, want=(ax + bx - 2 * x0, ay + by - 2 * y0, 0), smooth=True)
    if thick > 0:
        inn = ring(span - 2 * thick, rise - thick)
        for k in range(n):
            (ax, ay), (bx, by) = inn[k], inn[k + 1]
            part.quad((ax, ay, z0), (bx, by, z0), (bx, by, z1), (ax, ay, z1), cap_skin or skin, want=(-(ax + bx - 2 * x0), -(ay + by - 2 * y0), 0), smooth=True)
        if caps:
            for z, s in ((z0, -1), (z1, 1)):
                for k in range(n):
                    part.quad((*out[k], z), (*out[k + 1], z), (*inn[k + 1], z), (*inn[k], z), cap_skin or skin, want=(0, 0, s))
    elif caps:
        for z, s in ((z0, -1), (z1, 1)):
            part.face([(*p, z) for p in out], cap_skin or skin, want=(0, 0, s))
    return out
