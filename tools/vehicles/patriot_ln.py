# ═══════════════════════════════════════════════════════════════
# M903 launching station (MIM-104 Patriot) on the M860A1 semi-trailer, standing on its landing gear (unhitched).
#   blender -b -P tools/vehicles/build.py -- patriot_ln
# Four PAC-2 GEM-T missiles in their canisters (6.1 × 1.09 × 0.99 m each, a 2 × 2 stack), the EPP generator on the
# gooseneck, the launcher electronics module on the deck, four swing-out outriggers, the data-link mast.
# References: JASDF / RoCAF M901 launching stations (Wikimedia Commons: side view in launch mode, behind view,
# left front view; the RoCAF LS with its M983 in travel): launch elevation 38° with the canister fronts facing
# forward, pivot at the rear of the launcher, two elevation rams, traverse about ±110°, 2.90 m overall width.
# Rig: turret (rot y, ±110°), launcher (rot x 0 → 38°, the elevation pivot at the rear), canister_1..4 (children of
# the launcher: 1 upper left, 2 upper right, 3 lower left, 4 lower right, seen from behind), muzzle_1..4 at the front
# covers, ram_l / ram_r, mast (the data-link antenna mast, slide up 2.2 m, group 'raise'),
# outrigger_fl/fr/rl/rr (swing out 45°) with jack_fl/fr/rl/rr (screw legs to the ground), landing_gear
# (slide up 0.42 m, group 'gear', for towing), kingpin (empty for the tractor's hitch).
# ═══════════════════════════════════════════════════════════════
import math
from mathutils import Vector
import vkit
from vkit import Vehicle, Part, rot, slide, lerp
import usfam
from usfam import M860

PIVOT = (0.0, 1.95, 9.45)       # launcher elevation pivot (rear of the canister stack)
TURRET = (0.0, 1.35, 9.00)      # traverse axis on the deck
RACK = {'z0': 3.30, 'z1': 9.55, 'y0': 1.90, 'hw': 1.18}
CAN = {'w': 1.09, 'h': 0.99, 'len': 6.10}
ELEV = math.radians(38)


