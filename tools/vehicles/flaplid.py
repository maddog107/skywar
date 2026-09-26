# ═══════════════════════════════════════════════════════════════
# 30N6E (NATO "Flap Lid B") engagement / illumination radar of the S-300PMU on the MAZ-7910, with its antenna post on
# a raisable telescopic mast.
#   blender -b -P tools/vehicles/build.py -- flaplid
# References: the MAZ-7910 (543M layout with the tall air-intake box over the front-right engine bay) and the long
# operator cabin from the 30N6E rail-transport and MAKS 2009 photos; the post (a boxy rotating cabin with the large
# flat phased array hinged on it, leaning back when raised, a small auxiliary dish on its side) from the 30N6
# "Flap Lid" museum photos on its mast (Wikimedia Commons). Array about 3.2 × 2.9 m.
# Rig: mast (the telescopic mast, slide up 2.2 m, group 'raise'; mast_s1 the middle stage, 1.1 m), turret (the post,
# rot y, full circle, child of the mast), array (the phased array, rot x about its hinge on the post's front edge,
# 0 → 105°: folded face-down over the cabin roof → leaning back 15° past vertical, group 'raise'), jack_fl/fr/rl/rr,
# 8 wheels, exhaust, seat_driver, hatch_entry.
# ═══════════════════════════════════════════════════════════════
import math
from mathutils import Vector
import vkit
from vkit import Vehicle, Part, rot, slide, lerp
import chassis
from chassis import MAZM

POST = (0.0, 9.55)          # post axis (x, z)
DECK = MAZM['deck']
EXT = 2.2                   # mast extension
Y_TOP = 2.42                # collapsed mast top (the post's floor)
POST_H = 0.92
HINGE = (0.0, Y_TOP + POST_H, POST[1] - 0.72)
ARR_W, ARR_L, ARR_T = 3.2, 2.9, 0.22
CAB_Z0, CAB_Z1, CAB_Y = 2.98, 7.55, 3.30


def build_cabin(b):
    """the operator cabin behind the cabs: a long box with bevelled roof edges, doors, louvres, AC units"""
    b.box('paint', -1.48, 1.48, DECK, CAB_Y, CAB_Z0, CAB_Z1, bev=0.06)
    # fill the gap behind the engine bay on the right, under the cabin front
    b.box('paint', -0.45, 1.48, DECK - 0.1, DECK, 2.62, CAB_Z0)
    # front face: two air-conditioning units and a cable junction box above the cabs
    for x0, x1 in ((-1.2, -0.55), (0.35, 1.2)):
        b.box('paint', x0, x1, 2.95, CAB_Y - 0.08, CAB_Z0 - 0.3, CAB_Z0, bev=0.03)
        b.panel('mesh', [(x0 + 0.06, 3.0, CAB_Z0 - 0.3), (x1 - 0.06, 3.0, CAB_Z0 - 0.3), (x1 - 0.06, CAB_Y - 0.14, CAB_Z0 - 0.3), (x0 + 0.06, CAB_Y - 0.14, CAB_Z0 - 0.3)], (0, 0, -1), off=0.003)
    for sx in (-1, 1):
        xo = sx * 1.48
        # rows of rivet-line panels, cooling louvres, an access hatch
        for z0, z1 in ((3.1, 4.3), (4.35, 5.55), (5.6, 6.5)):
            chassis.panel_lines(b, xo, sx, (z0, z1, DECK + 0.1, CAB_Y - 0.12), w=0.008)
        vkit.louvres(b, xo, 2.55, 3.05, 4.5, 5.4, 6, side=sx)
        vkit.louvres(b, xo, 1.85, 2.25, 3.3, 4.1, 5, side=sx)
        vkit.grab_handle(b, (xo + sx * 0.01, 2.2, 5.45), (0, 1, 0), (sx, 0, 0), 0.16, 0.03, 'dark')
    # the crew door with its folding ladder at the left rear, a small window beside it
    chassis.panel_lines(b, -1.48, -1, (6.62, 7.36, DECK + 0.08, 3.12))
    vkit.grab_handle(b, (-1.49, 2.4, 7.22), (0, 1, 0), (-1, 0, 0), 0.2, 0.03, 'dark')
    b.panel('glass', [(-1.48, 2.6, 6.72), (-1.48, 2.6, 6.98), (-1.48, 2.95, 6.98), (-1.48, 2.95, 6.72)], (-1, 0, 0), off=0.006, frame=0.03)
    vkit.ladder(b, -1.62, 0.55, DECK, 6.72, 7.26, rungs=4)
    # roof: handrails, a hatch, the vent fans
    for sx in (-1, 1):
        b.tube('dark', [(sx * 1.36, CAB_Y, 3.3), (sx * 1.36, CAB_Y + 0.28, 3.4), (sx * 1.36, CAB_Y + 0.28, 5.8), (sx * 1.36, CAB_Y, 5.9)], 0.018, 5)
    b.panel('paint', [(-0.4, CAB_Y, 3.4), (0.4, CAB_Y, 3.4), (0.4, CAB_Y, 4.1), (-0.4, CAB_Y, 4.1)], (0, 1, 0), off=0.02, frame=0.03, frame_skin='dark')
    for z in (4.6, 5.3):
        b.cyl('dark', (0.0, CAB_Y, z), (0.0, CAB_Y + 0.12, z), 0.22, 0.2, 14)
        b.disc('mesh', (0.0, CAB_Y + 0.121, z), (0, 1, 0), 0.19, 14)


