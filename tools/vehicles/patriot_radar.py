# ═══════════════════════════════════════════════════════════════
# AN/MPQ-65 radar set (MIM-104 Patriot) on its M860 semi-trailer, standing on its landing gear (unhitched).
#   blender -b -P tools/vehicles/build.py -- patriot_radar
# The shelter on the deck and the passive phased-array antenna: main circular array, the IFF interrogator strip,
# the sidelobe-canceller and track-via-missile arrays. In travel the antenna lies face-up on the shelter roof,
# overhanging the gooseneck; emplaced it swings up about a hinge at the shelter's front to lean back about 18°.
# References: JASDF radar sets (Wikimedia Commons: right side view, left front view, in travel behind a Fuso tractor;
# CC BY-SA 4.0) and German / Dutch MPQ-53 photos (reference only): shelter ~5.8 × 2.4 × 2.1 m on the deck, antenna
# face ~2.75 × 4.2 m, bottom edge ~2.1 m and top ~6.1 m above the ground when emplaced.
# Rig: mast (the antenna, rot about −x 0 → 71.6°, group 'raise'), outrigger_fl/fr/rl/rr + jack_fl/fr/rl/rr
# (group 'jack'), landing_gear (group 'gear'), kingpin.
# ═══════════════════════════════════════════════════════════════
import math
from mathutils import Vector
import vkit
from vkit import Vehicle, Part, rot, slide, lerp
import usfam
from usfam import M860

HINGE = Vector((0.0, 3.85, 3.95))
TILT = math.radians(18.4)             # operating lean back from vertical
RAISE = math.pi / 2 - TILT            # travel (flat) → operating
SH = {'z0': 4.10, 'z1': 9.90, 'y0': M860['deck'] + 0.15, 'y1': 3.55, 'hw': 1.22}


