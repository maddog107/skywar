# ═══════════════════════════════════════════════════════════════
# Interior kit (runs inside Blender) for the rooms of src/interiors.js — see tools/interiors/ROOMS.md.
# Geometry is written in the GAME frame (x right, y up, the room's "forward" −z) and converted by shipkit.V.
# A room GLB has:
#   • static geometry merged per material (shell, consoles, furniture, pipes…), UVs in metres (JS tiles the
#     shared textures of models/interiors/tex by material name: src/warrooms.js ROOM_MATERIALS)
#   • interactive nodes with extras "ctl" (JSON): btn_* / sw_* / guard_* / knob_* / lever_* / lamp_* / exit_* /
#     door_* (meshes, origin on the pivot, local +Z = out of the panel), screen_* (a quad with 0..1 UVs, the canvas
#     is drawn by JS), stand_* (empties: a console's camera, looking −Z), spawn (where you stand on entering)
#   • labels: lbl_<n> quads with extras {"lbl": text, "st": style} — JS draws them into one atlas and merges them
#   • the root's extras "room": { walk: [[x0, x1, z0, z1, floor y], …], eye, lights: [...], bg }
# ═══════════════════════════════════════════════════════════════
import bpy, math, os, sys, json
from mathutils import Vector, Quaternion, Matrix
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, '..', 'ships'))
from shipkit import Part, material, srgb, V, lerp, clamp, smoothstep, MATS

PI = math.pi
ROOT = None
STATIC = None
LABELS = []
NODES = []

# ── materials (names are what the game keys its textures and looks on: keep them) ──
def begin():
    global ROOT, STATIC, LABELS, NODES
    bpy.ops.wm.read_factory_settings(use_empty=True)
    MATS.clear()
    LABELS = []; NODES = []
    for name, col, metal, rough in [
        ('Deck', 0x4a4d50, 0.2, 0.75), ('DeckTile', 0x6b6e70, 0.0, 0.8), ('Carpet', 0x3a4048, 0.0, 0.95),
        ('Wall', 0xb9bcb8, 0.05, 0.6), ('WallDark', 0x3b4046, 0.1, 0.6), ('Ceiling', 0xc8cac6, 0.0, 0.8),
        ('Console', 0x2b3036, 0.2, 0.55), ('ConsoleLight', 0x8c9196, 0.2, 0.5), ('ConsoleBlue', 0x2e3a48, 0.2, 0.5),
        ('Panel', 0x23272c, 0.2, 0.6), ('Bezel', 0x121416, 0.3, 0.45), ('Metal', 0x9aa0a6, 0.8, 0.35),
        ('Steel', 0x5c6268, 0.6, 0.45), ('Black', 0x0c0d0e, 0.1, 0.7), ('Rubber', 0x151617, 0.0, 0.9),
        ('Seat', 0x23272b, 0.0, 0.85), ('SeatBlue', 0x1e2a3a, 0.0, 0.85), ('Leather', 0x2a2420, 0.0, 0.6),
        ('PipeWhite', 0xd8d8d0, 0.1, 0.5), ('PipeBlue', 0x2f5d8a, 0.1, 0.5), ('PipeRed', 0x9a2a22, 0.1, 0.5),
        ('PipeGreen', 0x3f6a3a, 0.1, 0.5), ('PipeYellow', 0xc9a227, 0.1, 0.5), ('Cable', 0x1c1e20, 0.0, 0.7),
        ('Red', 0xb3261e, 0.1, 0.45), ('Yellow', 0xd8b42a, 0.1, 0.5), ('Green', 0x2f7a3c, 0.1, 0.5), ('Blue', 0x2a5caa, 0.1, 0.5),
        ('Orange', 0xd8641c, 0.1, 0.5), ('White', 0xe4e4dc, 0.0, 0.55), ('Wood', 0x6a4a30, 0.0, 0.6),
        ('Concrete', 0x8e8b84, 0.0, 0.92), ('Glass', 0x9fb6c4, 0.3, 0.05), ('Screen', 0x05080a, 0.0, 0.3),
        ('Chrome', 0xc8ccd0, 1.0, 0.15), ('Brass', 0xb08d4a, 0.9, 0.35), ('Canvas', 0x7a7458, 0.0, 0.9),
    ]:
        material(name, srgb(col), metal, rough)
    for name, col, s in [('Light', 0xfff4e6, 6.0), ('LightBlue', 0x9ecbff, 4.0), ('LightRed', 0xff3a2a, 4.0), ('LampRed', 0xff2a1a, 0.4),
                         ('LampGreen', 0x2aff5a, 0.4), ('LampAmber', 0xffb020, 0.4), ('LampWhite', 0xfff8e8, 0.4), ('LampBlue', 0x40a0ff, 0.4)]:
        material(name, srgb(col), 0.0, 0.4, emit=srgb(col), emit_strength=s)
    # (the game makes 'Glass' see-through by name: src/warrooms.js)
    ROOT = bpy.data.objects.new('room', None)
    bpy.context.collection.objects.link(ROOT)
    STATIC = {}
    return ROOT

