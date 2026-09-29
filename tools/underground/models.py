# ═══════════════════════════════════════════════════════════════
# SKYWAR underground complexes: the portals (facade, blast doors) and the kit around them, built in Blender with the
# vehicle kit (tools/vehicles/vkit.py: game frame, x right, y up, z into the mountain / aft).
#   /opt/homebrew/bin/blender -b -P tools/underground/models.py            → models/underground/*.glb
#   /opt/homebrew/bin/blender -b -P tools/underground/models.py -- portal_air vent
#
# Materials (the game swaps its own in by name and node, src/ugworld.js):
#   Paint   cast concrete (models/underground/tex/facade_*.jpg, box-mapped 6 m a tile) — except the nodes named door_*,
#           which get the blast doors' painted steel (tex/door_*.jpg)
#   Detail  the vehicle kit's palette (models/vehicles/tex/detail.png): steel, rubber, lamps, hazard paint, insulators
#
# The portals, after real ones (sources in models/underground/CREDITS.md):
#   portal_air      Željava / Objekat 505 "Klek" hangar entrance: a cast facade with an inverted-T opening (wide and low
#                   for the wings, a tall slot in the middle for the fin: galleries A-C), two ~100 t sliding leaves that
#                   run into pockets in the piers, steel door tracks in the floor, floodlights, a gallery number
#   portal_tel      a missile operating base's vehicle portal (Sakkanmol / Yusang-ni: 6.5-9 m wide): one sliding leaf
#   portal_svc_a/b  personnel / service portals with two outward-opening hinged blast doors (Sakkanmol's "two outward
#                   opening doors"; Cheyenne Mountain's hinged 25 t doors)
#   vent            a ventilation / emergency-exit shaft head on the ridge (Željava's 13 air shafts double as exits)
#   guardpost       a checkpoint hut with a barrier boom and sandbags
#   substation      a fenced 35/6 kV yard: two transformers, a gantry with insulator strings, a switch house
#   pole            a concrete power-line pole with a cross-arm and pin insulators (wires are drawn by the game)
#   mast            a 26 m lattice relay mast with dishes and whips (the ridge-top antennas analysts look for)
# Doors: door_l / door_r nodes, origin on their pivot; userData.joint as the vehicles have it ({type: 'slide' | 'rot',
# axis, stow, deploy}); the game poses them 0 (shut) … 1 (open).
# ═══════════════════════════════════════════════════════════════
import bpy, sys, os, math
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, '..', 'vehicles'))
sys.dont_write_bytecode = True
import vkit
from vkit import Vehicle, slide, rot

OUT = os.path.normpath(os.path.join(HERE, '..', '..', 'models', 'underground'))


def reset():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    vkit.MATS.clear()
    vkit.setup_materials('red_green')


