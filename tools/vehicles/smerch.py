# ═══════════════════════════════════════════════════════════════
# 9A52-2 combat vehicle of the 9K58 "Smerch" (BM-30) 300 mm multiple rocket launcher on the MAZ-543M.
#   blender -b -P tools/vehicles/build.py -- smerch
# References: 12.1 × 3.05 × 3.05 m, 43.7 t, traverse ±30°, elevation 0–55°, 9M55 rockets 7.6 m × 0.3 m; the tube
# arrangement (4 across the top, 2 + 2 below it either side of the cradle, twice) from the rear view of the
# St Petersburg Artillery Museum launcher; the MAZ-543M's set-back right cab, the rear jacks between the last two
# axles and the pack's pivot at the rear from the museum side views and the Kiev 2008 parade (Wikimedia Commons).
# Rig: turret (the turntable, rot y ±30°), launcher (the tube pack and cradle, rot x about the rear trunnions 0 → 55°,
# muzzles forwards when stowed), muzzle_1..12 (1-4 top row left → right, 5-8 middle, 9-12 bottom), ram_l / ram_r
# (elevating rams), jack_rl / jack_rr, 8 wheels, exhaust, seat_driver, hatch_entry.
# ═══════════════════════════════════════════════════════════════
import math
from mathutils import Vector
import vkit
from vkit import Vehicle, Part, rot, slide, lerp
import chassis
from chassis import MAZM

TURRET = (0.0, MAZM['deck'], 10.55)     # traverse axis
TRUN = (0.0, 2.12, 11.05)               # elevation trunnions
Z_MUZ, Z_BR = 4.45, 12.05               # tube muzzle / breech ends in travel
TUBE_R = 0.165
SP = 0.36                               # tube spacing
ROWS = [(2.88, [-1.5, -0.5, 0.5, 1.5]), (2.525, [-2.5, -1.5, 1.5, 2.5]), (2.17, [-2.5, -1.5, 1.5, 2.5])]


def tubes(L):
    """tube positions (x, y) in muzzle order"""
    out = []
    for (y, xs) in ROWS:
        for k in xs:
            out.append((k * SP, y))
    return out


def build_launcher(v, turret):
    tx, ty, tz = TRUN
    p = Part(v, 'launcher', pivot=TRUN, parent=turret, joint=rot('x', 0.0, math.radians(55), deploy=math.radians(55), group='launcher'))
    L = Z_BR - Z_MUZ
    prof = [(0.0, 0.0, 'black'), (0.0, 0.14, 'black'), (0.0, 0.205, 'dark'), (0.10, 0.19, 'paint'), (0.18, TUBE_R, 'paint'),
            (2.4, TUBE_R, 'paint'), (2.4, 0.18, 'dark'), (2.48, 0.18, 'dark'), (2.48, TUBE_R, 'paint'),
            (5.1, TUBE_R, 'paint'), (5.1, 0.18, 'dark'), (5.18, 0.18, 'dark'), (5.18, TUBE_R, 'paint'),
            (L - 0.3, TUBE_R, 'paint')]
    for i, (x, y) in enumerate(tubes(L)):
        # a tube from the breech (rear) forward to the muzzle collar, a bore at each end
        p.lathe((x, y, Z_BR), (0, 0, -1), prof, n=10, smooth=True)
        # the muzzle collar: a squared ring with chamfered corners, the bore dark inside
        c = Vector((x, y, Z_MUZ + 0.14))
        p.box('paint', x - 0.175, x + 0.175, y - 0.175, y + 0.175, Z_MUZ, Z_MUZ + 0.30, bev=0.04, skins={'nz': 'black'})
        p.disc('black', (x, y, Z_MUZ - 0.002), (0, 0, -1), 0.13, 10)
        p.empty('muzzle_%d' % (i + 1), (x, y, Z_MUZ - 0.02), (0, 0, -1))
    # cradle: a box spine in the central gap, under the top row, from the trunnions to the front
    p.box('paint', -0.2, 0.2, 2.0, 2.68, 5.0, 11.2, bev=0.02)
    p.box('dark', -0.26, 0.26, tx + 2.0 - 0.1, 2.26, 10.85, 11.25)   # trunnion block
    p.cyl('dark', (-0.34, ty, tz), (0.34, ty, tz), 0.1, 0.1, 12)
    # pack frames: steel straps round the bundle at four stations, lugs on the spine
    for z in (5.25, 7.3, 9.35, 11.3):
        top = 2.88 + TUBE_R + 0.02
        bot = 2.17 - TUBE_R - 0.02
        xo = 2.5 * SP + TUBE_R + 0.02
        xi = 1.5 * SP + TUBE_R + 0.02
        path = [(-xo, bot, z), (-xo, 2.72, z), (-xi, 2.72 + 0.02, z), (-xi, top, z), (xi, top, z), (xi, 2.74, z), (xo, 2.72, z), (xo, bot, z)]
        p.tube('dark', path, 0.022, 4)
        p.beam('dark', (-xo, bot, z), (-0.2, bot + 0.02, z), 0.05, 0.05)
        p.beam('dark', (0.2, bot + 0.02, z), (xo, bot, z), 0.05, 0.05)
    # cable harness to the igniters along the pack, a junction box at the rear
    for sx in (-1, 1):
        p.tube('cable', [(sx * 0.62, 2.9 + 0.18, 11.9), (sx * 0.62, 2.9 + 0.19, 8.0), (sx * 0.62, 2.9 + 0.19, 5.0)], 0.02, 4)
    p.box('dark', -0.3, 0.3, 2.3, 2.66, 11.2, 11.45, bev=0.02)
    return p