def build_shelter(b):
    z0, z1, y0, y1, hw = SH['z0'], SH['z1'], SH['y0'], SH['y1'], SH['hw']
    b.box('paint', -hw, hw, y0, y1, z0, z1, bev=0.035)
    b.box('dark', -hw + 0.1, hw - 0.1, M860['deck'], y0, z0 + 0.1, z1 - 0.1)        # skids / mounting frame
    # vertical reinforcing ribs on the sides, roof edge trim
    for sx in (-1, 1):
        x = sx * hw
        for z in (4.9, 6.1, 7.3, 8.5, 9.4):
            b.box('paint', min(x, x + sx * 0.03), max(x, x + sx * 0.03), y0 + 0.05, y1 - 0.05, z - 0.04, z + 0.04)
        # the big angled vent flaps (open), near the front half
        for (za, zb) in ((4.35, 4.95), (5.15, 5.75)):
            yb, yt = 2.05, 3.2
            b.face([(x, yb, za), (x + sx * 0.02, yb, zb), (x + sx * 0.45, yt, zb), (x + sx * 0.45, yt, za)], 'paint', want=(sx, -0.3, 0))
            b.face([(x, yb, za), (x + sx * 0.45, yt, za), (x + sx * 0.45, yt, zb), (x + sx * 0.02, yb, zb)], 'paint', want=(-sx, 0.3, 0))
            b.face([(x + sx * 0.45, yt, za), (x, yt, za), (x, yb, za)], 'paint', want=(0, 0, -1))
            b.face([(x + sx * 0.45, yt, zb), (x, yb, zb), (x, yt, zb)], 'paint', want=(0, 0, 1))
            b.panel('vents', [(x, yb + 0.05, za + 0.05), (x, yb + 0.05, zb - 0.05), (x, yt - 0.05, zb - 0.05), (x, yt - 0.05, za + 0.05)], (sx, 0, 0), off=0.002)
        # doors and access panels, cooling grilles, placards
        usfam.hatch_x(b, x, sx, y0 + 0.1, y1 - 0.25, 6.2, 7.15)
        usfam.hatch_x(b, x, sx, y0 + 0.1, y1 - 0.25, 7.2, 8.15, hinge='back')
        usfam.hatch_x(b, x, sx, y0 + 0.1, 2.5, 8.6, 9.3, handle=True)
        b.panel('vents', [(x, 2.75, 8.55), (x, 2.75, 9.35), (x, 3.3, 9.35), (x, 3.3, 8.55)], (sx, 0, 0), off=0.003, frame=0.03, frame_skin='dark')
        for (yy, zz) in ((2.9, 6.6), (2.3, 6.6), (2.9, 7.7)):
            b.panel('dark', [(x, yy - 0.1, zz - 0.1), (x, yy - 0.1, zz + 0.1), (x, yy + 0.1, zz + 0.1), (x, yy + 0.1, zz - 0.1)], (sx, 0, 0), off=0.004)
        # hazard diamond and a yellow warning label
        c = Vector((x + sx * 0.005, 2.35, 8.0))
        b.panel('red', [c + Vector((0, -0.16, 0)), c + Vector((0, 0, 0.16)), c + Vector((0, 0.16, 0)), c + Vector((0, 0, -0.16))], (sx, 0, 0), off=0.005)
        b.panel('yellow', [(x, 2.3, 5.3), (x, 2.3, 5.55), (x, 2.48, 5.55), (x, 2.48, 5.3)], (sx, 0, 0), off=0.005)
        # cable entry boxes low on the sides and the heavy data / power cables looping to the ground
        b.box('dark', min(x, x + sx * 0.12), max(x, x + sx * 0.12), y0 + 0.05, y0 + 0.35, 6.6, 7.3)
    for k, z in enumerate((6.75, 6.95, 7.15)):
        xg = 1.36 + 0.07 * k
        b.tube('cable', [(1.34, SH['y0'] + 0.15, z), (1.4 + 0.02 * k, 1.05, z + 0.02), (xg, 0.3, z + 0.1), (xg, 0.04, z + 0.45),
                         (xg + 0.03, 0.04, z + 1.4), (xg, 0.04, z + 2.6 + 0.3 * k)], 0.035, 6)
    # roof: equipment box at the rear, handrails, the antenna rest pads at the front
    b.box('paint', -1.05, 1.05, y1, y1 + 0.42, 7.07, 8.82, bev=0.03)
    b.panel('vents', [(-0.9, y1 + 0.42, 7.3), (0.9, y1 + 0.42, 7.3), (0.9, y1 + 0.42, 8.6), (-0.9, y1 + 0.42, 8.6)], (0, 1, 0), off=0.004)
    for sx in (-1, 1):
        vkit.handrail(b, [(sx * 1.15, y1, 8.9), (sx * 1.15, y1 + 0.45, 8.95), (sx * 1.15, y1 + 0.45, 9.8), (sx * 1.15, y1, 9.85)], 0.016, 'dark')
        b.box('rubber', sx * 0.85, sx * 1.05, y1, y1 + 0.08, 5.9, 6.1)
    # front face: the hinge brackets for the antenna, a door
    usfam.panel_lines(b, [(-0.6, y0 + 0.1, z0), (0.6, y0 + 0.1, z0), (0.6, 3.0, z0), (-0.6, 3.0, z0)], (0, 0, -1))
    for sx in (-1, 1):
        b.box('paint', sx * 1.02, sx * 1.22, 2.9, HINGE.y + 0.12, z0 - 0.25, z0 + 0.05)
        b.cyl('dark', (sx * 1.24, HINGE.y, HINGE.z), (sx * 1.02, HINGE.y, HINGE.z), 0.1, 0.1, 12)
    # rear face: air-conditioner grilles, ladder
    b.panel('vents', [(0.2, 2.0, z1), (1.0, 2.0, z1), (1.0, 3.2, z1), (0.2, 3.2, z1)], (0, 0, 1), off=0.004, frame=0.03, frame_skin='dark')
    b.panel('vents', [(-1.0, 2.6, z1), (-0.2, 2.6, z1), (-0.2, 3.2, z1), (-1.0, 3.2, z1)], (0, 0, 1), off=0.004, frame=0.03, frame_skin='dark')
    vkit.ladder(b, -0.95, M860['deck'], SH['y1'] - 0.05, z1 + 0.05, z1 + 0.1, rungs=6)
    b.cyl('dark', (-1.18, 2.4, z1 + 0.05), (-1.18, 3.7, z1 + 0.05), 0.02, 0.02, 6)
    # cable reels at the front of the deck and on the rear frame
    for (x0, x1, z, y) in ((-1.1, -0.4, 3.75, 2.0), (0.4, 1.1, 3.75, 2.0)):
        b.cyl('dark', (x0, y, z), (x1, y, z), 0.33, 0.33, 16)
        b.cyl('paint', (x0 - 0.03, y, z), (x0 + 0.02, y, z), 0.42, 0.42, 16)
        b.cyl('paint', (x1 - 0.02, y, z), (x1 + 0.03, y, z), 0.42, 0.42, 16)
        b.box('paint', x0, x1, M860['deck'], y - 0.3, z - 0.2, z + 0.2)
    b.empty('hatch_entry', (-1.3, 0.0, 9.95), (1, 0, 0))


