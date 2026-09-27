# ═══════════════════════════════════════════════════════════════
# Build (and optionally preview-render) scripted vehicles:
#   blender -b -P tools/vehicles/build.py -- scud [osa …]            → models/vehicles/<id>.glb
#   blender -b -P tools/vehicles/build.py -- scud --render DIR [--pose 0,1] [--views front34,side,rear34,top]
#   blender -b -P tools/vehicles/build.py -- scud --no-export --render DIR
# Each vehicle is tools/vehicles/<id>.py with make() → vkit.Vehicle (built, not yet exported).
# --render poses every joint at k (0 = stowed, 1 = deployed; ram cylinders re-aimed like src/vehicles.js does) and
# renders EEVEE stills <DIR>/<id>_k<k>_<view>.png — a quick look while modelling; the real preview sheets are made
# in the browser with the game's renderer (tools/vehicles/preview.html).
# ═══════════════════════════════════════════════════════════════
import bpy, sys, os, math, json, importlib
sys.dont_write_bytecode = True   # no __pycache__ next to the scripts
from mathutils import Vector, Quaternion, Matrix

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import vkit

argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []


def opt(name, default=None):
    return argv[argv.index(name) + 1] if name in argv else default


flags = {a for a in argv if a.startswith('--')}
ids = []
skip = False
for a in argv:
    if skip:
        skip = False
        continue
    if a in ('--render', '--pose', '--views', '--size', '--out', '--scheme', '--cam'):
        skip = True
        continue
    if not a.startswith('--'):
        ids.append(a)


def reset():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    vkit.MATS.clear()


def joints(root):
    out = []
    for o in [root] + list(root.children_recursive):
        if 'joint' in o.keys():
            out.append((o, json.loads(o['joint'])))
    return out


def prepare(root):
    """remember rest transforms (call in the rest pose, before the first pose())"""
    if 'prepared' in root.keys():
        return
    bpy.context.view_layer.update()
    for o in [root] + list(root.children_recursive):
        o['rest_loc'] = list(o.location)
        o['rest_rot'] = list(o.rotation_quaternion) if o.rotation_mode == 'QUATERNION' else list(o.rotation_euler.to_quaternion())
    for r in json.loads(root['vk']).get('rams', []):
        cyl, end = bpy.data.objects[r['node']], bpy.data.objects[r['end']]
        pm = cyl.parent.matrix_world.to_3x3().inverted()
        cyl['rest_axis'] = list((pm @ (end.matrix_world.translation - cyl.matrix_world.translation)).normalized())
    root['prepared'] = 1


def pose(root, k, groups=None):
    """set every joint (or those in `groups`) to lerp(stow, deploy, k); then re-aim and stretch the rams"""
    prepare(root)
    for o, j in joints(root):
        if groups and j.get('group') not in groups:
            continue
        val = j['stow'] + (j['deploy'] - j['stow']) * k
        ax = vkit.V(j['axis'])   # parent frame (game) → Blender
        o.rotation_mode = 'QUATERNION'
        rq = Quaternion(o['rest_rot'])
        if j['type'] == 'rot':
            o.rotation_quaternion = Quaternion(ax, val) @ rq
            o.location = Vector(o['rest_loc'])
        else:
            o.rotation_quaternion = rq
            o.location = Vector(o['rest_loc']) + ax * val
    bpy.context.view_layer.update()
    for r in json.loads(root['vk']).get('rams', []):
        cyl, end = bpy.data.objects[r['node']], bpy.data.objects[r['end']]
        cyl.rotation_mode = 'QUATERNION'
        cyl.rotation_quaternion = Quaternion(cyl['rest_rot'])
        bpy.context.view_layer.update()
        pm = cyl.parent.matrix_world.to_3x3().inverted()
        d_w = end.matrix_world.translation - cyl.matrix_world.translation
        ln = d_w.length
        rest_dir = Vector(cyl['rest_axis'])
        q = rest_dir.rotation_difference((pm @ d_w).normalized())
        cyl.rotation_quaternion = q @ Quaternion(cyl['rest_rot'])
        n = len(r['stages'])
        for i, sname in enumerate(r['stages']):
            st = bpy.data.objects[sname]
            st.location = Vector(st['rest_loc']) + rest_dir * ((ln - r['len']) * (i + 1) / n)
    bpy.context.view_layer.update()


VIEWS = {
    'front34': (Vector((1.0, 1.25, 0.55)), True),
    'rear34': (Vector((-1.0, -1.2, 0.62)), True),
    'rear34r': (Vector((1.0, -1.2, 0.62)), True),
    'front34l': (Vector((-1.0, 1.25, 0.55)), True),
    'side': (Vector((-1, 0, 0)), False),
    'sider': (Vector((1, 0, 0)), False),
    'top': (Vector((0, 0, 1)), False),
    'front': (Vector((0, 1, 0)), False),
    'rear': (Vector((0, -1, 0)), False),
    'low': (Vector((0.9, 1.1, 0.12)), True),
    'high': (Vector((0.7, 0.9, 1.3)), True),
}