# ── a portal facade: W wide, H tall, T deep (z 0 = the front face, into the mountain along +z) ──
def facade(v, W, H, T, ow, oh, fin=None, pier=1.4):
    f = v.part('facade')
    fw, fh = (fin[0], fin[1]) if fin else (ow, oh)   # the tall slot (inverted T) or a plain rectangle
    lo = oh if not fin else fin[2]             # height of the wide lower opening
    hw = ow / 2
    # piers either side of the opening, the lintel over it (the leaves slide into the piers: they're solid)
    f.box('paint', -W / 2, -hw, 0, H, 0, T)
    f.box('paint', hw, W / 2, 0, H, 0, T)
    if fin:
        f.box('paint', -hw, -fw / 2, lo, H, 0, T)
        f.box('paint', fw / 2, hw, lo, H, 0, T)
        f.box('paint', -fw / 2, fw / 2, fh, H, 0, T)
    else:
        f.box('paint', -hw, hw, oh, H, 0, T)
    # the portal frame: a heavy moulding standing proud round the opening
    fr, pr = 1.1, 0.45
    f.box('paint', -hw - fr, -hw, 0, (fh if fin else oh) + fr, -pr, 0)
    f.box('paint', hw, hw + fr, 0, (fh if fin else oh) + fr, -pr, 0)
    if fin:
        f.box('paint', -hw - fr, -fw / 2, lo, lo + fr, -pr, 0)
        f.box('paint', fw / 2, hw + fr, lo, lo + fr, -pr, 0)
        f.box('paint', -fw / 2 - fr, -fw / 2, lo, fh + fr, -pr, 0)
        f.box('paint', fw / 2, fw / 2 + fr, lo, fh + fr, -pr, 0)
        f.box('paint', -fw / 2 - fr, fw / 2 + fr, fh, fh + fr, -pr, 0)
    else:
        f.box('paint', -hw - fr, hw + fr, oh, oh + fr, -pr, 0)
    # pilasters and the stepped buttresses at the ends (they take the thrust of the cutting's walls)
    n = max(2, int(W / 8))
    for i in range(n + 1):
        x = -W / 2 + W * i / n
        if abs(x) < hw + fr + 1.2:
            continue
        f.box('paint', x - 0.5, x + 0.5, 0, H - 0.6, -0.3, 0)
    for s in (-1, 1):
        x0, x1 = (-W / 2, -W / 2 + pier) if s < 0 else (W / 2 - pier, W / 2)
        f.box('paint', x0, x1, 0, H * 0.45, -1.6, 0)
        f.box('paint', x0, x1, H * 0.45, H * 0.72, -0.9, 0)
    # the parapet and coping along the top, a drip groove under it
    f.box('paint', -W / 2, W / 2, H, H + 0.9, -0.2, T)
    f.box('paint', -W / 2 - 0.15, W / 2 + 0.15, H + 0.9, H + 1.15, -0.45, T + 0.2)
    f.box('dark', -W / 2 + 0.3, W / 2 - 0.3, H - 0.12, H, -0.25, -0.18)
    # board-formed lift lines: a thin dark groove every 1.2 m up the face (the pours of the concrete)
    y = 1.2
    while y < H - 0.5:
        for (a, b) in ((-W / 2 + pier, -hw - fr), (hw + fr, W / 2 - pier)):
            if b - a > 0.4:
                f.box('dark', a, b, y, y + 0.04, -0.012, 0.0)
        y += 1.2
    # hazard paint up the jambs, the gallery number over the door, cable conduits, floodlights on brackets
    for s in (-1, 1):
        x = s * (hw + fr / 2)
        for k in range(6):
            f.box('yellow' if k % 2 == 0 else 'black', x - fr / 2, x + fr / 2, k * 0.35, k * 0.35 + 0.35, -pr - 0.01, -pr)
        f.box('steel', s * (W / 2 - pier - 0.9), s * (W / 2 - pier - 0.7), 0.4, H - 1, -0.35, -0.15)   # conduit
        for yy in (H * 0.35, H * 0.7):
            f.box('darkgrey', s * (W / 2 - pier - 1.1), s * (W / 2 - pier - 0.5), yy, yy + 0.5, -0.4, -0.2)  # junction box
    top = (fh if fin else oh) + fr
    f.box('decal_white', -1.4, 1.4, top + 0.5, top + 1.6, -pr - 0.06, -pr)
    f.box('black', -1.25, 1.25, top + 0.62, top + 1.48, -pr - 0.08, -pr - 0.06)
    for x in (-hw * 0.6, -hw * 0.2, hw * 0.2, hw * 0.6):
        f.beam('steel', (x, top + 0.3, -pr), (x, top + 0.3, -pr - 1.4), 0.12, 0.12)
        f.box('darkgrey', x - 0.35, x + 0.35, top - 0.05, top + 0.45, -pr - 1.9, -pr - 1.2)
        f.box('lamp_glow', x - 0.3, x + 0.3, top - 0.06, top + 0.02, -pr - 1.85, -pr - 1.25)
    # warning beacons at the top corners of the frame (the game flashes its own light there)
    for s in (-1, 1):
        f.cyl('lens_amber', (s * (hw + fr / 2), top, -pr - 0.2), (s * (hw + fr / 2), top + 0.45, -pr - 0.2), 0.18, n=10)
    # the door tracks in the floor (steel rails across the opening, a drain grate in front)
    for z in (1.0, 2.2):
        f.box('steel', -W / 2 + pier, W / 2 - pier, 0.0, 0.05, z - 0.08, z + 0.08)
    f.box('mesh', -hw, hw, 0.0, 0.03, -2.6, -1.8)
    # the back of the facade inside the tunnel: a steel liner plate round the opening
    return f