def canister(v, name, parent, cx, cy, z0, z1, idx):
    """a PAC-2 canister: ribbed box, front cover (frangible), rear closure with connectors, lifting eyes, markings"""
    w, h = CAN['w'] / 2, CAN['h'] / 2
    c = Part(v, name, pivot=(cx, cy, z1), parent=parent)
    c.box('paint', cx - w, cx + w, cy - h, cy + h, z0, z1, bev=0.02)
    # reinforcing ribs every ~0.6 m (slightly proud of the skin), heavier end frames
    n = 10
    for k in range(n + 1):
        z = lerp(z0 + 0.06, z1 - 0.06, k / n)
        t = 0.07 if 0 < k < n else 0.12
        e = 0.022 if 0 < k < n else 0.035
        c.box('paint', cx - w - e, cx + w + e, cy - h - e, cy + h + e, z - t / 2, z + t / 2)
    # front cover: a pale frangible panel in a frame
    fz = z0 - 0.004
    c.panel('radome', [(cx - w + 0.07, cy - h + 0.07, z0), (cx + w - 0.07, cy - h + 0.07, z0), (cx + w - 0.07, cy + h - 0.07, z0), (cx - w + 0.07, cy + h - 0.07, z0)],
            (0, 0, -1), off=0.008, frame=0.03, frame_skin='dark')
    usfam.panel_lines(c, [(cx - w + 0.14, cy - h + 0.14, fz - 0.006), (cx + w - 0.14, cy - h + 0.14, fz - 0.006), (cx + w - 0.14, cy + h - 0.14, fz - 0.006), (cx - w + 0.14, cy + h - 0.14, fz - 0.006)], (0, 0, -1), 0.01, 'grey')
    # rear closure: connector boxes, umbilical cable loops
    c.panel('paint', [(cx - w + 0.06, cy - h + 0.06, z1), (cx + w - 0.06, cy - h + 0.06, z1), (cx + w - 0.06, cy + h - 0.06, z1), (cx - w + 0.06, cy + h - 0.06, z1)],
            (0, 0, 1), off=0.01, frame=0.025, frame_skin='dark')
    c.box('dark', cx - 0.2, cx + 0.2, cy - h + 0.12, cy - h + 0.34, z1 + 0.01, z1 + 0.12, bev=0.01)
    for dx in (-0.12, 0.0, 0.12):
        c.cyl('dark', (cx + dx, cy - h + 0.23, z1 + 0.12), (cx + dx, cy - h + 0.23, z1 + 0.17), 0.035, 0.035, 8)
    c.tube('cable', [(cx - 0.12, cy - h + 0.23, z1 + 0.17), (cx - 0.2, cy - h + 0.05, z1 + 0.3), (cx - 0.1, cy - h - 0.2, z1 + 0.28)], 0.018, 5)
    # lifting eyes on the top corners, forklift pockets on the sides
    for dz in (0.6, CAN['len'] - 0.6):
        for dx in (-w + 0.12, w - 0.12):
            c.cyl('dark', (cx + dx, cy + h + 0.02, z0 + dz - 0.05), (cx + dx, cy + h + 0.02, z0 + dz + 0.05), 0.05, 0.05, 8)
    for sx in (-1, 1):
        x = cx + sx * (w + 0.023)
        for dz in (2.3, 3.8):
            c.panel('black', [(x, cy - h + 0.1, z0 + dz - 0.15), (x, cy - h + 0.1, z0 + dz + 0.15), (x, cy - h + 0.28, z0 + dz + 0.15), (x, cy - h + 0.28, z0 + dz - 0.15)],
                    (sx, 0, 0), off=0.003)
        # the orange missile-type band and white stencils near the front
        c.panel('orange', [(x, cy - h + 0.05, z0 + 0.62), (x, cy - h + 0.05, z0 + 0.72), (x, cy + h - 0.05, z0 + 0.72), (x, cy + h - 0.05, z0 + 0.62)], (sx, 0, 0), off=0.004)
        usfam.stencil_box(c, (x, cy + 0.1, z0 + 1.6), 0.5, 0.08, (sx, 0, 0))
        usfam.stencil_box(c, (x, cy - 0.05, z0 + 1.6), 0.36, 0.06, (sx, 0, 0))
    # launch direction: the front cover, facing forward (−z)
    c.empty('muzzle_%d' % idx, (cx, cy, z0 - 0.01), (0, 0, -1))
    return c


