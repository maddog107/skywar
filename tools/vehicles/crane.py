# ═══════════════════════════════════════════════════════════════
# Truck crane on the Ural-4320 (KS-35714-style, military green), used as the SCUD transloader: a slewing turret
# with the operator's cab and counterweight, a two-section telescopic box boom luffed by a hydraulic ram, the hook
# block, and four outriggers.
#   blender -b -P tools/vehicles/build.py -- crane
# References: KS-35714 on Ural-4320 photos (Wikimedia Commons); the 9T31M1 transloader crane of the Scud brigades.
# Rig: turret (rot y, slewing, full circle); boom (rot x about the boom foot, 0 → 70°, group 'raise'); boom_2
# (telescopic section, slide along the boom 0 → 3.6 m, 'raise'); hook (counter-rotates with the boom so the block
# hangs plumb while raise(rig, k) is used, 'raise'); ram_l (luffing ram); outrigger_fl/fr/rl/rr (beams slide out)
# and jack_fl/fr/rl/rr (feet down) — group 'jack'; 6 wheels, exhaust, seat_driver, hatch_entry.
# ═══════════════════════════════════════════════════════════════
import math
from mathutils import Vector, Quaternion
import vkit
from vkit import Vehicle, Part, rot, slide, lerp
import ural
from ural import URAL

TURRET = (0.0, 1.62, 5.45)
FOOT = (0.0, 3.05, 6.12)        # boom foot pivot
BOOM_UP = math.radians(70)
BW, BH = 0.23, 0.26             # base section half width / half height
Z_HEAD = 0.05                   # the base section's head (front) at rest
EXT = 3.6                       # telescope stroke


def build_platform(v, b):
    zr = URAL['len']
    b.box('dark', -0.46, 0.46, URAL['frame'][1], 1.36, 2.95, zr - 0.05)          # sub-frame
    b.box('paint', -1.05, 1.05, 1.36, 1.46, 3.0, zr - 0.08, bev=0.01)             # platform deck
    b.panel('tread_plate', [(-1.0, 1.46, 3.05), (1.0, 1.46, 3.05), (1.0, 1.46, 4.2), (-1.0, 1.46, 4.2)], (0, 1, 0), off=0.003)
    b.cyl('dark', (0, 1.46, TURRET[2]), (0, 1.56, TURRET[2]), 0.8, 0.8, 20)
    ural.rear_fenders(b, 4.25, 6.85, y=1.36)
    ural.rear_end(b, zr)
    # boom rest behind the cab (a portal with a saddle), tool boxes on the platform front
    zt = 3.05
    for sx in (-1, 1):
        b.beam('paint', (sx * 0.55, 1.46, zt), (sx * 0.35, FOOT[1] - BH - 0.05, zt), 0.08, 0.08)
    b.box('paint', -0.45, 0.45, FOOT[1] - BH - 0.08, FOOT[1] - BH - 0.02, zt - 0.08, zt + 0.08)
    for sx in (-1, 1):
        b.box('paint', sx * 0.62, sx * 1.02, 1.46, 1.84, 3.2, 4.1, bev=0.02)
        vkit.grab_handle(b, (sx * 1.03, 1.65, 3.65), (0, 0, 1), (sx, 0, 0), 0.18, 0.03, 'dark')