def render(root, prefix, views, size=(900, 560), cam=None):
    sc = bpy.context.scene
    sc.render.engine = 'BLENDER_EEVEE'
    sc.render.resolution_x, sc.render.resolution_y = size
    sc.view_settings.view_transform = 'AgX'
    if not sc.world:
        w = bpy.data.worlds.new('w')
        sc.world = w
        w.use_nodes = True
        bg = w.node_tree.nodes['Background']
        bg.inputs['Color'].default_value = (0.55, 0.62, 0.72, 1)
        bg.inputs['Strength'].default_value = 0.8
        sun = bpy.data.lights.new('sun', 'SUN')
        sun.energy = 3.5
        sun.angle = 0.03
        so = bpy.data.objects.new('sun', sun)
        sc.collection.objects.link(so)
        so.rotation_euler = (math.radians(38), math.radians(-20), math.radians(40))
        bpy.ops.mesh.primitive_plane_add(size=400, location=(0, 0, 0))
        gp = bpy.context.active_object
        gp.name = '_ground'
        gm = bpy.data.materials.new('ground')
        gm.use_nodes = True
        gm.node_tree.nodes['Principled BSDF'].inputs['Base Color'].default_value = (0.26, 0.25, 0.21, 1)
        gm.node_tree.nodes['Principled BSDF'].inputs['Roughness'].default_value = 0.95
        gp.data.materials.append(gm)
    bpy.context.view_layer.update()
    mn = Vector((1e9, 1e9, 1e9)); mx = -mn
    for o in root.children_recursive:
        if o.type == 'MESH':
            for v in o.bound_box:
                w = o.matrix_world @ Vector(v)
                mn = Vector(map(min, mn, w)); mx = Vector(map(max, mx, w))
    c = (mn + mx) / 2
    size3 = mx - mn
    rad = size3.length / 2
    cd = bpy.data.cameras.get('cam') or bpy.data.cameras.new('cam')
    co = bpy.data.objects.get('cam')
    if not co:
        co = bpy.data.objects.new('cam', cd)
        sc.collection.objects.link(co)
    sc.camera = co
    W, H = size
    outs = []
    for v in views:
        if v.startswith('at:'):
            # at:x,y,z:dx,dy,dz:dist  (game frame)
            _, p, d, dist = v.split(':')
            tgt = vkit.V([float(t) for t in p.split(',')])
            dd = vkit.V([float(t) for t in d.split(',')]).normalized()
            cd.type = 'PERSP'
            cd.angle = math.radians(40)
            co.location = tgt + dd * float(dist)
            co.rotation_euler = (tgt - co.location).to_track_quat('-Z', 'Y').to_euler()
            cd.clip_start = 0.05
            cd.clip_end = 500
            name = 'at%d' % len(outs)
        else:
            d, persp = VIEWS[v]
            d = d.normalized()
            if persp:
                cd.type = 'PERSP'
                cd.angle = math.radians(30)
                dist = rad / math.sin(math.radians(15)) * 0.95
                co.location = c + d * dist
            else:
                cd.type = 'ORTHO'
                if v in ('side', 'sider'):
                    hw, hh = size3.y / 2, size3.z / 2
                elif v == 'top':
                    hw, hh = size3.x / 2, size3.y / 2
                else:
                    hw, hh = size3.x / 2, size3.z / 2
                cd.ortho_scale = max(hw * 2, hh * 2 * W / H) * 1.08
                co.location = c + d * rad * 4
            cd.clip_start = 0.05
            cd.clip_end = rad * 30
            co.rotation_euler = (c - co.location).to_track_quat('-Z', 'Y').to_euler()
            name = v
        sc.render.filepath = '%s_%s.png' % (prefix, name)
        bpy.ops.render.render(write_still=True)
        outs.append(sc.render.filepath)
    return outs


def main():
    out_dir = opt('--out', os.path.join(vkit.REPO, 'models', 'vehicles'))
    rdir = opt('--render')
    poses = [float(k) for k in opt('--pose', '0').split(',')]
    vs = opt('--views', 'front34,side,rear34')
    views = vs.split(';') if ';' in vs else vs.split(',')
    size = tuple(int(s) for s in opt('--size', '900x560').split('x'))
    for vid in ids:
        reset()
        mod = importlib.import_module(vid)
        importlib.reload(mod)
        veh = mod.make()
        root = veh.build(out=None if '--no-export' in flags else os.path.join(out_dir, vid + '.glb'))
        if rdir:
            os.makedirs(rdir, exist_ok=True)
            for k in poses:
                pose(root, k)
                render(root, os.path.join(rdir, '%s_k%s' % (vid, ('%g' % k).replace('.', 'p'))), views, size)


main()
