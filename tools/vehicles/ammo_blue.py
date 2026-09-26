# ═══════════════════════════════════════════════════════════════
# M985A4 HEMTT A4 cargo truck as the Patriot battery's guided missile transporter (GMT): drop-side cargo bed with
# two PAC-3 four-round missile packs, and the rear-mounted knuckle-boom material-handling crane folded over the load.
#   blender -b -P tools/vehicles/build.py -- ammo_blue
# HEMTT A4 cab / engine / chassis from tools/vehicles/usfam.py on the long wheelbase (as the M978A4). The crane sits
# at the rear of the bed as on the M977 / M985 cargo trucks (US Army photos, Wikimedia Commons, public domain).
# Rig: turret (crane slew, rot y full circle), boom (main boom, rot x 0 → 70°, 'raise'), boom_2 (outer boom at the
# knuckle, bends down −100°, 'raise'), boom_3 (telescopic extension, slides out 1.6 m, 'raise'), hook (counter-
# rotates so it hangs plumb through raise(rig, k)), ram_l (lift ram), ram_k (knuckle ram), jack_rl / jack_rr
# (stabilisers, 'jack'), door_side_l / door_side_r (drop sides, fold down 90°, 'side'), canister_1 / canister_2
# (the missile packs as their own nodes, so a reload can lift them away), door_l / door_r, 8 wheels, exhaust,
# seat_driver, hatch_entry.
# ═══════════════════════════════════════════════════════════════
import math
from mathutils import Vector
import vkit
from vkit import Vehicle, Part, rot, slide, lerp
import usfam

AXLES = [1.95, 3.47, 7.28, 8.80]
ZEND = 10.30
BED = {'z0': 4.06, 'z1': 9.46, 'y0': 1.30, 'y1': 1.45, 'hw': 1.2, 'side': 0.62}
COL = Vector((0.0, BED['y1'], 9.92))          # crane column base (slew axis)
BOOM = Vector((0.0, 2.95, 9.92))             # main boom pivot (column top)
BOOM_LEN = 3.55
KNUCKLE = BOOM + Vector((0, 0, -BOOM_LEN))   # outer boom pivot (main boom tip, stowed)
LIFT = math.radians(70)
BEND = math.radians(-100)


def missile_pack(v, name, cx, z0, z1):
    """a PAC-3 four-round canister pack: ribbed box, 2 × 2 round tube ends at both ends, lifting lugs, stencils"""
    y0 = BED['y1'] + 0.08
    hw, h = 0.54, 0.95
    y1 = y0 + h
    c = Part(v, name, pivot=(cx, y0, (z0 + z1) / 2))
    c.box('paint', cx - hw, cx + hw, y0, y1, z0, z1, bev=0.02)
    for k in range(9):
        z = lerp(z0 + 0.08, z1 - 0.08, k / 8)
        e = 0.02 if 0 < k < 8 else 0.035
        c.box('paint', cx - hw - e, cx + hw + e, y0 - e * 0.5, y1 + e, z - 0.04, z + 0.04)
    for zf, nz in ((z0, -1), (z1, 1)):
        for dx in (-0.25, 0.25):
            for dy in (0.25, 0.7):
                p = Vector((cx + dx, y0 + dy, zf))
                c.cyl('dark', p, p + Vector((0, 0, nz * 0.02)), 0.2, 0.2, 14, cap1=False)
                c.disc('radome' if nz < 0 else 'soot', p + Vector((0, 0, nz * 0.021)), (0, 0, nz), 0.18, 14)
    for dz in (0.5, z1 - z0 - 0.5):
        for dx in (-hw + 0.1, hw - 0.1):
            c.cyl('dark', (cx + dx, y1, z0 + dz - 0.05), (cx + dx, y1, z0 + dz + 0.05), 0.045, 0.045, 8)
    for sx in (-1, 1):
        x = cx + sx * (hw + 0.021)
        usfam.stencil_box(c, (x, y0 + 0.62, z0 + 1.4), 0.6, 0.08, (sx, 0, 0))
        usfam.stencil_box(c, (x, y0 + 0.48, z0 + 1.4), 0.4, 0.06, (sx, 0, 0))
        c.panel('yellow', [(x, y0 + 0.1, z0 + 0.5), (x, y0 + 0.1, z0 + 0.6), (x, y1 - 0.1, z0 + 0.6), (x, y1 - 0.1, z0 + 0.5)], (sx, 0, 0), off=0.004)
    # the tie-down straps over the pack
    for z in (z0 + 1.3, z1 - 1.3):
        c.box('dark', cx - hw - 0.03, cx + hw + 0.03, y1 + 0.03, y1 + 0.045, z - 0.03, z + 0.03)
    return c