def build_launcher(v, tur):
    px, py, pz = PIVOT
    L = Part(v, 'launcher', pivot=PIVOT, parent=tur, joint=rot('x', 0.0, ELEV, stow=0.0, deploy=ELEV, group='launcher'))
    z0, z1, y0, hw = RACK['z0'], RACK['z1'], RACK['y0'], RACK['hw']
    ytop = y0 + 0.05 + 2 * CAN['h'] + 0.03
    # longerons along the bottom, the rear gantry (pivot trunnions), front and middle clamp frames
    for sx in (-1, 1):
        L.box('paint', sx * (hw - 0.14), sx * hw, y0, y0 + 0.16, z0, z1, bev=0.015)
        L.box('dark', sx * 0.28, sx * 0.42, y0 - 0.12, y0 + 0.02, z0 + 1.2, z1 - 0.3)      # ram rails / lower beams
    for z, t in ((z1 - 0.12, 0.24), (z0 + 0.1, 0.2), (z0 + 2.2, 0.14), (z0 + 4.2, 0.14)):
        for sx in (-1, 1):
            L.box('paint', sx * (hw - 0.09), sx * (hw + 0.03), y0, ytop + 0.04, z - t / 2, z + t / 2)
        L.box('paint', -hw - 0.03, hw + 0.03, ytop, ytop + 0.1, z - t / 2, z + t / 2)
        L.box('paint', -hw, hw, y0, y0 + 0.1, z - t / 2, z + t / 2)
        # diagonal bracing on the frame sides (the X seen in the photos)
    for sx in (-1, 1):
        x = sx * (hw + 0.035)
        for (za, zb) in ((z0 + 0.2, z0 + 2.1), (z1 - 2.1, z1 - 0.2)):
            L.beam('paint', (x, y0 + 0.2, za), (x, ytop - 0.05, zb), 0.05, 0.05)
    # trunnion bearings at the pivot, the rear gantry's side plates and knee braces
    for sx in (-1, 1):
        L.cyl('dark', (sx * 0.95, py, pz), (sx * 1.15, py, pz), 0.12, 0.12, 12)
        L.face([(sx * (hw + 0.05), y0 - 0.05, z1 - 0.02), (sx * (hw + 0.05), y0 - 0.05, z1 - 0.9), (sx * (hw + 0.05), y0 + 0.7, z1 - 0.02)], 'paint', want=(sx, 0, 0))
        L.face([(sx * (hw + 0.01), y0 - 0.05, z1 - 0.02), (sx * (hw + 0.01), y0 + 0.7, z1 - 0.02), (sx * (hw + 0.01), y0 - 0.05, z1 - 0.9)], 'paint', want=(-sx, 0, 0))
        L.beam('paint', (sx * 0.95, py - 0.05, pz), (sx * (hw - 0.05), y0 + 0.08, z1 - 0.8), 0.08, 0.08)
    # canisters: 2 × 2, upper row first (1 upper left, 2 upper right, 3 lower left, 4 lower right)
    cz0, cz1 = z1 - 0.1 - CAN['len'], z1 - 0.1
    ylo = y0 + 0.05 + CAN['h'] / 2 + 0.01
    yhi = ylo + CAN['h'] + 0.03
    k = 1
    for cy in (yhi, ylo):
        for cx in (-(CAN['w'] / 2 + 0.03), CAN['w'] / 2 + 0.03):
            canister(v, 'canister_%d' % k, L, cx, cy, cz0, cz1, k)
            k += 1
    # umbilical cable bundle from the rear gantry down to the turret
    L.tube('cable', [(-0.6, y0 + 0.1, z1 + 0.02), (-0.7, y0 - 0.15, z1 + 0.2), (-0.55, y0 - 0.4, pz + 0.3)], 0.035, 6)
    L.tube('cable', [(0.5, y0 + 0.1, z1 + 0.02), (0.65, y0 - 0.2, z1 + 0.25), (0.5, y0 - 0.42, pz + 0.35)], 0.03, 6)
    return L


def build_turret(v):
    tx, ty, tz = TURRET
    t = Part(v, 'turret', pivot=TURRET, joint=rot('y', -math.radians(110), math.radians(110), stow=0.0, deploy=0.0, group='turret'))
    # turntable ring, the launcher mount frame, pivot pedestals, ram base brackets
    t.cyl('dark', (0, ty, tz), (0, ty + 0.12, tz), 0.95, 0.95, 28, cap0=False)
    t.cyl('paint', (0, ty + 0.12, tz), (0, ty + 0.22, tz), 1.0, 0.98, 28, cap0=False)
    t.bolts('dark', (0, ty + 0.12, tz), (0, 1, 0), 0.9, 20, rb=0.02, h=0.03)
    px, py, pz = PIVOT
    for sx in (-1, 1):
        t.box('paint', sx * 0.62, sx * 1.02, ty + 0.2, py + 0.05, pz - 0.35, pz + 0.3, bev=0.02)    # pivot pedestals
        t.box('paint', sx * 0.5, sx * 0.78, ty + 0.2, ty + 0.36, 7.25, pz - 0.2)                     # arms to the ram bases
        t.box('dark', sx * 0.52, sx * 0.74, ty + 0.2, ty + 0.4, 7.3, 7.6)
    t.box('paint', -0.8, 0.8, ty + 0.2, ty + 0.36, 7.9, pz - 0.3)
    # the mechanical module / hydraulic power unit on the turret (between the pedestals, under the rack rear)
    t.box('paint', -0.55, 0.55, ty + 0.22, ty + 0.5, 8.1, 9.2, bev=0.03)
    usfam.hatch_x(t, 0.55, 1, ty + 0.25, ty + 0.47, 8.3, 8.9, handle=True)
    t.cyl('dark', (-0.3, ty + 0.5, 8.4), (-0.3, ty + 0.58, 8.4), 0.08, 0.08, 10)
    # data-link mast: outer tube on the turret's rear left, the inner mast slides up (group 'raise')
    mx, mz = -1.30, 9.72
    t.box('dark', -1.02, mx + 0.1, ty + 0.2, ty + 0.34, mz - 0.1, mz + 0.1)
    t.cyl('paint', (mx, ty + 0.2, mz), (mx, 3.85, mz), 0.075, 0.075, 10)
    t.cyl('dark', (mx, 3.8, mz), (mx, 3.88, mz), 0.09, 0.09, 10)
    for y in (2.2, 3.2):
        t.beam('dark', (mx, y, mz), (-1.05, y - 0.3, mz - 0.1), 0.04, 0.04)
    m = Part(v, 'mast', pivot=(mx, 3.88, mz), parent=t, joint=slide('y', 2.4, group='raise'))
    m.cyl('steel', (mx, 1.75, mz), (mx, 3.95, mz), 0.055, 0.055, 10)
    m.cyl('dark', (mx, 3.95, mz), (mx, 4.08, mz), 0.07, 0.05, 10)
    m.cyl('black', (mx, 4.08, mz), (mx, 4.6, mz), 0.018, 0.01, 6, cap0=False)
    for a in range(3):
        ang = a * 2 * math.pi / 3
        m.beam('black', (mx, 4.04, mz), (mx + 0.26 * math.cos(ang), 3.96, mz + 0.26 * math.sin(ang)), 0.012, 0.012)
    return t


