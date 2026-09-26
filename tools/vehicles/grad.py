# ═══════════════════════════════════════════════════════════════
# BM-21 Grad multiple rocket launcher (2B17-style launch unit on the Ural-4320): 40 × 122 mm tubes, 3 m long, in
# 4 rows of 10, on a traversing base over the rear bogie; in travel the pack lies horizontal, muzzles forward over
# the cab. Traverse 102° left / 70° right, elevation 0–55°.
#   blender -b -P tools/vehicles/build.py -- grad
# References: BM-21 photos (Kyiv museum MUN 27777, Ukrainian army), BM-21 data (7.35 × 2.4 × 3.09 m travel).
# Rig: turret (rot y, the traversing base), launcher (rot x, the tube pack, + = muzzles up), muzzle_1..40 (tube
# exits, row by row from the top-left seen from behind), ram_l / ram_r (elevation rams), 6 wheels, exhaust,
# seat_driver, hatch_entry.
# ═══════════════════════════════════════════════════════════════
import math
from mathutils import Vector
import vkit
from vkit import Vehicle, Part, rot, lerp
import ural
from ural import URAL

TURRET = (0.0, 1.66, 5.52)      # traverse axis foot
TRUNNION = (0.0, 2.16, 5.40)    # elevation axis
Z_MUZZLE, Z_BREECH = 2.92, 5.92  # pack ends (3.0 m tubes)
ROWS_Y = [2.395, 2.55, 2.705, 2.86]
PITCH = 0.152
TUBE_R = 0.066


def build_platform(v, b):
    """the launcher platform on the frame, lockers, rear fenders, travel rest"""
    zr = URAL['len']
    b.box('dark', -0.46, 0.46, URAL['frame'][1], 1.30, 2.95, zr - 0.05)          # sub-frame
    b.box('paint', -1.1, 1.1, 1.30, 1.36, 3.0, zr - 0.06, bev=0.01)              # deck
    b.panel('tread_plate', [(-1.08, 1.36, 3.05), (1.08, 1.36, 3.05), (1.08, 1.36, 4.1), (-1.08, 1.36, 4.1)], (0, 1, 0), off=0.003)
    for sx in (-1, 1):
        # lockers along the deck edges ahead of the turret (spare parts, cables)
        b.box('paint', sx * 0.82, sx * 1.1, 1.36, 1.78, 3.05, 4.55, bev=0.02)
        for (z0, z1) in ((3.1, 3.8), (3.85, 4.5)):
            ural.outline(b, [(sx * 1.101, 1.40, z0), (sx * 1.101, 1.74, z0), (sx * 1.101, 1.74, z1), (sx * 1.101, 1.40, z1), (sx * 1.101, 1.40, z0)], (sx, 0, 0))
            vkit.grab_handle(b, (sx * 1.11, 1.6, (z0 + z1) / 2), (0, 0, 1), (sx, 0, 0), 0.16, 0.025, 'dark')
        # handrail along the deck side behind the lockers
        vkit.handrail(b, [(sx * 1.06, 1.36, 4.62), (sx * 1.06, 1.8, 4.62), (sx * 1.06, 1.8, 6.9), (sx * 1.06, 1.36, 6.9)], 0.016, 'paint')
    ural.rear_fenders(b, 4.25, 6.85, y=1.30)
    ural.rear_end(b, zr)
    # travel rest behind the cab: a portal frame with a padded cradle for the pack
    zt = 3.12
    for sx in (-1, 1):
        b.beam('paint', (sx * 0.62, 1.36, zt), (sx * 0.62, 2.24, zt), 0.08, 0.08)
        b.beam('paint', (sx * 0.62, 1.36, zt + 0.3), (sx * 0.62, 1.95, zt), 0.05, 0.05)
    b.box('paint', -0.7, 0.7, 2.18, 2.26, zt - 0.06, zt + 0.06)
    b.box('rubber', -0.55, 0.55, 2.26, 2.29, zt - 0.05, zt + 0.05)
    # turret seat ring on the deck
    b.cyl('dark', (0, 1.36, TURRET[2]), (0, 1.46, TURRET[2]), 0.72, 0.72, 20)


def build_turret(v):
    tx, ty, tz = TURRET
    t = Part(v, 'turret', pivot=TURRET, joint=rot('y', -math.radians(70), math.radians(102), group='turret'))
    # rotating base: bearing ring, the upper carriage with two trunnion brackets
    t.cyl('paint', (0, 1.46, tz), (0, 1.62, tz), 0.68, 0.66, 20)
    t.box('paint', -0.62, 0.62, 1.62, 1.80, tz - 0.62, tz + 0.5, bev=0.03)
    for sx in (-1, 1):
        pts = [(tz + 0.45, 1.80), (tz + 0.45, 2.02), (TRUNNION[2] + 0.18, TRUNNION[1] + 0.12), (TRUNNION[2] - 0.22, TRUNNION[1] + 0.12), (tz - 0.55, 1.80)]
        t.prism_x('paint', pts, sx * 0.84, sx * 0.9 if sx > 0 else sx * 0.84, cap0=True, cap1=True) if False else None
        x0, x1 = (0.84, 0.92) if sx > 0 else (-0.92, -0.84)
        t.prism_x('paint', pts, x0, x1)
        t.cyl('dark', (sx * 0.84, TRUNNION[1], TRUNNION[2]), (sx * 0.98, TRUNNION[1], TRUNNION[2]), 0.1, 0.1, 12)
        # elevation ram bases
        t.box('dark', sx * 0.46, sx * 0.58, 1.80, 1.92, tz - 0.62, tz - 0.42)
    # the gunner's panoramic sight and hand wheels on the left carriage bracket
    sx = -1
    t.box('dark', -1.02, -0.92, 1.9, 2.25, tz - 0.25, tz - 0.05)
    t.cyl('dark', (-1.05, 2.25, tz - 0.15), (-1.05, 2.42, tz - 0.15), 0.05, 0.05, 8)
    t.cyl('dark', (-1.05, 2.42, tz - 0.22), (-1.05, 2.42, tz - 0.05), 0.04, 0.04, 8)
    for (y, z) in ((2.0, tz - 0.3), (1.95, tz + 0.05)):
        t.cyl('steel', (-1.02, y, z), (-1.1, y, z), 0.09, 0.09, 12)
        t.cyl('dark', (-1.1, y, z), (-1.1, y + 0.08, z + 0.08), 0.012, 0.012, 5)
    # cable conduit to the pack (the firing circuit)
    t.tube('hose', [(0.5, 1.8, tz + 0.45), (0.7, 2.0, tz + 0.55), (0.72, 2.25, TRUNNION[2] + 0.35)], 0.025, 6)
    # rear control box (the firing panel)
    t.box('paint', -0.35, 0.35, 1.8, 2.05, tz + 0.5, tz + 0.72, bev=0.02)
    return t