def sliding_leaf(v, name, x0, x1, y0, y1, z0, z1, dist, fin_cut=None):
    """a steel blast-door leaf (box with stiffeners) sliding along x by `dist` (sign = direction)"""
    piv = ((x0 + x1) / 2, 0, (z0 + z1) / 2)
    d = v.part(name, pivot=piv, joint=slide('x' if dist > 0 else '-x', abs(dist), group='door'))
    if fin_cut:
        # an inverted-T leaf: the tall part over its inner half
        xi, xo, ytop = fin_cut[0], fin_cut[1], fin_cut[2]
        d.box('paint', x0, x1, y0, fin_cut[3], z0, z1)
        d.box('paint', min(xi, xo), max(xi, xo), fin_cut[3], ytop, z0, z1)
    else:
        d.box('paint', x0, x1, y0, y1, z0, z1)
    # horizontal stiffeners on the face, a rubbing strip, wheels in the track
    yy = y0 + 0.9
    while yy < y1 - 0.4:
        top = y1 if not fin_cut else (fin_cut[2] if min(fin_cut[0], fin_cut[1]) <= (x0 + x1) / 2 <= max(fin_cut[0], fin_cut[1]) else fin_cut[3])
        if yy < top - 0.3:
            d.box('paint', x0 + 0.15, x1 - 0.15, yy, yy + 0.22, z0 - 0.18, z0)
        yy += 1.5
    for x in (x0 + 0.6, x1 - 0.6):
        d.box('paint', x - 0.12, x + 0.12, y0 + 0.2, y1 - 0.3 if not fin_cut else fin_cut[3] - 0.3, z0 - 0.2, z0)
    lead = x1 if dist < 0 else x0   # (the leading edge: hazard stripes)
    for k in range(int((y1 - y0) / 0.5)):
        d.box('yellow' if k % 2 == 0 else 'black', lead - 0.12, lead + 0.12, y0 + k * 0.5, y0 + k * 0.5 + 0.5, z0 - 0.22, z0 - 0.02)
    for x in [x0 + (x1 - x0) * t for t in (0.15, 0.5, 0.85)]:
        d.cyl('dark', (x, 0.35, z0 + 0.1), (x, 0.35, z1 - 0.1), 0.32, n=12)
    return d


def swing_leaf(v, name, hinge_x, width, h, z0, z1, side):
    """a hinged blast door leaf: side −1 hinged at the left jamb, +1 at the right; opens outward (−z) 100°"""
    piv = (hinge_x, 0, z0)
    ang = math.radians(100)
    d = v.part(name, pivot=piv, joint=rot('y', 0, ang, deploy=ang * (-side), group='door'))
    x0, x1 = (hinge_x, hinge_x + width) if side < 0 else (hinge_x - width, hinge_x)
    d.box('paint', x0, x1, 0.02, h, z0, z1)
    # a frame of flat bars, the locking wheel, hazard edge, hinges
    d.box('paint', x0 + 0.15, x1 - 0.15, 0.2, 0.4, z0 - 0.12, z0)
    d.box('paint', x0 + 0.15, x1 - 0.15, h - 0.4, h - 0.2, z0 - 0.12, z0)
    d.box('paint', x0 + 0.15, x1 - 0.15, h * 0.5 - 0.1, h * 0.5 + 0.1, z0 - 0.12, z0)
    wx = x1 - 0.7 if side < 0 else x0 + 0.7
    d.cyl('steel', (wx, h * 0.5, z0 - 0.12), (wx, h * 0.5, z0 - 0.4), 0.06, n=8)
    d.tube('steel', [(wx + 0.35 * math.cos(a), h * 0.5 + 0.35 * math.sin(a), z0 - 0.4) for a in [i * math.pi / 6 for i in range(13)]], 0.035, n=5)
    edge = x1 if side < 0 else x0
    for k in range(int(h / 0.5)):
        d.box('yellow' if k % 2 == 0 else 'black', edge - 0.1, edge + 0.1, k * 0.5, k * 0.5 + 0.5, z0 - 0.14, z0 - 0.01)
    for y in (0.6, h * 0.5, h - 0.6):
        d.cyl('dark', (hinge_x, y - 0.25, z0 - 0.15), (hinge_x, y + 0.25, z0 - 0.15), 0.16, n=10)
    return d