def build_generator(b):
    """the EPP (electric power plant) on the gooseneck: a tall box with louvred intakes, doors, exhaust"""
    x0, x1, y0, y1, z0, z1 = -1.12, 1.12, M860['neck_top'], 3.72, 0.22, 2.42
    b.box('paint', x0, x1, y0, y1, z0, z1, bev=0.03)
    b.box('paint', x0 - 0.02, x1 + 0.02, y1 - 0.06, y1, z0 - 0.02, z1 + 0.02)             # roof lip
    for sx in (-1, 1):
        x = x1 if sx > 0 else x0
        vkit.louvres(b, x, 3.2, 3.6, 0.55, 2.1, 6, side=sx)
        usfam.hatch_x(b, x, sx, 2.1, 3.1, 0.4, 1.3, hinge='front')
        usfam.hatch_x(b, x, sx, 2.1, 3.1, 1.35, 2.25, hinge='back')
        for z in (0.3, 2.34):
            b.cyl('dark', (x + sx * 0.02, y1 - 0.05, z), (x + sx * 0.06, y1 - 0.05, z), 0.04, 0.04, 6)   # lifting eyes
    # front face: control-panel doors, data plate
    usfam.panel_lines(b, [(-0.95, 2.15, z0), (0.95, 2.15, z0), (0.95, 3.5, z0), (-0.95, 3.5, z0)], (0, 0, -1))
    usfam.panel_lines(b, [(0.0, 2.15, z0), (0.0, 3.5, z0)], (0, 0, -1))
    for x in (-0.12, 0.12):
        vkit.grab_handle(b, (x, 2.85, z0 - 0.01), (0, 1, 0), (0, 0, -1), 0.18, 0.03, 'dark')
    usfam.stencil_box(b, (-0.5, 3.3, z0), 0.35, 0.12, (0, 0, -1))
    # rear face: radiator louvres
    b.panel('vents', [(x1 - 0.1, 2.3, z1), (x0 + 0.1, 2.3, z1), (x0 + 0.1, 3.5, z1), (x1 - 0.1, 3.5, z1)], (0, 0, 1), off=0.004)
    # exhaust on the roof, fuel filler
    b.cyl('dark', (0.7, y1, 1.9), (0.7, y1 + 0.35, 1.9), 0.06, 0.06, 8)
    b.cyl('soot', (0.7, y1 + 0.35, 1.9), (0.7, y1 + 0.38, 1.9), 0.065, 0.065, 8)
    b.empty('exhaust', (0.7, y1 + 0.38, 1.9), (0, 1, 0))
    b.cyl('dark', (-0.8, y1, 0.6), (-0.8, y1 + 0.08, 0.6), 0.07, 0.07, 10)
    # generator fuel tank under the gooseneck
    b.cyl('paint', (0.55, M860['neck_bot'] - 0.2, 0.35), (0.55, M860['neck_bot'] - 0.2, 1.1), 0.18, 0.18, 14)