def static(key='static'):
    """a Part for static geometry (merged per material on export)"""
    if key not in STATIC:
        STATIC[key] = Part(key)
    return STATIC[key]

# ── rotations in the game frame ──
def qrot(yaw=0.0, tilt=0.0, roll=0.0):
    """rotation: tilt back about x (a panel facing +z leans back so it faces up-and-out), then roll about z, then yaw"""
    q = Quaternion(V((1, 0, 0)).normalized(), -tilt)
    q = Quaternion(V((0, 0, 1)).normalized(), roll) @ q
    q = Quaternion(V((0, 1, 0)).normalized(), yaw) @ q
    return q

def mat3(yaw=0.0, tilt=0.0, roll=0.0):
    """the same rotation as a 3×3 acting on game-frame vectors"""
    def rx(a): return Matrix(((1, 0, 0), (0, math.cos(a), -math.sin(a)), (0, math.sin(a), math.cos(a))))
    def ry(a): return Matrix(((math.cos(a), 0, math.sin(a)), (0, 1, 0), (-math.sin(a), 0, math.cos(a))))
    def rz(a): return Matrix(((math.cos(a), -math.sin(a), 0), (math.sin(a), math.cos(a), 0), (0, 0, 1)))
    return ry(yaw) @ rz(roll) @ rx(-tilt)

def xf(M, o, p):
    """a local point p through rotation M, then offset o (game frame tuples)"""
    v = M @ Vector(p)
    return (o[0] + v.x, o[1] + v.y, o[2] + v.z)

# ── nodes ──
def node(name, part, loc, yaw=0.0, tilt=0.0, roll=0.0, ctl=None, parent=None):
    """an object with mesh from `part` (modelled at the origin in its own frame), placed at loc with the rotation"""
    data = part.mesh() if part is not None else None
    ob = bpy.data.objects.new(name, data)
    bpy.context.collection.objects.link(ob)
    ob.location = V(loc)
    ob.rotation_mode = 'QUATERNION'
    ob.rotation_quaternion = qrot(yaw, tilt, roll)
    ob.parent = parent or ROOT
    if ctl is not None:
        ob['ctl'] = json.dumps(ctl, separators=(',', ':'))
    if data is None:
        ob.empty_display_size = 0.15
    NODES.append(name)
    return ob

def station(name, eye, yaw=0.0, pitch=0.0, fov=55):
    """a console's camera: at `eye` looking along −z turned by yaw (left +) and pitch (down −)"""
    ob = bpy.data.objects.new(name, None)
    bpy.context.collection.objects.link(ob)
    ob.location = V(eye)
    ob.rotation_mode = 'QUATERNION'
    q = Quaternion(V((0, 1, 0)).normalized(), yaw) @ Quaternion(V((1, 0, 0)).normalized(), pitch)
    ob.rotation_quaternion = q
    ob.parent = ROOT
    ob['ctl'] = json.dumps({'t': 'station', 'fov': fov})
    return ob

def spawn(pos, yaw=0.0):
    ob = bpy.data.objects.new('spawn', None)
    bpy.context.collection.objects.link(ob)
    ob.location = V(pos)
    ob.rotation_mode = 'QUATERNION'
    ob.rotation_quaternion = Quaternion(V((0, 1, 0)).normalized(), yaw)
    ob.parent = ROOT
    ob['ctl'] = json.dumps({'t': 'spawn'})
    return ob

def label(text, pos, yaw=0.0, tilt=0.0, h=0.03, w=None, st='w', roll=0.0):
    """a text placard (drawn by the game into one atlas): st 'w' white on dark, 'b' black on light, 'y' yellow
    stripe, 'r' red warning, 'g' green, 'e' engraved (light grey on panel), 'big' white sign lettering"""
    w = w or max(h * 0.62 * len(text) + h * 0.5, h * 2)
    P = Part('lbl')
    P.g('Label').face([(-w / 2, -h / 2, 0), (w / 2, -h / 2, 0), (w / 2, h / 2, 0), (-w / 2, h / 2, 0)], [(0, 0), (1, 0), (1, 1), (0, 1)], (0, 0, 1))
    if 'Label' not in MATS:
        material('Label', srgb(0xffffff), 0.0, 0.6)
    n = 'lbl_%d' % len(LABELS)
    ob = node(n, P, pos, yaw, tilt, roll)
    ob['lbl'] = text
    ob['st'] = st
    LABELS.append(text)
    return ob

# ── interactive parts (each modelled facing +z, at the origin) ──
def button(name, pos, yaw=0.0, tilt=0.0, r=0.016, mat='Red', square=False, lamp=None, travel=0.005):
    P = Part(name)
    if square:
        P.box('Bezel', -r * 1.35, r * 1.35, -r * 1.35, r * 1.35, -0.006, 0.0)
        P.box(mat, -r, r, -r, r, 0.0, 0.012)
    else:
        P.cyl('Bezel', (0, 0, 0), r * 1.35, r * 1.35, -0.006, 0.002, 16, axis='z')
        P.cyl(mat, (0, 0, 0), r, r * 0.92, 0.002, 0.014, 16, axis='z')
    ctl = {'t': 'button', 'slide': [0, 0, -1], 'travel': travel}
    if lamp:
        ctl['lamp'] = True; ctl['color'] = lamp
    return node(name, P, pos, yaw, tilt, ctl=ctl)

