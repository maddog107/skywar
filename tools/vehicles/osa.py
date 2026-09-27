# ═══════════════════════════════════════════════════════════════
# 9A33BM3 TELAR of the 9K33M3 Osa-AKM (NATO SA-8 Gecko) on the BAZ-5937 6×6 amphibious chassis.
#   blender -b -P tools/vehicles/build.py -- osa
# References: 9.14 × 2.75 m, 4.2 m with the search radar folded, 17.5 t; BAZ-5937 hull 9.165 × 2.78 m, 1200×500-508
# tyres; photos of the 9A33BM3 at MAKS (Wikimedia Commons, Vitaly V. Kuzmin), at VDNKh (side view, used for the axle
# stations and heights), the Artillery Museum St Petersburg and the Lešany museum (radar antenna close-ups).
# Rig: turret (rot y, 360°), launcher (both container packs, rot x about their rear pivots, 0 → 60°, + = up),
# mast (the search radar's folding mast, rot −x 0 → 90°, group 'raise'), antenna (the search reflector, spins about
# the mast), muzzle_1..6 (container fronts), hatch_l / hatch_r (cab roof), 6 wheels (front axle steers),
# exhaust, seat_driver, hatch_entry.
# ═══════════════════════════════════════════════════════════════
import math
from mathutils import Vector
import vkit
from vkit import Vehicle, Part, rot, spinj, lerp
import chassis
import redkit

DECK = 2.21
HW = 1.375                   # half width at the deck
AXLES = [2.80, 5.45, 7.60]   # distance aft of the bow tip
R, TW = 0.60, 0.50           # tyre radius / width (1200×500-508)
TRACK = 2.20
LEDGE = 1.30                 # underside of the upper hull (wheel-well roof)
REAR = 9.14
TPIV = (0.0, DECK, 5.05)     # turret rotation axis
LPIV = (0.0, 2.84, 7.62)     # container packs' pivot (rear lower edge of the packs)
MPIV = (0.0, 3.98, 4.42)     # search radar mast hinge


def hull(b):
    # upper hull: full width, from behind the bow taper to the rear; the side profile includes the windscreen
    # plate and the lower bow ahead of the front wheels
    up = [(1.00, 1.70), (1.58, DECK), (REAR, DECK), (REAR - 0.03, 1.62), (REAR - 0.30, LEDGE), (2.08, LEDGE), (1.62, 0.84), (1.00, 0.66)]
    b.prism_x('paint', up, -HW, HW)
    # bow: tapers in plan to the tip (a loft from the full-width section at z = 1.0 to the tip)
    tip = [(-1.08, 1.25, 0.0), (1.08, 1.25, 0.0), (1.08, 1.49, 0.04), (-1.08, 1.49, 0.04)]
    sec = [(-HW, 0.66, 1.0), (HW, 0.66, 1.0), (HW, 1.70, 1.0), (-HW, 1.70, 1.0)]
    b.loft('paint', [tip, sec], smooth=False)
    b.face(tip, 'paint', want=(0, 0, -1))
    # lower hull (belly) between the wheels: narrower, chamfered bottom edges, sloped rear
    belly = [(-0.62, 0.56), (0.62, 0.56), (0.80, 0.86), (0.80, LEDGE), (-0.80, LEDGE), (-0.80, 0.86)]
    b.prism_z('paint', belly, 1.55, 8.40, cap0=False, cap1=False)
    # belly nose (under the bow) and rear slope
    b.loft('paint', [[(-0.62, 0.56, 1.55), (0.62, 0.56, 1.55), (0.80, 0.86, 1.55), (0.80, LEDGE, 1.55), (-0.80, LEDGE, 1.55), (-0.80, 0.86, 1.55)],
                     [(-0.9, 0.66, 1.0), (0.9, 0.66, 1.0), (1.0, 0.8, 1.0), (1.0, LEDGE, 1.0), (-1.0, LEDGE, 1.0), (-1.0, 0.8, 1.0)]], smooth=False)
    zr = REAR - 0.32
    b.loft('paint', [[(-0.62, 0.56, 8.40), (0.62, 0.56, 8.40), (0.80, 0.86, 8.40), (0.80, LEDGE, 8.40), (-0.80, LEDGE, 8.40), (-0.80, 0.86, 8.40)],
                     [(-0.9, 1.02, zr), (0.9, 1.02, zr), (1.0, 1.1, zr), (1.0, LEDGE, zr), (-1.0, LEDGE, zr), (-1.0, 1.1, zr)]],
           smooth=False, cap1=True)
    # side skirts between the wheel arches
    for sx in (-1, 1):
        redkit.arch_skirt(b, sx * (HW - 0.03), 0.88, LEDGE, 2.08, REAR - 0.30, [(z, R) for z in AXLES], 0.72, t=0.03, side=sx)
    # cab: raised roof over the crew compartment with the windscreen plate continuing up to it
    roof = [(1.58, DECK), (1.80, 2.42), (3.28, 2.42), (3.34, DECK)]
    b.prism_x('paint', roof, -1.30, 1.30)
    # steel lips around the wheel arches (follow the arch between the skirt bottom and the ledge)
    for sx in (-1, 1):
        x = sx * (HW + 0.01)
        for zc in AXLES:
            r = 0.73
            a0 = math.asin(max(-1.0, min(1.0, (0.88 - R) / r)))
            pts = [(x, R + r * math.sin(a), zc + r * math.cos(a)) for a in [lerp(a0, math.pi - a0, i / 10) for i in range(11)]]
            b.tube('paint', pts, 0.025, 5)
    # stiffener ribs along the upper sides
    for y in (1.52, 1.77, 2.02):
        for sx in (-1, 1):
            b.box('paint', sx * HW, sx * (HW + 0.03), y - 0.025, y + 0.025, 2.20, REAR - 0.06)