def build_bed(v, b):
    z0, z1, y0, y1, hw = BED['z0'], BED['z1'], BED['y0'], BED['y1'], BED['hw']
    for sx in (-1, 1):
        b.box('paint', sx * 0.45, sx * 0.62, 1.22, y0, z0 - 0.05, z1 + 0.6)                   # sub-frame
    b.box('paint', -hw, hw, y0, y1, z0, z1, bev=0.015)
    b.panel('tread_plate', [(-hw + 0.05, y1, z0 + 0.12), (hw - 0.05, y1, z0 + 0.12), (hw - 0.05, y1, z1 - 0.05), (-hw + 0.05, y1, z1 - 0.05)], (0, 1, 0), off=0.003)
    for z in [z0 + 0.3 + 0.62 * k for k in range(9)]:
        b.box('dark', -hw, hw, y0 - 0.12, y0, z - 0.05, z + 0.05)                             # cross bearers
    # headboard behind the cab: a frame with a mesh guard
    b.box('paint', -hw, hw, y1, 2.72, z0, z0 + 0.1)
    b.panel('mesh', [(-hw + 0.12, y1 + 0.12, z0), (hw - 0.12, y1 + 0.12, z0), (hw - 0.12, 2.6, z0), (-hw + 0.12, 2.6, z0)], (0, 0, -1), off=0.004)
    b.box('paint', -hw, hw, 2.72, 2.8, z0 - 0.02, z0 + 0.12)
    # drop sides (hinged at the floor edge, fold down and out)
    sides = {}
    for sx, key in ((-1, 'l'), (1, 'r')):
        x = sx * hw
        d = Part(v, 'door_side_' + key, pivot=(x, y1, (z0 + z1) / 2),
                 joint=rot([0, 0, -sx], 0.0, math.pi / 2, stow=0.0, deploy=math.pi / 2, group='side'))
        xi = x - sx * 0.05
        d.box('paint', min(x, xi), max(x, xi), y1, y1 + BED['side'], z0 + 0.12, z1 - 0.02, bev=0.01)
        for k in range(1, 6):
            z = lerp(z0 + 0.12, z1 - 0.02, k / 6)
            d.box('paint', min(x, x + sx * 0.03), max(x, x + sx * 0.03), y1 + 0.02, y1 + BED['side'] - 0.02, z - 0.04, z + 0.04)
        d.box('paint', min(x, x + sx * 0.035), max(x, x + sx * 0.035), y1 + BED['side'] - 0.07, y1 + BED['side'], z0 + 0.12, z1 - 0.02)
        for z in (z0 + 0.4, z1 - 0.35):
            d.box('dark', min(x, x + sx * 0.05), max(x, x + sx * 0.05), y1 + BED['side'] - 0.2, y1 + BED['side'] - 0.08, z - 0.05, z + 0.05)
        sides[key] = d
        # hinges on the floor edge
        for z in (z0 + 0.8, (z0 + z1) / 2, z1 - 0.8):
            b.cyl('dark', (x, y1, z - 0.12), (x, y1, z + 0.12), 0.03, 0.03, 8)
    return sides