def build_launcher(v, parent):
    L = Part(v, 'launcher', pivot=TRUNNION, parent=parent, joint=rot('x', 0.0, math.radians(55), group='launcher'))
    n = 10
    xs = [(i - (n - 1) / 2) * PITCH for i in range(n)]
    k = 0
    for r, y in enumerate(reversed(ROWS_Y)):          # top row first
        for x in xs:
            c0 = Vector((x, y, Z_MUZZLE))
            c1 = Vector((x, y, Z_BREECH))
            # tube shell (open ends)
            L.cyl('paint', c0, c1, TUBE_R, TUBE_R, 10, cap0=False, cap1=False, smooth=True)
            # muzzle: the rim's front face and outer band (a profile traversed into the tube: the front annulus faces
            # forwards, the band outwards), the bore wall seen from the muzzle (traversed back out: it faces in),
            # the dark bottom of the bore
            L.lathe(c0, (0, 0, 1), [(0.0, TUBE_R - 0.012, 'paint'), (0.0, TUBE_R + 0.006, 'paint'), (0.025, TUBE_R + 0.006, 'paint'), (0.025, TUBE_R, 'paint')], n=10, smooth=False)
            L.lathe(c0, (0, 0, 1), [(0.12, TUBE_R - 0.012, 'dark'), (0.0, TUBE_R - 0.012, 'dark')], n=10, smooth=False)
            L.disc('black', c0 + Vector((0, 0, 0.12)), (0, 0, -1), TUBE_R - 0.012, 8)
            # breech end: dark bore with the contact
            L.disc('black', c1 + Vector((0, 0, -0.03)), (0, 0, 1), TUBE_R - 0.004, 8)
            k += 1
            L.empty('muzzle_%d' % k, c0, (0, 0, -1))
    hw = n / 2 * PITCH + 0.02
    ybot, ytop = ROWS_Y[0] - TUBE_R - 0.02, ROWS_Y[-1] + TUBE_R + 0.02
    # retaining frames (bands) round the pack
    for z in (3.02, 4.12, 5.18, 5.80):
        L.box('paint', -hw - 0.05, hw + 0.05, ytop, ytop + 0.05, z - 0.04, z + 0.04)
        L.box('paint', -hw - 0.05, hw + 0.05, ybot - 0.06, ybot, z - 0.05, z + 0.05)
        for sx in (-1, 1):
            L.box('paint', sx * hw, sx * (hw + 0.05), ybot - 0.06, ytop + 0.05, z - 0.04, z + 0.04)
    # the cradle under the pack: two box girders and the trunnion arms
    for sx in (-1, 1):
        L.box('paint', sx * 0.52 - 0.08, sx * 0.52 + 0.08, ybot - 0.2, ybot - 0.06, Z_MUZZLE + 0.08, Z_BREECH - 0.05, bev=0.015)
        L.box('paint', sx * 0.72, sx * 0.84, TRUNNION[1] - 0.1, ybot - 0.06, TRUNNION[2] - 0.3, TRUNNION[2] + 0.3)
        L.cyl('dark', (sx * 0.72, TRUNNION[1], TRUNNION[2]), (sx * 0.84, TRUNNION[1], TRUNNION[2]), 0.13, 0.13, 12)
        # side plates along the bottom rows (the pack's side covers)
        L.box('paint', sx * (hw + 0.01), sx * (hw + 0.03), ybot, ROWS_Y[1] + 0.02, Z_MUZZLE + 0.15, Z_BREECH - 0.15)
    for z in (3.3, 4.6, 5.6):
        L.box('paint', -0.6, 0.6, ybot - 0.17, ybot - 0.09, z - 0.05, z + 0.05)
    # cable harness along the pack's side
    L.tube('hose', [(hw + 0.06, ROWS_Y[1], 5.7), (hw + 0.06, ROWS_Y[1], 3.2)], 0.02, 5)
    return L


def make():
    vkit.setup_materials('red_green')
    v = Vehicle('grad', 'BM-21 Grad multiple rocket launcher (Ural-4320)', scheme='red_green')
    b = Part(v, 'body')
    ural.ural(v, b, fuel_right=False)
    build_platform(v, b)
    t = build_turret(v)
    L = build_launcher(v, t)
    for sx, n in ((-1, 'ram_l'), (1, 'ram_r')):
        vkit.ram(v, n, t, (sx * 0.52, 1.88, TURRET[2] - 0.52), L, (sx * 0.52, 2.20 - 0.04, 4.35), r=0.055)
    return v
