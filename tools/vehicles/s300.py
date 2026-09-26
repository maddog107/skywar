# ═══════════════════════════════════════════════════════════════
# 5P85S self-propelled launcher of the S-300PS (NATO SA-10B "Grumble") on the MAZ-543M, four 5V55 missiles in
# their transport-launch canisters.
#   blender -b -P tools/vehicles/build.py -- s300
# References: 5P85S 13.11 × 3.15 × 3.8 m, 42.15 t (missilery.info); the MAZ-543M layout (long two-door left cab,
# engine and grille at the front right) from the BM-30 / 5P85S photos on Wikimedia Commons; the canister pack
# (2 × 2 either side of a lattice lifting frame, erected to vertical about the rear with the bases on the ground)
# from the 2021 Ukrainian firing photos, the Kiev 2008 parade (travel) and the Togliatti museum 5P85S (erected).
# Rig: erector (the lifting frame, rot x about the rear hinge, 0 → 90°, group 'raise'), canister_1..4 (children of
# the erector; origin on the canister base, muzzle end along −z), muzzle_1..4 (the canister tops; −z = launch
# direction), jack_fl/fr/rl/rr (group 'jack'), ram_l / ram_r, 8 wheels, exhaust, seat_driver, hatch_entry.
# ═══════════════════════════════════════════════════════════════
import math
from mathutils import Vector
import vkit
from vkit import Vehicle, Part, rot, slide, lerp
import chassis
from chassis import MAZM

PIVOT = (0.0, 1.66, 11.55)          # lifting-frame hinge
CAN_X = 0.80                        # canister columns at x = ±CAN_X
CAN_Y = (3.16, 2.26)                # upper, lower row axis heights (travel)
CAN_Z0, CAN_Z1 = 5.86, 13.11        # muzzle end, base end (travel)
CAN_R = 0.40                        # body radius (rings to 0.43)


def canister_profile(L):
    """(t from the BASE along the axis towards the muzzle, radius, skin): base flange, ribbed body, cap"""
    p = [(0.0, 0.0, 'dark'), (0.0, 0.33, 'dark'), (0.0, 0.43, 'paint'), (0.10, 0.43, 'paint'), (0.10, CAN_R, 'paint')]
    ribs = [0.62 + 0.86 * k for k in range(8)]
    for t in ribs:
        p += [(t, CAN_R, 'paint'), (t, 0.428, 'paint'), (t + 0.06, 0.428, 'paint'), (t + 0.06, CAN_R, 'paint')]
    p += [(L - 0.16, CAN_R, 'paint'), (L - 0.16, 0.435, 'dark'), (L - 0.02, 0.435, 'dark'), (L - 0.02, 0.37, 'dark'),
          (L + 0.05, 0.33, 'dark'), (L + 0.10, 0.2, 'dark'), (L + 0.115, 0.0, 'dark')]
    return p


def build_canisters(v, erector):
    L = CAN_Z1 - CAN_Z0
    proto = None
    idx = 0
    for row, y in enumerate(CAN_Y):
        for sx in (-1, 1):
            idx += 1
            name = 'canister_%d' % idx
            piv = (sx * CAN_X, y, CAN_Z1)
            if proto is None:
                c = Part(v, name, pivot=piv, parent=erector, local=True)
                # the body: a surface of revolution along -z from the base (origin) to the muzzle cap
                c.lathe((0, 0, 0), (0, 0, -1), canister_profile(L), n=14, smooth=True)
                # a cable duct along the top and the lifting lugs / fittings on the body
                c.beam('paint', (0, 0.405, -0.4), (0, 0.405, -L + 0.3), 0.07, 0.04, up=(0, 1, 0))
                for t in (1.9, 5.3):
                    c.box('dark', -0.06, 0.06, 0.40, 0.47, -t - 0.08, -t + 0.08)
                c.box('dark', -0.1, 0.1, -0.44, -0.38, -0.25, -0.05)         # connector box at the base
                # base plate: a central boss and a bolt circle
                c.cyl('gunmetal', (0, 0, 0.0), (0, 0, 0.05), 0.12, 0.1, 10, cap0=False)
                c.bolts('gunmetal', (0, 0, 0.0), (0, 0, 1), 0.25, 10, rb=0.02, h=0.025)
                proto = c
            else:
                c = Part(v, name, pivot=piv, parent=erector, local=True, share=proto)
            c.empty('muzzle_%d' % idx, (0, 0, -(L + 0.12)), (0, 0, -1))
    return proto