def toggle(name, pos, yaw=0.0, tilt=0.0, mat='Metal', throw=0.9):
    """a bat-handle toggle switch; k 0 = down, 1 = up"""
    P = Part(name)
    P.cyl('Chrome', (0, 0, 0), 0.006, 0.004, 0.0, 0.028, 10, axis='z')
    P.sphere(mat, (0, 0, 0.03), 0.006, 0.006, 0.006, 8, 6)
    # the lever is modelled pointing out; the node tilts it down (k 0) … up (k 1)
    return node(name, P, pos, yaw, tilt, ctl={'t': 'switch', 'hinge': [1, 0, 0], 'open': -throw}, roll=0.0)

def base_plate(part, w, h, mat='Bezel'):
    part.box(mat, -w / 2, w / 2, -h / 2, h / 2, -0.004, 0.0)

def guard(name, pos, yaw=0.0, tilt=0.0, w=0.07, h=0.07, d=0.05, for_=None, mat='Red'):
    """a flip-up cover, hinged along its top edge (it opens up and away from the panel)"""
    P = Part(name)
    # a box open at the back, modelled with the hinge on the origin (its top edge), hanging down over the control
    P.box(mat, -w / 2, w / 2, -h, 0.0, d - 0.004, d)            # front
    P.box(mat, -w / 2, -w / 2 + 0.004, -h, 0.0, 0.0, d)         # sides
    P.box(mat, w / 2 - 0.004, w / 2, -h, 0.0, 0.0, d)
    P.box(mat, -w / 2, w / 2, -h, -h + 0.004, 0.0, d)           # bottom
    P.box(mat, -w / 2, w / 2, -0.004, 0.0, 0.0, d)              # top
    P.box('Yellow', -w / 2 + 0.006, w / 2 - 0.006, -h * 0.62, -h * 0.38, d, d + 0.001)
    ctl = {'t': 'guard', 'hinge': [1, 0, 0], 'open': -1.95}
    if for_:
        ctl['for'] = for_
    return node(name, P, pos, yaw, tilt, ctl=ctl)

def knob(name, pos, yaw=0.0, tilt=0.0, r=0.022, steps=6, arc=4.2, mat='Black'):
    """a rotary selector with a pointer; k 0 … 1 turns it clockwise through `arc`"""
    P = Part(name)
    P.cyl(mat, (0, 0, 0), r, r * 0.9, 0.0, 0.02, 18, axis='z')
    P.box('White', -0.002, 0.002, r * 0.2, r * 0.95, 0.02, 0.0215)
    P.box(mat, -r * 0.25, r * 0.25, -r * 0.95, r * 0.95, 0.02, 0.03)   # the grip bar
    return node(name, P, pos, yaw, tilt, ctl={'t': 'knob', 'hinge': [0, 0, 1], 'open': -arc, 'steps': steps})

def lever(name, pos, yaw=0.0, tilt=0.0, length=0.16, steps=7, arc=1.2, mat='Black', knob_mat='Red'):
    """a throttle-style lever pivoting about its base (local x): k 0 back … 1 forward through `arc`"""
    P = Part(name)
    P.box('Metal', -0.008, 0.008, -0.008, 0.008, 0.0, length)
    P.sphere(knob_mat, (0, 0, length), 0.022, 0.022, 0.022, 12, 8)
    # (leaning back by arc/2 at k 0, upright at k 0.5, forward at k 1)
    return node(name, P, pos, yaw, tilt + arc / 2, ctl={'t': 'lever', 'hinge': [1, 0, 0], 'open': arc, 'steps': steps})

def lamp(name, pos, yaw=0.0, tilt=0.0, r=0.012, color='#ff3a20', mat='LampRed', square=False):
    P = Part(name)
    if square:
        P.box('Bezel', -r * 1.5, r * 1.5, -r, r, -0.004, 0.0)
        P.box(mat, -r * 1.3, r * 1.3, -r * 0.8, r * 0.8, 0.0, 0.006)
    else:
        P.cyl('Bezel', (0, 0, 0), r * 1.4, r * 1.4, -0.004, 0.002, 12, axis='z')
        P.sphere(mat, (0, 0, 0.002), r, r, r * 0.7, 12, 6, v0=0.5, v1=1.0)
    return node(name, P, pos, yaw, tilt, ctl={'t': 'lamp', 'color': color})

def keyswitch(name, pos, yaw=0.0, tilt=0.0):
    """a key in its lock (a switch: k 1 = turned)"""
    P = Part(name)
    P.cyl('Chrome', (0, 0, 0), 0.012, 0.012, 0.0, 0.006, 14, axis='z')
    P.box('Brass', -0.003, 0.003, -0.009, 0.009, 0.006, 0.03)
    P.box('Brass', -0.009, 0.009, -0.004, 0.004, 0.03, 0.036)
    return node(name, P, pos, yaw, tilt, ctl={'t': 'switch', 'hinge': [0, 0, 1], 'open': -1.4})