def build_crane(v, b):
    # pedestal on the frame behind the bed, slewing column
    b.box('paint', -0.55, 0.55, 1.22, BED['y1'], 9.52, 10.3, bev=0.02)
    tur = Part(v, 'turret', pivot=tuple(COL), joint=rot('y', -math.pi, math.pi, stow=0.0, deploy=0.0, group='turret'))
    tur.cyl('dark', COL, COL + Vector((0, 0.1, 0)), 0.45, 0.45, 20, cap0=False)
    tur.cyl('paint', COL + Vector((0, 0.1, 0)), COL + Vector((0, 0.3, 0)), 0.42, 0.36, 16, cap0=False)
    tur.box('paint', -0.22, 0.22, COL.y + 0.3, BOOM.y + 0.08, COL.z - 0.2, COL.z + 0.22, bev=0.02)     # column
    tur.box('paint', -0.28, -0.22, BOOM.y - 0.2, BOOM.y + 0.14, COL.z - 0.12, COL.z + 0.12)            # pivot cheeks
    tur.box('paint', 0.22, 0.28, BOOM.y - 0.2, BOOM.y + 0.14, COL.z - 0.12, COL.z + 0.12)
    tur.cyl('dark', BOOM + Vector((-0.3, 0, 0)), BOOM + Vector((0.3, 0, 0)), 0.07, 0.07, 10)
    # operator's control station on the column (levers) and a hydraulic tank
    tur.box('dark', 0.22, 0.42, COL.y + 0.55, COL.y + 0.85, COL.z - 0.12, COL.z + 0.08)
    for k in range(4):
        tur.beam('black', (0.42, COL.y + 0.8, COL.z - 0.08 + 0.05 * k), (0.52, COL.y + 0.98, COL.z - 0.1 + 0.05 * k), 0.012, 0.012)
    tur.box('paint', -0.45, -0.22, COL.y + 0.3, COL.y + 0.8, COL.z - 0.1, COL.z + 0.2, bev=0.02)
    # main boom (stowed: forward over the load)
    bm = Part(v, 'boom', pivot=tuple(BOOM), parent=tur, joint=rot('x', 0.0, LIFT, stow=0.0, deploy=LIFT, group='raise'))
    bm.box('paint', -0.16, 0.16, BOOM.y - 0.12, BOOM.y + 0.14, KNUCKLE.z + 0.05, BOOM.z + 0.15, bev=0.02)
    bm.cyl('dark', KNUCKLE + Vector((-0.2, 0, 0)), KNUCKLE + Vector((0.2, 0, 0)), 0.065, 0.065, 10)
    for sx in (-1, 1):
        bm.box('paint', sx * 0.16, sx * 0.2, BOOM.y - 0.1, BOOM.y + 0.12, KNUCKLE.z - 0.05, KNUCKLE.z + 0.25)
    bm.tube('hose', [(0.17, BOOM.y + 0.1, BOOM.z - 0.2), (0.17, BOOM.y + 0.1, KNUCKLE.z + 0.4)], 0.015, 5)
    bm.tube('hose', [(-0.17, BOOM.y + 0.1, BOOM.z - 0.2), (-0.17, BOOM.y + 0.1, KNUCKLE.z + 0.4)], 0.015, 5)
    # outer boom at the knuckle (stowed: continuing forward), its telescopic extension, the hook
    ob = Part(v, 'boom_2', pivot=tuple(KNUCKLE), parent=bm, joint=rot('x', BEND, 0.0, stow=0.0, deploy=BEND, group='raise'))
    o_len = 2.3
    tip = KNUCKLE + Vector((0, 0, -o_len))
    ob.box('paint', -0.13, 0.13, KNUCKLE.y - 0.1, KNUCKLE.y + 0.11, tip.z, KNUCKLE.z + 0.2, bev=0.02)
    ex = Part(v, 'boom_3', pivot=tuple(KNUCKLE), parent=ob, joint=slide([0, 0, -1], 1.6, group='raise'))
    ex.box('paint', -0.1, 0.1, KNUCKLE.y - 0.075, KNUCKLE.y + 0.085, tip.z - 0.25, tip.z + 1.7, bev=0.015)
    ex.box('dark', -0.12, 0.12, KNUCKLE.y - 0.1, KNUCKLE.y + 0.1, tip.z - 0.35, tip.z - 0.22)
    hk = Part(v, 'hook', pivot=tuple(tip + Vector((0, -0.1, -0.29))), parent=ex, joint=rot('x', 0.0, -(LIFT + BEND), stow=0.0, deploy=-(LIFT + BEND), group='raise'))
    hp = tip + Vector((0, -0.1, -0.29))
    hk.cyl('dark', hp, hp + Vector((0, -0.18, 0)), 0.012, 0.012, 5)
    hk.cyl('dark', hp + Vector((0, -0.18, 0)), hp + Vector((0, -0.3, 0)), 0.06, 0.05, 8)
    hk.tube('steel', [hp + Vector((0, -0.3, 0)), hp + Vector((0, -0.4, 0.02)), hp + Vector((0, -0.45, -0.05)), hp + Vector((0, -0.4, -0.1))], 0.018, 5)
    # rams: main lift (column → main boom), knuckle (main boom → outer boom)
    vkit.ram(v, 'ram_l', tur, (0.0, COL.y + 0.55, COL.z - 0.3), bm, (0.0, BOOM.y - 0.14, BOOM.z - 1.3), r=0.08)
    vkit.ram(v, 'ram_k', bm, (0.0, BOOM.y + 0.16, KNUCKLE.z + 1.4), ob, (0.0, KNUCKLE.y + 0.13, KNUCKLE.z - 0.35), r=0.06)
    # stowed-boom rest on the headboard
    b.box('dark', -0.2, 0.2, 2.8, BOOM.y - 0.12, BED['z0'] + 0.3, BED['z0'] + 0.45)
    return tur