def build_deck(b):
    yd = M860['deck']
    # tread-plate walkways on the deck
    for (x0, x1, z0, z1) in ((-1.2, -0.66, 6.0, 10.3), (0.66, 1.2, 6.0, 10.3), (-1.2, 1.2, 3.35, 3.95)):
        b.panel('tread_plate', [(x0, yd, z0), (x1, yd, z0), (x1, yd, z1), (x0, yd, z1)], (0, 1, 0), off=0.004)
    # launcher station electronics module (under the stowed rack, right side) and the equipment box below the deck
    b.box('paint', 0.3, 1.18, yd, 1.84, 4.0, 5.9, bev=0.03)
    usfam.hatch_x(b, 1.18, 1, yd + 0.05, 1.8, 4.1, 4.95)
    usfam.hatch_x(b, 1.18, 1, yd + 0.05, 1.8, 5.0, 5.8, hinge='back')
    usfam.stencil_box(b, (1.181, 1.72, 5.4), 0.4, 0.07, (1, 0, 0))
    b.box('paint', 0.62, 1.2, 0.72, yd - 0.26, 5.35, 6.95, bev=0.02)
    usfam.hatch_x(b, 1.2, 1, 0.76, yd - 0.3, 5.45, 6.85)
    # left side: cable reels on the deck and a tool box below
    for z in (4.35, 5.25):
        b.cyl('dark', (-1.15, 1.72, z), (-0.35, 1.72, z), 0.34, 0.34, 18)
        b.cyl('paint', (-1.18, 1.72, z), (-1.12, 1.72, z), 0.4, 0.4, 18)
        b.cyl('paint', (-0.38, 1.72, z), (-0.32, 1.72, z), 0.4, 0.4, 18)
        b.box('paint', -1.2, -0.3, yd, yd + 0.05, z - 0.3, z + 0.3)
    b.box('paint', -1.2, -0.62, 0.74, yd - 0.26, 6.3, 7.6, bev=0.02)
    usfam.hatch_x(b, -1.2, -1, 0.78, yd - 0.3, 6.4, 7.5)
    # travel lock posts that cradle the rack's front
    for sx in (-1, 1):
        b.box('paint', sx * 0.35, sx * 0.55, yd, RACK['y0'] - 0.01, 3.45, 3.7)
        b.box('dark', sx * 0.3, sx * 0.6, RACK['y0'] - 0.06, RACK['y0'] - 0.01, 3.4, 3.75)
    # fire extinguisher, step ladder and handrail at the rear left
    b.cyl('red', (-1.26, 0.9, 7.9), (-1.26, 1.25, 7.9), 0.07, 0.07, 10)
    vkit.ladder(b, -1.25, 0.25, yd, 10.05, 10.35, rungs=3)
    vkit.handrail(b, [(-1.2, yd, 9.9), (-1.2, yd + 0.9, 9.95), (-1.2, yd + 0.9, 10.35), (-1.2, yd, 10.4)], 0.018, 'dark')
    # stencils on the side rails (unit markings, weight)
    for sx in (-1, 1):
        usfam.stencil_box(b, (sx * 1.221, yd - 0.13, 8.9), 0.6, 0.07, (sx, 0, 0))
    b.empty('hatch_entry', (-1.6, 0.0, 10.2), (1, 0, 0))     # the boarding ladder at the rear left


def make():
    vkit.setup_materials('blue_tan')
    v = Vehicle('patriot_ln', 'M903 launching station (MIM-104 Patriot) on the M860A1 semi-trailer', scheme='blue_tan')
    b = Part(v, 'body')
    usfam.m860_trailer(v, b)
    build_generator(b)
    build_deck(b)
    tur = build_turret(v)
    lau = build_launcher(v, tur)
    # elevation rams: from the turret's front arms up to the rack's underside
    for sx, n in ((-1, 'ram_l'), (1, 'ram_r')):
        vkit.ram(v, n, tur, (sx * 0.63, M860['deck'] + 0.3, 7.45), lau, (sx * 0.63, RACK['y0'] - 0.06, 6.5), r=0.085)
    return v