def portal(pid, W, H, T, ow, oh, door, fin=None):
    reset()
    v = Vehicle(pid, pid)
    facade(v, W, H, T, ow, oh, fin=fin)
    z0, z1 = 1.1, 2.1                 # the leaves stand in the recess behind the frame, over the tracks
    if door == 'slide2':
        # two leaves meeting in the middle, each sliding into its pier
        fw, fh, lo = fin
        sliding_leaf(v, 'door_l', -ow / 2 - 0.1, 0.02, 0, lo + 0.1, z0, z1, -(ow / 2 + 0.2), fin_cut=(0.02, -fw / 2 - 0.1, fh + 0.1, lo + 0.1))
        sliding_leaf(v, 'door_r', -0.02, ow / 2 + 0.1, 0, lo + 0.1, z0, z1, ow / 2 + 0.2, fin_cut=(-0.02, fw / 2 + 0.1, fh + 0.1, lo + 0.1))
    elif door == 'slide1':
        sliding_leaf(v, 'door_l', -ow / 2 - 0.15, ow / 2 + 0.15, 0, oh + 0.15, z0, z1, ow + 0.4)
    else:
        swing_leaf(v, 'door_l', -ow / 2, ow / 2, oh, -0.55, -0.02, -1)
        swing_leaf(v, 'door_r', ow / 2, ow / 2, oh, -0.55, -0.02, 1)
    v.build(center=False, out=os.path.join(OUT, pid + '.glb'))


# ── the kit around the portals ──
def vent():
    reset()
    v = Vehicle('vent', 'vent')
    p = v.part('body')
    # a concrete shaft collar with a louvred steel hood and a mushroom cap, in a small fenced plot
    p.box('paint', -2.2, 2.2, -1.5, 1.2, -2.2, 2.2)
    p.box('paint', -1.8, 1.8, 1.2, 3.6, -1.8, 1.8)
    for s in (-1, 1):
        for k in range(5):
            y = 1.5 + k * 0.4
            p.box('vents', -1.5, 1.5, y, y + 0.28, s * 1.8 - 0.05, s * 1.8 + 0.05)
            p.box('vents', s * 1.8 - 0.05, s * 1.8 + 0.05, y, y + 0.28, -1.5, 1.5)
    p.cyl('steel', (0, 3.6, 0), (0, 4.3, 0), 0.9, n=16)
    p.cyl('gunmetal', (0, 4.3, 0), (0, 4.9, 0), 2.1, 0.9, n=16)
    p.cyl('rust', (0, 4.9, 0), (0, 5.0, 0), 0.9, 0.6, n=16)
    for i in range(12):
        a = i * math.pi * 2 / 12
        x, z = 4.2 * math.cos(a), 4.2 * math.sin(a)
        p.cyl('steel', (x, -0.5, z), (x, 1.9, z), 0.04, n=5)
    p.tube('steel', [(4.2 * math.cos(i * math.pi / 6), 1.9, 4.2 * math.sin(i * math.pi / 6)) for i in range(13)], 0.03, n=4)
    p.tube('steel', [(4.2 * math.cos(i * math.pi / 6), 1.0, 4.2 * math.sin(i * math.pi / 6)) for i in range(13)], 0.02, n=4)
    p.box('yellow', -0.4, 0.4, 0.5, 0.9, -2.23, -2.2)
    v.build(center=False, out=os.path.join(OUT, 'vent.glb'))