def build_erector(v):
    hx, hy, hz = PIVOT
    e = Part(v, 'erector', pivot=PIVOT, joint=rot('x', 0.0, math.pi / 2, group='raise'))
    # the lifting frame: two lattice walls between the canister columns, cross-tied at top and bottom
    yb, yt = 1.96, 3.42
    zs = [6.25, 7.05, 7.85, 8.65, 9.45, 10.25, 11.05]
    for sx in (-1, 1):
        x = sx * 0.27
        vkit.truss(e, [(x, yt, z) for z in zs], [(x, yb, z) for z in zs], 'paint', w=0.07)
    for z in zs:
        e.beam('paint', (-0.27, yt, z), (0.27, yt, z), 0.06, 0.06)
        e.beam('paint', (-0.27, yb, z), (0.27, yb, z), 0.06, 0.06)
    # clamp arms and bands holding each canister at three stations
    for zc in (6.55, 9.05, 11.0):
        for y in CAN_Y:
            for sx in (-1, 1):
                e.beam('paint', (sx * 0.27, y, zc), (sx * (CAN_X - 0.42), y, zc), 0.12, 0.10)
                band = []
                for k in range(9):
                    a = math.radians(-100 + 200 * k / 8) if sx > 0 else math.radians(80 + 200 * k / 8)
                    band.append((sx * CAN_X + math.cos(a) * 0.445, y + math.sin(a) * 0.445, zc))
                e.tube('dark', band, 0.025, 4)
    # base frame down to the hinge, hinge bearings and shaft
    for sx in (-1, 1):
        e.beam('paint', (sx * 0.27, yb, 10.9), (sx * 0.55, hy, hz), 0.14, 0.14)
        e.beam('paint', (sx * 0.27, yt, 11.05), (sx * 0.55, hy, hz), 0.1, 0.1)
        e.cyl('dark', (sx * 0.45, hy, hz), (sx * 0.7, hy, hz), 0.12, 0.12, 12)
        # the lower canisters rest on shoes at the base end
        e.box('dark', sx * (CAN_X - 0.25), sx * (CAN_X + 0.25), CAN_Y[1] - 0.48, CAN_Y[1] - 0.42, 12.4, 12.9)
    e.cyl('dark', (-0.45, hy, hz), (0.45, hy, hz), 0.08, 0.08, 10)
    # hydraulic and cable runs along the frame
    for sx in (-1, 1):
        e.tube('hose', [(sx * 0.2, yb + 0.1, 6.4), (sx * 0.2, yb + 0.1, 10.6), (sx * 0.35, hy + 0.2, hz - 0.1)], 0.014, 5)
    return e


def build_jack(v, name, x, z, top, foot=0.52):
    j = Part(v, name, pivot=(x, top, z), joint=slide('-y', foot, group='jack'))
    j.cyl('steel', (x, foot + 0.07, z), (x, top - 0.05, z), 0.07, 0.07, 10)
    j.cyl('dark', (x, foot, z), (x, foot + 0.07, z), 0.24, 0.22, 14)
    j.cyl('dark', (x, foot + 0.07, z), (x, foot + 0.14, z), 0.11, 0.09, 10)
    return j


def jack_housing(b, x, z, y0, y1):
    b.cyl('paint', (x, y0, z), (x, y1, z), 0.1, 0.1, 12)
    b.cyl('dark', (x, y0 - 0.02, z), (x, y0 + 0.05, z), 0.12, 0.12, 12)
    sx = 1 if x > 0 else -1
    b.box('dark', x - sx * 0.1, sx * 0.56, y1 - 0.14, y1 - 0.02, z - 0.09, z + 0.09)