def build_post_base(b):
    """turntable ring on the rear deck and the mast's outer tube (static)"""
    x, z = POST
    b.cyl('paint', (x, DECK, z), (x, DECK + 0.18, z), 0.85, 0.85, 20)
    b.cyl('dark', (x, DECK + 0.18, z), (x, DECK + 0.22, z), 0.8, 0.78, 20, cap0=False)
    # the outer tube runs down between the frame rails: the stages are longer than the collapsed mast
    b.cyl('paint', (x, 0.92, z), (x, Y_TOP - 0.02, z), 0.34, 0.34, 16, cap1=False)
    b.cyl('dark', (x, Y_TOP - 0.08, z), (x, Y_TOP - 0.02, z), 0.37, 0.37, 16)
    # bracing gussets to the ring
    for k in range(4):
        a = math.radians(45 + 90 * k)
        d = Vector((math.cos(a), 0, math.sin(a)))
        p0 = Vector((x, DECK + 0.22, z)) + d * 0.7
        p1 = Vector((x, DECK + 0.62, z)) + d * 0.36
        b.beam('paint', p0, p1, 0.08, 0.08)


def build_mast(v):
    x, z = POST
    s1 = Part(v, 'mast_s1', pivot=(x, Y_TOP, z), joint=slide('y', EXT / 2, group='raise'))
    s1.cyl('paint', (x, 0.97, z), (x, Y_TOP + 0.02, z), 0.3, 0.3, 16, cap0=False)
    s1.cyl('dark', (x, Y_TOP - 0.04, z), (x, Y_TOP + 0.02, z), 0.33, 0.33, 16)
    m = Part(v, 'mast', pivot=(x, Y_TOP, z), joint=slide('y', EXT, group='raise'))
    m.cyl('paint', (x, 1.02, z), (x, Y_TOP + 0.06, z), 0.26, 0.26, 16, cap0=False)
    m.cyl('dark', (x, Y_TOP + 0.02, z), (x, Y_TOP + 0.08, z), 0.5, 0.5, 18)       # top plate / slew bearing
    return m


def build_post(v, mast):
    x, z = POST
    t = Part(v, 'turret', pivot=(x, Y_TOP + 0.08, z), parent=mast, joint=rot('y', -math.pi, math.pi, stow=0.0, deploy=0.0, group='turret'))
    y0, y1 = Y_TOP + 0.08, Y_TOP + POST_H
    zf, zb = z - 0.72, z + 0.78
    # the post cabin: bevelled box, a skirt, panel lines and hatches
    t.box('paint', -0.98, 0.98, y0 + 0.08, y1, zf, zb, bev=0.05)
    t.box('dark', -0.9, 0.9, y0, y0 + 0.08, zf + 0.08, zb - 0.08)
    for sx in (-1, 1):
        chassis.panel_lines(t, sx * 0.98, sx, (zf + 0.15, z - 0.02, y0 + 0.2, y1 - 0.12), w=0.008)
        chassis.panel_lines(t, sx * 0.98, sx, (z + 0.04, zb - 0.15, y0 + 0.2, y1 - 0.12), w=0.008)
    # auxiliary horn / dish cluster on the right side, a boarding step and rail on the left
    t.cyl('dark', (0.98, y0 + 0.5, z + 0.3), (1.12, y0 + 0.5, z + 0.3), 0.12, 0.12, 10)
    t.lathe((1.12, y0 + 0.5, z + 0.3), (1, 0, 0), [(0.0, 0.1, 'radar_face'), (0.12, 0.3, 'radar_face'), (0.12, 0.0, 'dark')], n=14, smooth=False)
    t.tube('dark', [(-0.98, y1, zb - 0.1), (-1.08, y1 + 0.35, zb - 0.1), (-1.08, y1 + 0.35, z - 0.2), (-0.98, y1, z - 0.2)], 0.016, 5)
    # hinge brackets for the array on the front top edge
    hx, hy, hz = HINGE
    for sx in (-1, 1):
        t.box('dark', sx * 1.1, sx * 1.38, hy - 0.18, hy + 0.06, hz - 0.1, hz + 0.16)
        # the tilt rams' lower eyes (the rams themselves are drawn on the array's back)
        t.cyl('dark', (sx * 1.0, y1 - 0.05, z + 0.35), (sx * 1.18, y1 - 0.05, z + 0.35), 0.06, 0.06, 8)
    t.cyl('dark', (-1.38, hy, hz), (1.38, hy, hz), 0.06, 0.06, 10)
    return t