def glazing(b):
    # two windscreens on the sloped plate (1.00, 1.70) → (1.58, 2.21)
    a0, a1 = Vector((0, 1.70, 1.00)), Vector((0, DECK, 1.58))
    n = Vector((0, (a1 - a0).z, -(a1 - a0).y)).normalized()    # outward normal of the plate (up/forward)
    for (xa, xb) in ((-1.18, -0.10), (0.10, 1.18)):
        pts = []
        for (u, v) in ((0, 0.14), (1, 0.14), (1, 0.86), (0, 0.86)):
            q = a0.lerp(a1, v)
            pts.append(Vector((lerp(xa, xb, u), q.y, q.z)))
        b.panel('glass', pts, n, off=0.006, frame=0.035)
        # wipers
        mid = pts[0].lerp(pts[1], 0.5)
        b.beam('black', mid + n * 0.02, mid + (pts[3] - pts[0]) * 0.6 + n * 0.02, 0.012, 0.008)
    # the armoured window covers, folded up onto the cab roof (hinged at the top edge)
    for (xa, xb) in ((-1.20, -0.08), (0.08, 1.20)):
        b.box('paint', xa, xb, 2.43, 2.47, 1.84, 2.34, bev=0.01)
        b.cyl('dark', (xa + 0.05, 2.44, 1.82), (xb - 0.05, 2.44, 1.82), 0.025, 0.025, 6)
    # side windows (trapezoids) on the hull sides, just behind the windscreen plate
    for sx in (-1, 1):
        x = sx * HW
        b.panel('glass', [(x, 1.74, 1.24), (x, 1.74, 1.98), (x, 2.12, 1.98), (x, 2.12, 1.62)], (sx, 0, 0), off=0.006, frame=0.035)