def screen(name, center, yaw=0.0, tilt=0.0, w=0.5, h=0.32, px=None, bright=None):
    """a live screen: a quad (u right, v up: the canvas top is at the top) the game draws on"""
    P = Part(name)
    P.g('Screen').face([(-w / 2, -h / 2, 0), (w / 2, -h / 2, 0), (w / 2, h / 2, 0), (-w / 2, h / 2, 0)], [(0, 0), (1, 0), (1, 1), (0, 1)], (0, 0, 1))
    if px is None:
        s = 1024 / max(w, h * 1.6)
        px = (int(min(1024, round(w * s / 64) * 64)), int(min(1024, round(h * s / 64) * 64)))
    ctl = {'t': 'screen', 'w': px[0], 'h': px[1]}
    if bright:
        ctl['bright'] = bright
    return node(name, P, center, yaw, tilt, ctl=ctl)

def exit_node(name, pos, yaw=0.0, w=0.9, h=2.0, kind='door', label_text=None):
    """a door / hatch / ladder you leave by (clickable, and E near it); kind 'door' | 'ladder' | 'hatch'"""
    P = Part(name)
    if kind == 'door':
        # a watertight door: rounded-corner leaf, dogs (clamp handles) round the rim, a wheel
        P.box('WallDark', -w / 2, w / 2, 0.0, h, 0.0, 0.05)
        P.box('Steel', -w / 2 - 0.06, w / 2 + 0.06, -0.02, h + 0.06, -0.04, 0.0)
        for (dx, dy) in [(-w / 2 + 0.05, 0.4), (-w / 2 + 0.05, h - 0.4), (w / 2 - 0.05, 0.4), (w / 2 - 0.05, h - 0.4), (0, h - 0.06), (0, 0.06)]:
            P.box('Metal', dx - 0.03, dx + 0.03, dy - 0.05, dy + 0.05, 0.05, 0.09)
        P.cyl('Metal', (w * 0.25, h * 0.52, 0), 0.12, 0.12, 0.08, 0.1, 16, axis='z')
        P.cyl('Metal', (w * 0.25, h * 0.52, 0), 0.02, 0.02, 0.05, 0.1, 8, axis='z')
    elif kind == 'ladder':
        for sx in (-w / 2, w / 2):
            P.box('Metal', sx - 0.025, sx + 0.025, 0.0, h, -0.025, 0.025)
        y = 0.25
        while y < h:
            P.cyl('Metal', (0, y, 0), 0.016, 0.016, -w / 2, w / 2, 8, axis='x')
            y += 0.3
    else:  # hatch in the ceiling with a ladder up to it
        P.cyl('Steel', (0, h, 0), w / 2 + 0.08, w / 2 + 0.08, h - 0.05, h, 20)
        P.cyl('WallDark', (0, h, 0), w / 2, w / 2, h - 0.12, h - 0.04, 20)
        for sx in (-0.22, 0.22):
            P.box('Metal', sx - 0.02, sx + 0.02, 0.0, h - 0.1, -0.02, 0.02)
        y = 0.28
        while y < h - 0.2:
            P.cyl('Metal', (0, y, 0), 0.015, 0.015, -0.22, 0.22, 8, axis='x')
            y += 0.28
    ob = node(name, P, pos, yaw, 0.0, ctl={'t': 'exit'})
    if label_text:
        M = mat3(yaw)
        label(label_text, xf(M, pos, (0, h + 0.18, 0.06)), yaw, 0.0, h=0.07, st='y')
    return ob

# ── furniture and fittings (static) ──
def shell(S, x0, x1, z0, z1, h, floor='Deck', wall='Wall', ceil='Ceiling', y0=0.0, skip=()):
    """a box room seen from inside (faces point in)"""
    uv_f = lambda x, y, z: (x, z)
    if 'floor' not in skip:
        S.g(floor).face([(x0, y0, z0), (x0, y0, z1), (x1, y0, z1), (x1, y0, z0)], [uv_f(x0, 0, z0), uv_f(x0, 0, z1), uv_f(x1, 0, z1), uv_f(x1, 0, z0)], (0, 1, 0))
    if 'ceil' not in skip:
        S.g(ceil).face([(x0, y0 + h, z0), (x1, y0 + h, z0), (x1, y0 + h, z1), (x0, y0 + h, z1)], [(x0, z0), (x1, z0), (x1, z1), (x0, z1)], (0, -1, 0))
    walls = {
        'nz': ([(x0, y0, z0), (x1, y0, z0), (x1, y0 + h, z0), (x0, y0 + h, z0)], (0, 0, 1), lambda x, y, z: (x, y)),
        'pz': ([(x0, y0, z1), (x0, y0 + h, z1), (x1, y0 + h, z1), (x1, y0, z1)], (0, 0, -1), lambda x, y, z: (-x, y)),
        'nx': ([(x0, y0, z0), (x0, y0 + h, z0), (x0, y0 + h, z1), (x0, y0, z1)], (1, 0, 0), lambda x, y, z: (-z, y)),
        'px': ([(x1, y0, z0), (x1, y0, z1), (x1, y0 + h, z1), (x1, y0 + h, z0)], (-1, 0, 0), lambda x, y, z: (z, y)),
    }
    for k, (pts, n, uvf) in walls.items():
        if k in skip:
            continue
        S.g(wall).face(pts, [uvf(*p) for p in pts], n)