def build_array(v, turret):
    """the phased array: modelled standing (operating, leaning back 15°), then turned to the folded travel pose"""
    hx, hy, hz = HINGE
    a = Part(v, 'array', pivot=HINGE, parent=turret, joint=rot('x', 0.0, math.radians(105), group='raise'))
    # build it folded (lying flat forward of the hinge, face down): x across, z forward from the hinge
    w, L, T = ARR_W, ARR_L, ARR_T
    z0, z1 = hz - L, hz
    y0, y1 = hy + 0.02, hy + 0.02 + T
    a.box('paint', -w / 2, w / 2, y0, y1, z0, z1, bev=0.05, skins={'bottom': 'radar_face'})
    # the radiating face (bottom when folded): a grid of feed elements in a frame
    a.panel('mesh', [(-w / 2 + 0.12, y0, z0 + 0.12), (w / 2 - 0.12, y0, z0 + 0.12), (w / 2 - 0.12, y0, z1 - 0.12), (-w / 2 + 0.12, y0, z1 - 0.12)], (0, -1, 0), off=0.004)
    # the back (top when folded): stiffening ribs, the tilt-ram brackets, handles, a data cable run
    for k in range(5):
        x = lerp(-w / 2 + 0.3, w / 2 - 0.3, k / 4)
        a.box('paint', x - 0.04, x + 0.04, y1, y1 + 0.08, z0 + 0.1, z1 - 0.1)
    for zz in (z0 + 0.6, z0 + 1.6):
        a.box('paint', -w / 2 + 0.1, w / 2 - 0.1, y1, y1 + 0.06, zz - 0.04, zz + 0.04)
    for sx in (-1, 1):
        a.box('dark', sx * 1.0 - 0.07, sx * 1.0 + 0.07, y1, y1 + 0.14, z1 - 1.25, z1 - 1.05)
        vkit.grab_handle(a, (sx * (w / 2 - 0.02), (y0 + y1) / 2, z0 + 0.5), (0, 0, 1), (sx, 0, 0), 0.2, 0.03, 'dark')
    a.tube('cable', [(0.3, y1 + 0.03, z1 - 0.1), (0.3, y1 + 0.03, z0 + 1.2), (0.6, y1 + 0.03, z0 + 0.8)], 0.025, 5)
    # a small rim of the hinge knuckles
    for sx in (-1, 1):
        a.cyl('dark', (sx * 1.1, hy, hz), (sx * 1.38, hy, hz), 0.09, 0.09, 10)
    return a


def build_jack(v, name, x, z, top, foot=0.52):
    j = Part(v, name, pivot=(x, top, z), joint=slide('-y', foot, group='jack'))
    j.cyl('steel', (x, foot + 0.07, z), (x, top - 0.05, z), 0.07, 0.07, 10)
    j.cyl('dark', (x, foot, z), (x, foot + 0.07, z), 0.24, 0.22, 14)
    j.cyl('dark', (x, foot + 0.07, z), (x, foot + 0.14, z), 0.11, 0.09, 10)
    return j