def build_turret(v):
    tx, ty, tz = TURRET
    t = Part(v, 'turret', pivot=TURRET, joint=rot('y', -math.pi, math.pi, group='turret'))
    t.cyl('paint', (0, 1.56, tz), (0, 1.74, tz), 0.78, 0.76, 20)
    # the rotating deck (a plate with a rounded tail)
    deck = [(-1.12, 4.35), (1.12, 4.35), (1.12, 6.4), (0.8, 6.95), (-0.8, 6.95), (-1.12, 6.4)]
    t.prism_y('paint', deck, 1.74, 1.86)
    # counterweight at the tail
    t.prism_y('paint', [(-1.05, 6.35), (1.05, 6.35), (0.78, 6.9), (-0.78, 6.9)], 1.86, 2.55)
    # boom foot brackets and the winch drum between them
    for sx in (-1, 1):
        x0, x1 = (0.26, 0.34) if sx > 0 else (-0.34, -0.26)
        t.prism_x('paint', [(5.6, 1.86), (6.5, 1.86), (FOOT[2] + 0.2, FOOT[1] + 0.12), (FOOT[2] - 0.25, FOOT[1] + 0.1)], x0, x1)
        t.cyl('dark', (sx * 0.24, FOOT[1], FOOT[2]), (sx * 0.4, FOOT[1], FOOT[2]), 0.1, 0.1, 12)
    t.cyl('dark', (-0.24, 2.25, 5.95), (0.24, 2.25, 5.95), 0.24, 0.24, 16)
    t.cyl('cable', (-0.2, 2.25, 5.95), (0.2, 2.25, 5.95), 0.26, 0.26, 16)
    t.box('dark', -0.2, 0.2, 1.86, 2.1, 5.7, 6.2)
    # the operator's cab on the right front of the deck
    cx0, cx1, cz0, cz1, cy0, cy1 = 0.42, 1.1, 4.4, 5.35, 1.86, 3.2
    ring0 = [(cx0, cy0, cz0), (cx1, cy0, cz0), (cx1, cy0, cz1), (cx0, cy0, cz1)]
    ring1 = [(cx0, cy1 - 0.1, cz0 + 0.12), (cx1, cy1 - 0.1, cz0 + 0.12), (cx1, cy1 - 0.1, cz1), (cx0, cy1 - 0.1, cz1)]
    ring2 = [(cx0 + 0.04, cy1, cz0 + 0.2), (cx1 - 0.04, cy1, cz0 + 0.2), (cx1 - 0.04, cy1, cz1 - 0.04), (cx0 + 0.04, cy1, cz1 - 0.04)]
    t.loft('paint', [ring0, ring1, ring2], smooth=False)
    t.face(ring2, 'paint', want=(0, 1, 0))
    # glazing: front (sloped), the right side and the door on the left (towards the boom), roof window
    fn = (Vector(ring1[1]) - Vector(ring1[0])).cross(Vector(ring0[0]) - Vector(ring1[0]))
    def fq(u0, u1, v0, v1):
        A0, A1, B0, B1 = Vector(ring0[0]), Vector(ring0[1]), Vector(ring1[0]), Vector(ring1[1])
        return [lerp(lerp(A0, A1, u0), lerp(B0, B1, u0), v0), lerp(lerp(A0, A1, u1), lerp(B0, B1, u1), v0),
                lerp(lerp(A0, A1, u1), lerp(B0, B1, u1), v1), lerp(lerp(A0, A1, u0), lerp(B0, B1, u0), v1)]
    t.panel('glass', fq(0.08, 0.92, 0.35, 0.93), (0, 0.12, -1), off=0.006, frame=0.03)
    t.panel('glass', [(cx1, 2.35, cz0 + 0.25), (cx1, 2.35, cz1 - 0.1), (cx1, 3.0, cz1 - 0.1), (cx1, 3.0, cz0 + 0.25)], (1, 0, 0), off=0.006, frame=0.03)
    t.panel('glass', [(cx0, 2.35, cz0 + 0.3), (cx0, 2.35, cz0 + 0.7), (cx0, 3.0, cz0 + 0.7), (cx0, 3.0, cz0 + 0.3)], (-1, 0, 0), off=0.006, frame=0.03)
    ural.outline(t, [(cx0, 1.92, cz0 + 0.25), (cx0, 3.08, cz0 + 0.25), (cx0, 3.08, cz0 + 0.75), (cx0, 1.92, cz0 + 0.75), (cx0, 1.92, cz0 + 0.25)], (-1, 0, 0))
    vkit.grab_handle(t, (cx0 - 0.01, 2.4, cz0 + 0.68), (0, 1, 0), (-1, 0, 0), 0.15, 0.03, 'dark')
    t.cyl('dark', (cx1 - 0.15, 3.2, cz0 + 0.5), (cx1 - 0.15, 3.3, cz0 + 0.5), 0.06, 0.06, 8)      # beacon base
    t.cyl('lens_amber', (cx1 - 0.15, 3.3, cz0 + 0.5), (cx1 - 0.15, 3.42, cz0 + 0.5), 0.07, 0.06, 10)
    # hydraulic tank and the engine-driven pump behind the cab
    t.box('paint', 0.45, 1.05, 1.86, 2.4, 5.45, 6.2, bev=0.02)
    t.cyl('dark', (0.75, 2.4, 5.8), (0.75, 2.47, 5.8), 0.06, 0.06, 8)
    return t