def build_antenna(v):
    """the phased-array antenna as node `mast`, modelled in its operating tilt and turned flat for travel"""
    a = Part(v, 'mast', pivot=tuple(HINGE), joint=rot('-x', 0.0, RAISE, stow=0.0, deploy=RAISE, group='raise'))
    u = Vector((0, math.cos(TILT), math.sin(TILT)))        # up the face (bottom → top)
    n = Vector((0, math.sin(TILT), -math.cos(TILT)))       # face normal (forward, a little up)
    ex = Vector((1, 0, 0))
    W, below, above, off, depth = 2.75, 1.9, 2.3, 0.24, 0.34

    def P(x, s, d=0.0):
        """a point x across, s up the face from the hinge line, d in front of the face plane"""
        return HINGE + ex * x + u * s + n * (off + d)
    hw = W / 2
    # the antenna body: a slab from the face back to the back plate (the hinge sits inside it)
    corners_f = [P(-hw, -below), P(hw, -below), P(hw, above), P(-hw, above)]
    corners_b = [P(-hw, -below, -depth), P(hw, -below, -depth), P(hw, above, -depth), P(-hw, above, -depth)]
    a.face([tuple(p) for p in corners_f], 'paint', want=tuple(n))
    a.face([tuple(p) for p in corners_b], 'paint', want=tuple(-n))
    for i in range(4):
        j = (i + 1) % 4
        out = (corners_f[i] + corners_f[j]) / 2 - (corners_f[0] + corners_f[2]) / 2
        a.face([tuple(corners_f[i]), tuple(corners_b[i]), tuple(corners_b[j]), tuple(corners_f[j])], 'paint', want=tuple(out))
    # raised frame around the face
    for (x0, s0, x1, s1) in ((-hw, -below, hw, -below + 0.1), (-hw, above - 0.1, hw, above), (-hw, -below, -hw + 0.1, above), (hw - 0.1, -below, hw, above)):
        q = [P(x0, s0, 0.03), P(x1, s0, 0.03), P(x1, s1, 0.03), P(x0, s1, 0.03)]
        a.face([tuple(p) for p in q], 'paint', want=tuple(n))
    # main array: a big circle of radiating elements (radar_face with a ring)
    cs = above - 1.2                      # centre, measured up from the hinge line
    R = 1.12
    seg = 40
    ring = [P(R * math.cos(2 * math.pi * k / seg), cs + R * math.sin(2 * math.pi * k / seg), 0.02) for k in range(seg)]
    a.face([tuple(p) for p in ring], 'radar_face', want=tuple(n))
    ring2 = [P((R + 0.05) * math.cos(2 * math.pi * k / seg), cs + (R + 0.05) * math.sin(2 * math.pi * k / seg), 0.012) for k in range(seg)]
    a.face([tuple(p) for p in ring2], 'dark', want=tuple(n))
    # element rows across the circle (fine grooves)
    for k in range(-7, 8):
        s = cs + k * 0.14
        hwk = math.sqrt(max(0.0, R * R - (k * 0.14) ** 2)) - 0.04
        if hwk > 0.1:
            a.face([tuple(P(-hwk, s - 0.006, 0.024)), tuple(P(hwk, s - 0.006, 0.024)), tuple(P(hwk, s + 0.006, 0.024)), tuple(P(-hwk, s + 0.006, 0.024))], 'darkgrey', want=tuple(n))
    # IFF interrogator strip below the circle: a row of small boxes
    sI = cs - R - 0.22
    a.box  # (keep the kit's box for axis-aligned parts; these are on a tilted face so they are built as quads)
    for k in range(18):
        x = lerp(-hw + 0.22, hw - 0.22, k / 17)
        q = [P(x - 0.055, sI - 0.12, 0.05), P(x + 0.055, sI - 0.12, 0.05), P(x + 0.055, sI + 0.12, 0.05), P(x - 0.055, sI + 0.12, 0.05)]
        a.face([tuple(p) for p in q], 'radar_face', want=tuple(n))
    a.face([tuple(P(-hw + 0.12, sI - 0.16, 0.02)), tuple(P(hw - 0.12, sI - 0.16, 0.02)), tuple(P(hw - 0.12, sI + 0.16, 0.02)), tuple(P(-hw + 0.12, sI + 0.16, 0.02))], 'darkgrey', want=tuple(n))
    # vertical panels (below the IFF strip)
    sP = sI - 0.62
    for k in range(9):
        x = lerp(-hw + 0.3, hw - 0.3, k / 8)
        q = [P(x - 0.1, sP - 0.28, 0.035), P(x + 0.1, sP - 0.28, 0.035), P(x + 0.1, sP + 0.28, 0.035), P(x - 0.1, sP + 0.28, 0.035)]
        a.face([tuple(p) for p in q], 'paint', want=tuple(n))
        usfam.panel_lines(a, [P(x - 0.1, sP - 0.28, 0.036), P(x + 0.1, sP - 0.28, 0.036), P(x + 0.1, sP + 0.28, 0.036), P(x - 0.1, sP + 0.28, 0.036)], n, 0.008)
    # the sidelobe-canceller arrays (5 small discs) and the track-via-missile array (a larger disc, lower right)
    sC = -below + 0.32
    for k in range(5):
        x = -hw + 0.4 + k * 0.36
        c = [P(x + 0.13 * math.cos(2 * math.pi * q / 14), sC + 0.13 * math.sin(2 * math.pi * q / 14), 0.03) for q in range(14)]
        a.face([tuple(p) for p in c], 'radar_face', want=tuple(n))
    c = [P(hw - 0.45 + 0.24 * math.cos(2 * math.pi * q / 20), sC + 0.12 + 0.24 * math.sin(2 * math.pi * q / 20), 0.03) for q in range(20)]
    a.face([tuple(p) for p in c], 'radar_face', want=tuple(n))
    # corner blocks at the top
    for sx in (-1, 1):
        q = [P(sx * (hw - 0.38), above - 0.33, 0.05), P(sx * (hw - 0.12), above - 0.33, 0.05), P(sx * (hw - 0.12), above - 0.12, 0.05), P(sx * (hw - 0.38), above - 0.12, 0.05)]
        a.face([tuple(p) for p in q], 'paint', want=tuple(n))
    # back: ribs and the hinge knuckle, stiffening frame
    for s in (-below + 0.3, -0.2, 0.9, above - 0.3):
        a.beam('paint', P(-hw + 0.1, s, -depth - 0.05), P(hw - 0.1, s, -depth - 0.05), 0.1, 0.1, up=tuple(n))
    for x in (-hw + 0.3, 0.0, hw - 0.3):
        a.beam('paint', P(x, -below + 0.2, -depth - 0.05), P(x, above - 0.2, -depth - 0.05), 0.08, 0.08, up=tuple(n))
    a.cyl('dark', HINGE + ex * -1.0, HINGE + ex * 1.0, 0.09, 0.09, 12)
    # waveguide / cable run down the back into the shelter
    a.tube('cable', [P(0.4, -below + 0.1, -depth - 0.02), HINGE + Vector((0.4, -0.3, 0.1)), HINGE + Vector((0.4, -0.5, 0.35))], 0.04, 6)
    # turn it flat (face up) for travel
    a.rotate_about(tuple(HINGE), (-1, 0, 0), -RAISE)
    return a


def make():
    vkit.setup_materials('blue_tan')
    v = Vehicle('patriot_radar', 'AN/MPQ-65 radar set (MIM-104 Patriot) on the M860 semi-trailer', scheme='blue_tan')
    b = Part(v, 'body')
    usfam.m860_trailer(v, b)
    build_shelter(b)
    build_antenna(v)
    return v