def build_hut(b):
    """the equipment hut behind the cab: the power unit and the launcher's equipment, under a gabled canvas roof"""
    y0, ye, yr = 1.62, 3.00, 3.60
    zr = 5.72
    # plan: steps back behind the left cab (which ends at 2.95), starts right behind the engine bay (2.62) elsewhere
    plan = [(-1.48, 2.99), (-0.45, 2.99), (-0.45, 2.66), (1.48, 2.66), (1.48, zr), (-1.48, zr)]
    b.prism_y('paint', plan, y0, ye)
    # gabled canvas roof (ridge along z), eaves slightly overhanging, gable ends in canvas
    ov = 0.05
    zf = 2.66
    L, Rr = (-1.48 - ov, ye - 0.03), (1.48 + ov, ye - 0.03)
    b.face([(L[0], L[1], zf - ov), (0, yr, zf - ov), (0, yr, zr + ov), (L[0], L[1], zr + ov)], 'canvas_green', want=(-0.4, 1, 0))
    b.face([(Rr[0], Rr[1], zf - ov), (Rr[0], Rr[1], zr + ov), (0, yr, zr + ov), (0, yr, zf - ov)], 'canvas_green', want=(0.4, 1, 0))
    b.face([(L[0], L[1], zf - ov), (Rr[0], Rr[1], zf - ov), (0, yr, zf - ov)], 'canvas_green', want=(0, 0, -1))
    b.face([(L[0], L[1], zr + ov), (0, yr, zr + ov), (Rr[0], Rr[1], zr + ov)], 'canvas_green', want=(0, 0, 1))
    b.face([(L[0], L[1], zf - ov), (L[0], L[1], zr + ov), (Rr[0], Rr[1], zr + ov), (Rr[0], Rr[1], zf - ov)], 'canvas_green', want=(0, -1, 0))
    # tie-down straps over the canvas
    for z in (3.2, 4.2, 5.2):
        b.tube('canvas', [(-1.53, ye - 0.08, z), (-1.51, ye + 0.02, z), (0, yr + 0.025, z), (1.51, ye + 0.02, z), (1.53, ye - 0.08, z)], 0.018, 4)
    # front face above the engine bay: two equipment boxes, a white stripe, the turbine intake
    b.box('paint', -0.35, 0.25, 2.30, 2.85, 2.52, 2.66, bev=0.02)
    b.box('paint', 0.62, 1.30, 2.30, 2.85, 2.52, 2.66, bev=0.02)
    b.panel('mesh', [(0.66, 2.36, 2.52), (1.26, 2.36, 2.52), (1.26, 2.80, 2.52), (0.66, 2.80, 2.52)], (0, 0, -1), off=0.003)
    b.panel('white', [(-0.45, 2.90, 2.66), (1.48, 2.90, 2.66), (1.48, 2.95, 2.66), (-0.45, 2.95, 2.66)], (0, 0, -1), off=0.003)
    # right-hand mirror on an arm from the hut's front corner
    vkit.mirror(b, (1.46, 2.62, 2.70), (1.72, 2.55, 2.42), (0.18, 0.28))
    # beacon and searchlight on the front edge
    b.cyl('dark', (0.9, ye, 2.9), (0.9, ye + 0.06, 2.9), 0.09, 0.09, 10)
    b.cyl('lens_amber', (0.9, ye + 0.06, 2.9), (0.9, ye + 0.2, 2.9), 0.075, 0.06, 10)
    # side doors, handles, louvres, a ladder at the left rear corner
    for sx in (-1, 1):
        xo = sx * 1.48
        chassis.panel_lines(b, xo, sx, (3.35, 4.25, 1.72, 2.86))
        vkit.grab_handle(b, (xo + sx * 0.01, 2.2, 4.12), (0, 1, 0), (sx, 0, 0), 0.16, 0.03, 'dark')
        vkit.louvres(b, xo, 2.35, 2.8, 4.55, 5.45, 6, side=sx)
        chassis.panel_lines(b, xo, sx, (4.50, 5.50, 1.72, 2.20))
    vkit.ladder(b, -1.53, 1.0, 3.0, 5.35, 5.62, rungs=6)
    # gas-turbine power unit exhaust on the right rear of the hut
    b.cyl('dark', (1.15, ye - 0.3, 5.35), (1.15, ye + 0.25, 5.35), 0.12, 0.12, 10)
    b.cyl('soot', (1.15, ye + 0.25, 5.35), (1.15, ye + 0.29, 5.35), 0.125, 0.125, 10)
    b.empty('exhaust', (1.15, ye + 0.29, 5.35), (0, 1, 0))