def guardpost():
    reset()
    v = Vehicle('guardpost', 'guardpost')
    p = v.part('body')
    # a whitewashed block hut (3 × 3 m) with a flat roof and windows all round, a boom barrier and sandbags
    p.box('paint', -1.5, 1.5, 0, 2.6, -1.5, 1.5, bev=0.03)
    p.box('paint', -1.8, 1.8, 2.6, 2.85, -1.8, 1.8)
    for s in (-1, 1):
        p.box('glass', -1.0, 1.0, 1.2, 2.1, s * 1.51 - 0.01, s * 1.51 + 0.01)
        p.box('glass', s * 1.51 - 0.01, s * 1.51 + 0.01, 1.2, 2.1, -0.8, 0.4)
    p.box('dark', 0.55, 1.35, 0, 2.05, 1.5, 1.53)                       # the door
    p.cyl('steel', (1.2, 2.85, -1.2), (1.2, 5.2, -1.2), 0.03, n=5)      # whip antenna
    p.box('lamp_glow', -0.3, 0.3, 2.3, 2.5, -1.62, -1.52)
    # the boom: a post, the pivot and a red-and-white striped arm across the road (+x)
    p.box('darkgrey', 2.1, 2.5, 0, 1.2, -2.3, -1.9)
    for k in range(8):
        p.box('red' if k % 2 == 0 else 'white', 2.5 + k * 0.9, 3.4 + k * 0.9, 0.95, 1.1, -2.16, -2.04)
    p.box('darkgrey', 9.4, 9.6, 0, 0.95, -2.2, -2.0)
    # sandbag wall in front
    for row in range(3):
        for k in range(6):
            x = -2.4 + k * 0.62 + (0.31 if row % 2 else 0)
            p.box('canvas_green', x, x + 0.58, row * 0.28, row * 0.28 + 0.27, -2.9, -2.4, bev=0.06)
    v.build(center=False, out=os.path.join(OUT, 'guardpost.glb'))


def substation():
    reset()
    v = Vehicle('substation', 'substation')
    p = v.part('body')
    # a concrete pad and chain-link fence 26 × 18 m, two transformers, a gantry with strings of insulators, a switch house
    p.box('paint', -13, 13, -0.3, 0.15, -9, 9)
    for (x0, x1, z0, z1) in ((-13, 13, -9, -8.95), (-13, 13, 8.95, 9), (-13, -12.95, -9, 9), (12.95, 13, -9, 9)):
        p.box('mesh', x0, x1, 0.15, 2.4, z0, z1)
    for x in range(-13, 14, 3):
        for z in (-9, 9):
            p.cyl('steel', (x, 0, z), (x, 2.6, z), 0.04, n=5)
    for (tx, tz) in ((-5, 2), (3, 2)):
        p.box('odgreen', tx - 1.6, tx + 1.6, 0.15, 2.6, tz - 1.1, tz + 1.1, bev=0.05)
        for k in range(6):
            p.box('odgreen', tx - 1.75, tx + 1.75, 0.5 + k * 0.33, 0.62 + k * 0.33, tz - 1.35, tz + 1.35)   # radiator fins
        for dx in (-0.8, 0, 0.8):
            p.cyl('insulator', (tx + dx, 2.6, tz), (tx + dx, 3.7, tz), 0.14, 0.09, n=8)
        p.cyl('odgreen', (tx - 1.0, 2.6, tz - 0.7), (tx - 1.0, 3.3, tz - 0.7), 0.35, n=10)                  # conservator
    # the gantry (two lattice portals) with insulator strings, where the line comes in
    for x in (-9, 9):
        for z in (-5, 5):
            p.beam('zinc', (x, 0, z), (x, 9, z), 0.35)
        p.beam('zinc', (x, 8.6, -5.2), (x, 8.6, 5.2), 0.35, 0.5)
        for z in (-3, 0, 3):
            p.tube('insulator', [(x, 8.4, z), (x, 7.2, z)], 0.12, n=6)
    p.box('paint', 7, 12, 0.15, 3.3, -8, -3)                           # the switch house
    p.box('dark', 7.9, 9.1, 0.15, 2.3, -8.02, -7.98)
    p.box('paint', 6.8, 12.2, 3.3, 3.5, -8.2, -2.8)
    p.box('yellow', -1, 1, 1.2, 1.8, -9.02, -8.99)                     # the lightning-bolt sign
    v.build(center=False, out=os.path.join(OUT, 'substation.glb'))