def build_jacks(v, b):
    for sx, key in ((-1, 'rl'), (1, 'rr')):
        x, z = sx * 1.22, 10.0
        b.box('paint', min(sx * 0.55, x), max(sx * 0.55, x), 0.95, 1.22, z - 0.12, z + 0.12)            # outrigger beam
        b.cyl('paint', (x, 0.72, z), (x, 1.28, z), 0.09, 0.09, 12)
        j = Part(v, 'jack_' + key, pivot=(x, 1.28, z), joint=slide('-y', 0.42, group='jack'))
        j.cyl('steel', (x, 0.5, z), (x, 1.22, z), 0.065, 0.065, 10)
        j.box('dark', x - 0.2, x + 0.2, 0.42, 0.48, z - 0.2, z + 0.2, bev=0.01)


def make():
    vkit.setup_materials('blue_tan')
    v = Vehicle('ammo_blue', 'M985A4 HEMTT A4 guided missile transporter (Patriot)', scheme='blue_tan')
    b = Part(v, 'body')
    usfam.hemtt_cab(v, b)
    usfam.hemtt_engine(b, spare=True)
    usfam.hemtt_chassis(v, b, AXLES, ZEND - 0.1, fenders=((), ((6.58, 9.52),)))
    build_bed(v, b)
    missile_pack(v, 'canister_1', -0.58, BED['z0'] + 0.15, BED['z1'] - 0.08)
    missile_pack(v, 'canister_2', 0.58, BED['z0'] + 0.15, BED['z1'] - 0.08)
    build_crane(v, b)
    build_jacks(v, b)
    # rear crossmember with lights under the crane pedestal
    b.box('paint', -1.2, 1.2, 0.72, 1.22, ZEND - 0.25, ZEND, bev=0.02)
    for sx in (-1, 1):
        vkit.lamp_box(b, (sx * 0.95, 1.0, ZEND + 0.02), (0.2, 0.1, 0.05), (0, 0, 1), lens='lens_red')
        vkit.lamp_box(b, (sx * 0.95, 0.86, ZEND + 0.02), (0.09, 0.07, 0.05), (0, 0, 1), lens='lens_amber')
        usfam.reflector_tri(b, (sx * 0.62, 1.0, ZEND), (0, 0, 1), 0.06)
        b.box('rubber', sx * 0.75, sx * 1.18, 0.4, 1.3, 9.5, 9.53)
    b.box('dark', -0.1, 0.1, 0.8, 0.98, ZEND, ZEND + 0.08)
    vkit.whip_antenna(b, (1.05, 2.86, 2.3), h=2.4)
    return v