def bow_details(b):
    # trim vane (wave breaker): a ribbed plate folded back onto the glacis
    g0, g1 = Vector((0, 1.50, 0.08)), Vector((0, 1.69, 0.92))
    n = Vector((0, (g1 - g0).z, -(g1 - g0).y)).normalized()
    pts = [Vector((-1.02, 0, 0)) + g0 + n * 0.03, Vector((1.02, 0, 0)) + g0 + n * 0.03, Vector((1.02, 0, 0)) + g1 + n * 0.03, Vector((-1.02, 0, 0)) + g1 + n * 0.03]
    b.face([tuple(p) for p in pts], 'paint', want=tuple(n))
    b.face([tuple(p - n * 0.03) for p in reversed(pts)], 'paint', want=tuple(-n))
    for i in range(7):
        x = lerp(-0.95, 0.95, i / 6)
        b.beam('paint', Vector((x, 0, 0)) + g0 + n * 0.05, Vector((x, 0, 0)) + g1 + n * 0.05, 0.03, 0.05, up=tuple(n))
    b.box('paint', -1.05, 1.05, 1.44, 1.52, 0.03, 0.1)
    # headlights on the glacis corners (with guards) and marker lamps
    for sx in (-1, 1):
        vkit.headlight(b, (sx * 1.05, 1.86, 1.12), (0, 0.25, -1), r=0.09, depth=0.1, skin_body='dark', lens='lens', guard=True)
        vkit.lamp_box(b, (sx * 1.16, 1.42, 0.03), (0.1, 0.07, 0.05), (0, 0, -1), lens='lens_amber', skin='dark')
        # tow hooks
        b.cyl('dark', (sx * 0.7, 1.12, 0.12), (sx * 0.7, 1.12, 0.26), 0.05, 0.05, 8)
    # vertical ribs on the lower bow plate
    for i in range(5):
        x = lerp(-0.8, 0.8, i / 4)
        b.beam('paint', (x, 1.20, 0.08), (x * 0.9, 0.72, 0.98), 0.035, 0.035)


def deck_details(b):
    # crew hatch frames on the cab roof (the lids are their own nodes)
    for sx in (-1, 1):
        b.panel('dark', [(sx * 0.18, 2.42, 2.25), (sx * 0.95, 2.42, 2.25), (sx * 0.95, 2.42, 3.05), (sx * 0.18, 2.42, 3.05)], (0, 1, 0), off=0.004)
    # turret ring
    b.cyl('dark', (TPIV[0], DECK, TPIV[2]), (TPIV[0], DECK + 0.03, TPIV[2]), 1.12, 1.12, 28)
    # engine deck at the rear: grilles, the air outlet cells, access hatch
    for sx in (-1, 1):
        b.panel('mesh', [(sx * 0.25, DECK, 7.85), (sx * 1.15, DECK, 7.85), (sx * 1.15, DECK, 8.95), (sx * 0.25, DECK, 8.95)], (0, 1, 0), off=0.004, frame=0.04, frame_skin='dark')
    b.box('paint', -1.20, -0.30, DECK, DECK + 0.32, 8.62, 9.02, skip=('bottom',))
    for i in range(3):
        x = lerp(-1.08, -0.42, i / 2)
        b.panel('black', [(x - 0.12, DECK + 0.05, 9.021), (x + 0.12, DECK + 0.05, 9.021), (x + 0.12, DECK + 0.28, 9.021), (x - 0.12, DECK + 0.28, 9.021)], (0, 0, 1), off=0.003)
    # stowage boxes and grab rails along the deck edges
    for sx in (-1, 1):
        b.box('paint', sx * 1.05, sx * 1.33, DECK, DECK + 0.2, 6.75, 7.55, bev=0.02)
        vkit.grab_handle(b, (sx * 1.25, DECK + 0.005, 3.9), (0, 0, 1), (0, 1, 0), 0.5, 0.05, 'dark')
        vkit.grab_handle(b, (sx * (HW + 0.01), 1.95, 4.6), (0, 0, 1), (sx, 0, 0), 0.25, 0.04, 'dark')
        # round access covers and a step on the sides
        b.lathe((sx * HW, 1.65, 6.6), (sx, 0, 0), [(0.0, 0.15, 'paint'), (0.03, 0.15, 'paint'), (0.03, 0.12, 'paint'), (0.04, 0.0, 'paint')], n=12, smooth=False)
        b.box('dark', sx * HW, sx * (HW + 0.07), 1.0, 1.04, 2.0, 2.3)
        # folding boarding ladder behind the front wheel, up to the deck edge
        vkit.ladder(b, sx * (HW + 0.03), 0.95, DECK - 0.05, 3.62, 3.92, rungs=5)
        # tow cable clipped along the lower side, spare-parts box
        b.tube('dark', [(sx * (HW + 0.03), 1.40, 4.3), (sx * (HW + 0.045), 1.38, 6.2), (sx * (HW + 0.03), 1.40, 7.0)], 0.02, 5)
        b.box('paint', sx * HW, sx * (HW + 0.06), 1.62, 1.92, 4.25, 4.95, bev=0.015)
        vkit.grab_handle(b, (sx * (HW + 0.06), 1.8, 4.6), (0, 0, 1), (sx, 0, 0), 0.16, 0.025, 'dark')
    # radio antenna (rear left) and its base
    vkit.whip_antenna(b, (-1.2, DECK, 8.3), h=2.2)