def build_body(v, b):
    lay = chassis.maz543m(v, b, right=None)
    A = lay['axles']
    zr = MAZM['len']
    deck = MAZM['deck']
    build_hut(b)
    # deck behind the hut, side rails, stowage along the sides
    b.box('paint', -1.45, 1.45, deck - 0.1, deck, 5.70, zr - 0.02)
    b.panel('tread_plate', [(-0.75, deck, 5.8), (0.75, deck, 5.8), (0.75, deck, zr - 0.2), (-0.75, deck, zr - 0.2)], (0, 1, 0), off=0.003)
    for sx in (-1, 1):
        xo = sx * 1.45
        # low side boxes (cable drums, spares) between the wheel pairs, with the front jack between them
        for (z0, z1) in ((5.86, 6.46), (6.94, 7.56)):
            b.box('paint', sx * 1.02, sx * 1.50, 0.95, deck - 0.1, z0, z1, bev=0.02)
            vkit.grab_handle(b, (sx * 1.505, 1.25, (z0 + z1) / 2), (0, 0, 1), (sx, 0, 0), 0.2, 0.03, 'dark')
        jack_housing(b, sx * 1.33, 6.70, 0.95, deck)
        jack_housing(b, sx * 1.30, 11.42, 0.95, 1.80)
        # deck edge handrail stanchions
        for z in (6.2, 8.0, 9.8):
            b.cyl('dark', (xo, deck, z), (xo, deck + 0.35, z), 0.02, 0.02, 6)
        b.tube('dark', [(xo, deck + 0.35, 6.2), (xo, deck + 0.35, 9.8)], 0.018, 5)
        # rear lamps
        vkit.lamp_box(b, (sx * 1.25, 1.35, zr + 0.02), (0.22, 0.1, 0.06), (0, 0, 1), lens='lens_red')
        vkit.lamp_box(b, (sx * 1.25, 1.22, zr + 0.02), (0.1, 0.08, 0.06), (0, 0, 1), lens='lens_amber')
    # travel rest for the canister pack (the front of the lower canisters sits on it)
    for sx in (-1, 1):
        b.beam('paint', (sx * CAN_X, deck, 6.35), (sx * CAN_X, CAN_Y[1] - 0.42, 6.35), 0.1, 0.1)
        b.box('dark', sx * CAN_X - 0.22, sx * CAN_X + 0.22, CAN_Y[1] - 0.46, CAN_Y[1] - 0.41, 6.2, 6.5)
    b.beam('paint', (-CAN_X, deck + 0.05, 6.35), (CAN_X, deck + 0.05, 6.35), 0.1, 0.1)
    # rear cross beam, tow pintle, number plate, hinge brackets for the lifting frame
    b.box('paint', -1.45, 1.45, 1.05, 1.45, zr - 0.35, zr, bev=0.02)
    b.box('dark', -0.12, 0.12, 1.00, 1.18, zr, zr + 0.18)
    b.panel('white', [(-0.26, 1.2, zr), (0.26, 1.2, zr), (0.26, 1.36, zr), (-0.26, 1.36, zr)], (0, 0, 1), off=0.004)
    hx, hy, hz = PIVOT
    for sx in (-1, 1):
        b.box('dark', sx * 0.72, sx * 0.86, deck - 0.1, hy + 0.16, hz - 0.22, hz + 0.18)
    # ram bases
    for sx in (-1, 1):
        b.box('dark', sx * 0.10, sx * 0.26, deck - 0.06, deck + 0.05, 8.4, 8.8)
    # radio antenna and searchlight on the left cab
    vkit.whip_antenna(b, (-1.35, 2.92, 2.75), h=2.4)
    b.cyl('dark', (-0.75, 2.92, 1.0), (-0.75, 3.22, 1.0), 0.025, 0.025, 6)
    b.cyl('dark', (-0.75, 3.22, 1.05), (-0.75, 3.22, 0.87), 0.12, 0.11, 12)
    b.disc('lens', (-0.75, 3.22, 0.865), (0, 0, -1), 0.1, 12)
    # tow cable looped on the bumper (parade photos)
    b.tube('steel', [(-0.9, 1.3, -0.02), (-0.5, 1.12, -0.06), (0.3, 1.1, -0.06), (0.8, 1.3, -0.02)], 0.022, 5)
    b.empty('seat_driver', (-1.0, 2.0, 1.4), (0, 0, -1))
    b.empty('hatch_entry', (-1.9, 0.0, 1.6), (1, 0, 0))
    return lay


def make():
    vkit.setup_materials('red_camo')
    v = Vehicle('s300', '5P85S launcher, S-300PS (SA-10B Grumble)', scheme='red_camo', seed=300)
    b = Part(v, 'body')
    build_body(v, b)
    e = build_erector(v)
    build_canisters(v, e)
    for name, x, z, top in (('jack_fl', -1.33, 6.70, MAZM['deck'] - 0.05), ('jack_fr', 1.33, 6.70, MAZM['deck'] - 0.05),
                            ('jack_rl', -1.30, 11.42, 1.75), ('jack_rr', 1.30, 11.42, 1.75)):
        build_jack(v, name, x, z, top=top, foot=0.52)
    for sx, n in ((-1, 'ram_l'), (1, 'ram_r')):
        vkit.ram(v, n, b, (sx * 0.18, MAZM['deck'] - 0.02, 8.6), e, (sx * 0.18, 1.96, 10.3), r=0.085)
    return v
