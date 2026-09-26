# ═══════════════════════════════════════════════════════════════
# SKYWAR vehicle kit (runs inside Blender): scripted, rigged ground-vehicle models.
#
# Geometry is written in the GAME frame: x right, y up (0 = ground), z aft (the vehicle faces −z), metres.
# It becomes Blender's (x, −z, y) only when a mesh is built, so the glTF exporter's +Y-up conversion hands
# three.js exactly these coordinates.
#
# A vehicle is a tree of Parts. Each Part becomes one node (one mesh, up to three materials) whose origin is its
# pivot, so the game animates it by rotating / sliding the node:
#   Part(v, 'erector', pivot=(0, 1.75, 5.3), joint=rot('x', 0, pi/2, group='raise'))
# Geometry is added in world (game-frame) coordinates at the rest pose (stowed); the kit makes it node-local.
# Empties (muzzles, exhausts, seats, ram anchors) are Part.empty(name, pos, dir).
#
# Materials (shared by every vehicle; the game swaps in its own textures by material name, see src/vehicles.js):
#   Paint   the camouflage (models/vehicles/tex/paint_<scheme>.jpg), box-mapped in metres (PAINT_TILE per tile)
#   Detail  a palette (detail.png + detail_orm.png): tyres, glass, lenses, bare metal, missile paint, …
#   Track   track links (track.jpg), u along the run so the game can scroll it
# A face's "skin" picks the material: 'paint', 'track', or a palette swatch name ('tyre', 'glass', …).
#
# Rig metadata goes to glTF extras (three.js userData):
#   node.userData.joint = JSON {type: 'rot'|'slide', axis: [x,y,z] (parent frame), min, max, stow, deploy, group}
#   root.userData.vk    = JSON {id, dims, wheels: [{node, r, steer, side}], rams: [...], tracks: [...]}
# ═══════════════════════════════════════════════════════════════
import bpy, bmesh, math, json, os, sys, random
from mathutils import Vector, Matrix, Quaternion, Euler

PAINT_TILE = 6.0
HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.normpath(os.path.join(HERE, '..', '..'))
TEX = os.path.join(REPO, 'models', 'vehicles', 'tex')

# palette order must match tools/vehicles/textures.py
PALETTE = ['tyre', 'tyre_side', 'rubber', 'black', 'dark', 'gunmetal', 'steel', 'chrome', 'glass', 'lens', 'lens_red',
           'lens_amber', 'lens_blue', 'white', 'grey', 'darkgrey', 'missile_green', 'missile_grey', 'missile_white', 'nose',
           'canvas', 'canvas_green', 'wood', 'rust', 'brass', 'copper', 'radome', 'radar_face', 'soot', 'red', 'yellow',
           'orange', 'olive', 'sand', 'tan', 'odgreen', 'hose', 'cable', 'aluminium', 'insulator', 'seat', 'dash',
           'interior', 'floor', 'blast', 'track_pad', 'zinc', 'dirt', 'lamp_glow', 'green_lamp', 'screen', 'decal_white']
PATTERNS = {'mesh': (0, 12, 4, 4), 'vents': (4, 12, 4, 4), 'tread_plate': (8, 12, 4, 4), 'dials': (12, 12, 4, 4)}
SW = 1.0 / 16   # swatch size in uv