def rear_details(b):
    z = REAR
    for sx in (-1, 1):
        vkit.lamp_box(b, (sx * 1.18, 2.05, z + 0.02), (0.12, 0.1, 0.05), (0, 0, 1), lens='lens_red')
        vkit.lamp_box(b, (sx * 1.18, 1.92, z + 0.02), (0.08, 0.07, 0.05), (0, 0, 1), lens='lens_amber')
        b.cyl('red', (sx * 0.62, 1.06, z - 0.04), (sx * 0.62, 1.06, z + 0.1), 0.045, 0.045, 8)
    # water-jet outlet covers (round, hinged) and the rear access door
    for sx in (-1, 1):
        b.cyl('paint', (sx * 0.62, 1.50, z - 0.01), (sx * 0.62, 1.50, z + 0.04), 0.28, 0.28, 18)
        b.cyl('dark', (sx * 0.62, 1.50, z + 0.04), (sx * 0.62, 1.50, z + 0.06), 0.05, 0.05, 8)
    b.panel('paint', [(-0.30, 1.40, z), (0.30, 1.40, z), (0.30, 1.95, z), (-0.30, 1.95, z)], (0, 0, 1), off=0.015, frame=0.03, frame_skin='dark')
    vkit.grab_handle(b, (0.0, 1.70, z + 0.02), (1, 0, 0), (0, 0, 1), 0.3, 0.04, 'dark')


def turret(v):
    t = Part(v, 'turret', pivot=TPIV, joint=rot('y', -math.pi, math.pi, stow=0.0, deploy=0.0, group='turret'))
    x0, x1, y0, y1, z0, z1 = -1.02, 1.02, DECK + 0.03, 2.77, 3.62, 6.50
    # base: a wide chamfered box with ribbed equipment boxes along its sides
    prof = [(x0, y0), (x1, y0), (x1, y1 - 0.12), (x1 - 0.14, y1), (x0 + 0.14, y1), (x0, y1 - 0.12)]
    t.prism_z('paint', prof, z0, z1)
    for sx in (-1, 1):
        for i in range(5):
            za = lerp(z0 + 0.08, z1 - 0.08, i / 5)
            zb = lerp(z0 + 0.08, z1 - 0.08, (i + 1) / 5) - 0.04
            t.box('paint', sx * 1.02, sx * 1.08, y0 + 0.05, y1 - 0.16, za, zb, bev=0.01)
            # vertical stiffening ribs on each equipment box door, and its latch
            for k in range(3):
                zr = lerp(za + 0.08, zb - 0.08, k / 2)
                t.box('paint', sx * 1.08, sx * 1.1, y0 + 0.1, y1 - 0.2, zr - 0.012, zr + 0.012)
            t.box('dark', sx * 1.08, sx * 1.105, y1 - 0.3, y1 - 0.24, zb - 0.1, zb - 0.05)
        vkit.grab_handle(t, (sx * 1.085, 2.45, 5.9), (0, 0, 1), (sx, 0, 0), 0.3, 0.03, 'dark')
    # rear electronics boxes and the pack pivot brackets (reaching back to the pivots)
    t.box('paint', -0.7, 0.7, y1 - 0.02, 2.84, 5.6, 6.45, bev=0.02)
    for sx in (-1, 1):
        for xk in (0.46, 1.06):
            t.beam('paint', (sx * xk, 2.56, 6.4), (sx * xk, LPIV[1] - 0.02, LPIV[2]), 0.1, 0.12)
            t.cyl('dark', (sx * (xk - 0.07), LPIV[1], LPIV[2]), (sx * (xk + 0.07), LPIV[1], LPIV[2]), 0.07, 0.07, 10)
    # radar head: the housing behind the antennas
    t.box('paint', -0.46, 0.46, 2.72, 3.92, 3.56, 4.16, bev=0.04)
    t.cyl('paint', (0, 2.77, 3.86), (0, 2.95, 3.86), 0.6, 0.6, 20)
    # tracking radar antenna (the big shield face) and its frame
    redkit.shield_plate(t, 0.0, 3.24, 3.40, 0.92, 1.42, t=0.07)
    t.box('dark', -0.12, 0.12, 2.9, 3.5, 3.52, 3.58)
    # the two missile command-link antennas and the TV trackers below them
    for sx in (-1, 1):
        redkit.round_antenna(t, (sx * 0.80, 3.40, 3.56), 0.29, depth=0.34)
        t.box('paint', sx * 0.62, sx * 0.98, 2.78, 3.06, 3.62, 4.08, bev=0.02)
        t.cyl('paint', (sx * 0.80, 2.94, 3.56), (sx * 0.80, 2.94, 3.84), 0.11, 0.11, 12)
        t.disc('glass', (sx * 0.80, 2.94, 3.555), (0, 0, -1), 0.085, 12)
        t.box('white', sx * 0.93, sx * 1.02, 3.02, 3.1, 3.58, 3.66)          # IR / optical sensor window boxes
        # cable run from the antenna to the turret
        t.tube('hose', [(sx * 0.9, 3.2, 3.9), (sx * 0.95, 3.0, 4.1), (sx * 0.9, 2.8, 4.2)], 0.02, 5)
    # optical tracker on top of the head
    t.box('paint', -0.2, 0.2, 3.92, 4.12, 3.7, 4.12, bev=0.02)
    t.cyl('paint', (0.14, 4.02, 3.62), (0.14, 4.02, 3.78), 0.06, 0.06, 10)
    t.disc('glass', (0.14, 4.02, 3.618), (0, 0, -1), 0.045, 10)
    # mast pedestal for the search radar
    t.cyl('paint', (MPIV[0], 3.92, MPIV[2]), (MPIV[0], MPIV[1] - 0.05, MPIV[2]), 0.12, 0.12, 12)
    t.box('dark', -0.16, 0.16, MPIV[1] - 0.08, MPIV[1] + 0.02, MPIV[2] - 0.1, MPIV[2] + 0.1)
    return t