def pole():
    reset()
    v = Vehicle('pole', 'pole')
    p = v.part('body')
    # a Soviet SV-105-style concrete pole: tapered square section, steel cross-arm, three pin insulators
    p.prism_y('paint', [(-0.14, -0.14), (0.14, -0.14), (0.14, 0.14), (-0.14, 0.14)], -1.0, 10.5)
    p.box('steel', -1.3, 1.3, 9.8, 9.95, -0.06, 0.06)
    p.beam('steel', (-0.9, 9.8, 0), (0, 9.0, 0), 0.05)
    p.beam('steel', (0.9, 9.8, 0), (0, 9.0, 0), 0.05)
    for x in (-1.2, 0, 1.2):
        y = 9.95 if x else 10.5
        p.cyl('insulator', (x, y, 0), (x, y + 0.28, 0), 0.08, 0.05, n=8)
        p.empty('wire_%d' % (int(x * 10) // 12 + 1), (x, y + 0.26, 0), (0, 0, -1))
    v.build(center=False, out=os.path.join(OUT, 'pole.glb'))


def mast():
    reset()
    v = Vehicle('mast', 'mast')
    p = v.part('body')
    H = 26.0
    # a triangular lattice mast on a concrete footing, guy anchors, a platform, dishes and whips
    p.box('paint', -1.2, 1.2, -0.5, 0.4, -1.2, 1.2)
    legs = [(0.9 * math.cos(a), 0.9 * math.sin(a)) for a in (math.pi / 2, math.pi / 2 + 2.094, math.pi / 2 + 4.189)]
    for (x, z) in legs:
        p.cyl('zinc', (x, 0.4, z), (x * 0.55, H, z * 0.55), 0.05, n=5)
    n = 13
    for i in range(n):
        y0, y1 = 0.4 + (H - 0.4) * i / n, 0.4 + (H - 0.4) * (i + 1) / n
        k0, k1 = 1 - 0.45 * i / n, 1 - 0.45 * (i + 1) / n
        for j in range(3):
            a, b = legs[j], legs[(j + 1) % 3]
            p.cyl('zinc', (a[0] * k0, y0, a[1] * k0), (b[0] * k1, y1, b[1] * k1), 0.025, n=4, cap0=False, cap1=False)
            p.cyl('zinc', (a[0] * k1, y1, a[1] * k1), (b[0] * k1, y1, b[1] * k1), 0.025, n=4, cap0=False, cap1=False)
    p.box('steel', -1.1, 1.1, H * 0.62, H * 0.62 + 0.1, -1.1, 1.1)
    for (ang, y) in ((0.3, H * 0.62 + 1.1), (2.4, H * 0.75)):
        c = (0.9 * math.cos(ang), y, 0.9 * math.sin(ang))
        d = (math.cos(ang), 0, math.sin(ang))
        p.lathe(c, d, [(0.0, 0.0, 'white'), (0.06, 0.45, 'white'), (0.22, 0.8, 'white'), (0.36, 0.95, 'white')], n=16)
        p.cyl('white', c, (c[0] + d[0] * 0.5, c[1], c[2] + d[2] * 0.5), 0.06, n=6)
    for (x, z) in legs:
        p.cyl('steel', (x * 0.55, H, z * 0.55), (x * 0.55, H + 4, z * 0.55), 0.03, n=5)
    p.cyl('lens_red', (0, H + 0.1, 0), (0, H + 0.4, 0), 0.12, n=8)
    for (x, z) in legs:
        p.tube('cable', [(x * 0.6, H * 0.8, z * 0.6), (x * 16, 0, z * 16)], 0.015, n=3)
        p.box('paint', x * 16 - 0.4, x * 16 + 0.4, -0.3, 0.3, z * 16 - 0.4, z * 16 + 0.4)
    v.build(center=False, out=os.path.join(OUT, 'mast.glb'))


BUILD = {
    'portal_air': lambda: portal('portal_air', 46, 18, 8, 22, 9.5, 'slide2', fin=(9, 9.5, 5.4)),
    'portal_tel': lambda: portal('portal_tel', 24, 13, 7, 9, 7, 'slide1'),
    'portal_svc_a': lambda: portal('portal_svc_a', 22, 12, 6, 8, 6.5, 'swing'),
    'portal_svc_b': lambda: portal('portal_svc_b', 18, 10, 6, 6, 5, 'swing'),
    'vent': vent, 'guardpost': guardpost, 'substation': substation, 'pole': pole, 'mast': mast,
}

if __name__ == '__main__':
    argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
    for k in (argv or list(BUILD)):
        BUILD[k]()