def uvbox(S, mat, x0, x1, y0, y1, z0, z1, skip=()):
    """a box with UVs in metres (box projection by face)"""
    def uvf(x, y, z, n):
        if abs(n[1]) > 0.5:
            return (x, z)
        if abs(n[0]) > 0.5:
            return (z, y)
        return (x, y)
    faces = {
        'top': ([(x0, y1, z0), (x0, y1, z1), (x1, y1, z1), (x1, y1, z0)], (0, 1, 0)),
        'bottom': ([(x0, y0, z0), (x1, y0, z0), (x1, y0, z1), (x0, y0, z1)], (0, -1, 0)),
        'px': ([(x1, y0, z0), (x1, y1, z0), (x1, y1, z1), (x1, y0, z1)], (1, 0, 0)),
        'nx': ([(x0, y0, z0), (x0, y0, z1), (x0, y1, z1), (x0, y1, z0)], (-1, 0, 0)),
        'pz': ([(x0, y0, z1), (x1, y0, z1), (x1, y1, z1), (x0, y1, z1)], (0, 0, 1)),
        'nz': ([(x0, y0, z0), (x0, y1, z0), (x1, y1, z0), (x1, y0, z0)], (0, 0, -1)),
    }
    for k, (pts, n) in faces.items():
        if k in skip:
            continue
        S.g(mat).face(pts, [uvf(*p, n) for p in pts], n)

def obox(S, mat, M, o, x0, x1, y0, y1, z0, z1, skip=()):
    """a box in a rotated local frame (M, o) — for consoles turned toward the operator"""
    corners = {}
    faces = {
        'top': ([(x0, y1, z0), (x0, y1, z1), (x1, y1, z1), (x1, y1, z0)], (0, 1, 0)),
        'bottom': ([(x0, y0, z0), (x1, y0, z0), (x1, y0, z1), (x0, y0, z1)], (0, -1, 0)),
        'px': ([(x1, y0, z0), (x1, y1, z0), (x1, y1, z1), (x1, y0, z1)], (1, 0, 0)),
        'nx': ([(x0, y0, z0), (x0, y0, z1), (x0, y1, z1), (x0, y1, z0)], (-1, 0, 0)),
        'pz': ([(x0, y0, z1), (x1, y0, z1), (x1, y1, z1), (x0, y1, z1)], (0, 0, 1)),
        'nz': ([(x0, y0, z0), (x0, y1, z0), (x1, y1, z0), (x1, y0, z0)], (0, 0, -1)),
    }
    for k, (pts, n) in faces.items():
        if k in skip:
            continue
        wp = [xf(M, o, p) for p in pts]
        nn = M @ Vector(n)
        uv = [(p[0], p[1]) if abs(n[2]) > 0.5 else (p[2], p[1]) if abs(n[0]) > 0.5 else (p[0], p[2]) for p in pts]
        S.g(mat).face(wp, uv, tuple(nn))

def oquad(S, mat, M, o, x0, x1, y0, y1, z=0.0, uv=None):
    pts = [(x0, y0, z), (x1, y0, z), (x1, y1, z), (x0, y1, z)]
    S.g(mat).face([xf(M, o, p) for p in pts], uv or [(0, 0), (1, 0), (1, 1), (0, 1)], tuple(M @ Vector((0, 0, 1))))

def ocyl(S, mat, M, o, c, r0, r1, a0, a1, n=12, axis='z', cap0=True, cap1=True):
    """a cylinder along a local axis, through rotation M and offset o"""
    tmp = Part('tmp')
    tmp.cyl(mat, c, r0, r1, a0, a1, n, axis=axis, cap0=cap0, cap1=cap1)
    for mname, geo in tmp.geo.items():
        for idx, uvs, sm in geo.faces:
            pts = [xf(M, o, geo.verts[i]) for i in idx]
            S.g(mname).face(pts, uvs, None, sm)

def pipe(S, p0, p1, r=0.04, mat='PipeWhite', n=10, flanges=True):
    S.beam(mat, p0, p1, r * 2, r * 2) if n <= 4 else _tube(S, p0, p1, r, mat, n)
    if flanges:
        d = Vector(p1) - Vector(p0)
        L = d.length
        if L > 1.2:
            k = 0.6
            while k < L - 0.3:
                c = Vector(p0) + d.normalized() * k
                _tube(S, tuple(c - d.normalized() * 0.02), tuple(c + d.normalized() * 0.02), r * 1.35, 'Steel', n)
                k += 1.8