def launcher(v, t):
    L = Part(v, 'launcher', pivot=LPIV, parent=t, joint=rot('x', 0.0, math.radians(62), stow=0.0, deploy=math.radians(28), group='launcher'))
    y0 = LPIV[1] + 0.02
    y1 = y0 + 0.36
    z0, z1 = LPIV[2] - 3.40, LPIV[2] + 0.02
    k = 1
    for sx in (-1, 1):
        xa, xb = sorted((sx * 0.42, sx * 1.14))
        redkit.corrugated_pack(L, xa, xb, y0, y1, z0, z1, n_cells=3, teeth=24, cap_skin='white')
        # pivot lugs under the rear of the pack
        L.box('dark', xa + 0.05, xb - 0.05, y0 - 0.1, y0, z1 - 0.3, z1 - 0.05)
        # muzzles: container fronts (left pack outer → inner is muzzle 1..3, right pack inner → outer 4..6)
        cells = [lerp(xa, xb, (c + 0.5) / 3) for c in range(3)]
        if sx < 0:
            cells = cells
        for cx in cells:
            L.empty('muzzle_%d' % k, (cx, (y0 + y1) / 2, z0 - 0.1), (0, 0, -1))
            k += 1
        # cable harness along the pack
        L.tube('hose', [(xb if sx > 0 else xa, y0 + 0.1, z1 - 0.2), ((xb if sx > 0 else xa) + sx * 0.03, y0 + 0.1, z0 + 0.6)], 0.018, 5)
    return L