def build_turret(v):
    t = Part(v, 'turret', pivot=TURRET, joint=rot('y', math.radians(-30), math.radians(30), stow=0.0, deploy=0.0, group='turret'))
    cx, cy, cz = TURRET
    # turntable ring and base
    t.cyl('paint', (0, cy, cz), (0, cy + 0.16, cz), 0.95, 0.95, 20)
    t.cyl('dark', (0, cy + 0.16, cz), (0, cy + 0.2, cz), 0.9, 0.86, 20, cap0=False)
    # upper carriage: two side brackets up to the trunnions
    tx, ty, tz = TRUN
    for sx in (-1, 1):
        prof = [(cz - 0.7, cy + 0.2), (tz + 0.35, cy + 0.2), (tz + 0.3, ty + 0.2), (tz - 0.3, ty + 0.2)]
        t.prism_x('paint', prof, sx * 0.30, sx * 0.44)
        t.cyl('dark', (sx * 0.34, ty, tz), (sx * 0.52, ty, tz), 0.14, 0.14, 12)
    t.box('paint', -0.44, 0.44, cy + 0.2, cy + 0.34, cz - 0.7, tz + 0.35)
    # gunner's panoramic sight on the left bracket, a stowage box on the right
    t.box('dark', -0.72, -0.5, cy + 0.34, cy + 0.62, tz - 0.6, tz - 0.3)
    t.cyl('dark', (-0.61, cy + 0.62, tz - 0.45), (-0.61, cy + 0.82, tz - 0.45), 0.05, 0.05, 8)
    t.box('glass', -0.66, -0.56, cy + 0.74, cy + 0.8, tz - 0.51, tz - 0.49)
    t.box('paint', 0.5, 0.86, cy + 0.2, cy + 0.52, cz - 0.4, cz + 0.25, bev=0.02)
    return t


def build_jack(v, name, x, z, top, foot=0.5):
    j = Part(v, name, pivot=(x, top, z), joint=slide('-y', foot, group='jack'))
    j.cyl('steel', (x, foot + 0.07, z), (x, top - 0.05, z), 0.075, 0.075, 10)
    j.cyl('dark', (x, foot, z), (x, foot + 0.07, z), 0.25, 0.23, 14)
    j.cyl('dark', (x, foot + 0.07, z), (x, foot + 0.15, z), 0.12, 0.1, 10)
    return j