def build_boom(v, t):
    fx, fy, fz = FOOT
    bm = Part(v, 'boom', pivot=FOOT, parent=t, joint=rot('x', 0.0, BOOM_UP, group='raise'))
    # base section: a tapered box from behind the foot to the head
    tail = fz + 0.35
    bm.box('paint', -BW, BW, fy - BH, fy + BH, Z_HEAD, tail, bev=0.03)
    # stiffening plates, the head plate
    for z in (1.5, 3.0, 4.5):
        bm.box('paint', -BW - 0.01, BW + 0.01, fy - BH - 0.01, fy + BH + 0.01, z - 0.03, z + 0.03)
    bm.box('dark', -BW - 0.02, BW + 0.02, fy - BH - 0.02, fy + BH + 0.02, Z_HEAD, Z_HEAD + 0.08)
    bm.cyl('dark', (-BW - 0.06, fy, fz), (BW + 0.06, fy, fz), 0.09, 0.09, 12)            # foot pin
    # the luffing ram's lug under the boom
    bm.box('dark', -0.12, 0.12, fy - BH - 0.12, fy - BH, 3.45, 3.75)
    # hose run along the side
    bm.tube('hose', [(BW + 0.03, fy - 0.1, tail - 0.3), (BW + 0.03, fy - 0.1, Z_HEAD + 0.3)], 0.018, 5)
    # telescopic section (slides forward along the boom)
    b2 = Part(v, 'boom_2', pivot=FOOT, parent=bm, joint=slide('-z', EXT, group='raise'))
    iw, ih = BW - 0.05, BH - 0.05
    hz = Z_HEAD - 0.35          # its head sticks out ahead of the base section
    b2.box('paint', -iw, iw, fy - ih, fy + ih, hz, Z_HEAD + 3.9, bev=0.02)
    b2.box('dark', -iw - 0.02, iw + 0.02, fy - ih - 0.02, fy + ih + 0.02, hz, hz + 0.06)
    # boom head with its sheaves
    for x in (-0.09, 0.09):
        b2.cyl('dark', (x - 0.03, fy - 0.05, hz - 0.12), (x + 0.03, fy - 0.05, hz - 0.12), 0.2, 0.2, 14)
    b2.box('paint', -iw, iw, fy - ih - 0.1, fy + ih, hz - 0.3, hz)
    # hook block: hangs plumb (counter-rotates as the boom is raised)
    hp = Vector((0.0, fy - 0.3, hz - 0.12))
    hk = Part(v, 'hook', pivot=hp, parent=b2, joint=rot('x', -BOOM_UP, 0.0, stow=0.0, deploy=-BOOM_UP, group='raise'))
    drop = 1.05
    for x in (-0.07, 0.07):
        hk.cyl('cable', (x, hp.y, hp.z), (x, hp.y - drop, hp.z), 0.012, 0.012, 4)
    hk.box('dark', -0.12, 0.12, hp.y - drop - 0.28, hp.y - drop, hp.z - 0.1, hp.z + 0.1, bev=0.02)
    for x in (-0.05, 0.05):
        hk.cyl('steel', (x, hp.y - drop - 0.05, hp.z - 0.11), (x, hp.y - drop - 0.05, hp.z + 0.11), 0.09, 0.09, 12)
    hk.tube('steel', [(0, hp.y - drop - 0.28, hp.z), (0, hp.y - drop - 0.42, hp.z), (0, hp.y - drop - 0.52, hp.z + 0.06),
                      (0, hp.y - drop - 0.46, hp.z + 0.13), (0, hp.y - drop - 0.4, hp.z + 0.1)], 0.028, 6)
    hk.cyl('yellow', (-0.13, hp.y - drop - 0.2, hp.z), (0.13, hp.y - drop - 0.2, hp.z), 0.035, 0.035, 8)
    return bm, b2, hk


def build_outrigger(v, name, sx, z, reach=0.85):
    """a box-section outrigger beam sliding out sideways, with the jack (and its float) at its end"""
    y = 1.12
    o = Part(v, 'outrigger_' + name, pivot=(sx * 0.9, y, z), joint=slide('x' if sx > 0 else '-x', reach, group='jack'))
    o.box('paint', sx * 0.2, sx * 1.12, y - 0.1, y + 0.1, z - 0.1, z + 0.1)
    o.cyl('paint', (sx * 1.02, y - 0.12, z), (sx * 1.02, y + 0.35, z), 0.085, 0.085, 10)
    j = Part(v, 'jack_' + name, pivot=(sx * 1.02, y, z), parent=o, joint=slide('-y', 0.62, group='jack'))
    foot = 0.62
    j.cyl('steel', (sx * 1.02, foot + 0.06, z), (sx * 1.02, y + 0.3, z), 0.06, 0.06, 8)
    j.cyl('dark', (sx * 1.02, foot, z), (sx * 1.02, foot + 0.06, z), 0.22, 0.2, 12)
    return o


def make():
    vkit.setup_materials('red_green')
    v = Vehicle('crane', 'Truck crane / Scud transloader (Ural-4320)', scheme='red_green')
    b = Part(v, 'body')
    ural.ural(v, b)
    build_platform(v, b)
    t = build_turret(v)
    bm, b2, hk = build_boom(v, t)
    vkit.ram(v, 'ram_l', t, (0.0, 1.9, 4.8), bm, (0.0, FOOT[1] - BH - 0.08, 3.6), r=0.1)
    # outrigger boxes on the frame (fixed) and the moving beams
    for (zc) in (3.15, 7.0):
        b.box('paint', -0.95, 0.95, 1.0, 1.24, zc - 0.13, zc + 0.13)
    for name, sx, z in (('fl', -1, 3.15), ('fr', 1, 3.15), ('rl', -1, 7.0), ('rr', 1, 7.0)):
        build_outrigger(v, name, sx, z)
    return v