def search_radar(v, t):
    """the folding search radar: modelled standing, then folded back (−90° about x at the hinge)"""
    m = Part(v, 'mast', pivot=MPIV, parent=t, joint=rot('-x', 0.0, math.pi / 2, stow=0.0, deploy=math.pi / 2, group='raise'))
    hx, hy, hz = MPIV
    top = hy + 0.62
    m.cyl('paint', (hx, hy - 0.02, hz), (hx, top, hz), 0.08, 0.07, 12)
    m.cyl('dark', (hx - 0.14, hy, hz), (hx + 0.14, hy, hz), 0.07, 0.07, 10)
    m.box('paint', -0.14, 0.14, hy + 0.1, hy + 0.34, hz - 0.12, hz + 0.12, bev=0.02)
    # the antenna's node origin must sit on its spin axis in the rest (folded) pose: the folded mast top
    a = Part(v, 'antenna', pivot=(hx, hy, hz + (top - hy)), parent=m, joint=spinj([0, 0, 1], rpm=33))
    # rotary joint and the reflector's support
    a.cyl('dark', (hx, top, hz), (hx, top + 0.1, hz), 0.1, 0.1, 12)
    a.box('paint', -0.1, 0.1, top + 0.1, top + 0.28, hz - 0.12, hz + 0.3)
    # the main reflector: an open lattice ~1.5 m × 0.62 m, curved, facing forward (−z), tilted up a little
    c = Vector((hx, top + 0.55, hz + 0.28))
    redkit.lattice_reflector(a, c, 1.56, 0.64, 0.2, n_cols=9, n_rows=5, w=0.024)
    # feed horn on an arm in front of it
    a.beam('paint', (hx, top + 0.26, hz + 0.08), (hx, top + 0.3, hz - 0.2), 0.04, 0.04)
    a.box('dark', -0.1, 0.1, top + 0.24, top + 0.36, hz - 0.3, hz - 0.18)
    # IFF antenna above: a small lattice with its own feed
    c2 = Vector((hx, top + 1.02, hz + 0.24))
    a.beam('paint', (hx, top + 0.86, hz + 0.24), (hx, top + 0.96, hz + 0.24), 0.05, 0.05)
    redkit.lattice_reflector(a, c2, 0.62, 0.26, 0.08, n_cols=5, n_rows=3, w=0.018)
    a.box('dark', -0.05, 0.05, top + 0.97, top + 1.06, hz - 0.02, hz + 0.06)
    # fold both into the travel position: lying back over the launcher
    for p in (m, a):
        p.rotate_about(MPIV, (1, 0, 0), math.pi / 2)
    # (the spin axis in the mast's rest frame points aft; it becomes vertical when the mast is raised)
    return m, a


def hatches(v):
    out = []
    for sx, n in ((-1, 'hatch_l'), (1, 'hatch_r')):
        piv = (sx * 0.56, 2.44, 2.30)
        h = Part(v, n, pivot=piv, joint=rot('-x', 0.0, math.radians(105), group='hatch'))   # hinged at the front edge
        h.box('paint', sx * 0.22, sx * 0.92, 2.42, 2.47, 2.30, 3.00, bev=0.012)
        h.cyl('dark', (sx * 0.25, 2.445, 2.30), (sx * 0.88, 2.445, 2.30), 0.025, 0.025, 6)
        vkit.grab_handle(h, (sx * 0.57, 2.47, 2.75), (1, 0, 0), (0, 1, 0), 0.2, 0.03, 'dark')
        vkit.lamp_box(h, (sx * 0.4, 2.5, 2.55), (0.12, 0.05, 0.12), (0, 1, 0), lens='glass', skin='paint')   # vision block
        out.append(h)
    return out


def make():
    vkit.setup_materials('red_green')
    v = Vehicle('osa', '9A33BM3 Osa-AKM TELAR (SA-8 Gecko)', scheme='red_green')
    b = Part(v, 'body')
    hull(b)
    glazing(b)
    bow_details(b)
    deck_details(b)
    rear_details(b)
    chassis.wheels(v, None, AXLES, TRACK, R, TW, 0.27, steer={0: 1.0}, lugs=16, seg=24, nbolts=8, cti=True,
                   hub_skin='olive', rim_skin='olive')
    t = turret(v)
    launcher(v, t)
    search_radar(v, t)
    hatches(v)
    b.empty('exhaust', (1.05, DECK + 0.05, 8.7), (0, 1, 0))
    b.empty('seat_driver', (-0.6, 1.75, 1.95), (0, 0, -1))
    b.empty('hatch_entry', (-0.56, 2.5, 2.6), (0, 1, 0))
    return v