def build_body(v, b):
    lay = chassis.maz543m(v, b, right='cab')
    zr = MAZM['len']
    deck = MAZM['deck']
    # deck behind the cabs
    b.box('paint', -1.45, 1.45, deck - 0.1, deck, 2.96, zr - 0.02, skip=())
    b.box('paint', -0.45, 1.45, deck - 0.1, deck, 2.62, 2.96)
    b.panel('tread_plate', [(-0.9, deck, 4.6), (0.9, deck, 4.6), (0.9, deck, 9.4), (-0.9, deck, 9.4)], (0, 1, 0), off=0.003)
    # the travel rest for the pack's front: an A-frame with a clamp under the cradle
    for sx in (-1, 1):
        b.beam('paint', (sx * 0.6, deck, 5.25), (sx * 0.12, 1.98, 5.4), 0.09, 0.09)
    b.box('dark', -0.24, 0.24, 1.9, 2.0, 5.25, 5.6)
    for sx in (-1, 1):
        xo = sx * 1.45
        # fuel tank (left) / batteries and tool boxes (right) between the wheel pairs
        if sx < 0:
            b.box('paint', -1.50, -1.0, 0.98, deck - 0.12, 5.9, 7.5, bev=0.08)
            b.cyl('dark', (-1.25, deck - 0.12, 6.2), (-1.25, deck - 0.02, 6.2), 0.07, 0.07, 10)
        else:
            b.box('paint', 1.0, 1.50, 0.98, deck - 0.12, 5.9, 6.6, bev=0.02)
            b.box('paint', 1.0, 1.50, 0.98, deck - 0.12, 6.8, 7.5, bev=0.02)
            vkit.grab_handle(b, (1.505, 1.3, 6.25), (0, 0, 1), (1, 0, 0), 0.2, 0.03, 'dark')
            vkit.grab_handle(b, (1.505, 1.3, 7.15), (0, 0, 1), (1, 0, 0), 0.2, 0.03, 'dark')
        # stowage lockers along the deck edge behind the cabs
        b.box('paint', sx * 1.05, sx * 1.45, deck, deck + 0.42, 4.45, 5.05 if sx > 0 else 5.05, bev=0.02)
        vkit.grab_handle(b, (sx * 1.455, deck + 0.22, 4.75), (0, 0, 1), (sx, 0, 0), 0.16, 0.03, 'dark')
        # rear jack housings between the last two axles
        b.cyl('paint', (sx * 1.30, 0.95, 9.45), (sx * 1.30, deck, 9.45), 0.105, 0.105, 12)
        b.cyl('dark', (sx * 1.30, 0.93, 9.45), (sx * 1.30, 1.0, 9.45), 0.125, 0.125, 12)
        b.box('dark', sx * 0.56, sx * 1.22, deck - 0.14, deck - 0.02, 9.37, 9.53)
        # rear lamps
        vkit.lamp_box(b, (sx * 1.25, 1.35, zr + 0.02), (0.22, 0.1, 0.06), (0, 0, 1), lens='lens_red')
        vkit.lamp_box(b, (sx * 1.25, 1.22, zr + 0.02), (0.1, 0.08, 0.06), (0, 0, 1), lens='lens_amber')
    # rear cross beam, tow pintle, number plate
    b.box('paint', -1.45, 1.45, 1.05, 1.45, zr - 0.35, zr, bev=0.02)
    b.box('dark', -0.12, 0.12, 1.00, 1.18, zr, zr + 0.18)
    b.panel('white', [(-0.26, 1.2, zr), (0.26, 1.2, zr), (0.26, 1.36, zr), (-0.26, 1.36, zr)], (0, 0, 1), off=0.004)
    # ram bases on the deck are on the turret; a cable reel on the left of the deck
    b.cyl('dark', (-1.2, deck + 0.35, 8.0), (-0.95, deck + 0.35, 8.0), 0.34, 0.34, 14)
    b.cyl('cable', (-1.18, deck + 0.35, 8.0), (-0.97, deck + 0.35, 8.0), 0.3, 0.3, 14)
    b.box('dark', -1.25, -0.9, deck, deck + 0.05, 7.7, 8.3)
    # antennas, searchlight on the left cab, exhaust behind the right cab
    vkit.whip_antenna(b, (-1.35, 2.92, 2.75), h=2.4)
    vkit.whip_antenna(b, (1.35, 2.92, 4.15), h=2.0)
    b.cyl('dark', (-0.75, 2.92, 1.0), (-0.75, 3.22, 1.0), 0.025, 0.025, 6)
    b.cyl('dark', (-0.75, 3.22, 1.05), (-0.75, 3.22, 0.87), 0.12, 0.11, 12)
    b.disc('lens', (-0.75, 3.22, 0.865), (0, 0, -1), 0.1, 12)
    b.cyl('dark', (0.62, 2.28, 2.45), (0.62, 2.95, 2.45), 0.075, 0.075, 8)
    b.cyl('soot', (0.62, 2.95, 2.45), (0.62, 2.99, 2.45), 0.08, 0.08, 8)
    b.empty('exhaust', (0.62, 2.99, 2.45), (0, 1, 0))
    # tow cable on the bumper
    b.tube('steel', [(-0.9, 1.3, -0.02), (-0.5, 1.12, -0.06), (0.3, 1.1, -0.06), (0.8, 1.3, -0.02)], 0.022, 5)
    b.empty('seat_driver', (-1.0, 2.0, 1.4), (0, 0, -1))
    b.empty('hatch_entry', (-1.9, 0.0, 1.6), (1, 0, 0))
    return lay


def make():
    vkit.setup_materials('red_green')
    v = Vehicle('smerch', '9A52-2 BM-30 Smerch', scheme='red_green', seed=30)
    b = Part(v, 'body')
    build_body(v, b)
    t = build_turret(v)
    L = build_launcher(v, t)
    for sx, n in ((-1, 'ram_l'), (1, 'ram_r')):
        vkit.ram(v, n, t, (sx * 0.30, TURRET[1] + 0.3, 9.95), L, (sx * 0.16, 2.02, 8.3), r=0.09)
    for name, x in (('jack_rl', -1.30), ('jack_rr', 1.30)):
        build_jack(v, name, x, 9.45, top=MAZM['deck'] - 0.05, foot=0.5)
    return v