def build_body(v, b):
    lay = chassis.maz543m(v, b, right=None, intake=True)
    zr = MAZM['len']
    build_cabin(b)
    # rear deck, the post base, jacks' housings, lamps, rear beam
    b.box('paint', -1.45, 1.45, DECK - 0.1, DECK, CAB_Z1, zr - 0.02)
    b.panel('tread_plate', [(-1.3, DECK, CAB_Z1 + 0.1), (1.3, DECK, CAB_Z1 + 0.1), (1.3, DECK, zr - 0.3), (-1.3, DECK, zr - 0.3)], (0, 1, 0), off=0.003)
    build_post_base(b)
    for sx in (-1, 1):
        xo = sx * 1.45
        for (z0, z1) in ((5.86, 6.46), (6.94, 7.56)):
            b.box('paint', sx * 1.02, sx * 1.50, 0.95, DECK - 0.1, z0, z1, bev=0.02)
            vkit.grab_handle(b, (sx * 1.505, 1.25, (z0 + z1) / 2), (0, 0, 1), (sx, 0, 0), 0.2, 0.03, 'dark')
        for z, y1 in ((6.70, DECK), (11.42, 1.80)):
            b.cyl('paint', (sx * (1.33 if z < 8 else 1.30), 0.95, z), (sx * (1.33 if z < 8 else 1.30), y1, z), 0.1, 0.1, 12)
            b.box('dark', sx * 0.56, sx * (1.23 if z < 8 else 1.2), y1 - 0.14, y1 - 0.02, z - 0.09, z + 0.09)
        # deck rails round the post
        for z in (7.9, 9.5, 11.2):
            b.cyl('dark', (xo, DECK, z), (xo, DECK + 0.9, z), 0.022, 0.022, 6)
        b.tube('dark', [(xo, DECK + 0.9, 7.9), (xo, DECK + 0.9, 11.2)], 0.02, 5)
        b.tube('dark', [(xo, DECK + 0.5, 7.9), (xo, DECK + 0.5, 11.2)], 0.016, 5)
        vkit.lamp_box(b, (sx * 1.25, 1.35, zr + 0.02), (0.22, 0.1, 0.06), (0, 0, 1), lens='lens_red')
        vkit.lamp_box(b, (sx * 1.25, 1.22, zr + 0.02), (0.1, 0.08, 0.06), (0, 0, 1), lens='lens_amber')
    b.box('paint', -1.45, 1.45, 1.05, 1.45, zr - 0.35, zr, bev=0.02)
    b.box('dark', -0.12, 0.12, 1.00, 1.18, zr, zr + 0.18)
    b.panel('white', [(-0.26, 1.2, zr), (0.26, 1.2, zr), (0.26, 1.36, zr), (-0.26, 1.36, zr)], (0, 0, 1), off=0.004)
    # a cable drum and a generator box on the rear deck
    b.cyl('dark', (0.8, DECK + 0.42, 11.0), (1.2, DECK + 0.42, 11.0), 0.4, 0.4, 14)
    b.cyl('cable', (0.83, DECK + 0.42, 11.0), (1.17, DECK + 0.42, 11.0), 0.36, 0.36, 14)
    b.box('paint', -1.25, -0.55, DECK, DECK + 0.7, 10.6, 11.4, bev=0.03)
    vkit.louvres(b, -1.25, DECK + 0.2, DECK + 0.6, 10.7, 11.3, 4, side=-1)
    # right mirror on the intake box, antennas, searchlight
    vkit.mirror(b, (1.46, 2.7, 1.7), (1.72, 2.62, 1.45), (0.18, 0.28))
    vkit.whip_antenna(b, (-1.35, 2.92, 2.75), h=2.2)
    vkit.whip_antenna(b, (1.3, CAB_Y, 7.3), h=2.6)
    b.cyl('dark', (-0.75, 2.92, 1.0), (-0.75, 3.22, 1.0), 0.025, 0.025, 6)
    b.cyl('dark', (-0.75, 3.22, 1.05), (-0.75, 3.22, 0.87), 0.12, 0.11, 12)
    b.disc('lens', (-0.75, 3.22, 0.865), (0, 0, -1), 0.1, 12)
    # engine exhaust behind the intake box
    b.cyl('dark', (0.2, 2.28, 2.5), (0.2, 3.1, 2.5), 0.075, 0.075, 8)
    b.cyl('soot', (0.2, 3.1, 2.5), (0.2, 3.14, 2.5), 0.08, 0.08, 8)
    b.empty('exhaust', (0.2, 3.14, 2.5), (0, 1, 0))
    b.tube('steel', [(-0.9, 1.3, -0.02), (-0.5, 1.12, -0.06), (0.3, 1.1, -0.06), (0.8, 1.3, -0.02)], 0.022, 5)
    b.empty('seat_driver', (-1.0, 2.0, 1.4), (0, 0, -1))
    b.empty('hatch_entry', (-1.9, 0.0, 1.6), (1, 0, 0))
    return lay


def make():
    vkit.setup_materials('red_camo')
    v = Vehicle('flaplid', '30N6E Flap Lid B engagement radar', scheme='red_camo', seed=306)
    b = Part(v, 'body')
    build_body(v, b)
    m = build_mast(v)
    t = build_post(v, m)
    build_array(v, t)
    for name, x, z, top in (('jack_fl', -1.33, 6.70, DECK - 0.05), ('jack_fr', 1.33, 6.70, DECK - 0.05),
                            ('jack_rl', -1.30, 11.42, 1.75), ('jack_rr', 1.30, 11.42, 1.75)):
        build_jack(v, name, x, z, top=top, foot=0.52)
    return v