def _tube(S, p0, p1, r, mat, n=10):
    a, b = Vector(p0), Vector(p1)
    d = b - a
    if d.length < 1e-6:
        return
    d.normalize()
    up = Vector((0, 1, 0)) if abs(d.y) < 0.95 else Vector((1, 0, 0))
    s = d.cross(up).normalized()
    u = s.cross(d).normalized()
    ring = lambda c: [c + (s * math.cos(2 * PI * i / n) + u * math.sin(2 * PI * i / n)) * r for i in range(n)]
    A, B = ring(a), ring(b)
    for i in range(n):
        j = (i + 1) % n
        mid = ((A[i] + A[j]) / 2 - a)
        S.g(mat).face([tuple(A[i]), tuple(A[j]), tuple(B[j]), tuple(B[i])], None, tuple(mid), True)

def pipe_run(S, pts, r=0.04, mat='PipeWhite', n=10):
    for a, b in zip(pts, pts[1:]):
        pipe(S, a, b, r, mat, n, flanges=False)
    for p in pts[1:-1]:
        S.sphere(mat, p, r * 1.05, r * 1.05, r * 1.05, n, 6)

def tray(S, p0, p1, w=0.3, h=0.08):
    """an overhead cable tray (an open channel with cables in it) along x or z"""
    x0, y0, z0 = p0
    x1, y1, z1 = p1
    along_x = abs(x1 - x0) > abs(z1 - z0)
    if along_x:
        uvbox(S, 'Steel', min(x0, x1), max(x0, x1), y0 - 0.005, y0, z0 - w / 2, z0 + w / 2)
        for sz in (-w / 2, w / 2):
            uvbox(S, 'Steel', min(x0, x1), max(x0, x1), y0, y0 + h, z0 + sz - 0.004, z0 + sz + 0.004)
        for k in range(4):
            _tube(S, (min(x0, x1), y0 + 0.02 + (k % 2) * 0.03, z0 - w / 2 + 0.05 + k * (w - 0.1) / 3), (max(x0, x1), y0 + 0.02 + (k % 2) * 0.03, z0 - w / 2 + 0.05 + k * (w - 0.1) / 3), 0.018, 'Cable', 6)
    else:
        uvbox(S, 'Steel', x0 - w / 2, x0 + w / 2, y0 - 0.005, y0, min(z0, z1), max(z0, z1))
        for sx in (-w / 2, w / 2):
            uvbox(S, 'Steel', x0 + sx - 0.004, x0 + sx + 0.004, y0, y0 + h, min(z0, z1), max(z0, z1))
        for k in range(4):
            _tube(S, (x0 - w / 2 + 0.05 + k * (w - 0.1) / 3, y0 + 0.02 + (k % 2) * 0.03, min(z0, z1)), (x0 - w / 2 + 0.05 + k * (w - 0.1) / 3, y0 + 0.02 + (k % 2) * 0.03, max(z0, z1)), 0.018, 'Cable', 6)

def light_fixture(S, c, w=0.3, l=1.2, along='x', mat='Light'):
    x, y, z = c
    if along == 'x':
        uvbox(S, 'Steel', x - l / 2 - 0.03, x + l / 2 + 0.03, y - 0.06, y, z - w / 2 - 0.03, z + w / 2 + 0.03)
        S.g(mat).face([(x - l / 2, y - 0.061, z - w / 2), (x + l / 2, y - 0.061, z - w / 2), (x + l / 2, y - 0.061, z + w / 2), (x - l / 2, y - 0.061, z + w / 2)], None, (0, -1, 0))
    else:
        uvbox(S, 'Steel', x - w / 2 - 0.03, x + w / 2 + 0.03, y - 0.06, y, z - l / 2 - 0.03, z + l / 2 + 0.03)
        S.g(mat).face([(x - w / 2, y - 0.061, z - l / 2), (x + w / 2, y - 0.061, z - l / 2), (x + w / 2, y - 0.061, z + l / 2), (x - w / 2, y - 0.061, z + l / 2)], None, (0, -1, 0))

def chair(S, pos, yaw=0.0, kind='task', mat='Seat', h=0.46):
    """an office / console chair (task: 5-star base; ship: pedestal bolted to the deck, arms)"""
    M = mat3(yaw)
    o = pos
    if kind == 'ship':
        ocyl(S, 'Steel', M, o, (0, 0, 0), 0.2, 0.2, 0.0, 0.03, 12, axis='y')
        ocyl(S, 'Steel', M, o, (0, 0, 0), 0.05, 0.05, 0.03, h - 0.05, 10, axis='y')
    else:
        for i in range(5):
            a = 2 * PI * i / 5
            p1 = xf(M, o, (math.cos(a) * 0.32, 0.06, math.sin(a) * 0.32))
            S.beam('Black', xf(M, o, (0, 0.08, 0)), p1, 0.035, 0.025)
            S.sphere('Black', p1, 0.028, 0.028, 0.028, 8, 4)
        ocyl(S, 'Chrome', M, o, (0, 0, 0), 0.025, 0.025, 0.08, h - 0.06, 10, axis='y')
    obox(S, mat, M, o, -0.24, 0.24, h - 0.06, h + 0.04, -0.22, 0.24)                  # seat
    obox(S, mat, M, o, -0.22, 0.22, h + 0.08, h + 0.62, 0.2, 0.28)                     # back
    obox(S, 'Black', M, o, -0.04, 0.04, h - 0.02, h + 0.1, 0.22, 0.26)                 # back post
    for sx in (-0.26, 0.26):
        obox(S, 'Black', M, o, sx - 0.025, sx + 0.025, h + 0.18, h + 0.22, -0.12, 0.14)  # arm rests
        obox(S, 'Black', M, o, sx - 0.015, sx + 0.015, h, h + 0.18, 0.08, 0.12)
    if kind == 'ship':
        obox(S, mat, M, o, -0.14, 0.14, h + 0.62, h + 0.8, 0.22, 0.28)                 # headrest