def swatch_uv(name):
    i = PALETTE.index(name)
    cx, cy = (i % 16 + 0.5) * SW, (i // 16 + 0.5) * SW
    return (cx, 1.0 - cy)   # image row 0 is the top (v = 1)


def pattern_rect(name):
    x, y, w, h = PATTERNS[name]
    # uv rect (u0, v0, u1, v1), inset half a texel
    e = 0.5 / 512
    return (x * SW + e, 1.0 - (y + h) * SW + e, (x + w) * SW - e, 1.0 - y * SW - e)


def clamp(v, a, b):
    return a if v < a else b if v > b else v


def lerp(a, b, t):
    return a + (b - a) * t


def V(p):
    """game frame → Blender frame"""
    return Vector((p[0], -p[2], p[1]))


def G(v):
    """Blender frame → game frame"""
    return Vector((v[0], v[2], -v[1]))


def vec(p):
    return Vector((float(p[0]), float(p[1]), float(p[2])))


def newell(pts):
    nx = ny = nz = 0.0
    n = len(pts)
    for i in range(n):
        x1, y1, z1 = pts[i]
        x2, y2, z2 = pts[(i + 1) % n]
        nx += (y1 - y2) * (z1 + z2)
        ny += (z1 - z2) * (x1 + x2)
        nz += (x1 - x2) * (y1 + y2)
    return Vector((nx, ny, nz))


def frame_from_axis(d):
    """two unit vectors perpendicular to d (and to each other)"""
    d = Vector(d).normalized()
    up = Vector((0, 1, 0)) if abs(d.y) < 0.9 else Vector((1, 0, 0))
    a = d.cross(up).normalized()
    b = a.cross(d).normalized()
    return a, b


# ── materials ──
MATS = {}


def _img(name):
    p = os.path.join(TEX, name)
    im = bpy.data.images.get(name)
    if im is None:
        im = bpy.data.images.load(p)
    return im


def setup_materials(scheme='red_camo'):
    """Paint / Detail / Track with the shared textures (so Blender renders look like the game)"""
    for name in ('Paint', 'Detail', 'Track'):
        m = bpy.data.materials.get(name) or bpy.data.materials.new(name)
        m.use_nodes = True
        m.use_backface_culling = True
        nt = m.node_tree
        for n in list(nt.nodes):
            if n.type not in ('BSDF_PRINCIPLED', 'OUTPUT_MATERIAL'):
                nt.nodes.remove(n)
        b = nt.nodes['Principled BSDF']
        tex = nt.nodes.new('ShaderNodeTexImage')
        tex.image = _img({'Paint': 'paint_%s.jpg' % scheme, 'Detail': 'detail.png', 'Track': 'track.jpg'}[name])
        tex.interpolation = 'Closest' if name == 'Detail' else 'Linear'
        nt.links.new(tex.outputs['Color'], b.inputs['Base Color'])
        if name == 'Detail':
            orm = nt.nodes.new('ShaderNodeTexImage')
            orm.image = _img('detail_orm.png')
            orm.image.colorspace_settings.name = 'Non-Color'
            orm.interpolation = 'Closest'
            sep = nt.nodes.new('ShaderNodeSeparateColor')
            nt.links.new(orm.outputs['Color'], sep.inputs['Color'])
            nt.links.new(sep.outputs['Green'], b.inputs['Roughness'])
            nt.links.new(sep.outputs['Blue'], b.inputs['Metallic'])
        else:
            b.inputs['Roughness'].default_value = 0.72 if name == 'Paint' else 0.8
            b.inputs['Metallic'].default_value = 0.08 if name == 'Paint' else 0.3
        MATS[name] = m
    return MATS


def skin_material(skin):
    if skin == 'paint':
        return 'Paint'
    if skin == 'track':
        return 'Track'
    return 'Detail'


# ── geometry containers ──
class Geo:
    """Polygon soup for one material (world-frame vertices)."""
    __slots__ = ('verts', 'faces')

    def __init__(self):
        self.verts = []
        self.faces = []   # (vertex indices, uvs, smooth)

    def tris(self):
        return sum(len(f[0]) - 2 for f in self.faces)


class Vehicle:
    def __init__(self, vid, name='', scheme='red_camo', seed=1):
        self.id = vid
        self.name = name or vid
        self.scheme = scheme
        self.parts = []
        self.meta = {'id': vid, 'name': self.name, 'wheels': [], 'rams': [], 'tracks': [], 'scheme': scheme}
        self.rng = random.Random(seed)
        self.root = None

    def part(self, name, **kw):
        return Part(self, name, **kw)

    # ── finishing ──
    def bbox(self, parts=None):
        mn = Vector((1e9, 1e9, 1e9)); mx = -mn
        for p in (parts or self.parts):
            for v in p.world_verts():
                mn = Vector(map(min, mn, v)); mx = Vector(map(max, mx, v))
        return mn, mx

    def tris(self):
        return sum(p.tris() for p in self.parts)

    def build(self, center=True, out=None, report=True):
        """recentre (x/z on the travel bbox centre, y untouched), build the Blender objects, export"""
        mn, mx = self.bbox()
        # vehicles are built symmetric about x = 0: only z is recentred (on the travel bounding box)
        off = Vector((0, 0, (mn.z + mx.z) / 2)) if center else Vector((0, 0, 0))
        for p in self.parts:
            p.shift(-off)
        mn, mx = mn - off, mx - off
        self.meta['dims'] = {'length': round(mx.z - mn.z, 3), 'width': round(mx.x - mn.x, 3), 'height': round(mx.y - mn.y, 3),
                             'min': [round(v, 3) for v in mn], 'max': [round(v, 3) for v in mx]}
        root = bpy.data.objects.new(self.id, None)
        bpy.context.collection.objects.link(root)
        root.empty_display_size = 0.5
        self.root = root
        for p in self.parts:
            if p.parent is None:
                p.build(root, Vector((0, 0, 0)))
        self.meta['tris'] = self.tris()
        root['vk'] = json.dumps(self.meta, separators=(',', ':'))
        if report:
            print('VEHICLE', self.id, 'tris', self.tris(), 'dims L%.2f W%.2f H%.2f' % (mx.z - mn.z, mx.x - mn.x, mx.y - mn.y))
            for p in self.parts:
                print('   %-22s tris %6d  pivot %s%s' % (p.name, p.tris(), [round(c, 3) for c in p.pivot],
                                                      ('  joint ' + json.dumps(p.joint)) if p.joint else ''))
        if out:
            export(out)
        return root


def export(out):
    os.makedirs(os.path.dirname(os.path.abspath(out)), exist_ok=True)
    bpy.ops.export_scene.gltf(filepath=out, export_format='GLB', export_extras=True, export_yup=True,
                              export_materials='EXPORT', export_image_format='NONE', export_texcoords=True,
                              export_normals=True, export_cameras=False, export_lights=False, export_animations=False,
                              export_apply=False)
    print('EXPORTED', out, os.path.getsize(out), 'bytes')


AXES = {'x': [1, 0, 0], 'y': [0, 1, 0], 'z': [0, 0, 1], '-x': [-1, 0, 0], '-y': [0, -1, 0], '-z': [0, 0, -1]}


def rot(axis, lo, hi, stow=0.0, deploy=None, group=None, **extra):
    ax = AXES[axis] if isinstance(axis, str) else [float(c) for c in axis]
    j = {'type': 'rot', 'axis': ax, 'min': lo, 'max': hi, 'stow': stow, 'deploy': hi if deploy is None else deploy}
    if group:
        j['group'] = group
    j.update(extra)
    return j


def spinj(axis='y', rpm=6.0, **extra):
    """a continuously turning joint (radar antennas): vehicles.js spin(rig, dt) advances it at rpm"""
    ax = AXES[axis] if isinstance(axis, str) else [float(c) for c in axis]
    j = {'type': 'spin', 'axis': ax, 'min': 0, 'max': 6.283185307179586, 'stow': 0, 'deploy': 0, 'rpm': rpm, 'group': 'spin'}
    j.update(extra)
    return j


def slide(axis, dist, group=None, **extra):
    ax = AXES[axis] if isinstance(axis, str) else [float(c) for c in axis]
    j = {'type': 'slide', 'axis': ax, 'min': 0, 'max': dist, 'stow': 0, 'deploy': dist}
    if group:
        j['group'] = group
    j.update(extra)
    return j


class Part:
    """One node: geometry per material, a pivot (node origin, world frame at rest), an optional joint."""

    def __init__(self, veh, name, pivot=(0, 0, 0), parent=None, joint=None, local=False, rest_yaw=0.0, share=None, extras=None):
        self.v = veh
        self.name = name
        self.pivot = vec(pivot)
        self.parent = parent
        self.joint = joint
        self.local = local           # geometry given in node-local coordinates (for shared meshes / rest rotations)
        self.rest_yaw = rest_yaw     # rest rotation about y (radians), only with local geometry
        self.share = share           # reuse another Part's mesh (linked duplicate → one glTF mesh)
        self.extras = extras or {}
        self.geo = {}
        self.children = []
        self.empties = []            # (name, pos, dir, extras)
        self.uvoff = (veh.rng.random() * 3, veh.rng.random() * 3)
        self.obj = None
        if parent:
            parent.children.append(self)
        veh.parts.append(self)

    # ── bookkeeping ──
    def g(self, mat):
        if mat not in self.geo:
            self.geo[mat] = Geo()
        return self.geo[mat]

    def tris(self):
        src = self.share or self
        return sum(g.tris() for g in src.geo.values())

    def world_verts(self):
        if self.share:
            src = self.share
            if src.local:
                c, s = math.cos(self.rest_yaw), math.sin(self.rest_yaw)
                for g in src.geo.values():
                    for (x, y, z) in g.verts:
                        yield Vector((x * c + z * s, y, -x * s + z * c)) + self.world_pivot()
            return
        for g in self.geo.values():
            for p in g.verts:
                yield (Vector(p) + self.world_pivot()) if self.local else Vector(p)

    def world_pivot(self):
        return self.pivot

    def shift(self, off):
        """move the whole part (pivot, and world-frame geometry) by off"""
        self.pivot = self.pivot + off
        if not self.local:
            for g in self.geo.values():
                g.verts = [(x + off.x, y + off.y, z + off.z) for (x, y, z) in g.verts]
        self.empties = [(n, (Vector(p) + off) if not self.local else Vector(p), d, e) for (n, p, d, e) in self.empties]

    def rotate_about(self, pivot, axis, angle, empties=True):
        """rotate all geometry (and empties) built so far about a world axis through pivot: model a part in its
        deployed pose, then turn it into the stowed rest pose (paint UVs stay with the faces)"""
        q = Quaternion(Vector(axis).normalized(), angle)
        pv = vec(pivot)
        for g in self.geo.values():
            g.verts = [tuple(pv + q @ (Vector(p) - pv)) for p in g.verts]
        if empties:
            self.empties = [(n, pv + q @ (Vector(p) - pv), q @ Vector(d), e) for (n, p, d, e) in self.empties]

    # ── faces ──
    def face(self, pts, skin='paint', uvs=None, smooth=False, want=None):
        pts = [tuple(float(c) for c in p) for p in pts]
        if len(pts) < 3:
            return
        n = newell(pts)
        if want is not None and n.dot(Vector(want)) < 0:
            pts = pts[::-1]
            uvs = uvs[::-1] if uvs else None
            n = -n
        mat = skin_material(skin)
        if mat == 'Paint':
            if uvs is None:
                uvs = self.paint_uv(pts, n)
        elif mat == 'Detail':
            if skin in PATTERNS:
                r = pattern_rect(skin)
                if uvs is None:
                    uvs = [(0, 0), (1, 0), (1, 1), (0, 1)][:len(pts)] if len(pts) == 4 else [(0.5, 0.5)] * len(pts)
                uvs = [(lerp(r[0], r[2], u), lerp(r[1], r[3], w)) for (u, w) in uvs]
            else:
                c = swatch_uv(skin)
                uvs = [c] * len(pts)
        elif uvs is None:
            uvs = [(0, 0)] * len(pts)
        g = self.g(mat)
        b = len(g.verts)
        g.verts.extend(pts)
        g.faces.append((list(range(b, b + len(pts))), [tuple(u) for u in uvs], smooth))

    def paint_uv(self, pts, n):
        ax = max(range(3), key=lambda i: abs(n[i]))
        ou, ov = self.uvoff
        if self.local:
            ou = ov = 0
        res = []
        for (x, y, z) in pts:
            if ax == 0:
                u, v = z, y
            elif ax == 1:
                u, v = x, z
            else:
                u, v = x, y
            res.append((u / PAINT_TILE + ou, v / PAINT_TILE + ov))
        return res

    def quad(self, a, b, c, d, skin='paint', want=None, uvs=None, smooth=False):
        self.face([a, b, c, d], skin, uvs, smooth, want)

    def tri(self, a, b, c, skin='paint', want=None):
        self.face([a, b, c], skin, None, False, want)

    # ── empties ──
    def empty(self, name, pos, direction=(0, 0, -1), **extras):
        self.empties.append((name, vec(pos), vec(direction), extras))

    # ── build ──
    def build(self, parent_obj, parent_pivot):
        src = self.share or self
        if self.share and self.share.obj is not None:
            me = self.share.obj.data
        else:
            me = self._mesh(src)
        ob = bpy.data.objects.new(self.name, me)
        bpy.context.collection.objects.link(ob)
        ob.parent = parent_obj
        ob.location = V(self.pivot - parent_pivot)
        if self.rest_yaw:
            ob.rotation_mode = 'XYZ'
            ob.rotation_euler = (0, 0, self.rest_yaw)
        if self.joint:
            ob['joint'] = json.dumps(self.joint, separators=(',', ':'))
        for k, val in self.extras.items():
            ob[k] = val if isinstance(val, (int, float, str)) else json.dumps(val, separators=(',', ':'))
        self.obj = ob
        for (name, pos, d, extras) in self.empties:
            e = bpy.data.objects.new(name, None)
            bpy.context.collection.objects.link(e)
            e.empty_display_size = 0.15
            e.empty_display_type = 'ARROWS'
            e.parent = ob
            lp = pos if self.local else (pos - self.pivot)
            e.location = V(lp)
            # three.js: the empty's local -Z points along d  ⇔  Blender: local +Y along V(d)
            bd = V(d)
            if bd.length > 1e-6:
                q = bd.normalized().to_track_quat('Y', 'Z')
                e.rotation_mode = 'QUATERNION'
                e.rotation_quaternion = q
            for k, val in extras.items():
                e[k] = val if isinstance(val, (int, float, str)) else json.dumps(val, separators=(',', ':'))
        for c in self.children:
            c.build(ob, self.pivot)
        return ob

    def _mesh(self, src):
        me = bpy.data.meshes.new(self.name)
        verts, faces, uvs, midx, smooth = [], [], [], [], []
        names = [m for m in ('Paint', 'Detail', 'Track') if m in src.geo]
        piv = Vector((0, 0, 0)) if src.local else src.pivot
        for mi, mname in enumerate(names):
            g = src.geo[mname]
            off = len(verts)
            verts += [V((p[0] - piv.x, p[1] - piv.y, p[2] - piv.z)) for p in g.verts]
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
        bm = bmesh.new()
        bm.from_mesh(me)
        bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=0.0004)
        bm.to_mesh(me)
        bm.free()
        me.set_sharp_from_angle(angle=math.radians(38))
        return me

    # ═════════════ primitives (world frame unless the part is local) ═════════════
    def box(self, skin, x0, x1, y0, y1, z0, z1, skip=(), bev=0.0, skins=None):
        """axis-aligned box; bev > 0 chamfers every edge; skins = {'top': skin, ...} per face"""
        if x0 > x1: x0, x1 = x1, x0
        if y0 > y1: y0, y1 = y1, y0
        if z0 > z1: z0, z1 = z1, z0
        sk = lambda k: (skins or {}).get(k, skin)
        if bev <= 0:
            F = {
                'top': ([(x0, y1, z0), (x0, y1, z1), (x1, y1, z1), (x1, y1, z0)], (0, 1, 0)),
                'bottom': ([(x0, y0, z0), (x1, y0, z0), (x1, y0, z1), (x0, y0, z1)], (0, -1, 0)),
                'px': ([(x1, y0, z0), (x1, y1, z0), (x1, y1, z1), (x1, y0, z1)], (1, 0, 0)),
                'nx': ([(x0, y0, z0), (x0, y0, z1), (x0, y1, z1), (x0, y1, z0)], (-1, 0, 0)),
                'pz': ([(x0, y0, z1), (x1, y0, z1), (x1, y1, z1), (x0, y1, z1)], (0, 0, 1)),
                'nz': ([(x0, y0, z0), (x0, y1, z0), (x1, y1, z0), (x1, y0, z0)], (0, 0, -1)),
            }
            for k, (pts, want) in F.items():
                if k not in skip:
                    self.face(pts, sk(k), want=want)
            return
        b = min(bev, (x1 - x0) / 2.01, (y1 - y0) / 2.01, (z1 - z0) / 2.01)
        cx, cy, cz = (x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2
        hx, hy, hz = (x1 - x0) / 2, (y1 - y0) / 2, (z1 - z0) / 2

        def P(sx, sy, sz, face):
            # the chamfer vertex at corner (sx, sy, sz) lying on the face 'x' | 'y' | 'z'
            X = hx if face == 'x' else hx - b
            Y = hy if face == 'y' else hy - b
            Z = hz if face == 'z' else hz - b
            return (cx + sx * X, cy + sy * Y, cz + sz * Z)
        S = (-1, 1)
        names = {('x', 1): 'px', ('x', -1): 'nx', ('y', 1): 'top', ('y', -1): 'bottom', ('z', 1): 'pz', ('z', -1): 'nz'}
        # faces
        for s in S:
            if names[('x', s)] not in skip:
                self.face([P(s, sy, sz, 'x') for sy, sz in ((-1, -1), (1, -1), (1, 1), (-1, 1))], sk(names[('x', s)]), want=(s, 0, 0))
            if names[('y', s)] not in skip:
                self.face([P(sx, s, sz, 'y') for sx, sz in ((-1, -1), (1, -1), (1, 1), (-1, 1))], sk(names[('y', s)]), want=(0, s, 0))
            if names[('z', s)] not in skip:
                self.face([P(sx, sy, s, 'z') for sx, sy in ((-1, -1), (1, -1), (1, 1), (-1, 1))], sk(names[('z', s)]), want=(0, 0, s))
        # edges
        for sy in S:
            for sz in S:
                self.face([P(-1, sy, sz, 'y'), P(1, sy, sz, 'y'), P(1, sy, sz, 'z'), P(-1, sy, sz, 'z')], skin, want=(0, sy, sz))
        for sx in S:
            for sz in S:
                self.face([P(sx, -1, sz, 'x'), P(sx, 1, sz, 'x'), P(sx, 1, sz, 'z'), P(sx, -1, sz, 'z')], skin, want=(sx, 0, sz))
        for sx in S:
            for sy in S:
                self.face([P(sx, sy, -1, 'x'), P(sx, sy, 1, 'x'), P(sx, sy, 1, 'y'), P(sx, sy, -1, 'y')], skin, want=(sx, sy, 0))
        # corners
        for sx in S:
            for sy in S:
                for sz in S:
                    self.face([P(sx, sy, sz, 'x'), P(sx, sy, sz, 'y'), P(sx, sy, sz, 'z')], skin, want=(sx, sy, sz))

    def cbox(self, skin, c, size, **kw):
        x, y, z = c
        w, h, d = size
        self.box(skin, x - w / 2, x + w / 2, y - h / 2, y + h / 2, z - d / 2, z + d / 2, **kw)

    def prism_x(self, skin, prof, x0, x1, cap0=True, cap1=True, cap_skin=None, side_skins=None, smooth=False):
        """extrude a side profile [(z, y), ...] (a closed polygon, any winding, may be concave) from x0 to x1.
        side_skins: optional per-edge skin list (edge i joins prof[i] → prof[i+1])"""
        n = len(prof)
        # centroid for outward-normal hints
        cz = sum(p[0] for p in prof) / n
        cy = sum(p[1] for p in prof) / n
        area = sum(prof[i][0] * prof[(i + 1) % n][1] - prof[(i + 1) % n][0] * prof[i][1] for i in range(n)) / 2
        sgn = 1 if area > 0 else -1
        for i in range(n):
            (za, ya), (zb, yb) = prof[i], prof[(i + 1) % n]
            dz, dy = zb - za, yb - ya
            if abs(dz) + abs(dy) < 1e-7:
                continue
            # outward normal in (z, y) for a CCW polygon (z right, y up) is (dy, -dz)
            nz, ny = dy * sgn, -dz * sgn
            sk = side_skins[i] if side_skins else skin
            self.face([(x0, ya, za), (x1, ya, za), (x1, yb, zb), (x0, yb, zb)], sk, want=(0, ny, nz), smooth=smooth)
        cs = cap_skin or skin
        if cap0:
            self.face([(x0, y, z) for (z, y) in prof], cs, want=(-1, 0, 0))
        if cap1:
            self.face([(x1, y, z) for (z, y) in prof], cs, want=(1, 0, 0))

    def prism_y(self, skin, poly, y0, y1, cap0=True, cap1=True, cap_skin=None):
        """extrude a plan polygon [(x, z), ...] vertically from y0 to y1"""
        n = len(poly)
        area = sum(poly[i][0] * poly[(i + 1) % n][1] - poly[(i + 1) % n][0] * poly[i][1] for i in range(n)) / 2
        sgn = 1 if area > 0 else -1
        for i in range(n):
            (xa, za), (xb, zb) = poly[i], poly[(i + 1) % n]
            dx, dz = xb - xa, zb - za
            if abs(dx) + abs(dz) < 1e-7:
                continue
            # CCW in (x, z) with x right and z *down the page*: outward = (dz, -dx) * sgn
            nx, nz = dz * sgn, -dx * sgn
            self.face([(xa, y0, za), (xb, y0, zb), (xb, y1, zb), (xa, y1, za)], skin, want=(nx, 0, nz))
        cs = cap_skin or skin
        if cap1:
            self.face([(x, y1, z) for (x, z) in poly], cs, want=(0, 1, 0))
        if cap0:
            self.face([(x, y0, z) for (x, z) in poly], cs, want=(0, -1, 0))

    def prism_z(self, skin, prof, z0, z1, cap0=True, cap1=True, cap_skin=None, smooth=False):
        """extrude a cross-section [(x, y), ...] along z from z0 to z1"""
        n = len(prof)
        area = sum(prof[i][0] * prof[(i + 1) % n][1] - prof[(i + 1) % n][0] * prof[i][1] for i in range(n)) / 2
        sgn = 1 if area > 0 else -1
        for i in range(n):
            (xa, ya), (xb, yb) = prof[i], prof[(i + 1) % n]
            dx, dy = xb - xa, yb - ya
            if abs(dx) + abs(dy) < 1e-7:
                continue
            nx, ny = dy * sgn, -dx * sgn
            self.face([(xa, ya, z0), (xb, yb, z0), (xb, yb, z1), (xa, ya, z1)], skin, want=(nx, ny, 0), smooth=smooth)
        cs = cap_skin or skin
        if cap0:
            self.face([(x, y, z0) for (x, y) in prof], cs, want=(0, 0, -1))
        if cap1:
            self.face([(x, y, z1) for (x, y) in prof], cs, want=(0, 0, 1))

    def loft(self, skin, rings, closed=True, cap0=False, cap1=False, smooth=True, cap_skin=None, skins=None):
        """join successive rings (equal point counts); outward = away from each ring's centroid"""
        m = len(rings[0])
        cents = [Vector([sum(p[k] for p in r) / m for k in range(3)]) for r in rings]
        for j in range(len(rings) - 1):
            A, B = rings[j], rings[j + 1]
            sk = skins[j] if skins else skin
            for i in range(m if closed else m - 1):
                k = (i + 1) % m
                mid = (Vector(A[i]) + Vector(A[k]) + Vector(B[i]) + Vector(B[k])) / 4
                out = mid - (cents[j] + cents[j + 1]) / 2
                self.face([A[i], A[k], B[k], B[i]], sk, want=tuple(out), smooth=smooth)
        axis = cents[-1] - cents[0]
        if cap0:
            self.face(rings[0], cap_skin or skin, want=tuple(-axis))
        if cap1:
            self.face(rings[-1], cap_skin or skin, want=tuple(axis))

    def ring(self, c, axis, r, n, phase=0.0, a=None, b=None):
        c = vec(c)
        if a is None:
            a, b = frame_from_axis(axis)
        return [tuple(c + a * (r * math.cos(phase + 2 * math.pi * i / n)) + b * (r * math.sin(phase + 2 * math.pi * i / n))) for i in range(n)]

    def cyl(self, skin, p0, p1, r0, r1=None, n=12, cap0=True, cap1=True, smooth=True, cap_skin=None, phase=None):
        """cylinder / cone from p0 to p1 (any direction)"""
        r1 = r0 if r1 is None else r1
        p0, p1 = vec(p0), vec(p1)
        d = p1 - p0
        if d.length < 1e-7:
            return
        a, b = frame_from_axis(d)
        ph = math.pi / n if phase is None else phase
        R0 = self.ring(p0, d, r0, n, ph, a, b)
        R1 = self.ring(p1, d, r1, n, ph, a, b)
        self.loft(skin, [R0, R1], smooth=smooth)
        if cap0 and r0 > 1e-5:
            self.face(R0, cap_skin or skin, want=tuple(-d))
        if cap1 and r1 > 1e-5:
            self.face(R1, cap_skin or skin, want=tuple(d))

    def lathe(self, p0, axis, prof, n=16, smooth=True, cap0=False, cap1=False, phase=None, a=None, b=None):
        """surface of revolution: prof = [(t, r, skin), ...] (t along axis from p0; skin applies to the band from this
        station to the next). r = 0 closes to a point. Each band faces the left of the profile's direction in the (t, r)
        plane (t to the right, r up): a skin traversed towards +t faces outwards, a step back along the axis faces in."""
        p0 = vec(p0)
        d = Vector(axis).normalized()
        if a is None:
            a, b = frame_from_axis(d)
        ph = math.pi / n if phase is None else phase
        rings = []
        for (t, r, sk) in prof:
            c = p0 + d * t
            rings.append((c, r, sk, [tuple(c + a * (r * math.cos(ph + 2 * math.pi * i / n)) + b * (r * math.sin(ph + 2 * math.pi * i / n))) for i in range(n)]))
        for j in range(len(rings) - 1):
            c0, r0, sk, A = rings[j]
            c1, r1, _, B = rings[j + 1]
            if r0 < 1e-6 and r1 < 1e-6:
                continue
            for i in range(n):
                k = (i + 1) % n
                ang = ph + 2 * math.pi * (i + 0.5) / n
                radial = a * math.cos(ang) + b * math.sin(ang)
                # the band faces the LEFT of the profile's direction of travel in the (t, r) plane: an outer skin
                # traversed towards +t faces out, and a profile that steps back along the axis (a bore, a recess,
                # the inside of a lip) faces in. Traverse a profile the other way to show its other side.
                dt = (c1 - c0).dot(d)
                want = radial * dt - d * (r1 - r0)
                if r0 < 1e-6:
                    self.face([A[i], B[k], B[i]], sk, want=tuple(want), smooth=smooth)
                elif r1 < 1e-6:
                    self.face([A[i], A[k], B[i]], sk, want=tuple(want), smooth=smooth)
                else:
                    self.face([A[i], A[k], B[k], B[i]], sk, want=tuple(want), smooth=smooth)
        if cap0 and rings[0][1] > 1e-6:
            self.face(rings[0][3], rings[0][2], want=tuple(-d))
        if cap1 and rings[-1][1] > 1e-6:
            self.face(rings[-1][3], rings[-2][2] if len(rings) > 1 else rings[-1][2], want=tuple(d))
        return rings

    def tube(self, skin, pts, r, n=6, closed=False, smooth=True, caps=True):
        """a round bar swept along a polyline (parallel-transport frames)"""
        pts = [vec(p) for p in pts]
        if len(pts) < 2:
            return
        rings = []
        t0 = (pts[1] - pts[0]).normalized()
        a, b = frame_from_axis(t0)
        for i, p in enumerate(pts):
            if i == 0:
                t = t0
            elif i == len(pts) - 1:
                t = (pts[i] - pts[i - 1]).normalized()
            else:
                t = ((pts[i] - pts[i - 1]).normalized() + (pts[i + 1] - pts[i]).normalized()).normalized()
            # transport a
            a = (a - t * a.dot(t)).normalized()
            b = t.cross(a).normalized()
            # keep the cross-section size at bends
            s = 1.0
            if 0 < i < len(pts) - 1:
                cosh = max(0.3, (pts[i] - pts[i - 1]).normalized().dot(t))
                s = 1.0 / cosh
            rings.append([tuple(p + (a * math.cos(2 * math.pi * k / n) + b * math.sin(2 * math.pi * k / n)) * r * (s if abs(math.cos(2 * math.pi * k / n)) > 0 else 1)) for k in range(n)])
        self.loft(skin, rings, smooth=smooth)
        if caps and not closed:
            self.face(rings[0], skin, want=tuple(pts[0] - pts[1]))
            self.face(rings[-1], skin, want=tuple(pts[-1] - pts[-2]))

    def beam(self, skin, p0, p1, w, h=None, up=None):
        """rectangular bar from p0 to p1; `up` orients the h side"""
        h = h or w
        p0, p1 = vec(p0), vec(p1)
        d = p1 - p0
        if d.length < 1e-7:
            return
        d.normalize()
        u = Vector(up) if up else (Vector((0, 1, 0)) if abs(d.y) < 0.95 else Vector((1, 0, 0)))
        s = d.cross(u).normalized() * (w / 2)
        u = s.cross(d).normalized() * (h / 2)
        A = [p0 + s + u, p0 - s + u, p0 - s - u, p0 + s - u]
        B = [p1 + s + u, p1 - s + u, p1 - s - u, p1 + s - u]
        for i in range(4):
            j = (i + 1) % 4
            mid = (A[i] + A[j]) / 2 - p0
            self.face([tuple(A[i]), tuple(A[j]), tuple(B[j]), tuple(B[i])], skin, want=tuple(mid))
        self.face([tuple(q) for q in A], skin, want=tuple(-d))
        self.face([tuple(q) for q in B], skin, want=tuple(d))

    def disc(self, skin, c, normal, r, n=12, phase=None):
        c = vec(c)
        a, b = frame_from_axis(normal)
        ph = math.pi / n if phase is None else phase
        self.face([tuple(c + a * (r * math.cos(ph + 2 * math.pi * i / n)) + b * (r * math.sin(ph + 2 * math.pi * i / n))) for i in range(n)], skin, want=tuple(normal))

    def panel(self, skin, pts, normal, off=0.004, frame=None, frame_skin='rubber'):
        """a flat inset (window, hatch, plate) lying on a surface: pts on the surface plane, pushed off along normal.
        frame > 0 adds a border quad `frame` wider underneath (a rubber seal / frame)"""
        nrm = Vector(normal).normalized()
        P = [vec(p) for p in pts]
        c = sum(P, Vector()) / len(P)
        if frame:
            F = []
            for p in P:
                dv = p - c
                dv = dv - nrm * dv.dot(nrm)
                F.append(p + dv.normalized() * frame + nrm * (off * 0.5))
            self.face([tuple(q) for q in F], frame_skin, want=tuple(nrm))
        self.face([tuple(p + nrm * off) for p in P], skin, want=tuple(nrm))

    def bolts(self, skin, c, normal, rc, n, rb=0.02, h=0.02, seg=6, phase=0.0):
        """a circle of n bolt heads (small cylinders) around c"""
        c = vec(c)
        nr = Vector(normal).normalized()
        a, b = frame_from_axis(nr)
        for i in range(n):
            ang = phase + 2 * math.pi * i / n
            p = c + (a * math.cos(ang) + b * math.sin(ang)) * rc
            self.cyl(skin, p, p + nr * h, rb, rb, seg, cap0=False, smooth=False)


# ═════════════ reusable components ═════════════

def tyre_profile(R, W, rim_r, bulge=0.08):
    """sidewall cross-section from the rim bead out to the tread shoulder: [(r, x)] for x ≥ 0 (outer half)"""
    hw = W / 2
    return [(rim_r, hw * 0.78), (rim_r + (R - rim_r) * 0.25, hw * 0.96), (rim_r + (R - rim_r) * 0.55, hw * (1.0 + bulge * 0.3)),
            (R - (R - rim_r) * 0.18, hw * 0.97), (R - 0.012, hw * 0.88)]


def build_wheel(part, R, W, rim_r, lugs=18, seg=28, style='mil', hub_skin='paint', rim_skin='paint', nbolts=10,
                dual=False, tread='chevron', rim_dish=0.0, hub_cap=True, cti=False):
    """a complete wheel in local coordinates (axle along x, OUTER face towards +x, centre at the origin):
    tyre (sidewalls, a tread band and lug blocks), rim, hub, bolts. style 'mil' = cross-country lug tread."""
    p = part
    hw = W / 2
    prof = tyre_profile(R, W, rim_r)
    d = R * 0.035 if tread != 'road' else R * 0.015     # lug depth
    Rb = R - d                                            # tread base radius
    ax = Vector((1, 0, 0))
    a, b = Vector((0, 1, 0)), Vector((0, 0, 1))
    # sidewalls (both sides) + shoulders + tread base, as one lathe per side
    for side in (1, -1):
        st = [(x * side, r, 'tyre_side') for (r, x) in prof] + [(hw * 0.84 * side, Rb, 'tyre')]
        # lathe along x with stations at x positions: build rings manually
        rings = []
        for (x, r, sk) in st:
            rings.append([(x, r * math.cos(2 * math.pi * i / seg), r * math.sin(2 * math.pi * i / seg)) for i in range(seg)])
        for j in range(len(rings) - 1):
            for i in range(seg):
                k = (i + 1) % seg
                ang = 2 * math.pi * (i + 0.5) / seg
                want = (side * 0.8, math.cos(ang), math.sin(ang))
                p.face([rings[j][i], rings[j][k], rings[j + 1][k], rings[j + 1][i]], st[j][2], want=want, smooth=True)
    # tread base band between the shoulders
    ringA = [(-hw * 0.84, Rb * math.cos(2 * math.pi * i / seg), Rb * math.sin(2 * math.pi * i / seg)) for i in range(seg)]
    ringB = [(hw * 0.84, Rb * math.cos(2 * math.pi * i / seg), Rb * math.sin(2 * math.pi * i / seg)) for i in range(seg)]
    for i in range(seg):
        k = (i + 1) % seg
        ang = 2 * math.pi * (i + 0.5) / seg
        p.face([ringA[i], ringA[k], ringB[k], ringB[i]], 'tyre', want=(0, math.cos(ang), math.sin(ang)), smooth=True)
    # lug blocks: chevrons alternating left / right, each a curved block over ~55 % of the pitch
    if tread != 'road':
        pitch = 2 * math.pi / lugs
        for i in range(lugs):
            for side in (1, -1):
                a0 = i * pitch + (0.5 * pitch if side < 0 else 0)
                a1 = a0 + pitch * 0.55
                sweep = pitch * 0.35 if tread == 'chevron' else 0.0     # the lug leans back towards the shoulder
                xi, xo = side * hw * 0.06, side * hw * 0.98
                def pt(x, ang, r):
                    return (x, r * math.cos(ang), r * math.sin(ang))
                # footprint corners (inner edge at a0..a1, outer edge swept back)
                c = [(xi, a0, 0), (xi, a1, 0), (xo, a1 + sweep, 0), (xo, a0 + sweep, 0)]
                top = [pt(x, ang, R) for (x, ang, _) in c]
                bot = [pt(x, ang, Rb - 0.002) for (x, ang, _) in c]
                mid_ang = (a0 + a1) / 2 + sweep / 2
                out = (0, math.cos(mid_ang), math.sin(mid_ang))
                p.face(top, 'tyre', want=out)
                for e in range(4):
                    f = (e + 1) % 4
                    en = Vector(top[e]) + Vector(top[f]) - Vector(top[(e + 2) % 4]) - Vector(top[(e + 3) % 4])
                    p.face([bot[e], bot[f], top[f], top[e]], 'tyre', want=tuple(en))
    # rim: an outer flange ring, a dished disc and a hub boss
    rs = rim_skin
    fl = rim_r + 0.025
    xo = hw * 0.78
    # (traversed from the hub out to the flange, so the faces look outwards, +x, into the dish)
    p.lathe((xo + 0.01, 0, 0), (-1, 0, 0), [(0.08 + rim_dish, 0.0001, rs), (0.08 + rim_dish, rim_r * 0.35, rs), (0.09 + rim_dish, rim_r * 0.55, rs),
                                          (0.06 + rim_dish, rim_r * 0.92, rs), (0.03, rim_r, rs), (0, fl, rs)],
            n=seg, smooth=False, a=a, b=b)
    # hub boss and cap
    hx = xo + 0.01 - 0.08 - rim_dish
    p.cyl(hub_skin, (hx, 0, 0), (hx + 0.07, 0, 0), rim_r * 0.33, rim_r * 0.3, 12, cap0=False, smooth=True)
    if hub_cap:
        p.cyl('dark', (hx + 0.07, 0, 0), (hx + 0.11, 0, 0), rim_r * 0.2, rim_r * 0.14, 10, cap0=False, smooth=True)
    p.bolts('dark', (hx + 0.005, 0, 0), (1, 0, 0), rim_r * 0.44, nbolts, rb=0.018, h=0.03, seg=6)
    # vent holes in the rim disc (dark patches)
    for i in range(6):
        ang = 2 * math.pi * (i + 0.5) / 6
        c = Vector((hx + 0.012, 0, 0)) + (a * math.cos(ang) + b * math.sin(ang)) * rim_r * 0.7
        p.disc('black', c, (1, 0, 0), rim_r * 0.1, 8)
    if cti:
        # central tyre inflation: an air line from the hub to the rim valve
        p.tube('hose', [(hx + 0.08, 0.02, 0), (hx + 0.06, rim_r * 0.5, 0.05), (xo, rim_r * 0.85, 0.08)], 0.012, 5)
    # inner side of the rim (seen from inboard)
    p.disc(rs, (-xo, 0, 0), (-1, 0, 0), fl, seg)


def headlight(part, c, normal, r=0.09, depth=0.08, skin_body='paint', lens='lens', guard=False):
    """a round lamp: short housing, a lens, optionally a wire guard"""
    c = vec(c)
    nr = Vector(normal).normalized()
    part.cyl(skin_body, c - nr * depth, c, r * 1.12, r * 1.08, 12, cap0=True, cap1=False)
    part.cyl('dark', c, c + nr * 0.012, r * 1.08, r * 1.0, 12, cap0=False, cap1=False)
    part.disc(lens, c + nr * 0.01, nr, r, 12)
    if guard:
        a, b = frame_from_axis(nr)
        for k in (-0.5, 0, 0.5):
            p0 = c + nr * 0.05 + a * (k * r) - b * r * 1.05
            p1 = c + nr * 0.05 + a * (k * r) + b * r * 1.05
            part.beam('dark', p0, p1, 0.008, 0.008)
        part.beam('dark', c + nr * 0.05 - a * r * 1.05, c + nr * 0.05 + a * r * 1.05, 0.008, 0.008)


def lamp_box(part, c, size, normal, lens='lens_red', skin='dark'):
    """a small rectangular lamp (tail light, marker): body box + lens face"""
    x, y, z = c
    w, h, d = size
    part.box(skin, x - w / 2, x + w / 2, y - h / 2, y + h / 2, z - d / 2, z + d / 2)
    nr = Vector(normal).normalized()
    fc = Vector(c) + nr * (d / 2 if abs(nr.z) > 0.5 else (w / 2 if abs(nr.x) > 0.5 else h / 2))
    if abs(nr.z) > 0.5:
        pts = [(x - w * 0.42, y - h * 0.4, fc.z), (x + w * 0.42, y - h * 0.4, fc.z), (x + w * 0.42, y + h * 0.4, fc.z), (x - w * 0.42, y + h * 0.4, fc.z)]
    else:
        pts = [(fc.x, y - h * 0.4, z - d * 0.42), (fc.x, y - h * 0.4, z + d * 0.42), (fc.x, y + h * 0.4, z + d * 0.42), (fc.x, y + h * 0.4, z - d * 0.42)]
    part.panel(lens, pts, nr, off=0.003)


def ladder(part, x, y0, y1, z0, z1, rungs=4, skin='dark', w=0.025):
    """a vertical boarding ladder: two stiles at z0 / z1 and round rungs"""
    part.beam(skin, (x, y0, z0), (x, y1, z0), w, w)
    part.beam(skin, (x, y0, z1), (x, y1, z1), w, w)
    for i in range(rungs):
        y = lerp(y0 + 0.05, y1 - 0.05, i / max(1, rungs - 1))
        part.cyl(skin, (x, y, z0), (x, y, z1), 0.012, 0.012, 6, smooth=False)


def handrail(part, pts, r=0.016, skin='paint'):
    part.tube(skin, pts, r, 6)


def grab_handle(part, c, along, normal, length=0.25, stand=0.05, skin='dark'):
    c, al, nr = vec(c), Vector(along).normalized(), Vector(normal).normalized()
    p0 = c - al * (length / 2)
    p1 = c + al * (length / 2)
    part.tube(skin, [p0, p0 + nr * stand, p1 + nr * stand, p1], 0.011, 5)


def mirror(part, base, head, size=(0.2, 0.3), skin='dark'):
    """rear-view mirror: an arm from base to head, and a mirror box facing aft"""
    base, head = vec(base), vec(head)
    part.tube(skin, [base, (base + head) / 2 + Vector((0, 0.05, 0)), head], 0.013, 5)
    w, h = size
    part.box(skin, head.x - w / 2, head.x + w / 2, head.y - h / 2, head.y + h / 2, head.z - 0.02, head.z + 0.03)
    part.panel('glass', [(head.x - w * 0.42, head.y - h * 0.42, head.z + 0.03), (head.x + w * 0.42, head.y - h * 0.42, head.z + 0.03),
                         (head.x + w * 0.42, head.y + h * 0.42, head.z + 0.03), (head.x - w * 0.42, head.y + h * 0.42, head.z + 0.03)], (0, 0, 1), off=0.003)


def jerrycan(part, c, facing=(1, 0, 0), skin='paint'):
    x, y, z = c
    part.box(skin, x - 0.08, x + 0.08, y, y + 0.47, z - 0.17, z + 0.17, bev=0.015)
    part.cyl('dark', (x, y + 0.47, z - 0.1), (x, y + 0.53, z - 0.1), 0.025, 0.025, 6)


def whip_antenna(part, base, h=2.5, r=0.012, skin='black', base_r=0.04):
    base = vec(base)
    part.cyl('dark', base, base + Vector((0, 0.12, 0)), base_r, base_r * 0.8, 8)
    part.cyl('black', base + Vector((0, 0.12, 0)), base + Vector((0, 0.2, 0)), base_r * 0.55, base_r * 0.55, 8)
    part.cyl(skin, base + Vector((0, 0.2, 0)), base + Vector((0, h, 0)), r, r * 0.4, 5, cap0=False)


def louvres(part, x, y0, y1, z0, z1, n, side=1, skin='paint', depth=0.04):
    """a louvred air intake on a side face at plane x (side = ±1 the face's outward x): dark recess + slats"""
    part.panel('black', [(x, y0, z0), (x, y0, z1), (x, y1, z1), (x, y1, z0)], (side, 0, 0), off=0.002)
    for i in range(n):
        y = lerp(y0, y1, (i + 0.5) / n)
        h = (y1 - y0) / n * 0.8
        part.face([(x + side * 0.004, y + h * 0.5, z0), (x + side * 0.004, y + h * 0.5, z1),
                   (x + side * depth, y - h * 0.5, z1), (x + side * depth, y - h * 0.5, z0)], skin, want=(side, 1, 0))


def truss(part, pts_a, pts_b, skin='paint', w=0.05, diag=True):
    """two chords (point lists) joined by verticals and alternating diagonals"""
    for i in range(len(pts_a) - 1):
        part.beam(skin, pts_a[i], pts_a[i + 1], w, w)
        part.beam(skin, pts_b[i], pts_b[i + 1], w, w)
    for i in range(len(pts_a)):
        part.beam(skin, pts_a[i], pts_b[i], w * 0.8, w * 0.8)
        if diag and i < len(pts_a) - 1:
            if i % 2 == 0:
                part.beam(skin, pts_a[i], pts_b[i + 1], w * 0.7, w * 0.7)
            else:
                part.beam(skin, pts_b[i], pts_a[i + 1], w * 0.7, w * 0.7)


def belt_path(circles, n_arc=6):
    """a closed belt around circles given in loop order in the side (z, y) plane, belt on the OUTSIDE of every circle.
    circles: [(z, y, r)], traversed so that the bottom (ground) run goes towards −z (forwards), i.e. clockwise when
    seen from the left with z to the right. Returns a closed list of (z, y) points and their cumulative length."""
    m = len(circles)
    # In the (z, y) plane (z right, y up) the loop runs clockwise: rear-bottom → front-bottom (towards −z) → up
    # round the front → back along the top → down round the rear. The belt's outside is then to the LEFT of the
    # direction of travel. The arrangement must be convex (road wheels level, rollers not below the top run).
    def tangent(c1, c2):
        (x1, y1, r1), (x2, y2, r2) = c1, c2
        dx, dy = x2 - x1, y2 - y1
        D = math.hypot(dx, dy)
        ang = math.atan2(dy, dx)
        a = math.acos(clamp((r1 - r2) / D, -1, 1))
        nang = ang + a          # outer normal of the tangent (left of travel): n·(c2 − c1) = r1 − r2
        n = (math.cos(nang), math.sin(nang))
        return (x1 + n[0] * r1, y1 + n[1] * r1), (x2 + n[0] * r2, y2 + n[1] * r2), nang
    tans = [tangent(circles[i], circles[(i + 1) % m]) for i in range(m)]
    pts = []
    for i in range(m):
        # arc on circle i from the incoming tangent's end to the outgoing tangent's start
        (cx, cy, r) = circles[i]
        a_in = tans[i - 1][2]
        a_out = tans[i][2]
        # clockwise (decreasing angle) from a_in to a_out
        da = (a_in - a_out) % (2 * math.pi)
        k = max(1, int(round(n_arc * da / math.pi)))
        for s in range(k + 1):
            ang = a_in - da * s / k
            pts.append((cx + r * math.cos(ang), cy + r * math.sin(ang)))
    # drop near-duplicates
    out = [pts[0]]
    for p in pts[1:]:
        if math.hypot(p[0] - out[-1][0], p[1] - out[-1][1]) > 1e-4:
            out.append(p)
    if math.hypot(out[0][0] - out[-1][0], out[0][1] - out[-1][1]) < 1e-4:
        out.pop()
    return out


def track_run(veh, side, x, width, circles, thick=0.07, tile=0.68, name=None, parent=None, skin_edge='track_pad', guide=True):
    """a track loop as its own node (name track_l / track_r): an outer surface in the Track material (u = distance
    along the loop / tile, so the game scrolls it: vehicles.js roll()), an inner surface and edges.
    circles: [(z, y, r)] sprocket / road wheels / idler / return rollers in loop order (see belt_path);
    the loop is laid `thick` outside them. side = -1 left, +1 right; x = the track's centre line."""
    name = name or ('track_l' if side < 0 else 'track_r')
    p = Part(veh, name, pivot=(x, 0, 0), parent=parent)
    outer = belt_path([(z, y, r + thick) for (z, y, r) in circles])
    inner = belt_path([(z, y, r + 0.004) for (z, y, r) in circles])
    # resample the inner loop to the outer loop's count by nearest parameter (keep it simple: equal counts)
    def resample(loop, n):
        L = [0.0]
        for i in range(1, len(loop) + 1):
            a, b = loop[i - 1], loop[i % len(loop)]
            L.append(L[-1] + math.hypot(b[0] - a[0], b[1] - a[1]))
        tot = L[-1]
        res = []
        j = 0
        for k in range(n):
            s = tot * k / n
            while L[j + 1] < s:
                j += 1
            a, b = loop[j], loop[(j + 1) % len(loop)]
            t = (s - L[j]) / max(1e-9, L[j + 1] - L[j])
            res.append((lerp(a[0], b[0], t), lerp(a[1], b[1], t)))
        return res, tot
    n = max(48, len(outer))
    O, Lo = resample(outer, n)
    I, Li = resample(inner, n)
    x0, x1 = x - width / 2, x + width / 2
    u = 0.0
    us = [0.0]
    for k in range(1, n + 1):
        a, b = O[k - 1], O[k % n]
        us.append(us[-1] + math.hypot(b[0] - a[0], b[1] - a[1]) / tile)
    # make the loop hold a whole number of tiles, so the seam doesn't jump
    scale = round(us[-1]) / us[-1] if us[-1] > 1 else 1
    us = [q * scale for q in us]
    cz = sum(q[0] for q in O) / n
    cy = sum(q[1] for q in O) / n
    for k in range(n):
        a, b = O[k], O[(k + 1) % n]
        ia, ib = I[k], I[(k + 1) % n]
        mz, my = (a[0] + b[0]) / 2 - cz, (a[1] + b[1]) / 2 - cy
        # outer face (Track), u along the loop, v across
        p.face([(x0, a[1], a[0]), (x1, a[1], a[0]), (x1, b[1], b[0]), (x0, b[1], b[0])], 'track',
               uvs=[(us[k], 0.0), (us[k], 1.0), (us[k + 1], 1.0), (us[k + 1], 0.0)], want=(0, my, mz))
        # inner face (the running surface the wheels ride on): dark steel
        p.face([(x0, ia[1], ia[0]), (x0, ib[1], ib[0]), (x1, ib[1], ib[0]), (x1, ia[1], ia[0])], skin_edge, want=(0, -my, -mz))
        # edges
        for (xe, s) in ((x0, -1), (x1, 1)):
            p.face([(xe, a[1], a[0]), (xe, b[1], b[0]), (xe, ib[1], ib[0]), (xe, ia[1], ia[0])], skin_edge, want=(s, 0, 0))
    if guide:
        # centre guide horns on the inside of the run are part of the texture; add a thin centre ridge on the inner face
        pass
    veh.meta['tracks'].append({'node': name, 'side': side, 'tile': round(tile / scale, 5)})
    return p


def joint_point(part, p, value):
    """where world point p (attached to `part`) goes when part's joint (and its ancestors' — not handled) is at value"""
    j = part.joint
    p = vec(p)
    if not j:
        return p
    ax = Vector(j['axis'])
    if j['type'] == 'slide':
        return p + ax * value
    q = Quaternion(ax, value)
    return part.pivot + q @ (p - part.pivot)


def ram(veh, name, parent, base, end_part, end, r=0.07, skin='paint', rod='chrome', end_name=None, stages=None, overlap=0.22):
    """a telescopic hydraulic ram from `base` (on `parent`) to `end` (on `end_part`, usually a jointed part).
    Nodes: <name> (the cylinder, pivot = base, pointing at end), <name>_s1.. (nested rod stages sliding out along the ram
    axis), anchor empty <name>_end on end_part. vehicles.js re-aims and stretches it after every pose.
    The stroke is found by sweeping end_part's joint over its range; stages are sized so they stay overlapped."""
    base, end = vec(base), vec(end)
    d = end - base
    L = d.length
    u = d.normalized()
    Lmax, Lmin = L, L
    if end_part.joint:
        j = end_part.joint
        for i in range(21):
            val = lerp(j['min'], j['max'], i / 20)
            ln = (joint_point(end_part, end, val) - base).length
            Lmax, Lmin = max(Lmax, ln), min(Lmin, ln)
    E = Lmax - L                                    # extension beyond the rest length
    C = L - 0.16                                    # cylinder length (the eye end sticks out 0.16 at rest)
    n = stages or max(1, math.ceil(E / max(0.2, C - overlap)))
    cylp = Part(veh, name, pivot=base, parent=parent)
    cylp.cyl(skin, base - u * 0.07, base + u * C, r, r, 12)
    cylp.cyl(skin, base + u * (C - 0.06), base + u * C, r * 1.14, r * 1.14, 12)   # gland collar
    a, b = frame_from_axis(u)
    cylp.cyl('dark', base - a * r * 1.35, base + a * r * 1.35, r * 0.5, r * 0.5, 8)   # trunnion pin
    names = []
    rr = r * 0.78
    prev_end = C
    for s in range(n):
        sp = Part(veh, '%s_s%d' % (name, s + 1), pivot=base, parent=cylp)
        last = s == n - 1
        t1 = L if last else C + 0.03 * (s + 1)
        t0 = max(0.02, prev_end - E / n - overlap)
        sp.cyl(rod if last else skin, base + u * t0, base + u * t1, rr, rr, 10, smooth=True)
        if not last:
            sp.cyl(skin, base + u * (t1 - 0.05), base + u * t1, rr * 1.1, rr * 1.1, 10)
        else:
            sp.cyl('dark', base + u * (L - 0.03) - a * rr * 1.6, base + u * (L - 0.03) + a * rr * 1.6, rr * 0.6, rr * 0.6, 8)
        prev_end = t1
        rr *= 0.8
        names.append(sp.name)
    en = end_name or (name + '_end')
    end_part.empty(en, end, (0, 0, -1))
    veh.meta['rams'].append({'node': name, 'end': en, 'stages': names, 'len': round(L, 4), 'stroke': round(E, 4)})
    return cylp