def keyboard(S, M, o, w=0.42, d=0.15):
    """a keyboard lying on a (local) desk surface at o (x across, z toward the operator)"""
    obox(S, 'Bezel', M, o, -w / 2, w / 2, 0.0, 0.018, -d / 2, d / 2)
    rows = 5
    for r in range(rows):
        n = 14 - (r == 4) * 6
        kw = (w - 0.02) / n
        for k in range(n):
            x = -w / 2 + 0.01 + k * kw
            z = -d / 2 + 0.012 + r * (d - 0.02) / rows
            obox(S, 'Panel', M, o, x + 0.002, x + kw - 0.002, 0.018, 0.026, z + 0.002, z + (d - 0.02) / rows - 0.004)

def trackball(S, M, o):
    obox(S, 'Bezel', M, o, -0.05, 0.05, 0.0, 0.02, -0.06, 0.06)
    S.sphere('ConsoleBlue', xf(M, o, (0, 0.02, -0.01)), 0.022, 0.022, 0.022, 12, 8)
    for sx in (-0.03, 0.03):
        obox(S, 'Panel', M, o, sx - 0.012, sx + 0.012, 0.02, 0.026, 0.025, 0.05)

def monitor(S, name, c, yaw=0.0, tilt=0.0, w=0.55, h=0.34, depth=0.06, px=None, stand=None, bezel=0.022, bright=None, art=None):
    """a flat panel display: bezel box and a live screen quad just in front; stand: height of a desk stand under it.
    name None: a decorative screen — art 0..7 shows one of the game's eight static console pictures (material
    'ScreenArt', a 4×2 atlas drawn by the game), else it's dark"""
    M = mat3(yaw, tilt)
    obox(S, 'Bezel', M, c, -w / 2 - bezel, w / 2 + bezel, -h / 2 - bezel, h / 2 + bezel, -depth, 0.0)
    obox(S, 'Bezel', M, c, -w * 0.3, w * 0.3, -h * 0.3, h * 0.3, -depth - 0.03, -depth)
    if stand:
        Mz = mat3(yaw)
        base = (c[0], c[1] - h / 2 - bezel - stand, c[2])
        obox(S, 'Bezel', Mz, base, -0.03, 0.03, 0.0, stand, -0.05, -0.02)
        obox(S, 'Bezel', Mz, base, -0.12, 0.12, 0.0, 0.012, -0.14, 0.06)
    if name:
        return screen(name, xf(M, c, (0, 0, 0.002)), yaw, tilt, w, h, px, bright)
    if art is not None:
        if 'ScreenArt' not in MATS:
            material('ScreenArt', srgb(0xffffff), 0.0, 0.3)
        k = int(art) % 8
        u0, v0 = (k % 4) / 4, (k // 4) / 2
        oquad(S, 'ScreenArt', M, c, -w / 2, w / 2, -h / 2, h / 2, 0.002, uv=[(u0, v0), (u0 + 0.25, v0), (u0 + 0.25, v0 + 0.5), (u0, v0 + 0.5)])
        return None
    oquad(S, 'Screen', M, c, -w / 2, w / 2, -h / 2, h / 2, 0.002)
    return None

def console(S, x, z, yaw=0.0, w=1.2, h_desk=0.76, d=0.75, upper=0.55, tilt_upper=0.2, mat='Console', face_mat='Panel', kneehole=True):
    """a sloped operator console facing +z (the operator sits at +z looking −z): desk at h_desk, a raised upper
    panel section at the back. Returns (M, anchors) with local anchors for the desk top, the slope and the upper face."""
    M = mat3(yaw)
    o = (x, 0.0, z)
    # the pedestal / body
    if kneehole:
        obox(S, mat, M, o, -w / 2, -w / 2 + 0.25, 0.0, h_desk - 0.03, -d / 2, d / 2 - 0.05)
        obox(S, mat, M, o, w / 2 - 0.25, w / 2, 0.0, h_desk - 0.03, -d / 2, d / 2 - 0.05)
        obox(S, mat, M, o, -w / 2 + 0.25, w / 2 - 0.25, 0.0, h_desk - 0.03, -d / 2, -d / 2 + 0.08)
    else:
        obox(S, mat, M, o, -w / 2, w / 2, 0.0, h_desk - 0.03, -d / 2, d / 2 - 0.05)
    obox(S, 'Black', M, o, -w / 2, w / 2, 0.0, 0.08, -d / 2 + 0.02, d / 2 - 0.03)            # plinth
    obox(S, face_mat, M, o, -w / 2 - 0.02, w / 2 + 0.02, h_desk - 0.03, h_desk, -d / 2, d / 2 + 0.03)  # desk top
    obox(S, 'Rubber', M, o, -w / 2 - 0.02, w / 2 + 0.02, h_desk - 0.035, h_desk + 0.005, d / 2 + 0.03, d / 2 + 0.06)  # front edge
    # the upper section: a box leaning back, its face toward the operator
    zb = -d / 2
    Mu = M @ mat3(0, tilt_upper)
    ou = xf(M, o, (0, h_desk, zb + 0.18))
    obox(S, mat, Mu, ou, -w / 2, w / 2, 0.0, upper, -0.18, 0.0)
    obox(S, 'Bezel', Mu, ou, -w / 2, w / 2, upper, upper + 0.03, -0.2, 0.02)
    anchors = {
        'desk': (M, xf(M, o, (0, h_desk, 0.05))),                  # desk surface centre (local y up)
        'upper': (Mu, xf(Mu, ou, (0, upper * 0.55, 0.001))),     # the upper face's centre (local z out)
        'upper_top': (Mu, xf(Mu, ou, (0, upper * 0.85, 0.001))),
        'upper_low': (Mu, xf(Mu, ou, (0, upper * 0.2, 0.001))),
    }
    return M, anchors

def handrail(S, p0, p1, r=0.018, mat='Metal', standoff=0.07):
    """a grab rail on brackets"""
    _tube(S, p0, p1, r, mat, 8)
    a, b = Vector(p0), Vector(p1)
    L = (b - a).length
    n = max(2, int(L / 1.2) + 1)
    for i in range(n):
        c = a + (b - a) * (i / (n - 1))
        S.beam(mat, tuple(c), (c.x, c.y + standoff, c.z), 0.02)

def valve_wheel(S, c, yaw=0.0, r=0.12, mat='Red'):
    M = mat3(yaw)
    n = 14
    for i in range(n):
        a0, a1 = 2 * PI * i / n, 2 * PI * (i + 1) / n
        S.beam(mat, xf(M, c, (math.cos(a0) * r, math.sin(a0) * r, 0)), xf(M, c, (math.cos(a1) * r, math.sin(a1) * r, 0)), 0.014)
    for i in range(3):
        a = 2 * PI * i / 3
        S.beam(mat, c, xf(M, c, (math.cos(a) * r, math.sin(a) * r, 0)), 0.01)
    ocyl(S, 'Steel', M, c, (0, 0, 0), 0.02, 0.02, -0.08, 0.02, 8, axis='z')

def gauge(S, c, yaw=0.0, tilt=0.0, r=0.06, mat='White'):
    M = mat3(yaw, tilt)
    ocyl(S, 'Chrome', M, c, (0, 0, 0), r * 1.12, r * 1.12, -0.03, 0.0, 16, axis='z')
    ocyl(S, mat, M, c, (0, 0, 0), r, r, -0.005, 0.001, 16, axis='z', cap0=False)
    obox(S, 'Black', M, c, -0.002, 0.002, 0.0, r * 0.8, 0.002, 0.004)

def switch_bank(S, M, o, cols=6, rows=2, pitch=0.04, mat='Metal'):
    """a strip of static toggles / pushbuttons (detail you don't press)"""
    for r in range(rows):
        for k in range(cols):
            x = (k - (cols - 1) / 2) * pitch
            y = (r - (rows - 1) / 2) * pitch
            obox(S, 'Bezel', M, o, x - 0.012, x + 0.012, y - 0.012, y + 0.012, -0.002, 0.002)
            if (k + r) % 3 == 0:
                obox(S, 'LampGreen' if (k * 7 + r) % 5 else 'LampAmber', M, o, x - 0.008, x + 0.008, y - 0.008, y + 0.008, 0.002, 0.008)
            else:
                ocyl(S, 'Chrome', M, o, (x, y, 0), 0.004, 0.003, 0.002, 0.02, 6, axis='z')

def finish(out, meta):
    """merge the static parts per material, write the room's extras, export the GLB"""
    for key, P in STATIC.items():
        if P.tris() == 0:
            continue
        ob = P.build(parent=ROOT)
    ROOT['room'] = json.dumps(meta, separators=(',', ':'))
    tris = sum(P.tris() for P in STATIC.values())
    os.makedirs(os.path.dirname(os.path.abspath(out)), exist_ok=True)
    bpy.ops.export_scene.gltf(filepath=out, export_format='GLB', export_extras=True, export_yup=True,
                              export_materials='EXPORT', export_image_format='AUTO', export_cameras=False, export_lights=False)
    print('exported', out, os.path.getsize(out) // 1024, 'KB · static tris ~', tris, '· nodes', len(NODES), '· labels', len(LABELS))
